// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Pre-warm mesh-to-particles pipeline to avoid first-emit stall
 */

import { generateMeshParticlesIntoWorld } from './MeshToParticlesCompute.js';
import { createStorageBuffer } from '../../core/gpu/GpuBuffer.js';

export async function prewarmMeshToParticlesPipeline(gpuDevice) {
    if (!gpuDevice || typeof gpuDevice.getDevice !== 'function') return;
    
    const device = gpuDevice.getDevice();
    if (!device) return;
    
    try {
        const dummyVertexData = new Float32Array(12);
        const dummyIndexData = new Uint32Array(3);
        const dummyUvData = new Float32Array(6);
        
        const dummyVertexBuffer = createStorageBuffer(device, dummyVertexData, { label: 'Prewarm.vertices' });
        const dummyIndexBuffer = createStorageBuffer(device, dummyIndexData, { label: 'Prewarm.indices' });
        const dummyUvBuffer = createStorageBuffer(device, dummyUvData, { label: 'Prewarm.uvs' });
        const dummyTexture = device.createTexture({
            size: [1, 1, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        const dummyTextureView = dummyTexture.createView();
        const dummySampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
        
        const dummyWorld = {
            gpuDevice,
            maxParticles: 1,
            positionBuffer: createStorageBuffer(device, 16, { label: 'Prewarm.worldPos' }),
            metaBuffer: createStorageBuffer(device, 16, { label: 'Prewarm.worldMeta' }),
            velocityBuffer: createStorageBuffer(device, 16, { label: 'Prewarm.worldVel' }),
            uvBuffer: createStorageBuffer(device, 16, { label: 'Prewarm.worldUv' }),
        };
        
        const meshBuffers = {
            vertexBuffer: dummyVertexBuffer,
            indexBuffer: dummyIndexBuffer,
            uvBuffer: dummyUvBuffer,
            texture: dummyTextureView,
            sampler: dummySampler,
            triCount: 1,
            vertexStrideFloats: 4,
            attributes: [
                { name: 'position', offset: 0 },
                { name: 'normal', offset: 12 },
            ],
        };
        
        await generateMeshParticlesIntoWorld(gpuDevice, meshBuffers, dummyWorld, {
            readback: false,
            trace: (label, time) => {
                if (time > 50) {
                    console.log(`[Pipeline Prewarm] ${label}: ${time.toFixed(1)}ms`);
                }
            }
        });
        
        dummyVertexBuffer.destroy();
        dummyIndexBuffer.destroy();
        dummyUvBuffer.destroy();
        dummyTexture.destroy();
        dummyWorld.positionBuffer.destroy();
        dummyWorld.metaBuffer.destroy();
        dummyWorld.velocityBuffer.destroy();
        dummyWorld.uvBuffer.destroy();
        
        console.log('[Pipeline Prewarm] Mesh-to-particles pipeline ready');
    } catch (err) {
        console.warn('[Pipeline Prewarm] Failed to prewarm pipeline:', err);
    }
}
