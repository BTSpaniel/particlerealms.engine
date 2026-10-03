# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Synthetic metadata vectors only: these tests are not native/GPU evidence."""
import copy
import hashlib
import json
import unittest

from bundler.flow_combined import (EXCLUDED_PIPELINE, MOMENTUM_KERNELS, PROOF_TOOLS,
    SHADER_PROGRAM_SHA256, verify_combined_flow_shader_evidence, verify_combined_flow_solid_evidence)
from bundler.physics import (FLOW_SCALAR_KERNELS, FLOW_SOLID_KERNELS, FLOW_SOLID_CASES,
    FLOW_SOLID_NATIVE_SOURCES, FLOW_SOLID_ADDON_SOURCES, UPSTREAM_COMMIT, verify_flow_solid_evidence)


def raw(value):
    return json.dumps(value, sort_keys=True).encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def shader_metadata():
    """Manufactured schema objects, explicitly unrelated to measured execution."""
    root = 'C:/synthetic-metadata-only'
    pair = {'physx-pe.mjs': 'a' * 64, 'physx-pe.wasm': 'b' * 64}
    artifacts = {name: {'sha256': sha, 'bytes': 100} for name, sha in pair.items()}
    files = dict(pair)
    sources = {'addons/flow/advection_smoke.mjs': 'c' * 64, 'addons/flow/mesh_scan_smoke.mjs': 'd' * 64}
    files.update({'addons/' + name.rsplit('/', 1)[-1]: sha for name, sha in sources.items()})
    corpora, rows_by_kind = {}, {}
    names_by_kind = {'original': {EXCLUDED_PIPELINE, *('synthetic/' + str(i) + '.wgsl' for i in range(96))},
                     'solid': FLOW_SOLID_KERNELS, 'scalar': FLOW_SCALAR_KERNELS, 'momentum': MOMENTUM_KERNELS}
    for kind, names in names_by_kind.items():
        rows = []
        for name in sorted(names):
            sha = digest(name.encode())
            reflection = name.replace('.wgsl', '.reflection.json')
            reflection_sha = digest(reflection.encode())
            rows.append({'wgsl': name, 'wgslSha256': sha, 'reflection': reflection,
                         'reflectionSha256': reflection_sha, 'status': 'PASS'})
            for path, value in ((name, sha), (reflection, reflection_sha)):
                sources['dist/flow-wgsl/' + path] = value
                files['flow-wgsl/' + path] = value
        value = {'abi': 1, 'status': 'FLOW_WGSL_CORPUS_COMPILED', 'sourceCommit': UPSTREAM_COMMIT,
                 'shaderCount': len(rows), 'passed': len(rows), 'failed': 0,
                 'runtimeShaderCount': len(rows), 'runtimeFailed': 0, 'shaders': rows}
        corpora[kind] = raw(value)
        rows_by_kind[kind] = rows
        name = 'manifest.json' if kind == 'original' else 'addons/' + kind + '/manifest.json'
        files['flow-wgsl/' + name] = sources['dist/flow-wgsl/' + name] = digest(corpora[kind])
    build = {'status': 'COMPILED_NOT_RUNTIME_TESTED', 'sourceUnchanged': True, 'sourceRoot': root,
             'sources': sources, 'sourcesBefore': copy.deepcopy(sources), 'sourcesAfter': copy.deepcopy(sources),
             'artifacts': artifacts}
    build_sha = 'e' * 64
    addon_manifests = {'addons/' + kind + '/manifest.json': digest(corpora[kind]) for kind in ('solid', 'scalar', 'momentum')}
    reports, witnesses = {}, {}
    for role in ('modules', 'pipelines', 'addons'):
        rows = (rows_by_kind['original'] if role != 'addons' else
                sum((rows_by_kind[kind] for kind in ('solid', 'scalar', 'momentum')), []))
        rows = [row for row in rows if role != 'pipelines' or row['wgsl'] != EXCLUDED_PIPELINE]
        proof = {'status': {'modules': 'FLOW_WGSL_MODULES_PASSED',
                 'pipelines': 'SELECTED_FLOW_WGSL_CHECKS_PASSED_INCOMPLETE_CORPUS', 'addons': 'PASS'}[role],
                 'tests': [{'name': row['wgsl'], 'sha256': row['wgslSha256'], 'status': 'PASS',
                            'errors': [], 'diagnostic': None, 'validation': None} for row in rows],
                 'passed': len(rows), 'failed': 0, 'untested': 0, 'features': ['float32-filterable'],
                 'adapter': {'description': 'SYNTHETIC METADATA, NOT A GPU'}, 'browser': 'synthetic',
                 'configuredShaderCount': 97, 'corpusStatus': 'FLOW_WGSL_CORPUS_COMPILED',
                 'excludedShaders': [EXCLUDED_PIPELINE] if role == 'pipelines' else [],
                 'manifestSha256': digest(corpora['original']), 'separateAddonManifests': addon_manifests}
        if role == 'addons':
            proof.update(pageErrors=[], consoleErrors=[], shaderProgramSha256=SHADER_PROGRAM_SHA256,
                         native={'host': 1, 'solid': 1, 'scalar': 1, 'momentum': 1, 'contexts': 0})
        if role == 'pipelines':
            proof.update(candidateArtifacts=pair, advectionSourceSha256='c' * 64, meshScanSourceSha256='d' * 64,
                execution={'advection': {'status': 'FLOW_ADVECTION_KERNEL_PASSED', 'cells': 128, 'checked': 512,
                    'sameWasmHeapReadback': True, 'deltaTime': .25, 'maximumError': 1e-6},
                    'meshScan': {'status': 'FLOW_MESH_SCAN_PASSED', 'groups': 4, 'lanes': 1024, 'checked': 2048,
                                 'patterns': ['empty', 'full', 'every-third', 'last-only']}})
        reports[role] = raw(proof)
        hashes = {root + '/' + name: sha for name, sha in sources.items()}
        hashes[root + '/dist/candidate/build-manifest.json'] = build_sha
        hashes.update({root + '/dist/candidate/' + name: sha for name, sha in pair.items()})
        tools = {'C:/synthetic-tools/' + name: sha for name, sha in PROOF_TOOLS.items()}
        witnesses[role] = {'schema': 'combined-flow-proof-witness/v1', 'status': 'PASS', 'role': role,
            'exitCode': 0, 'runtimeExecuted': True, 'lockScope': 'parent admission/execution/recheck',
            'buildManifestSha256': build_sha, 'artifacts': artifacts, 'rawStatus': proof['status'],
            'rawReport': {'sha256': digest(reports[role])}, 'sourceUnchanged': True,
            'sourceHashes': hashes, 'sourceHashesAfter': copy.deepcopy(hashes), 'tools': tools,
            'toolsAfter': copy.deepcopy(tools)}
    return {'raw_reports': reports, 'witnesses': witnesses, 'build': build,
            'build_sha256': build_sha, 'file_hashes': files, 'raw_corpora': corpora}


