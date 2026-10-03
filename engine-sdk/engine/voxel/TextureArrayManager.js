// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * TextureArrayManager.js - Texture Array for Voxel Materials
 * 
 * Uses a 2D texture array instead of a texture atlas for voxel materials.
 * 
 * Benefits over atlas:
 * - No UV calculation needed (just use material index)
 * - Proper mipmapping per texture (no bleeding)
 * - Cleaner shader code
 * - Easy to add/remove materials
 * 
 * Usage in shader:
 *   @group(0) @binding(X) var materials: texture_2d_array<f32>;
 *   let color = textureSample(materials, sampler, uv, materialIndex);
 */

// Import material colors from schema (single source of truth)
import { legacyPrimeCoordinateXorHash3D } from '../core/math/MathBits.js';
import { textureMipByteSize, textureMipLevelCount } from '../core/math/TextureMath.js';
import { MATERIAL_COLORS_NORMALIZED, MATERIAL_COUNT } from './MaterialSchema.js';
import { ProceduralMaterialBaker } from './ProceduralMaterialBaker.js';

// Use schema colors directly - no duplication
const DEFAULT_MATERIAL_COLORS = MATERIAL_COLORS_NORMALIZED;

export function textureArrayMaterialNoiseHash(px, py, materialIndex) {
    return legacyPrimeCoordinateXorHash3D(px, py, materialIndex);
}

export function textureArrayMaterialNoiseDelta(px, py, materialIndex, amplitude = 0.1) {
    return ((textureArrayMaterialNoiseHash(px, py, materialIndex) % 1000) / 1000 - 0.5) * amplitude;
}

/**
 * TextureArrayManager - Manages a texture array for voxel materials
 */
export class TextureArrayManager {
    constructor() {
        this.device = null;
        this.initialized = false;
        
        // Texture array
        this.textureArray = null;
        this.normalArray = null;
        this.ormArray = null;
        this.heightArray = null;
        this.sampler = null;
        
        // Configuration
        this.textureSize = 64;      // Size of each material texture (increased from 16 to remove grid)
        this.maxMaterials = 32;     // Maximum number of materials
        this.mipLevelCount = 6;     // Number of mip levels (increased for 64x64)
        
        // Material data
        this.materialColors = [...DEFAULT_MATERIAL_COLORS];
        this.materialCount = DEFAULT_MATERIAL_COLORS.length;
        
        // Memory tracking for profiler
        this.totalMemory = 0;

        this.proceduralBaker = null;
    }
    
