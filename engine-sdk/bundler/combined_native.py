# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Portable native identity and actual source-build checks for combined admission.

All arguments are retained bytes or parsed metadata. Paths in reports remain
provenance strings; this module never opens the original source workspace.
"""
import hashlib
import json
import re
from pathlib import PurePosixPath

from .physics import SDK_VERSION, UPSTREAM_COMMIT, _section_browser, _section_cases, _section_exact
from .wood_thermal_diagnostics import SOURCES as THERMAL_SOURCES
from .flow_combined import _canonical

BINDING = 'https://github.com/fabmax/PhysX/tree/52dab13147435e818bbf10bd4230c0067e024efc'
EXPORT_FIXTURE = '8bdf1c4980cf860f032093843fc5194cd025bc0198fc13e12e0873061f298dbf'
EXPORT_CASES = {'combined-final-selected-native-export-retention',
    'combined-final-selected-abi-and-numerical-identities', 'combined-final-export-check-owner-cleanup'}
SIGNATURE_SOURCES = ('bridge/pr_bulk_rust.cpp', 'addons/blast/pr_blast_wasm.cpp',
    'addons/blast/pr_blast_authoring.cpp', 'addons/flow/pr_flow_host.cpp',
    'addons/flow/rebase_host.h', 'addons/flow/momentum_exchange_host.h',
    'addons/thermal/pr_wood_thermal.cpp', 'addons/thermal/pr_wood_thermal_multirate.cpp')
IDENTITIES = {'_pr_bulk_sdk_version': (5 << 24) + (11 << 16), '_pr_flow_boundary_convex_abi': 1,
    '_pr_flow_host_abi': 1, '_pr_flow_host_solid_abi': 1, '_pr_flow_host_scalar_abi': 1,
    '_pr_flow_host_rebase_abi': 1, '_pr_flow_host_momentum_abi': 1, '_pr_blast_stress_physical_abi': 1,
    '_pr_blast_stress_sections_abi': 1, '_pr_blast_stress_sections_v3_abi': 1,
    '_pr_blast_stress_mass_abi': 1, '_pr_blast_stress_sections_v3_preparation_abi': 1,
    '_pr_wood_thermal_abi': 1, '_pr_wood_thermal_mr_abi': 2, '_pr_wood_thermal_mr_numerics': 9}


def require(condition, message):
    if not condition:
        raise ValueError('Combined native: ' + message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def metadata(data):
    require(type(data) is bytes, 'original bytes are required')
    return {'sha256': sha(data), 'bytes': len(data)}


def hash_map(value):
    return isinstance(value, dict) and bool(value) and all(isinstance(name, str) and name
        and isinstance(digest, str) and re.fullmatch('[0-9a-f]{64}', digest) for name, digest in value.items())


def verify_build(build):
    require(build.get('status') == 'COMPILED_NOT_RUNTIME_TESTED'
        and build.get('locally_compiled') is True and build.get('source_version') == SDK_VERSION
        and build.get('expected_runtime_version') == SDK_VERSION
        and build.get('upstreamTag') == 'ovphysx-0.6.3' and build.get('upstreamCommit') == UPSTREAM_COMMIT
        and build.get('bindingOrigin') == BINDING, 'unknown native build identity')
    require(hash_map(build.get('sources')) and build.get('sourceUnchanged') is True
        and build['sources'] == build.get('sourcesBefore') == build.get('sourcesAfter')
        and build.get('installedRuntimeModified') is False, 'native source closure changed or is absent')
    require(build.get('thermalIncluded') is True and build.get('thermalAbi') == 2
        and build.get('thermalNumericalVersion') == 9 and build.get('flowBoundaryConvexAbi') == 1,
        'selected capabilities cannot be omitted or relabelled')


def verify_exports(proof, build, loader, wasm, signatures_raw, declarations, addon_abi, *, source_build=None):
    """Bind source signatures, real browser getters and O3 native assignments."""
    if source_build is not None:
        from .source_build_numerical import checked, EXPORT_FIXTURE as SDK_EXPORT_FIXTURE
        source_build = checked(source_build)
        source_build.require_build(build)
        source_build.material(proof)
        pair = source_build.pair
    else:
        verify_build(build)
        pair = {name: row['sha256'] for name, row in build['artifacts'].items()}
    require(metadata(loader) == build['artifacts']['physx-pe.mjs']
        and metadata(wasm) == build['artifacts']['physx-pe.wasm'], 'selected runtime bytes differ')
    _section_browser(proof, pair)
    require(_section_exact(proof.get('unifiedRuntime', {}).get('build'), build), 'export proof used another native build')
    if source_build is not None:
        require([value for name, value in proof['servedSourceHashes'].items()
            if name.endswith('/' + SDK_EXPORT_FIXTURE[0])] == [SDK_EXPORT_FIXTURE[1]], 'source-build export fixture differs')
    else:
        require([value for name, value in proof['servedSourceHashes'].items()
            if name.endswith('/combined_runtime_convex_exports_cases.mjs')] == [EXPORT_FIXTURE], 'export fixture differs')
    cases = _section_cases(proof, EXPORT_CASES)
    require(set(cases) == EXPORT_CASES, 'export coverage differs')
    observed = cases['combined-final-selected-native-export-retention']
    signatures = json.loads(signatures_raw)
    expected = build.get('expectedAddonExports') if source_build is None else source_build.exports
    require(isinstance(expected, list) and len(expected) == len(set(expected)) == 96
        and signatures.get('schema') == 'physx-pe.selected-addon-exports/v1'
        and signatures.get('pointerModel') == 'wasm32' and set(signatures.get('exports', {})) == set(expected)
        and (build['sources'].get('expected-addon-exports.json') if source_build is None
             else source_build.descriptor['sourceSignatures']['sha256']) == sha(signatures_raw), 'source export inventory differs')
    assignments = re.findall(r'Module\["(_pr_[^"\]]+)"\]=wasmExports\["([^"\]]+)"\]', loader.decode())
    mappings = {}
    for name in expected:
        matches = [symbol for public, symbol in assignments if public == name]
        require(len(matches) == 1, 'native assignment is absent or ambiguous: ' + name)
        mappings[name] = matches[0]
    require(len(set(mappings.values())) == 96 and observed.get('rawExports') == mappings
        and observed.get('callableAddonFunctions') == observed.get('nativeAddonSymbols') == 96
        and type(observed.get('rawFunctions')) is int and observed['rawFunctions'] >= 96
        and observed.get('wasmSha256') == pair['physx-pe.wasm'] and observed.get('loaderSha256') == pair['physx-pe.mjs']
        and observed.get('sourceSelectionSha256') == (build.get('sourceSelectionSha256') if source_build is None
            else source_build.descriptor['sourceSelectionSha256'])
        and observed.get('sharedEngineModule') is True, 'actual native export mapping differs')
    require(_section_exact(cases['combined-final-selected-abi-and-numerical-identities'], IDENTITIES)
        and _section_exact(cases['combined-final-export-check-owner-cleanup'], {'flow': 0, 'blast': 0, 'authoring': 0}),
        'actual ABI getters or ownership differ')
    require(addon_abi.get('schema') == 'physx-pe.addon-declarations/v1' and addon_abi.get('pointerModel') == 'wasm32'
        and _section_exact(addon_abi.get('exports'), signatures['exports'])
        and addon_abi.get('sources') == ({name: build['sources'].get(name) for name in SIGNATURE_SOURCES}
            if source_build is None else source_build.sources(SIGNATURE_SOURCES)),
        'SDK declaration source signatures differ from selected native inputs')
    declarations = declarations.decode()
    for name, row in signatures['exports'].items():
        text = 'function ' + name + '(' + ', '.join(row['parameters']) + '): ' + row['returnType'] + ';'
        require(declarations.count(text) == 1, 'SDK declaration missing or ambiguous: ' + name)
    return {'status': 'PASS', 'actualExports': 96, 'pointerModel': 'wasm32'}


def _file_records(rows, label, *, allow_empty_python_package=False):
    require(isinstance(rows, dict) and bool(rows), label + ' inventory is absent')
    for name, row in rows.items():
        require(isinstance(name, str) and name and isinstance(row, dict)
            and type(row.get('bytes')) is int and (row['bytes'] > 0 or (
                allow_empty_python_package and row['bytes'] == 0
                and _canonical(name).endswith('/__init__.py') and row.get('sha256') == sha(b'')))
            and hash_map({name: row.get('sha256')}), label + ' file record is malformed')


def verify_compiler_snapshots(outer, lock):
    """Validate the real Windows-parent snapshot schema, including LX aliases."""
    for before, after in (('referenceInputsBefore', 'referenceInputsAfter'), ('compilerInputsBefore', 'compilerInputsAfter'),
                         ('nativeCompilerAliases', 'nativeCompilerAliasesAfter'), ('rustCompilerInputsBefore', 'rustCompilerInputsAfter')):
        require(isinstance(outer.get(before), dict) and bool(outer[before]) and _section_exact(outer[before], outer.get(after)),
            'source-build input/tool snapshot changed: ' + before)
    _file_records(outer['referenceInputsBefore'], 'reference')
    _file_records(outer['compilerInputsBefore'], 'compiler', allow_empty_python_package=True)
    compilers = {}
    for name, row in outer['compilerInputsBefore'].items():
        name = _canonical(name)
        require(name not in compilers, 'duplicate physical compiler alias')
        compilers[name] = row
    aliases = outer['nativeCompilerAliases']
    require(set(aliases) == {'clang++', 'wasm-ld'}, 'native executable alias inventory differs')
    for name, row in aliases.items():
        _file_records({name: row.get('actualBinary')}, 'native compiler executable')
        require(type(row.get('exitCode')) is int and row['exitCode'] == 0
            and row.get('stdout', '').strip() == row.get('target') and not row.get('stderr')
            and _section_exact(compilers.get(_canonical(row['target'])), row.get('actualBinary'))
            and isinstance(row.get('invocation'), list) and row['invocation'][0] == 'wsl.exe',
            'native compiler target was not captured: ' + name)
    rust = outer['rustCompilerInputsBefore']
    require(rust.get('schema') == 'physx-pe.existing-rust-toolchain/v1'
        and rust.get('status') == 'PINNED_COMPILER_AND_INSTALLED_TARGET_ADMITTED'
        and rust.get('release') == lock.get('rust') == '1.90.0'
        and rust.get('host') == 'x86_64-unknown-linux-gnu' and rust.get('target') == 'wasm32-unknown-emscripten'
        and rust.get('installersInvoked') is False and rust.get('nativeCodeCompiled') is False
        and type(rust.get('exitCode')) is int and rust['exitCode'] == 0,
        'actual Rust compiler/installed target was not admitted')
    _file_records(rust.get('files'), 'Rust compiler')
    root = _canonical(rust['sysroot']) + '/'
    require(all(_canonical(row.get('resolvedPath')).startswith(root) for row in rust['files'].values())
        and 'bin/rustc' in rust['files'] and any(name.startswith('lib/rustlib/wasm32-unknown-emscripten/lib/libcore-')
        for name in rust['files']), 'Rust compiler snapshot omits its actual target')
    shared = outer.get('sharedPerformanceLock', {})
    require(shared.get('sha256') == '68518bb32b68e724030b66440ea4d9b2b23f56cf10a01606cdbf0a7f620788c7'
        and shared.get('environmentOverridden') is False and outer.get('compilerRecipeHost') == 'Ubuntu-24.04',
        'actual build did not retain the existing shared Windows lock contract')


def verify_source_build(outer, inner_raw, sdk_build, selection_raw, prepared_raw, build, files):
    """Require the actual fresh build protocol; a different pair never inherits tests."""
    inner = json.loads(inner_raw)
    require(outer.get('schema') == 'physx-pe.source-kit-windows-phase/v1'
        and outer.get('phase') == 'full-build' and outer.get('status') == 'FULL_SOURCE_COMPILED_NOT_RUNTIME_VERIFIED'
        and outer.get('authoritativeValidationHost') == 'native-windows-python'
        and outer.get('runtimeExecuted') is False and outer.get('gpuExecuted') is False
        and outer.get('releaseAdmitted') is False and outer.get('error') is None,
        'actual full source build did not pass its original bounded protocol')
    require(inner.get('schema') == 'physx-pe.release-build/v1' and inner.get('status') == 'COMPILED_NOT_RUNTIME_VERIFIED'
        and _section_exact(outer.get('fullSourceBuild'), inner)
        and _section_exact(inner.get('artifacts'), sdk_build.get('artifacts')), 'source-build manifest artifacts differ')
    actual_artifacts = inner.get('artifacts', {})
    require({'physx-pe.mjs', 'physx-pe.wasm'} <= actual_artifacts.keys()
        and all(_section_exact(actual_artifacts[name], build['artifacts'][name])
                for name in ('physx-pe.mjs', 'physx-pe.wasm')), 'source-build pair differs from runtime proofs')
    require(set(actual_artifacts) <= {'physx-pe.mjs', 'physx-pe.wasm', 'physx-pe.d.ts', 'physx-pe.d.mts'}
        and all(name in files and _section_exact(metadata(files[name]), row) for name, row in actual_artifacts.items()),
        'source-build artifact bytes are missing or unbound')
    source = outer.get('sourceHashesBefore')
    require(hash_map(source) and source == outer.get('sourceHashesAfter') == inner.get('sourceHashes') == inner.get('sourceHashesAfter'),
        'source build does not have stable original inputs')
    revision = outer.get('sourceRevisionBefore', {})
    require(set(revision) == {'commit', 'tree', 'inventorySha256'}
        and all(isinstance(revision[key], str) and re.fullmatch('[0-9a-f]{40}', revision[key]) for key in ('commit', 'tree'))
        and revision['inventorySha256'] == sha(json.dumps(source, sort_keys=True, separators=(',', ':')).encode())
        and _section_exact(inner.get('sourceRevision'), revision), 'source revision is not bound to the full compiled inventory')
    lock = json.loads(files['evidence/source-build-lock.json'])
    require(source.get('upstream.lock.json') == sha(files['evidence/source-build-lock.json'])
        and lock.get('candidate_sdk') == SDK_VERSION and lock.get('upstream_commit') == UPSTREAM_COMMIT
        and lock.get('emscripten') == '4.0.19' and lock.get('flow_slang_version') == '2025.6.1',
        'source-build toolchain/IDL lock is not a compiled input')
    verify_compiler_snapshots(outer, lock)
    steps = outer.get('steps')
    require(isinstance(steps, list) and len(steps) == 1 and steps[0].get('status') == 'PASS'
        and type(steps[0].get('exitCode')) is int and steps[0]['exitCode'] == 0
        and isinstance(steps[0].get('argv'), list) and steps[0]['argv'][:5] == ['wsl.exe', '-d', 'Ubuntu-24.04', '--', 'bash']
        and len(steps[0]['argv']) == 7 and steps[0]['argv'][5] == '-c'
        and 'exec /usr/bin/python3 release.py build --slangc ' in steps[0]['argv'][6],
        'actual full compile command did not complete')
    selection = json.loads(selection_raw)
    require(source.get('source-selection.json') == sha(selection_raw)
        and selection.get('schema') == 'physx-pe.source-selection/v2'
        and selection.get('finalSelectionStatus') == 'FINAL_SOURCES_SELECTED_FOR_BUILD'
        and selection.get('pendingNativeInputs') == [] and selection.get('upstreamCommit') == UPSTREAM_COMMIT,
        'source-build selection is incomplete or stale')
    selected = selection.get('prospectiveNativeSelection', {})
    require(selected.get('schema') == 'physx-pe.full-native-selection/v1'
        and hash_map(selected.get('sourceHashes')) and len(selected['sourceHashes']) == 215
        and all(source.get(name) == digest for name, digest in selected['sourceHashes'].items())
        and _section_exact([selected.get(name) for name in ('blastTranslationUnits', 'thermalAbi', 'thermalNumerics',
            'massAbi', 'preparationAbi', 'convexAbi', 'signatureCount')], [27, 2, 9, 1, 1, 1, 96])
        and selected.get('cachedObjectsAdmitted') is False and selected.get('alphaExecutionDependenciesAdmitted') is False,
        'source-build native source selection differs')
    verify_compiled_components(sdk_build, selected, files, build, outer['sourceRoot'])
    for group, prefix in (('flow', 'addons/flow/'), ('blast', 'addons/blast/'), ('woodThermal', 'addons/thermal/')):
        component = selection.get('selectedComponents', {}).get(group, {})
        values = component.get('nativeSourceHashes')
        require(hash_map(values) and all(name.startswith(prefix) and build['sources'].get(name) == digest == source.get(name)
            for name, digest in values.items()), 'source-built component inputs differ: ' + group)
        original = build['flowComponent'] if group == 'flow' else build['selectedComponents']['blast' if group == 'blast' else 'thermal']
        require(component.get('manifestSha256') == original.get('manifestSha256')
            and _section_exact(outer['referenceInputsBefore'].get(component.get('manifestPath')),
                {'sha256': component.get('manifestSha256'), 'bytes': component.get('manifestBytes')}),
            'source build selected a different frozen component: ' + group)
    require(inner.get('upstreamCommit') == UPSTREAM_COMMIT and inner.get('preparedSourceReceiptSha256') == sha(prepared_raw),
        'prepared-source receipt is not the executed build input')
    verify_source_corpora(inner, files)
    for name in ('physx-pe.d.ts', 'physx-pe.d.mts', 'addon-abi.json'):
        destination = name if name != 'addon-abi.json' else 'evidence/addon-abi.json'
        require(source.get('types/' + name) == sha(files[destination]), 'source-built declaration bytes differ: ' + name)
    return {'status': 'PASS', 'sourceRevision': revision, 'scope': 'Fresh compilation identity only; runtime gates remain independent.'}


def verify_source_corpora(inner, files):
    inventory = inner.get('flowShaderInventory', {})
    names = {key.removeprefix('flow-wgsl/') for key in files if key.startswith('flow-wgsl/')}
    require(isinstance(inventory, dict) and len(inventory) == 252 and set(inventory) == names,
        'source-built shader inventory differs')
    manifests = {'manifest.json': 'original', **{'addons/' + kind + '/manifest.json': kind for kind in ('solid', 'scalar', 'momentum')}}
    for name, row in inventory.items():
        source = ('evidence/source-build-corpora/' + manifests[name] + '.json') if name in manifests else 'flow-wgsl/' + name
        require(source in files and _section_exact(metadata(files[source]), row), 'source-built shader bytes differ: ' + name)
    require(inner.get('flowManifestSha256') == sha(files['evidence/source-build-corpora/original.json']),
        'source-build primary corpus hash differs')
    for path, kind in manifests.items():
        original = json.loads(files['flow-wgsl/' + path])
        fresh = json.loads(files['evidence/source-build-corpora/' + kind + '.json'])
        old_rows, new_rows = original.get('shaders', []), fresh.get('shaders', [])
        fields = ('source', 'sourceSha256', 'wgsl', 'wgslSha256', 'reflection', 'reflectionSha256')
        require(isinstance(old_rows, list) and isinstance(new_rows, list) and len(old_rows) == len(new_rows)
            and [{key: row.get(key) for key in fields} for row in old_rows] == [{key: row.get(key) for key in fields} for row in new_rows],
            'fresh shader source/payload mapping differs from executed corpus: ' + kind)
        if kind == 'original':
            require(fresh.get('status') == 'FLOW_WGSL_CORPUS_COMPILED' and fresh.get('shaderCount') == 97
                and fresh.get('failed') == 0 and fresh.get('inputHashes') == original.get('inputHashes')
                and all(row.get('status') == 'PASS' for row in new_rows), 'fresh original shader compilation failed')
        else:
            require(type(fresh.get('abi')) is int and fresh['abi'] == 1, 'fresh extension shader ABI differs')


def _argv(values):
    """Normalize only recorded Windows/WSL path spelling, never compiler flags."""
    require(isinstance(values, list) and all(isinstance(v, str) for v in values), 'malformed recorded argv')
    result = []
    for value in values:
        if value.startswith('-I/') or re.match(r'^-I[A-Za-z]:[/\\]', value):
            result.append('-I' + _canonical(value[2:]))
        elif value.startswith('/') or re.match(r'^[A-Za-z]:[/\\]', value):
            result.append(_canonical(value))
        else:
            result.append(value)
    return result


def _blast_path(value, origin, destination):
    prefix = _canonical(origin) + '/'
    value = _canonical(value)
    require(value.startswith(prefix), 'original Blast path left its selected source root')
    suffix = value[len(prefix):]
    for old, new in (('upstream/blast/', 'work/candidate/PhysX/blast/'),
                     ('work/authoring-generated/', 'work/blast-authoring-generated/')):
        if suffix == old.rstrip('/'):
            return destination + '/' + new.rstrip('/')
        if suffix.startswith(old):
            return destination + '/' + new + suffix[len(old):]
    if suffix.startswith('work/physical-generated/'):
        parts = suffix[len('work/physical-generated/'):].split('/')
        return destination + '/work/blast-stress-generated' + ('/' + '/'.join(parts[1:]) if len(parts) > 1 else '')
    require(suffix == 'addons/blast' or suffix.startswith('addons/blast/'), 'unknown selected Blast input relocation')
    return destination + '/' + suffix


def verify_blast_recipe(proof, original, build, source_root):
    """Read-only command/relocation consistency check; no compilation occurs."""
    root = _canonical(source_root)
    flags = [(_blast_path(value, original['sourceRoot'], root) if value.startswith('/')
        or re.match(r'^[A-Za-z]:[/\\]', value) else value) for value in original['compileFlags']]
    require(_argv(proof.get('blastCompileFlags')) == flags, 'fresh Blast flags/include order differ from selected recipe')
    generated = {_blast_path(_canonical(original['sourceRoot']) + '/' + name, original['sourceRoot'], root)[len(root) + 1:]: digest
        for name, digest in original['sources'].items() if name.startswith('work/') and name.endswith(('.cpp', '.h'))}
    require(_section_exact(proof.get('generated'), {'generated': generated, 'physicalTolerance': 1e-6, 'massAbi': 1, 'preparationAbi': 1}),
        'fresh generated Blast source pins differ')
    rows = proof.get('blastCompileCommands', [])
    require(isinstance(rows, list) and len(rows) == 27 and len({row.get('source') for row in rows}) == 27
        and len({row.get('object') for row in rows}) == 27, 'fresh Blast compile coverage differs')
    ordered_names = [re.sub(r'-[0-9a-f]{64}\.o$', '.cpp', PurePosixPath(name).name) for name in original['objects']]
    require([PurePosixPath(row['source']).name for row in rows] == ordered_names,
        'fresh Blast translation-unit order differs')
    for index, row in enumerate(rows):
        argv = row.get('argv', [])
        original_sources = [name for name in original['sources'] if name.endswith('/' + ordered_names[index])]
        generated_sources = [name for name in original_sources if name.startswith('work/')]
        chosen = generated_sources or original_sources
        require(len(chosen) == 1, 'selected Blast translation unit is ambiguous')
        source = _blast_path(_canonical(original['sourceRoot']) + '/' + chosen[0], original['sourceRoot'], root)
        obj = row['object']
        require(re.fullmatch(r'work/selected-native-objects/[0-9a-f]{32}/' + f'{index:02d}-' + re.escape(PurePosixPath(source).stem) + r'\.o', obj)
            and _canonical(row['source']) == source and _argv(argv) == ['em++', source, *flags, '-c', '-o', root + '/' + obj],
            'fresh Blast command/source/object layout differs')
        require(type(row.get('exitCode')) is int and row['exitCode'] == 0
            and hash_map({'object': row.get('sha256')}) and isinstance(argv, list)
            and argv[:2] == ['em++', row['source']] and argv.count('-c') == argv.count('-o') == 1
            and {'-O3', '-msimd128', '-std=c++17'} <= set(argv), 'a selected Blast TU was not freshly compiled')
    partial, thermal = proof.get('blastPartialLink', {}), proof.get('thermalCompile', {})
    for name, row in (('Blast partial link', partial), ('thermal compile', thermal)):
        require(type(row.get('exitCode')) is int and row['exitCode'] == 0
            and isinstance(row.get('argv'), list) and row['argv'][0] == 'em++', name + ' did not complete')
    require('-r' in partial['argv'] and len([arg for arg in partial['argv'] if arg.endswith('.o')]) == 28,
        'partial link omitted a selected object')
    require(_argv(partial['argv']) == ['em++', *(root + '/' + row['object'] for row in rows), '-r', '-o', root + '/work/pr_blast.o'],
        'partial link object order differs')
    thermal_flags = build['thermalCompileCommand'][2:build['thermalCompileCommand'].index('-c')]
    require(_argv(thermal['argv']) == ['em++', root + '/addons/thermal/pr_wood_thermal_multirate.cpp', *thermal_flags,
        '-c', '-o', root + '/work/pr_wood_thermal_multirate.o'],
        'source-built thermal or final-link numerical recipe differs')


def verify_flow_recipe(flow, source_root):
    """Check exact fresh Flow compilation and partial-link order, without executing it."""
    root = _canonical(source_root)
    rows = flow.get('compilations', [])
    require(isinstance(rows, list) and len(rows) == 24 and len({row.get('source') for row in rows}) == 24
        and len({row.get('object') for row in rows}) == 24
        and flow.get('commands', [])[:24] == [row.get('command') for row in rows], 'fresh Flow compile coverage differs')
    includes = [root + '/source-inputs/flow/' + name for name in ('include/nvflow', 'include/nvflowext', 'shared',
        'external', 'include/nvflow/shaders', 'include/nvflowext/shaders')] + [root + '/work/flow-host-headers', root + '/addons/flow']
    flags = [*('-I' + name for name in includes), '-std=c++17', '-O2', '-msimd128', '-fno-rtti', '-fno-exceptions', '-Wno-null-conversion']
    require(_argv(flow.get('flags')) == flags, 'Flow source-build compile flags differ')
    sources = ['addons/flow/pr_flow_host.cpp']
    for directory in ('source-inputs/flow/source/nvflow', 'source-inputs/flow/source/nvflowext'):
        sources += sorted(name for name in flow['sourceHashes'] if str(PurePosixPath(name).parent) == directory
            and name.endswith('.cpp') and PurePosixPath(name).name not in ('GridOpt.cpp', 'ThreadPool.cpp'))
    wrappers = {'Sparse.cpp', 'Summary.cpp', 'Grid.cpp', 'EmitterSphere.cpp', 'EmitterBox.cpp', 'EmitterMesh.cpp'}
    sources = [('work/flow-rebase-sources/' + PurePosixPath(name).name if PurePosixPath(name).name in wrappers else name) for name in sources]
    require([row.get('source') for row in rows] == sources, 'Flow source-build order or inclusion wrappers differ')
    for row in rows:
        argv = row['command']
        obj = root + '/work/flow-host-objects/' + PurePosixPath(row['source']).stem + '.o'
        require(_canonical(row['object']) == obj and _argv(argv) == ['em++', root + '/' + row['source'], *flags, '-c', '-o', obj],
            'Flow translation unit command differs')
    objects = [root + '/work/flow-host-objects/' + PurePosixPath(row['source']).stem + '.o' for row in rows]
    suffix = ['-O2', '-msimd128', '-sALLOW_MEMORY_GROWTH=1', '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sENVIRONMENT=web',
        '-sEXPORTED_FUNCTIONS=_malloc,_free', '-sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU32,HEAPF32', '-o', root + '/dist/flow-host/flow-host.mjs']
    require([_argv(command) for command in flow['commands'][24:]] == [['em++', *objects, *suffix],
        ['em++', *objects, '-r', '-o', root + '/work/pr_flow_host.o']], 'Flow host/partial link object order differs')


def verify_compiled_components(sdk, selection, files, build, source_root):
    """Bind original fresh-compile receipts, not caller-authored summary counts."""
    raw = files['evidence/source-build-native.json']
    proof = json.loads(raw)
    require(sdk.get('selected_native_source_build_manifest_sha256') == sha(raw)
        and _section_exact(sdk.get('selected_native_source_build'), proof)
        and proof.get('schema') == 'physx-pe.fresh-selected-native-build/v1'
        and proof.get('status') == 'COMPILED_NOT_RUNTIME_VERIFIED'
        and proof.get('allTranslationUnitsRecompiled') is True and proof.get('archivedObjectsUsed') is False
        and proof.get('sources') == proof.get('sourcesAfter') == selection['sourceHashes']
        and proof.get('compiler') == build['compiler'], 'fresh selected native compilation is absent or differs')
    selected_raw = files['evidence/source-build-selected-blast.json']
    original = json.loads(selected_raw)
    require(sha(selected_raw) == build['selectedComponents']['blast']['manifestSha256'],
        'original selected Blast recipe differs')
    verify_blast_recipe(proof, original, build, source_root)
    require(sdk.get('final_link_strict_flags') == ['-O3', '-fno-fast-math', '-fno-associative-math', '-ffp-contract=off', '-msimd128'],
        'source-build final link numerical flags differ')
    require(_section_exact([sdk.get(key) for key in ('blast_physical_stress_abi', 'blast_sections_v3_abi',
        'blast_sections_v3_preparation_abi', 'blast_stress_mass_abi', 'wood_thermal_mr_abi', 'wood_thermal_numerics',
        'flow_convex_query_abi')], [1, 1, 1, 1, 2, 9, 1]), 'fresh SDK capability identities differ')
    raw = files['evidence/source-build-flow.json']
    flow = json.loads(raw)
    require(sdk.get('flow_source_build_manifest_sha256') == sha(raw) and flow.get('schema') == 'flow-host-build-v1'
        and flow.get('allTranslationUnitsRecompiled') is True and sdk.get('flow_all_translation_units_recompiled') is True
        and hash_map(flow.get('sourceHashes')) and flow['sourceHashes'] == flow.get('sourceHashesAfter')
        and flow.get('generatedHostHeaderCount') == 124 and flow.get('generatedIncludeWrapperCount') == 6
        and flow.get('compiler') == build['compiler'], 'fresh Flow compilation differs')
    verify_flow_recipe(flow, source_root)
    require(_section_exact(flow.get('shaderInventory'), sdk.get('flow_shader_inventory')),
        'fresh Flow shader inventory differs from final SDK')


def verify_thermal_license(transform_raw, build, source_bytes):
    transform = json.loads(transform_raw)
    require(sha(transform_raw) == build.get('thermalLicenseTransform')
        and transform.get('schema') == 'physx-pe.owner-thermal-license-transform/v1'
        and transform.get('onlyLicenseIdentifierChanged') is True and transform.get('freshCompilationRequired') is True
        and transform.get('originalArtifactsSelected') is False and set(transform.get('files', {})) == THERMAL_SOURCES,
        'owner thermal notice transform differs')
    for name, row in transform['files'].items():
        original, chosen = source_bytes[row['originalPath']], source_bytes[name]
        require(metadata(original) == {'sha256': row['originalSha256'], 'bytes': row['originalBytes']}
            and metadata(chosen) == {'sha256': row['selectedSha256'], 'bytes': row['selectedBytes']}
            and build['sources'].get(name) == sha(chosen)
            and original.replace(b'SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha', b'SPDX-License-Identifier: MIT') == chosen,
            'thermal source changed beyond the explicit owner SPDX transform: ' + name)
        lines = [index + 1 for index, line in enumerate(original.splitlines())
            if b'SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha' in line]
        require(lines == row.get('licenseLines') and bool(lines)
            and chosen.replace(b'SPDX-License-Identifier: MIT', b'SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha') == original,
            'thermal license occurrence/reverse-substitution proof differs: ' + name)
