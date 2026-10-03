// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ShadowMapPass.js - Real Geometry Shadow Maps
 *
 * Renders entity depth from the sun's perspective into a shadow map texture,
 * then composites geometry-accurate shadows onto the scene as a fullscreen pass.
 *
 * Architecture:
 *   1. Shadow depth pass: EntityMeshRenderer.flushShadowDepth() draws all
 *      instanced entities into a depth32float texture from the light's orthographic
 *      projection. This runs AFTER the main flush() so the GPU instance buffer
 *      already contains this frame's data.
 *   2. Composite pass: A fullscreen triangle reads the scene depth buffer,
 *      reconstructs world positions, projects them into light space, and samples
 *      the shadow map with PCF 3×3 filtering. Output is alpha-blended darkening.
 *
 * The light matrix is computed per-frame from the sun direction and a bounding
 * sphere that encompasses all shadow casters (not the camera frustum), so
 * off-screen entities still cast shadows into the visible area.
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import { calcWGSLStructSize, getFloat32ArraySize } from '../../core/gpu/WGSLStructSize.js';
import { assertCheckedShaderModule } from '../../core/gpu/GpuShaderDiagnostics.js';
import { withErrorScope } from '../../core/gpu/GpuDebug.js';

const SHADOW_MAP_SIZE = 2048;

// Shared struct definition — used for both the shader and auto-size computation
const SHADOW_PARAMS_STRUCT = `struct ShadowParams {
    invViewProj:     mat4x4<f32>,
    lightViewProj:   mat4x4<f32>,
    cameraPos:       vec3<f32>,
    shadowIntensity: f32,
    screenWidth:     f32,
    screenHeight:    f32,
    shadowBias:      f32,
    shadowMapSize:   f32,
}`;
const _uniformData = new Float32Array(getFloat32ArraySize(SHADOW_PARAMS_STRUCT));
const _lightView = new Float32Array(16);
const _lightProj = new Float32Array(16);
const _lightViewProj = new Float32Array(16);

const SHADOW_COMPOSITE_SHADER = /* wgsl */ `
${SHADOW_PARAMS_STRUCT}

@group(0) @binding(0) var<uniform> params: ShadowParams;
@group(0) @binding(1) var sceneDepth: texture_depth_2d;
@group(0) @binding(2) var shadowMap: texture_depth_2d;
@group(0) @binding(3) var shadowSampler: sampler_comparison;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

// PCF 3×3 shadow sampling — textureSampleCompare must be called from
// uniform control flow, so we always sample (with clamped UVs) and use
// select() to return fully-lit for out-of-bounds pixels.
fn sampleShadowPCF(worldPos: vec3<f32>, bias: f32) -> f32 {
    let light4 = params.lightViewProj * vec4<f32>(worldPos, 1.0);
    let lightNDC = light4.xyz / light4.w;
    let shadowUV = vec2<f32>(lightNDC.x * 0.5 + 0.5, lightNDC.y * -0.5 + 0.5);

    // Clamp UVs so the unconditional sample is always valid
    let safeUV = clamp(shadowUV, vec2<f32>(0.001), vec2<f32>(0.999));
    let depthRef = clamp(lightNDC.z - bias, 0.0, 1.0);

    let texelSize = 1.0 / params.shadowMapSize;
    var shadow = 0.0;
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let offset = vec2<f32>(f32(dx), f32(dy)) * texelSize;
            shadow += textureSampleCompare(shadowMap, shadowSampler, safeUV + offset, depthRef);
        }
    }
    shadow /= 9.0;

    // If original UVs were out of bounds, treat as fully lit
    let inBounds = shadowUV.x >= 0.0 && shadowUV.x <= 1.0 &&
                   shadowUV.y >= 0.0 && shadowUV.y <= 1.0 &&
                   lightNDC.z >= 0.0 && lightNDC.z <= 1.0;
    return select(1.0, shadow, inBounds);
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

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let texCoord = vec2<i32>(
        i32(input.uv.x * params.screenWidth),
        i32(input.uv.y * params.screenHeight)
    );
    let depth = textureLoad(sceneDepth, texCoord, 0);

    // Reconstruct camera ray for this pixel (always needed)
    let clipX = input.uv.x * 2.0 - 1.0;
    let clipY = -(input.uv.y * 2.0 - 1.0);

    var worldPos: vec3<f32>;
    var hasSurface = false;

    if (depth < 0.999 && depth > 0.001) {
        // Entity / solid geometry — reconstruct from depth buffer
        let world4 = params.invViewProj * vec4<f32>(clipX, clipY, depth, 1.0);
        worldPos = world4.xyz / world4.w;
        hasSurface = true;
    } else {
        // No depth written (grid uses depthWrite:false) —
        // Ray-intersect with ground plane y=0 to place shadow there.
        let nearW = params.invViewProj * vec4<f32>(clipX, clipY, 0.0, 1.0);
        let farW  = params.invViewProj * vec4<f32>(clipX, clipY, 1.0, 1.0);
        let nearPt = nearW.xyz / nearW.w;
        let farPt  = farW.xyz / farW.w;
        let rayDir = farPt - nearPt;

        // Intersect ray with y=0 plane
        if (abs(rayDir.y) > 0.0001) {
            let t = -nearPt.y / rayDir.y;
            if (t > 0.0 && t < 1.0) {
                worldPos = nearPt + rayDir * t;
                hasSurface = true;
            }
        }
    }

    if (!hasSurface) { discard; }

    let shadow = sampleShadowPCF(worldPos, params.shadowBias);

    // shadow = 1.0 lit, 0.0 shadowed
    let darkness = (1.0 - shadow) * params.shadowIntensity;
    if (darkness < 0.01) { discard; }

    return vec4<f32>(0.0, 0.0, 0.0, darkness);
}
`;

