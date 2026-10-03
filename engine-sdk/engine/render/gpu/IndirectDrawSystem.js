// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * GPU-Driven Indirect Draw System
 * Now powered by vGPU driver
 * Eliminates CPU-GPU sync points, enables GPU culling and LOD selection
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

// LOD table entry: { vertexCount, firstVertex } for each LOD level
const MAX_LOD_LEVELS = 4;

// Reusable buffers for hot paths (reduce/reuse/recycle)
const _indirectCullParamsF32 = new Float32Array(64);

export class IndirectDrawSystem {
    constructor(device, maxDraws = 10000) {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.maxDraws = maxDraws;
        
        // Create buffers using vGPU
        this.indirectBuffer = this.vgpu.buffer.create({
            size: maxDraws * 20,
            usage: 'indirect|storage',
            label: 'IndirectDrawBuffer'
        }).buffer;
        
        this.drawCountBuffer = this.vgpu.buffer.create({
            size: 4,
            usage: 'indirect|storage',
            label: 'DrawCountBuffer'
        }).buffer;
        
        this.instanceDataBuffer = this.vgpu.buffer.create({
            size: maxDraws * 256,
            usage: 'storage',
            label: 'InstanceDataBuffer'
        }).buffer;

        // LOD table buffer: vertexCount + firstVertex per LOD per mesh type
        this.lodTableBuffer = this.vgpu.buffer.create({
            size: 256 * MAX_LOD_LEVELS * 8, // 256 mesh types, 4 LODs, 8 bytes each
            usage: 'storage',
            label: 'LODTableBuffer'
        }).buffer;

        // Culling params uniform buffer
        this.paramsBuffer = this.vgpu.buffer.create({
            size: 256, // viewProj(64) + cameraPos(16) + frustumPlanes(96) + hiZSize(8) + padding
            usage: 'uniform',
            label: 'CullingParams'
        }).buffer;
        
        this.cullingPipeline = null;
        this.cullingBindGroup = null;
        this.hiZSampler = null;
        
        // Instance count tracking
        this.instanceCount = 0;
    }

    /**
     * Upload LOD table data
     * @param {Array} meshLODs - Array of { meshType, lods: [{vertexCount, firstVertex}] }
     */
    uploadLODTable(meshLODs) {
        const data = new Uint32Array(256 * MAX_LOD_LEVELS * 2);
        
        for (const mesh of meshLODs) {
            const baseIdx = mesh.meshType * MAX_LOD_LEVELS * 2;
            for (let lod = 0; lod < mesh.lods.length && lod < MAX_LOD_LEVELS; lod++) {
                data[baseIdx + lod * 2] = mesh.lods[lod].vertexCount;
                data[baseIdx + lod * 2 + 1] = mesh.lods[lod].firstVertex;
            }
        }
        
        this.device.queue.writeBuffer(this.lodTableBuffer, 0, data);
    }

    /**
     * Upload instance data
     * @param {Float32Array} instanceData - Packed instance data (transform + bounds + lodDistances per instance)
     */
    uploadInstances(instanceData, count) {
        this.device.queue.writeBuffer(this.instanceDataBuffer, 0, instanceData);
        this.instanceCount = count;
    }

