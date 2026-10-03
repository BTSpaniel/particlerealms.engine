// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * IndirectDispatchGen.js - GPU-Driven Indirect Dispatch Generation
 *
 * Problem: CPU deciding which chunks to process creates a bottleneck.
 * The GPU knows best which chunks need work (from dirty flags, visibility, etc.)
 * but standard dispatch requires CPU to specify workgroup counts.
 *
 * Solution: GPU-side stream compaction + indirect dispatch.
 * 1. GPU scans all chunks, compacts active ones into a list
 * 2. GPU writes workgroup counts to indirect buffer
 * 3. CPU issues dispatchWorkgroupsIndirect() - no readback needed
 *
 * Key Technique: Hierarchical atomics for efficient compaction
 * - Each workgroup uses local atomic to count active items
 * - Leader thread reserves global block via global atomic
 * - Threads scatter their items to reserved slots
 *
 * Performance: Eliminates CPU-GPU sync for conditional dispatch
 */

// Reusable buffers for hot paths (reduce/reuse/recycle)
const _chunkFlagsU32 = new Uint32Array(1);
const _dispatchUniformsU32 = new Uint32Array(8);

import { INDIRECT_DISPATCH_LAYOUT, DIRTY_CHUNK_LAYOUT, DIRTY_FLAGS } from './BufferLayouts.js';
import { DISPATCH_GEN_SHADER } from '../shaders/compute/dispatch_gen.generated.js';

export { DISPATCH_GEN_SHADER };

// ============================================================================
// CONSTANTS
// ============================================================================

/** Workgroup size for generator shader */
export const GENERATOR_WORKGROUP_SIZE = 64;

/** Maximum jobs that can be generated per dispatch */
export const MAX_JOBS = 4096;

/** Indirect dispatch buffer size (3 × u32 = 12 bytes) */
export const INDIRECT_BUFFER_SIZE = 12;

// ============================================================================
// INDIRECT DISPATCH GENERATOR
// ============================================================================

export class IndirectDispatchGen {
    /**
     * @param {GPUDevice} device
     * @param {Object} options
     */
    constructor(device, options = {}) {
        this.device = device;
        this.maxJobs = options.maxJobs ?? MAX_JOBS;
        this.workgroupSize = options.workgroupSize ?? GENERATOR_WORKGROUP_SIZE;

        // GPU resources
        this.initialized = false;

        // Input: dirty chunk flags (all chunks)
        this.chunkFlagsBuffer = null;

        // Output: compacted job list
        this.jobListBuffer = null;

        // Output: indirect dispatch arguments
        this.indirectBuffer = null;

        // Counter for compaction
        this.counterBuffer = null;

        // Pipelines
        this.compactPipeline = null;
        this.clearPipeline = null;

        // Bind groups
        this.bindGroup = null;
    }

