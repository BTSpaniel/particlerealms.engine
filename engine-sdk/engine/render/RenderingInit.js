// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * RenderingInit.js - Consolidated rendering initialization helpers
 * 
 * Simplifies setup of particle systems and volumetric smoke.
 */

import { createParticleSimWorld } from "../sim/particles/ParticleSimWorld.js";
import { createParticleBillboardRenderer, createParticlePointRenderer, createParticleBillboardDataBindGroup, setParticleBillboardParams } from "./particles/ParticleBillboardRenderer.js";
import { createSmokeVolumeRenderer } from "./volumes/SmokeVolumeRenderer.js";
import { updateBuffer } from "../core/gpu/GpuBuffer.js";
import { setActiveParticlesState } from "../sim/particles/ParticlesStateRegistry.js";
import { DEFAULT_MAX_PARTICLES } from "../sim/particles/ParticleConfig.js";

/**
 * Initialize particle simulation and renderer.
 * @param {Object} options - Initialization options
 * @param {Object} options.gpuDevice - GPU device wrapper
 * @param {Object} options.device - Raw WebGPU device
 * @param {string} options.format - Surface format
 * @param {Object} options.particles - Particle state to populate
 * @param {number} options.maxParticles - Max particle count (default: 20000)
 * @param {number} options.workgroupSize - Compute workgroup size (default: 256)
 * @param {string} options.rendererType - Renderer type ('point'|'billboard')
 * @param {string} options.blendMode - Blend mode
 * @param {Function} options.logger - Optional logger
 */
export async function initParticleSystem(options) {
  const _initStart = performance.now();
  const {
    gpuDevice,
    device,
    format,
    particles,
    maxParticles = DEFAULT_MAX_PARTICLES,
    workgroupSize = 256,
    rendererType,
    blendMode,
    chunkCount,
    chunkSize,
    gpuOnly,
    skipRenderer,
    logger,
  } = options;

  const requestedChunkCountRaw =
    typeof chunkCount === "number" && Number.isFinite(chunkCount) ? chunkCount : 0;
  const requestedChunkCount = requestedChunkCountRaw | 0;
  const wantsChunks = requestedChunkCount > 1;

  if (wantsChunks) {
    particles.chunks = [];
    const desiredTotal = Math.max(1, maxParticles | 0);
    const desiredChunkSizeRaw =
      typeof chunkSize === "number" && Number.isFinite(chunkSize) && chunkSize > 0
        ? chunkSize
        : Math.ceil(desiredTotal / requestedChunkCount);
    const desiredChunkSize = Math.max(1, desiredChunkSizeRaw | 0);
    let remaining = desiredTotal;

    for (let ci = 0; ci < requestedChunkCount; ci++) {
      const desiredForChunk = ci === requestedChunkCount - 1
        ? remaining
        : Math.max(1, Math.min(desiredChunkSize, remaining));
      remaining -= desiredForChunk;

      const world = await createParticleSimWorld(gpuDevice, {
        maxParticles: desiredForChunk,
        workgroupSize,
      });

      particles.chunks.push({
        world,
        instanceCount: 0,
        activeInstanceCount: 0,
        dataBindGroup: null,
        attachmentBuffer: null,
      });
    }

    particles.world = particles.chunks[0] ? particles.chunks[0].world : null;
    particles.maxCount = 0;
    for (let i = 0; i < particles.chunks.length; i++) {
      const w = particles.chunks[i] && particles.chunks[i].world;
      particles.maxCount += w ? (w.maxParticles | 0) : 0;
    }
    particles.gpuOnly = true;
  } else {
    // Create particle simulation world
    const _worldStart = performance.now();
    particles.world = await createParticleSimWorld(gpuDevice, {
      maxParticles,
      workgroupSize,
    });
    console.log(`[RenderingInit] createParticleSimWorld took ${(performance.now() - _worldStart).toFixed(1)}ms`);
    particles.maxCount = particles.world.maxParticles | 0;
    particles.gpuOnly = !!gpuOnly;
  }

  setActiveParticlesState(particles);

  if (!particles.gpuOnly && !(particles.chunks && particles.chunks.length > 0)) {
    const _cpuStart = performance.now();
    particles.positions = new Float32Array(particles.maxCount * 4);
    particles.velocities = new Float32Array(particles.maxCount * 4);
    particles.collidersData = new Float32Array(particles.world.maxColliders * 8);

    particles.slotInfo = new Float32Array(particles.maxCount * 2);
    particles.freeSlots = [];
    particles.freeSlotsSet = new Set();
    particles.liveCount = 0;
    particles.deadCount = 0;
    particles.totalSpawned = 0;

    // Fast initialization using pattern copy (avoid 100k loop iterations)
    // Position pattern: [0, -1000, 0, 999] repeated
    const posPattern = new Float32Array([0.0, -1000.0, 0.0, 999.0]);
    for (let i = 0; i < particles.maxCount; i++) {
      particles.positions.set(posPattern, i * 4);
    }
    updateBuffer(device, particles.world.positionBuffer, particles.positions, 0);

    // Velocities: already zero-initialized by Float32Array constructor
    updateBuffer(device, particles.world.velocityBuffer, particles.velocities, 0);

    // Meta pattern: [1, 1, 1, 404000] repeated (size=4 encoded as 40 in 1e4 slot + renderMode=4 in 1e3 slot)
    particles.meta = new Float32Array(particles.maxCount * 4);
    const metaPattern = new Float32Array([1.0, 1.0, 1.0, 404000.0]);
    for (let i = 0; i < particles.maxCount; i++) {
      particles.meta.set(metaPattern, i * 4);
    }
    updateBuffer(device, particles.world.metaBuffer, particles.meta, 0);
    console.log(`[RenderingInit] CPU arrays init took ${(performance.now() - _cpuStart).toFixed(1)}ms for ${particles.maxCount} particles`);
  }

  // Skip renderer creation if caller will provide their own (e.g., SDF renderer)
  if (!skipRenderer) {
    const type = rendererType === 'point' ? 'point' : 'billboard';
    particles.rendererType = type;
    particles.verticesPerInstance = type === 'point' ? 6 : 6;

    particles.renderer = type === 'point'
      ? await createParticlePointRenderer({ device, format, blendMode })
      : await createParticleBillboardRenderer({ device, format, blendMode });
    particles.pipeline = particles.renderer.pipeline;
    particles.frameBuffer = particles.renderer.frameBuffer;
    particles.frameBindGroup = particles.renderer.frameBindGroup;

    if (particles.renderer && particles.renderer.albedoTextureView) {
      particles.albedoTextureView = particles.renderer.albedoTextureView;
    }
    if (particles.renderer && particles.renderer.albedoSampler) {
      particles.albedoSampler = particles.renderer.albedoSampler;
    }

    if (particles.chunks && particles.chunks.length > 0) {
      for (let ci = 0; ci < particles.chunks.length; ci++) {
        const chunk = particles.chunks[ci];
        if (!chunk || !chunk.world) continue;
        chunk.dataBindGroup = createParticleBillboardDataBindGroup(
          particles.renderer,
          chunk.world.positionBuffer,
          chunk.world.metaBuffer,
          chunk.world.velocityBuffer,
          chunk.world.uvBuffer,
          particles.albedoTextureView,
          particles.albedoSampler,
        );
      }
      particles.dataBindGroup = particles.chunks[0] ? particles.chunks[0].dataBindGroup : null;
    } else {
      particles.dataBindGroup = createParticleBillboardDataBindGroup(
        particles.renderer,
        particles.world.positionBuffer,
        particles.world.metaBuffer,      // Per-particle color and size
        particles.world.velocityBuffer,  // Per-particle velocity and lifetime
        particles.world.uvBuffer,
        particles.albedoTextureView,
        particles.albedoSampler,
      );
    }
    setParticleBillboardParams(particles.renderer, { size: 4, quality: 1.0, lodBias: 1.0, cullThreshold: 0 }); // Default fallback
  } else {
    particles.rendererType = 'custom';
    particles.verticesPerInstance = 6;
  }

  if (logger) {
    logger.info("[PARTICLES] GPU particle system initialized", { maxParticles: particles.maxCount });
  }

  return particles;
}

