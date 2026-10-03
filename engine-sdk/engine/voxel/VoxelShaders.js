// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * VoxelShaders.js - WGSL shader strings for VoxelRenderer
 * Extracted from VoxelRenderer.js for modularity
 */

import { COMPACT_VERTEX_SHADER } from './VoxelMeshCompute.js';
import { FACE_PULL_SHADER_BASE } from './FaceListMesher.js';
import { TEXTURE_ARRAY_WGSL_GROUP2 } from './TextureArrayManager.js';
import { calcWGSLStructSize, getFloat32ArraySize } from '../core/gpu/WGSLStructSize.js';

// Shadow map resolution
export const SHADOW_MAP_SIZE = 1024;

// ============================================================================
// FRAME UNIFORMS STRUCT
// ============================================================================

export const FRAME_UNIFORMS_STRUCT = /* wgsl */ `
struct FrameUniforms {
    viewProj: mat4x4<f32>,
    view: mat4x4<f32>,
    proj: mat4x4<f32>,
    lightViewProj: mat4x4<f32>,
    waterViewProj: mat4x4<f32>,
    cameraPos: vec3<f32>,
    time: f32,
    sunDirection: vec3<f32>,
    sunIntensity: f32,
    sunColor: vec3<f32>,
    ambientLight: f32,
    shaderMode: f32,
    shadowBias: f32,
    shadowStrength: f32,
    _pad1: f32,
    fogColor: vec3<f32>,
    fogDensity: f32,
    waterEnabled: f32,
    _pad2: vec3<f32>,
    triplanarScale: f32,
    triplanarSharpness: f32,
    triplanarEnabled: f32,
    slopeBlendEnabled: f32,
    grassSlopeMax: f32,
    dirtSlopeMax: f32,
    rockSlopeMin: f32,
    heightBlendEnabled: f32,
    sandHeightMax: f32,
    snowHeightMin: f32,
    peakRockHeight: f32,
    biomeColorsEnabled: f32,
    edgeDarkening: f32,
    noiseIntensity: f32,
    fineDetailIntensity: f32,
    biomeBlendSharpness: f32,
}
`;

// Calculate buffer size dynamically
export const FRAME_UNIFORMS_SIZE = calcWGSLStructSize(FRAME_UNIFORMS_STRUCT);
export const FRAME_UNIFORMS_FLOATS = getFloat32ArraySize(FRAME_UNIFORMS_STRUCT);

// ============================================================================
// FACE PULL MESHLET SHADER
// ============================================================================

