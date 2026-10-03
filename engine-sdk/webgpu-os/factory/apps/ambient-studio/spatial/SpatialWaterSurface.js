// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { spatialTerrainSurfaceHeight } from './SpatialTerrainSculpt.js';
import { pointInTriangle2D } from '../../../../../engine/core/math/MathGeometry.js';
import { rayIntersectTriangle } from '../../../../../engine/core/math/MathRay.js';

export function spatialGeometryWorldTransform(params) {
    const angle = params.yaw * Math.PI / 180, cs = Math.cos(angle), sn = Math.sin(angle);
    return (x, y, z) => [params.x + (x * cs - z * sn) * params.scale, params.y + y * params.scale, params.z + (x * sn + z * cs) * params.scale];
}

/** Finite topology only. Displacement, slope statistics and compression are
 * sampled by the shared Engine water field, never invented by this adapter. */
export function spatialLakeMeshDimensions(params) {
    const bounds = params.bounds ?? [-2.2, -1, 2.2, 2.8], longest = Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]);
    const resolution = Math.max(2, Math.round((params.surfaceSegments ?? 32) * Math.min(1, Math.sqrt(params.density / 2))));
    return { bounds, columns: Math.max(2, Math.ceil(resolution * (bounds[2] - bounds[0]) / longest)), rows: Math.max(2, Math.ceil(resolution * (bounds[3] - bounds[1]) / longest)) };
}

/** Clip against the same triangle sampler used by rendered terrain grounding.
 * The clearance reserves the saved maximum vertical wave displacement. */
export function spatialClipWaterTriangle(vertices, bedHeight, surfaceLevel, clearance = 0, contains = null) {
    if (contains && vertices.some(vertex => !contains(vertex[0], vertex[2]))) return [];
    const distance = vertex => bedHeight(vertex[0], vertex[2]) - surfaceLevel + clearance;
    const edge = (a, b) => {
        let left = a, right = b, sign = distance(a) <= 0;
        for (let step = 0; step < 24; step++) {
            const midpoint = left.map((value, axis) => (value + right[axis]) * .5);
            if ((distance(midpoint) <= 0) === sign) left = midpoint; else right = midpoint;
        }
        return left.map((value, axis) => (value + right[axis]) * .5);
    };
    const polygon = [];
    for (let i = 0; i < vertices.length; i++) {
        const a = vertices[i], b = vertices[(i + 1) % vertices.length], inside = distance(a) <= 0, next = distance(b) <= 0;
        if (inside) polygon.push(a);
        if (inside !== next) polygon.push(edge(a, b));
    }
    const triangles = [];
    for (let i = 1; i < polygon.length - 1; i++) triangles.push([polygon[0], polygon[i], polygon[i + 1]]);
    return triangles;
}

export function spatialLakeTriangles(params, world, bedHeight, contains = null, renderedBedClip = null) {
    const { bounds, columns, rows } = spatialLakeMeshDimensions(params), triangles = [], level = world(0, params.level, 0)[1];
    const point = (column, row) => world(bounds[0] + (bounds[2] - bounds[0]) * column / columns, params.level, bounds[1] + (bounds[3] - bounds[1]) * row / rows);
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
        const a = point(column, row), b = point(column + 1, row), c = point(column, row + 1), d = point(column + 1, row + 1);
        for (const face of [[a, c, b], [b, c, d]]) triangles.push(...(renderedBedClip ? renderedBedClip(face, level, params.waveHeight * params.scale) : spatialClipWaterTriangle(face, bedHeight, level, params.waveHeight * params.scale, contains)));
    }
    return triangles;
}

/** Exact overlay with the rendered terrain triangles. Subdividing a lake
 * alone cannot prevent a coarse water triangle bridging a small dry ridge. */
