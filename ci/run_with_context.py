# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Execute an existing check and bind only its newly produced evidence."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
from report_context import capture, verify_finish

ROOT = Path(__file__).resolve().parents[1]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    report_path = args.report.resolve()
    if not command or report_path.exists() or not report_path.is_relative_to(ROOT / 'test-results'):
        parser.error('A command and fresh report below test-results are required')
    context = capture(ROOT)
    launch_error = None
    try:
        completed = subprocess.run(command, cwd=ROOT)
        exit_code = completed.returncode
    except OSError as error:
        launch_error, exit_code = str(error), -1
    try:
        if report_path.is_symlink() or not report_path.resolve().is_relative_to(ROOT / 'test-results'):
            raise ValueError('Report path became unsafe during execution')
        report = json.loads(report_path.read_text(encoding='utf-8'))
        if not isinstance(report, dict):
            raise ValueError('Report must be a JSON object')
    except (OSError, ValueError) as error:
        report = {'status': 'BLOCKED', 'error': str(error), 'checks': []}
    contradictions = []
    if 'context' in report and report['context'] != context:
        contradictions.append('Child context differs from the execution inputs')
    if 'testedPackage' in report and report['testedPackage'] != context['sdk']:
        contradictions.append('Child tested package differs from the execution inputs')
    child_verification = report.get('identityVerification')
    if 'identityVerification' in report and (not isinstance(child_verification, dict)
            or child_verification.get('status') != 'PASS'
            or child_verification.get('context') != context
            or child_verification.get('changes') != []):
        contradictions.append('Child identity verification is incomplete or contradicts current inputs')
    report['context'] = context
    report['identityVerification'] = verify_finish(context, ROOT)
    report['testedPackage'] = context['sdk']
    report['exitCode'] = exit_code
    if launch_error:
        report['error'] = launch_error
    if contradictions:
        report['identityErrors'] = contradictions
        report['error'] = '; '.join(contradictions)
    if exit_code or contradictions or report['identityVerification']['status'] != 'PASS':
        report['status'] = 'FAIL'
    if report_path.is_symlink() or not report_path.resolve().is_relative_to(ROOT / 'test-results'):
        raise ValueError('Refusing to write through an unsafe output path')
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    return 0 if report.get('status') == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
