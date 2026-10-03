// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SimulationUpdate.js - Unified simulation stepping for particles and fluids
 * 
 * Combines particle emission, collision detection, particle physics,
 * and fluid simulation into a single update call.
 */

import { stepEmitters, buildColliderBuffer, buildFluidSources, updateParticleCounts } from "./particles/ParticleEmitterSystem.js";
import { stepAdvancedSystems, stepParticleSimWorld } from "./particles/ParticleSimWorld.js";
import { createVoxelMeshCollider, meshToTriangleBuffer, computeMeshBounds } from "./physics/VoxelMeshCollision.js";
import { stepFluidSimWorld, clearFluidSimWorld, clearFluidDensity } from "./fluids/FluidSimWorld.js";
import { splatFluidSources, splatParticleDensity } from "./fluids/FluidSourceSplat.js";
import { stepCrystallization, applyPhaseVisuals, stepCrystalSystem } from "./fluids/FluidPhaseChange.js";
import { createQuery, forEachEntity } from "../ecs/query/Query.js";

const FLUID_DOMAIN_FALLBACK_HALF = 25;

let _fluidDomainQuery = null;
let _voxelCollider = null;
let _voxelColliderDevice = null;

function getFluidDomainQuery() {
  if (!_fluidDomainQuery) {
    _fluidDomainQuery = createQuery({
      name: "FluidDomainQuery",
      all: ["Transform", "PhysicsBody", "Collider"],
    });
  }
  return _fluidDomainQuery;
}

