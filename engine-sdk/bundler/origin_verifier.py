# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Read-only verification of one deployed platform release origin.

The verifier treats the local ``release/site`` tree as the release truth. It
checks and byte-compares the WebGPU OS launcher, boot/cache controllers, PWA
manifest, runtime, and security-critical sidecars without persisting a response
body.
"""

from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import io
import ipaddress
import json
import re
import secrets
import socket
import sys
import time
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .parser import ParseError, parse_module
from .runtime_transport import (
    MAX_RUNTIME_PARTS,
    RUNTIME_PART_BYTES,
    compressed_artifact_part_map,
    read_compressed_artifact,
)
from .site import (
    RELEASE_MODULE_WORKER_CLOSURE_PATHS,
    RELEASE_MODULE_WORKER_ROOT_PATHS,
    WEBGPU_OS_PWA_ASSET_PATHS,
    WEBGPU_OS_REQUIRED_DEPLOYMENT_PATHS,
    _read_bundle_sri,
    _release_runtime_cache_token,
    _release_runtime_loader_bytes,
    _verify_release_runtime_gzip,
)


DEFAULT_ORIGIN = "https://particlerealms.online/"
DEFAULT_BUNDLE_NAME = "particle-platform"
DEFAULT_TIMEOUT_SECONDS = 20.0
MAX_REDIRECTS = 3
MAX_INDEX_BYTES = 1024 * 1024
MAX_RUNTIME_BYTES = 25 * 1024 * 1024
MAX_MANIFEST_BYTES = 4 * 1024 * 1024
MAX_PROVENANCE_BYTES = 1024 * 1024
MAX_LOADER_BYTES = 1024 * 1024
MAX_SRI_BYTES = 256
MAX_OS_CONTROL_BYTES = 1024 * 1024
MAX_OS_MODULE_BYTES = 2 * 1024 * 1024
MAX_OS_MODULE_CLOSURE_BYTES = 8 * 1024 * 1024
# The reviewed deployment tuple owns the file bound as well as exact membership.
MAX_OS_MODULE_CLOSURE_FILES = len(RELEASE_MODULE_WORKER_CLOSURE_PATHS)
READ_CHUNK_BYTES = 64 * 1024
RUNTIME_TOKEN = re.compile(r"[0-9a-f]{16}")
SRI_SHA384 = re.compile(r"sha384-[A-Za-z0-9+/]{64}")
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
LOADER_BINDING_ATTRIBUTES = (
    "src",
    "data-runtime-src",
    "data-asset-base",
    "data-runtime-base",
    "data-integrity",
    "data-runtime-bytes",
    "data-runtime-compressed-bytes",
    "data-os-base",
)
OS_CONTROL_ARTIFACTS = (
    ("release-boot", "release-boot.js"),
    ("service-worker", "sw.js"),
    ("pwa-manifest", "manifest.webmanifest"),
)
class OriginVerificationError(RuntimeError):
    """A content-free, stable deployment verification failure."""

    def __init__(self, code: str, message: str, *, artifact: str = "") -> None:
        super().__init__(message)
        self.code = code
        self.artifact = artifact


@dataclass(frozen=True)
class ArtifactExpectation:
    name: str
    local_path: Path
    remote_url: str
    byte_length: int
    sha256: str
    payload: bytes


@dataclass(frozen=True)
class LocalReleaseExpectation:
    site_root: Path
    bundle_name: str
    cache_token: str
    index_binding: tuple[tuple[str, str], ...]
    index: ArtifactExpectation
    artifacts: tuple[ArtifactExpectation, ...]


@dataclass(frozen=True)
class VerifiedArtifact:
    name: str
    byte_length: int
    sha256: str


@dataclass(frozen=True)
class OriginVerificationResult:
    origin: str
    cache_token: str
    artifacts: tuple[VerifiedArtifact, ...]


class _RuntimeLoaderParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.bindings: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag.lower() != "script":
            return
        values = {str(name).lower(): "" if value is None else str(value) for name, value in attrs}
        if "data-runtime-src" in values:
            self.bindings.append(values)


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        return None


def _failure(code: str, message: str, *, artifact: str = "") -> OriginVerificationError:
    return OriginVerificationError(code, message, artifact=artifact)


def _is_loopback_host(hostname: str | None) -> bool:
    host = str(hostname or "").strip().rstrip(".").lower()
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _origin_identity(url: str) -> tuple[str, str, int]:
    parts = urlsplit(url)
    try:
        port = parts.port
    except ValueError as error:
        raise _failure("ORIGIN_INVALID", "Origin contains an invalid port") from error
    scheme = parts.scheme.lower()
    hostname = str(parts.hostname or "").rstrip(".").lower()
    if not hostname:
        raise _failure("ORIGIN_INVALID", "Origin has no hostname")
    return scheme, hostname, port or (443 if scheme == "https" else 80)


def _normalize_origin(origin: str, *, allow_loopback_http: bool) -> str:
    origin_value = str(origin or "").strip()
    parts = urlsplit(origin_value)
    if parts.username is not None or parts.password is not None:
        raise _failure("ORIGIN_INVALID", "Origin must not contain credentials")
    if parts.query or parts.fragment:
        raise _failure("ORIGIN_INVALID", "Origin must not contain a query or fragment")
    scheme, hostname, _port = _origin_identity(origin_value)
    if scheme != "https" and not (
        allow_loopback_http and scheme == "http" and _is_loopback_host(hostname)
    ):
        raise _failure("ORIGIN_SCHEME_FORBIDDEN", "Deployment verification requires an HTTPS origin")
    path = parts.path or "/"
    if not path.endswith("/"):
        path += "/"
    return urlunsplit((scheme, parts.netloc, path, "", ""))


def _validate_same_origin_url(
    url: str,
    expected_origin: tuple[str, str, int],
    *,
    allow_loopback_http: bool,
) -> None:
    parts = urlsplit(url)
    if parts.username is not None or parts.password is not None:
        raise _failure("REDIRECT_ORIGIN_MISMATCH", "A request URL introduced credentials")
    identity = _origin_identity(url)
    if identity != expected_origin:
        raise _failure("REDIRECT_ORIGIN_MISMATCH", "A request or redirect left the configured origin")
    if identity[0] != "https" and not (
        allow_loopback_http and identity[0] == "http" and _is_loopback_host(identity[1])
    ):
        raise _failure("REDIRECT_SCHEME_FORBIDDEN", "A request or redirect downgraded from HTTPS")


def _cache_busted(url: str, nonce: str) -> str:
    parts = urlsplit(url)
    query = parse_qs(parts.query, keep_blank_values=True)
    query["__particle_verify"] = [nonce]
    flattened = [(key, value) for key in sorted(query) for value in query[key]]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(flattened), ""))


def _safe_site_file(site_root: Path, relative: str, label: str) -> Path:
    root = Path(site_root).resolve()
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as error:
        raise _failure("LOCAL_RELEASE_INVALID", f"{label} escapes the local site root", artifact=label) from error
    if not candidate.is_file():
        raise _failure("LOCAL_RELEASE_INVALID", f"Local {label} is missing", artifact=label)
    return candidate


def _bounded_local_bytes(path: Path, maximum: int, label: str) -> bytes:
    try:
        size = path.stat().st_size
        if size <= 0 or size > maximum:
            raise _failure("LOCAL_RELEASE_INVALID", f"Local {label} has an invalid byte length", artifact=label)
        return path.read_bytes()
    except OriginVerificationError:
        raise
    except OSError as error:
        raise _failure("LOCAL_RELEASE_INVALID", f"Local {label} could not be read", artifact=label) from error


def _strict_json_object(payload: bytes, label: str) -> dict:
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate key: {key}")
            result[key] = value
        return result

    try:
        value = json.loads(payload.decode("utf-8", errors="strict"), object_pairs_hook=unique_object)
    except (UnicodeDecodeError, ValueError, json.JSONDecodeError) as error:
        raise _failure("LOCAL_RELEASE_INVALID", f"Local {label} is not strict JSON", artifact=label) from error
    if not isinstance(value, dict):
        raise _failure("LOCAL_RELEASE_INVALID", f"Local {label} must be a JSON object", artifact=label)
    return value


def _runtime_loader_binding(payload: bytes, label: str) -> dict[str, str]:
    try:
        html = payload.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise _failure("INDEX_INVALID", f"{label} is not UTF-8", artifact="index") from error
    parser = _RuntimeLoaderParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception as error:
        raise _failure("INDEX_INVALID", f"{label} could not be parsed", artifact="index") from error
    if len(parser.bindings) != 1:
        raise _failure(
            "INDEX_BINDING_INVALID",
            f"{label} must contain exactly one configured runtime loader",
            artifact="index",
        )
    binding = parser.bindings[0]
    missing = [name for name in LOADER_BINDING_ATTRIBUTES[:-1] if not binding.get(name)]
    if missing:
        raise _failure("INDEX_BINDING_INVALID", f"{label} has an incomplete runtime binding", artifact="index")
    return binding


def _binding_token(binding: dict[str, str], label: str) -> str:
    values = []
    for attribute in ("src", "data-runtime-src"):
        query = parse_qs(urlsplit(binding.get(attribute, "")).query, keep_blank_values=True)
        tokens = query.get("v", [])
        if len(tokens) != 1 or not RUNTIME_TOKEN.fullmatch(tokens[0]):
            raise _failure("INDEX_BINDING_INVALID", f"{label} has an invalid runtime cache token", artifact="index")
        values.append(tokens[0])
    if values[0] != values[1]:
        raise _failure("INDEX_BINDING_INVALID", f"{label} binds different loader and runtime tokens", artifact="index")
    return values[0]


def _binding_projection(binding: dict[str, str]) -> tuple[tuple[str, str], ...]:
    return tuple((name, binding.get(name, "")) for name in (
        *LOADER_BINDING_ATTRIBUTES, "data-runtime-parts",
    ))


def _decoded_sha256(path: Path | bytes, expected_bytes: int) -> str:
    digest = hashlib.sha256()
    decoded = 0
    try:
        with gzip.open(io.BytesIO(path) if isinstance(path, bytes) else path, "rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                decoded += len(chunk)
                if decoded > expected_bytes:
                    raise _failure(
                        "LOCAL_RELEASE_INVALID",
                        "Local runtime exceeds its decoded byte contract",
                        artifact="runtime",
                    )
                digest.update(chunk)
    except OSError as error:
        raise _failure(
            "LOCAL_RELEASE_INVALID",
            "Local runtime is not a valid gzip stream",
            artifact="runtime",
        ) from error
    if decoded != expected_bytes:
        raise _failure("LOCAL_RELEASE_INVALID", "Local runtime misses its decoded byte contract", artifact="runtime")
    return digest.hexdigest()


def _module_artifact_name(relative_path: str) -> str:
    return f"module:{relative_path}"


def _resolve_module_specifier(importer: str, specifier: str) -> str:
    if not specifier.startswith(("./", "../", "/")):
        raise _failure(
            "LOCAL_RELEASE_INVALID",
            "A module-worker sidecar uses a non-relative module specifier",
            artifact=_module_artifact_name(importer),
        )
    parts = urlsplit(specifier)
    if parts.scheme or parts.netloc or parts.fragment:
        raise _failure(
            "LOCAL_RELEASE_INVALID",
            "A module-worker sidecar import leaves the local release",
            artifact=_module_artifact_name(importer),
        )
    resolved = urlsplit(urljoin(f"https://release.invalid/{importer}", specifier))
    relative_path = resolved.path.lstrip("/")
    if resolved.scheme != "https" or resolved.netloc != "release.invalid" \
            or not relative_path or not relative_path.endswith((".js", ".mjs")):
        raise _failure(
            "LOCAL_RELEASE_INVALID",
            "A module-worker sidecar import is not a deployable JavaScript module",
            artifact=_module_artifact_name(importer),
        )
    return relative_path


def _load_module_worker_closure(
    root: Path,
    required_deployment_paths: frozenset[str],
) -> tuple[ArtifactExpectation, ...]:
    """Load the exact, bounded static module closure used by raw OS workers."""
    pending = list(RELEASE_MODULE_WORKER_ROOT_PATHS)
    queued = set(pending)
    modules: dict[str, tuple[Path, bytes]] = {}
    total_bytes = 0
    while pending:
        relative_path = pending.pop(0)
        queued.discard(relative_path)
        if relative_path in modules:
            continue
        if len(modules) >= MAX_OS_MODULE_CLOSURE_FILES:
            raise _failure(
                "LOCAL_RELEASE_INVALID",
                "The module-worker sidecar closure exceeds its file bound",
                artifact="module-worker-closure",
            )
        if relative_path.startswith("webgpu-os/"):
            deployed_name = relative_path.removeprefix("webgpu-os/")
            if deployed_name not in required_deployment_paths:
                raise _failure(
                    "LOCAL_RELEASE_INVALID",
                    "The bundler deployment inventory omits a module-worker dependency",
                    artifact=_module_artifact_name(relative_path),
                )
        label = _module_artifact_name(relative_path)
        path = _safe_site_file(root, relative_path, label)
        payload = _bounded_local_bytes(path, MAX_OS_MODULE_BYTES, label)
        total_bytes += len(payload)
        if total_bytes > MAX_OS_MODULE_CLOSURE_BYTES:
            raise _failure(
                "LOCAL_RELEASE_INVALID",
                "The module-worker sidecar closure exceeds its byte bound",
                artifact="module-worker-closure",
            )
        try:
            source = payload.decode("utf-8", errors="strict")
            imports, exports = parse_module(source)
        except (UnicodeDecodeError, ParseError) as error:
            raise _failure(
                "LOCAL_RELEASE_INVALID",
                "A module-worker sidecar is not a valid UTF-8 JavaScript module",
                artifact=label,
            ) from error
        modules[relative_path] = (path, payload)
        specs = [item.spec for item in imports if item.spec]
        specs.extend(item.spec for item in exports if item.spec)
        for specifier in specs:
            dependency = _resolve_module_specifier(relative_path, specifier)
            if dependency not in modules and dependency not in queued:
                pending.append(dependency)
                queued.add(dependency)

    expected_paths = set(RELEASE_MODULE_WORKER_CLOSURE_PATHS)
    actual_paths = set(modules)
    if actual_paths != expected_paths:
        raise _failure(
            "LOCAL_RELEASE_INVALID",
            "The module-worker sidecar closure differs from its audited deployment inventory",
            artifact="module-worker-closure",
        )

    ordered_paths = [
        *RELEASE_MODULE_WORKER_ROOT_PATHS,
        *sorted(set(modules).difference(RELEASE_MODULE_WORKER_ROOT_PATHS)),
    ]
    return tuple(
        ArtifactExpectation(
            _module_artifact_name(relative_path),
            modules[relative_path][0],
            f"/{relative_path}",
            len(modules[relative_path][1]),
            hashlib.sha256(modules[relative_path][1]).hexdigest(),
            modules[relative_path][1],
        )
        for relative_path in ordered_paths
    )


def _validate_provenance(
    provenance: dict,
    *,
    bundle_name: str,
    runtime_sha256: str,
    decoded_sha256: str,
    integrity: str,
) -> None:
    if provenance.get("_type") != "https://in-toto.io/Statement/v1" \
            or provenance.get("predicateType") != "https://slsa.dev/provenance/v1":
        raise _failure(
            "LOCAL_RELEASE_INVALID",
            "Local provenance has an invalid statement type",
            artifact="provenance",
        )
    subjects = provenance.get("subject")
    if not isinstance(subjects, list):
        raise _failure("LOCAL_RELEASE_INVALID", "Local provenance has no subject inventory", artifact="provenance")
    by_name = {
        str(subject.get("name") or ""): subject.get("digest")
        for subject in subjects
        if isinstance(subject, dict) and isinstance(subject.get("digest"), dict)
    }
    compressed = by_name.get(f"{bundle_name}.min.js.gz")
    decoded = by_name.get(f"{bundle_name}.min.js")
    try:
        decoded_sha384 = base64.b64decode(integrity.removeprefix("sha384-"), validate=True).hex()
    except ValueError as error:
        raise _failure("LOCAL_RELEASE_INVALID", "Local runtime integrity is malformed", artifact="sri") from error
    if compressed != {"sha256": runtime_sha256}:
        raise _failure(
            "LOCAL_RELEASE_INVALID",
            "Local provenance does not bind the runtime gzip",
            artifact="provenance",
        )
    if not isinstance(decoded, dict) or decoded.get("sha256") != decoded_sha256 \
            or decoded.get("sha384") != decoded_sha384:
        raise _failure(
            "LOCAL_RELEASE_INVALID",
            "Local provenance does not bind the decoded runtime",
            artifact="provenance",
        )


def load_local_release_expectation(
    site_root: Path | str,
    *,
    bundle_name: str = DEFAULT_BUNDLE_NAME,
) -> LocalReleaseExpectation:
    """Validate and load the exact local platform deployment truth."""
    root = Path(site_root).resolve()
    if not root.is_dir():
        raise _failure("LOCAL_RELEASE_INVALID", "Local release site root is missing")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", bundle_name):
        raise _failure("LOCAL_RELEASE_INVALID", "Bundle name is invalid")

    index_path = _safe_site_file(root, "webgpu-os/index.html", "WebGPU OS index")
    manifest_path = _safe_site_file(root, f"assets/{bundle_name}.manifest.json", "manifest")
    runtime_path = root / "assets" / f"{bundle_name}.min.js.gz"
    sri_path = _safe_site_file(root, f"assets/{bundle_name}.min.js.sri", "SRI sidecar")
    root_loader_path = _safe_site_file(root, "assets/release-runtime-loader.js", "root runtime loader")
    os_loader_path = _safe_site_file(root, "webgpu-os/assets/release-runtime-loader.js", "WebGPU OS runtime loader")

    required_deployment_paths = frozenset(WEBGPU_OS_REQUIRED_DEPLOYMENT_PATHS)
    pwa_asset_paths = frozenset(WEBGPU_OS_PWA_ASSET_PATHS)
    control_files: list[tuple[str, Path, str, bytes]] = []
    for label, relative_name in OS_CONTROL_ARTIFACTS:
        if relative_name not in required_deployment_paths \
                or (label != "release-boot" and relative_name not in pwa_asset_paths):
            raise _failure(
                "LOCAL_RELEASE_INVALID",
                "Bundler deployment inventory is missing a boot-critical WebGPU OS asset",
                artifact=label,
            )
        path = _safe_site_file(root, f"webgpu-os/{relative_name}", label)
        payload = _bounded_local_bytes(path, MAX_OS_CONTROL_BYTES, label)
        control_files.append((label, path, f"./{relative_name}", payload))
    module_worker_expectations = _load_module_worker_closure(
        root,
        required_deployment_paths,
    )

    index_bytes = _bounded_local_bytes(index_path, MAX_INDEX_BYTES, "WebGPU OS index")
    manifest_bytes = _bounded_local_bytes(manifest_path, MAX_MANIFEST_BYTES, "manifest")
    sri_bytes = _bounded_local_bytes(sri_path, MAX_SRI_BYTES, "SRI sidecar")
    root_loader_bytes = _bounded_local_bytes(root_loader_path, MAX_LOADER_BYTES, "root runtime loader")
    os_loader_bytes = _bounded_local_bytes(os_loader_path, MAX_LOADER_BYTES, "WebGPU OS runtime loader")
    if root_loader_bytes != os_loader_bytes or os_loader_bytes != _release_runtime_loader_bytes():
        raise _failure("LOCAL_RELEASE_INVALID", "Local runtime loader copies are not canonical", artifact="loader")

    manifest = _strict_json_object(manifest_bytes, "manifest")
    pwa_manifest_bytes = next(
        payload for label, _path, _remote_url, payload in control_files
        if label == "pwa-manifest"
    )
    _strict_json_object(pwa_manifest_bytes, "PWA manifest")
    if manifest.get("format") != "particle-bundle-manifest/v2" \
            or manifest.get("target") != "platform" \
            or manifest.get("name") != bundle_name \
            or manifest.get("production") is not True:
        raise _failure(
            "LOCAL_RELEASE_INVALID",
            "Local manifest is not a production platform release",
            artifact="manifest",
        )
    runtime_name = str(manifest.get("browser_runtime") or "")
    loader_name = str(manifest.get("browser_runtime_loader") or "")
    if runtime_name != f"{bundle_name}.min.js.gz" \
            or manifest.get("browser_runtime_compression") != "gzip" \
            or loader_name != "release-runtime-loader.js":
        raise _failure(
            "LOCAL_RELEASE_INVALID",
            "Local manifest has an invalid browser runtime contract",
            artifact="manifest",
        )
    try:
        compressed_length = int(manifest.get("browser_runtime_bytes"))
        decoded_length = int(manifest.get("browser_runtime_decoded_bytes"))
    except (TypeError, ValueError) as error:
        raise _failure(
            "LOCAL_RELEASE_INVALID",
            "Local manifest has invalid runtime lengths",
            artifact="manifest",
        ) from error
    try:
        runtime_parts = compressed_artifact_part_map(manifest).get(runtime_name)
        if runtime_parts:
            if not 0 < compressed_length <= MAX_RUNTIME_PARTS * RUNTIME_PART_BYTES:
                raise ValueError("Logical runtime exceeds the bounded transport")
            runtime_bytes = read_compressed_artifact(
                root / "assets", runtime_name, manifest,
                expected_bytes=compressed_length, prefer_full=False,
            )
        else:
            runtime_path = _safe_site_file(root, f"assets/{runtime_name}", "runtime")
            runtime_bytes = _bounded_local_bytes(runtime_path, MAX_RUNTIME_BYTES, "runtime")
    except (OSError, ValueError) as error:
        raise _failure(
            "LOCAL_RELEASE_INVALID", "Local runtime transport validation failed", artifact="runtime",
        ) from error
    if compressed_length != len(runtime_bytes) or manifest.get("gzip_bytes") != compressed_length \
            or decoded_length <= 0:
        raise _failure("LOCAL_RELEASE_INVALID", "Local runtime lengths do not match the manifest", artifact="runtime")

    try:
        integrity = _read_bundle_sri(sri_path)
        sidecar_identity = sri_bytes.decode("ascii", errors="strict")
    except (OSError, UnicodeDecodeError, ValueError) as error:
        raise _failure(
            "LOCAL_RELEASE_INVALID",
            "Local SRI sidecar validation failed",
            artifact="sri",
        ) from error
    if sidecar_identity != integrity \
            or not SRI_SHA384.fullmatch(integrity) \
            or manifest.get("sri") != integrity \
            or manifest.get("browser_runtime_integrity") != integrity:
        raise _failure("LOCAL_RELEASE_INVALID", "Local SRI identities do not agree", artifact="sri")
    try:
        _verify_release_runtime_gzip(runtime_bytes, integrity, decoded_length)
        runtime_sha256 = hashlib.sha256(runtime_bytes).hexdigest()
    except (OSError, ValueError) as error:
        raise _failure(
            "LOCAL_RELEASE_INVALID",
            "Local runtime integrity validation failed",
            artifact="runtime",
        ) from error
    decoded_sha256 = _decoded_sha256(runtime_bytes, decoded_length)

    provenance_contract = manifest.get("provenance")
    if not isinstance(provenance_contract, dict):
        raise _failure("LOCAL_RELEASE_INVALID", "Local manifest has no provenance contract", artifact="manifest")
    provenance_name = str(provenance_contract.get("path") or "")
    if provenance_name != f"{bundle_name}.provenance.json" \
            or provenance_contract.get("predicate_type") != "https://slsa.dev/provenance/v1" \
            or not re.fullmatch(r"[0-9a-f]{64}", str(provenance_contract.get("sha256") or "")):
        raise _failure(
            "LOCAL_RELEASE_INVALID",
            "Local manifest has an invalid provenance contract",
            artifact="manifest",
        )
    provenance_path = _safe_site_file(root, f"assets/{provenance_name}", "provenance")
    provenance_bytes = _bounded_local_bytes(provenance_path, MAX_PROVENANCE_BYTES, "provenance")
    provenance_sha256 = hashlib.sha256(provenance_bytes).hexdigest()
    if provenance_sha256 != provenance_contract["sha256"]:
        raise _failure(
            "LOCAL_RELEASE_INVALID",
            "Local provenance hash does not match the manifest",
            artifact="provenance",
        )
    _validate_provenance(
        _strict_json_object(provenance_bytes, "provenance"),
        bundle_name=bundle_name,
        runtime_sha256=runtime_sha256,
        decoded_sha256=decoded_sha256,
        integrity=integrity,
    )

    try:
        binding = _runtime_loader_binding(index_bytes, "Local WebGPU OS index")
        cache_token = _binding_token(binding, "Local WebGPU OS index")
        expected_token = _release_runtime_cache_token(runtime_bytes, runtime_parts)
    except OriginVerificationError as error:
        raise _failure(
            "LOCAL_RELEASE_INVALID",
            "Local WebGPU OS index has an invalid runtime binding",
            artifact="index",
        ) from error
    except OSError as error:
        raise _failure(
            "LOCAL_RELEASE_INVALID",
            "Local runtime cache identity could not be read",
            artifact="runtime",
        ) from error
    if cache_token != expected_token:
        raise _failure("LOCAL_RELEASE_INVALID", "Local WebGPU OS index has a stale runtime token", artifact="index")
    if binding.get("data-integrity") != integrity \
            or binding.get("data-runtime-bytes") != str(decoded_length) \
            or binding.get("data-runtime-compressed-bytes") != str(compressed_length):
        raise _failure("LOCAL_RELEASE_INVALID", "Local WebGPU OS index does not match the manifest", artifact="index")

    expected_parts = [
        {**record, "src": f"../assets/{record['src']}?v={cache_token}"}
        for record in runtime_parts or ()
    ]
    try:
        bound_parts = json.loads(binding["data-runtime-parts"]) if "data-runtime-parts" in binding else None
    except (ValueError, TypeError) as error:
        raise _failure("LOCAL_RELEASE_INVALID", "Local runtime part binding is malformed", artifact="index") from error
    if bound_parts != (expected_parts or None) or (not runtime_parts and "data-runtime-parts" in binding):
        raise _failure("LOCAL_RELEASE_INVALID", "Local runtime part binding does not match the manifest", artifact="index")

    local_index_url = "https://release.invalid/webgpu-os/index.html"
    resolved_loader = urlsplit(urljoin(local_index_url, binding["src"]))
    resolved_runtime = urlsplit(urljoin(local_index_url, binding["data-runtime-src"]))
    if any(
        parts.scheme != "https" or parts.netloc != "release.invalid"
        or parts.username is not None or parts.password is not None or parts.fragment
        for parts in (resolved_loader, resolved_runtime)
    ) or resolved_loader.path != f"/webgpu-os/assets/{loader_name}" \
            or resolved_runtime.path != f"/assets/{runtime_name}":
        raise _failure(
            "LOCAL_RELEASE_INVALID",
            "Local WebGPU OS index points at unexpected runtime assets",
            artifact="index",
        )

    index_expectation = ArtifactExpectation(
        "index",
        index_path,
        "index.html",
        len(index_bytes),
        hashlib.sha256(index_bytes).hexdigest(),
        index_bytes,
    )
    control_expectations = tuple(
        ArtifactExpectation(
            label,
            path,
            remote_url,
            len(payload),
            hashlib.sha256(payload).hexdigest(),
            payload,
        )
        for label, path, remote_url, payload in control_files
    )
    runtime_expectations = []
    if runtime_parts:
        for index, (record, bound) in enumerate(zip(runtime_parts, expected_parts)):
            label = f"runtime-part:{index:04d}"
            path = _safe_site_file(root, f"assets/{record['src']}", label)
            payload = _bounded_local_bytes(path, RUNTIME_PART_BYTES, label)
            if len(payload) != record["bytes"] or hashlib.sha256(payload).hexdigest() != record["sha256"]:
                raise _failure("LOCAL_RELEASE_INVALID", "Local runtime part changed during verification", artifact=label)
            runtime_expectations.append(ArtifactExpectation(
                label, path, bound["src"], len(payload), record["sha256"], payload,
            ))
    else:
        runtime_expectations.append(ArtifactExpectation(
            "runtime", runtime_path, binding["data-runtime-src"],
            len(runtime_bytes), runtime_sha256, runtime_bytes,
        ))
    artifacts = (
        ArtifactExpectation(
            "loader",
            os_loader_path,
            binding["src"],
            len(os_loader_bytes),
            hashlib.sha256(os_loader_bytes).hexdigest(),
            os_loader_bytes,
        ),
        *control_expectations,
        ArtifactExpectation(
            "manifest",
            manifest_path,
            f"../assets/{bundle_name}.manifest.json?v={cache_token}",
            len(manifest_bytes),
            hashlib.sha256(manifest_bytes).hexdigest(),
            manifest_bytes,
        ),
        ArtifactExpectation(
            "provenance",
            provenance_path,
            f"../assets/{provenance_name}?v={cache_token}",
            len(provenance_bytes),
            provenance_sha256,
            provenance_bytes,
        ),
        ArtifactExpectation(
            "sri",
            sri_path,
            f"../assets/{bundle_name}.min.js.sri?v={cache_token}",
            len(sri_bytes),
            hashlib.sha256(sri_bytes).hexdigest(),
            sri_bytes,
        ),
        *runtime_expectations,
        *module_worker_expectations,
    )
    return LocalReleaseExpectation(
        site_root=root,
        bundle_name=bundle_name,
        cache_token=cache_token,
        index_binding=_binding_projection(binding),
        index=index_expectation,
        artifacts=artifacts,
    )


def _read_remote_bytes(
    url: str,
    *,
    label: str,
    maximum_bytes: int,
    expected_bytes: int | None,
    timeout_seconds: float,
    expected_origin: tuple[str, str, int],
    allow_loopback_http: bool,
    allow_redirects: bool = True,
) -> bytes:
    opener = build_opener(_NoRedirect())
    current = url
    deadline = time.monotonic() + timeout_seconds
    for redirects in range(MAX_REDIRECTS + 1):
        _validate_same_origin_url(current, expected_origin, allow_loopback_http=allow_loopback_http)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise _failure("REMOTE_TIMEOUT", f"Timed out while reading {label}", artifact=label)
        request = Request(
            current,
            headers={
                "Accept": "*/*",
                "Accept-Encoding": "identity",
                "Cache-Control": "no-cache, no-store, max-age=0",
                "Pragma": "no-cache",
                "User-Agent": "ParticleRealms-Origin-Verifier/1",
            },
            method="GET",
        )
        try:
            response = opener.open(request, timeout=remaining)
        except HTTPError as error:
            try:
                status = int(error.code)
                if status in REDIRECT_STATUSES:
                    if not allow_redirects:
                        raise _failure(
                            "REMOTE_REDIRECT_FORBIDDEN", f"{label} must be served without a redirect", artifact=label,
                        )
                    location = error.headers.get("Location")
                    if not location:
                        raise _failure(
                            "REMOTE_REDIRECT_INVALID",
                            f"{label} returned a redirect without a location",
                            artifact=label,
                        )
                    if redirects >= MAX_REDIRECTS:
                        raise _failure("REMOTE_REDIRECT_LIMIT", f"{label} exceeded the redirect limit", artifact=label)
                    redirected = urljoin(current, location)
                    cache_tokens = parse_qs(urlsplit(current).query, keep_blank_values=True).get(
                        "__particle_verify", []
                    )
                    current = _cache_busted(redirected, cache_tokens[0]) \
                        if len(cache_tokens) == 1 else redirected
                    continue
                raise _failure("REMOTE_HTTP_STATUS", f"{label} returned HTTP {status}", artifact=label)
            finally:
                error.close()
        except (TimeoutError, socket.timeout) as error:
            raise _failure("REMOTE_TIMEOUT", f"Timed out while reading {label}", artifact=label) from error
        except (URLError, OSError) as error:
            raise _failure("REMOTE_NETWORK_ERROR", f"Network request failed for {label}", artifact=label) from error

        try:
            status = int(getattr(response, "status", response.getcode()))
            if status != 200:
                raise _failure("REMOTE_HTTP_STATUS", f"{label} returned HTTP {status}", artifact=label)
            declared = response.headers.get("Content-Length")
            if declared is not None:
                try:
                    declared_length = int(declared)
                except ValueError as error:
                    raise _failure(
                        "REMOTE_LENGTH_INVALID",
                        f"{label} declared an invalid byte length",
                        artifact=label,
                    ) from error
                if declared_length < 0 or declared_length > maximum_bytes:
                    raise _failure("REMOTE_TOO_LARGE", f"{label} exceeds its read bound", artifact=label)
                if expected_bytes is not None and declared_length != expected_bytes:
                    raise _failure(
                        "ARTIFACT_SIZE_MISMATCH",
                        f"{label} does not match the local byte length",
                        artifact=label,
                    )
            output = bytearray()
            while True:
                if time.monotonic() >= deadline:
                    raise _failure("REMOTE_TIMEOUT", f"Timed out while reading {label}", artifact=label)
                chunk = response.read(min(READ_CHUNK_BYTES, maximum_bytes + 1 - len(output)))
                if not chunk:
                    break
                output.extend(chunk)
                if len(output) > maximum_bytes:
                    raise _failure("REMOTE_TOO_LARGE", f"{label} exceeds its read bound", artifact=label)
            payload = bytes(output)
        except (TimeoutError, socket.timeout) as error:
            raise _failure("REMOTE_TIMEOUT", f"Timed out while reading {label}", artifact=label) from error
        except OSError as error:
            raise _failure("REMOTE_NETWORK_ERROR", f"Network response failed for {label}", artifact=label) from error
        finally:
            response.close()
        if expected_bytes is not None and len(payload) != expected_bytes:
            raise _failure("ARTIFACT_SIZE_MISMATCH", f"{label} does not match the local byte length", artifact=label)
        return payload
    raise _failure("REMOTE_REDIRECT_LIMIT", f"{label} exceeded the redirect limit", artifact=label)


def verify_platform_origin(
    origin: str,
    site_root: Path | str,
    *,
    bundle_name: str = DEFAULT_BUNDLE_NAME,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    allow_loopback_http: bool = False,
) -> OriginVerificationResult:
    """Compare one live origin with the exact local platform release, read-only."""
    if not isinstance(timeout_seconds, (int, float)) or not 0.5 <= float(timeout_seconds) <= 120.0:
        raise _failure("TIMEOUT_INVALID", "Timeout must be between 0.5 and 120 seconds")
    normalized_origin = _normalize_origin(origin, allow_loopback_http=allow_loopback_http)
    expected_origin = _origin_identity(normalized_origin)
    local = load_local_release_expectation(site_root, bundle_name=bundle_name)
    nonce = secrets.token_hex(12)

    index_url = _cache_busted(urljoin(normalized_origin, "webgpu-os/index.html"), f"{nonce}-index")
    live_index = _read_remote_bytes(
        index_url,
        label="index",
        maximum_bytes=MAX_INDEX_BYTES,
        expected_bytes=None,
        timeout_seconds=float(timeout_seconds),
        expected_origin=expected_origin,
        allow_loopback_http=allow_loopback_http,
    )
    live_binding = _runtime_loader_binding(live_index, "Live WebGPU OS index")
    if _binding_token(live_binding, "Live WebGPU OS index") != local.cache_token \
            or _binding_projection(live_binding) != local.index_binding:
        raise _failure(
            "INDEX_BINDING_MISMATCH",
            "Live WebGPU OS index is stale or partially deployed",
            artifact="index",
        )
    live_index_sha256 = hashlib.sha256(live_index).hexdigest()
    if live_index_sha256 != local.index.sha256 or live_index != local.index.payload:
        raise _failure(
            "INDEX_HASH_MISMATCH",
            "Live WebGPU OS index does not match the local release",
            artifact="index",
        )

    verified = [VerifiedArtifact("index", len(live_index), live_index_sha256)]
    remote_index_url = urljoin(normalized_origin, "webgpu-os/index.html")
    for expectation in local.artifacts:
        remote_url = urljoin(remote_index_url, expectation.remote_url)
        remote_url = _cache_busted(remote_url, f"{nonce}-{expectation.name}")
        payload = _read_remote_bytes(
            remote_url,
            label=expectation.name,
            maximum_bytes=expectation.byte_length,
            expected_bytes=expectation.byte_length,
            timeout_seconds=float(timeout_seconds),
            expected_origin=expected_origin,
            allow_loopback_http=allow_loopback_http,
            allow_redirects=not expectation.name.startswith("runtime-part:"),
        )
        actual_sha256 = hashlib.sha256(payload).hexdigest()
        if actual_sha256 != expectation.sha256 or payload != expectation.payload:
            raise _failure(
                "ARTIFACT_HASH_MISMATCH",
                f"Live {expectation.name} does not match the local release",
                artifact=expectation.name,
            )
        verified.append(VerifiedArtifact(expectation.name, len(payload), actual_sha256))
    return OriginVerificationResult(normalized_origin, local.cache_token, tuple(verified))


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Read-only exact verification of a deployed Particle platform origin.",
    )
    parser.add_argument("--origin", default=DEFAULT_ORIGIN, help="HTTPS deployment origin.")
    parser.add_argument(
        "--site-root",
        type=Path,
        default=Path("release/site"),
        help="Local release/site tree used as the exact deployment truth.",
    )
    parser.add_argument("--bundle-name", default=DEFAULT_BUNDLE_NAME)
    parser.add_argument(
        "--timeout-seconds",
        type=float,
        default=DEFAULT_TIMEOUT_SECONDS,
        help="Bound for each index or artifact request (0.5 to 120 seconds).",
    )
    return parser


def main(argv: list[str] | None = None, *, allow_loopback_http: bool = False) -> int:
    args = _parser().parse_args(argv)
    try:
        result = verify_platform_origin(
            args.origin,
            args.site_root,
            bundle_name=args.bundle_name,
            timeout_seconds=args.timeout_seconds,
            allow_loopback_http=allow_loopback_http,
        )
    except OriginVerificationError as error:
        suffix = f" [{error.artifact}]" if error.artifact else ""
        print(f"[origin-verify] FAIL {error.code}{suffix}: {error}", file=sys.stderr)
        return 1
    except Exception:
        print("[origin-verify] FAIL INTERNAL_ERROR: verification did not complete", file=sys.stderr)
        return 2

    total_bytes = sum(item.byte_length for item in result.artifacts)
    print(
        f"[origin-verify] PASS origin={result.origin} token={result.cache_token} "
        f"artifacts={len(result.artifacts)} bytes={total_bytes}"
    )
    for item in result.artifacts:
        print(f"[origin-verify] {item.name}: {item.byte_length} bytes sha256={item.sha256}")
    return 0


__all__ = [
    "ArtifactExpectation",
    "LocalReleaseExpectation",
    "OriginVerificationError",
    "OriginVerificationResult",
    "VerifiedArtifact",
    "load_local_release_expectation",
    "main",
    "verify_platform_origin",
]
