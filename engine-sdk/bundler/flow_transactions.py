# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Admission for the executed, same-module Flow coordinate/impulse transactions.

These gates qualify the named terminal operators, not a coupled pressure solver
or SI combustion energy. The installer also revalidates the external component
and every tested input before copying any generated runtime byte.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from pathlib import Path, PurePosixPath

CAPABILITIES = {
    'flowRebaseAbi': 1, 'flowRebaseMode': 'hash-period-coordinate-transaction',
    'flowMomentumExchangeAbi': 1, 'flowMomentumShaderModules': 2,
    'flowMomentumExchangeScope': 'terminal-normal-exchange-only',
    'flowMomentumHeatDisposition': 'unapplied-explicit-obligation',
}
COMPONENT_ABIS = dict.fromkeys(('flowHostAbi', 'flowSolidBoundaryAbi', 'flowScalarSourceAbi',
                              'flowRebaseAbi', 'flowMomentumExchangeAbi'), 1)
ENGINE_SOURCES = frozenset(('engine/sim/FlowPhysXCollision.js', 'engine/sim/FlowMomentumExchange.js',
                           'engine/world/FloatingOrigin.js', 'engine/world/HierarchicalCoords.js'))
DESCRIPTOR_ROUTE = '/engine/sim/PhysicsRuntimeDescriptor.js'
REBASE_CASES = frozenset('rebase-' + name for name in (
    'invalid-shift-is-atomic', 'preserves-atlas-integrals-and-gather',
    'inverse-restores-exact-sparse-state', 'preserves-source-and-summary-motion-history',
    'supports-commensurate-native-layers'))
ENGINE_REBASE_CASES = frozenset('rebase-' + name for name in (
    'pending-and-invalid-preparation-rejected', 'prepared-tokens-reject-source-body-contact-origin-staleness',
    'cache-publication-geometry-and-hierarchy-rejections-are-atomic',
    'native-physx-flow-origin-commit-is-one-coordinate-transaction',
    'shared-clock-resumes-after-native-coordinate-commit'))
MOMENTUM_CASES = frozenset('momentum-' + name for name in (
    'analytic-two-mass-and-angular-work', 'resident-gpu-cells-and-two-finite-native-bodies',
    'overflow-stale-invalid-and-consumed-admission-is-atomic',
    'post-readback-native-mass-inertia-configuration-and-cache-rejection',
    'native-halo-and-subsequent-step-lifecycle'))
EVIDENCE_PATHS = {
    'component': 'evidence/flow-component-build.json',
    'rebase': 'evidence/flow-rebase-browser.json',
    'momentum': 'evidence/flow-momentum-browser.json',
    'testedManifest': 'evidence/flow-transactions-tested-manifest.json',
}


def _require(condition, message):
    if not condition:
        raise ValueError('Flow transactions: ' + message)


def _finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def _count(value, minimum=0):
    return type(value) is int and value >= minimum


def _same(actual, expected):
    """JSON booleans are never integer ABI/count substitutes."""
    if type(actual) is not type(expected):
        return False
    if isinstance(expected, dict):
        return actual.keys() == expected.keys() and all(_same(actual[key], value) for key, value in expected.items())
    if isinstance(expected, list):
        return len(actual) == len(expected) and all(_same(a, b) for a, b in zip(actual, expected))
    return actual == expected


def _hashes(value, *, required=()):
    return (isinstance(value, dict) and bool(value) and set(required) <= value.keys()
            and all(isinstance(name, str) and name and '\\' not in name
                    and '..' not in PurePosixPath(name).parts and isinstance(digest, str)
                    and re.fullmatch('[0-9a-f]{64}', digest) is not None for name, digest in value.items()))


def _finite_tree(value):
    if type(value) in (int, float):
        return math.isfinite(value)
    if isinstance(value, dict):
        return all(_finite_tree(part) for part in value.values())
    if isinstance(value, list):
        return all(_finite_tree(part) for part in value)
    return type(value) in (str, bool) or value is None


