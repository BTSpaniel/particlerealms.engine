// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// ============================================================================
// ProceduralSkeleton.js — Auto-generate skeleton + skin weights for arbitrary meshes
//
// Uses PCA to find principal axes, places bones along them, and computes
// smooth distance-based vertex weights (4 influences per vertex).
// Output format matches glTF import so it plugs directly into
// registerSkinnedMesh() / SkeletalAnimation.js.
// ============================================================================

import { vec3Length, vec3Sub } from '../../core/math/MathVec3.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Generate a procedural skeleton for an arbitrary mesh.
 *
 * Algorithm:
 *   1. Compute mesh centroid + covariance matrix
 *   2. PCA via Jacobi iteration → 3 principal axes sorted by extent
 *   3. Place bones along principal axis (chain), with optional branches
 *      along secondary axis if mesh is wide enough
 *   4. Compute per-vertex weights: 4 nearest bones, inverse-distance
 *   5. Build inverse bind matrices (identity rotation, translation only)
 *
 * @param {Float32Array|number[]} positions  — flat xyz array (N*3)
 * @param {Float32Array|number[]} normals    — flat xyz array (N*3)
 * @param {Object} [options]
 * @param {number} [options.boneSpacing=0.8]       — target distance between bones
 * @param {number} [options.minBones=2]             — minimum bone count on primary axis
 * @param {number} [options.maxBones=24]            — maximum bone count total
 * @param {number} [options.branchThreshold=0.35]   — secondary/primary extent ratio to add branches
 * @param {number} [options.weightFalloff=2.0]      — exponent for distance weight falloff
 * @returns {{ geo: {joints, weights}, skeleton: {jointCount, joints, inverseBindMatrices} }}
 */
