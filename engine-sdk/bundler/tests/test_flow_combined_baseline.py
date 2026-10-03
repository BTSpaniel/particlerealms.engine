# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Synthetic metadata-only baseline composition checks, not execution evidence."""
import copy
import json
import unittest

from bundler import physics as gate
from bundler.tests.test_flow_combined import digest, shader_metadata


def baseline_metadata():
    combined = shader_metadata()
    build = combined['build']
    artifacts = build['artifacts']
    pair = {name: row['sha256'] for name, row in artifacts.items()}
    bridge = {name: 'f' * 64 for name in gate.BLAST_AUTHORING_SOURCES | {'addons/flow/pr_flow_host.cpp'}}
    build['bridge_sources'] = bridge
    host_hash = 'a' * 64
    cases = lambda names: [{'name': name, 'status': 'PASS'} for name in names]
    candidate_names = (
        'Matched loader/WASM hashes', 'Runtime version and required WebIDL API', 'Foundation, CPU scene and rigid bodies',
        'Free fall: one second without contact', 'Ground collision and resting height', 'Scene raycast hits the resting box',
        'Rust backend identity', 'Bulk addon: IDs, pose equality, removal', 'Regression API surface',
        'Zero-gravity constant velocity', 'Impulse follows inverse mass', 'Force accumulator clears after one step',
        'Angular rotation remains normalized', 'Sleep and explicit wake', 'Kinematic target and return to dynamic mode',
        'Raycast miss has no blocking hit', 'Static actor remains fixed', 'Bulk seven-component parity during motion',
        'Bulk contexts remain independent', 'Bulk capacity and unregister reuse', 'Bulk context lifecycle churn',
        'Actor, scene and SDK teardown', 'No SDK stderr diagnostics')
    candidate = {'status': 'SMOKE_PASSED_NOT_RELEASE_CERTIFIED', 'physicsExecuted': True,
                 'artifactHashes': artifacts, 'pageErrors': [], 'stderr': [], 'tests': cases(candidate_names)}
    candidate['tests'][1]['detail'] = {'runtimeVersion': gate.SDK_VERSION}
    proofs = {'candidate-browser.json': candidate,
        'unified-browser.json': {'status': 'UNIFIED_PHYSX_BLAST_FLOW_BROWSER_PASSED', 'artifactHashes': artifacts,
            'tests': cases(('PhysX and Rust bridge module identity', 'Pinned Blast 5.0.6 in unified module',
                'Blast asset, bond fracture and split in unified module', 'Unified Flow staging ABI',
                'WASM heap to WebGPU compute to WASM heap'))},
        'flow-host-browser.json': {'status': 'PASS', 'unified': True, 'artifactHashes': pair,
            'bridgeSha256': host_hash, 'hostSourceSha256': 'f' * 64,
            'result': {'stats': {'frames': 120}, 'cleanup': 'PASS', 'isolatedContexts': 'PASS'}}}
    for kind, abi, names in (('scene', 'flowSceneAbi', gate.FLOW_SCENE_CASES),
                            ('geometry', 'flowGeometryAbi', gate.FLOW_GEOMETRY_CASES),
                            ('collision', 'flowCollisionAbi', gate.FLOW_COLLISION_CASES)):
        proofs['flow-' + kind + '-browser.json'] = {'status': 'PASS', 'unified': True, abi: 1,
            'artifactHashes': pair, 'bridgeSha256': host_hash, 'hostSourceSha256': 'f' * 64,
            'adapter': {'isFallbackAdapter': False}, 'pageErrors': [], 'consoleErrors': [], 'gpuErrors': [],
            'result': {abi: 1, 'cleanup': 'PASS', 'cases': cases(names)}}
    for kind, sources, names in (('stress', gate.BLAST_STRESS_SOURCES, gate.BLAST_STRESS_CASES),
                                ('authoring', gate.BLAST_AUTHORING_SOURCES, gate.BLAST_AUTHORING_CASES)):
        native = {name: bridge[name] for name in sources}
        proofs['blast-' + kind + '-browser.json'] = {'status': 'PASS', 'unified': True,
            'artifacts': pair, 'artifactsAfter': copy.deepcopy(pair), 'bridgeSources': native,
            'bridgeSourcesAfter': copy.deepcopy(native), 'pageErrors': [], 'consoleErrors': [],
            'servedSourceHashes': {'/' + kind + '-runtime/' + name: sha for name, sha in pair.items()},
            'numerical': {'abi': 1, 'passed': True, 'cases': [{'name': name, 'passed': True} for name in names],
                'backend': 'NVIDIA ExtStress scalar CPU/WASM' if kind == 'stress' else 'NVIDIA ExtAuthoring CPU/WASM'}}
    proofs['blast-stress-browser.json']['numerical'].update(stressUnits='Pa', forceUnits='N',
        remainingHealthUnits='m2', damageCadence='per native update', family={'passed': True,
        'cases': [{'name': name, 'passed': True} for name in gate.BLAST_STRESS_FAMILY_CASES]})
    proofs['blast-authoring-browser.json']['blastAuthoringAbi'] = 1
    pages = [{'page': name, 'status': 'passed', 'pageErrors': [], 'consoleErrors': [], 'output': '{}'} for name in (
        'tests/physics/runtime-acceptance.html', 'tests/realmforge/navi-body-physx-acceptance.html',
        'tests/physics/consumer-acceptance.html', 'tests/physics/flow-physx-collision.html')]
    pages[0]['output'] = json.dumps({'status': 'PASS', 'version': gate.SDK_VERSION, 'cases': cases((
        'Persistent Blast families split physical compounds and preserve motion',
        'Native authored Blast meshes preserve geometry, collision, motion and replay'))})
    proofs['engine-acceptance.json'] = {'status': 'PASS', 'artifacts': pair, 'sourceUnchanged': True,
        'servedSourceHashes': {'synthetic-only': '0' * 64}, 'servedSourceHashesAfter': {'synthetic-only': '0' * 64}, 'pages': pages}
    for role, name in (('modules', 'flow-wgsl-modules.json'), ('pipelines', 'flow-wgsl-selected-pipelines.json')):
        proofs[name] = json.loads(combined['raw_reports'][role])
    sph_cases = cases(('sealed-pbf-baseline', 'initial-state', 'game-existing-wasm-simd', *('synthetic-' + str(i) for i in range(6))))
    sph_cases[0]['frames'] = 600
    sph_cases[1]['particles'] = 65536
    sph_cases[2].update(checked=196608, maximumError=0)
    proofs['sph-playground-verified.json'] = {'status': 'SPH_PLAYGROUND_PORT_INTEGRATION_PASSED',
        'servedSourceHashes': {'/port/dist/candidate/' + name: sha for name, sha in pair.items()},
        'integration': {'status': 'SPH_PLAYGROUND_PORT_INTEGRATION_PASSED', 'errors': [], 'cases': sph_cases},
        'playground': {'pageErrors': [], 'consoleErrors': [], 'controlsPassed': ['synthetic'] * 5}}
    proofs['upgrade-511.json'] = {'status': 'UPGRADE_BUILD_AND_TESTS_PASSED_NOT_RELEASE_CERTIFIED',
        'artifactHashes': pair, 'upstreamCommit': gate.UPSTREAM_COMMIT}
    return {'proofs': proofs, 'artifacts': artifacts, 'build': build, 'host_hash': host_hash,
        'corpus_hash': digest(combined['raw_corpora']['original']),
        'corpus': json.loads(combined['raw_corpora']['original']), 'combined_shaders': combined}