function computeFluidDomainFromColliders(ecsWorld, fallbackHalfSize) {
  const half =
    typeof fallbackHalfSize === "number" && Number.isFinite(fallbackHalfSize) && fallbackHalfSize > 0
      ? fallbackHalfSize
      : FLUID_DOMAIN_FALLBACK_HALF;

  if (!ecsWorld) {
    return {
      min: [-half, -half, -half],
      max: [half, half, half],
    };
  }

  const query = getFluidDomainQuery();

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let found = false;

  forEachEntity(ecsWorld, query, (entityId, get) => {
    const body = get("PhysicsBody");
    const collider = get("Collider");
    const transform = get("Transform");
    if (!body || !collider || !transform) {
      return;
    }

    const mode = body.simMode;
    if (mode !== "static" && mode !== "kinematic") {
      return;
    }

    const pos = Array.isArray(transform.position) ? transform.position : [0, 0, 0];
    const scale = Array.isArray(transform.scale) ? transform.scale : [1, 1, 1];

    const shape = collider.shape || "box";
    let hx = 0.5;
    let hy = 0.5;
    let hz = 0.5;

    if (shape === "sphere") {
      const rValue = Number(collider.radius);
      const r = Number.isFinite(rValue) && rValue > 0 ? rValue : 0.5;
      hx = r;
      hy = r;
      hz = r;
    } else if (shape === "capsule") {
      const rValue = Number(collider.radius);
      const hValue = Number(collider.halfHeight);
      const r = Number.isFinite(rValue) && rValue > 0 ? rValue : 0.5;
      const h = Number.isFinite(hValue) && hValue > 0 ? hValue : 0.5;
      hx = r;
      hz = r;
      hy = h + r;
    } else {
      const he = Array.isArray(collider.halfExtents) ? collider.halfExtents : null;
      const hxRaw = he && Number.isFinite(he[0]) ? Math.abs(he[0]) : 0.5;
      const hyRaw = he && Number.isFinite(he[1]) ? Math.abs(he[1]) : 0.5;
      const hzRaw = he && Number.isFinite(he[2]) ? Math.abs(he[2]) : 0.5;
      hx = hxRaw;
      hy = hyRaw;
      hz = hzRaw;
    }

    const sx = Number(scale[0]);
    const sy = Number(scale[1]);
    const sz = Number(scale[2]);
    if (Number.isFinite(sx) && sx !== 0) hx *= Math.abs(sx);
    if (Number.isFinite(sy) && sy !== 0) hy *= Math.abs(sy);
    if (Number.isFinite(sz) && sz !== 0) hz *= Math.abs(sz);

    const px = Number(pos[0]) || 0;
    const py = Number(pos[1]) || 0;
    const pz = Number(pos[2]) || 0;

    const loX = px - hx;
    const loY = py - hy;
    const loZ = pz - hz;
    const hiX = px + hx;
    const hiY = py + hy;
    const hiZ = pz + hz;

    if (loX < minX) minX = loX;
    if (loY < minY) minY = loY;
    if (loZ < minZ) minZ = loZ;
    if (hiX > maxX) maxX = hiX;
    if (hiY > maxY) maxY = hiY;
    if (hiZ > maxZ) maxZ = hiZ;

    found = true;
  });

  if (!found || !Number.isFinite(minX) || !Number.isFinite(maxX)) {
    return {
      min: [-half, -half, -half],
      max: [half, half, half],
    };
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}

/**
 * Get or create the voxel mesh collider singleton
 * @param {GPUDevice} device
 * @returns {Promise<VoxelMeshCollider>}
 */
async function getVoxelCollider(device) {
  if (!device) return null;
  if (_voxelCollider && _voxelColliderDevice === device) {
    return _voxelCollider;
  }
  _voxelCollider = createVoxelMeshCollider(device, { gridDims: 64 });
  await _voxelCollider.initialize();
  _voxelColliderDevice = device;
  return _voxelCollider;
}

/**
 * Voxelize mesh colliders from entities for particle collision
 * @param {Object} voxelCollider - VoxelMeshCollider instance
 * @param {Array} entities - Array of entities with mesh colliders
 * @param {Function} getMesh - Function to get mesh data for entity
 * @returns {Object|null} voxelInfo for collision
 */
function voxelizeMeshColliders(voxelCollider, entities, getMesh) {
  if (!voxelCollider || !entities || entities.length === 0 || !getMesh) {
    return null;
  }
  
  // Collect all triangles from mesh colliders
  let allTriangles = [];
  let globalMin = [Infinity, Infinity, Infinity];
  let globalMax = [-Infinity, -Infinity, -Infinity];
  
  for (const entity of entities) {
    const meshData = getMesh(entity);
    if (!meshData || !meshData.vertices || !meshData.indices) continue;
    
    const transform = entity.transform || { position: [0, 0, 0], scale: [1, 1, 1] };
    const pos = transform.position || [0, 0, 0];
    const scale = transform.scale || [1, 1, 1];
    
    // Transform vertices
    const verts = meshData.vertices;
    const transformedVerts = new Float32Array(verts.length);
    for (let i = 0; i < verts.length; i += 3) {
      const x = verts[i] * scale[0] + pos[0];
      const y = verts[i + 1] * scale[1] + pos[1];
      const z = verts[i + 2] * scale[2] + pos[2];
      transformedVerts[i] = x;
      transformedVerts[i + 1] = y;
      transformedVerts[i + 2] = z;
      
      globalMin[0] = Math.min(globalMin[0], x);
      globalMin[1] = Math.min(globalMin[1], y);
      globalMin[2] = Math.min(globalMin[2], z);
      globalMax[0] = Math.max(globalMax[0], x);
      globalMax[1] = Math.max(globalMax[1], y);
      globalMax[2] = Math.max(globalMax[2], z);
    }
    
    const triangleData = meshToTriangleBuffer(transformedVerts, meshData.indices);
    allTriangles.push(triangleData);
  }
  
  if (allTriangles.length === 0) return null;
  
  // Merge all triangles
  const totalLength = allTriangles.reduce((sum, arr) => sum + arr.length, 0);
  const mergedTriangles = new Float32Array(totalLength);
  let offset = 0;
  for (const arr of allTriangles) {
    mergedTriangles.set(arr, offset);
    offset += arr.length;
  }
  
  // Add padding to bounds
  const pad = 0.5;
  const bounds = {
    min: [globalMin[0] - pad, globalMin[1] - pad, globalMin[2] - pad],
    max: [globalMax[0] + pad, globalMax[1] + pad, globalMax[2] + pad],
  };
  
  return voxelCollider.voxelizeMesh(mergedTriangles, bounds, 'frame_meshes');
}

function computeFluidInfluenceFromSources(sources, defaultInfluence) {
  const base =
    typeof defaultInfluence === "number" && Number.isFinite(defaultInfluence)
      ? defaultInfluence
      : 2.0;

  if (!Array.isArray(sources) || sources.length === 0) {
    return base;
  }

  let totalStrength = 0;
  let weightedStrength = 0;

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    if (!src) continue;
    const strengthVal = Number(src.strength);
    if (!Number.isFinite(strengthVal) || strengthVal <= 0) continue;

    totalStrength += strengthVal;

    const elemId = typeof src.element === "string" ? src.element : "";
    let weight = 0.25; // generic / weak coupling
    if (elemId === "water") {
      weight = 1.0;
    } else if (elemId === "smoke") {
      weight = 0.8;
    } else if (elemId === "magic") {
      weight = 0.5;
    } else if (elemId === "fire") {
      weight = 0.3;
    }

    weightedStrength += strengthVal * weight;
  }

  if (totalStrength <= 0) {
    return base;
  }

  const ratio = weightedStrength / totalStrength; // 0..1
  const minInfluence = 0.1;
  const maxInfluence = 4.0;
  const influence = minInfluence + (maxInfluence - minInfluence) * ratio;
  return influence;
}

