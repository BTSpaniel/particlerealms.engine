// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * FluidSimulation.js - Cellular Automata Fluid Dynamics
 * 
 * Implements Noita-style falling sand simulation:
 * - Materials have physical properties (density, viscosity, flammability)
 * - Bottom-up update order for proper gravity cascading
 * - Dirty rectangle optimization (only update active regions)
 * - Checkerboard pattern for batch processing
 * 
 * Material behaviors:
 * - Powder (sand): Falls down, slides diagonally
 * - Liquid (water): Falls, spreads horizontally
 * - Gas (steam): Rises up, spreads horizontally
 * - Fire: Spreads to flammable neighbors, converts water to steam
 */

import { MATERIAL } from '../../voxel/MaterialSchema.js';
import { CHUNK_SIZE, CHUNK_SIZE_SQ, CHUNK_VOLUME } from '../../voxel/VoxelConstants.js';
import { statsMean } from '../../core/math/MathStatistics.js';

// ============================================================================
// MATERIAL PROPERTIES
// ============================================================================

/**
 * Physical properties for each material type
 * Properties:
 * - type: 'solid' | 'powder' | 'liquid' | 'gas' | 'fire'
 * - density: Higher density sinks below lower density (0-100)
 * - viscosity: How slowly liquid spreads (0=instant, 1=very slow)
 * - flammable: Can catch fire
 * - burnTime: Ticks until destroyed by fire
 * - spreadRate: How many cells to check for spreading (liquids/gases)
 */
export const MATERIAL_PROPERTIES = {
    [MATERIAL.AIR]: {
        type: 'gas',
        density: 0,
        viscosity: 0,
        flammable: false,
    },
    [MATERIAL.STONE]: {
        type: 'solid',
        density: 100,
        flammable: false,
    },
    [MATERIAL.DIRT]: {
        type: 'solid',
        density: 80,
        flammable: false,
    },
    [MATERIAL.GRASS]: {
        type: 'solid',
        density: 75,
        flammable: true,
        burnTime: 30,
    },
    [MATERIAL.SAND]: {
        type: 'powder',
        density: 70,
        viscosity: 0.2,
        flammable: false,
    },
    [MATERIAL.WATER]: {
        type: 'liquid',
        density: 50,
        viscosity: 0,      // No viscosity - flows freely
        spreadRate: 5,     // Spreads further per tick
        flammable: false,
        evaporates: true,  // Turns to steam when heated
    },
    [MATERIAL.WOOD]: {
        type: 'solid',
        density: 60,
        flammable: true,
        burnTime: 120,
    },
    [MATERIAL.METAL]: {
        type: 'solid',
        density: 95,
        flammable: false,
    },
    [MATERIAL.ENERGY]: {
        type: 'fire',
        density: 5,
        spreadChance: 0.3,
        lifetime: 60,
    },
    [MATERIAL.DEEPSTONE]: {
        type: 'solid',
        density: 100,
        flammable: false,
    },
    [MATERIAL.OBSIDIAN]: {
        type: 'solid',
        density: 100,
        flammable: false,
    },
    [MATERIAL.MAGMA]: {
        type: 'liquid',
        density: 90,
        viscosity: 0.8,  // Very viscous
        spreadRate: 1,
        flammable: false,
        heats: true,  // Sets things on fire
        emitsLight: true,
    },
    [MATERIAL.CRYSTAL]: {
        type: 'solid',
        density: 85,
        flammable: false,
    },
    [MATERIAL.VOIDSTONE]: {
        type: 'solid',
        density: 100,
        flammable: false,
    },
    [MATERIAL.FUNGUS]: {
        type: 'solid',
        density: 40,
        flammable: true,
        burnTime: 45,
    },
    [MATERIAL.MYCELIUM]: {
        type: 'solid',
        density: 50,
        flammable: true,
        burnTime: 60,
    },
    [MATERIAL.STEAM]: {
        type: 'gas',
        density: 2,
        viscosity: 0,
        flammable: false,
        lifetime: 300,  // Dissipates after ~5 seconds
    },
    [MATERIAL.OIL]: {
        type: 'liquid',
        density: 40,  // Floats on water
        viscosity: 0.3,
        spreadRate: 3,
        flammable: true,
        burnTime: 180,
    },
    [MATERIAL.ACID]: {
        type: 'liquid',
        density: 55,
        viscosity: 0.2,
        spreadRate: 2,
        flammable: false,
        corrodes: true,  // Dissolves materials
        corrosionChance: 0.05,
    },
    [MATERIAL.GRAVEL]: {
        type: 'powder',
        density: 75,
        viscosity: 0.3,
        flammable: false,
    },
};

// Add default properties for any undefined materials
for (let i = 0; i < 256; i++) {
    if (!MATERIAL_PROPERTIES[i]) {
        MATERIAL_PROPERTIES[i] = {
            type: 'solid',
            density: 100,
            flammable: false,
        };
    }
}

