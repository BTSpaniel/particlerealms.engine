// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { triangleClosestPoint } from '../../core/math/MathGeometry.js';
import { vec3Dot as dot, vec3Sub as subtract, vec3Cross as cross } from '../../core/math/MathVec3.js';

/** Bounds are broad-phase data. A convex fragment's mass centre need not be
 * the centre of this box, and the box must never replace a detached hull. */
export function blastChunkBounds(chunk) {
    if (!chunk.geometry) return { min: chunk.position.map((value, axis) => value - chunk.halfExtents[axis]),
        max: chunk.position.map((value, axis) => value + chunk.halfExtents[axis]) };
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    chunk.geometry.positions.forEach((value, index) => {
        const axis = index % 3, coordinate = value + chunk.position[axis];
        min[axis] = Math.min(min[axis], coordinate); max[axis] = Math.max(max[axis], coordinate);
    });
    return { min, max };
}

/** Prepare immutable local triangle coordinates once per query batch. The
 * value comparison admits in-place edits; original triangle/vertex order is
 * retained. This is acceleration data, never a replacement collision hull. */
export function prepareBlastChunkSurface(chunk, previous = null) {
    const geometry = chunk.geometry;
    if (!geometry) return null;
    const same = (current, copied) => {
        if (current.length !== copied.length) return false;
        for (let i = 0; i < current.length; ++i) if (!Object.is(current[i], copied[i])) return false;
        return true;
    };
    if (previous?.geometry === geometry && same(geometry.positions, previous.positions)
        && same(geometry.indices, previous.indices)) return previous;
    const positions = Object.freeze(Array.from(geometry.positions)), indices = Object.freeze(Array.from(geometry.indices));
    const vertices = Array.from({ length: positions.length / 3 }, (_, i) => Object.freeze(positions.slice(i * 3, i * 3 + 3)));
    const triangles = [];
    for (let i = 0; i < indices.length; i += 3) {
        const vertexIndices = Object.freeze(indices.slice(i, i + 3));
        triangles.push(Object.freeze({ triangleIndex: i / 3, vertexIndices,
            vertices: Object.freeze(vertexIndices.map(index => vertices[index])) }));
    }
    return Object.freeze({ geometry, positions, indices, triangles: Object.freeze(triangles) });
}

/** Squared distance to the actual collision surface, including interior
 * contacts. Reuses the Engine's scale-aware closest-triangle query. */
export function blastChunkSurfaceDistanceSquared(chunk, point, prepared = null) {
    const p = point.map((value, axis) => value - chunk.position[axis]);
    if (!chunk.geometry) {
        const d = p.map((value, axis) => Math.abs(value) - chunk.halfExtents[axis]);
        return d.reduce((sum, value) => sum + Math.max(0, value) ** 2, 0) || Math.min(...d.map(value => value * value));
    }
    if (prepared && prepared.geometry !== chunk.geometry) throw new TypeError('Prepared Blast surface belongs to different geometry');
    const { positions, indices } = chunk.geometry;
    let nearest = Infinity;
    for (let i = 0; i < indices.length; i += 3) {
        const vertices = prepared ? prepared.triangles[i / 3].vertices
            : [0, 1, 2].map(corner => positions.slice(indices[i + corner] * 3, indices[i + corner] * 3 + 3));
        const closest = triangleClosestPoint(p, ...vertices);
        nearest = Math.min(nearest, p.reduce((sum, value, axis) => sum + (value - closest[axis]) ** 2, 0));
    }
    return nearest;
}

