// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ColoredLighting.js - Bit-Packed RGB Flood Fill Lighting
 * 
 * Implements colored voxel lighting with:
 * - 4 bits per channel (R, G, B, Sky) = 16 bits per voxel
 * - Flood fill propagation via BFS
 * - Word-level parallelism for fast operations
 * - Light source materials emit colored light
 * 
 * Based on techniques from:
 * - Minecraft (original flood fill)
 * - Seed of Andromeda (colored channels)
 * - 0fps.net (word-level parallelism)
 */

import { MATERIAL } from './MaterialSchema.js';
import { CHUNK_SIZE, CHUNK_SIZE_SQ, CHUNK_VOLUME } from './VoxelConstants.js';

// ============================================================================
// CONSTANTS
// ============================================================================

// Bit positions for packed light value (16-bit)
// Format: SSSS BBBB GGGG RRRR (each 4 bits, 0-15 range)
const RED_SHIFT = 0;
const GREEN_SHIFT = 4;
const BLUE_SHIFT = 8;
const SKY_SHIFT = 12;

const RED_MASK = 0x000F;
const GREEN_MASK = 0x00F0;
const BLUE_MASK = 0x0F00;
const SKY_MASK = 0xF000;

// Maximum light level (4 bits = 15)
const MAX_LIGHT = 15;

// Light absorption per material (0 = transparent, 15 = fully opaque)
const MATERIAL_OPACITY = {
    [MATERIAL.AIR]: 0,
    [MATERIAL.STONE]: 15,
    [MATERIAL.DIRT]: 15,
    [MATERIAL.GRASS]: 15,
    [MATERIAL.SAND]: 15,
    [MATERIAL.WATER]: 2,       // Water absorbs some light
    [MATERIAL.WOOD]: 15,
    [MATERIAL.METAL]: 15,
    [MATERIAL.ENERGY]: 0,      // Fire is transparent
    [MATERIAL.DEEPSTONE]: 15,
    [MATERIAL.OBSIDIAN]: 15,
    [MATERIAL.MAGMA]: 0,       // Magma emits light
    [MATERIAL.CRYSTAL]: 1,     // Crystal is mostly transparent
    [MATERIAL.VOIDSTONE]: 15,
    [MATERIAL.FUNGUS]: 15,
    [MATERIAL.MYCELIUM]: 15,
    [MATERIAL.STEAM]: 1,       // Steam slightly absorbs
    [MATERIAL.OIL]: 3,
    [MATERIAL.ACID]: 2,
    [MATERIAL.GRAVEL]: 15,
    default: 15,
};

// Light emission per material (0 = no light, each component 0-15)
// Format: { r, g, b, intensity }
const MATERIAL_EMISSION = {
    [MATERIAL.ENERGY]: { r: 15, g: 8, b: 2, intensity: 14 },   // Fire: orange
    [MATERIAL.MAGMA]: { r: 15, g: 5, b: 0, intensity: 12 },    // Magma: red-orange
    [MATERIAL.CRYSTAL]: { r: 10, g: 8, b: 15, intensity: 8 },  // Crystal: purple glow
};

// ============================================================================
// LIGHT VALUE UTILITIES
// ============================================================================

/**
 * Pack RGB + Sky into a 16-bit value
 */
export function packLight(r, g, b, sky = 0) {
    return ((r & 0xF) << RED_SHIFT) |
           ((g & 0xF) << GREEN_SHIFT) |
           ((b & 0xF) << BLUE_SHIFT) |
           ((sky & 0xF) << SKY_SHIFT);
}

/**
 * Unpack light into components
 */
export function unpackLight(packed) {
    return {
        r: (packed >> RED_SHIFT) & 0xF,
        g: (packed >> GREEN_SHIFT) & 0xF,
        b: (packed >> BLUE_SHIFT) & 0xF,
        sky: (packed >> SKY_SHIFT) & 0xF,
    };
}

/**
 * Get single channel from packed light
 */
export function getChannel(packed, shift) {
    return (packed >> shift) & 0xF;
}

/**
 * Component-wise maximum of two light values
 */
export function lightMax(a, b) {
    const rMax = Math.max((a & RED_MASK), (b & RED_MASK));
    const gMax = Math.max((a & GREEN_MASK), (b & GREEN_MASK));
    const bMax = Math.max((a & BLUE_MASK), (b & BLUE_MASK));
    const sMax = Math.max((a & SKY_MASK), (b & SKY_MASK));
    return rMax | gMax | bMax | sMax;
}

/**
 * Component-wise decrement with saturation (no underflow)
 */
