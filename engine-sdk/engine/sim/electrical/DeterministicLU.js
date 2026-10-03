// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const DETERMINISTIC_LU_MAXIMUM_SIZE = 128;

const DEFAULT_ABSOLUTE_PIVOT_TOLERANCE = 1e-15;

function finiteNonNegative(value, fallback, label) {
    if (value == null) return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new RangeError(label + ' must be a finite non-negative number');
    }
    return value;
}

function requireSize(value, label = 'matrix size') {
    const size = Number(value);
    if (!Number.isSafeInteger(size) || size < 1 || size > DETERMINISTIC_LU_MAXIMUM_SIZE) {
        throw new RangeError(
            label + ' must be a safe integer in [1, ' +
            DETERMINISTIC_LU_MAXIMUM_SIZE + ']',
        );
    }
    return size;
}

function matrixCopy(value, sizeHint) {
    if (Array.isArray(value) && value.length > 0 &&
        (Array.isArray(value[0]) || ArrayBuffer.isView(value[0]))) {
        const size = requireSize(sizeHint ?? value.length);
        if (value.length !== size) throw new RangeError('matrix row count does not match size');
        const matrix = new Float64Array(size * size);
        for (let row = 0; row < size; row += 1) {
            if (!Array.isArray(value[row]) && !ArrayBuffer.isView(value[row])) {
                throw new TypeError('matrix row ' + row + ' must be an array');
            }
            if (value[row].length !== size) {
                throw new RangeError('matrix row ' + row + ' length does not match size');
            }
            for (let column = 0; column < size; column += 1) {
                const entry = value[row][column];
                if (typeof entry !== 'number' || !Number.isFinite(entry)) {
                    return {
                        ok: false,
                        size,
                        diagnostic: numericalDiagnostic(
                            'ELECTRICAL_LU_NONFINITE_MATRIX',
                            'Matrix contains a non-finite entry',
                            { row, column, value: String(entry) },
                        ),
                    };
                }
                matrix[row * size + column] = entry;
            }
        }
        return { ok: true, size, matrix };
    }

    if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
        throw new TypeError('matrix must be a flat or nested numeric array');
    }
    const length = value.length;
    const inferred = Math.sqrt(length);
    const size = requireSize(sizeHint ?? inferred);
    if (size * size !== length) {
        throw new RangeError('flat matrix length must equal size squared');
    }
    const matrix = new Float64Array(length);
    for (let index = 0; index < length; index += 1) {
        const entry = value[index];
        if (typeof entry !== 'number' || !Number.isFinite(entry)) {
            return {
                ok: false,
                size,
                diagnostic: numericalDiagnostic(
                    'ELECTRICAL_LU_NONFINITE_MATRIX',
                    'Matrix contains a non-finite entry',
                    {
                        row: Math.floor(index / size),
                        column: index % size,
                        value: String(entry),
                    },
                ),
            };
        }
        matrix[index] = entry;
    }
    return { ok: true, size, matrix };
}

function vectorCopy(value, size, label) {
    if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
        throw new TypeError(label + ' must be a numeric array');
    }
    if (value.length !== size) {
        throw new RangeError(label + ' length must equal matrix size');
    }
    const vector = new Float64Array(size);
    for (let index = 0; index < size; index += 1) {
        const entry = value[index];
        if (typeof entry !== 'number' || !Number.isFinite(entry)) {
            return {
                ok: false,
                diagnostic: numericalDiagnostic(
                    'ELECTRICAL_LU_NONFINITE_VECTOR',
                    label + ' contains a non-finite entry',
                    { index, value: String(entry) },
                ),
            };
        }
        vector[index] = entry;
    }
    return { ok: true, vector };
}

function numericalDiagnostic(code, message, details = null) {
    return Object.freeze({
        code,
        message,
        details: details == null ? null : Object.freeze({ ...details }),
    });
}

