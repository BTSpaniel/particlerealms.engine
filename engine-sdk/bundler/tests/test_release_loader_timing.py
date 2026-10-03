# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Execute the real generated loader against isolated tiny verified runtimes."""
import base64
import gzip
import hashlib
import http.server
import json
import threading
import unittest

from bundler.site import _RELEASE_RUNTIME_LOADER_SOURCE
from bundler.browser_syntax import _find_browser, sync_playwright


@unittest.skipIf(sync_playwright is None, 'Playwright is required for loader execution evidence')
class TestReleaseLoaderTiming(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payload = b'globalThis.PE={__modules:{fixture:1},requireModule:function(){return {};}};'
        cls.bad_syntax = b'globalThis.PE=;'
        cls.compressed = gzip.compress(cls.payload)
        cls.requests = {}
        owner = cls

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                path = self.path.split('?')[0]
                mode = path.strip('/').split('/')[0] or 'valid'
                source = owner.bad_syntax if mode == 'syntax' else owner.payload
                compressed = gzip.compress(source)
                integrity = 'sha384-' + base64.b64encode(hashlib.sha384(source).digest()).decode()
                if mode == 'integrity':
                    integrity = 'sha384-' + base64.b64encode(bytes(48)).decode()
                if path.endswith('loader.js'):
                    body, kind = _RELEASE_RUNTIME_LOADER_SOURCE.encode(), 'text/javascript'
                elif path.endswith('runtime.gz'):
                    owner.requests[mode] = owner.requests.get(mode, 0) + 1
                    body = source if mode == 'decoded' else compressed
                    if mode == 'retry' and owner.requests[mode] == 1:
                        body = b'truncated'
                    kind = 'application/octet-stream'
                else:
                    hostile = "Object.defineProperty(globalThis,'__PE_RUNTIME_LOADER_TIMING__',{value:'blocked',configurable:false});" if mode == 'blocked' else ''
                    body = (f'<!doctype html><script>{hostile}</script>'
                            f'<script src="/{mode}/loader.js" data-runtime-src="/{mode}/runtime.gz" '
                            f'data-asset-base="/assets/" data-runtime-base="/" '
                            f'data-integrity="{integrity}" data-runtime-bytes="{len(source)}" '
                            f'data-runtime-compressed-bytes="{len(compressed)}"></script>').encode()
                    kind = 'text/html'
                self.send_response(200)
                self.send_header('content-type', kind)
                self.send_header('content-length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(executable_path=str(_find_browser()), headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.playwright.stop()
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join(timeout=5)

    def load(self, mode):
        page = self.browser.new_page()
        try:
            page.goto(f'http://127.0.0.1:{self.server.server_port}/{mode}/', wait_until='load')
            return page.evaluate('''async () => {
              let ok = false; try { await globalThis.__PE_RUNTIME_READY; ok = true; } catch {}
              const timing = globalThis.__PE_RUNTIME_LOADER_TIMING__;
              return {ok, hasApi:!!globalThis.PE, timing,
                frozen:Object.isFrozen(timing), stagesFrozen:Object.isFrozen(timing?.stages)};
            }''')
        finally:
            page.close()

    def assert_timing(self, result, outcome):
        timing = result['timing']
        self.assertEqual(timing['outcome'], outcome)
        self.assertEqual(timing['format'], 'particle-runtime-loader-timing-v1')
        self.assertTrue(result['frozen'] and result['stagesFrozen'])
        self.assertGreaterEqual(timing['updatedAt'], timing['startedAt'])
        self.assertGreaterEqual(timing['elapsedMs'], 0)
        for value in timing['stages'].values():
            if value is not None:
                self.assertGreaterEqual(value, 0)
        self.assertNotIn('http', json.dumps(timing))

    def test_four_stages_are_finite_frozen_and_ready(self):
        result = self.load('valid'); self.assertTrue(result['ok'])
        self.assert_timing(result, 'ready')
        self.assertTrue(all(value is not None for value in result['timing']['stages'].values()))

    def test_integrity_failure_has_no_evaluation_or_api(self):
        result = self.load('integrity'); self.assertFalse(result['ok'] or result['hasApi'])
        self.assert_timing(result, 'failed')
        self.assertIsNone(result['timing']['stages']['evaluateMs'])

    def test_blocked_telemetry_property_cannot_break_boot(self):
        result = self.load('blocked'); self.assertTrue(result['ok'])
        self.assertEqual(result['timing'], 'blocked')

    def test_already_decoded_http_response_remains_verified(self):
        result = self.load('decoded'); self.assertTrue(result['ok'])
        self.assert_timing(result, 'ready')

    def test_bounded_reload_retry_is_counted(self):
        result = self.load('retry'); self.assertTrue(result['ok'])
        self.assert_timing(result, 'ready')
        self.assertEqual(result['timing']['retries'], 1)

    def test_syntax_failure_retains_failed_evaluation_timing(self):
        result = self.load('syntax'); self.assertFalse(result['ok'])
        self.assert_timing(result, 'failed')
        self.assertIsNotNone(result['timing']['stages']['evaluateMs'])


if __name__ == '__main__':
    unittest.main()
