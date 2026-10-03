// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * MinimapRenderer.js - Top-Down Minimap System
 * 
 * Renders a 2D top-down view of the terrain showing:
 * - Terrain colors based on block types
 * - Player position and direction indicator
 * - Chunk boundaries (optional)
 * - Points of interest markers
 */

import { CHUNK_SIZE } from '../voxel/VoxelConstants.js';
import { MATERIAL } from '../voxel/MaterialSchema.js';
import { byteRgbToHex, hexToRgb as mathHexToRgb } from '../core/math/MathColor.js';

// Material colors for minimap (top-down view)
const MINIMAP_COLORS = {
    [MATERIAL.AIR]: null, // Transparent
    [MATERIAL.STONE]: '#6b6b6b',
    [MATERIAL.DIRT]: '#8b5a2b',
    [MATERIAL.GRASS]: '#4a8f4a',
    [MATERIAL.WATER]: '#4a90d9',
    [MATERIAL.SAND]: '#d4b896',
    [MATERIAL.WOOD]: '#8b4513',
    [MATERIAL.LEAVES]: '#2d5a2d',
    [MATERIAL.SNOW]: '#f0f0f0',
    [MATERIAL.ICE]: '#a0d4e8',
    [MATERIAL.LAVA]: '#ff4500',
    [MATERIAL.GLASS]: '#88ccff44',
    [MATERIAL.BEDROCK]: '#1a1a1a',
    [MATERIAL.CLAY]: '#b87b5e',
    [MATERIAL.GRAVEL]: '#808080',
    [MATERIAL.COAL_ORE]: '#3d3d3d',
    [MATERIAL.IRON_ORE]: '#a08070',
    [MATERIAL.GOLD_ORE]: '#ffd700',
    [MATERIAL.DIAMOND_ORE]: '#00ffff',
    default: '#808080'
};

function parseMinimapHexRgb(hex) {
    const text = String(hex ?? '');
    const canonicalHex = text.startsWith('#') ? text.slice(0, 7) : text.slice(0, 6);
    if (/^#?[a-f\d]{6}$/i.test(canonicalHex)) {
        const [r, g, b] = mathHexToRgb(canonicalHex);
        return {
            r: Math.round(r * 255),
            g: Math.round(g * 255),
            b: Math.round(b * 255)
        };
    }
    return {
        r: parseInt(text.slice(1, 3), 16),
        g: parseInt(text.slice(3, 5), 16),
        b: parseInt(text.slice(5, 7), 16)
    };
}

// Pre-parsed RGB colors for fast ImageData access
const MINIMAP_RGB = {};
for (const [mat, hex] of Object.entries(MINIMAP_COLORS)) {
    if (hex && hex.length >= 7) {
        MINIMAP_RGB[mat] = parseMinimapHexRgb(hex);
    }
}
MINIMAP_RGB.default = { r: 128, g: 128, b: 128 };

export class MinimapRenderer {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.size = 200;
        this.zoom = 1; // Blocks per pixel
        this.viewRadius = 64; // Blocks to show in each direction
        
        // ImageData for fast pixel manipulation (10-100x faster than fillRect)
        this.imageData = null;
        this.pixelData = null;
        
        // Cached chunk heightmaps (material IDs, not colors)
        this.chunkHeightmaps = new Map(); // chunkKey -> Uint8Array of materials
        this.chunkTimestamps = new Map();  // chunkKey -> last modified time
        
        // Player marker
        this.playerColor = '#ff0000';
        this.playerSize = 6;
        
        // Settings
        this.showChunkBorders = false;
        this.showNorth = true;
        this.rotateWithPlayer = false;
        
