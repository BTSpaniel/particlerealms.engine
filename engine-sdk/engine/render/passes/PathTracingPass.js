// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import { rayTracingWGSL } from '../shaders/modules/chunks/ray_tracing.js';

const PATH_TRACING_UNIFORM_FLOATS = 64;
const PATH_TRACING_OUTPUT_FORMAT = 'rgba16float';
const IDENTITY_MATRIX = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
]);

export const PATH_TRACING_PCG_HASH_WGSL = /* wgsl */ `
fn pcgHash(input : u32) -> u32 {
    return legacyPcgHash32(input);
}
`;

const PATH_TRACING_SHADER = /* wgsl */ `
struct PathTracingUniforms {
    invViewProj: mat4x4<f32>,
    cameraPos: vec4<f32>,
    sunDir: vec4<f32>,
    sunColor: vec4<f32>,
    skyColor: vec4<f32>,
    horizonColor: vec4<f32>,
    groundColor: vec4<f32>,
    resolution: vec2<f32>,
    frameIndex: f32,
    samplesPerPixel: f32,
    environmentIntensity: f32,
    indirectIntensity: f32,
    normalBias: f32,
    roughnessMin: f32,
    maxRayDistance: f32,
    cameraCut: f32,
    accumulationBlend: f32,
    fireflyClamp: f32,
    temporalEnabled: f32,
    historyValid: f32,
    denoiseEnabled: f32,
    spatialDenoiseStrength: f32,
    varianceDenoiseStrength: f32,
    edgeStopStrength: f32,
    roughnessDenoiseStrength: f32,
    historyReactiveThreshold: f32,
    historyVarianceScale: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
}

@group(0) @binding(0) var<uniform> u: PathTracingUniforms;
@group(0) @binding(1) var depthTexture: texture_2d<f32>;
@group(0) @binding(2) var normalTexture: texture_2d<f32>;
@group(0) @binding(3) var albedoTexture: texture_2d<f32>;
@group(0) @binding(4) var roughMetalTexture: texture_2d<f32>;
@group(0) @binding(5) var outputTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var linearSampler: sampler;

${rayTracingWGSL}
${PATH_TRACING_PCG_HASH_WGSL}

fn radicalInverseVdc(bitsIn : u32) -> f32 {
    var bits = bitsIn;
    bits = (bits << 16u) | (bits >> 16u);
    bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
    bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
    bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
    bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
    return f32(bits) * 2.3283064365386963e-10;
}

fn stableFrameSeed(pixel : vec2<u32>, frameIndex : u32) -> u32 {
    let pixelHash = pcgHash(pixel.x + pcgHash(pixel.y));
    let sequence = frameIndex & 63u;
    let lowDiscrepancy = u32(radicalInverseVdc(sequence + pixelHash) * 4294967295.0);
    return pcgHash(pixelHash ^ lowDiscrepancy ^ (sequence * 1013904223u));
}

fn safeNormalize(v: vec3<f32>, fallback: vec3<f32>) -> vec3<f32> {
    let len2 = dot(v, v);
    if (len2 < 1e-8) {
        return fallback;
    }
    return v * inverseSqrt(len2);
}

fn decodeNormal(encoded: vec3<f32>) -> vec3<f32> {
    return safeNormalize(encoded * 2.0 - 1.0, vec3<f32>(0.0, 1.0, 0.0));
}

fn reconstructWorldPosition(uv: vec2<f32>, depth: f32) -> vec3<f32> {
    let clip = vec4<f32>(uv * 2.0 - 1.0, depth, 1.0);
    let world = u.invViewProj * clip;
    return world.xyz / max(world.w, 1e-5);
}

fn cameraRayDirection(uv: vec2<f32>) -> vec3<f32> {
    let farWorld = reconstructWorldPosition(uv, 0.99999);
    return safeNormalize(farWorld - u.cameraPos.xyz, vec3<f32>(0.0, 0.0, -1.0));
}

fn sampleEnvironment(rayDir: vec3<f32>) -> vec3<f32> {
    let sunDir = safeNormalize(u.sunDir.xyz, vec3<f32>(0.35, 0.82, 0.44));
    var color = sampleSkyGradient(rayDir, u.skyColor.xyz, u.horizonColor.xyz, u.groundColor.xyz);
    let sunDot = dot(rayDir, sunDir);
    let sunDisk = smoothstep(0.9995, 0.9999, sunDot);
    let sunGlow = pow(max(sunDot, 0.0), 8.0);
    color = color + u.sunColor.xyz * (sunDisk * 10.0 + sunGlow * 0.5);
    return color * u.environmentIntensity;
}

fn estimateIndirect(
    worldPos: vec3<f32>,
    normal: vec3<f32>,
    viewDir: vec3<f32>,
    albedo: vec3<f32>,
    roughMetal: vec3<f32>,
    seed: ptr<function, u32>
) -> vec3<f32> {
    let roughness = clamp(roughMetal.g, u.roughnessMin, 1.0);
    let metallic = clamp(roughMetal.b, 0.0, 1.0);
    let ndv = max(dot(normal, -viewDir), 0.0);
    let f0 = mix(vec3<f32>(0.04), albedo, vec3<f32>(metallic));
    let spp = max(i32(u.samplesPerPixel), 1);
    let distanceToCamera = length(worldPos - u.cameraPos.xyz);
    let distanceFade = 1.0 - smoothstep(u.maxRayDistance * 0.25, u.maxRayDistance, distanceToCamera);
    var radiance = vec3<f32>(0.0);

    for (var i = 0; i < 16; i = i + 1) {
        if (i >= spp) {
            break;
        }

        var sampleSeed = pcgHash(*seed + u32(i) * 1597334677u + pcgHash(u32(i + 1) * 747796405u));
        let diffuseDir = sampleHemisphereCosine(normal, &sampleSeed);
        let halfVec = sampleGGX(normal, roughness, &sampleSeed);
        var specDir = safeNormalize(reflect(viewDir, halfVec), reflect(viewDir, normal));
        if (dot(specDir, normal) <= 0.0) {
            specDir = reflect(viewDir, normal);
        }

        let diffuseLight = sampleEnvironment(diffuseDir) * albedo * (1.0 - metallic) * max(dot(normal, diffuseDir), 0.0);
        let specularLight = sampleEnvironment(specDir) * fresnelSchlickVec(ndv, f0);
        radiance = radiance + (diffuseLight + specularLight) * distanceFade;
    }

    return radiance / f32(spp) * u.indirectIntensity;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dims = vec2<u32>(u32(u.resolution.x), u32(u.resolution.y));
    if (gid.x >= dims.x || gid.y >= dims.y) {
        return;
    }

    let coord = vec2<i32>(gid.xy);
    let uv = (vec2<f32>(gid.xy) + 0.5) / u.resolution;
    let depth = textureLoad(depthTexture, coord, 0).r;
    var seed = stableFrameSeed(gid.xy, u32(u.frameIndex) + u32(u.cameraCut) * 977u);

    if (depth >= 0.99999) {
        let skyDir = cameraRayDirection(uv);
        let skyColor = sampleEnvironment(skyDir);
        textureStore(outputTex, coord, vec4<f32>(min(skyColor, vec3<f32>(u.fireflyClamp)), 1.0));
        return;
    }

    let worldPos = reconstructWorldPosition(uv, depth);
    let normal = decodeNormal(textureSampleLevel(normalTexture, linearSampler, uv, 0.0).xyz);
    let albedo = textureSampleLevel(albedoTexture, linearSampler, uv, 0.0).rgb;
    let roughMetal = textureSampleLevel(roughMetalTexture, linearSampler, uv, 0.0).rgb;
    let viewDir = safeNormalize(worldPos - u.cameraPos.xyz, vec3<f32>(0.0, 0.0, -1.0));
    let color = min(estimateIndirect(worldPos + normal * u.normalBias, normal, viewDir, albedo, roughMetal, &seed), vec3<f32>(u.fireflyClamp));

    textureStore(outputTex, coord, vec4<f32>(color, 1.0));
}
`;

