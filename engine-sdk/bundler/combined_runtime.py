# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Explicit portable composition of the combined runtime's original evidence.

The caller supplies a staged root and its exact byte inventory. Absolute paths
inside receipts are provenance only. No legacy installer or dispatch changes.
"""
import json
import re
from pathlib import Path, PurePosixPath

from . import physics as base
from .blast_sections_v3 import CAPABILITIES as SECTION_CAPS, ROLES as SECTION_ROLES, verify_blast_sections_v3_evidence
from .combined_baseline import BASELINE_ROLES, ROLES as BASELINE_ROLES_ALL
from .combined_native import BINDING, _file_records, metadata, require, sha, verify_build, verify_exports, verify_source_build, verify_thermal_license
from .flow_combined import EXCLUDED_PIPELINE, _canonical, _physical_hashes, verify_combined_flow_solid_evidence
from .flow_transactions import CAPABILITIES as TRANSACTION_CAPS, EVIDENCE_PATHS, verify_transaction_inventory
from .wood_thermal_diagnostics import CAPABILITIES as THERMAL_CAPS, SOURCES as THERMAL_SOURCES, verify_wood_thermal_diagnostics

ADMISSION = 'evidence/combined-admission.json'
BUILD = 'evidence/candidate-rust-build.json'
TESTED = EVIDENCE_PATHS['testedManifest']
FRESHNESS = 'evidence/combined-freshness.json'
AGGREGATE = 'evidence/combined-baseline.json'
SECTION_WITNESS = 'evidence/sections-batch-witness.json'
FIXED_EVIDENCE = frozenset({AGGREGATE, SECTION_WITNESS, 'evidence/native-exports.json',
    'evidence/selected-addon-exports.json', 'evidence/source-selection.json', 'evidence/addon-abi.json',
    'evidence/thermal-license-transform.json', 'evidence/wood-thermal-diagnostic.json',
    'evidence/source-build.json', 'evidence/source-build-inner.json', 'evidence/source-build-manifest.json',
    'evidence/source-build-selection.json', 'evidence/source-build-prepared.json', 'evidence/source-build-lock.json',
    'evidence/source-build-native.json', 'evidence/source-build-flow.json',
    'evidence/source-build-selected-blast.json',
    *('evidence/source-build-corpora/' + kind + '.json' for kind in ('original', 'solid', 'scalar', 'momentum')),
    *EVIDENCE_PATHS.values()}) - {TESTED}
INPUT_FIELDS = ('sourceHashes', 'servedSourceHashes', 'engineSourceHashes', 'servedEngineHashes',
    'servedRuntimeHashes', 'bridgeSources', 'addonSourceHashes', 'tools', 'toolSources', 'sourceHashesBefore', 'sources')
FLOW_JS = frozenset(('advection_smoke.mjs', 'mesh_scan_smoke.mjs', 'webgpu_bridge.mjs',
    'flow_host_webgpu.mjs', 'flow_solid_boundary.mjs', 'flow_scalar_sources.mjs'))
BULK_JS = frozenset(('physx-bulk.mjs', 'physx-bulk-rust.mjs'))
CAPABILITIES = {
    'rigidBodies': True, 'rustBulkAbi': 2, 'bulkApiAbi': 1, 'simd128': True,
    'blastVersion': '5.0.6', 'blastFractureSelfTest': True, 'blastSceneApi': True,
    'flowStagingAbi': 1, 'flowShaderModules': 97, 'flowSelectedPipelines': 96,
    'flowSolver': True, 'flowHostAbi': 1, 'flowExcludedPipeline': EXCLUDED_PIPELINE,
    **base.FLOW_SCENE_CAPABILITIES, **base.FLOW_GEOMETRY_CAPABILITIES, **base.FLOW_COLLISION_CAPABILITIES,
    **base.BLAST_STRESS_CAPABILITIES, **base.BLAST_AUTHORING_CAPABILITIES, **base.BLAST_MASS_CAPABILITIES,
    **base.FLOW_SOLID_CAPABILITIES, **base.FLOW_SCALAR_CAPABILITIES, **TRANSACTION_CAPS, **SECTION_CAPS, **THERMAL_CAPS,
    'physxBackend': 'cpu-wasm-simd', 'blastBackend': 'cpu-wasm', 'flowBackend': 'webgpu',
    'flowTotalShaderModules': 124, 'flowTotalSelectedPipelines': 123,
    'flowShaderCoverageScope': 'recorded-adapter-declared-formats-with-nanovdb-pipeline-excluded',
}


def relative(name):
    require(isinstance(name, str) and name and '\\' not in name and ':' not in name
        and not PurePosixPath(name).is_absolute() and all(p not in ('', '.', '..') for p in name.split('/')),
        'unsafe staged inventory path')
    return name


def baseline_path(role, *, witness=False):
    return 'evidence/baseline/' + role + ('-witness' if witness else '') + '.json'


def section_path(role):
    return 'evidence/sections/' + role + '.json'


def photograph_names(ui):
    rows = ui.get('screenshots', [])
    require(isinstance(rows, list) and all(isinstance(row, dict)
        and isinstance(row.get('name'), str) and re.fullmatch('[a-z0-9-]+', row['name']) for row in rows),
        'unsafe photograph names')
    require(len({row['name'] for row in rows}) == len(rows), 'duplicate named photographs')
    return {'evidence/sections/photographs/' + row['name'] + '.png': row for row in rows}


def evidence_names(build, live_ui=None):
    thermal_sources = {'evidence/thermal-sources/' + name for name in THERMAL_SOURCES}
    thermal_sources |= {'evidence/thermal-sources/provenance/thermal-alpha-original/' + name for name in THERMAL_SOURCES}
    return FIXED_EVIDENCE | {baseline_path(role, witness=value) for role in BASELINE_ROLES_ALL for value in (False, True)} \
        | {section_path(role) for role in SECTION_ROLES} | thermal_sources | set(photograph_names(live_ui or {}))


def payload_names(build, component):
    return {'physx-pe.mjs', 'physx-pe.wasm', 'physx-pe.d.ts', 'physx-pe.d.mts', 'PhysXWasm.idl'} \
        | {'addons/' + name for name in FLOW_JS | BULK_JS} \
        | {name.removeprefix('dist/') for name in component['shaderInventory']} \
        | {name for name in build['sources'] if name.startswith('notices/')}


def candidate_manifest(files):
    """Generate proposed identity only; callers must run the verifier before use."""
    return {'schema': 'particle-physics-runtime/v1', 'moduleName': 'physx-pe', 'sdkVersion': base.SDK_VERSION,
        'upstreamTag': 'ovphysx-0.6.3', 'upstreamCommit': base.UPSTREAM_COMMIT, 'bindingOrigin': BINDING,
        'capabilities': dict(CAPABILITIES), 'files': {name: metadata(data) for name, data in sorted(files.items())},
        'combinedEvidence': ADMISSION}


class StagedBytes:
    """Only inventoried regular files under the selected staging root can be read."""
    def __init__(self, root, records):
        self.root = Path(root).resolve() / base.PHYSICS_ROOT
        require(isinstance(records, dict) and len({relative(name).casefold() for name in records}) == len(records),
            'duplicate/case-aliased staged members')
        self.records, self.cache = records, {}

    def raw(self, name):
        relative(name)
        require(name in self.records, 'missing inventoried file: ' + name)
        if name not in self.cache:
            path = self.root / name
            require(path.resolve().is_relative_to(self.root) and path.is_file()
                and all(not ancestor.is_symlink() for ancestor in (path, *path.parents) if ancestor != self.root.parent),
                'staged file is not a contained regular member: ' + name)
            data = path.read_bytes()
            require(base._section_exact(metadata(data), self.records[name]), 'inventoried file bytes differ: ' + name)
            self.cache[name] = data
        return self.cache[name]

    def json(self, name):
        result = json.loads(self.raw(name))
        require(isinstance(result, dict), 'evidence must be a JSON object: ' + name)
        return result


def reference(ref, data):
    require(isinstance(ref, dict) and set(ref) == {'path', 'sha256', 'bytes'}
        and base._section_exact(metadata(data), {key: ref[key] for key in ('sha256', 'bytes')}), 'original byte reference differs')
    _canonical(ref['path'])


def declared_inputs(proof):
    """Keep source fields and their aliases separate, including duplicate names."""
    maps = {}
    for field in INPUT_FIELDS:
        values = proof.get(field)
        if values is None:
            continue
        require(isinstance(values, dict), 'raw source map is malformed: ' + field)
        for alias, digest in values.items():
            require(isinstance(alias, str) and alias and isinstance(digest, str) and len(digest) == 64
                and all(c in '0123456789abcdef' for c in digest), 'raw source digest is malformed')
        maps[field] = values
    for field in ('referenceInputsBefore', 'compilerInputsBefore'):
        if field in proof:
            rows = proof[field]
            require(isinstance(rows, dict), 'malformed source-build file snapshot: ' + field)
            if rows:
                try:
                    _file_records(rows, field, allow_empty_python_package=field == 'compilerInputsBefore')
                except ValueError:
                    require(False, 'malformed source-build file snapshot: ' + field)
            maps[field] = {name: row['sha256'] for name, row in rows.items()}
    if 'rustCompilerInputsBefore' in proof:
        rows = proof['rustCompilerInputsBefore'].get('files', {})
        require(isinstance(rows, dict) and bool(rows), 'missing Rust source-build snapshot')
        maps['rustCompilerInputsBefore'] = {row['resolvedPath']: row['sha256'] for row in rows.values()}
        require(len(maps['rustCompilerInputsBefore']) == len(rows), 'duplicate Rust resolved input')
    if proof.get('schema') == 'physx-pe.fresh-selected-native-build/v1':
        maps['generated.generated'] = proof.get('generated', {}).get('generated', {})
        require(isinstance(maps['generated.generated'], dict) and bool(maps['generated.generated'])
            and all(isinstance(name, str) and re.fullmatch('[0-9a-f]{64}', digest)
                for name, digest in maps['generated.generated'].items()), 'missing actual generated compiler inputs')
    if 'screenshots' in proof:
        rows = proof['screenshots']
        require(isinstance(rows, list) and len({row['path'] for row in rows}) == len(rows), 'duplicate photograph aliases')
        maps['screenshots'] = {row['path']: row['sha256'] for row in rows}
    return maps


def verify_retained_aliases(maps, documents):
    """Do not let a new promotion witness change old execution route mappings."""
    aggregate = documents[AGGREGATE]
    for role in BASELINE_ROLES_ALL:
        name = baseline_path(role)
        for field, values in maps[name].items():
            if field not in ('sourceHashes', 'servedSourceHashes', 'engineSourceHashes', 'servedEngineHashes', 'servedRuntimeHashes'):
                continue
            for alias, path in values.items():
                require(_canonical(path) == _canonical(aggregate['inputFiles'][role][field + ':' + alias]),
                    'promotion changed an executed baseline route: ' + alias)
    batch = documents[SECTION_WITNESS]
    for role in SECTION_ROLES:
        name = section_path(role)
        for field, prefix in (('sourceHashes', 'source:'), ('servedSourceHashes', 'served:'), ('screenshots', 'photograph:')):
            for alias, path in maps[name].get(field, {}).items():
                require(_canonical(path) == _canonical(batch['inputFiles'][name][prefix + alias]),
                    'promotion changed an executed section route: ' + alias)


def verify_freshness(witness, documents, build, build_ref):
    require(witness.get('schema') == 'particle-physics-combined-freshness/v1'
        and witness.get('status') == 'PASS' and witness.get('sourceUnchanged') is True
        and witness.get('scope') == 'Physical source admission reads only; original execution witnesses remain authoritative.'
        and witness.get('sourceHashes') == witness.get('sourceHashesAfter')
        and witness.get('toolSources') == witness.get('toolSourcesAfter'), 'fresh source admission is absent or changed')
    current, tools = _physical_hashes(witness['sourceHashes']), _physical_hashes(witness['toolSources'])
    require(all(current.get(name) == digest for name, digest in tools.items()), 'promotion tools missing from physical closure')
    required_tools = {'combined_runtime.py', 'combined_native.py', 'prepare_combined_runtime.py', 'physics.py',
        'combined_baseline.py', 'flow_combined.py', 'flow_transactions.py', 'blast_sections_v3.py',
        'wood_thermal_diagnostics.py', 'install_physics_runtime.py'}
    require(required_tools <= {PurePosixPath(name).name for name in tools}, 'combined admission tool closure is incomplete')
    maps = witness.get('inputFiles')
    expected = {name: declared_inputs(proof) for name, proof in documents.items()}
    require(isinstance(maps, dict) and set(maps) == set(expected), 'raw source mapping role set differs')
    for name, fields in expected.items():
        require(isinstance(maps[name], dict) and set(maps[name]) == set(fields), 'raw source field omitted or invented: ' + name)
        for field, aliases in fields.items():
            supplied = maps[name][field]
            require(isinstance(supplied, dict) and set(supplied) == set(aliases), 'raw source alias omitted or invented: ' + name + ':' + field)
            for alias, digest in aliases.items():
                require(current.get(_canonical(supplied[alias])) == digest, 'tested source differs from current physical admission: ' + alias)
                # Absolute file aliases must retain their physical identity.
                # HTTP routes in served maps are handled by retained witnesses.
                if field not in ('servedSourceHashes', 'servedEngineHashes', 'servedRuntimeHashes') and (
                        ':' in alias[:3] or alias.startswith('/')):
                    require(_canonical(supplied[alias]) == _canonical(alias), 'absolute source alias was redirected')
                if field in ('sourceHashesBefore', 'referenceInputsBefore'):
                    require(_canonical(supplied[alias]) == _canonical(documents[name]['sourceRoot']) + '/' + relative(alias),
                        'source-build root alias was redirected')
    verify_retained_aliases(maps, documents)
    source_root = _canonical(build['sourceRoot'])
    require(all(current.get(source_root + '/' + relative(name)) == digest for name, digest in build['sources'].items())
        and current.get(_canonical(build_ref['path'])) == build_ref['sha256'], 'complete compiled input closure absent from promotion reads')
    for name, row in build['artifacts'].items():
        require(current.get(source_root + '/dist/candidate/' + name) == row['sha256'], 'selected pair absent from physical admission')
    return current


def verify_combined_inventory(root, manifest, records):
    """Portable full gate. Missing or failing performance, UI or build proofs reject."""
    require(base._section_exact(manifest.get('capabilities'), CAPABILITIES)
        and manifest.get('combinedEvidence') == ADMISSION and manifest.get('bindingOrigin') == BINDING
        and manifest.get('schema') == 'particle-physics-runtime/v1' and manifest.get('sdkVersion') == base.SDK_VERSION
        and manifest.get('upstreamTag') == 'ovphysx-0.6.3' and manifest.get('upstreamCommit') == base.UPSTREAM_COMMIT
        and manifest.get('moduleName') == 'physx-pe' and base._section_exact(manifest.get('files'), records),
        'unknown, omitted or relabelled combined capability/inventory')
    read = StagedBytes(root, records)
    admission = read.json(ADMISSION)
    if admission.get('schema') == 'particle-physics-source-build-admission/v1':
        from .source_build_runtime import verify_source_build_inventory
        return verify_source_build_inventory(read, admission, manifest, records)
    require(set(admission) == {'schema', 'runtimeBuild', 'testedManifest', 'assets', 'evidence', 'freshnessWitness'}
        and admission['schema'] == 'particle-physics-combined-admission/v1', 'unsupported combined admission index')
    build, component = read.json(BUILD), read.json(EVIDENCE_PATHS['component'])
    verify_build(build)
    live_ui = read.json(section_path('liveUi'))
    require(set(admission['evidence']) == evidence_names(build, live_ui) and set(admission['assets']) == payload_names(build, component)
        and set(records) == set(admission['assets']) | set(admission['evidence']) | {ADMISSION, BUILD, TESTED, FRESHNESS},
        'missing or extra combined asset/evidence role')
    for name, ref in {**admission['assets'], **admission['evidence'], BUILD: admission['runtimeBuild'],
                      TESTED: admission['testedManifest'], FRESHNESS: admission['freshnessWitness']}.items():
        reference(ref, read.raw(name))
    # Read every inventoried member before any subordinate validation. Retained
    # absolute paths never enter StagedBytes.raw or any portable sub-validator.
    files = {name: read.raw(name) for name in records}
    for name, row in photograph_names(live_ui).items():
        require(sha(files[name]) == row.get('sha256') and files[name].startswith(b'\x89PNG\r\n\x1a\n')
            and _canonical(admission['evidence'][name]['path']) == _canonical(row.get('path')),
            'visual review photograph was omitted, replaced or redirected')
    hashes = {name: row['sha256'] for name, row in records.items()}
    artifacts = {name: records[name] for name in ('physx-pe.mjs', 'physx-pe.wasm')}
    require(base._section_exact(build['artifacts'], artifacts), 'runtime and compiled pair differ')
    pair = {name: row['sha256'] for name, row in artifacts.items()}
    aggregate = read.json(AGGREGATE)
    raws = {role: files[baseline_path(role)] for role in BASELINE_ROLES_ALL}
    witnesses = {role: files[baseline_path(role, witness=True)] for role in BASELINE_ROLES_ALL}
    proofs = {name: json.loads(raws[role]) for name, role in BASELINE_ROLES.items()}
    proofs['upgrade-511.json'] = aggregate
    corpora = {'original': files['flow-wgsl/manifest.json'], **{kind: files['flow-wgsl/addons/' + kind + '/manifest.json']
        for kind in ('solid', 'scalar', 'momentum')}}
    base.verify_sections_baseline_evidence(proofs, artifacts, build, hashes['addons/flow_host_webgpu.mjs'],
        sha(corpora['original']), json.loads(corpora['original']),
        combined_shaders={'raw_reports': {role: raws[role] for role in ('modules', 'pipelines', 'addons')},
            'witnesses': {role: json.loads(witnesses[role]) for role in ('modules', 'pipelines', 'addons')},
            'build': build, 'build_sha256': hashes[BUILD], 'file_hashes': hashes, 'raw_corpora': corpora},
        combined_baseline={'raw_bytes': files[AGGREGATE], 'raw_sha256': hashes[AGGREGATE],
            'build_sha256': hashes[BUILD], 'receipts': raws, 'witnesses': witnesses})
    component_admission = {'manifestPath': admission['runtimeBuild']['path'], 'manifestSha256': hashes[BUILD],
        'componentManifestSha256': hashes[EVIDENCE_PATHS['component']], 'componentObjectSha256': component['object']['sha256'],
        'artifacts': artifacts, 'component': component}
    selected = component['inputs']
    native = {name: selected[name] for name in base.FLOW_SOLID_NATIVE_SOURCES}
    addon = {name: selected[name] for name in base.FLOW_SOLID_ADDON_SOURCES}
    verify_combined_flow_solid_evidence(json.loads(raws['solid']), pair, hashes['addons/flow_host_webgpu.mjs'],
        native, addon, hashes, admission=component_admission)
    scalar = json.loads(raws['scalar'])
    scalar_addon = {name: selected[name] for name in base.FLOW_SCALAR_ADDON_SOURCES | scalar['addonSourceHashes'].keys()}
    base.verify_flow_scalar_evidence(scalar, pair, hashes['addons/flow_host_webgpu.mjs'],
        {name: selected[name] for name in base.FLOW_SCALAR_NATIVE_SOURCES}, scalar_addon, hashes)
    base.verify_flow_solid_corpus(json.loads(corpora['solid']), hashes, addon, json.loads(corpora['original']))
    base.verify_flow_scalar_corpus(json.loads(corpora['scalar']), hashes, scalar_addon)
    transactions = verify_transaction_inventory(root, manifest, records)
    thermal = verify_wood_thermal_diagnostics(read.json('evidence/wood-thermal-diagnostic.json'), pair, build,
        raw_bytes=files['evidence/wood-thermal-diagnostic.json'], raw_sha256=hashes['evidence/wood-thermal-diagnostic.json'])
    exports = verify_exports(read.json('evidence/native-exports.json'), build, files['physx-pe.mjs'], files['physx-pe.wasm'],
        files['evidence/selected-addon-exports.json'], files['physx-pe.d.ts'], read.json('evidence/addon-abi.json'))
    require(sha(files['evidence/source-selection.json']) == build['sourceSelectionSha256'], 'native source selection bytes differ')
    source_bytes = {name.removeprefix('evidence/thermal-sources/'): data for name, data in files.items()
        if name.startswith('evidence/thermal-sources/')}
    verify_thermal_license(files['evidence/thermal-license-transform.json'], build, source_bytes)
    source_build = verify_source_build(read.json('evidence/source-build.json'), files['evidence/source-build-inner.json'],
        read.json('evidence/source-build-manifest.json'), files['evidence/source-build-selection.json'],
        files['evidence/source-build-prepared.json'], build, files)
    for name in admission['assets']:
        if name.startswith('notices/'):
            require(hashes[name] == build['sources'].get(name), 'selected notice omitted or changed: ' + name)
        elif name.startswith('addons/'):
            filename = PurePosixPath(name).name
            source = 'addons/flow/' + filename if filename in FLOW_JS else 'provenance/engine-api-audit/engine/sim/physics/' + name
            require(hashes[name] == build['sources'].get(source), 'selected executable addon differs: ' + name)
    lock = read.json('evidence/source-build-lock.json')
    require(sha(files['PhysXWasm.idl']) == lock.get('declaration_idl_sha256') and files['physx-pe.d.ts'] == files['physx-pe.d.mts'],
        'selected IDL or declaration entrypoints differ')
    sections = {role: read.json(section_path(role)) for role in SECTION_ROLES}
    refs = {role: {'originalPath': admission['evidence'][section_path(role)]['path'],
        'sha256': hashes[section_path(role)]} for role in SECTION_ROLES}
    base.verify_sections_parity_baseline(sections['manufactured'], read.json(TESTED), records[TESTED])
    section_result = verify_blast_sections_v3_evidence(sections, pair, build, references=refs,
        witness=read.json(SECTION_WITNESS), receipt_bytes={role: files[section_path(role)] for role in SECTION_ROLES})
    documents = {name: read.json(name) for name in admission['evidence'] if name.endswith('.json')
        and name not in {'evidence/source-selection.json', 'evidence/selected-addon-exports.json', 'evidence/addon-abi.json'}
        and not name.startswith('evidence/thermal-sources/')}
    verify_freshness(read.json(FRESHNESS), documents, build, admission['runtimeBuild'])
    return {'schema': 'particle-physics-combined-admission-result/v1', 'status': 'PASS',
        'artifactHashes': pair, 'baselineRoles': 16, 'sections': section_result, 'transactions': transactions,
        'thermal': thermal, 'exports': exports, 'sourceBuild': source_build,
        'scope': 'Exact selected pair and recorded platform evidence; CPU PhysX/Blast, GPU Flow. Thermal remains default-disabled diagnostic only.'}
