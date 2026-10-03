# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Portable source-build execution identity, supplementary to numerical gates.

Original SDK records and execution witnesses keep their own schemas. The
sixteen returned raw reports still need all existing numerical, ownership,
source and performance checks. This module never opens a producer path.
"""
import ast
from datetime import datetime
import json

from .combined_baseline import (ADMISSION_SCOPE, BASELINE_EXECUTIONS, FAULT_CASES,
    FAULT_ORACLE_SHA256, ROLES, SCOPE, _retained, raw_input_hashes)
from .combined_native import hash_map, metadata, require, sha
from .physics import SDK_VERSION, UPSTREAM_COMMIT, _section_exact
from .source_build_context import (Retained, canonical, interval, joined,
    physical_key, verify_descriptor, verify_source_build)

SCHEMA = 'physx-pe.source-build-baseline-proofs/v1'
STATUS = 'SOURCE_BUILD_BASELINE_PROOFS_PASSED'
BASELINE_SCOPE = 'Original baseline program with explicit source-build metadata; no release or real-time admission'
FLOW_SCOPE = 'Original native Flow programs with explicit source-build provenance; no release or real-time admission'
PARENT_LOCK_ROLES = frozenset(('candidate', 'unified', 'sph', 'host', 'modules', 'pipelines', 'addons'))
EXPECTED_STATUS = {role: 'PASS' for role in ROLES}
EXPECTED_STATUS.update(candidate='SMOKE_PASSED_NOT_RELEASE_CERTIFIED',
    unified='UNIFIED_PHYSX_BLAST_FLOW_BROWSER_PASSED',
    sph='SPH_PLAYGROUND_PORT_INTEGRATION_PASSED', modules='FLOW_WGSL_MODULES_PASSED',
    pipelines='SELECTED_FLOW_WGSL_CHECKS_PASSED_INCOMPLETE_CORPUS')
STAGES = ('beforeQueue', 'afterLockAcquired', 'afterBrowserClosed')
ADAPTERS = {
    'source_build_runner_support.py': '5ffeda7d4e961adcee36556e81c295826c056d64953cdf35aab84fb55ee963b9',
    'run_source_build_baseline.py': '64c6547ae6dee30981648758f7ad8d216026ba3947393f34c8f77eb2cc20b5e8',
    'run_source_build_flow.py': '658d1eed7efad5205e8022e5e2c084844794fbbf5cfe6d13010526b96f083cd2',
    'source_build_solid_adapter.py': '4641bacbef82b9da71f20d848f5dee896b1a4f90ab9a526027311e0d084c3674',
}


def physical_hashes(value):
    """Reject duplicate Windows/WSL aliases, including case-only spellings."""
    require(hash_map(value) and value, 'source-build baseline missing physical source map')
    result = {}
    for name, digest in value.items():
        key = physical_key(name)
        require(key not in result, 'source-build baseline duplicate physical alias')
        result[key] = digest
    return result


def reference(read, row):
    require(isinstance(row, dict) and set(row) == {'path', 'sha256', 'bytes'}
        and type(row['bytes']) is int and row['bytes'] > 0, 'malformed source-build reference')
    return read.source(row['path'], {key: row[key] for key in ('sha256', 'bytes')})


def _evaluate_calls(body):
    text = body.decode('utf-8')
    calls = [(node.lineno, ast.get_source_segment(text, node)) for node in ast.walk(ast.parse(text))
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'evaluate']
    return [source for _, source in sorted(calls)]


def verify_transform(read, proof, admission):
    """Check retained adapter source, exact inverse and original browser bodies."""
    require(isinstance(proof, dict), 'missing source-build metadata transform')
    original = reference(read, proof['originalSource'])
    require(reference(read, proof['originalArchive']) == original, 'metadata original archive differs')
    adapted = reference(read, proof['adapter'])
    require(proof.get('originalSha256') == sha(original) and proof.get('adaptedSha256') == sha(adapted)
        and proof.get('inverseExact') is True and proof.get('evaluateCallsExact') is True,
        'metadata transform identity differs')
    restored = adapted
    for edit in reversed(proof.get('edits', [])):
        require(isinstance(edit, dict) and set(edit) == {'offset', 'before', 'after'}
            and type(edit['offset']) is int and edit['offset'] >= 0
            and isinstance(edit['before'], str) and isinstance(edit['after'], str), 'invalid metadata inverse window')
        at, old, new = edit['offset'], edit['before'].encode(), edit['after'].encode()
        require(new and old != new and restored[at:at + len(new)] == new, 'metadata inverse window differs')
        restored = restored[:at] + old + restored[at + len(new):]
    calls = _evaluate_calls(original)
    require(restored == original and calls == _evaluate_calls(adapted)
        and type(proof.get('evaluateCount')) is int and proof['evaluateCount'] == len(calls),
        'metadata adapter changed original oracle bytes')
    for field in ('originalSource', 'originalArchive', 'adapter'):
        row = proof[field]
        require(admission.get(physical_key(row['path'])) == row['sha256'],
            'metadata transform absent from actual execution closure')


def verify_execution_window(read, witness, descriptor, outer, sdk, descriptor_ref, required, *, seen_reads=None):
    """Admit the three actual reads, each with two independently retained children."""
    admission = witness.get('sourceBuildAdmission')
    expected = {'rawBuild': sdk, 'rawBuildSha256': read.index['roles']['sdkManifest']['sha256'],
        'executionDescriptor': descriptor, 'executionDescriptorPath': descriptor_ref['path'],
        'executionDescriptorSha256': descriptor_ref['sha256']}
    require(_section_exact(admission, expected), 'execution changed raw SDK or descriptor identity')
    require(type(witness.get('actualLockEntries')) is int and witness['actualLockEntries'] == 1,
        'execution did not enter exactly one real lock')
    hashes = physical_hashes(witness.get('sourceHashes'))
    require(witness.get('sourceUnchanged') is True
        and witness['sourceHashes'] == witness.get('sourceHashesAfter')
        and all(hashes.get(name) == digest for name, digest in required.items()),
        'execution source closure incomplete or changed')
    rows = witness.get('executionAdmissions')
    require(isinstance(rows, list) and len(rows) == 3 and [row.get('stage') for row in rows] == list(STAGES),
        'execution missing a queue/lock/closed-browser read')
    started, finished = interval(witness)
    observed = datetime.fromisoformat(descriptor['observedUtc'])
    require(observed.tzinfo is not None and observed <= started,
        'execution predates its actual configured observation')
    previous = started
    seen = set() if seen_reads is None else seen_reads
    seen.update(physical_key(row['path']) for row in descriptor['readWitnesses'])
    for row in rows:
        require(set(row) == {'stage', 'readUtc', 'executionReadWitnesses', 'sourceHashes'}
            and row['sourceHashes'] == witness['sourceHashes'], 'execution-stage closure differs')
        timestamp = datetime.fromisoformat(row['readUtc'])
        require(timestamp.tzinfo is not None and previous <= timestamp <= finished,
            'execution-stage timestamp is not ordered')
        refs = row['executionReadWitnesses']
        require(isinstance(refs, list) and len(refs) == 2, 'execution-stage pre/post read missing')
        # Reuse the original descriptor checks with explicit independent read refs;
        # neither original descriptor bytes nor its retained initial refs change.
        verify_descriptor(read, descriptor, outer, sdk, read_witnesses=refs)
        child_previous = previous
        for ref in refs:
            key = physical_key(ref['path'])
            require(key not in seen, 'execution reused a historical read witness')
            seen.add(key)
            child = json.loads(json.loads(reference(read, ref))['stdout'])
            first, last = interval(child)
            require(child_previous <= first <= last <= timestamp,
                'source-read child is outside its actual execution stage')
            child_previous = last
        previous = timestamp
    return hashes


def verify_fault(raw, witness, root, pair, sources, admission, read, raw_ref):
    """Use the new adapter's real fields; preserve all seventeen original cases."""
    argv = witness.get('originalRunnerArgv')
    require(isinstance(argv, list) and len(argv) == 9
        and canonical(argv[0]) == root + '/addons/flow/upload_staging_browser_test.py'
        and argv[1:3] == ['--unified', '--repo']
        and argv[4] == '--report' and canonical(argv[5]) == canonical(raw_ref['path'])
        and argv[6:8] == ['--primitives-only', '--baseline']
        and canonical(argv[8]) == root + '/addons/flow/flow_host_webgpu.mjs',
        'source-build fault original command differs')
    canonical(argv[3])
    result = raw.get('result', {})
    cases = result.get('cases', [])
    require(raw.get('status') == 'PASS' and raw.get('unified') is True
        and raw.get('artifactHashes') == pair
        and raw.get('sourceHashes') == raw.get('sourceHashesAfter') and raw.get('sourceHashes')
        and all(raw.get(name) == [] for name in ('pageErrors', 'consoleErrors', 'gpuErrors'))
        and result.get('status') == result.get('cleanup') == 'PASS'
        and isinstance(cases, list) and len(cases) == len(FAULT_CASES)
        and [row.get('name') for row in cases] == list(FAULT_CASES)
        and all(row.get('status') == 'PASS' for row in cases)
        and type(cases[-1].get('nativeContexts')) is int and cases[-1]['nativeContexts'] == 0,
        'source-build fault numerical/ownership coverage differs')
    expected = {'/addons/flow/upload_staging_oracle.mjs': FAULT_ORACLE_SHA256,
        '/flow_solid_boundary.mjs': sources['addons/flow/flow_solid_boundary.mjs'],
        '/flow_scalar_sources.mjs': sources['addons/flow/flow_scalar_sources.mjs']}
    routes = witness.get('supplementalRoutes')
    require(isinstance(routes, dict) and set(routes) == set(expected)
        and witness.get('servedSupplementalHashes') == expected, 'fault supplemental routing differs')
    for route, digest in expected.items():
        row = routes[route]
        require(sha(reference(read, row)) == digest
            and admission.get(physical_key(row['path'])) == digest, 'fault routed input is not retained/current')


