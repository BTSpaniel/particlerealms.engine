# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Manufactured admission vectors only; no native, GPU or release execution."""
import copy
import unittest

from bundler.combined_baseline import (ADMISSION_SCOPE, BASELINE_EXECUTIONS, FAULT_CASES,
    FAULT_ORACLE_SHA256, FAULT_SCOPE, ROLES, SCOPE, raw_input_hashes,
    verify_combined_baseline_aggregate)
from bundler.physics import SDK_VERSION, UPSTREAM_COMMIT
from bundler.tests.test_flow_combined import digest, raw


def aggregate_metadata():
    root = 'C:/synthetic-baseline-metadata'
    pair = {'physx-pe.mjs': {'sha256': 'a' * 64, 'bytes': 100},
            'physx-pe.wasm': {'sha256': 'b' * 64, 'bytes': 200}}
    selected = {name: 'c' * 64 for name in ('addons/flow/upload_staging_browser_test.py',
        'addons/flow/flow_host_webgpu.mjs', 'addons/flow/flow_solid_boundary.mjs',
        'addons/flow/flow_scalar_sources.mjs')}
    build_sha = 'e' * 64
    build = {'status': 'COMPILED_NOT_RUNTIME_TESTED', 'sourceUnchanged': True,
        'sourceRoot': root, 'artifacts': pair, 'sources': selected,
        'sourcesBefore': copy.deepcopy(selected), 'sourcesAfter': copy.deepcopy(selected)}
    sources = {root + '/' + name: sha for name, sha in selected.items()}
    sources.update({root + '/dist/candidate/' + name: row['sha256'] for name, row in pair.items()})
    sources[root + '/dist/candidate/build-manifest.json'] = build_sha
    tools = {'C:/synthetic-tools/admission.py': 'd' * 64}
    sources.update(tools)
    oracle_path = 'C:/synthetic-oracle/upload_staging_oracle.mjs'
    sources[oracle_path] = FAULT_ORACLE_SHA256
    proof = {'schema': 'combined-baseline-proofs/v1', 'status': 'COMBINED_BASELINE_PROOFS_PASSED',
        'scope': SCOPE, 'admissionScope': ADMISSION_SCOPE, 'releaseApproved': False,
        'build': {'sourceVersion': SDK_VERSION, 'upstreamTag': 'ovphysx-0.6.3',
            'upstreamCommit': UPSTREAM_COMMIT, 'artifacts': pair,
            'manifest': {'path': root + '/dist/candidate/build-manifest.json', 'sha256': build_sha, 'bytes': 500}},
        'sourceHashes': sources, 'sourceHashesAfter': copy.deepcopy(sources), 'sourceUnchanged': True,
        'toolSources': tools, 'toolSourcesAfter': copy.deepcopy(tools), 'proofs': {}, 'inputFiles': {}}
    receipts, witnesses = {}, {}
    for role in sorted(ROLES):
        native_aliases = {'/dist/candidate/' + name: row['sha256'] for name, row in pair.items()}
        document = {'status': 'SYNTHETIC_ROLE_PASS', 'sourceHashes': {'selected-host': 'c' * 64},
                    'servedRuntimeHashes': native_aliases}
        report_path = 'C:/synthetic-receipts/' + role + '.json'
        witness = {'status': 'PASS', 'role': role, 'exitCode': 0, 'buildManifestSha256': build_sha,
            'artifacts': pair, 'sourceUnchanged': True, 'sourceHashes': copy.deepcopy(sources),
            'sourceHashesAfter': copy.deepcopy(sources)}
        if role in BASELINE_EXECUTIONS:
            witness.update(schema='combined-baseline-proof-witness/v1', nativeExecution=True,
                lockScope='Original runner lock; complete source/pair admission before queue and after execution'
                if role in ('stress', 'authoring', 'engine') else 'parent admission/execution/recheck')
        elif role != 'fault':
            witness.update(schema='combined-flow-proof-witness/v1', runtimeExecuted=True,
                lockScope='existing runner execution; full before/after closure spans queue'
                    if role in ('scene', 'geometry', 'collision', 'solid', 'scalar')
                    else 'parent admission/execution/recheck', tools=tools, toolsAfter=copy.deepcopy(tools))
        else:
            document.update(status='PASS', unified=True, pageErrors=[], consoleErrors=[], gpuErrors=[],
                sourceHashesAfter=copy.deepcopy(document['sourceHashes']),
                artifactHashes={name: row['sha256'] for name, row in pair.items()},
                result={'status': 'PASS', 'cleanup': 'PASS',
                    'cases': [{'name': name, 'status': 'PASS', **({'nativeContexts': 0} if name == 'cleanup' else {})}
                              for name in FAULT_CASES]})
            for name in ('role', 'exitCode'):
                del witness[name]
            witness.update(schema='combined-flow-fault-adapter-witness/v1', scope=FAULT_SCOPE,
                lockScope='Original runner shared lock; before/after complete closure spans queue',
                argv=[root + '/addons/flow/upload_staging_browser_test.py', '--unified', '--primitives-only',
                    '--repo', 'C:/synthetic-game', '--baseline', root + '/addons/flow/flow_host_webgpu.mjs',
                    '--report', report_path],
                supplementalRoutes={'/addons/flow/upload_staging_oracle.mjs':
                    {'path': oracle_path, 'sha256': FAULT_ORACLE_SHA256},
                    **{'/' + name: {'path': root + '/addons/flow/' + name, 'sha256': 'c' * 64}
                        for name in ('flow_solid_boundary.mjs', 'flow_scalar_sources.mjs')}})
            witness['servedSupplementalHashes'] = {name: row['sha256'] for name, row in witness['supplementalRoutes'].items()}
        receipts[role] = raw(document)
        reference = {'path': report_path, 'sha256': digest(receipts[role]), 'bytes': len(receipts[role])}
        witness['rawReport'] = reference if role in BASELINE_EXECUTIONS else {
            key: reference[key] for key in ('path', 'sha256')}
        witness['rawStatus'] = document['status']
        witnesses[role] = raw(witness)
        proof['proofs'][role] = {'raw': reference, 'witness': {'path': report_path.replace('.json', '-witness.json'),
            'sha256': digest(witnesses[role]), 'bytes': len(witnesses[role])}, 'rawStatus': document['status']}
        proof['inputFiles'][role] = {'sourceHashes:selected-host': root + '/addons/flow/flow_host_webgpu.mjs',
            **{'servedRuntimeHashes:' + alias: root + alias for alias in native_aliases}}
    return {'proof': proof, 'artifacts': pair, 'build': build, 'build_sha256': build_sha,
            'receipts': receipts, 'witnesses': witnesses}


