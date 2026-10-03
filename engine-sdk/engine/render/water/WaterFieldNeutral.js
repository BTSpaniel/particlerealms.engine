// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createUniformBuffer } from '../../core/gpu/GpuBuffer.js';
import { textureMipByteSize } from '../../core/math/TextureMath.js';
import { WATER_FIELD_BINDING_ENTRIES } from './WaterFieldShaders.js';
import { writeWaterInitializationBuffer } from './WaterFieldInitialization.js';

export const WATER_FIELD_NEUTRAL_RESOURCE_BYTES = 64 + textureMipByteSize(1, 1, 8, 1, 15);

/** The saved field owner is absent. Bind a cleared zero field through the same
 * sampling ABI without compiling source, evolving waves or acquiring a device. */
export function createNeutralWaterFieldBindings({ device, label = 'WaterFieldNeutral' } = {}) {
    if (!device?.createTexture || !device?.createBuffer || !device?.createBindGroup || !device?.queue?.writeBuffer) {
        throw new TypeError('Neutral water bindings require an external GPUDevice.');
    }
    let frameBuffer = null, texture = null, disposed = false;
    try {
        const layout = device.createBindGroupLayout({ label: `${label}.sampleLayout`, entries: WATER_FIELD_BINDING_ENTRIES });
        const sampler = device.createSampler({ label: `${label}.sampler`, magFilter: 'linear', minFilter: 'linear',
            mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
        frameBuffer = createUniformBuffer(device, 64, { label: `${label}.frame` });
        const frame = new ArrayBuffer(64), floats = new Float32Array(frame), integers = new Uint32Array(frame);
        floats.set([0, 0, 0, 1], 0); integers.set([1, 0, 1, 0], 4); floats.set([256, 32, 4, 0], 8);
        writeWaterInitializationBuffer(device, frameBuffer, frame);
        // WebGPU clears newly created texture subresources before their first
        // read. Zero samples yield identity tangents, J=1 and an upward normal.
        const descriptor = { label: `${label}.zeroFields`, size: { width: 1, height: 1, depthOrArrayLayers: 15 },
            dimension: '2d', format: 'rgba16float', mipLevelCount: 1, usage: GPUTextureUsage.TEXTURE_BINDING };
        texture = device.createTexture(descriptor);
        const view = texture.createView({ dimension: '2d-array' }), views = Object.freeze(Array(5).fill(view));
        const entries = Object.freeze([{ binding: 0, resource: { buffer: frameBuffer, offset: 0, size: 64 } },
            { binding: 1, resource: sampler }, ...views.map((resource, index) => ({ binding: index + 2, resource }))]);
        const bindGroup = device.createBindGroup({ label: `${label}.sampleBindings`, layout, entries });
        const bindings = Object.freeze({ layout, bindGroup, entries, frameBuffer, textures: Object.freeze([texture]), views,
            textureDescriptor: descriptor, resolution: 1, mipLevels: 1, resourceBytes: WATER_FIELD_NEUTRAL_RESOURCE_BYTES, epoch: null });
        return Object.freeze({ layout,
            get resourceBytes() { return disposed ? 0 : WATER_FIELD_NEUTRAL_RESOURCE_BYTES; },
            getBindings() { if (disposed) throw new Error('Neutral water bindings have been disposed.'); return bindings; },
            resourceCounts: () => ({ buffers: disposed ? 0 : 1, textures: disposed ? 0 : 1 }),
            diagnostics: () => ({ model: 'neutral-v2', sourceHash: null, resolution: 1, encodeCount: 0,
                residentBytes: disposed ? 0 : WATER_FIELD_NEUTRAL_RESOURCE_BYTES, resourceCount: disposed ? 0 : 1, epoch: null }),
            whenSettled: () => Promise.resolve(),
            dispose() { if (disposed) return false; disposed = true; frameBuffer.destroy(); texture.destroy(); return true; },
        });
    } catch (error) { frameBuffer?.destroy(); texture?.destroy(); throw error; }
}
