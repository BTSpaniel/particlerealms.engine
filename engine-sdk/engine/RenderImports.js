// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// RenderImports: convenience barrel for render-related modules.
// Provides grouped namespaces and flat helpers for common rendering tasks.

import {
  Mesh,
  Geometry,
  Shaders,
  StandardRoom,
  VoxelWorld,
  StandardUniforms,
  StandardEntityRenderResources,
  SmokeVolumes,
  ParticleBillboards,
  ParticleQuality,
  SpectralRender,
} from "./EngineImports.js";

// Grouped namespaces
export const RenderMesh = Mesh;
export const RenderGeometry = Geometry;
export const RenderShaders = Shaders;
export const RenderRoom = StandardRoom;
export const RenderVoxelWorld = VoxelWorld;
export const RenderUniforms = StandardUniforms;
export const RenderEntityResources = StandardEntityRenderResources;
export const RenderSpectral = SpectralRender;

// Flat helpers
export const createUnitCubeMesh = Mesh.createUnitCubeMesh;
export const getVertexBufferLayoutForMesh = Mesh.getVertexBufferLayoutForMesh;
export const createEngineMesh = Mesh.createMesh;

export const createSkyboxGeometry = Geometry.createSkyboxGeometry;
export const createCubeGeometry = Geometry.createCubeGeometry;
export const createGroundGeometry = Geometry.createGroundGeometry;
export const createPlaneGeometry = Geometry.createPlaneGeometry;
export const createSphereGeometry = Geometry.createSphereGeometry;
export const createCylinderGeometry = Geometry.createCylinderGeometry;

export const createShaderLoader = Shaders.createShaderLoader;

export const createStandardRoomRenderer = StandardRoom.createStandardRoomRenderer;
export const createVoxelWorldRenderer = VoxelWorld.createVoxelWorldRenderer;
export const updateVoxelWorldFrameUniforms = VoxelWorld.updateVoxelWorldFrameUniforms;
export const updateStandardLights = StandardUniforms.updateStandardLights;
export const updateStandardUniforms = StandardUniforms.updateStandardUniforms;

export const createStandardEntityRenderResources =
  StandardEntityRenderResources.createStandardEntityRenderResources;

export const createSmokeVolumeRenderer = SmokeVolumes.createSmokeVolumeRenderer;

export const createParticleBillboardRenderer = ParticleBillboards.createParticleBillboardRenderer;
export const createParticleBillboardDataBindGroup = ParticleBillboards.createParticleBillboardDataBindGroup;
export const setParticleBillboardParams = ParticleBillboards.setParticleBillboardParams;

// Particle quality management
export const createParticleQualityManager = ParticleQuality.createParticleQualityManager;
export const PARTICLE_QUALITY_PRESETS = ParticleQuality.QUALITY_PRESETS;

export { IndexedClusterCuller } from "./render/IndexedClusterCuller.js";
export * from "./render/spectral/index.js";
