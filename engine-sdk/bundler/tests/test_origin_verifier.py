# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

from __future__ import annotations

import base64
import contextlib
import gzip
import hashlib
import io
import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from bundler.origin_verifier import (
    OriginVerificationError,
    load_local_release_expectation,
    main,
    verify_platform_origin,
)
from bundler.runtime_transport import plan_compressed_artifact_parts
from bundler.site import (
    RELEASE_MODULE_WORKER_CLOSURE_PATHS,
    RELEASE_MODULE_WORKER_ROOT_PATHS,
    _release_runtime_cache_token,
    _release_runtime_loader_bytes,
    _release_runtime_loader_tag,
)


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


class _FixtureOrigin:
    def __init__(self, site_root: Path) -> None:
        self.site_root = site_root
        self.overrides: dict[str, bytes | None] = {}
        self.redirects: dict[str, str] = {}
        self.statuses: dict[str, int] = {}
        self.requests: list[tuple[str, str, str]] = []
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                parsed = urlsplit(self.path)
                fixture.requests.append((parsed.path, self.headers.get("Cache-Control", ""), parsed.query))
                if "no-cache" not in self.headers.get("Cache-Control", "") \
                        or self.headers.get("Pragma", "") != "no-cache" \
                        or "__particle_verify" not in parse_qs(parsed.query):
                    self.send_response(428)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                if parsed.path in fixture.redirects:
                    self.send_response(302)
                    self.send_header("Location", fixture.redirects[parsed.path])
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                if parsed.path in fixture.overrides:
                    payload = fixture.overrides[parsed.path]
                    if payload is None:
                        self.send_response(404)
                        self.send_header("Content-Length", "0")
                        self.end_headers()
                        return
                else:
                    path = (fixture.site_root / parsed.path.lstrip("/")).resolve()
                    try:
                        path.relative_to(fixture.site_root.resolve())
                    except ValueError:
                        payload = None
                    else:
                        payload = path.read_bytes() if path.is_file() else None
                    if payload is None:
                        self.send_response(404)
                        self.send_header("Content-Length", "0")
                        self.end_headers()
                        return
                self.send_response(fixture.statuses.get(parsed.path, 200))
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, _format, *_args):
                return

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def origin(self) -> str:
        return f"http://127.0.0.1:{self.server.server_port}/"

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_args):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


class PlatformOriginVerifierTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.site = Path(self.temporary.name) / "site"
        self.assets = self.site / "assets"
        self.os_assets = self.site / "webgpu-os" / "assets"
        self.assets.mkdir(parents=True)
        self.os_assets.mkdir(parents=True)
        self.bundle_name = "particle-platform"
        self.source = b"globalThis.PE={__modules:{ok:true},requireModule(){}};\n"
        self.runtime = gzip.compress(self.source, compresslevel=6, mtime=0)
        self.runtime_path = self.assets / f"{self.bundle_name}.min.js.gz"
        self.runtime_path.write_bytes(self.runtime)
        self.integrity = "sha384-" + base64.b64encode(hashlib.sha384(self.source).digest()).decode("ascii")
        (self.assets / f"{self.bundle_name}.min.js.sri").write_bytes(self.integrity.encode("ascii"))
        loader = _release_runtime_loader_bytes()
        (self.assets / "release-runtime-loader.js").write_bytes(loader)
        (self.os_assets / "release-runtime-loader.js").write_bytes(loader)
        os_root = self.site / "webgpu-os"
        (os_root / "release-boot.js").write_bytes(b"globalThis.__TEST_OS_BOOT__ = true;\n")
        (os_root / "sw.js").write_bytes(b"self.addEventListener('fetch', () => {});\n")
        (os_root / "manifest.webmanifest").write_bytes(
            b'{"name":"Verifier fixture","start_url":"/webgpu-os/"}\n'
        )
        storage_root = os_root / "storage"
        packages_root = os_root / "packages"
        engine_math_root = self.site / "engine" / "core" / "math"
        storage_root.mkdir(parents=True)
        packages_root.mkdir(parents=True)
        engine_math_root.mkdir(parents=True)
        (storage_root / "StorageWorker.js").write_bytes(
            b"import { Zip } from '../packages/Zip.js';\n"
            b"import { IncrementalSha256 } from './IncrementalSha256.js';\n"
            b"self.onmessage = () => [Zip, IncrementalSha256];\n"
        )
        (storage_root / "IncrementalSha256.js").write_bytes(
            b"export class IncrementalSha256 {}\n"
        )
        (packages_root / "Zip.js").write_bytes(
            b"import { crc32 } from '../../engine/core/math/ChecksumMath.js';\n"
            b"export const Zip = { crc32 };\n"
        )
        (engine_math_root / "ChecksumMath.js").write_bytes(
            b"import { bufferByteView } from './BufferMath.js';\n"
            b"export const crc32 = value => bufferByteView(value).length;\n"
        )
        (engine_math_root / "BufferMath.js").write_bytes(
            b"export const bufferByteView = value => value;\n"
        )
        construction_root = (
            os_root / "apps" / "realmforge" / "construction"
        )
        construction_root.mkdir(parents=True)
        realm_worker = construction_root / "RealmForgeConstructionGenerationWorker.js"
        realm_transaction = construction_root / "RealmForgeConstructionDocumentTransaction.js"
        realm_worker.write_bytes(
            b"import { generate } from './RealmForgeConstructionDocumentTransaction.js';\n"
            b"self.onmessage = () => generate();\n"
        )
        for relative_path in RELEASE_MODULE_WORKER_CLOSURE_PATHS:
            path = self.site / relative_path
            if path.is_file():
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"export default true;\n")
        transaction_relative = realm_transaction.relative_to(self.site).as_posix()
        fixture_imports = "".join(
            f"import '/{relative_path}';\n"
            for relative_path in RELEASE_MODULE_WORKER_CLOSURE_PATHS
            if relative_path != transaction_relative
        )
        realm_transaction.write_text(
            fixture_imports + "export const generate = () => true;\n",
            encoding="utf-8",
        )

        provenance = {
            "_type": "https://in-toto.io/Statement/v1",
            "subject": [{
                "name": f"{self.bundle_name}.min.js.gz",
                "digest": {"sha256": _sha256(self.runtime)},
            }, {
                "name": f"{self.bundle_name}.min.js",
                "digest": {
                    "sha256": _sha256(self.source),
                    "sha384": hashlib.sha384(self.source).hexdigest(),
                },
            }],
            "predicateType": "https://slsa.dev/provenance/v1",
            "predicate": {},
        }
        provenance_bytes = (json.dumps(provenance, indent=2) + "\n").encode("utf-8")
        (self.assets / f"{self.bundle_name}.provenance.json").write_bytes(provenance_bytes)
        manifest = {
            "format": "particle-bundle-manifest/v2",
            "schema_version": 2,
            "name": self.bundle_name,
            "target": "platform",
            "site_profile": "platform",
            "production": True,
            "gzip_bytes": len(self.runtime),
            "sri": self.integrity,
            "browser_runtime": f"{self.bundle_name}.min.js.gz",
            "browser_runtime_compression": "gzip",
            "browser_runtime_bytes": len(self.runtime),
            "browser_runtime_decoded_bytes": len(self.source),
            "browser_runtime_integrity": self.integrity,
            "browser_runtime_loader": "release-runtime-loader.js",
            "provenance": {
                "path": f"{self.bundle_name}.provenance.json",
                "predicate_type": "https://slsa.dev/provenance/v1",
                "sha256": _sha256(provenance_bytes),
            },
        }
        manifest_bytes = (json.dumps(manifest, indent=2) + "\n").encode("utf-8")
        (self.assets / f"{self.bundle_name}.manifest.json").write_bytes(manifest_bytes)
        self.token = _release_runtime_cache_token(self.runtime_path)
        tag = _release_runtime_loader_tag(
            "./assets/release-runtime-loader.js",
            f"../assets/{self.bundle_name}.min.js.gz",
            "../assets/",
            self.integrity,
            len(self.source),
            len(self.runtime),
            self.token,
            runtime_base="../",
            os_base="./",
        )
        (self.site / "webgpu-os" / "index.html").write_text(
            f"<!doctype html><html><body>{tag}</body></html>\n",
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _snapshot(self) -> dict[str, str]:
        return {
            path.relative_to(self.site).as_posix(): _sha256(path.read_bytes())
            for path in self.site.rglob("*")
            if path.is_file()
        }

    def _use_runtime_parts(self) -> list[dict]:
        records, files = plan_compressed_artifact_parts(
            self.runtime_path.name, self.runtime, max_file_bytes=32, part_bytes=32,
        )
        for name, payload in files.items():
            (self.assets / name).write_bytes(payload)
        manifest_path = self.assets / f"{self.bundle_name}.manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["compressed_artifact_parts"] = {self.runtime_path.name: records}
        manifest_path.write_text(json.dumps(manifest) + "\n", encoding="utf-8")
        self.token = _release_runtime_cache_token(self.runtime, records)
        tag = _release_runtime_loader_tag(
            "./assets/release-runtime-loader.js",
            f"../assets/{self.runtime_path.name}", "../assets/", self.integrity,
            len(self.source), len(self.runtime), self.token,
            runtime_base="../", os_base="./", runtime_parts=records,
        )
        (self.site / "webgpu-os" / "index.html").write_text(
            f"<!doctype html><html><body>{tag}</body></html>\n", encoding="utf-8",
        )
        self.runtime_path.unlink()
        return records

    def test_segmented_origin_verifies_each_part_without_requesting_logical_gzip(self) -> None:
        records = self._use_runtime_parts()
        before = self._snapshot()
        with _FixtureOrigin(self.site) as origin:
            result = verify_platform_origin(
                origin.origin, self.site, timeout_seconds=3, allow_loopback_http=True,
            )
            paths = [path for path, _cache, _query in origin.requests]
            self.assertNotIn(f"/assets/{self.runtime_path.name}", paths)
            self.assertEqual(
                [item.name for item in result.artifacts if item.name.startswith("runtime-part:")],
                [f"runtime-part:{index:04d}" for index in range(len(records))],
            )
            for record in records:
                self.assertIn(f"/assets/{record['src']}", paths)
        self.assertEqual(self._snapshot(), before)

    def test_segmented_origin_rejects_missing_and_changed_remote_parts(self) -> None:
        records = self._use_runtime_parts()
        record = records[-1]
        for payload, expected_code in (
            (None, "REMOTE_HTTP_STATUS"),
            (b"x" * record["bytes"], "ARTIFACT_HASH_MISMATCH"),
        ):
            with self.subTest(expected_code=expected_code), _FixtureOrigin(self.site) as origin:
                origin.overrides[f"/assets/{record['src']}"] = payload
                with self.assertRaises(OriginVerificationError) as raised:
                    verify_platform_origin(
                        origin.origin, self.site, timeout_seconds=3, allow_loopback_http=True,
                    )
                self.assertEqual(raised.exception.code, expected_code)
                self.assertEqual(raised.exception.artifact, f"runtime-part:{len(records) - 1:04d}")

    def test_declared_missing_local_part_cannot_fall_back_to_retained_whole_gzip(self) -> None:
        records = self._use_runtime_parts()
        self.runtime_path.write_bytes(self.runtime)
        (self.assets / records[0]["src"]).unlink()
        with self.assertRaises(OriginVerificationError) as raised:
            load_local_release_expectation(self.site)
        self.assertEqual(raised.exception.code, "LOCAL_RELEASE_INVALID")
        self.assertEqual(raised.exception.artifact, "runtime")

    def test_segmented_origin_rejects_redirects_that_the_browser_will_not_follow(self) -> None:
        records = self._use_runtime_parts()
        with _FixtureOrigin(self.site) as origin:
            record = records[0]
            origin.redirects[f"/assets/{record['src']}"] = f"/redirected/{record['src']}"
            origin.overrides[f"/redirected/{record['src']}"] = (self.assets / record["src"]).read_bytes()
            with self.assertRaises(OriginVerificationError) as raised:
                verify_platform_origin(origin.origin, self.site, timeout_seconds=3, allow_loopback_http=True)
            self.assertEqual(raised.exception.code, "REMOTE_REDIRECT_FORBIDDEN")
            self.assertEqual(raised.exception.artifact, "runtime-part:0000")
            self.assertFalse(any(path.startswith("/redirected/") for path, _cache, _query in origin.requests))

    def test_segmented_logical_identity_cannot_leave_the_deployment_origin(self) -> None:
        self._use_runtime_parts()
        index = self.site / "webgpu-os" / "index.html"
        original = index.read_text(encoding="utf-8")
        for replacement in ("https://other.invalid/assets/", "https://user@release.invalid/assets/"):
            with self.subTest(replacement=replacement):
                index.write_text(original.replace('data-runtime-src="../assets/', f'data-runtime-src="{replacement}'), encoding="utf-8")
                with self.assertRaises(OriginVerificationError) as raised:
                    load_local_release_expectation(self.site)
                self.assertEqual(raised.exception.code, "LOCAL_RELEASE_INVALID")
                self.assertEqual(raised.exception.artifact, "index")

    def test_local_part_binding_must_match_manifest_transport(self) -> None:
        records = self._use_runtime_parts()
        index = self.site / "webgpu-os" / "index.html"
        text = index.read_text(encoding="utf-8")
        index.write_text(text.replace(records[0]["sha256"], "0" * 64), encoding="utf-8")
        with self.assertRaises(OriginVerificationError) as raised:
            load_local_release_expectation(self.site)
        self.assertEqual(raised.exception.code, "LOCAL_RELEASE_INVALID")
        self.assertEqual(raised.exception.artifact, "index")

    def test_exact_origin_passes_without_writing_and_uses_no_cache_requests(self) -> None:
        before = self._snapshot()
        with _FixtureOrigin(self.site) as origin:
            result = verify_platform_origin(
                origin.origin,
                self.site,
                timeout_seconds=3,
                allow_loopback_http=True,
            )
            expected_worker_modules = [
                *RELEASE_MODULE_WORKER_ROOT_PATHS,
                *sorted(set(RELEASE_MODULE_WORKER_CLOSURE_PATHS).difference(
                    RELEASE_MODULE_WORKER_ROOT_PATHS
                )),
            ]
            self.assertEqual([item.name for item in result.artifacts], [
                "index", "loader", "release-boot", "service-worker", "pwa-manifest",
                "manifest", "provenance", "sri", "runtime",
                *(f"module:{path}" for path in expected_worker_modules),
            ])
            self.assertEqual(result.cache_token, self.token)
            self.assertEqual(len(origin.requests), len(result.artifacts))
            self.assertTrue(all("no-cache" in cache and "__particle_verify=" in query
                                for _path, cache, query in origin.requests))
        self.assertEqual(self._snapshot(), before)

    def test_stale_index_token_fails_before_artifact_fetch(self) -> None:
        index = (self.site / "webgpu-os" / "index.html").read_bytes()
        stale = index.replace(self.token.encode("ascii"), b"0" * 16)
        with _FixtureOrigin(self.site) as origin:
            origin.overrides["/webgpu-os/index.html"] = stale
            with self.assertRaises(OriginVerificationError) as raised:
                verify_platform_origin(origin.origin, self.site, timeout_seconds=3, allow_loopback_http=True)
            self.assertEqual(raised.exception.code, "INDEX_BINDING_MISMATCH")
            self.assertEqual(len(origin.requests), 1)

    def test_stale_index_body_fails_even_when_runtime_binding_is_current(self) -> None:
        index = (self.site / "webgpu-os" / "index.html").read_bytes()
        with _FixtureOrigin(self.site) as origin:
            origin.overrides["/webgpu-os/index.html"] = index.replace(
                b"<body>", b"<body><!-- stale launcher -->", 1
            )
            with self.assertRaises(OriginVerificationError) as raised:
                verify_platform_origin(origin.origin, self.site, timeout_seconds=3, allow_loopback_http=True)
            self.assertEqual(raised.exception.code, "INDEX_HASH_MISMATCH")
            self.assertEqual(raised.exception.artifact, "index")
            self.assertEqual(len(origin.requests), 1)

    def test_stale_service_worker_fails_at_the_cache_controller_boundary(self) -> None:
        service_worker = (self.site / "webgpu-os" / "sw.js").read_bytes()
        with _FixtureOrigin(self.site) as origin:
            origin.overrides["/webgpu-os/sw.js"] = b"x" * len(service_worker)
            with self.assertRaises(OriginVerificationError) as raised:
                verify_platform_origin(origin.origin, self.site, timeout_seconds=3, allow_loopback_http=True)
            self.assertEqual(raised.exception.code, "ARTIFACT_HASH_MISMATCH")
            self.assertEqual(raised.exception.artifact, "service-worker")

    def test_missing_sidecar_and_changed_runtime_fail_closed(self) -> None:
        with _FixtureOrigin(self.site) as origin:
            origin.overrides[f"/assets/{self.bundle_name}.provenance.json"] = None
            with self.assertRaises(OriginVerificationError) as raised:
                verify_platform_origin(origin.origin, self.site, timeout_seconds=3, allow_loopback_http=True)
            self.assertEqual(raised.exception.code, "REMOTE_HTTP_STATUS")
            self.assertEqual(raised.exception.artifact, "provenance")

        with _FixtureOrigin(self.site) as origin:
            origin.overrides[f"/assets/{self.bundle_name}.min.js.gz"] = b"x" * len(self.runtime)
            with self.assertRaises(OriginVerificationError) as raised:
                verify_platform_origin(origin.origin, self.site, timeout_seconds=3, allow_loopback_http=True)
            self.assertEqual(raised.exception.code, "ARTIFACT_HASH_MISMATCH")
            self.assertEqual(raised.exception.artifact, "runtime")

    def test_local_module_worker_closure_must_be_complete(self) -> None:
        (self.site / "webgpu-os" / "storage" / "IncrementalSha256.js").unlink()
        with self.assertRaises(OriginVerificationError) as raised:
            load_local_release_expectation(self.site)
        self.assertEqual(raised.exception.code, "LOCAL_RELEASE_INVALID")
        self.assertEqual(
            raised.exception.artifact,
            "module:webgpu-os/storage/IncrementalSha256.js",
        )

    def test_avr_worker_modules_must_be_complete_locally(self) -> None:
        for relative in (
            "webgpu-os/apps/realmforge/modeler/electronics/RealmForgeAvrRuntime.js",
            "webgpu-os/apps/realmforge/modeler/electronics/RealmForgeMicrocontrollerBoard.js",
            "webgpu-os/apps/realmforge/modeler/electronics/RealmForgeMicrocontrollerProfiles.js",
            "vendor/avr8js/0.21.1/browser/index.js",
            "vendor/avr8js/0.21.1/browser/cpu/cpu.js",
            "vendor/avr8js/0.21.1/browser/peripherals/eeprom.js",
        ):
            with self.subTest(module=relative):
                path = self.site / relative
                payload = path.read_bytes()
                path.unlink()
                try:
                    with self.assertRaises(OriginVerificationError) as raised:
                        load_local_release_expectation(self.site)
                    self.assertEqual(raised.exception.code, "LOCAL_RELEASE_INVALID")
                    self.assertEqual(raised.exception.artifact, f"module:{relative}")
                finally:
                    path.write_bytes(payload)

    def test_worker_closure_refuses_a_present_unreviewed_module(self) -> None:
        transaction = (
            self.site / "webgpu-os" / "apps" / "realmforge" / "construction"
            / "RealmForgeConstructionDocumentTransaction.js"
        )
        extra = transaction.with_name("UnreviewedWorkerDependency.js")
        extra.write_bytes(b"export default true;\n")
        transaction.write_bytes(
            transaction.read_bytes() + b"\nimport './UnreviewedWorkerDependency.js';\n"
        )
        with self.assertRaises(OriginVerificationError) as raised:
            load_local_release_expectation(self.site)
        self.assertEqual(raised.exception.code, "LOCAL_RELEASE_INVALID")
        self.assertEqual(raised.exception.artifact, "module-worker-closure")
        self.assertIn("exceeds its file bound", str(raised.exception))

    def test_missing_live_module_worker_dependency_fails_closed(self) -> None:
        with _FixtureOrigin(self.site) as origin:
            origin.overrides["/webgpu-os/storage/IncrementalSha256.js"] = None
            with self.assertRaises(OriginVerificationError) as raised:
                verify_platform_origin(
                    origin.origin,
                    self.site,
                    timeout_seconds=3,
                    allow_loopback_http=True,
                )
        self.assertEqual(raised.exception.code, "REMOTE_HTTP_STATUS")
        self.assertEqual(
            raised.exception.artifact,
            "module:webgpu-os/storage/IncrementalSha256.js",
        )

    def test_missing_realmforge_worker_transaction_fails_closed(self) -> None:
        relative = (
            "webgpu-os/apps/realmforge/construction/"
            "RealmForgeConstructionDocumentTransaction.js"
        )
        (self.site / relative).unlink()
        with self.assertRaises(OriginVerificationError) as raised:
            load_local_release_expectation(self.site)
        self.assertEqual(raised.exception.code, "LOCAL_RELEASE_INVALID")
        self.assertEqual(raised.exception.artifact, f"module:{relative}")

    def test_changed_transitive_worker_module_fails_exact_byte_check(self) -> None:
        relative = "engine/core/math/BufferMath.js"
        local = (self.site / relative).read_bytes()
        with _FixtureOrigin(self.site) as origin:
            origin.overrides[f"/{relative}"] = b"x" * len(local)
            with self.assertRaises(OriginVerificationError) as raised:
                verify_platform_origin(
                    origin.origin,
                    self.site,
                    timeout_seconds=3,
                    allow_loopback_http=True,
                )
        self.assertEqual(raised.exception.code, "ARTIFACT_HASH_MISMATCH")
        self.assertEqual(
            raised.exception.artifact,
            "module:engine/core/math/BufferMath.js",
        )

    def test_changed_avr_vendor_worker_module_fails_exact_byte_check(self) -> None:
        relative = "vendor/avr8js/0.21.1/browser/cpu/cpu.js"
        local = (self.site / relative).read_bytes()
        with _FixtureOrigin(self.site) as origin:
            origin.overrides[f"/{relative}"] = b"x" * len(local)
            with self.assertRaises(OriginVerificationError) as raised:
                verify_platform_origin(
                    origin.origin,
                    self.site,
                    timeout_seconds=3,
                    allow_loopback_http=True,
                )
        self.assertEqual(raised.exception.code, "ARTIFACT_HASH_MISMATCH")
        self.assertEqual(raised.exception.artifact, f"module:{relative}")

    def test_non_relative_worker_module_import_is_rejected_locally(self) -> None:
        worker = self.site / "webgpu-os" / "storage" / "StorageWorker.js"
        worker.write_bytes(b"import 'unbound-package';\n")
        with self.assertRaises(OriginVerificationError) as raised:
            load_local_release_expectation(self.site)
        self.assertEqual(raised.exception.code, "LOCAL_RELEASE_INVALID")
        self.assertEqual(
            raised.exception.artifact,
            "module:webgpu-os/storage/StorageWorker.js",
        )

    def test_redirect_must_remain_on_the_exact_origin(self) -> None:
        with _FixtureOrigin(self.site) as origin:
            origin.redirects["/webgpu-os/index.html"] = (
                f"http://localhost:{origin.server.server_port}/webgpu-os/index.html"
            )
            with self.assertRaises(OriginVerificationError) as raised:
                verify_platform_origin(origin.origin, self.site, timeout_seconds=3, allow_loopback_http=True)
            self.assertEqual(raised.exception.code, "REDIRECT_ORIGIN_MISMATCH")

    def test_same_origin_redirect_preserves_cache_busting_and_is_verified(self) -> None:
        index = (self.site / "webgpu-os" / "index.html").read_bytes()
        with _FixtureOrigin(self.site) as origin:
            origin.redirects["/webgpu-os/index.html"] = "/deployed/webgpu-os/index.html"
            origin.overrides["/deployed/webgpu-os/index.html"] = index
            result = verify_platform_origin(
                origin.origin,
                self.site,
                timeout_seconds=3,
                allow_loopback_http=True,
            )
            self.assertEqual(result.cache_token, self.token)
            self.assertEqual(origin.requests[1][0], "/deployed/webgpu-os/index.html")
            self.assertIn("__particle_verify=", origin.requests[1][2])

    def test_non_success_response_is_rejected_even_when_bytes_match(self) -> None:
        with _FixtureOrigin(self.site) as origin:
            origin.statuses["/webgpu-os/index.html"] = 206
            with self.assertRaises(OriginVerificationError) as raised:
                verify_platform_origin(origin.origin, self.site, timeout_seconds=3, allow_loopback_http=True)
            self.assertEqual(raised.exception.code, "REMOTE_HTTP_STATUS")
            self.assertEqual(raised.exception.artifact, "index")

    def test_non_https_non_loopback_origin_is_rejected_before_network(self) -> None:
        with self.assertRaises(OriginVerificationError) as raised:
            verify_platform_origin("http://example.com/", self.site, timeout_seconds=3)
        self.assertEqual(raised.exception.code, "ORIGIN_SCHEME_FORBIDDEN")

    def test_invalid_local_integrity_is_reported_as_a_stable_release_failure(self) -> None:
        (self.assets / f"{self.bundle_name}.min.js.sri").write_bytes(b"not-an-integrity")
        with self.assertRaises(OriginVerificationError) as raised:
            load_local_release_expectation(self.site)
        self.assertEqual(raised.exception.code, "LOCAL_RELEASE_INVALID")
        self.assertEqual(raised.exception.artifact, "sri")

    def test_cli_failure_is_nonzero_and_does_not_print_response_content(self) -> None:
        secret = b"PRIVATE-REMOTE-BODY"
        replacement = (secret * ((len(self.runtime) // len(secret)) + 1))[:len(self.runtime)]
        with _FixtureOrigin(self.site) as origin:
            origin.overrides[f"/assets/{self.bundle_name}.min.js.gz"] = replacement
            stdout = io.StringIO()
            stderr = io.StringIO()
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                status = main([
                    "--origin", origin.origin,
                    "--site-root", str(self.site),
                    "--timeout-seconds", "3",
                ], allow_loopback_http=True)
        summary = stdout.getvalue() + stderr.getvalue()
        self.assertEqual(status, 1)
        self.assertIn("ARTIFACT_HASH_MISMATCH", summary)
        self.assertNotIn(secret.decode("ascii"), summary)


if __name__ == "__main__":
    unittest.main(verbosity=2)