def _cases(result, names, *, bodies=False):
    from .physics import _verify_executed_cases
    _require(isinstance(result, dict), 'missing native result')
    cases = result.get('cases')
    _verify_executed_cases(cases, names, label='Flow transactions')
    _require(len(cases) == len(names) and all(isinstance(row.get('evidence'), dict)
             and row['evidence'] and _finite_tree(row['evidence']) for row in cases), 'missing finite case measurements')
    cleanup = result.get('cleanup', {})
    _require(cleanup.get('status') == 'PASS' and all(type(cleanup.get(key)) is int and cleanup[key] == 0
             for key in ('nativeContextsBefore', 'nativeContextsAfter', 'ownedGpuResources'))
             and (not bodies or type(cleanup.get('bodies')) is int and cleanup['bodies'] == 0), 'native ownership leaked')
    return {row['name']: row['evidence'] for row in cases}


def _vector(value, length=3):
    return isinstance(value, list) and len(value) == length and all(_finite(part) for part in value)


def _close(a, b, tolerance):
    return _finite(a) and _finite(b) and _finite(tolerance) and tolerance >= 0 and abs(a - b) <= tolerance


def _sum_vector(a, b):
    return [x + y for x, y in zip(a, b)]


def _difference_norm(a, b):
    return math.hypot(*(x - y for x, y in zip(a, b)))


def _rebase(proof):
    rows = _cases(proof.get('result'), REBASE_CASES)
    invalid = rows['rebase-invalid-shift-is-atomic']
    _require(_same(invalid, {'invalidCases': 4, 'frames': 3, 'period': [16, 8, 8]}), 'incomplete invalid-rebase coverage')
    atlas = rows['rebase-preserves-atlas-integrals-and-gather']
    receipt = atlas.get('result', {})
    _require(_same(atlas.get('shift'), [32, -24, 8]) and _same(atlas.get('period'), [16, 8, 8])
             and _same(atlas.get('atlasBytes'), [6718464, 1152000]) and _vector(atlas.get('integral'), 4)
             and _same(receipt, {'status': 'REBASED', 'abi': 1, 'shift': [32, -24, 8],
                                'coordinateEpoch': 1, 'advancedTime': 0}), 'unproven exact atlas rebase')
    _require(_same(rows['rebase-inverse-restores-exact-sparse-state'].get('coordinateEpoch'), 2), 'missing inverse rebase')
    history = rows['rebase-preserves-source-and-summary-motion-history']
    integrals = history.get('integrals')
    _require(isinstance(integrals, list) and len(integrals) == 2 and all(_vector(v, 4) for v in integrals)
             and all(_close(a, b, 2e-5 * max(1, abs(a), abs(b))) for a, b in zip(*integrals))
             and _finite(history.get('velocityMaximumDifference')) and 0 <= history['velocityMaximumDifference'] <= 8e-5,
             'source/history continuation changed the solved field')
    _require(_same(rows['rebase-supports-commensurate-native-layers'], {'period': [32, 16, 16], 'layers': [0, 2]}),
             'missing commensurate-layer proof')
    rows = _cases(proof.get('engineResult'), ENGINE_REBASE_CASES, bodies=True)
    guards = rows['rebase-pending-and-invalid-preparation-rejected']
    _require(_same(guards, {'shift': [4096, -2048, 1024], 'invalidUnmutated': True, 'pendingRejected': True})
             and _same(rows['rebase-prepared-tokens-reject-source-body-contact-origin-staleness'].get('rejections'), 5)
             and _same(rows['rebase-cache-publication-geometry-and-hierarchy-rejections-are-atomic'].get('rejections'), 8),
             'missing atomic coordinator rejections')
    commit = rows['rebase-native-physx-flow-origin-commit-is-one-coordinate-transaction']
    expected = {'status': 'REBASED', 'abi': 1, 'shift': [4096, -2048, 1024], 'coordinateEpoch': 1,
                'advancedTime': 0, 'maximumPoseRoundingMetres': 0, 'bodies': 1}
    _require(_same(commit.get('receipt'), expected) and _finite(commit.get('mass')) and commit['mass'] == 2
             and _same(commit.get('framesBefore'), 3) and _same(commit.get('framesAtCommit'), 4)
             and _same(commit.get('atlasBytes'), [3483648, 614400]) and _same(commit.get('notified'), 1),
             'coordinate transaction advanced time or changed field ownership')
    before, after = commit.get('beforeBody'), commit.get('afterBody')
    _require(_vector(before, 13) and _vector(after, 13)
             and after[:3] == [before[i] - expected['shift'][i] for i in range(3)] and after[3:] == before[3:],
             'native pose/velocity changed beyond the coordinate translation')
    next_frame = rows['rebase-shared-clock-resumes-after-native-coordinate-commit']
    _require(_same(next_frame.get('frame'), 5) and _vector(next_frame.get('bodyPosition')), 'shared clock did not resume')


