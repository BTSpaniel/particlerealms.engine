# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Inventory the executed MRI9 diagnostics without admitting production heat coupling."""
import hashlib
import json

from .physics import _section_browser, _section_cases, _section_exact, _section_require

CAPABILITIES = {
    'woodThermalAbi': 1, 'woodThermalMultirateAbi': 2, 'woodThermalNumericalRevision': 9,
    'woodThermalScope': 'reduced-layered-pine-diagnostic', 'woodThermalDefaultEnabled': False,
}
EXPORTS = ['_pr_wood_thermal_abi', '_pr_wood_thermal_scratch_bytes', '_pr_wood_thermal_step',
    '_pr_wood_thermal_mr_abi', '_pr_wood_thermal_mr_numerics',
    '_pr_wood_thermal_mr_workspace_bytes', '_pr_wood_thermal_mr_step']
SOURCES = {'addons/thermal/pr_wood_thermal.cpp', 'addons/thermal/pr_wood_thermal_multirate.cpp',
           'addons/thermal/build_thermal.py', 'addons/thermal/build_thermal_multirate.py'}
CASES = frozenset('multirate-' + name for name in (
    'closed-analytic-two-lump-transport', 'closed-irregular-graph-conservation',
    'malformed-packets-preserve-entire-arena', 'computation-failure-is-atomic',
    'corrupt-success-cannot-commit', 'actual-captured-hot-update-completes')) | frozenset({
    'irreversible-heating-and-depletion-moisture-0', 'irreversible-heating-and-depletion-moisture-0.08',
    'cold-sub-ulp-reaction-increments-remain-irreversible'}) | frozenset(
    f'coupled-radau-{mode}-tolerance-{factor}'
    for mode in ('whole-interval', 'common-times') for factor in (1, 4, 16))
FIXTURES = {
    'wood_thermal_mri_cases.mjs': 'a10d11b826e9a1b3c0f7184a6ac3bbecfa6925a0f6cdf30b6995ead4660ccab3',
    'wood_thermal_mri_runtime.mjs': 'bb6cc6a78708ecda6dcdf017f1c18f191c069512c6377617a3cffadd9d9825e4',
    'wood_thermal_mri_increment_cases.mjs': '88a22c4430833b6f2b781e3c2dd120f3dfdcc177e900320c6178ea23265370c4',
    'wood_thermal_mri_extrapolated_cases.mjs': '52eed85bcc9b346bca144f968f0b8509972689315d0a0eadefb20e5ba571feb8',
    'wood_thermal_mri_multirate_packet.mjs': 'caf2051630d6c7e8fc09d6d677e29a9afa434fb1b97a0a1b823c71edba88f248',
    'wood_thermal_numerical_reference_cases.mjs': '91ed35c0a4161ab3ce7b2b57933544749c4b8efd1fa7b5f82027b6592e3ec56c',
    'wood_thermal_mri_multirate_cases.mjs': '7a09381808c1c26db1d1b7983fe29f079550fc82655ae0104c9d2bd1eed9156b',
    'wood_thermal_mri_multirate_coupled_cases.mjs': 'bfa203b46f0795effde582a6d9728b4e2aa1a35cf512fae174e087ca1edc162b',
    'wood_thermal_wasm_packet.mjs': 'dab2504d65c6da01e8a87ee88b6ca59a83bd79c8004812ba8dbe0d028fa75aa6',
    'wood-continuous-coupled-oracle-01.json': '45edee1dd79a1b58ba4c9581adca247c4175852705a744ca2af334451ead2763',
    'fire-wood-candidate-profile-07.json': 'f76e361155d096906f574a587fffeed52a9df81c389dcd753ebc230a26426491',
}


def verify_wood_thermal_diagnostics(proof, pair, build, *, raw_bytes, raw_sha256, source_build=None):
    """Require untouched same-pair diagnostics; return no accuracy or real-time admission."""
    _section_require(type(raw_bytes) is bytes and hashlib.sha256(raw_bytes).hexdigest() == raw_sha256
        and _section_exact(json.loads(raw_bytes), proof), 'thermal diagnostic raw receipt changed')
    _section_browser(proof, pair)
    if source_build is not None:
        from .source_build_numerical import checked, MRI_RUNTIME
        source_build = checked(source_build)
        source_build.require_build(build, pair)
        source_build.material(proof)
        source_build.sources(SOURCES)
        command = source_build.thermal_command
    else:
        _section_require(_section_exact(proof.get('unifiedRuntime', {}).get('build'), build)
            and build.get('thermalIncluded') is True
            and _section_exact([build.get('thermalAbi'), build.get('thermalNumericalVersion')], [2, 9]),
            'thermal diagnostic belongs to another build or numerical revision')
        sources, bridge = build.get('sources', {}), build.get('bridge_sources', {})
        _section_require(SOURCES <= bridge.keys() and all(sources.get(name) == bridge[name] for name in SOURCES),
                         'thermal diagnostic native build closure incomplete')
        command = build.get('thermalCompileCommand', [])
    required = {'-O3', '-fno-fast-math', '-fno-associative-math', '-ffp-contract=off',
                '-msimd128', '-DPR_THERMAL_STABLE_DEPLETION=1'}
    _section_require(isinstance(command, list) and required <= set(command)
        and not {'-Ofast', '-ffast-math', '-fassociative-math', '-ffp-contract=fast'} & set(command),
        'thermal diagnostic changed strict floating-point or depletion controls')
    native = proof.get('native', {}); runtime = native.get('thermalRuntime', {})
    _section_require(runtime.get('mode') == 'shared-engine-heap' and runtime.get('sharedEngineModule') is True
        and _section_exact([runtime.get('baseAbi'), runtime.get('multirateAbi'), runtime.get('numericalVersion')], [1, 2, 9])
        and runtime.get('exports') == EXPORTS and native.get('numericalVersion') == 9
        and runtime.get('loaderUrl') == '/engine/sim/physics/physx-pe.mjs'
        and runtime.get('wasmUrl') == '/engine/sim/physics/physx-pe.wasm'
        and set(EXPORTS) <= set(build.get('expectedAddonExports', []) if source_build is None else source_build.exports), 'thermal diagnostic actual native identity differs')
    _section_require(native.get('numericalAdmission', {}).get('status') == 'DIAGNOSTIC_ONLY',
                     'thermal diagnostic cannot be promoted to an accuracy or production admission')
    served = proof['servedSourceHashes']
    fixtures = FIXTURES if source_build is None else {**FIXTURES, 'wood_thermal_mri_runtime.mjs': MRI_RUNTIME}
    for name, digest in fixtures.items():
        matches = [value for key, value in served.items() if key.rsplit('/', 1)[-1] == name]
        _section_require(matches == [digest], 'thermal fixed diagnostic fixture differs: ' + name)
    cases = _section_cases(proof, CASES)
    _section_require(set(cases) == CASES, 'thermal diagnostic case inventory differs')
    for mode in ('whole-interval', 'common-times'):
        for factor in (1, 4, 16):
            value = cases[f'coupled-radau-{mode}-tolerance-{factor}']
            _section_require(value.get('complete') is True and value.get('failure') is None
                and value.get('factor') == factor and value.get('mode') == mode,
                'thermal coupled diagnostic did not complete the original tolerance study')
    return {'schema': 'particle-physics-wood-thermal-diagnostics/v1', 'status': 'DIAGNOSTIC_ONLY',
        'artifactHashes': dict(pair), 'numericalVersion': 9, 'executedCases': len(CASES),
        'scope': 'Executed reduced layered-pine CPU-WASM diagnostics. Default disabled; no production coupling, global accuracy or real-time admission.'}
