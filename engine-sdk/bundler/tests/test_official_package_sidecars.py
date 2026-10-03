# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Signed metadata remains bound while opaque package payloads ship separately."""
import base64
import gzip
import hashlib
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from bundler.official_inventory import (
    externalize_official_package_containers, official_package_sidecar_inventory,
    verify_official_package_sidecars, official_container_descriptor,
    build_official_package_inventory, assert_manifest_official_package_inventory,
)
from bundler.site import sync_release_runtime_consumer, create_release_site_archive
from bundler.tests.test_official_package_inventory import _official_record
from bundler.tests.test_official_package_signing_lifecycle import _copy_faculty_inputs, _root_identity, _write_trust
from bundler import signing


class TestOfficialPackageSidecars(unittest.TestCase):
    def fixture(self):
        records = {'os.large': _official_record('os.large', '1.0.0', 'a'),
                   'os.small': _official_record('os.small', '1.0.0', 'b'),
                   'os.navi-faculty.test': _official_record('os.navi-faculty.test', '1.0.0', 'c', 'faculty:test')}
        records['os.large']['container'] = base64.b64encode(b'signed opaque payload' * 4000).decode()
        records['os.navi-faculty.test']['container'] = records['os.large']['container']
        assets = {}
        projected = externalize_official_package_containers(records, assets)
        return records, projected, assets

    def test_only_large_non_faculty_containers_move_and_original_is_unchanged(self):
        records, projected, assets = self.fixture()
        self.assertEqual(len(assets), 1)
        self.assertIn('container', records['os.large'])
        self.assertNotIn('container', projected['os.large'])
        self.assertEqual(projected['os.small'], records['os.small'])
        self.assertEqual(projected['os.navi-faculty.test'], records['os.navi-faculty.test'])
        self.assertEqual(projected['os.large']['envelope'], records['os.large']['envelope'])
        original = build_official_package_inventory(records)['packages']
        moved = build_official_package_inventory(projected)['packages']
        for before, after in zip(original, moved):
            self.assertEqual(before['containerSha256'], after['containerSha256'])
            self.assertEqual(before['envelopeSha256'], after['envelopeSha256'])

    def test_inventory_binds_exact_sidecar_list_and_rejects_missing_assets(self):
        _, projected, _ = self.fixture()
        inventory = build_official_package_inventory(projected)
        assets = official_package_sidecar_inventory(projected)
        self.assertEqual(assert_manifest_official_package_inventory(
            {'officialPackages': inventory, 'officialPackageAssets': assets}, inventory), 3)
        with self.assertRaisesRegex(ValueError, 'officialPackageAssets'):
            assert_manifest_official_package_inventory({'officialPackages': inventory}, inventory)

    def test_unsafe_and_ambiguous_descriptors_are_rejected(self):
        _, projected, _ = self.fixture()
        ref = projected['os.large']['containerRef']
        for changes in ({'path': '../escape.prpkg'}, {'bytes': True}, {'bytes': 0},
                        {'sha256': 'F' * 64}, {'url': 'https://example.com'}, {'format': 'unknown'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                official_container_descriptor({**ref, **changes})
        projected['os.large']['container'] = 'YWJj'
        with self.assertRaises(ValueError):
            official_package_sidecar_inventory(projected)

    def test_deployed_bytes_must_match_both_size_and_hash(self):
        _, projected, assets = self.fixture()
        descriptors = official_package_sidecar_inventory(projected)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name, data in assets.items():
                path = root / name
                path.parent.mkdir(parents=True)
                path.write_bytes(data)
            self.assertEqual(verify_official_package_sidecars(descriptors, root), 1)
            path.write_bytes(b'x' * len(data))
            with self.assertRaisesRegex(ValueError, 'SHA-256'):
                verify_official_package_sidecars(descriptors, root)
            path.write_bytes(data[:-1])
            with self.assertRaisesRegex(ValueError, 'byte count'):
                verify_official_package_sidecars(descriptors, root)

    def test_consumer_sync_and_zip_ship_verified_content_addressed_payload(self):
        _, projected, assets = self.fixture()
        descriptors = official_package_sidecar_inventory(projected)
        source = b'globalThis.PE = {};'
        compressed = gzip.compress(source)
        integrity = 'sha384-' + base64.b64encode(hashlib.sha384(source).digest()).decode()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            release, consumer = root / 'release', root / 'consumer'
            release.mkdir(); consumer.mkdir()
            manifest = {'name': 'particle-os', 'browser_runtime_integrity': integrity,
                        'browser_runtime_decoded_bytes': len(source), 'browser_runtime_bytes': len(compressed),
                        'officialPackageAssets': descriptors,
                        'officialPackages': build_official_package_inventory(projected)}
            (release / 'particle-os.min.js.gz').write_bytes(compressed)
            (release / 'particle-os.manifest.json').write_text(json.dumps(manifest))
            (consumer / 'index.html').write_text('<!doctype html><script src="./assets/old-loader.js" '
                                               'data-runtime-src="./assets/old.js.gz" data-integrity="old" '
                                               'data-runtime-bytes="1"></script>')
            for name, data in assets.items():
                (release / name).parent.mkdir(parents=True, exist_ok=True)
                (release / name).write_bytes(data)
            sync_release_runtime_consumer(consumer, release, manifest, os_base='./')
            verify_official_package_sidecars(descriptors, consumer / 'assets')
            archive = root / 'consumer.zip'
            create_release_site_archive(consumer, archive)
            with zipfile.ZipFile(archive) as zipped:
                for name, data in assets.items():
                    self.assertEqual(zipped.read('assets/' + name), data)

    def test_historical_inline_manifest_needs_no_sidecar_inventory(self):
        records, _, _ = self.fixture()
        inventory = build_official_package_inventory(records)
        self.assertEqual(official_package_sidecar_inventory(records), [])
        self.assertEqual(assert_manifest_official_package_inventory({'officialPackages': inventory}, inventory), 3)

    def test_real_signer_sidecar_reconstructs_the_same_trusted_package(self):
        private, trust = _root_identity()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            _copy_faculty_inputs(root)
            _write_trust(root, private, trust, include_private=True)
            app = root / 'webgpu-os/apps/sidecar'
            app.mkdir(parents=True)
            (app / 'manifest.json').write_text(json.dumps({'appId': 'os.sidecar', 'name': 'Sidecar',
                'version': '1.0.0', 'publisher': 'core', 'entry': './index.js'}))
            # Deterministic incompressible-enough source exceeds the 64 KiB
            # opaque-container threshold without a pretrained/runtime dependency.
            payload = ''.join(hashlib.sha256(str(index).encode()).hexdigest() for index in range(4000))
            (app / 'index.js').write_text('export const payload=' + json.dumps(payload) + ';')
            assets = {}
            preamble = signing.build_official_app_packages(root, write_generated_fallback=False,
                                                          required=True, container_assets=assets)
            records = json.loads(preamble.split('=', 1)[1].rstrip(';'))
            record = dict(records['os.sidecar'])
            ref = record.pop('containerRef')
            record['container'] = base64.b64encode(assets[ref['path']]).decode()
            evidence = signing.verify_official_package_record(record, [trust], expected_package_id='os.sidecar')
            self.assertEqual(evidence['packageId'], 'os.sidecar')
            self.assertEqual(hashlib.sha256(assets[ref['path']]).hexdigest(), ref['sha256'])
            self.assertTrue(all('container' in item for item in records.values()
                                if item['envelope']['manifest'].get('naviFaculty')))


if __name__ == '__main__':
    unittest.main()
