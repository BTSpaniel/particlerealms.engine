---
title: Virtual Realm World Projection Grammar
description: Semantic claim axes, coverage, stable geography, real-system-to-world mappings, observations, deltas, and interaction rules for The Virtual Realm.
audience: architects, runtime developers, and experience designers
updated: 2026-08-13
status: approved planning baseline
---

# Virtual Realm World Projection Grammar

The Virtual Realm turns authorized system structure and activity into a stable grounded place. Traveler traversal is first person. The authenticated owner may also derive a bounded owner-private Operations View and minimap from the verified local Cityform only. Every factual visual has provenance. Every non-factual visual is visibly identified as an authored construct or decorative effect.

## Physical mapping

| Real system truth | Virtual Realm form |
| --- | --- |
| Root namespace | Root Spine and central transit artery |
| Engine, Editor, Plauna, AGI, and WebGPU OS | Five foundational territories in the shipped Particle Realms city |
| Application | Building or functional complex |
| Active window or surface | Lit room, façade, or active internal surface |
| Directory or package | District or interior complex |
| File, module, or asset | Code Matter structure |
| Kernel service or entry point | Nexus tower |
| Process | Inhabitant, machine, or active construct |
| Parent-child process relation | Operational lineage or connected machinery |
| Import or dependency | Service tunnel or utility conduit |
| IPC, syscall, or event channel | Street, lift, conduit, or guarded intersection |
| Network route | Rail line, bridge, port, or horizon gate |
| SecureMesh | Central railway station and routing exchange |
| Mount | Threshold into another granted territory |
| Capability | Gate, ward, ticket, or checkpoint |
| Storage and cache | Archive, reservoir, or energy store |
| Queue and backpressure | Congestion and freight backlog |
| Throughput | Route capacity and traffic density |
| Latency and jitter | Travel time, pulse spacing, and instability |
| Packet loss or fault | Broken signals, outages, and fractures |
| Test or invariant | Stabilizer, ward, or structural anchor |
| Snapshot or revision | Historical epoch |
| RealmLink | Authenticated inter-Realm route |

IPC means communication within the OS or runtime. `network` means communication crossing a host, peer, origin, or trust boundary. An optional `internet-computer` adapter can represent Internet Computer Protocol later. The runtime never merges these categories merely because both look like transportation.

## Semantic claim tuple

Truth is not one enum. Every observation carries a stable resource ID, source authority, source schema and generation, observation timestamp, disclosure classification, and six orthogonal semantic axes. Projectors bind resulting deltas to the active bake revision and authored anchors. This permits combinations such as observed plus stale, historical plus sealed, or derived plus proposed without discarding meaning.

### Provenance class

| Value | Meaning |
| --- | --- |
| `authored` | RealmForge deliberately created the stable form or rule |
| `observed` | An authoritative OS or network source emitted the fact |
| `derived` | A deterministic projector computed the record from cited authorized input |
| `construct` | An authored guide, decoration, or actor that does not represent a real system entity |

### Evidence quality

| Value | Meaning |
| --- | --- |
| `exact` | Byte-exact or contract-exact source evidence |
| `measured` | Direct bounded measurement with declared units and sampling policy |
| `computed` | Deterministic computation from cited exact or measured input |
| `estimated` | Labeled approximation or browser-level proxy |
| `unknown` | Quality cannot be established for the current audience |
| `not-applicable` | The record is authored presentation and makes no measurement claim |

### Availability state

| Value | Meaning |
| --- | --- |
| `available` | The permitted representation is currently present |
| `sealed` | The object is known, but protected detail is withheld |
| `denied` | Current authority rejects the requested inspection or action |
| `partial` | Coverage, streaming, or reconstruction is incomplete |
| `absent` | No supported source or resource is present |

### Freshness state

| Value | Meaning |
| --- | --- |
| `current` | Evidence remains within its declared freshness window |
| `stale` | A receipt-backed last-known value exists but is no longer fresh |
| `expired` | The evidence or authority lifetime has ended and cannot support a current claim |
| `unknown` | Current freshness cannot be established |

### Temporal mode

| Value | Meaning |
| --- | --- |
| `live` | The record belongs to the current runtime context |
| `historical` | The record belongs to a Chronicle-backed replay |
| `preview` | The record belongs to an explicitly synthetic RealmForge or diagnostic fixture |

### Assertion state

| Value | Meaning |
| --- | --- |
| `confirmed` | The cited authority or receipt supported the claim at its recorded observation time; current freshness is expressed separately |
| `proposed` | An action or route has been requested but no result is claimed |
| `hypothetical` | A clearly marked preview or simulation does not claim live system truth |

