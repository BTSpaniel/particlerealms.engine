---
title: Glossary
description: Definitions of the core terms used across the docs — stack and runtime, GPU concepts, kernel, shell, and more.
updated: 2026-09-12
---

# Glossary

Terms used throughout this documentation. Each term is defined once here and linked from the pages that use it.

## Stack & runtime

- **Engine** — the WebGPU runtime in `engine/`: GPU device, frame graph, ECS, rendering, simulation, networking, audio.
- **Plauna** — the hybrid DOM/GPU UI framework in `plauna/` (panels, widgets, surfaces, theming).
- **AGI** — the reinforcement-learning rigging system in `agi/` ("parasite rig"), plus a WebGPU tensor library and AGI Studio.
- **WebGPU OS** — the composition layer in `webgpu-os/`: compositor, shell, kernel, package system, app runtime.
- **Kernel** — the OS's privileged core (`webgpu-os/kernel/`): syscalls, scheduling, GPU mediation, trust, permissions.
- **Shell** — the desktop UI (`webgpu-os/shell/`): `Desktop`, `Taskbar`, `StartMenu`, windows, notifications.

## Repository tooling

- **Execution prerequisite**: An explicitly declared test or tool that must pass before a dependent job starts. Ordinary source imports and catalog relationships do not create prerequisites.
- **Repository resource lease**: A shared or exclusive operating-system file lock held by a participating queue until the job and its child-process cleanup finish. It coordinates named resources within the documented same-user scope, without reserving hardware against nonparticipating applications. See the [shared queue](../guides/global-tooling-queue.md).

## Sprite animation

- **Frame** — one timed image in an animation, composed from the drawings on its visible layers.
- **Cel** — the drawing at one layer/frame intersection. In the proposed [Paint animation model](../webgpu-os/paint-sprite-animation-plan.md), a blank cel contains no pixels, and duplicating a cel produces an independently editable drawing.
- **Onion skin** — an editing overlay that shows nearby animation frames for alignment. It is excluded from the artwork and exported animation.
- **Sprite sheet** — an image containing multiple sprite frames in known rectangles, commonly accompanied by timing and frame metadata.

## GPU

- **WebGPU** — the browser GPU API the whole stack targets.
- **WGSL** — WebGPU Shading Language; the portable shader format used across tiers.
- **BVH** — bounding-volume hierarchy: a tree of enclosing bounds that skips geometry a ray cannot hit.
- **Tetrahedral cage** — a coarse deforming volume of four-vertex cells. The [cage lab](../engine/tetrahedral-cage-lab.md) transforms rays into each cell's rest space to reuse static dense micro-geometry.
- **VGPU (Virtual GPU)** — the engine's abstraction over the raw WebGPU device (`engine/core/gpu/VirtualGPU.js`) that adds multi-queue, bind-group management, streaming, and resource tracking.
- **GPU device broker** — the kernel service (`kernel/GpuDeviceBroker.js`) that shares the single WebGPU device across all apps.
- **device-lost** — a WebGPU event raised when the GPU context is lost; the kernel fans this out to apps for recovery.

## Matter

- **Matter packet** — one finite, lineage-bearing owner of canonical mass, represented volume, momentum, angular momentum, and tracked energy. A codec split replaces one packet with eight descendants; a compatible merge reverses that representation change.
- **Physical tier** — the active matter representation class: residual (`R`), kinematic (`K`), field (`F`), bonded (`B`), or explicit (`X`). The fidelity governor can promote or demote work without changing identity or canonical totals.
- **Bond Fabric** — the structural graph of material nodes and XPBD constraints. Fracture deletes an active graph edge and preserves a crack residual, so disconnected parts stop transmitting force.
- **Phase transcode** — a journaled atomic change between declared states in a phase family, with explicit temperature, reservoir, and structural-policy bounds.
- **Realm Matter Fabric** — the semantic substrate for canonical matter definitions, conditioned property observations, transformation planning, evidence, conservation, lineage, and offline domain packs.

## MorphField

- **MorphField** — the Engine's additive semantic-field renderer and compiler under `engine/render/morphfield/`.
- **Nexel** — a public semantic scene element that describes source geometry or media, material, motion, collision, simulation, and quality intent without selecting a GPU backend.
- **Fieldlet** — MorphField's private compiled execution record. A Fieldlet belongs to one of four stable execution families and exposes a mask of supported typed queries.
- **Certified query** — a query backed by compiler-derived conservative bounds or error records. Authored data cannot declare itself certified.

