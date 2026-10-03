# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Packaging and isolation regressions for the independently shipped SDKs."""
import base64
import gzip
import hashlib
import importlib.util
import io
import json
import lzma
import os
import shutil
import struct
import tempfile
import unittest
import zipfile
import zlib
from pathlib import Path
from contextlib import ExitStack
from unittest import mock
from urllib.request import urlopen
from urllib.error import HTTPError

import bundler.sdk as sdk_module
import bundler.sdk_rebuild as rebuild_module
import bundler.cli as cli_module
from bundler.cli import _build_runtime_provenance, _inventory_sha256
from bundler.site import create_release_site_archive
from bundler.transform import is_shader_file, preprocess_shader_source
from bundler.compress import HAS_BROTLI, HAS_ZSTD, compress_brotli, compress_zstd
from bundler.graph import ModuleGraph
from bundler.engine_demo_transport import descriptor_path, publish_transport, read_descriptor, read_transport_file, transport_paths

ROOT = Path(__file__).resolve().parents[2]
_RUNNER_SPEC = importlib.util.spec_from_file_location('sdk_acceptance_test_helpers', ROOT / 'tests/run_sdk_acceptance.py')
runner = importlib.util.module_from_spec(_RUNNER_SPEC)
_RUNNER_SPEC.loader.exec_module(runner)


def write(root, relative, payload):
    path = Path(root) / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload.encode('utf-8') if isinstance(payload, str) else payload)
    return path


