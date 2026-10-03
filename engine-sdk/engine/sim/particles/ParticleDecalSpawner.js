// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleDecalSpawner.js - Spawn Decals from Particle Collisions (GAP 22)
 * 
 * Consumes GPU event readback data (collision events) to spawn projected
 * texture decals at impact points. Integrates with the GPU event system
 * (GAP 6) via CPU readback callbacks.
 * 
 * Each collision event provides: position, velocity (impact direction),
 * and event type. The spawner creates decal descriptors that the game's
 * decal system can render (projected quads aligned to surface normal).
 * 
 * Usage:
 *   const spawner = createDecalSpawner({ maxDecals: 200 });
 *   // Register with event system:
 *   onParticleEvent(world.eventSystem, (events) => {
 *     feedCollisionEvents(spawner, events);
 *   });
 *   // Each frame:
 *   const decals = getActiveDecals(spawner);
 *   // Render decals with your decal system
 */

import { uniformDistribution } from '../../core/math/MathRandom.js';

// ============================================================================
// DECAL POOL
// ============================================================================

/**
 * Create a decal spawner with a fixed-size ring buffer pool.
 * @param {Object} config
 * @param {number} config.maxDecals - Maximum active decals (ring buffer, default 200)
 * @param {number} config.decalLifetime - How long decals persist in seconds (default 10)
 * @param {number} config.decalSize - Default decal world size (default 1.0)
 * @param {number} config.minImpactSpeed - Minimum impact speed to spawn a decal (default 2.0)
 * @param {number} config.fadeOutTime - Seconds before death to start fading (default 2.0)
 * @param {Function} config.onSpawn - Callback when a decal is spawned: (decal) => void
 */
export function createDecalSpawner(config = {}) {
  const maxDecals = config.maxDecals || 200;

  // Pre-allocate decal pool as SoA for cache efficiency
  const pool = {
    positions: new Float32Array(maxDecals * 3),   // xyz per decal
    normals: new Float32Array(maxDecals * 3),      // surface normal (derived from velocity)
    sizes: new Float32Array(maxDecals),            // world size per decal
    ages: new Float32Array(maxDecals),             // current age
    lifetimes: new Float32Array(maxDecals),        // max lifetime
    colors: new Float32Array(maxDecals * 4),       // rgba tint
    active: new Uint8Array(maxDecals),             // 1 = active, 0 = free
  };

  return {
    pool,
    maxDecals,
    writeHead: 0,
    activeCount: 0,
    decalLifetime: config.decalLifetime ?? 10,
    decalSize: config.decalSize ?? 1.0,
    minImpactSpeed: config.minImpactSpeed ?? 2.0,
    fadeOutTime: config.fadeOutTime ?? 2.0,
    onSpawn: typeof config.onSpawn === 'function' ? config.onSpawn : null,
    totalSpawned: 0,
  };
}

/**
 * Feed collision events from GPU event readback into the decal spawner.
 * Events are expected to be Float32Array with 8 floats per event:
 *   [posX, posY, posZ, velX, velY, velZ, eventType, particleIndex]
 * 
 * @param {Object} spawner - Decal spawner
 * @param {Float32Array} eventData - Raw event data from GPU readback
 * @param {number} eventCount - Number of events in the buffer
 * @param {Object} options - { color, sizeScale, eventTypeMask }
 */
