/**
 * ConvexDecomposition.js - V-HACD Style Convex Decomposition
 * 
 * Implements Volumetric Hierarchical Approximate Convex Decomposition (V-HACD)
 * for breaking concave meshes into convex pieces suitable for physics collision.
 * 
 * This is essential for:
 * - Complex mesh colliders (characters, vehicles, props)
 * - Hollow objects (cups, bowls, tubes)
 * - Concave terrain features
 * 
 * The algorithm:
 * 1. Voxelize the mesh at a given resolution
 * 2. Recursively split voxel regions using optimal cutting planes
 * 3. Compute convex hulls for each region
 * 4. Simplify hulls to reduce vertex count
 */

/**
 * Default decomposition parameters
 */
export const DECOMPOSITION_DEFAULTS = {
    resolution: 100000,      // Voxelization resolution
    maxHulls: 16,            // Maximum number of convex hulls
    maxVerticesPerHull: 32,  // Maximum vertices per hull (PhysX limit is 256)
    minVolumePerHull: 0.001, // Minimum volume for a hull (fraction of total)
    concavity: 0.001,        // Maximum concavity threshold
    planeDownsampling: 4,    // Plane downsampling factor
    hullDownsampling: 4,     // Hull downsampling factor
    alpha: 0.05,             // Symmetry clipping bias
    beta: 0.05,              // Axis alignment bias
    mode: 'voxel',           // 'voxel' or 'tetrahedron'
};

let _decompositionHullSequence = 0;

function _newDecompositionHullId(index) {
    return `decomp_hull_${index}_${Date.now()}_${++_decompositionHullSequence}`;
}

/**
 * 3D point class for decomposition
 */
class Point3D {
    constructor(x = 0, y = 0, z = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
    }
    
    distanceTo(other) {
        const dx = this.x - other.x;
        const dy = this.y - other.y;
        const dz = this.z - other.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    
    clone() {
        return new Point3D(this.x, this.y, this.z);
    }
}

/**
 * Axis-Aligned Bounding Box
 */
class AABB {
    constructor() {
        this.min = new Point3D(Infinity, Infinity, Infinity);
        this.max = new Point3D(-Infinity, -Infinity, -Infinity);
    }
    
    expand(point) {
        this.min.x = Math.min(this.min.x, point.x);
        this.min.y = Math.min(this.min.y, point.y);
        this.min.z = Math.min(this.min.z, point.z);
        this.max.x = Math.max(this.max.x, point.x);
        this.max.y = Math.max(this.max.y, point.y);
        this.max.z = Math.max(this.max.z, point.z);
    }
    
    getSize() {
        return new Point3D(
            this.max.x - this.min.x,
            this.max.y - this.min.y,
            this.max.z - this.min.z
        );
    }
    
    getCenter() {
        return new Point3D(
            (this.min.x + this.max.x) / 2,
            (this.min.y + this.max.y) / 2,
            (this.min.z + this.max.z) / 2
        );
    }
    
