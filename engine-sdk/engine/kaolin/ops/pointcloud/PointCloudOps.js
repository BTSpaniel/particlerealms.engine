/**
 * PointCloudOps.js — Point cloud geometric analysis
 *
 * Operations on unstructured 3D point sets:
 *   - k-NN queries via spatial hash
 *   - Normal estimation (PCA on local neighborhood)
 *   - Curvature estimation (from fitted normals)
 *   - Statistical outlier removal
 *   - Voxel downsampling
 *   - Centroid / bounding box / oriented bounding box
 *   - Normal orientation propagation (MST-based)
 *
 * Compatible with:
 *   - MeshToPoints.js output
 *   - Particle system readback (Float32Array stride 3)
 *   - PointsToMesh.js input (provides normals for BPA)
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const EPSILON = 1e-7;

// ============================================================================
// k-NEAREST NEIGHBORS
// ============================================================================

/**
 * Build a spatial hash for fast neighbor queries.
 *
 * @param {Float32Array} points — stride 3
 * @param {number}       cellSize
 * @returns {Map<string, number[]>}
 */
export function buildSpatialHash(points, cellSize) {
    const numPoints = (points.length / 3) | 0;
    const grid = new Map();
    for (let i = 0; i < numPoints; i++) {
        const kx = Math.floor(points[i * 3] / cellSize);
        const ky = Math.floor(points[i * 3 + 1] / cellSize);
        const kz = Math.floor(points[i * 3 + 2] / cellSize);
        const key = kx + ',' + ky + ',' + kz;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(i);
    }
    return grid;
}

/**
 * Find k nearest neighbors for a single query point.
 *
 * @param {Float32Array}          points   — stride 3
 * @param {Map<string, number[]>} grid     — from buildSpatialHash
 * @param {number}                cellSize — hash cell size
 * @param {number}                qi       — query point index
 * @param {number}                k        — number of neighbors
 * @param {number}                maxRadius — search radius (default Infinity)
 * @returns {number[]} — indices of k nearest neighbors (sorted by distance)
 */
export function knnQuery(points, grid, cellSize, qi, k, maxRadius = Infinity) {
    const px = points[qi * 3], py = points[qi * 3 + 1], pz = points[qi * 3 + 2];
    const kx = Math.floor(px / cellSize);
    const ky = Math.floor(py / cellSize);
    const kz = Math.floor(pz / cellSize);

    // Expand search range until we have enough candidates
    const maxRange = Math.min(Math.ceil(maxRadius / cellSize), 10);
    const candidates = [];

    for (let range = 1; range <= maxRange; range++) {
        for (let dz = -range; dz <= range; dz++) {
            for (let dy = -range; dy <= range; dy++) {
                for (let dx = -range; dx <= range; dx++) {
                    // Only check cells in the current shell
                    if (Math.abs(dx) < range && Math.abs(dy) < range && Math.abs(dz) < range) continue;

                    const key = (kx + dx) + ',' + (ky + dy) + ',' + (kz + dz);
                    const cell = grid.get(key);
                    if (!cell) continue;
                    for (const j of cell) {
                        if (j === qi) continue;
                        const ox = points[j * 3] - px;
                        const oy = points[j * 3 + 1] - py;
                        const oz = points[j * 3 + 2] - pz;
                        const d2 = ox * ox + oy * oy + oz * oz;
                        if (d2 <= maxRadius * maxRadius) {
                            candidates.push({ idx: j, d2 });
                        }
                    }
                }
            }
        }
        if (candidates.length >= k) break;
    }

    // Also check range=0 (same cell)
    const cell0 = grid.get(kx + ',' + ky + ',' + kz);
    if (cell0) {
        for (const j of cell0) {
            if (j === qi) continue;
            const ox = points[j * 3] - px;
            const oy = points[j * 3 + 1] - py;
            const oz = points[j * 3 + 2] - pz;
            const d2 = ox * ox + oy * oy + oz * oz;
            if (d2 <= maxRadius * maxRadius) {
                candidates.push({ idx: j, d2 });
            }
        }
    }

    // Sort by distance and return top k
    candidates.sort((a, b) => a.d2 - b.d2);

    // Deduplicate
    const seen = new Set();
    const result = [];
    for (const c of candidates) {
        if (seen.has(c.idx)) continue;
        seen.add(c.idx);
        result.push(c.idx);
        if (result.length >= k) break;
    }
    return result;
}

