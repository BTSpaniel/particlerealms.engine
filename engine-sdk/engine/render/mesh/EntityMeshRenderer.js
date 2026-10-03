// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * EntityMeshRenderer - Renders entity meshes (cubes, spheres, etc.) in the viewport
 * Uses GPU INSTANCING to batch all entities of same mesh type into ONE draw call
 * Buffer grows automatically - no hard entity limit
 * 
 * Now powered by vGPU driver for unified resource management
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import { LightManager } from '../LightManager.js';
import { generateTangentsFromGeometry } from '../../core/math/MeshAttributeMath.js';

const INSTANCE_STRIDE = 96; // 24 floats per instance (model mat4 + color vec4 + selection vec4) = 96 bytes
const FLOATS_PER_INSTANCE = 24;
const INITIAL_CAPACITY = 128;
const GROWTH_FACTOR = 2;
const ENTITY_VERTEX_STRIDE_FLOATS = 14; // pos3 + normal3 + uv0_2 + tangent4 + uv1_2
const ENTITY_VERTEX_STRIDE_BYTES = ENTITY_VERTEX_STRIDE_FLOATS * 4;
const ENTITY_TANGENT_EPSILON = 1e-12;
const MATERIAL_PARAMS_BYTE_SIZE = 208; // 13 aligned vec4 lanes
const MATERIAL_TEXTURE_SLOTS = Object.freeze(['baseColor', 'normal', 'metallicRoughness', 'emissive', 'occlusion']);

function _isFiniteMat4(value) {
    if (!value || value.length !== 16) return false;
    for (let i = 0; i < 16; i++) if (!Number.isFinite(value[i])) return false;
    return true;
}

// Reusable buffers for hot render path (reduce/reuse/recycle)
const _modelMatrix = new Float32Array(16);

function writeEntityFallbackTangent(target, offset, nx, ny, nz) {
    const normalX = Number.isFinite(nx) ? nx : 0;
    const normalY = Number.isFinite(ny) ? ny : 0;
    const normalZ = Number.isFinite(nz) ? nz : 1;
    const axisX = Math.abs(normalX) < 0.9 ? 1 : 0;
    const axisY = Math.abs(normalX) < 0.9 ? 0 : 1;
    const dot = axisX * normalX + axisY * normalY;
    let tx = axisX - normalX * dot;
    let ty = axisY - normalY * dot;
    let tz = -normalZ * dot;
    const lenSq = tx * tx + ty * ty + tz * tz;
    if (lenSq > ENTITY_TANGENT_EPSILON) {
        const invLen = 1 / Math.sqrt(lenSq);
        tx *= invLen;
        ty *= invLen;
        tz *= invLen;
    } else {
        tx = 1;
        ty = 0;
        tz = 0;
    }
    target[offset] = tx;
    target[offset + 1] = ty;
    target[offset + 2] = tz;
    target[offset + 3] = 1;
}

function writeEntitySkinnedTangent(target, offset, tx, ty, tz, handedness, nx, ny, nz) {
    let normalX = Number.isFinite(nx) ? nx : 0;
    let normalY = Number.isFinite(ny) ? ny : 0;
    let normalZ = Number.isFinite(nz) ? nz : 1;
    const normalLenSq = normalX * normalX + normalY * normalY + normalZ * normalZ;
    if (normalLenSq > ENTITY_TANGENT_EPSILON) {
        const invNormalLen = 1 / Math.sqrt(normalLenSq);
        normalX *= invNormalLen;
        normalY *= invNormalLen;
        normalZ *= invNormalLen;
    } else {
        normalX = 0;
        normalY = 0;
        normalZ = 1;
    }

    let tangentX = Number.isFinite(tx) ? tx : 1;
    let tangentY = Number.isFinite(ty) ? ty : 0;
    let tangentZ = Number.isFinite(tz) ? tz : 0;
    const dot = tangentX * normalX + tangentY * normalY + tangentZ * normalZ;
    tangentX -= normalX * dot;
    tangentY -= normalY * dot;
    tangentZ -= normalZ * dot;
    const tangentLenSq = tangentX * tangentX + tangentY * tangentY + tangentZ * tangentZ;
    const sign = Number.isFinite(handedness) && handedness < 0 ? -1 : 1;
    if (tangentLenSq > ENTITY_TANGENT_EPSILON) {
        const invTangentLen = 1 / Math.sqrt(tangentLenSq);
        target[offset] = tangentX * invTangentLen;
        target[offset + 1] = tangentY * invTangentLen;
        target[offset + 2] = tangentZ * invTangentLen;
        target[offset + 3] = sign;
        return;
    }

    writeEntityFallbackTangent(target, offset, normalX, normalY, normalZ);
    target[offset + 3] = sign;
}

function normalizeEntityNormalScale(value, fallback = 1) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(8, n));
}

function normalizeEntityNormalGreenSign(value, fallback = 1) {
    if (value === -1 || value === '-1' || value === 'down') return -1;
    if (value === 1 || value === '1' || value === 'up') return 1;
    return fallback < 0 ? -1 : 1;
}

function _materialAlphaModeCode(value) {
    if (value === 'opaque') return 0;
    if (value === 'mask') return 1;
    if (value === 'blend') return 2;
    return -1; // Legacy editor material behavior.
}

function _materialUvLanes(binding, enabled) {
    const transform = binding?.transform || {};
    const offset = transform.offset || [0, 0];
    const scale = transform.scale || [1, 1];
    const rotation = Number.isFinite(transform.rotation) ? transform.rotation : 0;
    return [
        [offset[0] ?? 0, offset[1] ?? 0, scale[0] ?? 1, scale[1] ?? 1],
        [Math.sin(rotation), Math.cos(rotation), binding?.uvSet === 1 ? 1 : 0, enabled ? 1 : 0],
    ];
}

export function entityMaterialParamsData(options = {}) {
    const data = new Float32Array(MATERIAL_PARAMS_BYTE_SIZE / 4);
    const bindings = options.textureBindings || null;
    const legacy = bindings === null;
    const emissive = options.emissiveFactor || [0, 0, 0];
    data.set([
        normalizeEntityNormalScale(options.normalScale ?? options.normalTextureScale, 1),
        normalizeEntityNormalGreenSign(
            options.normalGreenSign ?? options.normalGreenChannel ?? options.normalTextureGreenChannel,
            1
        ),
        Number.isFinite(options.alphaCutoff) ? Math.max(0, Math.min(1, options.alphaCutoff)) : 0.5,
        _materialAlphaModeCode(options.alphaMode),
        Number.isFinite(emissive[0]) ? emissive[0] : 0,
        Number.isFinite(emissive[1]) ? emissive[1] : 0,
        Number.isFinite(emissive[2]) ? emissive[2] : 0,
        options.unlit ? 1 : 0,
        Number.isFinite(options.occlusionStrength) ? Math.max(0, Math.min(1, options.occlusionStrength)) : 1,
        bindings?.metallicRoughness ? 1 : 0,
        bindings?.emissive ? 1 : 0,
        bindings?.occlusion ? 1 : 0,
    ], 0);
    const resolvedBindings = {
        baseColor: bindings?.baseColor || bindings?.diffuse || null,
        normal: bindings?.normal || null,
        metallicRoughness: bindings?.metallicRoughness || null,
        emissive: bindings?.emissive || null,
        occlusion: bindings?.occlusion || null,
    };
    let offset = 12;
    for (const slot of MATERIAL_TEXTURE_SLOTS) {
        const binding = resolvedBindings[slot];
        const enabled = legacy ? (slot === 'baseColor' || slot === 'normal') : !!binding;
        const lanes = _materialUvLanes(binding, enabled);
        data.set(lanes[0], offset);
        data.set(lanes[1], offset + 4);
        offset += 8;
    }
    return data;
}

function entityMaterialParamsBuffer(renderer, materialId, options = {}) {
    if (options.materialParamsBuffer) return options.materialParamsBuffer;
    const data = entityMaterialParamsData(options);
    const usesDefaultParams = data[0] === 1 && data[1] === 1;
    if (usesDefaultParams && renderer._defaultMaterialParamsBuffer) {
        return renderer._defaultMaterialParamsBuffer;
    }
    if (!renderer.vgpu?.buffer?.create) {
        return renderer._defaultMaterialParamsBuffer;
    }
    if (!renderer._materialParamBuffers) renderer._materialParamBuffers = new Map();
    const created = renderer.vgpu.buffer.create({
        size: MATERIAL_PARAMS_BYTE_SIZE,
        usage: 'uniform',
        data,
        label: `MaterialParams_${materialId}`,
    });
    renderer._materialParamBuffers.set(materialId, created);
    return created.buffer;
}

export class EntityMeshRenderer {
    constructor(device) {
        // Initialize vGPU from existing device
        this.vgpu = initVGPU({ device, adapter: device.adapter || null, queue: device.queue });
        this.device = device;
        this.pipeline = null;
        this.meshDataCache = new Map(); // Cache raw mesh data for SDF generation
        this.meshBoundingRadii = {}; // meshType -> bounding sphere radius from vertex data
        this.meshBoundingBoxes = {};  // meshType -> { min:[x,y,z], max:[x,y,z], center:[x,y,z], extents:[hx,hy,hz] }

        this.meshBoundsRevisions = {}; // meshType -> monotonic animated-bounds revision
        
        // GPU Instancing: one buffer holds ALL instance data, batched by mesh type
        this.instanceBuffer = null;
        this.instanceData = null; // CPU-side Float32Array
        this.frameUniformBuffer = null; // viewProj matrix (shared across all instances)
        this.bindGroup = null;
        this.bindGroupLayout = null;
        
        // Material texture bind group (group 2)
        this.materialBindGroupLayout = null;
        this.defaultMaterialBindGroup = null; // 1x1 white fallback
        this._materialBindGroups = new Map(); // materialId -> GPUBindGroup
        this._materialParamBuffers = new Map(); // materialId -> GPUBuffer wrapper
        
        // Per-mesh-type instance batching
        this.meshes = {};
        this.meshBatches = new Map(); // meshType -> { startIndex, count }
        this.totalInstances = 0;
        this.bufferCapacity = 0;
        
        // Deferred buffer cleanup to avoid destroying in-flight GPU resources
        this._pendingBufferCleanup = [];
    }
    
