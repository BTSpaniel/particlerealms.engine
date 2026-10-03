/**
 * VolumetricIoU.js — Intersection over Union for 3D shapes
 *
 * Measures overlap between two 3D shapes by voxelizing both
 * and computing |intersection| / |union|.
 *
 * Also supports direct voxel grid inputs (skip re-voxelization).
 *
 * Used by: agi/ training loops, mesh reconstruction quality, shape matching.
 */

import { meshToVoxel } from '../ops/conversions/MeshToVoxel.js';

// ============================================================================
// VOLUMETRIC IoU
// ============================================================================

/**
 * Compute Volumetric IoU between two triangle meshes.
 * Voxelizes both at the same resolution/origin, then counts overlap.
 *
 * @param {Float32Array} positionsA — stride 3
 * @param {Uint32Array}  indicesA   — stride 3
 * @param {Float32Array} positionsB — stride 3
 * @param {Uint32Array}  indicesB   — stride 3
 * @param {Object}       options
 * @param {number}       options.resolution — voxels per longest axis (default 32)
 * @param {boolean}      options.fillInterior — fill interiors before comparing (default true)
 * @returns {{ iou: number, intersection: number, union: number, sizeA: number, sizeB: number }}
 */
export function volumetricIoU(positionsA, indicesA, positionsB, indicesB, options = {}) {
    const resolution = options.resolution ?? 32;
    const fillInterior = options.fillInterior ?? true;

    // Compute shared bounding box
    const bboxA = _computeBBox(positionsA);
    const bboxB = _computeBBox(positionsB);

    const sharedMin = new Float32Array([
        Math.min(bboxA.min[0], bboxB.min[0]),
        Math.min(bboxA.min[1], bboxB.min[1]),
        Math.min(bboxA.min[2], bboxB.min[2]),
    ]);
    const sharedMax = new Float32Array([
        Math.max(bboxA.max[0], bboxB.max[0]),
        Math.max(bboxA.max[1], bboxB.max[1]),
        Math.max(bboxA.max[2], bboxB.max[2]),
    ]);

    const dx = sharedMax[0] - sharedMin[0];
    const dy = sharedMax[1] - sharedMin[1];
    const dz = sharedMax[2] - sharedMin[2];
    const maxDim = Math.max(dx, dy, dz, 0.001);

    const padding = 2;
    const voxelSize = maxDim / (resolution - 2 * padding);
    const origin = new Float32Array([
        sharedMin[0] - padding * voxelSize,
        sharedMin[1] - padding * voxelSize,
        sharedMin[2] - padding * voxelSize,
    ]);
    const resX = Math.ceil(dx / voxelSize) + 2 * padding;
    const resY = Math.ceil(dy / voxelSize) + 2 * padding;
    const resZ = Math.ceil(dz / voxelSize) + 2 * padding;

    // Voxelize both meshes onto same grid
    const gridA = _voxelizeMeshOnGrid(positionsA, indicesA, resX, resY, resZ, origin, voxelSize, fillInterior);
    const gridB = _voxelizeMeshOnGrid(positionsB, indicesB, resX, resY, resZ, origin, voxelSize, fillInterior);

    return voxelGridIoU(gridA, gridB);
}


/**
 * Compute IoU directly from two voxel grids (same dimensions).
 *
 * @param {Uint8Array} gridA
 * @param {Uint8Array} gridB
 * @returns {{ iou: number, intersection: number, union: number, sizeA: number, sizeB: number }}
 */
export function voxelGridIoU(gridA, gridB) {
    let intersection = 0, unionCount = 0, sizeA = 0, sizeB = 0;

    const len = Math.min(gridA.length, gridB.length);
    for (let i = 0; i < len; i++) {
        const a = gridA[i] ? 1 : 0;
        const b = gridB[i] ? 1 : 0;
        sizeA += a;
        sizeB += b;
        if (a && b) intersection++;
        if (a || b) unionCount++;
    }

    const iou = unionCount > 0 ? intersection / unionCount : 0;
    return { iou, intersection, union: unionCount, sizeA, sizeB };
}


/**
 * F-Score: harmonic mean of precision and recall at a distance threshold.
 * Precision = fraction of predicted points within threshold of ground truth.
 * Recall = fraction of ground truth points within threshold of prediction.
 *
 * @param {Float32Array} pointsPred — stride 3
 * @param {Float32Array} pointsGT   — stride 3
 * @param {number}       threshold  — distance threshold
 * @returns {{ fScore: number, precision: number, recall: number }}
 */
