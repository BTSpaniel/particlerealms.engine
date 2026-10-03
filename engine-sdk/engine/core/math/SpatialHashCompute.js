// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SpatialHashCompute.js - GPU Spatial Hash System
 * 
 * Builds and queries spatial hash grids on the GPU for fast particle neighbor queries.
 * Uses:
 * 1. Cell key computation from particle positions
 * 2. Bitonic sort to order particles by cell
 * 3. Cell offset table for O(1) cell lookups
 */

// Reusable buffers for hot paths (reduce/reuse/recycle)
const _spatialHashParamsF32 = new Float32Array(4);
const _bitonicParamsU32 = new Uint32Array(4);
const _offsetParamsU32 = new Uint32Array(4);
let _spatialPositionCapacity = 1024;
let _spatialPositionData = new Float32Array(_spatialPositionCapacity * 4);

function ensureSpatialPositionCapacity(count) {
    if (count <= _spatialPositionCapacity) return;
    while (_spatialPositionCapacity < count) {
        _spatialPositionCapacity *= 2;
    }
    _spatialPositionData = new Float32Array(_spatialPositionCapacity * 4);
}

// ============================================================================
// SHADER SOURCES
// ============================================================================

// Compute cell keys for each particle
const CELL_KEY_SHADER = /* wgsl */ `
struct Params {
    cellSize: f32,
    invCellSize: f32,
    particleCount: u32,
    tableSize: u32,  // Hash table size (power of 2)
}

struct Particle {
    x: f32,
    y: f32,
    z: f32,
    _pad: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;
@group(0) @binding(2) var<storage, read_write> cellKeys: array<u32>;
@group(0) @binding(3) var<storage, read_write> particleIndices: array<u32>;

// Morton code interleaving for 10-bit coordinates
fn expandBits(v: u32) -> u32 {
    var x = v & 0x3FFu;  // 10 bits
    x = (x | (x << 16u)) & 0x030000FFu;
    x = (x | (x << 8u)) & 0x0300F00Fu;
    x = (x | (x << 4u)) & 0x030C30C3u;
    x = (x | (x << 2u)) & 0x09249249u;
    return x;
}

fn morton3D(x: u32, y: u32, z: u32) -> u32 {
    return expandBits(x) | (expandBits(y) << 1u) | (expandBits(z) << 2u);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= params.particleCount) {
        return;
    }
    
    let p = particles[idx];
    
    // Compute cell coordinates (offset to handle negative coords)
    let cx = u32(floor(p.x * params.invCellSize) + 512.0);  // +512 for negative support
    let cy = u32(floor(p.y * params.invCellSize) + 512.0);
    let cz = u32(floor(p.z * params.invCellSize) + 512.0);
    
    // Morton code for spatial locality
    let morton = morton3D(cx & 0x3FFu, cy & 0x3FFu, cz & 0x3FFu);
    
    // Hash to table size
    let key = morton & (params.tableSize - 1u);
    
    cellKeys[idx] = key;
    particleIndices[idx] = idx;
}
`;

// Bitonic sort step
const BITONIC_SORT_SHADER = /* wgsl */ `
struct Params {
    particleCount: u32,
    groupWidth: u32,
    groupHeight: u32,
    stepIndex: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> keys: array<u32>;
@group(0) @binding(2) var<storage, read_write> indices: array<u32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.particleCount) {
        return;
    }
    
    let hIndex = i & (params.groupWidth - 1u);
    let indexLeft = hIndex + (params.groupHeight + 1u) * (i / params.groupWidth);
    let rightStepSize = select((params.groupHeight + 1u) / 2u, params.groupHeight - 2u * hIndex, params.stepIndex == 0u);
    let indexRight = indexLeft + rightStepSize;
    
    // Bounds check
    if (indexRight >= params.particleCount) {
        return;
    }
    
    let keyLeft = keys[indexLeft];
    let keyRight = keys[indexRight];
    
    // Sort direction alternates in bitonic merge
    let sortDir = (indexLeft / params.groupWidth / 2u) % 2u;
    let shouldSwap = (sortDir == 0u) == (keyLeft > keyRight);
    
    if (shouldSwap) {
        keys[indexLeft] = keyRight;
        keys[indexRight] = keyLeft;
        
        let idxLeft = indices[indexLeft];
        let idxRight = indices[indexRight];
        indices[indexLeft] = idxRight;
        indices[indexRight] = idxLeft;
    }
}
`;

