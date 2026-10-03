/**
 * AutoTetMesh.js — Automatic surface mesh → tetrahedral mesh → GPUSoftBody bridge
 *
 * One-call pipeline: give it a triangle mesh, get back a soft body.
 *
 * Pipeline:
 *   1. Validate + repair mesh (MeshOps.validateMesh)
 *   2. Optionally decimate for performance (MeshDecimation)
 *   3. Tetrahedralize (MeshTetrahedralize)
 *   4. Quality check + optimization
 *   5. Create GPUSoftBody instance
 *
 * Compatible with:
 *   - GPUSoftBody.createSoftBody() — exact format match
 *   - MeshDecimation.js — LOD before tet generation
 *   - EntityMeshRenderer — visual mesh binding
 *   - MeshTetrahedralize.js — Delaunay + grid methods
 */

import { tetrahedralize, tetrahedralizeGrid, computeTetQuality, extractTetSurface } from '../ops/mesh/MeshTetrahedralize.js';
import { validateMesh, computeBoundingBox, computeSurfaceArea, laplacianSmooth } from '../ops/mesh/MeshOps.js';
import { loopSubdivide } from '../ops/mesh/MeshSubdivision.js';

// ============================================================================
// AUTO TET MESH
// ============================================================================

/**
 * Full pipeline: surface mesh → tet mesh ready for GPUSoftBody.
 *
 * @param {Float32Array} positions — surface mesh vertices (stride 3)
 * @param {Uint32Array}  indices   — surface mesh triangles (stride 3)
 * @param {Object}       options
 * @param {string}       options.method      — 'delaunay' | 'grid' (default 'grid' for speed)
 * @param {number}       options.gridRes     — grid resolution for grid method (default 6)
 * @param {number}       options.interiorDensity — interior points per unit volume for delaunay (default 8)
 * @param {number}       options.maxNodes    — hard cap on node count (default 8000)
 * @param {number}       options.maxTets     — hard cap on tet count (default 20000)
 * @param {boolean}      options.validate    — run validation first (default true)
 * @param {boolean}      options.smooth      — smooth surface before tet gen (default false)
 * @param {number}       options.smoothIter  — Laplacian smooth iterations (default 2)
 * @param {boolean}      options.optimize    — optimize tet quality (default true)
 * @param {Set}          options.pinnedNodes — indices to pin (default null)
 * @param {string}       options.pinMode     — 'none' | 'bottom' | 'top' | 'custom' (default 'none')
 * @param {number}       options.pinThreshold — fraction of bbox height for auto-pin (default 0.05)
 * @returns {{ nodePositions: Float32Array, tetIndices: Uint32Array, surfaceIndices: Uint32Array,
 *             quality: { min: number, max: number, mean: number }, pinnedNodes: Set<number>,
 *             stats: Object } | null}
 */
export function autoTetMesh(positions, indices, options = {}) {
    const method = options.method ?? 'grid';
    const gridRes = options.gridRes ?? 6;
    const maxNodes = options.maxNodes ?? 8000;
    const maxTets = options.maxTets ?? 20000;
    const shouldValidate = options.validate ?? true;
    const shouldSmooth = options.smooth ?? false;
    const smoothIter = options.smoothIter ?? 2;
    const shouldOptimize = options.optimize ?? true;
    const pinMode = options.pinMode ?? 'none';
    const pinThreshold = options.pinThreshold ?? 0.05;

    let pos = new Float32Array(positions);
    let idx = new Uint32Array(indices);

    // Step 1: Validate
    if (shouldValidate) {
        const report = validateMesh(pos, idx);
        if (!report.valid) {
            // Try to clean up
            const cleaned = _cleanMesh(pos, idx, report);
            if (!cleaned) {
                console.warn('[AutoTetMesh] Mesh validation failed and could not be repaired');
                return null;
            }
            pos = cleaned.positions;
            idx = cleaned.indices;
        }
    }

    // Step 2: Optional smoothing
    if (shouldSmooth) {
        pos = laplacianSmooth(new Float32Array(pos), idx, smoothIter, 0.3);
    }

    // Step 3: Tetrahedralize
    let result;
    if (method === 'delaunay') {
        result = tetrahedralize(pos, idx, {
            interiorDensity: options.interiorDensity ?? 8,
        });
    } else {
        result = tetrahedralizeGrid(pos, idx, gridRes);
    }

    if (!result || !result.nodePositions || result.nodePositions.length === 0) {
        console.warn('[AutoTetMesh] Tetrahedralization produced no output');
        return null;
    }

    let { nodePositions, tetIndices } = result;

    // Step 4: Check limits
    const numNodes = (nodePositions.length / 3) | 0;
    const numTets = (tetIndices.length / 4) | 0;

    if (numNodes > maxNodes || numTets > maxTets) {
        // Try grid method with lower resolution
        if (method !== 'grid' || gridRes > 3) {
            const lowerRes = Math.max(3, gridRes - 2);
            result = tetrahedralizeGrid(pos, idx, lowerRes);
            if (result) {
                nodePositions = result.nodePositions;
                tetIndices = result.tetIndices;
            }
        }
    }

    // Step 5: Quality assessment
    const quality = computeTetQuality(nodePositions, tetIndices);

    // Step 6: Optimize bad tets (simple: smooth interior nodes)
    if (shouldOptimize && quality.mean > 3.0) {
        _optimizeTetMesh(nodePositions, tetIndices, 3);
    }

    // Step 7: Extract surface for rendering
    const surfaceIndices = extractTetSurface(tetIndices);

    // Step 8: Auto-pin nodes
    const pinnedNodes = options.pinnedNodes ?? _autoPinNodes(nodePositions, pinMode, pinThreshold);

    // Stats
    const finalNodes = (nodePositions.length / 3) | 0;
    const finalTets = (tetIndices.length / 4) | 0;
    const bbox = computeBoundingBox(nodePositions);

    return {
        nodePositions,
        tetIndices,
        surfaceIndices,
        quality,
        pinnedNodes,
        stats: {
            nodeCount: finalNodes,
            tetCount: finalTets,
            surfaceTriCount: (surfaceIndices.length / 3) | 0,
            pinnedCount: pinnedNodes.size,
            bbox,
            method,
        },
    };
}


