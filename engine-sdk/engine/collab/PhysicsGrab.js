// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PhysicsGrab.js
 * Mass-proportional spring-damper (PD controller) physics grab system.
 *
 * How other games do it:
 *   - Garry's Mod Physgun:     pure spring-damper, body stays dynamic
 *   - Half-Life 2 gravity gun: spring + angular correction torque
 *   - Boneworks/BONELAB VR:    PD controller with grip strength cap
 *   - UE4 Physics Handle:      D6 joint linear drive to target pos
 *
 * This implementation uses a **frequency / damping-ratio** parameterization
 * (ref: Orange Duck "Spring-It-On", Gaffer on Games "Spring Physics"):
 *
 *   omega = 2π × frequency         (natural frequency, rad/s)
 *   kp    = omega² × mass           (spring stiffness, N/m)  ← mass-proportional
 *   kd    = 2 × ζ × omega × mass    (damping, N·s/m)       ← mass-proportional
 *
 * With ζ = 1.0 (critical damping), the object reaches the target as fast as
 * possible with zero overshoot regardless of mass. A 0.5 kg ball and a 200 kg
 * crate both converge at the same rate.
 *
 * Multiple players grabbing the same object creates competing spring
 * forces that resolve naturally through physics — tug-of-war emerges
 * with no special-case code needed.
 *
 * Fatigue model (Boneworks-inspired):
 *   - Holding heavy objects drains fatigue over time
 *   - Effective strength = baseStrength * (0.2 + 0.8 * fatigue)
 *   - Minimum 20% strength even when exhausted
 *   - Fatigue recovers quickly when not holding
 *
 * Grip break:
 *   - Progressive grip weakening beyond GRIP_WEAKEN_DIST
 *   - Full slip at GRIP_BREAK_DIST
 *
 * Scope: point-target PD forces for dynamic rigid bodies. Constraint/joint
 * drives, rotational grabs, continuous collision detection, solver substep
 * tuning, and captured multi-peer PhysX traces remain outside this module.
 */

import { runtimeMonotonicClockStep } from '../core/math/FrameMath.js';
import { clamp } from '../core/math/MathScalar.js';
import { finiteNumberReport, vectorValidationReport } from '../core/math/MathValidation.js';
import { vec3Length, vec3Sub } from '../core/math/MathVec3.js';
import { spatialHashGridIdReport } from './SpatialHashGrid.js';

// ── Spring-damper constants (frequency / damping-ratio) ────────────────────────────

export const GRAB_FREQUENCY    = 3.5;   // Hz  — natural frequency (lower = smoother, more stable at variable fps)
export const GRAB_DAMPING_RATIO = 1.2;  //     — >1.0 = slightly overdamped (compensates discrete integration lag)
export const GRAB_MASS_DEFAULT = 1.0;   // kg  — fallback if mass unknown
export const PLAYER_STRENGTH   = 200;   // kg  — max mass a player can fully control
export const GRIP_WEAKEN_DIST  = 3.0;   // m   — grip starts weakening here
export const GRIP_BREAK_DIST   = 6.0;   // m   — grip slips completely here
export const FATIGUE_RATE      = 0.04;  // fraction per second at full load
export const FATIGUE_RECOVERY  = 0.15;  // fraction per second when resting
export const STALE_GRAB_MS     = 500;   // ms  — remote grab discarded if no refresh

export const PHYSICS_GRAB_LIMITS = Object.freeze({
    maxCoordinateMagnitude: 1e9,
    maxVelocityComponent: 1e6,
    maxStrength: 1e6,
    maxMass: 1e9,
    maxDeltaSeconds: 1,
    maxPeerIdBytes: 256,
    maxRemoteEntities: 256,
    maxRemoteGrabsPerEntity: 16,
    maxRemoteGrabs: 256,
});

// Precomputed omega for default frequency
const TWO_PI = 2 * Math.PI;
const _encoder = new TextEncoder();

function _zeroForce(reason, details = {}) {
    return {
        fx: 0,
        fy: 0,
        fz: 0,
        loadRatio: 0,
        stretch: 0,
        slipped: false,
        valid: false,
        reason,
        ...details,
    };
}

