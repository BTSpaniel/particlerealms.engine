/**
 * SDFCollision.js - Signed Distance Field Collision Detection
 * 
 * Based on GPU Gems 3, Chapter 34: "Signed Distance Fields Using Single-Pass GPU Scan"
 * and PhysX 5.x SDF collision geometry.
 * 
 * SDFs provide:
 * - Accurate collision for concave shapes without decomposition
 * - Efficient distance queries for soft body interactions
 * - Smooth contact normals for stable simulation
 * - Fast ray/sphere casting
 * 
 * The SDF stores the signed distance to the nearest surface at each point:
 * - Negative inside the object
 * - Positive outside the object
 * - Zero on the surface
 */

/**
 * SDF primitive functions
 */
export const SDFPrimitives = {
    /**
     * Sphere SDF
     * @param {Array} p - Point [x, y, z]
     * @param {number} radius - Sphere radius
     * @returns {number} Signed distance
     */
    sphere(p, radius) {
        const len = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
        return len - radius;
    },
    
    /**
     * Box SDF
     * @param {Array} p - Point [x, y, z]
     * @param {Array} halfExtents - Half extents [hx, hy, hz]
     * @returns {number} Signed distance
     */
    box(p, halfExtents) {
        const qx = Math.abs(p[0]) - halfExtents[0];
        const qy = Math.abs(p[1]) - halfExtents[1];
        const qz = Math.abs(p[2]) - halfExtents[2];
        
        const outsideDist = Math.sqrt(
            Math.max(qx, 0) ** 2 + 
            Math.max(qy, 0) ** 2 + 
            Math.max(qz, 0) ** 2
        );
        const insideDist = Math.min(Math.max(qx, qy, qz), 0);
        
        return outsideDist + insideDist;
    },
    
    /**
     * Capsule SDF (along Y axis)
     * @param {Array} p - Point [x, y, z]
     * @param {number} height - Half height
     * @param {number} radius - Capsule radius
     * @returns {number} Signed distance
     */
    capsule(p, height, radius) {
        const py = Math.max(-height, Math.min(height, p[1]));
        const dx = p[0];
        const dy = p[1] - py;
        const dz = p[2];
        return Math.sqrt(dx * dx + dy * dy + dz * dz) - radius;
    },
    
    /**
     * Cylinder SDF (along Y axis)
     * @param {Array} p - Point [x, y, z]
     * @param {number} height - Half height
     * @param {number} radius - Cylinder radius
     * @returns {number} Signed distance
     */
    cylinder(p, height, radius) {
        const dxz = Math.sqrt(p[0] * p[0] + p[2] * p[2]) - radius;
        const dy = Math.abs(p[1]) - height;
        return Math.min(Math.max(dxz, dy), 0) + 
               Math.sqrt(Math.max(dxz, 0) ** 2 + Math.max(dy, 0) ** 2);
    },
    
    /**
     * Torus SDF (in XZ plane)
     * @param {Array} p - Point [x, y, z]
     * @param {number} majorRadius - Major radius
     * @param {number} minorRadius - Minor radius
     * @returns {number} Signed distance
     */
    torus(p, majorRadius, minorRadius) {
        const qxz = Math.sqrt(p[0] * p[0] + p[2] * p[2]) - majorRadius;
        return Math.sqrt(qxz * qxz + p[1] * p[1]) - minorRadius;
    },
    
    /**
     * Cone SDF (tip at origin, opening upward)
     * @param {Array} p - Point [x, y, z]
     * @param {number} angle - Half angle in radians
     * @param {number} height - Cone height
     * @returns {number} Signed distance
     */
    cone(p, angle, height) {
        const sinA = Math.sin(angle);
        const cosA = Math.cos(angle);
        const q = Math.sqrt(p[0] * p[0] + p[2] * p[2]);
        return Math.max(
            q * cosA - p[1] * sinA,
            p[1] - height,
            -p[1]
        );
    },
};

/**
 * SDF combination operations
 */
