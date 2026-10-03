// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleTextureAtlas.js - Texture Atlas System for Particles
 * 
 * Features:
 * - Sprite sheet loading and management
 * - Per-particle sprite selection
 * - Animated sprite sequences
 * - UV coordinate generation for atlas sampling
 */

import { createStorageBuffer, createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { random } from '../../core/math/MathRandom.js';
import { labelResource } from "../../core/gpu/GpuDebug.js";

// ============================================================================
// TEXTURE ATLAS SHADER SNIPPETS
// ============================================================================

export const TEXTURE_ATLAS_TYPES = `
struct AtlasParams {
    atlasWidth: u32,
    atlasHeight: u32,
    spriteWidth: u32,
    spriteHeight: u32,
    spritesPerRow: u32,
    totalSprites: u32,
    animationSpeed: f32,
    time: f32,
}

struct SpriteUV {
    uMin: f32,
    vMin: f32,
    uMax: f32,
    vMax: f32,
}
`;

export const TEXTURE_ATLAS_FUNCTIONS = `
fn getSpriteUV(params: AtlasParams, spriteIndex: u32, animFrame: u32) -> SpriteUV {
    var actualIndex = spriteIndex;
    
    // Add animation frame offset if animated
    if (params.animationSpeed > 0.0) {
        actualIndex = (spriteIndex + animFrame) % params.totalSprites;
    }
    
    let row = actualIndex / params.spritesPerRow;
    let col = actualIndex % params.spritesPerRow;
    
    let spriteWidthNorm = f32(params.spriteWidth) / f32(params.atlasWidth);
    let spriteHeightNorm = f32(params.spriteHeight) / f32(params.atlasHeight);
    
    var uv: SpriteUV;
    uv.uMin = f32(col) * spriteWidthNorm;
    uv.vMin = f32(row) * spriteHeightNorm;
    uv.uMax = uv.uMin + spriteWidthNorm;
    uv.vMax = uv.vMin + spriteHeightNorm;
    
    return uv;
}

fn sampleAtlas(atlas: texture_2d<f32>, atlasSampler: sampler, uv: vec2<f32>, spriteUV: SpriteUV) -> vec4<f32> {
    let mappedUV = vec2<f32>(
        mix(spriteUV.uMin, spriteUV.uMax, uv.x),
        mix(spriteUV.vMin, spriteUV.vMax, uv.y)
    );
    return textureSample(atlas, atlasSampler, mappedUV);
}
`;

// Compute shader for assigning sprites to particles
const SPRITE_ASSIGNMENT_SHADER = `
struct AssignParams {
    particleCount: u32,
    totalSprites: u32,
    assignmentMode: u32,  // 0=random, 1=by-age, 2=by-velocity, 3=by-size, 4=flipbook
    seed: u32,
    time: f32,
    flipbookFPS: f32,       // Frames per second for flipbook mode
    flipbookFrameCount: u32, // Number of frames in the flipbook sequence
    flipbookRandomStart: u32, // 1 = random start frame per particle
}

@group(0) @binding(0) var<uniform> params: AssignParams;
@group(0) @binding(1) var<storage, read> particleData: array<vec4<f32>>;  // xyz=pos, w=age or size
@group(0) @binding(2) var<storage, read> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> spriteIndices: array<u32>;

fn hash(x: u32) -> u32 {
    var v = x;
    v ^= v >> 16u;
    v *= 0x7feb352du;
    v ^= v >> 15u;
    v *= 0x846ca68bu;
    v ^= v >> 16u;
    return v;
}

@compute @workgroup_size(256)
fn assignSprites(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.particleCount) { return; }
    
    var spriteIdx: u32 = 0u;
    
    if (params.assignmentMode == 0u) {
        // Random assignment
        spriteIdx = hash(i + params.seed) % params.totalSprites;
    } else if (params.assignmentMode == 1u) {
        // By age (w component)
        let age = particleData[i].w;
        spriteIdx = u32(age * f32(params.totalSprites)) % params.totalSprites;
    } else if (params.assignmentMode == 2u) {
        // By velocity magnitude
        let vel = length(velocities[i].xyz);
        let normalizedVel = clamp(vel / 10.0, 0.0, 1.0);
        spriteIdx = u32(normalizedVel * f32(params.totalSprites - 1u));
    } else if (params.assignmentMode == 4u) {
        // Flipbook: animate through frames at configurable FPS
        // age = particleData[i].w, lifetime = velocities[i].w
        let age = particleData[i].w;
        let lifetime = max(velocities[i].w, 0.1);
        let frameCount = max(params.flipbookFrameCount, 1u);
        
        // Random start frame offset per particle
        var startFrame = 0u;
        if (params.flipbookRandomStart > 0u) {
            startFrame = hash(i + params.seed) % frameCount;
        }
        
        // Compute current frame from age × FPS
        var currentFrame: u32;
        if (params.flipbookFPS > 0.0) {
            // FPS-based: fixed frame rate
            currentFrame = u32(floor(age * params.flipbookFPS));
        } else {
            // Lifetime-based: spread all frames evenly across particle lifetime
            let t = clamp(age / lifetime, 0.0, 0.9999);
            currentFrame = u32(t * f32(frameCount));
        }
        
        spriteIdx = (startFrame + currentFrame) % frameCount;
        
        // Pack blend factor into upper 8 bits for optional inter-frame blending
        // Fragment shader can use this to lerp between frame N and N+1
        var blendFrac: f32;
        if (params.flipbookFPS > 0.0) {
            blendFrac = fract(age * params.flipbookFPS);
        } else {
            let t = clamp(age / lifetime, 0.0, 0.9999);
            blendFrac = fract(t * f32(frameCount));
        }
        let blendBits = u32(blendFrac * 255.0) << 24u;
        spriteIdx = spriteIdx | blendBits;
    } else {
        // By size (use some particle attribute)
        let size = abs(particleData[i].w);
        spriteIdx = u32(size * f32(params.totalSprites)) % params.totalSprites;
    }
    
    spriteIndices[i] = spriteIdx;
}
`;

// ============================================================================
// TEXTURE ATLAS SYSTEM
// ============================================================================

/**
 * Create texture atlas configuration
 */
export function createAtlasConfig(options = {}) {
    return {
        atlasWidth: options.atlasWidth || 1024,
        atlasHeight: options.atlasHeight || 1024,
        spriteWidth: options.spriteWidth || 64,
        spriteHeight: options.spriteHeight || 64,
        spritesPerRow: options.spritesPerRow || 16,
        totalSprites: options.totalSprites || 256,
        animationSpeed: options.animationSpeed || 0,
        animated: options.animated || false,
        framesPerAnimation: options.framesPerAnimation || 8,
        // Flipbook (Niagara parity)
        flipbookFPS: options.flipbookFPS || 0,           // 0 = lifetime-based, >0 = fixed FPS
        flipbookFrameCount: options.flipbookFrameCount || 0, // 0 = use totalSprites
        flipbookRandomStart: options.flipbookRandomStart || false,
    };
}

/**
 * Create texture atlas system
 */
export function createTextureAtlasSystem(device, maxParticles, config = {}) {
    const atlasConfig = createAtlasConfig(config);
    
    const shaderModule = device.createShaderModule({
        label: "TextureAtlas.shader",
        code: SPRITE_ASSIGNMENT_SHADER,
    });
    
    // Sprite index per particle
    const spriteIndicesBuffer = createStorageBuffer(device, maxParticles * 4, {
        label: "TextureAtlas.spriteIndices",
    });
    
    // Atlas params uniform
    const paramsBuffer = createUniformBuffer(device, 32, {
        label: "TextureAtlas.params",
    });
    
    const pipeline = device.createComputePipeline({
        label: "TextureAtlas.pipeline",
        layout: "auto",
        compute: { module: shaderModule, entryPoint: "assignSprites" },
    });
    
    labelResource(spriteIndicesBuffer, "TextureAtlas.spriteIndices");
    labelResource(paramsBuffer, "TextureAtlas.params");
    
    // Create sampler for atlas texture
    const atlasSampler = device.createSampler({
        label: "TextureAtlas.sampler",
        magFilter: "linear",
        minFilter: "linear",
        mipmapFilter: "linear",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
    });
    
    return {
        shaderModule,
        spriteIndicesBuffer,
        paramsBuffer,
        pipeline,
        atlasSampler,
        atlasConfig,
        maxParticles,
        atlasTexture: null,
        bindGroup: null,
        assignmentMode: 0, // 0=random, 1=by-age, 2=by-velocity, 3=by-size
    };
}

/**
 * Load texture atlas from image
 */
export async function loadAtlasTexture(atlasSystem, device, imageUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, img.width, img.height);
            
            const texture = device.createTexture({
                label: "TextureAtlas.texture",
                size: [img.width, img.height, 1],
                format: "rgba8unorm",
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            });
            
            device.queue.writeTexture(
                { texture },
                imageData.data,
                { bytesPerRow: img.width * 4, rowsPerImage: img.height },
                [img.width, img.height, 1]
            );
            
            atlasSystem.atlasTexture = texture;
            atlasSystem.atlasConfig.atlasWidth = img.width;
            atlasSystem.atlasConfig.atlasHeight = img.height;
            atlasSystem.atlasConfig.spritesPerRow = Math.floor(img.width / atlasSystem.atlasConfig.spriteWidth);
            
            console.log(`[TextureAtlas] Loaded ${img.width}x${img.height} atlas with ${atlasSystem.atlasConfig.spritesPerRow} sprites per row`);
            resolve(texture);
        };
        
        img.onerror = () => reject(new Error(`Failed to load atlas: ${imageUrl}`));
        img.src = imageUrl;
    });
}