class CombinedBaselineMetadataTests(unittest.TestCase):
    def test_explicit_combined_schema_and_original_default(self):
        data = baseline_metadata()
        gate.verify_sections_baseline_evidence(**data)
        data.pop('combined_shaders')
        with self.assertRaises(ValueError):
            gate.verify_sections_baseline_evidence(**data)
        modules, pipelines = (data['proofs'][name] for name in ('flow-wgsl-modules.json', 'flow-wgsl-selected-pipelines.json'))
        modules['separateAddonManifests'] = pipelines['separateAddonManifests'] = {}
        modules['candidateArtifacts'] = pipelines['candidateArtifacts']
        modules['execution'] = pipelines['execution']
        gate.verify_sections_baseline_evidence(**data)

    def test_combined_hook_cannot_substitute_other_raw_data_build_or_corpus(self):
        for mutation in ('raw-modules', 'raw-pipelines', 'build', 'pair', 'corpus', 'corpus-sha', 'missing-addon', 'extra-key'):
            data = baseline_metadata(); combined = data['combined_shaders']
            if mutation.startswith('raw-'):
                name = 'flow-wgsl-modules.json' if mutation == 'raw-modules' else 'flow-wgsl-selected-pipelines.json'
                data['proofs'][name]['browser'] = 'different raw dictionary'
            if mutation == 'build':
                combined['build'] = copy.deepcopy(combined['build']); combined['build']['sourceRoot'] += '-other'
            if mutation == 'pair':
                combined['build'] = copy.deepcopy(combined['build']); combined['build']['artifacts']['physx-pe.wasm']['bytes'] += 1
            if mutation == 'corpus': data['corpus']['unexpected'] = True
            if mutation == 'corpus-sha': data['corpus_hash'] = '0' * 64
            if mutation == 'missing-addon': combined['raw_reports'].pop('addons')
            if mutation == 'extra-key': combined['allowPartial'] = True
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                gate.verify_sections_baseline_evidence(**data)

    def test_combined_hook_preserves_all_nonshader_baseline_gates(self):
        names = sorted(gate.SECTIONS_BASELINE_PROOFS - {'flow-wgsl-modules.json', 'flow-wgsl-selected-pipelines.json'})
        for name in names:
            data = baseline_metadata(); data['proofs'][name]['status'] = 'FAIL'
            with self.subTest(role=name), self.assertRaises(ValueError):
                gate.verify_sections_baseline_evidence(**data)
        for mutation in ('candidate-coverage', 'engine-pages', 'sph-population', 'sph-clock', 'upgrade-pair'):
            data = baseline_metadata(); proofs = data['proofs']
            if mutation == 'candidate-coverage': proofs['candidate-browser.json']['tests'].pop()
            if mutation == 'engine-pages': proofs['engine-acceptance.json']['pages'].pop()
            if mutation == 'sph-population': proofs['sph-playground-verified.json']['integration']['cases'][1]['particles'] = 65535
            if mutation == 'sph-clock': proofs['sph-playground-verified.json']['integration']['cases'][0]['frames'] = 599
            if mutation == 'upgrade-pair': proofs['upgrade-511.json']['artifactHashes'] = {}
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                gate.verify_sections_baseline_evidence(**data)


if __name__ == '__main__':
    unittest.main()
