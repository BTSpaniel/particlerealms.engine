# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Admission for original-data binary64 physical section preparation, revision 3.

This is a distinct gate, not an upgrade of revision 2 receipts. Browser proofs,
independent raw-f32 comparisons, actual changing scenes and coupled live clocks
must all belong to the selected combined pair. No installer is enabled here.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .physics import (
    BLAST_MASS_CASES, BLAST_SECTIONS_SOURCES, _section_browser, _section_cases,
    _section_exact, _section_integer, _section_number, _section_require,
    _section_stable, _verify_executed_cases, _verify_sections_impact,
    _verify_sections_live_ui, _verify_sections_manufactured, verify_sections_batch,
)

PREPARATION = 'submitted-f32-data/f64-physical-preparation-v1'
TOLERANCE = 9.999999974752427e-7
ENERGY_BUDGET = 0.00002325878904230194
CAPABILITIES = {
    'blastPhysicalStressAbi': 1, 'blastStressSectionsAbi': 1,
    'blastStressSectionsV3Abi': 1, 'blastStressSectionsV3PreparationAbi': 1,
    'blastStressNumericalRevisions': [1, 2, 3],
    'blastPhysicalStressPreparationIdentity': PREPARATION,
    'blastPhysicalStressRelativeTolerance': TOLERANCE,
}
SOURCES = BLAST_SECTIONS_SOURCES | {
    'addons/blast/section_v3_extension.py', 'addons/blast/pr_blast_section_accurate.h',
    'addons/blast/pr_blast_section_qr.h',
}
COMPARISONS = frozenset({'fullGraphComparison', 'fractureComparison',
                       'largeFreeComparison', 'terminalComparison', 'terminalComponents'})
ROLES = COMPARISONS | frozenset({'manufactured', 'mass', 'massScene', 'legacyScenes',
    'v3Scenes', 'fullGraphNative', 'fracture', 'largeFree', 'terminal', 'idle', 'impact', 'liveUi'})
V3_CASES = frozenset('sections-v3-independent-' + name for name in (
    'parallel-area-one-to-four', 'eccentric-rectangle-corner-tractions',
    'rectangle-split-triangles', 'rectangle-split-quarters', 'rotated-translated-rectangle',
    'unequal-mass-uniform-freefall', 'six-body-pending-and-restart-chain',
    'parallel-native-path-area-one-to-four')) | frozenset('sections-v3-' + name for name in (
    'pending-changed-load-replay-and-warm-start', 'zero-load-after-pending',
    'invalid-modes-and-zero-iteration-admission', 'finite-force-overflow-terminal-preserves-health',
    'nonrepresentable-stiffness-terminal-preserves-health', 'checkpoint-rejects-revision2-native',
    'explicit-component-work-and-atomic-query'))
MASS_CASES = frozenset('sections-v3-' + name for name in (
    'accepted-mass-invalidation-manufactured-equilibrium-replay',
    'pending-mass-reset-exact-cold-replay', 'preparation-identity-before-allocation-replay'))
