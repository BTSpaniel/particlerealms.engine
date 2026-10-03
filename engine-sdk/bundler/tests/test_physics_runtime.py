# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Release gates for the real physics inventory, drift and generated declarations."""
import copy
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from bundler.physics import BLAST_AUTHORING_CAPABILITIES, BLAST_AUTHORING_CASES, BLAST_AUTHORING_SOURCES, BLAST_STRESS_CAPABILITIES, BLAST_STRESS_CASES, BLAST_STRESS_FAMILY_CASES, BLAST_STRESS_SOURCES, FLOW_COLLISION_CAPABILITIES, FLOW_COLLISION_CASES, FLOW_GEOMETRY_CAPABILITIES, FLOW_GEOMETRY_CASES, FLOW_SCENE_CAPABILITIES, FLOW_SCENE_CASES, MANIFEST_PATH, audit_physics_consumers, physics_asset_records, physics_release_asset_paths, physics_runtime_descriptor, verify_blast_authoring_evidence, verify_blast_stress_evidence, verify_flow_collision_evidence, verify_flow_geometry_evidence, verify_flow_scene_evidence, verify_physics_sidecars
from bundler.scan_import_paths import scan_import_paths
from tools.generate_physx_types import generate_types
from tools.install_physics_runtime import verify_engine_extensions
from bundler.physics import BLAST_MASS_CAPABILITIES, BLAST_MASS_CASES, BLAST_MASS_SOURCES, verify_blast_mass_evidence
from bundler.physics import FLOW_SOLID_CAPABILITIES, FLOW_SOLID_CASES, FLOW_SOLID_KERNELS, FLOW_SOLID_NATIVE_SOURCES, FLOW_SOLID_ADDON_SOURCES, verify_flow_solid_evidence, verify_flow_solid_corpus
from bundler.physics import FLOW_SCALAR_CAPABILITIES, FLOW_SCALAR_CASES, FLOW_SCALAR_KERNELS, FLOW_SCALAR_NATIVE_SOURCES, FLOW_SCALAR_ADDON_SOURCES, verify_flow_scalar_evidence, verify_flow_scalar_corpus
from bundler.flow_transactions import CAPABILITIES as FLOW_TRANSACTION_CAPABILITIES

ROOT = Path(__file__).resolve().parents[2]