    async initialize(format, lightBindGroupLayout) {
        console.log('[EntityMeshRenderer] Initializing with GPU INSTANCING + dynamic lighting...');
        
        // Store lighting bind group layout for pipeline creation
        this.lightBindGroupLayout = lightBindGroupLayout || null;
        
        // Build shader source with LightManager structs and functions
        const lightDefs = LightManager.getShaderDefs();
        const lightFuncs = LightManager.getShaderFunctions();
        
        const shaderSource = `
                struct FrameUniforms {
                    viewProj:  mat4x4f,
                    cameraPos: vec3f,
                    _pad:      f32,
                }
                
                struct Instance {
                    model:     mat4x4f,
                    color:     vec4f,
                    selection: vec4f,  // x=isSelected, y=outlineWidth, z=roughness, w=metallic
                }
                
                struct MaterialParams {
                    normalAlpha: vec4f,
                    emissiveWorkflow: vec4f,
                    surfaceFlags: vec4f,
                    baseColorUvTransform: vec4f,
                    baseColorUvConfig: vec4f,
                    normalUvTransform: vec4f,
                    normalUvConfig: vec4f,
                    metallicRoughnessUvTransform: vec4f,
                    metallicRoughnessUvConfig: vec4f,
                    emissiveUvTransform: vec4f,
                    emissiveUvConfig: vec4f,
                    occlusionUvTransform: vec4f,
                    occlusionUvConfig: vec4f,
                }

                @group(0) @binding(0) var<uniform> frame: FrameUniforms;
                @group(0) @binding(1) var<storage, read> instances: array<Instance>;
                
                ${lightDefs}
                @group(1) @binding(0) var<uniform> lighting: LightingUniforms;
                
                @group(2) @binding(0) var matSampler: sampler;
                @group(2) @binding(1) var matAlbedo:  texture_2d<f32>;
                @group(2) @binding(2) var matNormal:  texture_2d<f32>;
                @group(2) @binding(3) var<uniform> matParams: MaterialParams;
                @group(2) @binding(4) var matNormalSampler: sampler;
                @group(2) @binding(5) var matMetallicRoughnessSampler: sampler;
                @group(2) @binding(6) var matMetallicRoughness: texture_2d<f32>;
                @group(2) @binding(7) var matEmissiveSampler: sampler;
                @group(2) @binding(8) var matEmissive: texture_2d<f32>;
                @group(2) @binding(9) var matOcclusionSampler: sampler;
                @group(2) @binding(10) var matOcclusion: texture_2d<f32>;
                
                struct VertexOutput {
                    @builtin(position) position: vec4f,
                    @location(0) normal:      vec3f,
                    @location(1) worldPos:    vec3f,
                    @location(2) viewDir:     vec3f,
                    @location(3) uv:          vec2f,
                    @location(4) @interpolate(flat) instanceIdx: u32,
                    @location(5) tangent:     vec4f,
                    @location(6) uv1:         vec2f,
                }
                
                @vertex
                fn vertexMain(
                    @location(0) position: vec3f,
                    @location(1) normal:   vec3f,
                    @location(2) uv:       vec2f,
                    @location(3) tangent:  vec4f,
                    @location(4) uv1:      vec2f,
                    @builtin(instance_index) instanceIdx: u32
                ) -> VertexOutput {
                    var output: VertexOutput;
                    let inst = instances[instanceIdx];
                    let worldPos = inst.model * vec4f(position, 1.0);
                    output.position    = frame.viewProj * worldPos;
                    output.normal      = entityTransformAffineNormal(inst.model, normal);
                    output.worldPos    = worldPos.xyz;
                    output.instanceIdx = instanceIdx;
                    output.viewDir     = normalize(frame.cameraPos - worldPos.xyz);
                    output.uv          = uv;
                    output.uv1         = uv1;
                    output.tangent     = vec4f(
                        entityNormalizeOrFallback((inst.model * vec4f(tangent.xyz, 0.0)).xyz, entityFallbackTangentForNormal(output.normal)),
                        tangent.w * entityLinearDeterminantSign(inst.model)
                    );
                    return output;
                }
                
                ${lightFuncs}

                // Sky environment: neutral blue-grey gradient (Blender/Unity style)
                fn envSky(dir: vec3f) -> vec3f {
                    let h = clamp(dir.y, -1.0f, 1.0f);
                    // Bottom: warm grey, Top: cool blue-grey
                    let bot = vec3f(0.22f, 0.22f, 0.25f);
                    let top = vec3f(0.28f, 0.32f, 0.42f);
                    return mix(bot, top, h * 0.5f + 0.5f);
                }
                
                fn entityNormalizeOrFallback(value: vec3f, fallback: vec3f) -> vec3f {
                    let lenSq = dot(value, value);
                    if (lenSq > 0.00000001f && all(value == value)) {
                        return value * inverseSqrt(lenSq);
                    }
                    return fallback;
                }

                fn entityLinearDeterminantSign(model: mat4x4f) -> f32 {
                    let determinant = dot(model[0].xyz, cross(model[1].xyz, model[2].xyz));
                    return select(-1.0f, 1.0f, determinant >= 0.0f);
                }

                fn entityTransformAffineNormal(model: mat4x4f, normal: vec3f) -> vec3f {
                    let cofactor0 = cross(model[1].xyz, model[2].xyz);
                    let cofactor1 = cross(model[2].xyz, model[0].xyz);
                    let cofactor2 = cross(model[0].xyz, model[1].xyz);
                    let determinant = dot(model[0].xyz, cofactor0);
                    if (abs(determinant) <= 0.00000001f || determinant != determinant) {
                        return entityNormalizeOrFallback((model * vec4f(normal, 0.0f)).xyz, vec3f(0.0f, 1.0f, 0.0f));
                    }
                    let transformed = (cofactor0 * normal.x + cofactor1 * normal.y + cofactor2 * normal.z)
                        * entityLinearDeterminantSign(model);
                    return entityNormalizeOrFallback(transformed, vec3f(0.0f, 1.0f, 0.0f));
                }

                fn entityFallbackTangentForNormal(normal: vec3f) -> vec3f {
                    var axis = vec3f(1.0f, 0.0f, 0.0f);
                    if (abs(normal.x) >= 0.9f) {
                        axis = vec3f(0.0f, 1.0f, 0.0f);
                    }
                    return entityNormalizeOrFallback(axis - normal * dot(axis, normal), vec3f(1.0f, 0.0f, 0.0f));
                }

                fn entityDecodeNormalTextureSample(normalSample: vec3f, normalScale: f32, greenChannelSign: f32) -> vec3f {
                    let scale = clamp(normalScale, 0.0f, 8.0f);
                    let tangentNormal = vec3f(
                        (normalSample.r * 2.0f - 1.0f) * scale,
                        (normalSample.g * 2.0f - 1.0f) * scale * greenChannelSign,
                        normalSample.b * 2.0f - 1.0f
                    );
                    return entityNormalizeOrFallback(tangentNormal, vec3f(0.0f, 0.0f, 1.0f));
                }

                fn entityTangentFrameNormalToWorld(baseNormal: vec3f, tangent: vec4f, tangentNormal: vec3f) -> vec3f {
                    let n = entityNormalizeOrFallback(baseNormal, vec3f(0.0f, 0.0f, 1.0f));
                    let tangentFallback = entityFallbackTangentForNormal(n);
                    let projectedTangent = tangent.xyz - n * dot(tangent.xyz, n);
                    let t = entityNormalizeOrFallback(projectedTangent, tangentFallback);
                    let handedness = select(1.0f, -1.0f, tangent.w < 0.0f);
                    let b = entityNormalizeOrFallback(cross(n, t), cross(n, tangentFallback)) * handedness;
                    return entityNormalizeOrFallback(t * tangentNormal.x + b * tangentNormal.y + n * tangentNormal.z, n);
                }

                fn entityMaterialUv(uv0: vec2f, uv1: vec2f, transform: vec4f, config: vec4f) -> vec2f {
                    let sourceUv = select(uv0, uv1, config.z > 0.5f);
                    let scaled = sourceUv * transform.zw;
                    return transform.xy + vec2f(
                        config.y * scaled.x - config.x * scaled.y,
                        config.x * scaled.x + config.y * scaled.y
                    );
                }

                fn entityApplyNormalMap(baseNormal: vec3f, tangent: vec4f, normalSample: vec3f) -> vec3f {
                    let unpacked = normalSample * 2.0f - vec3f(1.0f);
                    if (max(abs(unpacked.x), abs(unpacked.y)) <= 0.01f) {
                        return baseNormal;
                    }
                    let tangentNormal = entityDecodeNormalTextureSample(normalSample, matParams.normalAlpha.x, matParams.normalAlpha.y);
                    return entityTangentFrameNormalToWorld(baseNormal, tangent, tangentNormal);
                }

                @fragment
                fn fragmentMain(input: VertexOutput, @builtin(front_facing) frontFacing: bool) -> @location(0) vec4f {
                    let inst = instances[input.instanceIdx];
                    let baseColorUv = entityMaterialUv(input.uv, input.uv1, matParams.baseColorUvTransform, matParams.baseColorUvConfig);
                    let normalUv = entityMaterialUv(input.uv, input.uv1, matParams.normalUvTransform, matParams.normalUvConfig);
                    let mrUv = entityMaterialUv(input.uv, input.uv1, matParams.metallicRoughnessUvTransform, matParams.metallicRoughnessUvConfig);
                    let emissiveUv = entityMaterialUv(input.uv, input.uv1, matParams.emissiveUvTransform, matParams.emissiveUvConfig);
                    let occlusionUv = entityMaterialUv(input.uv, input.uv1, matParams.occlusionUvTransform, matParams.occlusionUvConfig);
                    var normal = normalize(input.normal);
                    if (!frontFacing) { normal = -normal; }
                    if (matParams.normalUvConfig.w > 0.5f) {
                        normal = entityApplyNormalMap(normal, input.tangent, textureSample(matNormal, matNormalSampler, normalUv).rgb);
                    }
                     
                    let viewDir  = normalize(input.viewDir);
                    var roughness = select(inst.selection.z, 0.6f, inst.selection.z < 0.001f);
                    var metallic  = inst.selection.w;
                    if (matParams.surfaceFlags.y > 0.5f) {
                        let mrSample = textureSample(matMetallicRoughness, matMetallicRoughnessSampler, mrUv);
                        roughness = clamp(roughness * mrSample.g, 0.04f, 1.0f);
                        metallic = clamp(metallic * mrSample.b, 0.0f, 1.0f);
                    }
                     
                    // Sample albedo texture and multiply with instance color
                    var texColor = vec4f(1.0f);
                    if (matParams.baseColorUvConfig.w > 0.5f) {
                        texColor = textureSample(matAlbedo, matSampler, baseColorUv);
                    }
                    let baseColor = inst.color.rgb * texColor.rgb;
                    var alpha = inst.color.a * texColor.a;
                    if (matParams.normalAlpha.w == 0.0f) { alpha = 1.0f; }
                    if (matParams.normalAlpha.w == 1.0f) {
                        if (alpha < matParams.normalAlpha.z) { discard; }
                        alpha = 1.0f;
                    }
                     
                    // PBR lighting (GGX specular + Fresnel + energy conservation)
                    var finalColor = baseColor;
                    if (matParams.emissiveWorkflow.w < 0.5f) {
                        finalColor = calcAllLighting(input.worldPos, normal, baseColor, viewDir, roughness, metallic);
                    }
                    
                    // --- Environment reflection tint ---
                    // Reflect view ray off surface, sample sky gradient
                    let reflDir = reflect(-viewDir, normal);
                    let skyCol  = envSky(reflDir);
                    let F0env   = mix(vec3f(0.04f), baseColor, metallic);
                    let NdotV   = max(dot(normal, viewDir), 0.0f);
                    let envF    = F0env + (vec3f(1.0f) - F0env) * pow(clamp(1.0f - NdotV, 0.0f, 1.0f), 5.0f);
                    // Rougher surfaces get less env reflection
                    let envWeight = (1.0f - roughness * roughness) * 0.55f;
                    if (matParams.emissiveWorkflow.w < 0.5f) {
                        finalColor += skyCol * envF * envWeight;
                    }

                    if (matParams.surfaceFlags.w > 0.5f) {
                        let occlusion = textureSample(matOcclusion, matOcclusionSampler, occlusionUv).r;
                        finalColor *= mix(1.0f, occlusion, matParams.surfaceFlags.x);
                    }
                    if (matParams.surfaceFlags.z > 0.5f) {
                        finalColor += textureSample(matEmissive, matEmissiveSampler, emissiveUv).rgb * matParams.emissiveWorkflow.xyz;
                    } else {
                        finalColor += matParams.emissiveWorkflow.xyz;
                    }
                    
                    // --- Contact shadow (proximity darkening near y=0 floor) ---
                    // Approximates the soft shadow pool seen in the SDF playground
                    let floorDist = max(input.worldPos.y, 0.0f);
                    let shadowRadius = 1.2f; // world units
                    let contactShadow = 1.0f - 0.20f * exp(-floorDist * floorDist / (shadowRadius * shadowRadius));
                    finalColor *= contactShadow;
                    
                    // --- Selection highlight: Fresnel-based cyan rim ---
                    if (inst.selection.x > 0.5f) {
                        let rim = pow(1.0f - max(dot(normal, viewDir), 0.0f), 3.0f);
                        finalColor = finalColor * 1.15f + vec3f(0.25f, 0.75f, 1.0f) * rim * 0.9f;
                    }
                    
                    // ACES-approximation tone mapping (handles HDR sun intensity gracefully)
                    let a2 = finalColor * (finalColor * 2.51f + vec3f(0.03f));
                    let b2 = finalColor * (finalColor * 2.43f + vec3f(0.59f)) + vec3f(0.14f);
                    finalColor = a2 / b2;
                    
                    return vec4f(finalColor, alpha);
                }
            `;
        
        const shaderModule = this.vgpu.shader.compile('entityMeshInstanced', shaderSource);
        
        // Create bind group layout for instanced rendering
        // Note: vGPU uses 'read-storage' which maps to WebGPU's 'read-only-storage'
        this.bindGroupLayout = this.vgpu.bindings.defineLayout('entityMeshInstanced', [
            {
                binding: 0,
                type: 'uniform',
                visibility: 'vertex',
                minBindingSize: 80 // mat4x4f viewProj (64) + vec3 cameraPos (12) + pad (4)
            },
            {
                binding: 1,
                type: 'read-storage',
                visibility: 'vertex|fragment',
                minBindingSize: INSTANCE_STRIDE // At least one instance
            }
        ]);
        
        // Create initial buffers
        this.growBuffer(INITIAL_CAPACITY);
        
        // Create material texture bind group layout (group 2)
        this.materialBindGroupLayout = this.device.createBindGroupLayout({
            label: 'MaterialTextureBindGroupLayout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', minBindingSize: MATERIAL_PARAMS_BYTE_SIZE } },
                { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
                { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
                { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 7, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
                { binding: 8, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 9, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
                { binding: 10, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
            ],
        });
        
        // Create default 1x1 white texture for materials without textures
        this._defaultAlbedoTex = this.device.createTexture({
            size: [1, 1, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            label: 'defaultAlbedo1x1',
        });
        this.device.queue.writeTexture(
            { texture: this._defaultAlbedoTex },
            new Uint8Array([255, 255, 255, 255]),
            { bytesPerRow: 4 },
            [1, 1, 1],
        );
        this._defaultNormalTex = this.device.createTexture({

            size: [1, 1, 1],

            format: 'rgba8unorm',

            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,

            label: 'defaultNormal1x1',

        });

        this.device.queue.writeTexture(

            { texture: this._defaultNormalTex },

            new Uint8Array([128, 128, 255, 255]),

            { bytesPerRow: 4 },

            [1, 1, 1],

        );

        const createMaterialFallbackTexture = (label, rgba) => {
            const texture = this.device.createTexture({
                size: [1, 1, 1],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
                label,
            });
            this.device.queue.writeTexture({ texture }, new Uint8Array(rgba), { bytesPerRow: 4 }, [1, 1, 1]);
            return texture;
        };
        this._defaultMetallicRoughnessTex = createMaterialFallbackTexture('defaultMetallicRoughness1x1', [255, 255, 255, 255]);
        this._defaultEmissiveTex = createMaterialFallbackTexture('defaultEmissive1x1', [0, 0, 0, 255]);
        this._defaultOcclusionTex = createMaterialFallbackTexture('defaultOcclusion1x1', [255, 255, 255, 255]);

        this._defaultSampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'repeat',
            addressModeV: 'repeat',
        });
        const defaultMaterialParams = this.vgpu.buffer.create({
            size: MATERIAL_PARAMS_BYTE_SIZE,
            usage: 'uniform',
            data: entityMaterialParamsData(),
            label: 'DefaultMaterialParams',
        });
        this._defaultMaterialParamsBuffer = defaultMaterialParams.buffer;

        this.defaultMaterialBindGroup = this.device.createBindGroup({
            layout: this.materialBindGroupLayout,
            entries: [
                { binding: 0, resource: this._defaultSampler },
                { binding: 1, resource: this._defaultAlbedoTex.createView() },
                { binding: 2, resource: this._defaultNormalTex.createView() },
                { binding: 3, resource: { buffer: this._defaultMaterialParamsBuffer } },
                { binding: 4, resource: this._defaultSampler },
                { binding: 5, resource: this._defaultSampler },
                { binding: 6, resource: this._defaultMetallicRoughnessTex.createView() },
                { binding: 7, resource: this._defaultSampler },
                { binding: 8, resource: this._defaultEmissiveTex.createView() },
                { binding: 9, resource: this._defaultSampler },
                { binding: 10, resource: this._defaultOcclusionTex.createView() },
            ],
            label: 'DefaultMaterialBindGroup',
        });
        
        // Build pipeline layouts: group(0) = instance data, group(1) = lighting, group(2) = material textures
        // Lighting layout must exist — create a dummy if missing (shouldn't happen in practice)
        const lightLayout = this.lightBindGroupLayout || this.device.createBindGroupLayout({
            label: 'DummyLightingLayout',
            entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
        });
        const pipelineLayouts = [this.bindGroupLayout, lightLayout, this.materialBindGroupLayout];
        
        const _pipelineBase = {
            vertex: { module: shaderModule, entryPoint: 'vertexMain' },
            fragment: { module: shaderModule, entryPoint: 'fragmentMain' },
            vertexLayout: [{
                arrayStride: ENTITY_VERTEX_STRIDE_BYTES,
                attributes: [
                    { shaderLocation: 0, offset: 0,  format: 'float32x3' },
                    { shaderLocation: 1, offset: 12, format: 'float32x3' },
                    { shaderLocation: 2, offset: 24, format: 'float32x2' },

                    { shaderLocation: 3, offset: 32, format: 'float32x4' },
                    { shaderLocation: 4, offset: 48, format: 'float32x2' }
                ]
            }],
            layouts: pipelineLayouts,
            colorFormat: format,
            blend: 'alpha',
            cullMode: 'none',
            frontFace: 'cw',
            depthFormat: 'depth24plus',
        };
        this.pipeline = this.vgpu.pipeline.render({
            ..._pipelineBase,
            depthWrite: true,
            depthCompare: 'less',
            label: 'EntityMeshPipeline'
        });
        this.xrayPipeline = this.vgpu.pipeline.render({
            ..._pipelineBase,
            depthWrite: false,
            depthCompare: 'always',
            label: 'EntityMeshPipelineXray'
        });
        
        // Shadow depth pipeline — renders entities from light's POV (depth-only)
        // Uses same vertex layout + instance buffer, minimal shader, no color output
        const shadowDepthSource = `
                struct FrameUniforms {
                    viewProj:  mat4x4f,
                    cameraPos: vec3f,
                    _pad:      f32,
                }
                struct Instance {
                    model:     mat4x4f,
                    color:     vec4f,
                    selection: vec4f,
                }
                struct ShadowVarying {
                    @builtin(position) position: vec4f,
                    @location(0) alpha: f32,
                }
                @group(0) @binding(0) var<uniform> frame: FrameUniforms;
                @group(0) @binding(1) var<storage, read> instances: array<Instance>;
                @vertex
                fn vs_shadow(
                    @location(0) position: vec3f,
                    @location(1) normal:   vec3f,
                    @location(2) uv:       vec2f,
                    @location(3) tangent:  vec4f,
                    @builtin(instance_index) instanceIdx: u32
                ) -> ShadowVarying {
                    let worldPos = instances[instanceIdx].model * vec4f(position, 1.0);
                    var out: ShadowVarying;
                    out.position = frame.viewProj * worldPos;
                    out.alpha = instances[instanceIdx].color.a;
                    return out;
                }
                @fragment fn fs_shadow(@location(0) alpha: f32) {
                    if (alpha < 0.05) { discard; }
                }
        `;
        const shadowModule = this.vgpu.shader.compile('entityShadowDepth', shadowDepthSource);
        // Shadow depth pipeline: depth32float for higher precision, front-face cull to reduce acne
        this._shadowDepthPipeline = this.vgpu.pipeline.render({
            vertex: { module: shadowModule, entryPoint: 'vs_shadow' },
            fragment: { module: shadowModule, entryPoint: 'fs_shadow' },
            vertexLayout: [{
                arrayStride: ENTITY_VERTEX_STRIDE_BYTES,
                attributes: [
                    { shaderLocation: 0, offset: 0,  format: 'float32x3' },
                    { shaderLocation: 1, offset: 12, format: 'float32x3' },
                    { shaderLocation: 2, offset: 24, format: 'float32x2' },

                    { shaderLocation: 3, offset: 32, format: 'float32x4' }
                ]
            }],
            layouts: [this.bindGroupLayout],
            colorFormats: [],
            depthFormat: 'depth32float',
            depthWrite: true,
            depthCompare: 'less',
            cullMode: 'none',
            frontFace: 'cw',
            topology: 'triangle-list',
            label: 'EntityShadowDepthPipeline'
        });
        // Separate uniform buffer + bind group for shadow pass (light viewProj)
        const { buffer: shadowFrameBuf, id: shadowFrameId } = this.vgpu.buffer.create({
            size: 80, usage: 'uniform', label: 'EntityShadowFrameUniforms'
        });
        this._shadowFrameBuffer = shadowFrameBuf;
        this._shadowFrameBufferId = shadowFrameId;
        this._shadowBindGroup = this.vgpu.bindings.createGroup(this.bindGroupLayout, [
            { binding: 0, buffer: this._shadowFrameBuffer },
            { binding: 1, buffer: this.instanceBuffer }
        ], 'EntityShadowBindGroup');
        
        this.createAllMeshes();
        console.log('[EntityMeshRenderer] Initialized with GPU INSTANCING + dynamic lighting, capacity:', INITIAL_CAPACITY);
    }
    
    /**
     * Call at start of frame to reset instance batches
     */
    beginFrame() {
        this.totalInstances = 0;
        // Reset batch counts (typed arrays persist — no GC pressure)
        for (const batch of this.meshBatches.values()) {
            batch.count = 0;
        }
        
        // Clean up buffers from previous frame (now safe - GPU finished using them)
        for (const bufferId of this._pendingBufferCleanup) {
            this.vgpu.buffer.release(bufferId);
        }
        this._pendingBufferCleanup.length = 0;
    }
    
    /**
     * Grow instance buffer to accommodate more entities
     */
    growBuffer(newCapacity) {
        // Defer release of old buffers until next frame (avoid destroying in-flight resources)
        if (this.instanceBufferId) {
            this._pendingBufferCleanup.push(this.instanceBufferId);
        }
        if (this.frameUniformBufferId) {
            this._pendingBufferCleanup.push(this.frameUniformBufferId);
        }
        
        this.bufferCapacity = newCapacity;
        
        // CPU-side instance data array — preserve existing data written this frame
        const newInstanceData = new Float32Array(newCapacity * FLOATS_PER_INSTANCE);
        if (this.instanceData && this.totalInstances > 0) {
            newInstanceData.set(this.instanceData.subarray(0, this.totalInstances * FLOATS_PER_INSTANCE));
        }
        this.instanceData = newInstanceData;
        
        // GPU instance storage buffer
        const { buffer: instBuffer, id: instId } = this.vgpu.buffer.create({
            size: INSTANCE_STRIDE * newCapacity,
            usage: 'storage',
            label: 'EntityInstanceBuffer'
        });
        this.instanceBuffer = instBuffer;
        this.instanceBufferId = instId;
        
        // GPU frame uniform buffer (viewProj mat4 + cameraPos vec3 + pad)
        const { buffer: frameBuffer, id: frameId } = this.vgpu.buffer.create({
            size: 80, // mat4x4f (64) + vec3 (12) + pad (4)
            usage: 'uniform',
            label: 'EntityFrameUniforms'
        });
        this.frameUniformBuffer = frameBuffer;
        this.frameUniformBufferId = frameId;
        
        // Rebuild bind group with new buffers
        this.bindGroup = this.vgpu.bindings.createGroup(this.bindGroupLayout, [
            { binding: 0, buffer: this.frameUniformBuffer },
            { binding: 1, buffer: this.instanceBuffer }
        ], 'EntityInstanceBindGroup');
        
        // Rebuild shadow bind group if it exists (uses same instance buffer)
        if (this._shadowFrameBuffer) {
            this._shadowBindGroup = this.vgpu.bindings.createGroup(this.bindGroupLayout, [
                { binding: 0, buffer: this._shadowFrameBuffer },
                { binding: 1, buffer: this.instanceBuffer }
            ], 'EntityShadowBindGroup');
        }
        
        console.log('[EntityMeshRenderer] Instance buffer grown to capacity:', newCapacity);
    }
    
    /**
     * Create a material bind group from a GPU texture view.
     * @param {string} materialId - Cache key
     * @param {GPUTextureView} albedoView - Albedo texture view (or null for default)
     * @param {GPUSampler|Object} [sampler] - Optional custom sampler, or material texture/normal-map options
     * @returns {GPUBindGroup}
     */
    createMaterialBindGroup(materialId, albedoView, sampler) {
        if (this._materialBindGroups.has(materialId)) {
            return this._materialBindGroups.get(materialId);
        }
        const options = sampler && typeof sampler === 'object' && (
            'sampler' in sampler
            || 'normalView' in sampler
            || 'normalScale' in sampler
            || 'normalTextureScale' in sampler
            || 'normalGreenSign' in sampler
            || 'normalGreenChannel' in sampler
            || 'normalTextureGreenChannel' in sampler
            || 'materialParamsBuffer' in sampler
        )
            ? sampler
            : { sampler };
        const textureSampler = options.sampler || this._defaultSampler;
        const normalView = options.normalView || this._defaultNormalTex.createView();
        const normalSampler = options.normalSampler || textureSampler;
        const metallicRoughnessSampler = options.metallicRoughnessSampler || textureSampler;
        const emissiveSampler = options.emissiveSampler || textureSampler;
        const occlusionSampler = options.occlusionSampler || textureSampler;
        const materialParamsBuffer = entityMaterialParamsBuffer(this, materialId, options);

        const bg = this.device.createBindGroup({
            layout: this.materialBindGroupLayout,
            entries: [
                { binding: 0, resource: textureSampler },
                { binding: 1, resource: albedoView || this._defaultAlbedoTex.createView() },

                { binding: 2, resource: normalView },
                { binding: 3, resource: { buffer: materialParamsBuffer } },
                { binding: 4, resource: normalSampler },
                { binding: 5, resource: metallicRoughnessSampler },
                { binding: 6, resource: options.metallicRoughnessView || this._defaultMetallicRoughnessTex.createView() },
                { binding: 7, resource: emissiveSampler },
                { binding: 8, resource: options.emissiveView || this._defaultEmissiveTex.createView() },
                { binding: 9, resource: occlusionSampler },
                { binding: 10, resource: options.occlusionView || this._defaultOcclusionTex.createView() },
            ],
            label: `MaterialBG_${materialId}`,
        });
        this._materialBindGroups.set(materialId, bg);
        return bg;
    }

    /**
     * Get a cached material bind group, or the default.
     * @param {string} materialId
     * @returns {GPUBindGroup}
     */
    getMaterialBindGroup(materialId) {
        return this._materialBindGroups.get(materialId) || this.defaultMaterialBindGroup;
    }

    /**
     * Invalidate a cached material bind group (e.g. when texture changes).
     * @param {string} materialId
     */
    invalidateMaterialBindGroup(materialId) {
        this._materialBindGroups.delete(materialId);
        this._materialParamBuffers?.delete(materialId);
    }

    /**
     * Interleave separate position/normal/uv/tangent arrays into a single vertex buffer.
     * Layout: pos3 + normal3 + uv0_2 + tangent4 + uv1_2 = 14 floats per vertex.
     * @param {number[]} positions - flat [x,y,z, x,y,z, ...]
     * @param {number[]} normals - flat [nx,ny,nz, ...]
     * @param {number[]} uvs - flat [u,v, u,v, ...] (optional, defaults to 0,0)
     * @param {number[]} indices - triangle indices
     * @param {string} meshType - cache key for SDF data
     * @param {number[]|Float32Array|null} tangents - flat [tx,ty,tz,handedness, ...]
     * @returns {{vertexBuffer: GPUBuffer, indexBuffer: GPUBuffer, indexCount: number}}
     */
    _buildMesh(positions, normals, uvs, indices, meshType, tangents = null, uv1s = null) {
        if (meshType) this._cacheMeshData(meshType, positions, indices, normals, uvs);
        
        const vertexCount = Math.floor(positions.length / 3);
        const hasUVs = uvs && uvs.length >= vertexCount * 2;
        const hasUV1s = uv1s && uv1s.length >= vertexCount * 2;
        const sourceTangents = tangents && tangents.length >= vertexCount * 4
            ? tangents
            : (hasUVs ? generateTangentsFromGeometry(positions, normals, uvs, indices) : null);
        const hasSourceTangents = sourceTangents && sourceTangents.length >= vertexCount * 4;
        const resolvedTangents = new Float32Array(vertexCount * 4);
        const vertices = new Float32Array(vertexCount * ENTITY_VERTEX_STRIDE_FLOATS);
        for (let i = 0; i < vertexCount; i++) {
            const vi = i * ENTITY_VERTEX_STRIDE_FLOATS;
            const pi = i * 3;
            const ui = i * 2;
            const ti = i * 4;
            const nx = normals[pi];
            const ny = normals[pi + 1];
            const nz = normals[pi + 2];

            vertices[vi]     = positions[pi];
            vertices[vi + 1] = positions[pi + 1];
            vertices[vi + 2] = positions[pi + 2];
            vertices[vi + 3] = nx;
            vertices[vi + 4] = ny;
            vertices[vi + 5] = nz;
            vertices[vi + 6] = hasUVs ? uvs[ui]     : 0;
            vertices[vi + 7] = hasUVs ? uvs[ui + 1] : 0;

            if (hasSourceTangents) {
                resolvedTangents[ti] = sourceTangents[ti];
                resolvedTangents[ti + 1] = sourceTangents[ti + 1];
                resolvedTangents[ti + 2] = sourceTangents[ti + 2];
                resolvedTangents[ti + 3] = sourceTangents[ti + 3] < 0 ? -1 : 1;
            } else {
                writeEntityFallbackTangent(resolvedTangents, ti, nx, ny, nz);
            }

            vertices[vi + 8] = resolvedTangents[ti];
            vertices[vi + 9] = resolvedTangents[ti + 1];
            vertices[vi + 10] = resolvedTangents[ti + 2];
            vertices[vi + 11] = resolvedTangents[ti + 3];
            vertices[vi + 12] = hasUV1s ? uv1s[ui] : 0;
            vertices[vi + 13] = hasUV1s ? uv1s[ui + 1] : 0;
        }
        
        const { buffer: vertexBuffer } = this.vgpu.buffer.create({ size: vertices.byteLength, usage: 'vertex', data: vertices });
        const indexData = indices instanceof Uint16Array ? indices : new Uint16Array(indices);
        // WebGPU requires buffer sizes to be a multiple of 4 when mappedAtCreation is true.
        // Uint16 index buffers with an odd element count produce byte sizes not aligned to 4.
        const indexByteSize = (indexData.byteLength + 3) & ~3; // align up to 4
        const { buffer: indexBuffer } = this.vgpu.buffer.create({ size: indexByteSize, usage: 'index', data: indexData });
        const mesh = {
            vertexBuffer,
            indexBuffer,
            indexCount: indexData.length,
            vertexStride: ENTITY_VERTEX_STRIDE_BYTES,
            _uvs: hasUVs ? uvs : null,
            _uv1s: hasUV1s ? uv1s : null,
            _tangents: resolvedTangents,
            _vertexCount: vertexCount,
        };
        if (meshType) mesh.boundingRadius = this.meshBoundingRadii[meshType] || 0.866;
        return mesh;
    }
    
    createAllMeshes() {
        this.meshes.cube = this.createCubeMesh();
        this.meshes.sphere = this.createSphereMesh(0.5, 16, 12);
        this.meshes.cylinder = this.createCylinderMesh(0.5, 1.0, 16);
        this.meshes.plane = this.createPlaneMesh(1.0, 1.0);
        this.meshes.capsule = this.createCapsuleMesh(0.3, 1.0, 16, 8);
        this.meshes.cone = this.createConeMesh(0.5, 1.0, 16);
        this.meshes.torus = this.createTorusMesh(0.35, 0.15, 16, 12);
        this.meshes.pyramid = this.createPyramidMesh(0.7, 1.0);
        this.meshes.prism = this.createPrismMesh(0.5, 1.0);
        this.meshes.wedge = this.createWedgeMesh(1.0, 1.0, 1.0); // Match sdfParams [0.5, 0.5, 0.5]
        this.meshes.tube = this.createTubeMesh(0.5, 0.3, 1.0, 16);
        this.meshes.icosphere = this.createIcosphereMesh(0.5, 1);
        this.meshes.hemisphere = this.createHemisphereMesh(0.5, 16, 8);
        this.meshes.ring = this.createRingMesh(0.5, 0.35, 24);
        this.meshes.disc = this.createDiscMesh(0.5, 24);
        this.meshes.stairs = this.createStairsMesh(1.0, 1.0, 1.0, 5);
        this.meshes.arch = this.createArchMesh(0.5, 0.3, 1.0, 12);
        this.meshes.helix = this.createHelixMesh(0.4, 0.08, 1.5, 2, 32);
        this.meshes.gear = this.createGearMesh(0.5, 0.35, 0.15, 8);
        this.meshes.star = this.createStarMesh(0.5, 0.25, 5, 0.15);
    }
    
    /**
     * Register a custom mesh (imported model) at runtime.
     * @param {string} meshType - e.g. 'custom_<uuid>'
     * @param {Float32Array|number[]} positions
     * @param {Float32Array|number[]} normals
     * @param {Float32Array|number[]|null} uvs
     * @param {Uint32Array|Uint16Array|number[]} indices
     * @param {Float32Array|number[]|null} tangents
     */
    registerCustomMesh(meshType, positions, normals, uvs, indices, tangents = null, uv1s = null) {
        if (this.meshes[meshType]) return; // already registered
        const posArr = positions instanceof Float32Array ? Array.from(positions) : positions;
        const normArr = normals instanceof Float32Array ? Array.from(normals) : normals;
        const uvArr = uvs ? (uvs instanceof Float32Array ? Array.from(uvs) : uvs) : null;
        const idxArr = indices instanceof Uint32Array || indices instanceof Uint16Array ? Array.from(indices) : indices;
        const tangentArr = tangents ? (tangents instanceof Float32Array ? Array.from(tangents) : tangents) : null;
        const uv1Arr = uv1s ? (uv1s instanceof Float32Array ? Array.from(uv1s) : uv1s) : null;
        this.meshes[meshType] = this._buildMesh(posArr, normArr, uvArr, idxArr, meshType, tangentArr, uv1Arr);
        console.log('[EntityMeshRenderer] Registered custom mesh:', meshType, 'boundingRadius:', this.meshBoundingRadii[meshType]?.toFixed(2));
    }

    /**
     * Update vertex buffer for a skinned mesh with new positions/normals.
     * Called each frame by the skeletal animation system.
     * @param {string} meshType
     * @param {Float32Array} positions - Skinned positions
     * @param {Float32Array} normals - Skinned normals
     * @param {Float32Array|null} skinnedTangents - Optional skinned tangent lanes
     */
    updateSkinnedMesh(meshType, positions, normals, skinnedTangents = null) {
        const mesh = this.meshes[meshType];
        if (!mesh) return;
        const vertexCount = mesh._vertexCount || (positions.length / 3);
        const uvs = mesh._uvs;
        const uv1s = mesh._uv1s;
        const tangents = skinnedTangents && skinnedTangents.length >= vertexCount * 4
            ? skinnedTangents
            : mesh._tangents;
        const hasUVs = uvs && uvs.length >= vertexCount * 2;
        const hasUV1s = uv1s && uv1s.length >= vertexCount * 2;
        const hasTangents = tangents && tangents.length >= vertexCount * 4;
        // Cache the interleave buffer to avoid ~320KB allocation per frame
        const needed = vertexCount * ENTITY_VERTEX_STRIDE_FLOATS;
        if (!mesh._skinInterleaveBuf || mesh._skinInterleaveBuf.length < needed) {
            mesh._skinInterleaveBuf = new Float32Array(needed);
            const buf = mesh._skinInterleaveBuf;
            for (let i = 0; i < vertexCount; i++) {
                const vi = i * ENTITY_VERTEX_STRIDE_FLOATS;
                const ui = i * 2;
                buf[vi + 6] = hasUVs ? uvs[ui] : 0;
                buf[vi + 7] = hasUVs ? uvs[ui + 1] : 0;
                buf[vi + 12] = hasUV1s ? uv1s[ui] : 0;
                buf[vi + 13] = hasUV1s ? uv1s[ui + 1] : 0;
                writeEntityFallbackTangent(buf, vi + 8, normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
            }
        }
        const vertices = mesh._skinInterleaveBuf;
        for (let i = 0; i < vertexCount; i++) {
            const vi = i * ENTITY_VERTEX_STRIDE_FLOATS, i3 = i * 3;
            const ti = i * 4;
            vertices[vi]     = positions[i3];
            vertices[vi + 1] = positions[i3 + 1];
            vertices[vi + 2] = positions[i3 + 2];
            vertices[vi + 3] = normals[i3];
            vertices[vi + 4] = normals[i3 + 1];
            vertices[vi + 5] = normals[i3 + 2];
            if (hasTangents) {
                writeEntitySkinnedTangent(
                    vertices,
                    vi + 8,
                    tangents[ti],
                    tangents[ti + 1],
                    tangents[ti + 2],
                    tangents[ti + 3],
                    normals[i3],
                    normals[i3 + 1],
                    normals[i3 + 2]
                );
            } else {
                writeEntityFallbackTangent(vertices, vi + 8, normals[i3], normals[i3 + 1], normals[i3 + 2]);
            }
            // UVs are static; tangent lanes are skinned by the caller when available and normalized here.
        }
        this.vgpu.device.queue.writeBuffer(mesh.vertexBuffer, 0, vertices);
    }

    /** Refresh local-space animated bounds without replacing static mesh/SDF data. */
    updateMeshBounds(meshType, bounds) {
        const min = bounds?.min;
        const max = bounds?.max;
        const valid = Array.isArray(min) && min.length === 3 && Array.isArray(max) && max.length === 3 &&
            min.every(Number.isFinite) && max.every(Number.isFinite) &&
            min.every((value, axis) => value <= max[axis]);
        if (!meshType || !valid || !this.meshes[meshType]) return false;
        const center = min.map((value, axis) => (value + max[axis]) * 0.5);
        const extents = min.map((value, axis) => (max[axis] - value) * 0.5);
        const radius = Number.isFinite(bounds.radius) && bounds.radius >= 0
            ? bounds.radius
            : Math.hypot(...extents);
        const previous = this.meshBoundingBoxes[meshType];
        const previousRadius = this.meshBoundingRadii[meshType];
        const unchanged = previous && previous.min.every((value, axis) => Object.is(value, min[axis])) &&
            previous.max.every((value, axis) => Object.is(value, max[axis])) && Object.is(previousRadius, radius);
        if (unchanged) return false;
        this.meshBoundingBoxes[meshType] = {
            min: [...min], max: [...max], center, extents,
        };
        this.meshBoundingRadii[meshType] = radius;
        this.meshes[meshType].boundingRadius = radius;
        this.meshBoundsRevisions[meshType] = (this.meshBoundsRevisions[meshType] || 0) + 1;
        return true;
    }

    getMeshBoundsRevision(meshType) {
        return this.meshBoundsRevisions[meshType] || 0;
    }

    /**
     * Get raw mesh data for SDF generation
     * @param {string} meshType - The mesh type name
     * @returns {object|null} { positions: Float32Array, indices: Uint16Array } or null
     */
    getMeshData(meshType) {
        return this.meshDataCache.get(meshType) || null;
    }
    
    /**
     * Store raw mesh data for SDF generation + compute bounding volumes.
     * Computes both AABB (min/max/center/extents) and bounding sphere radius.
     * The AABB is in local mesh space (before entity transform).
     */
    _cacheMeshData(meshType, positions, indices, normals, uvs) {
        const posArr = positions instanceof Float32Array ? positions : new Float32Array(positions);
        const cached = {
            positions: posArr,
            indices: indices instanceof Uint16Array ? indices : (indices ? new Uint16Array(indices) : null)
        };
        if (normals) cached.normals = normals instanceof Float32Array ? normals : new Float32Array(normals);
        if (uvs) cached.uvs = uvs instanceof Float32Array ? uvs : new Float32Array(uvs);
        this.meshDataCache.set(meshType, cached);
        // Compute AABB from all vertices
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (let i = 0; i < posArr.length; i += 3) {
            const x = posArr[i], y = posArr[i + 1], z = posArr[i + 2];
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }
        const cx = (minX + maxX) * 0.5, cy = (minY + maxY) * 0.5, cz = (minZ + maxZ) * 0.5;
        const ex = (maxX - minX) * 0.5, ey = (maxY - minY) * 0.5, ez = (maxZ - minZ) * 0.5;
        this.meshBoundingBoxes[meshType] = {
            min: [minX, minY, minZ], max: [maxX, maxY, maxZ],
            center: [cx, cy, cz], extents: [ex, ey, ez]
        };
        // Bounding sphere radius from AABB center (tighter than from origin)
        let maxDistSq = 0;
        for (let i = 0; i < posArr.length; i += 3) {
            const dx = posArr[i] - cx, dy = posArr[i + 1] - cy, dz = posArr[i + 2] - cz;
            const distSq = dx * dx + dy * dy + dz * dz;
            if (distSq > maxDistSq) maxDistSq = distSq;
        }
        this.meshBoundingRadii[meshType] = Math.sqrt(maxDistSq);
    }
    
    /**
     * Get precomputed bounding sphere radius for a mesh type.
     * Custom/imported meshes that haven't loaded yet get a generous fallback (10.0)
     * to prevent false culling. Built-in types default to 0.866 (unit-cube diagonal).
     * @param {string} meshType
     * @returns {number}
     */
    getBoundingRadius(meshType) {
        const r = this.meshBoundingRadii[meshType];
        if (r !== undefined) return r;
        if (meshType && meshType.startsWith('custom_')) return 10.0;
        return 0.866;
    }
    
    /**
     * Get precomputed bounding volumes for a mesh type.
     * Returns AABB { min, max, center, extents } in local mesh space.
     * For entities, the caller must offset center by entity position and scale extents.
     * @param {string} meshType
     * @returns {{ min: number[], max: number[], center: number[], extents: number[] } | null}
     */
    getMeshBounds(meshType) {
        return this.meshBoundingBoxes[meshType] || null;
    }
    
    createCubeMesh() {
        // Source rows: pos3 + normal3 + uv2.
        const vertices = new Float32Array([
            // Front face
            -0.5, -0.5,  0.5,  0, 0, 1,  0, 1,
             0.5, -0.5,  0.5,  0, 0, 1,  1, 1,
             0.5,  0.5,  0.5,  0, 0, 1,  1, 0,
            -0.5,  0.5,  0.5,  0, 0, 1,  0, 0,
            // Back face
            -0.5, -0.5, -0.5,  0, 0, -1,  1, 1,
            -0.5,  0.5, -0.5,  0, 0, -1,  1, 0,
             0.5,  0.5, -0.5,  0, 0, -1,  0, 0,
             0.5, -0.5, -0.5,  0, 0, -1,  0, 1,
            // Top face
            -0.5,  0.5, -0.5,  0, 1, 0,  0, 0,
            -0.5,  0.5,  0.5,  0, 1, 0,  0, 1,
             0.5,  0.5,  0.5,  0, 1, 0,  1, 1,
             0.5,  0.5, -0.5,  0, 1, 0,  1, 0,
            // Bottom face
            -0.5, -0.5, -0.5,  0, -1, 0,  0, 1,
             0.5, -0.5, -0.5,  0, -1, 0,  1, 1,
             0.5, -0.5,  0.5,  0, -1, 0,  1, 0,
            -0.5, -0.5,  0.5,  0, -1, 0,  0, 0,
            // Right face
             0.5, -0.5, -0.5,  1, 0, 0,  1, 1,
             0.5,  0.5, -0.5,  1, 0, 0,  1, 0,
             0.5,  0.5,  0.5,  1, 0, 0,  0, 0,
             0.5, -0.5,  0.5,  1, 0, 0,  0, 1,
            // Left face
            -0.5, -0.5, -0.5, -1, 0, 0,  0, 1,
            -0.5, -0.5,  0.5, -1, 0, 0,  1, 1,
            -0.5,  0.5,  0.5, -1, 0, 0,  1, 0,
            -0.5,  0.5, -0.5, -1, 0, 0,  0, 0,
        ]);
        
        const indices = new Uint16Array([
            0, 1, 2, 0, 2, 3,
            4, 5, 6, 4, 6, 7,
            8, 9, 10, 8, 10, 11,
            12, 13, 14, 12, 14, 15,
            16, 17, 18, 16, 18, 19,
            20, 21, 22, 20, 22, 23
        ]);

        const positions = new Float32Array(24 * 3);
        const normals = new Float32Array(24 * 3);
        const uvs = new Float32Array(24 * 2);
        for (let i = 0; i < 24; i++) {
            positions[i * 3 + 0] = vertices[i * 8 + 0];
            positions[i * 3 + 1] = vertices[i * 8 + 1];
            positions[i * 3 + 2] = vertices[i * 8 + 2];
            normals[i * 3 + 0] = vertices[i * 8 + 3];
            normals[i * 3 + 1] = vertices[i * 8 + 4];
            normals[i * 3 + 2] = vertices[i * 8 + 5];
            uvs[i * 2 + 0] = vertices[i * 8 + 6];
            uvs[i * 2 + 1] = vertices[i * 8 + 7];
        }

        return this._buildMesh(positions, normals, uvs, indices, 'cube');
    }
    
    createSphereMesh(radius = 0.5, widthSegments = 16, heightSegments = 12) {
        const positions = [];
        const normals = [];
        const uvs = [];
        
        for (let y = 0; y <= heightSegments; y++) {
            const theta = (y / heightSegments) * Math.PI;
            const sinTheta = Math.sin(theta);
            const cosTheta = Math.cos(theta);
            
            for (let x = 0; x <= widthSegments; x++) {
                const phi = (x / widthSegments) * Math.PI * 2;
                const sinPhi = Math.sin(phi);
                const cosPhi = Math.cos(phi);
                
                positions.push(radius * sinTheta * cosPhi, radius * cosTheta, radius * sinTheta * sinPhi);
                normals.push(sinTheta * cosPhi, cosTheta, sinTheta * sinPhi);
                uvs.push(x / widthSegments, y / heightSegments);
            }
        }
        
        const indices = [];
        for (let y = 0; y < heightSegments; y++) {
            for (let x = 0; x < widthSegments; x++) {
                const a = y * (widthSegments + 1) + x;
                const b = a + widthSegments + 1;
                indices.push(a, b, a + 1, b, b + 1, a + 1);
            }
        }

        return this._buildMesh(positions, normals, uvs, indices, 'sphere');
    }
    
    createCylinderMesh(radius = 0.5, height = 1.0, segments = 16) {
        const positions = [], normals = [], uvs = [], indices = [];
        const hh = height / 2;
        
        for (let i = 0; i <= segments; i++) {
            const a = (i / segments) * Math.PI * 2;
            const u = i / segments;
            const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
            const nx = Math.cos(a), nz = Math.sin(a);
            positions.push(x, -hh, z, x, hh, z);
            normals.push(nx, 0, nz, nx, 0, nz);
            uvs.push(u, 1, u, 0);
        }
        for (let i = 0; i < segments; i++) {
            const a = i * 2;
            indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }

        return this._buildMesh(positions, normals, uvs, indices, 'cylinder');
    }
    
    createPlaneMesh(width = 1.0, height = 1.0) {
        const hw = width / 2, hh = height / 2;
        const positions = new Float32Array([
            -hw, 0, -hh,
             hw, 0, -hh,
             hw, 0,  hh,
            -hw, 0,  hh,
        ]);
        const normals = new Float32Array([
            0, 1, 0,
            0, 1, 0,
            0, 1, 0,
            0, 1, 0,
        ]);
        const uvs = new Float32Array([
            0, 0,
            1, 0,
            1, 1,
            0, 1,
        ]);
        const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

        return this._buildMesh(positions, normals, uvs, indices, 'plane');
    }
    
    createCapsuleMesh(radius = 0.3, height = 1.0, radialSegments = 16, hemisphereSegments = 8) {
        const positions = [], normals = [], uvs = [], indices = [];
        const cylinderHeight = height - radius * 2;
        const halfCylinder = cylinderHeight / 2;
        
        // Top hemisphere
        const totalSegments = hemisphereSegments * 2 + 1; // for UV v range
        for (let y = 0; y <= hemisphereSegments; y++) {
            const theta = (y / hemisphereSegments) * Math.PI * 0.5;
            const sinTheta = Math.sin(theta);
            const cosTheta = Math.cos(theta);
            
            for (let x = 0; x <= radialSegments; x++) {
                const phi = (x / radialSegments) * Math.PI * 2;
                const sinPhi = Math.sin(phi);
                const cosPhi = Math.cos(phi);
                
                const nx = sinTheta * cosPhi;
                const ny = cosTheta;
                const nz = sinTheta * sinPhi;
                
                positions.push(radius * nx, halfCylinder + radius * ny, radius * nz);
                normals.push(nx, ny, nz);
                uvs.push(x / radialSegments, y / totalSegments);
            }
        }
        
        // Cylinder body bottom ring
        const topRingStart = (hemisphereSegments + 1) * (radialSegments + 1);
        for (let x = 0; x <= radialSegments; x++) {
            const phi = (x / radialSegments) * Math.PI * 2;
            const cosPhi = Math.cos(phi);
            const sinPhi = Math.sin(phi);
            
            positions.push(radius * cosPhi, -halfCylinder, radius * sinPhi);
            normals.push(cosPhi, 0, sinPhi);
            uvs.push(x / radialSegments, (hemisphereSegments + 0.5) / totalSegments);
        }
        
        // Bottom hemisphere
        const bottomHemiStart = topRingStart + radialSegments + 1;
        for (let y = 0; y <= hemisphereSegments; y++) {
            const theta = Math.PI * 0.5 + (y / hemisphereSegments) * Math.PI * 0.5;
            const sinTheta = Math.sin(theta);
            const cosTheta = Math.cos(theta);
            
            for (let x = 0; x <= radialSegments; x++) {
                const phi = (x / radialSegments) * Math.PI * 2;
                const sinPhi = Math.sin(phi);
                const cosPhi = Math.cos(phi);
                
                const nx = sinTheta * cosPhi;
                const ny = cosTheta;
                const nz = sinTheta * sinPhi;
                
                positions.push(radius * nx, -halfCylinder + radius * ny, radius * nz);
                normals.push(nx, ny, nz);
                uvs.push(x / radialSegments, (hemisphereSegments + 1 + y) / totalSegments);
            }
        }
        
        // Indices for top hemisphere
        for (let y = 0; y < hemisphereSegments; y++) {
            for (let x = 0; x < radialSegments; x++) {
                const a = y * (radialSegments + 1) + x;
                const b = a + radialSegments + 1;
                indices.push(a, b, a + 1, b, b + 1, a + 1);
            }
        }
        
        // Connect top hemisphere to cylinder bottom ring
        const lastTopRow = hemisphereSegments * (radialSegments + 1);
        for (let x = 0; x < radialSegments; x++) {
            const a = lastTopRow + x;
            const b = topRingStart + x;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
        
        // Connect cylinder to bottom hemisphere
        for (let x = 0; x < radialSegments; x++) {
            const a = topRingStart + x;
            const b = bottomHemiStart + x;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
        
        // Indices for bottom hemisphere
        for (let y = 0; y < hemisphereSegments; y++) {
            for (let x = 0; x < radialSegments; x++) {
                const a = bottomHemiStart + y * (radialSegments + 1) + x;
                const b = a + radialSegments + 1;
                indices.push(a, b, a + 1, b, b + 1, a + 1);
            }
        }

        return this._buildMesh(positions, normals, uvs, indices, 'capsule');
    }
    
    createConeMesh(radius = 0.5, height = 1.0, segments = 16) {
        const positions = [], normals = [], uvs = [], indices = [];
        const halfHeight = height / 2;
        const slopeAngle = Math.atan2(radius, height);
        const ny = Math.cos(slopeAngle);
        const nLen = Math.sin(slopeAngle);
        
        // Create vertices for cone surface
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const u = i / segments;
            
            // Tip vertex
            positions.push(0, halfHeight, 0);
            normals.push(cos * nLen, ny, sin * nLen);
            uvs.push(u, 0);
            
            // Base vertex
            positions.push(cos * radius, -halfHeight, sin * radius);
            normals.push(cos * nLen, ny, sin * nLen);
            uvs.push(u, 1);
        }
        
        // Cone surface indices
        for (let i = 0; i < segments; i++) {
            const tip = i * 2;
            const base1 = tip + 1;
            const base2 = tip + 3;
            indices.push(tip, base1, base2);
        }
        
        // Base cap center
        const baseCenterIndex = positions.length / 3;
        positions.push(0, -halfHeight, 0);
        normals.push(0, -1, 0);
        uvs.push(0.5, 0.5);
        
        // Base cap ring
        const baseRingStart = positions.length / 3;
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            positions.push(Math.cos(angle) * radius, -halfHeight, Math.sin(angle) * radius);
            normals.push(0, -1, 0);
            uvs.push(Math.cos(angle) * 0.5 + 0.5, Math.sin(angle) * 0.5 + 0.5);
        }
        
        // Base cap indices (reverse winding for bottom face)
        for (let i = 0; i < segments; i++) {
            indices.push(baseCenterIndex, baseRingStart + i + 1, baseRingStart + i);
        }

        return this._buildMesh(positions, normals, uvs, indices, 'cone');
    }
    
    createTorusMesh(majorRadius = 0.35, minorRadius = 0.15, majorSegments = 16, minorSegments = 12) {
        const positions = [], normals = [], uvs = [], indices = [];
        
        for (let i = 0; i <= majorSegments; i++) {
            const u = (i / majorSegments) * Math.PI * 2;
            const cosU = Math.cos(u), sinU = Math.sin(u);
            
            for (let j = 0; j <= minorSegments; j++) {
                const v = (j / minorSegments) * Math.PI * 2;
                const cosV = Math.cos(v), sinV = Math.sin(v);
                
                const x = (majorRadius + minorRadius * cosV) * cosU;
                const y = minorRadius * sinV;
                const z = (majorRadius + minorRadius * cosV) * sinU;
                
                positions.push(x, y, z);
                normals.push(cosV * cosU, sinV, cosV * sinU);
                uvs.push(i / majorSegments, j / minorSegments);
            }
        }
        
        for (let i = 0; i < majorSegments; i++) {
            for (let j = 0; j < minorSegments; j++) {
                const a = i * (minorSegments + 1) + j;
                const b = a + minorSegments + 1;
                indices.push(a, b, a + 1, b, b + 1, a + 1);
            }
        }
        
        return this._buildMesh(positions, normals, uvs, indices, 'torus');
    }
    
    createPyramidMesh(baseSize = 0.7, height = 1.0) {
        const h = height / 2, b = baseSize / 2;
        const positions = [], normals = [], indices = [];
        
        // Calculate face normals
        const slopeAngle = Math.atan2(height, b);
        const ny = Math.sin(slopeAngle);
        const nLen = Math.cos(slopeAngle);
        
        // Front face
        positions.push(0, h, 0, -b, -h, b, b, -h, b);
        let n = [0, ny, nLen]; normals.push(...n, ...n, ...n);
        
        // Right face
        positions.push(0, h, 0, b, -h, b, b, -h, -b);
        n = [nLen, ny, 0]; normals.push(...n, ...n, ...n);
        
        // Back face
        positions.push(0, h, 0, b, -h, -b, -b, -h, -b);
        n = [0, ny, -nLen]; normals.push(...n, ...n, ...n);
        
        // Left face
        positions.push(0, h, 0, -b, -h, -b, -b, -h, b);
        n = [-nLen, ny, 0]; normals.push(...n, ...n, ...n);
        
        // Base (two triangles)
        positions.push(-b, -h, -b, b, -h, -b, b, -h, b, -b, -h, b);
        n = [0, -1, 0]; normals.push(...n, ...n, ...n, ...n);
        
        for (let i = 0; i < 4; i++) indices.push(i * 3, i * 3 + 1, i * 3 + 2);
        indices.push(12, 13, 14, 12, 14, 15);
        
        return this._buildMesh(positions, normals, null, indices, 'pyramid');
    }
    
    createPrismMesh(radius = 0.5, height = 1.0) {
        const h = height / 2;
        const positions = [], normals = [], indices = [];
        
        // Triangular prism with equilateral triangle base
        const pts = [];
        for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
            pts.push([Math.cos(a) * radius, Math.sin(a) * radius]);
        }
        
        // Top face
        positions.push(pts[0][0], h, pts[0][1], pts[1][0], h, pts[1][1], pts[2][0], h, pts[2][1]);
        normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
        
        // Bottom face
        positions.push(pts[0][0], -h, pts[0][1], pts[2][0], -h, pts[2][1], pts[1][0], -h, pts[1][1]);
        normals.push(0, -1, 0, 0, -1, 0, 0, -1, 0);
        
        // Side faces
        for (let i = 0; i < 3; i++) {
            const i2 = (i + 1) % 3;
            const dx = pts[i2][0] - pts[i][0], dz = pts[i2][1] - pts[i][1];
            const len = Math.sqrt(dx * dx + dz * dz);
            const nx = dz / len, nz = -dx / len;
            
            positions.push(pts[i][0], -h, pts[i][1], pts[i2][0], -h, pts[i2][1], pts[i2][0], h, pts[i2][1], pts[i][0], h, pts[i][1]);
            normals.push(nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz);
        }
        
        indices.push(0, 1, 2, 3, 4, 5);
        for (let i = 0; i < 3; i++) {
            const base = 6 + i * 4;
            indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
        
        return this._buildMesh(positions, normals, null, indices, 'prism');
    }
    
    createWedgeMesh(width = 1.0, height = 1.0, depth = 1.0) {
        const w = width / 2, h = height / 2, d = depth / 2; // Center vertically
        const positions = [], normals = [], indices = [];
        
        // Slope from front-top (-d, +h) to back-bottom (+d, -h) to match Wedge.js spawnable
        // Calculate slope normal (pointing up and forward)
        const slopeLen = Math.sqrt(height * height + depth * depth);
        const ny = depth / slopeLen, nz = height / slopeLen;
        
        // Slope face: front-top to back-bottom
        positions.push(-w, h, -d, w, h, -d, w, -h, d, -w, -h, d);
        normals.push(0, ny, nz, 0, ny, nz, 0, ny, nz, 0, ny, nz);
        
        // Bottom face
        positions.push(-w, -h, -d, w, -h, -d, w, -h, d, -w, -h, d);
        normals.push(0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0);
        
        // Front face (vertical at z=-d)
        positions.push(-w, -h, -d, -w, h, -d, w, h, -d, w, -h, -d);
        normals.push(0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1);
        
        // Left face (triangle)
        positions.push(-w, -h, -d, -w, -h, d, -w, h, -d);
        normals.push(-1, 0, 0, -1, 0, 0, -1, 0, 0);
        
        // Right face (triangle)
        positions.push(w, -h, -d, w, h, -d, w, -h, d);
        normals.push(1, 0, 0, 1, 0, 0, 1, 0, 0);
        
        indices.push(0, 1, 2, 0, 2, 3); // slope
        indices.push(4, 5, 6, 4, 6, 7); // bottom
        indices.push(8, 9, 10, 8, 10, 11); // front
        indices.push(12, 13, 14); // left
        indices.push(15, 16, 17); // right
        
        return this._buildMesh(positions, normals, null, indices, 'wedge');
    }
    
    createTubeMesh(outerRadius = 0.5, innerRadius = 0.3, height = 1.0, segments = 16) {
        const positions = [], normals = [], indices = [];
        const h = height / 2;
        
        // Outer wall
        for (let i = 0; i <= segments; i++) {
            const a = (i / segments) * Math.PI * 2;
            const c = Math.cos(a), s = Math.sin(a);
            positions.push(c * outerRadius, -h, s * outerRadius, c * outerRadius, h, s * outerRadius);
            normals.push(c, 0, s, c, 0, s);
        }
        
        // Inner wall
        const innerStart = (segments + 1) * 2;
        for (let i = 0; i <= segments; i++) {
            const a = (i / segments) * Math.PI * 2;
            const c = Math.cos(a), s = Math.sin(a);
            positions.push(c * innerRadius, -h, s * innerRadius, c * innerRadius, h, s * innerRadius);
            normals.push(-c, 0, -s, -c, 0, -s);
        }
        
        // Top ring
        const topStart = innerStart * 2;
        for (let i = 0; i <= segments; i++) {
            const a = (i / segments) * Math.PI * 2;
            const c = Math.cos(a), s = Math.sin(a);
            positions.push(c * outerRadius, h, s * outerRadius, c * innerRadius, h, s * innerRadius);
            normals.push(0, 1, 0, 0, 1, 0);
        }
        
        // Bottom ring
        const bottomStart = topStart + (segments + 1) * 2;
        for (let i = 0; i <= segments; i++) {
            const a = (i / segments) * Math.PI * 2;
            const c = Math.cos(a), s = Math.sin(a);
            positions.push(c * outerRadius, -h, s * outerRadius, c * innerRadius, -h, s * innerRadius);
            normals.push(0, -1, 0, 0, -1, 0);
        }
        
        for (let i = 0; i < segments; i++) {
            const a = i * 2;
            indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); // outer
            const b = innerStart + i * 2;
            indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); // inner (reversed)
            const t = topStart + i * 2;
            indices.push(t, t + 2, t + 1, t + 1, t + 2, t + 3); // top
            const bt = bottomStart + i * 2;
            indices.push(bt, bt + 1, bt + 2, bt + 1, bt + 3, bt + 2); // bottom (reversed)
        }
        
        return this._buildMesh(positions, normals, null, indices, 'tube');
    }
    
