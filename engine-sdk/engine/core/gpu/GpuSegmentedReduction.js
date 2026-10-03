// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

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
    createStorageBuffer,
    createUniformRecords,
    destroyBuffer,
    destroyPrimitiveLifecycle,
    initializePrimitiveLifecycle,
    resolveMaxElements,
} from './GpuPrimitiveSupport.js';

const U32_BYTES = 4;
const VEC4_BYTES = 16;

export const GPU_SEGMENTED_VEC4_REDUCTION_WGSL = /* wgsl */ `
struct ReductionParams {
    valueCount: u32,
    segmentCount: u32,
    reserved0: u32,
    reserved1: u32,
}

@group(0) @binding(0) var<uniform> params: ReductionParams;
@group(0) @binding(1) var<storage, read> values: array<vec4f>;
@group(0) @binding(2) var<storage, read> segmentOffsets: array<u32>;
@group(0) @binding(3) var<storage, read_write> segmentSums: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> invalidSegmentCount: atomic<u32>;

var<workgroup> partialSums: array<vec4f, ${GPU_SCAN_WORKGROUP_SIZE}>;

@compute @workgroup_size(1)
fn clearValidation() {
    atomicStore(&invalidSegmentCount, 0u);
    if (params.segmentCount == 0u
        && (params.valueCount != 0u || segmentOffsets[0] != 0u)) {
        atomicStore(&invalidSegmentCount, 1u);
    }
}

@compute @workgroup_size(${GPU_SCAN_WORKGROUP_SIZE})
fn reduceSegments(
    @builtin(local_invocation_index) lane: u32,
    @builtin(workgroup_id) workgroupId: vec3u,
) {
    let segment = workgroupId.x;
    let start = segmentOffsets[segment];
    let end = segmentOffsets[segment + 1u];
    let startsAtOrigin = segment != 0u || start == 0u;
    let endsAtValueCount = segment + 1u != params.segmentCount || end == params.valueCount;
    let valid = start <= end
        && end <= params.valueCount
        && startsAtOrigin
        && endsAtValueCount;
    var sum = vec4f(0.0);
    var index = start + lane;
    loop {
        if (!valid || index >= end) { break; }
        sum += values[index];
        index += ${GPU_SCAN_WORKGROUP_SIZE}u;
    }
    partialSums[lane] = sum;
    workgroupBarrier();

    var stride = ${GPU_SCAN_WORKGROUP_SIZE / 2}u;
    loop {
        if (stride == 0u) { break; }
        if (lane < stride) {
            partialSums[lane] += partialSums[lane + stride];
        }
        workgroupBarrier();
        stride /= 2u;
    }

    if (lane == 0u) {
        if (valid) {
            segmentSums[segment] = partialSums[0];
        } else {
            segmentSums[segment] = vec4f(0.0);
            atomicAdd(&invalidSegmentCount, 1u);
        }
    }
}
`;

function createWorkspace(device, label) {
    const validation = createStorageBuffer(device, U32_BYTES, `${label} validation`);
    return {
        validation,
        destroy() { destroyBuffer(validation); },
    };
}

export class GpuSegmentedVec4Reduction {
    constructor(device, options = {}) {
        initializePrimitiveLifecycle(this, device, options, 'GpuSegmentedVec4Reduction');
        this.maxElements = resolveMaxElements(
            device,
            options.maxElements ?? GPU_PRIMITIVE_DEFAULT_MAX_ELEMENTS,
            {
                bytesPerElement: VEC4_BYTES,
                elementsPerWorkgroup: 1 << 20,
                label: 'maxElements',
            },
        );
        const dispatchLimit = Number(device.limits?.maxComputeWorkgroupsPerDimension) || 65535;
        const defaultMaxSegments = Math.min(this.maxElements, Math.floor(dispatchLimit));
        this.maxSegments = resolveMaxElements(
            device,
            options.maxSegments ?? defaultMaxSegments,
            {
                bytesPerElement: VEC4_BYTES,
                elementsPerWorkgroup: 1,
                label: 'maxSegments',
            },
        );
        this._slots = [];
        const module = device.createShaderModule({
            label: `${this.label} shader`,
            code: GPU_SEGMENTED_VEC4_REDUCTION_WGSL,
        });
        this._pipelines = {
            clear: device.createComputePipeline({
                label: `${this.label} clear validation pipeline`,
                layout: 'auto',
                compute: { module, entryPoint: 'clearValidation' },
            }),
            reduce: device.createComputePipeline({
                label: `${this.label} reduction pipeline`,
                layout: 'auto',
                compute: { module, entryPoint: 'reduceSegments' },
            }),
        };
    }

