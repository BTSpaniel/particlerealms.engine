// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * GroundShadowPass.js - Analytical Blob Shadows on Ground Plane
 *
 * Projects entity shadow casters onto the y=0 ground plane along the sun
 * direction and renders soft circular shadows. This is the standard technique
 * used by mobile games (Minecraft, Animal Crossing) and many 3D editors.
 *
 * Advantages over screen-space ray marching:
 *   - No depth buffer artifacts (banding, streaking)
 *   - Works from any camera angle
 *   - Smooth, soft shadow edges with no aliasing
 *   - Very fast (one distance check per caster per pixel)
 *
 * Shadow casters are passed via a storage buffer (position + radius per entity).
 * Output: Alpha-blended darkening composited over the scene.
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import { getFloat32ArraySize } from '../../core/gpu/WGSLStructSize.js';

const MAX_CASTERS = 128;

const GROUND_SHADOW_PARAMS_STRUCT = `struct Params {
    invViewProj:     mat4x4<f32>,
    sunDir:          vec3<f32>,
    shadowIntensity: f32,
    cameraPos:       vec3<f32>,
    numCasters:      f32,
}`;
const _uniformData = new Float32Array(getFloat32ArraySize(GROUND_SHADOW_PARAMS_STRUCT));

const GROUND_SHADOW_SHADER = /* wgsl */ `
${GROUND_SHADOW_PARAMS_STRUCT}

struct ShadowCaster {
    posRadius: vec4<f32>,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> casters: array<ShadowCaster>;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) nearPoint: vec3<f32>,
    @location(2) farPoint: vec3<f32>,
}

fn unproject(ndc: vec3<f32>) -> vec3<f32> {
    let p = params.invViewProj * vec4<f32>(ndc, 1.0);
    return p.xyz / p.w;
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VertexOutput {
    var out: VertexOutput;
    // Fullscreen quad (4 vertices, triangle-strip) — matches grid shader
    let x = f32((vi & 1u) << 1u) - 1.0;
    let y = f32(vi & 2u) - 1.0;
    out.position = vec4<f32>(x, y, 0.0, 1.0);
    out.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
    out.nearPoint = unproject(vec3<f32>(x, y, 0.0));
    out.farPoint  = unproject(vec3<f32>(x, y, 1.0));
    return out;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // Find y=0 ground intersection
    let ray = input.farPoint - input.nearPoint;
    let t = -input.nearPoint.y / ray.y;
    if (t < 0.0) { discard; }

    let groundPos = input.nearPoint + ray * t;

    // Distance fade
    let distFromCamera = length(groundPos - params.cameraPos);
    if (distFromCamera > 100.0) { discard; }
    let distFade = 1.0 - smoothstep(60.0, 100.0, distFromCamera);

    // Sun direction (toward the sun)
    let toSun = normalize(-params.sunDir);
    if (toSun.y < 0.01) { discard; }

    let numCasters = u32(params.numCasters);
    if (numCasters == 0u) { discard; }

    var shadow = 0.0;

    for (var i = 0u; i < numCasters; i = i + 1u) {
        let casterPos = casters[i].posRadius.xyz;
        let casterRadius = casters[i].posRadius.w;

        // Skip casters well below ground
        if (casterPos.y < -0.1) { continue; }

        // Project caster center onto y=0 along sun direction
        // Sun ray goes from caster toward ground: casterPos - toSun * (casterPos.y / toSun.y)
        let projDist = casterPos.y / toSun.y;
        let shadowCenter = vec2<f32>(
            casterPos.x - toSun.x * projDist,
            casterPos.z - toSun.z * projDist
        );

        // 2D distance from ground pixel to shadow center
        let offset = vec2<f32>(groundPos.x - shadowCenter.x, groundPos.z - shadowCenter.y);
        let dist2D = length(offset);

        // Shadow radius: entity radius + penumbra spread with height
        let penumbraSpread = 1.0 + casterPos.y * 0.06;
        let shadowRadius = casterRadius * penumbraSpread;

        // Soft circular falloff (inner core is darker, edges fade)
        let falloff = 1.0 - smoothstep(shadowRadius * 0.2, shadowRadius, dist2D);

        // Higher objects → softer, lighter shadows (simulates penumbra)
        let heightAtten = 1.0 / (1.0 + casterPos.y * 0.1);

        // Accumulate (max blend — overlapping shadows don't over-darken)
        shadow = max(shadow, falloff * heightAtten);
    }

    if (shadow < 0.01) { discard; }

    shadow = clamp(shadow * params.shadowIntensity * distFade, 0.0, 0.85);

    return vec4<f32>(0.0, 0.0, 0.0, shadow);
}
`;

export class GroundShadowPass {
    constructor() {
        this.device = null;
        this.vgpu = null;
        this.pipeline = null;
        this.uniformBuffer = null;
        this.casterBuffer = null;
        this.bindGroupLayout = null;
        this._bindGroup = null;

        // Tunables
        this.shadowIntensity = 0.8;

        // CPU-side caster data: [x, y, z, radius, x, y, z, radius, ...]
        this._casterData = new Float32Array(MAX_CASTERS * 4);
        this._casterCount = 0;

        this.initialized = false;
        this.enabled = true;
        this._failCount = 0;
        this._retryAfter = 0;
        this._maxFails = 5;
        this._retryCooldownMs = 3000;
    }

