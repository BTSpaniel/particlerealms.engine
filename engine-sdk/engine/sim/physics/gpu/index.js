/**
 * GPU Physics Engine — Barrel Export
 * 
 * Standalone WebGPU compute-based rigid body physics engine.
 * Full PhysX 5 feature parity via WebGPU compute shaders.
 * Import from this file to access all GPU physics components.
 * 
 * Usage:
 *   import { createGPUPhysicsWorld, createBroadphase, ... } from './gpu/index.js';
 * 
 * ═══════════════════════════════════════════════════════════════
 * Core Rigid Body Pipeline (7 files):
 *   GPURigidBodyWorld   — World, bodies, integration, islands, readback
 *   GPUBroadphase       — Spatial hash broadphase, AABB, pair finding
 *   GPUNarrowphase      — Shape-shape contact generation (PCM)
 *   GPUConstraintSolver  — TGS_Soft contacts + D6 joints + relaxation
 *   GPUConvexHull       — Quickhull 3D, support maps, GPU upload
 *   GPURaycast          — GPU parallel raycast + CPU fallback
 *   GPUContinuousCollision — Speculative CCD (AABB expansion + TOI)
 * 
 * Extended Simulation (4 files):
 *   GPUVehicle              — Wheels, suspension, Pacejka tires, drivetrain
 *   GPUCharacterController  — Kinematic CCT (slide-move, step climb, slope limit)
 *   GPUSoftBody             — FEM soft body (tetrahedral, co-rotational elasticity)
 *   GPUTriggerSystem        — Trigger volumes + contact events (enter/stay/exit)
 * 
 * Geometry & Queries (4 files):
 *   GPUSceneQuery       — Overlap tests, sweep/shape casts
 *   GPUHeightfield      — Terrain heightfield collider (bilinear, materials, holes)
 *   GPUTriangleMesh     — Static triangle mesh collider (BVH traversal)
 * 
 * ═══════════════════════════════════════════════════════════════
 * Existing Engine Systems (already built, import from parent):
 *   ../GPUClothSolver.js       — PBD cloth (small substeps + OGC contact)
 *   ../GPUArticulationSolver.js — Articulated chains (Cosserat rods)
 *   ../GPUSpatialHash.js       — Morton-code spatial hash (GPU Gems 3)
 *   ../SDFCollision.js         — SDF mesh geometry (PhysX 5 style)
 *   ../PBDSolver.js            — Position-Based Dynamics (XPBD, graph coloring)
 *   ../MLSMPMSolver.js         — MLS-MPM soft body (snow, sand, jelly)
 *   ../OGCContact.js           — Offset Geometric Contact (SIGGRAPH 2025)
 *   ../SpeculativeContacts.js  — CPU speculative CCD
 *   ../ShockPropagation.js     — Shock propagation (Guendelman 2003)
 *   ../VoronoiFracture.js      — Voronoi destruction (Blast SDK equivalent)
 *   ../ConvexDecomposition.js  — V-HACD convex decomposition
 *   ../VoxelMeshCollision.js   — Voxelized mesh collider (LOD)
 *   ../DynamicMeshCollider.js  — Runtime mesh collider updates
 * ═══════════════════════════════════════════════════════════════
 */

// Core Rigid Body Pipeline
export * from './GPURigidBodyWorld.js';
export * from './GPUBroadphase.js';
export * from './GPUNarrowphase.js';
export * from './GPUConstraintSolver.js';
export * from './GPUConvexHull.js';
export * from './GPURaycast.js';
export * from './GPUContinuousCollision.js';

// Extended Simulation
export * from './GPUVehicle.js';
export * from './GPUCharacterController.js';
export * from './GPUSoftBody.js';
export * from './GPUTriggerSystem.js';

// Geometry & Queries
export * from './GPUSceneQuery.js';
export * from './GPUHeightfield.js';
export * from './GPUTriangleMesh.js';
