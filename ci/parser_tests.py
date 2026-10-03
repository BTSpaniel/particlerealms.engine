# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Run dependency analysis and actual Chromium grammar/CPU behavior separately."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import unittest
from urllib.parse import quote, urlsplit
from report_context import capture, verify_finish
from run_python_tests import RecordedResult, write_reports

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SELECTORS = ('bundler.tests.test_parser', 'bundler.tests.test_parser_registry',
             'bundler.tests.test_emitter', 'bundler.tests.test_regex_literal_minification',
             'bundler.tests.test_semantic_oracles')
BROWSER_GRAMMAR_PROBE = r'''source => {
    try { (0, eval)('throw "__SDK_PARSE_ONLY__";\n' + source); }
    catch (error) { if (error !== "__SDK_PARSE_ONLY__") throw error; return true; }
    throw new Error("Sentinel did not run");
}'''
MODULE_GRAMMAR_PROBE = r'''async ({source, allowUnresolved = false}) => {
    const url = 'data:text/javascript;charset=utf-8,' + encodeURIComponent('throw "__SDK_PARSE_ONLY__";\n' + source);
    try { await import(url); }
    catch (error) {
        if (error === "__SDK_PARSE_ONLY__") return 'sentinel';
        // Parsing precedes dependency resolution. A nonhierarchical data URL
        // prevents relative/bare static imports from loading or executing.
        if (allowUnresolved && error instanceof TypeError &&
            error.message.startsWith('Failed to resolve module specifier ') &&
            (error.message.includes('Invalid relative url or base scheme') ||
             error.message.includes('Relative references must start with')))
            return 'static-specifier-resolution-prevented';
        throw error;
    }
    throw new Error("Module sentinel did not run");
}'''


def static_dependencies(source, parse_module):
    from bundler.parser import _iter_code_tokens, _decode_js_string_token
    imports, exports = parse_module(source)
    dependencies = [item for item in imports if not item.is_dynamic] + [item for item in exports if item.spec]
    decoded = []
    for item in dependencies:
        strings = [token for token in _iter_code_tokens(source, start=item.start, end=item.end)
                   if token.kind == 'string']
        if not strings:
            raise ValueError('Static dependency lacks its original string literal')
        # Decode native JavaScript escapes instead of trusting a scanner's
        # normalized text: an escaped colon can otherwise conceal a data URL.
        decoded.append(_decode_js_string_token(source, strings[-1]))
    return decoded


def require_nonloading_source_dependencies(source, parse_module):
    dependencies = static_dependencies(source, parse_module)
    if any(urlsplit(spec).scheme or spec.startswith('//') for spec in dependencies):
        raise ValueError('Original grammar input contains a loadable external static dependency')
    return dependencies


