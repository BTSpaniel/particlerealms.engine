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
from report_context import capture, verify_finish
from run_python_tests import RecordedResult, write_reports

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SELECTORS = ('bundler.tests.test_parser', 'bundler.tests.test_parser_registry',
             'bundler.tests.test_emitter', 'bundler.tests.test_regex_literal_minification',
             'bundler.tests.test_semantic_oracles')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk', type=Path, default=ROOT / 'engine-sdk')
    parser.add_argument('--output', type=Path, default=ROOT / 'test-results/parser.json')
    args = parser.parse_args(argv)
    sdk = args.sdk.resolve()
    candidate = sdk if sdk != (ROOT / 'engine-sdk').resolve() else None
    context = capture(ROOT, candidate=candidate)
    sys.path.insert(0, str(sdk))
    from playwright.sync_api import sync_playwright
    from bundler.tests.test_corpus import collect_corpus_results, _CorpusGraph
    from bundler.emitter import rewrite_module_canonical
    from bundler.transform import is_shader_file, preprocess_shader_source
    from bundler.browser_syntax import assert_browser_classic_script_syntax
    from bundler.tests import test_semantic_oracles
    started = time.perf_counter()
    checks, tests, corpus, oracles = [], [], [], []
    failure = None
    try:
        with sync_playwright() as playwright:
            os.environ['PARTICLE_JS_SYNTAX_BROWSER'] = str(playwright.chromium.executable_path)
            browser = playwright.chromium.launch(headless=True, args=['--disable-gpu'])
            try:
                page = browser.new_page()
                corpus = [row for row in collect_corpus_results(sdk, ('engine', 'plauna'))
                          if not row['name'].startswith('engine/sim/physics/')]
                if not corpus or any(not any(row['name'].startswith(prefix + '/') for row in corpus) for prefix in ('engine', 'plauna')):
                    raise AssertionError('Engine/Plauna production corpus is absent')
                # Indirect eval parses the entire classic program before the
                # sentinel throws. None of the module body or GPU code executes.
                for row in corpus:
                    if row['status'] != 'PASS':
                        continue
                    source = (sdk / row['name']).read_text(encoding='utf-8')
                    if is_shader_file(str(sdk / row['name'])):
                        source = preprocess_shader_source(source)
                    emitted = rewrite_module_canonical(source, str(sdk / row['name']), _CorpusGraph())
                    try:
                        page.evaluate('source => {try {(0,eval)("throw \"__SDK_PARSE_ONLY__\";\\n"+source)} catch(error) {if(error!=="__SDK_PARSE_ONLY__")throw error;return true} throw new Error("Sentinel did not run")}', emitted)
                        row['browserGrammar'] = {'status': 'PASS', 'scope': 'canonical classic output'}
                    except Exception as error:
                        row.update(status='FAIL', browserGrammar={'status': 'FAIL', 'error': str(error)})
                for name in ('particle-engine.js', 'particle-engine.min.js'):
                    runtime = sdk / 'dist' / name
                    assert_browser_classic_script_syntax(runtime.read_text(encoding='utf-8'), label=name)
                    checks.append({'name': name, 'status': 'PASS', 'sha256': hashlib.sha256(runtime.read_bytes()).hexdigest(), 'scope': 'Chromium classic grammar, no body execution'})
            finally:
                browser.close()
        loader = unittest.TestLoader()
        suite = unittest.TestSuite(loader.loadTestsFromName(name) for name in SELECTORS)
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
              'checks': checks, 'oracles': oracles, 'error': failure,
              'counts': {'run': len(tests), 'passed': sum(row['status'] == 'PASS' for row in tests),
                         'failures': sum(row['status'] == 'FAIL' for row in tests), 'errors': sum(row['status'] == 'ERROR' for row in tests),
                         'skipped': sum(row['status'] in ('SKIP', 'XFAIL', 'RUNNING') for row in tests), 'expectedFailures': 0},
              'excludedSourcePrefixes': ['engine/sim/physics/', 'vendor/', 'engine/kaolin/'],
              'scope': 'First-party delivered Engine/Plauna: dependency analysis and emitted classic grammar are separate; source/emitted/minified native execution uses fixed CPU oracles; WebGPU disabled.'}
    write_reports(report, args.output)
    print(json.dumps({'status': report['status'], 'corpus': len(corpus), 'tests': len(tests), 'oracles': len(oracles), 'error': failure}))
    return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
