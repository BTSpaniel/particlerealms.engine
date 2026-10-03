// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * BindGroupManager.js - Frequency-Based Bind Group Architecture
 * Now powered by vGPU driver
 * 
 * Implements the 4-tier bind group model:
 * - Group 0: Frame/Global (camera, time, lighting) - Once per frame
 * - Group 1: Material (textures, material params) - Once per material batch
 * - Group 2: Object/Mesh (transforms, skinning) - Once per draw call
 * - Group 3: User/Rare (specialized overrides) - Sparse/on-demand
 * 
 * This architecture minimizes bind group switches by grouping resources
 * by update frequency, which is critical for WebGPU performance.
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import { Std140StructLayout, Std140StructBuilder, STD140_TYPES } from './Std140Layout.js';

/**
 * Bind group frequency tiers
 */
export const BIND_GROUP_FREQUENCY = {
    FRAME: 0,     // Global per-frame data (camera, lighting, time)
    MATERIAL: 1,  // Per-material data (textures, material params)
    OBJECT: 2,    // Per-object data (transforms, skinning)
    USER: 3,      // Rare/specialized data
};

/**
 * BindGroupLayoutBuilder - Fluent API for building bind group layouts
 */
export class BindGroupLayoutBuilder {
    constructor(label = 'BindGroupLayout') {
        this.label = label;
        this.entries = [];
        this.nextBinding = 0;
    }
    
    /**
     * Add a uniform buffer binding
     * @param {Object} options - { visibility, minBindingSize }
     * @returns {BindGroupLayoutBuilder}
     */
    addUniformBuffer(options = {}) {
        const visibility = options.visibility ?? (GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT);
        this.entries.push({
            binding: this.nextBinding++,
            visibility,
            buffer: {
                type: 'uniform',
                minBindingSize: options.minBindingSize ?? 0,
            },
        });
        return this;
    }
    
    /**
     * Add a storage buffer binding
     * @param {Object} options - { visibility, type, minBindingSize }
     * @returns {BindGroupLayoutBuilder}
     */
    addStorageBuffer(options = {}) {
        const visibility = options.visibility ?? GPUShaderStage.FRAGMENT;
        this.entries.push({
            binding: this.nextBinding++,
            visibility,
            buffer: {
                type: options.type ?? 'read-only-storage',
                minBindingSize: options.minBindingSize ?? 0,
            },
        });
        return this;
    }
    
    /**
     * Add a texture binding
     * @param {Object} options - { visibility, sampleType, viewDimension, multisampled }
     * @returns {BindGroupLayoutBuilder}
     */
    addTexture(options = {}) {
        const visibility = options.visibility ?? GPUShaderStage.FRAGMENT;
        this.entries.push({
            binding: this.nextBinding++,
            visibility,
            texture: {
                sampleType: options.sampleType ?? 'float',
                viewDimension: options.viewDimension ?? '2d',
                multisampled: options.multisampled ?? false,
            },
        });
        return this;
    }
    
    /**
     * Add a depth texture binding
     * @param {Object} options - { visibility, viewDimension }
     * @returns {BindGroupLayoutBuilder}
     */
    addDepthTexture(options = {}) {
        const visibility = options.visibility ?? GPUShaderStage.FRAGMENT;
        this.entries.push({
            binding: this.nextBinding++,
            visibility,
            texture: {
                sampleType: 'depth',
                viewDimension: options.viewDimension ?? '2d',
            },
        });
        return this;
    }
    
    /**
     * Add a 3D texture binding
     * @param {Object} options - { visibility, sampleType }
     * @returns {BindGroupLayoutBuilder}
     */
    addTexture3D(options = {}) {
        const visibility = options.visibility ?? GPUShaderStage.FRAGMENT;
        this.entries.push({
            binding: this.nextBinding++,
            visibility,
            texture: {
                sampleType: options.sampleType ?? 'float',
                viewDimension: '3d',
            },
        });
        return this;
    }
    
    /**
     * Add a sampler binding
     * @param {Object} options - { visibility, type }
     * @returns {BindGroupLayoutBuilder}
     */
    addSampler(options = {}) {
        const visibility = options.visibility ?? GPUShaderStage.FRAGMENT;
        this.entries.push({
            binding: this.nextBinding++,
            visibility,
            sampler: {
                type: options.type ?? 'filtering',
            },
        });
        return this;
    }
    
