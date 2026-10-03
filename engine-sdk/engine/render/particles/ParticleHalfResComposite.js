// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleHalfResComposite.js - Half-resolution particle rendering + bilateral composite
 * 
 * Renders particles to a half-res RGBA target, then composites onto the main framebuffer
 * with alpha blending. Provides 4× fill-rate reduction for particle rendering.
 * 
 * ==================== PIPELINE OVERVIEW (for future AI/developers) ====================
 * 
 * The particle color pipeline works as follows:
 * 
 * 1. CPU writes per-particle color to metaBuffer in ParticleEmitterSystem.js:
 *    singleMeta[0..2] = emitterColor[0..2] (RGB from elementMixToEmitterConfig)
 *    → uploaded via device.queue.writeBuffer to GPU metaBuffer
 * 
 * 2. SDF vertex shader (particles_sdf_billboard.js) reads: uMeta[ii].xyz → input.color
 *    Uses instance_index (ii) directly — NO alive list indirection in SDF path.
 *    The billboard shader (particles_billboard_vertex.js) DOES use uAliveList, but
 *    the active renderer is SDF (set in EditorParticles.js: particles.pipeline = sdfRenderer.pipeline).
 * 
 * 3. SDF fragment shader applies volumetric lighting + thermal glow to input.color,
 *    outputs vec4<f32>(lit, finalAlpha) — NON-premultiplied.
 * 
 * 4. SDF pipeline renders INTO this half-res texture with blend mode:
 *    color: src-alpha, one-minus-src-alpha  (standard alpha blend)
 *    This produces PRE-MULTIPLIED RGB in the texture because:
 *    result.rgb = src.rgb * src.a + cleared_black * (1 - src.a) = src.rgb * src.a
 * 
 * 5. This composite pass reads the half-res texture and blends onto the scene.
 *    MUST use pre-multiplied blend (srcFactor='one') because step 4 already
 *    multiplied RGB by alpha. Using srcFactor='src-alpha' would DOUBLE the alpha
 *    (lit * alpha²), making low-alpha particles nearly invisible.
 * 
 * CRITICAL: If you change the SDF pipeline blend mode, you must update this composite
 * blend mode to match. src-alpha render → 'one' composite. premultiplied render → 'one' composite.
 * 
 * Ref: GPU Gems 3 Ch.23 "High-Speed Off-Screen Particles"
 */

// ============================================================================
// COMPOSITE SHADER - Fullscreen triangle, samples half-res color, alpha blends
// ============================================================================

const COMPOSITE_SHADER = `
@group(0) @binding(0) var halfResColor: texture_2d<f32>;
@group(0) @binding(1) var halfResSampler: sampler;

struct VSOut {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
    // Fullscreen triangle (3 vertices cover entire screen)
    var out: VSOut;
    let x = f32((vi << 1u) & 2u);
    let y = f32(vi & 2u);
    out.position = vec4<f32>(x * 2.0 - 1.0, -(y * 2.0 - 1.0), 0.0, 1.0);
    out.uv = vec2<f32>(x, y);
    return out;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
    return textureSample(halfResColor, halfResSampler, input.uv);
}
`;

// ============================================================================
// HALF-RES COMPOSITE SYSTEM
// ============================================================================

/**
 * Create the half-resolution particle rendering + composite system.
 * @param {GPUDevice} device
 * @param {GPUTextureFormat} format - Main framebuffer format (e.g. 'bgra8unorm')
 * @param {number} fullWidth - Full resolution width
 * @param {number} fullHeight - Full resolution height
 */
export function createHalfResCompositeSystem(device, format, fullWidth, fullHeight) {
    const shaderModule = device.createShaderModule({
        label: "HalfResComposite.shader",
        code: COMPOSITE_SHADER,
    });

    // Sampler for bilinear upsampling of half-res color
    const sampler = device.createSampler({
        label: "HalfResComposite.sampler",
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
    });

    // Composite pipeline: ADDITIVE blend of half-res particles onto main framebuffer.
    // Particles can only ADD brightness to the scene, never darken it.
    // This eliminates dark auras from semi-transparent particles on dark backgrounds.
    // The SDF pipeline renders into the half-res texture with src-alpha blend (producing
    // pre-multiplied RGB = lit*alpha). The additive composite adds this directly to the scene.
    // Fire/plasma = bright glow, water/ice = subtle blue tint, smoke = barely visible.
    const pipeline = device.createRenderPipeline({
        label: "HalfResComposite.pipeline",
        layout: "auto",
        vertex: {
            module: shaderModule,
            entryPoint: "vs_main",
        },
        fragment: {
            module: shaderModule,
            entryPoint: "fs_main",
            targets: [{
                format,
                blend: {
                    color: {
                        srcFactor: 'one',
                        dstFactor: 'one',
                        operation: 'add',
                    },
                    alpha: {
                        srcFactor: 'one',
                        dstFactor: 'one',
                        operation: 'add',
                    },
                },
                writeMask: GPUColorWrite.ALL,
            }],
        },
        primitive: {
            topology: 'triangle-list',
        },
    });

    const system = {
        device,
        format,
        pipeline,
        sampler,
        colorTexture: null,
        colorView: null,
        depthTexture: null,
        depthView: null,
        bindGroup: null,
        halfWidth: 0,
        halfHeight: 0,
        enabled: true,
    };

    // Create initial half-res targets
    resizeHalfResTargets(system, fullWidth, fullHeight);

    console.log(`[HalfResComposite] Half-resolution particle rendering initialized (${system.halfWidth}×${system.halfHeight})`);
    return system;
}

