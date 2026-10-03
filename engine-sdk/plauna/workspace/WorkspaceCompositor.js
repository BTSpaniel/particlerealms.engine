// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * WorkspaceCompositor.js — WebGPU blit pipeline for GPU panels.
 *
 * Architecture:
 * - Each GPUPanel owns a GPUTexture render target
 * - Compositor blits all visible GPU panels onto canvas swap chain each frame
 * - DOM panels are rendered directly by browser (compositor only handles WebGPU)
 * - Simple blit shader: just copies texture to canvas
 *
 * Pipeline components:
 * - Sampler: Linear filtering for panel textures
 * - Bind group layout: Single texture binding (binding 0)
 * - Shader: Simple vertex + fragment shader for texture copy
 * - Blend state: Alpha blending for layered panels
 *
 * Render loop:
 * - Called by WorkspaceManager each frame
 * - Iterates visible GPU panels in z-order
 * - Creates bind group per panel
 * - Issues draw call (6 vertices for quad)
 */

/**
 * WorkspaceCompositor - WebGPU texture compositor.
 *
 * Compositor pattern:
 * - Blits GPU panel textures to canvas swap chain
 * - Handles only WebGPU panels (DOM panels rendered by browser)
 * - Simple texture copy pipeline (no post-processing)
 * - Alpha blending for layered panel support
 */
export class WorkspaceCompositor {
    constructor(options) {
        this.device = options.device;
        this.format = options.format || 'bgra8unorm';
        this.canvas = options.canvas;
        this.logger = options.logger || { info: console.log, warn: console.warn, error: console.error };

        this._blitPipeline = null;
        this._bindGroupLayout = null;
        this._sampler = null;

        this._initialized = false;
    }

    /**
     * Initialize the blit pipeline.
     *
     * Pipeline initialization:
     * - Creates sampler with linear filtering
     * - Creates bind group layout for texture binding
     * - Creates shader module with vertex + fragment stages
     * - Creates render pipeline with blend state
     *
     * Shader details:
     * - Vertex: Full-screen quad (6 vertices)
     * - Fragment: Texture load at (0,0) for full texture copy
     * - Blend: Standard alpha blending for layered panels
     */
    async init() {
        if (this._initialized) return;

        try {
            // Sampler for panel textures
            this._sampler = this.device.createSampler({
                magFilter:   'linear',
                minFilter:   'linear',
                mipmapFilter: 'nearest',
            });

            // Bind group layout: { texture: binding 0 }
            this._bindGroupLayout = this.device.createBindGroupLayout({
                entries: [{
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: {
                        sampleType: 'float',
                    },
                }],
            });

            // Simple blit shader — just copy texture
            const shaderCode = `
                struct Uniforms {
                    offset: vec2f,
                    scale: vec2f,
                };
                @group(0) @binding(0) var panelTexture: texture_2d<f32>;
                @vertex
                fn vs_main(@builtin(vertex_index) vi: u32) -> builtin_position<vec4f> {
                    const positions = array<vec2f, 6>(
                        vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
                        vec2f(-1.0, 1.0),  vec2f(1.0, -1.0), vec2f(1.0, 1.0)
                    );
                    return vec4f(positions[vi], 0.0, 1.0);
                }
                @fragment
                fn fs_main() -> @location(0) vec4f {
                    return textureLoad(panelTexture, vec2i(0), 0);
                }
            `;
            const shaderModule = this.device.createShaderModule({ code: shaderCode });

            // Pipeline
            this._blitPipeline = this.device.createRenderPipeline({
                layout: this.device.createPipelineLayout({ bindGroupLayouts: [this._bindGroupLayout] }),
                vertex: {
                    module: shaderModule,
                    entryPoint: 'vs_main',
                },
                fragment: {
                    module: shaderModule,
                    entryPoint: 'fs_main',
                    targets: [{
                        format: this.format,
                        blend: {
                            color: {
                                srcFactor: 'src-alpha',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add',
                            },
                            alpha: {
                                srcFactor: 'one',
                                dstFactor: 'one-minus-src-alpha',
                                operation: 'add',
                            },
                        },
                    }],
                },
                primitive: {
                    topology: 'triangle-list',
                },
            });

            this._initialized = true;
            this.logger.info('[WorkspaceCompositor] Initialized');
        } catch (err) {
            this.logger.error('[WorkspaceCompositor] Init failed:', err);
            throw err;
        }
    }

    /**
     * Compose all GPU panels onto the canvas.
     * @param {GPUCommandEncoder} encoder
     * @param {GPUPanel[]} gpuPanels — z-sorted visible GPU panels
     * @param {GPUTextureView} canvasView
     */
    compose(encoder, gpuPanels, canvasView) {
        if (!this._initialized) return;
        if (gpuPanels.length === 0) return;

        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: canvasView,
                loadOp: 'load',
                storeOp: 'store',
            }],
        });

        pass.setPipeline(this._blitPipeline);

        for (const panel of gpuPanels) {
            if (!panel.texture || !panel.view) continue;

            const bg = this.device.createBindGroup({
                layout: this._bindGroupLayout,
                entries: [{ binding: 0, resource: panel.view }],
            });

            pass.setBindGroup(0, bg);
            pass.draw(6);
        }

        pass.end();
    }

    /**
     * Hand off GPU device to panels (they need it to allocate textures).
     * @param {GPUPanel[]} panels
     */
    initPanels(panels) {
        panels.forEach(p => {
            if (p.type === 'gpu') {
                p.initGPU(this.device, this.format);
            }
        });
    }

    destroy() {
        this._sampler?.destroy();
        this._blitPipeline = null;
        this._bindGroupLayout = null;
        this._initialized = false;
    }
}
