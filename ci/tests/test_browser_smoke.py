# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Guard browser CI's containment and honest result admission boundaries."""
import hashlib
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from browser_smoke import contained_path, extract_template, require_case


class BrowserBoundaryTests(unittest.TestCase):
    def test_mounted_requests_are_contained_and_decode_once(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            self.assertEqual(contained_path(root, '/nested/assets/runtime.js?v=1', '/nested/'),
                             root / 'assets/runtime.js')
            for path in ('/assets/runtime.js', '/nested/%2e%2e/private',
                         '/nested/%252e%252e/private', '/nested/assets%5cruntime.js', '/nested/%00'):
                with self.subTest(path=path), self.assertRaises(ValueError):
                    contained_path(root, path, '/nested/')

    def test_external_symlink_targets_are_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            root = base / 'served'
            root.mkdir()
            outside = base / 'outside.txt'
            outside.write_text('external', encoding='utf-8')
            try:
                (root / 'link.txt').symlink_to(outside)
            except OSError as error:
                self.skipTest('OS does not permit this test symlink: ' + str(error))
            with self.assertRaises(ValueError):
                contained_path(root.resolve(), '/link.txt', '/')

    def test_archive_extracts_only_recorded_template_members(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            payload = b'export const answer = 42;\n'
            receipt = {'files': {'assets/test.js': {'bytes': len(payload),
                'sha256': hashlib.sha256(payload).hexdigest()}}}
            archive = base / 'Template.zip'
            with zipfile.ZipFile(archive, 'w') as package:
                package.writestr('Template/assets/test.js', payload)
                package.writestr('Template/template-manifest.json', json.dumps(receipt))
            root, actual = extract_template(archive, base / 'extracted')
            self.assertEqual((root / 'assets/test.js').read_bytes(), payload)
            self.assertEqual(actual, receipt)

    def test_archive_traversal_links_duplicates_and_extra_members_are_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            for index, name in enumerate(('outside.txt', 'Template/../outside.txt', 'Template/C:/drive',
                                          'Template/assets\\test.js', 'Template/link.txt', 'Template/extra.txt')):
                archive = base / f'bad-{index}.zip'
                with zipfile.ZipFile(archive, 'w') as package:
                    package.writestr('Template/template-manifest.json', json.dumps({'files': {}}))
                    if name.endswith('link.txt'):
                        entry = zipfile.ZipInfo(name)
                        entry.external_attr = (stat.S_IFLNK | 0o777) << 16
                        package.writestr(entry, '../outside.txt')
                    else:
                        package.writestr(name, 'unrecorded')
                with self.subTest(name=name), self.assertRaises(ValueError):
                    extract_template(archive, base / f'extracted-{index}')
            duplicate = base / 'duplicate.zip'
            with zipfile.ZipFile(duplicate, 'w') as package:
                package.writestr('Template/template-manifest.json', '{}')
                package.writestr('Template/template-manifest.json', '{}')
            with self.assertRaises(ValueError):
                extract_template(duplicate, base / 'duplicate-extracted')

    def test_modified_payload_and_unexecuted_browser_cases_are_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / 'bad-hash.zip'
            with zipfile.ZipFile(archive, 'w') as package:
                package.writestr('Template/a.js', 'changed')
                package.writestr('Template/template-manifest.json', json.dumps({'files': {
                    'a.js': {'bytes': 7, 'sha256': '0' * 64}}}))
            with self.assertRaises(ValueError):
                extract_template(archive, Path(temporary) / 'extracted')
        valid = {'status': 'PASS', 'checks': [{'passed': True}], 'cleanup': {'status': 'passed'}}
        require_case(valid)
        for invalid in ({**valid, 'status': 'unsupported'}, {**valid, 'status': 'NOT_RUN'},
                        {**valid, 'checks': []}, {**valid, 'checks': [{'passed': False}]},
                        {**valid, 'cleanup': {'status': 'pending'}}):
            with self.subTest(case=invalid), self.assertRaises(AssertionError):
                require_case(invalid)


if __name__ == '__main__':
    unittest.main()