export function fScore(pointsPred, pointsGT, threshold) {
    const t2 = threshold * threshold;
    const nPred = (pointsPred.length / 3) | 0;
    const nGT = (pointsGT.length / 3) | 0;

    if (nPred === 0 || nGT === 0) {
        return { fScore: 0, precision: 0, recall: 0 };
    }

    // Precision: for each predicted point, is there a GT point within threshold?
    let precisionHits = 0;
    for (let i = 0; i < nPred; i++) {
        const px = pointsPred[i * 3], py = pointsPred[i * 3 + 1], pz = pointsPred[i * 3 + 2];
        let minD2 = Infinity;
        for (let j = 0; j < nGT; j++) {
            const dx = pointsGT[j * 3] - px;
            const dy = pointsGT[j * 3 + 1] - py;
            const dz = pointsGT[j * 3 + 2] - pz;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < minD2) minD2 = d2;
            if (d2 < t2) break; // early exit
        }
        if (minD2 < t2) precisionHits++;
    }

    // Recall: for each GT point, is there a predicted point within threshold?
    let recallHits = 0;
    for (let i = 0; i < nGT; i++) {
        const px = pointsGT[i * 3], py = pointsGT[i * 3 + 1], pz = pointsGT[i * 3 + 2];
        let minD2 = Infinity;
        for (let j = 0; j < nPred; j++) {
            const dx = pointsPred[j * 3] - px;
            const dy = pointsPred[j * 3 + 1] - py;
            const dz = pointsPred[j * 3 + 2] - pz;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < minD2) minD2 = d2;
            if (d2 < t2) break;
        }
        if (minD2 < t2) recallHits++;
    }

    const precision = precisionHits / nPred;
    const recall = recallHits / nGT;
    const f = (precision + recall > 0) ? 2 * precision * recall / (precision + recall) : 0;

    return { fScore: f, precision, recall };
}


// ============================================================================
// HELPERS
// ============================================================================

function _computeBBox(positions) {
    const n = (positions.length / 3) | 0;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
        const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
        if (x < min[0]) min[0] = x; if (x > max[0]) max[0] = x;
        if (y < min[1]) min[1] = y; if (y > max[1]) max[1] = y;
        if (z < min[2]) min[2] = z; if (z > max[2]) max[2] = z;
    }
    return { min, max };
}

function _voxelizeMeshOnGrid(positions, indices, resX, resY, resZ, origin, voxelSize, fillInterior) {
    const numFaces = (indices.length / 3) | 0;
    const grid = new Uint8Array(resX * resY * resZ);

    for (let f = 0; f < numFaces; f++) {
        const i0 = indices[f * 3] * 3;
        const i1 = indices[f * 3 + 1] * 3;
        const i2 = indices[f * 3 + 2] * 3;

        const v0x = positions[i0], v0y = positions[i0 + 1], v0z = positions[i0 + 2];
        const v1x = positions[i1], v1y = positions[i1 + 1], v1z = positions[i1 + 2];
        const v2x = positions[i2], v2y = positions[i2 + 1], v2z = positions[i2 + 2];

        const minVX = Math.max(0, Math.floor((Math.min(v0x, v1x, v2x) - origin[0]) / voxelSize));
        const minVY = Math.max(0, Math.floor((Math.min(v0y, v1y, v2y) - origin[1]) / voxelSize));
        const minVZ = Math.max(0, Math.floor((Math.min(v0z, v1z, v2z) - origin[2]) / voxelSize));
        const maxVX = Math.min(resX - 1, Math.floor((Math.max(v0x, v1x, v2x) - origin[0]) / voxelSize));
        const maxVY = Math.min(resY - 1, Math.floor((Math.max(v0y, v1y, v2y) - origin[1]) / voxelSize));
        const maxVZ = Math.min(resZ - 1, Math.floor((Math.max(v0z, v1z, v2z) - origin[2]) / voxelSize));

        for (let vz = minVZ; vz <= maxVZ; vz++) {
            for (let vy = minVY; vy <= maxVY; vy++) {
                for (let vx = minVX; vx <= maxVX; vx++) {
                    grid[vx + vy * resX + vz * resX * resY] = 1;
                }
            }
        }
    }

    if (fillInterior) {
        _floodFillExterior(grid, resX, resY, resZ);
    }

    return grid;
}

function _floodFillExterior(grid, resX, resY, resZ) {
    const visited = new Uint8Array(resX * resY * resZ);
    const queue = [];

    for (let z = 0; z < resZ; z++) {
        for (let y = 0; y < resY; y++) {
            for (let x = 0; x < resX; x++) {
                if (x === 0 || x === resX - 1 || y === 0 || y === resY - 1 || z === 0 || z === resZ - 1) {
                    const idx = x + y * resX + z * resX * resY;
                    if (!grid[idx]) { visited[idx] = 1; queue.push(idx); }
                }
            }
        }
    }

    let head = 0;
    while (head < queue.length) {
        const idx = queue[head++];
        const x = idx % resX;
        const y = ((idx / resX) | 0) % resY;
        const z = (idx / (resX * resY)) | 0;

        const neighbors = [
            x > 0       ? idx - 1 : -1,
            x < resX-1  ? idx + 1 : -1,
            y > 0       ? idx - resX : -1,
            y < resY-1  ? idx + resX : -1,
            z > 0       ? idx - resX*resY : -1,
            z < resZ-1  ? idx + resX*resY : -1,
        ];

        for (const ni of neighbors) {
            if (ni < 0 || visited[ni] || grid[ni]) continue;
            visited[ni] = 1;
            queue.push(ni);
        }
    }

    for (let i = 0; i < grid.length; i++) {
        if (!grid[i] && !visited[i]) grid[i] = 1;
    }
}