function failedFactorization(size, diagnostic, original = null) {
    return Object.freeze({
        ok: false,
        size,
        lu: null,
        original,
        permutation: null,
        pivotRows: null,
        pivotThreshold: null,
        minimumPivotMagnitude: null,
        diagnostic,
    });
}

/**
 * Deterministically factor a dense row-major matrix using partial pivoting.
 *
 * Candidate pivots are visited from the current row upward and replaced only
 * by a strictly larger magnitude. Exact ties therefore retain the lowest row.
 * The caller's matrix is never mutated.
 */
export function factorDeterministicLU(matrixValue, sizeHint = null, options = {}) {
    const normalized = matrixCopy(matrixValue, sizeHint);
    if (!normalized.ok) {
        return failedFactorization(normalized.size, normalized.diagnostic);
    }
    const { size, matrix: original } = normalized;
    const lu = original.slice();
    const permutation = new Uint32Array(size);
    const pivotRows = new Uint32Array(size);
    for (let index = 0; index < size; index += 1) permutation[index] = index;

    let maximumMagnitude = 0;
    for (const entry of lu) maximumMagnitude = Math.max(maximumMagnitude, Math.abs(entry));
    const absolutePivotTolerance = finiteNonNegative(
        options.absolutePivotTolerance,
        DEFAULT_ABSOLUTE_PIVOT_TOLERANCE,
        'absolutePivotTolerance',
    );
    const relativePivotTolerance = finiteNonNegative(
        options.relativePivotTolerance,
        Number.EPSILON * size * 8,
        'relativePivotTolerance',
    );
    const pivotThreshold = Math.max(
        absolutePivotTolerance,
        relativePivotTolerance * maximumMagnitude,
    );
    let minimumPivotMagnitude = Infinity;

    for (let pivot = 0; pivot < size; pivot += 1) {
        let pivotRow = pivot;
        let pivotMagnitude = Math.abs(lu[pivot * size + pivot]);
        for (let row = pivot + 1; row < size; row += 1) {
            const magnitude = Math.abs(lu[row * size + pivot]);
            if (magnitude > pivotMagnitude) {
                pivotMagnitude = magnitude;
                pivotRow = row;
            }
        }
        pivotRows[pivot] = pivotRow;
        if (!Number.isFinite(pivotMagnitude)) {
            return failedFactorization(
                size,
                numericalDiagnostic(
                    'ELECTRICAL_LU_NONFINITE_PIVOT',
                    'LU factorization selected a non-finite pivot',
                    { pivot, pivotRow, pivotMagnitude: String(pivotMagnitude) },
                ),
                original,
            );
        }
        if (pivotMagnitude <= pivotThreshold) {
            return failedFactorization(
                size,
                numericalDiagnostic(
                    'ELECTRICAL_LU_SINGULAR',
                    'Matrix is singular or below the configured pivot threshold',
                    { pivot, pivotRow, pivotMagnitude, pivotThreshold },
                ),
                original,
            );
        }
        if (pivotRow !== pivot) {
            for (let column = 0; column < size; column += 1) {
                const first = pivot * size + column;
                const second = pivotRow * size + column;
                const temporary = lu[first];
                lu[first] = lu[second];
                lu[second] = temporary;
            }
            const rowIdentity = permutation[pivot];
            permutation[pivot] = permutation[pivotRow];
            permutation[pivotRow] = rowIdentity;
        }

        const pivotValue = lu[pivot * size + pivot];
        minimumPivotMagnitude = Math.min(minimumPivotMagnitude, Math.abs(pivotValue));
        for (let row = pivot + 1; row < size; row += 1) {
            const rowOffset = row * size;
            const multiplier = lu[rowOffset + pivot] / pivotValue;
            if (!Number.isFinite(multiplier)) {
                return failedFactorization(
                    size,
                    numericalDiagnostic(
                        'ELECTRICAL_LU_NONFINITE_FACTOR',
                        'LU elimination produced a non-finite multiplier',
                        { pivot, row, value: String(multiplier) },
                    ),
                    original,
                );
            }
            lu[rowOffset + pivot] = multiplier;
            for (let column = pivot + 1; column < size; column += 1) {
                const index = rowOffset + column;
                lu[index] -= multiplier * lu[pivot * size + column];
                if (!Number.isFinite(lu[index])) {
                    return failedFactorization(
                        size,
                        numericalDiagnostic(
                            'ELECTRICAL_LU_NONFINITE_FACTOR',
                            'LU elimination produced a non-finite matrix entry',
                            { pivot, row, column, value: String(lu[index]) },
                        ),
                        original,
                    );
                }
            }
        }
    }

    return Object.freeze({
        ok: true,
        size,
        lu,
        original,
        permutation,
        pivotRows,
        pivotThreshold,
        minimumPivotMagnitude,
        diagnostic: null,
    });
}

