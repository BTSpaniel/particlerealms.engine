/**
 * MeshToPoints.js — Sample points from triangle meshes
 *
 * Three sampling strategies:
 *   1. Uniform random — area-weighted triangle sampling (fast)
 *   2. Poisson disk — blue-noise distribution (quality)
 *   3. Farthest point — greedy maximin spacing (LOD/coverage)
 *
 * Output: Float32Array of positions (stride 3) + optional normals
 *
 * Compatible with:
 *   - Particle system (direct spawn from sampled points)
 *   - MeshToParticlesCompute.js (CPU fallback path)
 *   - Point cloud operations (PointCloudOps.js)
 */

import { computeFaceNormals, computeFaceAreas } from '../mesh/MeshOps.js';

// ============================================================================
// UNIFORM RANDOM SAMPLING
// ============================================================================

/**
 * Sample points uniformly on a triangle mesh surface.
 * Uses area-weighted triangle selection + barycentric random point.
 *
 * @param {Float32Array} positions — stride 3
 * @param {Uint32Array}  indices   — stride 3
 * @param {number}       numSamples — number of points to generate
 * @param {Object}       options
 * @param {boolean}      options.normals — also output per-point normals (default false)
 * @param {number}       options.seed    — random seed (default Date.now())
 * @returns {{ points: Float32Array, normals?: Float32Array }}
 */
export function sampleUniform(positions, indices, numSamples, options = {}) {
    const wantNormals = options.normals ?? false;
    let seed = options.seed ?? (Date.now() & 0xFFFFFFFF);

    const areas = computeFaceAreas(positions, indices);
    const numFaces = areas.length;

    // Build CDF for area-weighted sampling
    const cdf = new Float64Array(numFaces);
    cdf[0] = areas[0];
    for (let i = 1; i < numFaces; i++) {
        cdf[i] = cdf[i - 1] + areas[i];
    }
    const totalArea = cdf[numFaces - 1];
    if (totalArea < 1e-10) {
        return { points: new Float32Array(0) };
    }

    // Normalize CDF
    for (let i = 0; i < numFaces; i++) cdf[i] /= totalArea;

    const points = new Float32Array(numSamples * 3);
    let normals = null;
    let faceNorms = null;

    if (wantNormals) {
        normals = new Float32Array(numSamples * 3);
        faceNorms = computeFaceNormals(positions, indices, true);
    }

    for (let s = 0; s < numSamples; s++) {
        // Pick a triangle weighted by area
        const r = _pcgFloat(seed++);
        const fi = _binarySearch(cdf, r);

        const i0 = indices[fi * 3] * 3;
        const i1 = indices[fi * 3 + 1] * 3;
        const i2 = indices[fi * 3 + 2] * 3;

        // Random barycentric coordinates
        let u = _pcgFloat(seed++);
        let v = _pcgFloat(seed++);
        if (u + v > 1) { u = 1 - u; v = 1 - v; }
        const w = 1 - u - v;

        const base = s * 3;
        points[base]     = w * positions[i0]     + u * positions[i1]     + v * positions[i2];
        points[base + 1] = w * positions[i0 + 1] + u * positions[i1 + 1] + v * positions[i2 + 1];
        points[base + 2] = w * positions[i0 + 2] + u * positions[i1 + 2] + v * positions[i2 + 2];

        if (normals) {
            normals[base]     = faceNorms[fi * 3];
            normals[base + 1] = faceNorms[fi * 3 + 1];
            normals[base + 2] = faceNorms[fi * 3 + 2];
        }
    }

    const result = { points };
    if (normals) result.normals = normals;
    return result;
}


// ============================================================================
// POISSON DISK SAMPLING
// ============================================================================

/**
 * Poisson disk sampling on a triangle mesh surface.
 * Produces well-distributed (blue-noise) point sets.
 *
 * Uses dart-throwing with spatial hash acceleration.
 *
 * @param {Float32Array} positions — stride 3
 * @param {Uint32Array}  indices   — stride 3
 * @param {number}       minDist   — minimum distance between samples
 * @param {Object}       options
 * @param {number}       options.maxAttempts — attempts per sample (default 30)
 * @param {number}       options.maxSamples  — hard cap on samples (default 100000)
 * @param {boolean}      options.normals     — output normals (default false)
 * @returns {{ points: Float32Array, normals?: Float32Array, count: number }}
 */
