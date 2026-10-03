# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Content-free release inventory for embedded official package evidence."""

import base64
import hashlib
import json
import re


OFFICIAL_PACKAGE_ASSIGNMENT = "globalThis.__OS_OFFICIAL_PACKAGES__="
OFFICIAL_PACKAGE_INVENTORY_FORMAT = "webgpu-os-official-package-inventory-v2"
OFFICIAL_CONTAINER_FORMAT = "particle-official-container-v1"
OFFICIAL_CONTAINER_MAX_BYTES = 64 * 1024 * 1024

_HEX_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_TAGGED_SHA256 = re.compile(r"^sha256:256:[0-9a-f]{64}$")


def official_container_descriptor(value):
    """Validate one content-addressed, bounded package sidecar reference."""
    if not isinstance(value, dict) or set(value) != {"format", "path", "bytes", "sha256"}:
        raise ValueError("Official package containerRef has unexpected fields")
    digest = value.get("sha256")
    size = value.get("bytes")
    if (value.get("format") != OFFICIAL_CONTAINER_FORMAT
            or not isinstance(digest, str) or not _HEX_SHA256.fullmatch(digest)
            or type(size) is not int or not 0 < size <= OFFICIAL_CONTAINER_MAX_BYTES
            or value.get("path") != f"official-packages/{digest}.prpkg"):
        raise ValueError("Official package containerRef has an invalid identity or path")
    return dict(value)


def externalize_official_package_containers(records, assets, minimum_bytes=64 * 1024):
    """Keep synchronous Faculty evidence inline; move large export payloads out of JS.

    Called only after the complete signed registry has passed cryptographic
    verification. The caller publishes these exact bytes with the runtime.
    """
    result = {}
    for package_id, record in records.items():
        container = base64.b64decode(record["container"], validate=True)
        if len(container) < minimum_bytes or record["envelope"]["manifest"].get("naviFaculty"):
            result[package_id] = record
            continue
        digest = hashlib.sha256(container).hexdigest()
        path = f"official-packages/{digest}.prpkg"
        if path in assets and assets[path] != container:
            raise ValueError("Official package content-address collision")
        assets[path] = container
        result[package_id] = {key: value for key, value in record.items() if key != "container"}
        result[package_id]["containerRef"] = {
            "format": OFFICIAL_CONTAINER_FORMAT, "path": path,
            "bytes": len(container), "sha256": digest,
        }
    return result


def official_package_sidecar_inventory(records):
    """List referenced sidecars once, validating duplicate identities."""
    descriptors = {}
    for record in records.values():
        if "containerRef" not in record:
            continue
        if "container" in record or record.get("envelope", {}).get("manifest", {}).get("naviFaculty"):
            raise ValueError("Official Faculty/inline package cannot use an external container")
        descriptor = official_container_descriptor(record["containerRef"])
        previous = descriptors.get(descriptor["path"])
        if previous is not None and previous != descriptor:
            raise ValueError("Official package sidecar identity conflict")
        descriptors[descriptor["path"]] = descriptor
    result = [descriptors[key] for key in sorted(descriptors)]
    if sum(item["bytes"] for item in result) > OFFICIAL_CONTAINER_MAX_BYTES:
        raise ValueError("Official package sidecars exceed the resident byte budget")
    return result


def verify_official_package_sidecars(descriptors, directory):
    """Fail closed on absent, substituted, or truncated deploy/archive assets."""
    from pathlib import Path
    root = Path(directory).resolve()
    seen = set()
    for item in descriptors:
        descriptor = official_container_descriptor(item)
        if descriptor["path"] in seen:
            raise ValueError("Official package sidecar inventory repeats a path")
        seen.add(descriptor["path"])
        path = root / descriptor["path"]
        if not path.resolve().is_relative_to(root):
            raise ValueError("Official package sidecar escapes asset directory")
        if path.stat().st_size != descriptor["bytes"]:
            raise ValueError("Official package sidecar byte count mismatch")
        if hashlib.sha256(path.read_bytes()).hexdigest() != descriptor["sha256"]:
            raise ValueError("Official package sidecar SHA-256 mismatch")
    return len(seen)


def extract_official_package_records(source: str) -> dict:
    """Extract the one JSON package registry embedded in a JavaScript bundle."""
    if not isinstance(source, str) or not source:
        raise ValueError("Official package source must be a non-empty string")
    marker_count = source.count(OFFICIAL_PACKAGE_ASSIGNMENT)
    if marker_count != 1:
        raise ValueError(
            "Official package source must contain exactly one registry assignment "
            f"(found {marker_count})"
        )
    start = source.index(OFFICIAL_PACKAGE_ASSIGNMENT) + len(OFFICIAL_PACKAGE_ASSIGNMENT)
    # SDK replacements retain their exact JSON bytes, including pretty-print
    # whitespace. Advance the decoder's cursor without rewriting the source.
    while start < len(source) and source[start] in " \t\r\n":
        start += 1
    try:
        records, _end = json.JSONDecoder().raw_decode(source, start)
    except json.JSONDecodeError as error:
        raise ValueError("Official package registry is not one valid JSON object") from error
    if not isinstance(records, dict) or not records:
        raise ValueError("Official package registry must be a non-empty object")
    return records


