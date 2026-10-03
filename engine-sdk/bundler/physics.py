# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""One verified PhysX/Blast/Flow asset inventory for source and compiled consumers."""
from __future__ import annotations

import hashlib
import json
import math
import re
from pathlib import Path, PurePosixPath

PHYSICS_ROOT = 'engine/sim/physics'
MANIFEST_PATH = PHYSICS_ROOT + '/runtime-manifest.json'
SDK_VERSION = '5.11.0'
UPSTREAM_COMMIT = 'da950a3537927784951853c66618036f332ca0ce'
FLOW_SCENE_CAPABILITIES = {
    'flowSceneAbi': 1, 'flowEmitterShapes': ['sphere', 'box'],
    'flowMultipleEmitters': True, 'flowLayers': True,
}
FLOW_SCENE_CASES = frozenset({
    'sphere-box-multiple-emitters', 'multiple-layer-velocity-isolation',
    'rotated-box-coverage', 'scene-transaction-rejection', 'independent-contexts',
    'layer-controls-removal', 'source-removal', 'default-layer-selection', 'cleanup',
    'zero-allocation-scale',
})
FLOW_GEOMETRY_CAPABILITIES = {
    'flowGeometryAbi': 1,
    'flowEmitterShapes': ['sphere', 'box', 'points', 'mesh'],
}
FLOW_GEOMETRY_CASES = frozenset({
    'points-native-emission', 'mesh-native-emission', 'geometry-transform-coverage',
    'vertex-velocity-attributes', 'geometry-replacement', 'mesh-topology-replacement',
    'geometry-transaction-rejection', 'native-geometry-rejection', 'geometry-removal',
    'mixed-layer-isolation', 'geometry-source-ownership', 'cleanup',
})
FLOW_COLLISION_CAPABILITIES = {
    'flowCollisionAbi': 1, 'flowColliderShapes': ['sphere', 'box'],
    'flowCollisionCoupling': 'one-way-velocity',
}
FLOW_COLLISION_CASES = frozenset({
    'sphere-static-velocity', 'box-moving-velocity', 'rotated-box-coverage',
    'collider-layer-isolation', 'collider-replacement-removal',
    'collider-source-ownership', 'collision-transaction-rejection',
    'native-collision-rejection', 'independent-contexts', 'cleanup',
})
BLAST_STRESS_CAPABILITIES = {
    'blastStressAbi': 1, 'blastStressBackend': 'scalar-cpu-wasm', 'blastStressUnits': 'Pa',
}
BLAST_STRESS_LEGACY_SOURCES = frozenset({
    'addons/blast/pr_blast_wasm.cpp', 'addons/blast/emscripten_nv_compat.h',
    'addons/blast/prepare_stress_sources.py', 'addons/blast/emscripten_stress_device.h',
    'addons/blast/emscripten_stress_intrinsics.h', 'addons/blast/tr1/type_traits',
})
BLAST_MEMORY_SOURCE = 'addons/blast/pr_blast_memory.h'
BLAST_STRESS_SOURCES = BLAST_STRESS_LEGACY_SOURCES | {BLAST_MEMORY_SOURCE}
BLAST_STRESS_CASES = frozenset({
    'axial-force-area', 'area-scaling', 'anchor-vs-freefall',
    'compression-tension-shear', 'partial-area-damage', 'transient-load-clear',
    'split-lifecycle-cleanup', 'raw-abi-admission',
})
BLAST_STRESS_FAMILY_CASES = frozenset({
    'physical-schema-rejection', 'ordered-stress-snapshot-replay',
    'stress-readback-failure-replay', 'legacy-v1-preserved', 'iterative-warm-start-replay',
})
BLAST_AUTHORING_CAPABILITIES = {'blastAuthoringAbi': 1}
BLAST_SECTIONS_CAPABILITIES = {
    'blastPhysicalStressAbi': 1, 'blastStressSectionsAbi': 1,
    'blastStressNumericalRevisions': [1, 2],
    'blastPhysicalStressRelativeTolerance': 9.999999974752427e-7,
}
BLAST_SECTIONS_SOURCES = BLAST_STRESS_SOURCES | frozenset({
    'addons/blast/physical_stress_extension.py', 'addons/blast/section_stress_extension.py',
    'addons/blast/pr_blast_section_matrix.h', 'addons/blast/pr_blast_section_solver.h',
})
BLAST_SECTIONS_ADDED_SOURCES = frozenset({
    'addons/blast/physical_stress_extension.py', 'addons/blast/section_stress_extension.py',
    'addons/blast/pr_blast_section_matrix.h', 'addons/blast/pr_blast_section_solver.h',
    'build_stress_candidate.py', 'build_unified_candidate.py',
})
BLAST_SECTIONS_ROLES = frozenset({
    'manufactured', 'fullGraphNative', 'fullGraphComparison', 'fullGraphPolicy1', 'scene', 'idle', 'impact', 'liveUi',
})
SECTIONS_BASELINE_PROOFS = frozenset({
    'candidate-browser.json', 'unified-browser.json', 'flow-host-browser.json',
    'flow-scene-browser.json', 'flow-geometry-browser.json', 'flow-collision-browser.json',
    'blast-stress-browser.json', 'blast-authoring-browser.json', 'engine-acceptance.json',
    'flow-wgsl-modules.json', 'flow-wgsl-selected-pipelines.json', 'sph-playground-verified.json', 'upgrade-511.json',
})
BLAST_AUTHORING_SOURCES = BLAST_STRESS_SOURCES | frozenset({
    'addons/blast/pr_blast_authoring.cpp', 'addons/blast/prepare_authoring_sources.py',
})
BLAST_AUTHORING_CASES = frozenset({
    'convex-voronoi-volume', 'closed-chunk-meshes', 'bond-area-normal-centroid',
    'authored-family-fracture', 'authored-family-stress', 'deterministic-repeat',
    'raw-abi-admission', 'cleanup',
})
BLAST_MASS_CAPABILITIES = {'blastMassAbi': 1, 'flowConvexBoundaryAbi': 1}
BLAST_MASS_SOURCES = BLAST_AUTHORING_SOURCES | {'bridge/pr_bulk_rust.cpp'}
BLAST_MASS_CASES = frozenset({
    'default-scene-retains-legacy-snapshot-and-mass',
    'unequal-chunk-mass-produces-exact-box-inertia-despite-coalesced-collider',
    'progressive-mass-loss-keeps-material-velocities-and-fracture-momentum',
    'invalid-masses-and-native-mass-failure-preserve-the-existing-scene',
    'explicit-convex-chunk-mass-and-fracture-use-cooked-hulls',
    'live-native-stress-masses-gravity-and-replay-stay-consistent',
    'failed-live-stress-mass-update-rolls-back-dynamic-com-inertia-and-motion',
    'isolated-positive-residue-transfers-ownership-and-never-restores-its-old-collider',
    'all-released-material-restores-an-empty-owned-scene-without-losing-residue',
    'actual-scaled-convex-planes-and-bounds',
})
FLOW_SOLID_CAPABILITIES = {
    'flowSolidBoundaryAbi': 1, 'flowSolidShapes': ['sphere', 'box', 'plane', 'convex'],
    'flowSolidCoupling': 'one-way-solid-boundary', 'flowSolidShaderModules': 21,
}
FLOW_SOLID_NATIVE_SOURCES = frozenset({
    'addons/flow/pr_flow_host.cpp', 'addons/flow/solid_geometry.h', 'addons/flow/solid_operators.h',
})
FLOW_SOLID_ADDON_SOURCES = frozenset({
    'addons/flow/PrSolidBoundary.hlsli', 'addons/flow/PressureDivergenceCS.body.hlsli',
    'addons/flow/PressureJacobiCS.body.hlsli', 'addons/flow/PressureSubtractCS.body.hlsli',
    'addons/flow/compile_solid_wgsl.py', 'addons/flow/flow_solid_boundary.mjs',
    'addons/flow/flow_host_webgpu.mjs',
    'addons/flow/build_host.py', 'addons/flow/generate_host_headers.py',
    'addons/flow/solid_oracle.mjs', 'addons/flow/solid_browser_test.py',
    'addons/flow/velocity_gather_oracle.mjs', 'addons/flow/flow_scalar_sources.mjs',
})
FLOW_SOLID_CASES = frozenset({
    'solid-empty-scene-publication', 'solid-source-interior-exclusion', 'solid-presentation-query-parity',
    'solid-thin-slab-no-through', 'solid-rotated-slab-no-through', 'solid-real-aperture-transport',
    'solid-convex-no-through', 'solid-moving-translation', 'solid-moving-rotation',
    'solid-pressure-no-through-flow', 'solid-sparse-border-no-through', 'solid-layer-isolation',
    'solid-transaction-rejection', 'solid-sphere-native-exclusion', 'solid-plane-native-exclusion',
    'solid-velocity-gather-rejects-cross-wall-donors', 'solid-exact-requested-step-persists-after-removal',
    'solid-pressure-face-cache-matches-exact-geometry',
    'solid-stationary-bounds-preserve-translation-and-rotation-sweeps',
})
FLOW_SOLID_KERNELS = frozenset('addons/solid/Solid' + name + 'CS.wgsl' for name in (
    'AdvectionDensity1', 'AdvectionDensity2', 'AdvectionVelocity1', 'AdvectionVelocity2',
    'AdvectionDownsample', 'AdvectionFadeDensity', 'AdvectionFadeVelocity', 'AdvectionSimple',
    'PressureDivergence', 'PressureJacobi', 'PressureSubtract', 'EmitterSimple', 'EmitterBox',
    'EmitterMeshApply', 'EmitterNanoVdb2', 'EmitterPoint3', 'EmitterPoint4',
    'EmitterPointClearDownsample', 'EmitterPointClearMarked', 'EmitterTexture', 'Vorticity2',
))
FLOW_SCALAR_CAPABILITIES = {
    'flowScalarSourceAbi': 1, 'flowScalarShaderModules': 4,
    'flowScalarSourceMode': 'finite-additive-with-receipts',
}
FLOW_SCALAR_NATIVE_SOURCES = FLOW_SOLID_NATIVE_SOURCES | frozenset({
    'addons/flow/scalar_sources_types.h', 'addons/flow/scalar_sources_impl.h',
})
FLOW_SCALAR_KERNEL_NAMES = ('PrScalarAdmitCS', 'PrScalarCountCS', 'PrScalarApplyCS', 'PrScalarReceiptCS')
FLOW_SCALAR_KERNELS = frozenset('addons/scalar/' + name + '.wgsl' for name in FLOW_SCALAR_KERNEL_NAMES)
FLOW_SCALAR_ADDON_SOURCES = frozenset({
    'addons/flow/scalar_sources_types.h', 'addons/flow/scalar_sources_impl.h',
    'addons/flow/PrScalarCommon.hlsli', 'addons/flow/PrSolidBoundary.hlsli',
    'addons/flow/compile_scalar_wgsl.py', 'addons/flow/flow_scalar_sources.mjs',
    'addons/flow/flow_solid_boundary.mjs', 'addons/flow/flow_host_webgpu.mjs',
    'addons/flow/build_host.py', 'addons/flow/generate_host_headers.py',
    'addons/flow/scalar_oracle.mjs', 'addons/flow/scalar_browser_test.py',
}) | frozenset('addons/flow/' + name + '.hlsl' for name in FLOW_SCALAR_KERNEL_NAMES)
FLOW_SCALAR_CASES = frozenset({
    'scalar-tiny-six-millimetre-source-does-not-require-a-cell-centre',
    'scalar-integrals-do-not-depend-on-cell-volume-or-timestep',
    'scalar-overlapping-sources-add-and-cooling-defers-unavailable-heat',
    'scalar-no-resident-fluid-fully-defers-finite-obligations',
    'scalar-solid-interior-and-occluded-cell-admission-are-rejected',
    'scalar-exposed-face-renormalizes-only-over-real-fluid-samples',
    'scalar-invalid-native-setter-is-atomic-and-retains-prior-source',
    'scalar-overflowing-positive-cell-sum-remains-finite-and-deferred',
})