/**
 * Step the particle simulation (emission, colliders, physics).
 * @param {Object} particles - Particle state object
 * @param {Object} options - Configuration options
 * @param {number} options.delta - Time delta
 * @param {Array} options.entities - Spawned entities for collision
 * @param {Function} options.getTransform - Function to get entity transform
 * @param {Object} options.physics - Physics state { gravity, gravityScale }
 * @param {number} options.roomHalfSize - Half size of room for bounds
 * @param {number} [options.fluidInfluence] - Strength of particle coupling to fluid
 * @returns {Object} Updated particle state info
 */
export function stepParticles(particles, options) {
  const { delta, entities, getTransform, physics, roomHalfSize, fluidInfluence, quality, logger } = options;
  
  if (!particles.world) return { emitted: 0, colliderCount: 0 };
  
  let emitted = 0;
  const emitterCount = particles.emitters ? particles.emitters.length : 0;
  // Optional debug logging removed by default to avoid per-frame spam.
  
  const currentTime = performance.now() * 0.001;
  
  // 1. Emit new particles from emitters (with slot reuse)
  // Quality affects emission rate - when FPS drops, emit fewer particles
  if (particles.emitters.length > 0 && particles.maxCount > 0) {
    const freeBefore = particles.freeSlots ? particles.freeSlots.length : 0;
    emitted = stepEmitters(particles.emitters, particles.world, delta, {
      positions: particles.positions,
      velocities: particles.velocities,
      maxParticles: particles.maxCount,
      currentCount: particles.instanceCount,
      currentTime,
      slotInfo: particles.slotInfo,
      freeSlots: particles.freeSlots,
      freeSlotsSet: particles.freeSlotsSet,
      quality,  // Pass quality for emission throttling
      logger,
    });
    if (emitted > 0) {
      // Only increase instance count if we didn't reuse all slots
      const freeAfter = particles.freeSlots ? particles.freeSlots.length : 0;
      const reusedCount = Math.max(0, freeBefore - freeAfter);
      const appendedCount = Math.max(0, emitted - reusedCount);
      particles.instanceCount = Math.min(particles.maxCount, particles.instanceCount + appendedCount);
      particles.totalSpawned = (particles.totalSpawned || 0) + emitted;
    }
  }
  
  // Update live/dead counts periodically (every ~0.5s to avoid overhead)
  if (particles.slotInfo && (!particles._lastCountUpdate || currentTime - particles._lastCountUpdate > 0.5)) {
    updateParticleCounts(particles, currentTime);
    particles._lastCountUpdate = currentTime;
  }
  
  // 2. Build collider buffer from entities
  const colliderCount = buildColliderBuffer(particles.world, entities, {
    getTransform,
    colliderData: particles.collidersData,
  });
  
  // 3. Step particle physics
  if (particles.instanceCount > 0) {
    const gravityY = Array.isArray(physics.gravity)
      ? physics.gravity[1] * physics.gravityScale
      : -9.81 * physics.gravityScale;
    
    stepParticleSimWorld(particles.world, delta, {
      particleCount: particles.instanceCount,
      roomHalfSize,
      gravityY,
      colliderCount,
      fluidInfluence,
    });
  }

  stepAdvancedSystems(particles.world, delta, {
    particleCount: particles.instanceCount,
  });
  // Optional debug logging removed by default to avoid per-frame spam.
  
  return { emitted, colliderCount };
}

