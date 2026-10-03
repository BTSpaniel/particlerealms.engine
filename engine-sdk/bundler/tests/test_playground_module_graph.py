# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import base64
import tempfile
import unittest
from pathlib import Path

from bundler.browser_syntax import _find_browser, sync_playwright
from bundler.cli import (
    _module_export_names,
    _required_engine_public_module_paths,
    _required_platform_public_module_paths,
    _required_playground_runtime_entries,
)
from bundler.graph import ModuleGraph
from bundler.parser import parse_module
from bundler.site import (
    _cache_bust_js_dir,
    _validate_playground_demo_manifest,
    _validate_playground_module_graph,
)


ROOT = Path(__file__).resolve().parents[2]


class TestPlaygroundReleaseModuleGraph(unittest.TestCase):
    def _site(self, files):
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        for relative_path, contents in files.items():
            destination = root / relative_path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(contents, encoding="utf-8")
        return temporary, root

    def test_accepts_deployed_relative_modules_with_cache_tokens(self):
        temporary, site = self._site({
            "playground/src/main.js": (
                "import { value } from './core/value.js?v=123';\n"
                "export { other } from './core/other.js?v=123';\n"
                "void value;\n"
            ),
            "playground/src/core/value.js": "export const value = 1;\n",
            "playground/src/core/other.js": "export const other = 2;\n",
        })
        with temporary:
            self.assertEqual(_validate_playground_module_graph(site), 2)

    def test_rejects_raw_engine_imports_that_escape_the_release_site(self):
        temporary, site = self._site({
            "playground/src/demos/demo.js": (
                "import { PBDSolver } from "
                "'../../../../engine/sim/physics/PBDSolver.js?v=123';\n"
            ),
        })
        with temporary:
            with self.assertRaisesRegex(RuntimeError, "raw Engine import"):
                _validate_playground_module_graph(site)

    def test_rejects_missing_modules_before_the_host_returns_html(self):
        temporary, site = self._site({
            "playground/src/main.js": "import './missing.js?v=123';\n",
        })
        with temporary:
            with self.assertRaisesRegex(RuntimeError, "HTML fallback"):
                _validate_playground_module_graph(site)

    def test_rejects_a_module_path_containing_html(self):
        temporary, site = self._site({
            "playground/src/main.js": "import './wrong.js';\n",
            "playground/src/wrong.js": "<!doctype html><title>SPA fallback</title>\n",
        })
        with temporary:
            with self.assertRaisesRegex(RuntimeError, "resolves to HTML"):
                _validate_playground_module_graph(site)

    def test_accepts_an_exact_static_demo_manifest(self):
        temporary, site = self._site({
            "playground/src/demos/manifest.js": (
                "export default [\n  'demo.js',\n];\n"
            ),
            "playground/src/demos/demo.js": "export default { id: 'demo' };\n",
            "playground/src/demos/helper.js": "export const helper = true;\n",
        })
        with temporary:
            self.assertEqual(_validate_playground_demo_manifest(site), 1)

    def test_rejects_a_stale_static_demo_manifest(self):
        temporary, site = self._site({
            "playground/src/demos/manifest.js": (
                "export default [\n  'helper.js',\n  'helper.js',\n];\n"
            ),
            "playground/src/demos/demo.js": "export default { id: 'demo' };\n",
            "playground/src/demos/helper.js": "export const helper = true;\n",
        })
        with temporary:
            with self.assertRaisesRegex(
                RuntimeError,
                "(?s)duplicate entries: helper.js.*missing demo entries: demo.js.*non-demo entries: helper.js",
            ):
                _validate_playground_demo_manifest(site)

    def test_tetra_cage_runtime_tests_deploy_without_raw_engine_imports(self):
        paths = (
            "playground/src/core/engine.js",
            "playground/src/demos/pbr/tetraCageRayRuntime.test.js",
            "playground/src/demos/pbr/tetraCageRayRuntime.js",
            "playground/src/demos/pbr/tetraCageShaders.js",
        )
        temporary, site = self._site({
            path: (ROOT / "tests" / path).read_text(encoding="utf-8")
            for path in paths
        })
        with temporary:
            _cache_bust_js_dir(site / "playground/src", "tetra-regression")
            self.assertEqual(_validate_playground_module_graph(site), 3)
            source = (site / paths[1]).read_text(encoding="utf-8")
            self.assertIn("../../core/engine.js?v=tetra-regression", source)
            self.assertIn("await loadBundleAwareModule(", source)
            self.assertIn("'engine/core/math/TetrahedralCageAccel.js'", source)

    def test_lab_helpers_deploy_without_raw_engine_imports(self):
        playground = ROOT / "tests" / "playground"
        for lab, minimum_edges in (("physicsRuntime", 8), ("surfaceLab", 3), ("textureStudio", 3)):
            with self.subTest(lab=lab):
                paths = [
                    playground / f"src/demos/{lab}.js",
                    playground / "src/core/engine.js",
                    playground / "src/core/mat4.js",
                    *sorted((playground / f"src/demos/{lab}").rglob("*.js")),
                    playground / f"src/demos/{lab}/style.css",
                ]
                if lab == "physicsRuntime":
                    paths.append(playground / "src/demos/carDrive/city/CityGeometry.js")
                temporary, site = self._site({
                    "playground/" + path.relative_to(playground).as_posix(): path.read_text(encoding="utf-8")
                    for path in paths
                })
                with temporary:
                    _cache_bust_js_dir(site / "playground/src", "lab-regression")
                    self.assertGreaterEqual(_validate_playground_module_graph(site), minimum_edges)
                    self.assertTrue((site / f"playground/src/demos/{lab}/style.css").is_file())
                    self.assertIn(f"./{lab}/index.js?v=lab-regression",
                                  (site / f"playground/src/demos/{lab}.js").read_text())

    def test_texture_widget_closure_does_not_import_the_realmforge_app(self):
        entries = _required_playground_runtime_entries(ROOT)
        self.assertEqual(entries, (
            "webgpu-os/apps/realmforge/material/studio/RealmForgeTextureStudio.js",
        ))
        graph = ModuleGraph(ROOT, [])
        for entry in entries:
            graph.walk(entry)
        self.assertEqual(graph.errors, [])
        modules = {graph.mod_id(path) for path in graph.order}
        self.assertIn("engine/assets/material/procedural/ProceduralPbrTexture.js", modules)
        self.assertIn("webgpu-os/apps/realmforge/material/studio/RealmForgeTextureRecipes.js", modules)
        self.assertFalse(any("/modeler/" in path or path.endswith("/RealmForgeSession.js") for path in modules))
        self.assertNotIn("webgpu-os/apps/realmforge/index.js", modules)

    def test_pbd_solver_is_exported_and_mapped_through_the_bundle(self):
        bootstrap = (ROOT / "engine" / "EngineBootstrap.js").read_text(encoding="utf-8")
        resolver = (
            ROOT / "tests" / "playground" / "src" / "core" / "engine.js"
        ).read_text(encoding="utf-8")
        imports, exports = parse_module(bootstrap)

        self.assertTrue(any(
            item.namespace == "_ParticlePBD"
            and item.spec == "./sim/physics/PBDSolver.js"
            for item in imports
        ))
        self.assertTrue(any(
            "_ParticlePBD as particlePBD" in item.named for item in exports
        ))
        self.assertIn("'sim/physics/PBDSolver.js': 'particlePBD'", resolver)
        self.assertIn("if (ns) return window.PE[ns] || null", resolver)

    def test_car_math_and_physx_are_exported_and_mapped_through_the_bundle(self):
        bootstrap = (ROOT / "engine" / "EngineBootstrap.js").read_text(encoding="utf-8")
        resolver = (
            ROOT / "tests" / "playground" / "src" / "core" / "engine.js"
        ).read_text(encoding="utf-8")
        imports, exports = parse_module(bootstrap)
        contracts = (
            ("_ParticleMathRandom", "./core/math/MathRandom.js", "particleMathRandom"),
            ("_ParticleMathGeometry", "./core/math/MathGeometry.js", "particleMathGeometry"),
            (
                "_ParticlePhysXPhysicsWorld",
                "./sim/physics/PhysXPhysicsWorld.js",
                "particlePhysXPhysicsWorld",
            ),
            ("_ParticlePhysXVehicle", "./sim/physics/PhysXVehicle.js", "particlePhysXVehicle"),
        )

        for namespace, spec, public_name in contracts:
            with self.subTest(spec=spec):
                self.assertTrue(any(
                    item.namespace == namespace and item.spec == spec
                    for item in imports
                ))
                self.assertTrue(any(
                    f"{namespace} as {public_name}" in item.named
                    for item in exports
                ))
                engine_relative = spec.removeprefix("./")
                self.assertIn(
                    f"'{engine_relative}': '{public_name}'",
                    resolver,
                )

        car_demo = (
            ROOT / "tests" / "playground" / "src" / "demos" / "carDrive" / "index.js"
        ).read_text(encoding="utf-8")
        native_runtime = (
            ROOT
            / "tests"
            / "playground"
            / "src"
            / "demos"
            / "carDrive"
            / "runtime"
            / "NativeVehicleRuntime.js"
        ).read_text(encoding="utf-8")
        self.assertIn("loadRawEngineModule('core/math/MathRandom.js')", car_demo)
        self.assertIn("loadRawEngineModule('core/math/MathGeometry.js')", car_demo)
        self.assertIn("loadModule('sim/physics/PhysXPhysicsWorld.js')", native_runtime)
        self.assertIn("assets?.createPublicVehicleRuntime", native_runtime)
        self.assertNotIn("loadModule('assets/vehicle/VehiclePublicRuntime.js')", native_runtime)

        vehicle_adapter = (
            ROOT
            / "tests"
            / "playground"
            / "src"
            / "demos"
            / "carDrive"
            / "EngineVehicleAssets.js"
        ).read_text(encoding="utf-8")
        self.assertIn("loadEngineVehicleAssets()", car_demo)
        self.assertNotIn("await loadEngineVehicleAssets()", vehicle_adapter)

        car_drive_root = (
            ROOT / "tests" / "playground" / "src" / "demos" / "carDrive"
        )
        forbidden_edges = []
        for source_path in sorted(car_drive_root.rglob("*.js")):
            imports, exports = parse_module(source_path.read_text(encoding="utf-8"))
            specs = [item.spec for item in imports if item.spec]
            specs.extend(item.spec for item in exports if item.reexport and item.spec)
            for spec in specs:
                normalized = spec.replace("\\", "/")
                if normalized.startswith("/engine/") or "/engine/" in normalized:
                    forbidden_edges.append(
                        f"{source_path.relative_to(car_drive_root).as_posix()}: {spec}"
                    )
        self.assertEqual([], forbidden_edges)

    def test_every_top_level_engine_barrel_has_a_stable_public_namespace(self):
        bootstrap = (ROOT / "engine" / "EngineBootstrap.js").read_text(encoding="utf-8")
        imports, exports = parse_module(bootstrap)
        contracts = (
            ("AnimationAll", "./animation/index.js", "Animation"),
            ("_ParticleAssets", "./assets/index.js", "Assets"),
            ("_ParticleAudio", "./audio/index.js", "Audio"),
            ("_ParticleCollab", "./collab/index.js", "Collab"),
            ("_ParticleCompat", "./compat/index.js", "Compat"),
            ("_ParticleCore", "./core/index.js", "Core"),
            ("_ParticleMatter", "./matter/index.js", "Matter"),
            ("NetworkAll", "./network/index.js", "Network"),
            ("_ParticleRender", "./render/index.js", "Render"),
            ("_ParticleState", "./state/index.js", "State"),
            ("_ParticleSurfaces", "./surfaces/index.js", "Surfaces"),
            ("_ParticleVoxel", "./voxel/index.js", "Voxel"),
            ("_ParticleWorld", "./world/index.js", "World"),
        )

        for namespace, spec, public_name in contracts:
            with self.subTest(public_name=public_name):
                self.assertTrue(any(
                    item.namespace == namespace and item.spec == spec
                    for item in imports
                ))
                self.assertTrue(any(
                    f"{namespace} as {public_name}" in item.named
                    for item in exports
                ))

    def test_adaptive_matter_runtime_is_publicly_closed_without_executor_authority(self):
        graph = ModuleGraph(ROOT)
        graph.walk("engine/EngineBootstrap.js")
        module_ids = {graph.mod_id(path) for path in graph.modules}
        required_modules = {
            "engine/matter/fluid/AdaptiveSphGpuNumericBounds.js",
            "engine/matter/fluid/AdaptiveSphGpuPlan.js",
            "engine/matter/fluid/AdaptiveSphGpuRuntime.js",
            "engine/matter/fluid/MixedResolutionFluidExecutionCertificate.js",
            "engine/matter/runtime/index.js",
            "engine/matter/runtime/MatterRuntimeCoordinator.js",
        }
        required_symbols = {
            "MATTER_FRAME_DIAGNOSTICS_RECEIPT_SCHEMA",
            "MATTER_FRAME_DIAGNOSTICS_RECEIPT_VERSION",
            "MatterDiagnostics",
            "admitAdaptiveSphGpuNumericBounds",
            "createAdaptiveSphGpuPlan",
            "readAdaptiveSphGpuPlan",
            "admitAdaptiveSphGpuRuntimeCapacity",
            "createAdaptiveSphGpuRuntime",
            "createMixedResolutionFluidExecutionCertificateAuthority",
        }

        self.assertEqual(graph.errors, [])
        self.assertTrue(required_modules.issubset(module_ids))
        matter_exports = _module_export_names(graph, "engine/matter/index.js")
        self.assertTrue(required_symbols.issubset(matter_exports))
        self.assertNotIn("createAdaptiveSphGpuExecutor", matter_exports)
        self.assertNotIn("ADAPTIVE_SPH_GPU_WGSL", matter_exports)

        # The runtime may incidentally reuse the research executor's shader source.
        # Its presence is not required, but it must remain non-authoritative if bundled.
        executor_id = "engine/matter/fluid/AdaptiveSphGpuExecutor.js"
        if executor_id in module_ids:
            executor_exports = _module_export_names(graph, executor_id) - {"default"}
            self.assertTrue(executor_exports)
            self.assertTrue(executor_exports.isdisjoint(matter_exports))
            executor = (
                ROOT / "engine" / "matter" / "fluid" / "AdaptiveSphGpuExecutor.js"
            ).read_text(encoding="utf-8")
            self.assertIn("physicalAuthorityGranted: false", executor)
            self.assertNotIn("physicalAuthorityGranted: true", executor)

    def test_sandbox_material_catalog_is_exported_and_release_mapped(self):
        bootstrap = (ROOT / "engine" / "EngineBootstrap.js").read_text(encoding="utf-8")
        substances = (
            ROOT / "engine" / "sim" / "particles" / "substances" / "index.js"
        ).read_text(encoding="utf-8")
        resolver = (
            ROOT / "tests" / "playground" / "src" / "core" / "engine.js"
        ).read_text(encoding="utf-8")
        imports, exports = parse_module(bootstrap)

        self.assertTrue(any(
            item.namespace == "_ParticleSubstances"
            and item.spec == "./sim/particles/substances/index.js"
            for item in imports
        ))
        self.assertTrue(any(
            "_ParticleSubstances as particleSubstances" in item.named
            for item in exports
        ))
        self.assertIn("createSandboxMaterialCatalog", substances)
        self.assertIn("createSandboxSpeciesLut", substances)
        self.assertIn(
            "'sim/particles/substances/index.js': 'particleSubstances'",
            resolver,
        )

    def test_sandbox_demo_has_no_release_escaping_engine_import(self):
        demo_root = ROOT / "tests" / "playground" / "src" / "demos"
        sources = [
            demo_root / "sandbox2d.js",
            *(demo_root / "sandbox2d").glob("*.js"),
            demo_root / "sandbox3d.js",
            *(demo_root / "sandbox3d").glob("*.js"),
        ]
        self.assertGreaterEqual(len(sources), 8)

        combined = "\n".join(path.read_text(encoding="utf-8") for path in sources)
        self.assertNotIn("../../../../engine/", combined)
        self.assertNotIn("/engine/", combined)
        self.assertIn("from '../../core/engine.js'", combined)
        self.assertIn("await loadEngine()", combined)

    def test_particle_storm_resolves_page_codec_through_the_release_bundle(self):
        source_path = (
            ROOT / "tests" / "playground" / "src" / "demos" / "particleStorm.js"
        )
        source = source_path.read_text(encoding="utf-8")
        imports, exports = parse_module(source)
        specs = [item.spec for item in imports if item.spec]
        specs.extend(item.spec for item in exports if item.reexport and item.spec)

        self.assertFalse(any(
            spec.startswith("/engine/") or "/engine/" in spec.replace("\\", "/")
            for spec in specs
        ))
        self.assertIn("loadBundleAwareModule(", source)
        self.assertIn(
            "'engine/matter/codec/ParticleKinematicsPageCodec.js'",
            source,
        )

    def test_particle_storm_support_modules_use_bundle_aware_engine_loading(self):
        demo_root = ROOT / "tests" / "playground" / "src" / "demos"
        contracts = {
            "particleCalibrationEvidence.js": (
                "engine/core/math/ExactCalibrationEvidence.js",
                {
                    "createExactCalibrationEvidence",
                    "exactCalibrationNumberExpression",
                },
            ),
            "particleStormCodecMode.js": (
                "engine/render/morphfield/systems/ParticleCohortPlanner.js",
                {
                    "PARTICLE_COHORT_PRESENTATION_QUEUES",
                    "createParticleCohortPlanner",
                },
            ),
            "particleStormPageCodec.js": (
                "engine/matter/codec/ParticleKinematicsPageCodec.js",
                set(),
            ),
            "particleStormRepresentationBenchmark.js": (
                "engine/core/math/MathQuality.js",
                {"qualityMetricsReport", "qualitySizeScore"},
            ),
        }

        for filename, (module_id, _) in contracts.items():
            with self.subTest(filename=filename):
                source = (demo_root / filename).read_text(encoding="utf-8")
                imports, exports = parse_module(source)
                specs = [item.spec for item in imports if item.spec]
                specs.extend(
                    item.spec for item in exports if item.reexport and item.spec
                )
                self.assertFalse(any(
                    spec.startswith("/engine/")
                    or "/engine/" in spec.replace("\\", "/")
                    for spec in specs
                ))
                self.assertIn("from '../core/engine.js'", source)
                self.assertIn("loadBundleAwareModule(", source)
                self.assertIn(repr(module_id), source)

        engine_graph = ModuleGraph(ROOT)
        engine_graph.walk("engine/EngineBootstrap.js")
        engine_module_ids = {
            engine_graph.mod_id(path) for path in engine_graph.modules
        }
        self.assertEqual(engine_graph.errors, [])
        contract_module_ids = {
            module_id for module_id, _ in contracts.values()
        }
        self.assertTrue(contract_module_ids.issubset(engine_module_ids))
        self.assertTrue(contract_module_ids.issubset(
            set(_required_engine_public_module_paths())
        ))
        for filename, (module_id, required_symbols) in contracts.items():
            with self.subTest(engine_exports=filename):
                self.assertTrue(required_symbols.issubset(
                    _module_export_names(engine_graph, module_id)
                ))

        compatibility_graph = ModuleGraph(ROOT)
        compatibility_id = (
            "tests/playground/src/demos/particleStormPageCodec.js"
        )
        compatibility_graph.walk(compatibility_id)
        self.assertEqual(compatibility_graph.errors, [])
        self.assertEqual(
            _module_export_names(
                engine_graph,
                contracts["particleStormPageCodec.js"][0],
            )
            - {"default"},
            _module_export_names(compatibility_graph, compatibility_id),
        )

    def test_voice_ocr_reuses_required_platform_modules_without_raw_release_imports(self):
        contracts = {
            "voice.js": "webgpu-os/kernel/navi/voice/ParticleVoiceOutput.js",
            "scanner.js": "webgpu-os/factory/components/ocr/index.js",
        }
        graph = ModuleGraph(ROOT)
        graph.walk("webgpu-os/index.js")
        self.assertEqual(graph.errors, [])
        module_ids = {graph.mod_id(path) for path in graph.modules}
        for name, module_id in contracts.items():
            with self.subTest(name=name):
                self.assertIn(module_id, module_ids)
                self.assertIn(module_id, _required_platform_public_module_paths())
                source = (ROOT / "tests/playground/src/demos/voiceOcr" / name).read_text("utf-8")
                imports, _exports = parse_module(source)
                self.assertEqual([item.spec for item in imports if item.spec], ["../../core/engine.js"])
                self.assertIn(repr(module_id), source)
                self.assertIn("{ preferSource: true }", source)
        self.assertIn("webgpu-os/factory/components/ocr/learned-base.js", module_ids)
        self.assertIn("webgpu-os/factory/components/ocr/learned-handprint-base.js", module_ids)

    def test_bundle_resolver_prefers_stable_paths_and_keeps_legacy_aliases(self):
        resolver = (
            ROOT / "tests" / "playground" / "src" / "core" / "engine.js"
        ).read_text(encoding="utf-8")

        stable_index = resolver.index("typeof runtime.requireModule === 'function'")
        legacy_index = resolver.index("runtime.__modules || runtime._M")
        self.assertLess(stable_index, legacy_index)
        self.assertIn("runtime.__require || runtime._require", resolver)
        self.assertIn("bundledRegistryReady()", resolver)

    def test_color_math_shader_chunk_is_in_the_engine_bundle_graph(self):
        graph = ModuleGraph(ROOT)
        graph.walk("engine/render/shaders/ShaderSources.js")
        module_ids = {graph.mod_id(path) for path in graph.modules}

        self.assertEqual(graph.errors, [])
        self.assertIn(
            "engine/render/shaders/modules/chunks/color_math.js",
            module_ids,
        )

        shader_sources = (
            ROOT / "engine" / "render" / "shaders" / "ShaderSources.js"
        ).read_text(encoding="utf-8")
        _, exports = parse_module(shader_sources)
        self.assertTrue(any(
            item.reexport
            and item.spec == "./modules/chunks/color_math.js"
            and "colorMathWGSL" in item.named
            for item in exports
        ))