def _verify_executed_cases(cases, required_cases, *, label, status_key='status', passed='PASS'):
    names = set()
    if not isinstance(cases, list):
        raise ValueError(f'{label} evidence is missing executed cases')
    for case in cases:
        if (not isinstance(case, dict) or not isinstance(case.get('name'), str)
                or not case['name'] or case['name'] in names
                or type(case.get(status_key)) is not type(passed) or case[status_key] != passed):
            raise ValueError(f'{label} evidence contains duplicate, failed or unexecuted cases')
        names.add(case['name'])
    if not required_cases <= names:
        raise ValueError(f'{label} evidence is missing required coverage')


def _verify_flow_feature_evidence(proof, artifact_hashes, bridge_sha256, host_source_sha256,
                                  *, abi_field, required_cases, label, require_result_abi=True):
    """Bind an additive Flow ABI to executed cases and exact compiled inputs."""
    if (not isinstance(proof, dict) or proof.get('status') != 'PASS'
            or proof.get('unified') is not True
            or type(proof.get(abi_field)) is not int or proof[abi_field] != 1
            or proof.get('artifactHashes') != artifact_hashes
            or proof.get('bridgeSha256') != bridge_sha256
            or not host_source_sha256 or proof.get('hostSourceSha256') != host_source_sha256
            or not isinstance(proof.get('adapter'), dict)
            or proof['adapter'].get('isFallbackAdapter') is not False
            or proof.get('pageErrors') != [] or proof.get('consoleErrors') != []
            or proof.get('gpuErrors') != []):
        raise ValueError(f'{label} capability is not backed by matching native/GPU evidence')
    result = proof.get('result')
    cases = result.get('cases') if isinstance(result, dict) else None
    cleanup = result.get('cleanup') if isinstance(result, dict) else None
    cleanup_passed = cleanup == 'PASS' or (isinstance(cleanup, dict) and cleanup.get('status') == 'PASS'
        and all(type(cleanup.get(name)) is int and cleanup[name] >= 0
                for name in ('nativeContextsBefore', 'nativeContextsAfter', 'ownedGpuResources'))
        and cleanup['nativeContextsBefore'] == cleanup['nativeContextsAfter'] and cleanup['ownedGpuResources'] == 0)
    if (not isinstance(cases, list) or not cleanup_passed
            or (require_result_abi and (type(result.get(abi_field)) is not int or result[abi_field] != 1))):
        raise ValueError(f'{label} evidence is missing executed cases or cleanup')
    _verify_executed_cases(cases, required_cases, label=label)


def verify_flow_scene_evidence(proof, artifact_hashes, bridge_sha256, host_source_sha256):
    """Verify the sphere/box scene ABI without requiring later optional ABIs."""
    _verify_flow_feature_evidence(proof, artifact_hashes, bridge_sha256, host_source_sha256,
                                 abi_field='flowSceneAbi', required_cases=FLOW_SCENE_CASES,
                                 label='Flow scene')


def verify_flow_geometry_evidence(proof, artifact_hashes, bridge_sha256, host_source_sha256):
    """Verify native point/mesh geometry separately from the sphere/box ABI."""
    _verify_flow_feature_evidence(proof, artifact_hashes, bridge_sha256, host_source_sha256,
                                 abi_field='flowGeometryAbi', required_cases=FLOW_GEOMETRY_CASES,
                                 label='Flow geometry')


def verify_flow_collision_evidence(proof, artifact_hashes, bridge_sha256, host_source_sha256):
    """Verify one-way native velocity obstacles without claiming solid coupling."""
    _verify_flow_feature_evidence(proof, artifact_hashes, bridge_sha256, host_source_sha256,
                                 abi_field='flowCollisionAbi', required_cases=FLOW_COLLISION_CASES,
                                 label='Flow collision')


def verify_flow_solid_corpus(corpus, file_hashes, addon_sources, original_corpus):
    """Verify the separate derived corpus without replacing the original 97."""
    rows = corpus.get('shaders') if isinstance(corpus, dict) else None
    if (not isinstance(corpus, dict) or type(corpus.get('abi')) is not int or corpus['abi'] != 1
            or not isinstance(rows, list) or len(rows) != len(FLOW_SOLID_KERNELS)
            or {row.get('wgsl') for row in rows if isinstance(row, dict)} != FLOW_SOLID_KERNELS):
        raise ValueError('Flow solid corpus has unsupported ABI or kernel inventory')
    inputs = corpus.get('sourceHashes', {})
    required = {'PrSolidBoundary.hlsli', 'PressureDivergenceCS.body.hlsli',
                'PressureJacobiCS.body.hlsli', 'PressureSubtractCS.body.hlsli', 'compile_solid_wgsl.py'}
    if (not isinstance(inputs, dict) or not required <= inputs.keys()
            or any(addon_sources.get('addons/flow/' + name) != digest for name, digest in inputs.items())):
        raise ValueError('Flow solid corpus was generated from different addon sources')
    for row in rows:
        if (not isinstance(row.get('derivedSourceSha256'), str)
                or re.fullmatch(r'[0-9a-f]{64}', row['derivedSourceSha256']) is None
                or original_corpus.get('inputHashes', {}).get(row.get('source')) != row.get('sourceSha256')
                or not row.get('sourceSha256')):
            raise ValueError('Flow solid corpus does not derive from the preserved source corpus')
        if row.get('reflection') != row['wgsl'].replace('.wgsl', '.reflection.json'):
            raise ValueError('Flow solid corpus reflection does not match its kernel')
        for suffix, field in [('wgsl', 'wgslSha256'), ('reflection', 'reflectionSha256')]:
            digest = row.get(field)
            if (not isinstance(digest, str) or re.fullmatch(r'[0-9a-f]{64}', digest) is None
                    or file_hashes.get('flow-wgsl/' + row[suffix]) != digest):
                raise ValueError('Flow solid corpus is not bound to the runtime inventory')


def verify_flow_solid_evidence(proof, artifact_hashes, bridge_sha256, bridge_sources, addon_sources, file_hashes):
    """Require full native transport/pressure proof; shader preflights cannot pass."""
    _verify_flow_addon_evidence(proof, artifact_hashes, bridge_sha256, bridge_sources, addon_sources, file_hashes,
        abi_field='flowSolidBoundaryAbi', required_cases=FLOW_SOLID_CASES, label='Flow solid',
        native_sources=FLOW_SOLID_NATIVE_SOURCES, addon_required=FLOW_SOLID_ADDON_SOURCES,
        helpers=('flow_host_webgpu.mjs', 'flow_solid_boundary.mjs'))


def verify_flow_scalar_evidence(proof, artifact_hashes, bridge_sha256, bridge_sources, addon_sources, file_hashes):
    """Require actual conservative deposits, receipts and exact boundary admission."""
    _verify_flow_addon_evidence(proof, artifact_hashes, bridge_sha256, bridge_sources, addon_sources, file_hashes,
        abi_field='flowScalarSourceAbi', required_cases=FLOW_SCALAR_CASES, label='Flow scalar',
        native_sources=FLOW_SCALAR_NATIVE_SOURCES, addon_required=FLOW_SCALAR_ADDON_SOURCES,
        helpers=('flow_host_webgpu.mjs', 'flow_solid_boundary.mjs', 'flow_scalar_sources.mjs'))


def _verify_flow_addon_evidence(proof, artifact_hashes, bridge_sha256, bridge_sources, addon_sources, file_hashes,
                               *, abi_field, required_cases, label, native_sources, addon_required, helpers,
                               require_result_abi=True, runtime_prefix='/dist/candidate/', runtime_hashes=None):
    if not isinstance(bridge_sources, dict):
        raise ValueError(f'{label} evidence is missing native source provenance')
    _verify_flow_feature_evidence(proof, artifact_hashes, bridge_sha256,
                                 bridge_sources.get('addons/flow/pr_flow_host.cpp'),
                                 abi_field=abi_field, required_cases=required_cases, label=label,
                                 require_result_abi=require_result_abi)
    for field, sources, required in [('bridgeSources', bridge_sources, native_sources),
                                     ('addonSourceHashes', addon_sources, addon_required)]:
        if (not isinstance(sources, dict) or not required <= sources.keys()
                or any(not isinstance(digest, str) or re.fullmatch(r'[0-9a-f]{64}', digest) is None for digest in sources.values())
                or proof.get(field) != sources or proof.get(field + 'After') != sources):
            raise ValueError(f'{label} evidence has changed or missing source provenance')
    served = proof.get('servedSourceHashes')
    if (proof.get('quick') is not False or proof.get('httpErrors') != [] or proof.get('requestFailures') != []
            or not isinstance(served, dict) or proof.get('servedSourceHashesAfter') != served
            or proof.get('corpusSha256') != file_hashes.get('flow-wgsl/manifest.json')):
        raise ValueError(f'{label} evidence is partial or has changed served inputs')
    required_runtime = {runtime_prefix + name: digest for name, digest in artifact_hashes.items()}
    runtime_served = served if runtime_hashes is None else runtime_hashes
    if (not isinstance(runtime_served, dict)
            or (runtime_hashes is not None and runtime_served != required_runtime)
            or any(not digest or runtime_served.get(path) != digest for path, digest in required_runtime.items())):
        raise ValueError(f'{label} evidence served different native runtime bytes')
    required_served = {'/addons/flow/' + name: file_hashes.get('addons/' + name) for name in helpers}
    required_served.update({'/dist/' + name: digest for name, digest in file_hashes.items() if name.startswith('flow-wgsl/')})
    if any(not digest or served.get(path) != digest for path, digest in required_served.items()):
        raise ValueError(f'{label} evidence served different native, addon or shader bytes')


