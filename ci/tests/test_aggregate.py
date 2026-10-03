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
    if job in {'parser', 'candidate-parser'}:
        expected = {'tests': ['parser.tests.first', 'parser.tests.second'],
                    'corpus': ['engine/public.js', 'plauna/public.js'],
                    'oracles': [{'name': 'nested-regex', 'mode': mode}
                                for mode in ('source', 'emitted', 'minified')]}
        report.update(expectedIdentities=expected, testsRun=2, corpusCount=2,
                      tests=[{'name': name, 'status': 'PASS'} for name in expected['tests']],
                      corpus=[{'name': name, 'status': 'PASS', 'sourceGrammar': {'status': 'PASS'},
                               'browserGrammar': {'status': 'PASS'}} for name in expected['corpus']],
                      oracles=[{**row, 'status': 'PASS'} for row in expected['oracles']])
    return report


def passing_cpu_report():
    report = passing_report('cpu')
    expected, observed = [], []
    for mount in ('/', '/ci-nested/'):
        for mode in ('source', 'compiled'):
            suites = []
            for suite in ('json', 'persistence'):
                cases = []
                for identity in ('case:first', 'case:second'):
                    expected.append({'mount': mount, 'mode': mode, 'suite': suite, 'id': identity})
                    cases.append({'id': identity, 'status': 'PASS',
                                  'checks': [{'name': 'assertion completed', 'passed': True}]})
                suites.append({'id': suite, 'status': 'PASS', 'cases': cases,
                               'cleanup': {'status': 'passed'}})
            observed.append({'mount': mount, 'mode': mode, 'status': 'PASS', 'suites': suites})
    report.update(expectedIdentities={'cpuCases': expected}, mounts=observed,
                  profile={'expectedCasesPerMode': 4, 'expectedSuites': 2}, expectedTests=16, testsRun=16)
    return report