def build_official_package_inventory(records: dict) -> dict:
    """Project signed package records into a deterministic content-free inventory."""
    if not isinstance(records, dict) or not records:
        raise ValueError("Official package records must be a non-empty object")
    packages = []
    for package_id in sorted(records):
        record = _require_object(records[package_id], f"records.{package_id}")
        envelope = _require_object(record.get("envelope"), f"records.{package_id}.envelope")
        manifest = _require_object(envelope.get("manifest"), f"records.{package_id}.manifest")
        blockmap = _require_object(envelope.get("blockmap"), f"records.{package_id}.blockmap")
        signature = _require_object(envelope.get("signature"), f"records.{package_id}.signature")
        certificate = _require_object(envelope.get("cert"), f"records.{package_id}.cert")
        provenance = _require_object(envelope.get("provenance"), f"records.{package_id}.provenance")
        build_params = _require_object(
            provenance.get("buildParams"),
            f"records.{package_id}.provenance.buildParams",
        )

        version = _require_text(record.get("version"), f"records.{package_id}.version")
        manifest_id = _require_text(manifest.get("id"), f"records.{package_id}.manifest.id")
        manifest_version = _require_text(
            manifest.get("version"), f"records.{package_id}.manifest.version"
        )
        blockmap_id = _require_text(
            blockmap.get("packageId"), f"records.{package_id}.blockmap.packageId"
        )
        blockmap_version = _require_text(
            blockmap.get("version"), f"records.{package_id}.blockmap.version"
        )
        if package_id != manifest_id or package_id != blockmap_id:
            raise ValueError(f"Official package identity drifted for {package_id}")
        if version != manifest_version or version != blockmap_version:
            raise ValueError(f"Official package version drifted for {package_id}")

        merkle_root = _require_hash_hex(
            blockmap.get("merkleRoot"), f"records.{package_id}.blockmap.merkleRoot"
        )
        resource_root = f"sha256:256:{merkle_root}"
        publisher = _require_text(
            signature.get("publisher"), f"records.{package_id}.signature.publisher"
        )
        if manifest.get("publisher") != publisher:
            raise ValueError(f"Official package publisher drifted for {package_id}")
        publisher_fingerprint = _require_text(
            signature.get("fingerprint"),
            f"records.{package_id}.signature.fingerprint",
        )
        certificate_fingerprint = _require_text(
            certificate.get("fingerprint"),
            f"records.{package_id}.cert.fingerprint",
        )
        if publisher_fingerprint != certificate_fingerprint:
            raise ValueError(f"Official package certificate drifted for {package_id}")
        if "containerRef" in record:
            if "container" in record or manifest.get("naviFaculty"):
                raise ValueError("Official Faculty/inline package cannot use an external container")
            descriptor = official_container_descriptor(record["containerRef"])
            container_sha256 = descriptor["sha256"]
        else:
            try:
                container = base64.b64decode(
                    _require_text(record.get("container"), f"records.{package_id}.container"),
                    validate=True,
                )
            except Exception as error:
                raise ValueError(f"Official package container is not canonical base64 for {package_id}") from error
            if not container:
                raise ValueError(f"Official package container is empty for {package_id}")
            container_sha256 = hashlib.sha256(container).hexdigest()
        certificate_not_before = _require_text(
            certificate.get("notBefore"), f"records.{package_id}.cert.notBefore"
        )
        certificate_not_after = _require_text(
            certificate.get("notAfter"), f"records.{package_id}.cert.notAfter"
        )

        navi_faculty = manifest.get("naviFaculty")
        if navi_faculty is not None:
            navi_faculty = _require_object(
                navi_faculty, f"records.{package_id}.manifest.naviFaculty"
            )
            faculty_id = _require_text(
                navi_faculty.get("facultyId"),
                f"records.{package_id}.manifest.naviFaculty.facultyId",
            )
            faculty_version = _require_text(
                navi_faculty.get("facultyVersion"),
                f"records.{package_id}.manifest.naviFaculty.facultyVersion",
            )
            if faculty_version != version:
                raise ValueError(f"Official Faculty version drifted for {package_id}")
        else:
            faculty_id = None
        faculty_manifest = _require_object(
            (navi_faculty or {}).get("manifest", {}),
            f"records.{package_id}.manifest.naviFaculty.manifest",
        )
        faculty_provenance = _require_object(
            faculty_manifest.get("provenance", {}),
            f"records.{package_id}.manifest.naviFaculty.manifest.provenance",
        )
        package_hash = faculty_provenance.get("packageHash", resource_root)
        package_hash = _require_tagged_hash(
            package_hash, f"records.{package_id}.faculty.provenance.packageHash"
        )
        if package_hash != resource_root:
            raise ValueError(f"Official Faculty package hash drifted for {package_id}")

        item = {
            "packageId": package_id,
            "version": version,
            "resourceRoot": resource_root,
            "packageHash": package_hash,
            "publisher": publisher,
            "publisherFingerprint": publisher_fingerprint,
            "certificateFingerprint": certificate_fingerprint,
            "containerSha256": container_sha256,
            "envelopeSha256": hashlib.sha256(
                json.dumps(
                    envelope,
                    sort_keys=True,
                    separators=(",", ":"),
                    ensure_ascii=False,
                ).encode("utf-8")
            ).hexdigest(),
            "recordSha256": hashlib.sha256(
                json.dumps(
                    record,
                    sort_keys=True,
                    separators=(",", ":"),
                    ensure_ascii=False,
                ).encode("utf-8")
            ).hexdigest(),
            "certificateNotBefore": certificate_not_before,
            "certificateNotAfter": certificate_not_after,
        }
        if "containerRef" in record:
            item["containerAsset"] = descriptor
        issuer_fingerprint = certificate.get("issuerFingerprint")
        if issuer_fingerprint is not None:
            item["certificateIssuerFingerprint"] = _require_text(
                issuer_fingerprint,
                f"records.{package_id}.cert.issuerFingerprint",
            )

        if faculty_id is not None:
            embedded_faculty_id = _require_text(
                faculty_manifest.get("facultyId"),
                f"records.{package_id}.manifest.naviFaculty.manifest.facultyId",
            )
            embedded_faculty_version = _require_text(
                faculty_manifest.get("version"),
                f"records.{package_id}.manifest.naviFaculty.manifest.version",
            )
            if embedded_faculty_id != faculty_id or embedded_faculty_version != version:
                raise ValueError(f"Official Faculty manifest drifted for {package_id}")
            build_faculty_id = build_params.get("facultyId")
            if build_faculty_id is not None and build_faculty_id != faculty_id:
                raise ValueError(f"Official Faculty identity drifted for {package_id}")
            item["facultyId"] = faculty_id

        revision_input_hash = build_params.get("revisionInputHash")
        if revision_input_hash is not None:
            item["revisionInputHash"] = _require_tagged_hash(
                revision_input_hash,
                f"records.{package_id}.provenance.buildParams.revisionInputHash",
            )
        packages.append(item)
    return {
        "format": OFFICIAL_PACKAGE_INVENTORY_FORMAT,
        "packages": packages,
    }