def verify_flow_scalar_corpus(corpus, file_hashes, sources):
    """Pin all four source operators and reflections without changing Flow's corpus."""
    rows = corpus.get('shaders') if isinstance(corpus, dict) else None
    if (not isinstance(corpus, dict) or type(corpus.get('abi')) is not int or corpus['abi'] != 1
            or not isinstance(rows, list) or len(rows) != len(FLOW_SCALAR_KERNELS)
            or {row.get('wgsl') for row in rows if isinstance(row, dict)} != FLOW_SCALAR_KERNELS):
        raise ValueError('Flow scalar corpus has unsupported ABI or kernel inventory')
    inputs = corpus.get('sourceHashes', {})
    required = {'PrScalarCommon.hlsli', 'PrSolidBoundary.hlsli', 'scalar_sources_types.h', 'scalar_sources_impl.h', 'compile_scalar_wgsl.py'}
    required.update(name + '.hlsl' for name in FLOW_SCALAR_KERNEL_NAMES)
    if (not isinstance(inputs, dict) or not required <= inputs.keys()
            or any(sources.get('addons/flow/' + name) != digest for name, digest in inputs.items())):
        raise ValueError('Flow scalar corpus was generated from different addon sources')
    for row in rows:
        expected_source = 'addons/flow/' + PurePosixPath(row['wgsl']).stem + '.hlsl'
        if (row.get('source') != expected_source or not row.get('sourceSha256')
                or row['sourceSha256'] != sources.get(expected_source)
                or row.get('reflection') != row['wgsl'].replace('.wgsl', '.reflection.json')):
            raise ValueError('Flow scalar corpus source or reflection does not match its kernel')
        for suffix, field in [('wgsl', 'wgslSha256'), ('reflection', 'reflectionSha256')]:
            digest = row.get(field)
            if (not isinstance(digest, str) or re.fullmatch(r'[0-9a-f]{64}', digest) is None
                    or file_hashes.get('flow-wgsl/' + row[suffix]) != digest):
                raise ValueError('Flow scalar corpus is not bound to the runtime inventory')


def _verify_blast_feature_evidence(proof, artifact_hashes, bridge_sources,
                                   *, required_sources, label, runtime_prefix):
    """Bind native Blast proofs to served bytes and unchanged compiled inputs."""
    if (not isinstance(proof, dict) or proof.get('status') != 'PASS'
            or proof.get('unified') is not True
            or proof.get('artifacts') != artifact_hashes or proof.get('artifactsAfter') != artifact_hashes
            or not isinstance(bridge_sources, dict) or set(bridge_sources) != required_sources
            or any(not isinstance(value, str) or re.fullmatch(r'[0-9a-f]{64}', value) is None
                   for value in bridge_sources.values())
            or proof.get('bridgeSources') != bridge_sources or proof.get('bridgeSourcesAfter') != bridge_sources
            or proof.get('pageErrors') != [] or proof.get('consoleErrors') != []):
        raise ValueError(f'{label} capability is not backed by matching native evidence')
    served = proof.get('servedSourceHashes', {})
    if not isinstance(served, dict) or any(served.get(runtime_prefix + name) != digest
                                          for name, digest in artifact_hashes.items()):
        raise ValueError(f'{label} evidence served a different native runtime pair')
    return proof.get('numerical')


def verify_blast_stress_evidence(proof, artifact_hashes, bridge_sources):
    """Require numerical native ExtStress proof for this exact unified build."""
    # Historical installed builds retain their exact six-input provenance. New
    # installs always supply the current set, including the shared ABI guard.
    required_sources = (BLAST_STRESS_LEGACY_SOURCES
                        if isinstance(bridge_sources, dict) and set(bridge_sources) == BLAST_STRESS_LEGACY_SOURCES
                        else BLAST_STRESS_SOURCES)
    result = _verify_blast_feature_evidence(proof, artifact_hashes, bridge_sources,
                                           required_sources=required_sources,
                                           label='Blast stress', runtime_prefix='/stress-runtime/')
    if (not isinstance(result, dict) or result.get('passed') is not True
            or type(result.get('abi')) is not int or result['abi'] != 1
            or result.get('backend') != 'NVIDIA ExtStress scalar CPU/WASM'
            or result.get('stressUnits') != 'Pa' or result.get('forceUnits') != 'N'
            or result.get('remainingHealthUnits') != 'm2'
            or result.get('damageCadence') != 'per native update'):
        raise ValueError('Blast stress evidence has unsupported ABI/backend/physical units')
    _verify_executed_cases(result.get('cases'), BLAST_STRESS_CASES,
                           label='Blast stress', status_key='passed', passed=True)
    family = result.get('family')
    if not isinstance(family, dict) or family.get('passed') is not True:
        raise ValueError('Blast stress evidence is missing physical-family integration')
    _verify_executed_cases(family.get('cases'), BLAST_STRESS_FAMILY_CASES,
                           label='Blast stress family', status_key='passed', passed=True)


def verify_blast_authoring_evidence(proof, artifact_hashes, bridge_sources):
    """Require real convex Voronoi meshes, bond geometry and authored families."""
    result = _verify_blast_feature_evidence(proof, artifact_hashes, bridge_sources,
                                           required_sources=BLAST_AUTHORING_SOURCES,
                                           label='Blast authoring', runtime_prefix='/authoring-runtime/')
    if (type(proof.get('blastAuthoringAbi')) is not int or proof['blastAuthoringAbi'] != 1
            or not isinstance(result, dict) or result.get('passed') is not True
            or type(result.get('abi')) is not int or result['abi'] != 1
            or result.get('backend') != 'NVIDIA ExtAuthoring CPU/WASM'):
        raise ValueError('Blast authoring evidence has unsupported ABI/backend')
    _verify_executed_cases(result.get('cases'), BLAST_AUTHORING_CASES,
                           label='Blast authoring', status_key='passed', passed=True)


def verify_blast_mass_evidence(proof, artifact_hashes, bridge_sources):
    """Require changing physical masses, replay, ash transfer and scaled hulls."""
    result = _verify_blast_feature_evidence(proof, artifact_hashes, bridge_sources,
                                           required_sources=BLAST_MASS_SOURCES,
                                           label='Blast mass', runtime_prefix='/engine/sim/physics/')
    if (not isinstance(result, dict) or result.get('status') != 'PASS'
            or result.get('cleanup') != 'PASS' or proof.get('sourceUnchanged') is not True
            or proof.get('servedSourceHashesAfter') != proof.get('servedSourceHashes')
            or proof.get('httpErrors') != [] or proof.get('requestFailures') != []
            or any(type(result.get(key)) is not int or result[key] != 1 for key in BLAST_MASS_CAPABILITIES)):
        raise ValueError('Blast mass evidence has unsupported ABI, cleanup or source state')
    _verify_executed_cases(result.get('cases'), BLAST_MASS_CASES, label='Blast mass')


def _section_require(condition, message):
    if not condition:
        raise ValueError('Blast sections: ' + message)


def _section_number(value, *, minimum=0, maximum=math.inf):
    return type(value) in (int, float) and math.isfinite(value) and minimum <= value <= maximum


def _section_integer(value, *, minimum=0, maximum=9007199254740991):
    return type(value) is int and minimum <= value <= maximum


def _section_exact(value, expected):
    """JSON identity includes types: True is not an ABI number or work count."""
    return json.dumps(value, sort_keys=True, allow_nan=False) == json.dumps(expected, sort_keys=True, allow_nan=False)


def _section_stable(proof):
    _section_require(isinstance(proof, dict) and proof.get('status') == 'PASS', 'failed or missing receipt')
    hashes = proof.get('sourceHashes')
    _section_require(isinstance(hashes, dict) and bool(hashes)
        and proof.get('sourceHashesAfter') == hashes and proof.get('sourceUnchanged') is True
        and all(isinstance(h, str) and re.fullmatch(r'[0-9a-f]{64}', h) for h in hashes.values()),
        'missing or changed source closure')
    _section_require(not proof.get('changedServedSources'), 'served source drift')


def _section_browser(proof, artifacts):
    _section_stable(proof)
    _section_require(all(proof.get(key) == [] for key in
        ('pageErrors', 'consoleErrors', 'httpErrors', 'requestFailures')), 'browser errors or absent diagnostics')
    served = proof.get('servedSourceHashes', {})
    _section_require(all(served.get('/engine/sim/physics/' + name) == digest for name, digest in artifacts.items()),
        'receipt did not execute the exact unified runtime pair')
    _section_require(proof.get('standaloneRuntime') is None and proof.get('thermalPrototype') is None,
        'standalone or thermal proof cannot authorize unified promotion')


def _section_cases(proof, required):
    native = proof.get('native', {})
    _section_require(native.get('status') == 'PASS', 'native execution did not finish')
    cases = native.get('cases')
    _verify_executed_cases(cases, required, label='Blast sections')
    return {case['name']: case.get('evidence', {}) for case in cases}


def _verify_sections_manufactured(proof):
    """The frozen legacy/physical/section2 suite, shared without rewriting proof metadata."""
    manufactured_names = {
        'legacy-native-stress-regression', 'legacy-engine-stress-replay-regression',
        'physical-load-equilibrium-and-replay', 'original-physical-revision1-bit-exact-baseline-parity',
        'sections-version6-rejects-actual-old-native-before-replay',
        'sections-empty-checkpoint-replays-its-exact-changed-operator',
        'sections-replay-binds-empty-and-accepted-section-identity',
        'sections-accepted-replay-detects-changed-traction-reconstruction',
        'sections-pending-resume-changed-load-and-accepted-cache',
        'sections-topology-change-invalidates-results-and-cold-restarts',
        'sections-malformed-input-rejected-without-ownership-leak',
        'sections-native-configuration-rejection-is-atomic-and-retryable',
        'sections-native-preflight-and-output-capacities-never-partially-write',
        'sections-finite-overflow-is-terminal-without-authoritative-damage',
        'sections-nonrepresentable-positive-stiffness-fails-without-regularization',
        'sections-tiny-positive-cross-term-rounding-retains-all-physical-modes',
    } | {'sections-independent-' + name for name in (
        'parallel-area-one-to-four', 'eccentric-rectangle-corner-tractions', 'rectangle-split-triangles',
        'rectangle-split-quarters', 'rotated-translated-rectangle', 'unequal-mass-uniform-freefall',
        'six-body-pending-and-restart-chain', 'parallel-native-path-area-one-to-four')}
    manufactured = _section_cases(proof, manufactured_names)
    raw_manufactured = {row['name']: row for row in proof['native']['cases']}
    for name, coverage in (
            ('legacy-native-stress-regression', BLAST_STRESS_CASES),
            ('legacy-engine-stress-replay-regression', BLAST_STRESS_FAMILY_CASES)):
        evidence = manufactured[name]
        _section_require(raw_manufactured[name].get('bitExactInstalledBaseline') is True
            and evidence.get('passed') is True, 'legacy results were not compared exactly with the installed baseline')
        _verify_executed_cases(evidence.get('cases'), coverage,
            label='Exact installed legacy parity', status_key='passed', passed=True)
        _section_require(len(evidence['cases']) == len(coverage), 'legacy parity coverage differs from the original suite')
    original_pair = {
        'physx-pe.mjs': {'bytes': 4840223, 'sha256': 'b36b8adc71267086e509b1c2ff244f4afd98c0f67afade632d220c06930555fc'},
        'physx-pe.wasm': {'bytes': 6951786, 'sha256': '1eed563e9bd743c9ce539f239174c63d1f2db2ab1658ba35af2880101d71fc43'},
    }
    original = proof.get('physicalBaselineRuntime', {})
    _section_require(original.get('loaderUrl') == '/physical-baseline-runtime/physx-pe.mjs'
        and _section_exact(original.get('build', {}).get('artifacts'), original_pair)
        and all(proof.get('servedSourceHashes', {}).get('/physical-baseline-runtime/' + name) == record['sha256']
            for name, record in original_pair.items()), 'original physical parity used a different comparison runtime')
    parity = manufactured['original-physical-revision1-bit-exact-baseline-parity']
    _section_require(parity.get('bitExact') is True and parity.get('cases') == 8,
        'original physical algorithm differs from its admitted baseline')
    physical = manufactured['physical-load-equilibrium-and-replay']
    _section_require(physical.get('passed') is True, 'original physical mode failed')
    _verify_executed_cases(physical.get('cases'), {
        'physical-load-mode-validates-and-never-falls-back', 'physical-initial-checkpoint-binds-exact-native-tolerance',
        'unequal-mass-supported-chain-analytic-axial-force', 'authored-eccentric-cut-preserves-force-and-moment',
        'unequal-mass-uniform-freefall-has-zero-internal-wrench', 'pending-physical-solve-preserves-area-ownership-and-replay',
        'physical-and-legacy-update-modes-reject-cross-use', 'finite-overflow-is-terminal-without-health-or-ownership-mutation',
    }, label='Original physical stress', status_key='passed', passed=True)
    cleanup = proof['native'].get('sectionCleanup', {})
    _section_require(type(cleanup.get('nativeFamiliesBefore')) is int
        and cleanup['nativeFamiliesBefore'] == cleanup.get('nativeFamiliesAfter') == 0, 'manufactured ownership leak')


