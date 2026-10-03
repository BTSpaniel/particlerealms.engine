# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Portable composition for an actual SDK source build and its original SDK10.

This additive entrypoint accepts only inventoried immutable bytes. It does not
open producer paths, execute an SDK helper or install a runtime. All seventeen
Blast roles, original live/fullwall rates and baseline/Flow/thermal controls are
mandatory. Compile observations and diagnostic derivatives cannot substitute.
"""
import json

from . import physics as base
from .blast_sections_v3 import ROLES as SECTION_ROLES, verify_blast_sections_v3_evidence
from .combined_baseline import BASELINE_ROLES, ROLES as BASELINE_ALL, raw_input_hashes
from .combined_native import metadata, require, sha, verify_exports, verify_thermal_license
from .combined_runtime import ADMISSION, CAPABILITIES, FLOW_JS, BULK_JS, declared_inputs, relative, reference as staged_reference
from .flow_combined import verify_combined_flow_solid_evidence
from .flow_transactions import DESCRIPTOR_ROUTE, verify_transaction_evidence
from .source_build_baseline import physical_hashes, reference
from .source_build_context import joined, physical_key
from .source_build_flow import (addon_inputs, verify_source_build_momentum_corpus,
    verify_source_build_scalar)
from .source_build_numerical import SourceBuildNumerical
from .wood_thermal_diagnostics import SOURCES as THERMAL_SOURCES, verify_wood_thermal_diagnostics

SCHEMA = 'particle-physics-source-build-numerical-inputs/v1'
SCOPE = 'Exact original SDK source build and separately executed numerical proofs; no proof transplantation.'
ROLE_KEYS = {'schema', 'scope', 'baseline', 'sections', 'exports', 'thermal', 'transactions',
    'testedManifest', 'assets', 'freshnessWitness'}
INDEX_MEMBER = 'evidence/source-build-retained-index.json'
NUMERICAL_MEMBER = 'evidence/source-build-numerical-inputs.json'


def validate_role_index(evidence):
    """Fail missing live UI before considering any partial numerical successes."""
    require(isinstance(evidence, dict) and set(evidence) == ROLE_KEYS
        and evidence.get('schema') == SCHEMA and evidence.get('scope') == SCOPE,
        'unknown numerical source-build input schema/scope')
    baseline, sections = evidence['baseline'], evidence['sections']
    require(isinstance(baseline, dict) and set(baseline) == {'aggregate', 'raw', 'witnesses'}
        and set(baseline['raw']) == set(baseline['witnesses']) == BASELINE_ALL,
        'source-built numerical admission needs all sixteen original baseline roles')
    require(isinstance(sections, dict) and set(sections) == {'raw', 'witness'}
        and set(sections['raw']) == SECTION_ROLES, 'source-built numerical admission needs all seventeen original Blast roles')
    require(isinstance(evidence['transactions'], dict) and set(evidence['transactions']) == {'rebase', 'momentum'}
        and all(set(row) == {'raw', 'witness'} for row in evidence['transactions'].values()),
        'transaction raw/witness inventory differs')


def verify_source_build_inventory(read, admission, manifest, records):
    """Distinct staged dialect; original Combined06 dispatch remains its default."""
    require(set(admission) == {'schema', 'assets', 'retainedIndex', 'numericalEvidence'}
        and admission['schema'] == 'particle-physics-source-build-admission/v1'
        and base._section_exact(manifest.get('capabilities'), CAPABILITIES),
        'unsupported staged source-build admission')
    index_body, numerical_body = read.raw(INDEX_MEMBER), read.raw(NUMERICAL_MEMBER)
    for row, body in ((admission['retainedIndex'], index_body), (admission['numericalEvidence'], numerical_body)):
        staged_reference(row, body)
        physical_key(row['path'])
    index, numerical = json.loads(index_body), json.loads(numerical_body)
    validate_role_index(numerical)
    require(base._section_exact(admission['assets'], numerical['assets']), 'staged source-built asset mapping differs')
    require(isinstance(index.get('inputs'), dict), 'retained source-build index is missing')
    members = {relative(row['member']) for row in index['inputs'].values()}
    expected = members | {ADMISSION, INDEX_MEMBER, NUMERICAL_MEMBER}
    require(set(records) == expected and set(admission['assets']) <= members,
        'missing or extra staged source-build payload')
    files = {name: read.raw(name) for name in members}
    for name, row in admission['assets'].items():
        require(metadata(files[name]) == {key: row[key] for key in ('sha256', 'bytes')}, 'staged executable asset bytes differ')
        bindings = [value for path, value in index['inputs'].items() if physical_key(path) == physical_key(row['path'])]
        require(len(bindings) == 1 and bindings[0]['member'] == name, 'staged asset aliases another retained source')
    return verify_source_build_numerical_evidence(files, index, numerical)


def asset_source_paths(context):
    sources = context.checked.source_hashes
    # Preserve all actual package attribution inputs, including upstream license
    # texts. No blanket MIT inference is made from the owner's thermal header.
    notices = {name for name in sources if name.startswith(('licenses/', 'LICENSES/'))}
    notices |= {'LICENSE', 'PROVENANCE.md', 'THIRD_PARTY_NOTICES.md', 'license-provenance.json'}
    require(notices <= sources.keys(), 'source-built notice inventory incomplete')
    expected = {name: 'dist/candidate/' + name for name in ('physx-pe.mjs', 'physx-pe.wasm', 'physx-pe.d.ts', 'physx-pe.d.mts')}
    expected.update({'addons/' + name: 'addons/flow/' + name for name in FLOW_JS})
    expected.update({'addons/' + name: 'bridge/' + name for name in BULK_JS})
    expected.update({'flow-wgsl/' + name: 'dist/flow-wgsl/' + name for name in context.checked.shader_inventory})
    expected.update({'notices/' + name: name for name in notices})
    expected['PhysXWasm.idl'] = 'work/candidate/PhysX/physx/source/webidlbindings/src/wasm/PhysXWasm.idl'
    return expected


def verify_assets(context, records):
    paths = asset_source_paths(context)
    require(isinstance(records, dict) and set(records) == set(paths), 'source-built runtime asset inventory differs')
    result = {}
    for name, source in paths.items():
        row = records[name]
        require(physical_key(row['path']) == physical_key(joined(context.root, source)),
            'runtime asset original source redirected: ' + name)
        body = reference(context.read, row)
        require(body == context.source(source), 'runtime asset differs from actual selected source: ' + name)
        result[name] = body
    require(result['physx-pe.d.ts'] == result['physx-pe.d.mts'], 'ESM declaration entrypoints differ')
    return result


def verify_source_freshness(context, proof, documents, baseline, batch, raw_references):
    """Retained admission reads are distinct from each role's execution witness."""
    require(proof.get('schema') == 'particle-physics-source-build-freshness/v1'
        and proof.get('status') == 'PASS' and proof.get('sourceUnchanged') is True
        and proof.get('scope') == 'Physical source admission reads only; original execution witnesses remain authoritative.'
        and proof.get('sourceHashes') == proof.get('sourceHashesAfter')
        and proof.get('toolSources') == proof.get('toolSourcesAfter'), 'fresh source-build admission reads absent/changed')
    current = context.require_closure(proof['sourceHashes'])
    for ref in raw_references:
        require(current.get(physical_key(ref['path'])) == ref['sha256']
            and metadata(reference(context.read, ref)) == {key: ref[key] for key in ('sha256', 'bytes')},
            'original raw proof/witness was not freshly rechecked')
    tools = physical_hashes(proof.get('toolSources'))
    required_tools = {'combined_runtime.py', 'combined_native.py', 'physics.py', 'combined_baseline.py',
        'flow_combined.py', 'flow_transactions.py', 'blast_sections_v3.py', 'wood_thermal_diagnostics.py',
        'source_build_runtime.py', 'source_build_numerical.py', 'source_build_flow.py', 'source_build_context.py',
        'source_build_clean_evidence.py', 'source_build_command_trace.py', 'source_build_baseline.py',
        'install_physics_runtime.py', 'prepare_combined_runtime.py', 'prepare_source_build_runtime.py'}
    require(required_tools <= {name.rsplit('/', 1)[-1] for name in tools}
        and all(current.get(name) == digest for name, digest in tools.items()), 'composition tool closure incomplete')
    maps = proof.get('inputFiles')
    require(isinstance(maps, dict) and set(maps) == set(documents), 'numerical raw source mapping inventory differs')
    for role, document in documents.items():
        fields = declared_inputs(document)
        require(isinstance(maps[role], dict) and set(maps[role]) == set(fields), 'numerical raw source field omitted/invented')
        for field, aliases in fields.items():
            require(set(maps[role][field]) == set(aliases), 'numerical raw source alias omitted/invented')
            for alias, digest in aliases.items():
                path = physical_key(maps[role][field][alias])
                require(current.get(path) == digest, 'actual numerical source is now stale: ' + alias)
                if field not in ('servedSourceHashes', 'servedEngineHashes', 'servedRuntimeHashes') and (
                        ':' in alias[:3] or alias.startswith('/')):
                    require(path == physical_key(alias), 'absolute numerical source alias redirected')
                if role.startswith('baseline/') and field + ':' + alias in baseline['inputFiles'][role.split('/')[1]]:
                    require(path == physical_key(baseline['inputFiles'][role.split('/')[1]][field + ':' + alias]),
                        'baseline execution mapping was redirected at promotion')
                if role.startswith('sections/'):
                    prefix = {'sourceHashes': 'source:', 'servedSourceHashes': 'served:', 'screenshots': 'photograph:'}.get(field)
                    if prefix is not None:
                        require(path == physical_key(batch['inputFiles']['evidence/' + role + '.json'][prefix + alias]),
                            'section execution mapping was redirected at promotion')


