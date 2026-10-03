// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
    FABRIK_ROPE_BREAK_RECEIPT_SCHEMA,
    FABRIK_ROPE_BREAK_RECEIPT_VERSION,
    FABRIK_ROPE_LIMITS,
    FABRIK_ROPE_SOLVER_VERSION,
    assertLiveFabrikRopeDefinition,
    failRopeContract,
    freezeRopeValue,
    normalizeFabrikRopeAnchors,
    normalizeFabrikRopePositions,
    normalizeRopeInteger,
    normalizeRopeNumber,
    readRopeArray,
    readRopeRecord,
} from './RopeContracts.js';
import {
    EMPTY_ROPE_COLLIDER_SET,
    compileRopeColliderSet,
    createRopeCollisionProjector,
    selectRopeColliderSet,
} from './RopeCollisionContracts.js';

export const FABRIK_ROPE_STATE_SCHEMA = 'engine.rope.fabrik-state';
export const FABRIK_ROPE_STATE_VERSION = '1.0.0';
export const FABRIK_ROPE_TELEMETRY_SCHEMA = 'engine.rope.telemetry';
export const FABRIK_ROPE_TELEMETRY_VERSION = '1.0.0';

const STATE_OPTION_KEYS = new Set([
    'positions', 'previousPositions', 'velocities', 'anchors', 'freeLengthMeters', 'tick',
    'brokenSegmentIds', 'breakCounters', 'topologyOperations', 'breakReceipts',
    'lastTensionNewtons',
]);
const STEP_INPUT_KEYS = new Set(['anchors', 'freeLengthMeters', 'dtSeconds']);
const BREAK_RECEIPT_KEYS = new Set([
    'schema', 'schemaVersion', 'receiptId', 'ropeId', 'segmentId', 'tick',
    'topologyOperation', 'tensionNewtons', 'thresholdNewtons', 'materialHash',
    'solverVersion',
]);
const NORMALIZED_STATES = new WeakSet();
const EPSILON = 1e-12;

function frozenPositions(positions) {
    return Object.freeze(positions.map(position => Object.freeze([...position])));
}

function finiteVectorInPlace(vector, label) {
    for (let axis = 0; axis < 3; axis += 1) {
        if (!Number.isFinite(vector[axis])) {
            failRopeContract('ROPE_SOLVER_NONFINITE', `${label}[${axis}] became non-finite`);
        }
        if (Object.is(vector[axis], -0)) vector[axis] = 0;
    }
}

function normalizeBrokenSegmentIds(raw, definition) {
    if (raw == null) return Object.freeze([]);
    const source = readRopeArray(raw, 'rope brokenSegmentIds', { maximumLength: definition.segmentCount });
    const indexById = new Map(definition.segmentIds.map((id, index) => [id, index]));
    const ids = source.map((value, index) => {
        if (typeof value !== 'string' || !indexById.has(value)) {
            failRopeContract('ROPE_BROKEN_SEGMENT', `rope brokenSegmentIds[${index}] is unknown`);
        }
        return value;
    });
    if (new Set(ids).size !== ids.length) {
        failRopeContract('ROPE_BROKEN_SEGMENT_DUPLICATE', 'rope brokenSegmentIds must be unique');
    }
    ids.sort((left, right) => indexById.get(left) - indexById.get(right));
    return Object.freeze(ids);
}

function normalizeBreakCounters(raw, definition, brokenIds) {
    if (raw == null) return Object.freeze(new Array(definition.segmentCount).fill(0));
    const source = readRopeArray(raw, 'rope breakCounters', {
        minimumLength: definition.segmentCount,
        maximumLength: definition.segmentCount,
    });
    const broken = new Set(brokenIds);
    return Object.freeze(source.map((value, index) => {
        const counter = normalizeRopeInteger(value, `rope breakCounters[${index}]`, {
            minimum: 0,
            maximum: definition.breaking.consecutiveTicks,
        });
        if (broken.has(definition.segmentIds[index]) && counter !== 0) {
            failRopeContract('ROPE_BREAK_COUNTER_BROKEN', 'Broken segments must have a zero break counter');
        }
        return counter;
    }));
}

function expectedReceiptId(ropeId, segmentId, tick, topologyOperation) {
    return `${ropeId}.break.${segmentId}.${tick}.${topologyOperation}`;
}