def _verify_sections_impact(proof):
    """Unchanged actual CCD, material mass, energy, floor and completed CPU clock gates."""
    impacts = _section_cases(proof, {'baseball-default-spin', 'heavy-zero-spin-control', 'heavy-three-spinning-shots'})
    impact_cleanup = proof['native'].get('cleanup', {})
    _section_require(impact_cleanup.get('destroyed') is True and impact_cleanup.get('completedCases') == 3
        and impact_cleanup.get('bodies') == impact_cleanup.get('families') == 0, 'impact ownership leak or incomplete workload')
    for name, impact in impacts.items():
        _section_require(impact.get('allCcdRetained') is True and impact.get('minimumRequiredCpuRate') == .95
            and _section_number(impact.get('cpuOnlySimulationRate'), minimum=.95), 'impact physics or performance incomplete')
        if name.startswith('heavy-'):
            _section_require(impact.get('stats', {}).get('brokenBonds', 0) > 0, 'impact never exercised fracture')
        before, after = impact.get('initial', {}), impact.get('final', {})
        configuration = {
            'baseball-default-spin': {'name': name, 'kind': 'baseball', 'spinRpm': 1800, 'steps': 180, 'shots': 1},
            'heavy-zero-spin-control': {'name': name, 'kind': 'test-sphere', 'spinRpm': 0, 'steps': 90, 'shots': 1},
            'heavy-three-spinning-shots': {'name': name, 'kind': 'test-sphere', 'spinRpm': 1800, 'steps': 240, 'shots': 3},
        }[name]
        _section_require(_section_exact(impact.get('configuration'), configuration)
            and _section_number(impact.get('elapsedMs'), minimum=1)
            and impact.get('simulatedSeconds') == configuration['steps'] / 120
            and abs(impact['simulatedSeconds'] * 1000 / impact['elapsedMs'] - impact['cpuOnlySimulationRate']) < 1e-10,
            'impact completed-time measurement differs')
        for material in ('clay', 'mortar'):
            a, b = before.get('massByMaterialKg', {}).get(material), after.get('massByMaterialKg', {}).get(material)
            _section_require(_section_number(a, minimum=1e-12) and _section_number(b)
                and abs(a - b) <= 1e-8, 'physical impact material mass changed')
        _section_require(_section_number(before.get('totalJ')) and _section_number(after.get('totalJ'))
            and _section_number(impact.get('additionalLaunchEnergyJ'))
            and after['totalJ'] <= (before['totalJ'] + impact['additionalLaunchEnergyJ']) * 1.02
            and _section_number(after.get('minY'), minimum=-.01), 'impact energy or floor crossing failed')


def _verify_sections_live_ui(ui, *, revision=2):
    """Unchanged coupled-clock/visual evidence; numerical identity is explicit."""
    tolerance = BLAST_SECTIONS_CAPABILITIES['blastPhysicalStressRelativeTolerance']
    _section_require(ui.get('performanceAcceptance') is True and not ui.get('performanceFailures')
        and ui.get('timestampInstrumentation') is False and ui.get('thermalReplayInstrumentation') is False
        and ui.get('profileOnly') is False and ui.get('masonryControls') is True
        and ui.get('nativeAfter') == {'flow': 0, 'blast': 0, 'authoring': 0}
        and ui.get('visualReview', {}).get('status') == 'PASS'
        and len(ui.get('visualReview', {}).get('checks', [])) == 3, 'UI performance, visual review or cleanup incomplete')
    photographs = ui.get('screenshots', [])
    required_photos = {'masonry-intact-front-closeup', 'masonry-heavy-angular-fragments-residue', 'masonry-heavy-settled-debris-stage'}
    _section_require(required_photos <= {p.get('name') for p in photographs}
        and all(isinstance(p.get('path'), str) and isinstance(p.get('sha256'), str)
            and re.fullmatch(r'[0-9a-f]{64}', p['sha256']) for p in photographs), 'visual review lacks retained photographs')
    _verify_executed_cases(ui.get('cases'), {'sandbox-import-and-catalog-discovery',
        'masonry-intact-native-inventory-and-front-view', 'masonry-real-baseball-contact',
        'masonry-heavy-spin-fracture-and-mortar-inventory', 'masonry-native-cleanup'}, label='Masonry live UI')
    identity = ui.get('masonryPhysicalStress', {})
    _section_require(identity.get('numericalRevision') == revision and identity.get('sectionsAbi') == 1
        and identity.get('relativeSolverTolerance') == tolerance, 'UI numerical identity mismatch')
    phases = ui.get('phases', [])
    for name in ('masonry-intact-smoke', 'masonry-after-baseball-smoke', 'masonry-three-heavy-impacts-smoke'):
        found = [p for p in phases if p.get('name') == name]
        _section_require(len(found) == 1, 'missing or duplicate realtime phase')
        phase = found[0]; summary = phase.get('summary', {})
        _section_require(_section_number(summary.get('wallSeconds'), minimum=10)
            and _section_number(summary.get('completedSimulationSecondsPerWallSecond'), minimum=.95, maximum=1.05),
            'realtime completed-clock rate failed')
        _section_require(_section_number(phase.get('started')) and _section_number(phase.get('finished'))
            and abs((phase['finished'] - phase['started']) / 1000 - summary['wallSeconds']) < 1e-10,
            'UI wall interval does not match measured endpoints')
        before, after = phase.get('initial', {}), phase.get('final', {})
        delta = lambda key: after.get(key, math.nan) - before.get(key, math.nan)
        steps = delta('completedSteps'); seconds = delta('completedSimulationSeconds')
        _section_require(_section_integer(steps, minimum=1) and _section_number(seconds)
            and delta('completedPhysicsSteps') == 2 * steps and delta('completedFlowFrames') == steps
            and abs(seconds - steps / 60) < 1e-6 and before.get('paused') is False and after.get('paused') is False
            and before.get('blast', {}).get('generation') == after.get('blast', {}).get('generation')
            and after.get('flow', {}).get('status') == 'running'
            and abs(seconds / summary['wallSeconds'] - summary['completedSimulationSecondsPerWallSecond']) < 1e-10,
            'UI completed clocks or coupled cadence differ')



