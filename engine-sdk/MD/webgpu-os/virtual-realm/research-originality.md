---
title: Virtual Realm Research and Originality Ledger
description: Source-backed inspiration boundaries, MindWalk implementation distance, fictional references, independent design decisions, and prohibited copying.
audience: project leads, designers, legal reviewers, and implementers
updated: 2026-09-03
status: current research and originality boundary; M2 underway and M3 planned
---

# Virtual Realm Research and Originality Ledger

The Virtual Realm uses broad systems and spatial-computing ideas while retaining an original product identity, original visual language, independent implementation, and repository-native architecture.

## MindWalk boundary

MindWalk demonstrates a useful separation between deterministic topology, ordered activity, and playback. Its implementation uses Go, React, Vite, Three.js, and WebGL, which conflicts with this repository's browser-native ES modules, WebGPU renderer, Python tooling, and no-Node constraint.

MindWalk maps directory hierarchy and coding-session touches. It does not define the Virtual Realm's imports, IPC, syscalls, processes, mounts, services, permission gates, Code Matter authority, SecureMesh station, mobile Cityforms, public shells, rendezvous frames, Storylets, or capability-aware bridges.

Because MindWalk source was inspected, the Virtual Realm implementation is described as an independent behavior-led implementation, not a formal clean-room implementation.

The project copies no MindWalk:

- Source code.
- Schemas or constants.
- Layout equations.
- UI text.
- Colors or visual hierarchy.
- Shaders.
- Assets.
- Screen composition.
- Build system.