/**
 * Resize half-res render targets. Call when the window/canvas resizes.
 */
export function resizeHalfResTargets(system, fullWidth, fullHeight) {
    if (!system || !system.device) return;

    const halfWidth = Math.max(1, (fullWidth / 2) | 0);
    const halfHeight = Math.max(1, (fullHeight / 2) | 0);

    // Skip if size hasn't changed
    if (system.halfWidth === halfWidth && system.halfHeight === halfHeight) return;

    const device = system.device;

    // Destroy old textures
    if (system.colorTexture) {
        system.colorTexture.destroy();
    }
    if (system.depthTexture) {
        system.depthTexture.destroy();
    }

    // Half-res color target: particles render here, then composited onto main
    system.colorTexture = device.createTexture({
        label: "HalfResParticle.color",
        size: { width: halfWidth, height: halfHeight, depthOrArrayLayers: 1 },
        format: system.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    system.colorView = system.colorTexture.createView();

    // Half-res depth target: needed by SDF pipeline (depthFormat: depth24plus)
    system.depthTexture = device.createTexture({
        label: "HalfResParticle.depth",
        size: { width: halfWidth, height: halfHeight, depthOrArrayLayers: 1 },
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    system.depthView = system.depthTexture.createView();

    system.halfWidth = halfWidth;
    system.halfHeight = halfHeight;

    // Recreate bind group with new texture view
    system.bindGroup = device.createBindGroup({
        label: "HalfResComposite.bindGroup",
        layout: system.pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: system.colorView },
            { binding: 1, resource: system.sampler },
        ],
    });
}

/**
 * Get the render pass descriptor for the half-res particle pass.
 * Clear to transparent black (0,0,0,0) so alpha blending composites correctly.
 * After particles render here with src-alpha blend, the texture contains
 * pre-multiplied color: rgb = lit * alpha, a = combined alpha.
 */
export function getHalfResPassDescriptor(system) {
    if (!system || !system.colorView) return null;

    // Cache descriptor (views only change on resize, which rebuilds the system)
    if (!system._passDesc) {
        system._passDesc = {
            label: "HalfResParticle.pass",
            colorAttachments: [{ view: null, loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: 'store' }],
            depthStencilAttachment: system.depthView ? { view: null, depthLoadOp: 'clear', depthClearValue: 1.0, depthStoreOp: 'discard' } : undefined,
        };
    }
    system._passDesc.colorAttachments[0].view = system.colorView;
    if (system._passDesc.depthStencilAttachment) system._passDesc.depthStencilAttachment.view = system.depthView;
    return system._passDesc;
}

/**
 * Execute the composite pass: upsample half-res particles onto main framebuffer.
 * @param {Object} system - Half-res composite system
 * @param {GPUCommandEncoder} encoder - Command encoder
 * @param {GPUTextureView} mainTextureView - Main framebuffer texture view
 */
export function executeComposite(system, encoder, mainTextureView) {
    if (!system || !system.bindGroup || !mainTextureView) return;

    if (!system._compositeDesc) {
        system._compositeDesc = { label: "HalfResComposite.pass", colorAttachments: [{ view: null, loadOp: 'load', storeOp: 'store' }] };
    }
    system._compositeDesc.colorAttachments[0].view = mainTextureView;
    const pass = encoder.beginRenderPass(system._compositeDesc);

    pass.setPipeline(system.pipeline);
    pass.setBindGroup(0, system.bindGroup);
    pass.draw(3); // Fullscreen triangle
    pass.end();
}

/**
 * Destroy half-res composite system resources.
 */
export function destroyHalfResCompositeSystem(system) {
    if (!system) return;
    if (system.colorTexture) {
        system.colorTexture.destroy();
        system.colorTexture = null;
    }
    if (system.depthTexture) {
        system.depthTexture.destroy();
        system.depthTexture = null;
    }
    system.colorView = null;
    system.depthView = null;
    system.bindGroup = null;
}