CAPTURES = {
    'fracture': ('4d20aa48a9a1d97ee460f5ab0cee5630a490631bf11347ebad3a9e689556997e',
                 '709045c24d2839d8e0aaaf0afe9a9530041bd827e0ce64f83a852b0d0e8e0d73', 2864),
    'largeFree': ('5271631220dffbf692219532e4693a50fd397aba00cb68062878e149c5148016',
                  '2137d29979f7a8d066a5aeb928dbc1363b21dc6256c8c6df19aa02ac867dcf3d', 3153),
    'terminal': ('5750ccfad7619b2d7c82c126f667fb975c26675fa7c2347bde74ee2b5812ce9d',
                 'ba7b5afe8e4d8a25bb3f21e2f146880824bc84cb6eddc9c243ac0775e0d84a7e', 5743),
}
POLICIES = {
    'masonry_section_comparison_policy.json': '688db37a30dceed44f7770f827dfd30ad76d9f8ba45951ce07c50c93555be437',
    'masonry_section_comparison_policy_02.json': '80fbf05936e4061ffd150427f91bbc449df04b776120bcedbe08e00dea51bb29',
}
ORACLES = {
    'compare_sections_fracture.py': 'ad1ae4d52f9c7d6aded1eaf88f3d37ae8bc5bd2d3936840f788599c0fa696c5b',
    'probe_sections_free_components.py': 'bd5c9f0fa0b60509c4e3565c2f1f8dd81e271486d4d16c6258f84da4bfe2d000',
    'probe_sections_exact_factor.py': '525f8b65d79e82ac209d966e3d640ba33f7cb0f61e1d7e69ff4198cb456982a9',
    'compare_masonry_section_native.py': 'b4533c321929b1f1c3e819a4ec8b2ccb1e1c8e3751bbc87425aac1c1b640107c',
    'masonry_interface_oracle.py': '52374b3ce910a505705b59835bc00e6216a87ca5ad53b8241fa869cb8bf9084c',
    'compare_masonry_section_native_total.py': 'b12e9d3d1ece4a89a03b28319e9f6933589ea5f5b4a47c5f965b30e55c186aef',
    'reference_sections_original_action.py': '4bc5d9e0f958fde318244e017d0bd203f7f40e8ca8e55e4006eecfb155b1408f',
    'probe_sections_terminal_qr.py': '2b4d509934667cdb603655d26d53c834461a8728273df6f42c9adc0d2bf994de',
    'compare_sections_native_components.py': '4236aad3ea398bfce1db5782b4d920ab929f1541e3aded5c360d077adb3dfe51',
    'probe_sections_native_terminal_qr.py': '385d6af83c3962014227f045e9b6b2ce38d5587273f48bc8ba9cfcc8cf3dee01',
    'compare_sections_v3.py': 'ee15e59df5c7db47db5fc06a86952a52ad6c3cd9f18aefeae2a3492c39b31701',
}
WORK_SLOTS = ['components', 'anchoredComponents', 'summedComponentUpdatesLast',
    'summedComponentUpdatesTotal', 'maxComponentUpdatesCurrentLoad', 'retainedFactorBlocks',
    'retainedFactorNumericBytes', 'retainedBasisNumericBytes', 'orthogonalProjectionsLast',
    'orthogonalProjectionsTotal', 'peakBasisNumericBytes', 'numericalRevision']


def _hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _pinned(proof, name, digest):
    matches = [value for key, value in proof['sourceHashes'].items()
               if key.replace('\\', '/').rsplit('/', 1)[-1] == name]
    _section_require(matches == [digest], 'v3 fixed reference input differs: ' + name)


def _oracle_sources(proof, role):
    common = {'compare_masonry_section_native.py', 'compare_masonry_section_native_total.py'}
    if role == 'fullGraphComparison':
        names = common | {'compare_sections_v3.py'}
    else:
        names = common | {'probe_sections_free_components.py', 'probe_sections_exact_factor.py', 'masonry_interface_oracle.py'}
        if role == 'terminalComponents':
            names |= {'compare_sections_native_components.py', 'probe_sections_native_terminal_qr.py', 'probe_sections_terminal_qr.py'}
        else:
            names.add('compare_sections_fracture.py')
            if role == 'terminalComparison':
                names |= {'reference_sections_original_action.py', 'probe_sections_terminal_qr.py'}
    for name in names:
        _pinned(proof, name, ORACLES[name])


