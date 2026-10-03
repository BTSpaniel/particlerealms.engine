// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * WorldMapGenerator.js - Full World Map Preview Generator
 * 
 * Generates a top-down world map from all loaded chunks, similar to 
 * Minecraft's world maps. Used for save file previews.
 * 
 * Features:
 * - Scans all chunks to build a complete heightmap
 * - Color-codes terrain by material type
 * - Height-based shading for 3D effect
 * - Exports as PNG data URL or blob
 */

import { CHUNK_SIZE } from '../../voxel/VoxelConstants.js';
import { MATERIAL } from '../../voxel/MaterialSchema.js';
import { uniformDistribution } from '../../core/math/MathRandom.js';

// Material colors for world map (matching minimap)
const MAP_COLORS = {
    [MATERIAL.AIR]: null,
    [MATERIAL.STONE]: [107, 107, 107],
    [MATERIAL.DIRT]: [139, 90, 43],
    [MATERIAL.GRASS]: [74, 143, 74],
    [MATERIAL.WATER]: [74, 144, 217],
    [MATERIAL.SAND]: [212, 184, 150],
    [MATERIAL.WOOD]: [139, 69, 19],
    [MATERIAL.LEAVES]: [45, 90, 45],
    [MATERIAL.SNOW]: [240, 240, 240],
    [MATERIAL.ICE]: [160, 212, 232],
    [MATERIAL.LAVA]: [255, 69, 0],
    [MATERIAL.CACTUS]: [60, 120, 60],
    [MATERIAL.DEEPSTONE]: [60, 60, 70],
    [MATERIAL.OBSIDIAN]: [30, 20, 40],
    [MATERIAL.MAGMA]: [180, 60, 20],
    [MATERIAL.CRYSTAL]: [200, 150, 255],
    [MATERIAL.VOIDSTONE]: [20, 10, 30],
    [MATERIAL.FUNGUS]: [180, 100, 160],
    [MATERIAL.MYCELIUM]: [130, 100, 130],
    default: [128, 128, 128]
};

export class WorldMapGenerator {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.imageData = null;
        
        // Map bounds (will be calculated from chunks)
        this.minX = Infinity;
        this.maxX = -Infinity;
        this.minZ = Infinity;
        this.maxZ = -Infinity;
        
