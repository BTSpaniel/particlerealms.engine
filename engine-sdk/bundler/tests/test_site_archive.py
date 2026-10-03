# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import json
import hashlib
import shutil
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

from bundler.compute_contracts import compute_contract_asset_paths
from bundler.site import (
    CLOUDFLARE_PAGES_FREE_MAX_FILES,
    CLOUDFLARE_PAGES_MAX_FILE_BYTES,
    RELEASE_INCLUDE,
    RELEASE_SITE_ENGINE_ASSET_SOURCES,
    WEBGPU_OS_RUNTIME_ASSET_PATHS,
    _cache_bust_html_module_entry,
    _cache_bust_js_dir,
    _lay_down_academy_starter_engine_closure,
    _lay_down_md_docs,
    _publish_staged_site,
    _validate_academy_module_graph,
    _validate_release_include_tree_parity,
    _validate_release_module_graph,
    _validate_static_site_file_cap,
    _verify_compute_sidecars,
    create_release_site_archive,
    lay_down_release_site_sidecar_assets,
    lay_down_release_site_static_modules,
    release_site_sidecar_asset_manifest,
)
from start_server import _release_site_transition_path


ROOT = Path(__file__).resolve().parents[2]


class TestReleaseSiteArchive(unittest.TestCase):
    def test_cache_busting_preserves_attested_physics_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            engine = Path(temp) / "engine"
            physics = engine / "sim/physics"
            physics.mkdir(parents=True)
            pinned = physics / "bridge.mjs"
            payload = b"import './runtime.mjs';\n"
            pinned.write_bytes(payload)
            consumer = engine / "consumer.js"
            consumer.write_text("import './sim/physics/bridge.mjs';\n", encoding="utf-8")
            _cache_bust_js_dir(engine, "test", immutable_paths=(pinned,))
            self.assertEqual(pinned.read_bytes(), payload)
            self.assertIn("bridge.mjs?v=test", consumer.read_text(encoding="utf-8"))

    def test_compute_consumer_inventory_includes_offline_contracts(self):
        from bundler.wasm import compute_release_asset_paths
        paths = set(compute_release_asset_paths(ROOT)) | set(compute_contract_asset_paths(ROOT))
        records = [{'path': path, 'byteLength': (ROOT / path).stat().st_size,
                    'sha256': hashlib.sha256((ROOT / path).read_bytes()).hexdigest()}
                   for path in sorted(paths)]
        self.assertEqual(_verify_compute_sidecars(records, ROOT), len(paths))
        omitted = next(iter(compute_contract_asset_paths(ROOT)))
        with self.assertRaisesRegex(ValueError, 'complete worker closure'):
            _verify_compute_sidecars([item for item in records if item['path'] != omitted], ROOT)

    def test_static_site_rejects_files_above_host_cap(self):
        with tempfile.TemporaryDirectory() as temp:
            site = Path(temp) / "site"
            site.mkdir()
            (site / "accepted.bin").write_bytes(b"a" * 8)
            self.assertEqual(_validate_static_site_file_cap(site, max_bytes=8), (1, 8))

            (site / "oversized.bin").write_bytes(b"b" * 9)
            with self.assertRaisesRegex(RuntimeError, "oversized.bin: 9 bytes"):
                _validate_static_site_file_cap(site, max_bytes=8)

        self.assertEqual(CLOUDFLARE_PAGES_MAX_FILE_BYTES, 25 * 1024 * 1024)
        self.assertEqual(CLOUDFLARE_PAGES_FREE_MAX_FILES, 20_000)

    def test_static_site_rejects_too_many_files_for_free_pages(self):
        with tempfile.TemporaryDirectory() as temp:
            site = Path(temp) / "site"
            site.mkdir()
            (site / "one.txt").write_text("1", encoding="utf-8")
            (site / "two.txt").write_text("2", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "2 files; host limit is 1"):
                _validate_static_site_file_cap(site, max_files=1)

    def test_release_site_includes_static_404_page(self):
        self.assertIn("404.html", RELEASE_INCLUDE)

    def test_public_include_tree_parity_recurses_into_academy_starter(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            tests_dir = root / "tests"
            site = root / "site"
            tests_dir.mkdir()
            site.mkdir()
            for name in ("index.html", "404.html"):
                (tests_dir / name).write_text(name, encoding="utf-8")
                (site / name).write_text("deployment rewrite", encoding="utf-8")
            for name in ("learn", "guide", "api", "playground"):
                (tests_dir / name).mkdir()
                (site / name).mkdir()
                (tests_dir / name / "index.html").write_text(name, encoding="utf-8")
                (site / name / "index.html").write_text(name, encoding="utf-8")
            (tests_dir / "learn" / "starter").mkdir()
            (site / "learn" / "starter").mkdir()
            (tests_dir / "learn" / "starter" / "main.js").write_text("export {};", encoding="utf-8")
            (site / "learn" / "starter" / "main.js").write_text("export {};", encoding="utf-8")
            (tests_dir / "playground" / "index.legacy.html").write_text(
                "source-only legacy page",
                encoding="utf-8",
            )

            self.assertEqual(_validate_release_include_tree_parity(tests_dir, site), 7)
            (site / "playground" / "index.legacy.html").write_text(
                "must not ship",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(RuntimeError, "index.legacy.html"):
                _validate_release_include_tree_parity(tests_dir, site)
            (site / "playground" / "index.legacy.html").unlink()
            (site / "learn" / "starter" / "main.js").unlink()
            with self.assertRaisesRegex(RuntimeError, "starter/main.js"):
                _validate_release_include_tree_parity(tests_dir, site)

    def test_sidecar_manifest_copies_every_audited_asset_byte_for_byte(self):
        manifest = release_site_sidecar_asset_manifest(ROOT)
        destinations = {destination for _, destination in manifest}
        required = {
            "favicon.svg",
            "assets/corridor/academy-prism-v1.webp",
            "assets/corridor/playground-observatory-v1.webp",
            "assets/corridor/companion-gateway-v1.webp",
            "agi/llm/workers/LLMTokenizerWorker.js",
            "agi/llm/workers/LLMLoadPlannerWorker.js",
            "agi/particle_voice/lab/voice-lab.html",
            "agi/particle_voice/worklet/ParticleVoiceProcessor.js",
            "agi/particle_voice/model/ParticleVoiceModel.js",
            "agi/particle_voice/streaming/VoicePlayback.js",
            "plauna/themes/index.json",
            "plauna/widgets/Primitive/Button.css",
            "engine/assets/material/composite/resources/material/alloy/copper/brass.json",
            "editor/js/workers/ProfilerCanvasWorker.js",
            "editor/js/workers/CollabSignalWorker.js",
            "engine/sim/particles/SnapshotWorker.js",
            "engine/core/math/MathPacking.js",
            "engine/core/math/MathBits.js",
            "assets/physx-pe.wasm",
            "editor/physx-pe.wasm",
            "engine/sim/physics/physx-pe.wasm",
        }
        self.assertTrue(required.issubset(destinations))
        contract_paths = set(compute_contract_asset_paths(ROOT))
        self.assertIn("engine/core/schema/json-schema-profile.json", contract_paths)
        self.assertTrue(any(path.startswith("engine/core/compute/schemas/") for path in contract_paths))
        self.assertTrue(contract_paths.issubset(destinations), sorted(contract_paths - destinations))
        self.assertEqual(
            len([
                path for path in WEBGPU_OS_RUNTIME_ASSET_PATHS
                if path.startswith("factory/apps/") and path.endswith((".png", ".webp"))
            ]),
            11,
        )
        self.assertIn(
            "factory/apps/setup-center/assets/setup-realm-orbit-v1.png",
            WEBGPU_OS_RUNTIME_ASSET_PATHS,
        )
        self.assertIn(
            "factory/apps/setup-center/assets/setup-spark-trail-v1.png",
            WEBGPU_OS_RUNTIME_ASSET_PATHS,
        )
        self.assertIn("factory/apps/notepad/large-text-index-worker.js", WEBGPU_OS_RUNTIME_ASSET_PATHS)
        self.assertIn("factory/apps/paint/platform/paintWorker.js", WEBGPU_OS_RUNTIME_ASSET_PATHS)
        self.assertIn("factory/apps/paint/platform/animationExportWorker.js", WEBGPU_OS_RUNTIME_ASSET_PATHS)
        self.assertIn("factory/apps/paint/io/gifEncoder.js", WEBGPU_OS_RUNTIME_ASSET_PATHS)

        with tempfile.TemporaryDirectory() as temp:
            site = Path(temp) / "site"
            copied = lay_down_release_site_sidecar_assets(site, ROOT)
            self.assertEqual(copied, len(manifest))
            for source, destination in manifest:
                self.assertEqual((site / destination).read_bytes(), (ROOT / source).read_bytes())

    def test_academy_cache_busting_and_module_validation_are_recursive(self):
        with tempfile.TemporaryDirectory() as temp:
            site = Path(temp) / "site"
            source = site / "learn" / "src"
            starter = site / "learn" / "starter"
            (site / "engine").mkdir(parents=True)
            shared_motion = site / "plauna" / "motion"
            shared_motion.mkdir(parents=True)
            source.mkdir(parents=True)
            starter.mkdir()
            (shared_motion / "PageTransition.js").write_text(
                "export class PageTransition {};", encoding="utf-8"
            )
            (source / "main.js").write_text(
                "import '/plauna/motion/PageTransition.js?v=authored'; "
                "import './nested.js?v=authored';",
                encoding="utf-8",
            )
            (source / "nested.js").write_text("export { value } from './leaf.js';", encoding="utf-8")
            (source / "leaf.js").write_text("export const value = 1;", encoding="utf-8")
            (starter / "main.js").write_text("import { value } from '../src/leaf.js';", encoding="utf-8")

            _cache_bust_js_dir(site / "learn", "academy-test")

            self.assertIn(
                "./nested.js?v=authored&release=academy-test",
                (source / "main.js").read_text("utf-8"),
            )
            self.assertIn(
                "/plauna/motion/PageTransition.js?v=authored&release=academy-test",
                (source / "main.js").read_text("utf-8"),
            )
            self.assertIn("./leaf.js?v=academy-test", (source / "nested.js").read_text("utf-8"))
            self.assertIn("../src/leaf.js?v=academy-test", (starter / "main.js").read_text("utf-8"))
            self.assertEqual(_validate_academy_module_graph(site), 4)
            (source / "leaf.js").unlink()
            with self.assertRaisesRegex(RuntimeError, "no deployed module"):
                _validate_academy_module_graph(site)

    def test_academy_html_entry_preserves_authored_cache_version(self):
        with tempfile.TemporaryDirectory() as temp:
            index = Path(temp) / "index.html"
            index.write_text(
                '<script type="module" src="./src/main.js?v=20260803-director-2"></script>',
                encoding="utf-8",
            )

            _cache_bust_html_module_entry(
                index,
                "./src/main.js",
                "release-build",
                "Academy",
            )

            deployed = index.read_text(encoding="utf-8")
            self.assertIn(
                "./src/main.js?v=20260803-director-2&release=release-build",
                deployed,
            )

    def test_canonical_starter_ships_a_validated_raw_engine_closure(self):
        with tempfile.TemporaryDirectory() as temp:
            site = Path(temp) / "site"
            deployed_starter = site / "learn" / "starter"
            deployed_starter.mkdir(parents=True)
            deployed_source = site / "learn" / "src"
            deployed_source.mkdir()
            shutil.copy2(ROOT / "tests" / "learn" / "starter" / "main.js", deployed_starter / "main.js")
            shutil.copy2(
                ROOT / "tests" / "learn" / "src" / "lesson-shader.js",
                deployed_source / "lesson-shader.js",
            )

            copied = _lay_down_academy_starter_engine_closure(site, ROOT)
            _cache_bust_js_dir(site / "learn", "starter-test")
            _cache_bust_js_dir(site / "engine", "starter-test")

            self.assertGreater(copied, 1)
            self.assertGreater(_validate_academy_module_graph(site), copied)
            self.assertTrue((site / "engine" / "core" / "gpu" / "GpuDevice.js").is_file())
            starter_source = (deployed_starter / "main.js").read_text(encoding="utf-8")
            self.assertIn("../../engine/core/gpu/GpuDevice.js", starter_source)
            self.assertNotIn("../../../engine/", starter_source)

    def test_public_facades_preserve_engine_module_urls_and_complete_closure(self):
        with tempfile.TemporaryDirectory() as temp:
            site = Path(temp) / "site"
            copied = lay_down_release_site_static_modules(site, ROOT)
            self.assertGreater(copied, len(RELEASE_SITE_ENGINE_ASSET_SOURCES))
            for asset_name, engine_source in RELEASE_SITE_ENGINE_ASSET_SOURCES.items():
                source = (ROOT / "tests" / "assets" / asset_name).read_text(encoding="utf-8")
                self.assertEqual(
                    (site / "assets" / asset_name).read_text(encoding="utf-8"),
                    source.replace("../../" + engine_source, "../" + engine_source),
                )
                self.assertEqual((site / engine_source).read_bytes(), (ROOT / engine_source).read_bytes())
            self.assertEqual((site / "engine/version.js").read_bytes(), (ROOT / "engine/version.js").read_bytes())
            self.assertFalse((site / "core").exists())
            self.assertGreater(
                _validate_release_module_graph(site, "assets", "homepage", follow_imports=True), 0,
            )
            (site / "engine/core/gpu/GpuDeviceOwnership.js").unlink()
            with self.assertRaisesRegex(RuntimeError, "GpuDeviceOwnership.js.*no deployed module"):
                _validate_release_module_graph(site, "assets", "homepage", follow_imports=True)

    def test_docs_laydown_ships_curated_sources_indexes_and_root_discovery(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            md = root / "MD"
            site = root / "release" / "site"
            (md / "viewer").mkdir(parents=True)
            (md / "_config").mkdir()
            (md / "getting-started").mkdir()
            (md / "engine" / "reference").mkdir(parents=True)
            site.mkdir(parents=True)
            (md / "viewer" / "index.html").write_text("viewer", encoding="utf-8")
            (md / "_config" / "docs-bundle.json.gz").write_bytes(b"bundle")
            (md / "_config" / "nav.json").write_text(
                json.dumps({
                    "sections": [{
                        "items": [{"path": "getting-started/install.md"}],
                        "groups": [{"auto": "engine/reference"}],
                    }],
                }),
                encoding="utf-8",
            )
            (md / "index.md").write_text("# Docs", encoding="utf-8")
            (md / "getting-started" / "install.md").write_text("# Install", encoding="utf-8")
            (md / "engine" / "reference" / "_index.json").write_text("[]", encoding="utf-8")
            (md / "engine" / "reference" / "Generated.md").write_text(
                "# Bundled only", encoding="utf-8"
            )
            discovery = (
                "llms.txt",
                "llms-full.txt",
                "api-index.json",
                "docs-chunks.jsonl",
                "api-symbols.jsonl",
                "robots.txt",
                "sitemap.xml",
            )
            for name in discovery:
                (md / name).write_text(name, encoding="utf-8")
                (root / name).write_text("root-" + name, encoding="utf-8")

            copied = _lay_down_md_docs(site, root)

            self.assertGreaterEqual(copied, 10)
            self.assertTrue((site / "MD" / "getting-started" / "install.md").is_file())
            self.assertTrue((site / "MD" / "engine" / "reference" / "_index.json").is_file())
            self.assertFalse((site / "MD" / "engine" / "reference" / "Generated.md").exists())
            self.assertEqual((site / "api-index.json").read_text(encoding="utf-8"), "root-api-index.json")

    def test_staged_site_publish_replaces_live_site_and_removes_previous(self):
        with tempfile.TemporaryDirectory() as temp:
            release = Path(temp) / "release"
            staged = release / ".staging" / "site"
            final = release / "site"
            staged.mkdir(parents=True)
            final.mkdir(parents=True)
            (staged / "index.html").write_text("new", encoding="utf-8")
            (final / "index.html").write_text("old", encoding="utf-8")

            published = _publish_staged_site(staged, final)

            self.assertEqual(published, final)
            self.assertEqual((final / "index.html").read_text(encoding="utf-8"), "new")
            self.assertFalse(staged.exists())
            self.assertFalse((release / ".staging" / "site.previous").exists())

    def test_staged_site_publish_restores_previous_site_when_swap_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            release = Path(temp) / "release"
            staged = release / ".staging" / "site"
            final = release / "site"
            staged.mkdir(parents=True)
            final.mkdir(parents=True)
            (staged / "index.html").write_text("new", encoding="utf-8")
            (final / "index.html").write_text("old", encoding="utf-8")
            original_replace = Path.replace

            def fail_staged_swap(source, target):
                if source == staged:
                    raise OSError("simulated publication failure")
                return original_replace(source, target)

            with mock.patch.object(Path, "replace", autospec=True, side_effect=fail_staged_swap):
                with self.assertRaisesRegex(OSError, "simulated publication failure"):
                    _publish_staged_site(staged, final)

            self.assertEqual((final / "index.html").read_text(encoding="utf-8"), "old")
            self.assertTrue(staged.exists())
            self.assertFalse((release / ".staging" / "site.previous").exists())

    def test_staged_site_publish_syncs_file_atomically_when_live_directory_is_locked(self):
        with tempfile.TemporaryDirectory() as temp:
            release = Path(temp) / "release"
            staged = release / ".staging" / "site"
            final = release / "site"
            (staged / "assets").mkdir(parents=True)
            (final / "stale").mkdir(parents=True)
            (staged / "index.html").write_text("new", encoding="utf-8")
            (staged / "assets" / "runtime.js").write_text("fresh", encoding="utf-8")
            (final / "index.html").write_text("old", encoding="utf-8")
            (final / "stale" / "removed.js").write_text("stale", encoding="utf-8")
            original_replace = Path.replace

            def deny_live_directory_rename(source, target):
                if source == final:
                    raise PermissionError(5, "simulated live release-site lock", str(source))
                return original_replace(source, target)

            with mock.patch("bundler.site._PUBLISH_RETRY_DELAYS", (0,)), \
                    mock.patch.object(Path, "replace", autospec=True, side_effect=deny_live_directory_rename):
                published = _publish_staged_site(staged, final)

            self.assertEqual(published, final)
            self.assertEqual((final / "index.html").read_text(encoding="utf-8"), "new")
            self.assertEqual((final / "assets" / "runtime.js").read_text(encoding="utf-8"), "fresh")
            self.assertFalse((final / "stale" / "removed.js").exists())
            self.assertFalse(staged.exists())
            self.assertFalse((release / ".staging" / "site.previous").exists())

    def test_server_uses_previous_then_staged_site_during_publication_gap(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            previous = root / "release" / ".staging" / "site.previous"
            staged = root / "release" / ".staging" / "site"
            previous_module = previous / "playground" / "src" / "core" / "experiments.js"
            staged_module = staged / "playground" / "src" / "core" / "experiments.js"
            previous_module.parent.mkdir(parents=True)
            staged_module.parent.mkdir(parents=True)
            previous_module.write_text("old", encoding="utf-8")
            staged_module.write_text("new", encoding="utf-8")
            request = "/release/site/playground/src/core/experiments.js"

            self.assertEqual(
                _release_site_transition_path(root, request),
                previous_module.resolve(),
            )
            previous_module.unlink()
            self.assertEqual(
                _release_site_transition_path(root, request),
                staged_module.resolve(),
            )
            (root / "release" / "site").mkdir()
            self.assertIsNone(_release_site_transition_path(root, request))

    def test_server_transition_fallback_rejects_parent_traversal(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            staged = root / "release" / ".staging" / "site"
            staged.mkdir(parents=True)
            (staged.parent / "private.js").write_text("private", encoding="utf-8")

            self.assertIsNone(
                _release_site_transition_path(
                    root,
                    "/release/site/../private.js",
                )
            )

    def test_archive_contains_every_publish_file_at_root_with_exact_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            site = root / "site"
            assets = site / "assets"
            assets.mkdir(parents=True)
            viewer = site / "MD" / "viewer"
            viewer.mkdir(parents=True)
            (site / "index.html").write_text("<h1>Particle Realms</h1>", encoding="utf-8")
            image_bytes = b"RIFF\x10\x00\x00\x00WEBPtest"
            (assets / "abyssal-layers").mkdir()
            (assets / "abyssal-layers" / "mineral-base-v4.webp").write_bytes(image_bytes)
            (assets / "underwater-silt.js").write_text("export const ready = true;", encoding="utf-8")
            (viewer / "Viewer.js").write_text("export {};", encoding="utf-8")
            archive_path = root / "particle-platform-site.zip"

            file_count, archive_bytes = create_release_site_archive(
                site,
                archive_path,
                required_paths=(
                    "index.html",
                    "assets/abyssal-layers/mineral-base-v4.webp",
                    "assets/underwater-silt.js",
                ),
            )

            self.assertEqual(file_count, 4)
            self.assertEqual(archive_bytes, archive_path.stat().st_size)
            with zipfile.ZipFile(archive_path, "r") as archive:
                self.assertEqual(
                    sorted(archive.namelist()),
                    [
                        "MD/viewer/Viewer.js",
                        "assets/abyssal-layers/mineral-base-v4.webp",
                        "assets/underwater-silt.js",
                        "index.html",
                    ],
                )
                self.assertEqual(
                    archive.read("assets/abyssal-layers/mineral-base-v4.webp"),
                    image_bytes,
                )
                self.assertIsNone(archive.testzip())

    def test_archive_fails_when_a_required_asset_is_absent(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            site = root / "site"
            site.mkdir()
            (site / "index.html").write_text("ok", encoding="utf-8")

            with self.assertRaisesRegex(FileNotFoundError, "mineral-base-v4.webp"):
                create_release_site_archive(
                    site,
                    root / "site.zip",
                    required_paths=("assets/abyssal-layers/mineral-base-v4.webp",),
                )


if __name__ == "__main__":
    unittest.main()