def _progress(progress, *, calls, work=None):
    keys = ['updatesLast', 'resumedLast', 'freshChecksLast', 'freshAcceptedLast',
            'updatesTotal', 'resumedCallsTotal', 'freshChecksTotal', 'numericalRevision']
    if isinstance(progress, dict):
        _section_require(set(progress) == set(keys), 'v3 progress schema differs')
        progress = [progress[key] for key in keys]
    _section_require(isinstance(progress, list) and len(progress) == 8
        and all(_section_number(v) and int(v) == v for v in progress)
        and _section_integer(calls, minimum=1, maximum=32)
        and progress[7] == 3 and progress[3] == 1 and 0 < progress[2] <= progress[6]
        and progress[1] <= 1 and progress[0] <= 25
        and progress[0] <= progress[4] <= 25 * calls and progress[5] <= calls,
        'v3 fresh original-gradient admission or unchanged work budget failed')
    if work is not None:
        _section_require(isinstance(work, list) and len(work) == 12
            and all(_section_number(v) and int(v) == v for v in work)
            and work[11] == 3 and 1 <= work[0] and work[1] <= work[0]
            and work[2] <= work[3] and work[4] <= 800
            and work[3] <= work[0] * 800 and work[8] <= work[9] and work[7] <= work[10],
            'v3 component work/storage receipt is incomplete or over budget')


def _physical_comparison(measured, *, reported=True):
    total = measured.get('totalReferenceError', {})
    _section_require(total.get('totalReferenceErrorPass') is True
        and total.get('relativeEnergyErrorBudget') == ENERGY_BUDGET
        and _section_number(total.get('relativeEnergyError'), maximum=ENERGY_BUDGET)
        and measured.get('tractionReferencePass') is True
        and _section_number(measured.get('maximumTractionBudgetRatio'), maximum=1),
        'v3 original physical energy/traction budget failed')
    norm = measured.get('originalGradientNorm', measured.get('originalPhysicalGradientNorm'))
    limit = measured.get('originalGradientLimit', measured.get('originalPhysicalGradientLimit'))
    envelope = measured.get('publicF32GradientEnvelope')
    _section_require(measured.get('publicF32GradientEnvelopePass') is True
        and all(_section_number(v) for v in (norm, limit, envelope)) and norm <= limit + envelope,
        'v3 raw f32 output exceeded the original forward-error envelope')
    if reported:
        _section_require(measured.get('reportedGradientPass') is True
            and _section_number(measured.get('reportedGradientNorm'))
            and _section_number(measured.get('reportedGradientLimit'))
            and measured['reportedGradientNorm'] <= measured['reportedGradientLimit'],
            'v3 private original-gradient admission failed')


def _idle(proof):
    value = _section_cases(proof, {'full-masonry-v3-idle'})['full-masonry-v3-idle']
    baseline = value.get('baseline', {})
    _section_require(baseline.get('chunks') == baseline.get('cookedHulls') == 4074
        and baseline.get('collisionShapes') == 994
        and _section_number(baseline.get('authoredMassKg'))
        and abs(baseline['authoredMassKg'] - 669.7366) < 1e-5,
        'v3 idle did not use the complete authored wall')
    rows = value.get('rows', [])
    _section_require(value.get('failure') is None and len(rows) == 120,
        'v3 idle physical steps incomplete')
    for step, row in enumerate(rows):
        _section_require(row.get('step') == step and row.get('committedSteps') == step + 1
            and row.get('actors') == 1 and row.get('brokenBonds') == 0
            and _section_number(row.get('wallMs')), 'v3 unforced wall moved ownership or damage')
    before, after = value.get('initial', {}), value.get('final', {})
    for state in (before, after):
        _section_require(state.get('stressNumericalRevision') == 3 and state.get('stressSectionsAbi') == 1
            and state.get('stressRelativeTolerance') == TOLERANCE
            and state.get('brokenBonds') == 0, 'v3 idle identity or health differs')
    _section_require(after.get('steps') == 120 and after.get('stressConverged') is True
        and before.get('remainingAreaM2') == after.get('remainingAreaM2'), 'v3 idle health/admission changed')
    cleanup = proof['native'].get('cleanup', {})
    _section_require(cleanup.get('destroyed') is True and cleanup.get('bodies') == cleanup.get('families') == 0,
                     'v3 idle ownership leaked')


