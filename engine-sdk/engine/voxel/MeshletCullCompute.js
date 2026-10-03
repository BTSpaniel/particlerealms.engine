// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { initVGPU } from '../core/gpu/VirtualGPU.js';

// Reusable buffers for hot paths (reduce/reuse/recycle)
let _meshletCullCapacity = 256;
let _meshletCullData = new Float32Array(_meshletCullCapacity * 12);

function ensureMeshletCullCapacity(count) {
    if (count <= _meshletCullCapacity) return;
    while (_meshletCullCapacity < count) {
        _meshletCullCapacity *= 2;
    }
    _meshletCullData = new Float32Array(_meshletCullCapacity * 12);
}

const MESHLET_CULL_SHADER = /* wgsl */ `
struct CullParams {
    viewProj: mat4x4<f32>,
    cameraPos: vec3<f32>,
    _pad0: f32,
    frustumPlanes: array<vec4<f32>, 6>,
    screenSize: vec2<f32>,
    nearPlane: f32,
    farPlane: f32,
    maxRenderDistance: f32,
    enableOcclusion: u32,
    enableFrustum: u32,
    vertexCountPerInstance: u32,
}

struct MeshletInfo {
    aabbMin: vec3<f32>,
    _padA: u32,
    aabbMax: vec3<f32>,
    firstFace: u32,
    faceCount: u32,
    chunkKey: u32,
    materialGroup: u32,
    _padB: u32,
}

struct DrawIndirect {
    vertexCount: u32,
    instanceCount: u32,
    firstVertex: u32,
    firstInstance: u32,
}

@group(0) @binding(0) var<uniform> params: CullParams;
@group(0) @binding(1) var<storage, read> meshlets: array<MeshletInfo>;
@group(0) @binding(2) var<storage, read_write> visibleIds: array<u32>;
@group(0) @binding(3) var<storage, read_write> visibleCount: atomic<u32>;
@group(0) @binding(4) var<storage, read_write> drawArgs: DrawIndirect;
@group(0) @binding(5) var hiZTexture: texture_2d<f32>;
@group(0) @binding(6) var hiZSampler: sampler;

fn frustumCull(aabbMin: vec3<f32>, aabbMax: vec3<f32>) -> bool {
    for (var i = 0u; i < 6u; i++) {
        let plane = params.frustumPlanes[i];
        let p = vec3<f32>(
            select(aabbMin.x, aabbMax.x, plane.x > 0.0),
            select(aabbMin.y, aabbMax.y, plane.y > 0.0),
            select(aabbMin.z, aabbMax.z, plane.z > 0.0)
        );
        if (dot(plane.xyz, p) + plane.w < 0.0) {
            return false;
        }
    }
    return true;
}

fn projectAABB(aabbMin: vec3<f32>, aabbMax: vec3<f32>) -> vec4<f32> {
    var minScreen = vec2<f32>(1.0, 1.0);
    var maxScreen = vec2<f32>(0.0, 0.0);
    var minDepth = 1.0;

    for (var i = 0u; i < 8u; i++) {
        let corner = vec3<f32>(
            select(aabbMin.x, aabbMax.x, (i & 1u) != 0u),
            select(aabbMin.y, aabbMax.y, (i & 2u) != 0u),
            select(aabbMin.z, aabbMax.z, (i & 4u) != 0u)
        );

        let clip = params.viewProj * vec4<f32>(corner, 1.0);
        if (clip.w <= 0.0) {
            continue;
        }

        let ndc = clip.xyz / clip.w;
        let screen = ndc.xy * 0.5 + 0.5;
        minScreen = min(minScreen, screen);
        maxScreen = max(maxScreen, screen);
        minDepth = min(minDepth, ndc.z);
    }

    minScreen = clamp(minScreen, vec2<f32>(0.0), vec2<f32>(1.0));
    maxScreen = clamp(maxScreen, vec2<f32>(0.0), vec2<f32>(1.0));

    let size = max(maxScreen.x - minScreen.x, maxScreen.y - minScreen.y);
    return vec4<f32>(minScreen, size, minDepth);
}

fn occlusionCull(aabbMin: vec3<f32>, aabbMax: vec3<f32>) -> bool {
    let projected = projectAABB(aabbMin, aabbMax);
    let screenMin = projected.xy;
    let screenSize = projected.z;
    let objectDepth = projected.w;

    if (screenSize <= 0.0) {
        return true;
    }

    let pixelSize = screenSize * max(params.screenSize.x, params.screenSize.y);
    let mipLevel = clamp(u32(log2(pixelSize)), 0u, 9u);

    let samplePos = screenMin + vec2<f32>(screenSize * 0.5);
    let hiZDepth = textureSampleLevel(hiZTexture, hiZSampler, samplePos, f32(mipLevel)).r;

    if (objectDepth > hiZDepth + 0.001) {
        return false;
    }

    return true;
}

@compute @workgroup_size(64)
fn cullMain(@builtin(global_invocation_id) gid: vec3<u32>) {
    let meshletIndex = gid.x;
    if (meshletIndex >= arrayLength(&meshlets)) {
        return;
    }

    let m = meshlets[meshletIndex];

    if (params.maxRenderDistance > 0.0) {
        let center = (m.aabbMin + m.aabbMax) * 0.5;
        let distance = length(center - params.cameraPos);
        if (distance > params.maxRenderDistance) {
            return;
        }
    }

    if (params.enableFrustum != 0u) {
        if (!frustumCull(m.aabbMin, m.aabbMax)) {
            return;
        }
    }

    if (params.enableOcclusion != 0u) {
        if (!occlusionCull(m.aabbMin, m.aabbMax)) {
            return;
        }
    }

    let outIndex = atomicAdd(&visibleCount, 1u);
    visibleIds[outIndex] = meshletIndex;
}

@compute @workgroup_size(1)
fn finalizeMain() {
    drawArgs.vertexCount = params.vertexCountPerInstance;
    drawArgs.instanceCount = atomicLoad(&visibleCount);
    drawArgs.firstVertex = 0u;
    drawArgs.firstInstance = 0u;
}
`;

