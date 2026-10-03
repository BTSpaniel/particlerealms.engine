// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { quatNormalize, quatRotateVec3 } from '../../core/math/MathQuat.js';
import { SURFACE_NO_NEIGHBOR } from './SurfaceFieldTopology.js';

const opposite = [1, 0, 3, 2];
const finiteArray = (value, Type, length, label) => {
    if (!(value instanceof Type) || value.length !== length) throw new RangeError(`Surface motion ${label} has an invalid layout`);
    for (let index = 0; index < value.length; index++) if (!Number.isFinite(value[index])) throw new RangeError(`Surface motion ${label} must be finite`);
};

/** Admit a completed native frame. Cell poses use the renderer's authored
 * solid midpoint and relative quaternion. Velocities are at that same point,
 * followed by angular velocity in world axes. Edges report actual surviving
 * bonds, including broken edges inside an otherwise connected rigid actor.
 * Derived arrays are rebuilt rather than trusting caller-supplied routing.
 */
export function createSurfaceFieldMotion(topology, input) {
    if (!input || typeof input !== 'object') throw new TypeError('Surface motion requires a completed native frame');
    if (input.topologyIdentity !== undefined && input.topologyIdentity !== topology.identity) throw new RangeError('Surface motion belongs to a different topology');
    const count = topology.count;
    finiteArray(input.poses, Float32Array, count * 8, 'poses');
    finiteArray(input.velocities, Float32Array, count * 6, 'velocities');
    finiteArray(input.connectedEdges, Uint8Array, count * 4, 'connected edges');
    const poses = input.poses.slice(), velocities = input.velocities.slice(), connectedEdges = input.connectedEdges.slice();
    const heights = new Float32Array(count), normalUp = new Float32Array(count), neighbors = topology.neighbors.slice(), runoffEdges = [];
    const rotation = [0, 0, 0, 1], upAxis = [0, 1, 0];
    for (let i = 0; i < count; i++) {
        const m = i * 8, v = i * 6, domain = topology.domains[topology.meta[m + 4]], visible = poses[m + 3];
        for (let axis = 0; axis < 4; axis++) rotation[axis] = poses[m + 4 + axis];
        const length = Math.hypot(rotation[0], rotation[1], rotation[2], rotation[3]);
        if ((visible !== 0 && visible !== 1) || Math.abs(length - 1) > .02) throw new RangeError('Surface motion requires binary visibility and unit quaternions');
        const q = quatNormalize(rotation), up = quatRotateVec3(upAxis, q);
        // An exactly vertical f32 quaternion can normalize to -2e-16 here.
        // Do not mistake arithmetic cancellation for an overturned film.
        if (Math.abs(up[1]) <= 4 * Number.EPSILON) up[1] = 0;
        heights[i] = poses[m + 1] + up[1] * topology.meta[m + 7] * .5;
        normalUp[i] = up[1];
        if (domain.receiveRunoff) {
            if (!visible || Math.fround(topology.meta[m]) !== poses[m]
                || Math.fround(topology.meta[m + 1] - topology.meta[m + 7] * .5) !== poses[m + 1]
                || Math.fround(topology.meta[m + 2]) !== poses[m + 2] || Math.abs(q[3]) < 1 - 1e-7
                || velocities[v] !== 0 || velocities[v + 1] !== 0 || velocities[v + 2] !== 0
                || velocities[v + 3] !== 0 || velocities[v + 4] !== 0 || velocities[v + 5] !== 0) {
                throw new RangeError('Runoff receiving surfaces must retain their authored static pose');
            }
            heights[i] = topology.meta[m + 1]; normalUp[i] = 1;
        }
        for (let k = 0; k < 4; k++) {
            const edge = i * 4 + k, j = topology.neighbors[edge], connected = connectedEdges[edge];
            if (connected !== 0 && connected !== 1) throw new RangeError('Surface motion connectivity must be binary');
            const sameDomain = j !== SURFACE_NO_NEIGHBOR && topology.meta[j * 8 + 4] === topology.meta[m + 4];
            if (connected && (!sameDomain || !visible || poses[j * 8 + 3] !== 1)) throw new RangeError('Surface motion connected an absent or nonadjacent surface');
            if (sameDomain && j !== i && (topology.neighbors[j * 4 + opposite[k]] !== i
                || connected !== connectedEdges[j * 4 + opposite[k]])) throw new RangeError('Surface motion connectivity must be reciprocal');
            if (domain.receiveRunoff) {
                if (sameDomain && j !== i && !connected) throw new RangeError('A receiving surface cannot fracture in a native panel frame');
                continue;
            }
            // Exterior and fractured edges leave the surface graph. Chemistry
            // transfers their finite contents to a parcel, never the old cell.
            // The film model has no adhesion that could support an overturned
            // underside. Detach its liquid without breaking surviving solids.
            if (!sameDomain || (j !== i && !connected) || !visible || up[1] < 0) {
                neighbors[edge] = SURFACE_NO_NEIGHBOR;
                runoffEdges.push(edge);
            }
        }
    }
    return Object.freeze({ topologyIdentity: topology.identity, poses, velocities, connectedEdges,
        heights, normalUp, neighbors, runoffEdges: new Uint32Array(runoffEdges) });
}

/** Same rigid transform as SurfaceFieldShaders.leafPoint; localPoint is in
 * the authored world chart, including its original slope and solid recession. */
export function surfaceFieldMotionPoint(topology, motion, index, localPoint) {
    const m = index * 8, q = quatNormalize(motion.poses.subarray(m + 4, m + 8));
    const offset = quatRotateVec3([localPoint[0] - topology.meta[m],
        localPoint[1] - topology.meta[m + 1] + topology.meta[m + 7] * .5,
        localPoint[2] - topology.meta[m + 2]], q);
    return offset.map((value, axis) => value + motion.poses[m + axis]);
}
