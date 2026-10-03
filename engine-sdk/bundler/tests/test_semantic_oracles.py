# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Compare real ES modules and the canonical bundle against fixed CPU oracles."""
from functools import partial
import hashlib
from pathlib import Path
import tempfile
import threading
import unittest

from playwright.sync_api import sync_playwright

from bundler.browser_syntax import _find_browser
from bundler.builder import build_bundle, minify_source
from bundler.graph import ModuleGraph
from sdk.server import SDKHTTPServer, SDKRequestHandler

ORACLE_RESULTS = []
FIXTURES = (
    ("imports-and-reexports", {
        "engine/main.js": "import Demo, { value } from './bridge.js'; import * as ns from './dep.js'; export const result = [new Demo().name, value, ns.extra];",
        "engine/bridge.js": "export { default, value } from './dep.js';",
        "engine/dep.js": "export default class Demo { constructor(){this.name='demo';} } export const value=7; export const extra=9;",
    }, ["demo", 7, 9]),
    ("default-class-and-function-boundary", {
        "engine/main.js": "import Demo from './dep.js'; export const result = [new Demo().value(), typeof Demo];",
        "engine/dep.js": "export default class Demo { value(){return helper();} }\nfunction helper(){return 23;}",
    }, [23, "function"]),
    ("nested-template-and-regex", {
        "engine/main.js": "const x=6,y=3; const check=s=>/walls\\/(front|right|rear|left)\\//.test(s); export const result=[`${x/y}/${`inner-${check('walls/front/stud')}`}`,/a[ ]b/.test('a b'),8 / /2/.source.length];",
    }, ["2/inner-true", True, 8]),
    ("automatic-semicolon-and-destructuring", {
        "engine/main.js": "export const a=2\nlet b=3,c=8\nconst {value: alias=0}={value:11}; export const result=[a,b,c,alias];",
    }, [2, 3, 8, 11]),
    ("dynamic-import-and-import-meta", {
        "engine/main.js": "export const result=(async()=>{const m=await import('./lazy.js');return [m.answer,import.meta.url.endsWith('/engine/main.js')];})();",
        "engine/lazy.js": "export const answer=42;",
    }, [42, True]),
    ("comments-strings-and-export-lookalikes", {
        "engine/main.js": "// import value from './missing.js';\nconst text=\"export default class Fake {}\"; const object={return:24}; export const result=[text,object.return/2/3,typeof /import.*fake/];",
    }, ["export default class Fake {}", 4, "object"]),
)


class QuietHandler(SDKRequestHandler):
    def log_message(self, *_args):
        pass


class ModuleSemanticOracleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        try:
            cls.browser = cls.playwright.chromium.launch(executable_path=str(_find_browser()),
                                                        headless=True, args=["--disable-gpu"])
        except BaseException:
            cls.playwright.stop()
            raise

    @classmethod
    def tearDownClass(cls):
        try:
            cls.browser.close()
        finally:
            cls.playwright.stop()

    def test_native_emitted_and_minified_modules_execute_fixed_oracles(self):
        ORACLE_RESULTS.clear()
        for name, sources, expected in FIXTURES:
            with tempfile.TemporaryDirectory(prefix="sdk-js-oracle-") as directory:
                root = Path(directory)
                for path, source in sources.items():
                    destination = root / path
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_text(source, encoding="utf-8")
                (root / "index.html").write_text('<!doctype html><link rel="icon" href="data:,">', encoding="utf-8")
                graph = ModuleGraph(root)
                graph.walk(root / "engine/main.js")
                bundle = build_bundle(graph, root, entry_ids=["engine/main.js"])
                minified = minify_source(bundle)
                (root / "emitted.js").write_text(bundle, encoding="utf-8")
                (root / "minified.js").write_text(minified, encoding="utf-8")
                server = SDKHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(root)))
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                origin = f"http://127.0.0.1:{server.server_port}"
                try:
                    for mode in ("source", "emitted", "minified"):
                        with self.subTest(fixture=name, mode=mode):
                            context = self.browser.new_context()
                            unexpected = []
                            context.route("**/*", lambda route: route.continue_() if route.request.url.startswith(origin + "/") else (unexpected.append(route.request.url), route.abort()))
                            try:
                                page = context.new_page()
                                page.goto(origin + "/index.html")
                                if mode == "source":
                                    observed = page.evaluate("url => import(url).then(module => module.result)", origin + "/engine/main.js")
                                    identity = {path: hashlib.sha256(source.encode()).hexdigest() for path, source in sources.items()}
                                else:
                                    page.add_script_tag(url=origin + "/" + mode + ".js")
                                    observed = page.evaluate("() => globalThis.PE.result")
                                    identity = hashlib.sha256((bundle if mode == "emitted" else minified).encode()).hexdigest()
                                record = {"name": name, "mode": mode, "expected": expected,
                                          "observed": observed, "inputSha256": identity,
                                          "status": "PASS" if observed == expected and not unexpected else "FAIL"}
                                ORACLE_RESULTS.append(record)
                                self.assertEqual(observed, expected)
                                self.assertEqual(unexpected, [])
                            finally:
                                context.close()
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join(timeout=10)
                    self.assertFalse(thread.is_alive(), "Oracle HTTP server did not stop")

    def test_real_browser_rejects_malformed_emitted_code(self):
        from bundler.browser_syntax import assert_browser_classic_script_syntax
        from bundler.parser import ParseError
        for source in ("const value = ;", "__e.__default = class Demo {} function helper() {}", "const value = `unterminated;"):
            with self.subTest(source=source), self.assertRaises(ParseError):
                assert_browser_classic_script_syntax(source, label="negative-oracle.js")


if __name__ == "__main__":
    unittest.main()