export function spatialRenderedBedClipper(terrain, columns, rows) {
    const [x0, z0, x1, z1] = terrain.heightfield.bounds, dx = (x1 - x0) / (columns - 1), dz = (z1 - z0) / (rows - 1), yaw = -terrain.yaw * Math.PI / 180, cs = Math.cos(yaw), sn = Math.sin(yaw), cache = new Map();
    const height = (column, row) => {
        const id = row * columns + column;
        if (!cache.has(id)) cache.set(id, terrain.y + (terrain.baseHeight + spatialTerrainSurfaceHeight(terrain, x0 + column * dx, z0 + row * dz)) * terrain.scale);
        return cache.get(id);
    };
    const local = vertex => { const x = (vertex[0] - terrain.x) / terrain.scale, z = (vertex[2] - terrain.z) / terrain.scale; return [...vertex, x * cs - z * sn, x * sn + z * cs]; };
    const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
    const clip = (polygon, distance) => {
        const next = [];
        for (let i = 0; i < polygon.length; i++) {
            const a = polygon[i], b = polygon[(i + 1) % polygon.length], da = distance(a), db = distance(b), inside = da >= -1e-12, other = db >= -1e-12;
            if (inside) next.push(a);
            if (inside !== other) { const t = da / (da - db); next.push(a.map((value, axis) => value + (b[axis] - value) * t)); }
        }
        return next;
    };
    return (vertices, level, clearance) => {
        const source = vertices.map(local), triangles = [], xs = source.map(vertex => vertex[3]), zs = source.map(vertex => vertex[4]);
        const minColumn = Math.max(0, Math.floor((Math.min(...xs) - x0) / dx)), maxColumn = Math.min(columns - 2, Math.floor((Math.max(...xs) - x0) / dx));
        const minRow = Math.max(0, Math.floor((Math.min(...zs) - z0) / dz)), maxRow = Math.min(rows - 2, Math.floor((Math.max(...zs) - z0) / dz));
        for (let row = minRow; row <= maxRow; row++) for (let column = minColumn; column <= maxColumn; column++) {
            const a = [x0 + column * dx, z0 + row * dz, height(column, row)], b = [a[0] + dx, a[1], height(column + 1, row)], c = [a[0], a[1] + dz, height(column, row + 1)], d = [a[0] + dx, a[1] + dz, height(column + 1, row + 1)];
            for (const bed of [[a, c, b], [b, c, d]]) {
                let polygon = source; const origin = bed[0], e1 = [bed[1][0] - origin[0], bed[1][1] - origin[1]], e2 = [bed[2][0] - origin[0], bed[2][1] - origin[1]], area = cross(e1, e2), sign = Math.sign(area);
                for (let edge = 0; edge < 3 && polygon.length; edge++) {
                    const from = bed[edge], to = bed[(edge + 1) % 3], along = [to[0] - from[0], to[1] - from[1]];
                    polygon = clip(polygon, vertex => sign * cross(along, [vertex[3] - from[0], vertex[4] - from[1]]));
                }
                polygon = clip(polygon, vertex => { const delta = [vertex[3] - origin[0], vertex[4] - origin[1]], u = cross(delta, e2) / area, v = cross(e1, delta) / area; return level - clearance - (origin[2] + (bed[1][2] - origin[2]) * u + (bed[2][2] - origin[2]) * v); });
                for (let i = 1; i < polygon.length - 1; i++) {
                    const face = [polygon[0], polygon[i], polygon[i + 1]];
                    if (Math.abs(cross([face[1][3] - face[0][3], face[1][4] - face[0][4]], [face[2][3] - face[0][3], face[2][4] - face[0][4]])) > 1e-12) triangles.push(face.map(vertex => vertex.slice(0, 3)));
                }
            }
        }
        return triangles;
    };
}

/** A vertical sheet is a finite interface. Width and drop belong to its node. */
export function spatialWaterfallTriangles(params, world, top, height) {
    const rows = params.fallSegments ?? 32, columns = params.acrossSegments ?? 8, triangles = [];
    const point = (column, row) => {
        const t = row / rows, width = params.radius * (1 - .15 * t);
        return world((column / columns * 2 - 1) * width, top - t * height, 0);
    };
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
        const a = point(column, row), b = point(column + 1, row), c = point(column, row + 1), d = point(column + 1, row + 1);
        triangles.push([a, c, b], [b, c, d]);
    }
    return triangles;
}

/** Bounded, cyclic impact spray presentation. The sheet remains the interface;
 * these owned transparent samples do not claim a particle fluid simulation. */
export function applySpatialWaterSpray(geometry, source, spray, time) {
    if (!spray) return;
    for (let sample = 0; sample < source.count; sample++) {
        const at = sample * 40, offset = sample * 8, radius = spray[offset + 5];
        if (radius <= 0) continue;
        const lifetime = Math.max(.2, Math.min(2, radius * 12 / Math.max(.05, spray[offset + 3]))), phase = spray[offset + 4] / (Math.PI * 2);
        const t = ((time / lifetime + phase) % 1 + 1) % 1, expansion = .3 + .7 * t;
        geometry[at] = spray[offset] + (source.anchor[sample * 3] - spray[offset]) * expansion;
        geometry[at + 1] = spray[offset + 1] + radius * 2.8 * 4 * t * (1 - t);
        geometry[at + 2] = spray[offset + 2] + (source.anchor[sample * 3 + 2] - spray[offset + 2]) * expansion;
        geometry[at + 15] *= Math.min(1, t * 10) * Math.min(1, (1 - t) * 5);
        geometry[at + 32] = (source.anchor[sample * 3] - spray[offset]) * .7 / lifetime;
        geometry[at + 33] = radius * 11.2 * (1 - 2 * t) / lifetime;
        geometry[at + 34] = (source.anchor[sample * 3 + 2] - spray[offset + 2]) * .7 / lifetime;
    }
}

