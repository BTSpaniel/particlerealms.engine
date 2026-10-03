# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Engine SDK UI admission, source inventory and offline rebuild regressions."""

import io
import tempfile
import unittest
from contextlib import ExitStack, redirect_stdout
from pathlib import Path
from unittest import mock

from bundler import builder, cli, sdk, sdk_rebuild, signing
from bundler.tests import test_cli_output_integrity as preflight_tests
from bundler.tests.test_sdk import docs_contract_fixture, write
from bundler.tests.test_sdk_rebuild import _input_records


class EnginePlaunaSdkTests(unittest.TestCase):
    def test_cli_admits_optional_plauna_and_preserves_plain_engine_default(self):
        preflight = preflight_tests.TestSdkConfigurationPreflight()
        for options in ([], ["--include-plauna"]):
            with self.subTest(options=options):
                result, diagnostic, native_calls = preflight._run_before_native(
                    ["--target", "engine", "--sdk-only", "--production", *options])
                self.assertEqual(result, 1)
                self.assertIn("native contract gate reached", diagnostic)
                self.assertEqual(native_calls, 1)

    def test_cli_rejects_platform_subsystems_before_native_checks_or_writes(self):
        preflight = preflight_tests.TestSdkConfigurationPreflight()
        for flag in ("--include-editor", "--include-agi", "--include-webgpu-os"):
            with self.subTest(flag=flag):
                result, diagnostic, native_calls = preflight._run_before_native(
                    ["--target", "engine", "--sdk-only", "--include-plauna", flag])
                self.assertEqual(result, 2)
                self.assertIn("require platform", diagnostic)
                self.assertEqual(native_calls, 0)

    def test_cli_rebuild_admits_recorded_ui_and_rejects_recorded_platform_flags(self):
        preflight = preflight_tests.TestSdkConfigurationPreflight()
        runtime = {**preflight._platform_runtime(), "name": "particle-engine",
                   "entries": ["engine/EngineBootstrap.js", "plauna/index.js"], "eager": False,
                   "include_editor": False, "include_agi": False, "include_webgpu_os": False,
                   "site_profile": "engine", "base_url_root": None}
        flags = ["--sdk-rebuild", "--target", "engine"]
        result, diagnostic, native_calls = preflight._run_before_native(flags, runtime=runtime)
        self.assertEqual(result, 1)
        self.assertIn("native contract gate reached", diagnostic)
        self.assertEqual(native_calls, 1)
        for field in ("include_editor", "include_agi", "include_webgpu_os"):
            with self.subTest(field=field):
                result, diagnostic, native_calls = preflight._run_before_native(
                    flags, runtime={**runtime, field: True})
                self.assertEqual(result, 2)
                self.assertIn("select platform", diagnostic)
                self.assertEqual(native_calls, 0)

    def test_full_plauna_inventory_invalidates_engine_sdk_cache_without_website(self):
        with tempfile.TemporaryDirectory() as temporary, ExitStack() as patches:
            root = Path(temporary)
            for name in ("bundle_engine.py", "release_targets.json", "LICENSE", "NOTICE.md", "AUTHORS",
                         "SECURITY.md", "SUPPORT.md", "CHANGELOG.md"):
                write(root, name, name)
            docs_contract_fixture(root)
            plauna = {"plauna/index.js": "export const createPlaunaApp = () => 1;\n",
                      "plauna/ui/UnreferencedWidget.js": "export const revision = 1;\n",
                      "plauna/style/theme.css": ":root { --accent: #123456; }\n",
                      "plauna/LICENSE.txt": "Preserved source license\n"}
            for name, source in plauna.items():
                write(root, name, source)
            for name in ("release_site_sidecar_asset_manifest", "document_runtime_asset_manifest",
                         "_morphfield_schema_sources"):
                patches.enter_context(mock.patch.object(sdk.site, name, return_value=[]))
            patches.enter_context(mock.patch.object(sdk, "physics_release_asset_paths", return_value=[]))
            snapshot = sdk.sdk_input_snapshot(root, "engine")
            baseline = cli._release_build_input_digest(root, include_site=False, include_sdk=True, target="engine")
            for name in plauna:
                with self.subTest(name=name):
                    self.assertEqual(snapshot["mapping"][name], name)
                    path = root / name
                    original = path.read_bytes()
                    path.write_bytes(original + b"\n/* Changed canonical UI input. */\n")
                    self.assertNotEqual(cli._release_build_input_digest(
                        root, include_site=False, include_sdk=True, target="engine"), baseline)
                    with self.assertRaisesRegex(ValueError, "SDK input changed during assembly"):
                        sdk._verify_snapshot(root, snapshot)
                    path.write_bytes(original)
            write(root, "plauna/ui/NewWidget.js", "export const added = true;\n")
            with self.assertRaisesRegex(ValueError, "SDK input membership changed during assembly"):
                sdk._verify_snapshot(root, snapshot)

    def test_offline_descriptor_replays_plauna_without_signing_or_fallback_refresh(self):
        with tempfile.TemporaryDirectory() as temporary, ExitStack() as patches:
            root = Path(temporary)
            write(root, "engine/EngineBootstrap.js", "export const createWorld = () => ({});\n")
            write(root, "plauna/index.js", "export const createPlaunaApp = () => ({});\n")
            write(root, "bundler/config.py", "BACKEND = 'rjsmin'\n")
            manifest = {"target": "engine", "name": "particle-engine", "production": True,
                        "entries": ["engine/EngineBootstrap.js", "plauna/index.js"],
                        "include_plauna": True, "eager": False}
            patches.enter_context(redirect_stdout(io.StringIO()))
            written = sdk_rebuild.write_sdk_build_descriptor(
                root, root, "engine", _input_records(root), runtime_manifest=manifest)
            patches.enter_context(mock.patch.object(sdk_rebuild, "verify_compute_artifacts"))
            patches.enter_context(mock.patch.object(builder, "HAS_ESBUILD", False))
            patches.enter_context(mock.patch.object(signing, "build_official_app_packages",
                                                    side_effect=AssertionError("signer invoked")))
            patches.enter_context(mock.patch.object(signing, "prepare_development_faculty_fallbacks",
                                                    side_effect=AssertionError("fallback refreshed")))
            state = sdk_rebuild.prepare_sdk_rebuild(root, "engine")
            self.assertEqual(state["runtime"], written["runtime"])
            self.assertTrue(state["runtime"]["include_plauna"])
            self.assertEqual(state["runtime"]["entries"], manifest["entries"])
            self.assertIsNone(state["official_preamble"])
            self.assertIsNone(written["officialRegistry"])
            self.assertEqual(written["signedOwners"], {})

    def test_recorded_engine_configuration_rejects_other_subsystems_and_ui_mismatch(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write(root, "engine/EngineBootstrap.js", "export const marker = 1;\n")
            write(root, "plauna/index.js", "export const marker = 2;\n")
            manifest = {"target": "engine", "name": "particle-engine",
                        "entries": ["engine/EngineBootstrap.js", "plauna/index.js"],
                        "include_plauna": True}
            for changes in ({"include_editor": True}, {"include_agi": True},
                            {"include_webgpu_os": True}, {"include_plauna": False},
                            {"entries": ["engine/EngineBootstrap.js"]}):
                with self.subTest(changes=changes), self.assertRaises(ValueError):
                    sdk_rebuild._runtime_configuration(root, "engine", {**manifest, **changes})


if __name__ == "__main__":
    unittest.main()