def _momentum_receipt(receipt, *, native=False):
    _require(isinstance(receipt, dict) and _same(receipt.get('abi'), 1)
             and receipt.get('mode') == 'terminal-paired-normal-impulses'
             and all(_count(receipt.get(k), 1) for k in ('gasCells', 'bodies', 'contacts', 'sweeps'))
             and receipt['sweeps'] <= 128 and _vector(receipt.get('angularOriginMetres')), 'invalid impulse solve receipt')
    budgets = receipt.get('budgets', {})
    controls = {'roundingVelocityTolerance': 1e-5, 'momentumRelativeTolerance': 2e-5,
                'angularRelativeTolerance': 2e-5, 'energyRelativeTolerance': 2e-5}
    _require(all(_finite(budgets.get(k)) and budgets[k] == v for k, v in controls.items())
             and _finite(receipt.get('velocityTolerance')) and receipt['velocityTolerance'] == 1e-7,
             'physical accuracy controls were enlarged or inferred from the error')
    _require(all(_finite(receipt.get(k)) and 0 <= receipt[k] <= bound for k, bound in (
        ('maximumClosingVelocity', 1e-7), ('appliedMaximumClosingVelocity', 1e-7 + 1e-5), ('maximumRoundingVelocity', 1e-5)))
        and _finite(receipt.get('heatObligationJ')) and receipt['heatObligationJ'] >= 0, 'unresolved contact or invalid heat obligation')
    ideal, applied = receipt.get('ideal', {}), receipt.get('applied', {})
    fields = ('gasImpulseNs', 'bodyImpulseNs', 'gasAngularImpulseNms', 'bodyAngularImpulseNms')
    _require(all(_vector(state.get(key)) for state in (ideal, applied) for key in fields)
             and all(_finite(state.get(key)) for state in (ideal, applied) for key in ('gasWorkJ', 'bodyWorkJ')),
             'missing actual impulse/work ledger')
    energy_scale = abs(ideal['gasWorkJ']) + abs(ideal['bodyWorkJ']) + receipt['heatObligationJ']
    _require(_close(budgets.get('energyJ'), 2e-5 * energy_scale, 1e-14 * max(energy_scale, 1e-300)), 'energy budget is not physical')
    scales = receipt.get('physicalScales', {})
    _require(all(_finite(scales.get(key)) and scales[key] >= 0
                 and _close(budgets.get(key), 2e-5 * scales[key], 1e-14 * max(scales[key], 1e-300))
                 for key in ('linearImpulseNs', 'angularImpulseNms', 'energyJ'))
             and _close(scales['energyJ'], energy_scale, 1e-14 * max(energy_scale, 1e-300)),
             'conservation budgets do not match their physical scales')
    impulse = _sum_vector(applied['gasImpulseNs'], applied['bodyImpulseNs'])
    angular = _sum_vector(applied['gasAngularImpulseNms'], applied['bodyAngularImpulseNms'])
    ideal_impulse = _sum_vector(ideal['gasImpulseNs'], ideal['bodyImpulseNs'])
    ideal_angular = _sum_vector(ideal['gasAngularImpulseNms'], ideal['bodyAngularImpulseNms'])
    # Arithmetic slack is fixed from binary64 precision and physical scales;
    # a measured error is never its own normalization or acceptance limit.
    slacks = {key: 128 * math.ulp(1.0) * value for key, value in scales.items()}
    _require(math.hypot(*ideal_impulse) <= 2e-10 * scales['linearImpulseNs']
             and math.hypot(*ideal_angular) <= 2e-10 * scales['angularImpulseNms'], 'ideal paired impulses do not close')
    measured = {
        'linearError': max(math.hypot(*impulse), _difference_norm(applied['gasImpulseNs'], ideal['gasImpulseNs']),
                           _difference_norm(applied['bodyImpulseNs'], ideal['bodyImpulseNs'])),
        'angularError': max(math.hypot(*angular), _difference_norm(applied['gasAngularImpulseNms'], ideal['gasAngularImpulseNms']),
                            _difference_norm(applied['bodyAngularImpulseNms'], ideal['bodyAngularImpulseNms'])),
        'energyError': max(abs(applied['gasWorkJ'] + applied['bodyWorkJ'] + receipt['heatObligationJ']),
                           abs(applied['gasWorkJ'] - ideal['gasWorkJ']), abs(applied['bodyWorkJ'] - ideal['bodyWorkJ'])),
    }
    for error, budget in (('linearError', 'linearImpulseNs'), ('angularError', 'angularImpulseNms'), ('energyError', 'energyJ')):
        _require(_finite(receipt.get(error)) and _finite(budgets.get(budget)) and 0 <= receipt[error] <= budgets[budget],
                 'applied state exceeds its declared conservation budget')
        _require(_close(receipt[error], measured[error], slacks[budget]) and measured[error] <= budgets[budget],
                 'reported conservation error differs from the measured phase ledgers')
    _require(_vector(receipt.get('roundingImpulseNs')) and _vector(receipt.get('roundingAngularImpulseNms'))
             and _difference_norm(receipt['roundingImpulseNs'], impulse) <= slacks['linearImpulseNs']
             and _difference_norm(receipt['roundingAngularImpulseNms'], angular) <= slacks['angularImpulseNms']
             and _close(receipt.get('idealEnergyResidualJ'), ideal['gasWorkJ'] + ideal['bodyWorkJ'] + receipt['heatObligationJ'], slacks['energyJ'])
             and _close(receipt.get('kineticRoundingJ'), applied['gasWorkJ'] + applied['bodyWorkJ'] - ideal['gasWorkJ'] - ideal['bodyWorkJ'], slacks['energyJ']),
             'rounding vectors or work do not match actual phase ledgers')
    residual = applied['gasWorkJ'] + applied['bodyWorkJ'] + receipt['heatObligationJ']
    _require(_close(receipt.get('appliedEnergyResidualJ'), residual, 1e-14 * max(energy_scale, 1e-300))
             and abs(residual) <= budgets['energyJ']
             and abs(ideal['gasWorkJ'] + ideal['bodyWorkJ'] + receipt['heatObligationJ']) <= 2e-10 * energy_scale,
             'heat/work ledger does not close')
    if native:
        _require(receipt.get('status') == 'EXCHANGED' and _same(receipt.get('advancedTime'), 0)
                 and _same(receipt.get('bodies'), 2) and _same(receipt.get('cells'), 20)
                 and _same(receipt.get('gasCells'), 20) and _same(receipt.get('contacts'), 20)
                 and receipt.get('scope') == CAPABILITIES['flowMomentumExchangeScope']
                 and receipt.get('heatDisposition') == CAPABILITIES['flowMomentumHeatDisposition']
                 and receipt.get('densitiesKgPerM3') == [[0, 1.2]], 'terminal exchange was misrepresented as a full energy solver')
        actual = receipt.get('actualExchange', {})
        _require(_vector(actual.get('deltaP')) and _vector(actual.get('deltaL'))
                 and math.hypot(*actual['deltaP']) <= budgets['linearImpulseNs']
                 and math.hypot(*actual['deltaL']) <= budgets['angularImpulseNms']
                 and _close(actual.get('gasWork'), applied['gasWorkJ'], 1e-12)
                 and _close(actual.get('bodyWork'), applied['bodyWorkJ'], 1e-12), 'actual native exchange disagrees with its ledger')
        _require(_difference_norm(actual['deltaP'], impulse) <= slacks['linearImpulseNs']
                 and _difference_norm(actual['deltaL'], angular) <= slacks['angularImpulseNms'],
                 'actual native momentum differs from the applied phase ledgers')