export class ShadowMapPass {
    constructor({ surfaceDepthOnly = false } = {}) {
        // Spatial lanes draw their actual terrain into depth. Their transparent
        // surroundings must not receive the legacy editor's implicit y=0 plane.
        this.surfaceDepthOnly = surfaceDepthOnly;
        this.device = null;
        this.vgpu = null;
        this.initialized = false;
        this.enabled = true;

        // Tunables
        this.shadowIntensity = 0.7;
        this.shadowBias = 0.003;
        this.mapSize = SHADOW_MAP_SIZE;

        // GPU resources
        this.shadowTexture = null;
        this.shadowTextureView = null;
        this.compositePipeline = null;
        this.uniformBuffer = null;
        this.comparisonSampler = null;
        this.bindGroupLayout = null;

        // Shadow caster bounding sphere (computed per frame)
        this._casterMinX = 0; this._casterMinY = 0; this._casterMinZ = 0;
        this._casterMaxX = 0; this._casterMaxY = 0; this._casterMaxZ = 0;
        this._casterCount = 0;

        this._failCount = 0;
        this._maxFails = 3;
    }

    init(device, colorFormat = 'bgra8unorm', { deferPipeline = false } = {}) {
        this.initialized = false;
        this.initializationError = null;
        this._compositeModule = null;
        this._compositeOptions = null;
        try {
            this.device = device;
            this.vgpu = initVGPU(device);
            this._colorFormat = colorFormat;

            // Shadow depth texture (depth32float for precision)
            this.shadowTexture = device.createTexture({
                size: { width: this.mapSize, height: this.mapSize, depthOrArrayLayers: 1 },
                format: 'depth32float',
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
                label: 'ShadowMapDepth',
            });
            this.shadowTextureView = this.shadowTexture.createView();

            // Comparison sampler for PCF
            this.comparisonSampler = device.createSampler({
                compare: 'less',
                magFilter: 'linear',
                minFilter: 'linear',
                label: 'ShadowComparisonSampler',
            });

            // Uniform buffer
            this.uniformBuffer = this.vgpu.buffer.create({
                size: _uniformData.byteLength,
                usage: 'uniform',
                label: 'ShadowMapParams',
            }).buffer;

            // Composite pipeline bind group layout
            this.bindGroupLayout = this.vgpu.bindings.defineLayout(this.surfaceDepthOnly ? 'shadowMapCompositeOpaqueSurface' : 'shadowMapComposite', [
                { binding: 0, type: 'uniform', visibility: 'fragment' },
                { binding: 1, type: 'texture', visibility: 'fragment', sampleType: this.surfaceDepthOnly ? 'unfilterable-float' : 'depth' },
                { binding: 2, type: 'texture', visibility: 'fragment', sampleType: 'depth' },
                { binding: 3, type: 'sampler', visibility: 'fragment', samplerType: 'comparison' },
            ]);

            const compositeCode = this.surfaceDepthOnly ? SHADOW_COMPOSITE_SHADER
                // Compatibility mode prohibits textureLoad(texture_depth_2d).
                // The same depth-format view may be read as unfilterable float.
                // https://github.com/gpuweb/gpuweb/blob/main/proposals/compatibility-mode.md#16-disallow-textureload-with-texture_depth-textures
                .replace('var sceneDepth: texture_depth_2d;', 'var sceneDepth: texture_2d<f32>;')
                .replace('let depth = textureLoad(sceneDepth, texCoord, 0);', 'let depth = textureLoad(sceneDepth, texCoord, 0).x;')
                .replace('if (depth < 0.999 && depth > 0.001)', 'if (depth < 1.0)')
                .replace('if (!hasSurface) { discard; }', '')
                .replace('let texelSize = 1.0 / params.shadowMapSize;', `
    // Receiver-plane PCF compares the plane at each neighbouring shadow texel.
    // A fixed centre-depth comparison otherwise shadows a lit sloped plane.
    let ndcDx = dpdx(lightNDC); let ndcDy = dpdy(lightNDC);
    let uvDx = ndcDx.xy * vec2<f32>(0.5, -0.5);
    let uvDy = ndcDy.xy * vec2<f32>(0.5, -0.5);
    let determinant = uvDx.x * uvDy.y - uvDx.y * uvDy.x;
    let denominator = select(1.0, determinant, abs(determinant) > 1e-12);
    let receiverGradient = select(vec2<f32>(0.0), vec2<f32>(
        ndcDx.z * uvDy.y - ndcDy.z * uvDx.y,
        uvDx.x * ndcDy.z - uvDy.x * ndcDx.z
    ) / denominator, abs(determinant) > 1e-12);
    let texelSize = 1.0 / params.shadowMapSize;`)
                .replace('safeUV + offset, depthRef)', 'safeUV + offset, clamp(depthRef + dot(receiverGradient, offset), 0.0, 1.0))')
                .replace('let darkness = (1.0 - shadow)', 'if (!hasSurface || depth >= 1.0) { discard; }\n    let darkness = (1.0 - shadow)') : SHADOW_COMPOSITE_SHADER;
            const shaderModule = this.vgpu.shader.compile(this.surfaceDepthOnly ? 'shadowMapCompositeOpaqueSurface' : 'shadowMapComposite', compositeCode);
            this._compositeModule = shaderModule;
            this._compositeOptions = {
                vertex:   { module: shaderModule, entryPoint: 'vs_main' },
                fragment: { module: shaderModule, entryPoint: 'fs_main' },
                layouts:  [this.bindGroupLayout],
                colorFormat: colorFormat,
                blend: 'alpha',
                topology: 'triangle-list',
                depthFormat: null,
                label: 'ShadowMapCompositePipeline',
            };
            if (!deferPipeline) this.compositePipeline = this.vgpu.pipeline.render(this._compositeOptions);

            this.initialized = !deferPipeline;
            this.initializationError = null;
            this._failCount = 0;
            if (!deferPipeline) console.log(`[ShadowMapPass] Initialized: ${this.mapSize}×${this.mapSize} depth32float`);
        } catch (e) {
            console.warn('[ShadowMapPass] init failed:', e.message);
            this.initialized = false;
            this.initializationError = e;
            this._failCount++;
        }
    }