export function lightDecrement(packed, amount = 1) {
    let r = Math.max(0, ((packed >> RED_SHIFT) & 0xF) - amount);
    let g = Math.max(0, ((packed >> GREEN_SHIFT) & 0xF) - amount);
    let b = Math.max(0, ((packed >> BLUE_SHIFT) & 0xF) - amount);
    let s = Math.max(0, ((packed >> SKY_SHIFT) & 0xF) - amount);
    return packLight(r, g, b, s);
}

/**
 * Check if light value is non-zero
 */
export function hasLight(packed) {
    return packed !== 0;
}

/**
 * Convert light to normalized RGB (0-1 range)
 */
export function lightToRGB(packed, skyBrightness = 1.0) {
    const { r, g, b, sky } = unpackLight(packed);
    
    // Combine block light with sky light
    const skyContrib = sky * skyBrightness;
    
    return {
        r: Math.min(1.0, (r + skyContrib) / MAX_LIGHT),
        g: Math.min(1.0, (g + skyContrib) / MAX_LIGHT),
        b: Math.min(1.0, (b + skyContrib) / MAX_LIGHT),
    };
}

// ============================================================================
// LIGHTING SYSTEM
// ============================================================================

export class ColoredLightingSystem {
    constructor(chunkManager) {
        this.chunkManager = chunkManager;
        
        // Light data per chunk (Uint16Array)
        // Map of chunkKey -> Uint16Array[CHUNK_VOLUME]
        this.lightData = new Map();
        
        // Propagation queue (BFS)
        this.lightQueue = [];      // For adding light
        this.removalQueue = [];    // For removing light
        
        // Sky light settings
        this.skyBrightness = 15;   // 0-15, changes with time of day
        this.ambientLight = 1;     // Minimum light level everywhere
        
        // Stats
        this.stats = {
            lightsProcessed: 0,
            chunksWithLight: 0,
        };
    }
    
    /**
     * Get or create light data for a chunk
     */
    getLightData(chunkKey) {
        let data = this.lightData.get(chunkKey);
        if (!data) {
            data = new Uint16Array(CHUNK_VOLUME);
            // Initialize with ambient light
            if (this.ambientLight > 0) {
                const ambient = packLight(this.ambientLight, this.ambientLight, this.ambientLight, 0);
                data.fill(ambient);
            }
            this.lightData.set(chunkKey, data);
        }
        return data;
    }
    
    /**
     * Get light level at world position
     */
    getLight(wx, wy, wz) {
        const chunk = this.chunkManager.getChunkAt(wx, wy, wz);
        if (!chunk) return packLight(this.ambientLight, this.ambientLight, this.ambientLight, 0);
        
        const data = this.lightData.get(chunk.key);
        if (!data) return packLight(this.ambientLight, this.ambientLight, this.ambientLight, 0);
        
        const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        const idx = lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE_SQ;
        
        return data[idx];
    }
    
    /**
     * Set light level at world position
     */
    setLight(wx, wy, wz, light) {
        const chunk = this.chunkManager.getChunkAt(wx, wy, wz);
        if (!chunk) return;
        
        const data = this.getLightData(chunk.key);
        
        const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
        const idx = lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE_SQ;
        
        data[idx] = light;
    }
    
    /**
     * Get material opacity
     */
    getOpacity(material) {
        return MATERIAL_OPACITY[material] ?? MATERIAL_OPACITY.default;
    }
    
    /**
     * Get material light emission
     */
    getEmission(material) {
        return MATERIAL_EMISSION[material] || null;
    }
    
    /**
     * Add a light source at position
     */
    addLightSource(wx, wy, wz, r, g, b) {
        const light = packLight(r, g, b, 0);
        this.setLight(wx, wy, wz, light);
        
        // Queue for propagation
        this.lightQueue.push({ x: wx, y: wy, z: wz });
    }
    
    /**
     * Remove light source at position
     */
    removeLightSource(wx, wy, wz) {
        const oldLight = this.getLight(wx, wy, wz);
        this.setLight(wx, wy, wz, 0);
        
        // Queue for removal propagation
        if (hasLight(oldLight)) {
            this.removalQueue.push({ x: wx, y: wy, z: wz, light: oldLight });
        }
    }
    
    /**
     * Initialize lighting for a chunk based on light-emitting materials
     */
    initializeChunkLighting(chunk) {
        if (!chunk || chunk.isHomogeneous) return;
        
        const data = this.getLightData(chunk.key);
        
        // Find light-emitting materials
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
            for (let ly = 0; ly < CHUNK_SIZE; ly++) {
                for (let lx = 0; lx < CHUNK_SIZE; lx++) {
                    const material = chunk.get(lx, ly, lz);
                    const emission = this.getEmission(material);
                    
                    if (emission) {
                        const wx = chunk.cx * CHUNK_SIZE + lx;
                        const wy = chunk.cy * CHUNK_SIZE + ly;
                        const wz = chunk.cz * CHUNK_SIZE + lz;
                        
                        const light = packLight(emission.r, emission.g, emission.b, 0);
                        const idx = lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE_SQ;
                        data[idx] = light;
                        
                        this.lightQueue.push({ x: wx, y: wy, z: wz });
                    }
                }
            }
        }
        