// ============================================================================
// GPUSoftBody BRIDGE
// ============================================================================

/**
 * Create a GPUSoftBody from a surface mesh in one call.
 *
 * @param {GPUSoftBody}   softBodySystem — initialized GPUSoftBody instance
 * @param {Float32Array}  positions — surface mesh vertices
 * @param {Uint32Array}   indices   — surface mesh triangles
 * @param {number|string} material  — material index or preset name
 * @param {Object}        options   — passed to autoTetMesh + createSoftBody
 * @returns {{ handle: Object, tetResult: Object } | null}
 */
export function createSoftBodyFromMesh(softBodySystem, positions, indices, material = 'rubber', options = {}) {
    // Add material if it's a string preset
    let materialIdx;
    if (typeof material === 'string') {
        materialIdx = softBodySystem.addMaterial(material);
    } else {
        materialIdx = material;
    }

    // Generate tet mesh
    const tetResult = autoTetMesh(positions, indices, options);
    if (!tetResult) return null;

    // Create the soft body
    const handle = softBodySystem.createSoftBody(
        tetResult.nodePositions,
        tetResult.tetIndices,
        materialIdx,
        {
            invMass: options.invMass ?? 1.0,
            pinnedNodes: tetResult.pinnedNodes,
        }
    );

    if (!handle) return null;

    return {
        handle,
        tetResult,
    };
}


/**
 * Batch-create multiple soft bodies from meshes.
 *
 * @param {GPUSoftBody} softBodySystem
 * @param {Array}       meshes — [{ positions, indices, material, options }]
 * @returns {Array} — [{ handle, tetResult } | null]
 */
export function createSoftBodiesBatch(softBodySystem, meshes) {
    return meshes.map(m =>
        createSoftBodyFromMesh(
            softBodySystem,
            m.positions, m.indices,
            m.material ?? 'rubber',
            m.options ?? {}
        )
    );
}


// ============================================================================
// MESH QUALITY PRESETS
// ============================================================================

/**
 * Preset configurations for different use cases.
 */
export const TET_PRESETS = {
    /** Fast preview — minimal quality, maximum speed */
    preview: {
        method: 'grid',
        gridRes: 3,
        validate: false,
        optimize: false,
        maxNodes: 2000,
        maxTets: 5000,
    },

    /** Balanced — good quality, reasonable speed */
    balanced: {
        method: 'grid',
        gridRes: 6,
        validate: true,
        optimize: true,
        maxNodes: 8000,
        maxTets: 20000,
    },

    /** High quality — best tet quality, slower */
    quality: {
        method: 'delaunay',
        interiorDensity: 12,
        validate: true,
        optimize: true,
        smooth: true,
        smoothIter: 3,
        maxNodes: 16000,
        maxTets: 32000,
    },

    /** Character — optimized for character bodies */
    character: {
        method: 'grid',
        gridRes: 5,
        validate: true,
        optimize: true,
        pinMode: 'none',
        maxNodes: 4000,
        maxTets: 10000,
    },

    /** Destructible — for fracture/destruction objects */
    destructible: {
        method: 'grid',
        gridRes: 4,
        validate: true,
        optimize: false,
        pinMode: 'bottom',
        pinThreshold: 0.1,
        maxNodes: 3000,
        maxTets: 8000,
    },
};


// ============================================================================
// LOD GENERATION
// ============================================================================

/**
 * Generate multiple LOD levels of tet meshes from a single surface mesh.
 *
 * @param {Float32Array} positions
 * @param {Uint32Array}  indices
 * @param {number[]}     gridResolutions — e.g. [8, 5, 3]
 * @returns {Array} — array of autoTetMesh results, one per LOD
 */
