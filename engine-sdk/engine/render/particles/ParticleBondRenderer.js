// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleBondRenderer.js - Bond Line / Stick Renderer (GAP 41)
 * 
 * Renders molecular bonds as camera-facing quads between bonded particle pairs.
 * Reads a bond buffer (vec4<u32> per bond: particleA, particleB, bondType, bondOrder).
 * Color blends between element CPK colors at each endpoint.
 * Supports covalent (solid), ionic (dashed), metallic (thick), hydrogen (dotted).
 * 
 * Usage:
 *   const br = createBondRenderer(device, format);
 *   initBondRendererBindGroups(br, device, posBuffer, velBuffer, bondBuffer, colorLutBuffer, elementBuffer);
 *   uploadBonds(br, device, bondArray);
 *   renderBonds(pass, br, viewProj, cameraPos, viewRight, viewUp, bondCount);
 */

import { bondLineVertexWGSL, bondLineFragmentWGSL } from "../shaders/modules/core/particles_bond_line.js";

// ============================================================================
// SYSTEM
// ============================================================================

const MAX_BONDS = 65536;

/**
 * Create the bond renderer.
 */
export function createBondRenderer(device, format) {
  const vertModule = device.createShaderModule({ label: 'BondLine.vert', code: bondLineVertexWGSL });
  const fragModule = device.createShaderModule({ label: 'BondLine.frag', code: bondLineFragmentWGSL });

  const frameLayout = device.createBindGroupLayout({
    label: 'BondLine.frameLayout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ],
  });

  const dataLayout = device.createBindGroupLayout({
    label: 'BondLine.dataLayout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }, // positions
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }, // velocities
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }, // bonds
      { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }, // meta (xyz=color)
      { binding: 4, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }, // thermal (x=temp, y=phase)
    ],
  });

  const pipelineLayout = device.createPipelineLayout({
    label: 'BondLine.pipelineLayout',
    bindGroupLayouts: [frameLayout, dataLayout],
  });

  const pipeline = device.createRenderPipeline({
    label: 'BondLine.pipeline',
    layout: pipelineLayout,
    vertex: { module: vertModule, entryPoint: 'vs_main' },
    fragment: {
      module: fragModule, entryPoint: 'fs_main',
      targets: [{
        format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-list' },
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: false,
      depthCompare: 'less',
    },
  });

  const frameBuffer = device.createBuffer({
    label: 'BondLine.frame', size: 128,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Bond data buffer: vec4<u32> per bond
  const bondBuffer = device.createBuffer({
    label: 'BondLine.bonds', size: MAX_BONDS * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  return {
    device, pipeline, frameBuffer, bondBuffer,
    frameLayout, dataLayout,
    frameBindGroup: null, dataBindGroup: null,
    lineWidth: 0.08,
    bondCount: 0,
  };
}

/**
 * Initialize bind groups.
 */
export function initBondRendererBindGroups(renderer, device, positionBuffer, velocityBuffer, metaBuffer, thermalBuffer) {
  renderer.frameBindGroup = device.createBindGroup({
    label: 'BondLine.frame.bg', layout: renderer.frameLayout,
    entries: [{ binding: 0, resource: { buffer: renderer.frameBuffer } }],
  });

  renderer.dataBindGroup = device.createBindGroup({
    label: 'BondLine.data.bg', layout: renderer.dataLayout,
    entries: [
      { binding: 0, resource: { buffer: positionBuffer } },
      { binding: 1, resource: { buffer: velocityBuffer } },
      { binding: 2, resource: { buffer: renderer.bondBuffer } },
      { binding: 3, resource: { buffer: metaBuffer } },
      { binding: 4, resource: { buffer: thermalBuffer } },
    ],
  });
}

/**
 * Upload bond data from CPU.
 * @param {Uint32Array} bondData - Flat array of [particleA, particleB, bondType, bondOrder, ...]
 * @param {number} bondCount
 */
export function uploadBonds(renderer, device, bondData, bondCount) {
  if (!renderer || bondCount === 0) return;
  const count = Math.min(bondCount, MAX_BONDS);
  device.queue.writeBuffer(renderer.bondBuffer, 0, bondData, 0, count * 4);
  renderer.bondCount = count;
}

/**
 * Render bonds in the given render pass.
 */
export function renderBonds(pass, renderer, viewProj, cameraPos, viewRight, viewUp) {
  if (!renderer?.pipeline || !renderer.dataBindGroup || renderer.bondCount === 0) return;

  const frameData = new Float32Array(32);
  frameData.set(viewProj, 0);
  frameData[16] = cameraPos[0]; frameData[17] = cameraPos[1]; frameData[18] = cameraPos[2];
  frameData[19] = renderer.lineWidth;
  frameData[20] = viewRight[0]; frameData[21] = viewRight[1]; frameData[22] = viewRight[2]; frameData[23] = 0;
  frameData[24] = viewUp[0]; frameData[25] = viewUp[1]; frameData[26] = viewUp[2]; frameData[27] = 0;

  renderer.device.queue.writeBuffer(renderer.frameBuffer, 0, frameData);

  pass.setPipeline(renderer.pipeline);
  pass.setBindGroup(0, renderer.frameBindGroup);
  pass.setBindGroup(1, renderer.dataBindGroup);
  pass.draw(6, renderer.bondCount); // 6 verts per bond quad
}

/**
 * Destroy.
 */
export function destroyBondRenderer(renderer) {
  if (!renderer) return;
  if (renderer.frameBuffer) renderer.frameBuffer.destroy();
  if (renderer.bondBuffer) renderer.bondBuffer.destroy();
}
