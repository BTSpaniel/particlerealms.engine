// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ProxyShadePass — Material Evaluation + Composite to HDR Buffer
 *
 * Reads the hit data textures produced by ProxyMaskPass and:
 *   1. Discards pixels where hitMask = 0 (transparent cutout — Blender Transparent BSDF)
 *   2. Samples the target asset's material at hitUV (albedo, roughness, metallic, normal)
 *   3. Evaluates PBR lighting using the engine's LightManager shader functions
 *   4. Alpha-composites into the HDR color buffer before tonemapping
 *
 * This is the deferred equivalent of Blender's Mix Shader:
 *   Mix(factor=IsHit, A=RayPortalBSDF, B=TransparentBSDF) → HDR output
 */

import { initVGPU }   from '../../core/gpu/VirtualGPU.js';
import { LightManager } from '../LightManager.js';

// ============================================================================
// WGSL Shade Shader
// ============================================================================

function buildShadeShaderWGSL() {
    const lightDefs  = LightManager.getShaderDefs();
    const lightFuncs = LightManager.getShaderFunctions();

    return /* wgsl */`

${lightDefs}

// ── Hit data inputs (from ProxyMaskPass) ─────────────────────────────────────
@group(0) @binding(0) var hitMaskTex  : texture_2d<u32>;
@group(0) @binding(1) var hitPosTex   : texture_2d<f32>;
@group(0) @binding(2) var hitNormTex  : texture_2d<f32>;
@group(0) @binding(3) var hitUVTex    : texture_2d<f32>;

// ── Target asset material ─────────────────────────────────────────────────────
@group(1) @binding(0) var matSampler  : sampler;
@group(1) @binding(1) var albedoTex   : texture_2d<f32>;
@group(1) @binding(2) var normalTex   : texture_2d<f32>;
@group(1) @binding(3) var roughMetTex : texture_2d<f32>; // R = roughness, G = metallic

// ── Lighting ──────────────────────────────────────────────────────────────────
@group(2) @binding(0) var<uniform> lighting : LightingUniforms;

// ── HDR output (read-write for composite) ─────────────────────────────────────
@group(3) @binding(0) var hdrOut    : texture_storage_2d<rgba16float, read_write>;

// ── Params ────────────────────────────────────────────────────────────────────
struct ShadeParams {
    cameraPos    : vec3<f32>,
    screenWidth  : u32,
    screenHeight : u32,
    roughnessBase: f32,
    metallicBase : f32,
    _pad         : f32,
}

@group(3) @binding(1) var<uniform> params : ShadeParams;

// ── PBR helpers ───────────────────────────────────────────────────────────────

fn distributionGGX(NdotH: f32, roughness: f32) -> f32 {
    let a    = roughness * roughness;
    let a2   = a * a;
    let denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / (3.14159265 * denom * denom);
}

fn geometrySmith(NdotV: f32, NdotL: f32, roughness: f32) -> f32 {
    let r  = roughness + 1.0;
    let k  = (r * r) / 8.0;
    let ggx1 = NdotV / (NdotV * (1.0 - k) + k);
    let ggx2 = NdotL / (NdotL * (1.0 - k) + k);
    return ggx1 * ggx2;
}

fn fresnelSchlick(cosTheta: f32, F0: vec3<f32>) -> vec3<f32> {
    return F0 + (vec3<f32>(1.0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

fn cookTorranceBRDF(
    N: vec3<f32>, V: vec3<f32>, L: vec3<f32>,
    albedo: vec3<f32>, roughness: f32, metallic: f32
) -> vec3<f32> {
    let H = normalize(V + L);
    let NdotH = max(dot(N, H), 0.0);
    let NdotV = max(dot(N, V), 0.0001);
    let NdotL = max(dot(N, L), 0.0);
    let HdotV = max(dot(H, V), 0.0);

    let F0  = mix(vec3<f32>(0.04), albedo, metallic);
    let F   = fresnelSchlick(HdotV, F0);
    let D   = distributionGGX(NdotH, roughness);
    let G   = geometrySmith(NdotV, NdotL, roughness);

    let specular  = (D * G * F) / max(4.0 * NdotV * NdotL, 0.001);
    let kd        = (vec3<f32>(1.0) - F) * (1.0 - metallic);
    let diffuse   = kd * albedo / 3.14159265;
    return (diffuse + specular) * NdotL;
}

${lightFuncs}

// ─────────────────────────────────────────────────────────────────────────────

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let px = gid.x;
    let py = gid.y;
    if (px >= params.screenWidth || py >= params.screenHeight) { return; }

    let coord = vec2<u32>(px, py);

    // Read hit mask — skip pixels with no proxy hit
    let mask = textureLoad(hitMaskTex, coord, 0).r;
    if (mask == 0u) { return; }

    // Read hit data
    let worldPos  = textureLoad(hitPosTex,  coord, 0).xyz;
    let worldNorm = normalize(textureLoad(hitNormTex, coord, 0).xyz);
    let uv        = textureLoad(hitUVTex,   coord, 0).xy;

    // Sample material at hit UV
    let albedoSample  = textureSampleLevel(albedoTex,   matSampler, uv, 0.0).rgb;
    let rmSample      = textureSampleLevel(roughMetTex, matSampler, uv, 0.0);
    let roughness     = rmSample.r * params.roughnessBase;
    let metallic      = rmSample.g * params.metallicBase;

    // Sample normal map and transform from tangent to world space
    let normSample    = textureSampleLevel(normalTex, matSampler, uv, 0.0).rgb * 2.0 - 1.0;
    // Approximate TBN: use world normal as-is + small tilt from normal map
    let tangent       = normalize(cross(worldNorm, vec3<f32>(0.0, 1.0, 0.001)));
    let bitangent     = cross(worldNorm, tangent);
    let shadingNormal = normalize(tangent * normSample.x + bitangent * normSample.y + worldNorm * normSample.z);

    // View direction
    let V = normalize(params.cameraPos - worldPos);

    // Accumulate lighting from all registered lights
    var totalLight = vec3<f32>(0.0);
    totalLight += calcAllLighting(worldPos, shadingNormal, albedoSample, V, roughness, metallic);

    // Environment ambient
    let ambientStrength = 0.08;
    totalLight += albedoSample * ambientStrength;

    // Read existing HDR value and composite (add proxy on top)
    let existing = textureLoad(hdrOut, coord);
    let finalHDR = existing.rgb + totalLight;
    textureStore(hdrOut, coord, vec4<f32>(finalHDR, 1.0));
}
`;
}

