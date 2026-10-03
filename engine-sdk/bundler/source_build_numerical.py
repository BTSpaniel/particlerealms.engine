# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Explicit SDK identities for unchanged numerical gates; retained bytes only.

The factory requires the actual clean compile, current source reads and original
successful SDK10. This is not a legacy manifest adapter. Raw producer records,
statuses, timestamps and source maps are never rewritten. Diagnostic99 is not
an ordinary runtime and is deliberately outside this contract.
"""
from datetime import datetime
import json

from .combined_native import metadata, require, sha
from .physics import _section_exact
from .source_build_context import (Retained, canonical, interval, joined,
    physical_key, verify_descriptor, verify_source_build)
from .source_build_baseline import (ADAPTERS, FLOW_SCOPE, physical_hashes,
    reference, verify_execution_window, verify_source_build_baseline_aggregate,
    verify_transform)

MATERIAL_STAGES = ('initialAdmission', 'lockedAdmission', 'completedExecution')
EXPORT_FIXTURE = ('sdk_source_build_exports_cases.mjs',
    '712a30cd6d2e68c099090e0ef5fbe1ea4b0b516ad7e6880438eafad548c22093')
MRI_RUNTIME = '62705218379e08b8066c62e44b8299b8702d02be6196976d520def8f9bd80330'
UI_SCOPE = 'Isolated candidate loader/WASM pair only; installed descriptor, Flow addon hosts and shader corpus remain in use. No runtime installation or Flow capability promotion.'


def ordinary_runtime_identity(runtime, descriptor, sdk, descriptor_ref, sdk_ref, root, *, live_ui=False):
    """Pure exact metadata check, also useful for explicit negative vectors."""
    core = {'path', 'build', 'executionDescriptor', 'executionDescriptorPath',
        'executionDescriptorSha256', 'nativeBuildManifestSha256'}
    extra = {'manifestSha256', 'routes', 'scope'} if live_ui else set()
    require(isinstance(runtime, dict) and set(runtime) == core | extra,
        'ordinary source-built material runtime schema differs')
    if live_ui:
        expected = {'/engine/sim/physics/' + name: joined(root, 'dist/candidate/' + name)
            for name in ('physx-pe.mjs', 'physx-pe.wasm')}
        routes = runtime['routes']
        require(runtime['manifestSha256'] == runtime['nativeBuildManifestSha256'] == sdk_ref['sha256']
            and runtime['scope'] == UI_SCOPE and isinstance(routes, dict) and set(routes) == set(expected)
            and {name: canonical(path) for name, path in routes.items()} == expected,
            'live UI original manifest/routes/scope differ')
    require(descriptor.get('schema') == 'physx-pe.configured-source-build-observation/v1'
        and descriptor.get('status') == 'COMPILED_SOURCE_OBSERVED_NOT_RUNTIME_VERIFIED'
        and len(descriptor.get('expectedAddonExports', [])) == 96
        and len(set(descriptor['expectedAddonExports'])) == 96,
        'ordinary numerical gate rejects another descriptor dialect or diagnostic exports')
    require(_section_exact(runtime['build'], sdk) and _section_exact(runtime['executionDescriptor'], descriptor)
        and canonical(runtime['path']) == joined(root, 'dist/candidate/physx-pe.mjs')
        and physical_key(runtime['executionDescriptorPath']) == physical_key(descriptor_ref['path'])
        and runtime['executionDescriptorSha256'] == descriptor_ref['sha256']
        and runtime['nativeBuildManifestSha256'] == sdk_ref['sha256'],
        'material runtime changed the actual SDK/observation/pair identity')


def verify_material_reads(read, proof, descriptor, outer, sdk, *, seen=None):
    """Use actual material-runner ordering, including its pre-report first read."""
    rows = proof.get('executionReadWitnesses')
    require(isinstance(rows, dict) and set(rows) == set(MATERIAL_STAGES),
        'material execution omits queue/locked/closed-browser source reads')
    started, finished = interval(proof)
    previous = datetime.fromisoformat(descriptor['observedUtc'])
    require(previous.tzinfo is not None and previous <= started, 'material proof predates its observation')
    used = set() if seen is None else seen
    used.update(physical_key(row['path']) for row in descriptor['readWitnesses'])
    for stage in MATERIAL_STAGES:
        refs = rows[stage]
        verify_descriptor(read, descriptor, outer, sdk, read_witnesses=refs)
        for ref in refs:
            key = physical_key(ref['path'])
            require(key not in used, 'material execution reused a source-read witness')
            used.add(key)
            child = json.loads(json.loads(reference(read, ref))['stdout'])
            first, last = interval(child)
            require(previous <= first <= last <= finished, 'material source reads are out of order')
            if stage == 'initialAdmission':
                require(last <= started, 'initial read did not precede material report creation')
            else:
                require(first >= started, 'locked/completed read predates material report')
            previous = last


class SourceBuildNumerical:
    """Checked, explicit access to original SDK facts, never synthesized build keys."""
    def __init__(self, retained_files, retained_index):
        self.checked = verify_source_build(retained_files, retained_index)
        self.read = Retained(retained_files, retained_index)
        self._baseline = None

    @property
    def build(self):
        return self.checked.raw_json('sdkManifest')

    @property
    def descriptor(self):
        return self.checked.raw_json('executionDescriptor')

    @property
    def root(self):
        return canonical(self.checked.raw_json('parent')['sourceRoot'])

    @property
    def artifacts(self):
        return {name: metadata(body) for name, body in self.checked.runtime_artifacts.items()}

    @property
    def pair(self):
        return {name: row['sha256'] for name, row in self.artifacts.items()}

    @property
    def build_sha256(self):
        return sha(self.checked.original_records['sdkManifest'])

    def source(self, name):
        """Original committed or generated input; no producer path is opened."""
        path = joined(self.root, name)
        row = self.descriptor['physicalInputs'].get(path)
        require(row is not None, 'source absent from actual compiled/observed closure: ' + name)
        return self.read.source(path, row)

    def source_sha(self, name):
        return sha(self.source(name))

    def sources(self, names):
        return {name: self.source_sha(name) for name in names}

    @property
    def exports(self):
        return self.descriptor['expectedAddonExports']

    @property
    def flow(self):
        return json.loads(self.source('dist/flow-host/build-manifest.json'))

    @property
    def thermal_command(self):
        return self.build['selected_native_source_build']['thermalCompile']['argv']

    def require_build(self, build, pair=None):
        require(_section_exact(build, self.build) and (pair is None or _section_exact(pair, self.pair)),
            'numerical gate used another raw SDK producer or pair')

    def required_inputs(self):
        descriptor = self.descriptor
        values = {physical_key(name): row['sha256'] for name, row in descriptor['physicalInputs'].items()}
        ref = self.read.index['roles']['executionDescriptor']
        values[physical_key(ref['path'])] = ref['sha256']
        values.update({physical_key(row['path']): row['sha256'] for row in descriptor['readWitnesses']})
        return values

    def require_closure(self, hashes):
        actual = physical_hashes(hashes)
        require(all(actual.get(path) == digest for path, digest in self.required_inputs().items()),
            'numerical witness omits actual source/compiler/object/producer closure')
        for path, digest in actual.items():
            require(sha(self.read.source(path)) == digest, 'numerical witness source was not retained exactly')
        return actual

    def material(self, proof, *, seen=None, live_ui=False):
        descriptor = self.descriptor
        ordinary_runtime_identity(proof.get('unifiedRuntime'), descriptor, self.build,
            self.read.index['roles']['executionDescriptor'], self.read.index['roles']['sdkManifest'], self.root, live_ui=live_ui)
        verify_material_reads(self.read, proof, descriptor, self.checked.raw_json('parent'), self.build, seen=seen)

    def admit_baseline(self, aggregate, artifacts, build, kwargs):
        self.require_build(build)
        require(_section_exact(artifacts, self.artifacts), 'baseline used another selected pair')
        result = verify_source_build_baseline_aggregate(aggregate, artifacts, build, **kwargs,
            retained_files=dict(self.read.files), retained_index=self.read.index)
        # Retain immutable originals; later shader/solid gates cannot substitute a
        # parsed dictionary which merely repeats the same outer status.
        self._baseline = {role: (bytes(kwargs['receipts'][role]), bytes(kwargs['witnesses'][role])) for role in result}
        return result

    def baseline_role(self, role, proof, *, raw=None, witness=None):
        require(self._baseline is not None and role in self._baseline, 'numerical baseline role not independently admitted')
        original, observed = self._baseline[role]
        require(_section_exact(proof, json.loads(original)) and (raw is None or raw == original)
            and (witness is None or _section_exact(witness, json.loads(observed))), 'numerical baseline role bytes differ')

    def flow_role(self, role, proof, raw, witness, raw_ref):
        require(role in ('rebase', 'momentum') and type(raw) is bytes and json.loads(raw) == proof,
            'unknown or rewritten source-build transaction proof')
        require(reference(self.read, raw_ref) == raw and witness.get('schema') == 'physx-pe.source-build-flow-witness/v1'
            and witness.get('status') == 'PASS' and witness.get('role') == role and witness.get('scope') == FLOW_SCOPE
            and witness.get('runtimeExecuted') is True and type(witness.get('exitCode')) is int and witness['exitCode'] == 0
            and witness.get('lockScope') == 'original runner with admission/recheck inside its lock'
            and witness.get('rawReport') == raw_ref and witness.get('rawStatus') == proof.get('status') == 'PASS',
            'source-build transaction witness failed or changed scope')
        hashes = verify_execution_window(self.read, witness, self.descriptor, self.checked.raw_json('parent'), self.build,
            self.read.index['roles']['executionDescriptor'], self.required_inputs())
        self.require_closure(witness['sourceHashes'])
        transforms = witness.get('metadataTransforms')
        require(isinstance(transforms, list) and len(transforms) == 1, 'transaction metadata adapter missing')
        verify_transform(self.read, transforms[0], hashes)
        for name in ('source_build_runner_support.py', 'run_source_build_flow.py', 'source_build_solid_adapter.py'):
            matches = [(path, digest) for path, digest in hashes.items() if path.rsplit('/', 1)[-1] == name]
            require(len(matches) == 1 and matches[0][1] == ADAPTERS[name], 'transaction execution adapter differs')
        require(_section_exact(proof.get('sourceBuildAdmission'), witness['sourceBuildAdmission'])
            and proof.get('nativeBuildManifestSha256') == self.build_sha256,
            'transaction raw metadata differs from actual fresh execution')


def checked(value):
    require(type(value) is SourceBuildNumerical, 'explicit checked source-build numerical context required')
    return value