## OS concepts

- **App** — a plug-in module discovered at runtime from `apps/`, described by a manifest.
- **Manifest** — the JSON describing an app: id, entry, permissions, capabilities (see App Manifest Spec).
- **Package (`.prpkg`)** — an installable, signed, encrypted container (v2 = encrypted ZIP + public envelope).
- **Mod** — a runtime extension discovered from `mods/` via `ModRegistry`.
- **Syscall** — a kernel-mediated operation exposed to apps (`kernel/Syscalls.js`).
- **Capability** — a permission token gating a syscall or resource (see `packages/CapabilityMap.js`).
- **Trust ring / ring-0 roots** — the trust hierarchy; ring-0 roots live in `kernel/trust/roots.json`.
- **Provenance** — verifiable origin/lineage of a package (`kernel/ProvenanceChecker.js`, `SigningLineage.js`).
- **Surface** — a renderable region (DOM, DOM+GPU, or pure GPU) managed by `SurfaceManager`/Plauna.
- **Workspace / Panel** — Plauna's dockable window units; every OS window is a Plauna panel.
- **Stable bootstrap** — the rarely changed top-level WebGPU OS document, service worker, release router, recovery UI, runtime host, and stable Realm host that select and supervise installed releases.
- **System release** — one immutable replaceable WebGPU OS runtime, identified by a content-derived `releaseId` and distributed as a signed, segmented, encrypted JHC package. It is separate from an app `.prpkg`.
- **Release-qualified URL** — an immutable resource URL containing the exact release ID: `/webgpu-os/__particle__/release/<releaseId>/<logicalPath>`.
- **Runtime capsule** — a bounded, secret-free JSON projection used to restore approved application/window state and a Realm event cursor into a replacement runtime iframe.
- **Update swarm** — an optional Particle chunk-delivery path for already trusted encrypted system-release pieces; peers provide bytes but cannot establish release authority.

## ECS

- **ECS** — Entity-Component-System; the engine's state model.
- **Entity** — an id; **Component** — data attached to an entity; **System** — logic over components.
- **World** — a container of entities/components/systems (the engine and Plauna each have worlds).

## AGI / ML

- **PPO** — Proximal Policy Optimization, the RL algorithm used to train the rig.
- **Tensor library** — the custom WebGPU tensor implementation in `agi/tensor/`.
- **Curriculum** — the staged training progression (`agi/core/CurriculumManager.js`).
- **Ragdoll** — the physics body the rig learns to control (`agi/core/RagdollController.js`).
- **Observation / Action space** — the RL input (12D) and output (17D) vectors.

## Navi

- **Navi** — a persistent OS principal whose identity, authority, memory, and lineage remain independent from any model, provider, session, device, or body.
- **Continuity Kernel** — the kernel-owned Navi service that protects persistent identity and operational signing authority.
- **Covenant** — the signed operator-Navi contract that bounds observation, memory, autonomy, disclosure, approvals, transfer, recovery, and separation.
- **Cognition Fabric** — the model-neutral router that selects replaceable remote or local cognition engines while preserving task continuity.
- **System One** — a category of fast decision models that return typed judgments and probabilities instead of chat prose. AI Echo's optional [Decision Assist](../webgpu-os/jev-decisions.md) connects a compatible model alongside its chat model; it grants no tool authority or factual guarantee.
- **Action Assist** — opt-in System One selection among finite browser or app actions. Ordinary permissions, execution and independent result checks remain mandatory.
- **Build Assist** — opt-in System One recommendations for RealmForge template reviews, previews and diagnostics. Advice does not apply or approve a document change.
- **Game Director** — an event-driven System One host adapter that selects among legal encounter, NPC or pacing choices. The game host owns rules, state commits and independent verification.
- **Faculty** — a signed, versioned, inspectable ability module with typed inputs and outputs, declared permissions, tools, models, costs, tests, and failure behavior.
- **Programmatic Faculty** — a request-scoped, allocation-bounded orchestration subset compiled into an isolated Worker. Its evidence binds an explicit source profile plus submitted and canonical compiled source hashes. An exact task-and-covenant resource lease is consumed only at the validated Worker-start boundary, rechecked before sandbox creation, and terminally reconciled, settled, or released. It composes only exact allowlisted `safe_read` tools; every committed inner call still uses normal authorization, Faculty verification, accounting, and receipts.
- **Tool-result handle** — an opaque request-local reference to an exact privacy-scrubbed provider projection of a large tool observation. It supports bounded reads and grants no capability, receipt, evidence status, or storage authority.
- **Pure-local speculation** — early shadow computation for the audited, bounded `calculator.evaluate` operation under an exact pure, deterministic, kernel-owned, local-only, no-egress, no-authority contract. The canonical path must authorize the unchanged finalized call before adopting the value.
- **Causal Memory Weave** — append-only evidence-bearing Navi memory and its derived human-readable views.
- **Authority Membrane** — the kernel boundary that intersects applicable policies and issues narrow, temporary capabilities for actions.
- **Manifestation** — one body or interface through which a Navi is present, such as AI Echo, voice, a Construct body, a vehicle, or a remote projection.
- **Hand** — a temporary specialist worker with a narrow task, minimal context, temporary authority, a resource lease, expiry, traceable parentage, and a required report.
- **Navi Branch** — an explicitly approved persistent divergent Navi timeline with a distinct operational key; it is not a Realm branch or an independent identity.