const PATH_TRACING_ACCUMULATION_SHADER = /* wgsl */ `
struct PathTracingUniforms {
    invViewProj: mat4x4<f32>,
    cameraPos: vec4<f32>,
    sunDir: vec4<f32>,
    sunColor: vec4<f32>,
    skyColor: vec4<f32>,
    horizonColor: vec4<f32>,
    groundColor: vec4<f32>,
    resolution: vec2<f32>,
    frameIndex: f32,
    samplesPerPixel: f32,
    environmentIntensity: f32,
    indirectIntensity: f32,
    normalBias: f32,
    roughnessMin: f32,
    maxRayDistance: f32,
    cameraCut: f32,
    accumulationBlend: f32,
    fireflyClamp: f32,
    temporalEnabled: f32,
    historyValid: f32,
    denoiseEnabled: f32,
    spatialDenoiseStrength: f32,
    varianceDenoiseStrength: f32,
    edgeStopStrength: f32,
    roughnessDenoiseStrength: f32,
    historyReactiveThreshold: f32,
    historyVarianceScale: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
}

@group(0) @binding(0) var<uniform> u: PathTracingUniforms;
@group(0) @binding(1) var currentTex: texture_2d<f32>;
@group(0) @binding(2) var prevHistoryTex: texture_2d<f32>;
@group(0) @binding(3) var depthTexture: texture_2d<f32>;
@group(0) @binding(4) var prevDepthTexture: texture_2d<f32>;
@group(0) @binding(5) var outputTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var nextHistoryTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var nextDepthTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(8) var normalTexture: texture_2d<f32>;
@group(0) @binding(9) var roughMetalTexture: texture_2d<f32>;

fn luminancePT(c : vec3<f32>) -> f32 {
    return max(dot(c, vec3<f32>(0.2126, 0.7152, 0.0722)), 1e-4);
}

fn normalizePT(v: vec3<f32>) -> vec3<f32> {
    let len2 = dot(v, v);
    if (len2 < 1e-8) {
        return vec3<f32>(0.0, 1.0, 0.0);
    }
    return v * inverseSqrt(len2);
}

fn decodeNormalPT(encoded: vec3<f32>) -> vec3<f32> {
    return normalizePT(encoded * 2.0 - 1.0);
}

fn edgeStopPT(centerColor: vec3<f32>, sampleColor: vec3<f32>, centerNormal: vec3<f32>, sampleNormal: vec3<f32>, centerDepth: f32, sampleDepth: f32) -> f32 {
    let edge = max(u.edgeStopStrength, 0.0001);
    let lumW = exp(-abs(luminancePT(centerColor) - luminancePT(sampleColor)) * edge);
    let colorW = exp(-length(centerColor - sampleColor) * edge * 0.35);
    let normalW = exp(-max(1.0 - dot(centerNormal, sampleNormal), 0.0) * edge * 4.0);
    let depthW = exp(-abs(centerDepth - sampleDepth) * edge / max(abs(centerDepth) * 0.025, 0.0005));
    return lumW * colorW * normalW * depthW;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let dims = vec2<u32>(u32(u.resolution.x), u32(u.resolution.y));
    if (gid.x >= dims.x || gid.y >= dims.y) {
        return;
    }

    let coord = vec2<i32>(gid.xy);
    let maxCoord = vec2<i32>(i32(dims.x) - 1, i32(dims.y) - 1);
    let current = min(textureLoad(currentTex, coord, 0).rgb, vec3<f32>(u.fireflyClamp));
    let previous = textureLoad(prevHistoryTex, coord, 0).rgb;
    let depth = textureLoad(depthTexture, coord, 0).r;
    let prevDepth = textureLoad(prevDepthTexture, coord, 0).r;
    let centerNormal = decodeNormalPT(textureLoad(normalTexture, coord, 0).rgb);
    let roughness = clamp(textureLoad(roughMetalTexture, coord, 0).g, u.roughnessMin, 1.0);
    let pR = clamp(coord + vec2<i32>(1, 0), vec2<i32>(0), maxCoord);
    let pL = clamp(coord + vec2<i32>(-1, 0), vec2<i32>(0), maxCoord);
    let pU = clamp(coord + vec2<i32>(0, 1), vec2<i32>(0), maxCoord);
    let pD = clamp(coord + vec2<i32>(0, -1), vec2<i32>(0), maxCoord);
    let pR2 = clamp(coord + vec2<i32>(2, 0), vec2<i32>(0), maxCoord);
    let pL2 = clamp(coord + vec2<i32>(-2, 0), vec2<i32>(0), maxCoord);
    let pU2 = clamp(coord + vec2<i32>(0, 2), vec2<i32>(0), maxCoord);
    let pD2 = clamp(coord + vec2<i32>(0, -2), vec2<i32>(0), maxCoord);
    let pR4 = clamp(coord + vec2<i32>(4, 0), vec2<i32>(0), maxCoord);
    let pL4 = clamp(coord + vec2<i32>(-4, 0), vec2<i32>(0), maxCoord);
    let pU4 = clamp(coord + vec2<i32>(0, 4), vec2<i32>(0), maxCoord);
    let pD4 = clamp(coord + vec2<i32>(0, -4), vec2<i32>(0), maxCoord);
    let cR = min(textureLoad(currentTex, pR, 0).rgb, vec3<f32>(u.fireflyClamp));
    let cL = min(textureLoad(currentTex, pL, 0).rgb, vec3<f32>(u.fireflyClamp));
    let cU = min(textureLoad(currentTex, pU, 0).rgb, vec3<f32>(u.fireflyClamp));
    let cD = min(textureLoad(currentTex, pD, 0).rgb, vec3<f32>(u.fireflyClamp));
    let cR2 = min(textureLoad(currentTex, pR2, 0).rgb, vec3<f32>(u.fireflyClamp));
    let cL2 = min(textureLoad(currentTex, pL2, 0).rgb, vec3<f32>(u.fireflyClamp));
    let cU2 = min(textureLoad(currentTex, pU2, 0).rgb, vec3<f32>(u.fireflyClamp));
    let cD2 = min(textureLoad(currentTex, pD2, 0).rgb, vec3<f32>(u.fireflyClamp));
    let cR4 = min(textureLoad(currentTex, pR4, 0).rgb, vec3<f32>(u.fireflyClamp));
    let cL4 = min(textureLoad(currentTex, pL4, 0).rgb, vec3<f32>(u.fireflyClamp));
    let cU4 = min(textureLoad(currentTex, pU4, 0).rgb, vec3<f32>(u.fireflyClamp));
    let cD4 = min(textureLoad(currentTex, pD4, 0).rgb, vec3<f32>(u.fireflyClamp));
    let nR = decodeNormalPT(textureLoad(normalTexture, pR, 0).rgb);
    let nL = decodeNormalPT(textureLoad(normalTexture, pL, 0).rgb);
    let nU = decodeNormalPT(textureLoad(normalTexture, pU, 0).rgb);
    let nD = decodeNormalPT(textureLoad(normalTexture, pD, 0).rgb);
    let wR = edgeStopPT(current, cR, centerNormal, nR, depth, textureLoad(depthTexture, pR, 0).r) * 0.12;
    let wL = edgeStopPT(current, cL, centerNormal, nL, depth, textureLoad(depthTexture, pL, 0).r) * 0.12;
    let wU = edgeStopPT(current, cU, centerNormal, nU, depth, textureLoad(depthTexture, pU, 0).r) * 0.12;
    let wD = edgeStopPT(current, cD, centerNormal, nD, depth, textureLoad(depthTexture, pD, 0).r) * 0.12;
    let wR2 = edgeStopPT(current, cR2, centerNormal, decodeNormalPT(textureLoad(normalTexture, pR2, 0).rgb), depth, textureLoad(depthTexture, pR2, 0).r) * 0.065;
    let wL2 = edgeStopPT(current, cL2, centerNormal, decodeNormalPT(textureLoad(normalTexture, pL2, 0).rgb), depth, textureLoad(depthTexture, pL2, 0).r) * 0.065;
    let wU2 = edgeStopPT(current, cU2, centerNormal, decodeNormalPT(textureLoad(normalTexture, pU2, 0).rgb), depth, textureLoad(depthTexture, pU2, 0).r) * 0.065;
    let wD2 = edgeStopPT(current, cD2, centerNormal, decodeNormalPT(textureLoad(normalTexture, pD2, 0).rgb), depth, textureLoad(depthTexture, pD2, 0).r) * 0.065;
    let wR4 = edgeStopPT(current, cR4, centerNormal, decodeNormalPT(textureLoad(normalTexture, pR4, 0).rgb), depth, textureLoad(depthTexture, pR4, 0).r) * 0.032;
    let wL4 = edgeStopPT(current, cL4, centerNormal, decodeNormalPT(textureLoad(normalTexture, pL4, 0).rgb), depth, textureLoad(depthTexture, pL4, 0).r) * 0.032;
    let wU4 = edgeStopPT(current, cU4, centerNormal, decodeNormalPT(textureLoad(normalTexture, pU4, 0).rgb), depth, textureLoad(depthTexture, pU4, 0).r) * 0.032;
    let wD4 = edgeStopPT(current, cD4, centerNormal, decodeNormalPT(textureLoad(normalTexture, pD4, 0).rgb), depth, textureLoad(depthTexture, pD4, 0).r) * 0.032;
    let centerW = 0.36;
    let spatialW = centerW + wR + wL + wU + wD + wR2 + wL2 + wU2 + wD2 + wR4 + wL4 + wU4 + wD4;
    let spatialColor = (current * centerW + cR * wR + cL * wL + cU * wU + cD * wD + cR2 * wR2 + cL2 * wL2 + cU2 * wU2 + cD2 * wD2 + cR4 * wR4 + cL4 * wL4 + cU4 * wU4 + cD4 * wD4) / max(spatialW, 0.0001);
    let l0 = luminancePT(current);
    let localMean = (l0 * centerW + luminancePT(cR) * wR + luminancePT(cL) * wL + luminancePT(cU) * wU + luminancePT(cD) * wD) / max(centerW + wR + wL + wU + wD, 0.0001);
    let localSq = (l0 * l0 * centerW + luminancePT(cR) * luminancePT(cR) * wR + luminancePT(cL) * luminancePT(cL) * wL + luminancePT(cU) * luminancePT(cU) * wU + luminancePT(cD) * luminancePT(cD) * wD) / max(centerW + wR + wL + wU + wD, 0.0001);
    let localVariance = max(localSq - localMean * localMean, 0.0);
    let varianceMix = clamp(sqrt(localVariance) * u.varianceDenoiseStrength, 0.0, 1.0);
    let glossyMix = clamp((1.0 - roughness) * u.roughnessDenoiseStrength, 0.0, 1.0);
    let spatialAmount = select(0.0, clamp(u.spatialDenoiseStrength * (varianceMix * 0.7 + glossyMix * 0.3), 0.0, 0.88), u.denoiseEnabled > 0.5);
    let currentResolved = mix(current, spatialColor, spatialAmount);
    let skyStable = depth >= 0.99999 && prevDepth >= 0.99999;
    let surfaceStable = depth < 0.99999 && abs(depth - prevDepth) <= max(0.0015, depth * 0.01);
    let valid = u.temporalEnabled > 0.5 && u.historyValid > 0.5 && u.cameraCut < 0.5 && (skyStable || surfaceStable);
    let currentLum = luminancePT(currentResolved);
    let prevLum = luminancePT(previous);
    let ratio = max(currentLum, prevLum) / max(min(currentLum, prevLum), 1e-4);
    let stableLum = ratio < max(u.historyReactiveThreshold, 1.1);
    let reactive = clamp((ratio - 1.0) / max(u.historyReactiveThreshold - 1.0, 0.001), 0.0, 1.0);
    let range = max(abs(currentResolved) * (0.45 + localVariance * u.historyVarianceScale), vec3<f32>(0.035));
    let clampedPrevious = clamp(previous, currentResolved - range, currentResolved + range);
    let historyBase = clamp(u.accumulationBlend, 0.0, 0.96) * (1.0 - reactive * 0.75) * (1.0 - varianceMix * 0.25);
    let historyWeight = select(0.0, historyBase, valid && stableLum);
    let resolved = min(mix(currentResolved, clampedPrevious, historyWeight), vec3<f32>(u.fireflyClamp));
    textureStore(outputTex, coord, vec4<f32>(resolved, 1.0));
    textureStore(nextHistoryTex, coord, vec4<f32>(resolved, 1.0));
    textureStore(nextDepthTex, coord, vec4<f32>(depth, depth, depth, 1.0));
}
`;

