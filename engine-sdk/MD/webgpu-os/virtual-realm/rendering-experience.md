---
title: Virtual Realm Rendering and Experience
description: Dedicated WebGPU rendering, grounded first-person traversal, owner-private local Cityform operations, visual language, semantic LOD, accessibility, recovery, and quality strategy.
audience: rendering developers, technical artists, audio developers, and accessibility reviewers
updated: 2026-08-13
status: approved planning baseline
---

# Virtual Realm Rendering and Experience

The Virtual Realm uses a dedicated Engine scene and renderer. The presentation supports city-scale grounded first-person traversal, a separately authorized owner-private view of the local Cityform, stable architecture, real activity, Code Matter, Cityforms, bridges, Storylets, spatial audio, and semantic accessibility.

## Renderer boundary

The existing immersive OS compositor converts desktop windows into textured quads with mouse-parallax presentation. It is not the Virtual Realm renderer (Source: `webgpu-os/shell/immersive/Immersive3DCompositor.js`).

The dedicated runtime reuses narrow Engine foundations:

- WebGPU canvas and device setup: `engine/core/gpu/WebGpuCanvasBootstrap.js`
- Device recovery: `engine/core/gpu/GpuRecovery.js`
- Deterministic update phases: `engine/core/framepipeline/FramePipeline.js`
- GPU resource and pass ordering: `engine/core/framegraph/FrameGraph.js`
- ECS: `engine/ecs/world/World.js`
- Mesh and material paths: `engine/render/mesh/EntityMeshRenderer.js`
- State-first visibility: `engine/render/state/StateFirstRasterizer.js`
- GPU culling: `engine/render/state/StateFirstGpuCuller.js`
- Picking: `engine/tools/picking/RayPicking.js`
- Collision math: `engine/core/math/SceneQueryMath.js`
- Spatial audio: `engine/audio/core/`
- Particle effects: `engine/render/RenderingInit.js`

Realm code reuses narrow functions and contracts. It does not add branches to the repository's largest renderer, input, camera, bootstrap, or vGPU modules.

## Initial authoritative render path

The first production path uses:

1. Forward PBR geometry.
2. Instanced repeated architecture.
3. One directional light and bounded local station lights.
4. Shadows.
5. HDR intermediate output.
6. Tonemapping.
7. Restrained semantic bloom.
8. Atmospheric distance fog.
9. Instanced Code Matter glyphs.
10. Particle pulses for real traffic and bounded Storylet effects.
11. Four-sample MSAA for opaque and alpha-to-coverage compatible geometry, resolved into the HDR target before post-processing.

Four-sample MSAA is the V1 minimum anti-aliasing policy. Thin glyph geometry additionally uses analytic MSDF edge smoothing at pixel scale; semantic signs and glyphs never rely on post-process blur for readability. A measured low-tier fallback may use one-sample rendering only when it is declared as a separate quality tier and passes the same object-ID, silhouette, and minimum text-legibility gates.

SSAO, TAA, virtual geometry, proxy geometry, voxel rendering, MorphField, path-traced GI, and advanced atmosphere enter only after focused compatibility and performance gates. The plan does not activate every existing renderer at once.

## First-person controller

The existing standard camera provides useful movement and camera math, but it behaves as a free-flying editor camera and supports multiple modes. The Realm requires a separate first-person policy and controller.

The controller provides:

- Grounded capsule collision.
- Steps and slopes.
- Head clearance.
- Doors, gates, platforms, and moving bridges.
- Click-to-enter pointer lock.
- Escape-to-release.
- Interaction focus and cursor ownership.
- Keyboard, mouse, and gamepad.
- Motion comfort and reduced-motion transitions.
- Stable camera pose across device recovery.
- No first-person release path to third person, orbit, free flight, or remote overview.

## Local City Operations controller

`LocalOperatorCameraController` is separate from traversal. It exists only while a verified `LocalOperatorViewSnapshotV1` binds the current local operator, nonzero capability epoch, authority receipt, private bake, spatial-layout receipt, policy revision, and the only representable Realm reference, `localRealmId`.

The controller provides:

- Explicit local entry and exit with no Storylet- or network-forced transition.
- Policy-bounded isometric and eagle-eye pitch, altitude, zoom, heading, and pan.
- Clamping to the verified local Cityform and admitted loaded-cell bounds.
- An owner-private minimap generated from the same local-only snapshot.
- Stable local zone selection and focus without changing world truth.
- Frame-barrier transfer from the saved first-person anchor and deterministic restoration to that anchor or the Root Spine fallback.
- Immediate teardown on authority expiry, revocation, owner change, bake mismatch, device loss, or invalid local projection.

It does not provide avatar follow, traversal, continuous orbit, free flight, debug camera, remote-city framing, or angle-based disclosure. While it is active the grounded controller receives no movement input and the Traveler remains at the saved safe anchor.

Connected Cityforms are not merely culled. Their public shells, poses, rendezvous, bridges, Travelers, HLOD, draw items, object IDs, picks, audio, accessibility records, and map entries never enter the operations scene. The local SecureMesh Exchange can remain as a local landmark with a content-free boundary-state marker.

## Original visual language

The working visual identity is **photonic civic architecture**:

- Dark mineral, ceramic, and glass structural mass.
- Restrained emissive data veins.
- Monumental silhouettes for orientation.
- Atmospheric depth instead of neon on every surface.
- Light used semantically for real activity.
- Distinct architectural grammar for the five shipped foundational territories.
- SecureMesh Exchange as the city-wide landmark.
- Code Matter that resolves by distance and authority.
- Roads and rails generated only from real relationships.
- Sealed districts presented as deliberate architectural mass rather than blurred private geometry.

