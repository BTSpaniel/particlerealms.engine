# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Final classic-script parsing through the release runtime's real JS engine."""

from __future__ import annotations

import html
import http.server
import os
import re
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

from .parser import ParseError

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # Direct Chromium remains the dependency-free fallback.
    sync_playwright = None


_BROWSER_CANDIDATES = (
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
)
_PARSE_SENTINEL = b"throw new Error('__PE_FINAL_PARSE_SENTINEL__');\n"
_HARNESS = b"""<!doctype html>
<html data-test-status="running"><head><meta charset="utf-8">
<script>
window.addEventListener('error', event => {
  const results = document.getElementById('results');
  const sentinel = event.error?.message === '__PE_FINAL_PARSE_SENTINEL__';
  document.documentElement.dataset.testStatus = sentinel ? 'passed' : 'failed';
  const location = event.lineno ? ` at ${event.lineno}:${event.colno || 0}` : '';
  results.textContent = sentinel
    ? 'PASS final runtime parsed as a classic script'
    : `FAIL ${event.error?.name || 'ScriptError'}: ${event.message || 'unknown error'}${location}`;
  event.preventDefault();
}, true);
</script></head><body>
<pre id="results">RUNNING</pre>
<script src="/runtime.js"></script>
<script>
if (document.documentElement.dataset.testStatus === 'running') {
  document.documentElement.dataset.testStatus = 'failed';
  document.getElementById('results').textContent = 'FAIL runtime script produced no parse result';
}
</script></body></html>
"""


def _find_browser() -> Path:
    configured = os.environ.get("PARTICLE_JS_SYNTAX_BROWSER", "").strip()
    if configured:
        candidate = Path(configured)
        if candidate.is_file():
            return candidate
        raise ParseError(f"Configured JavaScript syntax browser does not exist: {candidate}")
    for candidate in _BROWSER_CANDIDATES:
        if candidate.is_file():
            return candidate
    for command in ("chrome", "msedge", "chromium", "chromium-browser"):
        resolved = shutil.which(command)
        if resolved:
            return Path(resolved)
    raise ParseError(
        "Final runtime syntax validation requires Chrome, Edge, or Chromium; "
        "set PARTICLE_JS_SYNTAX_BROWSER to its executable"
    )


def _result_from_document(document: str) -> tuple[str, str]:
    status_match = re.search(
        r"<html\b[^>]*\bdata-test-status=[\"']([^\"']+)[\"']",
        document,
        flags=re.IGNORECASE,
    )
    result_match = re.search(
        r"<pre\b[^>]*\bid=[\"']results[\"'][^>]*>(.*?)</pre>",
        document,
        flags=re.DOTALL | re.IGNORECASE,
    )
    status = status_match.group(1).lower() if status_match else "missing"
    summary = ""
    if result_match:
        summary = html.unescape(re.sub(r"<[^>]+>", "", result_match.group(1))).strip()
    return status, summary


def assert_browser_classic_script_syntax(
    source: str | bytes,
    *,
    label: str = "bundle",
    timeout_seconds: int = 120,
) -> None:
    """Have Chromium parse final transformed bytes without executing them.

    The in-memory bytes are served only on a loopback ephemeral port. Chromium
    loads them as an external classic script with a throwing statement prepended.
    A valid script reaches that sentinel before any runtime code executes; an
    invalid script fails during the browser's complete pre-execution parse.
    """
    runtime = source.encode("utf-8") if isinstance(source, str) else bytes(source)

    class SyntaxHandler(http.server.BaseHTTPRequestHandler):
        def log_message(self, _format: str, *_args: object) -> None:
            pass

        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/":
                payload = _HARNESS
                content_type = "text/html; charset=utf-8"
            elif self.path == "/runtime.js":
                # Classic scripts are parsed completely before execution. The
                # recognized first-statement throw proves parsing succeeded and
                # prevents every actual runtime statement from executing.
                payload = _PARSE_SENTINEL + runtime
                content_type = "text/javascript; charset=utf-8"
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), SyntaxHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    status = "missing"
    summary = ""
    process_evidence = ""
    try:
        browser = _find_browser()
        url = f"http://127.0.0.1:{server.server_port}/"
        if sync_playwright is not None:
            with sync_playwright() as playwright:
                browser_process = playwright.chromium.launch(
                    executable_path=str(browser),
                    headless=True,
                    args=(
                        "--disable-gpu",
                        "--disable-background-networking",
                        "--no-first-run",
                        "--no-default-browser-check",
                    ),
                )
                try:
                    page = browser_process.new_page()
                    page.goto(url, wait_until="load", timeout=timeout_seconds * 1_000)
                    status = page.evaluate("document.documentElement.dataset.testStatus")
                    summary = page.locator("#results").inner_text().strip()
                finally:
                    browser_process.close()
        else:
            with tempfile.TemporaryDirectory(prefix="particle-runtime-syntax-") as profile:
                completed = subprocess.run(
                    [
                        str(browser),
                        "--headless=new",
                        "--disable-gpu",
                        "--disable-background-networking",
                        "--no-sandbox",
                        "--no-first-run",
                        "--no-default-browser-check",
                        "--log-level=3",
                        f"--user-data-dir={profile}",
                        "--virtual-time-budget=5000",
                        "--dump-dom",
                        url,
                    ],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=timeout_seconds,
                    check=False,
                )
            status, summary = _result_from_document(completed.stdout)
            if completed.returncode != 0:
                process_evidence = completed.stderr.strip()[-2_000:]
    except subprocess.TimeoutExpired as error:
        raise ParseError(
            f"{label} browser syntax validation timed out after {timeout_seconds}s"
        ) from error
    except ParseError:
        raise
    except Exception as error:
        raise ParseError(f"{label} browser syntax validation failed: {error}") from error
    finally:
        server.shutdown()
        server.server_close()

    if process_evidence or status != "passed":
        evidence = summary or process_evidence or "browser returned no result"
        raise ParseError(f"{label} failed final browser syntax validation: {evidence}")
