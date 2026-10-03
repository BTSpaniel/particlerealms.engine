# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from bundler.emitter import find_executable_import_meta
from bundler.parser import parse_module
from bundler.site import (
    RELEASE_SITE_STATIC_ASSETS,
    release_site_static_asset_paths,
    validate_abyssal_diver_v3_assets,
)


ROOT = Path(__file__).resolve().parents[2]

PAGE_ASSET_SUFFIXES = (".png", ".atlas.json")

ECOSYSTEM_PAGE_STEMS = (
    "vent-habitat-kit-v1",
    "vent-benthic-cycles-v1",
    "abyssal-visitor-cycles-v1",
)

ECOSYSTEM_PAGE_ASSETS = tuple(
    f"{stem}{suffix}"
    for stem in ECOSYSTEM_PAGE_STEMS
    for suffix in PAGE_ASSET_SUFFIXES
)

DIVER_V2_PAGE_STEMS = tuple(
    f"{role}-{page}-v2"
    for role in ("leader", "geologist", "surveyor")
    for page in ("body", "limbs", "actions")
)

DIVER_V2_PAGE_ASSETS = tuple(
    f"{stem}{suffix}"
    for stem in DIVER_V2_PAGE_STEMS
    for suffix in PAGE_ASSET_SUFFIXES
)