def verify_blast_sections_evidence(proofs, artifact_hashes, build):
    """Admit real unified receipts; diagnostic success alone never means realtime.

    The installer resolves immutable receipt paths and rechecks their source
    files. Release inventory verification repeats numerical/coverage checks on
    those exact stored receipts, without depending on an external workbench.
    """
    _section_require(isinstance(proofs, dict) and set(proofs) == BLAST_SECTIONS_ROLES,
                     'unknown or missing proof roles')
    _section_require(_section_exact([build.get('physicalStressAbi'), build.get('sectionsAbi'),
            build.get('physicalNumericalRevisions')], [1, 1, [1, 2]])
        and build.get('physicalSolverRelativeTolerance') == 1e-6 and build.get('thermalIncluded') is False,
        'unsupported native capability, precision or thermal inclusion')
    sources = build.get('bridge_sources', {})
    _section_require(BLAST_SECTIONS_SOURCES <= sources.keys()
        and all(build.get('sources', {}).get(name) == sources[name] for name in BLAST_SECTIONS_SOURCES),
        'sections native inputs are missing from build provenance')
    for role, proof in proofs.items():
        _section_stable(proof) if role in ('fullGraphComparison', 'fullGraphPolicy1') else _section_browser(proof, artifact_hashes)
    _verify_sections_manufactured(proofs['manufactured'])
    _section_cases(proofs['scene'], {'original-physical-direct-scene-version5-remains-compatible',
        'sections-direct-scene-version6-empty-pending-converged-replay'})
    scene_cleanup = proofs['scene']['native'].get('cleanup', {})
    _section_require(scene_cleanup.get('destroyed') is True and all(scene_cleanup.get(key) == 0
        for key in ('bodies', 'meshes', 'liveFamilies')), 'scene ownership leak')
    native = _section_cases(proofs['fullGraphNative'], {'physical-same-load-gravity-stress-25-iterations'})
    graph = native['physical-same-load-gravity-stress-25-iterations']
    tolerance = BLAST_SECTIONS_CAPABILITIES['blastPhysicalStressRelativeTolerance']
    _section_require(graph.get('converged') is True and _section_exact(
            [graph.get('sectionsAbi'), graph.get('numericalRevision'), graph.get('iterations')], [1, 2, 25])
        and graph.get('relativeSolverTolerance') == tolerance and graph.get('productionPassBudgetSatisfied') is True
        and 0 < len(graph.get('passes', [])) <= 32, 'full graph did not converge in the production budget')
    progress = graph.get('physicalProgress', {})
    progress_keys = {'updatesLast', 'resumedLast', 'freshChecksLast', 'freshAcceptedLast',
                     'updatesTotal', 'resumedCallsTotal', 'freshChecksTotal', 'numericalRevision'}
    _section_require(set(progress) == progress_keys and all(_section_integer(v) for v in progress.values())
        and progress['freshAcceptedLast'] == 1 and progress['numericalRevision'] == 2
        and progress['freshChecksLast'] > 0 and progress['updatesLast'] <= 25
        and progress['resumedLast'] <= 1 and progress['updatesLast'] <= progress['updatesTotal'] <= 25 * len(graph['passes'])
        and progress['freshChecksLast'] <= progress['freshChecksTotal']
        and progress['resumedCallsTotal'] <= len(graph['passes']), 'no fresh original-gradient admission')
    fractions = graph.get('sectionDamageFractions')
    _section_require(isinstance(fractions, list) and len(fractions) == 19464
        and all(type(value) in (int, float) and value == 0 for value in fractions)
        and graph.get('changedCount') == 0 and graph.get('areaLostM2') == 0, 'unforced sections changed health')
    initial_areas = proofs['fullGraphNative']['native'].get('input', {}).get('initialAreasM2')
    _section_require(isinstance(initial_areas, list) and len(initial_areas) == 2534
        and graph.get('remainingAreasM2') == initial_areas
        and all(_section_number(value, minimum=0) for value in initial_areas), 'full graph health differs from captured input')
    _section_require(proofs['fullGraphNative']['native'].get('cleanup', {}).get('families') == 0,
        'full graph ownership leak')
    comparison = proofs['fullGraphComparison']
    pinned_comparison_inputs = {
        'masonry_section_comparison_policy.json': '688db37a30dceed44f7770f827dfd30ad76d9f8ba45951ce07c50c93555be437',
        'masonry_section_comparison_policy_02.json': '80fbf05936e4061ffd150427f91bbc449df04b776120bcedbe08e00dea51bb29',
        'masonry-section-graph-oracle-02.json': '95dd14670816c5d2aa4ea335a21ae73e41f73930ce7d0b70fa1004b169e269ca',
        'masonry-section-capture-02.json': '95e47ae65447c2a6c427e388249a14e3c22ffc18cf5aeeea6052f0c21b5aad39',
        'masonry-section-comparator-preparation-01.json': '5a8ce622715870503a064512687b7f6426657971fa8579ba7c1c8e0d8bb3240a',
        'compare_masonry_section_native_total.py': 'b12e9d3d1ece4a89a03b28319e9f6933589ea5f5b4a47c5f965b30e55c186aef',
        'compare_masonry_section_native.py': 'b4533c321929b1f1c3e819a4ec8b2ccb1e1c8e3751bbc87425aac1c1b640107c',
        'masonry-section-comparator-preparation-02.json': 'ba8bdfddb710935c98b1fa5697152ba6f4ce9d8f290f717bfbd50e4fc748ae9f',
    }
    for name, digest in pinned_comparison_inputs.items():
        matching = [value for key, value in comparison['sourceHashes'].items()
                    if key.replace('\\', '/').rsplit('/', 1)[-1] == name]
        _section_require(matching == [digest], 'predeclared comparison input changed: ' + name)
    measured = comparison.get('comparison', {})
    _section_require(measured == proofs['fullGraphPolicy1'].get('comparison'), 'policy1 comparison was not retained')
    gates = ('gradientEnvelopePass', 'reportedGradientPass', 'compatibilityPass', 'tractionReferencePass',
             'zeroIndependentSeverity', 'nativeSeverityExactlyZero', 'healthBitIdentical')
    _section_require(all(measured.get(key) is True for key in gates), 'independent comparison failed')
    for value, limit in (('reportedGradientNorm', 'reportedGradientLimit'),
                         ('compatibilityEnergyNormError', 'compatibilityEnergyNormBudget')):
        _section_require(_section_number(measured.get(value)) and _section_number(measured.get(limit))
            and measured[value] <= measured[limit], 'independent residual/compatibility limit exceeded')
    _section_require(_section_number(measured.get('maximumTractionErrorBudgetRatio'), maximum=1), 'traction limit exceeded')
    total = comparison.get('totalReferenceError', {})
    budget = 0.00002325878904230194
    _section_require(total.get('totalReferenceErrorPass') is True and total.get('relativeEnergyErrorBudget') == budget
        and comparison.get('policy', {}).get('totalRelativeEnergyErrorBudget') == budget
        and _section_number(total.get('relativeEnergyError'), maximum=budget)
        and comparison.get('productionPassBudgetSatisfied') is True
        and comparison.get('passes') == len(graph['passes']), 'total physical error or budget gate failed')
    idle = _section_cases(proofs['idle'], {'full-masonry-cooking-and-first-unforced-gravity-damage'})
    idle = idle['full-masonry-cooking-and-first-unforced-gravity-damage']
    _section_require(idle.get('firstPartialDamage') is None and idle.get('stepFailure') is None
        and idle.get('broken') == [] and len(idle.get('rows', [])) == 31, 'incomplete or damaging unforced idle')
    baseline = idle.get('baseline', {})
    _section_require(baseline.get('chunks') == baseline.get('cookedHulls') == 4074
        and baseline.get('intactCollisionShapes') == 994
        and _section_number(baseline.get('authoredMassKg'))
        and abs(baseline['authoredMassKg'] - 669.7366) < 1e-5, 'idle did not cook the full physical wall')
    for step, row in enumerate(idle['rows']):
        stats = row.get('stats', {})
        _section_require(row.get('step') == step and stats.get('stressNumericalRevision') == 2 and stats.get('stressSectionsAbi') == 1
            and stats.get('stressRelativeTolerance') == tolerance, 'idle used a different numerical operator')
    idle_cleanup = proofs['idle']['native'].get('cleanup', {})
    _section_require(idle_cleanup.get('destroyed') is True and idle_cleanup.get('bodies') == idle_cleanup.get('families') == 0,
        'idle ownership leak')
    _verify_sections_impact(proofs['impact'])
    _verify_sections_live_ui(proofs['liveUi'])


def verify_sections_baseline_evidence(proofs, artifacts, build, host_hash, corpus_hash, corpus, *, combined_shaders=None, combined_baseline=None, source_build=None):
    """Keep every installed baseline feature bound to the new unified pair."""
    if source_build is not None:
        from .source_build_numerical import checked
        source_build = checked(source_build)
        _section_require(combined_baseline is not None and combined_shaders is not None,
            'source-build baseline requires original aggregate and shader witnesses')
        source_build.admit_baseline(proofs['upgrade-511.json'], artifacts, build, combined_baseline)
    _section_require(set(proofs) == SECTIONS_BASELINE_PROOFS, 'unknown or missing baseline proof')
    pair = {name: value['sha256'] for name, value in artifacts.items()}
    candidate = proofs['candidate-browser.json']
    _section_require(candidate.get('status') == 'SMOKE_PASSED_NOT_RELEASE_CERTIFIED'
        and candidate.get('physicsExecuted') is True and candidate.get('artifactHashes') == artifacts
        and candidate.get('pageErrors') == [] and candidate.get('stderr') == [], 'candidate regression failed or stale')
    _verify_executed_cases(candidate.get('tests'), {
        'Matched loader/WASM hashes', 'Runtime version and required WebIDL API', 'Foundation, CPU scene and rigid bodies',
        'Free fall: one second without contact', 'Ground collision and resting height', 'Scene raycast hits the resting box',
        'Rust backend identity', 'Bulk addon: IDs, pose equality, removal', 'Regression API surface',
        'Zero-gravity constant velocity', 'Impulse follows inverse mass', 'Force accumulator clears after one step',
        'Angular rotation remains normalized', 'Sleep and explicit wake', 'Kinematic target and return to dynamic mode',
        'Raycast miss has no blocking hit', 'Static actor remains fixed', 'Bulk seven-component parity during motion',
        'Bulk contexts remain independent', 'Bulk capacity and unregister reuse', 'Bulk context lifecycle churn',
        'Actor, scene and SDK teardown', 'No SDK stderr diagnostics',
    }, label='Baseline PhysX')
    runtime = next(row for row in candidate['tests'] if row['name'] == 'Runtime version and required WebIDL API')
    _section_require(runtime.get('detail', {}).get('runtimeVersion') == SDK_VERSION, 'unexpected actual runtime version')
    unified = proofs['unified-browser.json']
    _section_require(unified.get('status') == 'UNIFIED_PHYSX_BLAST_FLOW_BROWSER_PASSED'
        and unified.get('artifactHashes') == artifacts, 'unified regression failed or stale')
    _verify_executed_cases(unified.get('tests'), {'PhysX and Rust bridge module identity',
        'Pinned Blast 5.0.6 in unified module', 'Blast asset, bond fracture and split in unified module',
        'Unified Flow staging ABI', 'WASM heap to WebGPU compute to WASM heap'}, label='Unified baseline')
    host = proofs['flow-host-browser.json']
    _section_require(host.get('status') == 'PASS' and host.get('unified') is True
        and host.get('artifactHashes') == pair and host.get('bridgeSha256') == host_hash
        and host.get('hostSourceSha256') == (build.get('bridge_sources', {}).get('addons/flow/pr_flow_host.cpp') if source_build is None else source_build.source_sha('addons/flow/pr_flow_host.cpp'))
        and host.get('result', {}).get('stats', {}).get('frames', 0) >= 120
        and host['result'].get('cleanup') == 'PASS' and host['result'].get('isolatedContexts') == 'PASS',
        'Flow host baseline failed or stale')
    for name, verifier in (('scene', verify_flow_scene_evidence), ('geometry', verify_flow_geometry_evidence),
                           ('collision', verify_flow_collision_evidence)):
        verifier(proofs['flow-' + name + '-browser.json'], pair, host_hash,
                 (build.get('bridge_sources', {}).get('addons/flow/pr_flow_host.cpp') if source_build is None else source_build.source_sha('addons/flow/pr_flow_host.cpp')))
    for name, sources, verifier in (('stress', BLAST_STRESS_SOURCES, verify_blast_stress_evidence),
                                    ('authoring', BLAST_AUTHORING_SOURCES, verify_blast_authoring_evidence)):
        verifier(proofs['blast-' + name + '-browser.json'], pair,
                 ({name: build.get('bridge_sources', {}).get(name) for name in sources} if source_build is None else source_build.sources(sources)))
    engine = proofs['engine-acceptance.json']
    _section_require(engine.get('status') == 'PASS' and engine.get('artifacts') == pair
        and engine.get('sourceUnchanged') is True and engine.get('servedSourceHashesAfter') == engine.get('servedSourceHashes'),
        'Engine baseline failed, changed or stale')
    pages = engine.get('pages', [])
    _section_require({p.get('page') for p in pages} == {'tests/physics/runtime-acceptance.html',
        'tests/realmforge/navi-body-physx-acceptance.html', 'tests/physics/consumer-acceptance.html',
        'tests/physics/flow-physx-collision.html'} and len(pages) == 4
        and all(p.get('status') == 'passed' and p.get('pageErrors') == p.get('consoleErrors') == [] for p in pages),
        'Engine baseline pages incomplete or emitted errors')
    runtime = json.loads(next(p['output'] for p in pages if p['page'] == 'tests/physics/runtime-acceptance.html'))
    _section_require(runtime.get('status') == 'PASS' and runtime.get('version') == SDK_VERSION, 'Engine runtime identity failed')
    _verify_executed_cases(runtime.get('cases'), {
        'Persistent Blast families split physical compounds and preserve motion',
        'Native authored Blast meshes preserve geometry, collision, motion and replay',
    }, label='Native Engine baseline')
    if combined_shaders is None:
        shaders = {record['wgsl']: record['wgslSha256'] for record in corpus.get('shaders', [])}
        _section_require(len(shaders) == 97, 'baseline shader corpus is incomplete')
        for name, expected in (('flow-wgsl-modules.json', 97), ('flow-wgsl-selected-pipelines.json', 96)):
            proof = proofs[name]
            _section_require(proof.get('manifestSha256') == corpus_hash and proof.get('passed') == expected
                and proof.get('failed') == 0 and proof.get('untested') == 0
                and not proof.get('separateAddonManifests'), 'Flow corpus coverage failed or includes pending addons')
            admitted = set(shaders) - (set() if expected == 97 else {'source/nvflowext/shaders/EmitterNanoVdbCS.wgsl'})
            _verify_executed_cases(proof.get('tests'), admitted, label='Flow shader corpus')
            _section_require(len(proof['tests']) == expected and all(row.get('sha256') == shaders.get(row['name'])
                and row.get('errors') == [] and row.get('validation') is None for row in proof['tests']),
                'Flow shader modules/pipelines were not the baseline corpus')
        modules = proofs['flow-wgsl-modules.json']; pipelines = proofs['flow-wgsl-selected-pipelines.json']
        _section_require(modules.get('candidateArtifacts') == pair
            and pipelines.get('excludedShaders') == ['source/nvflowext/shaders/EmitterNanoVdbCS.wgsl'], 'Flow execution pair/exclusion differs')
        execution = modules.get('execution', {})
        _section_require(execution.get('advection', {}).get('status') == 'FLOW_ADVECTION_KERNEL_PASSED'
            and execution['advection'].get('checked') == 512 and execution.get('meshScan', {}).get('status') == 'FLOW_MESH_SCAN_PASSED'
            and execution['meshScan'].get('checked') == 2048, 'Flow actual kernel execution incomplete')
    else:
        from .flow_combined import verify_combined_flow_shader_evidence
        expected_keys = {'raw_reports', 'witnesses', 'build', 'build_sha256', 'file_hashes', 'raw_corpora'}
        _section_require(isinstance(combined_shaders, dict) and set(combined_shaders) == expected_keys
            and _section_exact(combined_shaders['build'], build)
            and _section_exact(build.get('artifacts') if source_build is None else source_build.artifacts, artifacts), 'combined shader build differs from baseline')
        for role, name in (('modules', 'flow-wgsl-modules.json'), ('pipelines', 'flow-wgsl-selected-pipelines.json')):
            data = combined_shaders['raw_reports'].get(role)
            _section_require(type(data) is bytes and _section_exact(json.loads(data), proofs[name]),
                'combined shader raw receipt differs from baseline: ' + role)
        original = combined_shaders['raw_corpora'].get('original')
        _section_require(type(original) is bytes and hashlib.sha256(original).hexdigest() == corpus_hash
            and _section_exact(json.loads(original), corpus), 'combined shader corpus differs from baseline')
        verify_combined_flow_shader_evidence(**combined_shaders, source_build=source_build)
    sph = proofs['sph-playground-verified.json']
    _section_require(sph.get('status') == 'SPH_PLAYGROUND_PORT_INTEGRATION_PASSED'
        and all(sph.get('servedSourceHashes', {}).get('/port/dist/candidate/' + n) == h for n, h in pair.items()),
        'SPH used another pair or failed')
    _section_require(sph.get('integration', {}).get('status') == 'SPH_PLAYGROUND_PORT_INTEGRATION_PASSED'
        and sph['integration'].get('errors') == [] and sph.get('playground', {}).get('pageErrors') == []
        and sph['playground'].get('consoleErrors') == [], 'SPH browser or execution errors')
    cases = sph.get('integration', {}).get('cases', [])
    _section_require(len(cases) == 9 and len({c.get('name') for c in cases}) == 9
        and all(c.get('status') in ('PASS', 'FLOW_ADVECTION_KERNEL_PASSED') for c in cases), 'SPH coverage incomplete')
    cases = {c['name']: c for c in cases}
    _section_require(cases.get('sealed-pbf-baseline', {}).get('frames', 0) >= 600
        and cases.get('initial-state', {}).get('particles') == 65536
        and cases.get('game-existing-wasm-simd', {}).get('checked') == 196608
        and cases.get('game-existing-wasm-simd', {}).get('maximumError') == 0
        and len(sph.get('playground', {}).get('controlsPassed', [])) == 5, 'SPH baseline workload reduced')
    upgrade = proofs['upgrade-511.json']
    if combined_baseline is None:
        _section_require(upgrade.get('status') == 'UPGRADE_BUILD_AND_TESTS_PASSED_NOT_RELEASE_CERTIFIED'
            and upgrade.get('artifactHashes') == pair and upgrade.get('upstreamCommit') == UPSTREAM_COMMIT,
            'upgrade aggregate belongs to another pair')
    else:
        from .combined_baseline import BASELINE_ROLES, verify_combined_baseline_aggregate
        expected_keys = {'raw_bytes', 'raw_sha256', 'build_sha256', 'receipts', 'witnesses'}
        _section_require(isinstance(combined_baseline, dict) and set(combined_baseline) == expected_keys,
            'unknown or missing combined baseline aggregation inputs')
        retained = (verify_combined_baseline_aggregate(upgrade, artifacts, build, **combined_baseline)
            if source_build is None else source_build.admit_baseline(upgrade, artifacts, build, combined_baseline))
        for name, role in BASELINE_ROLES.items():
            _section_require(_section_exact(retained[role], proofs[name]),
                'combined baseline raw receipt differs from qualified baseline: ' + role)


