# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Aggregate current required evidence without converting absent or skipped work into success."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET

from report_context import SCHEMA, canonical_digest, capture, digest

ROOT = Path(__file__).resolve().parents[1]
IDENTITY_FIELDS = ('repository', 'commit', 'workingTreeClean', 'workflowCommit', 'workflow', 'runId', 'runAttempt', 'recipe', 'sdk', 'template')
BAD_STATUSES = frozenset({'FAIL', 'FAILED', 'ERROR', 'SKIP', 'SKIPPED', 'NOT_RUN', 'NOT RUN',
                          'UNSUPPORTED', 'BLOCKED', 'TIMED_OUT', 'TIMEOUT', 'RUNNING', 'PENDING',
                          'XFAIL', 'XPASS', 'CANCELLED', 'NOT_CONFIRMED'})
COUNT_FAILURES = frozenset({'skipped', 'skipCount', 'skippedCount', 'notRunCount', 'blockedCount',
                            'failCount', 'failures', 'failed', 'errors', 'discoveryErrors',
                            'expectedFailures', 'unexpectedSuccesses'})
STANDARD_REPORTS = {
    'distribution': ('schema', 'particle-sdk-ci-distribution/v1'),
    'changes': ('schema', 'particle-sdk-change-report/v1'),
    'windows': ('format', 'particle-python-tests/v1'),
    'ubuntu': ('format', 'particle-python-tests/v1'),
    'macos': ('format', 'particle-python-tests/v1'),
    'browser-off': ('schema', 'particle-sdk-ci-browser/v1'),
    'browser-software': ('schema', 'particle-sdk-ci-browser/v1'),
    'parser': ('schema', 'particle-sdk-parser-validation/v1'),
    'cpu': ('schema', 'particle-sdk-public-cpu-results/v1'),
    'candidate': ('schema', 'particle-sdk-candidate-validation/v1'),
    'candidate-cpu': ('schema', 'particle-sdk-public-cpu-results/v1'),
    'candidate-parser': ('schema', 'particle-sdk-parser-validation/v1'),
}
REQUIRED_REPORT_NAMES = frozenset(STANDARD_REPORTS)
CANDIDATE_REPORT_NAMES = frozenset({'candidate', 'candidate-cpu', 'candidate-parser'})


def standard_errors(name: str, report: dict) -> list[str]:
    """Standard CI names admit only their actual report type and requested mode."""
    errors = []
    context = report.get('context') if isinstance(report.get('context'), dict) else {}
    gpu_suite = report.get('gpuSuite') if isinstance(report.get('gpuSuite'), dict) else {}
    if name in STANDARD_REPORTS:
        field, schema = STANDARD_REPORTS[name]
        if report.get(field) != schema:
            errors.append('Standard report name has the wrong schema or type')
    if name in CANDIDATE_REPORT_NAMES and not context.get('candidate'):
        errors.append('Candidate report requires the rebuilt tested package identity')
    if name in {'browser-off', 'browser-software'}:
        mode = name.removeprefix('browser-')
        expected = 'NOT_RUN' if mode == 'off' else 'PASS'
        if report.get('webgpu') != mode or gpu_suite.get('status') != expected:
            errors.append('Browser report does not match the required off/software mode')
    return errors


def valid_identity(value, *, directory: bool, manifest: bool = False) -> bool:
    if not isinstance(value, dict) or value.get('kind') != ('directory' if directory else 'file'):
        return False
    key = 'inventorySha256' if directory else 'sha256'
    if not isinstance(value.get(key), str) or not re.fullmatch(r'[0-9a-f]{64}', value[key]):
        return False
    if type(value.get('bytes')) is not int or value['bytes'] < 0:
        return False
    if directory and (type(value.get('files')) is not int or value['files'] < 1
                      or 'sha256' in value or 'archiveSha256' in value):
        return False
    return not manifest or isinstance(value.get('manifestSha256'), str) and bool(re.fullmatch(r'[0-9a-f]{64}', value['manifestSha256']))


