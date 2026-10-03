# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Portable aggregation of immutable, separately executed combined baseline proofs.

This gate does not emulate the obsolete workbench upgrade command. Individual
CPU, Engine, SPH and Flow validators still qualify each execution. Its source
snapshot describes admission reads; each retained witness describes execution.
"""
import hashlib
import json

from .flow_combined import _canonical, _physical_hashes
from .physics import SDK_VERSION, UPSTREAM_COMMIT, _section_exact, _section_require

ROLES = frozenset(('candidate', 'unified', 'stress', 'authoring', 'engine', 'sph',
    'host', 'scene', 'geometry', 'collision', 'solid', 'scalar', 'fault',
    'modules', 'pipelines', 'addons'))
BASELINE_EXECUTIONS = frozenset(('candidate', 'unified', 'stress', 'authoring', 'engine', 'sph'))
BASELINE_ROLES = {
    'candidate-browser.json': 'candidate', 'unified-browser.json': 'unified',
    'blast-stress-browser.json': 'stress', 'blast-authoring-browser.json': 'authoring',
    'engine-acceptance.json': 'engine', 'sph-playground-verified.json': 'sph',
    'flow-host-browser.json': 'host', 'flow-scene-browser.json': 'scene',
    'flow-geometry-browser.json': 'geometry', 'flow-collision-browser.json': 'collision',
    'flow-wgsl-modules.json': 'modules', 'flow-wgsl-selected-pipelines.json': 'pipelines',
}
SCOPE = ('Immutable same-pair baseline proof aggregation; no old verify_upgrade execution, '
         'release or real-time certification.')
ADMISSION_SCOPE = 'Input read/recheck only; execution is recorded by retained per-role witnesses.'
INPUT_FIELDS = ('sourceHashes', 'servedSourceHashes', 'engineSourceHashes',
                'servedEngineHashes', 'servedRuntimeHashes')
FAULT_CASES = ('ordered-same-buffer-and-rollover', 'source-snapshot-survives-heap-growth',
    'empty-flush-and-zero-length-upload', 'oversize-chunk-snapshot', 'upload-rejection-disposal',
    'gpu-validation-disposal', 'fault-injection-submit-disposal',
    'fault-injection-onSubmittedWorkDone-disposal', 'texture-pool-2d-array-float',
    'texture-pool-2d-array-uint', 'texture-pool-3d-float', 'texture-pool-3d-uint',
    'fault-injection-texture-reset-disposal',
    'texture-cache-budget-preserves-oversized-native-allocations',
    'lazy-texture-consumers-and-unused-scratch', 'lazy-texture-create-failure-cleanup', 'cleanup')
FAULT_SCOPE = ('Unchanged existing fault oracle/assertions; same selected host used for unused '
               'baseline import, differential disabled')
FAULT_ORACLE_SHA256 = '87699c404e52d894ffa52fe42d03dd12b5a018aacb3c56e26fc5c1dd645ba4ea'


def _retained(raw, reference, label):
    _section_require(isinstance(reference, dict) and set(reference) == {'path', 'sha256', 'bytes'}
        and isinstance(reference['path'], str) and reference['path']
        and type(reference['bytes']) is int and reference['bytes'] > 0
        and type(raw) is bytes and len(raw) == reference['bytes']
        and hashlib.sha256(raw).hexdigest() == reference['sha256'],
        'combined baseline original bytes differ: ' + label)
    _canonical(reference['path'])
    parsed = json.loads(raw)
    _section_require(isinstance(parsed, dict), 'combined baseline original JSON must be an object: ' + label)
    return parsed


def raw_input_hashes(proof):
    """Keep each recorded alias distinct until its physical mapping is checked."""
    result = {}
    for field in INPUT_FIELDS:
        hashes = proof.get(field, {})
        _section_require(isinstance(hashes, dict) and all(isinstance(name, str) and name
            and isinstance(digest, str) and len(digest) == 64
            and all(c in '0123456789abcdef' for c in digest) for name, digest in hashes.items()),
            'combined baseline malformed raw input map: ' + field)
        result.update({field + ':' + name: digest for name, digest in hashes.items()})
    return result


def _fault_execution(raw, witness, root, build, record, admission_sources):
    """Admit the retained adapter's real fields without inventing exit booleans."""
    argv = witness.get('argv')
    _section_require(witness.get('scope') == FAULT_SCOPE and isinstance(argv, list) and len(argv) == 9
        and argv[1:4] == ['--unified', '--primitives-only', '--repo']
        and argv[5] == '--baseline' and argv[7] == '--report'
        and _canonical(argv[0]) == root + '/addons/flow/upload_staging_browser_test.py'
        and _canonical(argv[6]) == root + '/addons/flow/flow_host_webgpu.mjs'
        and _canonical(argv[8]) == _canonical(record['raw']['path']),
        'combined baseline fault adapter command changed')
    _canonical(argv[4])
    result = raw.get('result', {})
    cases = result.get('cases', [])
    _section_require(raw.get('status') == 'PASS' and raw.get('unified') is True
        and raw.get('artifactHashes') == {name: row['sha256'] for name, row in build['artifacts'].items()}
        and raw.get('sourceHashes') == raw.get('sourceHashesAfter') and bool(raw.get('sourceHashes'))
        and all(raw.get(name) == [] for name in ('pageErrors', 'consoleErrors', 'gpuErrors'))
        and result.get('status') == result.get('cleanup') == 'PASS'
        and isinstance(cases, list) and len(cases) == len(FAULT_CASES)
        and [row.get('name') for row in cases] == list(FAULT_CASES)
        and all(row.get('status') == 'PASS' for row in cases)
        and type(cases[-1].get('nativeContexts')) is int and cases[-1]['nativeContexts'] == 0,
        'combined baseline fault execution or ownership failed')
    routes = witness.get('supplementalRoutes', {})
    expected = {'/addons/flow/upload_staging_oracle.mjs': FAULT_ORACLE_SHA256,
        '/flow_solid_boundary.mjs': build['sources'].get('addons/flow/flow_solid_boundary.mjs'),
        '/flow_scalar_sources.mjs': build['sources'].get('addons/flow/flow_scalar_sources.mjs')}
    _section_require(isinstance(routes, dict) and set(routes) == set(expected)
        and witness.get('servedSupplementalHashes') == expected,
        'combined baseline fault supplemental routes changed')
    for route, digest in expected.items():
        row = routes[route]
        _section_require(isinstance(row, dict) and set(row) == {'path', 'sha256'}
            and row['sha256'] == digest and admission_sources.get(_canonical(row['path'])) == digest,
            'combined baseline fault supplemental bytes changed: ' + route)