// ============================================================================
// FLUID SIMULATION STATE
// ============================================================================

/**
 * Per-voxel simulation metadata
 * Stored separately from material ID to avoid expanding chunks
 */
export class FluidMetadata {
    constructor() {
        // Map of chunk keys to metadata arrays
        // Each array: Uint8Array storing per-voxel flags
        // Bits: 0-3 = velocity/flow direction, 4 = updated this frame, 5-7 = fire lifetime
        this.chunkMeta = new Map();
        
        // Active fluid voxels that need updating
        // Set of "chunkKey:localIndex" strings for O(1) lookup
        this.activeVoxels = new Set();
        
        // Dirty rectangles per chunk (min/max bounds of active region)
        // Map of chunkKey -> { minX, minY, minZ, maxX, maxY, maxZ }
        this.dirtyRects = new Map();
        
        // Current simulation frame (for double-update prevention)
        this.frame = 0;
    }
    
    /**
     * Mark a voxel as active (needs simulation)
     */
    markActive(chunkKey, lx, ly, lz) {
        const idx = lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE_SQ;
        this.activeVoxels.add(`${chunkKey}:${idx}`);
        
        // Update dirty rectangle
        let rect = this.dirtyRects.get(chunkKey);
        if (!rect) {
            rect = {
                minX: lx, maxX: lx,
                minY: ly, maxY: ly,
                minZ: lz, maxZ: lz,
            };
            this.dirtyRects.set(chunkKey, rect);
        } else {
            rect.minX = Math.min(rect.minX, lx);
            rect.maxX = Math.max(rect.maxX, lx);
            rect.minY = Math.min(rect.minY, ly);
            rect.maxY = Math.max(rect.maxY, ly);
            rect.minZ = Math.min(rect.minZ, lz);
            rect.maxZ = Math.max(rect.maxZ, lz);
        }
    }
    
    /**
     * Check if a voxel was updated this frame
     */
    wasUpdated(chunkKey, lx, ly, lz) {
        const meta = this.chunkMeta.get(chunkKey);
        if (!meta) return false;
        const idx = lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE_SQ;
        return (meta[idx] & 0x10) !== 0;  // Bit 4 = updated flag
    }
    
    /**
     * Mark voxel as updated this frame
     */
    setUpdated(chunkKey, lx, ly, lz) {
        let meta = this.chunkMeta.get(chunkKey);
        if (!meta) {
            meta = new Uint8Array(CHUNK_VOLUME);
            this.chunkMeta.set(chunkKey, meta);
        }
        const idx = lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE_SQ;
        meta[idx] |= 0x10;
    }
    
    /**
     * Clear all update flags for new frame
     */
    newFrame() {
        this.frame++;
        // Clear update flags
        for (const [key, meta] of this.chunkMeta) {
            for (let i = 0; i < meta.length; i++) {
                meta[i] &= ~0x10;  // Clear bit 4
            }
        }
    }
    
    /**
     * Clear dirty rectangles after processing
     */
    clearDirtyRects() {
        this.dirtyRects.clear();
    }
}

// ============================================================================
// FLUID SIMULATION ENGINE
// ============================================================================

export class FluidSimulator {
    constructor(chunkManager) {
        this.chunkManager = chunkManager;
        this.metadata = new FluidMetadata();
        
        // Simulation settings
        this.enabled = true;
        this.updateCount = 0;
        
        // Performance settings - MAXIMUM SPEED
        this.targetFPS = 30;              // Target FPS floor (for stats only)
        this.minBudgetMs = 100;           // Always use at least 100ms
        this.maxBudgetMs = 1000;          // 1 second max (effectively unlimited)
        this.currentBudgetMs = 1000;      // Process everything
        this.maxUpdatesPerFrame = 10000000; // 10 million updates per frame
        
        // FPS tracking for adaptation
        this.frameTimeHistory = [];       // Last N frame times
        this.historySize = 30;            // Frames to average
        this.lastAdaptTime = 0;           // Last time we adjusted budget
        this.adaptInterval = 500;         // Adjust every 500ms
        
        // Try to detect refresh rate
        this.detectRefreshRate();
        
        // Statistics
        this.stats = {
            activeVoxels: 0,
            updatesThisFrame: 0,
            dirtyChunks: 0,
            budgetMs: 2,
            avgFPS: 60,
        };
        
        // Seeded random for determinism (coordinate-based)
        this.seed = 12345;
    }
    
    /**
     * Detect monitor refresh rate and set target
     */
    detectRefreshRate() {
        // Keep at 20 FPS for fluid sim regardless of monitor refresh rate
        // Reduced from 30 to 20 to lower CPU usage (was taking 3.2ms/frame)
        this.targetFPS = 20;
        console.log(`[Fluid] Target FPS: ${this.targetFPS}`);
    }
    
