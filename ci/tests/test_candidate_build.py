# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Receipt-based SDK copies preserve delivery files without carrying caches."""
import base64
from copy import deepcopy
import gzip
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from candidate_build import (STAGE_FORMAT, _verify_stage_runtime, candidate_recipe,
                             copy_sdk_inventory, verify_candidate_receipt)
from report_context import canonical_digest, digest


def recorded_descriptor():
    return {'target': 'engine', 'tools': {'python': '3.12.7'}, 'runtime': {
        'name': 'particle-engine', 'site_profile': 'engine', 'base_url_root': None,
        'entries': ['engine/EngineBootstrap.js', 'plauna/index.js'], 'production': True,
        'include_plauna': True, 'include_editor': False, 'include_agi': False,
        'include_webgpu_os': False, 'eager': False, 'release': False,
        'extreme': False, 'ns_ordered': False}}


class CandidateRecipeTests(unittest.TestCase):
    def test_replayed_recipe_options_preserve_recorded_flags(self):
        descriptor = recorded_descriptor()
        for name in ('eager', 'release', 'extreme', 'ns_ordered'):
            descriptor['runtime'][name] = True
        recipe = candidate_recipe(descriptor)
        self.assertEqual(recipe['entries'], ['engine/EngineBootstrap.js', 'plauna/index.js'])
        self.assertTrue(all(recipe[name] for name in ('eager', 'release', 'extreme', 'ns_order')))
        self.assertTrue(recipe['sdk_no_archive'])

    def test_unreplayed_defaults_and_invalid_flags_fail_explicitly(self):
        changes = [('name', 'custom-runtime'), ('site_profile', 'platform'),
                   ('base_url_root', '/custom/'), ('include_editor', True),
                   ('production', False), ('include_plauna', False), ('eager', 1),
                   ('entries', ['plauna/index.js', 'engine/EngineBootstrap.js'])]
        for name, value in changes:
            descriptor = recorded_descriptor()
            descriptor['runtime'][name] = value
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'recorded canonical'):
                candidate_recipe(descriptor)
        descriptor = recorded_descriptor()
        descriptor['runtime']['extreme'] = True
        with self.assertRaisesRegex(ValueError, 'requires release'):
            candidate_recipe(descriptor)