Status uses color, shape, movement, labels, and sound. Meaning never depends on hue alone.

## Semantic LOD

| Range | World presentation |
| --- | --- |
| Far | Signed public skyline, territory silhouettes, Root Spine, and station landmark |
| Mid | District forms, public routes, aggregate activity, and safe signage |
| Near | Interactive architecture, collision, route detail, and authorized glyph groups |
| Inspection | Exact local source chunks, detailed process state, and object interactions under authority |

The Operations View uses local far/mid/HLOD records and bounded local alert overlays. It never requests or renders exact Code Matter chunks; readable source remains a close-range, first-person, lease-gated inspection.

Far and mid representations never contain hidden paths or private topology. Changing LOD does not change authority.

## Streaming and scale

- Cityforms maintain stable local coordinates.
- RendezvousFrames supply temporary shared coordinates.
- HLOD, instancing, and content-addressed chunks limit active resources.
- The V1 coordinate policy uses high-level double-precision CPU Realm and Rendezvous coordinates, per-frame camera-relative 32-bit GPU transforms, deterministic quantized bridge endpoints, and a frame-barrier rebase that changes no semantic pose or authority.
- Floating-origin, camera-relative conversion, rebasing, culling, collision, navigation, audio, picking, Cityform interpolation, bridge-digest, and Chronicle replay behavior must pass before M6 docking begins.
- Public shells cache by signed content ID and expiry.
- Protected refinements use audience-scoped encrypted envelopes.
- Stream-in and stream-out own every GPU buffer, texture, object URL, listener, and observer through explicit disposal contracts.

## Lighting semantics

- Neutral structural light communicates place.
- Emissive route light communicates real activity.
- Gate light communicates authority state.
- Warning light communicates a confirmed incident.
- Storylet guide light uses a separate construct presentation class.
- Historical light has a distinct replay treatment.

Bloom amplifies already emissive semantic marks. It never creates unearned activity or obscures text. Exposure and fog preserve navigation landmarks, signs, and Code Matter legibility.

## Interaction and picking

The runtime uses ray or object-ID picking to resolve stable object IDs. Picking never returns a capability token or protected source.

Surface interactions require verified triangle-to-UV or object-local hit mapping before arbitrary architectural surfaces become interactive. Existing `SurfaceInputMapper` supplies UV mapping utilities, but a production generic triangle-to-UV path still requires validation (Source: `engine/surfaces/SurfaceInputMapper.js`).

## Spatial audio

The first release uses:

- Positional station ambience.
- Directional trains and traffic.
- Process and machinery emitters.
- Gate, denial, expiry, and revocation cues.
- Basic AABB audio occlusion.
- Reverb zones.
- Captions and semantic audio descriptions.

CPU AABB occlusion is adequate for the initial station slice. Larger dynamic-city acoustics require a later spatial acceleration design.

## Accessibility

- Reduced motion suppresses decorative movement and replaces rapid travel with a comfort presentation.
- No required action uses forced camera motion.
- High-contrast mode preserves structural and status clarity.
- Color-vision matrices retain authority, danger, route, and Storylet distinctions.
- Keyboard and gamepad can reach and cancel every required station and gate operation.
- Captions cover announcements and semantic audio.
- A synchronized DOM semantic mirror reports nearby entities, route state, prompts, permissions, Storylet state, and errors.
- The owner-private minimap has a synchronized semantic list of admitted local zones, local routes, local landmarks, selection, scale, and alerts, with no remote records.
- Pointer-lock release restores stable focus.
- Historical, proposed, constructed, estimated, and live states remain distinguishable through text and shape.

## Device recovery

The composition root owns recovery. On device loss:

1. The frame loop pauses.
2. Authority, bake, projection, Storylet, network, first-person anchor, and current view-mode state remain on the CPU.
3. The GPU host acquires the replacement device.
4. Every Realm-owned pipeline, buffer, texture, atlas, surface, bind group, and query resource rebuilds exactly once.
5. Verified bakes and visible chunks reload.
6. ECS presentation reconnects without duplicating Travelers, bridges, processes, Storylets, operator snapshots, or minimap records. An operations view resumes only after its current local authority and exclusion closure revalidate; otherwise recovery returns to the safe first-person anchor.
7. The frame loop resumes only after a complete recovery barrier.

## Performance evidence

The specification milestone selects reference hardware and freezes budgets for:

- CPU frame encoding.
- GPU execution.
- Queue drain.
- P50, P95, P99, and deadline-miss windows.
- Draw and dispatch counts.
- Visible glyph instances and atlas pages.
- Active lights and shadow casters.
- GPU-owned bytes and resource counts.
- Stream-in and stream-out churn.
- Shader compilation and warm-up.
- Cityform and bridge counts.
- Local operator-view cells, anchors, zones, routes, landmarks, minimap records, and transition cost.

The product target is stable 60 Hz at 1920 x 1080 on the approved reference tier. Exact budgets must be measured rather than invented in this planning document.

## See also

- [M2 runtime foundation](m2-runtime-foundation.md)
- [World districts and facilities](world-districts.md)
- [M3 living city runtime](m3-living-city-runtime.md)
- [Cityform encounter runtime](cityform-encounter-runtime.md)
- [Local City Operations View](local-operator-view.md)
- [Code Matter](code-matter.md)
- [Storylets](storylets.md)
- [Implementation roadmap](implementation-roadmap.md)
- [Certification plan](certification-plan.md)
