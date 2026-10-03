# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Required aggregate evidence fails closed on contradictory and mixed identities."""
from copy import deepcopy
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from aggregate import STANDARD_REPORTS, aggregate, write_junit
from report_context import SCHEMA, capture


def passing_report(job='test'):
    context = {'schema': SCHEMA, 'repository': 'owner/repo', 'commit': 'a' * 40,
               'workingTreeClean': True,
               'workflowCommit': 'a' * 40, 'workflow': 'CI', 'runId': '10', 'runAttempt': '1', 'job': job,
               'recipe': {'kind': 'directory', 'inventorySha256': 'b' * 64, 'files': 1, 'bytes': 10},
               'sdk': {'kind': 'directory', 'inventorySha256': 'c' * 64, 'files': 2, 'bytes': 20, 'manifestSha256': 'd' * 64},
               'candidate': None, 'template': {'kind': 'file', 'sha256': 'e' * 64, 'bytes': 30}}
    report = {'status': 'PASS', 'checks': [{'name': 'actual check', 'status': 'PASS'}],
            'context': context, 'testedPackage': deepcopy(context['sdk']),
            'identityVerification': {'status': 'PASS', 'changes': [], 'context': deepcopy(context)}}
    if job in STANDARD_REPORTS:
        field, value = STANDARD_REPORTS[job]
        report[field] = value
    return report


