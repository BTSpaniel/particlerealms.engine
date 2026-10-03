/**
 * ConnectivityCompute.js - GPU-Accelerated Voxel Connectivity Analysis
 * 
 * Problem: When voxels are destroyed, we need to detect which parts
 * are still connected to anchors (ground) vs floating (should fall).
 * CPU flood-fill is O(n) and too slow for real-time destruction.
 * 
 * Solution: GPU wave propagation using ping-pong buffers.
 * Each iteration, voxels adopt the minimum component ID of their neighbors.
 * After log(n) iterations, all connected voxels share the same ID.
 * 
 * Algorithm:
 * 1. Initialize: Each solid voxel gets unique ID, anchors get ID=1
 * 2. Propagate: Each voxel takes min(self, neighbors) if solid
 * 3. Repeat until no changes (typically 10-20 iterations for 32³)
 * 4. Result: All voxels connected to anchors have ID=1, others form islands
 * 
 * Performance Target: <1ms for 32³ chunk (10-20 iterations)
 */

// Reusable buffers for hot paths (reduce/reuse/recycle)
const _connectivityUniformU32 = new Uint32Array(4);
const _connectivityChangeReset = new Uint32Array([0]);

import { createAlignedBuffer, STORAGE_ALIGN } from '../../core/gpu/BufferLayouts.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Maximum iterations before forcing stop (prevents infinite loops) */
export const MAX_ITERATIONS = 64;

/** Workgroup size for compute shaders */
export const WORKGROUP_SIZE = 8;

/** Component ID for anchored voxels (ground, supports) */
export const ANCHOR_COMPONENT_ID = 1;

/** Component ID for empty/air voxels */
export const EMPTY_COMPONENT_ID = 0;

// ============================================================================
// CONNECTIVITY COMPUTE CLASS
// ============================================================================

export class ConnectivityCompute {
    /**
     * @param {GPUDevice} device - WebGPU device
     * @param {Object} options - Configuration options
     */
    constructor(device, options = {}) {
        this.device = device;
        this.gridSize = options.gridSize ?? 32;
        this.initialized = false;
        
        // GPU resources
        this.componentBufferA = null;  // Ping buffer
        this.componentBufferB = null;  // Pong buffer
        this.changeCounterBuffer = null;
        this.readbackBuffer = null;
        
        // Pipelines
        this.initPipeline = null;
        this.propagatePipeline = null;
        this.bindGroupLayout = null;
        this.bindGroupA = null;
        this.bindGroupB = null;
        
        // Shader module
        this.shaderModule = null;
        
        // Stats
        this.lastIterationCount = 0;
        this.lastComputeTimeMs = 0;
    }
    
