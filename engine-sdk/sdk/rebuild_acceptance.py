# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Portable offline rebuilding proof for extracted SDKs and release CI.

Run ``python -B -m sdk.rebuild_acceptance --sdk . --output ../rebuild-results``
after explicitly installing requirements-sdk.txt, Playwright and Chromium.
Every edit and build occurs in a temporary copy outside the supplied SDK.
"""
from __future__ import annotations

import argparse
from functools import partial
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import zipfile

def extract_sdk(source, destination, *, required_manifest='manifest.json'):
    """Copy SDK Git files or extract an archive, refusing linked inputs."""
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if source.is_dir():
        if not (source / required_manifest).is_file():
            raise ValueError(f'SDK directory must contain {required_manifest}')
        if destination.is_relative_to(source):
            raise ValueError('SDK acceptance copy must be outside its source directory')
        for directory, names, files in os.walk(source, followlinks=False):
            for name in names + files:
                path = Path(directory) / name
                if (path.is_symlink() or path.is_junction()
                        or not path.resolve().is_relative_to(source)):
                    raise ValueError(f'SDK directory contains a linked input: {path.relative_to(source)}')
        shutil.copytree(source, destination)
        return None
    if not source.is_file():
        raise ValueError(f'SDK archive is missing: {source}')
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(source) as archive:
        seen = set()
        for item in archive.infolist():
            name = item.filename
            relative = PurePosixPath(name)
            if (name in seen or relative.is_absolute() or '..' in relative.parts
                    or '\\' in name or ':' in name or not relative.parts):
                raise ValueError(f'Unsafe or duplicate SDK archive member: {name}')
            if stat.S_ISLNK(item.external_attr >> 16):
                raise ValueError(f'SDK archive contains a symbolic link: {name}')
            seen.add(name)
        if archive.testzip() is not None:
            raise ValueError('SDK archive has a corrupt member')
        archive.extractall(destination)
    if not (destination / required_manifest).is_file():
        raise ValueError(f'Archive must contain {required_manifest} at its root')
    return source



def runtime_hashes(sdk):
    receipt = json.loads((Path(sdk) / 'manifest.json').read_text(encoding='utf-8'))
    stem = receipt['bundle']['name']
    return {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted((Path(sdk) / 'dist').iterdir())
            if path.is_file() and (path.name == stem + '.js' or path.name.startswith(stem + '.min.js'))}


_OFFLINE_NETWORK = '''import ipaddress, socket, threading, os, subprocess, sys
sys.dont_write_bytecode = True
_socket_connect = socket.socket.connect
_socketpair = socket.socketpair
_socketpair_scope = threading.local()

def offline(*args, **kwargs):
    raise RuntimeError('SDK acceptance: Python network access is blocked')

def offline_connect(connection, address):
    # Windows implements asyncio's self-pipe using a TCP socketpair. Permit
    # its numeric loopback connect only inside this thread's socketpair call.
    if getattr(_socketpair_scope, 'active', False) and isinstance(address, tuple) and len(address) in (2, 4):
        try:
            host = ipaddress.ip_address(address[0]) if isinstance(address[0], str) else None
        except ValueError:
            host = None
        if host is not None and host.is_loopback:
            return _socket_connect(connection, address)
    return offline()

def offline_socketpair(*args, **kwargs):
    previous = getattr(_socketpair_scope, 'active', False)
    _socketpair_scope.active = True
    try:
        return _socketpair(*args, **kwargs)
    finally:
        _socketpair_scope.active = previous

socket.socket.connect = offline_connect
socket.socket.connect_ex = offline
socket.create_connection = offline
socket.socketpair = offline_socketpair

def network_audit(event, arguments):
    if event in ('socket.connect', 'socket.sendto', 'socket.sendmsg', 'socket.getaddrinfo', 'socket.gethostbyname'):
        if event == 'socket.connect' and getattr(_socketpair_scope, 'active', False):
            return
        offline()
    if event in ('os.system', 'os.exec', 'os.posix_spawn', 'os.spawn'):
        raise PermissionError('SDK acceptance: unguarded subprocess launch is blocked')

sys.addaudithook(network_audit)
# Documentation tools are child Python processes. Propagate the same guard
# rather than letting subprocesses regain network access. Native compilers and
# Git are unavailable in this isolated rebuild; docs already handle no Git.
_popen = subprocess.Popen

def guarded_python_source(program):
    return ('_guard_source = ' + repr(_guard_source) + '\\n' + _guard_source
            + '\\n' + program)

def guarded_command(command, kwargs):
    from pathlib import Path
    if kwargs.get('shell') or not isinstance(command, (list, tuple)) or len(command) < 2:
        raise PermissionError('SDK acceptance: only guarded Python script subprocesses are allowed')
    if Path(command[0]).resolve() != Path(sys.executable).resolve():
        # Playwright's installed pipe driver is required by the existing final
        # JavaScript parse gate. It loads a local throw-first syntax harness;
        # it is not a native compiler or a dependency downloader.
        try:
            from playwright._impl._driver import compute_driver_executable
            node, driver = compute_driver_executable()
            expected = [str(node), str(driver), 'run-driver']
        except ImportError:
            expected = []
        if list(map(str, command)) == expected:
            return command
        raise PermissionError('SDK acceptance: native tools and unapproved subprocesses are blocked')
    if str(command[1]).startswith('-'):
        raise PermissionError('SDK acceptance: child Python must name a script')
    script = str(Path(command[1]).resolve())
    arguments = [script, *map(str, command[2:])]
    program = ('import runpy; sys.argv = ' + repr(arguments)
               + '; sys.path.insert(0, ' + repr(str(Path(script).parent)) + ')'
               + '; runpy.run_path(' + repr(script) + ', run_name="__main__")')
    return [sys.executable, '-I', '-c', guarded_python_source(program)]

class OfflinePopen(_popen):
    # Preserve the Popen class contract: Windows asyncio subclasses it for
    # pipe-based Playwright transport without any external socket access.
    def __init__(self, command, *args, **kwargs):
        super().__init__(guarded_command(command, kwargs), *args, **kwargs)

subprocess.Popen = OfflinePopen

# Windows multiprocessing starts fresh interpreters with _winapi.CreateProcess,
# bypassing subprocess.Popen. Preserve its spawn protocol and normal process
# compression, but install this same guard before a worker imports build code.
import multiprocessing.spawn as _spawn
_spawn_command_line = _spawn.get_command_line

def guarded_spawn_command_line(**kwargs):
    import base64
    command = _spawn_command_line(**kwargs)
    if '-c' not in command or command[-1] != '--multiprocessing-fork':
        raise PermissionError('SDK acceptance: unsupported unguarded multiprocessing spawn')
    source_index = command.index('-c') + 1
    # multiprocessing's Windows launcher adds quotes without escaping quotes
    # inside the program. Encode the complete bootstrap so its source survives
    # that command line byte-for-byte, including child-subprocess handling.
    program = guarded_python_source(command[source_index]).encode('utf-8')
    encoded = base64.b64encode(program).decode('ascii')
    command[source_index] = "import base64; exec(base64.b64decode('" + encoded + "'))"
    return command

_spawn.get_command_line = guarded_spawn_command_line
'''

_OFFLINE_BOOTSTRAP = '_guard_source = ' + repr(_OFFLINE_NETWORK) + '\n' + _OFFLINE_NETWORK
_OFFLINE_REBUILD = _OFFLINE_BOOTSTRAP + '''import os, runpy, sys
sys.path.insert(0, os.getcwd())
sys.argv = ['bundle_engine.py', '--sdk-rebuild', '--sdk-no-archive', '--no-cache']
runpy.run_path('bundle_engine.py', run_name='__main__')
'''


def _offline_environment():
    environment = {name: value for name, value in os.environ.items()
                   if not any(marker in name.upper() for marker in ('SIGNING', 'PRIVATE_KEY', 'PYTHONPATH'))}
    environment.update(PYTHONNOUSERSITE='1', PYTHONDONTWRITEBYTECODE='1', PIP_NO_INDEX='1',
                       SOURCE_DATE_EPOCH='1780272000')
    return environment


def _rebuild(sdk, output, label, timeout, environment):
    print(f'[SDK acceptance] rebuilding {label}', flush=True)
    try:
        completed = subprocess.run([sys.executable, '-I', '-c', _OFFLINE_REBUILD], cwd=sdk,
                                   env=environment, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        def readable(value):
            return value.decode('utf-8', errors='replace') if isinstance(value, bytes) else (value or '')
        (output / f'rebuild-{label}.log').write_text(
            readable(error.stdout) + readable(error.stderr) + f'\nTIMEOUT after {timeout}s\n', encoding='utf-8')
        raise
    (output / f'rebuild-{label}.log').write_text(completed.stdout + completed.stderr, encoding='utf-8')
    if completed.returncode:
        raise AssertionError(f'Independent SDK rebuild {label} failed; see rebuild-{label}.log')


def negative_acceptance(sdk, output, timeout=120):
    """Reject damaged real inputs through the same offline CLI preflight."""
    descriptor = json.loads((sdk / 'sdk-build.json').read_text(encoding='utf-8'))
    source = sdk / 'engine/core/math/MathVec3.js'
    native = next((sdk / relative for relative in descriptor['immutable'] if relative.endswith('.wasm')), None)
    if native is None:
        raise AssertionError('SDK native rejection requires an inventoried WASM asset')
    cases = [('missing-source', source, None, 'Missing SDK build input'),
             ('corrupt-native', native, native.read_bytes() + b'tamper', 'immutable input hash/length mismatch')]
    registry = descriptor.get('officialRegistry')
    if registry:
        registry_path = sdk / registry
        records = json.loads(registry_path.read_bytes())
        cases.append(('corrupt-signed-registry', registry_path, registry_path.read_bytes() + b'tamper',
                      'immutable input hash/length mismatch'))
        owner = next((sdk / name for name in descriptor['signedOwners'] if name.endswith('.js')), None)
        if owner is None:
            raise AssertionError('Platform SDK has no signed-owner source to verify')
        cases.append(('changed-signed-owner', owner, owner.read_bytes() + b'\n// changed owner\n', 'signed'))
    results = []
    for name, path, replacement, expected in cases:
        original = path.read_bytes()
        try:
            if replacement is None:
                path.unlink()
            else:
                path.write_bytes(replacement)
            completed = subprocess.run([sys.executable, '-I', '-c', _OFFLINE_REBUILD], cwd=sdk,
                                       env=_offline_environment(), capture_output=True, text=True, timeout=timeout)
            diagnostics = completed.stdout + completed.stderr
            (output / f'reject-{name}.log').write_text(diagnostics, encoding='utf-8')
            if completed.returncode == 0 or expected not in diagnostics:
                raise AssertionError(f'{name} did not fail at the expected preflight: {diagnostics[-2000:]}')
            if (sdk / 'build').exists():
                raise AssertionError(f'{name} wrote rebuild outputs before rejecting its inputs')
            results.append({'name': name, 'status': 'PASS', 'rejected': True, 'diagnostic': expected})
        finally:
            path.write_bytes(original)
    if registry:
        # Exercise cryptographic validity independently of the outer inventory
        # hash, so a repaired receipt cannot hide invalid or expired signatures.
        from bundler.sdk_rebuild import _expanded_registry
        from bundler.signing import _load_ring0_roots, verify_official_package_records
        from datetime import datetime, timedelta, timezone
        import copy
        records, _, _ = _expanded_registry(records, sdk)
        roots = _load_ring0_roots(sdk)
        evidence = verify_official_package_records(records, roots)
        damaged = copy.deepcopy(records)
        signature = next(iter(damaged.values()))['envelope']['signature']
        signature['sig'] = ('A' if signature['sig'][0] != 'A' else 'B') + signature['sig'][1:]
        expiry = max(datetime.fromisoformat(value['certificateNotAfter'].replace('Z', '+00:00'))
                     for value in evidence.values()) + timedelta(seconds=1)
        for name, candidate, moment, expected in (
                ('invalid-signature', damaged, datetime.now(timezone.utc), 'publisher signature is invalid'),
                ('expired-signature', records, expiry, 'outside its validity window')):
            try:
                verify_official_package_records(candidate, roots, verification_time=moment)
            except RuntimeError as error:
                if expected not in str(error):
                    raise
                results.append({'name': name, 'status': 'PASS', 'rejected': True, 'diagnostic': str(error)})
            else:
                raise AssertionError(f'{name} was accepted')
    else:
        results.append({'name': 'signed-packages', 'status': 'NOT_APPLICABLE',
                        'reason': 'Engine SDK does not contain a Platform signed-package registry'})
    return results


def cpu_probe(browser, sdk, output):
    """Execute the changed function through the generated compiled loader."""
    from sdk.server import SDKHTTPServer, SDKRequestHandler
    diagnostics = {'pageErrors': [], 'consoleErrors': [], 'httpErrors': [], 'externalRequests': []}
    handler = partial(SDKRequestHandler, directory=str(sdk), isolate=True)
    server = SDKHTTPServer(('127.0.0.1', 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    context = browser.new_context(service_workers='block')
    try:
        def admit(route):
            if route.request.url.startswith(origin + '/') or route.request.url.startswith(('blob:', 'data:')):
                route.continue_()
            else:
                diagnostics['externalRequests'].append(route.request.url)
                route.abort('blockedbyclient')
        context.route('**/*', admit)
        page = context.new_page()
        page.on('pageerror', lambda error: diagnostics['pageErrors'].append(str(error)))
        page.on('console', lambda message: diagnostics['consoleErrors'].append(message.text)
                if message.type == 'error' else None)
        page.on('response', lambda response: diagnostics['httpErrors'].append(response.url)
                if response.status >= 400 else None)
        page.goto(origin + '/index.html', wait_until='domcontentloaded')
        observed = page.evaluate('''async () => {
            if (!globalThis.__PE_RUNTIME_READY?.then) throw new Error('Compiled loader readiness is absent');
            const api = await globalThis.__PE_RUNTIME_READY;
            return api.vec3(2, 3, 4);
        }''')
        if observed != [3, 3, 4] or any(diagnostics.values()):
            raise AssertionError(f'Changed compiled function failed: {observed}, {diagnostics}')
        page.screenshot(path=str(output / 'rebuild-source-change.png'))
        return {'status': 'PASS', 'input': [2, 3, 4], 'expected': [3, 3, 4],
                'observed': observed, 'diagnostics': diagnostics}
    finally:
        context.close()
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def rebuild_acceptance(sdk, output, browser, timeout, *, syntax_browser=None):
    """Build only from extracted inputs, retaining complete stdout per attempt."""
    from bundler.sdk import verify_sdk
    sdk = Path(sdk).resolve()
    receipt = json.loads((sdk / 'manifest.json').read_text(encoding='utf-8'))
    profile = receipt['profile']
    descriptor = sdk / 'sdk-build.json'
    if not descriptor.is_file():
        raise ValueError('Rebuild descriptor is missing')
    if any(path.is_file() for path in sdk.rglob('*') if path.suffix.lower() in {'.pem', '.key'}):
        raise ValueError('Private key material entered the SDK')
    if (sdk / 'build').exists():
        raise ValueError('Rebuild acceptance requires a fresh extracted SDK without prior build outputs')
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    environment = _offline_environment()
    if syntax_browser:
        environment['PARTICLE_JS_SYNTAX_BROWSER'] = str(Path(syntax_browser).resolve())
    negatives = negative_acceptance(sdk, output)
    rebuilt = sdk / 'build' / f'{profile}-sdk'
    runs = []
    inventories = []
    for index in (1, 2):
        _rebuild(sdk, output, index, timeout, environment)
        if list(rebuilt.parent.glob('particle-*-sdk.zip')):
            raise AssertionError('Directory-only SDK rebuilding created an unexpected SDK archive')
        candidate = verify_sdk(rebuilt)
        runs.append(runtime_hashes(rebuilt))
        records = dict(candidate['files'])
        manifest_bytes = (rebuilt / 'manifest.json').read_bytes()
        records['manifest.json'] = {'bytes': len(manifest_bytes),
                                    'sha256': hashlib.sha256(manifest_bytes).hexdigest()}
        inventories.append(records)
        (output / f'rebuild-{index}-manifest.json').write_bytes(manifest_bytes)
        if index == 1:
            # The second build starts without any previous runtime or package
            # outputs, not merely a cache-disabled overwrite of the first.
            build = (sdk / 'build').resolve()
            if build.parent != sdk or build.is_symlink():
                raise ValueError('Refusing to remove rebuild outputs outside the temporary SDK')
            shutil.rmtree(build)
    (output / 'rebuild-identities.json').write_text(
        json.dumps({'runtimeHashes': runs, 'directoryFiles': [len(records) for records in inventories]}, indent=2)
        + '\n', encoding='utf-8')
    if not runs[0] or runs[0] != runs[1]:
        raise AssertionError('Two pinned independent rebuilds produced different runtime bytes')
    if inventories[0] != inventories[1]:
        differences = {'added': sorted(set(inventories[1]) - set(inventories[0])),
                       'removed': sorted(set(inventories[0]) - set(inventories[1])),
                       'changed': sorted(name for name in set(inventories[0]) & set(inventories[1])
                                         if inventories[0][name] != inventories[1][name])}
        (output / 'rebuild-directory-differences.json').write_text(
            json.dumps(differences, indent=2) + '\n', encoding='utf-8')
        raise AssertionError('Two pinned independent rebuilds produced different SDK directories; '
                             'see rebuild-directory-differences.json and per-run manifests')
    source = sdk / 'engine/core/math/MathVec3.js'
    original_bytes = source.read_bytes()
    original = original_bytes.decode('utf-8')
    before = 'export const vec3 = (x = 0, y = 0, z = 0) => [x, y, z];'
    after = 'export const vec3 = (x = 0, y = 0, z = 0) => [x + 1, y, z];'
    if original.count(before) != 1:
        raise AssertionError('Authored CPU mutation witness no longer matches the shipped vec3 source')
    try:
        source.write_bytes(original.replace(before, after, 1).encode('utf-8'))
        _rebuild(sdk, output, 'modified', timeout, environment)
        verify_sdk(rebuilt)
        changed = runtime_hashes(rebuilt)
        if changed == runs[1]:
            raise AssertionError('Authored source change did not change rebuilt runtime bytes')
        probe = cpu_probe(browser, rebuilt, output)
    finally:
        source.write_bytes(original_bytes)
    return {'status': 'PASS', 'runtimeHashes': runs, 'directoryFiles': len(inventories[0]),
            'changedRuntimeHashes': changed, 'rejectionChecks': negatives,
            'cpuProbe': probe, 'privateKeysPresent': False, 'pythonNetworkAccess': 'blocked',
            'pythonSubprocessNetworkAccess': 'blocked', 'sdkArchivesCreated': False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--output', type=Path, required=True, help='Evidence directory, outside the input SDK')
    parser.add_argument('--browser', help='Installed Chromium executable; defaults to Playwright Chromium')
    parser.add_argument('--rebuild-timeout', type=int, default=1800, help='Seconds per offline build')
    args = parser.parse_args(argv)
    source, output = args.sdk.resolve(), args.output.resolve()
    if output.is_relative_to(source):
        parser.error('--output must be outside the input SDK')
    output.mkdir(parents=True, exist_ok=True)
    report = {'schema': 'particle-sdk-rebuild-acceptance/v1', 'status': 'RUNNING',
              'commit': os.environ.get('GITHUB_SHA'), 'checks': []}
    started = time.monotonic()
    try:
        from bundler.sdk import verify_sdk
        from playwright.sync_api import sync_playwright
        with tempfile.TemporaryDirectory(prefix='particle-sdk-rebuild-') as temporary:
            extracted = Path(temporary) / 'sdk'
            if extracted.resolve().is_relative_to(source):
                raise ValueError('Temporary rebuild must be outside its source')
            extract_sdk(source, extracted)
            receipt = verify_sdk(extracted)
            report.update(profile=receipt['profile'], sdkReceiptSha256=hashlib.sha256(
                (extracted / 'manifest.json').read_bytes()).hexdigest())
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(executable_path=args.browser, headless=True,
                                                     args=['--disable-background-networking'])
                try:
                    report['browserVersion'] = browser.version
                    report['rebuild'] = rebuild_acceptance(
                        extracted, output, browser, args.rebuild_timeout,
                        syntax_browser=args.browser or playwright.chromium.executable_path)
                finally:
                    browser.close()
        report['status'] = 'PASS'
        report['checks'] = [{'name': 'Offline deterministic rebuild and executed source change', 'status': 'PASS'}]
    except Exception as error:
        report.update(status='FAIL', error=str(error), errorType=type(error).__name__)
    finally:
        report['elapsedSeconds'] = round(time.monotonic() - started, 3)
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))
    return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
