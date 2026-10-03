// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Validate a closed convex render mesh before cooking it as a single PhysX hull.
 * Positions are relative to the chunk's volume centroid. UV/normal seams may
 * duplicate vertices; topology is checked after geometric welding. No repair,
 * convex approximation or box fallback is performed.
 */
export function validateBlastGeometry(chunk) {
    const copy = (source, size, name) => {
        if ((!Array.isArray(source) && !ArrayBuffer.isView(source)) || source.length !== size
            || !Array.from(source).every(value => Number.isFinite(value) && Number.isFinite(Math.fround(value))))
            throw new RangeError(`Invalid Blast ${name}`);
        return Array.from(source, Math.fround);
    };
    const position = copy(chunk?.position, 3, 'chunk position');
    const input = chunk?.geometry, count = input?.positions?.length;
    if (!Number.isInteger(count) || count < 12 || count % 3 || count > 98304
        || !Number.isFinite(chunk.volume) || chunk.volume <= 0 || !Number.isFinite(Math.fround(chunk.volume)))
        throw new RangeError('Blast geometry requires finite vertices and a positive volume');
    const positions = copy(input.positions, count, 'positions');
    const normals = copy(input.normals, count, 'normals');
    const uvs = copy(input.uvs, count / 3 * 2, 'UVs');
    if ((!Array.isArray(input.indices) && !ArrayBuffer.isView(input.indices)) || input.indices.length < 12
        || input.indices.length % 3 || input.indices.length > 98304)
        throw new RangeError('Blast geometry requires complete indexed triangles');
    const indices = Array.from(input.indices);
    if (!indices.every(value => Number.isInteger(value) && value >= 0 && value < count / 3))
        throw new RangeError('Blast triangle index is outside its vertex buffer');
    const materialIds = Array.from(input.materialIds ?? []);
    if (materialIds.length !== indices.length / 3 || !materialIds.every(value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647))
        throw new RangeError('Blast triangles require signed 32-bit material IDs');
    const lower = [Infinity, Infinity, Infinity], upper = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; ++i) { lower[i % 3] = Math.min(lower[i % 3], positions[i]); upper[i % 3] = Math.max(upper[i % 3], positions[i]); }
    const extent = Math.max(...upper.map((value, axis) => value - lower[axis]));
    if (!(extent > 0)) throw new RangeError('Blast geometry has no extent');
    const epsilon = extent * 2e-6, unique = [], welded = [];
    for (let i = 0; i < count; i += 3) {
        const point = positions.slice(i, i + 3);
        let index = unique.findIndex(other => Math.hypot(...point.map((value, axis) => value - other[axis])) <= epsilon);
        if (index < 0) { index = unique.length; unique.push(point); }
        if (unique.length > 255) throw new RangeError('Blast convex chunks support at most 255 geometric vertices; decomposition is required');
        welded.push(index);
    }
    const edges = new Map(), centroid = [0, 0, 0];
    let volume = 0;
    for (let i = 0; i < indices.length; i += 3) {
        const ids = indices.slice(i, i + 3).map(index => welded[index]);
        if (new Set(ids).size !== 3) throw new RangeError('Blast geometry contains a degenerate triangle');
        const [a, b, c] = ids.map(index => unique[index]);
        const ab = b.map((value, axis) => value - a[axis]), ac = c.map((value, axis) => value - a[axis]);
        const normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
        const length = Math.hypot(...normal);
        if (length <= epsilon * epsilon) throw new RangeError('Blast geometry contains a zero-area triangle');
        if (unique.some(point => normal.reduce((sum, value, axis) => sum + value * (point[axis] - a[axis]), 0) > length * epsilon * 4))
            throw new RangeError('Blast mesh must be convex with outward triangle winding');
        const tetra = (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
        volume += tetra;
        for (let axis = 0; axis < 3; ++axis) centroid[axis] += tetra * (a[axis] + b[axis] + c[axis]) / 4;
        for (let edge = 0; edge < 3; ++edge) {
            const from = ids[edge], to = ids[(edge + 1) % 3], key = `${Math.min(from, to)}:${Math.max(from, to)}`;
            const state = edges.get(key) ?? { count: 0, winding: 0 };
            ++state.count; state.winding += from < to ? 1 : -1; edges.set(key, state);
        }
    }
    if ([...edges.values()].some(edge => edge.count !== 2 || edge.winding !== 0))
        throw new RangeError('Blast mesh must be watertight and manifold');
    if (!(volume > 0) || Math.abs(volume - chunk.volume) > Math.max(volume, chunk.volume) * 2e-4
        || centroid.some(value => Math.abs(value / volume) > extent * 2e-4))
        throw new RangeError('Blast volume or local centroid differs from its triangle geometry');
    return { position, volume: chunk.volume, anchored: !!chunk.anchored,
        geometry: { positions, normals, uvs, indices, materialIds } };
}

