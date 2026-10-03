# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import base64
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

from jhc import JhcPackage

from bundler.system_release import (
    DEFAULT_RUNTIME_ENTRY_PATH,
    SystemReleaseBuildError,
    _mime_for_path,
    assert_unique_logical_paths,
    build_release_diff,
    build_system_release,
    canonical_release_bytes,
    collect_staged_release,
    generate_release_keyset,
    load_release_keyset,
    open_segmented_package,
)


PUBLISHED_AT = "2026-08-24T12:00:00.000Z"
AES_KEY = bytes(range(32))


def _write_site(root: Path) -> Path:
    site = root / "site"
    files = {
        "webgpu-os/runtime.html": b"<!doctype html><base href='./'><script type='module' src='./boot.js'></script>",
        "webgpu-os/index.html": b"stable physical bootstrap",
        "webgpu-os/manifest.webmanifest": b"{}",
        "webgpu-os/sw.js": b"self.addEventListener('fetch', () => {});",
        "webgpu-os/offline.html": b"stable recovery",
        "webgpu-os/boot-theme.js": b"document.documentElement.dataset.theme = 'dark';",
        "webgpu-os/platform/runtime-host/StableRuntimeHost.js": b"export class StableRuntimeHost {}",
        "webgpu-os/platform/network-host/StableNetworkHost.js": b"export class StableNetworkHost {}",
        "webgpu-os/system-release/contracts.js": b"export const stable = true;",
        "webgpu-os/bootstrap/StableBootstrap.js": b"export const stable = true;",
        "webgpu-os/bootstrap/boot-surface.css": b".os-boot-loader { display: grid; }",
        "webgpu-os/shared/EchoFormProfile.js": b"export const profile = true;",
        "webgpu-os/shared/EchoForm.js": b"export const renderer = true;",
        "webgpu-os/shared/EchoForm.css": b".echo-form { display: grid; }",
        "webgpu-os/boot.js": b"import './index.js';",
        "webgpu-os/index.js": b"export const boot = true;",
        "webgpu-os/style.css": b"body { color: white; }",
        "webgpu-os/kernel/KernelBootstrap.js": b"export class KernelBootstrap {}",
        "webgpu-os/factory/apps/clock/main.js": b"export const clock = true;",
        "webgpu-os/apps/clock/clock.json": b'{"face":"digital"}',
        "engine/core/Gpu.js": b"export const gpu = true;",
        "editor/main.js": b"export const editor = true;",
        "plauna/index.js": b"export const plauna = true;",
        "agi/index.js": b"export const agi = true;",
        "assets/logo.webp": b"RIFFfakeWEBP",
        "schemas/runtime.json": b'{"type":"object"}',
    }
    for relative, payload in files.items():
        path = site / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
    return site


def _tree(root: Path):
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in root.rglob("*")
        if path.is_file()
    }


def _verify_raw_signature(public_raw: bytes, payload: bytes, signature_b64: str):
    raw = base64.b64decode(signature_b64, validate=True)
    if len(raw) != 64:
        raise AssertionError("Expected raw P-256 signature")
    signature = encode_dss_signature(
        int.from_bytes(raw[:32], "big"),
        int.from_bytes(raw[32:], "big"),
    )
    public = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), public_raw)
    public.verify(signature, payload, ec.ECDSA(hashes.SHA256()))