    createIcosphereMesh(radius = 0.5, subdivisions = 1) {
        const t = (1 + Math.sqrt(5)) / 2;
        let positions = [
            -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0,
            0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t,
            t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1
        ];
        let indices = [
            0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
            1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
            3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
            4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1
        ];
        
        const midpointCache = {};
        const getMidpoint = (i1, i2) => {
            const key = Math.min(i1, i2) + '_' + Math.max(i1, i2);
            if (midpointCache[key] !== undefined) return midpointCache[key];
            const x = (positions[i1 * 3] + positions[i2 * 3]) / 2;
            const y = (positions[i1 * 3 + 1] + positions[i2 * 3 + 1]) / 2;
            const z = (positions[i1 * 3 + 2] + positions[i2 * 3 + 2]) / 2;
            const len = Math.sqrt(x * x + y * y + z * z);
            positions.push(x / len, y / len, z / len);
            midpointCache[key] = positions.length / 3 - 1;
            return midpointCache[key];
        };
        
        for (let s = 0; s < subdivisions; s++) {
            const newIndices = [];
            for (let i = 0; i < indices.length; i += 3) {
                const a = indices[i], b = indices[i + 1], c = indices[i + 2];
                const ab = getMidpoint(a, b), bc = getMidpoint(b, c), ca = getMidpoint(c, a);
                newIndices.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
            }
            indices = newIndices;
        }
        
        const normals = [];
        for (let i = 0; i < positions.length; i += 3) {
            const len = Math.sqrt(positions[i] ** 2 + positions[i + 1] ** 2 + positions[i + 2] ** 2);
            normals.push(positions[i] / len, positions[i + 1] / len, positions[i + 2] / len);
            positions[i] *= radius / len;
            positions[i + 1] *= radius / len;
            positions[i + 2] *= radius / len;
        }
        
        return this._buildMesh(positions, normals, null, indices, 'icosphere');
    }
    
