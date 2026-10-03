// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createStorageBuffer, createUniformBuffer } from '../core/gpu/GpuBuffer.js';

const INDEXED_CLUSTER_CULLER_WGSL = /* wgsl */`
struct Params {
  planes : array<vec4<f32>, 6>,
  model : mat4x4<f32>,
  clusterCount : u32,
  _pad0 : u32,
  _pad1 : u32,
  _pad2 : u32,
};

struct Range {
  start : u32,
  count : u32,
};

struct IndirectDraw {
  indexCount : atomic<u32>,
  instanceCount : u32,
  firstIndex : u32,
  baseVertex : u32,
  firstInstance : u32,
};

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read> bounds : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> ranges : array<Range>;
@group(0) @binding(3) var<storage, read> srcIndices : array<u32>;
@group(0) @binding(4) var<storage, read_write> dstIndices : array<u32>;
@group(0) @binding(5) var<storage, read_write> indirect : IndirectDraw;

fn sphereOutsidePlane(c : vec3<f32>, r : f32, p : vec4<f32>) -> bool {
  return dot(p.xyz, c) + p.w < -r;
}

fn max3(a : f32, b : f32, c : f32) -> f32 {
  return max(a, max(b, c));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let ci = gid.x;
  if (ci >= params.clusterCount) { return; }

  let b = bounds[ci];
  let c = b.xyz;
  let r = b.w;

  let wc4 = params.model * vec4<f32>(c, 1.0);
  let wc = wc4.xyz;
  let sx = length(params.model[0].xyz);
  let sy = length(params.model[1].xyz);
  let sz = length(params.model[2].xyz);
  let wr = r * max3(sx, sy, sz);

  if (sphereOutsidePlane(wc, wr, params.planes[0])) { return; }
  if (sphereOutsidePlane(wc, wr, params.planes[1])) { return; }
  if (sphereOutsidePlane(wc, wr, params.planes[2])) { return; }
  if (sphereOutsidePlane(wc, wr, params.planes[3])) { return; }
  if (sphereOutsidePlane(wc, wr, params.planes[4])) { return; }
  if (sphereOutsidePlane(wc, wr, params.planes[5])) { return; }

  let range = ranges[ci];
  if (range.count == 0u) { return; }

  let dstBase = atomicAdd(&indirect.indexCount, range.count);

  var j = 0u;
  loop {
    if (j >= range.count) { break; }
    dstIndices[dstBase + j] = srcIndices[range.start + j];
    j = j + 1u;
  }
}
`;

const GEOMETRY_BUFFER_FIELDS = Object.freeze([
    'boundsBuffer',
    'rangesBuffer',
    'srcIndicesBuffer',
    'dstIndicesBuffer',
    'indirectBuffer',
]);

function cleanupFailure(errors, message, code) {
    const failure = new AggregateError(errors, message);
    failure.code = code;
    failure.cleanupUncertain = true;
    return failure;
}

function releaseOwnedBuffers(owner, fields, label) {
    const errors = [];
    for (const field of fields) {
        const resource = owner[field];
        owner[field] = null;
        if (!resource) continue;
        try { resource.destroy?.(); }
        catch (error) { errors.push(error); }
    }
    if (errors.length > 0) {
        throw cleanupFailure(errors, `${label} cleanup failed`, 'INDEXED_CULLER_BUFFER_CLEANUP_FAILED');
    }
}

export class IndexedClusterCuller {
    constructor(device, options = {}) {
        this.device = device;
        this.maxClusterIndices = (options.maxClusterIndices ?? 384) | 0;

        this.clusterCount = 0;
        this.bounds = null;
        this.ranges = null;
        this.sourceIndexCount = 0;

        this.paramsBuffer = null;
        this.boundsBuffer = null;
        this.rangesBuffer = null;
        this.srcIndicesBuffer = null;
        this.dstIndicesBuffer = null;
        this.indirectBuffer = null;

        this.pipeline = null;
        this.pipelinePromise = null;
        this.bindGroupLayout = null;
        this.bindGroup = null;

        this.paramsStaging = new ArrayBuffer(176);
        this.paramsF32 = new Float32Array(this.paramsStaging);
        this.paramsU32 = new Uint32Array(this.paramsStaging);

        this._planes = new Float32Array(24);
        this._indirectReset = new Uint32Array([0, 1, 0, 0, 0]);
        this._identityModel = new Float32Array([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1,
        ]);
    }