export function generateProceduralSkeleton(positions, normals, options = {}) {
    const pos = positions instanceof Float32Array ? positions : new Float32Array(positions);
    const vertexCount = pos.length / 3;

    if (vertexCount < 3) {
        return _singleBoneFallback(vertexCount);
    }

    const {
        boneSpacing   = 0.8,
        minBones      = 2,
        maxBones      = 24,
        branchThreshold = 0.35,
        weightFalloff = 2.0,
    } = options;

    // ------------------------------------------------------------------
    // 1. Centroid
    // ------------------------------------------------------------------
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < pos.length; i += 3) {
        cx += pos[i]; cy += pos[i + 1]; cz += pos[i + 2];
    }
    cx /= vertexCount; cy /= vertexCount; cz /= vertexCount;

    // ------------------------------------------------------------------
    // 2. Covariance matrix (symmetric 3×3)
    // ------------------------------------------------------------------
    let cxx = 0, cxy = 0, cxz = 0, cyy = 0, cyz = 0, czz = 0;
    for (let i = 0; i < pos.length; i += 3) {
        const dx = pos[i] - cx, dy = pos[i + 1] - cy, dz = pos[i + 2] - cz;
        cxx += dx * dx; cxy += dx * dy; cxz += dx * dz;
        cyy += dy * dy; cyz += dy * dz; czz += dz * dz;
    }
    const n1 = 1.0 / vertexCount;
    cxx *= n1; cxy *= n1; cxz *= n1; cyy *= n1; cyz *= n1; czz *= n1;

    // ------------------------------------------------------------------
    // 3. PCA via Jacobi eigenvalue iteration (3×3 symmetric)
    // ------------------------------------------------------------------
    const { eigenvalues, eigenvectors } = _jacobiEigen3x3(cxx, cxy, cxz, cyy, cyz, czz);

    // Sort axes by eigenvalue (descending) — largest variance first
    const order = [0, 1, 2].sort((a, b) => eigenvalues[b] - eigenvalues[a]);
    const axes = order.map(i => eigenvectors[i]);
    const extents = order.map(i => Math.sqrt(Math.max(0, eigenvalues[i])));

    // Compute actual min/max projection along each axis
    const axisRanges = axes.map((ax, ai) => {
        let mn = Infinity, mx = -Infinity;
        for (let i = 0; i < pos.length; i += 3) {
            const dx = pos[i] - cx, dy = pos[i + 1] - cy, dz = pos[i + 2] - cz;
            const proj = dx * ax[0] + dy * ax[1] + dz * ax[2];
            if (proj < mn) mn = proj;
            if (proj > mx) mx = proj;
        }
        return { min: mn, max: mx, length: mx - mn };
    });

    // ------------------------------------------------------------------
    // 4. Place bones along primary axis
    // ------------------------------------------------------------------
    const primaryLen = axisRanges[0].length;
    const primaryMin = axisRanges[0].min;
    const primaryMax = axisRanges[0].max;
    const primaryAxis = axes[0];

    let primaryCount = Math.max(minBones, Math.round(primaryLen / boneSpacing));
    primaryCount = Math.min(primaryCount, maxBones);

    const bonePositions = []; // [x, y, z] per bone
    const boneParents = [];   // parentIndex per bone (-1 for root)
    const boneNames = [];

    // Evenly spaced along primary axis, from min to max
    for (let i = 0; i < primaryCount; i++) {
        const t = primaryCount > 1 ? i / (primaryCount - 1) : 0.5;
        const proj = primaryMin + t * (primaryMax - primaryMin);
        bonePositions.push([
            cx + proj * primaryAxis[0],
            cy + proj * primaryAxis[1],
            cz + proj * primaryAxis[2],
        ]);
        boneParents.push(i === 0 ? -1 : i - 1);
        boneNames.push(`spine_${i}`);
    }

    // ------------------------------------------------------------------
    // 5. Branch bones along secondary axis (if mesh is wide enough)
    // ------------------------------------------------------------------
    const secondaryAxis = axes[1];
    const secondaryLen = axisRanges[1].length;
    const secondaryMin = axisRanges[1].min;
    const secondaryMax = axisRanges[1].max;
    const ratio = primaryLen > 0.001 ? secondaryLen / primaryLen : 0;

    if (ratio > branchThreshold && bonePositions.length + 4 <= maxBones) {
        // Add branch bones at ~25% and ~75% along primary axis
        const branchPoints = primaryCount >= 4
            ? [Math.floor(primaryCount * 0.25), Math.floor(primaryCount * 0.75)]
            : [Math.floor(primaryCount * 0.5)];

        for (const parentIdx of branchPoints) {
            const bp = bonePositions[parentIdx];
            // Positive side
            const posIdx = bonePositions.length;
            bonePositions.push([
                bp[0] + secondaryMax * secondaryAxis[0],
                bp[1] + secondaryMax * secondaryAxis[1],
                bp[2] + secondaryMax * secondaryAxis[2],
            ]);
            boneParents.push(parentIdx);
            boneNames.push(`branch_${parentIdx}_pos`);

            // Negative side
            bonePositions.push([
                bp[0] + secondaryMin * secondaryAxis[0],
                bp[1] + secondaryMin * secondaryAxis[1],
                bp[2] + secondaryMin * secondaryAxis[2],
            ]);
            boneParents.push(parentIdx);
            boneNames.push(`branch_${parentIdx}_neg`);

            if (bonePositions.length >= maxBones) break;
        }
    }

    // ------------------------------------------------------------------
    // 6. Tertiary axis branches (if mesh is deep enough and budget allows)
    // ------------------------------------------------------------------
    const tertiaryAxis = axes[2];
    const tertiaryLen = axisRanges[2].length;
    const tertiaryMin = axisRanges[2].min;
    const tertiaryMax = axisRanges[2].max;
    const tertiaryRatio = primaryLen > 0.001 ? tertiaryLen / primaryLen : 0;

    if (tertiaryRatio > branchThreshold && bonePositions.length + 2 <= maxBones) {
        const midIdx = Math.floor(primaryCount * 0.5);
        const bp = bonePositions[midIdx];
        bonePositions.push([
            bp[0] + tertiaryMax * tertiaryAxis[0],
            bp[1] + tertiaryMax * tertiaryAxis[1],
            bp[2] + tertiaryMax * tertiaryAxis[2],
        ]);
        boneParents.push(midIdx);
        boneNames.push(`depth_pos`);

        bonePositions.push([
            bp[0] + tertiaryMin * tertiaryAxis[0],
            bp[1] + tertiaryMin * tertiaryAxis[1],
            bp[2] + tertiaryMin * tertiaryAxis[2],
        ]);
        boneParents.push(midIdx);
        boneNames.push(`depth_neg`);
    }

    const jointCount = bonePositions.length;

    // ------------------------------------------------------------------
    // 7. Build per-vertex weights (4 nearest bones, inverse-distance)
    // ------------------------------------------------------------------
    const jointIndices = new Uint16Array(vertexCount * 4);
    const jointWeights = new Float32Array(vertexCount * 4);

    // Pre-allocate scratch for nearest-bone search
    const dists = new Float32Array(jointCount);

    for (let v = 0; v < vertexCount; v++) {
        const vx = pos[v * 3], vy = pos[v * 3 + 1], vz = pos[v * 3 + 2];

        // Compute distance to every bone
        for (let b = 0; b < jointCount; b++) {
            const bp = bonePositions[b];
            const dx = vx - bp[0], dy = vy - bp[1], dz = vz - bp[2];
            dists[b] = Math.sqrt(dx * dx + dy * dy + dz * dz);
        }

        // Find 4 nearest bones
        const nearest = _findKNearest(dists, jointCount, 4);
        const v4 = v * 4;

        // Inverse-distance weighting with falloff exponent
        let totalW = 0;
        for (let k = 0; k < 4; k++) {
            const bi = nearest[k];
            jointIndices[v4 + k] = bi;
            // Avoid division by zero; add small epsilon
            const d = Math.max(dists[bi], 0.0001);
            const w = 1.0 / Math.pow(d, weightFalloff);
            jointWeights[v4 + k] = w;
            totalW += w;
        }
        // Normalize weights to sum to 1.0
        if (totalW > 0) {
            const inv = 1.0 / totalW;
            for (let k = 0; k < 4; k++) {
                jointWeights[v4 + k] *= inv;
            }
        }
    }

    // ------------------------------------------------------------------
    // 8. Build joints array + inverse bind matrices
    // ------------------------------------------------------------------
    const joints = [];
    const inverseBindMatrices = new Float32Array(jointCount * 16);

    for (let i = 0; i < jointCount; i++) {
        const bp = bonePositions[i];
        joints.push({
            name: boneNames[i],
            parentIndex: boneParents[i],
            nodeIndex: i,
            translation: [bp[0], bp[1], bp[2]],
            rotation: [0, 0, 0, 1], // identity quaternion
            scale: [1, 1, 1],
        });

        // Inverse bind matrix = inverse of translation-only matrix
        // For a translation matrix T(tx,ty,tz), inverse is T(-tx,-ty,-tz)
        const o = i * 16;
        // Identity
        inverseBindMatrices[o + 0] = 1;
        inverseBindMatrices[o + 5] = 1;
        inverseBindMatrices[o + 10] = 1;
        inverseBindMatrices[o + 15] = 1;
        // Negate translation
        inverseBindMatrices[o + 12] = -bp[0];
        inverseBindMatrices[o + 13] = -bp[1];
        inverseBindMatrices[o + 14] = -bp[2];
    }

    // ------------------------------------------------------------------
    // 9. Build local translations (relative to parent)
    // ------------------------------------------------------------------
    // registerSkinnedMesh expects joints[i].translation to be LOCAL (parent-relative)
    // since _computeSkinMatrices does: worldMat = parentWorld * localMat
    // But our inverseBindMatrices are world-space, so we need local translations.
    for (let i = 0; i < jointCount; i++) {
        const pi = boneParents[i];
        if (pi >= 0) {
            const pp = bonePositions[pi];
            const bp = bonePositions[i];
            joints[i].translation = vec3Sub(bp, pp);
        }
        // Root bones keep world-space translation (handled by rootTransform derivation)
    }

    console.log(`[ProceduralSkeleton] Generated ${jointCount} bones (${primaryCount} spine` +
        `${jointCount > primaryCount ? ` + ${jointCount - primaryCount} branches` : ''}) ` +
        `for ${vertexCount} vertices, primaryLen=${primaryLen.toFixed(2)}`);

    return {
        geo: { joints: jointIndices, weights: jointWeights },
        skeleton: { jointCount, joints, inverseBindMatrices },
    };
}