export const SDFOperations = {
    /**
     * Union of two SDFs
     */
    union(d1, d2) {
        return Math.min(d1, d2);
    },
    
    /**
     * Smooth union with blending radius
     */
    smoothUnion(d1, d2, k) {
        const h = Math.max(k - Math.abs(d1 - d2), 0) / k;
        return Math.min(d1, d2) - h * h * k * 0.25;
    },
    
    /**
     * Intersection of two SDFs
     */
    intersection(d1, d2) {
        return Math.max(d1, d2);
    },
    
    /**
     * Subtraction (d1 - d2)
     */
    subtraction(d1, d2) {
        return Math.max(d1, -d2);
    },
    
    /**
     * Shell (hollow out an SDF)
     */
    shell(d, thickness) {
        return Math.abs(d) - thickness;
    },
    
    /**
     * Round an SDF
     */
    round(d, radius) {
        return d - radius;
    },
};

/**
 * 3D SDF Grid for collision detection
 */
export class SDFGrid {
    /**
     * @param {Object} options - Grid options
     */
    constructor(options = {}) {
        this.resolution = options.resolution || 32;
        this.bounds = options.bounds || {
            min: [-1, -1, -1],
            max: [1, 1, 1],
        };
        
        // Calculate grid parameters
        this.sizeX = this.bounds.max[0] - this.bounds.min[0];
        this.sizeY = this.bounds.max[1] - this.bounds.min[1];
        this.sizeZ = this.bounds.max[2] - this.bounds.min[2];
        
        this.cellSizeX = this.sizeX / this.resolution;
        this.cellSizeY = this.sizeY / this.resolution;
        this.cellSizeZ = this.sizeZ / this.resolution;
        
        // SDF data (Float32 per voxel)
        this.data = new Float32Array(this.resolution ** 3);
        this.data.fill(Infinity);
    }
    
    /**
     * Sample an SDF function into the grid
     * @param {Function} sdfFunc - SDF function (point) => distance
     */
    sampleSDF(sdfFunc) {
        for (let z = 0; z < this.resolution; z++) {
            for (let y = 0; y < this.resolution; y++) {
                for (let x = 0; x < this.resolution; x++) {
                    const worldX = this.bounds.min[0] + (x + 0.5) * this.cellSizeX;
                    const worldY = this.bounds.min[1] + (y + 0.5) * this.cellSizeY;
                    const worldZ = this.bounds.min[2] + (z + 0.5) * this.cellSizeZ;
                    
                    const idx = z * this.resolution * this.resolution + y * this.resolution + x;
                    this.data[idx] = sdfFunc([worldX, worldY, worldZ]);
                }
            }
        }
    }
    
    /**
     * Get the signed distance at a world position using trilinear interpolation
     * @param {Array} point - World position [x, y, z]
     * @returns {number} Interpolated signed distance
     */
    sample(point) {
        // Convert to grid coordinates
        const gx = (point[0] - this.bounds.min[0]) / this.cellSizeX - 0.5;
        const gy = (point[1] - this.bounds.min[1]) / this.cellSizeY - 0.5;
        const gz = (point[2] - this.bounds.min[2]) / this.cellSizeZ - 0.5;
        
        // Clamp to grid bounds
        const x0 = Math.max(0, Math.min(this.resolution - 2, Math.floor(gx)));
        const y0 = Math.max(0, Math.min(this.resolution - 2, Math.floor(gy)));
        const z0 = Math.max(0, Math.min(this.resolution - 2, Math.floor(gz)));
        
        const x1 = x0 + 1;
        const y1 = y0 + 1;
        const z1 = z0 + 1;
        
        // Interpolation weights
        const tx = Math.max(0, Math.min(1, gx - x0));
        const ty = Math.max(0, Math.min(1, gy - y0));
        const tz = Math.max(0, Math.min(1, gz - z0));
        
        // Sample 8 corners
        const c000 = this._getVoxel(x0, y0, z0);
        const c100 = this._getVoxel(x1, y0, z0);
        const c010 = this._getVoxel(x0, y1, z0);
        const c110 = this._getVoxel(x1, y1, z0);
        const c001 = this._getVoxel(x0, y0, z1);
        const c101 = this._getVoxel(x1, y0, z1);
        const c011 = this._getVoxel(x0, y1, z1);
        const c111 = this._getVoxel(x1, y1, z1);
        
        // Trilinear interpolation
        const c00 = c000 * (1 - tx) + c100 * tx;
        const c10 = c010 * (1 - tx) + c110 * tx;
        const c01 = c001 * (1 - tx) + c101 * tx;
        const c11 = c011 * (1 - tx) + c111 * tx;
        
        const c0 = c00 * (1 - ty) + c10 * ty;
        const c1 = c01 * (1 - ty) + c11 * ty;
        
        return c0 * (1 - tz) + c1 * tz;
    }
    
