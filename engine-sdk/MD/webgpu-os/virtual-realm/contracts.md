---
title: Virtual Realm Contract Catalog
description: Versioned data contracts, canonicalization rules, audience boundaries, authority receipts, and state records for The Virtual Realm.
audience: architects, implementers, protocol developers, security reviewers, and QA engineers
updated: 2026-09-05
status: M0-M1C product baseline and 109-contract inventory verified; M2A, admission-only M2B, provider-free M2D-B4A through M2D-B4F runtime wires, and M2D-B4G terminal compatibility accepted; B4H has an explicit host-attempt binding transport prerequisite, while the genuine authority provider and integrated M2 remain unaccepted; M3A and M3B remain executable blueprints; RF-GE0-RF-GE5 accepted as inert authoring evidence; RF-GE6 planned
---

# Virtual Realm Contract Catalog

The Virtual Realm communicates through immutable, versioned records. This page is the normative V1 contract inventory. It fixes ownership, required fields, validation order, audience boundaries, and the difference between a proposal, an authorized operation, and observed truth.

The contract names describe separate modules. They must not be collapsed into a single nested schema or a global `RealmContracts` object.

## Common record rules

Every V1 record follows these rules:

1. `format` is an exact namespaced discriminator such as `particle-realms.realm-observation`.
2. `version` is an explicit semantic contract version. Unknown major versions fail closed.
3. Unknown keys are rejected unless the contract declares a bounded `extensions` map with registered namespaced keys.
4. Required fields cannot be recovered from defaults after signing or hashing.
5. Arrays have contract-specific count limits, deterministic ordering, and duplicate rules.
6. Text has byte limits, Unicode normalization rules, and control-character restrictions.
7. Numbers are finite. NaN, Infinity, negative zero where semantically ambiguous, unsafe integers, and out-of-range values fail.
8. Spatial units are metres in a right-handed Realm coordinate system. Angles are radians. Durations use logical ticks unless a protocol envelope explicitly requires wall-clock expiry.
9. Runtime object references are stable opaque IDs, never JavaScript object pointers, filesystem handles, renderer resources, capabilities, or secrets.
10. Protected and public identities use different namespaces. A public ID cannot be joined to a private ID without an authorized local mapping.
11. Hashes use domain-separated canonical bytes and identify content. An unkeyed content hash is not an identity signature or an authority grant. Plaintext-derived protected hashes remain inside the authorized envelope; transported protected records use audience-scoped opaque locators or keyed identifiers.
12. Signed records bind the format, version, publisher identity, audience, policy revision, content digest, issue time, expiry, and replay nonce where applicable.
13. Validation occurs before allocation of unbounded CPU, GPU, storage, decompression, parsing, shader, audio, or network work.
14. Records are deep-frozen at trust boundaries and are never mutated after acceptance.

### Conditional scope fields

Scope-bound fields are required exactly when their scope is active and otherwise must be absent, not `null`, an empty string, or zero:

- `capabilityEpoch` is required when a record depends on a revocable capability.
- `presenceSessionEpoch` is required for authenticated Traveler presence and station-scoped pose state.
- `rendezvousFrameId` and `rendezvousEpoch` are required while a record belongs to an active approach or rendezvous.
- `bridgeEpoch` is required while a record belongs to a bridge, bridge-shared Storylet, bridge refinement, protected bridge route, or bridge-scoped reveal.
- `coordinatorLeaseId` and `coordinatorTerm` are required for synchronized shared Storylets.
- Local authored, local observation, local presentation, local-private Storylet, local inspection, and V1 local Code Matter reveal records omit bridge and rendezvous fields unless they actually enter those scopes.

## Canonical encoding

Canonical semantic encoding is deterministic across supported implementations:

- Object keys sort by Unicode code point after required normalization.
- Arrays retain their declared semantic order or sort by the contract's explicit key.
- Strings encode as UTF-8.
- Integers encode without leading zeroes.
- Floating-point fields use the contract's fixed quantization before encoding.
- Optional fields are either absent or present with a meaningful value. `undefined`, implicit defaults, and ambiguous `null` values are forbidden.
- Binary content is referenced through bounded descriptors and content IDs rather than embedded in ordinary JSON.
- The domain string, contract major version, canonical byte length, and canonical bytes enter every content digest.

The exact canonical encoder and numeric policy are frozen in milestone M0 and included by identity in every bake, bridge, Storylet, and Chronicle digest.

### Digest and signature envelope

Content records form an acyclic graph. A record's canonical payload excludes its own content-ID field, digest field, signature field, and transport-envelope fields. References may point only to content whose digest is already known.

```text
contentPreimage = lengthPrefix(domain)
                || lengthPrefix(format)
                || uint32be(majorVersion)
                || uint64be(canonicalPayloadByteLength)
                || canonicalPayloadBytes

contentDigest = SHA-256(contentPreimage)

signaturePreimage = lengthPrefix("particle-realms.signature.v1")
                  || lengthPrefix(format)
                  || uint32be(majorVersion)
                  || lengthPrefix(publisherIdentity)
                  || lengthPrefix(audienceClass)
                  || lengthPrefix(policyRevisionOrEmpty)
                  || uint64be(issuedAtMilliseconds)
                  || uint64be(expiresAtMillisecondsOrZero)
                  || lengthPrefix(operationNonceOrEmpty)
                  || contentDigest
```

`lengthPrefix` is an unsigned 64-bit big-endian byte length followed by the bytes. Identity and string fields use their contract-normalized UTF-8 bytes. The signing algorithm and key identity come from the bound Realm Passport or platform signing profile and are carried in a separate `SignatureEnvelopeV1`. A signature authenticates the exact digest and context; it is never included while computing that digest.

`contentId` or a public manifest ID is the namespaced multicodec representation of `contentDigest`. Protected records use the audience-scoped opaque or keyed identifiers specified by their envelope instead. A record cannot directly or transitively reference itself. Validators reject dependency cycles before publication.

### `SignatureEnvelopeV1`

The signature envelope is computed only after the referenced content digest exists. It is transported beside the content record and never becomes part of that record's canonical payload.

| Field | Requirement |
| --- | --- |
| `envelopeId` | Domain-separated identifier computed from the envelope payload with its own ID and signature bytes excluded |
| `contentFormat`, `contentVersion`, `contentDigest` | Exact immutable record being authenticated |
| `publisherIdentity`, `keyId`, `algorithm` | Verified signer and registered signing profile |
| `audienceClass`, `policyRevision` | Exact disclosure and policy context; policy revision is absent only where the content contract declares no policy binding |
| `issuedAt`, `expiresAt` | Signed protocol times; non-expiring content uses the contract's explicit zero-expiry rule |
| `operationNonce` | Non-reusable nonce when the signed record can cause an operation; otherwise absent |
| `signatureBytes` | Signature over the exact `signaturePreimage` above |

Envelope validation verifies the content digest before signature work, verifies the signer and algorithm against the bound identity profile, checks audience, policy, lifetime, nonce, and revocation state, and then verifies the signature. A valid signature proves publisher authenticity and payload integrity; it does not grant a capability or authorize an action.

Every `signatureEnvelopeId`, `authoritySignatureEnvelopeId`, `participantSignatureEnvelopeIds`, or equivalent field named below is transport-side envelope metadata. It is excluded from the authenticated content record's canonical payload and dependency graph, because the envelope can exist only after the content digest. Multi-party records carry a canonical signer-identity set in their content payload and one external envelope per required signer; validators match the envelope publishers to that exact set.

## Common enums

### `AudienceClassV1`

- `owner-private`
- `public-explicit`
- `capability-refined`
- `rendezvous-shared`
- `bridge-shared`
- `replay-local`
- `construct-preview`

### `DisclosureClassV1`

- `local-private`
- `public-explicit`
- `capability-refined`
- `forbidden-export`
- `construct-only`
- `historical-reference`

### `ProvenanceClassV1`

- `authored`
- `observed`
- `derived`
- `construct`

### `EvidenceQualityV1`

- `exact`
- `measured`
- `computed`
- `estimated`
- `unknown`
- `not-applicable`

### `AvailabilityStateV1`

- `available`
- `sealed`
- `denied`
- `partial`
- `absent`

### `FreshnessStateV1`

- `current`
- `stale`
- `expired`
- `unknown`

### `TemporalModeV1`

- `live`
- `historical`
- `preview`

### `AssertionStateV1`

- `confirmed`
- `proposed`
- `hypothetical`

These six axes are mandatory together on factual and presentation records. They remain independent so, for example, a record can be observed, exact, available, stale, live, and confirmed as a receipt-backed last-known value, or observed, exact, sealed, current, historical, and confirmed without collapsing meaning into one state. `confirmed` means authority or receipt-backed at the cited observation time; freshness states whether that evidence is current now.

### `ResourceReferenceV1`

| Field | Requirement |
| --- | --- |
| `resourceId` | Stable ID in the current audience namespace |
| `resourceKind` | Registered exact discriminator |
| `contentId` | Public domain-separated digest for public content, or an audience-scoped opaque or keyed identifier for protected content |
| `audienceClass` | Audience allowed to resolve the record |
| `byteLength` | Exact bounded encoded length |
| `mediaType` | Registered media type, not an execution hint |
| `dependencies` | Canonically ordered direct resource IDs |

### `RealmSafeTextV1`

All remotely supplied or shared human-readable text uses one non-executable contract.

| Field | Requirement |
| --- | --- |
| `textId` | Audience-scoped content ID |
| `purpose` | City name, Traveler name, station label, destination, caption, announcement, or registered safe purpose |
| `audienceClass` | Exact audience |
| `languageTag` | Valid bounded BCP 47 tag or explicit `und` |
| `direction` | `ltr`, `rtl`, or `auto`; direction is metadata rather than embedded control text |
| `text` | Well-formed UTF-8 normalized to NFC |
| `byteLength`, `graphemeCount` | Exact values within the purpose-specific limit |
| `publisherIdentity` | Identity responsible for remote text where applicable |
| `textDigest` | Canonical audience-safe digest |

The validator rejects NUL, disallowed controls, unpaired surrogates, bidi override and isolate control characters inside the payload, HTML, Markdown, CSS, script, URL interpretation, and purpose-incompatible line breaks. Rendering treats the value only as text: DOM surfaces use `textContent`, GPU text uses shaped glyph data, and the semantic mirror escapes it. RTL content uses an outer isolation boundary controlled by `direction`.

International text is not reduced to ASCII. Anti-spoof presentation displays the verified identity badge or short fingerprint separately from a remote display name, preserves script-aware shaping, limits mixed-script identifier-like names by policy, and never treats a visually confusable name as identity proof.

## Source and coverage contracts

### `RealmScanScopeV1`

`RealmScanScopeV1` is compiled and verified before any scanner enumerates, stats, resolves content, opens, hashes, watches, or previews a source object.

| Field | Requirement |
| --- | --- |
| `scanScopeId` | Local authority-bound scan policy ID |
| `authorityReceiptRef` | Operator and kernel grant evidence |
| `allowRootHandles` | Explicit granted VFS, repository, or browser-mount root handles |
| `hardDenySubtreeHandles` | Opaque local handles for forbidden subtrees; no names enter Realm logs or receipts |
| `canonicalizationPolicyId` | Exact platform and adapter canonical path policy |
| `linkPolicy` | No-follow by default; any followed link must resolve and recheck inside an allowed non-denied root |
| `operationPolicy` | Separate permissions for enumerate, stat, metadata, content, hash, watch, and preview |
| `resourceLimitProfileId` | Depth, count, byte, time, queue, and cancellation ceilings |
| `scopeGeneration`, `issuedAt`, `expiresAt` | Freshness and revocation |
| `scopeDigest` | Private canonical digest |

The scanner resolves identity and containment using the source adapter's canonical object handles, not string prefix tests. It checks hard-deny ancestry before every directory enumeration, child stat, content open, hash, watch registration, symlink or reparse traversal, preview, and retry. A denied subtree yields one opaque omission class at its parent boundary and is never enumerated to discover its contents. If canonical identity, containment, link target, or deny ancestry cannot be proven, the operation fails closed before access.

The scope itself remains local and private. Diagnostics use opaque policy and reason IDs and never log a forbidden path or name. Tests use synthetic decoy directories and handles only; certification never opens or scans an actually excluded application.

### `RealmSourceSnapshotV1`

This is the immutable authorized compiler input. It remains local unless a separately classified derivative is published.

| Field | Requirement |
| --- | --- |
| `format`, `version` | Exact source-snapshot contract identity |
| `snapshotId` | Content-derived local identifier |
| `realmId` | Owning Realm identity |
| `sourceAuthority` | Adapter and authority receipt reference |
| `scanScopeId`, `scanScopeGeneration` | Exact pre-enumeration policy used for every source read |
| `audienceClass` | `owner-private` for V1 source scans |
| `rootIds` | Canonically ordered granted roots and mounts |
| `adapterVersions` | Exact identity of every scanner and normalizer |
| `sourceGenerations` | VFS, mount, repository, or service generations observed |
| `resourceRecords` | Bounded normalized source entities |
| `relationshipRecords` | Bounded typed relationships among source entities |
| `coverageReceiptId` | Exact `RealmCoverageReceiptV1` reference |
| `capturedAt` | Local audit timestamp |
| `snapshotDigest` | Domain-separated canonical digest |

The snapshot contains no renderer object, RealmForge session object, browser file handle, live capability token, or executable callback.

### `RealmCoverageReceiptV1`

| Field | Requirement |
| --- | --- |
| `receiptId` | Stable receipt ID |
| `requestId` | Scan request identity |
| `scanScopeId`, `scanScopeGeneration` | Exact verified scope |
| `requestedRootIds` | Roots and mounts requested by the operator |
| `grantedRootIds` | Roots actually scanned |
| `deniedRootIds` | Opaque denied roots visible to this audience |
| `omissionClasses` | Reasons for exclusions without leaking protected names |
| `startedAt`, `completedAt` | Local audit times |
| `resourceLimitProfileId` | Count, depth, byte, time, and cancellation limits |
| `resourceCount`, `relationshipCount` | Exact counts for the private receipt |
| `truncated`, `cancelled`, `partial` | Explicit completion state |
| `freshness` | Source generations and staleness rules |
| `evidenceQualityByDomain` | Per-domain `EvidenceQualityV1` classification: exact, measured, computed, estimated, unknown, or not-applicable |
| `adapterVersions` | Exact scanner identities |
| `receiptDigest` | Canonical digest |

### `RealmAudienceSourceProjectionV1`

This is the sole source accepted by one audience-specific bake job. It is created before topology or visual compilation.

| Field | Requirement |
| --- | --- |
| `projectionId` | Audience-specific canonical projection ID |
| `realmId` | Owning Realm identity |
| `variantKind` | `private`, `public-shell`, or `access-refinement` |
| `audienceClass`, `audienceIdentity` | Exact permitted audience; identity is absent only for public output |
| `sourceProviderId`, `sourceProviderVersion` | Exact independently authorized provider |
| `sourceProjectionRevision` | Audience-local immutable revision |
| `disclosurePolicyDigest` | Policy applied before any compiler runs |
| `idNamespace` | Private, public, or audience-refinement namespace |
| `resourceRecords`, `relationshipRecords` | Bounded already classified compiler inputs |
| `shippedPublicResourceRefs` | Optional safe application-shipped inputs |
| `capabilityId`, `resourceScopes` | Required only for refinement projection |
| `capabilityEpoch`, `bridgeEpoch`, `expiresAt` | Capability and bridge epochs required for a bridge-scoped protected projection; a future non-bridge refinement scope must use its separately defined active epoch and omit `bridgeEpoch` |
| `resourceLimitProfileId` | Compiler input limits |
| `authorityReceiptRef` | Proof that this provider may project this source for this audience |
| `projectionDigest` | Audience-safe canonical digest |

The public provider accepts only an explicit public appearance document, shipped public archetypes, public identity inputs, and public policy. It cannot accept or reference a private snapshot, private document revision, private digest, private ID, private count, or private timing. A refinement provider receives only the exact granted scope, never the remainder of the private projection. No compiler intermediate or cache key crosses these jobs unless it references an identical shipped public resource.

## Topology contracts

### `RealmSpatialLayoutPolicyV1`

| Field | Requirement |
| --- | --- |
| `layoutPolicyId`, `layoutPolicyVersion` | Exact deterministic spatial policy identity |
| `coordinatePolicyId`, `numericPolicyId` | Units, axes, integer grid, quantization, and overflow rules |
| `rootSpinePolicy` | Origin, axis, landmark cells, alternating territory bands, and fixed clearances |
| `weightPolicy` | Bucketed descendant, size, importance, and minimum-area weights by audience class |
| `orderingPolicy` | Stable audience-ID ordering and tie-break rules |
| `subdivisionPolicy` | Fixed-point slice-and-dice axis, split, padding, and minimum parcel rules |
| `growthPolicy` | Reserved cell and slack schedule plus localized-repack ceiling |
| `hlodPolicy` | Depth, count, distance, aggregation, and expansion thresholds |
| `routePolicy` | Relationship layers, routing grid, canonical neighbor order, costs, search bounds, and aggregation |
| `clearancePolicy` | Road, rail, building, socket, conduit, vertical, and junction constraints |
| `incrementalPolicy` | Anchor preservation, rename and move semantics, smallest-repack ancestor, and geography-epoch rules |
| `compilerIdentity` | Exact implementation identity |
| `policyDigest` | Canonical policy digest |

