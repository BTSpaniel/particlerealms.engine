# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Actual file drift and output-directory changes must have distinct identities."""
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from report_context import capture, inventory, verify_finish


class ReportContextTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='sdk-context-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        for name, text in {'ci/runner.py': 'value = 1\n', 'engine-sdk/manifest.json': '{}',
                           'engine-sdk/code.js': 'export const value = 1;', 'Template.zip': 'accepted bytes'}.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding='utf-8')
        mock = patch('report_context.git_value', return_value='a' * 40)
        mock.start()
        self.addCleanup(mock.stop)

    def test_actual_sdk_drift_without_manifest_edit_fails_finish(self):
        before = capture(self.root)
        (self.root / 'engine-sdk/code.js').write_text('export const value = 2;', encoding='utf-8')
        result = verify_finish(before, self.root)
        self.assertEqual(result['status'], 'FAIL')
        self.assertIn('sdk', result['changes'])
        self.assertEqual(before['sdk']['manifestSha256'], result['context']['sdk']['manifestSha256'])

    def test_directory_identity_is_not_an_invented_zip_identity(self):
        identity = inventory(self.root / 'engine-sdk')
        self.assertEqual(identity['kind'], 'directory')
        self.assertEqual(identity['files'], 2)
        self.assertIn('inventorySha256', identity)
        self.assertNotIn('sha256', identity)
        self.assertNotIn('archiveSha256', identity)

    def test_job_outputs_do_not_change_recipe_but_recipe_edits_do(self):
        before = capture(self.root)
        (self.root / 'test-results').mkdir()
        (self.root / 'test-results/result.json').write_text('{"status":"PASS"}', encoding='utf-8')
        self.assertEqual(verify_finish(before, self.root)['status'], 'PASS')
        (self.root / 'ci/runner.py').write_text('value = 2\n', encoding='utf-8')
        self.assertIn('recipe', verify_finish(before, self.root)['changes'])

    def test_candidate_cannot_replace_baseline_input_identity(self):
        candidate = self.root / 'candidate'
        candidate.mkdir()
        (candidate / 'manifest.json').write_text('{}', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'checked-in'):
            capture(self.root, sdk=candidate)
        before = capture(self.root, candidate=candidate)
        self.assertEqual(before['sdk'], inventory(self.root / 'engine-sdk'))
        self.assertEqual(before['candidate'], inventory(candidate))

    def test_published_build_named_directories_remain_part_of_package_identity(self):
        before = inventory(self.root / 'engine-sdk')
        source = self.root / 'engine-sdk/build/published.js'
        source.parent.mkdir()
        source.write_text('export const published = 1;', encoding='utf-8')
        after = inventory(self.root / 'engine-sdk')
        self.assertEqual(after['files'], before['files'] + 1)
        self.assertNotEqual(after['inventorySha256'], before['inventorySha256'])


class RealGitContextTests(unittest.TestCase):
    def test_real_git_clean_dirty_and_ignored_output_status_is_bound(self):
        with tempfile.TemporaryDirectory(prefix='sdk-real-git-context-') as temporary:
            root = Path(temporary)
            for name, text in {'.gitignore': '/test-results/\n', 'ci/runner.py': 'value = 1\n',
                               'engine-sdk/manifest.json': '{}', 'engine-sdk/code.js': 'export const value = 1;'}.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding='utf-8')
            for command in [('init', '-q'), ('config', 'user.name', 'Local CI fixture'),
                            ('config', 'user.email', 'ci-fixture@example.invalid'), ('add', '.'),
                            ('commit', '-qm', 'Actual context fixture')]:
                subprocess.run(['git', *command], cwd=root, check=True, capture_output=True, timeout=30)
            before = capture(root)
            self.assertIs(before['workingTreeClean'], True)
            (root / 'test-results').mkdir()
            (root / 'test-results/ignored.json').write_text('{}', encoding='utf-8')
            self.assertEqual(verify_finish(before, root)['status'], 'PASS')
            (root / 'engine-sdk/code.js').write_text('export const value = 2;', encoding='utf-8')
            finish = verify_finish(before, root)
            self.assertEqual(finish['status'], 'FAIL')
            self.assertIs(finish['context']['workingTreeClean'], False)
            self.assertIn('workingTreeClean', finish['changes'])


if __name__ == '__main__':
    unittest.main()
