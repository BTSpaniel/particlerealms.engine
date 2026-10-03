// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * BlueNoise.js - Blue Noise Texture for Anti-Banding
 * Now powered by vGPU driver
 * 
 * Provides spatially-uniform noise for:
 * - Ray march jittering (prevents banding)
 * - Dithering before quantization
 * - Temporal offset patterns
 * 
 * Uses precomputed 128x128 blue noise texture (4 channels)
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import { fract } from '../../core/math/MathScalar.js';

// Blue noise LUT size
const BLUE_NOISE_SIZE = 128;

// Precomputed blue noise data (simplified - real implementation would load from file)
// This generates a reasonable approximation using golden ratio sampling
function generateBlueNoise(size) {
    const data = new Uint8Array(size * size * 4);
    const goldenRatio = 1.618033988749895;
    
    // R channel - base noise
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const idx = (y * size + x) * 4;
            
            // R1 low-discrepancy sequence approximation
            const r1 = (x * goldenRatio + y * goldenRatio * goldenRatio) % 1;
            const r2 = (y * goldenRatio + x * goldenRatio * goldenRatio * goldenRatio) % 1;
            
            // Hash for additional randomness
            const hash1 = fract(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453);
            const hash2 = fract(Math.sin(x * 39.346 + y * 11.135) * 43758.5453);
            const hash3 = fract(Math.sin(x * 73.156 + y * 52.235) * 43758.5453);
            const hash4 = fract(Math.sin(x * 91.234 + y * 31.789) * 43758.5453);
            
            // Combine for blue-noise-like distribution
            data[idx + 0] = Math.floor(fract(r1 + hash1 * 0.5) * 255);
            data[idx + 1] = Math.floor(fract(r2 + hash2 * 0.5) * 255);
            data[idx + 2] = Math.floor(fract(r1 * r2 + hash3 * 0.5) * 255);
            data[idx + 3] = Math.floor(fract((r1 + r2) * 0.5 + hash4 * 0.5) * 255);
        }
    }
    
    return data;
}

// WGSL code for blue noise sampling
export const BLUE_NOISE_WGSL = /* wgsl */ `
// Blue noise texture sampling utilities

// Sample blue noise at screen position (tiled)
fn sampleBlueNoise(blueNoiseTex: texture_2d<f32>, noiseSampler: sampler, screenPos: vec2<f32>, frameIndex: u32) -> vec4<f32> {
    // Tile the noise texture
    let noiseSize = 128.0;
    let uv = fract(screenPos / noiseSize);
    
    // Animate with frame index for temporal variation
    let offset = vec2<f32>(
        f32(frameIndex % 8u) / 8.0,
        f32((frameIndex / 8u) % 8u) / 8.0
    );
    
    return textureSample(blueNoiseTex, noiseSampler, fract(uv + offset));
}

// Jitter ray start position using blue noise
fn jitterRayStart(baseT: f32, stepSize: f32, noiseValue: f32) -> f32 {
    return baseT + (noiseValue - 0.5) * stepSize;
}

// Dither color before 8-bit quantization
fn ditherColor(color: vec3<f32>, noise: vec3<f32>) -> vec3<f32> {
    let dither = (noise - 0.5) / 255.0;
    return color + dither;
}

// Interleaved gradient noise (alternative, no texture needed)
fn interleavedGradientNoise(screenPos: vec2<f32>, frameIndex: u32) -> f32 {
    let magic = vec3<f32>(0.06711056, 0.00583715, 52.9829189);
    let pos = screenPos + vec2<f32>(f32(frameIndex) * 5.588238);
    return fract(magic.z * fract(dot(pos, magic.xy)));
}

// R2 sequence for low-discrepancy sampling
fn r2Sequence(index: u32) -> vec2<f32> {
    let g = 1.32471795724;  // Plastic constant
    let a1 = 1.0 / g;
    let a2 = 1.0 / (g * g);
    return fract(vec2<f32>(f32(index) * a1, f32(index) * a2));
}
`;

/**
 * BlueNoiseTexture - GPU blue noise texture manager
 */
export class BlueNoiseTexture {
    constructor() {
        this.initialized = false;
        this.vgpu = null;
        this.device = null;
        this.texture = null;
        this.sampler = null;
        this.frameIndex = 0;
    }
    
    /**
     * Initialize blue noise texture
     * @param {GPUDevice} device 
     */
    init(device) {
        this.vgpu = initVGPU(device);
        this.device = device;
        
        // Generate blue noise data
        const noiseData = generateBlueNoise(BLUE_NOISE_SIZE);
        
        // Create texture using vGPU
        this.texture = this.vgpu.texture.create({
            width: BLUE_NOISE_SIZE, height: BLUE_NOISE_SIZE,
            format: 'rgba8unorm', usage: 'texture|copy-dst', label: 'BlueNoiseTexture'
        }).texture;
        
        // Upload data
        device.queue.writeTexture(
            { texture: this.texture },
            noiseData,
            { bytesPerRow: BLUE_NOISE_SIZE * 4 },
            { width: BLUE_NOISE_SIZE, height: BLUE_NOISE_SIZE }
        );
        
        // Create sampler using vGPU
        this.sampler = this.vgpu.texture.sampler({ filter: 'nearest', addressMode: 'repeat' });
        
        this.initialized = true;
        console.log(`[BlueNoise] Initialized ${BLUE_NOISE_SIZE}×${BLUE_NOISE_SIZE} with vGPU`);
    }
    
    /**
     * Advance frame counter (call once per frame)
     */
    nextFrame() {
        this.frameIndex = (this.frameIndex + 1) % 64;
    }
    
    /**
     * Get texture view for binding
     */
    getTextureView() {
        return this.texture?.createView();
    }
    
    /**
     * Get sampler for binding
     */
    getSampler() {
        return this.sampler;
    }
    
    /**
     * Get current frame index
     */
    getFrameIndex() {
        return this.frameIndex;
    }
    
    /**
     * Destroy GPU resources
     */
    destroy() {
        this.texture?.destroy();
        this.initialized = false;
    }
}

export default BlueNoiseTexture;
