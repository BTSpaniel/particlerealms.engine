---
title: M1B Public Shell and Access-Refinement Packages
description: Implemented M1B composition, exact public and sealed refinement package shapes, local evidence, cryptographic bindings, publication plans, rollback, and runtime boundaries.
audience: architects, implementers, security reviewers, protocol developers, and QA engineers
updated: 2026-08-28
status: implemented M1B boundary; M1C complete
---

# M1B Public Shell and Access-Refinement Packages

M1B implements two independent RealmForge audience jobs:

- A public-shell job that accepts only explicit public inputs and the shipped public-safe station kit.
- A capability-refined job that accepts only an exact authority-approved refinement projection, encrypts its payload bytes, and binds the result to a reverified public-shell socket.

Both jobs produce strict local verification packages, verify them before returning, and publish selected immutable artifacts through a terminal active-root compare-and-swap. They do not create a live Realm, scan a machine, connect SecureMesh, render a city, derive roads, move a Traveler, or deliver remote exact source.

## Product and presentation boundary

M1B is a RealmForge bake-and-publication milestone. It adds no camera, input controller, minimap, zone-management controller, live network connection, ICP route, multiplayer session, rendezvous, or bridge activation.

The connected Virtual Realm remains a grounded first-person experience. Cityform approach, station entry, Traveler locomotion, gates, bridges, and traversal are first-person only. The sole non-first-person presentation is the separately specified `owner-private + local-private` Operations View for the local operator's own Cityform. Its bounded local-isometric or local-eagle-eye view and minimap:

- Cannot name, load, display, pick, or traverse a connected Cityform.
- Cannot receive a remote shell, Traveler, bridge, rendezvous, or PresenceSession record.
- Cannot grant authority or mutate a zone.
- Emits only powerless local-zone proposals through the existing action-authority-observation chain.

The M1B package compilers and publishers have no port into that view.

## Flat composition and API

`RealmForgeBakeEntry` remains the application composition root. It lazily owns one internal `RealmAudienceBakeCoordinator` composition delegate and exposes six M1B methods. The delegate is implementation-local orchestration, not a separately started application, nested runtime root, global manager, scanner, renderer, or network service.

| API | Input or role | Result |
| --- | --- | --- |
| `compilePublicShell(input)` | Exact public projection, appearance, limits, run/profile labels, publisher, schedule, and lifetime | Verified 13-key local public package |
| `verifyPublicShell(compiledPackage)` | Candidate 13-key local public package | Revalidated frozen public package |
| `publishPublicShell({ compiledPackage, storage, expectedActiveRootId })` | Verified candidate plus immutable storage/root-CAS ports | Local publication receipt after terminal CAS |
| `compileAccessRefinement(input)` | Exact refinement projection and payloads, complete base public package, socket, authority intent, limits, crypto profile, publisher, and lifetime | Verified nine-key local sealed-refinement package |
| `verifyAccessRefinement(compiledPackage)` | Candidate nine-key local sealed-refinement package | Decrypted, cross-checked, revalidated frozen package |
| `publishAccessRefinement({ compiledPackage, storage, expectedActiveRootId })` | Verified sealed candidate plus immutable storage/root-CAS ports | Local publication receipt after terminal CAS |

`createRealmForgeBakeEntry()` receives explicit `signatureAdapter`, `refinementAuthorityAdapter`, and `encryptionAdapter` ports. Publication receives its storage port per invocation. No compiler locates a key, authority service, filesystem, network, renderer, or storage implementation through ambient state. (Source: `webgpu-os/apps/realmforge/virtual-realm/RealmForgeBakeEntry.js`; `webgpu-os/apps/realmforge/virtual-realm/RealmAudienceBakeCoordinator.js`.)

### Implemented modules

