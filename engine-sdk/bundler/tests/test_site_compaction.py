# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import functools
import http.server
import json
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path
from unittest import mock
from urllib.parse import unquote, urlsplit

from bundler.browser_syntax import _find_browser, sync_playwright
from bundler.site import create_release_site_archive, _read_webgpu_os_shell_resource_paths
from bundler.site_compaction import (
    compact_release_site,
    _boot_document,
    promote_compact_release_site,
    verify_site_archives,
    _verify_worker_closure,
)
from bundler.stable_resource_inventory import stable_network_resource_repository_paths

ROOT = Path(__file__).resolve().parents[2]


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript"}

    def log_message(self, *_args):
        pass

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()


class TestSiteCompaction(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.source = self.directory / "site"
        self.output = self.directory / "upload"
        self.source.mkdir()
        self.write("index.html", """<!doctype html><html><head><title>Archive regression</title>
<link rel="stylesheet" href="/plauna/theme.css"></head><body>
<div id="value"></div><script>window.domReadyCount=0;document.addEventListener('DOMContentLoaded',()=>domReadyCount++);</script>
<script type="module" src="/playground/src/main.js"></script></body></html>""")
        self.write("playground/index.html", (self.source / "index.html").read_text("utf-8"))
        self.write("playground/src/main.js", """
import {value} from './dependency.js';
const data=await (await fetch('/plauna/data.json?fixture=1')).json();
const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
const workerValue=await new Promise((resolve,reject)=>{worker.onmessage=e=>resolve(e.data);worker.onerror=reject;});
worker.terminate();document.getElementById('value').textContent=String(value+data.offset);
window.result={value,workerValue,url:import.meta.url,isolated:crossOriginIsolated};
""")
        self.write("playground/src/dependency.js", "export const value=41;\n")
        self.write("playground/src/worker.js", "import {value} from './dependency.js'; postMessage(value);\n")
        self.write("plauna/data.json", '{"offset":1}')
        self.write("plauna/theme.css", '@import url("./color.css");')
        self.write("plauna/color.css", '#value {color:rgb(1,2,3)}')
        self.write("vendor/range.txt", "0123456789")
        self.write("_headers", "/*\n  Cross-Origin-Embedder-Policy: require-corp\n"
                   "  Cross-Origin-Opener-Policy: same-origin\n/playground/src/worker.js\n"
                   "  Content-Security-Policy: default-src 'none'; script-src 'self'; connect-src 'none'\n")
        for index in range(30):
            self.write(f"plauna/catalog/{index}.json", json.dumps({"index": index}))

    def write(self, name, content):
        path = self.source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, "utf-8")

    def pack(self):
        return compact_release_site(ROOT, self.source, self.output, max_files=20)

    def test_exact_bytes_determinism_and_logical_required_members(self):
        originals = {path.relative_to(self.source).as_posix(): path.read_bytes()
                     for path in self.source.rglob("*") if path.is_file()}
        self.pack()
        members = verify_site_archives(self.output)
        self.assertIn("playground/src/main.js", members)
        self.assertFalse((self.output / "playground/src/main.js").exists())
        first = {path.relative_to(self.output).as_posix(): path.read_bytes()
                 for path in self.output.rglob("*") if path.is_file()}
        self.assertLessEqual(len(first), 20)
        self.assertEqual(originals, {path.relative_to(self.source).as_posix(): path.read_bytes()
                                    for path in self.source.rglob("*") if path.is_file()})
        archive = self.directory / "upload.zip"
        count, _ = create_release_site_archive(self.output, archive, required_paths=originals)
        with zipfile.ZipFile(archive) as zipped:
            self.assertEqual(count, len(zipped.namelist()))
            self.assertLessEqual(count, 20)
        self.pack()
        self.assertEqual(first, {path.relative_to(self.output).as_posix(): path.read_bytes()
                                for path in self.output.rglob("*") if path.is_file()})

    def test_corruption_cannot_satisfy_required_paths(self):
        self.pack()
        archive = next((self.output / "assets").glob("site-files-*.zip"))
        archive.write_bytes(archive.read_bytes()[:-1] + b"!")
        with self.assertRaisesRegex(ValueError, "integrity mismatch"):
            verify_site_archives(self.output)
        with self.assertRaisesRegex(ValueError, "integrity mismatch"):
            create_release_site_archive(self.output, self.directory / "bad.zip",
                                        required_paths=["playground/src/main.js"])

    def test_worker_policy_and_bootstrap_files_stay_available(self):
        self.pack()
        manifest = json.loads((self.output / "site-archive-manifest.json").read_text("utf-8"))
        self.assertEqual(manifest["files"]["playground/src/worker.js"]["headers"]["Content-Security-Policy"],
                         "default-src 'none'; script-src 'self'; connect-src 'none'")
        self.assertTrue((self.output / "site-archive-sw.js").is_file())
        self.assertTrue((self.output / "engine/core/math/ChecksumMath.js").is_file())
        with self.assertRaisesRegex(ValueError, "overlap"):
            compact_release_site(ROOT, self.source, self.source)

    def test_os_source_inventory_compacts_but_bootstrap_and_portable_kit_stay_physical(self):
        shell = {"webgpu-os/" + name for name in _read_webgpu_os_shell_resource_paths(ROOT / "webgpu-os/sw.js")}
        protected = set(stable_network_resource_repository_paths(ROOT))
        protected.update(_verify_worker_closure(ROOT, "webgpu-os/sw.js"))
        for name in protected | shell:
            target = self.source / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((ROOT / name).read_bytes())
        for index in range(1100):
            self.write(f"webgpu-os/apps/example/parts/{index}.js", f"export const value={index};")
        stable = "webgpu-os/kernel/net-safety.js"
        kit = "webgpu-os/assets/engine-demo/runtime-kit.json"
        self.write(kit, '{"portable":true}')
        compact_release_site(ROOT, self.source, self.output, max_files=500)
        members = verify_site_archives(self.output)
        self.assertIn("webgpu-os/apps/example/parts/1099.js", members)
        self.assertNotIn(stable, members)
        self.assertNotIn(kit, members)
        self.assertEqual((self.output / stable).read_bytes(), (self.source / stable).read_bytes())
        self.assertEqual((self.output / kit).read_bytes(), (self.source / kit).read_bytes())
        self.assertTrue((self.output / "webgpu-os/platform/runtime-host/SiteArchiveRouter.js").is_file())
        for name in shell:
            self.assertNotIn(name, members)
            self.assertTrue((self.output / name).is_file(), name)
            if not name.endswith('.html'):
                self.assertEqual((self.output / name).read_bytes(), (self.source / name).read_bytes(), name)

    def test_preload_is_self_contained_and_template_changes_version(self):
        from bundler.site_compaction import BOOT_SHELL_PATH
        shell = _boot_document(b'<title>A &amp; B @@VERSION@@</title>', 'test-version', False).decode()
        self.assertIn('<title>A &amp; B @@VERSION@@</title>', shell)
        self.assertIn('name="color-scheme" content="dark"', shell)
        self.assertIn('role="progressbar"', shell)
        self.assertIn('prefers-reduced-motion', shell)
        self.assertIn('data:image/svg+xml;base64,', shell)
        self.assertNotIn('<link rel="stylesheet"', shell)
        self.assertNotIn('@@DOCUMENT@@', shell)
        self.pack()
        first = json.loads((self.output / 'site-archive-manifest.json').read_text('utf-8'))['version']
        template = self.directory / 'updated-shell.html'
        template.write_text(BOOT_SHELL_PATH.read_text('utf-8') + '\n<!-- updated shell -->\n', 'utf-8')
        with mock.patch('bundler.site_compaction.BOOT_SHELL_PATH', template):
            self.pack()
        second = json.loads((self.output / 'site-archive-manifest.json').read_text('utf-8'))['version']
        self.assertNotEqual(first, second)

    @unittest.skipIf(sync_playwright is None, "Playwright required")
    def test_preload_first_paint_real_progress_mobile_reduced_motion_and_retry(self):
        with mock.patch('bundler.site_compaction.MAX_ARCHIVE_RAW_BYTES', 2048):
            self.pack()
        download_gate = threading.Event()
        remaining_gate = threading.Event()

        class SlowArchiveHandler(Handler):
            def do_GET(self):
                if self.path.split('?')[0].endswith('.zip'):
                    gate = download_gate if 'site-files-0-' in self.path else remaining_gate
                    gate.wait(timeout=30)
                return super().do_GET()

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0),
                    functools.partial(SlowArchiveHandler, directory=str(self.output)))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        evidence = ROOT / 'tmp/site-preload-validation'
        evidence.mkdir(parents=True, exist_ok=True)
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(executable_path=str(_find_browser()), headless=True)
                try:
                    url = f'http://127.0.0.1:{server.server_port}/'
                    context = browser.new_context(viewport={'width': 1280, 'height': 800})
                    page = context.new_page()
                    page.goto(url)
                    page.wait_for_function("document.getElementById('pe-site-phase')?.textContent==='DOWNLOADING'")
                    self.assertEqual(page.locator('#pe-site-heading').inner_text(), 'Preparing your realm')
                    self.assertEqual(page.evaluate('getComputedStyle(document.documentElement).backgroundColor'), 'rgb(5, 7, 17)')
                    self.assertIsNone(page.locator('#pe-site-progress').get_attribute('aria-valuenow'))
                    self.assertIn('0 / ', page.locator('#pe-site-count').inner_text())
                    self.assertEqual(page.locator('#value').count(), 0, 'Original page must remain inert')
                    download_gate.set()
                    page.wait_for_function("Number(document.getElementById('pe-site-progress')?.getAttribute('aria-valuenow'))>0")
                    progress_value = int(page.locator('#pe-site-progress').get_attribute('aria-valuenow'))
                    self.assertGreater(progress_value, 0)
                    self.assertLess(progress_value, 100)
                    page.screenshot(path=str(evidence / 'desktop.png'))
                    page.set_viewport_size({'width': 390, 'height': 844})
                    page.emulate_media(reduced_motion='reduce')
                    self.assertEqual(page.evaluate("getComputedStyle(document.getElementById('pe-site-progress-fill')).animationName"), 'none')
                    self.assertTrue(page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
                    page.screenshot(path=str(evidence / 'mobile.png'))
                    page.set_viewport_size({'width': 320, 'height': 568})
                    self.assertTrue(page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
                    remaining_gate.set()
                    page.wait_for_function('window.result?.value===41', timeout=45000)
                    snapshot = page.evaluate("""async () => {
                        const worker=navigator.serviceWorker.controller;
                        const channel=new MessageChannel();
                        const result=new Promise(resolve=>channel.port1.onmessage=e=>{channel.port1.close();resolve(e.data);});
                        worker.postMessage({type:'PE_SITE_ARCHIVE_VERSION'}, [channel.port2]);
                        return await result;
                    }""")
                    self.assertEqual(snapshot['progress']['phase'], 'ready')
                    self.assertEqual(snapshot['progress']['completedFiles'], snapshot['progress']['totalFiles'])
                    self.assertGreater(snapshot['progress']['totalFiles'], 30)
                    self.assertEqual(page.evaluate('window.domReadyCount'), 1)
                    page.reload()
                    page.wait_for_function('window.result?.value===41')
                    self.assertEqual(page.locator('#pe-site-preload').count(), 0)
                    context.close()

                    # The first frame needs neither external CSS nor JavaScript.
                    plain = browser.new_context(java_script_enabled=False)
                    plain_page = plain.new_page()
                    plain_page.goto(url)
                    self.assertEqual(plain_page.locator('#pe-site-heading').inner_text(), 'Preparing your realm')
                    self.assertTrue(plain_page.locator('noscript').is_visible())
                    plain.close()

                    blocked = browser.new_context(viewport={'width': 390, 'height': 844})
                    blocked.add_init_script("Object.defineProperty(navigator, 'serviceWorker', {value:undefined});")
                    failure = blocked.new_page()
                    failure.goto(url)
                    failure.locator('#pe-site-retry').wait_for(state='visible')
                    self.assertEqual(failure.locator('#pe-site-preload').get_attribute('data-state'), 'failed')
                    self.assertEqual(failure.locator('#pe-site-main').get_attribute('aria-busy'), 'false')
                    self.assertTrue(failure.evaluate('document.documentElement.scrollWidth<=innerWidth'))
                    failure.screenshot(path=str(evidence / 'failure.png'))
                    failure.get_by_role('button', name='Try again').click()
                    failure.locator('#pe-site-retry').wait_for(state='visible')
                    blocked.close()
                finally:
                    browser.close()
        finally:
            download_gate.set()
            remaining_gate.set()
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    def test_compact_tree_becomes_cloudflare_site_and_full_tree_is_preserved(self):
        original = {
            path.relative_to(self.source).as_posix(): path.read_bytes()
            for path in self.source.rglob("*")
            if path.is_file()
        }
        self.pack()
        compact = {
            path.relative_to(self.output).as_posix(): path.read_bytes()
            for path in self.output.rglob("*")
            if path.is_file()
        }
        diagnostic = self.directory / "site-full"

        cloudflare, preserved = promote_compact_release_site(
            self.source,
            self.output,
            diagnostic,
            max_files=20,
        )

        self.assertEqual(cloudflare, self.source)
        self.assertEqual(preserved, diagnostic)
        self.assertEqual(
            compact,
            {
                path.relative_to(self.source).as_posix(): path.read_bytes()
                for path in self.source.rglob("*")
                if path.is_file()
            },
        )
        self.assertEqual(
            original,
            {
                path.relative_to(diagnostic).as_posix(): path.read_bytes()
                for path in diagnostic.rglob("*")
                if path.is_file()
            },
        )

    @unittest.skipIf(sync_playwright is None, "Playwright required")
    def test_real_homepage_paints_after_archive_handoff_with_stalled_or_failed_decorations(self):
        self.write('index.html', (ROOT / 'tests/index.html').read_text('utf-8'))
        self.pack()
        gate = threading.Event()
        held = set()
        mode = {'paths': set(), 'fail': False}

        class DecorationHandler(Handler):
            def translate_path(self, path):
                local = super().translate_path(path)
                if Path(local).exists():
                    return local
                # Serve actual source dependencies behind the compact test page.
                # Only the homepage document goes through the archive handoff.
                name = unquote(urlsplit(path).path).lstrip('/')
                base = ROOT / 'tests' if name.startswith('assets/') else ROOT
                candidate = (base / name).resolve()
                return str(candidate) if candidate.is_relative_to(base) else local

            def do_GET(self):
                path = urlsplit(self.path).path
                if path in mode['paths']:
                    held.add(path)
                    if mode['fail']:
                        self.send_error(503, 'Injected decorative asset failure')
                        return
                    gate.wait(timeout=30)
                super().do_GET()

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0),
                    functools.partial(DecorationHandler, directory=str(self.output)))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        css = '/webgpu-os/BrandMark.css'
        decorations = {css, '/plauna/motion/MPAFallback.js',
                       '/plauna/motion/PageTransitionManager.js', '/webgpu-os/BrandMarkSurface.js'}
        evidence = ROOT / 'tmp/site-preload-validation'
        evidence.mkdir(parents=True, exist_ok=True)
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(executable_path=str(_find_browser()), headless=True)
                try:
                    for name, paths, fail in [('slow-brand', {css}, False),
                                              ('slow-decorations', decorations, False),
                                              ('failed-decorations', decorations, True)]:
                        with self.subTest(name=name):
                            gate.clear()
                            held.clear()
                            mode.update(paths=paths, fail=fail)
                            context = browser.new_context(**pw.devices['Pixel 7'], reduced_motion='reduce')
                            page = context.new_page()
                            try:
                                page.goto(f'http://127.0.0.1:{server.server_port}/', wait_until='commit')
                                page.locator('h1[aria-label="Particle Realms"]').wait_for(timeout=20000)
                                page.wait_for_function("performance.getEntriesByName('first-contentful-paint').length > 0")
                                self.assertEqual(page.locator('#pe-site-preload').count(), 0)
                                self.assertTrue(paths.issubset(held), f'Fault injection missed requests: {paths - held}')
                                self.assertEqual(page.evaluate('getComputedStyle(document.documentElement).opacity'), '1')
                                self.assertTrue(page.locator('.hero-actions a').first.is_visible())
                                page.locator('#nav-toggle').click()
                                self.assertEqual(page.locator('#nav-toggle').get_attribute('aria-expanded'), 'true')
                                page.locator('#nav-toggle').click()
                                page.screenshot(path=str(evidence / f'mobile-{name}.png'), timeout=10000)
                                if not fail:
                                    gate.set()
                                    page.wait_for_load_state('domcontentloaded')
                                    page.wait_for_function("!!document.querySelector('[data-particle-realms-mark-styles]')?.sheet && !!document.querySelector('[data-particle-realms-mark-mounted]')")
                                    self.assertEqual(page.locator('link[rel="stylesheet"][data-particle-realms-mark-styles]').count(), 1)
                                    self.assertEqual(page.evaluate("getComputedStyle(document.querySelector('.particle-realms-mark')).display"), 'grid')
                            finally:
                                gate.set()
                                context.close()
                finally:
                    browser.close()
        finally:
            gate.set()
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    @unittest.skipIf(sync_playwright is None, "Playwright required")
    def test_legacy_fade_finishes_without_dom_ready_and_respects_reduced_motion(self):
        self.write('plauna/motion/MPAFallback.js', (ROOT / 'plauna/motion/MPAFallback.js').read_text('utf-8'))
        self.write('index.html', '''<!doctype html><html><head>
<script src="/plauna/motion/MPAFallback.js"></script>
<script type="module" src="/pending.js"></script></head><body><h1>Visible before modules</h1>
<script>window.domReady=false;document.addEventListener('DOMContentLoaded',()=>window.domReady=true);</script>
</body></html>''')
        self.write('pending.js', 'window.pendingModuleLoaded = true;')
        gate = threading.Event()

        class PendingModuleHandler(Handler):
            def do_GET(self):
                if self.path == '/pending.js':
                    gate.wait(timeout=30)
                super().do_GET()

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0),
                    functools.partial(PendingModuleHandler, directory=str(self.source)))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(executable_path=str(_find_browser()), headless=True)
                try:
                    for reduced in ['no-preference', 'reduce']:
                        with self.subTest(reduced_motion=reduced):
                            gate.clear()
                            context = browser.new_context(reduced_motion=reduced)
                            # Emulate only the absence of CSS MPA transition support.
                            context.add_init_script("""const descriptor=Object.getOwnPropertyDescriptor(HTMLStyleElement.prototype,'sheet');
                                Object.defineProperty(HTMLStyleElement.prototype,'sheet',{get(){
                                    return this.textContent.includes('@view-transition') ? null : descriptor.get.call(this);
                                }});""")
                            page = context.new_page()
                            try:
                                page.goto(f'http://127.0.0.1:{server.server_port}/', wait_until='commit')
                                page.locator('h1').wait_for()
                                page.wait_for_function("document.readyState === 'interactive'")
                                if reduced == 'no-preference':
                                    self.assertTrue(page.evaluate("document.documentElement.classList.contains('js-pt-fallback-reveal')"))
                                page.wait_for_function("getComputedStyle(document.documentElement).opacity === '1'")
                                self.assertFalse(page.evaluate('window.domReady'))
                                self.assertFalse(page.evaluate('!!window.pendingModuleLoaded'))
                                self.assertTrue(page.locator('h1').is_visible())
                                if reduced == 'reduce':
                                    self.assertEqual(page.evaluate('getComputedStyle(document.documentElement).animationName'), 'none')
                                gate.set()
                                page.wait_for_load_state('domcontentloaded')
                                self.assertTrue(page.evaluate('window.pendingModuleLoaded'))
                            finally:
                                gate.set()
                                context.close()
                finally:
                    browser.close()
        finally:
            gate.set()
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    @unittest.skipIf(sync_playwright is None, "Playwright required")
    def test_cold_deep_link_modules_workers_headers_ranges_cache_and_upgrade(self):
        self.pack()
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(self.output)))
        server.request_queue_size = 256
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(executable_path=str(_find_browser()), headless=True)
                try:
                    context = browser.new_context()
                    page = context.new_page()
                    page.set_default_timeout(45000)
                    errors = []
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    url = f"http://127.0.0.1:{server.server_port}/playground/?cold=1#anchor"
                    page.goto(url)
                    page.wait_for_function("window.result?.value===41")
                    self.assertEqual(page.locator("#value").inner_text(), "42")
                    self.assertEqual(page.evaluate("window.result.workerValue"), 41)
                    self.assertTrue(page.evaluate("window.result.isolated"))
                    self.assertEqual(page.evaluate("window.domReadyCount"), 1)
                    self.assertEqual(page.evaluate("getComputedStyle(document.getElementById('value')).color"), "rgb(1, 2, 3)")
                    self.assertEqual(page.url, url)
                    self.assertIn("/playground/src/main.js", page.evaluate("window.result.url"))
                    result = page.evaluate("""async () => {
                        const head=await fetch('/vendor/range.txt', {method:'HEAD'});
                        const range=await fetch('/vendor/range.txt?version=1', {headers:{Range:'bytes=2-5'}});
                        const invalid=await fetch('/vendor/range.txt', {headers:{Range:'bytes=99-100'}});
                        return {head:head.status,headBytes:head.headers.get('Content-Length'),
                            headBody:await head.text(),range:range.status,text:await range.text(),
                            isolation:range.headers.get('Cross-Origin-Embedder-Policy'),invalid:invalid.status};
                    }""")
                    self.assertEqual(result, {"head": 200, "headBytes": "10", "headBody": "",
                                              "range": 206, "text": "2345", "isolation": "require-corp", "invalid": 416})
                    context.set_offline(True)
                    self.assertEqual(page.evaluate("async () => (await (await fetch('/plauna/data.json?offline=1')).json()).offset"), 1)
                    context.set_offline(False)
                    self.write("playground/src/dependency.js", "export const value=43;\n")
                    self.pack()
                    # Navigating the identical URL with a fragment can remain
                    # same-document; an upgrade requires a real document load.
                    page.reload()
                    page.wait_for_function("window.result?.value===43")
                    self.assertEqual(page.locator("#value").inner_text(), "44")
                    self.assertEqual(page.evaluate("window.result.workerValue"), 43)
                    self.assertEqual(errors, [])
                finally:
                    browser.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
