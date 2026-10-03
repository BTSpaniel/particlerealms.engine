// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createUniformBuffer } from "../../core/gpu/GpuBuffer.js";

export function createStandardEntityRenderResources(device, renderPipeline, lightsBuffer, entityId, uniformByteLength) {
  if (!device || !renderPipeline || !lightsBuffer) {
    return null;
  }

  const labelId = entityId != null ? String(entityId) : "unknown";
  let ub = null;
  let bg = null;
  try {
    ub = createUniformBuffer(device, uniformByteLength, {
      label: `StandardEntityUniforms_${labelId}`,
    });
    const bindGroupLayout = renderPipeline.getBindGroupLayout(0);
    bg = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: ub },
        },
        {
          binding: 1,
          resource: { buffer: lightsBuffer },
        },
      ],
    });
  } catch (error) {
    try { ub?.destroy?.(); }
    catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Standard entity ${labelId} allocation and rollback both failed`,
      );
    }
    throw error;
  }

  return {
    uniformBuffer: ub,
    bindGroup: bg,
  };
}