class TestRuntimeTelemetryContracts(unittest.TestCase):
    def test_homepage_uses_bundler_metrics_and_an_honest_audit_cursor(self):
        source = (ROOT / "tests" / "index.html").read_text(encoding="utf-8")
        self.assertIn("./assets/code-metrics.json", source)
        self.assertIn("AUDIT CURSOR", source)
        self.assertIn("First-party source files", source)
        self.assertIn("NPM runtime packages", source)
        self.assertIn("evidence · generated/minified output", source)
        self.assertIn("const metricUrls = ['./assets/code-metrics.json'];", source)
        self.assertNotIn("../release/code-metrics.json", source)
        self.assertNotIn("/release/code-metrics.json", source)
        self.assertNotIn("552K", source)
        self.assertNotIn("~3 months of active development", source)

    def test_runtime_info_fetches_only_platform_archive_assets(self):
        telemetry = (
            ROOT / "tests" / "playground" / "src" / "demos" / "runtimeInfo" / "telemetry.js"
        ).read_text(encoding="utf-8")
        targets = json.loads((ROOT / "release_targets.json").read_text(encoding="utf-8"))["targets"]
        platform = targets["platform"]

        telemetry_paths = {
            "../assets/particle-platform.manifest.json",
            "../assets/code-metrics.json",
        }
        deployed_paths = {
            f"../assets/{platform['name']}.manifest.json",
            *(f"../assets/{path}" for path in RELEASE_SITE_STATIC_ASSETS),
        }

        self.assertTrue(platform["include_webgpu_os"])
        self.assertTrue(telemetry_paths.issubset(deployed_paths))
        for path in telemetry_paths:
            self.assertIn(f"'{path}'", telemetry)
        self.assertNotIn("/release/", telemetry)
        self.assertNotIn("particle-os.manifest.json", telemetry)
        self.assertIn("manifest?.include_webgpu_os === true", telemetry)

    def test_homepage_uses_authored_abyssal_artwork_and_is_motion_safe(self):
        source = (ROOT / "tests" / "index.html").read_text(encoding="utf-8")
        heat_haze = (ROOT / "engine" / "render" / "passes" / "ImageHeatHazePass.js").read_text(encoding="utf-8")
        silt_field = (ROOT / "engine" / "render" / "passes" / "UnderwaterSiltField.js").read_text(encoding="utf-8")
        fauna_field = (ROOT / "engine" / "render" / "passes" / "AbyssalFaunaField.js").read_text(encoding="utf-8")
        dive_team = (ROOT / "engine" / "render" / "passes" / "AbyssalDiveTeam.js").read_text(encoding="utf-8")
        smoke_animator = (ROOT / "engine" / "render" / "passes" / "AbyssalSmokeAnimator.js").read_text(encoding="utf-8")
        dev_backdrop = (ROOT / "tests" / "assets" / "abyssal-backdrop.js").read_text(encoding="utf-8")
        dev_fauna = (ROOT / "tests" / "assets" / "abyssal-fauna.js").read_text(encoding="utf-8")
        dev_smoke = (ROOT / "tests" / "assets" / "abyssal-smoke.js").read_text(encoding="utf-8")
        artwork = ROOT / "tests" / "assets" / "abyssal-layers" / "mineral-base-v4.webp"
        light_texture = ROOT / "tests" / "assets" / "abyssal-layers" / "godray-breakup-v1.webp"

        self.assertIn("url('./assets/abyssal-layers/mineral-base-v4.webp')", source)
        self.assertIn("authored abyssal field", source)
        self.assertIn('class="abyss-atmosphere" aria-hidden="true"', source)
        self.assertEqual(source.count('class="abyss-bubble"'), 15)
        self.assertIn('class="abyss-smoke-near-stage" id="abyss-smoke-stage"', source)
        self.assertIn("projectImagePointToViewport", source)
        self.assertIn("positionMultiplane", source)
        self.assertIn("startAbyssalSmokeAnimator", source)
        self.assertIn("cycleDuration: 8400", source)
        self.assertIn('.abyss-smoke-track[data-smoke-track="1"]', source)
        self.assertNotIn("@keyframes smoke-cel-frame-one", source)
        self.assertNotIn("@keyframes smoke-near-cel-rise", source)
        self.assertIn("mix-blend-mode: multiply", source)
        self.assertIn("--bubble-light-x", source)
        self.assertIn("animateAbyssalLight", source)
        self.assertIn('id="underwater-atmosphere" aria-hidden="true"', source)
        self.assertIn('id="underwater-text-refraction"', source)
        self.assertIn("startUnderwaterSiltField", source)
        self.assertIn("startAbyssalFaunaField", source)
        self.assertEqual(source.count('class="abyss-fauna-layer'), 3)
        self.assertIn("const updateAbyssalScrollStory = () =>", source)
        self.assertIn("document.documentElement.scrollHeight - innerHeight", source)
        self.assertIn("requestAnimationFrame(updateAbyssalScrollStory)", source)
        self.assertIn("--abyss-rock-opacity", source)
        self.assertIn("--abyss-light-opacity", source)
        self.assertIn("--abyss-swimmer-opacity", source)
        self.assertIn("--abyss-ecosystem-opacity", source)
        self.assertIn("dataset.abyssalScrollProgress", source)
        self.assertIn("faunaField?.setScrollProgress(pageProgress, heroDepth)", source)
        self.assertIn("diveTeam?.setScrollProgress(pageProgress)", source)
        self.assertNotIn("if (fadeProgress >= 1) setHeroCastActive(false)", source)
        self.assertNotIn("const castObserver = new IntersectionObserver", source)
        self.assertIn("if (this.sceneActive === nextActive) return", fauna_field)
        self.assertIn('.abyss-fauna[data-frame-slot="0"]::before', source)
        self.assertNotIn("transition: opacity 72ms", source)
        self.assertIn("underwater-title-buoyancy", source)
        self.assertIn(".abyss-bubble::before", source)
        self.assertIn("@keyframes abyss-bubbles-wobble", source)
        self.assertIn('id="abyss-backdrop" aria-hidden="true"', source)
        self.assertIn("@keyframes abyss-bubbles-rise", source)
        self.assertIn("startImageHeatHaze", source)
        self.assertNotIn('./assets/elemental-background.js', source)
        self.assertNotIn('id="bg-canvas"', source)
        self.assertNotIn("bgStart();", source)
        self.assertIn("prefers-reduced-motion: reduce", source)
        self.assertIn("Lava fractures", source)
        self.assertIn("Minerals rise", source)
        self.assertIn("screenToSourceUV(input.uv + screenOffset)", heat_haze)
        self.assertIn("textureSample(sourceImage, sourceSampler, sourceUV)", heat_haze)
        self.assertIn("fn smokeMask", heat_haze)
        self.assertIn("smokeCurl * haze.smokeStrength * smoke", heat_haze)
        self.assertIn("fn godRayScatter", heat_haze)
        self.assertIn("fn godRayBreakup", heat_haze)
        self.assertIn("godRayBreakupTexture", heat_haze)
        self.assertIn("lightTextureUrl", source)
        self.assertIn("export function projectImagePointToViewport", heat_haze)
        self.assertIn("const projection = projectImagePointToViewport", heat_haze)
        self.assertIn("fn underwaterRippleOffset", heat_haze)
        self.assertIn("fn underwaterCaustics", heat_haze)
        self.assertIn("let leftField = 1.0 - smoothstep", heat_haze)
        self.assertIn("waterRippleStrength", heat_haze)
        self.assertIn("projectImagePointToViewport,", dev_backdrop)
        imports, exports = parse_module(silt_field)
        self.assertEqual(imports, [])
        self.assertEqual(len(exports), 2)
        self.assertIn("getCoalescedEvents", silt_field)
        self.assertIn("dataset.siltParticles", silt_field)
        self.assertIn("const sizeBand =", silt_field)
        self.assertIn("particleCount: 224", source)
        self.assertIn("bubblesPerDiver: 100", source)
        self.assertIn("maxLiveBubblesPerDiver: 180", source)
        self.assertIn("bubbleSourceProvider: () => diveTeam?.getExhaustSources() ?? []", source)
        self.assertIn("...(faunaField?.getWakeSources() ?? [])", source)
        self.assertIn('html[data-diver-bubbles="canvas"] .abyss-diver-exhale', source)
        self.assertIn("fireGlowStrength: 0.20", source)
        self.assertIn("fireGlowStrength: 0.24", source)
        self.assertIn("buildFireEmissionMask", silt_field)
        self.assertIn("const warmDominance =", silt_field)
        self.assertIn("drawFireGlow", silt_field)
        self.assertIn("ctx.globalCompositeOperation = 'lighter'", silt_field)
        self.assertIn("fn colorAwareFireGlow", heat_haze)
        self.assertIn("color += colorAwareFireGlow(sourceUV)", heat_haze)
        self.assertIn("fn colorAwareLavaFlow", heat_haze)
        self.assertIn("color += colorAwareLavaFlow(sourceUV)", heat_haze)
        self.assertIn("Thin traveling exposures", silt_field)
        self.assertIn("const tangentX = (-dy / distance) * pointer.spin", silt_field)
        self.assertIn("drawGodRays", silt_field)
        self.assertIn("setSceneTransition", silt_field)
        self.assertIn("this.lightingOpacity", silt_field)
        self.assertIn("this.exhaustOpacity", silt_field)
        self.assertIn("setFireLightingEnabled", silt_field)
        self.assertIn("if (this.fireLightingEnabled) this.drawFireGlow(elapsed)", silt_field)
        self.assertIn("const endX = sourceX -", silt_field)
        self.assertIn("const endX = sourceX +", silt_field)
        self.assertIn("for (let ray = 0; ray < 2; ray += 1)", silt_field)
        self.assertIn("const sway = Math.sin", silt_field)
        self.assertNotIn("drawPointerRipples", silt_field)
        self.assertNotIn("this.ripples", silt_field)
        self.assertIn("ctx.setLineDash", silt_field)
        self.assertIn("targetFrameMs", silt_field)
        self.assertIn("sampleWaterFlow", silt_field)
        self.assertIn("emitBreathPulses", silt_field)
        self.assertIn("updateAndDrawExhaustBubbles", silt_field)
        self.assertIn("dataset.exhaustBubblesPerBreath", silt_field)
        self.assertIn("dataset.exhaustBubbleCapacity", silt_field)
        self.assertIn("const youngPlumeLift =", silt_field)
        self.assertIn("wake.kind === 'diver' ? 0.82 : 0.34", silt_field)
        fauna_imports, fauna_exports = parse_module(fauna_field)
        self.assertEqual(fauna_imports, [])
        self.assertEqual(len(fauna_exports), 2)
        self.assertIn("registrationCellSize: 627", fauna_field)
        self.assertEqual(fauna_field.count("registrationCellSize: 627"), 2)
        self.assertIn("frameRate: 10.2", fauna_field)
        self.assertIn("frameRate: 11.4", fauna_field)
        self.assertIn("fish.homeDepth", fauna_field)
        self.assertIn("layer.appendChild(node)", fauna_field)
        self.assertNotIn("appendChild(fish.node)", fauna_field)
        self.assertIn("node.dataset.depthPlane", fauna_field)
        self.assertIn("fish.node.dataset.depth", fauna_field)
        self.assertIn("node.style.opacity = '1'", fauna_field)
        self.assertNotIn("fish.node.style.opacity = String", fauna_field)
        self.assertIn("_syncFishScrollPresentation(fish)", fauna_field)
        self.assertIn("const opacity = fish.bottomResident ? this.ecosystemReveal : this.swimmerPresence", fauna_field)
        self.assertIn("fish.node.style.opacity = opacity.toFixed(3)", fauna_field)
        self.assertIn("const present = opacity > 0", fauna_field)
        self.assertIn("previousEcosystemReveal <= 0 && this.ecosystemReveal > 0", fauna_field)
        self.assertIn("this._updateDepthStacks()", fauna_field)
        self.assertIn("left.depth - right.depth || left.stackId - right.stackId", fauna_field)
        self.assertIn("fish.node.style.zIndex = String(stackOrder)", fauna_field)
        self.assertIn("fish.node.dataset.depthStack", fauna_field)
        self.assertIn("isolation: isolate", source)
        self.assertIn("--lava-light", fauna_field)
        self.assertIn("thermalDistance", fauna_field)
        self.assertIn("cruiseScale", fauna_field)
        self.assertIn("pitchBias", fauna_field)
        self.assertIn("personalSpace", fauna_field)
        self.assertIn("targetFrameMs", fauna_field)
        self.assertIn("prefers-reduced-motion: reduce", fauna_field)
        self.assertIn("getWakeSources()", fauna_field)
        self.assertIn("setScrollProgress(progress, heroProgress = progress)", fauna_field)
        self.assertIn("this.ecosystemReveal", fauna_field)
        self.assertIn("bottomResident", fauna_field)
        self.assertIn("rockZone", fauna_field)
        self.assertIn("viewportX", fauna_field)
        self.assertIn("Number.isFinite(fish.displayY) ? fish.displayY : fish.y", fauna_field)
        self.assertIn("startAbyssalFaunaField,", dev_fauna)
        smoke_imports, smoke_exports = parse_module(smoke_animator)
        self.assertEqual(smoke_imports, [])
        self.assertEqual(len(smoke_exports), 2)
        self.assertIn("const FRAME_COUNT = 12", smoke_animator)
        self.assertIn("const TRACK_OFFSETS = Object.freeze([0, 0.5])", smoke_animator)
        self.assertIn("const blend = smoothstep(0.68, 0.96, frameFraction)", smoke_animator)
        self.assertIn("track.cels[0].style.opacity = (1 - blend).toFixed(4)", smoke_animator)
        self.assertIn("track.cels[1].style.opacity = blend.toFixed(4)", smoke_animator)
        self.assertIn("const fadeOut = 1 - smoothstep", smoke_animator)
        self.assertIn("Math.pow(phase, 1.35)", smoke_animator)
        self.assertIn("dataset.smokeFrames", smoke_animator)
        self.assertIn("prefers-reduced-motion: reduce", smoke_animator)
        self.assertIn("startAbyssalSmokeAnimator,", dev_smoke)
        self.assertIn("frameRemap: Object.freeze({ 'light:2': 1 })", dive_team)
        self.assertIn("diver.profile.frameRemap?.", dive_team)
        self.assertIn("const canvas = document.createElement('canvas')", dive_team)
        self.assertIn("for (const frame of action.frames) frame.image = decodedImages.get(frame.url) ?? null", dive_team)
        self.assertIn("diver.canvasContext.clearRect(0, 0, diver.canvas.width, diver.canvas.height)", dive_team)
        self.assertIn("diver.canvasContext.drawImage(frame.image", dive_team)
        v3_frame_branch = dive_team.split("if (diver.renderer === 'v3-sequence')", 1)[1].split(
            "const sequence = ACTION_SEQUENCES[diver.action]", 1
        )[0]
        self.assertNotIn("backgroundImage", v3_frame_branch)
        self.assertIn("if (this.sceneActive === nextActive) return", dive_team)
        self.assertIn("getExhaustSources()", dive_team)
        self.assertIn("getWakeSources()", dive_team)
        self.assertIn("setScrollProgress(progress)", dive_team)
        self.assertIn("this.scrollProgress = clamp(", dive_team)
        self.assertIn("this.scrollOffsetY", dive_team)
        self.assertIn("dataset.abyssalDiverDescent", dive_team)
        self.assertIn("diver.velocityX = velocityX", dive_team)
        self.assertIn("setLightingOpacity(value)", heat_haze)
        self.assertIn("this.godRayStrength * this.lightingOpacity", heat_haze)
        self.assertIn("illuminationDecay *= 0.76", heat_haze)
        self.assertIn("targetFps: 30", source)
        self.assertNotIn("setEnvironmentalLightingEnabled(false)", source)
        self.assertIn("setFireLightingEnabled(false)", source)
        self.assertIn("background: repeating-linear-gradient(180deg", source)
        self.assertIn("opacity: .18", source)
        self.assertTrue(artwork.is_file())
        self.assertGreater(artwork.stat().st_size, 80_000)
        self.assertTrue(light_texture.is_file())
        self.assertGreater(light_texture.stat().st_size, 20_000)
        fauna_assets = ROOT / "tests" / "assets" / "abyssal-fauna"
        for species in ("eelpout", "sculpin"):
            for sheet in range(1, 4):
                asset = fauna_assets / f"{species}-sheet-{sheet}-v1.png"
                self.assertTrue(asset.is_file())
                self.assertGreater(asset.stat().st_size, 80_000)
        smoke_assets = ROOT / "tests" / "assets" / "abyssal-layers"
        for sheet in range(1, 4):
            asset = smoke_assets / f"smoke-atlas-{sheet}-v3.png"
            self.assertTrue(asset.is_file())
            self.assertGreater(asset.stat().st_size, 300_000)

    def test_v3_diver_manifest_frames_are_complete_and_verified(self):
        assets_root = ROOT / "tests" / "assets"
        manifest_path = assets_root / "abyssal-divers-v3" / "frames" / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertNotIn("source", manifest)
        referenced_frames = {
            "abyssal-divers-v3/frames/" + frame["file"]
            for role in manifest["roles"].values()
            for action in role["actions"].values()
            for frame in action["frames"]
        }

        required_assets = validate_abyssal_diver_v3_assets(assets_root)

        self.assertEqual(required_assets[0], "abyssal-divers-v3/frames/manifest.json")
        self.assertEqual(len(referenced_frames), 108)
        self.assertEqual(set(required_assets[1:]), referenced_frames)
        self.assertEqual(len(required_assets), 109)

    def test_v3_diver_inbetweens_preserve_opaque_silhouettes(self):
        frames_root = ROOT / "tests" / "assets" / "abyssal-divers-v3" / "frames"
        manifest = json.loads((frames_root / "manifest.json").read_text(encoding="utf-8"))
        builder = (ROOT / "tools" / "build_diver_frame_set.py").read_text(encoding="utf-8")

        self.assertIn("alpha = np.clip(weight, 0.0, 1.0) * 255.0", builder)
        self.assertIn("def _isolate_primary_subject", builder)
        for action_name, action in manifest["roles"]["leader"]["actions"].items():
            alpha_masses = []
            opaque_counts = []
            for entry in action["frames"]:
                alpha = Image.open(frames_root / entry["file"]).convert("RGBA").getchannel("A")
                histogram = alpha.histogram()
                alpha_masses.append(sum(value * count for value, count in enumerate(histogram)) / 255)
                opaque_counts.append(sum(histogram[224:]))
            with self.subTest(action=action_name):
                self.assertGreaterEqual(min(alpha_masses) / max(alpha_masses), 0.9)
                self.assertGreaterEqual(min(opaque_counts), 20_000)

    def test_v3_diver_manifest_rejects_unsafe_missing_or_corrupt_frames(self):
        source_frames = ROOT / "tests" / "assets" / "abyssal-divers-v3" / "frames"
        source_manifest = json.loads(
            (source_frames / "manifest.json").read_text(encoding="utf-8")
        )
        source_frame = source_manifest["roles"]["leader"]["actions"]["swim"]["frames"][0]
        source_png = source_frames / source_frame["file"]
        canvas = source_manifest["canvas"]
        cases = (
            ("path traversal", "../outside.png", source_frame["sha256"], canvas, ValueError, "unsafe PNG path"),
            ("missing frame", "leader/swim/99.png", source_frame["sha256"], canvas, FileNotFoundError, "is missing"),
            ("hash mismatch", source_frame["file"], "0" * 64, canvas, ValueError, "hash mismatch"),
            (
                "dimension mismatch",
                source_frame["file"],
                source_frame["sha256"],
                {"width": canvas["width"] + 1, "height": canvas["height"]},
                ValueError,
                "expected",
            ),
        )
        for case_name, frame_name, digest, case_canvas, error_type, error_text in cases:
            with self.subTest(case=case_name), tempfile.TemporaryDirectory() as temp_dir:
                assets_root = Path(temp_dir)
                frames_root = assets_root / "abyssal-divers-v3" / "frames"
                frames_root.mkdir(parents=True)
                if frame_name == source_frame["file"]:
                    destination = frames_root.joinpath(*frame_name.split("/"))
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source_png, destination)
                fixture_manifest = {
                    "version": 3,
                    "canvas": case_canvas,
                    "roles": {
                        "leader": {
                            "actions": {
                                "swim": {
                                    "frames": [{"file": frame_name, "sha256": digest}],
                                }
                            }
                        }
                    },
                }
                (frames_root / "manifest.json").write_text(
                    json.dumps(fixture_manifest), encoding="utf-8"
                )
                with self.assertRaisesRegex(error_type, error_text):
                    validate_abyssal_diver_v3_assets(assets_root)

    def test_runtime_info_is_a_module_safe_cinematic_package(self):
        demo_root = ROOT / "tests" / "playground" / "src" / "demos"
        facade = (demo_root / "runtimeInfo.js").read_text(encoding="utf-8")
        imports, exports = parse_module(facade)
        self.assertEqual(imports, [])
        self.assertEqual(len(exports), 1)
        self.assertEqual(find_executable_import_meta(facade), [])
        self.assertIn("export { default } from './runtimeInfo/index.js'", facade)

        package = demo_root / "runtimeInfo"
        index = (package / "index.js").read_text(encoding="utf-8")
        soundtrack = (package / "soundtrack.js").read_text(encoding="utf-8")
        visualizer = (package / "visualizer.js").read_text(encoding="utf-8")
        shaders = (package / "shaders.js").read_text(encoding="utf-8")
        self.assertIn("soundtrack.attemptAutoplay()", index)
        self.assertIn("document.addEventListener('pointerdown', recoverAutoplay, true)", index)
        self.assertIn("document.addEventListener('keydown', recoverAutoplay, true)", index)
        self.assertNotIn("unlockFromGesture", index)
        self.assertIn("averageFrequencyBand", soundtrack)
        self.assertIn("30, 180", soundtrack)
        self.assertIn("2400, 12000", soundtrack)
        self.assertIn("globalThis.clearInterval(timer)", soundtrack)
        self.assertIn("rgba16float", visualizer)
        self.assertIn("sceneFragment", shaders)
        self.assertIn("feedbackFragment", shaders)
        self.assertIn("presentFragment", shaders)

    def test_release_site_copies_the_generated_metrics_artifact(self):
        source = (ROOT / "bundler" / "site.py").read_text(encoding="utf-8")
        runtime_assets = set(release_site_static_asset_paths(ROOT))
        expected_assets = {
            "code-metrics.json",
            "abyssal-backdrop.js",
            "abyssal-fauna.js",
            "abyssal-smoke.js",
            "underwater-silt.js",
            "abyssal-layers/mineral-base-v4.webp",
            "abyssal-layers/godray-breakup-v1.webp",
            "abyssal-layers/smoke-atlas-1-v3.png",
            "abyssal-layers/smoke-atlas-2-v3.png",
            "abyssal-layers/smoke-atlas-3-v3.png",
            "abyssal-layers/smoke-far-v2.png",
            "abyssal-layers/foreground-rocks-v2.png",
            "abyssal-divers-v3/frames/manifest.json",
            "abyssal-divers-v3/frames/leader/swim/00.png",
        }
        self.assertTrue(expected_assets.issubset(runtime_assets))
        excluded_assets = {
            "elemental-background.js",
            "elemental-field-v1.webp",
            "elemental-field-v2.webp",
            "abyssal-layers/base-clean-v3.webp",
            "abyssal-layers/foreground-rocks-v1.png",
            "abyssal-layers/smoke-far-v1.png",
            "abyssal-layers/smoke-near-v1.png",
            "abyssal-divers-v2/PROVENANCE.json",
            "abyssal-divers-v3/PROVENANCE.json",
            "abyssal-divers-v3/diver-master-alpha-v3.png",
            "abyssal-divers-v3/diver-master-source-v3.png",
        }
        self.assertTrue(excluded_assets.isdisjoint(runtime_assets))
        for asset_name in excluded_assets:
            self.assertFalse((ROOT / "tests" / "assets" / asset_name).exists())
        self.assertNotIn('for source in sorted(family_source.rglob("*"))', source)
        self.assertIn("release_site_static_asset_paths(root)", source)
        for asset_name in ECOSYSTEM_PAGE_ASSETS:
            self.assertIn(f"abyssal-fauna/{asset_name}", runtime_assets)
        for asset_name in DIVER_V2_PAGE_ASSETS:
            self.assertIn(f"abyssal-divers-v2/{asset_name}", runtime_assets)
        self.assertIn("<script type=\"module\" src=\"./src/main.js?v=", source)
        self.assertIn("core/engine.js awaits its shared promise", source)
        self.assertIn('f"{bundle_name}.min.js.gz"', source)
        self.assertIn("crypto.subtle.digest('SHA-384', sourceBytes)", source)
        self.assertIn("globalThis.__PE_RUNTIME_READY = ready", source)
        self.assertNotIn("s.textContent = code", source)
        self.assertIn("pipeThrough(new DecompressionStream('gzip'))", source)
        self.assertIn('replace("../../../plauna/motion/", "../../plauna/motion/")', source)
        main = (ROOT / "tests" / "playground" / "src" / "main.js").read_text(encoding="utf-8")
        engine_loader = (ROOT / "tests" / "playground" / "src" / "core" / "engine.js").read_text(encoding="utf-8")
        self.assertIn("Hydrate engine-backed demos in parallel", main)
        self.assertIn("window.__PE_RUNTIME_READY", engine_loader)
        self.assertIn("new URLSearchParams(location.search).get('demo')", main)
        self.assertIn("demo.id === requestedDemoId", main)
        self.assertNotIn("try { await loadEngine();", main)
        morphfield_demo = (ROOT / "tests" / "playground" / "src" / "demos" / "morphField.js").read_text(encoding="utf-8")
        self.assertIn("id: 'morphfield-r2'", morphfield_demo)
        self.assertIn("const MorphField = Engine.MorphField", morphfield_demo)
        cli = (ROOT / "bundler" / "cli.py").read_text(encoding="utf-8")
        self.assertIn('"repository_metrics": "code-metrics.json"', cli)
        self.assertIn('"browser_runtime_compression": "gzip"', cli)
        self.assertIn('"browser_runtime_decoded_bytes": min_size', cli)
        self.assertIn('"browser_runtime_integrity": sri_hash', cli)
        self.assertIn("collect_code_metrics(ROOT)", cli)
        self.assertIn('"morphfield/index.html"', cli)
        self.assertIn('"playground/src/demos/morphField.js"', cli)
        self.assertIn("for relative_path in release_site_static_asset_paths(ROOT)", cli)
        self.assertIn("release_site_static_asset_source(root, root / \"release\"", cli)
        self.assertIn('f"assets/{args.name}.min.js{best_ext}"', cli)
        self.assertNotIn('f"assets/{args.name}.min.js",', cli)
        self.assertIn('f"assets/{args.name}.min.js.gz"', cli)
        self.assertIn('"assets/release-runtime-loader.js"', cli)
        self.assertIn('"editor/release-boot.js"', cli)
        self.assertIn("_required_playground_deployment_paths(ROOT)", cli)
        self.assertIn('"engine/render/morphfield/runtime/MorphFieldRenderer.js"', cli)
        self.assertIn("?demo=morphfield-r2", source)


if __name__ == "__main__":
    unittest.main()
