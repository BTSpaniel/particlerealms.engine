# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""The actual SDK tokenizer supplies API names; protected drift requires explanation."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from change_report import compare, load_parser, snapshot, source_exports, verify_acceptance_proofs
from report_context import digest
from ci.tests.test_aggregate import passing_report

ROOT = Path(__file__).resolve().parents[2]


def release_snapshot():
    return {'version': '0.8.1', 'profile': 'engine', 'entrypoints': {'engine/main.js': 'PE'},
            'namespaces': ['Plauna'], 'exports': {'engine/main.js': ['existing']},
            'declarations': {'physx.d.ts': 'original'}, 'native': {'physx.wasm': 'original'},
            'protected': {'LICENSE': 'original'}, 'tools': {'python': '3.12.7'}, 'toolSources': {},
            'files': 2, 'bytes': 100, 'runtimeDecodedBytes': 50, 'runtimeCompressedBytes': 25}


class ChangeReportTests(unittest.TestCase):
    def test_real_parser_aliases_stars_defaults_and_cycles_have_exact_names(self):
        sources = {'engine/main.js': "export { value as renamed } from './values.js'; export * from './star.js';",
                   'engine/star.js': "export const stable = 1; export default 2; export * from './cycle.js';",
                   'engine/cycle.js': "export const cyclic = 3; export * from './star.js';"}
        exports = source_exports(['engine/main.js'], lambda name: sources[name].encode(), load_parser(ROOT / 'engine-sdk'))
        self.assertEqual(exports['engine/main.js'], ['cyclic', 'renamed', 'stable'])

    def test_added_export_and_measured_size_changes_are_visible(self):
        before, after = release_snapshot(), release_snapshot()
        after['exports']['engine/main.js'].append('added')
        after['bytes'] = 125
        result = compare(before, after)
        self.assertEqual(result['status'], 'PASS')
        self.assertEqual(result['changes'][0]['field'], 'exports')
        self.assertEqual(result['metrics']['bytes']['delta'], 25)

    def test_unexplained_removed_exports_and_protected_bytes_fail(self):
        for field, key in [('exports', 'engine/main.js'), ('native', 'physx.wasm'), ('declarations', 'physx.d.ts'), ('protected', 'LICENSE')]:
            after = deepcopy(release_snapshot())
            after[field][key] = [] if field == 'exports' else 'changed'
            with self.subTest(field=field):
                result = compare(release_snapshot(), after)
                self.assertEqual(result['status'], 'FAIL')
                self.assertEqual(result['checks'][0]['name'], field + ':' + key)
                explanation = {field + ':' + key: 'Explicit reviewed change rationale'}
                self.assertEqual(compare(release_snapshot(), after, explanation)['status'], 'PASS' if field == 'exports' else 'FAIL')

    def test_protected_guard_requires_digest_bound_acceptance_for_exact_file_bytes(self):
        with tempfile.TemporaryDirectory(prefix='sdk-change-proof-') as temporary:
            root = Path(temporary)
            report = passing_report()
            path = root / 'acceptance.json'
            path.write_text(json.dumps(report), encoding='utf-8')
            after = release_snapshot()
            after['native']['physx.wasm'] = 'f' * 64
            identity = 'native:physx.wasm'
            explanations = {identity: {'reason': 'Reviewed accepted native update', 'proof': {
                'kind': 'current', 'report': path.name, 'reportSha256': digest(path), 'fileSha256': 'f' * 64}}}
            proofs = verify_acceptance_proofs(explanations, after, report['context'], root)
            self.assertEqual(compare(release_snapshot(), after, explanations, proofs)['status'], 'PASS')
            explanations[identity]['proof']['fileSha256'] = '1' * 64
            with self.assertRaisesRegex(ValueError, 'file bytes'):
                verify_acceptance_proofs(explanations, after, report['context'], root)
            explanations[identity]['proof']['fileSha256'] = 'f' * 64
            report['checks'][0]['status'] = 'SKIP'
            path.write_text(json.dumps(report), encoding='utf-8')
            explanations[identity]['proof']['reportSha256'] = digest(path)
            with self.assertRaisesRegex(ValueError, 'passing'):
                verify_acceptance_proofs(explanations, after, report['context'], root)

    def test_inventory_size_includes_actual_manifest_bytes_and_rejects_bad_parser_input(self):
        source = b'export const value = 1;'
        manifest = {'version': '0.8.1', 'profile': 'engine', 'publicEntrypoints': {'engine/main.js': 'PE'},
                    'bundle': {}, 'files': {'engine/main.js': {'bytes': len(source)}}}
        raw = json.dumps(manifest).encode()
        files = {'engine/main.js': source, 'manifest.json': raw}
        parse = load_parser(ROOT / 'engine-sdk')
        result = snapshot(manifest, files.__getitem__, parse)
        self.assertEqual(result['bytes'], len(source) + len(raw))
        self.assertEqual(result['files'], 2)
        with self.assertRaisesRegex(ValueError, 'Cannot tokenize'):
            source_exports(['engine/main.js'], lambda _name: b"export const broken = 'unterminated", parse)

    def test_removed_shipped_tool_requires_exact_review_reason(self):
        before, after = release_snapshot(), release_snapshot()
        before['toolSources']['bundler/parser.py'] = 'original'
        result = compare(before, after)
        self.assertEqual(result['status'], 'FAIL')
        self.assertEqual(compare(before, after, {'toolSources:bundler/parser.py': 'Reviewed relocation'} )['status'], 'PASS')


if __name__ == '__main__':
    unittest.main()
