<!--
SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
-->

# JHC1 container format

This document describes the binary `JHC1` container used by PRPKG v3.

## File layout

A JHC1 file is a concatenation of:

1. Fixed header (48 bytes)
2. Canonical manifest section (raw JHC canonical JSON profile)
3. Directory (sorted section records)
4. Sections (raw canonical bytes)

All multi-byte integers are little-endian. Strings are UTF-8. No timestamps,
compression bytes, or random identifiers are part of the canonical identity.

## Fixed header

| Offset | Size | Field |
|--------|------|-------|
| 0 | 4 | Magic: `JHC1` (0x4A 0x48 0x43 0x31) |
| 4 | 1 | Format major (1 for JHC1) |
| 5 | 1 | Format minor (0 for v3.0) |
| 6 | 2 | Header length (48) |
| 8 | 4 | Flags |
| 12 | 4 | Dictionary version |
| 16 | 4 | Language profile |
| 20 | 8 | Manifest offset |
| 28 | 8 | Manifest length |
| 36 | 8 | Directory offset |
| 44 | 4 | Directory count |

Total header length: **48 bytes**.

## Directory entry

Each directory entry is 72 bytes:

| Offset | Size | Field |
|--------|------|-------|
| 0 | 4 | Section type ID |
| 4 | 4 | Section flags |
| 8 | 4 | Logical ID |
| 12 | 4 | Codec ID (0 = raw, 1 = JHC TokenCodec) |
| 16 | 8 | Stored offset |
| 24 | 8 | Stored length |
| 32 | 8 | Decoded length |
| 40 | 32 | Decoded SHA-256 |

Directory entries are sorted by `sectionType` ascending, then `logicalId` ascending.

## Section types

See `jhc/registry/section-types.json`. V3.0 uses:

- `MANIFEST` (0) — canonical JHC JSON manifest
- `RAW_RESOURCE` (1) — a decoded resource file
- `SOURCE_MAP` (2) — source map
- `LICENSE` (3) — license text
- `SIGNATURE` (4) — detached ECDSA P-256 signature

## Canonical resources

Resources are stored as `RAW_RESOURCE` sections. The canonical resource order is
by the lexicographic order of the normalized UTF-8 path bytes. Each resource has
a corresponding entry in `manifest.resources` with `path`, `mime`, `id`, `hash`,
`representation`, and `decodedLength`.

## Root hash

The root hash is computed as:

```text
SHA-256(
  canonical manifest bytes
  || non-signature directory count (uint32 little-endian)
  || for each non-signature directory entry in order:
       sectionType (uint32) || logicalId (uint32) || decodedSha256 (32 bytes)
)
```

This binds the manifest, the ordered non-signature section metadata, and the
decoded content hashes without including stored offsets, compression, or the
signature section itself. Excluding the signature prevents a circular hash.

## Signature

A `SIGNATURE` section contains a detached ECDSA P-256 signature over:

```text
SHA-256(
  format major (uint8) || format minor (uint8)
  || root hash (32 bytes)
  || applicationId (UTF-8)
  || applicationVersion (UTF-8)
  || requiredFeatures (uint32 flags)
)
```

The signed manifest payload excludes the `signature` field itself.

ECDSA uses P-256 with SHA-256. Implementations pass the concatenated message
inside the `SHA-256(...)` expression to their ECDSA-SHA256 primitive exactly
once; they must not pre-hash it and then ask the primitive to hash it again.

## Required preflight and decode order

An install-capable implementation must complete structural preflight and
signature verification before decoding a codec section:

1. Enforce the stored package-size cap and fixed canonical offsets.
2. Parse only the bounded manifest and directory.
3. Reject unsupported flags/codecs, duplicate identities, out-of-bounds or
   overlapping ranges, resource-map mismatches, and non-canonical layouts.
4. Enforce per-section decoded-size, aggregate decoded-size, and expansion-ratio
   budgets from authenticated metadata.
5. Verify the publisher key fingerprint and ECDSA signature.
6. Decode sections, require exact decoded lengths, then verify decoded SHA-256.

The reference profile limits packages to 1 GiB stored, manifests and license
text to 4 MiB each, signatures to 16 KiB, resources to 50 MiB each, 10,000
resources, and 256 MiB aggregate decoded bytes. Codec expansion is limited to
256 times stored bytes plus 1 MiB slack. Unsigned packages may be inspected with
the same bounds but are not installable.

## Authenticated legal metadata

PRPKG v3 places its SPDX license expression, legal notice metadata, per-file
asset attestations, and optional license-text SHA-256 in the canonical manifest.
The `LICENSE` section carries the exact UTF-8 license text. Verifiers require
the section hash to match the signed directory and the text hash to match the
signed legal metadata. These records provide tamper evidence and attribution;
they do not replace the repository's authoritative license terms.

## Canonical identity

Two JHC1 packages have the same canonical content identity if and only if their
root hashes are identical. Their stored bytes may differ because codec bytes,
stored offsets, detached signatures, and transport wrappers are outside that
identity. Gzip, brotli, or other transport wrappers are applied outside the
container and must not affect package identity.