### `RealmSpatialLayoutReceiptV1`

Fields: audience source projection ID, layout-policy ID, topology node and edge counts, Root Spine and landmark records, stable node-to-cell and node-to-anchor map digest, reserved-growth map digest, HLOD cluster digest, relationship-route digest, omitted optional-route receipts, relocation set from the prior geography epoch, collision, navigation, streaming, occlusion, socket and audio output digests, numeric overflow status, layout digest, compiler identity, and external `signatureEnvelopeId` where transported.

### `RealmBakeResourceLimitProfileV1`

This contract binds profile and counting-policy versions, exact `fail-closed-before-allocation` enforcement, and closed positive ceilings for canonical bytes, source and topology counts, manifest resources, dependency depth, per-resource and total bytes, each typed static-resource family, Storylet definitions, Storylet states, Storylet transitions, Storylet proposal templates, Storylet dependency references, local-operations cells/anchors/zones/routes/landmarks/HLOD, and deterministic compiler work. One resource cannot exceed the total bake ceiling, typed-resource counts cannot exceed the manifest ceiling, and the topology-node ceiling cannot exceed accepted source resources.

### `RealmTopologyNodeV1`

| Field | Requirement |
| --- | --- |
| `nodeId` | Stable ID in the bake audience namespace |
| `nodeKind` | Root, territory, district, structure, file, service, process-anchor, station, gate, socket, or registered extension |
| `sourceRef` | Audience-valid source reference or authored semantic reference |
| `parentId` | Optional containment edge shortcut; never object ownership |
| `semanticRole` | Projection and interaction role |
| `provenanceClass`, `evidenceQuality` | Source lineage and claim quality |
| `availabilityState`, `freshnessState`, `temporalMode`, `assertionState` | Access, freshness, time context, and confirmation status |
| `disclosureClass` | Export policy |
| `anchorId` | Stable spatial anchor reference |
| `tags` | Bounded registered semantic tags |
| `nodeDigest` | Canonical node digest |

### `RealmTopologyEdgeV1`

| Field | Requirement |
| --- | --- |
| `edgeId` | Stable content-derived edge ID |
| `edgeKind` | Contains, imports, depends-on, invokes, emits, listens, mounts, routes-to, guarded-by, attaches-to, or registered extension |
| `fromNodeId`, `toNodeId` | Existing nodes in the same allowed audience closure |
| `direction` | Directed, reverse-directed, or symmetric as defined by `edgeKind` |
| `weightClass` | Quantized authored or derived presentation weight |
| `provenanceClass`, `evidenceQuality` | Source lineage and claim quality |
| `availabilityState`, `freshnessState`, `temporalMode`, `assertionState` | Access, freshness, time context, and confirmation status |
| `disclosureClass` | Audience classification |
| `sourceRefs` | Canonically ordered evidence references |
| `edgeDigest` | Canonical edge digest |

Self-edges, duplicate semantic edges, ambiguous ownership cycles, unresolved endpoints, and cross-audience references fail unless the edge kind explicitly permits them.

## Authored visual contracts

Visual records remain flat and independently addressable:

- `RealmGeometryResourceV1`
- `RealmMaterialBindingV1`
- `RealmLightingIntentV1`
- `RealmCollisionResourceV1`
- `RealmNavigationResourceV1`
- `RealmSocketResourceV1`
- `RealmLodResourceV1`
- `RealmProjectionBindingV1`
- `RealmGlyphStyleV1`
- `RealmAudioZoneV1`

Every visual resource includes `resourceId`, `resourceKind`, `contentId`, `audienceClass`, `disclosureClass`, `sourceAnchorIds`, `bounds`, `dependencyIds`, compiler identity, numeric-policy identity, and bounded payload descriptors. No record contains a WebGPU object, shader source from a remote publisher, filesystem handle, URL, executable expression, or mutable authoring handle.

### `RealmVisualBakeManifestV1`

| Field | Requirement |
| --- | --- |
| `format`, `version` | Exact bake-root identity |
| `bakeId` | Domain-separated canonical content ID |
| `realmId` | Publishing Realm identity |
| `variantKind` | `private`, `public-shell`, or `access-refinement` |
| `audienceClass` | Exact audience |
| `sourceProjectionRevision` | Audience-specific immutable compiler-input revision |
| `sourceProjectionDigest` | Digest of the already classified audience input, never a private-document digest in a transported variant |
| `topologyRootId` | Audience-specific topology root |
| `disclosurePolicyDigest` | Policy used before assembly |
| `compilerIdentities` | Exact topology, geometry, material, collision, navigation, glyph, socket, LOD, Storylet, and closure compilers |
| `numericPolicyId` | Coordinate and quantization policy |
| `spatialLayoutPolicyId`, `spatialLayoutReceiptId` | Exact deterministic geography and output evidence |
| `coordinatePolicy` | Units, axes, origin, and precision |
| `rendererCompatibility` | Required safe shipped features and limits profile |
| `resourceRefs` | Canonically ordered full closure |
| `safeTextRefs` | Canonically ordered `RealmSafeTextV1` City name, station, destination, and public-sign references inside the same audience closure |
| `dependencyClosureId` | Exact closure record |
| `storyletCatalogId`, `storyletCatalogAbsent` | Exactly one is present: the previously computed audience-specific catalog for Storylet-bearing packages or `storyletCatalogAbsent: true` for legacy packages |
| `issuedAt`, `expiresAt` | Required for transported variants |
| `publisherIdentity`, `signatureEnvelopeId` | Publisher is canonical content context; the external envelope is required for public and refinement variants |

The private bake receipt may retain a local reference to the exact `.proasset` revision. Public and refinement manifests cannot reveal that private revision or change merely because private-only document content changed. `RealmBakeReceiptV1` is external evidence produced after the manifest digest exists and is not part of manifest identity.

### `RealmDependencyClosureV1`

| Field | Requirement |
| --- | --- |
| `closureId` | Canonical closure digest |
| `rootResourceIds` | Direct resource roots intended for the later manifest; excludes the manifest and this closure record |
| `audienceClass` | One exact audience |
| `entries` | Sorted resource ID, kind, content ID, byte length, disclosure class, and direct dependencies |
| `totalBytes`, `resourceCount`, `maximumDepth` | Verified bounded totals |
| `unresolvedCount` | Must equal zero for publication |
| `closureDigest` | Digest including compiler and policy identities |

Each artifact variant has its own independently computed closure. A private closure can never be filtered into a public closure after compilation.

### `RealmBakeReceiptV1`

The validation receipt binds the already computed output manifest ID and digest, source projection digest, compiler identities, dependency result, determinism run ID, privacy-test profile, compatibility checks, warnings, rejection reasons, publisher identity, and external `signatureEnvelopeId`. A Storylet-bearing M1C receipt additionally carries the all-or-none `stationKitId`, `stationKitContentId`, `storyletCatalogValidationReceiptId`, and canonical `authoringEvidenceIds` fields. A receipt is external evidence about a build. The manifest never points back to this receipt, so the content graph remains acyclic. The receipt is not runtime authority.

### `RealmProofGatedOptimizationReceiptV1`

This M1A contract binds compiler and optimizer identity, algebra and operand shape, numeric and reducer policies, target kind, required laws, proof obligations, checked bounds, law and counterexample evidence, immutable-plan digest, CPU and WGSL parity, baseline and selected semantic digests, operation counts, and the gate decision. Any missing or failed obligation selects `baseline-fallback`; selected semantics must remain the accepted baseline semantics. The receipt grants no authority and remains external to the bake content DAG.

## Topology revision and bake activation contracts

### `RealmTopologyChangeSetV1`

| Field | Requirement |
| --- | --- |
| `changeSetId` | Canonical structural-change ID |
| `realmId`, `variantKind`, `audienceClass` | Exact affected local artifact context |
| `sourceAdapterId`, `sourceSchemaVersion` | Authoritative source identity |
| `fromGeneration`, `toGeneration` | Monotonic source-generation range |
| `firstSourceSequence`, `lastSourceSequence` | Closed ordered observation interval |
| `changeKinds` | Bounded create, remove, move, mount, relationship, or authored-public-input classes |
| `affectedOpaqueIds` | Audience-valid bounded subject set |
| `coverageReceiptId` | Current scan and omission evidence |
| `coalescingPolicyId`, `logicalReadyTick` | Deterministic debounce and build-request boundary |
| `changeSetDigest` | Canonical digest |

The private topology detector never emits a public change set. Public shell topology changes originate only from an explicit public appearance revision.

### `RealmBakeRequestV1`

Fields: request ID, Realm ID, variant kind, audience class and identity, current bake ID, topology change-set IDs, requested source generations and watermarks, source-provider ID, disclosure-policy digest, compiler and numeric-policy requirements, resource-limit profile, urgency class, authority-receipt reference, logical request tick, expiry, and request digest. The request contains no renderer object, authoring session, capability secret, or private input outside the requested audience.

### `RealmBakeActivationOfferV1`

Fields: offer ID, request ID, old bake ID, candidate `RealmVisualBakeManifestV1` ID, variant and audience, source projection revision, source-generation watermarks, dependency-closure ID, bake-receipt ID, compatibility result, required CPU and GPU budget estimates, transition-anchor map, logical offer tick, expiry, publisher identity, and external `signatureEnvelopeId`. An offer is not active state.

### `RealmBakeActivationReceiptV1`

| Field | Requirement |
| --- | --- |
| `activationId`, `offerId`, `requestId` | Exact transition identity |
| `oldBakeId`, `candidateBakeId`, `activeBakeId` | Before, proposed, and resulting roots |
| `decision` | `prepared`, `committed`, `rejected`, `cancelled`, or `rolled-back-before-commit` |
| `sourceWatermarks` | Snapshot-to-stream handoff point used for reprojection |
| `bufferRange` | Ordered observation interval buffered during the barrier |
| `reprojectionDigest` | New anchor-bound projection state digest |
| `cameraAnchorDecision` | Preserved first-person anchor, explicit safe Root Spine fallback, or revalidated local Operations View framing constrained to the new private bake |
| `logicalBarrierTick`, `frameBarrierId` | Atomic activation boundary |
| `reasonCode`, `resourceDisposalReceiptId` | Safe outcome and cleanup evidence |
| `receiptDigest`, `authoritySignatureEnvelopeId` | Runtime-authenticated evidence with an external authority envelope where required |

The runtime publishes `committed` only after the candidate static store, collision, navigation, ECS projection, required GPU resources, camera anchor, current view mode, and buffered observation handoff all verify. An active Operations View must rebind to the same local Realm, current authority, new private bake, layout receipt, and admitted local cells or close and restore a safe first-person anchor. Any pre-commit failure disposes staged resources and leaves the old root active.

## Public and refinement contracts

### `RealmPublicAppearanceSourceV1`

This is the caller-authored, public-only appearance input to M1B. It is independently validated before public resources or a shell manifest are compiled; its API has no owner-private bake or private source input.

| Field | Requirement |
| --- | --- |
| `appearanceSourceId`, `appearanceDigest` | Self identity and canonical appearance digest |
| `realmIdentity`, `publisherIdentity` | Exact publishing Realm; publisher must equal the Realm identity |
| `sourceProjectionId`, `sourceProjectionDigest`, `idNamespace` | Exact public-shell source projection and public namespace |
| `topologyRootId`, `numericPolicyId` | Public topology root and frozen numeric policy |
| `spatialLayoutPolicyId`, `spatialLayoutReceiptId` | Exact public layout policy and receipt |
| `coordinatePolicy` | Metres, right-handed coordinates, Y-up axis, public origin, and precision policy |
| `rendererCompatibility`, `resourceLimitProfileId` | Shipped renderer profile/features/limits and public bake limits |
| `resourceRefs`, `safeTextRefs`, `archetypeRefs`, `hlodRefs` | Canonically ordered complete public resource sets |
| `transforms`, `materialParameters`, `bounds` | Sorted unique public instances and parameter pairs, positive scale, nonzero quaternion, and positions inside public bounds |
| `publicGateIds`, `refinementSocketIds` | Canonically ordered public gates and advertised refinement sockets |
| `cityNameTextId`, `stationNameTextId`, `publicDestinationTextIds` | Safe-text references; destination entries are sorted, unique, and resolve to public gates and declared safe text |
| `protocolVersions`, `appearanceRevision`, `publicationScheduleId` | Compatible protocols, public-only revision, and explicit public schedule |
| `issuedAt`, `expiresAt`, `signatureEnvelopeId` | Valid lifetime and external public signature envelope |

Every archetype, HLOD, and safe-text reference must appear in `resourceRefs`; every text ID must resolve through `safeTextRefs`; every transform must name a declared archetype; and every material parameter must name a declared instance. The implemented M1B coordinator further requires the exact fixed `PublicSecureMeshShellKit` references and safe-text content. The kit is public appearance data, not a live SecureMesh connection or complete derived city.

### `PublicRealmShellManifestV1`

| Field | Requirement |
| --- | --- |
| `manifestId`, `manifestDigest` | Signed public shell root and canonical self digest |
| `realmIdentity`, `publisherIdentity` | Exact publishing Realm identity |
| `appearanceSourceId`, `appearanceDigest` | Exact validated `RealmPublicAppearanceSourceV1` |
| `sourceProjectionId`, `sourceProjectionDigest`, `idNamespace` | Exact public projection and public namespace |
| `shellBakeId`, `shellBakeDigest` | Exact public `RealmVisualBakeManifestV1` identity and digest |
| `topologyRootId`, `disclosurePolicyDigest`, `numericPolicyId` | Public topology, disclosure, and numeric-policy bindings |
| `spatialLayoutPolicyId`, `spatialLayoutReceiptId`, `coordinatePolicy` | Exact layout and coordinate-policy bindings |
| `rendererCompatibility`, `resourceLimitProfileId` | Shipped renderer compatibility and public limits |
| `dependencyClosureId`, `dependencyClosureDigest` | Exact public-only transitive closure |
| `resourceRefs`, `safeTextRefs`, `archetypeRefs`, `hlodRefs` | Same complete canonical public resource sets accepted from the appearance source |
| `transforms`, `materialParameters`, `bounds` | Same validated public instances, material values, and conservative bounds |
| `publicGateIds`, `refinementSocketIds` | Opaque public station destinations and advertised refinement attachment points |
| `cityNameTextId`, `stationNameTextId`, `publicDestinationTextIds` | Exact safe public labels |
| `protocolVersions`, `appearanceRevision`, `publicationScheduleId` | Compatible protocols, public revision, and schedule |
| `issuedAt`, `expiresAt`, `signatureEnvelopeId` | Freshness and external authenticity envelope |

This manifest cannot contain scripts, WASM, shader source, URLs, private IDs, paths, source-derived glyphs, private collision, private navigation, private timing, the local noninterference receipt, or its signature. Its cross-record verifier requires exact appearance, projection, bake, closure, resource, visual-manifest, digest, and signature bindings.

### `RealmAccessRefinementV1`

| Field | Requirement |
| --- | --- |
| `refinementId`, `refinementDigest` | Opaque audience-specific signed root and canonical self digest |
| `basePublicShellId`, `basePublicShellDigest`, `baseAppearanceRevision` | Exact reverified base public shell and appearance revision |
| `refinementSocketId` | Socket declared by that base public shell |
| `realmIdentity`, `audienceIdentity`, `audienceClass`, `disclosureClass`, `idNamespace` | Distinct publishing and receiving identities in the capability-refined namespace |
| `sourceProjectionId`, `sourceProjectionDigest`, `disclosurePolicyDigest`, `resourceLimitProfileId` | Independently compiled refinement source and policy bindings |
| `capabilityId`, `allowedActions`, `resourceScopes`, `resourceScopeDigest` | Canonically ordered exact current grant |
| `capabilityEpoch`, `bridgeEpoch` | Positive active epochs for the V1 bridge-scoped refinement |
| `authorityReceiptRef`, `authorityReceiptDigest` | Exact injected authority evidence |
| `refinementBakeId`, `refinementBakeDigest` | Independently compiled capability-refined visual manifest |
| `dependencyClosureId`, `dependencyClosureDigest` | Exact capability-refined transitive closure |
| `encryptionEnvelopeId`, `encryptionEnvelopeDigest`, `envelopeDescriptor` | Exact signed AES-GCM-256 envelope and duplicated transport descriptor binding |
| `policyRevision`, `issuedAt`, `expiresAt`, `publisherIdentity`, `signatureEnvelopeId` | Authorizing policy, contained lifetime, Realm publisher, and external authenticity envelope |