class AggregateTests(unittest.TestCase):
    def test_different_jobs_of_one_actual_input_run_aggregate(self):
        report = aggregate({'parser': passing_report('parser'), 'sdk': passing_report('sdk')})
        self.assertEqual(report['status'], 'PASS')
        self.assertEqual(report['requiredCount'], 2)

    def test_missing_failed_zero_skipped_and_false_checks_are_rejected(self):
        variants = [None, {'status': 'PASS'}, passing_report(), passing_report(), passing_report(), passing_report()]
        variants[2]['status'] = 'FAIL'
        variants[3]['testsRun'] = 0
        variants[4]['checks'][0]['status'] = 'SKIP'
        variants[5]['checks'][0]['passed'] = False
        for report in variants:
            with self.subTest(report=report):
                self.assertEqual(aggregate({'required': report})['status'], 'FAIL')

    def test_mixed_commit_run_recipe_sdk_and_finish_drift_fail(self):
        for name in ('commit', 'runId', 'recipe', 'sdk'):
            changed = passing_report()
            changed['context'][name] = 'different'
            changed['identityVerification']['context'] = deepcopy(changed['context'])
            with self.subTest(name=name):
                self.assertEqual(aggregate({'first': passing_report(), 'changed': changed})['status'], 'FAIL')
        drift = passing_report()
        drift['identityVerification']['status'] = 'FAIL'
        self.assertEqual(aggregate({'drift': drift})['status'], 'FAIL')

    def test_candidate_only_reports_agree_without_relabeling_published_fixture(self):
        candidate = passing_report('candidate')
        candidate['context']['candidate'] = {'kind': 'directory', 'inventorySha256': 'f' * 64,
                                             'files': 3, 'bytes': 25, 'manifestSha256': '1' * 64}
        candidate['testedPackage'] = deepcopy(candidate['context']['candidate'])
        candidate['identityVerification']['context'] = deepcopy(candidate['context'])
        self.assertEqual(aggregate({'fixture': passing_report(), 'candidate': candidate})['status'], 'PASS')
        candidate['testedPackage'] = candidate['context']['sdk']
        self.assertEqual(aggregate({'candidate': candidate})['status'], 'FAIL')

    def test_missing_subject_incomplete_rows_and_fake_directory_archive_fail(self):
        variants = [passing_report() for _ in range(5)]
        del variants[0]['testedPackage']
        variants[1]['checks'] = [{}]
        variants[2]['counts'] = {'expected': 2, 'run': 1, 'errors': '0'}
        variants[3]['context']['sdk']['archiveSha256'] = 'f' * 64
        variants[3]['identityVerification']['context'] = deepcopy(variants[3]['context'])
        variants[4]['checks'][0]['status'] = 'XFAIL'
        for report in variants:
            with self.subTest(report=report):
                self.assertEqual(aggregate({'required': report})['status'], 'FAIL')

    def test_gpu_scope_exemption_is_only_for_explicit_off_mode(self):
        report = passing_report()
        report.update(webgpu='off', gpuSuite={'status': 'NOT_RUN', 'reason': 'Explicit off mode'})
        self.assertEqual(aggregate({'off': report})['status'], 'PASS')
        report['webgpu'] = 'software'
        self.assertEqual(aggregate({'software': report})['status'], 'FAIL')

    def test_dirty_work_is_honest_local_evidence_but_not_hosted_evidence(self):
        report = passing_report()
        report['context']['workingTreeClean'] = False
        report['identityVerification']['context'] = deepcopy(report['context'])
        self.assertEqual(aggregate({'hosted': report})['status'], 'FAIL')
        report['context']['runId'] = 'local'
        report['identityVerification']['context'] = deepcopy(report['context'])
        self.assertEqual(aggregate({'local': report})['status'], 'PASS')

    def test_standard_name_type_substitution_candidate_identity_and_gpu_modes_fail(self):
        distribution = passing_report('distribution')
        self.assertEqual(aggregate({'cpu': distribution})['status'], 'FAIL')
        candidate = passing_report('candidate')
        self.assertEqual(aggregate({'candidate': candidate})['status'], 'FAIL')
        browser = passing_report('browser-off')
        browser.update(webgpu='off', gpuSuite={'status': 'NOT_RUN'})
        self.assertEqual(aggregate({'browser-off': browser})['status'], 'PASS')
        self.assertEqual(aggregate({'browser-software': browser})['status'], 'FAIL')

    def test_historical_pass_is_readable_but_not_current_required_evidence(self):
        result = aggregate({'historical': {'status': 'PASS', 'checks': [{'name': 'prior run', 'status': 'PASS'}]}})
        self.assertEqual(result['reports'][0]['status'], 'PASS')
        self.assertEqual(result['status'], 'FAIL')
        self.assertIn('current identity context', ' '.join(result['errors']))

    def test_junit_keeps_original_status_and_failed_required_gate(self):
        skipped = passing_report()
        skipped['status'] = 'SKIP'
        report = aggregate({'required': skipped, 'missing': None})
        with tempfile.TemporaryDirectory(prefix='sdk-aggregate-junit-') as temporary:
            path = Path(temporary) / 'aggregate.xml'
            write_junit(report, path)
            root = ET.parse(path).getroot()
            self.assertEqual(root.get('tests'), '3')
            self.assertEqual(root.get('failures'), '3')
            self.assertEqual(root.find('testcase/system-out').text, 'Original report status: SKIP')


