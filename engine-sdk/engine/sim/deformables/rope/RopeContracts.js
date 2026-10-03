// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const FABRIK_ROPE_DEFINITION_SCHEMA = 'engine.fabrik-rope-definition';
export const FABRIK_ROPE_DEFINITION_VERSION = '1.0.0';
export const FABRIK_ROPE_SNAPSHOT_SCHEMA = 'engine.rope.fabrik-snapshot';
export const FABRIK_ROPE_SNAPSHOT_VERSION = '1.0.0';
export const FABRIK_ROPE_SOLVER_VERSION = '1.0.0';
export const FABRIK_ROPE_BREAK_RECEIPT_SCHEMA = 'engine.rope.break-receipt';
export const FABRIK_ROPE_BREAK_RECEIPT_VERSION = '1.0.0';

export const FABRIK_ROPE_LIMITS = Object.freeze({
    mechanicalRateHz: 240,
    maximumLiveSegments: 512,
    maximumAuthoredSegments: 2048,
    maximumSolverIterations: 128,
    maximumAttachments: 2,
    maximumColliderReferences: 256,
    maximumTopologyOperations: 2048,
    maximumIdentifierLength: 128,
    maximumLengthMeters: 1_000_000,
    maximumRadiusMeters: 10_000,
    maximumAccelerationMetersPerSecondSquared: 1_000_000,
    maximumDampingPerSecond: 1_000_000,
    maximumComplianceMetersPerNewton: 1_000_000,
    maximumForceNewtons: 1e18,
});

const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9._:/-]{0,127}$/;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const TOP_LEVEL_KEYS = new Set([
    'schema', 'schemaVersion', 'id', 'segmentCount', 'segmentIds', 'pointIds',
    'restLengthMeters', 'radiusMeters', 'mechanicalRateHz', 'solverIterations',
    'toleranceMeters', 'gravityMetersPerSecondSquared', 'dampingPerSecond',
    'stretchComplianceMetersPerNewton', 'bendResponse', 'collision',
    'attachments', 'material', 'rendererId', 'breaking',
    'maximumTopologyOperations', 'snapshotPolicy',
]);
const MATERIAL_KEYS = new Set([
    'id', 'hash', 'linearDensityKilogramsPerMeter', 'dampingPerSecond',
    'staticFriction', 'dynamicFriction', 'bendResponse',
    'tensileLimitNewtons', 'breakingStrengthNewtons',
]);
const COLLISION_KEYS = new Set([
    'enabled', 'colliderIds', 'contactOffsetMeters', 'selfCollision',
]);
const ATTACHMENT_KEYS = new Set(['id', 'pointId', 'pointIndex']);
const BREAKING_KEYS = new Set(['enabled', 'thresholdNewtons', 'consecutiveTicks']);
const SNAPSHOT_POLICIES = new Set(['none', 'optional', 'required']);
const NORMALIZED_DEFINITIONS = new WeakSet();

export class RopeContractError extends Error {
    constructor(code, message, details = null) {
        super(String(message));
        this.name = 'RopeContractError';
        this.code = String(code || 'ROPE_CONTRACT');
        this.details = details;
    }
}

export function failRopeContract(code, message, details = null) {
    throw new RopeContractError(code, message, details);
}

function isArrayIndexKey(key, length) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(key)) return false;
    const index = Number(key);
    return Number.isSafeInteger(index) && index >= 0 && index < length;
}

export function readRopeRecord(value, label, allowedKeys = null) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        failRopeContract('ROPE_RECORD', `${label} must be a plain object`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        failRopeContract('ROPE_RECORD', `${label} must have a plain or null prototype`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length > 0) {
        failRopeContract('ROPE_RECORD_SYMBOL', `${label} must not contain symbol keys`);
    }
    const result = Object.create(null);
    for (const [key, descriptor] of Object.entries(descriptors)) {
        if (!Object.hasOwn(descriptor, 'value')) {
            failRopeContract('ROPE_RECORD_ACCESSOR', `${label}.${key} must be a data property`);
        }
        if (allowedKeys && !allowedKeys.has(key)) {
            failRopeContract('ROPE_UNKNOWN_FIELD', `${label} contains unknown field '${key}'`);
        }
        result[key] = descriptor.value;
    }
    return result;
}

