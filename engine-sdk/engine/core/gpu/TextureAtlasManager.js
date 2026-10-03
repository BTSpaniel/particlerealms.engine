// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Texture Atlas Manager - Dynamic texture packing for GPU memory optimization
 * Reduces texture bindings and improves cache coherency
 */

import {
    atlasContentRect,
    atlasPaddedExtent,
    atlasUVTransform,
} from '../math/TextureMath.js';

export class TextureAtlasManager {
    constructor(device, options = {}) {
        this.device = device;
        this.atlasSize = options.atlasSize || 4096;
        this.format = options.format || 'rgba8unorm';
        this.mipLevelCount = options.mipLevelCount || 1;
        const padding = Number(options.padding ?? 1);
        this.padding = Number.isFinite(padding) ? Math.max(0, Math.floor(padding)) : 1;
        
        this.atlases = [];
        this.allocations = new Map(); // textureId -> allocation
        this.freeRects = []; // Available rectangles in atlases
        
        this.stats = {
            totalAtlases: 0,
            totalAllocations: 0,
            wastedSpace: 0,
            packingEfficiency: 1.0,
        };
    }

    createAtlas() {
        const texture = this.device.createTexture({
            size: [this.atlasSize, this.atlasSize, 1],
            format: this.format,
            mipLevelCount: this.mipLevelCount,
            usage: GPUTextureUsage.TEXTURE_BINDING | 
                   GPUTextureUsage.COPY_DST | 
                   GPUTextureUsage.RENDER_ATTACHMENT,
            label: `TextureAtlas_${this.atlases.length}`,
        });

        const atlas = {
            texture,
            view: texture.createView(),
            freeRects: [{ x: 0, y: 0, width: this.atlasSize, height: this.atlasSize }],
            usedSpace: 0,
        };

        this.atlases.push(atlas);
        this.stats.totalAtlases++;
        
        return atlas;
    }

    /**
     * Allocate space in atlas for a texture
     * Returns { atlas, x, y, width, height, uvTransform }
     */
    allocate(width, height, textureId) {
        // Pad to avoid bleeding
        const padded = atlasPaddedExtent(width, height, this.padding);
        const paddedWidth = padded.width;
        const paddedHeight = padded.height;

        // Try to find space in existing atlases
        for (const atlas of this.atlases) {
            const rect = this._findBestFit(atlas.freeRects, paddedWidth, paddedHeight);
            if (rect) {
                const allocation = this._allocateRect(atlas, rect, paddedWidth, paddedHeight);
                allocation.textureId = textureId;
                allocation.actualWidth = width;
                allocation.actualHeight = height;
                
                this.allocations.set(textureId, allocation);
                this.stats.totalAllocations++;
                
                return allocation;
            }
        }

        // Create new atlas
        const atlas = this.createAtlas();
        const rect = atlas.freeRects[0];
        const allocation = this._allocateRect(atlas, rect, paddedWidth, paddedHeight);
        allocation.textureId = textureId;
        allocation.actualWidth = width;
        allocation.actualHeight = height;
        
        this.allocations.set(textureId, allocation);
        this.stats.totalAllocations++;
        
        return allocation;
    }

    _findBestFit(freeRects, width, height) {
        let bestRect = null;
        let bestScore = Infinity;

        for (const rect of freeRects) {
            if (rect.width >= width && rect.height >= height) {
                // Score based on wasted space (Best-Fit)
                const wastedSpace = (rect.width - width) * (rect.height - height);
                if (wastedSpace < bestScore) {
                    bestScore = wastedSpace;
                    bestRect = rect;
                }
            }
        }

        return bestRect;
    }

    _allocateRect(atlas, rect, width, height) {
        const content = atlasContentRect(rect.x, rect.y, width - this.padding * 2, height - this.padding * 2, this.padding);
        const allocation = {
            atlas,
            x: content.x,
            y: content.y,
            width,
            height,
            uvTransform: this._calculateUVTransform(content.x, content.y, content.width, content.height),
        };

        // Split remaining space using Guillotine algorithm
        const remainingWidth = rect.width - width;
        const remainingHeight = rect.height - height;

        // Remove used rect
        const index = atlas.freeRects.indexOf(rect);
        atlas.freeRects.splice(index, 1);

        // Add remaining rectangles
        if (remainingWidth > 0) {
            atlas.freeRects.push({
                x: rect.x + width,
                y: rect.y,
                width: remainingWidth,
                height: rect.height,
            });
        }

        if (remainingHeight > 0) {
            atlas.freeRects.push({
                x: rect.x,
                y: rect.y + height,
                width: width,
                height: remainingHeight,
            });
        }

        atlas.usedSpace += width * height;
        this._updateStats();

        return allocation;
    }

    _calculateUVTransform(x, y, width, height) {
        return atlasUVTransform(x, y, width, height, this.atlasSize);
    }

    /**
     * Upload texture data to allocated space
     */
    uploadTexture(commandEncoder, allocation, imageData) {
        commandEncoder.copyExternalImageToTexture(
            { source: imageData },
            { 
                texture: allocation.atlas.texture,
                origin: [allocation.x, allocation.y, 0],
            },
            [allocation.actualWidth, allocation.actualHeight, 1]
        );
    }

    /**
     * Get allocation for a texture ID
     */
    get(textureId) {
        return this.allocations.get(textureId);
    }

    _updateStats() {
        let totalSpace = this.atlases.length * this.atlasSize * this.atlasSize;
        let usedSpace = this.atlases.reduce((sum, atlas) => sum + atlas.usedSpace, 0);
        
        this.stats.wastedSpace = totalSpace - usedSpace;
        this.stats.packingEfficiency = totalSpace > 0 ? usedSpace / totalSpace : 1.0;
    }

    getStats() {
        return {
            ...this.stats,
            atlasSize: this.atlasSize,
            memoryUsed: this.atlases.length * this.atlasSize * this.atlasSize * 4, // RGBA
        };
    }

    destroy() {
        for (const atlas of this.atlases) {
            atlas.texture.destroy();
        }
        this.atlases = [];
        this.allocations.clear();
    }
}
