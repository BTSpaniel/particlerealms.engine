<!--
SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
-->

# JHC1 canonicalization

Canonicalization rules keep JHC1 packages deterministic and cross-language
identical.

## Resource paths

- Logical paths are canonical UTF-8 strings.
- Absolute paths, backslashes, empty segments, `.` / `..`, drive letters, NUL
  bytes, overlong UTF-8, invalid code points, and percent-encoded traversal are
  rejected.
- The canonical separator is `/`.
- Resource order is the lexicographic order of the normalized UTF-8 bytes.

## Manifest JSON

- Manifests use the JHC canonical JSON profile implemented identically by the
  JavaScript and Python runtimes:
  - Object keys are sorted by UTF-16 code units, matching ECMAScript
    `Array.prototype.sort()` with no comparator.
  - No insignificant whitespace.
  - Finite numbers use the ECMAScript `JSON.stringify` representation. Negative
    zero is serialized as `0`; non-finite numbers are rejected.
  - Printable ASCII remains literal and every non-ASCII UTF-16 code unit uses a
    lowercase `\\uXXXX` escape. Supplementary code points use a surrogate pair.
  - Object values cannot be `undefined`.
  - No trailing commas.
- The `signature` field is excluded from the signed manifest payload.
- No build timestamps are included in reproducible mode.

## Section ordering

- The directory is sorted by `sectionType` ascending, then `logicalId` ascending.
- `RAW_RESOURCE` sections follow the resource path order.

## Hashing

- SHA-256 is computed over decoded bytes, not stored bytes.
- The root hash binds the canonical manifest bytes and the ordered decoded
  section metadata.

## Deterministic build

- Input order, comments, and non-canonical formatting do not affect identity.
- Explicit provenance, SBOM, certificate, and lineage fields are canonical
  manifest data and therefore affect identity. Reproducible builds must omit or
  stabilize volatile values such as timestamps.
