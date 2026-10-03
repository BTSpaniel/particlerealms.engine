# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Shared JS/Python schema-profile, local-reference and generation regressions."""

from __future__ import annotations

import builtins
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from bundler import compute_contracts as contracts


class ComputeSchemaProfileTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='compute-schema-profile-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for relative in [contracts.PROFILE, contracts.PROFILE_GENERATED, contracts.GENERATED, *contracts.compute_contract_asset_paths()]:
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(contracts.ROOT / relative, target)

    def policy(self):
        return self.root / contracts.SCHEMA_DIR / 'policy.v1.schema.json'

    def change_policy(self, update):
        path = self.policy()
        schema = json.loads(path.read_text(encoding='utf-8'))
        update(schema)
        path.write_text(json.dumps(schema), encoding='utf-8')

    def test_all_canonical_contracts_verify_and_profile_ships(self):
        loaded = contracts.verify_compute_contracts(self.root)
        self.assertEqual(len(loaded), 16)
        assets = contracts.compute_contract_asset_paths(self.root)
        self.assertIn(contracts.PROFILE.as_posix(), assets)
        self.assertEqual(len(assets), len(loaded) + 1)

    def test_unsupported_assertions_fail_in_nested_schema_positions(self):
        self.change_policy(lambda doc: doc.setdefault('$defs', {}).update({'bad': {'unevaluatedProperties': False}}))
        with self.assertRaisesRegex(ValueError, 'Unsupported shared JSON Schema keyword: unevaluatedProperties'):
            contracts.contract_validators(self.root)

    def test_nested_resource_scope_is_explicitly_unsupported(self):
        self.change_policy(lambda doc: doc.setdefault('$defs', {}).update({'bad': {'$id': 'nested', 'type': 'number'}}))
        with self.assertRaisesRegex(ValueError, r'Nested \$id'):
            contracts.load_compute_contracts(self.root)

    def test_annotations_and_const_are_not_interpreted_as_schemas_or_references(self):
        self.change_policy(lambda doc: doc.update({'const': {'$ref': 'https://offline.invalid/schema', 'contains': True},
            'default': {'$id': 'example', 'unevaluatedProperties': False}, 'x-example': {'type': 'made-up'}}))
        self.assertIn('policy', contracts.contract_validators(self.root))

    def test_offline_reference_closure_refuses_network_names(self):
        self.change_policy(lambda doc: doc.update({'$ref': 'https://offline.invalid/schema'}))
        with self.assertRaisesRegex(ValueError, 'Nonlocal/unknown compute reference'):
            contracts.contract_validators(self.root)

    def test_local_pointer_escapes_percent_encoding_and_array_indices(self):
        self.change_policy(lambda doc: doc.update({'$defs': {'a/b~c': {'type': 'integer'}},
            'allOf': [{'$ref': '#/%24defs/a~1b~0c'}, {'$ref': '#/allOf/0'}]}))
        self.assertIn('policy', contracts.contract_validators(self.root))

    def test_malformed_pointer_and_missing_target_fail_before_validation(self):
        self.change_policy(lambda doc: doc.update({'$ref': '#/bad~2escape'}))
        with self.assertRaisesRegex(ValueError, 'Invalid compute reference escape'):
            contracts.load_compute_contracts(self.root)
        self.change_policy(lambda doc: doc.update({'$ref': '#/$defs/missing'}))
        with self.assertRaisesRegex(ValueError, 'Unresolved compute reference'):
            contracts.load_compute_contracts(self.root)

    def test_profile_drift_invalidates_both_generated_modules_without_rewriting(self):
        path = self.root / contracts.PROFILE
        profile = json.loads(path.read_text(encoding='utf-8'))
        profile['annotations'].append('profile-note')
        path.write_text(json.dumps(profile), encoding='utf-8')
        target = self.root / contracts.GENERATED
        before = target.read_bytes()
        with self.assertRaisesRegex(ValueError, 'Stale shared JSON Schema profile'):
            contracts.verify_compute_contracts(self.root)
        (self.root / contracts.PROFILE_GENERATED).write_bytes(contracts.profile_generated_bytes(profile))
        with self.assertRaisesRegex(ValueError, 'Stale compute contract module'):
            contracts.verify_compute_contracts(self.root)
        self.assertEqual(target.read_bytes(), before)

    def test_canonical_schema_drift_invalidates_generated_module(self):
        self.change_policy(lambda doc: doc.update({'description': 'changed contract metadata'}))
        with self.assertRaisesRegex(ValueError, 'Stale compute contract module'):
            contracts.verify_compute_contracts(self.root)

    def test_bad_metaschema_and_missing_dependency_have_controlled_errors(self):
        self.change_policy(lambda doc: doc.update({'minimum': 'wrong'}))
        with self.assertRaisesRegex(ValueError, 'Invalid Draft 2020-12 compute schema policy'):
            contracts.contract_validators(self.root)
        original_import = builtins.__import__

        def without_jsonschema(name, *args, **kwargs):
            if name == 'jsonschema':
                raise ImportError('deliberately absent test dependency')
            return original_import(name, *args, **kwargs)

        with patch('builtins.__import__', side_effect=without_jsonschema):
            with self.assertRaisesRegex(RuntimeError, 'bundler/requirements.txt'):
                contracts.contract_validators(self.root)

    def test_duplicate_json_fields_and_nonfinite_constants_are_rejected(self):
        self.policy().write_text('{"type":"object","type":"number"}', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'Duplicate JSON key'):
            contracts.load_compute_contracts(self.root)
        self.policy().write_text('{"minimum":NaN}', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'Nonfinite JSON number'):
            contracts.load_compute_contracts(self.root)

    def test_decimal_multiple_of_matches_browser_without_float_modulo_or_rounding(self):
        path = self.root / contracts.SCHEMA_DIR / 'decimal-test.v1.schema.json'
        for divisor, cases in [(0.1, [(0.3, True), (0.30000000000000004, False), (-0.3, True), (1e308, True)]),
                               (2, [(9007199254740991, False), (9007199254740990, True)]),
                               (5e-324, [(1e-323, True), (1.5e-323, True)])]:
            path.write_text(json.dumps({'$schema': contracts.DIALECT, '$id': contracts.BASE + path.name,
                                        'type': 'number', 'multipleOf': divisor}), encoding='utf-8')
            validator = contracts.contract_validators(self.root)['decimal-test']
            for value, expected in cases:
                with self.subTest(value=value, divisor=divisor):
                    self.assertEqual(validator.is_valid(value), expected)


if __name__ == '__main__':
    unittest.main()