export class MeshletCullCompute {
    constructor() {
        this.vgpu = null;
        this.device = null;
        this.initialized = false;

        this.maxMeshlets = 65536;
        this.maxRenderDistance = 0;
        this.enableFrustumCulling = true;
        this.enableOcclusionCulling = true;

        this.vertexCountPerInstance = 0;

        this.hiZTexture = null;
        this.hiZSampler = null;
        this.hiZView = null;

        this.paramsBuffer = null;
        this.meshletInfoBuffer = null;
        this.visibleIdsBuffer = null;
        this.visibleCountBuffer = null;
        this.drawArgsBuffer = null;

        this.bindGroupLayout = null;
        this.bindGroup = null;

        this.cullPipeline = null;
        this.finalizePipeline = null;

        this._visibleCountReset = new Uint32Array([0]);
        this._params = new ArrayBuffer(256);
        this._paramsFloats = new Float32Array(this._params);
        this._paramsView = new DataView(this._params);
    }

    async init(device, opts = {}) {
        this.vgpu = initVGPU(device);
        this.device = device;

        if (opts.maxMeshlets !== undefined) this.maxMeshlets = opts.maxMeshlets;
        if (opts.vertexCountPerInstance !== undefined) this.vertexCountPerInstance = opts.vertexCountPerInstance;

        // Compile shader using vGPU
        const module = this.vgpu.shader.compile('meshletCull', MESHLET_CULL_SHADER);

        // Create sampler using vGPU
        this.hiZSampler = this.vgpu.texture.sampler({ filter: 'nearest', addressMode: 'clamp-to-edge' });

        // Define bind group layout using vGPU
        this.bindGroupLayout = this.vgpu.bindings.defineLayout('meshletCull', [
            { binding: 0, type: 'uniform', visibility: 'compute' },
            { binding: 1, type: 'read-storage', visibility: 'compute' },
            { binding: 2, type: 'storage', visibility: 'compute' },
            { binding: 3, type: 'storage', visibility: 'compute' },
            { binding: 4, type: 'storage', visibility: 'compute' },
            { binding: 5, type: 'texture', visibility: 'compute', sampleType: 'unfilterable-float' },
            { binding: 6, type: 'sampler', visibility: 'compute', samplerType: 'non-filtering' },
        ]);

        // Create pipelines using vGPU
        this.cullPipeline = this.vgpu.pipeline.compute({
            module, entryPoint: 'cullMain',
            layouts: [this.bindGroupLayout], label: 'MeshletCullPipeline'
        });

        this.finalizePipeline = this.vgpu.pipeline.compute({
            module, entryPoint: 'finalizeMain',
            layouts: [this.bindGroupLayout], label: 'MeshletFinalizePipeline'
        });

        // Create buffers using vGPU
        this.paramsBuffer = this.vgpu.buffer.create({ size: 256, usage: 'uniform', label: 'MeshletCullParams' }).buffer;
        this.meshletInfoBuffer = this.vgpu.buffer.create({ size: this.maxMeshlets * 48, usage: 'storage', label: 'MeshletInfo' }).buffer;
        this.visibleIdsBuffer = this.vgpu.buffer.create({ size: this.maxMeshlets * 4, usage: 'storage|copy-src', label: 'VisibleMeshletIDs' }).buffer;
        this.visibleCountBuffer = this.vgpu.buffer.create({ size: 4, usage: 'storage|copy-src', label: 'VisibleMeshletCount' }).buffer;
        this.drawArgsBuffer = this.vgpu.buffer.create({ size: 16, usage: 'indirect|copy-src', label: 'MeshletDrawArgs' }).buffer;

        // Create placeholder Hi-Z texture using vGPU
        const hiZResult = this.vgpu.texture.create({ width: 1, height: 1, format: 'r32float', usage: 'texture', label: 'MeshletPlaceholderHiZ' });
        this.hiZTexture = hiZResult.texture;
        this.hiZView = this.hiZTexture.createView();

        // Create bind group using vGPU
        this.bindGroup = this.vgpu.bindings.createGroup(this.bindGroupLayout, [
            { binding: 0, buffer: this.paramsBuffer },
            { binding: 1, buffer: this.meshletInfoBuffer },
            { binding: 2, buffer: this.visibleIdsBuffer },
            { binding: 3, buffer: this.visibleCountBuffer },
            { binding: 4, buffer: this.drawArgsBuffer },
            { binding: 5, textureView: this.hiZView },
            { binding: 6, sampler: this.hiZSampler },
        ], 'MeshletCullBindGroup');

        this.initialized = true;
    }

