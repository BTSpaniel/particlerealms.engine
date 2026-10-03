// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PlaunaParticleBridge - Connects Plauna to Particle Engine's VGPU
 * Follows existing VGPU patterns from ViewportPanel
 */

export class PlaunaGPUBridge {
    constructor(options = {}) {
        this.getVGPU = options.getVGPU;
        this.engine = options.engine || window.ParticleEngine;
        this.uiWorld = options.uiWorld;
        this.textService = options.textService;
        
        // GPU resources
        this.vgpu = null;
        this.surfaceResources = new Map();
        this.fontAtlases = new Map();
        this.glyphQuads = new Map();
        
        this.initialized = false;
    }

    async initialize() {
        console.log('[Plauna] Initializing GPU bridge...');
        
        // Get VGPU instance (same pattern as ViewportPanel)
        this.vgpu = this.getVGPU();
        
        if (!this.vgpu) {
            throw new Error('VGPU required for Plauna GPU features');
        }

        console.log('[Plauna] GPU bridge initialized with VGPU');
        this.initialized = true;
    }

    // =============================================================================
    // SURFACE RESOURCE MANAGEMENT
    // =============================================================================

    createSurfaceResources(surface) {
        if (!this.initialized) {
            throw new Error('GPU bridge not initialized');
        }

        const resources = {
            texture: null,
            buffer: null,
            bindGroup: null,
            sampler: null
        };

        // Create texture for surface
        if (surface.kind === 'viewport') {
            // Create texture for viewport rendering
            resources.texture = this.vgpu.texture.create({
                size: [512, 512],
                format: 'bgra8unorm',
                usage: ['texture_binding', 'render_attachment', 'copy_dst']
            });
        } else {
            // Create generic texture
            resources.texture = this.vgpu.texture.create({
                size: [512, 512],
                format: 'bgra8unorm',
                usage: ['texture_binding', 'copy_dst']
            });
        }

        // Create vertex buffer for quad rendering
        const vertices = new Float32Array([
            // Position (x, y)    UV (u, v)
            -1.0, -1.0,          0.0, 1.0,  // Bottom left
             1.0, -1.0,          1.0, 1.0,  // Bottom right
            -1.0,  1.0,          0.0, 0.0,  // Top left
             1.0,  1.0,          1.0, 0.0   // Top right
        ]);

        resources.buffer = this.vgpu.buffer.create({
            size: vertices.byteLength,
            usage: 'vertex',
            data: vertices
        });

        // Create sampler
        resources.sampler = this.vgpu.sampler.create({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp',
            addressModeV: 'clamp'
        });

        // Store resources
        this.surfaceResources.set(surface.id, resources);
        
        console.log(`[Plauna] Created surface resources for: ${surface.id}`);
        return resources;
    }

    updateSurfaceResources(surface) {
        const resources = this.surfaceResources.get(surface.id);
        if (!resources) {
            return this.createSurfaceResources(surface);
        }

        // Update resources based on surface changes
        // TODO: Implement resource updates
        return resources;
    }

    destroySurfaceResources(surface) {
        const resources = this.surfaceResources.get(surface.id);
        if (!resources) {
            return;
        }

        // Destroy GPU resources
        if (resources.texture) {
            resources.texture.destroy();
        }
        if (resources.buffer) {
            resources.buffer.destroy();
        }
        if (resources.sampler) {
            resources.sampler.destroy();
        }
        if (resources.bindGroup) {
            resources.bindGroup.destroy();
        }

        this.surfaceResources.delete(surface.id);
        console.log(`[Plauna] Destroyed surface resources for: ${surface.id}`);
    }

    // =============================================================================
    // FONT ATLAS MANAGEMENT
    // =============================================================================

    createFontAtlas(fontSpec) {
        const key = this.getFontAtlasKey(fontSpec);
        
        if (this.fontAtlases.has(key)) {
            return this.fontAtlases.get(key);
        }

        // Create font atlas texture
        const atlasSize = [1024, 1024];
        const atlas = this.vgpu.texture.create({
            size: atlasSize,
            format: 'r8unorm',
            usage: ['texture_binding', 'copy_dst']
        });

        const fontAtlas = {
            texture: atlas,
            size: atlasSize,
            fontSpec,
            glyphs: new Map(),
            cursor: { x: 0, y: 0, rowHeight: 0 }
        };

        this.fontAtlases.set(key, fontAtlas);
        console.log(`[Plauna] Created font atlas: ${key}`);
        
        return fontAtlas;
    }

    getFontAtlasKey(fontSpec) {
        return `${fontSpec.family}-${fontSpec.weight}-${fontSpec.size}`;
    }

    // =============================================================================
    // GLYPH QUAD GENERATION
    // =============================================================================

