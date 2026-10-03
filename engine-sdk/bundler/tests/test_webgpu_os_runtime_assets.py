# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import base64
import gzip
import hashlib
import io
import json
import re
import shutil
import subprocess
import tempfile
import threading
import unittest
import zipfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

import bundler.site as site_module
from bundler.engine_demo_transport import read_transport_file, transport_paths
from bundler.runtime_transport import plan_compressed_artifact_parts

from bundler.site import (
    ENGINE_DEMO_RUNTIME_ASSET_COPIES,
    ENGINE_DEMO_RUNTIME_DEPLOYMENT_PATHS,
    ENGINE_DEMO_RUNTIME_KIT_MANIFEST,
    ENGINE_DEMO_STARTER_ARCHIVE_PATH,
    REALMFORGE_CONSTRUCTION_GENERATION_WORKER_OS_MODULE_PATHS,
    REALMFORGE_CONSTRUCTION_GENERATION_WORKER_VENDOR_MODULE_PATHS,
    RELEASE_MODULE_WORKER_CLOSURE_PATHS,
    RELEASE_MODULE_WORKER_ROOT_PATHS,
    WEBGPU_OS_SHELL_ASSET_COPIES,
    WEBGPU_OS_PWA_ASSET_PATHS,
    WEBGPU_OS_REQUIRED_DEPLOYMENT_PATHS,
    WEBGPU_OS_RUNTIME_ASSET_PATHS,
    WEBGPU_OS_STABLE_BOOTSTRAP_ASSET_PATHS,
    _ENGINE_DEMO_PUBLIC_API_NAMES,
    _ENGINE_DEMO_STARTER_CSP,
    _engine_demo_public_api_membrane_source,
    _engine_demo_runtime_kit_manifest_bytes,
    _engine_demo_runtime_source_files,
    _release_runtime_cache_token,
    _write_release_runtime_loader,
    _write_webgpu_os_bundle_index,
    _write_webgpu_os_release_boot,
    _write_platform_os_launcher,
    lay_down_engine_demo_runtime_assets,
    lay_down_companion_privacy,
    lay_down_webgpu_os_shell_assets,
    lay_down_webgpu_os_stable_network_resources,
    lay_down_webgpu_os_host_metadata,
    lay_down_webgpu_os_pwa_assets,
    lay_down_webgpu_os_runtime_assets,
    document_runtime_asset_manifest,
    lay_down_document_runtime_assets,
    sync_release_runtime_consumer,
    validate_webgpu_os_deployment,
)


ROOT = Path(__file__).resolve().parents[2]
BROWSER_CANDIDATES = (
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
)


def _copy_coherent_engine_demo_template_fixture(destination):
    """Clone Template and bind its kit manifest to the cloned source bytes."""
    destination = Path(destination)
    shutil.copytree(ROOT / "Template", destination / "Template")
    canonical_wasm = (
        destination / "engine" / "sim" / "physics" / "physx-pe.wasm"
    )
    canonical_wasm.parent.mkdir(parents=True)
    shutil.copy2(
        ROOT / "engine" / "sim" / "physics" / "physx-pe.wasm",
        canonical_wasm,
    )
    source_files = {
        deployed_name: destination / source_name
        for source_name, deployed_name in ENGINE_DEMO_RUNTIME_ASSET_COPIES
    }
    kit_path = (
        destination / "Template" / "assets" / ENGINE_DEMO_RUNTIME_KIT_MANIFEST
    )
    kit_path.write_bytes(_engine_demo_runtime_kit_manifest_bytes(source_files))
    return source_files


