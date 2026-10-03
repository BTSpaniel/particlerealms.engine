// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleNoiseTexture.js - Pre-baked 3D curl noise volume texture
 * 
 * Replaces expensive per-particle gradientNoise calls with one filtered sample
 * from a two-pass vector-potential -> discrete-curl 3D texture bake.
 * 6-24× cheaper turbulence depending on octave count.
 * 
 * The noise is tileable: baked with periodic boundary conditions and
 * sampled with repeat addressing mode for seamless spatial tiling.
 * 
 * Ref: GPU Gems 3 Ch.1 "Generating Complex Procedural Terrains Using the GPU"
 */

import { createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";
import { LEGACY_PARTICLE_RUNTIME_PCG_WGSL, LEGACY_PCG32_WGSL } from "../../core/math/MathBits.js";

// ============================================================================
// BAKE COMPUTE SHADER - Fills 3D texture with tileable curl noise vectors
// ============================================================================

const NOISE_BAKE_SHADER = `
struct BakeParams {
    resolution: u32,
    period: f32,
    octaves: u32,
    _pad1: u32,
}

@group(0) @binding(0) var<uniform> params: BakeParams;
@group(0) @binding(1) var potentialOut: texture_storage_3d<rgba16float, write>;
@group(0) @binding(2) var potentialIn: texture_3d<f32>;
@group(0) @binding(3) var noiseOut: texture_storage_3d<rgba16float, write>;

${LEGACY_PCG32_WGSL}
${LEGACY_PARTICLE_RUNTIME_PCG_WGSL}

// Tileable hash: wraps grid coordinates to [0, period) before hashing (deterministic PCG)
fn hash33t(p: vec3<f32>, period: f32) -> vec3<f32> {
    let pp = ((p % period) + period) % period;
    let ix = u32(i32(round(pp.x)));
    let iy = u32(i32(round(pp.y)));
    let iz = u32(i32(round(pp.z)));
    let seed = pcg_hash(ix + pcg_hash(iy + pcg_hash(iz)));
    return vec3<f32>(
        f32(pcg_hash(seed      )) / 4294967295.0 * 2.0 - 1.0,
        f32(pcg_hash(seed + 1u )) / 4294967295.0 * 2.0 - 1.0,
        f32(pcg_hash(seed + 2u )) / 4294967295.0 * 2.0 - 1.0,
    );
}

fn tileableGradientNoise(p: vec3<f32>, period: f32) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);

    return mix(
        mix(mix(dot(hash33t(i + vec3<f32>(0.0, 0.0, 0.0), period), f - vec3<f32>(0.0, 0.0, 0.0)),
                dot(hash33t(i + vec3<f32>(1.0, 0.0, 0.0), period), f - vec3<f32>(1.0, 0.0, 0.0)), u.x),
            mix(dot(hash33t(i + vec3<f32>(0.0, 1.0, 0.0), period), f - vec3<f32>(0.0, 1.0, 0.0)),
                dot(hash33t(i + vec3<f32>(1.0, 1.0, 0.0), period), f - vec3<f32>(1.0, 1.0, 0.0)), u.x), u.y),
        mix(mix(dot(hash33t(i + vec3<f32>(0.0, 0.0, 1.0), period), f - vec3<f32>(0.0, 0.0, 1.0)),
                dot(hash33t(i + vec3<f32>(1.0, 0.0, 1.0), period), f - vec3<f32>(1.0, 0.0, 1.0)), u.x),
            mix(dot(hash33t(i + vec3<f32>(0.0, 1.0, 1.0), period), f - vec3<f32>(0.0, 1.0, 1.0)),
                dot(hash33t(i + vec3<f32>(1.0, 1.0, 1.0), period), f - vec3<f32>(1.0, 1.0, 1.0)), u.x), u.y), u.z);
}

fn vectorPotential(p: vec3<f32>, period: f32) -> vec3<f32> {
    return vec3<f32>(
        tileableGradientNoise(p + vec3<f32>(19.19, 73.73, 41.41), period),
        tileableGradientNoise(p + vec3<f32>(-37.17, 11.31, 97.97), period),
        tileableGradientNoise(p + vec3<f32>(83.83, -53.53, 29.29), period)
    );
}

@compute @workgroup_size(4, 4, 4)
fn bakeVectorPotential(@builtin(global_invocation_id) gid: vec3<u32>) {
    let res = params.resolution;
    if (gid.x >= res || gid.y >= res || gid.z >= res) { return; }

    let p = vec3<f32>(gid) * (params.period / f32(res));
    var result = vec3<f32>(0.0);
    var freq = 1.0;
    var amp = 1.0;
    for (var o = 0u; o < params.octaves; o++) {
        // Dividing potential amplitude by frequency makes its eventual curl
        // retain the intended 1, 1/2, 1/4... octave energy profile.
        result += vectorPotential(p * freq, params.period * freq) * (amp / freq);
        freq *= 2.0;
        amp *= 0.5;
    }
    textureStore(potentialOut, gid, vec4<f32>(result, 0.0));
}

fn wrapCoord(p: vec3<i32>, resolution: i32) -> vec3<i32> {
    let size = vec3<i32>(resolution);
    return ((p % size) + size) % size;
}

@compute @workgroup_size(4, 4, 4)
fn bakeCurlVolume(@builtin(global_invocation_id) gid: vec3<u32>) {
    let res = params.resolution;
    if (gid.x >= res || gid.y >= res || gid.z >= res) { return; }

    let c = vec3<i32>(gid);
    let ri = i32(res);
    let dx = vec3<i32>(1, 0, 0);
    let dy = vec3<i32>(0, 1, 0);
    let dz = vec3<i32>(0, 0, 1);
    let a_px = textureLoad(potentialIn, wrapCoord(c + dx, ri), 0).xyz;
    let a_mx = textureLoad(potentialIn, wrapCoord(c - dx, ri), 0).xyz;
    let a_py = textureLoad(potentialIn, wrapCoord(c + dy, ri), 0).xyz;
    let a_my = textureLoad(potentialIn, wrapCoord(c - dy, ri), 0).xyz;
    let a_pz = textureLoad(potentialIn, wrapCoord(c + dz, ri), 0).xyz;
    let a_mz = textureLoad(potentialIn, wrapCoord(c - dz, ri), 0).xyz;
    let inverseTwoCell = 1.0 / (2.0 * params.period / f32(res));
    var result = vec3<f32>(
        (a_py.z - a_my.z) - (a_pz.y - a_mz.y),
        (a_pz.x - a_mz.x) - (a_px.z - a_mx.z),
        (a_px.y - a_mx.y) - (a_py.x - a_my.x)
    ) * inverseTwoCell * 0.57735026919;
    textureStore(noiseOut, gid, vec4<f32>(result, length(result)));
}
`;

// ============================================================================
// WGSL SNIPPET - Injected into the main sim shader for group(3) bindings
// ============================================================================

// This snippet is appended to the main sim shader. It declares the noise
// texture bindings and provides a textureSampleLevel-based curlNoiseOctave
// replacement that the shader uses when noiseParams.x > 0.
export const NOISE_TEXTURE_BINDINGS_SNIPPET = `
// ========== 3D NOISE TEXTURE (group 3) ==========
@group(3) @binding(0) var noiseVolume: texture_3d<f32>;
@group(3) @binding(1) var noiseSampler: sampler;
@group(3) @binding(2) var<uniform> noiseParams: vec4<f32>; // x=uvScale, y=enabled, z=baked octaves
`;

// Default noise period in world units — the texture tiles every `period` units
const DEFAULT_NOISE_PERIOD = 16.0;

// ============================================================================
// SYSTEM
// ============================================================================

/**
 * Create the 3D noise texture system.
 * @param {GPUDevice} device
 * @param {number} resolution - Texture resolution (64 or 128)
 * @param {number} period - World-space tiling period
 * @returns {Promise<object>} Validated noise-volume resources
 */
export async function createNoiseTextureSystem(device, resolution = 64, period = DEFAULT_NOISE_PERIOD) {
    if (!Number.isInteger(resolution) || resolution < 4) {
        throw new RangeError(`Noise texture resolution must be an integer >= 4; received ${resolution}`);
    }
    if (!Number.isInteger(period) || period <= 0) {
        throw new RangeError(`Noise texture period must be a positive integer; received ${period}`);
    }
    if (resolution < period * 2) {
        throw new RangeError(
            `Noise texture resolution ${resolution} must provide at least two samples per base-noise cell for period ${period}`,
        );
    }
    const ownedResources = [];
    let errorScopeCount = 0;
    async function closeErrorScopes() {
        let firstError = null;
        const pendingScopes = [];
        while (errorScopeCount > 0) {
            try {
                pendingScopes.push(device.popErrorScope());
            } catch (error) {
                firstError ||= error;
            }
            errorScopeCount -= 1;
        }
        for (const pendingScope of pendingScopes) {
            try {
                firstError ||= await pendingScope;
            } catch (error) {
                firstError ||= error;
            }
        }
        return firstError;
    }
    try {
    device.pushErrorScope('validation');
    errorScopeCount += 1;
    device.pushErrorScope('out-of-memory');
    errorScopeCount += 1;
    const potentialTexture = device.createTexture({
        label: "NoiseTexture.potential",
        size: { width: resolution, height: resolution, depthOrArrayLayers: resolution },
        format: 'rgba16float',
        dimension: '3d',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    ownedResources.push(potentialTexture);
    const potentialTextureView = potentialTexture.createView({ label: "NoiseTexture.potentialView" });

    // 3D texture: RGBA16Float for curl noise vectors (xyz = curl, w = magnitude)
    const noiseTexture = device.createTexture({
        label: "NoiseTexture.volume",
        size: { width: resolution, height: resolution, depthOrArrayLayers: resolution },
        format: 'rgba16float',
        dimension: '3d',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    ownedResources.push(noiseTexture);
    const noiseTextureView = noiseTexture.createView({ label: "NoiseTexture.view" });

    // Sampler: trilinear + repeat for seamless tiling
    const noiseSampler = device.createSampler({
        label: "NoiseTexture.sampler",
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'repeat',
        addressModeV: 'repeat',
        addressModeW: 'repeat',
    });

    // Noise params uniform: vec4(uvScale, enabled, 0, 0)
    const noiseParamsBuffer = createUniformBuffer(device, 16, { label: "NoiseTexture.params" });
    ownedResources.push(noiseParamsBuffer);
    labelResource(noiseParamsBuffer, "NoiseTexture.params");
    // Initialize as disabled
    updateBuffer(device, noiseParamsBuffer, new Float32Array([0.0, 0.0, 0.0, 0.0]), 0);

    // Bake pipeline
    const bakeModule = device.createShaderModule({
        label: "NoiseTexture.bakeShader",
        code: NOISE_BAKE_SHADER,
    });
    const potentialPipeline = device.createComputePipeline({
        label: "NoiseTexture.potentialPipeline",
        layout: "auto",
        compute: { module: bakeModule, entryPoint: "bakeVectorPotential" },
    });
    const curlPipeline = device.createComputePipeline({
        label: "NoiseTexture.curlPipeline",
        layout: "auto",
        compute: { module: bakeModule, entryPoint: "bakeCurlVolume" },
    });

    // Bake params uniform
    const bakeParamsBuffer = createUniformBuffer(device, 16, { label: "NoiseTexture.bakeParams" });
    ownedResources.push(bakeParamsBuffer);
    labelResource(bakeParamsBuffer, "NoiseTexture.bakeParams");

    // Bake bind group
    const potentialBindGroup = device.createBindGroup({
        label: "NoiseTexture.potentialBindGroup",
        layout: potentialPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: bakeParamsBuffer } },
            { binding: 1, resource: potentialTextureView },
        ],
    });
    const curlBindGroup = device.createBindGroup({
        label: "NoiseTexture.curlBindGroup",
        layout: curlPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: bakeParamsBuffer } },
            { binding: 2, resource: potentialTextureView },
            { binding: 3, resource: noiseTextureView },
        ],
    });

    const samplesPerBaseCell = resolution / period;
    const octaves = Math.max(1, Math.min(4, Math.floor(Math.log2(Math.max(1, samplesPerBaseCell)))));
    const system = {
        device,
        resolution,
        period,
        octaves,
        potentialTexture,
        potentialTextureView,
        noiseTexture,
        noiseTextureView,
        noiseSampler,
        noiseParamsBuffer,
        potentialPipeline,
        curlPipeline,
        bakeParamsBuffer,
        potentialBindGroup,
        curlBindGroup,
        baked: false,
    };
    const gpuError = await closeErrorScopes();
    if (gpuError) throw gpuError;
    console.log(`[NoiseTexture] 3D noise texture system created (${resolution}³, period=${period}, octaves=${octaves})`);
    return system;
    } catch (error) {
        const gpuError = await closeErrorScopes();
        for (let index = ownedResources.length - 1; index >= 0; index -= 1) {
            ownedResources[index]?.destroy?.();
        }
        throw gpuError || error;
    }
}

