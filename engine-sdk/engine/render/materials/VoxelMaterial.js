// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * VoxelMaterial.js - Production Voxel Material Implementation
 * Now powered by vGPU driver
 * 
 * Demonstrates the complete material system architecture:
 * - Frequency-based bind groups (Frame/Material/Chunk)
 * - std140-compliant uniform layouts
 * - Pipeline specialization with override constants
 * - Modular shader composition
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import { normalizeVoxelMaterialUniforms } from '../../core/math/MathPacking.js';
import {
    Std140StructBuilder,
    BIND_GROUP_FREQUENCY,
    BindGroupLayoutBuilder,
    FrameBindGroup,
    MaterialBindGroup,
    ObjectBindGroup,
    PipelineOverrides,
    PipelineDescriptor,
    RenderStateDescriptor,
    PipelineCache,
    ShaderModuleCache,
    ShaderChunkRegistry,
    STANDARD_CHUNKS,
} from './index.js';

// =============================================================================
// VOXEL SHADER WITH OVERRIDE CONSTANTS
// =============================================================================

const VOXEL_SHADER_WGSL = /* wgsl */ `
// ============================================================================
// PIPELINE OVERRIDE CONSTANTS
// These enable dead code elimination at compile time
// ============================================================================
override USE_TRIPLANAR: bool = true;
override USE_SHADOWS: bool = true;
override USE_AERIAL_PERSPECTIVE: bool = true;
override USE_WATER_CAUSTICS: bool = true;
override USE_PROCEDURAL_DETAIL: bool = true;
override ALPHA_CUTOFF: f32 = 0.5;

// ============================================================================
// BIND GROUP 0: FRAME UNIFORMS (Updated once per frame)
// ============================================================================
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
    fogColor: vec3<f32>,
    fogDensity: f32,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var shadowMap: texture_depth_2d;
@group(0) @binding(2) var shadowSampler: sampler_comparison;
@group(0) @binding(3) var waterHeightMap: texture_depth_2d;
@group(0) @binding(4) var waterSampler: sampler;
@group(0) @binding(5) var aerialPerspectiveLUT: texture_3d<f32>;
@group(0) @binding(6) var aerialPerspectiveSampler: sampler;

// ============================================================================
// BIND GROUP 1: MATERIAL UNIFORMS (Updated once per material batch)
// ============================================================================
struct MaterialUniforms {
    baseColor: vec4<f32>,
    emissive: vec3<f32>,
    metallic: f32,
    roughness: f32,
    triplanarScale: f32,
    triplanarSharpness: f32,
    _pad: f32,
}

@group(1) @binding(0) var<uniform> material: MaterialUniforms;

// ============================================================================
// BIND GROUP 2: CHUNK/OBJECT UNIFORMS (Updated once per draw call)
// ============================================================================
struct ChunkUniforms {
    worldOffset: vec3<f32>,
    blend: f32,
    morphFactor: f32,
    lodLevel: f32,
    cameraDistance: f32,
    _pad: f32,
}

@group(2) @binding(0) var<uniform> chunk: ChunkUniforms;

// ============================================================================
// VERTEX STRUCTURES
// ============================================================================
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
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
fn saturate(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn saturate3(v: vec3<f32>) -> vec3<f32> { return clamp(v, vec3(0.0), vec3(1.0)); }

fn hash3(p: vec3<f32>) -> f32 {
    var p3 = fract(p * 0.1031);
    p3 = p3 + dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn noise3D(p: vec3<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    
    return mix(
        mix(mix(hash3(i + vec3(0.0, 0.0, 0.0)), hash3(i + vec3(1.0, 0.0, 0.0)), u.x),
            mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
        mix(mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), u.x),
            mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), u.x), u.y),
        u.z
    );
}

// ============================================================================
// SHADOW SAMPLING (Conditional via USE_SHADOWS)
// ============================================================================
fn sampleShadowPCF(shadowCoord: vec4<f32>) -> f32 {
    if (!USE_SHADOWS) {
        return 1.0;
    }
    
    let projCoord = shadowCoord.xyz / shadowCoord.w;
    if (projCoord.x < 0.0 || projCoord.x > 1.0 || 
        projCoord.y < 0.0 || projCoord.y > 1.0 ||
        projCoord.z < 0.0 || projCoord.z > 1.0) {
        return 1.0;
    }
    
    var shadow = 0.0;
    let texelSize = 1.0 / 2048.0;
    
    for (var x = -1; x <= 1; x++) {
        for (var y = -1; y <= 1; y++) {
            let offset = vec2<f32>(f32(x), f32(y)) * texelSize;
            shadow += textureSampleCompare(
                shadowMap, shadowSampler,
                projCoord.xy + offset, projCoord.z - 0.002
            );
        }
    }
    
    return shadow / 9.0;
}

// ============================================================================
// TRIPLANAR MAPPING (Conditional via USE_TRIPLANAR)
// ============================================================================
fn triplanarWeights(normal: vec3<f32>) -> vec3<f32> {
    if (!USE_TRIPLANAR) {
        return vec3<f32>(0.0, 1.0, 0.0);
    }
    
    var weights = abs(normal);
    weights = pow(weights, vec3(material.triplanarSharpness));
    weights = weights / (weights.x + weights.y + weights.z + 0.0001);
    return weights;
}

fn triplanarNoise(worldPos: vec3<f32>, normal: vec3<f32>) -> f32 {
    if (!USE_PROCEDURAL_DETAIL) {
        return 0.0;
    }
    
    let weights = triplanarWeights(normal);
    let scale = material.triplanarScale;
    
    let texYZ = noise3D(vec3(worldPos.y, worldPos.z, 0.0) * scale);
    let texXZ = noise3D(vec3(worldPos.x, worldPos.z, 1.0) * scale);
    let texXY = noise3D(vec3(worldPos.x, worldPos.y, 2.0) * scale);
    
    return texYZ * weights.x + texXZ * weights.y + texXY * weights.z;
}

// ============================================================================
// AERIAL PERSPECTIVE (Conditional via USE_AERIAL_PERSPECTIVE)
// ============================================================================
fn sampleAerialPerspective(worldPos: vec3<f32>, cameraPos: vec3<f32>) -> vec4<f32> {
    if (!USE_AERIAL_PERSPECTIVE) {
        return vec4<f32>(0.0, 0.0, 0.0, 1.0);
    }
    
    let toFragment = worldPos - cameraPos;
    let dist = length(toFragment);
    let dir = toFragment / max(dist, 0.001);
    
    let azimuth = atan2(dir.z, dir.x);
    let u = (azimuth / (2.0 * 3.14159265)) + 0.5;
    
    let elevation = asin(clamp(dir.y, -1.0, 1.0));
    let v = (elevation / 3.14159265) + 0.5;
    
    let maxDist = 10000.0;
    let normalizedDist = clamp(dist / maxDist, 0.0, 1.0);
    let w = sqrt(normalizedDist);
    
    let uvw = vec3<f32>(u, v, w);
    return textureSample(aerialPerspectiveLUT, aerialPerspectiveSampler, uvw);
}

// ============================================================================
// VERTEX SHADER
// ============================================================================
@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    
    let worldPos = input.position + chunk.worldOffset;
    output.worldPos = worldPos;
    output.position = frame.viewProj * vec4<f32>(worldPos, 1.0);
    output.normal = input.normal;
    output.color = input.color;
    output.shadowCoord = frame.lightViewProj * vec4<f32>(worldPos, 1.0);
    
    return output;
}

// ============================================================================
// FRAGMENT SHADER
// ============================================================================
@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // Sample aerial perspective BEFORE any non-uniform branches (WGSL requirement)
    let aerialPerspective = sampleAerialPerspective(input.worldPos, frame.cameraPos);
    
    // Base color with material tint
    var baseColor = input.color.rgb * material.baseColor.rgb;
    
    // Add procedural detail
    if (USE_PROCEDURAL_DETAIL) {
        let detail = triplanarNoise(input.worldPos, input.normal);
        baseColor = baseColor * (0.9 + detail * 0.2);
    }
    
    // Lighting
    var sunDir = frame.sunDirection;
    sunDir.y = max(sunDir.y, 0.0);
    let lightDir = normalize(sunDir);
    let ndotl = max(dot(input.normal, lightDir), 0.0);
    
    // Shadow
    let shadowFactor = sampleShadowPCF(input.shadowCoord);
    
    // Combine lighting
    let ambient = frame.ambientLight * 0.3;
    let diffuse = ndotl * shadowFactor * frame.sunIntensity;
    var litColor = baseColor * (ambient + diffuse) * frame.sunColor;
    
    // Emissive
    litColor = litColor + material.emissive;
    
    // Atmospheric fog
    let dist = length(frame.cameraPos - input.worldPos);
    var ambientLit = litColor * (0.3 + 0.7 * frame.ambientLight);
    
    // Use aerial perspective if valid
    var finalColor: vec3<f32>;
    let hasValidLUT = aerialPerspective.a < 0.999;
    
    if (hasValidLUT && USE_AERIAL_PERSPECTIVE) {
        finalColor = ambientLit * aerialPerspective.a + aerialPerspective.rgb;
    } else {
        // Fallback fog
        let fogFactor = 1.0 - exp(-dist * frame.fogDensity);
        finalColor = mix(ambientLit, frame.fogColor, fogFactor);
    }
    
    // Alpha cutoff
    let alpha = input.color.a * material.baseColor.a;
    if (alpha < ALPHA_CUTOFF) {
        discard;
    }
    
    return vec4<f32>(finalColor, alpha);
}
`;

