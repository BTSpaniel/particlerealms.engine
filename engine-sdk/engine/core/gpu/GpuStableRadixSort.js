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

export const GPU_STABLE_U32_RADIX_SORT_WGSL = /* wgsl */ `
struct RadixParams {
    count: u32,
    bit: u32,
    reserved0: u32,
    reserved1: u32,
}

@group(0) @binding(0) var<uniform> params: RadixParams;
@group(0) @binding(1) var<storage, read> sourceKeys: array<u32>;
@group(0) @binding(2) var<storage, read> sourceValues: array<u32>;
@group(0) @binding(3) var<storage, read_write> zeroFlags: array<u32>;
@group(0) @binding(4) var<storage, read> zeroOffsets: array<u32>;
@group(0) @binding(5) var<storage, read_write> destinationKeys: array<u32>;
@group(0) @binding(6) var<storage, read_write> destinationValues: array<u32>;

@compute @workgroup_size(${GPU_SCAN_WORKGROUP_SIZE})
fn classifyZeroBits(@builtin(global_invocation_id) globalId: vec3u) {
    let index = globalId.x;
    if (index >= params.count) { return; }
    zeroFlags[index] = select(0u, 1u, ((sourceKeys[index] >> params.bit) & 1u) == 0u);
}

@compute @workgroup_size(${GPU_SCAN_WORKGROUP_SIZE})
fn scatterBit(@builtin(global_invocation_id) globalId: vec3u) {
    let index = globalId.x;
    if (index >= params.count) { return; }
    let last = params.count - 1u;
    let totalZeros = zeroOffsets[last] + zeroFlags[last];
    let zerosBefore = zeroOffsets[index];
    let destination = select(
        totalZeros + index - zerosBefore,
        zerosBefore,
        zeroFlags[index] != 0u,
    );
    destinationKeys[destination] = sourceKeys[index];
    destinationValues[destination] = sourceValues[index];
}

@compute @workgroup_size(${GPU_SCAN_WORKGROUP_SIZE})
fn copyPairs(@builtin(global_invocation_id) globalId: vec3u) {
    let index = globalId.x;
    if (index >= params.count) { return; }
    destinationKeys[index] = sourceKeys[index];
    destinationValues[index] = sourceValues[index];
}
`;

