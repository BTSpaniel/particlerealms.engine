---
title: Virtual Realm Certification Plan
description: Deterministic bake, observation ingress, privacy, rendering, grounded traversal, local Cityform operations, Storylet, SecureMesh, bridge, recovery, accessibility, and architecture gates.
audience: QA engineers, security reviewers, rendering developers, and project leads
updated: 2026-09-03
status: M0-M1C product baseline accepted; M2A and the admission-only M2B slice accepted, but integrated M2 remains underway and unaccepted; M3A and M3B remain executable blueprints; RF-GE0-RF-GE5 accepted as inert authoring evidence; RF-GE6 planned
---

# Virtual Realm Certification Plan

The Virtual Realm ships only after its authored bakes, live projections, Code Matter, Storylets, public shells, SecureMesh station, docking protocol, rendering, recovery, and accessibility pass evidence-backed gates.

## Existing test foundations

The plan can extend these repository harnesses:

- Fixed-step browser loop: `tests/common/TestLoop.js`
- Shared canvas and fatal-error surface: `tests/common/TestPage.js`
- WebGPU vertical-slice setup: `tests/phase1_webgpu/main.js`
- Render, material, bloom, particle, and GPU-tile compile smoke pages under `tests/`
- Shared GPU validation and real pixel readback: `tests/morphfield/morphfield.test.js`
- Numeric visual parity: `tests/car-drive-visual-parity.html`
- Browser width containment runner: `tests/browser-extension-popup-responsive.test.js`
- Three-peer WebRTC regression: `tests/network/collab-core-three-peer-regression.js`
- Deterministic negotiation and reconnect tests: `tests/network/collab-targeted-negotiation-state.test.js`
- Realm Network browser runner: `tests/network/run_realm_browser_tests.py`
- RealmForge reconstruction tests under `tests/realmforge/`
- Isolated Storylet and adversarial harness: `webgpu-os/kernel/storylets/StoryletTestRunner.js`
- M0 browser contract runner: `tests/network/realm/virtual-realm-m0.test.html` and `tests/network/realm/virtual-realm-m0.test.js`
- M0 real-Engine clean-room runner: `tests/network/realm/virtual-realm-m0-engine-foundations.test.html` and `tests/network/realm/virtual-realm-m0-engine-foundations.test.js`
- M0 exact signer-set runner: `tests/network/realm/virtual-realm-m0-signer-completion.test.html` and `tests/network/realm/virtual-realm-m0-signer-completion.test.js`
- M0 owner-local operations, minimap, camera-bound, authority, and connected-exclusion runner: `tests/network/realm/virtual-realm-m0-local-operator-view.test.html` and `tests/network/realm/virtual-realm-m0-local-operator-view.test.js`
- M0 frozen cross-client vectors: `tests/network/realm/virtual-realm-m0-vectors-v1.json`
- Independent M0 Python verifier: `python -m pytest tests/network/test_virtual_realm_m0_vectors.py -q`

The M0 Python file defines pytest tests and has no direct-run entry point.
Running `python tests/network/test_virtual_realm_m0_vectors.py` executes zero
tests and is not evidence. The verified invocation above currently reports six
passes.

The repository does not yet have a complete final-frame screenshot or perceptual-diff system, a 3D viewport/DPR matrix, automated full device recovery, or Virtual Realm public/private noninterference testing. These remain required work.

## Contract gates

| Gate | Required proof |
| --- | --- |
| `VR-CONTRACT-001` | Every V1 fixture canonicalizes to identical bytes and digests across supported clients |
| `VR-CONTRACT-002` | Exact-key parsers reject unknown fields, duplicate keys, malformed Unicode, unsafe numbers, excessive depth, excessive counts, and oversized payloads before expensive allocation |
| `VR-CONTRACT-003` | Proposals, authority receipts, authoritative observations, deltas, and presentation commands remain distinct record families |
| `VR-CONTRACT-004` | Unknown major versions, forbidden downgrades, stale revisions, expired envelopes, replayed nonces, and stale capability or bridge epochs fail closed |
| `VR-CONTRACT-005` | Public, private, refinement, rendezvous, bridge, and replay ID namespaces cannot be joined without an authorized local mapping |
| `VR-CONTRACT-006` | Contract errors expose bounded reason codes and opaque IDs without echoing protected input |
| `VR-CONTRACT-007` | Synthetic decoy allow and hard-deny trees prove canonical, symlink-safe, pre-enumeration denial before enumerate, stat, open, hash, watch, preview, or retry; no denied name enters logs and the real excluded application is never touched as a test fixture |
| `VR-CONTRACT-008` | Frozen content-address vectors exclude self IDs, self digests, signatures, and transport envelopes; resource references form one acyclic precomputed DAG and self or transitive cycles fail before publication |
| `VR-CONTRACT-009` | Frozen signature-envelope vectors match the exact domain, length prefixes, format, major version, publisher, audience, policy, issue, expiry, nonce, and content digest; an envelope is computed after content and never grants authority |

## Playground clean-room gates

| Gate | Milestone | Required proof |
| --- | --- | --- |
| `VR-CLEAN-001` | M0 and every later milestone | An allow-listed static import scan proves production and release fixtures contain no import, dynamic import, URL resolution, worker, shader include, or asset reference into `tests/playground/**` |
| `VR-CLEAN-002` | M2 and M7 | Shipping bundle and runtime-resource inspection finds no Playground demo WGSL, DOM/CSS, panel text, demo identifier, camera choreography, orbit/director control, authored graph topology, botanical witness scene, or animation constants |
| `VR-CLEAN-003` | M2 | `RealmEngineAdapter` accepts only the explicitly injected Engine namespace; tests with poisoned `window.PE`, loader promises, asset-base globals, raw module paths, and service locators cannot change resolution or behavior |
| `VR-CLEAN-004` | M2 | Missing export, incompatible version, invalid rasterizer mode, missing source bridge, registration failure, and incompatible decision fail closed as explicit unavailable presentation; no native or synthetic fallback claims State-First or live evidence |
| `VR-CLEAN-005` | M2 to M7 | Cancellation before and after every await, supersession, stale generation, stale authority epoch, partial initialization, registration failure, detach failure, double dispose, device loss, and restart produce no late mutation, leaked listener, pointer lock, subscription, source, reservation, or GPU allocation |
| `VR-CLEAN-006` | M3 | Permuted concurrent observations remain causally incomparable without explicit parents; frame order, GPU order, source arrival order, locale, and wall time cannot create a causal edge or universal clock |
| `VR-CLEAN-007` | M3 to M7 | A proposal, selected projection, belief, similarity result, rejected witness, historical record, Storylet, State-First representation decision, or rendered frame cannot consume exclusive state, mint or widen capability, commit a branch, or claim terminal success |
| `VR-CLEAN-008` | M3 to M4 | Selecting and rendering a branch leaves canonical state unchanged; exactly one valid authority commit can advance it; idempotent retry preserves the semantic receipt; conflicting consumption fails; rejected history remains non-authoritative |
| `VR-CLEAN-009` | M4 | Public historical-witness noninterference changes owner-private candidate facts, count, order, topology, timing, identity, eligibility, selection, and receipt material while public output remains byte-identical under identical declared public input |
| `VR-CLEAN-010` | M2 to M7 | State-First representation changes can alter presentation metadata only; they cannot create, remove, reparent, disclose, authorize, collide, navigate, or semantically mutate an entity, bake, observation, or delta |
| `VR-CLEAN-011` | M1 | Every Root Algebra optimization records frozen proof obligations, bounds, law report, counterexamples, versions, numeric policy, baseline digest, immutable-plan digest, exact CPU parity, and compatible WGSL parity; every failure executes the mandatory baseline compiler and emits no optimized kernel |
| `VR-CLEAN-012` | M1 to M7 | Root Algebra outputs cannot enter action authority, disclosure classification, hidden-topology discovery, CSE branch choice, Storylet eligibility, security enforcement, or post-publication bake mutation |
| `VR-CLEAN-013` | M2 and M7 | Exactly two independently authored modes exist: grounded first-person traversal and the bounded owner-private local Operations View. No Playground camera expression, orbit, director, detached observatory, analytic graph navigation, free camera, third-person Traveler, or connected-Cityform overview enters release code or resources |
| `VR-CLEAN-014` | M0 and M7 | The audited-source ledger cites exactly the 15 allow-listed Playground files plus `engine/state/index.js`, assigns each an API/invariant/preview/deferred disposition, and preserves the existing excluded-application assertion without using that application as a source or fixture |

## Bake and dependency gates

| Gate | Required proof |
| --- | --- |
| `VR-BAKE-001` | One canonical RealmForge document compiled twice produces byte-identical manifests and resource digests |
| `VR-BAKE-002` | Every reference resolves through an exact sorted dependency closure |
| `VR-BAKE-003` | Authoring preview and runtime match declared color, depth, object-ID, anchor, and collision tolerances |
| `VR-BAKE-004` | Compiler, adapter, primitive, material, numeric, Storylet, and renderer versions bind the bake root |
| `VR-BAKE-005` | Failed publication preserves the prior verified root |
| `VR-BAKE-006` | Canonical topology fixtures produce identical Root Spine, territory, parcel, reserved-growth, HLOD, route, anchor, collision, navigation, and streaming digests |
| `VR-BAKE-007` | Insert, rename, move, removal, mount, cycle, cross-link, overflow, and huge-tree fixtures preserve every anchor outside the smallest required deterministic repack region |
| `VR-BAKE-008` | Required route, junction, grade separation, building, rail, conduit, socket, collision, and navigation clearances either pass exactly or fail compilation with an omission or rejection receipt |
| `VR-BAKE-009` | Private, public, and refinement jobs run from independent source projections and ID namespaces; private coordinates, weights, depth, routes, caches, and relocations cannot affect public or refinement layout |

