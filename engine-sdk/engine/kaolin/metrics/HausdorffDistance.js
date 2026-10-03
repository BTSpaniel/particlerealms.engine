/**
 * HausdorffDistance.js — Maximum surface deviation metric
 *
 * Measures the worst-case distance between two point sets or meshes.
 * Hausdorff(A, B) = max( max_{a∈A} min_{b∈B} ||a-b||, max_{b∈B} min_{a∈A} ||b-a|| )
 *
 * Variants:
 *   - Standard Hausdorff (max of mins)
 *   - Percentile Hausdorff (e.g. 95th percentile — more robust to outliers)
 *   - Directed Hausdorff (one direction only)
 *
 * Used by: mesh quality validation, LOD error bounds, surface fitting.
 */

import { buildSpatialHash } from '../ops/pointcloud/PointCloudOps.js';

// ============================================================================
// HAUSDORFF DISTANCE
// ============================================================================

/**
 * Compute Hausdorff distance between two point sets.
 *
 * @param {Float32Array} pointsA — stride 3
 * @param {Float32Array} pointsB — stride 3
 * @param {Object}       options
 * @param {boolean}      options.symmetric — compute both directions (default true)
 * @param {number}       options.percentile — use percentile instead of max (0-100, default 100 = exact)
 * @returns {{ distance: number, aToB: number, bToA: number, worstPointA: number, worstPointB: number }}
 */
export function hausdorffDistance(pointsA, pointsB, options = {}) {
    const symmetric = options.symmetric ?? true;
    const percentile = options.percentile ?? 100;

    const nA = (pointsA.length / 3) | 0;
    const nB = (pointsB.length / 3) | 0;

    if (nA === 0 || nB === 0) {
        return { distance: Infinity, aToB: Infinity, bToA: Infinity, worstPointA: -1, worstPointB: -1 };
    }

    // A → B direction
    const { maxDist: aToBDist, worstPoint: worstA, allDists: distsAtoB } =
        _directedHausdorff(pointsA, nA, pointsB, nB, percentile);

    let bToADist = 0, worstB = -1;
    if (symmetric) {
        const result = _directedHausdorff(pointsB, nB, pointsA, nA, percentile);
        bToADist = result.maxDist;
        worstB = result.worstPoint;
    }

    return {
        distance: Math.max(aToBDist, bToADist),
        aToB: aToBDist,
        bToA: bToADist,
        worstPointA: worstA,
        worstPointB: worstB,
    };
}


/**
 * Compute per-point minimum distances from A to B.
 * Returns the distance of each point in A to its nearest neighbor in B.
 *
 * @param {Float32Array} pointsA — stride 3
 * @param {Float32Array} pointsB — stride 3
 * @returns {Float32Array} — per-point distances (not squared), length = nA
 */
export function directedDistances(pointsA, pointsB) {
    const nA = (pointsA.length / 3) | 0;
    const nB = (pointsB.length / 3) | 0;
    const dists = new Float32Array(nA);

    if (nB === 0) { dists.fill(Infinity); return dists; }

    const avgSpacing = _estimateSpacing(pointsB, nB);
    const cellSize = avgSpacing * 3;
    const grid = buildSpatialHash(pointsB, cellSize);

    for (let i = 0; i < nA; i++) {
        const px = pointsA[i * 3], py = pointsA[i * 3 + 1], pz = pointsA[i * 3 + 2];
        dists[i] = Math.sqrt(_nearestDist2WithHash(px, py, pz, pointsB, nB, grid, cellSize));
    }

    return dists;
}


/**
 * Compute RMSE (Root Mean Square Error) between two point sets.
 * Symmetric: averages both directions.
 *
 * @param {Float32Array} pointsA — stride 3
 * @param {Float32Array} pointsB — stride 3
 * @returns {number}
 */
export function rmse(pointsA, pointsB) {
    const nA = (pointsA.length / 3) | 0;
    const nB = (pointsB.length / 3) | 0;

    if (nA === 0 || nB === 0) return Infinity;

    const avgSpacingB = _estimateSpacing(pointsB, nB);
    const gridB = buildSpatialHash(pointsB, avgSpacingB * 3);

    let sumSq = 0;
    for (let i = 0; i < nA; i++) {
        sumSq += _nearestDist2WithHash(
            pointsA[i * 3], pointsA[i * 3 + 1], pointsA[i * 3 + 2],
            pointsB, nB, gridB, avgSpacingB * 3
        );
    }

    return Math.sqrt(sumSq / nA);
}


/**
 * Compute mean absolute distance between two point sets (one direction).
 *
 * @param {Float32Array} pointsA — stride 3
 * @param {Float32Array} pointsB — stride 3
 * @returns {number}
 */
export function meanDistance(pointsA, pointsB) {
    const nA = (pointsA.length / 3) | 0;
    const nB = (pointsB.length / 3) | 0;

    if (nA === 0 || nB === 0) return Infinity;

    const avgSpacingB = _estimateSpacing(pointsB, nB);
    const gridB = buildSpatialHash(pointsB, avgSpacingB * 3);

    let sum = 0;
    for (let i = 0; i < nA; i++) {
        sum += Math.sqrt(_nearestDist2WithHash(
            pointsA[i * 3], pointsA[i * 3 + 1], pointsA[i * 3 + 2],
            pointsB, nB, gridB, avgSpacingB * 3
        ));
    }

    return sum / nA;
}


// ============================================================================
// HELPERS
// ============================================================================

function _directedHausdorff(pointsFrom, nFrom, pointsTo, nTo, percentile) {
    const avgSpacing = _estimateSpacing(pointsTo, nTo);
    const cellSize = avgSpacing * 3;
    const grid = buildSpatialHash(pointsTo, cellSize);

    const allDists = new Float32Array(nFrom);

    for (let i = 0; i < nFrom; i++) {
        const px = pointsFrom[i * 3], py = pointsFrom[i * 3 + 1], pz = pointsFrom[i * 3 + 2];
        allDists[i] = Math.sqrt(_nearestDist2WithHash(px, py, pz, pointsTo, nTo, grid, cellSize));
    }

    if (percentile >= 100) {
        // Exact Hausdorff: max
        let maxDist = 0, worstPoint = 0;
        for (let i = 0; i < nFrom; i++) {
            if (allDists[i] > maxDist) {
                maxDist = allDists[i];
                worstPoint = i;
            }
        }
        return { maxDist, worstPoint, allDists };
    } else {
        // Percentile Hausdorff
        const sorted = new Float32Array(allDists).sort();
        const idx = Math.min(Math.floor(sorted.length * percentile / 100), sorted.length - 1);
        const percDist = sorted[idx];

        // Find which point has that distance
        let worstPoint = 0;
        let closest = Infinity;
        for (let i = 0; i < nFrom; i++) {
            const diff = Math.abs(allDists[i] - percDist);
            if (diff < closest) { closest = diff; worstPoint = i; }
        }

        return { maxDist: percDist, worstPoint, allDists };
    }
}

function _nearestDist2WithHash(px, py, pz, points, numPoints, grid, cellSize) {
    const kx = Math.floor(px / cellSize);
    const ky = Math.floor(py / cellSize);
    const kz = Math.floor(pz / cellSize);

    let minDist2 = Infinity;

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

    if (minDist2 === Infinity) {
        for (let j = 0; j < numPoints; j++) {
            const dx = points[j * 3] - px;
            const dy = points[j * 3 + 1] - py;
            const dz = points[j * 3 + 2] - pz;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < minDist2) minDist2 = d2;
        }
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