/**
 * Batch k-NN for all points.
 *
 * @param {Float32Array} points — stride 3
 * @param {number}       k      — neighbors per point
 * @param {number}       searchRadius — optional max radius
 * @returns {{ neighbors: Int32Array, distances: Float32Array }}
 *   neighbors: [k entries per point], -1 for missing. Row-major.
 *   distances: squared distances corresponding to neighbors.
 */
export function batchKNN(points, k, searchRadius) {
    const numPoints = (points.length / 3) | 0;
    const avgSpacing = _estimateSpacing(points, numPoints);
    const cellSize = searchRadius ?? avgSpacing * 3;
    const grid = buildSpatialHash(points, cellSize);

    const neighbors = new Int32Array(numPoints * k).fill(-1);
    const distances = new Float32Array(numPoints * k);

    for (let i = 0; i < numPoints; i++) {
        const nn = knnQuery(points, grid, cellSize, i, k, searchRadius ?? Infinity);
        const px = points[i * 3], py = points[i * 3 + 1], pz = points[i * 3 + 2];
        for (let j = 0; j < nn.length && j < k; j++) {
            neighbors[i * k + j] = nn[j];
            const ni = nn[j] * 3;
            const dx = points[ni] - px, dy = points[ni + 1] - py, dz = points[ni + 2] - pz;
            distances[i * k + j] = dx * dx + dy * dy + dz * dz;
        }
    }

    return { neighbors, distances };
}


// ============================================================================
// NORMAL ESTIMATION (PCA)
// ============================================================================

/**
 * Estimate normals for a point cloud using PCA on local neighborhoods.
 *
 * For each point, finds k nearest neighbors and fits a plane via PCA.
 * The normal is the eigenvector corresponding to the smallest eigenvalue
 * of the covariance matrix.
 *
 * @param {Float32Array} points — stride 3
 * @param {number}       k      — neighborhood size (default 12)
 * @param {Object}       options
 * @param {Float32Array} options.viewpoint — [x,y,z] for consistent orientation (default [0,0,0])
 * @param {boolean}      options.propagate — use MST propagation for global consistency (default false)
 * @returns {Float32Array} — normals, stride 3
 */
export function estimateNormals(points, k = 12, options = {}) {
    const numPoints = (points.length / 3) | 0;
    const normals = new Float32Array(numPoints * 3);

    const avgSpacing = _estimateSpacing(points, numPoints);
    const cellSize = avgSpacing * 3;
    const grid = buildSpatialHash(points, cellSize);

    for (let i = 0; i < numPoints; i++) {
        const nn = knnQuery(points, grid, cellSize, i, k);
        if (nn.length < 3) {
            normals[i * 3 + 1] = 1; // fallback up
            continue;
        }

        const normal = _pcaNormal(points, i, nn);
        normals[i * 3]     = normal[0];
        normals[i * 3 + 1] = normal[1];
        normals[i * 3 + 2] = normal[2];
    }

    // Orient normals toward viewpoint
    const vp = options.viewpoint ?? [0, 0, 0];
    for (let i = 0; i < numPoints; i++) {
        const dx = vp[0] - points[i * 3];
        const dy = vp[1] - points[i * 3 + 1];
        const dz = vp[2] - points[i * 3 + 2];
        const dot = normals[i * 3] * dx + normals[i * 3 + 1] * dy + normals[i * 3 + 2] * dz;
        if (dot < 0) {
            normals[i * 3]     = -normals[i * 3];
            normals[i * 3 + 1] = -normals[i * 3 + 1];
            normals[i * 3 + 2] = -normals[i * 3 + 2];
        }
    }

    // Optional MST-based propagation for global consistency
    if (options.propagate) {
        _propagateNormalsMST(points, normals, numPoints, grid, cellSize, k);
    }

    return normals;
}


// ============================================================================
// CURVATURE ESTIMATION
// ============================================================================

/**
 * Estimate per-point curvature from normals and neighborhood.
 * Uses the ratio of the smallest eigenvalue to the sum of eigenvalues.
 *
 * @param {Float32Array} points  — stride 3
 * @param {Float32Array} normals — stride 3 (from estimateNormals)
 * @param {number}       k       — neighborhood size (default 12)
 * @returns {Float32Array} — per-point curvature [0..1], 0=flat, 1=high curvature
 */
