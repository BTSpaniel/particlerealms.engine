---
title: GPU Physics Engine
description: Independent WebGPU physics implementations for rigid bodies, contacts, constraints, vehicles, soft bodies, and geometry queries; separate from the native PhysX PE runtime.
updated: 2026-09-22
---

# GPU Physics Engine

A set of independent WebGPU physics implementations in `engine/sim/physics/gpu/`, with WGSL compute shaders and JavaScript orchestration. These modules are separate from the native PhysX PE 5.11 CPU/WASM runtime and NVIDIA Flow's browser port.

Module names and similar feature categories do not establish numerical or API parity with NVIDIA PhysX. This inventory is not evidence that native PhysX CUDA features have been ported to WebGPU. See the [verified runtime support boundary](physics.md#support-boundary) for PhysX PE, Blast and Flow.

## Architecture

```text
GPU Physics Pipeline
  CCD Expand → Broadphase (hash) → Narrowphase (PCM) → Solver (TGS_Soft)
  Heightfield contacts · TriMesh contacts · Triggers/events · Integration + sleep
  Vehicles (GPU) · Soft body (FEM) · CCT (CPU) · Readback (async)
  CPU-side synchronous: Raycast (CPU/GPU) · Scene query
```

Key principles:

- **WebGPU compute shaders** (WGSL) for all parallel workloads.
- **CPU orchestration** for serial logic (islands, CCT, scene queries).
- **Fixed pre-allocated GPU buffers** (PhysX 5 pattern) — overflow warns, never crashes.
- **SoA (structure of arrays)** layout for GPU cache efficiency.
- **No PhysX code modified** — parallel implementation for future migration.

## PhysX 5 feature parity

Full upstream parity is not established. The table inventories existing project
modules by comparable feature category; “Built” describes source availability,
not upstream conformance or validation of every advertised behavior. Native
PhysX PE acceptance does not validate these separate GPU implementations.

### GPU physics modules (15 files)

| PhysX 5 feature | Module | Status |
| --- | --- | --- |
| GPU Rigid Bodies | `GPURigidBodyWorld.js` | Built |
| GPU Broadphase | `GPUBroadphase.js` | Built |
| GPU Contact Gen (PCM) | `GPUNarrowphase.js` | Built |
| GPU Constraint Solver (TGS) | `GPUConstraintSolver.js` | Built |
| Convex Hull Cooking | `GPUConvexHull.js` | Built |
| Raycasting | `GPURaycast.js` | Built |
| Speculative CCD | `GPUContinuousCollision.js` | Built |
| Vehicle SDK | `GPUVehicle.js` | Built |
| Character Controller | `GPUCharacterController.js` | Built |
| FEM Soft Bodies | `GPUSoftBody.js` | Built |
| Trigger Events | `GPUTriggerSystem.js` | Built |
| Scene Queries | `GPUSceneQuery.js` | Built |
| Heightfield Terrain | `GPUHeightfield.js` | Built |
| Triangle Mesh Collider | `GPUTriangleMesh.js` | Built |

### Existing engine systems

Modules in the parent `engine/sim/physics/` directory cover additional PhysX features, referenced from the GPU barrel export: PBD cloth (`GPUClothSolver.js`), articulations (`GPUArticulationSolver.js`), SDF mesh geometry (`SDFCollision.js`), XPBD solver (`PBDSolver.js`), MLS-MPM soft body (`MLSMPMSolver.js`), OGC contact (`OGCContact.js`), CPU CCD (`SpeculativeContacts.js`), shock propagation (`ShockPropagation.js`), destruction (`VoronoiFracture.js` + `FragmentPhysics.js`), convex decomposition (`ConvexDecomposition.js`), voxel mesh collider (`VoxelMeshCollision.js`), and GPU spatial hash (`GPUSpatialHash.js`).

### Additional project simulations

- **OGC contact model** (`OGCContact.js`) — SIGGRAPH 2025 penetration-free barrier energy.
- **MLS-MPM** (`MLSMPMSolver.js`) — handles topology changes (melting, fracture).
- **LBM wind** (`WindSimulation.js`) — Lattice-Boltzmann GPU wind field.
- **Thermal particles** (`ParticleSimWorld.js`) — phase transitions, buoyancy, chemistry.
- **Rope interaction** (`RopeParticleInteraction.js`) — per-fiber thermal (burn, wet, corrode).

## Core rigid body pipeline

- **`GPURigidBodyWorld.js`** — central world manager owning all GPU buffers, body descriptions, and the island manager. 5 WGSL shaders (integrate, applyDeltas, deriveVelocity, sleepDetect, clearForces); CPU union-find island manager (sleeping islands skip GPU dispatch); SoA layout; body types Dynamic (0), Kinematic (1), Static (2); shapes Sphere (0), Box (1), Capsule (2).
- **`GPUBroadphase.js`** — spatial-hash broadphase. 4 WGSL shaders (computeAABB, clearHash, insertHash, findPairs); 27-neighbor cell query with layer/mask filtering.
- **`GPUNarrowphase.js`** — analytic shape-shape contact generation with persistent contact manifold (PCM). Pairs: sphere-sphere, sphere-box, box-box (SAT 15 axes), sphere-capsule, capsule-capsule, ground plane. Contact data: normal, penetration, point, accumulated impulse, local anchors (A+B), featureId.
- **`GPUConstraintSolver.js`** — TGS_Soft iterative solver (Box2D v3 / Catto 2023). Contact solve (bias velocity, Coulomb friction cone, restitution, impulse clamping, warm starting); D6 joint (ball, hinge, fixed, distance, cone limits); post-solve relaxation pass.
- **`GPUConvexHull.js`** — CPU Quickhull 3D + GPU upload (PhysX 64-vertex GPU limit).
- **`GPURaycast.js`** — GPU parallel raycasting (ray-sphere/box/capsule) with workgroup reduction; CPU fallback for synchronous queries.
- **`GPUContinuousCollision.js`** — speculative CCD: AABB expansion by velocity × dt for CCD-flagged bodies (bit 25), then TOI via conservative advancement.

## Extended simulation

- **`GPUVehicle.js`** — per-wheel suspension (spring-damper) + tire force (simplified Pacejka); CPU manager for input and gear shifting; presets sedan/sports/truck/offroad; `MAX_VEHICLES=64`, `MAX_WHEELS_PER_VEHICLE=8`, drive types FWD/RWD/AWD.
- **`GPUCharacterController.js`** — CPU-driven kinematic CCT: Quake-style recursive slide-move (max 4 bounces), downward-raycast ground detection (skin width 0.08 m, step height 0.35 m), ~45° slope limit, step climbing, capsule (default) or box shape.
- **`GPUSoftBody.js`** — FEM soft body on tetrahedral meshes. 2 GPU shaders (co-rotational FEM force + integration); Müller polar decomposition; materials via Young's modulus + Poisson's ratio → Lamé parameters; presets rubber/jelly/flesh/foam/silicone/stiff.
- **`GPUTriggerSystem.js`** — trigger volumes + contact events. GPU AABB overlap for trigger-flagged bodies (bit 24); CPU persistent pair state for enter/stay/exit; callbacks `onTriggerEnter/Stay/Exit` and `onContactBegin/Persist/End`.

## Geometry & queries

- **`GPUSceneQuery.js`** — CPU-side synchronous queries (overlap sphere/box, sweep sphere/box, multi-hit), with layer/exclude/include filtering. CPU because 1–10 queries/frame need immediate results.
- **`GPUHeightfield.js`** — heightmap terrain collider: 5-point bilinear sampling, per-cell materials, NaN-height holes, up to 1024×1024.
- **`GPUTriangleMesh.js`** — static mesh collider with BVH: CPU median-split BVH cook, GPU iterative traversal (32-level stack), 8 contacts/body, up to 16 meshes, 65536 triangles/mesh.

## Constants & limits

| Constant | Value | Module |
| --- | --- | --- |
| `MAX_BODIES` | 4096 | GPURigidBodyWorld |
| `MAX_CONTACTS` | 16384 | GPUNarrowphase (shared) |
| `MAX_PAIRS` | 32768 | GPUBroadphase |
| `MAX_JOINTS` | 2048 | GPUConstraintSolver |
| `MAX_VEHICLES` | 64 | GPUVehicle |
| `MAX_WHEELS_PER_VEHICLE` | 8 | GPUVehicle |
| `MAX_TRIGGER_EVENTS` | 4096 | GPUTriggerSystem |
| `MAX_CCD_PAIRS` | 8192 | GPUContinuousCollision |
| `MAX_SOFT_BODY_NODES` | 16384 | GPUSoftBody |
| `MAX_SOFT_BODY_TETS` | 32768 | GPUSoftBody |
| `MAX_TRIMESH_TRIANGLES` | 65536 | GPUTriangleMesh |
| `MAX_TRIMESH_INSTANCES` | 16 | GPUTriangleMesh |
| `MAX_HEIGHTFIELD_SIZE` | 1024 | GPUHeightfield |

All limits are configurable via constructor options (PhysX 5 GPU pattern: fixed pre-allocated buffers with overflow warnings).

## Pipeline execution order

Each physics frame dispatches in this order: (1) CCD expand AABBs, (2) broadphase, (3) narrowphase, (4) heightfield contacts, (5) triangle-mesh contacts, (6) CCD TOI contacts, (7) constraint solver, (8) integration + sleep, (9) trigger & contact events, (10) vehicle forces, (11) soft-body step, (12) character controller, (13) readback positions. Scene queries and raycasts can run at any time (CPU-side, synchronous).

## Design decisions

| Decision | Rationale | Source |
| --- | --- | --- |
| TGS_Soft solver | Sub-stepping + warm starting + soft constraints | Box2D v3 (Catto 2023) |
| Delta-position formulation | FP32 stability far from world origin | Erin Catto, GDC 2024 |
| Simulation islands (CPU) | Union-find groups for per-island sleep/wake | Jolt, PhysX 5 |
| D6 as sole GPU joint | All joint types decompose to D6 — one shader | PhysX 5 GPU best practice |
| Spatial hash broadphase | O(1) insert/query, good GPU utilization | GPU Gems 3 Ch.32 |
| Fixed buffers | Pre-allocated, overflow warnings, no runtime alloc | PhysX 5 GPU pattern |
| PCM contacts | Persistent manifold + local anchors + feature IDs | PhysX 5 eENABLE_PCM |
| CPU scene queries | 1–10 queries/frame need synchronous results | PhysX 5 architecture |
| Co-rotational FEM | Stable under large deformation, cheaper than Neo-Hookean | Müller, Irving et al. |
| BVH for triangle mesh | Median-split AABB tree, iterative GPU traversal | Embree, PhysX |