    /**
     * Initialize GPU resources
     * @param {number} totalChunks - Total number of chunks to scan
     */
    async init(totalChunks) {
        // Chunk flags buffer (input)
        // Each chunk has a u32 flags field
        this.chunkFlagsBuffer = this.device.createBuffer({
            label: 'Chunk Flags',
            size: totalChunks * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        // Compacted job list (output)
        // Each job: [chunkX, chunkY, chunkZ, flags] = 16 bytes
        this.jobListBuffer = this.device.createBuffer({
            label: 'Compacted Job List',
            size: this.maxJobs * DIRTY_CHUNK_LAYOUT.stride,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });

        // Indirect dispatch buffer
        this.indirectBuffer = this.device.createBuffer({
            label: 'Indirect Dispatch Args',
            size: INDIRECT_BUFFER_SIZE,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
        });

        // Atomic counter
        this.counterBuffer = this.device.createBuffer({
            label: 'Job Counter',
            size: 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });

        // Uniform buffer for grid dimensions
        this.uniformBuffer = this.device.createBuffer({
            label: 'Generator Uniforms',
            size: 32, // gridDims + flagMask + workgroupsPerJob + padding
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // Create shader module
        this.shaderModule = this.device.createShaderModule({
            label: 'Indirect Dispatch Gen Shader',
            code: DISPATCH_GEN_SHADER,
        });

        // Bind group layout
        this.bindGroupLayout = this.device.createBindGroupLayout({
            label: 'Dispatch Gen Bind Group Layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            ],
        });

        // Pipeline layout
        const pipelineLayout = this.device.createPipelineLayout({
            label: 'Dispatch Gen Pipeline Layout',
            bindGroupLayouts: [this.bindGroupLayout],
        });

        // Compact pipeline
        this.compactPipeline = this.device.createComputePipeline({
            label: 'Stream Compact Pipeline',
            layout: pipelineLayout,
            compute: {
                module: this.shaderModule,
                entryPoint: 'compactJobs',
            },
        });

        // Clear pipeline
        this.clearPipeline = this.device.createComputePipeline({
            label: 'Clear Counter Pipeline',
            layout: pipelineLayout,
            compute: {
                module: this.shaderModule,
                entryPoint: 'clearCounter',
            },
        });

        // Finalize indirect pipeline
        this.finalizePipeline = this.device.createComputePipeline({
            label: 'Finalize Indirect Pipeline',
            layout: pipelineLayout,
            compute: {
                module: this.shaderModule,
                entryPoint: 'finalizeIndirect',
            },
        });

        // Create bind group
        this.bindGroup = this.device.createBindGroup({
            label: 'Dispatch Gen Bind Group',
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.chunkFlagsBuffer } },
                { binding: 1, resource: { buffer: this.jobListBuffer } },
                { binding: 2, resource: { buffer: this.indirectBuffer } },
                { binding: 3, resource: { buffer: this.counterBuffer } },
                { binding: 4, resource: { buffer: this.uniformBuffer } },
            ],
        });

        this.totalChunks = totalChunks;
        this.initialized = true;

        console.log(`[IndirectDispatchGen] Initialized for ${totalChunks} chunks, max ${this.maxJobs} jobs`);
    }

    /**
     * Upload chunk flags to GPU
     * @param {Uint32Array} flags - Flags array (one per chunk)
     */
    uploadFlags(flags) {
        this.device.queue.writeBuffer(this.chunkFlagsBuffer, 0, flags);
    }

    /**
     * Set a single chunk's flags
     * @param {number} chunkIndex
     * @param {number} flags
     */
    setChunkFlags(chunkIndex, flags) {
        _chunkFlagsU32[0] = flags;
        this.device.queue.writeBuffer(this.chunkFlagsBuffer, chunkIndex * 4, _chunkFlagsU32);
    }

    /**
     * Generate compacted job list and indirect dispatch args
     * @param {number} flagMask - Only include chunks with these flags
     * @param {number} workgroupsPerJob - Workgroups per job in target shader
     * @param {[number, number, number]} gridDims - Chunk grid dimensions [x, y, z]
     * @returns {GPUCommandBuffer}
     */
    generate(flagMask, workgroupsPerJob, gridDims) {
        if (!this.initialized) {
            throw new Error('IndirectDispatchGen not initialized');
        }

        // Update uniforms - reuse buffer
        _dispatchUniformsU32[0] = gridDims[0];
        _dispatchUniformsU32[1] = gridDims[1];
        _dispatchUniformsU32[2] = gridDims[2];
        _dispatchUniformsU32[3] = flagMask;
        _dispatchUniformsU32[4] = workgroupsPerJob;
        _dispatchUniformsU32[5] = this.maxJobs;
        _dispatchUniformsU32[6] = 0;
        _dispatchUniformsU32[7] = 0;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, _dispatchUniformsU32);

        const encoder = this.device.createCommandEncoder();

        // Pass 1: Clear counter
        {
            const pass = encoder.beginComputePass();
            pass.setPipeline(this.clearPipeline);
            pass.setBindGroup(0, this.bindGroup);
            pass.dispatchWorkgroups(1);
            pass.end();
        }

        // Pass 2: Compact active chunks into job list
        {
            const totalWorkgroups = Math.ceil(this.totalChunks / this.workgroupSize);
            const pass = encoder.beginComputePass();
            pass.setPipeline(this.compactPipeline);
            pass.setBindGroup(0, this.bindGroup);
            pass.dispatchWorkgroups(totalWorkgroups);
            pass.end();
        }

        // Pass 3: Finalize indirect dispatch args
        {
            const pass = encoder.beginComputePass();
            pass.setPipeline(this.finalizePipeline);
            pass.setBindGroup(0, this.bindGroup);
            pass.dispatchWorkgroups(1);
            pass.end();
        }

        return encoder.finish();
    }