function normalizeBreakReceipt(raw, definition, index) {
    const label = `rope breakReceipts[${index}]`;
    const source = readRopeRecord(raw, label, BREAK_RECEIPT_KEYS);
    if (source.schema !== FABRIK_ROPE_BREAK_RECEIPT_SCHEMA
        || source.schemaVersion !== FABRIK_ROPE_BREAK_RECEIPT_VERSION) {
        failRopeContract('ROPE_BREAK_RECEIPT_SCHEMA', `${label} schema/version is invalid`);
    }
    if (source.ropeId !== definition.id || !definition.segmentIds.includes(source.segmentId)) {
        failRopeContract('ROPE_BREAK_RECEIPT_IDENTITY', `${label} does not belong to rope '${definition.id}'`);
    }
    const tick = normalizeRopeInteger(source.tick, `${label}.tick`, { minimum: 1 });
    const topologyOperation = normalizeRopeInteger(source.topologyOperation, `${label}.topologyOperation`, {
        minimum: 1,
        maximum: definition.maximumTopologyOperations,
    });
    const receiptId = expectedReceiptId(definition.id, source.segmentId, tick, topologyOperation);
    if (source.receiptId !== receiptId) failRopeContract('ROPE_BREAK_RECEIPT_ID', `${label}.receiptId is not canonical`);
    if (source.materialHash !== definition.material.hash || source.solverVersion !== FABRIK_ROPE_SOLVER_VERSION) {
        failRopeContract('ROPE_BREAK_RECEIPT_AUTHORITY', `${label} material or solver authority is stale`);
    }
    const tensionNewtons = normalizeRopeNumber(source.tensionNewtons, `${label}.tensionNewtons`, {
        minimum: 0,
        maximum: FABRIK_ROPE_LIMITS.maximumForceNewtons,
    });
    const thresholdNewtons = normalizeRopeNumber(source.thresholdNewtons, `${label}.thresholdNewtons`, {
        minimum: 0,
        maximum: FABRIK_ROPE_LIMITS.maximumForceNewtons,
        exclusiveMinimum: true,
    });
    if (thresholdNewtons !== definition.breaking.thresholdNewtons) {
        failRopeContract('ROPE_BREAK_RECEIPT_THRESHOLD', `${label} threshold is stale for the active rope definition`);
    }
    if (tensionNewtons < thresholdNewtons) {
        failRopeContract('ROPE_BREAK_RECEIPT_TENSION', `${label} tension must meet its threshold`);
    }
    return Object.freeze({
        schema: FABRIK_ROPE_BREAK_RECEIPT_SCHEMA,
        schemaVersion: FABRIK_ROPE_BREAK_RECEIPT_VERSION,
        receiptId,
        ropeId: definition.id,
        segmentId: source.segmentId,
        tick,
        topologyOperation,
        tensionNewtons,
        thresholdNewtons,
        materialHash: definition.material.hash,
        solverVersion: FABRIK_ROPE_SOLVER_VERSION,
    });
}

function normalizeBreakReceipts(raw, definition, brokenIds, topologyOperations) {
    if (raw == null) {
        if (topologyOperations !== 0 || brokenIds.length !== 0) {
            failRopeContract('ROPE_BREAK_RECEIPTS_REQUIRED', 'Restored broken topology requires break receipts');
        }
        return Object.freeze([]);
    }
    const source = readRopeArray(raw, 'rope breakReceipts', {
        minimumLength: topologyOperations,
        maximumLength: topologyOperations,
    });
    const receipts = source.map((entry, index) => normalizeBreakReceipt(entry, definition, index));
    for (let index = 0; index < receipts.length; index += 1) {
        if (receipts[index].topologyOperation !== index + 1) {
            failRopeContract('ROPE_BREAK_RECEIPT_ORDER', 'Break receipts must use contiguous topology operation numbers');
        }
    }
    const receiptSegments = receipts.map(receipt => receipt.segmentId);
    if (new Set(receiptSegments).size !== receiptSegments.length
        || receiptSegments.length !== brokenIds.length
        || receiptSegments.some(segmentId => !brokenIds.includes(segmentId))) {
        failRopeContract('ROPE_BREAK_RECEIPT_SET', 'Break receipts must exactly cover broken segments');
    }
    return Object.freeze(receipts);
}

function zeroTelemetry(
    definition,
    tick,
    freeLengthMeters,
    anchors,
    brokenSegmentIds,
    topologyOperations,
    lastTensionNewtons = 0,
) {
    return freezeRopeValue({
        schema: FABRIK_ROPE_TELEMETRY_SCHEMA,
        schemaVersion: FABRIK_ROPE_TELEMETRY_VERSION,
        ropeId: definition.id,
        tick,
        segmentCount: definition.segmentCount,
        activeSegmentCount: definition.segmentCount - brokenSegmentIds.length,
        brokenSegmentIds: [...brokenSegmentIds],
        activeAttachmentIds: anchors.map(anchor => anchor.id),
        freeLengthMeters,
        targetSegmentLengthMeters: freeLengthMeters / definition.segmentCount,
        maxConstraintErrorMeters: 0,
        maxRelativeConstraintError: 0,
        maxStretchMeters: 0,
        maxCompressionMeters: 0,
        maxTensionNewtons: lastTensionNewtons,
        meanTensionNewtons: 0,
        overTensileSegmentIds: [],
        solverIterations: 0,
        converged: true,
        toleranceMeters: definition.toleranceMeters,
        collisionContacts: 0,
        maximumCollisionPenetrationMeters: 0,
        topologyOperations,
        breakReceipts: [],
    });
}