export function estimateCurvature(points, normals, k = 12) {
    const numPoints = (points.length / 3) | 0;
    const curvature = new Float32Array(numPoints);

    const avgSpacing = _estimateSpacing(points, numPoints);
    const cellSize = avgSpacing * 3;
    const grid = buildSpatialHash(points, cellSize);

    for (let i = 0; i < numPoints; i++) {
        const nn = knnQuery(points, grid, cellSize, i, k);
        if (nn.length < 3) continue;

        // Curvature via normal variation
        const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2];
        let sumDev = 0;
        for (const j of nn) {
            const dnx = normals[j * 3] - nx;
            const dny = normals[j * 3 + 1] - ny;
            const dnz = normals[j * 3 + 2] - nz;
            sumDev += Math.sqrt(dnx * dnx + dny * dny + dnz * dnz);
        }
        curvature[i] = sumDev / nn.length;
    }

    return curvature;
}


// ============================================================================
// STATISTICAL OUTLIER REMOVAL
// ============================================================================

/**
 * Remove statistical outliers based on mean distance to k neighbors.
 * Points with mean distance > (global_mean + stdRatio * global_std) are removed.
 *
 * @param {Float32Array} points   — stride 3
 * @param {number}       k        — neighbors to check (default 20)
 * @param {number}       stdRatio — standard deviation multiplier (default 2.0)
 * @returns {{ points: Float32Array, mask: Uint8Array, removed: number }}
 */
export function removeStatisticalOutliers(points, k = 20, stdRatio = 2.0) {
    const numPoints = (points.length / 3) | 0;
    const avgSpacing = _estimateSpacing(points, numPoints);
    const cellSize = avgSpacing * 4;
    const grid = buildSpatialHash(points, cellSize);

    const meanDists = new Float32Array(numPoints);

    for (let i = 0; i < numPoints; i++) {
        const nn = knnQuery(points, grid, cellSize, i, k);
        if (nn.length === 0) { meanDists[i] = Infinity; continue; }

        let sum = 0;
        const px = points[i * 3], py = points[i * 3 + 1], pz = points[i * 3 + 2];
        for (const j of nn) {
            const dx = points[j * 3] - px;
            const dy = points[j * 3 + 1] - py;
            const dz = points[j * 3 + 2] - pz;
            sum += Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        meanDists[i] = sum / nn.length;
    }

    // Global statistics
    let globalMean = 0, count = 0;
    for (let i = 0; i < numPoints; i++) {
        if (meanDists[i] < Infinity) { globalMean += meanDists[i]; count++; }
    }
    globalMean /= Math.max(count, 1);

    let variance = 0;
    for (let i = 0; i < numPoints; i++) {
        if (meanDists[i] < Infinity) {
            const d = meanDists[i] - globalMean;
            variance += d * d;
        }
    }
    const globalStd = Math.sqrt(variance / Math.max(count, 1));
    const threshold = globalMean + stdRatio * globalStd;

    // Build mask
    const mask = new Uint8Array(numPoints);
    let kept = 0;
    for (let i = 0; i < numPoints; i++) {
        if (meanDists[i] <= threshold) {
            mask[i] = 1;
            kept++;
        }
    }

    // Compact
    const filtered = new Float32Array(kept * 3);
    let out = 0;
    for (let i = 0; i < numPoints; i++) {
        if (mask[i]) {
            filtered[out++] = points[i * 3];
            filtered[out++] = points[i * 3 + 1];
            filtered[out++] = points[i * 3 + 2];
        }
    }

    return { points: filtered, mask, removed: numPoints - kept };
}


// ============================================================================
// RADIUS OUTLIER REMOVAL
// ============================================================================

/**
 * Remove points with fewer than minNeighbors within given radius.
 *
 * @param {Float32Array} points       — stride 3
 * @param {number}       radius       — search radius
 * @param {number}       minNeighbors — minimum count (default 3)
 * @returns {{ points: Float32Array, mask: Uint8Array, removed: number }}
 */
export function removeRadiusOutliers(points, radius, minNeighbors = 3) {
    const numPoints = (points.length / 3) | 0;
    const cellSize = radius;
    const grid = buildSpatialHash(points, cellSize);
    const r2 = radius * radius;

    const mask = new Uint8Array(numPoints);
    let kept = 0;

    for (let i = 0; i < numPoints; i++) {
        const px = points[i * 3], py = points[i * 3 + 1], pz = points[i * 3 + 2];
        const kx = Math.floor(px / cellSize);
        const ky = Math.floor(py / cellSize);
        const kz = Math.floor(pz / cellSize);

        let count = 0;
        outer:
        for (let dz = -1; dz <= 1; dz++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const key = (kx + dx) + ',' + (ky + dy) + ',' + (kz + dz);
                    const cell = grid.get(key);
                    if (!cell) continue;
                    for (const j of cell) {
                        if (j === i) continue;
                        const ox = points[j * 3] - px;
                        const oy = points[j * 3 + 1] - py;
                        const oz = points[j * 3 + 2] - pz;
                        if (ox * ox + oy * oy + oz * oz <= r2) {
                            count++;
                            if (count >= minNeighbors) break outer;
                        }
                    }
                }
            }
        }

        if (count >= minNeighbors) {
            mask[i] = 1;
            kept++;
        }
    }

    const filtered = new Float32Array(kept * 3);
    let out = 0;
    for (let i = 0; i < numPoints; i++) {
        if (mask[i]) {
            filtered[out++] = points[i * 3];
            filtered[out++] = points[i * 3 + 1];
            filtered[out++] = points[i * 3 + 2];
        }
    }

    return { points: filtered, mask, removed: numPoints - kept };
}