// =============================================================================
// UNIFORM LAYOUT DEFINITIONS
// =============================================================================

/**
 * Create the Frame uniforms layout (Group 0)
 */
export function createVoxelFrameLayout() {
    return new Std140StructBuilder('VoxelFrameUniforms')
        .addField('viewProj', 'mat4x4f')
        .addField('view', 'mat4x4f')
        .addField('proj', 'mat4x4f')
        .addField('lightViewProj', 'mat4x4f')
        .addField('waterViewProj', 'mat4x4f')
        .addField('cameraPos', 'vec3f')
        .addField('time', 'f32')
        .addField('sunDirection', 'vec3f')
        .addField('sunIntensity', 'f32')
        .addField('sunColor', 'vec3f')
        .addField('ambientLight', 'f32')
        .addField('fogColor', 'vec3f')
        .addField('fogDensity', 'f32')
        .build();
}

/**
 * Create the Material uniforms layout (Group 1)
 */
export function createVoxelMaterialLayout() {
    return new Std140StructBuilder('VoxelMaterialUniforms')
        .addField('baseColor', 'vec4f')
        .addField('emissive', 'vec3f')
        .addField('metallic', 'f32')
        .addField('roughness', 'f32')
        .addField('triplanarScale', 'f32')
        .addField('triplanarSharpness', 'f32')
        .addPadding(4)
        .build();
}