def solid_metadata():
    pair = {'physx-pe.mjs': 'a' * 64, 'physx-pe.wasm': 'b' * 64}
    native = dict.fromkeys(FLOW_SOLID_NATIVE_SOURCES, 'c' * 64)
    addon = dict.fromkeys(FLOW_SOLID_ADDON_SOURCES, 'd' * 64)
    files = {'addons/flow_host_webgpu.mjs': 'd' * 64, 'addons/flow_solid_boundary.mjs': 'd' * 64,
             'flow-wgsl/manifest.json': 'e' * 64}
    files.update({'flow-wgsl/' + name: '1' * 64 for name in FLOW_SOLID_KERNELS})
    served = {'/dist/' + name: sha for name, sha in files.items() if name.startswith('flow-wgsl/')}
    served.update({'/addons/flow/' + name: 'd' * 64 for name in ('flow_host_webgpu.mjs', 'flow_solid_boundary.mjs')})
    admission = {'manifestPath': 'C:/synthetic/build-manifest.json', 'manifestSha256': 'f' * 64,
        'componentManifestSha256': '0' * 64, 'componentObjectSha256': '2' * 64,
        'artifacts': {name: {'sha256': sha, 'bytes': 100} for name, sha in pair.items()},
        'component': {'schema': 'flow-component-build-v1', 'status': 'COMPILED_NOT_RUNTIME_TESTED',
                      'object': {'sha256': '2' * 64}, 'inputs': {**addon, **native}}}
    proof = {'status': 'PASS', 'unified': True, 'quick': False, 'flowSolidBoundaryAbi': 1,
        'artifactHashes': pair, 'bridgeSha256': 'd' * 64, 'hostSourceSha256': 'c' * 64,
        'adapter': {'isFallbackAdapter': False}, 'pageErrors': [], 'consoleErrors': [], 'gpuErrors': [],
        'httpErrors': [], 'requestFailures': [], 'bridgeSources': native, 'bridgeSourcesAfter': copy.deepcopy(native),
        'addonSourceHashes': addon, 'addonSourceHashesAfter': copy.deepcopy(addon), 'corpusSha256': 'e' * 64,
        'servedSourceHashes': served, 'servedSourceHashesAfter': copy.deepcopy(served),
        'servedRuntimeHashes': {'/dist/candidate/' + name: sha for name, sha in pair.items()},
        'unifiedAdmission': admission, 'unifiedAdmissionAfter': copy.deepcopy(admission),
        'sourceHashes': admission['component']['inputs'], 'sourceHashesAfter': copy.deepcopy(admission['component']['inputs']),
        'nativeBuildManifestSha256': 'f' * 64,
        'result': {'flowSolidBoundaryAbi': 1, 'cleanup': 'PASS',
                   'cases': [{'name': name, 'status': 'PASS'} for name in sorted(FLOW_SOLID_CASES)]}}
    proof['servedRuntimeHashesAfter'] = copy.deepcopy(proof['servedRuntimeHashes'])
    return {'proof': proof, 'artifact_hashes': pair, 'bridge_sha256': 'd' * 64, 'bridge_sources': native,
            'addon_sources': addon, 'file_hashes': files, 'admission': copy.deepcopy(admission)}