    /**
     * Add a comparison sampler (for shadow mapping)
     * @param {Object} options - { visibility }
     * @returns {BindGroupLayoutBuilder}
     */
    addComparisonSampler(options = {}) {
        const visibility = options.visibility ?? GPUShaderStage.FRAGMENT;
        this.entries.push({
            binding: this.nextBinding++,
            visibility,
            sampler: {
                type: 'comparison',
            },
        });
        return this;
    }
    
    /**
     * Add a storage texture binding
     * @param {Object} options - { visibility, format, access, viewDimension }
     * @returns {BindGroupLayoutBuilder}
     */
    addStorageTexture(options = {}) {
        const visibility = options.visibility ?? GPUShaderStage.COMPUTE;
        this.entries.push({
            binding: this.nextBinding++,
            visibility,
            storageTexture: {
                format: options.format ?? 'rgba8unorm',
                access: options.access ?? 'write-only',
                viewDimension: options.viewDimension ?? '2d',
            },
        });
        return this;
    }
    
    /**
     * Build the bind group layout
     * @param {GPUDevice} device 
     * @returns {GPUBindGroupLayout}
     */
    build(device) {
        return device.createBindGroupLayout({
            label: this.label,
            entries: this.entries,
        });
    }
    
    /**
     * Get entries (for inspection/debugging)
     * @returns {Array}
     */
    getEntries() {
        return [...this.entries];
    }
}

/**
 * FrameBindGroup - Manages Group 0 (per-frame global data)
 */
export class FrameBindGroup {
    constructor(device, layout, uniformLayout) {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.layout = layout;
        this.uniformLayout = uniformLayout;
        
        // Create uniform buffer
        this.uniformBuffer = this.vgpu.buffer.create({
            size: uniformLayout.size, usage: 'uniform', label: 'FrameUniforms'
        }).buffer;
        
        // CPU-side buffer for staging
        this.cpuBuffer = uniformLayout.createBuffer();
        this.dirty = true;
        
        // Additional resources (textures, samplers) bound to frame
        this.resources = new Map();
        this.bindGroup = null;
    }
    
    /**
     * Set a uniform field value
     * @param {string} name - Field name
     * @param {*} value - Value to set
     */
    setUniform(name, value) {
        this.uniformLayout.writeField(this.cpuBuffer, name, value);
        this.dirty = true;
    }
    
    /**
     * Set a matrix uniform
     * @param {string} name - Field name
     * @param {Float32Array|Array} matrix - 16-element matrix
     */
    setMatrix(name, matrix) {
        this.uniformLayout.writeMatrix4(this.cpuBuffer, name, matrix);
        this.dirty = true;
    }
    
    /**
     * Set an additional resource (texture view, sampler)
     * @param {number} binding - Binding index
     * @param {*} resource - GPU resource
     */
    setResource(binding, resource) {
        this.resources.set(binding, resource);
        this.bindGroup = null; // Invalidate bind group
    }
    
    /**
     * Upload dirty uniforms to GPU
     */
    upload() {
        if (this.dirty) {
            this.device.queue.writeBuffer(
                this.uniformBuffer,
                0,
                this.cpuBuffer
            );
            this.dirty = false;
        }
    }
    
    /**
     * Get or create the bind group
     * @returns {GPUBindGroup}
     */
    getBindGroup() {
        if (!this.bindGroup) {
            const entries = [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
            ];
            
            // Add additional resources
            for (const [binding, resource] of this.resources) {
                entries.push({ binding, resource });
            }
            
            // Sort by binding index
            entries.sort((a, b) => a.binding - b.binding);
            
            this.bindGroup = this.device.createBindGroup({
                label: 'Frame BindGroup',
                layout: this.layout,
                entries,
            });
        }
        return this.bindGroup;
    }
    
    /**
     * Bind to render pass
     * @param {GPURenderPassEncoder} pass 
     */
    bind(pass) {
        this.upload();
        pass.setBindGroup(BIND_GROUP_FREQUENCY.FRAME, this.getBindGroup());
    }
    