    setHiZTexture(texture) {
        this.hiZTexture = texture;
        this.hiZView = this.hiZTexture?.createView?.() ?? null;
        this.bindGroup = null;
    }

    uploadMeshlets(meshlets) {
        if (!this.initialized || !meshlets || meshlets.length === 0) return 0;

        const count = Math.min(meshlets.length, this.maxMeshlets);
        ensureMeshletCullCapacity(count);
        const data = _meshletCullData;  // Reuse dynamic buffer
        const view = new DataView(data.buffer);

        for (let i = 0; i < count; i++) {
            const m = meshlets[i];
            const o = i * 12;

            data[o + 0] = m.aabbMin[0];
            data[o + 1] = m.aabbMin[1];
            data[o + 2] = m.aabbMin[2];
            view.setUint32((o + 3) * 4, 0, true);

            data[o + 4] = m.aabbMax[0];
            data[o + 5] = m.aabbMax[1];
            data[o + 6] = m.aabbMax[2];
            view.setUint32((o + 7) * 4, m.firstFace >>> 0, true);

            view.setUint32((o + 8) * 4, m.faceCount >>> 0, true);
            view.setUint32((o + 9) * 4, (m.chunkKey ?? i) >>> 0, true);
            view.setUint32((o + 10) * 4, (m.materialGroup ?? 0) >>> 0, true);
            view.setUint32((o + 11) * 4, 0, true);
        }

        this.device.queue.writeBuffer(this.meshletInfoBuffer, 0, data);
        return count;
    }

