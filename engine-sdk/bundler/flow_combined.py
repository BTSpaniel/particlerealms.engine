# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Additive admission for actual component-linked Flow proof layouts.

Raw receipts remain byte-for-byte evidence. These helpers do not install files,
modify legacy proof defaults, or certify all GPU platforms/pipeline variants.
The caller separately performs fresh component/build filesystem admission.
"""
import hashlib
import json
from pathlib import PurePosixPath
import re

from .flow_transactions import _finite, _hashes, _same
from .physics import (FLOW_SCALAR_KERNELS, FLOW_SOLID_ADDON_SOURCES, FLOW_SOLID_CASES,
    FLOW_SOLID_KERNELS, FLOW_SOLID_NATIVE_SOURCES, UPSTREAM_COMMIT,
    _verify_executed_cases, _verify_flow_addon_evidence)

SHADER_ROLES = frozenset(('modules', 'pipelines', 'addons'))
EXCLUDED_PIPELINE = 'source/nvflowext/shaders/EmitterNanoVdbCS.wgsl'
MOMENTUM_KERNELS = frozenset('addons/momentum/' + name + '.wgsl' for name in
                           ('PrMomentumGatherCS', 'PrMomentumApplyCS'))
SHADER_PROGRAM_SHA256 = '02ea13a48a33fcae93fed314cedea649d9c3e0a55dc8ac303173a3c498c731cf'
PROOF_TOOLS = {
    'run_combined_flow_proof.py': '0c92c537b39909c9e5e9f98dad557e8f30dc6620c43bafa136dbec854021d873',
    'runtime_build_inputs.py': 'a8a0ae96762b4ba40e8906aacbc5ab280d6852dbea42e2728d4c4c1bad949187',
    'performance_run_lock.py': '68518bb32b68e724030b66440ea4d9b2b23f56cf10a01606cdbf0a7f620788c7',
    'serve.py': '1424e33fd3ced8fe0ce497847a8c990d6fe3f13c1d202e9aae4dbaa52010ee75',
}


def _require(condition, message):
    if not condition:
        raise ValueError('Combined Flow: ' + message)


def _canonical(value):
    _require(isinstance(value, str) and bool(value), 'missing physical source path')
    value = value.replace('\\', '/')
    value = re.sub(r'^/mnt/([a-z])/', lambda m: m[1].upper() + ':/', value)
    _require((value.startswith('/') or re.match(r'^[A-Za-z]:/', value))
             and '..' not in PurePosixPath(value).parts, 'unsafe physical source path')
    return str(PurePosixPath(value))


def _physical_hashes(value):
    """Explicit Windows/WSL witness paths, without merging duplicate aliases."""
    _require(isinstance(value, dict) and bool(value), 'missing physical source hashes')
    normalized = {}
    for name, digest in value.items():
        name = _canonical(name)
        _require(name not in normalized and isinstance(digest, str)
                 and re.fullmatch('[0-9a-f]{64}', digest), 'invalid or duplicate physical source hash')
        normalized[name] = digest
    return normalized


def verify_combined_flow_solid_evidence(proof, artifact_hashes, bridge_sha256, bridge_sources,
                                      addon_sources, file_hashes, *, admission=None, source_build=None):
    """Admit only the frozen component's explicit two-route native alias schema."""
    if source_build is not None:
        from .source_build_numerical import checked
        source_build = checked(source_build)
        source_build.baseline_role('solid', proof)
        _require(artifact_hashes == source_build.pair, 'solid proof selected another pair')
        _require(proof.get('nativeBuildManifestSha256') == source_build.build_sha256,
            'solid proof selected another original SDK manifest')
    else:
        keys = {'manifestPath', 'manifestSha256', 'componentManifestSha256', 'componentObjectSha256',
                'artifacts', 'component'}
        _require(isinstance(admission, dict) and set(admission) == keys
                 and _same(proof.get('unifiedAdmission'), admission)
                 and _same(proof.get('unifiedAdmissionAfter'), admission), 'missing stable fresh component admission')
        _require(set(artifact_hashes) == {'physx-pe.mjs', 'physx-pe.wasm'}
                 and _hashes(artifact_hashes) and isinstance(admission['artifacts'], dict)
                 and set(admission['artifacts']) == set(artifact_hashes)
                 and all(row.get('sha256') == artifact_hashes[name] and type(row.get('bytes')) is int and row['bytes'] > 0
                         for name, row in admission['artifacts'].items())
                 and proof.get('nativeBuildManifestSha256') == admission['manifestSha256'], 'native pair or build identity differs')
        component = admission['component']
        _require(component.get('schema') == 'flow-component-build-v1'
                 and component.get('status') == 'COMPILED_NOT_RUNTIME_TESTED'
                 and component.get('object', {}).get('sha256') == admission['componentObjectSha256']
                 and _hashes(component.get('inputs')), 'invalid component identity')
        _require(_hashes(proof.get('sourceHashes')) and proof.get('sourceHashes') == proof.get('sourceHashesAfter')
                 and all(proof['sourceHashes'].get(name) == digest for name, digest in component['inputs'].items()),
                 'changed or incomplete component source closure')
    expected = {'/dist/candidate/' + name: digest for name, digest in artifact_hashes.items()}
    aliases = proof.get('servedRuntimeHashes')
    _require(_same(aliases, expected) and _same(proof.get('servedRuntimeHashesAfter'), expected),
             'runtime aliases must be exactly the selected stable pair')
    served = proof.get('servedSourceHashes', {})
    # Do not combine maps. If the ordinary server also recorded a native route,
    # it must agree; unknown native aliases never gain authority from a prefix.
    for route, digest in served.items():
        if route.startswith(('/dist/candidate/', '/engine/sim/physics/')):
            _require(route in expected and digest == expected[route], 'conflicting or unknown native route')
    _verify_flow_addon_evidence(proof, artifact_hashes, bridge_sha256, bridge_sources, addon_sources, file_hashes,
        abi_field='flowSolidBoundaryAbi', required_cases=FLOW_SOLID_CASES, label='Flow solid',
        native_sources=FLOW_SOLID_NATIVE_SOURCES, addon_required=FLOW_SOLID_ADDON_SOURCES,
        helpers=('flow_host_webgpu.mjs', 'flow_solid_boundary.mjs'), runtime_hashes=aliases)
    return {'status': 'PASS', 'solidCases': len(proof['result']['cases']), 'runtimeAliasSchema': 'component-dist-pair/v1'}


