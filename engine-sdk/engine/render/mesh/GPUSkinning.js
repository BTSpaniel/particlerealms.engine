// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// ============================================================================
// GPUSkinning.js — Compute-shader skeletal skinning
//
// Moves vertex skinning from CPU to GPU. Per skinned mesh:
//   Static buffers (uploaded once):  bind-pose positions+normals+tangents, UVs,
//                                     joint indices, joint weights
//   Dynamic buffer (per frame):       skin matrices (jointCount × mat4x4)
//   Output:                           interleaved vertex buffer (pos3+norm3+uv2+tangent4)
//                                     with STORAGE|VERTEX usage so the existing
//                                     render pipeline reads it directly.
//
// The compute shader skins all vertices in parallel (workgroup_size=64).
// ============================================================================

import { createStorageBuffer, updateBuffer } from '../../core/gpu/GpuBuffer.js';

// ── WGSL Compute Shader ─────────────────────────────────────────────────────

const SKIN_COMPUTE_SHADER = /* wgsl */ `

struct Params {
    vertexCount: u32,
    jointCount:  u32,
};

@group(0) @binding(0) var<uniform>            params:       Params;
@group(0) @binding(1) var<storage, read>      bindPositions: array<f32>;   // vertexCount * 3
@group(0) @binding(2) var<storage, read>      bindNormals:   array<f32>;   // vertexCount * 3
@group(0) @binding(3) var<storage, read>      uvs:           array<f32>;   // vertexCount * 2
@group(0) @binding(4) var<storage, read>      jointIndices:  array<u32>;   // vertexCount * 4
@group(0) @binding(5) var<storage, read>      jointWeights:  array<f32>;   // vertexCount * 4
@group(0) @binding(6) var<storage, read>      skinMatrices:  array<f32>;   // jointCount * 16 (column-major mat4x4)
@group(0) @binding(7) var<storage, read_write> output:       array<f32>;   // vertexCount * 12 (pos3+norm3+uv2+tangent4)
@group(0) @binding(8) var<storage, read>      bindTangents:  array<f32>;   // vertexCount * 4

fn getMat4Col(jointIdx: u32, col: u32) -> vec4f {
    let base = jointIdx * 16u + col * 4u;
    return vec4f(
        skinMatrices[base],
        skinMatrices[base + 1u],
        skinMatrices[base + 2u],
        skinMatrices[base + 3u],
    );
}

fn skinTransformPos(jointIdx: u32, pos: vec3f) -> vec3f {
    let c0 = getMat4Col(jointIdx, 0u);
    let c1 = getMat4Col(jointIdx, 1u);
    let c2 = getMat4Col(jointIdx, 2u);
    let c3 = getMat4Col(jointIdx, 3u);
    return vec3f(
        dot(vec4f(pos, 1.0), vec4f(c0.x, c1.x, c2.x, c3.x)),
        dot(vec4f(pos, 1.0), vec4f(c0.y, c1.y, c2.y, c3.y)),
        dot(vec4f(pos, 1.0), vec4f(c0.z, c1.z, c2.z, c3.z)),
    );
}

fn skinTransformNorm(jointIdx: u32, n: vec3f) -> vec3f {
    let c0 = getMat4Col(jointIdx, 0u);
    let c1 = getMat4Col(jointIdx, 1u);
    let c2 = getMat4Col(jointIdx, 2u);
    return vec3f(
        dot(n, vec3f(c0.x, c1.x, c2.x)),
        dot(n, vec3f(c0.y, c1.y, c2.y)),
        dot(n, vec3f(c0.z, c1.z, c2.z)),
    );
}

fn normalizeOrFallback(value: vec3f, fallback: vec3f) -> vec3f {
    let lenSq = dot(value, value);
    if (lenSq > 0.00000001) {
        return value * inverseSqrt(lenSq);
    }
    return fallback;
}

fn fallbackTangentForNormal(normal: vec3f) -> vec3f {
    var axis = vec3f(1.0, 0.0, 0.0);
    if (abs(normal.x) >= 0.9) {
        axis = vec3f(0.0, 1.0, 0.0);
    }
    return normalizeOrFallback(axis - normal * dot(axis, normal), vec3f(1.0, 0.0, 0.0));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let v = gid.x;
    if (v >= params.vertexCount) { return; }

    let v3 = v * 3u;
    let v4 = v * 4u;
    let v2 = v * 2u;

    let pos  = vec3f(bindPositions[v3], bindPositions[v3 + 1u], bindPositions[v3 + 2u]);
    let norm = vec3f(bindNormals[v3],   bindNormals[v3 + 1u],   bindNormals[v3 + 2u]);
    let tangent = vec3f(bindTangents[v4], bindTangents[v4 + 1u], bindTangents[v4 + 2u]);
    let tangentSign = select(1.0, -1.0, bindTangents[v4 + 3u] < 0.0);

    let j0 = jointIndices[v4];
    let j1 = jointIndices[v4 + 1u];
    let j2 = jointIndices[v4 + 2u];
    let j3 = jointIndices[v4 + 3u];

    let w0 = jointWeights[v4];
    let w1 = jointWeights[v4 + 1u];
    let w2 = jointWeights[v4 + 2u];
    let w3 = jointWeights[v4 + 3u];

    let sp = w0 * skinTransformPos(j0, pos)
           + w1 * skinTransformPos(j1, pos)
           + w2 * skinTransformPos(j2, pos)
           + w3 * skinTransformPos(j3, pos);

    let sn = w0 * skinTransformNorm(j0, norm)
           + w1 * skinTransformNorm(j1, norm)
           + w2 * skinTransformNorm(j2, norm)
           + w3 * skinTransformNorm(j3, norm);

    let n = normalizeOrFallback(sn, vec3f(0.0, 1.0, 0.0));

    let st = w0 * skinTransformNorm(j0, tangent)
           + w1 * skinTransformNorm(j1, tangent)
           + w2 * skinTransformNorm(j2, tangent)
           + w3 * skinTransformNorm(j3, tangent);
    let t = normalizeOrFallback(st - n * dot(st, n), fallbackTangentForNormal(n));

    let o = v * 12u;
    output[o]      = sp.x;
    output[o + 1u] = sp.y;
    output[o + 2u] = sp.z;
    output[o + 3u] = n.x;
    output[o + 4u] = n.y;
    output[o + 5u] = n.z;
    output[o + 6u] = uvs[v2];
    output[o + 7u] = uvs[v2 + 1u];
    output[o + 8u] = t.x;
    output[o + 9u] = t.y;
    output[o + 10u] = t.z;
    output[o + 11u] = tangentSign;
}
`;

