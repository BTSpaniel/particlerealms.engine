// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * DistanceFog.js - Smooth Distance Fog Fade
 * Now powered by vGPU driver
 * 
 * Fades chunks to fog color at render distance edge.
 * Hides pop-in and provides smooth loading experience.
 * 
 * Benefits:
 * - Hide chunk pop-in visually
 * - Smooth render distance boundary
 * - Atmospheric depth cue
 * - Configurable fog curve
 * 
 * Types:
 * - Linear: Simple distance-based fade
 * - Exponential: More realistic atmospheric scattering
 * - Exponential²: Even denser fog falloff
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

export const FOG_TYPE = {
    NONE: 0,
    LINEAR: 1,
    EXPONENTIAL: 2,
    EXPONENTIAL_SQUARED: 3,
};

// WGSL shader code for fog
export const FOG_WGSL = /* wgsl */ `
struct FogUniforms {
    fogColor: vec3<f32>,
    fogType: u32,
    fogStart: f32,
    fogEnd: f32,
    fogDensity: f32,
    cameraY: f32,
    heightFogStart: f32,
    heightFogEnd: f32,
    heightFogDensity: f32,
    _pad: f32,
}

// Calculate linear fog factor
fn linearFog(dist: f32, start: f32, end: f32) -> f32 {
    return clamp((end - dist) / (end - start), 0.0, 1.0);
}

// Calculate exponential fog factor
fn expFog(dist: f32, density: f32) -> f32 {
    return exp(-density * dist);
}

// Calculate exponential squared fog factor
fn exp2Fog(dist: f32, density: f32) -> f32 {
    let d = density * dist;
    return exp(-d * d);
}

// Calculate height-based fog (denser at lower altitudes)
fn heightFog(worldY: f32, cameraY: f32, start: f32, end: f32, density: f32) -> f32 {
    let heightDiff = worldY - start;
    let heightRange = end - start;
    let heightFactor = clamp(heightDiff / heightRange, 0.0, 1.0);
    return mix(density, 0.0, heightFactor);
}

// Main fog calculation
fn calculateFog(
    fragColor: vec3<f32>,
    worldPos: vec3<f32>,
    cameraPos: vec3<f32>,
    fog: FogUniforms
) -> vec3<f32> {
    if (fog.fogType == 0u) {
        return fragColor;
    }
    
    let dist = distance(worldPos.xz, cameraPos.xz);  // Horizontal distance only
    
    var fogFactor: f32;
    
    switch (fog.fogType) {
        case 1u: {  // Linear
            fogFactor = linearFog(dist, fog.fogStart, fog.fogEnd);
        }
        case 2u: {  // Exponential
            fogFactor = expFog(dist, fog.fogDensity);
        }
        case 3u: {  // Exponential squared
            fogFactor = exp2Fog(dist, fog.fogDensity);
        }
        default: {
            fogFactor = 1.0;
        }
    }
    
    // Apply height fog if enabled
    if (fog.heightFogDensity > 0.0) {
        let hFog = heightFog(worldPos.y, fog.cameraY, fog.heightFogStart, fog.heightFogEnd, fog.heightFogDensity);
        fogFactor *= (1.0 - hFog);
    }
    
    return mix(fog.fogColor, fragColor, fogFactor);
}

// Simplified version for chunk-level fade
fn chunkFogFade(chunkDist: f32, maxDist: f32, fadeStart: f32) -> f32 {
    if (chunkDist < fadeStart) {
        return 1.0;
    }
    return 1.0 - smoothstep(fadeStart, maxDist, chunkDist);
}
`;

/**
 * DistanceFog - Distance-based fog system
 */
