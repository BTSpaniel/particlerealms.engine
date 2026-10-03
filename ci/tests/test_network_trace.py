# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Fail closed when passive early-worker socket coverage is incomplete."""
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from network_trace import BrowserSocketTrace, socket_request_url


def request_event(url, **extra):
    return {'name': 'URL_REQUEST_START_JOB', 'cat': 'netlog', 'ph': 'b',
        'args': {'source_type': 'URL_REQUEST', 'params': {'url': url, **extra}}}


class BrowserSocketTraceTests(unittest.TestCase):
    def setUp(self):
        self.session = Mock()
        self.browser = Mock()
        self.browser.new_browser_cdp_session.return_value = self.session
        self.handlers = {}
        self.session.on.side_effect = lambda name, handler: self.handlers.update({name: handler})

    def complete_on_end(self, event=None):
        def send(method, params=None):
            if method == 'Tracing.end':
                self.handlers['Tracing.tracingComplete']({'dataLossOccurred': False} if event is None else event)
        self.session.send.side_effect = send

    def test_parser_accepts_only_actual_netlog_socket_request_urls(self):
        for url in ('ws://127.0.0.1:9001/socket', 'wss://android.clients.google.com/worker?probe=1'):
            self.assertEqual(socket_request_url(request_event(url)), url)
        valid = request_event('wss://example.test/socket')
        rejected = [None, [], {}, {**valid, 'name': 'WebSocketCreate'},
            {**valid, 'cat': 'devtools.timeline'}, {**valid, 'args': None},
            {**valid, 'args': {'source_type': 'OTHER', 'params': {'url': 'wss://example.test'}}},
            {**valid, 'args': {'source_type': 'URL_REQUEST', 'params': None}},
            request_event('https://example.test'), request_event('blob:wss://example.test'),
            request_event('wss://[invalid'), request_event('wss:///missing-host'), request_event(123)]
        for event in rejected:
            with self.subTest(event=event):
                self.assertIsNone(socket_request_url(event))

    def test_handlers_are_registered_before_the_proved_category_starts(self):
        trace = BrowserSocketTrace(self.browser).start()
        self.assertIs(trace.browser, self.browser)
        self.assertEqual(set(self.handlers), {'Tracing.dataCollected', 'Tracing.tracingComplete'})
        self.session.send.assert_called_once_with('Tracing.start',
            {'categories': '-*,netlog', 'transferMode': 'ReportEvents'})
        self.complete_on_end()
        trace.finish()

    def test_finished_report_retains_urls_and_counts_without_raw_sensitive_events(self):
        trace = BrowserSocketTrace(self.browser).start()
        urls = ['wss://z.test/worker', 'ws://a.test/page', 'wss://z.test/worker']
        events = [request_event(url, headers=['Authorization: secret']) for url in urls]
        events += [request_event('https://example.test/browser-maintenance'), {'name': 'thread_name'}]
        self.handlers['Tracing.dataCollected']({'value': events})
        self.complete_on_end()
        report = trace.finish()
        self.assertEqual(report, {'status': 'PASS', 'categories': '-*,netlog', 'completed': True,
            'dataLossOccurred': False, 'eventCount': 5, 'socketRequestEvents': 3,
            'urls': ['ws://a.test/page', 'wss://z.test/worker']})
        self.assertNotIn('secret', repr(report))
        self.assertFalse(hasattr(trace, '_raw_events'))
        self.session.detach.assert_called_once()

    def test_finishing_pumps_browser_cdp_until_all_trace_events_arrive(self):
        trace = BrowserSocketTrace(self.browser).start()
        def send(method, params=None):
            if method == 'Browser.getVersion':
                self.handlers['Tracing.dataCollected']({'value': [request_event('wss://early-worker.test/socket')]})
                self.handlers['Tracing.tracingComplete']({'dataLossOccurred': False})
        self.session.send.side_effect = send
        report = trace.finish()
        self.assertEqual(report['urls'], ['wss://early-worker.test/socket'])
        self.assertIn((('Browser.getVersion',), {}), [(call.args, call.kwargs) for call in self.session.send.call_args_list])
        self.session.detach.assert_called_once()

    def test_completed_trace_does_not_wait_for_an_application_page(self):
        trace = BrowserSocketTrace(self.browser).start()
        self.complete_on_end()
        report = trace.finish()
        self.assertTrue(report['completed'])
        self.assertNotIn('Browser.getVersion', [call.args[0] for call in self.session.send.call_args_list])

    def test_trace_loss_and_missing_loss_status_fail_after_detaching(self):
        for completion in ({'dataLossOccurred': True}, {}):
            with self.subTest(completion=completion):
                self.setUp()
                trace = BrowserSocketTrace(self.browser).start()
                self.complete_on_end(completion)
                with self.assertRaisesRegex(RuntimeError, 'lost data'):
                    trace.finish()
                self.session.detach.assert_called_once()
                with self.assertRaisesRegex(RuntimeError, 'trace failed'):
                    trace.finish()

    def test_trace_timeout_fails_and_detaches(self):
        trace = BrowserSocketTrace(self.browser, timeout_seconds=1).start()
        with patch('network_trace.time.monotonic', side_effect=[100, 102]):
            with self.assertRaisesRegex(TimeoutError, 'deadline'):
                trace.finish()
        self.session.detach.assert_called_once()

    def test_failed_start_and_failed_finish_cannot_be_reused(self):
        for command in ('Tracing.start', 'Tracing.end'):
            with self.subTest(command=command):
                self.setUp()
                def send(method, params=None):
                    if method == command:
                        raise RuntimeError('driver failed')
                self.session.send.side_effect = send
                trace = BrowserSocketTrace(self.browser)
                with self.assertRaisesRegex(RuntimeError, 'driver failed'):
                    trace.start() if command == 'Tracing.start' else trace.start().finish()
                self.session.detach.assert_called_once()
                with self.assertRaisesRegex(RuntimeError, 'only be started once'):
                    trace.start()

    def test_start_and_finish_lifecycle_rejects_misuse_and_reuses_completed_result(self):
        trace = BrowserSocketTrace(self.browser)
        with self.assertRaisesRegex(RuntimeError, 'was not started'):
            trace.finish()
        trace.start()
        with self.assertRaisesRegex(RuntimeError, 'only be started once'):
            trace.start()
        self.handlers['Tracing.dataCollected']({'value': [request_event('wss://worker.test/socket')]})
        self.complete_on_end()
        report = trace.finish()
        report['urls'].clear()
        self.assertEqual(trace.finish()['urls'], ['wss://worker.test/socket'])
        self.assertEqual([call.args[0] for call in self.session.send.call_args_list].count('Tracing.end'), 1)
        self.session.detach.assert_called_once()

    def test_timeout_configuration_is_bounded(self):
        self.assertEqual(BrowserSocketTrace(self.browser).timeout_seconds, 45)
        self.assertEqual(BrowserSocketTrace(self.browser, timeout_seconds=45).timeout_seconds, 45)
        for timeout in (0, -1, 46):
            with self.subTest(timeout=timeout), self.assertRaises(ValueError):
                BrowserSocketTrace(self.browser, timeout_seconds=timeout)


if __name__ == '__main__':
    unittest.main()