    createHemisphereMesh(radius = 0.5, widthSegments = 16, heightSegments = 8) {
        const positions = [], normals = [], indices = [];
        
        for (let y = 0; y <= heightSegments; y++) {
            const theta = (y / heightSegments) * Math.PI * 0.5;
            const sinTheta = Math.sin(theta), cosTheta = Math.cos(theta);
            
            for (let x = 0; x <= widthSegments; x++) {
                const phi = (x / widthSegments) * Math.PI * 2;
                const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);
                
                positions.push(radius * sinTheta * cosPhi, radius * cosTheta, radius * sinTheta * sinPhi);
                normals.push(sinTheta * cosPhi, cosTheta, sinTheta * sinPhi);
            }
        }
        
        // Base cap
        const baseStart = positions.length / 3;
        positions.push(0, 0, 0);
        normals.push(0, -1, 0);
        for (let x = 0; x <= widthSegments; x++) {
            const phi = (x / widthSegments) * Math.PI * 2;
            positions.push(Math.cos(phi) * radius, 0, Math.sin(phi) * radius);
            normals.push(0, -1, 0);
        }
        
        for (let y = 0; y < heightSegments; y++) {
            for (let x = 0; x < widthSegments; x++) {
                const a = y * (widthSegments + 1) + x;
                const b = a + widthSegments + 1;
                indices.push(a, b, a + 1, b, b + 1, a + 1);
            }
        }
        