export function readRopeArray(value, label, {
    minimumLength = 0,
    maximumLength = Number.MAX_SAFE_INTEGER,
} = {}) {
    if (!Array.isArray(value)) failRopeContract('ROPE_ARRAY', `${label} must be an array`);
    if (value.length < minimumLength || value.length > maximumLength) {
        failRopeContract(
            'ROPE_ARRAY_LENGTH',
            `${label} length must be in [${minimumLength}, ${maximumLength}]`,
        );
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
        failRopeContract('ROPE_ARRAY_SYMBOL', `${label} must not contain symbol keys`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const [key, descriptor] of Object.entries(descriptors)) {
        if (key === 'length') continue;
        if (!isArrayIndexKey(key, value.length)) {
            failRopeContract('ROPE_ARRAY_FIELD', `${label} contains non-index field '${key}'`);
        }
        if (!Object.hasOwn(descriptor, 'value')) {
            failRopeContract('ROPE_ARRAY_ACCESSOR', `${label}[${key}] must be a data property`);
        }
    }
    const result = new Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
            failRopeContract('ROPE_ARRAY_DENSE', `${label} must be dense at index ${index}`);
        }
        result[index] = descriptor.value;
    }
    return result;
}

export function normalizeRopeNumber(value, label, {
    minimum = -Number.MAX_VALUE,
    maximum = Number.MAX_VALUE,
    exclusiveMinimum = false,
} = {}) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        failRopeContract('ROPE_NUMBER', `${label} must be a finite number`);
    }
    if ((exclusiveMinimum ? value <= minimum : value < minimum) || value > maximum) {
        const relation = exclusiveMinimum ? `(${minimum}, ${maximum}]` : `[${minimum}, ${maximum}]`;
        failRopeContract('ROPE_NUMBER_RANGE', `${label} must be in ${relation}`);
    }
    return Object.is(value, -0) ? 0 : value;
}

export function normalizeRopeInteger(value, label, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        failRopeContract('ROPE_INTEGER', `${label} must be a safe integer in [${minimum}, ${maximum}]`);
    }
    return value;
}

export function normalizeRopeStableId(value, label) {
    if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
        failRopeContract(
            'ROPE_IDENTIFIER',
            `${label} must match ${IDENTIFIER_PATTERN} and be at most ${FABRIK_ROPE_LIMITS.maximumIdentifierLength} characters`,
        );
    }
    return value;
}

export function normalizeRopeHash(value, label) {
    if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
        failRopeContract('ROPE_HASH', `${label} must be a lowercase sha256: hash`);
    }
    return value;
}

export function normalizeRopeVector3(value, label, {
    minimum = -FABRIK_ROPE_LIMITS.maximumLengthMeters,
    maximum = FABRIK_ROPE_LIMITS.maximumLengthMeters,
} = {}) {
    const source = readRopeArray(value, label, { minimumLength: 3, maximumLength: 3 });
    return Object.freeze(source.map((entry, index) => normalizeRopeNumber(
        entry,
        `${label}[${index}]`,
        { minimum, maximum },
    )));
}

export function freezeRopeValue(value) {
    if (Array.isArray(value)) {
        for (const entry of value) freezeRopeValue(entry);
        return Object.freeze(value);
    }
    if (value && typeof value === 'object') {
        for (const entry of Object.values(value)) freezeRopeValue(entry);
        return Object.freeze(value);
    }
    return value;
}

function normalizeIdArray(raw, label, expectedLength) {
    const source = readRopeArray(raw, label, {
        minimumLength: expectedLength,
        maximumLength: expectedLength,
    });
    const ids = source.map((value, index) => normalizeRopeStableId(value, `${label}[${index}]`));
    if (new Set(ids).size !== ids.length) {
        failRopeContract('ROPE_DUPLICATE_IDENTIFIER', `${label} must contain unique stable IDs`);
    }
    return Object.freeze(ids);
}

function derivedPointIds(ropeId, pointCount) {
    const width = Math.max(4, String(pointCount - 1).length);
    const ids = Array.from(
        { length: pointCount },
        (_, index) => `${ropeId}.point.${String(index).padStart(width, '0')}`,
    );
    for (const [index, id] of ids.entries()) normalizeRopeStableId(id, `derived point ID ${index}`);
    return Object.freeze(ids);
}