// ============================================================================
// VOXEL DOWNSAMPLING
// ============================================================================

/**
 * Downsample a point cloud by averaging points within each voxel cell.
 *
 * @param {Float32Array} points    — stride 3
 * @param {number}       voxelSize — grid cell size
 * @param {Float32Array} normals   — optional stride 3 (averaged per voxel)
 * @returns {{ points: Float32Array, normals?: Float32Array, count: number }}
 */
export function voxelDownsample(points, voxelSize, normals = null) {
    const numPoints = (points.length / 3) | 0;
    const cells = new Map();

    for (let i = 0; i < numPoints; i++) {
        const kx = Math.floor(points[i * 3] / voxelSize);
        const ky = Math.floor(points[i * 3 + 1] / voxelSize);
        const kz = Math.floor(points[i * 3 + 2] / voxelSize);
        const key = kx + ',' + ky + ',' + kz;

        if (!cells.has(key)) {
            cells.set(key, { sx: 0, sy: 0, sz: 0, nx: 0, ny: 0, nz: 0, count: 0 });
        }
        const c = cells.get(key);
        c.sx += points[i * 3];
        c.sy += points[i * 3 + 1];
        c.sz += points[i * 3 + 2];
        if (normals) {
            c.nx += normals[i * 3];
            c.ny += normals[i * 3 + 1];
            c.nz += normals[i * 3 + 2];
        }
        c.count++;
    }

    const count = cells.size;
    const outPoints = new Float32Array(count * 3);
    let outNormals = normals ? new Float32Array(count * 3) : null;
    let idx = 0;

    for (const c of cells.values()) {
        const inv = 1 / c.count;
        outPoints[idx * 3]     = c.sx * inv;
        outPoints[idx * 3 + 1] = c.sy * inv;
        outPoints[idx * 3 + 2] = c.sz * inv;

        if (outNormals) {
            let nx = c.nx, ny = c.ny, nz = c.nz;
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
            if (len > EPSILON) { nx /= len; ny /= len; nz /= len; }
            outNormals[idx * 3]     = nx;
            outNormals[idx * 3 + 1] = ny;
            outNormals[idx * 3 + 2] = nz;
        }

        idx++;
    }

    const result = { points: outPoints, count };
    if (outNormals) result.normals = outNormals;
    return result;
}


// ============================================================================
// BOUNDING GEOMETRY
// ============================================================================

/**
 * Compute axis-aligned bounding box.
 */