    /**
     * Set target FPS manually (e.g., from user settings)
     */
    setTargetFPS(fps) {
        this.targetFPS = Math.max(15, Math.min(240, fps));
        console.log(`[Fluid] Target FPS set to: ${this.targetFPS}`);
    }
    
    /**
     * Auto-detect refresh rate from actual frame times
     * Call this after a few frames to refine the target
     */
    autoDetectRefreshRate() {
        if (this.frameTimeHistory.length >= 20) {
            const avgFrameTime = statsMean(this.frameTimeHistory);
            const detectedFPS = Math.round(1000 / avgFrameTime);
            
            // Round to common refresh rates
            const commonRates = [60, 75, 90, 120, 144, 165, 240];
            let closest = 60;
            let minDiff = Infinity;
            for (const rate of commonRates) {
                const diff = Math.abs(detectedFPS - rate);
                if (diff < minDiff) {
                    minDiff = diff;
                    closest = rate;
                }
            }
            
            // Keep targetFPS at 30 for fluid sim (don't auto-adjust to monitor rate)
            // Just log what we detected for debugging
            if (minDiff < 10) {
                console.log(`[Fluid] Monitor refresh: ${closest}Hz (fluid stays at ${this.targetFPS} FPS)`);
            }
        }
    }
    
    /**
     * Update FPS tracking and adapt budget
     */
    adaptPerformance(frameTime) {
        // Add to history
        this.frameTimeHistory.push(frameTime);
        if (this.frameTimeHistory.length > this.historySize) {
            this.frameTimeHistory.shift();
        }
        
        // Calculate average FPS
        if (this.frameTimeHistory.length >= 10) {
            const avgFrameTime = statsMean(this.frameTimeHistory);
            const avgFPS = 1000 / avgFrameTime;
            this.stats.avgFPS = Math.round(avgFPS);
            
            // Auto-detect refresh rate periodically (first 5 seconds)
            if (this.metadata.frame < 300 && this.metadata.frame % 60 === 0) {
                this.autoDetectRefreshRate();
            }
            
            // Adapt every interval
            const now = performance.now();
            if (now - this.lastAdaptTime > this.adaptInterval) {
                this.lastAdaptTime = now;
                
                const targetFrameTime = 1000 / this.targetFPS;
                const headroom = targetFrameTime - avgFrameTime;  // Positive = we have spare time
                
                // MAXIMUM SPEED MODE - always use full budget
                // Budget stays at 1000ms - process all active voxels every frame
                
                this.stats.budgetMs = 'MAX';
            }
        }
    }
    
    /**
     * Deterministic random based on position and frame
     * Ensures same behavior on all clients for multiplayer
     */
    random(x, y, z) {
        // Simple hash function
        let h = this.seed;
        h = ((h << 5) - h + x) | 0;
        h = ((h << 5) - h + y) | 0;
        h = ((h << 5) - h + z) | 0;
        h = ((h << 5) - h + this.metadata.frame) | 0;
        return (h & 0x7FFFFFFF) / 0x7FFFFFFF;
    }
    
    /**
     * Mark a voxel position as needing fluid simulation
     * Only activates actual fluid materials (liquid, powder, gas, fire)
     */
    activateVoxel(wx, wy, wz) {
        // Hard cap on active voxels to prevent runaway
        if (this.metadata.activeVoxels.size >= 50000) return;
        
        // First check if it's actually a fluid material
        const material = this.chunkManager.getVoxel(wx, wy, wz);
        const props = MATERIAL_PROPERTIES[material];
        
        // Only activate fluid types, not solids!
        if (props.type !== 'liquid' && props.type !== 'powder' && 
            props.type !== 'gas' && props.type !== 'fire') {
            return;
        }
        
        const chunk = this.chunkManager.getChunkAt(wx, wy, wz);
        if (!chunk) return;
        
        const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        
        this.metadata.markActive(chunk.key, lx, ly, lz);
    }
    
    /**
     * Activate fluid materials in a chunk that are at the surface (adjacent to air)
     * Only surface fluids need simulation - buried fluids are stable
     */
    activateChunkFluids(chunk) {
        if (!chunk || chunk.isHomogeneous) return;
        
        // Hard cap - don't add more if we're already at limit
        if (this.metadata.activeVoxels.size >= 50000) return;
        
        const [ox, oy, oz] = chunk.getWorldOrigin();
        let added = 0;
        const maxPerChunk = 500;  // Limit per chunk to spread activation
        
        for (let lz = 0; lz < CHUNK_SIZE && added < maxPerChunk; lz++) {
            for (let ly = 0; ly < CHUNK_SIZE && added < maxPerChunk; ly++) {
                for (let lx = 0; lx < CHUNK_SIZE && added < maxPerChunk; lx++) {
                    if (this.metadata.activeVoxels.size >= 50000) return;
                    
                    const material = chunk.get(lx, ly, lz);
                    const props = MATERIAL_PROPERTIES[material];
                    
                    if (props.type === 'liquid' || props.type === 'powder' || 
                        props.type === 'gas' || props.type === 'fire') {
                        
                        // Only activate if has air BELOW (can fall) - most important case
                        const wx = ox + lx;
                        const wy = oy + ly;
                        const wz = oz + lz;
                        
                        const canFall = this.chunkManager.getVoxel(wx, wy - 1, wz) === MATERIAL.AIR;
                        
                        if (canFall) {
                            this.metadata.markActive(chunk.key, lx, ly, lz);
                            added++;
                        }
                    }
                }
            }
        }
    }
    