function normalizeMaterial(raw) {
    const source = readRopeRecord(raw, 'rope.material', MATERIAL_KEYS);
    const id = normalizeRopeStableId(source.id, 'rope.material.id');
    const hash = normalizeRopeHash(source.hash, 'rope.material.hash');
    const linearDensityKilogramsPerMeter = normalizeRopeNumber(
        source.linearDensityKilogramsPerMeter,
        'rope.material.linearDensityKilogramsPerMeter',
        { minimum: 0, maximum: 1e12, exclusiveMinimum: true },
    );
    const dampingPerSecond = normalizeRopeNumber(
        source.dampingPerSecond,
        'rope.material.dampingPerSecond',
        { minimum: 0, maximum: FABRIK_ROPE_LIMITS.maximumDampingPerSecond },
    );
    const staticFriction = normalizeRopeNumber(source.staticFriction, 'rope.material.staticFriction', {
        minimum: 0,
        maximum: 10,
    });
    const dynamicFriction = normalizeRopeNumber(source.dynamicFriction, 'rope.material.dynamicFriction', {
        minimum: 0,
        maximum: 10,
    });
    if (dynamicFriction > staticFriction) {
        failRopeContract('ROPE_MATERIAL_FRICTION', 'rope.material.dynamicFriction must not exceed staticFriction');
    }
    const bendResponse = normalizeRopeNumber(source.bendResponse, 'rope.material.bendResponse', {
        minimum: 0,
        maximum: 1,
    });
    const tensileLimitNewtons = normalizeRopeNumber(
        source.tensileLimitNewtons,
        'rope.material.tensileLimitNewtons',
        { minimum: 0, maximum: FABRIK_ROPE_LIMITS.maximumForceNewtons, exclusiveMinimum: true },
    );
    const breakingStrengthNewtons = normalizeRopeNumber(
        source.breakingStrengthNewtons,
        'rope.material.breakingStrengthNewtons',
        { minimum: 0, maximum: FABRIK_ROPE_LIMITS.maximumForceNewtons, exclusiveMinimum: true },
    );
    if (breakingStrengthNewtons < tensileLimitNewtons) {
        failRopeContract(
            'ROPE_MATERIAL_STRENGTH',
            'rope.material.breakingStrengthNewtons must be at least tensileLimitNewtons',
        );
    }
    return Object.freeze({
        id,
        hash,
        linearDensityKilogramsPerMeter,
        dampingPerSecond,
        staticFriction,
        dynamicFriction,
        bendResponse,
        tensileLimitNewtons,
        breakingStrengthNewtons,
    });
}

function normalizeCollision(raw) {
    const source = raw == null ? Object.create(null) : readRopeRecord(raw, 'rope.collision', COLLISION_KEYS);
    const enabled = source.enabled ?? false;
    if (typeof enabled !== 'boolean') failRopeContract('ROPE_COLLISION_ENABLED', 'rope.collision.enabled must be boolean');
    const colliderIds = source.colliderIds == null
        ? Object.freeze([])
        : normalizeIdArray(
            source.colliderIds,
            'rope.collision.colliderIds',
            readRopeArray(source.colliderIds, 'rope.collision.colliderIds', {
                maximumLength: FABRIK_ROPE_LIMITS.maximumColliderReferences,
            }).length,
        );
    const orderedColliderIds = Object.freeze([...colliderIds].sort((left, right) => left.localeCompare(right)));
    const contactOffsetMeters = normalizeRopeNumber(
        source.contactOffsetMeters ?? 0,
        'rope.collision.contactOffsetMeters',
        { minimum: 0, maximum: FABRIK_ROPE_LIMITS.maximumRadiusMeters },
    );
    const selfCollision = source.selfCollision ?? 'none';
    if (selfCollision !== 'none') {
        failRopeContract('ROPE_SELF_COLLISION_UNSUPPORTED', "Only selfCollision 'none' is currently supported");
    }
    if (!enabled && orderedColliderIds.length > 0) {
        failRopeContract('ROPE_COLLISION_DISABLED_REFERENCES', 'Disabled collision must not declare collider IDs');
    }
    if (enabled && orderedColliderIds.length === 0) {
        failRopeContract('ROPE_COLLISION_REFERENCES', 'Enabled collision requires at least one collider ID');
    }
    return Object.freeze({ enabled, colliderIds: orderedColliderIds, contactOffsetMeters, selfCollision });
}

