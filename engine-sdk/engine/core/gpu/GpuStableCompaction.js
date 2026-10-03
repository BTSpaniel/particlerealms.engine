// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { GPU_EXCLUSIVE_U32_SCAN_WGSL } from './GpuExclusiveScan.js';
import {
    GPU_PRIMITIVE_DEFAULT_MAX_ELEMENTS,
    GPU_SCAN_WORKGROUP_SIZE,
    acquireWorkspace,
    assertCommandEncoder,
    assertCount,
    assertDistinctBuffers,
    assertGpuBuffer,
    bufferResource,
    createEncodeReceipt,
    createScanParameters,
    createScanWorkspace,
    createStorageBuffer,
    createUniformRecords,
    destroyBuffer,
    destroyPrimitiveLifecycle,
    encodeScanCommands,
    initializePrimitiveLifecycle,
    resolveMaxElements,
} from './GpuPrimitiveSupport.js';

const U32_BYTES = 4;

export const GPU_STABLE_FLAG_COMPACTION_WGSL = /* wgsl */ `
struct CompactParams {
    count: u32,
    reserved0: u32,
    reserved1: u32,
    reserved2: u32,
}

@group(0) @binding(0) var<uniform> params: CompactParams;
@group(0) @binding(1) var<storage, read> inputFlags: array<u32>;
@group(0) @binding(2) var<storage, read> inputValues: array<u32>;
@group(0) @binding(3) var<storage, read_write> selectedFlags: array<u32>;
@group(0) @binding(4) var<storage, read> selectedOffsets: array<u32>;
@group(0) @binding(5) var<storage, read_write> compactedValues: array<u32>;
@group(0) @binding(6) var<storage, read_write> compactedCount: array<u32>;

@compute @workgroup_size(${GPU_SCAN_WORKGROUP_SIZE})
fn normalizeFlags(@builtin(global_invocation_id) globalId: vec3u) {
    let index = globalId.x;
    if (index >= params.count) { return; }
    selectedFlags[index] = select(0u, 1u, inputFlags[index] != 0u);
}

@compute @workgroup_size(${GPU_SCAN_WORKGROUP_SIZE})
fn scatterSelected(@builtin(global_invocation_id) globalId: vec3u) {
    let index = globalId.x;
    if (index == 0u) {
        if (params.count == 0u) {
            compactedCount[0] = 0u;
        } else {
            let last = params.count - 1u;
            compactedCount[0] = selectedOffsets[last] + selectedFlags[last];
        }
    }
    if (index >= params.count) { return; }
    if (selectedFlags[index] != 0u) {
        compactedValues[selectedOffsets[index]] = inputValues[index];
    }
}
`;

function createPipelines(device, label) {
    const scanModule = device.createShaderModule({
        label: `${label} scan shader`,
        code: GPU_EXCLUSIVE_U32_SCAN_WGSL,
    });
    const compactModule = device.createShaderModule({
        label: `${label} compaction shader`,
        code: GPU_STABLE_FLAG_COMPACTION_WGSL,
    });
    return {
        scan: {
            scan: device.createComputePipeline({
                label: `${label} block scan pipeline`,
                layout: 'auto',
                compute: { module: scanModule, entryPoint: 'scanBlocks' },
            }),
            add: device.createComputePipeline({
                label: `${label} offset add pipeline`,
                layout: 'auto',
                compute: { module: scanModule, entryPoint: 'addBlockOffsets' },
            }),
        },
        normalize: device.createComputePipeline({
            label: `${label} normalize pipeline`,
            layout: 'auto',
            compute: { module: compactModule, entryPoint: 'normalizeFlags' },
        }),
        scatter: device.createComputePipeline({
            label: `${label} scatter pipeline`,
            layout: 'auto',
            compute: { module: compactModule, entryPoint: 'scatterSelected' },
        }),
    };
}

function createWorkspace(device, maxElements, label) {
    const byteLength = maxElements * U32_BYTES;
    const scan = createScanWorkspace(device, maxElements, `${label} scan`);
    const selectedFlags = createStorageBuffer(device, byteLength, `${label} selected flags`);
    const selectedOffsets = createStorageBuffer(device, byteLength, `${label} selected offsets`);
    return {
        scan,
        selectedFlags,
        selectedOffsets,
        destroy() {
            scan.destroy();
            destroyBuffer(selectedFlags);
            destroyBuffer(selectedOffsets);
        },
    };
}