class CandidateReceiptTests(unittest.TestCase):
    """Use actual staged files and the shared gzip/SRI verifier, without a build."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='sdk-candidate-receipt-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.stage = self.root / 'stage'
        self.sdk = self.stage / 'engine-sdk'
        self.descriptor = recorded_descriptor()
        self.supplied = self.root / 'input-sdk/sdk-build.json'
        self.write(self.supplied, json.dumps(self.descriptor).encode())
        self.write(self.sdk / 'sdk-build.json', self.supplied.read_bytes())
        payload = b'globalThis.PE = {requireModule: function () { return {}; }};\n'
        encoded = gzip.compress(payload, mtime=0)
        bundle = {'name': 'particle-engine', 'source_content_sha256': hashlib.sha256(payload).hexdigest(),
                  'browser_runtime': 'particle-engine.min.js.gz', 'browser_runtime_bytes': len(encoded),
                  'browser_runtime_decoded_bytes': len(payload),
                  'browser_runtime_integrity': 'sha384-' + base64.b64encode(hashlib.sha384(payload).digest()).decode(),
                  'provenance': {'path': 'particle-engine.provenance.json', 'sha256': '1' * 64},
                  'computeAssets': [], 'physicsAssets': []}
        for directory in (self.sdk / 'dist', self.stage / 'runtime'):
            self.write(directory / bundle['browser_runtime'], encoded)
            self.write(directory / 'particle-engine.min.js', payload)
        self.sdk_receipt = {'files': {'sdk-build.json': {}, 'dist/particle-engine.min.js.gz': {},
                                    'dist/particle-engine.min.js': {}},
                            'buildInputsSha256': 'f' * 64, 'bundle': bundle}
        self.write(self.sdk / 'manifest.json', json.dumps(self.sdk_receipt).encode())
        recipe = candidate_recipe(self.descriptor)
        outputs = {path.relative_to(self.stage).as_posix(): self.record(path)
                   for path in self.stage.rglob('*') if path.is_file()}
        self.receipt = {'format': STAGE_FORMAT, 'status': 'PASS', 'recipe': recipe,
            'recipeSha256': canonical_digest(recipe), 'tools': self.descriptor['tools'],
            'inputSha256': self.sdk_receipt['buildInputsSha256'],
            'sdkBuildDescriptor': self.record(self.supplied),
            'sdk': {'path': 'engine-sdk', **self.record(self.sdk / 'manifest.json'),
                    'files': len(self.sdk_receipt['files']), 'buildInputsSha256': self.sdk_receipt['buildInputsSha256']},
            'runtime': {'name': bundle['name'], 'sourceSha256': bundle['source_content_sha256'],
                        'integrity': bundle['browser_runtime_integrity'], 'provenance': bundle['provenance'],
                        'files': _verify_stage_runtime(self.stage, self.sdk, bundle)},
            'outputs': outputs, 'outputsSha256': canonical_digest(outputs),
            'validation': {'inputsUnchanged': 'PASS', 'sdk': 'PASS', 'native': 'PASS', 'runtime': 'PASS'}}

    def write(self, path, payload):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)

    def record(self, path):
        return {'bytes': path.stat().st_size, 'sha256': digest(path)}

    def verify(self, receipt=None):
        self.write(self.stage / 'candidate-build.json', json.dumps(receipt or self.receipt).encode())
        return verify_candidate_receipt(self.stage, self.descriptor, self.supplied, self.sdk_receipt)

    def test_real_staged_receipt_matches_all_supplied_and_runtime_identities(self):
        self.assertEqual(self.verify(), self.receipt)

    def test_missing_empty_failed_and_incomplete_validation_do_not_pass(self):
        for validation in (None, {}, {'sdk': 'PASS'}, {**self.receipt['validation'], 'native': 'FAIL'}):
            receipt = deepcopy(self.receipt)
            receipt['validation'] = validation
            with self.subTest(validation=validation), self.assertRaisesRegex(ValueError, 'complete required validation'):
                self.verify(receipt)

    def test_rehashed_wrong_recipe_still_fails(self):
        receipt = deepcopy(self.receipt)
        receipt['recipe']['eager'] = True
        receipt['recipeSha256'] = canonical_digest(receipt['recipe'])
        with self.assertRaisesRegex(ValueError, 'recorded build recipe'):
            self.verify(receipt)

    def test_sdk_input_tool_descriptor_and_runtime_receipt_drift_fail(self):
        for section, name in (('sdk', 'sha256'), ('tools', 'python'),
                              ('sdkBuildDescriptor', 'sha256'), ('runtime', 'sourceSha256')):
            receipt = deepcopy(self.receipt)
            receipt[section][name] = 'changed identity'
            with self.subTest(section=section), self.assertRaises(ValueError):
                self.verify(receipt)
        receipt = deepcopy(self.receipt)
        receipt['inputSha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'SDK, input or pinned tool'):
            self.verify(receipt)

    def test_rebuilt_descriptor_option_drift_fails_before_output_admission(self):
        rebuilt = deepcopy(self.descriptor)
        rebuilt['runtime']['name'] = 'changed-runtime'
        self.write(self.sdk / 'sdk-build.json', json.dumps(rebuilt).encode())
        with self.assertRaisesRegex(ValueError, 'changed recorded runtime options'):
            self.verify()

    def test_actual_unlisted_file_cannot_hide_behind_a_valid_output_digest(self):
        self.write(self.stage / 'runtime/unlisted-cache.json', b'generated extra')
        with self.assertRaisesRegex(ValueError, 'exact output files'):
            self.verify()

    def test_corrupt_runtime_is_rejected_by_shared_decoding_verifier(self):
        self.write(self.stage / 'runtime/particle-engine.min.js.gz', b'corrupt gzip')
        with self.assertRaises(ValueError):
            self.verify()

    def test_output_inventory_and_its_digest_are_both_required(self):
        for field in ('outputs', 'outputsSha256'):
            receipt = deepcopy(self.receipt)
            receipt.pop(field)
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'exact output files'):
                self.verify(receipt)


class CandidateInventoryCopyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='sdk-candidate-copy-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.source = self.root / 'source'
        self.source.mkdir()
        self.destination = self.root / 'candidate'
        self.files = {
            'vendor/pdfjs/build/pdf.mjs': b'export const PDF = 1;\n',
            'vendor/pdfjs/build/pdf.worker.mjs': b'export const Worker = 2;\n',
            'vendor/widget/build/runtime.js': b'export const Widget = 3;\n',
            'build/public-contract.js': b'export const PublicBuildInput = 4;\n',
            'sdk/public_tests/fixtures/strict-json.js': b'export const TestCase = 5;\n',
        }
        self.receipt = {'files': {name: {'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}
            for name, payload in self.files.items()}}
        self.files['manifest.json'] = json.dumps(self.receipt, sort_keys=True).encode()
        for name, payload in self.files.items():
            self.write(name, payload)

    def write(self, name, payload):
        path = self.source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)

    def test_real_copy_preserves_inventoried_build_paths_and_excludes_unlisted_caches(self):
        extras = {
            'build/cache/.bundle_cache.json': b'generated cache',
            'build/runtime/unlisted.js': b'generated runtime',
            '__pycache__/private.pyc': b'unlisted bytecode',
            '.bundle_cache.json': b'unlisted root cache',
        }
        for name, payload in extras.items():
            self.write(name, payload)
        before = {path.relative_to(self.source).as_posix(): path.read_bytes()
            for path in self.source.rglob('*') if path.is_file()}
        self.assertEqual(copy_sdk_inventory(self.source, self.destination, self.receipt), len(self.files))
        copied = {path.relative_to(self.destination).as_posix(): path.read_bytes()
            for path in self.destination.rglob('*') if path.is_file()}
        self.assertEqual(copied, self.files)
        self.assertEqual(before, {path.relative_to(self.source).as_posix(): path.read_bytes()
            for path in self.source.rglob('*') if path.is_file()})
        self.assertTrue((self.destination / 'vendor/pdfjs/build/pdf.worker.mjs').is_file())
        self.assertTrue((self.destination / 'build/public-contract.js').is_file())
        self.assertFalse((self.destination / 'build/cache').exists())

    def test_missing_inventoried_input_fails_before_destination_creation(self):
        (self.source / 'vendor/pdfjs/build/pdf.mjs').unlink()
        with self.assertRaisesRegex(ValueError, 'input is missing'):
            copy_sdk_inventory(self.source, self.destination, self.receipt)
        self.assertFalse(self.destination.exists())

    def test_inventory_path_escape_fails_before_destination_creation(self):
        self.receipt['files']['../outside.js'] = {'bytes': 0, 'sha256': hashlib.sha256(b'').hexdigest()}
        with self.assertRaisesRegex(ValueError, 'Unsafe SDK copy inventory path'):
            copy_sdk_inventory(self.source, self.destination, self.receipt)
        self.assertFalse(self.destination.exists())

    def test_existing_destination_is_preserved(self):
        self.destination.mkdir()
        existing = self.destination / 'owned.txt'
        existing.write_bytes(b'preserve this consumer')
        with self.assertRaisesRegex(ValueError, 'fresh destination'):
            copy_sdk_inventory(self.source, self.destination, self.receipt)
        self.assertEqual(existing.read_bytes(), b'preserve this consumer')
        self.assertEqual(list(self.destination.iterdir()), [existing])

    def test_source_overlap_is_rejected_before_writing(self):
        with self.assertRaisesRegex(ValueError, 'outside its source tree'):
            copy_sdk_inventory(self.source, self.source / 'candidate', self.receipt)
        self.assertFalse((self.source / 'candidate').exists())


if __name__ == '__main__':
    unittest.main()
