// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
    FABRIK_ROPE_LIMITS,
    RopeContractError,
    failRopeContract,
    normalizeRopeNumber,
    normalizeRopeStableId,
    normalizeRopeVector3,
    readRopeArray,
    readRopeRecord,
} from './RopeContracts.js';

export const ROPE_COLLIDER_SET_SCHEMA = 'engine.rope.collider-set';
export const ROPE_COLLIDER_SET_VERSION = '1.0.0';
export const ROPE_COLLIDER_KINDS = Object.freeze(['plane', 'sphere', 'capsule']);

const COLLIDER_KIND_SET = new Set(ROPE_COLLIDER_KINDS);
const SET_KEYS = new Set(['schema', 'schemaVersion', 'colliders']);
const COMMON_KEYS = new Set(['id', 'kind', 'friction', 'restitution']);
const PLANE_KEYS = new Set([...COMMON_KEYS, 'normal', 'offsetMeters']);
const SPHERE_KEYS = new Set([...COMMON_KEYS, 'center', 'radiusMeters']);
const CAPSULE_KEYS = new Set([...COMMON_KEYS, 'start', 'end', 'radiusMeters']);
const EPSILON = 1e-12;
const NORMALIZED_COLLIDER_SETS = new WeakSet();

export class RopeCollisionError extends RopeContractError {
    constructor(code, message, details = null) {
        super(code, message, details);
        this.name = 'RopeCollisionError';
    }
}

function fail(code, message, details = null) {
    throw new RopeCollisionError(code, message, details);
}

function normalizedDirection(raw, label) {
    const vector = normalizeRopeVector3(raw, label, {
        minimum: -1e12,
        maximum: 1e12,
    });
    const length = Math.hypot(vector[0], vector[1], vector[2]);
    if (!(length > EPSILON)) fail('ROPE_COLLIDER_NORMAL', `${label} must be non-zero`);
    return Object.freeze(vector.map(component => component / length));
}

function commonCollider(source, label) {
    const id = normalizeRopeStableId(source.id, `${label}.id`);
    const friction = normalizeRopeNumber(source.friction ?? 0, `${label}.friction`, {
        minimum: 0,
        maximum: 10,
    });
    const restitution = normalizeRopeNumber(source.restitution ?? 0, `${label}.restitution`, {
        minimum: 0,
        maximum: 1,
    });
    return { id, friction, restitution };
}

function normalizeCollider(raw, index) {
    const label = `colliderSet.colliders[${index}]`;
    const initial = readRopeRecord(raw, label);
    if (typeof initial.kind !== 'string' || !COLLIDER_KIND_SET.has(initial.kind)) {
        const received = typeof initial.kind === 'string' ? initial.kind : typeof initial.kind;
        fail(
            'ROPE_COLLIDER_UNSUPPORTED',
            `${label}.kind '${received}' is unsupported; expected plane, sphere, or capsule`,
        );
    }
    const allowed = initial.kind === 'plane'
        ? PLANE_KEYS
        : initial.kind === 'sphere'
            ? SPHERE_KEYS
            : CAPSULE_KEYS;
    const source = readRopeRecord(raw, label, allowed);
    const common = commonCollider(source, label);
    if (source.kind === 'plane') {
        return Object.freeze({
            ...common,
            kind: 'plane',
            normal: normalizedDirection(source.normal, `${label}.normal`),
            offsetMeters: normalizeRopeNumber(source.offsetMeters, `${label}.offsetMeters`, {
                minimum: -FABRIK_ROPE_LIMITS.maximumLengthMeters,
                maximum: FABRIK_ROPE_LIMITS.maximumLengthMeters,
            }),
        });
    }
    if (source.kind === 'sphere') {
        return Object.freeze({
            ...common,
            kind: 'sphere',
            center: normalizeRopeVector3(source.center, `${label}.center`),
            radiusMeters: normalizeRopeNumber(source.radiusMeters, `${label}.radiusMeters`, {
                minimum: 0,
                maximum: FABRIK_ROPE_LIMITS.maximumRadiusMeters,
                exclusiveMinimum: true,
            }),
        });
    }
    const start = normalizeRopeVector3(source.start, `${label}.start`);
    const end = normalizeRopeVector3(source.end, `${label}.end`);
    const axisLength = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
    if (!(axisLength > EPSILON)) fail('ROPE_COLLIDER_CAPSULE_AXIS', `${label} capsule endpoints must differ`);
    return Object.freeze({
        ...common,
        kind: 'capsule',
        start,
        end,
        radiusMeters: normalizeRopeNumber(source.radiusMeters, `${label}.radiusMeters`, {
            minimum: 0,
            maximum: FABRIK_ROPE_LIMITS.maximumRadiusMeters,
            exclusiveMinimum: true,
        }),
    });
}