@unittest.skipIf(sync_playwright is None, "Playwright is required for resolver evidence")
class TestPlaygroundBundleResolverBrowser(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = (ROOT / "tests/playground/src/core/engine.js").read_bytes()
        cls.module_url = "data:text/javascript;base64," + base64.b64encode(source).decode("ascii")
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(executable_path=str(_find_browser()), headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def test_dev_source_preference_preserves_default_and_release_boundaries(self):
        page = self.browser.new_page()
        try:
            results = page.evaluate("""async moduleUrl => {
                const { loadBundleAwareModule } = await import(moduleUrl);
                const source = 'data:text/javascript,export const origin = "source";';
                window.PE = { requireModule: () => ({ origin: 'bundle' }) };
                const defaults = await loadBundleAwareModule('demo', [source]);
                const development = await loadBundleAwareModule('demo', [source], { preferSource: true });
                window.__PE_ASSET_BASE = '/assets/';
                const release = await loadBundleAwareModule('demo', [source], { preferSource: true });
                window.PE = { requireModule: () => null };
                let unavailable;
                try { await loadBundleAwareModule('demo', [source], { preferSource: true }); }
                catch (error) { unavailable = error.message; }
                return { defaults: defaults.origin, development: development.origin,
                    release: release.origin, unavailable };
            }""", self.module_url)
            self.assertEqual(results, {
                "defaults": "bundle", "development": "source", "release": "bundle",
                "unavailable": "Runtime module not found: demo",
            })
        finally:
            page.close()


if __name__ == "__main__":
    unittest.main()