class TestSystemReleaseTooling(unittest.TestCase):
    def _keys(self, root: Path):
        keyset_path = generate_release_keyset(
            root / "keys",
            counts={"root": 2, "timestamp": 1, "snapshot": 1, "targets": 1},
            thresholds={"root": 2, "timestamp": 1, "snapshot": 1, "targets": 1},
        )
        return keyset_path, load_release_keyset(keyset_path)

    def _build(self, site: Path, output: Path, keyset, **overrides):
        options = {
            "keyset": keyset,
            "aes_key": AES_KEY,
            "channel": "stable",
            "version": "1.2.3",
            "sequence": 17,
            "published_at": PUBLISHED_AT,
            "runtime_abi": "particle-runtime-host-1",
            "bootstrap_minimum": "particle-bootstrap-1",
            "bootstrap_maximum": "particle-bootstrap-1",
            "required_features": ("indexeddb", "opfs"),
            "segment_size": 64 * 1024,
            "piece_size": 64 * 1024,
        }
        options.update(overrides)
        return build_system_release(site, output, **options)

    def test_build_is_deterministic_and_browser_contract_shaped(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            site = _write_site(root)
            _, keyset = self._keys(root)

            first = self._build(site, root / "out-a", keyset)
            second = self._build(site, root / "out-b", keyset)

            self.assertEqual(first.release_id, second.release_id)
            self.assertEqual(_tree(first.output_dir), _tree(second.output_dir))
            descriptor = first.descriptor
            manifest = first.manifest
            self.assertEqual(descriptor["runtimeAbi"], "particle-runtime-host-1")
            self.assertEqual(descriptor["bootstrapAbi"], {
                "minimum": "particle-bootstrap-1",
                "maximum": "particle-bootstrap-1",
            })
            self.assertEqual(descriptor["activationFloor"], "asset-live")
            self.assertEqual(descriptor["activationClass"], "runtime-shadow")
            self.assertEqual(descriptor["manifestHash"], "sha256:" + hashlib.sha256(
                canonical_release_bytes(manifest)
            ).hexdigest())
            self.assertEqual(manifest["entryPath"], DEFAULT_RUNTIME_ENTRY_PATH)
            self.assertEqual(len(manifest["files"]), len(manifest["operations"]))
            self.assertEqual(
                {record["path"] for record in manifest["files"]},
                {record["path"] for record in manifest["operations"]},
            )
            self.assertEqual(
                {record["ownership"] for record in manifest["files"]},
                {"agi", "editor", "engine", "factory", "plauna", "shared", "webgpu-os"},
            )
            for record in manifest["files"]:
                self.assertEqual(set(record), {
                    "path", "objectHash", "byteLength", "mime", "ownership", "bootTier", "hotset"
                })
            for operation in manifest["operations"]:
                self.assertEqual(operation["op"], "put-object")

            inventory = json.loads(
                (first.output_dir / "staged-site-inventory.json").read_text(encoding="utf-8")
            )
            included = {entry["physicalPath"]: entry["logicalPath"] for entry in inventory["included"]}
            self.assertEqual(
                included["webgpu-os/runtime.html"],
                "webgpu-os/index.html",
            )
            excluded = {entry["physicalPath"] for entry in inventory["excluded"]}
            self.assertTrue({
                "webgpu-os/index.html",
                "webgpu-os/manifest.webmanifest",
                "webgpu-os/sw.js",
                "webgpu-os/offline.html",
                "webgpu-os/boot-theme.js",
                "webgpu-os/platform/runtime-host/StableRuntimeHost.js",
                "webgpu-os/platform/network-host/StableNetworkHost.js",
                "webgpu-os/system-release/contracts.js",
                "webgpu-os/bootstrap/StableBootstrap.js",
                "webgpu-os/bootstrap/boot-surface.css",
                "webgpu-os/shared/EchoFormProfile.js",
                "webgpu-os/shared/EchoForm.js",
                "webgpu-os/shared/EchoForm.css",
            }.issubset(excluded))

            package_path = first.output_dir / descriptor["targetPath"]
            plaintext, index = open_segmented_package(
                package_path.read_bytes(),
                key=AES_KEY,
                expected_package_hash=descriptor["package"]["hash"],
            )
            self.assertEqual(index["releaseId"], first.release_id)
            parsed = JhcPackage.parse_authenticated(plaintext, keyset.role("targets")[0].public_raw)
            self.assertEqual(parsed["manifest"]["systemReleaseManifest"], manifest)
            self.assertEqual(
                parsed["resources"]["webgpu-os/index.html"],
                (site / "webgpu-os" / "runtime.html").read_bytes(),
            )
            self.assertNotIn("webgpu-os/runtime.html", parsed["resources"])

            pieces = descriptor["package"]["pieces"]
            package = package_path.read_bytes()
            self.assertEqual(
                descriptor["package"]["pieceManifestHash"],
                "sha256:" + hashlib.sha256(canonical_release_bytes(pieces)).hexdigest(),
            )
            for piece in pieces:
                payload = package[piece["offset"]:piece["offset"] + piece["byteLength"]]
                self.assertEqual(piece["hash"], "sha256:" + hashlib.sha256(payload).hexdigest())

            raised_floor = self._build(
                site,
                root / "out-raised-floor",
                keyset,
                activation_floor="runtime-warm",
            )
            self.assertEqual(raised_floor.descriptor["activationClass"], "runtime-shadow")
            self.assertNotEqual(
                first.release_id,
                raised_floor.release_id,
                "activationFloor must participate in the content-derived release identity",
            )

    def test_tuf_roles_are_separate_threshold_signed_and_linked(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            site = _write_site(root)
            _, keyset = self._keys(root)
            result = self._build(site, root / "out", keyset)

            envelopes = {
                role: json.loads((result.output_dir / "metadata" / f"{role}.json").read_text("utf-8"))
                for role in ("root", "timestamp", "snapshot", "targets")
            }
            root_signed = envelopes["root"]["signed"]
            all_public = {
                key.keyid: key.public_raw
                for role in ("root", "timestamp", "snapshot", "targets")
                for key in keyset.role(role)
            }
            self.assertEqual(len(all_public), 5)
            for role, envelope in envelopes.items():
                signed_payload = canonical_release_bytes(envelope["signed"])
                valid = 0
                for signature in envelope["signatures"]:
                    definition = root_signed["roles"][role]
                    if signature["keyid"] not in definition["keyids"]:
                        continue
                    _verify_raw_signature(
                        all_public[signature["keyid"]],
                        signed_payload,
                        signature["sig"],
                    )
                    valid += 1
                self.assertGreaterEqual(valid, root_signed["roles"][role]["threshold"])

            targets_bytes = (result.output_dir / "metadata" / "targets.json").read_bytes()
            snapshot_record = envelopes["snapshot"]["signed"]["meta"]["targets.json"]
            self.assertEqual(snapshot_record["length"], len(targets_bytes))
            self.assertEqual(snapshot_record["hashes"]["sha256"], hashlib.sha256(targets_bytes).hexdigest())
            snapshot_bytes = (result.output_dir / "metadata" / "snapshot.json").read_bytes()
            timestamp_record = envelopes["timestamp"]["signed"]["meta"]["snapshot.json"]
            self.assertEqual(timestamp_record["length"], len(snapshot_bytes))
            self.assertEqual(timestamp_record["hashes"]["sha256"], hashlib.sha256(snapshot_bytes).hexdigest())
            target = envelopes["targets"]["signed"]["targets"][result.descriptor["targetPath"]]
            self.assertEqual(target["custom"]["releaseDescriptor"], result.descriptor)

    def test_root_rotation_is_sequential_and_cross_signed_by_both_thresholds(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            old_path = generate_release_keyset(
                root / "old",
                counts={"root": 2, "timestamp": 1, "snapshot": 1, "targets": 1},
                thresholds={"root": 2, "timestamp": 1, "snapshot": 1, "targets": 1},
                root_version=1,
            )
            old = load_release_keyset(old_path)
            new_path = generate_release_keyset(
                root / "new",
                root_version=2,
                previous_keyset=old,
            )
            new = load_release_keyset(new_path)
            envelope = new.root_metadata
            payload = canonical_release_bytes(envelope["signed"])
            signature_by_id = {
                signature["keyid"]: signature["sig"]
                for signature in envelope["signatures"]
            }

            self.assertEqual(envelope["signed"]["version"], 2)
            for key in (*old.role("root"), *new.role("root")):
                self.assertIn(key.keyid, signature_by_id)
                _verify_raw_signature(
                    key.public_raw,
                    payload,
                    signature_by_id[key.keyid],
                )
            with self.assertRaisesRegex(SystemReleaseBuildError, "sequential value 3"):
                generate_release_keyset(
                    root / "skipped",
                    root_version=4,
                    previous_keyset=new,
                )

    def test_bootstrap_targeting_collisions_and_key_overwrite_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            site = _write_site(root)
            keyset_path, _ = self._keys(root)
            with self.assertRaises(FileExistsError):
                generate_release_keyset(root / "keys")
            self.assertTrue(keyset_path.is_file())

            with self.assertRaisesRegex(SystemReleaseBuildError, "physical stable bootstrap"):
                collect_staged_release(
                    site,
                    entry_source_path="webgpu-os/index.html",
                )
            with self.assertRaisesRegex(SystemReleaseBuildError, "collision"):
                assert_unique_logical_paths(("webgpu-os/App.js", "webgpu-os/app.js"))
            with self.assertRaisesRegex(SystemReleaseBuildError, "NFC"):
                assert_unique_logical_paths(("assets/Cafe\u0301.txt",))

    def test_diff_calculates_asset_warm_and_shadow_activation_without_lowering(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            site = _write_site(root)
            _, keyset = self._keys(root)
            initial = self._build(site, root / "initial", keyset)

            (site / "assets" / "logo.webp").write_bytes(b"RIFFnewWEBP")
            asset_files, _ = collect_staged_release(site)
            _, asset_class = build_release_diff(
                asset_files,
                initial.manifest,
                activation_floor="asset-live",
            )
            self.assertEqual(asset_class, "asset-live")
            _, raised_class = build_release_diff(
                asset_files,
                initial.manifest,
                activation_floor="runtime-warm",
            )
            self.assertEqual(raised_class, "runtime-warm")
            raised_diff, _ = build_release_diff(
                asset_files,
                initial.manifest,
                activation_floor="runtime-warm",
            )
            self.assertEqual(raised_diff["activationFloor"], "runtime-warm")

            (site / "webgpu-os" / "kernel" / "KernelBootstrap.js").write_bytes(
                b"export class KernelBootstrap { boot() {} }"
            )
            shadow_files, _ = collect_staged_release(site)
            _, shadow_class = build_release_diff(
                shadow_files,
                initial.manifest,
                activation_floor="asset-live",
            )
            self.assertEqual(shadow_class, "runtime-shadow")
            with self.assertRaisesRegex(SystemReleaseBuildError, "cannot request"):
                build_release_diff(
                    shadow_files,
                    initial.manifest,
                    activation_floor="bootstrap-next-launch",
                )

    def test_corrupt_segment_is_rejected_before_jhc_decode(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            site = _write_site(root)
            _, keyset = self._keys(root)
            result = self._build(site, root / "out", keyset)
            package_path = result.output_dir / result.descriptor["targetPath"]
            corrupt = bytearray(package_path.read_bytes())
            corrupt[-1] ^= 0x01
            with self.assertRaisesRegex(SystemReleaseBuildError, "hash|corrupt"):
                open_segmented_package(
                    bytes(corrupt),
                    key=AES_KEY,
                    expected_package_hash=result.descriptor["package"]["hash"],
                )

    def test_browser_contract_bounds_and_mime_projection_fail_closed(self):
        self.assertEqual(_mime_for_path("webgpu-os/boot.js"), "text/javascript")
        self.assertEqual(_mime_for_path("assets/model.glb"), "application/octet-stream")
        self.assertEqual(_mime_for_path("assets/unknown.particle"), "application/octet-stream")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            site = _write_site(root)
            _, keyset = self._keys(root)
            with self.assertRaisesRegex(SystemReleaseBuildError, "channel"):
                self._build(site, root / "bad-channel", keyset, channel="a" * 65)
            with self.assertRaisesRegex(SystemReleaseBuildError, "bounded ABI"):
                self._build(
                    site,
                    root / "bad-feature",
                    keyset,
                    required_features=("not a feature",),
                )
            with self.assertRaisesRegex(SystemReleaseBuildError, "browser bounds"):
                self._build(
                    site,
                    root / "bad-storage",
                    keyset,
                    minimum_storage_bytes=9_007_199_254_740_992,
                )


if __name__ == "__main__":
    unittest.main()