def _witness(role, raw, proof, witness, build, build_sha256):
    _require(witness.get('schema') == 'combined-flow-proof-witness/v1'
             and witness.get('status') == 'PASS' and witness.get('role') == role
             and witness.get('exitCode') == 0 and type(witness.get('exitCode')) is int
             and witness.get('runtimeExecuted') is True
             and witness.get('lockScope') == 'parent admission/execution/recheck'
             and witness.get('buildManifestSha256') == build_sha256
             and _same(witness.get('artifacts'), build['artifacts'])
             and witness.get('rawStatus') == proof.get('status')
             and witness.get('rawReport', {}).get('sha256') == hashlib.sha256(raw).hexdigest(),
             'shader receipt bytes, pair, or execution witness differs: ' + role)
    hashes = witness.get('sourceHashes')
    _require(witness.get('sourceUnchanged') is True
             and hashes == witness.get('sourceHashesAfter'), 'shader source closure changed: ' + role)
    normalized = _physical_hashes(hashes)
    root = _canonical(build.get('sourceRoot'))
    required = {root + '/' + name: digest for name, digest in build['sources'].items()}
    required[root + '/dist/candidate/build-manifest.json'] = build_sha256
    required.update({root + '/dist/candidate/' + name: row['sha256'] for name, row in build['artifacts'].items()})
    _require(all(normalized.get(name) == digest for name, digest in required.items()), 'shader witness omitted selected source or pair')
    tools = witness.get('tools')
    normalized_tools = _physical_hashes(tools)
    _require(tools == witness.get('toolsAfter') and len(tools) == len(PROOF_TOOLS)
             and {PurePosixPath(name).name: digest for name, digest in normalized_tools.items()} == PROOF_TOOLS,
             'shader proof tool policy changed')


def _shader_rows(proof, expected):
    _verify_executed_cases(proof.get('tests'), set(expected), label='Combined Flow shaders')
    _require(len(proof['tests']) == len(expected) and type(proof.get('passed')) is int
             and proof['passed'] == len(expected) and type(proof.get('failed')) is int and proof['failed'] == 0
             and type(proof.get('untested')) is int and proof['untested'] == 0,
             'shader coverage/counts changed')
    for row in proof['tests']:
        _require(row.get('sha256') == expected[row['name']] and row.get('errors') == []
                 and row.get('diagnostic') is None and row.get('validation') is None, 'shader bytes or compiler diagnostics differ')
    _require('float32-filterable' in proof.get('features', [])
             and isinstance(proof.get('adapter'), dict) and isinstance(proof.get('browser'), str)
             and bool(proof['browser']), 'shader device/browser identity missing')


