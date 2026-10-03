# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Verify the published SDK and Template using their existing integrity contracts."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import stat
import sys
import time
from urllib.parse import unquote, urlsplit
import zipfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SDK = ROOT / 'engine-sdk'
sys.path.insert(0, str(SDK))
from bundler.sdk import verify_sdk
from bundler.site import _verify_release_runtime_gzip


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def verify_template():
    path = ROOT / 'Template.zip'
    released = json.loads((ROOT / 'SDK-VALIDATION.json').read_text(encoding='utf-8'))['Template.zip']
    if path.stat().st_size != released['bytes'] or digest(path) != released['sha256']:
        raise ValueError('Template.zip differs from its published validation record')
    with zipfile.ZipFile(path) as archive:
        names = set()
        for item in archive.infolist():
            name = item.filename
            parts = PurePosixPath(name)
            if (name in names or not name.startswith('Template/') or parts.is_absolute()
                    or '..' in parts.parts or '\\' in name or ':' in name
                    or stat.S_ISLNK(item.external_attr >> 16)):
                raise ValueError('Unsafe or duplicate Template archive member: ' + name)
            if not item.is_dir():
                names.add(name)
        receipt = json.loads(archive.read('Template/template-manifest.json'))
        if receipt.get('format') != 'particle-template-manifest/v1' or receipt.get('profile') != 'runtime-only':
            raise ValueError('Unsupported Template inventory')
        expected = {'Template/' + name for name in receipt['files']} | {'Template/template-manifest.json'}
        if names != expected:
            raise ValueError('Template archive membership differs from its inventory')
        for name, record in receipt['files'].items():
            with archive.open('Template/' + name) as stream:
                observed = hashlib.file_digest(stream, 'sha256').hexdigest()
            if observed != record['sha256'] or archive.getinfo('Template/' + name).file_size != record['bytes']:
                raise ValueError('Template member integrity mismatch: ' + name)
        runtimes = [name for name in names if name.endswith('.min.js.gz')]
        native = [name for name in names if name.endswith('/physx-pe.wasm')]
        if len(runtimes) != 1 or native != ['Template/assets/physx-pe.wasm']:
            raise ValueError('Template must contain one Platform runtime and one PhysX PE WASM')
        runtime = receipt['runtime']
        compressed = archive.read(runtimes[0])
        if len(compressed) != runtime['compressed_bytes']:
            raise ValueError('Template runtime compressed byte count differs')
        _verify_release_runtime_gzip(compressed, runtime['integrity'], runtime['decoded_bytes'])
        if runtime['integrity'] != released['runtimeSRI']:
            raise ValueError('Template runtime differs from the published SRI')
        manifest = json.loads(archive.read('Template/assets/particle-platform.manifest.json'))
        if manifest['browser_runtime_integrity'] != runtime['integrity']:
            raise ValueError('Template runtime manifest differs from its inventory')
        provenance = archive.read('Template/assets/' + manifest['provenance']['path'])
        if hashlib.sha256(provenance).hexdigest() != manifest['provenance']['sha256']:
            raise ValueError('Template provenance differs from its manifest')
        if set(receipt['modes']) != {'canvas', 'plauna', 'os'}:
            raise ValueError('Template launcher mode inventory changed')
        return {'files': len(names), 'bytes': path.stat().st_size, 'sha256': released['sha256'],
                'runtimeSRI': runtime['integrity'], 'platformRuntimes': 1, 'physxPeWasmCopies': 1}


def verify_navigation():
    documents = SDK / 'MD'
    navigation = json.loads((documents / '_config/nav.json').read_text(encoding='utf-8'))
    paths = []

    def walk(value):
        if isinstance(value, dict):
            if isinstance(value.get('path'), str):
                paths.append(value['path'])
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    walk(navigation)
    paths.append(navigation['site']['home'])
    for name in paths:
        candidate = (documents / unquote(urlsplit(name).path)).resolve()
        if not candidate.is_relative_to(documents.resolve()) or not candidate.is_file():
            raise ValueError('Documentation navigation target is absent: ' + name)
    checked = 0
    for document in [ROOT / 'README.md', ROOT / 'ci/README.md']:
        body = document.read_text(encoding='utf-8')
        links = re.findall(r'\]\(([^\s)]+)\)|(?:href|src)="([^\"]+)"', body)
        for markdown, html in links:
            link = markdown or html
            parsed = urlsplit(link)
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            target = (document.parent / unquote(parsed.path)).resolve()
            if not target.is_relative_to(ROOT) or not target.exists():
                raise ValueError(f'Broken repository documentation link in {document.name}: {link}')
            checked += 1
    return {'navigationDocuments': len(set(paths)), 'repositoryLinks': checked}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'test-results/distribution.json')
    args = parser.parse_args(argv)
    report = {'schema': 'particle-sdk-ci-distribution/v1', 'status': 'RUNNING',
              'commit': os.environ.get('GITHUB_SHA'), 'python': platform.python_version(),
              'platform': platform.system(), 'checks': []}
    started = time.monotonic()

    def check(name, operation):
        print('[distribution] ' + name, flush=True)
        result = {'name': name, 'status': 'RUNNING'}
        report['checks'].append(result)
        try:
            result['details'] = operation()
            result['status'] = 'PASS'
        except Exception as error:
            result.update(status='FAIL', error=str(error))
            raise

    def sdk_check():
        receipt = verify_sdk(SDK)
        accepted = json.loads((ROOT / 'SDK-VALIDATION.json').read_text(encoding='utf-8'))['EngineSDK']
        if digest(SDK / 'manifest.json') != accepted['sdkReceiptSha256']:
            raise ValueError('SDK inventory differs from the release validation identity')
        return {'files': len(receipt['files']) + 1, 'profile': receipt['profile'],
                'publicNamespaces': receipt['bundle']['public_namespaces'],
                'runtimeSRI': receipt['bundle']['browser_runtime_integrity'],
                'receiptSha256': accepted['sdkReceiptSha256']}

    try:
        check('SDK inventory, source graph, native assets, compression and provenance', sdk_check)
        check('Template archive inventory, runtime integrity and provenance', verify_template)
        check('Offline documentation navigation and repository links', verify_navigation)
        report['status'] = 'PASS'
    except Exception as error:
        report.update(status='FAIL', error=str(error))
    finally:
        report['elapsedSeconds'] = round(time.monotonic() - started, 3)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(report, indent=2), flush=True)
    return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