    cull(commandEncoder, viewProj, cameraPos, screenWidth, screenHeight, meshletCount) {
        if (!this.initialized || meshletCount === 0) return null;

        const device = this.device;

        device.queue.writeBuffer(this.visibleCountBuffer, 0, this._visibleCountReset);

        const pf = this._paramsFloats;
        const pv = this._paramsView;

        for (let i = 0; i < 16; i++) pf[i] = viewProj[i];
        pf[16] = cameraPos[0];
        pf[17] = cameraPos[1];
        pf[18] = cameraPos[2];
        pf[19] = 0;

        const planes = this.extractFrustumPlanes(viewProj);
        for (let i = 0; i < 6; i++) {
            pf[20 + i * 4 + 0] = planes[i][0];
            pf[20 + i * 4 + 1] = planes[i][1];
            pf[20 + i * 4 + 2] = planes[i][2];
            pf[20 + i * 4 + 3] = planes[i][3];
        }

        pf[44] = screenWidth;
        pf[45] = screenHeight;
        pf[46] = 0.1;
        pf[47] = 1000;

        pf[48] = this.maxRenderDistance;
        pv.setUint32(49 * 4, this.enableOcclusionCulling ? 1 : 0, true);
        pv.setUint32(50 * 4, this.enableFrustumCulling ? 1 : 0, true);
        pv.setUint32(51 * 4, this.vertexCountPerInstance >>> 0, true);

        device.queue.writeBuffer(this.paramsBuffer, 0, this._params);

        if (!this.bindGroup) {
            if (!this.hiZView) this.hiZView = this.hiZTexture?.createView?.() ?? null;
            this.bindGroup = device.createBindGroup({
                layout: this.bindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: this.paramsBuffer } },
                    { binding: 1, resource: { buffer: this.meshletInfoBuffer } },
                    { binding: 2, resource: { buffer: this.visibleIdsBuffer } },
                    { binding: 3, resource: { buffer: this.visibleCountBuffer } },
                    { binding: 4, resource: { buffer: this.drawArgsBuffer } },
                    { binding: 5, resource: this.hiZView },
                    { binding: 6, resource: this.hiZSampler },
                ],
            });
        }

        const pass = commandEncoder.beginComputePass();
        pass.setPipeline(this.cullPipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.dispatchWorkgroups(Math.ceil(meshletCount / 64));

        pass.setPipeline(this.finalizePipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.dispatchWorkgroups(1);

        pass.end();

        return {
            visibleIdsBuffer: this.visibleIdsBuffer,
            visibleCountBuffer: this.visibleCountBuffer,
            drawArgsBuffer: this.drawArgsBuffer,
        };
    }

    extractFrustumPlanes(m) {
        const planes = [];
        planes.push(this.normalizePlane([m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]]));
        planes.push(this.normalizePlane([m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]]));
        planes.push(this.normalizePlane([m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]]));
        planes.push(this.normalizePlane([m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]]));
        planes.push(this.normalizePlane([m[2], m[6], m[10], m[14]]));
        planes.push(this.normalizePlane([m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]]));
        return planes;
    }

    normalizePlane(plane) {
        const len = Math.sqrt(plane[0] ** 2 + plane[1] ** 2 + plane[2] ** 2);
        if (len > 0) {
            return [plane[0] / len, plane[1] / len, plane[2] / len, plane[3] / len];
        }
        return plane;
    }

    destroy() {
        this.paramsBuffer?.destroy();
        this.meshletInfoBuffer?.destroy();
        this.visibleIdsBuffer?.destroy();
        this.visibleCountBuffer?.destroy();
        this.drawArgsBuffer?.destroy();
        this.hiZTexture?.destroy();
        this.initialized = false;
    }
}
