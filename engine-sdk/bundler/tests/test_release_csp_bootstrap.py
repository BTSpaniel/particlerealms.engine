# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import base64
import gzip
import json
import hashlib
import tempfile
import unittest
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from unittest import mock
from urllib.parse import urlsplit

from bundler.site import (
    WEBGPU_OS_REQUIRED_DEPLOYMENT_PATHS,
    _release_runtime_cache_token,
    _verify_release_runtime_gzip,
    _write_release_runtime_loader,
    _write_webgpu_os_bundle_index,
    copy_release_site,
    create_release_site_archive,
    sync_release_runtime_consumer,
)


ROOT = Path(__file__).resolve().parents[2]
RUNTIME_SOURCE = b"globalThis.PE = {};\n"
RUNTIME_INTEGRITY = "sha384-" + base64.b64encode(
    hashlib.sha384(RUNTIME_SOURCE).digest()
).decode("ascii")


class _ScriptCollector(HTMLParser):
    """Collect script attributes and bodies without executing the document."""

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.scripts = []
        self._active_script = None

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "script":
            return
        record = {
            "attributes": {name.lower(): value or "" for name, value in attrs},
            "body": [],
        }
        self.scripts.append(record)
        self._active_script = record

    def handle_data(self, data):
        if self._active_script is not None:
            self._active_script["body"].append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "script":
            self._active_script = None


def _collect_scripts(html):
    parser = _ScriptCollector()
    parser.feed(html)
    parser.close()
    return parser.scripts


def _is_executable_script(record):
    script_type = record["attributes"].get("type", "").lower()
    return script_type in {
        "",
        "module",
        "text/javascript",
        "application/javascript",
    }