    /**
     * Rebuild dirty rectangles from active voxels (limited for performance)
     * Rotates through active voxels to ensure all get processed eventually
     */
    rebuildDirtyRectsLimited(maxVoxels = 1000) {
        this.metadata.dirtyRects.clear();
        
        // Convert Set to Array for indexed access (only when needed)
        const activeArray = Array.from(this.metadata.activeVoxels);
        const total = activeArray.length;
        
        if (total === 0) return;
        
        // Rotate starting point each frame for fairness
        this.processOffset = (this.processOffset || 0) % total;
        
        let count = 0;
        for (let i = 0; i < total && count < maxVoxels; i++) {
            const idx = (this.processOffset + i) % total;
            const key = activeArray[idx];
            count++;
            
            const [chunkKey, idxStr] = key.split(':');
            const voxelIdx = parseInt(idxStr);
            
            // Convert index back to local coordinates
            const lx = voxelIdx % CHUNK_SIZE;
            const ly = Math.floor(voxelIdx / CHUNK_SIZE) % CHUNK_SIZE;
            const lz = Math.floor(voxelIdx / CHUNK_SIZE_SQ);
            
            // Update dirty rect for this chunk
            let rect = this.metadata.dirtyRects.get(chunkKey);
            if (!rect) {
                rect = {
                    minX: lx, maxX: lx,
                    minY: ly, maxY: ly,
                    minZ: lz, maxZ: lz,
                };
                this.metadata.dirtyRects.set(chunkKey, rect);
            } else {
                rect.minX = Math.min(rect.minX, lx);
                rect.maxX = Math.max(rect.maxX, lx);
                rect.minY = Math.min(rect.minY, ly);
                rect.maxY = Math.max(rect.maxY, ly);
                rect.minZ = Math.min(rect.minZ, lz);
                rect.maxZ = Math.max(rect.maxZ, lz);
            }
        }
        
        // Move offset for next frame
        this.processOffset = (this.processOffset + maxVoxels) % Math.max(1, total);
    }
    
    /**
     * Main simulation tick - call once per frame
     * @param {number} dt - Delta time in seconds
     * @param {number} frameTime - Total frame time in ms (for adaptive performance)
     * @param {Array} cameraPos - Camera position [x, y, z] for distance-based updates
     */
    simulate(dt, frameTime = 16, cameraPos = null) {
        if (!this.enabled) return;
        
        // Adapt performance based on FPS
        this.adaptPerformance(frameTime);
        
        const startTime = performance.now();
        const maxTimeMs = this.currentBudgetMs;  // Use adaptive budget
        
        this.metadata.newFrame();
        this.updateCount = 0;
        
        // Scale rebuild limit based on budget (more time = process more voxels)
        const rebuildLimit = Math.floor(500 + (this.currentBudgetMs / this.maxBudgetMs) * 2000);
        this.rebuildDirtyRectsLimited(rebuildLimit);
        
        this.stats.dirtyChunks = this.metadata.dirtyRects.size;
        
        // === CASCADED FLUID SIMULATION ===
        // Distance-based update frequency:
        // < 32 units:  Every frame (full rate)
        // < 64 units:  Every 2 frames
        // < 128 units: Every 4 frames
        // > 128 units: Every 8 frames
        this._fluidFrame = (this._fluidFrame || 0) + 1;
        
        // Process dirty rectangles in 4-pass checkerboard pattern (Noita-style)
        // This allows safe parallel processing with ±CHUNK_SIZE/2 buffer zones
        // Pass 0: cx%2==0, cz%2==0  Pass 1: cx%2==1, cz%2==0
        // Pass 2: cx%2==0, cz%2==1  Pass 3: cx%2==1, cz%2==1
        for (let pass = 0; pass < 4; pass++) {
            const passX = pass & 1;
            const passZ = (pass >> 1) & 1;
            
            for (const [chunkKey, rect] of this.metadata.dirtyRects) {
                // Check time budget
                if (performance.now() - startTime > maxTimeMs) break;
                
                const chunk = this.chunkManager.chunks.get(chunkKey);
                if (!chunk) continue;
                
                // 4-way checkerboard filter
                if (((chunk.cx & 1) !== passX) || ((chunk.cz & 1) !== passZ)) continue;
                
                // === DISTANCE-BASED UPDATE FREQUENCY ===
                if (cameraPos) {
                    const cx = (chunk.cx + 0.5) * CHUNK_SIZE;
                    const cy = (chunk.cy + 0.5) * CHUNK_SIZE;
                    const cz = (chunk.cz + 0.5) * CHUNK_SIZE;
                    const dx = cx - cameraPos[0];
                    const dy = cy - cameraPos[1];
                    const dz = cz - cameraPos[2];
                    const distSq = dx*dx + dy*dy + dz*dz;
                    
                    // Determine update frequency based on distance
                    let skipMask;
                    if (distSq < 32*32) {
                        skipMask = 0;       // Every frame
                    } else if (distSq < 64*64) {
                        skipMask = 1;       // Every 2 frames
                    } else if (distSq < 128*128) {
                        skipMask = 3;       // Every 4 frames
                    } else {
                        skipMask = 7;       // Every 8 frames
                    }
                    
                    // Skip this chunk based on frame and distance
                    if ((this._fluidFrame & skipMask) !== 0) continue;
                }
                
                this.processChunkRect(chunk, rect);
                
                if (this.updateCount >= this.maxUpdatesPerFrame) break;
            }
            if (this.updateCount >= this.maxUpdatesPerFrame) break;
            if (performance.now() - startTime > maxTimeMs) break;
        }
        
        this.stats.updatesThisFrame = this.updateCount;
        this.stats.activeVoxels = this.metadata.activeVoxels.size;
    }
    