def official_package_inventory_from_source(source: str) -> dict:
    """Extract and inventory the official records embedded in source text."""
    return build_official_package_inventory(extract_official_package_records(source))


def assert_official_package_inventory_matches_source(source: str, expected: dict) -> int:
    """Fail closed unless embedded records project to the reviewed inventory."""
    actual = official_package_inventory_from_source(source)
    if actual != expected:
        raise ValueError("Embedded official package records do not match the release inventory")
    return len(actual["packages"])


def assert_manifest_official_package_inventory(manifest: dict, expected: dict) -> int:
    """Fail closed unless a build or deployed manifest carries the exact inventory."""
    if not isinstance(manifest, dict):
        raise ValueError("Bundle manifest must be an object")
    actual = manifest.get("officialPackages")
    if actual != expected:
        raise ValueError("Bundle manifest officialPackages inventory is missing or stale")
    assets = {item["containerAsset"]["path"]: official_container_descriptor(item["containerAsset"])
              for item in expected.get("packages", ()) if "containerAsset" in item}
    if manifest.get("officialPackageAssets", []) != [assets[path] for path in sorted(assets)]:
        raise ValueError("Bundle manifest officialPackageAssets inventory is missing or stale")
    return len(expected.get("packages", ()))


def _require_object(value, label: str) -> dict:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _require_text(value, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string")
    return value


def _require_hash_hex(value, label: str) -> str:
    value = _require_text(value, label)
    if not _HEX_SHA256.fullmatch(value):
        raise ValueError(f"{label} must be a lowercase SHA-256 digest")
    return value


def _require_tagged_hash(value, label: str) -> str:
    value = _require_text(value, label)
    if not _TAGGED_SHA256.fullmatch(value):
        raise ValueError(f"{label} must be a tagged SHA-256 digest")
    return value