| Module | Single responsibility |
| --- | --- |
| `station/PublicSecureMeshShellKit.js` | Return the fixed, public-safe station archetype, HLOD, safe-text, gate, socket, protocol, and renderer data |
| `compilers/RealmPublicAppearanceCompiler.js` | Validate the public projection and caller-authored appearance, require the exact shipped kit, and compile public resources plus a semantic-scene digest |
| `compilers/RealmAudienceDependencyClosureCompiler.js` | Compile one exact audience-specific transitive resource closure |
| `compilers/RealmAudienceVisualBakeAssembler.js` | Assemble public or refinement `RealmVisualBakeManifestV1` data with Storylets explicitly absent |
| `compilers/RealmPublicShellCompiler.js` | Assemble and hash the hardened `PublicRealmShellManifestV1` |
| `compilers/RealmPublicNoninterferenceCompiler.js` | Compile the signed local two-run comparison receipt |
| `compilers/RealmRefinementScopeCompiler.js` | Require exact authority, scope, epoch, and payload membership before refinement compilation |
| `compilers/RealmAccessRefinementCompiler.js` | Canonicalize, seal, reopen, bind, sign, and package one access refinement |
| `publication/RealmPublicBakePackageVerifier.js` | Enforce exact public shape, closure, cross-record, digest, signature, limit, and local-evidence isolation rules |
| `publication/RealmRefinementBakePackageVerifier.js` | Enforce exact sealed shape, outer bindings, AAD, ciphertext, plaintext, closure, digest, signature, and scope rules |
| `publication/RealmAudiencePackagePublisher.js` | Build stripped audience artifact plans, verify immutable readback, and commit one active root by CAS |
| `RealmAudienceBakeCoordinator.js` | Order the flat peers without exposing them as a second application root |

## Public-shell compile API

`compilePublicShell()` rejects missing and unknown input keys. Its exact input is:

| Key | Requirement |
| --- | --- |
| `sourceProjection` | Valid `RealmAudienceSourceProjectionV1` with `variantKind: public-shell`, public audience, and public namespace |
| `publicAppearance` | Caller-authored valid `RealmPublicAppearanceSourceV1`; never derived from an owner-private bake |
| `resourceLimitProfile` | Valid public `RealmBakeResourceLimitProfileV1` bound by ID and digest |
| `determinismRunId` | Label used to derive the two distinct public run IDs |
| `privacyTestProfileId` | Profile ID recorded in local noninterference evidence |
| `publisherIdentity` | Must equal the Realm identity |
| `issuedAt`, `expiresAt` | Exact record and signature lifetime |
| `publicationScheduleId` | Must equal the appearance schedule and remain public-input controlled |

The method has no private bake, source snapshot, private document, filesystem root, capability token, live SecureMesh session, renderer, or cache input.

### Public-safe kit closure

The shipped kit contributes exactly four archetype records, two HLOD records, and three `RealmSafeTextV1` records. Its appearance also declares one public gate, one refinement socket, one protocol version, and one renderer compatibility profile. The appearance compiler requires exact equality with those kit references and safe-text values; a caller cannot smuggle an extra archetype, label, HLOD, script, URL, shader, path, or private reference through this path.

This is a deliberately small public station shell, not a complete public Cityform generator. `relationshipRecords` in the public projection remain validated and count-limited source records; M1B does not compile them into roads, rails, bridges, or networking state. (Source: `webgpu-os/apps/realmforge/virtual-realm/station/PublicSecureMeshShellKit.js`; `webgpu-os/apps/realmforge/virtual-realm/compilers/RealmPublicAppearanceCompiler.js`.)

### Public job order

1. Validate the exact public input and obtain a fresh public compiler context.
2. Compile appearance resources, dependency closure, visual manifest, and public-shell manifest for a baseline run.
3. Repeat the same compilation independently for a comparison run.
4. Canonical-compare appearance, resources, closure, visual manifest, shell manifest, and semantic-scene digest; reject any byte difference.
5. Compile an owner-private/local-private noninterference receipt with zero private reads, cross-audience cache hits, and forbidden reachability.
6. Sign and immediately verify the public appearance, visual manifest, shell manifest, noninterference receipt, and signed safe-text resources.
7. Assemble the exact package and pass it through the complete public verifier before returning.

The two runs use identical declared public inputs. The receipt is useful deterministic and structural isolation evidence, but it does not claim that the compiler mutated or observed a real private store between runs. (Source: `webgpu-os/apps/realmforge/virtual-realm/RealmAudienceBakeCoordinator.js`.)

## Exact public verification package

The public compiler and verifier accept exactly these keys:

```js
const PUBLIC_REALM_SHELL_PACKAGE_KEYS = Object.freeze([
  'format',
  'version',
  'audienceProjection',
  'publicAppearance',
  'resourceLimitProfile',
  'resources',
  'dependencyClosure',
  'visualManifest',
  'visualManifestDigest',
  'publicShellManifest',
  'publicShellManifestDigest',
  'noninterferenceReceipt',
  'signatureEnvelopes',
]);
```

`format` is `particle-realms.public-realm-shell-package@1`. Unknown or missing keys fail before deeper validation.