function normalizeAttachments(raw, pointIds) {
    const source = readRopeArray(raw, 'rope.attachments', {
        minimumLength: 1,
        maximumLength: FABRIK_ROPE_LIMITS.maximumAttachments,
    });
    const pointIndexById = new Map(pointIds.map((id, index) => [id, index]));
    const attachments = source.map((entry, index) => {
        const record = readRopeRecord(entry, `rope.attachments[${index}]`, ATTACHMENT_KEYS);
        const id = normalizeRopeStableId(record.id, `rope.attachments[${index}].id`);
        const pointId = normalizeRopeStableId(record.pointId, `rope.attachments[${index}].pointId`);
        const pointIndex = pointIndexById.get(pointId);
        if (pointIndex == null) {
            failRopeContract('ROPE_ATTACHMENT_POINT', `Attachment '${id}' references unknown point '${pointId}'`);
        }
        if (record.pointIndex != null) {
            const compiledPointIndex = normalizeRopeInteger(
                record.pointIndex,
                `rope.attachments[${index}].pointIndex`,
                { minimum: 0, maximum: pointIds.length - 1 },
            );
            if (compiledPointIndex !== pointIndex) {
                failRopeContract(
                    'ROPE_ATTACHMENT_POINT_INDEX',
                    `Attachment '${id}' pointIndex does not match pointId '${pointId}'`,
                );
            }
        }
        if (pointIndex !== 0 && pointIndex !== pointIds.length - 1) {
            failRopeContract('ROPE_ATTACHMENT_ENDPOINT', `Attachment '${id}' must target a rope endpoint`);
        }
        return Object.freeze({ id, pointId, pointIndex });
    });
    if (new Set(attachments.map(entry => entry.id)).size !== attachments.length) {
        failRopeContract('ROPE_ATTACHMENT_DUPLICATE', 'Attachment IDs must be unique');
    }
    if (new Set(attachments.map(entry => entry.pointId)).size !== attachments.length) {
        failRopeContract('ROPE_ATTACHMENT_DUPLICATE_POINT', 'At most one attachment may target each endpoint');
    }
    return Object.freeze(attachments.sort((left, right) => left.id.localeCompare(right.id)));
}

function normalizeBreaking(raw, material, maximumTopologyOperations) {
    const source = raw == null ? Object.create(null) : readRopeRecord(raw, 'rope.breaking', BREAKING_KEYS);
    const enabled = source.enabled ?? false;
    if (typeof enabled !== 'boolean') failRopeContract('ROPE_BREAKING_ENABLED', 'rope.breaking.enabled must be boolean');
    const thresholdNewtons = normalizeRopeNumber(
        source.thresholdNewtons ?? material.breakingStrengthNewtons,
        'rope.breaking.thresholdNewtons',
        { minimum: 0, maximum: FABRIK_ROPE_LIMITS.maximumForceNewtons, exclusiveMinimum: true },
    );
    if (thresholdNewtons > material.breakingStrengthNewtons) {
        failRopeContract(
            'ROPE_BREAKING_MATERIAL_LIMIT',
            'rope.breaking.thresholdNewtons must not exceed material breaking strength',
        );
    }
    const consecutiveTicks = normalizeRopeInteger(
        source.consecutiveTicks ?? 1,
        'rope.breaking.consecutiveTicks',
        { minimum: 1, maximum: 1_000_000 },
    );
    if (enabled && maximumTopologyOperations < 1) {
        failRopeContract(
            'ROPE_BREAKING_TOPOLOGY_BUDGET',
            'Enabled breaking requires maximumTopologyOperations of at least one',
        );
    }
    return Object.freeze({ enabled, thresholdNewtons, consecutiveTicks });
}