// Build cell offset table
const CELL_OFFSET_SHADER = /* wgsl */ `
struct Params {
    particleCount: u32,
    tableSize: u32,
    _pad0: u32,
    _pad1: u32,
}

struct CellRange {
    start: u32,
    count: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> sortedKeys: array<u32>;
@group(0) @binding(2) var<storage, read_write> cellTable: array<CellRange>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= params.particleCount) {
        return;
    }
    
    let key = sortedKeys[idx];
    
    // Check if this is the start of a new cell
    if (idx == 0u || sortedKeys[idx - 1u] != key) {
        cellTable[key].start = idx;
    }
    
    // Check if this is the end of a cell
    if (idx == params.particleCount - 1u || sortedKeys[idx + 1u] != key) {
        let startIdx = cellTable[key].start;
        cellTable[key].count = idx - startIdx + 1u;
    }
}
`;

// Clear cell table
const CLEAR_CELLS_SHADER = /* wgsl */ `
struct CellRange {
    start: u32,
    count: u32,
}

@group(0) @binding(0) var<storage, read_write> cellTable: array<CellRange>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    cellTable[idx] = CellRange(0u, 0u);
}
`;

// ============================================================================
// SPATIAL HASH COMPUTE CLASS
// ============================================================================

export class SpatialHashCompute {
    constructor() {
        this.device = null;
        
        // Pipelines
        this.cellKeyPipeline = null;
        this.bitonicSortPipeline = null;
        this.cellOffsetPipeline = null;
        this.clearCellsPipeline = null;
        
        // Layouts
        this.cellKeyLayout = null;
        this.bitonicLayout = null;
        this.cellOffsetLayout = null;
        this.clearCellsLayout = null;
        
        // Buffers (recreated per rebuild)
        this.paramsBuffer = null;
        this.bitonicParamsBuffer = null;
        this.particleBuffer = null;
        this.cellKeysBuffer = null;
        this.particleIndicesBuffer = null;
        this.cellTableBuffer = null;
        
        // Config
        this.cellSize = 4.0;
        this.tableSize = 65536;  // 64K cells (power of 2)
        this.maxParticles = 100000;
        
        this.initialized = false;
    }
    
