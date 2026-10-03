// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ProxyGBufferPass — Rasterize Proxy AABB Cubes into the GBuffer ID Texture
 *
 * Renders invisible proxy bounding boxes (one per instance) to stamp a
 * 1-indexed proxy instance ID into a r32uint GBuffer attachment.
 * The depth buffer ensures correct occlusion against scene geometry.
 *
 * The r32uint texture is then read by ProxyMaskPass, which fires per-pixel
 * rays only for pixels where instanceId > 0.
 *
 * Pipeline:
 *   Proxy cube geometry (GPU instanced)
 *     → vertex: transform by instance worldMat
 *     → fragment: write flat instanceId to r32uint attachment
 *     → depth: standard scene depth (proxy boxes occluded correctly)
 *
 * The proxy cubes are invisible in the color attachment — they only tag
 * the ID texture. ProxyShadePass writes final color to the HDR buffer.
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

// ============================================================================
// UNIT CUBE GEOMETRY (one cube per proxy, scaled by worldMat)
// ============================================================================

// 8 vertices of a unit cube [-1, +1]^3
// Layout: [x, y, z] per vertex — 24 bytes per vertex (padded to 12)
const CUBE_POSITIONS = new Float32Array([
    // front
    -1, -1,  1,   1, -1,  1,   1,  1,  1,  -1,  1,  1,
    // back
    -1, -1, -1,  -1,  1, -1,   1,  1, -1,   1, -1, -1,
    // top
    -1,  1, -1,  -1,  1,  1,   1,  1,  1,   1,  1, -1,
    // bottom
    -1, -1, -1,   1, -1, -1,   1, -1,  1,  -1, -1,  1,
    // right
     1, -1, -1,   1,  1, -1,   1,  1,  1,   1, -1,  1,
    // left
    -1, -1, -1,  -1, -1,  1,  -1,  1,  1,  -1,  1, -1,
]);

const CUBE_INDICES = new Uint16Array([
    0,1,2, 0,2,3,        // front
    4,5,6, 4,6,7,        // back
    8,9,10, 8,10,11,     // top
    12,13,14, 12,14,15,  // bottom
    16,17,18, 16,18,19,  // right
    20,21,22, 20,22,23,  // left
]);

// ============================================================================
// WGSL Shader
// ============================================================================

const PROXY_GBUFFER_WGSL = /* wgsl */`

struct FrameUniforms {
    viewProj : mat4x4<f32>,
    _pad     : vec4<f32>,
}

struct ProxyInstance {
    worldMat      : mat4x4<f32>,
    targetAssetId : u32,
    proxyMode     : u32,
    halfExtentsX  : f32,
    halfExtentsY  : f32,
    halfExtentsZ  : f32,
    _pad0         : u32,
    _pad1         : u32,
    _pad2         : u32,
}

@group(0) @binding(0) var<uniform>        frame     : FrameUniforms;
@group(0) @binding(1) var<storage, read>  instances : array<ProxyInstance>;

struct VertexOutput {
    @builtin(position)               clipPos    : vec4<f32>,
    @location(0) @interpolate(flat)  instanceId : u32,
}

@vertex
fn vsMain(
    @location(0)                      position   : vec3<f32>,
    @builtin(instance_index)          instIdx    : u32,
) -> VertexOutput {
    let inst = instances[instIdx];

    // Scale unit cube by half-extents, then apply world transform
    let localPos = position * vec3<f32>(inst.halfExtentsX, inst.halfExtentsY, inst.halfExtentsZ);
    let worldPos = inst.worldMat * vec4<f32>(localPos, 1.0);

    var out : VertexOutput;
    out.clipPos    = frame.viewProj * worldPos;
    out.instanceId = instIdx + 1u;   // 1-indexed (0 = no proxy)
    return out;
}

struct FragOutput {
    @location(0) proxyId : u32,
}

@fragment
fn fsMain(in : VertexOutput) -> FragOutput {
    var out : FragOutput;
    out.proxyId = in.instanceId;
    return out;
}
`;

// ============================================================================
// ProxyGBufferPass
// ============================================================================

const FRAME_FLOATS = 20; // mat4(16) + vec4 pad(4)

export class ProxyGBufferPass {
    /**
     * @param {GPUDevice} device
     * @param {string}    depthFormat   — match scene depth format (e.g. 'depth24plus')
     * @param {number}    width
     * @param {number}    height
     */
    constructor(device, depthFormat = 'depth24plus', width = 1, height = 1) {
        this.vgpu        = initVGPU(device);
        this.device      = device;
        this.depthFormat = depthFormat;
        this.width       = width;
        this.height      = height;

        this._cubeVB       = null;
        this._cubeIB       = null;
        this._frameUBO     = null;
        this._frameData    = new Float32Array(FRAME_FLOATS);
        this._pipeline     = null;

        // Proxy ID texture — r32uint, read by ProxyMaskPass
        this._proxyIdTex   = null;

        this._initGeometry();
        this._initTexture(width, height);
        this._initPipeline();
        this._initFrameUBO();
    }