/**
 * Create the Chunk uniforms layout (Group 2)
 */
export function createVoxelChunkLayout() {
    return new Std140StructBuilder('VoxelChunkUniforms')
        .addField('worldOffset', 'vec3f')
        .addField('blend', 'f32')
        .addField('morphFactor', 'f32')
        .addField('lodLevel', 'f32')
        .addField('cameraDistance', 'f32')
        .addPadding(4)
        .build();
}

// =============================================================================
// VOXEL MATERIAL CLASS
// =============================================================================

/**
 * VoxelMaterial - Complete material implementation for voxel rendering
 */
export class VoxelMaterial {
    constructor(device, options = {}) {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.label = options.label || 'VoxelMaterial';
        
        // Create uniform layouts
        this.frameLayout = createVoxelFrameLayout();
        this.materialLayout = createVoxelMaterialLayout();
        this.chunkLayout = createVoxelChunkLayout();
        
        // Debug: print layouts
        if (options.debug) {
            this.frameLayout.debugPrint();
            this.materialLayout.debugPrint();
            this.chunkLayout.debugPrint();
        }
        
        // Create bind group layouts
        this._createBindGroupLayouts();
        
        // Create shader module
        this.shaderModule = this.vgpu.shader.compile(`${this.label}`, VOXEL_SHADER_WGSL);
        
        // Pipeline cache
        this.pipelineCache = new PipelineCache(device);
        
        // Default override values
        this.defaultOverrides = new PipelineOverrides()
            .set('USE_TRIPLANAR', true)
            .set('USE_SHADOWS', true)
            .set('USE_AERIAL_PERSPECTIVE', true)
            .set('USE_WATER_CAUSTICS', true)
            .set('USE_PROCEDURAL_DETAIL', true)
            .set('ALPHA_CUTOFF', 0.5);
        
        console.log(`[VoxelMaterial] Initialized with std140-compliant layouts`);
        console.log(`  Frame uniforms: ${this.frameLayout.size} bytes`);
        console.log(`  Material uniforms: ${this.materialLayout.size} bytes`);
        console.log(`  Chunk uniforms: ${this.chunkLayout.size} bytes`);
    }
    