export const FACE_PULL_MESHLET_SHADER = /* wgsl */ `
${FACE_PULL_SHADER_BASE}

${TEXTURE_ARRAY_WGSL_GROUP2}

${FRAME_UNIFORMS_STRUCT}

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

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var shadowMap: texture_depth_2d;
@group(0) @binding(2) var shadowSampler: sampler_comparison;
@group(0) @binding(3) var waterHeightMap: texture_depth_2d;
@group(0) @binding(4) var waterSampler: sampler;
@group(0) @binding(5) var aerialPerspectiveLUT: texture_3d<f32>;
@group(0) @binding(6) var aerialPerspectiveSampler: sampler;

@group(1) @binding(0) var<storage, read> meshlets: array<MeshletInfo>;
@group(1) @binding(1) var<storage, read> visibleIds: array<u32>;
@group(1) @binding(2) var<storage, read> faces: array<u32>;

fn faceUv(faceDir: u32, quadVert: u32) -> vec2<f32> {
    let base = array<vec2<f32>, 4>(
        vec2<f32>(0.0, 0.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(1.0, 0.0)
    );
    var uv = base[quadVert];
    if (faceDir == 1u || faceDir == 5u) { uv.x = 1.0 - uv.x; }
    if (faceDir == 3u) { uv.y = 1.0 - uv.y; }
    return uv;
}

fn faceTBN(faceDir: u32) -> mat3x3<f32> {
    var t = vec3<f32>(1.0, 0.0, 0.0);
    var b = vec3<f32>(0.0, 1.0, 0.0);
    var n = vec3<f32>(0.0, 0.0, 1.0);
    switch(faceDir) {
        case 0u: { t = vec3<f32>(0.0, 0.0, 1.0); b = vec3<f32>(0.0, 1.0, 0.0); n = vec3<f32>(1.0, 0.0, 0.0); }
        case 1u: { t = vec3<f32>(0.0, 0.0, -1.0); b = vec3<f32>(0.0, 1.0, 0.0); n = vec3<f32>(-1.0, 0.0, 0.0); }
        case 2u: { t = vec3<f32>(1.0, 0.0, 0.0); b = vec3<f32>(0.0, 0.0, 1.0); n = vec3<f32>(0.0, 1.0, 0.0); }
        case 3u: { t = vec3<f32>(1.0, 0.0, 0.0); b = vec3<f32>(0.0, 0.0, -1.0); n = vec3<f32>(0.0, -1.0, 0.0); }
        case 4u: { t = vec3<f32>(1.0, 0.0, 0.0); b = vec3<f32>(0.0, 1.0, 0.0); n = vec3<f32>(0.0, 0.0, 1.0); }
        case 5u: { t = vec3<f32>(-1.0, 0.0, 0.0); b = vec3<f32>(0.0, 1.0, 0.0); n = vec3<f32>(0.0, 0.0, -1.0); }
        default: {}
    }
    return mat3x3<f32>(t, b, n);
}

fn hash(p: vec3<f32>) -> f32 {
    var p3 = fract(p * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn noise3D(p: vec3<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(hash(i + vec3<f32>(0.0, 0.0, 0.0)), hash(i + vec3<f32>(1.0, 0.0, 0.0)), u.x),
            mix(hash(i + vec3<f32>(0.0, 1.0, 0.0)), hash(i + vec3<f32>(1.0, 1.0, 0.0)), u.x), u.y),
        mix(mix(hash(i + vec3<f32>(0.0, 0.0, 1.0)), hash(i + vec3<f32>(1.0, 0.0, 1.0)), u.x),
            mix(hash(i + vec3<f32>(0.0, 1.0, 1.0)), hash(i + vec3<f32>(1.0, 1.0, 1.0)), u.x), u.y), u.z);
}

fn fbm(p: vec3<f32>) -> f32 {
    var val = 0.0;
    var amp = 0.5;
    var freq = 1.0;
    for (var i = 0; i < 4; i++) {
        val += amp * noise3D(p * freq);
        amp *= 0.5;
        freq *= 2.0;
    }
    return val;
}

fn unpackFaceWithFrame(packed: u32, vertexInFace: u32, chunkOrigin: vec3<f32>) -> VertexOutput {
    let posX = f32(packed & 0x1Fu);
    let posY = f32((packed >> 5u) & 0x1Fu);
    let posZ = f32((packed >> 10u) & 0x1Fu);
    let faceDir = (packed >> 15u) & 0x7u;
    let materialIdx = (packed >> 18u) & 0x1Fu;
    let aoCorner = select(
        select(select((packed >> 29u) & 0x3u, (packed >> 27u) & 0x3u, vertexInFace == 2u),
               (packed >> 25u) & 0x3u, vertexInFace == 1u),
        (packed >> 23u) & 0x3u, vertexInFace == 0u);
    let quadVert = TRI_INDICES[vertexInFace];
    let offset = QUAD_OFFSETS[faceDir][quadVert];
    var worldPos = chunkOrigin + vec3<f32>(posX, posY, posZ) + offset;
    let distToCamera = length(worldPos - frame.cameraPos);
    let detailScale = clamp(1.0 / max(distToCamera * 0.05, 1.0), 0.0, 1.0);
    if (detailScale > 0.01) {
        let noiseScale = 2.0;
        let displacement = fbm(worldPos * noiseScale) * 0.15 * detailScale;
        let normal = FACE_NORMALS[faceDir];
        worldPos += normal * displacement;
    }
    var out: VertexOutput;
    out.position = frame.viewProj * vec4<f32>(worldPos, 1.0);
    out.color = MATERIAL_COLORS[min(materialIdx, 24u)];
    if (detailScale > 0.01) {
        let eps = 0.1;
        let noiseScale = 2.0;
        let h = fbm(worldPos * noiseScale);
        let hx = fbm((worldPos + vec3<f32>(eps, 0.0, 0.0)) * noiseScale);
        let hy = fbm((worldPos + vec3<f32>(0.0, eps, 0.0)) * noiseScale);
        let hz = fbm((worldPos + vec3<f32>(0.0, 0.0, eps)) * noiseScale);
        let grad = vec3<f32>((hx - h) / eps, (hy - h) / eps, (hz - h) / eps);
        let baseNormal = FACE_NORMALS[faceDir];
        out.normal = normalize(baseNormal + grad * 0.3);
    } else {
        out.normal = FACE_NORMALS[faceDir];
    }
    out.ao = AO_VALUES[aoCorner];
    out.worldPos = worldPos;
    out.uv = faceUv(faceDir, quadVert);
    out.materialIdx = materialIdx;
    out.faceDir = faceDir;
    return out;
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
    let meshletId = visibleIds[instanceIndex];
    let m = meshlets[meshletId];
    let faceLocal = vertexIndex / 6u;
    let vertexInFace = vertexIndex % 6u;
    if (faceLocal >= m.faceCount) {
        var out: VertexOutput;
        out.position = vec4<f32>(2.0, 2.0, 2.0, 1.0);
        out.color = vec4<f32>(0.0, 0.0, 0.0, 0.0);
        out.normal = vec3<f32>(0.0, 1.0, 0.0);
        out.ao = 1.0;
        out.worldPos = vec3<f32>(0.0, 0.0, 0.0);
        out.uv = vec2<f32>(0.0, 0.0);
        out.materialIdx = 0u;
        out.faceDir = 0u;
        return out;
    }
    let packedFace = faces[m.firstFace + faceLocal];
    return unpackFaceWithFrame(packedFace, vertexInFace, m.aabbMin);
}

@fragment
fn fs_facepull(input: VertexOutput) -> @location(0) vec4<f32> {
    var baseColor = input.color.rgb;
    var surfaceNormal = normalize(input.normal);
    var orm = vec4<f32>(1.0, 0.85, 0.0, 0.0);
    let sampledBase = sampleMaterial(input.uv, input.materialIdx);
    let sampledOrm = sampleMaterialOrm(input.uv, input.materialIdx);
    let sampledN = sampleMaterialNormal(input.uv, input.materialIdx);
    if (sampledBase.a > 0.0) {
        baseColor = sampledBase.rgb;
        orm = sampledOrm;
        let tbn = faceTBN(input.faceDir);
        surfaceNormal = normalize(tbn * sampledN);
    }
    baseColor *= input.ao;
    let lightDir = normalize(frame.sunDirection);
    let ndotl = max(dot(surfaceNormal, lightDir), 0.0);
    let ambient = vec3<f32>(0.3, 0.35, 0.4) * frame.ambientLight;
    let diffuse = ndotl * 0.7 * frame.sunIntensity;
    var litColor = baseColor * (ambient + frame.sunColor * diffuse);
    let viewDir = normalize(frame.cameraPos - input.worldPos);
    let halfDir = normalize(viewDir + lightDir);
    let roughness = clamp(orm.g, 0.04, 1.0);
    let metallic = clamp(orm.b, 0.0, 1.0);
    let shininess = mix(128.0, 8.0, roughness);
    let spec = pow(max(dot(surfaceNormal, halfDir), 0.0), shininess);
    let f0 = mix(vec3<f32>(0.04), baseColor, metallic);
    litColor += f0 * spec * frame.sunIntensity;
    let dist = length(frame.cameraPos - input.worldPos);
    let fogAmount = 1.0 - exp(-dist * frame.fogDensity);
    litColor = mix(litColor, frame.fogColor, clamp(fogAmount, 0.0, 0.9));
    return vec4<f32>(litColor, input.color.a);
}
`;

