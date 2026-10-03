// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleSixWayLighting.js - Six-Way Lightmap Particles (GAP 24)
 * 
 * Pre-baked lighting from 6 directions (+X, -X, +Y, -Y, +Z, -Z) sampled
 * based on dominant light direction. Creates a fake 3D volumetric look on
 * flat billboard particles, especially useful for smoke and fog.
 * 
 * Matches Unity VFX Graph six-way lighting feature.
 * 
 * The system bakes a 6-channel lightmap texture (3 RGBA8 textures for 6 directions,
 * or a single RGBA16float with packed channels). At render time, the fragment shader
 * blends between the 6 maps based on the light direction relative to the billboard.
 * 
 * Usage:
 *   const sixway = createSixWayLightingSystem(device);
 *   loadSixWayTextures(sixway, device, { right, left, top, bottom, front, back });
 *   // Or generate procedural maps:
 *   generateProceduralSixWay(sixway, device, 'smoke');
 *   // Bind to particle renderer:
 *   bindSixWayToRenderer(sixway, renderer);
 */

import { createStorageBuffer, createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";

// ============================================================================
// SIX-WAY LIGHTING WGSL SNIPPET
// ============================================================================

export const SIX_WAY_LIGHTING_WGSL = /* wgsl */`
// Six-way lightmap sampling for volumetric billboard appearance
// lightDir: normalized light direction in world space
// normal: billboard face normal (typically camera direction)
// texCoord: billboard UV
fn sampleSixWayLighting(
  lightDir: vec3<f32>,
  texCoord: vec2<f32>,
  rightMap: texture_2d<f32>,
  leftMap: texture_2d<f32>,
  topMap: texture_2d<f32>,
  bottomMap: texture_2d<f32>,
  frontMap: texture_2d<f32>,
  backMap: texture_2d<f32>,
  samp: sampler,
) -> vec3<f32> {
  // Decompose light direction into positive/negative axis weights
  let posX = max(lightDir.x, 0.0);
  let negX = max(-lightDir.x, 0.0);
  let posY = max(lightDir.y, 0.0);
  let negY = max(-lightDir.y, 0.0);
  let posZ = max(lightDir.z, 0.0);
  let negZ = max(-lightDir.z, 0.0);

  // Sample each directional lightmap
  let right  = textureSample(rightMap, samp, texCoord).rgb * posX;
  let left   = textureSample(leftMap, samp, texCoord).rgb * negX;
  let top    = textureSample(topMap, samp, texCoord).rgb * posY;
  let bottom = textureSample(bottomMap, samp, texCoord).rgb * negY;
  let front  = textureSample(frontMap, samp, texCoord).rgb * posZ;
  let back   = textureSample(backMap, samp, texCoord).rgb * negZ;

  return right + left + top + bottom + front + back;
}
`;

// ============================================================================
// SYSTEM
// ============================================================================

/**
 * Create a six-way lighting system.
 * @param {GPUDevice} device
 * @param {Object} config - { resolution }
 */
export function createSixWayLightingSystem(device, config = {}) {
  const resolution = config.resolution || 64;

  const textures = {};
  const views = {};
  const directions = ['right', 'left', 'top', 'bottom', 'front', 'back'];

  // Create 6 textures (one per direction)
  for (const dir of directions) {
    const tex = device.createTexture({
      label: `SixWay.${dir}`,
      size: [resolution, resolution],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    textures[dir] = tex;
    views[dir] = tex.createView();
  }

  const sampler = device.createSampler({
    label: 'SixWay.sampler',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  });

  // Params uniform: lightDirection (vec3), intensity (f32) = 16 bytes
  const paramsBuffer = createUniformBuffer(device, 16, { label: 'SixWay.params' });
  labelResource(paramsBuffer, 'SixWay.params');

  return {
    device,
    textures,
    views,
    sampler,
    paramsBuffer,
    resolution,
    bindGroup: null,
  };
}

/**
 * Generate procedural six-way lightmaps.
 * @param {Object} system
 * @param {GPUDevice} device
 * @param {string} preset - 'smoke', 'fog', 'cloud', 'fire'
 */
export function generateProceduralSixWay(system, device, preset = 'smoke') {
  const res = system.resolution;
  const data = new Uint8Array(res * res * 4);

  const presetConfigs = {
    smoke: { baseLight: 0.3, directional: 0.7, scatter: 0.4, absorption: 0.6 },
    fog:   { baseLight: 0.5, directional: 0.3, scatter: 0.7, absorption: 0.2 },
    cloud: { baseLight: 0.4, directional: 0.8, scatter: 0.3, absorption: 0.4 },
    fire:  { baseLight: 0.8, directional: 0.2, scatter: 0.1, absorption: 0.1 },
  };
  const cfg = presetConfigs[preset] || presetConfigs.smoke;

  const directions = ['right', 'left', 'top', 'bottom', 'front', 'back'];
  // Directional bias per face: how much light comes from each direction
  const biases = {
    right:  [1.0, 0.3, 0.5, 0.5, 0.5, 0.5],
    left:   [0.3, 1.0, 0.5, 0.5, 0.5, 0.5],
    top:    [0.5, 0.5, 1.0, 0.2, 0.5, 0.5],
    bottom: [0.5, 0.5, 0.2, 1.0, 0.5, 0.5],
    front:  [0.5, 0.5, 0.5, 0.5, 1.0, 0.3],
    back:   [0.5, 0.5, 0.5, 0.5, 0.3, 1.0],
  };

  for (const dir of directions) {
    const bias = biases[dir];
    const mainBias = bias[directions.indexOf(dir)];

    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const u = (x + 0.5) / res;
        const v = (y + 0.5) / res;
        const idx = (y * res + x) * 4;

        // Radial falloff from center (particle shape)
        const cx = u - 0.5;
        const cy = v - 0.5;
        const r = Math.sqrt(cx * cx + cy * cy) * 2;
        const shape = Math.max(0, 1 - r * r);

        // Directional lighting simulation
        const dirLight = mainBias * cfg.directional;
        const scatter = cfg.scatter * (0.5 + 0.5 * Math.sin(u * 13.7 + v * 7.3));
        const light = cfg.baseLight + dirLight + scatter * 0.2;

        // Absorption (darker in center for smoke/cloud)
        const absorption = 1 - cfg.absorption * shape * 0.5;

        const intensity = Math.max(0, Math.min(1, light * absorption * shape));
        const val = Math.round(intensity * 255);

        data[idx + 0] = val;
        data[idx + 1] = val;
        data[idx + 2] = val;
        data[idx + 3] = Math.round(shape * 255);
      }
    }

    device.queue.writeTexture(
      { texture: system.textures[dir] },
      data,
      { bytesPerRow: res * 4 },
      { width: res, height: res }
    );
  }
}

/**
 * Load six-way textures from external image data.
 * @param {Object} system
 * @param {GPUDevice} device
 * @param {Object} images - { right, left, top, bottom, front, back } ImageBitmap or source
 */
export async function loadSixWayTextures(system, device, images) {
  const directions = ['right', 'left', 'top', 'bottom', 'front', 'back'];
  for (const dir of directions) {
    if (!images[dir]) continue;
    device.queue.copyExternalImageToTexture(
      { source: images[dir] },
      { texture: system.textures[dir] },
      { width: images[dir].width, height: images[dir].height }
    );
  }
}

/**
 * Update the dominant light direction.
 * @param {Object} system
 * @param {number[]} lightDir - Normalized light direction [x, y, z]
 * @param {number} intensity - Light intensity multiplier
 */
export function setSixWayLightDirection(system, lightDir, intensity = 1.0) {
  if (!system) return;
  const data = new Float32Array([lightDir[0], lightDir[1], lightDir[2], intensity]);
  updateBuffer(system.device, system.paramsBuffer, data, 0);
}

/**
 * Destroy the system.
 */
export function destroySixWayLightingSystem(system) {
  if (!system) return;
  const directions = ['right', 'left', 'top', 'bottom', 'front', 'back'];
  for (const dir of directions) {
    if (system.textures[dir]) system.textures[dir].destroy();
  }
  if (system.paramsBuffer) system.paramsBuffer.destroy();
  system.bindGroup = null;
}