def verify_combined_baseline_aggregate(proof, artifacts, build, *, raw_bytes, raw_sha256,
                                      build_sha256, receipts, witnesses, source_build=None):
    """Bind all sixteen raw executions to their original witnesses and one pair.

Receipts and witnesses are original JSON bytes. No filesystem read, status
translation, source-map merging or receipt reconstruction occurs here.
"""
    if source_build is not None:
        from .source_build_baseline import verify_source_build_baseline_aggregate
        _section_require(isinstance(source_build, dict)
            and set(source_build) == {'retained_files', 'retained_index'},
            'unknown source-build aggregate inputs')
        return verify_source_build_baseline_aggregate(proof, artifacts, build,
            raw_bytes=raw_bytes, raw_sha256=raw_sha256, build_sha256=build_sha256,
            receipts=receipts, witnesses=witnesses, **source_build)
    _section_require(isinstance(proof, dict) and isinstance(build, dict) and isinstance(artifacts, dict)
        and isinstance(receipts, dict) and isinstance(witnesses, dict) and type(raw_bytes) is bytes
        and hashlib.sha256(raw_bytes).hexdigest() == raw_sha256
        and _section_exact(json.loads(raw_bytes), proof), 'combined baseline aggregate bytes changed')
    _section_require(proof.get('schema') == 'combined-baseline-proofs/v1'
        and proof.get('status') == 'COMBINED_BASELINE_PROOFS_PASSED'
        and proof.get('scope') == SCOPE and proof.get('admissionScope') == ADMISSION_SCOPE
        and proof.get('releaseApproved') is False,
        'unsupported combined baseline aggregate scope')
    identity = proof.get('build', {})
    _section_require(isinstance(identity, dict) and isinstance(identity.get('manifest'), dict)
        and identity.get('sourceVersion') == SDK_VERSION
        and identity.get('upstreamTag') == 'ovphysx-0.6.3'
        and identity.get('upstreamCommit') == UPSTREAM_COMMIT
        and identity.get('manifest', {}).get('sha256') == build_sha256
        and _section_exact(identity.get('artifacts'), artifacts)
        and _section_exact(build.get('artifacts'), artifacts)
        and set(artifacts) == {'physx-pe.mjs', 'physx-pe.wasm'},
        'combined baseline compiled identity differs')
    _canonical(identity['manifest'].get('path'))
    _section_require(type(identity['manifest'].get('bytes')) is int and identity['manifest']['bytes'] > 0
        and build.get('status') == 'COMPILED_NOT_RUNTIME_TESTED' and build.get('sourceUnchanged') is True
        and isinstance(build.get('sources'), dict) and bool(build['sources'])
        and build['sources'] == build.get('sourcesBefore') == build.get('sourcesAfter')
        and all(isinstance(row, dict) and type(row.get('bytes')) is int and row['bytes'] > 0
            and isinstance(row.get('sha256'), str) and len(row['sha256']) == 64
            and all(c in '0123456789abcdef' for c in row['sha256']) for row in artifacts.values()),
        'combined baseline build is not a stable compiled pair')
    records = proof.get('proofs', {})
    mappings = proof.get('inputFiles', {})
    _section_require(isinstance(records, dict) and isinstance(mappings, dict)
        and set(records) == set(receipts) == set(witnesses) == set(mappings) == ROLES,
        'combined baseline missing or unknown execution role')
    admission_sources = _physical_hashes(proof.get('sourceHashes'))
    _section_require(proof.get('sourceUnchanged') is True
        and proof.get('sourceHashes') == proof.get('sourceHashesAfter')
        and proof.get('toolSources') == proof.get('toolSourcesAfter'),
        'combined baseline admission inputs changed')
    tools = _physical_hashes(proof.get('toolSources'))
    _section_require(all(admission_sources.get(name) == digest for name, digest in tools.items()),
        'combined baseline admission tool closure is missing')
    root = _canonical(build.get('sourceRoot'))
    required = {root + '/' + name: digest for name, digest in build.get('sources', {}).items()}
    required[root + '/dist/candidate/build-manifest.json'] = build_sha256
    required.update({root + '/dist/candidate/' + name: row['sha256'] for name, row in artifacts.items()})
    _section_require(bool(build.get('sources')) and all(admission_sources.get(name) == digest
        for name, digest in required.items()), 'combined baseline admission omits selected build inputs')
    parsed, seen = {}, {}
    for role in ROLES:
        record = records[role]
        _section_require(isinstance(record, dict) and set(record) == {'raw', 'witness', 'rawStatus'},
            'malformed combined baseline execution reference: ' + role)
        raw = _retained(receipts[role], record['raw'], role + ' raw')
        witness = _retained(witnesses[role], record['witness'], role + ' witness')
        schema = witness.get('schema')
        expected_reference = record['raw'] if schema == 'combined-baseline-proof-witness/v1' else {
            name: record['raw'][name] for name in ('path', 'sha256')}
        expected_schema = ('combined-baseline-proof-witness/v1' if role in BASELINE_EXECUTIONS
            else 'combined-flow-fault-adapter-witness/v1' if role == 'fault' else 'combined-flow-proof-witness/v1')
        expected_lock = ('Original runner shared lock; before/after complete closure spans queue' if role == 'fault'
            else 'existing runner execution; full before/after closure spans queue'
            if role in ('scene', 'geometry', 'collision', 'solid', 'scalar')
            else 'Original runner lock; complete source/pair admission before queue and after execution'
            if role in ('stress', 'authoring', 'engine') else 'parent admission/execution/recheck')
        _section_require(schema == expected_schema and witness.get('lockScope') == expected_lock
            and witness.get('status') == 'PASS'
            and witness.get('buildManifestSha256') == build_sha256
            and _section_exact(witness.get('artifacts'), artifacts)
            and witness.get('rawStatus') == record['rawStatus'] == raw.get('status')
            and _section_exact(witness.get('rawReport'), expected_reference),
            'combined baseline role did not execute its selected bytes: ' + role)
        if role == 'fault':
            _fault_execution(raw, witness, root, build, record, admission_sources)
        else:
            _section_require(witness.get('role') == role and type(witness.get('exitCode')) is int
                and witness['exitCode'] == 0 and witness.get('nativeExecution'
                    if schema == 'combined-baseline-proof-witness/v1' else 'runtimeExecuted') is True,
                'combined baseline execution was not native: ' + role)
        hashes = _physical_hashes(witness.get('sourceHashes'))
        _section_require(witness.get('sourceUnchanged') is True
            and witness.get('sourceHashes') == witness.get('sourceHashesAfter')
            and all(hashes.get(name) == digest for name, digest in required.items()),
            'combined baseline execution source closure changed: ' + role)
        if schema == 'combined-flow-proof-witness/v1':
            _section_require(witness.get('tools') == witness.get('toolsAfter'),
                'combined baseline Flow execution tools changed: ' + role)
            execution_tools = _physical_hashes(witness.get('tools'))
            _section_require(all(admission_sources.get(name) == digest
                for name, digest in execution_tools.items()),
                'combined baseline Flow execution tools changed before admission: ' + role)
        for name, digest in hashes.items():
            _section_require(name not in seen or seen[name] == digest,
                'combined baseline executions used conflicting source bytes: ' + name)
            _section_require(admission_sources.get(name) == digest,
                'combined baseline execution input changed before admission: ' + name)
            seen[name] = digest
        inputs = raw_input_hashes(raw)
        _section_require(isinstance(mappings[role], dict) and set(mappings[role]) == set(inputs),
            'combined baseline omitted or invented raw input aliases: ' + role)
        for name, digest in inputs.items():
            _section_require(admission_sources.get(_canonical(mappings[role][name])) == digest,
                'combined baseline raw input changed before admission: ' + role + ' ' + name)
        parsed[role] = raw
    return parsed