/**
 * Initialize volumetric smoke renderer (fluid sim is lazy).
 * @param {Object} options - Initialization options
 * @param {Object} options.device - Raw WebGPU device
 * @param {string} options.format - Surface format
 * @param {number} options.roomSize - Room size for volume bounds
 * @param {Object} options.smoke - Smoke state to populate
 * @param {Function} options.logger - Optional logger
 */
export async function initSmokeRenderer(options) {
  const { device, format, roomSize, smoke, logger } = options;

  const smokeRenderer = await createSmokeVolumeRenderer({
    device,
    format,
    roomSize,
    logger,
  });
  
  smoke.pipeline = smokeRenderer.pipeline;
  smoke.frameBuffer = smokeRenderer.frameBuffer;
  smoke.gridBuffer = smokeRenderer.gridBuffer;
  smoke.frameBindGroup = smokeRenderer.frameBindGroup;
  smoke.worldMin = smokeRenderer.volumeMin;
  smoke.worldMax = smokeRenderer.volumeMax;
  smoke.fluidWorld = null; // Lazy init when first emitter spawns

  if (logger) {
    logger.info("[SMOKE] Volumetric smoke pipeline initialized (fluid sim deferred)");
  }

  return smoke;
}

/**
 * Initialize particle system and optionally smoke renderer.
 * @param {Object} options - Combined options
 */
export async function initSimulationRendering(options) {
  const {
    gpuDevice,
    device,
    format,
    roomSize,
    particles,
    smoke, // Optional - only init smoke if provided
    maxParticles,
    workgroupSize,
    logger,
  } = options;

  await initParticleSystem({
    gpuDevice,
    device,
    format,
    particles,
    maxParticles,
    workgroupSize,
    logger,
  });

  // Only initialize smoke if smoke state is provided
  if (smoke) {
    await initSmokeRenderer({
      device,
      format,
      roomSize,
      smoke,
      logger,
    });
  }

  return { particles, smoke };
}