    /** Await shader and pipeline validation before a spatial lane becomes ready.
     * Legacy init() retains its synchronous API; this path never caches an
     * invalid synchronous pipeline or hides the original GPU creation error. */
    async initValidated(device, colorFormat = 'bgra8unorm') {
        try {
            await withErrorScope(device, () => this.init(device, colorFormat, { deferPipeline: true }));
            if (this.initializationError) throw this.initializationError;
            await assertCheckedShaderModule(this._compositeModule, { label: 'ShadowMapCompositePipeline' });
            this.compositePipeline = await withErrorScope(device, () => this.vgpu.pipeline.renderAsync(this._compositeOptions));
            this.initialized = true;
            this._failCount = 0;
            console.log(`[ShadowMapPass] Validated: ${this.mapSize}×${this.mapSize} depth32float`);
        } catch (error) {
            this.initialized = false;
            this.initializationError = error;
            this._failCount++;
            console.warn('[ShadowMapPass] validated init failed:', error.message);
            throw error;
        }
    }

    /** Reset per-frame caster bounds */
    beginFrame() {
        this._casterMinX =  Infinity; this._casterMinY =  Infinity; this._casterMinZ =  Infinity;
        this._casterMaxX = -Infinity; this._casterMaxY = -Infinity; this._casterMaxZ = -Infinity;
        this._casterCount = 0;
    }