function convexFeatures(chunk, bounds, origin) {
    const vertices = [], triangles = [], normals = [], edges = [];
    const addDirection = (list, direction) => {
        const length = Math.hypot(...direction);
        if (!(length > 0)) return;
        const unit = direction.map(value => value / length);
        if (!list.some(other => Math.abs(dot(unit, other)) > 1 - 1e-12)) list.push(unit);
    };
    const addTriangle = (a, b, c) => {
        const ab = subtract(b, a), ac = subtract(c, a), vector = cross(ab, ac), twiceArea = Math.hypot(...vector);
        if (!(twiceArea > 0) || !Number.isFinite(twiceArea)) throw new RangeError('Degenerate collision partition face');
        const normal = vector.map(value => value / twiceArea);
        triangles.push({ vertices: [a, b, c], normal, area: twiceArea / 2,
            perimeter: Math.hypot(...ab) + Math.hypot(...ac) + Math.hypot(...subtract(c, b)) });
        addDirection(normals, normal);
        for (const edge of [ab, ac, subtract(c, b)]) addDirection(edges, edge);
    };
    let volume = 0;
    if (!chunk.geometry) {
        for (let z = 0; z < 2; ++z) for (let y = 0; y < 2; ++y) for (let x = 0; x < 2; ++x)
            vertices.push([x ? bounds.max[0] : bounds.min[0], y ? bounds.max[1] : bounds.min[1], z ? bounds.max[2] : bounds.min[2]]
                .map((value, axis) => value - origin[axis]));
        for (let axis = 0; axis < 3; ++axis) for (const sign of [-1, 1]) {
            const u = (axis + 1) % 3, v = (axis + 2) % 3;
            const points = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => {
                const p = [0, 0, 0]; p[axis] = (sign > 0 ? bounds.max : bounds.min)[axis] - origin[axis];
                p[u] = (x ? bounds.max : bounds.min)[u] - origin[u]; p[v] = (y ? bounds.max : bounds.min)[v] - origin[v]; return p;
            });
            if (sign < 0) points.reverse();
            addTriangle(points[0], points[1], points[2]); addTriangle(points[0], points[2], points[3]);
        }
        volume = chunk.halfExtents.reduce((a, b) => a * b, 8);
    } else {
        const { positions, indices } = chunk.geometry;
        for (let i = 0; i < positions.length; i += 3)
            vertices.push(positions.slice(i, i + 3).map((value, axis) => value + (chunk.position[axis] - origin[axis])));
        for (let i = 0; i < indices.length; i += 3) {
            const [a, b, c] = indices.slice(i, i + 3).map(index => vertices[index]);
            addTriangle(a, b, c);
            // Compute each tetrahedron around the chunk origin: declared mass
            // volume is intentionally not evidence that the surfaces fill it.
            const local = indices.slice(i, i + 3).map(index => positions.slice(index * 3, index * 3 + 3));
            volume += dot(local[0], cross(local[1], local[2])) / 6;
        }
    }
    if (!(volume > 0) || !Number.isFinite(volume)) throw new RangeError('Invalid geometric partition volume');
    return { vertices, normals, edges, triangles, volume };
}

// Coplanar triangle intersection for the independent interface-coverage proof.
// Projection preserves the tested plane and avoids introducing a voxel grid.
function overlapArea(a, b, epsilon) {
    const axis = a.normal.map(Math.abs).indexOf(Math.max(...a.normal.map(Math.abs))), u = (axis + 1) % 3, v = (axis + 2) % 3;
    const direction = b.normal[axis] > 0 ? 1 : -1;
    let polygon = a.vertices.map(p => [p[u], p[v]]);
    const clip = b.vertices.map(p => [p[u], p[v]]);
    for (let i = 0; i < 3 && polygon.length; ++i) {
        const start = clip[i], end = clip[(i + 1) % 3];
        const distance = p => direction * ((end[0] - start[0]) * (p[1] - start[1]) - (end[1] - start[1]) * (p[0] - start[0]));
        const output = [];
        let previous = polygon.at(-1), before = distance(previous);
        for (const current of polygon) {
            const after = distance(current);
            if ((before >= 0) !== (after >= 0)) {
                const t = before / (before - after);
                output.push(previous.map((value, j) => value + t * (current[j] - value)));
            }
            if (after >= 0) output.push(current);
            previous = current; before = after;
        }
        polygon = output;
    }
    // Float32 rounding can tilt a skinny triangle's plane slightly. Test
    // only the shared patch, rather than extrapolating that plane across the
    // whole neighbouring triangle. Plane separation is affine on this convex
    // polygon, so its extrema occur at these vertices. Both normal distances
    // must fit the unchanged linear precision allowance.
    const lift = (face, point) => {
        const p = [...face.vertices[0]]; p[u] = point[0]; p[v] = point[1];
        p[axis] -= (face.normal[u] * (p[u] - face.vertices[0][u])
            + face.normal[v] * (p[v] - face.vertices[0][v])) / face.normal[axis];
        return p;
    };
    for (const point of polygon) {
        const left = lift(a, point), right = lift(b, point);
        if (Math.abs(dot(a.normal, subtract(right, a.vertices[0]))) > epsilon
            || Math.abs(dot(b.normal, subtract(left, b.vertices[0]))) > epsilon) return 0;
    }
    let twiceArea = 0;
    for (let i = 0; i < polygon.length; ++i) {
        const p = polygon[i], q = polygon[(i + 1) % polygon.length]; twiceArea += p[0] * q[1] - p[1] * q[0];
    }
    return Math.abs(twiceArea) / (2 * Math.abs(a.normal[axis]));
}

function verifyClosedPartition(features, lengths, epsilon) {
    for (let i = 0; i < features.length; ++i) for (const face of features[i].triangles) {
        const exterior = [0, 1, 2].some(axis => Math.abs(face.normal[axis]) > 1 - 1e-8
            && face.vertices.every(p => Math.abs(p[axis] - (face.normal[axis] > 0 ? lengths[axis] : 0)) <= epsilon));
        if (exterior) continue;
        let covered = 0;
        for (let j = 0; j < features.length; ++j) if (j !== i) for (const other of features[j].triangles) {
            if (dot(face.normal, other.normal) > -1 + 1e-8) continue;
            covered += overlapArea(face, other, epsilon);
        }
        if (Math.abs(face.area - covered) > face.perimeter * epsilon * 2 + face.area * 1e-9)
            throw new RangeError('Blast collision partition has an uncovered internal surface or opening');
    }
}