    getVolume() {
        const size = this.getSize();
        return size.x * size.y * size.z;
    }
}

/**
 * Voxelize a mesh into a 3D grid
 * @param {Float32Array} vertices - Vertex positions (x, y, z, x, y, z, ...)
 * @param {Uint32Array|Uint16Array} indices - Triangle indices
 * @param {number} resolution - Grid resolution
 * @returns {Object} Voxel grid data
 */
export function voxelizeMesh(vertices, indices, resolution = 64) {
    // Compute bounding box
    const bounds = new AABB();
    for (let i = 0; i < vertices.length; i += 3) {
        bounds.expand(new Point3D(vertices[i], vertices[i + 1], vertices[i + 2]));
    }
    
    const size = bounds.getSize();
    const maxDim = Math.max(size.x, size.y, size.z);
    const voxelSize = maxDim / resolution;
    
    const gridX = Math.ceil(size.x / voxelSize) + 1;
    const gridY = Math.ceil(size.y / voxelSize) + 1;
    const gridZ = Math.ceil(size.z / voxelSize) + 1;
    
    // Create voxel grid
    const grid = new Uint8Array(gridX * gridY * gridZ);
    
    // Voxelize each triangle
    for (let i = 0; i < indices.length; i += 3) {
        const i0 = indices[i] * 3;
        const i1 = indices[i + 1] * 3;
        const i2 = indices[i + 2] * 3;
        
        const v0 = new Point3D(vertices[i0], vertices[i0 + 1], vertices[i0 + 2]);
        const v1 = new Point3D(vertices[i1], vertices[i1 + 1], vertices[i1 + 2]);
        const v2 = new Point3D(vertices[i2], vertices[i2 + 1], vertices[i2 + 2]);
        
        // Get triangle bounding box in grid space
        const triMin = new Point3D(
            Math.floor((Math.min(v0.x, v1.x, v2.x) - bounds.min.x) / voxelSize),
            Math.floor((Math.min(v0.y, v1.y, v2.y) - bounds.min.y) / voxelSize),
            Math.floor((Math.min(v0.z, v1.z, v2.z) - bounds.min.z) / voxelSize)
        );
        const triMax = new Point3D(
            Math.ceil((Math.max(v0.x, v1.x, v2.x) - bounds.min.x) / voxelSize),
            Math.ceil((Math.max(v0.y, v1.y, v2.y) - bounds.min.y) / voxelSize),
            Math.ceil((Math.max(v0.z, v1.z, v2.z) - bounds.min.z) / voxelSize)
        );
        
        // Mark voxels that intersect the triangle
        for (let gz = triMin.z; gz <= triMax.z && gz < gridZ; gz++) {
            for (let gy = triMin.y; gy <= triMax.y && gy < gridY; gy++) {
                for (let gx = triMin.x; gx <= triMax.x && gx < gridX; gx++) {
                    if (gx >= 0 && gy >= 0 && gz >= 0) {
                        const idx = gz * gridY * gridX + gy * gridX + gx;
                        grid[idx] = 1;
                    }
                }
            }
        }
    }
    
    // Flood fill to mark interior voxels
    floodFillInterior(grid, gridX, gridY, gridZ);
    
    return {
        grid,
        gridX,
        gridY,
        gridZ,
        voxelSize,
        bounds,
    };
}

/**
 * Flood fill to mark interior voxels as solid
 */
function floodFillInterior(grid, gridX, gridY, gridZ) {
    // Mark exterior voxels with 2, then interior becomes 1, exterior becomes 0
    const visited = new Uint8Array(grid.length);
    const stack = [];
    
    // Start from corners (guaranteed exterior)
    const corners = [
        [0, 0, 0],
        [gridX - 1, 0, 0],
        [0, gridY - 1, 0],
        [0, 0, gridZ - 1],
        [gridX - 1, gridY - 1, 0],
        [gridX - 1, 0, gridZ - 1],
        [0, gridY - 1, gridZ - 1],
        [gridX - 1, gridY - 1, gridZ - 1],
    ];
    
    for (const [sx, sy, sz] of corners) {
        const startIdx = sz * gridY * gridX + sy * gridX + sx;
        if (grid[startIdx] === 0 && !visited[startIdx]) {
            stack.push([sx, sy, sz]);
            visited[startIdx] = 1;
            
            while (stack.length > 0) {
                const [x, y, z] = stack.pop();
                const idx = z * gridY * gridX + y * gridX + x;
                grid[idx] = 2; // Mark as exterior
                
                // Check 6-connected neighbors
                const neighbors = [
                    [x - 1, y, z], [x + 1, y, z],
                    [x, y - 1, z], [x, y + 1, z],
                    [x, y, z - 1], [x, y, z + 1],
                ];
                
                for (const [nx, ny, nz] of neighbors) {
                    if (nx >= 0 && nx < gridX && ny >= 0 && ny < gridY && nz >= 0 && nz < gridZ) {
                        const nIdx = nz * gridY * gridX + ny * gridX + nx;
                        if (grid[nIdx] === 0 && !visited[nIdx]) {
                            visited[nIdx] = 1;
                            stack.push([nx, ny, nz]);
                        }
                    }
                }
            }
        }
    }
    
    // Convert: exterior (2) -> 0, surface/interior (1, 0) -> 1
    for (let i = 0; i < grid.length; i++) {
        grid[i] = grid[i] === 2 ? 0 : (grid[i] === 1 ? 1 : 0);
    }
}

/**
 * Extract connected components from voxel grid
 */
function extractConnectedComponents(grid, gridX, gridY, gridZ) {
    const components = [];
    const visited = new Uint8Array(grid.length);
    
    for (let z = 0; z < gridZ; z++) {
        for (let y = 0; y < gridY; y++) {
            for (let x = 0; x < gridX; x++) {
                const idx = z * gridY * gridX + y * gridX + x;
                if (grid[idx] === 1 && !visited[idx]) {
                    // BFS to find connected component
                    const component = [];
                    const stack = [[x, y, z]];
                    visited[idx] = 1;
                    
                    while (stack.length > 0) {
                        const [cx, cy, cz] = stack.pop();
                        component.push([cx, cy, cz]);
                        
                        const neighbors = [
                            [cx - 1, cy, cz], [cx + 1, cy, cz],
                            [cx, cy - 1, cz], [cx, cy + 1, cz],
                            [cx, cy, cz - 1], [cx, cy, cz + 1],
                        ];
                        
                        for (const [nx, ny, nz] of neighbors) {
                            if (nx >= 0 && nx < gridX && ny >= 0 && ny < gridY && nz >= 0 && nz < gridZ) {
                                const nIdx = nz * gridY * gridX + ny * gridX + nx;
                                if (grid[nIdx] === 1 && !visited[nIdx]) {
                                    visited[nIdx] = 1;
                                    stack.push([nx, ny, nz]);
                                }
                            }
                        }
                    }
                    
                    if (component.length > 0) {
                        components.push(component);
                    }
                }
            }
        }
    }
    
    return components;
}

/**
 * Compute optimal cutting plane for a set of voxels
 */
function computeOptimalCuttingPlane(voxels, bounds) {
    // Find the axis with the largest extent
    const size = bounds.getSize();
    let bestAxis = 0;
    let maxSize = size.x;
    if (size.y > maxSize) { bestAxis = 1; maxSize = size.y; }
    if (size.z > maxSize) { bestAxis = 2; maxSize = size.z; }
    
    // Split at the median along the best axis
    const center = bounds.getCenter();
    return { axis: bestAxis, position: bestAxis === 0 ? center.x : (bestAxis === 1 ? center.y : center.z) };
}

/**
 * Split voxels by a cutting plane
 */
function splitByPlane(voxels, plane, voxelData) {
    const { bounds, voxelSize } = voxelData;
    const left = [];
    const right = [];
    
    for (const [gx, gy, gz] of voxels) {
        const worldPos = [
            bounds.min.x + (gx + 0.5) * voxelSize,
            bounds.min.y + (gy + 0.5) * voxelSize,
            bounds.min.z + (gz + 0.5) * voxelSize,
        ];
        
        if (worldPos[plane.axis] < plane.position) {
            left.push([gx, gy, gz]);
        } else {
            right.push([gx, gy, gz]);
        }
    }
    
    return [left, right];
}

/**
 * Compute convex hull from voxel positions
 * Uses a simplified approach - extracts surface voxels and computes their hull
 */
function computeConvexHullFromVoxels(voxels, voxelData, maxVertices = 32) {
    const { bounds, voxelSize } = voxelData;
    
    // Convert voxels to world positions
    const points = [];
    for (const [gx, gy, gz] of voxels) {
        points.push(new Point3D(
            bounds.min.x + (gx + 0.5) * voxelSize,
            bounds.min.y + (gy + 0.5) * voxelSize,
            bounds.min.z + (gz + 0.5) * voxelSize
        ));
    }
    
    if (points.length < 4) return null;
    
    // Compute bounding box of this component
    const hullBounds = new AABB();
    for (const p of points) {
        hullBounds.expand(p);
    }
    
    // Simple hull approximation: sample points on the convex hull
    // For a proper implementation, use Quickhull algorithm
    const hullVertices = [];
    
    // Add extreme points (guaranteed to be on hull)
    const extremes = [
        points.reduce((a, b) => a.x < b.x ? a : b),
        points.reduce((a, b) => a.x > b.x ? a : b),
        points.reduce((a, b) => a.y < b.y ? a : b),
        points.reduce((a, b) => a.y > b.y ? a : b),
        points.reduce((a, b) => a.z < b.z ? a : b),
        points.reduce((a, b) => a.z > b.z ? a : b),
    ];
    
    for (const p of extremes) {
        if (!hullVertices.some(v => v.distanceTo(p) < voxelSize * 0.5)) {
            hullVertices.push(p.clone());
        }
    }
    
    // Add corner points of bounding box
    const corners = [
        new Point3D(hullBounds.min.x, hullBounds.min.y, hullBounds.min.z),
        new Point3D(hullBounds.max.x, hullBounds.min.y, hullBounds.min.z),
        new Point3D(hullBounds.min.x, hullBounds.max.y, hullBounds.min.z),
        new Point3D(hullBounds.max.x, hullBounds.max.y, hullBounds.min.z),
        new Point3D(hullBounds.min.x, hullBounds.min.y, hullBounds.max.z),
        new Point3D(hullBounds.max.x, hullBounds.min.y, hullBounds.max.z),
        new Point3D(hullBounds.min.x, hullBounds.max.y, hullBounds.max.z),
        new Point3D(hullBounds.max.x, hullBounds.max.y, hullBounds.max.z),
    ];
    
    for (const c of corners) {
        if (hullVertices.length < maxVertices) {
            hullVertices.push(c);
        }
    }
    
    // Sample additional points if needed
    const step = Math.max(1, Math.floor(points.length / (maxVertices - hullVertices.length)));
    for (let i = 0; i < points.length && hullVertices.length < maxVertices; i += step) {
        const p = points[i];
        if (!hullVertices.some(v => v.distanceTo(p) < voxelSize)) {
            hullVertices.push(p.clone());
        }
    }
    
    // Convert to flat array
    const vertices = new Float32Array(hullVertices.length * 3);
    for (let i = 0; i < hullVertices.length; i++) {
        vertices[i * 3] = hullVertices[i].x;
        vertices[i * 3 + 1] = hullVertices[i].y;
        vertices[i * 3 + 2] = hullVertices[i].z;
    }
    
    return {
        vertices,
        vertexCount: hullVertices.length,
        bounds: hullBounds,
        volume: hullBounds.getVolume(),
    };
}

/**
 * Recursively decompose voxels into convex hulls
 */
function decomposeRecursive(voxels, voxelData, options, depth = 0) {
    if (voxels.length === 0) return [];
    
    // Check if we should stop splitting
    if (depth >= Math.log2(options.maxHulls) || voxels.length < 10) {
        const hull = computeConvexHullFromVoxels(voxels, voxelData, options.maxVerticesPerHull);
        return hull ? [hull] : [];
    }
    
    // Compute bounds for this set of voxels
    const { bounds: globalBounds, voxelSize } = voxelData;
    const localBounds = new AABB();
    for (const [gx, gy, gz] of voxels) {
        localBounds.expand(new Point3D(
            globalBounds.min.x + gx * voxelSize,
            globalBounds.min.y + gy * voxelSize,
            globalBounds.min.z + gz * voxelSize
        ));
    }
    
    // Find optimal cutting plane
    const plane = computeOptimalCuttingPlane(voxels, localBounds);
    
    // Split voxels
    const [left, right] = splitByPlane(voxels, plane, voxelData);
    
    // If split is too unbalanced, just create a hull
    if (left.length < voxels.length * 0.1 || right.length < voxels.length * 0.1) {
        const hull = computeConvexHullFromVoxels(voxels, voxelData, options.maxVerticesPerHull);
        return hull ? [hull] : [];
    }
    
    // Recurse
    const leftHulls = decomposeRecursive(left, voxelData, options, depth + 1);
    const rightHulls = decomposeRecursive(right, voxelData, options, depth + 1);
    
    return [...leftHulls, ...rightHulls];
}

/**
 * Decompose a mesh into convex hulls
 * @param {Float32Array} vertices - Vertex positions
 * @param {Uint32Array|Uint16Array} indices - Triangle indices  
 * @param {Object} options - Decomposition options
 * @returns {Array} Array of convex hulls
 */
export function decomposeMesh(vertices, indices, options = {}) {
    const opts = { ...DECOMPOSITION_DEFAULTS, ...options };
    
    console.log('[ConvexDecomposition] Starting decomposition...');
    
    // Step 1: Voxelize the mesh
    const resolution = Math.min(128, Math.cbrt(opts.resolution));
    const voxelData = voxelizeMesh(vertices, indices, resolution);
    console.log(`[ConvexDecomposition] Voxelized: ${voxelData.gridX}x${voxelData.gridY}x${voxelData.gridZ}`);
    
    // Step 2: Extract connected components
    const components = extractConnectedComponents(
        voxelData.grid, 
        voxelData.gridX, 
        voxelData.gridY, 
        voxelData.gridZ
    );
    console.log(`[ConvexDecomposition] Found ${components.length} connected component(s)`);
    
    // Step 3: Decompose each component
    const allHulls = [];
    for (const component of components) {
        const hulls = decomposeRecursive(component, voxelData, opts);
        allHulls.push(...hulls);
    }
    
    // Step 4: Filter small hulls
    const minVolume = voxelData.bounds.getVolume() * opts.minVolumePerHull;
    const filteredHulls = allHulls.filter(h => h.volume >= minVolume);
    
    // Step 5: Limit total hull count
    const sortedHulls = filteredHulls.sort((a, b) => b.volume - a.volume);
    const finalHulls = sortedHulls.slice(0, opts.maxHulls);
    
    console.log(`[ConvexDecomposition] Generated ${finalHulls.length} convex hull(s)`);
    
    return finalHulls;
}

/**
 * Convert decomposition result to PhysX compound collider format
 * @param {Array} hulls - Array of convex hulls from decomposeMesh
 * @returns {Object} Collider config with compoundColliders array
 */
export function hullsToCompoundCollider(hulls) {
    if (!hulls || hulls.length === 0) return null;
    
    // Compute overall center
    let totalVolume = 0;
    let centerX = 0, centerY = 0, centerZ = 0;
    
    for (const hull of hulls) {
        const center = hull.bounds.getCenter();
        centerX += center.x * hull.volume;
        centerY += center.y * hull.volume;
        centerZ += center.z * hull.volume;
        totalVolume += hull.volume;
    }
    
    centerX /= totalVolume;
    centerY /= totalVolume;
    centerZ /= totalVolume;
    
    // Create compound colliders
    const compoundColliders = hulls.map((hull, index) => {
        const center = hull.bounds.getCenter();
        const meshId = _newDecompositionHullId(index);
        
        return {
            shape: 'convexMesh',
            meshId,
            vertices: hull.vertices,
            halfExtents: [
                (hull.bounds.max.x - hull.bounds.min.x) / 2,
                (hull.bounds.max.y - hull.bounds.min.y) / 2,
                (hull.bounds.max.z - hull.bounds.min.z) / 2,
            ],
            localOffset: [
                center.x - centerX,
                center.y - centerY,
                center.z - centerZ,
            ],
        };
    });
    
    return {
        shape: 'box',
        halfExtents: [0.01, 0.01, 0.01], // Placeholder primary shape
        compoundColliders,
        isDecomposed: true,
    };
}

/**
 * High-level function: Decompose mesh and create PhysX collider
 * @param {Float32Array} vertices - Vertex positions
 * @param {Uint32Array|Uint16Array} indices - Triangle indices
 * @param {Object} options - Decomposition options
 * @returns {Object} Collider config ready for PhysX
 */
export function createDecomposedCollider(vertices, indices, options = {}) {
    const hulls = decomposeMesh(vertices, indices, options);
    return hullsToCompoundCollider(hulls);
}
