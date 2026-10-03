# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Compare actual SDK API and protected bytes with the preserved released Git tag."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import posixpath
import subprocess
import sys

from report_context import ACCEPTED_DISTRIBUTION_COMMIT, capture, verify_finish
from aggregate import aggregate

ROOT = Path(__file__).resolve().parents[1]
BASELINE = 'v0.8.1-alpha.1'
PROTECTED_NAMES = frozenset({'LICENSE', 'NOTICE.md', 'AUTHORS'})


def load_parser(sdk: Path):
    name = '_sdk_change_report_parser'
    spec = importlib.util.spec_from_file_location(name, sdk / 'bundler/parser.py')
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module.parse_module


def source_exports(entries: list[str], read, parse) -> dict[str, list[str]]:
    """Use the shipped tokenizer, including transitive export-star fixed points."""
    graph = {}

    def scan(path):
        parts = PurePosixPath(path)
        if parts.is_absolute() or '..' in parts.parts or '\\' in path or ':' in path:
            raise ValueError('Unsafe public module path: ' + path)
        if path in graph:
            return
        graph[path] = (set(), [])
        direct, stars = graph[path]
        try:
            _imports, exports = parse(read(path).decode('utf-8-sig'))
        except Exception as error:
            raise ValueError('Cannot tokenize public module ' + path + ': ' + str(error)) from error
        for entry in exports:
            if entry.default:
                direct.add('default')
            if entry.namespace:
                direct.add(entry.namespace)
            direct.update(binding.split(' as ')[-1].strip() for binding in entry.named)
            if entry.reexport and not entry.named and not entry.namespace:
                if not entry.spec.startswith('.'):
                    raise ValueError('Public export-star must resolve inside SDK: ' + entry.spec)
                dependency = posixpath.normpath(posixpath.join(posixpath.dirname(path), entry.spec))
                if dependency.startswith('../') or dependency.startswith('/'):
                    raise ValueError('Public export-star escapes SDK')
                stars.append(dependency)
                scan(dependency)

    for entry in entries:
        scan(entry)
    changed = True
    while changed:
        changed = False
        for direct, stars in graph.values():
            previous = len(direct)
            for dependency in stars:
                direct.update(graph[dependency][0] - {'default'})
            changed = changed or len(direct) != previous
    return {entry: sorted(graph[entry][0]) for entry in sorted(entries)}


def snapshot(manifest: dict, read, parse) -> dict:
    files = manifest['files']
    entries = manifest['publicEntrypoints']
    if not isinstance(entries, dict) or not entries or not set(entries).issubset(files):
        raise ValueError('Public entrypoints must identify inventoried SDK source modules')
    declarations, native, protected, tools = {}, {}, {}, {}
    for name in sorted(files):
        parts = PurePosixPath(name)
        if parts.is_absolute() or '..' in parts.parts or '\\' in name or ':' in name:
            raise ValueError('Unsafe SDK inventory path: ' + name)
        if name.endswith('.d.ts'):
            declarations[name] = hashlib.sha256(read(name)).hexdigest()
        if name.endswith(('.wasm', '.dll', '.so', '.dylib')):
            native[name] = hashlib.sha256(read(name)).hexdigest()
        if name in PROTECTED_NAMES or name.startswith(('LICENSES/', 'engine/sim/physics/notices/')):
            protected[name] = hashlib.sha256(read(name)).hexdigest()
        if name in {'bundle_engine.py', 'requirements-sdk.txt'} or name.startswith(('bundler/', 'sdk/')) and name.endswith(('.py', '.json')):
            tools[name] = hashlib.sha256(read(name)).hexdigest()
    return {'version': manifest['version'], 'profile': manifest['profile'],
            'entrypoints': entries, 'namespaces': manifest['bundle'].get('public_namespaces', []),
            'exports': source_exports(list(entries), read, parse), 'declarations': declarations,
            'native': native, 'protected': protected, 'tools': manifest.get('tools', {}),
            'toolSources': tools, 'files': len(files) + 1,
            'bytes': sum(item['bytes'] for item in files.values()) + len(read('manifest.json')),
            'runtimeDecodedBytes': manifest['bundle'].get('browser_runtime_decoded_bytes'),
            'runtimeCompressedBytes': manifest['bundle'].get('browser_runtime_bytes')}


