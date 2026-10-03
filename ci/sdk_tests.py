# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Run exported existing CPU assertions against delivered source/compiled APIs."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import time
import xml.etree.ElementTree as ET

from browser_smoke import (OFFLINE_BROWSER_ARGS, package_server, contained_proxy,
    observe_package_network, classify_proxy_denials, network_boundary_probe)
from network_trace import BrowserSocketTrace
import report_context

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_junit(report, destination):
    cases = [(mount, suite, case) for mount in report['mounts'] for suite in mount['suites'] for case in suite['cases']]
    infrastructure_failed = report['status'] != 'PASS' and not any(case['status'] != 'PASS' for _, _, case in cases)
    root = ET.Element('testsuite', name='Public SDK CPU assertions', tests=str(len(cases) + int(infrastructure_failed)),
        failures=str(sum(case['status'] == 'FAIL' for _, _, case in cases)),
        errors=str(int(infrastructure_failed)),
        skipped=str(sum(case['status'] not in ('PASS', 'FAIL') for _, _, case in cases)),
        time=str(report['elapsedSeconds']))
    for mount, suite, case in cases:
        element = ET.SubElement(root, 'testcase', classname=mount['mode'] + '.' + mount['mount'].strip('/') + '.' + suite['id'], name=case['id'])
        if case['status'] == 'FAIL':
            ET.SubElement(element, 'failure', message=case.get('error') or 'Required assertion failed').text = case.get('error')
        elif case['status'] != 'PASS':
            ET.SubElement(element, 'skipped', message='Required case was not executed').text = case.get('error')
    if infrastructure_failed:
        element = ET.SubElement(root, 'testcase', classname='Public SDK infrastructure', name='Required profile execution')
        ET.SubElement(element, 'error', message=report.get('error', 'Required profile failed')).text = report.get('error')
    ET.ElementTree(root).write(destination, encoding='utf-8', xml_declaration=True)


def missing_cases(suite, mode, error):
    return {'id': suite['id'], 'mode': mode, 'status': 'FAIL', 'error': str(error),
        'cases': [{'id': identity, 'status': 'NOT_RUN', 'error': str(error), 'checks': []}
                  for identity in suite['expectedCases'][mode]], 'cleanup': {'status': 'not_confirmed'}}


def expected_case_identities(profile):
    """Select every required identity from the validated immutable profile."""
    return [{'mount': mount, 'mode': mode, 'suite': suite['id'], 'id': identity}
            for mount in profile['mounts'] for mode in profile['modes']
            for suite in profile['suites'] for identity in suite['expectedCases'][mode]]


def button_contracts(page, base, mode, suite, contracts):
    """Reuse all seven original Python assertion methods, including real input."""
    controller = contracts.PublicButtonContracts()
    controller.modes = (mode,)
    cases, cleanup = [], []
    deadline = time.perf_counter() + suite['timeoutSeconds']

    @contextmanager
    def visit(selected):
        if selected != mode:
            raise AssertionError('A button assertion selected the wrong runtime mode')
        remaining = deadline - time.perf_counter()
        if remaining <= 0:
            raise TimeoutError('Required Button suite exhausted its timeout')
        page.set_default_timeout(max(1, int(remaining * 1000)))
        page.goto(base + 'sdk/public_tests/index.html?mode=' + mode, wait_until='domcontentloaded')
        page.wait_for_function("typeof runPublicSdkSuite === 'function'")
        page.evaluate('async suite => runPublicSdkSuite(suite)', suite)
        page.wait_for_function('globalThis.fixture')
        page.click('#button-under-test')
        page.evaluate('fixture.reset()')
        try:
            yield page
        finally:
            observed = page.evaluate('fixture.cleanup()')
            controller.assertEqual(observed, {'domNodes': 0, 'mappings': 0, 'handlers': 0, 'children': 0})
            controller.assertEqual(page.evaluate('globalThis.__SDK_CPU_GPU_REQUESTS__'), 0)
            cleanup.append(observed)

    controller.visit = visit
    for identity in suite['expectedCases'][mode]:
        method = identity.split(':', 1)[1]
        started = time.perf_counter()
        print('[sdk-tests] button', mode, method, flush=True)
        row = {'id': identity, 'name': method, 'status': 'RUNNING', 'checks': []}
        try:
            getattr(controller, method)()
            row.update(status='PASS', checks=[{'name': 'Existing Python assertions and teardown completed', 'passed': True}])
        except Exception as error:
            row.update(status='FAIL', error=str(error), checks=[{'name': 'Existing Python assertions and teardown completed', 'passed': False}])
        row['elapsedSeconds'] = round(time.perf_counter() - started, 6)
        cases.append(row)
    passed = len(cases) == 7 and len(cleanup) == 7 and all(row['status'] == 'PASS' for row in cases)
    return {'id': suite['id'], 'mode': mode, 'status': 'PASS' if passed else 'FAIL', 'cases': cases,
        'cleanup': {'status': 'passed' if passed else 'not_confirmed', 'observations': cleanup}}


