# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Check real docs navigation with normal and reduced motion in Chromium.

Uses the served viewer and shared transition implementation unchanged. The
instrumentation delegates every animation/native transition to the browser.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests" / "storage"))
from performance_run_lock import performance_run_lock

SOURCES = (
    "MD/viewer/index.html", "MD/viewer/viewer.js", "MD/viewer/viewer.css",
    "plauna/motion/PageTransition.js", "plauna/motion/PageTransitionManager.js",
    "plauna/motion/PageTransitionPresets.js", "plauna/motion/PageTransitionContracts.js",
    "plauna/motion/MPAFallback.js", "engine/core/math/MathRandom.js",
    "MD/_config/nav.json", "MD/_config/docs-bundle.json.gz",
    "MD/tools/check_viewer_transitions.py",
)
PAGES = ("engine/surface-fields.md", "engine/physics.md")
INSTRUMENT = """() => {
  const probe = window.__docsTransitionProbe = { animations: [], nativeCalls: 0 };
  const animate = Element.prototype.animate;
  Element.prototype.animate = function(...args) {
    probe.animations.push({ id: this.id, tag: this.tagName, duration: args[1]?.duration });
    return Reflect.apply(animate, this, args);
  };
  if (document.startViewTransition) {
    const start = document.startViewTransition;
    document.startViewTransition = function(...args) {
      probe.nativeCalls++;
      return Reflect.apply(start, this, args);
    };
  }
} """
SETTLED = """() => document.getAnimations().every(animation =>
  !['running', 'pending'].includes(animation.playState))"""


def source_hashes():
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in SOURCES}