class CombinedFlowMetadataAdmissionTests(unittest.TestCase):
    def test_synthetic_schema_positive_does_not_claim_native_execution(self):
        self.assertEqual(verify_combined_flow_shader_evidence(**shader_metadata())['selectedPipelines'], 123)
        self.assertEqual(verify_combined_flow_solid_evidence(**solid_metadata())['solidCases'], 19)

    def test_legacy_default_still_requires_ordinary_native_routes(self):
        data = solid_metadata()
        legacy = {key: value for key, value in data.items() if key != 'admission'}
        with self.assertRaises(ValueError):
            verify_flow_solid_evidence(**legacy)
        for key in ('servedSourceHashes', 'servedSourceHashesAfter'):
            legacy['proof'][key].update(legacy['proof']['servedRuntimeHashes'])
        verify_flow_solid_evidence(**legacy)

    def test_runtime_alias_missing_extra_unknown_prefix_conflict_and_stale_rejected(self):
        for kind in ('missing', 'extra', 'wrong-prefix', 'wrong-pair', 'stale', 'ordinary-conflict', 'unknown-native'):
            data = solid_metadata(); proof = data['proof']; aliases = proof['servedRuntimeHashes']
            if kind == 'missing': aliases.pop('/dist/candidate/physx-pe.wasm')
            if kind == 'extra': aliases['/dist/candidate/extra.wasm'] = 'a' * 64
            if kind == 'wrong-prefix': aliases['/unknown/physx-pe.wasm'] = aliases.pop('/dist/candidate/physx-pe.wasm')
            if kind == 'wrong-pair': aliases['/dist/candidate/physx-pe.wasm'] = '0' * 64
            if kind == 'stale': proof['servedRuntimeHashesAfter'] = {}
            if kind in ('ordinary-conflict', 'unknown-native'):
                route = '/dist/candidate/physx-pe.wasm' if kind == 'ordinary-conflict' else '/engine/sim/physics/physx-pe.wasm'
                proof['servedSourceHashes'][route] = '0' * 64
                proof['servedSourceHashesAfter'] = copy.deepcopy(proof['servedSourceHashes'])
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                verify_combined_flow_solid_evidence(**data)

    def test_alias_does_not_bypass_original_gpu_source_or_case_guards(self):
        for kind in ('case', 'addon', 'gpu', 'source', 'component', 'admission'):
            data = solid_metadata(); proof = data['proof']
            if kind == 'case': proof['result']['cases'].pop()
            if kind == 'addon': proof['servedSourceHashes'].pop('/addons/flow/flow_solid_boundary.mjs')
            if kind == 'gpu': proof['gpuErrors'] = ['error']
            if kind == 'source': proof['sourceHashesAfter'] = {}
            if kind == 'component': proof['sourceHashes'].pop(next(iter(proof['sourceHashes'])))
            if kind == 'admission': proof['unifiedAdmissionAfter']['manifestSha256'] = '0' * 64
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                verify_combined_flow_solid_evidence(**data)

    def test_shader_receipt_bytes_roles_pair_and_witness_are_required(self):
        for kind in ('raw', 'role', 'pair', 'source', 'tool', 'alias', 'unexecuted', 'raw-corpus'):
            data = shader_metadata(); witness = data['witnesses']['modules']
            if kind == 'raw': data['raw_reports']['modules'] += b' '
            if kind == 'role': data['witnesses']['unknown'] = witness
            if kind == 'pair': data['file_hashes']['physx-pe.wasm'] = '0' * 64
            if kind == 'source': witness['sourceHashesAfter'] = {}
            if kind == 'tool': witness['toolsAfter'] = {}
            if kind == 'alias':
                name = next(iter(witness['sourceHashes']))
                witness['sourceHashes'][name.replace('C:/', '/mnt/c/')] = witness['sourceHashes'][name]
                witness['sourceHashesAfter'] = copy.deepcopy(witness['sourceHashes'])
            if kind == 'unexecuted': witness['runtimeExecuted'] = False
            if kind == 'raw-corpus': data['raw_corpora']['solid'] += b' '
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                verify_combined_flow_shader_evidence(**data)

    def test_negative_report_vectors_remain_rejected_with_matching_raw_witness(self):
        for kind in ('duplicate', 'missing-addon', 'shader-sha', 'wrong-exclusion', 'module-mix', 'missing-dispatch',
                     'wrong-dispatch', 'error', 'nan', 'heap', 'leak', 'program', 'gpu-error', 'boolean-count'):
            data = shader_metadata()
            role = 'addons' if kind in ('missing-addon', 'leak', 'program') else 'pipelines'
            proof = json.loads(data['raw_reports'][role])
            if kind == 'duplicate': proof['tests'][-1] = copy.deepcopy(proof['tests'][0])
            if kind == 'missing-addon': proof['tests'].pop()
            if kind == 'shader-sha': proof['tests'][0]['sha256'] = '0' * 64
            if kind == 'wrong-exclusion': proof['excludedShaders'] = []
            if kind == 'module-mix': proof['tests'].append(json.loads(data['raw_reports']['addons'])['tests'][0])
            if kind == 'missing-dispatch': proof.pop('execution')
            if kind == 'wrong-dispatch': proof['execution']['meshScan']['checked'] = 1024
            if kind == 'error': proof['execution']['advection']['maximumError'] = .001
            if kind == 'nan': proof['execution']['advection']['maximumError'] = float('nan')
            if kind == 'heap': proof['execution']['advection']['sameWasmHeapReadback'] = False
            if kind == 'leak': proof['native']['contexts'] = 1
            if kind == 'program': proof['shaderProgramSha256'] = '0' * 64
            if kind == 'gpu-error': proof['gpuErrors'] = ['error']
            if kind == 'boolean-count': proof['failed'] = False
            data['raw_reports'][role] = raw(proof)
            data['witnesses'][role]['rawReport']['sha256'] = digest(data['raw_reports'][role])
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                verify_combined_flow_shader_evidence(**data)


if __name__ == '__main__':
    unittest.main()
