# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Run real browser crypto, RTP, SCTP and Watch Party lifecycle tests."""

from __future__ import annotations

import functools
import http.server
from pathlib import Path
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
CANDIDATES = (
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
)


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, _format: str, *_args: object) -> None:
        pass

    def end_headers(self) -> None:
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    executable = next((path for path in CANDIDATES if path.is_file()), None)
    if executable is None:
        raise FileNotFoundError("Install Chrome or Edge to run the browser suite")
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(ROOT)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=str(executable), headless=True,
                args=["--autoplay-policy=no-user-gesture-required"])
            try:
                page = browser.new_page()
                errors: list[str] = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(f"http://127.0.0.1:{server.server_port}/engine/media/party/tests/party.test.html")
                page.wait_for_function("() => ['passed','failed'].includes(document.documentElement.dataset.testStatus)", timeout=120_000)
                result = page.evaluate("() => ({status:document.documentElement.dataset.testStatus,results:window.partyTestResults})")
                for test in result["results"]:
                    print(f"{'PASS' if test['passed'] else 'FAIL'} {test['name']}")
                    if test.get("error"):
                        print(test["error"])
                for error in errors:
                    print(f"PAGE ERROR {error}")
                return 0 if result["status"] == "passed" and not errors else 1
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