// ============================================================================
// ProxyShadePass
// ============================================================================

export class ProxyShadePass {
    /**
     * @param {GPUDevice} device
     * @param {number}    width
     * @param {number}    height
     */
    constructor(device, width, height) {
        this.vgpu   = initVGPU(device);
        this.device = device;
        this.width  = width;
        this.height = height;

        this._paramsBuffer = null;
        this._paramsData   = new Float32Array(8);
        this._paramsU32    = new Uint32Array(this._paramsData.buffer);

        this._pipeline     = null;

        this._initPipeline();
        this._initParamsBuffer();
    }

    // -------------------------------------------------------------------------

    _initPipeline() {
        const wgsl   = buildShadeShaderWGSL();
        const shader = this.vgpu.shader.compile('ProxyShade', wgsl);
        this._pipeline = this.vgpu.pipeline.compute({
            module    : shader,
            entryPoint: 'main',
            label     : 'ProxyShadePipeline',
        });
    }

    _initParamsBuffer() {
        this._paramsBuffer = this.vgpu.buffer.create({
            size : this._paramsData.byteLength,
            usage: 'uniform',
            label: 'ProxyShadeParams',
        }).buffer;
    }

    /**
     * Execute the shade composite pass.
     *
     * @param {GPUCommandEncoder} encoder
     * @param {Object}            opts
     * @param {GPUTextureView}    opts.hitMaskView
     * @param {GPUTextureView}    opts.hitPosView
     * @param {GPUTextureView}    opts.hitNormView
     * @param {GPUTextureView}    opts.hitUVView
     * @param {GPUSampler}        opts.matSampler
     * @param {GPUTextureView}    opts.albedoView
     * @param {GPUTextureView}    opts.normalMapView
     * @param {GPUTextureView}    opts.roughMetView
     * @param {GPUBuffer}         opts.lightingBuffer
     * @param {GPUTextureView}    opts.hdrView         — read-write rgba16float
     * @param {number[]}          opts.cameraPos
     * @param {number}            opts.roughnessBase
     * @param {number}            opts.metallicBase
     */
    execute(encoder, {
        hitMaskView, hitPosView, hitNormView, hitUVView,
        matSampler, albedoView, normalMapView, roughMetView,
        lightingBuffer, hdrView,
        cameraPos, roughnessBase = 0.7, metallicBase = 0.0,
    }) {
        // Upload params
        this._paramsData[0] = cameraPos[0];
        this._paramsData[1] = cameraPos[1];
        this._paramsData[2] = cameraPos[2];
        this._paramsU32 [3] = this.width;
        this._paramsU32 [4] = this.height;
        this._paramsData[5] = roughnessBase;
        this._paramsData[6] = metallicBase;
        this._paramsData[7] = 0.0;
        this.device.queue.writeBuffer(this._paramsBuffer, 0, this._paramsData);

        const pipe = this._pipeline;

        const bg0 = this.device.createBindGroup({
            layout: pipe.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: hitMaskView  },
                { binding: 1, resource: hitPosView   },
                { binding: 2, resource: hitNormView  },
                { binding: 3, resource: hitUVView    },
            ],
        });

        const bg1 = this.device.createBindGroup({
            layout: pipe.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: matSampler     },
                { binding: 1, resource: albedoView     },
                { binding: 2, resource: normalMapView  },
                { binding: 3, resource: roughMetView   },
            ],
        });

        const bg2 = this.device.createBindGroup({
            layout: pipe.getBindGroupLayout(2),
            entries: [
                { binding: 0, resource: { buffer: lightingBuffer } },
            ],
        });

        const bg3 = this.device.createBindGroup({
            layout: pipe.getBindGroupLayout(3),
            entries: [
                { binding: 0, resource: hdrView },
                { binding: 1, resource: { buffer: this._paramsBuffer } },
            ],
        });

        const pass = encoder.beginComputePass({ label: 'ProxyShade' });
        pass.setPipeline(pipe);
        pass.setBindGroup(0, bg0);
        pass.setBindGroup(1, bg1);
        pass.setBindGroup(2, bg2);
        pass.setBindGroup(3, bg3);
        pass.dispatchWorkgroups(
            Math.ceil(this.width / 8),
            Math.ceil(this.height / 8),
        );
        pass.end();
    }

    resize(width, height) {
        this.width  = width;
        this.height = height;
    }

    destroy() {
        this._paramsBuffer?.destroy();
    }
}