        for (let x = 0; x < widthSegments; x++) {
            indices.push(baseStart, baseStart + x + 2, baseStart + x + 1);
        }
        
        return this._buildMesh(positions, normals, null, indices, 'hemisphere');
    }
    
    // Old duplicate _buildMesh removed; using the tangent-aware stride-12 _buildMesh at class top.
    
    createRingMesh(outerRadius = 0.5, innerRadius = 0.35, segments = 24) {
        const positions = [], normals = [], indices = [];
        
        // Top face
        for (let i = 0; i <= segments; i++) {
            const a = (i / segments) * Math.PI * 2;
            const c = Math.cos(a), s = Math.sin(a);
            positions.push(c * outerRadius, 0, s * outerRadius, c * innerRadius, 0, s * innerRadius);
            normals.push(0, 1, 0, 0, 1, 0);
        }
        
        // Bottom face
        const bottomStart = (segments + 1) * 2;
        for (let i = 0; i <= segments; i++) {
            const a = (i / segments) * Math.PI * 2;
            const c = Math.cos(a), s = Math.sin(a);
            positions.push(c * outerRadius, 0, s * outerRadius, c * innerRadius, 0, s * innerRadius);
            normals.push(0, -1, 0, 0, -1, 0);
        }
        
        for (let i = 0; i < segments; i++) {
            const t = i * 2;
            indices.push(t, t + 2, t + 1, t + 1, t + 2, t + 3);
            const b = bottomStart + i * 2;
            indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
        }
        
        return this._buildMesh(positions, normals, null, indices, 'ring');
    }
    
    createDiscMesh(radius = 0.5, segments = 24) {
        const positions = [], normals = [], indices = [];
        
        // Center top
        positions.push(0, 0, 0);
        normals.push(0, 1, 0);
        
        // Top ring
        for (let i = 0; i <= segments; i++) {
            const a = (i / segments) * Math.PI * 2;
            positions.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
            normals.push(0, 1, 0);
        }
        
        // Center bottom
        const bottomCenter = positions.length / 3;
        positions.push(0, 0, 0);
        normals.push(0, -1, 0);
        
        // Bottom ring
        for (let i = 0; i <= segments; i++) {
            const a = (i / segments) * Math.PI * 2;
            positions.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
            normals.push(0, -1, 0);
        }
        
        for (let i = 0; i < segments; i++) {
            indices.push(0, i + 1, i + 2);
            indices.push(bottomCenter, bottomCenter + i + 2, bottomCenter + i + 1);
        }
        
        return this._buildMesh(positions, normals, null, indices, 'disc');
    }
    
    createStairsMesh(width = 1.0, height = 1.0, depth = 1.0, steps = 5) {
        const positions = [], normals = [], indices = [];
        const w = width / 2;
        const h = height / 2; // Center vertically
        const stepH = height / steps;
        const stepD = depth / steps;
        
        for (let i = 0; i < steps; i++) {
            const y0 = i * stepH - h, y1 = (i + 1) * stepH - h;
            const z0 = -depth / 2 + i * stepD, z1 = z0 + stepD;
            const base = positions.length / 3;
            
            // Top of step
            positions.push(-w, y1, z0, w, y1, z0, w, y1, z1, -w, y1, z1);
            normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
            
            // Front of step (riser)
            positions.push(-w, y0, z0, w, y0, z0, w, y1, z0, -w, y1, z0);
            normals.push(0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1);
            
            indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
            indices.push(base + 4, base + 5, base + 6, base + 4, base + 6, base + 7);
        }
        
        // Sides
        const sideBase = positions.length / 3;
        for (let i = 0; i < steps; i++) {
            const y1 = (i + 1) * stepH - h;
            const z0 = -depth / 2 + i * stepD, z1 = z0 + stepD;
            positions.push(-w, -h, z0, -w, y1, z0, -w, y1, z1, -w, -h, z1);
            normals.push(-1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0);
            positions.push(w, -h, z0, w, -h, z1, w, y1, z1, w, y1, z0);
            normals.push(1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0);
        }
        
        for (let i = 0; i < steps * 2; i++) {
            const b = sideBase + i * 4;
            indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
        }
        
        return this._buildMesh(positions, normals, null, indices, 'stairs');
    }
    
    createArchMesh(outerRadius = 0.5, innerRadius = 0.3, height = 1.0, segments = 12) {
        const positions = [], normals = [], indices = [];
        const h = height / 2;
        const yOffset = outerRadius / 2; // Center vertically to match physics collider
        
        // Create arch (half circle extruded) - centered: Y from -outerRadius/2 to +outerRadius/2
        for (let i = 0; i <= segments; i++) {
            const a = (i / segments) * Math.PI;
            const c = Math.cos(a), s = Math.sin(a);
            
            // Outer surface (offset Y to center)
            positions.push(c * outerRadius, s * outerRadius - yOffset, -h, c * outerRadius, s * outerRadius - yOffset, h);
            normals.push(c, s, 0, c, s, 0);
            
            // Inner surface (offset Y to center)
            positions.push(c * innerRadius, s * innerRadius - yOffset, -h, c * innerRadius, s * innerRadius - yOffset, h);
            normals.push(-c, -s, 0, -c, -s, 0);
        }
        
        // Connect surfaces
        for (let i = 0; i < segments; i++) {
            const o = i * 4;
            indices.push(o, o + 4, o + 1, o + 1, o + 4, o + 5); // outer
            indices.push(o + 2, o + 3, o + 6, o + 3, o + 7, o + 6); // inner
        }
        
        // End caps
        const capStart = positions.length / 3;
        for (let i = 0; i <= segments; i++) {
            const a = (i / segments) * Math.PI;
            const c = Math.cos(a), s = Math.sin(a);
            positions.push(c * outerRadius, s * outerRadius - yOffset, -h, c * innerRadius, s * innerRadius - yOffset, -h);
            normals.push(0, 0, -1, 0, 0, -1);
            positions.push(c * outerRadius, s * outerRadius - yOffset, h, c * innerRadius, s * innerRadius - yOffset, h);
            normals.push(0, 0, 1, 0, 0, 1);
        }
        
        for (let i = 0; i < segments; i++) {
            const b = capStart + i * 4;
            indices.push(b, b + 1, b + 4, b + 1, b + 5, b + 4);
            indices.push(b + 2, b + 6, b + 3, b + 3, b + 6, b + 7);
        }
        
        return this._buildMesh(positions, normals, null, indices, 'arch');
    }
    
    createHelixMesh(radius = 0.4, tubeRadius = 0.08, height = 1.5, turns = 2, segments = 32) {
        const positions = [], normals = [], indices = [];
        const tubeSegments = 8;
        
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const angle = t * turns * Math.PI * 2;
            const y = -height / 2 + t * height;
            const cx = Math.cos(angle) * radius;
            const cz = Math.sin(angle) * radius;
            
            // Tangent for tube orientation
            const tx = -Math.sin(angle), tz = Math.cos(angle);
            const ty = height / (turns * Math.PI * 2 * radius);
            const tLen = Math.sqrt(tx * tx + ty * ty + tz * tz);
            
            for (let j = 0; j <= tubeSegments; j++) {
                const ta = (j / tubeSegments) * Math.PI * 2;
                const nx = Math.cos(ta) * Math.cos(angle) - Math.sin(ta) * ty / tLen * Math.sin(angle);
                const ny = Math.sin(ta) * tLen;
                const nz = Math.cos(ta) * Math.sin(angle) + Math.sin(ta) * ty / tLen * Math.cos(angle);
                
                positions.push(cx + nx * tubeRadius, y + ny * tubeRadius, cz + nz * tubeRadius);
                normals.push(nx, ny, nz);
            }
        }
        
        for (let i = 0; i < segments; i++) {
            for (let j = 0; j < tubeSegments; j++) {
                const a = i * (tubeSegments + 1) + j;
                const b = a + tubeSegments + 1;
                indices.push(a, b, a + 1, b, b + 1, a + 1);
            }
        }
        
        return this._buildMesh(positions, normals, null, indices, 'helix');
    }
    
    createGearMesh(outerRadius = 0.5, innerRadius = 0.35, thickness = 0.15, teeth = 8) {
        const positions = [], normals = [], indices = [];
        const h = thickness / 2;
        const toothDepth = (outerRadius - innerRadius) * 0.7;
        const segments = teeth * 4;
        
        // Generate gear profile
        const profile = [];
        for (let i = 0; i < teeth; i++) {
            const baseAngle = (i / teeth) * Math.PI * 2;
            const toothWidth = Math.PI / teeth * 0.6;
            profile.push({ a: baseAngle, r: innerRadius });
            profile.push({ a: baseAngle + toothWidth * 0.3, r: outerRadius });
            profile.push({ a: baseAngle + toothWidth * 0.7, r: outerRadius });
            profile.push({ a: baseAngle + toothWidth, r: innerRadius });
        }
        
        // Top and bottom faces
        const centerTop = 0;
        positions.push(0, h, 0); normals.push(0, 1, 0);
        
        for (const p of profile) {
            positions.push(Math.cos(p.a) * p.r, h, Math.sin(p.a) * p.r);
            normals.push(0, 1, 0);
        }
        
        const centerBottom = positions.length / 3;
        positions.push(0, -h, 0); normals.push(0, -1, 0);
        
        for (const p of profile) {
            positions.push(Math.cos(p.a) * p.r, -h, Math.sin(p.a) * p.r);
            normals.push(0, -1, 0);
        }
        
        // Top triangles
        for (let i = 0; i < profile.length; i++) {
            indices.push(centerTop, 1 + i, 1 + ((i + 1) % profile.length));
        }
        
        // Bottom triangles
        for (let i = 0; i < profile.length; i++) {
            indices.push(centerBottom, centerBottom + 1 + ((i + 1) % profile.length), centerBottom + 1 + i);
        }
        
        // Side walls
        const sideStart = positions.length / 3;
        for (let i = 0; i < profile.length; i++) {
            const p1 = profile[i], p2 = profile[(i + 1) % profile.length];
            const dx = Math.cos(p2.a) * p2.r - Math.cos(p1.a) * p1.r;
            const dz = Math.sin(p2.a) * p2.r - Math.sin(p1.a) * p1.r;
            const len = Math.sqrt(dx * dx + dz * dz);
            const nx = dz / len, nz = -dx / len;
            
            positions.push(Math.cos(p1.a) * p1.r, h, Math.sin(p1.a) * p1.r);
            positions.push(Math.cos(p2.a) * p2.r, h, Math.sin(p2.a) * p2.r);
            positions.push(Math.cos(p2.a) * p2.r, -h, Math.sin(p2.a) * p2.r);
            positions.push(Math.cos(p1.a) * p1.r, -h, Math.sin(p1.a) * p1.r);
            normals.push(nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz);
            
            const b = sideStart + i * 4;
            indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
        }
        
        return this._buildMesh(positions, normals, null, indices, 'gear');
    }
    
    createStarMesh(outerRadius = 0.5, innerRadius = 0.25, points = 5, thickness = 0.15) {
        const positions = [], normals = [], indices = [];
        const h = thickness / 2;
        
        // Generate star profile
        const profile = [];
        for (let i = 0; i < points * 2; i++) {
            const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
            const r = i % 2 === 0 ? outerRadius : innerRadius;
            profile.push({ a, r });
        }
        
        // Top face
        const centerTop = 0;
        positions.push(0, h, 0); normals.push(0, 1, 0);
        
        for (const p of profile) {
            positions.push(Math.cos(p.a) * p.r, h, Math.sin(p.a) * p.r);
            normals.push(0, 1, 0);
        }
        
        // Bottom face
        const centerBottom = positions.length / 3;
        positions.push(0, -h, 0); normals.push(0, -1, 0);
        
        for (const p of profile) {
            positions.push(Math.cos(p.a) * p.r, -h, Math.sin(p.a) * p.r);
            normals.push(0, -1, 0);
        }
        
        // Top triangles
        for (let i = 0; i < profile.length; i++) {
            indices.push(centerTop, 1 + i, 1 + ((i + 1) % profile.length));
        }
        
        // Bottom triangles
        for (let i = 0; i < profile.length; i++) {
            indices.push(centerBottom, centerBottom + 1 + ((i + 1) % profile.length), centerBottom + 1 + i);
        }
        
        // Side walls
        const sideStart = positions.length / 3;
        for (let i = 0; i < profile.length; i++) {
            const p1 = profile[i], p2 = profile[(i + 1) % profile.length];
            const dx = Math.cos(p2.a) * p2.r - Math.cos(p1.a) * p1.r;
            const dz = Math.sin(p2.a) * p2.r - Math.sin(p1.a) * p1.r;
            const len = Math.sqrt(dx * dx + dz * dz);
            const nx = dz / len, nz = -dx / len;
            
            positions.push(Math.cos(p1.a) * p1.r, h, Math.sin(p1.a) * p1.r);
            positions.push(Math.cos(p2.a) * p2.r, h, Math.sin(p2.a) * p2.r);
            positions.push(Math.cos(p2.a) * p2.r, -h, Math.sin(p2.a) * p2.r);
            positions.push(Math.cos(p1.a) * p1.r, -h, Math.sin(p1.a) * p1.r);
            normals.push(nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz);
            
            const b = sideStart + i * 4;
            indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
        }
        
        return this._buildMesh(positions, normals, null, indices, 'star');
    }
    
    /**
     * Queue an entity for instanced rendering (batched by mesh type + material)
     * Call flush() after all entities to issue draw calls
     * @param {GPURenderPassEncoder} renderPass - unused, kept for API compat
     * @param {Float32Array} viewProjMatrix
     * @param {number[]} position - [x, y, z]
     * @param {number[]} rotation - quaternion [x, y, z, w]
     * @param {number[]} scale - [x, y, z]
     * @param {number[]} color - [r, g, b, a]
     * @param {boolean} isSelected - highlight if selected
     * @param {string} meshType - 'cube', 'sphere', etc.
     * @param {number} roughness - PBR roughness 0=mirror, 1=rough (default 0.6)
     * @param {number} metallic - PBR metallic 0=dielectric, 1=metal (default 0.0)
     * @param {string|null} materialId - MaterialLibrary material ID (null = default)
     */
    renderEntity(renderPass, viewProjMatrix, position, rotation = [0,0,0,1], scale = [1,1,1], color = [0.6, 0.6, 0.6, 1.0], isSelected = false, meshType = 'cube', roughness = 0.6, metallic = 0.0, materialId = null, modelMatrix = null) {
        const mesh = this.meshes[meshType] || this.meshes.cube;
        if (!this.pipeline || !mesh) {
            return;
        }
        
        // Store viewProj for flush (only need to store once)
        if (!this._currentViewProj) {
            this._currentViewProj = viewProjMatrix;
        }
        if (!this._currentCameraPos && arguments[4]) {
            this._currentCameraPos = arguments[4];
        }
        
        // Grow buffer if needed
        if (this.totalInstances >= this.bufferCapacity) {
            this.growBuffer(this.bufferCapacity * GROWTH_FACTOR);
        }
        
        // Build model matrix from quaternion rotation and scale
        const qx = rotation[0], qy = rotation[1], qz = rotation[2], qw = rotation[3];
        const sx = scale[0], sy = scale[1], sz = scale[2];
        
        const xx = qx * qx, yy = qy * qy, zz = qz * qz;
        const xy = qx * qy, xz = qx * qz, yz = qy * qz;
        const wx = qw * qx, wy = qw * qy, wz = qw * qz;
        
        // Write instance data directly to CPU buffer (24 floats per instance)
        const offset = this.totalInstances * FLOATS_PER_INSTANCE;
        const data = this.instanceData;
        
        // Model matrix (16 floats). Imported parts may supply an exact affine
        // matrix so hierarchy shear is not lost through TRS decomposition.
        const exactMatrix = _isFiniteMat4(modelMatrix) ? modelMatrix : null;
        if (exactMatrix) {
            data.set(exactMatrix, offset);
        } else {
            data[offset + 0] = (1 - 2 * (yy + zz)) * sx;
            data[offset + 1] = (2 * (xy + wz)) * sx;
            data[offset + 2] = (2 * (xz - wy)) * sx;
            data[offset + 3] = 0;
            data[offset + 4] = (2 * (xy - wz)) * sy;
            data[offset + 5] = (1 - 2 * (xx + zz)) * sy;
            data[offset + 6] = (2 * (yz + wx)) * sy;
            data[offset + 7] = 0;
            data[offset + 8] = (2 * (xz + wy)) * sz;
            data[offset + 9] = (2 * (yz - wx)) * sz;
            data[offset + 10] = (1 - 2 * (xx + yy)) * sz;
            data[offset + 11] = 0;
            data[offset + 12] = position[0];
            data[offset + 13] = position[1];
            data[offset + 14] = position[2];
            data[offset + 15] = 1;
        }
        
        // Color (4 floats)
        data[offset + 16] = color[0];
        data[offset + 17] = color[1];
        data[offset + 18] = color[2];
        data[offset + 19] = isSelected ? 0.5 : (color[3] ?? 1.0); // 50% alpha when selected
        
        // Selection state (4 floats): x=isSelected, y=outlineWidth, z=roughness, w=metallic
        data[offset + 20] = isSelected ? 1.0 : 0.0;
        data[offset + 21] = 0.0;
        data[offset + 22] = roughness;
        data[offset + 23] = metallic;
        
        // Track which mesh type + material this instance belongs to
        // Batch key = meshType:materialId for per-material draw calls
        const actualMeshType = this.meshes[meshType] ? meshType : 'cube';
        const matKey = materialId || '__default__';
        const batchKey = actualMeshType + ':' + matKey;
        if (!this.meshBatches.has(batchKey)) {
            this.meshBatches.set(batchKey, { 
                data: new Float32Array(FLOATS_PER_INSTANCE * 32), // Pre-allocated typed array
                count: 0,
                capacity: 32,
                meshType: actualMeshType,
                materialId: matKey
            });
        }
        const batch = this.meshBatches.get(batchKey);
        
        // Grow batch buffer if needed
        if (batch.count >= batch.capacity) {
            const newCap = batch.capacity * 2;
            const newData = new Float32Array(FLOATS_PER_INSTANCE * newCap);
            newData.set(batch.data);
            batch.data = newData;
            batch.capacity = newCap;
        }
        
        // Copy 24 floats directly into typed array (no JS array push)
        const batchOffset = batch.count * FLOATS_PER_INSTANCE;
        batch.data.set(data.subarray(offset, offset + FLOATS_PER_INSTANCE), batchOffset);
        batch.count++;
        
        this.totalInstances++;
    }
    
    /**
     * Flush all batched instances - issues ONE draw call per mesh type
     * @param {GPURenderPassEncoder} renderPass
     * @param {Float32Array} viewProjMatrix - optional, uses stored if not provided
     * @param {number[]} cameraPos - [x,y,z] world-space camera position
     */
    flush(renderPass, viewProjMatrix, cameraPos) {
        if (this.totalInstances === 0 || !this.pipeline) return;
        
        const vp = viewProjMatrix || this._currentViewProj;
        if (!vp) return;
        
        // Upload frame uniforms: viewProj (64 bytes) + cameraPos (12 bytes) + pad (4 bytes)
        this.device.queue.writeBuffer(this.frameUniformBuffer, 0, vp);
        if (cameraPos || this._currentCameraPos) {
            const cp = cameraPos || this._currentCameraPos;
            if (!this._camPosData) this._camPosData = new Float32Array(4);
            this._camPosData[0] = cp[0]; this._camPosData[1] = cp[1];
            this._camPosData[2] = cp[2]; this._camPosData[3] = 0;
            this.device.queue.writeBuffer(this.frameUniformBuffer, 64, this._camPosData);
        }
        
        // Reorganize instance data: group by mesh type for contiguous draws
        // Use TypedArray for fast bulk copy instead of per-element assignment
        let writeOffset = 0;
        // Reuse batchOffsets map (avoids per-frame Map allocation)
        if (!this._batchOffsets) this._batchOffsets = new Map();
        const batchOffsets = this._batchOffsets;
        batchOffsets.clear();
        
        for (const [batchKey, batch] of this.meshBatches) {
            if (batch.count === 0) continue;
            
            batchOffsets.set(batchKey, writeOffset);
            
            // Direct typed array to typed array copy (zero intermediate allocation)
            const floatCount = batch.count * FLOATS_PER_INSTANCE;
            this.instanceData.set(
                batch.data.subarray(0, floatCount),
                writeOffset * FLOATS_PER_INSTANCE
            );
            writeOffset += batch.count;
        }
        
        // Single GPU upload for ALL instance data
        this.device.queue.writeBuffer(
            this.instanceBuffer, 
            0, 
            this.instanceData, 
            0, 
            this.totalInstances * FLOATS_PER_INSTANCE
        );
        
        // Snapshot for shadow depth pass — flushXray() may overwrite the GPU
        // instance buffer before flushShadowDepth() runs, so keep a CPU copy.
        this._shadowTotal = this.totalInstances;
        const byteLen = this.totalInstances * FLOATS_PER_INSTANCE;
        if (!this._shadowDataCopy || this._shadowDataCopy.length < byteLen) {
            this._shadowDataCopy = new Float32Array(byteLen);
        }
        this._shadowDataCopy.set(this.instanceData.subarray(0, byteLen));
        if (!this._shadowBatchSnap) this._shadowBatchSnap = new Map();
        this._shadowBatchSnap.clear();
        for (const [k, b] of this.meshBatches) {
            if (b.count > 0) this._shadowBatchSnap.set(k, { meshType: b.meshType, count: b.count, offset: batchOffsets.get(k) ?? 0 });
        }
        
        // Set pipeline and bind groups
        renderPass.setPipeline(this.pipeline);
        renderPass.setBindGroup(0, this.bindGroup);
        if (this._lightBindGroup) {
            renderPass.setBindGroup(1, this._lightBindGroup);
        }
        
        // Issue draw calls per (meshType, materialId) batch
        let lastMeshType = null;
        let lastMatKey = null;
        for (const [batchKey, batch] of this.meshBatches) {
            if (batch.count === 0) continue;
            const mesh = this.meshes[batch.meshType];
            if (!mesh) continue;
            
            const instanceOffset = batchOffsets.get(batchKey);
            
            // Only re-bind vertex/index buffers when mesh type changes
            if (batch.meshType !== lastMeshType) {
                renderPass.setVertexBuffer(0, mesh.vertexBuffer);
                renderPass.setIndexBuffer(mesh.indexBuffer, 'uint16');
                lastMeshType = batch.meshType;
            }
            
            // Set material bind group when material changes
            if (batch.materialId !== lastMatKey) {
                const matBG = (batch.materialId === '__default__')
                    ? this.defaultMaterialBindGroup
                    : (this._materialBindGroups.get(batch.materialId) || this.defaultMaterialBindGroup);
                renderPass.setBindGroup(2, matBG);
                lastMatKey = batch.materialId;
            }
            
            renderPass.drawIndexed(mesh.indexCount, batch.count, 0, 0, instanceOffset);
        }
        
        // Clear for next frame
        this._currentViewProj = null;
        this._currentCameraPos = null;
    }

    /**
     * Flush using the X-ray pipeline — depth test always passes, no depth write.
     * Use for skeleton/diagnostic geometry that must show through opaque overlays.
     */
    flushXray(renderPass, viewProjMatrix, cameraPos) {
        if (this.totalInstances === 0 || !this.xrayPipeline) return;

        const vp = viewProjMatrix || this._currentViewProj;
        if (!vp) return;

        this.device.queue.writeBuffer(this.frameUniformBuffer, 0, vp);
        if (cameraPos || this._currentCameraPos) {
            const cp = cameraPos || this._currentCameraPos;
            if (!this._camPosData) this._camPosData = new Float32Array(4);
            this._camPosData[0] = cp[0]; this._camPosData[1] = cp[1];
            this._camPosData[2] = cp[2]; this._camPosData[3] = 0;
            this.device.queue.writeBuffer(this.frameUniformBuffer, 64, this._camPosData);
        }

        let writeOffset = 0;
        if (!this._batchOffsetsXray) this._batchOffsetsXray = new Map();
        const batchOffsets = this._batchOffsetsXray;
        batchOffsets.clear();

        for (const [batchKey, batch] of this.meshBatches) {
            if (batch.count === 0) continue;
            batchOffsets.set(batchKey, writeOffset);
            const floatCount = batch.count * FLOATS_PER_INSTANCE;
            this.instanceData.set(batch.data.subarray(0, floatCount), writeOffset * FLOATS_PER_INSTANCE);
            writeOffset += batch.count;
        }

        this.device.queue.writeBuffer(this.instanceBuffer, 0, this.instanceData, 0, this.totalInstances * FLOATS_PER_INSTANCE);

        renderPass.setPipeline(this.xrayPipeline);
        renderPass.setBindGroup(0, this.bindGroup);
        if (this._lightBindGroup) renderPass.setBindGroup(1, this._lightBindGroup);

        let lastMeshType = null, lastMatKey = null;
        for (const [batchKey, batch] of this.meshBatches) {
            if (batch.count === 0) continue;
            const mesh = this.meshes[batch.meshType];
            if (!mesh) continue;
            const instanceOffset = batchOffsets.get(batchKey);
            if (batch.meshType !== lastMeshType) {
                renderPass.setVertexBuffer(0, mesh.vertexBuffer);
                renderPass.setIndexBuffer(mesh.indexBuffer, 'uint16');
                lastMeshType = batch.meshType;
            }
            if (batch.materialId !== lastMatKey) {
                const matBG = (batch.materialId === '__default__')
                    ? this.defaultMaterialBindGroup
                    : (this._materialBindGroups.get(batch.materialId) || this.defaultMaterialBindGroup);
                renderPass.setBindGroup(2, matBG);
                lastMatKey = batch.materialId;
            }
            renderPass.drawIndexed(mesh.indexCount, batch.count, 0, 0, instanceOffset);
        }

        this._currentViewProj = null;
        this._currentCameraPos = null;
    }

    /**
     * Re-draw all this frame's batched instances into a shadow depth map.
     * Must be called AFTER flush() (reuses the same GPU instance buffer data).
     * @param {GPURenderPassEncoder} renderPass - depth-only pass targeting shadow map
     * @param {Float32Array} lightViewProj - 4x4 light view-projection matrix
     */
    flushShadowDepth(renderPass, lightViewProj) {
        // Use saved snapshot from flush() — diagnostic overlay may have
        // overwritten the GPU instance buffer via flushXray() since then.
        const total = this._shadowTotal ?? this.totalInstances;
        if (total === 0 || !this._shadowDepthPipeline) return;
        if (!lightViewProj) return;

        // Re-upload main entity instance data if a snapshot exists
        // (flushXray may have overwritten the GPU buffer)
        if (this._shadowDataCopy && this._shadowTotal != null) {
            this.device.queue.writeBuffer(
                this.instanceBuffer, 0,
                this._shadowDataCopy, 0,
                this._shadowTotal * FLOATS_PER_INSTANCE
            );
        }

        // Upload light viewProj to shadow uniform buffer
        this.device.queue.writeBuffer(this._shadowFrameBuffer, 0, lightViewProj);

        renderPass.setPipeline(this._shadowDepthPipeline);
        renderPass.setBindGroup(0, this._shadowBindGroup);

        // Draw from snapshot batches (immune to diagnostic overlay resets)
        const batches = this._shadowBatchSnap || this.meshBatches;
        let lastMeshType = null;
        for (const [batchKey, snap] of batches) {
            const count = snap.count || 0;
            if (count === 0) continue;
            const meshType = snap.meshType;
            const mesh = this.meshes[meshType];
            if (!mesh) continue;
            const instanceOffset = (this._shadowBatchSnap) ? snap.offset : (this._batchOffsets?.get(batchKey) ?? 0);
            if (meshType !== lastMeshType) {
                renderPass.setVertexBuffer(0, mesh.vertexBuffer);
                renderPass.setIndexBuffer(mesh.indexBuffer, 'uint16');
                lastMeshType = meshType;
            }
            renderPass.drawIndexed(mesh.indexCount, count, 0, 0, instanceOffset);
        }

        // Clear snapshot (consumed)
        this._shadowTotal = null;
    }

    // ========================================================================
    // POINT CLOUD RENDERING (Billboard quad per point)
    // ========================================================================

    /**
     * Register a point cloud for rendering.
     * @param {number} entityId - Entity ID owning this point cloud
     * @param {Float32Array} points - Positions stride 3 (local space)
     * @param {Float32Array|null} colors - Per-point RGB stride 3, 0-1 range
     * @param {number} pointSize - World-space point radius
     */
    registerPointCloud(entityId, points, colors, pointSize = 0.02) {
        if (!this._pointClouds) this._pointClouds = new Map();
        
        // Lazy-init pipeline on first registration
        if (!this._pcPipeline) this._initPointCloudPipeline();
        
        // Unregister old entry if re-registering
        this.unregisterPointCloud(entityId);
        
        const count = (points.length / 3) | 0;
        if (count === 0) return;
        
        // Interleave positions + colors into a single buffer: [x,y,z, r,g,b] per point
        const stride = 6; // 3 pos + 3 color
        const data = new Float32Array(count * stride);
        const hasColors = colors && colors.length >= count * 3;
        for (let i = 0; i < count; i++) {
            data[i * stride]     = points[i * 3];
            data[i * stride + 1] = points[i * 3 + 1];
            data[i * stride + 2] = points[i * 3 + 2];
            data[i * stride + 3] = hasColors ? colors[i * 3]     : 0.4;
            data[i * stride + 4] = hasColors ? colors[i * 3 + 1] : 0.7;
            data[i * stride + 5] = hasColors ? colors[i * 3 + 2] : 1.0;
        }
        
        // Create GPU storage buffer for point data
        const { buffer: pointBuffer } = this.vgpu.buffer.create({
            size: data.byteLength,
            usage: 'storage',
            data,
            label: `PointCloud_${entityId}_data`,
        });
        
        // Create params uniform: [entityPosX, entityPosY, entityPosZ, pointSize]
        const paramsData = new Float32Array(4);
        paramsData[3] = pointSize;
        const { buffer: paramsBuffer } = this.vgpu.buffer.create({
            size: 16,
            usage: 'uniform',
            data: paramsData,
            label: `PointCloud_${entityId}_params`,
        });
        
        // Create bind group: group(1) for per-cloud data
        const cloudBindGroup = this.device.createBindGroup({
            layout: this._pcCloudLayout,
            entries: [
                { binding: 0, resource: { buffer: pointBuffer } },
                { binding: 1, resource: { buffer: paramsBuffer } },
            ],
            label: `PointCloudBG_${entityId}`,
        });
        
        this._pointClouds.set(entityId, {
            buffer: pointBuffer,
            paramsBuffer,
            bindGroup: cloudBindGroup,
            count,
            pointSize,
            paramsData,
        });
        
        console.log(`[EntityMeshRenderer] Registered point cloud: entity=${entityId}, ${count} points`);
    }
    
    /**
     * Unregister and release GPU resources for a point cloud.
     * @param {number} entityId
     */
    unregisterPointCloud(entityId) {
        if (!this._pointClouds) return;
        const entry = this._pointClouds.get(entityId);
        if (!entry) return;
        entry.buffer.destroy();
        entry.paramsBuffer.destroy();
        this._pointClouds.delete(entityId);
    }
    
    /**
     * Update the entity-space offset and point size for a point cloud.
     * Call each frame with the entity's world position.
     * @param {number} entityId
     * @param {number[]} position - [x,y,z] world position
     * @param {number} [pointSize] - optional new point size
     */
    updatePointCloudTransform(entityId, position, pointSize) {
        if (!this._pointClouds) return;
        const entry = this._pointClouds.get(entityId);
        if (!entry) return;
        entry.paramsData[0] = position[0];
        entry.paramsData[1] = position[1];
        entry.paramsData[2] = position[2];
        if (pointSize !== undefined) entry.paramsData[3] = pointSize;
        this.device.queue.writeBuffer(entry.paramsBuffer, 0, entry.paramsData);
    }
    
    /**
     * Render all registered point clouds.
     * Call after flush() in the same render pass.
     * @param {GPURenderPassEncoder} renderPass
     * @param {Float32Array} viewProjMatrix
     * @param {number[]} cameraPos
     */
    renderPointClouds(renderPass, viewProjMatrix, cameraPos) {
        if (!this._pointClouds || this._pointClouds.size === 0 || !this._pcPipeline) return;
        
        // Upload frame uniforms (may already be uploaded by flush(), but ensure correctness)
        this.device.queue.writeBuffer(this._pcFrameBuffer, 0, viewProjMatrix);
        if (cameraPos) {
            if (!this._pcCamData) this._pcCamData = new Float32Array(4);
            this._pcCamData[0] = cameraPos[0];
            this._pcCamData[1] = cameraPos[1];
            this._pcCamData[2] = cameraPos[2];
            this.device.queue.writeBuffer(this._pcFrameBuffer, 64, this._pcCamData);
        }
        
        renderPass.setPipeline(this._pcPipeline);
        renderPass.setBindGroup(0, this._pcFrameBindGroup);
        
        for (const [entityId, entry] of this._pointClouds) {
            renderPass.setBindGroup(1, entry.bindGroup);
            // 6 vertices per point (2 triangles for billboard quad)
            renderPass.draw(6 * entry.count);
        }
    }
    
    /**
     * @private Initialize the point cloud rendering pipeline (lazy, on first use).
     */
    _initPointCloudPipeline() {
        const shaderSource = `
            struct FrameUniforms {
                viewProj:  mat4x4f,
                cameraPos: vec3f,
                _pad:      f32,
            }
            
            struct PointData {
                x: f32, y: f32, z: f32,
                r: f32, g: f32, b: f32,
            }
            
            struct CloudParams {
                entityPos: vec3f,
                pointSize: f32,
            }
            
            @group(0) @binding(0) var<uniform> frame: FrameUniforms;
            @group(1) @binding(0) var<storage, read> points: array<PointData>;
            @group(1) @binding(1) var<uniform> cloud: CloudParams;
            
            struct VSOut {
                @builtin(position) position: vec4f,
                @location(0) color: vec3f,
                @location(1) uv: vec2f,
            }
            
            @vertex
            fn vs_pc(@builtin(vertex_index) vid: u32) -> VSOut {
                let pointIdx = vid / 6u;
                let cornerIdx = vid % 6u;
                
                let p = points[pointIdx];
                let worldPos = vec3f(p.x, p.y, p.z) + cloud.entityPos;
                let clipPos = frame.viewProj * vec4f(worldPos, 1.0);
                
                // Billboard quad corners in NDC (camera-facing)
                // Triangle strip: 0,1,2 and 3,4,5
                var offsets = array<vec2f, 6>(
                    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
                    vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0)
                );
                let corner = offsets[cornerIdx];
                
                // Scale point size: world-space radius -> clip-space offset
                // Divide by w to get NDC, multiply by pointSize
                let aspect = 1.0; // Assume square-ish viewport; slight stretch is acceptable
                var result: VSOut;
                result.position = clipPos;
                result.position.x += corner.x * cloud.pointSize * clipPos.w * 0.05;
                result.position.y += corner.y * cloud.pointSize * clipPos.w * 0.05;
                result.color = vec3f(p.r, p.g, p.b);
                result.uv = corner * 0.5 + 0.5;
                return result;
            }
            
            @fragment
            fn fs_pc(input: VSOut) -> @location(0) vec4f {
                // Circular point: discard outside unit circle
                let d = length(input.uv - vec2f(0.5));
                if (d > 0.5) { discard; }
                // Soft edge
                let alpha = 1.0 - smoothstep(0.35, 0.5, d);
                return vec4f(input.color, alpha);
            }
        `;
        
        const module = this.vgpu.shader.compile('pointCloudSprite', shaderSource);
        
        // Frame uniforms layout (group 0) - same structure as main pipeline
        const pcFrameLayout = this.device.createBindGroupLayout({
            label: 'PointCloudFrameLayout',
            entries: [{
                binding: 0,
                visibility: GPUShaderStage.VERTEX,
                buffer: { type: 'uniform', minBindingSize: 80 },
            }],
        });
        
        // Per-cloud data layout (group 1)
        this._pcCloudLayout = this.device.createBindGroupLayout({
            label: 'PointCloudDataLayout',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: 'read-only-storage' },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: 'uniform', minBindingSize: 16 },
                },
            ],
        });
        
        const pipelineLayout = this.device.createPipelineLayout({
            label: 'PointCloudPipelineLayout',
            bindGroupLayouts: [pcFrameLayout, this._pcCloudLayout],
        });
        
        this._pcPipeline = this.device.createRenderPipeline({
            label: 'PointCloudPipeline',
            layout: pipelineLayout,
            vertex: {
                module,
                entryPoint: 'vs_pc',
            },
            fragment: {
                module,
                entryPoint: 'fs_pc',
                targets: [{
                    format: navigator.gpu?.getPreferredCanvasFormat?.() || 'bgra8unorm',
                    blend: {
                        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
                        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
                    },
                }],
            },
            primitive: { topology: 'triangle-list' },
            depthStencil: {
                format: 'depth24plus',
                depthWriteEnabled: true,
                depthCompare: 'less',
            },
        });
        
        // Create frame uniform buffer for point cloud pass
        const { buffer: pcFrameBuf } = this.vgpu.buffer.create({
            size: 80,
            usage: 'uniform',
            label: 'PointCloudFrameUniforms',
        });
        this._pcFrameBuffer = pcFrameBuf;
        
        this._pcFrameBindGroup = this.device.createBindGroup({
            layout: pcFrameLayout,
            entries: [{ binding: 0, resource: { buffer: this._pcFrameBuffer } }],
            label: 'PointCloudFrameBG',
        });
        
        console.log('[EntityMeshRenderer] Point cloud pipeline initialized');
    }
}
