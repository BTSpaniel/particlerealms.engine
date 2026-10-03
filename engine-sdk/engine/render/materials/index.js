// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Materials System - WebGPU Native Material Architecture
 * 
 * A production-grade material system implementing:
 * - Frequency-based bind group model (Frame/Material/Object/User)
 * - std140 layout compliance with validation
 * - Pipeline specialization via WGSL override constants
 * - Modular shader composition with include handling
 * - Pipeline caching and async compilation
 */

// std140 Layout System
export {
    STD140_TYPES,
    alignOffset,
    Std140StructBuilder,
    Std140StructLayout,
    createFrameUniformsLayout,
    createChunkUniformsLayout,
    createPBRMaterialLayout,
} from './Std140Layout.js';

// Shader Composition System
export {
    ShaderChunkRegistry,
    PipelineOverrides,
    ShaderVariant,
    UberShaderBuilder,
    STANDARD_CHUNKS,
    createDefaultRegistry,
} from './ShaderComposer.js';

// Bind Group Management
export {
    BIND_GROUP_FREQUENCY,
    BindGroupLayoutBuilder,
    FrameBindGroup,
    MaterialBindGroup,
    ObjectBindGroup,
    BindGroupCache,
    createVoxelBindGroupLayouts,
} from './BindGroupManager.js';

// Pipeline Caching
export {
    RenderStateDescriptor,
    PipelineDescriptor,
    ComputePipelineDescriptor,
    PipelineCache,
    ComputePipelineCache,
    ShaderModuleCache,
    MaterialPipelineManager,
} from './PipelineCache.js';

// Legacy Material System (for compatibility)
export {
    normalizeMaterialDescriptor,
    createMaterialSystem,
} from './MaterialSystem.js';

// Texture Manager
export { createTextureManager } from './TextureManager.js';

// Material Library
export { createMaterialLibrary, normalizeMaterial } from './MaterialLibrary.js';

// Voxel Material Integration
export {
    createVoxelFrameUniformsLayout,
    createVoxelChunkUniformsLayout,
    VOXEL_FEATURES,
    createDefaultVoxelOverrides,
    createLowQualityOverrides,
    VoxelMaterialManager,
    integrateWithVoxelRenderer,
    createValidatedFrameUniformsBuffer,
    createValidatedChunkUniformsBuffer,
} from './VoxelMaterialIntegration.js';

/**
 * Create a complete material system for voxel rendering
 * @param {GPUDevice} device 
 * @returns {Object} - Complete material system
 */
export function createVoxelMaterialSystem(device) {
    // Import dynamically to avoid circular dependencies
    const { createVoxelBindGroupLayouts } = require('./BindGroupManager.js');
    const { PipelineCache, ShaderModuleCache } = require('./PipelineCache.js');
    const { createDefaultRegistry } = require('./ShaderComposer.js');
    const { createFrameUniformsLayout, createChunkUniformsLayout } = require('./Std140Layout.js');
    
    // Create bind group layouts
    const layouts = createVoxelBindGroupLayouts(device);
    
    // Create caches
    const shaderCache = new ShaderModuleCache(device);
    const pipelineCache = new PipelineCache(device);
    
    // Create shader registry with standard chunks
    const shaderRegistry = createDefaultRegistry();
    
    // Create uniform layouts
    const frameUniformLayout = createFrameUniformsLayout();
    const chunkUniformLayout = createChunkUniformsLayout();
    
    return {
        device,
        layouts,
        shaderCache,
        pipelineCache,
        shaderRegistry,
        frameUniformLayout,
        chunkUniformLayout,
        
        /**
         * Get statistics
         */
        getStats() {
            return {
                shaderModules: shaderCache.size,
                ...pipelineCache.getStats(),
            };
        },
        
        /**
         * Clear all caches
         */
        clearCaches() {
            shaderCache.clear();
            pipelineCache.clear();
        },
    };
}

export default {
    createVoxelMaterialSystem,
};
