// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * VoxelModifyCompute.js - GPU Voxel Modification System
 * Now powered by vGPU driver
 * 
 * Performs sphere and box removal operations on voxel chunks using compute shaders.
 * Outputs removed voxels for particle spawning.
 */

import { initVGPU } from '../core/gpu/VirtualGPU.js';
import { CHUNK_SIZE, CHUNK_VOLUME } from './VoxelConstants.js';
import { MATERIAL } from './MaterialSchema.js';

// ============================================================================
// SHADER SOURCE (embedded for single-file deployment)
// ============================================================================

const VOXEL_MODIFY_SHADER = /* wgsl */ `
// Constants
const CHUNK_SIZE: u32 = 32u;
const CHUNK_SIZE_SQ: u32 = 1024u;
const CHUNK_VOLUME: u32 = 32768u;
const MATERIAL_AIR: u32 = 0u;

struct ModifyParams {
    centerX: f32,
    centerY: f32,
    centerZ: f32,
    radius: f32,
    boxMinX: f32,
    boxMinY: f32,
    boxMinZ: f32,
    boxMaxX: f32,
    boxMaxY: f32,
    boxMaxZ: f32,
    chunkOriginX: f32,
    chunkOriginY: f32,
    chunkOriginZ: f32,
    mode: u32,
    innerRadiusFactor: f32,
    maxParticles: u32,
    material: u32,
    _pad0: u32,
}

struct RemovedVoxel {
    x: f32,
    y: f32,
    z: f32,
    material: u32,
    dx: f32,
    dy: f32,
    dz: f32,
    dist: f32,
}

@group(0) @binding(0) var<uniform> params: ModifyParams;
@group(0) @binding(1) var<storage, read_write> voxels: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> removedVoxels: array<RemovedVoxel>;
@group(0) @binding(3) var<storage, read_write> removedCount: atomic<u32>;

fn getVoxel(idx: u32) -> u32 {
    let wordIdx = idx / 4u;
    let byteIdx = idx % 4u;
    let word = atomicLoad(&voxels[wordIdx]);
    return (word >> (byteIdx * 8u)) & 0xFFu;
}

fn setVoxelAir(idx: u32) {
    let wordIdx = idx / 4u;
    let byteIdx = idx % 4u;
    let mask = 0xFFu << (byteIdx * 8u);
    atomicAnd(&voxels[wordIdx], ~mask);
}

fn setVoxelMaterial(idx: u32, material: u32) {
    let wordIdx = idx / 4u;
    let byteIdx = idx % 4u;
    let shift = byteIdx * 8u;
    let mask = 0xFFu << shift;
    atomicAnd(&voxels[wordIdx], ~mask);
    atomicOr(&voxels[wordIdx], (material & 0xFFu) << shift);
}

fn localToIndex(lx: u32, ly: u32, lz: u32) -> u32 {
    return lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE_SQ;
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let lx = gid.x;
    let ly = gid.y;
    let lz = gid.z;
    
    if (lx >= CHUNK_SIZE || ly >= CHUNK_SIZE || lz >= CHUNK_SIZE) {
        return;
    }
    
    let idx = localToIndex(lx, ly, lz);
    let material = getVoxel(idx);
    
    if (material == MATERIAL_AIR && params.mode != 2u) {
        return;
    }
    
    let wx = params.chunkOriginX + f32(lx) + 0.5;
    let wy = params.chunkOriginY + f32(ly) + 0.5;
    let wz = params.chunkOriginZ + f32(lz) + 0.5;
    
    var shouldRemove = false;
    var dx = 0.0;
    var dy = 0.0;
    var dz = 0.0;
    var dist = 0.0;
    
    if (params.mode == 0u) {
        dx = wx - params.centerX;
        dy = wy - params.centerY;
        dz = wz - params.centerZ;
        let dsq = dx * dx + dy * dy + dz * dz;
        dist = sqrt(dsq);
        let innerRadiusSq = params.radius * params.radius * params.innerRadiusFactor;
        if (dsq < innerRadiusSq) {
            shouldRemove = true;
        }
    } else if (params.mode == 1u) {
        if (wx >= params.boxMinX && wx <= params.boxMaxX &&
            wy >= params.boxMinY && wy <= params.boxMaxY &&
            wz >= params.boxMinZ && wz <= params.boxMaxZ) {
            shouldRemove = true;
            let cx = (params.boxMinX + params.boxMaxX) * 0.5;
            let cy = (params.boxMinY + params.boxMaxY) * 0.5;
            let cz = (params.boxMinZ + params.boxMaxZ) * 0.5;
            dx = wx - cx;
            dy = wy - cy;
            dz = wz - cz;
            dist = sqrt(dx * dx + dy * dy + dz * dz);
        }
    } else {
        dx = wx - params.centerX;
        dy = wy - params.centerY;
        dz = wz - params.centerZ;
        let dsq = dx * dx + dy * dy + dz * dz;
        dist = sqrt(dsq);
        shouldRemove = dsq <= params.radius * params.radius;
    }

    if (params.mode == 2u && shouldRemove) {
        setVoxelMaterial(idx, params.material);
        return;
    }
    
    if (shouldRemove) {
        setVoxelAir(idx);
        
        let removeIdx = atomicAdd(&removedCount, 1u);
        if (removeIdx < params.maxParticles) {
            let invDist = select(0.0, 1.0 / dist, dist > 0.001);
            removedVoxels[removeIdx] = RemovedVoxel(
                wx, wy, wz, material,
                dx * invDist, dy * invDist, dz * invDist, dist
            );
        }
    }
}
`;