    /**
     * Get gradient (surface normal) at a point using central differences
     * @param {Array} point - World position
     * @returns {Array} Normalized gradient [nx, ny, nz]
     */
    gradient(point) {
        const eps = Math.min(this.cellSizeX, this.cellSizeY, this.cellSizeZ) * 0.5;
        
        const dx = this.sample([point[0] + eps, point[1], point[2]]) -
                   this.sample([point[0] - eps, point[1], point[2]]);
        const dy = this.sample([point[0], point[1] + eps, point[2]]) -
                   this.sample([point[0], point[1] - eps, point[2]]);
        const dz = this.sample([point[0], point[1], point[2] + eps]) -
                   this.sample([point[0], point[1], point[2] - eps]);
        
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len < 1e-10) return [0, 1, 0];
        
        return [dx / len, dy / len, dz / len];
    }
    
    /**
     * Get voxel value at grid coordinates
     */
    _getVoxel(x, y, z) {
        if (x < 0 || x >= this.resolution ||
            y < 0 || y >= this.resolution ||
            z < 0 || z >= this.resolution) {
            return Infinity;
        }
        return this.data[z * this.resolution * this.resolution + y * this.resolution + x];
    }
    
    /**
     * Sphere cast against SDF
     * @param {Array} origin - Ray origin
     * @param {Array} direction - Ray direction (normalized)
     * @param {number} radius - Sphere radius
     * @param {number} maxDistance - Maximum cast distance
     * @returns {Object|null} Hit info {distance, point, normal} or null
     */
    sphereCast(origin, direction, radius, maxDistance = 100) {
        let t = 0;
        const point = [...origin];
        
        for (let i = 0; i < 128; i++) {
            const dist = this.sample(point) - radius;
            
            if (dist < 0.001) {
                return {
                    distance: t,
                    point: [...point],
                    normal: this.gradient(point),
                };
            }
            
            if (t > maxDistance) break;
            
            // Sphere tracing step
            t += Math.max(dist * 0.9, 0.001);
            point[0] = origin[0] + direction[0] * t;
            point[1] = origin[1] + direction[1] * t;
            point[2] = origin[2] + direction[2] * t;
        }
        
        return null;
    }
    
    /**
     * Check collision between a point/sphere and the SDF
     * @param {Array} point - Point position
     * @param {number} radius - Collision radius (0 for point)
     * @returns {Object|null} Collision info {penetration, normal, contactPoint}
     */
    checkCollision(point, radius = 0) {
        const dist = this.sample(point);
        const penetration = radius - dist;
        
        if (penetration > 0) {
            const normal = this.gradient(point);
            return {
                penetration,
                normal,
                contactPoint: [
                    point[0] - normal[0] * dist,
                    point[1] - normal[1] * dist,
                    point[2] - normal[2] * dist,
                ],
            };
        }
        
        return null;
    }
}

/**
 * Create SDF collider from mesh using jump flooding algorithm
 * This is a simplified CPU version - GPU version would be faster
 * 
 * @param {Float32Array} vertices - Mesh vertices
 * @param {Uint32Array} indices - Mesh triangle indices
 * @param {Object} options - Options
 * @returns {SDFGrid} SDF grid
 */