export function physicsGrabPeerIdReport(peerId) {
    const bytes = typeof peerId === 'string' ? _encoder.encode(peerId).byteLength : 0;
    const valid = typeof peerId === 'string' && peerId.length > 0 && bytes <= PHYSICS_GRAB_LIMITS.maxPeerIdBytes;
    return {
        valid,
        peerId,
        bytes,
        reason: valid ? 'valid' : (typeof peerId !== 'string' ? 'invalid-peer-id-type' : (peerId.length === 0 ? 'empty-peer-id' : 'peer-id-too-large')),
    };
}

export function physicsGrabVectorReport(value, kind = 'position') {
    const componentLimit = kind === 'velocity'
        ? PHYSICS_GRAB_LIMITS.maxVelocityComponent
        : PHYSICS_GRAB_LIMITS.maxCoordinateMagnitude;
    return vectorValidationReport(value, {
        dimension: 3,
        componentMin: -componentLimit,
        componentMax: componentLimit,
    });
}

export function physicsGrabForceReport(objPos, objVel, targetPos, strength, mass) {
    const position = physicsGrabVectorReport(objPos, 'position');
    const velocity = physicsGrabVectorReport(objVel, 'velocity');
    const target = physicsGrabVectorReport(targetPos, 'position');
    const strengthReport = finiteNumberReport(strength ?? PLAYER_STRENGTH, {
        min: 0,
        max: PHYSICS_GRAB_LIMITS.maxStrength,
    });
    const massReport = finiteNumberReport(mass ?? GRAB_MASS_DEFAULT, {
        min: 0,
        max: PHYSICS_GRAB_LIMITS.maxMass,
    });
    return {
        valid: position.valid && velocity.valid && target.valid && strengthReport.valid && massReport.valid,
        position,
        velocity,
        target,
        strength: strengthReport,
        mass: massReport,
    };
}

export function grabForceOperationReport(op, transportPeerId = null) {
    const payload = op?.payload;
    const peer = physicsGrabPeerIdReport(payload?.peerId);
    const transport = transportPeerId === null ? { valid: true } : physicsGrabPeerIdReport(transportPeerId);
    const entity = spatialHashGridIdReport(payload?.entityId);
    const target = physicsGrabVectorReport(payload?.targetPos, 'position');
    const strength = finiteNumberReport(payload?.strength, { min: 0, max: PHYSICS_GRAB_LIMITS.maxStrength });
    const fatigue = finiteNumberReport(payload?.fatigue, { min: 0, max: 1 });
    const timestamp = finiteNumberReport(payload?.ts, { integer: true, min: 0, max: Number.MAX_SAFE_INTEGER });
    const senderMatches = transportPeerId === null || payload?.peerId === transportPeerId;
    return {
        valid: op?.type === 'play_grab_force' && !!payload && peer.valid && transport.valid && senderMatches &&
            entity.valid && target.valid && strength.valid && fatigue.valid && timestamp.valid,
        typeValid: op?.type === 'play_grab_force',
        peer,
        transport,
        senderMatches,
        entity,
        target,
        strength,
        fatigue,
        timestamp,
    };
}

function _remoteGrabCount(remoteGrabs) {
    let count = 0;
    for (const grabs of remoteGrabs.values()) count += Array.isArray(grabs) ? grabs.length : 0;
    return count;
}

export function admitRemoteGrabForce(remoteGrabs, op, transportPeerId, receivedAtMs = Date.now()) {
    if (!(remoteGrabs instanceof Map)) return { accepted: false, reason: 'invalid-store' };
    const report = grabForceOperationReport(op, transportPeerId);
    if (!report.valid) return { accepted: false, reason: 'invalid-operation', report };
    const clock = runtimeMonotonicClockStep(receivedAtMs, 0);
    if (clock.timestampMs <= 0) return { accepted: false, reason: 'invalid-receive-clock', report };

    const { entityId, targetPos, strength, fatigue } = op.payload;
    const existing = remoteGrabs.get(entityId);
    const grabs = Array.isArray(existing) ? existing : [];
    const peerIndex = grabs.findIndex((grab) => grab.peerId === transportPeerId);
    if (peerIndex < 0) {
        if (!remoteGrabs.has(entityId) && remoteGrabs.size >= PHYSICS_GRAB_LIMITS.maxRemoteEntities) {
            return { accepted: false, reason: 'entity-capacity', report };
        }
        if (grabs.length >= PHYSICS_GRAB_LIMITS.maxRemoteGrabsPerEntity ||
            _remoteGrabCount(remoteGrabs) >= PHYSICS_GRAB_LIMITS.maxRemoteGrabs) {
            return { accepted: false, reason: 'grab-capacity', report };
        }
    }

    const entry = {
        peerId: transportPeerId,
        targetPos: [...targetPos],
        strength,
        fatigue,
        receivedAtMs: clock.timestampMs,
    };
    if (peerIndex >= 0) grabs[peerIndex] = entry;
    else grabs.push(entry);
    remoteGrabs.set(entityId, grabs);
    return { accepted: true, reason: 'accepted', entry: { ...entry, targetPos: [...entry.targetPos] }, report };
}

