// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ProxyBillboardAlign — GPU Compute Pass for Billboard Instance Rotation
 *
 * Aligns BILLBOARD-mode proxy instances to face the camera each frame.
 * Equivalent to Blender's "Track To" constraint + "Align Euler to Vector"
 * in Geometry Nodes.
 *
 * Input:  instance buffer (read-write) containing worldMat per instance
 * Output: updated rotation portion of worldMat in-place
 *
 * Only processes instances where proxyMode == PROXY_MODE_BILLBOARD (1u).
 * BOX proxies are skipped (their orientation is set by the developer).
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

const PROXY_MODE_BILLBOARD = 1;

// ============================================================================
// WGSL Compute Shader
// ============================================================================

const BILLBOARD_ALIGN_WGSL = /* wgsl */`

struct ProxyInstance {
    worldMat   : mat4x4<f32>,   // 64 bytes — offset 0
    targetAssetId : u32,        // offset 64
    proxyMode     : u32,        // offset 68  (0=BOX, 1=BILLBOARD)
    halfExtentsX  : f32,        // offset 72
    halfExtentsY  : f32,        // offset 76
    halfExtentsZ  : f32,        // offset 80
    _pad0         : u32,        // offset 84
    _pad1         : u32,        // offset 88
    _pad2         : u32,        // offset 92  — total 96 bytes
}

struct BillboardParams {
    cameraPos    : vec3<f32>,
    instanceCount: u32,
    worldUp      : vec3<f32>,
    _pad         : f32,
}

@group(0) @binding(0) var<storage, read_write> instances : array<ProxyInstance>;
@group(0) @binding(1) var<uniform>             params    : BillboardParams;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let idx = gid.x;
    if (idx >= params.instanceCount) { return; }

    let inst = instances[idx];
    if (inst.proxyMode != 1u) { return; } // skip BOX proxies

    // Extract current world position from last column of worldMat
    let pos = inst.worldMat[3].xyz;

    // Build a rotation matrix aligning Z-axis (forward) toward camera
    let forward = normalize(params.cameraPos - pos);
    let right   = normalize(cross(params.worldUp, forward));
    let up      = cross(forward, right);

    // Reconstruct worldMat with new rotation, preserving position and scale
    // Scale factors extracted from current matrix columns
    let scaleX = length(inst.worldMat[0].xyz);
    let scaleY = length(inst.worldMat[1].xyz);
    let scaleZ = length(inst.worldMat[2].xyz);

    instances[idx].worldMat = mat4x4<f32>(
        vec4<f32>(right   * scaleX, 0.0),
        vec4<f32>(up      * scaleY, 0.0),
        vec4<f32>(forward * scaleZ, 0.0),
        vec4<f32>(pos,              1.0),
    );
}
`;

// ============================================================================
// ProxyBillboardAlign
// ============================================================================

const BILLBOARD_PARAMS_FLOATS = 8; // vec3 cameraPos + u32 count + vec3 worldUp + f32 pad

export class ProxyBillboardAlign {
    /**
     * @param {GPUDevice} device
     * @param {GPUBuffer} instanceBuffer  — the shared proxy instance storage buffer
     */
    constructor(device, instanceBuffer) {
        this.vgpu           = initVGPU(device);
        this.device         = device;
        this.instanceBuffer = instanceBuffer;

        this.paramsBuffer   = null;
        this.pipeline       = null;
        this.bindGroup      = null;

        this._paramsData = new Float32Array(BILLBOARD_PARAMS_FLOATS);
        this._paramsU32  = new Uint32Array(this._paramsData.buffer);

        this._init();
    }

    _init() {
        this.paramsBuffer = this.vgpu.buffer.create({
            size : BILLBOARD_PARAMS_FLOATS * 4,
            usage: 'uniform',
            label: 'BillboardAlignParams',
        }).buffer;

        const shader = this.vgpu.shader.compile('billboardAlign', BILLBOARD_ALIGN_WGSL);
        this.pipeline = this.vgpu.pipeline.compute({
            module    : shader,
            entryPoint: 'main',
            label     : 'BillboardAlignPipeline',
        });
    }

    _rebuildBindGroup() {
        this.bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.instanceBuffer } },
                { binding: 1, resource: { buffer: this.paramsBuffer   } },
            ],
            label: 'BillboardAlignBindGroup',
        });
    }

    /**
     * Execute the billboard alignment compute pass.
     * @param {GPUCommandEncoder} encoder
     * @param {number[]}          cameraPos       [x, y, z] world position
     * @param {number}            instanceCount   total number of proxy instances
     */
    execute(encoder, cameraPos, instanceCount) {
        if (instanceCount === 0) return;

        // Upload params
        this._paramsData[0] = cameraPos[0];
        this._paramsData[1] = cameraPos[1];
        this._paramsData[2] = cameraPos[2];
        this._paramsU32[3]  = instanceCount;
        this._paramsData[4] = 0.0;  // worldUp x
        this._paramsData[5] = 1.0;  // worldUp y
        this._paramsData[6] = 0.0;  // worldUp z
        this._paramsData[7] = 0.0;  // pad
        this.device.queue.writeBuffer(this.paramsBuffer, 0, this._paramsData);

        this._rebuildBindGroup();

        const pass = encoder.beginComputePass({ label: 'BillboardAlign' });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bindGroup);
        pass.dispatchWorkgroups(Math.ceil(instanceCount / 64));
        pass.end();
    }

    destroy() {
        if (this.paramsBuffer) this.paramsBuffer.destroy();
    }
}