function failedSolve(size, diagnostic, factorization = null) {
    return Object.freeze({
        ok: false,
        size,
        solution: null,
        factorization,
        residual: null,
        diagnostic,
    });
}

/**
 * Solve one right-hand side from a successful deterministic factorization.
 */
export function solveDeterministicLU(factorization, rightHandSide) {
    if (!factorization || typeof factorization !== 'object') {
        throw new TypeError('factorization is required');
    }
    if (!factorization.ok) {
        return failedSolve(
            factorization.size ?? 0,
            factorization.diagnostic ?? numericalDiagnostic(
                'ELECTRICAL_LU_FACTOR_REQUIRED',
                'A successful LU factorization is required',
            ),
            factorization,
        );
    }
    const { size, lu, permutation } = factorization;
    const normalizedRhs = vectorCopy(rightHandSide, size, 'rightHandSide');
    if (!normalizedRhs.ok) {
        return failedSolve(size, normalizedRhs.diagnostic, factorization);
    }
    const rhs = normalizedRhs.vector;
    const solution = new Float64Array(size);

    for (let row = 0; row < size; row += 1) {
        let value = rhs[permutation[row]];
        for (let column = 0; column < row; column += 1) {
            value -= lu[row * size + column] * solution[column];
        }
        if (!Number.isFinite(value)) {
            return failedSolve(
                size,
                numericalDiagnostic(
                    'ELECTRICAL_LU_NONFINITE_FORWARD',
                    'Forward substitution produced a non-finite value',
                    { row, value: String(value) },
                ),
                factorization,
            );
        }
        solution[row] = value;
    }
    for (let row = size - 1; row >= 0; row -= 1) {
        let value = solution[row];
        for (let column = row + 1; column < size; column += 1) {
            value -= lu[row * size + column] * solution[column];
        }
        const diagonal = lu[row * size + row];
        if (!Number.isFinite(diagonal) ||
            Math.abs(diagonal) <= factorization.pivotThreshold) {
            return failedSolve(
                size,
                numericalDiagnostic(
                    'ELECTRICAL_LU_SINGULAR_BACK_SUBSTITUTION',
                    'Back substitution encountered a singular diagonal',
                    { row, diagonal: String(diagonal) },
                ),
                factorization,
            );
        }
        value /= diagonal;
        if (!Number.isFinite(value)) {
            return failedSolve(
                size,
                numericalDiagnostic(
                    'ELECTRICAL_LU_NONFINITE_SOLUTION',
                    'Back substitution produced a non-finite solution',
                    { row, value: String(value) },
                ),
                factorization,
            );
        }
        solution[row] = value;
    }

    const residual = computeLinearResidual(
        factorization.original,
        solution,
        rhs,
        size,
    );
    if (!residual.ok) return failedSolve(size, residual.diagnostic, factorization);
    return Object.freeze({
        ok: true,
        size,
        solution,
        factorization,
        residual,
        diagnostic: null,
    });
}

/**
 * Compute deterministic absolute and normwise relative residual diagnostics.
 */