GPU_GUARD = r'''globalThis.__SDK_CPU_GPU_REQUESTS__ = 0;
for (const [prototype, method] of [[globalThis.GPU?.prototype, 'requestAdapter'], [globalThis.GPUAdapter?.prototype, 'requestDevice']]) {
    if (prototype) Object.defineProperty(prototype, method, {value() {
        globalThis.__SDK_CPU_GPU_REQUESTS__++;
        throw new Error('Public SDK CPU assertions must not acquire native WebGPU');
    }});
}'''

COMPILED_ADMISSION_PROBE = r'''async base => {
    const {compiledRuntime, resolveModule} = await import(new URL('sdk/public_tests/resolver.js', base));
    const api = await compiledRuntime(), original = api.requireModule;
    const cases = [];
    try {
        for (const [name, returned, expected] of [
            ['missing compiled module', undefined, 'Missing compiled SDK module'],
            ['missing compiled named export', {}, 'Missing compiled SDK export'],
        ]) {
            api.requireModule = () => returned;
            let error = null;
            try { await resolveModule('plauna/widgets/Primitive/Button.js', ['Button']); }
            catch (caught) { error = String(caught?.message || caught); }
            cases.push({name, status:error?.startsWith(expected) ? 'PASS' : 'FAIL', diagnostic:error,
                checks:[{name:'Compiled admission rejects unavailable exports', passed:!!error?.startsWith(expected)}]});
        }
    } finally { api.requireModule = original; }
    if (api.requireModule !== original) throw Error('Compiled admission probe failed to restore the public resolver');
    return {status:cases.every(row=>row.status==='PASS') ? 'PASS' : 'FAIL', cases, resolverRestored:true};
}'''


