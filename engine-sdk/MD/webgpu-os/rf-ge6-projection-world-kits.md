---
title: RealmForge RF-GE6 Projection Grammar and Reviewed World Kits
description: Executable implementation blueprint for a separate inert RF-GE6 catalog, six reviewed Genesis district kits, stable placement evidence, static world products, audience isolation, deterministic verification, and additive freeze evidence.
updated: 2026-09-03
status: executable architecture blueprint; RF-GE6 is planned and unimplemented; RF-GE0 through RF-GE5 remain the accepted inert authoring baseline
---

# RealmForge RF-GE6 Projection Grammar and Reviewed World Kits

RF-GE6 is the next RealmForge Genesis Ecology gate. This page is the build
contract for implementers and reviewers. It freezes a separate, data-only
projection catalog; six reviewed world kits; deterministic static world
products; audience-isolated verification; and coordinate-continuity evidence.
It does not claim that RF-GE6 is implemented or accepted.

RF-GE6 turns accepted authored evidence into an **unpublished static world
candidate**. It never observes a live computer, executes a Factory or
interpreter, mutates ECS state, renders a frame, writes storage, publishes a
package, selects an active head, grants a capability, mints identity, or
activates a Realm. Those responsibilities remain outside RealmForge.

Read the [RealmForge Genesis Ecology plan](realmforge-genesis-ecology.md) and
the [whole-stack Genesis Ecology continuity ledger](../concepts/genesis-ecology.md)
with this page. The existing source basis is the inert RF-GE5 provider and
compiler under `webgpu-os/apps/realmforge/modeler/genesis/`, the accepted
RF-GE4 interpreter Plan, and the additive M1C/RF-GE5 freeze ledger. No
RF-GE0-RF-GE5 or M0-M1C record changes in this gate.

## Locked outcome

A completed RF-GE6 implementation can do all of the following without gaining
runtime authority:

1. Validate a separate ordered 16-record RF-GE6 contract catalog and reuse the
   accepted static Virtual Realm contract definitions without changing them or
   implying that a generated candidate is admitted.
2. Validate one closed 22-rule projection grammar and derive exactly 22
   corresponding static bindings per audience compilation.
3. Validate exactly six golden-pinned, independently reviewed Genesis world
   kits.
4. Compile one audience context per invocation from an explicit inert source
   projection.
5. Retain compatible prior authored coordinates and explain every relocation.
6. Derive every static visual/resource product, including collision,
   navigation, HLOD, accessibility, and the conditional owner-private
   Operations evidence rows, from one immutable internal placement plan before
   finalizing layout-bound placement evidence.
7. Build a complete content-addressed dependency closure and one inert
   `GenesisRealmExtensionManifestV1` candidate.
8. Prove disclosure closure and public noninterference without reading private
   input in a public job.
9. Recompile from the exact same source and require canonical byte equality.
10. Emit verification evidence that says `not-executed`, `not-published`, and
    `runtimeActivation: false`.

The candidate is useful to RF-GE7 and RF-GE8 only after RF-GE6 receives its own
acceptance decision. It is not a Realm bake, runtime package, or publication
offer.

## Accepted baseline and freeze

RF-GE6 begins only from accepted RF-GE5 evidence. The checked-in version-1
freeze ledger is
`tests/realmforge/fixtures/realmforge-m1c-rf-ge5-freeze-ledger-v1.json`.
Its physical SHA-256 is
`98bc37ee4e17518c54168abc585de7d634a1e27c4b30c981788729fed76754c4` and
its `milestonesSha256` is
`328bd8322861ff3fa452726fb42e169d2630b5f814d3ee24e66a070ded04da7f`.
It pins the 35-case M1C milestone and the 29-case RF-GE5 milestone while fixing
`authorityBearing: false` and `runtimeActivation: false`.

RF-GE6 must preserve these facts:

- the accepted Virtual Realm catalog remains exactly 109 records;
- M1C remains exactly 35 direct cases;
- RF-GE5 remains `realmforge.genesis-ecology.evidence@5.0.0`;
- the RF-GE5 evidence Plan remains bound to the exact verified RF-GE4 Plan;
- RF-GE3 cache and package-candidate evidence remains process-local and inert;
- no accepted input becomes execution, admission, publication, or authority
  evidence by passing through RF-GE6.

(Sources:
`webgpu-os/apps/realmforge/modeler/genesis/GenesisEcologyEvidenceCompilerV1.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisEcologyEvidenceDomainPackV5.js`;
`tests/realmforge/fixtures/realmforge-m1c-rf-ge5-freeze-ledger-v1.json`.)

## Gate inputs

`compileGenesisProjectionWorldV1()` accepts one exact 17-key input object. The
planned API name describes the required implementation; it is not a claim that
the function exists today.