def verify_sections_build(build, baseline):
    """The narrow relink changes only owned stress inputs from the installed baseline."""
    old = baseline.get('bridge_sources', {})
    current = build.get('bridge_sources', {})
    _section_require(len(old) == 16 and set(current) == set(old) | BLAST_SECTIONS_ADDED_SOURCES,
        'unknown or missing baseline/section bridge inputs')
    allowed_changed = {'addons/blast/pr_blast_wasm.cpp', 'addons/blast/prepare_stress_sources.py'}
    for name, digest in old.items():
        if name not in allowed_changed:
            _section_require(current.get(name) == digest, 'unrelated native source changed: ' + name)
    _section_require(all(build.get('sources', {}).get(name) == digest for name, digest in current.items()),
        'bridge input is absent from complete build closure')
    _section_require(build.get('thermalIncluded') is False and build.get('installedRuntimeModified') is False
        and build.get('status') == 'COMPILED_NOT_RUNTIME_TESTED', 'unsupported native build provenance')


def verify_sections_batch(witness, proofs, report_hashes, pair, build, *, source_build=None):
    """Bind every raw input and native build source to one actual stable batch."""
    _section_require(witness.get('schema') == 'particle-physics-sections-batch-witness/v1'
        and witness.get('status') == 'PASS' and witness.get('artifactHashes') == pair
        and witness.get('reports') == report_hashes, 'batch witness does not bind every exact proof')
    hashes = witness.get('sourceHashes')
    _section_require(isinstance(hashes, dict) and bool(hashes) and witness.get('sourceHashesAfter') == hashes
        and witness.get('sourceUnchanged') is True and all(isinstance(h, str) and re.fullmatch(r'[0-9a-f]{64}', h)
        for h in hashes.values()), 'batch sources changed or missing')
    def canonical(path):
        _section_require(isinstance(path, str), 'batch input has no physical file path')
        path = path.replace('\\', '/')
        path = re.sub(r'^/mnt/([a-z])/', lambda match: match[1].upper() + ':/', path)
        _section_require((path.startswith('/') or re.match(r'^[A-Za-z]:/', path))
            and '..' not in PurePosixPath(path).parts, 'batch input path must be absolute and canonical')
        return str(PurePosixPath(path))
    normalized = {canonical(name): value for name, value in hashes.items()}
    _section_require(len(normalized) == len(hashes), 'duplicate batch source aliases')
    mappings = witness.get('inputFiles', {})
    _section_require(set(mappings) == set(proofs) == set(report_hashes), 'batch proof input map differs')
    for name, proof in proofs.items():
        expected = {'source:' + key: value for key, value in proof.get('sourceHashes', {}).items()}
        expected.update({'served:' + key: value for key, value in proof.get('servedSourceHashes', {}).items()})
        if name == 'evidence/sections/liveUi.json':
            expected.update({'photograph:' + item['path']: item['sha256'] for item in proof.get('screenshots', [])})
        _section_require(isinstance(mappings[name], dict) and set(mappings[name]) == set(expected),
            'batch omitted or invented raw proof inputs: ' + name)
        for key, value in expected.items():
            _section_require(normalized.get(canonical(mappings[name][key])) == value, 'raw proof input missing from stable batch: ' + key)
    if source_build is not None:
        from .source_build_numerical import checked
        checked(source_build).require_build(build, pair)
        source_build.require_closure(hashes)
        return
    source_root = canonical(build.get('sourceRoot'))
    sources = build.get('sources', {})
    _section_require(isinstance(sources, dict) and bool(sources), 'native build source closure is missing')
    for name, value in sources.items():
        _section_require(isinstance(name, str) and not PurePosixPath(name).is_absolute()
            and normalized.get(canonical(source_root + '/' + name)) == value,
            'native build input missing from stable batch: ' + str(name))


def verify_sections_parity_baseline(manufactured, baseline, baseline_record):
    """The parity comparison must use the very installed bytes being replaced."""
    reference = manufactured.get('installedBaselineRuntime', {})
    capture = reference.get('capture', {})
    artifacts = {name: baseline.get('files', {}).get(name) for name in ('physx-pe.mjs', 'physx-pe.wasm')}
    _section_require(reference.get('loaderUrl') == '/installed-baseline-runtime/physx-pe.mjs'
        and capture.get('schema') == 'particle-realms.installed-runtime-capture/v1'
        and _section_exact(capture.get('artifacts'), artifacts)
        and _section_exact(capture.get('installedManifest'), baseline_record),
        'legacy parity capture differs from the installed baseline inventory')
    sources, served = manufactured.get('sourceHashes', {}), manufactured.get('servedSourceHashes', {})
    _section_require(sources.get('installed-baseline-runtime/runtime-manifest.json') == baseline_record['sha256']
        and all(isinstance(record, dict) and served.get('/installed-baseline-runtime/' + name) == record.get('sha256')
            and sources.get('installed-baseline-runtime/' + name) == record.get('sha256') for name, record in artifacts.items()),
        'legacy parity did not execute the installed capture pair')
    receipt_hash = reference.get('receiptSha256')
    _section_require(isinstance(receipt_hash, str) and re.fullmatch(r'[0-9a-f]{64}', receipt_hash)
        and any(name.startswith('installed-baseline-runtime/') and value == receipt_hash for name, value in sources.items()),
        'legacy parity capture receipt is not in the tested source closure')


