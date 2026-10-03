// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleAttributeReader.js - Cross-Emitter Attribute Reader (GAP 21)
 * 
 * Allows one emitter to read particle data from another emitter's buffers.
 * Enables leader-follower, flocking, synchronized multi-layer effects.
 * 
 * Matches Niagara's Particle Attribute Reader data interface.
 * 
 * Two modes:
 *   1. Direct index: read specific particle by index (leader-follower)
 *   2. Nearest query: find closest particle to a given position (via spatial grid)
 * 
 * Usage:
 *   const reader = createAttributeReader(sourceWorld);
 *   // In consumer emitter logic:
 *   const pos = readParticlePosition(reader, particleIndex);
 *   const vel = readParticleVelocity(reader, particleIndex);
 *   const nearest = findNearestParticle(reader, queryPos);
 */

/**
 * Create an attribute reader bound to a source particle world.
 * @param {Object} sourceWorld - Source particle world to read from
 * @param {Object} options - { enableSpatialQuery }
 */
export function createAttributeReader(sourceWorld, options = {}) {
  if (!sourceWorld) throw new Error('createAttributeReader: sourceWorld required');

  return {
    source: sourceWorld,
    _posCache: null,
    _velCache: null,
    _metaCache: null,
    _thermalCache: null,
    _cacheFrame: -1,
    enableSpatialQuery: options.enableSpatialQuery ?? false,
  };
}

/**
 * Refresh CPU-side cache from GPU buffers (async).
 * Call once per frame before reading attributes.
 * @param {Object} reader
 * @param {number} frameIndex - Current frame number (avoids redundant readbacks)
 */
export async function refreshAttributeCache(reader, frameIndex) {
  if (!reader || !reader.source) return;
  if (reader._cacheFrame === frameIndex) return; // Already cached this frame

  const world = reader.source;
  const pc = world.particleCount || world.maxParticles || 0;
  if (pc <= 0) return;

  // Readback positions
  if (world.positionBuffer && world.device) {
    if (!reader._posCache || reader._posCache.length < pc * 4) {
      reader._posCache = new Float32Array(pc * 4);
    }
    await readbackBuffer(world.device, world.positionBuffer, reader._posCache, pc * 16);
  }

  // Readback velocities
  if (world.velocityBuffer && world.device) {
    if (!reader._velCache || reader._velCache.length < pc * 4) {
      reader._velCache = new Float32Array(pc * 4);
    }
    await readbackBuffer(world.device, world.velocityBuffer, reader._velCache, pc * 16);
  }

  // Readback meta
  if (world.metaBuffer && world.device) {
    if (!reader._metaCache || reader._metaCache.length < pc * 4) {
      reader._metaCache = new Float32Array(pc * 4);
    }
    await readbackBuffer(world.device, world.metaBuffer, reader._metaCache, pc * 16);
  }

  reader._cacheFrame = frameIndex;
}

/**
 * Read a particle's position and age.
 * @param {Object} reader
 * @param {number} index - Particle index
 * @returns {{ x, y, z, age } | null}
 */
export function readParticlePosition(reader, index) {
  if (!reader?._posCache) return null;
  const o = index * 4;
  if (o + 3 >= reader._posCache.length) return null;
  return {
    x: reader._posCache[o],
    y: reader._posCache[o + 1],
    z: reader._posCache[o + 2],
    age: reader._posCache[o + 3],
  };
}

/**
 * Read a particle's velocity and lifetime.
 * @param {Object} reader
 * @param {number} index - Particle index
 * @returns {{ vx, vy, vz, lifetime } | null}
 */
export function readParticleVelocity(reader, index) {
  if (!reader?._velCache) return null;
  const o = index * 4;
  if (o + 3 >= reader._velCache.length) return null;
  return {
    vx: reader._velCache[o],
    vy: reader._velCache[o + 1],
    vz: reader._velCache[o + 2],
    lifetime: reader._velCache[o + 3],
  };
}

/**
 * Read a particle's color and packed meta.
 * @param {Object} reader
 * @param {number} index - Particle index
 * @returns {{ r, g, b, packed } | null}
 */
export function readParticleMeta(reader, index) {
  if (!reader?._metaCache) return null;
  const o = index * 4;
  if (o + 3 >= reader._metaCache.length) return null;
  return {
    r: reader._metaCache[o],
    g: reader._metaCache[o + 1],
    b: reader._metaCache[o + 2],
    packed: reader._metaCache[o + 3],
  };
}

/**
 * Find the nearest alive particle to a query position (brute force).
 * For large counts, use the spatial grid instead.
 * @param {Object} reader
 * @param {number[]} queryPos - [x, y, z]
 * @param {number} maxParticles - How many particles to search
 * @returns {{ index, distSq, position } | null}
 */
export function findNearestParticle(reader, queryPos, maxParticles) {
  if (!reader?._posCache || !reader?._velCache) return null;

  const [qx, qy, qz] = queryPos;
  let bestIdx = -1;
  let bestDistSq = Infinity;
  const count = maxParticles || (reader._posCache.length / 4);

  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const age = reader._posCache[o + 3];
    const lifetime = reader._velCache[o + 3];
    if (age >= lifetime) continue; // Skip dead

    const dx = reader._posCache[o] - qx;
    const dy = reader._posCache[o + 1] - qy;
    const dz = reader._posCache[o + 2] - qz;
    const distSq = dx * dx + dy * dy + dz * dz;

    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestIdx = i;
    }
  }

  if (bestIdx < 0) return null;
  const o = bestIdx * 4;
  return {
    index: bestIdx,
    distSq: bestDistSq,
    position: [reader._posCache[o], reader._posCache[o+1], reader._posCache[o+2]],
  };
}

/**
 * Find all particles within a radius of a query position.
 * @param {Object} reader
 * @param {number[]} queryPos - [x, y, z]
 * @param {number} radius
 * @param {number} maxResults - Cap on results (default 32)
 * @returns {Array<{ index, distSq }>}
 */
export function findParticlesInRadius(reader, queryPos, radius, maxResults = 32) {
  if (!reader?._posCache || !reader?._velCache) return [];

  const [qx, qy, qz] = queryPos;
  const radiusSq = radius * radius;
  const results = [];
  const count = reader._posCache.length / 4;

  for (let i = 0; i < count && results.length < maxResults; i++) {
    const o = i * 4;
    const age = reader._posCache[o + 3];
    const lifetime = reader._velCache[o + 3];
    if (age >= lifetime) continue;

    const dx = reader._posCache[o] - qx;
    const dy = reader._posCache[o + 1] - qy;
    const dz = reader._posCache[o + 2] - qz;
    const distSq = dx * dx + dy * dy + dz * dz;

    if (distSq <= radiusSq) {
      results.push({ index: i, distSq });
    }
  }

  return results;
}

/**
 * Destroy the reader.
 */
export function destroyAttributeReader(reader) {
  if (!reader) return;
  reader.source = null;
  reader._posCache = null;
  reader._velCache = null;
  reader._metaCache = null;
}

// Internal helper: GPU buffer readback
async function readbackBuffer(device, gpuBuffer, targetArray, byteSize) {
  const staging = device.createBuffer({
    size: byteSize,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(gpuBuffer, 0, staging, 0, byteSize);
  device.queue.submit([encoder.finish()]);

  await staging.mapAsync(GPUMapMode.READ);
  const mapped = new Float32Array(staging.getMappedRange());
  targetArray.set(mapped.subarray(0, targetArray.length));
  staging.unmap();
  staging.destroy();
}
