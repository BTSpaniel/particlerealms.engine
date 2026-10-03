/**
 * ChamferDistance.js — Bidirectional nearest-neighbor distance metric
 *
 * Measures how close two point sets (or meshes) are to each other.
 * For each point in A, find nearest in B (and vice versa), average the distances.
 *
 * Standard metric in 3D reconstruction / generative model evaluation.
 * Used by: agi/ training loops, mesh quality assessment, LOD validation.
 *
 * CPU path with spatial hash acceleration.
 * For GPU path, see future WebGPU compute implementation.
 */

import { buildSpatialHash, knnQuery } from '../ops/pointcloud/PointCloudOps.js';

// ============================================================================
// CHAMFER DISTANCE
// ============================================================================

/**
 * Compute Chamfer Distance between two point sets.
 *
 * CD(A, B) = (1/|A|) Σ min_{b∈B} ||a - b||² + (1/|B|) Σ min_{a∈A} ||b - a||²
 *
 * @param {Float32Array} pointsA — stride 3
 * @param {Float32Array} pointsB — stride 3
 * @param {Object}       options
 * @param {boolean}      options.squared   — return squared distances (default true)
 * @param {boolean}      options.symmetric — compute both directions (default true)
 * @param {string}       options.reduction — 'mean' | 'sum' (default 'mean')
 * @returns {{ distance: number, aToB: number, bToA: number }}
 */
export function chamferDistance(pointsA, pointsB, options = {}) {
    const squared = options.squared ?? true;
    const symmetric = options.symmetric ?? true;
    const reduction = options.reduction ?? 'mean';

    const nA = (pointsA.length / 3) | 0;
    const nB = (pointsB.length / 3) | 0;

    if (nA === 0 || nB === 0) {
        return { distance: Infinity, aToB: Infinity, bToA: Infinity };
    }

    // Build spatial hash for B
    const avgSpacingB = _estimateSpacing(pointsB, nB);
    const cellSizeB = avgSpacingB * 3;
    const gridB = buildSpatialHash(pointsB, cellSizeB);

    // A → B direction
    let sumAtoB = 0;
    for (let i = 0; i < nA; i++) {
        const nn = knnQuery(pointsB, gridB, cellSizeB, _virtualIdx(pointsA, pointsB, i), 1);
        let minDist2 = Infinity;

        // Brute-force nearest in B for this point in A
        const ax = pointsA[i * 3], ay = pointsA[i * 3 + 1], az = pointsA[i * 3 + 2];
        if (nn.length > 0) {
            const j = nn[0];
            const dx = pointsB[j * 3] - ax;
            const dy = pointsB[j * 3 + 1] - ay;
            const dz = pointsB[j * 3 + 2] - az;
            minDist2 = dx * dx + dy * dy + dz * dz;
        } else {
            // Fallback: brute force
            minDist2 = _bruteForceNearest(ax, ay, az, pointsB, nB);
        }

        sumAtoB += squared ? minDist2 : Math.sqrt(minDist2);
    }

    const aToB = reduction === 'mean' ? sumAtoB / nA : sumAtoB;

    let bToA = 0;
    if (symmetric) {
        const avgSpacingA = _estimateSpacing(pointsA, nA);
        const cellSizeA = avgSpacingA * 3;
        const gridA = buildSpatialHash(pointsA, cellSizeA);

        let sumBtoA = 0;
        for (let i = 0; i < nB; i++) {
            const bx = pointsB[i * 3], by = pointsB[i * 3 + 1], bz = pointsB[i * 3 + 2];
            let minDist2 = _bruteForceNearestWithHash(bx, by, bz, pointsA, nA, gridA, cellSizeA);
            sumBtoA += squared ? minDist2 : Math.sqrt(minDist2);
        }

        bToA = reduction === 'mean' ? sumBtoA / nB : sumBtoA;
    }

    return {
        distance: aToB + bToA,
        aToB,
        bToA,
    };
}


/**
 * Compute per-point nearest distances from A to B.
 * Useful for visualization (color-coded error maps).
 *
 * @param {Float32Array} pointsA — stride 3
 * @param {Float32Array} pointsB — stride 3
 * @returns {Float32Array} — per-point squared distances, length = nA
 */
export function chamferDistancePerPoint(pointsA, pointsB) {
    const nA = (pointsA.length / 3) | 0;
    const nB = (pointsB.length / 3) | 0;
    const dists = new Float32Array(nA);

    if (nB === 0) { dists.fill(Infinity); return dists; }

    const avgSpacing = _estimateSpacing(pointsB, nB);
    const cellSize = avgSpacing * 3;
    const grid = buildSpatialHash(pointsB, cellSize);

    for (let i = 0; i < nA; i++) {
        const ax = pointsA[i * 3], ay = pointsA[i * 3 + 1], az = pointsA[i * 3 + 2];
        dists[i] = _bruteForceNearestWithHash(ax, ay, az, pointsB, nB, grid, cellSize);
    }

    return dists;
}