    initialize() {
        if (this.bindGroupLayout && this.paramsBuffer) {
            if (!this.pipeline && !this.pipelinePromise) {
                const module = this.device.createShaderModule({
                    label: 'indexedClusterCuller',
                    code: INDEXED_CLUSTER_CULLER_WGSL,
                });
                const layout = this.device.createPipelineLayout({
                    label: 'IndexedClusterCullerLayout',
                    bindGroupLayouts: [this.bindGroupLayout],
                });
                this.pipeline = this.device.createComputePipeline({
                    label: 'IndexedClusterCullerPipeline',
                    layout,
                    compute: { module, entryPoint: 'main' },
                });
            }
            return;
        }

        const computeVisibility = globalThis.GPUShaderStage?.COMPUTE ?? 0x4;
        const module = this.device.createShaderModule({
            label: 'indexedClusterCuller',
            code: INDEXED_CLUSTER_CULLER_WGSL,
        });
        this.bindGroupLayout = this.device.createBindGroupLayout({
            label: 'IndexedClusterCullerBindings',
            entries: [
                { binding: 0, visibility: computeVisibility, buffer: { type: 'uniform' } },
                { binding: 1, visibility: computeVisibility, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: computeVisibility, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: computeVisibility, buffer: { type: 'read-only-storage' } },
                { binding: 4, visibility: computeVisibility, buffer: { type: 'storage' } },
                { binding: 5, visibility: computeVisibility, buffer: { type: 'storage' } },
            ],
        });
        const layout = this.device.createPipelineLayout({
            label: 'IndexedClusterCullerLayout',
            bindGroupLayouts: [this.bindGroupLayout],
        });
        this.pipeline = this.device.createComputePipeline({
            label: 'IndexedClusterCullerPipeline',
            layout,
            compute: { module, entryPoint: 'main' },
        });
        this.paramsBuffer = createUniformBuffer(this.device, 176, { label: 'ClusterCullerParams' });
    }

    destroy() {
        const errors = [];
        try { releaseOwnedBuffers(this, GEOMETRY_BUFFER_FIELDS, 'IndexedClusterCuller geometry'); }
        catch (error) { errors.push(error); }
        try { releaseOwnedBuffers(this, ['paramsBuffer'], 'IndexedClusterCuller parameters'); }
        catch (error) { errors.push(error); }

        this.bindGroup = null;
        this.pipeline = null;
        this.bindGroupLayout = null;

        this.clusterCount = 0;
        this.bounds = null;
        this.ranges = null;
        this.sourceIndexCount = 0;
        if (errors.length > 0) {
            throw cleanupFailure(errors, 'IndexedClusterCuller cleanup failed', 'INDEXED_CULLER_CLEANUP_FAILED');
        }
    }

    clearGeometry() {
        let cleanupError = null;
        try { releaseOwnedBuffers(this, GEOMETRY_BUFFER_FIELDS, 'IndexedClusterCuller geometry'); }
        catch (error) { cleanupError = error; }

        this.bindGroup = null;

        this.clusterCount = 0;
        this.bounds = null;
        this.ranges = null;
        this.sourceIndexCount = 0;
        if (cleanupError) throw cleanupError;
    }

    hasGeometry() {
        return this.clusterCount > 0 && !!this.dstIndicesBuffer && !!this.indirectBuffer;
    }

    buildClusters(positions, indices) {
        const idxCount = (indices.length - (indices.length % 3)) | 0;
        const maxClusterIndices = this.maxClusterIndices;
        const clusterCount = Math.ceil(idxCount / maxClusterIndices);
        const bounds = new Float32Array(clusterCount * 4);
        const ranges = new Uint32Array(clusterCount * 2);

        for (let ci = 0; ci < clusterCount; ci++) {
            const start = ci * maxClusterIndices;
            let count = Math.min(maxClusterIndices, idxCount - start);
            count -= (count % 3);

            ranges[ci * 2 + 0] = start;
            ranges[ci * 2 + 1] = count;

            if (count === 0) {
                bounds[ci * 4 + 0] = 0;
                bounds[ci * 4 + 1] = 0;
                bounds[ci * 4 + 2] = 0;
                bounds[ci * 4 + 3] = 0;
                continue;
            }

            let minX = Infinity, minY = Infinity, minZ = Infinity;
            let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

            for (let i = 0; i < count; i++) {
                const vi = indices[start + i] * 3;
                const x = positions[vi];
                const y = positions[vi + 1];
                const z = positions[vi + 2];
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (z < minZ) minZ = z;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
                if (z > maxZ) maxZ = z;
            }

            const cx = (minX + maxX) * 0.5;
            const cy = (minY + maxY) * 0.5;
            const cz = (minZ + maxZ) * 0.5;

            let r2 = 0;
            for (let i = 0; i < count; i++) {
                const vi = indices[start + i] * 3;
                const dx = positions[vi] - cx;
                const dy = positions[vi + 1] - cy;
                const dz = positions[vi + 2] - cz;
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 > r2) r2 = d2;
            }

            bounds[ci * 4 + 0] = cx;
            bounds[ci * 4 + 1] = cy;
            bounds[ci * 4 + 2] = cz;
            bounds[ci * 4 + 3] = Math.sqrt(r2);
        }