export class PathTracingPass {
    constructor(device) {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.initialized = false;
        this.enabled = true;
        this.width = 1;
        this.height = 1;
        this.frameIndex = 0;
        this.samplesPerPixel = 1;
        this.environmentIntensity = 1.0;
        this.indirectIntensity = 1.0;
        this.normalBias = 0.05;
        this.roughnessMin = 0.04;
        this.maxRayDistance = 100.0;
        this.accumulationBlend = 0.9;
        this.fireflyClamp = 8.0;
        this.temporalEnabled = true;
        this.denoiseEnabled = true;
        this.spatialDenoiseStrength = 0.85;
        this.varianceDenoiseStrength = 3.0;
        this.edgeStopStrength = 3.0;
        this.roughnessDenoiseStrength = 0.55;
        this.historyReactiveThreshold = 3.0;
        this.historyVarianceScale = 1.6;
        this.historyValid = false;
        this.cameraCut = false;
        this.invViewProj = new Float32Array(IDENTITY_MATRIX);
        this.cameraPosition = new Float32Array([0, 0, 0, 1]);
        this.sunDirection = new Float32Array([0.35, 0.82, 0.44, 0]);
        this.sunColor = new Float32Array([4.0, 3.8, 3.6, 1.0]);
        this.skyColor = new Float32Array([0.4, 0.6, 1.0, 1.0]);
        this.horizonColor = new Float32Array([0.8, 0.85, 0.9, 1.0]);
        this.groundColor = new Float32Array([0.3, 0.25, 0.2, 1.0]);
        this.pipeline = null;
        this.accumulationPipeline = null;
        this.uniformBuffer = null;
        this.sampler = null;
        this.outputTexture = null;
        this.candidateTexture = null;
        this.historyTextures = [null, null];
        this.depthHistoryTextures = [null, null];
        this.currentHistoryIndex = 0;
        this._fallbackDepthTexture = null;
        this._fallbackNormalTexture = null;
        this._fallbackAlbedoTexture = null;
        this._fallbackRoughMetalTexture = null;
        this._uniformData = new Float32Array(PATH_TRACING_UNIFORM_FLOATS);
    }