export function computeLinearResidual(matrixValue, solutionValue, rightHandSide, sizeHint = null) {
    const normalizedMatrix = matrixCopy(matrixValue, sizeHint);
    if (!normalizedMatrix.ok) {
        return Object.freeze({
            ok: false,
            size: normalizedMatrix.size,
            values: null,
            maximumAbsolute: null,
            l2Norm: null,
            relative: null,
            diagnostic: normalizedMatrix.diagnostic,
        });
    }
    const { size, matrix } = normalizedMatrix;
    const normalizedSolution = vectorCopy(solutionValue, size, 'solution');
    if (!normalizedSolution.ok) {
        return Object.freeze({
            ok: false,
            size,
            values: null,
            maximumAbsolute: null,
            l2Norm: null,
            relative: null,
            diagnostic: normalizedSolution.diagnostic,
        });
    }
    const normalizedRhs = vectorCopy(rightHandSide, size, 'rightHandSide');
    if (!normalizedRhs.ok) {
        return Object.freeze({
            ok: false,
            size,
            values: null,
            maximumAbsolute: null,
            l2Norm: null,
            relative: null,
            diagnostic: normalizedRhs.diagnostic,
        });
    }
    const solution = normalizedSolution.vector;
    const rhs = normalizedRhs.vector;
    const values = new Float64Array(size);
    let maximumAbsolute = 0;
    let sumSquares = 0;
    let matrixInfinityNorm = 0;
    let solutionInfinityNorm = 0;
    let rhsInfinityNorm = 0;

    for (let row = 0; row < size; row += 1) {
        let product = 0;
        let rowMagnitude = 0;
        for (let column = 0; column < size; column += 1) {
            const coefficient = matrix[row * size + column];
            product += coefficient * solution[column];
            rowMagnitude += Math.abs(coefficient);
        }
        const value = product - rhs[row];
        if (!Number.isFinite(value)) {
            return Object.freeze({
                ok: false,
                size,
                values: null,
                maximumAbsolute: null,
                l2Norm: null,
                relative: null,
                diagnostic: numericalDiagnostic(
                    'ELECTRICAL_LU_NONFINITE_RESIDUAL',
                    'Residual calculation produced a non-finite value',
                    { row, value: String(value) },
                ),
            });
        }
        values[row] = value;
        maximumAbsolute = Math.max(maximumAbsolute, Math.abs(value));
        sumSquares += value * value;
        matrixInfinityNorm = Math.max(matrixInfinityNorm, rowMagnitude);
        solutionInfinityNorm = Math.max(solutionInfinityNorm, Math.abs(solution[row]));
        rhsInfinityNorm = Math.max(rhsInfinityNorm, Math.abs(rhs[row]));
    }
    const denominator = matrixInfinityNorm * solutionInfinityNorm + rhsInfinityNorm;
    const relative = denominator > 0 ? maximumAbsolute / denominator : maximumAbsolute;
    return Object.freeze({
        ok: true,
        size,
        values,
        maximumAbsolute,
        l2Norm: Math.sqrt(sumSquares),
        relative,
        matrixInfinityNorm,
        solutionInfinityNorm,
        rhsInfinityNorm,
        diagnostic: null,
    });
}

/**
 * Factor and solve a dense linear system without mutating either input.
 */
export function solveDeterministicLinearSystem(
    matrixValue,
    rightHandSide,
    sizeHint = null,
    options = {},
) {
    const factorization = factorDeterministicLU(matrixValue, sizeHint, options);
    if (!factorization.ok) {
        return failedSolve(factorization.size, factorization.diagnostic, factorization);
    }
    return solveDeterministicLU(factorization, rightHandSide);
}

export const factorDenseMatrixLU = factorDeterministicLU;
export const solveDenseLinearSystem = solveDeterministicLinearSystem;
export const computeDeterministicResidual = computeLinearResidual;

export default solveDeterministicLinearSystem;
