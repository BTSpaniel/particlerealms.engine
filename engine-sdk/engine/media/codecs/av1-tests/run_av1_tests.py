# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Verify authored AV1 arithmetic/palette code using independent browser pixels."""
from __future__ import annotations
import functools
import http.server
import json
from pathlib import Path
import sys
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
CANDIDATES = (Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"), Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"), Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"))

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, _format: str, *_args: object) -> None:
        pass

def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    executable = next((path for path in CANDIDATES if path.is_file()), None)
    if executable is None:
        raise FileNotFoundError("Chrome or Edge required for independent AV1 decoder validation")
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(ROOT)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=str(executable), headless=True)
            try:
                page = browser.new_page()
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(f"http://127.0.0.1:{server.server_port}/engine/media/codecs/av1-tests/av1.test.html")
                page.wait_for_function("() => ['passed','failed'].includes(document.documentElement.dataset.testStatus)", timeout=60000)
                result = page.evaluate("() => ({status:document.documentElement.dataset.testStatus, results:window.av1TestResults})")
                print(json.dumps(result, indent=2))
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
