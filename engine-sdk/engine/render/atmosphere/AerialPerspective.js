// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AerialPerspective.js - Blue Shift + Desaturation at Distance
 * Now powered by vGPU driver
 * 
 * Implements the visual phenomenon where distant objects:
 * 1. Shift toward blue (Rayleigh scattering adds blue airlight)
 * 2. Lose saturation (contrast reduction)
 * 3. Become lighter (airlight adds luminance)
 * 
 * This is the artistic interpretation of atmospheric scattering,
 * used by painters since the Renaissance (Leonardo da Vinci's sfumato).
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

// WGSL shader code for aerial perspective
export const AERIAL_PERSPECTIVE_WGSL = /* wgsl */ `
struct AerialPerspectiveUniforms {
    // Effect parameters
    blueShiftStrength: f32,      // How much to shift toward blue (0-1)
    desaturationStrength: f32,   // How much to desaturate (0-1)
    lighteningStrength: f32,     // How much to lighten (0-1)
    
    // Distance parameters
    startDistance: f32,          // Distance where effect begins (meters)
    fullEffectDistance: f32,     // Distance where effect is 100%
    
    // Color targets
    horizonColor: vec3<f32>,     // Color at maximum distance
    _pad1: f32,
    
    // Additional control
    heightFalloff: f32,          // Reduce effect at height
    maxHeight: f32,              // Height where effect is minimal
    _pad2: vec2<f32>,
}

// Convert RGB to HSL
fn rgbToHsl(rgb: vec3<f32>) -> vec3<f32> {
    let maxC = max(max(rgb.r, rgb.g), rgb.b);
    let minC = min(min(rgb.r, rgb.g), rgb.b);
    let l = (maxC + minC) * 0.5;
    
    if (maxC == minC) {
        return vec3<f32>(0.0, 0.0, l);
    }
    
    let d = maxC - minC;
    let s = select(d / (2.0 - maxC - minC), d / (maxC + minC), l > 0.5);
    
    var h: f32;
    if (maxC == rgb.r) {
        h = (rgb.g - rgb.b) / d + select(0.0, 6.0, rgb.g < rgb.b);
    } else if (maxC == rgb.g) {
        h = (rgb.b - rgb.r) / d + 2.0;
    } else {
        h = (rgb.r - rgb.g) / d + 4.0;
    }
    h /= 6.0;
    
    return vec3<f32>(h, s, l);
}

// Convert HSL to RGB
fn hslToRgb(hsl: vec3<f32>) -> vec3<f32> {
    if (hsl.y == 0.0) {
        return vec3<f32>(hsl.z, hsl.z, hsl.z);
    }
    
    let q = select(hsl.z + hsl.y - hsl.z * hsl.y, hsl.z * (1.0 + hsl.y), hsl.z < 0.5);
    let p = 2.0 * hsl.z - q;
    
    let r = hueToRgb(p, q, hsl.x + 1.0/3.0);
    let g = hueToRgb(p, q, hsl.x);
    let b = hueToRgb(p, q, hsl.x - 1.0/3.0);
    
    return vec3<f32>(r, g, b);
}

fn hueToRgb(p: f32, q: f32, t_in: f32) -> f32 {
    var t = t_in;
    if (t < 0.0) { t += 1.0; }
    if (t > 1.0) { t -= 1.0; }
    if (t < 1.0/6.0) { return p + (q - p) * 6.0 * t; }
    if (t < 0.5) { return q; }
    if (t < 2.0/3.0) { return p + (q - p) * (2.0/3.0 - t) * 6.0; }
    return p;
}

// Calculate aerial perspective effect factor
fn aerialPerspectiveFactor(
    distance: f32,
    height: f32,
    ap: AerialPerspectiveUniforms
) -> f32 {
    // Distance-based factor (0 at start, 1 at full effect distance)
    let distFactor = smoothstep(ap.startDistance, ap.fullEffectDistance, distance);
    
    // Height-based reduction (less effect at high altitude)
    let heightFactor = 1.0 - smoothstep(0.0, ap.maxHeight, height) * ap.heightFalloff;
    
    return distFactor * heightFactor;
}

// Apply aerial perspective to a color
fn applyAerialPerspective(
    fragColor: vec3<f32>,
    distance: f32,
    height: f32,
    ap: AerialPerspectiveUniforms
) -> vec3<f32> {
    let factor = aerialPerspectiveFactor(distance, height, ap);
    
    if (factor <= 0.0) {
        return fragColor;
    }
    
    // Convert to HSL for manipulation
    var hsl = rgbToHsl(fragColor);
    
    // 1. Blue shift - move hue toward blue (0.6 in HSL)
    let blueHue = 0.6;
    hsl.x = mix(hsl.x, blueHue, factor * ap.blueShiftStrength);
    
    // 2. Desaturation - reduce saturation
    hsl.y = hsl.y * (1.0 - factor * ap.desaturationStrength);
    
    // 3. Lightening - increase lightness
    hsl.z = mix(hsl.z, 0.8, factor * ap.lighteningStrength);
    
    // Convert back to RGB
    var result = hslToRgb(hsl);
    
    // Blend toward horizon color
    result = mix(result, ap.horizonColor, factor * 0.5);
    
    return result;
}

// Simplified version for chunks (no HSL conversion)
fn applyAerialPerspectiveSimple(
    fragColor: vec3<f32>,
    distance: f32,
    startDist: f32,
    endDist: f32,
    horizonColor: vec3<f32>
) -> vec3<f32> {
    let factor = smoothstep(startDist, endDist, distance);
    
    // Simple blend toward blue-tinted horizon
    let blueShift = vec3<f32>(0.7, 0.8, 1.0);  // Slight blue tint
    let tinted = fragColor * blueShift;
    
    // Desaturate by blending toward luminance
    let lum = dot(tinted, vec3<f32>(0.299, 0.587, 0.114));
    let desaturated = mix(tinted, vec3<f32>(lum), factor * 0.5);
    
    // Blend toward horizon
    return mix(desaturated, horizonColor, factor);
}
`;

/**
 * AerialPerspective - Distance-based color shifting
 */
export class AerialPerspective {
    constructor() {
        this.enabled = true;
        
        // Effect strengths (0-1)
        this.blueShiftStrength = 0.3;
        this.desaturationStrength = 0.6;
        this.lighteningStrength = 0.4;
        
        // Distance parameters (meters)
        this.startDistance = 500;        // Start at 500m
        this.fullEffectDistance = 25000; // Full effect at 25km
        
        // Horizon color (light blue-gray)
        this.horizonColor = [0.7, 0.8, 0.95];
        
        // Height falloff
        this.heightFalloff = 0.8;  // 80% reduction at max height
        this.maxHeight = 5000;     // Effect minimal above 5km
        
        // GPU resources
        this.uniformBuffer = null;
        this.device = null;
        
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
        this.uniformBuffer = this.vgpu.buffer.create({ size: 48, usage: 'uniform', label: 'AerialPerspectiveUniforms' }).buffer;
        
        this.updateUniforms();
        console.log('[AerialPerspective] Initialized with vGPU');
    }
    
    /**
     * Update uniform buffer
     */
    updateUniforms() {
        if (!this.device || !this.uniformBuffer) return;
        
        // Use pre-allocated buffer to avoid per-update allocations
        const data = this._uniformData;
        
        data[0] = this.blueShiftStrength;
        data[1] = this.desaturationStrength;
        data[2] = this.lighteningStrength;
        data[3] = this.startDistance;
        
        data[4] = this.fullEffectDistance;
        data[5] = this.horizonColor[0];
        data[6] = this.horizonColor[1];
        data[7] = this.horizonColor[2];
        
        data[8] = this.heightFalloff;
        data[9] = this.maxHeight;
        data[10] = 0;  // padding
        data[11] = 0;  // padding
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }
    
    /**
     * Configure for a specific view distance
     * @param {number} viewDistanceMeters 
     */
    configureForViewDistance(viewDistanceMeters) {
        this.startDistance = viewDistanceMeters * 0.02;      // 2% of view distance
        this.fullEffectDistance = viewDistanceMeters * 0.9;  // 90% of view distance
        this.updateUniforms();
    }
    
    /**
     * Set horizon color
     * @param {Array} color - [r, g, b] 0-1
     */
    setHorizonColor(color) {
        this.horizonColor = [...color];
        this.updateUniforms();
    }
    
    /**
     * Set effect strengths
     * @param {number} blueShift - 0-1
     * @param {number} desaturation - 0-1
     * @param {number} lightening - 0-1
     */
    setEffectStrengths(blueShift, desaturation, lightening) {
        this.blueShiftStrength = blueShift;
        this.desaturationStrength = desaturation;
        this.lighteningStrength = lightening;
        this.updateUniforms();
    }
    
    /**
     * Apply aerial perspective to a color (CPU-side)
     * @param {Array} color - [r, g, b]
     * @param {number} distance - Distance in meters
     * @param {number} height - Height above ground in meters
     * @returns {Array} - [r, g, b]
     */
    applyEffect(color, distance, height = 0) {
        // Calculate effect factor
        let distFactor = 0;
        if (distance > this.startDistance) {
            distFactor = Math.min(1, (distance - this.startDistance) / 
                (this.fullEffectDistance - this.startDistance));
        }
        
        // Height reduction
        const heightFactor = 1 - Math.min(1, height / this.maxHeight) * this.heightFalloff;
        const factor = distFactor * heightFactor;
        
        if (factor <= 0) return [...color];
        
        // Simple approximation of HSL manipulation
        // Blue shift
        let r = color[0] * (1 - factor * this.blueShiftStrength * 0.3);
        let g = color[1] * (1 - factor * this.blueShiftStrength * 0.1);
        let b = color[2] + factor * this.blueShiftStrength * 0.2;
        
        // Desaturation
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        r = r + (lum - r) * factor * this.desaturationStrength;
        g = g + (lum - g) * factor * this.desaturationStrength;
        b = b + (lum - b) * factor * this.desaturationStrength;
        
        // Lightening
        r = r + (0.8 - r) * factor * this.lighteningStrength;
        g = g + (0.8 - g) * factor * this.lighteningStrength;
        b = b + (0.8 - b) * factor * this.lighteningStrength;
        
        // Blend toward horizon
        r = r + (this.horizonColor[0] - r) * factor * 0.5;
        g = g + (this.horizonColor[1] - g) * factor * 0.5;
        b = b + (this.horizonColor[2] - b) * factor * 0.5;
        
        return [
            Math.max(0, Math.min(1, r)),
            Math.max(0, Math.min(1, g)),
            Math.max(0, Math.min(1, b)),
        ];
    }
    
    /**
     * Get effect factor for a distance
     * @param {number} distance 
     * @returns {number} - 0-1
     */
    getEffectFactor(distance) {
        if (distance <= this.startDistance) return 0;
        if (distance >= this.fullEffectDistance) return 1;
        return (distance - this.startDistance) / (this.fullEffectDistance - this.startDistance);
    }
    
    /**
     * Presets for different environments
     */
    static presets = {
        earthlike: {
            blueShiftStrength: 0.3,
            desaturationStrength: 0.6,
            lighteningStrength: 0.4,
            horizonColor: [0.7, 0.8, 0.95],
        },
        desert: {
            blueShiftStrength: 0.1,
            desaturationStrength: 0.7,
            lighteningStrength: 0.5,
            horizonColor: [0.9, 0.85, 0.7],  // Dusty/tan
        },
        arctic: {
            blueShiftStrength: 0.5,
            desaturationStrength: 0.8,
            lighteningStrength: 0.6,
            horizonColor: [0.85, 0.9, 1.0],  // Icy blue-white
        },
        sunset: {
            blueShiftStrength: -0.2,  // Shift toward warm
            desaturationStrength: 0.3,
            lighteningStrength: 0.2,
            horizonColor: [1.0, 0.7, 0.5],  // Orange
        },
        alien: {
            blueShiftStrength: -0.5,  // Shift toward green/purple
            desaturationStrength: 0.2,
            lighteningStrength: 0.3,
            horizonColor: [0.6, 0.9, 0.7],  // Green
        },
    };
    
    /**
     * Apply a preset
     * @param {string} presetName 
     */
    applyPreset(presetName) {
        const preset = AerialPerspective.presets[presetName];
        if (!preset) return;
        
        this.blueShiftStrength = preset.blueShiftStrength;
        this.desaturationStrength = preset.desaturationStrength;
        this.lighteningStrength = preset.lighteningStrength;
        this.horizonColor = [...preset.horizonColor];
        this.updateUniforms();
    }
    
    /**
     * Get bind group entry
     */
    getBindGroupEntry(binding) {
        return {
            binding,
            resource: { buffer: this.uniformBuffer },
        };
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [aerial_perspective] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.blueShiftStrength = parseFloat(cfg.blue_shift) || 0.3;
        this.desaturationStrength = parseFloat(cfg.desaturation) || 0.6;
        this.lighteningStrength = parseFloat(cfg.lightening) || 0.4;
        
        this.horizonColor = [
            parseFloat(cfg.horizon_r) || 0.7,
            parseFloat(cfg.horizon_g) || 0.8,
            parseFloat(cfg.horizon_b) || 0.95,
        ];
        
        this.startDistance = parseFloat(cfg.start_distance) || 500;
        this.fullEffectDistance = parseFloat(cfg.full_distance) || 25000;
        
        this.updateUniforms();
    }
    
    /**
     * Get WGSL shader code
     */
    static getShaderCode() {
        return AERIAL_PERSPECTIVE_WGSL;
    }
    
    /**
     * Destroy GPU resources
     */
    destroy() {
        this.uniformBuffer?.destroy();
        this.uniformBuffer = null;
    }
}

export default AerialPerspective;
