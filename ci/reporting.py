# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Render actual JSON test outcomes into the GitHub Actions job summary."""
import argparse
import html
import json
import os
from pathlib import Path
from urllib.parse import quote


def cell(value):
    return html.escape(str(value)).replace('|', '\\|').replace('\n', ' ')


def load_reports(paths):
    reports = []
    pending, seen = list(paths), set()
    while pending:
        path = pending.pop(0)
        if path.resolve() in seen:
            continue
        seen.add(path.resolve())
        try:
            value = json.loads(path.read_text(encoding='utf-8'))
            if not isinstance(value, dict):
                raise ValueError('Report must be a JSON object')
        except (OSError, ValueError) as error:
            value = {'status': 'FAIL', 'error': str(error), 'scope': 'Report could not be read'}
        reports.append((path, value))
        if value.get('schema') == 'particle-sdk-ci-aggregate/v1':
            for source in value.get('sources', {}).values():
                relative = source.get('artifactPath') if isinstance(source, dict) else None
                if isinstance(relative, str):
                    child = (path.parent / relative).resolve()
                    if child.is_relative_to(path.parent.resolve()):
                        pending.append(child)
    return reports


def write_dashboard(reports, output):
    """Render saved reports, including unbound historical evidence, without invented results."""
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = []
    for path, report in reports:
        relative = os.path.relpath(path.resolve(), output.parent.resolve()).replace('\\', '/')
        context = report.get('context') or {}
        current = context.get('schema') == 'particle-sdk-report-context/v1' or report.get('schema') == 'particle-sdk-ci-aggregate/v1' and bool(context)
        entry = {'name': path.stem, 'url': quote(relative, safe='/.'), 'report': report,
                 'evidenceKind': 'current context' if current else 'historical or unbound'}
        if isinstance(report.get('junit'), str):
            # Uploaded child artifacts retain the actual XML beside their JSON.
            candidates = [path.parent / Path(report['junit']).name, path.parent / report['junit']]
            junit = next((item.resolve() for item in candidates if item.is_file()
                          and item.resolve().is_relative_to(output.parent.resolve())), None)
            if junit is not None:
                entry['junitUrl'] = quote(os.path.relpath(junit, output.parent.resolve()).replace('\\', '/'), safe='/.')
        payload.append(entry)
    data = json.dumps(payload, ensure_ascii=True, allow_nan=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    document = '''<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>SDK validation reports</title>
<style>body{font:16px/1.5 system-ui;margin:2rem;max-width:1200px;background:#111827;color:#e5e7eb}
a{color:#7dd3fc}select{font:inherit;padding:.4rem}details{margin:1rem 0;padding:1rem;background:#1f2937;border-radius:.5rem}
summary{cursor:pointer;font-weight:700}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px} .status{font-weight:700}</style>
<h1>SDK validation reports</h1><p>Saved outcomes and byte identities. Historical or unbound reports do not satisfy current required gates.</p>
<label>Show <select id="filter"><option value="all">All reports</option><option value="PASS">Passing</option><option value="other">Other outcomes</option></select></label>
<p id="counts"></p><main id="reports"></main>
<script type="application/json" id="data">__DATA__</script>
<script>
const records=JSON.parse(document.querySelector('#data').textContent),root=document.querySelector('#reports');
function render(){root.replaceChildren();const filter=document.querySelector('#filter').value;
const passed=x=>['PASS','PASSED'].includes(String(x.report.status).toUpperCase());
const shown=records.filter(x=>filter==='all'||(filter==='PASS'?passed(x):!passed(x)));
document.querySelector('#counts').textContent=shown.length+' of '+records.length+' saved reports';
for(const entry of shown){const box=document.createElement('details'),heading=document.createElement('summary');
heading.textContent=entry.name+' · '+(entry.report.status??'UNKNOWN')+' · '+entry.evidenceKind;box.append(heading);
const link=document.createElement('a');link.href=entry.url;link.textContent='Open original JSON';box.append(link);
if(entry.junitUrl){const space=document.createTextNode(' · '),junit=document.createElement('a');junit.href=entry.junitUrl;junit.textContent='Download actual JUnit XML';box.append(space,junit)}
const scope=document.createElement('p');scope.textContent=entry.report.scope??'Scope is recorded in the original report';box.append(scope);
const context=entry.report.context;if(context){const identity=document.createElement('p');identity.textContent='Commit '+(context.commit??'unavailable')+' · run '+(context.runId??'local')+' · job '+(context.job??'aggregate');box.append(identity)}
const pre=document.createElement('pre');pre.textContent=JSON.stringify(entry.report,null,2);box.append(pre);root.append(box)}}
document.querySelector('#filter').addEventListener('change',render);render();
</script></html>'''
    output.write_text(document.replace('__DATA__', data), encoding='utf-8')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path('test-results'))
    parser.add_argument('--report', type=Path, action='append', help='Summarize only these explicit report files')
    parser.add_argument('--html', type=Path, help='Dashboard output; default: DIRECTORY/index.html')
    args = parser.parse_args(argv)
    lines = ['## SDK CI results', '', '| Report | Result | Duration |', '| --- | --- | --- |']
    paths = args.report if args.report else sorted(args.directory.glob('*.json'))
    reports = load_reports(paths)
    for path, report in reports:
        lines.append(f"| {cell(path.stem)} | **{cell(report.get('status', 'UNKNOWN'))}** | {cell(report.get('elapsedSeconds', '—'))} s |")
    if not reports:
        lines.append('| No test report produced | NOT RUN | — |')
    for path, report in reports:
        lines.extend(['', '### ' + cell(path.stem), ''])
        for check in report.get('checks', []):
            lines.append(f"- **{cell(check.get('status'))}** · {cell(check.get('name'))}")
        if 'testsRun' in report:
            lines.append(f"- Tests executed: **{report['testsRun']}**. See JSON/JUnit for individual outcomes and skips.")
        if report.get('context'):
            context = report['context']
            lines.append(f"- Current identity: commit `{cell(context.get('commit'))}`, run `{cell(context.get('runId'))}`, job `{cell(context.get('job'))}`.")
            if report.get('schema') != 'particle-sdk-ci-aggregate/v1':
                lines.append(f"- Finish identity verification: **{cell(report.get('identityVerification', {}).get('status', 'MISSING'))}**.")
        elif report.get('schema') != 'particle-sdk-ci-aggregate/v1':
            lines.append('- Historical or unbound evidence; not a current required gate.')
        if report.get('requiredCount') is not None:
            lines.append(f"- Required reports: {cell(report['requiredCount'])}; received: {cell(report.get('executedCount'))}.")
            for error in report.get('errors', []):
                lines.append('- ' + cell(error))
        for mount in report.get('mounts', []):
            case_count = len(mount.get('cases', [])) + sum(len(suite.get('cases', [])) for suite in mount.get('suites', []))
            lines.append(f"- **{cell(mount.get('status'))}** · {cell(mount.get('package'))} at `{cell(mount.get('mount'))}` mode `{cell(mount.get('mode', 'combined'))}`: {case_count} cases")
        if 'gpuSuite' in report:
            lines.append(f"- WebGPU: **{cell(report['gpuSuite'].get('status'))}**; requested mode `{cell(report.get('webgpu'))}`. Software results are functional checks, not hardware performance certification.")
        if rebuilding := report.get('rebuild'):
            lines.append(f"- Offline rebuilding: **{cell(rebuilding.get('status'))}**; "
                         f"{len(rebuilding.get('runtimeHashes', []))} complete build identities, "
                         f"{cell(rebuilding.get('directoryFiles'))} files compared.")
            lines.append(f"- Changed-source compiled execution: **{cell(rebuilding.get('cpuProbe', {}).get('status'))}**.")
            for check in rebuilding.get('rejectionChecks', []):
                detail = check.get('reason', check.get('diagnostic', ''))
                lines.append(f"- **{cell(check.get('status'))}** · {cell(check.get('name'))}: {cell(detail)}")
        if report.get('error'):
            lines.append('- Error: ' + cell(report['error']))
    lines.extend(['', 'Download the job artifact for test-level JSON, JUnit where available, and browser screenshots.', ''])
    summary = '\n'.join(lines)
    destination = args.html or args.directory / 'index.html'
    if destination.resolve().is_relative_to((Path(__file__).resolve().parents[1] / 'engine-sdk').resolve()):
        raise ValueError('Dashboard output must preserve the immutable SDK')
    write_dashboard(reports, destination)
    print(summary)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as output:
            output.write(summary)


if __name__ == '__main__':
    main()