        return { clusterCount, bounds, ranges, idxCount };
    }

    setGeometry(positions, indices) {
        if ((!this.bindGroupLayout && !this.pipeline && !this.pipelinePromise) || !this.paramsBuffer) {
            this.initialize();
        }

        if (!positions || positions.length === 0 || !indices || indices.length === 0) {
            this.clearGeometry();
            return;
        }

        const idx32 = (indices instanceof Uint32Array) ? indices : new Uint32Array(indices);

        const built = this.buildClusters(positions, idx32);
        const indexBytes = built.idxCount * 4;
        const candidate = Object.fromEntries(GEOMETRY_BUFFER_FIELDS.map(field => [field, null]));
        let candidateBindGroup = null;
        try {
            candidate.boundsBuffer = createStorageBuffer(this.device, built.bounds, { label: 'ClusterBounds' });
            candidate.rangesBuffer = createStorageBuffer(this.device, built.ranges, { label: 'ClusterRanges' });
            candidate.srcIndicesBuffer = createStorageBuffer(this.device, Math.max(indexBytes, 4), {
                label: 'ClusterSrcIndices',
            });
            this.device.queue.writeBuffer(candidate.srcIndicesBuffer, 0, idx32.buffer, idx32.byteOffset, indexBytes);
            candidate.dstIndicesBuffer = createStorageBuffer(this.device, Math.max(indexBytes, 4), {
                label: 'ClusterDstIndices',
                usageExtra: globalThis.GPUBufferUsage?.INDEX ?? 0x10,
            });
            candidate.indirectBuffer = createStorageBuffer(this.device, 20, {
                label: 'ClusterIndirect',
                usageExtra: globalThis.GPUBufferUsage?.INDIRECT ?? 0x100,
            });

            const copyEncoder = this.device.createCommandEncoder({ label: "IndexedClusterCuller_init_copy" });
            copyEncoder.copyBufferToBuffer(
                candidate.srcIndicesBuffer,
                0,
                candidate.dstIndicesBuffer,
                0,
                Math.max(indexBytes, 4),
            );
            this.device.queue.submit([copyEncoder.finish()]);

            const initialIndirect = new Uint32Array([built.idxCount, 1, 0, 0, 0]);
            this.device.queue.writeBuffer(candidate.indirectBuffer, 0, initialIndirect);

            candidateBindGroup = this.device.createBindGroup({
                label: 'IndexedClusterCullerGeometry',
                layout: this.bindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.paramsBuffer } },
                    { binding: 1, resource: { buffer: candidate.boundsBuffer } },
                    { binding: 2, resource: { buffer: candidate.rangesBuffer } },
                    { binding: 3, resource: { buffer: candidate.srcIndicesBuffer } },
                    { binding: 4, resource: { buffer: candidate.dstIndicesBuffer } },
                    { binding: 5, resource: { buffer: candidate.indirectBuffer } },
                ],
            });
        } catch (error) {
            try { releaseOwnedBuffers(candidate, GEOMETRY_BUFFER_FIELDS, 'IndexedClusterCuller candidate geometry'); }
            catch (cleanupError) {
                throw cleanupFailure(
                    [error, cleanupError],
                    'IndexedClusterCuller candidate geometry preparation and rollback both failed',
                    'INDEXED_CULLER_PREPARATION_ROLLBACK_FAILED',
                );
            }
            throw error;
        }

        try {
            releaseOwnedBuffers(this, GEOMETRY_BUFFER_FIELDS, 'IndexedClusterCuller prior geometry');
        } catch (error) {
            const errors = [error];
            try { releaseOwnedBuffers(candidate, GEOMETRY_BUFFER_FIELDS, 'IndexedClusterCuller candidate geometry'); }
            catch (cleanupError) { errors.push(cleanupError); }
            this.bindGroup = null;
            this.clusterCount = 0;
            this.bounds = null;
            this.ranges = null;
            this.sourceIndexCount = 0;
            throw cleanupFailure(
                errors,
                'IndexedClusterCuller prior geometry retirement failed',
                'INDEXED_CULLER_RETIREMENT_FAILED',
            );
        }
        for (const field of GEOMETRY_BUFFER_FIELDS) this[field] = candidate[field];
        this.bindGroup = candidateBindGroup;
        this.clusterCount = built.clusterCount | 0;
        this.bounds = built.bounds;
        this.ranges = built.ranges;
        this.sourceIndexCount = built.idxCount | 0;
    }

    extractFrustumPlanes(viewProj, outPlanes = null) {
        const m = viewProj;
        const row = (r, c) => m[c * 4 + r];
        const planes = outPlanes || new Float32Array(24);

        const makePlane = (dst, a, b, c, d) => {
            const len = Math.hypot(a, b, c) || 1;
            planes[dst + 0] = a / len;
            planes[dst + 1] = b / len;
            planes[dst + 2] = c / len;
            planes[dst + 3] = d / len;
        };

        const r0x = row(0, 0), r0y = row(0, 1), r0z = row(0, 2), r0w = row(0, 3);
        const r1x = row(1, 0), r1y = row(1, 1), r1z = row(1, 2), r1w = row(1, 3);
        const r2x = row(2, 0), r2y = row(2, 1), r2z = row(2, 2), r2w = row(2, 3);
        const r3x = row(3, 0), r3y = row(3, 1), r3z = row(3, 2), r3w = row(3, 3);

        makePlane(0,  r3x + r0x, r3y + r0y, r3z + r0z, r3w + r0w);
        makePlane(4,  r3x - r0x, r3y - r0y, r3z - r0z, r3w - r0w);
        makePlane(8,  r3x + r1x, r3y + r1y, r3z + r1z, r3w + r1w);
        makePlane(12, r3x - r1x, r3y - r1y, r3z - r1z, r3w - r1w);
        makePlane(16, r2x, r2y, r2z, r2w);
        makePlane(20, r3x - r2x, r3y - r2y, r3z - r2z, r3w - r2w);

        return planes;
    }

    estimateVisibleIndexCount(viewProj, modelMatrix = null) {
        if (!this.clusterCount || !this.bounds || !this.ranges) return this.sourceIndexCount | 0;

        const planes = this._planes;
        this.extractFrustumPlanes(viewProj, planes);

        const m = modelMatrix && modelMatrix.length >= 16 ? modelMatrix : this._identityModel;

        const m0 = m[0],  m1 = m[1],  m2 = m[2];
        const m4 = m[4],  m5 = m[5],  m6 = m[6];
        const m8 = m[8],  m9 = m[9],  m10 = m[10];
        const m12 = m[12], m13 = m[13], m14 = m[14];

        const sx = Math.hypot(m0, m1, m2);
        const sy = Math.hypot(m4, m5, m6);
        const sz = Math.hypot(m8, m9, m10);
        const maxScale = Math.max(sx, sy, sz) || 1;

        let visible = 0;
        for (let ci = 0; ci < this.clusterCount; ci++) {
            const bx = this.bounds[ci * 4 + 0];
            const by = this.bounds[ci * 4 + 1];
            const bz = this.bounds[ci * 4 + 2];
            const br = this.bounds[ci * 4 + 3] * maxScale;

            const wx = m0 * bx + m4 * by + m8 * bz + m12;
            const wy = m1 * bx + m5 * by + m9 * bz + m13;
            const wz = m2 * bx + m6 * by + m10 * bz + m14;

            let inside = true;
            for (let pi = 0; pi < 6; pi++) {
                const a = planes[pi * 4 + 0];
                const b = planes[pi * 4 + 1];
                const c = planes[pi * 4 + 2];
                const d = planes[pi * 4 + 3];
                if (a * wx + b * wy + c * wz + d < -br) { inside = false; break; }
            }

            if (!inside) continue;
            visible += this.ranges[ci * 2 + 1];
        }

        return visible | 0;
    }

    encodeCulling(commandEncoder, viewProj, modelMatrix = null) {
        if (!this.pipeline || !this.bindGroup || !this.clusterCount || !this.indirectBuffer) return;

        const planes = this._planes;
        this.extractFrustumPlanes(viewProj, planes);

        for (let i = 0; i < 24; i++) this.paramsF32[i] = planes[i];
        const model = modelMatrix && modelMatrix.length >= 16 ? modelMatrix : this._identityModel;
        for (let i = 0; i < 16; i++) this.paramsF32[24 + i] = model[i];
        this.paramsU32[40] = this.clusterCount;
        this.paramsU32[41] = 0;
        this.paramsU32[42] = 0;
        this.paramsU32[43] = 0;

        this.device.queue.writeBuffer(this.paramsBuffer, 0, this.paramsStaging);
        this.device.queue.writeBuffer(this.indirectBuffer, 0, this._indirectReset);

        const pass = commandEncoder.beginComputePass();
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.dispatchWorkgroups(Math.ceil(this.clusterCount / 64));
        pass.end();
    }
}