M1B compiles, verifies, and publishes the sealed refinement root and ciphertext artifacts. It does not implement live network transport, stored-package reconstruction, remote private-interior rendering, or exact-source delivery into Code Matter.

### `RealmRefinementEncryptionEnvelopeV1`

Fields bind the envelope and refinement identities; base public shell, appearance revision, and refinement socket; Realm and audience identities; exact capability, actions, scopes, capability and bridge epochs; authority receipt; source projection; refinement bake and closure; policy and disclosure digests; `AES-GCM-256` algorithm and encryption profile; key generation and positive key epoch; nonce-allocation receipt and 96-bit IV; authenticated-data digest; opaque ciphertext locator, byte length, digest, and 16-byte authentication tag; lifetime; Realm publisher; envelope digest; and signature envelope.

The record exposes authorization metadata and binding digests. It does not claim anonymous metadata. Key trust, key distribution, rotation, revocation, and durable cross-process nonce allocation belong to injected external authorities.

### `RealmPublicNoninterferenceReceiptV1`

This signed `owner-private + local-private` receipt binds the public appearance and projection; schedule; compiler set, numeric policy, and limits; declared private-mutation and checked-invariant classes; distinct baseline and comparison run IDs; both manifest, closure, semantic-scene, envelope-class, and scheduling results; zero forbidden reachability, private-input reads, and cross-audience cache hits; result; issue time; publisher; and receipt digest.

`passed` is valid only when both compiled outputs are byte-identical and all three isolation counters are zero. This receipt is local verifier evidence, not a public resource. The compiler result contains it and its signature, but the public publisher excludes both from immutable artifacts and the public dependency closure.

### `RealmRefinementScopeReceiptV1`

This signed `owner-private + local-private` receipt binds the refinement and encryption envelope; base shell and appearance revision; socket; source projection and namespace; refinement audience; capability, actions, scopes, granted/projected scope digests and counts; active epochs; authority receipt and expiry; refinement bake and closure; refinement expiry; checked invariants; result; verification time; publisher; and receipt digest.

`passed` requires identical granted and projected scope digests and counts, zero forbidden reachability, zero out-of-scope resources, zero unlabeled resources, zero stale epochs, verification before expiry, and refinement expiry no later than authority expiry. The compiler result contains this receipt and its signature for local verification. The refinement publisher excludes both, along with explicit authenticated data and plaintext, from immutable publication artifacts.

The exact package shapes and publication plans are specified in [M1B public shell and access-refinement packages](m1b-public-refinement-packages.md). (Source: `webgpu-os/apps/the-virtual-realm/contracts/RealmPublicAppearanceSourceContract.js`; `webgpu-os/apps/the-virtual-realm/contracts/PublicRealmShellManifestContract.js`; `webgpu-os/apps/the-virtual-realm/contracts/RealmAccessRefinementContract.js`; `webgpu-os/apps/the-virtual-realm/contracts/RealmRefinementEncryptionEnvelopeContract.js`; `webgpu-os/apps/the-virtual-realm/contracts/RealmPublicNoninterferenceReceiptContract.js`; `webgpu-os/apps/the-virtual-realm/contracts/RealmRefinementScopeReceiptContract.js`.)

## Live observation contracts

### `RealmObservationV1`

| Field | Requirement |
| --- | --- |
| `observationId` | Stable event identity |
| `observationKind` | Registered domain event |
| `sourceAdapterId`, `sourceAuthority` | Authoritative origin |
| `sourceSequence` | Monotonic sequence within the source stream |
| `subjectId` | Stable audience-valid object ID |
| `sourceSchemaVersion`, `sourceGeneration` | Authoritative adapter schema and source-owned generation |
| `audienceClass`, `disclosureClass` | Visibility and export policy |
| `provenanceClass`, `evidenceQuality` | Source lineage and quality |
| `availabilityState`, `freshnessState`, `temporalMode`, `assertionState` | Access, freshness, time context, and confirmation status |
| `observedAt`, `freshUntil` | Audit time and freshness |
| `causalPredecessorIds` | Bounded evidence chain |
| `payload` | Strict domain-specific bounded data |
| `observationDigest` | Canonical digest |

### `RealmObservationSnapshotV1`

The snapshot binds query identity, audience, source schema versions, source generations, source watermarks, ordered observations, omissions, freshness, and digest. It does not bind presentation geography. Snapshot and subscription from one port must share source-sequence semantics so a consumer can close the snapshot-to-stream race.

M3A does not change this M0 record. Its separate cursor, batch, profile,
manifest, checkpoint, recovery, and ledger contracts bind the missing live
operator/Realm/process-owner/M2-lifecycle/policy plus kernel pseudonym-key
authority/epoch/commitment context and use one atomic snapshot-plus-retained-tail
handshake. Cursors bind the complete portable receipt and cannot cross a key
rotation. Kernel-only epoch-reference records, overflow/opening-cut digest
  inputs, the seven-row terminal-retirement reason map and immutable latch,
  atomic projection issuance/row registration, generation-branded close,
  nonissuance, and cumulative fence evidence, complete-lineage released/absent-
  after-restart aggregate terminal evidence, seven-kind safe drain-blocker projection,
compaction operation results, and process-local close snapshots are internal
proof objects rather than extra application contracts or catalog definitions.
See
[M3A Observation Ingress](m3a-observation-ingress.md).

### `RealmMetricValueV1`

Every metric is explicit rather than an untyped number.

| Field | Requirement |
| --- | --- |
| `metricKind` | Registered CPU, memory, byte, count, rate, duration, loss, jitter, queue, capacity, or health measure |
| `value` | Finite quantized value or audience-safe bucket |
| `unit` | Exact registered SI or domain unit |
| `evidenceQuality` | Exact, measured, computed, estimated, unknown, or not-applicable |
| `sampleWindowTicks` | Logical sampling window |
| `sourceSequence` | Source watermark |
| `minimum`, `maximum` | Optional declared bounded interval |

### Domain observation payloads

`RealmObservationV1.payload` must match exactly one registered domain schema. An adapter cannot place arbitrary source objects inside the envelope.

#### `RealmFilesystemObservationPayloadV1`

Fields: event kind (`snapshot`, `object-created`, `object-updated`, `object-moved`, `object-removed`, `mount-added`, `mount-removed`, or `coverage-changed`), opaque object ID, audience-valid parent and previous-parent IDs, object kind, source revision, mount generation, metadata-view class, permitted name or label reference, permitted size or count metric, content-availability state, relationship changes, and coverage-receipt reference. Public payloads contain no raw path, private name, private count, content hash, browser handle, or source bytes.

#### `RealmProcessObservationPayloadV1`

Fields: event kind (`started`, `state-changed`, `metrics-sampled`, or `exited`), opaque process ID, audience-valid parent process ID, app or service class, lifecycle state, start source sequence, bounded `RealmMetricValueV1` records, safe exit classification, and observation generation. Arguments, environment, credentials, private window content, and browser-native handles are forbidden.

#### `RealmIpcObservationPayloadV1`

Fields: event kind (`channel-opened`, `channel-state`, `traffic-sampled`, or `channel-closed`), opaque channel ID, registered IPC kind, audience-valid producer and consumer IDs, direction, lifecycle state, message class, queue, throughput, latency, and backpressure metrics, and causal source references. Message payloads and secret correlation identifiers are forbidden.

#### `RealmSyscallObservationPayloadV1`

Fields: event kind (`entered`, `authority-decided`, `dispatched`, `completed`, `denied`, `failed`, or `cancelled`), opaque non-reusable invocation ID, registered syscall class and action, audience-valid actor process or application ID, optional audience-valid target object ID and revision, lifecycle state, authority-receipt reference, terminal result-observation references, conditionally present capability epoch, source entry and terminal sequences, bounded duration, queue, and result-class metrics, and safe reason code. The observation is post-kernel evidence and never authorizes dispatch. Arguments, return payloads, paths, keys, values, source bytes, raw handles, capability tokens, credentials, command lines, stack traces, and secret correlation identifiers are forbidden.

#### `RealmStorageObservationPayloadV1`

Fields: event kind (`store-mounted`, `store-state`, `usage-sampled`, `operation-sampled`, `pressure-changed`, or `store-unmounted`), opaque store ID, backend class, source generation, lifecycle state, usage and capacity metrics, operation class, rate, queue and pressure metrics, and health classification. Keys, values, paths, content digests, and native handles are forbidden unless a separate owner-private contract explicitly grants the exact field.

#### `RealmPermissionObservationPayloadV1`

Fields: event kind (`decision`, `granted`, `denied`, `expired`, `revoked`, or `policy-changed`), opaque binding ID, audience-valid subject and object IDs, exact action, decision class, policy revision, capability epoch, issue and expiry times, reason code, and authority-receipt reference. Capability secrets and reusable raw grant tokens are forbidden.

#### `RealmNetworkObservationPayloadV1`

Fields: event kind (`discovered`, `authenticated`, `route-opened`, `route-state`, `traffic-sampled`, `degraded`, or `route-closed`), opaque route and link IDs, authenticated audience-valid peer reference where permitted, protocol class, direct or relayed route class, lifecycle state, latency, jitter, loss, throughput and backpressure metrics, transport epoch, and causal receipt references. IP addresses, physical location, raw packets, signaling secrets, and unauthenticated attributed identity are forbidden.

#### `RealmStationObservationPayloadV1`

Fields: event kind (`signal-listed`, `identity-verified`, `presence-consented`, `shell-accepted`, `traveler-arrived`, `offer-created`, `grant-decided`, `bridge-negotiating`, `bridge-active`, `bridge-degraded`, `bridge-revoked`, `traveler-departed`, or `shell-expired`), station ID, opaque peer and Cityform references permitted at that stage, safe-text station, Cityform, Traveler and destination references permitted at that stage, shell revision, offer, grant, recipe and digest references, directional capability class, conditionally present presence-session, rendezvous and bridge epochs, route class, lifecycle state, and reason code. A stage cannot include text or identity fields that belong to a later authentication, consent, or authority stage.

#### `RealmCodeMatterObservationPayloadV1`

Fields: event kind (`descriptor-available`, `state-transitioned`, `lease-granted`, `lease-denied`, `chunk-available`, `lease-expired`, or `lease-revoked`), audience-scoped Code Matter object ID, sealed, structured, or revealed state, descriptor reference, lease reference, conditionally present capability epoch, visible chunk range, and safe reason code. Owner-private records may carry the exact `sourceRevision`; public records must omit it and use only the descriptor's independent `publicAppearanceRevision`. Exact bytes, private update cadence, and plaintext-derived public identifiers are forbidden.

#### `RealmBootObservationPayloadV1`

Fields: event kind (`phase-entered`, `service-ready`, `service-degraded`, `phase-completed`, or `boot-failed`), registered boot phase, audience-valid service ID, source sequence, dependency references, lifecycle state, safe reason code, and metric records. It cannot expose secrets, command lines, private paths, or invented phase completion.

### `RealmDeltaV1`

| Field | Requirement |
| --- | --- |
| `deltaId` | Deterministic ID derived from projector, inputs, operation, subject, and epoch |
| `projectorId`, `projectorVersion` | Pure projection identity |
| `operation` | Registered `entity`, `route`, `gate`, `traffic`, `structure`, `code`, or `presentation` operation |
| `subjectId`, `anchorId` | Existing runtime and authored references |
| `inputObservationIds` | Exact provenance |
| `bakeRevision`, `audienceClass` | Compatibility and audience |
| `provenanceClass`, `evidenceQuality` | Source lineage and quality |
| `availabilityState`, `freshnessState`, `temporalMode`, `assertionState` | Access, freshness, time context, and confirmation status |
| `bridgeEpoch` | Required for a bridge-scoped delta; otherwise absent |
| `logicalTick`, `expiryTick` | Deterministic lifetime |
| `payload` | Strict operation-specific data |
| `deltaDigest` | Canonical digest |

The delta carries no renderer resource, privileged handle, capability secret, or mutable callback.

The projector, not the observation adapter, binds a delta to `bakeRevision` and `anchorId`. This permits one authoritative source stream to survive staged bake transitions and prevents WebGPU OS truth from depending on presentation geography.

### Domain delta payloads

Each `RealmDeltaV1.operation` selects one exact bounded payload:

- `RealmEntityDeltaPayloadV1`: activate, update, deactivate, mark-stale, or mark-absent one runtime entity using an approved archetype, stable anchor, semantic state, and accessibility label reference.
- `RealmRouteDeltaPayloadV1`: propose, open, degrade, close, or revoke one IPC, syscall, network, station, or bridge route using existing endpoint IDs, route class, traversal class, metrics, epoch, and expiry. A syscall route is non-traversable unless a separate authored navigation link exists and never conveys invocation authority.
- `RealmGateDeltaPayloadV1`: present locked, available, pending, granted, denied, expired, or revoked state for an authored gate. It contains no capability token and cannot itself authorize passage.
- `RealmTrafficDeltaPayloadV1`: update bounded train, pulse, freight, or conduit presentation from cited throughput, latency, jitter, loss, queue, and backpressure metrics.
- `RealmStructureDeltaPayloadV1`: mark a stable structure active, inactive, stale, partial, fractured, recovering, or recovered without rewriting its bake geometry, collision, or navigation.
- `RealmCodeDeltaPayloadV1`: transition a Code Matter object among sealed, structured, and revealed presentation using a descriptor and current lease reference. It contains no source bytes.
- `RealmPresentationDeltaPayloadV1`: attach, update, or detach a referenced `RealmPresentationCommandV1` and its reversible handle class.

Unknown operations or payload keys fail. A delta cannot create a topology node, grant authority, change a bake manifest, or claim success without cited authoritative observations.

Base M3B reuses this contract unchanged but admits only `entity`, `route`,
`gate`, `traffic`, `structure`, and `presentation`. `code` remains M3D-only;
`station` and `bridge` route domains remain later multiplayer work. Every base-
M3B IPC, syscall, and network route is `non-traversable`. M3A admits exactly six
local-network event variants; `authenticated` is excluded because it requires
`peerIdentityRef`, and peer authentication remains M5 work. M3B recomputes delta
and nested payload identity, cross-binds envelope/payload IDs, resolves every
anchor through the current static projection-binding index, and admits same-key
nonidentical writes only through the exact sequential `transitionBase` protocol.
See
[M3B Disclosure and Dynamic Projection](m3b-disclosure-projection.md).

## Interaction and action contracts

### `RealmActionProposalV1`

This is the common powerless request produced by direct interaction or by an authorized Storylet proposal adapter.

| Field | Requirement |
| --- | --- |
| `proposalId` | Deterministic or nonce-bound request ID |
| `realmId`, `actorId` | Current Realm and authenticated local actor |
| `targetId`, `targetRevision` | Exact audience-valid object and expected revision |
| `action` | Registered inspect, navigate, request-reveal, open-session, close-session, offer-docking, accept-docking, traverse, revoke, or manage-local-zone action |
| `parameters` | Strict action-specific bounded schema |
| `interactionRef` | Pick or Storylet proposal evidence, never authority |
| `audienceClass`, `disclosureClass` | Request and response audience |
| `requiredCapabilityClass` | Capability requested or expected; not a grant |
| `policyRevision` | Current optimistic policy context |
| `capabilityEpoch` | Required when the request depends on a capability; otherwise absent |
| `presenceSessionEpoch`, `rendezvousEpoch`, `bridgeEpoch` | Required only for the matching active presence, rendezvous, or bridge scope; otherwise absent |
| `expectedStateRevision` | Compare-and-swap expectation where applicable |
| `idempotencyKey` | Mandatory for any externally observable operation |
| `issuedAt`, `expiresAt`, `operationNonce` | Freshness and replay controls |
| `proposalDigest` | Canonical digest |

V1 is read-only except for explicitly approved session, docking, traversal, reveal-lease, revocation, and bounded local-zone operations mediated by their owning WebGPU OS, Realm Network, or RealmForge authority. `manage-local-zone` carries only an accepted `LocalZoneManagementProposalV1` ID and digest; an unsupported authority port denies it by default.

### `RealmActionAuthorityReceiptV1`

| Field | Requirement |
| --- | --- |
| `proposalId`, `proposalDigest` | Exact request binding |
| `decision` | `allowed`, `denied`, `conflict`, `expired`, `revoked`, or `failed-before-dispatch` |
| `decidingAuthority` | Kernel, RealmLink, Realm Shield, or registered authority identity |
| `realmId`, `actorId`, `targetId`, `targetRevision`, `action` | Exact subject binding |
| `capabilityId`, `allowedScope` | Present only when safely permitted; never the secret token itself |
| `policyRevision` | Authority policy generation |
| `capabilityEpoch` | Present when capability-scoped; otherwise absent |
| `presenceSessionEpoch`, `rendezvousEpoch`, `bridgeEpoch` | Present only for the matching active scope |
| `idempotencyKey`, `dispatchId` | Replay and settlement binding |
| `decidedAtLogicalTick`, `issuedAt`, `expiresAt` | Decision time and lifetime |
| `reasonCode` | Safe bounded outcome code |
| `settlementState` | `pending-result` for an allowed dispatch or `not-dispatched` for every non-allow decision; immutable receipts never backlink to a later observation |
| `receiptDigest`, `signatureEnvelopeId` | Kernel-authenticated evidence or an external signature envelope |

