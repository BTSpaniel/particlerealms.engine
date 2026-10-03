// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * UnionFind.js - Disjoint Set Union with Path Compression
 * 
 * CPU-side connectivity tracking for incremental voxel updates.
 * While GPU flood-fill is faster for full-chunk analysis,
 * Union-Find excels at incremental updates during gameplay:
 * - Adding a block: Union with neighbors
 * - Removing a block: May need to split components (complex)
 * 
 * Features:
 * - Path compression: O(α(n)) amortized per operation
 * - Union by rank: Keeps trees balanced
 * - Incremental updates: No full recomputation needed
 * - Component tracking: Know sizes and members
 * 
 * Performance Target: <0.1ms per destruction update
 */

// ============================================================================
// UNION-FIND DATA STRUCTURE
// ============================================================================

export class UnionFind {
    /**
     * @param {number} size - Maximum number of elements
     */
    constructor(size) {
        this.size = size;
        
        // Parent array: parent[i] = parent of element i
        // If parent[i] === i, then i is a root
        this.parent = new Uint32Array(size);
        
        // Rank array for union by rank
        this.rank = new Uint8Array(size);
        
        // Component size (only valid at roots)
        this.componentSize = new Uint32Array(size);
        
        // Initialize: each element is its own root
        this.reset();
    }
    
    /**
     * Reset all elements to be their own component
     */
    reset() {
        for (let i = 0; i < this.size; i++) {
            this.parent[i] = i;
            this.rank[i] = 0;
            this.componentSize[i] = 1;
        }
    }
    
    /**
     * Find the root of element x with path compression
     * @param {number} x - Element to find root of
     * @returns {number} Root of x's component
     */
    find(x) {
        if (this.parent[x] !== x) {
            // Path compression: make all nodes point directly to root
            this.parent[x] = this.find(this.parent[x]);
        }
        return this.parent[x];
    }
    
    /**
     * Union two components by rank
     * @param {number} x - First element
     * @param {number} y - Second element
     * @returns {boolean} True if union occurred (were different components)
     */
    union(x, y) {
        const rootX = this.find(x);
        const rootY = this.find(y);
        
        // Already in same component
        if (rootX === rootY) {
            return false;
        }
        
        // Union by rank: attach smaller tree under larger
        if (this.rank[rootX] < this.rank[rootY]) {
            this.parent[rootX] = rootY;
            this.componentSize[rootY] += this.componentSize[rootX];
        } else if (this.rank[rootX] > this.rank[rootY]) {
            this.parent[rootY] = rootX;
            this.componentSize[rootX] += this.componentSize[rootY];
        } else {
            // Same rank: arbitrarily choose rootX as new root
            this.parent[rootY] = rootX;
            this.componentSize[rootX] += this.componentSize[rootY];
            this.rank[rootX]++;
        }
        
        return true;
    }
    
    /**
     * Check if two elements are in the same component
     * @param {number} x 
     * @param {number} y 
     * @returns {boolean}
     */
    connected(x, y) {
        return this.find(x) === this.find(y);
    }
    
    /**
     * Get the size of the component containing x
     * @param {number} x 
     * @returns {number}
     */
    getComponentSize(x) {
        return this.componentSize[this.find(x)];
    }
    
    /**
     * Get all unique component roots
     * @returns {Set<number>}
     */
    getRoots() {
        const roots = new Set();
        for (let i = 0; i < this.size; i++) {
            roots.add(this.find(i));
        }
        return roots;
    }
    
    /**
     * Get number of distinct components
     * @returns {number}
     */
    getComponentCount() {
        return this.getRoots().size;
    }
    
    /**
     * Get all elements in the same component as x
     * @param {number} x 
     * @returns {number[]}
     */
    getComponentMembers(x) {
        const root = this.find(x);
        const members = [];
        for (let i = 0; i < this.size; i++) {
            if (this.find(i) === root) {
                members.push(i);
            }
        }
        return members;
    }
}

// ============================================================================
// VOXEL-AWARE UNION-FIND
// ============================================================================

/**
 * Union-Find specialized for 3D voxel grids
 */
export class VoxelUnionFind extends UnionFind {
    /**
     * @param {number} gridSize - Size of cubic grid (e.g., 32 for 32³)
     */
    constructor(gridSize) {
        super(gridSize * gridSize * gridSize);
        this.gridSize = gridSize;
        
        // Track which indices are solid (vs empty)
        this.solid = new Uint8Array(this.size);
        
        // Special anchor component ID
        this.anchorRoot = -1;
    }
    
    /**
     * Convert 3D position to linear index
     */
    posToIndex(x, y, z) {
        return x + y * this.gridSize + z * this.gridSize * this.gridSize;
    }
    