/**
 * Create procedural atlas texture (for testing)
 */
export function createProceduralAtlas(atlasSystem, device, options = {}) {
    const width = options.width || 512;
    const height = options.height || 512;
    const spriteSize = options.spriteSize || 32;
    const spritesPerRow = Math.floor(width / spriteSize);
    const totalSprites = spritesPerRow * Math.floor(height / spriteSize);
    
    const data = new Uint8Array(width * height * 4);
    
    // Generate different colored/patterned sprites
    for (let sy = 0; sy < Math.floor(height / spriteSize); sy++) {
        for (let sx = 0; sx < spritesPerRow; sx++) {
            const spriteIdx = sy * spritesPerRow + sx;
            
            // Random color per sprite
            const r = Math.floor((Math.sin(spriteIdx * 0.7) * 0.5 + 0.5) * 255);
            const g = Math.floor((Math.sin(spriteIdx * 1.3 + 2) * 0.5 + 0.5) * 255);
            const b = Math.floor((Math.sin(spriteIdx * 1.9 + 4) * 0.5 + 0.5) * 255);
            
            for (let py = 0; py < spriteSize; py++) {
                for (let px = 0; px < spriteSize; px++) {
                    const x = sx * spriteSize + px;
                    const y = sy * spriteSize + py;
                    const idx = (y * width + x) * 4;
                    
                    // Create circular sprite with soft edges
                    const cx = px - spriteSize / 2;
                    const cy = py - spriteSize / 2;
                    const dist = Math.sqrt(cx * cx + cy * cy);
                    const radius = spriteSize / 2 - 2;
                    const alpha = Math.max(0, 1 - dist / radius);
                    const softAlpha = Math.pow(alpha, 0.5);
                    
                    data[idx] = r;
                    data[idx + 1] = g;
                    data[idx + 2] = b;
                    data[idx + 3] = Math.floor(softAlpha * 255);
                }
            }
        }
    }
    
    const texture = device.createTexture({
        label: "TextureAtlas.procedural",
        size: [width, height, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    
    device.queue.writeTexture(
        { texture },
        data,
        { bytesPerRow: width * 4, rowsPerImage: height },
        [width, height, 1]
    );
    
    atlasSystem.atlasTexture = texture;
    atlasSystem.atlasConfig.atlasWidth = width;
    atlasSystem.atlasConfig.atlasHeight = height;
    atlasSystem.atlasConfig.spriteWidth = spriteSize;
    atlasSystem.atlasConfig.spriteHeight = spriteSize;
    atlasSystem.atlasConfig.spritesPerRow = spritesPerRow;
    atlasSystem.atlasConfig.totalSprites = totalSprites;
    
    console.log(`[TextureAtlas] Created procedural atlas ${width}x${height} with ${totalSprites} sprites`);
    
    return texture;
}

/**
 * Initialize sprite assignment bind group
 */
export function initAtlasBindGroup(atlasSystem, device, positionsBuffer, velocitiesBuffer) {
    atlasSystem.bindGroup = device.createBindGroup({
        label: "TextureAtlas.bindGroup",
        layout: atlasSystem.pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: atlasSystem.paramsBuffer } },
            { binding: 1, resource: { buffer: positionsBuffer } },
            { binding: 2, resource: { buffer: velocitiesBuffer } },
            { binding: 3, resource: { buffer: atlasSystem.spriteIndicesBuffer } },
        ],
    });
}