    encode(encoder, {
        values,
        offsets,
        output,
        valueCount,
        segmentCount,
        validationOutput = null,
        generation = this.generation,
    } = {}) {
        this._assertAlive(generation);
        assertCommandEncoder(encoder);
        assertCount(valueCount, this.maxElements, 'valueCount');
        assertCount(segmentCount, this.maxSegments, 'segmentCount');
        const valueBytes = Math.max(VEC4_BYTES, valueCount * VEC4_BYTES);
        const offsetBytes = Math.max(U32_BYTES, (segmentCount + 1) * U32_BYTES);
        const outputBytes = Math.max(VEC4_BYTES, segmentCount * VEC4_BYTES);
        assertGpuBuffer(values, valueBytes, 'values');
        assertGpuBuffer(offsets, offsetBytes, 'offsets');
        assertGpuBuffer(output, outputBytes, 'output');
        if (validationOutput) assertGpuBuffer(validationOutput, U32_BYTES, 'validationOutput');
        assertDistinctBuffers(
            validationOutput
                ? [values, offsets, output, validationOutput]
                : [values, offsets, output],
            'segmented reduction input/output',
        );

        const slot = acquireWorkspace(
            this,
            this._slots,
            index => createWorkspace(this.device, `${this.label} workspace ${index}`),
            this.label,
        );
        const validation = validationOutput || slot.validation;
        let parameters = null;
        try {
            parameters = createUniformRecords(
                this.device,
                [[valueCount, segmentCount, 0, 0]],
                `${this.label} parameters`,
            );
            const parameterResource = { buffer: parameters.buffer, offset: 0, size: 16 };
            const clearBindings = this.device.createBindGroup({
                label: `${this.label} clear bindings`,
                layout: this._pipelines.clear.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: parameterResource },
                    { binding: 2, resource: bufferResource(offsets, offsetBytes) },
                    { binding: 4, resource: bufferResource(validation, U32_BYTES) },
                ],
            });
            const clearPass = encoder.beginComputePass({ label: `${this.label} clear validation` });
            clearPass.setPipeline(this._pipelines.clear);
            clearPass.setBindGroup(0, clearBindings);
            clearPass.dispatchWorkgroups(1);
            clearPass.end();

            if (segmentCount > 0) {
                const reductionBindings = this.device.createBindGroup({
                    label: `${this.label} reduction bindings`,
                    layout: this._pipelines.reduce.getBindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: parameterResource },
                        { binding: 1, resource: bufferResource(values, valueBytes) },
                        { binding: 2, resource: bufferResource(offsets, offsetBytes) },
                        { binding: 3, resource: bufferResource(output, outputBytes) },
                        { binding: 4, resource: bufferResource(validation, U32_BYTES) },
                    ],
                });
                const reductionPass = encoder.beginComputePass({ label: `${this.label} reduce` });
                reductionPass.setPipeline(this._pipelines.reduce);
                reductionPass.setBindGroup(0, reductionBindings);
                reductionPass.dispatchWorkgroups(segmentCount);
                reductionPass.end();
            }

            return createEncodeReceipt(this, slot, [parameters.buffer], {
                kind: 'segmented-vec4-reduction',
                valueCount,
                segmentCount,
                validationOutput: validation,
            });
        } catch (error) {
            destroyBuffer(parameters?.buffer);
            slot.busy = false;
            throw error;
        }
    }

    destroy() {
        return destroyPrimitiveLifecycle(this, this._slots);
    }
}

export default GpuSegmentedVec4Reduction;