### `RealmActionResultObservationPayloadV1`

Fields: proposal ID, authority-receipt ID, dispatch ID, idempotency key, target ID and revision, action, terminal outcome, resulting state revision, safe reason code, conditionally present capability, presence-session, rendezvous and bridge epochs, and causal domain-observation references. This result points one way to the immutable authority receipt, preserving an acyclic authenticated settlement chain. This observation, not the proposal or animation, permits the world to present completed success.

## Local City Operations contracts

The four M0 view/action records and the additive M1A lookup resource are local-only, owner-private, and flat. They create no new audience or disclosure enum. They are never a public shell, access refinement, shared Chronicle record, or network message.

### `LocalOperationsLookupResourceV1`

This M1A resource binds one local Realm, exact owner-private/local-private audience, private source revision, layout policy and receipt, numeric policy, city and camera bounds, canonically sorted cells, anchors, zones, routes, landmarks, map-HLOD records, dependencies, compiler identity, content ID, and lookup digest. Every bound, cell, anchor, route endpoint, landmark, zone, and reverse HLOD membership must close over that same private Cityform. It contains no public shell, refinement, PresenceSession, rendezvous, bridge, remote pose, Traveler, connected Cityform, plaintext source, or capability secret.

### `LocalOperatorViewPolicyV1`

Fields: policy ID, local Realm ID, owner identity, exact `owner-private` audience and `local-private` disclosure, canonically ordered allowed mode subset (`first-person`, `local-isometric`, and `local-eagle-eye`) including first person, overview constraints, minimap constraints, canonically ordered local zone actions, interaction policy, policy revision, and policy digest.

Overview constraints bind positive maximum altitude, ordered negative pitch bounds, a canonical finite set of approved headings, positive ordered zoom bounds, loaded-cells-only operation, local-Realm-only projection, and required exclusion of connected Cityforms, remote shells, rendezvous frames, and bridges. Minimap constraints require the same local-only and exclusion rules plus a positive anchor ceiling. Picking returns stable local IDs only; camera and map state grant no authority; mutations require an authority receipt.

M2D-B4F reuses this exact accepted policy schema; it does not define a parallel
policy record. A successful runtime read cross-binds the policy's owner identity
and local Realm to the six-field request context and cross-binds its policy ID,
revision, and digest to one exact nested policy head.

#### M2D-B4F `localOperatorPolicy@1` runtime wire

This provider-free runtime port has exactly `readPolicy()` and `subscribe()`.
The six context fields are `operatorIdentity`, `operatorGeneration`,
`localRealmId`, `lifecycleGeneration`, `authorityEpoch`, and `policyEpoch`.
The exact nested head is `policyId`, `policyRevision`, and `policyDigest`.

A read request is the context plus a live signal. It permits zero authority or
policy epochs so unavailable context can be represented without fabrication.
Read results are exactly:

- `policy`: echoed context, nested head, and accepted policy; both epochs must
  be positive;
- `invalid`: only `status` and one of `oversized`, `future-version`,
  `malformed`, `live-value`, `digest-invalid`, or `policy-binding-invalid`;
- `unavailable`: only `status` and either `policy-unavailable` or
  `policy-recovery-pending`.

Subscription requires positive epochs, the exact successful head,
`onInvalidated`, and a live signal. Its data-only event is exactly
`{ eventKind, reasonCode }`, with event kind
`local-operator-policy-invalidated` and reason `context-invalidated`,
`policy-invalidated`, or `service-stopped`. Subscription and disposal values are
exactly `{ subscriptionId, dispose }` and `{ subscriptionId, disposed: true }`.
Wire data is capped at 65,536 canonical bytes. Validation preserves opaque
function and signal identities without invoking them; returned data snapshots
are detached and deeply frozen.

This contract validates digest syntax and cross-record binding only. It owns no
provider, policy store, monotonic protected head, digest-to-body truth, clock,
renderer, view, minimap, network path, or mutation authority. B4H owns the
genuine owner-local context/policy sources and provider composition; it does
not accept later presentation, Operations View, minimap, networking, or
application-mutation gates. Its separate kernel-only
`RealmLocalOperatorPolicyHeadStorage` now verifies the canonical policy body and
digest and owns the protected monotonic head for one captured account and
explicit Realm. The separate `RealmLocalSelectionHeadStorage` now supplies a
protected current-Realm choice and monotonic authority epoch for the captured
account. It preserves deselection as a positive-epoch tombstone and grants no
capabilities. Live lifecycle ownership, coherent B4A/B4F adaptation, invalidation,
and full provider registration remain unimplemented.
The accepted terminal B4G compatibility gate creates none of those authorities.
No frozen contract catalog changes. (Source:
`webgpu-os/kernel/realm/RealmLocalOperatorPolicyHeadStorage.js`;
`webgpu-os/kernel/realm/RealmLocalSelectionHeadStorage.js`.)

The kernel-only `RealmLocalOperatorSnapshotSource` adds a read-only coherent
selection/policy join, not a new frozen app contract. Its nine-field private
snapshot contains status, operator identity/generation, selected Realm,
authority/policy epochs, both exact storage SHAs, and verified policy. It
reasserts the exact selection after the policy read, including missing policy.
It is not a live lease and cannot supply lifecycle generation, partition ID,
subscriptions, or mutation authority. The B4A/B4F wires remain unchanged.
(Source: `webgpu-os/kernel/realm/RealmLocalOperatorSnapshotSource.js`.)

The separate kernel-only `RealmLifecycleGenerationHeadStorage` adds no frozen
catalog definition or application port. It stores one exact six-field head:
`format: 'particle-realms.lifecycle-generation-head'`, `version: 1`,
`operatorIdentity`, `appId`, positive uint64-text `lifecycleGeneration`, and
`previousStorageSha256`. Its per-account/app protected head is capped at 4,096
bytes. Exact frozen `readCurrent({ signal })` observes missing/generation data;
`allocateNext({ expected, signal })` alone can return a confirmed new
reservation. Expected absence is null; otherwise the exact pair is
`{ lifecycleGeneration, exactStorageSha256 }`. Read results are exactly
`{ status, lifecycleGeneration, exactStorageSha256 }`; successful allocation is
`{ status: 'written', current }`. No read, including recovery, allocates. There
is no caller-selected generation, reset, delete, or unchanged allocation.
This is not the existing `lifecyclePort@1` wire: it proves neither live
currentness nor retirement and returns no retirement handle, receipt, or
participant. All frozen M0/M2 catalogs and the sixteen-key dependency-v2 record
remain unchanged. (Source:
`webgpu-os/kernel/realm/RealmLifecycleGenerationHeadStorage.js`.)

`RealmLifecycleSessionAuthority` is another kernel-only construction primitive,
not an additional frozen catalog or lifecycle-port wire. Its exact options are
`{ operatorContext, generationStorageView, appId, workSignal, teardownSignal }`;
its frozen result is `{ lifecycleGeneration, retirementHandle, assertCurrent,
observeRetirement, dispose }`. Requests are exact frozen `{ signal }` for the
assertion/observer and `{ reason, signal }` for the authentic handle's sole
`retire` method. `dispose()` takes no arguments. Work and teardown signal
identities are separately prebound, and retirement requires the original handle
receiver. The canonical terminal preimage is capped at 4,096 bytes and has
exactly `format: 'particle-realms.lifecycle-retirement-receipt'`, `version: 1`,
`operatorIdentity`, `operatorGeneration`, `appId`, `lifecycleGeneration`,
`allocationStorageSha256`, and `retired: true`. SHA-256 produces its
`sha256:<64 lowercase hex>` content address. The digest stays private until
the owner transitions to retired; repeated calls return the same frozen
`{ lifecycleGeneration, retired: true, lifecycleRetirementReceiptDigest }`.
The observer returns the same three keys with false/null before retirement.
No caller supplies a digest or generation for acceptance. Handles and terminal
observations are process-local and are never reconstructed from storage.
(Source: `webgpu-os/kernel/realm/RealmLifecycleSessionAuthority.js`.)

The separate host-attempt binding is a runtime transport contract, not a frozen
catalog definition, application dependency, or replacement `lifecyclePort`.
`AppRuntimeCompositionRegistry` retains the legacy exact frozen two-field lease
`{ dependencies, close }`. Only an explicit version-2 lease has the exact four
fields `{ leaseVersion: 2, dependencies, attemptBinding, close }`. Its binding
is the frozen exact record
`{ portName: 'realmRuntimeAttemptBinding', version: 1, bindAttempt }`; validation
preserves that receiver identity. `Desktop` sends it outside the dependency
record as `virtualRealmRuntimeAttemptBinding`, and the factory passes it to
Entry as an optional second argument. The 16-key dependency-v2 record and all
frozen catalog inventories remain byte-for-byte unchanged.

`bindAttempt()` accepts only a frozen exact record containing
`constructionSignal`, `workSignal`, and `teardownSignal`. Each value is an
authentic live native `AbortSignal`, the three identities are distinct, and a
previously bound root cannot be reused. Its synchronous result must be the
frozen exact `{ bound: true }`. Entry calls it once for each fresh attempt before
inspection; operator snapshot and the existing lifecycle allocation retain
their order after inspection.

The trusted controller is itself the exact frozen
`{ binding, captureAttempt, close }` record, but only `binding` crosses the app
mount boundary. `captureAttempt()` accepts only an exact frozen one-field request
whose signal is the currently bound construction root, then returns the
three-root snapshot only while every root remains live. A replacement binding
requires the prior teardown root to have aborted and three fresh roots.
`close()` refuses live teardown and cannot abort, retire, unregister, release, or
clean a resource. These records bind one locally supplied attempt under trusted
construction; they supply
no genuine lifecycle provider, process owner, activation, camera, minimap,
policy provider, or execution isolation. (Sources:
`webgpu-os/apps/the-virtual-realm/runtime/RealmRuntimeValidationPrimitives.js`;
`webgpu-os/kernel/realm/RealmRuntimeAttemptBinding.js`;
`webgpu-os/kernel/AppRuntimeCompositionRegistry.js`;
`webgpu-os/shell/Desktop.js`;
`webgpu-os/apps/the-virtual-realm/VirtualRealmEntry.js`.)

The separate `RealmLifecycleAllocationAuthority` has exactly three factory
options, `{ operatorContext, generationStorageView, appId }`, and returns the
frozen six-field source `{ attemptBinding, allocateGeneration,
assertGenerationCurrent, retireGeneration, observeRetirement, close }`. It is
not a catalog definition or full port. Allocation, currentness, and retirement
consume the existing lifecycle wire shapes; mutable inputs remain compatible
through an exact descriptor-only snapshot. Observation consumes exactly
`{ retirementHandle, signal }`. Its issued one-method wrapper requires authentic
receiver/handle identity and the exact teardown root, and retains the underlying
session's terminal observation before teardown ends. Close has no arguments and
returns stable frozen `{ closed: true }` only after pending allocation settles,
issued authority is genuinely retired, and the bound teardown has ended.
Neither abort nor a caller digest substitutes for retirement, resource release,
or durable recovery. No discriminator, participant method, dependency key, or
frozen catalog definition is added. (Source:
`webgpu-os/kernel/realm/RealmLifecycleAllocationAuthority.js`.)