    /**
     * Destroy resources
     */
    destroy() {
        this.uniformBuffer?.destroy();
    }
}

/**
 * MaterialBindGroup - Manages Group 1 (per-material data)
 */
export class MaterialBindGroup {
    constructor(device, layout, uniformLayout = null) {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.layout = layout;
        this.uniformLayout = uniformLayout;
        
        // Create uniform buffer if layout provided
        if (uniformLayout) {
            this.uniformBuffer = this.vgpu.buffer.create({
                size: uniformLayout.size, usage: 'uniform', label: 'MaterialUniforms'
            }).buffer;
            this.cpuBuffer = uniformLayout.createBuffer();
        } else {
            this.uniformBuffer = null;
            this.cpuBuffer = null;
        }
        
        this.dirty = true;
        this.textures = new Map();
        this.samplers = new Map();
        this.bindGroup = null;
    }
    
    /**
     * Set a uniform field value
     * @param {string} name - Field name
     * @param {*} value - Value to set
     */
    setUniform(name, value) {
        if (!this.uniformLayout) {
            throw new Error('MaterialBindGroup: No uniform layout defined');
        }
        this.uniformLayout.writeField(this.cpuBuffer, name, value);
        this.dirty = true;
    }
    
    /**
     * Set a texture
     * @param {number} binding - Binding index
     * @param {GPUTextureView} textureView 
     */
    setTexture(binding, textureView) {
        this.textures.set(binding, textureView);
        this.bindGroup = null;
    }
    
    /**
     * Set a sampler
     * @param {number} binding - Binding index
     * @param {GPUSampler} sampler 
     */
    setSampler(binding, sampler) {
        this.samplers.set(binding, sampler);
        this.bindGroup = null;
    }
    
    /**
     * Upload dirty uniforms to GPU
     */
    upload() {
        if (this.dirty && this.uniformBuffer && this.cpuBuffer) {
            this.device.queue.writeBuffer(
                this.uniformBuffer,
                0,
                this.cpuBuffer
            );
            this.dirty = false;
        }
    }
    
    /**
     * Get or create the bind group
     * @returns {GPUBindGroup}
     */
    getBindGroup() {
        if (!this.bindGroup) {
            const entries = [];
            
            // Add uniform buffer at binding 0
            if (this.uniformBuffer) {
                entries.push({ binding: 0, resource: { buffer: this.uniformBuffer } });
            }
            
            // Add textures
            for (const [binding, textureView] of this.textures) {
                entries.push({ binding, resource: textureView });
            }
            
            // Add samplers
            for (const [binding, sampler] of this.samplers) {
                entries.push({ binding, resource: sampler });
            }
            
            // Sort by binding index
            entries.sort((a, b) => a.binding - b.binding);
            
            this.bindGroup = this.device.createBindGroup({
                label: 'Material BindGroup',
                layout: this.layout,
                entries,
            });
        }
        return this.bindGroup;
    }
    
    /**
     * Bind to render pass
     * @param {GPURenderPassEncoder} pass 
     */
    bind(pass) {
        this.upload();
        pass.setBindGroup(BIND_GROUP_FREQUENCY.MATERIAL, this.getBindGroup());
    }
    
    /**
     * Destroy resources
     */
    destroy() {
        this.uniformBuffer?.destroy();
    }
}

/**
 * ObjectBindGroup - Manages Group 2 (per-object data like transforms)
 */
export class ObjectBindGroup {
    constructor(device, layout, uniformLayout) {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.layout = layout;
        this.uniformLayout = uniformLayout;
        
        this.uniformBuffer = this.vgpu.buffer.create({
            size: uniformLayout.size, usage: 'uniform', label: 'ObjectUniforms'
        }).buffer;
        
        this.cpuBuffer = uniformLayout.createBuffer();
        this.dirty = true;
        this.bindGroup = null;
    }
    
    /**
     * Set a uniform field value
     * @param {string} name - Field name
     * @param {*} value - Value to set
     */
    setUniform(name, value) {
        this.uniformLayout.writeField(this.cpuBuffer, name, value);
        this.dirty = true;
        this.bindGroup = null;
    }
    
