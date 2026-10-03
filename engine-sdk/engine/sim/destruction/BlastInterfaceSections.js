// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { vec3Cross, vec3Dot, vec3Sub } from '../../core/math/MathVec3.js';

const vector = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(Number.isFinite);
const positive = value => Number.isFinite(value) && value > 0;

// Row-major displacement jump: u + theta cross r. Generalized wrench order
// is [Fx,Fy,Fz,Mx,My,Mz], dual to [ux,uy,uz,thetaX,thetaY,thetaZ].
function jumpMatrix([x, y, z]) {
    return [1, 0, 0, 0, z, -y, 0, 1, 0, -z, 0, x, 0, 0, 1, y, -x, 0];
}

function multiply(a, b, rows, inner, columns) {
    const result = Array(rows * columns).fill(0);
    for (let row = 0; row < rows; ++row) for (let column = 0; column < columns; ++column)
        for (let i = 0; i < inner; ++i) result[row * columns + column] += a[row * inner + i] * b[i * columns + column];
    return result;
}

/** Positive-definite six-axis interface energy, equilibrated for unlike SI
 * units. Reject singular sections rather than adding fictitious stiffness. */
function inverseSection(matrix) {
    const scales = [0, 1, 2, 3, 4, 5].map(axis => Math.sqrt(matrix[axis * 6 + axis]));
    if (!scales.every(positive)) throw new RangeError('Blast interface has no positive six-axis stiffness');
    const lower = Array(36).fill(0);
    for (let row = 0; row < 6; ++row) for (let column = 0; column <= row; ++column) {
        let value = matrix[row * 6 + column] / scales[row] / scales[column];
        for (let i = 0; i < column; ++i) value -= lower[row * 6 + i] * lower[column * 6 + i];
        if (row === column) {
            if (!positive(value)) throw new RangeError('Blast interface stiffness is not positive definite');
            lower[row * 6 + column] = Math.sqrt(value);
        } else lower[row * 6 + column] = value / lower[column * 6 + column];
    }
    const inverse = Array(36).fill(0);
    for (let column = 0; column < 6; ++column) {
        const solution = Array(6).fill(0);
        for (let row = 0; row < 6; ++row) {
            let value = row === column ? 1 / scales[row] : 0;
            for (let i = 0; i < row; ++i) value -= lower[row * 6 + i] * solution[i];
            solution[row] = value / lower[row * 6 + row];
        }
        for (let row = 5; row >= 0; --row) {
            let value = solution[row];
            for (let i = row + 1; i < 6; ++i) value -= lower[i * 6 + row] * solution[i];
            solution[row] = value / lower[row * 6 + row];
        }
        for (let row = 0; row < 6; ++row) inverse[row * 6 + column] = solution[row] / scales[row];
    }
    if (!inverse.every(Number.isFinite)) throw new RangeError('Blast interface compliance exceeds numerical precision');
    return inverse;
}

/** Integrate an elastic traction law over actual convex face patches. D has
 * units Pa/m, K maps displacement/rotation to N/Nm, and vertex maps recover
 * Pa from a physical wrench. Stiffness and strength are distinct inputs.
 * Three-point triangle quadrature is exact for this quadratic elastic energy.
 */