export class DistanceFog {
    constructor() {
        this.vgpu = null;
        this.enabled = true;
        
        // Fog parameters
        this.fogType = FOG_TYPE.LINEAR;
        this.fogColor = [0.7, 0.8, 0.9];  // Light blue-gray
        this.fogStart = 100;              // Start distance (blocks)
        this.fogEnd = 200;                // End distance (blocks)
        this.fogDensity = 0.01;           // For exponential fog
        
        // Height fog (optional)
        this.heightFogEnabled = false;
        this.heightFogStart = -50;
        this.heightFogEnd = 50;
        this.heightFogDensity = 0.5;
        
        // Chunk fade (for loading boundaries)
        this.chunkFadeEnabled = true;
        this.chunkFadeStart = 0.7;  // Start fading at 70% of render distance
        
        // GPU resources
        this.uniformBuffer = null;
        this.device = null;
        
        // Camera reference
        this.cameraY = 0;
        
        // Pre-allocated buffer to avoid per-update allocations
        this._uniformData = new Float32Array(12);
    }
    
    /**
     * Initialize GPU resources
     * @param {GPUDevice} device 
     */
    init(device) {
        this.vgpu = initVGPU(device);
        this.device = device;
        
        // Create uniform buffer using vGPU
        this.uniformBuffer = this.vgpu.buffer.create({ size: 48, usage: 'uniform', label: 'FogUniforms' }).buffer;
        
        this.updateUniforms();
        console.log('[DistanceFog] Initialized with vGPU');
    }
    
    /**
     * Update uniform buffer
     */
    updateUniforms() {
        if (!this.device || !this.uniformBuffer) return;
        
        // Use pre-allocated buffer to avoid per-update allocations
        const data = this._uniformData;
        
        // Fog color
        data[0] = this.fogColor[0];
        data[1] = this.fogColor[1];
        data[2] = this.fogColor[2];
        
        // Type (as float, will cast in shader)
        data[3] = this.enabled ? this.fogType : 0;
        
        // Parameters
        data[4] = this.fogStart;
        data[5] = this.fogEnd;
        data[6] = this.fogDensity;
        data[7] = this.cameraY;
        
        // Height fog
        data[8] = this.heightFogStart;
        data[9] = this.heightFogEnd;
        data[10] = this.heightFogEnabled ? this.heightFogDensity : 0;
        data[11] = 0;  // Padding
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }
    
    /**
     * Update camera position
     * @param {number} y 
     */
    updateCameraY(y) {
        this.cameraY = y;
        this.updateUniforms();
    }
    
    /**
     * Set fog type
     * @param {number} type - FOG_TYPE value
     */
    setFogType(type) {
        this.fogType = type;
        this.updateUniforms();
    }
    
    /**
     * Set fog color
     * @param {Array} color - [r, g, b] 0-1
     */
    setFogColor(color) {
        this.fogColor = color;
        this.updateUniforms();
    }
    
    /**
     * Set fog distances (for linear fog)
     * @param {number} start 
     * @param {number} end 
     */
    setFogDistance(start, end) {
        this.fogStart = start;
        this.fogEnd = end;
        this.updateUniforms();
    }
    
    /**
     * Set fog density (for exponential fog)
     * @param {number} density 
     */
    setFogDensity(density) {
        this.fogDensity = density;
        this.updateUniforms();
    }
    
    /**
     * Configure based on render distance
     * @param {number} renderDistance - In blocks
     */
    configureForRenderDistance(renderDistance) {
        this.fogStart = renderDistance * 0.6;
        this.fogEnd = renderDistance;
        this.fogDensity = 3.0 / renderDistance;  // Adjust for exponential
        this.updateUniforms();
    }
    
    /**
     * Calculate fog factor for a position (CPU-side)
     * @param {number} distance - From camera
     * @returns {number} - 0 (full fog) to 1 (no fog)
     */
    calculateFogFactor(distance) {
        if (!this.enabled) return 1;
        
        switch (this.fogType) {
            case FOG_TYPE.LINEAR:
                return Math.max(0, Math.min(1, 
                    (this.fogEnd - distance) / (this.fogEnd - this.fogStart)
                ));
            
            case FOG_TYPE.EXPONENTIAL:
                return Math.exp(-this.fogDensity * distance);
            
            case FOG_TYPE.EXPONENTIAL_SQUARED:
                const d = this.fogDensity * distance;
                return Math.exp(-d * d);
            
            default:
                return 1;
        }
    }
    