    /**
     * Set a matrix uniform
     * @param {string} name - Field name
     * @param {Float32Array|Array} matrix 
     */
    setMatrix(name, matrix) {
        this.uniformLayout.writeMatrix4(this.cpuBuffer, name, matrix);
        this.dirty = true;
        this.bindGroup = null;
    }
    
    /**
     * Upload and bind in one call (optimized for per-draw updates)
     * @param {GPURenderPassEncoder} pass 
     */
    uploadAndBind(pass) {
        if (this.dirty) {
            this.device.queue.writeBuffer(this.uniformBuffer, 0, this.cpuBuffer);
            this.dirty = false;
        }
        
        if (!this.bindGroup) {
            this.bindGroup = this.device.createBindGroup({
                label: 'Object BindGroup',
                layout: this.layout,
                entries: [
                    { binding: 0, resource: { buffer: this.uniformBuffer } },
                ],
            });
        }
        
        pass.setBindGroup(BIND_GROUP_FREQUENCY.OBJECT, this.bindGroup);
    }
    
    /**
     * Destroy resources
     */
    destroy() {
        this.uniformBuffer?.destroy();
    }
}

/**
 * BindGroupCache - Caches bind groups to avoid recreation
 */
export class BindGroupCache {
    constructor(device) {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.cache = new Map();
    }
    
    /**
     * Get or create a bind group
     * @param {string} key - Unique cache key
     * @param {GPUBindGroupLayout} layout 
     * @param {Array} entries - Bind group entries
     * @returns {GPUBindGroup}
     */
    getOrCreate(key, layout, entries) {
        let bindGroup = this.cache.get(key);
        if (!bindGroup) {
            bindGroup = this.device.createBindGroup({
                layout,
                entries,
            });
            this.cache.set(key, bindGroup);
        }
        return bindGroup;
    }
    
    /**
     * Invalidate a cached bind group
     * @param {string} key 
     */
    invalidate(key) {
        this.cache.delete(key);
    }
    
    /**
     * Clear entire cache
     */
    clear() {
        this.cache.clear();
    }
    
    /**
     * Get cache statistics
     * @returns {Object}
     */
    getStats() {
        return {
            size: this.cache.size,
        };
    }
}

/**
 * Create the standard voxel renderer bind group layouts
 * @param {GPUDevice} device 
 * @returns {Object} - { frameLayout, materialLayout, objectLayout, pipelineLayout }
 */
export function createVoxelBindGroupLayouts(device) {
    // Group 0: Frame uniforms + shadow map + water map + aerial perspective
    const frameLayout = new BindGroupLayoutBuilder('Voxel Frame Layout')
        .addUniformBuffer({ visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT })
        .addDepthTexture()           // Shadow map
        .addComparisonSampler()      // Shadow sampler
        .addDepthTexture()           // Water height map
        .addSampler()                // Water sampler
        .addTexture3D()              // Aerial perspective LUT
        .addSampler()                // Aerial perspective sampler
        .build(device);
    
    // Group 1: Material textures (future expansion)
    const materialLayout = new BindGroupLayoutBuilder('Voxel Material Layout')
        .addUniformBuffer({ visibility: GPUShaderStage.FRAGMENT })
        .addTexture()                // Albedo/diffuse
        .addTexture()                // Normal map
        .addSampler()                // Material sampler
        .build(device);
    
    // Group 2: Per-chunk/object transforms
    const objectLayout = new BindGroupLayoutBuilder('Voxel Object Layout')
        .addUniformBuffer({ visibility: GPUShaderStage.VERTEX })
        .build(device);
    
    // Create pipeline layout
    const pipelineLayout = device.createPipelineLayout({
        label: 'Voxel Pipeline Layout',
        bindGroupLayouts: [frameLayout, materialLayout, objectLayout],
    });
    
    return {
        frameLayout,
        materialLayout,
        objectLayout,
        pipelineLayout,
    };
}

export default {
    BIND_GROUP_FREQUENCY,
    BindGroupLayoutBuilder,
    FrameBindGroup,
    MaterialBindGroup,
    ObjectBindGroup,
    BindGroupCache,
    createVoxelBindGroupLayouts,
};
