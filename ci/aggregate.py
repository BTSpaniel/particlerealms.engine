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
INDIVIDUAL_COLLECTIONS = frozenset({'tests', 'cases', 'checks', 'rows', 'corpus', 'oracles'})


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


def individual_identity(row):
    if not isinstance(row, dict):
        return None
    primary = next((row[name] for name in ('id', 'caseId', 'name') if name in row), None)
    if not isinstance(primary, str) or not primary:
        return None
    qualifiers = []
    for name in ('mode', 'mount', 'package', 'fixture', 'iteration', 'cycle'):
        if name in row:
            value = row[name]
            if value is not None and type(value) not in (str, int):
                return None
            qualifiers.append((name, value))
    return (primary, *qualifiers)


def exact_case_errors(report):
    """Required schemas retain independently selected, exact case inventories."""
    schema = report.get('schema')
    if schema not in {'particle-sdk-parser-validation/v1', 'particle-sdk-public-cpu-results/v1'}:
        return []
    expected = report.get('expectedIdentities')
    if not isinstance(expected, dict):
        return ['Required report lacks its independently selected case inventory']
    errors = []

    def compare(label, actual, admitted):
        if (not isinstance(admitted, list) or not admitted or any(value is None for value in admitted)
                or len(admitted) != len(set(admitted))):
            errors.append(label + ': expected case identities are absent, invalid or duplicated')
        elif any(value is None for value in actual) or len(actual) != len(admitted) or set(actual) != set(admitted):
            errors.append(label + ': executed case identities differ from selected inventory')

    if schema == 'particle-sdk-parser-validation/v1':
        for name in ('tests', 'corpus'):
            rows, names = report.get(name), expected.get(name)
            if not isinstance(rows, list):
                errors.append(name + ': individual evidence is missing')
                continue
            actual = [row.get('name') if isinstance(row, dict) and isinstance(row.get('name'), str) else None for row in rows]
            admitted = [value if isinstance(value, str) and value else None for value in names] if isinstance(names, list) else names
            compare(name, actual, admitted)
            if name == 'corpus' and any(
                    not isinstance(row, dict) or any(
                        not isinstance(row.get(field), dict)
                        or str(row[field].get('status', '')).upper() not in {'PASS', 'PASSED'}
                        for field in ('sourceGrammar', 'browserGrammar')) for row in rows):
                errors.append('corpus: original and canonical browser grammar evidence is missing or incomplete')
        rows, names = report.get('oracles'), expected.get('oracles')
        def oracle_identity(row):
            if (not isinstance(row, dict) or not isinstance(row.get('name'), str) or not row['name']
                    or row.get('mode') not in ('source', 'emitted', 'minified')):
                return None
            return (row['name'], row['mode'])
        if not isinstance(rows, list):
            errors.append('oracles: individual evidence is missing')
        else:
            compare('oracles', [oracle_identity(row) for row in rows],
                    [oracle_identity(row) for row in names] if isinstance(names, list) else names)
        if (not isinstance(report.get('corpus'), list) or type(report.get('corpusCount')) is not int
                or report.get('corpusCount') != len(report['corpus'])):
            errors.append('corpusCount differs from individual corpus evidence')
    else:
        admitted_rows = expected.get('cpuCases')
        def cpu_identity(row):
            keys = ('mount', 'mode', 'suite', 'id')
            if not isinstance(row, dict) or any(not isinstance(row.get(name), str) or not row[name] for name in keys):
                return None
            return tuple(row[name] for name in keys)
        actual, variants, groups = [], [], []
        mounts = report.get('mounts')
        if not isinstance(mounts, list):
            return ['CPU mount evidence is missing']
        for mount in mounts:
            if not isinstance(mount, dict) or not isinstance(mount.get('suites'), list):
                errors.append('CPU suite evidence is missing')
                continue
            if str(mount.get('status', '')).upper() not in {'PASS', 'PASSED'}:
                errors.append('CPU hosting/runtime variant is not complete and passing')
            if (not isinstance(mount.get('mount'), str) or not mount['mount']
                    or not isinstance(mount.get('mode'), str) or not mount['mode']):
                errors.append('CPU hosting/runtime variant identity is invalid')
                continue
            variant = (mount['mount'], mount['mode'])
            variants.append(variant)
            for suite in mount['suites']:
                if not isinstance(suite, dict) or not isinstance(suite.get('cases'), list):
                    errors.append('CPU individual case evidence is missing')
                    continue
                if not isinstance(suite.get('id'), str) or not suite['id']:
                    errors.append('CPU suite identity is invalid')
                    continue
                cleanup = suite.get('cleanup')
                if (str(suite.get('status', '')).upper() not in {'PASS', 'PASSED'}
                        or not isinstance(cleanup, dict)
                        or str(cleanup.get('status', '')).upper() not in {'PASS', 'PASSED'}):
                    errors.append('CPU suite completion or cleanup is unconfirmed')
                if any(not isinstance(row, dict) or not isinstance(row.get('checks'), list)
                       or not row['checks'] for row in suite['cases']):
                    errors.append('CPU case has zero individual assertion evidence')
                groups.append((*variant, suite['id']))
                actual.extend(cpu_identity({'mount': variant[0], 'mode': variant[1], 'suite': suite.get('id'),
                                            'id': row.get('id') if isinstance(row, dict) else None}) for row in suite['cases'])
        admitted = [cpu_identity(row) for row in admitted_rows] if isinstance(admitted_rows, list) else admitted_rows
        compare('CPU cases', actual, admitted)
        if isinstance(admitted, list) and admitted and all(value is not None for value in admitted):
            expected_variants = {value[:2] for value in admitted}
            expected_groups = {value[:3] for value in admitted}
            if (len(variants) != len(set(variants)) or set(variants) != expected_variants
                    or expected_variants != {('/', 'source'), ('/', 'compiled'), ('/ci-nested/', 'source'), ('/ci-nested/', 'compiled')}):
                errors.append('CPU hosting/runtime variants are missing or duplicated')
            if len(groups) != len(set(groups)) or set(groups) != expected_groups:
                errors.append('CPU suite groups are missing or duplicated')
            profile = report.get('profile', {})
            if (not isinstance(profile, dict)
                    or any(type(profile.get(name)) is not int or profile[name] < 1
                           for name in ('expectedCasesPerMode', 'expectedSuites')) or any(
                    sum(value[:2] == variant for value in admitted) != profile.get('expectedCasesPerMode')
                    or len({value[2] for value in admitted if value[:2] == variant}) != profile.get('expectedSuites')
                    for variant in expected_variants)):
                errors.append('CPU profile counts differ from selected identities')
            if (type(report.get('expectedTests')) is not int or report.get('expectedTests') != len(admitted)
                    or type(report.get('testsRun')) is not int or report.get('testsRun') != len(actual)):
                errors.append('CPU expected/executed counts differ from individual evidence')
    return errors


