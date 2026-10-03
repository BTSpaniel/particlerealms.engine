// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const vector = value => [value.get_x(), value.get_y(), value.get_z()];
const positive = value => Number.isFinite(value) && Number.isFinite(Math.fround(value)) && Math.fround(value) > 0;

export function validateChunkMasses(values, count) {
    if ((!Array.isArray(values) && !ArrayBuffer.isView(values)) || values.length !== count
        || !Array.from(values).every(positive)) throw new RangeError('Blast needs one positive finite mass in kg per authored chunk');
    const result = Array.from(values);
    if (!positive(result.reduce((sum, value) => sum + value, 0))) throw new RangeError('Blast total mass exceeds native precision');
    return result;
}

/** Ask PhysX for the actual cooked volume's mass tensor, not its render AABB.
 * Cache plain JS numbers; every [Value] getter is a borrowed native temporary. */
export function chunkMassProperties(module, chunk, mesh) {
    let geometry, properties;
    try {
        geometry = mesh ? new module.PxConvexMeshGeometry(mesh) : new module.PxBoxGeometry(...chunk.halfExtents);
        properties = new module.PxMassProperties(geometry);
        const mass = properties.get_mass(), center = vector(properties.get_centerOfMass());
        const matrix = properties.get_inertiaTensor(), inertia = [];
        for (let column = 0; column < 3; ++column) inertia.push(...vector(matrix[`get_column${column}`]()));
        if (!positive(mass) || ![...center, ...inertia].every(Number.isFinite)) throw new Error('Invalid native Blast chunk mass properties');
        return { center, inertiaPerKg: inertia.map(value => value / mass) };
    } finally {
        if (properties) module.destroy(properties);
        if (geometry) module.destroy(geometry);
    }
}

/** Exact parallel-axis sum over physical chunks, even when collision boxes
 * have been coalesced. Native diagonalization supplies PhysX's mass frame. */
export function compoundMassProperties(module, indices, chunks, properties, masses, origin) {
    const mass = indices.reduce((sum, index) => sum + masses[index], 0), center = [0, 0, 0];
    for (const index of indices) for (let axis = 0; axis < 3; ++axis)
        center[axis] += masses[index] * (chunks[index].position[axis] + properties[index].center[axis] - origin[axis]) / mass;
    const tensor = new Float64Array(9);
    for (const index of indices) {
        const value = properties[index], m = masses[index];
        const offset = value.center.map((part, axis) => chunks[index].position[axis] + part - origin[axis] - center[axis]);
        const squared = offset.reduce((sum, part) => sum + part * part, 0);
        for (let column = 0; column < 3; ++column) for (let row = 0; row < 3; ++row)
            tensor[column * 3 + row] += m * (value.inertiaPerKg[column * 3 + row]
                + (column === row ? squared : 0) - offset[column] * offset[row]);
    }
    if (!positive(mass) || ![...center, ...tensor].every(value => Number.isFinite(value) && Number.isFinite(Math.fround(value))))
        throw new RangeError('Blast mass tensor exceeds native precision');
    const owned = [];
    try {
        const columns = [0, 1, 2].map(column => { const value = new module.PxVec3(...tensor.slice(column * 3, column * 3 + 3)); owned.push(value); return value; });
        const matrix = new module.PxMat33(...columns); owned.push(matrix);
        const frame = new module.PxQuat(0, 0, 0, 1); owned.push(frame);
        const inertia = vector(module.PxMassProperties.prototype.getMassSpaceInertia(matrix, frame));
        const rotation = [frame.get_x(), frame.get_y(), frame.get_z(), frame.get_w()];
        if (!inertia.every(positive) || !rotation.every(Number.isFinite) || Math.abs(Math.hypot(...rotation) - 1) > 1e-5)
            throw new RangeError('Blast mass tensor has no positive native principal inertia');
        return { mass, center, inertia, rotation };
    } finally { for (let index = owned.length - 1; index >= 0; --index) module.destroy(owned[index]); }
}

/** Prepare all fallible allocations before mutating an existing actor. */
export function nativeMassUpdate(module, value, velocity) {
    const owned = [];
    try {
        const point = new module.PxVec3(...value.center); owned.push(point);
        const rotation = new module.PxQuat(...value.rotation); owned.push(rotation);
        const pose = new module.PxTransform(point, rotation); owned.push(pose);
        const inertia = new module.PxVec3(...value.inertia); owned.push(inertia);
        const linear = velocity ? new module.PxVec3(...velocity) : null;
        if (linear) owned.push(linear);
        return { apply(body, wake = true) {
            body._actor.setMass(value.mass); body._actor.setMassSpaceInertiaTensor(inertia); body._actor.setCMassLocalPose(pose);
            if (linear) { body._actor.setLinearVelocity(linear, wake); velocity.forEach((part, axis) => { body.linearVelocity[axis] = part; }); }
            body.mass = value.mass;
        }, dispose() { for (let index = owned.length - 1; index >= 0; --index) module.destroy(owned[index]); } };
    } catch (error) { for (let index = owned.length - 1; index >= 0; --index) module.destroy(owned[index]); throw error; }
}