/** Create one immutable, solver-version-bound state candidate. */
function createFabrikRopeStateCandidate(definitionInput, options, { requireAllAttachments }) {
    const definition = assertLiveFabrikRopeDefinition(definitionInput);
    const source = readRopeRecord(options, 'rope state options', STATE_OPTION_KEYS);
    const positions = normalizeFabrikRopePositions(
        source.positions,
        definition.segmentCount + 1,
        'rope state positions',
    );
    const previousPositions = source.previousPositions == null
        ? positions
        : normalizeFabrikRopePositions(
            source.previousPositions,
            definition.segmentCount + 1,
            'rope state previousPositions',
        );
    const anchors = normalizeFabrikRopeAnchors(
        source.anchors,
        definition,
        'rope state anchors',
        { requireAll: requireAllAttachments },
    );
    const freeLengthMeters = normalizeRopeNumber(
        source.freeLengthMeters ?? definition.restLengthMeters,
        'rope state freeLengthMeters',
        {
            minimum: 0,
            maximum: definition.restLengthMeters,
            exclusiveMinimum: true,
        },
    );
    const tick = normalizeRopeInteger(source.tick ?? 0, 'rope state tick');
    const brokenSegmentIds = normalizeBrokenSegmentIds(source.brokenSegmentIds, definition);
    const topologyOperations = normalizeRopeInteger(source.topologyOperations ?? brokenSegmentIds.length, 'rope topologyOperations', {
        minimum: 0,
        maximum: definition.maximumTopologyOperations,
    });
    const lastTensionNewtons = normalizeRopeNumber(
        source.lastTensionNewtons ?? 0,
        'rope state lastTensionNewtons',
        { minimum: 0, maximum: FABRIK_ROPE_LIMITS.maximumForceNewtons },
    );
    if (topologyOperations !== brokenSegmentIds.length) {
        failRopeContract('ROPE_TOPOLOGY_BREAK_COUNT', 'Rope topologyOperations must equal its deterministic break count');
    }
    const breakCounters = normalizeBreakCounters(source.breakCounters, definition, brokenSegmentIds);
    const breakReceipts = normalizeBreakReceipts(
        source.breakReceipts,
        definition,
        brokenSegmentIds,
        topologyOperations,
    );
    const derivedVelocities = Object.freeze(positions.map((position, index) => Object.freeze([
        (position[0] - previousPositions[index][0]) * definition.mechanicalRateHz,
        (position[1] - previousPositions[index][1]) * definition.mechanicalRateHz,
        (position[2] - previousPositions[index][2]) * definition.mechanicalRateHz,
    ])));
    const velocities = source.velocities == null
        ? derivedVelocities
        : normalizeFabrikRopePositions(source.velocities, definition.segmentCount + 1, 'rope state velocities');
    if (source.velocities != null) {
        for (let pointIndex = 0; pointIndex < velocities.length; pointIndex += 1) {
            for (let axis = 0; axis < 3; axis += 1) {
                const expected = derivedVelocities[pointIndex][axis];
                const received = velocities[pointIndex][axis];
                const tolerance = Math.max(1e-12, Math.abs(expected) * 1e-12);
                if (Math.abs(received - expected) > tolerance) {
                    failRopeContract(
                        'ROPE_STATE_VELOCITY',
                        `rope state velocities[${pointIndex}][${axis}] disagrees with position history`,
                    );
                }
            }
        }
    }
    const state = Object.freeze({
        schema: FABRIK_ROPE_STATE_SCHEMA,
        schemaVersion: FABRIK_ROPE_STATE_VERSION,
        solverVersion: FABRIK_ROPE_SOLVER_VERSION,
        ropeId: definition.id,
        materialHash: definition.material.hash,
        tick,
        positions,
        previousPositions,
        velocities,
        anchors,
        freeLengthMeters,
        brokenSegmentIds,
        breakCounters,
        topologyOperations,
        breakReceipts,
        telemetry: zeroTelemetry(
            definition,
            tick,
            freeLengthMeters,
            anchors,
            brokenSegmentIds,
            topologyOperations,
            lastTensionNewtons,
        ),
    });
    NORMALIZED_STATES.add(state);
    return state;
}

/** Initial authored state requires every compiled attachment. */
export function createFabrikRopeState(definitionInput, options = {}) {
    return createFabrikRopeStateCandidate(definitionInput, options, { requireAllAttachments: true });
}

function normalizeStepInput(raw, definition, state) {
    const source = readRopeRecord(raw ?? {}, 'rope step input', STEP_INPUT_KEYS);
    const expectedDt = 1 / definition.mechanicalRateHz;
    const dtSeconds = normalizeRopeNumber(source.dtSeconds ?? expectedDt, 'rope step dtSeconds', {
        minimum: 0,
        maximum: expectedDt,
        exclusiveMinimum: true,
    });
    if (Math.abs(dtSeconds - expectedDt) > Number.EPSILON * expectedDt * 4) {
        failRopeContract(
            'ROPE_FIXED_STEP',
            `Rope '${definition.id}' requires an exact ${definition.mechanicalRateHz} Hz fixed step`,
        );
    }
    const anchors = source.anchors == null
        ? state.anchors
        : normalizeFabrikRopeAnchors(
            source.anchors,
            definition,
            'rope step anchors',
            { requireAll: false },
        );
    const activeIds = new Set(state.anchors.map(anchor => anchor.id));
    if (anchors.some(anchor => !activeIds.has(anchor.id))) {
        failRopeContract(
            'ROPE_ANCHOR_REACTIVATION',
            `Rope '${definition.id}' cannot reactivate a detached attachment during a live step`,
        );
    }
    return Object.freeze({
        dtSeconds,
        anchors,
        freeLengthMeters: normalizeRopeNumber(
            source.freeLengthMeters ?? state.freeLengthMeters,
            'rope step freeLengthMeters',
            {
                minimum: 0,
                maximum: definition.restLengthMeters,
                exclusiveMinimum: true,
            },
        ),
    });
}