class TestReleaseCspBootstrap(unittest.TestCase):
    def test_compressed_runtime_is_verified_after_decode(self):
        with tempfile.TemporaryDirectory() as temporary:
            runtime = Path(temporary) / "runtime.min.js.gz"
            runtime.write_bytes(gzip.compress(RUNTIME_SOURCE, compresslevel=9))
            self.assertEqual(
                _verify_release_runtime_gzip(
                    runtime,
                    RUNTIME_INTEGRITY,
                    len(RUNTIME_SOURCE),
                ),
                len(RUNTIME_SOURCE),
            )
            with self.assertRaisesRegex(ValueError, "SHA-384 mismatch"):
                _verify_release_runtime_gzip(
                    runtime,
                    "sha384-" + "A" * 64,
                    len(RUNTIME_SOURCE),
                )
            with self.assertRaisesRegex(ValueError, "expands beyond"):
                _verify_release_runtime_gzip(
                    runtime,
                    RUNTIME_INTEGRITY,
                    len(RUNTIME_SOURCE) - 1,
                )

    def test_runtime_cache_identity_changes_with_exact_gzip_bytes(self):
        with tempfile.TemporaryDirectory() as temporary, mock.patch(
            "bundler.site.time.time", return_value=1234567890
        ):
            first = Path(temporary) / "first.gz"
            second = Path(temporary) / "second.gz"
            first.write_bytes(b"first-runtime")
            second.write_bytes(b"second-runtime")
            first_token = _release_runtime_cache_token(first)
            second_token = _release_runtime_cache_token(second)
            self.assertRegex(first_token, r"^[0-9a-f]{16}$")
            self.assertRegex(second_token, r"^[0-9a-f]{16}$")
            self.assertNotEqual(first_token, second_token)

    def _assert_relative_same_origin(self, value):
        parsed = urlsplit(value)
        self.assertFalse(parsed.scheme, value)
        self.assertFalse(parsed.netloc, value)
        self.assertTrue(parsed.path, value)
        self.assertFalse(value.startswith(("//", "\\")), value)

    def _assert_external_boot_contract(
        self,
        html,
        *,
        loader_path,
        runtime_path,
        integrity=RUNTIME_INTEGRITY,
    ):
        scripts = _collect_scripts(html)
        executable_inline = [
            record
            for record in scripts
            if _is_executable_script(record)
            and not record["attributes"].get("src")
            and "".join(record["body"]).strip()
        ]
        self.assertEqual(executable_inline, [])

        loader_scripts = [
            record
            for record in scripts
            if record["attributes"].get("data-runtime-src")
        ]
        self.assertEqual(len(loader_scripts), 1)
        loader = loader_scripts[0]["attributes"]
        self.assertTrue(loader["src"].startswith(loader_path + "?v="), loader)
        self.assertTrue(
            loader["data-runtime-src"].startswith(runtime_path + "?v="),
            loader,
        )
        self.assertEqual(loader["data-integrity"], integrity)
        self.assertEqual(loader["data-runtime-bytes"], str(len(RUNTIME_SOURCE)))
        self.assertGreater(int(loader["data-runtime-compressed-bytes"]), 0)
        self.assertEqual(loader["data-runtime-base"], "../")
        self._assert_relative_same_origin(loader["src"])
        self._assert_relative_same_origin(loader["data-runtime-src"])

        for record in scripts:
            if not _is_executable_script(record):
                continue
            source = record["attributes"].get("src")
            self.assertTrue(source, record)
            self._assert_relative_same_origin(source)

    def test_authored_playground_and_editor_entries_are_csp_safe(self):
        for relative_path in ("tests/playground/index.html", "editor/index.html"):
            html = (ROOT / relative_path).read_text(encoding="utf-8")
            scripts = _collect_scripts(html)
            executable_inline = [
                record
                for record in scripts
                if _is_executable_script(record)
                and not record["attributes"].get("src")
                and "".join(record["body"]).strip()
            ]
            self.assertEqual(executable_inline, [], relative_path)
            for record in scripts:
                if _is_executable_script(record):
                    self._assert_relative_same_origin(record["attributes"]["src"])

        editor_html = (ROOT / "editor" / "index.html").read_text(encoding="utf-8")
        self.assertIn('<script src="js/loader-guard.js"></script>', editor_html)
        guard = (ROOT / "editor" / "js" / "loader-guard.js").read_text(
            encoding="utf-8"
        )
        self.assertIn("SPDX-License-Identifier", guard)
        self.assertIn("document.addEventListener('contextmenu'", guard)

    def test_host_csp_allows_only_the_exact_cloudflare_beacon_origin(self):
        headers = (ROOT / "webgpu-os" / "_headers").read_text(encoding="utf-8")
        policies = [
            line.strip()
            for line in headers.splitlines()
            if "Content-Security-Policy" in line and "script-src" in line
            and "default-src 'self'" in line
        ]
        self.assertGreaterEqual(len(policies), 2)
        for policy in policies:
            script_sources = policy.split("script-src", 1)[1].split(";", 1)[0]
            self.assertIn("https://static.cloudflareinsights.com", script_sources)
            self.assertNotIn("https:", script_sources.replace(
                "https://static.cloudflareinsights.com", ""
            ))
            self.assertNotIn("'unsafe-inline'", script_sources)
            self.assertNotIn("'unsafe-eval'", script_sources)
        worker_policy = headers.split("/engine/core/compute/ComputeWorker.js", 1)[1].splitlines()[1]
        worker_sources = worker_policy.split("script-src", 1)[1].split(";", 1)[0].split()
        self.assertEqual(worker_sources, ["'self'", "'wasm-unsafe-eval'"])

    def _write_minimal_release_fixture(self, temporary):
        root = Path(temporary) / "root"
        release = Path(temporary) / "release"
        playground = root / "tests" / "playground"
        playground_source = playground / "src"
        playground_source.mkdir(parents=True)
        (playground / "index.html").write_text(
            '<!doctype html><body><script type="module" '
            'src="./src/main.js"></script></body>',
            encoding="utf-8",
        )
        (playground_source / "main.js").write_text("export {};\n", encoding="utf-8")
        (playground / "index.legacy.html").write_text(
            "<script>const raw = 'particle-platform.min.js';</script>\n",
            encoding="utf-8",
        )

        academy = root / "tests" / "learn"
        academy_source = academy / "src"
        academy_source.mkdir(parents=True)
        (academy / "index.html").write_text(
            '<!doctype html><body><script type="module" '
            'src="./src/main.js?v=authored"></script></body>',
            encoding="utf-8",
        )
        (academy_source / "main.js").write_text("export {};\n", encoding="utf-8")
        academy_starter = academy / "starter"
        academy_starter.mkdir()
        (academy_starter / "index.html").write_text(
            '<!doctype html><body><script type="module" '
            'src="./main.js"></script></body>',
            encoding="utf-8",
        )
        (academy_starter / "main.js").write_text("export {};\n", encoding="utf-8")

        editor = root / "editor"
        (editor / "js").mkdir(parents=True)
        (editor / "index.html").write_text(
            '<!doctype html><body><script src="js/loader-guard.js"></script>'
            '<script type="module" src="js/main.js"></script></body>',
            encoding="utf-8",
        )
        guard_source = "document.documentElement.dataset.loaderGuard = 'ready';\n"
        (editor / "js" / "loader-guard.js").write_text(
            guard_source,
            encoding="utf-8",
        )

        assets = root / "tests" / "assets"
        assets.mkdir(parents=True)
        for suffix, data in (
            (".min.js", RUNTIME_SOURCE),
            (".min.js.br", b"brotli"),
            (".min.js.gz", gzip.compress(RUNTIME_SOURCE, compresslevel=9)),
        ):
            (assets / f"particle-platform{suffix}").write_bytes(data)
        (assets / "particle-platform.min.js.sri").write_text(
            RUNTIME_INTEGRITY + "\n",
            encoding="ascii",
        )
        (assets / "particle-platform.manifest.json").write_text(
            '{"name":"particle-platform"}\n',
            encoding="utf-8",
        )
        return root, release, guard_source

    def test_release_generator_externalizes_playground_and_editor_bootstrap(self):
        self._assert_release_generation_uses_verified_transport(split=False)

    def test_release_generator_ships_parts_to_every_shared_runtime_page(self):
        self._assert_release_generation_uses_verified_transport(split=True)

    def _assert_release_generation_uses_verified_transport(self, split):
        from bundler.runtime_transport import plan_compressed_artifact_parts

        with tempfile.TemporaryDirectory() as temporary:
            root, release, guard_source = self._write_minimal_release_fixture(temporary)
            source_assets = root / "tests" / "assets"
            runtime_payload = (source_assets / "particle-platform.min.js.gz").read_bytes()
            runtime_parts = None
            if split:
                runtime_parts, files = plan_compressed_artifact_parts(
                    "particle-platform.min.js.gz", runtime_payload, max_file_bytes=32, part_bytes=32,
                )
                for name, payload in files.items():
                    (source_assets / name).write_bytes(payload)
                manifest_path = source_assets / "particle-platform.manifest.json"
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                manifest["compressed_artifact_parts"] = {"particle-platform.min.js.gz": runtime_parts}
                manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            patches = (
                mock.patch("bundler.site.RELEASE_INCLUDE", ("playground", "learn")),
                mock.patch(
                    "bundler.site._lay_down_academy_starter_engine_closure",
                    return_value=0,
                ),
                mock.patch("bundler.site._lay_down_md_docs", return_value=0),
                mock.patch("bundler.site.lay_down_morphfield_schemas", return_value=0),
                mock.patch("bundler.site.release_site_static_asset_paths", return_value=()),
                mock.patch(
                    "bundler.site.lay_down_release_site_sidecar_assets",
                    return_value=0,
                ),
                mock.patch("bundler.site._validate_playground_demo_manifest", return_value=1),
                mock.patch("bundler.site._validate_playground_module_graph", return_value=0),
                mock.patch("bundler.site._validate_academy_module_graph", return_value=0),
                mock.patch("bundler.site._validate_release_include_tree_parity", return_value=2),
            )
            with patches[0], patches[1], patches[2], patches[3], patches[4], \
                    patches[5], patches[6], patches[7], patches[8], patches[9]:
                copy_release_site(
                    root,
                    release,
                    bundle_name="particle-platform",
                    best_ext=".br",
                )

            site = release / "site"
            self.assertFalse((site / "playground" / "index.legacy.html").exists())
            playground_html = (site / "playground" / "index.html").read_text("utf-8")
            self.assertIn('data-os-base="../webgpu-os/"', playground_html)
            academy_html = (site / "learn" / "index.html").read_text("utf-8")
            editor_html = (site / "editor" / "index.html").read_text("utf-8")
            self._assert_external_boot_contract(
                playground_html,
                loader_path="../assets/release-runtime-loader.js",
                runtime_path="../assets/particle-platform.min.js.gz",
            )
            self._assert_external_boot_contract(
                academy_html,
                loader_path="../assets/release-runtime-loader.js",
                runtime_path="../assets/particle-platform.min.js.gz",
            )
            self._assert_external_boot_contract(
                editor_html,
                loader_path="../assets/release-runtime-loader.js",
                runtime_path="../assets/particle-platform.min.js.gz",
            )
            self.assertIn('src="./release-boot.js?v=', editor_html)
            self.assertEqual(
                (site / "editor" / "js" / "loader-guard.js").read_text("utf-8"),
                guard_source,
            )

            runtime_loader = (
                site / "assets" / "release-runtime-loader.js"
            ).read_text("utf-8")
            runtime_token = _release_runtime_cache_token(
                runtime_payload, runtime_parts,
            )
            for html in (playground_html, academy_html, editor_html):
                self.assertIn(f"?v={runtime_token}", html)
                self.assertEqual("data-runtime-parts=" in html, split)
            self.assertIn("fetch(responseUrl", runtime_loader)
            self.assertIn("new DecompressionStream('gzip')", runtime_loader)
            self.assertIn("crypto.subtle.digest('SHA-384', sourceBytes)", runtime_loader)
            self.assertIn("actualIntegrity !== integrity", runtime_loader)
            self.assertIn("__PE_RUNTIME_PROVENANCE__", runtime_loader)
            self.assertIn("deliveryMode: 'verified-release-bundle'", runtime_loader)
            self.assertIn("runtimeUrl: new URL(runtimeSource, document.baseURI).href", runtime_loader)
            self.assertIn("executorSourceHash", runtime_loader)
            self.assertIn("invalid executor source identity", runtime_loader)
            self.assertIn("decodedBytes !== runtimeBytes", runtime_loader)
            self.assertIn("payload.byteLength !== runtimeCompressedBytes", runtime_loader)
            self.assertIn("controller.abort()", runtime_loader)
            self.assertIn("fetchRuntimePayload('force-cache')", runtime_loader)
            self.assertIn("fetchRuntimePayload('reload')", runtime_loader)
            self.assertIn("after cache reload", runtime_loader)
            self.assertIn("URL.createObjectURL", runtime_loader)
            self.assertIn("URL.revokeObjectURL", runtime_loader)
            self.assertIn("api.__modules || api._M", runtime_loader)
            self.assertIn("api.requireModule || api.__require || api._require", runtime_loader)
            self.assertNotIn("textContent", runtime_loader)
            self.assertFalse((site / "assets" / "particle-platform.min.js").exists())
            self.assertEqual((site / "assets" / "particle-platform.min.js.gz").is_file(), not split)
            for record in runtime_parts or []:
                self.assertEqual((site / "assets" / record["src"]).read_bytes(), (source_assets / record["src"]).read_bytes())

    def test_platform_consumer_sync_updates_runtime_loader_identity_and_cache_token(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            release = root / "release"
            consumer = root / "Template"
            release.mkdir()
            consumer.mkdir()
            runtime = release / "particle-platform.min.js.gz"
            runtime.write_bytes(gzip.compress(RUNTIME_SOURCE, compresslevel=9))
            manifest = {
                "name": "particle-platform",
                "browser_runtime_integrity": RUNTIME_INTEGRITY,
                "browser_runtime_decoded_bytes": len(RUNTIME_SOURCE),
                "browser_runtime_bytes": runtime.stat().st_size,
            }
            (release / "particle-platform.manifest.json").write_text(
                '{"name":"particle-platform"}\n',
                encoding="utf-8",
            )
            (consumer / "index.html").write_text(
                '<!doctype html><script src="./assets/old-loader.js" '
                'data-runtime-src="./assets/old.js.gz" data-integrity="old" '
                'data-runtime-bytes="1">\n  data-os-base="./">\n</script>',
                encoding="utf-8",
            )

            receipt = sync_release_runtime_consumer(
                consumer,
                release,
                manifest,
                os_base="./",
            )

            html = (consumer / "index.html").read_text(encoding="utf-8")
            self.assertIn('src="./assets/release-runtime-loader.js?v=', html)
            self.assertIn('data-runtime-src="./assets/particle-platform.min.js.gz?v=', html)
            self.assertIn(f'data-integrity="{RUNTIME_INTEGRITY}"', html)
            self.assertIn(f'data-runtime-bytes="{len(RUNTIME_SOURCE)}"', html)
            self.assertIn(
                f'data-runtime-compressed-bytes="{runtime.stat().st_size}"',
                html,
            )
            self.assertIn('data-os-base="./"', html)
            self.assertNotIn('data-os-base="./">\n</script>', html)
            self.assertEqual(receipt["decoded_bytes"], len(RUNTIME_SOURCE))
            self.assertEqual(
                gzip.decompress(
                    (consumer / "assets" / "particle-platform.min.js.gz").read_bytes()
                ),
                RUNTIME_SOURCE,
            )
            loader = (
                consumer / "assets" / "release-runtime-loader.js"
            ).read_text(encoding="utf-8")
            self.assertIn("hasRuntimeRegistry", loader)
            runtime_digest = hashlib.sha256(runtime.read_bytes()).hexdigest()
            expected_token = hashlib.sha256(
                runtime_digest.encode("ascii")
                + b"\0"
                + loader.encode("utf-8")
            ).hexdigest()[:16]
            self.assertEqual(receipt["cache_token"], expected_token)
            self.assertIn(f"?v={expected_token}", html)

    def test_managed_template_bootstrap_is_externalized_and_namespace_aware(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            release = root / "release"
            consumer = root / "Template"
            release.mkdir()
            consumer.mkdir()
            runtime = release / "particle-platform.min.js.gz"
            runtime.write_bytes(gzip.compress(RUNTIME_SOURCE, compresslevel=9))
            manifest = {
                "name": "particle-platform",
                "browser_runtime_integrity": RUNTIME_INTEGRITY,
                "browser_runtime_decoded_bytes": len(RUNTIME_SOURCE),
                "browser_runtime_bytes": runtime.stat().st_size,
            }
            (release / "particle-platform.manifest.json").write_text(
                '{"name":"particle-platform"}\n', encoding="utf-8"
            )
            (consumer / "index.html").write_text(
                '<!doctype html><script src="./assets/old-loader.js" '
                'data-runtime-src="./assets/old.js.gz" data-integrity="old" '
                'data-runtime-bytes="1"></script>'
                '<!-- Boot logic: wait for bundle, show selector, dispatch to chosen mode -->'
                '<script>(() => { window.legacyBoot = true; })();</script>',
                encoding="utf-8",
            )

            receipt = sync_release_runtime_consumer(
                consumer,
                release,
                manifest,
                os_base="./",
                update_bootstrap=True,
            )

            html = (consumer / "index.html").read_text(encoding="utf-8")
            bootstrap = (consumer / "assets" / "release-consumer-bootstrap.js").read_text(
                encoding="utf-8"
            )
            self.assertTrue(receipt["bootstrap_updated"])
            self.assertNotIn("legacyBoot", html)
            self.assertIn("release-consumer-bootstrap.js?v=", html)
            self.assertIn("api.WebGPUOS || api", bootstrap)
            self.assertIn("api.Plauna || api", bootstrap)

    def test_release_site_zip_is_byte_reproducible_across_source_mtimes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            site = root / "site"
            site.mkdir()
            first = site / "index.html"
            second = site / "assets" / "runtime.js"
            second.parent.mkdir()
            first.write_text("release\n", encoding="utf-8")
            second.write_text("globalThis.ready = true;\n", encoding="utf-8")
            archive_a = root / "a.zip"
            archive_b = root / "b.zip"

            with mock.patch.dict("os.environ", {"SOURCE_DATE_EPOCH": "1700000000"}):
                create_release_site_archive(site, archive_a)
                first.touch()
                second.touch()
                create_release_site_archive(site, archive_b)

            self.assertEqual(archive_a.read_bytes(), archive_b.read_bytes())
            with zipfile.ZipFile(archive_a, "r") as archive:
                timestamps = {info.date_time for info in archive.infolist()}
            self.assertEqual(timestamps, {(2023, 11, 14, 22, 13, 20)})

    def test_webgpu_os_bundle_page_uses_the_same_external_sri_contract(self):
        with tempfile.TemporaryDirectory() as temporary:
            webgpu_os = Path(temporary) / "webgpu-os"
            webgpu_os.mkdir()
            index = webgpu_os / "index.html"
            index.write_text(
                '<!doctype html><body><script type="module" '
                'src="bootstrap/boot.js"></script></body>',
                encoding="utf-8",
            )
            _write_release_runtime_loader(
                webgpu_os / "assets" / "release-runtime-loader.js"
            )
            runtime_gzip = gzip.compress(RUNTIME_SOURCE, mtime=0)
            (webgpu_os / "assets" / "particle-os.min.js.gz").write_bytes(runtime_gzip)
            (webgpu_os / "runtime.html").write_text((ROOT / "webgpu-os/runtime.html").read_text(encoding="utf-8"), encoding="utf-8")
            (webgpu_os / "app.html").write_text((ROOT / "webgpu-os/app.html").read_text(encoding="utf-8"), encoding="utf-8")

            _write_webgpu_os_bundle_index(
                index,
                RUNTIME_INTEGRITY,
                len(RUNTIME_SOURCE),
                len(runtime_gzip),
                "sha256:" + "a" * 64,
            )

            html = index.read_text("utf-8")
            self._assert_external_boot_contract(
                html,
                loader_path="./assets/release-runtime-loader.js",
                runtime_path="./assets/particle-os.min.js.gz",
            )
            self.assertIn('src="./release-boot.js?v=', html)
            self.assertIn("data-os-base=\"./\"", html)
            self.assertIn('data-executor-source-hash="sha256:' + 'a' * 64 + '"', html)
            self.assertNotIn('src="boot.js"', html)
            self.assertIn('src="bootstrap/boot.js"', html)
            app_html = (webgpu_os / "app.html").read_text(encoding="utf-8")
            self._assert_external_boot_contract(
                app_html,
                loader_path="./assets/release-runtime-loader.js",
                runtime_path="./assets/particle-os.min.js.gz",
            )
            self.assertIn('src="app-boot.js"', app_html)
            self.assertNotIn('src="bootstrap/boot.js"', app_html)
            self.assertLess(
                html.index('src="./release-boot.js?v='),
                html.index('src="bootstrap/boot.js"'),
            )

    def test_archive_contract_requires_and_contains_editor_guard(self):
        self.assertIn("release-boot.js", WEBGPU_OS_REQUIRED_DEPLOYMENT_PATHS)
        self.assertIn(
            "assets/release-runtime-loader.js",
            WEBGPU_OS_REQUIRED_DEPLOYMENT_PATHS,
        )
        cli_source = (ROOT / "bundler" / "cli.py").read_text(encoding="utf-8")
        required_paths = (
            '"assets/release-runtime-loader.js"',
            '"editor/release-boot.js"',
            '"editor/js/loader-guard.js"',
        )
        archive_call = cli_source.index("create_release_site_archive(")
        for required_path in required_paths:
            path_offset = cli_source.index(required_path)
            self.assertLess(path_offset, archive_call, required_path)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            site = root / "site"
            guard = site / "editor" / "js" / "loader-guard.js"
            guard.parent.mkdir(parents=True)
            (site / "index.html").write_text("release", encoding="utf-8")
            required = ("index.html", "editor/js/loader-guard.js")
            archive_path = root / "site.zip"

            with self.assertRaisesRegex(FileNotFoundError, "loader-guard.js"):
                create_release_site_archive(site, archive_path, required_paths=required)

            guard.write_text("external guard\n", encoding="utf-8")
            guard_bytes = guard.read_bytes()
            create_release_site_archive(site, archive_path, required_paths=required)
            with zipfile.ZipFile(archive_path, "r") as archive:
                self.assertEqual(
                    archive.read("editor/js/loader-guard.js"),
                    guard_bytes,
                )


if __name__ == "__main__":
    unittest.main()