def verify_sections_inventory(root, manifest, files):
    """A scoped release inherits baseline assets, never unrelated pending ABIs."""
    root = Path(root)
    def read(name):
        _section_require(name in files, 'evidence missing from inventory: ' + name)
        return json.loads((root / PHYSICS_ROOT / name).read_text())
    admission = read('evidence/sections-promotion.json')
    _section_require(admission.get('schema') == 'particle-physics-sections-admission/v1', 'unsupported admission schema')
    baseline_name = 'evidence/sections-baseline-manifest.json'
    baseline = read(baseline_name)
    _section_require(files[baseline_name]['sha256'] == admission.get('baselineManifestSha256')
        and baseline.get('schema') == 'particle-physics-runtime/v1' and baseline.get('sdkVersion') == SDK_VERSION
        and baseline.get('upstreamCommit') == UPSTREAM_COMMIT, 'baseline inventory identity differs')
    baseline_caps = baseline.get('capabilities', {})
    base_keys = {'rigidBodies', 'rustBulkAbi', 'bulkApiAbi', 'simd128', 'blastVersion', 'blastFractureSelfTest',
        'blastSceneApi', 'flowStagingAbi', 'flowShaderModules', 'flowSelectedPipelines', 'flowSolver', 'flowHostAbi',
        'flowExcludedPipeline'} | FLOW_SCENE_CAPABILITIES.keys() | FLOW_GEOMETRY_CAPABILITIES.keys() \
        | FLOW_COLLISION_CAPABILITIES.keys() | BLAST_STRESS_CAPABILITIES.keys() | BLAST_AUTHORING_CAPABILITIES.keys()
    _section_require(set(baseline_caps) == base_keys
        and _section_exact(manifest.get('capabilities'), {**baseline_caps, **BLAST_SECTIONS_CAPABILITIES}),
        'unknown, missing or pending capability claim')
    baseline_refs, section_refs = admission.get('baselineEvidence', {}), admission.get('sectionsEvidence', {})
    _section_require(set(baseline_refs) == SECTIONS_BASELINE_PROOFS and set(section_refs) == BLAST_SECTIONS_ROLES,
        'unknown or incomplete evidence inventory')
    referenced = {}
    def evidence(reference, expected_name):
        _section_require(isinstance(reference, dict) and set(reference) == {'file', 'sha256', 'originalPath'},
            'malformed immutable evidence reference')
        name = reference['file']
        _section_require(name == expected_name and name in files
            and reference['sha256'] == files[name]['sha256'] and isinstance(reference['originalPath'], str),
            'evidence hash or path differs')
        referenced[name] = reference['sha256']
        return read(name)
    baseline_proofs = {name: evidence(value, 'evidence/' + name) for name, value in baseline_refs.items()}
    section_proofs = {name: evidence(value, 'evidence/sections/' + name + '.json') for name, value in section_refs.items()}
    verify_sections_parity_baseline(section_proofs['manufactured'], baseline, files[baseline_name])
    build = read('evidence/candidate-rust-build.json')
    old_build = read('evidence/sections-baseline-build.json')
    _section_require(files['evidence/sections-baseline-build.json'] == baseline['files'].get('evidence/candidate-rust-build.json'),
        'baseline build provenance differs')
    verify_sections_build(build, old_build)
    for name, record in baseline.get('files', {}).items():
        if not name.startswith('evidence/') and name not in ('physx-pe.mjs', 'physx-pe.wasm'):
            _section_require(files.get(name) == record, 'unrelated baseline asset changed: ' + name)
    extra = {'evidence/sections-promotion.json', baseline_name, 'evidence/sections-baseline-build.json',
             'evidence/sections-batch-witness.json'} | referenced.keys()
    _section_require(set(files) == set(baseline['files']) | extra, 'unknown or missing release asset')
    artifacts = {name: files[name] for name in ('physx-pe.mjs', 'physx-pe.wasm')}
    _section_require(build.get('artifacts') == artifacts, 'sections build belongs to a different runtime')
    pair = {name: record['sha256'] for name, record in artifacts.items()}
    witness = read('evidence/sections-batch-witness.json')
    raw_proofs = {baseline_refs[name]['file']: proof for name, proof in baseline_proofs.items()}
    raw_proofs.update({section_refs[name]['file']: proof for name, proof in section_proofs.items()})
    verify_sections_batch(witness, raw_proofs, referenced, pair, build)
    comparison = section_proofs['fullGraphComparison']
    for role in ('fullGraphNative', 'fullGraphPolicy1'):
        ref = section_refs[role]
        if role == 'fullGraphNative':
            _section_require(comparison['sourceHashes'].get(ref['originalPath']) == ref['sha256'],
                'comparison did not read this native receipt')
        else:
            _section_require(comparison.get('policy1Receipt') == {'path': ref['originalPath'],
                'sha256': ref['sha256'], 'status': 'PASS'}, 'comparison policy1 receipt differs')
    verify_sections_baseline_evidence(baseline_proofs, artifacts, build,
        files['addons/flow_host_webgpu.mjs']['sha256'], files['flow-wgsl/manifest.json']['sha256'], read('flow-wgsl/manifest.json'))
    verify_blast_sections_evidence(section_proofs, pair, build)


def audit_physics_consumers(root):
    """Reject retired runtime URLs and the legacy JS world in active consumers."""
    root = Path(root).resolve()
    retired = re.compile(r'''["'][^"'\n]*physx-js-webidl\.(?:wasm|mjs)[^"'\n]*["']|(?:from\s*|import\s*\()["'][^"'\n]*/physics/PhysicsWorld\.js["']''')
    scanned, consumers = 0, []
    for folder in ('engine', 'editor', 'webgpu-os', 'plauna', 'agi', 'tests', 'Life'):
        for path in (root / folder).rglob('*'):
            name = path.relative_to(root).as_posix()
            if (path.suffix not in ('.js', '.mjs', '.html') or ' - Copy' in path.name
                    or '/docs/' in name or '/evidence/' in name or '/kaolin/' in name
                    or name.startswith(('tests/assets/', 'webgpu-os/assets/'))):
                continue
            source = path.read_text(encoding='utf-8')
            scanned += 1
            if retired.search(source):
                raise ValueError(f'Obsolete physics runtime reference in {name}')
            if 'PhysXPhysicsWorld.js' in source or 'PhysicsRuntime.js' in source or 'physx-pe.' in source:
                consumers.append(name)
    return {'scannedFiles': scanned, 'consumers': sorted(consumers), 'moduleName': 'physx-pe'}


def physics_runtime_descriptor(manifest):
    """Generate the small browser identity from the same recorded build inventory."""
    identity = {key: manifest[key] for key in ('moduleName', 'sdkVersion', 'upstreamTag', 'upstreamCommit', 'capabilities')}
    return ('// Generated by tools/install_physics_runtime.py; do not edit.\n'
            '// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>\n'
            '// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha\n'
            'export const PHYSICS_RUNTIME = Object.freeze(' + json.dumps(identity, indent=2) + ');\n').encode()


