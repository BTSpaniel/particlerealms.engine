// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * VoxelWorldRenderer - simple engine-side renderer for voxel_world material.
 * Now powered by vGPU driver
 *
 * This mirrors the style of StandardRoomRenderer but uses the engine's
 * materials/voxel_world shader. It builds a ground mesh and exposes the
 * pipeline, mesh, and frame uniforms so callers can integrate it into
 * their render loop.
 */
import { initVGPU } from "../../core/gpu/VirtualGPU.js";
import { createShaderLoader } from "../shaders/ShaderLoader.js";
import { getVertexBufferLayoutForMesh } from "../Mesh.js";
import { createGroundGeometry } from "../geometry/PrimitiveGeometry.js";
import { buildStaticMeshFromGeometry } from "../geometry/StaticMeshBuilder.js";
import { createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";

/**
 * Create a voxel world renderer.
 * @param {Object} options
 * @param {GPUDevice} options.device
 * @param {string} options.format - swapchain format
 * @param {number} [options.worldSize] - ground size
 * @param {Object} [options.logger]
 */
export async function createVoxelWorldRenderer(options) {
  const { device, format, worldSize, logger } = options || {};

  if (!device) {
    throw new Error("createVoxelWorldRenderer: device is required");
  }
  if (!format) {
    throw new Error("createVoxelWorldRenderer: format is required");
  }

  const size = Number.isFinite(worldSize) && worldSize > 0 ? worldSize : 80;

  const shaderLoader = createShaderLoader({
    baseUrl: "../../engine/render/shaders",
  });
  const shaderCode = await shaderLoader.loadMaterial("voxel_world");

  const vgpu = initVGPU(device);
  const shaderModule = vgpu.shader.compile('voxelWorld', shaderCode);

  // Build a simple ground mesh
  const groundGeom = createGroundGeometry(size);
  const groundMesh = buildStaticMeshFromGeometry(
    device,
    {
      positions: groundGeom.positions,
      normals: groundGeom.normals,
      indices: groundGeom.indices,
    },
    "VoxelWorldGround",
  );

  const vertexLayout = getVertexBufferLayoutForMesh(groundMesh);

  // Define explicit bind group layout
  const frameLayout = vgpu.bindings.defineLayout('voxelWorldFrame', [
    { binding: 0, type: 'uniform', visibility: 'vertex|fragment' },
  ]);

  const pipeline = vgpu.pipeline.render({
    vertex: { module: shaderModule, entryPoint: 'vs_main' },
    fragment: { module: shaderModule, entryPoint: 'fs_main' },
    vertexLayout: [vertexLayout],
    layouts: [frameLayout],
    colorFormat: format,
    depthFormat: 'depth24plus',
    depthWrite: true,
    depthCompare: 'less',
    cullMode: 'back',
    topology: 'triangle-list',
    label: 'VoxelWorldPipeline'
  });

  const frameBuffer = vgpu.buffer.create({ size: 256, usage: 'uniform', label: 'VoxelWorldFrameUniforms' }).buffer;

  const frameBindGroup = vgpu.bindings.createGroup(frameLayout, [
    { binding: 0, buffer: frameBuffer },
  ]);

  if (logger && typeof logger.info === "function") {
    logger.info("VoxelWorldRenderer: pipeline and ground mesh created");
  }

  return {
    device,
    pipeline,
    shaderModule,
    groundMesh,
    frameBuffer,
    frameBindGroup,
  };
}

/**
 * Update voxel world frame uniforms.
 * Expects viewProj, view, proj as 4x4 Float32Array matrices.
 */
// Reusable buffer to avoid GC pressure in hot path
const _voxelFrameData = new Float32Array(52);

export function updateVoxelWorldFrameUniforms(
  device,
  frameBuffer,
  viewProj,
  view,
  proj,
  cameraPos,
  time,
) {
  if (!device || !frameBuffer) return;

  const data = _voxelFrameData;

  if (viewProj && viewProj.length >= 16) {
    data.set(viewProj, 0); // 0-15
  }
  if (view && view.length >= 16) {
    data.set(view, 16); // 16-31
  }
  if (proj && proj.length >= 16) {
    data.set(proj, 32); // 32-47
  }

  const cx = cameraPos && cameraPos.length >= 3 ? cameraPos[0] : 0;
  const cy = cameraPos && cameraPos.length >= 3 ? cameraPos[1] : 0;
  const cz = cameraPos && cameraPos.length >= 3 ? cameraPos[2] : 0;

  data[48] = cx;
  data[49] = cy;
  data[50] = cz;
  data[51] = typeof time === "number" ? time : 0;

  updateBuffer(device, frameBuffer, data, 0);
}
