# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Reporter outcomes and JUnit must distinguish failures, errors and skips."""
from __future__ import annotations

import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from run_python_tests import RecordedResult, SDK, write_reports


class PythonReportingTests(unittest.TestCase):
    def test_actual_callbacks_preserve_distinct_outcomes_in_json_and_junit(self):
        class Outcomes(unittest.TestCase):
            def test_pass(self):
                self.assertEqual(2 + 2, 4)

            def test_failure(self):
                self.fail("recorded assertion failure")

            def test_error(self):
                raise ValueError("recorded runtime error")

            @unittest.skip("recorded unavailable prerequisite")
            def test_skip(self):
                self.fail("a skipped test must never run")

            def test_subtest_failure(self):
                with self.subTest(value=1):
                    self.assertEqual(1, 2)

        suite = unittest.defaultTestLoader.loadTestsFromTestCase(Outcomes)
        result = unittest.TextTestRunner(stream=io.StringIO(), resultclass=RecordedResult).run(suite)
        self.assertFalse(result.wasSuccessful())
        tests = list(result.records.values())
        self.assertEqual({test["name"].rsplit(".", 1)[-1]: test["status"] for test in tests}, {
            "test_pass": "PASS", "test_failure": "FAIL", "test_error": "ERROR",
            "test_skip": "SKIP", "test_subtest_failure": "FAIL"})
        subtest = next(test for test in tests if test["name"].endswith("test_subtest_failure"))
        self.assertEqual(subtest["subtests"][0]["status"], "FAIL")
        report = {"status": "FAIL", "duration_seconds": 0.1, "tests": tests,
                  "counts": {"run": 5, "passed": 1, "failures": 2, "errors": 1,
                             "skipped": 1, "expectedFailures": 0}}
        with tempfile.TemporaryDirectory(prefix="python-reporting-contract-") as temporary:
            output = Path(temporary) / "report.json"
            summary = Path(temporary) / "summary.md"
            with patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": str(summary)}):
                write_reports(report, output)
            saved = json.loads(output.read_text(encoding="utf-8"))
            xml = ET.parse(output.with_suffix(".xml")).getroot()
            self.assertEqual(saved["counts"], report["counts"])
            self.assertEqual(xml.attrib["tests"], "5")
            self.assertEqual(len(xml.findall("testcase/failure")), 2)
            self.assertEqual(len(xml.findall("testcase/error")), 1)
            self.assertEqual(len(xml.findall("testcase/skipped")), 1)
            self.assertIn("recorded unavailable prerequisite", summary.read_text(encoding="utf-8"))

    def test_missing_suite_is_an_actual_error_and_report_paths_preserve_sdk(self):
        loader = unittest.TestLoader()
        suite = loader.loadTestsFromName("module_that_is_not_in_this_distribution")
        result = unittest.TextTestRunner(stream=io.StringIO(), resultclass=RecordedResult).run(suite)
        self.assertFalse(result.wasSuccessful())
        self.assertEqual(result.testsRun, 1)
        self.assertEqual(next(iter(result.records.values()))["status"], "ERROR")
        with self.assertRaisesRegex(ValueError, "immutable"):
            write_reports({}, SDK / "should-not-be-written.json")
        self.assertFalse((SDK / "should-not-be-written.json").exists())


if __name__ == "__main__":
    unittest.main()