        // Preview size
        this.previewWidth = 384;
        this.previewHeight = 216;
    }
    
    /**
     * Generate a world map preview from all chunks
     * @param {Map} chunks - Map of chunk key -> chunk data
     * @param {Object} options - Generation options
     * @returns {Promise<string>} Data URL of the generated map
     */
    async generatePreview(chunks, options = {}) {
        if (!chunks || chunks.size === 0) {
            return this._generatePlaceholder();
        }
        
        console.log(`[WorldMap] Generating preview from ${chunks.size} chunks...`);
        const startTime = performance.now();
        
        // Step 1: Calculate world bounds from chunks
        this._calculateBounds(chunks);
        
        // Step 2: Build the heightmap
        const heightmap = this._buildHeightmap(chunks);
        
        // Step 3: Render to canvas
        const dataUrl = this._renderMap(heightmap, options);
        
        console.log(`[WorldMap] Preview generated in ${(performance.now() - startTime).toFixed(1)}ms`);
        
        return dataUrl;
    }
    
    /**
     * Calculate world bounds from chunks
     */
    _calculateBounds(chunks) {
        this.minX = Infinity;
        this.maxX = -Infinity;
        this.minZ = Infinity;
        this.maxZ = -Infinity;
        
        for (const key of chunks.keys()) {
            const [cx, cy, cz] = key.split(',').map(Number);
            
            const worldMinX = cx * CHUNK_SIZE;
            const worldMaxX = worldMinX + CHUNK_SIZE;
            const worldMinZ = cz * CHUNK_SIZE;
            const worldMaxZ = worldMinZ + CHUNK_SIZE;
            
            this.minX = Math.min(this.minX, worldMinX);
            this.maxX = Math.max(this.maxX, worldMaxX);
            this.minZ = Math.min(this.minZ, worldMinZ);
            this.maxZ = Math.max(this.maxZ, worldMaxZ);
        }
        
        // Add padding
        const padding = CHUNK_SIZE;
        this.minX -= padding;
        this.maxX += padding;
        this.minZ -= padding;
        this.maxZ += padding;
    }
    
    /**
     * Build a heightmap from all chunks
     * Returns a Map of "x,z" -> { material, height }
     */
    _buildHeightmap(chunks) {
        const heightmap = new Map();
        
        // Group chunks by X,Z columns for efficient processing
        const columnChunks = new Map(); // "cx,cz" -> [chunks sorted by Y desc]
        
        for (const [key, chunk] of chunks) {
            const [cx, cy, cz] = key.split(',').map(Number);
            const colKey = `${cx},${cz}`;
            
            if (!columnChunks.has(colKey)) {
                columnChunks.set(colKey, []);
            }
            columnChunks.get(colKey).push({ cy, chunk });
        }
        
        // Sort each column by Y descending (top to bottom)
        for (const [colKey, chunkList] of columnChunks) {
            chunkList.sort((a, b) => b.cy - a.cy);
            
            const [cx, cz] = colKey.split(',').map(Number);
            const worldBaseX = cx * CHUNK_SIZE;
            const worldBaseZ = cz * CHUNK_SIZE;
            
            // For each X,Z position in this column, find the top block
            for (let lx = 0; lx < CHUNK_SIZE; lx++) {
                for (let lz = 0; lz < CHUNK_SIZE; lz++) {
                    const worldX = worldBaseX + lx;
                    const worldZ = worldBaseZ + lz;
                    const mapKey = `${worldX},${worldZ}`;
                    
                    // Skip if already found
                    if (heightmap.has(mapKey)) continue;
                    
                    // Scan from top chunk down
                    for (const { cy, chunk } of chunkList) {
                        const result = this._findTopBlock(chunk, lx, lz, cy);
                        if (result) {
                            heightmap.set(mapKey, result);
                            break;
                        }
                    }
                }
            }
        }
        
        return heightmap;
    }
    
    /**
     * Find the top solid block in a chunk column
     */
    _findTopBlock(chunk, lx, lz, chunkY) {
        // Handle homogeneous chunks
        if (chunk.isHomogeneous) {
            if (chunk.homogeneousMaterial && chunk.homogeneousMaterial !== MATERIAL.AIR) {
                return {
                    material: chunk.homogeneousMaterial,
                    height: chunkY * CHUNK_SIZE + CHUNK_SIZE - 1
                };
            }
            return null;
        }
        
        // Regular chunk
        const voxels = chunk.voxels;
        if (!voxels) return null;
        
        // Scan from top to bottom
        for (let ly = CHUNK_SIZE - 1; ly >= 0; ly--) {
            const idx = lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE;
            const block = voxels[idx];
            
            if (block && block !== MATERIAL.AIR) {
                return {
                    material: block,
                    height: chunkY * CHUNK_SIZE + ly
                };
            }
        }
        
        return null;
    }
    
    /**
     * Render the heightmap to a canvas
     */
    _renderMap(heightmap, options = {}) {
        const width = options.width || this.previewWidth;
        const height = options.height || this.previewHeight;
        
        // Create canvas
        this.canvas = document.createElement('canvas');
        this.canvas.width = width;
        this.canvas.height = height;
        this.ctx = this.canvas.getContext('2d');
        
        // Calculate scale to fit world in preview
        const worldWidth = this.maxX - this.minX;
        const worldHeight = this.maxZ - this.minZ;
        
        // Maintain aspect ratio
        const scaleX = width / worldWidth;
        const scaleZ = height / worldHeight;
        const scale = Math.min(scaleX, scaleZ);
        
        // Center offset
        const offsetX = (width - worldWidth * scale) / 2;
        const offsetZ = (height - worldHeight * scale) / 2;
        
        // Fill background with dark color
        this.ctx.fillStyle = '#0a0a14';
        this.ctx.fillRect(0, 0, width, height);
        
        // Draw each heightmap entry
        const imageData = this.ctx.createImageData(width, height);
        const data = imageData.data;
        
        // Find height range for shading
        let minHeight = Infinity;
        let maxHeight = -Infinity;
        for (const { height: h } of heightmap.values()) {
            minHeight = Math.min(minHeight, h);
            maxHeight = Math.max(maxHeight, h);
        }
        const heightRange = Math.max(1, maxHeight - minHeight);
        
        // Render each pixel
        for (const [key, { material, height: blockHeight }] of heightmap) {
            const [worldX, worldZ] = key.split(',').map(Number);
            
            // Convert to screen coordinates
            const screenX = Math.floor((worldX - this.minX) * scale + offsetX);
            const screenZ = Math.floor((worldZ - this.minZ) * scale + offsetZ);
            
            if (screenX < 0 || screenX >= width || screenZ < 0 || screenZ >= height) {
                continue;
            }
            
            // Get color for material
            const baseColor = MAP_COLORS[material] || MAP_COLORS.default;
            if (!baseColor) continue;
            
            // Height-based shading (higher = brighter)
            const heightFactor = (blockHeight - minHeight) / heightRange;
            const shade = 0.5 + heightFactor * 0.5;
            
            // Apply shading
            const r = Math.min(255, Math.floor(baseColor[0] * shade));
            const g = Math.min(255, Math.floor(baseColor[1] * shade));
            const b = Math.min(255, Math.floor(baseColor[2] * shade));
            
            // Set pixel (may cover multiple pixels if scale > 1)
            const pixelSize = Math.max(1, Math.ceil(scale));
            for (let py = 0; py < pixelSize; py++) {
                for (let px = 0; px < pixelSize; px++) {
                    const finalX = screenX + px;
                    const finalZ = screenZ + py;
                    if (finalX >= 0 && finalX < width && finalZ >= 0 && finalZ < height) {
                        const idx = (finalZ * width + finalX) * 4;
                        data[idx] = r;
                        data[idx + 1] = g;
                        data[idx + 2] = b;
                        data[idx + 3] = 255;
                    }
                }
            }
        }
        
        this.ctx.putImageData(imageData, 0, 0);
        
        // Add subtle vignette
        this._addVignette(width, height);
        
        // Add grid overlay (optional)
        if (options.showGrid) {
            this._addGrid(scale, offsetX, offsetZ);
        }
        
        return this.canvas.toDataURL('image/png');
    }
    
    /**
     * Add vignette effect
     */
    _addVignette(width, height) {
        const gradient = this.ctx.createRadialGradient(
            width / 2, height / 2, Math.min(width, height) * 0.3,
            width / 2, height / 2, Math.max(width, height) * 0.7
        );
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(1, 'rgba(0,0,0,0.4)');
        
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, width, height);
    }
    
    /**
     * Add chunk grid overlay
     */
    _addGrid(scale, offsetX, offsetZ) {
        this.ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        this.ctx.lineWidth = 1;
        
        const chunkScale = CHUNK_SIZE * scale;
        
        // Vertical lines
        for (let x = this.minX; x <= this.maxX; x += CHUNK_SIZE) {
            const screenX = (x - this.minX) * scale + offsetX;
            this.ctx.beginPath();
            this.ctx.moveTo(screenX, 0);
            this.ctx.lineTo(screenX, this.canvas.height);
            this.ctx.stroke();
        }
        
        // Horizontal lines
        for (let z = this.minZ; z <= this.maxZ; z += CHUNK_SIZE) {
            const screenZ = (z - this.minZ) * scale + offsetZ;
            this.ctx.beginPath();
            this.ctx.moveTo(0, screenZ);
            this.ctx.lineTo(this.canvas.width, screenZ);
            this.ctx.stroke();
        }
    }
    
    /**
     * Generate placeholder when no chunks available
     */
    _generatePlaceholder() {
        const width = this.previewWidth;
        const height = this.previewHeight;
        
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        
        // Dark background with gradient
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, '#0a0a14');
        gradient.addColorStop(0.5, '#12121a');
        gradient.addColorStop(1, '#0a0a14');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        
        // Add some fake terrain hints
        ctx.fillStyle = 'rgba(74, 143, 74, 0.2)';
        for (let i = 0; i < 20; i++) {
            const x = uniformDistribution(0, width, Math.random);
            const y = uniformDistribution(0, height, Math.random);
            const size = uniformDistribution(20, 60, Math.random);
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Add text
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '14px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No preview available', width / 2, height / 2);
        
        return canvas.toDataURL('image/png');
    }
    
    /**
     * Generate preview and return as Blob for storage
     */
    async generatePreviewBlob(chunks, options = {}) {
        const dataUrl = await this.generatePreview(chunks, options);
        
        // Convert data URL to blob
        const response = await fetch(dataUrl);
        return await response.blob();
    }
}

export default WorldMapGenerator;
