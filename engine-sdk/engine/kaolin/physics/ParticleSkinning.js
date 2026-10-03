/**
 * ParticleSkinning.js — Learned reduced deformation basis from particle sim
 *
 * Inspired by NVIDIA Simplicits: learn a small set of skinning weights
 * that approximate the full FEM simulation at a fraction of the cost.
 *
 * Pipeline:
 *   1. Run full sim for N frames → capture deformation snapshots
 *   2. PCA on displacement field → extract dominant deformation modes
 *   3. Compute skinning weights via least-squares fitting
 *   4. At runtime: blend modes with learned weights → fast approximate deformation
 *
 * This enables:
 *   - Real-time soft body preview without FEM solve
 *   - LOD: near = full FEM, far = skinned approximation
 *   - Baking physics to animation for replay
 *
 * Compatible with:
 *   - GPUSoftBody.js — reads back node positions for training
 *   - EntityMeshRenderer — applies skinned deformation to visual mesh
 *   - SkeletalAnimation.js — similar weight/bone concept
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const EPSILON = 1e-7;

// ============================================================================
// DEFORMATION CAPTURE
// ============================================================================

/**
 * Capture deformation snapshots from a running soft body.
 * Call this each frame during a training run.
 *
 * @returns {DeformationCapture} — accumulates snapshots
 */
export function createDeformationCapture(restPositions) {
    const numNodes = (restPositions.length / 3) | 0;
    return {
        restPositions: new Float32Array(restPositions),
        numNodes,
        snapshots: [],     // each: Float32Array of displacements (stride 3)
        maxSnapshots: 500,
    };
}

/**
 * Record a frame's deformed positions.
 *
 * @param {DeformationCapture} capture
 * @param {Float32Array}       currentPositions — deformed node positions (stride 3)
 */
export function captureFrame(capture, currentPositions) {
    if (capture.snapshots.length >= capture.maxSnapshots) return;

    const { restPositions, numNodes } = capture;
    const displacement = new Float32Array(numNodes * 3);

    for (let i = 0; i < numNodes; i++) {
        displacement[i * 3]     = currentPositions[i * 3]     - restPositions[i * 3];
        displacement[i * 3 + 1] = currentPositions[i * 3 + 1] - restPositions[i * 3 + 1];
        displacement[i * 3 + 2] = currentPositions[i * 3 + 2] - restPositions[i * 3 + 2];
    }

    capture.snapshots.push(displacement);
}


// ============================================================================
// PCA — EXTRACT DEFORMATION MODES
// ============================================================================

/**
 * Extract dominant deformation modes via PCA on displacement snapshots.
 *
 * @param {DeformationCapture} capture — with accumulated snapshots
 * @param {number}             numModes — number of modes to extract (default 8)
 * @returns {{ modes: Float32Array[], eigenvalues: Float32Array, meanDisplacement: Float32Array }}
 */
export function extractDeformationModes(capture, numModes = 8) {
    const { snapshots, numNodes } = capture;
    const numFrames = snapshots.length;
    const dim = numNodes * 3;

    if (numFrames < 2) {
        return { modes: [], eigenvalues: new Float32Array(0), meanDisplacement: new Float32Array(dim) };
    }

    numModes = Math.min(numModes, numFrames - 1, dim);

    // Compute mean displacement
    const mean = new Float32Array(dim);
    for (const snap of snapshots) {
        for (let i = 0; i < dim; i++) mean[i] += snap[i];
    }
    for (let i = 0; i < dim; i++) mean[i] /= numFrames;

    // Build data matrix (centered) — each column is a snapshot
    // For efficiency, compute covariance in snapshot space (numFrames × numFrames)
    // instead of node space (dim × dim), since numFrames << dim typically.
    const covSmall = new Float64Array(numFrames * numFrames);

    for (let i = 0; i < numFrames; i++) {
        for (let j = i; j < numFrames; j++) {
            let dot = 0;
            for (let k = 0; k < dim; k++) {
                dot += (snapshots[i][k] - mean[k]) * (snapshots[j][k] - mean[k]);
            }
            dot /= numFrames;
            covSmall[i * numFrames + j] = dot;
            covSmall[j * numFrames + i] = dot;
        }
    }

    // Eigendecomposition of small covariance (power iteration)
    const eigenvalues = new Float32Array(numModes);
    const smallVecs = [];

    // Deflated power iteration
    const tempCov = new Float64Array(covSmall);

    for (let m = 0; m < numModes; m++) {
        // Power iteration for dominant eigenvector
        let vec = new Float64Array(numFrames);
        for (let i = 0; i < numFrames; i++) vec[i] = Math.random() - 0.5;
        _normalize(vec);

        for (let iter = 0; iter < 100; iter++) {
            const newVec = new Float64Array(numFrames);
            for (let i = 0; i < numFrames; i++) {
                let sum = 0;
                for (let j = 0; j < numFrames; j++) {
                    sum += tempCov[i * numFrames + j] * vec[j];
                }
                newVec[i] = sum;
            }

            // Eigenvalue estimate
            let lambda = 0;
            for (let i = 0; i < numFrames; i++) lambda += newVec[i] * vec[i];

            _normalize(newVec);

            // Convergence check
            let diff = 0;
            for (let i = 0; i < numFrames; i++) diff += (newVec[i] - vec[i]) ** 2;
            vec = newVec;
            if (diff < 1e-10) break;
        }

        // Compute eigenvalue
        let lambda = 0;
        const Av = new Float64Array(numFrames);
        for (let i = 0; i < numFrames; i++) {
            let sum = 0;
            for (let j = 0; j < numFrames; j++) sum += tempCov[i * numFrames + j] * vec[j];
            Av[i] = sum;
        }
        for (let i = 0; i < numFrames; i++) lambda += Av[i] * vec[i];

        eigenvalues[m] = lambda;
        smallVecs.push(new Float64Array(vec));

        // Deflate
        for (let i = 0; i < numFrames; i++) {
            for (let j = 0; j < numFrames; j++) {
                tempCov[i * numFrames + j] -= lambda * vec[i] * vec[j];
            }
        }
    }

    // Convert small eigenvectors back to full-space modes
    const modes = [];
    for (let m = 0; m < numModes; m++) {
        const mode = new Float32Array(dim);
        for (let f = 0; f < numFrames; f++) {
            const w = smallVecs[m][f];
            for (let k = 0; k < dim; k++) {
                mode[k] += w * (snapshots[f][k] - mean[k]);
            }
        }
        // Normalize mode
        let len = 0;
        for (let k = 0; k < dim; k++) len += mode[k] * mode[k];
        len = Math.sqrt(len);
        if (len > EPSILON) {
            for (let k = 0; k < dim; k++) mode[k] /= len;
        }
        modes.push(mode);
    }

    return { modes, eigenvalues, meanDisplacement: mean };
}