export function pruneRemoteGrabForces(remoteGrabs, nowMs = Date.now(), staleMs = STALE_GRAB_MS) {
    if (!(remoteGrabs instanceof Map)) return 0;
    const stale = finiteNumberReport(staleMs, { min: 0, max: 60000 });
    const now = runtimeMonotonicClockStep(nowMs, 0).timestampMs;
    if (!stale.valid || now <= 0) return 0;
    let removed = 0;
    for (const [entityId, grabs] of remoteGrabs) {
        if (!Array.isArray(grabs)) {
            remoteGrabs.delete(entityId);
            removed++;
            continue;
        }
        const fresh = grabs.filter((grab) => {
            const received = finiteNumberReport(grab?.receivedAtMs, { min: 0, max: Number.MAX_SAFE_INTEGER });
            const keep = received.valid && runtimeMonotonicClockStep(now, received.value).elapsedMs < stale.value;
            if (!keep) removed++;
            return keep;
        });
        if (fresh.length === 0) remoteGrabs.delete(entityId);
        else remoteGrabs.set(entityId, fresh);
    }
    return removed;
}

export function removeRemoteGrabPeer(remoteGrabs, peerId) {
    if (!(remoteGrabs instanceof Map) || !physicsGrabPeerIdReport(peerId).valid) return 0;
    let removed = 0;
    for (const [entityId, grabs] of remoteGrabs) {
        if (!Array.isArray(grabs)) {
            remoteGrabs.delete(entityId);
            continue;
        }
        const retained = grabs.filter((grab) => {
            if (grab?.peerId === peerId) { removed++; return false; }
            return true;
        });
        if (retained.length === 0) remoteGrabs.delete(entityId);
        else remoteGrabs.set(entityId, retained);
    }
    return removed;
}

// ── Grab force computation ──────────────────────────────────────────────────────────────

/**
 * Compute mass-proportional spring-damper grab force.
 *
 * Uses frequency/damping-ratio parameterization so the convergence rate
 * is identical regardless of object mass. Critical damping (ζ=1) means
 * the object reaches the cursor as fast as possible with zero overshoot.
 *
 * @param {number[]} objPos      - [x,y,z] current object world position
 * @param {number[]} objVel      - [x,y,z] current object linear velocity
 * @param {number[]} targetPos   - [x,y,z] where the player wants the object to go
 * @param {number}   strength    - player's effective strength (kg equivalent)
 * @param {number}   mass        - object mass in kg (for mass-proportional kp/kd)
 * @param {number[]} feedForwardForce - optional finite force in Newtons, subject to the same grip and strength bounds
 * @returns {{ fx, fy, fz, loadRatio, stretch, slipped }}
 */