/** Refuse a cooked hull that simplified away a fracture surface. */
export function validateCookedBlastHull(module, mesh, chunk) {
    const helpers = module.NativeArrayHelpers.prototype, vertices = [], base = mesh.getVertices();
    for (let i = 0; i < mesh.getNbVertices(); ++i) {
        const point = helpers.getVec3At(base, i);
        vertices.push([point.get_x(), point.get_y(), point.get_z()]);
    }
    const polygon = new module.PxHullPolygon(), indexBuffer = mesh.getIndexBuffer();
    let volume = 0;
    try {
        const tolerance = Math.cbrt(chunk.volume) * 2e-4;
        const authored = chunk.geometry;
        // Containment must hold in both directions. A cooked hull that fills
        // a small missing corner can still pass a whole-fragment volume test.
        // Test against each authored triangle plane using a length-normalized
        // distance, retaining the same geometric tolerance as the reverse test.
        for (let i = 0; i < authored.indices.length; i += 3) {
            const [a, b, c] = authored.indices.slice(i, i + 3).map(index => authored.positions.slice(index * 3, index * 3 + 3));
            const u = b.map((value, axis) => value - a[axis]), v = c.map((value, axis) => value - a[axis]);
            const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
            const length = Math.hypot(...normal);
            if (!(length > 0) || !Number.isFinite(length)) throw new Error('Invalid authored Blast hull plane');
            for (const point of vertices) if (normal.reduce((sum, value, axis) => sum + value * (point[axis] - a[axis]), 0) > tolerance * length)
                throw new Error('Cooked Blast hull extends beyond an authored fracture surface');
        }
        for (let face = 0; face < mesh.getNbPolygons(); ++face) {
            if (!mesh.getPolygonData(face, polygon)) throw new Error('Cannot inspect cooked Blast hull');
            const plane = [0, 1, 2, 3].map(axis => polygon.get_mPlane(axis));
            const points = chunk.geometry.positions;
            for (let i = 0; i < points.length; i += 3) {
                if (plane[0] * points[i] + plane[1] * points[i + 1] + plane[2] * points[i + 2] + plane[3] > tolerance)
                    throw new Error('Cooked Blast hull excludes an authored vertex');
            }
            const indices = Array.from({ length: polygon.get_mNbVerts() }, (_, i) => helpers.getU8At(indexBuffer, polygon.get_mIndexBase() + i));
            const a = vertices[indices[0]];
            for (let i = 1; i + 1 < indices.length; ++i) {
                const b = vertices[indices[i]], c = vertices[indices[i + 1]];
                volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
            }
        }
        if (!Number.isFinite(volume) || Math.abs(Math.abs(volume) - chunk.volume) > chunk.volume * 5e-4)
            throw new Error('Cooked Blast collision volume differs from its rendered mesh');
    } finally { module.destroy(polygon); }
}

/** Cook an already validated authored chunk and transfer its mesh to the world
 * cache. The shared legacy cooker does not release its descriptor temporaries;
 * this path owns every allocation it makes and borrows existing world params.
 */
export function cookAndRegisterBlastHull(world, meshId, chunk) {
    if (!world?.ready || world.destroyed || !world.module || !world.tolerances
        || !world.convexMeshes || !meshId || world.convexMeshes.has(meshId))
        throw new Error('Blast cooking requires a ready world and an unused mesh ID');
    const P = world.module, vertices = new Float32Array(chunk.geometry.positions), owned = [];
    const own = object => { owned.push(object); return object; };
    let pointer = 0, mesh = null;
    try {
        // The default QuickHull plane tolerance is 0.7 mm: it can move or
        // discard a substantial part of a real millimetre fragment. Own this
        // convex-only configuration rather than mutating the world's shared
        // triangle-mesh parameters. Retain its relevant convex preferences.
        const params = own(new P.PxCookingParams(world.tolerances)), borrowed = world.cookingParams;
        if (borrowed) {
            for (const name of ['areaTestEpsilon', 'planeTolerance', 'convexMeshCookingType', 'buildGPUData', 'gaussMapLimit'])
                params[`set_${name}`](borrowed[`get_${name}`]());
            // The generated getter returns &params->scale, not an allocation;
            // the setter copies its value immediately. Never destroy the view.
            params.set_scale(borrowed.get_scale());
        }
        // One hundredth of the existing containment-admission tolerance; the
        // latter remains unchanged and verifies the actual native cooked hull.
        const planeTolerance = Math.min(params.get_planeTolerance(), Math.cbrt(chunk.volume) * 2e-6);
        if (!Number.isFinite(planeTolerance) || planeTolerance < 0 || planeTolerance > 0 && Math.fround(planeTolerance) === 0)
            throw new RangeError('Blast hull cooking tolerance is outside native precision');
        params.set_planeTolerance(planeTolerance);
        pointer = P._webidl_malloc(vertices.byteLength);
        if (!pointer) throw new Error('Blast convex vertex allocation failed');
        for (let i = 0; i < vertices.length; ++i)
            P.NativeArrayHelpers.prototype.setRealAt(pointer, i, vertices[i]);
        const points = own(new P.PxBoundedData());
        points.count = vertices.length / 3; points.stride = 12; points.data = pointer;
        const descriptor = own(new P.PxConvexMeshDesc());
        descriptor.points = points;
        const flags = own(new P.PxConvexFlags(0));
        flags.raise(P.PxConvexFlagEnum.eCOMPUTE_CONVEX); descriptor.flags = flags;
        mesh = P.CreateConvexMesh(params, descriptor);
        if (!mesh?.ptr) throw new Error('Blast convex mesh cooking failed');
        validateCookedBlastHull(P, mesh, chunk);
        world.convexMeshes.set(meshId, mesh);
        return mesh;
    } catch (error) {
        if (world.convexMeshes.get(meshId) === mesh) world.convexMeshes.delete(meshId);
        if (mesh?.ptr) mesh.release();
        throw error;
    } finally {
        try { for (let i = owned.length - 1; i >= 0; --i) P.destroy(owned[i]); }
        finally { if (pointer) P._webidl_free(pointer); }
    }
}