    /**
     * Convert linear index to 3D position
     */
    indexToPos(idx) {
        const z = Math.floor(idx / (this.gridSize * this.gridSize));
        const rem = idx % (this.gridSize * this.gridSize);
        const y = Math.floor(rem / this.gridSize);
        const x = rem % this.gridSize;
        return [x, y, z];
    }
    
    /**
     * Check if position is within grid bounds
     */
    isValid(x, y, z) {
        return x >= 0 && x < this.gridSize &&
               y >= 0 && y < this.gridSize &&
               z >= 0 && z < this.gridSize;
    }
    
    /**
     * Get 6-connected neighbor indices
     */
    getNeighbors(x, y, z) {
        const neighbors = [];
        const offsets = [
            [-1, 0, 0], [1, 0, 0],
            [0, -1, 0], [0, 1, 0],
            [0, 0, -1], [0, 0, 1],
        ];
        
        for (const [dx, dy, dz] of offsets) {
            const nx = x + dx;
            const ny = y + dy;
            const nz = z + dz;
            
            if (this.isValid(nx, ny, nz)) {
                neighbors.push(this.posToIndex(nx, ny, nz));
            }
        }
        
        return neighbors;
    }
    
    /**
     * Initialize from voxel data array
     * @param {Uint8Array} voxelData - 1 = solid, 0 = empty
     * @param {Function} isAnchor - (x,y,z) => bool, determines anchor voxels
     */
    initFromVoxels(voxelData, isAnchor = (x, y, z) => y === 0) {
        this.reset();
        
        // First pass: mark solid voxels and find an anchor
        for (let z = 0; z < this.gridSize; z++) {
            for (let y = 0; y < this.gridSize; y++) {
                for (let x = 0; x < this.gridSize; x++) {
                    const idx = this.posToIndex(x, y, z);
                    this.solid[idx] = voxelData[idx] ? 1 : 0;
                    
                    // Track first anchor as reference
                    if (this.solid[idx] && isAnchor(x, y, z) && this.anchorRoot === -1) {
                        this.anchorRoot = idx;
                    }
                }
            }
        }
        
        // Second pass: union adjacent solid voxels
        for (let z = 0; z < this.gridSize; z++) {
            for (let y = 0; y < this.gridSize; y++) {
                for (let x = 0; x < this.gridSize; x++) {
                    const idx = this.posToIndex(x, y, z);
                    
                    if (!this.solid[idx]) continue;
                    
                    // Union with solid neighbors
                    for (const neighborIdx of this.getNeighbors(x, y, z)) {
                        if (this.solid[neighborIdx]) {
                            this.union(idx, neighborIdx);
                        }
                    }
                    
                    // If this is an anchor, union with anchor root
                    if (isAnchor(x, y, z) && this.anchorRoot !== -1) {
                        this.union(idx, this.anchorRoot);
                    }
                }
            }
        }
    }
    
    /**
     * Add a voxel and update connectivity
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     * @param {boolean} isAnchor - Is this voxel an anchor point?
     */
    addVoxel(x, y, z, isAnchor = false) {
        const idx = this.posToIndex(x, y, z);
        
        if (this.solid[idx]) return; // Already solid
        
        this.solid[idx] = 1;
        
        // Union with solid neighbors
        for (const neighborIdx of this.getNeighbors(x, y, z)) {
            if (this.solid[neighborIdx]) {
                this.union(idx, neighborIdx);
            }
        }
        
        // Union with anchor if applicable
        if (isAnchor && this.anchorRoot !== -1) {
            this.union(idx, this.anchorRoot);
        }
    }
    
    /**
     * Remove a voxel - NOTE: This may require recomputation
     * Union-Find doesn't support efficient splits
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     * @returns {boolean} True if recomputation is needed
     */
    removeVoxel(x, y, z) {
        const idx = this.posToIndex(x, y, z);
        
        if (!this.solid[idx]) return false; // Already empty
        
        this.solid[idx] = 0;
        
        // Count solid neighbors
        let solidNeighborCount = 0;
        for (const neighborIdx of this.getNeighbors(x, y, z)) {
            if (this.solid[neighborIdx]) {
                solidNeighborCount++;
            }
        }
        
        // If removed voxel had multiple solid neighbors,
        // they might now be disconnected - need recompute
        return solidNeighborCount > 1;
    }
    
    /**
     * Check if a voxel is connected to anchor
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     * @returns {boolean}
     */
    isAnchored(x, y, z) {
        const idx = this.posToIndex(x, y, z);
        
        if (!this.solid[idx] || this.anchorRoot === -1) {
            return false;
        }
        
        return this.find(idx) === this.find(this.anchorRoot);
    }
    
