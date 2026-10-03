# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Saved failed and historical reports remain visible without executing report text."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from reporting import load_reports, write_dashboard


class DashboardTests(unittest.TestCase):
    def test_malicious_report_names_and_text_are_inert_and_status_is_preserved(self):
        with tempfile.TemporaryDirectory(prefix='sdk-dashboard-') as temporary:
            root = Path(temporary)
            path = root / 'old.json'
            path.write_text('{"status":"SKIP","error":"</script><script>alert(1)</script>"}', encoding='utf-8')
            output = root / 'index.html'
            write_dashboard(load_reports([path]), output)
            document = output.read_text(encoding='utf-8')
            self.assertIn('"status": "SKIP"', document)
            self.assertIn('historical or unbound', document)
            self.assertNotIn('</script><script>alert(1)</script>', document)
            self.assertIn('\\u003c/script\\u003e', document)

    def test_missing_and_invalid_reports_are_actual_failure_rows(self):
        with tempfile.TemporaryDirectory(prefix='sdk-dashboard-') as temporary:
            root = Path(temporary)
            invalid = root / 'invalid.json'
            invalid.write_text('not json', encoding='utf-8')
            loaded = load_reports([root / 'missing.json', invalid])
            self.assertEqual([report['status'] for _, report in loaded], ['FAIL', 'FAIL'])
            self.assertTrue(all(report['error'] for _, report in loaded))

    def test_aggregate_dashboard_includes_actual_children_and_downloadable_junit(self):
        with tempfile.TemporaryDirectory(prefix='sdk-dashboard-children-') as temporary:
            root = Path(temporary)
            child = root / 'children/python/python.json'
            child.parent.mkdir(parents=True)
            child.write_text(json.dumps({'status': 'PASS', 'tests': [{'name': 'actual case', 'status': 'PASS'}],
                                         'junit': 'test-results/python.xml'}), encoding='utf-8')
            (child.parent / 'python.xml').write_text('<testsuite tests="1"/>', encoding='utf-8')
            aggregate = root / 'aggregate.json'
            aggregate.write_text(json.dumps({'schema': 'particle-sdk-ci-aggregate/v1', 'status': 'PASS',
                                              'sources': {'python': {'artifactPath': 'children/python/python.json'},
                                                          'unsafe': {'artifactPath': '../outside.json'}}}), encoding='utf-8')
            reports = load_reports([aggregate])
            self.assertEqual([path.name for path, _ in reports], ['aggregate.json', 'python.json'])
            write_dashboard(reports, root / 'coverage.html')
            document = (root / 'coverage.html').read_text(encoding='utf-8')
            self.assertIn('actual case', document)
            self.assertIn('children/python/python.xml', document)


if __name__ == '__main__':
    unittest.main()
