/**
 * engine/kaolin — Kaolin-equivalent 3D Geometry Toolkit
 *
 * WebGPU-native geometry operations inspired by NVIDIA Kaolin.
 * Provides representation conversions, mesh ops, SDF tools,
 * point cloud ops, and physics bridges for the engine's
 * particle/softbody/mesh/voxel systems.
 *
 * Usage:
 *   import { ops } from '../kaolin/index.js';
 *   const he = new ops.mesh.HalfEdgeMesh(positions, indices);
 *   const normals = ops.mesh.computeVertexNormals(positions, indices);
 */

export * as ops from './ops/index.js';
export * as metrics from './metrics/index.js';
export * as physics from './physics/index.js';
export * as io from './io/index.js';