function createPipelines(device, label) {
    const scanModule = device.createShaderModule({
        label: `${label} scan shader`,
        code: GPU_EXCLUSIVE_U32_SCAN_WGSL,
    });
    const radixModule = device.createShaderModule({
        label: `${label} radix shader`,
        code: GPU_STABLE_U32_RADIX_SORT_WGSL,
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
        classify: device.createComputePipeline({
            label: `${label} classify pipeline`,
            layout: 'auto',
            compute: { module: radixModule, entryPoint: 'classifyZeroBits' },
        }),
        scatter: device.createComputePipeline({
            label: `${label} scatter pipeline`,
            layout: 'auto',
            compute: { module: radixModule, entryPoint: 'scatterBit' },
        }),
        copy: device.createComputePipeline({
            label: `${label} pair copy pipeline`,
            layout: 'auto',
            compute: { module: radixModule, entryPoint: 'copyPairs' },
        }),
    };
}

function createWorkspace(device, maxElements, label) {
    const byteLength = maxElements * U32_BYTES;
    const scan = createScanWorkspace(device, maxElements, `${label} scan`);
    const zeroFlags = createStorageBuffer(device, byteLength, `${label} zero flags`);
    const zeroOffsets = createStorageBuffer(device, byteLength, `${label} zero offsets`);
    const scratchKeys = createStorageBuffer(device, byteLength, `${label} scratch keys`);
    const scratchValues = createStorageBuffer(device, byteLength, `${label} scratch values`);
    return {
        scan,
        zeroFlags,
        zeroOffsets,
        scratchKeys,
        scratchValues,
        destroy() {
            scan.destroy();
            destroyBuffer(zeroFlags);
            destroyBuffer(zeroOffsets);
            destroyBuffer(scratchKeys);
            destroyBuffer(scratchValues);
        },
    };
}

export class GpuStableU32RadixSort {
    constructor(device, options = {}) {
        initializePrimitiveLifecycle(this, device, options, 'GpuStableU32RadixSort');
        this.maxElements = resolveMaxElements(
            device,
            options.maxElements ?? GPU_PRIMITIVE_DEFAULT_MAX_ELEMENTS,
            { label: 'maxElements' },
        );
        this._slots = [];
        this._pipelines = createPipelines(device, this.label);
    }

    encode(encoder, {
        inputKeys,
        inputValues,
        outputKeys,
        outputValues,
        count,
        bitCount = 32,
        generation = this.generation,
    } = {}) {
        this._assertAlive(generation);
        assertCommandEncoder(encoder);
        assertCount(count, this.maxElements);
        assertCount(bitCount, 32, 'bitCount');
        if (bitCount === 0) throw new RangeError('bitCount must be from 1 through 32');
        const byteLength = Math.max(U32_BYTES, count * U32_BYTES);
        for (const [buffer, name] of [
            [inputKeys, 'inputKeys'],
            [inputValues, 'inputValues'],
            [outputKeys, 'outputKeys'],
            [outputValues, 'outputValues'],
        ]) assertGpuBuffer(buffer, byteLength, name);

        const inPlace = inputKeys === outputKeys && inputValues === outputValues;
        const partialAlias = inputKeys === outputKeys || inputValues === outputValues;
        if (!inPlace && partialAlias) {
            throw new RangeError('radix sort must be fully in-place or fully out-of-place');
        }
        if (inPlace) {
            assertDistinctBuffers([inputKeys, inputValues], 'in-place radix key/value');
        } else {
            assertDistinctBuffers(
                [inputKeys, inputValues, outputKeys, outputValues],
                'out-of-place radix key/value',
            );
        }
        if (count === 0) {
            return createEncodeReceipt(this, null, [], {
                kind: 'stable-u32-radix-sort',
                count,
                bitCount,
                inPlace,
            });
        }

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
        let scanParameters = null;
        let radixParameters = null;
        try {
            scanParameters = createScanParameters(
                this.device,
                count,
                `${this.label} scan parameters`,
            );
            radixParameters = createUniformRecords(
                this.device,
                Array.from({ length: bitCount }, (_, bit) => [count, bit, 0, 0]),
                `${this.label} radix parameters`,
            );
            let sourceKeys = inputKeys;
            let sourceValues = inputValues;
            let destinationKeys = inPlace || bitCount % 2 === 0
                ? slot.scratchKeys
                : outputKeys;
            let destinationValues = inPlace || bitCount % 2 === 0
                ? slot.scratchValues
                : outputValues;
            const workgroups = Math.ceil(count / GPU_SCAN_WORKGROUP_SIZE);

            for (let bit = 0; bit < bitCount; bit++) {
                const parameterResource = {
                    buffer: radixParameters.buffer,
                    offset: bit * radixParameters.stride,
                    size: 16,
                };
                const classifyBindings = this.device.createBindGroup({
                    label: `${this.label} bit ${bit} classify bindings`,
                    layout: this._pipelines.classify.getBindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: parameterResource },
                        { binding: 1, resource: bufferResource(sourceKeys, count * U32_BYTES) },
                        { binding: 3, resource: bufferResource(slot.zeroFlags, count * U32_BYTES) },
                    ],
                });
                const classifyPass = encoder.beginComputePass({
                    label: `${this.label} bit ${bit} classify`,
                });
                classifyPass.setPipeline(this._pipelines.classify);
                classifyPass.setBindGroup(0, classifyBindings);
                classifyPass.dispatchWorkgroups(workgroups);
                classifyPass.end();

                encodeScanCommands({
                    device: this.device,
                    encoder,
                    pipelines: this._pipelines.scan,
                    workspace: slot.scan,
                    input: slot.zeroFlags,
                    output: slot.zeroOffsets,
                    count,
                    parameters: scanParameters,
                    label: `${this.label} bit ${bit}`,
                });

                const scatterBindings = this.device.createBindGroup({
                    label: `${this.label} bit ${bit} scatter bindings`,
                    layout: this._pipelines.scatter.getBindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: parameterResource },
                        { binding: 1, resource: bufferResource(sourceKeys, count * U32_BYTES) },
                        { binding: 2, resource: bufferResource(sourceValues, count * U32_BYTES) },
                        { binding: 3, resource: bufferResource(slot.zeroFlags, count * U32_BYTES) },
                        { binding: 4, resource: bufferResource(slot.zeroOffsets, count * U32_BYTES) },
                        { binding: 5, resource: bufferResource(destinationKeys, count * U32_BYTES) },
                        { binding: 6, resource: bufferResource(destinationValues, count * U32_BYTES) },
                    ],
                });
                const scatterPass = encoder.beginComputePass({
                    label: `${this.label} bit ${bit} stable scatter`,
                });
                scatterPass.setPipeline(this._pipelines.scatter);
                scatterPass.setBindGroup(0, scatterBindings);
                scatterPass.dispatchWorkgroups(workgroups);
                scatterPass.end();

                sourceKeys = destinationKeys;
                sourceValues = destinationValues;
                if (inPlace) {
                    destinationKeys = sourceKeys === slot.scratchKeys ? outputKeys : slot.scratchKeys;
                    destinationValues = sourceValues === slot.scratchValues
                        ? outputValues
                        : slot.scratchValues;
                } else {
                    destinationKeys = sourceKeys === slot.scratchKeys ? outputKeys : slot.scratchKeys;
                    destinationValues = sourceValues === slot.scratchValues
                        ? outputValues
                        : slot.scratchValues;
                }
            }

            if (sourceKeys !== outputKeys || sourceValues !== outputValues) {
                const copyBindings = this.device.createBindGroup({
                    label: `${this.label} final copy bindings`,
                    layout: this._pipelines.copy.getBindGroupLayout(0),
                    entries: [
                        {
                            binding: 0,
                            resource: {
                                buffer: radixParameters.buffer,
                                offset: 0,
                                size: 16,
                            },
                        },
                        { binding: 1, resource: bufferResource(sourceKeys, count * U32_BYTES) },
                        { binding: 2, resource: bufferResource(sourceValues, count * U32_BYTES) },
                        { binding: 5, resource: bufferResource(outputKeys, count * U32_BYTES) },
                        { binding: 6, resource: bufferResource(outputValues, count * U32_BYTES) },
                    ],
                });
                const copyPass = encoder.beginComputePass({ label: `${this.label} final copy` });
                copyPass.setPipeline(this._pipelines.copy);
                copyPass.setBindGroup(0, copyBindings);
                copyPass.dispatchWorkgroups(workgroups);
                copyPass.end();
            }

            return createEncodeReceipt(
                this,
                slot,
                [scanParameters.buffer, radixParameters.buffer],
                {
                    kind: 'stable-u32-radix-sort',
                    count,
                    bitCount,
                    inPlace,
                },
            );
        } catch (error) {
            destroyBuffer(scanParameters?.buffer);
            destroyBuffer(radixParameters?.buffer);
            slot.busy = false;
            throw error;
        }
    }

    destroy() {
        return destroyPrimitiveLifecycle(this, this._slots);
    }
}

export default GpuStableU32RadixSort;
