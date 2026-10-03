// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { floatArrayToHalf } from '../../core/math/MathPacking.js';

/**
 * ParticleVectorField.js - 3D Vector Field Forces (GAP 11)
 * 
 * Import pre-authored 3D velocity fields for artistic control of particle motion.
 * Supports FGA format (FluidNinja/Houdini) and raw Float32Array grids.
 * 
 * The vector field is stored as a filterable rgba16float 3D texture:
 *   RGB = velocity direction × magnitude
 *   A = reserved (density/mask)
 * 
 * Sampled in the main sim shader via trilinear interpolation.
 * World-space bounds define where the field applies.
 * 
 * Usage:
 *   const vf = createVectorFieldSystem(device, { resolution: 32 });
 *   loadVectorFieldFromData(vf, float32Data, [32, 32, 32]);
 *   // Or generate procedurally:
 *   generateProceduralVectorField(vf, 'tornado');
 */

// ============================================================================
// PROCEDURAL FIELD GENERATORS
// ============================================================================

/**
 * Generate a tornado/vortex vector field.
 */
function generateTornado(res, data) {
  const half = res / 2;
  for (let z = 0; z < res; z++) {
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const dx = (x - half) / half;
        const dy = (y - half) / half;
        const dz = (z - half) / half;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const falloff = Math.exp(-dist * dist * 2);
        
        // Tangential velocity (swirl)
        const speed = falloff * (1 - dist * 0.5);
        const vx = -dz * speed * 3;
        const vz = dx * speed * 3;
        // Upward velocity in core
        const vy = falloff * 2 * (1 - Math.abs(dy));
        
        const idx = (z * res * res + y * res + x) * 4;
        data[idx + 0] = vx;
        data[idx + 1] = vy;
        data[idx + 2] = vz;
        data[idx + 3] = falloff;
      }
    }
  }
}

/**
 * Generate an explosion outward burst field.
 */
function generateExplosion(res, data) {
  const half = res / 2;
  for (let z = 0; z < res; z++) {
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const dx = (x - half) / half;
        const dy = (y - half) / half;
        const dz = (z - half) / half;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < 0.001) continue;
        
        const falloff = Math.exp(-dist * dist);
        const speed = falloff * 5;
        
        const idx = (z * res * res + y * res + x) * 4;
        data[idx + 0] = (dx / dist) * speed;
        data[idx + 1] = (dy / dist) * speed + falloff * 2; // Bias upward
        data[idx + 2] = (dz / dist) * speed;
        data[idx + 3] = falloff;
      }
    }
  }
}

/**
 * Generate a turbulent wind tunnel field.
 */
function generateWindTunnel(res, data) {
  const half = res / 2;
  for (let z = 0; z < res; z++) {
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const nx = x / res;
        const ny = (y - half) / half;
        const nz = (z - half) / half;
        
        // Main wind direction (+X) with turbulence
        const turb = Math.sin(ny * 6.28) * Math.cos(nz * 6.28) * 0.5;
        const vx = 3 + turb;
        const vy = Math.sin(nx * 12.56 + nz * 6.28) * 0.8;
        const vz = Math.cos(nx * 6.28 + ny * 12.56) * 0.6;
        
        const idx = (z * res * res + y * res + x) * 4;
        data[idx + 0] = vx;
        data[idx + 1] = vy;
        data[idx + 2] = vz;
        data[idx + 3] = 1.0;
      }
    }
  }
}

/**
 * Generate an attract-to-center field.
 */
function generateAttractor(res, data) {
  const half = res / 2;
  for (let z = 0; z < res; z++) {
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const dx = (x - half) / half;
        const dy = (y - half) / half;
        const dz = (z - half) / half;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < 0.001) continue;
        
        const strength = 2.0 / (dist + 0.3);
        
        const idx = (z * res * res + y * res + x) * 4;
        data[idx + 0] = -(dx / dist) * strength;
        data[idx + 1] = -(dy / dist) * strength;
        data[idx + 2] = -(dz / dist) * strength;
        data[idx + 3] = 1.0 - dist;
      }
    }
  }
}

const PROCEDURAL_GENERATORS = {
  tornado: generateTornado,
  explosion: generateExplosion,
  windTunnel: generateWindTunnel,
  attractor: generateAttractor,
};

export const PARTICLE_VECTOR_FIELD_TEXTURE_FORMAT = 'rgba16float';