| Field | Required value |
| --- | --- |
| `audienceContext` | Exactly one accepted context from the three-row audience table |
| `audienceSourceProjection` | One accepted `RealmAudienceSourceProjectionContract` record; never a private superset |
| `baseBakeManifest` | The complete already accepted `RealmVisualBakeManifestContract` record used as the immutable base |
| `baseSpatialLayoutReceipt` | The complete already accepted `RealmSpatialLayoutReceiptContract` record named by the base manifest |
| `compilationWindow` | Exact two-field authored logical-tick window specified in this section; never sampled from a clock |
| `contractCatalog` | Exact separate RF-GE6 catalog and order |
| `evidenceCompilationInput` | Exact input needed to independently verify the received RF-GE5 Evidence Plan |
| `evidencePlan` | Exact RF-GE5 Evidence Plan |
| `genesisSourceRecords` | Canonically ordered exact source envelopes specified in this section, each resolved to an inert accepted record and admitted by the audience source projection |
| `projectionGrammar` | One closed `GenesisProjectionGrammarV1` |
| `projectionBindingProfile` | One golden-pinned descriptor for deriving candidates that validate against the accepted `RealmProjectionBindingContract` definition |
| `projectionLimitProfile` | Exact frozen RF-GE6 count, digest-preimage, and compiler-work profile specified in [V1 limits and work accounting](#v1-limits-and-work-accounting) |
| `realmBakeResourceLimitProfile` | One exact RF-GE6 record validated by the accepted `RealmBakeResourceLimitProfileContract` and golden-pinned in [V1 limits and work accounting](#v1-limits-and-work-accounting) |
| `reviewedWorldKits` | Exactly six kit records and six matching review receipts from the sealed catalog |
| `spatialPolicy` | One accepted, golden-pinned `RealmSpatialLayoutPolicyContract` record |
| `priorPlacementEvidence` | Either `null` or one already verified RF-GE6 authored placement/receipt bundle for the same audience context |
| `targetProfile` | Exact compiler, numeric, renderer-capability, accessibility, and policy identifiers; no live adapter |

The function receives plain immutable data. It has no callback, registry
writer, document store, filesystem, network, renderer, WebGPU device, ECS,
clock, random source, capability broker, publication port, or active-root port.
The caller cannot pass any such field because exact-key validation rejects it.

The compiler derives an internal `baseBakeReference` with exactly six fields in
this order:
`baseBakeId`, `baseBakeDigest`, `baseAudienceClass`, `baseDisclosureClass`,
`baseSpatialLayoutReceiptId`, and `baseSpatialLayoutReceiptDigest`. The caller
cannot supply or override this derived object. The compiler validates the two
complete input records with their unchanged accepted definitions and recomputes
the base-manifest digest read-only. It does not create, replace, sign, admit, or
activate either artifact. The audience and disclosure pair must equal the
selected RF-GE6 context. The pair is derived from the accepted base manifest's
variant and cannot be caller-invented: `private` maps to
`owner-private/local-private`, `public-shell` maps to
`public-explicit/public-explicit`, and `access-refinement` maps to
`capability-refined/capability-refined`. The receipt ID equals the base
manifest's `spatialLayoutReceiptId`; the receipt digest equals the verified
receipt's `layoutDigest`; and its required `signatureEnvelopeId` is present.
The manifest's `realmId`, `audienceClass`, `sourceProjectionRevision`,
`sourceProjectionDigest`, and `spatialLayoutPolicyId` must match the accepted
source projection and spatial policy. The receipt's
`audienceSourceProjectionId` and `layoutPolicyId` must match those same inputs.
Any mismatch rejects before projection. `baseBakeId` is the manifest's
`bakeId`; `baseBakeDigest` is its recomputed accepted-record digest.

`compilationWindow` has exactly `issuedAtLogicalTick` and
`expiresAtLogicalTick`, both canonical uint64 decimal strings. Expiry is either
`"0"` for no authored expiry or strictly greater than issue. The complete
two-field object is part of the compilation-input digest. No other record may
supply or override these values.

`realmBakeResourceLimitProfile` is validated with the accepted contract and
must byte-match the RF-GE6 V1 Realm-profile record pinned by the V6 trust pack.
`projectionLimitProfile` is exact-key, self-digested plain data and must
byte-match the RF-GE6 V1 profile frozen under [V1 limits and work
accounting](#v1-limits-and-work-accounting). The manifest's
`resourceLimitProfileId` comes from the accepted Realm profile. Its exact
`resourceBudget` object binds both profile IDs, both profile digests, and the
effective compiler-work ceiling. The compiler therefore has no unbound budget
or policy input.

`inputDigest` uses
`particle-realms.realmforge.rf-ge6.compilation-input@1` over the complete
preflighted input object, with every top-level field encoded in the Gate inputs
table order and no omitted or substituted field. `null` prior-placement evidence is
encoded as literal `null`. The complete base-bake manifest and base-layout
receipt,
compilation window, both complete limit profiles, binding profile, spatial
policy, target profile, reviewed kits, source projection, source records, and
RF-GE5 verification inputs are therefore all covered by the receipt's one input
digest.

Each `genesisSourceRecords` envelope has exactly eight fields in this order:
`sourceRecordId`, `sourceKind`, `sourceGate`, `sourceFieldPath`,
`sourceAnchorId`, `sourceRecord`, `sourceRecordDigest`, and `rowDigest`. The
`sourceKind` is one of the exact 22 grammar kinds. The matching frozen rule
fixes `sourceGate`, a symbolic `sourceFieldPath`, and the one accepted source-
record definition whose validator and definition digest are pinned by the V6
pack. Validation dispatches only through that closed rule table; `sourceRecord`
is not an open payload bag. Its digest is independently recomputed with the
pinned accepted definition and must equal `sourceRecordDigest`.

Envelopes sort by `(sourceKind, sourceRecordId)` and reject duplicate IDs. Each
must match exactly one audience-projection `resourceRecords` row where
`resourceId`, `resourceKind`, `contentId`, and `sourceAnchorId` equal the
envelope's record ID, kind, digest, and anchor. Every projection row whose kind
is one of the 22 Genesis kinds must have one envelope; non-Genesis base rows are
not selected by a rule. `rowDigest` uses
`particle-realms.realmforge.rf-ge6.genesis-source-envelope@1` over the preceding
seven fields. `sourceFieldPath` is an enum value frozen per rule, never a
filesystem path, URL, JSONPath evaluator, reflection string, or dynamic
property walk.

`genesisSourceRevisionId` is content-derived, not a caller reference. It is
`genesis-source-revision:` followed by the lowercase hexadecimal SHA-256 over
`particle-realms.realmforge.rf-ge6.genesis-source-revision-id@1`, the verified
RF-GE5 `planDigest`, the audience-source-projection digest, the complete
canonically ordered Genesis source records, and their literal count.

`targetProfile` has exactly eleven fields in this order: `format`, `version`,
`profileId`, `profileVersion`, `compilerImplementationId`, `compilerVersion`,
`numericPolicyId`, `rendererCapabilityProfileId`, `accessibilityPolicyId`,
`staticProductPolicyId`, and `targetProfileContentId`. V1 fixes the first ten
values to:

- `particle-realms.realmforge.rf-ge6.target-profile`;
- `1`;
- `target:realmforge-genesis-rf-ge6-v1`;
- `target-profile-v1`;
- `realmforge.genesis.projection-world-compiler.v1`;
- `1.0.0`;
- `numeric:realmforge-safe-integer-grid-v1`;
- `renderer-capabilities:virtual-realm-static-v1`;
- `accessibility:virtual-realm-static-v1`; and
- `static-products:realmforge-genesis-rf-ge6-v1`.

`targetProfileContentId` is SHA-256 under
`particle-realms.realmforge.rf-ge6.target-profile@1` over those first ten fields
in order. The target `numericPolicyId` must equal the accepted spatial policy's
`numericPolicyId`. The manifest copies the target compiler ID/version and target
profile content ID exactly. No target field resolves an adapter or device.

## Audience contexts

Every compile invocation owns one and only one of these exact pairs, matching
the accepted RF-GE4/RF-GE5 context vocabulary:

| Context ID | `audienceClass` | `disclosureClass` | Result boundary |
| --- | --- | --- | --- |
| `owner-private.local-private` | `owner-private` | `local-private` | Owner-private static Genesis district candidate and local Operations evidence rows |
| `public-explicit.public-explicit` | `public-explicit` | `public-explicit` | Independently authored public-safe static appearance; no Operations evidence |
| `capability-refined.capability-refined` | `capability-refined` | `capability-refined` | Independently compiled exact-scope refinement; no owner Operations evidence |

The public compiler has no private-source parameter. The refinement compiler
receives only the already accepted access-refinement base-bake reference and
the exact refined source projection. It does not receive an owner-private
candidate or a public compiler result. The later refinement-isolation verifier,
not the refinement compiler, receives the separately verified public result.
Changing a private record while public inputs remain byte-identical cannot
change a public ID, count, coordinate, geometry, route, HLOD, text, timing
value, or digest.

(Source for the accepted context pairs:
`webgpu-os/apps/realmforge/modeler/genesis/GenesisEcologyInterpreterCompilerV1.js`.)

## Separate 16-record catalog

RF-GE6 adds a new `GenesisProjectionWorldContractCatalogV1`. It never appends
to the accepted Virtual Realm catalog or changes an earlier Genesis catalog.
The order is exact and semver-immutable:

| Order | Contract | Responsibility |
| ---: | --- | --- |
| 1 | `GenesisProjectionRuleV1` | One source-domain-to-static-slot rule |
| 2 | `GenesisProjectionGrammarV1` | Closed ordered rule set and claim policy |
| 3 | `GenesisWorldKitV1` | One immutable district kit definition |
| 4 | `GenesisWorldKitReviewReceiptV1` | Review evidence for one exact kit digest |
| 5 | `GenesisDistrictAssemblyV1` | Flat composition of six kits through IDs and digests |
| 6 | `GenesisSpatialLayoutEvidenceV1` | Unsigned placement/product agreement evidence; never an accepted layout receipt |
| 7 | `GenesisStablePlacementIndexV1` | Stable keys mapped to accepted topology nodes and anchors |
| 8 | `GenesisCoordinateRetentionReceiptV1` | Decision for one compatible prior placement |
| 9 | `GenesisRelocationReceiptV1` | Exact reason and displacement for one moved placement |
| 10 | `GenesisAccessibilityClosureReceiptV1` | Cross-check of safe text, audio, landmarks, and routes |
| 11 | `GenesisDisclosureVerificationReceiptV1` | Reachability and forbidden-reference proof |
| 12 | `GenesisPublicNoninterferenceReceiptV1` | Inert paired-public equality and port-isolation proof |
| 13 | `GenesisRefinementIsolationReceiptV1` | Inert declared-scope projection proof with authority unevaluated |
| 14 | `GenesisRealmExtensionManifestV1` | Complete unpublished sidecar candidate |
| 15 | `GenesisProjectionCompilationReceiptV1` | Deterministic compile evidence and work counts |
| 16 | `GenesisProjectionVerificationReceiptV1` | Independent recompile and canonical equality evidence |

The catalog declares `scopeComplete: true` only for
`rf-ge6-projection-grammar-and-reviewed-world-kits`. It declares
`complete: false`, `authorityBearing: false`, `runtimeActivation: false`,
`containsExecutableCode: false`, `registryPublication: false`, and
`publicationEligibility: false` for Genesis Ecology as a whole.

### Accepted contracts reused unchanged

RF-GE6 imports and validates these accepted definitions instead of creating
Genesis-prefixed copies:

| Existing contract | RF-GE6 use |
| --- | --- |
| `RealmAudienceSourceProjectionContract` | Explicit one-audience source boundary |
| `RealmBakeResourceLimitProfileContract` | Static resource and Operations ceilings |
| `RealmSpatialLayoutPolicyContract` | Quantization, cells, Root Spine, route, and clearance policy |
| `RealmTopologyNodeContract` and `RealmTopologyEdgeContract` | Flat placed topology and semantic road graph |
| `RealmGeometryResourceContract` | Static geometry descriptors |
| `RealmMaterialBindingContract` and `RealmLightingIntentContract` | Static appearance |
| `RealmCollisionResourceContract` | Static collision resources |
| `RealmNavigationResourceContract` | First-person navigation resources |
| `RealmSocketResourceContract` | Root Spine, facility, district, and future-extension sockets |
| `RealmLodResourceContract` | Semantic LOD and HLOD resource records |
| `RealmProjectionBindingContract` | Exactly 22 rule-to-resource bindings |
| `RealmGlyphStyleContract` and `RealmAudioZoneContract` | Audience-safe glyph and audio presentation |
| `RealmSafeTextContract` | Labels, captions, route instructions, and nonvisual alternatives |
| `LocalOperationsLookupResourceContract` | RF-GE8 materialization target only; RF-GE6 pins its row semantics but cannot instantiate it before a signed extension-layout receipt exists |
| `RealmDependencyClosureContract` | Complete audience-specific resource reachability |

RF-GE6 intentionally does **not** construct
`RealmSpatialLayoutReceiptContract`, `RealmPublicNoninterferenceReceiptContract`,
or `RealmRefinementScopeReceiptContract`. Those accepted records require signed
or authority-bearing publication context that this inert gate does not own.
RF-GE6 validates the signed base-layout receipt named by `baseBakeReference`
read-only, emits its own unsigned `GenesisSpatialLayoutEvidenceV1`, and uses the
two Genesis isolation receipts specified in [Exact field sets: audience and
compile evidence](#exact-field-sets-audience-and-compile-evidence). RF-GE8 may
translate separately
verified RF-GE6 evidence into the existing signed publication receipts after
external authority and signature validation.

The RF-GE6 catalog stores trusted definition digests for these dependencies but
does not republish their definitions. Any incompatible need requires a new
later major contract, not an RF-GE6 mutation. (Sources:
`webgpu-os/apps/the-virtual-realm/contracts/VirtualRealmContractCatalog.js`;
`webgpu-os/apps/the-virtual-realm/contracts/RealmDependencyClosureContract.js`;
`webgpu-os/apps/the-virtual-realm/contracts/RealmProjectionBindingContract.js`;
`webgpu-os/apps/the-virtual-realm/contracts/RealmSpatialLayoutReceiptContract.js`;
`webgpu-os/apps/the-virtual-realm/contracts/RealmPublicNoninterferenceReceiptContract.js`;
`webgpu-os/apps/the-virtual-realm/contracts/RealmRefinementScopeReceiptContract.js`.)

### Canonical record law

Every RF-GE6 record obeys one law:

- exact own keys only;
- plain data only, with no accessors, functions, prototypes, sparse arrays,
  cycles, symbols, transferable handles, URLs, paths, or malformed Unicode;
- NFC strings and the existing canonical Realm JSON encoder;
- bounded decimal-string integers for values that can exceed safe JavaScript
  integer precision;
- canonically ordered set arrays with duplicates rejected;
- every cross-record reference is either an adjacent logical-ID/content-ID
  pair or one of the closed ID-only references specified in this section;
- each self digest covers `format`, `version`, the logical ID, and every content
  field except the self-digest field;
- the digest domain is
  `particle-realms.realmforge.rf-ge6.<record-kind>@1`;
- changing an ID, audience, source reference, count, policy, or byte changes the
  digest;
- no unknown field can be ignored during validation or hashing.

The only ID-only reference classes are:

- source-gate and audience-context IDs that are closed enum literals in the
  sealed catalog rather than resource references;
- rule, semantic-role, slot, template, constraint, and profile IDs resolved
  inside the sealed grammar, binding profile, spatial policy, or reviewed-kit
  catalog whose aggregate digest is already in the containing record;
- a Genesis source-envelope record ID whose unique record digest and matching
  audience-projection row are verified inside the compilation-input digest;
- topology node, topology edge, route, socket, anchor, and placement IDs whose
  unique content digest is carried by a parallel manifest array or the exact
  dependency-closure entry set;
- a retention- or relocation-receipt ID whose unique digest is carried by the
  stable-placement index and repeated by the manifest's paired arrays;
- the owner-only local-Operations evidence ID whose exact digest and complete
  row object are carried inside the unsigned layout evidence and repeated by
  the manifest pair;
- IDs referenced within `localOperationsRows`, each of which resolves to one
  unique row inside the same six-array object covered by
  `localOperationsEvidenceDigest`;
- the content-derived `genesisSourceRevisionId`, which is recomputed from the
  exact compilation input rather than resolved externally;
- compiler, verifier, domain-pack, numeric-policy, test-profile, invariant,
  mutation-class, and profile IDs resolved inside the sealed V6 trust pack or
  an accepted profile whose exact digest is in the enclosing record; and
- the manifest's `resourceLimitProfileId`, whose exact accepted-profile digest
  is carried inside `resourceBudget`.

`baselineRunId` and `comparisonRunId` are deterministic evidence-local labels,
not resource references. They are derived from the public compilation-input
digest plus the literal role `baseline` or `comparison`; they never encode a
private ID or digest.

`coordinateFrameId` and `stableCoordinateKey` are also deterministic
evidence-local labels, not external references. Their exact derivations are
specified in [Stable coordinates and relocation
evidence](#stable-coordinates-and-relocation-evidence). Content-ID fields are
self-authenticating canonical digest identifiers and are recomputed or resolved
through their enclosing accepted record, trust-pack aggregate, or compilation
input; they do not acquire a second digest partner.

The graph validator resolves every ID-only reference to exactly one permitted
target and checks that target's digest against the enclosing aggregate or
closure. A missing target, target outside the named aggregate, duplicate target,
or same-ID/different-digest target rejects. No other ID-only reference is legal.

The implementation reuses `canonicalizeRealmJson()`,
`compareRealmUnicodeCodePoints()`, `preflightRealmContractValue()`, and the
RF-GE4/RF-GE5 internal digest pattern. It must not introduce a second canonical
JSON implementation. (Sources:
`webgpu-os/apps/realmforge/modeler/genesis/GenesisEcologyInternalDigestV1.js`;
`webgpu-os/apps/realmforge/modeler/genesis/GenesisEcologyEvidenceProgramsV1.js`.)

### Exact field sets: grammar and kits

The order in each row is the schema's canonical field order. The field count is
therefore reviewable without interpreting prose.

| Contract | Fields |
| --- | --- |
| `GenesisProjectionRuleV1` (17) | `format`, `version`, `ruleId`, `semanticVersion`, `sourceGate`, `sourceKind`, `sourceFieldPath`, `semanticRoleId`, `targetResourceKind`, `targetSlotKind`, `allowedAudienceContextIds`, `requiredDescriptorKinds`, `fallbackDisposition`, `claimClass`, `liveValuePolicy`, `provenanceContentIds`, `ruleDigest` |
| `GenesisProjectionGrammarV1` (13) | `format`, `version`, `grammarId`, `semanticVersion`, `ruleIds`, `ruleDigests`, `ruleSetDigest`, `requiredSourceGateIds`, `audienceContextIds`, `claimPolicyId`, `provenanceContentIds`, `complete`, `grammarDigest` |
| `GenesisWorldKitV1` (21) | `format`, `version`, `kitId`, `kitKind`, `semanticVersion`, `labelKey`, `districtRoleId`, `sourceRuleIds`, `anchorTemplateIds`, `placementConstraintIds`, `facilityResourceIds`, `routeTemplateIds`, `collisionProfileId`, `navigationProfileId`, `hlodProfileId`, `accessibilityProfileId`, `operationsProfileId`, `presentationSlotIds`, `audienceContextIds`, `provenanceContentIds`, `kitDigest` |
| `GenesisWorldKitReviewReceiptV1` (15) | `format`, `version`, `reviewReceiptId`, `kitId`, `kitDigest`, `reviewPolicyContentId`, `reviewEvidenceContentIds`, `reviewerIdentityContentId`, `reviewerAttestationContentId`, `reviewedAudienceContextIds`, `structuralStatus`, `privacyStatus`, `accessibilityStatus`, `reviewedAtLogicalTick`, `reviewReceiptDigest` |
| `GenesisDistrictAssemblyV1` (20) | `format`, `version`, `assemblyId`, `semanticVersion`, `kitIds`, `kitDigests`, `kitReviewReceiptIds`, `kitReviewReceiptDigests`, `projectionBindingIds`, `projectionBindingDigests`, `rootSpineAnchorId`, `topologyNodeIds`, `topologyEdgeIds`, `routeResourceIds`, `externalSocketIds`, `audienceContextId`, `audienceSourceProjectionId`, `audienceSourceProjectionDigest`, `provenanceContentIds`, `assemblyDigest` |

`reviewedAtLogicalTick` is authored review provenance. It is supplied in the
sealed kit catalog and never sampled from a live clock during compilation.
`structuralStatus`, `privacyStatus`, and `accessibilityStatus` must all equal
`accepted`. A receipt is evidence that a specific static resource was reviewed;
it does not grant runtime or publication authority.

### Exact field sets: continuity and accessibility evidence

| Contract | Fields |
| --- | --- |
| `GenesisSpatialLayoutEvidenceV1` (34) | `format`, `version`, `spatialLayoutEvidenceId`, `audienceContextId`, `audienceSourceProjectionId`, `audienceSourceProjectionDigest`, `spatialPolicyContentId`, `coordinateFrameId`, `stablePlacementRowsDigest`, `placementCount`, `topologyNodeIds`, `topologyNodeDigests`, `topologyEdgeIds`, `topologyEdgeDigests`, `productRows`, `productRowsDigest`, `productCount`, `localOperationsEvidenceId`, `localOperationsRows`, `localOperationsRowCount`, `localOperationsEvidenceDigest`, `compilerImplementationId`, `compilerVersion`, `containsExecutableCode`, `executionStatus`, `publicationStatus`, `authorityBearing`, `grantsAuthority`, `publicationEligibility`, `persists`, `registryPublication`, `scansLiveState`, `runtimeActivation`, `spatialLayoutEvidenceDigest` |
| `GenesisStablePlacementIndexV1` (18) | `format`, `version`, `placementIndexId`, `audienceContextId`, `spatialLayoutEvidenceId`, `spatialLayoutEvidenceDigest`, `stablePlacementRows`, `stablePlacementRowsDigest`, `placementCount`, `coordinateRetentionReceiptIds`, `coordinateRetentionReceiptDigests`, `relocationReceiptIds`, `relocationReceiptDigests`, `coordinateFrameId`, `spatialPolicyContentId`, `compilerImplementationId`, `compilerVersion`, `placementIndexDigest` |
| `GenesisCoordinateRetentionReceiptV1` (16) | `format`, `version`, `retentionReceiptId`, `audienceContextId`, `stableCoordinateKey`, `priorStablePlacementRowDigest`, `candidateStablePlacementRowDigest`, `priorTopologyNodeId`, `candidateTopologyNodeId`, `decision`, `decisionReason`, `relocationReceiptId`, `priorPlacementIndexDigest`, `compilerImplementationId`, `compilerVersion`, `retentionReceiptDigest` |
| `GenesisRelocationReceiptV1` (18) | `format`, `version`, `relocationReceiptId`, `audienceContextId`, `stableCoordinateKey`, `priorStablePlacementRowDigest`, `candidateStablePlacementRowDigest`, `priorTopologyNodeId`, `candidateTopologyNodeId`, `reasonCode`, `blockingConstraintIds`, `fromPositionMillimetres`, `toPositionMillimetres`, `displacementMillimetres`, `policyContentId`, `compilerImplementationId`, `compilerVersion`, `relocationReceiptDigest` |
| `GenesisAccessibilityClosureReceiptV1` (17) | `format`, `version`, `accessibilityReceiptId`, `audienceContextId`, `spatialLayoutEvidenceId`, `spatialLayoutEvidenceDigest`, `navigationResourceIds`, `navigationResourceDigests`, `safeTextResourceIds`, `safeTextResourceDigests`, `audioZoneResourceIds`, `audioZoneResourceDigests`, `unlabelledVisibleResourceIds`, `inaccessibleRouteIds`, `policyContentId`, `result`, `accessibilityReceiptDigest` |

`GenesisSpatialLayoutEvidenceV1` is the unsigned RF-GE6 agreement record. It is
not an accepted or signed Realm layout receipt and cannot be used for runtime
admission. Each `productRows` item has exactly five fields:
`resourceId`, `resourceDigest`, `resourceKind`, `stablePlacementRowsDigest`, and
`rowDigest`. Rows sort by `(resourceKind, resourceId)`, every ID/digest pair is
unique, `productCount` equals the row count, and `productRowsDigest` binds the
complete rows followed by the literal count. Every row carries the one exact
placement-row-set digest from which it was compiled.

`productRows` covers exactly the stage-9 topology and static-resource outputs,
including safe-text and other accessibility resources. It does not include the
later layout evidence itself, stable-placement/continuity evidence,
accessibility-closure receipt, district assembly, dependency closure, manifest,
disclosure receipt, compilation receipt, verification receipt, or either
certification-only isolation receipt.

Owner Operations rows are stage-9 evidence, not an accepted static resource.
They are bound by the four dedicated `GenesisSpatialLayoutEvidenceV1` contract
fields and are not duplicated in `productRows`.

The topology and static-product candidates validate against the unchanged
accepted `RealmTopologyNodeContract`, `RealmTopologyEdgeContract`, geometry,
collision, navigation, LOD, safe-text, audio, and Operations contract
definitions. That does not make the candidate records admitted or active.
RF-GE6 adds only the unsigned layout and continuity/accessibility evidence
needed to bind them.
Each `stablePlacementRows` item has exactly ten fields:
`stableCoordinateKey`, `resourceId`, `resourceDigest`, `topologyNodeId`,
`anchorId`, `cell`, `localOffsetMillimetres`, `orientationMilliDegrees`,
`boundsMillimetres`, and `rowDigest`. Rows sort strictly by
`stableCoordinateKey`; IDs and digests are one-to-one; and `placementCount`
equals the row count.

The placement index's two receipt ID/digest array pairs have equal lengths,
strictly sorted unique IDs, and one-to-one digests. The retention arrays contain
every decision emitted for a matched prior key; the relocation arrays contain
exactly the relocation receipts named by those decisions. Both pairs are empty
when no prior evidence produces a decision. This makes the receipts reachable
through the index without requiring the later manifest to be a closure root.

For a `retained` decision, `candidateStablePlacementRowDigest` and
`candidateTopologyNodeId` are non-null, equal their verified prior targets, and
`relocationReceiptId` is null. For `relocated`, all three candidate/relocation
fields are non-null. For `retired`, the two candidate fields and
`relocationReceiptId` are null. `priorStablePlacementRowDigest`,
`priorTopologyNodeId`, and `priorPlacementIndexDigest` are always non-null.
These are the only nullable continuity fields.

RF-GE6 cannot construct `LocalOperationsLookupResourceContract`, because that
accepted contract requires a `spatialLayoutReceiptId`/`spatialLayoutDigest`
pair and the extension has no accepted signed layout receipt until RF-GE8.
Instead, owner-private `GenesisSpatialLayoutEvidenceV1` carries an exact
non-authoritative Operations evidence block. Its `localOperationsRows` object
has exactly six arrays in this order: `cells`, `anchors`, `zones`, `routes`,
`landmarks`, and `mapHlodRecords`. The row schemas are:

- cell: `cellId`, `boundsMillimetres`, `streamingClass`, `mapHlodId`;
- anchor: `anchorId`, `cellId`, `anchorKind`, `positionMillimetres`;
- zone: `zoneId`, `anchorId`, `cellId`, `zoneClass`, `boundsMillimetres`,
  `defaultState`, `mapHlodId`;
- route: `routeId`, `fromAnchorId`, `toAnchorId`, `cellIds`, `routeClass`,
  `defaultState`, `mapHlodId`;
- landmark: `landmarkId`, `anchorId`, `cellId`, `archetypeClass`,
  `defaultState`, `mapHlodId`; and
- map HLOD: `mapHlodId`, `level`, `boundsMillimetres`, `cellIds`, `zoneIds`,
  `routeIds`, `landmarkIds`.

All arrays use the accepted lookup's exact ID sorting, uniqueness, membership,
containment, state, and reverse-membership rules. Positions and bounds remain
safe integer millimetres in RF-GE6. `localOperationsRowCount` is the checked sum
of the six array lengths. `localOperationsEvidenceId` is
`genesis-local-operations-evidence:` plus the lowercase hexadecimal SHA-256
under `particle-realms.realmforge.rf-ge6.local-operations-evidence-id@1` over
the audience context, source-projection digest, spatial-policy content ID, and
stable-placement-row digest. `localOperationsEvidenceDigest` uses
`particle-realms.realmforge.rf-ge6.local-operations-evidence@1` over that ID,
those four inputs, the complete six-array object, and the literal row count.

For public and capability-refined evidence, all four local-Operations fields
are literal `null`; there is no empty-but-addressable object. RF-GE8 must first
produce and accept the signed extension `RealmSpatialLayoutReceiptContract`,
then deterministically convert the integer rows to metres under the pinned
numeric policy, construct the unchanged accepted
`LocalOperationsLookupResourceContract`, and re-run its validator. RF-GE6
neither creates that lookup nor grants any proposal or action authority.

### Exact field sets: audience and compile evidence

| Contract | Fields |
| --- | --- |
| `GenesisDisclosureVerificationReceiptV1` (16) | `format`, `version`, `disclosureReceiptId`, `audienceContextId`, `sourceProjectionId`, `sourceProjectionDigest`, `candidateManifestId`, `candidateManifestDigest`, `closureDigest`, `reachableResourceCount`, `checkedReferenceCount`, `forbiddenReferenceCount`, `undisclosedReferenceCount`, `policyContentId`, `result`, `disclosureReceiptDigest` |
| `GenesisPublicNoninterferenceReceiptV1` (38) | `format`, `version`, `noninterferenceReceiptId`, `testProfileId`, `publicAudienceContextId`, `publicSourceProjectionId`, `publicSourceProjectionDigest`, `publicPolicySetDigest`, `privateMutationClassIds`, `checkedInvariantIds`, `baselineRunId`, `comparisonRunId`, `baselineManifestId`, `comparisonManifestId`, `baselineManifestDigest`, `comparisonManifestDigest`, `baselineClosureDigest`, `comparisonClosureDigest`, `baselineCanonicalBundleDigest`, `comparisonCanonicalBundleDigest`, `privateInputPortCount`, `ambientSourcePortCount`, `privateInputReadAttemptCount`, `crossAudienceCacheHitCount`, `result`, `verifierImplementationId`, `verifierVersion`, `containsExecutableCode`, `executionStatus`, `publicationStatus`, `authorityBearing`, `grantsAuthority`, `publicationEligibility`, `persists`, `registryPublication`, `scansLiveState`, `runtimeActivation`, `noninterferenceReceiptDigest` |
| `GenesisRefinementIsolationReceiptV1` (36) | `format`, `version`, `refinementIsolationReceiptId`, `testProfileId`, `refinementAudienceContextId`, `sourceProjectionId`, `sourceProjectionDigest`, `publicBaseManifestId`, `publicBaseManifestDigest`, `declaredResourceScopeIds`, `declaredResourceScopeDigest`, `projectedResourceScopeIds`, `projectedResourceScopeDigest`, `declaredResourceCount`, `projectedResourceCount`, `forbiddenReachabilityCount`, `outOfScopeSourceResourceCount`, `unlabelledResourceCount`, `privateInputPortCount`, `ambientSourcePortCount`, `authorityEvidenceStatus`, `checkedInvariantIds`, `result`, `verifierImplementationId`, `verifierVersion`, `containsExecutableCode`, `executionStatus`, `publicationStatus`, `authorityBearing`, `grantsAuthority`, `publicationEligibility`, `persists`, `registryPublication`, `scansLiveState`, `runtimeActivation`, `refinementIsolationReceiptDigest` |
| `GenesisRealmExtensionManifestV1` (72) | `format`, `version`, `manifestId`, `semanticVersion`, `audienceContextId`, `baseBakeId`, `baseBakeDigest`, `genesisSourceRevisionId`, `audienceSourceProjectionId`, `audienceSourceProjectionDigest`, `grammarId`, `grammarDigest`, `projectionBindingIds`, `projectionBindingDigests`, `districtAssemblyId`, `districtAssemblyDigest`, `spatialLayoutEvidenceId`, `spatialLayoutEvidenceDigest`, `stablePlacementIndexId`, `stablePlacementIndexDigest`, `coordinateRetentionReceiptIds`, `coordinateRetentionReceiptDigests`, `relocationReceiptIds`, `relocationReceiptDigests`, `geometryResourceIds`, `geometryResourceDigests`, `materialBindingIds`, `materialBindingDigests`, `lightingIntentIds`, `lightingIntentDigests`, `collisionResourceIds`, `collisionResourceDigests`, `navigationResourceIds`, `navigationResourceDigests`, `socketResourceIds`, `socketResourceDigests`, `lodResourceIds`, `lodResourceDigests`, `glyphStyleIds`, `glyphStyleDigests`, `audioZoneIds`, `audioZoneDigests`, `accessibilityClosureReceiptId`, `accessibilityClosureReceiptDigest`, `localOperationsEvidenceId`, `localOperationsEvidenceDigest`, `dependencyClosureId`, `dependencyClosureDigest`, `spatialPolicyContentId`, `resourceLimitProfileId`, `targetProfileContentId`, `compilerImplementationId`, `compilerVersion`, `domainPackId`, `domainPackVersion`, `domainPackManifestDigest`, `resourceBudget`, `issuedAtLogicalTick`, `expiresAtLogicalTick`, `publisherIdentityContentId`, `signatureEnvelopeContentId`, `containsExecutableCode`, `executionStatus`, `publicationStatus`, `authorityBearing`, `grantsAuthority`, `publicationEligibility`, `persists`, `registryPublication`, `scansLiveState`, `runtimeActivation`, `manifestDigest` |
| `GenesisProjectionCompilationReceiptV1` (31) | `format`, `version`, `compilationReceiptId`, `compilerImplementationId`, `compilerVersion`, `inputDigest`, `audienceContextId`, `sourceProjectionDigest`, `grammarDigest`, `projectionBindingSetDigest`, `reviewedKitCatalogDigest`, `priorPlacementEvidenceDigest`, `candidateManifestId`, `candidateManifestDigest`, `disclosureReceiptId`, `disclosureReceiptDigest`, `workCountRows`, `workCountRowsDigest`, `issueRows`, `issueRowsDigest`, `containsExecutableCode`, `executionStatus`, `publicationStatus`, `authorityBearing`, `grantsAuthority`, `publicationEligibility`, `persists`, `registryPublication`, `scansLiveState`, `runtimeActivation`, `compilationReceiptDigest` |
| `GenesisProjectionVerificationReceiptV1` (29) | `format`, `version`, `verificationReceiptId`, `verifierImplementationId`, `verifierVersion`, `compilationInputDigest`, `receivedManifestId`, `receivedManifestDigest`, `recompiledManifestId`, `recompiledManifestDigest`, `receivedCanonicalBytesDigest`, `recompiledCanonicalBytesDigest`, `canonicalBytesEqual`, `descriptorLocksDigest`, `dependencyClosureVerified`, `disclosureVerified`, `disclosureReceiptId`, `disclosureReceiptDigest`, `containsExecutableCode`, `executionStatus`, `publicationStatus`, `authorityBearing`, `grantsAuthority`, `publicationEligibility`, `persists`, `registryPublication`, `scansLiveState`, `runtimeActivation`, `verificationReceiptDigest` |

`localOperationsEvidenceId` and `localOperationsEvidenceDigest` are either the
exact pair embedded in owner-private layout evidence or `null` for the other
two contexts. The manifest pair must match the layout-evidence pair byte for
byte. `priorPlacementEvidenceDigest` is `null`
when no prior authored RF-GE6 evidence is supplied. Every other nullable field
has one explicitly documented meaning; no absent key or `undefined` value is
valid.
`publisherIdentityContentId` and `signatureEnvelopeContentId` are literal
`null` in RF-GE6. Signing and publisher identity belong to RF-GE8.
`issuedAtLogicalTick` and `expiresAtLogicalTick` are explicit authored input
values bound into the compilation digest; the compiler never reads a clock.
The manifest, compilation receipt, verification receipt, unsigned layout
evidence, public-noninterference receipt, and refinement-isolation receipt each
fix `containsExecutableCode: false`, `executionStatus: not-executed`,
`publicationStatus: not-published`, and all authority, persistence, registry,
scan, and activation booleans to `false`. The other five evidence receipts have
only the fields declared in their exact contract rows and gain no implied
status fields.

The public-noninterference receipt is produced only by a certification call
over two already verified public compile results. It contains safe mutation
class IDs but no private resource ID, digest, byte, count, or timing sample.
The refinement-isolation receipt compares the declared scope in one accepted
refinement source projection with the projected closure. It fixes
`authorityEvidenceStatus: not-evaluated` and never dereferences the projection's
`authorityReceiptRef`. It proves source/closure isolation, not authority,
encryption, publication, or entitlement; RF-GE8 owns those later checks.

## Closed 22-rule grammar

RF-GE6 freezes exactly 22 `GenesisProjectionRuleV1` records. Each audience
compile derives exactly 22 candidates that validate against the accepted
`RealmProjectionBindingContract` definition, one per rule, through the golden
binding profile. The first four rules project
already accepted structural authoring families.
The next eight correspond one-for-one with the RF-GE4 interpreter domains. The
final ten correspond one-for-one with the RF-GE5 evidence domains.

| Order | Rule source kind | Primary kit targets | Static claim boundary |
| ---: | --- | --- | --- |
| 1 | `identity-continuity` | Continuity Core | Immutable identity/continuity symbolism only; never active identity |
| 2 | `parts-assembly` | Foundry District, Maintenance Works | Authored Parts and interfaces only; never installed instances |
| 3 | `constructive-plan` | Foundry District | `not-executed` plan and expected-evidence slots only |
| 4 | `recursive-package-candidate` | Foundry District, Possibility Archive | Inert candidate status only; never eligibility or publication |
| 5 | `development` | Continuity Core, Foundry District | Authored developmental stages and paths |
| 6 | `regulation` | Maintenance Works | Authored signals, delays, and control topology |
| 7 | `homeostasis` | Maintenance Works | Authored viable bands and recovery options |
| 8 | `causal-closure` | Continuity Core, Maintenance Works | Assessment method, boundary, and evidence requirements |
| 9 | `cognition` | Possibility Archive | Belief/prediction schema; never current belief or fact |
| 10 | `embodiment` | Continuity Core | Capability profile; never a live host or device handle |
| 11 | `inheritance` | Continuity Core, Culture Archive | Channel policy and attribution schema |
| 12 | `reaction` | Maintenance Works | Reaction-rule topology; never an occurrence or resource flux |
| 13 | `lineage` | Continuity Core, Culture Archive | Lineage policy and event vocabulary; never current ancestry claims |
| 14 | `program-ecology` | Role Commons, Maintenance Works | Relationship vocabulary; never a live relationship |
| 15 | `recognition` | Maintenance Works, Role Commons | Recognition policy; never quarantine, rejection, or release |
| 16 | `roles` | Role Commons, Culture Archive | Role criteria and proposal slots; never current role status |
| 17 | `culture` | Culture Archive | Cultural topology and transmission policy |
| 18 | `quality-diversity` | Possibility Archive | Descriptor and archive policy; never a current archive head |
| 19 | `meta-evolution` | Possibility Archive | Variation/evolution descriptions; never promotion or self-modification |
| 20 | `environmental-memory` | Culture Archive | External-memory binding grammar; never an admitted topology change |
| 21 | `lifecycle` | Continuity Core, Maintenance Works | Transition vocabulary; never a current lifecycle transition |
| 22 | `organismality` | Continuity Core, Role Commons | Assessment criteria and proposal slots; never identity minting |

The golden `projectionBindingProfile` is a 12-field, exact-key descriptor in
this order: `format`, `version`, `profileId`, `profileVersion`,
`resourceIdDomain`, `contentIdDomain`, `sourceAnchorRule`, `boundsRule`,
`dependencyRule`, `payloadDescriptorIds`, `compilerImplementationId`, and
`profileDigest`. V1 fixes:

- `format: particle-realms.realmforge.rf-ge6.projection-binding-profile`;
- `version: 1` and `profileVersion: projection-binding-profile-v1`;
- `profileId: realmforge.genesis.projection-binding-profile.v1`;
- `resourceIdDomain: particle-realms.realmforge.rf-ge6.projection-binding-id@1`;
- `contentIdDomain: particle-realms.realmforge.rf-ge6.projection-binding-content@1`;
- `sourceAnchorRule: source-and-reviewed-target-union-v1`;
- `boundsRule: reviewed-target-millimetre-union-v1`;
- `dependencyRule: source-and-reviewed-target-id-union-v1`;
- `payloadDescriptorIds` equal exactly
  `descriptor:01-genesis-projection-rule`,
  `descriptor:02-genesis-projection-source-set`, and
  `descriptor:03-genesis-projection-kit-target-set` in canonical order; and
- `compilerImplementationId: realmforge.genesis.projection-binding-compiler.v1`.

`profileDigest` is SHA-256 over the first eleven fields in the declared order
under `particle-realms.realmforge.rf-ge6.projection-binding-profile@1`. The
input descriptor must byte-match that complete trust-pack pin. It contains no
callback or executable selector.

The sealed reviewed-kit module also pins an exact target-slot table. Each row
has these nine fields in order: `slotId`, `slotKind`, `kitId`, `kitDigest`,
`anchorIds`, `boundsMillimetres`, `targetResourceIds`,
`targetResourceDigests`, and `rowDigest`. Rows sort by `(kitId, slotId)`;
`slotId` is globally unique; paired resource arrays have equal lengths and
unique IDs; `anchorIds` is a non-empty canonical set; and
`boundsMillimetres` has exact integer `minimum` and `maximum` triples with
minimum no greater than maximum on each axis. The table digest uses
`particle-realms.realmforge.rf-ge6.reviewed-target-slot-set@1` over all complete
rows followed by their literal count and is pinned in the reviewed-kit catalog
and V6 pack. Each `rowDigest` uses
`particle-realms.realmforge.rf-ge6.reviewed-target-slot@1` over the preceding
eight fields in their declared order.

For rule order `NN`, the compiler performs this exact construction:

1. Select exactly the verified Genesis source envelopes whose `sourceKind`
   equals `rule.sourceKind`; preserve their complete eight-field rows in
   `(sourceKind, sourceRecordId)` order. Their one-to-one audience-projection
   matches were already proven during preflight. The reviewed fallback may make
   this set empty only when the rule's frozen `fallbackDisposition` permits it.
2. Select exactly those reviewed kits whose `sourceRuleIds` contains
   `rule.ruleId`, then select their target-slot rows whose `slotKind` equals
   `rule.targetSlotKind`. Resolve every kit, slot, target resource, and digest
   through the sealed reviewed-kit catalog; at least one target slot is
   required.
3. Compute `sourceSetDigest` under
   `particle-realms.realmforge.rf-ge6.projection-binding-source-set@1` over the
   selected complete source rows followed by their literal count. Compute
   `kitTargetSetDigest` the same way from the selected complete target-slot rows
   under
   `particle-realms.realmforge.rf-ge6.projection-binding-kit-target-set@1`.
4. Set `sourceAnchorIds` to the sorted unique union of each selected envelope's
   singular `sourceAnchorId` and every selected target row's `anchorIds`.
   The union must be non-empty and at most 1,024.
5. Set `dependencyIds` to the sorted unique union of selected
   `sourceRecordId` values and selected target `targetResourceIds`. Every ID must
   resolve in the candidate closure and the union must be at most 1,024.
   `dependencySetDigest` uses
   `particle-realms.realmforge.rf-ge6.projection-binding-dependency-set@1` over
   the complete ID array followed by its literal count.
6. Compute target-slot minimum and maximum bounds in integer millimetres, take
   the axis-wise union, convert each value through the frozen round-trip metre
   conversion, and reject any non-round-tripping or unsafe value. `boundsDigest`
   uses `particle-realms.realmforge.rf-ge6.projection-binding-bounds@1` over the
   exact integer-millimetre minimum/maximum object before conversion.
7. Construct the three payload descriptors in the following list and validate
   their exact byte lengths against the canonical encoded source objects.
8. Derive `contentId` with the pinned content domain over
   `(audienceContextId, ruleDigest, sourceSetDigest, kitTargetSetDigest,
   boundsDigest, dependencySetDigest)`.
9. Derive `resourceId` as `genesis-projection-binding:` plus lowercase hex of
   the pinned ID-domain hash over `(audienceContextId, NN, contentId)`.
10. Set `resourceKind: projection-binding`, the exact audience/disclosure pair,
   `compilerIdentity` to the profile's exact compiler implementation ID,
   `numericPolicyId` to the exact target-profile value, and compute
   `projectionBindingDigest` with the accepted contract encoder.

The `payloadDescriptors` array contains exactly these ID-sorted flat rows:

1. `descriptor:01-genesis-projection-rule`, whose descriptor kind is
   `genesis-projection-rule`, whose content ID is the rule digest, and whose
   byte length is the exact canonical rule byte length.
2. `descriptor:02-genesis-projection-source-set`, whose descriptor kind is
   `genesis-projection-source-set`, whose content ID is the audience-permitted
   source-set digest and whose byte length is the exact canonical source-index
   byte length.
3. `descriptor:03-genesis-projection-kit-target-set`, whose descriptor kind is
   `genesis-projection-kit-target-set`, whose content ID is the selected
   reviewed-kit/slot-set digest and whose byte length is its exact canonical
   byte length.

The aggregate `projectionBindingSetDigest` uses the domain
`particle-realms.realmforge.rf-ge6.projection-binding-set@1` over the 22 complete
binding records followed by the literal count `22`.

Every binding resolves exact source IDs and digests through its source-set
descriptor. A rule cannot discover a
source by prefix, path, tag, reflection, or registry search. A missing required
source rejects the binding. A source unavailable for the selected audience
uses the rule's reviewed static fallback disposition: `omit-slot`,
`authored-unavailable-marker`, or `authored-undisclosed-marker`. A fallback
never copies a value from another audience and never claims that missing data
exists.

All 22 rules set `liveValuePolicy: forbidden`. Their permitted claim classes
are `authored-description`, `compiled-static`, `not-executed`,
`not-evaluated`, and `unavailable-for-audience`. Runtime observations and
dynamic deltas belong to later separately accepted Virtual Realm gates.

The rule-set digest uses
`particle-realms.realmforge.rf-ge6.projection-rule-set@1` over all 22 complete
rule records followed by the literal count `22`. The six-kit catalog and
six-review set use the corresponding domains
`particle-realms.realmforge.rf-ge6.reviewed-world-kit-catalog@1` and
`particle-realms.realmforge.rf-ge6.world-kit-review-set@1`, each binding its
literal count `6`. These aggregate domains and counts are part of the V6 trust
pack, not runtime-selected values.

## Six golden-reviewed world kits

The V1 reviewed catalog contains exactly six entries in this order. It pins the
complete kit record, review receipt, kit digest, review-receipt digest, and all
referenced static resource digests. There is no caller extension point and no
fallback to an unreviewed kit.

| Order | `kitId` | `kitKind` | District role | Reviewed static responsibility |
| ---: | --- | --- | --- | --- |
| 1 | `genesis-world-kit:continuity-core` | `continuity-core` | Continuity Core | Continuity landmark, stable origin relationship, lineage/inheritance galleries, embodiment sockets, lifecycle and organismality review chambers |
| 2 | `genesis-world-kit:foundry-district` | `foundry-district` | Foundry District | Product/Factory/Part review halls, inert plan board, assembly floor, evidence bays, package-candidate vault, and proposal-only activation gate |
| 3 | `genesis-world-kit:maintenance-works` | `maintenance-works` | Maintenance Works | Regulation, homeostasis, causal-closure, reaction, recognition, repair, quarantine-request, and lifecycle facilities |
| 4 | `genesis-world-kit:possibility-archive` | `possibility-archive` | Possibility Archive | Cognition schema, counterfactual, quality-diversity, variation, and evolution-regime review spaces |
| 5 | `genesis-world-kit:role-commons` | `role-commons` | Role Commons | Program-ecology relations, role criteria, collective-integration proposals, and institution proposal spaces |
| 6 | `genesis-world-kit:culture-archive` | `culture-archive` | Culture Archive | Cultural topology, inheritance, lineage, environmental-memory, retention, and attributed transmission spaces |

All six rows are instances of the one `GenesisWorldKitV1` contract. The
human-readable district role is presentation metadata, never a contract type or
JavaScript module name; callers identify a kit only by the table's exact `kitId`
and closed `kitKind`.

Each kit has typed Root Spine, district, route, service, and future-extension
sockets. Its presentation slots are initially static and claim-labelled. The
kit may contain geometry descriptors, safe style tokens, semantic glyph style,
and inaccessible-state alternatives. It may not contain JavaScript, WGSL,
WASM, executable expressions, arbitrary shaders, URLs, filesystem paths,
source bytes, live IDs, capability tokens, device handles, peer identities, or
mutable objects.

The kit can reserve a Code Matter or Matrix-glyph surface. RF-GE6 fills it only
with authored labels and sealed/unavailable affordances. Exact code glyphs and
revealed bytes require later audience-authorized Code Matter projection; public
kits never derive a silhouette, size, coordinate, or label from private source.

## Stable coordinates and relocation evidence

RF-GE6 compiles in the Cityform-local right-handed metre frame. The Root Spine
and its local frame remain independent of any exterior Cityform or rendezvous
pose. The spatial policy expresses positions in integer millimetres,
orientations in integer millidegrees, and scale in integer millionths. No
unquantized platform floating-point result enters a digest. Accepted Realm
resource contracts that carry metre-valued numbers receive only values produced
by dividing a safe integer millimetre value by 1,000 under the pinned numeric
policy. The compiler multiplies the result by 1,000, requires the original
integer, and then uses the existing canonical Realm number encoder; failure to
round-trip rejects before hashing.

`coordinateFrameId` is `genesis-coordinate-frame:` plus the lowercase
hexadecimal SHA-256 under
`particle-realms.realmforge.rf-ge6.coordinate-frame-id@1` over, in order,
`audienceContextId`, derived `baseBakeId`, derived `baseBakeDigest`, and
`spatialPolicyContentId`. The unsigned layout evidence and final placement
index copy that exact value. It identifies only the RF-GE6 Cityform-local frame
and never includes or resolves an exterior pose.

Every placeable resource has one `stableCoordinateKey` derived from its
audience context, kit ID, semantic role, and stable source logical coordinate.
It is `genesis-stable-coordinate:` plus the lowercase hexadecimal SHA-256 under
`particle-realms.realmforge.rf-ge6.stable-coordinate-key@1` over those four
values in that order.
The content digest remains a separate row field, so a reviewed revision can
retain location while any change still changes the row and candidate digests.
The compiler uses this deterministic order:

1. Validate the current placement problem and optional prior evidence.
2. Match prior and current resources by exact `stableCoordinateKey`.
3. Retain the prior placement byte-for-byte when all current constraints pass.
4. Place unmatched new resources by canonical kit order, semantic-role order,
   source digest, and resource ID.
5. Resolve conflicts through the fixed spatial policy and canonical candidate
   order. Never use iteration arrival order or randomness.
6. Emit one retention decision for every matched prior placement.
7. Emit one relocation receipt for every `relocated` decision.
8. Reject the candidate if a relocation has no exact blocking constraint and
   policy reason.

`decision` is exactly `retained`, `relocated`, or `retired`. A retained row has
`relocationReceiptId: null` and identical prior/candidate stable-placement row digests. A
relocated row references exactly one relocation receipt. A retired row has a
literal `null` candidate row digest and topology-node reference represented by the schema's
documented nullable fields; it cannot disappear without evidence. New resources
have no fabricated prior receipt.

Allowed relocation reasons are exact and closed:

- `anchor-removed`;
- `bounds-changed`;
- `clearance-conflict`;
- `collision-conflict`;
- `district-envelope-conflict`;
- `navigation-disconnect`;
- `policy-version-changed`;
- `required-route-conflict`.

Visual preference alone is not a relocation reason. A changed exterior
Cityform pose never relocates local content.

## Static product invariants

All product compilers consume the same immutable internal placement-row set and
digest. No product may finalize or mutate placement, make a private correction
after source projection, or silently change another product's coordinate set.

### Collision

The collision product contains authored static primitives, layers, masks, and
review issues. It has no PhysX actor, shape handle, query object, callback, or
world pointer. World-space bounds honor orientation. Contact distance is not
reported as penetration. Any later engine adapter must independently validate
the product against the engine's actual filter semantics before admission.

### Navigation

The navigation product describes first-person walk surfaces, nodes, directed
edges, stairs/lifts, route classes, clearances, crossings, gates, and fallback
anchors. Every traversable edge must reference accepted collision clearance and
two accessible anchors. No route leaves the local city frame. Network, IPC,
syscall, import, and dependency roads are static semantic route templates in
RF-GE6; they do not claim that a channel or peer currently exists.

### HLOD

HLOD is semantic, audience-specific, and content-addressed. Every level retains
the same public-safe semantic identity while reducing geometry, materials, or
animation affordances. A public HLOD tree is compiled only from public source
and cannot reuse a private bounding box, cell occupancy, mesh, label, or
resource count. The fallback level remains complete-looking without disclosing
hidden cardinality.

### Accessibility

Every visible semantic landmark has an audience-safe label or a deliberate
nonvisual exclusion receipt. Every required route has instructions independent
of color, motion, audio, or fine glyph recognition. Captions and audio cues use
safe text resources. Accessibility resources use the same projected source and
placement-row digest as pixels, picking, collision, navigation, and HLOD; the
later closure and accessibility receipt independently verify that agreement.

### Operations evidence

The owner-only Operations evidence maps local static zones, landmarks, routes,
and proposal-target descriptors. It never embeds an action callback or
capability. Rows refer only to the owner-private local candidate. Connected
Cityforms, remote shells, peers, Travelers, rendezvous frames, bridges, and
remote routes are structurally absent. It is not a
`LocalOperationsLookupResourceContract`; RF-GE8 must materialize that accepted
record only after signed-layout acceptance, and later UI proposals must still
pass the separate live authority path.

### Cross-product closure

Verification rejects the complete candidate unless all of these statements are
true:

- collision, navigation, HLOD, accessibility, and Operations rows reference
  the exact same placement set permitted for their audience;
- every navigation edge has collision clearance and an accessibility route;
- every HLOD resource resolves inside the same dependency closure;
- every visible or interactable resource has an accessibility entry;
- every Operations row resolves to a local static zone or landmark;
- every RF-GE6-owned resource reachable from the manifest appears exactly once
  in the closure with one digest;
- no closure edge crosses audience context or source projection;
- the candidate closure validated by the accepted definition has
  `unresolvedCount: 0`, and the paired
  `GenesisDisclosureVerificationReceiptV1.forbiddenReferenceCount` and
  `undisclosedReferenceCount` are both zero;
- there are no unresolved, cyclic, duplicate, or same-ID/different-digest
  resources.

The closure is built before the manifest. Its `rootResourceIds` is the sorted
unique set of exactly five IDs: grammar, district assembly, unsigned layout
evidence, stable placement index, and accessibility-closure receipt. Grammar
reaches its rules; assembly reaches kits, reviews, bindings, topology, and
routes; layout evidence reaches every stage-9 static product; the placement
index reaches all continuity and relocation receipts; and the accessibility
receipt reaches its navigation, safe-text, and audio resources. Graph
validation requires those five roots to reach every RF-GE6-owned entry,
with no extra entry. Owner Operations rows are contained by the unsigned
layout-evidence record rather than represented as a separate closure entry. The
closure record and future manifest are not closure entries, and the later
disclosure, compilation, verification, public-noninterference, and
refinement-isolation receipts are also outside it.

The only other non-entry references are the exact accepted base-bake and base-
layout receipt, audience source projection, RF-GE4/RF-GE5 inputs, spatial
policy, both limit profiles, target profile, and sealed catalog/trust-pack
records. Each is bound by an adjacent ID/digest pair, a content ID, or the
complete compilation-input digest and checked against its accepted or
golden-pinned definition. The disclosure verifier checks this closed external
reference class separately. Any other manifest or closure reference rejects.

## Disclosure and noninterference

Disclosure is a graph property, not a redaction pass. The compiler begins from
one accepted `RealmAudienceSourceProjectionContract` record, resolves only allowed source IDs, and
builds only that audience's resources. It never builds a private candidate and
removes fields to obtain a public candidate.

`verifyGenesisProjectionDisclosureV1()` walks every field that can contain an
ID or digest. It reconstructs reachability from the manifest, checks the
audience source projection, validates all public-base and refinement bindings,
and requires both forbidden and undisclosed counts to be zero. It emits a
receipt but does not sign, store, publish, or admit the result.

`verifyGenesisProjectionNoninterferenceV1()` performs a paired public test. The
two already verified public compiler inputs must have byte-identical public
source, base-bake, compilation-window, and policy digests. The surrounding
certification harness changes a private-only corpus that is never passed to the
compiler. Both public canonical bundles must remain byte-identical. Static
inspection also pins the compiler's import closure and requires
`privateInputPortCount: 0`, `ambientSourcePortCount: 0`,
`privateInputReadAttemptCount: 0`, and `crossAudienceCacheHitCount: 0`.

The noninterference receipt contains no private digest, private count, hidden
resource ID, or timing sample. It proves equality without disclosing what was
excluded.

The public test profile is frozen as
`rf-ge6-public-noninterference-v1`. `privateMutationClassIds` is exactly the
sorted set `private-content-change`, `private-count-change`,
`private-relationship-change`, and `private-placement-pressure-change`.
`checkedInvariantIds` is exactly the sorted set
`canonical-bundle-digest-equality`, `closure-digest-equality`,
`manifest-digest-equality`, `zero-ambient-source-ports`,
`zero-cross-audience-cache-hits`, `zero-private-input-ports`, and
`zero-private-read-attempts`. `publicPolicySetDigest` uses
`particle-realms.realmforge.rf-ge6.public-policy-set@1` over, in order, the
public projection's `disclosurePolicyDigest`, spatial-policy content ID,
target-profile content ID, binding-profile digest, RF-GE6 Realm-profile digest,
and RF-GE6 projection-limit profile digest.

`baselineRunId` and `comparisonRunId` use
`particle-realms.realmforge.rf-ge6.public-test-run-id@1` over the common public
compilation-input digest and respectively the literal `baseline` or
`comparison`; neither run ID covers private data. `result` is `pass` exactly
when all three baseline/comparison manifest, closure, and canonical-bundle
digest pairs are equal and all four counters are zero. Any other outcome rejects
without emitting a passing receipt.

`verifyGenesisRefinementIsolationV1()` consumes one already verified public
base result and one already verified capability-refined result. It compares the
refinement source projection's declared `resourceScopes` with the projected
resource-scope set, proves zero forbidden, out-of-scope, and unlabelled
resources, and proves that the compiler has no private or ambient input port.
It does not receive or dereference an authority receipt, capability broker,
encryption envelope, publisher, signature, or current clock. Its receipt fixes
`authorityEvidenceStatus: not-evaluated`; it cannot be used as an entitlement
or accepted `RealmRefinementScopeReceiptContract`.

The refinement profile is frozen as `rf-ge6-refinement-isolation-v1`.
`checkedInvariantIds` is exactly the sorted set `declared-scope-consumed`,
`no-forbidden-reachability`, `no-out-of-scope-source`,
`no-unlabelled-resource`, `zero-ambient-source-ports`, and
`zero-private-input-ports`. `declaredResourceScopeIds` is the accepted
refinement projection's exact sorted `resourceScopes` array.
`projectedResourceScopeIds` is the sorted unique set of capability-refined
source `resourceId` values actually present in the 22 binding source-set
descriptors, not generated closure-resource IDs. Each set digest uses
`particle-realms.realmforge.rf-ge6.refinement-scope-set@1` over the complete ID
array followed by its literal count. The declared and projected arrays and
counts must be identical; every consumed source is either in that array or in
the accepted `shippedPublicResourceRefs` set; every closure entry has a valid
contained disclosure class; both port counts are zero; and all three violation
counts are zero. Only that conjunction may set `result: pass`.

## Deterministic compile and verify pipeline

`compileGenesisProjectionWorldV1()` executes these exact pure stages in order:

1. `preflightGenesisProjectionCompilationInputV1()` enforces exact keys,
   hostile-value rejection, canonical byte bounds, one audience context, both
   complete accepted base records and their derived six-field reference, the
   two-field compilation window, and both exact limit profiles.
2. `verifyGenesisEcologyEvidencePlanV1()` independently verifies RF-GE5 and its
   RF-GE4 binding from the received source input.
3. `validateGenesisProjectionWorldCatalogV1()` verifies the separate 16-record
   schema catalog, versions, order, and digests.
4. `validateGenesisProjectionGrammarV1()` verifies exactly 22 closed rules and
   one-to-one rule/binding coverage.
5. `verifyGenesisReviewedWorldKitCatalogV1()` verifies exactly six golden kits,
   six accepted review receipts, and complete resource closures.
6. the accepted audience-source projector validator proves the source records and
   exact audience scope before any placement work.
7. `compileGenesisProjectionBindingsV1()` resolves explicit IDs and produces
   static slots with `liveValuePolicy: forbidden`.
8. `planGenesisStableWorldPlacementV1()` derives an internal immutable placement
   plan, stable rows, candidate retention decisions, and candidate relocation
   rows. It emits no record that references a not-yet-created layout evidence
   digest.
9. `compileGenesisStaticWorldProductsV1()` derives topology, geometry, material,
   lighting, collision, navigation, socket, HLOD, safe-text,
   accessibility-route, glyph, audio, and the conditional owner Operations
   evidence rows from that exact placement plan. It emits neither an accepted
   Operations lookup nor the later accessibility-closure receipt.
10. `createGenesisSpatialLayoutEvidenceV1()` binds the placement-row digest,
    topology pairs, and every product row without a signature or admission
    claim.
11. `finalizeGenesisStablePlacementEvidenceV1()` creates relocation receipts,
    then retention receipts that may name them, and finally the stable-placement
    index. Each receipt binds the applicable prior/candidate placement rows; the
    index binds both complete receipt ID/digest sets and the now-existing
    unsigned layout-evidence ID/digest. None references a future record.
12. `compileGenesisAccessibilityClosureV1()` binds navigation, safe text, audio,
    visible landmarks, and route exclusions to the same layout evidence.
13. `createGenesisDistrictAssemblyV1()` binds the six reviewed kits, 22
    bindings, placed topology, routes, and external sockets.
14. `compileGenesisExtensionDependencyClosureV1()` constructs the complete
    audience-specific static-resource closure and canonical topological order.
    It excludes later receipts that reference the manifest.
15. `createGenesisRealmExtensionManifestV1()` binds the exact base bake,
    Genesis source revision, products, layout evidence, closure, policies,
    profiles, compilation window, and compiler identity.
16. `verifyGenesisProjectionDisclosureV1()` verifies the completed manifest and
    emits the external disclosure receipt. The manifest does not reference this
    receipt, so no digest cycle exists.
17. `createGenesisProjectionCompilationReceiptV1()` binds the manifest,
    disclosure receipt, exact work rows, and issue rows with inert literals.

On success the compiler returns one exact-key object with these fields in this
order: `audienceContextId`, `projectionBindings`, `staticProducts`,
`spatialLayoutEvidence`, `relocationReceipts`,
`coordinateRetentionReceipts`, `stablePlacementIndex`,
`accessibilityClosureReceipt`, `districtAssembly`, `dependencyClosure`,
`manifest`, `disclosureReceipt`, `compilationReceipt`, and
`canonicalBundleDigest`. `staticProducts` has exactly these ordered arrays:
`topologyNodes`, `topologyEdges`, `geometryResources`, `materialBindings`,
`lightingIntents`, `collisionResources`, `navigationResources`,
`socketResources`, `lodResources`, `safeTextResources`, `glyphStyles`, and
`audioZones`; each uses its accepted contract's canonical ID order.

`canonicalBundleDigest` uses
`particle-realms.realmforge.rf-ge6.projection-canonical-bundle@1` over the first
thirteen complete fields in the declared return-object order. It includes the
compilation receipt but excludes only itself and the later
verification/isolation receipts, so there is no self-digest cycle. A rejection
returns no partial object.

`verifyGenesisProjectionWorldV1()` independently reruns stages 1-17 from the
same immutable input, compares the complete canonical bundle byte-for-byte, and
requires both canonical-byte digest fields in its receipt to equal the received
and recompiled `canonicalBundleDigest` values. It emits
`GenesisProjectionVerificationReceiptV1` and never accepts a caller-supplied
intermediate product.

After the owner, public, and refinement compile/verify calls have independently
completed, the certification harness runs the paired public noninterference and
refinement-isolation verifiers. Their receipts remain external evidence and are
pinned in the additive ledger; they are not inserted into any audience closure
or manifest.

The verifier calls captured module functions, not overrideable instance
methods. The compiler and verifier share declarative constants but no mutable
cache. RF-GE6 has no partial-success result. Any rejection returns no candidate,
no receipt that says complete, and no state change.

## V1 limits and work accounting

The implementation freezes two complete input records. The first validates
against the unchanged accepted `RealmBakeResourceLimitProfileContract` with:

- `format: particle-realms.realm-bake-resource-limit-profile` and `version: 1`;
- `resourceLimitProfileId: limits:realmforge-genesis-rf-ge6-v1`;
- `profileVersion: limits:realmforge-genesis-rf-ge6-v1`;
- `countingPolicyId: counting:realmforge-genesis-rf-ge6-v1`;
- `enforcementMode: fail-closed-before-allocation`; and
- this exact `ceilings` object in accepted contract order:

| Accepted Realm ceiling | RF-GE6 V1 value |
| --- | ---: |
| `maximumCanonicalJsonBytes` | 16,777,216 |
| `maximumSourceResourceCount` | 65,536 |
| `maximumSourceRelationshipCount` | 65,536 |
| `maximumTopologyNodeCount` | 65,536 |
| `maximumTopologyEdgeCount` | 65,536 |
| `maximumManifestResourceCount` | 65,536 |
| `maximumDependencyDepth` | 256 |
| `maximumResourceByteLength` | 67,108,864 |
| `maximumTotalBakeByteLength` | 536,870,912 |
| `maximumGeometryPayloadCount` | 65,536 |
| `maximumVertexCount` | 16,777,216 |
| `maximumIndexCount` | 33,554,432 |
| `maximumMaterialBindingCount` | 65,536 |
| `maximumLightingIntentCount` | 65,536 |
| `maximumCollisionPrimitiveCount` | 65,536 |
| `maximumNavigationPolygonCount` | 65,536 |
| `maximumSocketCount` | 65,536 |
| `maximumLodRecordCount` | 65,536 |
| `maximumProjectionBindingCount` | 22 |
| `maximumGlyphStyleCount` | 65,536 |
| `maximumAudioZoneCount` | 65,536 |
| `maximumStoryletDefinitionCount` | 1 |
| `maximumStoryletStateCount` | 1 |
| `maximumStoryletTransitionCount` | 1 |
| `maximumStoryletProposalTemplateCount` | 1 |
| `maximumStoryletDependencyReferenceCount` | 1 |
| `maximumLocalOperationsCellCount` | 65,536 |
| `maximumLocalOperationsAnchorCount` | 65,536 |
| `maximumLocalOperationsZoneCount` | 65,536 |
| `maximumLocalOperationsRouteCount` | 65,536 |
| `maximumLocalOperationsLandmarkCount` | 4,096 |
| `maximumLocalOperationsHlodCount` | 4,096 |
| `maximumRouteSearchNodeCount` | 65,536 |
| `maximumCompilerWorkUnits` | 17,400,248 |

The positive Storylet ceilings are schema minima, not permission: RF-GE6 exact-
key input and output validation still forbids every Storylet record. The
accepted contract's canonical digest algorithm computes `profileDigest` over
the complete canonical payload (everything except the self digest), and the V6
pack golden-pins the resulting digest.

The second input is the additional exact RF-GE6 projection-limit record. Both
complete records and both exact digests appear in the manifest budget, provider
descriptors, browser tests, Python vectors, and V2 freeze ledger:

| Boundary | V1 maximum |
| --- | ---: |
| Canonical input bytes | 16,777,216 |
| String UTF-8 bytes | 8,192 |
| Structural depth | 48 |
| Properties on one object | 1,024 |
| Total properties | 262,144 |
| Concurrent digest lanes | 8 |
| Source resource rows | 65,536 |
| Source relationship rows | 65,536 |
| Projection rules | 22 exactly |
| Projection bindings | 22 exactly |
| Reviewed kits | 6 exactly |
| Review receipts | 6 exactly |
| Resource references per kit | 4,096 |
| Aggregate kit resource references | 24,576 |
| Spatial anchors | 65,536 |
| Placements | 65,536 |
| Retention decisions | 65,536 |
| Relocation receipts | 65,536 |
| Collision primitive rows | 65,536 |
| Navigation nodes | 65,536 |
| Navigation edges | 65,536 |
| HLOD rows | 65,536 |
| Accessibility rows | 65,536 |
| Operations evidence rows | 65,536 |
| Closure resources | 65,536 |
| Closure edges | 65,536 |
| Dependency depth | 256 |
| Issue rows | 4,096 |
| Digest preimages | 524,288 |
| Compiler work units | 17,400,248 |

The 16 MiB canonical-byte ceiling remains the final aggregate bound even when
an individual count ceiling is larger than what that byte budget can encode.

`projectionLimitProfile` has exactly 35 own keys in this order: `format`, `version`,
`profileId`, `profileVersion`, `maximumCanonicalInputBytes`,
`maximumStringUtf8Bytes`, `maximumStructuralDepth`,
`maximumPropertiesPerObject`, `maximumTotalProperties`,
`maximumConcurrentDigestLanes`, `maximumSourceResourceRows`,
`maximumSourceRelationshipRows`, `exactProjectionRuleCount`,
`exactProjectionBindingCount`, `exactReviewedKitCount`,
`exactReviewReceiptCount`, `maximumKitResourceReferencesPerKit`,
`maximumAggregateKitResourceReferences`, `maximumSpatialAnchors`,
`maximumPlacements`, `maximumRetentionDecisions`,
`maximumRelocationReceipts`, `maximumCollisionPrimitiveRows`,
`maximumNavigationNodes`, `maximumNavigationEdges`, `maximumHlodRows`,
`maximumAccessibilityRows`, `maximumOperationsEvidenceRows`,
`maximumClosureResources`, `maximumClosureEdges`,
`maximumDependencyDepth`, `maximumIssueRows`, `maximumDigestPreimages`,
`maximumCompilerWorkUnits`, and `profileDigest`. V1 fixes
`format: particle-realms.realmforge.rf-ge6.projection-limit-profile`,
`version: 1`, `profileId: limits:realmforge-genesis-rf-ge6-projection-v1`, and
`profileVersion: projection-limits-v1`. The 30 numeric fields after
`profileVersion` map one-to-one, in declared order, to the 30 Boundary rows in
their displayed order. `profileDigest` uses
`particle-realms.realmforge.rf-ge6.projection-limit-profile@1` over every
preceding field in the declared order.

The manifest's `resourceBudget` has exactly seven fields:
`realmBakeResourceLimitProfileId`, `realmBakeResourceLimitProfileDigest`,
`projectionLimitProfileId`, `projectionLimitProfileDigest`,
`maximumCanonicalInputBytes`, `maximumCompilerWorkUnits`, and
`countingPolicyId`. It must reproduce the two frozen input profiles, set
`countingPolicyId: counting:realmforge-genesis-rf-ge6-v1`, and fix the
effective minima to 16,777,216 bytes and 17,400,248 work units.

Each `workCountRows` item has exactly six fields: `componentOrder`,
`componentId`, `unitCount`, `multiplier`, `componentWorkUnits`, and `rowDigest`.
The 18 rows are exact, ordered, and use these maximum counts and multipliers:

| Order | Component ID | Maximum unit count | Multiplier |
| ---: | --- | ---: | ---: |
| 0 | `preflight-properties` | 262,144 | 1 |
| 1 | `source-resources` | 65,536 | 4 |
| 2 | `source-relationships` | 65,536 | 4 |
| 3 | `projection-rules` | 22 | 8 |
| 4 | `projection-bindings` | 22 | 12 |
| 5 | `kit-resource-references` | 24,576 | 4 |
| 6 | `placement-candidates` | 65,536 | 32 |
| 7 | `retention-decisions` | 65,536 | 8 |
| 8 | `relocation-receipts` | 65,536 | 16 |
| 9 | `collision-primitives` | 65,536 | 8 |
| 10 | `navigation-nodes` | 65,536 | 8 |
| 11 | `navigation-edges` | 65,536 | 12 |
| 12 | `hlod-rows` | 65,536 | 10 |
| 13 | `accessibility-rows` | 65,536 | 8 |
| 14 | `operations-rows` | 65,536 | 8 |
| 15 | `closure-resources` | 65,536 | 6 |
| 16 | `closure-edges` | 65,536 | 8 |
| 17 | `digest-preimages` | 524,288 | 16 |

For every row, `componentWorkUnits` is the checked safe-integer product of the
actual `unitCount` and frozen `multiplier`. Total work is the checked
safe-integer sum of rows 0 through 17 in that order. The all-maxima sum is
exactly 17,400,248. `workCountRowsDigest` uses
`particle-realms.realmforge.rf-ge6.work-count-rows@1` over the 18 complete rows
followed by literal count `18`; each `rowDigest` uses
`particle-realms.realmforge.rf-ge6.work-count-row@1` over the preceding five
fields. Overflow,
negative work, a count above its component ceiling, a changed multiplier, a
missing/reordered row, or total work above either input profile rejects before
the corresponding allocation or digest work starts.

`unitCount` has one exact source for each component:

- `preflight-properties`: one increment for each own-key occurrence visited by
  the canonical depth-first preflight of the complete gate input;
- `source-resources`: `audienceSourceProjection.resourceRecords.length`;
- `source-relationships`:
  `audienceSourceProjection.relationshipRecords.length`;
- `projection-rules`: `projectionGrammar.ruleIds.length`, exactly 22;
- `projection-bindings`: the completed `projectionBindings.length`, exactly 22;
- `kit-resource-references`: the checked sum of `anchorTemplateIds`,
  `placementConstraintIds`, `facilityResourceIds`, `routeTemplateIds`, and
  `presentationSlotIds` lengths across the six reviewed kits;
- `placement-candidates`: the canonical internal placement-plan row count;
- `retention-decisions`: the completed coordinate-retention receipt count;
- `relocation-receipts`: the completed relocation receipt count;
- `collision-primitives`: the canonical collision-primitive intermediate-row
  count consumed by static-product packaging;
- `navigation-nodes`: the canonical navigation-node intermediate-row count;
- `navigation-edges`: the canonical navigation-edge intermediate-row count;
- `hlod-rows`: the canonical HLOD intermediate-row count;
- `accessibility-rows`: the canonical accessibility intermediate-row count;
- `operations-rows`: owner-private `localOperationsRowCount`, or zero for the
  public and refinement contexts;
- `closure-resources`: `dependencyClosure.entries.length`;
- `closure-edges`: the checked sum of `directDependencies.length` over every
  dependency-closure entry; and
- `digest-preimages`: one increment for every SHA-256 request performed by
  successful compile stages 1 through 17, including row, set, record, bundle,
  and receipt digests.

Preflight counts every reference occurrence and rejects a cycle rather than
deduplicating by object identity. Each intermediate row named here is the exact
canonically ordered row consumed by its corresponding output encoder, not an
estimate, capacity, allocation attempt, or rejected row. No attempted or
rejected allocation is counted as completed work.

Because RF-GE6 has no partial-success result, a successful compilation receipt
has `issueRows: []`. `issueRowsDigest` is the digest under
`particle-realms.realmforge.rf-ge6.issue-rows@1` over the empty array followed
by literal count `0`. The 4,096-row ceiling bounds the fail-closed diagnostic
accumulator only; diagnostics are returned with rejection and never embedded in
a candidate or successful receipt.

## Flat module ownership

The implementation remains modular and unnested. Each of the 16 new contracts has
one peer module directly under
`webgpu-os/apps/realmforge/modeler/genesis/`:

- `GenesisProjectionRuleV1.js`;
- `GenesisProjectionGrammarV1.js`;
- `GenesisWorldKitV1.js`;
- `GenesisWorldKitReviewReceiptV1.js`;
- `GenesisDistrictAssemblyV1.js`;
- `GenesisSpatialLayoutEvidenceV1.js`;
- `GenesisStablePlacementIndexV1.js`;
- `GenesisCoordinateRetentionReceiptV1.js`;
- `GenesisRelocationReceiptV1.js`;
- `GenesisAccessibilityClosureReceiptV1.js`;
- `GenesisDisclosureVerificationReceiptV1.js`;
- `GenesisPublicNoninterferenceReceiptV1.js`;
- `GenesisRefinementIsolationReceiptV1.js`;
- `GenesisRealmExtensionManifestV1.js`;
- `GenesisProjectionCompilationReceiptV1.js`;
- `GenesisProjectionVerificationReceiptV1.js`.

The compiler and provider peers live beside them:

| Planned peer | Single responsibility |
| --- | --- |
| `GenesisProjectionWorldPrimitivesV1.js` | Shared frozen enums, ID grammar, limits, and canonical row helpers |
| `GenesisProjectionWorldContractCatalogV1.js` | Exact ordered 16-record definitions and accepted dependency pins only |
| `GenesisProjectionWorldGraphValidatorV1.js` | Cross-record digest, order, reference, cycle, and limit validation |
| `GenesisReviewedWorldKitCatalogV1.js` | Exact six golden kits, review receipts, and resource locks |
| `GenesisAudienceSourceProjectionCompilerV1.js` | Pure audience allowlist construction and validation |
| `GenesisProjectionBindingCompilerV1.js` | Closed 22-rule static binding resolution |
| `GenesisStableWorldPlacementCompilerV1.js` | Quantized internal placement plans, then final placement, retention, and relocation evidence after product and layout-evidence compilation |
| `GenesisStaticWorldProductCompilerV1.js` | Topology, geometry, material, lighting, collision, navigation, socket, HLOD, safe-text/accessibility-route, glyph, audio, and owner-only Operations evidence rows; neither an accepted Operations lookup nor the later accessibility-closure receipt |
| `GenesisSpatialLayoutEvidenceCompilerV1.js` | Unsigned topology/product/placement agreement evidence with no signing or admission surface |
| `GenesisProjectionDisclosureVerifierV1.js` | Audience reachability and forbidden-reference proof |
| `GenesisProjectionNoninterferenceVerifierV1.js` | Paired public equality and static port isolation as an inert Genesis receipt |
| `GenesisRefinementIsolationVerifierV1.js` | Declared-scope projection and static port isolation with authority explicitly unevaluated |
| `GenesisProjectionWorldCompilerV1.js` | Pure stage orchestration and inert manifest/receipt assembly |
| `GenesisProjectionWorldVerifierV1.js` | Independent deterministic recompile and byte comparison |
| `GenesisEcologyProjectionDomainPackV6.js` | Sealed descriptors, upstream locks, golden digests, and verification-only provider |

`webgpu-os/apps/realmforge/modeler/genesis/rf-ge6/index.js` is the only new
gate barrel. It re-exports the frozen RF-GE5 surface and RF-GE6 symbols. It
does not change `modeler/genesis/index.js`, RF-GE4, RF-GE5, or any accepted
Virtual Realm entry. No peer constructs another peer; the application entry
receives the catalogs and pure functions explicitly.

## RF-GE6 trust pack

The separate V6 pack uses the planned identity
`realmforge.genesis-ecology.projection-authoring@6.0.0`. It pins:

- the exact RF-GE5 manifest, descriptor-catalog, descriptor-lock, and upstream
  binding digests;
- all 16 RF-GE6 contract definitions and every reused accepted-contract digest;
- all 22 rule digests and the exact binding-profile descriptor digest;
- all six kit and six review-receipt digests;
- the unsigned layout-evidence, public-noninterference, and
  refinement-isolation definition and implementation digests;
- the owner Operations-evidence row schema, ID/digest domains, and RF-GE8-only
  accepted-lookup materialization boundary;
- every trusted compiler/verifier implementation descriptor;
- the exact static import closure;
- the exact RF-GE6 Realm-profile digest, RF-GE6 projection-limit profile
  digest, 18-row work-accounting table digest, and error-code table;
- canonical browser fixtures and independent Python vector digests.

The provider exposes immutable manifests, descriptors, locks, catalogs, and
verification methods only. It exposes no implementation resolver, dynamic
import, installer, compiler executor, runtime interpreter, cache, storage,
registry commit, publication, signing, capability, topology-admission, ECS,
renderer, network, or active-root method.

Provider metadata must include these exact false values:

```json
{
  "admitsTopology": false,
  "archivesEvidence": false,
  "authorityBearing": false,
  "containsExecutableCode": false,
  "executesCompilers": false,
  "grantsAuthority": false,
  "installsImplementations": false,
  "mintsIdentity": false,
  "persists": false,
  "projectsRuntime": false,
  "publicationEligibility": false,
  "publishes": false,
  "registryPublication": false,
  "resolvesImplementations": false,
  "runtimeActivation": false,
  "scansLiveState": false,
  "selfModification": false
}
```

## Failure model

The V1 error-code table is closed. Errors retain a stable `code`, canonical
`path`, message, and bounded data-only `details` value. It contains exactly:

- `RF_GE6_BASE_BAKE_MISMATCH`;
- `RF_GE6_CANONICAL_ORDER`;
- `RF_GE6_COMPILATION_WINDOW_INVALID`;
- `RF_GE6_CONTEXT_MISMATCH`;
- `RF_GE6_DEPENDENCY_CYCLE`;
- `RF_GE6_DIGEST_MISMATCH`;
- `RF_GE6_DISCLOSURE_VIOLATION`;
- `RF_GE6_DUPLICATE`;
- `RF_GE6_INERTNESS_VIOLATION`;
- `RF_GE6_INVALID_INPUT`;
- `RF_GE6_LAYOUT_EVIDENCE_MISMATCH`;
- `RF_GE6_LIMIT_EXCEEDED`;
- `RF_GE6_LIVE_STATE_FORBIDDEN`;
- `RF_GE6_MISSING_REFERENCE`;
- `RF_GE6_NONINTERFERENCE_VIOLATION`;
- `RF_GE6_OPERATIONS_MATERIALIZATION_FORBIDDEN`;
- `RF_GE6_OPERATIONS_SCOPE_VIOLATION`;
- `RF_GE6_PLACEMENT_CONFLICT`;
- `RF_GE6_PRIOR_EVIDENCE_REJECTED`;
- `RF_GE6_PROFILE_MISMATCH`;
- `RF_GE6_REFINEMENT_ISOLATION_VIOLATION`;
- `RF_GE6_RELOCATION_UNEXPLAINED`;
- `RF_GE6_REVIEW_REQUIRED`;
- `RF_GE6_SOURCE_CLOSURE_VIOLATION`;
- `RF_GE6_STATIC_PRODUCT_MISMATCH`;
- `RF_GE6_TRUST_LOCK_MISMATCH`;
- `RF_GE6_WORK_ACCOUNTING_MISMATCH`.

No error includes a rejected private value, source byte, peer identifier, key,
capability, or hidden-resource count.

## Exact browser acceptance matrix

The direct RF-GE6 browser gate contains exactly 48 cases. One case may contain
multiple assertions, but the gate count and IDs remain frozen after acceptance.

| Cases | Required evidence |
| --- | --- |
| `RF-GE6-01`-`RF-GE6-08` | Exact 16-record order; accepted-contract reuse locks; exact fields; hostile preflight; exact 17-key input; complete base-manifest/layout-receipt cross-linking; compilation-window closure; both limit-profile locks; exact 18-row work accounting and maximum; canonical digest; duplicate/dangling/cycle rejection; source-gate closure; separate-catalog isolation; representative plus-one rejection |
| `RF-GE6-09`-`RF-GE6-15` | Exact six-kit order; golden kit locks; six review receipts; changed-kit rejection; unreviewed-kit rejection; rule/kit coverage; audience eligibility |
| `RF-GE6-16`-`RF-GE6-22` | Exact 22-rule order; exactly 22 derived bindings per audience; source digest binding; missing-source rejection; reviewed fallback semantics; live-state rejection; callable/path/URL rejection |
| `RF-GE6-23`-`RF-GE6-30` | Canonical internal placement plan; complete static products before layout evidence; unsigned layout-evidence agreement; final placement/index order; exact retention; hostile prior evidence; deterministic conflict order; reasoned relocation; complete prior-decision coverage; spatial maxima; local/exterior frame separation |
| `RF-GE6-31`-`RF-GE6-38` | Collision derivation; navigation derivation; collision/navigation agreement; HLOD closure; accessibility closure; owner Operations evidence; public/refinement four layout fields plus two manifest references all null; accepted Operations materialization deferred; dependency closure with `unresolvedCount = 0` and disclosure-owned forbidden-reference counts |
| `RF-GE6-39`-`RF-GE6-44` | Three exact contexts; independent public build; independent refinement build; manifest-before-disclosure ordering and acyclicity; paired Genesis public-noninterference evidence; Genesis refinement-isolation evidence with authority unevaluated; changed-private/public-identical proof |
| `RF-GE6-45`-`RF-GE6-48` | Byte-identical repeat compile; independent verifier recompile from declared inputs; descriptor, profile, work-table, and upstream trust locks; sealed provider and complete inertness boundary |

The browser files are:

- `tests/realmforge/genesis-ecology-rf-ge6.html`;
- `tests/realmforge/genesis-ecology-rf-ge6.main.js`;
- `tests/realmforge/genesis-ecology-rf-ge6.test.js`.

The gate must report `48/48`, zero console errors, and no skipped case.

## Independent Python and hostile vectors

`tests/realmforge/test_genesis_ecology_rf_ge6_vectors.py` uses only Python
canonicalization and hashing code. It must not invoke a browser, translate
JavaScript, import generated browser outputs as expected values, or share a
digest implementation with production.

The checked-in fixture
`tests/realmforge/fixtures/genesis-ecology-rf-ge6-vectors-v1.json` contains
exactly 22 accepted vector groups in this immutable order:

1. `catalog-and-definition-locks`;
2. `projection-rule-and-grammar`;
3. `binding-profile-and-22-bindings`;
4. `continuity-core-kit`;
5. `foundry-district-kit`;
6. `maintenance-works-kit`;
7. `possibility-archive-kit`;
8. `role-commons-kit`;
9. `culture-archive-kit`;
10. `owner-private-complete-bundle`;
11. `public-explicit-complete-bundle`;
12. `capability-refined-complete-bundle`;
13. `stable-retention`;
14. `reasoned-relocation`;
15. `collision-navigation-agreement`;
16. `hlod-accessibility-agreement`;
17. `owner-operations-closure`;
18. `public-noninterference`;
19. `refinement-isolation`;
20. `work-accounting-maxima`;
21. `canonical-repeat`;
22. `hostile-corpus`.

The first group covers canonical preimages and definition digests for all 16
contracts. The three complete-bundle groups each include the manifest,
dependency closure, manifest-bound disclosure receipt, compilation receipt, and
verification receipt for one audience context. The isolation groups remain
unsigned, inert evidence and do not import accepted authority-bearing receipts.

Hostile vectors cover duplicate decoded keys, accessors, inherited properties,
sparse arrays, cycles, malformed Unicode, over-depth and over-byte values,
unsafe integers, same-ID/different-digest rebinding, cross-audience references,
unreviewed resources, unexplained relocation, private-derived public fields,
remote Operations rows, attempted accepted Operations materialization, and
callable/path/URL payloads.

## Bundle, regression, and static gates

RF-GE6 acceptance also requires:

1. The isolated `rf-ge6/index.js` browser import resolves its exact static
   production closure with zero skipped or dynamically discovered modules.
2. The closure count, source-byte count, and per-file SHA-256 set are captured
   as evidence after implementation; this plan does not fabricate those future
   measurements.
3. A normal WebGPU OS bundle resolves with zero skipped modules and no RF-GE6
   auto-boot or side effect.
4. Static scanning finds no dynamic import, `eval`, function constructor,
   worker startup, filesystem/network API, WebGPU device, renderer, ECS store,
   document store, registry commit, publication port, capability broker,
   active-root selector, or wall-clock/random dependency in the RF-GE6 closure.
5. RF-GE0, RF-GE1, RF-GE1A, RF-GE2, RF-GE3, RF-GE4, RF-GE5, M0, M1A, M1B,
   and M1C acceptance suites remain green and byte-frozen.
6. SPDX, conflict-marker, malformed-vector, whitespace, and documentation-link
   checks pass for all new files.

## Additive freeze ledger

RF-GE6 never edits the version-1 M1C/RF-GE5 ledger. Acceptance creates
`tests/realmforge/fixtures/realmforge-m1c-rf-ge6-freeze-ledger-v2.json` with:

- `format: particle-realms.realmforge.acceptance-freeze-ledger`;
- `version: 2`;
- the exact prior-ledger path and physical SHA-256;
- the exact prior `milestonesSha256`;
- the two prior milestone rows reproduced byte-for-byte after canonicalization;
- one new `realmforge-rf-ge6` milestone;
- RF-GE6 fixture format/version/path and canonical JSON SHA-256;
- the normalized-LF 48-case browser-suite SHA-256;
- the independent 22-group Python-vector SHA-256;
- the 16-contract catalog digest and accepted-contract dependency digest;
- the 22-rule grammar, binding-profile, and three audience binding-set digests;
- the six-kit catalog and review-set digests;
- the three audience unsigned layout-evidence, stable-placement-index,
  district-assembly, accessibility-closure, dependency-closure, RF-GE6
  manifest, disclosure-receipt, compilation-receipt, verification-receipt, and
  canonical-bundle digests;
- the owner-only local-Operations evidence digest and literal public/refinement
  Operations-absence assertions;
- the Genesis public-noninterference and refinement-isolation receipt digests;
- the RF-GE6 Realm-profile, RF-GE6 projection-limit profile, and exact 18-row
  work-accounting-table digests;
- the V6 domain-pack manifest, descriptor catalog, descriptor locks, and RF-GE5 upstream
  trust-binding digests;
- a newly computed aggregate `milestonesSha256`;
- `authorityBearing: false` and `runtimeActivation: false`.

All new hashes are computed from final gate-verified bytes and then
golden-pinned.
This architecture document intentionally claims no not-yet-generated digest.
The old ledger remains independently verifiable and recoverable.

## RF-GE7 Storylet sidecar handoff

RF-GE6 freezes one handoff decision without adding a seventeenth contract or a
seventy-third manifest field. RF-GE7 owns a separate
`GenesisStoryletExtensionManifestV1` and a separate unsigned Storylet-
compilation-evidence contract. The Storylet manifest has exactly 24 fields in
this order: `format`, `version`, `storyletExtensionManifestId`,
`semanticVersion`, `audienceContextId`, `genesisManifestId`,
`genesisManifestDigest`, `storyletCompilationEvidenceId`,
`storyletCompilationEvidenceDigest`, `dependencyClosureId`,
`dependencyClosureDigest`, `compilerImplementationId`, `compilerVersion`,
`containsExecutableCode`, `executionStatus`, `publicationStatus`,
`authorityBearing`, `grantsAuthority`, `publicationEligibility`, `persists`,
`registryPublication`, `scansLiveState`, `runtimeActivation`, and
`storyletExtensionManifestDigest`.

The RF-GE7 contract fixes `containsExecutableCode: false`,
`executionStatus: not-executed`, `publicationStatus: not-published`, and every
boolean field to `false`. Its Genesis manifest ID/digest pair points one way to
a verified RF-GE6 result. The RF-GE6 manifest never points back, and the two
dependency closures never contain each other. RF-GE7 does not construct an
accepted signed public/refined `RealmStoryletCatalogContract` or
`RealmStoryletCatalogValidationReceiptContract`; RF-GE8 owns those conversions,
signatures, publication checks, and rollback bindings. The remaining RF-GE7
evidence fields and tests are frozen in the RF-GE7 gate, not improvised inside
RF-GE6.

## Cross-stack touch boundary

RF-GE6 changes RealmForge authoring code and tests only. The planned touch map
prevents a documentation milestone from being mistaken for a runtime rollout:

| System | RF-GE6 work | Explicitly deferred |
| --- | --- | --- |
| RealmForge Genesis modeler | Add the 16 contract peers, catalogs, reviewed kits, pure compilers, verifiers, V6 provider, isolated entry, and inspector adapters | Factory execution, registry publication, document persistence, or active-head changes |
| Accepted Virtual Realm contracts | Import and pin source projection, spatial policy, topology, static resource, closure, and audience-proof definitions; pin Operations row semantics for RF-GE8; validate the accepted signed base-layout receipt read-only | Constructing a new accepted signed layout/publication receipt or accepted Operations lookup, or changing any accepted field, format, version, validator, or 109-record order |
| RealmForge recipe surface | Add non-executable inspect, diff, preview, verify, and export guidance that calls the RF-GE6 pure APIs through injected hosts | Treating a recipe as authority, running a stage, or publishing a candidate |
| Engine and ECS | No production change; use only contract fixtures for cross-product review | Entity creation, component registration, system scheduling, physics bodies, navigation runtime, streaming, rendering, or GPU allocation |
| WebGPU OS | No production change; retain explicit source and authority separation | Live scan, process/filesystem/network subscription, capability lookup, action dispatch, or Chronicle mutation |
| SecureMesh and multiplayer | No production change | Peer discovery, shell transport, rendezvous, docking, bridge creation, presence, or remote resource access |
| Storylets | No production change; the 72-field RF-GE6 manifest has no Storylet field | RF-GE7 owns a separate data-only `GenesisStoryletExtensionManifestV1` sidecar; scheduling, execution, action proposals, or success claims remain later work |
| Publication and activation | Verify inert candidates only | Signing, storage, publication, root CAS, admission, rollback, or activation; RF-GE8 owns that authoring handoff |

The first RF-GE6 compiler has no semantic cache. It may use bounded concurrent
digest lanes, but deterministic verification reruns the complete compile. The
existing RF-GE3 cache remains scoped to exact verified RF-GE2 Plans and cannot
be reused as projection authority. A later projection cache requires its own
audience-separated keys, proof of byte-identical uncached output, invalidation
evidence, and acceptance gate.

## Implementation order

RF-GE6 is one gate with ten reviewable build pieces:

1. Freeze primitives, both limit profiles, the exact 18-row work table, errors,
   16 new contract schemas, accepted-contract
   dependency pins, and the separate
   contract catalog.
2. Freeze the 22-rule grammar, binding profile, three audience contexts, and graph
   validator.
3. Author and golden-review the six world kits and six review receipts.
4. Implement explicit audience source projection and source-closure checks.
5. Implement stable anchors and the internal placement plan without a forward
   reference to any product or receipt.
6. Compile every static product and owner-only Operations evidence row, then
   unsigned spatial-layout evidence, relocation receipts, retention decisions,
   the final placement index, accessibility closure, and district assembly in
   that acyclic order.
7. Compile dependency closure, then the 72-field inert manifest, then the
   manifest-bound disclosure receipt; add public-noninterference and
   authority-unevaluated refinement-isolation evidence without adding either to
   the manifest dependency graph.
8. Implement deterministic compile, independent recompile verification, and
   the sealed V6 trust pack.
9. Add 48 browser cases, 22 independent Python vector groups, static closure,
   bundle, and full frozen regressions.
10. Create the additive version-2 freeze ledger, update documentation and
    session memory, and request a separate acceptance decision.

Each piece is add-only. If any piece fails, remove or quarantine only the new
RF-GE6 candidate files and leave every accepted earlier gate untouched. No
failure path rewrites a document, registry, active root, or published artifact.

## RF-GE6 completion definition

RF-GE6 is complete only when all 16 new schemas, every accepted-contract pin,
22 rules, 22 derived bindings per audience, six kits,
six review receipts, three audience candidates, static products, unsigned
layout evidence, coordinate receipts, closure proofs, manifest-bound disclosure
proofs, explicit public-noninterference and refinement-isolation evidence, and
deterministic receipts exist;
the 48-case browser gate and 22-group Python oracle pass; the isolated and
normal bundles close with zero skips; every frozen earlier gate remains green;
and the additive ledger pins the final bytes.

Even then, the result remains inert. RF-GE7 may consume verified RF-GE6
evidence for data-only Storylet Algebra lowering and emit a separate
`GenesisStoryletExtensionManifestV1` that references the RF-GE6 manifest by its
ID/digest pair. The RF-GE6 72-field manifest never references that sidecar, so
the dependency remains one-way and acyclic. RF-GE8 may later bind both manifests
into separately reviewed publication, signed `RealmSpatialLayoutReceipt`, and
rollback offers. Neither later gate may infer execution, authority, or runtime
activation from RF-GE6 or RF-GE7.

## See also

- [RealmForge Genesis Ecology](realmforge-genesis-ecology.md)
- [Genesis Ecology whole-stack architecture](../concepts/genesis-ecology.md)
- [Genesis Ecology WebGPU OS plan](genesis-ecology-os-plan.md)
- [Virtual Realm World Districts and Facilities](virtual-realm/world-districts.md)
- [Virtual Realm RealmForge Bake Pipeline](virtual-realm/realmforge-pipeline.md)
- [Virtual Realm Certification Plan](virtual-realm/certification-plan.md)