class PhysicsRuntimeTests(unittest.TestCase):
    def test_transaction_claim_without_matching_native_evidence_stops_packaging(self):
        with tempfile.TemporaryDirectory() as directory:
            staged = Path(directory)
            shutil.copytree(ROOT / 'engine/sim/physics', staged / 'engine/sim/physics')
            manifest_path = staged / MANIFEST_PATH
            baseline = json.loads(manifest_path.read_text())
            for capabilities in ({'flowRebaseAbi': 1}, FLOW_TRANSACTION_CAPABILITIES):
                manifest = copy.deepcopy(baseline)
                manifest['capabilities'].update(capabilities)
                manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
                (staged / 'engine/sim/PhysicsRuntimeDescriptor.js').write_bytes(physics_runtime_descriptor(manifest))
                with self.subTest(capabilities=capabilities), self.assertRaisesRegex(ValueError, 'Flow transactions'):
                    physics_release_asset_paths(staged)

    def test_scalar_proof_requires_native_deposits_receipts_and_actual_served_bytes(self):
        artifacts = {'physx-pe.mjs': 'a' * 64, 'physx-pe.wasm': 'b' * 64}
        native = {name: 'c' * 64 for name in FLOW_SCALAR_NATIVE_SOURCES}
        addon = {name: 'd' * 64 for name in FLOW_SCALAR_ADDON_SOURCES}
        files = {'addons/' + name: 'd' * 64 for name in
                 ('flow_host_webgpu.mjs', 'flow_solid_boundary.mjs', 'flow_scalar_sources.mjs')}
        files.update({'flow-wgsl/manifest.json': 'e' * 64, 'flow-wgsl/addons/scalar/manifest.json': 'f' * 64})
        files.update({'flow-wgsl/' + name: '1' * 64 for name in FLOW_SCALAR_KERNELS})
        served = {'/dist/candidate/' + name: digest for name, digest in artifacts.items()}
        served.update({'/dist/' + name: digest for name, digest in files.items() if name.startswith('flow-wgsl/')})
        served.update({'/addons/flow/' + name.removeprefix('addons/'): digest
                       for name, digest in files.items() if name.startswith('addons/')})
        proof = {'status': 'PASS', 'unified': True, 'quick': False, 'flowScalarSourceAbi': 1,
                 'artifactHashes': artifacts, 'bridgeSha256': 'd' * 64, 'hostSourceSha256': 'c' * 64,
                 'adapter': {'isFallbackAdapter': False}, 'pageErrors': [], 'consoleErrors': [], 'gpuErrors': [],
                 'httpErrors': [], 'requestFailures': [], 'bridgeSources': native, 'bridgeSourcesAfter': native,
                 'addonSourceHashes': addon, 'addonSourceHashesAfter': addon, 'corpusSha256': 'e' * 64,
                 'servedSourceHashes': served, 'servedSourceHashesAfter': served,
                 'result': {'flowScalarSourceAbi': 1, 'cleanup': 'PASS',
                            'cases': [{'name': name, 'status': 'PASS'} for name in sorted(FLOW_SCALAR_CASES)]}}
        verify = lambda value: verify_flow_scalar_evidence(value, artifacts, 'd' * 64, native, addon, files)
        verify(proof)
        detailed = {'status': 'PASS', 'nativeContextsBefore': 0, 'nativeContextsAfter': 0, 'ownedGpuResources': 0}
        verify({**proof, 'result': {**proof['result'], 'cleanup': detailed}})
        for field, value in [('status', 'FAIL'), ('nativeContextsBefore', True), ('nativeContextsAfter', 1),
                             ('ownedGpuResources', 1), ('ownedGpuResources', False)]:
            with self.subTest(cleanup=field), self.assertRaisesRegex(ValueError, 'Flow scalar'):
                verify({**proof, 'result': {**proof['result'], 'cleanup': {**detailed, field: value}}})
        for key, value in [('quick', True), ('quick', None), ('unified', False), ('flowScalarSourceAbi', True),
                           ('artifactHashes', {}), ('bridgeSourcesAfter', {}), ('addonSourceHashesAfter', {}),
                           ('servedSourceHashesAfter', {}), ('corpusSha256', '0' * 64), ('httpErrors', ['404']),
                           ('requestFailures', ['failed']), ('gpuErrors', ['validation']),
                           ('adapter', {'isFallbackAdapter': True})]:
            with self.subTest(field=key), self.assertRaisesRegex(ValueError, 'Flow scalar'):
                verify({**proof, key: value})
        for name in FLOW_SCALAR_CASES:
            for mutation in ('missing', 'duplicate', 'skipped'):
                changed = copy.deepcopy(proof)
                cases = changed['result']['cases']
                found = next(row for row in cases if row['name'] == name)
                if mutation == 'missing': cases.remove(found)
                elif mutation == 'duplicate': cases.append(copy.deepcopy(found))
                else: found['status'] = 'SKIP'
                with self.subTest(case=name, mutation=mutation), self.assertRaisesRegex(ValueError, 'Flow scalar'):
                    verify(changed)
        for missing in served:
            changed = copy.deepcopy(proof)
            changed['servedSourceHashes'].pop(missing)
            changed['servedSourceHashesAfter'] = copy.deepcopy(changed['servedSourceHashes'])
            with self.subTest(unserved=missing), self.assertRaisesRegex(ValueError, 'Flow scalar'):
                verify(changed)
        for missing in FLOW_SCALAR_NATIVE_SOURCES:
            subset = {name: digest for name, digest in native.items() if name != missing}
            with self.subTest(native=missing), self.assertRaisesRegex(ValueError, 'Flow scalar'):
                verify_flow_scalar_evidence(proof, artifacts, 'd' * 64, subset, addon, files)

    def test_scalar_corpus_binds_four_operators_reflections_and_all_compiler_inputs(self):
        addon = {name: 'a' * 64 for name in FLOW_SCALAR_ADDON_SOURCES}
        rows = [{'source': 'addons/flow/' + Path(name).stem + '.hlsl', 'sourceSha256': 'a' * 64,
                 'wgsl': name, 'wgslSha256': 'b' * 64,
                 'reflection': name.replace('.wgsl', '.reflection.json'), 'reflectionSha256': 'c' * 64}
                for name in sorted(FLOW_SCALAR_KERNELS)]
        inputs = {name.removeprefix('addons/flow/'): digest for name, digest in addon.items()
                  if name.endswith(('.hlsl', '.hlsli', '.h')) or name.endswith('/compile_scalar_wgsl.py')}
        corpus = {'abi': 1, 'shaders': rows, 'sourceHashes': inputs}
        files = {'flow-wgsl/' + row[field]: row[field + 'Sha256'] for row in rows for field in ('wgsl', 'reflection')}
        verify_flow_scalar_corpus(corpus, files, addon)
        for mutation in ('boolean-abi', 'missing-kernel', 'duplicate-kernel', 'wrong-source', 'wrong-reflection', 'wrong-generator'):
            changed = copy.deepcopy(corpus)
            if mutation == 'boolean-abi': changed['abi'] = True
            elif mutation == 'missing-kernel': changed['shaders'].pop()
            elif mutation == 'duplicate-kernel': changed['shaders'][-1] = changed['shaders'][0]
            elif mutation == 'wrong-source': changed['shaders'][0]['source'] = 'addons/flow/other.hlsl'
            elif mutation == 'wrong-reflection': changed['shaders'][0]['reflection'] = 'addons/scalar/other.json'
            else: changed['sourceHashes']['compile_scalar_wgsl.py'] = 'f' * 64
            with self.subTest(mutation=mutation), self.assertRaisesRegex(ValueError, 'Flow scalar corpus'):
                verify_flow_scalar_corpus(changed, files, addon)
        for missing in inputs:
            changed = copy.deepcopy(corpus)
            changed['sourceHashes'].pop(missing)
            with self.subTest(input=missing), self.assertRaisesRegex(ValueError, 'Flow scalar corpus'):
                verify_flow_scalar_corpus(changed, files, addon)
        for missing in files:
            with self.subTest(missing=missing), self.assertRaisesRegex(ValueError, 'Flow scalar corpus'):
                verify_flow_scalar_corpus(corpus, {name: digest for name, digest in files.items() if name != missing}, addon)

    def test_solid_boundary_proof_requires_full_transport_cases_and_actual_served_bytes(self):
        artifacts = {'physx-pe.mjs': 'a' * 64, 'physx-pe.wasm': 'b' * 64}
        native = {name: 'c' * 64 for name in FLOW_SOLID_NATIVE_SOURCES}
        addon = {name: 'd' * 64 for name in FLOW_SOLID_ADDON_SOURCES}
        files = {'addons/flow_host_webgpu.mjs': 'd' * 64, 'addons/flow_solid_boundary.mjs': 'd' * 64,
                 'flow-wgsl/manifest.json': 'e' * 64, 'flow-wgsl/addons/solid/manifest.json': 'f' * 64}
        files.update({'flow-wgsl/' + name: '1' * 64 for name in FLOW_SOLID_KERNELS})
        served = {'/dist/candidate/' + name: digest for name, digest in artifacts.items()}
        served.update({'/dist/' + name: digest for name, digest in files.items() if name.startswith('flow-wgsl/')})
        served.update({'/addons/flow/flow_host_webgpu.mjs': 'd' * 64, '/addons/flow/flow_solid_boundary.mjs': 'd' * 64})
        proof = {'status': 'PASS', 'unified': True, 'quick': False, 'flowSolidBoundaryAbi': 1,
                 'artifactHashes': artifacts, 'bridgeSha256': 'd' * 64, 'hostSourceSha256': 'c' * 64,
                 'adapter': {'isFallbackAdapter': False}, 'pageErrors': [], 'consoleErrors': [], 'gpuErrors': [],
                 'httpErrors': [], 'requestFailures': [], 'bridgeSources': native, 'bridgeSourcesAfter': native,
                 'addonSourceHashes': addon, 'addonSourceHashesAfter': addon, 'corpusSha256': 'e' * 64,
                 'servedSourceHashes': served, 'servedSourceHashesAfter': served,
                 'result': {'flowSolidBoundaryAbi': 1, 'cleanup': 'PASS',
                            'cases': [{'name': name, 'status': 'PASS'} for name in sorted(FLOW_SOLID_CASES)]}}
        verify = lambda value: verify_flow_solid_evidence(value, artifacts, 'd' * 64, native, addon, files)
        verify(proof)
        for key, value in [('quick', True), ('quick', None), ('artifactHashes', {}), ('bridgeSourcesAfter', {}),
                           ('addonSourceHashesAfter', {}), ('servedSourceHashesAfter', {}), ('corpusSha256', '0' * 64),
                           ('httpErrors', ['404']), ('requestFailures', ['failed']), ('gpuErrors', ['validation']),
                           ('adapter', {'isFallbackAdapter': True})]:
            with self.subTest(field=key), self.assertRaisesRegex(ValueError, 'Flow solid'):
                verify({**proof, key: value})
        for missing in FLOW_SOLID_CASES:
            changed = copy.deepcopy(proof)
            changed['result']['cases'] = [row for row in changed['result']['cases'] if row['name'] != missing]
            with self.subTest(missing=missing), self.assertRaisesRegex(ValueError, 'Flow solid'):
                verify(changed)
        for missing in ('/dist/candidate/physx-pe.wasm', '/dist/flow-wgsl/addons/solid/manifest.json',
                        '/addons/flow/flow_solid_boundary.mjs', '/dist/' + next(name for name in files if name.endswith('.wgsl'))):
            changed = copy.deepcopy(proof)
            changed['servedSourceHashes'].pop(missing)
            changed['servedSourceHashesAfter'] = copy.deepcopy(changed['servedSourceHashes'])
            with self.subTest(unserved=missing), self.assertRaisesRegex(ValueError, 'Flow solid'):
                verify(changed)

    def test_solid_corpus_is_additive_and_binds_all_derived_kernels_and_reflections(self):
        addon = {name: 'a' * 64 for name in FLOW_SOLID_ADDON_SOURCES}
        original = {'inputHashes': {'source/' + name: 'b' * 64 for name in FLOW_SOLID_KERNELS}}
        rows = [{'source': 'source/' + name, 'sourceSha256': 'b' * 64, 'derivedSourceSha256': 'c' * 64,
                 'wgsl': name, 'wgslSha256': 'd' * 64,
                 'reflection': name.replace('.wgsl', '.reflection.json'), 'reflectionSha256': 'e' * 64}
                for name in sorted(FLOW_SOLID_KERNELS)]
        inputs = {name.removeprefix('addons/flow/'): digest for name, digest in addon.items()
                  if name.endswith('.hlsli') or name.endswith('/compile_solid_wgsl.py')}
        corpus = {'abi': 1, 'shaders': rows, 'sourceHashes': inputs}
        files = {'flow-wgsl/' + row[field]: row[field + 'Sha256'] for row in rows for field in ('wgsl', 'reflection')}
        verify_flow_solid_corpus(corpus, files, addon, original)
        for mutation in ('boolean-abi', 'missing-kernel', 'duplicate-kernel', 'wrong-source', 'wrong-reflection', 'wrong-generator'):
            changed = copy.deepcopy(corpus)
            if mutation == 'boolean-abi': changed['abi'] = True
            elif mutation == 'missing-kernel': changed['shaders'].pop()
            elif mutation == 'duplicate-kernel': changed['shaders'][-1] = changed['shaders'][0]
            elif mutation == 'wrong-source': changed['shaders'][0]['sourceSha256'] = 'f' * 64
            elif mutation == 'wrong-reflection': changed['shaders'][0]['reflection'] = 'addons/solid/other.json'
            else: changed['sourceHashes']['compile_solid_wgsl.py'] = 'f' * 64
            with self.subTest(mutation=mutation), self.assertRaisesRegex(ValueError, 'Flow solid corpus'):
                verify_flow_solid_corpus(changed, files, addon, original)
        for missing in files:
            with self.subTest(missing=missing), self.assertRaisesRegex(ValueError, 'Flow solid corpus'):
                verify_flow_solid_corpus(corpus, {name: digest for name, digest in files.items() if name != missing}, addon, original)

    def test_mass_proof_requires_native_mutation_replay_and_unchanged_served_bytes(self):
        artifacts = {'physx-pe.mjs': 'a' * 64, 'physx-pe.wasm': 'b' * 64}
        sources = {name: 'c' * 64 for name in BLAST_MASS_SOURCES}
        served = {'/engine/sim/physics/' + name: digest for name, digest in artifacts.items()}
        proof = {'status': 'PASS', 'unified': True, 'artifacts': artifacts, 'artifactsAfter': artifacts,
                 'bridgeSources': sources, 'bridgeSourcesAfter': sources,
                 'servedSourceHashes': served, 'servedSourceHashesAfter': served, 'sourceUnchanged': True,
                 'pageErrors': [], 'consoleErrors': [], 'httpErrors': [], 'requestFailures': [],
                 'numerical': {'status': 'PASS', 'cleanup': 'PASS', **BLAST_MASS_CAPABILITIES,
                               'cases': [{'name': name, 'status': 'PASS'} for name in sorted(BLAST_MASS_CASES)]}}
        verify_blast_mass_evidence(proof, artifacts, sources)
        for key, value in [('status', 'FAIL'), ('artifactsAfter', {}), ('bridgeSourcesAfter', {}),
                           ('servedSourceHashes', {}), ('servedSourceHashesAfter', {}),
                           ('sourceUnchanged', False), ('httpErrors', ['404']), ('requestFailures', ['failed']),
                           ('pageErrors', ['trap']), ('consoleErrors', ['native error'])]:
            with self.subTest(field=key), self.assertRaisesRegex(ValueError, 'Blast mass'):
                verify_blast_mass_evidence({**proof, key: value}, artifacts, sources)
        for key, value in [('blastMassAbi', True), ('flowConvexBoundaryAbi', 2), ('cleanup', 'FAIL'),
                           ('status', 'RUNNING'), ('cases', []), ('cases', proof['numerical']['cases'] * 2)]:
            with self.subTest(numerical=key), self.assertRaisesRegex(ValueError, 'Blast mass'):
                verify_blast_mass_evidence({**proof, 'numerical': {**proof['numerical'], key: value}}, artifacts, sources)
        with self.assertRaisesRegex(ValueError, 'Blast mass'):
            verify_blast_mass_evidence(proof, artifacts, {name: digest for name, digest in sources.items() if name != 'bridge/pr_bulk_rust.cpp'})

    def test_mass_claim_without_proof_stops_packaging(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for item in physics_asset_records(ROOT):
                target = root / item['path']
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / item['path'], target)
            manifest = json.loads((root / MANIFEST_PATH).read_text())
            manifest['capabilities'].update(BLAST_MASS_CAPABILITIES)
            manifest['files'].pop('evidence/blast-mass-browser.json', None)
            for invalid in (None, {'blastMassAbi': True}, {'flowConvexBoundaryAbi': 2}):
                changed = copy.deepcopy(manifest)
                if invalid:
                    changed['capabilities'].update(invalid)
                (root / MANIFEST_PATH).write_text(json.dumps(changed), encoding='utf-8')
                (root / 'engine/sim/PhysicsRuntimeDescriptor.js').write_bytes(physics_runtime_descriptor(changed))
                with self.assertRaisesRegex(ValueError, 'Blast mass capability'):
                    physics_release_asset_paths(root)

    def test_installer_requires_executed_engine_authoring_and_obstacle_cases(self):
        names = {
            'tests/physics/runtime-acceptance.html':
                'Native authored Blast meshes preserve geometry, collision, motion and replay',
            'tests/physics/flow-physx-collision.html':
                'PhysX native shapes drive Flow velocity obstacles',
        }
        served = {'/' + route: 'a' * 64 for route in names}
        proof = {'sourceUnchanged': True, 'servedSourceHashes': served, 'servedSourceHashesAfter': served,
                 'pages': [{'page': route, 'status': 'passed', 'output': json.dumps({
            'cases': [{'name': name, 'status': 'PASS'}]})} for route, name in names.items()]}
        verify_engine_extensions(proof)
        for field, value in [('sourceUnchanged', False), ('servedSourceHashes', {}), ('servedSourceHashesAfter', {}),
                             ('servedSourceHashes', {'/missing.js': None})]:
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'Native Engine extension acceptance'):
                verify_engine_extensions({**proof, field: value})
        for index in range(2):
            for mutation in ('missing-page', 'duplicate-page', 'failed-page', 'missing-case',
                             'duplicate-case', 'skipped-case', 'boolean-case'):
                with self.subTest(page=index, mutation=mutation):
                    changed = copy.deepcopy(proof)
                    page = changed['pages'][index]
                    result = json.loads(page['output'])
                    if mutation == 'missing-page':
                        changed['pages'].pop(index)
                    elif mutation == 'duplicate-page':
                        changed['pages'].append(page)
                    elif mutation == 'failed-page':
                        page['status'] = 'failed'
                    elif mutation == 'missing-case':
                        result['cases'] = []
                    elif mutation == 'duplicate-case':
                        result['cases'] *= 2
                    else:
                        result['cases'][0]['status'] = 'SKIP' if mutation == 'skipped-case' else True
                    page['output'] = json.dumps(result)
                    with self.assertRaisesRegex(ValueError, 'Native Engine extension acceptance'):
                        verify_engine_extensions(changed)

    def test_flow_scene_proof_rejects_stale_artifacts_and_incomplete_native_coverage(self):
        self._check_flow_proof_contract(verify_flow_scene_evidence, 'flowSceneAbi', FLOW_SCENE_CASES, 'Flow scene')

    def test_flow_geometry_proof_rejects_stale_artifacts_and_incomplete_native_coverage(self):
        self._check_flow_proof_contract(verify_flow_geometry_evidence, 'flowGeometryAbi', FLOW_GEOMETRY_CASES, 'Flow geometry')

    def test_flow_collision_proof_rejects_stale_artifacts_and_incomplete_native_coverage(self):
        self._check_flow_proof_contract(verify_flow_collision_evidence, 'flowCollisionAbi', FLOW_COLLISION_CASES, 'Flow collision')

    def _check_flow_proof_contract(self, verifier, abi_field, case_names, label):
        artifacts = {'physx-pe.mjs': 'a' * 64, 'physx-pe.wasm': 'b' * 64}
        bridge, source = 'c' * 64, 'd' * 64
        proof = {
            'status': 'PASS', 'unified': True, abi_field: 1,
            'artifactHashes': artifacts, 'bridgeSha256': bridge, 'hostSourceSha256': source,
            'adapter': {'isFallbackAdapter': False},
            'pageErrors': [], 'consoleErrors': [], 'gpuErrors': [],
            'result': {abi_field: 1, 'cleanup': 'PASS', 'cases': [
                {'name': name, 'status': 'PASS'} for name in sorted(case_names)
            ]},
        }
        verifier(proof, artifacts, bridge, source)
        for key, value in (
            ('status', 'FAIL'), ('unified', False), (abi_field, True), (abi_field, 2),
            ('artifactHashes', {**artifacts, 'physx-pe.wasm': 'e' * 64}),
            ('bridgeSha256', 'e' * 64), ('hostSourceSha256', 'e' * 64),
            ('pageErrors', ['native error']), ('consoleErrors', ['GPU validation error']),
            ('gpuErrors', ['GPUValidationError']),
            ('adapter', None), ('adapter', {}),
            ('adapter', {'isFallbackAdapter': True}),
            ('adapter', {'isFallbackAdapter': 'false'}),
        ):
            with self.subTest(field=key):
                invalid = {**proof, key: value}
                with self.assertRaisesRegex(ValueError, label):
                    verifier(invalid, artifacts, bridge, source)
        for mutation in ('missing', 'duplicate', 'skipped', 'cleanup', 'result-abi'):
            with self.subTest(case=mutation):
                invalid = copy.deepcopy(proof)
                cases = invalid['result']['cases']
                if mutation == 'missing':
                    cases.pop()
                elif mutation == 'duplicate':
                    cases.append(cases[0])
                elif mutation == 'skipped':
                    cases[0]['status'] = 'SKIP'
                elif mutation == 'cleanup':
                    invalid['result']['cleanup'] = 'FAIL'
                else:
                    invalid['result'][abi_field] = True
                with self.assertRaisesRegex(ValueError, label):
                    verifier(invalid, artifacts, bridge, source)

    def test_inspector_physics_import_resolves_to_the_engine_world(self):
        inspector = ROOT / 'editor/js/panels/Inspector.js'
        imports = scan_import_paths(inspector.read_text(encoding='utf-8'))
        world_imports = [path for path in imports if path.endswith('/PhysXPhysicsWorld.js')]
        self.assertEqual(len(world_imports), 1)
        self.assertEqual((inspector.parent / world_imports[0]).resolve(),
                         ROOT / 'engine/sim/physics/PhysXPhysicsWorld.js')

    def test_blast_stress_proof_requires_exact_pair_sources_units_and_executed_cases(self):
        artifacts = {'physx-pe.mjs': 'a' * 64, 'physx-pe.wasm': 'b' * 64}
        sources = {name: 'c' * 64 for name in BLAST_STRESS_SOURCES}
        proof = {
            'status': 'PASS', 'unified': True, 'artifacts': artifacts, 'artifactsAfter': artifacts,
            'bridgeSources': sources, 'bridgeSourcesAfter': sources,
            'servedSourceHashes': {'/stress-runtime/' + name: digest for name, digest in artifacts.items()},
            'pageErrors': [], 'consoleErrors': [],
            'numerical': {'passed': True, 'abi': 1, 'backend': 'NVIDIA ExtStress scalar CPU/WASM',
                'stressUnits': 'Pa', 'forceUnits': 'N', 'remainingHealthUnits': 'm2',
                'damageCadence': 'per native update',
                'cases': [{'name': name, 'passed': True} for name in sorted(BLAST_STRESS_CASES)],
                'family': {'passed': True, 'cases': [{'name': name, 'passed': True}
                           for name in sorted(BLAST_STRESS_FAMILY_CASES)]}},
        }
        verify_blast_stress_evidence(proof, artifacts, sources)
        for key, value in (
            ('status', 'FAIL'), ('unified', False), ('artifacts', {}), ('artifactsAfter', {}),
            ('bridgeSources', {}), ('bridgeSourcesAfter', {}), ('servedSourceHashes', {}),
            ('pageErrors', ['WASM trap']), ('consoleErrors', ['stderr']),
        ):
            with self.subTest(field=key), self.assertRaisesRegex(ValueError, 'Blast stress'):
                verify_blast_stress_evidence({**proof, key: value}, artifacts, sources)
        for key, value in (
            ('passed', 1), ('abi', True), ('abi', 2), ('backend', 'GPU'), ('stressUnits', 'N'),
            ('forceUnits', 'Pa'), ('remainingHealthUnits', 'normalized'), ('damageCadence', 'per second'),
            ('cases', []), ('cases', proof['numerical']['cases'] * 2),
            ('cases', [{**row, 'passed': 1} for row in proof['numerical']['cases']]),
            ('family', {}), ('family', {'passed': True, 'cases': []}),
            ('family', {**proof['numerical']['family'], 'passed': 1}),
        ):
            with self.subTest(numerical=key), self.assertRaisesRegex(ValueError, 'Blast stress'):
                verify_blast_stress_evidence({**proof, 'numerical': {**proof['numerical'], key: value}}, artifacts, sources)
        for invalid_sources in ({}, {**sources, 'unrecorded.cpp': 'd' * 64},
                                {name: None for name in sources}):
            with self.assertRaisesRegex(ValueError, 'Blast stress'):
                verify_blast_stress_evidence(proof, artifacts, invalid_sources)

    def test_blast_stress_capability_without_native_proof_stops_packaging(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for item in physics_asset_records(ROOT):
                target = root / item['path']
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / item['path'], target)
            manifest = json.loads((root / MANIFEST_PATH).read_text())
            manifest['capabilities'].update(BLAST_STRESS_CAPABILITIES)
            manifest['files'].pop('evidence/blast-stress-browser.json', None)
            for invalid in (None, {'blastStressAbi': True}, {'blastStressBackend': 'webgpu'}):
                changed = copy.deepcopy(manifest)
                if invalid:
                    changed['capabilities'].update(invalid)
                (root / MANIFEST_PATH).write_text(json.dumps(changed), encoding='utf-8')
                (root / 'engine/sim/PhysicsRuntimeDescriptor.js').write_bytes(physics_runtime_descriptor(changed))
                with self.assertRaisesRegex(ValueError, 'Blast stress capability'):
                    physics_release_asset_paths(root)

    def test_blast_authoring_proof_binds_real_mesh_and_family_cases_to_inputs(self):
        artifacts = {'physx-pe.mjs': 'a' * 64, 'physx-pe.wasm': 'b' * 64}
        sources = {name: 'c' * 64 for name in BLAST_AUTHORING_SOURCES}
        proof = {
            'status': 'PASS', 'unified': True, 'blastAuthoringAbi': 1,
            'artifacts': artifacts, 'artifactsAfter': artifacts,
            'bridgeSources': sources, 'bridgeSourcesAfter': sources,
            'servedSourceHashes': {'/authoring-runtime/' + name: digest for name, digest in artifacts.items()},
            'pageErrors': [], 'consoleErrors': [],
            'numerical': {'passed': True, 'abi': 1, 'backend': 'NVIDIA ExtAuthoring CPU/WASM',
                'cases': [{'name': name, 'passed': True} for name in sorted(BLAST_AUTHORING_CASES)]},
        }
        verify_blast_authoring_evidence(proof, artifacts, sources)
        for key, value in (
            ('status', 'FAIL'), ('unified', False), ('blastAuthoringAbi', True), ('blastAuthoringAbi', 2),
            ('artifacts', {}), ('artifactsAfter', {}), ('bridgeSources', {}), ('bridgeSourcesAfter', {}),
            ('servedSourceHashes', {}), ('pageErrors', ['WASM trap']), ('consoleErrors', ['stderr']),
        ):
            with self.subTest(field=key), self.assertRaisesRegex(ValueError, 'Blast authoring'):
                verify_blast_authoring_evidence({**proof, key: value}, artifacts, sources)
        for key, value in (
            ('passed', 1), ('abi', True), ('abi', 2), ('backend', 'decorative chunks'),
            ('cases', []), ('cases', proof['numerical']['cases'] * 2),
            ('cases', [{**row, 'passed': 1} for row in proof['numerical']['cases']]),
        ):
            with self.subTest(numerical=key), self.assertRaisesRegex(ValueError, 'Blast authoring'):
                verify_blast_authoring_evidence({**proof, 'numerical': {**proof['numerical'], key: value}}, artifacts, sources)
        for absent in BLAST_AUTHORING_SOURCES:
            with self.subTest(source=absent), self.assertRaisesRegex(ValueError, 'Blast authoring'):
                verify_blast_authoring_evidence(proof, artifacts, {key: value for key, value in sources.items() if key != absent})

    def test_authoring_capability_without_recorded_proof_stops_packaging(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for item in physics_asset_records(ROOT):
                target = root / item['path']
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / item['path'], target)
            manifest = json.loads((root / MANIFEST_PATH).read_text())
            manifest['capabilities'].update(BLAST_AUTHORING_CAPABILITIES)
            manifest['files'].pop('evidence/blast-authoring-browser.json', None)
            for invalid in (None, {'blastAuthoringAbi': True}, {'blastAuthoringAbi': 2}):
                changed = copy.deepcopy(manifest)
                if invalid:
                    changed['capabilities'].update(invalid)
                (root / MANIFEST_PATH).write_text(json.dumps(changed), encoding='utf-8')
                (root / 'engine/sim/PhysicsRuntimeDescriptor.js').write_bytes(physics_runtime_descriptor(changed))
                with self.assertRaisesRegex(ValueError, 'Blast authoring capability'):
                    physics_release_asset_paths(root)

    def test_all_active_consumers_reject_old_loaders_and_the_js_world(self):
        self.assertGreater(audit_physics_consumers(ROOT)['scannedFiles'], 1000)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'webgpu-os/consumer.js'
            path.parent.mkdir()
            for source in ('import old from "./physx-js-webidl.mjs";',
                           'import { createBody } from "../../engine/sim/physics/PhysicsWorld.js";'):
                path.write_text(source)
                with self.assertRaisesRegex(ValueError, 'Obsolete physics'):
                    audit_physics_consumers(directory)

    def test_installed_pair_and_flow_corpus_are_exact(self):
        paths = physics_release_asset_paths(ROOT)
        self.assertIn('engine/sim/physics/physx-pe.wasm', paths)
        self.assertEqual(sum(path.endswith('.wgsl') and '/flow-wgsl/addons/' not in path for path in paths), 97)
        manifest = json.loads((ROOT / MANIFEST_PATH).read_text())
        if manifest['capabilities'].get('flowSolidBoundaryAbi') == 1:
            self.assertEqual(sum(path.endswith('.wgsl') and '/flow-wgsl/addons/solid/' in path for path in paths), 21)
        verify_physics_sidecars(physics_asset_records(ROOT), ROOT)

    def test_corruption_and_missing_inventory_stop_release(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            records = physics_asset_records(ROOT)
            for item in records:
                target = root / item['path']
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / item['path'], target)
            verify_physics_sidecars(records, root)
            with self.assertRaisesRegex(ValueError, 'inventory'):
                verify_physics_sidecars(records[:-1], root)
            shader = next(item['path'] for item in records if item['path'].endswith('.wgsl'))
            with (root / shader).open('ab') as stream:
                stream.write(b'\n// unexpected change')
            with self.assertRaisesRegex(ValueError, 'differs from verified build'):
                physics_release_asset_paths(root)

    def test_runtime_descriptor_cannot_claim_an_unbuilt_solver(self):
        manifest = json.loads((ROOT / MANIFEST_PATH).read_text())
        self.assertTrue(manifest['capabilities']['flowSolver'])
        self.assertTrue(manifest['capabilities']['blastSceneApi'])
        self.assertEqual(manifest['capabilities']['flowSelectedPipelines'], 96)
        proof = json.loads((ROOT / 'engine/sim/physics/evidence/flow-host-browser.json').read_text())
        self.assertTrue(proof['unified'])
        self.assertEqual(proof['status'], 'PASS')
        self.assertGreaterEqual(proof['result']['stats']['frames'], 120)
        physics_release_asset_paths(ROOT)

    def test_scene_capability_without_recorded_proof_stops_packaging(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for item in physics_asset_records(ROOT):
                target = root / item['path']
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / item['path'], target)
            manifest = json.loads((root / MANIFEST_PATH).read_text())
            manifest['capabilities'].pop('flowGeometryAbi', None)
            manifest['capabilities'].update(FLOW_SCENE_CAPABILITIES)
            manifest['files'].pop('evidence/flow-scene-browser.json', None)
            (root / MANIFEST_PATH).write_text(json.dumps(manifest), encoding='utf-8')
            (root / 'engine/sim/PhysicsRuntimeDescriptor.js').write_bytes(physics_runtime_descriptor(manifest))
            with self.assertRaisesRegex(ValueError, 'missing its evidence inventory'):
                physics_release_asset_paths(root)

    def test_geometry_capability_without_recorded_proof_stops_packaging(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for item in physics_asset_records(ROOT):
                target = root / item['path']
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / item['path'], target)
            manifest = json.loads((root / MANIFEST_PATH).read_text())
            manifest['capabilities'].update({**FLOW_SCENE_CAPABILITIES, **FLOW_GEOMETRY_CAPABILITIES})
            manifest['files'].pop('evidence/flow-geometry-browser.json', None)
            (root / MANIFEST_PATH).write_text(json.dumps(manifest), encoding='utf-8')
            (root / 'engine/sim/PhysicsRuntimeDescriptor.js').write_bytes(physics_runtime_descriptor(manifest))
            with self.assertRaisesRegex(ValueError, 'Flow geometry capability is missing its evidence inventory'):
                physics_release_asset_paths(root)
            for mutation in ('unclaimed', 'boolean-abi', 'old-shapes'):
                with self.subTest(mutation=mutation):
                    invalid = copy.deepcopy(manifest)
                    if mutation == 'unclaimed':
                        invalid['capabilities'].pop('flowGeometryAbi')
                    elif mutation == 'boolean-abi':
                        invalid['capabilities']['flowGeometryAbi'] = True
                    else:
                        invalid['capabilities']['flowEmitterShapes'] = ['sphere', 'box']
                    (root / MANIFEST_PATH).write_text(json.dumps(invalid), encoding='utf-8')
                    (root / 'engine/sim/PhysicsRuntimeDescriptor.js').write_bytes(physics_runtime_descriptor(invalid))
                    with self.assertRaisesRegex(ValueError, 'capability metadata is incomplete or unsupported'):
                        physics_release_asset_paths(root)

    def test_declarations_match_current_idl_and_reject_unknown_syntax(self):
        runtime = ROOT / 'engine/sim/physics'
        self.assertEqual(generate_types((runtime / 'PhysXWasm.idl').read_text()), (runtime / 'physx-pe.d.ts').read_bytes())
        with self.assertRaisesRegex(ValueError, 'Unsupported WebIDL'):
            generate_types('dictionary Unsupported { long value; };')
        with self.assertRaisesRegex(ValueError, 'Unknown WebIDL type'):
            generate_types('interface X { Missing functionName(); };')
        declarations = generate_types('enum Mask { "Mask::eFOUR", "Mask::eTWO" }; interface X { void X(optional long size); attribute float value; };').decode()
        self.assertIn('readonly eFOUR: number', declarations)
        self.assertNotIn('eFOUR = 0', declarations)
        self.assertIn('constructor(size?: number)', declarations)
        self.assertIn('get_value(): number', declarations)

    def test_collision_capability_requires_native_proof_and_exact_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for item in physics_asset_records(ROOT):
                target = root / item['path']
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / item['path'], target)
            manifest = json.loads((root / MANIFEST_PATH).read_text())
            manifest['capabilities'].update(FLOW_COLLISION_CAPABILITIES)
            manifest['files'].pop('evidence/flow-collision-browser.json', None)
            for invalid in (None, {'flowCollisionAbi': True}, {'flowColliderShapes': ['mesh']},
                            {'flowCollisionCoupling': 'two-way-solid'}):
                changed = copy.deepcopy(manifest)
                if invalid:
                    changed['capabilities'].update(invalid)
                (root / MANIFEST_PATH).write_text(json.dumps(changed), encoding='utf-8')
                (root / 'engine/sim/PhysicsRuntimeDescriptor.js').write_bytes(physics_runtime_descriptor(changed))
                with self.assertRaisesRegex(ValueError, 'Flow (scene|collision) capability'):
                    physics_release_asset_paths(root)


if __name__ == '__main__':
    unittest.main()