export function generateTetLODs(positions, indices, gridResolutions = [8, 5, 3]) {
    return gridResolutions.map(res =>
        autoTetMesh(positions, indices, { method: 'grid', gridRes: res })
    );
}


// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Clean a mesh by removing degenerate triangles and isolated vertices.
 */
function _cleanMesh(positions, indices, report) {
    const numVerts = (positions.length / 3) | 0;
    const numFaces = (indices.length / 3) | 0;

    // Remove degenerate triangles
    const goodFaces = [];
    for (let f = 0; f < numFaces; f++) {
        const i0 = indices[f * 3], i1 = indices[f * 3 + 1], i2 = indices[f * 3 + 2];

        // Skip out-of-range
        if (i0 >= numVerts || i1 >= numVerts || i2 >= numVerts) continue;
        // Skip degenerate
        if (i0 === i1 || i1 === i2 || i0 === i2) continue;

        // Skip zero-area
        const p0 = i0 * 3, p1 = i1 * 3, p2 = i2 * 3;
        const e1x = positions[p1] - positions[p0];
        const e1y = positions[p1 + 1] - positions[p0 + 1];
        const e1z = positions[p1 + 2] - positions[p0 + 2];
        const e2x = positions[p2] - positions[p0];
        const e2y = positions[p2 + 1] - positions[p0 + 1];
        const e2z = positions[p2 + 2] - positions[p0 + 2];
        const cx = e1y * e2z - e1z * e2y;
        const cy = e1z * e2x - e1x * e2z;
        const cz = e1x * e2y - e1y * e2x;
        if (cx * cx + cy * cy + cz * cz < 1e-12) continue;

        goodFaces.push(i0, i1, i2);
    }

    if (goodFaces.length < 12) return null; // need at least 4 triangles

    return {
        positions: new Float32Array(positions),
        indices: new Uint32Array(goodFaces),
    };
}

/**
 * Simple Laplacian smoothing of interior tet nodes to improve quality.
 */
function _optimizeTetMesh(nodePositions, tetIndices, iterations) {
    const numNodes = (nodePositions.length / 3) | 0;
    const numTets = (tetIndices.length / 4) | 0;

    // Build adjacency: node → connected nodes (through tets)
    const adj = new Array(numNodes);
    for (let i = 0; i < numNodes; i++) adj[i] = new Set();

    for (let t = 0; t < numTets; t++) {
        const base = t * 4;
        const v = [tetIndices[base], tetIndices[base + 1], tetIndices[base + 2], tetIndices[base + 3]];
        for (let i = 0; i < 4; i++) {
            for (let j = i + 1; j < 4; j++) {
                adj[v[i]].add(v[j]);
                adj[v[j]].add(v[i]);
            }
        }
    }

    // Identify surface nodes (shared by boundary faces)
    const surfaceFaces = extractTetSurface(tetIndices);
    const surfaceNodes = new Set();
    for (let i = 0; i < surfaceFaces.length; i++) {
        surfaceNodes.add(surfaceFaces[i]);
    }

    // Smooth only interior nodes
    const temp = new Float32Array(nodePositions.length);
    const lambda = 0.3;

    for (let iter = 0; iter < iterations; iter++) {
        temp.set(nodePositions);

        for (let v = 0; v < numNodes; v++) {
            if (surfaceNodes.has(v)) continue; // don't move surface nodes

            const neighbors = adj[v];
            if (neighbors.size === 0) continue;

            let cx = 0, cy = 0, cz = 0;
            for (const n of neighbors) {
                cx += temp[n * 3];
                cy += temp[n * 3 + 1];
                cz += temp[n * 3 + 2];
            }
            const inv = 1 / neighbors.size;
            cx *= inv; cy *= inv; cz *= inv;

            nodePositions[v * 3]     = temp[v * 3]     + lambda * (cx - temp[v * 3]);
            nodePositions[v * 3 + 1] = temp[v * 3 + 1] + lambda * (cy - temp[v * 3 + 1]);
            nodePositions[v * 3 + 2] = temp[v * 3 + 2] + lambda * (cz - temp[v * 3 + 2]);
        }
    }
}

/**
 * Auto-pin nodes based on position relative to bounding box.
 */
function _autoPinNodes(nodePositions, pinMode, threshold) {
    const pinned = new Set();
    if (pinMode === 'none' || pinMode === 'custom') return pinned;

    const numNodes = (nodePositions.length / 3) | 0;
    const bbox = computeBoundingBox(nodePositions);
    const height = bbox.size[1];
    const cutoff = height * threshold;

    for (let i = 0; i < numNodes; i++) {
        const y = nodePositions[i * 3 + 1];
        if (pinMode === 'bottom' && y <= bbox.min[1] + cutoff) {
            pinned.add(i);
        } else if (pinMode === 'top' && y >= bbox.max[1] - cutoff) {
            pinned.add(i);
        }
    }

    return pinned;
}
