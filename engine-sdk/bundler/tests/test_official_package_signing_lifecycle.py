# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import base64
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from bundler import signing


REPO_ROOT = Path(__file__).resolve().parents[2]
BUILT_AT = "2026-08-01T12:00:00Z"


def _root_identity():
    private = ec.generate_private_key(ec.SECP256R1())
    raw = private.public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    return private, {
        "id": "test-ring0-root",
        "name": "Signing Lifecycle Test Root",
        "publicKey": base64.b64encode(raw).decode("ascii"),
        "fingerprint": hashlib.sha256(raw).hexdigest()[:16],
        "algorithm": "ECDSA-P256",
    }


def _copy_faculty_inputs(root):
    paths = (
        "webgpu-os/apps/ai-echo/AgentToolset.js",
        "webgpu-os/apps/ai-echo/ImageGenerationIdentity.js",
        "webgpu-os/kernel/ToolDriver.js",
        "webgpu-os/kernel/navi/builtins/ArtifactStudioFaculty.js",
        "webgpu-os/kernel/navi/builtins/ArtifactStudioDescriptorHashes.json",
        "webgpu-os/kernel/navi/builtins/BrowserSemanticFaculty.js",
        "webgpu-os/kernel/navi/builtins/BrowserSemanticDescriptorHashes.json",
        "webgpu-os/kernel/navi/builtins/BuiltInToolFaculties.js",
        "webgpu-os/kernel/navi/builtins/BuiltInToolDescriptorHashes.json",
    )
    for relative in paths:
        source = REPO_ROOT / relative
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(source.read_bytes())


def _write_trust(root, private, record, *, include_private):
    trust = root / "webgpu-os" / "kernel" / "trust"
    trust.mkdir(parents=True, exist_ok=True)
    (trust / "roots.json").write_text(
        json.dumps({"format": "os-trust-roots-v1", "roots": [record]}),
        encoding="utf-8",
    )
    if include_private:
        key_dir = root / ".trust-keys"
        key_dir.mkdir(parents=True, exist_ok=True)
        (key_dir / f"{record['id']}.private.pem").write_bytes(
            private.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            )
        )


def _build_faculty_records(root, private, record):
    key = hashlib.sha256(signing.PRPKG_DEFAULT_KEY_MATERIAL).digest()
    return signing._build_all_official_faculty_records(
        root, record, private, key, BUILT_AT,
    )


def _write_faculty_records(root, records):
    builtins = root / "webgpu-os" / "kernel" / "navi" / "builtins"
    signing.write_artifact_studio_generated_module(
        records[signing.ARTIFACT_STUDIO_PACKAGE_ID],
        builtins / "ArtifactStudioFacultyPackage.generated.js",
    )
    signing.write_browser_semantic_generated_module(
        records[signing.BROWSER_SEMANTIC_PACKAGE_ID],
        builtins / "BrowserSemanticFacultyPackage.generated.js",
    )
    signing.write_built_in_tool_faculty_generated_module(
        {
            package_id: package
            for package_id, package in records.items()
            if package_id not in {
                signing.ARTIFACT_STUDIO_PACKAGE_ID,
                signing.BROWSER_SEMANTIC_PACKAGE_ID,
            }
        },
        builtins / "BuiltInToolFacultyPackages.generated.js",
    )


def _change_generic_descriptor(root):
    path = root / "webgpu-os" / "kernel" / "navi" / "builtins" / "BuiltInToolDescriptorHashes.json"
    fixture = json.loads(path.read_text(encoding="utf-8"))
    name = next(iter(fixture["descriptorHashes"]))
    current = fixture["descriptorHashes"][name]
    replacement = "f" * 64 if current != "sha256:256:" + "f" * 64 else "e" * 64
    fixture["descriptorHashes"][name] = "sha256:256:" + replacement
    path.write_text(json.dumps(fixture), encoding="utf-8")


class OfficialPackageSigningLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.private, self.root_record = _root_identity()
        self.aes_key = hashlib.sha256(signing.PRPKG_DEFAULT_KEY_MATERIAL).digest()
        self.artifact = signing.build_artifact_studio_official_package(
            REPO_ROOT,
            self.root_record,
            self.private,
            self.aes_key,
            BUILT_AT,
        )

    def test_exact_record_verifier_accepts_complete_artifact_evidence(self):
        evidence = signing.verify_official_package_record(
            self.artifact,
            [self.root_record],
            aes_key=self.aes_key,
            expected_package_id=signing.ARTIFACT_STUDIO_PACKAGE_ID,
            verification_time=BUILT_AT,
        )
        self.assertEqual(evidence["packageId"], signing.ARTIFACT_STUDIO_PACKAGE_ID)
        self.assertEqual(
            evidence["revisionInputHash"],
            self.artifact["envelope"]["provenance"]["buildParams"]["revisionInputHash"],
        )
        for field in ("containerSha256", "envelopeSha256", "recordSha256"):
            self.assertRegex(evidence[field], r"^[0-9a-f]{64}$")

    def test_release_signer_rejects_runtime_manifest_version_drift(self):
        with tempfile.TemporaryDirectory(prefix="official-version-drift-") as temporary:
            entry = Path(temporary) / "factory.js"
            entry.write_text("const APP_VERSION = '5.22.31';\n", encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "runtime/manifest version mismatch"):
                signing.assert_app_runtime_version_matches_manifest(
                    "os.ai-echo",
                    "5.22.30",
                    entry,
                )

            self.assertEqual(
                signing.assert_app_runtime_version_matches_manifest(
                    "os.ai-echo",
                    "5.22.31",
                    entry,
                ),
                "5.22.31",
            )

    def test_release_signer_ignores_apps_without_runtime_version_marker(self):
        with tempfile.TemporaryDirectory(prefix="official-no-version-marker-") as temporary:
            entry = Path(temporary) / "index.js"
            entry.write_text("export default true;\n", encoding="utf-8")
            self.assertIsNone(
                signing.assert_app_runtime_version_matches_manifest(
                    "os.example",
                    "1.0.0",
                    entry,
                )
            )

    def test_exact_record_verifier_rejects_each_tampered_layer(self):
        cases = {}

        header = copy.deepcopy(self.artifact)
        raw = bytearray(base64.b64decode(header["container"]))
        raw[0] ^= 1
        header["container"] = base64.b64encode(raw).decode("ascii")
        cases["container header"] = header

        ciphertext = copy.deepcopy(self.artifact)
        raw = bytearray(base64.b64decode(ciphertext["container"]))
        raw[-1] ^= 1
        ciphertext["container"] = base64.b64encode(raw).decode("ascii")
        cases["container authentication"] = ciphertext

        payload_hash = copy.deepcopy(self.artifact)
        payload_hash["envelope"]["encMeta"]["payloadSha256"] = "0" * 64
        cases["payload hash"] = payload_hash

        envelope = copy.deepcopy(self.artifact)
        envelope["envelope"]["manifest"]["description"] += " tampered"
        cases["encrypted payload binding"] = envelope

        certificate = copy.deepcopy(self.artifact)
        certificate["envelope"]["cert"]["issuerSig"] = base64.b64encode(b"\0" * 64).decode("ascii")
        cases["certificate chain"] = certificate

        block_signature = copy.deepcopy(self.artifact)
        block_signature["envelope"]["signature"]["sig"] = base64.b64encode(b"\0" * 64).decode("ascii")
        cases["publisher signature"] = block_signature

        faculty_signature = copy.deepcopy(self.artifact)
        faculty_signature["envelope"]["manifest"]["naviFaculty"]["manifest"]["signatures"][0]["value"] = base64.urlsafe_b64encode(b"\0" * 64).decode("ascii").rstrip("=")
        cases["Faculty binding"] = faculty_signature

        revision = copy.deepcopy(self.artifact)
        revision["envelope"]["provenance"]["buildParams"]["revisionInputHash"] = "sha256:256:" + "0" * 64
        cases["revision binding"] = revision

        for label, record in cases.items():
            with self.subTest(layer=label):
                with self.assertRaises(RuntimeError):
                    signing.verify_official_package_record(
                        record,
                        [self.root_record],
                        aes_key=self.aes_key,
                        expected_package_id=signing.ARTIFACT_STUDIO_PACKAGE_ID,
                        verification_time=BUILT_AT,
                    )

    def test_registry_verification_happens_before_generated_fallback_emission(self):
        with tempfile.TemporaryDirectory(prefix="official-verify-before-write-") as temporary:
            root = Path(temporary)
            _copy_faculty_inputs(root)
            _write_trust(root, self.private, self.root_record, include_private=True)
            generated = root / "webgpu-os" / "kernel" / "navi" / "builtins" / "ArtifactStudioFacultyPackage.generated.js"
            with mock.patch.object(
                signing,
                "verify_official_package_records",
                side_effect=RuntimeError("forced exact-record verification failure"),
            ):
                with self.assertRaisesRegex(RuntimeError, "forced exact-record"):
                    signing.build_official_app_packages(root, write_generated_fallback=True, required=True)
            self.assertFalse(generated.exists())

    def test_release_signer_includes_entries_larger_than_the_legacy_scan_cap(self):
        with tempfile.TemporaryDirectory(prefix="official-large-entry-") as temporary:
            root = Path(temporary)
            _copy_faculty_inputs(root)
            _write_trust(root, self.private, self.root_record, include_private=True)
            app = root / "webgpu-os" / "apps" / "large-entry"
            app.mkdir(parents=True)
            (app / "manifest.json").write_text(json.dumps({
                "appId": "os.large-entry",
                "name": "Large Entry",
                "version": "1.0.0",
                "publisher": "core",
                "entry": "./index.js",
            }), encoding="utf-8")
            (app / "index.js").write_text(
                "export const payload = " + json.dumps("x" * 500_000) + ";\n",
                encoding="utf-8",
            )
            hidden = app / ".logs" / "evidence"
            hidden.mkdir(parents=True)
            (hidden / "oversized.js").write_text(
                "x" * (signing.OFFICIAL_PKG_MAX_FILE + 1),
                encoding="utf-8",
            )

            preamble = signing.build_official_app_packages(
                root,
                write_generated_fallback=False,
                required=True,
            )
            records = json.loads(preamble.split("=", 1)[1].rstrip(";"))
            package = records["os.large-entry"]
            evidence = signing.verify_official_package_record(
                package,
                [self.root_record],
                expected_package_id="os.large-entry",
            )

            self.assertEqual(package["envelope"]["manifest"]["entry"], "files/index.js")
            self.assertEqual(evidence["packageId"], "os.large-entry")

    def test_required_release_rejects_malformed_app_manifests(self):
        with tempfile.TemporaryDirectory(prefix="official-malformed-manifest-") as temporary:
            root = Path(temporary)
            _copy_faculty_inputs(root)
            _write_trust(root, self.private, self.root_record, include_private=True)
            app = root / "webgpu-os" / "apps" / "malformed"
            app.mkdir(parents=True)
            (app / "manifest.json").write_text("{not-json", encoding="utf-8")

            with self.assertRaisesRegex(RuntimeError, "manifest is unreadable"):
                signing.build_official_app_packages(
                    root,
                    write_generated_fallback=False,
                    required=True,
                )

    def test_release_rejects_visible_source_instead_of_signing_a_truncated_app(self):
        with tempfile.TemporaryDirectory(prefix="official-oversized-source-") as temporary:
            root = Path(temporary)
            _copy_faculty_inputs(root)
            _write_trust(root, self.private, self.root_record, include_private=True)
            app = root / "webgpu-os" / "apps" / "oversized"
            app.mkdir(parents=True)
            (app / "manifest.json").write_text(json.dumps({
                "appId": "os.oversized",
                "name": "Oversized",
                "version": "1.0.0",
                "publisher": "core",
                "entry": "./index.js",
            }), encoding="utf-8")
            (app / "index.js").write_text("export default true;\n", encoding="utf-8")
            (app / "runtime.js").write_text("x" * 257, encoding="utf-8")

            with mock.patch.object(signing, "OFFICIAL_PKG_MAX_FILE", 256):
                with self.assertRaisesRegex(RuntimeError, "integrity guard"):
                    signing.build_official_app_packages(
                        root,
                        write_generated_fallback=False,
                        required=True,
                    )

    def test_cli_prepares_development_fallbacks_before_module_graph_collection(self):
        source = (REPO_ROOT / "bundler" / "cli.py").read_text(encoding="utf-8")
        prepare_offset = source.index("prepare_development_faculty_fallbacks(ROOT)")
        graph_offset = source.index("graph = ModuleGraph(")
        self.assertLess(prepare_offset, graph_offset)
        release_branch = source[source.index(
            "if getattr(args, \"include_webgpu_os\", False) and not args.sdk_rebuild:"):graph_offset]
        self.assertIn("and not args.sdk_rebuild:", release_branch)
        self.assertIn("if args.production or args.release:", release_branch)
        self.assertIn("release mode preserves checked-in development Faculty fallbacks", release_branch)
        self.assertIn("verify_development_faculty_fallbacks(ROOT)", release_branch)
        self.assertIn("release requires current checked-in development", release_branch)

        signing_source = (REPO_ROOT / "bundler" / "signing.py").read_text(encoding="utf-8")
        prepare_block = signing_source[
            signing_source.index("def prepare_development_faculty_fallbacks("):
            signing_source.index("def _assert_dedicated_faculty_owners_emitted(")
        ]
        self.assertLess(
            prepare_block.index("_synchronize_live_descriptor_fixtures(root, required=True)"),
            prepare_block.index("verify_development_faculty_fallbacks("),
        )

    def test_verified_current_fallback_is_reused_without_private_signing_material(self):
        with tempfile.TemporaryDirectory(prefix="official-fallback-reuse-") as temporary:
            root = Path(temporary)
            _copy_faculty_inputs(root)
            _write_trust(root, self.private, self.root_record, include_private=False)
            records = _build_faculty_records(root, self.private, self.root_record)
            _write_faculty_records(root, records)
            paths = [item[0] for item in signing._generated_faculty_fallback_specs(root)]
            before = {path: path.read_bytes() for path in paths}

            state = signing.prepare_development_faculty_fallbacks(
                root,
                verification_time=BUILT_AT,
                minimum_remaining_days=0,
            )

            self.assertFalse(state["refreshed"])
            self.assertEqual(before, {path: path.read_bytes() for path in paths})

    def test_stale_fallback_fails_closed_without_private_signing_material(self):
        with tempfile.TemporaryDirectory(prefix="official-fallback-stale-") as temporary:
            root = Path(temporary)
            _copy_faculty_inputs(root)
            _write_trust(root, self.private, self.root_record, include_private=False)
            _write_faculty_records(root, _build_faculty_records(root, self.private, self.root_record))
            _change_generic_descriptor(root)

            with self.assertRaisesRegex(RuntimeError, "matching signing material is unavailable"):
                signing.prepare_development_faculty_fallbacks(
                    root,
                    verification_time=BUILT_AT,
                    minimum_remaining_days=0,
                )

    def test_stale_fallback_is_self_verified_and_atomically_refreshed(self):
        with tempfile.TemporaryDirectory(prefix="official-fallback-refresh-") as temporary:
            root = Path(temporary)
            _copy_faculty_inputs(root)
            _write_trust(root, self.private, self.root_record, include_private=True)
            records = _build_faculty_records(root, self.private, self.root_record)
            _write_faculty_records(root, records)
            generic_path = root / "webgpu-os" / "kernel" / "navi" / "builtins" / "BuiltInToolFacultyPackages.generated.js"
            before = generic_path.read_bytes()
            _change_generic_descriptor(root)

            state = signing.prepare_development_faculty_fallbacks(
                root,
                verification_time=BUILT_AT,
                minimum_remaining_days=0,
            )

            self.assertTrue(state["refreshed"])
            self.assertNotEqual(before, generic_path.read_bytes())
            self.assertFalse(list(generic_path.parent.glob(".*.tmp")))
            verified = signing.verify_development_faculty_fallbacks(
                root,
                verification_time=BUILT_AT,
                minimum_remaining_days=0,
            )
            self.assertEqual(verified["status"], "current")


if __name__ == "__main__":
    unittest.main()
