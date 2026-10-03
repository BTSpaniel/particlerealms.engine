# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Explicit metadata vectors for admission guards; these do not execute physics."""
import copy
import hashlib
import json
import unittest

from bundler import blast_sections_v3 as gate
from bundler.physics import _section_browser, _verify_sections_impact, _verify_sections_live_ui


def build_vector():
    pair = {'physx-pe.mjs': 'a' * 64, 'physx-pe.wasm': 'b' * 64}
    sources = dict.fromkeys(gate.SOURCES, 'c' * 64)
    build = {'status': 'COMPILED_NOT_RUNTIME_TESTED', 'sourceUnchanged': True,
        'sourcesBefore': sources, 'sourcesAfter': sources, 'installedRuntimeModified': False,
        'physicalStressAbi': 1, 'sectionsAbi': 1, 'sectionsV3Abi': 1,
        'sectionsV3PreparationAbi': 1, 'stressMassAbi': 1, 'physicalNumericalRevisions': [1, 2, 3],
        'physicalSolverRelativeTolerance': 1e-6,
        'artifacts': {name: {'sha256': digest, 'bytes': 123} for name, digest in pair.items()},
        'sources': sources, 'bridge_sources': sources,
        'sectionNumericsV3': {'schema': 'particle-realms.section-numerics/v1', 'numericalRevision': 3,
            'preparationIdentity': gate.PREPARATION, 'api': {'relativeTolerance': 1e-6},
            'workAbi': {'words': 12, 'type': 'double', 'slots': gate.WORK_SLOTS}}}
    return pair, build


def comparison_vector():
    return {'totalReferenceError': {'totalReferenceErrorPass': True,
        'relativeEnergyErrorBudget': gate.ENERGY_BUDGET, 'relativeEnergyError': gate.ENERGY_BUDGET / 2},
        'tractionReferencePass': True, 'maximumTractionBudgetRatio': .5,
        'originalGradientNorm': 3, 'originalGradientLimit': 1,
        'publicF32GradientEnvelope': 2, 'publicF32GradientEnvelopePass': True,
        'reportedGradientNorm': .9, 'reportedGradientLimit': 1, 'reportedGradientPass': True}


def ui_vector(revision=2):
    photos = ['masonry-intact-front-closeup', 'masonry-heavy-angular-fragments-residue',
              'masonry-heavy-settled-debris-stage']
    cases = ['sandbox-import-and-catalog-discovery', 'masonry-intact-native-inventory-and-front-view',
             'masonry-real-baseball-contact', 'masonry-heavy-spin-fracture-and-mortar-inventory', 'masonry-native-cleanup']
    phases = []
    for name in ['masonry-intact-smoke', 'masonry-after-baseball-smoke', 'masonry-three-heavy-impacts-smoke']:
        initial = {'completedSteps': 0, 'completedPhysicsSteps': 0, 'completedFlowFrames': 0,
            'completedSimulationSeconds': 0, 'paused': False, 'blast': {'generation': 2}, 'flow': {'status': 'running'}}
        final = {**initial, 'completedSteps': 600, 'completedPhysicsSteps': 1200,
                 'completedFlowFrames': 600, 'completedSimulationSeconds': 10}
        phases.append({'name': name, 'started': 1000, 'finished': 11000, 'initial': initial, 'final': final,
            'summary': {'wallSeconds': 10, 'completedSimulationSecondsPerWallSecond': 1}})
    return {'performanceAcceptance': True, 'performanceFailures': [], 'timestampInstrumentation': False,
        'thermalReplayInstrumentation': False, 'profileOnly': False, 'masonryControls': True,
        'nativeAfter': {'flow': 0, 'blast': 0, 'authoring': 0},
        'visualReview': {'status': 'PASS', 'checks': [1, 2, 3]},
        'screenshots': [{'name': name, 'path': '/test/' + name + '.png', 'sha256': 'd' * 64} for name in photos],
        'cases': [{'name': name, 'status': 'PASS'} for name in cases], 'phases': phases,
        'masonryPhysicalStress': {'numericalRevision': revision, 'sectionsAbi': 1,
                                 'relativeSolverTolerance': gate.TOLERANCE}}


