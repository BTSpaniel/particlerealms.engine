// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { initVGPU } from "../../core/gpu/VirtualGPU.js";
import { createShaderLoader } from "../shaders/ShaderLoader.js";
import {
  createUnitCubeMesh,
  getVertexBufferLayoutForMesh,
} from "../Mesh.js";
import {
  createSkyboxGeometry,
  createCubeGeometry,
  createPlaneGeometry,
  createSphereGeometry,
  createCylinderGeometry,
} from "../geometry/PrimitiveGeometry.js";
import {
  createUniformBuffer,
  createStorageBuffer,
} from "../../core/gpu/GpuBuffer.js";
import { buildStaticMeshFromGeometry } from "../geometry/StaticMeshBuilder.js";

export async function createStandardRoomRenderer(options) {
  const {
    device,
    format,
    roomSize,
    uniformBufferByteLength,
    lightsBufferByteLength,
    enableClusterCulling,
    entityCubeSize,
    logger,
  } = options || {};

  if (!device) {
    throw new Error("createStandardRoomRenderer: device is required");
  }
  if (!format) {
    throw new Error("createStandardRoomRenderer: format is required");
  }

  const size = Number.isFinite(roomSize) && roomSize > 0 ? roomSize : 50;
  const cubeSize = Number.isFinite(entityCubeSize) && entityCubeSize > 0
    ? entityCubeSize
    : 2;

  const shaderLoader = createShaderLoader({
    baseUrl: "../../engine/render/shaders",
  });
  const shaderCode = await shaderLoader.loadCore("standard");

  const vgpu = initVGPU(device);
  const ownedResources = [];
  const own = resource => {
    if (resource) ownedResources.push(resource);
    return resource;
  };

  try {
  const shaderModule = vgpu.shader.compile('standardRoom', shaderCode);

  // Create meshes for different object types
  const cubeMesh = own(cubeSize === 2
    ? createUnitCubeMesh(device, { label: "Phase3CubeMesh" })
    : buildStaticMeshFromGeometry(
      device,
      createCubeGeometry(cubeSize),
      "Phase3CubeMesh",
    ));

  // Create sphere mesh from geometry
  const sphereGeom = createSphereGeometry(0.5, 16, 12);
  const sphereMesh = own(buildStaticMeshFromGeometry(
    device,
    {
      positions: sphereGeom.positions,
      normals: sphereGeom.normals,
      indices: sphereGeom.indices,
    },
    "Phase3SphereMesh",
  ));

  // Create plane mesh from geometry
  const planeGeom = createPlaneGeometry(1);
  const planeMesh = own(buildStaticMeshFromGeometry(
    device,
    {
      positions: planeGeom.positions,
      normals: planeGeom.normals,
      indices: planeGeom.indices,
    },
    "Phase3PlaneMesh",
  ));

  // Create cylinder mesh from geometry (radius 0.5, height 1)
  const cylinderGeom = createCylinderGeometry(0.5, 1.0, 16, 1);
  const cylinderMesh = own(buildStaticMeshFromGeometry(
    device,
    {
      positions: cylinderGeom.positions,
      normals: cylinderGeom.normals,
      indices: cylinderGeom.indices,
    },
    "Phase3CylinderMesh",
  ));

  const vertexLayout = getVertexBufferLayoutForMesh(cubeMesh);

  // Define explicit bind group layout
  const bindGroupLayout = vgpu.bindings.defineLayout('standardRoom', [
    { binding: 0, type: 'uniform', visibility: 'vertex|fragment' },
    { binding: 1, type: 'read-storage', visibility: 'fragment' },
  ]);

  const renderPipeline = vgpu.pipeline.render({
    vertex: { module: shaderModule, entryPoint: 'vs_main' },
    fragment: { module: shaderModule, entryPoint: 'fs_main' },
    vertexLayout: [vertexLayout],
    layouts: [bindGroupLayout],
    colorFormat: format,
    blend: 'alpha',
    cullMode: 'none',
    depthFormat: 'depth24plus',
    depthWrite: true,
    depthCompare: 'less',
    topology: 'triangle-list',
    label: 'StandardRoomPipeline'
  });

  // Environment meshes: hollow box room from full skybox geometry
  const skyGeometry = createSkyboxGeometry(size);
  const skyIndices = skyGeometry.indices;

  const backIndices = skyIndices.slice(6, 12);
  const bottomIndices = skyIndices.slice(18, 24);
  const rightIndices = skyIndices.slice(24, 30);
  const leftIndices = skyIndices.slice(30, 36);

  // Three side walls: back, right, left (front is open like a window)
  const sideIndices = [].concat(backIndices, rightIndices, leftIndices);

  const roomWallsMesh = own(buildStaticMeshFromGeometry(
    device,
    {
      positions: skyGeometry.positions,
      normals: skyGeometry.normals,
      indices: sideIndices,
    },
    "Phase3RoomWalls",
    { enableClusterCulling: !!enableClusterCulling },
  ));

  // Bottom face (floor)
  const roomFloorMesh = own(buildStaticMeshFromGeometry(
    device,
    {
      positions: skyGeometry.positions,
      normals: skyGeometry.normals,
      indices: bottomIndices,
    },
    "Phase3RoomFloor",
    { enableClusterCulling: !!enableClusterCulling },
  ));

  // Top face (ceiling) disabled so we can see in from above
  const roomCeilingMesh = null;

  // Dummy lights buffer (required by shader but will be empty)
  const lightsBuffer = own(vgpu.buffer.create({ size: lightsBufferByteLength, usage: 'storage', label: 'StandardRoomLights' }).buffer);

  const cubeUniformBuffer = own(vgpu.buffer.create({ size: uniformBufferByteLength, usage: 'uniform', label: 'CubeUniforms' }).buffer);
  const floorUniformBuffer = own(vgpu.buffer.create({ size: uniformBufferByteLength, usage: 'uniform', label: 'FloorUniforms' }).buffer);
  const wallsUniformBuffer = own(vgpu.buffer.create({ size: uniformBufferByteLength, usage: 'uniform', label: 'WallsUniforms' }).buffer);
  const ceilingUniformBuffer = own(vgpu.buffer.create({ size: uniformBufferByteLength, usage: 'uniform', label: 'CeilingUniforms' }).buffer);
  const ghostUniformBuffer = own(vgpu.buffer.create({ size: uniformBufferByteLength, usage: 'uniform', label: 'GhostUniforms' }).buffer);

  const cubeBindGroup = vgpu.bindings.createGroup(bindGroupLayout, [
    { binding: 0, buffer: cubeUniformBuffer },
    { binding: 1, buffer: lightsBuffer },
  ]);

  const ceilingBindGroup = vgpu.bindings.createGroup(bindGroupLayout, [
    { binding: 0, buffer: ceilingUniformBuffer },
    { binding: 1, buffer: lightsBuffer },
  ]);

  const floorBindGroup = vgpu.bindings.createGroup(bindGroupLayout, [
    { binding: 0, buffer: floorUniformBuffer },
    { binding: 1, buffer: lightsBuffer },
  ]);

  const wallsBindGroup = vgpu.bindings.createGroup(bindGroupLayout, [
    { binding: 0, buffer: wallsUniformBuffer },
    { binding: 1, buffer: lightsBuffer },
  ]);

  const ghostBindGroup = vgpu.bindings.createGroup(bindGroupLayout, [
    { binding: 0, buffer: ghostUniformBuffer },
    { binding: 1, buffer: lightsBuffer },
  ]);

  if (logger && typeof logger.info === "function") {
    logger.info("Shader module and pipeline created from engine standard.wgsl");
  }

  return {
    shaderModule,
    renderPipeline,
    cubeMesh,
    sphereMesh,
    planeMesh,
    cylinderMesh,
    roomWallsMesh,
    roomFloorMesh,
    roomCeilingMesh,
    lightsBuffer,
    cubeUniformBuffer,
    floorUniformBuffer,
    wallsUniformBuffer,
    ceilingUniformBuffer,
    ghostUniformBuffer,
    cubeBindGroup,
    floorBindGroup,
    wallsBindGroup,
    ceilingBindGroup,
    ghostBindGroup,
  };
  } catch (error) {
    const cleanupErrors = [];
    for (const resource of ownedResources.reverse()) {
      try { resource.destroy?.(); }
      catch (cleanupError) { cleanupErrors.push(cleanupError); }
    }
    if (cleanupErrors.length) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        'createStandardRoomRenderer allocation and rollback both failed',
      );
    }
    throw error;
  }
}
