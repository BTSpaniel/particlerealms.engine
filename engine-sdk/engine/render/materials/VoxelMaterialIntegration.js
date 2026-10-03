// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * VoxelMaterialIntegration.js - Bridge between MaterialSystem and VoxelRenderer
 * Now powered by vGPU driver
 * 
 * Provides gradual integration of the new material system with existing VoxelRenderer:
 * - Uses std140 layouts for uniform validation
 * - Enables pipeline specialization via overrides
 * - Maintains backward compatibility with existing code
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import {
    Std140StructBuilder,
    PipelineOverrides,
    PipelineCache,
    ShaderModuleCache,
    RenderStateDescriptor,
    PipelineDescriptor,
    BIND_GROUP_FREQUENCY,
    BindGroupLayoutBuilder,
} from './index.js';

// =============================================================================
// VOXEL FRAME UNIFORMS LAYOUT (std140 compliant)
// =============================================================================

/**
 * Create validated Frame uniforms layout matching VoxelRenderer shader
 */
export function createVoxelFrameUniformsLayout() {
    const layout = new Std140StructBuilder('VoxelFrameUniforms')
        // Matrices (0-319)
        .addField('viewProj', 'mat4x4f')           // 0
        .addField('view', 'mat4x4f')               // 64
        .addField('proj', 'mat4x4f')               // 128
        .addField('lightViewProj', 'mat4x4f')      // 192
        .addField('waterViewProj', 'mat4x4f')      // 256
        
        // Camera and time (320-335)
        .addField('cameraPos', 'vec3f')            // 320 (aligned 16)
        .addField('time', 'f32')                   // 332
        
        // Sun lighting (336-367)
        .addField('sunDirection', 'vec3f')         // 336 (aligned 16)
        .addField('sunIntensity', 'f32')           // 348
        .addField('sunColor', 'vec3f')             // 352 (aligned 16)
        .addField('ambientLight', 'f32')           // 364
        
        // Shader config (368-383)
        .addField('shaderMode', 'f32')             // 368
        .addField('shadowBias', 'f32')             // 372
        .addField('shadowStrength', 'f32')         // 376
        .addPadding(4)                             // 380
        
        // Fog (384-399)
        .addField('fogColor', 'vec3f')             // 384 (aligned 16)
        .addField('fogDensity', 'f32')             // 396
        
        // Water (400-415)
        .addField('waterEnabled', 'f32')           // 400
        .addPadding(12)                            // 404-415
        
        // Terrain shading config (416-479)
        .addField('triplanarScale', 'f32')         // 416
        .addField('triplanarSharpness', 'f32')     // 420
        .addField('triplanarEnabled', 'f32')       // 424
        .addField('slopeBlendEnabled', 'f32')      // 428
        .addField('grassSlopeMax', 'f32')          // 432
        .addField('dirtSlopeMax', 'f32')           // 436
        .addField('rockSlopeMin', 'f32')           // 440
        .addField('heightBlendEnabled', 'f32')     // 444
        .addField('sandHeightMax', 'f32')          // 448
        .addField('snowHeightMin', 'f32')          // 452
        .addField('peakRockHeight', 'f32')         // 456
        .addField('biomeColorsEnabled', 'f32')     // 460
        .addField('edgeDarkening', 'f32')          // 464
        .addField('noiseIntensity', 'f32')         // 468
        .addField('fineDetailIntensity', 'f32')    // 472
        .addField('biomeBlendSharpness', 'f32')    // 476
        .build();
    
    return layout;
}

/**
 * Create validated Chunk uniforms layout
 */
export function createVoxelChunkUniformsLayout() {
    return new Std140StructBuilder('VoxelChunkUniforms')
        .addField('worldOffset', 'vec3f')          // 0
        .addField('blend', 'f32')                  // 12
        .addField('morphFactor', 'f32')            // 16
        .addField('lodLevel', 'f32')               // 20
        .addField('cameraDistance', 'f32')         // 24
        .addPadding(4)                             // 28
        .build();
}

// =============================================================================
// PIPELINE SPECIALIZATION
// =============================================================================

/**
 * Voxel shader features that can be toggled via overrides
 */
export const VOXEL_FEATURES = {
    TRIPLANAR: 'USE_TRIPLANAR',
    SHADOWS: 'USE_SHADOWS',
    AERIAL_PERSPECTIVE: 'USE_AERIAL_PERSPECTIVE',
    WATER_CAUSTICS: 'USE_WATER_CAUSTICS',
    PROCEDURAL_DETAIL: 'USE_PROCEDURAL_DETAIL',
    BIOME_COLORS: 'USE_BIOME_COLORS',
    SLOPE_BLEND: 'USE_SLOPE_BLEND',
    HEIGHT_BLEND: 'USE_HEIGHT_BLEND',
};

/**
 * Create default voxel pipeline overrides
 */