    /**
     * Process a dirty rectangle within a chunk
     * Updates from bottom to top for proper gravity
     */
    processChunkRect(chunk, rect) {
        // Expand rect by 1 to catch edge interactions
        const minX = Math.max(0, rect.minX - 1);
        const maxX = Math.min(CHUNK_SIZE - 1, rect.maxX + 1);
        const minY = Math.max(0, rect.minY - 1);
        const maxY = Math.min(CHUNK_SIZE - 1, rect.maxY + 1);
        const minZ = Math.max(0, rect.minZ - 1);
        const maxZ = Math.min(CHUNK_SIZE - 1, rect.maxZ + 1);
        
        // Bottom-up iteration (Y ascending)
        for (let ly = minY; ly <= maxY; ly++) {
            for (let lz = minZ; lz <= maxZ; lz++) {
                for (let lx = minX; lx <= maxX; lx++) {
                    if (this.updateCount >= this.maxUpdatesPerFrame) return;
                    
                    // Skip if already updated this frame
                    if (this.metadata.wasUpdated(chunk.key, lx, ly, lz)) continue;
                    
                    const material = chunk.get(lx, ly, lz);
                    if (material === MATERIAL.AIR) continue;
                    
                    const props = MATERIAL_PROPERTIES[material];
                    
                    // Dispatch by material type
                    switch (props.type) {
                        case 'powder':
                            this.updatePowder(chunk, lx, ly, lz, material, props);
                            break;
                        case 'liquid':
                            this.updateLiquid(chunk, lx, ly, lz, material, props);
                            break;
                        case 'gas':
                            this.updateGas(chunk, lx, ly, lz, material, props);
                            break;
                        case 'fire':
                            this.updateFire(chunk, lx, ly, lz, material, props);
                            break;
                    }
                }
            }
        }
    }
    
    /**
     * Get voxel at world position (handles chunk boundaries)
     */
    getVoxel(wx, wy, wz) {
        return this.chunkManager.getVoxel(wx, wy, wz);
    }
    
    /**
     * Set voxel at world position (handles chunk boundaries)
     */
    setVoxel(wx, wy, wz, material) {
        const changed = this.chunkManager.setVoxel(wx, wy, wz, material);
        if (changed) {
            // Activate this and neighbors for simulation
            this.activateVoxel(wx, wy, wz);
            this.activateVoxel(wx, wy - 1, wz);
            this.activateVoxel(wx, wy + 1, wz);
            this.activateVoxel(wx - 1, wy, wz);
            this.activateVoxel(wx + 1, wy, wz);
            this.activateVoxel(wx, wy, wz - 1);
            this.activateVoxel(wx, wy, wz + 1);
        }
        return changed;
    }
    
    /**
     * Swap two voxels (for falling/rising)
     */
    swapVoxels(wx1, wy1, wz1, wx2, wy2, wz2) {
        const mat1 = this.getVoxel(wx1, wy1, wz1);
        const mat2 = this.getVoxel(wx2, wy2, wz2);
        
        this.chunkManager.setVoxel(wx1, wy1, wz1, mat2);
        this.chunkManager.setVoxel(wx2, wy2, wz2, mat1);
        
        // Activate affected positions and neighbors
        this.activateVoxel(wx1, wy1, wz1);
        this.activateVoxel(wx2, wy2, wz2);
        this.activateVoxel(wx1, wy1 - 1, wz1);
        this.activateVoxel(wx2, wy2 - 1, wz2);
    }
    