    /**
     * Initialize GPU resources and pipelines
     */
    async init() {
        const size = this.gridSize;
        const cellCount = size * size * size;
        const bufferSize = cellCount * 4; // u32 per cell
        
        // Create ping-pong component buffers
        this.componentBufferA = this.device.createBuffer({
            label: 'Connectivity Component A',
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        
        this.componentBufferB = this.device.createBuffer({
            label: 'Connectivity Component B',
            size: bufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        
        // Change counter (atomic)
        this.changeCounterBuffer = this.device.createBuffer({
            label: 'Connectivity Change Counter',
            size: 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        
        // Readback buffer for counter
        this.readbackBuffer = this.device.createBuffer({
            label: 'Connectivity Readback',
            size: 4,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        
        // Create shader module
        this.shaderModule = this.device.createShaderModule({
            label: 'Connectivity Compute Shader',
            code: FLOOD_FILL_SHADER,
        });
        
        // Create bind group layout
        this.bindGroupLayout = this.device.createBindGroupLayout({
            label: 'Connectivity Bind Group Layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            ],
        });
        
        // Create uniform buffer for grid size
        this.uniformBuffer = this.device.createBuffer({
            label: 'Connectivity Uniforms',
            size: 16, // vec3u + padding
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        // Write grid size to uniform - reuse buffer
        _connectivityUniformU32[0] = size;
        _connectivityUniformU32[1] = size;
        _connectivityUniformU32[2] = size;
        _connectivityUniformU32[3] = 0;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, _connectivityUniformU32);
        
        // Create pipeline layout
        const pipelineLayout = this.device.createPipelineLayout({
            label: 'Connectivity Pipeline Layout',
            bindGroupLayouts: [this.bindGroupLayout],
        });
        
        // Create propagate pipeline
        this.propagatePipeline = this.device.createComputePipeline({
            label: 'Connectivity Propagate Pipeline',
            layout: pipelineLayout,
            compute: {
                module: this.shaderModule,
                entryPoint: 'propagate',
            },
        });
        
        // Create bind groups for ping-pong
        this.bindGroupA = this.device.createBindGroup({
            label: 'Connectivity Bind Group A',
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.componentBufferA } },
                { binding: 1, resource: { buffer: this.componentBufferB } },
                { binding: 2, resource: { buffer: this.changeCounterBuffer } },
                { binding: 3, resource: { buffer: this.uniformBuffer } },
            ],
        });
        
        this.bindGroupB = this.device.createBindGroup({
            label: 'Connectivity Bind Group B',
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.componentBufferB } },
                { binding: 1, resource: { buffer: this.componentBufferA } },
                { binding: 2, resource: { buffer: this.changeCounterBuffer } },
                { binding: 3, resource: { buffer: this.uniformBuffer } },
            ],
        });
        
        this.initialized = true;
        console.log(`[ConnectivityCompute] Initialized for ${size}³ grid`);
    }
    
    /**
     * Initialize component IDs from voxel data
     * @param {Uint8Array|Uint32Array} voxelData - Voxel solid/empty flags
     * @param {Uint8Array} anchorMask - Which voxels are anchored (optional)
     */
    initializeFromVoxels(voxelData, anchorMask = null) {
        const size = this.gridSize;
        const cellCount = size * size * size;
        const componentData = new Uint32Array(cellCount);
        
        let nextComponentId = ANCHOR_COMPONENT_ID + 1;
        
        for (let i = 0; i < cellCount; i++) {
            if (voxelData[i] === 0) {
                // Empty voxel
                componentData[i] = EMPTY_COMPONENT_ID;
            } else if (anchorMask && anchorMask[i]) {
                // Anchored voxel (connected to ground)
                componentData[i] = ANCHOR_COMPONENT_ID;
            } else {
                // Solid voxel - assign unique ID
                componentData[i] = nextComponentId++;
            }
        }
        
        // Upload to GPU
        this.device.queue.writeBuffer(this.componentBufferA, 0, componentData);
    }
    
    /**
     * Run connectivity propagation until convergence
     * @returns {Promise<{ iterations: number, timeMs: number }>}
     */
    async compute() {
        if (!this.initialized) {
            throw new Error('ConnectivityCompute not initialized');
        }
        
        const startTime = performance.now();
        const size = this.gridSize;
        const workgroups = Math.ceil(size / WORKGROUP_SIZE);
        
        let iterations = 0;
        let useA = true;
        
        while (iterations < MAX_ITERATIONS) {
            // Reset change counter - reuse buffer
            this.device.queue.writeBuffer(this.changeCounterBuffer, 0, _connectivityChangeReset);
            
            // Create command encoder
            const encoder = this.device.createCommandEncoder();
            
            // Dispatch propagation
            const pass = encoder.beginComputePass();
            pass.setPipeline(this.propagatePipeline);
            pass.setBindGroup(0, useA ? this.bindGroupA : this.bindGroupB);
            pass.dispatchWorkgroups(workgroups, workgroups, workgroups);
            pass.end();
            
            // Copy counter to readback buffer
            encoder.copyBufferToBuffer(
                this.changeCounterBuffer, 0,
                this.readbackBuffer, 0, 4
            );
            
            // Submit
            this.device.queue.submit([encoder.finish()]);
            
            // Read back change count
            await this.readbackBuffer.mapAsync(GPUMapMode.READ);
            const changeCount = new Uint32Array(this.readbackBuffer.getMappedRange())[0];
            this.readbackBuffer.unmap();
            
            iterations++;
            
            // Converged if no changes
            if (changeCount === 0) {
                break;
            }
            
            // Swap buffers
            useA = !useA;
        }
        
        const endTime = performance.now();
        this.lastIterationCount = iterations;
        this.lastComputeTimeMs = endTime - startTime;
        
        return {
            iterations,
            timeMs: this.lastComputeTimeMs,
        };
    }
    
    /**
     * Read back component IDs to CPU
     * @returns {Promise<Uint32Array>}
     */
    async readComponents() {
        const size = this.gridSize;
        const cellCount = size * size * size;
        const bufferSize = cellCount * 4;
        
        // Create staging buffer
        const stagingBuffer = this.device.createBuffer({
            size: bufferSize,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        
        // Copy from current buffer
        const encoder = this.device.createCommandEncoder();
        encoder.copyBufferToBuffer(
            this.componentBufferA, 0,
            stagingBuffer, 0, bufferSize
        );
        this.device.queue.submit([encoder.finish()]);
        
        // Read back
        await stagingBuffer.mapAsync(GPUMapMode.READ);
        const data = new Uint32Array(stagingBuffer.getMappedRange().slice(0));
        stagingBuffer.unmap();
        stagingBuffer.destroy();
        
        return data;
    }
    
    /**
     * Get connected components as separate groups
     * @returns {Promise<Map<number, number[]>>} Map of componentId -> voxel indices
     */
    async getConnectedComponents() {
        const components = await this.readComponents();
        const groups = new Map();
        
        for (let i = 0; i < components.length; i++) {
            const id = components[i];
            if (id === EMPTY_COMPONENT_ID) continue;
            
            if (!groups.has(id)) {
                groups.set(id, []);
            }
            groups.get(id).push(i);
        }
        
        return groups;
    }
    
    /**
     * Get indices of floating (unanchored) voxels
     * @returns {Promise<number[]>}
     */
    async getFloatingVoxels() {
        const components = await this.readComponents();
        const floating = [];
        
        for (let i = 0; i < components.length; i++) {
            const id = components[i];
            // Floating = solid but not connected to anchor
            if (id !== EMPTY_COMPONENT_ID && id !== ANCHOR_COMPONENT_ID) {
                floating.push(i);
            }
        }
        
        return floating;
    }
    
    /**
     * Destroy GPU resources
     */
    destroy() {
        this.componentBufferA?.destroy();
        this.componentBufferB?.destroy();
        this.changeCounterBuffer?.destroy();
        this.readbackBuffer?.destroy();
        this.uniformBuffer?.destroy();
        this.initialized = false;
    }
}

// ============================================================================
// EMBEDDED SHADER CODE
// ============================================================================

const FLOOD_FILL_SHADER = /* wgsl */`
// Connectivity Wave Propagation Shader
// Each iteration, voxels adopt minimum component ID from neighbors

struct Uniforms {
    gridSize: vec3u,
    pad: u32,
}

@group(0) @binding(0) var<storage, read> componentsIn: array<u32>;
@group(0) @binding(1) var<storage, read_write> componentsOut: array<u32>;
@group(0) @binding(2) var<storage, read_write> changeCounter: atomic<u32>;
@group(0) @binding(3) var<uniform> uniforms: Uniforms;

// 6-connected neighborhood offsets
const NEIGHBOR_OFFSETS: array<vec3i, 6> = array<vec3i, 6>(
    vec3i(-1, 0, 0), vec3i(1, 0, 0),
    vec3i(0, -1, 0), vec3i(0, 1, 0),
    vec3i(0, 0, -1), vec3i(0, 0, 1)
);

fn gridIndex(pos: vec3u) -> u32 {
    let size = uniforms.gridSize;
    return pos.x + pos.y * size.x + pos.z * size.x * size.y;
}

fn isValidPos(pos: vec3i) -> bool {
    let size = vec3i(uniforms.gridSize);
    return pos.x >= 0 && pos.x < size.x &&
           pos.y >= 0 && pos.y < size.y &&
           pos.z >= 0 && pos.z < size.z;
}

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn propagate(@builtin(global_invocation_id) gid: vec3u) {
    let size = uniforms.gridSize;
    
    // Bounds check
    if (gid.x >= size.x || gid.y >= size.y || gid.z >= size.z) {
        return;
    }
    
    let idx = gridIndex(gid);
    let myComponent = componentsIn[idx];
    
    // Skip empty voxels
    if (myComponent == 0u) {
        componentsOut[idx] = 0u;
        return;
    }
    
    // Find minimum component among self and neighbors
    var minComponent = myComponent;
    let pos = vec3i(gid);
    
    for (var i = 0u; i < 6u; i++) {
        let neighborPos = pos + NEIGHBOR_OFFSETS[i];
        
        if (isValidPos(neighborPos)) {
            let neighborIdx = gridIndex(vec3u(neighborPos));
            let neighborComponent = componentsIn[neighborIdx];
            
            // Only consider solid neighbors (component > 0)
            if (neighborComponent > 0u && neighborComponent < minComponent) {
                minComponent = neighborComponent;
            }
        }
    }
    
    // Write result
    componentsOut[idx] = minComponent;
    
    // Track if we made a change
    if (minComponent != myComponent) {
        atomicAdd(&changeCounter, 1u);
    }
}
`;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Convert 1D index to 3D position
 * @param {number} idx - Linear index
 * @param {number} size - Grid size
 * @returns {[number, number, number]}
 */
export function indexTo3D(idx, size) {
    const z = Math.floor(idx / (size * size));
    const rem = idx % (size * size);
    const y = Math.floor(rem / size);
    const x = rem % size;
    return [x, y, z];
}

/**
 * Convert 3D position to 1D index
 * @param {number} x 
 * @param {number} y 
 * @param {number} z 
 * @param {number} size - Grid size
 * @returns {number}
 */
export function positionToIndex(x, y, z, size) {
    return x + y * size + z * size * size;
}

export default ConnectivityCompute;
