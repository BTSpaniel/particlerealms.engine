// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * TonemapPass.js - Final Post-Processing Pass
 * 
 * Applied as the very last pass after bloom. Provides:
 *   1. ACES filmic tonemapping (HDR → LDR, matches playground SDF demo)
 *   2. Vignette (darkened edges for cinematic look)
 *   3. Distance fog (blend toward sky color at far range)
 * 
 * Uses a single fullscreen triangle — no vertex buffer, no index buffer.
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

const _uniformData = new Float32Array(8);

const TONEMAP_SHADER = /* wgsl */ `
struct Params {
    vignetteStrength: f32,
    vignetteRadius: f32,
    exposure: f32,
    fogDensity: f32,
    fogColor: vec3<f32>,
    _pad: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var sceneTex: texture_2d<f32>;
@group(0) @binding(2) var sceneSampler: sampler;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VertexOutput {
    var out: VertexOutput;
    let x = f32((vi & 1u) << 2u) - 1.0;
    let y = f32((vi & 2u) << 1u) - 1.0;
    out.position = vec4<f32>(x, y, 0.0, 1.0);
    out.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
    return out;
}

// ACES filmic tonemapping (same curve as playground SDF demo)
fn aces(x: vec3<f32>) -> vec3<f32> {
    return (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    var color = textureSample(sceneTex, sceneSampler, input.uv).rgb;

    // Scene renders to bgra8unorm (not HDR) — colors are already display-ready.
    // No tonemapping or gamma correction here. Only vignette darkening is safe.

    // Vignette — darken edges for cinematic framing
    let center = input.uv - vec2<f32>(0.5);
    let dist = length(center);
    let vig = 1.0 - smoothstep(params.vignetteRadius, params.vignetteRadius + 0.45, dist) * params.vignetteStrength;
    color *= vig;

    return vec4<f32>(color, 1.0);
}
`;

export class TonemapPass {
    constructor() {
        this.device = null;
        this.vgpu = null;
        this.pipeline = null;
        this.uniformBuffer = null;
        this.sampler = null;
        this.bindGroupLayout = null;
        this._cachedBindGroup = null;
        this._cachedSourceView = null;

        // Tunables
        this.exposure = 1.0;
        this.vignetteStrength = 0.45;
        this.vignetteRadius = 0.65;
        this.fogDensity = 0.0;
        this.fogColor = [0.12, 0.13, 0.18];

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
            this.vgpu = initVGPU(device);

            const shaderModule = this.vgpu.shader.compile('tonemap', TONEMAP_SHADER);

            this.uniformBuffer = this.vgpu.buffer.create({
                size: _uniformData.byteLength,
                usage: 'uniform',
                label: 'TonemapParams'
            }).buffer;

            this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

            this.bindGroupLayout = this.vgpu.bindings.defineLayout('tonemap', [
                { binding: 0, type: 'uniform', visibility: 'fragment' },
                { binding: 1, type: 'texture', visibility: 'fragment' },
                { binding: 2, type: 'sampler', visibility: 'fragment' },
            ]);

            this.pipeline = this.vgpu.pipeline.render({
                vertex: { module: shaderModule, entryPoint: 'vs_main' },
                fragment: { module: shaderModule, entryPoint: 'fs_main' },
                layouts: [this.bindGroupLayout],
                colorFormat: format,
                blend: 'opaque',
                topology: 'triangle-list',
                depthFormat: null,
                label: 'TonemapPipeline'
            });

            this.initialized = true;
            this._format = format;
            this._failCount = 0;
        } catch (e) {
            console.warn('[TonemapPass] init failed, will retry:', e.message);
            this.initialized = false;
            this._failCount++;
            this._retryAfter = performance.now() + this._retryCooldownMs;
        }
    }

    /**
     * Render tonemapping pass.
     * @param {GPUCommandEncoder} encoder
     * @param {GPUTexture} sourceTexture - Sampleable copy of the scene
     * @param {GPUTextureView} outputView - Swapchain texture view to render into
     */
    render(encoder, sourceTexture, outputView) {
        if (!this.enabled) return;
        if (!this.initialized) {
            if (this._failCount >= this._maxFails) return;
            if (performance.now() < this._retryAfter) return;
            this.init(this.device, this._format);
            if (!this.initialized) return;
        }
        try {
            _uniformData[0] = this.vignetteStrength;
            _uniformData[1] = this.vignetteRadius;
            _uniformData[2] = this.exposure;
            _uniformData[3] = this.fogDensity;
            _uniformData[4] = this.fogColor[0];
            _uniformData[5] = this.fogColor[1];
            _uniformData[6] = this.fogColor[2];
            _uniformData[7] = 0;
            this.device.queue.writeBuffer(this.uniformBuffer, 0, _uniformData);

            const sourceView = sourceTexture.createView();
            if (this._cachedSourceView !== sourceTexture) {
                this._cachedBindGroup = this.vgpu.bindings.createGroup(this.bindGroupLayout, [
                    { binding: 0, buffer: this.uniformBuffer },
                    { binding: 1, textureView: sourceView },
                    { binding: 2, sampler: this.sampler },
                ]);
                this._cachedSourceView = sourceTexture;
            }

            const pass = encoder.beginRenderPass({
                colorAttachments: [{
                    view: outputView,
                    loadOp: 'load',
                    storeOp: 'store',
                }],
            });
            pass.setPipeline(this.pipeline);
            pass.setBindGroup(0, this._cachedBindGroup);
            pass.draw(3);
            pass.end();
        } catch (e) {
            console.warn('[TonemapPass] render failed:', e.message);
            this._failCount++;
            this._retryAfter = performance.now() + this._retryCooldownMs;
            this.initialized = false;
        }
    }

    resize() {
        // No size-dependent textures — bind group is rebuilt per-frame if source changes
        this._cachedSourceView = null;
        this._cachedBindGroup = null;
    }

    destroy() {
        if (this.uniformBuffer) this.uniformBuffer.destroy();
        this.initialized = false;
    }
}