// ============================================================================
// VOXEL MODIFY COMPUTE CLASS
// ============================================================================

export class VoxelModifyCompute {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.pipeline = null;
        this.bindGroupLayout = null;
        
        // Buffers (reused per operation)
        this.paramsBuffer = null;
        this.removedVoxelsBuffer = null;
        this.removedCountBuffer = null;
        this.readbackBuffer = null;
        this.countReadbackBuffer = null;
        
        // Config
        this.maxRemovedVoxels = 4096;  // Max particles to spawn
        
        // Pre-allocated typed arrays to avoid per-operation allocations
        this._paramsData = new Float32Array(20);
        this._paramsUint = new Uint32Array(this._paramsData.buffer);
        this._removedCountReset = new Uint32Array([0]);
        this._packedVoxels = new Uint32Array(Math.ceil(CHUNK_VOLUME / 4));
        this._gpuChunkBuffers = new Map();
        
        this.initialized = false;
    }
    
    /**
     * Initialize the compute system
     * @param {GPUDevice} device 
     */
    async init(device) {
        this.vgpu = initVGPU(device);
        this.device = device;
        
        // Compile shader using vGPU
        const shaderModule = this.vgpu.shader.compile('voxelModify', VOXEL_MODIFY_SHADER);
        
        // Define bind group layout using vGPU
        this.bindGroupLayout = this.vgpu.bindings.defineLayout('voxelModify', [
            { binding: 0, type: 'uniform', visibility: 'compute' },
            { binding: 1, type: 'storage', visibility: 'compute' },
            { binding: 2, type: 'storage', visibility: 'compute' },
            { binding: 3, type: 'storage', visibility: 'compute' },
        ]);
        
        // Create pipeline using vGPU
        this.pipeline = this.vgpu.pipeline.compute({
            module: shaderModule, entryPoint: 'main',
            layouts: [this.bindGroupLayout], label: 'VoxelModifyPipeline'
        });
        
        // Create buffers using vGPU
        this.paramsBuffer = this.vgpu.buffer.create({ size: 80, usage: 'uniform', label: 'VoxelModifyParams' }).buffer;
        this.removedVoxelsBuffer = this.vgpu.buffer.create({ size: this.maxRemovedVoxels * 32, usage: 'storage|copy-src', label: 'RemovedVoxels' }).buffer;
        this.removedCountBuffer = this.vgpu.buffer.create({ size: 4, usage: 'storage|copy-src', label: 'RemovedCount' }).buffer;
        this.readbackBuffer = this.vgpu.buffer.create({ size: this.maxRemovedVoxels * 32, usage: 'map-read|copy-dst', label: 'RemovedVoxelsReadback' }).buffer;
        this.countReadbackBuffer = this.vgpu.buffer.create({ size: 4, usage: 'map-read|copy-dst', label: 'RemovedCountReadback' }).buffer;
        
        this.initialized = true;
        console.log('[VoxelModifyCompute] Initialized with vGPU');
    }
    
    /**
     * Remove voxels in a sphere using GPU compute
     * @param {VoxelChunk} chunk - Chunk to modify
     * @param {number[]} center - [x, y, z] world center
     * @param {number} radius - Sphere radius
     * @param {number} innerFactor - Inner radius factor (0.6 = crater bowl)
     * @returns {Promise<Array>} Removed voxels for particle spawning
     */
    async removeSphere(chunk, center, radius, innerFactor = 0.6) {
        if (!this.initialized) {
            console.warn('[VoxelModifyCompute] Not initialized');
            return [];
        }
        
        // Expand homogeneous chunks first
        if (chunk.isHomogeneous) {
            chunk.expand();
        }
        
        const [cx, cy, cz] = center;
        const [ox, oy, oz] = chunk.getWorldOrigin();
        
        // Check if sphere intersects this chunk
        const chunkMin = [ox, oy, oz];
        const chunkMax = [ox + CHUNK_SIZE, oy + CHUNK_SIZE, oz + CHUNK_SIZE];
        
        // Quick AABB-sphere test
        const closestX = Math.max(chunkMin[0], Math.min(cx, chunkMax[0]));
        const closestY = Math.max(chunkMin[1], Math.min(cy, chunkMax[1]));
        const closestZ = Math.max(chunkMin[2], Math.min(cz, chunkMax[2]));
        const distSq = (cx - closestX) ** 2 + (cy - closestY) ** 2 + (cz - closestZ) ** 2;
        
        if (distSq > radius * radius) {
            return [];  // Sphere doesn't intersect chunk
        }
        
        return this._executeModify(chunk, {
            mode: 0,  // Sphere
            center: [cx, cy, cz],
            radius,
            innerFactor,
            box: [0, 0, 0, 0, 0, 0],
            origin: [ox, oy, oz],
        });
    }
    
    /**
     * Remove voxels in a box using GPU compute
     * @param {VoxelChunk} chunk - Chunk to modify
     * @param {number[]} min - [x, y, z] box min corner
     * @param {number[]} max - [x, y, z] box max corner
     * @returns {Promise<Array>} Removed voxels for particle spawning
     */
    async removeBox(chunk, min, max) {
        if (!this.initialized) {
            console.warn('[VoxelModifyCompute] Not initialized');
            return [];
        }
        
        if (chunk.isHomogeneous) {
            chunk.expand();
        }
        
        const [ox, oy, oz] = chunk.getWorldOrigin();
        
        // Check if box intersects this chunk
        const chunkMin = [ox, oy, oz];
        const chunkMax = [ox + CHUNK_SIZE, oy + CHUNK_SIZE, oz + CHUNK_SIZE];
        
        if (max[0] < chunkMin[0] || min[0] > chunkMax[0] ||
            max[1] < chunkMin[1] || min[1] > chunkMax[1] ||
            max[2] < chunkMin[2] || min[2] > chunkMax[2]) {
            return [];  // No intersection
        }
        
        return this._executeModify(chunk, {
            mode: 1,  // Box
            center: [0, 0, 0],
            radius: 0,
            innerFactor: 1.0,
            box: [min[0], min[1], min[2], max[0], max[1], max[2]],
            origin: [ox, oy, oz],
        });
    }

    /**
     * Paint voxels in a sphere using the GPU compute kernel.
     * @param {VoxelChunk} chunk - Chunk to modify
     * @param {number[]} center - [x, y, z] world center
     * @param {number} radius - Sphere radius
     * @param {number} material - Material id to write
     * @returns {Promise<Array>} Empty removal result for API compatibility
     */
    async paintSphere(chunk, center, radius, material) {
        if (!this.initialized) {
            console.warn('[VoxelModifyCompute] Not initialized');
            return [];
        }

        if (chunk.isHomogeneous) {
            chunk.expand();
        }

        const [cx, cy, cz] = center;
        const [ox, oy, oz] = chunk.getWorldOrigin();
        const chunkMin = [ox, oy, oz];
        const chunkMax = [ox + CHUNK_SIZE, oy + CHUNK_SIZE, oz + CHUNK_SIZE];
        const closestX = Math.max(chunkMin[0], Math.min(cx, chunkMax[0]));
        const closestY = Math.max(chunkMin[1], Math.min(cy, chunkMax[1]));
        const closestZ = Math.max(chunkMin[2], Math.min(cz, chunkMax[2]));
        const distSq = (cx - closestX) ** 2 + (cy - closestY) ** 2 + (cz - closestZ) ** 2;
        if (distSq > radius * radius) {
            return [];
        }

        return this._executeModify(chunk, {
            mode: 2,
            center: [cx, cy, cz],
            radius,
            innerFactor: 1.0,
            material: Number(material) >>> 0,
            box: [0, 0, 0, 0, 0, 0],
            origin: [ox, oy, oz],
        });
    }

    /**
     * Apply a sphere edit directly to a persistent GPU-resident chunk.
     * This is the interactive path and intentionally does not read the chunk
     * back to CPU memory or produce removed-voxel particle records.
     * @param {VoxelChunk} chunk - Chunk to modify
     * @param {number[]} center - [x, y, z] world center
     * @param {number} radius - Sphere radius
     * @param {object} options - { mode: 'paint'|'erase', material?: number }
     * @returns {Promise<void>}
     */
    async modifySphereGPU(chunk, center, radius, options = {}) {
        if (!this.initialized) return;
        if (chunk.isHomogeneous) chunk.expand();
        const [ox, oy, oz] = chunk.getWorldOrigin();
        const [cx, cy, cz] = center;
        const chunkMin = [ox, oy, oz];
        const chunkMax = [ox + CHUNK_SIZE, oy + CHUNK_SIZE, oz + CHUNK_SIZE];
        const closestX = Math.max(chunkMin[0], Math.min(cx, chunkMax[0]));
        const closestY = Math.max(chunkMin[1], Math.min(cy, chunkMax[1]));
        const closestZ = Math.max(chunkMin[2], Math.min(cz, chunkMax[2]));
        const distSq = (cx - closestX) ** 2 + (cy - closestY) ** 2 + (cz - closestZ) ** 2;
        if (distSq > radius * radius) return;
        chunk.isDirty = true;
        chunk.invalidateMeshCache?.();
        return this._executeModifyGPU(chunk, {
            mode: options.mode === 'paint' ? 2 : 0,
            center: [cx, cy, cz],
            radius,
            innerFactor: options.mode === 'paint' ? 1 : (options.innerFactor ?? 0.6),
            material: Number(options.material ?? MATERIAL.AIR) >>> 0,
            box: [0, 0, 0, 0, 0, 0],
            origin: [ox, oy, oz],
        });
    }

    _ensureGPUChunkBuffer(chunk) {
        let buffer = this._gpuChunkBuffers.get(chunk);
        if (buffer) return buffer;
        const packed = this._packedVoxels;
        packed.fill(0);
        for (let i = 0; i < CHUNK_VOLUME; i++) {
            packed[Math.floor(i / 4)] |= (chunk.voxels[i] & 0xFF) << ((i % 4) * 8);
        }
        buffer = this.device.createBuffer({
            label: 'VoxelModify GPU Resident Chunk',
            size: packed.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        this.device.queue.writeBuffer(buffer, 0, packed);
        this._gpuChunkBuffers.set(chunk, buffer);
        chunk.gpuBuffer = buffer;
        chunk.gpuResident = true;
        return buffer;
    }

    async _executeModifyGPU(chunk, params) {
        const voxelBuffer = this._ensureGPUChunkBuffer(chunk);
        const paramsBuffer = this.device.createBuffer({
            label: 'VoxelModify GPU Stroke Params',
            size: 80,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        const paramsData = this._paramsData;
        paramsData[0] = params.center[0]; paramsData[1] = params.center[1]; paramsData[2] = params.center[2]; paramsData[3] = params.radius;
        paramsData[4] = params.box[0]; paramsData[5] = params.box[1]; paramsData[6] = params.box[2]; paramsData[7] = params.box[3];
        paramsData[8] = params.box[4]; paramsData[9] = params.box[5]; paramsData[10] = params.origin[0]; paramsData[11] = params.origin[1];
        paramsData[12] = params.origin[2]; paramsData[14] = params.innerFactor;
        this._paramsUint[13] = params.mode;
        this._paramsUint[15] = 0;
        this._paramsUint[16] = params.material;
        this._paramsUint[17] = 0;
        this.device.queue.writeBuffer(paramsBuffer, 0, paramsData);
        const bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: paramsBuffer } },
                { binding: 1, resource: { buffer: voxelBuffer } },
                { binding: 2, resource: { buffer: this.removedVoxelsBuffer } },
                { binding: 3, resource: { buffer: this.removedCountBuffer } },
            ],
        });
        const encoder = this.device.createCommandEncoder({ label: 'VoxelModify GPU Stroke' });
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(8, 8, 8);
        pass.end();
        this.device.queue.submit([encoder.finish()]);
        const completion = this.device.queue.onSubmittedWorkDone?.();
        completion?.then(() => paramsBuffer.destroy()).catch(() => paramsBuffer.destroy());
    }

    /**
     * Synchronize a GPU-resident chunk back to its CPU representation for
     * legacy raycasts, CPU meshing, serialization, or diagnostics.
     * @param {VoxelChunk} chunk - Chunk to synchronize
     * @returns {Promise<VoxelChunk>}
     */
    async syncChunkGPU(chunk) {
        const source = this._gpuChunkBuffers.get(chunk);
        if (!source) return chunk;
        const readback = this.device.createBuffer({
            label: 'VoxelModify GPU Chunk Sync Readback',
            size: this._packedVoxels.byteLength,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        const encoder = this.device.createCommandEncoder({ label: 'VoxelModify GPU Chunk Sync' });
        encoder.copyBufferToBuffer(source, 0, readback, 0, this._packedVoxels.byteLength);
        this.device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const packed = new Uint32Array(readback.getMappedRange());
        let solidCount = 0;
        for (let i = 0; i < CHUNK_VOLUME; i++) {
            const material = (packed[Math.floor(i / 4)] >> ((i % 4) * 8)) & 0xFF;
            chunk.voxels[i] = material;
            if (material !== MATERIAL.AIR) solidCount++;
        }
        chunk.solidCount = solidCount;
        chunk.isDirty = true;
        chunk.invalidateMeshCache?.();
        readback.unmap();
        readback.destroy();
        return chunk;
    }

    clearChunkGPU(chunk) {
        const buffer = this._gpuChunkBuffers.get(chunk);
        if (!buffer) return;
        this._packedVoxels.fill(0);
        this.device.queue.writeBuffer(buffer, 0, this._packedVoxels);
        chunk.voxels.fill(MATERIAL.AIR);
        chunk.solidCount = 0;
        chunk.isDirty = true;
        chunk.invalidateMeshCache?.();
    }
    
    /**
     * Execute the compute shader
     * @private
     */
    async _executeModify(chunk, params) {
        const device = this.device;
        
        // Create chunk voxel buffer (packed: 4 voxels per u32)
        // Use pre-allocated buffer to avoid per-operation allocation
        const packedVoxels = this._packedVoxels;
        packedVoxels.fill(0);  // Clear previous data
        
        // Pack voxels: 4 bytes per u32
        for (let i = 0; i < CHUNK_VOLUME; i++) {
            const wordIdx = Math.floor(i / 4);
            const byteIdx = i % 4;
            packedVoxels[wordIdx] |= (chunk.voxels[i] & 0xFF) << (byteIdx * 8);
        }
        
        const voxelBuffer = device.createBuffer({
            label: 'Chunk Voxels',
            size: packedVoxels.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(voxelBuffer, 0, packedVoxels);
        
        // Write params (use pre-allocated buffer)
        const paramsData = this._paramsData;
        paramsData[0] = params.center[0]; paramsData[1] = params.center[1]; paramsData[2] = params.center[2]; paramsData[3] = params.radius;
        paramsData[4] = params.box[0]; paramsData[5] = params.box[1]; paramsData[6] = params.box[2]; paramsData[7] = params.box[3];
        paramsData[8] = params.box[4]; paramsData[9] = params.box[5]; paramsData[10] = params.origin[0]; paramsData[11] = params.origin[1];
        paramsData[12] = params.origin[2]; paramsData[14] = params.innerFactor;
        this._paramsUint[13] = params.mode;
        this._paramsUint[15] = this.maxRemovedVoxels;
        this._paramsUint[16] = params.material ?? MATERIAL.AIR;
        this._paramsUint[17] = 0;
        device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);
        
        // Reset removed count (use pre-allocated buffer)
        device.queue.writeBuffer(this.removedCountBuffer, 0, this._removedCountReset);
        
        // Create bind group
        const bindGroup = device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.paramsBuffer } },
                { binding: 1, resource: { buffer: voxelBuffer } },
                { binding: 2, resource: { buffer: this.removedVoxelsBuffer } },
                { binding: 3, resource: { buffer: this.removedCountBuffer } },
            ],
        });
        
        // Dispatch compute
        const commandEncoder = device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.dispatchWorkgroups(8, 8, 8);  // 32/4 = 8 per dimension with 4x4x4 workgroup
        passEncoder.end();
        
        // Copy results back
        commandEncoder.copyBufferToBuffer(this.removedCountBuffer, 0, this.countReadbackBuffer, 0, 4);
        commandEncoder.copyBufferToBuffer(this.removedVoxelsBuffer, 0, this.readbackBuffer, 0, this.maxRemovedVoxels * 32);
        
        device.queue.submit([commandEncoder.finish()]);
        
        // Read back count
        await this.countReadbackBuffer.mapAsync(GPUMapMode.READ);
        const countData = new Uint32Array(this.countReadbackBuffer.getMappedRange());
        const removedCount = countData[0];
        this.countReadbackBuffer.unmap();
        
        // Read back modified voxels
        const voxelReadback = device.createBuffer({
            size: packedVoxels.byteLength,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        
        const encoder2 = device.createCommandEncoder();
        encoder2.copyBufferToBuffer(voxelBuffer, 0, voxelReadback, 0, packedVoxels.byteLength);
        device.queue.submit([encoder2.finish()]);
        
        await voxelReadback.mapAsync(GPUMapMode.READ);
        const modifiedPacked = new Uint32Array(voxelReadback.getMappedRange());
        
        // Unpack back to chunk
        let solidCount = 0;
        for (let i = 0; i < CHUNK_VOLUME; i++) {
            const wordIdx = Math.floor(i / 4);
            const byteIdx = i % 4;
            const material = (modifiedPacked[wordIdx] >> (byteIdx * 8)) & 0xFF;
            chunk.voxels[i] = material;
            if (material !== MATERIAL.AIR) solidCount++;
        }
        chunk.solidCount = solidCount;
        chunk.isDirty = true;
        chunk.invalidateMeshCache?.();  // Voxels changed, mesh cache invalid
        
        voxelReadback.unmap();
        voxelBuffer.destroy();
        voxelReadback.destroy();
        
        // Read removed voxels if any
        const removed = [];
        if (removedCount > 0) {
            await this.readbackBuffer.mapAsync(GPUMapMode.READ);
            const removedData = new Float32Array(this.readbackBuffer.getMappedRange());
            
            for (let i = 0; i < Math.min(removedCount, this.maxRemovedVoxels); i++) {
                const offset = i * 8;  // 8 floats per voxel
                removed.push({
                    x: removedData[offset + 0],
                    y: removedData[offset + 1],
                    z: removedData[offset + 2],
                    material: removedData[offset + 3],  // Actually u32
                    dx: removedData[offset + 4],
                    dy: removedData[offset + 5],
                    dz: removedData[offset + 6],
                    dist: removedData[offset + 7],
                });
            }
            
            this.readbackBuffer.unmap();
        }
        
        return removed;
    }
    
    /**
     * Destroy GPU resources
     */
    destroy() {
        this.paramsBuffer?.destroy();
        this.removedVoxelsBuffer?.destroy();
        this.removedCountBuffer?.destroy();
        this.readbackBuffer?.destroy();
        this.countReadbackBuffer?.destroy();
        for (const buffer of this._gpuChunkBuffers.values()) buffer.destroy();
        this._gpuChunkBuffers.clear();
        this.initialized = false;
    }
}

export default VoxelModifyCompute;
