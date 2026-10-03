# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Execute the canonical loader against real HTTP transport-part failures."""

import base64
import gzip
import hashlib
import html
import http.server
import json
import threading
import unittest
from urllib.parse import urlsplit

from bundler.browser_syntax import _find_browser, sync_playwright
from bundler.site import _RELEASE_RUNTIME_LOADER_SOURCE


@unittest.skipIf(sync_playwright is None, 'Playwright is required for transport evidence')
class TestReleaseRuntimePartsBrowser(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (
            b'globalThis.runtimeExecutions=(globalThis.runtimeExecutions||0)+1;'
            b'globalThis.PE={marker:"verified",__modules:{fixture:1},'
            b'requireModule:function(){return {};}};'
        )
        cls.compressed = gzip.compress(cls.source, mtime=0)
        cls.integrity = 'sha384-' + base64.b64encode(hashlib.sha384(cls.source).digest()).decode()
        cls.documents = {}
        cls.requests = {}
        cls.lock = threading.Lock()
        owner = cls

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                path = urlsplit(self.path).path
                segments = path.strip('/').split('/')
                mode = segments[0]
                body, kind, status, declared_length = b'', 'application/octet-stream', 200, True
                if path.endswith('/page/index.html'):
                    body, kind = owner.documents[mode].encode(), 'text/html'
                elif path.endswith('/loader.js'):
                    body, kind = _RELEASE_RUNTIME_LOADER_SOURCE.encode(), 'text/javascript'
                elif '/assets/' in path:
                    with owner.lock:
                        requests = owner.requests.setdefault(mode, [])
                        requests.append({'path': path, 'cache': self.headers.get('Cache-Control', '')})
                        attempt = sum(item['path'] == path for item in requests)
                    if path.endswith('/runtime.gz'):
                        body = owner.compressed
                    elif path.endswith('.part'):
                        index = int(segments[-1].split('.')[0])
                        payload = owner.source if mode == 'decoded-transport' else owner.compressed
                        body = owner.split_payload(payload)[index]
                        if index == 1:
                            if mode == 'missing':
                                status, body = 404, b'missing'
                            elif mode == 'redirect':
                                self.send_response(302)
                                self.send_header('Location', f'/{mode}/outside.part')
                                self.end_headers()
                                return
                            elif mode == 'timeout' or (mode == 'timeout-retry' and attempt > 1):
                                threading.Event().wait(0.5)
                            elif mode == 'terminal-digest' or (
                                mode in ('recover-digest', 'timeout-retry') and attempt == 1
                            ):
                                body = bytes([body[0] ^ 1]) + body[1:]
                            elif mode == 'recover-length' and attempt == 1:
                                body = body[:-1]
                            elif mode == 'recover-overflow' and attempt == 1:
                                body, declared_length = body + b'overflow', False
                            elif mode == 'terminal-short':
                                body, declared_length = body[:-1], False
                    else:
                        status = 404
                else:
                    # A redirect or source fallback must never reach this route.
                    with owner.lock:
                        owner.requests.setdefault(mode, []).append({'path': path, 'cache': ''})
                    status = 404
                self.send_response(status)
                self.send_header('Content-Type', kind)
                self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
                if declared_length:
                    self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                try:
                    self.wfile.write(body)
                except ConnectionError:
                    pass

        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(executable_path=str(_find_browser()), headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    @staticmethod
    def split_payload(payload):
        size = len(payload) // 3
        return [payload[:size], payload[size:2 * size], payload[2 * size:]]

    def records(self, payload=None):
        return [
            {'src': f'../assets/{index}.part?v=identity', 'bytes': len(part),
             'sha256': hashlib.sha256(part).hexdigest()}
            for index, part in enumerate(self.split_payload(payload or self.compressed))
        ]

    def load(self, mode, records=None, metadata=None, existing_api=False, shorten_deadline=False,
             base_uri=None, **overrides):
        payload = self.source if mode == 'decoded-transport' else self.compressed
        if metadata is None:
            metadata = json.dumps(self.records(payload) if records is None else records)
        attributes = {
            'src': '../loader.js',
            'data-runtime-src': '../assets/runtime.gz?v=logical-identity',
            'data-asset-base': '../assets/', 'data-runtime-base': '../../',
            'data-integrity': self.integrity, 'data-runtime-bytes': str(len(self.source)),
            'data-runtime-compressed-bytes': str(len(payload)), 'data-runtime-parts': metadata,
        }
        attributes.update(overrides)
        tag = ' '.join(f'{name}="{html.escape(value, quote=True)}"' for name, value in attributes.items())
        base_tag = f'<base href="{html.escape(base_uri, quote=True)}">' if base_uri else ''
        self.documents[mode] = f'<!doctype html>{base_tag}<script {tag}></script>'
        self.requests[mode] = []
        page = self.browser.new_page()
        try:
            if existing_api:
                page.add_init_script('globalThis.PE={__modules:{existing:1},requireModule(){}};')
            if shorten_deadline:
                # Accelerate only the production deadline, retaining real Fetch,
                # AbortController, server delay and response-stream cancellation.
                page.add_init_script('''
                  globalThis.loaderDeadlines = [];
                  const originalSetTimeout = globalThis.setTimeout.bind(globalThis);
                  globalThis.setTimeout = (callback, delay, ...args) => {
                    if (delay === 120000) {
                      globalThis.loaderDeadlines.push(delay);
                      return originalSetTimeout(callback, 100, ...args);
                    }
                    return originalSetTimeout(callback, delay, ...args);
                  };
                ''')
            page.goto(f'http://127.0.0.1:{self.server.server_port}/{mode}/page/index.html', wait_until='load')
            result = page.evaluate('''async () => {
              let error = ''; try { await globalThis.__PE_RUNTIME_READY; }
              catch (failure) { error = String(failure.message || failure); }
              return {error, executions:globalThis.runtimeExecutions || 0,
                hasApi:!!globalThis.PE, timing:globalThis.__PE_RUNTIME_LOADER_TIMING__,
                provenance:globalThis.__PE_RUNTIME_PROVENANCE__ || null,
                deadlines:globalThis.loaderDeadlines || []};
            }''')
            with self.lock:
                # Ignore Chromium's optional favicon request; retain all runtime paths.
                result['requests'] = [item for item in self.requests[mode]
                                      if not item['path'].endswith('/favicon.ico')]
            return result
        finally:
            page.close()

    def assert_only_parts(self, result, indices):
        self.assertEqual([item['path'].rsplit('/', 1)[-1] for item in result['requests']],
                         [f'{index}.part' for index in indices])

    def assert_failed_before_execution(self, result, retries=0):
        self.assertTrue(result['error'])
        self.assertEqual(result['executions'], 0)
        self.assertFalse(result['hasApi'])
        self.assertEqual(result['timing']['outcome'], 'failed')
        self.assertEqual(result['timing']['retries'], retries)
        self.assertIsNone(result['timing']['stages']['evaluateMs'])

    def test_parts_reconstruct_one_verified_runtime_and_preserve_logical_provenance(self):
        result = self.load('valid')
        self.assertEqual(result['error'], '')
        self.assertEqual(result['executions'], 1)
        self.assert_only_parts(result, [0, 1, 2])
        self.assertEqual(result['timing']['retries'], 0)
        self.assertEqual(result['provenance']['transportMode'], 'gzip-parts')
        self.assertEqual(result['provenance']['transportPartCount'], 3)
        self.assertTrue(result['provenance']['runtimeUrl'].endswith('/assets/runtime.gz?v=logical-identity'))
        self.assertEqual(result['provenance']['integrity'], self.integrity)

    def test_cache_digest_and_length_recovery_reload_every_part(self):
        for mode in ('recover-digest', 'recover-length', 'recover-overflow'):
            with self.subTest(mode=mode):
                result = self.load(mode)
                self.assertEqual(result['error'], '')
                self.assertEqual(result['executions'], 1)
                self.assertEqual(result['timing']['retries'], 1)
                self.assert_only_parts(result, [0, 1, 0, 1, 2])
                for request in result['requests'][2:]:
                    self.assertRegex(request['cache'], r'no-cache|max-age=0')

    def test_persistent_digest_or_stream_length_mismatch_stops_after_one_reload(self):
        for mode in ('terminal-digest', 'terminal-short'):
            with self.subTest(mode=mode):
                result = self.load(mode)
                self.assert_failed_before_execution(result, retries=1)
                self.assertIn('after cache reload', result['error'])
                self.assert_only_parts(result, [0, 1, 0, 1])

    def test_missing_or_redirected_part_is_terminal_without_reload_or_fallback(self):
        for mode in ('missing', 'redirect'):
            with self.subTest(mode=mode):
                result = self.load(mode)
                self.assert_failed_before_execution(result)
                self.assert_only_parts(result, [0, 1])

    def test_one_deadline_cancels_real_fetch_and_is_not_reset_by_cache_retry(self):
        for mode, retries, indices in (
            ('timeout', 0, [0, 1]), ('timeout-retry', 1, [0, 1, 0, 1]),
        ):
            with self.subTest(mode=mode):
                result = self.load(mode, shorten_deadline=True)
                self.assert_failed_before_execution(result, retries=retries)
                self.assertEqual(result['deadlines'], [120000])
                self.assertIn('timed out', result['error'])
                self.assert_only_parts(result, indices)

    def test_authenticated_parts_in_the_wrong_order_never_execute(self):
        for mode, indices in (('reordered', [2, 1, 0]), ('reordered-tail', [0, 2, 1])):
            with self.subTest(mode=mode):
                parts = self.records()
                result = self.load(mode, records=[parts[index] for index in indices])
                self.assert_failed_before_execution(result)
                self.assert_only_parts(result, indices)

    def test_global_decoded_length_and_sha384_remain_authoritative(self):
        cases = {
            'integrity': {'data-integrity': 'sha384-' + base64.b64encode(bytes(48)).decode()},
            'decoded-length': {'data-runtime-bytes': str(len(self.source) + 1)},
        }
        for mode, overrides in cases.items():
            with self.subTest(mode=mode):
                result = self.load(mode, **overrides)
                self.assert_failed_before_execution(result)
                self.assert_only_parts(result, [0, 1, 2])
                self.assertIn('SHA-384' if mode == 'integrity' else 'decoded', result['error'])

    def test_parts_cannot_use_legacy_already_decoded_response_path(self):
        result = self.load('decoded-transport')
        self.assert_failed_before_execution(result)
        self.assertIn('opaque gzip', result['error'])
        self.assert_only_parts(result, [0, 1, 2])

    def test_all_metadata_is_validated_before_any_fetch_or_existing_api_reuse(self):
        invalid = {
            'empty': '', 'json': '[', 'object': '{}', 'no-parts': '[]',
            'oversized-json': ' ' * 131073,
            'too-many': json.dumps(self.records() * 22),
            'sum': json.dumps(self.records()[:-1]),
        }
        modifications = {
            'null': None, 'array': [], 'extra-key': {'unexpected': True},
            'string-bytes': {'bytes': '1'}, 'boolean-bytes': {'bytes': True},
            'fraction-bytes': {'bytes': 1.5}, 'zero-bytes': {'bytes': 0},
            'negative-bytes': {'bytes': -1}, 'oversized-part': {'bytes': 16777217},
            'invalid-hash': {'sha256': 'g' * 64}, 'uppercase-hash': {'sha256': 'A' * 64},
            'missing-hash': {'sha256': None},
            'absolute': {'src': '/assets/0.part'},
            'origin': {'src': 'https://example.com/assets/0.part'},
            'credentials': {'src': '//user:pass@127.0.0.1/assets/0.part'},
            'scheme': {'src': 'data:text/plain,evil'},
            'escape': {'src': '../../outside.part'},
            'encoded-escape': {'src': '../assets/%2e%2e/outside.part'},
            'encoded-slash': {'src': '../assets/nested%2f..%2foutside.part'},
            'encoded-control': {'src': '../assets/0%00.part'},
            'double-encoding': {'src': '../assets/%252e%252e/outside.part'},
            'malformed-encoding': {'src': '../assets/%.part'},
            'backslash': {'src': '..\\assets\\0.part'},
            'space': {'src': ' ../assets/0.part'},
            'fragment': {'src': '../assets/0.part#'},
            'directory': {'src': '../assets/'},
            'duplicate': {'src': '../assets/0.part?v=different-query'},
            'encoded-duplicate': {'src': '../assets/%30.part?v=different-query'},
            'last-escape': {'src': '../assets/../../outside.part'},
        }
        for name, changes in modifications.items():
            parts = self.records()
            index = 2 if name == 'last-escape' else 1
            if isinstance(changes, dict):
                parts[index].update(changes)
            else:
                parts[index] = changes
            invalid[name] = json.dumps(parts)
        for name, metadata in invalid.items():
            with self.subTest(name=name):
                result = self.load(f'metadata-{name}', metadata=metadata, existing_api=True)
                self.assertTrue(result['error'])
                self.assertEqual(result['executions'], 0)
                self.assertTrue(result['hasApi'])
                self.assertEqual(result['timing']['outcome'], 'failed')
                self.assertEqual(result['timing']['retries'], 0)
                self.assertIsNone(result['timing']['stages']['fetchMs'])
                self.assertIsNone(result['provenance'])
                self.assert_only_parts(result, [])

    def test_document_base_cannot_change_the_same_origin_boundary(self):
        mode = 'foreign-base'
        result = self.load(mode, base_uri=f'http://localhost:{self.server.server_port}/{mode}/page/',
                           src=f'http://127.0.0.1:{self.server.server_port}/{mode}/loader.js')
        self.assert_failed_before_execution(result)
        self.assertIn('same-origin', result['error'])
        self.assert_only_parts(result, [])

    def test_valid_metadata_can_reuse_existing_api_without_network(self):
        result = self.load('existing-api', existing_api=True)
        self.assertEqual(result['error'], '')
        self.assertEqual(result['executions'], 0)
        self.assertTrue(result['hasApi'])
        self.assert_only_parts(result, [])


if __name__ == '__main__':
    unittest.main()
