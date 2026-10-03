# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Export the approved existing CPU assertions and validate their SDK closure.

The original development tests remain the assertion source of truth. Exporting
adapts module resolution and completion reporting, never their assertion bodies.
The public browser controller runs the resulting exact case inventory in both
runtime modes; compiled resolution has no source-import fallback.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import tempfile

PROFILE_SCHEMA = 'particle-sdk-public-tests/v1'
JS_HEADER = '// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>\n// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha\n\n'
CASE_PATTERN = re.compile(r"(?:test|check)\(\s*'([^']+)'")
IMPORT_PATTERN = re.compile(r"import\s+(\*\s+as\s+\w+|\{[^}]+\})\s+from\s+['\"]\.\./([^'\"]+)['\"];", re.S)
SPECS = (
    ('plauna-button', 'test_plauna_button_browser.py', 7, 'button'),
    ('plauna-surface', 'plauna-surface-manager.test.js', 6, 'surface'),
    ('plauna-workbench', 'plauna-workbench-lifecycle.test.js', 3, 'workbench'),
    ('strict-json', 'strict-json-value.test.js', 9, 'strict'),
    ('rig-public', 'rig-public-api.test.js', 2, 'rig'),
    ('engine-persistence', 'engine-durable-persistence.html', 8, 'persistence'),
    ('particle-cohorts', 'particle-cohort-planner.test.js', 15, 'registered'),
    ('particle-codec', 'particle-kinematics-state-codec.test.js', 7, 'registered'),
    ('complex-fft', 'complex-fft.test.js', 7, 'fft'),
)


def _safe(root, name):
    if (not isinstance(name, str) or not name or '\\' in name
            or PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts):
        raise ValueError('Unsafe public-test path: ' + repr(name))
    path = root.joinpath(*PurePosixPath(name).parts)
    if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('Public-test path escapes its SDK: ' + name)
    return path


def validate_result(suite, mode, result):
    """Fail closed on skipped, missing, duplicated or unfinished CPU cases."""
    expected = suite['expectedCases'][mode]
    cases = result.get('cases', [])
    identities = [row.get('id') for row in cases]
    if not expected or len(set(expected)) != len(expected):
        raise ValueError('Empty or duplicate expected case inventory')
    if len(identities) != len(expected) or set(identities) != set(expected):
        raise ValueError(f"Case inventory mismatch for {suite['id']}/{mode}: {identities!r}")
    if len(set(identities)) != len(identities):
        raise ValueError('Duplicate executed cases')
    if result.get('status') != 'PASS' or result.get('cleanup', {}).get('status') != 'passed':
        raise ValueError('Suite failed or cleanup did not finish')
    for row in cases:
        if row.get('status') != 'PASS' or not row.get('checks') or any(
                check.get('passed') is not True for check in row['checks']):
            raise ValueError('A required case failed, skipped or executed no assertions: ' + str(row.get('id')))


def _approved_catalog(repository, registry_path):
    """Bind catalog admission to the exact reviewed original assertion bytes."""
    payload = registry_path.read_bytes()
    document = json.loads(payload.decode('utf-8-sig'))
    declaration = document.get('publicSdk', {})
    entries = declaration.get('suites', [])
    if (declaration.get('schema') != 'particle-sdk-public-test-eligibility/v1'
            or declaration.get('profiles') != ['engine-plauna-cpu']
            or not isinstance(entries, list)):
        raise ValueError('Unsupported canonical public SDK test eligibility')
    admitted = {entry['id']: entry for entry in entries if entry.get('eligible') is True}
    if len(admitted) != len(entries) or set(admitted) != {spec[0] for spec in SPECS}:
        raise ValueError('The canonical catalog does not admit the exact required public SDK suites')
    origins = {}
    for identity, name, _count, adapter in SPECS:
        policy = admitted[identity]
        sources = ['tests/' + name]
        if adapter == 'rig':
            sources.append('tests/rig-public-api.bundle.test.js')
        pins = policy.get('assertionOriginsSha256')
        if policy.get('sourcePaths') != sources or not isinstance(pins, dict) or set(pins) != set(sources):
            raise ValueError('Canonical SDK assertion origin inventory changed: ' + identity)
        for name in sources:
            actual = hashlib.sha256(_safe(repository, name).read_bytes()).hexdigest()
            if not isinstance(pins[name], str) or not re.fullmatch(r'[0-9a-f]{64}', pins[name]) or pins[name] != actual:
                raise ValueError('Canonical SDK assertion origin differs from its approved pin: ' + name)
            origins[name] = actual
    return payload, admitted, origins