def evidence_errors(report: dict) -> list[str]:
    errors = []
    if str(report.get('status', '')).upper() not in {'PASS', 'PASSED'}:
        errors.append('Top-level evidence is not passing')
    for name in ('testsRun', 'executedCount', 'testCount', 'totalCount'):
        if name in report and (type(report[name]) is not int or report[name] < 1):
            errors.append('Required report has zero or invalid ' + name)
    if 'counts' in report and isinstance(report['counts'], dict) and 'run' in report['counts']:
        if type(report['counts']['run']) is not int or report['counts']['run'] < 1:
            errors.append('Required report collected zero tests')
    positive = False

    def visit(value, trail='report'):
        nonlocal positive
        if isinstance(value, dict):
            # Context and historical inputs describe identity, not executed work.
            for name, child in value.items():
                if name in {'context', 'identityVerification', 'baseline', 'historical'}:
                    continue
                if name == 'gpuSuite' and report.get('webgpu') == 'off' and isinstance(child, dict) and child.get('status') == 'NOT_RUN':
                    continue
                location = trail + '.' + name
                if name == 'status' and str(child).upper() in BAD_STATUSES:
                    errors.append(location + ' is ' + str(child))
                if name in {'passed', 'ok'} and child is False:
                    errors.append(location + ' contradicts passing status')
                if name in COUNT_FAILURES:
                    if child is True or type(child) is int and child != 0 or isinstance(child, (list, dict)) and child:
                        errors.append(location + ' contains failures or skipped work')
                    elif not isinstance(child, (int, list, dict)):
                        errors.append(location + ' has an invalid failure count')
                if name in {'testsRun', 'run', 'passed', 'passCount', 'executedCount', 'testCount', 'totalCount'} and type(child) is int:
                    positive = positive or child > 0
                    if child < 0:
                        errors.append(location + ' is negative')
                if name in {'tests', 'cases', 'checks', 'rows'} and isinstance(child, list):
                    completed = [row for row in child if isinstance(row, dict)
                                 and (str(row.get('status', '')).upper() in {'PASS', 'PASSED'} or row.get('passed') is True)]
                    positive = positive or bool(completed)
                    if len(completed) != len(child):
                        errors.append(location + ' contains incomplete or failing individual evidence')
                visit(child, location)
            for selected in ('selectedCount', 'expectedCount'):
                if selected in value and 'executedCount' in value and value[selected] != value['executedCount']:
                    errors.append(trail + ': selected/expected count differs from executed count')
            if 'testsRun' in value and 'tests' in value and isinstance(value['tests'], list) and value['testsRun'] != len(value['tests']):
                errors.append(trail + ': test count differs from individual evidence')
            if trail.endswith('.counts') and 'expected' in value and value.get('expected') != value.get('run'):
                errors.append(trail + ': expected count differs from run count')
        elif isinstance(value, list):
            for index, child in enumerate(value):
                visit(child, trail + f'[{index}]')

    visit(report)
    if not positive:
        errors.append('Required report has zero positive execution evidence')
    return errors


def aggregate(reports: dict[str, dict | None], *, required: list[str] | None = None) -> dict:
    required = list(reports) if required is None else list(required)
    errors, records, reference, candidate = [], [], None, None
    if not required or len(required) != len(set(required)):
        errors.append('Required evidence selection is empty or duplicated')
    for name in required:
        report = reports.get(name)
        problems = []
        if not isinstance(report, dict):
            problems.append('Required report is missing')
        else:
            problems.extend(standard_errors(name, report))
            problems.extend(evidence_errors(report))
            context = report.get('context')
            finish = report.get('identityVerification', {})
            if not isinstance(context, dict) or context.get('schema') != SCHEMA:
                problems.append('Required report lacks current identity context')
            elif (not isinstance(finish, dict) or finish.get('status') != 'PASS' or finish.get('changes') != []
                  or finish.get('context') != context):
                problems.append('Required report lacks unchanged finish identity verification')
            else:
                if (not isinstance(context.get('commit'), str) or not re.fullmatch(r'[0-9a-f]{40}', context['commit'])
                        or any(not isinstance(context.get(key), str) or not context[key] for key in ('repository', 'workflow', 'runId', 'runAttempt', 'job'))
                        or not valid_identity(context.get('recipe'), directory=True)
                        or not valid_identity(context.get('sdk'), directory=True, manifest=True)
                        or context.get('template') is not None and not valid_identity(context['template'], directory=False)
                        or context.get('candidate') is not None and not valid_identity(context['candidate'], directory=True, manifest=True)):
                    problems.append('Required report has incomplete input identity')
                if context.get('runId') != 'local' and context.get('workingTreeClean') is not True:
                    problems.append('Hosted required evidence has a dirty or unverified working tree')
                identity = {key: context.get(key) for key in IDENTITY_FIELDS}
                if reference is None:
                    reference = identity
                elif identity != reference:
                    problems.append('Required reports mix commits, runs, recipes or shipped input identities')
                if context.get('candidate') is not None:
                    if candidate is None:
                        candidate = context['candidate']
                    elif candidate != context['candidate']:
                        problems.append('Required reports mix candidate package identities')
                if report.get('testedPackage') != (context.get('candidate') or context.get('sdk')):
                    problems.append('Tested package identity differs from report context')
            records.append({'name': name, 'status': report.get('status', 'UNKNOWN'),
                            'reportSha256': canonical_digest(report), 'errors': problems})
        if report is None:
            records.append({'name': name, 'status': 'MISSING', 'errors': problems})
        errors.extend(name + ': ' + problem for problem in problems)
    return {'schema': 'particle-sdk-ci-aggregate/v1', 'status': 'FAIL' if errors else 'PASS',
            'requiredCount': len(required), 'executedCount': sum(isinstance(reports.get(name), dict) for name in required),
            'context': reference, 'candidate': candidate, 'reports': records, 'errors': errors,
            'scope': 'Current required code-validation evidence; historical release receipts remain separate.'}


