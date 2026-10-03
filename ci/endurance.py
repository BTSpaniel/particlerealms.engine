# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Manually qualify SDK lifecycle ownership and software WebGPU endurance."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time

sys.dont_write_bytecode = True
from browser_smoke import (OFFLINE_BROWSER_ARGS, SOFTWARE_ARGS, classify_proxy_denials,
                           contained_proxy, network_boundary_probe, observe_package_network, package_server,
                           require_case, shipped_example)
from sdk_scenarios import endurance_case, selection_case, playground_case
from network_trace import BrowserSocketTrace

ROOT = Path(__file__).resolve().parents[1]


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=('source', 'compiled'), required=True)
    parser.add_argument('--duration', type=int, default=600)
    parser.add_argument('--cycles', type=int, default=100)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--browser', type=Path)
    args = parser.parse_args(argv)
    if args.duration < 600 or args.cycles < 100:
        parser.error('Release endurance requires at least 600 seconds and 100 lifecycle cycles')
    sdk = ROOT / 'engine-sdk'
    args.output = args.output.resolve()
    if args.output.is_relative_to(sdk):
        parser.error('--output must be outside the SDK')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    images = args.output.with_suffix('')
    images.mkdir(exist_ok=True)
    started = time.monotonic()
    paths = [Path(__file__), ROOT / 'ci/sdk_scenarios.py', ROOT / 'ci/browser_smoke.py', ROOT / 'ci/network_trace.py',
             sdk / 'manifest.json', sdk / 'serve_sdk.py', sdk / 'examples/playground.js',
             sdk / 'examples/selection-regression.js', sdk / 'examples/runner.js', sdk / 'examples/scenarios.js']
    report = {'schema': 'particle-sdk-endurance/v1', 'status': 'RUNNING', 'mode': args.mode,
        'requestedCycles': args.cycles, 'requestedDurationSeconds': args.duration,
        'inputsSha256': {}, 'cases': [], 'checks': [], 'diagnostics': {name: [] for name in ('pageErrors', 'consoleErrors', 'httpErrors', 'externalRequests')},
        'scope': 'Software WebGPU functional endurance; reported timings do not qualify hardware performance. Memory is available browser JS heap data, not total native or GPU memory.'}
    diagnostics = report['diagnostics']
    try:
        identities = {path.relative_to(ROOT).as_posix(): sha256(path) for path in paths}
        report['inputsSha256'] = identities
        report['commit'] = os.environ.get('GITHUB_SHA') or subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
        manifest = json.loads((sdk / 'manifest.json').read_text(encoding='utf-8'))
        for path in paths:
            if path.is_relative_to(sdk) and path.name != 'manifest.json':
                relative = path.relative_to(sdk).as_posix()
                if manifest['files'][relative]['sha256'] != sha256(path):
                    raise ValueError('Endurance input differs from its SDK inventory: ' + relative)
        report['runtime'] = {name: manifest['bundle'][name] for name in ('browser_runtime_integrity', 'source_content_sha256', 'browser_runtime_decoded_bytes')}
        spec = importlib.util.spec_from_file_location('sdk_endurance_server', sdk / 'serve_sdk.py')
        server_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(server_module)
        from playwright.sync_api import sync_playwright
        with package_server(sdk, '/release-validation/', server_module) as (origin, requests), contained_proxy(origin) as (proxy_url, proxy), sync_playwright() as playwright:
            # Retain partial network evidence even when startup or a case fails.
            report['requests'] = requests
            report['networkContainment'] = {'blocked': proxy.blocked, 'failures': proxy.failures, 'onlyOrigin': origin}
            arguments = [*OFFLINE_BROWSER_ARGS, *SOFTWARE_ARGS]
            browser = playwright.chromium.launch(headless=True, channel='chromium' if args.browser is None else None,
                executable_path=str(args.browser) if args.browser else None, proxy={'server': proxy_url, 'bypass': '<-loopback>'}, args=arguments)
            report.update(browserVersion=browser.version, launchArgs=arguments)
            socket_trace = None
            try:
                report['networkBoundaryProbe'] = network_boundary_probe(browser)
                if report['networkBoundaryProbe']['status'] != 'PASS':
                    raise AssertionError('Network boundary probe failed: ' + json.dumps(report['networkBoundaryProbe']))
                socket_trace = BrowserSocketTrace(browser).start()
                context = browser.new_context(service_workers='block', viewport={'width': 1100, 'height': 850})
                observe_package_network(context, origin, diagnostics)
                page = context.new_page()
                page.set_default_timeout(90000)
                page.on('pageerror', lambda error: diagnostics['pageErrors'].append(str(error)))
                page.on('console', lambda message: diagnostics['consoleErrors'].append(message.text) if message.type == 'error' else None)
                base = origin + '/release-validation/'
                try:
                    for operation in (
                            lambda: selection_case(page, base, args.mode),
                            lambda: playground_case(page, base, args.mode),
                            lambda: shipped_example(page, base + f'examples/{args.mode}.html?case=worker',
                                                    'Surface Field worker operation and disposal', args.mode)):
                        result = operation()
                        report['cases'].append(result)
                        require_case(result)
                        report['checks'].append({'name': result['name'], 'status': 'PASS'})
                    print(f'[endurance] {args.mode}: {args.cycles} lifecycle cycles, then {args.duration}s simulation', flush=True)
                    result = endurance_case(page, base, args.mode, args.duration, args.cycles)
                    report['cases'].append(result)
                    require_case(result)
                    report['checks'].append({'name': result['name'], 'status': 'PASS'})
                    report['measurements'] = result['final']
                    adapter = result['final']['adapter']
                    if not any(token in ' '.join(str(value) for value in adapter.values()).lower() for token in ('swiftshader', 'lavapipe', 'llvmpipe')):
                        raise AssertionError('Software endurance did not identify a software adapter')
                    page.screenshot(path=str(images / 'completed.png'))
                except Exception:
                    try:
                        page.screenshot(path=str(images / 'failure.png'))
                    except Exception as screenshot_error:
                        report['screenshotError'] = str(screenshot_error)
                    raise
                finally:
                    try:
                        cleanup = page.evaluate('''async () => {
                            if(typeof globalThis.__SDK_EXAMPLE_CLEANUP__ !== 'function')return null;
                            const cleanup=await globalThis.__SDK_EXAMPLE_CLEANUP__();
                            return {cleanup,status:globalThis.__SDK_EXAMPLE_RESULT__?.status};
                        }''')
                        report['finalCleanup'] = cleanup
                        if cleanup is not None and (cleanup['cleanup']['status'] != 'passed'
                                                    or cleanup['status'] != 'passed'):
                            diagnostics['pageErrors'].append('Final scenario cleanup or runtime status failed: ' + json.dumps(cleanup))
                    except Exception as cleanup_error:
                        diagnostics['pageErrors'].append('Final scenario cleanup failed: ' + str(cleanup_error))
                    finally:
                        context.close()
            finally:
                try:
                    if socket_trace is not None:
                        report['socketTrace'] = socket_trace.finish()
                        diagnostics['externalRequests'].extend(url for url in report['socketTrace']['urls']
                            if not ('http' + url[2:]).startswith(origin + '/'))
                finally:
                    browser.close()
                report['networkContainment']['forwarded'] = proxy.forwarded
                report['networkContainment'].update(classify_proxy_denials(proxy.blocked, diagnostics['externalRequests']))
            diagnostics['externalRequests'].extend(report['networkContainment']['unexpectedProxyDenied'])
            if proxy.failures or any(diagnostics.values()):
                raise AssertionError('Unexpected endurance diagnostics: ' + json.dumps(
                    {**diagnostics, 'proxyFailures': proxy.failures}))
        for path in paths:
            if identities[path.relative_to(ROOT).as_posix()] != sha256(path):
                raise ValueError('Endurance input changed during execution: ' + str(path))
        report['status'] = 'PASS'
    except Exception as error:
        report.update(status='FAIL', error=str(error), errorType=type(error).__name__)
    finally:
        report['elapsedSeconds'] = round(time.monotonic() - started, 3)
        args.output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(f"[endurance] {report['status']}: {args.output}", flush=True)
    return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