def _validate_canonical_profile(repository, profile):
    """Canonical builds prove that delivered adaptations still match originals.

    Extracted SDKs intentionally omit this catalog and the development fixtures;
    their descriptor and distribution receipt bind the delivered tests instead.
    """
    catalog = repository / 'tools/testing_platform/suites.json'
    if not catalog.exists():
        return None
    payload, _admitted, origins = _approved_catalog(repository, catalog)
    if profile.get('canonicalCatalogSha256') != hashlib.sha256(payload).hexdigest():
        raise ValueError('Public SDK test profile has a stale canonical catalog identity')
    if profile.get('assertionOriginsSha256') != origins:
        raise ValueError('Public SDK test profile has stale assertion origin identities')
    with tempfile.TemporaryDirectory(prefix='sdk-public-assertion-verify-') as temporary:
        generated = Path(temporary)
        expected = export_public_profile(repository, generated, catalog)
        if profile['suites'] != expected['suites']:
            raise ValueError('Public SDK test profile differs from canonical suite contracts')
        actual_names = {name for name in profile['files'] if name.startswith('fixtures/') or name == 'button_contract.py'}
        if actual_names != set(expected['files']):
            raise ValueError('Public SDK generated assertion fixture inventory differs from canonical export')
        for name, record in expected['files'].items():
            current = _safe(repository / 'sdk/public_tests', name).read_bytes()
            if current != _safe(generated, name).read_bytes() or profile['files'].get(name) != record:
                raise ValueError('Public SDK generated assertion fixture differs from canonical export: ' + name)
    return {'canonicalCatalogSha256': hashlib.sha256(payload).hexdigest(), 'assertionOriginsSha256': origins}


