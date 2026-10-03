# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""PROPOSED portable source-build context; not wired into a production gate.

Inputs are inventoried retained bytes. Recorded absolute paths are lookup keys
only. No producer file, SDK helper, compiler, Git command or browser is opened
or executed here. This context supplements, never replaces, whole-runtime gates.
"""
import ast
import base64
from collections.abc import Mapping
import copy
from dataclasses import dataclass
from datetime import datetime
import json
import math
import re
import shlex
from types import MappingProxyType

from bundler.combined_native import (IDENTITIES, SIGNATURE_SOURCES, SDK_VERSION,
    UPSTREAM_COMMIT, _argv, hash_map, metadata, require, sha, verify_blast_recipe,
    verify_compiler_snapshots, verify_flow_recipe)
from bundler.combined_runtime import relative
from bundler.flow_combined import _canonical
from bundler.physics import _section_exact

from bundler.source_build_clean_evidence import (verify_config_bindings, verify_clean_binding,
    verify_static_audit04, DESCRIPTOR_SCHEMA)

ROLES = frozenset(('executionDescriptor', 'parent', 'child', 'sdkManifest',
    'staticAudit', 'sdkVerification', 'sdkFunctionalObservation', 'producerConfiguration', 'cleanBuildObservation'))
STRICT = ['-O3', '-fno-fast-math', '-fno-associative-math', '-ffp-contract=off', '-msimd128']
ARCHIVES = ('PhysX', 'PhysXCharacterKinematic', 'PhysXCommon', 'PhysXCooking',
    'PhysXExtensions', 'PhysXFoundation', 'PhysXVehicle', 'PhysXPvdSDK')
PHASES = (
    ('Rust units, Python FFI and C ABI layout', 'NON_PHYSICS_TESTS_PASSED'),
    ('Native C++/Rust ABI', 'ABI_PASSED_NOT_PHYSICS'),
    ('Browser C++/Rust ABI compile', 'COMPILED_NOT_RUNTIME_TESTED'),
    ('Browser C++/Rust ABI', 'ABI_PASSED_NOT_PHYSICS'),
    ('TypeScript addon and SDK consumer semantics', 'TYPESCRIPT_DECLARATIONS_PASSED'),
    ('PhysX behavioral browser regressions', 'SMOKE_PASSED_NOT_RELEASE_CERTIFIED'),
    ('Bounded native CPU endurance and identical-input replay', 'CPU_BROWSER_AND_BOUNDED_ENDURANCE_PASSED'),
    ('Blast split and unified WASM/WebGPU transfer', 'UNIFIED_PHYSX_BLAST_FLOW_BROWSER_PASSED'),
    ('Complete 124 Flow WGSL modules and executed advection/mesh scan', 'FLOW_WGSL_MODULES_PASSED'),
    ('Native Flow graph and WebGPU ownership', 'PASS'))


PHASE1_PYTHON = '/mnt/c/Users/btspa/Downloads/particle-realms-physx-local-pc/PhysX-Local-PC/particle-realms-physx-rust-python/work/local-pc/venv/bin/python'
PHASE1_PYTHON_PROBE_SHA256 = '11f8ff37e299c1b52d9c00d9f81c61b696e7775cfe2815e4a3494102089feb65'
PHASE1_PYTHON_IDENTITY_SHA256 = '0c4577d949c78518e8b4397f98fa141cd574c541708f78a9a5e2e28495ebc73a'


def canonical(path):
    require(isinstance(path, str) and path and '\x00' not in path, 'missing retained original path')
    value = _canonical(path)
    require(re.match(r'^[A-Za-z]:/', value) is not None or value.startswith('/'),
        'retained original path is not absolute provenance')
    return value


def physical_key(path):
    value = canonical(path)
    # Windows/WSL spellings refer to the same case-insensitive Windows volume.
    return value.casefold() if re.match(r'^[A-Za-z]:/', value) else value


def interval(value, start='startedUtc', end='finishedUtc'):
    first, last = (datetime.fromisoformat(value[key]) for key in (start, end))
    require(first.tzinfo is not None and last.tzinfo is not None and last >= first,
        'original execution interval is absent or invalid')
    return first, last


def joined(root, name):
    # Windows-style relative paths occur in the genuine mixed-host witness.
    require(isinstance(name, str), 'missing original relative path')
    return canonical(root) + '/' + relative(name.replace('\\', '/'))


class Retained:
    """Never resolve/open original paths; one physical key maps to staged bytes."""
    def __init__(self, files, index):
        require(index.get('schema') == 'physx-pe.retained-configured-source-build-inputs/v1'
            and set(index) == {'schema', 'roles', 'inputs'} and set(index['roles']) == ROLES,
            'unknown or incomplete source-build retained index')
        require(isinstance(files, dict) and isinstance(index.get('inputs'), dict), 'invalid retained byte inventory')
        require(all(type(body) is bytes for body in files.values()),
            'retained payloads must be immutable bytes, including unindexed members')
        self.files, self.index, self.inputs = MappingProxyType(dict(files)), copy.deepcopy(index), {}
        members = set()
        for path, row in self.index['inputs'].items():
            key = physical_key(path)
            require(key not in self.inputs and set(row) == {'member', 'sha256', 'bytes'},
                'duplicate physical source alias or malformed retained entry')
            require(type(row.get('bytes')) is int and row['bytes'] >= 0
                and hash_map({'input': row.get('sha256')}), 'untyped retained input metadata')
            member = relative(row['member'])
            require(member not in members, 'one retained member aliases multiple original inputs')
            members.add(member)
            require(member in files and metadata(files[member]) == {k: row[k] for k in ('sha256', 'bytes')},
                'retained source bytes changed: ' + key)
            self.inputs[key] = row
        require(bool(self.inputs), 'empty retained source closure')

    def source(self, path, expected=None):
        key = physical_key(path)
        require(key in self.inputs, 'required raw/source input was not retained: ' + key)
        body = self.files[self.inputs[key]['member']]
        if expected is not None:
            require(sha(body) == expected if isinstance(expected, str) else _section_exact(metadata(body), expected),
                'original source/reference hash mismatch: ' + key)
        return body

    def document(self, path, expected=None):
        def unique(pairs):
            value = {}
            for key, item in pairs:
                require(key not in value, 'duplicate original JSON field: ' + key)
                value[key] = item
            return value
        def finite(value):
            raise ValueError('Nonfinite original JSON token: ' + value)
        return json.loads(self.source(path, expected), object_pairs_hook=unique, parse_constant=finite)

    def role(self, name):
        row = self.index['roles'][name]
        require(set(row) == {'path', 'sha256', 'bytes'} and type(row.get('bytes')) is int and row['bytes'] > 0
            and hash_map({'role': row.get('sha256')}), 'malformed producer role reference')
        return self.document(row['path'], {k: row[k] for k in ('sha256', 'bytes')})

    def relative(self, root, rows):
        require(isinstance(rows, dict) and rows, 'missing original relative source closure')
        return {name: self.source(joined(root, name), expected) for name, expected in rows.items()}


@dataclass(frozen=True)
class NumericalFacts:
    """Declared and source-bound facts; actual getter proof is still mandatory."""
    stress_revisions: tuple = (1, 2, 3)
    sections_abi: int = 1
    preparation_abi: int = 1
    mass_abi: int = 1
    relative_solver_tolerance: float = 1e-6
    wood_thermal_abi: int = 2
    wood_thermal_numerics: int = 9
    thermal_scope: str = 'DIAGNOSTIC_ONLY'
    thermal_default_enabled: bool = False
    original_flow_modules: int = 97
    original_selected_pipelines: int = 96
    total_flow_modules: int = 124
    total_selected_pipelines: int = 123
    excluded_pipeline: str = 'source/nvflowext/shaders/EmitterNanoVdbCS.wgsl'


@dataclass(frozen=True)
class CheckedSourceBuild:
    """Raw immutable records and explicit facts, never a legacy build dictionary."""
    original_records: Mapping[str, bytes]
    source_hashes: Mapping[str, str]
    runtime_artifacts: Mapping[str, bytes]
    shader_inventory: Mapping[str, bytes]
    numerical_facts: NumericalFacts

    def __post_init__(self):
        for name in ('original_records', 'runtime_artifacts', 'shader_inventory'):
            values = getattr(self, name)
            require(isinstance(values, Mapping) and all(isinstance(key, str) and type(body) is bytes
                for key, body in values.items()), 'checked context payloads must be immutable bytes: ' + name)
            object.__setattr__(self, name, MappingProxyType(dict(values)))
        require(isinstance(self.source_hashes, Mapping) and hash_map(dict(self.source_hashes))
            and type(self.numerical_facts) is NumericalFacts, 'checked context source/fact types differ')
        object.__setattr__(self, 'source_hashes', MappingProxyType(dict(self.source_hashes)))

    def raw_json(self, role):
        return json.loads(self.original_records[role])


def verify_direct_link(rule, link, root):
    require(link.get('linkMode') == 'direct-nine-archive-link' and link.get('mriMergeClaimed') is False
        and isinstance(link.get('evidenceKind'), str) and re.fullmatch(r'Actual generated rule retained after completed CMake build[0-9]+', link['evidenceKind']),
        'unknown actual direct-link provenance')
    lines = [line.strip() for line in rule.decode().splitlines() if '&& em++ glue.o' in line]
    require(len(lines) == 1, 'missing or ambiguous actual CMake direct link')
    directory, command = lines[0].split(' && ', 1)
    require(directory.startswith('cd ') and shlex.split(directory[3:]) == [link['workingDirectory']],
        'direct-link working directory differs')
    argv = shlex.split(command)
    require(argv == link.get('argv') and sha(rule) == link.get('rawSha256'), 'direct-link command bytes differ')
    root = canonical(root)
    cwd = root + '/work/candidate/PhysX/physx/compiler/emscripten-release/sdk_source_bin'
    archives = [root + '/work/rust-candidate/libpr_pose_core.a'] + [root
        + '/work/candidate/PhysX/physx/bin/UNKNOWN/release/lib' + name + '_static.a' for name in ARCHIVES]
    expected = ['em++', 'glue.o', 'pr_bulk_rust.o', root + '/work/pr_blast.o', root + '/work/pr_flow_host.o',
        root + '/work/pr_wood_thermal_multirate.o', '-lc', '-lcompiler_rt', *archives,
        '--post-js', 'glue.js', '--post-js', root + '/work/candidate/PhysX/physx/source/webidlbindings/src/wasm/onload.js',
        '-sMODULARIZE=1', '-sEXPORT_ES6=1', '-sEXPORT_NAME=PhysX', '-sENVIRONMENT=web,worker',
        '-sDYNAMIC_EXECUTION=0', '-sNO_FILESYSTEM=1', '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=67108864',
        '-sMAXIMUM_MEMORY=2147483648', '-sABORTING_MALLOC=0',
        "-sEXPORTED_RUNTIME_METHODS=['HEAPU8','HEAPU16','HEAPU32','HEAPF32','HEAPF64','stackSave','stackRestore','stackAlloc']",
        '-fno-rtti', '-fno-exceptions', '-sEXPORTED_FUNCTIONS=_malloc,_free', *STRICT, '-o', 'physx-pe.mjs']
    require(canonical(link['workingDirectory']) == cwd and _argv(argv) == expected
        and link.get('archiveCount') == 9, 'direct five-object/nine-archive/strict-flag order differs')
    objects = [value for value in argv if value.endswith(('.o', '.a'))]
    require(len(objects) == len(set(objects)) == 14 and set(link.get('inputs', {})) == set(objects),
        'direct-link object/archive inventory differs')
    return argv, cwd


def verify_descriptor(read, descriptor, outer, sdk, *, read_witnesses=None):
    require(descriptor.get('schema') == DESCRIPTOR_SCHEMA
        and descriptor.get('status') == 'COMPILED_SOURCE_OBSERVED_NOT_RUNTIME_VERIFIED'
        and descriptor.get('sourceUnchanged') is True
        and descriptor.get('physicalInputs') == descriptor.get('physicalInputsAfter'), 'compile observation changed or relabelled')
    require(all(descriptor.get(name) is False for name in ('runtimeExecuted', 'gpuExecuted', 'installed', 'releaseAdmitted')),
        'compile observation overclaims runtime scope')
    require(descriptor.get('sourceRevision') == outer['sourceRevisionBefore']
        and descriptor.get('artifacts') == sdk['artifacts'], 'observation belongs to another pair/revision')
    require(canonical(descriptor.get('sourceRoot')) == canonical(outer['sourceRoot'])
        and descriptor.get('expectedGetterIdentities') == IDENTITIES, 'observation source/getter identity differs')
    require(datetime.fromisoformat(descriptor['observedUtc']).tzinfo is not None,
        'compile observation lacks its actual timestamp')
    for role in ('parent', 'child', 'sdkManifest', 'staticAudit'):
        require(descriptor.get('producerReceipts', {}).get(role) == read.index['roles'][role]
            and descriptor.get('producerStatuses', {}).get(role) == read.role(role).get('status'),
            'original producer reference/status was relabelled')
    flattened = {}
    for group, aliases in descriptor.get('inputGroups', {}).items():
        require(isinstance(aliases, dict) and aliases, 'empty original alias group: ' + group)
        for alias, row in aliases.items():
            require(isinstance(alias, str) and set(row) == {'path', 'sha256', 'bytes'}, 'invalid original alias record')
            key = canonical(row['path'])
            expected = {k: row[k] for k in ('sha256', 'bytes')}
            require(key not in flattened or flattened[key] == expected, 'conflicting original source aliases')
            read.source(key, expected)
            flattened[key] = expected
    require(flattened == descriptor['physicalInputs'], 'descriptor omitted or added a physical alias input')
    committed = descriptor.get('inputGroups', {}).get('committedSources', {})
    require(set(committed) == set(outer['sourceHashesBefore']) and all(
        canonical(committed[name]['path']) == joined(outer['sourceRoot'], name)
        and committed[name]['sha256'] == digest for name, digest in outer['sourceHashesBefore'].items()),
        'observation source inventory is incomplete')
    identity = descriptor.get('currentSdkIdentity')
    require(isinstance(identity, dict) and identity == descriptor.get('currentSdkIdentityAfter')
        and identity.get('schema') == 'physx-pe.current-sdk-source-read/v1'
        and canonical(identity.get('sourceRoot')) == canonical(outer['sourceRoot'])
        and identity.get('sourceHashes') == identity.get('sourceHashesAfter') == outer['sourceHashesBefore']
        and identity.get('sourceRevision') == outer['sourceRevisionBefore']
        and identity.get('nativeCompilerAliases') == outer['nativeCompilerAliases']
        and all(identity.get(name) is False for name in ('sdkOutputsWritten', 'nativeCompiled', 'runtimeExecuted', 'gpuExecuted')),
        'actual source/Git/compiler read differs')
    refs = descriptor.get('readWitnesses', []) if read_witnesses is None else read_witnesses
    require(len(refs) == 2 and refs[0]['path'] != refs[1]['path'], 'missing independent pre/post source reads')
    for row in refs:
        witness = read.document(row['path'], {k: row[k] for k in ('sha256', 'bytes')})
        require(witness.get('schema') == 'physx-pe.sdk-source-read-execution/v1'
            and witness.get('status') == 'PASS' and type(witness.get('exitCode')) is int and witness['exitCode'] == 0
            and witness.get('stderr') == '', 'original current-source reader failed')
        child = json.loads(witness['stdout'])
        require(child.get('identity') == identity and child.get('readerStderr') == ''
            and isinstance(child.get('readerOutput'), str), 'source-read stdout identity differs')
        interval(child)
        tool = witness['childSource']; read.source(tool['path'], {k: tool[k] for k in ('sha256', 'bytes')})
        argv = witness.get('argv', [])
        require(len(argv) == 10 and argv[1:3] == ['-I', '-B'] and canonical(argv[3]) == canonical(tool['path'])
            and argv[4::2] == ['--sdk-root', '--parent-receipt', '--parent-sha256']
            and canonical(argv[5]) == canonical(outer['sourceRoot'])
            and canonical(argv[7]) == canonical(read.index['roles']['parent']['path'])
            and argv[9] == read.index['roles']['parent']['sha256'], 'source-read argv identity differs')
        require(set(child.get('logs', {})) == {'commands.log'}, 'original Git-reader log was omitted')
        log = child['logs']['commands.log']; body = base64.b64decode(log['base64'], validate=True)
        require(metadata(body) == {k: log[k] for k in ('sha256', 'bytes')}
            and b'cat-file' not in body and b'rev-parse HEAD' in body
            and b'ls-tree -rz --full-tree HEAD' in body, 'actual Git reader log absent/changed')


def verify_shader_closure(read, root, inventory):
    manifests = {'manifest.json': 97, 'addons/solid/manifest.json': 21,
        'addons/scalar/manifest.json': 4, 'addons/momentum/manifest.json': 2}
    members = set(manifests)
    for name, count in manifests.items():
        raw = read.source(joined(root, 'dist/flow-wgsl/' + name), inventory[name])
        manifest = json.loads(raw)
        rows = manifest.get('shaders', [])
        require(isinstance(rows, list) and len(rows) == count, 'source-built shader corpus coverage differs')
        if name == 'manifest.json':
            require(manifest.get('status') == 'FLOW_WGSL_CORPUS_COMPILED'
                and manifest.get('failed') == 0 and manifest.get('shaderCount') == 97
                and manifest.get('sourceCommit') == UPSTREAM_COMMIT
                and all(row.get('status') == 'PASS' for row in rows), 'core97 compilation did not pass')
            read.relative(root + '/source-inputs/flow', manifest['inputHashes'])
        else:
            require(type(manifest.get('abi')) is int and manifest['abi'] == 1, 'addon shader ABI differs')
            read.relative(root + '/addons/flow', manifest['sourceHashes'])
        for row in rows:
            source = row['source'] if row['source'].startswith('addons/') else 'source-inputs/flow/' + row['source']
            read.source(joined(root, source), row['sourceSha256'])
            for field in ('wgsl', 'reflection'):
                member = relative(row[field])
                require(member not in members and member in inventory, 'duplicate/missing actual shader member')
                members.add(member)
                read.source(joined(root, 'dist/flow-wgsl/' + member), row[field + 'Sha256'])
    require(members == set(inventory) and len(members) == 252, 'shader closure includes unknown or missing files')


def literal_constant(source, name):
    """Read a source-bound data constant, never import or execute SDK code."""
    rows = [node.value for node in ast.parse(source).body if isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == name for target in node.targets)]
    require(len(rows) == 1, 'ambiguous original SDK evidence constant: ' + name)
    return ast.literal_eval(rows[0])


def verify_phase_commands(steps, isolation):
    """The reviewed Windows observer preserves these ten original commands."""
    require(isolation.get('mode') == 'shared-host-lock' and isolation.get('environmentOverridden') is False
        and isolation.get('sharedLocalPerformanceClaim') is False, 'SDK execution isolation changed')
    lock = isolation['sharedPerformanceLock']
    require(lock.get('environmentOverridden') is False
        and lock.get('sha256') == '68518bb32b68e724030b66440ea4d9b2b23f56cf10a01606cdbf0a7f620788c7',
        'original shared host lock changed')
    require(len(steps) == 10, 'SDK command coverage differs')
    fourth = steps[3]['command']
    require(len(fourth) == 3 and fourth[:2] == ['tools/abi_browser_test.py', '--chromium'],
        'reviewed SDK browser command differs')
    browser = fourth[2]
    canonical(browser)
    seventh = steps[6]['command']
    require(len(seventh) == 8 and seventh[:2] == ['tools/browser_compat_endurance.py', '--release-phase']
        and seventh[2:4] == ['--browser', browser] and seventh[4] == '--lock-workspace'
        and physical_key(seventh[5]) == physical_key(lock['effectiveWorkspace']) and seventh[6] == '--report'
        and re.fullmatch(r'reports/endurance-browser-[0-9a-f]{32}\.json', seventh[7]),
        'original bounded endurance command differs')
    gpu = ['--browser-executable', browser, '--hardware']
    expected = [['build.py', 'test'], ['build.py', 'abi', '--target', 'native'],
        ['build.py', 'abi', '--target', 'wasm'], fourth,
        ['tools/typecheck_browser.py', '--chromium', browser],
        ['tools/browser_test.py', '--profile', 'candidate', '--chromium', browser], seventh,
        ['addons/flow/browser_test.py', *gpu],
        ['addons/flow/wgsl_browser_test.py', *gpu, '--modules-only', '--include-addons', '--advection', '--mesh-scan',
            '--report', 'reports/flow-wgsl-modules.json'],
        ['addons/flow/host_browser_test.py', '--unified', *gpu, '--browser-engine', 'chromium']]
    require([step.get('command') for step in steps] == expected, 'SDK phase command/control changed')



def verify_phase1_python_environment(read, execution, root, folder, sources):
    """Only the exact retained phase-one isolated CLI environment may route to this venv."""
    proof = execution.get('pythonEnvironment', {})
    require(set(proof) == {'schema', 'interpreter', 'identity', 'probe', 'before', 'after'}
        and proof.get('schema') == 'physx-pe.phase1-isolated-cli-python/v1'
        and proof.get('interpreter') == PHASE1_PYTHON, 'missing or different phase-one Python environment proof')
    reference_base = next((name for name in ('reports/functional-verification-06',
        'reports/functional-verification-07') if physical_key(folder) == physical_key(joined(root, name))), None)
    require(reference_base is not None, 'phase-one environment folder is not the selected allowed observation folder')
    identity_name = joined(folder, 'python-environment-identity.json')
    probe_name = joined(folder, 'environment_probe.py')
    require(proof['identity'] == {'file': reference_base + '/python-environment-identity.json',
                                 'sha256': PHASE1_PYTHON_IDENTITY_SHA256}
        and proof['probe'] == {'file': reference_base + '/environment_probe.py',
                             'sha256': PHASE1_PYTHON_PROBE_SHA256}, 'phase-one probe/identity reference differs')
    identity = read.document(identity_name, PHASE1_PYTHON_IDENTITY_SHA256)
    read.source(probe_name, PHASE1_PYTHON_PROBE_SHA256)
    workflow = read.source(joined(root, '.github/workflows/build.yml'), sources['.github/workflows/build.yml'])
    require(b'python -m pip install playwright==1.57.0' in workflow
        and identity.get('schema') == 'physx-pe.isolated-cli-python-identity/v1'
        and identity.get('executable') == PHASE1_PYTHON and identity.get('prefix') == PHASE1_PYTHON.rsplit('/bin/', 1)[0]
        and identity.get('basePrefix') == '/usr' and identity.get('resolvedExecutable') == '/usr/bin/python3.12'
        and identity.get('playwrightVersion') == '1.57.0' and identity.get('syncApiImported') is True
        and all(type(identity.get(key)) is int and identity[key] == 1 for key in ('isolated', 'ignoreEnvironment', 'noUserSite'))
        and identity.get('noBytecode') is True and len(identity.get('inputs', {})) == 231,
        'phase-one pinned physical isolated import identity differs')
    def linux_path(path):
        value = canonical(path)
        require(re.match(r'^[A-Za-z]:/', value) is not None, 'phase-one probe artifact is not on the selected Windows volume')
        return '/mnt/' + value[0].lower() + '/' + value[3:]
    phase_begin, phase_end = interval(execution)
    previous = phase_begin
    for label, field in (('phase1-environment-before', 'before'), ('phase1-environment-after', 'after')):
        reference = proof[field]
        require(set(reference) == {'file', 'sha256'} and reference['file'] ==
            reference_base + '/' + label + '-execution.json', 'phase-one probe execution reference differs')
        witness = read.document(joined(root, reference['file']), reference['sha256'])
        first, last = interval(witness)
        require(previous <= first <= last <= phase_end, 'phase-one physical import witness interval differs')
        previous = last
        require(witness.get('schema') == 'physx-pe.isolated-cli-python-probe-execution/v1'
            and type(witness.get('observedExitCode')) is int and witness['observedExitCode'] == 0
            and witness.get('probeSha256') == PHASE1_PYTHON_PROBE_SHA256
            and witness.get('actualArgv') == ['wsl.exe', '-d', 'Ubuntu-24.04', '--', PHASE1_PYTHON,
                '-I', '-B', linux_path(probe_name), '--output', linux_path(joined(folder, label))]
            and all(witness.get(key) is False for key in ('browserLaunched', 'gpuExecuted', 'testsExecuted', 'installPerformed')),
            'phase-one actual isolated probe command/result/scope differs')
        for stream in ('stdout', 'stderr'):
            row = witness[stream]
            require(set(row) == {'file', 'bytes', 'sha256'} and row['file'] ==
                reference_base + '/' + label + '.' + stream, 'phase-one raw probe stream reference differs')
        raw = read.source(joined(root, witness['stdout']['file']), {key: witness['stdout'][key] for key in ('bytes', 'sha256')})
        require(read.source(joined(root, witness['stderr']['file']), {key: witness['stderr'][key] for key in ('bytes', 'sha256')}) == b'',
            'phase-one isolated probe reported stderr')
        observed = json.loads(raw)
        require(observed.get('schema') == 'physx-pe.isolated-cli-python-probe/v1'
            and observed.get('status') == 'ISOLATED_IMPORT_INPUTS_OBSERVED_NOT_RUNTIME_VERIFIED'
            and observed.get('identity') == identity and set(observed.get('retainedInputs', {})) == set(identity['inputs'])
            and all(observed.get(key) is False for key in ('browserLaunched', 'gpuExecuted', 'testsExecuted', 'installPerformed')),
            'phase-one actual before/after physical import closure differs')
        for original, expected in identity['inputs'].items():
            row = observed['retainedInputs'][original]
            require(set(row) == {'file', 'bytes', 'sha256'} and row['file'].startswith(label + '/inputs/')
                and {key: row[key] for key in ('bytes', 'sha256')} == expected,
                'phase-one physical retained input mapping differs')
            read.source(joined(folder, row['file']), expected)
    return PHASE1_PYTHON


def verify_sdk_functional(read, verified, observer, outer, sdk, shaders, version):
    """Compilation cannot substitute for the original ten actual SDK phases."""
    require(verified.get('schema') == 'physx-pe.release-verification/v1'
        and verified.get('status') == 'BUILD_AND_BROWSER_SMOKE_PASSED_ALPHA'
        and observer.get('schema') == 'physx-pe.mixed-host-functional-observation/v1'
        and observer.get('status') == 'MIXED_HOST_SDK_FUNCTIONAL_GATES_PASSED_NOT_ENGINE_ADMITTED',
        'missing, failed or incomplete original SDK10 verification')
    root, sources, revision = outer['sourceRoot'], outer['sourceHashesBefore'], outer['sourceRevisionBefore']
    require(verified.get('version') == version and verified.get('sourceHashesBefore') == sources == verified.get('sourceHashesAfter')
        and verified.get('sourceRevision') == revision == observer.get('sourceRevision')
        and verified.get('artifacts') == sdk['artifacts']
        and verified.get('shaderHashesBefore') == shaders == verified.get('shaderHashesAfter'),
        'SDK10 source revision/pair/shader tuple differs')
    require(observer.get('executionHost') == 'native-windows-parent' and observer.get('compilerCpuHost') == 'Ubuntu-24.04'
        and all(observer.get(key) is False for key in ('ciEnvironmentManufactured', 'devicePolicyOverridden', 'installPerformed', 'releaseAdmitted')),
        'mixed-host verification altered environment or scope')
    begin, end = interval(verified)
    observed_begin, observed_end = interval(observer)
    require(observed_begin <= begin <= end <= observed_end and verified.get('gpuMode') == 'hardware'
        and verified.get('requestedGpuMode') == 'hardware' and verified.get('flowBrowserEngine') == 'chromium',
        'SDK verification interval or actual requested execution mode differs')
    folder = read.index['roles']['sdkFunctionalObservation']['path'].replace('\\', '/').rsplit('/', 1)[0]
    read.source(joined(folder, 'run.py'), observer['runnerSha256'])
    read.source(joined(folder, 'dispatcher.log'), observer['dispatcherLogSha256'])
    read.source(joined(root, observer['verification']['file']), observer['verification']['sha256'])
    require(observer['verification']['sha256'] == read.index['roles']['sdkVerification']['sha256']
        and observer['verification']['producerStatus'] == verified['status'], 'original SDK verification reference differs')
    require(observer.get('originalReleaseSha256') == sources.get('release.py'), 'SDK verify program source differs')
    for name, digest in observer.get('buildReceipts', {}).items():
        read.source(joined(root, name), digest)
    require({read.index['roles'][name]['sha256'] for name in ('parent', 'child', 'staticAudit')}
        <= set(observer.get('buildReceipts', {}).values()), 'functional observer omitted original compile producers')
    steps, actual = verified.get('steps', []), observer.get('steps', [])
    require(len(steps) == len(actual) == 10, 'original ten SDK phases are not complete')
    verify_phase_commands(steps, verified.get('executionIsolation', {}))
    lock = verified['executionIsolation']['sharedPerformanceLock']
    read.source(lock['helper'], lock['sha256'])
    expected_snapshot = {'sourceHashes': sources, 'sourceRevision': revision,
        'referenceInputs': outer['referenceInputsBefore'], 'compilerInputs': outer['compilerInputsBefore'],
        'nativeCompilerAliases': outer['nativeCompilerAliases'], 'rustCompilerInputs': outer['rustCompilerInputsBefore'],
        'artifacts': sdk['artifacts'], 'buildManifestSha256': read.index['roles']['sdkManifest']['sha256'],
        'flowShaderInventory': shaders}
    snapshots = [observer['prequeueSnapshot'], observer['postSnapshot']]
    previous = begin
    for number, ((name, status), summary, execution) in enumerate(zip(PHASES, steps, actual), 1):
        require(summary.get('name') == name and summary.get('status') == 'PASS' and summary.get('resultStatus') == status
            and execution.get('phase') == number and execution.get('status') == 'PASS'
            and execution.get('requestedArgv') == summary.get('command'), 'SDK phase/result/command was skipped or changed')
        raw = read.document(joined(root, summary['reportFile']), summary['reportSha256'])
        require(raw.get('status') == status and summary.get('checks') == raw.get('enduranceAdmission', raw.get('checks'))
            and summary.get('testCount') == (3 if number == 7 else len(raw['tests']) if isinstance(raw.get('tests'), list) else None),
            'SDK phase raw status/coverage summary differs')
        started, finished = interval(execution)
        require(previous <= started <= finished <= end, 'SDK phases overlap, predate invocation or have invalid intervals')
        previous = finished
        if number <= 3:
            require(execution.get('host') == 'wsl-compiler-and-native-cpu' and type(execution.get('observedExitCode')) is int
                and execution['observedExitCode'] == 0 and execution.get('actualArgv', [])[:6]
                == ['wsl.exe', '-d', 'Ubuntu-24.04', '--', 'bash', '-c'], 'actual compiler/CPU phase did not complete')
            shell = execution['actualArgv'][6:]
            interpreter = '/usr/bin/python3'
            if number == 1 and 'pythonEnvironment' in execution:
                require(summary['command'] == ['build.py', 'test'], 'CLI environment changed original phase-one argv')
                interpreter = verify_phase1_python_environment(read, execution, root, folder, sources)
            else:
                require('pythonEnvironment' not in execution, 'CLI environment is restricted to original phase one')
            require(len(shell) == 1 and shell[0].endswith('exec ' + shlex.quote(interpreter) + ' ' + shlex.join(summary['command'])),
                'WSL routed a different original CPU command')
        else:
            require('pythonEnvironment' not in execution, 'CLI environment cannot alter a Windows phase')
            require(execution.get('host') == 'native-windows-original-command'
                and execution.get('originalDispatcherReturnedSuccessfully') is True
                and execution.get('actualArgv', [])[1:] == summary['command'], 'actual original browser dispatcher did not complete')
        expected_lock = 'existing child-owned execution window' if number == 7 else 'existing release.verify native-Windows execution window'
        require(execution.get('lockBehavior') == expected_lock, 'original SDK phase lock policy changed')
        trace = execution['producerCommandTrace']
        read.source(joined(root, trace['file']), {k: trace[k] for k in ('sha256', 'bytes')})
        snapshots += [execution['preexecutionSnapshot'], execution['postexecutionSnapshot']]
        if number in (6, 7, 8, 10):
            require(raw.get('artifactHashes') == sdk['artifacts'], 'raw executed SDK phase used a different pair')
        if number == 6:
            program = read.source(joined(root, 'tools/evidence.py'), sources['tools/evidence.py'])
            names = literal_constant(program, 'CORE_TESTS')
            harness = literal_constant(program, 'HARNESS')
            require(len(names) == len(set(names)) == 37 and raw.get('testHarnessSha256') == {name: sources[name] for name in harness}
                and raw.get('physicsExecuted') is True and raw.get('releaseApproved') is False
                and raw.get('engineIntegrationVerified') is False and raw.get('stderr') == raw.get('pageErrors') == [],
                'original behavioral suite source/execution scope differs')
            rows = raw.get('tests', [])
            require(len({row.get('name') for row in rows}) == len(rows) and set(names) <= {row.get('name') for row in rows}
                and all(row.get('status') == 'PASS' and type(row.get('ms')) in (int, float)
                    and math.isfinite(row['ms']) and row['ms'] >= 0 for row in rows),
                'behavioral SDK coverage failed, skipped or duplicated')
        if number == 7:
            require(raw.get('releasePhase') is True and raw.get('requestedConfiguration') == {'cycles': 256, 'physicalSeconds': 600}
                and raw.get('cpuBrowserArgs') == ['--disable-gpu'] and raw.get('browserClosed') is True
                and raw.get('pageErrors') == [] and raw.get('releaseApproved') is False
                and raw.get('enduranceAdmission', {}).get('status') == 'BOUNDED_ENDURANCE_ACCEPTED_NOT_RELEASE_CERTIFIED'
                and raw.get('enduranceAdmission', {}).get('testsAccepted') == 3,
                'original bounded CPU endurance admission is missing or changed')
    for row in snapshots:
        snapshot = read.document(joined(root, row['file']), row['sha256'])
        require(snapshot.get('schema') == 'physx-pe.mixed-host-snapshot/v1'
            and all(snapshot.get(key) == value for key, value in expected_snapshot.items()), 'actual SDK snapshot changed')


def verify_source_build(files, index):
    """Produce only a source-build context; no default/legacy dictionary synthesis."""
    read = Retained(files, index)
    docs = {role: read.role(role) for role in ROLES}
    outer, inner, sdk, audit, descriptor = (docs[name] for name in
        ('parent', 'child', 'sdkManifest', 'staticAudit', 'executionDescriptor'))
    root = canonical(outer['sourceRoot'])
    require(outer.get('schema') == 'physx-pe.source-kit-windows-phase/v1' and outer.get('phase') == 'full-build'
        and outer.get('status') == 'FULL_SOURCE_COMPILED_NOT_RUNTIME_VERIFIED'
        and outer.get('authoritativeValidationHost') == 'native-windows-python'
        and outer.get('compilerRecipeHost') == 'Ubuntu-24.04'
        and inner.get('schema') == 'physx-pe.release-build/v1' and inner.get('status') == 'COMPILED_NOT_RUNTIME_VERIFIED'
        and outer.get('fullSourceBuild') == inner, 'original compile producer status/protocol differs')
    require(all(outer.get(name) is False for name in ('runtimeExecuted', 'gpuExecuted', 'releaseAdmitted'))
        and audit.get('schema') == 'physx-pe.final-build-audit/v2'
        and audit.get('status') == 'COMPILED_ARTIFACTS_STATICALLY_REVIEWED_NOT_RUNTIME_VERIFIED'
        and all(audit.get(name) is False for name in ('runtimeExecuted', 'engineAdmitted', 'installed', 'published')),
        'compile/static observation claims an unperformed runtime admission')
    steps = outer.get('steps', [])
    require(len(steps) == 1 and steps[0].get('status') == 'PASS'
        and type(steps[0].get('exitCode')) is int and steps[0]['exitCode'] == 0
        and steps[0].get('argv', [])[:6] == ['wsl.exe', '-d', 'Ubuntu-24.04', '--', 'bash', '-c'],
        'actual original compile step did not finish')
    producer_logs = descriptor.get('inputGroups', {}).get('producerLog', {})
    require(len(producer_logs) == 1, 'actual original source-build log missing')
    log = next(iter(producer_logs.values()))
    require(log['sha256'] == outer.get('logSha256'), 'source-build log identity differs')
    read.source(log['path'], {key: log[key] for key in ('sha256', 'bytes')})
    sources, revision = outer['sourceHashesBefore'], outer['sourceRevisionBefore']
    require(hash_map(sources) and sources == outer.get('sourceHashesAfter') == inner.get('sourceHashes') == inner.get('sourceHashesAfter')
        and revision == inner.get('sourceRevision') == audit.get('sourceRevision')
        and set(revision) == {'commit', 'tree', 'inventorySha256'}
        and all(re.fullmatch('[0-9a-f]{40}', revision[key]) for key in ('commit', 'tree'))
        and revision['inventorySha256'] == sha(json.dumps(sources, sort_keys=True, separators=(',', ':')).encode()),
        'committed source inventory/revision differs')
    read.relative(root, sources)
    read.relative(root, outer['referenceInputsBefore'])
    require(sdk.get('locally_compiled') is True and sdk.get('source_version') == SDK_VERSION
        and sdk.get('runtime_verified') is False and sdk.get('engine_integration_verified') is False
        and inner.get('upstreamCommit') == UPSTREAM_COMMIT and sdk.get('artifacts') == inner.get('artifacts') == audit.get('artifacts'),
        'raw SDK compile/pair identity changed')
    require({'physx-pe.mjs', 'physx-pe.wasm'} <= set(sdk['artifacts'])
        <= {'physx-pe.mjs', 'physx-pe.wasm', 'physx-pe.d.ts', 'physx-pe.d.mts'}, 'unexpected SDK artifact keys')
    compiled_artifacts = read.relative(root + '/dist/candidate', sdk['artifacts'])
    pair = {name: compiled_artifacts[name] for name in ('physx-pe.mjs', 'physx-pe.wasm')}
    require(pair['physx-pe.wasm'].startswith(b'\0asm\x01\0\0\0') and len(pair['physx-pe.mjs']) > 8,
        'actual compiled WebAssembly module/loader bytes are absent')
    lock = read.document(joined(root, 'upstream.lock.json'))
    require(lock.get('candidate_sdk') == SDK_VERSION and lock.get('upstream_commit') == UPSTREAM_COMMIT
        and lock.get('emscripten') == '4.0.19' and lock.get('flow_slang_version') == '2025.6.1',
        'actual compiled toolchain/upstream lock differs')
    verify_compiler_snapshots(outer, lock)
    for name, row in outer['compilerInputsBefore'].items():
        read.source(name, row)
    for row in outer['rustCompilerInputsBefore']['files'].values():
        read.source(row['resolvedPath'], {key: row[key] for key in ('sha256', 'bytes')})
    selection = read.document(joined(root, 'source-selection.json'))
    selected = selection['prospectiveNativeSelection']
    require(selection.get('schema') == 'physx-pe.source-selection/v2'
        and selection.get('upstreamCommit') == UPSTREAM_COMMIT
        and selection.get('finalSelectionStatus') == 'FINAL_SOURCES_SELECTED_FOR_BUILD' and selection.get('pendingNativeInputs') == []
        and selected.get('cachedObjectsAdmitted') is False and selected.get('alphaExecutionDependenciesAdmitted') is False
        and selected.get('schema') == 'physx-pe.full-native-selection/v1'
        and _section_exact([selected.get(name) for name in ('signatureCount', 'blastTranslationUnits', 'thermalAbi',
            'thermalNumerics', 'massAbi', 'preparationAbi', 'convexAbi')], [96, 27, 2, 9, 1, 1, 1])
        and len(selected.get('sourceHashes', {})) == 215
        and all(sources.get(name) == digest for name, digest in selected['sourceHashes'].items()),
        'selected native source closure is incomplete or admits cached/Alpha objects')
    for component in selection['selectedComponents'].values():
        require(all(sources.get(name) == digest for name, digest in component['nativeSourceHashes'].items())
            and outer['referenceInputsBefore'].get(component['manifestPath']) ==
                {'sha256': component['manifestSha256'], 'bytes': component['manifestBytes']},
            'selected component source/reference closure differs')
        read.source(joined(root, component['manifestPath']), component['manifestSha256'])
    prepared = read.document(joined(root, 'work/source-preparation.json'), inner['preparedSourceReceiptSha256'])
    require(prepared.get('schema') == 'physx-pe.prepared-source/v1' and prepared.get('upstreamCommit') == UPSTREAM_COMMIT
        and prepared.get('overlaySha256') == inner.get('overlaySha256') == sources.get('patches/browser-overlay.patch')
        and len(prepared.get('modifiedSources', {})) == 141,
        'original prepared upstream/overlay receipt differs')
    native = sdk['selected_native_source_build']
    require(read.document(joined(root, native['reportPath']), sdk['selected_native_source_build_manifest_sha256']) == native
        and native.get('schema') == 'physx-pe.fresh-selected-native-build/v1' and native.get('status') == 'COMPILED_NOT_RUNTIME_VERIFIED'
        and native.get('allTranslationUnitsRecompiled') is True and native.get('archivedObjectsUsed') is False
        and native.get('sources') == native.get('sourcesAfter') == selected['sourceHashes'], 'fresh native producer changed')
    read.relative(root, native['sources']); read.relative(root, native['generated']['generated']); read.relative(root, native['artifacts'])
    for row in native['blastCompileCommands']:
        read.source(joined(root, row['object']), row['sha256'])
    original = read.document(joined(root, 'reference/combined-native-06/provenance/selected-blast-build.json'))
    recipe = read.document(joined(root, 'reference/combined-native-06/dist/candidate/build-manifest.json'))
    verify_blast_recipe(native, original, recipe, root)
    flow = read.document(joined(root, 'dist/flow-host/build-manifest.json'), sdk['flow_source_build_manifest_sha256'])
    require(flow.get('schema') == 'flow-host-build-v1' and flow['compiler'] == native['compiler']
        and flow['sourceHashes'] == flow['sourceHashesAfter'] and flow.get('allTranslationUnitsRecompiled') is True
        and flow.get('generatedHostHeaderCount') == 124 and flow.get('generatedIncludeWrapperCount') == 6
        and flow['shaderInventory'] == sdk['flow_shader_inventory'] == inner['flowShaderInventory'], 'fresh Flow producer changed')
    verify_flow_recipe(flow, root)
    read.relative(root, flow['sourceHashes'])
    require(all(flow['sourceHashes'].get(name) == sources.get(name) for name in
        ('source-selection.json', 'tools/flow_source_evidence.py', 'tools/prepare_sources.py', 'upstream.lock.json')),
        'fresh Flow helper/source-selection inputs differ from compiled source inventory')
    pins = read.document(joined(root, 'source-inputs/flow/source-pins.json'))
    require(pins.get('schema') == 'physx-pe.flow-upstream-source-inputs/v1' and len(pins.get('files', {})) == 265
        and pins.get('upstreamCommit') == UPSTREAM_COMMIT
        and {name.removeprefix('source-inputs/flow/') for name in flow['sourceHashes'] if name.startswith('source-inputs/flow/')}
            == set(pins['files']) | {'source-pins.json'},
        'Flow upstream source inventory differs')
    read.relative(root + '/source-inputs/flow', pins['files'])
    require(len(flow['shaderInventory']) == 252, 'shader/reflection/manifest closure differs')
    read.relative(root + '/dist/flow-wgsl', flow['shaderInventory'])
    verify_shader_closure(read, root, flow['shaderInventory'])
    for row in flow['compilations']:
        read.source(row['object'])
    link = audit['finalLink']
    rule = read.source(joined(root, link['originalRule']), link['rawSha256'])
    require(rule == read.source(joined(root, link['rawSnapshot']), link['rawSha256']), 'actual rule snapshot differs')
    argv, cwd = verify_direct_link(rule, link, root)
    for name, row in link['inputs'].items():
        read.source(name if name.startswith('/') else joined(cwd, name), row)
    normalized_link_inputs = {canonical(name) if name.startswith('/') else joined(cwd, name): row
        for name, row in link['inputs'].items()}
    require(all(normalized_link_inputs.get(joined(root, name)) == row for name, row in native['artifacts'].items()),
        'fresh native partial objects are not the selected final linked objects')
    for number, arg in enumerate(argv):
        if arg == '--post-js':
            name = argv[number + 1]
            read.source(name if name.startswith('/') else joined(cwd, name))
    signatures = read.document(joined(root, selected['addonSignatureContract']))
    addon = read.document(joined(root, 'types/addon-abi.json'))
    require(signatures.get('schema') == 'physx-pe.selected-addon-exports/v1' and signatures.get('pointerModel') == 'wasm32'
        and len(signatures.get('exports', {})) == 96 and addon.get('schema') == 'physx-pe.addon-declarations/v1'
        and addon.get('pointerModel') == 'wasm32' and addon.get('exports') == signatures['exports']
        and addon.get('sources') == {name: sources[name] for name in SIGNATURE_SOURCES}, 'actual source/declaration96 signatures differ')
    assignments = re.findall(r'Module\["(_pr_[^"\]]+)"\]=wasmExports\["([^"\]]+)"\]', pair['physx-pe.mjs'].decode())
    mappings = {}
    for name in signatures['exports']:
        matches = [target for symbol, target in assignments if symbol == name]
        require(len(matches) == 1, 'missing/ambiguous actual native export assignment')
        mappings[name] = matches[0]
    require(len(set(mappings.values())) == 96
        and all(mappings.get(name) == audit['compiledCAbiFunctions'].get(name, {}).get('nativeSymbol') for name in signatures['exports']),
        'actual generated loader96 mapping differs')
    for name in ('physx-pe.d.ts', 'physx-pe.d.mts'):
        body = read.source(joined(root, 'dist/candidate/' + name), audit['declarations']['dist/candidate/' + name])
        require(body == read.source(joined(root, 'types/' + name)), 'adjacent declarations differ from source')
        for symbol, row in signatures['exports'].items():
            text = 'function ' + symbol + '(' + ', '.join(row['parameters']) + '): ' + row['returnType'] + ';'
            require(body.decode().count(text) == 1, '96 declaration signature missing or ambiguous')
    require(_section_exact([sdk.get(name) for name in ('blast_physical_stress_abi', 'blast_sections_v3_abi',
        'blast_sections_v3_preparation_abi', 'blast_stress_mass_abi', 'wood_thermal_mr_abi', 'wood_thermal_numerics',
        'flow_convex_query_abi')], [1, 1, 1, 1, 2, 9, 1]) and sdk.get('final_link_strict_flags') == STRICT,
        'source-bound numerical/getter declarations differ')
    signature_path = joined(root, selected['addonSignatureContract'])
    require(descriptor.get('compiler') == native['compiler'] and descriptor.get('finalLink') == link
        and descriptor.get('sourceSelectionSha256') == sources['source-selection.json']
        and descriptor.get('expectedAddonExports') == list(signatures['exports'])
        and descriptor.get('loaderToWasmExports') == mappings
        and physical_key(descriptor.get('sourceSignatures', {}).get('path')) == physical_key(signature_path)
        and {key: descriptor['sourceSignatures'].get(key) for key in ('sha256', 'bytes')} == metadata(read.source(signature_path))
        and descriptor.get('nativeCapabilities') == {name: sdk[name] for name in ('blast_physical_stress_abi',
            'blast_sections_v3_abi', 'blast_sections_v3_preparation_abi', 'blast_stress_mass_abi',
            'wood_thermal_mr_abi', 'wood_thermal_numerics', 'flow_convex_query_abi')},
        'derived observation facts differ from original source-build evidence')
    configuration = read.role('producerConfiguration')
    require(descriptor.get('producerConfiguration') == read.index['roles']['producerConfiguration']
        and configuration['cleanObservation'] == read.index['roles']['cleanBuildObservation']
        and configuration['sdkVerification'] == read.index['roles']['sdkVerification']
        and configuration['sdkFunctionalObservation'] == read.index['roles']['sdkFunctionalObservation'],
        'configured context original role references differ')
    verify_config_bindings(read, configuration, outer, inner, sdk, descriptor)
    verify_clean_binding(read, configuration, outer)
    verify_static_audit04(read, configuration, audit, outer, sdk)
    verify_descriptor(read, descriptor, outer, sdk)
    verify_sdk_functional(read, docs['sdkVerification'], docs['sdkFunctionalObservation'], outer, sdk,
        flow['shaderInventory'], inner['version'])
    raw = {role: read.source(index['roles'][role]['path']) for role in ROLES}
    return CheckedSourceBuild(MappingProxyType(raw), MappingProxyType(dict(sources)),
        MappingProxyType({name: bytes(body) for name, body in pair.items()}),
        MappingProxyType({name: read.source(joined(root, 'dist/flow-wgsl/' + name)) for name in flow['shaderInventory']}),
        NumericalFacts())
