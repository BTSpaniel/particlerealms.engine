// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Compute Batch System - Parallel GPU compute with indirect dispatch
 * Enables dynamic workgroup sizing and batched compute operations
 */

export class ComputeBatchSystem {
    constructor(device) {
        this.device = device;
        this.batches = [];
        this.indirectBuffers = new Map();
        this.supportsIndirect = device.features?.has('indirect-first-instance') || false;
    }

    createIndirectBuffer(maxDispatches = 256) {
        const buffer = this.device.createBuffer({
            size: maxDispatches * 12, // 3 u32 per dispatch (x, y, z)
            usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            label: 'IndirectDispatchBuffer',
        });
        
        const counterBuffer = this.device.createBuffer({
            size: 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            label: 'DispatchCounter',
        });
        
        return { buffer, counterBuffer, maxDispatches };
    }

    /**
     * Batch multiple compute dispatches into a single command encoder
     */
    async executeBatch(commandEncoder, computeOps) {
        if (!computeOps || computeOps.length === 0) return;
        
        const pass = commandEncoder.beginComputePass({ 
            label: `ComputeBatch_${computeOps.length}ops`,
            timestampWrites: this._getTimestampWrites(),
        });
        
        for (const op of computeOps) {
            if (!op.pipeline || !op.bindGroups) continue;
            
            pass.setPipeline(op.pipeline);
            
            // Set bind groups
            for (let i = 0; i < op.bindGroups.length; i++) {
                if (op.bindGroups[i]) {
                    pass.setBindGroup(i, op.bindGroups[i]);
                }
            }
            
            // Dispatch
            if (op.indirect && this.supportsIndirect) {
                pass.dispatchWorkgroupsIndirect(op.indirectBuffer, op.indirectOffset || 0);
            } else {
                const x = op.workgroups?.x || op.workgroups || 1;
                const y = op.workgroups?.y || 1;
                const z = op.workgroups?.z || 1;
                pass.dispatchWorkgroups(x, y, z);
            }
        }
        
        pass.end();
    }

    /**
     * Create a compute operation descriptor
     */
    createComputeOp(pipeline, bindGroups, workgroups, options = {}) {
        return {
            pipeline,
            bindGroups: Array.isArray(bindGroups) ? bindGroups : [bindGroups],
            workgroups,
            indirect: options.indirect || false,
            indirectBuffer: options.indirectBuffer || null,
            indirectOffset: options.indirectOffset || 0,
            label: options.label || 'ComputeOp',
        };
    }

    /**
     * Generate indirect dispatch arguments on GPU
     */
    createIndirectDispatchGenerator() {
        const shader = this.device.createShaderModule({
            label: 'IndirectDispatchGenerator',
            code: `
struct DispatchArgs {
    x: u32,
    y: u32,
    z: u32,
}

struct Params {
    itemCount: u32,
    workgroupSize: u32,
}

@group(0) @binding(0) var<storage, read_write> dispatchArgs: array<DispatchArgs>;
@group(0) @binding(1) var<storage, read_write> dispatchCount: atomic<u32>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(1)
fn main() {
    let workgroups = (params.itemCount + params.workgroupSize - 1u) / params.workgroupSize;
    
    let idx = atomicAdd(&dispatchCount, 1u);
    dispatchArgs[idx].x = workgroups;
    dispatchArgs[idx].y = 1u;
    dispatchArgs[idx].z = 1u;
}
            `,
        });

        return this.device.createComputePipelineAsync({
            label: 'IndirectDispatchGenerator',
            layout: 'auto',
            compute: { module: shader, entryPoint: 'main' },
        });
    }

    _getTimestampWrites() {
        // TODO: Integrate with GPUProfiler timestamp queries
        return undefined;
    }

    destroy() {
        for (const { buffer, counterBuffer } of this.indirectBuffers.values()) {
            buffer.destroy();
            counterBuffer.destroy();
        }
        this.indirectBuffers.clear();
    }
}