def validate_public_profile(sdk_root, *, require_receipt=True):
    """Verify fixtures plus every required source and compiled module identity."""
    sdk_root = Path(sdk_root).resolve()
    base = sdk_root / 'sdk/public_tests'
    profile = json.loads((base / 'profile.json').read_text(encoding='utf-8'))
    if profile.get('schema') != PROFILE_SCHEMA or profile.get('modes') != ['source', 'compiled']:
        raise ValueError('Unsupported public SDK test profile')
    if profile.get('mounts') != ['/', '/ci-nested/'] or profile.get('expectedCasesPerMode') != sum(spec[2] for spec in SPECS):
        raise ValueError('Required hosting or expected case count changed')
    ids = [suite.get('id') for suite in profile.get('suites', [])]
    if ids != [spec[0] for spec in SPECS] or len(set(ids)) != len(ids):
        raise ValueError('Required SDK suites missing or duplicated')
    _validate_canonical_profile(sdk_root, profile)
    manifest = json.loads((sdk_root / 'manifest.json').read_text(encoding='utf-8')) if require_receipt else None
    compiled = set(manifest['bundle']['files']) if manifest else None
    if manifest is not None:
        for name in ('examples/compiled.html', 'examples/source-importmap.js', 'serve_sdk.py', 'sdk/public_tests.py'):
            payload = _safe(sdk_root, name).read_bytes()
            if manifest['files'].get(name) != {'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}:
                raise ValueError('Required SDK test support differs from its receipt: ' + name)
    dependencies = set()
    for suite in profile['suites']:
        count = next(spec[2] for spec in SPECS if spec[0] == suite['id'])
        if suite.get('expectedCount') != count:
            raise ValueError('Required suite case count changed: ' + suite['id'])
        if suite.get('eligible') is not True or suite.get('modes') != profile['modes']:
            raise ValueError('Required suite is not eligible in both SDK modes: ' + suite['id'])
        if not isinstance(suite.get('timeoutSeconds'), int) or not 1 <= suite['timeoutSeconds'] <= 180:
            raise ValueError('Invalid SDK suite timeout')
        for mode in profile['modes']:
            names = suite['expectedCases'][mode]
            if not names or len(names) != suite['expectedCount'] or len(set(names)) != len(names):
                raise ValueError('Invalid expected case identity inventory')
        for module in suite['requiredModules']:
            if not module.startswith(('engine/', 'plauna/')) or not _safe(sdk_root, module).is_file():
                raise ValueError('Required SDK module is absent: ' + module)
            if compiled is not None and module not in compiled:
                raise ValueError('Required compiled SDK module is absent: ' + module)
            if manifest is not None:
                payload = _safe(sdk_root, module).read_bytes()
                expected = {'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}
                if manifest['files'].get(module) != expected:
                    raise ValueError('Required SDK module differs from its receipt: ' + module)
            dependencies.add(module)
    for name, expected in profile['files'].items():
        path = _safe(base, name)
        payload = path.read_bytes()
        if len(payload) != expected['bytes'] or hashlib.sha256(payload).hexdigest() != expected['sha256']:
            raise ValueError('Public SDK test fixture changed: ' + name)
        if manifest is not None:
            relative = path.relative_to(sdk_root).as_posix()
            if manifest['files'].get(relative) != expected:
                raise ValueError('SDK receipt does not bind public test input: ' + relative)
    if manifest is not None:
        payload = (base / 'profile.json').read_bytes()
        record = manifest['files'].get('sdk/public_tests/profile.json')
        if record != {'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}:
            raise ValueError('SDK receipt does not bind the test profile')
    return profile


def _imports(source):
    modules = []
    def rewrite(match):
        binding, path = match.groups()
        modules.append(path)
        if binding.startswith('*'):
            return f"const {binding.split()[-1]} = await resolveModule({json.dumps(path)});"
        exports = [part.strip().split(' as ')[0] for part in binding[1:-1].split(',') if part.strip()]
        destructure = re.sub(r'\s+as\s+', ': ', binding)
        return f"const {destructure} = await resolveModule({json.dumps(path)}, {json.dumps(exports)});"
    lines = source.splitlines(keepends=True)
    while lines and (not lines[0].strip() or lines[0].strip() == '//'
                     or lines[0].lstrip().startswith('// SPDX-')):
        lines.pop(0)
    return JS_HEADER + "import { resolveModule, sourceUrl, finishSuite } from '../resolver.js';\n" + IMPORT_PATTERN.sub(rewrite, ''.join(lines)), modules


def export_public_profile(repository, destination, registry=None):
    """Adapt reviewed fixtures; retain original SHA identities for audit."""
    repository, destination = Path(repository).resolve(), Path(destination).resolve()
    registry_path = Path(registry).resolve() if registry else repository / 'tools/testing_platform/suites.json'
    registry_payload, admitted, approved_origins = _approved_catalog(repository, registry_path)
    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'fixtures').mkdir(exist_ok=True)
    suites, origins = [], {}
    for identity, name, count, adapter in SPECS:
        policy = admitted[identity]
        if policy.get('modes') != ['source', 'compiled'] or policy.get('expectedCount') != count:
            raise ValueError('Canonical SDK eligibility or expected case count changed: ' + identity)
        original = repository / 'tests' / name
        payload = original.read_bytes()
        source = payload.decode('utf-8-sig')
        origins['tests/' + name] = hashlib.sha256(payload).hexdigest()
        scope = 'CPU JavaScript and DOM behavior; no native GPU rendering'
        if adapter == 'button':
            tree = ast.parse(source)
            harness = next(ast.literal_eval(node.value) for node in tree.body
                if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'HARNESS' for target in node.targets))
            harness = harness[harness.index('let defaults ='):]
            harness = JS_HEADER + "import { resolveModule } from '../resolver.js';\nconst { Button } = await resolveModule('plauna/widgets/Primitive/Button.js', ['Button']);\nconst { DOMRenderer } = await resolveModule('plauna/core/DOMRenderer.js', ['DOMRenderer']);\n" + harness
            (destination / 'fixtures/button.js').write_text(harness, encoding='utf-8', newline='\n')
            cls = next(node for node in tree.body if isinstance(node, ast.ClassDef))
            methods = [node for node in cls.body if isinstance(node, ast.FunctionDef)
                and (node.name.startswith('test_') or node.name == 'check_mouse_cancellation')]
            lines = source.splitlines(keepends=True)
            code = '# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>\n# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha\nfrom unittest import TestCase\n\nclass PublicButtonContracts(TestCase):\n    modes = ("source", "compiled")\n'
            for method in methods:
                code += ''.join(lines[method.lineno - 1:method.end_lineno]).replace('for mode in ("source", "compiled"):', 'for mode in self.modes:') + '\n\n'
            (destination / 'button_contract.py').write_text(code, encoding='utf-8', newline='\n')
            names = [method.name for method in methods if method.name.startswith('test_')]
            modules = ['plauna/widgets/Primitive/Button.js', 'plauna/core/DOMRenderer.js']
            fixture = 'fixtures/button.js'
        else:
            if adapter == 'persistence':
                source = source.split('<script type="module">', 1)[1].split('</script>', 1)[0]
                source = source[:source.index('    const passCount =')]
                source += "\nexport const suiteResult = finishSuite('engine-persistence', results.map(row => ({name:row.name, passed:row.pass, error:row.error})));\n"
            elif adapter == 'workbench':
                source = source[:source.index('const passed = tests.filter')]
                source += "\nexport const suiteResult = finishSuite('plauna-workbench', tests);\n"
            elif adapter == 'rig':
                for mode, filename in [('source', name), ('compiled', 'rig-public-api.bundle.test.js')]:
                    rig_original = repository / 'tests' / filename
                    rig_payload = rig_original.read_bytes()
                    origins['tests/' + filename] = hashlib.sha256(rig_payload).hexdigest()
                    rig_source = rig_payload.decode('utf-8-sig')
                    rig_source = rig_source[:rig_source.index('results.textContent = `${passes.map', rig_source.index("await test('public") if mode == 'source' else rig_source.index("await test('compiled PE.Rig"))]
                    start = rig_source.index('async function test(')
                    end = rig_source.index("await test('", start)
                    rig_source = rig_source[:start] + "const rows = [];\nasync function test(name, operation) {\n try { await operation(); rows.push({name, passed:true}); }\n catch (error) { rows.push({name, passed:false, error:String(error?.stack || error)}); }\n}\n\n" + rig_source[end:]
                    rig_source += "\nexport const suiteResult = finishSuite('rig-public', rows);\n"
                    if mode == 'compiled':
                        rig_source = rig_source.replace('const PE = globalThis.PE;', 'const PE = await compiledRuntime();')
                    rewritten, rig_modules = _imports(rig_source)
                    rewritten = rewritten.replace("sourceUrl, finishSuite", "sourceUrl, finishSuite, compiledRuntime")
                    (destination / f'fixtures/rig-{mode}.js').write_text(rewritten, encoding='utf-8', newline='\n')
                    if mode == 'source':
                        names = CASE_PATTERN.findall(rig_source)
                        modules = rig_modules
                    else:
                        compiled_names = CASE_PATTERN.findall(rig_source)
                fixture = 'fixtures/rig-{mode}.js'
            elif adapter == 'registered':
                footer = 'for (const entry of cases)' if identity == 'particle-cohorts' else 'for (const { name, operation } of cases)'
                source = source[:source.index(footer)]
                source += f"\nconst rows = [];\nfor (const entry of cases) {{\n try {{ await entry.operation(); rows.push({{name:entry.name, passed:true}}); }}\n catch (error) {{ rows.push({{name:entry.name, passed:false, error:String(error?.stack || error)}}); }}\n}}\nexport const suiteResult = finishSuite('{identity}', rows);\n"
            elif adapter == 'surface':
                names = re.findall(r"checks.push\('([^']+)'\)", source)
                source = source.replace('    await verifyBoundsIdsUpdatesAndHitTesting(checks);\n    await verifyGpuAndRendererLifecycle(checks);',
                    "    try {\n        await verifyBoundsIdsUpdatesAndHitTesting(checks);\n        await verifyGpuAndRendererLifecycle(checks);\n    } catch (error) { return {passed:false, checks, error:String(error?.stack || error)}; }")
                source += "\nconst result = await runPlaunaSurfaceManagerTests();\n"
                source += 'const expectedNames = ' + json.dumps(names) + ';\n'
                source += "export const suiteResult = finishSuite('plauna-surface', expectedNames.map((name, index) => ({name, passed:result.checks.includes(name), status:result.checks.includes(name) ? 'PASS' : index===result.checks.length ? 'FAIL' : 'NOT_RUN', error:result.error})));\n"
            elif adapter == 'strict':
                source += "\nconst result = runStrictJsonValueChecks();\nexport const suiteResult = finishSuite('strict-json', result.rows.map(row => ({name:row.name, passed:row.status==='PASS', error:row.error, detail:row.detail})));\n"
            elif adapter == 'fft':
                source = source.replace("fetch('../engine/sim/particles/ParticleMeshEwald.js')", "fetch(sourceUrl('engine/sim/particles/ParticleMeshEwald.js'))")
                source += "\nconst result = await runTests({gpu:false});\nexport const suiteResult = finishSuite('complex-fft', result.checks.map(row => ({name:row.name, passed:row.ok, error:row.error, detail:row.detail, evidence:row.name.startsWith('PME imports') ? 'source-contract' : row.name.startsWith('Plans') || row.name.startsWith('Borrowed') || row.name.startsWith('PME wrapper') ? 'controlled-resource-contract' : 'CPU numerical execution'})));\n"
                scope = 'CPU numerical execution, controlled resource-ownership contracts, and source contract; no native GPU execution'
            if adapter != 'rig':
                rewritten, modules = _imports(source)
                (destination / f'fixtures/{identity}.js').write_text(rewritten, encoding='utf-8', newline='\n')
                fixture = f'fixtures/{identity}.js'
                names = re.findall(r"checks.push\('([^']+)'\)", source) if adapter == 'surface' else CASE_PATTERN.findall(source)
                if adapter == 'fft':
                    names = [name for name in names if name != 'Native GPU FFT and PME parity suite']
            if len(names) != count:
                raise ValueError(f'Fixture case count changed: {identity}: expected {count}, received {len(names)}')
        ids = [identity + ':' + name for name in names]
        expected_modes = {'source': ids, 'compiled': [identity + ':' + name for name in compiled_names] if adapter == 'rig' else ids}
        if policy.get('expectedCases') != expected_modes or policy.get('requiredModules') != modules:
            raise ValueError('Canonical SDK assertion/module inventory changed: ' + identity)
        suites.append({'id': identity, 'eligible': True, 'modes': ['source', 'compiled'],
            'requiredModules': modules, 'fixture': fixture, 'expectedCount': count,
            'expectedCases': expected_modes,
            'timeoutSeconds': 180 if adapter in ('persistence', 'button') else 90, 'scope': scope})
    if origins != approved_origins:
        raise ValueError('Canonical assertion inputs changed during public SDK export')
    _approved_catalog(repository, registry_path)
    if registry_path.read_bytes() != registry_payload:
        raise ValueError('Canonical SDK eligibility changed during public SDK export')
    files = {}
    for path in sorted(destination.rglob('*')):
        if path.is_file() and path.name != 'profile.json' and '__pycache__' not in path.parts:
            payload = path.read_bytes()
            files[path.relative_to(destination).as_posix()] = {'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}
    profile = {'schema': PROFILE_SCHEMA, 'modes': ['source', 'compiled'], 'mounts': ['/', '/ci-nested/'],
        'expectedCasesPerMode': sum(suite['expectedCount'] for suite in suites),
        'canonicalCatalogSha256': hashlib.sha256(registry_payload).hexdigest(),
        'assertionOriginsSha256': origins, 'suites': suites, 'files': files}
    (destination / 'profile.json').write_text(json.dumps(profile, indent=2) + '\n', encoding='utf-8', newline='\n')
    return profile


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--export-root', type=Path)
    parser.add_argument('--destination', type=Path)
    parser.add_argument('--sdk', type=Path)
    parser.add_argument('--registry', type=Path, help='Explicit canonical eligibility catalog while preparing isolated changes')
    args = parser.parse_args(argv)
    if args.export_root and args.destination and not args.sdk:
        profile = export_public_profile(args.export_root, args.destination, args.registry)
    elif args.sdk and not args.export_root and not args.destination:
        profile = validate_public_profile(args.sdk)
    else:
        parser.error('Use --sdk or both --export-root and --destination')
    print(json.dumps({'status': 'PASS', 'suites': len(profile['suites']), 'casesPerMode': profile['expectedCasesPerMode']}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
