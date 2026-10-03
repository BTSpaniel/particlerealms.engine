// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
    GPU_PRIMITIVE_DEFAULT_MAX_ELEMENTS,
    GPU_SCAN_BLOCK_SIZE,
    GPU_SCAN_WORKGROUP_SIZE,
    acquireWorkspace,
    assertCommandEncoder,
    assertCount,
    assertDistinctBuffers,
    assertGpuBuffer,
    createEncodeReceipt,
    createScanParameters,
    createScanWorkspace,
    destroyPrimitiveLifecycle,
    encodeScanCommands,
    initializePrimitiveLifecycle,
    resolveMaxElements,
} from './GpuPrimitiveSupport.js';

export const GPU_EXCLUSIVE_U32_SCAN_WGSL = /* wgsl */ `
struct ScanParams {
    count: u32,
    reserved0: u32,
    reserved1: u32,
    reserved2: u32,
}

@group(0) @binding(0) var<uniform> params: ScanParams;
@group(0) @binding(1) var<storage, read> scanInput: array<u32>;
@group(0) @binding(2) var<storage, read_write> scanOutput: array<u32>;
@group(0) @binding(3) var<storage, read_write> blockSums: array<u32>;

var<workgroup> scratch: array<u32, ${GPU_SCAN_BLOCK_SIZE}>;

@compute @workgroup_size(${GPU_SCAN_WORKGROUP_SIZE})
fn scanBlocks(
    @builtin(local_invocation_index) localIndex: u32,
    @builtin(workgroup_id) workgroupId: vec3u,
) {
    let blockBase = workgroupId.x * ${GPU_SCAN_BLOCK_SIZE}u;
    let index = blockBase + localIndex;
    var ownValue = 0u;
    if (index < params.count) { ownValue = scanInput[index]; }
    scratch[localIndex] = ownValue;
    workgroupBarrier();

    var stride = 1u;
    loop {
        if (stride >= ${GPU_SCAN_BLOCK_SIZE}u) { break; }
        var addend = 0u;
        if (localIndex >= stride) { addend = scratch[localIndex - stride]; }
        workgroupBarrier();
        scratch[localIndex] = scratch[localIndex] + addend;
        workgroupBarrier();
        stride = stride * 2u;
    }

    if (localIndex == ${GPU_SCAN_BLOCK_SIZE - 1}u) {
        blockSums[workgroupId.x] = scratch[localIndex];
    }
    if (index < params.count) {
        scanOutput[index] = scratch[localIndex] - ownValue;
    }
}

@compute @workgroup_size(${GPU_SCAN_WORKGROUP_SIZE})
fn addBlockOffsets(@builtin(global_invocation_id) globalId: vec3u) {
    let index = globalId.x;
    if (index >= params.count) { return; }
    let block = index / ${GPU_SCAN_BLOCK_SIZE}u;
    if (block > 0u) {
        scanOutput[index] = scanOutput[index] + scanInput[block];
    }
}
`;

export class GpuExclusiveU32Scan {
    constructor(device, options = {}) {
        initializePrimitiveLifecycle(this, device, options, 'GpuExclusiveU32Scan');
        this.maxElements = resolveMaxElements(
            device,
            options.maxElements ?? GPU_PRIMITIVE_DEFAULT_MAX_ELEMENTS,
            { label: 'maxElements' },
        );
        this._slots = [];
        const module = device.createShaderModule({
            label: `${this.label} shader`,
            code: GPU_EXCLUSIVE_U32_SCAN_WGSL,
        });
        this._pipelines = {
            scan: device.createComputePipeline({
                label: `${this.label} block scan pipeline`,
                layout: 'auto',
                compute: { module, entryPoint: 'scanBlocks' },
            }),
            add: device.createComputePipeline({
                label: `${this.label} offset add pipeline`,
                layout: 'auto',
                compute: { module, entryPoint: 'addBlockOffsets' },
            }),
        };
    }

    encode(encoder, { input, output, count, generation = this.generation } = {}) {
        this._assertAlive(generation);
        assertCommandEncoder(encoder);
        assertCount(count, this.maxElements);
        const byteLength = Math.max(4, count * 4);
        assertGpuBuffer(input, byteLength, 'input');
        assertGpuBuffer(output, byteLength, 'output');
        assertDistinctBuffers([input, output], 'exclusive scan input/output');
        if (count === 0) {
            return createEncodeReceipt(this, null, [], {
                kind: 'exclusive-u32-scan',
                count,
                hierarchyLevels: 0,
            });
        }
        const slot = acquireWorkspace(
            this,
            this._slots,
            index => {
                const scan = createScanWorkspace(
                    this.device,
                    this.maxElements,
                    `${this.label} workspace ${index}`,
                );
                return { scan, destroy: () => scan.destroy() };
            },
            this.label,
        );
        let parameters = null;
        try {
            parameters = createScanParameters(this.device, count, `${this.label} parameters`);
            const hierarchyLevels = encodeScanCommands({
                device: this.device,
                encoder,
                pipelines: this._pipelines,
                workspace: slot.scan,
                input,
                output,
                count,
                parameters,
                label: this.label,
            });
            return createEncodeReceipt(this, slot, [parameters.buffer], {
                kind: 'exclusive-u32-scan',
                count,
                hierarchyLevels,
            });
        } catch (error) {
            try { parameters?.buffer?.destroy?.(); } catch (_) {}
            slot.busy = false;
            throw error;
        }
    }

    destroy() {
        return destroyPrimitiveLifecycle(this, this._slots);
    }
}

export default GpuExclusiveU32Scan;
