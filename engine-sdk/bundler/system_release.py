# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Deterministic, signed system-release artifacts for the installed WebGPU OS.

This module extends the existing Python release tooling.  It does not run a
service, modify the Realm network, or share ownership with application
``.prpkg`` packages.  Its output is consumed by the stable browser bootstrap
and the contracts in ``webgpu-os/system-release/contracts.js``.
"""

from __future__ import annotations

import base64
import datetime as _datetime
import hashlib
import hmac
import json
import os
import re
import shutil
import struct
import tempfile
import unicodedata
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Iterable, Mapping, Sequence

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from jhc import JhcPackage, canonicalize


RELEASE_DESCRIPTOR_SCHEMA = "particle.release-descriptor"
SYSTEM_RELEASE_MANIFEST_SCHEMA = "particle.system-release-manifest"
RELEASE_CONTRACT_VERSION = 1
SEGMENTED_PACKAGE_SCHEMA = "particle.segmented-package-index"
SEGMENTED_PACKAGE_VERSION = 1
SEGMENTED_PACKAGE_MAGIC = b"PRSYS1\r\n"
SEGMENTED_PACKAGE_HEADER_BYTES = 16
SEGMENTED_PACKAGE_FLAG_ENCRYPTED = 0x0001
SEGMENTED_PACKAGE_FORMAT = "particle-system-release-v1"
DEFAULT_SEGMENT_BYTES = 1024 * 1024
DEFAULT_PIECE_BYTES = 768 * 1024
MIN_SEGMENT_BYTES = 64 * 1024
MAX_SEGMENT_BYTES = 16 * 1024 * 1024
MIN_PIECE_BYTES = 64 * 1024
MAX_PIECE_BYTES = 4 * 1024 * 1024
MAX_RELEASE_FILES = 100_000
MAX_RELEASE_BYTES = 2 * 1024 * 1024 * 1024
MAX_SAFE_INTEGER = 9_007_199_254_740_991

TUF_SPEC_VERSION = "1.0.31"
TUF_ROLES = ("root", "timestamp", "snapshot", "targets")
RELEASE_KEYSET_SCHEMA = "particle.system-release-keyset"
RELEASE_KEYSET_VERSION = 1

ACTIVATION_CLASSES = (
    "asset-live",
    "runtime-warm",
    "runtime-shadow",
    "bootstrap-next-launch",
)

# These paths are authority of the stable, physical /webgpu-os/ bootstrap.
# They may be present in the staged deployment tree, but can never become
# install operations.  ``webgpu-os/runtime.html`` is the audited source of the
# release-qualified logical ``webgpu-os/index.html`` alias.
STABLE_BOOTSTRAP_EXACT_PATHS = frozenset({
    "webgpu-os/index.html",
    "webgpu-os/manifest.webmanifest",
    "webgpu-os/sw.js",
    "webgpu-os/offline.html",
    "webgpu-os/boot-theme.js",
    "webgpu-os/shared/EchoFormProfile.js",
    "webgpu-os/shared/EchoForm.js",
    "webgpu-os/shared/EchoForm.css",
})
STABLE_BOOTSTRAP_PREFIXES = (
    "webgpu-os/platform/runtime-host/",
    "webgpu-os/platform/network-host/",
    "webgpu-os/system-release/",
    "webgpu-os/bootstrap/",
)
FORBIDDEN_STAGED_COMPONENTS = frozenset({
    ".git",
    ".trust-keys",
    "__pycache__",
    "node_modules",
})
DEFAULT_RUNTIME_ENTRY_SOURCE = "webgpu-os/runtime.html"
DEFAULT_RUNTIME_ENTRY_PATH = "webgpu-os/index.html"

_BOOTSTRAP_TIER_EXACT = frozenset({
    DEFAULT_RUNTIME_ENTRY_PATH,
    "webgpu-os/boot.js",
    "webgpu-os/index.js",
    "webgpu-os/style.css",
})
_HOT_TIER_PREFIXES = (
    "webgpu-os/kernel/",
    "webgpu-os/shell/",
    "webgpu-os/drivers/",
    "webgpu-os/storage/",
    "webgpu-os/platform/",
    "engine/core/",
    "plauna/",
)
_ASSET_LIVE_SUFFIXES = frozenset({
    ".avif", ".bmp", ".css", ".gif", ".ico", ".jpeg", ".jpg", ".json",
    ".mp3", ".mp4", ".ogg", ".png", ".svg", ".txt", ".webm", ".webp",
    ".woff", ".woff2",
})
_RUNTIME_SHADOW_PREFIXES = (
    "engine/network/",
    "engine/collab/",
    "webgpu-os/kernel/",
    "webgpu-os/drivers/NetworkDriver.js",
    "webgpu-os/storage/",
)


class SystemReleaseBuildError(RuntimeError):
    """Raised when a release cannot be built without violating its contract."""


@dataclass(frozen=True)
class ReleaseRoleKey:
    role: str
    keyid: str
    private_key: ec.EllipticCurvePrivateKey
    public_raw: bytes


@dataclass(frozen=True)
class ReleaseKeySet:
    roles: Mapping[str, tuple[ReleaseRoleKey, ...]]
    thresholds: Mapping[str, int]
    root_metadata: Mapping[str, Any] | None = None
    root_metadata_bytes: bytes = b""

    def role(self, name: str) -> tuple[ReleaseRoleKey, ...]:
        try:
            return self.roles[name]
        except KeyError as error:
            raise SystemReleaseBuildError(f"Release keyset has no {name!r} role") from error

    def threshold(self, name: str) -> int:
        return int(self.thresholds[name])


@dataclass(frozen=True)
class StagedReleaseFile:
    physical_path: Path
    physical_relative_path: str
    logical_path: str
    owner: str
    byte_length: int
    object_hash: str
    mime: str
    boot_tier: str
    hotset: bool

    def contract_record(self) -> dict[str, Any]:
        return {
            "path": self.logical_path,
            "objectHash": self.object_hash,
            "byteLength": self.byte_length,
            "mime": self.mime,
            "ownership": self.owner,
            "bootTier": self.boot_tier,
            "hotset": self.hotset,
        }


@dataclass(frozen=True)
class SystemReleaseBuildResult:
    output_dir: Path
    release_id: str
    descriptor: Mapping[str, Any]
    manifest: Mapping[str, Any]
    receipt: Mapping[str, Any]


def _utf16_sort_key(value: str) -> bytes:
    return value.encode("utf-16-be", "surrogatepass")


def canonical_release_json(value: Any) -> str:
    """Match the browser release contract's canonical JSON profile.

    Release schemas contain integers, not floating-point measurements.  The
    explicit float rejection avoids a Python/ECMAScript representation split.
    """

    def encode(item: Any) -> str:
        if item is None:
            return "null"
        if item is True:
            return "true"
        if item is False:
            return "false"
        if isinstance(item, int):
            if abs(item) > 9_007_199_254_740_991:
                raise SystemReleaseBuildError("Canonical release integer exceeds JavaScript's safe range")
            return str(item)
        if isinstance(item, float):
            raise SystemReleaseBuildError("Release metadata must not contain floating-point values")
        if isinstance(item, str):
            if any(0xD800 <= ord(character) <= 0xDFFF for character in item):
                raise SystemReleaseBuildError("Release metadata must not contain lone UTF-16 surrogates")
            return json.dumps(item, ensure_ascii=False, separators=(",", ":"))
        if isinstance(item, (list, tuple)):
            return "[" + ",".join(encode(entry) for entry in item) + "]"
        if isinstance(item, Mapping):
            if not all(isinstance(key, str) for key in item):
                raise SystemReleaseBuildError("Canonical release object keys must be strings")
            keys = sorted(item, key=_utf16_sort_key)
            return "{" + ",".join(
                f"{json.dumps(key, ensure_ascii=False)}:{encode(item[key])}"
                for key in keys
            ) + "}"
        raise SystemReleaseBuildError(
            f"Unsupported canonical release value: {type(item).__name__}"
        )

    return encode(value)


def canonical_release_bytes(value: Any) -> bytes:
    return canonical_release_json(value).encode("utf-8")


def _sha256_hex(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _sha256_uri(payload: bytes) -> str:
    return f"sha256:{_sha256_hex(payload)}"


def _sha256_path(path: Path, chunk_bytes: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while True:
            block = stream.read(chunk_bytes)
            if not block:
                break
            digest.update(block)
    return f"sha256:{digest.hexdigest()}"


def _canonical_timestamp(value: str | _datetime.datetime) -> str:
    if isinstance(value, str):
        try:
            parsed = _datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as error:
            raise SystemReleaseBuildError(f"Invalid UTC release timestamp: {value!r}") from error
    elif isinstance(value, _datetime.datetime):
        parsed = value
    else:
        raise SystemReleaseBuildError("Release timestamp must be an ISO string or datetime")
    if parsed.tzinfo is None:
        raise SystemReleaseBuildError("Release timestamp must include a timezone")
    parsed = parsed.astimezone(_datetime.timezone.utc)
    return parsed.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def source_date_timestamp() -> str:
    """Return the deterministic build timestamp selected by SOURCE_DATE_EPOCH."""
    raw = os.environ.get("SOURCE_DATE_EPOCH")
    if raw is None:
        raise SystemReleaseBuildError(
            "A deterministic release requires --published-at or SOURCE_DATE_EPOCH"
        )
    try:
        epoch = int(raw, 10)
    except ValueError as error:
        raise SystemReleaseBuildError("SOURCE_DATE_EPOCH must be an integer") from error
    if epoch < 0:
        raise SystemReleaseBuildError("SOURCE_DATE_EPOCH must not be negative")
    return _canonical_timestamp(_datetime.datetime.fromtimestamp(epoch, _datetime.timezone.utc))


def _future_timestamp(base: str, delta: _datetime.timedelta) -> str:
    parsed = _datetime.datetime.fromisoformat(base.replace("Z", "+00:00"))
    return _canonical_timestamp(parsed + delta)


def _raw_public_key(private_key: ec.EllipticCurvePrivateKey) -> bytes:
    return private_key.public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )


def _release_key_id(role: str, public_raw: bytes) -> str:
    return f"release-{role}-{_sha256_hex(public_raw)[:24]}"


def _sign_raw_p256(private_key: ec.EllipticCurvePrivateKey, payload: bytes) -> bytes:
    """Emit deterministic WebCrypto-compatible raw P-256 ``r || s`` bytes."""
    try:
        algorithm = ec.ECDSA(hashes.SHA256(), deterministic_signing=True)
    except TypeError as error:  # cryptography before deterministic ECDSA support
        raise SystemReleaseBuildError(
            "Deterministic release signing requires a cryptography build with deterministic ECDSA"
        ) from error
    der = private_key.sign(payload, algorithm)
    r_value, s_value = decode_dss_signature(der)
    return r_value.to_bytes(32, "big") + s_value.to_bytes(32, "big")


def _atomic_write_bytes(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _atomic_write_canonical_json(path: Path, value: Any) -> bytes:
    payload = canonical_release_bytes(value)
    _atomic_write_bytes(path, payload)
    return payload


def generate_release_keyset(
    directory: Path | str,
    *,
    counts: Mapping[str, int] | None = None,
    thresholds: Mapping[str, int] | None = None,
    root_version: int = 1,
    root_expires: str | _datetime.datetime | None = None,
    previous_keyset: ReleaseKeySet | None = None,
) -> Path:
    """Generate distinct P-256 keys for every release metadata role.

    Existing files are never overwritten.  The returned private keyset belongs
    outside release/site and is already excluded by normal bundler policy.
    """
    directory = Path(directory)
    counts = {role: int((counts or {}).get(role, 1)) for role in TUF_ROLES}
    thresholds = {
        role: int((thresholds or {}).get(role, 1)) for role in TUF_ROLES
    }
    for role in TUF_ROLES:
        if counts[role] < 1:
            raise SystemReleaseBuildError(f"{role} requires at least one key")
        if thresholds[role] < 1 or thresholds[role] > counts[role]:
            raise SystemReleaseBuildError(f"{role} threshold exceeds its key count")
    expected_root_version = (
        int(previous_keyset.root_metadata["signed"]["version"]) + 1
        if previous_keyset is not None and previous_keyset.root_metadata is not None
        else 1
    )
    if root_version != expected_root_version:
        raise SystemReleaseBuildError(
            f"Release root version must be the sequential value {expected_root_version}"
        )
    if root_expires is None:
        root_expires = _datetime.datetime.now(_datetime.timezone.utc) + _datetime.timedelta(days=3650)
    root_expiry = _canonical_timestamp(root_expires)

    manifest_path = directory / "release-keyset.json"
    root_metadata_path = directory / "root.json"
    planned_paths = [manifest_path, root_metadata_path]
    for role in TUF_ROLES:
        planned_paths.extend(
            directory / f"{role}-{index + 1}.private.pem"
            for index in range(counts[role])
        )
    existing = [path for path in planned_paths if path.exists()]
    if existing:
        raise FileExistsError(
            "Release key generation refuses to overwrite: "
            + ", ".join(str(path) for path in existing)
        )

    generated: dict[str, list[dict[str, str]]] = {}
    role_keys: dict[str, tuple[ReleaseRoleKey, ...]] = {}
    private_payloads: dict[Path, bytes] = {}
    seen_public: set[bytes] = set()
    for role in TUF_ROLES:
        generated[role] = []
        loaded_role: list[ReleaseRoleKey] = []
        for index in range(counts[role]):
            private_key = ec.generate_private_key(ec.SECP256R1())
            public_raw = _raw_public_key(private_key)
            if public_raw in seen_public:  # practically impossible; remain fail-closed
                raise SystemReleaseBuildError("Release key generator repeated key material")
            seen_public.add(public_raw)
            filename = f"{role}-{index + 1}.private.pem"
            private_payloads[directory / filename] = private_key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            )
            generated[role].append({
                "keyid": _release_key_id(role, public_raw),
                "privateKey": filename,
            })
            loaded_role.append(ReleaseRoleKey(
                role,
                _release_key_id(role, public_raw),
                private_key,
                public_raw,
            ))
        role_keys[role] = tuple(loaded_role)

    directory.mkdir(parents=True, exist_ok=True)
    for path, payload in private_payloads.items():
        _atomic_write_bytes(path, payload)
        try:
            path.chmod(0o600)
        except OSError:
            pass
    manifest = {
        "schema": RELEASE_KEYSET_SCHEMA,
        "schemaVersion": RELEASE_KEYSET_VERSION,
        "rootMetadata": "root.json",
        "roles": {
            role: {
                "threshold": thresholds[role],
                "keys": generated[role],
            }
            for role in TUF_ROLES
        },
    }
    unsigned_keyset = ReleaseKeySet(roles=role_keys, thresholds=thresholds)
    root_signed = _root_signed(
        unsigned_keyset,
        version=root_version,
        expires=root_expiry,
    )
    previous_signers = (
        previous_keyset.role("root") if previous_keyset is not None else ()
    )
    root_envelope, root_bytes = _sign_tuf_envelope(
        root_signed,
        tuple(unsigned_keyset.role("root")) + tuple(previous_signers),
    )
    # Both the old and new root thresholds are present during rotation.  The
    # exact resulting envelope is persisted beside the private key manifest so
    # later releases cannot accidentally change root bytes at the same version.
    _validate_root_metadata(root_envelope, unsigned_keyset)
    if previous_keyset is not None:
        _validate_root_rotation_signatures(root_envelope, previous_keyset)
    _atomic_write_bytes(root_metadata_path, root_bytes)
    _atomic_write_canonical_json(manifest_path, manifest)
    return manifest_path


def load_release_keyset(path: Path | str) -> ReleaseKeySet:
    path = Path(path)
    if path.is_dir():
        path = path / "release-keyset.json"
    try:
        value = json.loads(path.read_text(encoding="utf-8", errors="strict"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemReleaseBuildError(f"Cannot load release keyset {path}: {error}") from error
    if not isinstance(value, dict) or value.get("schema") != RELEASE_KEYSET_SCHEMA \
            or value.get("schemaVersion") != RELEASE_KEYSET_VERSION:
        raise SystemReleaseBuildError("Unsupported release keyset schema")
    if set(value) != {"schema", "schemaVersion", "rootMetadata", "roles"} \
            or value.get("rootMetadata") != "root.json":
        raise SystemReleaseBuildError("Release keyset has unknown or missing root metadata fields")
    role_values = value.get("roles")
    if not isinstance(role_values, dict) or set(role_values) != set(TUF_ROLES):
        raise SystemReleaseBuildError("Release keyset must define exactly four separate TUF roles")

    roles: dict[str, tuple[ReleaseRoleKey, ...]] = {}
    thresholds: dict[str, int] = {}
    all_keyids: set[str] = set()
    all_public: set[bytes] = set()
    for role in TUF_ROLES:
        definition = role_values[role]
        if not isinstance(definition, dict) or set(definition) != {"threshold", "keys"}:
            raise SystemReleaseBuildError(f"Invalid {role} keyset definition")
        entries = definition["keys"]
        threshold = definition["threshold"]
        if not isinstance(entries, list) or not entries or not isinstance(threshold, int) \
                or isinstance(threshold, bool) or threshold < 1 or threshold > len(entries):
            raise SystemReleaseBuildError(f"Invalid {role} threshold or key list")
        loaded: list[ReleaseRoleKey] = []
        for record in entries:
            if not isinstance(record, dict) or set(record) != {"keyid", "privateKey"}:
                raise SystemReleaseBuildError(f"Invalid {role} key record")
            keyid = record["keyid"]
            filename = record["privateKey"]
            if not isinstance(keyid, str) or not keyid or not isinstance(filename, str) \
                    or not filename or PurePosixPath(filename).name != filename:
                raise SystemReleaseBuildError(f"Invalid {role} key identifier or filename")
            key_path = path.parent / filename
            try:
                private_key = serialization.load_pem_private_key(
                    key_path.read_bytes(), password=None
                )
            except (OSError, ValueError, TypeError) as error:
                raise SystemReleaseBuildError(f"Cannot load {role} private key {key_path}") from error
            if not isinstance(private_key, ec.EllipticCurvePrivateKey) \
                    or not isinstance(private_key.curve, ec.SECP256R1):
                raise SystemReleaseBuildError(f"{role} key {key_path} is not ECDSA P-256")
            public_raw = _raw_public_key(private_key)
            if keyid != _release_key_id(role, public_raw):
                raise SystemReleaseBuildError(f"{role} key id does not match its public key")
            if keyid in all_keyids or public_raw in all_public:
                raise SystemReleaseBuildError("Release roles must not reuse key material")
            all_keyids.add(keyid)
            all_public.add(public_raw)
            loaded.append(ReleaseRoleKey(role, keyid, private_key, public_raw))
        roles[role] = tuple(loaded)
        thresholds[role] = threshold
    root_path = path.parent / value["rootMetadata"]
    try:
        root_bytes = root_path.read_bytes()
        root_metadata = json.loads(root_bytes.decode("utf-8", errors="strict"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SystemReleaseBuildError(f"Cannot load release root metadata {root_path}") from error
    if canonical_release_bytes(root_metadata) != root_bytes:
        raise SystemReleaseBuildError("Release root metadata must use canonical JSON")
    keyset = ReleaseKeySet(
        roles=roles,
        thresholds=thresholds,
        root_metadata=root_metadata,
        root_metadata_bytes=root_bytes,
    )
    _validate_root_metadata(root_metadata, keyset)
    return keyset


def is_stable_bootstrap_path(path: str) -> bool:
    canonical = canonicalize(path)
    return canonical in STABLE_BOOTSTRAP_EXACT_PATHS or any(
        canonical.startswith(prefix) for prefix in STABLE_BOOTSTRAP_PREFIXES
    )


def assert_unique_logical_paths(paths: Iterable[str]) -> tuple[str, ...]:
    canonical_paths: list[str] = []
    seen_exact: set[str] = set()
    seen_portable: dict[str, str] = {}
    for original in paths:
        normalized = unicodedata.normalize("NFC", original)
        if normalized != original:
            raise SystemReleaseBuildError(
                f"Release path must use NFC normalization: {original!r}"
            )
        canonical = canonicalize(original)
        if canonical != original:
            raise SystemReleaseBuildError(
                f"Release path is not canonical: {original!r} -> {canonical!r}"
            )
        if canonical in seen_exact:
            raise SystemReleaseBuildError(f"Duplicate release path: {canonical}")
        portable = canonical.casefold()
        prior = seen_portable.get(portable)
        if prior is not None:
            raise SystemReleaseBuildError(
                f"Portable case/Unicode path collision: {prior!r} and {canonical!r}"
            )
        seen_exact.add(canonical)
        seen_portable[portable] = canonical
        canonical_paths.append(canonical)
    return tuple(canonical_paths)


def _mime_for_path(path: str) -> str:
    suffix = PurePosixPath(path).suffix.lower()
    # Do not call ``mimetypes.guess_type`` here: its registry can vary by host
    # OS, which would change manifest/release hashes for identical site bytes.
    deterministic_types = {
        ".avif": "image/avif",
        ".bmp": "image/bmp",
        ".css": "text/css",
        ".csv": "text/csv",
        ".flac": "audio/flac",
        ".gif": "image/gif",
        ".gz": "application/gzip",
        ".htm": "text/html",
        ".html": "text/html",
        ".ico": "image/x-icon",
        ".js": "text/javascript",
        ".jpeg": "image/jpeg",
        ".jpg": "image/jpeg",
        ".json": "application/json",
        ".m4a": "audio/mp4",
        ".map": "application/json",
        ".md": "text/markdown",
        ".mjs": "text/javascript",
        ".mp3": "audio/mpeg",
        ".mp4": "video/mp4",
        ".oga": "audio/ogg",
        ".ogg": "audio/ogg",
        ".ogv": "video/ogg",
        ".otf": "font/otf",
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".tar": "application/x-tar",
        ".ttf": "font/ttf",
        ".txt": "text/plain",
        ".wasm": "application/wasm",
        ".wav": "audio/wav",
        ".webm": "video/webm",
        ".webp": "image/webp",
        ".wgsl": "text/wgsl",
        ".webmanifest": "application/manifest+json",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".xml": "application/xml",
        ".zip": "application/zip",
    }
    return deterministic_types.get(suffix, "application/octet-stream")


def _owner_for_path(path: str) -> str:
    parts = PurePosixPath(path).parts
    if len(parts) >= 2 and parts[0] == "webgpu-os" and parts[1] == "factory":
        return "factory"
    if parts and parts[0] in {"engine", "editor", "plauna", "agi", "webgpu-os"}:
        return parts[0]
    return "shared"


def _boot_policy(path: str) -> tuple[str, bool]:
    if path in _BOOTSTRAP_TIER_EXACT:
        return "bootstrap", True
    if any(path.startswith(prefix) for prefix in _HOT_TIER_PREFIXES):
        return "hot", True
    return "lazy", False


def collect_staged_release(
    site_dir: Path | str,
    *,
    entry_source_path: str = DEFAULT_RUNTIME_ENTRY_SOURCE,
    entry_path: str = DEFAULT_RUNTIME_ENTRY_PATH,
) -> tuple[tuple[StagedReleaseFile, ...], tuple[dict[str, Any], ...]]:
    """Inventory a staged site while separating stable bootstrap authority."""
    site_dir = Path(site_dir).resolve()
    if not site_dir.is_dir():
        raise FileNotFoundError(f"Staged site does not exist: {site_dir}")
    entry_source_path = canonicalize(entry_source_path)
    entry_path = canonicalize(entry_path)
    if is_stable_bootstrap_path(entry_source_path):
        raise SystemReleaseBuildError(
            "The physical stable bootstrap entry cannot be packaged as a system release"
        )

    candidates: list[tuple[Path, str, str]] = []
    excluded: list[dict[str, Any]] = []
    entry_found = False
    for source in sorted(
        (path for path in site_dir.rglob("*") if path.is_file() or path.is_symlink()),
        key=lambda path: path.relative_to(site_dir).as_posix(),
    ):
        relative = source.relative_to(site_dir).as_posix()
        if source.is_symlink():
            raise SystemReleaseBuildError(f"Staged releases cannot contain symlinks: {relative}")
        canonicalize(relative)
        if any(component in FORBIDDEN_STAGED_COMPONENTS for component in PurePosixPath(relative).parts):
            raise SystemReleaseBuildError(
                f"Staged release contains a forbidden private/build component: {relative}"
            )
        if relative == entry_source_path:
            candidates.append((source, relative, entry_path))
            entry_found = True
            continue
        if is_stable_bootstrap_path(relative):
            excluded.append({
                "physicalPath": relative,
                "reason": "stable-bootstrap-owned",
            })
            continue
        candidates.append((source, relative, relative))
    if not entry_found:
        raise FileNotFoundError(
            f"Replaceable runtime entry is missing from staged site: {entry_source_path}"
        )
    if len(candidates) > MAX_RELEASE_FILES:
        raise SystemReleaseBuildError(
            f"System release contains {len(candidates)} files; limit is {MAX_RELEASE_FILES}"
        )
    assert_unique_logical_paths(logical for _, _, logical in candidates)

    total_bytes = 0
    files: list[StagedReleaseFile] = []
    for source, physical_relative, logical in candidates:
        length = source.stat().st_size
        total_bytes += length
        if total_bytes > MAX_RELEASE_BYTES:
            raise SystemReleaseBuildError("System release exceeds the 2 GiB package bound")
        boot_tier, hotset = _boot_policy(logical)
        files.append(StagedReleaseFile(
            physical_path=source,
            physical_relative_path=physical_relative,
            logical_path=logical,
            owner=_owner_for_path(logical),
            byte_length=length,
            object_hash=_sha256_path(source),
            mime=_mime_for_path(logical),
            boot_tier=boot_tier,
            hotset=hotset,
        ))
    files.sort(key=lambda record: record.logical_path.encode("utf-8"))
    if not any(record.logical_path == entry_path for record in files):
        raise SystemReleaseBuildError("System release inventory lost its runtime entry")
    return tuple(files), tuple(excluded)


def _previous_file_map(previous_manifest: Mapping[str, Any] | None) -> tuple[str | None, dict[str, Mapping[str, Any]]]:
    if previous_manifest is None:
        return None, {}
    if not isinstance(previous_manifest, Mapping) \
            or previous_manifest.get("schema") != SYSTEM_RELEASE_MANIFEST_SCHEMA \
            or previous_manifest.get("schemaVersion") != RELEASE_CONTRACT_VERSION:
        raise SystemReleaseBuildError("Previous release manifest has an unsupported schema")
    required_manifest_fields = {
        "schema", "schemaVersion", "releaseId", "sequence", "generatedAt",
        "entryPath", "files", "operations",
    }
    if set(previous_manifest) != required_manifest_fields:
        raise SystemReleaseBuildError("Previous release manifest has unknown or missing fields")
    release_id = previous_manifest.get("releaseId")
    if not isinstance(release_id, str) \
            or re.fullmatch(r"sha256:[0-9a-f]{64}", release_id) is None:
        raise SystemReleaseBuildError("Previous release manifest has an invalid releaseId")
    sequence = previous_manifest.get("sequence")
    if not isinstance(sequence, int) or isinstance(sequence, bool) \
            or not 1 <= sequence <= MAX_SAFE_INTEGER:
        raise SystemReleaseBuildError("Previous release manifest has an invalid sequence")
    if _canonical_timestamp(previous_manifest.get("generatedAt")) \
            != previous_manifest.get("generatedAt"):
        raise SystemReleaseBuildError("Previous release manifest timestamp is not canonical")
    entry_path = previous_manifest.get("entryPath")
    if not isinstance(entry_path, str) or canonicalize(entry_path) != entry_path:
        raise SystemReleaseBuildError("Previous release manifest entry path is invalid")
    records = previous_manifest.get("files")
    if not isinstance(records, list) or not records or len(records) > MAX_RELEASE_FILES:
        raise SystemReleaseBuildError("Previous release manifest files are outside bounds")
    paths = []
    mapping: dict[str, Mapping[str, Any]] = {}
    for record in records:
        if not isinstance(record, Mapping) or set(record) != {
            "path", "objectHash", "byteLength", "mime", "ownership", "bootTier", "hotset"
        }:
            raise SystemReleaseBuildError("Previous release manifest has a malformed file record")
        path = record.get("path")
        object_hash = record.get("objectHash")
        byte_length = record.get("byteLength")
        if not isinstance(path, str) or canonicalize(path) != path \
                or not isinstance(object_hash, str) \
                or re.fullmatch(r"sha256:[0-9a-f]{64}", object_hash) is None \
                or not isinstance(byte_length, int) or isinstance(byte_length, bool) \
                or not 0 <= byte_length <= MAX_RELEASE_BYTES \
                or not isinstance(record.get("mime"), str) or not record["mime"] \
                or len(record["mime"]) > 255 \
                or not isinstance(record.get("ownership"), str) \
                or re.fullmatch(r"[a-z][a-z0-9]*(?:[./_-][a-z0-9]+)*", record["ownership"]) is None \
                or record.get("bootTier") not in {"bootstrap", "hot", "lazy"} \
                or not isinstance(record.get("hotset"), bool):
            raise SystemReleaseBuildError("Previous release manifest has a malformed file record")
        paths.append(path)
        mapping[path] = record
    canonical_paths = assert_unique_logical_paths(paths)
    if entry_path not in mapping:
        raise SystemReleaseBuildError("Previous release manifest entry path is absent")
    operations = previous_manifest.get("operations")
    if not isinstance(operations, list) or len(operations) != len(records):
        raise SystemReleaseBuildError("Previous release manifest operations are invalid")
    operated: set[str] = set()
    for operation in operations:
        if not isinstance(operation, Mapping) or set(operation) != {"op", "path", "objectHash"} \
                or operation.get("op") != "put-object" \
                or operation.get("path") not in mapping \
                or operation.get("path") in operated \
                or operation.get("objectHash") != mapping[operation["path"]]["objectHash"]:
            raise SystemReleaseBuildError("Previous release manifest has an unsafe operation")
        operated.add(operation["path"])
    if operated != set(canonical_paths):
        raise SystemReleaseBuildError("Previous release manifest operations are incomplete")
    return release_id, mapping


def _calculated_activation_class(changed_paths: Sequence[str], floor: str) -> str:
    if floor not in ACTIVATION_CLASSES:
        raise SystemReleaseBuildError(f"Unknown activation floor: {floor!r}")
    if floor == "bootstrap-next-launch":
        raise SystemReleaseBuildError(
            "System releases cannot request bootstrap-next-launch authority"
        )
    calculated = "asset-live"
    for path in changed_paths:
        if any(path.startswith(prefix) for prefix in _RUNTIME_SHADOW_PREFIXES):
            calculated = "runtime-shadow"
            break
        if PurePosixPath(path).suffix.lower() not in _ASSET_LIVE_SUFFIXES:
            calculated = "runtime-warm"
    return ACTIVATION_CLASSES[max(
        ACTIVATION_CLASSES.index(calculated),
        ACTIVATION_CLASSES.index(floor),
    )]


def build_release_diff(
    files: Sequence[StagedReleaseFile],
    previous_manifest: Mapping[str, Any] | None,
    *,
    activation_floor: str,
) -> tuple[dict[str, Any], str]:
    previous_release_id, previous = _previous_file_map(previous_manifest)
    current = {record.logical_path: record.contract_record() for record in files}
    added = sorted(set(current).difference(previous))
    removed = sorted(set(previous).difference(current))
    changed = sorted(
        path for path in set(current).intersection(previous)
        if any(
            current[path].get(field) != previous[path].get(field)
            for field in (
                "objectHash", "byteLength", "mime", "ownership", "bootTier", "hotset"
            )
        )
    )
    reused = sorted(set(current).intersection(previous).difference(changed))
    activation_class = _calculated_activation_class(
        tuple(added) + tuple(changed) + tuple(removed), activation_floor
    )
    return {
        "schema": "particle.system-release-diff",
        "schemaVersion": 1,
        "previousReleaseId": previous_release_id,
        "activationFloor": activation_floor,
        "activationClass": activation_class,
        "added": added,
        "changed": changed,
        "removed": removed,
        "reused": reused,
        "counts": {
            "added": len(added),
            "changed": len(changed),
            "removed": len(removed),
            "reused": len(reused),
        },
    }, activation_class


def _release_identity(
    *,
    files: Sequence[StagedReleaseFile],
    channel: str,
    version: str,
    sequence: int,
    runtime_abi: str,
    bootstrap_minimum: str,
    bootstrap_maximum: str,
    activation_floor: str,
    activation_class: str,
    entry_path: str,
) -> str:
    material = {
        "schema": "particle.release-identity",
        "schemaVersion": 1,
        "channel": channel,
        "version": version,
        "sequence": sequence,
        "runtimeAbi": runtime_abi,
        "bootstrapAbi": {
            "minimum": bootstrap_minimum,
            "maximum": bootstrap_maximum,
        },
        "activationFloor": activation_floor,
        "activationClass": activation_class,
        "entryPath": entry_path,
        "files": [record.contract_record() for record in files],
    }
    return _sha256_uri(canonical_release_bytes(material))


class _JhcReleaseSigner:
    def __init__(self, key: ReleaseRoleKey):
        self.key = key
        self.public_key = key.public_raw

    def sign(self, payload: bytes) -> bytes:
        return _sign_raw_p256(self.key.private_key, payload)


def _segment_aad(
    segment_index: int,
    release_id: str,
    plaintext_length: int,
    aad_context: str,
) -> bytes:
    return canonical_release_bytes({
        "format": SEGMENTED_PACKAGE_FORMAT,
        "releaseId": release_id,
        "segmentIndex": segment_index,
        "plaintextLength": plaintext_length,
        "aadContext": aad_context,
    })


def _deterministic_segment_iv(
    key: bytes,
    release_id: str,
    segment_index: int,
    plaintext: bytes,
) -> bytes:
    # The release ID changes with the complete logical file map; the segment
    # digest changes with its signed JHC bytes.  HMAC makes the resulting 96-bit
    # nonce deterministic without exposing a predictable-key nonce namespace.
    material = (
        b"particle-system-release/aes-gcm-iv/v1\0"
        + release_id.encode("ascii")
        + segment_index.to_bytes(8, "big")
        + hashlib.sha256(plaintext).digest()
    )
    return hmac.new(key, material, hashlib.sha256).digest()[:12]


def seal_segmented_package(
    plaintext: bytes,
    *,
    key: bytes,
    release_id: str,
    segment_size: int = DEFAULT_SEGMENT_BYTES,
    piece_size: int = DEFAULT_PIECE_BYTES,
    aad_context: str = SEGMENTED_PACKAGE_FORMAT,
) -> tuple[bytes, dict[str, Any], dict[str, Any]]:
    if len(key) not in (16, 24, 32):
        raise SystemReleaseBuildError("System-release AES key must contain 16, 24, or 32 bytes")
    if not MIN_SEGMENT_BYTES <= segment_size <= MAX_SEGMENT_BYTES:
        raise SystemReleaseBuildError("System-release segment size is outside browser bounds")
    if not MIN_PIECE_BYTES <= piece_size <= MAX_PIECE_BYTES:
        raise SystemReleaseBuildError("Distribution piece size is outside browser bounds")
    if not plaintext or len(plaintext) > MAX_RELEASE_BYTES:
        raise SystemReleaseBuildError("System-release plaintext is outside browser bounds")

    aes = AESGCM(key)
    segments: list[dict[str, Any]] = []
    ciphertext_parts: list[bytes] = []
    ciphertext_offset = 0
    for index, offset in enumerate(range(0, len(plaintext), segment_size)):
        segment = plaintext[offset:offset + segment_size]
        iv = _deterministic_segment_iv(key, release_id, index, segment)
        ciphertext = aes.encrypt(
            iv,
            segment,
            _segment_aad(index, release_id, len(segment), aad_context),
        )
        segments.append({
            "index": index,
            "ciphertextOffset": ciphertext_offset,
            "ciphertextLength": len(ciphertext),
            "plaintextLength": len(segment),
            "iv": base64.b64encode(iv).decode("ascii"),
            "hash": _sha256_uri(ciphertext),
        })
        ciphertext_parts.append(ciphertext)
        ciphertext_offset += len(ciphertext)

    index = {
        "schema": SEGMENTED_PACKAGE_SCHEMA,
        "schemaVersion": SEGMENTED_PACKAGE_VERSION,
        "releaseId": release_id,
        "aadContext": aad_context,
        "plaintextLength": len(plaintext),
        "segmentSize": segment_size,
        "segments": segments,
    }
    index_bytes = canonical_release_bytes(index)
    header = struct.pack(
        "<8sHHI",
        SEGMENTED_PACKAGE_MAGIC,
        SEGMENTED_PACKAGE_VERSION,
        SEGMENTED_PACKAGE_FLAG_ENCRYPTED,
        len(index_bytes),
    )
    package = header + index_bytes + b"".join(ciphertext_parts)
    pieces = []
    for piece_index, offset in enumerate(range(0, len(package), piece_size)):
        piece = package[offset:offset + piece_size]
        pieces.append({
            "index": piece_index,
            "offset": offset,
            "byteLength": len(piece),
            "hash": _sha256_uri(piece),
        })
    package_descriptor = {
        "format": SEGMENTED_PACKAGE_FORMAT,
        "hash": _sha256_uri(package),
        "byteLength": len(package),
        "segmentSize": segment_size,
        "segmentCount": len(segments),
        "pieceSize": piece_size,
        "pieceCount": len(pieces),
        "pieceManifestHash": _sha256_uri(canonical_release_bytes(pieces)),
        "pieces": pieces,
    }
    return package, package_descriptor, index


def open_segmented_package(
    package: bytes,
    *,
    key: bytes,
    expected_package_hash: str | None = None,
) -> tuple[bytes, Mapping[str, Any]]:
    """Strict Python verification used by the release builder and its tests."""
    if len(package) < SEGMENTED_PACKAGE_HEADER_BYTES + 2:
        raise SystemReleaseBuildError("Segmented package header is truncated")
    magic, version, flags, index_length = struct.unpack_from("<8sHHI", package, 0)
    if magic != SEGMENTED_PACKAGE_MAGIC or version != SEGMENTED_PACKAGE_VERSION \
            or flags != SEGMENTED_PACKAGE_FLAG_ENCRYPTED:
        raise SystemReleaseBuildError("Segmented package header is unsupported")
    if index_length < 2 or SEGMENTED_PACKAGE_HEADER_BYTES + index_length >= len(package):
        raise SystemReleaseBuildError("Segmented package index length is invalid")
    index_bytes = package[
        SEGMENTED_PACKAGE_HEADER_BYTES:SEGMENTED_PACKAGE_HEADER_BYTES + index_length
    ]
    try:
        index = json.loads(index_bytes.decode("utf-8", errors="strict"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SystemReleaseBuildError("Segmented package index is malformed") from error
    if canonical_release_bytes(index) != index_bytes:
        raise SystemReleaseBuildError("Segmented package index is not canonical")
    if index.get("schema") != SEGMENTED_PACKAGE_SCHEMA \
            or index.get("schemaVersion") != SEGMENTED_PACKAGE_VERSION:
        raise SystemReleaseBuildError("Segmented package index schema is unsupported")
    actual_hash = _sha256_uri(package)
    if expected_package_hash is not None and actual_hash != expected_package_hash:
        raise SystemReleaseBuildError("Segmented package hash does not match its target")

    payload_offset = SEGMENTED_PACKAGE_HEADER_BYTES + index_length
    next_offset = 0
    plaintext_parts: list[bytes] = []
    aes = AESGCM(key)
    segments = index.get("segments")
    if not isinstance(segments, list) or not segments:
        raise SystemReleaseBuildError("Segmented package has no segments")
    for position, record in enumerate(segments):
        required = {
            "index", "ciphertextOffset", "ciphertextLength", "plaintextLength", "iv", "hash"
        }
        if not isinstance(record, dict) or set(record) != required \
                or record.get("index") != position \
                or record.get("ciphertextOffset") != next_offset:
            raise SystemReleaseBuildError("Segmented package segment map is invalid")
        length = record.get("ciphertextLength")
        plaintext_length = record.get("plaintextLength")
        if not isinstance(length, int) or not isinstance(plaintext_length, int) \
                or length != plaintext_length + 16:
            raise SystemReleaseBuildError("Segmented package segment length is invalid")
        start = payload_offset + next_offset
        ciphertext = package[start:start + length]
        if len(ciphertext) != length or _sha256_uri(ciphertext) != record.get("hash"):
            raise SystemReleaseBuildError("Segmented package ciphertext is corrupt")
        try:
            iv = base64.b64decode(record.get("iv"), validate=True)
        except Exception as error:
            raise SystemReleaseBuildError("Segmented package IV is malformed") from error
        if len(iv) != 12:
            raise SystemReleaseBuildError("Segmented package IV must contain 12 bytes")
        try:
            plaintext = aes.decrypt(
                iv,
                ciphertext,
                _segment_aad(
                    position,
                    index["releaseId"],
                    plaintext_length,
                    index["aadContext"],
                ),
            )
        except Exception as error:
            raise SystemReleaseBuildError("Segmented package AES-GCM authentication failed") from error
        if len(plaintext) != plaintext_length:
            raise SystemReleaseBuildError("Segmented package plaintext length is invalid")
        plaintext_parts.append(plaintext)
        next_offset += length
    if payload_offset + next_offset != len(package):
        raise SystemReleaseBuildError("Segmented package payload has trailing or missing bytes")
    plaintext = b"".join(plaintext_parts)
    if len(plaintext) != index.get("plaintextLength"):
        raise SystemReleaseBuildError("Segmented package total plaintext length is invalid")
    return plaintext, index


def _key_record(key: ReleaseRoleKey) -> dict[str, Any]:
    return {
        "keytype": "ecdsa",
        "scheme": "ecdsa-sha2-nistp256",
        "keyval": {"public": base64.b64encode(key.public_raw).decode("ascii")},
    }


def _root_signed(
    keyset: ReleaseKeySet,
    *,
    version: int,
    expires: str,
) -> dict[str, Any]:
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        raise SystemReleaseBuildError("TUF root version must be at least 1")
    expiry = _canonical_timestamp(expires)
    return {
        "_type": "root",
        "spec_version": TUF_SPEC_VERSION,
        "version": version,
        "expires": expiry,
        "consistent_snapshot": True,
        "keys": {
            key.keyid: _key_record(key)
            for role in TUF_ROLES
            for key in keyset.role(role)
        },
        "roles": {
            role: {
                "keyids": [key.keyid for key in keyset.role(role)],
                "threshold": keyset.threshold(role),
            }
            for role in TUF_ROLES
        },
    }


def _verify_raw_p256(
    public_raw: bytes,
    payload: bytes,
    signature_b64: str,
) -> bool:
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

    try:
        raw = base64.b64decode(signature_b64, validate=True)
        if len(raw) != 64:
            return False
        signature = encode_dss_signature(
            int.from_bytes(raw[:32], "big"),
            int.from_bytes(raw[32:], "big"),
        )
        public_key = ec.EllipticCurvePublicKey.from_encoded_point(
            ec.SECP256R1(), public_raw
        )
        public_key.verify(signature, payload, ec.ECDSA(hashes.SHA256()))
        return True
    except (ValueError, InvalidSignature):
        return False


def _validate_root_metadata(
    envelope: Mapping[str, Any],
    keyset: ReleaseKeySet,
) -> None:
    if not isinstance(envelope, Mapping) or set(envelope) != {"signed", "signatures"}:
        raise SystemReleaseBuildError("Release root metadata envelope is malformed")
    signed = envelope["signed"]
    signatures = envelope["signatures"]
    if not isinstance(signed, Mapping) or not isinstance(signatures, list):
        raise SystemReleaseBuildError("Release root metadata fields are malformed")
    required = {
        "_type", "spec_version", "version", "expires", "consistent_snapshot", "keys", "roles"
    }
    if set(signed) != required or signed.get("_type") != "root" \
            or signed.get("spec_version") != TUF_SPEC_VERSION \
            or signed.get("consistent_snapshot") is not True:
        raise SystemReleaseBuildError("Release root signed contract is malformed")
    if not isinstance(signed.get("version"), int) or signed["version"] < 1:
        raise SystemReleaseBuildError("Release root version is invalid")
    if _canonical_timestamp(signed.get("expires")) != signed.get("expires"):
        raise SystemReleaseBuildError("Release root expiry is not canonical")
    expected = _root_signed(
        keyset,
        version=signed["version"],
        expires=signed["expires"],
    )
    if dict(signed) != expected:
        raise SystemReleaseBuildError("Release root metadata does not match its keyset")
    payload = canonical_release_bytes(signed)
    allowed = {key.keyid: key for key in keyset.role("root")}
    valid: set[str] = set()
    seen_signature_ids: set[str] = set()
    for signature in signatures:
        if not isinstance(signature, Mapping) or set(signature) != {"keyid", "sig"} \
                or not isinstance(signature.get("keyid"), str) \
                or not isinstance(signature.get("sig"), str):
            raise SystemReleaseBuildError("Release root signature record is malformed")
        keyid = signature["keyid"]
        if keyid in seen_signature_ids:
            raise SystemReleaseBuildError("Release root repeats a signer")
        seen_signature_ids.add(keyid)
        key = allowed.get(keyid)
        if key is not None and _verify_raw_p256(key.public_raw, payload, signature["sig"]):
            valid.add(keyid)
    if len(valid) < keyset.threshold("root"):
        raise SystemReleaseBuildError("Release root does not meet its new-root signature threshold")


def _validate_root_rotation_signatures(
    envelope: Mapping[str, Any],
    previous_keyset: ReleaseKeySet,
) -> None:
    """Require a sequential root to meet the previous root's threshold too."""
    if previous_keyset.root_metadata is None:
        raise SystemReleaseBuildError("Previous release keyset has no trusted root metadata")
    _validate_root_metadata(previous_keyset.root_metadata, previous_keyset)
    payload = canonical_release_bytes(envelope["signed"])
    allowed = {key.keyid: key for key in previous_keyset.role("root")}
    valid: set[str] = set()
    for signature in envelope["signatures"]:
        key = allowed.get(signature["keyid"])
        if key is not None and _verify_raw_p256(
            key.public_raw,
            payload,
            signature["sig"],
        ):
            valid.add(key.keyid)
    if len(valid) < previous_keyset.threshold("root"):
        raise SystemReleaseBuildError(
            "Release root rotation does not meet its previous-root signature threshold"
        )