class IndividualCaseAdmissionTests(unittest.TestCase):
    def assert_failed(self, report, message):
        result = aggregate({'required': report})
        self.assertEqual(result['status'], 'FAIL')
        self.assertIn(message, ' '.join(result['errors']))

    def test_generic_duplicate_checks_tests_rows_and_cases_are_rejected(self):
        for collection in ('checks', 'tests', 'rows', 'cases'):
            report = passing_report()
            report[collection] = [{'name': 'one actual case', 'status': 'PASS'}] * 2
            with self.subTest(collection=collection):
                self.assert_failed(report, 'duplicate individual case identities')

    def test_missing_or_unhashable_generic_case_identity_fails_without_crashing(self):
        for row in ({'status': 'PASS'}, {'name': 'case', 'mode': [], 'status': 'PASS'},
                    {'id': False, 'name': 'case', 'status': 'PASS'}):
            report = passing_report()
            report['checks'] = [row]
            with self.subTest(row=row):
                self.assert_failed(report, 'stable individual case identities')

    def test_parser_exact_inventory_and_each_oracle_runtime_mode_pass(self):
        report = passing_report('parser')
        self.assertEqual(aggregate({'parser': report})['status'], 'PASS')

    def test_parser_missing_or_substituted_cases_and_changed_counts_are_rejected(self):
        for collection in ('tests', 'corpus', 'oracles'):
            for mutation in ('remove', 'substitute', 'duplicate'):
                report = passing_report('parser')
                if mutation == 'remove':
                    report[collection].pop()
                elif mutation == 'substitute':
                    report[collection][0]['name'] = 'different case with a passing label'
                else:
                    report[collection].append(deepcopy(report[collection][0]))
                with self.subTest(collection=collection, mutation=mutation):
                    self.assert_failed(report, 'case identities')
        report = passing_report('parser')
        report['corpusCount'] = 999
        self.assert_failed(report, 'corpusCount')

    def test_missing_duplicate_or_invalid_selected_parser_inventory_fails(self):
        for mutation in ('absent', 'duplicate', 'invalid'):
            report = passing_report('parser')
            if mutation == 'absent':
                report.pop('expectedIdentities')
            elif mutation == 'duplicate':
                report['expectedIdentities']['tests'].append('parser.tests.first')
            else:
                report['expectedIdentities']['oracles'][0]['mode'] = 'unexecuted'
            with self.subTest(mutation=mutation):
                self.assert_failed(report, 'inventory' if mutation == 'absent' else 'expected case identities')

    def test_parser_missing_or_failed_original_and_canonical_grammar_fails(self):
        for field in ('sourceGrammar', 'browserGrammar'):
            for mutation in ('absent', 'failed', 'empty'):
                report = passing_report('parser')
                if mutation == 'absent':
                    report['corpus'][0].pop(field)
                else:
                    report['corpus'][0][field] = {} if mutation == 'empty' else {'status': 'FAIL'}
                with self.subTest(field=field, mutation=mutation):
                    self.assert_failed(report, 'browser grammar evidence is missing or incomplete')

    def test_cpu_repeated_ids_in_distinct_suite_mode_mount_groups_pass(self):
        report = passing_cpu_report()
        self.assertEqual(aggregate({'cpu': report})['status'], 'PASS')

    def test_cpu_missing_case_even_with_adjusted_counts_fails_selected_inventory(self):
        report = passing_cpu_report()
        report['mounts'][0]['suites'][0]['cases'].pop()
        report['testsRun'] -= 1
        report['expectedTests'] -= 1
        self.assert_failed(report, 'executed case identities differ')

    def test_cpu_missing_or_duplicated_mount_and_suite_groups_fail(self):
        for mutation in ('missing-mount', 'duplicate-mount', 'missing-suite', 'duplicate-suite'):
            report = passing_cpu_report()
            if mutation == 'missing-mount':
                report['mounts'].pop()
            elif mutation == 'duplicate-mount':
                report['mounts'][1] = deepcopy(report['mounts'][0])
            elif mutation == 'missing-suite':
                report['mounts'][0]['suites'].pop()
            else:
                report['mounts'][0]['suites'][1] = deepcopy(report['mounts'][0]['suites'][0])
            with self.subTest(mutation=mutation):
                self.assert_failed(report, 'case identities')

    def test_cpu_duplicate_case_and_assertions_fail(self):
        for collection in ('cases', 'checks'):
            report = passing_cpu_report()
            suite = report['mounts'][0]['suites'][0]
            rows = suite['cases'] if collection == 'cases' else suite['cases'][0]['checks']
            rows.append(deepcopy(rows[0]))
            with self.subTest(collection=collection):
                self.assert_failed(report, 'duplicate individual case identities')

    def test_cpu_zero_assertions_missing_cleanup_and_missing_inventory_fail(self):
        for mutation in ('zero-assertions', 'missing-cleanup', 'missing-inventory'):
            report = passing_cpu_report()
            suite = report['mounts'][0]['suites'][0]
            if mutation == 'zero-assertions':
                suite['cases'][0]['checks'] = []
            elif mutation == 'missing-cleanup':
                suite.pop('cleanup')
            else:
                report.pop('expectedIdentities')
            with self.subTest(mutation=mutation):
                self.assert_failed(report, {'zero-assertions': 'zero individual assertion',
                    'missing-cleanup': 'cleanup is unconfirmed', 'missing-inventory': 'selected case inventory'}[mutation])

    def test_cpu_invalid_mount_suite_and_count_fields_fail_without_crashing(self):
        for mutation in ('mount', 'mode', 'suite', 'count'):
            report = passing_cpu_report()
            if mutation == 'suite':
                report['mounts'][0]['suites'][0]['id'] = []
            elif mutation == 'count':
                report['profile']['expectedSuites'] = True
            else:
                report['mounts'][0][mutation] = {'invalid': 'identity'}
            with self.subTest(mutation=mutation):
                self.assert_failed(report, 'identity is invalid' if mutation != 'count' else 'profile counts')


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