## Realm Network

- **Realm Network** — the WebGPU OS network layer for portable identity, immutable Realm content, resumable peer links, semantic replication, offline branches, governance, bounded task exchange, discovery, and entry policy.
- **Passport** — the user-facing Realm identity rooted in `ProfileDriver`, with signed key lineage, device authorization, recovery, rotation, and revocation.
- **Chronicle** — an append-only signed SHA-256 event history used to establish parentage and integrity.
- **Realm Capsule** — an immutable semantic content package backed by existing package, Merkle, chunk, and shared content-addressed storage systems.
- **Realm Link** — a logical authenticated peer session that survives transport replacement and reconnects.
- **Atlas** — provider-based Realm discovery using signed, visibility-scoped, bounded records.
- **Gate** — the entry verifier that derives deny, quarantine, safe, read-only, or full-entry outcomes.
- **Shield** — the isolation and moderation boundary for quotas, blocking, reporting, audit, and restoration.
- **State Channel** — an authoritative intent-and-projection path. Clients send typed intents; an authority emits revisioned projections and receipts. SSE is the standard downstream transport for browser views.
- **Intent** — a typed request to a State Channel authority. An intent does not become shared truth until the authority accepts it.
- **Projection** — confirmed state derived for a State Channel consumer as a snapshot, merge patch, or event.

## The Virtual Realm

- **Virtual Realm**: the first-person living spatial twin of authorized WebGPU OS and Particle Realms structure and activity.
- **Cityform**: one computer's mobile macro-scale embodiment in the shared digital world.
- **Traveler**: a user's authenticated human-scale first-person presence inside a Cityform or authorized destination.
- **Mesh Expanse**: the shared presentation space in which public Cityforms can encounter one another.
- **RendezvousFrame**: a temporary federated coordinate frame used by approaching and docking Cityforms; it conveys no authority.
- **Root Spine**: the primary local orientation and transit landmark generated from the authorized root topology.
- **SecureMesh Exchange**: the diegetic train station and network hub that presents real SecureMesh discovery, identity, routes, traffic, and disconnect state.
- **Code Matter**: spatial matter backed by real authorized source or data and presented as sealed, structured, or exactly revealed.
- **RealmVisualBake**: an immutable runtime-ready package of RealmForge-authored topology, geometry, materials, lighting, collision, navigation, sockets, LOD, projection bindings, and Storylets.
- **PrivateRealmBake**: the exact authorized local Cityform projection, unpublished by default.
- **PublicRealmShell**: an independently compiled, signed, sanitized, complete-looking public Cityform representation that contains no private-machine reconstruction.
- **AccessRefinement**: an independently compiled, encrypted, capability-scoped addition to a public shell.
- **RealmObservation**: a normalized immutable fact emitted by an authoritative WebGPU OS or network port.
- **RealmDelta**: an immutable live presentation change derived from one or more authorized observations.
- **Storylet**: a deterministic data-driven scenario that explains and stages verified truth, produces reversible presentation, and may emit powerless action proposals.
- **Bridge Epoch**: one authenticated docking and authorization generation to which protected bridge messages and resources are bound.