    /**
     * Calculate chunk fade factor
     * @param {number} chunkDistance - In chunks
     * @param {number} maxDistance - Max render distance in chunks
     * @returns {number} - 0 (invisible) to 1 (fully visible)
     */
    getChunkFade(chunkDistance, maxDistance) {
        if (!this.chunkFadeEnabled) return 1;
        
        const fadeStart = maxDistance * this.chunkFadeStart;
        
        if (chunkDistance < fadeStart) {
            return 1;
        }
        
        // Smooth fade out
        const t = (chunkDistance - fadeStart) / (maxDistance - fadeStart);
        return 1 - t * t * (3 - 2 * t);  // Smoothstep
    }
    
    /**
     * Apply fog to color (CPU-side)
     * @param {Array} color - [r, g, b]
     * @param {number} distance 
     * @returns {Array} - [r, g, b]
     */
    applyFog(color, distance) {
        const factor = this.calculateFogFactor(distance);
        return [
            color[0] * factor + this.fogColor[0] * (1 - factor),
            color[1] * factor + this.fogColor[1] * (1 - factor),
            color[2] * factor + this.fogColor[2] * (1 - factor),
        ];
    }
    
    /**
     * Get bind group entry for uniform buffer
     * @param {number} binding 
     * @returns {Object}
     */
    getBindGroupEntry(binding) {
        return {
            binding,
            resource: { buffer: this.uniformBuffer },
        };
    }
    
    /**
     * Presets for different environments
     */
    static presets = {
        clear: {
            fogType: FOG_TYPE.LINEAR,
            fogColor: [0.7, 0.8, 0.9],
            fogDensity: 0.005,
        },
        hazy: {
            fogType: FOG_TYPE.EXPONENTIAL,
            fogColor: [0.8, 0.8, 0.85],
            fogDensity: 0.008,
        },
        foggy: {
            fogType: FOG_TYPE.EXPONENTIAL_SQUARED,
            fogColor: [0.7, 0.7, 0.75],
            fogDensity: 0.02,
        },
        underground: {
            fogType: FOG_TYPE.EXPONENTIAL,
            fogColor: [0.1, 0.1, 0.15],
            fogDensity: 0.03,
            heightFogEnabled: true,
            heightFogDensity: 0.8,
        },
        sunset: {
            fogType: FOG_TYPE.EXPONENTIAL,
            fogColor: [1.0, 0.6, 0.3],
            fogDensity: 0.006,
        },
    };
    
    /**
     * Apply a preset
     * @param {string} presetName 
     */
    applyPreset(presetName) {
        const preset = DistanceFog.presets[presetName];
        if (!preset) return;
        
        if (preset.fogType !== undefined) this.fogType = preset.fogType;
        if (preset.fogColor) this.fogColor = [...preset.fogColor];
        if (preset.fogStart !== undefined) this.fogStart = preset.fogStart;
        if (preset.fogEnd !== undefined) this.fogEnd = preset.fogEnd;
        if (preset.fogDensity !== undefined) this.fogDensity = preset.fogDensity;
        if (preset.heightFogEnabled !== undefined) this.heightFogEnabled = preset.heightFogEnabled;
        if (preset.heightFogDensity !== undefined) this.heightFogDensity = preset.heightFogDensity;
        
        this.updateUniforms();
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config object from [distance_fog] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        
        const typeMap = { none: 0, linear: 1, exponential: 2, exponential_squared: 3 };
        this.fogType = typeMap[cfg.type] ?? 1;
        
        this.fogColor = [
            parseFloat(cfg.color_r) || 0.7,
            parseFloat(cfg.color_g) || 0.8,
            parseFloat(cfg.color_b) || 0.9,
        ];
        
        this.fogStart = parseFloat(cfg.start_distance) || 100;
        this.fogEnd = parseFloat(cfg.end_distance) || 200;
        this.fogDensity = parseFloat(cfg.density) || 0.01;
        
        this.updateUniforms();
    }
    
    /**
     * Get WGSL shader code
     */
    static getShaderCode() {
        return FOG_WGSL;
    }
    
    /**
     * Destroy GPU resources
     */
    destroy() {
        this.uniformBuffer?.destroy();
        this.uniformBuffer = null;
    }
}

export default DistanceFog;