Estimated current process CPU and memory data therefore use `observed + estimated + available + current + live + confirmed` because the existing `ProcessTable` metrics use browser-level proxies rather than exact hardware counters (Source: `webgpu-os/kernel/ProcessTable.js`). A protected historical source object can use `observed + exact + sealed + current + historical + confirmed` without contradiction.

## Coverage receipt

Before coverage begins, a private `RealmScanScopeV1` fixes explicit allow-root handles and opaque hard-deny subtree handles. The scanner checks canonical identity, containment, deny ancestry, symlink or reparse targets, and operation permission before every enumeration, stat, content open, hash, watch, preview, and retry. Failure to prove the scope stops access before the source object is touched. Forbidden names and paths never enter Realm logs.

A `RealmCoverageReceipt` states:

- Requested roots and mounts.
- Granted roots and mounts.
- Omitted or denied scopes.
- Scan start and completion times.
- Resource and depth limits.
- Truncation and cancellation state.
- Source revisions or mount generations.
- Adapter versions.
- Whether each metric is exact, measured, computed, estimated, unknown, or not-applicable.

The first release covers WebGPU OS, the Particle Realms repository, and explicitly granted browser mounts. It does not claim to visualize the entire native machine without a separately authorized companion or extension.

## Stable geography

An active bake revision fixes district placement, navigation anchors, station location, public silhouettes, and major roads. Live events do not continuously rearrange the city.

Live activity may change:

- Traffic and route pulses.
- Building occupancy and machine state.
- Light intensity and emissive flow.
- Audio, weather, and atmosphere.
- Temporary fractures and repair effects.
- Gates and capability wards.
- Storylet presentation overlays.
- Process inhabitants and network Travelers.

Structural filesystem changes enter through a controlled topology revision. The new bake stages offside, verifies, and transitions only at a safe boundary. The old revision remains recoverable until the transition commits.

## Topology revision lifecycle

V1 supports controlled automatic local-private refresh and explicit public appearance publication. Private source activity never triggers public-shell publication.

1. `RealmTopologyChangeDetector` consumes structural filesystem, mount, relationship, and authorized source-generation observations.
2. It groups the closed source-sequence interval into `RealmTopologyChangeSetV1` using a deterministic logical-tick debounce and count ceiling. Repeated churn cannot start unbounded compilers.
3. `RealmBakeRequestPort` sends a bounded `RealmBakeRequestV1` to the separately started RealmForge bake application. It sends identity, generations, watermarks, audience, policy, and authority references rather than mutable runtime objects.
4. RealmForge obtains a fresh audience-specific source projection from the authorized source provider, compiles the candidate in isolation, validates its closure, publishes it immutably, and returns `RealmBakeActivationOfferV1`.
5. `RealmBakeVerifier` verifies the candidate manifest, source projection, disclosure policy, compiler identities, compatibility, signature, dependency closure, resource budgets, and freshness. A candidate behind the current source generation is rejected or superseded.
6. `RealmObservationBuffer` captures a coherent authoritative snapshot and source watermarks, then buffers later ordered observations while structural delta application pauses.
7. The loader stages a new static store, collision and navigation world, ECS entities, required GPU resources, and transition-anchor map without changing the active world.
8. `RealmReprojectionService` projects the captured snapshot against the candidate bake and produces a complete anchor-bound dynamic state. It does not copy deltas whose old anchors no longer exist.
9. At one logical and frame barrier, `RealmBakeTransitionReducer` atomically selects the candidate static and dynamic stores. It preserves the current camera anchor when compatible or uses an explicit collision-safe Root Spine fallback.
10. Buffered observations after the snapshot watermarks project against the new bake in order. The Chronicle records the activation receipt.
11. Any failure before commit disposes the candidate and resumes the old bake. The buffer drains against the old projection where compatible or the runtime obtains a fresh snapshot. No partial candidate becomes visible.

The bake application and runtime remain independently started composition roots. Their only connection is the versioned request, offer, and activation-receipt protocol. There is no live RealmForge session inside the shipping runtime.

## Observation contracts

Observation ports expose bounded immutable records. They isolate privileged data before any projection or rendering module sees it.

```text
snapshot(query, audience) -> RealmObservationSnapshot
subscribe(query, audience, listener) -> unsubscribe
dispose() -> void
```

An observation record contains:

- Observation format and version.
- Monotonic source sequence.
- Source adapter, source schema, source generation, and source authority.
- Stable private or audience-scoped object ID.
- Timestamp and freshness.
- `ProvenanceClassV1`: authored, observed, derived, or construct lineage.
- `EvidenceQualityV1`: exact, measured, computed, estimated, unknown, or not-applicable quality.
- `AvailabilityStateV1`: available, sealed, denied, partial, or absent access.
- `FreshnessStateV1`: current, stale, expired, or unknown freshness.
- `TemporalModeV1`: live, historical, or preview time context.
- `AssertionStateV1`: confirmed, proposed, or hypothetical assertion status.
- Disclosure class.
- Bounded domain payload.
- Optional causal predecessor IDs.

An observation never carries a bake revision or authored anchor. WebGPU OS truth remains valid while a new visual bake stages. The projector selects the compatible target bake and produces the anchor-bound delta.

Filesystem and storage observations use one canonical adapter so the runtime does not render duplicated VFS and storage events. Raw paths never enter a public observation.

## Realm deltas

Projectors convert observations into typed `RealmDelta` records. Example operations include:

- `entity.activate`
- `entity.deactivate`
- `route.open`
- `route.degrade`
- `route.close`
- `gate.lock`
- `gate.unlock`
- `traffic.sample`
- `structure.mark-stale`
- `code.transition`
- `presentation.attach`
- `presentation.detach`

A delta references stable authored anchors. It does not contain renderer objects or privileged service handles.

`ProjectionDeltaReducer` applies source ordering, deduplication, revision matching, expiry, and idempotency. The reducer rejects a delta whose bake revision, source sequence, audience, or bridge epoch does not match current state.

## Information surfaces and local operations projection

Ordinary, shared, visitor, bridge, and replay presentation remains first person. In those contexts detached overview cameras are forbidden, and the Realm communicates scale and topology through:

- The Root Spine.
- Distinct territory silhouettes.
- SecureMesh Exchange platforms and destination boards.
- Visor route guidance.
- Street and building signage.
- Observation towers.
- Physical holograms and wall projections.
- Audible district and route cues.
- Storylet-driven guide lighting.

Historical topology or a MindWalk-like activity map may appear on a station wall or observatory projection. It never takes control of the first-person camera.

The sole overview exception is the [Local City Operations View](local-operator-view.md). `LocalOperatorViewProjector` derives it before scene assembly from the current `PrivateRealmBake`, its spatial-layout receipt, admitted loaded cells, and authorized local deltas. The view is exactly `owner-private + local-private`, has only the local `localRealmId` with no independently addressable viewed Realm, and requires a current local operator authority receipt and nonzero capability epoch.

Connected or remote Cityform material is rejected before it reaches the operator scene. `PublicRealmShell`, remote `RealmPose`, PresenceSession, RendezvousFrame, bridge, remote Traveler, remote route, destination, HLOD, collision, navigation, object-ID, pick, accessibility, and telemetry records are not valid operator-projection inputs. The minimap uses the same closed local record set. The local station may remain a local landmark, but a route terminates at its local boundary and conveys no remote identity or geometry.

The operator camera changes presentation only. Zone selection produces stable local IDs. A management action produces `LocalZoneManagementProposalV1`, which must pass the standard proposal, authority-receipt, authoritative-observation, and delta path before the world claims any change.

## Interaction rules

- Picking returns a stable object ID and interaction affordances, not an authority token.
- `InteractionResolver` produces a typed proposal.
- `ActionDispatcher` sends the proposal through capability-gated syscalls.
- The visual world waits for an authoritative success, denial, or failure observation.
- A Storylet may explain the request and wait for the result. It may not claim success early.
- V1 operations are read-only except for explicitly approved session and network actions already controlled by WebGPU OS.
- Diagnostics may operate on simulated or presentation-only fractures without mutating the real filesystem.

## Telemetry versus decoration

Real telemetry has a stable legend and provenance surface. Decorative effects use different shapes, motion, sound, and metadata. No decorative glyph may resemble readable code. No decorative figure may resemble an authenticated Traveler. No ambient route may resemble an active network connection.

Storylets and rendering effects must tag every presentation command with the complete provenance, evidence-quality, availability, freshness, temporal, and assertion tuple. The renderer preserves these distinctions in visual styling, object IDs, accessibility output, and telemetry.

## See also

- [World districts and facilities](world-districts.md)
- [M2 runtime foundation](m2-runtime-foundation.md)
- [M3 living city runtime](m3-living-city-runtime.md)
- [Cityform encounter runtime](cityform-encounter-runtime.md)
- [Architecture and ownership](architecture.md)
- [Contract catalog](contracts.md)
- [Local City Operations View](local-operator-view.md)
- [Code Matter](code-matter.md)
- [Cityforms and SecureMesh](cityforms-securemesh.md)
- [Storylets](storylets.md)