    /**
     * Check if material A can displace material B (based on density)
     */
    canDisplace(matA, matB) {
        if (matB === MATERIAL.AIR) return true;
        
        const propsA = MATERIAL_PROPERTIES[matA];
        const propsB = MATERIAL_PROPERTIES[matB];
        
        // Solids don't move
        if (propsB.type === 'solid') return false;
        
        // Denser materials sink through lighter ones
        return propsA.density > propsB.density;
    }
    
    // ========================================================================
    // MATERIAL UPDATE FUNCTIONS
    // ========================================================================
    
    /**
     * Update powder (sand, gravel)
     * Falls down, slides diagonally if blocked
     */
    updatePowder(chunk, lx, ly, lz, material, props) {
        const wx = chunk.cx * CHUNK_SIZE + lx;
        const wy = chunk.cy * CHUNK_SIZE + ly;
        const wz = chunk.cz * CHUNK_SIZE + lz;
        
        this.metadata.setUpdated(chunk.key, lx, ly, lz);
        this.updateCount++;
        
        // Try to fall straight down
        const below = this.getVoxel(wx, wy - 1, wz);
        if (this.canDisplace(material, below)) {
            this.swapVoxels(wx, wy, wz, wx, wy - 1, wz);
            return;
        }
        
        // Try diagonal down (random direction to avoid bias)
        const dirs = this.random(wx, wy, wz) < 0.5 
            ? [[wx - 1, wy - 1, wz], [wx + 1, wy - 1, wz], [wx, wy - 1, wz - 1], [wx, wy - 1, wz + 1]]
            : [[wx + 1, wy - 1, wz], [wx - 1, wy - 1, wz], [wx, wy - 1, wz + 1], [wx, wy - 1, wz - 1]];
        
        for (const [dx, dy, dz] of dirs) {
            const neighbor = this.getVoxel(dx, dy, dz);
            if (this.canDisplace(material, neighbor)) {
                this.swapVoxels(wx, wy, wz, dx, dy, dz);
                return;
            }
        }
        
        // Settled - remove from active set
        this.metadata.activeVoxels.delete(`${chunk.key}:${lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE_SQ}`);
    }
    
    /**
     * Update liquid (water, lava)
     * Falls down, spreads horizontally
     */
    updateLiquid(chunk, lx, ly, lz, material, props) {
        const wx = chunk.cx * CHUNK_SIZE + lx;
        const wy = chunk.cy * CHUNK_SIZE + ly;
        const wz = chunk.cz * CHUNK_SIZE + lz;
        
        this.metadata.setUpdated(chunk.key, lx, ly, lz);
        this.updateCount++;
        
        // Viscosity check - skip update sometimes for thick liquids
        if (props.viscosity > 0 && this.random(wx, wy, wz) < props.viscosity) {
            return;
        }
        
        // Try to fall straight down
        const below = this.getVoxel(wx, wy - 1, wz);
        if (this.canDisplace(material, below)) {
            this.swapVoxels(wx, wy, wz, wx, wy - 1, wz);
            return;
        }
        
        // Try diagonal down
        const diagDirs = this.random(wx, wy, wz) < 0.5
            ? [[wx - 1, wy - 1, wz], [wx + 1, wy - 1, wz], [wx, wy - 1, wz - 1], [wx, wy - 1, wz + 1]]
            : [[wx + 1, wy - 1, wz], [wx - 1, wy - 1, wz], [wx, wy - 1, wz + 1], [wx, wy - 1, wz - 1]];
        
        for (const [dx, dy, dz] of diagDirs) {
            const neighbor = this.getVoxel(dx, dy, dz);
            if (this.canDisplace(material, neighbor)) {
                this.swapVoxels(wx, wy, wz, dx, dy, dz);
                return;
            }
        }
        
        // Spread horizontally
        const spreadRate = props.spreadRate || 2;
        const sideDirs = this.random(wx + 1, wy, wz) < 0.5
            ? [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]
            : [[-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]];
        
        for (const [dx, dy, dz] of sideDirs) {
            // Check multiple cells in this direction
            for (let dist = 1; dist <= spreadRate; dist++) {
                const nx = wx + dx * dist;
                const nz = wz + dz * dist;
                const neighbor = this.getVoxel(nx, wy, nz);
                
                if (neighbor === MATERIAL.AIR) {
                    // Check if there's support or it would fall
                    const belowNeighbor = this.getVoxel(nx, wy - 1, nz);
                    if (belowNeighbor !== MATERIAL.AIR) {
                        this.swapVoxels(wx, wy, wz, nx, wy, nz);
                        return;
                    } else {
                        // Move there anyway (will fall next frame)
                        this.swapVoxels(wx, wy, wz, nx, wy, nz);
                        return;
                    }
                } else if (!this.canDisplace(material, neighbor)) {
                    break;  // Blocked
                }
            }
        }
        
        // Check if this is surface water (air above) - keep it slightly active for ripples
        const above = this.getVoxel(wx, wy + 1, wz);
        const isSurface = above === MATERIAL.AIR;
        
        // Surface water occasionally creates ripples (random horizontal movement)
        if (isSurface && this.random(wx, wy, wz + this.metadata.frame) < 0.02) {
            // Try to swap with adjacent water for ripple effect
            const rippleDirs = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
            const dir = rippleDirs[Math.floor(this.random(wx + 1, wy, wz) * 4)];
            const neighbor = this.getVoxel(wx + dir[0], wy, wz + dir[2]);
            if (neighbor === material) {
                // Don't actually swap same material, just keep active
                return;
            }
        }
        
        // Settled - but keep active if at surface (might need to flow when neighbor removed)
        // Only fully deactivate if completely surrounded by same liquid AND not at surface
        if (isSurface) {
            // Surface water stays semi-active
            return;
        }
        
        let surrounded = true;
        for (const [dx, dy, dz] of [[1,0,0], [-1,0,0], [0,0,1], [0,0,-1], [0,1,0], [0,-1,0]]) {
            const n = this.getVoxel(wx + dx, wy + dy, wz + dz);
            if (n === MATERIAL.AIR) { surrounded = false; break; }
        }
        
        if (surrounded) {
            this.metadata.activeVoxels.delete(`${chunk.key}:${lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE_SQ}`);
        }
    }
    