/** Normalize one authored rope definition into an immutable Engine contract. */
export function normalizeFabrikRopeDefinition(raw) {
    const source = readRopeRecord(raw, 'rope', TOP_LEVEL_KEYS);
    if (source.schema !== FABRIK_ROPE_DEFINITION_SCHEMA) {
        failRopeContract('ROPE_SCHEMA', `rope.schema must be '${FABRIK_ROPE_DEFINITION_SCHEMA}'`);
    }
    if (source.schemaVersion !== FABRIK_ROPE_DEFINITION_VERSION) {
        failRopeContract('ROPE_SCHEMA_VERSION', `rope.schemaVersion must be '${FABRIK_ROPE_DEFINITION_VERSION}'`);
    }
    const id = normalizeRopeStableId(source.id, 'rope.id');
    const segmentCount = normalizeRopeInteger(source.segmentCount, 'rope.segmentCount', {
        minimum: 1,
        maximum: FABRIK_ROPE_LIMITS.maximumAuthoredSegments,
    });
    const segmentIds = normalizeIdArray(source.segmentIds, 'rope.segmentIds', segmentCount);
    const pointIds = source.pointIds == null
        ? derivedPointIds(id, segmentCount + 1)
        : normalizeIdArray(source.pointIds, 'rope.pointIds', segmentCount + 1);
    const allIds = [...segmentIds, ...pointIds];
    if (new Set(allIds).size !== allIds.length) {
        failRopeContract('ROPE_CROSS_IDENTIFIER_DUPLICATE', 'Segment and point IDs must not overlap');
    }
    const restLengthMeters = normalizeRopeNumber(source.restLengthMeters, 'rope.restLengthMeters', {
        minimum: 0,
        maximum: FABRIK_ROPE_LIMITS.maximumLengthMeters,
        exclusiveMinimum: true,
    });
    const radiusMeters = normalizeRopeNumber(source.radiusMeters, 'rope.radiusMeters', {
        minimum: 0,
        maximum: FABRIK_ROPE_LIMITS.maximumRadiusMeters,
        exclusiveMinimum: true,
    });
    const mechanicalRateHz = normalizeRopeInteger(
        source.mechanicalRateHz ?? FABRIK_ROPE_LIMITS.mechanicalRateHz,
        'rope.mechanicalRateHz',
        { minimum: FABRIK_ROPE_LIMITS.mechanicalRateHz, maximum: FABRIK_ROPE_LIMITS.mechanicalRateHz },
    );
    const solverIterations = normalizeRopeInteger(source.solverIterations ?? 12, 'rope.solverIterations', {
        minimum: 1,
        maximum: FABRIK_ROPE_LIMITS.maximumSolverIterations,
    });
    const toleranceMeters = normalizeRopeNumber(source.toleranceMeters ?? 1e-4, 'rope.toleranceMeters', {
        minimum: 0,
        maximum: 1,
        exclusiveMinimum: true,
    });
    const gravityMetersPerSecondSquared = normalizeRopeVector3(
        source.gravityMetersPerSecondSquared ?? [0, -9.80665, 0],
        'rope.gravityMetersPerSecondSquared',
        {
            minimum: -FABRIK_ROPE_LIMITS.maximumAccelerationMetersPerSecondSquared,
            maximum: FABRIK_ROPE_LIMITS.maximumAccelerationMetersPerSecondSquared,
        },
    );
    const material = normalizeMaterial(source.material);
    const dampingPerSecond = normalizeRopeNumber(
        source.dampingPerSecond ?? material.dampingPerSecond,
        'rope.dampingPerSecond',
        { minimum: 0, maximum: FABRIK_ROPE_LIMITS.maximumDampingPerSecond },
    );
    const stretchComplianceMetersPerNewton = normalizeRopeNumber(
        source.stretchComplianceMetersPerNewton ?? 0,
        'rope.stretchComplianceMetersPerNewton',
        { minimum: 0, maximum: FABRIK_ROPE_LIMITS.maximumComplianceMetersPerNewton },
    );
    const bendResponse = normalizeRopeNumber(source.bendResponse ?? material.bendResponse, 'rope.bendResponse', {
        minimum: 0,
        maximum: 1,
    });
    const collision = normalizeCollision(source.collision);
    const attachments = normalizeAttachments(source.attachments, pointIds);
    const rendererId = source.rendererId == null ? null : normalizeRopeStableId(source.rendererId, 'rope.rendererId');
    const maximumTopologyOperations = normalizeRopeInteger(
        source.maximumTopologyOperations ?? 0,
        'rope.maximumTopologyOperations',
        { minimum: 0, maximum: Math.min(segmentCount, FABRIK_ROPE_LIMITS.maximumTopologyOperations) },
    );
    const breaking = normalizeBreaking(source.breaking, material, maximumTopologyOperations);
    const snapshotPolicy = source.snapshotPolicy ?? 'optional';
    if (!SNAPSHOT_POLICIES.has(snapshotPolicy)) {
        failRopeContract('ROPE_SNAPSHOT_POLICY', "rope.snapshotPolicy must be 'none', 'optional', or 'required'");
    }
    const normalized = Object.freeze({
        schema: FABRIK_ROPE_DEFINITION_SCHEMA,
        schemaVersion: FABRIK_ROPE_DEFINITION_VERSION,
        id,
        segmentCount,
        segmentIds,
        pointIds,
        restLengthMeters,
        radiusMeters,
        mechanicalRateHz,
        solverIterations,
        toleranceMeters,
        gravityMetersPerSecondSquared,
        dampingPerSecond,
        stretchComplianceMetersPerNewton,
        bendResponse,
        collision,
        attachments,
        material,
        rendererId,
        breaking,
        maximumTopologyOperations,
        snapshotPolicy,
    });
    NORMALIZED_DEFINITIONS.add(normalized);
    return normalized;
}