    async createCullingPipeline(frustumPlanes, hiZTexture) {
        const shader = this.vgpu.shader.compile('gpuCulling', `
struct DrawCommand {
    vertexCount: u32,
    instanceCount: u32,
    firstVertex: u32,
    firstInstance: u32,
    padding: u32,
}

struct InstanceData {
    transform: mat4x4<f32>,
    boundingSphere: vec4<f32>, // xyz = center, w = radius
    lodDistances: vec4<f32>,
}

struct CullingParams {
    viewProj: mat4x4<f32>,
    cameraPos: vec3<f32>,
    frustumPlanes: array<vec4<f32>, 6>,
    hiZSize: vec2<f32>,
}

@group(0) @binding(0) var<storage, read> instances: array<InstanceData>;
@group(0) @binding(1) var<storage, read_write> drawCommands: array<DrawCommand>;
@group(0) @binding(2) var<storage, read_write> drawCount: atomic<u32>;
@group(0) @binding(3) var<uniform> params: CullingParams;
@group(0) @binding(4) var hiZTexture: texture_2d<f32>;
@group(0) @binding(5) var hiZSampler: sampler;

fn frustumCull(center: vec3<f32>, radius: f32) -> bool {
    for (var i = 0u; i < 6u; i++) {
        let plane = params.frustumPlanes[i];
        let dist = dot(plane.xyz, center) + plane.w;
        if (dist < -radius) {
            return false; // Outside frustum
        }
    }
    return true;
}

fn occlusionCull(center: vec3<f32>, radius: f32) -> bool {
    let clipPos = params.viewProj * vec4<f32>(center, 1.0);
    let ndc = clipPos.xyz / clipPos.w;
    
    if (ndc.z < 0.0 || ndc.z > 1.0) {
        return false;
    }
    
    let uv = ndc.xy * 0.5 + 0.5;
    let depth = textureSampleLevel(hiZTexture, hiZSampler, uv, 0.0).r;
    
    return ndc.z <= depth + 0.001; // Visible if closer than Hi-Z depth
}

struct LODEntry {
    vertexCount: u32,
    firstVertex: u32,
}

@group(0) @binding(6) var<storage, read> lodTable: array<LODEntry>;

fn selectLOD(distance: f32, lodDistances: vec4<f32>) -> u32 {
    if (distance < lodDistances.x) { return 0u; }
    if (distance < lodDistances.y) { return 1u; }
    if (distance < lodDistances.z) { return 2u; }
    return 3u;
}

fn getLODEntry(meshType: u32, lod: u32) -> LODEntry {
    let idx = meshType * 4u + lod;
    return lodTable[idx];
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let instanceId = gid.x;
    if (instanceId >= arrayLength(&instances)) {
        return;
    }
    
    let instance = instances[instanceId];
    let worldCenter = (instance.transform * vec4<f32>(0.0, 0.0, 0.0, 1.0)).xyz;
    let radius = instance.boundingSphere.w;
    
    // Frustum culling
    if (!frustumCull(worldCenter, radius)) {
        return;
    }
    
    // Occlusion culling (Hi-Z)
    if (!occlusionCull(worldCenter, radius)) {
        return;
    }
    
    // LOD selection
    let distance = length(params.cameraPos - worldCenter);
    let lod = selectLOD(distance, instance.lodDistances);
    
    // Get vertex info from LOD table (meshType stored in boundingSphere.x as uint bits)
    let meshType = bitcast<u32>(instance.boundingSphere.x);
    let lodEntry = getLODEntry(meshType, lod);
    
    // Emit draw command
    let drawIndex = atomicAdd(&drawCount, 1u);
    if (drawIndex < arrayLength(&drawCommands)) {
        drawCommands[drawIndex].vertexCount = lodEntry.vertexCount;
        drawCommands[drawIndex].instanceCount = 1u;
        drawCommands[drawIndex].firstVertex = lodEntry.firstVertex;
        drawCommands[drawIndex].firstInstance = instanceId;
    }
}
            `);

        this.cullingPipeline = this.vgpu.pipeline.compute({
            module: shader,
            entryPoint: 'main',
            label: 'GPUCullingPipeline'
        });

        // Create Hi-Z sampler
        this.hiZSampler = this.device.createSampler({
            magFilter: 'nearest',
            minFilter: 'nearest',
            mipmapFilter: 'nearest',
            label: 'HiZ_Sampler',
        });
    }

    /**
     * Update culling parameters
     */
    updateCullingParams(viewProj, cameraPos, frustumPlanes, hiZSize) {
        const data = _indirectCullParamsF32;  // Reuse buffer
        
        // viewProj (16 floats)
        data.set(viewProj, 0);
        
        // cameraPos (3 floats + 1 padding)
        data[16] = cameraPos[0];
        data[17] = cameraPos[1];
        data[18] = cameraPos[2];
        data[19] = 0;
        
        // frustumPlanes (6 * 4 = 24 floats)
        for (let i = 0; i < 6; i++) {
            data[20 + i * 4] = frustumPlanes[i][0];
            data[20 + i * 4 + 1] = frustumPlanes[i][1];
            data[20 + i * 4 + 2] = frustumPlanes[i][2];
            data[20 + i * 4 + 3] = frustumPlanes[i][3];
        }
        
        // hiZSize (2 floats)
        data[44] = hiZSize[0];
        data[45] = hiZSize[1];
        
        this.device.queue.writeBuffer(this.paramsBuffer, 0, data);
    }

    /**
     * Create bind group for culling pass
     */
    _createCullingBindGroup(hiZTexture) {
        return this.device.createBindGroup({
            layout: this.cullingPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.instanceDataBuffer } },
                { binding: 1, resource: { buffer: this.indirectBuffer } },
                { binding: 2, resource: { buffer: this.drawCountBuffer } },
                { binding: 3, resource: { buffer: this.paramsBuffer } },
                { binding: 4, resource: hiZTexture.createView() },
                { binding: 5, resource: this.hiZSampler },
                { binding: 6, resource: { buffer: this.lodTableBuffer } },
            ],
            label: 'CullingBindGroup',
        });
    }

    /**
     * Execute GPU culling pass
     */
    executeCulling(commandEncoder, hiZTexture) {
        if (!this.cullingPipeline) {
            throw new Error('Culling pipeline not created');
        }

        if (this.instanceCount === 0) return;
        
        // Reset draw count
        commandEncoder.clearBuffer(this.drawCountBuffer, 0, 4);

        // Create bind group
        this.cullingBindGroup = this._createCullingBindGroup(hiZTexture);
        
        const pass = commandEncoder.beginComputePass({ label: 'GPU Culling' });
        pass.setPipeline(this.cullingPipeline);
        pass.setBindGroup(0, this.cullingBindGroup);
        
        const workgroups = Math.ceil(this.instanceCount / 64);
        pass.dispatchWorkgroups(workgroups);
        pass.end();
    }

    /**
     * Get buffers for indirect draw call
     */
    getIndirectBuffer() {
        return this.indirectBuffer;
    }

    getDrawCountBuffer() {
        return this.drawCountBuffer;
    }

    getInstanceDataBuffer() {
        return this.instanceDataBuffer;
    }

    createIndirectDrawBindGroup(renderPipeline) {
        return this.device.createBindGroup({
            layout: renderPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.instanceDataBuffer } },
            ],
        });
    }

    destroy() {
        this.indirectBuffer.destroy();
        this.drawCountBuffer.destroy();
        this.instanceDataBuffer.destroy();
    }
}
