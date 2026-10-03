# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""JhcPackage — Python implementation of the JHC1 raw package container."""

from __future__ import annotations

import json
import hashlib
import math
import struct
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

from .path import canonicalize, validate_many, validate_id, validate_version
from .codec import TokenCodec


# Registry section type IDs
SECTION_TYPES = {
    "MANIFEST": 0,
    "RAW_RESOURCE": 1,
    "SOURCE_MAP": 2,
    "LICENSE": 3,
    "SIGNATURE": 4,
}

SECTION_TYPE_NAMES = {v: k for k, v in SECTION_TYPES.items()}


class JhcPackageError(Exception):
    """Raised when a JHC1 package is malformed or violates a policy rule."""

    def __init__(self, code: int, message: str, diagnostic: str = ""):
        super().__init__(message)
        self.code = code
        self.message = message
        self.diagnostic = diagnostic


class _DiagCodes:
    """Diagnostic codes for package errors."""

    INVALID_PATH = 100
    INVALID_ID = 101
    INVALID_VERSION = 102
    DUPLICATE_PATH = 103
    PATH_TOO_LONG = 104
    ABSOLUTE_PATH = 105
    TRAVERSAL = 106
    NULL_BYTE = 107
    INVALID_UTF8 = 108
    DRIVE_LETTER = 109
    BACKSLASH = 110
    EMPTY_SEGMENT = 111
    RESERVED_CHAR = 112
    INVALID_PERCENT = 113
    TOO_MANY_FILES = 114
    FILE_TOO_LARGE = 115
    PACKAGE_TOO_LARGE = 116
    MANIFEST_TOO_LARGE = 117
    TOO_MANY_SECTIONS = 118
    DECODE_BUDGET = 119
    LENGTH_MISMATCH = 120
    OVERLAPPING_SECTION = 121
    UNSUPPORTED_CODEC = 122
    BAD_RESOURCE_MAP = 123
    SIGNATURE_REQUIRED = 124
    DICTIONARY_MISMATCH = 125
    LICENSE_MISMATCH = 126
    BAD_MAGIC = 200
    BAD_HEADER = 201
    BAD_DIRECTORY = 202
    BAD_SECTION = 203
    HASH_MISMATCH = 204
    BAD_SIGNATURE = 205
    TRUST_FAILED = 206