// ============================================================================
// FACE PULL SHADER (non-meshlet, per-chunk)
// ============================================================================

export const FACE_PULL_SHADER = /* wgsl */ `
${FACE_PULL_SHADER_BASE}

${TEXTURE_ARRAY_WGSL_GROUP2}

${FRAME_UNIFORMS_STRUCT}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var shadowMap: texture_depth_2d;
@group(0) @binding(2) var shadowSampler: sampler_comparison;
@group(0) @binding(3) var waterHeightMap: texture_depth_2d;
@group(0) @binding(4) var waterSampler: sampler;
@group(0) @binding(5) var aerialPerspectiveLUT: texture_3d<f32>;
@group(0) @binding(6) var aerialPerspectiveSampler: sampler;

@group(1) @binding(0) var<uniform> chunk: ChunkUniforms;
@group(1) @binding(1) var<storage, read> faces: array<u32>;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    let faceIndex = vertexIndex / 6u;
    let vertexInFace = vertexIndex % 6u;
    let packed = faces[faceIndex];
    var out = unpackFaceData(packed, vertexInFace, chunk.chunkOrigin);
    out.position = frame.viewProj * vec4<f32>(out.worldPos, 1.0);
    return out;
}

@fragment
fn fs_facepull(input: VertexOutput) -> @location(0) vec4<f32> {
    let baseColor = input.color.rgb;
    let lightDir = normalize(frame.sunDirection);
    let diffuse = max(dot(input.normal, lightDir), 0.0) * frame.sunIntensity;
    let ambient = frame.ambientLight;
    var litColor = baseColor * (ambient + frame.sunColor * diffuse);
    litColor *= input.ao;
    let dist = length(frame.cameraPos - input.worldPos);
    let fogAmount = 1.0 - exp(-dist * frame.fogDensity);
    litColor = mix(litColor, frame.fogColor, clamp(fogAmount, 0.0, 0.9));
    return vec4<f32>(litColor, input.color.a);
}
`;