def admission(data):
    payload = raw(data['proof'])
    return verify_combined_baseline_aggregate(**data, raw_bytes=payload, raw_sha256=digest(payload))


def rebind_witness(data, role, value):
    data['witnesses'][role] = raw(value)
    data['proof']['proofs'][role]['witness'].update(
        sha256=digest(data['witnesses'][role]), bytes=len(data['witnesses'][role]))


class CombinedAggregateMetadataTests(unittest.TestCase):
    def test_original_bytes_and_fault_fields_are_admitted_without_fabrication(self):
        data = aggregate_metadata()
        parsed = admission(data)
        self.assertEqual(set(parsed), ROLES)
        import json
        fault = json.loads(data['witnesses']['fault'])
        self.assertTrue({'role', 'exitCode', 'runtimeExecuted', 'nativeExecution'}.isdisjoint(fault))

    def test_missing_extra_or_wrong_execution_roles_are_rejected(self):
        for field in ('receipts', 'witnesses'):
            for extra in (False, True):
                data = aggregate_metadata()
                if extra: data[field]['invented'] = b'{}'
                else: data[field].pop('host')
                with self.subTest(field=field, extra=extra), self.assertRaises(ValueError): admission(data)
        for field in ('proofs', 'inputFiles'):
            data = aggregate_metadata(); data['proof'][field].pop('host')
            with self.subTest(field=field), self.assertRaises(ValueError): admission(data)

    def test_reconstructed_json_or_different_original_byte_counts_are_rejected(self):
        for field in ('receipts', 'witnesses'):
            data = aggregate_metadata(); data[field]['engine'] += b'\n'
            with self.subTest(field=field), self.assertRaises(ValueError): admission(data)
        data = aggregate_metadata(); data['proof']['proofs']['host']['raw']['bytes'] += 1
        with self.assertRaises(ValueError): admission(data)

    def test_scope_and_release_certification_are_fail_closed(self):
        for field, value in (('schema', 'old-upgrade'), ('status', 'UPGRADE_BUILD_AND_TESTS_PASSED_NOT_RELEASE_CERTIFIED'),
            ('scope', 'All platforms pass'), ('admissionScope', 'Continuous execution'), ('releaseApproved', True)):
            data = aggregate_metadata(); data['proof'][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError): admission(data)

    def test_build_pair_and_source_closure_must_be_stable(self):
        for mutation in ('before', 'missing-native', 'changed-input', 'duplicate-alias', 'missing-tool', 'pair'):
            data = aggregate_metadata(); proof = data['proof']
            if mutation == 'before': data['build']['sourcesBefore'] = {}
            if mutation == 'missing-native': proof['sourceHashes'].pop(data['build']['sourceRoot'] + '/dist/candidate/physx-pe.wasm')
            if mutation == 'changed-input': proof['sourceHashesAfter'] = {}
            if mutation == 'duplicate-alias': proof['sourceHashes']['C:\\synthetic-tools\\admission.py'] = 'd' * 64
            if mutation == 'missing-tool': proof['sourceHashes'].pop('C:/synthetic-tools/admission.py')
            if mutation == 'pair': proof['build']['artifacts'] = {}
            with self.subTest(mutation=mutation), self.assertRaises(ValueError): admission(data)

    def test_witness_role_schema_native_execution_and_locks_are_fixed(self):
        import json
        for role, field, value in (('candidate', 'nativeExecution', False), ('host', 'runtimeExecuted', False),
            ('engine', 'exitCode', True), ('host', 'role', 'scene'), ('host', 'schema', 'combined-baseline-proof-witness/v1'),
            ('host', 'lockScope', 'unlocked'), ('host', 'sourceHashesAfter', {}), ('host', 'toolsAfter', {})):
            data = aggregate_metadata(); witness = json.loads(data['witnesses'][role]); witness[field] = value
            rebind_witness(data, role, witness)
            with self.subTest(role=role, field=field), self.assertRaises(ValueError): admission(data)

    def test_raw_input_aliases_cannot_be_omitted_invented_or_redirected(self):
        for mutation in ('omit', 'invent', 'redirect', 'relative'):
            data = aggregate_metadata(); mapping = data['proof']['inputFiles']['host']
            if mutation == 'omit': mapping.pop('sourceHashes:selected-host')
            if mutation == 'invent': mapping['sourceHashes:invented'] = 'C:/other/input'
            if mutation == 'redirect': mapping['sourceHashes:selected-host'] = 'C:/other/input'
            if mutation == 'relative': mapping['sourceHashes:selected-host'] = 'relative/input'
            with self.subTest(mutation=mutation), self.assertRaises(ValueError): admission(data)
        self.assertEqual(raw_input_hashes({'sourceHashes': {'x': 'a' * 64}, 'servedSourceHashes': {'x': 'b' * 64}}),
                         {'sourceHashes:x': 'a' * 64, 'servedSourceHashes:x': 'b' * 64})

    def test_fault_adapter_command_routes_or_raw_reference_cannot_be_substituted(self):
        import json
        for mutation in ('command', 'baseline', 'report', 'oracle', 'route', 'lock', 'scope'):
            data = aggregate_metadata(); witness = json.loads(data['witnesses']['fault'])
            if mutation == 'command': witness['argv'][2] = '--simulate-only'
            if mutation == 'baseline': witness['argv'][6] += '-other'
            if mutation == 'report': witness['argv'][8] += '-other'
            if mutation == 'oracle': witness['supplementalRoutes']['/addons/flow/upload_staging_oracle.mjs']['sha256'] = '0' * 64
            if mutation == 'route': witness['servedSupplementalHashes'].pop('/flow_scalar_sources.mjs')
            if mutation == 'lock': witness['lockScope'] = 'parent admission/execution/recheck'
            if mutation == 'scope': witness['scope'] = 'No actual oracle'
            rebind_witness(data, 'fault', witness)
            with self.subTest(mutation=mutation), self.assertRaises(ValueError): admission(data)


if __name__ == '__main__':
    unittest.main()