export class GpuStableFlagCompaction {
    constructor(device, options = {}) {
        initializePrimitiveLifecycle(this, device, options, 'GpuStableFlagCompaction');
        this.maxElements = resolveMaxElements(
            device,
            options.maxElements ?? GPU_PRIMITIVE_DEFAULT_MAX_ELEMENTS,
            { label: 'maxElements' },
        );
        this._slots = [];
        this._pipelines = createPipelines(device, this.label);
    }

    encode(encoder, {
        flags,
        values,
        output,
        count,
        countOutput,
        generation = this.generation,
    } = {}) {
        this._assertAlive(generation);
        assertCommandEncoder(encoder);
        assertCount(count, this.maxElements);
        const byteLength = Math.max(U32_BYTES, count * U32_BYTES);
        assertGpuBuffer(flags, byteLength, 'flags');
        assertGpuBuffer(values, byteLength, 'values');
        assertGpuBuffer(output, byteLength, 'output');
        assertGpuBuffer(countOutput, U32_BYTES, 'countOutput');
        assertDistinctBuffers(
            [flags, values, output, countOutput],
            'stable compaction input/output',
        );

        const slot = acquireWorkspace(
            this,
            this._slots,
            index => createWorkspace(
                this.device,
                this.maxElements,
                `${this.label} workspace ${index}`,
            ),
            this.label,
        );
        let compactParameters = null;
        let scanParameters = null;
        try {
            compactParameters = createUniformRecords(
                this.device,
                [[count, 0, 0, 0]],
                `${this.label} parameters`,
            );
            if (count > 0) {
                scanParameters = createScanParameters(
                    this.device,
                    count,
                    `${this.label} scan parameters`,
                );
            }
            const parameterResource = {
                buffer: compactParameters.buffer,
                offset: 0,
                size: 16,
            };
            const workgroups = Math.max(1, Math.ceil(count / GPU_SCAN_WORKGROUP_SIZE));
            const normalizeBindings = this.device.createBindGroup({
                label: `${this.label} normalize bindings`,
                layout: this._pipelines.normalize.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: parameterResource },
                    { binding: 1, resource: bufferResource(flags, byteLength) },
                    { binding: 3, resource: bufferResource(slot.selectedFlags, byteLength) },
                ],
            });
            const normalizePass = encoder.beginComputePass({ label: `${this.label} normalize` });
            normalizePass.setPipeline(this._pipelines.normalize);
            normalizePass.setBindGroup(0, normalizeBindings);
            normalizePass.dispatchWorkgroups(workgroups);
            normalizePass.end();

            if (count > 0) {
                encodeScanCommands({
                    device: this.device,
                    encoder,
                    pipelines: this._pipelines.scan,
                    workspace: slot.scan,
                    input: slot.selectedFlags,
                    output: slot.selectedOffsets,
                    count,
                    parameters: scanParameters,
                    label: this.label,
                });
            }

            const scatterBindings = this.device.createBindGroup({
                label: `${this.label} scatter bindings`,
                layout: this._pipelines.scatter.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: parameterResource },
                    { binding: 2, resource: bufferResource(values, byteLength) },
                    { binding: 3, resource: bufferResource(slot.selectedFlags, byteLength) },
                    { binding: 4, resource: bufferResource(slot.selectedOffsets, byteLength) },
                    { binding: 5, resource: bufferResource(output, byteLength) },
                    { binding: 6, resource: bufferResource(countOutput, U32_BYTES) },
                ],
            });
            const scatterPass = encoder.beginComputePass({ label: `${this.label} stable scatter` });
            scatterPass.setPipeline(this._pipelines.scatter);
            scatterPass.setBindGroup(0, scatterBindings);
            scatterPass.dispatchWorkgroups(workgroups);
            scatterPass.end();

            const transientBuffers = [compactParameters.buffer];
            if (scanParameters) transientBuffers.push(scanParameters.buffer);
            return createEncodeReceipt(this, slot, transientBuffers, {
                kind: 'stable-flag-compaction',
                count,
                countOutput,
            });
        } catch (error) {
            destroyBuffer(compactParameters?.buffer);
            destroyBuffer(scanParameters?.buffer);
            slot.busy = false;
            throw error;
        }
    }

    destroy() {
        return destroyPrimitiveLifecycle(this, this._slots);
    }
}

export default GpuStableFlagCompaction;
