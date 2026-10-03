// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * BitonicSort.js - GPU Bitonic Sort for Particle Cache Locality
 * 
 * Implements bitonic merge sort on the GPU for:
 * - Particle spatial sorting (Morton code ordering)
 * - Front-to-back rendering order
 * - Cache-coherent memory access patterns
 * 
 * Algorithm:
 * - Bitonic sort is a parallel sorting network
 * - O(n log²n) comparisons but highly parallelizable
 * - Each pass compares pairs at specific distances
 * - Builds bitonic sequences, then merges them
 * 
 * Performance Target: Sort 100k particles in <2ms
 */

// Reusable buffer for hot paths (reduce/reuse/recycle)
const _bitonicUniformData = new Uint32Array(4);

// ============================================================================
// CONSTANTS
// ============================================================================

/** Sort key types */
export const SortKeyType = {
    MORTON_CODE: 0,     // Spatial locality (Z-order curve)
    DEPTH: 1,           // Camera depth (front-to-back)
    DISTANCE: 2,        // Distance from point
    CUSTOM: 3,          // User-defined key
};

/** Maximum elements (must be power of 2) */
export const MAX_ELEMENTS = 1 << 20; // 1M elements

// ============================================================================
// MORTON CODE UTILITIES
// ============================================================================

/**
 * Expand a 10-bit integer into 30 bits by inserting 2 zeros between each bit
 */
function expandBits(v) {
    v = (v * 0x00010001) & 0xFF0000FF;
    v = (v * 0x00000101) & 0x0F00F00F;
    v = (v * 0x00000011) & 0xC30C30C3;
    v = (v * 0x00000005) & 0x49249249;
    return v;
}

/**
 * Calculate 30-bit Morton code for 3D position
 * @param {number} x - X coordinate (0-1023)
 * @param {number} y - Y coordinate (0-1023)
 * @param {number} z - Z coordinate (0-1023)
 * @returns {number} Morton code
 */
export function encodeMorton3D(x, y, z) {
    x = Math.min(Math.max(Math.floor(x), 0), 1023);
    y = Math.min(Math.max(Math.floor(y), 0), 1023);
    z = Math.min(Math.max(Math.floor(z), 0), 1023);
    return expandBits(x) | (expandBits(y) << 1) | (expandBits(z) << 2);
}

/**
 * Calculate Morton code from world position
 * @param {number[]} pos - World position [x, y, z]
 * @param {number[]} boundsMin - Minimum bounds
 * @param {number[]} boundsMax - Maximum bounds
 * @returns {number}
 */
export function positionToMorton(pos, boundsMin, boundsMax) {
    const scale = 1023;
    const x = ((pos[0] - boundsMin[0]) / (boundsMax[0] - boundsMin[0])) * scale;
    const y = ((pos[1] - boundsMin[1]) / (boundsMax[1] - boundsMin[1])) * scale;
    const z = ((pos[2] - boundsMin[2]) / (boundsMax[2] - boundsMin[2])) * scale;
    return encodeMorton3D(x, y, z);
}

// ============================================================================
// BITONIC SORTER
// ============================================================================

export class BitonicSorter {
    /**
     * @param {GPUDevice} device 
     * @param {Object} options 
     */
    constructor(device, options = {}) {
        this.device = device;
        
        this.maxElements = options.maxElements ?? 131072; // 128k default
        this.workgroupSize = options.workgroupSize ?? 256;
        
        // Buffers
        this.keyBuffer = null;
        this.valueBuffer = null;
        this.tempKeyBuffer = null;
        this.tempValueBuffer = null;
        
        // Pipelines
        this.localSortPipeline = null;
        this.globalFlipPipeline = null;
        this.globalDispersePipeline = null;
        
        this.uniformBuffer = null;
        
        this.initialized = false;
    }
    