export function computeAABB(points) {
    const numPoints = (points.length / 3) | 0;
    const min = new Float32Array([Infinity, Infinity, Infinity]);
    const max = new Float32Array([-Infinity, -Infinity, -Infinity]);

    for (let i = 0; i < numPoints; i++) {
        const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
        if (x < min[0]) min[0] = x; if (x > max[0]) max[0] = x;
        if (y < min[1]) min[1] = y; if (y > max[1]) max[1] = y;
        if (z < min[2]) min[2] = z; if (z > max[2]) max[2] = z;
    }

    return {
        min, max,
        center: new Float32Array([(min[0]+max[0])*0.5, (min[1]+max[1])*0.5, (min[2]+max[2])*0.5]),
        size: new Float32Array([max[0]-min[0], max[1]-min[1], max[2]-min[2]]),
    };
}

/**
 * Compute centroid of a point cloud.
 */
export function computeCentroid(points) {
    const n = (points.length / 3) | 0;
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < n; i++) {
        sx += points[i * 3];
        sy += points[i * 3 + 1];
        sz += points[i * 3 + 2];
    }
    const inv = 1 / Math.max(n, 1);
    return new Float32Array([sx * inv, sy * inv, sz * inv]);
}

/**
 * Compute oriented bounding box via PCA.
 * Returns axes (3 Float32Array[3]), half-extents, and center.
 */
export function computeOBB(points) {
    const n = (points.length / 3) | 0;
    const center = computeCentroid(points);

    // Covariance matrix (3×3 symmetric)
    let cxx = 0, cxy = 0, cxz = 0, cyy = 0, cyz = 0, czz = 0;
    for (let i = 0; i < n; i++) {
        const dx = points[i * 3] - center[0];
        const dy = points[i * 3 + 1] - center[1];
        const dz = points[i * 3 + 2] - center[2];
        cxx += dx * dx; cxy += dx * dy; cxz += dx * dz;
        cyy += dy * dy; cyz += dy * dz; czz += dz * dz;
    }
    const inv = 1 / Math.max(n, 1);
    cxx *= inv; cxy *= inv; cxz *= inv; cyy *= inv; cyz *= inv; czz *= inv;

    // Eigendecomposition via Jacobi iteration
    const { eigenvalues, eigenvectors } = _symmetricEigen3x3(cxx, cxy, cxz, cyy, cyz, czz);

    // Project points onto eigenvectors to find extents
    const halfExtents = new Float32Array(3);
    for (let a = 0; a < 3; a++) {
        let mn = Infinity, mx = -Infinity;
        const ax = eigenvectors[a * 3], ay = eigenvectors[a * 3 + 1], az = eigenvectors[a * 3 + 2];
        for (let i = 0; i < n; i++) {
            const dx = points[i * 3] - center[0];
            const dy = points[i * 3 + 1] - center[1];
            const dz = points[i * 3 + 2] - center[2];
            const proj = dx * ax + dy * ay + dz * az;
            if (proj < mn) mn = proj;
            if (proj > mx) mx = proj;
        }
        halfExtents[a] = (mx - mn) * 0.5;
        // Adjust center along this axis
        const mid = (mx + mn) * 0.5;
        center[0] += mid * eigenvectors[a * 3];
        center[1] += mid * eigenvectors[a * 3 + 1];
        center[2] += mid * eigenvectors[a * 3 + 2];
    }

    return {
        center,
        axes: [
            new Float32Array([eigenvectors[0], eigenvectors[1], eigenvectors[2]]),
            new Float32Array([eigenvectors[3], eigenvectors[4], eigenvectors[5]]),
            new Float32Array([eigenvectors[6], eigenvectors[7], eigenvectors[8]]),
        ],
        halfExtents,
    };
}


// ============================================================================
// CROP / FILTER
// ============================================================================

/**
 * Crop points to an axis-aligned bounding box.
 */
export function cropToAABB(points, min, max) {
    const n = (points.length / 3) | 0;
    const kept = [];
    for (let i = 0; i < n; i++) {
        const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
        if (x >= min[0] && x <= max[0] &&
            y >= min[1] && y <= max[1] &&
            z >= min[2] && z <= max[2]) {
            kept.push(x, y, z);
        }
    }
    return new Float32Array(kept);
}

/**
 * Crop points to a sphere.
 */