def _sign_tuf_envelope(
    signed: Mapping[str, Any],
    signers: Iterable[ReleaseRoleKey],
) -> tuple[dict[str, Any], bytes]:
    signed_bytes = canonical_release_bytes(signed)
    signatures = []
    seen: set[str] = set()
    for key in sorted(signers, key=lambda entry: entry.keyid):
        if key.keyid in seen:
            continue
        seen.add(key.keyid)
        signatures.append({
            "keyid": key.keyid,
            "sig": base64.b64encode(
                _sign_raw_p256(key.private_key, signed_bytes)
            ).decode("ascii"),
        })
    envelope = {"signed": dict(signed), "signatures": signatures}
    return envelope, canonical_release_bytes(envelope)


def build_tuf_metadata(
    descriptor: Mapping[str, Any],
    *,
    keyset: ReleaseKeySet,
    published_at: str,
    metadata_version: int | None = None,
) -> dict[str, tuple[dict[str, Any], bytes]]:
    """Build the four canonical TUF-style envelopes expected by the browser."""
    metadata_version = int(metadata_version or descriptor["sequence"])
    if metadata_version < 1:
        raise SystemReleaseBuildError("TUF metadata version must be at least 1")

    if keyset.root_metadata is None or not keyset.root_metadata_bytes:
        raise SystemReleaseBuildError("Release keyset has no persisted root metadata")
    _validate_root_metadata(keyset.root_metadata, keyset)
    root = (dict(keyset.root_metadata), bytes(keyset.root_metadata_bytes))

    target_path = descriptor["targetPath"]
    targets_signed = {
        "_type": "targets",
        "spec_version": TUF_SPEC_VERSION,
        "version": metadata_version,
        "expires": _future_timestamp(published_at, _datetime.timedelta(days=30)),
        "targets": {
            target_path: {
                "length": descriptor["package"]["byteLength"],
                "hashes": {"sha256": descriptor["package"]["hash"][7:]},
                "custom": {"releaseDescriptor": dict(descriptor)},
            },
        },
    }
    targets = _sign_tuf_envelope(targets_signed, keyset.role("targets"))
    snapshot_signed = {
        "_type": "snapshot",
        "spec_version": TUF_SPEC_VERSION,
        "version": metadata_version,
        "expires": _future_timestamp(published_at, _datetime.timedelta(days=7)),
        "meta": {
            "targets.json": {
                "version": metadata_version,
                "length": len(targets[1]),
                "hashes": {"sha256": _sha256_hex(targets[1])},
            },
        },
    }
    snapshot = _sign_tuf_envelope(snapshot_signed, keyset.role("snapshot"))
    timestamp_signed = {
        "_type": "timestamp",
        "spec_version": TUF_SPEC_VERSION,
        "version": metadata_version,
        "expires": _future_timestamp(published_at, _datetime.timedelta(days=1)),
        "meta": {
            "snapshot.json": {
                "version": metadata_version,
                "length": len(snapshot[1]),
                "hashes": {"sha256": _sha256_hex(snapshot[1])},
            },
        },
    }
    timestamp = _sign_tuf_envelope(timestamp_signed, keyset.role("timestamp"))
    return {
        "root": root,
        "timestamp": timestamp,
        "snapshot": snapshot,
        "targets": targets,
    }


