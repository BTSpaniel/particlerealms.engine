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
from report_context import canonical_digest, capture, digest, inventory, verify_finish

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SDK = ROOT / 'engine-sdk'
sys.path.insert(0, str(SDK))
from bundler.sdk import verify_sdk
from bundler.site import _copy_release_asset_manifest, _safe_release_relative_path
from sdk.rebuild_acceptance import _OFFLINE_BOOTSTRAP, _offline_environment
from bundler.sdk_rebuild import prepare_sdk_rebuild
from bundler.staging import STAGE_FORMAT, _verify_stage_runtime


def copy_sdk_inventory(source, destination, verified_receipt):
    """Copy an already verified SDK by receipt, preserving nested build assets."""
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if destination.exists() or destination.is_relative_to(source) or source.is_relative_to(destination):
        raise ValueError('SDK copy requires a fresh destination outside its source tree')
    inventory = verified_receipt.get('files')
    if not isinstance(inventory, dict) or not inventory:
        raise ValueError('SDK copy requires its verified nonempty file inventory')
    names = sorted(set(inventory) | {'manifest.json'})
    for name in names:
        relative = _safe_release_relative_path(name, 'SDK copy inventory')
        path = source.joinpath(*relative.parts)
        if path.is_symlink() or not path.resolve().is_relative_to(source) or not path.is_file():
            raise ValueError('SDK copy input is missing or escapes its source tree: ' + name)
    destination.mkdir(parents=True)
    count = _copy_release_asset_manifest(destination, source, [(name, name) for name in names])
    print(f'[candidate] Copied {count} inventoried SDK files into {destination}', flush=True)
    return count


def candidate_recipe(descriptor):
    """Accept only descriptor options replayed by this canonical CI command."""
    runtime = descriptor.get('runtime')
    if (descriptor.get('target') != 'engine' or not isinstance(runtime, dict)
            or runtime.get('entries') != ['engine/EngineBootstrap.js', 'plauna/index.js']
            or runtime.get('name') != 'particle-engine' or runtime.get('site_profile') != 'engine'
            or runtime.get('base_url_root') is not None or runtime.get('production') is not True
            or runtime.get('include_plauna') is not True
            or any(runtime.get(name) is not False for name in ('include_editor', 'include_agi', 'include_webgpu_os'))
            or any(type(runtime.get(name)) is not bool for name in ('eager', 'release', 'extreme', 'ns_ordered'))):
        raise ValueError('Candidate requires the recorded canonical production Engine + Plauna recipe')
    if runtime['extreme'] and not runtime['release']:
        raise ValueError('Candidate extreme compression requires release compression')
    recipe = {name: runtime[name] for name in ('name', 'production', 'eager', 'release', 'extreme',
                                             'include_editor', 'include_agi', 'include_plauna', 'include_webgpu_os')}
    return {'target': 'engine', **recipe, 'ns_order': runtime['ns_ordered'],
            'sdk_no_archive': True, 'entries': runtime['entries']}


def verify_candidate_receipt(stage, descriptor, supplied_descriptor, sdk_receipt):
    """Bind complete staging evidence to the supplied recipe and actual outputs."""
    stage = Path(stage).resolve()
    receipt = json.loads((stage / 'candidate-build.json').read_text(encoding='utf-8'))
    recipe = candidate_recipe(descriptor)
    required_validation = {'inputsUnchanged': 'PASS', 'sdk': 'PASS', 'native': 'PASS', 'runtime': 'PASS'}
    if (receipt.get('format') != STAGE_FORMAT or receipt.get('status') != 'PASS'
            or receipt.get('validation') != required_validation):
        raise ValueError('Canonical staging did not issue complete required validation')
    if receipt.get('recipe') != recipe or receipt.get('recipeSha256') != canonical_digest(recipe):
        raise ValueError('Candidate receipt differs from the recorded build recipe')
    sdk = stage / 'engine-sdk'
    manifest = sdk / 'manifest.json'
    sdk_identity = {'path': 'engine-sdk', 'bytes': manifest.stat().st_size, 'sha256': digest(manifest),
                    'files': len(sdk_receipt['files']), 'buildInputsSha256': sdk_receipt['buildInputsSha256']}
    if (receipt.get('sdk') != sdk_identity or receipt.get('inputSha256') != sdk_receipt['buildInputsSha256']
            or receipt.get('tools') != descriptor['tools']):
        raise ValueError('Candidate receipt differs from SDK, input or pinned tool identities')
    supplied_descriptor = Path(supplied_descriptor)
    if receipt.get('sdkBuildDescriptor') != {'bytes': supplied_descriptor.stat().st_size, 'sha256': digest(supplied_descriptor)}:
        raise ValueError('Candidate receipt does not bind the supplied build descriptor')
    rebuilt_descriptor = json.loads((sdk / 'sdk-build.json').read_text(encoding='utf-8'))
    if rebuilt_descriptor.get('runtime') != descriptor['runtime']:
        raise ValueError('Rebuilt SDK changed recorded runtime options')
    bundle = sdk_receipt['bundle']
    runtime = {'name': bundle['name'], 'sourceSha256': bundle['source_content_sha256'],
               'integrity': bundle['browser_runtime_integrity'], 'provenance': bundle['provenance'],
               'files': _verify_stage_runtime(stage, sdk, bundle)}
    if receipt.get('runtime') != runtime:
        raise ValueError('Candidate receipt does not bind the verified runtime')
    outputs = {}
    for path in sorted(stage.rglob('*')):
        if path.is_symlink() or not path.resolve().is_relative_to(stage):
            raise ValueError('Candidate receipt output escapes staging')
        if path.is_file() and path != stage / 'candidate-build.json':
            outputs[path.relative_to(stage).as_posix()] = {'bytes': path.stat().st_size, 'sha256': digest(path)}
    if receipt.get('outputs') != outputs or receipt.get('outputsSha256') != canonical_digest(outputs):
        raise ValueError('Candidate receipt does not bind exact output files')
    return receipt


def build_candidate(working, output):
    descriptor = json.loads((working / 'sdk-build.json').read_text(encoding='utf-8'))
    runtime = descriptor['runtime']
    candidate_recipe(descriptor)
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
    verified_candidate = verify_sdk(stage / 'engine-sdk')
    verify_candidate_receipt(stage, descriptor, working / 'sdk-build.json', verified_candidate)
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
        verified_input = verify_sdk(SDK)
        copy_sdk_inventory(SDK, working, verified_input)
        verify_sdk(working)
        built = build_candidate(working, output)
        verified_candidate = verify_sdk(built)
        copy_sdk_inventory(built, destination, verified_candidate)
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
