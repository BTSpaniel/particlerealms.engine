// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * GPU Particle Sorter - Bitonic sort for depth-sorted transparency
 * Enables proper alpha blending without CPU readback
 */

// Reusable buffers for hot paths (reduce/reuse/recycle)
const _sortParamsU32 = new Uint32Array(4);
const _keyGenParamsF32 = new Float32Array(4);

export class GPUParticleSorter {
    constructor(device, maxParticles = 1048576) {
        this.device = device;
        this.maxParticles = maxParticles;
        
        // Pipelines
        this.keyGenPipeline = null;
        this.sortPipeline = null;
        
        // Buffers
        this.sortKeyBuffer = null;
        this.paramsBuffer = null;
        this.keyGenParamsBuffer = null;
        
        // Bind groups
        this.keyGenBindGroup = null;
        this.sortBindGroup = null;
    }

    async init() {
        // Sort key buffer: { key: f32, index: u32 } per particle
        this.sortKeyBuffer = this.device.createBuffer({
            size: this.maxParticles * 8,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            label: 'ParticleSortKeys',
        });

        // Params buffer for sort passes
        this.paramsBuffer = this.device.createBuffer({
            size: 16, // blockSize, compareDistance, elementCount, padding
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: 'SortParams',
        });

        // Params buffer for key generation
        this.keyGenParamsBuffer = this.device.createBuffer({
            size: 32, // cameraPos (vec3), particleCount (u32), padding
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: 'KeyGenParams',
        });

        await this._createKeyGenPipeline();
        await this._createSortPipeline();
    }

    async _createKeyGenPipeline() {
        const shader = this.device.createShaderModule({
            label: 'ParticleSortKeyGen',
            code: `
struct SortElement {
    key: f32,
    index: u32,
}

struct Params {
    cameraPos: vec3<f32>,
    particleCount: u32,
}

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> sortKeys: array<SortElement>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= params.particleCount) {
        return;
    }
    
    let pos = positions[idx].xyz;
    let dist = distance(pos, params.cameraPos);
    
    // Negative distance for back-to-front sorting (larger distance = smaller key = sorted first)
    sortKeys[idx] = SortElement(-dist, idx);
}
            `,
        });

        this.keyGenPipeline = await this.device.createComputePipelineAsync({
            label: 'ParticleSortKeyGenPipeline',
            layout: 'auto',
            compute: { module: shader, entryPoint: 'main' },
        });
    }

    async _createSortPipeline() {
        const shader = this.device.createShaderModule({
            label: 'BitonicSort',
            code: `
struct SortElement {
    key: f32,
    index: u32,
}

struct Params {
    blockSize: u32,
    compareDistance: u32,
    elementCount: u32,
    padding: u32,
}

@group(0) @binding(0) var<storage, read_write> elements: array<SortElement>;
@group(0) @binding(1) var<uniform> params: Params;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= params.elementCount) {
        return;
    }
    
    let blockSize = params.blockSize;
    let compareDistance = params.compareDistance;
    
    let pairDistance = compareDistance;
    let blockSizeBig = blockSize * 2u;
    
    let leftId = (idx / pairDistance) * pairDistance * 2u + idx % pairDistance;
    let rightId = leftId + pairDistance;
    
    if (rightId >= params.elementCount) {
        return;
    }
    
    let left = elements[leftId];
    let right = elements[rightId];
    
    let ascending = ((leftId / blockSizeBig) % 2u) == 0u;
    let shouldSwap = (ascending && left.key > right.key) || (!ascending && left.key < right.key);
    
    if (shouldSwap) {
        elements[leftId] = right;
        elements[rightId] = left;
    }
}
            `,
        });

        this.sortPipeline = await this.device.createComputePipelineAsync({
            label: 'BitonicSortPipeline',
            layout: 'auto',
            compute: { module: shader, entryPoint: 'main' },
        });
    }

    /**
     * Sort particles by depth (back-to-front for transparency)
     * @param {GPUCommandEncoder} commandEncoder
     * @param {GPUBuffer} particlePositions - Buffer of vec4 positions
     * @param {number[]} cameraPosition - [x, y, z]
     * @param {number} particleCount
     */
    sort(commandEncoder, particlePositions, cameraPosition, particleCount) {
        if (!this.sortPipeline || !this.keyGenPipeline) {
            console.warn('[GPUParticleSorter] Not initialized');
            return;
        }

        if (particleCount === 0) return;

        // Generate sort keys (distance to camera)
        this._generateSortKeys(commandEncoder, particlePositions, cameraPosition, particleCount);

        // Create sort bind group
        this.sortBindGroup = this.device.createBindGroup({
            layout: this.sortPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.sortKeyBuffer } },
                { binding: 1, resource: { buffer: this.paramsBuffer } },
            ],
            label: 'SortBindGroup',
        });

        // Bitonic sort - pad to next power of 2
        const paddedCount = Math.pow(2, Math.ceil(Math.log2(particleCount)));
        const numStages = Math.ceil(Math.log2(paddedCount));
        const workgroups = Math.ceil(paddedCount / 256);
        
        for (let stage = 0; stage < numStages; stage++) {
            for (let step = stage; step >= 0; step--) {
                const blockSize = 1 << (stage + 1);
                const compareDistance = 1 << step;
                
                // Update params - reuse buffer
                _sortParamsU32[0] = blockSize;
                _sortParamsU32[1] = compareDistance;
                _sortParamsU32[2] = particleCount;
                _sortParamsU32[3] = 0;
                this.device.queue.writeBuffer(this.paramsBuffer, 0, _sortParamsU32);
                
                const pass = commandEncoder.beginComputePass({ label: `BitonicSort_${stage}_${step}` });
                pass.setPipeline(this.sortPipeline);
                pass.setBindGroup(0, this.sortBindGroup);
                pass.dispatchWorkgroups(workgroups);
                pass.end();
            }
        }
    }

    _generateSortKeys(commandEncoder, particlePositions, cameraPosition, particleCount) {
        // Update key gen params - reuse buffer
        _keyGenParamsF32[0] = cameraPosition[0];
        _keyGenParamsF32[1] = cameraPosition[1];
        _keyGenParamsF32[2] = cameraPosition[2];
        const paramsDataU32 = new Uint32Array(_keyGenParamsF32.buffer);
        paramsDataU32[3] = particleCount;
        this.device.queue.writeBuffer(this.keyGenParamsBuffer, 0, _keyGenParamsF32);

        // Create bind group for key generation
        this.keyGenBindGroup = this.device.createBindGroup({
            layout: this.keyGenPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: particlePositions } },
                { binding: 1, resource: { buffer: this.sortKeyBuffer } },
                { binding: 2, resource: { buffer: this.keyGenParamsBuffer } },
            ],
            label: 'KeyGenBindGroup',
        });

        const pass = commandEncoder.beginComputePass({ label: 'ParticleSortKeyGen' });
        pass.setPipeline(this.keyGenPipeline);
        pass.setBindGroup(0, this.keyGenBindGroup);
        pass.dispatchWorkgroups(Math.ceil(particleCount / 256));
        pass.end();
    }

    /**
     * Get sorted indices buffer for use in rendering
     */
    getSortedIndicesBuffer() {
        return this.sortKeyBuffer;
    }

    destroy() {
        if (this.sortKeyBuffer) this.sortKeyBuffer.destroy();
        if (this.paramsBuffer) this.paramsBuffer.destroy();
        if (this.keyGenParamsBuffer) this.keyGenParamsBuffer.destroy();
    }
}