/**
 * Step the fluid simulation (density splatting, advection).
 * @param {Object} smoke - Smoke/fluid state object
 * @param {Object} particles - Particle state for emitter sources
 * @param {Object} gpuDevice - GPU device wrapper
 * @param {number} delta - Time delta
 * @param {Object} options - Additional options
 * @param {number} options.splatIntervalMs - Minimum ms between splats (default 200)
 * @param {number} options.warmupMs - Warmup delay before splatting (default 2000)
 * @param {Function} options.onError - Error callback
 * @param {number} options.roomHalfSize - Room bounds for clamping volume
 * @param {number} options.currentFps - Approximate current FPS
 * @param {number} options.minFpsForSplats - Minimum FPS for splats (default 0)
 * @param {number} options.boundsSmoothing - Bounds smoothing factor [0,1] (default 0.2)
 * @param {Object} options.logger - Optional debug logger
 * @param {boolean} options.debugLogSources - Optional debug log sources
 * @param {number} options.debugMaxSources - Optional debug max sources
 * @param {Array} [options.sources] - Optional precomputed fluid sources
 * @returns {boolean} Whether fluid was stepped
 */
export function stepFluid(smoke, particles, gpuDevice, delta, options = {}) {
  const {
    splatIntervalMs = 200,
    warmupMs = 2000,
    onError = null,
    roomHalfSize = null,
    domainMin = null,
    domainMax = null,
    currentFps = 0,
    minFpsForSplats = 0,
    boundsSmoothing = 0.2,
    logger = null,
    debugLogSources = false,
    debugMaxSources = 4,
    sources: precomputedSources = null,
  } = options;
  
  // Skip if smoke is not configured or no emitters
  if (!smoke || !smoke.fluidWorld || !particles.emitters || particles.emitters.length === 0) {
    return false;
  }
  
  const warmupReady = smoke.simStartTime && (performance.now() - smoke.simStartTime >= warmupMs);
  if (!warmupReady) {
    return false;
  }
  
  const now = performance.now();
  const timeReady = !smoke.lastSplatTime || (now - smoke.lastSplatTime >= splatIntervalMs);
  const fpsReady = !(minFpsForSplats > 0 && currentFps > 0 && currentFps < minFpsForSplats);
  const shouldSplat = timeReady && fpsReady;
  
  if (shouldSplat) {
    const sources = Array.isArray(precomputedSources)
      ? precomputedSources
      : buildFluidSources(particles.emitters);
    if (sources.length > 0) {
      smoke.lastSplatTime = now;
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      let maxRadius = 0;
      for (let i = 0; i < sources.length; i++) {
        const src = sources[i];
        if (!src || !Array.isArray(src.position) || src.position.length < 3) continue;
        const pos = src.position;
        const radius = Number(src.radius) || 0;
        const r = radius > 0 ? radius : 0;
        const px = Number(pos[0]) || 0;
        const py = Number(pos[1]) || 0;
        const pz = Number(pos[2]) || 0;
        if (px - r < minX) minX = px - r;
        if (py - r < minY) minY = py - r;
        if (pz - r < minZ) minZ = pz - r;
        if (px + r > maxX) maxX = px + r;
        if (py + r > maxY) maxY = py + r;
        if (pz + r > maxZ) maxZ = pz + r;
        if (r > maxRadius) maxRadius = r;
      }
      let halfSize = null;
      if (Number.isFinite(roomHalfSize) && roomHalfSize > 0) {
        halfSize = roomHalfSize;
      }
      if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
        const fallbackHalf = halfSize && halfSize > 0 ? halfSize : 25;
        minX = -fallbackHalf; minY = -fallbackHalf; minZ = -fallbackHalf;
        maxX = fallbackHalf; maxY = fallbackHalf; maxZ = fallbackHalf;
      } else {
        let margin = maxRadius > 0 ? maxRadius : 2.0;
        if (!Number.isFinite(margin) || margin <= 0) {
          margin = 2.0;
        }
        const maxMargin = halfSize && halfSize > 0 ? halfSize : 25;
        if (margin > maxMargin) margin = maxMargin;
        minX -= margin; minY -= margin; minZ -= margin;
        maxX += margin; maxY += margin; maxZ += margin;
      }
      if (Array.isArray(domainMin) && domainMin.length >= 3 &&
          Array.isArray(domainMax) && domainMax.length >= 3) {
        const dMinX = Number(domainMin[0]);
        const dMinY = Number(domainMin[1]);
        const dMinZ = Number(domainMin[2]);
        const dMaxX = Number(domainMax[0]);
        const dMaxY = Number(domainMax[1]);
        const dMaxZ = Number(domainMax[2]);
        if (Number.isFinite(dMinX) && Number.isFinite(dMaxX)) {
          if (minX < dMinX) minX = dMinX;
          if (maxX > dMaxX) maxX = dMaxX;
        }
        if (Number.isFinite(dMinY) && Number.isFinite(dMaxY)) {
          if (minY < dMinY) minY = dMinY;
          if (maxY > dMaxY) maxY = dMaxY;
        }
        if (Number.isFinite(dMinZ) && Number.isFinite(dMaxZ)) {
          if (minZ < dMinZ) minZ = dMinZ;
          if (maxZ > dMaxZ) maxZ = dMaxZ;
        }
      } else if (halfSize && halfSize > 0) {
        const lo = -halfSize;
        const hi = halfSize;
        if (minX < lo) minX = lo;
        if (minY < lo) minY = lo;
        if (minZ < lo) minZ = lo;
        if (maxX > hi) maxX = hi;
        if (maxY > hi) maxY = hi;
        if (maxZ > hi) maxZ = hi;
      }
      const hadEmitterBounds = !!smoke._hasEmitterBounds;
      let newMin = [minX, minY, minZ];
      let newMax = [maxX, maxY, maxZ];
      const canSmooth =
        hadEmitterBounds &&
        boundsSmoothing > 0 && boundsSmoothing < 1 &&
        Array.isArray(smoke.worldMin) && smoke.worldMin.length >= 3 &&
        Array.isArray(smoke.worldMax) && smoke.worldMax.length >= 3;
      if (canSmooth) {
        const t = boundsSmoothing;
        newMin = [
          smoke.worldMin[0] + (newMin[0] - smoke.worldMin[0]) * t,
          smoke.worldMin[1] + (newMin[1] - smoke.worldMin[1]) * t,
          smoke.worldMin[2] + (newMin[2] - smoke.worldMin[2]) * t,
        ];
        newMax = [
          smoke.worldMax[0] + (newMax[0] - smoke.worldMax[0]) * t,
          smoke.worldMax[1] + (newMax[1] - smoke.worldMax[1]) * t,
          smoke.worldMax[2] + (newMax[2] - smoke.worldMax[2]) * t,
        ];
      } else if (!hadEmitterBounds) {
        // First emitter bounds - clear the grid to prevent stale data from
        // appearing at wrong world-space locations with the new bounds
        clearFluidSimWorld(smoke.fluidWorld);
      }
      smoke.worldMin = newMin;
      smoke.worldMax = newMax;
      smoke._hasEmitterBounds = true;
      if (particles && particles.world) {
        particles.world.fluidWorldMin = smoke.worldMin;
        particles.world.fluidWorldMax = smoke.worldMax;
      }
      if (logger) {
        const payload = {
          sourceCount: sources.length,
          worldMin: smoke.worldMin,
          worldMax: smoke.worldMax,
          domainMin: Array.isArray(domainMin) ? domainMin : null,
          domainMax: Array.isArray(domainMax) ? domainMax : null,
          roomHalfSize,
          currentFps,
        };
        if (typeof logger.addSnapshot === "function") {
          logger.addSnapshot("FLUID.Splat", payload);
        }
        if (debugLogSources && typeof logger.info === "function") {
          const maxLog = debugMaxSources && debugMaxSources > 0
            ? debugMaxSources | 0
            : 4;
          for (let i = 0; i < sources.length && i < maxLog; i++) {
            const s = sources[i];
            if (!s || !Array.isArray(s.position) || s.position.length < 3) continue;
            logger.info("[FLUID] Source", {
              index: i,
              position: s.position,
              radius: s.radius,
              strength: s.strength,
              element: s.element,
            });
          }
        }
      }
      // Only splat at emitter if NOT using particle-based splatting
      // When particleSplat is enabled, smoke follows particles, not emitters
      const useEmitterSplat = options.emitterSplat === true; // Disabled by default now
      if (useEmitterSplat) {
        splatFluidSources(smoke.fluidWorld, gpuDevice, {
          sources,
          worldMin: smoke.worldMin,
          worldMax: smoke.worldMax,
          logger,
        }).catch(error => {
          if (onError) onError(error);
        });
      }
    }
  }
  
  // ==========================================================================
  // PARTICLES AS SMOKE (each particle IS the smoke)
  // ==========================================================================
  // Each particle splats density at its position, inheriting:
  //   - Position → where the smoke blob appears
  //   - Size → splat radius (from particle meta.a)
  //   - Color → smoke color (from particle meta.rgb)
  //   - Age/Lifetime → fade behavior
  // When particles overlap, their density merges → smooth fluid blobs
  // The emitter shoots particles - the particles ARE the smoke
  // 
  // CRITICAL: In this mode, we do NOT run fluid simulation!
  // The density is cleared and re-splatted each frame from particle positions.
  // Particles control ALL movement - no fluid advection.
  const useParticleSplat = options.particleSplat !== false; // Enabled by default
  const activeParticleCount = particles && typeof particles.instanceCount === "number"
    ? particles.instanceCount
    : 0;
  
  if (useParticleSplat && activeParticleCount > 0 && particles.world && smoke.fluidWorld) {
    // For particle-as-smoke, use FULL room bounds (not tight emitter bounds)
    // since particles travel throughout the entire space
    const halfSize = roomHalfSize && roomHalfSize > 0 ? roomHalfSize : 25;
    const particleWorldMin = [-halfSize, -halfSize, -halfSize];
    const particleWorldMax = [halfSize, halfSize, halfSize];
    
    // Update smoke bounds to cover full room for particles
    smoke.worldMin = particleWorldMin;
    smoke.worldMax = particleWorldMax;
    if (particles.world) {
      particles.world.fluidWorldMin = particleWorldMin;
      particles.world.fluidWorldMax = particleWorldMax;
    }
    
    const device = smoke.fluidWorld.device;
    const encoder = device.createCommandEncoder({ label: "ParticleAsSmoke.frame" });

    clearFluidDensity(smoke.fluidWorld, { encoder });
    
    // radiusScale: base world-space radius for each particle's splat (in world units)
    // Higher = particles merge together more when close (better for piling/collecting)
    // densityScale: opacity/density per particle (higher = more opaque smoke)
    const radiusScale = options.particleRadiusScale || 2.0;  // 2 world units base radius
    const densityScale = options.particleDensityScale || 0.8;
    
    splatParticleDensity(smoke.fluidWorld, particles.world, {
      particleCount: activeParticleCount,
      worldMin: particleWorldMin,
      worldMax: particleWorldMax,
      radiusScale,
      densityScale,
      encoder,
      logger,
    });

    device.queue.submit([encoder.finish()]);
    
    // Skip fluid simulation - particles control movement, not fluid dynamics
    return true;
  }
  
  // Only run fluid simulation if NOT using particle-as-smoke mode
  stepFluidSimWorld(smoke.fluidWorld, delta);
  return true;
}