| Key | Binding |
| --- | --- |
| `audienceProjection` | Exact public source projection and disclosure boundary |
| `publicAppearance` | Exact caller-authored public appearance after shipped-kit validation |
| `resourceLimitProfile` | Count, depth, bytes, time, and cancellation ceilings used by the job |
| `resources` | Canonical public kit resources with exact content IDs and dependency refs |
| `dependencyClosure` | Sorted, duplicate-free, public-only transitive closure with exact totals |
| `visualManifest`, `visualManifestDigest` | Public visual bake root and independently recomputed self digest |
| `publicShellManifest`, `publicShellManifestDigest` | Hardened public root and independently recomputed self digest |
| `noninterferenceReceipt` | Signed owner-private/local-private local verification evidence |
| `signatureEnvelopes` | Canonically ordered signatures required by the appearance, safe text, visual manifest, shell, and local receipt |

This 13-key result is not directly transportable because it intentionally contains the local receipt and its signature. The verifier proves that neither local evidence ID is reachable from public resources, the visual manifest, the public shell, or their closure.

### Public verifier gates

The verifier rejects unless all of the following hold:

- Every record validates through its independently owned contract module.
- Every declared ID namespace, audience, disclosure, publisher, schedule, policy, layout, coordinate, renderer, limits, and lifetime field agrees across records.
- Every resource's canonical text and content ID agree.
- The closure contains exactly the reachable public resources, in canonical order, within declared budgets.
- Appearance transforms, material parameters, safe text, archetypes, HLODs, gates, sockets, and bounds agree exactly with the public shell and visual manifest.
- Appearance, visual-manifest, shell-manifest, and package digest sidecars recompute exactly.
- Every required signature envelope exists exactly once, has the correct audience and lifetime, and verifies through the injected adapter.
- The noninterference receipt reports `passed`, identical two-run outputs, and zero isolation violations.
- No owner-private, local-private, capability-refined, forbidden, or unlabeled record enters the public closure.

## Access-refinement compile API

`compileAccessRefinement()` rejects missing and unknown input keys. Its exact input is:

| Key | Requirement |
| --- | --- |
| `sourceProjection` | Valid capability-refined `RealmAudienceSourceProjectionV1` with exact audience, capability, scopes, and active epochs |
| `scopedResourcePayloads` | Exact payload set for the projection's granted resource records; no extra or missing ID |
| `basePublicShellPackage` | Complete 13-key public verification package, reverified before any refinement work |
| `refinementSocketId` | Socket declared by the reverified base public shell |
| `allowedActions`, `policyRevision`, `authorityReceiptRef` | Exact requested action set and authority context |
| `resourceLimitProfile` | Valid capability-refined limits bound into closure and manifest |
| `determinismRunId` | Diagnostic run label; M1B does not claim a second-run refinement proof |
| `privacyTestProfileId` | Profile ID recorded in the local scope receipt |
| `publisherIdentity` | Must equal the base shell's Realm publisher |
| `issuedAt`, `expiresAt` | Refinement lifetime, contained by authority expiry |
| `encryptionProfileId` | Supported refinement sealing profile |
| `keyGenerationRef`, `keyEpoch` | Injected key-generation identity and positive epoch |

The injected authority adapter must return an accepted result that exactly echoes the audience identity, capability ID, allowed actions, resource scopes, capability epoch, bridge epoch, authority receipt reference, and authority expiry. Mere proximity, a visible gate, a socket ID, or possession of a public shell grants nothing.

### Refinement job order

1. Reverify the complete base public package and require the requested socket in its public shell.
2. Ask the injected authority adapter to verify the exact audience, capability, actions, scopes, epochs, policy, and receipt.
3. Compile the scope only when supplied payload IDs exactly equal the capability-refined source projection; reject public, private, forbidden, unlabeled, stale, extra, and missing records.
4. Compile the capability-refined closure and visual manifest with Storylets explicitly absent.
5. Canonically encode the 14-key plaintext, bind its digest and context through authenticated data, and seal it with AES-GCM-256.
6. Open the ciphertext immediately with the same AAD and require a byte-identical plaintext round trip.
7. Build and sign the encryption envelope, access-refinement root, and local scope receipt.
8. Run the complete sealed verifier, including decryption and all inner cross-record checks, before returning.

## Exact sealed refinement verification package

The refinement compiler and verifier accept exactly these outer keys:

```js
const SEALED_ACCESS_REFINEMENT_PACKAGE_KEYS = Object.freeze([
  'format',
  'version',
  'accessRefinement',
  'accessRefinementDigest',
  'encryptionEnvelope',
  'signatureEnvelopes',
  'scopeReceipt',
  'authenticatedData',
  'authenticatedDataDigest',
]);
```

`format` is `particle-realms.sealed-access-refinement-package@1`. `encryptionEnvelope` is an exact two-key sidecar containing `record` and `ciphertextBytes`.