// ── GPUSkinning Manager ──────────────────────────────────────────────────────

export class GPUSkinning {
    /**
     * @param {import('../../core/gpu/VirtualGPU.js').VirtualGPU} vgpu
     */
    constructor(vgpu) {
        this.vgpu = vgpu;
        this.device = vgpu.device;
        this._meshes = new Map();   // meshKey -> GPUSkinMesh
        this._pipeline = null;
        this._bindGroupLayout = null;
        this._shaderModule = null;
        this._ready = false;
    }

    /** Lazy-init pipeline + shader (called once on first use) */
    _ensurePipeline() {
        if (this._ready) return;
        this._ready = true;

        this._shaderModule = this.vgpu.shader.compile('gpu_skinning', SKIN_COMPUTE_SHADER);

        this._bindGroupLayout = this.device.createBindGroupLayout({
            label: 'GPUSkinning.layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            ],
        });

        this._pipeline = this.vgpu.pipeline.compute({
            module: this._shaderModule,
            entryPoint: 'main',
            layout: this._bindGroupLayout,
            label: 'GPUSkinning.pipeline',
        });
    }

    /**
     * Register a skinned mesh for GPU skinning.
     * Uploads static buffers (bind-pose geometry, joint data) once.
     * Creates the output vertex buffer with STORAGE|VERTEX usage.
     *
     * @param {string} meshKey
     * @param {Object} instance - SkinnedMeshInstance from SkeletalAnimation
     * @param {Float32Array} [uvs] - UV data (vertexCount * 2), or null
     * @returns {GPUBuffer} outputVertexBuffer — use this as the mesh's vertexBuffer
     */
    register(meshKey, instance, uvs) {
        this._ensurePipeline();

        if (this._meshes.has(meshKey)) {
            return this._meshes.get(meshKey).outputBuffer;
        }

        const vc = instance.vertexCount;
        const jc = instance.jointCount;
        const device = this.device;

        // Static buffers (uploaded once, never change)
        const bindPosBuffer = createStorageBuffer(device, instance.bindPositions, {
            label: `skin.bindPos.${meshKey}`,
        });
        const bindNormBuffer = createStorageBuffer(device, instance.bindNormals, {
            label: `skin.bindNorm.${meshKey}`,
        });
        const bindTangentData = instance.bindTangents && instance.bindTangents.length >= vc * 4
            ? instance.bindTangents
            : new Float32Array(vc * 4);
        if (!instance.bindTangents || instance.bindTangents.length < vc * 4) {
            for (let i = 0; i < vc; i++) {
                bindTangentData[i * 4 + 3] = 1;
            }
        }
        const bindTangentBuffer = createStorageBuffer(device, bindTangentData, {
            label: `skin.bindTangent.${meshKey}`,
        });

        // UVs — convert to Float32Array (EntityMeshRenderer stores as plain array)
        const uvData = uvs ? (uvs instanceof Float32Array ? uvs : new Float32Array(uvs)) : new Float32Array(vc * 2);
        const uvBuffer = createStorageBuffer(device, uvData, {
            label: `skin.uvs.${meshKey}`,
        });

        // Joint indices: Uint16Array → need Uint32Array for WGSL array<u32>
        const ji32 = new Uint32Array(instance.jointIndices);
        const jointIdxBuffer = createStorageBuffer(device, ji32, {
            label: `skin.jointIdx.${meshKey}`,
        });
        const jointWtBuffer = createStorageBuffer(device, instance.jointWeights, {
            label: `skin.jointWt.${meshKey}`,
        });

        // Dynamic buffer: skin matrices (updated per frame)
        const matricesSize = jc * 16 * 4; // jc mat4x4 × 4 bytes per float
        const matricesBuffer = createStorageBuffer(device, matricesSize, {
            label: `skin.matrices.${meshKey}`,
        });

        // Params uniform
        const paramsData = new Uint32Array([vc, jc]);
        const paramsBuffer = device.createBuffer({
            size: 16, // align to 16 for uniform
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: `skin.params.${meshKey}`,
            mappedAtCreation: true,
        });
        new Uint32Array(paramsBuffer.getMappedRange()).set(paramsData);
        paramsBuffer.unmap();

        // Output vertex buffer: STORAGE (compute write) + VERTEX (render read) + COPY_DST
        const outputSize = vc * 12 * 4; // 12 floats per vertex × 4 bytes
        const outputBuffer = device.createBuffer({
            size: outputSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            label: `skin.output.${meshKey}`,
        });

        // Bind group
        const bindGroup = device.createBindGroup({
            layout: this._bindGroupLayout,
            label: `skin.bindGroup.${meshKey}`,
            entries: [
                { binding: 0, resource: { buffer: paramsBuffer } },
                { binding: 1, resource: { buffer: bindPosBuffer } },
                { binding: 2, resource: { buffer: bindNormBuffer } },
                { binding: 3, resource: { buffer: uvBuffer } },
                { binding: 4, resource: { buffer: jointIdxBuffer } },
                { binding: 5, resource: { buffer: jointWtBuffer } },
                { binding: 6, resource: { buffer: matricesBuffer } },
                { binding: 7, resource: { buffer: outputBuffer } },
                { binding: 8, resource: { buffer: bindTangentBuffer } },
            ],
        });

        const entry = {
            vertexCount: vc,
            jointCount: jc,
            matricesBuffer,
            outputBuffer,
            bindGroup,
            // Keep refs for cleanup
            _buffers: [paramsBuffer, bindPosBuffer, bindNormBuffer, bindTangentBuffer, uvBuffer, jointIdxBuffer, jointWtBuffer, matricesBuffer, outputBuffer],
        };

        this._meshes.set(meshKey, entry);
        console.log(`[GPUSkinning] Registered: ${meshKey} (${vc} verts, ${jc} joints)`);
        return outputBuffer;
    }