function fallbackDirection(previousPositions, left, right, segmentIndex) {
    const dx = previousPositions[right][0] - previousPositions[left][0];
    const dy = previousPositions[right][1] - previousPositions[left][1];
    const dz = previousPositions[right][2] - previousPositions[left][2];
    const length = Math.hypot(dx, dy, dz);
    if (length > EPSILON) return [dx / length, dy / length, dz / length];
    const axis = segmentIndex % 3;
    const sign = (segmentIndex & 1) === 0 ? 1 : -1;
    return axis === 0 ? [sign, 0, 0] : axis === 1 ? [0, sign, 0] : [0, 0, sign];
}

function stableStringHash(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash;
}

function stablePerpendicular(axis, identity) {
    const absolute = axis.map(Math.abs);
    const basis = absolute[0] <= absolute[1] && absolute[0] <= absolute[2]
        ? [1, 0, 0]
        : absolute[1] <= absolute[2]
            ? [0, 1, 0]
            : [0, 0, 1];
    let perpendicular = [
        axis[1] * basis[2] - axis[2] * basis[1],
        axis[2] * basis[0] - axis[0] * basis[2],
        axis[0] * basis[1] - axis[1] * basis[0],
    ];
    const length = Math.hypot(...perpendicular);
    const sign = (stableStringHash(identity) & 1) === 0 ? 1 : -1;
    perpendicular = perpendicular.map(component => component * sign / length);
    return perpendicular;
}

/**
 * A straight, shortened two-anchor chain gives classic FABRIK no bend plane,
 * so every forward/backward pass repeats the same unsatisfied line. Seed the
 * unique stable-ID-selected circular arc whose every chord is targetLength.
 */
function seedCompressedAnchoredRun({
    definition,
    positions,
    start,
    end,
    targetLength,
    toleranceMeters,
}) {
    const segmentCount = end - start;
    if (segmentCount < 2) return false;
    const first = positions[start];
    const last = positions[end];
    const chord = [last[0] - first[0], last[1] - first[1], last[2] - first[2]];
    const chordLength = Math.hypot(...chord);
    const runLength = targetLength * segmentCount;
    if (!(chordLength < runLength - toleranceMeters)) return false;

    const axis = chordLength > EPSILON
        ? chord.map(component => component / chordLength)
        : fallbackDirection(positions, start, end, start);
    let maximumDeparture = 0;
    for (let pointIndex = start + 1; pointIndex < end; pointIndex += 1) {
        const offset = [
            positions[pointIndex][0] - first[0],
            positions[pointIndex][1] - first[1],
            positions[pointIndex][2] - first[2],
        ];
        const along = offset[0] * axis[0] + offset[1] * axis[1] + offset[2] * axis[2];
        maximumDeparture = Math.max(maximumDeparture, Math.hypot(
            offset[0] - axis[0] * along,
            offset[1] - axis[1] * along,
            offset[2] - axis[2] * along,
        ));
    }
    const degenerateThreshold = Math.max(toleranceMeters * 4, targetLength * 0.005);
    if (maximumDeparture > degenerateThreshold) return false;

    const targetRatio = chordLength / targetLength;
    let low = 0;
    let high = Math.PI / segmentCount;
    for (let iteration = 0; iteration < 80; iteration += 1) {
        const halfStep = (low + high) * 0.5;
        const ratio = Math.sin(segmentCount * halfStep) / Math.sin(halfStep);
        if (ratio > targetRatio) low = halfStep;
        else high = halfStep;
    }
    const halfStep = (low + high) * 0.5;
    const radius = targetLength / (2 * Math.sin(halfStep));
    const halfArcAngle = segmentCount * halfStep;
    const centerOffset = radius * Math.cos(halfArcAngle);
    const midpoint = [
        (first[0] + last[0]) * 0.5,
        (first[1] + last[1]) * 0.5,
        (first[2] + last[2]) * 0.5,
    ];
    const perpendicular = stablePerpendicular(axis, `${definition.id}:${start}:${end}`);
    for (let localIndex = 1; localIndex < segmentCount; localIndex += 1) {
        const angle = -halfArcAngle + localIndex * 2 * halfStep;
        const along = radius * Math.sin(angle);
        const away = radius * Math.cos(angle) - centerOffset;
        positions[start + localIndex] = [
            midpoint[0] + axis[0] * along + perpendicular[0] * away,
            midpoint[1] + axis[1] * along + perpendicular[1] * away,
            midpoint[2] + axis[2] * along + perpendicular[2] * away,
        ];
    }
    return true;
}