def _momentum(proof):
    rows = _cases(proof.get('result'), MOMENTUM_CASES, bodies=True)
    analytic = rows['momentum-analytic-two-mass-and-angular-work']
    for name in ('translation', 'rotation'):
        _momentum_receipt(analytic.get(name))
    translation = analytic['translation']
    _require(translation['heatObligationJ'] == 3 and translation['ideal']['gasImpulseNs'] == [-3, 0, 0]
             and translation['ideal']['bodyImpulseNs'] == [3, 0, 0]
             and 'configured physical accuracy budget' in analytic.get('roundingFailure', ''), 'analytic mass/rounding guard failed')
    live = rows['momentum-resident-gpu-cells-and-two-finite-native-bodies']
    _momentum_receipt(live.get('receipt'), native=True)
    actual = live.get('actual')
    _require(isinstance(actual, list) and len(actual) == 2 and all(isinstance(body, dict)
             and all(_vector(body.get(k)) for k in ('position', 'velocity', 'angularVelocity', 'inertia'))
             and _finite(body.get('mass')) and body['mass'] == mass and all(part > 0 for part in body['inertia'])
             for body, mass in zip(actual, (2, 3))) and actual[0]['velocity'][0] > -.5
             and actual[1]['angularVelocity'][2] != 3, 'finite native bodies did not receive the impulses')
    _require(_same(rows['momentum-overflow-stale-invalid-and-consumed-admission-is-atomic'],
                  {'residentCells': 20, 'contacts': 20, 'scalarBytes': 6718464}), 'missing atomic admission guards')
    guards = rows['momentum-post-readback-native-mass-inertia-configuration-and-cache-rejection']
    interventions = guards.get('interventions', [])
    names = ('mass', 'principal-inertia', 'native-velocity', 'density-configuration', 'frozen-public-cache')
    messages = ('mass, inertia, pose, velocity or geometry changed',) * 3 + ('physical controls changed', 'cache changed')
    _require(guards.get('actualGpuBytesAndNativeBodyStateUnchangedAfterEachIntervention') is True
             and isinstance(interventions, list) and len(interventions) == 5
             and all(isinstance(row, dict) and row.get('name') == name and message in row.get('rejection', '')
                     for row, name, message in zip(interventions, names, messages)), 'readback rejection did not preserve actual state')
    lifecycle = rows['momentum-native-halo-and-subsequent-step-lifecycle']
    _momentum_receipt(lifecycle.get('receipt'), native=True)
    _require(_same(lifecycle.get('scatters'), [{'cells': 20, 'halos': 24, 'velocityAtlasBytes': 1152000}] * 3),
             'complete native velocity/halo lifecycle was not checked')