/**
 * Bake the noise volume texture. Call once after creation.
 * This is a one-time GPU operation (~1ms for 64³, ~8ms for 128³).
 */
export function bakeNoiseTexture(system, device) {
    if (!system || system.baked) return;

    const resolution = system.resolution;
    const period = system.period;

    // Upload bake params
    const bakeData = new Uint32Array(4);
    bakeData[0] = resolution;
    new Float32Array(bakeData.buffer)[1] = period;
    bakeData[2] = system.octaves;
    bakeData[3] = 0;
    updateBuffer(device, system.bakeParamsBuffer, bakeData, 0);

    // Dispatch bake (workgroup_size = 4×4×4 = 64 threads)
    const wgCount = Math.ceil(resolution / 4);
    const encoder = device.createCommandEncoder({ label: "NoiseTexture.bake.encoder" });
    const potentialPass = encoder.beginComputePass({ label: "NoiseTexture.potential.pass" });
    potentialPass.setPipeline(system.potentialPipeline);
    potentialPass.setBindGroup(0, system.potentialBindGroup);
    potentialPass.dispatchWorkgroups(wgCount, wgCount, wgCount);
    potentialPass.end();
    const curlPass = encoder.beginComputePass({ label: "NoiseTexture.curl.pass" });
    curlPass.setPipeline(system.curlPipeline);
    curlPass.setBindGroup(0, system.curlBindGroup);
    curlPass.dispatchWorkgroups(wgCount, wgCount, wgCount);
    curlPass.end();
    device.queue.submit([encoder.finish()]);

    // Enable noise sampling: uvScale = 1/period, enabled = 1.0
    const uvScale = 1.0 / period;
    updateBuffer(device, system.noiseParamsBuffer, new Float32Array([uvScale, 1.0, system.octaves, 0.0]), 0);

    system.baked = true;
    console.log(`[NoiseTexture] Baked ${resolution}³ potential + discrete curl (${wgCount}³ workgroups each, octaves=${system.octaves}, period=${period})`);
}