def execute_mount(browser, sdk, mount, mode, profile, server, support, contracts, images):
    result = {'package': 'sdk', 'mount': mount, 'mode': mode, 'status': 'RUNNING', 'suites': [],
        'diagnostics': {name: [] for name in ('pageErrors', 'consoleErrors', 'httpErrors', 'externalRequests')}}
    diagnostics = result['diagnostics']
    trace = BrowserSocketTrace(browser).start()
    with package_server(sdk, mount, server) as (origin, requests), contained_proxy(origin) as (proxy_url, proxy):
        context = browser.new_context(service_workers='block', viewport={'width': 1000, 'height': 800},
            proxy={'server': proxy_url, 'bypass': '<-loopback>'})
        context.add_init_script(GPU_GUARD)
        observe_package_network(context, origin, diagnostics)
        page = context.new_page()
        page.on('pageerror', lambda error: diagnostics['pageErrors'].append(str(error)))
        page.on('console', lambda message: diagnostics['consoleErrors'].append(message.text) if message.type == 'error' else None)
        base = origin + mount
        try:
            page.goto(base + 'sdk/public_tests/index.html?mode=' + mode, wait_until='domcontentloaded')
            page.wait_for_function("typeof runPublicSdkSuite === 'function'")
            if mode == 'compiled':
                result['compiledAdmissionNegativeControl'] = page.evaluate(COMPILED_ADMISSION_PROBE, base)
                if result['compiledAdmissionNegativeControl']['status'] != 'PASS':
                    raise AssertionError('Compiled module admission negative control failed')
            for suite in profile['suites']:
                page.set_default_timeout(suite['timeoutSeconds'] * 1000)
                print('[sdk-tests]', mount, mode, suite['id'], flush=True)
                started = time.perf_counter()
                try:
                    if suite['id'] == 'plauna-button':
                        observed = button_contracts(page, base, mode, suite, contracts)
                        page.goto(base + 'sdk/public_tests/index.html?mode=' + mode, wait_until='domcontentloaded')
                        page.wait_for_function("typeof runPublicSdkSuite === 'function'")
                    else:
                        observed = page.evaluate('''async suite => {
                            let timer;
                            try { return await Promise.race([runPublicSdkSuite(suite), new Promise((_, reject) => {
                                timer = setTimeout(() => reject(Error('Required SDK suite timed out')), suite.timeoutSeconds * 1000);
                            })]); }
                            finally { clearTimeout(timer); }
                        }''', suite)
                    support.validate_result(suite, mode, observed)
                    if page.evaluate('globalThis.__SDK_CPU_GPU_REQUESTS__') != 0:
                        raise AssertionError('CPU suite attempted to acquire a native WebGPU adapter or device')
                except Exception as error:
                    if 'observed' not in locals() or observed.get('id') != suite['id']:
                        observed = missing_cases(suite, mode, error)
                    observed.update(status='FAIL', error=str(error))
                observed['elapsedSeconds'] = round(time.perf_counter() - started, 6)
                result['suites'].append(observed)
            page.screenshot(path=str(images / f'{mode}-{mount.strip("/") or "root"}.png'))
        except Exception as error:
            result.update(status='FAIL', error=str(error))
            executed = {suite['id'] for suite in result['suites']}
            result['suites'].extend(missing_cases(suite, mode, error) for suite in profile['suites'] if suite['id'] not in executed)
        finally:
            context.close()
            result['browserDisposal'] = {'status': 'passed', 'contextClosed': True}
            result['socketTrace'] = trace.finish()
            external_sockets = [url for url in result['socketTrace']['urls'] if not ('http' + url[2:]).startswith(origin + '/')]
            diagnostics['externalRequests'].extend(external_sockets)
            denied = classify_proxy_denials(proxy.blocked, diagnostics['externalRequests'])
            diagnostics['externalRequests'].extend(denied['unexpectedProxyDenied'])
            result['networkContainment'] = {'onlyOrigin': origin, 'proxyBlocked': list(proxy.blocked),
                'proxyFailures': list(proxy.failures), 'forwarded': proxy.forwarded, **denied}
            result['requests'] = requests
            required_suites = {suite['id'] for suite in profile['suites']}
            if (len(result['suites']) != len(required_suites) or {suite['id'] for suite in result['suites']} != required_suites
                    or any(suite['status'] != 'PASS' for suite in result['suites']) or any(diagnostics.values()) or proxy.failures):
                result['status'] = 'FAIL'
                result.setdefault('error', 'Required CPU assertions or browser/network diagnostics failed')
            else:
                result['status'] = 'PASS'
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'test-results/sdk-tests.json')
    parser.add_argument('--sdk', type=Path, default=ROOT / 'engine-sdk')
    parser.add_argument('--browser', type=Path)
    args = parser.parse_args(argv)
    sdk, args.output = args.sdk.resolve(), args.output.resolve()
    if args.output.is_relative_to(sdk):
        parser.error('--output must be outside the immutable tested SDK')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    images = args.output.with_suffix('')
    images.mkdir(exist_ok=True)
    report = {'schema': 'particle-sdk-public-cpu-results/v1', 'status': 'RUNNING', 'mounts': [],
        'scope': 'Existing CPU/DOM assertions, controlled resource contracts, and explicit source contracts. Native WebGPU acquisition is forbidden.'}
    started = time.perf_counter()
    candidate = sdk if sdk != (ROOT / 'engine-sdk').resolve() else None
    try:
        report['context'] = report_context.capture(ROOT, candidate=candidate)
        report['testedPackage'] = report['context']['candidate'] or report['context']['sdk']
        support = load_module('public_sdk_tests_support', sdk / 'sdk/public_tests.py')
        profile = support.validate_public_profile(sdk)
        report['expectedIdentities'] = {'cpuCases': expected_case_identities(profile)}
        report['profile'] = {'sha256': hashlib.sha256((sdk / 'sdk/public_tests/profile.json').read_bytes()).hexdigest(),
            'expectedSuites': len(profile['suites']), 'expectedCasesPerMode': profile['expectedCasesPerMode'],
            'assertionOriginsSha256': profile['assertionOriginsSha256']}
        contracts = load_module('public_sdk_button_contracts', sdk / 'sdk/public_tests/button_contract.py')
        server = load_module('public_sdk_tests_server', sdk / 'serve_sdk.py')
        from playwright.sync_api import sync_playwright
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, channel='chromium' if args.browser is None else None,
                executable_path=str(args.browser) if args.browser else None, proxy={'server': 'http://per-context'},
                args=list(OFFLINE_BROWSER_ARGS))
            report['browserVersion'] = browser.version
            try:
                report['networkBoundaryProbe'] = network_boundary_probe(browser)
                if report['networkBoundaryProbe']['status'] != 'PASS':
                    raise AssertionError('Network boundary negative control failed')
                for mount in profile['mounts']:
                    for mode in profile['modes']:
                        report['mounts'].append(execute_mount(browser, sdk, mount, mode, profile, server, support, contracts, images))
            finally:
                browser.close()
        expected = profile['expectedCasesPerMode'] * len(profile['mounts']) * len(profile['modes'])
        report['testsRun'] = sum(len(suite['cases']) for mount in report['mounts'] for suite in mount['suites'])
        report['expectedTests'] = expected
        if report['testsRun'] != expected or any(mount['status'] != 'PASS' for mount in report['mounts']):
            raise AssertionError('Required SDK profile did not pass every expected case at every mount and mode')
        report['status'] = 'PASS'
    except Exception as error:
        report.update(status='FAIL', error=str(error))
    finally:
        if 'context' in report:
            report['identityVerification'] = report_context.verify_finish(report['context'], ROOT, candidate=candidate)
            if report['identityVerification']['status'] != 'PASS':
                report.update(status='FAIL', error='SDK or report inputs changed during CPU execution')
        report['elapsedSeconds'] = round(time.perf_counter() - started, 3)
        args.output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        write_junit(report, args.output.with_suffix('.xml'))
        print(json.dumps({key: value for key, value in report.items() if key != 'mounts'}), flush=True)
    return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
