# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Ensure public CPU test receipts cannot accept missing or vacuous execution."""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from sdk import public_tests


class PublicCaseReceiptTests(unittest.TestCase):
    def setUp(self):
        self.suite = {'id': 'strict-json', 'expectedCases': {'source': ['a', 'b']}}
        self.result = {'status': 'PASS', 'cleanup': {'status': 'passed'}, 'cases': [
            {'id': name, 'status': 'PASS', 'checks': [{'passed': True}]} for name in ['a', 'b']]}

    def test_exact_completed_case_inventory_passes(self):
        public_tests.validate_result(self.suite, 'source', self.result)

    def test_zero_case_success_is_rejected(self):
        self.result['cases'] = []
        with self.assertRaisesRegex(ValueError, 'Case inventory mismatch'):
            public_tests.validate_result(self.suite, 'source', self.result)

    def test_missing_and_duplicated_identities_are_rejected(self):
        for ids in [['a'], ['a', 'a'], ['a', 'unknown']]:
            result = deepcopy(self.result)
            result['cases'] = [{'id': identity, 'status': 'PASS', 'checks': [{'passed': True}]} for identity in ids]
            with self.assertRaisesRegex(ValueError, 'Case inventory mismatch|Duplicate'):
                public_tests.validate_result(self.suite, 'source', result)

    def test_skip_missing_assertions_and_failed_assertions_do_not_pass(self):
        for changed in [{'status': 'SKIP'}, {'checks': []}, {'checks': [{'passed': False}]}]:
            result = deepcopy(self.result)
            result['cases'][0].update(changed)
            with self.assertRaisesRegex(ValueError, 'required case failed'):
                public_tests.validate_result(self.suite, 'source', result)

    def test_unfinished_cleanup_is_rejected(self):
        self.result['cleanup']['status'] = 'not_run'
        with self.assertRaisesRegex(ValueError, 'cleanup'):
            public_tests.validate_result(self.suite, 'source', self.result)

    def test_native_import_alias_uses_valid_destructuring_without_changing_export_identity(self):
        source, modules = public_tests._imports("import { Rig as EngineRig } from '../engine/EngineImports.js';")
        self.assertIn('const { Rig: EngineRig }', source)
        self.assertIn('["Rig"]', source)
        self.assertEqual(modules, ['engine/EngineImports.js'])


class PublicProfileClosureTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='sdk-public-profile-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        source = Path(public_tests.__file__).parent / 'public_tests'
        shutil.copytree(source, self.root / 'sdk/public_tests')
        self.profile = json.loads((source / 'profile.json').read_text(encoding='utf-8'))
        self.modules = sorted({name for suite in self.profile['suites'] for name in suite['requiredModules']})
        self.records = {}
        for name in self.modules:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'export const fixture = true;\n')
            self.record(path)
        for name in ('examples/compiled.html', 'examples/source-importmap.js', 'serve_sdk.py', 'sdk/public_tests.py'):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'public profile fixture support\n')
            self.record(path)
        for path in (self.root / 'sdk/public_tests').rglob('*'):
            if path.is_file() and '__pycache__' not in path.parts:
                self.record(path)
        self.manifest = {'bundle': {'files': self.modules}, 'files': self.records}
        self.write_manifest()

    def record(self, path):
        payload = path.read_bytes()
        self.records[path.relative_to(self.root).as_posix()] = {'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}

    def write_manifest(self):
        (self.root / 'manifest.json').write_text(json.dumps(self.manifest), encoding='utf-8')

    def write_profile(self):
        path = self.root / 'sdk/public_tests/profile.json'
        path.write_text(json.dumps(self.profile), encoding='utf-8')
        self.record(path)
        self.write_manifest()

    def test_reviewed_suites_have_exact_64_case_inventory(self):
        profile = public_tests.validate_public_profile(self.root)
        self.assertEqual(profile['expectedCasesPerMode'], 64)
        self.assertEqual(sum(suite['expectedCount'] for suite in profile['suites']), 64)
        self.assertTrue(all(suite['eligible'] for suite in profile['suites']))

    def test_missing_source_module_is_rejected(self):
        (self.root / self.modules[0]).unlink()
        with self.assertRaisesRegex(ValueError, 'module is absent'):
            public_tests.validate_public_profile(self.root)

    def test_missing_compiled_module_is_rejected_without_source_fallback(self):
        self.manifest['bundle']['files'] = self.modules[1:]
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, 'compiled SDK module is absent'):
            public_tests.validate_public_profile(self.root)

    def test_tampered_assertion_fixture_is_rejected(self):
        with (self.root / 'sdk/public_tests/fixtures/strict-json.js').open('ab') as stream:
            stream.write(b'\n// accidental drift\n')
        with self.assertRaisesRegex(ValueError, 'fixture changed'):
            public_tests.validate_public_profile(self.root)

    def test_ineligible_suite_cannot_remain_required(self):
        self.profile['suites'][0]['eligible'] = False
        self.write_profile()
        with self.assertRaisesRegex(ValueError, 'not eligible'):
            public_tests.validate_public_profile(self.root)

    def test_case_identity_drift_is_rejected(self):
        self.profile['suites'][0]['expectedCases']['source'].pop()
        self.write_profile()
        with self.assertRaisesRegex(ValueError, 'case identity inventory'):
            public_tests.validate_public_profile(self.root)

    def test_receipt_does_not_accept_changed_required_source(self):
        (self.root / self.modules[0]).write_bytes(b'export const different = true;\n')
        with self.assertRaisesRegex(ValueError, 'differs from its receipt'):
            public_tests.validate_public_profile(self.root)

    def test_reduced_suite_count_cannot_be_certified_by_changed_metadata(self):
        self.profile['suites'][0]['expectedCount'] = 6
        self.write_profile()
        with self.assertRaisesRegex(ValueError, 'suite case count changed'):
            public_tests.validate_public_profile(self.root)