def verify_transaction_evidence(proofs, build, component, component_sha256, build_sha256, artifacts, files,
                                tested_descriptor_sha256, *, source_build=None, execution=None):
    """Validate raw execution and metadata; external source bytes are checked by the installer."""
    if source_build is not None:
        from .source_build_flow import verify_source_build_transactions
        _require(component is None and component_sha256 is None,
            'source-built transactions cannot impersonate an old Flow component')
        return verify_source_build_transactions(proofs, build, build_sha256, artifacts, files,
            tested_descriptor_sha256, source_build=source_build, execution=execution)
    _require(execution is None, 'source-build execution metadata requires its explicit context')
    from .physics import FLOW_SOLID_NATIVE_SOURCES, FLOW_SOLID_ADDON_SOURCES, _verify_flow_addon_evidence
    _require(set(proofs) == {'rebase', 'momentum'}, 'missing transaction proof roles')
    _require(component.get('schema') == 'flow-component-build-v1'
             and component.get('status') == 'COMPILED_NOT_RUNTIME_TESTED'
             and _same(component.get('capabilities'), COMPONENT_ABIS)
             and _hashes(component.get('inputs')) and _hashes(component.get('shaderInventory')),
             'unbound compiled component')
    inventory = component['shaderInventory']
    _require(len(inventory) == 252 and sum(name.endswith('.wgsl') for name in inventory) == 124
             and sum(name.endswith('.reflection.json') for name in inventory) == 124
             and {'dist/flow-wgsl/' + name for name in ('manifest.json', 'addons/solid/manifest.json',
                  'addons/scalar/manifest.json', 'addons/momentum/manifest.json')} <= inventory.keys(),
             'compiled shader/reflection closure is incomplete')
    ref, obj = build.get('flowComponent', {}), component.get('object', {})
    _require(build.get('status') in ('COMPILED_NOT_RUNTIME_TESTED', 'PASS') and build.get('artifacts') == artifacts
             and build.get('compiler') == component.get('compiler') and bool(component.get('compiler'))
             and ref.get('schema') == 'flow-component-link-v1' and ref.get('manifestSha256') == component_sha256
             and ref.get('objectSha256') == obj.get('sha256') and _count(ref.get('objectBytes'), 1)
             and ref['objectBytes'] == obj.get('size') and _same(ref.get('capabilities'), COMPONENT_ABIS), 'final runtime did not link this component')
    commands, index = build.get('commands'), ref.get('linkCommandIndex')
    _require(isinstance(commands, list) and _count(index) and index < len(commands), 'missing final link command')
    command = commands[index]
    _require(isinstance(command, list) and command and all(isinstance(v, str) for v in command)
             and Path(command[0]).name in ('em++', 'em++.py') and command.count(ref.get('linkInput')) == 1
             and sum(Path(v).name == 'pr_flow_host.o' for v in command) == 1 and command.count('-o') == 1
             and command.index('-o') + 1 < len(command) and Path(command[command.index('-o') + 1]).name == 'physx-pe.mjs',
             'component not linked exactly once into the served loader')
    native = {name: component['inputs'].get(name) for name in FLOW_SOLID_NATIVE_SOURCES}
    addon = {name: component['inputs'].get(name) for name in FLOW_SOLID_ADDON_SOURCES}
    _require(_hashes(native) and all(build.get('bridge_sources', {}).get(name) == digest for name, digest in native.items())
             and all(build.get('bridge_sources', {}).get(name) == digest for name, digest in component['inputs'].items()
                 if name.startswith('addons/flow/') and Path(name).suffix in ('.py', '.mjs', '.h', '.hlsli', '.hlsl')),
             'unified build has a different Flow source closure')
    _require(all(files.get(name.removeprefix('dist/')) == digest for name, digest in component['shaderInventory'].items()),
             'runtime shader inventory differs from the compiled component')
    pair = {name: row['sha256'] for name, row in artifacts.items()}
    engine_identity, engine_served = None, {}
    for role, proof in proofs.items():
        _require(isinstance(proof, dict) and proof.get('sharedEngineModule') is True, 'both sides did not use the Engine module')
        for key in ('sourceHashes', 'bridgeSources', 'addonSourceHashes', 'servedSourceHashes',
                    'engineSourceHashes', 'servedEngineHashes', 'servedRuntimeHashes'):
            _require(_hashes(proof.get(key)) and proof.get(key + 'After') == proof[key], 'changed or missing ' + key)
        _require(all(proof['sourceHashes'].get(name) == digest for name, digest in component['inputs'].items())
                 and proof['sourceHashes'].get('dist/flow-component/manifest.json') == component_sha256,
                 'executed proof omitted compiled inputs')
        admission = proof.get('unifiedAdmission', {})
        _require(admission == proof.get('unifiedAdmissionAfter') and admission.get('manifestSha256') == build_sha256
                 and proof.get('nativeBuildManifestSha256') == build_sha256
                 and admission.get('componentManifestSha256') == component_sha256
                 and admission.get('componentObjectSha256') == obj['sha256']
                 and admission.get('component') == component and admission.get('artifacts') == artifacts,
                 'execution belongs to a different final pair/component')
        served_required = ENGINE_SOURCES if role == 'rebase' else {name for name in ENGINE_SOURCES if name.startswith('engine/sim/')}
        _require(ENGINE_SOURCES <= proof['engineSourceHashes'].keys()
                 and proof['servedEngineHashes'].get(DESCRIPTOR_ROUTE) == tested_descriptor_sha256
                 and all(proof['servedEngineHashes'].get('/' + name) == digest
                         for name, digest in proof['engineSourceHashes'].items() if name in served_required), 'Engine coordinator or tested identity differs')
        identity = proof['engineSourceHashes']
        _require(engine_identity is None or identity == engine_identity, 'transaction proofs used different Engine consumers')
        engine_identity = identity
        _require(all(name not in engine_served or engine_served[name] == digest
                     for name, digest in proof['servedEngineHashes'].items()), 'transaction proofs served conflicting Engine bytes')
        engine_served.update(proof['servedEngineHashes'])
        served = {**proof['servedSourceHashes'], **proof['servedRuntimeHashes']}
        _require(not any(name in proof['servedSourceHashes'] and proof['servedSourceHashes'][name] != digest
                         for name, digest in proof['servedRuntimeHashes'].items()), 'conflicting runtime alias bytes')
        projection = {**proof, 'servedSourceHashes': served, 'servedSourceHashesAfter': served}
        _verify_flow_addon_evidence(projection, pair, files.get('addons/flow_host_webgpu.mjs'), native, addon, files,
            abi_field='flowSolidBoundaryAbi', required_cases=REBASE_CASES if role == 'rebase' else MOMENTUM_CASES,
            label='Flow transactions', native_sources=FLOW_SOLID_NATIVE_SOURCES, addon_required=FLOW_SOLID_ADDON_SOURCES,
            helpers=('flow_host_webgpu.mjs', 'flow_solid_boundary.mjs', 'flow_scalar_sources.mjs'),
            require_result_abi=False, runtime_prefix='/engine/sim/physics/')
        (_rebase if role == 'rebase' else _momentum)(proof)
    return {'status': 'PASS', 'rebaseCases': 10, 'momentumCases': 5, 'componentSha256': component_sha256,
            'runtimeBuildSha256': build_sha256, 'engineSourceHashes': engine_identity, 'servedEngineHashes': engine_served}


