# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Physical transport of one unchanged compressed runtime in bounded files."""

import hashlib
import re
from pathlib import Path


RUNTIME_PART_BYTES = 16 * 1024 * 1024
MAX_RUNTIME_PARTS = 64
_ARTIFACT_HASH_PREFIX_LENGTH = 24


def _artifact_name(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", value):
        raise ValueError("Compressed artifact must have a safe basename")
    return value


def _positive_bytes(value, label):
    if type(value) is not int or value <= 0:
        raise ValueError(f"{label} must be a positive integer")
    return value


def plan_compressed_artifact_parts(logical_name, payload, *, max_file_bytes, part_bytes=RUNTIME_PART_BYTES):
    """Return deterministic records and exact byte slices; small files stay whole."""
    logical_name = _artifact_name(logical_name)
    _positive_bytes(max_file_bytes, "Host file limit")
    _positive_bytes(part_bytes, "Transport part size")
    if part_bytes > RUNTIME_PART_BYTES:
        raise ValueError("Transport parts exceed the browser part-size bound")
    if not isinstance(payload, (bytes, bytearray, memoryview)) or not payload:
        raise ValueError("Compressed artifact payload must contain bytes")
    payload = bytes(payload)
    if len(payload) <= max_file_bytes:
        return [], {}
    if part_bytes > max_file_bytes:
        raise ValueError("Transport part size exceeds the host file limit")
    count = (len(payload) + part_bytes - 1) // part_bytes
    if count > MAX_RUNTIME_PARTS:
        raise ValueError("Compressed artifact exceeds the transport part-count bound")
    prefix = hashlib.sha256(payload).hexdigest()[:_ARTIFACT_HASH_PREFIX_LENGTH]
    records, files = [], {}
    for index, offset in enumerate(range(0, len(payload), part_bytes)):
        chunk = payload[offset:offset + part_bytes]
        name = f"{logical_name}.{prefix}.part-{index:04d}.bin"
        records.append({"src": name, "bytes": len(chunk), "sha256": hashlib.sha256(chunk).hexdigest()})
        files[name] = chunk
    return records, files


def validate_compressed_artifact_parts(logical_name, records, *, expected_bytes=None):
    """Validate an ordered, bounded transport description without trusting paths."""
    logical_name = _artifact_name(logical_name)
    if not isinstance(records, list) or not 1 <= len(records) <= MAX_RUNTIME_PARTS:
        raise ValueError("Compressed artifact parts must be a nonempty bounded list")
    if expected_bytes is not None:
        _positive_bytes(expected_bytes, "Compressed artifact byte count")
    canonical, prefix, total = [], None, 0
    pattern = re.compile(re.escape(logical_name) + r"\.([0-9a-f]{24})\.part-([0-9]{4})\.bin")
    for index, record in enumerate(records):
        if not isinstance(record, dict) or set(record) != {"src", "bytes", "sha256"}:
            raise ValueError("Compressed artifact part has an invalid record shape")
        name = _artifact_name(record["src"])
        match = pattern.fullmatch(name)
        if match is None or int(match[2]) != index:
            raise ValueError("Compressed artifact part name or ordinal is invalid")
        if prefix is not None and prefix != match[1]:
            raise ValueError("Compressed artifact parts disagree on their content identity")
        prefix = match[1]
        length = _positive_bytes(record["bytes"], "Compressed artifact part byte count")
        if length > RUNTIME_PART_BYTES:
            raise ValueError("Compressed artifact part exceeds the browser size bound")
        digest = record["sha256"]
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError("Compressed artifact part SHA-256 is invalid")
        total += length
        canonical.append({"src": name, "bytes": length, "sha256": digest})
    if expected_bytes is not None and total != expected_bytes:
        raise ValueError("Compressed artifact part lengths do not match its logical byte count")
    return canonical


def compressed_artifact_part_map(manifest):
    """Return the validated optional manifest map, preserving artifact identities."""
    if not isinstance(manifest, dict):
        raise ValueError("Compressed artifact manifest must be an object")
    mapping = manifest.get("compressed_artifact_parts", {})
    if not isinstance(mapping, dict):
        raise ValueError("Compressed artifact parts map must be an object")
    return {
        _artifact_name(name): validate_compressed_artifact_parts(name, records)
        for name, records in mapping.items()
    }


def compressed_artifact_paths(manifest, logical_name):
    """Enumerate physical deployment paths for one logical compressed artifact."""
    logical_name = _artifact_name(logical_name)
    records = compressed_artifact_part_map(manifest).get(logical_name)
    return tuple(record["src"] for record in records) if records else (logical_name,)


def _physical_artifact_path(directory, name):
    directory = Path(directory).resolve()
    path = (directory / _artifact_name(name)).resolve()
    if path.parent != directory:
        raise ValueError("Compressed artifact path escapes its asset directory")
    return path


def _verify_reassembled_artifact(logical_name, payload, records):
    records = validate_compressed_artifact_parts(logical_name, records, expected_bytes=len(payload))
    offset = 0
    for record in records:
        chunk = payload[offset:offset + record["bytes"]]
        if hashlib.sha256(chunk).hexdigest() != record["sha256"]:
            raise ValueError(f"Compressed artifact part SHA-256 mismatch: {record['src']}")
        offset += record["bytes"]
    prefix = hashlib.sha256(payload).hexdigest()[:_ARTIFACT_HASH_PREFIX_LENGTH]
    if not records[0]["src"].startswith(f"{logical_name}.{prefix}.part-"):
        raise ValueError("Compressed artifact content does not match its part filename identity")


def read_compressed_artifact(directory, logical_name, manifest, *, expected_bytes=None, prefer_full=True):
    """Read and verify full local bytes or their exact declared public transport."""
    logical_name = _artifact_name(logical_name)
    if expected_bytes is not None:
        _positive_bytes(expected_bytes, "Compressed artifact byte count")
    records = compressed_artifact_part_map(manifest).get(logical_name)
    if records:
        records = validate_compressed_artifact_parts(logical_name, records, expected_bytes=expected_bytes)
    path = _physical_artifact_path(directory, logical_name)
    if records and (not prefer_full or not path.is_file()):
        chunks = []
        for record in records:
            part = _physical_artifact_path(directory, record["src"])
            if part.stat().st_size != record["bytes"]:
                raise ValueError(f"Compressed artifact part byte count mismatch: {record['src']}")
            chunk = part.read_bytes()
            if len(chunk) != record["bytes"] or hashlib.sha256(chunk).hexdigest() != record["sha256"]:
                raise ValueError(f"Compressed artifact part SHA-256 mismatch: {record['src']}")
            chunks.append(chunk)
        payload = b"".join(chunks)
    else:
        if expected_bytes is not None and path.stat().st_size != expected_bytes:
            raise ValueError(f"Compressed artifact byte count mismatch: {logical_name}")
        payload = path.read_bytes()
    if expected_bytes is not None and len(payload) != expected_bytes:
        raise ValueError(f"Compressed artifact byte count mismatch: {logical_name}")
    if records:
        _verify_reassembled_artifact(logical_name, payload, records)
    return payload