def _validate_release_inputs(
    *,
    channel: str,
    version: str,
    sequence: int,
    runtime_abi: str,
    bootstrap_minimum: str,
    bootstrap_maximum: str,
) -> None:
    if not isinstance(channel, str) or len(channel) > 64 \
            or not re.fullmatch(r"[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*", channel):
        raise SystemReleaseBuildError("Release channel is invalid")
    if not isinstance(version, str) or len(version) > 96 \
            or not re.fullmatch(r"[A-Za-z0-9]+(?:[._+~-][A-Za-z0-9]+)*", version):
        raise SystemReleaseBuildError("Release version is invalid")
    if not isinstance(sequence, int) or isinstance(sequence, bool) \
            or not 1 <= sequence <= MAX_SAFE_INTEGER:
        raise SystemReleaseBuildError("Release sequence must be a positive integer")
    for name, value in (
        ("runtime ABI", runtime_abi),
        ("bootstrap minimum ABI", bootstrap_minimum),
        ("bootstrap maximum ABI", bootstrap_maximum),
    ):
        if not isinstance(value, str) or len(value) > 64 \
                or not re.fullmatch(r"[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*", value):
            raise SystemReleaseBuildError(f"{name} is invalid")


def _tree_bytes(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in root.rglob("*")
        if path.is_file()
    }


