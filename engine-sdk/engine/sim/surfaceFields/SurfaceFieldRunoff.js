// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { cloneStrictJson } from '../../core/schema/StrictJsonValue.js';
import { quatNormalize, quatRotateVec3 } from '../../core/math/MathQuat.js';
import { totalPointVelocity } from '../../core/math/MathPhysics.js';
import { createSurfaceFieldMotion, surfaceFieldMotionPoint } from './SurfaceFieldMotion.js';

export const SURFACE_RUNOFF_CAPACITY = 2048;
export const SURFACE_RUNOFF_STRIDE = 16;
export const SURFACE_RUNOFF_GRAVITY = 9.81;
const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const number = (value, label, min = 0, max = 1e12) => {
    if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`Invalid runoff ${label}`);
    return value;
};

/** A finite ballistic parcel is a material owner, not an expiring effect.
 * Positions can be evaluated directly in a GPU vertex stage without another
 * simulation/readback loop. Internal heat stays with Chemistry; gravity and
 * impact use a kinematic closure, not an invented thermal-energy source. */
export class SurfaceFieldRunoff {
    constructor(topology, { enabled = false, capacity = SURFACE_RUNOFF_CAPACITY } = {}) {
        if (typeof enabled !== 'boolean' || !Number.isInteger(capacity) || capacity < 1 || capacity > SURFACE_RUNOFF_CAPACITY) throw new RangeError('Invalid runoff configuration');
        this.topology = topology; this.enabled = enabled; this.capacity = capacity;
        this.edges = new Set(topology.edgeSources); this.parcels = new Map(); this.nextId = 1;
        this.motion = null;
        this.blockedVolumeM3 = 0; this.depositedCount = 0;
    }
    /** Publish only a completely validated native frame. Airborne parcels keep
     * their birth pose and velocity when later completed frames replace it. */
    setMotion(input = null) {
        const motion = input === null ? null : createSurfaceFieldMotion(this.topology, input);
        const edges = new Set(motion?.runoffEdges ?? this.topology.edgeSources);
        this.motion = motion; this.edges = edges; return motion;
    }
    /** Draft only: IDs and owners commit together after the Matter transfer. */
    plan(edge, phase, { timeSeconds, tiltX = 0, tiltZ = 0, removedDepthM = 0, liquidDepthM = 0 }, pendingCount = 0) {
        if (!this.enabled || !this.edges.has(edge) || this.parcels.size + pendingCount >= this.capacity) return null;
        if (!['aqueous', 'oil'].includes(phase)) throw new RangeError('Invalid runoff phase');
        number(timeSeconds, 'birth time'); number(removedDepthM, 'solid recession'); number(liquidDepthM, 'liquid depth');
        number(tiltX, 'slope', -10, 10); number(tiltZ, 'slope', -10, 10);
        const t = this.topology, source = Math.floor(edge / 4), m = source * 8, domain = t.domains[t.meta[m + 4]];
        const [dx, dz] = directions[edge % 4], x = t.meta[m] + dx * domain.size[0] / (2 * t.n), z = t.meta[m + 2] + dz * domain.size[1] / (2 * t.n);
        const dynamic = !domain.receiveRunoff && domain.material !== 'calcite';
        const sx = domain.tiltX + (dynamic ? tiltX : 0), sz = domain.tiltZ + (dynamic ? tiltZ : 0);
        let origin = [x, domain.center[1] + (x - domain.center[0]) * sx + (z - domain.center[2]) * sz - removedDepthM + liquidDepthM, z];
        // The finite-volume film carries no momentum. This declared modest
        // edge-release speed gives detached parcels a gravity-driven flight.
        let velocity = [dx * .25, 0, dz * .25], inheritedVelocity = [0, 0, 0];
        if (this.motion) {
            const q = quatNormalize(this.motion.poses.subarray(m + 4, m + 8)), v = source * 6;
            origin = surfaceFieldMotionPoint(t, this.motion, source, [x,
                domain.center[1] + (x - domain.center[0]) * domain.tiltX + (z - domain.center[2]) * domain.tiltZ - removedDepthM + liquidDepthM, z]);
            inheritedVelocity = totalPointVelocity(this.motion.velocities.subarray(v, v + 3),
                this.motion.velocities.subarray(v + 3, v + 6), this.motion.poses.subarray(m, m + 3), origin);
            const release = quatRotateVec3(velocity, q);
            velocity = inheritedVelocity.map((value, axis) => value + release[axis]);
        }
        let hit = this.impact(origin, velocity);
        if (!hit) { velocity = inheritedVelocity; hit = this.impact(origin, velocity); }
        if (!hit) return null; // Keep an unsupported release in its donor.
        const id = this.nextId + pendingCount;
        if (!Number.isSafeInteger(id) || id >= Number.MAX_SAFE_INTEGER) throw new RangeError('Runoff identity exhausted');
        return { id, edge, phase, origin, velocity, birthTime: timeSeconds, impactTime: timeSeconds + hit.duration,
            destinationIndex: hit.index, destination: hit.position, ...(this.motion ? { nativeMotion: true } : {}) };
    }
    impact(origin, velocity) {
        const t = this.topology; let first = null;
        for (let d = 0; d < t.domains.length; d++) {
            const floor = t.domains[d]; if (!floor.receiveRunoff) continue;
            const height = floor.center[1] + (origin[0] - floor.center[0]) * floor.tiltX + (origin[2] - floor.center[2]) * floor.tiltZ;
            const clearance = origin[1] - height; if (clearance <= 0) continue;
            const speed = velocity[1] - floor.tiltX * velocity[0] - floor.tiltZ * velocity[2];
            const duration = (speed + Math.sqrt(speed * speed + 2 * SURFACE_RUNOFF_GRAVITY * clearance)) / SURFACE_RUNOFF_GRAVITY;
            const x = origin[0] + velocity[0] * duration, z = origin[2] + velocity[2] * duration;
            const u = .5 + (x - floor.center[0]) / floor.size[0], v = .5 + (z - floor.center[2]) / floor.size[1];
            if (u < 0 || u >= 1 || v < 0 || v >= 1 || first && duration >= first.duration) continue;
            first = { duration, index: t.address(d, Math.floor(u * t.n), Math.floor(v * t.n)),
                position: [x, floor.center[1] + (x - floor.center[0]) * floor.tiltX + (z - floor.center[2]) * floor.tiltZ, z] };
        }
        return first;
    }
    commit(parcels) {
        for (const parcel of parcels) this.parcels.set(parcel.id, parcel);
        this.nextId += parcels.length;
    }
    snapshot() {
        return { version: 1, enabled: this.enabled, capacity: this.capacity, nextId: this.nextId,
            blockedVolumeM3: this.blockedVolumeM3, depositedCount: this.depositedCount,
            parcels: [...this.parcels.values()].map(parcel => ({ ...parcel, origin: [...parcel.origin], velocity: [...parcel.velocity], destination: [...parcel.destination] })) };
    }
    restore(input, timeSeconds, retainedState) {
        const snapshot = cloneStrictJson(input, '$.surfaceRunoff');
        if (snapshot.version !== 1) throw new RangeError('Unsupported runoff checkpoint');
        if (typeof snapshot.enabled !== 'boolean' || !Number.isInteger(snapshot.capacity)) throw new RangeError('Runoff checkpoint requires explicit configuration');
        const candidate = new SurfaceFieldRunoff(this.topology, snapshot);
        candidate.setMotion(this.motion);
        if (!Number.isSafeInteger(snapshot.nextId) || snapshot.nextId < 1 || !Number.isSafeInteger(snapshot.depositedCount) || snapshot.depositedCount < 0
            || !Array.isArray(snapshot.parcels) || snapshot.parcels.length > candidate.capacity || !candidate.enabled && snapshot.parcels.length) throw new RangeError('Invalid runoff ownership checkpoint');
        // Every admitted identity is either still airborne or deposited. Use
        // subtraction so a forged near-limit counter cannot round on addition.
        if (snapshot.depositedCount !== snapshot.nextId - 1 - snapshot.parcels.length) throw new RangeError('Runoff checkpoint has inconsistent parcel history');
        candidate.nextId = snapshot.nextId; candidate.depositedCount = snapshot.depositedCount;
        candidate.blockedVolumeM3 = number(snapshot.blockedVolumeM3, 'blocked volume');
        for (const item of snapshot.parcels) {
            const source = Math.floor(item.edge / 4), domain = this.topology.domains[this.topology.meta[source * 8 + 4]];
            const nativeEdge = item.nativeMotion === true && Number.isInteger(item.edge) && item.edge >= 0
                && item.edge < this.topology.count * 4 && domain && !domain.receiveRunoff;
            if (item.nativeMotion !== undefined && item.nativeMotion !== true) throw new RangeError('Invalid runoff native release provenance');
            if (!Number.isSafeInteger(item.id) || item.id < 1 || item.id >= candidate.nextId || candidate.parcels.has(item.id)
                || !(nativeEdge || this.topology.edgeSources.includes(item.edge)) || !['aqueous', 'oil'].includes(item.phase)) throw new RangeError('Invalid runoff parcel identity');
            for (const key of ['origin', 'velocity', 'destination']) {
                if (!Array.isArray(item[key]) || item[key].length !== 3) throw new RangeError('Invalid runoff vector');
                item[key].forEach(value => number(value, key, -1e12, 1e12));
            }
            number(item.birthTime, 'birth time', 0, timeSeconds); number(item.impactTime, 'impact time', timeSeconds, 1e12);
            if (item.impactTime <= timeSeconds) throw new RangeError('Checkpoint retained an already deposited parcel');
            const hit = candidate.impact(item.origin, item.velocity);
            if (!hit || hit.index !== item.destinationIndex || Math.abs(item.impactTime - item.birthTime - hit.duration) > 1e-9
                || hit.position.some((value, axis) => Math.abs(value - item.destination[axis]) > 1e-9)) throw new RangeError('Runoff checkpoint changed its impact');
            const state = retainedState(item.state, `surface:chemical-runoff:${item.id}`, item.phase);
            if (!Object.values(state.conserved.speciesMassKg).some(value => value > 0)) throw new RangeError('Runoff parcel has no retained mass');
            candidate.parcels.set(item.id, { ...item, state });
        }
        Object.assign(this, candidate); return this;
    }
}