function separated(a, b, epsilon) {
    const separates = direction => {
        const length = Math.hypot(...direction);
        if (length < 1e-12) return false;
        const axis = direction.map(value => value / length);
        let alo = Infinity, ahi = -Infinity, blo = Infinity, bhi = -Infinity;
        for (const vertex of a.vertices) { const p = dot(vertex, axis); alo = Math.min(alo, p); ahi = Math.max(ahi, p); }
        for (const vertex of b.vertices) { const p = dot(vertex, axis); blo = Math.min(blo, p); bhi = Math.max(bhi, p); }
        return Math.min(ahi, bhi) - Math.max(alo, blo) <= epsilon;
    };
    if (a.normals.some(separates) || b.normals.some(separates)) return true;
    for (const left of a.edges) for (const right of b.edges) if (separates(cross(left, right))) return true;
    return false;
}

/** Admit a cuboid replacement only for a complete nonoverlapping partition.
 * Box inputs retain the original strict check. Validated convex inputs also
 * require SAT separation, geometric volume and closed face coverage at float32
 * precision. This is not an arbitrary convex-hull/AABB collision shortcut.
 * The caller must first run validateBlastGeometry on every authored hull. */
export function validateBlastCollisionPartitions(chunks, input) {
    if (input === null) return null;
    if (!Array.isArray(input) || !input.length) throw new RangeError('Blast collision groups must partition every chunk');
    const owned = new Set();
    const groups = input.map(indices => {
        if (!Array.isArray(indices) || !indices.length) throw new RangeError('Empty Blast collision group');
        const lower = [Infinity, Infinity, Infinity], upper = [-Infinity, -Infinity, -Infinity];
        let volume = 0, hasGeometry = false;
        const cells = indices.map(index => {
            if (!Number.isInteger(index) || index < 0 || index >= chunks.length || owned.has(index))
                throw new RangeError('Blast collision groups require unique owned chunks');
            owned.add(index);
            const chunk = chunks[index], bounds = blastChunkBounds(chunk);
            if (!(chunk.volume > 0) || !Number.isFinite(chunk.volume)
                || ![...bounds.min, ...bounds.max].every(Number.isFinite)) throw new RangeError('Invalid Blast collision partition geometry');
            for (let axis = 0; axis < 3; ++axis) { lower[axis] = Math.min(lower[axis], bounds.min[axis]); upper[axis] = Math.max(upper[axis], bounds.max[axis]); }
            volume += chunk.volume; hasGeometry ||= !!chunk.geometry;
            return { chunk, ...bounds };
        });
        const lengths = upper.map((value, axis) => value - lower[axis]), boundingVolume = lengths.reduce((a, b) => a * b, 1);
        const extent = Math.max(...lengths), coordinate = Math.max(extent, ...lower.map(Math.abs), ...upper.map(Math.abs));
        // Large global coordinates must use a local authoring origin. Losing a
        // whole mortar seam to float32 rounding cannot justify filling its gap.
        if (hasGeometry && coordinate * 2 ** -23 > extent * 1e-5)
            throw new RangeError('Convex collision partition needs a representable local authoring origin');
        const epsilon = hasGeometry ? Math.max(extent * 2 ** -21, coordinate * 2 ** -23) : extent * 1e-10;
        const features = hasGeometry ? cells.map(cell => convexFeatures(cell.chunk, cell, lower)) : null;
        if (hasGeometry) volume = features.reduce((sum, value) => sum + value.volume, 0);
        const volumeTolerance = hasGeometry
            ? 2 * epsilon * (lengths[0] * lengths[1] + lengths[1] * lengths[2] + lengths[2] * lengths[0]) + boundingVolume * 2e-6
            : boundingVolume * 1e-10;
        if (!(boundingVolume > 0) || !Number.isFinite(boundingVolume) || !Number.isFinite(volume)
            || Math.abs(volume - boundingVolume) > volumeTolerance)
            throw new RangeError('Blast collision group must fill one cuboid without gaps');
        for (let a = 0; a < cells.length; ++a) for (let b = a + 1; b < cells.length; ++b) {
            if (![0, 1, 2].every(axis => Math.min(cells[a].max[axis], cells[b].max[axis])
                - Math.max(cells[a].min[axis], cells[b].min[axis]) > epsilon)) continue;
            if (!hasGeometry || !separated(features[a], features[b], epsilon))
                throw new RangeError('Blast collision group fragments overlap');
        }
        if (hasGeometry) verifyClosedPartition(features, lengths, epsilon);
        return { indices: [...indices], position: lower.map((value, axis) => (value + upper[axis]) / 2),
            halfExtents: lengths.map(value => value / 2) };
    });
    if (owned.size !== chunks.length) throw new RangeError('Incomplete Blast collision group partition');
    return groups;
}