def verify_source_build_numerical_evidence(retained_files, retained_index, evidence):
    """Full portable numerical composition; cannot pass with current missing UI/rate proofs."""
    validate_role_index(evidence)
    context = SourceBuildNumerical(retained_files, retained_index)
    read = context.read
    raw = lambda ref: reference(read, ref)
    document = lambda ref: json.loads(raw(ref))
    assets = verify_assets(context, evidence['assets'])
    hashes = {name: sha(body) for name, body in assets.items()}
    build, pair, artifacts = context.build, context.pair, context.artifacts
    b = evidence['baseline']
    reports = {role: raw(ref) for role, ref in b['raw'].items()}
    witnesses = {role: raw(ref) for role, ref in b['witnesses'].items()}
    aggregate = document(b['aggregate'])
    proofs = {name: json.loads(reports[role]) for name, role in BASELINE_ROLES.items()}
    proofs['upgrade-511.json'] = aggregate
    corpora = {'original': assets['flow-wgsl/manifest.json'], **{kind: assets['flow-wgsl/addons/' + kind + '/manifest.json']
        for kind in ('solid', 'scalar', 'momentum')}}
    base.verify_sections_baseline_evidence(proofs, artifacts, build, hashes['addons/flow_host_webgpu.mjs'],
        sha(corpora['original']), json.loads(corpora['original']), source_build=context,
        combined_baseline={'raw_bytes': raw(b['aggregate']), 'raw_sha256': b['aggregate']['sha256'],
            'build_sha256': context.build_sha256, 'receipts': reports, 'witnesses': witnesses},
        combined_shaders={'raw_reports': {role: reports[role] for role in ('modules', 'pipelines', 'addons')},
            'witnesses': {role: json.loads(witnesses[role]) for role in ('modules', 'pipelines', 'addons')},
            'build': build, 'build_sha256': context.build_sha256, 'file_hashes': hashes, 'raw_corpora': corpora})
    solid, scalar = (json.loads(reports[role]) for role in ('solid', 'scalar'))
    native, addon = addon_inputs(context, solid)
    verify_combined_flow_solid_evidence(solid, pair, hashes['addons/flow_host_webgpu.mjs'], native, addon, hashes, source_build=context)
    scalar_native, scalar_addon = addon_inputs(context, scalar, scalar=True)
    verify_source_build_scalar(scalar, pair, hashes['addons/flow_host_webgpu.mjs'], scalar_native, scalar_addon, hashes, source_build=context)
    base.verify_flow_solid_corpus(json.loads(corpora['solid']), hashes, addon, json.loads(corpora['original']))
    base.verify_flow_scalar_corpus(json.loads(corpora['scalar']), hashes, scalar_addon)
    tx = {role: document(row['raw']) for role, row in evidence['transactions'].items()}
    tested = document(evidence['testedManifest'])
    require(all(tested.get(key) == value for key, value in {'schema': 'particle-physics-runtime/v1',
        'moduleName': 'physx-pe', 'sdkVersion': base.SDK_VERSION, 'upstreamTag': 'ovphysx-0.6.3', 'upstreamCommit': base.UPSTREAM_COMMIT}.items()),
        'tested runtime descriptor belongs to another SDK')
    transactions = verify_transaction_evidence(tx, build, None, None, context.build_sha256, artifacts, hashes,
        sha(base.physics_runtime_descriptor(tested)), source_build=context,
        execution={role: {'raw': raw(row['raw']), 'witness': document(row['witness']), 'reference': row['raw']}
            for role, row in evidence['transactions'].items()})
    verify_source_build_momentum_corpus(corpora['momentum'], hashes, context)
    thermal = verify_wood_thermal_diagnostics(document(evidence['thermal']), pair, build,
        raw_bytes=raw(evidence['thermal']), raw_sha256=evidence['thermal']['sha256'], source_build=context)
    signatures = raw(context.descriptor['sourceSignatures'])
    exports = verify_exports(document(evidence['exports']), build, assets['physx-pe.mjs'], assets['physx-pe.wasm'],
        signatures, assets['physx-pe.d.ts'], json.loads(context.source('types/addon-abi.json')), source_build=context)
    recipe_root = 'reference/combined-native-06/'
    recipe = json.loads(context.source(recipe_root + 'dist/candidate/build-manifest.json'))
    transform_raw = context.source(recipe_root + 'provenance/thermal-license-transform.json')
    transform = json.loads(transform_raw)
    selected_sources = {name: context.source(name) for name in THERMAL_SOURCES}
    selected_sources.update({row['originalPath']: context.source(recipe_root + row['originalPath']) for row in transform['files'].values()})
    verify_thermal_license(transform_raw, recipe, selected_sources)
    s = evidence['sections']
    sections = {role: document(ref) for role, ref in s['raw'].items()}
    batch = document(s['witness'])
    base.verify_sections_parity_baseline(sections['manufactured'], tested,
        {key: evidence['testedManifest'][key] for key in ('sha256', 'bytes')})
    section_result = verify_blast_sections_v3_evidence(sections, pair, build, source_build=context,
        references={role: {'originalPath': ref['path'], 'sha256': ref['sha256']} for role, ref in s['raw'].items()},
        witness=batch, receipt_bytes={role: raw(ref) for role, ref in s['raw'].items()})
    documents = {'baseline/' + role: json.loads(body) for role, body in reports.items()}
    documents.update({'sections/' + role: proof for role, proof in sections.items()})
    documents.update({'transactions/' + role: proof for role, proof in tx.items()})
    documents.update(exports=document(evidence['exports']), thermal=document(evidence['thermal']))
    raw_references = [*b['raw'].values(), *b['witnesses'].values(), b['aggregate'], *s['raw'].values(), s['witness'],
        evidence['exports'], evidence['thermal'], evidence['testedManifest'], *read.index['roles'].values()]
    raw_references += [ref for row in evidence['transactions'].values() for ref in row.values()]
    verify_source_freshness(context, document(evidence['freshnessWitness']), documents, aggregate, batch, raw_references)
    return {'schema': 'particle-physics-source-build-numerical-result/v1', 'status': 'PASS',
        'artifactHashes': pair, 'sourceRevision': context.checked.raw_json('parent')['sourceRevisionBefore'],
        'capabilities': dict(CAPABILITIES), 'baselineRoles': 16, 'sections': section_result,
        'transactions': transactions, 'thermal': thermal, 'exports': exports,
        'scope': 'Exact SDK10 and same-pair numerical/clock evidence; CPU PhysX/Blast, GPU Flow; MRI9 remains default-disabled diagnostic only.'}
