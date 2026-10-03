// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleBlackbodyRenderer.js - Blackbody Radiation Renderer (GAP 39)
 * 
 * Creates and manages the 1D blackbody LUT texture.
 * Provides bind group for particle fragment shaders to sample temperature → color.
 * Integrates with existing billboard and SDF renderers.
 * 
 * Usage:
 *   const bb = createBlackbodySystem(device);
 *   const bindGroup = getBlackbodyBindGroup(bb);
 *   // Set as additional bind group in particle render pass
 */

import { generateBlackbodyLUT } from "../shaders/modules/core/particles_blackbody.js";

// ============================================================================
// SYSTEM
// ============================================================================

/**
 * Create the blackbody rendering system with LUT texture.
 * @param {GPUDevice} device
 * @param {Object} [options]
 * @returns {Object}
 */
export function createBlackbodySystem(device, options = {}) {
  const minTemp = options.minTemp || 300;
  const maxTemp = options.maxTemp || 30000;
  const emissionStrength = options.emissionStrength || 1.0;

  // Generate LUT
  const lut = generateBlackbodyLUT(minTemp, maxTemp);

  // Create 1D texture (256 wide × 1 high)
  const texture = device.createTexture({
    label: 'Blackbody.lut',
    size: [lut.size, 1, 1],
    format: 'rgba32float',
    dimension: '1d',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  // Upload LUT data
  device.queue.writeTexture(
    { texture },
    lut.data,
    { bytesPerRow: lut.size * 16 },
    [lut.size, 1, 1],
  );

  const textureView = texture.createView({ label: 'Blackbody.lutView' });

  // Sampler: linear filtering for smooth temperature gradients
  const sampler = device.createSampler({
    label: 'Blackbody.sampler',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
  });

  // Uniform buffer for blackbody params: [minTemp, maxTemp, emissionStrength, pad]
  const paramsBuffer = device.createBuffer({
    label: 'Blackbody.params',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(paramsBuffer, 0, new Float32Array([minTemp, maxTemp, emissionStrength, 0]));

  return {
    device,
    texture, textureView, sampler,
    paramsBuffer,
    minTemp, maxTemp, emissionStrength,
    bindGroupLayout: null,
    bindGroup: null,
  };
}

/**
 * Create a bind group layout for blackbody resources.
 * Typically bound as an additional group in particle render pipelines.
 */
export function createBlackbodyBindGroupLayout(device) {
  return device.createBindGroupLayout({
    label: 'Blackbody.layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float', viewDimension: '1d' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'non-filtering' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });
}

/**
 * Create the bind group for blackbody resources.
 * @returns {GPUBindGroup}
 */
export function getBlackbodyBindGroup(system, layout) {
  if (!system) return null;
  if (system.bindGroup) return system.bindGroup;

  const device = system.device;
  const bgLayout = layout || createBlackbodyBindGroupLayout(device);

  system.bindGroup = device.createBindGroup({
    label: 'Blackbody.bindGroup',
    layout: bgLayout,
    entries: [
      { binding: 0, resource: system.textureView },
      { binding: 1, resource: system.sampler },
      { binding: 2, resource: { buffer: system.paramsBuffer } },
    ],
  });

  return system.bindGroup;
}

/**
 * Update emission strength at runtime.
 */
export function setBlackbodyEmission(system, strength) {
  if (!system) return;
  system.emissionStrength = strength;
  system.device.queue.writeBuffer(
    system.paramsBuffer, 0,
    new Float32Array([system.minTemp, system.maxTemp, strength, 0]),
  );
}

/**
 * Destroy.
 */
export function destroyBlackbodySystem(system) {
  if (!system) return;
  if (system.texture) system.texture.destroy();
  if (system.paramsBuffer) system.paramsBuffer.destroy();
  system.bindGroup = null;
}
