// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { sampleTerrainHeightfield } from '../../../../../engine/world/generation/TerrainHeightfield.js';
import { segmentDistanceToPoint } from '../../../../../engine/core/math/MathLine3.js';
import { smoothstep } from '../../../../../engine/core/math/MathScalar.js';
import { catmullRomSpline } from '../../../../../engine/core/math/MathEasing.js';

const channelPaths = new WeakMap();
/** The seven editable control points remain source data. Both the ground grade
 * and water use this engine spline; derived points are bounded and immutable.
 * Scene admission clones channels, so cache entries cannot survive node edits. */
export function spatialTerrainChannelPath(channel, subdivisions = 8) {
    if (!(channel.smoothing > 0)) return channel.points;
    if (!Number.isInteger(subdivisions) || subdivisions < 2 || subdivisions > 32) throw new TypeError('Channel spline subdivisions must be an integer in [2, 32]');
    let paths = channelPaths.get(channel);
    if (!paths) { paths = new Map(); channelPaths.set(channel, paths); }
    if (paths.has(subdivisions)) return paths.get(subdivisions);
    const points = channel.points.map(([x, z]) => [x, 0, z]), result = [];
    for (let index = 0; index <= (points.length - 1) * subdivisions; index++) {
        const segment = Math.min(points.length - 2, Math.floor(index / subdivisions)), fraction = (index - segment * subdivisions) / subdivisions;
        const curve = catmullRomSpline(points, index / ((points.length - 1) * subdivisions));
        result.push(Object.freeze([0, 2].map(axis => {
            const straight = points[segment][axis] + (points[segment + 1][axis] - points[segment][axis]) * fraction;
            return straight + (curve[axis] - straight) * channel.smoothing;
        })));
    }
    Object.freeze(result); paths.set(subdivisions, result); return result;
}

/** Explicit edits layer over the original saved engine bake. Channel beds are
 * authored grading, not a claim of a second hydraulic erosion simulation. */
export function spatialTerrainSurfaceHeight(params, x, z) {
    let height = sampleTerrainHeightfield(params.heightfield, x, z);
    for (const [cx, cz, hx, hz, level, blend] of params.terraces ?? []) {
        const distance = Math.max(Math.abs(x - cx) - hx, Math.abs(z - cz) - hz), t = Math.min(1, Math.max(0, distance / blend)), weight = 1 - t * t * (3 - 2 * t);
        height += (level - height) * weight;
    }
    for (const channel of params.channels ?? []) {
        const distance = spatialTerrainChannelDistance(channel, x, z);
        if (distance >= channel.halfWidth + channel.bankWidth) continue;
        const weight = 1 - smoothstep(channel.halfWidth, channel.halfWidth + channel.bankWidth, distance);
        const flow = sampleTerrainHeightfield(params.heightfield, x, z, 'flow');
        const bed = Math.max(0, channel.bedLevel - channel.flowInfluence * flow + channel.bedRelief * Math.pow(Math.min(1, distance / channel.halfWidth), 2));
        height += (Math.min(height, bed) - height) * weight;
    }
    return height;
}

export function spatialTerrainChannelDistance(channel, x, z) {
    let distance = Infinity; const points = spatialTerrainChannelPath(channel);
    for (let index = 1; index < points.length; index++) {
        const a = points[index - 1], b = points[index];
        distance = Math.min(distance, segmentDistanceToPoint({ a: [a[0], 0, a[1]], b: [b[0], 0, b[1]] }, [x, 0, z]));
    }
    return distance;
}

/** One authority for ground contact: interpolate the exact rendered triangles,
 * including density reduction. A bilinear saddle is not a triangle surface. */
export function spatialTerrainTriangleSampler(params, columns, rows) {
    const [x0, z0, x1, z1] = params.heightfield.bounds, dx = (x1 - x0) / (columns - 1), dz = (z1 - z0) / (rows - 1), values = [];
    for (let z = 0; z < rows; z++) for (let x = 0; x < columns; x++) values.push(spatialTerrainSurfaceHeight(params, x0 + x * dx, z0 + z * dz));
    return { columns, rows, sample(x, z) {
        const gx = Math.max(0, Math.min(columns - 1, (x - x0) / dx)), gz = Math.max(0, Math.min(rows - 1, (z - z0) / dz)), ix = Math.min(columns - 2, Math.floor(gx)), iz = Math.min(rows - 2, Math.floor(gz)), u = gx - ix, v = gz - iz, index = iz * columns + ix;
        const a = values[index], b = values[index + 1], c = values[index + columns], d = values[index + columns + 1];
        return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
    } };
}
