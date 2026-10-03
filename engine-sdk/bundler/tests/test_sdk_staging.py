# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Canonical SDK staging rejects unsafe writes and accepts only verified outputs."""

from __future__ import annotations

import copy
import importlib.util
import io
import json
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from bundler import cli, sdk, sdk_rebuild, signing, staging, wasm
from bundler.tests.test_sdk import sdk_fixture, write


def _arguments(**changes):
    values = dict(stage_dir="unused", production=True, sdk_only=True, target="engine",
                  name="particle-engine", build_site=False, build_sdk=True, sdk_no_archive=True,
                  eager=False, release=False, extreme=False, ns_order=False, include_editor=False,
                  include_agi=False, include_plauna=True, include_webgpu_os=False)
    values.update(changes)
    return SimpleNamespace(**values)


class StagePreflightTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="sdk-stage-tests-")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name).resolve()
        self.root = self.base / "source"
        self.root.mkdir()
        self.output = self.base / "candidate"

    def test_conflicting_flags_rejected_before_trust_or_output_actions(self):
        flags = ("--outdir", "--name", "--entry", "--targets-config", "--sync-consumer",
                 "--sync-consumer-assets-only", "--gen-roots", "--issue-cert", "--cert-out",
                 "--sdk-rebuild", "--sdk-packages", "--gen-dict", "--embed-source-tree",
                 "--obfuscate", "--encrypt", "--domain-lock", "--integrity", "--site-profile")
        for flag in flags:
            with self.subTest(flag=flag), self.assertRaisesRegex(ValueError, "conflicts"):
                staging.validate_stage_arguments(_arguments(), [flag + "=value"])
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.root.iterdir()), [])

    def test_explicit_production_sdk_only_are_required(self):
        for changes in ({"production": False}, {"sdk_only": False}):
            with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, "requires"):
                staging.validate_stage_arguments(_arguments(**changes), [])

    def test_fresh_external_destination_is_resolved_without_writes(self):
        self.assertEqual(staging.resolve_stage_destination(self.root, self.output), self.output)
        self.assertFalse(self.output.exists())

    def test_source_and_live_output_overlap_rejected(self):
        for path in (self.root, self.root / "release", self.root / "build", self.base):
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, "overlaps"):
                staging.resolve_stage_destination(self.root, path)

    def test_existing_destination_rejected_even_when_empty(self):
        self.output.mkdir()
        with self.assertRaisesRegex(ValueError, "fresh"):
            staging.resolve_stage_destination(self.root, self.output)

    def test_parent_traversal_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "traversal"):
            staging.resolve_stage_destination(self.root, self.base / "unused" / ".." / "candidate")

    def test_symlink_ancestor_cannot_redirect_a_candidate(self):
        alias = self.base / "redirect"
        try:
            alias.symlink_to(self.root, target_is_directory=True)
        except OSError as error:
            self.skipTest(f"Filesystem symlink privilege unavailable: {error}")
        with self.assertRaisesRegex(ValueError, "redirect"):
            staging.resolve_stage_destination(self.root, alias / "candidate")

    def test_resolved_source_alias_is_considered_source_overlap(self):
        # Resolving the canonical source is required even when the source was
        # handed to the CLI through an alias (e.g. Windows short paths).
        source_alias = self.base / "source-alias"
        try:
            source_alias.symlink_to(self.root, target_is_directory=True)
        except OSError as error:
            self.skipTest(f"Filesystem symlink privilege unavailable: {error}")
        with self.assertRaisesRegex(ValueError, "overlaps"):
            staging.resolve_stage_destination(source_alias, self.root / "release")

    def test_unsupported_target_and_noncanonical_entries_rejected(self):
        for args, entries in ((_arguments(target="webgpu-os"), ["webgpu-os/index.js"]),
                              (_arguments(name="custom"), ["engine/EngineBootstrap.js"]),
                              (_arguments(), ["plauna/index.js"]),
                              (_arguments(build_site=True), ["engine/EngineBootstrap.js"]),
                              (_arguments(extreme=True), ["engine/EngineBootstrap.js"])):
            with self.subTest(args=vars(args)), self.assertRaises(ValueError):
                staging.validate_stage_configuration(args, entries)

    def test_cli_rejects_output_conflict_before_compute_or_maintenance(self):
        argv = ["bundle_engine.py", "--production", "--sdk-only", "--stage-dir", str(self.output),
                "--gen-roots", "1"]
        with mock.patch.object(sys, "argv", argv), mock.patch.object(cli, "ROOT", self.root), \
                mock.patch.object(cli, "generate_ring0_roots") as roots, \
                mock.patch.object(wasm, "build_compute_kernels") as compute, \
                redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as failure:
                cli.main()
        self.assertEqual(failure.exception.code, 2)
        roots.assert_not_called()
        compute.assert_not_called()
        self.assertFalse(self.output.exists())

    def test_cli_stale_native_failure_creates_no_files(self):
        argv = ["bundle_engine.py", "--production", "--sdk-only", "--stage-dir", str(self.output)]
        targets = {"defaultTarget": "engine", "targets": {"engine": {
            "entry": ["engine/EngineBootstrap.js"], "name": "particle-engine"}}}
        write(self.root, "release_targets.json", json.dumps(targets))
        before = {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob("*") if p.is_file()}
        with mock.patch.object(sys, "argv", argv), mock.patch.object(cli, "ROOT", self.root), \
                mock.patch.object(cli, "DEFAULT_TARGETS_CONFIG", str(self.root / "release_targets.json")), \
                mock.patch.object(sdk_rebuild, "_verify_tools"), \
                mock.patch.object(staging, "verify_stage_inputs", side_effect=ValueError("Stale compute kernels")), \
                mock.patch.object(wasm, "build_compute_kernels") as compute, redirect_stdout(io.StringIO()):
            self.assertEqual(cli.main(), 1)
        compute.assert_not_called()
        self.assertFalse(self.output.exists())
        self.assertEqual(before, {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob("*") if p.is_file()})

    def test_cli_dry_run_uses_check_only_native_and_never_regenerates_source(self):
        from bundler import compute_contracts, site
        targets = {"defaultTarget": "engine", "targets": {"engine": {
            "entry": ["engine/EngineBootstrap.js"], "name": "particle-engine"}}}
        write(self.root, "release_targets.json", json.dumps(targets))
        source = write(self.root, "engine/EngineBootstrap.js", "export const Engine = {};\n")
        snapshot = {"sha256": "a" * 64, "records": {
            "engine/EngineBootstrap.js": {"source": "engine/EngineBootstrap.js", **staging._record(source)}}}
        argv = ["bundle_engine.py", "--production", "--sdk-only", "--sdk-no-archive",
                "--stage-dir", str(self.output), "--dry-run"]
        before = {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob("*") if p.is_file()}
        with mock.patch.object(sys, "argv", argv), mock.patch.object(cli, "ROOT", self.root), \
                mock.patch.object(cli, "DEFAULT_TARGETS_CONFIG", str(self.root / "release_targets.json")), \
                mock.patch.object(sdk_rebuild, "_verify_tools"), \
                mock.patch.object(staging, "verify_stage_inputs", return_value={}), \
                mock.patch.object(sdk, "sdk_input_snapshot", return_value=snapshot), \
                mock.patch.object(compute_contracts, "verify_compute_contracts"), \
                mock.patch.object(wasm, "build_compute_kernels", return_value={"cached": True, "manifest": {}}) as native, \
                mock.patch.object(site, "_prepare_md_docs") as documents, \
                mock.patch.object(cli, "build_official_app_packages") as signing_action, \
                mock.patch.object(cli, "sync_release_runtime_consumer") as consumers, redirect_stdout(io.StringIO()):
            self.assertIsNone(cli.main())
        native.assert_called_once_with(self.root, check=True)
        documents.assert_not_called()
        signing_action.assert_not_called()
        consumers.assert_not_called()
        self.assertFalse(self.output.exists())
        self.assertEqual(before, {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob("*") if p.is_file()})


class StageReceiptTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="sdk-stage-receipt-")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name).resolve()
        self.root = self.base / "source"
        source = write(self.root, "engine/input.js", "export const value=1;\n")
        self.stage = self.base / "candidate"
        self.stage.mkdir()
        self.receipt, _ = sdk_fixture(self.stage / "engine-sdk")
        (self.stage / "particle-engine-sdk.zip").unlink()
        self.manifest = self.receipt["bundle"]
        self.snapshot = {"sha256": self.receipt["buildInputsSha256"],
                         "records": {"engine/input.js": {"source": "engine/input.js", **staging._record(source)}}}
        self.inputs = {"compute": {"sourceHash": "fixture"}, "native": [], "signed": None,
                       "official_preamble": None, "official_container_assets": {}}
        shutil.copytree(self.stage / "engine-sdk/dist", self.stage / "runtime")
        write(self.stage, ".cache/.build_cache.v2", "fixture\n")

    def complete(self, **changes):
        with mock.patch.object(staging, "verify_stage_inputs", return_value=self.inputs):
            return staging.complete_stage(self.root, self.stage, _arguments(**changes),
                                          self.manifest, self.snapshot, self.inputs)

    def test_receipt_binds_actual_sdk_runtime_cache_and_recipe(self):
        result = self.complete()
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["sdk"]["sha256"], staging._record(self.stage / "engine-sdk/manifest.json")["sha256"])
        self.assertIn(".cache/.build_cache.v2", result["outputs"])
        self.assertIn("runtime/particle-engine.min.js.gz", result["outputs"])
        self.assertEqual(result["outputsSha256"], staging._digest(result["outputs"]))
        self.assertEqual(json.loads((self.stage / staging.STAGE_RECEIPT).read_text()), result)
        self.assertFalse(list(self.stage.glob("*.zip")))

    def test_source_mutation_rejected_without_candidate_receipt(self):
        write(self.root, "engine/input.js", "export const value=2;\n")
        with self.assertRaisesRegex(ValueError, "changed during assembly"):
            self.complete()
        self.assertFalse((self.stage / staging.STAGE_RECEIPT).exists())

    def test_native_identity_change_rejected_without_candidate_receipt(self):
        original = copy.deepcopy(self.inputs)
        self.inputs["native"] = [{"path": "native.wasm", "sha256": "new"}]
        with mock.patch.object(staging, "verify_stage_inputs", return_value=self.inputs):
            with self.assertRaisesRegex(ValueError, "inputs changed"):
                staging.complete_stage(self.root, self.stage, _arguments(), self.manifest, self.snapshot, original)
        self.assertFalse((self.stage / staging.STAGE_RECEIPT).exists())

    def test_tampered_sdk_rejected_by_shared_verifier(self):
        write(self.stage, "engine-sdk/engine/EngineBootstrap.js", "export const replaced=2;\n")
        with self.assertRaisesRegex(ValueError, "integrity mismatch"):
            self.complete()
        self.assertFalse((self.stage / staging.STAGE_RECEIPT).exists())

    def test_tampered_runtime_copy_rejected_even_when_sdk_is_intact(self):
        write(self.stage, "runtime/particle-engine.min.js", "globalThis.PE={};\n")
        with self.assertRaisesRegex(ValueError, "runtime differs"):
            self.complete()
        self.assertFalse((self.stage / staging.STAGE_RECEIPT).exists())

    def test_missing_runtime_metadata_rejected_even_when_sdk_is_intact(self):
        (self.stage / "runtime/particle-engine.provenance.json").unlink()
        with self.assertRaisesRegex(ValueError, "runtime differs"):
            self.complete()
        self.assertFalse((self.stage / staging.STAGE_RECEIPT).exists())

    def test_source_runtime_receipt_disagreement_rejected(self):
        self.snapshot["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "receipt differs"):
            self.complete()

    def test_required_archive_is_actually_verified(self):
        with self.assertRaises(OSError):
            self.complete(sdk_no_archive=False)
        self.assertFalse((self.stage / staging.STAGE_RECEIPT).exists())


class StageComputeTests(unittest.TestCase):
    def test_stale_kernel_sources_are_rejected_without_compiling(self):
        with tempfile.TemporaryDirectory(prefix="sdk-stage-compute-") as temporary:
            root = Path(temporary)
            source = Path(__file__).resolve().parents[2]
            for relative in (wasm.ARTIFACT_ROOT, wasm.KERNEL_ROOT):
                shutil.copytree(source / relative, root / relative)
            tool = write(root, "bundler/wasm.py", (source / "bundler/wasm.py").read_bytes())
            self.assertIsInstance(wasm.verify_compute_artifacts(root), dict)
            rust_source = next((root / wasm.KERNEL_ROOT).rglob("*.rs"))
            rust_source.write_bytes(rust_source.read_bytes() + b"\n// changed authored kernel input\n")
            before = {p.relative_to(root): p.read_bytes() for p in root.rglob("*") if p.is_file()}
            with mock.patch.object(wasm, "_run") as compiler:
                with self.assertRaisesRegex(ValueError, "Stale compute"):
                    staging.verify_stage_inputs(root, "engine")
            compiler.assert_not_called()
            self.assertEqual(before, {p.relative_to(root): p.read_bytes() for p in root.rglob("*") if p.is_file()})
            self.assertTrue(tool.is_file())

    def test_corrupt_native_kernel_rejected_without_compiling(self):
        with tempfile.TemporaryDirectory(prefix="sdk-stage-compute-") as temporary:
            root = Path(temporary)
            source = Path(__file__).resolve().parents[2]
            for relative in (wasm.ARTIFACT_ROOT, wasm.KERNEL_ROOT):
                shutil.copytree(source / relative, root / relative)
            write(root, "bundler/wasm.py", (source / "bundler/wasm.py").read_bytes())
            binary = next((root / wasm.ARTIFACT_ROOT).glob("*.wasm"))
            binary.write_bytes(binary.read_bytes()[:-1])
            with mock.patch.object(wasm, "_run") as compiler:
                with self.assertRaisesRegex(ValueError, "hash/length mismatch"):
                    staging.verify_stage_inputs(root, "engine")
            compiler.assert_not_called()


class StagePublicProfileTests(unittest.TestCase):
    def setUp(self):
        from sdk import public_tests
        self.temporary = tempfile.TemporaryDirectory(prefix="sdk-stage-public-profile-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        source = Path(public_tests.__file__).parent / "public_tests"
        shutil.copytree(source, self.root / "sdk/public_tests")
        self.profile = json.loads((source / "profile.json").read_text(encoding="utf-8"))
        for name in {module for suite in self.profile["suites"] for module in suite["requiredModules"]}:
            write(self.root, name, "export const fixture = true;\n")

    def verify(self):
        from bundler import compute_contracts, physics
        with mock.patch.object(wasm, "verify_compute_artifacts", return_value={}), \
                mock.patch.object(compute_contracts, "verify_compute_contracts"), \
                mock.patch.object(physics, "physics_asset_records", return_value=[]):
            return staging.verify_stage_inputs(self.root, "engine")

    def test_stage_binds_verified_delivered_profile_identity(self):
        evidence = self.verify()["publicTests"]
        self.assertEqual(evidence["profile"], staging._record(self.root / "sdk/public_tests/profile.json"))
        self.assertEqual(evidence["assertionOriginsSha256"], self.profile["assertionOriginsSha256"])
        self.assertEqual(evidence["expectedCasesPerMode"], 64)
        self.assertEqual(evidence["originAuthority"], "delivered-profile")
        self.assertIsNone(evidence["catalog"])

    def test_changed_public_fixture_fails_before_native_validation(self):
        fixture = self.root / "sdk/public_tests/fixtures/strict-json.js"
        fixture.write_bytes(fixture.read_bytes() + b"\n// changed assertion input\n")
        before = {path.relative_to(self.root): path.read_bytes() for path in self.root.rglob("*") if path.is_file()}
        with mock.patch.object(wasm, "verify_compute_artifacts") as native:
            with self.assertRaisesRegex(ValueError, "fixture changed"):
                staging.verify_stage_inputs(self.root, "engine")
        native.assert_not_called()
        self.assertEqual(before, {path.relative_to(self.root): path.read_bytes() for path in self.root.rglob("*") if path.is_file()})

    def descriptor(self):
        from bundler.tests.test_sdk_rebuild import _input_records
        write(self.root, "sdk/public_tests.py", "# approved public test validator\n")
        return sdk_rebuild.write_sdk_build_descriptor(self.root, self.root, "engine", _input_records(self.root))

    def test_delivered_sdk_descriptor_is_admitted_by_shared_rebuild_verifier(self):
        self.descriptor()
        with mock.patch.object(sdk_rebuild, "verify_compute_artifacts", return_value={}):
            evidence = self.verify()
        expected = staging._record(self.root / sdk_rebuild.SDK_BUILD_FILENAME)
        self.assertEqual(evidence["sdkBuildDescriptor"], expected)
        self.assertEqual(evidence["publicTests"]["buildDescriptor"], expected)

    def test_extracted_sdk_missing_descriptor_is_rejected_before_native_checks(self):
        write(self.root, "manifest.json", json.dumps({"format": sdk.SDK_FORMAT, "bundle": {"target": "engine"}}))
        with mock.patch.object(wasm, "verify_compute_artifacts") as native:
            with self.assertRaisesRegex(ValueError, "requires its supplied sdk-build.json"):
                staging.verify_stage_inputs(self.root, "engine")
        native.assert_not_called()

    def test_extracted_sdk_coordinated_fixture_and_profile_drift_is_rejected(self):
        self.descriptor()
        fixture = self.root / "sdk/public_tests/fixtures/strict-json.js"
        fixture.write_bytes(fixture.read_bytes() + b"\nthrow new Error('modified assertion fixture');\n")
        self.profile["files"]["fixtures/strict-json.js"] = staging._record(fixture)
        write(self.root, "sdk/public_tests/profile.json", json.dumps(self.profile))
        before = {path.relative_to(self.root): path.read_bytes() for path in self.root.rglob("*") if path.is_file()}
        with mock.patch.object(sdk_rebuild, "verify_compute_artifacts") as native:
            with self.assertRaisesRegex(ValueError, "immutable input hash/length mismatch"):
                self.verify()
        native.assert_not_called()
        self.assertEqual(before, {path.relative_to(self.root): path.read_bytes() for path in self.root.rglob("*") if path.is_file()})

    def test_extracted_sdk_descriptor_missing_fixture_coverage_is_rejected(self):
        original = self.descriptor()
        relative = "sdk/public_tests/fixtures/strict-json.js"
        for omit_input in (False, True):
            descriptor = copy.deepcopy(original)
            descriptor["immutable"].pop(relative)
            if omit_input:
                descriptor["inputs"].pop(relative)
                descriptor["inputSha256"] = staging._digest(descriptor["inputs"])
            write(self.root, sdk_rebuild.SDK_BUILD_FILENAME, json.dumps(descriptor))
            with self.subTest(omit_input=omit_input), mock.patch.object(sdk_rebuild, "verify_compute_artifacts", return_value={}):
                with self.assertRaisesRegex(ValueError, "immutable inventory|omits immutable public test fixtures"):
                    self.verify()

    def test_extracted_sdk_native_corruption_is_rejected_before_compute_checks(self):
        binary = write(self.root, "engine/compute.wasm", b"\0asm\x01\0\0\0")
        self.descriptor()
        binary.write_bytes(binary.read_bytes()[:-1])
        with mock.patch.object(sdk_rebuild, "verify_compute_artifacts") as native:
            with self.assertRaisesRegex(ValueError, "immutable input hash/length mismatch"):
                self.verify()
        native.assert_not_called()

    def test_extracted_platform_stale_signed_owner_is_rejected_before_descriptor_browser(self):
        from bundler.tests.test_sdk_rebuild import SDKRebuildTests
        with tempfile.TemporaryDirectory(prefix="sdk-stage-signed-owner-") as temporary:
            owner = SimpleNamespace(root=Path(temporary))
            _raw, app = SDKRebuildTests._platform_fixture(owner)
            (app / "index.js").write_text("export default () => 8;\n", encoding="utf-8")
            with mock.patch.object(sdk_rebuild, "verify_compute_artifacts", return_value={}), \
                    mock.patch.object(signing, "verify_live_descriptor_fixtures") as browser:
                with self.assertRaisesRegex(ValueError, "signed app source/manifest changed"):
                    staging.verify_stage_inputs(owner.root, "platform")
            browser.assert_not_called()


class DescriptorVerificationTests(unittest.TestCase):
    def test_signing_verification_invokes_read_only_helper(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write(root, "tests/navi/run_dump_built_in_tool_descriptors.py", "# fixture\n")
            expected = {"format": "built-in-tool-descriptor-verify-v1", "status": "PASS",
                        "counts": {"generic": 1, "artifactStudio": 2, "browserSemantic": 3}}
            completed = SimpleNamespace(returncode=0, stdout=json.dumps(expected), stderr="")
            with mock.patch.object(signing.subprocess, "run", return_value=completed) as run:
                self.assertEqual(signing.verify_live_descriptor_fixtures(root), expected)
            argv = run.call_args.args[0]
            self.assertIn("--verify", argv)
            self.assertNotIn("--sync", argv)
            self.assertIn("-B", argv)

    def test_signing_verification_failure_is_explicit(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write(root, "tests/navi/run_dump_built_in_tool_descriptors.py", "# fixture\n")
            completed = SimpleNamespace(returncode=1, stdout="Stale descriptor fixture", stderr="")
            with mock.patch.object(signing.subprocess, "run", return_value=completed):
                with self.assertRaisesRegex(RuntimeError, "Stale descriptor"):
                    signing.verify_live_descriptor_fixtures(root)

    def test_browser_fixture_comparison_never_synchronizes(self):
        helper_path = Path(__file__).resolve().parents[2] / "tests/navi/run_dump_built_in_tool_descriptors.py"
        if not helper_path.is_file():
            self.skipTest("Platform descriptor helper is not included in the Engine source profile")
        spec = importlib.util.spec_from_file_location("sdk_staging_descriptor_helper", helper_path)
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixtures = {key: {"format": key, "descriptorHashes": {key: "sha256:256:" + "a" * 64}}
                        for key in helper.FIXTURE_PATHS}
            for key, relative in helper.FIXTURE_PATHS.items():
                write(root, relative, json.dumps(fixtures[key]))
            before = {p.relative_to(root): p.read_bytes() for p in root.rglob("*") if p.is_file()}
            with mock.patch.object(helper, "REPO_ROOT", root), \
                    mock.patch.object(helper, "synchronize_fixtures") as synchronize:
                self.assertEqual(helper.verify_fixtures({"fixtures": fixtures})["status"], "PASS")
                fixtures["generic"]["descriptorHashes"]["generic"] = "sha256:256:" + "b" * 64
                with self.assertRaisesRegex(RuntimeError, "Stale descriptor"):
                    helper.verify_fixtures({"fixtures": fixtures})
            synchronize.assert_not_called()
            self.assertEqual(before, {p.relative_to(root): p.read_bytes() for p in root.rglob("*") if p.is_file()})


if __name__ == "__main__":
    unittest.main()