// ============================================================================
// SKINNING WEIGHT COMPUTATION
// ============================================================================

/**
 * Compute skinning weights for each node per deformation mode.
 * Uses least-squares: for each snapshot, find mode weights that best
 * reconstruct the displacement.
 *
 * @param {Object} decomposition — from extractDeformationModes
 * @param {DeformationCapture} capture
 * @returns {{ weights: Float32Array, numModes: number, numNodes: number }}
 *   weights: [numNodes × numModes] row-major
 */
export function computeSkinningWeights(decomposition, capture) {
    const { modes, meanDisplacement } = decomposition;
    const { snapshots, numNodes } = capture;
    const numModes = modes.length;
    const numFrames = snapshots.length;
    const dim = numNodes * 3;

    if (numModes === 0 || numFrames === 0) {
        return { weights: new Float32Array(0), numModes: 0, numNodes };
    }

    // For each snapshot, compute mode coefficients via dot product
    // coeffs[f][m] = dot(centered_snapshot_f, mode_m)
    const allCoeffs = [];
    for (let f = 0; f < numFrames; f++) {
        const coeffs = new Float32Array(numModes);
        for (let m = 0; m < numModes; m++) {
            let dot = 0;
            for (let k = 0; k < dim; k++) {
                dot += (snapshots[f][k] - meanDisplacement[k]) * modes[m][k];
            }
            coeffs[m] = dot;
        }
        allCoeffs.push(coeffs);
    }

    // Per-node weights: how much each mode affects each node
    // Simple approach: for each node, weight[m] = average |coeff[m]| × |mode[m] at node|
    const weights = new Float32Array(numNodes * numModes);

    for (let n = 0; n < numNodes; n++) {
        for (let m = 0; m < numModes; m++) {
            // Mode magnitude at this node
            const mx = modes[m][n * 3];
            const my = modes[m][n * 3 + 1];
            const mz = modes[m][n * 3 + 2];
            const modeMag = Math.sqrt(mx * mx + my * my + mz * mz);

            // Average coefficient magnitude across frames
            let avgCoeff = 0;
            for (let f = 0; f < numFrames; f++) {
                avgCoeff += Math.abs(allCoeffs[f][m]);
            }
            avgCoeff /= numFrames;

            weights[n * numModes + m] = modeMag * avgCoeff;
        }

        // Normalize weights per node
        let sum = 0;
        for (let m = 0; m < numModes; m++) sum += weights[n * numModes + m];
        if (sum > EPSILON) {
            for (let m = 0; m < numModes; m++) weights[n * numModes + m] /= sum;
        }
    }

    return { weights, numModes, numNodes };
}


// ============================================================================
// RUNTIME DEFORMATION
// ============================================================================

/**
 * Create a runtime skinning evaluator.
 *
 * @param {Float32Array}   restPositions — stride 3
 * @param {Float32Array[]} modes — from extractDeformationModes
 * @param {Float32Array}   meanDisplacement — from extractDeformationModes
 * @returns {SkinningEvaluator}
 */