// ============================================================================
// FACE PULL SHADOW SHADER
// ============================================================================

export const FACE_PULL_SHADOW_SHADER = /* wgsl */ `
${FACE_PULL_SHADER_BASE}

struct ShadowUniforms {
    lightViewProj: mat4x4<f32>,
}

@group(0) @binding(0) var<uniform> shadow: ShadowUniforms;

@group(1) @binding(0) var<uniform> chunk: ChunkUniforms;
@group(1) @binding(1) var<storage, read> faces: array<u32>;

@vertex
fn vs_shadow(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
    let faceIndex = vertexIndex / 6u;
    let vertexInFace = vertexIndex % 6u;
    let packed = faces[faceIndex];
    var out = unpackFaceData(packed, vertexInFace, chunk.chunkOrigin);
    return shadow.lightViewProj * vec4<f32>(out.worldPos, 1.0);
}
`;

// ============================================================================
// SHADOW SHADER
// ============================================================================

export const SHADOW_SHADER = /* wgsl */ `
struct ShadowUniforms {
    lightViewProj: mat4x4<f32>,
}

struct ChunkUniforms {
    worldOffset: vec3<f32>,
    blend: f32,
}

@group(0) @binding(0) var<uniform> shadow: ShadowUniforms;
@group(1) @binding(0) var<uniform> chunk: ChunkUniforms;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) color: vec4<f32>,
}

@vertex
fn vs_shadow(input: VertexInput) -> @builtin(position) vec4<f32> {
    let worldPos = input.position + chunk.worldOffset;
    return shadow.lightViewProj * vec4<f32>(worldPos, 1.0);
}
`;

// ============================================================================
// COMPACT SHADER BUILDERS
// ============================================================================

export function buildVoxelShaderCompactBase(VOXEL_SHADER) {
    let shader = COMPACT_VERTEX_SHADER + '\n' + VOXEL_SHADER;
    shader = shader.replace(
        /struct VertexInput \{\s*@location\(0\) position: vec3<f32>,\s*@location\(1\) normal: vec3<f32>,\s*@location\(2\) color: vec4<f32>,\s*\}/,
        `struct VertexInput {\n    @location(0) packed: u32,\n}`
    );
    shader = shader.replace(
        /var localPos = input\.position;/,
        `let unpacked = unpackVertex(input.packed, chunk.worldOffset);\n    var localPos = unpacked.position - chunk.worldOffset;`
    );
    shader = shader.replace(
        /output\.normal = input\.normal;/,
        `output.normal = unpacked.normal;`
    );
    shader = shader.replace(
        /output\.color = vec4<f32>\(input\.color\.rgb, input\.color\.a \* chunk\.blend\);/,
        `output.color = vec4<f32>(unpacked.color.rgb, unpacked.color.a * chunk.blend);\n    output.ao = unpacked.ao;\n    output.materialIdx = unpacked.materialIdx;`
    );
    shader = shader.replace(/\s*output\.ao = 1\.0;\s*output\.materialIdx = 0u;\s*/, '\n');
    return shader;
}

export function buildVoxelShaderCompactOpaque(compactBase) {
    return compactBase.replace(
        /let isTransparent = input\.color\.a < 0\.99;/,
        `let isTransparent = input.color.a < 0.99;\n    if (isTransparent) {\n        discard;\n    }`
    );
}

export function buildVoxelShaderCompactWater(compactBase) {
    return compactBase.replace(
        /let isTransparent = input\.color\.a < 0\.99;/,
        `let isTransparent = input.color.a < 0.99;\n    if (!isTransparent) {\n        discard;\n    }`
    );
}