    /** Expand bounding box to include a shadow caster (call during entity loop) */
    addCaster(x, y, z, radius) {
        this._casterMinX = Math.min(this._casterMinX, x - radius);
        this._casterMinY = Math.min(this._casterMinY, y - radius);
        this._casterMinZ = Math.min(this._casterMinZ, z - radius);
        this._casterMaxX = Math.max(this._casterMaxX, x + radius);
        this._casterMaxY = Math.max(this._casterMaxY, y + radius);
        this._casterMaxZ = Math.max(this._casterMaxZ, z + radius);
        this._casterCount++;
    }

    /**
     * Compute the light view-projection matrix from sun direction + caster bounds.
     * Returns a Float32Array(16) lightViewProj, or null if no casters.
     * @param {number[]} sunDir - normalized [x,y,z] sun direction (toward ground)
     * @returns {Float32Array|null}
     */
    computeLightMatrix(sunDir) {
        if (this._casterCount === 0) return null;

        // Normalize sun direction
        const len = Math.sqrt(sunDir[0] * sunDir[0] + sunDir[1] * sunDir[1] + sunDir[2] * sunDir[2]) || 1;
        const lx = sunDir[0] / len, ly = sunDir[1] / len, lz = sunDir[2] / len;

        // Expand bounds to include shadow landing area on ground plane (y=0).
        // For each caster edge, project onto y=0 along sun direction and include
        // that point so the light frustum covers both casters AND where shadows fall.
        let minX = this._casterMinX, minY = this._casterMinY, minZ = this._casterMinZ;
        let maxX = this._casterMaxX, maxY = this._casterMaxY, maxZ = this._casterMaxZ;

        // Always include ground plane
        minY = Math.min(minY, -0.1);

        // Project caster top edges onto y=0 along sun direction
        if (ly < -0.01) {
            // Sun points downward — shadow of the highest point lands at:
            // groundX = casterX - lx * (casterY / -ly)
            const projScale = this._casterMaxY / (-ly);
            const gx1 = this._casterMinX + lx * projScale;
            const gx2 = this._casterMaxX + lx * projScale;
            const gz1 = this._casterMinZ + lz * projScale;
            const gz2 = this._casterMaxZ + lz * projScale;
            minX = Math.min(minX, gx1, gx2);
            maxX = Math.max(maxX, gx1, gx2);
            minZ = Math.min(minZ, gz1, gz2);
            maxZ = Math.max(maxZ, gz1, gz2);
        }

        // Bounding sphere from expanded bounds
        const cx = (minX + maxX) * 0.5;
        const cy = (minY + maxY) * 0.5;
        const cz = (minZ + maxZ) * 0.5;
        const dx = maxX - minX;
        const dy = maxY - minY;
        const dz = maxZ - minZ;
        let radius = Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.5;
        radius = Math.max(radius, 3.0); // minimum 3m coverage

        // Light position: center - lightDir * radius (look from behind the scene)
        const eyeX = cx - lx * radius * 2;
        const eyeY = cy - ly * radius * 2;
        const eyeZ = cz - lz * radius * 2;

        // lookAt (light → center)
        this._lookAt(eyeX, eyeY, eyeZ, cx, cy, cz, _lightView);

        // Orthographic projection covering the bounding sphere + padding
        const pad = radius * 0.15;
        const r = radius + pad;
        this._ortho(-r, r, -r, r, 0.1, radius * 4 + 0.1, _lightProj);

        // lightViewProj = lightProj × lightView
        this._mulMat4(_lightProj, _lightView, _lightViewProj);

        return _lightViewProj;
    }

    /**
     * Render shadow depth map. Call AFTER EntityMeshRenderer.flush().
     * @param {GPUCommandEncoder} encoder
     * @param {EntityMeshRenderer} emr - to call flushShadowDepth()
     * @param {Float32Array} lightViewProj
     * @param {Array} [additionalCasters] - Optional array of objects with a
     *   `flush(pass, lightViewProj)` method. Each is called after entity shadows
     *   within the same depth pass. Used for particle shadow casters, etc.
     */
    renderShadowDepth(encoder, emr, lightViewProj, additionalCasters) {
        if (!this.initialized || !lightViewProj) return;

        const pass = encoder.beginRenderPass({
            colorAttachments: [],
            depthStencilAttachment: {
                view: this.shadowTextureView,
                depthLoadOp: 'clear',
                depthClearValue: 1.0,
                depthStoreOp: 'store',
            },
        });

        emr.flushShadowDepth(pass, lightViewProj);

        // Additional shadow casters (particles, etc.) share the same depth pass
        if (additionalCasters) {
            for (let i = 0; i < additionalCasters.length; i++) {
                const caster = additionalCasters[i];
                if (caster && typeof caster.flush === 'function') {
                    caster.flush(pass, lightViewProj);
                }
            }
        }

        pass.end();
    }