        this.initialized = false;
    }
    
    /**
     * Initialize the minimap
     * @param {HTMLElement} container - Container element (from UIManager)
     * @param {number} size - Size in pixels
     */
    init(container, size = 200) {
        if (!container) {
            console.warn('[Minimap] No container provided');
            return;
        }
        
        this.size = size;
        this.viewRadius = Math.floor(size / 2);
        
        // Create canvas
        this.canvas = document.createElement('canvas');
        this.canvas.width = size;
        this.canvas.height = size;
        this.canvas.style.cssText = `
            width: 100%;
            height: 100%;
            border-radius: 4px;
        `;
        
        container.innerHTML = '';
        container.appendChild(this.canvas);
        
        this.ctx = this.canvas.getContext('2d');
        this.ctx.imageSmoothingEnabled = false;
        
        // Create ImageData for fast pixel manipulation
        this.imageData = this.ctx.createImageData(size, size);
        this.pixelData = this.imageData.data;
        
        // Fill with background color
        for (let i = 0; i < this.pixelData.length; i += 4) {
            this.pixelData[i] = 26;     // R
            this.pixelData[i + 1] = 26; // G
            this.pixelData[i + 2] = 46; // B
            this.pixelData[i + 3] = 255; // A
        }
        this.ctx.putImageData(this.imageData, 0, 0);
        
        this.initialized = true;
        console.log(`[Minimap] Initialized with ImageData (${size}×${size})`);
    }
    
    /**
     * Update minimap
     * @param {Object} chunkManager - ChunkManager instance
     * @param {Array} playerPos - [x, y, z] player position
     * @param {number} playerYaw - Player yaw rotation
     */
    update(chunkManager, playerPos, playerYaw = 0) {
        if (!this.initialized || !this.ctx || !chunkManager) return;
        
        const ctx = this.ctx;
        const size = this.size;
        const centerX = size / 2;
        const centerY = size / 2;
        
        // Clear canvas
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, size, size);
        
        // Calculate view bounds in world coordinates
        const px = playerPos[0];
        const py = playerPos[1];
        const pz = playerPos[2];
        const viewBlocks = this.viewRadius * this.zoom;
        
        // Draw terrain at player's depth
        this._drawTerrain(ctx, chunkManager, px, py, pz, viewBlocks);
        
        // Draw chunk borders (optional)
        if (this.showChunkBorders) {
            this._drawChunkBorders(ctx, px, pz, viewBlocks);
        }
        
        // Draw north indicator
        if (this.showNorth) {
            ctx.save();
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('N', centerX, 15);
            ctx.restore();
        }
        
        // Draw player marker (always at center)
        this._drawPlayer(ctx, centerX, centerY, playerYaw);
        
        // Draw border
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, size, size);
    }
    
    /**
     * Draw terrain using ImageData with SAMPLING OPTIMIZATION
     * Only samples every Nth pixel to reduce CPU load from O(n²) to O(n²/step²)
     */
    _drawTerrain(ctx, chunkManager, px, py, pz, viewBlocks) {
        const size = this.size;
        const pixelData = this.pixelData;
        const scale = size / (viewBlocks * 2);
        const invScale = 1 / scale;
        
        // OPTIMIZATION: Sample every 4th pixel (16x faster)
        const SAMPLE_STEP = 4;
        
        // Clear to background
        for (let i = 0; i < pixelData.length; i += 4) {
            pixelData[i] = 26;
            pixelData[i + 1] = 26;
            pixelData[i + 2] = 46;
            pixelData[i + 3] = 255;
        }
        
        const playerChunkY = Math.floor(py / CHUNK_SIZE);
        const playerWorldY = Math.floor(py);
        
        // Iterate over sampled pixels only
        const halfSize = size / 2;
        
        for (let screenY = 0; screenY < size; screenY += SAMPLE_STEP) {
            const worldZ = pz + (screenY - halfSize) * invScale;
            const chunkZ = Math.floor(worldZ / CHUNK_SIZE);
            const localZ = Math.floor(worldZ) & 31;
            
            for (let screenX = 0; screenX < size; screenX += SAMPLE_STEP) {
                const worldX = px + (screenX - halfSize) * invScale;
                const chunkX = Math.floor(worldX / CHUNK_SIZE);
                const localX = Math.floor(worldX) & 31;
                
                // Find blocks at this X,Z - scan both up (ceiling) and down (floor)
                let floorMat = 0, ceilMat = 0;
                let floorY = -1000, ceilY = 1000;
                
                // Scan downward for floor
                for (let cy = playerChunkY + 1; cy >= playerChunkY - 2; cy--) {
                    const chunkKey = `${chunkX},${cy},${chunkZ}`;
                    const chunk = chunkManager.chunks?.get(chunkKey);
                    if (!chunk) continue;
                    
                    if (chunk.isHomogeneous) {
                        if (chunk.homogeneousMaterial !== 0) {
                            floorMat = chunk.homogeneousMaterial;
                            floorY = cy * CHUNK_SIZE + CHUNK_SIZE - 1;
                            break;
                        }
                        continue;
                    }
                    
                    const voxels = chunk.voxels;
                    if (!voxels) continue;
                    
                    const chunkBaseY = cy * CHUNK_SIZE;
                    const scanStart = Math.min(playerWorldY + 2, chunkBaseY + CHUNK_SIZE - 1);
                    const startLY = Math.max(0, Math.min(31, scanStart - chunkBaseY));
                    
                    for (let ly = startLY; ly >= 0; ly--) {
                        const idx = localX + ly * CHUNK_SIZE + localZ * CHUNK_SIZE * CHUNK_SIZE;
                        const block = voxels[idx];
                        if (block && block !== 0) {
                            floorMat = block;
                            floorY = chunkBaseY + ly;
                            break;
                        }
                    }
                    if (floorMat !== 0) break;
                }
                
                // Scan upward for ceiling (cave roof detection)
                for (let cy = playerChunkY; cy <= playerChunkY + 2; cy++) {
                    const chunkKey = `${chunkX},${cy},${chunkZ}`;
                    const chunk = chunkManager.chunks?.get(chunkKey);
                    if (!chunk) continue;
                    
                    if (chunk.isHomogeneous) {
                        if (chunk.homogeneousMaterial !== 0) {
                            ceilMat = chunk.homogeneousMaterial;
                            ceilY = cy * CHUNK_SIZE;
                            break;
                        }
                        continue;
                    }
                    
                    const voxels = chunk.voxels;
                    if (!voxels) continue;
                    
                    const chunkBaseY = cy * CHUNK_SIZE;
                    const scanStart = Math.max(playerWorldY + 3, chunkBaseY);
                    const startLY = Math.max(0, Math.min(31, scanStart - chunkBaseY));
                    
                    for (let ly = startLY; ly < CHUNK_SIZE; ly++) {
                        const idx = localX + ly * CHUNK_SIZE + localZ * CHUNK_SIZE * CHUNK_SIZE;
                        const block = voxels[idx];
                        if (block && block !== 0) {
                            ceilMat = block;
                            ceilY = chunkBaseY + ly;
                            break;
                        }
                    }
                    if (ceilMat !== 0) break;
                }
                
                // Determine which to show: ceiling if close (in cave), otherwise floor
                const ceilDist = ceilY - playerWorldY;
                const floorDist = playerWorldY - floorY;
                const inCave = ceilMat !== 0 && ceilDist < 16; // Ceiling within 16 blocks = cave
                
                let material, foundY;
                if (inCave && ceilDist < floorDist) {
                    // Show ceiling (darker, reddish tint for cave roof)
                    material = ceilMat;
                    foundY = ceilY;
                } else {
                    material = floorMat;
                    foundY = floorY;
                }
                
                // Set pixel color - fill SAMPLE_STEP x SAMPLE_STEP block
                if (material !== 0) {
                    const rgb = MINIMAP_RGB[material] || MINIMAP_RGB.default;
                    
                    // Depth shading + cave tint
                    const depthDiff = Math.abs(playerWorldY - foundY);
                    let shade = Math.max(0.3, 1.0 - depthDiff / 32);
                    
                    let r, g, b;
                    if (inCave && foundY > playerWorldY) {
                        // Ceiling - darker with slight red tint
                        r = Math.floor(rgb.r * shade * 0.8 + 30);
                        g = Math.floor(rgb.g * shade * 0.6);
                        b = Math.floor(rgb.b * shade * 0.6);
                    } else {
                        r = Math.floor(rgb.r * shade);
                        g = Math.floor(rgb.g * shade);
                        b = Math.floor(rgb.b * shade);
                    }
                    
                    // Fill SAMPLE_STEP x SAMPLE_STEP block of pixels
                    for (let dy = 0; dy < SAMPLE_STEP && screenY + dy < size; dy++) {
                        for (let dx = 0; dx < SAMPLE_STEP && screenX + dx < size; dx++) {
                            const pixelIdx = ((screenY + dy) * size + (screenX + dx)) * 4;
                            pixelData[pixelIdx] = r;
                            pixelData[pixelIdx + 1] = g;
                            pixelData[pixelIdx + 2] = b;
                        }
                    }
                }
            }
        }
        
        // Put the image data once (single GPU transfer)
        ctx.putImageData(this.imageData, 0, 0);
    }
    
    /**
     * Apply brightness shading to a color
     */
    _shadeColor(color, factor) {
        if (!color || color.length < 7) return color;
        
        const { r, g, b } = parseMinimapHexRgb(color);
        
        const nr = Math.min(255, Math.floor(r * factor));
        const ng = Math.min(255, Math.floor(g * factor));
        const nb = Math.min(255, Math.floor(b * factor));
        
        return byteRgbToHex(nr, ng, nb);
    }
    
    /**
     * Draw chunk borders
     */
    _drawChunkBorders(ctx, px, pz, viewBlocks) {
        const size = this.size;
        const scale = size / (viewBlocks * 2);
        
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        
        const startChunkX = Math.floor((px - viewBlocks) / CHUNK_SIZE);
        const endChunkX = Math.ceil((px + viewBlocks) / CHUNK_SIZE);
        const startChunkZ = Math.floor((pz - viewBlocks) / CHUNK_SIZE);
        const endChunkZ = Math.ceil((pz + viewBlocks) / CHUNK_SIZE);
        
        ctx.beginPath();
        
        // Vertical lines
        for (let cx = startChunkX; cx <= endChunkX; cx++) {
            const worldX = cx * CHUNK_SIZE;
            const screenX = (worldX - px) * scale + size / 2;
            ctx.moveTo(screenX, 0);
            ctx.lineTo(screenX, size);
        }
        
        // Horizontal lines
        for (let cz = startChunkZ; cz <= endChunkZ; cz++) {
            const worldZ = cz * CHUNK_SIZE;
            const screenY = (worldZ - pz) * scale + size / 2;
            ctx.moveTo(0, screenY);
            ctx.lineTo(size, screenY);
        }
        
        ctx.stroke();
    }
    
    /**
     * Draw player marker
     */
    _drawPlayer(ctx, x, y, yaw) {
        const size = this.playerSize;
        
        ctx.save();
        ctx.translate(x, y);
        
        // Rotate based on yaw (yaw=0 is +Z, yaw=PI is -Z)
        // Minimap: +Y is north (-Z in world), so rotate by -yaw + PI
        ctx.rotate(-yaw + Math.PI);
        
        // Draw direction triangle
        ctx.fillStyle = this.playerColor;
        ctx.beginPath();
        ctx.moveTo(0, -size);        // Point (forward)
        ctx.lineTo(-size * 0.6, size * 0.6);  // Back left
        ctx.lineTo(size * 0.6, size * 0.6);   // Back right
        ctx.closePath();
        ctx.fill();
        
        // White border
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1;
        ctx.stroke();
        
        ctx.restore();
    }
    
    /**
     * Clear terrain cache (call when chunks change significantly)
     */
    clearCache() {
        this.chunkHeightmaps.clear();
        this.chunkTimestamps.clear();
    }
    
    /**
     * Invalidate cache for a specific chunk
     */
    invalidateChunk(chunkX, chunkZ) {
        // No-op for now - we sample directly from chunks
    }
    
    /**
     * Resize minimap
     */
    resize(newSize) {
        this.size = newSize;
        this.viewRadius = Math.floor(newSize / 2);
        
        if (this.canvas) {
            this.canvas.width = newSize;
            this.canvas.height = newSize;
        }
    }
    
    /**
     * Load config
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        if (cfg.zoom !== undefined) this.zoom = parseFloat(cfg.zoom) || 1;
        if (cfg.view_radius !== undefined) this.viewRadius = parseInt(cfg.view_radius) || 64;
        if (cfg.show_chunk_borders !== undefined) this.showChunkBorders = cfg.show_chunk_borders === true;
        if (cfg.rotate_with_player !== undefined) this.rotateWithPlayer = cfg.rotate_with_player === true;
    }
}

export default MinimapRenderer;