/** Compile registered analytic shapes in stable ID order. */
export function compileRopeColliderSet(raw = {
    schema: ROPE_COLLIDER_SET_SCHEMA,
    schemaVersion: ROPE_COLLIDER_SET_VERSION,
    colliders: [],
}) {
    if (NORMALIZED_COLLIDER_SETS.has(raw)) return raw;
    const source = readRopeRecord(raw, 'colliderSet', SET_KEYS);
    if (source.schema !== ROPE_COLLIDER_SET_SCHEMA) {
        fail('ROPE_COLLIDER_SET_SCHEMA', `colliderSet.schema must be '${ROPE_COLLIDER_SET_SCHEMA}'`);
    }
    if (source.schemaVersion !== ROPE_COLLIDER_SET_VERSION) {
        fail(
            'ROPE_COLLIDER_SET_VERSION',
            `colliderSet.schemaVersion must be '${ROPE_COLLIDER_SET_VERSION}'`,
        );
    }
    const entries = readRopeArray(source.colliders, 'colliderSet.colliders', {
        maximumLength: FABRIK_ROPE_LIMITS.maximumColliderReferences,
    }).map(normalizeCollider);
    entries.sort((left, right) => left.id.localeCompare(right.id));
    if (new Set(entries.map(collider => collider.id)).size !== entries.length) {
        fail('ROPE_COLLIDER_DUPLICATE', 'Collider IDs must be unique');
    }
    const compiled = Object.freeze({
        schema: ROPE_COLLIDER_SET_SCHEMA,
        schemaVersion: ROPE_COLLIDER_SET_VERSION,
        colliders: Object.freeze(entries),
    });
    NORMALIZED_COLLIDER_SETS.add(compiled);
    return compiled;
}

export const EMPTY_ROPE_COLLIDER_SET = compileRopeColliderSet();

/** Select exact registered colliders; a missing reference is an explicit failure. */
export function selectRopeColliderSet(compiledSet, colliderIds) {
    const exactSet = compileRopeColliderSet(compiledSet);
    const ids = readRopeArray(colliderIds, 'rope collider references', {
        maximumLength: FABRIK_ROPE_LIMITS.maximumColliderReferences,
    }).map((value, index) => normalizeRopeStableId(value, `rope collider references[${index}]`));
    if (new Set(ids).size !== ids.length) fail('ROPE_COLLIDER_REFERENCE_DUPLICATE', 'Collider references must be unique');
    const byId = new Map(exactSet.colliders.map(collider => [collider.id, collider]));
    const selected = [...ids]
        .sort((left, right) => left.localeCompare(right))
        .map(id => {
            const collider = byId.get(id);
            if (!collider) fail('ROPE_COLLIDER_REFERENCE_MISSING', `Registered collider '${id}' is missing`);
            return collider;
        });
    const selectedSet = Object.freeze({
        schema: ROPE_COLLIDER_SET_SCHEMA,
        schemaVersion: ROPE_COLLIDER_SET_VERSION,
        colliders: Object.freeze(selected),
    });
    NORMALIZED_COLLIDER_SETS.add(selectedSet);
    return selectedSet;
}