## M2A application and lifecycle gates

| Gate | Required proof |
| --- | --- |
| `VR-M2A-001` | `index.js` import performs zero DOM, listener, process, surface, storage, network, GPU, audio, timer, or global registration work |
| `VR-M2A-002` | The separate runtime catalog initializes through the existing registry, reaches its locked 11-definition target without stubs, and never changes the 109-definition catalog or its order |
| `VR-M2A-003` | Missing, extra, wrong-version, inherited, accessor, symbol, mutable, or malformed dependency fields fail before acquisition |
| `VR-M2A-004` | Broad kernel/GPU/storage/network managers and ambient globals are rejected as dependencies |
| `VR-M2A-005` | Valid start validates the complete closed runtime profile, including exact Engine/adapter/numeric/features/methods/limits and digest, then acquires exactly one process owner and one lifecycle participant; later Engine creation accepts and returns that ID/digest/object as one inseparable binding |
| `VR-M2A-006` | Failed start disposes every acquired child in reverse order and leaves zero owner count |
| `VR-M2A-007` | Stop, double stop, stop during start, and restart use a separate live teardown signal; the post-pin no-await liveness check rejects retired, aborted, switched, released, or noncommitting work before visibility; shutdown retires the exact durable generation, resolves staged/candidate entries by preparation identity first, then snapshots only current, handoff-displaced-retained, and superseded bundles from the bounded predecessor-owner ledger, closes current or displaced visibility through its exact pointer branch, drains every disposal entry through exact fence/resource/child proof, and retires every owned pin journal/root before owner release; neither shutdown, ordinary same-owner replacement, nor claim-authorized cross-session displacement leaks late mutation, an old active gate, owned child, foreign-ledger transfer, or unresolved pin |
| `VR-M2A-008` | The OS lifecycle authority allocates a durable strictly increasing operator/app generation; operator switch or restart rejects every old asynchronous completion without reusing a generation |
| `VR-M2A-009` | A migration-required or unavailable head causes zero Engine, ECS, GPU, audio, input, or frame acquisition |
| `VR-M2A-010` | After accepted admission, handoff record/tombstone authority is stat/read under the exact 65,536-byte profile cap, returns a record only after exact matching active-root/manager-journal recovery plus mandatory checkpoint binding and complete protected graph-edge verification, rejects unbound or caller-authored restoration state, maps unavailable or closed adapter results through frozen reason precedence and monotonic generation lineage, and yields only the closed internal accepted/absent/ignored observation; it never enters public status, resets on clear, or restores live handles |
| `VR-M2A-011` | App discovery uses the normal manifest/factory path and registers one singleton surface intent |
| `VR-M2A-012` | Production modules contain no Playground import/probe and no First Shard dependency |
| `VR-M2A-013` | Diagnostics are bounded and contain no account ID, path, source, evidence payload, signature bytes, key, or token |
| `VR-M2A-014` | M0 39/39, Engine foundations 6/6, local operator 10/10, signer completion 6/6, independent Python 6/6, M1A 15/15, M1B 21/21, and M1C 35/35 remain passing with zero skips |

These rows are byte-for-byte owned by the detailed
[M2A runtime-composition plan](m2a-runtime-composition.md). Skipped cases do not
satisfy M2A.

## M1C-to-M2 runtime-admission gates

| Gate | Required proof |
| --- | --- |
| `VR-ADMIT-001` | Full M2 admits exactly the 17-key owner-private M1C package format at version 2; legacy v1 may be diagnostic only, while public, refinement, mixed, unknown, missing, and future shapes fail before allocation |
| `VR-ADMIT-002` | The exact 71-field `RealmPrivateBakeAdmissionIndexV1` binds the operator partition, versioned publication head, complete package artifact, chunked resource/evidence/signature inventory roots, policies, limits, receipts, Storylet/station evidence, verifier/runtime/admission profiles, and its own recomputed digest |
| `VR-ADMIT-003` | A process restart first matches the index-bound M1 scope/root/generation/storage SHA and current admission policy, then reconstructs byte-identical canonical package bytes, independently reproduces its payload blob ID and RealmForge semantic hash, and verifies the same manifest, closure, Storylet catalog, station-kit, and evidence digests without importing RealmForge or reading authoring source |
| `VR-ADMIT-004` | A manifest-only private root produces an explicit migration-required result and zero writes, allocations, ECS entities, GPU objects, audio sources, listeners, pointer locks, or Operations state |
| `VR-ADMIT-005` | Immutable payload bytes are addressed by strong blob ID; semantic resource IDs, Realm content IDs, RealmForge hashes, physical file SHAs, and logical keys retain distinct roles and cannot alias replacement bytes |
| `VR-ADMIT-006` | The four-kind evidence table and immutable evidence policy authenticate provisioner/reviewer authority for every Realm-scoped station/Storylet tuple; the six-row signature table plus five-role trust map yields exactly four or five envelopes and verifies preimage, publisher, audience, lifetime, active Ed25519 SPKI fingerprint, and current Realm trust before admission |
| `VR-ADMIT-007` | M1 publication-root CAS, M2 durable-admission-head CAS, trusted activation-clock high-water CAS, and in-memory runtime-bundle activation have separate generations and receipts; final activation reasserts current admission/evidence/trust/signature/profile closure plus the exact canonical inactive-or-active CSE predecessor, safe prepared empty-outbox commit receipt/digest, separate acyclic expected swap-receipt digest, and next active-record digest under the one required writer fence, readbacks exact durable pin authorization, then makes synchronous bound liveness and immediate-time decisions the first no-await phase before invoking only CSE step 8 and binding its actual swap receipt into live visibility; either denial performs zero visibility mutation and retires the candidate pin, while exact teardown-signal abort/staged-close/terminal/stale-handle receipts stay bounded, committing recovery cannot masquerade as a prepared abort, hostile post-step-8 mismatch quarantines both gate sets without reporting success, and verified success either supersedes an old same-owner bundle through exact gate readback and that owner's disposal ledger or claim-displaces an exact cross-session predecessor while retaining its child/resources/pin under the predecessor owner, so success, failure, conflict, expiry, rollback, operator/lifecycle change, replacement, effect injection, quarantine, or replay in one cannot perform or imply another |
| `VR-ADMIT-008` | Storylet definitions, proposal templates, cues, candidate index, dependency subclosure, and catalog remain byte-identical and inert throughout M2; no scheduler, instance, episode, channel, proposal, action, or presentation is created |
| `VR-ADMIT-009` | The runtime receives the frozen verified package through a narrow port; it receives no RealmForge compiler/provider, evidence-store handle, signing key, generic storage manager, or raw kernel service |
| `VR-ADMIT-010` | Before an authority's dispatch marker, failure preserves that authority; after M1/M2/root dispatch, only exact predecessor/proposal bytes classify outcome. Fixed proposal controls prevent unbounded per-operation blobs; invalid post-dispatch receipts are outcome-unknown, never rejection; no storage outcome alone changes the visible runtime bundle |
| `VR-ADMIT-011` | The trusted service generates operation identity; maintenance protects immutable staging through exact readback of the pending, terminal-audit, intent, proposal, dispatch, retry, and result records in one fixed slot; live writer and recovery recheck controls while holding selection; frozen reason precedence yields one terminal result; prior/current terminal lineage, reclaiming slots, and owner-manager journals bound recovery without blind retry or unbounded history |
| `VR-ADMIT-012` | Kernel-private service roots cannot alias or disclose existence to apps; generic mutation/version/backup restore cannot reach them; kind-bound root payloads, complete checkpoint graph edges, source-lease authorizations, successor-active retirement receipts, Realm-scoped policy/trust generations, and exact SHAs close every continuity and replacement authority interval; bounded root/artifact/evidence directories plus registration/candidate/progress journals and completed-sweep rollover make future collection reconsider changed reachability and abort on every unverified authority; receipts never overstate same-origin coordination |
| `VR-ADMIT-013` | M0 39/39, Engine foundations 6/6, local operator 10/10, signer completion 6/6, independent Python 6/6, M1A 15/15, M1B 21/21, and M1C 35/35 remain passing with zero skips |

The detailed implementation suites are planned, not yet verified: the M2
catalog/index suite targets exactly 25 cases, the M2 runtime-composition suite
targets exactly 30 `M2A-RUNTIME-*` cases alongside the separate 14-gate
`VR-M2A-*` matrix, and the
durable M1C handoff suite targets exactly 32 cases. See
[M2A runtime composition](m2a-runtime-composition.md)
and [M2B private-bake admission](m2b-private-bake-admission.md).

## M2 stable checkpoint and handoff cases

