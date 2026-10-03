# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Installed guest entry preserves lifecycle and immutable release-relative URLs."""
import hashlib
import tempfile
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin

from bundler.site import (
    _WEBGPU_OS_APP_BOOT_TAG,
    _WEBGPU_OS_APP_LOADER_TEMPLATE_ID,
    _release_runtime_loader_tag,
    _write_webgpu_os_compiled_guest_entry,
)
from bundler.system_release import collect_staged_release

ROOT = Path(__file__).resolve().parents[2]


class Tags(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.scripts = []
        self.root = {}
        self.feed(html)

    def handle_starttag(self, tag, attributes):
        if tag == 'html':
            self.root = dict(attributes)
        elif tag == 'script':
            self.scripts.append(dict(attributes))


class TestCompiledGuestEntry(unittest.TestCase):
    def render(self, root, platform=False):
        path = root / 'webgpu-os/runtime.html'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes((ROOT / 'webgpu-os/runtime.html').read_bytes())
        prefix, name = ('../assets/', 'particle-platform') if platform else ('./assets/', 'particle-os')
        tag = _release_runtime_loader_tag('./assets/release-runtime-loader.js', prefix + name + '.min.js.gz',
            prefix, 'sha384-' + 'A' * 64, 1000, 200, 'fixture', os_base='./', executor_source_hash='sha256:' + 'b' * 64)
        self.assertEqual(_write_webgpu_os_compiled_guest_entry(path, tag), 1)
        return path, Tags(path.read_text(encoding='utf-8'))

    def test_standalone_guest_marks_one_classic_loader_before_existing_module_endpoint(self):
        with tempfile.TemporaryDirectory() as temporary:
            path, tags = self.render(Path(temporary))
            self.assertEqual(tags.root['data-particle-compiled-runtime-entry'], 'verified-v1')
            loaders = [tag for tag in tags.scripts if tag.get('id') == 'particle-compiled-runtime-entry-loader']
            self.assertEqual(len(loaders), 1)
            loader = loaders[0]
            self.assertNotIn('type', loader)
            self.assertNotIn('async', loader)
            self.assertNotIn('defer', loader)
            self.assertEqual(loader['data-integrity'], 'sha384-' + 'A' * 64)
            self.assertEqual(loader['data-runtime-bytes'], '1000')
            self.assertEqual(loader['data-runtime-compressed-bytes'], '200')
            boot = {'type': 'module', 'src': 'boot.js'}
            self.assertEqual(tags.scripts[-1], boot)
            self.assertEqual(tags.scripts[-2], loader)
            self.assertNotIn('release-boot.js', path.read_text())
            self.assertNotIn('bootstrap/boot.js', path.read_text())
            self.assertIn({'src': '/webgpu-os/boot-theme.js'}, tags.scripts)
            self.assertNotIn({'src': 'boot-theme.js'}, tags.scripts)

    def test_standalone_and_platform_bases_remain_inside_the_exact_release_mount(self):
        release_root = 'https://example.test/webgpu-os/__particle__/release/' + 'a' * 64 + '/'
        document = release_root + 'webgpu-os/index.html'
        for platform in (False, True):
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as temporary:
                _, tags = self.render(Path(temporary), platform=platform)
                loader = tags.scripts[-2]
                self.assertEqual(urljoin(document, loader['data-runtime-base']), release_root)
                self.assertEqual(urljoin(document, loader['data-os-base']), release_root + 'webgpu-os/')
                assets = release_root + ('assets/' if platform else 'webgpu-os/assets/')
                self.assertEqual(urljoin(document, loader['data-asset-base']), assets)
                self.assertTrue(urljoin(document, loader['data-runtime-src']).startswith(assets))
                self.assertTrue(urljoin(document, loader['src']).startswith(release_root + 'webgpu-os/assets/'))
                self.assertEqual(urljoin(assets, 'official-packages/' + 'c' * 64 + '.prpkg'),
                                 assets + 'official-packages/' + 'c' * 64 + '.prpkg')

    def test_missing_or_ambiguous_guest_boot_fails_packaging(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'runtime.html'
            with self.assertRaises(FileNotFoundError):
                _write_webgpu_os_compiled_guest_entry(path, '<script data-runtime-src="x"></script>')
            for html in ('<html></html>', '<html>' + '<script type="module" src="boot.js"></script>' * 2 + '</html>'):
                path.write_text(html)
                with self.assertRaises(ValueError):
                    _write_webgpu_os_compiled_guest_entry(path, '<script data-runtime-src="x"></script>')

    def test_generated_entry_is_the_installed_alias_and_sidecars_have_signed_inventory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path, _ = self.render(root)
            content = b'opaque signed package fixture'
            digest = hashlib.sha256(content).hexdigest()
            sidecar = root / ('webgpu-os/assets/official-packages/' + digest + '.prpkg')
            sidecar.parent.mkdir(parents=True)
            sidecar.write_bytes(content)
            files, _ = collect_staged_release(root)
            entry = next(item for item in files if item.logical_path == 'webgpu-os/index.html')
            self.assertEqual(entry.object_hash, 'sha256:' + hashlib.sha256(path.read_bytes()).hexdigest())
            item = next(item for item in files if item.logical_path.endswith('.prpkg'))
            self.assertEqual(item.object_hash, 'sha256:' + digest)
            self.assertEqual(item.byte_length, len(content))
            self.assertEqual(item.mime, 'application/octet-stream')

    def test_source_entry_remains_unconfigured_for_plain_es_module_development(self):
        source = (ROOT / 'webgpu-os/runtime.html').read_text(encoding='utf-8')
        self.assertNotIn('data-particle-compiled-runtime-entry', source)
        self.assertNotIn('particle-compiled-runtime-entry-loader', source)
        self.assertIn('<script type="module" src="boot.js"></script>', source)
        self.assertIn('<script src="boot-theme.js"></script>', source)

    def test_app_launcher_uses_the_shared_runtime_and_its_own_boot_script(self):
        source = ('<html><head></head><body>'
                  + _WEBGPU_OS_APP_BOOT_TAG + '</body></html>')
        for platform in (False, True):
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as temporary:
                path = Path(temporary) / 'webgpu-os/app.html'
                path.parent.mkdir()
                path.write_text(source, encoding='utf-8')
                prefix, name = ('../assets/', 'particle-platform') if platform else ('./assets/', 'particle-os')
                tag = _release_runtime_loader_tag('./assets/release-runtime-loader.js', prefix + name + '.min.js.gz',
                    prefix, 'sha384-' + 'A' * 64, 1000, 200, 'fixture', os_base='./')
                self.assertEqual(_write_webgpu_os_compiled_guest_entry(path, tag,
                    boot_tag=_WEBGPU_OS_APP_BOOT_TAG, stable_theme=False,
                    loader_template_id=_WEBGPU_OS_APP_LOADER_TEMPLATE_ID), 1)
                html = path.read_text(encoding='utf-8')
                tags = Tags(html)
                loader = tags.scripts[-2]
                self.assertEqual(tags.root['data-particle-compiled-runtime-entry'], 'verified-v1')
                self.assertEqual(tags.scripts[-1], {'type': 'module', 'src': 'app-boot.js'})
                self.assertEqual(len(tags.scripts), 2)
                template_start = html.index('<template id="particle-app-runtime-loader">')
                template_end = html.index('</template>', template_start)
                self.assertLess(template_start, html.index('data-runtime-src='))
                self.assertLess(html.index('data-runtime-src='), template_end)
                self.assertLess(template_end, html.index(_WEBGPU_OS_APP_BOOT_TAG))
                self.assertNotIn('boot-theme.js', html)
                self.assertEqual(loader['data-runtime-src'].split('?')[0], prefix + name + '.min.js.gz')
                document = 'https://example.test/demo/webgpu-os/app.html?app=os.calculator'
                self.assertEqual(urljoin(document, loader['data-os-base']), 'https://example.test/demo/webgpu-os/')
                self.assertEqual(urljoin(document, loader['data-runtime-base']), 'https://example.test/demo/')
                self.assertEqual(loader['data-runtime-bytes'], '1000')
                self.assertEqual(loader['data-runtime-compressed-bytes'], '200')
                self.assertNotIn({'type': 'module', 'src': 'boot.js'}, tags.scripts)
                self.assertNotIn({'type': 'module', 'src': 'bootstrap/boot.js'}, tags.scripts)

    def test_app_launcher_rejects_missing_repeated_or_already_configured_boot(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'app.html'
            for html in ('<html></html>', '<html>' + _WEBGPU_OS_APP_BOOT_TAG * 2 + '</html>',
                         '<html data-particle-compiled-runtime-entry="verified-v1">' + _WEBGPU_OS_APP_BOOT_TAG + '</html>'):
                path.write_text(html, encoding='utf-8')
                with self.assertRaises(ValueError):
                    _write_webgpu_os_compiled_guest_entry(path, '<script data-runtime-src="x"></script>',
                        boot_tag=_WEBGPU_OS_APP_BOOT_TAG, stable_theme=False)
                self.assertEqual(path.read_text(encoding='utf-8'), html)


if __name__ == '__main__':
    unittest.main()