function stableAxis(id) {
    let hash = 2166136261;
    for (let index = 0; index < id.length; index += 1) {
        hash ^= id.charCodeAt(index);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    const axis = hash % 3;
    const sign = (hash & 4) === 0 ? 1 : -1;
    return axis === 0 ? [sign, 0, 0] : axis === 1 ? [0, sign, 0] : [0, 0, sign];
}

function capsuleFallbackNormal(collider) {
    const ax = collider.end[0] - collider.start[0];
    const ay = collider.end[1] - collider.start[1];
    const az = collider.end[2] - collider.start[2];
    const length = Math.hypot(ax, ay, az);
    const nx = ax / length;
    const ny = ay / length;
    const nz = az / length;
    const basis = Math.abs(nx) <= Math.abs(ny) && Math.abs(nx) <= Math.abs(nz)
        ? [1, 0, 0]
        : Math.abs(ny) <= Math.abs(nz)
            ? [0, 1, 0]
            : [0, 0, 1];
    const cx = ny * basis[2] - nz * basis[1];
    const cy = nz * basis[0] - nx * basis[2];
    const cz = nx * basis[1] - ny * basis[0];
    const crossLength = Math.hypot(cx, cy, cz);
    return [cx / crossLength, cy / crossLength, cz / crossLength];
}

function sphereContact(position, collider, clearance) {
    const dx = position[0] - collider.center[0];
    const dy = position[1] - collider.center[1];
    const dz = position[2] - collider.center[2];
    const distance = Math.hypot(dx, dy, dz);
    const targetDistance = collider.radiusMeters + clearance;
    if (distance >= targetDistance) return null;
    const normal = distance > EPSILON
        ? [dx / distance, dy / distance, dz / distance]
        : stableAxis(collider.id);
    return { normal, penetrationMeters: targetDistance - distance };
}

function capsuleContact(position, collider, clearance) {
    const ax = collider.end[0] - collider.start[0];
    const ay = collider.end[1] - collider.start[1];
    const az = collider.end[2] - collider.start[2];
    const lengthSquared = ax * ax + ay * ay + az * az;
    const px = position[0] - collider.start[0];
    const py = position[1] - collider.start[1];
    const pz = position[2] - collider.start[2];
    const t = Math.max(0, Math.min(1, (px * ax + py * ay + pz * az) / lengthSquared));
    const closest = [
        collider.start[0] + ax * t,
        collider.start[1] + ay * t,
        collider.start[2] + az * t,
    ];
    const dx = position[0] - closest[0];
    const dy = position[1] - closest[1];
    const dz = position[2] - closest[2];
    const distance = Math.hypot(dx, dy, dz);
    const targetDistance = collider.radiusMeters + clearance;
    if (distance >= targetDistance) return null;
    const normal = distance > EPSILON
        ? [dx / distance, dy / distance, dz / distance]
        : capsuleFallbackNormal(collider);
    return { normal, penetrationMeters: targetDistance - distance };
}

function contactFor(position, collider, clearance) {
    if (collider.kind === 'plane') {
        const signedDistance = position[0] * collider.normal[0]
            + position[1] * collider.normal[1]
            + position[2] * collider.normal[2]
            - collider.offsetMeters;
        if (signedDistance >= clearance) return null;
        return { normal: [...collider.normal], penetrationMeters: clearance - signedDistance };
    }
    if (collider.kind === 'sphere') return sphereContact(position, collider, clearance);
    return capsuleContact(position, collider, clearance);
}

function applyVelocityResponse(position, previousPosition, normal, friction, restitution, velocity) {
    let [vx, vy, vz] = velocity;
    let normalVelocity = vx * normal[0] + vy * normal[1] + vz * normal[2];
    if (normalVelocity < 0) {
        const impulse = -(1 + restitution) * normalVelocity;
        vx += normal[0] * impulse;
        vy += normal[1] * impulse;
        vz += normal[2] * impulse;
        normalVelocity = vx * normal[0] + vy * normal[1] + vz * normal[2];
    }
    const tx = vx - normal[0] * normalVelocity;
    const ty = vy - normal[1] * normalVelocity;
    const tz = vz - normal[2] * normalVelocity;
    const tangentScale = Math.max(0, 1 - friction);
    vx = normal[0] * normalVelocity + tx * tangentScale;
    vy = normal[1] * normalVelocity + ty * tangentScale;
    vz = normal[2] * normalVelocity + tz * tangentScale;
    previousPosition[0] = position[0] - vx;
    previousPosition[1] = position[1] - vy;
    previousPosition[2] = position[2] - vz;
}

function projectValidated(position, previousPosition, colliderSet, radius, contactOffset, materialFriction) {
    const contacts = [];
    for (const collider of colliderSet.colliders) {
        const contact = contactFor(position, collider, radius + contactOffset);
        if (!contact) continue;
        const velocity = [
            position[0] - previousPosition[0],
            position[1] - previousPosition[1],
            position[2] - previousPosition[2],
        ];
        const { normal, penetrationMeters } = contact;
        position[0] += normal[0] * penetrationMeters;
        position[1] += normal[1] * penetrationMeters;
        position[2] += normal[2] * penetrationMeters;
        const friction = Math.min(1, Math.sqrt(materialFriction * collider.friction));
        applyVelocityResponse(position, previousPosition, normal, friction, collider.restitution, velocity);
        contacts.push(Object.freeze({
            colliderId: collider.id,
            kind: collider.kind,
            normal: Object.freeze([...normal]),
            penetrationMeters,
        }));
    }
    return Object.freeze(contacts);
}

function normalizedProjectionOptions({ radiusMeters, contactOffsetMeters = 0, dynamicFriction = 0 } = {}) {
    return Object.freeze({
        radiusMeters: normalizeRopeNumber(radiusMeters, 'rope collision radiusMeters', {
            minimum: 0,
            maximum: FABRIK_ROPE_LIMITS.maximumRadiusMeters,
            exclusiveMinimum: true,
        }),
        contactOffsetMeters: normalizeRopeNumber(contactOffsetMeters, 'rope collision contactOffsetMeters', {
            minimum: 0,
            maximum: FABRIK_ROPE_LIMITS.maximumRadiusMeters,
        }),
        dynamicFriction: normalizeRopeNumber(dynamicFriction, 'rope collision dynamicFriction', {
            minimum: 0,
            maximum: 10,
        }),
    });
}

/**
 * Project one caller-owned transient point candidate. Canonical collider inputs
 * remain immutable; only the supplied transient position arrays are changed.
 */
export function projectRopePointCollisionsInPlace(position, previousPosition, colliderSet, {
    radiusMeters,
    contactOffsetMeters = 0,
    dynamicFriction = 0,
} = {}) {
    if ((!Array.isArray(position) && !ArrayBuffer.isView(position)) || position.length !== 3
        || (!Array.isArray(previousPosition) && !ArrayBuffer.isView(previousPosition))
        || previousPosition.length !== 3) {
        fail('ROPE_COLLISION_POINT', 'Collision projection requires two mutable xyz vectors');
    }
    const exactSet = compileRopeColliderSet(colliderSet);
    const options = normalizedProjectionOptions({ radiusMeters, contactOffsetMeters, dynamicFriction });
    return projectValidated(
        position,
        previousPosition,
        exactSet,
        options.radiusMeters,
        options.contactOffsetMeters,
        options.dynamicFriction,
    );
}

/** Build a low-allocation projector after validating immutable inputs once. */
export function createRopeCollisionProjector(colliderSet, options) {
    const exactSet = compileRopeColliderSet(colliderSet);
    const normalized = normalizedProjectionOptions(options);
    return Object.freeze({
        colliderSet: exactSet,
        options: normalized,
        projectInPlace(position, previousPosition) {
            return projectValidated(
                position,
                previousPosition,
                exactSet,
                normalized.radiusMeters,
                normalized.contactOffsetMeters,
                normalized.dynamicFriction,
            );
        },
    });
}

/** Pure convenience wrapper over the transient in-place projection. */
export function projectRopePointCollisions(position, previousPosition, colliderSet, options) {
    const current = [...normalizeRopeVector3(position, 'rope collision position')];
    const previous = [...normalizeRopeVector3(previousPosition, 'rope collision previousPosition')];
    const contacts = projectRopePointCollisionsInPlace(current, previous, colliderSet, options);
    return Object.freeze({
        position: Object.freeze(current),
        previousPosition: Object.freeze(previous),
        contacts,
    });
}

export function assertSupportedRopeColliderKind(kind) {
    if (!COLLIDER_KIND_SET.has(kind)) {
        failRopeContract('ROPE_COLLIDER_UNSUPPORTED', `Unsupported rope collider kind '${String(kind)}'`);
    }
    return kind;
}