class JhcPackage:
    """Pack, parse, verify, and inspect JHC1 packages."""

    MAGIC = b"JHC1"
    MAJOR = 1
    MINOR = 0
    HEADER_LEN = 48
    DIR_ENTRY_LEN = 72
    MAX_FILES = 10_000
    MAX_FILE_BYTES = 50 * 1024 * 1024
    MAX_PACKAGE_BYTES = 1 * 1024 * 1024 * 1024
    MAX_MANIFEST_BYTES = 4 * 1024 * 1024
    MAX_LICENSE_BYTES = 4 * 1024 * 1024
    MAX_SIGNATURE_BYTES = 16 * 1024
    MAX_TOTAL_DECODED_BYTES = 256 * 1024 * 1024
    MAX_EXPANSION_RATIO = 256
    MAX_EXPANSION_SLACK = 1024 * 1024

    @staticmethod
    def _canonical_json(obj: Any) -> str:
        """Serialize the JHC canonical JSON profile byte-identically to JS.

        The profile follows ECMAScript JSON number formatting, orders object
        keys by UTF-16 code units (the ordering used by JavaScript ``sort``),
        and emits non-ASCII text as UTF-16 ``\\u`` escapes.  Rejecting integers
        outside JavaScript's safe range prevents silent Python/JS divergence.
        """

        def utf16_key(value: str) -> bytes:
            return value.encode("utf-16-be", "surrogatepass")

        def number(value: Union[int, float]) -> str:
            if isinstance(value, int):
                if abs(value) > 9_007_199_254_740_991:
                    as_float = float(value)
                    if not math.isfinite(as_float) or int(as_float) != value:
                        raise ValueError("Canonical JSON integer is not exactly representable in JavaScript")
                    return number(as_float)
                return str(value)
            if not math.isfinite(value):
                raise ValueError("Canonical JSON does not allow non-finite numbers")
            if value == 0:
                return "0"

            # Python and modern JavaScript both use shortest-round-trip decimal
            # conversion.  Normalize only their presentation thresholds and
            # exponent spelling (ECMAScript uses fixed form for [1e-6, 1e21)).
            shortest = repr(value).lower()
            magnitude = abs(value)
            if 1e-6 <= magnitude < 1e21:
                fixed = format(Decimal(shortest), "f")
                if "." in fixed:
                    fixed = fixed.rstrip("0").rstrip(".")
                return fixed

            if "e" not in shortest:
                shortest = format(value, ".17e")
            mantissa, exponent = shortest.split("e", 1)
            mantissa = mantissa.rstrip("0").rstrip(".")
            exponent_value = int(exponent)
            sign = "+" if exponent_value >= 0 else "-"
            return f"{mantissa}e{sign}{abs(exponent_value)}"

        def encode(value: Any) -> str:
            if value is None:
                return "null"
            if value is True:
                return "true"
            if value is False:
                return "false"
            if isinstance(value, (int, float)):
                return number(value)
            if isinstance(value, str):
                return json.dumps(value, ensure_ascii=True, separators=(",", ":"))
            if isinstance(value, (list, tuple)):
                return "[" + ",".join(encode(item) for item in value) + "]"
            if isinstance(value, dict):
                if not all(isinstance(key, str) for key in value):
                    raise TypeError("Canonical JSON object keys must be strings")
                keys = sorted(value, key=utf16_key)
                return "{" + ",".join(
                    f"{json.dumps(key, ensure_ascii=True)}:{encode(value[key])}"
                    for key in keys
                ) + "}"
            raise TypeError(f"Unsupported canonical JSON value: {type(value).__name__}")

        return encode(obj)

    @staticmethod
    def _sha256(data: bytes) -> bytes:
        return hashlib.sha256(data).digest()

    @staticmethod
    def _encode_u32le(n: int) -> bytes:
        return struct.pack("<I", n)

    @staticmethod
    def _encode_u64le(n: int) -> bytes:
        return struct.pack("<Q", n)

    @staticmethod
    def _decode_u32le(data: bytes, offset: int) -> int:
        return struct.unpack_from("<I", data, offset)[0]

    @staticmethod
    def _decode_u16le(data: bytes, offset: int) -> int:
        return struct.unpack_from("<H", data, offset)[0]

    @staticmethod
    def _decode_u64le(data: bytes, offset: int) -> int:
        return struct.unpack_from("<Q", data, offset)[0]

    @staticmethod
    def _validate_resources(resources: Dict[str, bytes]) -> List[Tuple[str, bytes]]:
        """Validate and sort resources by canonical UTF-8 path."""
        if len(resources) > JhcPackage.MAX_FILES:
            raise JhcPackageError(_DiagCodes.TOO_MANY_FILES, "Too many resource files")
        path_report = validate_many(list(resources.keys()))
        if not path_report["ok"]:
            err = path_report["errors"][0]
            raise JhcPackageError(
                _DiagCodes.INVALID_PATH,
                f"Invalid resource path {err['path']}: {err['message']}",
            )
        seen: set = set()
        for path in resources:
            canon = canonicalize(path)
            if canon in seen:
                raise JhcPackageError(
                    _DiagCodes.DUPLICATE_PATH,
                    f"Duplicate normalized path: {path}",
                )
            seen.add(canon)
        # Sort by the normalized UTF-8 path bytes
        ordered = sorted(resources.items(), key=lambda kv: canonicalize(kv[0]).encode("utf-8"))
        for path, content in ordered:
            if len(content) > JhcPackage.MAX_FILE_BYTES:
                raise JhcPackageError(
                    _DiagCodes.FILE_TOO_LARGE,
                    f"Resource too large: {path}",
                )
        return ordered

    @staticmethod
    def _build_manifest(
        manifest: Dict[str, Any],
        resources: List[Tuple[str, bytes]],
    ) -> str:
        """Validate the manifest and attach resource records."""
        if not manifest.get("applicationId"):
            raise JhcPackageError(_DiagCodes.INVALID_ID, "applicationId is required")
        if not manifest.get("applicationVersion"):
            raise JhcPackageError(_DiagCodes.INVALID_VERSION, "applicationVersion is required")
        validate_id(manifest["applicationId"])
        validate_version(manifest["applicationVersion"])

        resource_records = []
        for idx, (path, content) in enumerate(resources):
            resource_records.append({
                "path": canonicalize(path),
                "mime": manifest.get("resourceMime", {}).get(path, "application/octet-stream"),
                "id": idx,
                "hash": JhcPackage._sha256(content).hex(),
                "representation": "raw",
                "decodedLength": len(content),
            })
        canonical_manifest = dict(manifest)
        canonical_manifest["resources"] = resource_records
        canonical_manifest["format"] = "jhc-1.0"
        canonical_manifest["container"] = "jhc-1.0"
        # Ensure signature is never embedded in the canonical manifest
        canonical_manifest.pop("signature", None)
        # License bytes live in their dedicated hashed section. The signed
        # manifest carries legal.licenseTextSha256, not a duplicate plaintext.
        canonical_manifest.pop("licenseText", None)
        return JhcPackage._canonical_json(canonical_manifest)

    @staticmethod
    def _compute_root_hash(manifest_bytes: bytes, directory: List[Dict[str, Any]]) -> bytes:
        # Bind the manifest and non-signature section metadata. The signature
        # section itself is excluded to avoid a circular dependency: the signature
        # is computed over the root hash, so the root hash cannot depend on the
        # signature bytes.
        entries = [e for e in directory if e["sectionType"] != SECTION_TYPES["SIGNATURE"]]
        h = hashlib.sha256()
        h.update(manifest_bytes)
        h.update(JhcPackage._encode_u32le(len(entries)))
        for entry in entries:
            h.update(JhcPackage._encode_u32le(entry["sectionType"]))
            h.update(JhcPackage._encode_u32le(entry["logicalId"]))
            h.update(entry["decodedSha256"])
        return h.digest()

    @staticmethod
    def _signature_payload(root_hash: bytes, manifest: Dict[str, Any]) -> bytes:
        major = JhcPackage.MAJOR.to_bytes(1, "little")
        minor = JhcPackage.MINOR.to_bytes(1, "little")
        app_id = manifest.get("applicationId", "").encode("utf-8")
        app_version = manifest.get("applicationVersion", "").encode("utf-8")
        features = int(manifest.get("requiredFeatures", 0)) & 0xFFFFFFFF
        # This is the exact message passed to ECDSA-SHA256 in both Python and
        # WebCrypto. Do not pre-hash here: WebCrypto hashes its message as part
        # of ECDSA and Python must follow the same wire contract.
        return major + minor + root_hash + app_id + app_version + features.to_bytes(4, "little")

    @staticmethod
    def _resource_language(path: str) -> str:
        if path.endswith(".html") or path.endswith(".htm"):
            return "html"
        if path.endswith(".css"):
            return "css"
        if path.endswith(".json"):
            return "json"
        return "js"

    @staticmethod
    def _decode_section(section: bytes, entry: Dict[str, Any], manifest: Dict[str, Any]) -> bytes:
        codec = entry.get("codec", 0)
        if codec == 0:
            return section
        if codec == 1:
            if entry["sectionType"] != SECTION_TYPES["RAW_RESOURCE"]:
                return section
            record = manifest.get("resources", [])[entry["logicalId"]]
            lang = JhcPackage._resource_language(record["path"])
            return TokenCodec.decode(section, lang).encode("utf-8")
        raise JhcPackageError(_DiagCodes.BAD_SECTION, f"Unsupported codec {codec}")

    @staticmethod
    def pack(
        manifest: Dict[str, Any],
        resources: Dict[str, bytes],
        signer: Optional[Any] = None,
        coder: Optional[Any] = None,
    ) -> bytes:
        """Pack a manifest and resources into a JHC1 container.

        Args:
            manifest: Canonical manifest object (applicationId, applicationVersion, entry, ...).
            resources: Mapping of logical path to decoded bytes.
            signer: Optional object with ``sign(digest: bytes) -> bytes`` and a
                ``public_key`` or ``publicKey`` attribute/PEM string. If provided,
                a detached SIGNATURE section is appended.
            coder: Optional callable ``coder(path, content) -> {codec, decoded, encoded}``.
                If it returns a smaller encoded representation, it is used for the section.

        Returns:
            The JHC1 container bytes.
        """
        ordered_resources = JhcPackage._validate_resources(resources)
        manifest_json = JhcPackage._build_manifest(manifest, ordered_resources)
        manifest_bytes = manifest_json.encode("utf-8")

        # Build directory entries: manifest first, then resources, then optional signature
        directory: List[Dict[str, Any]] = []
        sections: List[bytes] = []

        directory.append({
            "sectionType": SECTION_TYPES["MANIFEST"],
            "sectionFlags": 0,
            "logicalId": 0,
            "codec": 0,
            "storedOffset": 0,  # filled later
            "storedLength": len(manifest_bytes),
            "decodedLength": len(manifest_bytes),
            "decodedSha256": JhcPackage._sha256(manifest_bytes),
        })
        sections.append(manifest_bytes)

        for idx, (path, content) in enumerate(ordered_resources):
            codec = 0
            decoded = content
            encoded = content
            if coder:
                result = coder(path, content)
                if result:
                    candidate_codec = int(result.get("codec", 0))
                    candidate_decoded = bytes(result.get("decoded", content))
                    candidate_encoded = bytes(result.get("encoded", content))
                    if candidate_decoded != content:
                        raise JhcPackageError(
                            _DiagCodes.BAD_SECTION,
                            f"Coder changed decoded resource bytes for {path}",
                        )
                    if candidate_codec not in (0, 1):
                        raise JhcPackageError(
                            _DiagCodes.BAD_SECTION,
                            f"Unsupported resource codec {candidate_codec} for {path}",
                        )
                    if candidate_codec == 0 and candidate_encoded != content:
                        raise JhcPackageError(
                            _DiagCodes.BAD_SECTION,
                            f"Raw coder changed stored resource bytes for {path}",
                        )
                    # A codec is an internal storage optimization, never a reason
                    # to make a package larger. Equal or expanded output falls
                    # back to the canonical raw representation.
                    if candidate_codec != 0 and len(candidate_encoded) < len(content):
                        codec = candidate_codec
                        decoded = candidate_decoded
                        encoded = candidate_encoded
            directory.append({
                "sectionType": SECTION_TYPES["RAW_RESOURCE"],
                "sectionFlags": 0,
                "logicalId": idx,
                "codec": codec,
                "storedOffset": 0,
                "storedLength": len(encoded),
                "decodedLength": len(decoded),
                "decodedSha256": JhcPackage._sha256(decoded),
            })
            sections.append(encoded)

        # Include optional license section if provided
        license_text = manifest.get("licenseText", "")
        if license_text:
            license_bytes = license_text.encode("utf-8")
            directory.append({
                "sectionType": SECTION_TYPES["LICENSE"],
                "sectionFlags": 0,
                "logicalId": 0,
                "codec": 0,
                "storedOffset": 0,
                "storedLength": len(license_bytes),
                "decodedLength": len(license_bytes),
                "decodedSha256": JhcPackage._sha256(license_bytes),
            })
            sections.append(license_bytes)

        # Sort directory by section type, then logical ID
        directory.sort(key=lambda e: (e["sectionType"], e["logicalId"]))

        # Compute root hash and sign
        root_hash = JhcPackage._compute_root_hash(manifest_bytes, directory)
        signature: Optional[bytes] = None
        if signer is not None:
            payload = JhcPackage._signature_payload(root_hash, manifest)
            signature = signer.sign(payload)
            if signature:
                directory.append({
                    "sectionType": SECTION_TYPES["SIGNATURE"],
                    "sectionFlags": 0,
                    "logicalId": 0,
                    "codec": 0,
                    "storedOffset": 0,
                    "storedLength": len(signature),
                    "decodedLength": len(signature),
                    "decodedSha256": JhcPackage._sha256(signature),
                })
                sections.append(signature)

        # Re-sort directory after adding signature
        directory.sort(key=lambda e: (e["sectionType"], e["logicalId"]))

        # Recompute root hash with final directory (including signature)
        root_hash = JhcPackage._compute_root_hash(manifest_bytes, directory)

        # If signer is present, re-sign with the final root hash
        if signer is not None:
            payload = JhcPackage._signature_payload(root_hash, manifest)
            signature = signer.sign(payload)
            # Update signature section entry
            for entry in directory:
                if entry["sectionType"] == SECTION_TYPES["SIGNATURE"]:
                    entry["storedLength"] = len(signature)
                    entry["decodedLength"] = len(signature)
                    entry["decodedSha256"] = JhcPackage._sha256(signature)
                    break
            for i, section in enumerate(sections):
                if i == len(sections) - 1:
                    sections[i] = signature
            root_hash = JhcPackage._compute_root_hash(manifest_bytes, directory)

        # Layout: header (48) + manifest + directory + remaining sections
        manifest_offset = JhcPackage.HEADER_LEN
        directory_offset = manifest_offset + len(manifest_bytes)
        sections_offset = directory_offset + len(directory) * JhcPackage.DIR_ENTRY_LEN

        # Assign stored offsets. The manifest section is stored at manifest_offset
        # and is not repeated in the trailing section blob.
        section_offset = sections_offset
        for i, entry in enumerate(directory):
            if i == 0 and entry["sectionType"] == SECTION_TYPES["MANIFEST"]:
                entry["storedOffset"] = manifest_offset
            else:
                entry["storedOffset"] = section_offset
                section_offset += entry["storedLength"]

        # Build directory bytes
        directory_bytes = b""
        for entry in directory:
            directory_bytes += JhcPackage._encode_u32le(entry["sectionType"])
            directory_bytes += JhcPackage._encode_u32le(entry["sectionFlags"])
            directory_bytes += JhcPackage._encode_u32le(entry["logicalId"])
            directory_bytes += JhcPackage._encode_u32le(entry["codec"])
            directory_bytes += JhcPackage._encode_u64le(entry["storedOffset"])
            directory_bytes += JhcPackage._encode_u64le(entry["storedLength"])
            directory_bytes += JhcPackage._encode_u64le(entry["decodedLength"])
            directory_bytes += entry["decodedSha256"]

        # Build header
        header = b""
        header += JhcPackage.MAGIC
        header += JhcPackage.MAJOR.to_bytes(1, "little")
        header += JhcPackage.MINOR.to_bytes(1, "little")
        header += JhcPackage.HEADER_LEN.to_bytes(2, "little")
        header += JhcPackage._encode_u32le(0)  # flags
        header += JhcPackage._encode_u32le(0)  # dictionary version
        header += JhcPackage._encode_u32le(0)  # language profile
        header += JhcPackage._encode_u64le(manifest_offset)
        header += JhcPackage._encode_u64le(len(manifest_bytes))
        header += JhcPackage._encode_u64le(directory_offset)
        header += JhcPackage._encode_u32le(len(directory))
        # header length is 48; pad if needed
        header += b"\x00" * (JhcPackage.HEADER_LEN - len(header))

        # Build body: manifest, then directory, then every section except the
        # manifest which is already present at manifest_offset.
        body = manifest_bytes + directory_bytes + b"".join(sections[1:])

        container = header + body
        if len(container) > JhcPackage.MAX_PACKAGE_BYTES:
            raise JhcPackageError(_DiagCodes.PACKAGE_TOO_LARGE, "Package exceeds maximum size")
        return container

    @staticmethod
    def preflight(container: bytes) -> Dict[str, Any]:
        """Validate framing and authenticated metadata without decoding payloads."""
        if len(container) > JhcPackage.MAX_PACKAGE_BYTES:
            raise JhcPackageError(_DiagCodes.PACKAGE_TOO_LARGE, "Package exceeds maximum size")
        if len(container) < JhcPackage.HEADER_LEN:
            raise JhcPackageError(_DiagCodes.BAD_HEADER, "Container too short")

        if container[:4] != JhcPackage.MAGIC:
            raise JhcPackageError(_DiagCodes.BAD_MAGIC, "Bad JHC1 magic")

        major = container[4]
        minor = container[5]
        header_len = JhcPackage._decode_u16le(container, 6)
        flags = JhcPackage._decode_u32le(container, 8)
        dict_version = JhcPackage._decode_u32le(container, 12)
        lang_profile = JhcPackage._decode_u32le(container, 16)
        manifest_offset = JhcPackage._decode_u64le(container, 20)
        manifest_length = JhcPackage._decode_u64le(container, 28)
        directory_offset = JhcPackage._decode_u64le(container, 36)
        directory_count = JhcPackage._decode_u32le(container, 44)

        if header_len != JhcPackage.HEADER_LEN:
            raise JhcPackageError(_DiagCodes.BAD_HEADER, "Unsupported header length")
        if major != JhcPackage.MAJOR or minor > JhcPackage.MINOR:
            raise JhcPackageError(_DiagCodes.BAD_HEADER, f"Unsupported JHC version {major}.{minor}")
        if manifest_offset != header_len:
            raise JhcPackageError(_DiagCodes.BAD_HEADER, "Manifest offset is not canonical")
        if directory_offset != manifest_offset + manifest_length:
            raise JhcPackageError(_DiagCodes.BAD_DIRECTORY, "Directory offset is not canonical")
        if manifest_length > JhcPackage.MAX_MANIFEST_BYTES:
            raise JhcPackageError(_DiagCodes.MANIFEST_TOO_LARGE, "Manifest exceeds maximum size")
        if directory_count < 1 or directory_count > JhcPackage.MAX_FILES + 4:
            raise JhcPackageError(_DiagCodes.TOO_MANY_SECTIONS, "Package contains too many sections")

        if manifest_offset + manifest_length > len(container):
            raise JhcPackageError(_DiagCodes.BAD_HEADER, "Manifest out of bounds")

        manifest_bytes = container[manifest_offset:manifest_offset + manifest_length]
        try:
            manifest = json.loads(manifest_bytes.decode("utf-8"))
            if not isinstance(manifest, dict):
                raise ValueError("manifest root must be an object")
        except Exception as e:
            raise JhcPackageError(_DiagCodes.BAD_SECTION, f"Manifest is not valid JSON: {e}")

        manifest_format = manifest.get("format")
        manifest_container = manifest.get("container")
        # Pre-format JHC1 fixtures had neither field. Continue to read those,
        # but fail closed on partial, foreign, or future format declarations.
        if manifest_format is not None or manifest_container is not None:
            if manifest_format != "jhc-1.0" or manifest_container != "jhc-1.0":
                raise JhcPackageError(
                    _DiagCodes.BAD_SECTION,
                    "Unsupported JHC manifest format/container contract",
                )

        directory: List[Dict[str, Any]] = []
        directory_end = directory_offset + directory_count * JhcPackage.DIR_ENTRY_LEN
        if directory_end > len(container):
            raise JhcPackageError(_DiagCodes.BAD_DIRECTORY, "Directory out of bounds")

        total_decoded = 0
        allowed_types = set(SECTION_TYPES.values())
        for i in range(directory_count):
            off = directory_offset + i * JhcPackage.DIR_ENTRY_LEN
            entry = {
                "sectionType": JhcPackage._decode_u32le(container, off),
                "sectionFlags": JhcPackage._decode_u32le(container, off + 4),
                "logicalId": JhcPackage._decode_u32le(container, off + 8),
                "codec": JhcPackage._decode_u32le(container, off + 12),
                "storedOffset": JhcPackage._decode_u64le(container, off + 16),
                "storedLength": JhcPackage._decode_u64le(container, off + 24),
                "decodedLength": JhcPackage._decode_u64le(container, off + 32),
                "decodedSha256": container[off + 40:off + 72],
            }
            if entry["sectionType"] not in allowed_types or entry["sectionFlags"] != 0:
                raise JhcPackageError(_DiagCodes.BAD_SECTION, f"Unsupported section type or flags at entry {i}")
            if entry["codec"] not in (0, 1):
                raise JhcPackageError(_DiagCodes.UNSUPPORTED_CODEC, f"Unsupported codec {entry['codec']}")
            if entry["codec"] == 1 and entry["sectionType"] != SECTION_TYPES["RAW_RESOURCE"]:
                raise JhcPackageError(_DiagCodes.UNSUPPORTED_CODEC, "Token codec is only valid for resources")
            if entry["sectionType"] == SECTION_TYPES["MANIFEST"]:
                section_limit = JhcPackage.MAX_MANIFEST_BYTES
            elif entry["sectionType"] == SECTION_TYPES["LICENSE"]:
                section_limit = JhcPackage.MAX_LICENSE_BYTES
            elif entry["sectionType"] == SECTION_TYPES["SIGNATURE"]:
                section_limit = JhcPackage.MAX_SIGNATURE_BYTES
            else:
                section_limit = JhcPackage.MAX_FILE_BYTES
            if entry["decodedLength"] > section_limit:
                raise JhcPackageError(_DiagCodes.DECODE_BUDGET, "Section exceeds decoded size limit")
            if entry["codec"] == 0 and entry["storedLength"] != entry["decodedLength"]:
                raise JhcPackageError(_DiagCodes.LENGTH_MISMATCH, "Raw stored and decoded lengths differ")
            if (
                entry["codec"] != 0
                and entry["decodedLength"]
                > entry["storedLength"] * JhcPackage.MAX_EXPANSION_RATIO + JhcPackage.MAX_EXPANSION_SLACK
            ):
                raise JhcPackageError(_DiagCodes.DECODE_BUDGET, "Compressed section exceeds expansion ratio")
            total_decoded += entry["decodedLength"]
            if total_decoded > JhcPackage.MAX_TOTAL_DECODED_BYTES:
                raise JhcPackageError(_DiagCodes.DECODE_BUDGET, "Package exceeds aggregate decoded size limit")
            directory.append(entry)

        # Verify sorted directory
        sorted_dir = sorted(directory, key=lambda e: (e["sectionType"], e["logicalId"]))
        if directory != sorted_dir:
            raise JhcPackageError(_DiagCodes.BAD_DIRECTORY, "Directory is not sorted")
        for previous, current in zip(directory, directory[1:]):
            if (previous["sectionType"], previous["logicalId"]) == (current["sectionType"], current["logicalId"]):
                raise JhcPackageError(_DiagCodes.BAD_DIRECTORY, "Duplicate section identity")

        manifest_entries = [e for e in directory if e["sectionType"] == SECTION_TYPES["MANIFEST"]]
        if len(manifest_entries) != 1:
            raise JhcPackageError(_DiagCodes.BAD_DIRECTORY, "Package must contain exactly one manifest")
        manifest_entry = manifest_entries[0]
        if (
            manifest_entry["logicalId"] != 0
            or manifest_entry["codec"] != 0
            or manifest_entry["storedOffset"] != manifest_offset
            or manifest_entry["storedLength"] != manifest_length
        ):
            raise JhcPackageError(_DiagCodes.BAD_DIRECTORY, "Manifest entry does not match header")

        occupied: List[Tuple[int, int]] = []
        for entry in directory:
            start = entry["storedOffset"]
            end = start + entry["storedLength"]
            if end > len(container):
                raise JhcPackageError(_DiagCodes.BAD_SECTION, "Section out of bounds")
            if entry["sectionType"] == SECTION_TYPES["MANIFEST"]:
                continue
            if start < directory_end:
                raise JhcPackageError(_DiagCodes.OVERLAPPING_SECTION, "Section overlaps package metadata")
            occupied.append((start, end))
        occupied.sort()
        for previous, current in zip(occupied, occupied[1:]):
            if current[0] < previous[1]:
                raise JhcPackageError(_DiagCodes.OVERLAPPING_SECTION, "Package sections overlap")

        signature_entries = [e for e in directory if e["sectionType"] == SECTION_TYPES["SIGNATURE"]]
        if len(signature_entries) > 1 or any(e["codec"] != 0 or e["logicalId"] != 0 for e in signature_entries):
            raise JhcPackageError(_DiagCodes.BAD_SIGNATURE, "Invalid signature section layout")
        license_entries = [e for e in directory if e["sectionType"] == SECTION_TYPES["LICENSE"]]
        if len(license_entries) > 1 or any(e["codec"] != 0 or e["logicalId"] != 0 for e in license_entries):
            raise JhcPackageError(_DiagCodes.BAD_SECTION, "Invalid license section layout")

        resource_entries = [e for e in directory if e["sectionType"] == SECTION_TYPES["RAW_RESOURCE"]]
        records = manifest.get("resources")
        if not isinstance(records, list) or len(records) != len(resource_entries) or len(records) > JhcPackage.MAX_FILES:
            raise JhcPackageError(_DiagCodes.BAD_RESOURCE_MAP, "Resource count does not match sections")
        paths: List[str] = []
        for index, (entry, record) in enumerate(zip(resource_entries, records)):
            if (
                entry["logicalId"] != index
                or not isinstance(record, dict)
                or record.get("id") != index
                or not isinstance(record.get("path"), str)
            ):
                raise JhcPackageError(_DiagCodes.BAD_RESOURCE_MAP, f"Invalid resource mapping at {index}")
            expected_hash = entry["decodedSha256"].hex()
            if (
                record.get("decodedLength") != entry["decodedLength"]
                or record.get("hash") != expected_hash
            ):
                raise JhcPackageError(_DiagCodes.BAD_RESOURCE_MAP, f"Resource metadata mismatch for {record.get('path')}")
            paths.append(record["path"])
        path_report = validate_many(paths)
        if not path_report["ok"]:
            raise JhcPackageError(_DiagCodes.BAD_RESOURCE_MAP, "Invalid manifest resource path")
        block_files = manifest.get("blockmap", {}).get("files") if isinstance(manifest.get("blockmap"), dict) else None
        if block_files is not None:
            if not isinstance(block_files, dict) or set(block_files) != set(paths):
                raise JhcPackageError(_DiagCodes.BAD_RESOURCE_MAP, "Blockmap paths do not match resources")
            for record in records:
                if block_files.get(record["path"]) != record["hash"]:
                    raise JhcPackageError(_DiagCodes.BAD_RESOURCE_MAP, f"Blockmap hash mismatch for {record['path']}")

        signature_entry = signature_entries[0] if signature_entries else None
        signature = None
        if signature_entry is not None:
            start = signature_entry["storedOffset"]
            signature = container[start:start + signature_entry["storedLength"]]

        return {
            "container": container,
            "header": {
                "major": major,
                "minor": minor,
                "flags": flags,
                "dictionaryVersion": dict_version,
                "languageProfile": lang_profile,
            },
            "manifest": manifest,
            "manifest_bytes": manifest_bytes,
            "directory": directory,
            "directory_end": directory_end,
            "signature": signature,
            "totalDecoded": total_decoded,
        }

    @staticmethod
    def _decode_prepared(prepared: Dict[str, Any]) -> Dict[str, Any]:
        container = prepared["container"]
        manifest = prepared["manifest"]
        directory = prepared["directory"]

        sections: List[bytes] = []
        for entry in directory:
            soff = entry["storedOffset"]
            slen = entry["storedLength"]
            section = container[soff:soff + slen]
            decoded = JhcPackage._decode_section(section, entry, manifest)
            if len(decoded) != entry["decodedLength"]:
                raise JhcPackageError(_DiagCodes.LENGTH_MISMATCH, "Decoded section length mismatch")
            if JhcPackage._sha256(decoded) != entry["decodedSha256"]:
                raise JhcPackageError(
                    _DiagCodes.HASH_MISMATCH,
                    f"Hash mismatch for section {entry['sectionType']}/{entry['logicalId']}",
                )
            sections.append(decoded)

        # Build resources map
        resources: Dict[str, bytes] = {}
        for entry, section in zip(directory, sections):
            if entry["sectionType"] != SECTION_TYPES["RAW_RESOURCE"]:
                continue
            resource_record = manifest.get("resources", [])[entry["logicalId"]]
            resources[resource_record["path"]] = section

        signature: Optional[bytes] = None
        license_text: Optional[str] = None
        for entry, section in zip(directory, sections):
            if entry["sectionType"] == SECTION_TYPES["SIGNATURE"]:
                signature = section
            elif entry["sectionType"] == SECTION_TYPES["LICENSE"]:
                try:
                    license_text = section.decode("utf-8")
                except UnicodeDecodeError as exc:
                    raise JhcPackageError(_DiagCodes.LICENSE_MISMATCH, f"License is not valid UTF-8: {exc}")

        return {
            "header": prepared["header"],
            "manifest": manifest,
            "manifest_bytes": prepared["manifest_bytes"],
            "directory": directory,
            "resources": resources,
            "signature": signature,
            "licenseText": license_text,
            "rootHash": JhcPackage._compute_root_hash(prepared["manifest_bytes"], directory).hex(),
        }

    @staticmethod
    def parse(container: bytes) -> Dict[str, Any]:
        """Parse a strictly bounded JHC1 container."""
        return JhcPackage._decode_prepared(JhcPackage.preflight(container))

    @staticmethod
    def parse_authenticated(container: bytes, public_key: Any) -> Dict[str, Any]:
        """Authenticate package metadata before any compressed section is decoded."""
        prepared = JhcPackage.preflight(container)
        signature = prepared["signature"]
        if not signature:
            raise JhcPackageError(_DiagCodes.SIGNATURE_REQUIRED, "Package signature is required before decoding")
        root_hash = JhcPackage._compute_root_hash(prepared["manifest_bytes"], prepared["directory"])
        payload = JhcPackage._signature_payload(root_hash, prepared["manifest"])
        if not JhcPackage._verify_ecdsa(payload, signature, public_key):
            raise JhcPackageError(_DiagCodes.BAD_SIGNATURE, "Signature verification failed before decoding")
        return JhcPackage._decode_prepared(prepared)

    @staticmethod
    def verify(container: bytes, trust_store: Optional[Any] = None) -> Dict[str, Any]:
        """Verify a JHC1 container and return a trust verdict.

        ``trust_store`` may be a mapping of fingerprint -> public key or an object
        with a ``get_public_key(fingerprint)`` method. Unsigned and untrusted
        packages are rejected without decoding resource sections.
        """
        prepared = JhcPackage.preflight(container)
        manifest = prepared["manifest"]
        directory = prepared["directory"]
        signature = prepared["signature"]
        manifest_bytes = prepared["manifest_bytes"]
        root_hash = JhcPackage._compute_root_hash(manifest_bytes, directory)

        diagnostics = []
        verdict = "unsigned"
        fingerprint = manifest.get("publisherFingerprint")

        if not signature:
            diagnostics.append("No signature section; package was not decoded")
            return {
                "ok": False,
                "rootHash": root_hash.hex(),
                "verdict": verdict,
                "fingerprint": fingerprint,
                "diagnostics": diagnostics,
            }

        payload = JhcPackage._signature_payload(root_hash, manifest)
        pub_key = None
        if fingerprint and trust_store is not None:
            if isinstance(trust_store, dict):
                pub_key = trust_store.get(fingerprint)
            elif hasattr(trust_store, "get_public_key"):
                pub_key = trust_store.get_public_key(fingerprint)
            elif hasattr(trust_store, "get"):
                pub_key = trust_store.get(fingerprint)
            if pub_key is None:
                diagnostics.append("No public key for fingerprint in trust store; package was not decoded")
                return {
                    "ok": False,
                    "rootHash": root_hash.hex(),
                    "verdict": "untrusted",
                    "fingerprint": fingerprint,
                    "diagnostics": diagnostics,
                }
            verdict = "trusted"
        elif isinstance(manifest.get("pubKey"), str):
            import base64
            try:
                pub_key = base64.b64decode(manifest["pubKey"], validate=True)
                verdict = "signed"
            except Exception as exc:
                diagnostics.append(f"Embedded publisher key is invalid: {exc}")

        if pub_key is None:
            diagnostics.append("No public key is available; package was not decoded")
            return {
                "ok": False,
                "rootHash": root_hash.hex(),
                "verdict": "untrusted",
                "fingerprint": fingerprint,
                "diagnostics": diagnostics,
            }

        try:
            if not JhcPackage._verify_ecdsa(payload, signature, pub_key):
                diagnostics.append("Signature verification failed before decode")
                verdict = "invalid"
            else:
                JhcPackage._decode_prepared(prepared)
        except Exception as exc:
            verdict = "invalid"
            diagnostics.append(f"Authenticated decode failed: {exc}")

        return {
            "ok": verdict in ("trusted", "signed"),
            "rootHash": root_hash.hex(),
            "verdict": verdict,
            "fingerprint": fingerprint,
            "diagnostics": diagnostics,
        }

    @staticmethod
    def _verify_ecdsa(payload: bytes, signature: bytes, pub_key: Any) -> bool:
        """Verify an ECDSA P-256 signature."""
        try:
            from cryptography.hazmat.primitives import hashes, serialization
            from cryptography.hazmat.primitives.asymmetric import ec, utils
            from cryptography.exceptions import InvalidSignature
        except ImportError:  # pragma: no cover
            raise JhcPackageError(
                _DiagCodes.TRUST_FAILED,
                "cryptography package is required for ECDSA verification",
            )

        if isinstance(pub_key, str) and pub_key.startswith("-----"):
            key = serialization.load_pem_public_key(pub_key.encode())
        elif isinstance(pub_key, bytes) and pub_key.startswith(b"-----"):
            key = serialization.load_pem_public_key(pub_key)
        elif isinstance(pub_key, str):
            # Try hex or base64 raw/DER/SPKI public key.
            try:
                raw = bytes.fromhex(pub_key)
            except ValueError:
                import base64
                raw = base64.b64decode(pub_key)
            pub_key = raw

        if isinstance(pub_key, bytes):
            # DER / raw key
            if len(pub_key) == 65 and pub_key[0] == 0x04:
                key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), pub_key)
            else:
                try:
                    key = serialization.load_der_public_key(pub_key)
                except Exception:
                    # Fall back to raw uncompressed point if DER starts with 0x04
                    if len(pub_key) == 65 and pub_key[0] == 0x04:
                        key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), pub_key)
                    else:
                        raise
        else:
            key = pub_key

        try:
            key.verify(signature, payload, ec.ECDSA(hashes.SHA256()))
            return True
        except InvalidSignature:
            pass

        # Try raw r||s format (64 bytes for P-256) — convert to DER
        if len(signature) == 64:
            r = int.from_bytes(signature[:32], "big")
            s = int.from_bytes(signature[32:], "big")
            der_sig = utils.encode_dss_signature(r, s)
            try:
                key.verify(der_sig, payload, ec.ECDSA(hashes.SHA256()))
                return True
            except InvalidSignature:
                return False

        return False

    @staticmethod
    def inspect(container: bytes) -> Dict[str, Any]:
        """Return a human-readable report about a JHC1 container."""
        parsed = JhcPackage.parse(container)
        manifest = parsed["manifest"]
        resources = parsed["resources"]
        report = {
            "format": "jhc-1.0",
            "applicationId": manifest.get("applicationId"),
            "applicationVersion": manifest.get("applicationVersion"),
            "entry": manifest.get("entry"),
            "sectionCount": len(parsed["directory"]),
            "resourceCount": len(resources),
            "rootHash": parsed["rootHash"],
            "signed": parsed["signature"] is not None,
            "resourcePaths": sorted(resources.keys()),
        }
        return report


def pack(manifest: Dict[str, Any], resources: Dict[str, bytes], signer: Optional[Any] = None) -> bytes:
    return JhcPackage.pack(manifest, resources, signer)


def parse(container: bytes) -> Dict[str, Any]:
    return JhcPackage.parse(container)


def verify(container: bytes, trust_store: Optional[Any] = None) -> Dict[str, Any]:
    return JhcPackage.verify(container, trust_store)


def inspect(container: bytes) -> Dict[str, Any]:
    return JhcPackage.inspect(container)