export function cropToSphere(points, cx, cy, cz, radius) {
    const n = (points.length / 3) | 0;
    const r2 = radius * radius;
    const kept = [];
    for (let i = 0; i < n; i++) {
        const dx = points[i * 3] - cx;
        const dy = points[i * 3 + 1] - cy;
        const dz = points[i * 3 + 2] - cz;
        if (dx * dx + dy * dy + dz * dz <= r2) {
            kept.push(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
        }
    }
    return new Float32Array(kept);
}


// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/** Estimate average spacing from a random subset */
function _estimateSpacing(points, numPoints) {
    const sampleCount = Math.min(numPoints, 50);
    const step = Math.max(1, (numPoints / sampleCount) | 0);
    let totalMinDist = 0;
    let counted = 0;

    for (let i = 0; i < numPoints; i += step) {
        let minDist2 = Infinity;
        const px = points[i * 3], py = points[i * 3 + 1], pz = points[i * 3 + 2];

        for (let j = 0; j < numPoints; j++) {
            if (j === i) continue;
            const dx = points[j * 3] - px;
            const dy = points[j * 3 + 1] - py;
            const dz = points[j * 3 + 2] - pz;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < minDist2) minDist2 = d2;
        }
        if (minDist2 < Infinity) {
            totalMinDist += Math.sqrt(minDist2);
            counted++;
        }
    }

    return counted > 0 ? totalMinDist / counted : 1.0;
}

/** PCA normal: smallest eigenvector of covariance of point + its neighbors */
function _pcaNormal(points, idx, neighbors) {
    const cx = points[idx * 3], cy = points[idx * 3 + 1], cz = points[idx * 3 + 2];

    // Compute centroid of neighborhood (including point itself)
    let mx = cx, my = cy, mz = cz;
    for (const j of neighbors) {
        mx += points[j * 3];
        my += points[j * 3 + 1];
        mz += points[j * 3 + 2];
    }
    const n = neighbors.length + 1;
    mx /= n; my /= n; mz /= n;

    // Covariance matrix
    let cxx = 0, cxy = 0, cxz = 0, cyy = 0, cyz = 0, czz = 0;

    const addPoint = (px, py, pz) => {
        const dx = px - mx, dy = py - my, dz = pz - mz;
        cxx += dx * dx; cxy += dx * dy; cxz += dx * dz;
        cyy += dy * dy; cyz += dy * dz; czz += dz * dz;
    };

    addPoint(cx, cy, cz);
    for (const j of neighbors) {
        addPoint(points[j * 3], points[j * 3 + 1], points[j * 3 + 2]);
    }

    // Find smallest eigenvector
    const { eigenvectors } = _symmetricEigen3x3(cxx, cxy, cxz, cyy, cyz, czz);

    // Eigenvectors sorted by eigenvalue descending; last = smallest = normal direction
    return [eigenvectors[6], eigenvectors[7], eigenvectors[8]];
}

/**
 * 3×3 symmetric eigendecomposition via Jacobi iteration.
 * Input: upper-triangle elements of symmetric matrix.
 * Returns eigenvalues (sorted descending) and eigenvectors (row-major, 9 floats).
 */