def verify_acceptance_proofs(explanations: dict, after: dict, context: dict, root: Path) -> dict:
    """Protected-byte changes need matching acceptance, never a reason-only waiver."""
    accepted = {}
    for identity, explanation in explanations.items():
        field, separator, name = identity.partition(':')
        if field not in {'declarations', 'native', 'protected'} or not separator:
            continue
        if not isinstance(explanation, dict) or not isinstance(explanation.get('proof'), dict):
            continue
        proof = explanation['proof']
        expected = after[field].get(name)
        if proof.get('kind') == 'current':
            path = (root / str(proof.get('report', ''))).resolve()
            if not path.is_relative_to(root.resolve()) or not path.is_file():
                raise ValueError('Acceptance proof report is missing or outside checkout')
            raw = path.read_bytes()
            if hashlib.sha256(raw).hexdigest() != proof.get('reportSha256'):
                raise ValueError('Acceptance proof report digest differs')
            report = json.loads(raw)
            if aggregate({'acceptance': report})['status'] != 'PASS':
                raise ValueError('Acceptance proof is not current passing unchanged evidence')
            bound = report['context']
            if (any(bound.get(key) != context.get(key) for key in ('repository', 'commit', 'recipe', 'sdk'))
                    or report.get('testedPackage') != (context.get('candidate') or context['sdk'])
                    or proof.get('fileSha256') != expected):
                raise ValueError('Acceptance proof does not match the changed SDK and file bytes')
            accepted[identity] = {'kind': 'current', 'reportSha256': proof['reportSha256'], 'fileSha256': expected,
                                  'commit': bound['commit']}
        elif proof.get('kind') == 'historical':
            baseline_commit = subprocess.check_output(['git', 'rev-parse', BASELINE + '^{commit}'], cwd=root, text=True, timeout=30).strip()
            commit = proof.get('commit')
            if commit not in {baseline_commit, ACCEPTED_DISTRIBUTION_COMMIT}:
                raise ValueError('Historical proof must use a pinned accepted release or distribution commit')
            raw = subprocess.check_output(['git', 'show', commit + ':SDK-VALIDATION.json'], cwd=root, timeout=30)
            if hashlib.sha256(raw).hexdigest() != proof.get('reportSha256'):
                raise ValueError('Historical acceptance receipt digest differs')
            receipt = json.loads(raw)
            manifest_raw = subprocess.check_output(['git', 'show', commit + ':engine-sdk/manifest.json'], cwd=root, timeout=30)
            manifest = json.loads(manifest_raw)
            if (receipt.get('status') != 'PASS' or receipt.get('repository') != context['repository']
                    or receipt.get('EngineSDK', {}).get('sdkReceiptSha256') != hashlib.sha256(manifest_raw).hexdigest()
                    or manifest['files'].get(name, {}).get('sha256') != expected
                    or proof.get('fileSha256') != expected):
                raise ValueError('Historical acceptance does not pin the exact current protected bytes')
            accepted[identity] = {'kind': 'historical', 'commit': commit, 'reportSha256': proof['reportSha256'],
                                  'fileSha256': expected, 'scope': 'Prior accepted bytes; current execution remains required'}
    return accepted