export function createDefaultVoxelOverrides() {
    return new PipelineOverrides()
        .set(VOXEL_FEATURES.TRIPLANAR, true)
        .set(VOXEL_FEATURES.SHADOWS, true)
        .set(VOXEL_FEATURES.AERIAL_PERSPECTIVE, true)
        .set(VOXEL_FEATURES.WATER_CAUSTICS, true)
        .set(VOXEL_FEATURES.PROCEDURAL_DETAIL, true)
        .set(VOXEL_FEATURES.BIOME_COLORS, true)
        .set(VOXEL_FEATURES.SLOPE_BLEND, true)
        .set(VOXEL_FEATURES.HEIGHT_BLEND, true)
        .set('ALPHA_CUTOFF', 0.5);
}

/**
 * Create low-quality overrides for performance
 */
export function createLowQualityOverrides() {
    return new PipelineOverrides()
        .set(VOXEL_FEATURES.TRIPLANAR, false)
        .set(VOXEL_FEATURES.SHADOWS, true)
        .set(VOXEL_FEATURES.AERIAL_PERSPECTIVE, false)
        .set(VOXEL_FEATURES.WATER_CAUSTICS, false)
        .set(VOXEL_FEATURES.PROCEDURAL_DETAIL, false)
        .set(VOXEL_FEATURES.BIOME_COLORS, true)
        .set(VOXEL_FEATURES.SLOPE_BLEND, false)
        .set(VOXEL_FEATURES.HEIGHT_BLEND, false)
        .set('ALPHA_CUTOFF', 0.5);
}

// =============================================================================
// VOXEL MATERIAL MANAGER
// =============================================================================

/**
 * VoxelMaterialManager - Manages voxel materials with the new system
 */
export class VoxelMaterialManager {
    constructor(device) {
        this.device = device;
        this.pipelineCache = new PipelineCache(device);
        this.shaderCache = new ShaderModuleCache(device);
        
        // Validated layouts
        this.frameUniformsLayout = createVoxelFrameUniformsLayout();
        this.chunkUniformsLayout = createVoxelChunkUniformsLayout();
        
        // Current quality preset
        this.qualityPreset = 'high';
        this.currentOverrides = createDefaultVoxelOverrides();
        
        // Registered shader modules
        this.shaderModules = new Map();
        
        // Pipeline variants by quality/feature set
        this.pipelineVariants = new Map();
        
        console.log('[VoxelMaterialManager] Initialized');
        console.log(`  Frame uniforms: ${this.frameUniformsLayout.size} bytes`);
        console.log(`  Chunk uniforms: ${this.chunkUniformsLayout.size} bytes`);
    }
    
    /**
     * Register the main voxel shader
     * @param {string} shaderCode - WGSL source
     * @param {string} label - Debug label
     */
    registerVoxelShader(shaderCode, label = 'VoxelShader') {
        const module = this.shaderCache.getOrCreate(shaderCode, label);
        this.shaderModules.set('voxel', module);
        return module;
    }
    
    /**
     * Register the shadow shader
     * @param {string} shaderCode - WGSL source
     */
    registerShadowShader(shaderCode) {
        const module = this.shaderCache.getOrCreate(shaderCode, 'ShadowShader');
        this.shaderModules.set('shadow', module);
        return module;
    }
    
    /**
     * Set quality preset
     * @param {'low'|'medium'|'high'|'ultra'} preset 
     */
    setQualityPreset(preset) {
        this.qualityPreset = preset;
        
        switch (preset) {
            case 'low':
                this.currentOverrides = createLowQualityOverrides();
                break;
            case 'medium':
                this.currentOverrides = createDefaultVoxelOverrides()
                    .set(VOXEL_FEATURES.PROCEDURAL_DETAIL, false)
                    .set(VOXEL_FEATURES.WATER_CAUSTICS, false);
                break;
            case 'high':
                this.currentOverrides = createDefaultVoxelOverrides();
                break;
            case 'ultra':
                this.currentOverrides = createDefaultVoxelOverrides();
                // Ultra could enable additional features in the future
                break;
        }
        
        console.log(`[VoxelMaterialManager] Quality preset: ${preset}`);
    }
    
    /**
     * Toggle a specific feature
     * @param {string} feature - Feature name from VOXEL_FEATURES
     * @param {boolean} enabled 
     */
    setFeature(feature, enabled) {
        this.currentOverrides.set(feature, enabled);
    }
    
    /**
     * Get current overrides as constants for pipeline creation
     * @returns {Object}
     */
    getConstants() {
        return this.currentOverrides.toConstants();
    }
    
    /**
     * Get or create pipeline with current overrides
     * @param {GPUPipelineLayout} layout 
     * @param {Object} vertexLayout 
     * @param {Object} options - { transparent, cullMode, depthWrite }
     * @returns {GPURenderPipeline}
     */
    getPipeline(layout, vertexLayout, options = {}) {
        const shaderModule = this.shaderModules.get('voxel');
        if (!shaderModule) {
            throw new Error('[VoxelMaterialManager] Voxel shader not registered');
        }
        
        // Build render state
        const renderState = new RenderStateDescriptor()
            .setCullMode(options.cullMode || 'back')
            .setDepthState({
                format: 'depth24plus',
                writeEnabled: options.depthWrite !== false,
                compare: options.transparent ? 'less-equal' : 'less',
            });
        
        if (options.transparent) {
            renderState.setBlendMode('alpha');
        }
        
        // Create descriptor
        const descriptor = new PipelineDescriptor(shaderModule, layout)
            .setLabel(`Voxel_${this.qualityPreset}_${options.transparent ? 'transparent' : 'opaque'}`)
            .addVertexBuffer(vertexLayout)
            .setOverrides(this.currentOverrides)
            .setRenderState(renderState);
        
        return this.pipelineCache.getOrCreate(descriptor);
    }
    