        // Initialize sky light from top
        this.initializeSkyLight(chunk);
    }
    
    /**
     * Initialize sky light propagating down from top of chunk
     */
    initializeSkyLight(chunk) {
        // Only propagate sky light if chunk is at surface or above
        if (chunk.cy < -2) return;  // Deep underground has no sky
        
        const data = this.getLightData(chunk.key);
        
        // Check each column
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
            for (let lx = 0; lx < CHUNK_SIZE; lx++) {
                // Start from top of chunk
                let skyLevel = this.skyBrightness;
                
                for (let ly = CHUNK_SIZE - 1; ly >= 0; ly--) {
                    const material = chunk.get(lx, ly, lz);
                    const opacity = this.getOpacity(material);
                    
                    if (opacity >= 15) {
                        // Fully opaque - no more sky light below
                        skyLevel = 0;
                    } else {
                        // Partially transparent - reduce sky light
                        skyLevel = Math.max(0, skyLevel - opacity - 1);
                    }
                    
                    if (skyLevel > 0) {
                        const idx = lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE_SQ;
                        const current = data[idx];
                        const withSky = (current & ~SKY_MASK) | ((skyLevel & 0xF) << SKY_SHIFT);
                        data[idx] = withSky;
                        
                        // Queue for horizontal propagation
                        const wx = chunk.cx * CHUNK_SIZE + lx;
                        const wy = chunk.cy * CHUNK_SIZE + ly;
                        const wz = chunk.cz * CHUNK_SIZE + lz;
                        this.lightQueue.push({ x: wx, y: wy, z: wz });
                    }
                }
            }
        }
    }
    
    /**
     * Process light propagation queue
     * Call this in the update loop
     * @param {number} maxOperations - Max operations per call
     * @param {Array} cameraPos - Camera position [x, y, z] for distance-based priority
     */
    processLightQueue(maxOperations = 1000, cameraPos = null) {
        let processed = 0;
        
        // === CASCADED LIGHTING SYSTEM ===
        // Sort queues by distance to camera (near lights first)
        if (cameraPos && this.lightQueue.length > 50) {
            this.lightQueue.sort((a, b) => {
                const distA = (a.x - cameraPos[0])**2 + (a.y - cameraPos[1])**2 + (a.z - cameraPos[2])**2;
                const distB = (b.x - cameraPos[0])**2 + (b.y - cameraPos[1])**2 + (b.z - cameraPos[2])**2;
                return distA - distB;
            });
        }
        
        // Distance-based operation budget
        // Near lights get more operations per frame
        const nearBudget = Math.floor(maxOperations * 0.7);  // 70% for near
        const farBudget = maxOperations - nearBudget;         // 30% for far
        let nearProcessed = 0;
        let farProcessed = 0;
        
        // Process removals first (always full priority)
        while (this.removalQueue.length > 0 && processed < maxOperations) {
            const { x, y, z, light } = this.removalQueue.shift();
            this.propagateRemoval(x, y, z, light);
            processed++;
        }
        
        // Then process additions with distance priority
        while (this.lightQueue.length > 0 && processed < maxOperations) {
            const item = this.lightQueue[0];
            
            // Calculate distance to camera
            let isNear = true;
            if (cameraPos) {
                const distSq = (item.x - cameraPos[0])**2 + (item.y - cameraPos[1])**2 + (item.z - cameraPos[2])**2;
                isNear = distSq < 64 * 64;  // 64 units = near
            }
            
            // Check budget
            if (isNear) {
                if (nearProcessed >= nearBudget) {
                    // Try far budget instead
                    if (farProcessed >= farBudget) break;
                }
            } else {
                if (farProcessed >= farBudget) {
                    // Try near budget instead
                    if (nearProcessed >= nearBudget) break;
                }
            }
            
            this.lightQueue.shift();
            this.propagateLight(item.x, item.y, item.z);
            processed++;
            
            if (isNear) nearProcessed++;
            else farProcessed++;
        }
        
        this.stats.lightsProcessed = processed;
        this.stats.chunksWithLight = this.lightData.size;
        
        return processed;
    }
    
    /**
     * Propagate light from a source position
     */
    propagateLight(wx, wy, wz) {
        const sourceLight = this.getLight(wx, wy, wz);
        if (!hasLight(sourceLight)) return;
        
        const neighbors = [
            [wx + 1, wy, wz],
            [wx - 1, wy, wz],
            [wx, wy + 1, wz],
            [wx, wy - 1, wz],
            [wx, wy, wz + 1],
            [wx, wy, wz - 1],
        ];
        
        for (const [nx, ny, nz] of neighbors) {
            const neighborMaterial = this.chunkManager.getVoxel(nx, ny, nz);
            const opacity = this.getOpacity(neighborMaterial);
            
            // Skip fully opaque blocks
            if (opacity >= 15) continue;
            
            // Calculate propagated light (decrease by 1 + opacity)
            const decrease = 1 + opacity;
            const propagated = lightDecrement(sourceLight, decrease);
            
            if (!hasLight(propagated)) continue;
            
            // Get current neighbor light
            const neighborLight = this.getLight(nx, ny, nz);
            
            // Only update if we'd increase light
            const combined = lightMax(neighborLight, propagated);
            if (combined !== neighborLight) {
                this.setLight(nx, ny, nz, combined);
                this.lightQueue.push({ x: nx, y: ny, z: nz });
            }
        }
    }
    
    /**
     * Propagate light removal
     */
    propagateRemoval(wx, wy, wz, oldLight) {
        const neighbors = [
            [wx + 1, wy, wz],
            [wx - 1, wy, wz],
            [wx, wy + 1, wz],
            [wx, wy - 1, wz],
            [wx, wy, wz + 1],
            [wx, wy, wz - 1],
        ];
        
        for (const [nx, ny, nz] of neighbors) {
            const neighborLight = this.getLight(nx, ny, nz);
            if (!hasLight(neighborLight)) continue;
            
            // Check if neighbor was lit by this source
            const { r: nr, g: ng, b: nb, sky: ns } = unpackLight(neighborLight);
            const { r: or, g: og, b: ob, sky: os } = unpackLight(oldLight);
            
            // If neighbor's light is less than source - 1, it was probably lit by this
            if (nr < or || ng < og || nb < ob || ns < os) {
                // Remove this light and queue for re-propagation
                this.setLight(nx, ny, nz, packLight(this.ambientLight, this.ambientLight, this.ambientLight, 0));
                this.removalQueue.push({ x: nx, y: ny, z: nz, light: neighborLight });
            }
        }
        
        // Re-propagate from surrounding light sources
        for (const [nx, ny, nz] of neighbors) {
            const neighborLight = this.getLight(nx, ny, nz);
            if (hasLight(neighborLight)) {
                this.lightQueue.push({ x: nx, y: ny, z: nz });
            }
        }
    }
    
    /**
     * Handle block placement (may need to remove light)
     */
    onBlockPlaced(wx, wy, wz, material) {
        const opacity = this.getOpacity(material);
        
        if (opacity > 0) {
            // Block placed - remove light at this position
            const oldLight = this.getLight(wx, wy, wz);
            if (hasLight(oldLight)) {
                this.removalQueue.push({ x: wx, y: wy, z: wz, light: oldLight });
                this.setLight(wx, wy, wz, 0);
            }
        }
        
        // Check if this material emits light
        const emission = this.getEmission(material);
        if (emission) {
            this.addLightSource(wx, wy, wz, emission.r, emission.g, emission.b);
        }
    }
    
    /**
     * Handle block removal (light can now propagate through)
     */
    onBlockRemoved(wx, wy, wz) {
        // Reset to ambient
        this.setLight(wx, wy, wz, packLight(this.ambientLight, this.ambientLight, this.ambientLight, 0));
        
        // Check neighbors and queue them for re-propagation
        const neighbors = [
            [wx + 1, wy, wz],
            [wx - 1, wy, wz],
            [wx, wy + 1, wz],
            [wx, wy - 1, wz],
            [wx, wy, wz + 1],
            [wx, wy, wz - 1],
        ];
        
        for (const [nx, ny, nz] of neighbors) {
            const neighborLight = this.getLight(nx, ny, nz);
            if (hasLight(neighborLight)) {
                this.lightQueue.push({ x: nx, y: ny, z: nz });
            }
        }
    }
    
    /**
     * Set sky brightness (0-15, for day/night cycle)
     */
    setSkyBrightness(brightness) {
        this.skyBrightness = Math.max(0, Math.min(15, Math.floor(brightness)));
    }
    
    /**
     * Get light at position as normalized float RGB
     */
    getLightRGB(wx, wy, wz) {
        const packed = this.getLight(wx, wy, wz);
        return lightToRGB(packed, this.skyBrightness / 15);
    }
    
    /**
     * Clear all light data (for chunk unloading)
     */
    clearChunkLight(chunkKey) {
        this.lightData.delete(chunkKey);
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [colored_lighting] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.maxLights = parseInt(cfg.max_lights) || 64;
        this.propagationDistance = parseInt(cfg.propagation_distance) || 15;
        this.coloredShadows = cfg.colored_shadows === true;
    }
}

export default ColoredLightingSystem;