export function buildShadowShaderCompact() {
    let shader = COMPACT_VERTEX_SHADER + '\n' + SHADOW_SHADER;
    shader = shader.replace(
        /struct VertexInput \{\s*@location\(0\) position: vec3<f32>,\s*@location\(1\) normal: vec3<f32>,\s*@location\(2\) color: vec4<f32>,\s*\}/,
        `struct VertexInput {\n    @location(0) packed: u32,\n}`
    );
    shader = shader.replace(
        /let worldPos = input\.position \+ chunk\.worldOffset;/,
        `let unpacked = unpackVertex(input.packed, chunk.worldOffset);\n    let worldPos = unpacked.position;`
    );
    return shader;
}

// ============================================================================
// VOXEL SHADER (main rendering shader)
// ============================================================================

export const VOXEL_SHADER = /* wgsl */ `
${FRAME_UNIFORMS_STRUCT}

${TEXTURE_ARRAY_WGSL_GROUP2}

struct ChunkUniforms {
    worldOffset: vec3<f32>,
    blend: f32,
    morphFactor: f32,
    lodLevel: f32,
    cameraDistance: f32,
    _chunkPad: f32,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var shadowMap: texture_depth_2d;
@group(0) @binding(2) var shadowSampler: sampler_comparison;
@group(0) @binding(3) var waterHeightMap: texture_depth_2d;
@group(0) @binding(4) var waterSampler: sampler;
@group(0) @binding(5) var aerialPerspectiveLUT: texture_3d<f32>;
@group(0) @binding(6) var aerialPerspectiveSampler: sampler;
@group(1) @binding(0) var<uniform> chunk: ChunkUniforms;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) color: vec4<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) worldPos: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) color: vec4<f32>,
    @location(3) shadowCoord: vec4<f32>,
    @location(4) waterCoord: vec4<f32>,
    @location(5) ao: f32,
    @location(6) @interpolate(flat) materialIdx: u32,
}

fn applyGeomorph(pos: vec3<f32>, morphFactor: f32, lodLevel: f32) -> vec3<f32> {
    let currentStep = pow(2.0, lodLevel);
    let nextStep = currentStep * 2.0;
    let snappedPos = floor(pos / nextStep + 0.5) * nextStep;
    return mix(pos, snappedPos, morphFactor);
}

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    var localPos = input.position;
    if (chunk.morphFactor > 0.0) {
        localPos = applyGeomorph(localPos, chunk.morphFactor, chunk.lodLevel);
    }
    let worldPos = localPos + chunk.worldOffset;
    output.position = frame.viewProj * vec4<f32>(worldPos, 1.0);
    output.worldPos = worldPos;
    output.normal = input.normal;
    output.color = vec4<f32>(input.color.rgb, input.color.a * chunk.blend);
    output.ao = 1.0;
    output.materialIdx = 0u;
    output.shadowCoord = frame.lightViewProj * vec4<f32>(worldPos, 1.0);
    output.waterCoord = frame.waterViewProj * vec4<f32>(worldPos, 1.0);
    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let isTransparent = input.color.a < 0.99;
    var baseColor = input.color.rgb * input.ao;
    let lightDir = normalize(frame.sunDirection);
    let ndotl = max(dot(input.normal, lightDir), 0.0);
    let ambient = vec3<f32>(0.3, 0.35, 0.4) * frame.ambientLight;
    let diffuse = ndotl * 0.7 * frame.sunIntensity;
    var litColor = baseColor * (ambient + frame.sunColor * diffuse);
    let dist = length(frame.cameraPos - input.worldPos);
    let fogAmount = 1.0 - exp(-dist * frame.fogDensity);
    litColor = mix(litColor, frame.fogColor, clamp(fogAmount, 0.0, 0.9));
    return vec4<f32>(litColor, input.color.a);
}
`;

// Pre-built compact shaders
export const VOXEL_SHADER_COMPACT_BASE = buildVoxelShaderCompactBase(VOXEL_SHADER);
export const VOXEL_SHADER_COMPACT_OPAQUE = buildVoxelShaderCompactOpaque(VOXEL_SHADER_COMPACT_BASE);
export const VOXEL_SHADER_COMPACT_WATER = buildVoxelShaderCompactWater(VOXEL_SHADER_COMPACT_BASE);
export const SHADOW_SHADER_COMPACT = buildShadowShaderCompact();