export function compileBlastInterfaceSection({ centroid, normal, patches }) {
    if (!vector(centroid) || !vector(normal) || Math.abs(Math.hypot(...normal) - 1) > 1e-10
        || !Array.isArray(patches) || !patches.length) throw new RangeError('Invalid Blast interface section geometry');
    const axis = normal.map(Math.abs).indexOf(Math.min(...normal.map(Math.abs))), reference = [0, 0, 0];
    reference[axis] = 1;
    const tangentRaw = vec3Cross(normal, reference), length = Math.hypot(...tangentRaw);
    const tangent = tangentRaw.map(value => value / length), secondTangent = vec3Cross(normal, tangent);
    const basis = [...normal, ...tangent, ...secondTangent], stiffness = Array(36).fill(0), compiled = [];
    let areaM2 = 0;
    for (const patch of patches) {
        const { vertices, normalStiffnessPaPerM: kn, shearStiffnessPaPerM: ks, strengthsPa } = patch;
        if (!Array.isArray(vertices) || vertices.length < 3 || !Array.from(vertices).every(vector) || !positive(kn) || !positive(ks))
            throw new RangeError('Blast interface needs a real polygon and positive traction stiffness in Pa/m');
        const capacities = ['compression', 'tension', 'shear'].flatMap(channel => {
            const values = strengthsPa?.[channel];
            if (!Array.isArray(values) || values.length !== 2 || !Array.from(values).every(Number.isFinite)
                || values[0] < 0 || values[1] <= values[0]) throw new RangeError('Invalid Blast interface strengths in Pa');
            return values;
        });
        const origin = vertices[0], extent = Math.max(...vertices.map(point => Math.hypot(...vec3Sub(point, origin))));
        if (!positive(extent) || vertices.some(point => Math.abs(vec3Dot(vec3Sub(point, origin), normal)) > extent * 1e-10))
            throw new RangeError('Blast interface polygon is not planar');
        for (let i = 0; i < vertices.length; ++i) {
            const edge = vec3Sub(vertices[(i + 1) % vertices.length], vertices[i]);
            if (!(Math.hypot(...edge) > 0) || vertices.some(point => vec3Dot(vec3Cross(edge, vec3Sub(point, vertices[i])), normal)
                < -extent * extent * Number.EPSILON * 64)) throw new RangeError('Blast interface polygon is not outward convex');
        }
        const constitutive = Array.from({ length: 9 }, (_, i) => (i % 4 === 0 ? ks : 0)
            + (kn - ks) * normal[Math.floor(i / 3)] * normal[i % 3]);
        let patchArea = 0;
        for (let i = 1; i + 1 < vertices.length; ++i) {
            const triangle = [origin, vertices[i], vertices[i + 1]];
            const signedArea = vec3Dot(vec3Cross(vec3Sub(triangle[1], origin), vec3Sub(triangle[2], origin)), normal) / 2;
            if (signedArea < 0) throw new RangeError('Blast interface polygon must face its bond normal');
            if (signedArea === 0) continue;
            patchArea += signedArea;
            for (let sample = 0; sample < 3; ++sample) {
                const point = [0, 1, 2].map(k => triangle.reduce((sum, vertex, j) => sum
                    + (vertex[k] - centroid[k]) * (j === sample ? 2 / 3 : 1 / 6), 0));
                const jump = jumpMatrix(point), law = multiply(constitutive, jump, 3, 3, 6);
                for (let row = 0; row < 6; ++row) for (let column = 0; column <= row; ++column) {
                    let value = 0;
                    for (let k = 0; k < 3; ++k) value += jump[k * 6 + row] * law[k * 6 + column];
                    stiffness[row * 6 + column] += value * signedArea / 3;
                }
            }
        }
        if (!positive(patchArea)) throw new RangeError('Blast interface polygon has no area');
        areaM2 += patchArea; compiled.push({ patch, constitutive, capacities });
    }
    for (let row = 0; row < 6; ++row) for (let column = 0; column < row; ++column)
        stiffness[column * 6 + row] = stiffness[row * 6 + column];
    if (!stiffness.every(Number.isFinite)) throw new RangeError('Blast interface stiffness exceeds numerical precision');
    const compliance = inverseSection(stiffness), samples = [], sampleOwners = [];
    for (const { patch, constitutive, capacities } of compiled) for (const vertex of patch.vertices) {
        const law = multiply(constitutive, jumpMatrix(vec3Sub(vertex, centroid)), 3, 3, 6);
        const tractionMap = multiply(basis, multiply(law, compliance, 3, 6, 6), 3, 3, 6);
        if (!tractionMap.every(Number.isFinite)) throw new RangeError('Blast interface traction exceeds numerical precision');
        samples.push([...tractionMap, ...capacities]); sampleOwners.push(patch.owner);
    }
    return { stiffness, samples, sampleOwners, areaM2 };
}

/** Copy checkpoint-safe immutable native configuration before allocation. */
export function validateBlastSections(value, bondCount) {
    if (!value || !Array.isArray(value.stiffness) || value.stiffness.length !== bondCount
        || !Array.isArray(value.offsets) || value.offsets.length !== bondCount + 1
        || !Array.isArray(value.samples) || !value.samples.length || value.samples.length > 0xffffffff
        || value.offsets[0] !== 0 || value.offsets.at(-1) !== value.samples.length
        || Array.from(value.offsets).some((offset, i) => !Number.isInteger(offset) || offset < 0 || offset > value.samples.length
            || i > 0 && offset <= value.offsets[i - 1])) throw new RangeError('Invalid Blast interface sections');
    const sampleOffset = Math.ceil((bondCount * 36 * 8 + value.offsets.length * 4) / 8) * 8;
    const allocationBytes = sampleOffset + value.samples.length * 24 * 8;
    if (!Number.isSafeInteger(allocationBytes) || allocationBytes > 0xffffffff)
        throw new RangeError('Blast interface sections exceed WASM32 allocation limits');
    for (const matrix of value.stiffness) {
        if (!Array.isArray(matrix) || matrix.length !== 36 || !Array.from(matrix).every(Number.isFinite)
            || matrix.some((entry, i) => entry !== matrix[(i % 6) * 6 + Math.floor(i / 6)]))
            throw new RangeError('Invalid symmetric Blast interface stiffness');
        inverseSection(matrix);
    }
    for (const sample of value.samples) {
        if (!Array.isArray(sample) || sample.length !== 24 || !Array.from(sample).every(Number.isFinite)
            || [18, 20, 22].some(i => sample[i] < 0 || sample[i + 1] <= sample[i]))
            throw new RangeError('Invalid Blast interface traction sample');
    }
    // The validated schema contains only numeric rows. Copy those owned
    // values directly without serializing a large general object graph.
    return { stiffness: value.stiffness.map(row => [...row]),
        offsets: [...value.offsets], samples: value.samples.map(row => [...row]) };
}
