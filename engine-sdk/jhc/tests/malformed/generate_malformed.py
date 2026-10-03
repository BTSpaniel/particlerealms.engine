# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
#
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Generate a malformed JHC1 corpus with expected diagnostic codes.

Each malformed container is paired with a JSON sidecar listing the expected
error code and message fragment.  The browser runner and Python tests can
then assert that both implementations reject the container with the same
diagnostic.
"""

from pathlib import Path
import json
import struct
import sys

ROOT = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(ROOT))

from jhc import JhcPackage

OUT_DIR = Path(__file__).resolve().parent


def _make_valid_container() -> bytes:
    """Return a minimal valid JHC1 container for mutation."""
    manifest = {
        "applicationId": "test.malformed",
        "applicationVersion": "1.0.0",
        "entry": "files/index.html",
        "requiredFeatures": 0,
    }
    resources = {
        "files/index.html": b"<html><body>ok</body></html>",
    }
    return JhcPackage.pack(manifest, resources)


def _write_case(name: str, container: bytes, code: int, message_fragment: str):
    (OUT_DIR / f"{name}.jhc").write_bytes(container)
    sidecar = {
        "name": name,
        "expectedCode": code,
        "expectedMessageFragment": message_fragment,
        "size": len(container),
    }
    (OUT_DIR / f"{name}.json").write_text(
        json.dumps(sidecar, indent=2), encoding="utf-8"
    )
    print(f"  [{name}] {len(container)} bytes, code={code}")


def main():
    valid = _make_valid_container()

    cases = []

    # 1. Container too short (< 48 bytes)
    cases.append(("too-short", valid[:10], 201, "Container too short"))

    # 2. Bad magic
    bad_magic = bytearray(valid)
    bad_magic[0] = 0x00
    cases.append(("bad-magic", bytes(bad_magic), 200, "Bad JHC1 magic"))

    # 3. Bad header length (set headerLen to 64 instead of 48)
    bad_header = bytearray(valid)
    struct.pack_into("<H", bad_header, 6, 64)
    cases.append(("bad-header-len", bytes(bad_header), 201, "Unsupported header length"))

    # 4. Manifest out of bounds (set manifestOffset beyond container)
    bad_manifest = bytearray(valid)
    struct.pack_into("<Q", bad_manifest, 20, len(valid) + 1000)
    cases.append(("manifest-oob", bytes(bad_manifest), 201, "Manifest out of bounds"))

    # 5. Directory out of bounds (set directoryOffset beyond container)
    bad_dir = bytearray(valid)
    struct.pack_into("<Q", bad_dir, 36, len(valid) + 1000)
    cases.append(("directory-oob", bytes(bad_dir), 202, "Directory out of bounds"))

    # 6. Directory not sorted (swap two directory entries)
    # Parse the valid container to find directory offset and count
    parsed = JhcPackage.parse(valid)
    dir_offset = struct.unpack_from("<Q", valid, 36)[0]
    dir_count = struct.unpack_from("<I", valid, 44)[0]
    entry_len = JhcPackage.DIR_ENTRY_LEN

    if dir_count >= 2:
        unsorted = bytearray(valid)
        # Swap first two directory entries
        entry0 = bytes(unsorted[dir_offset:dir_offset + entry_len])
        entry1 = bytes(unsorted[dir_offset + entry_len:dir_offset + 2 * entry_len])
        unsorted[dir_offset:dir_offset + entry_len] = entry1
        unsorted[dir_offset + entry_len:dir_offset + 2 * entry_len] = entry0
        cases.append(("unsorted-directory", bytes(unsorted), 202, "Directory is not sorted"))

    # 7. Section out of bounds (corrupt a storedOffset in a directory entry)
    if dir_count >= 2:
        section_oob = bytearray(valid)
        # Corrupt the second entry's storedOffset (offset 16 within entry)
        entry1_off = dir_offset + entry_len + 16
        struct.pack_into("<Q", section_oob, entry1_off, len(valid) + 500)
        cases.append(("section-oob", bytes(section_oob), 203, "Section out of bounds"))

    # 8. Hash mismatch (corrupt one byte in a resource section)
    # Find the first resource section offset from the directory
    if dir_count >= 2:
        entry1_off = dir_offset + entry_len
        res_offset = struct.unpack_from("<Q", valid, entry1_off + 16)[0]
        res_length = struct.unpack_from("<Q", valid, entry1_off + 24)[0]
        if res_offset + res_length <= len(valid) and res_length > 0:
            hash_mismatch = bytearray(valid)
            hash_mismatch[res_offset] ^= 0xFF
            cases.append(("hash-mismatch", bytes(hash_mismatch), 204, "Hash mismatch"))

    # 9. Invalid manifest JSON (corrupt manifest bytes)
    manifest_offset = struct.unpack_from("<Q", valid, 20)[0]
    manifest_length = struct.unpack_from("<Q", valid, 28)[0]
    bad_json = bytearray(valid)
    # Corrupt the first byte of the manifest (after the opening brace)
    if manifest_length > 1:
        bad_json[manifest_offset + 1] = 0xFF
    cases.append(("bad-manifest-json", bytes(bad_json), 203, "Manifest is not valid JSON"))

    # 10. Truncated container (cut off last few bytes)
    truncated = valid[:-4]
    cases.append(("truncated", truncated, 203, "Section out of bounds"))

    # 11. Unknown codec must be rejected before any decoder is invoked.
    unsupported_codec = bytearray(valid)
    struct.pack_into("<I", unsupported_codec, dir_offset + entry_len + 12, 99)
    cases.append(("unsupported-codec", bytes(unsupported_codec), 122, "Unsupported codec"))

    # 12. Raw sections cannot claim a different decoded size.
    raw_length_mismatch = bytearray(valid)
    decoded_len_off = dir_offset + entry_len + 32
    decoded_len = struct.unpack_from("<Q", valid, decoded_len_off)[0]
    struct.pack_into("<Q", raw_length_mismatch, decoded_len_off, decoded_len + 1)
    cases.append(("raw-length-mismatch", bytes(raw_length_mismatch), 120, "lengths differ"))

    # 13. Payload bytes may not alias the header, manifest, or directory.
    metadata_overlap = bytearray(valid)
    directory_end = dir_offset + dir_count * entry_len
    struct.pack_into("<Q", metadata_overlap, dir_offset + entry_len + 16, directory_end - 1)
    cases.append(("metadata-overlap", bytes(metadata_overlap), 121, "overlaps package metadata"))

    # 14. A declared decode bomb is rejected using metadata alone.
    decode_bomb = bytearray(valid)
    struct.pack_into("<I", decode_bomb, dir_offset + entry_len + 12, 1)
    struct.pack_into("<Q", decode_bomb, decoded_len_off, JhcPackage.MAX_FILE_BYTES + 1)
    cases.append(("decode-budget", bytes(decode_bomb), 119, "decoded size limit"))

    # 15. Excessive directory counts fail before the directory is walked.
    too_many_sections = bytearray(valid)
    struct.pack_into("<I", too_many_sections, 44, JhcPackage.MAX_FILES + 5)
    cases.append(("too-many-sections", bytes(too_many_sections), 118, "too many sections"))

    # 16. Resource metadata must be bound exactly to directory metadata.
    resource_map = bytearray(valid)
    marker = b'"hash":"'
    hash_pos = resource_map.find(marker, manifest_offset, manifest_offset + manifest_length)
    if hash_pos >= 0:
        resource_map[hash_pos + len(marker)] = ord("0") if resource_map[hash_pos + len(marker)] != ord("0") else ord("1")
        cases.append(("resource-map-mismatch", bytes(resource_map), 123, "Resource metadata mismatch"))

    # Write all cases
    print(f"Generating malformed corpus in {OUT_DIR}")
    for name, container, code, msg in cases:
        _write_case(name, container, code, msg)

    # Write index
    index = {
        "cases": [
            {"name": name, "expectedCode": code, "expectedMessageFragment": msg}
            for name, _, code, msg in cases
        ]
    }
    (OUT_DIR / "index.json").write_text(
        json.dumps(index, indent=2), encoding="utf-8"
    )
    print(f"\nGenerated {len(cases)} malformed cases.")


if __name__ == "__main__":
    main()