def exercise(browser, base_url, reduced_motion, output):
    result = {"motion": reduced_motion, "checks": [], "pageErrors": [], "consoleErrors": [],
              "networkLogErrors": [], "httpErrors": [], "failedRequests": [], "contextClosed": False}
    context = browser.new_context(viewport={"width": 1440, "height": 1000},
                                  reduced_motion=reduced_motion)
    try:
        context.add_init_script("(" + INSTRUMENT + ")()")
        page = context.new_page()
        page.on("pageerror", lambda error: result["pageErrors"].append(str(error)))

        def log_error(message):
            if message.type != "error":
                return
            result["consoleErrors"].append({"text": message.text, "location": message.location})

        page.on("console", log_error)
        page.on("requestfailed", lambda request: result["failedRequests"].append({"url": request.url, "failure": request.failure}))
        cdp = context.new_cdp_session(page)
        # Browser-initiated favicon fetches are not exposed by Playwright's
        # page response event. CDP observes their actual URL/status as well.
        cdp.send("Network.enable")
        cdp.on("Network.responseReceived", lambda event: result["httpErrors"].append({"url": event["response"]["url"], "status": event["response"]["status"]}) if event["response"]["status"] >= 400 else None)
        cdp.send("Log.enable")
        cdp.on("Log.entryAdded", lambda event: result["networkLogErrors"].append(event["entry"]) if event["entry"].get("level") == "error" else None)
        page.goto(base_url.rstrip("/") + "/MD/viewer/", wait_until="domcontentloaded")
        page.wait_for_function("() => document.querySelector('#source-path')?.textContent.includes('MD/index.md')")
        page.wait_for_function(SETTLED)
        result["nativeSupported"] = page.evaluate("typeof document.startViewTransition === 'function'")
        assert result["nativeSupported"], "Regression needs a native-capable browser to exercise the prior collision"
        page.evaluate("window.__docsTransitionProbe.animations.length = 0; window.__docsTransitionProbe.nativeCalls = 0")
        for path in PAGES:
            page.get_by_label("Filter navigation", exact=True).fill(path)
            link = page.locator(f'#nav-filter-results a[data-path="{path}"]')
            link.wait_for(state="visible")
            # Real mouse input, not the viewer's internal loadDoc function.
            link.click()
            page.wait_for_function("path => document.querySelector('#source-path')?.textContent.includes('MD/' + path)", arg=path)
            page.wait_for_function(SETTLED)
            observed = page.evaluate("""() => {
              const article = document.querySelector('#doc-content');
              const style = getComputedStyle(article);
              return {
                heading: article.querySelector('h1')?.textContent,
                missing: /Page not found|Could not load navigation/.test(article.textContent),
                tocLinks: document.querySelectorAll('#toc-list a').length,
                focused: document.activeElement === article,
                opacity: style.opacity, transform: style.transform,
                articleTransitionName: style.viewTransitionName,
                rootTransitionName: getComputedStyle(document.documentElement).viewTransitionName,
                inlineStyle: article.getAttribute('style'),
                hash: location.hash
              };
            }""")
            assert observed["heading"] and not observed["missing"], observed
            assert observed["tocLinks"] > 0 and observed["focused"], observed
            assert observed["opacity"] == "1" and observed["transform"] == "none", observed
            assert observed["articleTransitionName"] != "root", observed
            assert observed["rootTransitionName"] == "root", observed
            assert not observed["inlineStyle"], observed
            assert observed["hash"] == "#/" + path, observed
            result["checks"].append({"path": path, **observed})
        result["probe"] = page.evaluate("window.__docsTransitionProbe")
        animations = result["probe"]["animations"]
        assert result["probe"]["nativeCalls"] == 0, result["probe"]
        if reduced_motion == "no-preference":
            assert len(animations) == 2 * len(PAGES), animations
            assert all(item["id"] == "doc-content" and item["duration"] == 125 for item in animations), animations
        else:
            assert animations == [], animations
        page.screenshot(path=str(output / (reduced_motion + ".png")))
    finally:
        try:
            context.close()
            result["contextClosed"] = True
        finally:
            favicon = base_url.rstrip("/") + "/favicon.ico"
            result["favicon404"] = [row for row in result["httpErrors"] if row == {"url": favicon, "status": 404}]
            is_favicon = lambda row: bool(result["favicon404"]) and row.get("url") == favicon and "404" in row.get("text", "")
            result["unexpectedHttpErrors"] = [row for row in result["httpErrors"] if row not in result["favicon404"]]
            result["unexpectedConsoleErrors"] = [row for row in result["consoleErrors"] if not is_favicon({**row, "url": row["location"].get("url")})]
            result["unexpectedLogErrors"] = [row for row in result["networkLogErrors"] if not is_favicon(row)]
            (output / (reduced_motion + ".json")).write_text(json.dumps(result, indent=2), encoding="utf-8")
    assert not any(result[key] for key in ("pageErrors", "failedRequests", "unexpectedHttpErrors", "unexpectedConsoleErrors", "unexpectedLogErrors")), result
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:9001")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    if (output / "receipt.json").exists():
        raise RuntimeError("Refusing to overwrite prior verification evidence")
    output.mkdir(parents=True, exist_ok=True)
    receipt = {"status": "FAIL", "cases": [], "errors": [], "browserClosed": False}
    with performance_run_lock(ROOT):
        receipt["sourceHashesBefore"] = source_hashes()
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(channel="chrome", headless=True)
                try:
                    for motion in ("no-preference", "reduce"):
                        receipt["cases"].append(exercise(browser, args.base_url, motion, output))
                finally:
                    browser.close()
                    receipt["browserClosed"] = True
        except Exception as error:
            receipt["errors"].append(repr(error))
        finally:
            receipt["sourceHashesAfter"] = source_hashes()
            receipt["sourceAgreement"] = receipt["sourceHashesBefore"] == receipt["sourceHashesAfter"]
            if not receipt["sourceAgreement"]:
                receipt["errors"].append("Selected viewer sources changed during verification")
            if len(receipt["cases"]) == 2 and receipt["browserClosed"] and not receipt["errors"]:
                receipt["status"] = "PASS"
            receipt["checkedAt"] = datetime.now(timezone.utc).isoformat()
            (output / "receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
            print(json.dumps({"status": receipt["status"], "cases": len(receipt["cases"]), "errors": receipt["errors"]}), flush=True)
    return 0 if receipt["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