export function computeGrabForce(objPos, objVel, targetPos, strength, mass, feedForwardForce = [0, 0, 0]) {
    const report = physicsGrabForceReport(objPos, objVel, targetPos, strength, mass);
    if (!report.valid) return _zeroForce('invalid-input', { report });
    const feedForward = physicsGrabVectorReport(feedForwardForce);
    if (!feedForward.valid) return _zeroForce('invalid-feed-forward', { report: feedForward });
    const delta = vec3Sub(targetPos, objPos);
    const dx = delta[0], dy = delta[1], dz = delta[2];
    const stretch = vec3Length(delta);

    // Grip slip: object drifted too far from cursor target
    if (stretch > GRIP_BREAK_DIST) {
        return { fx: 0, fy: 0, fz: 0, loadRatio: 0, stretch, slipped: true, valid: true, reason: 'grip-break' };
    }

    // Progressive grip weakening: between WEAKEN and BREAK dist, grip
    // force scales down linearly so the object doesn't snap back violently.
    let gripScale = 1.0;
    if (stretch > GRIP_WEAKEN_DIST) {
        gripScale = 1.0 - (stretch - GRIP_WEAKEN_DIST) / (GRIP_BREAK_DIST - GRIP_WEAKEN_DIST);
        gripScale = Math.max(0, gripScale);
    }

    // Mass-proportional spring constants (frequency/damping-ratio parameterization)
    // kp = omega^2 * m   — stiffness scales with mass → same convergence rate
    // kd = 2*zeta*omega*m — damping scales with mass → critical for all masses
    const m = Math.max(0.1, report.mass.value);
    const omega = TWO_PI * GRAB_FREQUENCY;
    const kp = omega * omega * m;
    const kd = 2.0 * GRAB_DAMPING_RATIO * omega * m;

    // Spring component: pull toward target
    // Damper component: oppose current velocity (suppresses oscillation)
    let fx = dx * kp - objVel[0] * kd;
    let fy = dy * kp - objVel[1] * kd;
    let fz = dz * kp - objVel[2] * kd;

    // A constrained controller may compensate a known external load. Sum it
    // before weakening/clamping so it cannot bypass player strength or fatigue.
    fx += feedForwardForce[0];
    fy += feedForwardForce[1];
    fz += feedForwardForce[2];

    // Apply grip weakening
    fx *= gripScale;
    fy *= gripScale;
    fz *= gripScale;

    // Max force: strength (kg) × 9.81 m/s² = max Newtons the player can exert
    const maxForce = report.strength.value * 9.81;
    const magnitude = Math.sqrt(fx * fx + fy * fy + fz * fz);
    const loadRatio = maxForce > 0 ? Math.min(1.0, magnitude / maxForce) : 0;

    // Clamp to strength limit (preserves direction)
    if (magnitude > maxForce && magnitude > 0) {
        const scale = maxForce / magnitude;
        fx *= scale;
        fy *= scale;
        fz *= scale;
    }

    return { fx, fy, fz, loadRatio, stretch, slipped: false, valid: true, reason: 'valid' };
}

/**
 * Update fatigue based on load this frame.
 * @param {number} fatigue   - current fatigue [0,1] (1 = fresh)
 * @param {number} loadRatio - fraction of max strength being used [0,1]
 * @param {number} dt        - frame delta time seconds
 * @returns {number} updated fatigue
 */
export function tickFatigue(fatigue, loadRatio, dt) {
    const acceptedFatigue = finiteNumberReport(fatigue, { min: 0, max: 1 });
    const acceptedLoad = finiteNumberReport(loadRatio, { min: 0, max: 1 });
    const acceptedDt = finiteNumberReport(dt, { min: 0, max: PHYSICS_GRAB_LIMITS.maxDeltaSeconds });
    const current = acceptedFatigue.valid ? acceptedFatigue.value : 1;
    const load = acceptedLoad.valid ? acceptedLoad.value : 0;
    const elapsed = acceptedDt.valid ? acceptedDt.value : 0;
    if (load > 0.05) {
        return clamp(current - load * FATIGUE_RATE * elapsed, 0, 1);
    }
    return clamp(current + FATIGUE_RECOVERY * elapsed, 0, 1);
}

/**
 * Effective strength considering fatigue.
 * Even fully exhausted players retain 20% strength (adrenaline).
 */
export function effectiveStrength(baseStrength, fatigue) {
    const base = finiteNumberReport(baseStrength, { min: 0, max: PHYSICS_GRAB_LIMITS.maxStrength });
    const state = finiteNumberReport(fatigue, { min: 0, max: 1 });
    if (!base.valid) return 0;
    return base.value * (0.2 + 0.8 * (state.valid ? state.value : 1));
}

/**
 * Check if an object is too heavy to pick up at all.
 * Returns false if mass > 4x strength (can't apply meaningful force).
 */
export function canGrab(mass, strength) {
    const massReport = finiteNumberReport(mass, { min: 0, max: PHYSICS_GRAB_LIMITS.maxMass });
    const strengthReport = finiteNumberReport(strength, { min: 0, max: PHYSICS_GRAB_LIMITS.maxStrength });
    return massReport.valid && strengthReport.valid && massReport.value <= strengthReport.value * 4;
}

// ── Grab state helpers ────────────────────────────────────────────────────────

/**
 * Create a local grab state for the player's own grab.
 */