def evidence_errors(report: dict) -> list[str]:
    errors = exact_case_errors(report)
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
                if name in {'context', 'identityVerification', 'baseline', 'historical', 'expectedIdentities'}:
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
                if name in INDIVIDUAL_COLLECTIONS and isinstance(child, list):
                    completed = [row for row in child if isinstance(row, dict)
                                 and (str(row.get('status', '')).upper() in {'PASS', 'PASSED'} or row.get('passed') is True)]
                    positive = positive or bool(completed)
                    if len(completed) != len(child):
                        errors.append(location + ' contains incomplete or failing individual evidence')
                    identities = [individual_identity(row) for row in child]
                    if any(identity is None for identity in identities):
                        errors.append(location + ' lacks stable individual case identities')
                    elif len(identities) != len(set(identities)):
                        errors.append(location + ' contains duplicate individual case identities')
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
    hosted = os.environ.get('GITHUB_RUN_ID', 'local') != 'local'
    required = sorted(REQUIRED_REPORT_NAMES) if hosted or args.expected_commit else None
    report = aggregate(reports, required=required)
    if args.expected_commit and (report.get('context') or {}).get('commit') != args.expected_commit:
        report['status'] = 'FAIL'
        report['errors'].append('Aggregate commit differs from the expected checked-out CI commit')
    if hosted:
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