function moveToSegmentLength({
    positions,
    previousPositions,
    movingIndex,
    baseIndex,
    segmentIndex,
    targetLength,
    inverseMasses,
    masses,
    complianceAlpha,
    correctionImpulses,
    dtSeconds,
}) {
    const moving = positions[movingIndex];
    const base = positions[baseIndex];
    let dx = moving[0] - base[0];
    let dy = moving[1] - base[1];
    let dz = moving[2] - base[2];
    const distance = Math.hypot(dx, dy, dz);
    if (distance <= EPSILON) {
        const direction = fallbackDirection(previousPositions, Math.min(movingIndex, baseIndex), Math.max(movingIndex, baseIndex), segmentIndex);
        const orientation = movingIndex > baseIndex ? 1 : -1;
        dx = direction[0] * orientation;
        dy = direction[1] * orientation;
        dz = direction[2] * orientation;
    } else {
        dx /= distance;
        dy /= distance;
        dz /= distance;
    }
    const targetX = base[0] + dx * targetLength;
    const targetY = base[1] + dy * targetLength;
    const targetZ = base[2] + dz * targetLength;
    const inverseMass = inverseMasses[movingIndex] > 0
        ? inverseMasses[movingIndex]
        : 1 / masses[movingIndex];
    const response = inverseMass / (inverseMass + complianceAlpha);
    const correctionX = (targetX - moving[0]) * response;
    const correctionY = (targetY - moving[1]) * response;
    const correctionZ = (targetZ - moving[2]) * response;
    moving[0] += correctionX;
    moving[1] += correctionY;
    moving[2] += correctionZ;
    const correctionDistance = Math.hypot(correctionX, correctionY, correctionZ);
    correctionImpulses[segmentIndex] += masses[movingIndex] * correctionDistance / dtSeconds;
}

function projectFreeSegment({
    positions,
    previousPositions,
    left,
    right,
    segmentIndex,
    targetLength,
    inverseMasses,
    complianceAlpha,
    lambdas,
    correctionImpulses,
    dtSeconds,
}) {
    const a = positions[left];
    const b = positions[right];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    let dz = b[2] - a[2];
    const distance = Math.hypot(dx, dy, dz);
    if (distance <= EPSILON) {
        [dx, dy, dz] = fallbackDirection(previousPositions, left, right, segmentIndex);
    } else {
        dx /= distance;
        dy /= distance;
        dz /= distance;
    }
    const constraint = distance - targetLength;
    const leftWeight = inverseMasses[left];
    const rightWeight = inverseMasses[right];
    const denominator = leftWeight + rightWeight + complianceAlpha;
    if (!(denominator > 0)) return;
    const deltaLambda = (-constraint - complianceAlpha * lambdas[segmentIndex]) / denominator;
    lambdas[segmentIndex] += deltaLambda;
    const correctionX = dx * deltaLambda;
    const correctionY = dy * deltaLambda;
    const correctionZ = dz * deltaLambda;
    a[0] -= leftWeight * correctionX;
    a[1] -= leftWeight * correctionY;
    a[2] -= leftWeight * correctionZ;
    b[0] += rightWeight * correctionX;
    b[1] += rightWeight * correctionY;
    b[2] += rightWeight * correctionZ;
    correctionImpulses[segmentIndex] += Math.abs(deltaLambda) / dtSeconds;
}

function activeRuns(segmentCount, brokenIndices) {
    const runs = [];
    let start = 0;
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
        if (!brokenIndices.has(segmentIndex)) continue;
        if (segmentIndex >= start) runs.push([start, segmentIndex]);
        start = segmentIndex + 1;
    }
    if (start <= segmentCount) runs.push([start, segmentCount]);
    return runs.filter(([first, last]) => last > first);
}

function applyBendResponse(positions, fixed, brokenIndices, bendResponse) {
    if (!(bendResponse > 0)) return;
    const source = positions.map(position => [...position]);
    for (let pointIndex = 1; pointIndex + 1 < positions.length; pointIndex += 1) {
        if (fixed[pointIndex] || brokenIndices.has(pointIndex - 1) || brokenIndices.has(pointIndex)) continue;
        const midpoint = [
            (source[pointIndex - 1][0] + source[pointIndex + 1][0]) * 0.5,
            (source[pointIndex - 1][1] + source[pointIndex + 1][1]) * 0.5,
            (source[pointIndex - 1][2] + source[pointIndex + 1][2]) * 0.5,
        ];
        positions[pointIndex][0] += (midpoint[0] - positions[pointIndex][0]) * bendResponse;
        positions[pointIndex][1] += (midpoint[1] - positions[pointIndex][1]) * bendResponse;
        positions[pointIndex][2] += (midpoint[2] - positions[pointIndex][2]) * bendResponse;
    }
}

function constraintErrors(positions, brokenIndices, targetLength) {
    let maximum = 0;
    for (let index = 0; index + 1 < positions.length; index += 1) {
        if (brokenIndices.has(index)) continue;
        const left = positions[index];
        const right = positions[index + 1];
        const error = Math.abs(Math.hypot(
            right[0] - left[0],
            right[1] - left[1],
            right[2] - left[2],
        ) - targetLength);
        maximum = Math.max(maximum, error);
    }
    return maximum;
}

function createBreakReceipt(definition, segmentIndex, tick, topologyOperation, tensionNewtons) {
    const segmentId = definition.segmentIds[segmentIndex];
    return Object.freeze({
        schema: FABRIK_ROPE_BREAK_RECEIPT_SCHEMA,
        schemaVersion: FABRIK_ROPE_BREAK_RECEIPT_VERSION,
        receiptId: expectedReceiptId(definition.id, segmentId, tick, topologyOperation),
        ropeId: definition.id,
        segmentId,
        tick,
        topologyOperation,
        tensionNewtons,
        thresholdNewtons: definition.breaking.thresholdNewtons,
        materialHash: definition.material.hash,
        solverVersion: FABRIK_ROPE_SOLVER_VERSION,
    });
}