    /**
     * Update gas (steam, smoke)
     * Rises up, spreads horizontally
     */
    updateGas(chunk, lx, ly, lz, material, props) {
        const wx = chunk.cx * CHUNK_SIZE + lx;
        const wy = chunk.cy * CHUNK_SIZE + ly;
        const wz = chunk.cz * CHUNK_SIZE + lz;
        
        // Air doesn't move
        if (material === MATERIAL.AIR) return;
        
        this.metadata.setUpdated(chunk.key, lx, ly, lz);
        this.updateCount++;
        
        // Try to rise straight up
        const above = this.getVoxel(wx, wy + 1, wz);
        const aboveProps = MATERIAL_PROPERTIES[above];
        
        if (above === MATERIAL.AIR || (aboveProps.type === 'liquid' && aboveProps.density > props.density)) {
            this.swapVoxels(wx, wy, wz, wx, wy + 1, wz);
            return;
        }
        
        // Try diagonal up
        const diagDirs = this.random(wx, wy, wz) < 0.5
            ? [[wx - 1, wy + 1, wz], [wx + 1, wy + 1, wz]]
            : [[wx + 1, wy + 1, wz], [wx - 1, wy + 1, wz]];
        
        for (const [dx, dy, dz] of diagDirs) {
            const neighbor = this.getVoxel(dx, dy, dz);
            if (neighbor === MATERIAL.AIR) {
                this.swapVoxels(wx, wy, wz, dx, dy, dz);
                return;
            }
        }
        
        // Spread horizontally
        const sideDirs = this.random(wx, wy + 1, wz) < 0.5
            ? [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]
            : [[-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]];
        
        for (const [dx, dy, dz] of sideDirs) {
            const neighbor = this.getVoxel(wx + dx, wy, wz + dz);
            if (neighbor === MATERIAL.AIR) {
                this.swapVoxels(wx, wy, wz, wx + dx, wy, wz + dz);
                return;
            }
        }
        
        // Dissipate over time (gases fade)
        if (this.random(wx, wy, wz + this.metadata.frame) < 0.01) {
            this.setVoxel(wx, wy, wz, MATERIAL.AIR);
        }
    }
    