export function samplePoissonDisk(positions, indices, minDist, options = {}) {
    const maxAttempts = options.maxAttempts ?? 30;
    const maxSamples = options.maxSamples ?? 100000;
    const wantNormals = options.normals ?? false;

    // First generate a large uniform oversample
    const overSampleCount = Math.min(maxSamples * 10, 500000);
    const { points: candidates, normals: candidateNormals } = sampleUniform(
        positions, indices, overSampleCount, { normals: wantNormals }
    );

    // Spatial hash for rejection
    const cellSize = minDist;
    const accepted = [];
    const acceptedNormals = [];
    const hashMap = new Map();
    const minDist2 = minDist * minDist;

    function hashKey(x, y, z) {
        const ix = Math.floor(x / cellSize);
        const iy = Math.floor(y / cellSize);
        const iz = Math.floor(z / cellSize);
        return ix + ',' + iy + ',' + iz;
    }

    function isTooClose(px, py, pz) {
        const ix = Math.floor(px / cellSize);
        const iy = Math.floor(py / cellSize);
        const iz = Math.floor(pz / cellSize);

        for (let dz = -1; dz <= 1; dz++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const key = (ix + dx) + ',' + (iy + dy) + ',' + (iz + dz);
                    const cell = hashMap.get(key);
                    if (!cell) continue;
                    for (const idx of cell) {
                        const ox = accepted[idx * 3] - px;
                        const oy = accepted[idx * 3 + 1] - py;
                        const oz = accepted[idx * 3 + 2] - pz;
                        if (ox * ox + oy * oy + oz * oz < minDist2) return true;
                    }
                }
            }
        }
        return false;
    }

    // Shuffle candidates for randomness
    const order = new Uint32Array(overSampleCount);
    for (let i = 0; i < overSampleCount; i++) order[i] = i;
    for (let i = overSampleCount - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const t = order[i]; order[i] = order[j]; order[j] = t;
    }

    for (let oi = 0; oi < overSampleCount && accepted.length / 3 < maxSamples; oi++) {
        const ci = order[oi];
        const px = candidates[ci * 3];
        const py = candidates[ci * 3 + 1];
        const pz = candidates[ci * 3 + 2];

        if (isTooClose(px, py, pz)) continue;

        const idx = accepted.length / 3;
        accepted.push(px, py, pz);

        if (wantNormals && candidateNormals) {
            acceptedNormals.push(
                candidateNormals[ci * 3],
                candidateNormals[ci * 3 + 1],
                candidateNormals[ci * 3 + 2]
            );
        }

        const key = hashKey(px, py, pz);
        if (!hashMap.has(key)) hashMap.set(key, []);
        hashMap.get(key).push(idx);
    }

    const count = accepted.length / 3;
    const result = { points: new Float32Array(accepted), count };
    if (wantNormals) result.normals = new Float32Array(acceptedNormals);
    return result;
}


// ============================================================================
// FARTHEST POINT SAMPLING
// ============================================================================

/**
 * Farthest point sampling from a set of candidate points.
 * Iteratively picks the point farthest from all previously selected points.
 * Produces excellent coverage for LOD and feature-preserving downsampling.
 *
 * @param {Float32Array} points — stride 3 (input candidates)
 * @param {number}       numSamples — how many to select
 * @returns {{ indices: Uint32Array, points: Float32Array }}
 */
export function farthestPointSample(points, numSamples) {
    const numPoints = (points.length / 3) | 0;
    if (numSamples >= numPoints) {
        return {
            indices: new Uint32Array(numPoints).map((_, i) => i),
            points: new Float32Array(points),
        };
    }

    const selected = new Uint32Array(numSamples);
    const minDists = new Float32Array(numPoints).fill(Infinity);

    // Start with first point (or could pick random)
    selected[0] = 0;

    for (let s = 1; s < numSamples; s++) {
        // Update min distances from last selected point
        const lastIdx = selected[s - 1] * 3;
        const lx = points[lastIdx], ly = points[lastIdx + 1], lz = points[lastIdx + 2];

        let farthestDist = -1;
        let farthestIdx = 0;

        for (let i = 0; i < numPoints; i++) {
            const pi = i * 3;
            const dx = points[pi] - lx;
            const dy = points[pi + 1] - ly;
            const dz = points[pi + 2] - lz;
            const d2 = dx * dx + dy * dy + dz * dz;

            if (d2 < minDists[i]) minDists[i] = d2;
            if (minDists[i] > farthestDist) {
                farthestDist = minDists[i];
                farthestIdx = i;
            }
        }

        selected[s] = farthestIdx;
    }

    // Extract selected points
    const outPoints = new Float32Array(numSamples * 3);
    for (let s = 0; s < numSamples; s++) {
        const src = selected[s] * 3;
        outPoints[s * 3]     = points[src];
        outPoints[s * 3 + 1] = points[src + 1];
        outPoints[s * 3 + 2] = points[src + 2];
    }

    return { indices: selected, points: outPoints };
}


// ============================================================================
// HELPERS
// ============================================================================

/** PCG hash for deterministic random */
function _pcgHash(input) {
    let state = (input * 747796405 + 2891336453) >>> 0;
    const word = (((state >>> ((state >>> 28) + 4)) ^ state) * 277803737) >>> 0;
    return ((word >>> 22) ^ word) >>> 0;
}

function _pcgFloat(seed) {
    return _pcgHash(seed) / 4294967295;
}

/** Binary search in CDF array */
function _binarySearch(cdf, value) {
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (cdf[mid] < value) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}
