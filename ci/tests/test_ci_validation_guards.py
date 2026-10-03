# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Exercise actual pytest phases and failure/staleness boundaries in evidence."""
from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
import io
import json
import os
from pathlib import Path
from types import SimpleNamespace
import sys
import tempfile
import unittest
from unittest.mock import patch
import uuid
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import run_python_tests
import run_with_context


class JunitInfrastructureTests(unittest.TestCase):
    def test_blocked_or_changed_inputs_are_errors_even_when_individual_cases_pass(self):
        for tests in ([], [{'name': 'fixture.individual', 'status': 'PASS', 'duration_seconds': 0.0}]):
            with self.subTest(cases=len(tests)), tempfile.TemporaryDirectory(prefix='sdk-junit-admission-') as temporary:
                output = Path(temporary) / 'blocked.json'
                report = {'status': 'FAIL', 'tests': tests, 'duration_seconds': 0.0,
                          'error': 'Required input changed or execution was blocked',
                          'counts': {'run': len(tests), 'passed': len(tests), 'failures': 0,
                                     'errors': 0, 'skipped': 0, 'expectedFailures': 0}}
                with patch.dict(os.environ, {'GITHUB_STEP_SUMMARY': ''}):
                    run_python_tests.write_reports(report, output)
                suite = ET.parse(output.with_suffix('.xml')).getroot()
                self.assertEqual(int(suite.attrib['tests']), len(tests) + 1)
                self.assertEqual(suite.attrib['errors'], '1')
                self.assertEqual(len(suite.findall('testcase/error')), 1)
                self.assertEqual(json.loads(output.read_text())['status'], 'FAIL')


class ActualPytestCollectionTests(unittest.TestCase):
    def run_pytest(self, source):
        import pytest
        with tempfile.TemporaryDirectory(prefix='sdk-pytest-phase-') as temporary:
            path = Path(temporary) / ('test_phase_contract_' + uuid.uuid4().hex + '.py')
            path.write_text(source, encoding='utf-8')
            records = run_python_tests.PytestRecords()
            with patch.dict(os.environ, {'PYTEST_DISABLE_PLUGIN_AUTOLOAD': '1'}), redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                code = pytest.main(['-q', '-p', 'no:cacheprovider', str(path)], plugins=[records])
            return code, records

    def test_actual_setup_call_teardown_failures_and_skip_are_retained(self):
        code, records = self.run_pytest('''import pytest
@pytest.fixture
def broken_setup():
    raise RuntimeError('setup failed deliberately')
@pytest.fixture
def broken_teardown():
    yield
    raise RuntimeError('teardown failed deliberately')
def test_complete():
    assert 2 + 3 == 5
def test_setup(broken_setup):
    raise AssertionError('call must never run')
def test_call():
    assert False, 'call failed deliberately'
def test_teardown(broken_teardown):
    assert True
def test_skipped():
    pytest.skip('deliberate negative control')
''')
        self.assertEqual(int(code), 1)
        self.assertEqual(len(records.selected), 5)
        self.assertEqual(len(records.records), 5)
        actual = {name.rsplit('::', 1)[1]: row['status'] for name, row in records.records.items()}
        self.assertEqual(actual, {'test_complete': 'PASS', 'test_setup': 'FAIL', 'test_call': 'FAIL',
            'test_teardown': 'FAIL', 'test_skipped': 'SKIP'})
        self.assertFalse(records.collection_errors)

    def test_actual_invalid_python_collection_is_not_a_passing_zero_case_suite(self):
        code, records = self.run_pytest('def test_broken(\n')
        self.assertNotEqual(int(code), 0)
        self.assertFalse(records.selected)
        self.assertTrue(records.collection_errors)
        self.assertFalse(records.records)

    def test_actual_empty_file_returns_no_tests_status(self):
        code, records = self.run_pytest('# No tests are declared here.\n')
        self.assertEqual(int(code), 5)
        self.assertEqual(records.selected, [])
        self.assertEqual(records.records, {})

    def test_absent_call_phase_does_not_certify_pass(self):
        records = run_python_tests.PytestRecords()
        for when in ('setup', 'teardown'):
            records.pytest_runtest_logreport(SimpleNamespace(nodeid='contract::missing_call', duration=0,
                failed=False, skipped=False, when=when, outcome='passed'))
        self.assertNotEqual(records.records['contract::missing_call']['status'], 'PASS')

    def test_teardown_skip_cannot_overwrite_an_earlier_failure(self):
        records = run_python_tests.PytestRecords()
        records.pytest_runtest_logreport(SimpleNamespace(nodeid='contract::precedence', duration=0,
            failed=True, skipped=False, when='call', outcome='failed', longrepr='assertion failed'))
        records.pytest_runtest_logreport(SimpleNamespace(nodeid='contract::precedence', duration=0,
            failed=False, skipped=True, when='teardown', outcome='skipped', longrepr='teardown skipped'))
        self.assertEqual(records.records['contract::precedence']['status'], 'FAIL')


class FreshEvidenceWrapperTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='sdk-fresh-evidence-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.output = self.root / 'test-results/check.json'
        self.output.parent.mkdir()
        self.addCleanup(patch.stopall)
        patch.object(run_with_context, 'ROOT', self.root).start()
        self.context = {'sdk': {'manifestSha256': 'accepted-input'}}
        patch.object(run_with_context, 'capture', return_value=self.context).start()
        self.finish = patch.object(run_with_context, 'verify_finish', return_value={'status': 'PASS', 'changes': []}).start()

    def run_child(self, payload=None, code=0):
        source = 'from pathlib import Path\n'
        if payload is not None:
            source += f'Path({str(self.output)!r}).write_text({json.dumps(payload)!r}, encoding="utf-8")\n'
        source += f'raise SystemExit({code})\n'
        return run_with_context.main(['--report', str(self.output), '--', sys.executable, '-B', '-c', source])

    def test_fresh_pass_binds_actual_context_and_exit_code(self):
        self.assertEqual(self.run_child({'status': 'PASS', 'checks': [{'name': 'actual child completed', 'status': 'PASS'}]}), 0)
        report = json.loads(self.output.read_text(encoding='utf-8'))
        self.assertEqual(report['context'], self.context)
        self.assertEqual(report['testedPackage'], self.context['sdk'])
        self.assertEqual(report['exitCode'], 0)

    def test_existing_report_is_rejected_before_launch(self):
        self.output.write_text('{"status":"PASS"}', encoding='utf-8')
        with patch.object(run_with_context.subprocess, 'run') as child, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                run_with_context.main(['--report', str(self.output), '--', 'unused-command'])
        child.assert_not_called()
        self.assertEqual(self.output.read_text(encoding='utf-8'), '{"status":"PASS"}')

    def test_success_exit_without_new_evidence_is_blocked(self):
        self.assertEqual(self.run_child(), 1)
        report = json.loads(self.output.read_text(encoding='utf-8'))
        self.assertNotEqual(report['status'], 'PASS')
        self.assertTrue(report.get('error'))

    def test_nonzero_child_cannot_promote_its_pass_report(self):
        self.assertEqual(self.run_child({'status': 'PASS'}, 9), 1)
        report = json.loads(self.output.read_text(encoding='utf-8'))
        self.assertEqual(report['status'], 'FAIL')
        self.assertEqual(report['exitCode'], 9)

    def test_input_drift_invalidates_otherwise_passing_new_evidence(self):
        self.finish.return_value = {'status': 'FAIL', 'changes': ['sdk']}
        self.assertEqual(self.run_child({'status': 'PASS'}), 1)
        report = json.loads(self.output.read_text(encoding='utf-8'))
        self.assertEqual(report['status'], 'FAIL')
        self.assertEqual(report['identityVerification']['changes'], ['sdk'])

    def test_invalid_report_shape_is_explicitly_rejected(self):
        self.assertEqual(self.run_child(['PASS']), 1)
        report = json.loads(self.output.read_text(encoding='utf-8'))
        self.assertNotEqual(report['status'], 'PASS')
        self.assertTrue(report.get('error'))

    def test_failed_command_launch_still_produces_failed_evidence(self):
        result = run_with_context.main(['--report', str(self.output), '--', str(self.root / 'command-does-not-exist')])
        self.assertEqual(result, 1)
        report = json.loads(self.output.read_text(encoding='utf-8'))
        self.assertNotEqual(report['status'], 'PASS')
        self.assertTrue(report.get('error'))

    def test_report_outside_allowed_directory_is_rejected_before_launch(self):
        output = self.root / 'unrelated.json'
        with patch.object(run_with_context.subprocess, 'run') as child, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                run_with_context.main(['--report', str(output), '--', 'unused-command'])
        child.assert_not_called()
        self.assertFalse(output.exists())

    def test_report_that_becomes_unsafe_is_never_read_or_rewritten(self):
        original_read = Path.read_text
        def unsafe(path):
            return path == self.output and self.output.exists()
        def admitted_read(path, *args, **kwargs):
            if unsafe(path):
                raise AssertionError('Unsafe report bytes were read')
            return original_read(path, *args, **kwargs)
        with patch.object(Path, 'is_symlink', new=unsafe), patch.object(Path, 'read_text', new=admitted_read):
            with self.assertRaisesRegex(ValueError, 'unsafe output path'):
                self.run_child({'status': 'PASS'})

    def test_conflicting_child_context_is_not_rebound_to_current_inputs(self):
        result = self.run_child({'status': 'PASS', 'context': {'sdk': {'manifestSha256': 'unrelated-input'}}})
        self.assertEqual(result, 1)
        report = json.loads(self.output.read_text(encoding='utf-8'))
        self.assertNotEqual(report['status'], 'PASS')
        self.assertTrue(report.get('error'))

    def test_malformed_child_identity_verification_is_reported_as_failed_evidence(self):
        result = self.run_child({'status': 'PASS', 'identityVerification': 'PASS'})
        self.assertEqual(result, 1)
        report = json.loads(self.output.read_text(encoding='utf-8'))
        self.assertEqual(report['status'], 'FAIL')
        self.assertTrue(report.get('identityErrors'))


if __name__ == '__main__':
    unittest.main()
