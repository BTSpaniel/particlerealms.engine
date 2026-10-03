# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Fresh-source Flow identity with original transaction and scalar oracles."""
import json

from . import physics as base
from .combined_native import require, sha
from .flow_transactions import (COMPONENT_ABIS, DESCRIPTOR_ROUTE, ENGINE_SOURCES,
    MOMENTUM_CASES, REBASE_CASES, _hashes, _rebase, _momentum)
from .source_build_numerical import checked


def runtime_aliases(proof, pair, prefix):
    expected = {prefix + name: digest for name, digest in pair.items()}
    require(proof.get('servedRuntimeHashes') == proof.get('servedRuntimeHashesAfter') == expected,
        'source-build Flow runtime alias pair differs')
    for route, digest in proof.get('servedSourceHashes', {}).items():
        if route.startswith(('/dist/candidate/', '/engine/sim/physics/physx-pe.')):
            require(route in expected and digest == expected[route], 'unknown or conflicting Flow native alias')
    return expected


def addon_inputs(context, proof, *, scalar=False):
    names = base.FLOW_SCALAR_NATIVE_SOURCES if scalar else base.FLOW_SOLID_NATIVE_SOURCES
    native = context.sources(names)
    addon = proof.get('addonSourceHashes')
    require(_hashes(addon), 'Flow addon source map missing')
    require(context.sources(addon.keys()) == addon, 'Flow addon source bytes differ from fresh SDK')
    return native, addon


def verify_source_build_scalar(proof, artifact_hashes, bridge_sha256, bridge_sources, addon_sources,
                               file_hashes, *, source_build):
    context = checked(source_build)
    context.baseline_role('scalar', proof)
    require(context.pair == artifact_hashes, 'scalar native pair differs')
    native, addon = addon_inputs(context, proof, scalar=True)
    require(native == bridge_sources and addon == addon_sources, 'scalar caller input map differs')
    # This original runner records the pair in servedSourceHashes. No alias-map
    # rewrite is required, and its complete original eight numerical cases run.
    base.verify_flow_scalar_evidence(proof, artifact_hashes, bridge_sha256, native, addon, file_hashes)


def verify_source_build_transactions(proofs, build, build_sha256, artifacts, files,
        tested_descriptor_sha256, *, source_build, execution):
    context = checked(source_build)
    context.require_build(build)
    require(artifacts == context.artifacts and build_sha256 == context.build_sha256
        and set(proofs) == {'rebase', 'momentum'} and isinstance(execution, dict)
        and set(execution) == set(proofs), 'transaction source-build/pair/role identity differs')
    flow = context.flow
    require(base._section_exact({key: flow.get(key) for key in COMPONENT_ABIS}, COMPONENT_ABIS), 'fresh Flow ABI values differ')
    # Full source context already checks actual 24 compiles, one partial object,
    # direct five-object/nine-archive link, shaders, compiler and source bytes.
    # The original component710 manifest is never synthesized for this dialect.
    for name, row in flow['shaderInventory'].items():
        require(files.get('flow-wgsl/' + name) == row['sha256'], 'transaction shader payload changed')
    pair = context.pair
    engine_identity, engine_served = None, {}
    for role, proof in proofs.items():
        supplied = execution[role]
        require(set(supplied) == {'raw', 'witness', 'reference'}, 'transaction retained evidence fields differ')
        context.flow_role(role, proof, supplied['raw'], supplied['witness'], supplied['reference'])
        require(proof.get('sharedEngineModule') is True, 'transaction did not use one Engine module')
        for field in ('sourceHashes', 'bridgeSources', 'addonSourceHashes', 'servedSourceHashes',
                'engineSourceHashes', 'servedEngineHashes', 'servedRuntimeHashes'):
            require(_hashes(proof.get(field)) and proof[field] == proof.get(field + 'After'),
                'changed or missing transaction source field: ' + field)
        native, addon = addon_inputs(context, proof)
        aliases = runtime_aliases(proof, pair, '/engine/sim/physics/')
        required = ENGINE_SOURCES if role == 'rebase' else {name for name in ENGINE_SOURCES if name.startswith('engine/sim/')}
        require(ENGINE_SOURCES <= proof['engineSourceHashes'].keys()
            and proof['servedEngineHashes'].get(DESCRIPTOR_ROUTE) == tested_descriptor_sha256
            and all(proof['servedEngineHashes'].get('/' + name) == proof['engineSourceHashes'][name] for name in required),
            'transaction coordinator/tested identity differs')
        require(engine_identity is None or engine_identity == proof['engineSourceHashes'], 'transaction Engine consumers differ')
        engine_identity = proof['engineSourceHashes']
        require(all(name not in engine_served or engine_served[name] == digest
            for name, digest in proof['servedEngineHashes'].items()), 'conflicting transaction served Engine bytes')
        engine_served.update(proof['servedEngineHashes'])
        base._verify_flow_addon_evidence(proof, pair, files.get('addons/flow_host_webgpu.mjs'), native, addon, files,
            abi_field='flowSolidBoundaryAbi', required_cases=REBASE_CASES if role == 'rebase' else MOMENTUM_CASES,
            label='Source-built Flow transactions', native_sources=base.FLOW_SOLID_NATIVE_SOURCES,
            addon_required=base.FLOW_SOLID_ADDON_SOURCES,
            helpers=('flow_host_webgpu.mjs', 'flow_solid_boundary.mjs', 'flow_scalar_sources.mjs'),
            require_result_abi=False, runtime_prefix='/engine/sim/physics/', runtime_hashes=aliases)
        (_rebase if role == 'rebase' else _momentum)(proof)
    return {'status': 'PASS', 'rebaseCases': 10, 'momentumCases': 5,
        'freshFlowBuildSha256': context.source_sha('dist/flow-host/build-manifest.json'),
        'runtimeBuildSha256': build_sha256, 'engineSourceHashes': engine_identity, 'servedEngineHashes': engine_served}


def verify_source_build_momentum_corpus(raw, files, context):
    context = checked(context)
    require(type(raw) is bytes and sha(raw) == context.source_sha('dist/flow-wgsl/addons/momentum/manifest.json'),
        'momentum source-built corpus bytes differ')
    corpus = json.loads(raw)
    rows = corpus.get('shaders', [])
    require(type(corpus.get('abi')) is int and corpus['abi'] == 1 and len(rows) == 2
        and {row.get('wgsl') for row in rows} == {'addons/momentum/PrMomentumGatherCS.wgsl',
            'addons/momentum/PrMomentumApplyCS.wgsl'}, 'momentum kernel inventory differs')
    require(_hashes(corpus.get('sourceHashes')) and all(context.source_sha('addons/flow/' + name) == digest
        for name, digest in corpus['sourceHashes'].items()), 'momentum compiler sources differ')
    for row in rows:
        require(context.source_sha(row['source']) == row['sourceSha256']
            and row['reflection'] == row['wgsl'].replace('.wgsl', '.reflection.json')
            and all(files.get('flow-wgsl/' + row[key]) == row[key + 'Sha256'] for key in ('wgsl', 'reflection')),
            'momentum source/reflection/payload identity differs')