    /**
     * Get all floating (unanchored) voxel indices
     * @returns {number[]}
     */
    getFloatingVoxels() {
        const floating = [];
        
        if (this.anchorRoot === -1) {
            // No anchor - all solid voxels are floating
            for (let i = 0; i < this.size; i++) {
                if (this.solid[i]) {
                    floating.push(i);
                }
            }
            return floating;
        }
        
        const anchorRootId = this.find(this.anchorRoot);
        
        for (let i = 0; i < this.size; i++) {
            if (this.solid[i] && this.find(i) !== anchorRootId) {
                floating.push(i);
            }
        }
        
        return floating;
    }
    
    /**
     * Get floating components as separate groups
     * @returns {Map<number, number[]>} root -> indices
     */
    getFloatingComponents() {
        const components = new Map();
        
        if (this.anchorRoot === -1) return components;
        
        const anchorRootId = this.find(this.anchorRoot);
        
        for (let i = 0; i < this.size; i++) {
            if (!this.solid[i]) continue;
            
            const root = this.find(i);
            if (root === anchorRootId) continue;
            
            if (!components.has(root)) {
                components.set(root, []);
            }
            components.get(root).push(i);
        }
        
        return components;
    }
    
    /**
     * Recompute connectivity from scratch
     * Call this after removeVoxel returns true
     * @param {Function} isAnchor 
     */
    recompute(isAnchor = (x, y, z) => y === 0) {
        // Save solid state
        const solidCopy = this.solid.slice();
        
        // Reset and rebuild
        this.reset();
        this.anchorRoot = -1;
        this.solid.set(solidCopy);
        
        // First pass: find anchor root
        for (let z = 0; z < this.gridSize; z++) {
            for (let y = 0; y < this.gridSize; y++) {
                for (let x = 0; x < this.gridSize; x++) {
                    const idx = this.posToIndex(x, y, z);
                    if (this.solid[idx] && isAnchor(x, y, z)) {
                        if (this.anchorRoot === -1) {
                            this.anchorRoot = idx;
                        }
                        break;
                    }
                }
            }
        }
        
        // Second pass: rebuild unions
        for (let z = 0; z < this.gridSize; z++) {
            for (let y = 0; y < this.gridSize; y++) {
                for (let x = 0; x < this.gridSize; x++) {
                    const idx = this.posToIndex(x, y, z);
                    if (!this.solid[idx]) continue;
                    
                    // Union with neighbors
                    for (const neighborIdx of this.getNeighbors(x, y, z)) {
                        if (this.solid[neighborIdx]) {
                            this.union(idx, neighborIdx);
                        }
                    }
                    
                    // Union anchors
                    if (isAnchor(x, y, z) && this.anchorRoot !== -1) {
                        this.union(idx, this.anchorRoot);
                    }
                }
            }
        }
    }
}

// ============================================================================
// HYBRID GPU/CPU CONNECTIVITY
// ============================================================================

/**
 * Combines GPU flood-fill for initial/full recomputes
 * with CPU Union-Find for incremental updates
 */
export class HybridConnectivity {
    /**
     * @param {GPUDevice} device 
     * @param {number} gridSize 
     */
    constructor(device, gridSize) {
        this.device = device;
        this.gridSize = gridSize;
        
        // CPU Union-Find for incremental updates
        this.unionFind = new VoxelUnionFind(gridSize);
        
        // GPU compute will be initialized lazily
        this.gpuCompute = null;
        
        // Track pending changes
        this.pendingRemovals = [];
        this.needsFullRecompute = false;
    }
    
    /**
     * Initialize from voxel data
     * @param {Uint8Array} voxelData 
     * @param {Function} isAnchor 
     */
    initialize(voxelData, isAnchor) {
        this.unionFind.initFromVoxels(voxelData, isAnchor);
        this.needsFullRecompute = false;
        this.pendingRemovals = [];
    }
    
    /**
     * Add a voxel (fast incremental)
     */
    addVoxel(x, y, z, isAnchor = false) {
        this.unionFind.addVoxel(x, y, z, isAnchor);
    }
    
    /**
     * Remove a voxel (may trigger recompute)
     */
    removeVoxel(x, y, z) {
        const needsRecompute = this.unionFind.removeVoxel(x, y, z);
        if (needsRecompute) {
            this.pendingRemovals.push([x, y, z]);
            this.needsFullRecompute = true;
        }
    }
    
    /**
     * Process any pending recomputes
     * @param {Function} isAnchor 
     */
    update(isAnchor) {
        if (this.needsFullRecompute) {
            this.unionFind.recompute(isAnchor);
            this.needsFullRecompute = false;
            this.pendingRemovals = [];
        }
    }
    
    /**
     * Check if voxel is anchored
     */
    isAnchored(x, y, z) {
        return this.unionFind.isAnchored(x, y, z);
    }
    
    /**
     * Get floating voxels
     */
    getFloatingVoxels() {
        return this.unionFind.getFloatingVoxels();
    }
    
    /**
     * Get floating components
     */
    getFloatingComponents() {
        return this.unionFind.getFloatingComponents();
    }
}

export default UnionFind;