/**
 * Create a 1×1×1 dummy noise texture for use when the real texture isn't ready.
 * Returns { textureView, sampler, paramsBuffer } suitable for bind group creation.
 */
export function createDummyNoiseTexture(device) {
    const texture = device.createTexture({
        label: "NoiseTexture.dummy",
        size: { width: 1, height: 1, depthOrArrayLayers: 1 },
        format: 'rgba16float',
        dimension: '3d',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const view = texture.createView({ label: "NoiseTexture.dummyView" });

    const sampler = device.createSampler({
        label: "NoiseTexture.dummySampler",
        magFilter: 'linear',
        minFilter: 'linear',
    });

    const paramsBuffer = createUniformBuffer(device, 16, { label: "NoiseTexture.dummyParams" });
    // Disabled: uvScale=0, enabled=0
    updateBuffer(device, paramsBuffer, new Float32Array([0.0, 0.0, 0.0, 0.0]), 0);

    return { texture, textureView: view, sampler, paramsBuffer };
}

/**
 * Destroy noise texture system resources.
 */
export function destroyNoiseTextureSystem(system) {
    if (!system) return;
    if (system.potentialTexture) system.potentialTexture.destroy();
    if (system.noiseTexture) system.noiseTexture.destroy();
    if (system.bakeParamsBuffer) system.bakeParamsBuffer.destroy();
    if (system.noiseParamsBuffer) system.noiseParamsBuffer.destroy();
}
