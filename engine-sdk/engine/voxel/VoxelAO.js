// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * VoxelAO.js - Baked Voxel Ambient Occlusion
 * 
 * Calculates ambient occlusion per-vertex during meshing.
 * Uses neighbor sampling to determine how occluded each corner is.
 * 
 * Benefits:
 * - Free AO at runtime (baked into vertices)
 * - Smooth shading on voxel terrain
 * - No screen-space artifacts
 * 
 * Algorithm:
 * For each vertex corner, sample the 3 adjacent voxels + diagonal.
 * AO = 1.0 - (numOccluders / 4)
 */

// AO sample offsets for each face direction and corner
// Each corner samples 3 neighbors + 1 diagonal
const AO_SAMPLE_OFFSETS = {
    // +X face (right)
    0: [
        // Corner 0 (bottom-left when looking at face)
        [[1, -1, 0], [1, 0, -1], [1, -1, -1]],
        // Corner 1 (bottom-right)
        [[1, -1, 0], [1, 0, 1], [1, -1, 1]],
        // Corner 2 (top-right)
        [[1, 1, 0], [1, 0, 1], [1, 1, 1]],
        // Corner 3 (top-left)
        [[1, 1, 0], [1, 0, -1], [1, 1, -1]],
    ],
    // -X face (left)
    1: [
        [[-1, -1, 0], [-1, 0, 1], [-1, -1, 1]],
        [[-1, -1, 0], [-1, 0, -1], [-1, -1, -1]],
        [[-1, 1, 0], [-1, 0, -1], [-1, 1, -1]],
        [[-1, 1, 0], [-1, 0, 1], [-1, 1, 1]],
    ],
    // +Y face (top)
    2: [
        [[0, 1, -1], [-1, 1, 0], [-1, 1, -1]],
        [[0, 1, -1], [1, 1, 0], [1, 1, -1]],
        [[0, 1, 1], [1, 1, 0], [1, 1, 1]],
        [[0, 1, 1], [-1, 1, 0], [-1, 1, 1]],
    ],
    // -Y face (bottom)
    3: [
        [[0, -1, -1], [1, -1, 0], [1, -1, -1]],
        [[0, -1, -1], [-1, -1, 0], [-1, -1, -1]],
        [[0, -1, 1], [-1, -1, 0], [-1, -1, 1]],
        [[0, -1, 1], [1, -1, 0], [1, -1, 1]],
    ],
    // +Z face (front)
    4: [
        [[0, -1, 1], [-1, 0, 1], [-1, -1, 1]],
        [[0, -1, 1], [1, 0, 1], [1, -1, 1]],
        [[0, 1, 1], [1, 0, 1], [1, 1, 1]],
        [[0, 1, 1], [-1, 0, 1], [-1, 1, 1]],
    ],
    // -Z face (back)
    5: [
        [[0, -1, -1], [1, 0, -1], [1, -1, -1]],
        [[0, -1, -1], [-1, 0, -1], [-1, -1, -1]],
        [[0, 1, -1], [-1, 0, -1], [-1, 1, -1]],
        [[0, 1, -1], [1, 0, -1], [1, 1, -1]],
    ],
};

/**
 * Calculate vertex AO for a single corner
 * @param {Function} isOpaque - (x, y, z) => boolean
 * @param {number} x - Voxel X
 * @param {number} y - Voxel Y
 * @param {number} z - Voxel Z
 * @param {number} face - Face direction (0-5)
 * @param {number} corner - Corner index (0-3)
 * @returns {number} - AO value 0.0 (fully occluded) to 1.0 (no occlusion)
 */
export function calculateVertexAO(isOpaque, x, y, z, face, corner) {
    const offsets = AO_SAMPLE_OFFSETS[face][corner];
    
    // Sample the 3 neighbors
    const side1 = isOpaque(x + offsets[0][0], y + offsets[0][1], z + offsets[0][2]) ? 1 : 0;
    const side2 = isOpaque(x + offsets[1][0], y + offsets[1][1], z + offsets[1][2]) ? 1 : 0;
    const corner_occ = isOpaque(x + offsets[2][0], y + offsets[2][1], z + offsets[2][2]) ? 1 : 0;
    
    // If both sides are occluded, corner is fully dark (prevents light leaking)
    if (side1 && side2) {
        return 0.0;
    }
    
    // Otherwise, AO based on occluder count
    const occluders = side1 + side2 + corner_occ;
    return 1.0 - (occluders / 3.0) * 0.7;  // Max 70% darkening
}

/**
 * Calculate all 4 corner AO values for a face
 * @param {Function} isOpaque 
 * @param {number} x 
 * @param {number} y 
 * @param {number} z 
 * @param {number} face 
 * @returns {Array<number>} - [ao0, ao1, ao2, ao3]
 */
export function calculateFaceAO(isOpaque, x, y, z, face) {
    return [
        calculateVertexAO(isOpaque, x, y, z, face, 0),
        calculateVertexAO(isOpaque, x, y, z, face, 1),
        calculateVertexAO(isOpaque, x, y, z, face, 2),
        calculateVertexAO(isOpaque, x, y, z, face, 3),
    ];
}

/**
 * Pack 4 AO values into a single u32 (8 bits each)
 * @param {Array<number>} ao - 4 AO values (0.0-1.0)
 * @returns {number} - Packed u32
 */