    /**
     * Get pipeline for shadow pass
     * @param {GPUPipelineLayout} layout 
     * @param {Object} vertexLayout 
     * @returns {GPURenderPipeline}
     */
    getShadowPipeline(layout, vertexLayout) {
        const shaderModule = this.shaderModules.get('shadow');
        if (!shaderModule) {
            throw new Error('[VoxelMaterialManager] Shadow shader not registered');
        }
        
        const renderState = new RenderStateDescriptor()
            .setCullMode('back')
            .setDepthState({
                format: 'depth32float',
                writeEnabled: true,
                compare: 'less',
            });
        
        const descriptor = new PipelineDescriptor(shaderModule, layout)
            .setLabel('Voxel_Shadow')
            .setEntryPoints('vs_shadow', 'fs_shadow')
            .addVertexBuffer(vertexLayout)
            .setRenderState(renderState);
        
        return this.pipelineCache.getOrCreate(descriptor);
    }
    
    /**
     * Validate uniform buffer against layout
     * @param {Float32Array} data 
     * @param {'frame'|'chunk'} type 
     * @returns {boolean}
     */
    validateUniformData(data, type) {
        const layout = type === 'frame' ? this.frameUniformsLayout : this.chunkUniformsLayout;
        const expectedSize = layout.size / 4; // floats
        
        if (data.length < expectedSize) {
            console.error(`[VoxelMaterialManager] ${type} uniform data too small: ${data.length} < ${expectedSize}`);
            return false;
        }
        
        return true;
    }
    
    /**
     * Get statistics
     * @returns {Object}
     */
    getStats() {
        return {
            shaderModules: this.shaderModules.size,
            ...this.pipelineCache.getStats(),
            qualityPreset: this.qualityPreset,
        };
    }
    
    /**
     * Clear all caches
     */
    clearCaches() {
        this.pipelineCache.clear();
        this.shaderCache.clear();
    }
}

// =============================================================================
// INTEGRATION HELPERS
// =============================================================================

/**
 * Integrate material system with existing VoxelRenderer
 * @param {VoxelRenderer} renderer 
 * @param {GPUDevice} device 
 */
export function integrateWithVoxelRenderer(renderer, device) {
    // Create material manager
    const materialManager = new VoxelMaterialManager(device);
    
    // Attach to renderer
    renderer.materialManager = materialManager;
    
    // Add quality preset method
    renderer.setQualityPreset = (preset) => {
        materialManager.setQualityPreset(preset);
        // Could trigger pipeline rebuild here if needed
    };
    
    // Add feature toggle method
    renderer.setFeatureEnabled = (feature, enabled) => {
        materialManager.setFeature(feature, enabled);
    };
    
    // Add stats method
    renderer.getMaterialStats = () => {
        return materialManager.getStats();
    };
    
    console.log('[VoxelMaterialIntegration] Integrated with VoxelRenderer');
    
    return materialManager;
}

/**
 * Create frame uniforms buffer with validated layout
 * @param {GPUDevice} device 
 * @returns {{ buffer: GPUBuffer, layout: Std140StructLayout, data: ArrayBuffer }}
 */
export function createValidatedFrameUniformsBuffer(device) {
    const vgpu = initVGPU(device);
    const layout = createVoxelFrameUniformsLayout();
    
    const buffer = vgpu.buffer.create({
        size: layout.size, usage: 'uniform', label: 'VoxelFrameUniformsValidated'
    }).buffer;
    
    const data = layout.createBuffer();
    
    return { buffer, layout, data };
}

/**
 * Create chunk uniforms buffer with validated layout
 * @param {GPUDevice} device 
 * @returns {{ buffer: GPUBuffer, layout: Std140StructLayout, data: ArrayBuffer }}
 */
export function createValidatedChunkUniformsBuffer(device) {
    const vgpu = initVGPU(device);
    const layout = createVoxelChunkUniformsLayout();
    
    const buffer = vgpu.buffer.create({
        size: layout.size, usage: 'uniform', label: 'VoxelChunkUniformsValidated'
    }).buffer;
    
    const data = layout.createBuffer();
    
    return { buffer, layout, data };
}

export default {
    createVoxelFrameUniformsLayout,
    createVoxelChunkUniformsLayout,
    VOXEL_FEATURES,
    createDefaultVoxelOverrides,
    createLowQualityOverrides,
    VoxelMaterialManager,
    integrateWithVoxelRenderer,
    createValidatedFrameUniformsBuffer,
    createValidatedChunkUniformsBuffer,
};