The protected-head source evidence assumes trusted construction. Its view brand
does not authorize acquisition through the existing public storage-binding
exports. Authenticated kernel-controlled acquisition and prevention of native
storage bypass remain provider-activation prerequisites, separate from these
exact wire validations. A binding token alone does not isolate same-origin
OPFS. See the [current enforcement gap](security-privacy.md#current-shared-origin-enforcement-gap).
(Sources: `webgpu-os/storage/StorageManager.js` `bindOperatorServiceRoot`;
`webgpu-os/storage/OPFSDriver.js`.)

### `LocalOperatorViewSnapshotV1`

Fields: snapshot ID, policy ID and revision, the only representable Realm ID (`localRealmId`), owner identity, required local operator capability class, positive capability epoch, authority-receipt ID and digest, active private bake ID, spatial-layout receipt ID, local-operations lookup ID and digest, exact owner/private audience, approved mode, bounded camera state, canonical loaded-cell, visible-anchor, visible-zone, and selected-zone IDs, exact connected-content exclusion receipt, source dynamic revision, logical tick, issue time, expiry, and snapshot digest.

There is no independent `viewedRealmId` field that could name another Realm; the viewed Realm is definitionally `localRealmId`. Selected zones are a subset of visible zones. Cross-record acceptance verifies the current policy, authority receipt, capability epoch, active private manifest, layout receipt, the content-bound local-operations lookup in that manifest's resource closure, loaded cells, and local ownership of every referenced anchor and zone. Isometric and eagle-eye camera position must lie inside the lookup's verified camera bounds; its normalized quaternion must exactly encode the declared bounded pitch and one policy-approved heading. The schema contains no PresenceSession, RendezvousFrame, bridge, PublicRealmShell, remote RealmPose, Traveler, or remote epoch field.

### `LocalCityMinimapSnapshotV1`

Fields: minimap snapshot ID, policy and operator-view bindings, local Realm and owner, active private bake, layout receipt, local-operations lookup ID and digest, exact owner/private audience, ordered bounds, canonical loaded cells, sorted local zone records, local route records, local landmark records, exact connected-content exclusion receipt, source dynamic revision, logical tick, and snapshot digest.

Every zone, anchor, route endpoint, landmark, and cell resolves inside the accepted local projection. Bounds and complete zone, route, and landmark records must exactly match the current trusted projection of the content-bound local-operations lookup plus its declared local dynamic revision; membership-only relabeling is insufficient. Routes with a foreign or dangling endpoint fail. Before policy enablement or limits are consulted, acceptance requires the supplied policy's `policyId`, `policyRevision`, `localRealmId`, and `ownerIdentity` to equal the minimap snapshot's bindings. A different schema-valid policy therefore fails closed. The count ceiling comes from the current policy. The minimap has no remote identity, shell, pose, destination, bridge, rendezvous, or Traveler field. Exclusion receipt zeros mean zero such records were included, not that no remote peer exists.

### `LocalZoneManagementProposalV1`

Fields: proposal ID, policy and operator-view bindings, local Realm, owner and actor identities, target zone and revision, exact action and action-specific parameters, active private bake, spatial-layout receipt, exact owner/private audience, exact `manage-local-zone` capability class, its independent positive capability epoch, expected state revision, idempotency key, issue time, expiry, operation nonce, and proposal digest.

The exact V1 actions are:

- `set-zone-visibility`: visible, dimmed, or hidden owner-private presentation.
- `set-zone-alert-threshold`: metric class, above/below comparison, and a complete `RealmMetricValueV1` threshold.
- `request-zone-rebake`: safe reason code, source generation, and canonical requested local anchor set.

`LocalZoneManagementActionAdapter` accepts this proposal only against the current policy, current view snapshot, current local bake/layout, exact local zone set, and a current `manage-local-zone` grant whose epoch is independent from the view-session epoch. The supplied policy's `policyId`, `policyRevision`, `localRealmId`, and `ownerIdentity` must first equal the proposal's bindings, so a foreign schema-valid policy cannot authorize an otherwise valid action. Rebake anchors must also be owned, loaded, and visible in that snapshot. It emits one generic `RealmActionProposalV1` with action `manage-local-zone`, target zone, proposal ID, and proposal digest. It cannot dispatch, authorize, mutate, start a compiler, or claim completion.

## Code Matter contracts

### `CodeMatterDescriptorV1`

| Field | Requirement |
| --- | --- |
| `codeObjectId` | Object-scoped ID from the descriptor's audience namespace; public IDs are opaque and unrelated to private IDs |
| `realmId`, `sourceAuthority` | Owning Realm and exact source authority |
| `audienceClass`, `disclosureClass` | Exact descriptor audience and export policy |
| `metadataPolicyId`, `metadataPolicyRevision` | Exact permitted metadata view |
| `sourceRevision` | Private exact immutable byte revision; for a public descriptor this field is absent and a public appearance revision is used instead |
| `publicAppearanceRevision` | Present only for explicitly public source projection; unrelated to private source revisions or timing |
| `state` | `sealed`, `structured`, or `revealed` |
| `metadataClass` | Fields permitted at this authority level |
| `byteLengthClass`, `lineCountClass` | Optional owner-private exact or explicitly public bucket values; absent when policy does not permit them |
| `tokenStructureRef` | Optional separately authorized audience-matching structure; forbidden in a generic public seal |
| `localCommitment` | Optional salted owner-private commitment; absent in public descriptors |
| `glyphStyleId` | Audience-safe style resource |
| `requiredCapability` | Exact capability action for transition |
| `capabilityEpoch` | Required only when this descriptor state depends on a revocable capability |
| `issuedAt`, `freshUntil` | Owner-private freshness; public publication uses its independent scheduled shell lifetime |
| `descriptorDigest` | Canonical digest |

A public descriptor originates only from `RealmAudienceSourceProjectionV1` with `variantKind: public-shell`. Private source, revision, size, line count, token structure, commitment, update cadence, and eligibility cannot affect its ID, appearance revision, descriptor bytes, or publication timing.

### `CodeMatterVaultKeyEpochV1`

Fields: vault ID, non-secret random vault-key ID, audience class, key epoch, algorithm (`AES-GCM-256`), IV policy ID, random 32-bit per-key IV prefix, next 64-bit counter lower bound, allocator generation, key status (`preparing`, `active`, `retired`, `revoked`, or `unrecoverable`), wrapping-key reference, creation receipt, activation receipt, and private record digest. No key material appears in the record.

### `VaultNonceAllocationReceiptV1`

Fields: allocation receipt ID, vault ID, vault-key ID, key epoch, IV prefix, reserved 64-bit counter or disjoint counter interval, allocator generation before and after commit, transaction ID, issue time, consumption state, and private receipt digest. Allocation durably advances before ciphertext publication; an unused allocation may be abandoned but never reused.

### `CodeRevealLeaseV1`

| Field | Requirement |
| --- | --- |
| `leaseId` | Non-reusable opaque lease ID |
| `realmId`, `codeObjectId`, `sourceRevision` | Exact protected object binding |
| `authorityIdentity`, `capabilityId`, `action` | Current grant |
| `audienceClass` | Local owner in V1 |
| `visibleChunkRange` | Bounded current line or byte window |
| `capabilityEpoch` | Current local authority generation |
| `bridgeEpoch` | Structurally absent in V1. A future remote reveal protocol requires a new reviewed contract version rather than widening this lease |
| `issuedAt`, `expiresAt`, `operationNonce` | Replay and lifetime controls |
| `leaseReceiptDigest` | Signed or kernel-authenticated receipt |

### `CodeMatterChunkV1`

The chunk binds Realm, object, revision, authority identity, local-owner audience, byte and line ranges, chunk index, exact byte length, commitment, lease, capability epoch, vault-key ID, key epoch, one exactly 96-bit base64url IV, nonce-allocation receipt ID, AES-GCM-256 metadata with a 16-byte authentication tag, an envelope-internal content digest, and end-of-stream state. These fields form the complete additional-authenticated-data context. A non-terminal chunk cannot be empty. Plaintext and its unkeyed digest are never a general event, telemetry, Chronicle, public-bake, or public-addressing field.

## Presence, rendezvous, and bridge contracts

### `PresenceBeaconV1`

Fields: opaque Realm identity reference, public-shell digest, compatible protocol versions, presence mode, rendezvous intent, bounded public capability classes, issue time, expiry, replay nonce, publisher identity, and external `signatureEnvelopeId`. It contains no IP address, GPS coordinate, private topology, hidden destination, or capability token.

### `PresenceSessionV1`

| Field | Requirement |
| --- | --- |
| `presenceSessionId`, `presenceSessionEpoch` | Non-reusable session identity and monotonic generation |
| `localRealmIdentity`, `remoteRealmIdentity` | Authenticated participants |
| `identityReceiptIds` | Exact mutual authentication evidence |
| `localConsentReceiptId`, `remoteConsentReceiptId` | Current mutual presence consent |
| `localShellId`, `remoteShellId` | Verified compatible public-shell revisions |
| `travelerAppearanceIds` | Verified safe appearance records allowed in this session |
| `allowedStationGateIds` | Opaque public station-presence scope only |
| `policyRevision`, `rateLimitProfileId` | Current policy and bounded traffic limits |
| `startedAt`, `expiresAt`, `operationNonce` | Lifetime and replay controls |
| `requiredSignerIdentities` | Canonically ordered exact mutual authority publishers; these are resolved consent/session authorities and are not inferred from participant display identities |
| `previousEpochDigest`, `sessionDigest`, `authoritySignatureEnvelopeIds` | Generation and exactly one external envelope for each `requiredSignerIdentities` member |

Authentication or consent change, shell incompatibility, identity revocation, expiry, disconnect, or policy change advances or closes the presence-session epoch. An active session permits public presence and station-scoped Traveler arrival only. It conveys no docking, bridge, private destination, source, filesystem, or process authority.

### `RealmPoseV1`

Fields: Realm identity, virtual frame ID, quantized position and orientation, motion envelope, pose sequence, issue time, expiry, public shell revision, and external `signatureEnvelopeId`. A pose is presentation input, not evidence of physical location or authority.

### `TravelerAppearanceManifestV1`

| Field | Requirement |
| --- | --- |
| `appearanceId` | Signed public appearance content ID |
| `travelerIdentity` | Verified Realm Passport identity reference |
| `displayNameTextId` | `RealmSafeTextV1` reference; never identity proof |
| `archetypeId` | Safe Traveler archetype shipped with the application |
| `materialPresetId` | Allowlisted shipped material preset |
| `appearanceParameters` | Bounded quantized allowlisted values |
| `accessoryArchetypeIds` | Bounded safe shipped accessories only |
| `animationSetId` | Compatible shipped first-person-world animation set |
| `accessibilityProfile` | Non-sensitive visible communication preferences selected for sharing |
| `issuedAt`, `expiresAt`, `publisherIdentity`, `signatureEnvelopeId` | Lifetime and external authenticity envelope |

The manifest contains no remote mesh, texture, shader, script, URL, motion code, filesystem data, biometric template, or hidden collision. The verified identity badge and short fingerprint render independently of the display name.

### `TravelerPresenceGrantV1`

| Field | Requirement |
| --- | --- |
| `presenceGrantId` | Non-reusable signed grant ID |
| `travelerIdentity`, `homeRealmIdentity`, `hostRealmIdentity` | Exact participant binding |
| `appearanceId` | Verified `TravelerAppearanceManifestV1` |
| `presenceSessionId`, `presenceSessionEpoch` | Exact active authenticated and mutually consented station session |
| `arrivalGateId`, `permittedPublicDestinationIds` | Opaque public entry and movement scope |
| `rendezvousFrameId`, `rendezvousEpoch` | Present only after approach enters a RendezvousFrame |
| `bridgeEpoch` | Present only after an active bridge scope exists |
| `poseRateLimitProfileId` | Bounded update rate, velocity, acceleration, and packet budget |
| `issuedAt`, `expiresAt`, `operationNonce` | Lifetime and replay controls |
| `requiredSignerIdentities` | Canonically ordered host-policy and Traveler-consent authorities; participant identity fields do not implicitly become signers |
| `grantDigest`, `authoritySignatureEnvelopeIds` | Mutually bound grant evidence with exactly one external envelope per `requiredSignerIdentities` member |

This grant permits visible presence and bounded public locomotion only. It grants no filesystem, source, process, station-control, or destination authority.

### `TravelerPoseV1`

`TravelerPoseV1` is the host-authoritative projection. A visitor does not self-authorize a position inside another Cityform.

| Field | Requirement |
| --- | --- |
| `travelerPresenceGrantId` | Exact active presence grant |
| `travelerIdentity`, `hostRealmIdentity` | Authenticated identity and host |
| `frameId` | Host Realm or active RendezvousFrame coordinate ID |
| `movementIntentSequence` | Latest visitor intent consumed by this projection |
| `hostPoseSequence`, `logicalTick` | Monotonic authoritative host ordering and semantic time |
| `position`, `orientation` | Quantized bounded transform |
| `linearVelocity`, `angularVelocity` | Quantized bounded motion values |
| `locomotionState` | Idle, walk, run, jump, fall, arrive, depart, or registered safe state |
| `groundAnchorId` | Optional current public navigation anchor |
| `presenceSessionEpoch` | Always-required station and presence generation |
| `rendezvousEpoch`, `bridgeEpoch` | Present only for the matching active scope |
| `expiresAt` | Pose freshness limit |
| `correctionKind` | Accepted, clamped-to-navigation, blocked-by-collision, denied-by-scope, or reset-to-safe-anchor |
| `poseDigest`, `hostAuthoritySignatureEnvelopeId` | Host-authenticated projection evidence in an external envelope |

### `TravelerMovementIntentV1`

Fields: active presence-grant ID, Traveler and host identities, client intent sequence, last acknowledged host pose sequence, input tick range, bounded locomotion vector, look delta, jump, crouch, and sprint intent flags, active presence-session and conditional rendezvous or bridge epochs, issue time, expiry, operation nonce, intent digest, and external Traveler `signatureEnvelopeId`. It contains no interaction request, claimed final position, collision result, gate passage, or authority. Every world interaction uses the separate target, revision, authority, and idempotency-bound `RealmActionProposalV1` path.

The host orders intents, validates rate, speed, acceleration, current presence scope, navigation, collision, gate and bridge state, capability context, frame, expiry, and epochs, then emits `TravelerPoseV1`. Clients may predict locally but reconcile to the host projection and cannot use predicted pose to pick, traverse, reveal, or authorize. Other peers render only host-authoritative pose sequences.

Invalid intents are rejected or receive one policy-defined deterministic correction. Expiry, consent withdrawal, disconnect, identity revocation, presence-session change, bridge revocation, or host departure removes the Traveler before its final departure presentation completes.

### `RendezvousFrameV1`

Fields: frame ID, monotonic rendezvous epoch, canonical participant Realm identities, active presence-session ID and epoch, compatible protocol, canonical frame derivation inputs, origin policy, scale, start tick, lifetime, interpolation policy, participant pose watermarks, frame-receipt digest, and one external `participantSignatureEnvelopeId` per required signer. V1 frames are federated and temporary.

### `DockingOfferV1`

Fields: offer ID, requester and destination identities, direction, requester source public-gate ID, requested destination public-gate ID, requested route kind, requested action and capability class, active presence-session ID and epoch, active RendezvousFrame ID and rendezvous epoch, link transcript digest, both shell revisions, protocol and bridge-compiler versions, 256-bit non-reusable offer nonce, independent 256-bit proposed bridge-generation nonce, conditionally present expected previous bridge epoch for renegotiation, issue time, expiry, and requester `signatureEnvelopeId`.

The offer exists before a new bridge epoch is active and therefore never claims a current new `bridgeEpoch`. Its presence-session and rendezvous epochs prevent replay in another encounter. The proposed bridge-generation nonce reserves unique generation material but conveys no grant, key, route, or authority.

### `DockingGrantV1`

Fields: grant ID, matching offer ID and digest, both identities, direction, source and destination gate IDs, strict capability intersection, permitted opaque destination IDs, rate and lifetime limits, refinement policy, active presence-session ID and epoch, active RendezvousFrame ID and rendezvous epoch, link transcript digest, shell revisions, policy revision, capability epoch, proposed bridge-generation nonce digest, conditionally present previous bridge epoch, newly allocated bridge epoch, issue time, expiry, and authority `signatureEnvelopeId`.

The grant copies or digests every replay-sensitive offer binding and rejects any mismatch. Its newly allocated `bridgeEpoch` is prospective until the required directional grants, canonical recipe, both bridge digests, and `BridgeEpochV1` activation record verify. No protected route opens merely because one grant exists.

### `BridgeRecipeV1`

Fields: recipe ID, offer and required directional grant IDs and digests, endpoint sockets, active presence-session ID and epoch, RendezvousFrame ID and rendezvous epoch, proposed bridge-generation nonce digest, conditionally present previous bridge epoch, newly allocated bridge epoch, coordinate policy, procedural seed, safe shipped archetype IDs, compiler versions, width, clearance, collision, navigation, traversal, presentation class, and canonical recipe digest.

### `BridgeDigestV1`

Fields: recipe ID, bridge epoch, canonical semantic-output digest, compiler and numeric-policy IDs, client identity, verification decision, reason code, and external `signatureEnvelopeId`. GPU vertex bytes and raster pixels never determine authorization.

### `BridgeEpochV1`

Fields: bridge ID, non-reusable monotonic epoch number, conditionally present previous bridge epoch, canonical participant identities, active presence-session ID and epoch, RendezvousFrame ID and rendezvous epoch, offer and active directional grant IDs and digests, proposed bridge-generation nonce digest, recipe and both accepted bridge-digest IDs, key-generation references, activation event, end event where closed, policy revision, Chronicle sequence, and external `authoritySignatureEnvelopeIds`. V1 bridge activation requires exactly one envelope from every canonical participant; a future authority model with signers distinct from participants requires a new contract version. Activation requires all preceding bindings to agree exactly. Stale epochs cannot load refinements, source chunks, route messages, or interaction grants.

## Storylet contracts

### `RealmLogicalClockTickV1`

| Field | Requirement |
| --- | --- |
| `clockId` | Stable clock identity for one local, host, rendezvous, bridge, or replay scope |
| `scope`, `realmId`, `participantSetDigest` | Exact clock audience and participants |
| `clockEpoch`, `coordinatorTerm` | Generation and coordinator lease term |
| `tickRateNumerator`, `tickRateDenominator` | Fixed rational tick rate |
| `logicalTick` | Monotonic unsigned integer tick |
| `sourceChronicleSequence` | Optional authoritative semantic-event boundary |
| `previousTickDigest`, `tickDigest` | Hash-linked ordering evidence |
| `coordinatorIdentity`, `signatureEnvelopeId` | Coordinator identity is canonical context; its external envelope is required for shared scopes |

Local-private clocks are injected simulation clocks. Shared clocks are coordinator-issued and signed. A receiver never advances shared semantic state from local wall time. Expired, skipped beyond policy, regressing, wrong-term, or conflicting ticks pause the shared Storylet scope.

### `RealmDeterministicRandomStreamV1`

The exact V1 semantic random algorithm is PCG-XSH-RR 64/32, using exact unsigned integer arithmetic. Implementations must match these operations bit for bit:

```text
oldState = state
state = (oldState * 6364136223846793005 + increment) mod 2^64
xorshifted = uint32((((oldState >> 18) xor oldState) >> 27) mod 2^32)
rotation = uint32(oldState >> 59)
output = uint32((xorshifted >> rotation) |
                (xorshifted << ((-rotation) & 31)))
```

`seedMaterialDigest` is SHA-256 over domain-separated, length-prefixed canonical fields. `initialState` is the little-endian unsigned 64-bit value from bytes 0 through 7. `streamSelector` is the little-endian unsigned 64-bit value from bytes 8 through 15, and `increment = (streamSelector * 2 + 1) mod 2^64`. The first draw uses `initialState` as `oldState`. Implementations use native or software exact 64-bit integers, never floating-point emulation.

| Field | Requirement |
| --- | --- |
| `streamId` | Domain-separated stream identity |
| `algorithm` | Exact `pcg-xsh-rr-64-32-v1` discriminator |
| `seedMaterialDigest` | SHA-256 digest of domain, catalog, definition, instance, scope, epoch, and recorded seed inputs |
| `initialState`, `streamIncrement` | Exact unsigned 64-bit values derived by the preceding byte-order rule; increment must be odd |
| `drawIndex` | Exact number of outputs consumed before this decision |
| `selectionPolicy` | Canonical rejection-sampling policy for bounded integers or exact `uint32 / 2^32` real mapping |
| `streamDigest` | Canonical stream record digest |

Each semantic purpose derives its own domain-labeled substream, so adding decorative draws cannot shift candidate selection. For a positive unsigned 32-bit bound, rejection sampling computes `threshold = uint32(-bound) mod bound`, discards outputs below `threshold`, and returns `output mod bound`. A semantic real in `[0, 1)` is exactly `output / 4294967296`. The decision records the pre-draw index and consumed count. `Math.random()`, wall-clock entropy, client-local iteration order, and GPU randomness are forbidden for semantic output.

### `RealmStoryletCatalogV1`

| Field | Requirement |
| --- | --- |
| `catalogId`, `catalogVersion` | Immutable catalog identity |
| `realmType`, `variantKind`, `sourceProjectionRevision` | Exact Realm, audience variant, and pre-manifest source context |
| `topologyRootId`, `spatialLayoutPolicyId`, `rendererCompatibilityId` | Previously computed compatibility inputs; no manifest or bake ID |
| `audienceClass`, `disclosureClass` | Evaluation and output audience |
| `definitionRefs` | Unique definitions sorted by canonical `storyletId`, version, and definition hash |
| `safeTextRefs` | Canonically ordered names, captions, announcements, and labels in the same audience closure |
| `definitionCount`, `stateCount`, `transitionCount`, `proposalTemplateCount` | Exact bounded totals |
| `candidateIndexDigest` | Canonical event and fact index identity |
| `policyProfileId` | Trusted application-shipped ceiling profile |
| `storyletDependencyClosureId` | Independent audience Storylet closure containing definitions and cue resources but excluding this catalog record |
| `compilerVersion`, `catalogDigest` | Exact compiler and canonical catalog digest |
| `publisherIdentity`, `signatureEnvelopeId` | Publisher identity is canonical context; its external envelope is required outside owner-private scope |

The Storylet compiler first computes definitions and cue resources, then their subclosure, then the catalog. The bake dependency closure subsequently includes the catalog, its subclosure, and every referenced resource, while excluding the bake manifest and the bake closure record itself. The bake manifest can therefore reference both the already computed catalog and bake closure without a cycle.

Duplicate IDs or versions, inconsistent ordering, unreachable definitions, policy-ceiling violations, cross-audience references, incomplete closure, self-reference, or dependency cycles reject the whole catalog. Remote catalogs never merge into the kernel safety catalog.

### `RealmStoryletCatalogValidationReceiptV1`

| Field | Requirement |
| --- | --- |
| `receiptId` | Stable external evidence identity |
| `validatedVariantKind`, `validatedAudienceClass`, `validatedDisclosureClass` | Exact private/owner-private/local-private, public-shell/public-explicit/public-explicit, or access-refinement/capability-refined/capability-refined tuple |
| `catalogId`, `catalogDigest`, `candidateIndexDigest` | Exact accepted catalog and independently recomputed candidate-index binding |
| `storyletDependencyClosureId`, `storyletDependencyClosureDigest` | Exact accepted Storylet subclosure, which excludes the catalog |
| `policyProfileId`, `policyDigest` | Exact application-owned policy revision |
| `stationKitId`, `stationKitContentId` | Exact reviewed station context |
| `definitionCount`, `stateCount`, `transitionCount`, `proposalTemplateCount`, `dependencyReferenceCount` | Recomputed non-negative totals |
| `authoringEvidenceIds`, `checkedInvariantIds` | Canonical evidence and non-empty invariant sets |
| `result` | Exactly `passed`; failures do not receive a receipt |
| `issuedAt` | Absent for deterministic private validation and required for transported variants |
| `publisherIdentity`, `receiptDigest`, `signatureEnvelopeId` | Exact publisher, self digest, and external signature envelope |

This receipt is local certification evidence. It is not a Storylet resource, catalog member, dependency-closure member, manifest dependency, action authority receipt, or permission grant. Public publication strips it and its signature. Refinement keeps it only inside authenticated ciphertext.

### `RealmStoryletInputSnapshotV1`

This is the exact deterministic fact projection consumed by trigger evaluation. It is derived from observations and current authority, but it is not a raw `RealmObservationSnapshotV1`.

| Field | Requirement |
| --- | --- |
| `inputSnapshotId` | Domain-separated canonical snapshot digest |
| `catalogId`, `bakeId`, `policyRevision` | Exact evaluation context |
| `audienceClass`, `scope`, `realmId` | Exact audience and Realm |
| `participantIdentities`, `participantSetDigest` | Canonically sorted set visible to this scope |
| `clockId`, `clockEpoch`, `logicalTick` | Exact semantic time boundary |
| `sourceWatermarks` | Canonically sorted adapter ID, schema version, generation, and source sequence tuples |
| `factRecords` | Unique canonical `(factKind, subjectId, value)` records after audience filtering |
| `metricStates` | Quantized values, sample-window ticks, threshold bands, hysteresis state, and last-transition tick |
| `capabilityFactRefs` | Opaque allow or deny receipt references visible to this scope, never raw capability tokens |
| `presenceSessionEpoch`, `rendezvousEpoch`, `bridgeEpoch` | Present only for active matching scopes |
| `coordinatorLeaseId`, `coordinatorTerm` | Required for shared scope |
| `snapshotDigest` | Canonical digest over every preceding semantic field |

Fact records use registered schemas, exact-key validation, stable audience IDs, canonical ordering by fact kind and subject ID, and deterministic scalar encoding. Duplicate or conflicting facts reject the snapshot. Facts that are denied, expired, stale beyond the trigger's declared policy, private to another audience, or not in the catalog's allowlist are excluded or represented by an explicit safe availability fact.

Wall-clock capture times, network arrival order, renderer frame time, local locale, GPU values, object iteration order, unquantized floating samples, private facts, and client-only decorative state never enter the snapshot digest. Expiry and freshness are converted to logical-tick facts by the authoritative adapter or shared coordinator before projection. All shared participants verify the same snapshot digest before accepting a shared decision.

### `RealmStoryletPolicyV1`

This application-shipped policy is not authored by a remote Realm.

Fields: policy profile ID and revision, trusted source classes, allowed Storylet categories by source class, allowed scope and audience pairs, bounded priority bands, reserved local-kernel safety band, allowed presentation channels, per-channel concurrency and duration ceilings, cue frequency and audio-level ceilings, actor and archetype allowlists, action-proposal allowlists, candidate-work quotas, persistence and telemetry limits, accessibility requirements, policy digest, and external platform `signatureEnvelopeId`.

Remote or public catalogs cannot claim security, identity-verification, permission, emergency, revocation, or kernel-warning presentation channels. They cannot obscure, imitate, preempt, or starve local safety cues. Data-only content is still untrusted content.

### `RealmStoryletCoordinatorLeaseV1`

| Field | Requirement |
| --- | --- |
| `coordinatorLeaseId`, `scope`, `instanceGroupId` | Exact shared coordination scope |
| `participantIdentities`, `participantSetDigest` | Canonically ordered authenticated participants |
| `coordinatorIdentity` | Mutually selected coordinator |
| `coordinatorTerm` | Monotonic term |
| `catalogId`, `bakeId`, `clockId` | Exact shared semantic context |
| `presenceSessionEpoch`, `rendezvousEpoch`, `bridgeEpoch` | Present only for the matching shared scope |
| `startTick`, `endTick`, `expiry` | Bounded lease lifetime |
| `selectionRule` | Host for `host-realm`; mutually signed docking or rendezvous authority for shared scopes |
| `previousLeaseDigest`, `leaseDigest`, `participantSignatureEnvelopeIds` | Failover and agreement evidence with one external envelope per required participant |

There is no unilateral two-party failover. A coordinator change occurs only while shared instances are paused at a recorded safe boundary and every remaining authorized participant signs the next term. Partition or lease expiry freezes or cancels shared semantics according to policy. Two different decisions for one term and logical tick are split-brain evidence: clients quarantine the decisions, present a safe degraded state, and revoke or renegotiate the bridge rather than choosing a winner locally.

### `RealmStoryletDefinitionV1`

| Field | Requirement |
| --- | --- |
| `format`, `version`, `storyletId`, `definitionVersion`, `definitionHash` | Immutable contract and semantic definition identity |
| `realmType`, `category`, `tags` | Registered authored classification |
| `audienceClass`, `disclosureClass`, `scope` | Exact evaluation and output audience |
| `priority`, `concurrencyClass` | Signed 16-bit policy-bounded priority and registered concurrency class |
| `descriptionTextId`, `presentationChannels` | Audience-safe description and canonical policy-allowed presentation channels |
| `selectionGroupId`, `selectionPolicy`, `selectionWeight` | Optional canonical-first or policy-allowed weighted-one group; positive unsigned 16-bit weight only for weighted-one |
| `triggerExpression` | Bounded data-only expression over allowlisted facts |
| `cooldownTicks`, `maximumActivations` | Logical-time limits |
| `requiredSemanticPredicates`, `requiredCapabilities` | Bounded conjunctions over registered provenance, evidence-quality, availability, freshness, temporal-mode, and assertion-state fields, plus narrow capability preconditions; never grants |
| `requiredAnchorIds`, `requiredBakeRevision`, `requiredSocketIds`, `dependencyRefs` | Exact station/bake bindings and complete audience-safe closure |
| `initialEpisodeState`, `states`, `transitions` | Deterministic bounded state machine |
| `presentationProposalRefs`, `actionRequestProposalRefs` | Data-only allowlisted proposal templates |
| `expiryPolicy`, `cancellationPolicy`, `participantDropPolicy` | Explicit terminal behavior |
| `chroniclePolicy`, `replayPolicy` | Canonical policy IDs for later semantic history and replay behavior |
| `accessibilityRefs`, `localizationRefs` | Captions and alternatives |
| `safeTextRefs` | Exact `RealmSafeTextV1` names, captions, announcements, signs, and dialogue references used by this definition |
| `compilerVersion` | Exact compiler identity |

Definitions contain no JavaScript function, module, shader, URL, worker, WASM, arbitrary expression language, or remote executable content.

### `RealmStoryletProposalTemplateV1`

| Field | Requirement |
| --- | --- |
| `proposalTemplateId`, `templateDigest` | Immutable template identity and self digest |
| `proposalKind` | Exactly `presentation` or `action-request` |
| `subjectBinding`, `truthBinding` | Closed trigger-subject and trigger-truth binding objects |
| `audienceClass`, `disclosureClass` | Exact output audience |
| `parameters` | Canonically ordered parameter IDs with bounded tagged-scalar values; text-valued IDs must be in `safeTextRefs` |
| `presentationChannel` | Present exactly for `presentation` |
| `actionKind`, `idempotencyDomainId` | Present exactly for `action-request` |
| `startCondition`, `terminationCondition`, `maximumDurationTicks` | Closed lifecycle conditions and positive duration ceiling |
| `reversibilityClass`, `cleanupPolicy` | Explicit reversal and cleanup behavior |
| `dependencyRefs`, `accessibilityRefs`, `safeTextRefs` | Canonical same-audience dependencies; accessibility references are safe-text references and safe text is in the dependency set |
| `compilerVersion` | Exact compiler identity |

Templates are data, not executable Storylets. An action-request template remains powerless until a later runtime adapts a validated proposal through the generic action-authority and authoritative-observation path.

### `RealmStoryletDecisionV1`

Fields: decision ID, catalog ID, storylet ID, definition hash, episode ID and expected revision, instance-recipe ID, `RealmStoryletInputSnapshotV1` ID and digest, candidate-set hash, clock ID and epoch, logical tick, coordinator lease ID and term, random-stream ID, pre-draw index and consumed-draw count, tie-break ordinal, selected flag, reason code, canonically ordered `proposalDigests` array containing zero or more exact proposal digests, audience class, policy revision, conditionally present capability, presence-session, rendezvous and bridge epochs, coordinator identity, decision digest, and external coordinator `signatureEnvelopeId` for shared scopes.

### `RealmStoryletProposalV1`

Fields: proposal ID, proposal kind, subject ID, truth reference, audience class, parameters, start and termination conditions, maximum duration ticks, required capability, conditionally present capability, presence-session, rendezvous and bridge epochs, reversibility class, dependency references, idempotency key for action requests, and proposal digest.

Presentation proposals can create only allowlisted reversible presentation handles. An action-kind Storylet proposal is validated and adapted into one `RealmActionProposalV1`, preserving the Storylet proposal ID, decision ID, instance ID, truth reference, and idempotency key. It then uses the same `RealmActionAuthorityReceiptV1` and authoritative result observation as a direct Traveler interaction.

### `RealmStoryletActionCorrelationV1`

Fields: correlation ID, Storylet instance ID, episode revision, decision ID, Storylet proposal ID and digest, adapted `RealmActionProposalV1` ID and digest, `RealmActionAuthorityReceiptV1` ID, authoritative action-result observation ID, audience class, logical tick, terminal correlation state, and correlation digest. This record contains no new decision, authority, capability, scope, or permission semantics; it only proves which generic action records satisfied the Storylet's waiting phase.

### `RealmStoryletInstanceRecipeV1`

Fields: deterministic instance ID, catalog ID, definition hash, bake ID, source-event references, input-snapshot hash, audience and scope, Realm and policy revision, conditionally present capability, presence-session, rendezvous and bridge epochs, clock ID and epoch, random-stream ID and recorded seed material digest, logical start tick, allowed phase graph, participant set and digest, drop policy, bounded presentation-channel reservations within `RealmStoryletPolicyV1`, coordinator lease ID and term when shared, issue time, expiry, and external `participantSignatureEnvelopeIds` for shared scopes. Shared acceptance requires exactly one envelope from every canonical participant; local-private acceptance requires an empty envelope set. The recipe conveys no capability.

### `RealmStoryletInstanceHeadV1`

This is the persisted outer scheduler head. It is separate from the authored episode head and records the state that owns admission, channel reservations, shared coordination, interruption, recovery, and terminal cleanup.

| Field | Requirement |
| --- | --- |
| `instanceId`, `instanceRecipeId`, `catalogId`, `definitionHash`, `bakeId` | Exact immutable instance context |
| `schedulerState` | `inactive`, `candidate`, `eligible`, `reserved`, `active`, `waiting`, `paused`, `interrupted`, `degraded`, `completed`, `denied`, `cancelled`, `expired`, `superseded`, `failed-pivot`, or `repair` |
| `revision`, `expectedPreviousRevision` | Monotonic compare-and-swap state revision |
| `episodeHeadId`, `episodeHeadRevision`, `episodeHeadDigest` | Present after an authored episode head exists; absent before episode start |
| `inputSnapshotId`, `supportingTruthRefs` | Exact admitted facts and currently supporting evidence |
| `channelReservations` | Canonically ordered deterministic reservation IDs, channel IDs, acquisition ticks, states, and release obligations |
| `pendingProposalIds`, `pendingActionCorrelationIds` | Bounded canonical work awaiting completion, denial, cancellation, or cleanup |
| `cleanupObligations` | Canonical presentation-command, reservation, and temporary-resource IDs with required terminal cleanup state; never renderer handles or JavaScript objects |
| `recoveryState`, `irreversiblePivotState`, `repairDefinitionRef` | `none`, `pending`, `compensating`, `repairing`, `cleaning`, `clean`, or `blocked`; pre-pivot or post-pivot classification; trusted repair reference only when required |
| `reasonCode` | Registered pause, interruption, degradation, denial, cancellation, failure, or terminal reason |
| `clockId`, `clockEpoch`, `logicalTick`, `policyRevision` | Exact semantic time and policy |
| `capabilityEpoch`, `presenceSessionEpoch`, `rendezvousEpoch`, `bridgeEpoch` | Present only for matching active scopes |
| `coordinatorLeaseId`, `coordinatorTerm` | Required for synchronized shared state and absent otherwise |
| `previousHeadDigest`, `headDigest` | Hash-linked outer-state history |
| `audienceClass`, `terminalState` | Exact persistence audience and optional terminal classification |

Only `RealmStoryletScheduler` may propose ordinary outer transitions. The truth reconciler may request interruption, degradation, resumption, or cancellation; the coordinator lease controls shared pause and resume; and `RealmStoryletFailureCoordinator` alone may propose `failed-pivot` or a trusted `repair`. The state store accepts a head only when the expected revision, predecessor digest, recipe, bake, policy, clock, active epochs, coordinator term, reservation ownership, and referenced episode head all match. Cleanup obligations survive cancellation and restore until a later expected-revision head records the terminal cleanup result returned by the owning presentation or reservation port.

### `RealmStoryletEpisodeHeadV1`

Fields: episode ID, instance-recipe ID, catalog ID, definition hash, bake ID, current authored state ID, expected previous revision, revision, clock ID and logical tick, policy revision, conditionally present capability, presence-session, rendezvous and bridge epochs, coordinator lease ID and term where shared, bounded pending proposal IDs, terminal state if present, evidence references, previous-head digest, head digest, and audience class. Restore requires exact scope and every active epoch to match; inactive-scope epoch fields must be absent. The head is data-only, is computed before any persistence receipt, and cannot execute tools or grant authority.

### `RealmStoryletPersistenceReceiptV1`

Fields: receipt ID, head family (`instance` or `episode`), head ID, revision and digest, instance-recipe ID, audience class, persistence-policy ID, encrypted-store opaque record ID, encryption profile and key epoch, expected previous persisted revision, accepted persisted revision, compare-and-swap result, write or restore operation, issue time, safe reason code, previous receipt digest, receipt digest, and external trusted-local or shared `authenticatorEnvelopeIds` where policy requires them. The receipt is external to the head's identity, cannot be referenced by the head it stores, and conveys no authority. Restore succeeds only after the head digest, encrypted envelope, key epoch, receipt chain, scope, policy, and current active epochs verify.

## Presentation contract

### `RealmPresentationCommandV1`

| Field | Requirement |
| --- | --- |
| `commandId`, `commandKind` | Deterministic identity and allowlisted light, audio, particle, sign, actor, route-emphasis, glyph-style, or visor operation |
| `subjectId`, `anchorId` | Existing safe targets |
| `audienceClass`, `provenanceClass`, `evidenceQuality` | Audience, source lineage, and quality |
| `availabilityState`, `freshnessState`, `temporalMode`, `assertionState` | Access, freshness, time context, and confirmation status |
| `sourceRefs` | Bake, observation, Storylet, or Chronicle evidence |
| `logicalStartTick`, `logicalEndTick` | Bounded lifetime |
| `parameters` | Strict presentation-only payload |
| `reversibility` | Cleanup behavior and returned handle class |
| `accessibilityEquivalent` | Semantic mirror and caption reference |

The presentation dispatcher returns a disposable handle. A presentation command cannot grant authority, mutate the OS, become Chronicle truth, or change stable bake resources.

## Chronicle contract

### `RealmChronicleEventV1`

Fields: event ID, Realm ID, semantic event kind, source authority, subject opaque IDs, parent event hash, sequence, logical tick, audience class, disclosure class, provenance class, evidence quality, availability state, freshness state, temporal mode, assertion state, bake revision, bridge and capability epochs where applicable, bounded semantic payload, referenced receipts, event digest, signer identity, and external `signatureEnvelopeId`.

Chronicle stores semantic transitions and references rather than raw source, paths, packets, keys, capabilities, private geometry, or unnecessary precise timing. Storylet decisions reference Chronicle facts but remain a separate record family.

## Validation order

Every receiver applies this order:

1. Enforce transport byte and decompression bounds.
2. Parse with duplicate-key rejection.
3. Verify exact format and compatible major version.
4. Enforce exact keys, types, lengths, numeric ranges, depth, and count limits.
5. Normalize and canonicalize without filling signed defaults.
6. Recompute content digests.
7. Verify signature, publisher identity, audience, expiry, nonce, and replay state where applicable.
8. Verify dependency closure and resource budgets.
9. Verify bake revision, shell revision, policy revision, capability epoch, and bridge epoch.
10. Verify domain invariants and current authority.
11. Allocate bounded runtime or GPU resources.
12. Publish an acceptance or rejection receipt without echoing protected payloads.

## Compatibility and migration

- Readers accept only explicitly supported major versions.
- Minor-version additions require an explicitly declared extension surface; ordinary unknown keys still fail.
- Migration occurs in a trusted adapter before signing or runtime acceptance.
- A migrated record receives a new content digest and a receipt linking the source and destination versions.
- Replay never silently substitutes a present-day definition, compiler, policy, or bake for the recorded identity.
- Missing historical artifacts produce an explicit degraded replay state.
- Downgrade negotiation cannot remove an authority, privacy, signature, epoch, audience, or resource-limit requirement.

## Contract acceptance gates

- Every record has one owning module and one authoritative producer.
- Every audience boundary has a separate ID namespace and dependency closure.
- Every action path distinguishes proposal, authority receipt, authoritative observation, and presentation.
- Strict parsers reject executable or ambient remote content.
- Deterministic fixtures produce the same canonical bytes and digests across supported clients.
- Fuzzing covers duplicate keys, deep nesting, huge arrays, malformed Unicode, numeric edge cases, digest mismatch, signature failure, replay, expiry, downgrade, and stale epochs.
- Logs and error receipts disclose only safe reason codes and opaque IDs.
- No contract creates a camera outside the approved grounded Traveler and owner-private local Operations modes, a nested manager hierarchy, a privileged renderer path, or a Node.js dependency.
- Local operator records structurally exclude public, refinement, replay, PresenceSession, RendezvousFrame, bridge, remote Cityform, remote Traveler, and remote-world fields. Cross-record acceptance rejects foreign Realm resources before scene assembly.
- Public and refinement compiler results are local verification packages. Publication plans explicitly remove owner-private/local-private receipts, their signature envelopes, and local publication receipts from transportable artifacts.

## M0 implementation freeze

The executable M0 contract surface is frozen under `webgpu-os/apps/the-virtual-realm/contracts/`. It contains one flat ES module for each contract in the architecture inventory, one ordered catalog, a strict plain-JSON trust-boundary validator, an atomic versioned registry, the canonical content and signature-preimage encoder, and exact PCG/logical-clock primitives. It has no renderer, scanner, persistence mutation, network session, or Storylet execution path.

The concrete V1 wire decisions selected where the prose above names a bounded composite are:

- Unsafe JSON integers never enter ordinary record JSON. Unsigned 64-bit clock, counter, PCG state, and increment values use their contract's canonical fixed-width lowercase hexadecimal or unsigned decimal string schema. Binary preimages encode them as exact unsigned big-endian integers.
- Nested policies, source records, layout records, Storylet expressions, semantic values, and presentation parameters are strict closed objects with explicit discriminators and bounded arrays. There is no arbitrary extension object in V1.
- Public and authority-bearing identifiers remain bounded opaque identifiers at M0. Concrete identity, content-locator, multicodec, key, and signature encodings are verified by their registered profile before an authority or publication boundary; an opaque lexical match alone grants nothing.
- `RealmSafeTextV1.graphemeCount` is structurally bounded and is recomputed with the frozen `particle-realms-grapheme-v1` segmentation profile. The profile explicitly covers the V1 combining-mark, variation-selector, emoji-modifier, ZWJ-sequence, and regional-indicator rules; unsupported or ambiguous input fails closed. UTF-8 length, NFC, well-formed Unicode, control, bidi-control, markup, URL, and purpose rules are enforced before layout.

The shared synthetic M0 fixture is `tests/network/realm/virtual-realm-m0-vectors-v1.json`. The current browser suite imports and registers all 109 ordered contract modules, validates every minimal example, removes every required field in turn, injects unknown keys, exercises adversarial JavaScript shapes and limits, and verifies canonical bytes, SHA-256 content IDs, signature preimages, PCG rejection sampling, and logical-clock vectors. A dedicated local-operator harness verifies view authority, camera bounds, local map closure, zone proposals, and byte-identical output across different structurally excluded connected-city inputs. The independent Python suite recomputes the cross-language byte, digest, PCG, and logical-clock results. Neither suite reads a real source tree or uses the excluded application as a fixture.

## M1A, M1B, and M1C additive contract inventory

M1A adds `RealmBakeResourceLimitProfileContract`, `RealmProofGatedOptimizationReceiptContract`, and `LocalOperationsLookupResourceContract` without changing the accepted 100-module M0 boundary. Its verified catalog count was 103. Ordered-catalog and fixture conformance passed in the 36/36 contract suite; deterministic private compilation, cross-record verification, proof gates, limits, publication, and rollback passed in the 15/15 M1A browser suite. The independent M0 canonical vector suite remains the cross-language encoding oracle.

M1B adds `RealmPublicAppearanceSourceContract`, `RealmRefinementEncryptionEnvelopeContract`, `RealmPublicNoninterferenceReceiptContract`, and `RealmRefinementScopeReceiptContract`. Its verified ordered catalog count was 107. These additions harden the existing public-shell and access-refinement roots without changing the flat, independently owned M0/M1A modules.

M1C adds `RealmStoryletProposalTemplateContract` and `RealmStoryletCatalogValidationReceiptContract`, hardens `RealmStoryletDefinitionContract`, and extends the existing resource-limit and bake-receipt contracts without adding nested ownership. The current ordered catalog count is 109. The 39-case contract browser suite, six independent Python vectors, M1A 15/15 regression, M1B 21/21 regression, and M1C 35/35 integrated gate verify the contract and implementation boundary. (Source: `webgpu-os/apps/the-virtual-realm/contracts/VirtualRealmContractCatalog.js`.)

## Separate Genesis authoring catalogs

RealmForge RF-GE0 through the bounded inert RF-GE5 authoring gate are complete.
These states do not append to or
renumber `VIRTUAL_REALM_CONTRACT_DEFINITIONS`:

| Genesis boundary | Contract status | Effect on the accepted Virtual Realm catalog |
| --- | --- | --- |
| RF-GE2 constructive catalog | `ProductGenomeV1`, `FactoryGenomeV1`, `GenomeRevisionReferenceV1`, and `GenesisExecutionPlanV1` are four separate strict Genesis authoring records | None; all four live outside the frozen 109-record ordered catalog |
| RF-GE3 recursive candidate | Uses the already separate `GenesisPartV1` Parts-family wire contract for the candidate | None; it neither adds a base record nor moves `GenesisPartV1` into the base catalog |
| RF-GE3 package descriptor | Deterministic compiler-internal descriptor that binds both candidate logical identity and candidate content identity | Not a new published wire-contract family and not a catalog definition |
| RF-GE4 interpreter evidence | Ten authored-program kinds represented by the accepted twelve-record golden corpus, eight deterministic interpreter fragments, one exact context-bound aggregate Plan, and a sealed eighteen-descriptor verification-only trust pack | None; these are bounded RealmForge evidence and do not enter the frozen catalog or authorize runtime interpretation |
| RF-GE5 ecology evidence | Eleven evidence-program kinds, ten deterministic evidence fragments, one exact aggregate Plan bound to verified RF-GE4 closure, and a sealed twenty-one-descriptor verification-only trust pack | None; these are bounded RealmForge evidence and do not enter the frozen catalog, mint identity, or authorize runtime behavior |

The RF-GE2 compiler output, RF-GE4 interpreter Plan, and RF-GE5 evidence Plan
remain `not-executed`, and the RF-GE3 candidate remains ineligible for
publication. None of these separate catalogs supplies runtime authority,
an M2/M3 dependency, or a reason to change the separate M2 and M3A catalog
counts.

## M2 runtime catalog (implementation underway)

M2 does not append records to the frozen 109-contract catalog. It introduces a
separate opt-in
`runtime-contracts/VirtualRealmM2RuntimeContractCatalog.js` for local runtime
admission, materialization, lifecycle, recovery, and evidence. None of these
records is a public wire contract, authoring record, capability token, or
replacement for the accepted activation contracts.

| Planned contract | Purpose |
| --- | --- |
| `RealmRuntimeCapabilityProfileV1` | Bind the complete exact Engine/adapter/API/numeric identities, sorted feature/adapter/active-bake-CSE method arrays, service-port name/version, 65,536-byte handoff, materialization, admission, fixed-control, trust, root/artifact/evidence-directory, journal, and GC limit object plus its self-digest |
| `RealmRuntimeSessionV1` | Bind operator partition, local Realm, lifecycle generation, durable admission head, visible bundle, policy, and local session state |
| `RealmPrivateBakeAdmissionIndexV1` | Reconstruct and verify one complete owner-private M1C v2 package after restart |
| `RealmStaticBakeLoadReceiptV1` | Record package verification, dependency resolution, ceilings, staging, and candidate identity after load |
| `RealmStaticStoreSnapshotV1` | Record immutable admitted indexes and their generations |
| `RealmEcsMaterializationReceiptV1` | Bind stable objects to replaceable ECS and presentation slots with exact counts and digest |
| `RealmViewTransitionReceiptV1` | Record explicit first-person/Operations transition and safe-anchor restoration |
| `RealmDeviceRecoveryReceiptV1` | Bind lost and replacement device generations, rebuilt resources, restored source, and resumed state |
| `RealmRuntimeDisposalReceiptV1` | Prove abort, detach, input release, listener removal, resource disposal, and zero remaining owner |
| `RealmArtifactStoreActivationReceiptV1` | Record immutable admission capsule/index readback and durable admission-head compare-and-swap |
| `RealmRuntimeHandoffRecordV1` | Transfer exact digest-bound operator/Realm head bindings, profile, durable handoff generation, service-injected process-owner/lifecycle/root/manager lineage, bundle plus required verified checkpoint binding, safe anchor, policy, logical cursor, and the sole caller-authored Operations request through a typed bounded observation; the active handoff root retains the complete protected checkpoint graph edge, the trusted manager exposes a record only after matching root/binding recovery, and clear writes a monotonic tombstone; never live handles, unbound restoration state, or caller-authored checkpoint IDs |

The table order is the catalog order. The target graph is exactly 13 modules:
one primitive module, the 11 complete definition modules above, and one catalog
module. It reuses `VirtualRealmContractRegistry`; there is no second registry
implementation and no combined 120-record export. A definition is registered
only when its complete schema, semantic validator, minimal fixture, canonical
vector, and owning test slice land together. An intermediate implementation may
not pass M2A until all 11 complete definitions are present; placeholder records
and partially registered catalogs are rejected atomically.

`RealmPrivateBakeAdmissionIndexV1` is required because the current private
publisher persists resource record text, closure, and manifest but not the
complete 17-key M1C package. The exact-key index binds the owner partition,
Realm, M1 publication root/generation/storage SHA, package format/version,
exact-byte package identity and independent RealmForge digest,
manifest and closure, the chunked resource/evidence/signature inventory
roots/digests/counts/byte totals, policies, limits, layout, local lookup,
optimization and bake receipts, Storylet catalog and validation receipt,
reviewed station evidence, exact signature-envelope bindings, verifier
identity, runtime-capability profile ID/digest, admission-policy
revision/digest, and its own canonical digest. Its exact V1 content shape has 71
required fields; mutable admission operation, generation, and previous-head
chronology exist only in the private storage-head codec. (Source:
`webgpu-os/apps/realmforge/virtual-realm/publication/RealmBakePublisher.js`.)

M2 reuses the accepted `RealmBakeActivationOfferV1`,
`RealmBakeActivationReceiptV1`, `LocalOperatorViewPolicyV1`,
`RealmActionProposalV1`, `RealmActionAuthorityReceiptV1`, and
`SignatureEnvelopeV1` contracts. It does not create parallel authority or
activation formats. The [M2 runtime foundation](m2-runtime-foundation.md)
defines the dependency order. [M2A runtime composition](m2a-runtime-composition.md)
freezes the module graph and app boundary; [M2B private-bake admission](m2b-private-bake-admission.md)
freezes the exact admission schema and package-member role map, three internal
chunked inventories, fixed seven-record protocol including terminal-audit,
immutable evidence
policy, authenticated reviewer and five-role signature closure, activation
guard with protected nondecreasing durable clock, exact assertion projections,
post-pin synchronous immediate-time safety decision, live-visibility/close/
supersession receipts, and a single fenced active-bake CSE predecessor,
Realm-scoped durable roots, monotonic checkpoint/handoff managers, future
bounded GC directories/journals, migration, restart, rollback, and test ledgers.

The provider-free B4F `RealmLocalOperatorPolicyPortContract` is a runtime wire
validator, not a record in either catalog. It therefore leaves the frozen
109-record M0-M1C inventory and the 11-definition, 13-module M2 runtime-record
catalog unchanged. Historical B4F acceptance recorded 60/60 hostile browser
cases and 11/11 independent Python proofs; its contract, shared dependency,
Entry, and production-composition closures were then exactly 11, 23, 105, and
47 acyclic error-free modules. Its scoped Python group passed 59/59, or 64/64
including the then-29-module renderer closure; B4A-B4F plus M2A and B3 browser
regressions passed 328/328 with zero skips.

### M2D-B4G terminal compatibility wire

`RealmLegacySurfaceFramePort` is a complete stateless compatibility
implementation, not a new catalog definition. It preserves the exact
four-field `surfaceFrame@1` port: `portName`, `version`, `acquireSurface`, and
`registerFrameProducer`. The configuration-free factory returns one frozen
null-prototype module-local singleton. Admission requires that exact identity;
structurally matching copies, wrappers, and substituted methods are rejected
without inspecting their properties.

Neither method admits a request. Both synchronously return the same frozen
null-prototype `{ status: 'unavailable', reasonCode: 'realm-gpu-presentation-required', recoverable: false }`
and ignore all arguments and their receiver. The result is safe to await but
grants no surface, frame, callback, disposal, or retry authority. GPU work uses
only the separate accepted owner-coupled `realmGpuPresentation@1` path.

The exact dependency-v2 record stays at 16 keys, the M0-M1C catalog stays at
109 records, and the M2 runtime-record catalog stays at 11 definitions across
13 modules. Production composition admits the terminal port before GPU
syscall, runtime-profile, or process-owner processing. The focused B4G browser
gate passes 24/24; current integration evidence is in the
[B4G compatibility acceptance ledger](m2-runtime-foundation.md#m2d-b4g-terminal-legacy-surfaceframe-compatibility).
B4H is underway but unaccepted. Its protected policy/selection/lifecycle
sources and versioned host-attempt binding remain non-provider prerequisites;
none registers the complete authority provider. (Sources:
`webgpu-os/apps/the-virtual-realm/runtime/RealmLegacySurfaceFramePort.js`;
`webgpu-os/apps/the-virtual-realm/runtime/RealmRuntimeDependencyContract.js`;
`webgpu-os/kernel/realm/RealmRuntimeAttemptBinding.js`;
`webgpu-os/kernel/realm/RealmM2RuntimeComposition.js`;
`tests/virtual-realm/m2-legacy-surface-frame-port.test.js`.)

## Planned M3B projection catalog

M3B introduces a separate opt-in
`projection-contracts/VirtualRealmM3BProjectionContractCatalog.js`. It does not
append to or renumber the accepted 109 definitions, the planned M2 runtime
catalog, or the planned M3A observation catalog. It reuses existing M0
observations, metrics, deltas, delta payloads, projection bindings, presentation
commands, semantic axes, resource references, canonical encoding, preflight,
limits, and registry behavior.

The M3B catalog order is exact:

| Order | Planned definition | Purpose |
| ---: | --- | --- |
| 1 | `RealmProjectionRuntimeProfileV1` | Exact 57-field deterministic work/retention profile with 47 numeric ceilings, exact 16-field pre-freeze work-count plan, conservative 347137 independent-ceiling work sum without simultaneous-attainability claim, retained-root aggregate enforcement, and one pool shared by the 24/18/18-field application, recovery, and selector-retirement journals |
| 2 | `RealmProjectionDomainManifestV1` | Nine ordered versioned projector/binding rows, eight unique primary owners, maximum seven primary deltas, one zero-owner/one-delta witness, and an embedded 16-field recipe matrix with 53 event rows, 130 primary operation slots, 16 descriptor roles, and one witness recipe |
| 3 | `RealmProjectionRuntimeBindingV1` | Exact 53-field logical M2/M3A/static/policy/catalog binding with separate M3 transaction-capability and semantic-policy pairs and no presentation/device state |
| 4 | `RealmProjectionDisclosurePolicyV1` | Exact 11-field policy, nine ordered 13-field owner-private preserve-or-omit rules, six closed per-axis omission reasons, and one exact transition-policy pair |
| 5 | `RealmProjectionInputCutV1` | Closed 28-field vocabulary for exactly observation-batch, source-state, or expiry cuts; expiry carries the exact due-receipt pair, and binding change is lifecycle, not a cut |
| 6 | `RealmDisclosureDecisionSetV1` | One byte-preserving inclusion or payload-free omission per input record |
| 7 | `RealmProjectionBatchV1` | Exact 41-field batch containing primary/witness/maintenance outcomes, frozen M0 deltas, static/authority evidence, powerless structural evidence, counts, order, complete closure, and equal-length dynamic `presentationCommandIds`/`presentationCommandDigests` arrays |
| 8 | `RealmProjectionAppliedCursorV1` | Independent applied M3A/projection position with no root backlink |
| 9 | `RealmDynamicStoreSnapshotV1` | Self-contained immutable six-channel state, disjoint historical lane, exact nested source-generation and finite-expiry evidence, seven-slot health overlay, and lineage accumulator |
| 10 | `RealmEcsProjectionChangeSetV1` | Exact per-kind operation/ABA matrix plus the complete stable-ID M3B overlay using only baked-anchor-equal `Transform` and shipped `Renderable` |
| 11 | `RealmStateFirstSourceSnapshotV1` | One flat unique semantic-only CPU source array whose dependency rows preserve every merged channel/source-generation/expiry contributor, with full/dirty counts and no visibility or representation decision |
| 12 | `RealmProjectionApplicationIntentV1` | Closed 42-field empty/present expected-head proposal over the complete candidate, closure, deterministic lease-target set, generations, authorized ready-or-recovering presentation fence, and idempotency, with no unissued lease receipt |
| 13 | `RealmProjectionApplicationReceiptV1` | Closed 37-field bundle/selector result with dispatch state, journal, durable selector-CAS, retention, conflict, noncommit, and uncertainty evidence |
| 14 | `RealmProjectionRecoveryReceiptV1` | Closed 37-field same-binding restore/replay, uncertain-commit reconciliation, exact post-device-loss CPU catch-up and closed-to-ready reveal, or complete-static-fallback evidence bound to the terminal 18-field recovery-attempt evidence and issued only through commit-port `recover()` |
| 15 | `RealmProjectionStateRootV1` | Closed 37-field self-contained `projection-root`, exact root-owned reader and recorded-authority evidence escrow, lease-target closure, bounded lineage accumulator, and directly bound root-store-authored floor anchor |
| 16 | `RealmProjectionDisposalReceiptV1` | Closed 38-field reader/context/extension/commit close, explicit candidate-lease settlement, internal root-store current/lineage-to-retained ownership transitions, binding transition, ECS/State-First detach, before/after resource snapshots, quiescence, or bounded quarantine-to-retained transfer evidence |

The target is exactly 18 modules: one M3B primitive module, the 16 complete
definition modules, and one catalog module. A definition registers only with its
complete schema, semantic validator, fixture, canonical vector, independent
Python vector, and browser cases. There is no partial catalog or placeholder.

The catalog module also emits one exact 14-field catalog receipt. That receipt
binds an embedded exact 17-field
`RealmProjectionReferenceDescriptorPackV1` and the compiled exact 12-field
`RealmProjectionReferenceDomainRegistryV1` without adding a seventeenth wire
definition or nineteenth module. The sole 21-field source matrix has exact
import/shape/recovery/domain/carrier/producer-seed/producer-variant/direct-edge/
alias-source/literal-alias/reference counts of
3/6/9/50/78/87/111/111/108/105/137. The inert code-shipped pack contains exactly
50 authoritative definition descriptors, 50 dependency extractors, 78 source-
authority rules, and 78 producer predicates. Its closed selector-rule and
condition operator matrices, scoped paths, byte-carrier rules, root-object/M2-
target/pinned-import roles, owners, resolvers, and hash-derived consumer edges
must reproduce from both checked-in JavaScript and independent JSON/Python
vectors. The registry has exactly three accepted import catalogs, 50 domains,
and 78 carrier rows; a caller cannot extend, replace, or interpret it with host-
language predicates.

M3B intentionally defines no `RealmProjectionCheckpointLinkReceiptV1`. M3A
already owns the closed `checkpoint-to-projection-root` edge and checkpoint
commit receipt. M3B registers only the `projection-root` resolver/verifier and
has no method to request or write an M3A edge. The root binds the applied cursor;
the cursor does not bind the root, avoiding a digest cycle. The root also omits
its later application/recovery/disposal receipts and any later M3A checkpoint.

The separate M3 projection-transaction capability contributes no catalog
definition. It owns one exact 27-field service-internal immutable active bundle
and one exact ten-field durable selector. The bundle binds the same exact floor
anchor as its root and the acquired covering M2 artifact lease. The accepted
candidate, input cut, closure, floor anchor, root, and 42-field intent remain
lease-neutral: no artifact-lease receipt exists until trusted `prepare()`
independently replays the neutral import-inert semantic kernel, verifies and
reads back those bytes, and acquires the deterministic target set. That service-
only, root-store-scoped M2 lease is nonexpiring until its exact release or
ownership-transfer protocol completes; its `logicalExpiryTick` is `0`, and a
finite or caller-renewable lease is invalid. Trusted commit then performs one
durable selector-generation CAS as the sole logical linearization point. A
process-local mirror, ECS upload, State-First join, GPU resource, or rendered
frame is never a second commit. Mirror/device failure hides dynamic presentation
and keeps the complete M2 static city visible. An accepted recovering fence may
advance only the contiguous same-binding CPU catch-up through ordinary prepare/
commit; commit-port `recover(device-resume)` independently verifies retention,
selector, source, authority, and expiry state and owns the one recovering-to-
ready gate transition.

The protected closure uses frozen per-kind traversal. Root-store bytes appear
only as declared `root-object` occurrences; separately compiled M2 targets
appear only in the deterministic lease-target set; and catalog-only
`pinned-import` occurrences resolve through their accepted catalogs without
becoming closure entries or M2 targets. Every required M3A batch, record,
append/head, source-state, 11-field retention-state, checkpoint/recovery/
acquisition/tick, reader-escrow, recorded-authority receipt, signature, trust,
correlation, resolution-receipt, and authority-escrow byte sequence is copied
byte-identically into root-owned evidence escrow under its original owner/ID/
digest, so compaction cannot strand a root. The closure includes the applicable
16-field expiry-due receipt, input/source, subject-resolved static binding and
anchor targets, observation, outcome, delta/payload, six-channel store, full ECS
overlay, State-First, lineage, and deterministic lease-target evidence. The
root-store-authored 12-field candidate lineage-floor anchor is itself a root-
owned closure entry, has no candidate-root backlink, and closes verification of
the bounded retained suffix without a digest cycle. The 27-field bundle and
application receipt bind the lease acquired only after that lease-neutral root
freezes. Content-derived IDs, semantic IDs, issuer-owned references, and
explicitly historical references keep their distinct validation rules; no
generic current-binding rehash rule replaces their owning contracts.

Presentation commands are dynamic evidence, not a fourth static carrier. Every
command must join exactly one 41-field batch `(presentationCommandIds[i],
presentationCommandDigests[i])` pair, one exact pure-compiled or retained-origin
protected-closure byte object, and at least one admitted ID-only presentation
Delta. Free, missing, uncited, conflicting, or multiply resolved command bytes
reject the candidate. Command bytes count through protected closure, never
`deltaByteCount`. Command identity binds runtime binding, projector,
observation, slot, binding subject, selected anchor, command kind, and content
digest. The current-presentation semantic key is independently derived. The
historical witness reuses the exact accepted primary command and emits only a
witness Delta, never a second command.

Current traffic alone derives finite expiry as
`min(UINT64_MAX, inputCut.logicalTick + 1)`; every other primary Delta uses
expiry `"0"`. Expiry accepts only the exact service-issued due receipt grounded
exclusively in M3A-owned durable tick evidence. The separate 24/18/18-field application,
recovery, and selector-retirement journals share one aggregate quota. Recovery
issues the exact 37-field recovery receipt; teardown uses the exact 18-field
selector-retirement record, 24-field detach receipt, and 21-field quarantine
receipt.

The conditional 37-field application/recovery receipts and 24-field detach
receipt derive hash-only Boolean presence vectors plus ordered
`[fieldName, canonicalValue]` rows before their ID and full-receipt digests. The
21-field quarantine receipt is fully present and binds exact four-field
operation-evidence rows plus an immutable ten-field resource-inventory row
array, dense ordering, exact count, and aggregate digest. These derivations add
no wire keys; they prevent omission/null, same-shape, cross-variant, cross-
journal, or cross-language hash substitution.

Each port exposes its own exact ten-field descriptor: `format`, `version`,
`portName`, `portVersion`, `bindingContractVersion`, the runtime-binding pair,
`methodRows`, `maximumRequestBytes`, and `descriptorDigest`. The descriptors are
port-specific rather than mutually identical. Each ordered method row has
exactly `methodOrder`, `methodId`, `resultKindIds`, `resultDomainId`, and
`rowDigest`; its closed result domain is
`particle-realms.m3b-port-result/<portName>/<methodId>@1`. The ordered surfaces
and result-kind domains are exact:

| Dependency key | Exact `portName` | `portVersion` | `bindingContractVersion` | `maximumRequestBytes` |
| --- | --- | ---: | ---: | ---: |
| `realmObservationBatchReaderPort@1` | `realmObservationBatchReaderPort` | 1 | 1 | 65,536 |
| `realmProjectionContextPort@1` | `realmProjectionContextPort` | 1 | 1 | 33,554,432 |
| `realmProjectionCommitPort@1` | `realmProjectionCommitPort` | 1 | 1 | 536,870,912 |

Each row digest covers its first four fields in order, and the descriptor digest
covers its first nine fields including the complete ordered rows. These ABI
ceilings are not runtime-profile fields.

| Port | Ordered method and closed result-kind list |
| --- | --- |
| `realmObservationBatchReaderPort@1` | `descriptor:[port-descriptor]`; `captureNext:[ready,source-state-ready,idle,gap,stale-binding,unavailable,closed,invalid]`; `reassert:[current,changed,unavailable,retired,invalid,closed]`; `close:[closed,already-closed]` |
| `realmProjectionContextPort@1` | `descriptor:[port-descriptor]`; `openSession:[opened,stale,unavailable,rejected]`; `capture:[ready,transition,stale,unavailable,rejected,closed]`; `resolveStatic:[ready,missing,stale,unavailable,invalid,closed]`; `resolveAuthorityEvidence:[ready,missing,stale,unavailable,invalid,closed]`; `reassert:[current,changed,unavailable,retired,invalid,closed]`; `waitForWake:[batch-available,source-state-changed,authority-state-changed,authority-expiry-due,expiry-due,artifact-lease-changed,presentation-changed,binding-changed,timeout,invalid,closed]`; `recordDiagnostic:[accepted,aggregated,dropped,closed]`; `beginStop:[stopping,already-stopping,stale,unavailable,invalid,closed]`; `closeSession:[closed,already-closed,blocked,unavailable,invalid]`; `close:[closed,already-closed,blocked]` |
| `realmProjectionCommitPort@1` | `descriptor:[port-descriptor]`; `readPriorState:[empty,current,stale,unavailable,invalid,closed]`; `prepare:[prepared,conflict,stale-binding,invalid,unavailable,aborted-before-dispatch,closed]`; `commit:[committed,conflict,stale-binding,invalid,unavailable,aborted-before-dispatch,recovery-pending,closed]`; `reconcile:[committed,proven-not-committed,conflict,recovery-pending,invalid,closed]`; `recover:[restored,replayed,resumed,committed,proven-not-committed,conflict,fallback,recovery-pending,rejected,invalid,closed]`; `detachSources:[detached,already-detached,stale,recovery-pending,unavailable,invalid,closed]`; `release:[released,blocked,already-released,invalid,closed]`; `close:[closed,already-closed,blocked]` |

All non-descriptor calls use one exact request-bound eight-key result envelope:
`format`, `version`, `resultId`, `status`, the runtime-binding pair, `payload`,
and `resultDigest`; format is `particle-realms.m3b-port-result` and version is
`1`. Before dispatch, `canonicalRequestDigest` uses
`particle-realms.m3b-port-request@1` over the descriptor's exact `portName`,
exact `methodId`, and the method's exact ordered field-name/value projection.
The caller signal is checked for identity against the session signal but is
excluded from canonical bytes and byte accounting.
`resultId` is the existing M0 content ID over the ordered tuple
`(resultDomainId, canonicalRequestDigest, format, version, status,
runtimeBindingId, runtimeBindingDigest, payload)`. `resultDigest` uses
`particle-realms.m3b-port-result-envelope@1` over the exact eight-key envelope
with only `resultDigest` omitted, and therefore includes `resultId`. Its method-specific status and
payload union is the closed one frozen by that descriptor row.

The reader always returns retention state with `ready`, `source-state-ready`, and
`idle`; a `gap` is legal only when that same state verifies, otherwise it returns
`unavailable`. The first two also return evidence-complete source state, escrow,
and canonical `readCallReceiptBytes` plus its pair, while true idle proves a byte-
identical snapshot and creates no artifact. Static resolution accepts only
subject IDs and returns their complete authorized projection-binding/anchor
closure, so callers cannot probe anchors. Every `ready` or `missing` result
returns canonical `staticResolutionReceiptBytes` plus the pair for the exact 24-
field `RealmProjectionStaticResolutionReceiptV1`; its disposition is
respectively `complete` or `partial-missing`.

Recorded authority is completely resolved and escrowed before the 28-field
observation cut and disclosure decision freeze. Recorded mode returns the
complete 15-field `RealmProjectionRecordedAuthorityEscrowManifestV1` bytes and
canonical bytes plus the pair for the 21-field maximum-vocabulary
`RealmProjectionAuthorityResolutionReceiptV1`, together with the complete
current snapshot bytes. Its 19-own-key recorded-mode receipt variant forbids the
current pair, keeping ephemeral current authority out of the cut and escrow.
Current-only mode returns the 13-own-key variant and forbids recorded batch/source/
escrow pairs. Current authority remains outside every durable M3B definition as
one complete 13-field `resolved` or `unavailable` snapshot bound by the separate
14-field presentation fence; it can only preserve or close a recorded gate.
Each resolution result returns `authorityResolutionReceiptBytes`, so callers
verify the receipt rather than a hidden resolver object.

Binding replacement is proved by the exact 21-field empty/present transition
descriptor and, after the exact 18-field selector-retirement attempt record,
complete M2 static fallback, exact 24-field detach receipt, and exact 21-field
quarantine receipt when required, one exact 21/25-field binding-transition
receipt. A successor
session cannot open until that predecessor evidence is complete. Terminal
disposal first uses the exact 16-field `beginStop()` receipt to capture and close
the presentation fence, then one exact 38-field receipt with reader/context/extension/commit
close pairs, the always-present 15-field candidate-lease settlement receipt,
conditional retained-root/binding-transition/quarantine pairs, and exact 16-
field before/after session-resource snapshots. Their seven counters are exactly
`candidateCount`, `preparedCount`, `readerEscrowCount`, `candidateLeaseCount`,
`sessionCandidateRootCount`, `callbackCount`, and `inFlightCount`; these are
session-scoped service resources, never app-owned handles, and every after-
transfer count is zero. Device resume
cannot issue a ready fence until durable head/floor/cursor/source/authority/
expiry catch-up and one closed-to-ready transition prove complete.

The exact field order, conditional presence, nested row schemas, formats,
limits, state machines, canonical identity rules, 20 certification gates, and
48-case hostile ledger live in
[M3B Disclosure and Dynamic Projection](m3b-disclosure-projection.md).

## See also

- [Architecture and ownership](architecture.md)
- [RealmForge bake pipeline](realmforge-pipeline.md)
- [M1B public shell and access-refinement packages](m1b-public-refinement-packages.md)
- [M1C Storylet and reviewed station bake](m1c-storylet-station-bake.md)
- [M2A runtime composition](m2a-runtime-composition.md)
- [M2B private-bake admission](m2b-private-bake-admission.md)
- [M3A observation ingress](m3a-observation-ingress.md)
- [M3B disclosure and dynamic projection](m3b-disclosure-projection.md)
- [Local City Operations View](local-operator-view.md)
- [Code Matter](code-matter.md)
- [Cityforms and SecureMesh](cityforms-securemesh.md)
- [Storylets](storylets.md)
- [Certification plan](certification-plan.md)
