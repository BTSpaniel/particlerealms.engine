# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Admission mutation tests. Metadata vectors never certify runtime execution."""
import copy
import json
import unittest
from pathlib import Path

from bundler.flow_transactions import COMPONENT_ABIS, ENGINE_SOURCES, verify_transaction_evidence
from bundler.physics import FLOW_SOLID_ADDON_SOURCES, FLOW_SOLID_NATIVE_SOURCES


class FlowTransactionAdmissionTests(unittest.TestCase):
    def setUp(self):
        vectors = json.loads(Path(__file__).with_name('flow_transaction_admission_vectors.json').read_text())
        self.proofs = vectors['proofs']
        digest = 'a' * 64
        self.artifacts = {name: {'sha256': digest, 'bytes': size} for name, size in
                          (('physx-pe.mjs', 100), ('physx-pe.wasm', 200))}
        paths = ['source/nvflowext/shaders/Test%03dCS.wgsl' % index for index in range(97)]
        paths += ['addons/solid/Test%02dCS.wgsl' % index for index in range(21)]
        paths += ['addons/scalar/Test%dCS.wgsl' % index for index in range(4)]
        paths += ['addons/momentum/PrMomentumGatherCS.wgsl', 'addons/momentum/PrMomentumApplyCS.wgsl']
        shaders = {'dist/flow-wgsl/' + path: digest for path in paths}
        shaders.update({'dist/flow-wgsl/' + path.replace('.wgsl', '.reflection.json'): digest for path in paths})
        shaders.update({'dist/flow-wgsl/' + path: digest for path in
                        ('manifest.json', 'addons/solid/manifest.json', 'addons/scalar/manifest.json', 'addons/momentum/manifest.json')})
        inputs = {name: digest for name in FLOW_SOLID_NATIVE_SOURCES | FLOW_SOLID_ADDON_SOURCES}
        inputs.update(shaders)
        self.component = {'schema': 'flow-component-build-v1', 'status': 'COMPILED_NOT_RUNTIME_TESTED',
            'capabilities': dict(COMPONENT_ABIS), 'inputs': inputs, 'shaderInventory': shaders,
            'compiler': 'TEST-ONLY metadata vector', 'object': {'sha256': digest, 'size': 300}}
        self.build = {'status': 'COMPILED_NOT_RUNTIME_TESTED', 'artifacts': self.artifacts,
            'compiler': self.component['compiler'], 'bridge_sources': dict(inputs),
            'commands': [['em++', '/test-only/pr_flow_host.o', '-o', '/test-only/physx-pe.mjs']],
            'flowComponent': {'schema': 'flow-component-link-v1', 'manifestSha256': digest,
                'objectSha256': digest, 'objectBytes': 300, 'linkInput': '/test-only/pr_flow_host.o',
                'linkCommandIndex': 0, 'capabilities': dict(COMPONENT_ABIS)}}
        self.files = {name.removeprefix('dist/'): value for name, value in shaders.items()}
        self.files.update({'addons/' + name: digest for name in
                           ('flow_host_webgpu.mjs', 'flow_solid_boundary.mjs', 'flow_scalar_sources.mjs')})
        source = {**inputs, 'dist/flow-component/manifest.json': digest}
        served = {'/' + name: value for name, value in shaders.items()}
        served.update({'/addons/flow/' + name: digest for name in
                       ('flow_host_webgpu.mjs', 'flow_solid_boundary.mjs', 'flow_scalar_sources.mjs')})
        engine = {name: digest for name in ENGINE_SOURCES}
        served_engine = {'/' + name: value for name, value in engine.items()}
        served_engine['/engine/sim/PhysicsRuntimeDescriptor.js'] = digest
        runtime = {'/engine/sim/physics/' + name: digest for name in self.artifacts}
        admission = {'manifestPath': '/test-only/build-manifest.json', 'manifestSha256': digest,
            'componentManifestSha256': digest, 'componentObjectSha256': digest,
            'component': self.component, 'artifacts': self.artifacts}
        for proof in self.proofs.values():
            proof.update({'status': 'PASS', 'unified': True, 'quick': False, 'sharedEngineModule': True,
                'flowSolidBoundaryAbi': 1, 'artifactHashes': {name: digest for name in self.artifacts},
                'bridgeSha256': digest, 'hostSourceSha256': digest, 'corpusSha256': digest,
                'adapter': {'isFallbackAdapter': False}, 'nativeBuildManifestSha256': digest,
                'unifiedAdmission': admission, 'unifiedAdmissionAfter': admission})
            for key in ('pageErrors', 'consoleErrors', 'gpuErrors', 'httpErrors', 'requestFailures'):
                proof[key] = []
            for key, value in (('sourceHashes', source), ('servedSourceHashes', served), ('engineSourceHashes', engine),
                    ('servedEngineHashes', served_engine), ('servedRuntimeHashes', runtime),
                    ('bridgeSources', {name: digest for name in FLOW_SOLID_NATIVE_SOURCES}),
                    ('addonSourceHashes', {name: digest for name in FLOW_SOLID_ADDON_SOURCES})):
                proof[key] = dict(value)
                proof[key + 'After'] = dict(value)

    def verify(self):
        return verify_transaction_evidence(self.proofs, self.build, self.component, 'a' * 64, 'a' * 64,
                                            self.artifacts, self.files, 'a' * 64)

    def row(self, role, prefix, field='result'):
        return next(row['evidence'] for row in self.proofs[role][field]['cases'] if row['name'].endswith(prefix))

    def test_complete_metadata_vector_is_accepted_without_claiming_execution(self):
        self.assertEqual(self.verify()['momentumCases'], 5)
        self.assertEqual(self.verify()['rebaseCases'], 10)

    def test_proofs_may_import_different_paths_but_shared_engine_bytes_must_agree(self):
        for key in ('servedEngineHashes', 'servedEngineHashesAfter'):
            for name in ('/engine/world/FloatingOrigin.js', '/engine/world/HierarchicalCoords.js'):
                self.proofs['momentum'][key].pop(name)
        summary = self.verify()
        self.assertIn('/engine/world/FloatingOrigin.js', summary['servedEngineHashes'])
        for proof in self.proofs.values():
            for key in ('servedEngineHashes', 'servedEngineHashesAfter'):
                proof[key]['/engine/sim/physics/PhysXModule.js'] = 'a' * 64
        for key in ('servedEngineHashes', 'servedEngineHashesAfter'):
            self.proofs['momentum'][key]['/engine/sim/physics/PhysXModule.js'] = 'b' * 64
        with self.assertRaisesRegex(ValueError, 'conflicting Engine'):
            self.verify()

    def test_source_native_pair_one_heap_and_error_maps_cannot_be_skipped(self):
        for field, value in [('sharedEngineModule', False), ('unified', False), ('quick', True),
                             ('flowSolidBoundaryAbi', True), ('sourceHashesAfter', {}), ('servedRuntimeHashesAfter', {}),
                             ('engineSourceHashesAfter', {}), ('nativeBuildManifestSha256', 'b' * 64),
                             ('gpuErrors', ['validation']), ('adapter', {'isFallbackAdapter': True})]:
            with self.subTest(field=field):
                saved = copy.deepcopy(self.proofs)
                self.proofs['momentum'][field] = value
                with self.assertRaises(ValueError):
                    self.verify()
                self.proofs = saved
        for route in ('/engine/sim/physics/physx-pe.mjs', '/engine/sim/physics/physx-pe.wasm'):
            with self.subTest(unserved=route):
                saved = copy.deepcopy(self.proofs)
                for key in ('servedRuntimeHashes', 'servedRuntimeHashesAfter'):
                    self.proofs['rebase'][key].pop(route)
                with self.assertRaises(ValueError):
                    self.verify()
                self.proofs = saved

    def test_component_compiler_link_closure_and_shader_inventory_are_bound(self):
        for mutation in ('compiler', 'object', 'boolean-index', 'duplicate-object', 'bridge', 'shader'):
            with self.subTest(mutation=mutation):
                saved = copy.deepcopy((self.build, self.component, self.files))
                if mutation == 'compiler': self.build['compiler'] = 'OTHER'
                elif mutation == 'object': self.build['flowComponent']['objectBytes'] += 1
                elif mutation == 'boolean-index': self.build['flowComponent']['linkCommandIndex'] = False
                elif mutation == 'duplicate-object': self.build['commands'][0].insert(1, '/other/pr_flow_host.o')
                elif mutation == 'bridge': self.build['bridge_sources'].pop('addons/flow/pr_flow_host.cpp')
                else: self.files.pop('flow-wgsl/addons/momentum/PrMomentumApplyCS.wgsl')
                with self.assertRaises(ValueError):
                    self.verify()
                self.build, self.component, self.files = saved

    def test_rebase_measured_pose_clock_guard_and_ownership_cannot_be_forged(self):
        for mutation in ('count', 'invalid-flag', 'pose', 'clock', 'atlas', 'cleanup', 'duplicate', 'empty-evidence'):
            with self.subTest(mutation=mutation):
                saved = copy.deepcopy(self.proofs)
                commit = self.row('rebase', 'one-coordinate-transaction', 'engineResult')
                if mutation == 'count': self.row('rebase', 'is-atomic')['invalidCases'] = True
                elif mutation == 'invalid-flag': self.row('rebase', 'preparation-rejected', 'engineResult')['pendingRejected'] = False
                elif mutation == 'pose': commit['afterBody'][7] += .1
                elif mutation == 'clock': commit['receipt']['advancedTime'] = 1
                elif mutation == 'atlas': commit['atlasBytes'][0] -= 1
                elif mutation == 'cleanup': self.proofs['rebase']['engineResult']['cleanup']['bodies'] = 1
                elif mutation == 'duplicate': self.proofs['rebase']['result']['cases'].append(self.proofs['rebase']['result']['cases'][0])
                else: self.proofs['rebase']['result']['cases'][0]['evidence'] = {}
                with self.assertRaises(ValueError):
                    self.verify()
                self.proofs = saved

    def test_momentum_scales_closure_real_bodies_scope_and_readback_guards_are_required(self):
        for mutation in ('scales', 'inflate-budget', 'error', 'heat', 'clock', 'mass', 'moving-body', 'scope', 'state', 'guard', 'halos', 'nonfinite', 'phase-impulses', 'phase-work'):
            with self.subTest(mutation=mutation):
                saved = copy.deepcopy(self.proofs)
                live = self.row('momentum', 'finite-native-bodies')
                receipt = live['receipt']
                if mutation == 'scales': receipt.pop('physicalScales')
                elif mutation == 'inflate-budget': receipt['budgets']['linearImpulseNs'] = 100
                elif mutation == 'error': receipt['energyError'] = 100
                elif mutation == 'heat': receipt['heatObligationJ'] += 1
                elif mutation == 'clock': receipt['advancedTime'] = .01
                elif mutation == 'mass': live['actual'][0]['mass'] = 0
                elif mutation == 'moving-body': live['actual'][0]['velocity'][0] = -.5
                elif mutation == 'scope': receipt['scope'] = 'fully-coupled-energy'
                elif mutation == 'state': self.row('momentum', 'cache-rejection')['actualGpuBytesAndNativeBodyStateUnchangedAfterEachIntervention'] = False
                elif mutation == 'guard': self.row('momentum', 'cache-rejection')['interventions'][0]['rejection'] = 'unrelated exception'
                elif mutation == 'halos': self.row('momentum', 'step-lifecycle')['scatters'][0]['halos'] = 0
                elif mutation == 'phase-impulses':
                    receipt['applied']['gasImpulseNs'][0] = 100
                    receipt['applied']['bodyImpulseNs'][0] = -100
                elif mutation == 'phase-work':
                    receipt['applied']['gasWorkJ'] += 1
                    receipt['applied']['bodyWorkJ'] -= 1
                    receipt['actualExchange']['gasWork'] = receipt['applied']['gasWorkJ']
                    receipt['actualExchange']['bodyWork'] = receipt['applied']['bodyWorkJ']
                else: receipt['applied']['gasWorkJ'] = float('nan')
                with self.assertRaises(ValueError):
                    self.verify()
                self.proofs = saved


if __name__ == '__main__':
    unittest.main()