    /**
     * Create bind group layouts
     * @private
     */
    _createBindGroupLayouts() {
        // Group 0: Frame
        this.frameBindGroupLayout = new BindGroupLayoutBuilder('Voxel Frame')
            .addUniformBuffer({ visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT })
            .addDepthTexture()        // Shadow map
            .addComparisonSampler()   // Shadow sampler
            .addDepthTexture()        // Water height map
            .addSampler()             // Water sampler
            .addTexture3D()           // Aerial perspective LUT
            .addSampler()             // Aerial sampler
            .build(this.device);
        
        // Group 1: Material
        this.materialBindGroupLayout = new BindGroupLayoutBuilder('Voxel Material')
            .addUniformBuffer({ visibility: GPUShaderStage.FRAGMENT })
            .build(this.device);
        
        // Group 2: Chunk/Object
        this.chunkBindGroupLayout = new BindGroupLayoutBuilder('Voxel Chunk')
            .addUniformBuffer({ visibility: GPUShaderStage.VERTEX })
            .build(this.device);
        
        // Pipeline layout
        this.pipelineLayout = this.device.createPipelineLayout({
            label: `${this.label}_pipelineLayout`,
            bindGroupLayouts: [
                this.frameBindGroupLayout,
                this.materialBindGroupLayout,
                this.chunkBindGroupLayout,
            ],
        });
    }
    
    /**
     * Create a frame bind group
     * @param {Object} resources - { shadowMapView, shadowSampler, waterMapView, waterSampler, aerialLUTView, aerialSampler }
     * @returns {FrameBindGroup}
     */
    createFrameBindGroup(resources) {
        const frameBindGroup = new FrameBindGroup(
            this.device,
            this.frameBindGroupLayout,
            this.frameLayout
        );
        
        // Set texture resources
        frameBindGroup.setResource(1, resources.shadowMapView);
        frameBindGroup.setResource(2, resources.shadowSampler);
        frameBindGroup.setResource(3, resources.waterMapView);
        frameBindGroup.setResource(4, resources.waterSampler);
        frameBindGroup.setResource(5, resources.aerialLUTView);
        frameBindGroup.setResource(6, resources.aerialSampler);
        
        return frameBindGroup;
    }
    
