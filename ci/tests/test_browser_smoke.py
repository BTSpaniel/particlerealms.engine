# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Guard browser CI's containment and honest result admission boundaries."""
import hashlib
import http.client
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock
from urllib.parse import urlsplit
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from browser_smoke import (classify_proxy_denials, contained_path, contained_proxy,
                           extract_template, observe_package_network, require_case)


class BrowserBoundaryTests(unittest.TestCase):
    def test_only_exact_browser_maintenance_destinations_are_classified(self):
        clock = 'http://clients2.google.com/time/1/current?cup2key=10:abc&cup2hreq=abc123'
        known = ['www.google.com:443', 'update.googleapis.com:443',
                 'accounts.google.com:443', 'android.clients.google.com:443', clock]
        unknown = ['example.com:443', 'update.googleapis.com.attacker.test:443',
                   'update.googleapis.com:8443', 'https://accounts.google.com/anything',
                   clock.replace('/time/1/current', '/other'), clock + '&extra=value',
                   clock + '&cup2key=duplicate', clock.replace('cup2hreq=abc123', 'cup2hreq='),
                   clock.replace('clients2.google.com', 'user@clients2.google.com'),
                   clock + '#fragment', 'http://[invalid']
        result = classify_proxy_denials(known + unknown, [])
        self.assertEqual(result['browserBackgroundDenied'], known)
        self.assertEqual(result['unexpectedProxyDenied'], unknown)

    def test_application_http_and_socket_attempts_override_background_classification(self):
        blocked = ['www.google.com:443', 'update.googleapis.com:443',
                   'accounts.google.com:443', 'android.clients.google.com:443',
                   'http://clients2.google.com/time/1/current?cup2key=10:abc&cup2hreq=abc123']
        app = ['https://www.google.com/fetch', 'https://update.googleapis.com/worker',
               'wss://accounts.google.com/socket', 'wss://android.clients.google.com/socket',
               'http://clients2.google.com/worker']
        original = list(app)
        result = classify_proxy_denials(blocked, app)
        self.assertEqual(result['browserBackgroundDenied'], [])
        self.assertEqual(result['unexpectedProxyDenied'], blocked)
        self.assertEqual(app, original, 'Classification must never erase application evidence')

    def test_context_boundary_blocks_known_hosts_for_pages_workers_and_websockets(self):
        context = Mock(pages=[])
        diagnostics = {'externalRequests': [], 'httpErrors': []}
        origin = 'http://127.0.0.1:9001'
        observe_package_network(context, origin, diagnostics)
        request_route = context.route.call_args.args[1]
        socket_route = context.route_web_socket.call_args.args[1]
        events = {args.args[0]: args.args[1] for args in context.on.call_args_list}
        for url in ('https://accounts.google.com/page', 'https://update.googleapis.com/worker',
                    origin + '.attacker.test/module.js'):
            with self.subTest(url=url):
                route = Mock(request=SimpleNamespace(url=url))
                request_route(route)
                route.abort.assert_called_once_with('blockedbyclient')
                route.continue_.assert_not_called()
                events['request'](SimpleNamespace(url=url))
                self.assertIn(url, diagnostics['externalRequests'])
        for url in ('wss://accounts.google.com/socket', 'wss://unknown.test/socket'):
            route = Mock(url=url)
            socket_route(route)
            route.close.assert_called_once_with(code=1008, reason='CI blocks external network access')
            route.connect_to_server.assert_not_called()
            self.assertIn(url, diagnostics['externalRequests'])
        page = Mock()
        events['page'](page)
        worker_socket_observer = page.on.call_args.args[1]
        worker_socket_observer(SimpleNamespace(url='wss://android.clients.google.com/worker'))
        self.assertIn('wss://android.clients.google.com/worker', diagnostics['externalRequests'])
        local = Mock(request=SimpleNamespace(url=origin + '/nested/worker.js'))
        request_route(local)
        local.continue_.assert_called_once()
        local.abort.assert_not_called()
        local_socket = Mock(url='ws://127.0.0.1:9001/socket')
        socket_route(local_socket)
        local_socket.connect_to_server.assert_called_once()
        local_socket.close.assert_not_called()

    def test_proxy_denies_known_and_unknown_services_without_forwarding(self):
        destinations = [('CONNECT', 'accounts.google.com:443'),
                        ('CONNECT', 'unknown.test:443'),
                        ('GET', 'http://clients2.google.com/time/1/current?cup2key=x&cup2hreq=y')]
        with contained_proxy('http://127.0.0.1:1') as (address, proxy):
            parsed = urlsplit(address)
            for method, destination in destinations:
                connection = http.client.HTTPConnection(parsed.hostname, parsed.port, timeout=5)
                try:
                    connection.request(method, destination)
                    response = connection.getresponse()
                    self.assertEqual(response.status, 403)
                    response.read()
                finally:
                    connection.close()
            self.assertEqual(proxy.blocked, [destination for _, destination in destinations])
            self.assertEqual(proxy.forwarded, 0)
            self.assertEqual(proxy.failures, [])

    def test_mounted_requests_are_contained_and_decode_once(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            self.assertEqual(contained_path(root, '/nested/assets/runtime.js?v=1', '/nested/'),
                             root / 'assets/runtime.js')
            for path in ('/assets/runtime.js', '/nested/%2e%2e/private',
                         '/nested/%252e%252e/private', '/nested/assets%5cruntime.js', '/nested/%00'):
                with self.subTest(path=path), self.assertRaises(ValueError):
                    contained_path(root, path, '/nested/')

    def test_external_symlink_targets_are_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            root = base / 'served'
            root.mkdir()
            outside = base / 'outside.txt'
            outside.write_text('external', encoding='utf-8')
            try:
                (root / 'link.txt').symlink_to(outside)
            except OSError as error:
                self.skipTest('OS does not permit this test symlink: ' + str(error))
            with self.assertRaises(ValueError):
                contained_path(root.resolve(), '/link.txt', '/')

    def test_archive_extracts_only_recorded_template_members(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            payload = b'export const answer = 42;\n'
            receipt = {'files': {'assets/test.js': {'bytes': len(payload),
                'sha256': hashlib.sha256(payload).hexdigest()}}}
            archive = base / 'Template.zip'
            with zipfile.ZipFile(archive, 'w') as package:
                package.writestr('Template/assets/test.js', payload)
                package.writestr('Template/template-manifest.json', json.dumps(receipt))
            root, actual = extract_template(archive, base / 'extracted')
            self.assertEqual((root / 'assets/test.js').read_bytes(), payload)
            self.assertEqual(actual, receipt)

    def test_archive_traversal_links_duplicates_and_extra_members_are_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            for index, name in enumerate(('outside.txt', 'Template/../outside.txt', 'Template/C:/drive',
                                          'Template/assets\\test.js', 'Template/link.txt', 'Template/extra.txt')):
                archive = base / f'bad-{index}.zip'
                with zipfile.ZipFile(archive, 'w') as package:
                    package.writestr('Template/template-manifest.json', json.dumps({'files': {}}))
                    if name.endswith('link.txt'):
                        entry = zipfile.ZipInfo(name)
                        entry.external_attr = (stat.S_IFLNK | 0o777) << 16
                        package.writestr(entry, '../outside.txt')
                    else:
                        package.writestr(name, 'unrecorded')
                with self.subTest(name=name), self.assertRaises(ValueError):
                    extract_template(archive, base / f'extracted-{index}')
            duplicate = base / 'duplicate.zip'
            with zipfile.ZipFile(duplicate, 'w') as package:
                package.writestr('Template/template-manifest.json', '{}')
                package.writestr('Template/template-manifest.json', '{}')
            with self.assertRaises(ValueError):
                extract_template(duplicate, base / 'duplicate-extracted')

    def test_modified_payload_and_unexecuted_browser_cases_are_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / 'bad-hash.zip'
            with zipfile.ZipFile(archive, 'w') as package:
                package.writestr('Template/a.js', 'changed')
                package.writestr('Template/template-manifest.json', json.dumps({'files': {
                    'a.js': {'bytes': 7, 'sha256': '0' * 64}}}))
            with self.assertRaises(ValueError):
                extract_template(archive, Path(temporary) / 'extracted')
        valid = {'status': 'PASS', 'checks': [{'passed': True}], 'cleanup': {'status': 'passed'}}
        require_case(valid)
        for invalid in ({**valid, 'status': 'unsupported'}, {**valid, 'status': 'NOT_RUN'},
                        {**valid, 'checks': []}, {**valid, 'checks': [{'passed': False}]},
                        {**valid, 'cleanup': {'status': 'pending'}}):
            with self.subTest(case=invalid), self.assertRaises(AssertionError):
                require_case(invalid)


if __name__ == '__main__':
    unittest.main()