/**
 * Step all simulations in one call.
 * @param {Object} state - Combined state { particles, smoke, gpu, physics, config, ecs }
 * @param {number} delta - Time delta
 * @param {Array} entities - Spawned entities
 * @param {Object} options - Additional options
 */
export function stepAllSimulations(state, delta, entities, options = {}) {
  const { particles, smoke, gpu, physics, config, ecs } = state;
  const { onError, logger } = options;
  const simTimeScale =
    config && typeof config.simTimeScale === "number" && Number.isFinite(config.simTimeScale)
      ? config.simTimeScale
      : 1.0;
  const simDelta = delta * simTimeScale;
  const frameFps = delta > 0 ? 1.0 / delta : 0;
  const configRoomHalfSize = config && Number.isFinite(config.roomSize)
    ? config.roomSize * 0.5
    : null;

  let colliderDomain = null;
  if (ecs && ecs.world) {
    colliderDomain = computeFluidDomainFromColliders(
      ecs.world,
      configRoomHalfSize != null ? configRoomHalfSize : FLUID_DOMAIN_FALLBACK_HALF,
    );
  }

  let roomHalfSize = configRoomHalfSize;
  if ((!Number.isFinite(roomHalfSize) || roomHalfSize <= 0) && colliderDomain) {
    const dMin = colliderDomain.min;
    const dMax = colliderDomain.max;
    if (Array.isArray(dMin) && Array.isArray(dMax) && dMin.length >= 3 && dMax.length >= 3) {
      const hx = Math.max(Math.abs(Number(dMin[0]) || 0), Math.abs(Number(dMax[0]) || 0));
      const hy = Math.max(Math.abs(Number(dMin[1]) || 0), Math.abs(Number(dMax[1]) || 0));
      const hz = Math.max(Math.abs(Number(dMin[2]) || 0), Math.abs(Number(dMax[2]) || 0));
      const maxHalf = Math.max(hx, hy, hz);
      if (Number.isFinite(maxHalf) && maxHalf > 0) {
        roomHalfSize = maxHalf;
      }
    }
  }
  if (!Number.isFinite(roomHalfSize) || roomHalfSize <= 0) {
    roomHalfSize = FLUID_DOMAIN_FALLBACK_HALF;
  }
 
  // Build fluid sources once per frame (if we have emitters) so particles and
  // fluid share the same source data and we can derive a meaningful
  // fluidInfluence factor based on element mix.
  let sharedSources = null;
  let fluidInfluence = undefined;
  if (particles && Array.isArray(particles.emitters) && particles.emitters.length > 0) {
    sharedSources = buildFluidSources(particles.emitters);
    fluidInfluence = computeFluidInfluenceFromSources(sharedSources, undefined);
    // Track source count for inspector
    if (smoke) {
      smoke._lastSourceCount = sharedSources ? sharedSources.length : 0;
    }
  }
  
  // Step particles (if configured)
  let particleResult = { emitted: 0, colliderCount: 0 };
  if (particles) {
    // Pass quality for emission throttling (0-1, default 1.0)
    const quality = typeof options.quality === "number" ? options.quality : 1.0;
    
    particleResult = stepParticles(particles, {
      delta: simDelta,
      entities,
      getTransform: options.getTransform || ((id) => null),
      physics,
      roomHalfSize,
      fluidInfluence,
      quality,  // For emission throttling when FPS drops
      logger,
    });
  }
  
  // Step fluid (if smoke is configured)
  let fluidStepped = false;
  if (smoke && gpu?.device) {
    const fluidCfg = config && config.fluid ? config.fluid : null;
    fluidStepped = stepFluid(smoke, particles, gpu.device, simDelta, {
      onError,
      roomHalfSize,
      domainMin: colliderDomain ? colliderDomain.min : null,
      domainMax: colliderDomain ? colliderDomain.max : null,
      currentFps: frameFps,
      splatIntervalMs: fluidCfg && Number.isFinite(fluidCfg.splatIntervalMs)
        ? fluidCfg.splatIntervalMs
        : undefined,
      warmupMs: fluidCfg && Number.isFinite(fluidCfg.warmupMs)
        ? fluidCfg.warmupMs
        : undefined,
      boundsSmoothing: fluidCfg && Number.isFinite(fluidCfg.boundsSmoothing)
        ? fluidCfg.boundsSmoothing
        : undefined,
      minFpsForSplats: fluidCfg && Number.isFinite(fluidCfg.minFpsForSplats)
        ? fluidCfg.minFpsForSplats
        : undefined,
      logger,
      debugLogSources: !!(fluidCfg && fluidCfg.debugLogSources),
      debugMaxSources: fluidCfg && Number.isFinite(fluidCfg.debugMaxSources)
        ? fluidCfg.debugMaxSources
        : undefined,
      sources: sharedSources,
    });
  }
  
  // Step phase change / crystallization if enabled
  let crystallizationStepped = false;
  const phaseChange = state.phaseChange;
  if (phaseChange && phaseChange.buffers && particles && particles.world && gpu?.device) {
    const device = gpu.device && typeof gpu.device.getDevice === "function"
      ? gpu.device.getDevice()
      : gpu.device;
    const particleWorld = particles.world;

    // Collider data for solid collisions
    const colliderData = {
      buffer: particleWorld.colliderBuffer,
      count: particleResult.colliderCount || 0,
    };

    // Room/world bounds for solid collision
    const roomBounds = colliderDomain && Array.isArray(colliderDomain.min) && Array.isArray(colliderDomain.max)
      ? { min: colliderDomain.min, max: colliderDomain.max }
      : {
          min: [-roomHalfSize, -roomHalfSize, -roomHalfSize],
          max: [roomHalfSize, roomHalfSize, roomHalfSize],
        };

    // Prefer full crystal system (solid collision + bonds) if available
    if (phaseChange.systems) {
      const crystalOptions = {
        ...(phaseChange.options || {}),
        ...(phaseChange.visualOptions || {}),
      };

      stepCrystalSystem(
        device,
        phaseChange.systems,
        phaseChange.buffers,
        particleWorld,
        colliderData,
        roomBounds,
        simDelta,
        crystalOptions,
      );

      crystallizationStepped = true;
    } else if (phaseChange.crystallization) {
      // Backwards-compatible path: only crystallization + visuals
      stepCrystallization(
        device,
        phaseChange.crystallization,
        phaseChange.buffers,
        particleWorld,
        simDelta,
        phaseChange.options || {},
      );

      applyPhaseVisuals(
        device,
        phaseChange.buffers,
        particleWorld,
        phaseChange.visualOptions || {},
      );

      crystallizationStepped = true;
    }
  }
  
  return {
    particlesEmitted: particleResult.emitted,
    colliderCount: particleResult.colliderCount,
    fluidStepped,
    crystallizationStepped,
  };
}