def impact_vector():
    configurations = [('baseball-default-spin', 'baseball', 1800, 180, 1),
                      ('heavy-zero-spin-control', 'test-sphere', 0, 90, 1),
                      ('heavy-three-spinning-shots', 'test-sphere', 1800, 240, 3)]
    rows = []
    for name, kind, spin, steps, shots in configurations:
        before = {'massByMaterialKg': {'clay': 548.4726, 'mortar': 121.264}, 'totalJ': 10000, 'minY': 0}
        rows.append({'name': name, 'status': 'PASS', 'evidence': {'allCcdRetained': True,
            'minimumRequiredCpuRate': .95, 'cpuOnlySimulationRate': 1, 'stats': {'brokenBonds': 5},
            'initial': before, 'final': copy.deepcopy(before),
            'configuration': {'name': name, 'kind': kind, 'spinRpm': spin, 'steps': steps, 'shots': shots},
            'elapsedMs': steps / 120 * 1000, 'simulatedSeconds': steps / 120, 'additionalLaunchEnergyJ': 0}})
    return {'native': {'status': 'PASS', 'cases': rows,
        'cleanup': {'destroyed': True, 'completedCases': 3, 'bodies': 0, 'families': 0}}}


class SectionsV3AdmissionTests(unittest.TestCase):
    def test_exact_build_preparation_and_legacy_modes(self):
        pair, build = build_vector(); gate._build(build, pair)
        for key, value in [('sectionsV3PreparationAbi', None), ('sectionsV3Abi', True),
                           ('physicalNumericalRevisions', [3]), ('physicalSolverRelativeTolerance', 1e-5),
                           ('sourceUnchanged', False)]:
            changed = copy.deepcopy(build); changed[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): gate._build(changed, pair)
        changed = copy.deepcopy(build); changed['sectionNumericsV3']['preparationIdentity'] = 'old-f32-operator'
        with self.assertRaises(ValueError): gate._build(changed, pair)

    def test_incomplete_real_proof_set_never_admits(self):
        pair, build = build_vector()
        for proofs in ({}, {'manufactured': {'status': 'PASS'}}):
            with self.assertRaisesRegex(ValueError, 'proof roles'):
                gate.verify_blast_sections_v3_evidence(proofs, pair, build, references={}, witness={}, receipt_bytes={})

    def test_raw_receipt_bytes_are_mandatory_and_portable(self):
        proof = {'status': 'PASS', 'sourceUnchanged': True}
        raw = json.dumps(proof).encode()
        reference = {'originalPath': '/no-longer-mounted/source/receipt.json', 'sha256': hashlib.sha256(raw).hexdigest()}
        gate._receipt_bytes(proof, reference, raw, 'metadata-vector')
        for changed in (None, raw + b' ', json.dumps({'status': 'FAIL'}).encode(), raw.decode()):
            with self.subTest(raw=changed), self.assertRaises(ValueError):
                gate._receipt_bytes(proof, reference, changed, 'metadata-vector')
        with self.assertRaises(ValueError):
            gate._receipt_bytes({'status': 'FAIL'}, reference, raw, 'metadata-vector')

    def test_browser_pair_diagnostics_and_standalone_reject(self):
        pair, _ = build_vector(); hashes = {'test.mjs': 'c' * 64}
        proof = {'status': 'PASS', 'sourceHashes': hashes, 'sourceHashesAfter': hashes,
            'sourceUnchanged': True, 'changedServedSources': {}, 'pageErrors': [], 'consoleErrors': [],
            'httpErrors': [], 'requestFailures': [],
            'servedSourceHashes': {'/engine/sim/physics/' + name: value for name, value in pair.items()}}
        _section_browser(proof, pair)
        for key, value in [('standaloneRuntime', {'loader': 'isolated'}), ('status', 'FAIL'),
                           ('sourceHashesAfter', {}), ('consoleErrors', None), ('changedServedSources', {'test': 'changed'})]:
            changed = copy.deepcopy(proof); changed[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): _section_browser(changed, pair)
        changed = copy.deepcopy(proof); changed['servedSourceHashes']['/engine/sim/physics/physx-pe.wasm'] = 'e' * 64
        with self.assertRaises(ValueError): _section_browser(changed, pair)

    def test_per_component_budget_and_explicit_work(self):
        progress = [12, 0, 1, 1, 12, 0, 1, 3]
        work = [562, 1, 4433, 4433, 13, 8558, 2707128, 3744288, 32254, 32254, 3744288, 3]
        gate._progress(progress, calls=1, work=work)
        for slot, value in [(3, 0), (7, 2), (0, 26), (4, 801)]:
            changed = progress.copy(); changed[slot] = value
            with self.subTest(slot=slot), self.assertRaises(ValueError): gate._progress(changed, calls=32, work=work)
        for slot, value in [(4, 801), (3, 562 * 800 + 1), (11, 2), (10, 0)]:
            changed = work.copy(); changed[slot] = value
            with self.subTest(slot=slot), self.assertRaises(ValueError): gate._progress(progress, calls=1, work=changed)

    def test_original_energy_and_traction_not_only_equilibrium(self):
        value = comparison_vector(); gate._physical_comparison(value)
        for key, bad in [('maximumTractionBudgetRatio', 1.00001), ('reportedGradientNorm', 1.00001),
                         ('publicF32GradientEnvelope', 1.999), ('reportedGradientPass', False)]:
            changed = copy.deepcopy(value); changed[key] = bad
            with self.subTest(key=key), self.assertRaises(ValueError): gate._physical_comparison(changed)
        for key, bad in [('relativeEnergyError', gate.ENERGY_BUDGET * 1.001), ('relativeEnergyErrorBudget', .1)]:
            changed = copy.deepcopy(value); changed['totalReferenceError'][key] = bad
            with self.subTest(key=key), self.assertRaises(ValueError): gate._physical_comparison(changed)

    def test_comparator_cannot_change_its_fixed_oracle(self):
        proof = {'sourceHashes': {'/test/' + name: value for name, value in gate.ORACLES.items()}}
        for role in gate.COMPARISONS: gate._oracle_sources(proof, role)
        proof['sourceHashes']['/test/compare_sections_fracture.py'] = 'e' * 64
        with self.assertRaises(ValueError): gate._oracle_sources(proof, 'fractureComparison')

    def test_exact_native_receipt_link(self):
        reference = {'originalPath': '/proof/native.json', 'sha256': 'a' * 64}
        proof = {'sourceHashes': {'/proof/native.json': 'a' * 64}}
        gate._linked(proof, reference)
        with self.assertRaises(ValueError): gate._linked(proof, {**reference, 'sha256': 'b' * 64})

    def test_impact_fixed_physics_and_actual_clock(self):
        proof = impact_vector(); _verify_sections_impact(proof)
        for key, bad in [('allCcdRetained', False), ('minimumRequiredCpuRate', .1),
                         ('cpuOnlySimulationRate', .949), ('elapsedMs', 10000)]:
            changed = copy.deepcopy(proof); changed['native']['cases'][0]['evidence'][key] = bad
            with self.subTest(key=key), self.assertRaises(ValueError): _verify_sections_impact(changed)
        for key, bad in [('minY', -.0100001), ('totalJ', 10200.001)]:
            changed = copy.deepcopy(proof); changed['native']['cases'][0]['evidence']['final'][key] = bad
            with self.subTest(key=key), self.assertRaises(ValueError): _verify_sections_impact(changed)

    def test_live_ui_v2_defaults_and_v3_explicit_identity(self):
        _verify_sections_live_ui(ui_vector())
        with self.assertRaises(ValueError): _verify_sections_live_ui(ui_vector(3))
        _verify_sections_live_ui(ui_vector(3), revision=3)
        with self.assertRaises(ValueError): _verify_sections_live_ui(ui_vector(), revision=3)

    def test_live_ui_rejects_uncoupled_or_accelerated_clocks(self):
        for key, bad in [('completedFlowFrames', 599), ('completedPhysicsSteps', 1199),
                         ('completedSimulationSeconds', 20), ('paused', True)]:
            changed = ui_vector(3); changed['phases'][0]['final'][key] = bad
            with self.subTest(key=key), self.assertRaises(ValueError): _verify_sections_live_ui(changed, revision=3)
        changed = ui_vector(3); changed['phases'][0]['summary']['completedSimulationSecondsPerWallSecond'] = .9
        with self.assertRaises(ValueError): _verify_sections_live_ui(changed, revision=3)


if __name__ == '__main__':
    unittest.main()