def physics_release_asset_paths(root):
    """Verify every recorded byte before accepting physics into a release."""
    root = Path(root).resolve()
    manifest = json.loads((root / MANIFEST_PATH).read_text(encoding='utf-8'))
    if (manifest.get('schema') != 'particle-physics-runtime/v1'
            or manifest.get('moduleName') != 'physx-pe'
            or manifest.get('sdkVersion') != SDK_VERSION
            or manifest.get('upstreamCommit') != UPSTREAM_COMMIT):
        raise ValueError('Unsupported physics runtime identity')
    files = manifest.get('files', {})
    required = {'physx-pe.mjs', 'physx-pe.wasm', 'physx-pe.d.ts',
                'flow-wgsl/manifest.json', 'addons/webgpu_bridge.mjs',
                'notices/PhysX-sdk-LICENSE.md', 'notices/PhysX-LICENSE.md',
                'notices/blast-sdk-LICENSE.md', 'notices/bindings-LICENSE.txt'}
    if not required <= files.keys():
        raise ValueError('Physics runtime is missing required assets or notices')
    paths = [MANIFEST_PATH, 'engine/sim/PhysicsRuntimeDescriptor.js']
    for name, record in files.items():
        relative = PurePosixPath(name)
        if relative.is_absolute() or '..' in relative.parts or '\\' in name or ':' in name:
            raise ValueError(f'Unsafe physics asset: {name}')
        path = root / PHYSICS_ROOT / name
        if not path.resolve().is_relative_to(root / PHYSICS_ROOT):
            raise ValueError(f'Physics asset escaped runtime: {name}')
        data = path.read_bytes()
        if len(data) != record['bytes'] or hashlib.sha256(data).hexdigest() != record['sha256']:
            raise ValueError(f'Physics asset differs from verified build: {name}')
        paths.append(f'{PHYSICS_ROOT}/{name}')
    descriptor = root / 'engine/sim/PhysicsRuntimeDescriptor.js'
    if descriptor.read_bytes() != physics_runtime_descriptor(manifest):
        raise ValueError('Browser physics descriptor differs from runtime manifest')
    if ('combinedEvidence' in manifest
            or any(key in manifest['capabilities'] for key in (
                'blastStressSectionsV3Abi', 'blastStressSectionsV3PreparationAbi',
                'woodThermalAbi', 'woodThermalMultirateAbi', 'woodThermalNumericalRevision',
                'woodThermalScope', 'woodThermalDefaultEnabled'))):
        from .combined_runtime import verify_combined_inventory
        verify_combined_inventory(root, manifest, files)
        return tuple(sorted(paths))
    if any(key in manifest['capabilities'] for key in BLAST_SECTIONS_CAPABILITIES):
        verify_sections_inventory(root, manifest, files)
    if manifest['capabilities'].get('flowSolver'):
        proof = json.loads((root / PHYSICS_ROOT / 'evidence/flow-host-browser.json').read_text())
        if (proof.get('status') != 'PASS' or proof.get('unified') is not True
                or proof.get('artifactHashes') != {name: files[name]['sha256'] for name in ('physx-pe.mjs', 'physx-pe.wasm')}
                or proof['bridgeSha256'] != files['addons/flow_host_webgpu.mjs']['sha256']
                or proof['result']['stats']['frames'] < 120 or proof['result']['cleanup'] != 'PASS'):
            raise ValueError('Flow solver capability is not backed by matching native/GPU evidence')
    geometry_claimed = 'flowGeometryAbi' in manifest['capabilities']
    collision_claimed = any(key in manifest['capabilities'] for key in FLOW_COLLISION_CAPABILITIES)
    if any(key in manifest['capabilities'] for key in FLOW_SCENE_CAPABILITIES) or geometry_claimed or collision_claimed:
        expected_capabilities = {**FLOW_SCENE_CAPABILITIES,
                                 **(FLOW_GEOMETRY_CAPABILITIES if geometry_claimed else {}),
                                 **(FLOW_COLLISION_CAPABILITIES if collision_claimed else {})}
        if (not manifest['capabilities'].get('flowSolver')
                or type(manifest['capabilities'].get('flowSceneAbi')) is not int
                or (geometry_claimed and type(manifest['capabilities'].get('flowGeometryAbi')) is not int)
                or (collision_claimed and type(manifest['capabilities'].get('flowCollisionAbi')) is not int)
                or any(manifest['capabilities'].get(key) != value
                       for key, value in expected_capabilities.items())):
            raise ValueError('Flow scene capability metadata is incomplete or unsupported')
        scene_path = 'evidence/flow-scene-browser.json'
        build_path = 'evidence/candidate-rust-build.json'
        if scene_path not in files or build_path not in files:
            raise ValueError('Flow scene capability is missing its evidence inventory')
        scene = json.loads((root / PHYSICS_ROOT / scene_path).read_text())
        build = json.loads((root / PHYSICS_ROOT / build_path).read_text())
        if build.get('artifacts') != {name: files[name] for name in ('physx-pe.mjs', 'physx-pe.wasm')}:
            raise ValueError('Flow scene build evidence belongs to a different runtime pair')
        verify_flow_scene_evidence(
            scene, {name: files[name]['sha256'] for name in ('physx-pe.mjs', 'physx-pe.wasm')},
            files['addons/flow_host_webgpu.mjs']['sha256'],
            build.get('bridge_sources', {}).get('addons/flow/pr_flow_host.cpp'),
        )
        if geometry_claimed:
            geometry_path = 'evidence/flow-geometry-browser.json'
            if geometry_path not in files:
                raise ValueError('Flow geometry capability is missing its evidence inventory')
            geometry = json.loads((root / PHYSICS_ROOT / geometry_path).read_text())
            verify_flow_geometry_evidence(
                geometry, {name: files[name]['sha256'] for name in ('physx-pe.mjs', 'physx-pe.wasm')},
                files['addons/flow_host_webgpu.mjs']['sha256'],
                build.get('bridge_sources', {}).get('addons/flow/pr_flow_host.cpp'),
            )
        if collision_claimed:
            collision_path = 'evidence/flow-collision-browser.json'
            if collision_path not in files:
                raise ValueError('Flow collision capability is missing its evidence inventory')
            verify_flow_collision_evidence(
                json.loads((root / PHYSICS_ROOT / collision_path).read_text()),
                {name: files[name]['sha256'] for name in ('physx-pe.mjs', 'physx-pe.wasm')},
                files['addons/flow_host_webgpu.mjs']['sha256'],
                build.get('bridge_sources', {}).get('addons/flow/pr_flow_host.cpp'),
            )
    if any(key in manifest['capabilities'] for key in BLAST_STRESS_CAPABILITIES):
        if (manifest['capabilities'].get('blastSceneApi') is not True
                or type(manifest['capabilities'].get('blastStressAbi')) is not int
                or any(manifest['capabilities'].get(key) != value for key, value in BLAST_STRESS_CAPABILITIES.items())):
            raise ValueError('Blast stress capability metadata is incomplete or unsupported')
        stress_path, build_path = 'evidence/blast-stress-browser.json', 'evidence/candidate-rust-build.json'
        if stress_path not in files or build_path not in files:
            raise ValueError('Blast stress capability is missing its evidence inventory')
        build = json.loads((root / PHYSICS_ROOT / build_path).read_text())
        if build.get('artifacts') != {name: files[name] for name in ('physx-pe.mjs', 'physx-pe.wasm')}:
            raise ValueError('Blast stress build evidence belongs to a different runtime pair')
        verify_blast_stress_evidence(
            json.loads((root / PHYSICS_ROOT / stress_path).read_text()),
            {name: files[name]['sha256'] for name in ('physx-pe.mjs', 'physx-pe.wasm')},
            {name: build.get('bridge_sources', {}).get(name) for name in
             (BLAST_STRESS_SOURCES if BLAST_MEMORY_SOURCE in build.get('bridge_sources', {})
              else BLAST_STRESS_LEGACY_SOURCES)},
        )
    if 'blastAuthoringAbi' in manifest['capabilities']:
        if (manifest['capabilities'].get('blastSceneApi') is not True
                or type(manifest['capabilities']['blastAuthoringAbi']) is not int
                or manifest['capabilities']['blastAuthoringAbi'] != 1):
            raise ValueError('Blast authoring capability metadata is incomplete or unsupported')
        authoring_path, build_path = 'evidence/blast-authoring-browser.json', 'evidence/candidate-rust-build.json'
        if authoring_path not in files or build_path not in files:
            raise ValueError('Blast authoring capability is missing its evidence inventory')
        build = json.loads((root / PHYSICS_ROOT / build_path).read_text())
        if build.get('artifacts') != {name: files[name] for name in ('physx-pe.mjs', 'physx-pe.wasm')}:
            raise ValueError('Blast authoring build evidence belongs to a different runtime pair')
        verify_blast_authoring_evidence(
            json.loads((root / PHYSICS_ROOT / authoring_path).read_text()),
            {name: files[name]['sha256'] for name in ('physx-pe.mjs', 'physx-pe.wasm')},
            {name: build.get('bridge_sources', {}).get(name) for name in BLAST_AUTHORING_SOURCES},
        )
    if any(key in manifest['capabilities'] for key in BLAST_MASS_CAPABILITIES):
        if (manifest['capabilities'].get('blastSceneApi') is not True
                or any(type(manifest['capabilities'].get(key)) is not int
                       or manifest['capabilities'][key] != value for key, value in BLAST_MASS_CAPABILITIES.items())):
            raise ValueError('Blast mass capability metadata is incomplete or unsupported')
        mass_path, build_path = 'evidence/blast-mass-browser.json', 'evidence/candidate-rust-build.json'
        if mass_path not in files or build_path not in files:
            raise ValueError('Blast mass capability is missing its evidence inventory')
        build = json.loads((root / PHYSICS_ROOT / build_path).read_text())
        if build.get('artifacts') != {name: files[name] for name in ('physx-pe.mjs', 'physx-pe.wasm')}:
            raise ValueError('Blast mass build evidence belongs to a different runtime pair')
        verify_blast_mass_evidence(
            json.loads((root / PHYSICS_ROOT / mass_path).read_text()),
            {name: files[name]['sha256'] for name in ('physx-pe.mjs', 'physx-pe.wasm')},
            {name: build.get('bridge_sources', {}).get(name) for name in BLAST_MASS_SOURCES},
        )
    corpus = json.loads((root / PHYSICS_ROOT / 'flow-wgsl/manifest.json').read_text(encoding='utf-8'))
    if corpus['sourceCommit'] != UPSTREAM_COMMIT or corpus['shaderCount'] != 97:
        raise ValueError('Flow corpus does not match the physics source pin')
    for shader in corpus['shaders']:
        if files.get('flow-wgsl/' + shader['wgsl'], {}).get('sha256') != shader['wgslSha256']:
            raise ValueError('Flow shader is not bound to the runtime inventory')
    if any(key in manifest['capabilities'] for key in FLOW_SOLID_CAPABILITIES):
        if (manifest['capabilities'].get('flowSolver') is not True
                or manifest['capabilities'].get('flowConvexBoundaryAbi') != 1
                or type(manifest['capabilities'].get('flowSolidBoundaryAbi')) is not int
                or type(manifest['capabilities'].get('flowSolidShaderModules')) is not int
                or any(manifest['capabilities'].get(key) != value for key, value in FLOW_SOLID_CAPABILITIES.items())):
            raise ValueError('Flow solid capability metadata is incomplete or unsupported')
        needed = {'evidence/flow-solid-browser.json', 'evidence/candidate-rust-build.json',
                  'flow-wgsl/addons/solid/manifest.json', 'addons/flow_solid_boundary.mjs'}
        if not needed <= files.keys():
            raise ValueError('Flow solid capability is missing its evidence inventory')
        proof = json.loads((root / PHYSICS_ROOT / 'evidence/flow-solid-browser.json').read_text())
        build = json.loads((root / PHYSICS_ROOT / 'evidence/candidate-rust-build.json').read_text())
        if build.get('artifacts') != {name: files[name] for name in ('physx-pe.mjs', 'physx-pe.wasm')}:
            raise ValueError('Flow solid build evidence belongs to a different runtime pair')
        native_sources = {name: build.get('bridge_sources', {}).get(name) for name in FLOW_SOLID_NATIVE_SOURCES}
        addon_sources = proof.get('addonSourceHashes', {})
        inventory = {name: record['sha256'] for name, record in files.items()}
        verify_flow_solid_evidence(proof,
            {name: inventory[name] for name in ('physx-pe.mjs', 'physx-pe.wasm')},
            inventory['addons/flow_host_webgpu.mjs'], native_sources, addon_sources, inventory)
        for name in FLOW_SOLID_ADDON_SOURCES & build.get('bridge_sources', {}).keys():
            if addon_sources.get(name) != build['bridge_sources'][name]:
                raise ValueError('Flow solid addon differs from the recorded candidate build')
        verify_flow_solid_corpus(
            json.loads((root / PHYSICS_ROOT / 'flow-wgsl/addons/solid/manifest.json').read_text()),
            inventory, addon_sources, corpus)
    if any(key in manifest['capabilities'] for key in FLOW_SCALAR_CAPABILITIES):
        if (manifest['capabilities'].get('flowSolidBoundaryAbi') != 1
                or type(manifest['capabilities'].get('flowScalarSourceAbi')) is not int
                or type(manifest['capabilities'].get('flowScalarShaderModules')) is not int
                or any(manifest['capabilities'].get(key) != value for key, value in FLOW_SCALAR_CAPABILITIES.items())):
            raise ValueError('Flow scalar capability metadata is incomplete or unsupported')
        needed = {'evidence/flow-scalar-browser.json', 'evidence/candidate-rust-build.json',
                  'flow-wgsl/addons/scalar/manifest.json', 'addons/flow_scalar_sources.mjs'}
        if not needed <= files.keys():
            raise ValueError('Flow scalar capability is missing its evidence inventory')
        proof = json.loads((root / PHYSICS_ROOT / 'evidence/flow-scalar-browser.json').read_text())
        build = json.loads((root / PHYSICS_ROOT / 'evidence/candidate-rust-build.json').read_text())
        if build.get('artifacts') != {name: files[name] for name in ('physx-pe.mjs', 'physx-pe.wasm')}:
            raise ValueError('Flow scalar build evidence belongs to a different runtime pair')
        native_sources = {name: build.get('bridge_sources', {}).get(name) for name in FLOW_SCALAR_NATIVE_SOURCES}
        addon_sources = proof.get('addonSourceHashes', {})
        inventory = {name: record['sha256'] for name, record in files.items()}
        verify_flow_scalar_evidence(proof,
            {name: inventory[name] for name in ('physx-pe.mjs', 'physx-pe.wasm')},
            inventory['addons/flow_host_webgpu.mjs'], native_sources, addon_sources, inventory)
        for name in FLOW_SCALAR_ADDON_SOURCES & build.get('bridge_sources', {}).keys():
            if addon_sources.get(name) != build['bridge_sources'][name]:
                raise ValueError('Flow scalar addon differs from the recorded candidate build')
        verify_flow_scalar_corpus(
            json.loads((root / PHYSICS_ROOT / 'flow-wgsl/addons/scalar/manifest.json').read_text()), inventory, addon_sources)
    from .flow_transactions import CAPABILITIES as transaction_capabilities, verify_transaction_inventory
    if any(key in manifest['capabilities'] for key in transaction_capabilities):
        verify_transaction_inventory(root, manifest, files)
    return tuple(sorted(paths))


def physics_asset_records(root):
    return [{'path': path, 'byteLength': (Path(root) / path).stat().st_size,
             'sha256': hashlib.sha256((Path(root) / path).read_bytes()).hexdigest()}
            for path in physics_release_asset_paths(root)]


def verify_physics_sidecars(records, root):
    # Older release manifests have no extension sidecars; their historic kits
    # remain readable. Every newly built runtime records the complete inventory.
    if records == []:
        return
    if records != physics_asset_records(root):
        raise ValueError('Physics release sidecars do not match the verified runtime inventory')
