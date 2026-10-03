# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import base64
import copy
import gzip
import hashlib
import json
import shutil
import tempfile
import unittest
from html.parser import HTMLParser
from pathlib import Path

from bundler.runtime_transport import (
    MAX_RUNTIME_PARTS,
    RUNTIME_PART_BYTES,
    compressed_artifact_part_map,
    compressed_artifact_paths,
    plan_compressed_artifact_parts,
    read_compressed_artifact,
    validate_compressed_artifact_parts,
)
from bundler.site import (
    _copy_release_compressed_artifact,
    _release_runtime_cache_token,
    _release_runtime_loader_tag,
    _validate_static_site_file_cap,
    _verify_release_runtime_gzip,
    _write_webgpu_os_bundle_index,
    create_release_site_archive,
)


ROOT = Path(__file__).resolve().parents[2]
LOGICAL_NAME = "particle-os.min.js.gz"


class _ScriptParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts = []

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            self.scripts.append(dict(attrs))


class TestRuntimeTransport(unittest.TestCase):
    def setUp(self):
        self.source = bytes(range(256)) * 256
        self.payload = gzip.compress(self.source, mtime=0)
        self.records, self.files = plan_compressed_artifact_parts(
            LOGICAL_NAME, self.payload, max_file_bytes=128, part_bytes=64,
        )
        self.manifest = {"compressed_artifact_parts": {LOGICAL_NAME: self.records}}
        self.integrity = "sha384-" + base64.b64encode(hashlib.sha384(self.source).digest()).decode("ascii")

    def _write_parts(self, directory):
        directory.mkdir(parents=True, exist_ok=True)
        for name, payload in self.files.items():
            (directory / name).write_bytes(payload)

    def test_deterministic_parts_reassemble_exact_original_gzip(self):
        self.assertEqual(
            (self.records, self.files),
            plan_compressed_artifact_parts(LOGICAL_NAME, self.payload, max_file_bytes=128, part_bytes=64),
        )
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            self._write_parts(directory)
            reconstructed = read_compressed_artifact(
                directory, LOGICAL_NAME, self.manifest, expected_bytes=len(self.payload), prefer_full=False,
            )
            self.assertEqual(reconstructed, self.payload)
            self.assertEqual(_verify_release_runtime_gzip(reconstructed, self.integrity, len(self.source)), len(self.source))
            self.assertEqual(compressed_artifact_paths(self.manifest, LOGICAL_NAME), tuple(self.files))
            self.assertEqual(_validate_static_site_file_cap(directory, max_bytes=128)[0], len(self.records))

    def test_small_artifact_and_full_local_consumer_remain_supported(self):
        self.assertEqual(plan_compressed_artifact_parts(LOGICAL_NAME, self.payload, max_file_bytes=len(self.payload)), ([], {}))
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            (directory / LOGICAL_NAME).write_bytes(self.payload)
            self.assertEqual(read_compressed_artifact(directory, LOGICAL_NAME, {}), self.payload)
            self.assertEqual(read_compressed_artifact(directory, LOGICAL_NAME, self.manifest), self.payload)
            with self.assertRaises(FileNotFoundError):
                read_compressed_artifact(directory, LOGICAL_NAME, self.manifest, prefer_full=False)

    def test_transport_metadata_rejects_malformed_shapes_paths_bounds_and_order(self):
        invalid = []
        for key, value in [("src", "../outside.bin"), ("bytes", True), ("bytes", RUNTIME_PART_BYTES + 1), ("sha256", "A" * 64)]:
            records = copy.deepcopy(self.records)
            records[0][key] = value
            invalid.append(records)
        invalid.extend([[], list(reversed(self.records)), self.records * MAX_RUNTIME_PARTS])
        for records in invalid:
            with self.subTest(records=records[:1]), self.assertRaises(ValueError):
                validate_compressed_artifact_parts(LOGICAL_NAME, records)
        with self.assertRaises(ValueError):
            validate_compressed_artifact_parts(LOGICAL_NAME, self.records, expected_bytes=len(self.payload) + 1)
        with self.assertRaises(ValueError):
            compressed_artifact_part_map({"compressed_artifact_parts": []})
        with self.assertRaises(ValueError):
            plan_compressed_artifact_parts(LOGICAL_NAME, b"x" * (MAX_RUNTIME_PARTS + 1), max_file_bytes=1, part_bytes=1)

    def test_tampered_truncated_missing_and_relabelled_parts_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            self._write_parts(directory)
            part = directory / self.records[0]["src"]
            original = part.read_bytes()
            part.write_bytes(bytes([original[0] ^ 1]) + original[1:])
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                read_compressed_artifact(directory, LOGICAL_NAME, self.manifest, prefer_full=False)
            part.write_bytes(original[:-1])
            with self.assertRaisesRegex(ValueError, "byte count mismatch"):
                read_compressed_artifact(directory, LOGICAL_NAME, self.manifest, prefer_full=False)
            part.unlink()
            with self.assertRaises(FileNotFoundError):
                read_compressed_artifact(directory, LOGICAL_NAME, self.manifest, prefer_full=False)
            # A local full artifact must also bind every declared part digest.
            (directory / LOGICAL_NAME).write_bytes(self.payload)
            bad_manifest = copy.deepcopy(self.manifest)
            bad_manifest["compressed_artifact_parts"][LOGICAL_NAME][0]["sha256"] = "0" * 64
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                read_compressed_artifact(directory, LOGICAL_NAME, bad_manifest)

    def test_public_copy_and_archive_preserve_gzip_and_best_transport(self):
        best_name = "particle-os.min.js.zst"
        best = self.payload[::-1]
        best_records, best_files = plan_compressed_artifact_parts(best_name, best, max_file_bytes=128, part_bytes=64)
        manifest = {"compressed_artifact_parts": {LOGICAL_NAME: self.records, best_name: best_records}}
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, site = root / "source", root / "site"
            self._write_parts(source)
            (source / LOGICAL_NAME).write_bytes(self.payload)
            (source / best_name).write_bytes(best)
            for name, payload in best_files.items():
                (source / name).write_bytes(payload)
            for name in (LOGICAL_NAME, best_name):
                _copy_release_compressed_artifact(source, site, manifest, name)
                self.assertFalse((site / name).exists())
            self.assertEqual(_validate_static_site_file_cap(site, max_bytes=128)[0], len(self.records) + len(best_records))
            paths = [*compressed_artifact_paths(manifest, LOGICAL_NAME), *compressed_artifact_paths(manifest, best_name)]
            count, _ = create_release_site_archive(site, root / "site.zip", required_paths=paths)
            self.assertEqual(count, len(paths))
            (site / paths[0]).unlink()
            with self.assertRaises(FileNotFoundError):
                create_release_site_archive(site, root / "missing.zip", required_paths=paths)

    def test_loader_urls_and_cache_identity_bind_transport_metadata(self):
        token = _release_runtime_cache_token(self.payload, self.records)
        alternate, _ = plan_compressed_artifact_parts(LOGICAL_NAME, self.payload, max_file_bytes=128, part_bytes=128)
        self.assertNotEqual(token, _release_runtime_cache_token(self.payload, alternate))
        self.assertNotEqual(token, _release_runtime_cache_token(self.payload))
        tag = _release_runtime_loader_tag(
            "./assets/release-runtime-loader.js", "../assets/" + LOGICAL_NAME, "../assets/",
            self.integrity, len(self.source), len(self.payload), token, runtime_parts=self.records,
        )
        parser = _ScriptParser()
        parser.feed(tag)
        configured = json.loads(parser.scripts[0]["data-runtime-parts"])
        self.assertEqual(configured[0]["src"], "../assets/" + self.records[0]["src"] + "?v=" + token)
        self.assertEqual(configured[0]["sha256"], self.records[0]["sha256"])

    def test_os_desktop_guest_and_inert_app_share_parts_without_whole_gzip(self):
        with tempfile.TemporaryDirectory() as temp:
            os_dir = Path(temp) / "webgpu-os"
            assets = os_dir / "assets"
            self._write_parts(assets)
            for name in ("index.html", "runtime.html", "app.html"):
                shutil.copy2(ROOT / "webgpu-os" / name, os_dir / name)
            _write_webgpu_os_bundle_index(
                os_dir / "index.html", self.integrity, len(self.source), len(self.payload),
                "sha256:" + hashlib.sha256(self.source).hexdigest(), runtime_manifest=self.manifest,
            )
            bindings = []
            for name in ("index.html", "runtime.html", "app.html"):
                parser = _ScriptParser()
                parser.feed((os_dir / name).read_text(encoding="utf-8"))
                bindings.append(next(script for script in parser.scripts if "data-runtime-src" in script))
            self.assertEqual(bindings[0]["data-runtime-parts"], bindings[1]["data-runtime-parts"])
            self.assertEqual(bindings[0]["data-runtime-parts"], bindings[2]["data-runtime-parts"])
            app = (os_dir / "app.html").read_text(encoding="utf-8")
            self.assertIn('<template id="particle-app-runtime-loader">', app)
            self.assertFalse((assets / LOGICAL_NAME).exists())


if __name__ == "__main__":
    unittest.main()