    /**
     * Initialize the texture array
     * @param {GPUDevice} device 
     * @param {Object} options 
     */
    async init(device, options = {}) {
        this.device = device;
        
        if (options.textureSize) this.textureSize = options.textureSize;
        if (options.maxMaterials) this.maxMaterials = options.maxMaterials;
        
        // Calculate mip levels
        this.mipLevelCount = textureMipLevelCount(this.textureSize, this.textureSize);
        
        // Create texture array
        this.textureArray = device.createTexture({
            label: 'Material Texture Array',
            size: [this.textureSize, this.textureSize, this.maxMaterials],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | 
                   GPUTextureUsage.COPY_DST | 
                   GPUTextureUsage.RENDER_ATTACHMENT |
                   GPUTextureUsage.STORAGE_BINDING,
            mipLevelCount: this.mipLevelCount,
        });

        this.normalArray = device.createTexture({
            label: 'Material Normal Array',
            size: [this.textureSize, this.textureSize, this.maxMaterials],
            format: 'rgba16float',
            usage: GPUTextureUsage.TEXTURE_BINDING |
                   GPUTextureUsage.STORAGE_BINDING |
                   GPUTextureUsage.COPY_DST,
            mipLevelCount: this.mipLevelCount,
        });

        this.ormArray = device.createTexture({
            label: 'Material ORM Array',
            size: [this.textureSize, this.textureSize, this.maxMaterials],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING |
                   GPUTextureUsage.STORAGE_BINDING |
                   GPUTextureUsage.COPY_DST,
            mipLevelCount: this.mipLevelCount,
        });

        this.heightArray = device.createTexture({
            label: 'Material Height Array',
            size: [this.textureSize, this.textureSize, this.maxMaterials],
            format: 'rgba16float',
            usage: GPUTextureUsage.TEXTURE_BINDING |
                   GPUTextureUsage.STORAGE_BINDING |
                   GPUTextureUsage.COPY_DST,
            mipLevelCount: this.mipLevelCount,
        });
        
        // Create sampler
        // Note: When using anisotropic filtering, all filters must be 'linear'
        this.sampler = device.createSampler({
            label: 'Material Sampler',
            magFilter: 'linear',
            minFilter: 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'repeat',
            addressModeV: 'repeat',
            maxAnisotropy: 4,
        });
        
        // Also create a nearest-neighbor sampler for pixel-art style
        this.samplerNearest = device.createSampler({
            label: 'Material Sampler Nearest',
            magFilter: 'nearest',
            minFilter: 'nearest',
            mipmapFilter: 'nearest',
            addressModeU: 'repeat',
            addressModeV: 'repeat',
        });
        
        // Generate solid color textures for each material
        await this.generateMaterialTextures();

        if (options.procedural === true) {
            await this.bakeProceduralTextures(options.proceduralOptions || {});
        }
        
        // Calculate total memory usage for the albedo material array.
        this.totalMemory = Math.floor(
            textureMipByteSize(this.textureSize, this.textureSize, 4, this.mipLevelCount, this.maxMaterials)
        );
        
        this.initialized = true;
        console.log(`[TextureArrayManager] Initialized: ${this.materialCount} materials, ${this.textureSize}×${this.textureSize} textures, ${(this.totalMemory / 1024).toFixed(1)} KB`);
    }

    async bakeProceduralTextures(options = {}) {
        if (!this.device || !this.textureArray) return;

        if (!this.proceduralBaker) {
            this.proceduralBaker = new ProceduralMaterialBaker();
        }

        if (!this.proceduralBaker.initialized) {
            await this.proceduralBaker.init(
                this.device,
                {
                    baseColor: this.textureArray,
                    normal: this.normalArray,
                    orm: this.ormArray,
                    height: this.heightArray,
                },
                this.textureSize,
                this.textureSize
            );
        }

        const scale = Number(options.scale ?? 32.0); // Increased from 8.0 to match 64x64 resolution
        const seedBase = (options.seedBase ?? 0) >>> 0;

        this.proceduralBaker.bakeAll(this.materialCount, (layer) => {
            return {
                seed: (seedBase + (layer >>> 0)) >>> 0,
                scale,
                baseColor: this.materialColors[layer] || [0.5, 0.5, 0.5, 1.0],
            };
        });
    }
    
    /**
     * Generate solid color textures for all materials
     */
    async generateMaterialTextures() {
        const size = this.textureSize;
        const pixelCount = size * size;
        
        for (let i = 0; i < this.materialCount; i++) {
            const color = this.materialColors[i] || [0.5, 0.5, 0.5, 1.0];
            
            // Generate texture data with slight noise for visual interest
            const data = new Uint8Array(pixelCount * 4);
            
            for (let p = 0; p < pixelCount; p++) {
                // Deterministic noise based on pixel position and material (for multiplayer sync)
                const px = p % size;
                const py = Math.floor(p / size);
                const noise = textureArrayMaterialNoiseDelta(px, py, i);
                
                data[p * 4 + 0] = Math.floor(Math.max(0, Math.min(255, (color[0] + noise) * 255)));
                data[p * 4 + 1] = Math.floor(Math.max(0, Math.min(255, (color[1] + noise) * 255)));
                data[p * 4 + 2] = Math.floor(Math.max(0, Math.min(255, (color[2] + noise) * 255)));
                data[p * 4 + 3] = Math.floor(color[3] * 255);
            }
            
            // Upload to texture array layer
            this.device.queue.writeTexture(
                { texture: this.textureArray, origin: [0, 0, i] },
                data,
                { bytesPerRow: size * 4, rowsPerImage: size },
                { width: size, height: size, depthOrArrayLayers: 1 }
            );
        }
        
        // Generate mipmaps
        await this.generateMipmaps();
    }
    