    /**
     * Get the indirect buffer for dispatchWorkgroupsIndirect
     * @returns {GPUBuffer}
     */
    getIndirectBuffer() {
        return this.indirectBuffer;
    }

    /**
     * Get the compacted job list buffer
     * @returns {GPUBuffer}
     */
    getJobListBuffer() {
        return this.jobListBuffer;
    }

    /**
     * Read back job count (for debugging)
     * @returns {Promise<number>}
     */
    async readJobCount() {
        const readBuffer = this.device.createBuffer({
            size: 4,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });

        const encoder = this.device.createCommandEncoder();
        encoder.copyBufferToBuffer(this.counterBuffer, 0, readBuffer, 0, 4);
        this.device.queue.submit([encoder.finish()]);

        await readBuffer.mapAsync(GPUMapMode.READ);
        const count = new Uint32Array(readBuffer.getMappedRange())[0];
        readBuffer.unmap();
        readBuffer.destroy();

        return count;
    }

    /**
     * Destroy GPU resources
     */
    destroy() {
        this.chunkFlagsBuffer?.destroy();
        this.jobListBuffer?.destroy();
        this.indirectBuffer?.destroy();
        this.counterBuffer?.destroy();
        this.uniformBuffer?.destroy();
        this.initialized = false;
    }
}

// ============================================================================
// MULTI-PASS DISPATCH GENERATOR
// ============================================================================

/**
 * Generates multiple indirect dispatches for different job types
 * (e.g., separate geometry, lighting, physics passes)
 */
export class MultiPassDispatchGen {
    /**
     * @param {GPUDevice} device
     * @param {Object} passes - { passName: { flagMask, workgroupsPerJob } }
     */
    constructor(device, passes) {
        this.device = device;
        this.passes = passes;
        this.generators = new Map();
    }

    /**
     * Initialize all passes
     * @param {number} totalChunks
     */
    async init(totalChunks) {
        for (const [name, config] of Object.entries(this.passes)) {
            const gen = new IndirectDispatchGen(this.device, {
                maxJobs: config.maxJobs ?? MAX_JOBS,
            });
            await gen.init(totalChunks);
            this.generators.set(name, { generator: gen, config });
        }
    }

    /**
     * Upload shared chunk flags
     * @param {Uint32Array} flags
     */
    uploadFlags(flags) {
        for (const { generator } of this.generators.values()) {
            generator.uploadFlags(flags);
        }
    }

    /**
     * Generate all passes
     * @param {[number, number, number]} gridDims
     * @returns {GPUCommandBuffer[]}
     */
    generateAll(gridDims) {
        const commands = [];

        for (const [name, { generator, config }] of this.generators) {
            commands.push(generator.generate(
                config.flagMask,
                config.workgroupsPerJob,
                gridDims
            ));
        }

        return commands;
    }

    /**
     * Get indirect buffer for a specific pass
     * @param {string} passName
     * @returns {GPUBuffer}
     */
    getIndirectBuffer(passName) {
        return this.generators.get(passName)?.generator.getIndirectBuffer();
    }

    /**
     * Get job list buffer for a specific pass
     * @param {string} passName
     * @returns {GPUBuffer}
     */
    getJobListBuffer(passName) {
        return this.generators.get(passName)?.generator.getJobListBuffer();
    }

    /**
     * Destroy all resources
     */
    destroy() {
        for (const { generator } of this.generators.values()) {
            generator.destroy();
        }
        this.generators.clear();
    }
}

export default IndirectDispatchGen;