function stepNormalized(definition, state, input, collisionProjector) {
    if (!NORMALIZED_STATES.has(state)) {
        failRopeContract('ROPE_STATE_AUTHORITY', 'stepFabrikRope requires a state created by this solver module');
    }
    if (state.ropeId !== definition.id
        || state.materialHash !== definition.material.hash
        || state.solverVersion !== FABRIK_ROPE_SOLVER_VERSION) {
        failRopeContract('ROPE_STATE_MISMATCH', 'Rope state identity, material hash, or solver version is stale');
    }
    const normalizedInput = normalizeStepInput(input, definition, state);
    const dtSeconds = normalizedInput.dtSeconds;
    const pointCount = definition.segmentCount + 1;
    const targetLength = normalizedInput.freeLengthMeters / definition.segmentCount;
    const positions = state.positions.map(position => [...position]);
    const previousPositions = state.previousPositions.map(position => [...position]);
    const anchorByPoint = new Map(normalizedInput.anchors.map(anchor => [anchor.pointIndex, anchor]));
    const fixed = new Array(pointCount).fill(false);
    for (const pointIndex of anchorByPoint.keys()) fixed[pointIndex] = true;
    const brokenIndices = new Set(state.brokenSegmentIds.map(id => definition.segmentIds.indexOf(id)));

    const segmentMass = definition.material.linearDensityKilogramsPerMeter * targetLength;
    const masses = new Array(pointCount).fill(segmentMass);
    masses[0] = segmentMass * 0.5;
    masses[pointCount - 1] = segmentMass * 0.5;
    const inverseMasses = masses.map((mass, index) => fixed[index] ? 0 : 1 / mass);
    const dampingFactor = 1 / (1 + definition.dampingPerSecond * dtSeconds);
    const acceleration = definition.gravityMetersPerSecondSquared;
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
        const anchor = anchorByPoint.get(pointIndex);
        if (anchor) {
            const previousAnchor = state.anchors.find(entry => entry.id === anchor.id);
            positions[pointIndex] = [...anchor.position];
            previousPositions[pointIndex] = previousAnchor ? [...previousAnchor.position] : [...anchor.position];
            continue;
        }
        const current = positions[pointIndex];
        const prior = previousPositions[pointIndex];
        const next = [
            current[0] + (current[0] - prior[0]) * dampingFactor + acceleration[0] * dtSeconds * dtSeconds,
            current[1] + (current[1] - prior[1]) * dampingFactor + acceleration[1] * dtSeconds * dtSeconds,
            current[2] + (current[2] - prior[2]) * dampingFactor + acceleration[2] * dtSeconds * dtSeconds,
        ];
        previousPositions[pointIndex] = [...current];
        positions[pointIndex] = next;
    }

    applyBendResponse(positions, fixed, brokenIndices, definition.bendResponse);
    const runs = activeRuns(definition.segmentCount, brokenIndices);
    for (const [start, end] of runs) {
        if (fixed[start] && fixed[end]) {
            seedCompressedAnchoredRun({
                definition,
                positions,
                start,
                end,
                targetLength,
                toleranceMeters: definition.toleranceMeters,
            });
        }
    }
    const lambdas = new Array(definition.segmentCount).fill(0);
    const correctionImpulses = new Array(definition.segmentCount).fill(0);
    const complianceAlpha = definition.stretchComplianceMetersPerNewton / (dtSeconds * dtSeconds);
    let collisionContacts = 0;
    let maximumCollisionPenetrationMeters = 0;
    let iterationsUsed = 0;
    const acceptedError = Math.max(definition.toleranceMeters, targetLength * 0.001);

    for (let iteration = 0; iteration < definition.solverIterations; iteration += 1) {
        for (const [start, end] of runs) {
            const startFixed = fixed[start];
            const endFixed = fixed[end];
            if (startFixed && endFixed) {
                positions[end] = [...anchorByPoint.get(end).position];
                for (let pointIndex = end - 1; pointIndex >= start; pointIndex -= 1) {
                    moveToSegmentLength({
                        positions,
                        previousPositions,
                        movingIndex: pointIndex,
                        baseIndex: pointIndex + 1,
                        segmentIndex: pointIndex,
                        targetLength,
                        inverseMasses,
                        masses,
                        complianceAlpha,
                        correctionImpulses,
                        dtSeconds,
                    });
                }
                positions[start] = [...anchorByPoint.get(start).position];
                for (let pointIndex = start + 1; pointIndex <= end; pointIndex += 1) {
                    moveToSegmentLength({
                        positions,
                        previousPositions,
                        movingIndex: pointIndex,
                        baseIndex: pointIndex - 1,
                        segmentIndex: pointIndex - 1,
                        targetLength,
                        inverseMasses,
                        masses,
                        complianceAlpha,
                        correctionImpulses,
                        dtSeconds,
                    });
                }
            } else if (startFixed) {
                positions[start] = [...anchorByPoint.get(start).position];
                for (let pointIndex = start + 1; pointIndex <= end; pointIndex += 1) {
                    moveToSegmentLength({
                        positions,
                        previousPositions,
                        movingIndex: pointIndex,
                        baseIndex: pointIndex - 1,
                        segmentIndex: pointIndex - 1,
                        targetLength,
                        inverseMasses,
                        masses,
                        complianceAlpha,
                        correctionImpulses,
                        dtSeconds,
                    });
                }
            } else if (endFixed) {
                positions[end] = [...anchorByPoint.get(end).position];
                for (let pointIndex = end - 1; pointIndex >= start; pointIndex -= 1) {
                    moveToSegmentLength({
                        positions,
                        previousPositions,
                        movingIndex: pointIndex,
                        baseIndex: pointIndex + 1,
                        segmentIndex: pointIndex,
                        targetLength,
                        inverseMasses,
                        masses,
                        complianceAlpha,
                        correctionImpulses,
                        dtSeconds,
                    });
                }
            } else {
                const forward = (iteration & 1) === 0;
                if (forward) {
                    for (let segmentIndex = start; segmentIndex < end; segmentIndex += 1) {
                        projectFreeSegment({
                            positions,
                            previousPositions,
                            left: segmentIndex,
                            right: segmentIndex + 1,
                            segmentIndex,
                            targetLength,
                            inverseMasses,
                            complianceAlpha,
                            lambdas,
                            correctionImpulses,
                            dtSeconds,
                        });
                    }
                } else {
                    for (let segmentIndex = end - 1; segmentIndex >= start; segmentIndex -= 1) {
                        projectFreeSegment({
                            positions,
                            previousPositions,
                            left: segmentIndex,
                            right: segmentIndex + 1,
                            segmentIndex,
                            targetLength,
                            inverseMasses,
                            complianceAlpha,
                            lambdas,
                            correctionImpulses,
                            dtSeconds,
                        });
                    }
                }
            }
        }

        if (collisionProjector) {
            for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
                if (fixed[pointIndex]) continue;
                const contacts = collisionProjector.projectInPlace(positions[pointIndex], previousPositions[pointIndex]);
                collisionContacts += contacts.length;
                for (const contact of contacts) {
                    maximumCollisionPenetrationMeters = Math.max(
                        maximumCollisionPenetrationMeters,
                        contact.penetrationMeters,
                    );
                }
            }
        }
        for (const anchor of normalizedInput.anchors) positions[anchor.pointIndex] = [...anchor.position];
        iterationsUsed = iteration + 1;
        if (constraintErrors(positions, brokenIndices, targetLength) <= acceptedError) break;
    }

    const velocities = positions.map((position, index) => {
        finiteVectorInPlace(position, `rope candidate positions[${index}]`);
        finiteVectorInPlace(previousPositions[index], `rope candidate previousPositions[${index}]`);
        return [
            (position[0] - previousPositions[index][0]) / dtSeconds,
            (position[1] - previousPositions[index][1]) / dtSeconds,
            (position[2] - previousPositions[index][2]) / dtSeconds,
        ];
    });
    const tensions = correctionImpulses.map((impulse, segmentIndex) => {
        if (brokenIndices.has(segmentIndex)) return 0;
        const tension = impulse / dtSeconds;
        if (!Number.isFinite(tension) || tension > FABRIK_ROPE_LIMITS.maximumForceNewtons) {
            failRopeContract('ROPE_TENSION_RANGE', `Segment '${definition.segmentIds[segmentIndex]}' tension is out of range`);
        }
        return tension;
    });

    const nextTick = state.tick + 1;
    const breakCounters = [...state.breakCounters];
    const newlyBroken = [];
    let topologyOperations = state.topologyOperations;
    if (definition.breaking.enabled) {
        for (let segmentIndex = 0; segmentIndex < definition.segmentCount; segmentIndex += 1) {
            if (brokenIndices.has(segmentIndex)) {
                breakCounters[segmentIndex] = 0;
                continue;
            }
            breakCounters[segmentIndex] = tensions[segmentIndex] >= definition.breaking.thresholdNewtons
                ? Math.min(definition.breaking.consecutiveTicks, breakCounters[segmentIndex] + 1)
                : 0;
            if (breakCounters[segmentIndex] < definition.breaking.consecutiveTicks
                || topologyOperations >= definition.maximumTopologyOperations) continue;
            topologyOperations += 1;
            brokenIndices.add(segmentIndex);
            breakCounters[segmentIndex] = 0;
            newlyBroken.push(createBreakReceipt(
                definition,
                segmentIndex,
                nextTick,
                topologyOperations,
                tensions[segmentIndex],
            ));
        }
    }
    const brokenSegmentIds = Object.freeze(definition.segmentIds.filter((_, index) => brokenIndices.has(index)));
    const breakReceipts = Object.freeze([...state.breakReceipts, ...newlyBroken]);

    let maxConstraintErrorMeters = 0;
    let maxRelativeConstraintError = 0;
    let maxStretchMeters = 0;
    let maxCompressionMeters = 0;
    let tensionSum = 0;
    let activeTensionCount = 0;
    const overTensileSegmentIds = [];
    for (let segmentIndex = 0; segmentIndex < definition.segmentCount; segmentIndex += 1) {
        if (brokenIndices.has(segmentIndex)) continue;
        const left = positions[segmentIndex];
        const right = positions[segmentIndex + 1];
        const signedError = Math.hypot(
            right[0] - left[0],
            right[1] - left[1],
            right[2] - left[2],
        ) - targetLength;
        maxConstraintErrorMeters = Math.max(maxConstraintErrorMeters, Math.abs(signedError));
        maxRelativeConstraintError = Math.max(maxRelativeConstraintError, Math.abs(signedError) / targetLength);
        maxStretchMeters = Math.max(maxStretchMeters, signedError);
        maxCompressionMeters = Math.max(maxCompressionMeters, -signedError);
        tensionSum += tensions[segmentIndex];
        activeTensionCount += 1;
        if (tensions[segmentIndex] >= definition.material.tensileLimitNewtons) {
            overTensileSegmentIds.push(definition.segmentIds[segmentIndex]);
        }
    }
    const maxTensionNewtons = tensions.reduce((maximum, value) => Math.max(maximum, value), 0);
    const telemetry = freezeRopeValue({
        schema: FABRIK_ROPE_TELEMETRY_SCHEMA,
        schemaVersion: FABRIK_ROPE_TELEMETRY_VERSION,
        ropeId: definition.id,
        tick: nextTick,
        segmentCount: definition.segmentCount,
        activeSegmentCount: definition.segmentCount - brokenSegmentIds.length,
        brokenSegmentIds: [...brokenSegmentIds],
        activeAttachmentIds: normalizedInput.anchors.map(anchor => anchor.id),
        freeLengthMeters: normalizedInput.freeLengthMeters,
        targetSegmentLengthMeters: targetLength,
        maxConstraintErrorMeters,
        maxRelativeConstraintError,
        maxStretchMeters,
        maxCompressionMeters,
        maxTensionNewtons,
        meanTensionNewtons: activeTensionCount > 0 ? tensionSum / activeTensionCount : 0,
        overTensileSegmentIds,
        solverIterations: iterationsUsed,
        converged: maxConstraintErrorMeters <= acceptedError,
        toleranceMeters: acceptedError,
        collisionContacts,
        maximumCollisionPenetrationMeters,
        topologyOperations,
        breakReceipts: newlyBroken,
    });
    const nextState = Object.freeze({
        schema: FABRIK_ROPE_STATE_SCHEMA,
        schemaVersion: FABRIK_ROPE_STATE_VERSION,
        solverVersion: FABRIK_ROPE_SOLVER_VERSION,
        ropeId: definition.id,
        materialHash: definition.material.hash,
        tick: nextTick,
        positions: frozenPositions(positions),
        previousPositions: frozenPositions(previousPositions),
        velocities: frozenPositions(velocities),
        anchors: normalizedInput.anchors,
        freeLengthMeters: normalizedInput.freeLengthMeters,
        brokenSegmentIds,
        breakCounters: Object.freeze(breakCounters),
        topologyOperations,
        breakReceipts,
        telemetry,
    });
    NORMALIZED_STATES.add(nextState);
    return nextState;
}