    /**
     * Create a material bind group with default values
     * @param {Object} params - Material parameters
     * @returns {MaterialBindGroup}
     */
    createMaterialBindGroup(params = {}) {
        const materialBindGroup = new MaterialBindGroup(
            this.device,
            this.materialBindGroupLayout,
            this.materialLayout
        );
        
        const uniforms = normalizeVoxelMaterialUniforms(params);
        materialBindGroup.setUniform('baseColor', uniforms.baseColor);
        materialBindGroup.setUniform('emissive', uniforms.emissive);
        materialBindGroup.setUniform('metallic', uniforms.metallic);
        materialBindGroup.setUniform('roughness', uniforms.roughness);
        materialBindGroup.setUniform('triplanarScale', uniforms.triplanarScale);
        materialBindGroup.setUniform('triplanarSharpness', uniforms.triplanarSharpness);
        
        return materialBindGroup;
    }
    
    /**
     * Create a chunk bind group
     * @returns {ObjectBindGroup}
     */
    createChunkBindGroup() {
        return new ObjectBindGroup(
            this.device,
            this.chunkBindGroupLayout,
            this.chunkLayout
        );
    }
    
    /**
     * Get or create pipeline with specific overrides
     * @param {Object} vertexLayout - Vertex buffer layout
     * @param {Object} overrides - Pipeline override values
     * @param {RenderStateDescriptor} renderState - Render state
     * @returns {GPURenderPipeline}
     */
    getPipeline(vertexLayout, overrides = {}, renderState = null) {
        // Merge overrides with defaults
        const finalOverrides = this.defaultOverrides.clone();
        for (const [key, value] of Object.entries(overrides)) {
            finalOverrides.set(key, value);
        }
        
        // Build pipeline descriptor
        const state = renderState || new RenderStateDescriptor()
            .setCullMode('back')
            .setDepthState({ format: 'depth24plus', writeEnabled: true, compare: 'less' });
        
        const descriptor = new PipelineDescriptor(this.shaderModule, this.pipelineLayout)
            .setLabel(`${this.label}_pipeline`)
            .addVertexBuffer(vertexLayout)
            .setOverrides(finalOverrides)
            .setRenderState(state);
        
        return this.pipelineCache.getOrCreate(descriptor);
    }
    
    /**
     * Get pipeline for transparent rendering
     * @param {Object} vertexLayout 
     * @returns {GPURenderPipeline}
     */
    getTransparentPipeline(vertexLayout) {
        const state = new RenderStateDescriptor()
            .setCullMode('back')
            .setDepthState({ format: 'depth24plus', writeEnabled: false, compare: 'less-equal' })
            .setBlendMode('alpha');
        
        return this.getPipeline(vertexLayout, { ALPHA_CUTOFF: 0.0 }, state);
    }
    
    /**
     * Get pipeline statistics
     * @returns {Object}
     */
    getStats() {
        return this.pipelineCache.getStats();
    }
    
    /**
     * Destroy all resources
     */
    destroy() {
        this.pipelineCache.clear();
    }
}

// =============================================================================
// STANDARD VERTEX LAYOUT
// =============================================================================

/**
 * Standard voxel vertex buffer layout
 */
export const VOXEL_VERTEX_LAYOUT = {
    arrayStride: 40, // 3 floats pos + 3 floats normal + 4 floats color = 10 floats = 40 bytes
    stepMode: 'vertex',
    attributes: [
        { shaderLocation: 0, offset: 0,  format: 'float32x3' }, // position
        { shaderLocation: 1, offset: 12, format: 'float32x3' }, // normal
        { shaderLocation: 2, offset: 24, format: 'float32x4' }, // color
    ],
};

export default {
    VoxelMaterial,
    VOXEL_VERTEX_LAYOUT,
    VOXEL_SHADER_WGSL,
    createVoxelFrameLayout,
    createVoxelMaterialLayout,
    createVoxelChunkLayout,
};