def _build(build, pair, *, source_build=None):
    if source_build is not None:
        from .source_build_numerical import checked
        checked(source_build).require_build(build, pair)
        source_build.sources(SOURCES)
        selected = json.loads(source_build.source('reference/combined-native-06/provenance/selected-blast-build.json'))
        _section_require(selected.get('physicalNumericalRevisions') == [1, 2, 3]
            and selected.get('physicalSolverRelativeTolerance') == 1e-6, 'selected original section controls differ')
    else:
        _section_require(build.get('status') == 'COMPILED_NOT_RUNTIME_TESTED'
            and build.get('sourceUnchanged') is True and build.get('sourcesBefore') == build.get('sourcesAfter')
            and build.get('installedRuntimeModified') is False, 'v3 combined build provenance incomplete')
        _section_require(_section_exact([build.get(name) for name in ('physicalStressAbi', 'sectionsAbi',
            'sectionsV3Abi', 'sectionsV3PreparationAbi', 'stressMassAbi')], [1, 1, 1, 1, 1])
            and _section_exact(build.get('physicalNumericalRevisions'), [1, 2, 3])
            and build.get('physicalSolverRelativeTolerance') == 1e-6,
            'v3 combined build lacks exact native preparation/mass identities')
        artifacts = build.get('artifacts', {})
        _section_require(set(artifacts) == set(pair) == {'physx-pe.mjs', 'physx-pe.wasm'}
            and all(record.get('sha256') == pair[name] and _section_integer(record.get('bytes'), minimum=1)
                    for name, record in artifacts.items()), 'v3 selected pair differs from build')
        sources = build.get('sources', {}); bridge = build.get('bridge_sources', {})
        _section_require(SOURCES <= bridge.keys() and all(sources.get(name) == bridge[name] for name in SOURCES),
                         'v3 native source closure missing')
    numerics = (build if source_build is None else selected).get('sectionNumericsV3', {})
    _section_require(numerics.get('schema') == 'particle-realms.section-numerics/v1'
        and numerics.get('numericalRevision') == 3 and numerics.get('preparationIdentity') == PREPARATION
        and numerics.get('api', {}).get('relativeTolerance') == 1e-6
        and numerics.get('workAbi', {}).get('words') == 12
        and numerics['workAbi'].get('type') == 'double' and numerics['workAbi'].get('slots') == WORK_SLOTS,
        'v3 numerical/preparation/work metadata differs')


def _bound_proofs(proofs, pair, build, references, witness, receipt_bytes, *, source_build=None):
    """Validate retained bytes and witness metadata without external path reads."""
    _section_require(set(proofs) == set(references) == set(receipt_bytes) == ROLES, 'v3 missing or extra proof roles/raw bytes')
    raw, hashes, read_witnesses = {}, {}, set()
    for role, proof in proofs.items():
        ref = references[role]
        _receipt_bytes(proof, ref, receipt_bytes[role], role)
        key = 'evidence/sections/' + role + '.json'; raw[key] = proof; hashes[key] = ref['sha256']
        if role in COMPARISONS:
            _section_stable(proof)
            _oracle_sources(proof, role)
        else:
            _section_browser(proof, pair)
            if source_build is not None:
                source_build.material(proof, seen=read_witnesses, live_ui=role == 'liveUi')
            _section_require(_section_exact(proof.get('unifiedRuntime', {}).get('build'), build),
                'v3 proof executed another build or no combined runtime: ' + role)
    verify_sections_batch(witness, raw, hashes, pair, build, source_build=source_build)


def _receipt_bytes(proof, reference, raw, role):
    _section_require(isinstance(reference, dict) and set(reference) == {'originalPath', 'sha256'}
        and isinstance(reference['originalPath'], str) and reference['originalPath'], 'v3 malformed receipt reference')
    _section_require(type(raw) is bytes and hashlib.sha256(raw).hexdigest() == reference['sha256']
        and _section_exact(json.loads(raw), proof), 'v3 stale or rewritten raw receipt: ' + role)