export function packAO(ao) {
    const a0 = Math.floor(ao[0] * 255) & 0xFF;
    const a1 = Math.floor(ao[1] * 255) & 0xFF;
    const a2 = Math.floor(ao[2] * 255) & 0xFF;
    const a3 = Math.floor(ao[3] * 255) & 0xFF;
    return (a3 << 24) | (a2 << 16) | (a1 << 8) | a0;
}

/**
 * Unpack u32 to 4 AO values
 * @param {number} packed 
 * @returns {Array<number>}
 */
export function unpackAO(packed) {
    return [
        (packed & 0xFF) / 255,
        ((packed >> 8) & 0xFF) / 255,
        ((packed >> 16) & 0xFF) / 255,
        ((packed >> 24) & 0xFF) / 255,
    ];
}

/**
 * Determine if face vertices should be flipped for better AO interpolation
 * Fixes the "anisotropy" problem where diagonal looks different based on quad orientation
 * @param {Array<number>} ao - 4 AO values
 * @returns {boolean} - True if vertices should be flipped
 */
export function shouldFlipQuad(ao) {
    // Compare diagonals - flip if 0+2 > 1+3 for smoother interpolation
    return (ao[0] + ao[2]) > (ao[1] + ao[3]);
}

// WGSL shader code for AO
export const VOXEL_AO_WGSL = /* wgsl */ `
// Unpack AO from vertex data (assumes AO is packed in upper byte of normal)
fn unpackAO(packedAO: u32, cornerIndex: u32) -> f32 {
    let shift = cornerIndex * 8u;
    let ao = (packedAO >> shift) & 0xFFu;
    return f32(ao) / 255.0;
}

// Apply AO to fragment color
fn applyAO(color: vec3<f32>, ao: f32) -> vec3<f32> {
    // Smooth AO curve for better visuals
    let smoothAO = ao * ao * (3.0 - 2.0 * ao);  // Smoothstep
    return color * (0.3 + 0.7 * smoothAO);  // Min 30% brightness
}
`;

/**
 * VoxelAOCalculator - GPU compute shader for AO calculation
 */
export class VoxelAOCalculator {
    constructor() {
        this.device = null;
        this.initialized = false;
        this.enabled = true;
        
        // Precomputed AO lookup table
        this.aoLUT = null;
    }
    
    /**
     * Initialize the AO calculator
     * @param {GPUDevice} device 
     */
    init(device) {
        this.device = device;
        
        // Create AO lookup table (3^8 = 6561 entries)
        // For quick CPU-side AO calculation
        this.aoLUT = this.createAOLookupTable();
        
        this.initialized = true;
        console.log('[VoxelAO] Initialized with lookup table');
    }
    
    /**
     * Create precomputed AO lookup table
     * Key: 8-bit neighbor mask
     * Value: AO value (0-255)
     */
    createAOLookupTable() {
        const lut = new Uint8Array(256);
        
        for (let mask = 0; mask < 256; mask++) {
            // Count set bits (occluders)
            const side1 = (mask & 1) ? 1 : 0;
            const side2 = (mask & 2) ? 1 : 0;
            const corner = (mask & 4) ? 1 : 0;
            
            let ao;
            if (side1 && side2) {
                ao = 0;  // Both sides occluded = fully dark
            } else {
                const occluders = side1 + side2 + corner;
                ao = Math.floor((1.0 - (occluders / 3.0) * 0.7) * 255);
            }
            
            lut[mask] = ao;
        }
        
        return lut;
    }
    
    /**
     * Fast AO lookup using precomputed table
     * @param {number} side1 - Is side 1 opaque?
     * @param {number} side2 - Is side 2 opaque?
     * @param {number} corner - Is corner opaque?
     * @returns {number} - AO value 0-255
     */
    lookupAO(side1, side2, corner) {
        const mask = (side1 ? 1 : 0) | (side2 ? 2 : 0) | (corner ? 4 : 0);
        return this.aoLUT[mask];
    }
    
    /**
     * Calculate AO for an entire chunk during meshing
     * @param {Uint8Array} voxels - Chunk voxel data
     * @param {number} chunkSize - Size of chunk (e.g., 32)
     * @returns {Uint8Array} - AO data per voxel face (6 values × 4 corners per voxel)
     */
    calculateChunkAO(voxels, chunkSize) {
        if (!this.enabled) return null;
        
        const aoData = new Uint8Array(chunkSize * chunkSize * chunkSize * 6 * 4);
        
        const isOpaque = (x, y, z) => {
            if (x < 0 || x >= chunkSize || y < 0 || y >= chunkSize || z < 0 || z >= chunkSize) {
                return false;  // Treat out-of-bounds as air
            }
            return voxels[x + y * chunkSize + z * chunkSize * chunkSize] !== 0;
        };
        
        let aoIndex = 0;
        for (let z = 0; z < chunkSize; z++) {
            for (let y = 0; y < chunkSize; y++) {
                for (let x = 0; x < chunkSize; x++) {
                    for (let face = 0; face < 6; face++) {
                        for (let corner = 0; corner < 4; corner++) {
                            const ao = calculateVertexAO(isOpaque, x, y, z, face, corner);
                            aoData[aoIndex++] = Math.floor(ao * 255);
                        }
                    }
                }
            }
        }
        
        return aoData;
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [voxel_ao] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.samples = parseInt(cfg.samples) || 4;
        this.radius = parseFloat(cfg.radius) || 1.0;
        this.intensity = parseFloat(cfg.intensity) || 0.5;
    }
    
    /**
     * Destroy resources
     */
    destroy() {
        this.aoLUT = null;
        this.initialized = false;
    }
}

export default VoxelAOCalculator;
