// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PlanetaryCoords.js - Spherified Cube Coordinate System
 * 
 * Implements a planetary coordinate system where:
 * - 6 cube faces are projected onto a sphere using ASC (Adjusted Spherified Cube)
 * - "Shells" represent distance from planet center (like altitude/depth)
 * - Chunks are addressed by (face, shell, u, v) instead of (x, y, z)
 * - Gravity points toward the planet center
 * 
 * ASC Projection advantages:
 * - Near-uniform cell sizes across the sphere
 * - Minimal distortion at face edges
 * - Simple inverse mapping (sphere → cube)
 */

// ============================================================================
// CONSTANTS
// ============================================================================

// Cube face indices
export const FACE = {
    POS_X: 0,  // +X face
    NEG_X: 1,  // -X face
    POS_Y: 2,  // +Y face (north pole)
    NEG_Y: 3,  // -Y face (south pole)
    POS_Z: 4,  // +Z face
    NEG_Z: 5,  // -Z face
};

// Face names for debugging
export const FACE_NAMES = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];

// Default planet radius (in world units)
export const DEFAULT_PLANET_RADIUS = 10000;

// Shell thickness (distance between shell layers, in world units)
export const SHELL_THICKNESS = 32;  // Same as CHUNK_SIZE

// ============================================================================
// ASC PROJECTION
// ============================================================================

/**
 * ASC (Adjusted Spherified Cube) projection
 * Maps a point on a cube face to a point on a unit sphere
 * 
 * @param {number} u - Face coordinate U (-1 to 1)
 * @param {number} v - Face coordinate V (-1 to 1)
 * @returns {[number, number, number]} Normalized direction on unit sphere
 */
export function ascProject(u, v) {
    // ASC formula for better uniformity than simple normalization
    const u2 = u * u;
    const v2 = v * v;
    
    // Adjusted coordinates
    const x = u * Math.sqrt(1 - v2 / 2 - 1/3 + v2 / 3);
    const y = v * Math.sqrt(1 - u2 / 2 - 1/3 + u2 / 3);
    const z = Math.sqrt(1 - u2 / 2 - v2 / 2 + u2 * v2 / 3);
    
    return [x, y, z];
}

/**
 * Inverse ASC projection
 * Maps a direction on unit sphere back to cube face coordinates
 * 
 * @param {number} x 
 * @param {number} y 
 * @param {number} z 
 * @returns {{ face: number, u: number, v: number }}
 */
export function ascInverse(x, y, z) {
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const az = Math.abs(z);
    
    let face, fx, fy, fz;
    
    // Determine which face the point belongs to
    if (ax >= ay && ax >= az) {
        // X-dominant face
        face = x > 0 ? FACE.POS_X : FACE.NEG_X;
        fx = x > 0 ? 1 : -1;
        fy = y / ax;
        fz = z / ax;
    } else if (ay >= ax && ay >= az) {
        // Y-dominant face
        face = y > 0 ? FACE.POS_Y : FACE.NEG_Y;
        fx = x / ay;
        fy = y > 0 ? 1 : -1;
        fz = z / ay;
    } else {
        // Z-dominant face
        face = z > 0 ? FACE.POS_Z : FACE.NEG_Z;
        fx = x / az;
        fy = y / az;
        fz = z > 0 ? 1 : -1;
    }
    
    // Convert to UV based on face
    let u, v;
    switch (face) {
        case FACE.POS_X: u = -fz; v = fy; break;
        case FACE.NEG_X: u = fz; v = fy; break;
        case FACE.POS_Y: u = fx; v = -fz; break;
        case FACE.NEG_Y: u = fx; v = fz; break;
        case FACE.POS_Z: u = fx; v = fy; break;
        case FACE.NEG_Z: u = -fx; v = fy; break;
    }
    
    return { face, u, v };
}

// ============================================================================
// COORDINATE CONVERSIONS
// ============================================================================

/**
 * Convert face coordinates to a direction on the unit sphere
 * @param {number} face - Cube face index (0-5)
 * @param {number} u - Face coordinate (-1 to 1)
 * @param {number} v - Face coordinate (-1 to 1)
 * @returns {[number, number, number]} Unit direction vector
 */
export function faceToDirection(face, u, v) {
    // Get base direction on cube face
    const [px, py, pz] = ascProject(u, v);
    
    // Rotate based on face
    switch (face) {
        case FACE.POS_X: return [pz, py, -px];
        case FACE.NEG_X: return [-pz, py, px];
        case FACE.POS_Y: return [px, pz, -py];
        case FACE.NEG_Y: return [px, -pz, py];
        case FACE.POS_Z: return [px, py, pz];
        case FACE.NEG_Z: return [-px, py, -pz];
        default: return [px, py, pz];
    }
}

/**
 * Convert planetary coordinates to world position
 * @param {number} face - Cube face index
 * @param {number} shell - Shell index (0 = surface, negative = underground)
 * @param {number} u - Face coordinate (-1 to 1)
 * @param {number} v - Face coordinate (-1 to 1)
 * @param {number} planetRadius - Planet radius
 * @returns {[number, number, number]} World position
 */
export function planetaryToWorld(face, shell, u, v, planetRadius = DEFAULT_PLANET_RADIUS) {
    const direction = faceToDirection(face, u, v);
    const radius = planetRadius + shell * SHELL_THICKNESS;
    
    return [
        direction[0] * radius,
        direction[1] * radius,
        direction[2] * radius,
    ];
}

/**
 * Convert world position to planetary coordinates
 * @param {number} x 
 * @param {number} y 
 * @param {number} z 
 * @param {number} planetRadius 
 * @returns {{ face: number, shell: number, u: number, v: number, altitude: number }}
 */