class PublicPersistenceGraphTests(unittest.TestCase):
    def test_bootstrap_side_effect_import_exposes_existing_spell_persistence_module(self):
        from bundler.graph import ModuleGraph, rewrite_module
        root = Path(public_tests.__file__).resolve().parents[1]
        bootstrap = root / 'engine/EngineBootstrap.js'
        if not bootstrap.is_file():
            self.skipTest('Graph integration requires the delivered Engine sources')
        line = "import './gameplay/spells/SpellGeneratorIntegration.js';"
        self.assertIn(line, bootstrap.read_text(encoding='utf-8'))
        graph = ModuleGraph(root)
        graph.walk_source('engine/EngineBootstrap.js', line)
        self.assertFalse(graph.errors)
        module = 'engine/gameplay/spells/SpellGeneratorIntegration.js'
        self.assertIn(module, [graph.mod_id(path) for path in graph.order])
        emitted = rewrite_module((root / module).read_text(encoding='utf-8'), root / module, graph)
        self.assertIn('readGeneratedSpellLibraryRecord', emitted)
        self.assertIn('writeGeneratedSpellLibraryRecord', emitted)


class PublicCatalogOriginTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='sdk-public-origins-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        source = Path(public_tests.__file__).parent / 'public_tests/profile.json'
        self.profile = json.loads(source.read_text(encoding='utf-8'))
        policies = deepcopy(self.profile['suites'])
        self.origins = {}
        for policy, spec in zip(policies, public_tests.SPECS):
            paths = ['tests/' + spec[1]]
            if spec[3] == 'rig':
                paths.append('tests/rig-public-api.bundle.test.js')
            policy['sourcePaths'] = paths
            policy['assertionOriginsSha256'] = {}
            for name in paths:
                path = self.root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"check('stable-case-id', () => { assert(2 + 2 === 4); });\n")
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                self.origins[name] = digest
                policy['assertionOriginsSha256'][name] = digest
        self.catalog = self.root / 'tools/testing_platform/suites.json'
        self.catalog.parent.mkdir(parents=True)
        self.document = {'publicSdk': {'schema': 'particle-sdk-public-test-eligibility/v1',
            'profiles': ['engine-plauna-cpu'], 'suites': policies}}
        self.write_catalog()

    def write_catalog(self):
        self.catalog.write_text(json.dumps(self.document), encoding='utf-8')
        self.profile['canonicalCatalogSha256'] = hashlib.sha256(self.catalog.read_bytes()).hexdigest()
        self.profile['assertionOriginsSha256'] = self.origins

    def test_approved_original_identities_are_verified(self):
        _payload, admitted, origins = public_tests._approved_catalog(self.root, self.catalog)
        self.assertEqual(origins, self.origins)
        self.assertEqual(set(admitted), {spec[0] for spec in public_tests.SPECS})

    def test_changed_assertion_body_with_same_case_identity_fails_before_export_writes(self):
        path = self.root / 'tests/strict-json-value.test.js'
        before = path.read_text(encoding='utf-8')
        after = before.replace('2 + 2 === 4', '2 + 2 === 5')
        self.assertEqual(public_tests.CASE_PATTERN.findall(before), public_tests.CASE_PATTERN.findall(after))
        path.write_text(after, encoding='utf-8')
        destination = self.root / 'candidate'
        with self.assertRaisesRegex(ValueError, 'assertion origin differs from its approved pin'):
            public_tests.export_public_profile(self.root, destination)
        self.assertFalse(destination.exists())

    def test_missing_origin_pin_is_rejected(self):
        self.document['publicSdk']['suites'][0]['assertionOriginsSha256'] = {}
        self.write_catalog()
        with self.assertRaisesRegex(ValueError, 'assertion origin inventory changed'):
            public_tests._approved_catalog(self.root, self.catalog)

    def test_stale_profile_catalog_identity_is_rejected(self):
        self.profile['canonicalCatalogSha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'stale canonical catalog identity'):
            public_tests._validate_canonical_profile(self.root, self.profile)

    def test_adapted_body_drift_fails_even_after_self_receipt_is_updated(self):
        name = 'fixtures/strict-json.js'
        expected = b"check('same-id', () => { assert(2 + 2 === 4); });\n"
        actual = expected.replace(b'=== 4', b'=== 5')
        path = self.root / 'sdk/public_tests' / name
        path.parent.mkdir(parents=True)
        path.write_bytes(actual)
        self.profile['files'] = {name: {'bytes': len(actual), 'sha256': hashlib.sha256(actual).hexdigest()}}
        def export_fixture(_repository, destination, _catalog):
            generated = destination / name
            generated.parent.mkdir(parents=True)
            generated.write_bytes(expected)
            return {'suites': self.profile['suites'], 'files': {name: {
                'bytes': len(expected), 'sha256': hashlib.sha256(expected).hexdigest()}}}
        with patch.object(public_tests, 'export_public_profile', side_effect=export_fixture):
            with self.assertRaisesRegex(ValueError, 'generated assertion fixture differs from canonical export'):
                public_tests._validate_canonical_profile(self.root, self.profile)


if __name__ == '__main__':
    unittest.main()