Reference: [pinned MindWalk revision](https://github.com/cosmtrek/mindwalk/tree/77cd79596a1b7f9f62256ea06485e15182a09566) and [MIT license](https://github.com/cosmtrek/mindwalk/blob/77cd79596a1b7f9f62256ea06485e15182a09566/LICENSE).

## Fictional inspiration boundary

Broad references include Tron, The Matrix, Mega Man, Digimon, and Accel World. Reusable abstract themes include:

- Embodied identity.
- A persistent digital place.
- Visible communication and transportation.
- Network-scoped encounters.
- Reality-grounded virtual topology.
- Territories and landmarks.
- Transition anchors.
- Symbolic digital material.

The product copies no protected expression, including:

- Franchise names inside the product.
- Characters or character silhouettes.
- Avatars or transformation designs.
- Maps or recognizable locations.
- Faction and color hierarchies.
- Portal treatment.
- User interfaces.
- Command phrases.
- Sound, dialogue, music, or story structure.
- Exact acceleration mechanics.
- Points economy or combat rules.

Official Accel World material supports embodied avatars, local and wider network scopes, shared virtual fields, territories, and transition anchors. It depicts geographically anchored areas rather than traveling personal PC-cities. Mobile Cityforms are an original departure. References: [Dengeki series page](https://dengekibunko.jp/title/accele_world/) and [official anime story](https://www.accel-world.net/story.php).

The source-to-design translation remains explicit:

| Officially supported abstraction | Independent Virtual Realm decision |
| --- | --- |
| Embodied identity and a locally generated digital body | One human-scale Traveler plus a separate mobile PC-scale Cityform |
| School-local and global connection scopes | SecureMesh discovery and presence scopes; rendered proximity never grants authority |
| Reality-grounded virtual topology | A local Cityform compiled from authorized real system structure |
| Territorial groups and shared fields | Federated temporary RendezvousFrames rather than copied maps, factions, or rulers |
| Landmark transition anchors | The original SecureMesh Exchange, directional station gates, and deterministic capability bridges |
| Subjective acceleration as a fiction premise | No copied acceleration value or mechanic; real-time multiplayer and independently named diagnostic replay only |

Additional official sources used to verify those broad abstractions include the authorized [Chapter 1 presentation](https://dengekibunko.jp/novecomi/novel/16817330659578065064/16817330659578334293.html), [Chapter 2 to 4 presentation](https://dengekibunko.jp/novecomi/novel/16817330659578065064/16817330659578710793.html), and official volume pages for [a transition anchor](https://dengekibunko.jp/product/accele_world/311936200000.html), [geographic headquarters](https://dengekibunko.jp/product/accele_world/312148200000.html), [territory control](https://dengekibunko.jp/product/accele_world/321602000320.html), [territory conflict](https://dengekibunko.jp/product/accele_world/321606000595.html), and [persistent shared-field events](https://dengekibunko.jp/product/accele_world/321708000122.html). These sources establish inspiration boundaries, not an implementation specification.

The U.S. Copyright Office distinguishes general game ideas and methods from protected literary and pictorial expression. Reference: [Copyright Office games guidance](https://www.copyright.gov/register/tx-games.html) and [Circular 33](https://www.copyright.gov/circs/circ33.pdf).

## Internal Playground clean-room boundary

The first-party Playground is research evidence, not a production dependency or visual template. The project uses an internal clean-room discipline: record public Engine API names, observable invariants, failure conditions, lifecycle obligations, and testable limitations; then specify new Realm-owned ports and contracts without transferring demo implementation expression.

The complete allow-listed audit contains 15 Playground files: `tests/playground/src/core/engine.js`, `tests/playground/src/core/rasterizer.js`, the four-file CSE set rooted at `tests/playground/src/demos/cseTour.js`, the six-file URC set rooted at `tests/playground/src/demos/urcState.js`, and the three-file Root Algebra set rooted at `tests/playground/src/demos/rootAlgebra.js`. The only directly cited state-engine barrel is `engine/state/index.js`. Every exact path and its disposition is recorded in [Playground clean-room foundations](playground-clean-room-foundations.md).

The accepted abstractions are narrow:

- CSE: partial causal order, exclusive-state and idempotency evidence, capability attenuation, authority-separated observations, reliable effects, bounded-proof honesty, belief-versus-canonical separation, deterministic input binding, and explicit hardening limits.
- URC: selecting a projection does not choose truth; one authority commit establishes canonical state; a rejected branch may remain an audience-scoped historical witness without becoming current or authoritative.
- State-First: an explicit source supplies authoritative entity state and the Engine returns bounded representation decisions; presentation feedback cannot mutate semantics.
- Root Algebra: recognize a pure repeated pattern, state its proof obligations, require exact law evidence and counterexamples, compile an immutable plan only after acceptance, compare against the baseline, and retain the baseline on every failure.

The project copies or imports no Playground demo source, module structure, shader, DOM/CSS, UI text, camera path, scene composition, object placement, color grammar, animation value, generated graph topology, loader global, module-probing behavior, or fallback. CSE/URC and State-First runtime integration is being rebuilt behind `VirtualRealmEntry` ports across active M2 and planned M3 slices. The optional Root Algebra optimizer is implemented in accepted M1A behind the proof-gated pure compiler seam and remains prohibited from every authority and disclosure path.

## Original design identity

The Virtual Realm's original identity includes:

- A mobile PC-city as the user's macro-avatar.
- A human-scale first-person Traveler inside the Cityform.
- RealmForge-authored photonic civic architecture.
- WebGPU OS truth projected through typed observations and deltas.
- SecureMesh as a literal railway exchange.
- Independently compiled private, public, and refinement bakes.
- Public noninterference as a release invariant.
- Real source rendered as authority-bound Code Matter.
- Temporary federated RendezvousFrames.
- Directional capability bridges with deterministic recipes and epochs.
- Storylets that stage real events without becoming world truth.
- Grounded first-person system maps and Chronicle replay, plus one independently designed owner-private local Cityform operations map that never includes a connected Cityform.

## External technical references

The M2+ developmental, regulatory, homeostatic, quality-diversity, role,
artificial-chemistry, culture, and organismality research is recorded separately
in the primary-source [Genesis Ecology research adoption ledger](../../concepts/genesis-ecology.md#research-adoption-ledger).
Those sources motivate bounded architecture decisions; they do not establish an
implementation, a claim of artificial life, or an authority shortcut.

- [WebGPU specification](https://www.w3.org/TR/webgpu/) for browser GPU behavior.
- [WebRTC specification](https://www.w3.org/TR/webrtc/) for browser peer communication.
- [OGC 3D Tiles](https://www.ogc.org/standards/3DTiles/) for general hierarchical 3D streaming concepts.
- [W3C Privacy Principles](https://www.w3.org/TR/privacy-principles/) for data minimization.
- [NIST Zero Trust Architecture](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf) for per-resource authorization.
- [File System Access specification](https://wicg.github.io/file-system-access/) for browser-local file grants.
- [Web Cryptography API](https://www.w3.org/TR/webcrypto-2/) for browser cryptographic primitives.
- [WebGPU MSDF sample](https://webgpu.github.io/webgpu-samples/?sample=textRenderingMsdf) for a public GPU text-rendering reference.
- [WebGPU primitive-picking sample](https://webgpu.github.io/webgpu-samples/?sample=primitivePicking) for a public GPU picking reference.
- [ICP concepts](https://docs.internetcomputer.org/concepts/) and [ICP message routing](https://docs.internetcomputer.org/concepts/protocol/message-routing/) for the optional future `internet-computer` adapter. ICP subnets, canisters, intra-subnet messages, and authenticated XNet streams would appear as an external long-distance archipelago and rail system, never as local IPC and never without a real adapter.

These references inform standards-compatible behavior. They do not replace repository contracts or authorize copied implementation.

## Excluded material

The First Shard is excluded from this plan. No source, test, imported document content, runtime, architecture, mechanic, art direction, scan result, or dependency from that application may inform The Virtual Realm. This sentence and the matching gates are exclusion-only assertions, not imported design material.

This exclusion has its own certification gate.

## See also

- [The Virtual Realm](index.md)
- [Contract catalog](contracts.md)
- [Security and privacy](security-privacy.md)
- [Implementation roadmap](implementation-roadmap.md)
- [Certification plan](certification-plan.md)
- [Playground clean-room foundations](playground-clean-room-foundations.md)
- [Genesis Ecology integration](genesis-ecology-integration.md)
