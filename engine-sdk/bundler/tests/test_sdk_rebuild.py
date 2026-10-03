# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""SDK rebuild trust evidence: editable source and immutable tooling boundaries."""

import base64
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest import mock

from bundler import sdk_rebuild, signing, site
from bundler import wasm
from bundler.tests.test_official_package_signing_lifecycle import (
    _copy_faculty_inputs, _root_identity, _write_trust,
)


def _input_records(root):
    return {path.relative_to(root).as_posix(): sdk_rebuild._record(path)
            for path in sorted(root.rglob("*")) if path.is_file() and ".trust-keys" not in path.parts
            and path.name not in {sdk_rebuild.SDK_BUILD_FILENAME, sdk_rebuild.SDK_REGISTRY_FILENAME, "requirements-sdk.txt"}}


class SDKRebuildTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="sdk-rebuild-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def _engine_fixture(self):
        source = self.root / "engine" / "version.js"
        source.parent.mkdir(parents=True)
        source.write_text("export const ENGINE_VERSION='1.0.0';\n", encoding="utf-8")
        tool = self.root / "bundler" / "config.py"
        tool.parent.mkdir()
        tool.write_text("CONFIG = 'reviewed'\n", encoding="utf-8")
        native = self.root / "engine" / "compute.wasm"
        native.write_bytes(b"\0asm\x01\0\0\0")
        sdk_rebuild.write_sdk_build_descriptor(self.root, self.root, "engine", _input_records(self.root))
        return source, tool, native

    def _platform_fixture(self):
        private, record = _root_identity()
        self.signing_identity = private, record
        _copy_faculty_inputs(self.root)
        _write_trust(self.root, private, record, include_private=True)
        app = self.root / "webgpu-os" / "apps" / "example"
        app.mkdir()
        (app / "manifest.json").write_text(json.dumps({"appId": "os.sdk-example", "name": "Example", "version": "1.0.0"}), encoding="utf-8")
        (app / "index.js").write_text("export default () => 7;\n", encoding="utf-8")
        preamble = signing.build_official_app_packages(self.root, write_generated_fallback=False, required=True)
        # The extracted SDK never contains the secret required by initial signing.
        (self.root / ".trust-keys" / f"{record['id']}.private.pem").unlink()
        records = _input_records(self.root)
        raw, _ = sdk_rebuild._registry_bytes(preamble)
        sdk_rebuild.write_sdk_build_descriptor(self.root, self.root, "platform", records, raw)
        return raw, app

    def _authorized_replacement(self):
        """Sign edited owners outside the extracted SDK using its admitted root."""
        private, record = self.signing_identity
        with tempfile.TemporaryDirectory(prefix="sdk-authorized-publisher-") as temporary:
            publisher = Path(temporary)
            shutil.copytree(self.root / "webgpu-os", publisher / "webgpu-os")
            _write_trust(publisher, private, record, include_private=True)
            preamble = signing.build_official_app_packages(publisher, write_generated_fallback=False, required=True)
        return sdk_rebuild._registry_bytes(preamble)[0]

    def _expire_registry_certificate(self, raw):
        records = json.loads(raw)
        certificate = records["os.sdk-example"]["envelope"]["cert"]
        certificate.update(notBefore="2020-01-01T00:00:00Z", notAfter="2021-01-01T00:00:00Z")
        unsigned = {key: value for key, value in certificate.items() if key != "issuerSig"}
        certificate["issuerSig"] = signing._ecdsa_raw_b64(
            self.signing_identity[0], json.dumps(unsigned, sort_keys=True, separators=(",", ":")).encode("utf-8"))
        return json.dumps(records, separators=(",", ":")).encode("utf-8")

    def _audited_compute_fixture(self):
        self._engine_fixture()
        repository = Path(__file__).resolve().parents[2]
        for relative in (wasm.ARTIFACT_ROOT, wasm.KERNEL_ROOT):
            shutil.copytree(repository / relative, self.root / relative)
        (self.root / "bundler/wasm.py").write_bytes((repository / "bundler/wasm.py").read_bytes())
        sdk_rebuild.write_sdk_build_descriptor(self.root, self.root, "engine", _input_records(self.root))

    def _runtime_fixture(self):
        self._engine_fixture()
        entries = ["engine/EngineBootstrap.js", "webgpu-os/apps/realmforge/material/studio/RealmForgeTextureStudio.js"]
        for entry in entries:
            path = self.root / entry
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("export const marker = 1;\n", encoding="utf-8")
        return {"target": "engine", "name": "particle-engine", "entries": entries,
                "production": False, "eager": True, "ns_ordered": True, "release": True,
                "extreme": True, "include_editor": False, "include_agi": False,
                "include_plauna": False, "include_webgpu_os": False, "site_profile": "engine"}

    def test_editable_engine_source_rebuild_uses_rjsmin_without_native_compilation(self):
        from bundler import builder
        original_esbuild = builder.HAS_ESBUILD
        self.addCleanup(setattr, builder, "HAS_ESBUILD", original_esbuild)
        source, _tool, _native = self._engine_fixture()
        source.write_text("export const ENGINE_VERSION='1.0.1';\n", encoding="utf-8")
        with mock.patch.object(sdk_rebuild, "verify_compute_artifacts") as verify:
            result = sdk_rebuild.prepare_sdk_rebuild(self.root, "engine")
        verify.assert_called_once_with(self.root.resolve(), check_source=True)
        self.assertIsNone(result["official_preamble"])
        self.assertFalse(builder.HAS_ESBUILD)

    def test_missing_editable_source_is_rejected(self):
        source, _tool, _native = self._engine_fixture()
        source.unlink()
        with self.assertRaisesRegex(ValueError, "Missing SDK build input"):
            sdk_rebuild.prepare_sdk_rebuild(self.root, "engine")

    def test_tampered_tool_and_native_binary_are_rejected_before_compute_checks(self):
        _source, tool, native = self._engine_fixture()
        for path in (tool, native):
            original = path.read_bytes()
            path.write_bytes(original + b"tamper")
            with self.subTest(path=path.name), mock.patch.object(sdk_rebuild, "verify_compute_artifacts") as verify:
                with self.assertRaisesRegex(ValueError, "immutable input hash/length mismatch"):
                    sdk_rebuild.prepare_sdk_rebuild(self.root, "engine")
                verify.assert_not_called()
            path.write_bytes(original)

    def test_selected_compression_tool_version_mismatch_fails(self):
        self._engine_fixture()
        actual = sdk_rebuild.sdk_tool_versions()
        actual["packages"]["zstandard"] = "0.0.0"
        with mock.patch.object(sdk_rebuild, "sdk_tool_versions", return_value=actual):
            with self.assertRaisesRegex(ValueError, "tool version mismatch: zstandard"):
                sdk_rebuild.prepare_sdk_rebuild(self.root, "engine")

    def test_public_assertions_and_updated_profile_remain_descriptor_immutable(self):
        self._engine_fixture()
        base = self.root / "sdk/public_tests"
        fixture = base / "fixtures/assertion.js"
        fixture.parent.mkdir(parents=True)
        fixture.write_bytes(b"export const assertion = () => 42 === 42;\n")
        resolver, runner = base / "resolver.js", base / "runner.js"
        resolver.write_bytes(b"export const resolveModule = name => name;\n")
        runner.write_bytes(b"export const run = assertion => assertion();\n")
        profile = base / "profile.json"
        profile.write_text(json.dumps({"files": {"fixtures/assertion.js": sdk_rebuild._record(fixture)}}), encoding="utf-8")
        descriptor = sdk_rebuild.write_sdk_build_descriptor(self.root, self.root, "engine", _input_records(self.root))
        descriptor_before = (self.root / sdk_rebuild.SDK_BUILD_FILENAME).read_bytes()
        originals = {path: path.read_bytes() for path in (fixture, resolver, runner, profile)}
        for path in originals:
            self.assertIn(path.relative_to(self.root).as_posix(), descriptor["immutable"])
        fixture.write_bytes(b"export const assertion = () => true;\n")
        profile.write_text(json.dumps({"files": {"fixtures/assertion.js": sdk_rebuild._record(fixture)}}), encoding="utf-8")
        with mock.patch.object(sdk_rebuild, "verify_compute_artifacts") as native:
            with self.assertRaisesRegex(ValueError, "immutable input hash/length mismatch"):
                sdk_rebuild.prepare_sdk_rebuild(self.root, "engine")
            native.assert_not_called()
        self.assertEqual((self.root / sdk_rebuild.SDK_BUILD_FILENAME).read_bytes(), descriptor_before)
        for path, original in originals.items():
            path.write_bytes(original)
        for path in (resolver, runner, profile):
            with self.subTest(path=path.name), mock.patch.object(sdk_rebuild, "verify_compute_artifacts") as native:
                path.write_bytes(originals[path] + b" ")
                with self.assertRaisesRegex(ValueError, "immutable input hash/length mismatch"):
                    sdk_rebuild.prepare_sdk_rebuild(self.root, "engine")
                native.assert_not_called()
                path.write_bytes(originals[path])

    def test_descriptor_records_actual_python_and_native_compression_environment(self):
        self._engine_fixture()
        descriptor = json.loads((self.root / sdk_rebuild.SDK_BUILD_FILENAME).read_text(encoding="utf-8"))
        self.assertEqual(descriptor["tools"], sdk_rebuild.sdk_tool_versions())
        self.assertEqual(descriptor["tools"]["nativeCompression"], {
            "zlib": {"compiled": zlib.ZLIB_VERSION, "runtime": zlib.ZLIB_RUNTIME_VERSION},
            "lzma": "python-stdlib-lzma2-xz",
        })
        requirements = (self.root / "requirements-sdk.txt").read_text(encoding="utf-8")
        self.assertIn(f"Requires Python {descriptor['tools']['python']}", requirements)

    def test_different_python_patch_version_is_rejected_before_native_checks(self):
        self._engine_fixture()
        actual = sdk_rebuild.sdk_tool_versions()
        major, minor, patch = actual["python"].split(".")
        actual["python"] = f"{major}.{minor}.{int(patch) + 1}"
        with mock.patch.object(sdk_rebuild, "sdk_tool_versions", return_value=actual), \
                mock.patch.object(sdk_rebuild, "verify_compute_artifacts") as verify:
            with self.assertRaisesRegex(ValueError, "Python version mismatch"):
                sdk_rebuild.prepare_sdk_rebuild(self.root, "engine")
        verify.assert_not_called()

    def test_missing_or_changed_native_compression_environment_is_rejected(self):
        self._engine_fixture()
        descriptor_path = self.root / sdk_rebuild.SDK_BUILD_FILENAME
        original = json.loads(descriptor_path.read_text(encoding="utf-8"))
        environments = (
            None,
            {"zlib": {"compiled": "0.0.0", "runtime": zlib.ZLIB_RUNTIME_VERSION}, "lzma": "python-stdlib-lzma2-xz"},
            {"zlib": {"compiled": zlib.ZLIB_VERSION, "runtime": "0.0.0"}, "lzma": "python-stdlib-lzma2-xz"},
            {"zlib": {"compiled": zlib.ZLIB_VERSION, "runtime": zlib.ZLIB_RUNTIME_VERSION}, "lzma": "unknown"},
        )
        for environment in environments:
            descriptor = {**original, "tools": {**original["tools"], "nativeCompression": environment}}
            descriptor_path.write_text(json.dumps(descriptor), encoding="utf-8")
            with self.subTest(environment=environment), mock.patch.object(sdk_rebuild, "verify_compute_artifacts") as verify:
                with self.assertRaisesRegex(ValueError, "native compression environment mismatch"):
                    sdk_rebuild.prepare_sdk_rebuild(self.root, "engine")
                verify.assert_not_called()

    def test_requirements_and_tools_cover_transitive_schema_and_crypto_dependencies(self):
        self._engine_fixture()
        packages = sdk_rebuild.sdk_tool_versions()["packages"]
        expected = {"attrs", "referencing", "rpds-py", "jsonschema-specifications", "cffi", "pycparser", "typing-extensions"}
        requirements = (self.root / "requirements-sdk.txt").read_text(encoding="utf-8")
        for name in expected:
            self.assertIn(name, packages)
            self.assertIn(f"{name}=={packages[name]}\n", requirements)
        incorrect = sdk_rebuild.sdk_tool_versions()
        incorrect["packages"]["referencing"] = "0.0.0"
        with mock.patch.object(sdk_rebuild, "sdk_tool_versions", return_value=incorrect):
            with self.assertRaisesRegex(ValueError, "tool version mismatch: referencing"):
                sdk_rebuild.prepare_sdk_rebuild(self.root, "engine")

    def test_existing_audited_compute_artifacts_rebuild_without_compiler_invocation(self):
        self._audited_compute_fixture()
        with mock.patch.object(wasm, "_run", side_effect=AssertionError("native compiler invoked")):
            result = sdk_rebuild.prepare_sdk_rebuild(self.root, "engine")
        self.assertEqual(result["descriptor"]["target"], "engine")

    def test_changed_kernel_source_rejects_stale_native_artifacts(self):
        self._audited_compute_fixture()
        source = next((self.root / wasm.KERNEL_ROOT / "src").glob("*.rs"))
        source.write_bytes(source.read_bytes() + b"\n// changed native source\n")
        with self.assertRaisesRegex(ValueError, "Stale compute kernels"):
            sdk_rebuild.prepare_sdk_rebuild(self.root, "engine")

    def test_input_path_escape_and_duplicate_json_keys_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "unsafe"):
            sdk_rebuild.write_sdk_build_descriptor(self.root, self.root, "engine", {"../evil.js": {"bytes": 0, "sha256": "0" * 64}})
        with self.assertRaisesRegex(ValueError, "Duplicate JSON key"):
            sdk_rebuild._registry_bytes(b'{"owner":{"x":1,"x":2}}')

    def test_input_mutation_between_copy_and_descriptor_is_rejected(self):
        path = self.root / "source.js"
        path.write_bytes(b"original")
        records = _input_records(self.root)
        path.write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "hash/length mismatch"):
            sdk_rebuild.write_sdk_build_descriptor(self.root, self.root, "engine", records)

    def test_runtime_configuration_replays_site_entry_and_all_output_shaping_flags(self):
        manifest = self._runtime_fixture()
        written = sdk_rebuild.write_sdk_build_descriptor(self.root, self.root, "engine", _input_records(self.root), runtime_manifest=manifest)
        with mock.patch.object(sdk_rebuild, "verify_compute_artifacts"):
            state = sdk_rebuild.prepare_sdk_rebuild(self.root, "engine")
        self.assertEqual(state["runtime"], written["runtime"])
        self.assertEqual(state["runtime"]["entries"], manifest["entries"])
        for flag in ("production", "eager", "ns_ordered", "release", "extreme"):
            self.assertEqual(state["runtime"][flag], manifest[flag])
        self.assertIsNone(state["runtime"]["base_url_root"])

    def test_invalid_runtime_configuration_rejects_unsafe_entries_and_unreplayable_flags(self):
        manifest = self._runtime_fixture()
        variations = (
            {"name": "../particle-engine"}, {"target": "webgpu-os"},
            {"entries": ["engine/version.js"]},
            {"entries": ["engine/EngineBootstrap.js", "../outside.js"]},
            {"entries": ["engine/EngineBootstrap.js", "engine/missing.js"]},
            {"production": "true"}, {"obfuscate": True}, {"embed_source_tree": True},
            {"zstd_dict_bytes": 512}, {"base_url_root": "../outside/"},
            {"release": False, "extreme": True},
        )
        for changes in variations:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                sdk_rebuild.write_sdk_build_descriptor(self.root, self.root, "engine", _input_records(self.root), runtime_manifest={**manifest, **changes})

    def test_platform_runtime_configuration_retains_generated_app_barrel(self):
        raw, _app = self._platform_fixture()
        entries = ["engine/EngineEditorBootstrap.js", "agi/index.js", "plauna/index.js",
                   "webgpu-os/index.js", "webgpu-os/.bundled-os-content.generated.js"]
        for entry in entries:
            path = self.root / entry
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("export const marker = 1;\n", encoding="utf-8")
        manifest = {"target": "platform", "name": "particle-platform", "entries": entries,
                    "production": True, "eager": True, "ns_ordered": False}
        sdk_rebuild.write_sdk_build_descriptor(self.root, self.root, "platform", _input_records(self.root), raw, runtime_manifest=manifest)
        with mock.patch.object(sdk_rebuild, "verify_compute_artifacts"):
            state = sdk_rebuild.prepare_sdk_rebuild(self.root, "platform")
        self.assertEqual(state["runtime"]["entries"], entries)
        self.assertEqual(state["runtime"]["base_url_root"], "webgpu-os/")

    def test_prepare_rejects_tampered_recorded_runtime_configuration(self):
        manifest = self._runtime_fixture()
        sdk_rebuild.write_sdk_build_descriptor(self.root, self.root, "engine", _input_records(self.root), runtime_manifest=manifest)
        path = self.root / sdk_rebuild.SDK_BUILD_FILENAME
        descriptor = json.loads(path.read_text(encoding="utf-8"))
        descriptor["runtime"]["encrypt"] = True
        path.write_text(json.dumps(descriptor), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "cannot replay wrapped"):
            sdk_rebuild.prepare_sdk_rebuild(self.root, "engine")

    def test_public_registry_bytes_and_property_order_survive_rebuild_without_signing(self):
        raw, _app = self._platform_fixture()
        with mock.patch.object(sdk_rebuild, "verify_compute_artifacts"), \
                mock.patch.object(signing, "_issue_ephemeral_publisher", side_effect=AssertionError("signer invoked")), \
                mock.patch.object(signing, "build_official_app_packages", side_effect=AssertionError("release signing invoked")), \
                mock.patch.object(signing, "prepare_development_faculty_fallbacks", side_effect=AssertionError("fallback refresh invoked")):
            result = sdk_rebuild.prepare_sdk_rebuild(self.root, "platform")
        self.assertEqual((self.root / sdk_rebuild.SDK_REGISTRY_FILENAME).read_bytes(), raw)
        self.assertEqual(result["official_preamble"], "globalThis.__OS_OFFICIAL_PACKAGES__=" + raw.decode("utf-8") + ";")
        self.assertFalse(list(self.root.rglob("*.pem")))

    def test_changed_signed_app_source_requires_authorized_replacement(self):
        _raw, app = self._platform_fixture()
        (app / "index.js").write_text("export default () => 8;\n", encoding="utf-8")
        with mock.patch.object(sdk_rebuild, "verify_compute_artifacts"):
            with self.assertRaisesRegex(ValueError, "signed app source/manifest changed"):
                sdk_rebuild.prepare_sdk_rebuild(self.root, "platform")

    def test_authorized_replacement_accepts_changed_owner_and_preserves_original_registry(self):
        original, app = self._platform_fixture()
        (app / "index.js").write_text("export default () => 8;\n", encoding="utf-8")
        replacement = self._authorized_replacement()
        with mock.patch.object(sdk_rebuild, "verify_compute_artifacts"), \
                mock.patch.object(signing, "_issue_ephemeral_publisher", side_effect=AssertionError("rebuild signer invoked")), \
                mock.patch.object(signing, "_synchronize_live_descriptor_fixtures", side_effect=AssertionError("fallback refresh invoked")):
            state = sdk_rebuild.prepare_sdk_rebuild(self.root, "platform", supplied_registry=replacement)
        self.assertEqual(state["official_preamble"], "globalThis.__OS_OFFICIAL_PACKAGES__=" + replacement.decode("utf-8") + ";")
        self.assertEqual((self.root / sdk_rebuild.SDK_REGISTRY_FILENAME).read_bytes(), original)
        self.assertEqual(state["official_container_assets"], {})
        self.assertFalse(list(self.root.rglob("*.pem")))

    def test_invalid_expired_or_mismatched_replacement_cannot_authorize_owner_changes(self):
        _original, app = self._platform_fixture()
        (app / "index.js").write_text("export default () => 8;\n", encoding="utf-8")
        replacement = self._authorized_replacement()
        invalid = json.loads(replacement)
        signature = invalid["os.sdk-example"]["envelope"]["signature"]
        signature["sig"] = ("A" if signature["sig"][0] != "A" else "B") + signature["sig"][1:]
        for raw, message in ((json.dumps(invalid).encode("utf-8"), "publisher signature is invalid"),
                             (self._expire_registry_certificate(replacement), "outside its validity window")):
            with self.subTest(message=message), mock.patch.object(sdk_rebuild, "verify_compute_artifacts"):
                with self.assertRaisesRegex(RuntimeError, message):
                    sdk_rebuild.prepare_sdk_rebuild(self.root, "platform", supplied_registry=raw)
        (app / "index.js").write_text("export default () => 9;\n", encoding="utf-8")
        with mock.patch.object(sdk_rebuild, "verify_compute_artifacts"):
            with self.assertRaisesRegex(ValueError, "signed app source/manifest changed"):
                sdk_rebuild.prepare_sdk_rebuild(self.root, "platform", supplied_registry=replacement)

    def test_authorized_replacement_accepts_changed_faculty_descriptor(self):
        original, _app = self._platform_fixture()
        fixture = self.root / "webgpu-os/kernel/navi/builtins/BuiltInToolDescriptorHashes.json"
        data = json.loads(fixture.read_text(encoding="utf-8"))
        key = next(iter(data["descriptorHashes"]))
        data["descriptorHashes"][key] = "sha256:256:" + "f" * 64
        fixture.write_text(json.dumps(data), encoding="utf-8")
        replacement = self._authorized_replacement()
        with mock.patch.object(sdk_rebuild, "verify_compute_artifacts"):
            state = sdk_rebuild.prepare_sdk_rebuild(self.root, "platform", supplied_registry=replacement)
        self.assertNotEqual(replacement, original)
        self.assertIn(replacement.decode("utf-8"), state["official_preamble"])
        self.assertEqual((self.root / sdk_rebuild.SDK_REGISTRY_FILENAME).read_bytes(), original)

    def test_replacement_renewal_does_not_admit_expired_original_packages(self):
        original, _app = self._platform_fixture()
        replacement = self._authorized_replacement()
        registry = self.root / sdk_rebuild.SDK_REGISTRY_FILENAME
        registry.write_bytes(self._expire_registry_certificate(original))
        descriptor_path = self.root / sdk_rebuild.SDK_BUILD_FILENAME
        descriptor = json.loads(descriptor_path.read_text(encoding="utf-8"))
        descriptor["immutable"][sdk_rebuild.SDK_REGISTRY_FILENAME] = sdk_rebuild._record(registry)
        descriptor_path.write_text(json.dumps(descriptor), encoding="utf-8")
        with mock.patch.object(sdk_rebuild, "verify_compute_artifacts"):
            with self.assertRaisesRegex(RuntimeError, "outside its validity window"):
                sdk_rebuild.prepare_sdk_rebuild(self.root, "platform")
            state = sdk_rebuild.prepare_sdk_rebuild(self.root, "platform", supplied_registry=replacement)
        self.assertIn(replacement.decode("utf-8"), state["official_preamble"])

    def test_replacement_cannot_change_original_immutable_tools_or_trust_roots(self):
        original, _app = self._platform_fixture()
        roots = self.root / "webgpu-os/kernel/trust/roots.json"
        roots.write_bytes(roots.read_bytes() + b"\n")
        with mock.patch.object(sdk_rebuild, "verify_compute_artifacts") as verify:
            with self.assertRaisesRegex(ValueError, "immutable input hash/length mismatch"):
                sdk_rebuild.prepare_sdk_rebuild(self.root, "platform", supplied_registry=original)
        verify.assert_not_called()

    def test_engine_sdk_rejects_explicit_signed_registry(self):
        self._engine_fixture()
        with mock.patch.object(sdk_rebuild, "verify_compute_artifacts") as verify:
            with self.assertRaisesRegex(ValueError, "requires the Platform SDK"):
                sdk_rebuild.prepare_sdk_rebuild(self.root, "engine", supplied_registry=b"{}")
        verify.assert_not_called()

    def test_pretty_assignment_preserves_exact_json_bytes_and_rejects_executable_prefix_or_suffix(self):
        raw = b'\n  {\n    "owner": {"z": 1, "a": 2}\n  }\n  '
        preserved, records = sdk_rebuild._registry_bytes(b" \n" + b"globalThis.__OS_OFFICIAL_PACKAGES__=" + raw + b";\n")
        self.assertEqual(preserved, raw)
        self.assertEqual(list(records["owner"]), ["z", "a"])
        with_comment, _records = sdk_rebuild._registry_bytes(b"// Authorized public registry\n/* reviewed */\n"
                                                            b"globalThis.__OS_OFFICIAL_PACKAGES__=" + raw + b";")
        self.assertEqual(with_comment, raw)
        for source in (b"alert(1);globalThis.__OS_OFFICIAL_PACKAGES__=" + raw + b";",
                       b"globalThis.__OS_OFFICIAL_PACKAGES__=" + raw + b";alert(1);"):
            with self.subTest(source=source), self.assertRaises(ValueError):
                sdk_rebuild._registry_bytes(source)

    def test_replacement_external_containers_are_verified_and_returned_without_registry_rewrite(self):
        original, app = self._platform_fixture()
        (app / "index.js").write_text("export default () => 8;\n", encoding="utf-8")
        records = json.loads(self._authorized_replacement())
        package = records["os.sdk-example"]
        data = base64.b64decode(package.pop("container"))
        import hashlib
        logical = "official-packages/" + hashlib.sha256(data).hexdigest() + ".prpkg"
        sidecar = self.root / "dist" / logical
        sidecar.parent.mkdir(parents=True)
        sidecar.write_bytes(data)
        package["containerRef"] = {"format": "particle-official-container-v1", "path": logical, **sdk_rebuild._record(sidecar)}
        raw = json.dumps(records, indent=2).encode("utf-8")
        with mock.patch.object(sdk_rebuild, "verify_compute_artifacts"):
            state = sdk_rebuild.prepare_sdk_rebuild(self.root, "platform", supplied_registry=raw)
        self.assertEqual(state["official_container_assets"], {logical: data})
        self.assertEqual(state["official_preamble"], "globalThis.__OS_OFFICIAL_PACKAGES__=" + raw.decode("utf-8") + ";")
        self.assertEqual((self.root / sdk_rebuild.SDK_REGISTRY_FILENAME).read_bytes(), original)
        sidecar.write_bytes(data + b"corrupt")
        with mock.patch.object(sdk_rebuild, "verify_compute_artifacts"):
            with self.assertRaisesRegex(ValueError, "container hash/length mismatch"):
                sdk_rebuild.prepare_sdk_rebuild(self.root, "platform", supplied_registry=raw)

    def test_changed_faculty_descriptor_requires_authorized_replacement(self):
        self._platform_fixture()
        fixture = self.root / "webgpu-os/kernel/navi/builtins/BuiltInToolDescriptorHashes.json"
        data = json.loads(fixture.read_text(encoding="utf-8"))
        key = next(iter(data["descriptorHashes"]))
        data["descriptorHashes"][key] = "sha256:256:" + "f" * 64
        fixture.write_text(json.dumps(data), encoding="utf-8")
        with mock.patch.object(sdk_rebuild, "verify_compute_artifacts"):
            with self.assertRaisesRegex(ValueError, "signed Faculty source changed"):
                sdk_rebuild.prepare_sdk_rebuild(self.root, "platform")

    def test_corrupt_registry_is_rejected_even_when_descriptor_hash_is_updated(self):
        raw, _app = self._platform_fixture()
        records = json.loads(raw)
        package = records["os.sdk-example"]
        signature = package["envelope"]["signature"]["sig"]
        package["envelope"]["signature"]["sig"] = ("A" if signature[0] != "A" else "B") + signature[1:]
        registry = self.root / sdk_rebuild.SDK_REGISTRY_FILENAME
        registry.write_text(json.dumps(records), encoding="utf-8")
        descriptor_path = self.root / sdk_rebuild.SDK_BUILD_FILENAME
        descriptor = json.loads(descriptor_path.read_text(encoding="utf-8"))
        descriptor["immutable"][sdk_rebuild.SDK_REGISTRY_FILENAME] = sdk_rebuild._record(registry)
        descriptor_path.write_text(json.dumps(descriptor), encoding="utf-8")
        with mock.patch.object(sdk_rebuild, "verify_compute_artifacts"):
            with self.assertRaisesRegex(RuntimeError, "publisher signature is invalid"):
                sdk_rebuild.prepare_sdk_rebuild(self.root, "platform")

    def test_expired_signed_certificate_is_rejected_at_current_time(self):
        raw, _app = self._platform_fixture()
        records = json.loads(raw)
        import datetime
        future = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=500)
        with self.assertRaisesRegex(RuntimeError, "outside its validity window"):
            signing.verify_official_package_records(records, signing._load_ring0_roots(self.root), verification_time=future)

    def test_projection_uses_shared_signing_contract_without_a_private_key(self):
        raw, _app = self._platform_fixture()
        records = json.loads(raw)
        faculty = {key: record for key, record in records.items() if key.startswith("os.navi-faculty.")}
        with mock.patch.object(signing, "_issue_ephemeral_publisher", side_effect=AssertionError("signer invoked")):
            projected = signing._expected_faculty_revision_projection(self.root, None)
        self.assertEqual(projected, signing._faculty_revision_projection(faculty))


class SDKDocsPreparationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="sdk-docs-preparation-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.key = str(self.root.resolve()).casefold()
        self.addCleanup(site._DOCS_PREPARED_ROOTS.discard, self.key)
        docs = self.root / "MD"
        (docs / "tools").mkdir(parents=True)
        for name in ("extract_api.py", "build_docs.py", "build_llms.py", "build_bundle.py", "validate_docs.py"):
            (docs / "tools" / name).write_text("raise SystemExit(0)\n", encoding="utf-8")
        (docs / "viewer").mkdir()
        (docs / "viewer/index.html").write_text("<!doctype html><title>Docs</title>", encoding="utf-8")
        (docs / "_config").mkdir()
        (docs / "_config/docs-bundle.json.gz").write_bytes(b"bundled fixture")
        (docs / "_config/nav.json").write_text('{"sections": []}', encoding="utf-8")
        (docs / "index.md").write_text("# Fixture docs\n", encoding="utf-8")
        for name in ("llms.txt", "llms-full.txt", "api-index.json", "docs-chunks.jsonl",
                     "api-symbols.jsonl", "robots.txt", "sitemap.xml"):
            (docs / name).write_text(name, encoding="utf-8")
            (self.root / name).write_text(name, encoding="utf-8")

    def test_preparation_before_snapshot_is_reused_by_site_laydown(self):
        completed = mock.Mock(returncode=0, stdout="", stderr="")
        with mock.patch.object(site._subprocess, "run", return_value=completed) as run:
            self.assertTrue(site._prepare_md_docs(self.root))
            prepared_input = (self.root / "MD/index.md").read_bytes()
            stage = self.root / "published"
            copied = site._lay_down_md_docs(stage, self.root)
        self.assertGreater(copied, 0)
        self.assertEqual(run.call_count, 5)
        self.assertEqual((stage / "MD/index.md").read_bytes(), prepared_input)
        self.assertIn(self.key, site._DOCS_PREPARED_ROOTS)

    def test_failed_generation_does_not_mark_docs_prepared(self):
        failure = mock.Mock(returncode=1, stdout="", stderr="fixture build failure")
        with mock.patch.object(site._subprocess, "run", return_value=failure):
            with self.assertRaisesRegex(RuntimeError, "Documentation release gate failed"):
                site._prepare_md_docs(self.root)
        self.assertNotIn(self.key, site._DOCS_PREPARED_ROOTS)