def verify_combined_flow_shader_evidence(raw_reports, witnesses, *, build, build_sha256, file_hashes,
                                        raw_corpora, source_build=None):
    """Check immutable 97/96/27 receipts, dispatches, and whole-build witnesses.

    ``raw_reports`` and ``raw_corpora`` hold original JSON bytes, not reconstructed
    dictionaries. The return value is selected-platform evidence, never universal
    shader support. Fresh filesystem validation remains the caller's obligation.
    """
    _require(set(raw_reports) == set(witnesses) == SHADER_ROLES, 'unknown or missing shader proof role')
    if source_build is not None:
        from .source_build_numerical import checked
        source_build = checked(source_build)
        source_build.require_build(build)
        _require(build_sha256 == source_build.build_sha256, 'shader SDK manifest differs')
        pair = source_build.pair
    else:
        _require(build.get('status') == 'COMPILED_NOT_RUNTIME_TESTED' and build.get('sourceUnchanged') is True
                 and _hashes(build.get('sources')) and build['sources'] == build.get('sourcesBefore') == build.get('sourcesAfter')
                 and set(build.get('artifacts', {})) == {'physx-pe.mjs', 'physx-pe.wasm'}, 'incomplete selected build')
        pair = {name: row['sha256'] for name, row in build['artifacts'].items()}
    _require(_hashes(pair) and all(file_hashes.get(name) == digest for name, digest in pair.items()), 'selected native asset hashes differ')
    _require(set(raw_corpora) == {'original', 'solid', 'scalar', 'momentum'}, 'unknown or missing raw corpus role')
    parsed = {}
    for kind, raw in raw_corpora.items():
        _require(type(raw) is bytes, 'original corpus bytes required')
        name = 'manifest.json' if kind == 'original' else 'addons/' + kind + '/manifest.json'
        digest = hashlib.sha256(raw).hexdigest()
        _require(file_hashes.get('flow-wgsl/' + name) == digest
                 and (build['sources'].get('dist/flow-wgsl/' + name) if source_build is None else source_build.source_sha('dist/flow-wgsl/' + name)) == digest, 'raw corpus bytes differ from selected build')
        parsed[kind] = json.loads(raw)
    corpus = parsed.pop('original'); addon_corpora = parsed
    _require(corpus.get('sourceCommit') == UPSTREAM_COMMIT
             and corpus.get('status') == 'FLOW_WGSL_CORPUS_COMPILED'
             and _same({name: corpus.get(name) for name in ('shaderCount', 'passed', 'failed', 'runtimeShaderCount', 'runtimeFailed')},
                       {'shaderCount': 97, 'passed': 97, 'failed': 0, 'runtimeShaderCount': 97, 'runtimeFailed': 0})
             and isinstance(corpus.get('shaders'), list) and len(corpus['shaders']) == 97,
             'original pinned Flow corpus differs')
    original = {row['wgsl']: row['wgslSha256'] for row in corpus['shaders'] if row.get('status') == 'PASS'}
    _require(len(original) == 97 and EXCLUDED_PIPELINE in original, 'original corpus has duplicate or failed entries')
    _require(set(addon_corpora) == {'solid', 'scalar', 'momentum'}, 'unknown or missing addon corpus')
    addon = {}
    for kind, names in (('solid', FLOW_SOLID_KERNELS), ('scalar', FLOW_SCALAR_KERNELS), ('momentum', MOMENTUM_KERNELS)):
        value = addon_corpora[kind]
        rows = value.get('shaders', [])
        _require(type(value.get('abi')) is int and value['abi'] == 1 and len(rows) == len(names)
                 and {row.get('wgsl') for row in rows} == names, 'addon shader inventory differs: ' + kind)
        addon.update({row['wgsl']: row['wgslSha256'] for row in rows})
    _require(len(addon) == 27 and not original.keys() & addon.keys(), 'addon overlap or duplicate shader')
    for value in (corpus, *addon_corpora.values()):
        for row in value['shaders']:
            _require(row.get('reflection') == row['wgsl'].replace('.wgsl', '.reflection.json'), 'reflection path differs')
            for name, field in ((row['wgsl'], 'wgslSha256'), (row['reflection'], 'reflectionSha256')):
                digest = row.get(field)
                _require(isinstance(digest, str) and re.fullmatch('[0-9a-f]{64}', digest)
                         and file_hashes.get('flow-wgsl/' + name) == digest
                         and (build['sources'].get('dist/flow-wgsl/' + name) if source_build is None else source_build.source_sha('dist/flow-wgsl/' + name)) == digest, 'shader/reflection not bound to selected build')
    manifest_hashes = {'addons/' + kind + '/manifest.json': file_hashes.get('flow-wgsl/addons/' + kind + '/manifest.json')
                       for kind in addon_corpora}
    _require(_hashes(manifest_hashes) and all((build['sources'].get('dist/flow-wgsl/' + name) if source_build is None else source_build.source_sha('dist/flow-wgsl/' + name)) == digest
             for name, digest in {'manifest.json': file_hashes.get('flow-wgsl/manifest.json'), **manifest_hashes}.items()),
             'corpus manifest hashes differ from build')
    proofs = {}
    for role in SHADER_ROLES:
        _require(type(raw_reports[role]) is bytes, 'original shader receipt bytes required')
        proof = json.loads(raw_reports[role]); proofs[role] = proof
        if source_build is None:
            _witness(role, raw_reports[role], proof, witnesses[role], build, build_sha256)
        else:
            source_build.baseline_role(role, proof, raw=raw_reports[role], witness=witnesses[role])
        _shader_rows(proof, addon if role == 'addons' else {name: digest for name, digest in original.items()
                     if role == 'modules' or name != EXCLUDED_PIPELINE})
        for field in ('pageErrors', 'consoleErrors', 'gpuErrors', 'httpErrors', 'requestFailures'):
            _require(field not in proof or proof[field] == [], 'shader proof has reported errors: ' + field)
    for role, status, excluded in (('modules', 'FLOW_WGSL_MODULES_PASSED', []),
            ('pipelines', 'SELECTED_FLOW_WGSL_CHECKS_PASSED_INCOMPLETE_CORPUS', [EXCLUDED_PIPELINE])):
        proof = proofs[role]
        _require(proof.get('status') == status and proof.get('excludedShaders') == excluded
                 and proof.get('configuredShaderCount') == 97 and proof.get('corpusStatus') == corpus.get('status')
                 and proof.get('manifestSha256') == file_hashes['flow-wgsl/manifest.json']
                 and proof.get('separateAddonManifests') == manifest_hashes, 'original/addon corpus separation differs')
    extra = proofs['addons']
    _require(extra.get('status') == 'PASS' and extra.get('pageErrors') == extra.get('consoleErrors') == []
             and extra.get('shaderProgramSha256') == SHADER_PROGRAM_SHA256
             and _same(extra.get('native'), {'host': 1, 'solid': 1, 'scalar': 1, 'momentum': 1, 'contexts': 0}),
             'addon program, native identity, or ownership differs')
    selected = proofs['pipelines']; execution = selected.get('execution', {})
    advection, mesh = execution.get('advection', {}), execution.get('meshScan', {})
    _require(set(execution) == {'advection', 'meshScan'} and selected.get('candidateArtifacts') == pair
             and advection.get('status') == 'FLOW_ADVECTION_KERNEL_PASSED'
             and advection.get('cells') == 128 and advection.get('checked') == 512
             and advection.get('sameWasmHeapReadback') is True and advection.get('deltaTime') == .25
             and _finite(advection.get('maximumError')) and 0 <= advection['maximumError'] <= .0001
             and mesh.get('status') == 'FLOW_MESH_SCAN_PASSED' and mesh.get('checked') == 2048
             and mesh.get('groups') == 4 and mesh.get('lanes') == 1024
             and mesh.get('patterns') == ['empty', 'full', 'every-third', 'last-only'],
             'selected-pipeline actual dispatch proof differs')
    for field, source in (('advectionSourceSha256', 'advection_smoke.mjs'), ('meshScanSourceSha256', 'mesh_scan_smoke.mjs')):
        _require(selected.get(field) == (build['sources'].get('addons/flow/' + source) if source_build is None else source_build.source_sha('addons/flow/' + source))
                 == file_hashes.get('addons/' + source) and bool(selected.get(field)), 'dispatch source changed')
    return {'status': 'PASS', 'modules': 124, 'selectedPipelines': 123, 'excludedPipeline': EXCLUDED_PIPELINE,
            'artifactHashes': pair, 'scope': 'Actual recorded adapter and declared formats; no universal-platform or all-variant claim.'}