/**
 * Assign sprites to particles via GPU
 */
export function assignSpritesGPU(atlasSystem, device, particleCount, time) {
    if (!atlasSystem.bindGroup || particleCount === 0) return;
    
    const paramsData = new Float32Array([
        particleCount,
        atlasSystem.atlasConfig.totalSprites,
        atlasSystem.assignmentMode,
        Math.floor(random() * 0xFFFFFF),
        time, 0, 0, 0
    ]);
    const u32View = new Uint32Array(paramsData.buffer);
    u32View[0] = particleCount;
    u32View[1] = atlasSystem.atlasConfig.totalSprites;
    u32View[2] = atlasSystem.assignmentMode;
    u32View[3] = Math.floor(random() * 0xFFFFFF);
    
    updateBuffer(device, atlasSystem.paramsBuffer, paramsData, 0);
    
    const encoder = device.createCommandEncoder({ label: "TextureAtlas.encoder" });
    const pass = encoder.beginComputePass({ label: "TextureAtlas.assign" });
    pass.setPipeline(atlasSystem.pipeline);
    pass.setBindGroup(0, atlasSystem.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(particleCount / 256));
    pass.end();
    
    device.queue.submit([encoder.finish()]);
}

/**
 * Get atlas uniforms for rendering
 */
export function getAtlasUniforms(atlasSystem, time) {
    const cfg = atlasSystem.atlasConfig;
    return {
        atlasWidth: cfg.atlasWidth,
        atlasHeight: cfg.atlasHeight,
        spriteWidth: cfg.spriteWidth,
        spriteHeight: cfg.spriteHeight,
        spritesPerRow: cfg.spritesPerRow,
        totalSprites: cfg.totalSprites,
        animationSpeed: cfg.animationSpeed,
        time: time,
    };
}

/**
 * Set sprite assignment mode
 */
export function setAssignmentMode(atlasSystem, mode) {
    const modes = { random: 0, age: 1, velocity: 2, size: 3 };
    atlasSystem.assignmentMode = modes[mode] ?? 0;
}

/**
 * Destroy texture atlas system
 */
export function destroyTextureAtlasSystem(atlasSystem) {
    if (!atlasSystem) return;
    
    if (atlasSystem.atlasTexture) {
        atlasSystem.atlasTexture.destroy();
    }
    if (atlasSystem.spriteIndicesBuffer) {
        atlasSystem.spriteIndicesBuffer.destroy();
    }
    if (atlasSystem.paramsBuffer) {
        atlasSystem.paramsBuffer.destroy();
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
    TEXTURE_ATLAS_TYPES,
    TEXTURE_ATLAS_FUNCTIONS,
    createAtlasConfig,
    createTextureAtlasSystem,
    loadAtlasTexture,
    createProceduralAtlas,
    initAtlasBindGroup,
    assignSpritesGPU,
    getAtlasUniforms,
    setAssignmentMode,
    destroyTextureAtlasSystem,
};
