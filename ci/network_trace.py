# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Passively observe browser-wide socket attempts, including early workers.

Chromium's browser NetLog exists before a worker debugger attaches. Keep only
socket request URLs and counts; never retain raw trace events or headers.
"""
from __future__ import annotations

import time
from urllib.parse import urlsplit


def socket_request_url(event):
    """Return the URL of a real NetLog socket request, or None for other events."""
    if not isinstance(event, dict) or event.get('name') != 'URL_REQUEST_START_JOB':
        return None
    if 'netlog' not in str(event.get('cat', '')).split(','):
        return None
    arguments = event.get('args')
    if not isinstance(arguments, dict) or arguments.get('source_type') != 'URL_REQUEST':
        return None
    parameters = arguments.get('params')
    url = parameters.get('url') if isinstance(parameters, dict) else None
    if not isinstance(url, str):
        return None
    try:
        parsed = urlsplit(url)
        if parsed.scheme in ('ws', 'wss') and parsed.hostname:
            return url
    except ValueError:
        pass
    return None


class BrowserSocketTrace:
    """Start before contexts are created; finish after their disposal."""
    CATEGORIES = '-*,netlog'

    def __init__(self, browser, timeout_seconds=45):
        if timeout_seconds <= 0 or timeout_seconds > 45:
            raise ValueError('Socket trace completion timeout must be within (0, 45] seconds')
        self.browser = browser
        self.timeout_seconds = timeout_seconds
        self._session = None
        self._started = False
        self._finished = False
        self._completion = None
        self._report = None
        self._failure = None
        self._events = 0
        self._socket_events = 0
        self._urls = set()

    def _collect(self, packet):
        for event in packet['value']:
            self._events += 1
            url = socket_request_url(event)
            if url is not None:
                self._socket_events += 1
                self._urls.add(url)

    def start(self):
        if self._started or self._finished:
            raise RuntimeError('A browser socket trace can only be started once')
        self._session = self.browser.new_browser_cdp_session()
        self._started = True
        try:
            self._session.on('Tracing.dataCollected', self._collect)
            self._session.on('Tracing.tracingComplete', lambda event: setattr(self, '_completion', event))
            self._session.send('Tracing.start', {'categories': self.CATEGORIES,
                'transferMode': 'ReportEvents'})
        except Exception as error:
            self._failure = error
            self._finished = True
            self._detach()
            raise
        return self

    def _detach(self):
        session, self._session = self._session, None
        if session is not None:
            try:
                session.detach()
            except Exception as error:
                if self._failure is None:
                    self._failure = error
                    raise

    def finish(self):
        if not self._started:
            raise RuntimeError('Browser socket trace was not started')
        if self._failure is not None:
            raise RuntimeError('Browser socket trace failed: ' + str(self._failure)) from self._failure
        if self._finished:
            return {**self._report, 'urls': list(self._report['urls'])}
        try:
            self._session.send('Tracing.end')
            deadline = time.monotonic() + self.timeout_seconds
            while self._completion is None and time.monotonic() < deadline:
                # A synchronous CDP call dispatches trace batches and the
                # completion event without requiring an application page.
                self._session.send('Browser.getVersion')
                if self._completion is None:
                    time.sleep(.02)
            if self._completion is None:
                raise TimeoutError('Browser socket trace did not complete within its deadline')
            if self._completion.get('dataLossOccurred') is not False:
                raise RuntimeError('Browser socket trace lost data or did not report its loss status')
            self._report = {'status': 'PASS', 'categories': self.CATEGORIES,
                'completed': True, 'dataLossOccurred': False, 'eventCount': self._events,
                'socketRequestEvents': self._socket_events, 'urls': sorted(self._urls)}
        except Exception as error:
            self._failure = error
            raise
        finally:
            self._finished = True
            self._detach()
        return {**self._report, 'urls': list(self._report['urls'])}