export function createSkinningEvaluator(restPositions, modes, meanDisplacement) {
    const numNodes = (restPositions.length / 3) | 0;
    const numModes = modes.length;

    return {
        restPositions: new Float32Array(restPositions),
        modes,
        meanDisplacement: new Float32Array(meanDisplacement),
        numNodes,
        numModes,
        coefficients: new Float32Array(numModes),
        outputPositions: new Float32Array(numNodes * 3),
    };
}

/**
 * Evaluate skinned deformation with given mode coefficients.
 *
 * @param {SkinningEvaluator} evaluator
 * @param {Float32Array}      coefficients — length = numModes
 * @returns {Float32Array} — deformed positions (stride 3)
 */
export function evaluateSkinning(evaluator, coefficients) {
    const { restPositions, modes, meanDisplacement, numNodes, numModes, outputPositions } = evaluator;
    const dim = numNodes * 3;

    // output = rest + mean + Σ(coeff_m * mode_m)
    for (let k = 0; k < dim; k++) {
        let d = meanDisplacement[k];
        for (let m = 0; m < numModes; m++) {
            d += coefficients[m] * modes[m][k];
        }
        outputPositions[k] = restPositions[k] + d;
    }

    return outputPositions;
}

/**
 * Fit mode coefficients to match a target deformation (least-squares).
 * Useful for transitioning from full FEM to skinned approximation.
 *
 * @param {SkinningEvaluator} evaluator
 * @param {Float32Array}      targetPositions — deformed positions to match
 * @returns {Float32Array} — optimal coefficients
 */
export function fitCoefficients(evaluator, targetPositions) {
    const { restPositions, modes, meanDisplacement, numNodes, numModes } = evaluator;
    const dim = numNodes * 3;
    const coeffs = new Float32Array(numModes);

    // Compute target displacement minus mean
    const residual = new Float32Array(dim);
    for (let k = 0; k < dim; k++) {
        residual[k] = targetPositions[k] - restPositions[k] - meanDisplacement[k];
    }

    // Project onto each mode (since modes are orthonormal)
    for (let m = 0; m < numModes; m++) {
        let dot = 0;
        for (let k = 0; k < dim; k++) {
            dot += residual[k] * modes[m][k];
        }
        coeffs[m] = dot;
    }

    return coeffs;
}


// ============================================================================
// BAKE TO ANIMATION
// ============================================================================

/**
 * Bake deformation snapshots into mode coefficient keyframes.
 * Output can drive the skinning evaluator for replay without physics.
 *
 * @param {DeformationCapture} capture
 * @param {Object}             decomposition — from extractDeformationModes
 * @param {number}             fps — frames per second of capture (default 60)
 * @returns {{ keyframes: Float32Array[], times: Float32Array, numModes: number }}
 */
export function bakeToAnimation(capture, decomposition, fps = 60) {
    const { modes, meanDisplacement } = decomposition;
    const { snapshots } = capture;
    const numModes = modes.length;
    const numFrames = snapshots.length;
    const dim = capture.numNodes * 3;

    const keyframes = [];
    const times = new Float32Array(numFrames);

    for (let f = 0; f < numFrames; f++) {
        times[f] = f / fps;
        const coeffs = new Float32Array(numModes);

        for (let m = 0; m < numModes; m++) {
            let dot = 0;
            for (let k = 0; k < dim; k++) {
                dot += (snapshots[f][k] - meanDisplacement[k]) * modes[m][k];
            }
            coeffs[m] = dot;
        }

        keyframes.push(coeffs);
    }

    return { keyframes, times, numModes };
}

/**
 * Interpolate baked animation at a given time.
 *
 * @param {Object} animation — from bakeToAnimation
 * @param {number} time — seconds
 * @returns {Float32Array} — interpolated coefficients
 */
export function sampleAnimation(animation, time) {
    const { keyframes, times, numModes } = animation;
    const numFrames = times.length;

    if (numFrames === 0) return new Float32Array(numModes);
    if (time <= times[0]) return new Float32Array(keyframes[0]);
    if (time >= times[numFrames - 1]) return new Float32Array(keyframes[numFrames - 1]);

    // Binary search for frame
    let lo = 0, hi = numFrames - 1;
    while (lo < hi - 1) {
        const mid = (lo + hi) >>> 1;
        if (times[mid] <= time) lo = mid;
        else hi = mid;
    }

    const t = (time - times[lo]) / (times[hi] - times[lo]);
    const result = new Float32Array(numModes);
    for (let m = 0; m < numModes; m++) {
        result[m] = keyframes[lo][m] * (1 - t) + keyframes[hi][m] * t;
    }

    return result;
}


// ============================================================================
// INTERNAL HELPERS
// ============================================================================

function _normalize(vec) {
    let len = 0;
    for (let i = 0; i < vec.length; i++) len += vec[i] * vec[i];
    len = Math.sqrt(len);
    if (len > EPSILON) {
        for (let i = 0; i < vec.length; i++) vec[i] /= len;
    }
}