def _linked(comparison, reference):
    _section_require(comparison['sourceHashes'].get(reference['originalPath']) == reference['sha256'],
                     'v3 comparison did not read the exact paired native receipt')


def verify_blast_sections_v3_evidence(proofs, artifact_hashes, build, *, references, witness, receipt_bytes, source_build=None):
    """Reject incomplete, stale, isolated or different-pair revision3 evidence.

``references`` contains original paths/SHA256s, one per role. ``receipt_bytes``
is mandatory exact retained JSON bytes for every role; no external files are
read by this portable gate. ``witness``
uses the existing sections batch schema and pins original served/source files,
including photographs and the full native build closure. Successful individual
helpers or synthetic unit-test metadata never imply complete runtime admission.
"""
    _build(build, artifact_hashes, source_build=source_build)
    _bound_proofs(proofs, artifact_hashes, build, references, witness, receipt_bytes, source_build=source_build)
    manufactured = proofs['manufactured']; _verify_sections_manufactured(manufactured)
    cases = _section_cases(manufactured, V3_CASES | {'sections-revision2-frozen24-bit-exact-baseline-parity'})
    _section_require(len(cases) == 40, 'v3 native manufactured coverage differs')
    parity = cases['sections-revision2-frozen24-bit-exact-baseline-parity']
    _section_require(parity.get('bitExact') is True and parity.get('candidateCases') == parity.get('baselineCases') == 24
        and parity.get('frozenSuiteSha256') == '1d303cbca38f82582ee25b02133f03f4be8d4c10e0d6ef2e555399f1258f2a14',
        'v3 changed the exact revision2 baseline')
    actual = manufactured['native'].get('sectionRuntime', {})
    _section_require(actual.get('mode') == 'shared-engine-heap' and actual.get('sharedEngineModule') is True
        and _section_exact(actual.get('artifactHashes'), build['artifacts'] if source_build is None else source_build.artifacts)
        and _section_exact([actual.get(name) for name in ('sectionsAbi', 'sectionsV3Abi',
            'sectionsV3PreparationAbi', 'stressMassAbi')], [1, 1, 1, 1]), 'v3 actual native identity differs')
    _section_require(manufactured['native'].get('revision3Cleanup') == {'before': 0, 'after': 0}, 'v3 native ownership leak')

    mass = _section_cases(proofs['mass'], MASS_CASES)
    for name in MASS_CASES - {'sections-v3-preparation-identity-before-allocation-replay'}:
        value = mass[name]
        _section_require(value.get('frameBefore') == value.get('frameImmediatelyAfter')
            and value.get('replay') is True and value.get('invalidMutationAtomic') is True
            and value.get('healthAndOwnershipUnchanged') is True
            and value.get('exactColdWrenchErrors') and all(all(v == 0 for v in row)
                for row in value['exactColdWrenchErrors']), 'v3 mass update changed motion/history or continuation')
    identity = mass['sections-v3-preparation-identity-before-allocation-replay']
    _section_require(identity.get('identity') == PREPARATION and len(identity.get('guards', [])) == 7
        and {g.get('name') for g in identity['guards']} == {'missing-top-identity', 'missing-state-identity',
            'mismatched-top-identity', 'mismatched-state-identity', 'absent-native-preparation',
            'unknown-native-preparation', 'nonfunction-native-preparation'}
        and all(g.get('rejected') is True and g.get('allocations') == 0 for g in identity['guards']),
        'v3 checkpoint preparation validation did not precede allocation')
    _section_require(proofs['mass']['native'].get('cleanup') == {'baseline': 0, 'families': 0}, 'v3 mass ownership leaked')
    mass_scene = _section_cases(proofs['massScene'], {'per-chunk-native-mass-inertia-stress-and-ownership',
                                                    'actual-scaled-convex-planes-and-bounds'})
    _verify_executed_cases(mass_scene['per-chunk-native-mass-inertia-stress-and-ownership'].get('cases'),
        BLAST_MASS_CASES - {'actual-scaled-convex-planes-and-bounds'}, label='v3 actual mass scene')
    _section_cases(proofs['legacyScenes'], {'original-physical-direct-scene-version5-remains-compatible',
                                          'sections-direct-scene-version6-empty-pending-converged-replay'})
    scenes = _section_cases(proofs['v3Scenes'], {'sections-v3-real-scene-pending-mass-motion-and-checkpoint',
                                               'sections-v3-real-native-terminal-mass-rollback'})
    stages = scenes['sections-v3-real-scene-pending-mass-motion-and-checkpoint'].get('stages', [])
    _section_require([s.get('stage') for s in stages] == ['empty', 'pending', 'mass-invalidated', 'accepted']
        and scenes['sections-v3-real-native-terminal-mass-rollback'].get('nativeTerminalResult') == -2,
        'v3 real scene state transitions or actual failure rollback missing')
    for role, field, counts in [('massScene', 'afterDispose', ('bodies', 'convexMeshes', 'liveFamilies')),
                                ('legacyScenes', 'cleanup', ('bodies', 'meshes', 'liveFamilies')),
                                ('v3Scenes', 'cleanup', ('bodies', 'convexMeshes', 'families'))]:
        cleanup = proofs[role]['native'].get(field, {})
        _section_require(cleanup.get('destroyed') is True and all(cleanup.get(key) == 0 for key in counts),
                         'v3 real scene native ownership leaked: ' + role)

    for role, (capture_hash, reference_hash, live_bonds) in CAPTURES.items():
        proof = proofs[role]; compared = proofs[role + 'Comparison']
        value = _section_cases(proof, {'captured-real-fractured-wall-original-work-budget'})[
            'captured-real-fractured-wall-original-work-budget']
        _section_require(proof['native'].get('capture', {}).get('sha256') == capture_hash
            and reference_hash in compared['sourceHashes'].values(), 'v3 frozen load/reference differs')
        _linked(compared, references[role]); _pinned(compared, 'masonry_section_comparison_policy.json', POLICIES['masonry_section_comparison_policy.json'])
        state = value.get('state', {})
        _section_require(state.get('converged') is True and state.get('preparationIdentity') == PREPARATION
            and state.get('numericalRevision') == 3 and state.get('relativeSolverTolerance') == TOLERANCE
            and state.get('sectionsAbi') == 1 and value.get('unchangedHealthAndOwnership') is True
            and len(value.get('liveBonds', [])) == len(value.get('wrenches', [])) == live_bonds,
            'v3 captured original operator or physical ownership differs')
        _progress(value.get('progress'), calls=len(value.get('passes', [])), work=value.get('work'))
        _section_require(compared.get('progress') == value['progress'] and compared.get('work') == value['work'],
                         'v3 comparison omitted actual work')
        _physical_comparison(compared.get('comparison', {}))
        _section_require(proof['native'].get('cleanup') == {'baseline': 0, 'families': 0}, 'v3 captured ownership leaked')
    components = proofs['terminalComponents']; _linked(components, references['terminal'])
    _section_require([c.get('component') for c in components.get('cases', [])] == [304, 410], 'v3 ill-conditioned physical references omitted')
    for case in components['cases']:
        independent = case.get('independentReference', {}); factor = independent.get('factor', {})
        _section_require(case.get('status') == 'PASS' and independent.get('pass') is True
            and independent.get('originalReferenceRelativeLimit') == 1e-7
            and _section_number(independent.get('relativeEquilibriumResidual'), maximum=1e-7)
            and factor.get('rankTruncation') is False and factor.get('pivotShift') is False,
            'v3 independent original-action reference changed its physical modes')
        _physical_comparison(case.get('rawF32Comparison', {}), reported=False)

    graph = _section_cases(proofs['fullGraphNative'], {'sections-v3-fullgraph-production-budget'})['sections-v3-fullgraph-production-budget']
    compared = proofs['fullGraphComparison']; _linked(compared, references['fullGraphNative'])
    for name, digest in POLICIES.items(): _pinned(compared, name, digest)
    _section_require(graph.get('converged') is True and graph.get('iterations') == 25
        and graph.get('relativeSolverTolerance') == TOLERANCE and graph.get('numericalRevision') == 3
        and graph.get('sectionsAbi') == 1 and graph.get('productionPassBudgetSatisfied') is True
        and graph.get('brokenBonds') == 0 and len(graph.get('remainingAreasM2', [])) == 2534
        and len(graph.get('sectionDamageFractions', [])) == 19464
        and all(value == 0 for value in graph['sectionDamageFractions']), 'v3 fullgraph health/operator failed')
    _progress(graph.get('physicalProgress'), calls=len(graph.get('passes', [])))
    _section_require(proofs['fullGraphNative']['native'].get('cleanup') == {'nativeFamiliesBefore': 0, 'nativeFamiliesAfter': 0},
                     'v3 fullgraph ownership leaked')
    measured = compared.get('comparison', {}); total = compared.get('totalReferenceError', {})
    _section_require(all(measured.get(name) is True for name in ('gradientEnvelopePass', 'reportedGradientPass',
        'compatibilityPass', 'tractionReferencePass', 'zeroIndependentSeverity', 'healthBitIdentical', 'nativeSeverityExactlyZero'))
        and total.get('relativeEnergyErrorBudget') == ENERGY_BUDGET and total.get('totalReferenceErrorPass') is True
        and _section_number(total.get('relativeEnergyError'), maximum=ENERGY_BUDGET)
        and _section_number(measured.get('maximumTractionErrorBudgetRatio'), maximum=1)
        and compared.get('productionPassBudgetSatisfied') is True and compared.get('passes') == len(graph['passes']),
        'v3 fullgraph independent policy1/policy2 admission failed')
    for value, bound in [('reportedGradientNorm', 'reportedGradientLimit'), ('compatibilityEnergyNormError', 'compatibilityEnergyNormBudget')]:
        _section_require(_section_number(measured.get(value)) and _section_number(measured.get(bound))
            and measured[value] <= measured[bound], 'v3 fullgraph physical residual exceeded')
    _idle(proofs['idle']); _verify_sections_impact(proofs['impact'])
    for case in proofs['impact']['native']['cases']:
        stats = case.get('evidence', {}).get('stats', {})
        _section_require(stats.get('stressNumericalRevision') == 3 and stats.get('stressSectionsAbi') == 1
            and stats.get('stressRelativeTolerance') == TOLERANCE, 'v3 actual impact used another operator')
    _verify_sections_live_ui(proofs['liveUi'], revision=3)
    _section_require(proofs['liveUi'].get('masonryPhysicalStress', {}).get('preparationIdentity') == PREPARATION,
                     'v3 live UI preparation identity absent')
    return {'schema': 'particle-physics-sections-v3-admission/v1', 'status': 'PASS',
            'artifactHashes': dict(artifact_hashes), 'preparationIdentity': PREPARATION,
            'scope': 'Executed same-pair original physical accuracy, changing mass/checkpoints, fullwall and coupled live-clock admission.'}


def verify_blast_sections_v3_files(proofs, artifact_hashes, build, *, references, witness):
    """Explicit source-workspace/installer preflight; not used for staged reads.

The portable verifier above always verifies raw bytes. This wrapper additionally
requires original physical files to remain present and unchanged at promotion.
"""
    receipt_bytes = {}
    for role, reference in references.items():
        path = Path(reference['originalPath'])
        _section_require(path.is_absolute(), 'v3 promotion receipt path must be absolute')
        receipt_bytes[role] = path.read_bytes()
    for path, digest in witness.get('sourceHashes', {}).items():
        _section_require(Path(path).is_absolute() and _hash(path) == digest,
                         'v3 promotion source is now stale: ' + path)
    return verify_blast_sections_v3_evidence(proofs, artifact_hashes, build,
        references=references, witness=witness, receipt_bytes=receipt_bytes)