def write_junit(report: dict, output: Path) -> None:
    failures = sum(bool(row['errors']) for row in report['reports'])
    extra = int(report['status'] != 'PASS')
    suite = ET.Element('testsuite', name='Required SDK code-validation reports',
                       tests=str(len(report['reports']) + extra), failures=str(failures + extra))
    for row in report['reports']:
        case = ET.SubElement(suite, 'testcase', name=row['name'], classname='sdk.required_report')
        ET.SubElement(case, 'system-out').text = 'Original report status: ' + str(row['status'])
        if row['errors']:
            ET.SubElement(case, 'failure', message='Required evidence failed').text = '\n'.join(row['errors'])
    if extra:
        case = ET.SubElement(suite, 'testcase', name='Aggregate identity and completion gate', classname='sdk.aggregate')
        ET.SubElement(case, 'failure', message='Aggregate did not pass').text = '\n'.join(report['errors'])
    ET.ElementTree(suite).write(output, encoding='utf-8', xml_declaration=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', action='append', required=True, help='Required unique name=JSON path')
    parser.add_argument('--output', type=Path, default=Path('test-results/aggregate.json'))
    parser.add_argument('--expected-commit', help='Require the checked-out CI commit on every current report')
    args = parser.parse_args(argv)
    if args.output.resolve().is_relative_to((ROOT / 'engine-sdk').resolve()):
        parser.error('--output must be outside engine-sdk/')
    reports, sources = {}, {}
    for item in args.report:
        name, separator, value = item.partition('=')
        if not separator or not name or name in reports:
            parser.error('--report requires a unique name=path')
        path = Path(value)
        try:
            reports[name] = json.loads(path.read_text(encoding='utf-8'))
            sources[name] = {'path': str(path), 'artifactPath': os.path.relpath(path.resolve(), args.output.parent.resolve()).replace('\\', '/'), 'sha256': digest(path)}
        except (OSError, ValueError) as error:
            reports[name] = {'status': 'FAIL', 'error': str(error)} if path.exists() else None
    report = aggregate(reports)
    if args.expected_commit and (report.get('context') or {}).get('commit') != args.expected_commit:
        report['status'] = 'FAIL'
        report['errors'].append('Aggregate commit differs from the expected checked-out CI commit')
    if os.environ.get('GITHUB_RUN_ID', 'local') != 'local':
        # Agreement among children alone also admits an entirely stale artifact set.
        # Bind hosted evidence to this aggregation attempt and the actual checkout bytes.
        try:
            current = capture(ROOT)
            report['aggregationContext'] = current
            different = [field for field in IDENTITY_FIELDS
                         if (report.get('context') or {}).get(field) != current.get(field)]
            if different:
                report['status'] = 'FAIL'
                report['errors'].append('Aggregate evidence differs from current checkout context: ' + ', '.join(different))
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            report['status'] = 'FAIL'
            report['errors'].append('Current aggregation context is unavailable: ' + str(error))
    report['sources'] = sources
    args.output.parent.mkdir(parents=True, exist_ok=True)
    junit = args.output.with_suffix('.xml')
    write_junit(report, junit)
    report['junit'] = junit.name
    args.output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))
    return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