    /**
     * Generate mipmaps for all layers
     */
    async generateMipmaps() {
        // For solid colors, we can just copy downscaled versions
        // A proper implementation would use a compute shader
        
        const encoder = this.device.createCommandEncoder();
        
        for (let layer = 0; layer < this.materialCount; layer++) {
            let srcSize = this.textureSize;
            
            for (let mip = 1; mip < this.mipLevelCount; mip++) {
                const dstSize = Math.max(1, srcSize >> 1);
                
                // For solid colors, we can use a simple blit
                // This is a simplified approach - real mipmaps would average pixels
                
                srcSize = dstSize;
            }
        }
        
        this.device.queue.submit([encoder.finish()]);
    }
    
    /**
     * Load a texture for a specific material
     * @param {number} materialIndex 
     * @param {ImageBitmap|HTMLImageElement|HTMLCanvasElement} image 
     */
    async loadMaterialTexture(materialIndex, image) {
        if (!this.initialized) return;
        if (materialIndex >= this.maxMaterials) {
            console.warn(`Material index ${materialIndex} exceeds max ${this.maxMaterials}`);
            return;
        }
        
        // Resize image if needed
        let source = image;
        if (image.width !== this.textureSize || image.height !== this.textureSize) {
            const canvas = new OffscreenCanvas(this.textureSize, this.textureSize);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0, this.textureSize, this.textureSize);
            source = await createImageBitmap(canvas);
        }
        
        // Copy to texture array
        this.device.queue.copyExternalImageToTexture(
            { source },
            { texture: this.textureArray, origin: [0, 0, materialIndex] },
            { width: this.textureSize, height: this.textureSize }
        );
        