    // -------------------------------------------------------------------------

    _initGeometry() {
        this._cubeVB = this.device.createBuffer({
            size  : CUBE_POSITIONS.byteLength,
            usage : GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            label : 'ProxyCubeVB',
        });
        this.device.queue.writeBuffer(this._cubeVB, 0, CUBE_POSITIONS);

        this._cubeIB = this.device.createBuffer({
            size  : CUBE_INDICES.byteLength,
            usage : GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
            label : 'ProxyCubeIB',
        });
        this.device.queue.writeBuffer(this._cubeIB, 0, CUBE_INDICES);
    }

    _initTexture(width, height) {
        if (this._proxyIdTex) this._proxyIdTex.destroy();
        this._proxyIdTex = this.device.createTexture({
            size  : [width, height, 1],
            format: 'r32uint',
            usage : GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            label : 'ProxyGBufferID',
        });
    }

    _initPipeline() {
        const shader = this.vgpu.shader.compile('ProxyGBuffer', PROXY_GBUFFER_WGSL);

        this._pipeline = this.device.createRenderPipeline({
            label : 'ProxyGBufferPipeline',
            layout: 'auto',
            vertex: {
                module    : shader,
                entryPoint: 'vsMain',
                buffers   : [{
                    arrayStride: 12,  // 3 × f32
                    attributes : [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
                }],
            },
            fragment: {
                module    : shader,
                entryPoint: 'fsMain',
                targets   : [{ format: 'r32uint' }],
            },
            primitive: {
                topology  : 'triangle-list',
                cullMode  : 'back',
            },
            depthStencil: {
                format           : this.depthFormat,
                depthWriteEnabled: false,   // read scene depth; don't overwrite it
                depthCompare     : 'less-equal',
            },
        });
    }

    _initFrameUBO() {
        this._frameUBO = this.device.createBuffer({
            size  : FRAME_FLOATS * 4,
            usage : GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label : 'ProxyGBufferFrame',
        });
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Render proxy cubes and stamp proxy instance IDs into the GBuffer ID texture.
     *
     * @param {GPUCommandEncoder} encoder
     * @param {GPUBuffer}         instanceBuffer   — ProxyGeometrySystem instance buffer
     * @param {number}            instanceCount    — number of active proxy instances
     * @param {Float32Array}      viewProj         — 16-float column-major VP matrix
     * @param {GPUTextureView}    sceneDepthView   — existing scene depth view (read-only)
     */
    execute(encoder, instanceBuffer, instanceCount, viewProj, sceneDepthView) {
        if (instanceCount === 0) return;

        // Upload view-projection
        this._frameData.set(viewProj, 0);
        this.device.queue.writeBuffer(this._frameUBO, 0, this._frameData);

        // Build bind group (recreate each frame — cheap for uniform + storage)
        const bg = this.device.createBindGroup({
            layout: this._pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this._frameUBO   } },
                { binding: 1, resource: { buffer: instanceBuffer   } },
            ],
        });

        const pass = encoder.beginRenderPass({
            label            : 'ProxyGBufferPass',
            colorAttachments : [{
                view     : this._proxyIdTex.createView(),
                loadOp   : 'clear',
                clearValue: [0, 0, 0, 0],   // 0 = no proxy
                storeOp  : 'store',
            }],
            depthStencilAttachment: {
                view              : sceneDepthView,
                depthLoadOp       : 'load',   // read existing scene depth
                depthStoreOp      : 'discard',// don't write depth back
                depthReadOnly     : true,
            },
        });

        pass.setPipeline(this._pipeline);
        pass.setBindGroup(0, bg);
        pass.setVertexBuffer(0, this._cubeVB);
        pass.setIndexBuffer(this._cubeIB, 'uint16');
        // One cube (36 indices) per proxy instance via GPU instancing
        pass.drawIndexed(CUBE_INDICES.length, instanceCount, 0, 0, 0);
        pass.end();
    }

    /** Returns the proxy ID texture for binding in ProxyMaskPass. */
    getProxyIdTexture() { return this._proxyIdTex; }

    resize(width, height) {
        this.width  = width;
        this.height = height;
        this._initTexture(width, height);
    }

    destroy() {
        this._cubeVB?.destroy();
        this._cubeIB?.destroy();
        this._frameUBO?.destroy();
        this._proxyIdTex?.destroy();
    }
}