def verify_transaction_inventory(root, manifest, records):
    """Verify the portable evidence inventory, including the generated-identity transition."""
    from .physics import PHYSICS_ROOT, physics_runtime_descriptor
    _require(all(_same(manifest['capabilities'].get(key), value) for key, value in CAPABILITIES.items())
             and all(_same(manifest['capabilities'].get(key), 1) for key in ('flowHostAbi', 'flowSolidBoundaryAbi', 'flowScalarSourceAbi')),
             'incomplete capability metadata')
    required = set(EVIDENCE_PATHS.values()) | {'evidence/candidate-rust-build.json', 'flow-wgsl/addons/momentum/manifest.json'}
    _require(required <= records.keys(), 'missing raw transaction evidence')
    read = lambda name: json.loads((Path(root) / PHYSICS_ROOT / name).read_text(encoding='utf-8'))
    component = read(EVIDENCE_PATHS['component'])
    tested = read(EVIDENCE_PATHS['testedManifest'])
    _require(all(tested.get(key) == manifest.get(key) for key in ('schema', 'moduleName', 'sdkVersion', 'upstreamTag', 'upstreamCommit')),
             'tested identity belongs to a different SDK')
    proof_set = {role: read(EVIDENCE_PATHS[role]) for role in ('rebase', 'momentum')}
    summary = verify_transaction_evidence(proof_set, read('evidence/candidate-rust-build.json'), component,
        records[EVIDENCE_PATHS['component']]['sha256'], records['evidence/candidate-rust-build.json']['sha256'],
        {name: records[name] for name in ('physx-pe.mjs', 'physx-pe.wasm')},
        {name: row['sha256'] for name, row in records.items()}, hashlib.sha256(physics_runtime_descriptor(tested)).hexdigest())
    # The descriptor is generated identity data. The executed baseline identity
    # is retained verbatim; the new identity is independently regenerated by
    # physics_release_asset_paths. Every executable Engine dependency stays bound.
    engine_present = (Path(root) / 'engine/sim/FlowPhysXCollision.js').is_file()
    if engine_present:
        for route, digest in summary['servedEngineHashes'].items():
            if route == DESCRIPTOR_ROUTE:
                continue
            relative = PurePosixPath(route.lstrip('/'))
            path = (Path(root) / relative).resolve()
            _require(path.is_relative_to(Path(root).resolve()) and path.is_file()
                     and hashlib.sha256(path.read_bytes()).hexdigest() == digest, 'live Engine dependency changed: ' + route)
    corpus = read('flow-wgsl/addons/momentum/manifest.json')
    rows = corpus.get('shaders', [])
    _require(_same(corpus.get('abi'), 1) and isinstance(rows, list) and len(rows) == 2
             and {row.get('wgsl') for row in rows if isinstance(row, dict)} ==
                 {'addons/momentum/PrMomentumGatherCS.wgsl', 'addons/momentum/PrMomentumApplyCS.wgsl'}, 'invalid momentum shader corpus')
    _require(_hashes(corpus.get('sourceHashes')) and all(component['inputs'].get('addons/flow/' + name) == digest
             for name, digest in corpus['sourceHashes'].items()), 'momentum compiler inputs changed')
    for row in rows:
        _require(component['inputs'].get(row.get('source')) == row.get('sourceSha256')
                 and row.get('reflection') == row['wgsl'].replace('.wgsl', '.reflection.json')
                 and all(records.get('flow-wgsl/' + row[key], {}).get('sha256') == row.get(key + 'Sha256')
                         for key in ('wgsl', 'reflection')), 'momentum shader/reflection differs from its source')
    return summary