    init(device, format = 'bgra8unorm') {
        try {
            this.device = device;
            this._format = format;
            this.vgpu = initVGPU(device);

            const shaderModule = this.vgpu.shader.compile('groundShadowBlob', GROUND_SHADOW_SHADER);

            this.uniformBuffer = this.vgpu.buffer.create({
                size: _uniformData.byteLength,
                usage: 'uniform',
                label: 'GroundShadowParams'
            }).buffer;

            // Storage buffer for shadow casters (128 * vec4 = 2048 bytes)
            this.casterBuffer = device.createBuffer({
                size: MAX_CASTERS * 16,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
                label: 'GroundShadowCasters',
            });

            this.bindGroupLayout = this.vgpu.bindings.defineLayout('groundShadowBlob', [
                { binding: 0, type: 'uniform', visibility: 'vertex|fragment' },
                { binding: 1, type: 'read-storage', visibility: 'fragment' },
            ]);

            this._bindGroup = this.vgpu.bindings.createGroup(this.bindGroupLayout, [
                { binding: 0, buffer: this.uniformBuffer },
                { binding: 1, buffer: this.casterBuffer },
            ]);

            this.pipeline = this.vgpu.pipeline.render({
                vertex:   { module: shaderModule, entryPoint: 'vs_main' },
                fragment: { module: shaderModule, entryPoint: 'fs_main' },
                layouts: [this.bindGroupLayout],
                colorFormat: format,
                blend: 'alpha',
                topology: 'triangle-strip',
                depthFormat: null,
                label: 'GroundShadowPipeline'
            });

            this.initialized = true;
            this._failCount = 0;
        } catch (e) {
            console.warn('[GroundShadowPass] init failed, will retry:', e.message);
            this.initialized = false;
            this._failCount++;
            this._retryAfter = performance.now() + this._retryCooldownMs;
        }
    }

    /** Call once per frame before render() — resets the caster list */
    beginFrame() {
        this._casterCount = 0;
    }

    /**
     * Add a shadow caster (call during entity iteration)
     * @param {number} x - world X
     * @param {number} y - world Y
     * @param {number} z - world Z
     * @param {number} radius - bounding sphere radius
     */
    addCaster(x, y, z, radius) {
        if (this._casterCount >= MAX_CASTERS) return;
        const off = this._casterCount * 4;
        this._casterData[off]     = x;
        this._casterData[off + 1] = y;
        this._casterData[off + 2] = z;
        this._casterData[off + 3] = radius;
        this._casterCount++;
    }

    /**
     * @param {GPUCommandEncoder} encoder
     * @param {GPUTextureView}    outputView  - Swapchain texture view
     * @param {Float32Array}      invViewProj - 16-float inverse VP matrix
     * @param {number[]}          sunDir      - [x,y,z] sun direction
     * @param {number[]}          cameraPos   - [x,y,z] camera world position
     */
    render(encoder, outputView, invViewProj, sunDir, cameraPos) {
        if (!this.enabled) return;
        if (this._casterCount === 0) return;
        if (!this.initialized) {
            if (this._failCount >= this._maxFails) return;
            if (performance.now() < this._retryAfter) return;
            this.init(this.device, this._format);
            if (!this.initialized) return;
        }
        try {
            // Upload uniforms
            _uniformData.set(invViewProj, 0);
            _uniformData[16] = sunDir[0];
            _uniformData[17] = sunDir[1];
            _uniformData[18] = sunDir[2];
            _uniformData[19] = this.shadowIntensity;
            _uniformData[20] = cameraPos[0];
            _uniformData[21] = cameraPos[1];
            _uniformData[22] = cameraPos[2];
            _uniformData[23] = this._casterCount;
            this.device.queue.writeBuffer(this.uniformBuffer, 0, _uniformData);

            // Upload caster data
            this.device.queue.writeBuffer(
                this.casterBuffer, 0,
                this._casterData, 0,
                this._casterCount * 4
            );

            const pass = encoder.beginRenderPass({
                colorAttachments: [{
                    view: outputView,
                    loadOp: 'load',
                    storeOp: 'store',
                }],
            });
            pass.setPipeline(this.pipeline);
            pass.setBindGroup(0, this._bindGroup);
            pass.draw(4);
            pass.end();
        } catch (e) {
            console.warn('[GroundShadowPass] render failed:', e.message);
            this._failCount++;
            this._retryAfter = performance.now() + this._retryCooldownMs;
            this.initialized = false;
        }
    }

    resize() {
        // Bind group is stable (uniform + storage buffers don't change on resize)
    }

    destroy() {
        if (this.uniformBuffer) this.uniformBuffer.destroy();
        if (this.casterBuffer) this.casterBuffer.destroy();
        this.initialized = false;
    }
}