    /**
     * Update fire (energy)
     * Spreads to flammable neighbors, has lifetime
     */
    updateFire(chunk, lx, ly, lz, material, props) {
        const wx = chunk.cx * CHUNK_SIZE + lx;
        const wy = chunk.cy * CHUNK_SIZE + ly;
        const wz = chunk.cz * CHUNK_SIZE + lz;
        
        this.metadata.setUpdated(chunk.key, lx, ly, lz);
        this.updateCount++;
        
        // Check neighbors for flammable materials
        const neighbors = [
            [wx + 1, wy, wz], [wx - 1, wy, wz],
            [wx, wy + 1, wz], [wx, wy - 1, wz],
            [wx, wy, wz + 1], [wx, wy, wz - 1],
        ];
        
        for (const [nx, ny, nz] of neighbors) {
            const neighbor = this.getVoxel(nx, ny, nz);
            const neighborProps = MATERIAL_PROPERTIES[neighbor];
            
            // Spread fire to flammable materials
            if (neighborProps.flammable && this.random(nx, ny, nz) < (props.spreadChance || 0.1)) {
                this.setVoxel(nx, ny, nz, MATERIAL.ENERGY);
            }
            
            // Water extinguishes fire and becomes steam
            if (neighbor === MATERIAL.WATER) {
                this.setVoxel(nx, ny, nz, MATERIAL.STEAM);
                this.setVoxel(wx, wy, wz, MATERIAL.AIR);
                return;
            }
        }
        
        // Fire rises slightly
        if (this.random(wx, wy + 1, wz) < 0.3) {
            const above = this.getVoxel(wx, wy + 1, wz);
            if (above === MATERIAL.AIR) {
                this.swapVoxels(wx, wy, wz, wx, wy + 1, wz);
                return;
            }
        }
        
        // Lifetime decay
        if (this.random(wx, wy, wz + this.metadata.frame) < 0.02) {
            this.setVoxel(wx, wy, wz, MATERIAL.AIR);
        }
    }
    
    /**
     * Update acid (special liquid that corrodes)
     */
    updateAcid(chunk, lx, ly, lz) {
        const wx = chunk.cx * CHUNK_SIZE + lx;
        const wy = chunk.cy * CHUNK_SIZE + ly;
        const wz = chunk.cz * CHUNK_SIZE + lz;
        
        // First do normal liquid behavior
        this.updateLiquid(chunk, lx, ly, lz, MATERIAL.ACID, MATERIAL_PROPERTIES[MATERIAL.ACID]);
        
        // Then check for corrosion
        const neighbors = [
            [wx + 1, wy, wz], [wx - 1, wy, wz],
            [wx, wy + 1, wz], [wx, wy - 1, wz],
            [wx, wy, wz + 1], [wx, wy, wz - 1],
        ];
        
        for (const [nx, ny, nz] of neighbors) {
            const neighbor = this.getVoxel(nx, ny, nz);
            const neighborProps = MATERIAL_PROPERTIES[neighbor];
            
            // Corrode non-acid, non-air, non-obsidian materials
            if (neighbor !== MATERIAL.AIR && 
                neighbor !== MATERIAL.ACID && 
                neighbor !== MATERIAL.OBSIDIAN &&
                neighbor !== MATERIAL.VOIDSTONE &&
                neighborProps.type === 'solid') {
                
                if (this.random(nx, ny, nz) < 0.05) {
                    this.setVoxel(nx, ny, nz, MATERIAL.AIR);
                    // Acid consumed in reaction (sometimes)
                    if (this.random(nx + 1, ny, nz) < 0.3) {
                        this.setVoxel(wx, wy, wz, MATERIAL.AIR);
                    }
                    return;
                }
            }
        }
    }
    
    /**
     * Check for special chemical reactions between materials
     * Called when materials are adjacent
     */
    checkReactions(wx, wy, wz, material) {
        const props = MATERIAL_PROPERTIES[material];
        
        // Magma + Water = Obsidian + Steam
        if (material === MATERIAL.MAGMA) {
            const neighbors = [[1,0,0], [-1,0,0], [0,1,0], [0,-1,0], [0,0,1], [0,0,-1]];
            for (const [dx, dy, dz] of neighbors) {
                const neighbor = this.getVoxel(wx + dx, wy + dy, wz + dz);
                if (neighbor === MATERIAL.WATER) {
                    this.setVoxel(wx, wy, wz, MATERIAL.OBSIDIAN);
                    this.setVoxel(wx + dx, wy + dy, wz + dz, MATERIAL.STEAM);
                    return true;
                }
            }
        }
        
        // Magma heats nearby flammable things
        if (material === MATERIAL.MAGMA || props.heats) {
            const neighbors = [[1,0,0], [-1,0,0], [0,1,0], [0,-1,0], [0,0,1], [0,0,-1]];
            for (const [dx, dy, dz] of neighbors) {
                const neighbor = this.getVoxel(wx + dx, wy + dy, wz + dz);
                const neighborProps = MATERIAL_PROPERTIES[neighbor];
                if (neighborProps.flammable && this.random(wx + dx, wy + dy, wz + dz) < 0.02) {
                    this.setVoxel(wx + dx, wy + dy, wz + dz, MATERIAL.ENERGY);
                    return true;
                }
            }
        }
        
        return false;
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [fluid_simulation] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.stepsPerFrame = parseInt(cfg.steps_per_frame) || 2;
        this.viscosity = parseFloat(cfg.viscosity) || 0.1;
        this.surfaceTension = parseFloat(cfg.surface_tension) || 0.5;
        this.flowSpeed = parseFloat(cfg.flow_speed) || 1.0;
    }
}

export default FluidSimulator;