export function createSDFFromMesh(vertices, indices, options = {}) {
    const resolution = options.resolution || 32;
    const padding = options.padding || 0.1;
    
    // Compute bounds
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    
    for (let i = 0; i < vertices.length; i += 3) {
        minX = Math.min(minX, vertices[i]);
        minY = Math.min(minY, vertices[i + 1]);
        minZ = Math.min(minZ, vertices[i + 2]);
        maxX = Math.max(maxX, vertices[i]);
        maxY = Math.max(maxY, vertices[i + 1]);
        maxZ = Math.max(maxZ, vertices[i + 2]);
    }
    
    // Add padding
    const padX = (maxX - minX) * padding;
    const padY = (maxY - minY) * padding;
    const padZ = (maxZ - minZ) * padding;
    
    const grid = new SDFGrid({
        resolution,
        bounds: {
            min: [minX - padX, minY - padY, minZ - padZ],
            max: [maxX + padX, maxY + padY, maxZ + padZ],
        },
    });
    
    // Sample distance to nearest triangle at each voxel
    // This is O(n * m) - GPU version uses jump flooding for O(n log n)
    for (let z = 0; z < resolution; z++) {
        for (let y = 0; y < resolution; y++) {
            for (let x = 0; x < resolution; x++) {
                const worldX = grid.bounds.min[0] + (x + 0.5) * grid.cellSizeX;
                const worldY = grid.bounds.min[1] + (y + 0.5) * grid.cellSizeY;
                const worldZ = grid.bounds.min[2] + (z + 0.5) * grid.cellSizeZ;
                
                let minDist = Infinity;
                let closestNormal = [0, 1, 0];
                
                // Find closest triangle
                for (let t = 0; t < indices.length; t += 3) {
                    const i0 = indices[t] * 3;
                    const i1 = indices[t + 1] * 3;
                    const i2 = indices[t + 2] * 3;
                    
                    const v0 = [vertices[i0], vertices[i0 + 1], vertices[i0 + 2]];
                    const v1 = [vertices[i1], vertices[i1 + 1], vertices[i1 + 2]];
                    const v2 = [vertices[i2], vertices[i2 + 1], vertices[i2 + 2]];
                    
                    const result = pointToTriangleDistance([worldX, worldY, worldZ], v0, v1, v2);
                    
                    if (result.distance < Math.abs(minDist)) {
                        minDist = result.distance;
                        closestNormal = result.normal;
                    }
                }
                
                // Determine sign using closest normal
                const toPoint = [
                    worldX - grid.bounds.min[0],
                    worldY - grid.bounds.min[1],
                    worldZ - grid.bounds.min[2],
                ];
                
                // Approximate inside/outside using winding number or ray casting
                // Simplified: use normal dot product heuristic
                const idx = z * resolution * resolution + y * resolution + x;
                grid.data[idx] = minDist; // Unsigned for now
            }
        }
    }
    
    console.log(`[SDFCollision] Created SDF grid: ${resolution}³ voxels`);
    return grid;
}

/**
 * Calculate distance from point to triangle
 */
function pointToTriangleDistance(p, v0, v1, v2) {
    // Edge vectors
    const e0 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
    const e1 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
    const v = [p[0] - v0[0], p[1] - v0[1], p[2] - v0[2]];
    
    const dot00 = e0[0] * e0[0] + e0[1] * e0[1] + e0[2] * e0[2];
    const dot01 = e0[0] * e1[0] + e0[1] * e1[1] + e0[2] * e1[2];
    const dot11 = e1[0] * e1[0] + e1[1] * e1[1] + e1[2] * e1[2];
    const dot20 = v[0] * e0[0] + v[1] * e0[1] + v[2] * e0[2];
    const dot21 = v[0] * e1[0] + v[1] * e1[1] + v[2] * e1[2];
    
    const denom = dot00 * dot11 - dot01 * dot01;
    if (Math.abs(denom) < 1e-10) {
        return { distance: Infinity, normal: [0, 1, 0] };
    }
    
    const invDenom = 1 / denom;
    const u = (dot11 * dot20 - dot01 * dot21) * invDenom;
    const w = (dot00 * dot21 - dot01 * dot20) * invDenom;
    
    // Clamp to triangle
    const uc = Math.max(0, Math.min(1, u));
    const wc = Math.max(0, Math.min(1 - uc, w));
    
    // Closest point on triangle
    const closest = [
        v0[0] + e0[0] * uc + e1[0] * wc,
        v0[1] + e0[1] * uc + e1[1] * wc,
        v0[2] + e0[2] * uc + e1[2] * wc,
    ];
    
    // Distance
    const dx = p[0] - closest[0];
    const dy = p[1] - closest[1];
    const dz = p[2] - closest[2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    // Normal (cross product of edges)
    const nx = e0[1] * e1[2] - e0[2] * e1[1];
    const ny = e0[2] * e1[0] - e0[0] * e1[2];
    const nz = e0[0] * e1[1] - e0[1] * e1[0];
    const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz);
    
    return {
        distance,
        normal: nlen > 0 ? [nx / nlen, ny / nlen, nz / nlen] : [0, 1, 0],
    };
}