        // Regenerate mipmaps for this layer
        // (Would need a compute shader for proper mipmap generation)
    }
    
    /**
     * Set material color (regenerates texture)
     * @param {number} materialIndex 
     * @param {Array} color - [r, g, b, a] in 0-1 range
     */
    setMaterialColor(materialIndex, color) {
        if (materialIndex >= this.maxMaterials) return;
        
        this.materialColors[materialIndex] = color;
        
        // Regenerate this material's texture
        const size = this.textureSize;
        const data = new Uint8Array(size * size * 4);
        
        for (let p = 0; p < size * size; p++) {
            // Deterministic noise for multiplayer sync
            const px = p % size;
            const py = Math.floor(p / size);
            const noise = textureArrayMaterialNoiseDelta(px, py, materialIndex);
            data[p * 4 + 0] = Math.floor(Math.max(0, Math.min(255, (color[0] + noise) * 255)));
            data[p * 4 + 1] = Math.floor(Math.max(0, Math.min(255, (color[1] + noise) * 255)));
            data[p * 4 + 2] = Math.floor(Math.max(0, Math.min(255, (color[2] + noise) * 255)));
            data[p * 4 + 3] = Math.floor(color[3] * 255);
        }
        
        this.device.queue.writeTexture(
            { texture: this.textureArray, origin: [0, 0, materialIndex] },
            data,
            { bytesPerRow: size * 4, rowsPerImage: size },
            { width: size, height: size, depthOrArrayLayers: 1 }
        );
    }
    
    /**
     * Get texture array view for binding
     * @returns {GPUTextureView}
     */
    getTextureView() {
        return this.textureArray.createView({
            dimension: '2d-array',
        });
    }

    getNormalView() {
        return this.normalArray.createView({
            dimension: '2d-array',
        });
    }

    getOrmView() {
        return this.ormArray.createView({
            dimension: '2d-array',
        });
    }

    getHeightView() {
        return this.heightArray.createView({
            dimension: '2d-array',
        });
    }
    
    /**
     * Get sampler for binding
     * @returns {GPUSampler}
     */
    getSampler() {
        return this.sampler;
    }
    
    /**
     * Create bind group entries for this texture array
     * @param {number} textureBinding - Binding index for texture
     * @param {number} samplerBinding - Binding index for sampler
     * @returns {Array}
     */
    getBindGroupEntries(textureBinding, samplerBinding) {
        return [
            { binding: textureBinding, resource: this.getTextureView() },
            { binding: samplerBinding, resource: this.getSampler() },
        ];
    }

    getPbrBindGroupEntries(bindings = {}) {
        return [
            { binding: bindings.baseColorTexture ?? 0, resource: this.getTextureView() },
            { binding: bindings.materialSampler ?? 1, resource: this.getSampler() },
            { binding: bindings.normalTexture ?? 2, resource: this.getNormalView() },
            { binding: bindings.ormTexture ?? 3, resource: this.getOrmView() },
            { binding: bindings.heightTexture ?? 4, resource: this.getHeightView() },
        ];
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [texture_array] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.maxLayers = parseInt(cfg.max_layers) || 256;
        this.resolution = parseInt(cfg.resolution) || 16;
        this.mipmaps = cfg.mipmaps !== false;
        this.anisotropy = parseInt(cfg.anisotropy) || 16;
    }
    
    /**
     * Destroy the texture array
     */
    destroy() {
        this.textureArray?.destroy();
        this.normalArray?.destroy();
        this.ormArray?.destroy();
        this.heightArray?.destroy();
        this.textureArray = null;
        this.normalArray = null;
        this.ormArray = null;
        this.heightArray = null;
        this.sampler = null;
        this.initialized = false;
    }
}

// WGSL shader code for sampling from texture array
export const TEXTURE_ARRAY_WGSL = /* wgsl */ `
// Texture array for materials
@group(1) @binding(0) var materialTextures: texture_2d_array<f32>;
@group(1) @binding(1) var materialSampler: sampler;
@group(1) @binding(2) var materialNormalTextures: texture_2d_array<f32>;
@group(1) @binding(3) var materialOrmTextures: texture_2d_array<f32>;
@group(1) @binding(4) var materialHeightTextures: texture_2d_array<f32>;

// Sample material texture
fn sampleMaterial(uv: vec2<f32>, materialIndex: u32) -> vec4<f32> {
    return textureSample(materialTextures, materialSampler, uv, materialIndex);
}

fn sampleMaterialNormal(uv: vec2<f32>, materialIndex: u32) -> vec3<f32> {
    // Normal XY are stored in RG of rgba16float
    let n = textureSample(materialNormalTextures, materialSampler, uv, materialIndex);
    let xy = n.xy;
    let zz = max(0.0, 1.0 - dot(xy, xy));
    return normalize(vec3<f32>(xy.x, xy.y, sqrt(zz)));
}

fn sampleMaterialOrm(uv: vec2<f32>, materialIndex: u32) -> vec4<f32> {
    return textureSample(materialOrmTextures, materialSampler, uv, materialIndex);
}

fn sampleMaterialHeight(uv: vec2<f32>, materialIndex: u32) -> f32 {
    // Height stored in R of rgba16float
    return textureSample(materialHeightTextures, materialSampler, uv, materialIndex).r;
}

// Sample with LOD (for distance-based detail reduction)
fn sampleMaterialLod(uv: vec2<f32>, materialIndex: u32, lod: f32) -> vec4<f32> {
    return textureSampleLevel(materialTextures, materialSampler, uv, materialIndex, lod);
}
`;

export const TEXTURE_ARRAY_WGSL_GROUP2 = TEXTURE_ARRAY_WGSL.replaceAll('@group(1)', '@group(2)');

export default TextureArrayManager;