def inventory(root):
    return {path.relative_to(root).as_posix(): {'bytes': path.stat().st_size,
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
            for path in sorted(Path(root).rglob('*')) if path.is_file() and path.name != 'manifest.json'}


def docs_contract_fixture(root):
    """Copy the actual canonical inputs consumed by the shipped docs validator."""
    for name in sdk_module.SDK_DOCS_VALIDATION_INPUTS:
        write(root, name, (ROOT / name).read_bytes())
    return {name: name for name in sdk_module.SDK_DOCS_VALIDATION_INPUTS}


def hls_fixture(root):
    """Make a local distribution with the same file and byte-pin contracts."""
    files = {'hls.mjs': 'export default class Hls {}\n',
             'hls.worker.js': 'self.onmessage = event => self.postMessage(event.data);\n',
             'LICENSE': 'SPDX-License-Identifier: Apache-2.0\n',
             'distribution-metadata.json': json.dumps({'name': 'hls.js', 'version': '1.7.3',
                                                       'license': 'Apache-2.0'}) + '\n'}
    records = []
    for name, source in files.items():
        payload = source.encode('utf-8')
        write(root, 'vendor/hls.js/' + name, payload)
        records.append({'path': name, 'byteLength': len(payload),
                        'sha256': hashlib.sha256(payload).hexdigest()})
    provenance = {'package': 'hls.js', 'version': '1.7.3', 'files': records}
    write(root, 'vendor/hls.js/provenance.json', json.dumps(provenance) + '\n')
    return tuple('vendor/hls.js/' + name for name in (*files, 'provenance.json'))


def runtime_fixture(root, profile='engine', *, multipart=False, shader=False, runtime_bytes=None):
    """Use real gzip, SRI and provenance identities rather than transport mocks."""
    name = f'particle-{profile}'
    sources = {'engine/EngineBootstrap.js': 'export const vec3 = (x,y,z) => [x,y,z];\n'}
    entries = ['engine/EngineBootstrap.js']
    namespaces = []
    if profile == 'platform':
        sources['webgpu-os/.bundled-os-content.generated.js'] = 'export const content = 41;\n'
        entries.append('webgpu-os/.bundled-os-content.generated.js')
        namespaces = ['WebGPUOSContent']
    if shader:
        sources['engine/shaders/FixtureShader.js'] = 'export default `\n// preserve authored comment\n@compute @workgroup_size(1) fn main() {}\n`;\n'
        sources['engine/EngineBootstrap.js'] += "export { default as fixtureShader } from './shaders/FixtureShader.js';\n"
    normalized = {path: preprocess_shader_source(source) if is_shader_file(path) else source
                  for path, source in sources.items()}
    runtime = (runtime_bytes if runtime_bytes is not None else
               b'globalThis.PE={vec3:(x,y,z)=>[x,y,z],WebGPUOSContent:{content:41}};')
    compressed = gzip.compress(runtime, mtime=0)
    sri = 'sha384-' + base64.b64encode(hashlib.sha384(runtime).digest()).decode('ascii')
    manifest = {'name': name, 'target': profile, 'version': '1.0.0',
                'entries': entries, 'files': sorted(sources), 'modules': len(sources),
                'public_namespaces': namespaces, 'file_inventory_sha256': _inventory_sha256(sources),
                'source_content_sha256': sdk_module._source_digest(normalized),
                'production': True, 'eager': False, 'obfuscate': False, 'encrypt': False,
                'browser_runtime': name + '.min.js.gz', 'browser_runtime_integrity': sri,
                'browser_runtime_decoded_bytes': len(runtime), 'browser_runtime_bytes': len(compressed),
                'gzip_bytes': len(compressed), 'brotli_bytes': 0, 'zstd_bytes': 0, 'lzma_bytes': 0,
                'sri': sri, 'physicsAssets': [], 'computeAssets': [], 'officialPackageAssets': []}
    for relative, source in sources.items():
        write(root, relative, source)
    dist = Path(root) / 'dist'
    write(dist, name + '.js', runtime)
    write(dist, name + '.min.js', runtime)
    write(dist, name + '.min.js.gz', compressed)
    write(dist, name + '.min.js.sri', sri + '\n')
    if multipart:
        from bundler.runtime_transport import plan_compressed_artifact_parts
        records, parts = plan_compressed_artifact_parts(manifest['browser_runtime'], compressed,
                                                       max_file_bytes=32, part_bytes=32)
        manifest['compressed_artifact_parts'] = {manifest['browser_runtime']: records}
        for relative, payload in parts.items():
            write(dist, relative, payload)
        (dist / manifest['browser_runtime']).unlink()
    provenance = _build_runtime_provenance(manifest, runtime, compressed)
    provenance_bytes = (json.dumps(provenance, indent=2) + '\n').encode('utf-8')
    write(dist, name + '.provenance.json', provenance_bytes)
    manifest['provenance'] = {'path': name + '.provenance.json',
        'sha256': hashlib.sha256(provenance_bytes).hexdigest(), 'predicate_type': provenance['predicateType']}
    write(dist, name + '.manifest.json', json.dumps(manifest, indent=2) + '\n')
    return manifest, sources


def sdk_fixture(root, profile='engine', *, multipart=False):
    manifest, sources = runtime_fixture(root, profile, multipart=multipart)
    receipt = {'format': 'particle-sdk-manifest/v1', 'schema_version': 1,
               'name': f'particle-{profile}-sdk', 'target': profile, 'profile': profile,
               'version': manifest['version'], 'bundle': manifest,
               'publicEntrypoints': {entry: ('PE' if entry.startswith('engine/') else 'PE.WebGPUOSContent')
                                    for entry in manifest['entries']},
               'buildInputsSha256': hashlib.sha256(b'fixture').hexdigest(),
               'tools': {}, 'validation': {}, 'metrics': {}, 'files': inventory(root)}
    write(root, 'manifest.json', json.dumps(receipt, indent=2) + '\n')
    create_release_site_archive(root, Path(root).parent / (receipt['name'] + '.zip'))
    return receipt, sources


class TestHlsRuntimeDistribution(unittest.TestCase):
    def test_document_and_guest_delivery_share_the_verified_native_distribution(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            names = set(hls_fixture(root))
            self.assertEqual(dict(sdk_module.site.hls_runtime_asset_manifest(root)), {name: name for name in names})
            with mock.patch.object(sdk_module.site, 'DOCUMENT_RUNTIME_REQUIRED_PATHS', ()), \
                    mock.patch.object(sdk_module.site, 'DOCUMENT_RUNTIME_WORKER_ENTRIES', ()), \
                    mock.patch.object(sdk_module.site, 'DOCUMENT_RUNTIME_ASSET_DIRECTORIES', ()):
                documents = dict(sdk_module.site.document_runtime_asset_manifest(root))
                self.assertEqual(documents, {name: name for name in names})
                self.assertFalse((root / 'webgpu-os').exists())
            write(root, 'webgpu-os/watch-party-boot.js', 'export {};\n')
            write(root, 'webgpu-os/watch-party.html', '<!doctype html><title>Guest</title>')
            write(root, 'webgpu-os/watch-party.css', 'body { margin: 0; }')
            write(root, 'engine/media/LiveAudioWorklet.js',
                  "registerProcessor('fixture', class extends AudioWorkletProcessor { process() { return true; } });\n")
            write(root, 'engine/media/codecs/CodecWorker.js',
                  'self.onmessage = event => self.postMessage(event.data);\n')
            guest = dict(sdk_module.site.watch_party_runtime_asset_manifest(root))
            self.assertTrue(names.issubset(guest))
            destination = root / 'published'
            sdk_module.site.lay_down_watch_party_runtime_assets(root, destination)
            for name in names:
                self.assertEqual((destination / name).read_bytes(), (root / name).read_bytes())
            (destination / 'vendor/hls.js/LICENSE').write_text('tampered license', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'HLS runtime bytes do not match provenance: LICENSE'):
                sdk_module.site.validate_watch_party_deployment(destination)

    def test_native_distribution_rejects_missing_worker_and_invalid_provenance(self):
        for change in ('missing-worker', 'corrupt-worker', 'metadata-identity', 'duplicate-record',
                       'unsafe-record', 'nonobject-record', 'nonobject-proof', 'boolean-size'):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                hls_fixture(root)
                directory = root / 'vendor/hls.js'
                provenance = json.loads((directory / 'provenance.json').read_text())
                if change == 'missing-worker':
                    (directory / 'hls.worker.js').unlink()
                elif change == 'corrupt-worker':
                    path = directory / 'hls.worker.js'
                    path.write_bytes(path.read_bytes().replace(b'event.data', b'event.fail'))
                elif change == 'metadata-identity':
                    metadata = directory / 'distribution-metadata.json'
                    metadata.write_text(json.dumps({'name': 'hls.js', 'version': 'other', 'license': 'Apache-2.0'}))
                else:
                    if change == 'duplicate-record':
                        provenance['files'][-1] = provenance['files'][0]
                    elif change == 'unsafe-record':
                        provenance['files'][0]['path'] = '../hls.mjs'
                    elif change == 'nonobject-record':
                        provenance['files'][0] = []
                    elif change == 'nonobject-proof':
                        provenance = []
                    elif change == 'boolean-size':
                        provenance['files'][0]['byteLength'] = True
                    (directory / 'provenance.json').write_text(json.dumps(provenance), encoding='utf-8')
                with self.assertRaises((FileNotFoundError, ValueError)):
                    sdk_module.site.hls_runtime_asset_manifest(root)


class TestSdkInputIdentity(unittest.TestCase):
    def test_docs_validation_contracts_are_required_hashed_inputs_for_both_profiles(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in ('bundle_engine.py', 'release_targets.json', 'LICENSE', 'NOTICE.md', 'AUTHORS',
                         'SECURITY.md', 'SUPPORT.md', 'CHANGELOG.md'):
                write(root, name, name)
            contracts = docs_contract_fixture(root)
            write(root, 'webgpu-os/browser-extension-store/privacy.html', '<title>Privacy</title>')
            with ExitStack() as patches:
                for name in ('release_site_sidecar_asset_manifest', 'document_runtime_asset_manifest',
                             '_morphfield_schema_sources', 'stable_network_resource_repository_paths'):
                    patches.enter_context(mock.patch.object(sdk_module.site, name, return_value=[]))
                for name in ('WEBGPU_OS_RUNTIME_ASSET_PATHS', 'WEBGPU_OS_PWA_ASSET_PATHS',
                             'WEBGPU_OS_SHELL_ASSET_COPIES', 'ENGINE_DEMO_RUNTIME_ASSET_COPIES'):
                    patches.enter_context(mock.patch.object(sdk_module.site, name, ()))
                patches.enter_context(mock.patch.object(sdk_module, 'physics_release_asset_paths', return_value=[]))
                for profile in ('engine', 'platform'):
                    snapshot = sdk_module.sdk_input_snapshot(root, profile)
                    for name, source in contracts.items():
                        with self.subTest(profile=profile, input=name):
                            self.assertEqual(snapshot['mapping'][name], source)
                            self.assertEqual(snapshot['records'][name],
                                             {'source': source, **sdk_module._file_record(ROOT / source)})
                            original = (root / source).read_bytes()
                            write(root, source, original + b'\n<!-- changed website contract -->\n')
                            self.assertNotEqual(sdk_module.sdk_input_digest(root, profile), snapshot['sha256'])
                            with self.assertRaisesRegex(ValueError, 'SDK input changed during assembly: ' + name):
                                sdk_module._verify_snapshot(root, snapshot)
                            write(root, source, original)
                            self.assertEqual(sdk_module.sdk_input_digest(root, profile), snapshot['sha256'])
                            (root / source).unlink()
                            with self.assertRaisesRegex(FileNotFoundError, 'Required SDK input is missing: ' + name):
                                sdk_module.sdk_input_file_map(root, profile)
                            with self.assertRaises(FileNotFoundError):
                                sdk_module.sdk_input_digest(root, profile)
                            write(root, source, original)
                    sdk_module._verify_snapshot(root, snapshot)

    def test_transitive_external_modules_ancestor_licenses_and_raw_kaolin_are_build_inputs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in ('bundle_engine.py', 'release_targets.json', 'LICENSE', 'NOTICE.md', 'AUTHORS',
                         'SECURITY.md', 'SUPPORT.md', 'CHANGELOG.md'):
                write(root, name, name)
            docs_contract_fixture(root)
            sources = {
                'engine/EngineBootstrap.js': "export { value } from '../vendor/browser-kit/main.mjs';\n",
                'vendor/browser-kit/main.mjs': "export { value } from './core/leaf.mjs';\n",
                'vendor/browser-kit/core/leaf.mjs': 'export const value = 31;\n',
                'vendor/browser-kit/LICENSE': 'SPDX-License-Identifier: Apache-2.0\n',
                'vendor/browser-kit/core/COPYRIGHT.txt': 'Fixture author\n',
                'vendor/NOTICE.vendor': 'Browser kit attribution\n',
                'engine/kaolin/index.js': "export { area } from './ops/MeshOps.js';\n",
                'engine/kaolin/ops/MeshOps.js': 'export function area(width, height) { return width * height; }\n',
            }
            for name, source in sources.items():
                write(root, name, source)
            graph = ModuleGraph(root)
            graph.walk('engine/EngineBootstrap.js')
            self.assertEqual(graph.errors, [])
            module_ids = tuple(graph.mod_id(path) for path in graph.order)
            self.assertIn('vendor/browser-kit/core/leaf.mjs', module_ids)
            self.assertNotIn('engine/kaolin/index.js', module_ids)
            with mock.patch.object(sdk_module.site, 'release_site_sidecar_asset_manifest', return_value=[]), \
                    mock.patch.object(sdk_module.site, 'document_runtime_asset_manifest', return_value=[]), \
                    mock.patch.object(sdk_module, 'physics_release_asset_paths', return_value=[]), \
                    mock.patch.object(sdk_module.site, '_morphfield_schema_sources', return_value=[]):
                baseline = sdk_module.sdk_input_snapshot(root, 'engine', module_ids)
                for name in sources:
                    self.assertEqual(baseline['mapping'][name], name)
                sdk_module._verify_snapshot(root, baseline)
                for name in sources:
                    with self.subTest(input=name):
                        original = (root / name).read_bytes()
                        write(root, name, original + b'\n// changed build input\n')
                        self.assertNotEqual(sdk_module.sdk_input_snapshot(root, 'engine', module_ids)['sha256'],
                                            baseline['sha256'])
                        with self.assertRaisesRegex(ValueError, 'SDK input changed during assembly'):
                            sdk_module._verify_snapshot(root, baseline)
                        write(root, name, original)
                        sdk_module._verify_snapshot(root, baseline)

    def test_hls_worker_license_and_provenance_are_inputs_in_both_sdk_profiles(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in ('bundle_engine.py', 'release_targets.json', 'LICENSE', 'NOTICE.md', 'AUTHORS',
                         'SECURITY.md', 'SUPPORT.md', 'CHANGELOG.md'):
                write(root, name, name)
            docs_contract_fixture(root)
            write(root, 'webgpu-os/browser-extension-store/privacy.html', '<title>Privacy</title>')
            names = hls_fixture(root)
            write(root, 'engine/EngineBootstrap.js', "export { default as Hls } from '../vendor/hls.js/hls.mjs';\n")
            with ExitStack() as patches:
                for name in ('DOCUMENT_RUNTIME_REQUIRED_PATHS', 'DOCUMENT_RUNTIME_WORKER_ENTRIES',
                             'DOCUMENT_RUNTIME_ASSET_DIRECTORIES', 'WEBGPU_OS_RUNTIME_ASSET_PATHS',
                             'WEBGPU_OS_PWA_ASSET_PATHS', 'WEBGPU_OS_SHELL_ASSET_COPIES',
                             'ENGINE_DEMO_RUNTIME_ASSET_COPIES'):
                    patches.enter_context(mock.patch.object(sdk_module.site, name, ()))
                for name in ('release_site_sidecar_asset_manifest', '_morphfield_schema_sources',
                             'stable_network_resource_repository_paths'):
                    patches.enter_context(mock.patch.object(sdk_module.site, name, return_value=[]))
                patches.enter_context(mock.patch.object(sdk_module, 'physics_release_asset_paths', return_value=[]))
                for profile in ('engine', 'platform'):
                    with self.subTest(profile=profile):
                        snapshot = sdk_module.sdk_input_snapshot(root, profile, ('engine/EngineBootstrap.js',
                                                                               'vendor/hls.js/hls.mjs'))
                        for name in names:
                            self.assertEqual(snapshot['mapping'][name], name)
                        sdk_module._verify_snapshot(root, snapshot)
                        worker = root / 'vendor/hls.js/hls.worker.js'
                        payload = worker.read_bytes()
                        worker.write_bytes(payload.replace(b'event.data', b'event.fail'))
                        with self.assertRaisesRegex(ValueError, 'HLS runtime bytes do not match provenance'):
                            sdk_module.sdk_input_snapshot(root, profile)
                        worker.write_bytes(payload)

    def test_real_input_inventory_uses_canonical_aliases_and_excludes_generated_kit_inputs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in ('bundle_engine.py', 'release_targets.json', 'LICENSE', 'NOTICE.md', 'AUTHORS',
                         'SECURITY.md', 'SUPPORT.md', 'CHANGELOG.md'):
                write(root, name, name)
            docs_contract_fixture(root)
            canonical = 'plauna/styles/plauna.css'
            alias = 'webgpu-os/styles/plauna.css'
            privacy = 'webgpu-os/browser-extension-store/privacy.html'
            privacy_alias = 'webgpu-os/companion-privacy.html'
            worker = 'engine/sim/particles/SnapshotWorker.js'
            shim = 'editor/SnapshotWorker.js'
            native_adapter = 'engine/sim/physics/physx-pe.mjs'
            generated_adapter = 'webgpu-os/assets/engine-demo/physx-pe.mjs'
            generated_kit = 'webgpu-os/assets/engine-demo/' + sdk_module.site.ENGINE_DEMO_RUNTIME_KIT_MANIFEST
            generated_starter = 'webgpu-os/' + sdk_module.site.ENGINE_DEMO_STARTER_ARCHIVE_PATH
            generated_transport = 'webgpu-os/assets/engine-demo/particle-platform.min.js.gz.transport.json'
            generated_starter_transport = generated_starter + '.transport.json'
            generated_part = 'webgpu-os/assets/engine-demo/particle-platform.min.js.gz.' + 'a' * 24 + '.part-0000.bin'
            generated_nested_metadata = 'webgpu-os/assets/engine-demo/previous/build/receipt.json'
            generated_nested_module = 'webgpu-os/assets/engine-demo/previous/build/stale.js'
            for name, payload in ((canonical, ':root { --canonical: 1; }'), (alias, 'stale delivery CSS'),
                    (privacy, '<title>Canonical privacy</title>'), (privacy_alias, 'stale delivery privacy'),
                    (worker, 'export {};'), (shim, "import './missing.js';"),
                    (native_adapter, 'export {};'), (generated_adapter, 'stale generated adapter'),
                    (generated_kit, '{"oldCandidate":true}'), (generated_starter, b'previous starter bytes'),
                    (generated_transport, '{"parts":[{"src":"missing-old-part.bin"}]}'),
                    (generated_starter_transport, '{"oldStarter":true}'), (generated_part, b'old runtime part'),
                    (generated_nested_metadata, '{"oldBuild":true}'), (generated_nested_module, 'export const oldBuild = true;')):
                write(root, name, payload)
            generated = (shim, generated_adapter, generated_kit, generated_starter, generated_transport,
                         generated_starter_transport, generated_part, generated_nested_metadata, generated_nested_module)
            with mock.patch.object(sdk_module.site, 'release_site_sidecar_asset_manifest',
                                   return_value=[(worker, shim)]), \
                    mock.patch.object(sdk_module.site, 'document_runtime_asset_manifest', return_value=[]), \
                    mock.patch.object(sdk_module, 'physics_release_asset_paths', return_value=[]), \
                    mock.patch.object(sdk_module.site, '_morphfield_schema_sources', return_value=[]), \
                    mock.patch.object(sdk_module.site, 'WEBGPU_OS_RUNTIME_ASSET_PATHS', ()), \
                    mock.patch.object(sdk_module.site, 'WEBGPU_OS_PWA_ASSET_PATHS', ()), \
                    mock.patch.object(sdk_module.site, 'WEBGPU_OS_SHELL_ASSET_COPIES', ((canonical, alias),)), \
                    mock.patch.object(sdk_module.site, 'stable_network_resource_repository_paths', return_value=[]), \
                    mock.patch.object(sdk_module.site, 'ENGINE_DEMO_RUNTIME_ASSET_COPIES',
                                      ((native_adapter, 'physx-pe.mjs'),)):
                mapping = sdk_module.sdk_input_file_map(root, 'platform')
                self.assertEqual(mapping[canonical], canonical)
                self.assertEqual(mapping[alias], canonical)
                self.assertEqual(mapping[privacy_alias], privacy)
                self.assertEqual(mapping[worker], worker)
                for name in generated:
                    self.assertNotIn(name, mapping)
                before = sdk_module.sdk_input_digest(root, 'platform')
                for name in (alias, privacy_alias, *generated):
                    write(root, name, 'changed previous delivery output')
                self.assertEqual(sdk_module.sdk_input_digest(root, 'platform'), before)
                write(root, canonical, ':root { --canonical: 2; }')
                self.assertNotEqual(sdk_module.sdk_input_digest(root, 'platform'), before)

    def test_engine_input_inventory_replays_discovery_from_only_copied_inputs(self):
        metadata = 'webgpu-os/factory/apps/ambient-studio/AmbientCollectionCatalog.js'
        shared = sdk_module.site.release_site_sidecar_asset_manifest(ROOT)
        self.assertIn((metadata, metadata), shared)
        mapping = sdk_module.sdk_input_file_map(ROOT, 'engine')
        self.assertEqual(mapping[metadata], metadata)
        with tempfile.TemporaryDirectory(prefix='sdk-input-closure-') as temporary:
            root = Path(temporary)
            for destination, source in mapping.items():
                path = root / destination
                path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / source, path)
            self.assertFalse((root / 'webgpu-os/index.html').exists())
            snapshot = sdk_module.sdk_input_snapshot(root, 'engine')
            self.assertEqual(snapshot['mapping'], mapping)
            catalog = root / metadata
            original = catalog.read_bytes()
            catalog.write_bytes(original + b'\n// Edited preview discovery input.\n')
            self.assertNotEqual(sdk_module.sdk_input_digest(root, 'engine'), snapshot['sha256'])
            with self.assertRaisesRegex(ValueError, 'SDK input changed during assembly: .*AmbientCollectionCatalog'):
                sdk_module._verify_snapshot(root, snapshot)
            catalog.write_bytes(original)
            self.assertEqual(sdk_module.sdk_input_digest(root, 'engine'), snapshot['sha256'])
            catalog.unlink()
            with self.assertRaisesRegex(FileNotFoundError, 'AmbientCollectionCatalog'):
                sdk_module.sdk_input_file_map(root, 'engine')

    def test_docs_examples_assets_licenses_and_build_tools_invalidate_input_identity(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            mapping = {name: name for name in (
                'MD/engine/overview.md', 'sdk-examples/main.js', 'assets/table.json',
                'LICENSE', 'bundler/config.py', 'engine/main.js')}
            for name in mapping:
                write(root, name, name)
            with mock.patch.object(sdk_module, 'sdk_input_file_map', return_value=mapping):
                baseline = sdk_module.sdk_input_digest(root, 'engine')
                for name in mapping:
                    with self.subTest(name=name):
                        original = (root / name).read_bytes()
                        write(root, name, original + b' changed')
                        self.assertNotEqual(sdk_module.sdk_input_digest(root, 'engine'), baseline)
                        write(root, name, original)
                        self.assertEqual(sdk_module.sdk_input_digest(root, 'engine'), baseline)

    def test_input_digest_is_independent_of_mapping_iteration_order(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in ('engine/a.js', 'engine/b.js'):
                write(root, name, 'export {};')
            with mock.patch.object(sdk_module, 'sdk_input_file_map', return_value={
                    'engine/a.js': 'engine/a.js', 'engine/b.js': 'engine/b.js'}):
                first = sdk_module.sdk_input_digest(root, 'engine')
            with mock.patch.object(sdk_module, 'sdk_input_file_map', return_value={
                    'engine/b.js': 'engine/b.js', 'engine/a.js': 'engine/a.js'}):
                self.assertEqual(sdk_module.sdk_input_digest(root, 'engine'), first)

    def test_snapshot_rejects_source_changes_between_inventory_and_copy(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write(root, 'engine/main.js', 'export const value = 1;')
            with mock.patch.object(sdk_module, 'sdk_input_file_map', return_value={
                    'engine/main.js': 'engine/main.js'}):
                snapshot = sdk_module.sdk_input_snapshot(root, 'engine')
                sdk_module._verify_snapshot(root, snapshot)
                write(root, 'engine/main.js', 'export const value = 2;')
                with self.assertRaisesRegex(ValueError, 'SDK input changed during assembly'):
                    sdk_module._verify_snapshot(root, snapshot)

    def test_snapshot_rejects_introduced_and_removed_inputs_between_inventory_and_copy(self):
        for change in ('introduced', 'removed'):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                write(root, 'engine/main.js', 'export const value = 1;')

                def module_inventory(source_root, _target, _manifest_files=()):
                    return {path.relative_to(source_root).as_posix(): path.relative_to(source_root).as_posix()
                            for path in Path(source_root).rglob('*.js')}

                with mock.patch.object(sdk_module, 'sdk_input_file_map', side_effect=module_inventory):
                    snapshot = sdk_module.sdk_input_snapshot(root, 'engine')
                    sdk_module._verify_snapshot(root, snapshot)
                    if change == 'introduced':
                        write(root, 'engine/added.js', 'export const added = true;')
                    else:
                        (root / 'engine/main.js').unlink()
                    with self.assertRaisesRegex(ValueError, 'SDK input membership changed during assembly'):
                        sdk_module._verify_snapshot(root, snapshot)

    def test_sdk_inputs_invalidate_release_cache_when_website_generation_is_disabled(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            doc = 'MD/guides/sdk-distribution.md'
            write(root, doc, 'original SDK documentation')
            with mock.patch.object(sdk_module, 'sdk_input_file_map', return_value={doc: doc}):
                ordinary = cli_module._release_build_input_digest(root, include_site=False, include_sdk=False)
                sdk = cli_module._release_build_input_digest(root, include_site=False, include_sdk=True)
                write(root, doc, 'changed SDK documentation')
                self.assertEqual(cli_module._release_build_input_digest(root, include_site=False, include_sdk=False), ordinary)
                self.assertNotEqual(cli_module._release_build_input_digest(root, include_site=False, include_sdk=True), sdk)


class TestSdkCandidateEngineDemo(unittest.TestCase):
    def test_candidate_kit_and_starter_publish_current_multipart_runtime_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'source'
            stage = Path(temporary) / 'stage'
            candidate_source = ''.join(hashlib.sha256(str(index).encode()).hexdigest() for index in range(256))
            runtime = ('globalThis.PE={vec3:(x,y,z)=>[x,y,z]};\n'
                       'globalThis.candidateBuild=' + json.dumps(candidate_source) + ';').encode('utf-8')
            manifest, _sources = runtime_fixture(root, 'platform', runtime_bytes=runtime)
            release = root / 'dist'
            expected_runtime = (release / 'particle-platform.min.js.gz').read_bytes()
            write(stage, 'engine/sim/physics/physx-pe.wasm', b'\x00asm\x01\x00\x00\x00')
            for source, name in sdk_module.site.ENGINE_DEMO_RUNTIME_ASSET_COPIES:
                if name not in {'release-runtime-loader.js', 'physx-pe.wasm'} and not name.startswith('particle-platform.'):
                    write(root, source, (ROOT / source).read_bytes())
            stale_runtime = root / 'webgpu-os/assets/engine-demo/particle-platform.min.js.gz'
            write(root, stale_runtime.relative_to(root).as_posix(), b'old generated runtime' * 40)
            publish_transport(stale_runtime, 64)
            stale_record = read_descriptor(stale_runtime)
            self.assertNotEqual(stale_record['sha256'], hashlib.sha256(expected_runtime).hexdigest())
            with mock.patch.object(sdk_module.site, 'CLOUDFLARE_PAGES_MAX_FILE_BYTES', 2048), \
                    mock.patch.object(sdk_module.site, '_validate_engine_demo_runtime_kit', return_value={}) as validate_kit:
                sdk_module._write_candidate_engine_demo(stage, root, release, manifest)
            self.assertEqual(validate_kit.call_count, 2)
            destination = stage / 'webgpu-os/assets/engine-demo'
            current_runtime = destination / 'particle-platform.min.js.gz'
            runtime_record = read_descriptor(current_runtime)
            self.assertTrue(runtime_record['parts'])
            self.assertFalse(current_runtime.exists())
            self.assertEqual(read_transport_file(current_runtime), expected_runtime)
            self.assertEqual(runtime_record['sha256'], hashlib.sha256(expected_runtime).hexdigest())
            self.assertNotEqual(runtime_record['sha256'], stale_record['sha256'])
            self.assertTrue(all(path.is_file() for path in transport_paths(current_runtime)))
            self.assertTrue(all(path.stat().st_size <= 2048 for path in transport_paths(current_runtime)[1:]))
            starter = stage / 'webgpu-os' / sdk_module.site.ENGINE_DEMO_STARTER_ARCHIVE_PATH
            starter_record = read_descriptor(starter)
            self.assertTrue(starter_record['parts'])
            self.assertFalse(starter.exists())
            self.assertTrue(all(path.is_file() for path in transport_paths(starter)))
            sdk_module.site._validate_engine_demo_starter_archive(starter, destination)
            with zipfile.ZipFile(io.BytesIO(read_transport_file(starter))) as archive:
                self.assertEqual(archive.read('particle-platform.min.js.gz'), expected_runtime)
                self.assertEqual(archive.read('particle-platform.manifest.json'),
                                 (release / 'particle-platform.manifest.json').read_bytes())
                self.assertEqual(archive.read('particle-platform.provenance.json'),
                                 (release / 'particle-platform.provenance.json').read_bytes())
                kit = json.loads(archive.read(sdk_module.site.ENGINE_DEMO_RUNTIME_KIT_MANIFEST))
                gzip_inventory = next(item for item in kit['files'] if item['path'] == 'particle-platform.min.js.gz')
                self.assertEqual(gzip_inventory['sha256'], runtime_record['sha256'])
                self.assertEqual(gzip_inventory['bytes'], len(expected_runtime))
            part = transport_paths(current_runtime)[1]
            payload = part.read_bytes()
            part.write_bytes(bytes([payload[0] ^ 1]) + payload[1:])
            with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
                read_transport_file(current_runtime)
            with self.assertRaises((ValueError, FileNotFoundError)):
                sdk_module.site._validate_engine_demo_starter_archive(starter, destination)
            part.write_bytes(payload)
            sdk_module.site._validate_engine_demo_starter_archive(starter, destination)


class TestSdkVerification(unittest.TestCase):
    def test_engine_and_generated_platform_entry_use_manifest_runtime_names(self):
        for profile in ('engine', 'platform'):
            with self.subTest(profile=profile), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary) / (profile + '-sdk')
                expected, _ = sdk_fixture(root, profile)
                receipt = sdk_module.verify_sdk(root)
                self.assertEqual(receipt['bundle']['name'], f'particle-{profile}')
                self.assertEqual(receipt['files'], expected['files'])
                self.assertTrue(sdk_module.sdk_is_current(root, target=profile))
                self.assertFalse(sdk_module.sdk_is_current(root, target='engine' if profile == 'platform' else 'platform'))

    def test_missing_tampered_or_uninventoried_files_invalidate_sdk_cache(self):
        for kind in ('missing', 'same-size-tamper', 'unlisted'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary) / 'sdk'
                sdk_fixture(root)
                self.assertTrue(sdk_module.sdk_is_current(root))
                if kind == 'missing':
                    (root / 'engine/EngineBootstrap.js').unlink()
                elif kind == 'same-size-tamper':
                    path = root / 'engine/EngineBootstrap.js'
                    write(root, path.relative_to(root), path.read_bytes().replace(b'[x,y,z]', b'[z,y,x]'))
                else:
                    write(root, 'engine/unlisted.js', 'export {};')
                with self.assertRaises((ValueError, RuntimeError, FileNotFoundError)):
                    sdk_module.verify_sdk(root)
                self.assertFalse(sdk_module.sdk_is_current(root))

    def test_multipart_runtime_is_verified_and_missing_part_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'sdk'
            receipt, _ = sdk_fixture(root, multipart=True)
            sdk_module.verify_sdk(root)
            self.assertTrue(sdk_module.sdk_is_current(root))
            part = receipt['bundle']['compressed_artifact_parts'][receipt['bundle']['browser_runtime']][0]['src']
            (root / 'dist' / part).unlink()
            with self.assertRaises((ValueError, RuntimeError, FileNotFoundError)):
                sdk_module.verify_sdk(root)
            self.assertFalse(sdk_module.sdk_is_current(root))

    def test_receipt_edit_cannot_hide_broken_source_import_closure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'sdk'
            receipt, sources = sdk_fixture(root)
            sources['engine/EngineBootstrap.js'] += "export { missing } from './absent.js';\n"
            write(root, 'engine/EngineBootstrap.js', sources['engine/EngineBootstrap.js'])
            receipt['bundle']['source_content_sha256'] = sdk_module._source_digest(sources)
            write(root, 'dist/particle-engine.manifest.json', json.dumps(receipt['bundle'], indent=2) + '\n')
            receipt['files'] = inventory(root)
            write(root, 'manifest.json', json.dumps(receipt, indent=2) + '\n')
            with self.assertRaises((ValueError, RuntimeError, FileNotFoundError)):
                sdk_module.verify_sdk(root)

    def test_provenance_and_sri_must_match_decoded_runtime_even_after_receipt_rehash(self):
        for field in ('sri', 'provenance'):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary) / 'sdk'
                receipt, _ = sdk_fixture(root)
                if field == 'sri':
                    write(root, 'dist/particle-engine.min.js.sri', 'sha384-' + 'A' * 64 + '\n')
                else:
                    path = root / 'dist/particle-engine.provenance.json'
                    proof = json.loads(path.read_text(encoding='utf-8'))
                    proof['subject'][0]['digest']['sha256'] = '0' * 64
                    write(root, path.relative_to(root), json.dumps(proof, indent=2) + '\n')
                    receipt['bundle']['provenance']['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
                    write(root, 'dist/particle-engine.manifest.json', json.dumps(receipt['bundle'], indent=2) + '\n')
                receipt['files'] = inventory(root)
                write(root, 'manifest.json', json.dumps(receipt, indent=2) + '\n')
                with self.assertRaises((ValueError, RuntimeError)):
                    sdk_module.verify_sdk(root)

    def test_uncompressed_runtime_corruption_rejects_verification_after_receipt_rehash(self):
        for extension, message in (('.min.js', 'minified runtime differs'), ('.js', 'source runtime size differs')):
            with self.subTest(extension=extension), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary) / 'sdk'
                receipt, _ = sdk_fixture(root)
                manifest = receipt['bundle']
                manifest['bundle_bytes'] = (root / 'dist/particle-engine.js').stat().st_size
                path = root / ('dist/particle-engine' + extension)
                payload = path.read_bytes()
                write(root, path.relative_to(root), payload.replace(b'[x,y,z]', b'[z,y,x]')
                      if extension == '.min.js' else payload + b'\n// stale source runtime\n')
                write(root, 'dist/particle-engine.manifest.json', json.dumps(manifest, indent=2) + '\n')
                receipt['files'] = inventory(root)
                write(root, 'manifest.json', json.dumps(receipt, indent=2) + '\n')
                with self.assertRaisesRegex(ValueError, message):
                    sdk_module.verify_sdk(root)
                self.assertFalse(sdk_module.sdk_is_current(root))

    def test_registry_hash_must_match_provenance_and_prepared_registry_after_receipt_rehash(self):
        preamble = 'globalThis.__OS_OFFICIAL_PACKAGES__=\n {"owner":{"container":"signed bytes"}} \n;'
        actual_hash = hashlib.sha256(preamble.encode('utf-8')).hexdigest()
        for provenance_hash, message, prepares in (
                (actual_hash, 'differs from its build provenance', 0),
                ('0' * 64, 'differs from its supplied public registry', 2)):
            with self.subTest(provenance_hash=provenance_hash), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary) / 'sdk'
                receipt, _ = sdk_fixture(root, 'platform')
                manifest = receipt['bundle']
                manifest.update(buildTools={'fixture': True}, signedRegistrySha256='0' * 64)
                runtime = (root / 'dist/particle-platform.min.js').read_bytes()
                compressed = (root / 'dist/particle-platform.min.js.gz').read_bytes()
                proof = _build_runtime_provenance(manifest, runtime, compressed)
                proof['predicate']['buildDefinition']['internalParameters']['signedRegistrySha256'] = provenance_hash
                path = write(root, 'dist/particle-platform.provenance.json', json.dumps(proof, indent=2) + '\n')
                manifest['provenance']['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
                write(root, 'dist/particle-platform.manifest.json', json.dumps(manifest, indent=2) + '\n')
                receipt['files'] = inventory(root)
                write(root, 'manifest.json', json.dumps(receipt, indent=2) + '\n')
                with mock.patch.object(rebuild_module, 'prepare_sdk_rebuild',
                                       return_value={'official_preamble': preamble}) as prepare:
                    with self.assertRaisesRegex(ValueError, message):
                        sdk_module.verify_sdk(root)
                    self.assertFalse(sdk_module.sdk_is_current(root))
                self.assertEqual(prepare.call_count, prepares)

    def test_signed_pretty_registry_normalization_matches_rebuild_preamble_exactly(self):
        from bundler.official_inventory import OFFICIAL_PACKAGE_ASSIGNMENT
        from bundler.tests.test_sdk_rebuild import SDKRebuildTests

        fixture = SDKRebuildTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        original, _app = fixture._platform_fixture()
        pretty = b'\r\n  ' + json.dumps(json.loads(original), indent=2).encode('utf-8') + b' \r\n'
        supplied = b'// Authorized public registry\r\n/* reviewed */\r\n' + \
            OFFICIAL_PACKAGE_ASSIGNMENT.encode('utf-8') + pretty + b';\r\n'
        raw, records = rebuild_module._registry_bytes(supplied)
        canonical = OFFICIAL_PACKAGE_ASSIGNMENT + raw.decode('utf-8') + ';'
        with mock.patch.object(rebuild_module, 'verify_compute_artifacts'):
            prepared = rebuild_module.prepare_sdk_rebuild(fixture.root, 'platform', supplied_registry=supplied)
        self.assertEqual(raw, pretty)
        self.assertEqual(list(records), list(json.loads(original)))
        self.assertEqual(prepared['official_preamble'], canonical)
        self.assertEqual(hashlib.sha256(prepared['official_preamble'].encode('utf-8')).hexdigest(),
                         hashlib.sha256(canonical.encode('utf-8')).hexdigest())
        self.assertEqual((fixture.root / rebuild_module.SDK_REGISTRY_FILENAME).read_bytes(), original)

    def test_invalid_deflate_runtime_becomes_a_verification_error_and_invalidates_cache(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'sdk'
            receipt, _ = sdk_fixture(root)
            path = root / 'dist' / receipt['bundle']['browser_runtime']
            damaged = bytearray(path.read_bytes())
            damaged[10] |= 6  # RFC 1951 reserves block type 3; the gzip header remains valid.
            with self.assertRaises(zlib.error):
                gzip.decompress(damaged)
            write(root, path.relative_to(root), damaged)
            receipt['files'] = inventory(root)
            write(root, 'manifest.json', json.dumps(receipt, indent=2) + '\n')
            with self.assertRaisesRegex(ValueError, 'SDK gzip runtime is corrupt'):
                sdk_module.verify_sdk(root)
            self.assertFalse(sdk_module.sdk_is_current(root))

    def test_malformed_provenance_shapes_are_rejected_after_receipt_rehash(self):
        changes = {
            'subjects-null': lambda proof: proof.update(subject=None),
            'subject-null': lambda proof: proof.update(subject=[None]),
            'subject-name-list': lambda proof: proof['subject'][0].update(name=[]),
            'subject-digest-list': lambda proof: proof['subject'][0].update(digest=[]),
            'duplicate-subject': lambda proof: proof['subject'].append(proof['subject'][0]),
            'predicate-null': lambda proof: proof.update(predicate=None),
            'definition-list': lambda proof: proof['predicate'].update(buildDefinition=[]),
            'parameters-list': lambda proof: proof['predicate']['buildDefinition'].update(internalParameters=[]),
        }
        for label, alter in changes.items():
            with self.subTest(shape=label), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary) / 'sdk'
                receipt, _ = sdk_fixture(root)
                path = root / 'dist/particle-engine.provenance.json'
                proof = json.loads(path.read_text(encoding='utf-8'))
                alter(proof)
                write(root, path.relative_to(root), json.dumps(proof, indent=2) + '\n')
                receipt['bundle']['provenance']['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
                write(root, 'dist/particle-engine.manifest.json', json.dumps(receipt['bundle'], indent=2) + '\n')
                receipt['files'] = inventory(root)
                write(root, 'manifest.json', json.dumps(receipt, indent=2) + '\n')
                with self.assertRaises(ValueError):
                    sdk_module.verify_sdk(root)
                self.assertFalse(sdk_module.sdk_is_current(root))

    @unittest.skipUnless(HAS_BROTLI and HAS_ZSTD, 'Brotli and Zstd tooling required')
    def test_missing_declared_codec_rejects_verification_and_cache_without_import_crash(self):
        for encoding, extension, package, compressor in (
                ('brotli', '.br', 'brotli', compress_brotli),
                ('zstd', '.zst', 'zstandard', compress_zstd)):
            with self.subTest(encoding=encoding), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary) / 'sdk'
                receipt, _ = sdk_fixture(root)
                runtime = gzip.decompress((root / 'dist/particle-engine.min.js.gz').read_bytes())
                payload = compressor(runtime)
                write(root, 'dist/particle-engine.min.js' + extension, payload)
                receipt['bundle'][encoding + '_bytes'] = len(payload)
                write(root, 'dist/particle-engine.manifest.json', json.dumps(receipt['bundle'], indent=2) + '\n')
                receipt['files'] = inventory(root)
                write(root, 'manifest.json', json.dumps(receipt, indent=2) + '\n')
                sdk_module.verify_sdk(root)
                importer = __import__

                def without_codec(name, *args, **kwargs):
                    if name == package:
                        raise ImportError('SDK acceptance removed the declared codec')
                    return importer(name, *args, **kwargs)

                with mock.patch('builtins.__import__', side_effect=without_codec):
                    with self.assertRaisesRegex(ValueError, 'requires its recorded codec'):
                        sdk_module.verify_sdk(root)
                    self.assertFalse(sdk_module.sdk_is_current(root))

    def test_malformed_zip_deflate_invalidates_cache_without_rejecting_the_valid_tree(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'engine-sdk'
            sdk_fixture(root)
            archive = root.parent / 'particle-engine-sdk.zip'
            create_release_site_archive(root, archive)
            self.assertTrue(sdk_module.sdk_is_current(root, target='engine'))
            with zipfile.ZipFile(archive) as current:
                member = current.getinfo('dist/particle-engine.js')
                self.assertEqual(member.compress_type, zipfile.ZIP_DEFLATED)
            damaged = bytearray(archive.read_bytes())
            name_length, extra_length = struct.unpack_from('<HH', damaged, member.header_offset + 26)
            payload_offset = member.header_offset + 30 + name_length + extra_length
            damaged[payload_offset] |= 6  # RFC 1951 reserves DEFLATE block type 3.
            archive.write_bytes(damaged)
            with zipfile.ZipFile(archive) as current, self.assertRaises(zlib.error):
                current.read(member.filename)
            self.assertEqual(sdk_module.verify_sdk(root)['profile'], 'engine')
            self.assertFalse(sdk_module.sdk_is_current(root, target='engine'))

    def test_archive_parity_and_determinism_bind_the_entire_sdk(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'engine-sdk'
            sdk_fixture(root)
            first, second = root.parent / 'first.zip', root.parent / 'second.zip'
            with mock.patch.dict(os.environ, {'SOURCE_DATE_EPOCH': '1780272000'}):
                create_release_site_archive(root, first)
                for path in root.rglob('*'):
                    if path.is_file():
                        os.utime(path, (1780272999, 1780272999))
                create_release_site_archive(root, second)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            sdk_module.verify_sdk(root, verify_archive=first)
            altered = root.parent / 'altered.zip'
            with zipfile.ZipFile(first) as original, zipfile.ZipFile(altered, 'w') as archive:
                for item in original.infolist():
                    payload = original.read(item.filename)
                    archive.writestr(item, payload + b'x' if item.filename.endswith('.sri') else payload)
            with self.assertRaises((ValueError, RuntimeError)):
                sdk_module.verify_sdk(root, verify_archive=altered)


class TestSdkAssemblyAndPublication(unittest.TestCase):
    def _build_fixture(self, temporary, *, profile='engine', multipart=False, compression=True):
        root, release = Path(temporary) / 'source', Path(temporary) / 'release'
        manifest, sources = runtime_fixture(root, profile, multipart=multipart, shader=True)
        shutil.move(str(root / 'dist'), str(release))
        wasm = 'engine/sim/physics/physx-pe.wasm'
        write(root, wasm, b'\0asm\x01\0\0\0')
        if compression:
            payload = lzma.compress((release / (manifest['name'] + '.min.js')).read_bytes())
            manifest['best_compressed'] = 'gzip'
            manifest['lzma_bytes'] = len(payload)
            write(release, manifest['name'] + '.min.js.xz', payload)
            write(release, manifest['name'] + '.manifest.json', json.dumps(manifest, indent=2) + '\n')
        mapping = {name: name for name in sources if not name.endswith('.generated.js')}
        mapping[wasm] = wasm
        mapping.update(docs_contract_fixture(root))
        for name in sources:
            if name.endswith('.generated.js'):
                (root / name).unlink()
        with mock.patch.object(sdk_module, 'sdk_input_file_map', return_value=mapping):
            snapshot = sdk_module.sdk_input_snapshot(root, profile)
        normalized = {name: preprocess_shader_source(source) if is_shader_file(name) else source
                      for name, source in sources.items()}
        return root, release, manifest, sources, normalized, snapshot

    def test_uncompressed_artifacts_use_current_build_and_verified_multipart_gzip(self):
        for current_files in (True, False):
            with self.subTest(current_files=current_files), tempfile.TemporaryDirectory() as temporary:
                root, release, manifest, raw, normalized, snapshot = self._build_fixture(temporary, multipart=True)
                current = Path(temporary) / 'current-runtime'
                current.mkdir()
                name = manifest['name']
                decoded = (release / (name + '.min.js')).read_bytes()
                source = b'// current pre-transform runtime\n' + decoded
                manifest['bundle_bytes'] = len(source)
                if current_files:
                    write(current, name + '.js', source)
                    write(current, name + '.min.js', decoded)
                write(release, name + '.js', b'globalThis.STALE_SOURCE = true;')
                write(release, name + '.min.js', b'globalThis.STALE_MINIFIED = true;')
                write(release, name + '.manifest.json', json.dumps(manifest, indent=2) + '\n')
                with mock.patch.object(sdk_module, 'sdk_input_file_map', return_value=snapshot['mapping']), \
                        mock.patch.object(rebuild_module, 'write_sdk_build_descriptor'):
                    sdk_module.build_engine_sdk(root, release, manifest, module_sources=normalized,
                        raw_module_sources=raw, input_snapshot=snapshot, runtime_dir=current)
                package = release / 'engine-sdk'
                self.assertEqual((package / 'dist' / (name + '.min.js')).read_bytes(), decoded)
                candidate_source = package / 'dist' / (name + '.js')
                self.assertEqual(candidate_source.is_file(), current_files)
                if current_files:
                    self.assertEqual(candidate_source.read_bytes(), source)
                self.assertTrue(sdk_module.sdk_is_current(package))

    def test_invalid_current_uncompressed_artifact_preserves_published_sdk(self):
        for extension, message in (('.min.js', 'candidate minified runtime differs'),
                                   ('.js', 'source runtime size differs')):
            with self.subTest(extension=extension), tempfile.TemporaryDirectory() as temporary:
                root, release, manifest, raw, normalized, snapshot = self._build_fixture(temporary)
                final = release / 'engine-sdk'
                sdk_fixture(final)
                old_receipt = (final / 'manifest.json').read_bytes()
                old_zip = (release / 'particle-engine-sdk.zip').read_bytes()
                current = Path(temporary) / 'current-runtime'
                name = manifest['name']
                decoded = (release / (name + '.min.js')).read_bytes()
                manifest['bundle_bytes'] = len(decoded)
                write(current, name + '.min.js', decoded.replace(b'[x,y,z]', b'[z,y,x]')
                      if extension == '.min.js' else decoded)
                write(current, name + '.js', decoded + b'\n// wrong current source size\n'
                      if extension == '.js' else decoded)
                write(release, name + '.manifest.json', json.dumps(manifest, indent=2) + '\n')
                with mock.patch.object(sdk_module, 'sdk_input_file_map', return_value=snapshot['mapping']), \
                        mock.patch.object(rebuild_module, 'write_sdk_build_descriptor'), \
                        self.assertRaisesRegex(ValueError, message):
                    sdk_module.build_engine_sdk(root, release, manifest, module_sources=normalized,
                        raw_module_sources=raw, input_snapshot=snapshot, runtime_dir=current)
                self.assertEqual((final / 'manifest.json').read_bytes(), old_receipt)
                self.assertEqual((release / 'particle-engine-sdk.zip').read_bytes(), old_zip)
                self.assertTrue(sdk_module.sdk_is_current(final))

    def test_shared_packager_delivers_generated_raw_source_all_encodings_and_import_shim(self):
        for profile, multipart in (('engine', False), ('platform', True)):
            with self.subTest(profile=profile), tempfile.TemporaryDirectory() as temporary:
                root, release, manifest, raw, normalized, snapshot = self._build_fixture(
                    temporary, profile=profile, multipart=multipart)
                with mock.patch.object(sdk_module, 'sdk_input_file_map', return_value=snapshot['mapping']), \
                        mock.patch.object(rebuild_module, 'write_sdk_build_descriptor'), \
                        mock.patch.object(sdk_module, '_write_candidate_engine_demo'):
                    receipt = sdk_module.build_engine_sdk(root, release, manifest,
                        module_sources=normalized, raw_module_sources=raw, input_snapshot=snapshot)
                package = release / (profile + '-sdk')
                self.assertEqual((package / 'engine/shaders/FixtureShader.js').read_text(encoding='utf-8'),
                                 raw['engine/shaders/FixtureShader.js'])
                self.assertIn('preserve authored comment', raw['engine/shaders/FixtureShader.js'])
                self.assertNotEqual(raw['engine/shaders/FixtureShader.js'], normalized['engine/shaders/FixtureShader.js'])
                self.assertEqual((package / 'dist' / (manifest['name'] + '.min.js.xz')).read_bytes(),
                                 (release / (manifest['name'] + '.min.js.xz')).read_bytes())
                self.assertIn("import '../engine/sim/particles/SnapshotWorker.js';",
                              (package / 'editor/SnapshotWorker.js').read_text(encoding='utf-8'))
                if profile == 'platform':
                    generated = 'webgpu-os/.bundled-os-content.generated.js'
                    self.assertEqual((package / generated).read_text(encoding='utf-8'), raw[generated])
                    self.assertIn(generated, receipt['files'])
                self.assertTrue(sdk_module.sdk_is_current(package, target=profile))
                with zipfile.ZipFile(release / (receipt['name'] + '.zip')) as archive:
                    for name in sdk_module.SDK_DOCS_VALIDATION_INPUTS:
                        with self.subTest(profile=profile, input=name):
                            original = (ROOT / name).read_bytes()
                            self.assertEqual((package / name).read_bytes(), original)
                            self.assertEqual(archive.read(name), original)
                            self.assertEqual(receipt['files'][name], sdk_module._file_record(ROOT / name))
                            write(package, name, original + b'\n<!-- damaged shipped contract -->\n')
                            self.assertFalse(sdk_module.sdk_is_current(package, target=profile))
                            write(package, name, original)
                            (package / name).unlink()
                            self.assertFalse(sdk_module.sdk_is_current(package, target=profile))
                            write(package, name, original)
                self.assertTrue(sdk_module.sdk_is_current(package, target=profile))

    def test_missing_declared_encoding_fails_before_replacing_a_published_sdk(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, release, manifest, raw, normalized, snapshot = self._build_fixture(temporary)
            final = release / 'engine-sdk'
            sdk_fixture(final)
            old_receipt = (final / 'manifest.json').read_bytes()
            old_zip = (release / 'particle-engine-sdk.zip').read_bytes()
            (release / 'particle-engine.min.js.xz').unlink()
            with mock.patch.object(sdk_module, 'sdk_input_file_map', return_value=snapshot['mapping']), \
                    mock.patch.object(rebuild_module, 'write_sdk_build_descriptor'), \
                    self.assertRaises((ValueError, RuntimeError, FileNotFoundError)):
                sdk_module.build_engine_sdk(root, release, manifest, module_sources=normalized,
                                           raw_module_sources=raw, input_snapshot=snapshot)
            self.assertEqual((final / 'manifest.json').read_bytes(), old_receipt)
            self.assertEqual((release / 'particle-engine-sdk.zip').read_bytes(), old_zip)
            self.assertTrue(sdk_module.sdk_is_current(final))

    def test_copy_failure_leaves_published_directory_and_archive_unchanged(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, release, manifest, raw, normalized, snapshot = self._build_fixture(temporary)
            final = release / 'engine-sdk'
            sdk_fixture(final)
            old_receipt = (final / 'manifest.json').read_bytes()
            old_zip = (release / 'particle-engine-sdk.zip').read_bytes()
            copier = sdk_module.site._copy_release_asset_manifest

            def interrupted_copy(destination, source_root, records):
                records = list(records)
                if Path(source_root) == root:
                    copier(destination, source_root, records[:1])
                    raise OSError('Injected input copy interruption')
                return copier(destination, source_root, records)

            with mock.patch.object(sdk_module, 'sdk_input_file_map', return_value=snapshot['mapping']), \
                    mock.patch.object(sdk_module.site, '_copy_release_asset_manifest', side_effect=interrupted_copy), \
                    self.assertRaisesRegex(OSError, 'copy interruption'):
                sdk_module.build_engine_sdk(root, release, manifest, module_sources=normalized,
                                           raw_module_sources=raw, input_snapshot=snapshot)
            self.assertEqual((final / 'manifest.json').read_bytes(), old_receipt)
            self.assertEqual((release / 'particle-engine-sdk.zip').read_bytes(), old_zip)
            self.assertTrue(sdk_module.sdk_is_current(final))

    def test_publication_restores_both_outputs_after_tree_archive_or_verification_failure(self):
        for failure in ('tree', 'archive', 'verification'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temporary:
                base = Path(temporary)
                final, stage = base / 'published/engine-sdk', base / 'candidate/stage'
                for tree, marker in ((final, 'previous release'), (stage, 'candidate release')):
                    receipt, _ = sdk_fixture(tree)
                    write(tree, 'publication-marker.txt', marker)
                    receipt['files'] = inventory(tree)
                    write(tree, 'manifest.json', json.dumps(receipt, indent=2) + '\n')
                    create_release_site_archive(tree, tree.parent / 'particle-engine-sdk.zip')
                archive = final.parent / 'particle-engine-sdk.zip'
                staged_archive = stage.parent / 'particle-engine-sdk.zip'
                old_tree = inventory(final)
                old_manifest = (final / 'manifest.json').read_bytes()
                old_archive = archive.read_bytes()
                original_verifier = sdk_module.verify_sdk
                original_replace = sdk_module.site._os_replace_with_retry

                def verify_candidate(root, **kwargs):
                    if Path(root) == final:
                        raise ValueError('Injected post-promotion verification failure')
                    return original_verifier(root, **kwargs)

                def archive_failure(source, target):
                    if Path(source) == staged_archive:
                        raise OSError('Injected archive promotion failure')
                    return original_replace(source, target)

                target, replacement = {
                    'tree': ('_publish_staged_site', mock.Mock(side_effect=OSError('Injected tree promotion failure'))),
                    'archive': ('_os_replace_with_retry', archive_failure),
                }.get(failure, (None, None))
                patch = (mock.patch.object(sdk_module, 'verify_sdk', side_effect=verify_candidate)
                         if failure == 'verification' else mock.patch.object(sdk_module.site, target, side_effect=replacement))
                with patch, self.assertRaises((ValueError, OSError)):
                    sdk_module._publish_sdk(stage, final, staged_archive, archive)
                self.assertEqual(inventory(final), old_tree)
                self.assertEqual((final / 'manifest.json').read_bytes(), old_manifest)
                self.assertEqual(archive.read_bytes(), old_archive)
                self.assertTrue(sdk_module.sdk_is_current(final))
                self.assertEqual(list(final.parent.glob('.sdk-rollback-*')), [])

    def test_failed_rollback_retains_previous_tree_and_archive_outside_the_disposable_stage(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            final, stage = base / 'published/engine-sdk', base / 'candidate/stage'
            sdk_fixture(final)
            sdk_fixture(stage)
            archive = final.parent / 'particle-engine-sdk.zip'
            staged_archive = stage.parent / 'particle-engine-sdk.zip'
            old_manifest, old_archive = (final / 'manifest.json').read_bytes(), archive.read_bytes()
            with mock.patch.object(sdk_module.site, '_os_replace_with_retry', side_effect=OSError('promotion refused')), \
                    mock.patch.object(sdk_module.site, '_sync_site_tree', side_effect=OSError('rollback refused')), \
                    self.assertRaisesRegex(OSError, 'rollback refused'):
                sdk_module._publish_sdk(stage, final, staged_archive, archive)
            backups = list(final.parent.glob('.sdk-rollback-*'))
            self.assertEqual(len(backups), 1)
            self.assertFalse(backups[0].is_relative_to(stage.parent))
            self.assertEqual((backups[0] / 'tree/manifest.json').read_bytes(), old_manifest)
            self.assertEqual((backups[0] / 'archive.zip').read_bytes(), old_archive)


class TestSdkAcceptanceIsolation(unittest.TestCase):
    def test_request_paths_reject_traversal_other_mounts_and_double_encoding(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for raw in ('/../outside', '/%2e%2e/outside', '/%252e%252e/outside', '/engine/index.js',
                        '/sdk-nested/..%5coutside', '/sdk-nested/%00'):
                with self.subTest(raw=raw), self.assertRaises(ValueError):
                    runner.contained_request_path(root, raw, '/sdk-nested/')
            self.assertEqual(runner.contained_request_path(root, '/sdk-nested/engine/main.js?v=1', '/sdk-nested/'),
                             root / 'engine/main.js')

    def test_server_serves_nested_sdk_only_with_wasm_and_module_mime_types(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'sdk'
            write(root, 'engine/main.mjs', 'export {};')
            write(root, 'engine/native.wasm', b'\0asm\x01\0\0\0')
            write(root.parent, 'outside.js', 'must not be served')
            with runner.sdk_server(root, '/sdk-nested/') as (origin, observations):
                for name, mime in (('main.mjs', 'text/javascript'), ('native.wasm', 'application/wasm')):
                    with urlopen(origin + '/sdk-nested/engine/' + name) as response:
                        self.assertEqual(response.headers.get_content_type(), mime)
                        self.assertEqual(response.headers['Cross-Origin-Embedder-Policy'], 'require-corp')
                for route in ('/outside.js', '/sdk-nested/%2e%2e/outside.js', '/engine/main.mjs'):
                    with self.assertRaises(HTTPError) as failure:
                        urlopen(origin + route)
                    self.assertEqual(failure.exception.code, 404)
                self.assertEqual(len(observations), 5)

    def test_archive_extraction_rejects_traversal_duplicates_and_symbolic_links(self):
        for kind in ('traversal', 'duplicate', 'symbolic-link'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temporary:
                archive_path = Path(temporary) / 'unsafe.zip'
                with zipfile.ZipFile(archive_path, 'w') as archive:
                    if kind == 'traversal':
                        archive.writestr('../outside.js', 'escape')
                    elif kind == 'duplicate':
                        archive.writestr('manifest.json', '{}')
                        with self.assertWarns(UserWarning):
                            archive.writestr('manifest.json', '{}')
                    else:
                        item = zipfile.ZipInfo('linked')
                        item.create_system = 3
                        item.external_attr = (0o120777 << 16)
                        archive.writestr(item, '../outside')
                with self.assertRaises(ValueError):
                    runner.extract_sdk(archive_path, Path(temporary) / 'extracted')


class TestSdkCliPreflight(unittest.TestCase):
    def test_rebuild_rejects_output_consumer_and_key_maintenance_flags_before_any_write(self):
        cases = (['--outdir', 'elsewhere'], ['--outdir=elsewhere'], ['--name', 'renamed'],
                 ['--entry', 'engine/custom.js'], ['--sync-consumer', 'consumer'],
                 ['--sync-consumer-assets-only=consumer'], ['--gen-roots', '1'],
                 ['--issue-cert'], ['--encrypt'], ['--targets-config', 'other.json'])
        for flags in cases:
            with self.subTest(flags=flags), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                with mock.patch.object(cli_module, 'ROOT', root), \
                        mock.patch('sys.argv', ['bundle_engine.py', '--sdk-rebuild', *flags]), \
                        mock.patch('sys.stderr', new=io.StringIO()) as diagnostic, \
                        mock.patch.object(cli_module, 'generate_ring0_roots') as keygen, \
                        mock.patch.object(cli_module, 'issue_publisher_cert') as issue, \
                        self.assertRaises(SystemExit) as failure:
                    cli_module.main()
                self.assertEqual(failure.exception.code, 2)
                self.assertIn('--sdk-rebuild conflicts with', diagnostic.getvalue())
                keygen.assert_not_called()
                issue.assert_not_called()
                self.assertEqual(list(root.iterdir()), [])

    def test_sdk_only_rejects_non_sdk_targets_and_runtime_wrappers_before_outputs(self):
        cases = (['--target', 'webgpu-os'], ['--target', 'engine', '--obfuscate'],
                 ['--target', 'engine', '--encrypt'], ['--target', 'platform', '--embed-source-tree'])
        for flags in cases:
            with self.subTest(flags=flags), tempfile.TemporaryDirectory() as temporary:
                output = Path(temporary) / 'release'
                with mock.patch('sys.argv', ['bundle_engine.py', '--sdk-only', '--outdir', str(output), *flags]), \
                        mock.patch('sys.stdout', new=io.StringIO()):
                    self.assertEqual(cli_module.main(), 2)
                self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