def compare(before: dict, after: dict, explanations: dict | None = None,
            acceptance_proofs: dict | None = None) -> dict:
    explanations = explanations or {}
    acceptance_proofs = acceptance_proofs or {}
    guards, changes = [], []

    def guard(identity, detail, *, protected=False):
        reason = explanations.get(identity)
        if isinstance(reason, dict):
            reason = reason.get('reason')
        justified = isinstance(reason, str) and bool(reason.strip())
        proof = acceptance_proofs.get(identity)
        if protected:
            justified = justified and isinstance(proof, dict) and proof.get('fileSha256') == detail['after']
        guards.append({'name': identity, 'status': 'PASS' if justified else 'FAIL',
                       'detail': detail, 'explanation': reason if justified else None,
                       **({'acceptance': proof if justified else None} if protected else {})})

    for field in ('entrypoints', 'namespaces', 'exports', 'declarations', 'native', 'protected', 'tools', 'toolSources'):
        if before[field] != after[field]:
            changes.append({'field': field, 'before': before[field], 'after': after[field]})
    for entry, symbols in before['exports'].items():
        removed = sorted(set(symbols) - set(after['exports'].get(entry, [])))
        if removed:
            guard('exports:' + entry, {'removed': removed})
    for field in ('entrypoints', 'namespaces'):
        if before[field] != after[field]:
            guard(field, 'Public entrypoint or namespace contract changed')
    for field in ('declarations', 'native', 'protected'):
        for name in sorted(set(before[field]) | set(after[field])):
            if before[field].get(name) != after[field].get(name):
                guard(field + ':' + name, {'before': before[field].get(name), 'after': after[field].get(name)}, protected=True)
    for name in sorted(set(before['toolSources']) - set(after['toolSources'])):
        guard('toolSources:' + name, 'Shipped build or SDK tool was removed')
    if before['version'] != after['version']:
        guard('version', 'SDK version changed independently of explicit future release planning')
    if before['profile'] != after['profile']:
        guard('profile', 'SDK profile changed')
    checks = guards or [{'name': 'Public APIs and protected release inputs preserved', 'status': 'PASS'}]
    return {'schema': 'particle-sdk-change-report/v1', 'status': 'FAIL' if any(row['status'] != 'PASS' for row in checks) else 'PASS',
            'checks': checks, 'changes': changes,
            'metrics': {name: {'before': before[name], 'after': after[name],
                               'delta': after[name] - before[name] if type(before[name]) is int and type(after[name]) is int else None}
                        for name in ('files', 'bytes', 'runtimeDecodedBytes', 'runtimeCompressedBytes')},
            'scope': 'Tokenized source public export names, declaration/native/license identities, tool configuration and recorded size/count changes; not a full semantic API proof.'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk', type=Path, default=ROOT / 'engine-sdk')
    parser.add_argument('--baseline', default=BASELINE)
    parser.add_argument('--explanations', type=Path, help='Reviewed exact guard-name to explanation mapping')
    parser.add_argument('--output', type=Path, default=ROOT / 'test-results/changes.json')
    args = parser.parse_args(argv)
    if args.output.resolve().is_relative_to((ROOT / 'engine-sdk').resolve()) or args.output.resolve().is_relative_to(args.sdk.resolve()):
        parser.error('--output must be outside immutable SDK directories')
    report = {'schema': 'particle-sdk-change-report/v1', 'status': 'FAIL'}
    candidate = args.sdk.resolve() if args.sdk.resolve() != (ROOT / 'engine-sdk').resolve() else None
    context = None
    try:
        if args.baseline != BASELINE:
            raise ValueError('Released compatibility baseline must remain ' + BASELINE)
        context = capture(ROOT, candidate=candidate)
        parse = load_parser(ROOT / 'engine-sdk')
        cache = {}

        def read_baseline(name):
            parts = PurePosixPath(name)
            if parts.is_absolute() or '..' in parts.parts:
                raise ValueError('Unsafe baseline SDK path')
            if name not in cache:
                cache[name] = subprocess.check_output(['git', 'show', BASELINE + ':engine-sdk/' + name], cwd=ROOT, timeout=60)
            return cache[name]

        old_manifest = json.loads(read_baseline('manifest.json'))
        new_manifest = json.loads((args.sdk / 'manifest.json').read_text(encoding='utf-8'))
        before = snapshot(old_manifest, read_baseline, parse)
        after = snapshot(new_manifest, lambda name: (args.sdk / name).read_bytes(), parse)
        explanations = json.loads(args.explanations.read_text(encoding='utf-8')) if args.explanations else {}
        if not isinstance(explanations, dict):
            raise ValueError('Change explanations must be an object')
        proofs = verify_acceptance_proofs(explanations, after, context, ROOT)
        report = compare(before, after, explanations, proofs)
        report['baseline'] = {'tag': BASELINE, 'commit': subprocess.check_output(['git', 'rev-parse', BASELINE + '^{commit}'], cwd=ROOT, text=True, timeout=30).strip(),
                              'manifestSha256': hashlib.sha256(read_baseline('manifest.json')).hexdigest()}
        report['testedPackage'] = context['candidate'] or context['sdk']
    except (OSError, ValueError, subprocess.SubprocessError, ImportError, KeyError, TypeError) as error:
        report.update(status='FAIL', error=str(error))
    finally:
        if context is not None:
            report['context'] = context
            report['identityVerification'] = verify_finish(context, ROOT, candidate=candidate)
            if report['identityVerification']['status'] != 'PASS':
                report['status'] = 'FAIL'
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print('[changes] ' + report['status'])
    return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