    async init(width, height) {
        this.width = width;
        this.height = height;
        this.uniformBuffer = this.vgpu.buffer.create({
            size: PATH_TRACING_UNIFORM_FLOATS * 4,
            usage: 'uniform',
            label: 'PathTracingPassUniforms',
        }).buffer;
        this.sampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
            label: 'PathTracingPassSampler',
        });
        this._createFallbackTextures();
        this._createOutputTextures();
        const shaderModule = this.vgpu.shader.compile('path_tracing_pass', PATH_TRACING_SHADER);
        const accumulationModule = this.vgpu.shader.compile('path_tracing_accumulation', PATH_TRACING_ACCUMULATION_SHADER);
        this.pipeline = this.vgpu.pipeline.compute({
            module: shaderModule,
            entryPoint: 'main',
            label: 'PathTracingPass',
        });
        this.accumulationPipeline = this.vgpu.pipeline.compute({
            module: accumulationModule,
            entryPoint: 'main',
            label: 'PathTracingAccumulationPass',
        });
        this.initialized = true;
        this.updateUniforms();
        console.log(`[PathTracingPass] Initialized: ${width}×${height}`);
    }

    _createTexture(label) {
        return this.vgpu.texture.create({
            width: this.width,
            height: this.height,
            format: PATH_TRACING_OUTPUT_FORMAT,
            usage: 'texture|storage|copy-dst|copy-src',
            label,
        }).texture;
    }

    _createOutputTextures() {
        this.outputTexture?.destroy();
        this.candidateTexture?.destroy();
        for (const texture of this.historyTextures) texture?.destroy();
        for (const texture of this.depthHistoryTextures) texture?.destroy();
        this.outputTexture = this._createTexture('PathTracingPassOutput');
        this.candidateTexture = this._createTexture('PathTracingPassCandidate');
        this.historyTextures = [
            this._createTexture('PathTracingHistory0'),
            this._createTexture('PathTracingHistory1'),
        ];
        this.depthHistoryTextures = [
            this._createTexture('PathTracingDepthHistory0'),
            this._createTexture('PathTracingDepthHistory1'),
        ];
        this.currentHistoryIndex = 0;
        this.historyValid = false;
    }

    _createFallbackTextures() {
        if (!this._fallbackDepthTexture) {
            this._fallbackDepthTexture = this.device.createTexture({
                size: [1, 1, 1],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                label: 'PathTracingFallbackDepth',
            });
            this.device.queue.writeTexture(
                { texture: this._fallbackDepthTexture },
                new Uint8Array([255, 255, 255, 255]),
                { bytesPerRow: 4 },
                { width: 1, height: 1, depthOrArrayLayers: 1 },
            );
        }

        if (!this._fallbackNormalTexture) {
            this._fallbackNormalTexture = this.device.createTexture({
                size: [1, 1, 1],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                label: 'PathTracingFallbackNormal',
            });
            this.device.queue.writeTexture(
                { texture: this._fallbackNormalTexture },
                new Uint8Array([128, 128, 255, 255]),
                { bytesPerRow: 4 },
                { width: 1, height: 1, depthOrArrayLayers: 1 },
            );
        }

        if (!this._fallbackAlbedoTexture) {
            this._fallbackAlbedoTexture = this.device.createTexture({
                size: [1, 1, 1],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                label: 'PathTracingFallbackAlbedo',
            });
            this.device.queue.writeTexture(
                { texture: this._fallbackAlbedoTexture },
                new Uint8Array([255, 255, 255, 255]),
                { bytesPerRow: 4 },
                { width: 1, height: 1, depthOrArrayLayers: 1 },
            );
        }

        if (!this._fallbackRoughMetalTexture) {
            this._fallbackRoughMetalTexture = this.device.createTexture({
                size: [1, 1, 1],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                label: 'PathTracingFallbackRoughMetal',
            });
            this.device.queue.writeTexture(
                { texture: this._fallbackRoughMetalTexture },
                new Uint8Array([0, 255, 0, 255]),
                { bytesPerRow: 4 },
                { width: 1, height: 1, depthOrArrayLayers: 1 },
            );
        }
    }

    resize(width, height) {
        if (width === this.width && height === this.height) {
            return;
        }
        this.width = width;
        this.height = height;
        if (this.initialized) {
            this._createOutputTextures();
            this.updateUniforms();
        }
        console.log(`[PathTracingPass] Resized: ${width}×${height}`);
    }

    setSize(width, height) {
        this.resize(width, height);
    }

    signalCameraCut() {
        this.cameraCut = true;
        this.frameIndex = 0;
        this.historyValid = false;
    }

    _setVec4(target, value, fallbackW = 1.0) {
        if (!value) {
            return;
        }
        target[0] = value[0] ?? target[0];
        target[1] = value[1] ?? target[1];
        target[2] = value[2] ?? target[2];
        target[3] = value[3] ?? fallbackW;
    }

    _applyOptions(options = {}) {
        if (options.invViewProj) {
            this.invViewProj.set(options.invViewProj);
        }
        if (options.cameraPosition) {
            this._setVec4(this.cameraPosition, options.cameraPosition, 1.0);
        }
        if (options.sunDirection) {
            this._setVec4(this.sunDirection, options.sunDirection, 0.0);
        }
        if (options.sunColor) {
            this._setVec4(this.sunColor, options.sunColor, 1.0);
        }
        if (options.skyColor) {
            this._setVec4(this.skyColor, options.skyColor, 1.0);
        }
        if (options.horizonColor) {
            this._setVec4(this.horizonColor, options.horizonColor, 1.0);
        }
        if (options.groundColor) {
            this._setVec4(this.groundColor, options.groundColor, 1.0);
        }
        if (options.samplesPerPixel !== undefined) {
            this.samplesPerPixel = Math.max(1, Math.min(16, Math.floor(options.samplesPerPixel)));
        }
        if (options.environmentIntensity !== undefined) {
            this.environmentIntensity = Math.max(0.0, Number(options.environmentIntensity));
        }
        if (options.indirectIntensity !== undefined) {
            this.indirectIntensity = Math.max(0.0, Number(options.indirectIntensity));
        }
        if (options.normalBias !== undefined) {
            this.normalBias = Math.max(0.0001, Number(options.normalBias));
        }
        if (options.roughnessMin !== undefined) {
            this.roughnessMin = Math.min(1.0, Math.max(0.001, Number(options.roughnessMin)));
        }
        if (options.maxRayDistance !== undefined) {
            this.maxRayDistance = Math.max(1.0, Number(options.maxRayDistance));
        }
        if (options.accumulationBlend !== undefined) {
            this.accumulationBlend = Math.min(0.98, Math.max(0.0, Number(options.accumulationBlend)));
        }
        if (options.fireflyClamp !== undefined) {
            this.fireflyClamp = Math.max(0.1, Number(options.fireflyClamp));
        }
        if (options.temporalEnabled !== undefined) {
            this.temporalEnabled = options.temporalEnabled !== false;
        }
        if (options.denoiseEnabled !== undefined) {
            this.denoiseEnabled = options.denoiseEnabled !== false;
        }
        if (options.spatialDenoiseStrength !== undefined) {
            this.spatialDenoiseStrength = Math.min(1.5, Math.max(0.0, Number(options.spatialDenoiseStrength)));
        }
        if (options.varianceDenoiseStrength !== undefined) {
            this.varianceDenoiseStrength = Math.min(12.0, Math.max(0.0, Number(options.varianceDenoiseStrength)));
        }
        if (options.edgeStopStrength !== undefined) {
            this.edgeStopStrength = Math.min(24.0, Math.max(0.01, Number(options.edgeStopStrength)));
        }
        if (options.roughnessDenoiseStrength !== undefined) {
            this.roughnessDenoiseStrength = Math.min(2.0, Math.max(0.0, Number(options.roughnessDenoiseStrength)));
        }
        if (options.historyReactiveThreshold !== undefined) {
            this.historyReactiveThreshold = Math.min(12.0, Math.max(1.05, Number(options.historyReactiveThreshold)));
        }
        if (options.historyVarianceScale !== undefined) {
            this.historyVarianceScale = Math.min(8.0, Math.max(0.0, Number(options.historyVarianceScale)));
        }
        if (options.width !== undefined && options.height !== undefined) {
            this.resize(options.width, options.height);
        }
    }

    updateUniforms(options = {}) {
        this._applyOptions(options);
        if (!this.uniformBuffer) {
            return;
        }

        const data = this._uniformData;
        data.set(this.invViewProj, 0);
        data.set(this.cameraPosition, 16);
        data.set(this.sunDirection, 20);
        data.set(this.sunColor, 24);
        data.set(this.skyColor, 28);
        data.set(this.horizonColor, 32);
        data.set(this.groundColor, 36);
        data[40] = this.width;
        data[41] = this.height;
        data[42] = this.frameIndex;
        data[43] = this.samplesPerPixel;
        data[44] = this.environmentIntensity;
        data[45] = this.indirectIntensity;
        data[46] = this.normalBias;
        data[47] = this.roughnessMin;
        data[48] = this.maxRayDistance;
        data[49] = this.cameraCut ? 1.0 : 0.0;
        data[50] = this.accumulationBlend;
        data[51] = this.fireflyClamp;
        data[52] = this.temporalEnabled ? 1.0 : 0.0;
        data[53] = this.historyValid ? 1.0 : 0.0;
        data[54] = this.denoiseEnabled ? 1.0 : 0.0;
        data[55] = this.spatialDenoiseStrength;
        data[56] = this.varianceDenoiseStrength;
        data[57] = this.edgeStopStrength;
        data[58] = this.roughnessDenoiseStrength;
        data[59] = this.historyReactiveThreshold;
        data[60] = this.historyVarianceScale;
        data[61] = 0.0;
        data[62] = 0.0;
        data[63] = 0.0;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }

    execute(encoder, options = {}) {
        if (!this.initialized || !this.enabled || !encoder) {
            return this.outputTexture;
        }

        this.updateUniforms(options);

        const outputTexture = options.outputTexture || this.outputTexture;
        const depthTexture = options.depthTexture || this._fallbackDepthTexture;
        const normalTexture = options.normalTexture || this._fallbackNormalTexture;
        const albedoTexture = options.albedoTexture || this._fallbackAlbedoTexture;
        const roughMetalTexture = options.roughMetalTexture || this._fallbackRoughMetalTexture;
        const prevIndex = this.currentHistoryIndex;
        const nextIndex = 1 - prevIndex;
        const prevHistoryTexture = this.historyTextures[prevIndex];
        const nextHistoryTexture = this.historyTextures[nextIndex];
        const prevDepthTexture = this.depthHistoryTextures[prevIndex];
        const nextDepthTexture = this.depthHistoryTextures[nextIndex];

        const bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: depthTexture.createView() },
                { binding: 2, resource: normalTexture.createView() },
                { binding: 3, resource: albedoTexture.createView() },
                { binding: 4, resource: roughMetalTexture.createView() },
                { binding: 5, resource: this.candidateTexture.createView() },
                { binding: 6, resource: this.sampler },
            ],
        });

        const pass = encoder.beginComputePass({ label: 'PathTracingPass' });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8));
        pass.end();

        const accumulationBindGroup = this.device.createBindGroup({
            layout: this.accumulationPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: this.candidateTexture.createView() },
                { binding: 2, resource: prevHistoryTexture.createView() },
                { binding: 3, resource: depthTexture.createView() },
                { binding: 4, resource: prevDepthTexture.createView() },
                { binding: 5, resource: outputTexture.createView() },
                { binding: 6, resource: nextHistoryTexture.createView() },
                { binding: 7, resource: nextDepthTexture.createView() },
                { binding: 8, resource: normalTexture.createView() },
                { binding: 9, resource: roughMetalTexture.createView() },
            ],
        });

        const accumulationPass = encoder.beginComputePass({ label: 'PathTracingAccumulationPass' });
        accumulationPass.setPipeline(this.accumulationPipeline);
        accumulationPass.setBindGroup(0, accumulationBindGroup);
        accumulationPass.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8));
        accumulationPass.end();

        this.currentHistoryIndex = nextIndex;
        this.historyValid = true;
        this.frameIndex = (this.frameIndex + 1) % 1048576;
        this.cameraCut = false;
        return outputTexture;
    }

    getOutputTexture() {
        return this.outputTexture;
    }

    loadConfig(cfg) {
        if (!cfg) {
            return;
        }
        if (cfg.enabled !== undefined) this.enabled = cfg.enabled !== false;
        if (cfg.samples_per_pixel !== undefined) this.samplesPerPixel = Math.max(1, Math.min(16, parseInt(cfg.samples_per_pixel, 10) || 1));
        if (cfg.environment_intensity !== undefined) this.environmentIntensity = Math.max(0.0, parseFloat(cfg.environment_intensity) || 0.0);
        if (cfg.indirect_intensity !== undefined) this.indirectIntensity = Math.max(0.0, parseFloat(cfg.indirect_intensity) || 0.0);
        if (cfg.normal_bias !== undefined) this.normalBias = Math.max(0.0001, parseFloat(cfg.normal_bias) || 0.05);
        if (cfg.roughness_min !== undefined) this.roughnessMin = Math.min(1.0, Math.max(0.001, parseFloat(cfg.roughness_min) || 0.04));
        if (cfg.max_ray_distance !== undefined) this.maxRayDistance = Math.max(1.0, parseFloat(cfg.max_ray_distance) || 100.0);
        if (cfg.accumulation_blend !== undefined) this.accumulationBlend = Math.min(0.98, Math.max(0.0, parseFloat(cfg.accumulation_blend) || 0.0));
        if (cfg.firefly_clamp !== undefined) this.fireflyClamp = Math.max(0.1, parseFloat(cfg.firefly_clamp) || 8.0);
        if (cfg.temporal_enabled !== undefined) this.temporalEnabled = cfg.temporal_enabled !== false;
        if (cfg.denoise_enabled !== undefined) this.denoiseEnabled = cfg.denoise_enabled !== false;
        if (cfg.spatial_denoise_strength !== undefined) this.spatialDenoiseStrength = Math.min(1.5, Math.max(0.0, parseFloat(cfg.spatial_denoise_strength) || 0.0));
        if (cfg.variance_denoise_strength !== undefined) this.varianceDenoiseStrength = Math.min(12.0, Math.max(0.0, parseFloat(cfg.variance_denoise_strength) || 0.0));
        if (cfg.edge_stop_strength !== undefined) this.edgeStopStrength = Math.min(24.0, Math.max(0.01, parseFloat(cfg.edge_stop_strength) || 3.0));
        if (cfg.roughness_denoise_strength !== undefined) this.roughnessDenoiseStrength = Math.min(2.0, Math.max(0.0, parseFloat(cfg.roughness_denoise_strength) || 0.0));
        if (cfg.history_reactive_threshold !== undefined) this.historyReactiveThreshold = Math.min(12.0, Math.max(1.05, parseFloat(cfg.history_reactive_threshold) || 3.0));
        if (cfg.history_variance_scale !== undefined) this.historyVarianceScale = Math.min(8.0, Math.max(0.0, parseFloat(cfg.history_variance_scale) || 0.0));
    }

    destroy() {
        this.outputTexture?.destroy();
        this.candidateTexture?.destroy();
        this.uniformBuffer?.destroy();
        this._fallbackDepthTexture?.destroy();
        this._fallbackNormalTexture?.destroy();
        this._fallbackAlbedoTexture?.destroy();
        this._fallbackRoughMetalTexture?.destroy();
        for (const texture of this.historyTextures) texture?.destroy();
        for (const texture of this.depthHistoryTextures) texture?.destroy();
        this.initialized = false;
    }
}

export default PathTracingPass;