The independent `m2-os-lifecycle-handoff` suite targets exactly 12 passing cases
and zero skips. These rows are owned by
[M2 runtime foundation](m2-runtime-foundation.md#stable-checkpoint-and-handoff-transaction):

| Case | Required assertion |
| --- | --- |
| `M2-HANDOFF-01` | Commit the first static checkpoint only while the trusted checkpoint-source activation-selection lease proves exact current-active/anchor/policy equality through checkpoint-head CAS and normal active-root readback; bind the source authorization and kind payload, and expose the preissued handoff authorization only with the committed result |
| `M2-HANDOFF-02` | Replace a checkpoint under exact predecessor/next-generation lineage while retaining the prior root until the new record and root are active, then issue the exact successor-active retirement receipt; release immediately only when no consumed handoff edge names the prior root, otherwise defer release until exact `releaseEdge()` readback; exact predecessor or source change returns explicit not-committed abandonment rather than an old record |
| `M2-HANDOFF-03` | Commit the first handoff record from a one-field advisory draft with service-injected owner/lifecycle/state fields, service-generated operation/root identity, required single-use checkpoint authorization, exact binding, and complete protected graph edge in the handoff root payload; expose it only after that root is active |
| `M2-HANDOFF-04` | Replace a handoff without a generation reset or interval in which neither old nor new graph root is active |
| `M2-HANDOFF-05` | Clear by writing/readback of the next tombstone, retire/release the named handoff root, then release its checkpoint-retention edge through the exact binding port without deleting or resetting head authority |
| `M2-HANDOFF-06` | Restart preserves strictly increasing checkpoint and handoff generations, exact previous-storage-SHA lineage, and tombstone authority |
| `M2-HANDOFF-07` | Stale write/clear expectations, third values, malformed heads, and uncertain CAS outcomes never advance or fabricate a record |
| `M2-HANDOFF-08` | Crash at every planned/prepared/manager-published/active boundary, including after checkpoint-handoff authorization claim but before head dispatch, resumes only the exact named journal transition; pre-dispatch restoration returns the cell to issued only after exact manager-nonpublication plus abandoned-root readback and never exposes a half-published record |
| `M2-HANDOFF-09` | Manager publication/adoption and terminal cleanup reconcile exact record/root/directory SHAs before slot reuse or collection |
| `M2-HANDOFF-10` | A new session activates its own runtime pin, claims the exact service-only cross-session handoff lease, and completes the guarded visible commit plus old-gate displacement readback before handoff clear or old-session release |
| `M2-HANDOFF-11` | The displaced old session retains its own teardown child, resources, and `handoff-displaced-retained` runtime pin through lifecycle retirement, `handoff-displaced-pointer-preserved` active-handle close, post-frame GPU fence, and exact resource/child disposal, then retires/releases its pin once; it never removes the new pointer or enters the new session's same-generation disposal ledger |
| `M2-HANDOFF-12` | Operator switch, cross-Realm scope, stale admission/profile, missing/forged/reused/mismatched checkpoint authorization or binding, caller-authored restoration fields, a missing protected checkpoint graph edge, and live-handle injection are rejected without disclosure or partial restoration |

The test layout is exactly `m2-os-lifecycle-handoff.test.html`,
`m2-os-lifecycle-handoff.main.js`, and `m2-os-lifecycle-handoff.test.js`. Until
all three exist and emit an immutable zero-skip receipt, these remain planned
certification cases rather than a passing claim.

## Privacy and protected-content gates

| Gate | Required proof |
| --- | --- |
| `VR-PRIV-001` | Different private machines with identical public inputs produce byte-identical public manifests and identical canonical semantic-scene digests; pixel comparisons are regression evidence only inside one frozen reference renderer, browser, driver, device, resolution, DPR, and tolerance profile |
| `VR-PRIV-002` | Public dependency closure cannot reach private, refinement, unlabeled, or forbidden resources |
| `VR-PRIV-003` | Unauthenticated capture contains only documented beacon and public-shell data |
| `VR-PRIV-004` | Seeded secrets never appear in manifests, traces, logs, telemetry, Chronicle, GPU labels, crash reports, or public caches |
| `VR-PRIV-005` | With identical declared public inputs and publication schedule, private filesystem, source, process, topology, and private-activity changes do not alter the dedicated public beacon or shell-publication payload, envelope class, scheduled-send decision, skyline, shell digest, or public Storylet eligibility |
| `VR-PRIV-006` | Protected cleanup removes geometry, collision, navigation, interaction, atlas pages, keys, and accessible caches within bounds |

## Safe-text gates

| Gate | Required proof |
| --- | --- |
| `VR-TEXT-001` | Malformed UTF-8, unpaired surrogates, NUL, disallowed controls, forbidden bidi controls, and purpose-incompatible line breaks fail before DOM, GPU, audio, Chronicle, or network publication |
| `VR-TEXT-002` | NFC normalization, byte limits, grapheme limits, language tags, direction metadata, and canonical text digests match frozen international test vectors |
| `VR-TEXT-003` | HTML, Markdown, CSS, script, URL-like, and prompt-injection strings are never interpreted; DOM uses text-only insertion, the semantic mirror escapes content, and GPU text consumes only validated shaped glyph runs |
| `VR-TEXT-004` | RTL isolation, combining marks, emoji sequences, fallback fonts, missing glyphs, and GPU shaping preserve the validated semantic text without introducing hidden controls or renderer disagreement |
| `VR-TEXT-005` | Mixed-script and visually confusable display names carry policy-bounded spoof metadata while the verified identity badge or fingerprint remains visually and semantically separate from the name |
| `VR-TEXT-006` | City names, station labels, destinations, Traveler names, Storylet captions, announcements, signs, and semantic-mirror strings can enter a remote artifact only through an audience-matching `RealmSafeTextV1` reference in the complete dependency closure |

## Code Matter gates

| Gate | Required proof |
| --- | --- |
| `VR-CODE-001` | Revealed source matches authorized bytes, Unicode, line endings, offsets, and revision |
| `VR-CODE-002` | Sealed public marks never derive from protected bytes |
| `VR-CODE-003` | Structured output exposes only declared token classes and fields |
| `VR-CODE-004` | Expired or revoked leases cannot load or render new chunks |
| `VR-CODE-005` | Atlas eviction and reuse cannot expose another object's glyphs |
| `VR-CODE-006` | Sealed, structured, revealed, proposed, and historical states remain distinguishable without hue alone |
| `VR-CODE-007` | Every readable glyph instance in a code-built 3D object maps to the authorized object revision, byte range, token, line, column, and active reveal lease |
| `VR-CODE-008` | Private revealed-source changes cannot alter a public sealed object's glyph distribution, silhouette, timing, collision, or public scene digest, and cannot alter any Local Operations View/minimap bytes, geometry, labels, timing, picks, accessibility output, or aggregate state |
| `VR-CODE-009` | Concurrent workers, restart, crash, rotation, envelope rewrap, allocator corruption, and recovery never repeat one `(vaultKeyId, keyEpoch, IV)` tuple; uncertain allocator state fails before encryption |
| `VR-CODE-010` | Lost persistent key material yields explicit sealed-key-unavailable state and requires fresh operator-authorized source ingestion; ciphertext is never guessed, silently decrypted, or presented as recovered |

## M3A observation ingress gates

These 22 rows are byte-for-byte owned by
[M3A Observation Ingress](m3a-observation-ingress.md#m3a-certification-gates).
Its five browser pages target exactly 48 `M3A-OBS-*` cases and an immutable
zero-skip receipt. The M3A table certifies safe local ledger admission only; it
does not claim M3B projection, M3C topology activation, M3D Code Matter, M3E
Storylets, Genesis, public presence, or multiplayer.

| Gate | Required proof |
| --- | --- |
| `VR-M3A-001` | The separate import-inert M3A runtime catalog initializes exactly eleven complete definitions through the existing registry and changes no frozen M0-M1C definition, count, or order |
| `VR-M3A-002` | The exact immutable 34-field base profile and exact-schema seven-row source manifest recompute their IDs/digests, enforce every per-source/global record/byte/causal/retention/graph-edge/recovery ceiling, accept exact bounds, and reject plus-one or structural variants before acquisition |
| `VR-M3A-003` | The separate M3A entry accepts exactly two prebound ports without widening M2's 15-key V1; both expose one selection-fenced portable operator/Realm/owner/lifecycle/active-bundle/head/profile/policy/pseudonym-key-authority-and-epoch/catalog/manifest binding built from M2's retained initial operator projection plus current assertions, while kernel-only key and device-recovery observation facets remain internal and one independent M3A extension claim binds process-local work roots without adding an M2 child tuple |
| `VR-M3A-004` | Seven trusted sources own exactly nine existing M0 observation kinds through exact adapter/port/source-schema-version and normalization bindings; raw managers remain kernel-private, safe normalization is irreversible before app/ledger delivery, and later Realm disclosure can only preserve or narrow those bytes |
| `VR-M3A-005` | Atomic source open registers tail capture before freezing snapshot/watermark, exposes exact ready/changed/gap/unavailable/closed unions and retention floor, and closes the snapshot-to-subscription race without partial failure records |
| `VR-M3A-006` | One authority assigns dense nonreused source sequences; the restricted durable operator-partition HMAC authority binds exact derivation bytes, epoch, commitment, restart stability, rotation, kernel-only ledger-segment/checkpoint/recovery-journal reference transitions, historical verification, generation-branded projection handles, atomic handle-issuance/resource-row registration or sealed zero-issued nonissuance, cumulative retired-generation zero-handle/zero-in-flight fences, a reachable seven-row continuation-reason precedence map with a distinct normalization-policy-change retirement reason and immutable record-first terminal-reason latch, an atomic final binding-retirement drain for terminal no-successor roots, exact complete-lineage released/absent-after-restart extension-aggregate evidence, an exact seven-kind bounded safe blocker projection that remains truthful without reference or edge IDs, zero-reference key retirement, permanent non-reactivating tombstones, object-identical work/teardown signal separation, and idempotent non-authorizing projection-close readback; byte-identical duplicates are idempotent, same-tuple byte conflicts quarantine, stale generations or key epochs cannot mutate state, and portable binding-bound cursors remain distinct from live binding and projection-applied cursors |
| `VR-M3A-007` | Gap, overflow, incompatible replacement, and unavailable state preserve the last accepted cursor, issue exact detection evidence, and mark only the affected source stale; dense retained-floor gap arithmetic and first-refused-record overflow arithmetic are exact, and overflow counter evidence is byte-bound to its enclosing binding/source/descriptor/generation/floor; recovery requires byte-identical opening-receipt scope and a reproducible opening-cut digest, then either a consecutive committed append-receipt chain covering exactly that nonempty cut or an exact empty no-record commit before resume |
| `VR-M3A-008` | Explicit causal parents are bounded, known, acyclic, depth-limited, audience/policy compatible, and topologically earlier; observations without parents remain concurrent regardless of arrival, clock, frame, serialization, manifest, or visual order |
| `VR-M3A-009` | Ledger-issued vector-watermark cuts, canonical non-causal tie-breaking, exact count/byte chunking, and durable binding-scoped batch sequence reproduce byte-identical batches for the same sealed generations under duplicate/reordered/delayed-to-consumer/segmented delivery and same-generation, same-pseudonym-key-epoch consumer restart; process-local ingress generation is excluded, while actual source restart advances generation and key rotation advances every generation under a new binding, each reproducing the semantic opening cut and committed output but intentionally producing distinct attempt-local recovery receipt identities |
| `VR-M3A-010` | Batch, cursor vector, batch sequence, segment/head, and append receipt commit together through exact predecessor/proposal CAS; proposed, observed-conflict, and committed head fields are disposition-conditional, proven competitors conflict, uncertain dispatch is recovery-pending, and M3A claims no DynamicStore, ECS, CSE-root, renderer, Storylet, or bake activation |
| `VR-M3A-011` | The boot adapter admits only registered phase/service/lifecycle/reason/metric evidence, never raw logs/errors/stacks/environment/credentials/paths, and never presents readiness before the owning service's terminal observation |
| `VR-M3A-012` | One canonical storage authority assigns identity before fan-out; filesystem/storage observations share that source without duplicate operation accounting, exclude M3A protected namespaces, and expose no raw path/name/content/hash/handle/key/value/plaintext/journal/secret/error or host-disk scope |
| `VR-M3A-013` | Process observations expose only opaque lifecycle and explicit quality-labelled metrics, preserve estimate labels, and contain no command line, arguments, environment, credentials, private UI, handles, source paths, raw manifests, or stacks |
| `VR-M3A-014` | IPC observations expose only opaque endpoints, registered classes/lifecycle, bounded metrics, and safe causal references; no message, transfer, port, callback, token, credential, raw name/label, or reflected error crosses the boundary |
| `VR-M3A-015` | Syscall observations originate at the guarded wrapper and expose only typed lifecycle/correlation, retained authority/result references, epochs, sequences, metrics, and safe reasons; arguments, returns, paths, values, bytes, credentials, keys, handles, commands, stacks, and dispatch authority are absent |
| `VR-M3A-016` | Permission/action-result observations expose only their strict M0 allowlists; tokens, keys, approval material, manifests, predicates, rule graphs, raw audit logs, authority methods, and unverified receipt bytes are absent, and later success requires exact authority plus matching terminal result |
| `VR-M3A-017` | M3A network observations are structurally local-only: peer identity/count, remote presence, addresses/URLs, ICE/SDP, packets/messages, tickets/capabilities/membership, contacts, Travelers, Cityforms, station occupants, and remote Operations data are unrepresentable |
| `VR-M3A-018` | Immutable safe observations live in bounded hash-linked segments; append, detection, opening, recovered, checkpoint, and compaction receipts use separate exact conditional schemas; the exact compaction operation owns deterministic oldest-excess-prefix selection, all terminal/uncertain/no-op/invalid/unavailable results, and cancellation boundaries; each proposal proves one nonempty unique chain-ordered contiguous segment/batch interval with exact predecessor/successor boundaries, derives three retained-root digests from the authorizing checkpoint's canonical causal/authority/recovery edge classes, retains data and epoch references on every unresolved, blocked, conflicting, aborted, or uncertain outcome, and during a current binding releases segment epoch references only from a committed receipt while the separate complete-set drain is restricted to a proven retired binding |
| `VR-M3A-019` | A separate protected M3A checkpoint binds exact current M2 equality, pseudonym-key authority/epoch/commitment, seven exact cursor slots, ledger head, lineage, and a closed ordered/capped/self-digested complete M3-owned edge set verified through exact target resolution; it creates no M2 retention edge, never widens or treats M2 checkpoint/handoff V1 or `logicalCursorId` as M3 restore authority, and restores no live object |
| `VR-M3A-020` | Start/stop/failure/restart/operator-switch/M2-replacement/device-loss paths use one capped independent M3A extension child, object-identical work/teardown signals, atomic projection issuance plus resource-row registration or exact sealed nonissuance, work abort and projection-call settlement before exact idempotent identity-projection close readback for a live acquired generation, a cumulative zero-handle/zero-in-flight projection fence only after owner-generation retirement and required beside a later same-binding release when an earlier generation crashed, reverse disposal, callback quiescence, paired exact snapshots over the live close cohort after prior normal releases settle that preserve each row's `(resourceKind, resourceOrdinal, resourceBindingDigest)` while changing `owned` to `released` and independently recomputing unequal state-bound row digests, exact process-local aggregate-close evidence and single release, protected released-or-absent-after-restart aggregate terminal evidence that binds current close/nonissuance plus every required prior fence or the sole absent-after-restart fence before binding retirement, record-first retry after terminal-reason drift, no M2 child mutation, no generation ABA, bounded CPU intake, the closed recovery-observation union and accepted recovery-receipt evidence before presentation resume, and no post-release mutation |
| `VR-M3A-021` | Per-source/global rings expose ACK/floor/occupancy, never silently lose protected events, use only the three fixed post-admission metric coalescing rules with subset-or-equal groups and one-group-per-observation membership, keep diagnostics bounded/redacted, preserve flat import/clean-room boundaries, and leave the static M2 city usable when M3A is disabled |
| `VR-M3A-022` | The exact 48-case browser ledger and independent hostile vectors pass with zero skips while every accepted M0-M2, M1A-M1C, Engine, signer, local-operator, and Python regression remains green |

## M3B disclosure and dynamic projection gates

The canonical byte-for-byte owner of these 20 rows is
[M3B Disclosure and Dynamic Projection](m3b-disclosure-projection.md#m3b-certification-gates).
Every canonical update must be copied here verbatim; exact row equality is a
certification invariant.
Its five browser pages target exactly 48 `M3B-PROJ-*` cases and an immutable
zero-skip receipt. M2 is underway with M2A and the admission-only M2B slice
accepted independently; this is not integrated M2 acceptance. M3B remains plan-only until accepted
integrated M2 and accepted implemented M3A exist and the separate M3
projection-transaction capability passes M3B-00. This table certifies the
isolated derived-state
slice only; it does not certify rendering, topology transition, Code Matter,
Storylets, Genesis, public state, SecureMesh presence, bridges, or multiplayer.

| Gate | Required proof |
| --- | --- |
| `VR-M3B-001` | The separate import-inert M3B catalog initializes exactly 16 complete definitions through 18 modules and changes no frozen M0-M1C, planned M2, or planned M3A definition, count, order, or registry behavior |
| `VR-M3B-002` | The exact immutable 57-field base profile recomputes its ID/digest, enforces all 47 numeric ceilings including exactly one maintenance outcome per cut plus the capability-derived 262151-entry current-state-read and 201326592-byte complete-base non-closure ceilings, the 347137 conservative independent-ceiling work sum without claiming simultaneous attainability, global work formula, retained-root aggregate rule, and one pool shared by the 24/18/18-field application, recovery, and selector-retirement journals; the transaction capability withholds an inside-quota three-entry/1,048,576-byte stop reserve and caps ordinary occupancy/reservations at 61 entries/15,728,640 bytes, accepts every independent exact bound including maximum teardown after maximum ordinary occupancy, and rejects plus-one, combined-overflow, reserve borrowing, double-charged embedded bytes, or structural variants before candidate allocation |
| `VR-M3B-003` | The exact ten-field manifest embeds one 16-field recipe matrix containing 53 ordered event rows, 130 primary slots with operation totals 12/14/15/11/25/53, 16 descriptor roles with the exact storage/process versus IPC/syscall/network traffic-role split, and one separate witness row; all row/count/aggregate/matrix/manifest digests recompute, nine ten-field projector rows preserve eight primary owners plus one zero-owner witness, no executable callback or new catalog definition is introduced, and the disclosure/semantic-axis policies retain their exact closed rules |
| `VR-M3B-004` | The separate M3B entry accepts exactly three prebound ports; each exact ten-field descriptor matches its own code-shipped port/method/result-domain bytes while only the 53-field binding pairs are mutually byte-identical; every non-descriptor call uses the exact eight-key method/request-bound result envelope and closed payload union; the 14-field catalog receipt binds one embedded 17-field 50/50/78/78 descriptor pack, compiled 12-field three-import/50-domain/78-carrier registry, 87-seed/111-variant/111-direct-edge source expansion, and 108-source/137-reference-row alias graph whose JavaScript/JSON vectors, selector/condition arities, scoped authority-query paths, two command producer variants, appended command alias, all transition-base triples, hash-derived edge IDs, bytes rules, owners, and resolvers recompute independently; unchanged top-level source/reference counts cannot preserve stale nested counts or hash pins; canonical head-descriptor/head-read bytes replace undefined selector-descriptor bytes; the separate 14-field presentation/authority/device fence vocabulary is not logical identity; M2's 15-key and M3A's two-key objects remain unchanged; and no raw continuation, store, ECS, Engine, CSE, renderer, checkpoint, or authority object crosses the app boundary |
| `VR-M3B-005` | The restricted reader supplies one exact next M3A batch or evidence-complete changed source/tick state, byte-identical safe records, exact closed 11-key variants for seven source slots, nested source-generation extraction, 13-field versioned source-state with the closed four-entry M3A evidence-kind/format/owner/disposition map and mapped tick authority, plus 11-field retained-head/floor state and complete bounded escrow-manifest bytes/read receipt; genesis requires empty M3B head plus request sequence 0 and verified retained M3A batch 1, only unchanged idle creates no artifact, reassertion fences stale work, and close releases only unadopted escrow without M3A mutation or ACK authority |
| `VR-M3B-006` | Before disclosure, bounded recorded-authority resolution consumes every structurally valid authority-domain observation in the frozen batch exactly once, selects only the exact kind-owned authority-reference field path, resolves the copied receipt ID to canonical bytes/digest, and returns complete root-owned receipt/signature escrow; disclosure then gives every valid input exactly one `included` or policy-valid `omitted` decision; inclusion preserves M3A identity/digest/bytes, omission has one closed reason/no payload, structural/audience/policy/binding mismatches reject the cut, current authority remains fence-only, and no selection cycle, silent drop, free digest, field substitution, or same-ID rewrite is possible |
| `VR-M3B-007` | Every projector applies the exact semantic-axis transition policy and preserves or downgrades provenance, evidence, availability, freshness, temporal state, and assertion; roots bind recorded-time authority only, while the fence bootstraps one exact complete 13-field current-authority snapshot variant capped for every accumulated gate dependency, synchronously invalidates before revoke/epoch/expiry wake, and lets the trusted adapter only preserve or close a gate, never create truth, capability, authority, or success |
| `VR-M3B-008` | Eight primary projectors exhaustively own the 53 admitted discriminator recipes and 130 primary slots; action-result precedes permission, authenticated network is inadmissible, IPC/network lifecycle strings pass only their closed total mappings, syscall terminal routes close without inventing revocation, traffic roles close exactly over storage/process versus IPC/syscall/network, each observation emits only its exact slots and at most seven primary Deltas, and the separate nonrecursive witness consumes one complete accepted historical primary outcome, including zero output, and emits at most one reused-command audit-only presentation Delta without creating or rewriting a command or affecting current state, ECS, picking, or live State-First |
| `VR-M3B-009` | M3B preserves the frozen M0 `RealmDeltaV1` identity and binds M3 context only in outcomes/batch/root; candidate subject/anchor and stable ID are frozen before projector execution and must match emitted identity; payload identities, the one adapted presentation-command content contract, zero expiry for nontraffic primary Deltas, saturating cut-tick-plus-one expiry for current traffic Deltas, exact M3A tick evidence, per-observation metric canonicalization, operation counts, dirty keys, structural evidence, and global ordering reproduce byte-identically for an identical frozen cut and prior-state view; same-key current output forms one canonical chain over exact `empty`, `retained-entry`, and `in-batch-candidate` transition bases independently rebuilt by app and trusted prepare, historical-primary work uses only independent read-only bases from the original prior bundle and cannot affect that chain, every Delta/outcome remains counted and protected, only the last current candidate becomes the store entry, the dirty key occurs once, and conflicting or illegal chains reject the batch |
| `VR-M3B-010` | Static resolution accepts only the included subject union and may return complete or admissible partial-missing evidence for any kind; a missing nonfilesystem singleton yields only zero-output, filesystem missing uses its exact structural matrix, and every emitted output has one unambiguous returned binding/anchor/role closure; every base-M3B IPC/syscall/network route is non-traversable; dynamic presentation commands resolve through the batch command pairs, pure/trusted compiler equality, and protected closure rather than becoming static records or M2 lease targets; the closure freezes an exact M2 lease-target set without claiming a lease, trusted prepare acquires/read-backs the covering nonexpiring service-only lease before selection, and no path creates an anchor, geometry, road, collision, navigation corridor, HLOD, static ID, or bake mutation |
| `VR-M3B-011` | Exactly three 28-field durable cut kinds exist: one observation-batch cut advances one projection batch and the independent M3A cursor once, while valid source-state/expiry maintenance advances no M3A batch cursor and only fails closed; only current traffic recipes derive finite boundaries from their exact observation pair and saturating cut-tick-plus-one rule, and each new traffic observation may renew only to its exact candidate tick while merged contributors use the least nonzero tick; expiry requires an exact service-issued due receipt grounded exclusively in M3A-owned durable tick evidence, selects the least boundary above the prior frontier and at/below the proven tick, advances the frontier, and never repeats it; zero-delta batches advance exact evidence, duplicates are idempotent, conflicts quarantine, and gaps/out-of-order/invalid-genesis input preserve the prior root/cursor |
| `VR-M3B-012` | The neutral shared semantic kernel is byte-identical in app and trusted prepare; stateful recipe selection consumes the verified empty/current prior-state view through independently reconstructed reduction-class-partitioned service-local transition bases, current same-key chains apply sequentially but materialize only their final entry, historical work never consumes/produces an in-batch base or influences current state, count-only and final reducers reproduce all 15 work components exactly, reducer and candidate-builder ownership stays separate, six channels and current/historical keys remain isolated, and every failure leaves active state unchanged |
| `VR-M3B-013` | The complete resulting ECS overlay uses scope-independent stored-overlay comparison, active and Transform-only tombstone rows, the total stable-ID-sorted create/update/deactivate/remove mapping, exact dirty/source-pair projections and persistent ABA versions, literal component schema V1, empty remove arrays, one dynamic archetype, pre-projector Realm/binding/subject/anchor-scoped stable IDs, exhaustive all-field Delta-to-entry lowering, disabled durable interaction, closed channel precedence, selected shipped descriptor ID/content pair, exact Engine `Renderable` values, baked-anchor-equal `Transform`, zero per-entity operations for source-health/expiry-only masks, and no static/live-handle mutation; the matching State-First record is one flat stable-ID-sorted semantic-source array with dense order and exact dirty-ID projection whose profile-bound accepted codec V1 derives position, binding-authored bounds/importance, and existing dirty bits, while bounded dependency rows preserve every merged channel/source-generation/expiry contributor in global order and no representation, visibility, decision, renderer, GPU, caller bit, callback, or authority field enters |
| `VR-M3B-014` | The exact 42-field intent binds empty/present expected-head variants, candidate closure, deterministic lease-target set, authorized ready-or-recovering fence, and target generations but no unissued lease receipt; trusted prepare adopts both reader/authority escrow and acquires the lease before off-active bundle build; the 24-field application journal, acyclic 11-field terminal evidence, and omission-safe 33-position application-receipt presence/field-row hash preimage enforce one exact receipt plus idempotency/attempt/selector ABA; one durable selector-generation CAS is the sole logical commit; recovering CAS stays hidden; mirror failure closes presentation; and uncertain dispatch reconciles before retry only after durable noncommit proof |
| `VR-M3B-015` | Each 37-field `projection-root` is self-contained and closes exact root-owned input/M3A-retention/recorded-authority/escrow/floor/observation/outcome/store/full-ECS/State-First bytes plus an M2 lease-target set; exactly one current-cut canonical read-call receipt seed reaches its one reader escrow, while every non-current protected M3A batch reached from the cursor or a retained-entry producer context carries exactly one uniquely matching historical observation-batch receipt and its extractor/escrow closure; every presentation command is constructively reached from its 41-field batch pair, exact closure bytes, and admitted ID-only presentation Delta rather than inferred from that Delta alone; historical seeds cannot satisfy current-cut reassertion, pair-only/second-manifest shortcuts and free Delta/command bytes are forbidden, and all carried context is bounded; the selected 27-field bundle binds the identical floor anchor and covering nonexpiring live lease, lineage retention is bounded across every lifecycle owner, M3B creates no checkpoint-link record/M3A write method, and any M3A-owner edge is optional rather than a future retention promise |
| `VR-M3B-016` | Same-binding restart consumes the exact 16-field prior-state package plus canonical 22-field head-read-receipt bytes under one positive selector/root-store generation, joins/verifies the newest root, complete selected bundle, root-owned escrow/floor, covering lease, and durable selector read, and proves exact occurrence/transport accounting before use, including two unchanged floor-anchor positions, no embedded-subtotal double charge, at most 262151 positions, and at most 201326592 non-closure bytes inside the unchanged 536870912-byte read ceiling; it replays only the contiguous M3A tail byte-identically and preserves zero generations; missing/corrupt/torn/over-limit/released-invalid-noncovering-lease/unavailable state activates complete static M2 fallback and never a partial dynamic city; exact-maximum closure bytes remain readable within the larger complete-base ceiling |
| `VR-M3B-017` | Source-state and progress-strict expiry maintenance may only mask, stale, downgrade, detach, deactivate, remove, or clean already ineligible entries and never rewrites or version-bumps an entry merely because its overlay changed; finite expiry exists only for observation-grounded current traffic entries, a fresh traffic observation may renew only to its exact candidate tick, merged contributors use the least nonzero tick, an expiry cut requires durable M3A tick/due evidence and never repeats a frontier, and MAX-tick saturation is immediately masked; current authority is a separate complete fence-only conjunctive mask; and neither path can activate, open, grant, recover, claim completion, rewrite recorded history, create topology, or advance an M3A batch cursor |
| `VR-M3B-018` | Operator/M2/M3A/pseudonym/binding changes use an exact 21-field empty/present transition descriptor and 21/25-field receipt; successor open proves predecessor retirement and requires separate batch-1 genesis; bake/layout divergence hands to M3C; device recovery uses the separate 18-field restart-stable attempt journal with 14-field safe terminal-prefix floor compaction, keeps an exhausted pending operation under the same journal owner with static-fallback evidence and no second operation, commits CPU catch-up only behind a recovering fence, and opens through a 37-field recovery receipt whose omission-safe 33-position hash preimage includes both trailing fallback fields and binds exact terminal/catch-up/selector-read/closed-to-ready evidence; teardown uses a separate 18-field selector-retirement record, exact 21-field absence-capable retirement-readback receipt, 24-field detach receipt with a four-state no-root/with-root ownership matrix, and 21-field quarantine receipt under the shared aggregate quota; their exact receipt hashes, journal-kind operation rows, and dense ten-field adopted-resource inventory/count/digest are constructive; begin-stop freezes trusted inventory and permits exactly one stop-derived retirement operation, blocked close issues no terminal receipt, and stop/double-stop prove one retirement CAS, extension release, candidate settlement including selected root-store adoption, both resource snapshots, ECS/State-First detach, either an internal healthy retained-owner transition or all-or-nothing bounded quarantine with no simultaneous transition receipt, and no ABA/evidence rewrite/post-close mutation |
| `VR-M3B-019` | Ownership stays modular and flat: app peers orchestrate, one neutral import-inert package supplies pure algorithms to app and trusted verifier, trusted/Engine/root-store peers alone resolve/fence/escrow/lease/journal/select/retain, and the three journals remain separate flat peers under one quota; recipe/selection failures collapse only to existing bounded `input-rejected` or `batch-quarantined` diagnostics with integer counts, never descriptor IDs, command bytes, peer fields, or free-form reasons; no M3B peer depends on scanners, renderers, GPU objects, RealmForge execution, remote networking, raw managers, or RF-GE output as live state |
| `VR-M3B-020` | The exact five-page 48-case browser ledger and independent Python vectors pass with zero skips while every then-accepted prerequisite Engine, Virtual Realm, signer, local-operator, and Python regression remains green |

The M3B page owns the exact 57-field/47-ceiling profile, 53-field logical
binding, 16-definition catalog, 14-field catalog receipt, embedded 17-field
50-definition/50-extractor/78-authority-rule/78-predicate reference-descriptor
pack, compiled 12-field three-import/50-domain/78-carrier registry, and sole 21-
field source matrix with exact counts
3/6/9/50/78/87/111/111/108/105/137. It also owns the exact 24-field static
receipt; 21-field maximum authority receipt with 19-own-key recorded and 13-own-
key current-only variants; 16-field recipe matrix with 53 event rows, 130 primary
operation slots, 16 descriptor roles, and one witness; 41-field projection batch
with dynamic command pairs and mandatory closure/ID-only-Delta join, with
command bytes counted through protected closure rather than `deltaByteCount`; witness
command reuse; six-event local-network subset with `authenticated` excluded until
M5; non-traversable base routes; current-traffic cut-tick-plus-one expiry;
sequential `transitionBase`; exhaustive lowering; and conservative 347137 work
sum. The page also owns the three-port unions, schemas, state machines, threat
inventory, and case ledger. Wording or count drift between these tables is a
documentation failure.

## Live-projection gates

| Gate | Required proof |
| --- | --- |
| `VR-LIVE-001` | Base M3A owns exactly its seven sources and nine existing M0 observation kinds; M3B supplies one pure projector per base domain, while Code Matter joins only through the independently gated M3D source/projector and Genesis only through its optional extension catalog |
| `VR-LIVE-002` | One frozen trace reproduces a boot-to-process-to-syscall-to-IPC-to-storage/network first-person route with exact causal observation IDs, source sequences, semantic axes, bake binding, and anchor binding |
| `VR-LIVE-003` | Syscall observations and route deltas never contain arguments, return payloads, paths, values, source bytes, raw handles, capability tokens, credentials, command lines, stack traces, or dispatch authority |
| `VR-LIVE-004` | Boot readiness, syscall completion, IPC delivery, storage completion, and network success appear only after their authoritative terminal observations; missing, denied, stale, failed, or cancelled evidence cannot animate success |
| `VR-LIVE-005` | Filesystem and storage projections share the canonical underlying storage observation source without duplicating one VFS event as two entities or traffic events |
| `VR-LIVE-006` | Snapshot-plus-subscription race, source restart, sequence gap, out-of-order delivery, duplicate observation, staged bake transition, buffer overflow, and reprojection recovery preserve deterministic state or fail visibly closed |

`VR-M3A-*` owns source admission, safe normalization, cursor/ledger/checkpoint,
and recovery. `VR-M3B-*` owns isolated disclosure, deterministic projection,
derived-state application, root, and recovery. `VR-LIVE-001` through
`VR-LIVE-006` certify the later integrated M3A-to-M3B/M3C/M3D projection path;
they do not change either slice's exact 48-case count.

## View and visual gates

| Gate | Required proof |
| --- | --- |
| `VR-VIEW-001` | 1280 x 720 at DPR 1 has correct backing extent and stable composition |
| `VR-VIEW-002` | 1920 x 1080 at DPR 1 and 2 preserves normalized framing and hit targets |
| `VR-VIEW-003` | 2560 x 1440 at DPR 1 and 1.5 preserves skyline and glyph readability |
| `VR-VIEW-004` | 3440 x 1440 has no stretched projection, culling holes, or edge-only interactions |
| `VR-VIEW-005` | Portrait and landscape mobile sizes follow an explicit supported or unsupported contract |
| `VR-VIS-001` | Canonical station color, depth, normal, object-ID, emissive, and disclosure-boundary buffers match baselines |
| `VR-VIS-002` | Every quality tier preserves gameplay silhouettes and object IDs |
| `VR-VIS-003` | SecureMesh idle, discovered, authenticated, active, degraded, revoked, and departed states remain deterministic and distinct |
| `VR-VIS-004` | Bloom, fog, exposure, signs, landmarks, and glyphs meet legibility limits |
| `VR-VIS-005` | Four-sample MSAA and analytic glyph-edge smoothing preserve thin geometry, signs, Code Matter, depth, and object-ID agreement; any one-sample fallback passes its declared quality-tier baseline |

## View-mode and traversal gates

- Grounded first person is the only mode that moves a Traveler through collision, navigation, gates, bridges, Code Matter inspection, multiplayer, or replay.
- The only non-first-person mode is the explicit owner-private Local City Operations View; no orbit, freecam, avatar-follow, third-person Traveler, debug-camera, analytic graph, spectator, or remote-city route exists.
- The controller traverses floors, steps, slopes, doors, gates, bridges, and moving platforms.
- Head clearance and collision resolution prevent geometry penetration.
- Pointer lock enters, releases, and restores focus correctly.
- Every required interaction works with keyboard, mouse, and gamepad.
- Motion comfort mode removes forced movement and preserves task completion.

| Gate | Required proof |
| --- | --- |
| `VR-OPS-001` | Operations entry requires explicit local input, current authenticated owner identity, a record with only `localRealmId` and no foreign/viewed-Realm slot, current authority receipt, positive capability epoch, active private bake, spatial-layout receipt, and policy revision |
| `VR-OPS-002` | Isometric and eagle-eye pitch, altitude, zoom, heading, pan, focus, and loaded cells remain inside policy and local Cityform bounds; changing angle or LOD reveals no new authority or content |
| `VR-OPS-003` | Connected Cityform, PublicRealmShell, remote RealmPose, PresenceSession, RendezvousFrame, bridge, remote Traveler, remote route, destination, resource, object-ID, pick, accessibility, and telemetry records are absent before scene assembly |
| `VR-OPS-004` | Different authenticated, docked, moving, disconnected, and revoked connected-city populations produce byte-identical operator snapshots and minimaps for identical declared local inputs |
| `VR-OPS-005` | Every minimap zone, anchor, route endpoint, landmark, and cell resolves inside the accepted local private-bake lookup; foreign, dangling, duplicate, unsorted, excessive, or unloaded records fail closed |
| `VR-OPS-006` | Select and focus change presentation only. Visibility, alert-threshold, and rebake requests remain powerless until the generic proposal, authority receipt, authoritative observation, and delta chain completes |
| `VR-OPS-007` | Storylets cannot enter, exit, steer, or expand Operations View, join its local snapshot, select a hidden zone, grant authority, or claim a zone result; while the owner has already entered, a separately validated owner-private presentation-only highlight/focus overlay may use an owned reversible handle without widening the projection or dispatching management authority; remote packets, station events, presence, rendezvous, bridges, foreign picks, and minimap clicks remain unable to enter or widen the view |
| `VR-OPS-008` | Exit, authority revocation, owner change, expiry, policy replacement, bake activation, device loss, cancellation at every await, and double disposal release all operations resources once and restore the saved first-person anchor or collision-safe Root Spine fallback |
| `VR-OPS-009` | First-person visor minimap and full Operations View share one accepted local-only map projection and equivalent semantic/accessibility output; owner-private state never enters public shells, shared Chronicle, telemetry, crash reporting, network packets, or in-application capture |
| `VR-OPS-010` | The local SecureMesh Exchange may appear only as local geometry and a content-free boundary-state marker; no remote identity, shell, destination, route beyond the socket, or bridge geometry appears |

## Storylet gates

| Gate | Required proof |
| --- | --- |
| `VR-STORY-001` | Every factual cue references an authorized observation or explicit authored construct class |
| `VR-STORY-002` | Identical definitions, events, seeds, ticks, scope, and epoch produce identical instance IDs and semantic timelines |
| `VR-STORY-003` | Public Storylets pass private-data noninterference |
| `VR-STORY-004` | No Storylet can directly call files, processes, permissions, drivers, SecureMesh, or capability grants |
| `VR-STORY-005` | Operational Storylets wait for authoritative confirmation before success presentation |
| `VR-STORY-006` | Revocation, disconnect, unload, and epoch change cancel affected instances |
| `VR-STORY-007` | Replay disables every action port and performs zero live operations |
| `VR-STORY-008` | Shared clients agree on definition, recipe, participants, epoch, phase, and completion |
| `VR-STORY-009` | Historical, proposed, constructed, estimated, and live presentations remain distinct |
| `VR-STORY-010` | Hostile descriptors, hidden parameters, prompt-injection text, and invalid versions fail closed |
| `VR-STORY-011` | Duplicate IDs, ambiguous `(state, event)` transitions, stale expected revisions, invalid signatures, excessive payload depth, and incomplete dependency closure fail closed |
| `VR-STORY-012` | Scheduler tests cover canonical candidate ordering, priority, concurrency classes, cooldown ticks, deterministic ties, supersession, and bounded work |
| `VR-STORY-013` | Definition, episode state, persistence, trigger evaluation, scheduling, authority, presentation, Chronicle, and telemetry remain separate peers |
| `VR-STORY-014` | Every action-kind Storylet proposal adapts into the one generic `RealmActionProposalV1` path with the same idempotency key, consumes `RealmActionAuthorityReceiptV1`, and correlates exactly one reconciled authoritative result; replay cannot redispatch it |
| `VR-STORY-015` | Capability, presence-session, rendezvous, and bridge epoch changes invalidate every matching pending proposal, shared decision, reservation, pose dependency, and protected presentation before reuse |
| `VR-STORY-016` | Missing or mismatched definition hashes produce a stopped or explicitly migrated replay, never a present-day reroll |
| `VR-STORY-017` | Async failure cannot become semantic success from an earlier generic fired event |
| `VR-STORY-018` | Remote Storylet packages contain no function, script, module, worker, shader, WASM, URL, executable expression, private trigger, or hidden asset reference |
| `VR-STORY-019` | Shared clients derive the same `RealmStoryletInputSnapshotV1` digest from identical canonical facts, watermarks, logical ticks, hysteresis state, participants, policy, and active epochs; wall time, arrival order, locale, GPU values, and private facts cannot alter it |
| `VR-STORY-020` | Frozen logical-clock vectors reject tick regression, skipped or duplicated authority ticks, wrong clock epochs, wrong coordinator terms, and non-canonical hash links |
| `VR-STORY-021` | Frozen PCG-XSH-RR 64/32 vectors match exact unsigned 64-bit state evolution, little-endian seed derivation, XSH-RR output, draw counts, bounded rejection sampling, and semantic-real mapping on every supported client |
| `VR-STORY-022` | Candidate selection, tie-break, phase variation, and decorative randomness use domain-separated substreams; adding or removing draws in one purpose cannot shift another purpose's semantic output |
| `VR-STORY-023` | Coordinator lease expiry pauses or cancels at a safe boundary; mutually signed failover advances one term; partitions and conflicting decisions produce quarantine and split-brain evidence rather than unilateral progress |
| `VR-STORY-024` | Persisted outer instance heads restore pause, interruption, degradation, failed-pivot, repair, channel reservations, pending correlations, and cleanup obligations exactly; cancellation and crash recovery release every owned presentation and reservation through idempotent cleanup |

## Network and bridge gates

| Gate | Required proof |
| --- | --- |
| `VR-NET-001` | The V1 two-Cityform release scenario forms one expected authenticated remote peer and never duplicates either Traveler; a separate three-Cityform infrastructure robustness case verifies the existing mesh without adding group docking to V1 scope |
| `VR-NET-002` | A relay route never presents as direct |
| `VR-NET-003` | Latency, jitter, loss, and backpressure affect bounded presentation but not authority |
| `VR-NET-004` | Disconnect during bridge bake cannot activate a stale recipe |
| `VR-NET-005` | Reconnect requires new authentication, grant, and epoch |
| `VR-NET-006` | Directional grants remain independent |
| `VR-NET-007` | Hidden destinations cannot be enumerated before authority |
| `VR-NET-008` | Version or digest disagreement fails closed to station-only state |
| `VR-NET-009` | Revocation rejects protected traffic before protected presentation remains usable |
| `VR-NET-010` | Maximum-separation camera-relative rebase changes no semantic RealmPose, TravelerPose, collision result, navigation anchor, pick identity, audio relationship, Storylet state, Chronicle record, or bridge digest |
| `VR-NET-011` | A visitor cannot self-assert pose through host collision, navigation, gate, presence, or bridge boundaries; only host-authoritative `TravelerPoseV1` drives remote rendering, picking, and traversal |
| `VR-NET-012` | A DockingOffer cannot replay across identity, direction, gate, transcript, shell, PresenceSession, RendezvousFrame, protocol, compiler, nonce, expiry, or expected-previous-epoch changes and never claims a new active bridge epoch |
| `VR-NET-013` | Grant, recipe, both bridge digests, and BridgeEpoch activation agree on the offer digest, generation-nonce digest, active encounter epochs, directional grants, prospective bridge epoch, policy, and participants before protected traffic opens |
| `VR-NET-014` | Authentication, arrival, RendezvousFrame creation, docking, bridge activation, remote movement, revocation, and departure never inject a connected-Cityform or remote Traveler record into the Local Operations View or minimap |

## Performance gates

| Gate | Required proof |
| --- | --- |
| `VR-PERF-001` | Empty personal city meets approved CPU, GPU, memory, draw, and dispatch budgets |
| `VR-PERF-002` | Dense city and station traffic meet P50, P95, P99, and deadline-miss limits |
| `VR-PERF-003` | Repeated district streaming returns GPU bytes and resource counts to a plateau |
| `VR-PERF-004` | Glyph atlas, HLOD, particle, light, and audio budgets remain bounded |
| `VR-PERF-005` | Network fault simulation cannot create unbounded presentation work |
| `VR-PERF-006` | Storylet candidate and timeline work stays within its logical-tick budget |

## Recovery gates

| Gate | Required proof |
| --- | --- |
| `VR-RES-001` | Forced device loss pauses, rebuilds once, reloads the bake, and preserves camera and authority state |
| `VR-RES-002` | Device loss during arrival creates no duplicate Traveler |
| `VR-RES-003` | Device loss during docking creates no duplicate bridge or Storylet instance |
| `VR-RES-004` | Missing protected content returns to sealed state rather than fabricating it |
| `VR-RES-005` | Failed new bake activation leaves the prior verified bake active |

## Accessibility gates

| Gate | Required proof |
| --- | --- |
| `VR-A11Y-001` | Reduced motion suppresses decorative and forced movement while retaining function |
| `VR-A11Y-002` | High contrast and color-vision matrices preserve authority, danger, route, and Storylet meaning |
| `VR-A11Y-003` | Keyboard and gamepad can reach and cancel all required actions |
| `VR-A11Y-004` | The semantic mirror synchronizes nearby entities, routes, permissions, Storylets, prompts, and errors |
| `VR-A11Y-005` | Captions cover station announcements and semantic audio |
| `VR-A11Y-006` | Pointer-lock release restores predictable focus |

## Architecture gates

- Peer modules do not import concrete peers.
- Only application composition roots construct peers.
- No renderer imports a WebGPU OS driver.
- No OS adapter imports renderer code.
- No Storylet module imports a privileged concrete service.
- No production or release-fixture module imports, dynamically resolves, bundles, or copies a Playground demo, wrapper, shader, UI, camera, loader, or fallback.
- Engine and CSE capabilities enter only through composition-root-injected, version-checked adapters; no Realm peer reads an ambient global or probes a raw module path.
- CSE V2 binds every effect by strong digest, commits against a complete staged
  store bundle, and proves that signer/log/idempotency/outbox exceptions leave
  active roots and heads unchanged.
- ECS runtime handles are validated positive safe integers, persistent identity
  remains separate, entity destruction cleans storage before reuse, structural
  mutation commits at a deterministic barrier, and authoritative system failure
  restores the pre-tick state.
- Persistence restores every registered component and opted-in system state;
  diagnostic snapshots cannot be admitted as durable checkpoints.
- Shared recipe-kernel optimization preserves Particle and RealmForge canonical
  plan bytes, error order, hashes, and last-good behavior.
- Stable semantic object IDs map through generation-safe dense presentation
  slots; neither ECS handles nor GPU slots become persistent identity.
- State-First representation, historical witnesses, belief, similarity, and presentation remain outside authority and canonical-state ownership.
- Local operator contracts and peers are flat, owner-private, and independent of station, SecureMesh, public-shell, rendezvous, bridge, and Traveler peers; only `VirtualRealmEntry` may wire their accepted ports.
- Local Code Matter vault, nonce, tokenizer, line-stream, reveal-lease, and private-atlas peers remain separate; none imports SecureMesh, station, docking, bridge, or public-shell modules in V1.
- Bake dependency closure excludes bake receipts, signature envelopes, activation evidence, and every post-manifest validation or publication record.
- No RealmForge UI or mutable preview handle enters runtime modules.
- No god-object manager or nested runtime ownership tree appears.
- M3A uses a separate exact two-port composition, one selection-fenced portable
  M2 binding projection, one prebound aggregate ingress service, and one
  independent M3A extension child; it never widens M2's 15-key V1 or child tuple
  domain, exposes raw source managers, creates an M2 retention edge, or treats
  M2 checkpoint/handoff V1 as M3 restore authority.
- No Node.js or npm dependency exists.
- Only explicit exclusion assertions may name The First Shard; no source path, test, documentation content, scan result, design, mechanic, or dependency from it appears.

## Genesis Living Digital World gates

Genesis is an optional certification track over the base M2-M7 gates. It uses
a separate contract catalog and a sidecar extension bound to an accepted base
bake. Passing base Virtual Realm V1 does not imply these gates passed; using the
**Living Digital World** label requires every applicable row below.

### Upstream RealmForge evidence is not Virtual Realm acceptance

The `RF-GE*` authoring gates and `VR-GE*` runtime gates are independent
namespaces. RF-GE0 through the bounded inert RF-GE5 gate are complete. The
recorded upstream evidence is:

| Upstream gate | Recorded acceptance evidence | Authority ceiling |
| --- | --- | --- |
| RF-GE2 | Core browser gate 17/17; constructive Factory pack 8/8; RF-GE1A regression 18/18; RF-GE1 regression 15/15; RF-GE0 regression 17/17; independent Python vectors 18/18; isolated bundle 34 modules with zero skipped; final independent audit with no P0, P1, or P2 finding | Four inert records, all-ten-operation deterministic compile/verify, and trust-locked binding verification only; Plans are `not-executed` and grant no execution, persistence, publication, registry mutation, installation, active-head, or runtime authority |
| RF-GE3 | Browser gate 13/13; frozen browser regressions 75/75; independent Python Genesis vectors 25/25; isolated bundle 39 modules with zero skipped; documentation validation 229,750 checks across 2,732 modules; zero missing SPDX annotations; final independent audit found no remaining counterexample | Process-local exact cache, dependency-safe invalidation/eviction, verified Factory/Plan bindings, and deterministic inert package candidates only; no semantic partial compile, cross-audience reuse, evidence collection, persistence, publication, installation, execution, authority, or activation |
| RF-GE4 | Browser gate 25/25; frozen browser regressions 88/88; independent Python oracle 5/5; ten typed authored-program kinds represented by the accepted twelve-record golden corpus; eight deterministic interpreter fragments; sealed 18-descriptor trust pack; exact context and Plan binding; replay, multirate, bounded-state, host-loss, fault, and byte-recompilation verification | Inert authored-program interpretation evidence only; no execution, persistence, publication, package admission, authority, or runtime activation |
| RF-GE5 | Browser gate 29/29; frozen browser regressions 113/113; independent Python oracle 6/6; eleven typed evidence-program records; ten deterministic evidence fragments; sealed 21-descriptor trust pack; exact three-record semantic RF-GE4 closure; exact verified RF-GE4 Plan binding; digest, dependency, provenance, variation-target, participant-ceiling, lineage, audience, and no-authority verification | Inert evidence authoring and verification only; no execution, persistence, publication, identity mint, self-modification, package admission, authority, or runtime activation |

Passing any upstream row contributes only its exact bounded authoring evidence.
It does not pass `VR-GE0`, `VR-GE1`, `VR-GE2`, `VR-GE3`, M2-GE, M3-GE, or M3F,
and it does not make a Foundry object visible or interactive.

| Gate | Required evidence |
| --- | --- |
| `VR-GE0-001` | The Genesis registry initializes separately; the accepted Virtual Realm catalog remains exactly 109 contracts in its original order |
| `VR-GE0-002` | Every Genesis record rejects unknown keys, future versions, cycles, oversized graphs, unsafe numbers, executable content, URLs, live handles, secrets, and authority material |
| `VR-GE1-001` | Identical authored input produces byte-identical six-kit district assembly, extension layout, closure, manifest, and receipts |
| `VR-GE1-002` | Missing, disabled, incompatible, or rejected Genesis extension leaves the accepted base bake and base runtime usable and unchanged |
| `VR-GE1-003` | Static facilities show authored infrastructure only; no light, traffic, role occupancy, reaction, phenotype, or health appears without admitted evidence |
| `VR-GE2-001` | Every live Genesis domain has one source-owning port, pure projector, generation/sequence policy, bounded work, and distinct stale, unknown, denied, and absent handling |
| `VR-GE2-002` | No live Genesis delta creates or mutates stable geometry, collision, navigation, road, district, facility, HLOD, or socket ownership |
| `VR-GE2-003` | Topology-intent denial, stale source, compiler failure, buffer overflow, activation failure, device loss, and authority loss preserve the prior base and extension roots |
| `VR-GE2-FACTORY` | A future runtime admits a Factory Plan for execution only after verifying sealed Factory and Plan binding receipts and deterministically recompiling the exact RF-GE2 source, context, audience, compiler, policy, limit, and trust-pack identities to a byte-identical Plan; an RF-GE3 cache hit or package candidate grants no shortcut. No Foundry lifecycle transition, semantic promotion, ECS commit, publication, installation, or success presentation occurs until separate external execution/test evidence and current authority admit that exact result; every mismatch rejects with zero live side effects |
| `VR-GE2-CODE` | Every readable glyph resolves to exact authorized bytes and a current lease; sealed/public output is private-content independent; revision swap and atlas disposal leak nothing |
| `VR-GE3-STORY` | Storylet Algebra canonicalization, bounded lowering, predicate evaluation, derived-fact receipt, candidate selection, replay, and cleanup are deterministic and powerless |
| `VR-GE3-OPS` | Genesis Operations records are local-only; all remote ecology permutations produce byte-identical snapshots and minimap overlays for identical declared local input |
| `VR-GE4-001` | Private genome, epigenome, homeostasis, lineage, culture, candidates, source, topology, and activity changes leave public Genesis extensions, publication decisions, public Storylets, and semantic scenes identical under identical explicit public input |
| `VR-GE4-002` | Malicious public Genesis packages cannot execute, allocate beyond limits, reference unknown archetypes, cross audiences, or reach private content |
| `VR-GE5-001` | Public ecology/cultural exchange requires signature, attribution, consent, policy, bounded size, expiry, retention, withdrawal, and mutation provenance; receipt never auto-adopts belief |
| `VR-GE5-002` | Public Genesis station exchange works with a PresenceSession and without RendezvousFrame or bridge, while exposing no private ecology |
| `VR-GE6-001` | Both clients derive identical canonical encounter and bridge semantics across coordinate rebase, device tier, packet order, duplicate delivery, and worker scheduling |
| `VR-GE6-002` | Remote factory and role operations remain directional, socket/epoch/capability-bound proposals until a terminal host observation exists |
| `VR-GE6-003` | Revocation rejects protected work and traffic before any protected presentation remains interactive and disposes every owned resource exactly once |
| `VR-GE7-001` | Long-run regulation, reactions, Code Matter streaming, Storylets, shell churn, topology rebakes, docking, rollback, and device loss reach CPU/GPU/memory/resource plateaus |
| `VR-GE7-002` | Checkpoint restore and Chronicle replay reproduce semantic state without repeating live observations, actions, publication, minting, or network effects |
| `VR-GE7-003` | Claim axes, lifecycle states, Code Matter disclosure, roles, homeostasis, culture, and authority remain distinguishable without color and through the semantic mirror |
| `VR-GE7-004` | Release packages, captures, logs, errors, telemetry, pixels, and network traces contain no protected source, private genome, belief space, lineage, hidden eligibility, remote Operations data, keys, or capability tokens |

Gate details and milestone ownership are defined in
[M2 runtime foundation](m2-runtime-foundation.md),
[M3 living city runtime](m3-living-city-runtime.md),
[World districts and facilities](world-districts.md), and
[Cityform encounter runtime](cityform-encounter-runtime.md).

## Release evidence

The release candidate stores:

- Bake and dependency receipts.
- Privacy and secret-sentinel reports.
- Canonical final-frame and buffer baselines.
- CPU and GPU timing distributions.
- Resource and memory plateaus.
- Network and revocation traces.
- Device recovery traces.
- Storylet deterministic-replay evidence.
- Accessibility results.
- Import-boundary and exclusion reports.

## See also

- [Contract catalog](contracts.md)
- [Implementation roadmap](implementation-roadmap.md)
- [Security and privacy](security-privacy.md)
- [Rendering and experience](rendering-experience.md)
- [Storylets](storylets.md)
- [Playground clean-room foundations](playground-clean-room-foundations.md)
- [M2 runtime foundation](m2-runtime-foundation.md)
- [M2A runtime composition](m2a-runtime-composition.md)
- [M2B private-bake admission](m2b-private-bake-admission.md)
- [M3A Observation Ingress](m3a-observation-ingress.md)
- [M3B Disclosure and Dynamic Projection](m3b-disclosure-projection.md)
- [World districts and facilities](world-districts.md)
- [M3 living city runtime](m3-living-city-runtime.md)
- [Cityform encounter runtime](cityform-encounter-runtime.md)
