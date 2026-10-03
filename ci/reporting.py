# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Render actual JSON test outcomes into the GitHub Actions job summary."""
import argparse
import json
import os
from pathlib import Path


def cell(value):
    return str(value).replace('|', '\\|').replace('\n', ' ').replace('<', '&lt;')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path('test-results'))
    args = parser.parse_args()
    lines = ['## SDK CI results', '', '| Report | Result | Duration |', '| --- | --- | --- |']
    reports = []
    for path in sorted(args.directory.glob('*.json')):
        report = json.loads(path.read_text(encoding='utf-8'))
        reports.append((path, report))
        lines.append(f"| {cell(path.stem)} | **{cell(report.get('status', 'UNKNOWN'))}** | {cell(report.get('elapsedSeconds', '—'))} s |")
    if not reports:
        lines.append('| No test report produced | NOT RUN | — |')
    for path, report in reports:
        lines.extend(['', '### ' + path.stem, ''])
        for check in report.get('checks', []):
            lines.append(f"- **{cell(check.get('status'))}** · {cell(check.get('name'))}")
        if 'testsRun' in report:
            lines.append(f"- Tests executed: **{report['testsRun']}**. See JSON/JUnit for individual outcomes and skips.")
        for mount in report.get('mounts', []):
            lines.append(f"- **{cell(mount.get('status'))}** · {cell(mount.get('package'))} at `{cell(mount.get('mount'))}`: {len(mount.get('cases', []))} cases")
        if 'gpuSuite' in report:
            lines.append(f"- WebGPU: **{cell(report['gpuSuite'].get('status'))}**; requested mode `{cell(report.get('webgpu'))}`. Software results are functional checks, not hardware performance certification.")
        if report.get('error'):
            lines.append('- Error: ' + cell(report['error']))
    lines.extend(['', 'Download the job artifact for test-level JSON, JUnit where available, and browser screenshots.', ''])
    summary = '\n'.join(lines)
    print(summary)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as output:
            output.write(summary)


if __name__ == '__main__':
    main()