export function assertLiveFabrikRopeDefinition(definition) {
    const normalized = NORMALIZED_DEFINITIONS.has(definition)
        ? definition
        : normalizeFabrikRopeDefinition(definition);
    if (normalized.segmentCount > FABRIK_ROPE_LIMITS.maximumLiveSegments) {
        failRopeContract(
            'ROPE_LIVE_SEGMENT_LIMIT',
            `Live rope '${normalized.id}' exceeds ${FABRIK_ROPE_LIMITS.maximumLiveSegments} segments`,
        );
    }
    return normalized;
}

/** Compile a canonical immutable plan for live or authored-only use. */
export function compileFabrikRope(raw, { live = true } = {}) {
    if (typeof live !== 'boolean') failRopeContract('ROPE_COMPILE_MODE', 'compileFabrikRope live must be boolean');
    const normalized = NORMALIZED_DEFINITIONS.has(raw) ? raw : normalizeFabrikRopeDefinition(raw);
    return live ? assertLiveFabrikRopeDefinition(normalized) : normalized;
}

export function normalizeFabrikRopePositions(raw, pointCount, label = 'rope positions') {
    const expected = normalizeRopeInteger(pointCount, 'rope point count', {
        minimum: 2,
        maximum: FABRIK_ROPE_LIMITS.maximumAuthoredSegments + 1,
    });
    const source = readRopeArray(raw, label, { minimumLength: expected, maximumLength: expected });
    return Object.freeze(source.map((value, index) => normalizeRopeVector3(value, `${label}[${index}]`)));
}

/** Normalize exact active anchor positions against the compiled stable attachment IDs. */
export function normalizeFabrikRopeAnchors(
    raw,
    definition,
    label = 'rope anchors',
    { requireAll = true } = {},
) {
    if (typeof requireAll !== 'boolean') {
        failRopeContract('ROPE_ANCHOR_MODE', `${label} requireAll must be boolean`);
    }
    const source = readRopeArray(raw, label, {
        minimumLength: 1,
        maximumLength: FABRIK_ROPE_LIMITS.maximumAttachments,
    });
    const expectedById = new Map(definition.attachments.map(attachment => [attachment.id, attachment]));
    const anchors = source.map((entry, index) => {
        const record = readRopeRecord(entry, `${label}[${index}]`, new Set(['id', 'position']));
        const id = normalizeRopeStableId(record.id, `${label}[${index}].id`);
        const attachment = expectedById.get(id);
        if (!attachment) failRopeContract('ROPE_ANCHOR_UNKNOWN', `${label}[${index}] references unknown attachment '${id}'`);
        return Object.freeze({
            id,
            pointId: attachment.pointId,
            pointIndex: attachment.pointIndex,
            position: normalizeRopeVector3(record.position, `${label}[${index}].position`),
        });
    });
    if (new Set(anchors.map(anchor => anchor.id)).size !== anchors.length) {
        failRopeContract('ROPE_ANCHOR_DUPLICATE', `${label} contains duplicate attachment IDs`);
    }
    if (requireAll && (anchors.length !== definition.attachments.length
        || anchors.some(anchor => !expectedById.has(anchor.id)))) {
        failRopeContract('ROPE_ANCHOR_SET', `${label} must contain every compiled attachment exactly once`);
    }
    return Object.freeze(anchors.sort((left, right) => left.id.localeCompare(right.id)));
}