    /**
     * Upload skin matrices and dispatch the compute shader for one mesh.
     * Call once per frame per dirty skinned mesh, BEFORE rendering.
     *
     * @param {string} meshKey
     * @param {Float32Array} skinMatrices - jointCount * 16 column-major floats
     * @param {GPUCommandEncoder} encoder - the frame's command encoder
     */
    dispatch(meshKey, skinMatrices, encoder) {
        const entry = this._meshes.get(meshKey);
        if (!entry) return;

        // Upload skin matrices
        this.device.queue.writeBuffer(entry.matricesBuffer, 0, skinMatrices);

        // Dispatch compute
        const workgroups = Math.ceil(entry.vertexCount / 64);
        const pass = encoder.beginComputePass({ label: `skin.compute.${meshKey}` });
        pass.setPipeline(this._pipeline);
        pass.setBindGroup(0, entry.bindGroup);
        pass.dispatchWorkgroups(workgroups);
        pass.end();
    }

    /**
     * Check if a mesh is registered for GPU skinning.
     */
    has(meshKey) {
        return this._meshes.has(meshKey);
    }

    /**
     * Get the output vertex buffer for a registered mesh.
     */
    getOutputBuffer(meshKey) {
        return this._meshes.get(meshKey)?.outputBuffer || null;
    }

    /**
     * Unregister a mesh and destroy its GPU resources.
     */
    unregister(meshKey) {
        const entry = this._meshes.get(meshKey);
        if (!entry) return;
        for (const buf of entry._buffers) {
            if (buf && !buf.destroyed) buf.destroy();
        }
        this._meshes.delete(meshKey);
    }

    /**
     * Destroy all resources.
     */
    destroy() {
        for (const key of this._meshes.keys()) {
            this.unregister(key);
        }
    }
}