function _symmetricEigen3x3(a00, a01, a02, a11, a12, a22) {
    // Start with identity rotation
    let v = [1,0,0, 0,1,0, 0,0,1];
    let d = [a00, a11, a22]; // diagonal
    let od = [a01, a02, a12]; // off-diagonal: [01, 02, 12]

    for (let iter = 0; iter < 50; iter++) {
        // Find largest off-diagonal
        const abs01 = Math.abs(od[0]);
        const abs02 = Math.abs(od[1]);
        const abs12 = Math.abs(od[2]);

        if (abs01 < EPSILON && abs02 < EPSILON && abs12 < EPSILON) break;

        let p, q, r;
        if (abs01 >= abs02 && abs01 >= abs12) { p = 0; q = 1; r = 0; }
        else if (abs02 >= abs12) { p = 0; q = 2; r = 1; }
        else { p = 1; q = 2; r = 2; }

        // Compute Jacobi rotation
        const dpq = d[q] - d[p];
        let t;
        if (Math.abs(od[r]) < EPSILON * Math.abs(dpq)) {
            t = od[r] / dpq;
        } else {
            const phi = dpq / (2 * od[r]);
            t = 1 / (Math.abs(phi) + Math.sqrt(phi * phi + 1));
            if (phi < 0) t = -t;
        }

        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        const tau = s / (1 + c);

        const temp = od[r];
        od[r] = 0;
        d[p] -= t * temp;
        d[q] += t * temp;

        // Update off-diagonal elements
        if (p === 0 && q === 1) {
            const old02 = od[1], old12 = od[2];
            od[1] = old02 - s * (old12 + tau * old02);
            od[2] = old12 + s * (old02 - tau * old12);
        } else if (p === 0 && q === 2) {
            const old01 = od[0], old12 = od[2];
            od[0] = old01 - s * (old12 + tau * old01);
            od[2] = old12 + s * (old01 - tau * old12);
        } else {
            const old01 = od[0], old02 = od[1];
            od[0] = old01 - s * (old02 + tau * old01);
            od[1] = old02 + s * (old01 - tau * old02);
        }

        // Rotate eigenvector matrix
        for (let i = 0; i < 3; i++) {
            const vip = v[i * 3 + p], viq = v[i * 3 + q];
            v[i * 3 + p] = vip - s * (viq + tau * vip);
            v[i * 3 + q] = viq + s * (vip - tau * viq);
        }
    }

    // Sort by eigenvalue descending
    const idx = [0, 1, 2];
    idx.sort((a, b) => d[b] - d[a]);

    const eigenvalues = new Float32Array([d[idx[0]], d[idx[1]], d[idx[2]]]);
    const eigenvectors = new Float32Array(9);
    for (let i = 0; i < 3; i++) {
        const si = idx[i];
        eigenvectors[i * 3]     = v[si];
        eigenvectors[i * 3 + 1] = v[3 + si];
        eigenvectors[i * 3 + 2] = v[6 + si];
    }

    return { eigenvalues, eigenvectors };
}

/**
 * Propagate normal orientations using minimum spanning tree of k-NN graph.
 * Ensures global normal consistency without a viewpoint assumption.
 */
function _propagateNormalsMST(points, normals, numPoints, grid, cellSize, k) {
    // Build edges with weight = 1 - |dot(n_i, n_j)| (prefer similar normals)
    const edges = [];
    const visited = new Uint8Array(numPoints);

    for (let i = 0; i < numPoints; i++) {
        const nn = knnQuery(points, grid, cellSize, i, k);
        for (const j of nn) {
            if (j <= i) continue; // avoid duplicate edges
            const dot = normals[i * 3] * normals[j * 3] +
                        normals[i * 3 + 1] * normals[j * 3 + 1] +
                        normals[i * 3 + 2] * normals[j * 3 + 2];
            edges.push({ i, j, w: 1 - Math.abs(dot) });
        }
    }

    // Sort edges by weight (Kruskal's MST)
    edges.sort((a, b) => a.w - b.w);

    // Union-Find
    const parent = new Int32Array(numPoints);
    const rank = new Int32Array(numPoints);
    for (let i = 0; i < numPoints; i++) parent[i] = i;

    function find(x) {
        while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    }

    const mstEdges = [];
    for (const e of edges) {
        const ri = find(e.i), rj = find(e.j);
        if (ri === rj) continue;
        mstEdges.push(e);
        if (rank[ri] < rank[rj]) parent[ri] = rj;
        else if (rank[ri] > rank[rj]) parent[rj] = ri;
        else { parent[rj] = ri; rank[ri]++; }
        if (mstEdges.length === numPoints - 1) break;
    }

    // BFS from vertex 0 along MST, flipping normals for consistency
    const adj = new Array(numPoints);
    for (let i = 0; i < numPoints; i++) adj[i] = [];
    for (const e of mstEdges) {
        adj[e.i].push(e.j);
        adj[e.j].push(e.i);
    }

    visited.fill(0);
    const queue = [0];
    visited[0] = 1;
    let head = 0;

    while (head < queue.length) {
        const curr = queue[head++];
        for (const next of adj[curr]) {
            if (visited[next]) continue;
            visited[next] = 1;

            const dot = normals[curr * 3] * normals[next * 3] +
                        normals[curr * 3 + 1] * normals[next * 3 + 1] +
                        normals[curr * 3 + 2] * normals[next * 3 + 2];
            if (dot < 0) {
                normals[next * 3]     = -normals[next * 3];
                normals[next * 3 + 1] = -normals[next * 3 + 1];
                normals[next * 3 + 2] = -normals[next * 3 + 2];
            }

            queue.push(next);
        }
    }
}