export function createLocalGrab(entityId, targetPos, baseStrength) {
    const entity = spatialHashGridIdReport(entityId);
    const target = physicsGrabVectorReport(targetPos, 'position');
    const strength = finiteNumberReport(baseStrength, { min: 0, max: PHYSICS_GRAB_LIMITS.maxStrength });
    if (!entity.valid || !target.valid || !strength.valid) return null;
    return {
        entityId,
        targetPos: [...targetPos],
        baseStrength: strength.value,
        fatigue: 1.0,
        loadRatio: 0,
        active: true,
    };
}

/**
 * Build a play_grab_force op to broadcast our cursor target to peers.
 * Other peers apply the same spring force, creating tug-of-war physics.
 */
export function buildGrabForceOp(peerId, entityId, targetPos, strength, fatigue) {
    const op = {
        type: 'play_grab_force',
        payload: {
            peerId,
            entityId,
            targetPos,
            strength,
            fatigue,
            ts: Date.now(),
        },
    };
    if (!grabForceOperationReport(op, peerId).valid) return null;
    op.payload.targetPos = [...targetPos];
    return op;
}

/**
 * Apply all active grab forces to a PhysX actor.
 * Call this BEFORE stepPhysicsWorld each frame.
 *
 * @param {Object}   actor       - PhysX PxRigidBody actor
 * @param {Object}   PhysX       - PhysX WASM module
 * @param {number[]} objPos      - [x,y,z] current world position
 * @param {number[]} objVel      - [x,y,z] current linear velocity
 * @param {Object[]} grabs       - array of { targetPos, strength, fatigue }
 * @param {number}   mass        - object mass in kg for mass-proportional springs
 * @returns {{ totalLoadRatio: number, slipped: boolean }}
 */
export function applyGrabForcesToActor(actor, PhysX, objPos, objVel, grabs, mass) {
    if (!actor || !PhysX || !Array.isArray(grabs) || grabs.length === 0) {
        return { totalLoadRatio: 0, slipped: false, validGrabCount: 0, rejectedGrabCount: 0 };
    }
    if (typeof actor.addForce !== 'function') {
        return { totalLoadRatio: 0, slipped: false, validGrabCount: 0, rejectedGrabCount: grabs.length };
    }

    let totalFx = 0, totalFy = 0, totalFz = 0, totalLoad = 0;
    let anySlipped = false;
    let validGrabCount = 0;
    let rejectedGrabCount = 0;

    for (const grab of grabs.slice(0, PHYSICS_GRAB_LIMITS.maxRemoteGrabs)) {
        const baseStrength = finiteNumberReport(grab?.strength ?? PLAYER_STRENGTH, {
            min: 0,
            max: PHYSICS_GRAB_LIMITS.maxStrength,
        });
        const fatigue = finiteNumberReport(grab?.fatigue ?? 1, { min: 0, max: 1 });
        if (!baseStrength.valid || !fatigue.valid) { rejectedGrabCount++; continue; }
        const strength = effectiveStrength(baseStrength.value, fatigue.value);
        const result = computeGrabForce(objPos, objVel, grab.targetPos, strength, mass);
        if (!result.valid) { rejectedGrabCount++; continue; }
        validGrabCount++;
        if (result.slipped) { anySlipped = true; continue; }
        totalFx += result.fx;
        totalFy += result.fy;
        totalFz += result.fz;
        totalLoad = Math.max(totalLoad, result.loadRatio);
    }

    rejectedGrabCount += Math.max(0, grabs.length - PHYSICS_GRAB_LIMITS.maxRemoteGrabs);
    if (totalFx === 0 && totalFy === 0 && totalFz === 0) {
        return { totalLoadRatio: 0, slipped: anySlipped, validGrabCount, rejectedGrabCount };
    }

    let forceVec = null;
    try {
        forceVec = new PhysX.PxVec3(totalFx, totalFy, totalFz);
        // eFORCE = 0: PhysX integrates force × dt / mass → velocity (standard Newtonian)
        actor.addForce(forceVec, 0, true); // mode=0 (eFORCE), autowake=true
    } catch (_) {
    } finally {
        try { if (forceVec) PhysX.destroy(forceVec); } catch (_) {}
    }

    return { totalLoadRatio: totalLoad, slipped: anySlipped, validGrabCount, rejectedGrabCount };
}