def build_system_release(
    site_dir: Path | str,
    output_root: Path | str,
    *,
    keyset: ReleaseKeySet,
    aes_key: bytes,
    channel: str,
    version: str,
    sequence: int,
    published_at: str | _datetime.datetime | None,
    runtime_abi: str,
    bootstrap_minimum: str,
    bootstrap_maximum: str,
    activation_floor: str = "asset-live",
    entry_source_path: str = DEFAULT_RUNTIME_ENTRY_SOURCE,
    entry_path: str = DEFAULT_RUNTIME_ENTRY_PATH,
    previous_manifest: Mapping[str, Any] | None = None,
    required_features: Sequence[str] = (),
    minimum_storage_bytes: int | None = None,
    segment_size: int = DEFAULT_SEGMENT_BYTES,
    piece_size: int = DEFAULT_PIECE_BYTES,
    metadata_version: int | None = None,
) -> SystemReleaseBuildResult:
    """Build and verify one complete immutable system-release artifact set."""
    _validate_release_inputs(
        channel=channel,
        version=version,
        sequence=sequence,
        runtime_abi=runtime_abi,
        bootstrap_minimum=bootstrap_minimum,
        bootstrap_maximum=bootstrap_maximum,
    )
    published = _canonical_timestamp(published_at) if published_at is not None else source_date_timestamp()
    entry_path = canonicalize(entry_path)
    feature_inputs = tuple(required_features)
    if any(not isinstance(feature, str) for feature in feature_inputs):
        raise SystemReleaseBuildError(
            "Release feature requirements must be unique bounded ABI tokens"
        )
    features = sorted(set(feature_inputs))
    if len(features) > 128 or len(features) != len(feature_inputs) or any(
        len(feature) > 96
        or re.fullmatch(r"[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*", feature) is None
        for feature in features
    ):
        raise SystemReleaseBuildError(
            "Release feature requirements must be unique bounded ABI tokens"
        )

    files, excluded = collect_staged_release(
        site_dir,
        entry_source_path=entry_source_path,
        entry_path=entry_path,
    )
    release_diff, activation_class = build_release_diff(
        files,
        previous_manifest,
        activation_floor=activation_floor,
    )
    release_id = _release_identity(
        files=files,
        channel=channel,
        version=version,
        sequence=sequence,
        runtime_abi=runtime_abi,
        bootstrap_minimum=bootstrap_minimum,
        bootstrap_maximum=bootstrap_maximum,
        activation_floor=activation_floor,
        activation_class=activation_class,
        entry_path=entry_path,
    )
    manifest = {
        "schema": SYSTEM_RELEASE_MANIFEST_SCHEMA,
        "schemaVersion": RELEASE_CONTRACT_VERSION,
        "releaseId": release_id,
        "sequence": sequence,
        "generatedAt": published,
        "entryPath": entry_path,
        "files": [record.contract_record() for record in files],
        "operations": [
            {
                "op": "put-object",
                "path": record.logical_path,
                "objectHash": record.object_hash,
            }
            for record in files
        ],
    }
    manifest_bytes = canonical_release_bytes(manifest)
    manifest_hash = _sha256_uri(manifest_bytes)

    resources = {}
    for record in files:
        payload = record.physical_path.read_bytes()
        if len(payload) != record.byte_length or _sha256_uri(payload) != record.object_hash:
            raise SystemReleaseBuildError(
                f"Staged file changed during release inventory: {record.physical_relative_path}"
            )
        resources[record.logical_path] = payload
    target_signing_key = keyset.role("targets")[0]
    jhc_manifest = {
        "applicationId": "particle.webgpu-os.system-release",
        "applicationVersion": version,
        "entry": entry_path,
        "requiredFeatures": 0,
        "publisherFingerprint": _sha256_hex(target_signing_key.public_raw)[:16],
        "pubKey": base64.b64encode(target_signing_key.public_raw).decode("ascii"),
        "systemReleaseManifest": manifest,
        "systemReleaseManifestHash": manifest_hash,
        "resourceMime": {
            record.logical_path: record.mime for record in files
        },
    }
    plaintext_jhc = JhcPackage.pack(
        jhc_manifest,
        resources,
        signer=_JhcReleaseSigner(target_signing_key),
    )
    parsed = JhcPackage.parse_authenticated(plaintext_jhc, target_signing_key.public_raw)
    if parsed["manifest"].get("systemReleaseManifestHash") != manifest_hash \
            or parsed["resources"] != resources:
        raise SystemReleaseBuildError("Signed JHC release failed its read-back verification")

    package, package_descriptor, package_index = seal_segmented_package(
        plaintext_jhc,
        key=aes_key,
        release_id=release_id,
        segment_size=segment_size,
        piece_size=piece_size,
    )
    opened, opened_index = open_segmented_package(
        package,
        key=aes_key,
        expected_package_hash=package_descriptor["hash"],
    )
    if opened != plaintext_jhc or opened_index != package_index:
        raise SystemReleaseBuildError("Encrypted system package failed its read-back verification")

    package_hex = package_descriptor["hash"][7:]
    release_hex = release_id[7:]
    target_path = (
        f"releases/{channel}/{sequence}-{release_hex[:24]}-{package_hex[:24]}.prpkg"
    )
    calculated_storage = package_descriptor["byteLength"] + sum(
        record.byte_length for record in files
    )
    if minimum_storage_bytes is not None and (
        not isinstance(minimum_storage_bytes, int)
        or isinstance(minimum_storage_bytes, bool)
    ):
        raise SystemReleaseBuildError("Minimum storage requirement must be an integer")
    storage_requirement = calculated_storage if minimum_storage_bytes is None else minimum_storage_bytes
    if not 0 <= storage_requirement <= MAX_SAFE_INTEGER:
        raise SystemReleaseBuildError("Minimum storage requirement is outside browser bounds")
    descriptor = {
        "schema": RELEASE_DESCRIPTOR_SCHEMA,
        "schemaVersion": RELEASE_CONTRACT_VERSION,
        "releaseId": release_id,
        "channel": channel,
        "version": version,
        "sequence": sequence,
        "publishedAt": published,
        "runtimeAbi": runtime_abi,
        "bootstrapAbi": {
            "minimum": bootstrap_minimum,
            "maximum": bootstrap_maximum,
        },
        "activationFloor": activation_floor,
        "activationClass": activation_class,
        "targetPath": target_path,
        "manifestHash": manifest_hash,
        "package": package_descriptor,
        "requirements": {
            "features": features,
            "minimumStorageBytes": storage_requirement,
        },
    }
    metadata = build_tuf_metadata(
        descriptor,
        keyset=keyset,
        published_at=published,
        metadata_version=metadata_version,
    )

    release_diff = dict(release_diff)
    release_diff["releaseId"] = release_id
    hotset = {
        "schema": "particle.system-release-hotset",
        "schemaVersion": 1,
        "releaseId": release_id,
        "files": [
            record.contract_record() for record in files if record.hotset
        ],
    }
    piece_manifest = {
        "schema": "particle.system-release-piece-manifest",
        "schemaVersion": 1,
        "releaseId": release_id,
        "packageHash": package_descriptor["hash"],
        "packageByteLength": package_descriptor["byteLength"],
        "pieceSize": package_descriptor["pieceSize"],
        "pieceManifestHash": package_descriptor["pieceManifestHash"],
        "pieces": package_descriptor["pieces"],
    }
    inventory = {
        "schema": "particle.staged-site-inventory",
        "schemaVersion": 1,
        "releaseId": release_id,
        "siteRoot": ".",
        "entrySourcePath": canonicalize(entry_source_path),
        "entryPath": entry_path,
        "included": [
            {
                "physicalPath": record.physical_relative_path,
                "logicalPath": record.logical_path,
                "owner": record.owner,
                "objectHash": record.object_hash,
                "byteLength": record.byte_length,
            }
            for record in files
        ],
        "excluded": list(excluded),
    }

    outputs: dict[str, bytes] = {
        "release-descriptor.json": canonical_release_bytes(descriptor),
        "system-release-manifest.json": manifest_bytes,
        "system-release.jhc": plaintext_jhc,
        "ciphertext-piece-manifest.json": canonical_release_bytes(piece_manifest),
        "hotset.json": canonical_release_bytes(hotset),
        "release-diff.json": canonical_release_bytes(release_diff),
        "staged-site-inventory.json": canonical_release_bytes(inventory),
        target_path: package,
    }
    for role, (_, payload) in metadata.items():
        outputs[f"metadata/{role}.json"] = payload

    receipt_artifacts = {
        path: {"byteLength": len(payload), "hash": _sha256_uri(payload)}
        for path, payload in sorted(outputs.items())
    }
    receipt = {
        "schema": "particle.system-release-build-receipt",
        "schemaVersion": 1,
        "releaseId": release_id,
        "sequence": sequence,
        "packageHash": package_descriptor["hash"],
        "targetPath": target_path,
        "fileCount": len(files),
        "excludedBootstrapFileCount": len(excluded),
        "activationFloor": activation_floor,
        "activationClass": activation_class,
        "deterministic": True,
        "artifacts": receipt_artifacts,
    }
    outputs["build-receipt.json"] = canonical_release_bytes(receipt)

    output_root = Path(output_root).resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    build_name = f"{sequence}-{release_hex[:16]}-{package_hex[:16]}"
    final_dir = output_root / build_name
    staging_dir = Path(tempfile.mkdtemp(prefix=f".{build_name}.", dir=output_root))
    try:
        for relative, payload in sorted(outputs.items()):
            destination = staging_dir / PurePosixPath(relative)
            _atomic_write_bytes(destination, payload)
        written = _tree_bytes(staging_dir)
        if written != outputs:
            raise SystemReleaseBuildError("Staged system-release artifacts failed byte verification")
        if final_dir.exists():
            if _tree_bytes(final_dir) != outputs:
                raise FileExistsError(
                    f"Immutable release output already exists with different bytes: {final_dir}"
                )
            shutil.rmtree(staging_dir)
        else:
            os.replace(staging_dir, final_dir)
    finally:
        if staging_dir.exists():
            shutil.rmtree(staging_dir)

    return SystemReleaseBuildResult(
        output_dir=final_dir,
        release_id=release_id,
        descriptor=descriptor,
        manifest=manifest,
        receipt=receipt,
    )


__all__ = [
    "ACTIVATION_CLASSES",
    "DEFAULT_PIECE_BYTES",
    "DEFAULT_RUNTIME_ENTRY_PATH",
    "DEFAULT_RUNTIME_ENTRY_SOURCE",
    "DEFAULT_SEGMENT_BYTES",
    "ReleaseKeySet",
    "ReleaseRoleKey",
    "StagedReleaseFile",
    "SystemReleaseBuildError",
    "SystemReleaseBuildResult",
    "assert_unique_logical_paths",
    "build_release_diff",
    "build_system_release",
    "build_tuf_metadata",
    "canonical_release_bytes",
    "canonical_release_json",
    "collect_staged_release",
    "generate_release_keyset",
    "is_stable_bootstrap_path",
    "load_release_keyset",
    "open_segmented_package",
    "seal_segmented_package",
    "source_date_timestamp",
]
