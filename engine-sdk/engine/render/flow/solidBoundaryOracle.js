// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { quatRotateVec3 } from '../../core/math/MathQuat.js';

const vector = (value, size) => {
    if (!value || value.length !== size) throw new RangeError('Solid oracle requires a finite vector');
    const result = Array.from(value);
    if (!result.every(Number.isFinite)) throw new RangeError('Solid oracle requires a finite vector');
    return result;
};
const packedVector = (value, size) => {
    const result = vector(value, size).map(Math.fround);
    if (!result.every(Number.isFinite)) throw new RangeError('Solid oracle geometry exceeds f32');
    return result;
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Diagnostic reference for CURRENT solid poses, independent of the native
 * BVH, HLSL and WGSL implementations. Public convex planes use n.x <= d;
 * PhysX planes occupy local x < 0. Geometry is rounded exactly as the ABI
 * packer does; predicates use double arithmetic and no contact-offset padding.
 * MathRay's contact queries deliberately admit tangency and use direction
 * epsilons, so they do not implement this strict donor-exclusion predicate.
 * This does not model swept moving boundaries or prove transport conservation.
 */
export function createSolidBoundaryOracle(records) {
    if (!Array.isArray(records)) throw new TypeError('Solid oracle requires canonical boundary records');
    const shapes = records.map(record => {
        if (!record || !['sphere', 'box', 'plane', 'convex'].includes(record.type)) throw new RangeError('Unsupported solid oracle geometry');
        const layer = record.layer ?? 0, enabled = record.enabled ?? true;
        if (!Number.isInteger(layer) || layer < 0 || layer > 65535 || typeof enabled !== 'boolean') throw new RangeError('Invalid solid oracle layer/enabled state');
        const position = packedVector(record.position ?? [0, 0, 0], 3), q = packedVector(record.quaternion ?? [0, 0, 0, 1], 4);
        const length = Math.hypot(...q);
        if (!(length > 0)) throw new RangeError('Solid oracle quaternion cannot be zero');
        const inverse = q.map((value, axis) => Math.fround((axis < 3 ? -value : value) / length));
        const shape = { type: record.type, layer, enabled, position, inverse, planes: [] };
        if (record.type === 'sphere') {
            shape.radius = Math.fround(record.radius);
            if (!(shape.radius > 0) || !Number.isFinite(Math.fround(shape.radius ** 2))) throw new RangeError('Invalid solid oracle radius');
        } else if (record.type === 'box') {
            const half = packedVector(record.halfSize, 3);
            if (half.some(value => value <= 0)) throw new RangeError('Invalid solid oracle box');
            for (let axis = 0; axis < 3; ++axis) for (const sign of [-1, 1]) {
                const plane = [0, 0, 0, half[axis]]; plane[axis] = sign; shape.planes.push(plane);
            }
        } else if (record.type === 'plane') shape.planes.push([1, 0, 0, 0]);
        else {
            if (!Array.isArray(record.planes) || record.planes.length < 4 || record.planes.length > 256) throw new RangeError('Invalid solid oracle hull');
            shape.planes = record.planes.map(value => {
                const plane = packedVector(value, 4), norm = Math.hypot(...plane.slice(0, 3));
                if (!(norm > 0)) throw new RangeError('Invalid solid oracle normal');
                const normalized = plane.map(part => Math.fround(part / norm));
                if (!normalized.every(Number.isFinite)) throw new RangeError('Solid oracle plane exceeds f32');
                return normalized;
            });
        }
        return shape;
    }).filter(shape => shape.enabled);
    const local = (shape, point) => quatRotateVec3(point.map((value, axis) => value - shape.position[axis]), shape.inverse);
    const inside = (shape, point) => shape.type === 'sphere' ? dot(point, point) < shape.radius ** 2
        : shape.planes.every(plane => dot(plane, point) < plane[3]);
    const enters = (shape, a, b) => {
        const d = b.map((value, axis) => value - a[axis]);
        if (shape.type === 'sphere') {
            const squaredLength = dot(d, d), t = squaredLength > 0 ? Math.max(0, Math.min(1, -dot(a, d) / squaredLength)) : 0;
            const nearest = a.map((value, axis) => value + t * d[axis]);
            return dot(nearest, nearest) < shape.radius ** 2;
        }
        let lower = 0, upper = 1;
        for (const plane of shape.planes) {
            const distance = dot(plane, a) - plane[3], rate = dot(plane, d);
            if (rate === 0) { if (distance >= 0) return false; }
            else if (rate > 0) upper = Math.min(upper, -distance / rate);
            else lower = Math.max(lower, -distance / rate);
            if (!(lower < upper)) return false;
        }
        return true;
    };
    return {
        pointInside(point, layer = 0) {
            vector(point, 3);
            return shapes.some(shape => shape.layer === layer && inside(shape, local(shape, point)));
        },
        segmentEnters(from, to, layer = 0) {
            vector(from, 3); vector(to, 3);
            return shapes.some(shape => shape.layer === layer && enters(shape, local(shape, from), local(shape, to)));
        },
    };
}