/** Source coordinates match the field and retained foam, including fall sheets. */
export function spatialWaterSourcePoint(water, point) {
    const delta = point.map((value, axis) => value - water.origin[axis]);
    return water.kind === 'waterfall' ? [delta[0] * Math.cos(water.domainYaw) + delta[2] * Math.sin(water.domainYaw), -delta[1]] : [delta[0], delta[2]];
}

/** Rasterize actual saved interface triangles, preserving channels/dry ridges. */
export function createSpatialWaterFoamDomains(geometry, resolution = 128) {
    if (![64, 128].includes(resolution)) throw new RangeError('Finite foam resolution must be64 or128.');
    const owners = (geometry.waters ?? []).filter(water => water.surfaceVersion === 2 && water.foam?.foamVersion === 1 && water.meshCount > 0);
    if (owners.length > 64) throw new RangeError('Retained finite foam supports at most64 authored interfaces.');
    const masks = new Uint32Array(Math.max(1, owners.length) * resolution * resolution);
    const domains = owners.map((water, layer) => {
        const triangles = [], minimum = [Infinity, Infinity], maximum = [-Infinity, -Infinity];
        for (let vertex = water.meshStart; vertex < water.meshStart + water.meshCount; vertex += 3) {
            const triangle = [0, 1, 2].map(offset => spatialWaterSourcePoint(water, [...geometry.mesh.subarray((vertex + offset) * 6, (vertex + offset) * 6 + 3)]));
            triangles.push(triangle);
            for (const point of triangle) for (let axis = 0; axis < 2; axis++) { minimum[axis] = Math.min(minimum[axis], point[axis]); maximum[axis] = Math.max(maximum[axis], point[axis]); }
        }
        const extent = maximum.map((value, axis) => Math.max(.0001, value - minimum[axis]));
        for (const triangle of triangles) {
            const xs = triangle.map(point => (point[0] - minimum[0]) / extent[0] * resolution), ys = triangle.map(point => (point[1] - minimum[1]) / extent[1] * resolution);
            const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(resolution - 1, Math.floor(Math.max(...xs)));
            const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(resolution - 1, Math.floor(Math.max(...ys)));
            for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
                const point = [minimum[0] + (x + .5) / resolution * extent[0], minimum[1] + (y + .5) / resolution * extent[1]];
                if (pointInTriangle2D(point, ...triangle)) masks[(layer * resolution + y) * resolution + x] = 1;
            }
        }
        const at = water.meshStart * 8;
        return { water, layer, minimum, extent, wave: [...geometry.meshWind.subarray(at, at + 8)] };
    });
    return { resolution, domains, masks };
}

/** Exact saved-triangle contact with nearest opaque occlusion. No screen guesses. */
export function spatialWaterContact(geometry, camera, uv) {
    if (!camera || uv.some(value => !Number.isFinite(value) || value < 0 || value > 1)) return null;
    const direction = camera.forward.map((value, axis) => value + camera.right[axis] * ((uv[0] - camera.cx) / camera.fx) + camera.up[axis] * ((camera.cy - uv[1]) / camera.fy));
    const norm = Math.hypot(...direction), ray = { origin: camera.eye, direction: direction.map(value => value / norm) };
    let closest = null;
    for (let vertex = 0; vertex < geometry.mesh.length / 6; vertex += 3) {
        const triangle = [0, 1, 2].map(offset => [...geometry.mesh.subarray((vertex + offset) * 6, (vertex + offset) * 6 + 3)]);
        const hit = rayIntersectTriangle(ray, ...triangle);
        if (hit && (!closest || hit.t < closest.t)) closest = { ...hit, vertex };
    }
    if (!closest) return null;
    const water = geometry.waters.find(value => closest.vertex >= value.meshStart && closest.vertex < value.meshStart + value.meshCount);
    return water ? { water, point: closest.point, source: spatialWaterSourcePoint(water, closest.point) } : null;
}