export function feedCollisionEvents(spawner, eventData, eventCount, options = {}) {
  if (!spawner || !eventData || eventCount <= 0) return;

  const color = options.color || [1, 1, 1, 1];
  const sizeScale = options.sizeScale ?? 1.0;
  // Event types: 1=death, 2=groundCollision, 3=entityCollision, 4=killZone
  const typeMask = options.eventTypeMask ?? (2 | 4); // Default: ground + entity collisions

  for (let i = 0; i < eventCount; i++) {
    const base = i * 8;
    const eventType = eventData[base + 6];

    // Filter by event type
    if (!(Math.round(eventType) & typeMask)) continue;

    const px = eventData[base + 0];
    const py = eventData[base + 1];
    const pz = eventData[base + 2];
    const vx = eventData[base + 3];
    const vy = eventData[base + 4];
    const vz = eventData[base + 5];

    // Check minimum impact speed
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (speed < spawner.minImpactSpeed) continue;

    // Derive surface normal from velocity (impact direction, inverted)
    const invSpeed = 1 / Math.max(speed, 0.001);
    const nx = -vx * invSpeed;
    const ny = -vy * invSpeed;
    const nz = -vz * invSpeed;

    // Write to ring buffer (overwrites oldest)
    const idx = spawner.writeHead % spawner.maxDecals;
    const p = spawner.pool;

    p.positions[idx * 3 + 0] = px;
    p.positions[idx * 3 + 1] = py;
    p.positions[idx * 3 + 2] = pz;
    p.normals[idx * 3 + 0] = nx;
    p.normals[idx * 3 + 1] = ny;
    p.normals[idx * 3 + 2] = nz;
    p.sizes[idx] = spawner.decalSize * sizeScale * uniformDistribution(0.8, 1.2, Math.random);
    p.ages[idx] = 0;
    p.lifetimes[idx] = spawner.decalLifetime;
    p.colors[idx * 4 + 0] = color[0];
    p.colors[idx * 4 + 1] = color[1];
    p.colors[idx * 4 + 2] = color[2];
    p.colors[idx * 4 + 3] = color[3];
    p.active[idx] = 1;

    spawner.writeHead++;
    spawner.totalSpawned++;

    if (spawner.onSpawn) {
      spawner.onSpawn({
        index: idx,
        position: [px, py, pz],
        normal: [nx, ny, nz],
        size: p.sizes[idx],
        color,
      });
    }
  }

  // Update active count
  let count = 0;
  for (let i = 0; i < spawner.maxDecals; i++) {
    if (spawner.pool.active[i]) count++;
  }
  spawner.activeCount = count;
}

/**
 * Update decal ages, fade, and expire old decals.
 * @param {Object} spawner
 * @param {number} dt - Delta time in seconds
 */
export function updateDecals(spawner, dt) {
  if (!spawner) return;
  const p = spawner.pool;
  let count = 0;

  for (let i = 0; i < spawner.maxDecals; i++) {
    if (!p.active[i]) continue;

    p.ages[i] += dt;
    if (p.ages[i] >= p.lifetimes[i]) {
      p.active[i] = 0;
      continue;
    }

    // Fade out alpha near end of life
    const remaining = p.lifetimes[i] - p.ages[i];
    if (remaining < spawner.fadeOutTime) {
      p.colors[i * 4 + 3] = remaining / spawner.fadeOutTime;
    }

    count++;
  }

  spawner.activeCount = count;
}

/**
 * Get all active decals as an array of descriptors.
 * @param {Object} spawner
 * @returns {Array<Object>} Active decal descriptors
 */
export function getActiveDecals(spawner) {
  if (!spawner) return [];
  const result = [];
  const p = spawner.pool;

  for (let i = 0; i < spawner.maxDecals; i++) {
    if (!p.active[i]) continue;
    result.push({
      index: i,
      position: [p.positions[i*3], p.positions[i*3+1], p.positions[i*3+2]],
      normal: [p.normals[i*3], p.normals[i*3+1], p.normals[i*3+2]],
      size: p.sizes[i],
      age: p.ages[i],
      lifetime: p.lifetimes[i],
      color: [p.colors[i*4], p.colors[i*4+1], p.colors[i*4+2], p.colors[i*4+3]],
    });
  }
  return result;
}

/**
 * Get active decal count.
 */
export function getDecalCount(spawner) {
  return spawner ? spawner.activeCount : 0;
}

/**
 * Clear all decals.
 */
export function clearDecals(spawner) {
  if (!spawner) return;
  spawner.pool.active.fill(0);
  spawner.activeCount = 0;
}

/**
 * Destroy the spawner.
 */
export function destroyDecalSpawner(spawner) {
  if (!spawner) return;
  spawner.pool = null;
  spawner.activeCount = 0;
}