export class FabrikRopeSolver {
    constructor(definitionInput, { colliderSet = EMPTY_ROPE_COLLIDER_SET } = {}) {
        this.definition = assertLiveFabrikRopeDefinition(definitionInput);
        const compiledColliders = compileRopeColliderSet(colliderSet);
        this.colliderSet = this.definition.collision.enabled
            ? selectRopeColliderSet(compiledColliders, this.definition.collision.colliderIds)
            : EMPTY_ROPE_COLLIDER_SET;
        this._collisionProjector = this.definition.collision.enabled
            ? createRopeCollisionProjector(this.colliderSet, {
                radiusMeters: this.definition.radiusMeters,
                contactOffsetMeters: this.definition.collision.contactOffsetMeters,
                dynamicFriction: this.definition.material.dynamicFriction,
            })
            : null;
        this._disposed = false;
    }

    get disposed() { return this._disposed; }

    _assertLive() {
        if (this._disposed) failRopeContract('ROPE_SOLVER_DISPOSED', `Rope solver '${this.definition.id}' is disposed`);
    }

    createState(options) {
        this._assertLive();
        return createFabrikRopeState(this.definition, options);
    }

    /** Snapshot restoration may contain a deterministic nonempty active subset. */
    createStateFromSnapshot(options) {
        this._assertLive();
        return createFabrikRopeStateCandidate(
            this.definition,
            options,
            { requireAllAttachments: false },
        );
    }

    step(state, input = {}) {
        this._assertLive();
        return stepNormalized(this.definition, state, input, this._collisionProjector);
    }

    dispose() {
        if (this._disposed) return false;
        this._collisionProjector = null;
        this._disposed = true;
        return true;
    }
}

export function createFabrikRopeSolver(definition, options) {
    return new FabrikRopeSolver(definition, options);
}

/** Pure convenience step; callers retaining state should prefer one solver instance. */
export function stepFabrikRope(definitionInput, state, input = {}, { colliderSet = EMPTY_ROPE_COLLIDER_SET } = {}) {
    const solver = new FabrikRopeSolver(definitionInput, { colliderSet });
    try {
        return solver.step(state, input);
    } finally {
        solver.dispose();
    }
}