def verify_source_build_baseline_aggregate(proof, artifacts, build, *, raw_bytes,
        raw_sha256, build_sha256, receipts, witnesses, retained_files, retained_index):
    """Return sixteen original reports only after complete source-build identity checks.

This is an aggregation check, not the remaining numerical gate or release
admission. All payloads are immutable inventoried bytes, including runtime and
original successful SDK10 evidence required by verify_source_build.
"""
    context = verify_source_build(retained_files, retained_index)
    read = Retained(retained_files, retained_index)
    descriptor = context.raw_json('executionDescriptor')
    outer, sdk = context.raw_json('parent'), context.raw_json('sdkManifest')
    descriptor_ref = read.index['roles']['executionDescriptor']
    require(type(raw_bytes) is bytes and sha(raw_bytes) == raw_sha256
        and _section_exact(json.loads(raw_bytes), proof), 'source-build aggregate raw bytes differ')
    require(proof.get('schema') == SCHEMA and proof.get('status') == STATUS
        and proof.get('scope') == SCOPE and proof.get('admissionScope') == ADMISSION_SCOPE
        and proof.get('releaseApproved') is False, 'unsupported source-build aggregate scope')
    expected_pair = {name: metadata(body) for name, body in context.runtime_artifacts.items()}
    require(set(expected_pair) == {'physx-pe.mjs', 'physx-pe.wasm'}
        and _section_exact(artifacts, expected_pair) and _section_exact(build, sdk)
        and build_sha256 == sha(context.original_records['sdkManifest']), 'source-build aggregate pair/producer differs')
    identity = proof.get('sourceBuild', {})
    require(set(identity) == {'manifest', 'executionDescriptor', 'sourceVersion', 'upstreamTag', 'upstreamCommit', 'artifacts'}
        and identity['manifest'] == read.index['roles']['sdkManifest']
        and identity['executionDescriptor'] == descriptor_ref
        and identity['sourceVersion'] == SDK_VERSION and identity['upstreamTag'] == 'ovphysx-0.6.3'
        and identity['upstreamCommit'] == UPSTREAM_COMMIT and identity['artifacts'] == expected_pair,
        'source-build aggregate lineage differs')
    records, mappings = proof.get('proofs'), proof.get('inputFiles')
    require(isinstance(records, dict) and isinstance(mappings, dict)
        and set(records) == set(mappings) == set(receipts) == set(witnesses) == ROLES,
        'source-build aggregate missing or unknown role')
    admission = physical_hashes(proof.get('sourceHashes'))
    tools = physical_hashes(proof.get('toolSources'))
    require(proof.get('sourceUnchanged') is True and proof['sourceHashes'] == proof.get('sourceHashesAfter')
        and proof['toolSources'] == proof.get('toolSourcesAfter')
        and all(admission.get(name) == digest for name, digest in tools.items()), 'aggregate admission inputs changed')
    # Physical observation inputs include actual SDK sources, compiler identities,
    # object/link inputs and all collector tools, not a guessed old build map.
    required = {physical_key(name): row['sha256'] for name, row in descriptor['physicalInputs'].items()}
    required[physical_key(descriptor_ref['path'])] = descriptor_ref['sha256']
    required.update({physical_key(row['path']): row['sha256'] for row in descriptor['readWitnesses']})
    require(all(admission.get(name) == digest for name, digest in required.items()),
        'aggregate admission omits actual compiled/source/tool inputs')
    for name, digest in admission.items():
        require(sha(read.source(name)) == digest, 'aggregate source not retained exactly')
    adapters = proof.get('executionAdapters')
    require(isinstance(adapters, dict) and set(adapters) == set(ADAPTERS), 'unknown or missing execution adapter')
    for name, digest in ADAPTERS.items():
        ref = adapters[name]
        require(canonical(ref['path']).rsplit('/', 1)[-1] == name
            and sha(reference(read, ref)) == digest
            and tools.get(physical_key(ref['path'])) == digest, 'execution adapter differs from reviewed source')
    root = canonical(outer['sourceRoot'])
    pair = {name: row['sha256'] for name, row in expected_pair.items()}
    parsed, seen, seen_reads = {}, {}, set()
    for role in sorted(ROLES):
        record = records[role]
        require(isinstance(record, dict) and set(record) == {'raw', 'witness', 'rawStatus'}, 'malformed execution ref')
        raw = _retained(receipts[role], record['raw'], role + ' raw')
        witness = _retained(witnesses[role], record['witness'], role + ' witness')
        require(reference(read, record['raw']) == receipts[role]
            and reference(read, record['witness']) == witnesses[role], 'execution raw bytes not retained')
        is_baseline = role in BASELINE_EXECUTIONS
        require(witness.get('schema') == ('physx-pe.source-build-baseline-witness/v1' if is_baseline
            else 'physx-pe.source-build-flow-witness/v1') and witness.get('status') == 'PASS'
            and witness.get('role') == role and witness.get('scope') == (BASELINE_SCOPE if is_baseline else FLOW_SCOPE)
            and witness.get('nativeExecution' if is_baseline else 'runtimeExecuted') is True
            and type(witness.get('exitCode')) is int and witness['exitCode'] == 0
            and witness.get('lockScope') == ('parent admission/execution/recheck' if role in PARENT_LOCK_ROLES
                else 'original runner with admission/recheck inside its lock')
            and witness.get('rawReport') == record['raw']
            and witness.get('rawStatus') == record['rawStatus'] == raw.get('status') == EXPECTED_STATUS[role],
            'source-build execution failed or changed scope: ' + role)
        hashes = verify_execution_window(read, witness, descriptor, outer, sdk, descriptor_ref, required, seen_reads=seen_reads)
        role_adapters = ('source_build_runner_support.py', 'run_source_build_baseline.py') if is_baseline else (
            'source_build_runner_support.py', 'run_source_build_flow.py', 'source_build_solid_adapter.py')
        require(all(hashes.get(physical_key(adapters[name]['path'])) == ADAPTERS[name]
            for name in role_adapters), 'execution omitted its original adapter source')
        for name, digest in hashes.items():
            require(admission.get(name) == digest and (name not in seen or seen[name] == digest),
                'execution source changed before admission: ' + name)
            seen[name] = digest
        transforms = [witness.get('metadataTransform')] if is_baseline else witness.get('metadataTransforms')
        require(isinstance(transforms, list) and len(transforms) == (1 if is_baseline
            or role in ('host', 'scene', 'geometry', 'collision', 'solid') else 0), 'missing/unknown metadata transform')
        for transform in transforms:
            verify_transform(read, transform, hashes)
        reference(read, witness['inputSourceArchive'])
        if is_baseline:
            reference(read, witness['executedSourceArchive'])
            served = witness.get('servedSourceHashes')
            paths = witness.get('servedPaths')
            require(hash_map(served) and served == witness.get('servedSourceHashesAfter')
                and isinstance(paths, dict) and set(paths) == set(served), 'baseline served closure changed')
            for alias, digest in served.items():
                require(admission.get(physical_key(paths[alias])) == digest, 'baseline served alias not current')
        if role == 'fault':
            verify_fault(raw, witness, root, pair, dict(context.source_hashes), admission, read, record['raw'])
        inputs = raw_input_hashes(raw)
        require(isinstance(mappings[role], dict) and set(mappings[role]) == set(inputs),
            'aggregate omitted or invented raw source aliases')
        for alias, digest in inputs.items():
            require(admission.get(physical_key(mappings[role][alias])) == digest, 'raw source alias not current')
        parsed[role] = raw
    return parsed