def _write_changed_platform_release(root):
    """Create a temporary byte-distinct runtime with identical decoded JS.

    Compute sidecars come from the live source tree, so bind only their test
    descriptors to the copied release bytes. Keep the cloned physics pins
    and runtime provenance verification contract unchanged.
    """
    root = Path(root)
    template_assets = root / "Template" / "assets"
    original_runtime = (template_assets / "particle-platform.min.js.gz").read_bytes()
    changed_runtime = bytearray(original_runtime)
    changed_runtime[4] = (changed_runtime[4] + 1) % 256
    changed_runtime = bytes(changed_runtime)
    if gzip.decompress(changed_runtime) != gzip.decompress(original_runtime):
        raise AssertionError("Test runtime header change altered decoded JavaScript")
    gzip_sha256 = hashlib.sha256(changed_runtime).hexdigest()

    manifest = json.loads(
        (template_assets / "particle-platform.manifest.json").read_text("utf-8")
    )
    provenance = json.loads(
        (template_assets / "particle-platform.provenance.json").read_text("utf-8")
    )
    manifest["post_build_verification"]["gzip_sha256"] = gzip_sha256
    records, parts = plan_compressed_artifact_parts('particle-platform.min.js.gz', changed_runtime,
                                                   max_file_bytes=25 * 1024 * 1024)
    if records:
        manifest.setdefault('compressed_artifact_parts', {})['particle-platform.min.js.gz'] = records
    gzip_subject = next(
        subject
        for subject in provenance["subject"]
        if subject.get("name") == "particle-platform.min.js.gz"
    )
    gzip_subject["digest"] = {"sha256": gzip_sha256}
    provenance_bytes = (json.dumps(provenance, indent=2) + "\n").encode("utf-8")
    manifest["provenance"]["sha256"] = hashlib.sha256(
        provenance_bytes
    ).hexdigest()

    release = root / "release"
    release.mkdir()
    for name, payload in parts.items():
        (release / name).write_bytes(payload)
    for item in manifest.get('computeAssets', []) + manifest.get('physicsAssets', []):
        target = release / item['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / item['path'], target)
    for item in manifest.get('officialPackageAssets', []):
        target = release / item['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / 'release' / item['path'], target)
    (release / "particle-platform.min.js.gz").write_bytes(changed_runtime)
    for item in manifest.get("computeAssets", []):
        payload = (release / item["path"]).read_bytes()
        item["sha256"] = hashlib.sha256(payload).hexdigest()
        item["byteLength"] = len(payload)
    manifest_bytes = (json.dumps(manifest, indent=2) + "\n").encode("utf-8")
    (release / "particle-platform.manifest.json").write_bytes(manifest_bytes)
    (release / "particle-platform.provenance.json").write_bytes(provenance_bytes)
    return release, manifest, original_runtime, changed_runtime


def _find_browser():
    for candidate in BROWSER_CANDIDATES:
        if candidate.is_file():
            return candidate
    for command in ("chrome", "msedge", "chromium", "chromium-browser"):
        resolved = shutil.which(command)
        if resolved:
            return Path(resolved)
    return None


def _javascript_engine_demo_membrane_contract():
    forge_source = (
        ROOT / "webgpu-os" / "kernel" / "execution" / "DodadForge.js"
    ).read_text(encoding="utf-8")
    names_match = re.search(
        r"export const DODAD_ENGINE_DEMO_PUBLIC_API_NAMES\s*=\s*"
        r"Object\.freeze\(\[(.*?)\]\);",
        forge_source,
        flags=re.DOTALL,
    )
    if not names_match:
        raise AssertionError("Could not read the JavaScript engine-demo API contract")
    names = tuple(re.findall(r"'([^']+)'", names_match.group(1)))

    package_source = (
        ROOT / "webgpu-os" / "apps" / "ai-echo" / "EngineDemoPackage.js"
    ).read_text(encoding="utf-8")
    membrane_match = re.search(
        r"export function buildPublicApiMembraneSource\(\)\s*\{\s*"
        r"return `(.*?)`;\s*\}",
        package_source,
        flags=re.DOTALL,
    )
    if not membrane_match:
        raise AssertionError("Could not read buildPublicApiMembraneSource()")
    generated = membrane_match.group(1).replace(
        "${JSON.stringify(ENGINE_DEMO_PUBLIC_API_NAMES)}",
        json.dumps(list(names), ensure_ascii=True, separators=(",", ":")),
    )
    return names, generated


class TestWebGpuOsRuntimeAssets(unittest.TestCase):
    def test_webgpu_os_source_copy_excludes_generated_runtime_artifacts(self):
        ignore = shutil.ignore_patterns(
            "*.min.js",
            *site_module.WEBGPU_OS_GENERATED_RUNTIME_ASSET_PATTERNS,
        )
        names = [
            "app-icon.svg",
            "particle-os.js",
            "particle-os.manifest.json",
            "particle-os.min.js",
            "particle-os.min.js.gz",
            "particle-os.min.js.gz.abc.part-0000.bin",
            "particle-os.min.js.sri",
            "particle-os.min.js.zst",
            "particle-os.provenance.json",
        ]

        self.assertEqual(
            sorted(ignore("assets", names)),
            sorted(name for name in names if name != "app-icon.svg"),
        )

    def test_site_copy_uses_the_current_build_artifact_directory(self):
        graph = object()
        with tempfile.TemporaryDirectory() as temporary:
            release = Path(temporary) / "release"
            artifacts = Path(temporary) / "current-build"
            artifacts.mkdir()
            with (
                mock.patch.object(site_module, "lay_down_webgpu_os", return_value=7) as lay_down,
                mock.patch.object(site_module, "_validate_static_site_file_cap", return_value=(0, 0)),
                mock.patch.object(
                    site_module,
                    "_publish_staged_site",
                    side_effect=lambda staging, _final: staging,
                ),
            ):
                copied, total = site_module.copy_webgpu_os_site(
                    ROOT,
                    release,
                    graph,
                    best_ext=".zst",
                    bundle_assets_dir=artifacts,
                )

        self.assertEqual((copied, total), (7, 0))
        lay_down.assert_called_once_with(
            release / ".staging" / "site",
            ROOT,
            graph,
            ".zst",
            bundle_assets_dir=artifacts,
        )

    def test_realmforge_audio_worklet_url_is_staged_and_missing_source_fails(self):
        factory = ROOT / "webgpu-os/apps/realmforge/factory.js"
        reference = re.search(
            r"const PHASE9_AUDIO_WORKLET_URL = new URL\(\s*['\"]([^'\"]+)['\"],\s*import\.meta\.url",
            factory.read_text("utf-8"),
        )
        self.assertIsNotNone(reference, "RealmForge worklet URL is missing")
        worklet = (factory.parent / reference.group(1)).resolve()
        relative_name = worklet.relative_to(ROOT).as_posix()
        copies = site_module.release_site_sidecar_asset_manifest(ROOT)
        self.assertIn((relative_name, relative_name), copies)
        imports, _exports = site_module.parse_module(worklet.read_text("utf-8"))
        self.assertFalse(imports, "Worklet imports require an explicit deployed dependency closure")
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "site"
            site_module.lay_down_release_site_sidecar_assets(destination, ROOT)
            self.assertEqual((destination / relative_name).read_bytes(), worklet.read_bytes())
            (destination / relative_name).unlink()
            with self.assertRaises(FileNotFoundError):
                site_module._copy_release_asset_manifest(
                    Path(temporary) / "incomplete-site", destination, [(relative_name, relative_name)]
                )

    def test_soul_humanoid_url_is_in_the_shared_sidecar_contract(self):
        source = ROOT / "webgpu-os/apps/soul/SoulAssets.js"
        reference = re.search(
            r"fetch\(new URL\(['\"]([^'\"]+)['\"],\s*import\.meta\.url\)",
            source.read_text("utf-8"),
        )
        self.assertIsNotNone(reference, "SOUL humanoid runtime URL is missing")
        model = (source.parent / reference.group(1)).resolve()
        relative = model.relative_to(ROOT).as_posix()
        pair = (relative, relative)
        self.assertIn(pair, site_module.release_site_sidecar_asset_manifest(ROOT))
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "site"
            site_module._copy_release_asset_manifest(destination, ROOT, [pair])
            self.assertEqual((destination / relative).read_bytes(), model.read_bytes())
            (destination / relative).unlink()
            with self.assertRaises(FileNotFoundError):
                site_module._copy_release_asset_manifest(Path(temporary) / "incomplete", destination, [pair])

    def test_gpu_render_worker_url_ships_an_exact_independent_module_closure(self):
        host = ROOT / "engine/core/gpu/GpuRenderWorkerHost.js"
        reference = re.search(r"new URL\(['\"]([^'\"]+)['\"],\s*import\.meta\.url\)", host.read_text("utf-8"))
        self.assertIsNotNone(reference, "GPU worker runtime URL is missing")
        worker = (host.parent / reference.group(1)).resolve().relative_to(ROOT).as_posix()
        self.assertEqual(worker, site_module.GPU_RENDER_WORKER_ENTRY_PATH)
        paths = site_module.GPU_RENDER_WORKER_MODULE_PATHS
        manifest = site_module.release_site_sidecar_asset_manifest(ROOT)
        self.assertTrue(all((path, path) in manifest for path in paths))
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary)
            site_module._copy_release_asset_manifest(destination, ROOT, [(path, path) for path in paths])
            def validate():
                return site_module._validate_release_module_graph(
                    destination, ".", "GPU render worker", follow_imports=True,
                    entry_relative_paths=(worker,), expected_relative_paths=paths,
                )
            self.assertGreater(validate(), 0)
            dependency = destination / "engine/core/gpu/GpuDescriptorIdentity.js"
            original = dependency.read_bytes()
            dependency.unlink()
            with self.assertRaisesRegex(RuntimeError, "GpuDescriptorIdentity.js.*no deployed module"):
                validate()
            dependency.write_bytes(original)
            dependency.write_text("<!doctype html><title>Fallback</title>", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "GpuDescriptorIdentity.js.*resolves to HTML"):
                validate()
            dependency.write_bytes(original)
            extra = destination / "engine/core/gpu/UnreviewedGpuDependency.js"
            extra.write_text("export const value = 1;\n", encoding="utf-8")
            dependency.write_bytes(original + b"\nimport './UnreviewedGpuDependency.js';\n")
            with self.assertRaisesRegex(RuntimeError, "unexpected=.*UnreviewedGpuDependency"):
                validate()

    def test_document_analysis_native_worker_includes_its_engine_closure(self):
        manifest = document_runtime_asset_manifest(ROOT)
        names = [source for source, _destination in manifest]
        self.assertEqual(len(names), len(set(names)))
        self.assertIn("webgpu-os/factory/components/ocr/worker.js", names)
        self.assertIn("engine/core/math/DocumentImageMath.js", names)
        self.assertIn("engine/core/math/ImageMath.js", names)
        self.assertIn("engine/core/math/MathStatistics.js", names)
        self.assertFalse(any(name.startswith("agi/") or "tesseract" in name.lower() for name in names))

    def test_document_analysis_worker_stages_byte_exact_and_missing_dependency_fails(self):
        with tempfile.TemporaryDirectory() as temporary:
            site = Path(temporary)
            copied = lay_down_document_runtime_assets(site, ROOT)
            self.assertEqual(copied, len(document_runtime_asset_manifest(ROOT)))
            for name in ("webgpu-os/factory/components/ocr/worker.js", "engine/core/math/DocumentImageMath.js", "engine/core/math/ImageMath.js"):
                self.assertEqual((site / name).read_bytes(), (ROOT / name).read_bytes())
            missing = site / "engine/core/math/ImageMath.js"
            missing.unlink()
            with self.assertRaisesRegex(ValueError, "Incomplete document analysis worker closure"):
                document_runtime_asset_manifest(site)
            with self.assertRaisesRegex(RuntimeError, "ImageMath.js.*no deployed module"):
                site_module._validate_release_module_graph(site, "webgpu-os/factory/components/ocr", "document analysis", follow_imports=True,
                    entry_relative_paths=("webgpu-os/factory/components/ocr/worker.js",))

    def test_sewing_fitting_worker_stages_owned_closure_without_archived_vendor(self):
        manifest = document_runtime_asset_manifest(ROOT)
        names = {source for source, _destination in manifest}
        worker = "webgpu-os/factory/apps/sewing/fitted-worker.js"
        blocks = "webgpu-os/factory/apps/sewing/fitted-blocks.js"
        self.assertIn(worker, names)
        self.assertIn(blocks, names)
        self.assertIn("engine/kaolin/ops/mesh/MeshOps.js", names)
        self.assertFalse(any("freesewing" in name.lower() for name in names))
        self.assertNotIn("webgpu-os/factory/components/pattern-generation/worker.js", names)
        retained_pdf = (
            "vendor/pdfjs/build/pdf.mjs",
            "vendor/pdfjs/build/pdf.worker.mjs",
            "vendor/pdf-lib/dist/pdf-lib.esm.js",
            "vendor/pdf-fontkit/dist/fontkit.umd.js",
        )
        self.assertTrue(set(retained_pdf).issubset(names))
        archive = ROOT / "webgpu-os/vendor/freesewing-4.10.1/provenance.json"
        archive_bytes = archive.read_bytes()
        with tempfile.TemporaryDirectory() as temporary:
            site = Path(temporary)
            self.assertEqual(lay_down_document_runtime_assets(site, ROOT), len(manifest))
            for source, destination in manifest:
                with self.subTest(asset=source):
                    self.assertEqual((site / destination).read_bytes(), (ROOT / source).read_bytes())
            self.assertFalse((site / "webgpu-os/vendor/freesewing-4.10.1").exists())
            self.assertEqual(archive.read_bytes(), archive_bytes)
            (site / blocks).unlink()
            with self.assertRaisesRegex(ValueError, "Incomplete Sewing fitting worker closure"):
                document_runtime_asset_manifest(site)
            with self.assertRaisesRegex(RuntimeError, "fitted-blocks.js.*no deployed module"):
                site_module._validate_release_module_graph(site, "webgpu-os/factory/apps/sewing", "Sewing fitting", follow_imports=True,
                    entry_relative_paths=(worker,))

    def test_sewing_accessory_worker_stages_its_constraint_closure(self):
        worker = "webgpu-os/factory/apps/sewing/accessory-mesh-worker.js"
        constraint = "webgpu-os/factory/components/mesh/contourConstraints.js"
        manifest = document_runtime_asset_manifest(ROOT)
        self.assertTrue({worker, constraint}.issubset({source for source, _ in manifest}))
        with tempfile.TemporaryDirectory() as temporary:
            site = Path(temporary)
            lay_down_document_runtime_assets(site, ROOT)
            for name in (worker, constraint):
                self.assertEqual((site / name).read_bytes(), (ROOT / name).read_bytes())
            (site / constraint).unlink()
            with self.assertRaisesRegex(ValueError, "Incomplete Sewing accessory geometry worker closure"):
                document_runtime_asset_manifest(site)

    def test_sewing_accessory_assembly_stages_its_shared_engine_closure(self):
        worker = "webgpu-os/factory/apps/sewing/accessory-assembly-worker.js"
        adapter = "webgpu-os/factory/apps/sewing/accessory-cloth.js"
        seed = "engine/sim/cloth/triangular/assembly-seed.js"
        manifest = document_runtime_asset_manifest(ROOT)
        self.assertTrue({worker, adapter, seed}.issubset({source for source, _ in manifest}))
        with tempfile.TemporaryDirectory() as temporary:
            site = Path(temporary)
            lay_down_document_runtime_assets(site, ROOT)
            for name in (worker, adapter, seed):
                self.assertEqual((site / name).read_bytes(), (ROOT / name).read_bytes())
            (site / adapter).unlink()
            with self.assertRaisesRegex(ValueError, "Incomplete Sewing accessory assembly worker closure"):
                document_runtime_asset_manifest(site)

    def test_triangular_cloth_worker_stages_its_engine_closure(self):
        worker = "engine/sim/cloth/triangular/worker.js"
        solver = "engine/sim/cloth/triangular/index.js"
        contact = "engine/sim/cloth/triangular/contact.js"
        manifest = document_runtime_asset_manifest(ROOT)
        self.assertTrue({worker, solver, contact}.issubset({source for source, _ in manifest}))
        with tempfile.TemporaryDirectory() as temporary:
            site = Path(temporary)
            self.assertEqual(lay_down_document_runtime_assets(site, ROOT), len(manifest))
            for source, destination in manifest:
                with self.subTest(asset=source):
                    self.assertEqual((site / destination).read_bytes(), (ROOT / source).read_bytes())
            (site / contact).unlink()
            # Sewing also imports this solver and can be the first missing
            # closure reported. Require the missing dependency, not traversal order.
            with self.assertRaisesRegex(ValueError, r"Incomplete .* worker closure: .*contact\.js"):
                document_runtime_asset_manifest(site)
            with self.assertRaisesRegex(RuntimeError, "contact.js.*no deployed module"):
                site_module._validate_release_module_graph(site, "engine/sim/cloth/triangular", "triangular cloth", follow_imports=True,
                    entry_relative_paths=(worker,))

    def test_surface_material_worker_ships_exact_raw_closure_and_preserves_compiled_url(self):
        from urllib.parse import urljoin
        from bundler.graph import ModuleGraph
        from bundler.emitter import rewrite_module_canonical, find_executable_import_meta

        client = ROOT / "engine/sim/surfaceFields/SurfaceFieldWorkerClient.js"
        reference = re.search(r"new URL\(['\"]([^'\"]+)['\"],\s*import\.meta\.url\)", client.read_text("utf-8"))
        self.assertIsNotNone(reference, "Surface material worker runtime URL is missing")
        worker = (client.parent / reference.group(1)).resolve().relative_to(ROOT).as_posix()
        self.assertIn(("surface material", worker), site_module.DOCUMENT_RUNTIME_WORKER_ENTRIES)
        graph = ModuleGraph(ROOT)
        graph.walk(worker)
        self.assertEqual(graph.errors, [])
        paths = tuple(sorted(Path(name).relative_to(ROOT).as_posix() for name in graph.order))
        manifest = document_runtime_asset_manifest(ROOT)
        self.assertTrue(all((name, name) in manifest for name in paths))
        self.assertIn("engine/sim/surfaceFields/SurfaceFieldChemistry.js", paths)
        self.assertIn("engine/sim/combustion/WoodCombustion.js", paths)
        self.assertIn("engine/matter/transformations/MatterOperators.js", paths)
        self.assertFalse(any(name.startswith("engine/sim/physics/") for name in paths))
        with tempfile.TemporaryDirectory() as temporary:
            site = Path(temporary)
            site_module._copy_release_asset_manifest(site, ROOT, [(name, name) for name in paths])
            for name in paths:
                self.assertEqual((site / name).read_bytes(), (ROOT / name).read_bytes())
            def validate():
                return site_module._validate_release_module_graph(site, ".", "surface material", follow_imports=True,
                    entry_relative_paths=(worker,), expected_relative_paths=paths)
            self.assertGreater(validate(), 0)
            (site / "engine/sim/surfaceFields/SurfaceFieldChemistry.js").unlink()
            with self.assertRaisesRegex(RuntimeError, "SurfaceFieldChemistry.js.*no deployed module"):
                validate()
        transformed = rewrite_module_canonical(client.read_text("utf-8"), str(client), graph, os_base_prefix="webgpu-os/")
        self.assertEqual(find_executable_import_meta(transformed), [])
        self.assertIn('new URL("sim/surfaceFields/SurfaceFieldWorkerClient.js",', transformed)
        self.assertIn('globalThis.__PE_ENGINE_BASE__', transformed)
        self.assertIn('["engine"]', transformed)
        self.assertIn("new URL('./SurfaceFieldWorker.js',", transformed)
        for prefix in ("/", "/releases/example/"):
            site = f"https://example.test{prefix}"
            source_url = urljoin(urljoin(site, "engine/"), "sim/surfaceFields/SurfaceFieldWorkerClient.js")
            self.assertEqual(urljoin(source_url, reference.group(1)), urljoin(site, worker))

    def _write_generated_boot_assets(self, destination):
        for relative_name in ("index.html", "style.css", "boot-theme.js"):
            target = destination / relative_name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / "webgpu-os" / relative_name, target)
        lay_down_webgpu_os_shell_assets(destination.parent, ROOT)
        lay_down_webgpu_os_stable_network_resources(ROOT, destination.parent)
        _write_release_runtime_loader(destination / "assets" / "release-runtime-loader.js")
        _write_webgpu_os_release_boot(destination / "release-boot.js")

    def _run_compiled_runtime_boundary_browser_scenario(self, scenario):
        browser = _find_browser()
        if browser is None:
            self.skipTest("Chrome, Edge, or Chromium is required for the lazy runtime smoke")

        runtime_source = (
            "globalThis.PE={requireModule(){},__modules:{runtime:true},"
            "bootWebGpuOS:async(options)=>{globalThis.__lazyCounters.boot++;"
            "globalThis.__compiledShellStyled=getComputedStyle(document.documentElement)"
            ".getPropertyValue('--compiled-shell-fixture').trim()==='ready';"
            "globalThis.__compiledBootOptions=options;}};"
        )
        runtime_bytes = runtime_source.encode("utf-8")
        integrity = "sha384-" + base64.b64encode(
            hashlib.sha384(runtime_bytes).digest()
        ).decode("ascii")
        digest_bytes = list(hashlib.sha384(runtime_bytes).digest())
        if scenario == "active":
            exercise = """
(async () => {
  const { bootStableBootstrap } = await import('/webgpu-os/bootstrap/StableBootstrap.js');
  const configured = globalThis.__particleStableBootstrapOptions;
  const legacy = configured?.legacyRuntimeLoader;
  if (typeof legacy !== 'function') throw new Error('legacyRuntimeLoader missing');
  const registry = {
    init: async () => {},
    status: async () => ({
      activeReleaseId: 'installed-release',
      previousReleaseId: null,
      pendingReleaseId: null
    })
  };
  let rejectedAsInstalled = false;
  try {
    await bootStableBootstrap({
      registry,
      serviceWorkerContainer: null,
      legacyRuntimeLoader: legacy,
      logger: { info() {}, warn() {}, error() {} }
    });
  } catch (error) {
    rejectedAsInstalled = error?.code === 'STABLE_WORKER_NOT_CONTROLLING';
  }
  const counters = globalThis.__lazyCounters;
  const passed = rejectedAsInstalled
    && document.querySelector('#webgpu-os-compiled-runtime-loader')?.content?.querySelector('script')
    && globalThis.__PE_RUNTIME_READY === undefined
    && Object.values(counters).every(value => value === 0)
    && globalThis.__unhandledRejections === 0;
  finish(passed);
})().catch(fail);
"""
            expected = {"style": "0", "loader": "0", "fetch": "0", "decompress": "0", "blob": "0", "script": "0", "boot": "0", "unhandled": "0"}
        elif scenario in ("empty", "style-preloaded", "style-pending"):
            exercise = """
(async () => {
  const legacy = globalThis.__particleStableBootstrapOptions?.legacyRuntimeLoader;
  if (typeof legacy !== 'function') throw new Error('legacyRuntimeLoader missing');
  if (globalThis.__pendingShellStyle) {
    const pending = document.createElement('link');
    pending.rel = 'stylesheet';
    pending.href = '/webgpu-os/style.css';
    document.head.appendChild(pending);
  }
  const renderer = Object.freeze({ render: () => true });
  const echoAvatarRuntimeContext = Object.freeze({
    runtimeEpoch: 1,
    bootProgressRenderer: renderer,
    services: Object.freeze({})
  });
  const first = legacy(console, { echoAvatarRuntimeContext });
  const second = legacy(console, { echoAvatarRuntimeContext: null });
  const samePromise = first === second;
  await Promise.all([first, second]);
  const counters = globalThis.__lazyCounters;
  const passed = samePromise
    && globalThis.__PE_RUNTIME_READY?.then
    && globalThis.__compiledBootOptions?.echoAvatarRuntimeContext === echoAvatarRuntimeContext
    && Object.entries(counters).every(([key, value]) => value === (key === 'style' ? globalThis.__expectedShellStyleAppends : 1))
    && globalThis.__compiledStyleBeforeLoader === true
    && globalThis.__compiledShellStyled === true
    && [...document.querySelectorAll('link[rel~="stylesheet"]')].filter(link => link.href.endsWith('/webgpu-os/style.css')).length === 1
    && [...document.styleSheets].findIndex(sheet => sheet.href?.endsWith('/webgpu-os/style.css'))
      > [...document.styleSheets].findIndex(sheet => sheet.href?.endsWith('/webgpu-os/bootstrap/boot-surface.css'))
    && globalThis.__unhandledRejections === 0;
  finish(passed);
})().catch(fail);
"""
            expected = {"style": "0" if scenario == "style-preloaded" else "1", "loader": "1", "fetch": "1", "decompress": "1", "blob": "1", "script": "1", "boot": "1", "unhandled": "0"}
        elif scenario == "rejection":
            exercise = """
(async () => {
  const legacy = globalThis.__particleStableBootstrapOptions?.legacyRuntimeLoader;
  if (typeof legacy !== 'function') throw new Error('legacyRuntimeLoader missing');
  let rejected = false;
  try {
    await legacy();
  } catch (error) {
    rejected = /SHA-384 verification/.test(String(error?.message || error));
  }
  await new Promise(resolve => setTimeout(resolve, 50));
  const counters = globalThis.__lazyCounters;
  const passed = rejected
    && counters.loader === 1
    && counters.fetch === 1
    && counters.decompress === 1
    && counters.blob === 0
    && counters.script === 0
    && counters.boot === 0
    && globalThis.__unhandledRejections === 0;
  finish(passed);
})().catch(fail);
"""
            expected = {"style": "1", "loader": "1", "fetch": "1", "decompress": "1", "blob": "0", "script": "0", "boot": "0", "unhandled": "0"}
        elif scenario == "style-rejection":
            exercise = """
(async () => {
  const legacy = globalThis.__particleStableBootstrapOptions?.legacyRuntimeLoader;
  if (typeof legacy !== 'function') throw new Error('legacyRuntimeLoader missing');
  const first = legacy();
  const second = legacy();
  const outcomes = await Promise.allSettled([first, second]);
  const { bootStableBootstrap } = await import('/webgpu-os/bootstrap/StableBootstrap.js');
  let recoveryCode = null;
  try {
    await bootStableBootstrap({
      registry: { init: async () => {}, status: async () => ({ activeReleaseId: null }) },
      serviceWorkerContainer: null,
      legacyRuntimeLoader: legacy,
      logger: { info() {}, warn() {}, error() {} }
    });
  } catch (error) { recoveryCode = error?.code; }
  await new Promise(resolve => setTimeout(resolve, 50));
  const passed = first === second
    && outcomes.every(result => result.status === 'rejected' && result.reason?.code === 'LEGACY_STYLE_FAILED')
    && recoveryCode === 'LEGACY_STYLE_FAILED'
    && document.querySelector('#os-boot-loader.is-recovery')?.hidden === false
    && document.querySelector('#os-boot-status[role="alert"]')?.textContent.includes('stylesheet failed to load')
    && document.documentElement.dataset.webgpuOsBoot === 'bundle-error'
    && Object.entries(globalThis.__lazyCounters).every(([key, value]) => value === (key === 'style' ? 1 : 0))
    && globalThis.__PE_RUNTIME_READY === undefined
    && globalThis.__unhandledRejections === 0;
  finish(passed);
})().catch(fail);
"""
            expected = {"style": "1", "loader": "0", "fetch": "0", "decompress": "0", "blob": "0", "script": "0", "boot": "0", "unhandled": "0"}
        else:
            raise ValueError(f"Unknown compiled runtime boundary scenario: {scenario}")

        digest_result = (
            "new Uint8Array(48).buffer"
            if scenario == "rejection"
            else "expectedDigest.buffer.slice(0)"
        )
        prelude = f"""
const runtimeSource={json.dumps(runtime_source)};
const decodedRuntime=new TextEncoder().encode(runtimeSource);
const expectedDigest=new Uint8Array({json.dumps(digest_bytes)});
globalThis.__lazyCounters={{style:0,loader:0,fetch:0,decompress:0,blob:0,script:0,boot:0}};
globalThis.__pendingShellStyle={json.dumps(scenario == 'style-pending')};
globalThis.__expectedShellStyleAppends={0 if scenario == 'style-preloaded' else 1};
globalThis.__unhandledRejections=0;
globalThis.addEventListener('unhandledrejection',event=>{{
  globalThis.__unhandledRejections++;
  event.preventDefault();
}});
Object.defineProperty(globalThis.crypto,'subtle',{{configurable:true,value:{{
  digest:async()=>{digest_result}
}}}});
globalThis.fetch=async()=>{{
  globalThis.__lazyCounters.fetch++;
  let sent=false;
  return {{
    ok:true,
    status:200,
    headers:{{get:name=>name.toLowerCase()==='content-length'?'4':null}},
    body:{{
      getReader:()=>({{
        read:async()=>sent?{{done:true}}:(sent=true,{{done:false,value:new Uint8Array([0x1f,0x8b,0,0])}}),
        cancel:async()=>{{}}
      }}),
      cancel:async()=>{{}}
    }}
  }};
}};
Object.defineProperty(globalThis,'DecompressionStream',{{configurable:true,value:class {{
  constructor(format) {{
    if(format!=='gzip')throw new Error('unexpected compression format');
    globalThis.__lazyCounters.decompress++;
    return new TransformStream({{
      start(controller){{controller.enqueue(decodedRuntime);}},
      transform(){{}}
    }});
  }}
}}}});
const createObjectURL=URL.createObjectURL.bind(URL);
URL.createObjectURL=value=>{{globalThis.__lazyCounters.blob++;return createObjectURL(value);}};
const appendChild=document.head.appendChild.bind(document.head);
document.head.appendChild=node=>{{
  if(node instanceof HTMLLinkElement && node.href.endsWith('/webgpu-os/style.css'))globalThis.__lazyCounters.style++;
  if(node instanceof HTMLScriptElement && node.src.startsWith('data:text/javascript')){{
    globalThis.__lazyCounters.loader++;
    globalThis.__compiledStyleBeforeLoader=getComputedStyle(document.documentElement).getPropertyValue('--compiled-shell-fixture').trim()==='ready';
  }}
  if(node instanceof HTMLScriptElement && node.src.startsWith('blob:'))globalThis.__lazyCounters.script++;
  return appendChild(node);
}};
const finish=passed=>{{
  const body=document.body;
  body.dataset.status=passed?'pass':'fail';
  for(const [key,value] of Object.entries(globalThis.__lazyCounters))body.dataset[key]=String(value);
  body.dataset.unhandled=String(globalThis.__unhandledRejections);
}};
const fail=error=>{{document.body.dataset.status='error';document.body.dataset.message=String(error?.stack||error);}};
"""

        loader_source = site_module._RELEASE_RUNTIME_LOADER_SOURCE
        loader_data_url = "data:text/javascript;base64," + base64.b64encode(
            loader_source.encode("utf-8")
        ).decode("ascii")
        release_boot_source = site_module._WEBGPU_OS_RELEASE_BOOT_SOURCE
        preloaded_style = (
            '<link rel="stylesheet" href="/webgpu-os/style.css">'
            if scenario == "style-preloaded" else ""
        )
        document = f"""<!doctype html>
<meta charset="utf-8">
<base href="/unrelated-document-base/">
<link rel="stylesheet" href="/webgpu-os/bootstrap/boot-surface.css">
{preloaded_style}
<body data-status="pending">
<script>{prelude}</script>
<template id="webgpu-os-compiled-runtime-loader">
<script src="{loader_data_url}" data-runtime-src="runtime.gz" data-asset-base="./assets/"
 data-runtime-base="./" data-integrity="{integrity}"
 data-runtime-bytes="{len(runtime_bytes)}" data-runtime-compressed-bytes="4"></script>
</template>
<script src="/webgpu-os/release-boot.js?test=stable-source-base"></script>
<script>{exercise}</script>
</body>
"""
        document_bytes = document.encode("utf-8")

        class BoundaryHandler(SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=str(ROOT), **kwargs)

            def do_GET(self):
                path = self.path.partition("?")[0]
                if path == "/webgpu-os/style.css":
                    if scenario == "style-rejection":
                        self.send_error(404, "Shell stylesheet deliberately unavailable")
                        return
                    payload = b":root { --compiled-shell-fixture: ready; }"
                    content_type = "text/css; charset=utf-8"
                elif path == "/webgpu-os/release-boot.js":
                    payload = release_boot_source.encode("utf-8")
                    content_type = "text/javascript; charset=utf-8"
                elif path == "/__compiled-runtime-boundary.html":
                    payload = document_bytes
                    content_type = "text/html; charset=utf-8"
                else:
                    return super().do_GET()
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(payload)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, _format, *_args):
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), BoundaryHandler)
        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()
        try:
            with tempfile.TemporaryDirectory(prefix=f"compiled-runtime-{scenario}-") as temporary:
                profile = Path(temporary) / "profile"
                completed = subprocess.run(
                    [
                        str(browser),
                        "--headless=new",
                        "--disable-gpu",
                        "--no-first-run",
                        "--no-default-browser-check",
                        "--log-level=3",
                        "--virtual-time-budget=3000",
                        f"--user-data-dir={profile}",
                        "--dump-dom",
                        f"http://127.0.0.1:{server.server_port}/__compiled-runtime-boundary.html",
                    ],
                    cwd=ROOT,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=45,
                    check=False,
                )
        finally:
            server.shutdown()
            server.server_close()
            server_thread.join(timeout=5)

        self.assertEqual(completed.returncode, 0, completed.stderr[-2000:])
        self.assertRegex(completed.stdout, r'<body data-status="pass"')
        for name, value in expected.items():
            self.assertIn(f'data-{name}="{value}"', completed.stdout)

    def test_shell_assets_cover_all_static_runtime_urls(self):
        with tempfile.TemporaryDirectory() as temporary:
            site = Path(temporary) / "site"
            copied = lay_down_webgpu_os_shell_assets(site, ROOT)

            self.assertEqual(copied, len(WEBGPU_OS_SHELL_ASSET_COPIES))
            for source, destination in WEBGPU_OS_SHELL_ASSET_COPIES:
                self.assertEqual((site / destination).read_bytes(), (ROOT / source).read_bytes())

            deployed = {destination for _, destination in WEBGPU_OS_SHELL_ASSET_COPIES}
            manager_source = (ROOT / "plauna/motion/PageTransitionManager.js").read_text("utf-8")
            for dependency in ("PageTransitionContracts.js", "PageTransitionPresets.js"):
                self.assertIn(f"'./{dependency}'", manager_source)
                self.assertIn(f"plauna/motion/{dependency}", deployed)

            # The zero-build docs viewer imports this module independently of
            # the shell's cross-document manager and the compiled OS bundle.
            viewer_source = (ROOT / "MD/viewer/viewer.js").read_text("utf-8")
            self.assertIn("import('../../plauna/motion/PageTransition.js')", viewer_source)
            self.assertIn("plauna/motion/PageTransition.js", deployed)
            transition_source = (site / "plauna/motion/PageTransition.js").read_text("utf-8")
            self.assertIn("'./PageTransitionPresets.js'", transition_source)
            self.assertIn("plauna/motion/PageTransitionPresets.js", deployed)

    def test_avr_vendor_notices_survive_shell_copy_compaction_and_archive(self):
        from bundler.site_compaction import compact_release_site, verify_site_archives

        required = (
            "vendor/avr8js/0.21.1/LICENSE",
            "vendor/avr8js/0.21.1/upstream/LICENSE",
            "vendor/avr8js/0.21.1/provenance.json",
        )
        originals = {name: (ROOT / name).read_bytes() for name in required}
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            site = directory / "site"
            lay_down_webgpu_os_shell_assets(site, ROOT)
            for name in required:
                self.assertIn((name, name), WEBGPU_OS_SHELL_ASSET_COPIES)
                self.assertNotIn(name, RELEASE_MODULE_WORKER_CLOSURE_PATHS)
                self.assertEqual((site / name).read_bytes(), originals[name])

            compact = compact_release_site(ROOT, site, directory / "upload", max_files=40)
            self.assertTrue(set(required).issubset(verify_site_archives(compact)))
            manifest = json.loads((compact / "site-archive-manifest.json").read_text("utf-8"))
            archive = directory / "site.zip"
            count, _ = site_module.create_release_site_archive(compact, archive, required_paths=required)
            with zipfile.ZipFile(archive) as deployed:
                self.assertEqual(count, len(deployed.namelist()))
                self.assertIsNone(deployed.testzip())
                for name in required:
                    record = manifest["files"][name]
                    member_archive = manifest["archives"][record["archive"]]["path"]
                    with zipfile.ZipFile(io.BytesIO(deployed.read(member_archive))) as members:
                        self.assertEqual(members.read(name), originals[name])
                    self.assertEqual((site / name).read_bytes(), originals[name])
                    self.assertEqual((ROOT / name).read_bytes(), originals[name])

    def test_pwa_laydown_includes_the_complete_stable_bootstrap(self):
        source = ROOT / "webgpu-os"
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "webgpu-os"
            copied = lay_down_webgpu_os_pwa_assets(source, destination)

            self.assertEqual(copied, len(WEBGPU_OS_PWA_ASSET_PATHS))
            self.assertIn("runtime.html", WEBGPU_OS_STABLE_BOOTSTRAP_ASSET_PATHS)
            self.assertTrue({
                "shared/EchoFormProfile.js",
                "shared/EchoForm.js",
                "shared/EchoForm.css",
            }.issubset(WEBGPU_OS_STABLE_BOOTSTRAP_ASSET_PATHS))
            for prefix in (
                "bootstrap/",
                "platform/runtime-host/",
                "platform/network-host/",
                "system-release/",
            ):
                expected = {
                    path.relative_to(source).as_posix()
                    for path in (source / prefix.rstrip("/")).rglob("*")
                    if path.is_file()
                }
                self.assertTrue(expected)
                self.assertTrue(expected.issubset(WEBGPU_OS_STABLE_BOOTSTRAP_ASSET_PATHS))
            for relative_name in WEBGPU_OS_STABLE_BOOTSTRAP_ASSET_PATHS:
                self.assertEqual(
                    (destination / relative_name).read_bytes(),
                    (source / relative_name).read_bytes(),
                )

    def test_first_shard_default_catalogue_urls_are_staged_and_required(self):
        source = ROOT / "webgpu-os"
        app = (source / "apps/the-first-shard/FirstShardApp.js").read_text("utf-8")
        catalog = re.search(r"const CONTENT_MANIFESTS = (?:Object\.freeze\()?\[(.*?)\]", app, re.DOTALL)
        self.assertIsNotNone(catalog, "First Shard runtime content declaration is missing")
        urls = re.findall(r"['\"]([^'\"]+)['\"]", catalog.group(1))
        self.assertTrue(urls)
        paths = ["apps/the-first-shard/" + url.removeprefix("./") for url in urls]
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "webgpu-os"
            lay_down_webgpu_os_runtime_assets(source, destination)
            for relative_name in paths:
                with self.subTest(asset=relative_name):
                    self.assertIn(relative_name, WEBGPU_OS_RUNTIME_ASSET_PATHS)
                    self.assertIn(relative_name, WEBGPU_OS_REQUIRED_DEPLOYMENT_PATHS)
                    self.assertEqual((destination / relative_name).read_bytes(), (source / relative_name).read_bytes())
                    self.assertIsInstance(json.loads((destination / relative_name).read_text("utf-8")), dict)
            (destination / paths[0]).unlink()
            with self.assertRaisesRegex(FileNotFoundError, "package.json"):
                lay_down_webgpu_os_runtime_assets(destination, Path(temporary) / "incomplete-site")

    def test_echo_stylesheet_urls_are_staged_and_required(self):
        source = ROOT / "webgpu-os"
        for module_name in (
            "shared/EchoStatusGlyph.js", "shell/echo-guide/EchoGuidePresence.js",
            "factory/apps/sewing/studio-host.js",
        ):
            with self.subTest(module=module_name):
                module = (source / module_name).read_text("utf-8")
                reference = re.search(r"new URL\(['\"]([^'\"]+\.css)['\"], import\.meta\.url\)", module)
                self.assertIsNotNone(reference, f"{module_name} stylesheet URL is missing")
                relative_name = (Path(module_name).parent / reference.group(1)).as_posix()
                self.assertIn(relative_name, WEBGPU_OS_RUNTIME_ASSET_PATHS)
                self.assertIn(relative_name, WEBGPU_OS_REQUIRED_DEPLOYMENT_PATHS)
                with tempfile.TemporaryDirectory() as temporary:
                    destination = Path(temporary) / "webgpu-os"
                    lay_down_webgpu_os_runtime_assets(source, destination)
                    self.assertEqual((destination / relative_name).read_bytes(), (source / relative_name).read_bytes())
                    (destination / relative_name).unlink()
                    with self.assertRaisesRegex(FileNotFoundError, re.escape(Path(relative_name).name)):
                        lay_down_webgpu_os_runtime_assets(destination, Path(temporary) / "incomplete-site")

    def test_source_city_capture_urls_are_staged_and_checked_against_runtime_pins(self):
        source = ROOT / "webgpu-os"
        catalog = source / "apps/realmforge/virtual-realm/RealmSourceCityCaptureCatalog.js"
        references = re.findall(r"path:\s*['\"]([^'\"]+\.json)['\"]", catalog.read_text("utf-8"))
        paths = {(catalog.parent / path).resolve().relative_to(source).as_posix() for path in references}
        self.assertEqual(paths, set(site_module.REALMFORGE_SOURCE_CITY_CAPTURE_PATHS))
        self.assertTrue(paths.issubset(WEBGPU_OS_REQUIRED_DEPLOYMENT_PATHS))
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "webgpu-os"
            lay_down_webgpu_os_runtime_assets(source, destination)
            self.assertEqual(site_module._validate_realmforge_source_city_captures(destination), len(paths))
            for relative in sorted(paths):
                with self.subTest(capture=relative):
                    path = destination / relative
                    original = path.read_bytes()
                    self.assertEqual(original, (source / relative).read_bytes())
                    path.unlink()
                    with self.assertRaisesRegex(FileNotFoundError, re.escape(path.name)):
                        site_module._validate_realmforge_source_city_captures(destination)
                    # Equal-length valid JSON substitution must fail the hash,
                    # even when existence, JSON parsing and byte count succeed.
                    changed = original.replace(b'"baseline"', b'"tampered"', 1)
                    if changed == original:
                        changed = original.replace(b'"kernel"', b'"forged"', 1)
                    if changed == original:
                        changed = original.replace(b'false', b' true', 1)
                    self.assertNotEqual(changed, original)
                    self.assertEqual(len(changed), len(original))
                    json.loads(changed)
                    path.write_bytes(changed)
                    with self.assertRaisesRegex(ValueError, "capture bytes do not match catalog pin"):
                        site_module._validate_realmforge_source_city_captures(destination)
                    path.write_bytes(original)
            # A supplied source tree owns its pins; using the repository-global
            # catalog here would incorrectly accept this inconsistent source.
            copied_catalog = destination / catalog.relative_to(source)
            copied_catalog.write_text(re.sub(
                r"(byteLength:\s*)(\d+)",
                lambda match: match.group(1) + str(int(match.group(2)) + 1),
                catalog.read_text("utf-8"), count=1,
            ), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "capture bytes do not match catalog pin"):
                lay_down_webgpu_os_runtime_assets(destination, Path(temporary) / "inconsistent-site")

    def test_runtime_url_dependencies_are_copied_byte_for_byte(self):
        source = ROOT / "webgpu-os"
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "webgpu-os"
            pwa_copied = lay_down_webgpu_os_pwa_assets(source, destination)

            copied = lay_down_webgpu_os_runtime_assets(source, destination)
            engine_demo_copied = lay_down_engine_demo_runtime_assets(ROOT, destination)
            self._write_generated_boot_assets(destination)

            self.assertEqual(pwa_copied, len(WEBGPU_OS_PWA_ASSET_PATHS))
            # The standalone guest additionally ships an engine/worker closure.
            self.assertGreater(copied, len(WEBGPU_OS_RUNTIME_ASSET_PATHS))
            self.assertTrue((destination.parent / "engine/media/codecs/CodecWorker.js").is_file())
            self.assertEqual(engine_demo_copied, sum(
                path.is_file() for path in (destination / "assets/engine-demo").rglob("*")
            ))
            self.assertEqual(
                validate_webgpu_os_deployment(destination),
                len(WEBGPU_OS_REQUIRED_DEPLOYMENT_PATHS),
            )
            for relative_name in WEBGPU_OS_PWA_ASSET_PATHS:
                self.assertEqual(
                    (destination / relative_name).read_bytes(),
                    (source / relative_name).read_bytes(),
                )
            for relative_name in WEBGPU_OS_RUNTIME_ASSET_PATHS:
                self.assertEqual(
                    (destination / relative_name).read_bytes(),
                    (source / relative_name).read_bytes(),
                )
                if relative_name.endswith(".json"):
                    self.assertIsNotNone(json.loads((destination / relative_name).read_text("utf-8")))

            worker = "factory/apps/notepad/large-text-index-worker.js"
            self.assertIn(worker, WEBGPU_OS_REQUIRED_DEPLOYMENT_PATHS)

            service_worker_dependency = "kernel/net-safety.js"
            self.assertIn(service_worker_dependency, WEBGPU_OS_RUNTIME_ASSET_PATHS)
            self.assertIn(service_worker_dependency, WEBGPU_OS_REQUIRED_DEPLOYMENT_PATHS)
            self.assertEqual(
                (destination / service_worker_dependency).read_bytes(),
                (source / service_worker_dependency).read_bytes(),
            )

            setup_decorations = (
                "factory/apps/setup-center/assets/setup-realm-orbit-v1.png",
                "factory/apps/setup-center/assets/setup-spark-trail-v1.png",
            )
            for decoration in setup_decorations:
                self.assertIn(decoration, WEBGPU_OS_RUNTIME_ASSET_PATHS)
                self.assertIn(decoration, WEBGPU_OS_REQUIRED_DEPLOYMENT_PATHS)
                self.assertEqual(
                    (destination / decoration).read_bytes(),
                    (source / decoration).read_bytes(),
                )

            bootstrap = (
                "apps/realmforge/release/RealmForgePhase10SourceTimingBootstrap.js"
            )
            self.assertIn(bootstrap, WEBGPU_OS_RUNTIME_ASSET_PATHS)
            self.assertIn(bootstrap, WEBGPU_OS_REQUIRED_DEPLOYMENT_PATHS)
            (destination / bootstrap).unlink()
            with self.assertRaisesRegex(
                FileNotFoundError,
                "RealmForgePhase10SourceTimingBootstrap.js",
            ):
                validate_webgpu_os_deployment(destination)

    def test_service_worker_import_graph_rejects_an_unshipped_module(self):
        source = ROOT / "webgpu-os"
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "webgpu-os"
            lay_down_webgpu_os_pwa_assets(source, destination)
            lay_down_webgpu_os_runtime_assets(source, destination)
            lay_down_engine_demo_runtime_assets(ROOT, destination)
            self._write_generated_boot_assets(destination)
            worker_path = destination / "sw.js"
            worker_path.write_text(
                worker_path.read_text(encoding="utf-8")
                + "\nimport './UnshippedServiceWorkerDependency.js';\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                RuntimeError,
                "UnshippedServiceWorkerDependency.js.*no deployed module",
            ):
                validate_webgpu_os_deployment(destination)

    def test_storage_worker_imports_are_deployed_byte_for_byte_and_required(self):
        source = ROOT / "webgpu-os"
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "webgpu-os"
            lay_down_webgpu_os_pwa_assets(source, destination)
            lay_down_webgpu_os_runtime_assets(source, destination)
            lay_down_engine_demo_runtime_assets(ROOT, destination)
            self._write_generated_boot_assets(destination)

            worker_dependencies = (
                "storage/StorageWorker.js",
                "storage/IncrementalSha256.js",
                "packages/Zip.js",
            )
            for relative_name in worker_dependencies:
                self.assertIn(relative_name, WEBGPU_OS_REQUIRED_DEPLOYMENT_PATHS)
                self.assertEqual(
                    (destination / relative_name).read_bytes(),
                    (source / relative_name).read_bytes(),
                )

            (destination / "storage" / "IncrementalSha256.js").unlink()
            with self.assertRaisesRegex(FileNotFoundError, "IncrementalSha256.js"):
                validate_webgpu_os_deployment(destination)

    def test_storage_worker_import_graph_rejects_an_unshipped_module(self):
        source = ROOT / "webgpu-os"
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "webgpu-os"
            lay_down_webgpu_os_pwa_assets(source, destination)
            lay_down_webgpu_os_runtime_assets(source, destination)
            lay_down_engine_demo_runtime_assets(ROOT, destination)
            self._write_generated_boot_assets(destination)
            worker_path = destination / "storage" / "StorageWorker.js"
            worker_path.write_text(
                worker_path.read_text(encoding="utf-8")
                + "\nimport './UnshippedStorageDependency.js';\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                RuntimeError,
                "UnshippedStorageDependency.js.*no deployed module",
            ):
                validate_webgpu_os_deployment(destination)

    def test_storage_worker_import_graph_rejects_a_missing_transitive_module(self):
        source = ROOT / "webgpu-os"
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "webgpu-os"
            lay_down_webgpu_os_pwa_assets(source, destination)
            lay_down_webgpu_os_runtime_assets(source, destination)
            lay_down_engine_demo_runtime_assets(ROOT, destination)
            self._write_generated_boot_assets(destination)
            (destination.parent / "engine" / "core" / "math" / "BufferMath.js").unlink()

            with self.assertRaisesRegex(
                RuntimeError,
                "BufferMath.js.*no deployed module",
            ):
                validate_webgpu_os_deployment(destination)

    def test_realmforge_generation_worker_closure_is_shipped_without_physics_backend(self):
        from bundler.graph import ModuleGraph

        graph = ModuleGraph(ROOT)
        for root in RELEASE_MODULE_WORKER_ROOT_PATHS:
            graph.walk(root)
        self.assertFalse(graph.errors)
        actual_closure = {Path(path).relative_to(ROOT).as_posix() for path in graph.modules}
        self.assertEqual(actual_closure, set(RELEASE_MODULE_WORKER_CLOSURE_PATHS))
        self.assertEqual(len(RELEASE_MODULE_WORKER_CLOSURE_PATHS), len(actual_closure))
        source = ROOT / "webgpu-os"
        with tempfile.TemporaryDirectory() as temporary:
            site = Path(temporary)
            destination = site / "webgpu-os"
            lay_down_webgpu_os_pwa_assets(source, destination)
            lay_down_webgpu_os_runtime_assets(source, destination)
            lay_down_engine_demo_runtime_assets(ROOT, destination)
            self._write_generated_boot_assets(destination)

            worker = (
                "apps/realmforge/construction/"
                "RealmForgeConstructionGenerationWorker.js"
            )
            self.assertIn(f"webgpu-os/{worker}", RELEASE_MODULE_WORKER_ROOT_PATHS)
            self.assertIn(
                "webgpu-os/apps/realmforge/construction/RealmForgeProceduralHouseWorker.js",
                RELEASE_MODULE_WORKER_ROOT_PATHS,
            )
            reviewed_rig_helpers = {
                "engine/sim/physics/rig/ActiveRigSchema.js",
                "engine/sim/physics/rig/CharacterPhysicsAssetAdapter.js",
                "engine/sim/physics/rig/RetargetGraph.js",
            }
            self.assertEqual(
                {
                    path for path in RELEASE_MODULE_WORKER_CLOSURE_PATHS
                    if path.startswith("engine/sim/physics/")
                },
                reviewed_rig_helpers,
            )
            self.assertEqual(
                REALMFORGE_CONSTRUCTION_GENERATION_WORKER_OS_MODULE_PATHS[0],
                worker,
            )
            self.assertIn(
                "apps/realmforge/packages/RealmForgePackageContracts.js",
                REALMFORGE_CONSTRUCTION_GENERATION_WORKER_OS_MODULE_PATHS,
            )
            self.assertIn(
                "apps/realmforge/document/hash/RealmForgeContentHash.js",
                REALMFORGE_CONSTRUCTION_GENERATION_WORKER_OS_MODULE_PATHS,
            )
            for module in (
                "RealmForgeBuildFamilies.js",
                "RealmForgeBuildTextRecovery.js",
                "RealmForgeBuildSpellingGuards.js",
                "RealmForgeConstructionFinish.js",
                "RealmForgeHomeComposition.js",
                "RealmForgeRoomComposition.js",
                "RealmForgeHouseRoomComposition.js",
                "RealmForgeFurnitureComponents.js",
                "RealmForgeFixtureComponents.js",
                "RealmForgePipeGeometry.js",
                "RealmForgeSeatAnchors.js",
                "RealmForgeHouseWiring.js",
                "RealmForgeHouseWiringCircuit.js",
                "RealmForgeHouseWiringLayout.js",
                "RealmForgeHouseWiringProtection.js",
                "RealmForgeLightingOptions.js",
                "RealmForgeCeilingLighting.js",
                "RealmForgeHouseAppearanceText.js",
            ):
                self.assertIn(
                    f"apps/realmforge/construction/{module}",
                    REALMFORGE_CONSTRUCTION_GENERATION_WORKER_OS_MODULE_PATHS,
                )
            expected_pattern_modules = {
                "apps/realmforge/construction/patterns/index.js",
                "apps/realmforge/construction/patterns/PatternExpansionCache.js",
                "apps/realmforge/construction/patterns/BondPattern.js",
                "apps/realmforge/construction/patterns/StudWallPattern.js",
                "apps/realmforge/construction/patterns/JoistGridPattern.js",
                "apps/realmforge/construction/patterns/RafterRunPattern.js",
                "apps/realmforge/construction/patterns/SheetGridPattern.js",
                "apps/realmforge/construction/patterns/BeamGridPattern.js",
                "apps/realmforge/construction/patterns/PatternPrimitives.js",
                "apps/realmforge/construction/patterns/PatternRectangles.js",
            }
            self.assertEqual(
                {
                    path
                    for path in REALMFORGE_CONSTRUCTION_GENERATION_WORKER_OS_MODULE_PATHS
                    if path.startswith("apps/realmforge/construction/patterns/")
                },
                expected_pattern_modules,
            )
            for relative_name in REALMFORGE_CONSTRUCTION_GENERATION_WORKER_OS_MODULE_PATHS:
                self.assertIn(relative_name, WEBGPU_OS_RUNTIME_ASSET_PATHS)
                self.assertIn(relative_name, WEBGPU_OS_REQUIRED_DEPLOYMENT_PATHS)
                self.assertEqual(
                    (destination / relative_name).read_bytes(),
                    (source / relative_name).read_bytes(),
                )

            engine_dependencies = (
                "engine/state/util/canonical.js",
                "engine/render/geometry/Profile2D.js",
                "engine/render/geometry/ProfileSolidGeometry.js",
                "engine/assets/material/composite/ConstructionCompositeMaterialCatalog.js",
                "engine/assets/material/composite/CompositeMaterialContracts.js",
                "engine/assets/material/EngineMaterial.js",
                "engine/core/math/ChecksumMath.js",
                "engine/core/math/BufferMath.js",
                "engine/assets/material/procedural/ProceduralPbrTexture.js",
                "engine/state/entity/EntityRegistry.js",
                "engine/state/entity/SchemaRegistry.js",
            )
            for relative_name in engine_dependencies:
                self.assertEqual(
                    (site / relative_name).read_bytes(),
                    (ROOT / relative_name).read_bytes(),
                )
            for relative_name in REALMFORGE_CONSTRUCTION_GENERATION_WORKER_VENDOR_MODULE_PATHS:
                self.assertIn((relative_name, relative_name), WEBGPU_OS_SHELL_ASSET_COPIES)
                self.assertEqual(
                    (site / relative_name).read_bytes(),
                    (ROOT / relative_name).read_bytes(),
                )
            # Policy documentation may mention PhysX. Only executable import
            # edges and the exact deployed closure can pull its runtime in.
            from bundler.parser import parse_module
            for relative_name in REALMFORGE_CONSTRUCTION_GENERATION_WORKER_OS_MODULE_PATHS:
                imports, exports = parse_module((destination / relative_name).read_text(encoding="utf-8"))
                specs = [item.spec for item in imports if item.spec]
                specs.extend(item.spec for item in exports if item.reexport and item.spec)
                for spec in specs:
                    resolved = graph.resolve_import(source / relative_name, spec)
                    self.assertIsNotNone(resolved, (relative_name, spec))
                    repository_path = Path(resolved).relative_to(ROOT).as_posix()
                    if repository_path.startswith("engine/sim/physics/"):
                        self.assertIn(repository_path, reviewed_rig_helpers, relative_name)
                    self.assertNotIn("RealmForgeConstructionPresetPhysics", spec, relative_name)
            validate_webgpu_os_deployment(destination)

    def test_house_appearance_worker_sidecars_are_exact_and_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            site = Path(temporary)
            site_module._copy_release_asset_manifest(site, ROOT,
                [(path, path) for path in RELEASE_MODULE_WORKER_CLOSURE_PATHS])
            options = {"follow_imports": True,
                "entry_relative_paths": RELEASE_MODULE_WORKER_ROOT_PATHS,
                "expected_relative_paths": RELEASE_MODULE_WORKER_CLOSURE_PATHS}
            edges = site_module._validate_release_module_graph(site, ".", "house appearance workers", **options)
            self.assertGreater(edges, len(RELEASE_MODULE_WORKER_CLOSURE_PATHS))
            for relative in (
                "webgpu-os/apps/realmforge/construction/RealmForgeHouseAppearanceText.js",
                "webgpu-os/apps/realmforge/material/studio/RealmForgeTextureRecipes.js",
                "webgpu-os/apps/realmforge/material/studio/RealmForgeHouseAppearance.js",
                "engine/assets/material/procedural/ProceduralPbrTexture.js",
                "engine/state/entity/SchemaRegistry.js",
            ):
                with self.subTest(module=relative):
                    path = site / relative
                    payload = path.read_bytes()
                    path.unlink()
                    try:
                        with self.assertRaisesRegex(RuntimeError,
                                re.escape(path.name) + ".*no deployed module"):
                            site_module._validate_release_module_graph(site, ".", "house appearance workers", **options)
                    finally:
                        path.write_bytes(payload)

    def test_avr_worker_sidecars_are_complete_and_fail_closed(self):
        avr_modules = tuple(
            f"webgpu-os/apps/realmforge/modeler/electronics/{name}"
            for name in (
                "RealmForgeAvrRuntime.js",
                "RealmForgeMicrocontrollerBoard.js",
                "RealmForgeMicrocontrollerProfiles.js",
            )
        )
        with tempfile.TemporaryDirectory() as temporary:
            site = Path(temporary)
            site_module._copy_release_asset_manifest(site, ROOT,
                [(path, path) for path in RELEASE_MODULE_WORKER_CLOSURE_PATHS])
            options = {"follow_imports": True,
                "entry_relative_paths": RELEASE_MODULE_WORKER_ROOT_PATHS,
                "expected_relative_paths": RELEASE_MODULE_WORKER_CLOSURE_PATHS}
            edges = site_module._validate_release_module_graph(site, ".", "AVR workers", **options)
            self.assertGreater(edges, len(RELEASE_MODULE_WORKER_CLOSURE_PATHS))
            for relative in (*avr_modules, *REALMFORGE_CONSTRUCTION_GENERATION_WORKER_VENDOR_MODULE_PATHS):
                with self.subTest(module=relative):
                    path = site / relative
                    payload = path.read_bytes()
                    self.assertEqual(payload, (ROOT / relative).read_bytes())
                    path.unlink()
                    try:
                        with self.assertRaisesRegex(RuntimeError,
                                re.escape(path.name) + ".*no deployed module"):
                            site_module._validate_release_module_graph(site, ".", "AVR workers", **options)
                    finally:
                        path.write_bytes(payload)

            vendor_index = site / REALMFORGE_CONSTRUCTION_GENERATION_WORKER_VENDOR_MODULE_PATHS[0]
            original = vendor_index.read_bytes()
            vendor_index.write_bytes(b"<!doctype html><html>SPA fallback</html>\n")
            with self.assertRaisesRegex(RuntimeError, "resolves to HTML"):
                site_module._validate_release_module_graph(site, ".", "AVR workers", **options)
            vendor_index.write_bytes(original + b"\nexport * from '../../../../../Outside.js';\n")
            with self.assertRaisesRegex(RuntimeError, "escapes the release site"):
                site_module._validate_release_module_graph(site, ".", "AVR workers", **options)

    def test_realmforge_generation_worker_missing_transitive_module_fails_closed(self):
        source = ROOT / "webgpu-os"
        with tempfile.TemporaryDirectory() as temporary:
            site = Path(temporary)
            destination = site / "webgpu-os"
            lay_down_webgpu_os_pwa_assets(source, destination)
            lay_down_webgpu_os_runtime_assets(source, destination)
            lay_down_engine_demo_runtime_assets(ROOT, destination)
            self._write_generated_boot_assets(destination)
            missing_paths = (
                "engine/assets/material/EngineMaterial.js",
                "engine/render/geometry/Profile2D.js",
                "engine/render/geometry/ProfileSolidGeometry.js",
                "engine/render/geometry/PolyhedralCsg.js",
                "engine/sim/electrical/ElectricalNetCompiler.js",
                "webgpu-os/apps/realmforge/material/RealmForgeMaterialDerivations.js",
                "webgpu-os/apps/realmforge/material/RealmForgeMaterialResolver.js",
                "webgpu-os/apps/realmforge/material/RealmForgeMirrorSurface.js",
                "webgpu-os/apps/realmforge/material/RealmForgeWindowSurface.js",
                "webgpu-os/apps/realmforge/modeler/electrical/RealmForgeElectricalDocumentProjection.js",
                "webgpu-os/apps/realmforge/modeler/electronics/RealmForgeControlBoardAssemblies.js",
                *(f"webgpu-os/apps/realmforge/construction/{name}" for name in (
                    "RealmForgeBuildFamilies.js",
                    "RealmForgeBuildTextRecovery.js",
                    "RealmForgeBuildSpellingGuards.js",
                    "RealmForgeConstructionFinish.js",
                    "RealmForgeHomeComposition.js",
                    "RealmForgeRoomComposition.js",
                    "RealmForgeHouseRoomComposition.js",
                    "RealmForgeFurnitureComponents.js",
                    "RealmForgeFixtureComponents.js",
                    "RealmForgePipeGeometry.js",
                    "RealmForgeSeatAnchors.js",
                    "RealmForgeHouseServices.js",
                    "RealmForgeHouseWiring.js",
                    "RealmForgeHouseWiringCircuit.js",
                    "RealmForgeHouseWiringLayout.js",
                    "RealmForgeHouseWiringProtection.js",
                    "RealmForgeLightingOptions.js",
                    "RealmForgeCeilingLighting.js",
                    "RealmForgeGeneratedMechanisms.js",
                    "RealmForgeDoorControl.js",
                    "RealmForgeDoorControlOptions.js",
                    "RealmForgeDeckAssembly.js",
                    "RealmForgeHomeFeatureText.js",
                    "RealmForgeHouseMirrorOptions.js",
                    "RealmForgeHouseMirrors.js",
                    "RealmForgeHouseOutdoor.js",
                    "RealmForgeHouseOutdoorLayout.js",
                    "RealmForgeHouseWindowAssemblies.js",
                    "RealmForgeHouseWindowSkylights.js",
                    "RealmForgeOutdoorOptions.js",
                    "RealmForgeWindowLayout.js",
                    "RealmForgeWindowMaterials.js",
                    "runtime/ConstructionWindowHardwareRuntime.js",
                )),
            )
            for relative_path in missing_paths:
                with self.subTest(module=relative_path):
                    missing = site / relative_path
                    original = missing.read_bytes()
                    missing.unlink()
                    try:
                        required_os_asset = relative_path.startswith("webgpu-os/")
                        with self.assertRaisesRegex(
                            FileNotFoundError if required_os_asset else RuntimeError,
                            (r"WebGPU OS deployment contract is incomplete:[\s\S]*"
                             + re.escape(missing.name)) if required_os_asset
                            else f"{re.escape(missing.name)}.*no deployed module",
                        ):
                            validate_webgpu_os_deployment(destination)
                    finally:
                        missing.write_bytes(original)

    def test_realmforge_generation_worker_rejects_an_unreviewed_present_module(self):
        source = ROOT / "webgpu-os"
        with tempfile.TemporaryDirectory() as temporary:
            site = Path(temporary)
            destination = site / "webgpu-os"
            lay_down_webgpu_os_pwa_assets(source, destination)
            lay_down_webgpu_os_runtime_assets(source, destination)
            lay_down_engine_demo_runtime_assets(ROOT, destination)
            self._write_generated_boot_assets(destination)
            construction = destination / "apps" / "realmforge" / "construction"
            extra = construction / "UnreviewedWorkerDependency.js"
            extra.write_text("export default true;\n", encoding="utf-8")
            composition = construction / "RealmForgeHomeComposition.js"
            composition.write_text(
                composition.read_text(encoding="utf-8")
                + "\nimport './UnreviewedWorkerDependency.js';\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                RuntimeError,
                "audited deployment inventory.*unexpected",
            ):
                validate_webgpu_os_deployment(destination)

    def test_engine_demo_runtime_is_exact_verified_flat_template_kit(self):
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "webgpu-os"
            copied = lay_down_engine_demo_runtime_assets(ROOT, destination)
            deployed_root = destination / "assets" / "engine-demo"

            self.assertEqual(copied, sum(path.is_file() for path in deployed_root.rglob('*')))
            self.assertEqual(
                sorted(path.name for path in deployed_root.iterdir() if path.is_file()),
                sorted([
                    *(physical.name for _, name in ENGINE_DEMO_RUNTIME_ASSET_COPIES
                      for physical in transport_paths(deployed_root / name)),
                    ENGINE_DEMO_RUNTIME_KIT_MANIFEST,
                ]),
            )
            for source_name, deployed_name in ENGINE_DEMO_RUNTIME_ASSET_COPIES:
                self.assertEqual(
                    read_transport_file(deployed_root / deployed_name),
                    (ROOT / source_name).read_bytes(),
                )
                self.assertIn(
                    f"assets/engine-demo/{deployed_name}",
                    ENGINE_DEMO_RUNTIME_DEPLOYMENT_PATHS,
                )
            kit_manifest = json.loads(
                (deployed_root / ENGINE_DEMO_RUNTIME_KIT_MANIFEST).read_text("utf-8")
            )
            self.assertEqual(
                (deployed_root / ENGINE_DEMO_RUNTIME_KIT_MANIFEST).read_bytes(),
                (
                    ROOT
                    / "Template"
                    / "assets"
                    / ENGINE_DEMO_RUNTIME_KIT_MANIFEST
                ).read_bytes(),
            )
            self.assertEqual(kit_manifest["format"], "particle-engine-demo-runtime-kit/v1")
            self.assertEqual(kit_manifest["profile"], "particle-engine-v1")
            self.assertEqual(kit_manifest["kind"], "runtime-only")
            self.assertEqual(len(kit_manifest["files"]), 7)

            starter = destination / ENGINE_DEMO_STARTER_ARCHIVE_PATH
            self.assertTrue(all(path.stat().st_size <= 25 * 1024 * 1024 for path in transport_paths(starter)))
            with zipfile.ZipFile(io.BytesIO(read_transport_file(starter)), "r") as archive:
                names = archive.namelist()
                self.assertEqual(len(names), len(set(names)))
                self.assertEqual(names, sorted(names))
                self.assertIn("index.html", names)
                self.assertIn("styles.css", names)
                self.assertIn("app.js", names)
                self.assertIn("dodad.behavior.json", names)
                self.assertIn("source/index.html", names)
                self.assertIn("engine-demo.runtime-kit.json", names)
                self.assertIn("engine-demo.starter.json", names)
                self.assertIn("engine-demo-public-api.js", names)
                self.assertIn("particle-platform.min.js.gz", names)
                self.assertNotIn("behavior.manifest.json", names)
                index = archive.read("index.html").decode("utf-8")
                source_index = archive.read("source/index.html").decode("utf-8")
                membrane_position = index.index("engine-demo-public-api.js")
                loader_position = index.index("release-runtime-loader.js")
                app_position = index.index('<script src="app.js"></script>')
                self.assertLess(membrane_position, loader_position)
                self.assertLess(loader_position, app_position)
                self.assertIn(
                    f'http-equiv="Content-Security-Policy" content="{_ENGINE_DEMO_STARTER_CSP}"',
                    index,
                )
                self.assertNotIn("'unsafe-inline'", index)
                self.assertNotIn("'unsafe-eval'", index)
                self.assertNotIn("Content-Security-Policy", source_index)
                self.assertEqual(archive.read("app.js"), archive.read("source/app.js"))
                self.assertEqual(archive.read("styles.css"), archive.read("source/styles.css"))
                self.assertEqual(
                    archive.read("dodad.behavior.json"),
                    archive.read("source/dodad.behavior.json"),
                )
                self.assertEqual(
                    archive.read("engine-demo-public-api.js").decode("utf-8"),
                    _engine_demo_public_api_membrane_source(),
                )

            (deployed_root / "stale-runtime.js").write_text(
                "stale", encoding="utf-8"
            )
            lay_down_engine_demo_runtime_assets(ROOT, destination)
            self.assertFalse((deployed_root / "stale-runtime.js").exists())

    def test_assets_only_sync_preserves_inert_html_and_other_runtime_assets(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "repo"
            root.mkdir()
            _copy_coherent_engine_demo_template_fixture(root)
            release, manifest, _, changed_runtime = _write_changed_platform_release(root)
            consumer = root / "tests"
            assets = consumer / "assets"
            assets.mkdir(parents=True)
            index = consumer / "index.html"
            html = b'<!doctype html>\r\n<title>Source-driven tests</title>\r\n'
            index.write_bytes(html)
            preserved = {
                assets / "particle-engine.min.js": b"engine fixture generation",
                assets / "particle-os.min.js.gz": b"OS fixture generation",
            }
            for path, payload in preserved.items():
                path.write_bytes(payload)

            with self.assertRaisesRegex(RuntimeError, "Expected one configured runtime loader"):
                sync_release_runtime_consumer(consumer, release, manifest)
            self.assertFalse((assets / "particle-platform.min.js.gz").exists())
            with self.assertRaisesRegex(ValueError, "cannot update a bootstrap"):
                sync_release_runtime_consumer(
                    consumer, release, manifest, assets_only=True, update_bootstrap=True,
                )
            receipt = sync_release_runtime_consumer(
                consumer, release, manifest, assets_only=True,
            )
            self.assertTrue(receipt["assets_only"])
            self.assertFalse(receipt["bootstrap_updated"])
            self.assertEqual(index.read_bytes(), html)
            self.assertEqual((assets / "particle-platform.min.js.gz").read_bytes(), changed_runtime)
            self.assertEqual(
                (assets / "particle-platform.manifest.json").read_bytes(),
                (release / "particle-platform.manifest.json").read_bytes(),
            )
            for record in manifest["physicsAssets"]:
                self.assertEqual(
                    (consumer / record["path"]).read_bytes(),
                    (release / record["path"]).read_bytes(),
                )
            for path, payload in preserved.items():
                self.assertEqual(path.read_bytes(), payload)

    def test_template_sync_keeps_runtime_kit_coherent_for_next_laydown(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "repo"
            root.mkdir()
            source_files = _copy_coherent_engine_demo_template_fixture(root)
            kit_path = (
                root / "Template" / "assets" / ENGINE_DEMO_RUNTIME_KIT_MANIFEST
            )
            old_kit = kit_path.read_bytes()
            destination = root / "deployment" / "webgpu-os"

            first_count = lay_down_engine_demo_runtime_assets(root, destination)
            release, manifest, original_runtime, changed_runtime = (
                _write_changed_platform_release(root)
            )
            # A renamed runtime has no previous destination on its first sync.
            (root / "Template/assets/physx-pe.wasm").unlink()
            receipt = sync_release_runtime_consumer(
                root / "Template",
                release,
                manifest,
                os_base="./",
                update_bootstrap=True,
                engine_demo_root=root,
            )

            rebound_sources = _engine_demo_runtime_source_files(root)
            rebound_kit = kit_path.read_bytes()
            self.assertNotEqual(rebound_kit, old_kit)
            self.assertEqual(
                rebound_kit,
                _engine_demo_runtime_kit_manifest_bytes(rebound_sources),
            )
            kit = json.loads(rebound_kit)
            self.assertEqual(
                [entry["path"] for entry in kit["files"]],
                [name for _, name in ENGINE_DEMO_RUNTIME_ASSET_COPIES],
            )
            for entry in kit["files"]:
                source = rebound_sources[entry["path"]]
                self.assertEqual(entry["bytes"], source.stat().st_size)
                self.assertEqual(entry["sha256"], hashlib.sha256(source.read_bytes()).hexdigest())
            self.assertEqual(
                receipt["engine_demo_runtime_kit_sha256"],
                hashlib.sha256(rebound_kit).hexdigest(),
            )
            self.assertEqual(
                receipt["engine_demo_runtime_kit_files"],
                len(ENGINE_DEMO_RUNTIME_ASSET_COPIES),
            )

            second_count = lay_down_engine_demo_runtime_assets(root, destination)
            deployed_root = destination / "assets" / "engine-demo"
            self.assertEqual(first_count, second_count)
            self.assertEqual(
                read_transport_file(deployed_root / "particle-platform.min.js.gz"),
                changed_runtime,
            )
            self.assertNotEqual(original_runtime, changed_runtime)
            for name in (
                "particle-platform.manifest.json",
                "particle-platform.provenance.json",
                ENGINE_DEMO_RUNTIME_KIT_MANIFEST,
            ):
                self.assertEqual(
                    (deployed_root / name).read_bytes(),
                    (root / "Template" / "assets" / name).read_bytes(),
                )
            self.assertTrue(all(path.is_file() for path in transport_paths(destination / ENGINE_DEMO_STARTER_ARCHIVE_PATH)))
            self.assertFalse(
                list((root / "Template" / "assets").glob("*.candidate"))
            )

    def test_template_sync_rolls_back_every_managed_file_on_late_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "repo"
            root.mkdir()
            _copy_coherent_engine_demo_template_fixture(root)
            release, manifest, _, _ = _write_changed_platform_release(root)
            template = root / "Template"
            managed_paths = (
                template / "assets" / "particle-platform.min.js.gz",
                template / "assets" / "release-runtime-loader.js",
                template / "assets" / "particle-platform.manifest.json",
                template / "assets" / "particle-platform.provenance.json",
                template / "assets" / "release-consumer-bootstrap.js",
                template / "index.html",
                template / "assets" / ENGINE_DEMO_RUNTIME_KIT_MANIFEST,
            )
            before = {
                path: path.read_bytes() if path.is_file() else None
                for path in managed_paths
            }
            original_write = site_module._write_bytes_atomic
            failure_injected = False

            def fail_kit_commit_once(destination, payload):
                nonlocal failure_injected
                if (
                    Path(destination).name == ENGINE_DEMO_RUNTIME_KIT_MANIFEST
                    and not failure_injected
                ):
                    failure_injected = True
                    raise OSError("injected runtime-kit commit failure")
                return original_write(destination, payload)

            with mock.patch(
                "bundler.site._write_bytes_atomic",
                side_effect=fail_kit_commit_once,
            ):
                with self.assertRaisesRegex(
                    OSError,
                    "injected runtime-kit commit failure",
                ):
                    sync_release_runtime_consumer(
                        template,
                        release,
                        manifest,
                        os_base="./",
                        update_bootstrap=True,
                        engine_demo_root=root,
                    )

            self.assertTrue(failure_injected)
            for path, payload in before.items():
                self.assertEqual(
                    path.read_bytes() if path.is_file() else None,
                    payload,
                )
            self.assertFalse(list((template / "assets").glob("*.candidate")))

    def test_engine_demo_starter_zip_is_byte_reproducible(self):
        with tempfile.TemporaryDirectory() as first_temporary, tempfile.TemporaryDirectory() as second_temporary:
            first = Path(first_temporary) / "webgpu-os"
            second = Path(second_temporary) / "webgpu-os"
            lay_down_engine_demo_runtime_assets(ROOT, first)
            lay_down_engine_demo_runtime_assets(ROOT, second)
            self.assertEqual(
                read_transport_file(first / ENGINE_DEMO_STARTER_ARCHIVE_PATH),
                read_transport_file(second / ENGINE_DEMO_STARTER_ARCHIVE_PATH),
            )

    def test_engine_demo_starter_membrane_is_byte_identical_to_ai_echo_export(self):
        javascript_names, javascript_membrane = (
            _javascript_engine_demo_membrane_contract()
        )
        self.assertEqual(javascript_names, _ENGINE_DEMO_PUBLIC_API_NAMES)
        self.assertEqual(
            _engine_demo_public_api_membrane_source(),
            javascript_membrane,
        )

    def test_engine_demo_starter_membrane_removes_private_globals_in_browser(self):
        browser = _find_browser()
        if browser is None:
            self.skipTest("Chrome, Edge, or Chromium is required for the membrane smoke")

        names_json = json.dumps(
            list(_ENGINE_DEMO_PUBLIC_API_NAMES),
            ensure_ascii=True,
            separators=(",", ":"),
        )
        document = """<!doctype html>
<meta charset="utf-8">
<body data-status="pending">
<script>__MEMBRANE__</script>
<script>
const publicNames=__PUBLIC_NAMES__;
const runtime=Object.create(null);
for(const name of publicNames)runtime[name]=()=>name;
runtime.requireModule=()=>({private:true});
runtime.__modules={private:true};
globalThis.PE=runtime;
globalThis.ParticleEngine=runtime;
globalThis.WebGPUOS={private:true};
globalThis.__OS_BUNDLED_APPS__={private:true};
globalThis.LEAKED_RUNTIME_AUTHORITY={private:true};
const poisonedFetch=()=>Promise.reject(new Error('private runtime fetch'));
poisonedFetch.privateRuntime=true;
globalThis.fetch=poisonedFetch;
globalThis.__PE_RUNTIME_READY=Promise.resolve(runtime);
globalThis.__PE_RUNTIME_READY.then(api=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'__PE_RUNTIME_READY');
  const privateGlobals=['PE','ParticleEngine','WebGPUOS','__OS_BUNDLED_APPS__','LEAKED_RUNTIME_AUTHORITY'];
  const passed=Object.getPrototypeOf(api)===null
    && Object.isFrozen(api)
    && publicNames.every(name=>typeof api[name]==='function')
    && api.requireModule===undefined
    && api.__modules===undefined
    && privateGlobals.every(name=>!Object.hasOwn(globalThis,name))
    && globalThis.fetch.privateRuntime!==true
    && descriptor?.writable===false
    && descriptor?.configurable===false;
  document.body.dataset.status=passed?'pass':'fail';
},error=>{
  document.body.dataset.status='error';
  document.body.dataset.message=String(error?.message||error);
});
</script>
</body>
""".replace(
            "__MEMBRANE__",
            _engine_demo_public_api_membrane_source(),
        ).replace("__PUBLIC_NAMES__", names_json)

        with tempfile.TemporaryDirectory(prefix="engine-demo-membrane-browser-") as temporary:
            temporary_path = Path(temporary)
            page = temporary_path / "membrane.html"
            profile = temporary_path / "profile"
            page.write_text(document, encoding="utf-8", newline="\n")
            completed = subprocess.run(
                [
                    str(browser),
                    "--headless=new",
                    "--disable-gpu",
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--log-level=3",
                    "--virtual-time-budget=1000",
                    f"--user-data-dir={profile}",
                    "--dump-dom",
                    page.as_uri(),
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=45,
                check=False,
            )

        self.assertEqual(completed.returncode, 0, completed.stderr[-2000:])
        self.assertRegex(completed.stdout, r'<body data-status="pass">')

    def test_engine_demo_runtime_manifest_tamper_fails_deployment_validation(self):
        source = ROOT / "webgpu-os"
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "webgpu-os"
            lay_down_webgpu_os_pwa_assets(source, destination)
            lay_down_webgpu_os_runtime_assets(source, destination)
            lay_down_engine_demo_runtime_assets(ROOT, destination)
            self._write_generated_boot_assets(destination)
            manifest_path = (
                destination
                / "assets"
                / "engine-demo"
                / "particle-platform.manifest.json"
            )
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["post_build_verification"]["static_registry_verified"] = False
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "does not bind"):
                validate_webgpu_os_deployment(destination)

    def test_engine_demo_loader_tamper_fails_deployment_validation(self):
        source = ROOT / "webgpu-os"
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "webgpu-os"
            lay_down_webgpu_os_pwa_assets(source, destination)
            lay_down_webgpu_os_runtime_assets(source, destination)
            lay_down_engine_demo_runtime_assets(ROOT, destination)
            self._write_generated_boot_assets(destination)
            loader_path = (
                destination / "assets" / "engine-demo" / "release-runtime-loader.js"
            )
            loader_path.write_bytes(loader_path.read_bytes() + b"\n// tampered\n")

            with self.assertRaisesRegex(ValueError, "does not bind"):
                validate_webgpu_os_deployment(destination)

    def test_engine_demo_runtime_kit_inventory_tamper_fails_deployment_validation(self):
        source = ROOT / "webgpu-os"
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "webgpu-os"
            lay_down_webgpu_os_pwa_assets(source, destination)
            lay_down_webgpu_os_runtime_assets(source, destination)
            lay_down_engine_demo_runtime_assets(ROOT, destination)
            self._write_generated_boot_assets(destination)
            kit_path = (
                destination
                / "assets"
                / "engine-demo"
                / ENGINE_DEMO_RUNTIME_KIT_MANIFEST
            )
            kit = json.loads(kit_path.read_text(encoding="utf-8"))
            kit["files"][0]["sha256"] = "0" * 64
            kit_path.write_text(json.dumps(kit), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "does not bind"):
                validate_webgpu_os_deployment(destination)

    def test_engine_demo_starter_archive_tamper_fails_deployment_validation(self):
        source = ROOT / "webgpu-os"
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "webgpu-os"
            lay_down_webgpu_os_pwa_assets(source, destination)
            lay_down_webgpu_os_runtime_assets(source, destination)
            lay_down_engine_demo_runtime_assets(ROOT, destination)
            self._write_generated_boot_assets(destination)
            archive_path = destination / ENGINE_DEMO_STARTER_ARCHIVE_PATH
            transport_paths(archive_path)[-1].write_bytes(b"not-a-zip")

            with self.assertRaisesRegex(ValueError, "archive byte mismatch|unexpected members|Invalid|byte count|SHA-256"):
                validate_webgpu_os_deployment(destination)

    def test_missing_runtime_dependency_fails_the_build(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(FileNotFoundError, "StorageWorker.js"):
                lay_down_webgpu_os_runtime_assets(root / "source", root / "site")

    def test_invalid_deployed_manifest_fails_before_publish(self):
        source = ROOT / "webgpu-os"
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "webgpu-os"
            lay_down_webgpu_os_pwa_assets(source, destination)
            lay_down_webgpu_os_runtime_assets(source, destination)
            lay_down_engine_demo_runtime_assets(ROOT, destination)
            self._write_generated_boot_assets(destination)
            (destination / "manifest.webmanifest").write_text("<!doctype html>", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "manifest.webmanifest"):
                validate_webgpu_os_deployment(destination)

    def test_platform_launcher_ships_the_complete_os_deployment_contract(self):
        with tempfile.TemporaryDirectory() as temporary:
            site = Path(temporary) / "site"
            written = _write_platform_os_launcher(
                site,
                ROOT,
                "particle-platform",
            )
            destination = site / "webgpu-os"

            self.assertGreaterEqual(
                written,
                len(WEBGPU_OS_REQUIRED_DEPLOYMENT_PATHS) + 1,
            )
            self.assertEqual(
                validate_webgpu_os_deployment(destination),
                len(WEBGPU_OS_REQUIRED_DEPLOYMENT_PATHS),
            )
            launcher = (destination / "index.html").read_text(encoding="utf-8")
            runtime_token = _release_runtime_cache_token(
                ROOT / "tests" / "assets" / "particle-platform.min.js.gz",
                json.loads((ROOT / "tests/assets/particle-platform.manifest.json").read_text(
                    encoding="utf-8"
                )).get("compressed_artifact_parts", {}).get("particle-platform.min.js.gz"),
            )
            self.assertIn("particle-platform.min.js.gz", launcher)
            self.assertIn(f"?v={runtime_token}", launcher)
            self.assertIn('src="./assets/release-runtime-loader.js?v=', launcher)
            self.assertIn('src="./release-boot.js?v=', launcher)
            self.assertIn('data-os-base="./"', launcher)
            self.assertIn('<template id="webgpu-os-compiled-runtime-loader">', launcher)
            self.assertRegex(launcher, r'data-integrity="sha384-[A-Za-z0-9+/]{64}"')
            self.assertNotIn("DecompressionStream", launcher)
            self.assertNotIn("<script>", launcher)
            release_boot = (destination / "release-boot.js").read_text(encoding="utf-8")
            self.assertEqual(
                (destination / "style.css").read_bytes(),
                (ROOT / "webgpu-os" / "style.css").read_bytes(),
            )
            self.assertIn("__particleStableBootstrapOptions", release_boot)
            self.assertIn("legacyRuntimeLoader", release_boot)
            self.assertIn("webgpu-os-compiled-runtime-loader", release_boot)
            self.assertIn("if (runtimeLoad) return runtimeLoad", release_boot)
            self.assertIn("if (compiledBoot) return compiledBoot", release_boot)
            self.assertIn("await api.bootWebGpuOS({ echoAvatarRuntimeContext })", release_boot)
            template_start = launcher.index('<template id="webgpu-os-compiled-runtime-loader">')
            template_end = launcher.index("</template>", template_start)
            self.assertLess(template_start, launcher.index('src="./assets/release-runtime-loader.js?v='))
            self.assertLess(launcher.index('src="./assets/release-runtime-loader.js?v='), template_end)
            self.assertLess(template_end, launcher.index('src="./release-boot.js?v='))
            self.assertLess(
                launcher.index('src="./release-boot.js?v='),
                launcher.index('src="bootstrap/boot.js"'),
            )
            self.assertNotIn("rawFallback", launcher)
            service_worker = (destination / "sw.js").read_text(encoding="utf-8")
            self.assertNotIn("particle-platform.min.js.gz", service_worker)
            self.assertNotIn("particle-os.min.js.gz", service_worker)
            bootstrap = (
                "apps/realmforge/release/RealmForgePhase10SourceTimingBootstrap.js"
            )
            self.assertIn(bootstrap, service_worker)
            self.assertEqual(
                (destination / bootstrap).read_bytes(),
                (ROOT / "webgpu-os" / bootstrap).read_bytes(),
            )
            self.assertIn("/webgpu-os/open/app/*", (site / "_redirects").read_text(encoding="utf-8"))
            self.assertIn("Cross-Origin-Embedder-Policy", (site / "_headers").read_text(encoding="utf-8"))
            privacy = (destination / "companion-privacy.html").read_text(encoding="utf-8")
            self.assertIn("WebGPU OS Companion Privacy Policy", privacy)
            self.assertNotIn("User Scripts", privacy)
            guest_path = destination / "runtime.html"
            guest = guest_path.read_text(encoding="utf-8")
            self.assertIn('data-particle-compiled-runtime-entry="verified-v1"', guest)
            self.assertIn('src="/webgpu-os/boot-theme.js"', guest)
            for original, tampered in (
                ('data-runtime-base="../"', 'data-runtime-base="/"'),
                ('src="/webgpu-os/boot-theme.js"', 'src="boot-theme.js"'),
            ):
                self.assertIn(original, guest)
                guest_path.write_text(guest.replace(original, tampered), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "canonical compiled configuration"):
                    validate_webgpu_os_deployment(destination)
            guest_path.write_text(guest, encoding="utf-8")
            app_path = destination / "app.html"
            app_html = app_path.read_text(encoding="utf-8")
            self.assertIn('<template id="particle-app-runtime-loader">', app_html)
            self.assertIn('data-runtime-src="../assets/particle-platform.min.js.gz?v=', app_html)
            self.assertIn('src="app-boot.js"', app_html)
            self.assertNotIn('boot-theme.js', app_html)
            for relative_name in ("app-boot.js", "app.css"):
                self.assertEqual((destination / relative_name).read_bytes(), (ROOT / "webgpu-os" / relative_name).read_bytes())
            app_path.write_text(app_html.replace('data-runtime-base="../"', 'data-runtime-base="/"'), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "canonical compiled configuration"):
                validate_webgpu_os_deployment(destination)
            app_path.write_text(app_html, encoding="utf-8")

    def test_compiled_os_loader_never_falls_back_to_incomplete_raw_boot(self):
        with tempfile.TemporaryDirectory() as temporary:
            index = Path(temporary) / "index.html"
            index.write_text(
                '<!doctype html><body><script type="module" '
                'src="bootstrap/boot.js"></script></body>',
                encoding="utf-8",
            )

            _write_release_runtime_loader(
                index.parent / "assets" / "release-runtime-loader.js"
            )
            runtime_source = b"globalThis.PE = Object.freeze({});\n"
            runtime_gzip = gzip.compress(runtime_source, mtime=0)
            runtime_integrity = "sha384-" + base64.b64encode(hashlib.sha384(runtime_source).digest()).decode("ascii")
            (index.parent / "assets" / "particle-os.min.js.gz").write_bytes(runtime_gzip)
            (index.parent / "runtime.html").write_text((ROOT / "webgpu-os/runtime.html").read_text(encoding="utf-8"), encoding="utf-8")
            (index.parent / "app.html").write_text((ROOT / "webgpu-os/app.html").read_text(encoding="utf-8"), encoding="utf-8")
            _write_webgpu_os_bundle_index(
                index,
                runtime_integrity,
                len(runtime_source),
                len(runtime_gzip),
                "sha256:" + "b" * 64,
            )

            deployed = index.read_text(encoding="utf-8")
            self.assertIn("assets/particle-os.min.js.gz", deployed)
            self.assertIn(f'data-runtime-bytes="{len(runtime_source)}"', deployed)
            self.assertIn(f'data-runtime-compressed-bytes="{len(runtime_gzip)}"', deployed)
            self.assertIn('data-executor-source-hash="sha256:' + 'b' * 64 + '"', deployed)
            self.assertIn('src="./assets/release-runtime-loader.js?v=', deployed)
            self.assertIn('src="./release-boot.js?v=', deployed)
            self.assertIn('<template id="webgpu-os-compiled-runtime-loader">', deployed)
            self.assertIn(f'data-integrity="{runtime_integrity}"', deployed)
            self.assertNotIn("<script>", deployed)
            release_boot = (index.parent / "release-boot.js").read_text(encoding="utf-8")
            self.assertIn("__particleStableBootstrapOptions", release_boot)
            self.assertIn("legacyRuntimeLoader", release_boot)
            self.assertIn("webgpu-os-compiled-runtime-loader", release_boot)
            self.assertIn("if (runtimeLoad) return runtimeLoad", release_boot)
            self.assertIn("if (compiledBoot) return compiledBoot", release_boot)
            self.assertIn("await api.bootWebGpuOS({ echoAvatarRuntimeContext })", release_boot)
            self.assertNotIn('src="boot.js"', deployed)
            self.assertIn('src="bootstrap/boot.js"', deployed)
            template_start = deployed.index('<template id="webgpu-os-compiled-runtime-loader">')
            template_end = deployed.index("</template>", template_start)
            self.assertLess(template_start, deployed.index('src="./assets/release-runtime-loader.js?v='))
            self.assertLess(deployed.index('src="./assets/release-runtime-loader.js?v='), template_end)
            self.assertLess(template_end, deployed.index('src="./release-boot.js?v='))
            self.assertLess(
                deployed.index('src="./release-boot.js?v='),
                deployed.index('src="bootstrap/boot.js"'),
            )
            self.assertNotIn("rawFallback", deployed)

    def test_compiled_runtime_is_lazy_for_active_registry_once_only_and_rejection_safe(self):
        for scenario in ("active", "empty", "rejection"):
            with self.subTest(scenario=scenario):
                self._run_compiled_runtime_boundary_browser_scenario(scenario)

    def test_compiled_runtime_preserves_source_shell_style_boot_contract(self):
        source_boot = (ROOT / "webgpu-os" / "bootstrap" / "StableBootstrap.js").read_text("utf-8")
        release_boot = site_module._WEBGPU_OS_RELEASE_BOOT_SOURCE
        self.assertIn("style: '../style.css'", source_boot)
        self.assertLess(
            source_boot.index("await ensureStylesheet("),
            source_boot.index("await import(new URL(LEGACY_RESOURCES.boot"),
        )
        self.assertIn("new URL('./style.css', document.currentScript?.src || document.baseURI)", release_boot)
        self.assertLess(
            release_boot.index("await loadShellStylesheet()"),
            release_boot.index("await loadCompiledRuntime()"),
        )
        self.assertLess(
            release_boot.index("await loadCompiledRuntime()"),
            release_boot.index("await api.bootWebGpuOS("),
        )

    def test_compiled_runtime_waits_for_shell_css_reuses_links_and_fails_closed(self):
        for scenario in ("style-preloaded", "style-pending", "style-rejection"):
            with self.subTest(scenario=scenario):
                self._run_compiled_runtime_boundary_browser_scenario(scenario)

    def test_companion_privacy_is_required_and_copied_byte_for_byte(self):
        source = ROOT / "webgpu-os"
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "webgpu-os"
            self.assertEqual(lay_down_companion_privacy(source, destination), 1)
            self.assertEqual(
                (destination / "companion-privacy.html").read_bytes(),
                (source / "browser-extension-store" / "privacy.html").read_bytes(),
            )

            with self.assertRaisesRegex(FileNotFoundError, "privacy policy"):
                lay_down_companion_privacy(Path(temporary) / "missing", destination)

    def test_manifest_has_stable_identity_and_complete_install_icons(self):
        source = ROOT / "webgpu-os"
        manifest = json.loads((source / "manifest.webmanifest").read_text(encoding="utf-8"))

        self.assertEqual(manifest["name"], "Particle Realms")
        self.assertEqual(manifest["id"], "/webgpu-os/")
        self.assertEqual(manifest["start_url"], "/webgpu-os/")
        self.assertEqual(manifest["scope"], "/webgpu-os/")
        self.assertEqual(manifest["display"], "standalone")
        self.assertIn("standalone", manifest["display_override"])

        png_icons = {icon["src"]: icon for icon in manifest["icons"] if icon["type"] == "image/png"}
        self.assertEqual(png_icons["/webgpu-os/assets/particle-realms-192.png"]["sizes"], "192x192")
        self.assertEqual(png_icons["/webgpu-os/assets/particle-realms-512.png"]["sizes"], "512x512")
        self.assertEqual(png_icons["/webgpu-os/assets/particle-realms-maskable-512.png"]["purpose"], "maskable")
        self.assertEqual(len(manifest["shortcuts"]), 3)
        self.assertTrue(all(item["url"].startswith("/webgpu-os/open/app/") for item in manifest["shortcuts"]))

    def test_host_metadata_merge_preserves_existing_rules(self):
        source = ROOT / "webgpu-os"
        with tempfile.TemporaryDirectory() as temporary:
            site = Path(temporary)
            (site / "_redirects").write_text("/existing /index.html 200\n", encoding="utf-8")
            written = lay_down_webgpu_os_host_metadata(source, site)

            redirects = (site / "_redirects").read_text(encoding="utf-8")
            self.assertEqual(written, 2)
            self.assertIn("/existing /index.html 200", redirects)
            self.assertIn("/webgpu-os/open/subsurface/*", redirects)


if __name__ == "__main__":
    unittest.main()