/** Create a filterable 3D vector-field texture compatible with linear sampling. */
export function createVectorFieldTexture(device, resolution, label = 'VectorField.texture') {
  return device.createTexture({
    label,
    size: [resolution, resolution, resolution],
    format: PARTICLE_VECTOR_FIELD_TEXTURE_FORMAT,
    dimension: '3d',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
}

// ============================================================================
// SYSTEM
// ============================================================================

/**
 * Create a vector field system.
 * @param {GPUDevice} device
 * @param {Object} options - { resolution, bounds }
 */
export function createVectorFieldSystem(device, options = {}) {
  const resolution = options.resolution || 32;
  const texture = createVectorFieldTexture(device, resolution);

  const textureView = texture.createView();
  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    addressModeW: 'clamp-to-edge',
  });

  // Bounds uniform: vec4(centerX, centerY, centerZ, halfExtent)
  // vec4(strength, tiling, scroll, _pad)
  const paramsBuffer = device.createBuffer({
    label: 'VectorField.params',
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Default: centered at origin, 10 unit half-extent, strength 1.0
  const defaultParams = new Float32Array([
    0, 0, 0, 10, // center + halfExtent
    1.0, 1.0, 0, 0, // strength, tiling, scroll, pad
  ]);
  device.queue.writeBuffer(paramsBuffer, 0, defaultParams);

  return {
    device,
    texture,
    textureView,
    sampler,
    paramsBuffer,
    resolution,
    enabled: false,
  };
}

/**
 * Load raw velocity data into the vector field.
 * @param {Object} system
 * @param {Float32Array} data - RGBA float data (res³ × 4 floats)
 * @param {number[]} size - [width, height, depth]
 */
export function loadVectorFieldFromData(system, data, size) {
  if (!system?.device || !data) return;
  const [w, h, d] = size;
  const halfData = floatArrayToHalf(data);
  
  system.device.queue.writeTexture(
    { texture: system.texture },
    halfData,
    { bytesPerRow: w * 8, rowsPerImage: h },
    { width: w, height: h, depthOrArrayLayers: d },
  );
  system.enabled = true;
}

/**
 * Generate a procedural vector field.
 * @param {Object} system
 * @param {string} type - 'tornado', 'explosion', 'windTunnel', 'attractor'
 */
export function generateProceduralVectorField(system, type = 'tornado') {
  if (!system?.device) return;
  const res = system.resolution;
  const data = new Float32Array(res * res * res * 4);
  
  const generator = PROCEDURAL_GENERATORS[type];
  if (generator) {
    generator(res, data);
  }
  
  loadVectorFieldFromData(system, data, [res, res, res]);
}

/**
 * Update vector field parameters.
 * @param {Object} system
 * @param {Object} params - { center, halfExtent, strength, tiling, scroll }
 */
export function setVectorFieldParams(system, params = {}) {
  if (!system?.device) return;
  const data = new Float32Array(8);
  
  const c = params.center || [0, 0, 0];
  data[0] = c[0];
  data[1] = c[1];
  data[2] = c[2];
  data[3] = params.halfExtent ?? 10;
  data[4] = params.strength ?? 1.0;
  data[5] = params.tiling ?? 1.0;
  data[6] = params.scroll ?? 0;
  data[7] = 0;
  
  system.device.queue.writeBuffer(system.paramsBuffer, 0, data);
}

/**
 * Parse FGA format (FluidNinja/Houdini vector field export).
 * FGA is a simple text format: header lines then XYZ velocity per voxel.
 * @param {string} fgaText - Raw FGA file content
 * @returns {{ data: Float32Array, size: number[] }}
 */
export function parseFGA(fgaText) {
  const lines = fgaText.trim().split('\n');
  // FGA header: first 3 lines are min, max, resolution
  const min = lines[0].split(',').map(Number);
  const max = lines[1].split(',').map(Number);
  const res = lines[2].split(',').map(n => Math.round(Number(n)));
  
  const [rx, ry, rz] = res;
  const data = new Float32Array(rx * ry * rz * 4);
  
  let lineIdx = 3;
  for (let i = 0; i < rx * ry * rz && lineIdx < lines.length; i++, lineIdx++) {
    const parts = lines[lineIdx].split(',').map(Number);
    data[i * 4 + 0] = parts[0] || 0;
    data[i * 4 + 1] = parts[1] || 0;
    data[i * 4 + 2] = parts[2] || 0;
    data[i * 4 + 3] = 1.0;
  }
  
  return { data, size: res };
}

/**
 * Destroy the vector field system.
 */
export function destroyVectorFieldSystem(system) {
  if (!system) return;
  if (system.texture) system.texture.destroy();
  if (system.paramsBuffer) system.paramsBuffer.destroy();
  system.texture = null;
  system.textureView = null;
  system.enabled = false;
}