    buildGlyphQuads() {
        if (!this.initialized || !this.textService) {
            return null;
        }

        const glyphQuadBuilder = {
            glyphs: [],
            buffer: null,
            dirty: true
        };

        // Create vertex buffer for glyph quads
        glyphQuadBuilder.buffer = this.vgpu.buffer.create({
            size: 1024 * 1024, // 1MB buffer for glyph quads
            usage: ['vertex', 'storage', 'copy_dst']
        });

        this.glyphQuads.set('default', glyphQuadBuilder);
        return glyphQuadBuilder;
    }

    updateGlyphQuads(textLayout, position, style) {
        const glyphQuadBuilder = this.glyphQuads.get('default');
        if (!glyphQuadBuilder) {
            return;
        }

        // Generate quad vertices for each glyph
        const vertices = [];
        let x = position.x;
        let y = position.y;

        for (const line of textLayout.lines) {
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                const glyph = this.getGlyphMetrics(char, style);
                
                if (glyph) {
                    // Create quad for this glyph
                    const quad = this.createGlyphQuad(x, y, glyph);
                    vertices.push(...quad);
                }
                
                x += glyph.advance || style.fontSize * 0.6;
            }
            
            x = position.x;
            y += style.lineHeight;
        }

        // Update buffer
        if (vertices.length > 0) {
            const vertexData = new Float32Array(vertices);
            this.vgpu.queue.writeBuffer(glyphQuadBuilder.buffer.gpuBuffer, 0, vertexData);
        }

        glyphQuadBuilder.dirty = false;
    }

    getGlyphMetrics(char, style) {
        // Simple glyph metrics - should be replaced with proper font loading
        return {
            width: style.fontSize * 0.6,
            height: style.fontSize,
            advance: style.fontSize * 0.6,
            bearing: { x: 0, y: style.fontSize * 0.8 }
        };
    }

    createGlyphQuad(x, y, glyph) {
        const x0 = x + glyph.bearing.x;
        const y0 = y - glyph.bearing.y;
        const x1 = x0 + glyph.width;
        const y1 = y0 + glyph.height;

        // Return quad vertices (x, y, u, v)
        return [
            x0, y0, 0.0, 0.0,  // Top left
            x1, y0, 1.0, 0.0,  // Top right
            x0, y1, 0.0, 1.0,  // Bottom left
            x1, y1, 1.0, 1.0   // Bottom right
        ];
    }

    // =============================================================================
    // UI PASS RENDERING
    // =============================================================================

    renderUIPass(frameCtx) {
        if (!this.initialized) {
            return;
        }

        // Create UI pass encoder
        const passEncoder = frameCtx.commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: frameCtx.context.getCurrentTexture().createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: 'load',
                storeOp: 'store'
            }]
        });

        // Render surfaces
        this.renderSurfaces(passEncoder);

        // Render text
        this.renderText(passEncoder);

        passEncoder.end();
    }

    renderSurfaces(passEncoder) {
        // Render all registered surfaces
        for (const [surfaceId, resources] of this.surfaceResources) {
            if (resources.texture) {
                // TODO: Implement surface rendering
                // This would bind the surface texture and render a quad
            }
        }
    }

    renderText(passEncoder) {
        // Render glyph quads
        for (const [key, glyphQuadBuilder] of this.glyphQuads) {
            if (glyphQuadBuilder.buffer && !glyphQuadBuilder.dirty) {
                // TODO: Implement text rendering
                // This would bind the glyph buffer and render all quads
            }
        }
    }

    // =============================================================================
    // PROJECTION AND COORDINATES
    // =============================================================================

    projectWorldAnchor(anchorEntity) {
        if (!this.uiWorld || !this.engine) {
            return null;
        }

        // Get anchor component from entity
        const anchor = this.engine.getEntityComponent(this.uiWorld, anchorEntity, 'UIAnchor');
        if (!anchor) {
            return null;
        }

        // Project world position to screen space
        // TODO: Implement world-to-screen projection
        return {
            x: 0,
            y: 0,
            visible: true
        };
    }

    // =============================================================================
    // CLEANUP
    // =============================================================================

    destroy() {
        console.log('[Plauna] Destroying GPU bridge...');
        
        // Destroy all surface resources
        for (const [surfaceId, resources] of this.surfaceResources) {
            this.destroySurfaceResources({ id: surfaceId });
        }
        this.surfaceResources.clear();

        // Destroy font atlases
        for (const [key, atlas] of this.fontAtlases) {
            atlas.texture.destroy();
        }
        this.fontAtlases.clear();

        // Destroy glyph quad buffers
        for (const [key, glyphQuads] of this.glyphQuads) {
            if (glyphQuads.buffer) {
                glyphQuads.buffer.destroy();
            }
        }
        this.glyphQuads.clear();

        this.initialized = false;
    }
}
