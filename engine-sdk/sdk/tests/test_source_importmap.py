# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Resolve a real canonical OS static import inside an isolated SDK mount."""

import shutil
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import SkipTest, TestCase, main

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests"))
from run_sdk_acceptance import chrome_path, sdk_server


class SDKSourceImportMapTests(TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            from playwright.sync_api import sync_playwright
            executable = chrome_path()
        except (ImportError, ValueError) as error:
            raise SkipTest(str(error)) from error
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(executable_path=executable, headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def prepare(self, directory, *, helper=True):
        root = Path(directory)
        examples = root / "examples"
        examples.mkdir()
        target = root / "webgpu-os/shared/EchoFormProfile.js"
        target.parent.mkdir(parents=True)
        original = ROOT / "webgpu-os/shared/EchoFormProfile.js"
        shutil.copyfile(original, target)
        self.assertEqual(target.read_bytes(), original.read_bytes())
        shutil.copyfile(ROOT / "sdk/examples/source-importmap.js", examples / "source-importmap.js")
        setup = '<script src="source-importmap.js"></script>' if helper else ""
        (examples / "source.html").write_text(
            '<!doctype html><link rel="icon" href="data:,"><body>' + setup
            + '<script type="module" src="static-witness.js"></script></body>', encoding="utf-8")
        (examples / "static-witness.js").write_text("""
import {
    AI_ECHO_DEFAULT_PRESENTATION,
    normalizeEchoFormPresentation,
} from '/webgpu-os/shared/EchoFormProfile.js';
globalThis.__IMPORT_MAP_TEST_RESULT__ = {
    form: normalizeEchoFormPresentation({ ...AI_ECHO_DEFAULT_PRESENTATION, form: 'orb' }).form,
    defaultForm: AI_ECHO_DEFAULT_PRESENTATION.form,
    credentialless: globalThis.credentialless === true,
};
if (!new URL(location.href).searchParams.has('frame')) {
    const frame = document.createElement('iframe');
    frame.id = 'source-frame';
    frame.credentialless = true;
    frame.src = './source.html?frame=1';
    document.body.append(frame);
}
""", encoding="utf-8")
        return root

    def visit(self, root, mount):
        # This test imports a renderer-neutral contract and never acquires a GPU.
        context = self.browser.new_context(service_workers="block")
        self.addCleanup(context.close)
        diagnostics = {"escaped": [], "errors": [], "http": []}
        with sdk_server(root, mount) as (origin, observations):
            def admit(route):
                url = route.request.url
                if url.startswith(origin + mount) or url.startswith("data:"):
                    route.continue_()
                else:
                    diagnostics["escaped"].append(url)
                    route.abort("blockedbyclient")
            context.route("**/*", admit)
            page = context.new_page()
            page.add_init_script("Object.defineProperty(Navigator.prototype,'gpu',{get(){throw new Error('Static import test must not acquire WebGPU')}});")
            page.on("pageerror", lambda error: diagnostics["errors"].append(str(error)))
            page.on("response", lambda response: diagnostics["http"].append(response.url) if response.status >= 400 else None)
            page.goto(origin + mount + "examples/source.html", wait_until="networkidle")
            result = page.evaluate("globalThis.__IMPORT_MAP_TEST_RESULT__ || null")
            if result is not None:
                page.wait_for_function("document.querySelector('#source-frame')?.contentWindow.__IMPORT_MAP_TEST_RESULT__")
                child = page.evaluate("document.querySelector('#source-frame').contentWindow.__IMPORT_MAP_TEST_RESULT__")
                imports = page.evaluate("JSON.parse(document.querySelector('script[type=importmap]').textContent).imports")
            else:
                child, imports = None, None
            return origin, result, child, imports, diagnostics, list(observations)

    def test_static_import_and_credentialless_frame_stay_inside_both_mounts(self):
        for mount in ("/", "/sdk-nested/"):
            with self.subTest(mount=mount), TemporaryDirectory(prefix="sdk-source-map-") as temporary:
                origin, result, child, imports, diagnostics, requests = self.visit(self.prepare(temporary), mount)
                self.assertIsNotNone(result, diagnostics)
                self.assertEqual(result["form"], "orb")
                self.assertEqual(result["defaultForm"], "cube")
                self.assertEqual(child["form"], "orb")
                self.assertTrue(child["credentialless"])
                self.assertEqual(imports, {f"/{name}/": f"{origin}{mount}{name}/" for name in (
                    "engine", "editor", "plauna", "agi", "webgpu-os")})
                self.assertEqual(diagnostics, {"escaped": [], "errors": [], "http": []})
                canonical = mount + "webgpu-os/shared/EchoFormProfile.js"
                self.assertEqual(sum(item["path"] == canonical and item["status"] == 200 for item in requests), 2)

    def test_nested_static_import_has_no_repository_fallback_without_map(self):
        with TemporaryDirectory(prefix="sdk-source-map-negative-") as temporary:
            origin, result, child, imports, diagnostics, requests = self.visit(self.prepare(temporary, helper=False), "/sdk-nested/")
            self.assertIsNone(result)
            self.assertIsNone(child)
            self.assertIsNone(imports)
            self.assertEqual(diagnostics["escaped"], [origin + "/webgpu-os/shared/EchoFormProfile.js"])
            self.assertFalse(any(item["path"].endswith("EchoFormProfile.js") for item in requests))


if __name__ == "__main__":
    main()