    async init() {
        // Round up to power of 2
        this.paddedSize = this._nextPowerOf2(this.maxElements);
        
        // Create buffers
        this.keyBuffer = this.device.createBuffer({
            label: 'Bitonic Keys',
            size: this.paddedSize * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        
        this.valueBuffer = this.device.createBuffer({
            label: 'Bitonic Values',
            size: this.paddedSize * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        
        this.uniformBuffer = this.device.createBuffer({
            label: 'Bitonic Uniforms',
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        // Create pipelines
        await this._createPipelines();
        
        this.initialized = true;
    }
    
    _nextPowerOf2(n) {
        n--;
        n |= n >> 1;
        n |= n >> 2;
        n |= n >> 4;
        n |= n >> 8;
        n |= n >> 16;
        return n + 1;
    }
    
    async _createPipelines() {
        const shaderModule = this.device.createShaderModule({
            label: 'Bitonic Sort Shader',
            code: BITONIC_SORT_SHADER,
        });
        
        // Local sort (within workgroup using shared memory)
        this.localSortPipeline = this.device.createComputePipeline({
            label: 'Bitonic Local Sort',
            layout: 'auto',
            compute: {
                module: shaderModule,
                entryPoint: 'localSort',
            },
        });
        
        // Global flip (compare across workgroups)
        this.globalFlipPipeline = this.device.createComputePipeline({
            label: 'Bitonic Global Flip',
            layout: 'auto',
            compute: {
                module: shaderModule,
                entryPoint: 'globalFlip',
            },
        });
        
        // Global disperse (disperse within subsequence)
        this.globalDispersePipeline = this.device.createComputePipeline({
            label: 'Bitonic Global Disperse',
            layout: 'auto',
            compute: {
                module: shaderModule,
                entryPoint: 'globalDisperse',
            },
        });
    }
    
    /**
     * Sort key-value pairs
     * @param {GPUCommandEncoder} encoder 
     * @param {GPUBuffer} keyBuffer - Buffer containing sort keys
     * @param {GPUBuffer} valueBuffer - Buffer containing indices/values
     * @param {number} count - Number of elements to sort
     */
    sort(encoder, keyBuffer, valueBuffer, count) {
        if (!this.initialized) return;
        
        const n = this._nextPowerOf2(count);
        
        // Create bind groups
        const bindGroup = this.device.createBindGroup({
            layout: this.localSortPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: { buffer: keyBuffer } },
                { binding: 2, resource: { buffer: valueBuffer } },
            ],
        });
        
        const workgroups = Math.ceil(n / (this.workgroupSize * 2));
        
        // Bitonic sort consists of log2(n) stages
        const stages = Math.log2(n);
        
        for (let stage = 0; stage < stages; stage++) {
            const stageSize = 1 << (stage + 1);
            
            for (let passOfStage = 0; passOfStage <= stage; passOfStage++) {
                const passSize = 1 << (stage - passOfStage);
                
                // Update uniforms - reuse buffer
                _bitonicUniformData[0] = n;
                _bitonicUniformData[1] = stageSize;
                _bitonicUniformData[2] = passSize;
                _bitonicUniformData[3] = 0;
                this.device.queue.writeBuffer(this.uniformBuffer, 0, _bitonicUniformData);
                
                const pass = encoder.beginComputePass();
                
                if (passOfStage === 0) {
                    // Global flip
                    pass.setPipeline(this.globalFlipPipeline);
                } else {
                    // Global disperse
                    pass.setPipeline(this.globalDispersePipeline);
                }
                
                pass.setBindGroup(0, bindGroup);
                pass.dispatchWorkgroups(workgroups);
                pass.end();
            }
        }
    }
    
    /**
     * Sort particles by Morton code for cache locality
     * @param {GPUCommandEncoder} encoder 
     * @param {GPUBuffer} positionBuffer - Particle positions (vec4)
     * @param {GPUBuffer} indexBuffer - Output sorted indices
     * @param {number} count 
     * @param {number[]} boundsMin 
     * @param {number[]} boundsMax 
     */
    sortByMorton(encoder, positionBuffer, indexBuffer, count, boundsMin, boundsMax) {
        // Would need a compute pass to generate Morton codes first
        // Then sort using the codes as keys
        this.sort(encoder, this.keyBuffer, indexBuffer, count);
    }
    
    /**
     * Sort by camera depth for transparency
     * @param {GPUCommandEncoder} encoder 
     * @param {GPUBuffer} positionBuffer 
     * @param {GPUBuffer} indexBuffer 
     * @param {number} count 
     * @param {Float32Array} viewMatrix 
     */
    sortByDepth(encoder, positionBuffer, indexBuffer, count, viewMatrix) {
        // Would compute depth = dot(position, viewDir) as key
        this.sort(encoder, this.keyBuffer, indexBuffer, count);
    }
    
    destroy() {
        this.keyBuffer?.destroy();
        this.valueBuffer?.destroy();
        this.uniformBuffer?.destroy();
        this.initialized = false;
    }
}

// ============================================================================
// CPU BITONIC SORT (Fallback)
// ============================================================================

/**
 * CPU bitonic sort for small arrays or fallback
 * @param {number[]} keys 
 * @param {number[]} values 
 */
export function bitonicSortCPU(keys, values) {
    const n = keys.length;
    
    // Pad to power of 2
    const paddedN = 1 << Math.ceil(Math.log2(n));
    while (keys.length < paddedN) {
        keys.push(0xFFFFFFFF); // Max value
        values.push(values.length);
    }
    
    // Bitonic sort
    for (let k = 2; k <= paddedN; k *= 2) {
        for (let j = k / 2; j > 0; j = Math.floor(j / 2)) {
            for (let i = 0; i < paddedN; i++) {
                const ixj = i ^ j;
                if (ixj > i) {
                    const ascending = ((i & k) === 0);
                    if ((ascending && keys[i] > keys[ixj]) ||
                        (!ascending && keys[i] < keys[ixj])) {
                        // Swap
                        [keys[i], keys[ixj]] = [keys[ixj], keys[i]];
                        [values[i], values[ixj]] = [values[ixj], values[i]];
                    }
                }
            }
        }
    }
    
    // Trim back to original size
    keys.length = n;
    values.length = n;
}

// ============================================================================
// SHADER CODE
// ============================================================================

const BITONIC_SORT_SHADER = /* wgsl */ `
struct Uniforms {
    count: u32,
    stageSize: u32,
    passSize: u32,
    pad: u32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read_write> keys: array<u32>;
@group(0) @binding(2) var<storage, read_write> values: array<u32>;

// Shared memory for local sort
var<workgroup> localKeys: array<u32, 512>;
var<workgroup> localValues: array<u32, 512>;

// Compare and swap
fn compareSwap(i: u32, j: u32, ascending: bool) {
    if ((ascending && keys[i] > keys[j]) || (!ascending && keys[i] < keys[j])) {
        // Swap keys
        let tempKey = keys[i];
        keys[i] = keys[j];
        keys[j] = tempKey;
        
        // Swap values
        let tempVal = values[i];
        values[i] = values[j];
        values[j] = tempVal;
    }
}

// Local compare and swap (shared memory)
fn localCompareSwap(i: u32, j: u32, ascending: bool) {
    if ((ascending && localKeys[i] > localKeys[j]) || (!ascending && localKeys[i] < localKeys[j])) {
        let tempKey = localKeys[i];
        localKeys[i] = localKeys[j];
        localKeys[j] = tempKey;
        
        let tempVal = localValues[i];
        localValues[i] = localValues[j];
        localValues[j] = tempVal;
    }
}

// Local sort within workgroup
@compute @workgroup_size(256)
fn localSort(@builtin(global_invocation_id) gid: vec3u,
             @builtin(local_invocation_id) lid: vec3u,
             @builtin(workgroup_id) wid: vec3u) {
    let idx = gid.x;
    let localIdx = lid.x;
    let groupOffset = wid.x * 512u;
    
    // Load into shared memory
    if (groupOffset + localIdx * 2u < uniforms.count) {
        localKeys[localIdx * 2u] = keys[groupOffset + localIdx * 2u];
        localValues[localIdx * 2u] = values[groupOffset + localIdx * 2u];
    } else {
        localKeys[localIdx * 2u] = 0xFFFFFFFFu;
        localValues[localIdx * 2u] = 0u;
    }
    
    if (groupOffset + localIdx * 2u + 1u < uniforms.count) {
        localKeys[localIdx * 2u + 1u] = keys[groupOffset + localIdx * 2u + 1u];
        localValues[localIdx * 2u + 1u] = values[groupOffset + localIdx * 2u + 1u];
    } else {
        localKeys[localIdx * 2u + 1u] = 0xFFFFFFFFu;
        localValues[localIdx * 2u + 1u] = 0u;
    }
    
    workgroupBarrier();
    
    // Bitonic sort within workgroup
    for (var k = 2u; k <= 512u; k *= 2u) {
        for (var j = k / 2u; j > 0u; j /= 2u) {
            let i1 = localIdx;
            let i2 = i1 ^ j;
            
            if (i2 > i1 && i1 < 512u && i2 < 512u) {
                let ascending = ((i1 & k) == 0u);
                localCompareSwap(i1, i2, ascending);
            }
            
            workgroupBarrier();
        }
    }
    
    // Write back to global memory
    if (groupOffset + localIdx * 2u < uniforms.count) {
        keys[groupOffset + localIdx * 2u] = localKeys[localIdx * 2u];
        values[groupOffset + localIdx * 2u] = localValues[localIdx * 2u];
    }
    
    if (groupOffset + localIdx * 2u + 1u < uniforms.count) {
        keys[groupOffset + localIdx * 2u + 1u] = localKeys[localIdx * 2u + 1u];
        values[groupOffset + localIdx * 2u + 1u] = localValues[localIdx * 2u + 1u];
    }
}

// Global flip - compare elements across subsequence boundary
@compute @workgroup_size(256)
fn globalFlip(@builtin(global_invocation_id) gid: vec3u) {
    let idx = gid.x;
    
    let halfStage = uniforms.stageSize / 2u;
    let blockIdx = idx / halfStage;
    let localIdx = idx % halfStage;
    
    let i = blockIdx * uniforms.stageSize + localIdx;
    let j = blockIdx * uniforms.stageSize + uniforms.stageSize - 1u - localIdx;
    
    if (i < uniforms.count && j < uniforms.count && i < j) {
        // Direction alternates per stage block
        let ascending = ((blockIdx & 1u) == 0u);
        compareSwap(i, j, ascending);
    }
}

// Global disperse - compare elements within subsequence
@compute @workgroup_size(256)
fn globalDisperse(@builtin(global_invocation_id) gid: vec3u) {
    let idx = gid.x;
    
    let halfPass = uniforms.passSize;
    let blockIdx = idx / halfPass;
    let localIdx = idx % halfPass;
    
    let i = blockIdx * halfPass * 2u + localIdx;
    let j = i + halfPass;
    
    if (i < uniforms.count && j < uniforms.count) {
        // Determine sort direction from stage
        let stageBlock = i / uniforms.stageSize;
        let ascending = ((stageBlock & 1u) == 0u);
        compareSwap(i, j, ascending);
    }
}

// Generate Morton codes from positions
@compute @workgroup_size(256)
fn generateMortonCodes(@builtin(global_invocation_id) gid: vec3u) {
    let idx = gid.x;
    if (idx >= uniforms.count) { return; }
    
    // Would read from position buffer and compute Morton code
    // For now, placeholder
    keys[idx] = idx; // Would be Morton code
    values[idx] = idx;
}

// Generate depth keys from positions
@compute @workgroup_size(256)
fn generateDepthKeys(@builtin(global_invocation_id) gid: vec3u) {
    let idx = gid.x;
    if (idx >= uniforms.count) { return; }
    
    // Would compute depth = dot(position - camera, viewDir)
    // Convert to u32 for sorting (flip sign bit for correct ordering)
    keys[idx] = idx; // Would be depth key
    values[idx] = idx;
}
`;

// ============================================================================
// RADIX SORT (Alternative - faster for large arrays)
// ============================================================================

export class RadixSorter {
    constructor(device, options = {}) {
        this.device = device;
        this.maxElements = options.maxElements ?? 131072;
        this.initialized = false;
    }
    
    async init() {
        // Radix sort uses counting sort as subroutine
        // 4 passes for 32-bit keys (8 bits per pass)
        
        this.histogramBuffer = this.device.createBuffer({
            label: 'Radix Histogram',
            size: 256 * 4 * 4, // 256 buckets × 4 passes × 4 bytes
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        this.prefixSumBuffer = this.device.createBuffer({
            label: 'Radix Prefix Sum',
            size: 256 * 4 * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        this.initialized = true;
    }
    
    sort(encoder, keyBuffer, valueBuffer, count) {
        // Would implement 4-pass radix sort
        // Each pass: histogram → prefix sum → scatter
    }
    
    destroy() {
        this.histogramBuffer?.destroy();
        this.prefixSumBuffer?.destroy();
        this.initialized = false;
    }
}

export default BitonicSorter;