def require_dependency_free_body(source, parse_module):
    if static_dependencies(source, parse_module):
        raise ValueError('Canonical grammar probe cannot execute static dependencies')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk', type=Path, default=ROOT / 'engine-sdk')
    parser.add_argument('--output', type=Path, default=ROOT / 'test-results/parser.json')
    args = parser.parse_args(argv)
    sdk = args.sdk.resolve()
    if args.output.resolve().is_relative_to(sdk):
        parser.error('--output must be outside the tested SDK')
    candidate = sdk if sdk != (ROOT / 'engine-sdk').resolve() else None
    context = capture(ROOT, candidate=candidate)
    sys.path.insert(0, str(sdk))
    from playwright.sync_api import sync_playwright, Error as BrowserError
    from bundler.tests.test_corpus import collect_corpus_results, _CorpusGraph
    from bundler.emitter import rewrite_module_canonical
    from bundler.transform import is_shader_file, preprocess_shader_source
    from bundler.browser_syntax import assert_browser_classic_script_syntax
    from bundler.tests import test_semantic_oracles
    from bundler.parser import parse_module
    started = time.perf_counter()
    checks, tests, corpus, oracles = [], [], [], []
    expected_identities = {'tests': [], 'corpus': [],
        'oracles': [{'name': name, 'mode': mode} for name, _, _ in test_semantic_oracles.FIXTURES
                    for mode in ('source', 'emitted', 'minified')]}
    failure = None
    unexpected_requests = []
    try:
        with sync_playwright() as playwright:
            os.environ['PARTICLE_JS_SYNTAX_BROWSER'] = str(playwright.chromium.executable_path)
            browser = playwright.chromium.launch(headless=True, args=['--disable-gpu'])
            try:
                page = browser.new_page()
                def deny_request(route):
                    unexpected_requests.append(route.request.url)
                    route.abort()
                page.route('**/*', deny_request)
                # Real positive and negative controls also validate the probe's
                # own JavaScript quoting before it is used over the corpus.
                if page.evaluate(BROWSER_GRAMMAR_PROBE, 'globalThis.__SDK_CORPUS_BODY_EXECUTED__ = true;') is not True:
                    raise AssertionError('Browser grammar positive control did not reach its sentinel')
                if page.evaluate('globalThis.__SDK_CORPUS_BODY_EXECUTED__ === true'):
                    raise AssertionError('Browser grammar probe executed the supplied body')
                checks.append({'name': 'browser grammar positive control', 'status': 'PASS',
                               'scope': 'Actual Chromium parsing reaches sentinel without executing body'})
                for name, malformed in (('unclosed function', 'function broken( {'),
                                        ('invalid nested expression', 'function nested() { return (1 + ); }')):
                    try:
                        page.evaluate(BROWSER_GRAMMAR_PROBE, malformed)
                    except BrowserError as error:
                        if 'SyntaxError' not in str(error):
                            raise AssertionError('Browser grammar negative control failed outside the JavaScript parser') from error
                        checks.append({'name': 'browser grammar rejects ' + name, 'status': 'PASS',
                                       'expectedError': 'SyntaxError', 'actualError': str(error)})
                    else:
                        raise AssertionError('Browser grammar admitted malformed JavaScript: ' + name)
                if page.evaluate(MODULE_GRAMMAR_PROBE, {'source':
                                 'await Promise.resolve(); globalThis.__SDK_CORPUS_BODY_EXECUTED__ = true;'}) != 'sentinel':
                    raise AssertionError('Native module grammar control did not reach its sentinel')
                if page.evaluate('globalThis.__SDK_CORPUS_BODY_EXECUTED__ === true'):
                    raise AssertionError('Native module grammar probe executed its supplied body')
                checks.append({'name': 'native module grammar with top-level await', 'status': 'PASS',
                               'scope': 'Actual Chromium ES module parsing; body execution prevented'})
                try:
                    page.evaluate(MODULE_GRAMMAR_PROBE, {'source': 'await Promise.resolve(); const broken = ;'})
                except BrowserError as error:
                    if 'SyntaxError' not in str(error):
                        raise AssertionError('Native module negative control failed outside the JavaScript parser') from error
                    checks.append({'name': 'native module grammar rejects malformed source', 'status': 'PASS',
                                   'expectedError': 'SyntaxError', 'actualError': str(error)})
                else:
                    raise AssertionError('Native module grammar admitted malformed JavaScript')
                try:
                    page.evaluate(MODULE_GRAMMAR_PROBE, {'source': 'import "./not-loaded.js"; export {missing};',
                                                       'allowUnresolved': True})
                except BrowserError as error:
                    if 'SyntaxError' not in str(error):
                        raise AssertionError('Original export early-error control was masked by resolution') from error
                    checks.append({'name': 'original module rejects missing export before dependency resolution',
                                   'status': 'PASS', 'expectedError': 'SyntaxError', 'actualError': str(error)})
                else:
                    raise AssertionError('Original module grammar admitted an undeclared export')
                spoof = 'data:text/javascript,' + quote('globalThis.__SDK_CORPUS_BODY_EXECUTED__ = true; throw "__SDK_PARSE_ONLY__";')
                for label, literal in (('plain', json.dumps(spoof)),
                                       ('escaped colon', json.dumps(spoof).replace('data:', r'data\x3a'))):
                    for guard in (require_dependency_free_body, require_nonloading_source_dependencies):
                        try:
                            guard('import ' + literal + ';', parse_module)
                        except ValueError:
                            checks.append({'name': guard.__name__ + ' rejects ' + label + ' dependency sentinel spoof',
                                           'status': 'PASS'})
                        else:
                            raise AssertionError('Grammar probe admitted an executable static dependency')
                corpus = [row for row in collect_corpus_results(sdk, ('engine', 'plauna'))
                          if not row['name'].startswith('engine/sim/physics/')]
                expected_identities['corpus'] = [row['name'] for row in corpus]
                if not corpus or any(not any(row['name'].startswith(prefix + '/') for row in corpus) for prefix in ('engine', 'plauna')):
                    raise AssertionError('Engine/Plauna production corpus is absent')
                # Delivered modules may use native top-level await. Parse their
                # canonical bodies as ES modules; the first statement prevents
                # execution. Actual compiled runtimes receive classic-script
                # validation separately below, with no async wrapper adaptation.
                for row in corpus:
                    if row['status'] != 'PASS':
                        continue
                    raw_source = (sdk / row['name']).read_text(encoding='utf-8')
                    source = raw_source
                    if is_shader_file(str(sdk / row['name'])):
                        source = preprocess_shader_source(source)
                    emitted = rewrite_module_canonical(source, str(sdk / row['name']), _CorpusGraph())
                    try:
                        dependencies = require_nonloading_source_dependencies(raw_source, parse_module)
                        original = page.evaluate(MODULE_GRAMMAR_PROBE, {'source': raw_source, 'allowUnresolved': bool(dependencies)})
                        row['sourceGrammar'] = {'status': 'PASS', 'scope': 'Native original ES module grammar; dependencies prevented from loading',
                                                'completion': original}
                        require_dependency_free_body(emitted, parse_module)
                        if page.evaluate(MODULE_GRAMMAR_PROBE, {'source': emitted}) != 'sentinel':
                            raise AssertionError('Canonical module did not reach its parse sentinel')
                        row['browserGrammar'] = {'status': 'PASS', 'scope': 'canonical body in native ES module grammar; no body execution'}
                    except Exception as error:
                        row.update(status='FAIL', browserGrammar={'status': 'FAIL', 'error': str(error)})
                if unexpected_requests or page.evaluate('globalThis.__SDK_CORPUS_BODY_EXECUTED__ === true'):
                    raise AssertionError('Grammar probes loaded unexpected resources or executed a module body')
            finally:
                browser.close()
        # The shared syntax verifier owns its Playwright session. Invoke it
        # after the corpus session has stopped; Sync API sessions cannot nest.
        for name in ('particle-engine.js', 'particle-engine.min.js'):
            runtime = sdk / 'dist' / name
            assert_browser_classic_script_syntax(runtime.read_text(encoding='utf-8'), label=name)
            checks.append({'name': name, 'status': 'PASS', 'sha256': hashlib.sha256(runtime.read_bytes()).hexdigest(), 'scope': 'Chromium classic grammar, no body execution'})
        loader = unittest.TestLoader()
        suite = unittest.TestSuite(loader.loadTestsFromName(name) for name in SELECTORS)
        def selected_identities(selected):
            for item in selected:
                if isinstance(item, unittest.TestSuite):
                    yield from selected_identities(item)
                else:
                    yield item.id()
        expected_identities['tests'] = list(selected_identities(suite))
        expected = suite.countTestCases()
        result = unittest.TextTestRunner(verbosity=2, resultclass=RecordedResult).run(suite)
        tests = list(result.records.values())
        oracles = list(test_semantic_oracles.ORACLE_RESULTS)
        expected_oracles = {(name, mode) for name, _, _ in test_semantic_oracles.FIXTURES for mode in ('source', 'emitted', 'minified')}
        actual = {(row['name'], row['mode']) for row in oracles}
        if len(oracles) != len(expected_oracles) or actual != expected_oracles:
            raise AssertionError('Missing or duplicate semantic oracle execution')
        if not result.wasSuccessful() or len(tests) != expected or any(row['status'] != 'PASS' for row in tests + corpus + oracles):
            raise AssertionError('A required parser, grammar or semantic check failed')
    except Exception as error:
        failure = f'{type(error).__name__}: {error}'
    identity = verify_finish(context, ROOT, candidate=candidate)
    report = {'schema': 'particle-sdk-parser-validation/v1', 'status': 'FAIL' if failure or identity['status'] != 'PASS' else 'PASS',
              'context': context, 'identityVerification': identity, 'testedPackage': context['candidate'] or context['sdk'],
              'elapsedSeconds': time.perf_counter() - started, 'duration_seconds': time.perf_counter() - started,
              'tests': tests, 'testsRun': len(tests), 'corpus': corpus, 'corpusCount': len(corpus),
              'expectedIdentities': expected_identities,
              'checks': checks, 'oracles': oracles, 'error': failure,
              'unexpectedRequests': unexpected_requests,
              'counts': {'run': len(tests), 'passed': sum(row['status'] == 'PASS' for row in tests),
                         'failures': sum(row['status'] == 'FAIL' for row in tests), 'errors': sum(row['status'] == 'ERROR' for row in tests),
                         'skipped': sum(row['status'] in ('SKIP', 'XFAIL', 'RUNNING') for row in tests), 'expectedFailures': 0},
              'excludedSourcePrefixes': ['engine/sim/physics/', 'vendor/', 'engine/kaolin/'],
              'scope': 'First-party delivered Engine/Plauna: dependency analysis, native original ES module grammar and canonical body grammar are separate; static dependency loading and body execution are prevented during grammar checks. Complete compiled runtime classic grammar is required independently; source/emitted/minified native execution uses fixed CPU oracles; WebGPU disabled.'}
    write_reports(report, args.output)
    print(json.dumps({'status': report['status'], 'corpus': len(corpus), 'tests': len(tests), 'oracles': len(oracles), 'error': failure}))
    return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