    /**
     * Initialize the compute system
     * @param {GPUDevice} device 
     * @param {Object} options
     */
    async init(device, options = {}) {
        this.device = device;
        this.cellSize = options.cellSize || 4.0;
        this.tableSize = options.tableSize || 65536;
        this.maxParticles = options.maxParticles || 100000;
        
        // Create shader modules
        const cellKeyModule = device.createShaderModule({
            label: 'CellKey Shader',
            code: CELL_KEY_SHADER,
        });
        
        const bitonicModule = device.createShaderModule({
            label: 'Bitonic Sort Shader',
            code: BITONIC_SORT_SHADER,
        });
        
        const cellOffsetModule = device.createShaderModule({
            label: 'Cell Offset Shader',
            code: CELL_OFFSET_SHADER,
        });
        
        const clearCellsModule = device.createShaderModule({
            label: 'Clear Cells Shader',
            code: CLEAR_CELLS_SHADER,
        });
        
        // Create bind group layouts
        this.cellKeyLayout = device.createBindGroupLayout({
            label: 'CellKey Layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });
        
        this.bitonicLayout = device.createBindGroupLayout({
            label: 'Bitonic Layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });
        
        this.cellOffsetLayout = device.createBindGroupLayout({
            label: 'Cell Offset Layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });
        
        this.clearCellsLayout = device.createBindGroupLayout({
            label: 'Clear Cells Layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });
        
        // Create pipelines
        this.cellKeyPipeline = device.createComputePipeline({
            label: 'CellKey Pipeline',
            layout: device.createPipelineLayout({ bindGroupLayouts: [this.cellKeyLayout] }),
            compute: { module: cellKeyModule, entryPoint: 'main' },
        });
        
        this.bitonicSortPipeline = device.createComputePipeline({
            label: 'Bitonic Sort Pipeline',
            layout: device.createPipelineLayout({ bindGroupLayouts: [this.bitonicLayout] }),
            compute: { module: bitonicModule, entryPoint: 'main' },
        });
        
        this.cellOffsetPipeline = device.createComputePipeline({
            label: 'Cell Offset Pipeline',
            layout: device.createPipelineLayout({ bindGroupLayouts: [this.cellOffsetLayout] }),
            compute: { module: cellOffsetModule, entryPoint: 'main' },
        });
        
        this.clearCellsPipeline = device.createComputePipeline({
            label: 'Clear Cells Pipeline',
            layout: device.createPipelineLayout({ bindGroupLayouts: [this.clearCellsLayout] }),
            compute: { module: clearCellsModule, entryPoint: 'main' },
        });
        
        // Create buffers
        this.paramsBuffer = device.createBuffer({
            label: 'SpatialHash Params',
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        this.bitonicParamsBuffer = device.createBuffer({
            label: 'Bitonic Params',
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        this.particleBuffer = device.createBuffer({
            label: 'Particles',
            size: this.maxParticles * 16,  // 16 bytes per particle (vec4)
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        this.cellKeysBuffer = device.createBuffer({
            label: 'Cell Keys',
            size: this.maxParticles * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        
        this.particleIndicesBuffer = device.createBuffer({
            label: 'Particle Indices',
            size: this.maxParticles * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        
        this.cellTableBuffer = device.createBuffer({
            label: 'Cell Table',
            size: this.tableSize * 8,  // 8 bytes per cell (start + count)
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        
        this.initialized = true;
        console.log(`[SpatialHashCompute] Initialized: cellSize=${this.cellSize}, tableSize=${this.tableSize}, maxParticles=${this.maxParticles}`);
    }
    
    /**
     * Rebuild the spatial hash from particles
     * @param {Array} particles - Array of particles with {x, y, z}
     * @returns {GPUCommandBuffer} Command buffer to submit
     */
    rebuild(particles) {
        if (!this.initialized || particles.length === 0) {
            return null;
        }
        
        const device = this.device;
        const count = Math.min(particles.length, this.maxParticles);
        
        // Upload particle positions - reuse dynamic buffer
        ensureSpatialPositionCapacity(count);
        for (let i = 0; i < count; i++) {
            const p = particles[i];
            _spatialPositionData[i * 4 + 0] = p.x;
            _spatialPositionData[i * 4 + 1] = p.y;
            _spatialPositionData[i * 4 + 2] = p.z;
            _spatialPositionData[i * 4 + 3] = 0;
        }
        device.queue.writeBuffer(this.particleBuffer, 0, _spatialPositionData, 0, count * 4);
        
        // Upload params - reuse buffer
        _spatialHashParamsF32[0] = this.cellSize;
        _spatialHashParamsF32[1] = 1.0 / this.cellSize;
        const paramsView = new DataView(_spatialHashParamsF32.buffer);
        paramsView.setUint32(8, count, true);
        paramsView.setUint32(12, this.tableSize, true);
        device.queue.writeBuffer(this.paramsBuffer, 0, _spatialHashParamsF32);
        
        const commandEncoder = device.createCommandEncoder();
        
        // 1. Clear cell table
        {
            const bindGroup = device.createBindGroup({
                layout: this.clearCellsLayout,
                entries: [{ binding: 0, resource: { buffer: this.cellTableBuffer } }],
            });
            
            const pass = commandEncoder.beginComputePass();
            pass.setPipeline(this.clearCellsPipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(Math.ceil(this.tableSize / 256));
            pass.end();
        }
        
        // 2. Compute cell keys
        {
            const bindGroup = device.createBindGroup({
                layout: this.cellKeyLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.paramsBuffer } },
                    { binding: 1, resource: { buffer: this.particleBuffer } },
                    { binding: 2, resource: { buffer: this.cellKeysBuffer } },
                    { binding: 3, resource: { buffer: this.particleIndicesBuffer } },
                ],
            });
            
            const pass = commandEncoder.beginComputePass();
            pass.setPipeline(this.cellKeyPipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(Math.ceil(count / 256));
            pass.end();
        }
        
        // 3. Bitonic sort
        const numStages = Math.ceil(Math.log2(count));
        for (let stageIndex = 0; stageIndex < numStages; stageIndex++) {
            for (let stepIndex = 0; stepIndex <= stageIndex; stepIndex++) {
                const groupWidth = 1 << (stageIndex - stepIndex);
                const groupHeight = 2 * groupWidth - 1;
                
                _bitonicParamsU32[0] = count;
                _bitonicParamsU32[1] = groupWidth;
                _bitonicParamsU32[2] = groupHeight;
                _bitonicParamsU32[3] = stepIndex;
                device.queue.writeBuffer(this.bitonicParamsBuffer, 0, _bitonicParamsU32);
                
                const bindGroup = device.createBindGroup({
                    layout: this.bitonicLayout,
                    entries: [
                        { binding: 0, resource: { buffer: this.bitonicParamsBuffer } },
                        { binding: 1, resource: { buffer: this.cellKeysBuffer } },
                        { binding: 2, resource: { buffer: this.particleIndicesBuffer } },
                    ],
                });
                
                const pass = commandEncoder.beginComputePass();
                pass.setPipeline(this.bitonicSortPipeline);
                pass.setBindGroup(0, bindGroup);
                pass.dispatchWorkgroups(Math.ceil(count / 256));
                pass.end();
            }
        }
        
        // 4. Build cell offset table
        {
            _offsetParamsU32[0] = count;
            _offsetParamsU32[1] = this.tableSize;
            _offsetParamsU32[2] = 0;
            _offsetParamsU32[3] = 0;
            device.queue.writeBuffer(this.paramsBuffer, 0, _offsetParamsU32);
            
            const bindGroup = device.createBindGroup({
                layout: this.cellOffsetLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.paramsBuffer } },
                    { binding: 1, resource: { buffer: this.cellKeysBuffer } },
                    { binding: 2, resource: { buffer: this.cellTableBuffer } },
                ],
            });
            
            const pass = commandEncoder.beginComputePass();
            pass.setPipeline(this.cellOffsetPipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(Math.ceil(count / 256));
            pass.end();
        }
        
        return commandEncoder.finish();
    }
    
    /**
     * Get buffers for use in other shaders
     */
    getBuffers() {
        return {
            cellTable: this.cellTableBuffer,
            particleIndices: this.particleIndicesBuffer,
            cellKeys: this.cellKeysBuffer,
        };
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [spatial_hash] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.cellSize = parseInt(cfg.cell_size) || 16;
        this.gpuAccelerated = cfg.gpu_accelerated !== false;
    }
    
    /**
     * Destroy GPU resources
     */
    destroy() {
        this.paramsBuffer?.destroy();
        this.bitonicParamsBuffer?.destroy();
        this.particleBuffer?.destroy();
        this.cellKeysBuffer?.destroy();
        this.particleIndicesBuffer?.destroy();
        this.cellTableBuffer?.destroy();
        this.initialized = false;
    }
}

export default SpatialHashCompute;