    /**
     * Composite shadows onto the rendered scene.
     * @param {GPUCommandEncoder} encoder
     * @param {GPUTextureView} outputView - swapchain texture view
     * @param {GPUTexture} sceneDepthTexture - scene depth (depth24plus, TEXTURE_BINDING)
     * @param {Float32Array} invViewProj - camera inverse view-projection (16 floats)
     * @param {Float32Array} lightViewProj - light view-projection (16 floats)
     * @param {number} screenW
     * @param {number} screenH
     * @param {number[]} cameraPos - [x,y,z] camera world position
     */
    composite(encoder, outputView, sceneDepthTexture, invViewProj, lightViewProj, screenW, screenH, cameraPos) {
        if (!this.initialized || this._casterCount === 0) return;

        // Upload uniforms
        _uniformData.set(invViewProj, 0);
        _uniformData.set(lightViewProj, 16);
        _uniformData[32] = cameraPos?.[0] || 0;
        _uniformData[33] = cameraPos?.[1] || 0;
        _uniformData[34] = cameraPos?.[2] || 0;
        _uniformData[35] = this.shadowIntensity;
        _uniformData[36] = screenW;
        _uniformData[37] = screenH;
        _uniformData[38] = this.shadowBias;
        _uniformData[39] = this.mapSize;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, _uniformData);

        // Create bind group (scene depth + shadow map change per frame)
        const bindGroup = this.device.createBindGroup({
            label: 'ShadowMapCompositeBindGroup',
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: sceneDepthTexture.createView({ aspect: 'depth-only' }) },
                { binding: 2, resource: this.shadowTextureView },
                { binding: 3, resource: this.comparisonSampler },
            ],
        });

        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: outputView,
                loadOp: 'load',
                storeOp: 'store',
            }],
        });
        pass.setPipeline(this.compositePipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
        pass.end();
    }

    destroy() {
        if (this.shadowTexture) this.shadowTexture.destroy();
        if (this.uniformBuffer) this.uniformBuffer.destroy();
        this.shadowTexture = null;
        this.uniformBuffer = null;
        this.initialized = false;
    }

    // ── Math helpers (minimal, no external deps) ──────────────────────

    _lookAt(eyeX, eyeY, eyeZ, cx, cy, cz, out) {
        let fx = cx - eyeX, fy = cy - eyeY, fz = cz - eyeZ;
        let fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
        fx /= fl; fy /= fl; fz /= fl;
        // up = [0,1,0], handle degenerate case
        let ux = 0, uy = 1, uz = 0;
        if (Math.abs(fy) > 0.99) { ux = 0; uy = 0; uz = 1; }
        let sx = fy * uz - fz * uy, sy = fz * ux - fx * uz, sz = fx * uy - fy * ux;
        let sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
        sx /= sl; sy /= sl; sz /= sl;
        ux = sy * fz - sz * fy; uy = sz * fx - sx * fz; uz = sx * fy - sy * fx;
        out[0] = sx;  out[1] = ux;  out[2]  = -fx; out[3]  = 0;
        out[4] = sy;  out[5] = uy;  out[6]  = -fy; out[7]  = 0;
        out[8] = sz;  out[9] = uz;  out[10] = -fz; out[11] = 0;
        out[12] = -(sx * eyeX + sy * eyeY + sz * eyeZ);
        out[13] = -(ux * eyeX + uy * eyeY + uz * eyeZ);
        out[14] =  (fx * eyeX + fy * eyeY + fz * eyeZ);
        out[15] = 1;
    }

    _ortho(l, r, b, t, n, f, out) {
        out[0] = 2 / (r - l); out[1] = 0;           out[2] = 0;            out[3] = 0;
        out[4] = 0;           out[5] = 2 / (t - b);  out[6] = 0;            out[7] = 0;
        out[8] = 0;           out[9] = 0;            out[10] = -1 / (f - n); out[11] = 0;
        out[12] = -(r + l) / (r - l);
        out[13] = -(t + b) / (t - b);
        out[14] = -n / (f - n);
        out[15] = 1;
    }

    _mulMat4(a, b, out) {
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                out[i * 4 + j] =
                    a[j] * b[i * 4] + a[4 + j] * b[i * 4 + 1] +
                    a[8 + j] * b[i * 4 + 2] + a[12 + j] * b[i * 4 + 3];
            }
        }
    }
}