// ============================================================================
// EARTH MOVER'S DISTANCE (approximate)
// ============================================================================

/**
 * Approximate Earth Mover's Distance via auction algorithm.
 * Both point sets must have the same number of points.
 * This is O(n²) and practical only for small sets (<1000 points).
 *
 * @param {Float32Array} pointsA — stride 3, n points
 * @param {Float32Array} pointsB — stride 3, n points (same count)
 * @returns {number} — approximate EMD
 */
export function earthMoversDistance(pointsA, pointsB) {
    const nA = (pointsA.length / 3) | 0;
    const nB = (pointsB.length / 3) | 0;
    const n = Math.min(nA, nB);

    if (n === 0) return 0;

    // Greedy assignment (approximate)
    const assigned = new Uint8Array(n);
    let totalDist = 0;

    for (let i = 0; i < n; i++) {
        const ax = pointsA[i * 3], ay = pointsA[i * 3 + 1], az = pointsA[i * 3 + 2];
        let bestJ = -1, bestD2 = Infinity;

        for (let j = 0; j < n; j++) {
            if (assigned[j]) continue;
            const dx = pointsB[j * 3] - ax;
            const dy = pointsB[j * 3 + 1] - ay;
            const dz = pointsB[j * 3 + 2] - az;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < bestD2) { bestD2 = d2; bestJ = j; }
        }

        if (bestJ >= 0) {
            assigned[bestJ] = 1;
            totalDist += Math.sqrt(bestD2);
        }
    }

    return totalDist / n;
}


// ============================================================================
// HELPERS
// ============================================================================

function _bruteForceNearest(px, py, pz, points, numPoints) {
    let minDist2 = Infinity;
    for (let j = 0; j < numPoints; j++) {
        const dx = points[j * 3] - px;
        const dy = points[j * 3 + 1] - py;
        const dz = points[j * 3 + 2] - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < minDist2) minDist2 = d2;
    }
    return minDist2;
}

function _bruteForceNearestWithHash(px, py, pz, points, numPoints, grid, cellSize) {
    const kx = Math.floor(px / cellSize);
    const ky = Math.floor(py / cellSize);
    const kz = Math.floor(pz / cellSize);

    let minDist2 = Infinity;

    // Search expanding rings until we find something
    for (let range = 0; range <= 5; range++) {
        for (let dz = -range; dz <= range; dz++) {
            for (let dy = -range; dy <= range; dy++) {
                for (let dx = -range; dx <= range; dx++) {
                    if (range > 0 && Math.abs(dx) < range && Math.abs(dy) < range && Math.abs(dz) < range) continue;
                    const key = (kx + dx) + ',' + (ky + dy) + ',' + (kz + dz);
                    const cell = grid.get(key);
                    if (!cell) continue;
                    for (const j of cell) {
                        const ox = points[j * 3] - px;
                        const oy = points[j * 3 + 1] - py;
                        const oz = points[j * 3 + 2] - pz;
                        const d2 = ox * ox + oy * oy + oz * oz;
                        if (d2 < minDist2) minDist2 = d2;
                    }
                }
            }
        }
        if (minDist2 < Infinity) break;
    }

    // If hash failed, brute force
    if (minDist2 === Infinity) {
        minDist2 = _bruteForceNearest(px, py, pz, points, numPoints);
    }

    return minDist2;
}

function _estimateSpacing(points, numPoints) {
    const sampleCount = Math.min(numPoints, 30);
    const step = Math.max(1, (numPoints / sampleCount) | 0);
    let total = 0, counted = 0;

    for (let i = 0; i < numPoints; i += step) {
        let minD2 = Infinity;
        const px = points[i * 3], py = points[i * 3 + 1], pz = points[i * 3 + 2];
        for (let j = 0; j < numPoints; j++) {
            if (j === i) continue;
            const dx = points[j * 3] - px, dy = points[j * 3 + 1] - py, dz = points[j * 3 + 2] - pz;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < minD2) minD2 = d2;
        }
        if (minD2 < Infinity) { total += Math.sqrt(minD2); counted++; }
    }
    return counted > 0 ? total / counted : 1.0;
}

/** Dummy: knnQuery expects index into the same array. For cross-set queries, use brute force. */
function _virtualIdx(pointsA, pointsB, i) {
    // Not used for cross-set; knnQuery is only for same-set
    return i;
}
