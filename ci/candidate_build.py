# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Build the recorded Engine + Plauna recipe offline in a disposable SDK copy."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time
from report_context import capture, inventory, verify_finish

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SDK = ROOT / 'engine-sdk'
sys.path.insert(0, str(SDK))
from bundler.sdk import verify_sdk
from sdk.rebuild_acceptance import _OFFLINE_BOOTSTRAP, _offline_environment
from bundler.sdk_rebuild import prepare_sdk_rebuild


def build_candidate(working, output):
    descriptor = json.loads((working / 'sdk-build.json').read_text(encoding='utf-8'))
    runtime = descriptor['runtime']
    if descriptor['target'] != 'engine' or runtime['entries'] != ['engine/EngineBootstrap.js', 'plauna/index.js'] or not runtime['production']:
        raise ValueError('Candidate requires the recorded production Engine + Plauna recipe')
    prepare_sdk_rebuild(working, 'engine')
    stage = output / 'stage'
    arguments = ['bundle_engine.py', '--target', 'engine', '--production', '--include-plauna',
                 '--sdk-only', '--sdk-no-archive', '--no-cache', '--stage-dir', str(stage)]
    for field, flag in (('eager', '--eager'), ('release', '--release'), ('extreme', '--extreme'), ('ns_ordered', '--ns-order')):
        if runtime[field]:
            arguments.append(flag)
    program = _OFFLINE_BOOTSTRAP + '\nimport os, runpy, sys\nsys.path.insert(0, os.getcwd())\nsys.argv = ' + repr(arguments) + '\nrunpy.run_path("bundle_engine.py", run_name="__main__")\n'
    completed = subprocess.run([sys.executable, '-I', '-c', program], cwd=working,
                               env=_offline_environment(), capture_output=True, text=True, timeout=5400)
    (output / 'rebuild-candidate.log').write_text(completed.stdout + completed.stderr, encoding='utf-8')
    if completed.returncode:
        raise AssertionError('Canonical offline candidate failed; see rebuild-candidate.log')
    verify_sdk(working)
    receipt = json.loads((stage / 'candidate-build.json').read_text(encoding='utf-8'))
    if receipt['status'] != 'PASS' or any(value != 'PASS' for value in receipt['validation'].values()):
        raise AssertionError('Canonical staging did not issue a complete verified candidate')
    shutil.copy2(stage / 'candidate-build.json', output / 'candidate-build.json')
    return stage / 'engine-sdk'


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'test-results/candidate')
    args = parser.parse_args(argv)
    output = args.output.resolve()
    if output.exists() or not output.is_relative_to(ROOT / 'test-results'):
        parser.error('Candidate output must be a fresh path below test-results')
    context = capture(ROOT)
    started = time.perf_counter()
    output.mkdir(parents=True)
    working = output / 'input-sdk'
    destination = output / 'engine-sdk'
    checks, error = [], None
    try:
        verify_sdk(SDK)
        shutil.copytree(SDK, working, ignore=shutil.ignore_patterns('build', '__pycache__', '*.pyc', '.bundle_cache.json'))
        verify_sdk(working)
        built = build_candidate(working, output)
        verify_sdk(built)
        shutil.copytree(built, destination)
        verify_sdk(destination)
        shutil.rmtree(working)
        checks.extend({'name': name, 'status': 'PASS'} for name in ('input integrity', 'offline recorded recipe', 'rebuilt SDK integrity', 'isolated copy integrity'))
    except Exception as failure:
        error = f'{type(failure).__name__}: {failure}'
    finish = verify_finish(context, ROOT)
    if finish['status'] != 'PASS':
        error = 'Input or recipe changed during rebuilding'
    if destination.exists() and error is None:
        context = {**context, 'candidate': inventory(destination)}
        finish = verify_finish(context, ROOT, candidate=destination)
    report = {'schema': 'particle-sdk-candidate-validation/v1', 'status': 'FAIL' if error or finish['status'] != 'PASS' else 'PASS',
              'context': context, 'identityVerification': finish, 'testedPackage': context['candidate'] or context['sdk'],
              'checks': checks, 'error': error, 'elapsedSeconds': time.perf_counter() - started,
              'scope': 'Canonical --stage-dir SDK-only build from the recorded recipe on the qualified Windows baseline; isolated verified outputs, native assets reused, network blocked, private signing keys absent.'}
    (output / 'candidate.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': report['status'], 'error': error, 'candidate': context['candidate']}))
    return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
