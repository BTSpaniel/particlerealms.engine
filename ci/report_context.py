# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Bind current evidence to actual input bytes and verify they remain unchanged."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess

SCHEMA = 'particle-sdk-report-context/v1'
ACCEPTED_DISTRIBUTION_COMMIT = 'f4f6ac9585a77df63f47ece4e5fb213cd9928612'
IGNORED = frozenset({'__pycache__', '.git', '.venv'})
RECIPE_IGNORED = IGNORED | {'test-results', 'build', 'candidate', 'candidates'}
RECIPE_DIRECTORIES = ('ci', 'tools', '.github/workflows')
RECIPE_SUFFIXES = frozenset({'.py', '.json', '.js', '.html', '.yml', '.yaml', '.txt'})


def digest(path: Path) -> str:
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def canonical_digest(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()).hexdigest()


def inventory(root: Path, *, recipe: bool = False) -> dict:
    """Hash actual regular files; directory digests are never archive digests."""
    root = Path(root).resolve()
    if not root.is_dir():
        raise ValueError('Identity directory is missing: ' + str(root))
    records = {}
    starts = [root / name for name in RECIPE_DIRECTORIES] if recipe else [root]
    for start in starts:
        if not start.exists():
            continue
        for directory, directories, files in os.walk(start, followlinks=False):
            if any((Path(directory) / name).is_symlink() for name in directories):
                raise ValueError('Identity contains a symbolic-link directory')
            directories[:] = sorted(name for name in directories if name not in (RECIPE_IGNORED if recipe else IGNORED))
            for name in sorted(files):
                path = Path(directory) / name
                if name.endswith('.pyc') or recipe and path.suffix not in RECIPE_SUFFIXES:
                    continue
                if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root):
                    raise ValueError('Identity contains an unsafe file: ' + str(path))
                records[path.relative_to(root).as_posix()] = {'bytes': path.stat().st_size, 'sha256': digest(path)}
    if not records:
        raise ValueError('Identity directory contains no files: ' + str(root))
    result = {'kind': 'directory', 'inventorySha256': canonical_digest(records),
              'files': len(records), 'bytes': sum(record['bytes'] for record in records.values())}
    if not recipe:
        result['manifestSha256'] = digest(root / 'manifest.json') if (root / 'manifest.json').is_file() else None
    return result


def file_identity(path: Path | None) -> dict | None:
    if path is None:
        return None
    path = Path(path)
    if not path.is_file() or path.is_symlink():
        raise ValueError('Identity file is absent or unsafe: ' + str(path))
    return {'kind': 'file', 'sha256': digest(path), 'bytes': path.stat().st_size}


def git_value(root: Path, *args: str) -> str | None:
    result = subprocess.run(['git', *args], cwd=root, capture_output=True, text=True, timeout=30)
    return result.stdout.strip() if result.returncode == 0 else None


def capture(root: Path, sdk: Path | None = None, candidate: Path | None = None,
            template: Path | None = None) -> dict:
    """SDK always identifies the checked-in input; candidate identifies tested rebuilds."""
    root = Path(root).resolve()
    sdk = Path(sdk or root / 'engine-sdk').resolve()
    if sdk != (root / 'engine-sdk').resolve():
        raise ValueError('Context SDK must be the checked-in engine-sdk; use candidate for rebuilt packages')
    template = Path(template or root / 'Template.zip')
    validation = root / 'SDK-VALIDATION.json'
    repository = os.environ.get('GITHUB_REPOSITORY')
    if not repository and validation.is_file():
        repository = json.loads(validation.read_text(encoding='utf-8')).get('repository')
    commit = git_value(root, 'rev-parse', 'HEAD')
    working_status = git_value(root, 'status', '--porcelain', '--untracked-files=normal')
    requested_commit = os.environ.get('GITHUB_SHA')
    return {'schema': SCHEMA, 'repository': repository or 'local', 'commit': commit or requested_commit,
            'workingTreeClean': None if working_status is None else not bool(working_status),
            'workflowCommit': requested_commit,
            'workflow': os.environ.get('GITHUB_WORKFLOW', 'local'),
            'runId': os.environ.get('GITHUB_RUN_ID', 'local'),
            'runAttempt': os.environ.get('GITHUB_RUN_ATTEMPT', '1'),
            'job': os.environ.get('GITHUB_JOB', 'local'), 'recipe': inventory(root, recipe=True),
            'sdk': inventory(sdk), 'candidate': inventory(candidate) if candidate is not None else None,
            'template': file_identity(template) if template.exists() else None}


def verify_finish(context: dict, root: Path, sdk: Path | None = None,
                  candidate: Path | None = None, template: Path | None = None) -> dict:
    try:
        observed = capture(root, sdk=sdk, candidate=candidate, template=template)
        changes = [name for name in sorted(set(context) | set(observed)) if context.get(name) != observed.get(name)]
        return {'status': 'FAIL' if changes else 'PASS', 'changes': changes, 'context': observed}
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        return {'status': 'FAIL', 'changes': ['identity unavailable'], 'error': str(error)}