export function worldToPlanetary(x, y, z, planetRadius = DEFAULT_PLANET_RADIUS) {
    // Distance from planet center
    const dist = Math.sqrt(x * x + y * y + z * z);
    const altitude = dist - planetRadius;
    const shell = Math.floor(altitude / SHELL_THICKNESS);
    
    // Normalize to get direction
    const nx = x / dist;
    const ny = y / dist;
    const nz = z / dist;
    
    // Get face and UV
    const { face, u, v } = ascInverse(nx, ny, nz);
    
    return { face, shell, u, v, altitude };
}

/**
 * Get gravity direction at a world position (points toward center)
 * @param {number} x 
 * @param {number} y 
 * @param {number} z 
 * @returns {[number, number, number]} Normalized gravity direction
 */
export function getGravityDirection(x, y, z) {
    const dist = Math.sqrt(x * x + y * y + z * z);
    if (dist < 0.001) return [0, -1, 0];  // At center, default down
    
    // Gravity points toward center (negative of position direction)
    return [-x / dist, -y / dist, -z / dist];
}

/**
 * Get "up" direction at a world position (away from center)
 * @param {number} x 
 * @param {number} y 
 * @param {number} z 
 * @returns {[number, number, number]} Normalized up direction
 */
export function getUpDirection(x, y, z) {
    const dist = Math.sqrt(x * x + y * y + z * z);
    if (dist < 0.001) return [0, 1, 0];  // At center, default up
    
    return [x / dist, y / dist, z / dist];
}

// ============================================================================
// CHUNK ADDRESSING FOR PLANETARY MODE
// ============================================================================

/**
 * Get chunk key for planetary coordinates
 * @param {number} face - Face index (0-5)
 * @param {number} shell - Shell index
 * @param {number} cu - Chunk U coordinate on face
 * @param {number} cv - Chunk V coordinate on face
 * @returns {string} Unique chunk key
 */
export function planetaryChunkKey(face, shell, cu, cv) {
    return `P${face}:${shell}:${cu},${cv}`;
}

/**
 * Parse planetary chunk key
 * @param {string} key 
 * @returns {{ face: number, shell: number, cu: number, cv: number } | null}
 */
export function parsePlanetaryChunkKey(key) {
    if (!key.startsWith('P')) return null;
    
    const match = key.match(/^P(\d+):(-?\d+):(-?\d+),(-?\d+)$/);
    if (!match) return null;
    
    return {
        face: parseInt(match[1]),
        shell: parseInt(match[2]),
        cu: parseInt(match[3]),
        cv: parseInt(match[4]),
    };
}

/**
 * Convert world position to planetary chunk coordinates
 * @param {number} x 
 * @param {number} y 
 * @param {number} z 
 * @param {number} chunkSize - Size of chunks in world units
 * @param {number} planetRadius 
 * @returns {{ face: number, shell: number, cu: number, cv: number }}
 */
export function worldToPlanetaryChunk(x, y, z, chunkSize = 32, planetRadius = DEFAULT_PLANET_RADIUS) {
    const { face, shell, u, v } = worldToPlanetary(x, y, z, planetRadius);
    
    // Convert UV (-1 to 1) to chunk coordinates
    // Each face is divided into chunks
    const chunksPerFaceEdge = Math.ceil(2 * Math.PI * planetRadius / chunkSize / 4);
    
    const cu = Math.floor((u + 1) / 2 * chunksPerFaceEdge);
    const cv = Math.floor((v + 1) / 2 * chunksPerFaceEdge);
    
    return { face, shell, cu, cv };
}

// ============================================================================
// PLANETARY MODE STATE
// ============================================================================

/**
 * Planetary world configuration
 */
export class PlanetaryWorld {
    constructor(options = {}) {
        this.enabled = false;  // Start in flat mode by default
        this.radius = options.radius || DEFAULT_PLANET_RADIUS;
        this.shellThickness = options.shellThickness || SHELL_THICKNESS;
        
        // Surface is at shell 0
        // Positive shells = above surface (atmosphere)
        // Negative shells = below surface (underground)
        this.surfaceShell = 0;
        
        // Maximum depth (negative shells)
        this.maxDepth = options.maxDepth || -100;  // 100 shells deep
        
        // Maximum altitude (positive shells)
        this.maxAltitude = options.maxAltitude || 10;  // 10 shells up
    }
    
    /**
     * Toggle planetary mode
     */
    toggle() {
        this.enabled = !this.enabled;
        return this.enabled;
    }
    
    /**
     * Get depth tier based on shell (for realm physics)
     * @param {number} shell 
     * @returns {string} Tier name
     */
    getShellTier(shell) {
        if (shell >= 0) return 'Surface';
        if (shell >= -3) return 'Underground';
        if (shell >= -10) return 'Deep';
        if (shell >= -30) return 'Abyss';
        if (shell >= -70) return 'Void';
        return 'Core';
    }
    
    /**
     * Get gravity strength based on shell (Shell Theorem)
     * @param {number} shell 
     * @returns {number} Gravity multiplier (0-1)
     */
    getShellGravity(shell) {
        if (shell >= 0) return 1.0;  // Surface and above = full gravity
        
        // Below surface: gravity decreases linearly toward center (Shell Theorem)
        // At center (shell = -radius/shellThickness), gravity = 0
        const centerShell = -this.radius / this.shellThickness;
        const t = Math.max(0, (shell - centerShell) / (-centerShell));
        return t;
    }
}

export default PlanetaryWorld;