| Outer key | Binding |
| --- | --- |
| `accessRefinement`, `accessRefinementDigest` | Signed capability-refined root plus independently recomputed digest |
| `encryptionEnvelope.record` | Signed AES-GCM-256 metadata and every authority, scope, epoch, base-shell, closure, AAD, ciphertext, key, and lifetime binding |
| `encryptionEnvelope.ciphertextBytes` | Exact byte array matching the envelope locator, length, and digest |
| `signatureEnvelopes` | Exactly three outer signatures: encryption envelope, access root, and local scope receipt |
| `scopeReceipt` | Signed owner-private/local-private exact-scope evidence |
| `authenticatedData`, `authenticatedDataDigest` | Explicit local AAD object and its exact digest, both matched to the envelope and access root |

The decrypted canonical plaintext accepts exactly these keys:

```js
const ACCESS_REFINEMENT_PLAINTEXT_KEYS = Object.freeze([
  'format',
  'version',
  'audienceProjection',
  'resourceLimitProfile',
  'resources',
  'dependencyClosure',
  'visualManifest',
  'visualManifestDigest',
  'semanticSceneDigest',
  'basePublicShellId',
  'basePublicShellDigest',
  'refinementSocketId',
  'authorityContext',
  'signatureEnvelopes',
]);
```

The plaintext format is `particle-realms.access-refinement-plaintext@1`. Its one inner signature authenticates the capability-refined visual manifest. The verifier recomputes every resource content ID, closure digest, visual-manifest digest, and semantic-scene digest after decryption.

## Encryption and authenticated-data boundary

M1B fixes the record algorithm to AES-GCM-256, a 96-bit IV encoded as 16 base64url characters, and a 16-byte authentication tag. The authenticated data binds, at minimum:

- Base public shell ID, digest, and appearance revision.
- Refinement socket, Realm identity, and refinement audience identity.
- Capability ID, canonical allowed actions, canonical resource scopes, capability epoch, and bridge epoch.
- Authority receipt identity/digest and policy revision.
- Source projection ID/digest and disclosure policy.
- Refinement bake and dependency-closure identities/digests.
- Encryption profile, key generation, key epoch, nonce receipt, lifetime, and publisher.

Only the refinement payload bytes are encrypted. Outer envelope and access-root metadata still reveal audience identity, actions, resource scopes, epochs, policy references, locators, lengths, and binding digests to the scoped publication store. M1B makes no anonymity or network-wide traffic-flow confidentiality claim.

The cryptographic adapters are explicit trust boundaries:

- The encryption adapter owns key lookup, key availability, seal/open behavior, and nonce policy.
- The signature adapter owns key resolution and cryptographic signing/verification.
- Key distribution, durable nonce allocation, rotation, revocation, hardware protection, PKI, and long-term trust policy remain outside the compiler.
- The included default encryption adapter detects nonce reuse only for its in-memory adapter lifetime; a production key authority must provide durable uniqueness across restarts and processes.

## Local evidence is not publication content

The compiler return values are designed for local verification and therefore include local evidence. They must not be serialized wholesale to a transport or content store.

| Local evidence | Present in compiler/verifier package | Present in immutable publication artifacts |
| --- | --- | --- |
| Public noninterference receipt | Yes | No |
| Public noninterference signature | Yes | No |
| Refinement scope receipt | Yes | No |
| Refinement scope-receipt signature | Yes | No |
| Explicit refinement authenticated-data record | Yes | No |
| Decrypted refinement plaintext | Only transiently inside compile/verify | No |
| Publication receipt returned by `publish*()` | Returned locally after successful CAS | No |

The current code has no audited load/reassembly API proving that an active root by itself reconstructs either complete local verification package. Publication is an immutable storage boundary, not a claim of SecureMesh, ICP, CDN, or multiplayer delivery.

## Exact publication plans

### Public artifacts

`publishPublicShell()` reverifies the local package, then proposes these immutable artifacts in order:

1. Every public resource canonical text, keyed by resource ID.
2. The public dependency closure, keyed by closure ID.
3. The public visual manifest, keyed by bake ID.
4. Every package signature except the local noninterference-receipt signature, keyed by envelope ID.
5. The public shell manifest, keyed by manifest ID.

It does not write `audienceProjection`, `publicAppearance`, `resourceLimitProfile`, `noninterferenceReceipt`, the noninterference signature, or the publication receipt. The public scope key is `public:<realmIdentity>`, and the candidate active root is the public shell manifest ID.

### Refinement artifacts

`publishAccessRefinement()` reverifies and decrypts the local package, then proposes these immutable artifacts in order:

1. Ciphertext bytes, keyed by the opaque locator.
2. The refinement encryption-envelope record, keyed by envelope ID.
3. The access-root and envelope signatures, excluding the local scope-receipt signature.
4. The `RealmAccessRefinementV1` root, keyed by refinement ID.

It does not write refinement plaintext, explicit authenticated data, the scope receipt, the scope-receipt signature, or the publication receipt. The scope key is content-derived from Realm identity, audience identity, capability ID, capability epoch, and bridge epoch. The candidate active root is the access-refinement ID. (Source: `webgpu-os/apps/realmforge/virtual-realm/publication/RealmAudiencePackagePublisher.js`.)

## Publication transaction and rollback

Both publishers require an injected storage object with four functions:

| Method | Contract |
| --- | --- |
| `writeImmutable(artifactId, value)` | Persist one canonical text record or copied ciphertext byte array without overwriting different content |
| `readImmutable(artifactId)` | Read the exact stored value for immediate byte comparison |
| `readActiveRoot(scopeKey)` | Return the currently selected root ID or `null` |
| `compareAndSwapActiveRoot(scopeKey, expectedRootId, candidateRootId)` | Select the candidate only when the current root still equals the expected root and return `true` on success |

The publisher does not supply or discover these implementations.

The transaction order is fixed:

1. Verify the complete local package.
2. Build the stripped publication plan.
3. Read the current root and require exact equality with `expectedActiveRootId`.
4. Write each immutable artifact and immediately read it back.
5. Require byte equality for binary ciphertext or canonical-byte equality for text records.
6. Reverify the candidate package.
7. Construct the local publication receipt.
8. Perform one terminal `compareAndSwapActiveRoot(scopeKey, expectedActiveRootId, candidateRootId)`.
9. Return the receipt only after the CAS reports success.

Any error before or during CAS leaves the previously selected active root unchanged. Immutable artifacts written before failure may remain as unreachable content-addressed objects. M1B guarantees root-pointer atomicity; it does not delete or mutate staged immutable objects as rollback.

## Contract inventory

The ordered Virtual Realm catalog contains 107 independently owned flat contract modules:

- 100 accepted M0 modules.
- Three M1A additions: `RealmBakeResourceLimitProfileContract`, `RealmProofGatedOptimizationReceiptContract`, and `LocalOperationsLookupResourceContract`.
- Four M1B additions: `RealmPublicAppearanceSourceContract`, `RealmRefinementEncryptionEnvelopeContract`, `RealmPublicNoninterferenceReceiptContract`, and `RealmRefinementScopeReceiptContract`.

M1B hardens the existing `PublicRealmShellManifestContract` and `RealmAccessRefinementContract` composition without nesting the new records inside them. Each record retains its own format, self digest, validator, signature-envelope reference where applicable, and catalog entry. (Source: `webgpu-os/apps/the-virtual-realm/contracts/VirtualRealmContractCatalog.js`.)

## Implemented and deferred

| Capability | M1B status |
| --- | --- |
| Fixed public-safe station kit | Implemented |
| Caller-authored public appearance validation | Implemented |
| Exact public closure, visual manifest, shell root, digests, and signatures | Implemented |
| Two-run public canonical comparison and local noninterference receipt | Implemented with the documented evidence limitation |
| Capability/authority/scope/epoch-bound refinement compilation | Implemented |
| AES-GCM-256 sealing, immediate open round trip, signed envelope, and local scope receipt | Implemented through injected adapters |
| Exact public and sealed-refinement verification | Implemented |
| Stripped immutable artifact plans and active-root CAS | Implemented through injected storage ports |
| Live SecureMesh, ICP, networking, multiplayer, rendezvous, or bridge activation | Deferred |
| Complete public Cityform generation and relationship-to-road compilation | Deferred |
| Runtime loading or reconstruction from published roots | Deferred |
| First-person rendering and traversal | Separate runtime milestone |
| Owner-only local Operations View and minimap | Separate local-runtime boundary; never an M1B publication surface |
| Remote private-interior rendering or exact-source delivery into Code Matter | Deferred |
| Durable nonce service, key distribution, rotation, revocation, and PKI | External production integration |
| Storylet compilation in public or refinement M1B visual manifests | Absent by contract in this slice |

## See also

- [Implementation roadmap](implementation-roadmap.md)
- [RealmForge bake pipeline](realmforge-pipeline.md)
- [Architecture and ownership](architecture.md)
- [Contract catalog](contracts.md)
- [Security and privacy](security-privacy.md)
- [M1A owner-private SecureMesh station bake](m1a-private-securemesh-bake.md)
- [Local City Operations View](local-operator-view.md)
