<!--
SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
-->

# JHC / PRPKG security and compression plan

## Current completed baseline

| Area | Enforced result |
|------|-----------------|
| Parse safety | Canonical bounded preflight, safe offsets, section-count limits, no overlaps, exact resource map, per-section and aggregate decode budgets |
| Authentication | Publisher fingerprint and ECDSA P-256 signature verified before codec decode; decoded length and SHA-256 verified afterward |
| Install policy | Unsigned v3 packages are inspect-only; installs fail closed; consent fallback denies when no UI is available |
| Asset protection | Signed per-file SHA-256/license/creator/source attestations; signed legal metadata; exact hashed license section; SPDX 2.3 SBOM |
| Cross-language | Shared Python/JavaScript golden fixtures, signed fixture, canonical identity checks, and 16 malformed security cases |
| Dictionary transport | RFC 9842 `dcz` dictionary SHA-256 frame header, manifest hash metadata, exact-dictionary round-trip test |
| Adaptive codec | Offline deterministic decision tree, canonical SHA-256 policy envelope, advisory-only browser use, measured never-expand guard |
| PS boundary | PS is optional read-only training corpus input only; no server, route, service, checkpoint, or runtime dependency |

## Threat model and guarantees

The package pipeline detects modification, unlisted file attachment, publisher
key substitution, resource-map changes, attribution/license stripping inside a
package, malformed layouts, and declared decompression bombs. A valid signature
proves possession of a signing key; trust roots and publisher pinning decide
whether that key is authorized.

No browser-delivered asset system can be “hack proof.” A recipient who can render
or execute an asset can ultimately capture its decoded form. Licensing,
watermarking, C2PA references, access control, and signed audit records improve
deterrence, attribution, and evidence; they do not make copying impossible.

## Compression decision

The trained sample contained 77 text assets: TokenCodec won 26 and raw storage
won 51. The learned policy therefore saves build CPU by avoiding many losing
attempts, but it is not allowed to select larger output. For downloadable size,
solid transport compression (Brotli/Zstandard) and RFC 9842 deltas remain more
important than inventing browser-specific “bytecode.” JavaScript engine bytecode
is not a portable or stable distribution format.

## Next phases, in priority order

1. Add threshold-signed root/targets/snapshot/timestamp metadata with expiry,
   rollback/freeze protection, offline root keys, and explicit key rotation.
2. Produce signed SLSA provenance for release bundles and packages, including
   source revision, builder identity, materials, policy hash, and dictionary hash.
3. Add coverage-guided Python and browser fuzzing for header/directory/token
   decoder inputs; retain every crashing input in the shared malformed corpus.
4. Add C2PA manifest validation for media assets. The current attestation can
   bind a C2PA manifest hash but does not yet validate the full claim/signature.
5. Add release-key protection through non-exportable platform keys or an
   offline/HSM-backed signer. Never store release private keys in the repository.
6. Benchmark solid package compression and optional per-section standard codecs
   on representative packages. Admit a codec only when both runtimes have a
   bounded decoder and the complete signed artifact becomes smaller.
7. Evaluate adaptive policy on a held-out versioned corpus, track false-negative
   bytes and build-time savings, and promote a policy only when it is reproducible.
8. Make the 24/24 browser parity suite, 14/14 package suite, Python suites,
   bundler dry-run, SBOM/provenance checks, and scoped fuzz corpus release gates.

## Release acceptance criteria

- Every installable v3 artifact is signed and has a valid, authorized key path.
- Authentication occurs before expanding decode; all resource bytes match signed
  lengths and hashes; no unlisted path reaches storage or execution.
- SPDX/legal/asset attestations cover exactly the package file inventory.
- Adaptive policy and CDT dictionary hashes match signed release metadata.
- Full fallback artifacts remain available when dictionary negotiation fails.
- All Python and browser parity/security suites pass with zero failures.