class SDKStandaloneBundlerImportTests(unittest.TestCase):
    def test_engine_bundler_import_does_not_require_unshipped_os_sources(self):
        repository = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory(prefix="sdk-engine-import-") as temporary:
            root = Path(temporary)
            shutil.copytree(repository / "bundler", root / "bundler",
                            ignore=shutil.ignore_patterns("__pycache__", "tests"))
            command = ("import json,sys;sys.path.insert(0,'.');from bundler import cli,site;"
                       "print(json.dumps(site.WEBGPU_OS_STABLE_BOOTSTRAP_ASSET_PATHS))")
            imported = subprocess.run([sys.executable, "-I", "-c", command], cwd=root,
                                      capture_output=True, text=True, timeout=30)
            self.assertEqual(imported.returncode, 0, imported.stderr)
            self.assertEqual(json.loads(imported.stdout), [])
            # Declaring the OS launcher makes this a platform source scope;
            # incomplete bootstrap assets must still fail closed at import.
            (root / "webgpu-os").mkdir()
            (root / "webgpu-os/index.html").write_text("<!doctype html>", encoding="utf-8")
            incomplete = subprocess.run([sys.executable, "-I", "-c", command], cwd=root,
                                        capture_output=True, text=True, timeout=30)
            self.assertNotEqual(incomplete.returncode, 0)
            self.assertIn("Required stable WebGPU OS bootstrap assets are missing", incomplete.stderr)

    def test_explicit_os_publisher_requires_bootstrap_even_when_import_scope_is_engine(self):
        with tempfile.TemporaryDirectory(prefix="sdk-os-publisher-") as temporary:
            root = Path(temporary)
            source = root / "webgpu-os"
            source.mkdir()
            destination = root / "published"
            with mock.patch.object(site, "WEBGPU_OS_STABLE_BOOTSTRAP_ASSET_PATHS", ()):
                with self.assertRaisesRegex(FileNotFoundError, "index.html"):
                    site.lay_down_webgpu_os_pwa_assets(source, destination)
                with mock.patch.object(site, "ROOT", root):
                    with self.assertRaisesRegex(FileNotFoundError, "index.html"):
                        site.validate_webgpu_os_deployment(destination)
            self.assertFalse(destination.exists())

    def test_root_aware_bootstrap_inventory_preserves_canonical_platform_values(self):
        repository = Path(__file__).resolve().parents[2]
        self.assertEqual(site._webgpu_os_stable_bootstrap_asset_paths(repository),
                         site.WEBGPU_OS_STABLE_BOOTSTRAP_ASSET_PATHS)
        with tempfile.TemporaryDirectory(prefix="sdk-os-inventory-") as temporary:
            root = Path(temporary)
            source = root / "webgpu-os"
            fixed = {"index.html", "runtime.html", "boot-theme.js", "BrandMark.js", "BrandMark.css",
                     "BrandMarkSurface.js", "shared/EchoFormProfile.js", "shared/EchoForm.js", "shared/EchoForm.css",
                     site.STABLE_RESOURCE_INVENTORY_REPOSITORY_PATH.removeprefix("webgpu-os/")}
            local = {folder + "/local.js" for folder in site.WEBGPU_OS_STABLE_BOOTSTRAP_DIRECTORY_PATHS}
            for relative in fixed | local | set(site._WEBGPU_OS_PWA_FIXED_ASSET_PATHS):
                path = source / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(relative.encode("utf-8"))
            self.assertEqual(set(site._webgpu_os_stable_bootstrap_asset_paths(root)), fixed | local)
            with mock.patch.object(site, "WEBGPU_OS_STABLE_BOOTSTRAP_ASSET_PATHS", ()):
                count = site.lay_down_webgpu_os_pwa_assets(source, root / "published")
            self.assertEqual(count, len(site._WEBGPU_OS_PWA_FIXED_ASSET_PATHS) + len(fixed | local))
            self.assertEqual((root / "published/bootstrap/local.js").read_bytes(), b"bootstrap/local.js")


if __name__ == "__main__":
    unittest.main()
