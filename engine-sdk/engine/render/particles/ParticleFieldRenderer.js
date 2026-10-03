// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleFieldRenderer.js - Electromagnetic Field Visualizer (GAP 42)
 * 
 * Renders electric/magnetic field lines and force arrows around charged particles.
 * Computes field probe grid on CPU from charged particle positions, uploads to GPU.
 * Supports arrow glyphs showing force direction/magnitude.
 * Color: red=positive/repulsion, blue=negative/attraction, intensity=magnitude.
 * 
 * Usage:
 *   const fr = createFieldRenderer(device, format);
 *   updateFieldProbes(fr, device, chargedParticles, probeGrid);
 *   renderFieldArrows(pass, fr, viewProj, cameraPos, viewRight, viewUp);
 */

import { fieldLineVertexWGSL, fieldLineFragmentWGSL } from "../shaders/modules/core/particles_field_lines.js";

// ============================================================================
// SYSTEM
// ============================================================================

const MAX_PROBES = 4096;

/**
 * Create the field renderer.
 */
export function createFieldRenderer(device, format) {
  const vertModule = device.createShaderModule({ label: 'Field.vert', code: fieldLineVertexWGSL });
  const fragModule = device.createShaderModule({ label: 'Field.frag', code: fieldLineFragmentWGSL });

  const frameLayout = device.createBindGroupLayout({
    label: 'Field.frameLayout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ],
  });

  const dataLayout = device.createBindGroupLayout({
    label: 'Field.dataLayout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });

  const pipelineLayout = device.createPipelineLayout({
    label: 'Field.pipelineLayout',
    bindGroupLayouts: [frameLayout, dataLayout],
  });

  const pipeline = device.createRenderPipeline({
    label: 'Field.pipeline',
    layout: pipelineLayout,
    vertex: { module: vertModule, entryPoint: 'vs_main' },
    fragment: {
      module: fragModule, entryPoint: 'fs_main',
      targets: [{
        format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-list' },
  });

  const frameBuffer = device.createBuffer({
    label: 'Field.frame', size: 128,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Probe data: 2 × vec4<f32> per probe = 32 bytes per probe
  const probeBuffer = device.createBuffer({
    label: 'Field.probes', size: MAX_PROBES * 32,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  return {
    device, pipeline, frameBuffer, probeBuffer,
    frameLayout, dataLayout,
    frameBindGroup: null, dataBindGroup: null,
    arrowScale: 0.5,
    maxFieldStrength: 10.0,
    probeCount: 0,
  };
}

/**
 * Initialize bind groups.
 */
export function initFieldRendererBindGroups(renderer, device) {
  renderer.frameBindGroup = device.createBindGroup({
    label: 'Field.frame.bg', layout: renderer.frameLayout,
    entries: [{ binding: 0, resource: { buffer: renderer.frameBuffer } }],
  });

  renderer.dataBindGroup = device.createBindGroup({
    label: 'Field.data.bg', layout: renderer.dataLayout,
    entries: [{ binding: 0, resource: { buffer: renderer.probeBuffer } }],
  });
}

/**
 * Generate field probes from charged particle positions (CPU-side).
 * Creates a 3D grid of probe points and computes the E field at each.
 * @param {Array<{x,y,z,charge}>} chargedParticles
 * @param {Object} gridConfig - { min, max, resolution }
 */
export function updateFieldProbes(renderer, device, chargedParticles, gridConfig) {
  if (!renderer || !chargedParticles || chargedParticles.length === 0) {
    renderer.probeCount = 0;
    return;
  }

  const res = gridConfig?.resolution || 8;
  const min = gridConfig?.min || [-10, -10, -10];
  const max = gridConfig?.max || [10, 10, 10];
  const k = gridConfig?.coulombK || 10.0;

  const probes = [];
  const stepX = (max[0] - min[0]) / res;
  const stepY = (max[1] - min[1]) / res;
  const stepZ = (max[2] - min[2]) / res;

  for (let iz = 0; iz < res && probes.length < MAX_PROBES; iz++) {
    for (let iy = 0; iy < res && probes.length < MAX_PROBES; iy++) {
      for (let ix = 0; ix < res && probes.length < MAX_PROBES; ix++) {
        const px = min[0] + (ix + 0.5) * stepX;
        const py = min[1] + (iy + 0.5) * stepY;
        const pz = min[2] + (iz + 0.5) * stepZ;

        // Compute E field at this probe point
        let ex = 0, ey = 0, ez = 0;
        let dominantSign = 0;

        for (const p of chargedParticles) {
          const dx = px - p.x;
          const dy = py - p.y;
          const dz = pz - p.z;
          const distSq = dx * dx + dy * dy + dz * dz + 0.01;
          const dist = Math.sqrt(distSq);
          const invDist3 = 1.0 / (distSq * dist);

          const fMag = k * p.charge * invDist3;
          ex += dx * fMag;
          ey += dy * fMag;
          ez += dz * fMag;
          dominantSign += p.charge > 0 ? 1 : -1;
        }

        const magnitude = Math.sqrt(ex * ex + ey * ey + ez * ez);
        if (magnitude > 0.01) {
          probes.push(px, py, pz, magnitude, ex, ey, ez, dominantSign > 0 ? 1.0 : -1.0);
        }
      }
    }
  }

  const count = probes.length / 8;
  renderer.probeCount = count;

  if (count > 0) {
    device.queue.writeBuffer(renderer.probeBuffer, 0, new Float32Array(probes));
  }
}

/**
 * Render field arrows in the given render pass.
 */
export function renderFieldArrows(pass, renderer, viewProj, cameraPos, viewRight, viewUp) {
  if (!renderer?.pipeline || !renderer.dataBindGroup || renderer.probeCount === 0) return;

  const frameData = new Float32Array(32);
  frameData.set(viewProj, 0);
  frameData[16] = cameraPos[0]; frameData[17] = cameraPos[1]; frameData[18] = cameraPos[2];
  frameData[19] = renderer.arrowScale;
  frameData[20] = viewRight[0]; frameData[21] = viewRight[1]; frameData[22] = viewRight[2];
  frameData[23] = 0; // fieldMode: arrows
  frameData[24] = viewUp[0]; frameData[25] = viewUp[1]; frameData[26] = viewUp[2];
  frameData[27] = renderer.maxFieldStrength;

  renderer.device.queue.writeBuffer(renderer.frameBuffer, 0, frameData);

  pass.setPipeline(renderer.pipeline);
  pass.setBindGroup(0, renderer.frameBindGroup);
  pass.setBindGroup(1, renderer.dataBindGroup);
  pass.draw(12, renderer.probeCount); // 12 verts per arrow
}

/**
 * Destroy.
 */
export function destroyFieldRenderer(renderer) {
  if (!renderer) return;
  if (renderer.frameBuffer) renderer.frameBuffer.destroy();
  if (renderer.probeBuffer) renderer.probeBuffer.destroy();
}