class HostedAggregateCliTests(unittest.TestCase):
    """Use real Git checkouts and the actual CLI to reject a consistent stale set."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='sdk-hosted-aggregate-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.results = self.root / 'test-results'
        for name, text in {'.gitignore': '/test-results/\n', 'ci/recipe.py': 'value = 1\n',
                           'engine-sdk/manifest.json': '{}', 'engine-sdk/code.js': 'export const value = 1;',
                           'Template.zip': 'accepted template bytes'}.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding='utf-8')
        for name in ('aggregate.py', 'report_context.py'):
            shutil.copyfile(Path(__file__).resolve().parents[1] / name, self.root / 'ci' / name)
        for arguments in (('init', '-q'), ('config', 'user.name', 'Local CI fixture'),
                          ('config', 'user.email', 'ci-fixture@example.invalid'), ('add', '.'),
                          ('commit', '-qm', 'Actual hosted aggregate fixture')):
            self.git(*arguments)
        self.environment = {name: value for name, value in os.environ.items() if not name.startswith('GITHUB_')}
        self.environment.update(GITHUB_REPOSITORY='owner/repo', GITHUB_SHA=self.git('rev-parse', 'HEAD'),
                                GITHUB_WORKFLOW='CI', GITHUB_RUN_ID='100', GITHUB_RUN_ATTEMPT='1',
                                GITHUB_JOB='aggregate')
        self.results.mkdir()

    def git(self, *arguments):
        return subprocess.run(['git', *arguments], cwd=self.root, check=True, capture_output=True,
                              text=True, timeout=30).stdout.strip()

    def current_context(self):
        with patch.dict(os.environ, self.environment, clear=True):
            return capture(self.root)

    def run_cli(self, context, *, environment=None):
        arguments = [sys.executable, '-B', str(self.root / 'ci/aggregate.py'),
                     '--expected-commit', self.git('rev-parse', 'HEAD'),
                     '--output', str(self.results / 'aggregate.json')]
        for name in ('first', 'second'):
            child = passing_report(name)
            child['context'] = deepcopy(context)
            child['context']['job'] = name
            child['testedPackage'] = deepcopy(context['sdk'])
            child['identityVerification']['context'] = deepcopy(child['context'])
            path = self.results / (name + '.json')
            path.write_text(json.dumps(child), encoding='utf-8')
            arguments.extend(['--report', name + '=' + str(path)])
        result = subprocess.run(arguments, cwd=self.root, env=environment or self.environment,
                                capture_output=True, text=True, timeout=30)
        self.assertIn(result.returncode, (0, 1), result.stderr)
        return result.returncode, json.loads((self.results / 'aggregate.json').read_text(encoding='utf-8'))

    def test_current_hosted_checkout_and_custom_report_names_pass(self):
        context = self.current_context()
        code, report = self.run_cli(context)
        self.assertEqual(code, 0)
        self.assertEqual(report['status'], 'PASS')
        self.assertEqual(report['aggregationContext'], context)

    def test_consistent_prior_attempt_run_and_requested_commit_fail(self):
        old = self.current_context()
        for field, value in (('GITHUB_RUN_ATTEMPT', '2'), ('GITHUB_RUN_ID', '101'),
                             ('GITHUB_SHA', 'f' * 40)):
            with self.subTest(field=field):
                current = dict(self.environment, **{field: value})
                code, report = self.run_cli(old, environment=current)
                self.assertEqual(code, 1)
                self.assertEqual(report['status'], 'FAIL')
                self.assertTrue(all(not row['errors'] for row in report['reports']))
                expected = {'GITHUB_RUN_ATTEMPT': 'runAttempt', 'GITHUB_RUN_ID': 'runId',
                            'GITHUB_SHA': 'workflowCommit'}[field]
                self.assertIn(expected, ' '.join(report['errors']))

    def test_consistent_stale_sdk_recipe_and_template_fail_current_checkout_binding(self):
        for field, path in (('sdk', 'engine-sdk/code.js'), ('recipe', 'ci/recipe.py'),
                            ('template', 'Template.zip')):
            with self.subTest(field=field):
                stale = self.current_context()
                source = self.root / path
                source.write_text(source.read_text(encoding='utf-8') + '\nchanged actual bytes\n', encoding='utf-8')
                self.git('add', path)
                self.git('commit', '-qm', 'Changed actual ' + field)
                commit = self.git('rev-parse', 'HEAD')
                self.environment['GITHUB_SHA'] = commit
                # A fresh commit label does not turn old input hashes into current evidence.
                stale.update(commit=commit, workflowCommit=commit)
                code, report = self.run_cli(stale)
                self.assertEqual(code, 1)
                self.assertTrue(all(not row['errors'] for row in report['reports']))
                self.assertEqual(report['errors'], [
                    'Aggregate evidence differs from current checkout context: ' + field])

    def test_local_cli_keeps_standalone_aggregation_usable(self):
        context = passing_report()['context']
        environment = {name: value for name, value in self.environment.items() if not name.startswith('GITHUB_')}
        context['commit'] = self.git('rev-parse', 'HEAD')
        code, report = self.run_cli(context, environment=environment)
        self.assertEqual(code, 0)
        self.assertNotIn('aggregationContext', report)


if __name__ == '__main__':
    unittest.main()