/**
 * Convenience: generate skeleton AND augment geo object in-place.
 * Returns the skeleton object for passing to registerSkinnedMesh.
 *
 * @param {{ positions, normals, uvs?, indices? }} geo
 * @param {Object} [options] — same as generateProceduralSkeleton
 * @returns {{ skeleton, animations }}
 */
export function augmentGeoWithSkeleton(geo, options) {
    const result = generateProceduralSkeleton(geo.positions, geo.normals, options);
    geo.joints = result.geo.joints;
    geo.weights = result.geo.weights;
    return { skeleton: result.skeleton, animations: [] };
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Fallback: single bone at origin for degenerate meshes.
 */
function _singleBoneFallback(vertexCount) {
    const jointIndices = new Uint16Array(vertexCount * 4); // all 0
    const jointWeights = new Float32Array(vertexCount * 4);
    for (let v = 0; v < vertexCount; v++) {
        jointWeights[v * 4] = 1.0; // full weight on bone 0
    }
    const inverseBindMatrices = new Float32Array(16);
    inverseBindMatrices[0] = 1; inverseBindMatrices[5] = 1;
    inverseBindMatrices[10] = 1; inverseBindMatrices[15] = 1;

    return {
        geo: { joints: jointIndices, weights: jointWeights },
        skeleton: {
            jointCount: 1,
            joints: [{
                name: 'root',
                parentIndex: -1,
                nodeIndex: 0,
                translation: [0, 0, 0],
                rotation: [0, 0, 0, 1],
                scale: [1, 1, 1],
            }],
            inverseBindMatrices,
        },
    };
}

/**
 * Find indices of K smallest values in a distance array.
 */
function _findKNearest(dists, count, k) {
    // For small k and moderate bone count, partial insertion sort is fast enough
    const result = new Uint16Array(k);
    const resultDist = new Float32Array(k);
    resultDist.fill(Infinity);

    for (let b = 0; b < count; b++) {
        const d = dists[b];
        // Find insertion point in sorted result
        let insertAt = -1;
        for (let i = k - 1; i >= 0; i--) {
            if (d < resultDist[i]) insertAt = i;
            else break;
        }
        if (insertAt >= 0) {
            // Shift right
            for (let i = k - 1; i > insertAt; i--) {
                result[i] = result[i - 1];
                resultDist[i] = resultDist[i - 1];
            }
            result[insertAt] = b;
            resultDist[insertAt] = d;
        }
    }
    return result;
}

/**
 * Jacobi eigenvalue iteration for a 3×3 symmetric matrix.
 * Returns { eigenvalues: [3], eigenvectors: [[3],[3],[3]] }
 *
 * Input: upper-triangle of symmetric matrix
 *   | cxx cxy cxz |
 *   | cxy cyy cyz |
 *   | cxz cyz czz |
 */
function _jacobiEigen3x3(cxx, cxy, cxz, cyy, cyz, czz) {
    // Work with a mutable 3×3 (row-major flat)
    const a = [cxx, cxy, cxz, cxy, cyy, cyz, cxz, cyz, czz];
    // Eigenvector matrix (starts as identity)
    const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];

    const MAX_ITER = 50;
    for (let iter = 0; iter < MAX_ITER; iter++) {
        // Find largest off-diagonal element
        let maxVal = 0, p = 0, q = 1;
        const offDiag = [[0,1],[0,2],[1,2]];
        for (const [i, j] of offDiag) {
            const val = Math.abs(a[i * 3 + j]);
            if (val > maxVal) { maxVal = val; p = i; q = j; }
        }
        if (maxVal < 1e-12) break; // converged

        // Compute rotation angle
        const app = a[p * 3 + p], aqq = a[q * 3 + q], apq = a[p * 3 + q];
        let theta;
        if (Math.abs(app - aqq) < 1e-15) {
            theta = Math.PI / 4;
        } else {
            theta = 0.5 * Math.atan2(2 * apq, app - aqq);
        }
        const c = Math.cos(theta), s = Math.sin(theta);

        // Apply Givens rotation: A' = G^T * A * G
        // Update matrix A
        const newA = a.slice();
        newA[p * 3 + p] = c * c * app + 2 * s * c * apq + s * s * aqq;
        newA[q * 3 + q] = s * s * app - 2 * s * c * apq + c * c * aqq;
        newA[p * 3 + q] = 0;
        newA[q * 3 + p] = 0;

        // Update off-diagonal elements involving p or q
        for (let r = 0; r < 3; r++) {
            if (r === p || r === q) continue;
            const arp = a[r * 3 + p], arq = a[r * 3 + q];
            newA[r * 3 + p] = c * arp + s * arq;
            newA[p * 3 + r] = newA[r * 3 + p];
            newA[r * 3 + q] = -s * arp + c * arq;
            newA[q * 3 + r] = newA[r * 3 + q];
        }
        for (let i = 0; i < 9; i++) a[i] = newA[i];

        // Accumulate eigenvectors: V' = V * G
        const newV = v.slice();
        for (let r = 0; r < 3; r++) {
            const vrp = v[r * 3 + p], vrq = v[r * 3 + q];
            newV[r * 3 + p] = c * vrp + s * vrq;
            newV[r * 3 + q] = -s * vrp + c * vrq;
        }
        for (let i = 0; i < 9; i++) v[i] = newV[i];
    }

    // Extract eigenvalues and eigenvectors
    const eigenvalues = [a[0], a[4], a[8]];
    const eigenvectors = [
        [v[0], v[3], v[6]], // column 0
        [v[1], v[4], v[7]], // column 1
        [v[2], v[5], v[8]], // column 2
    ];

    // Normalize eigenvectors
    for (let i = 0; i < 3; i++) {
        const ev = eigenvectors[i];
        const len = vec3Length(ev) || 1;
        ev[0] /= len; ev[1] /= len; ev[2] /= len;
    }

    return { eigenvalues, eigenvectors };
}
