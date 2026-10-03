// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
    FABRIK_ROPE_LIMITS,
    normalizeRopeNumber,
    normalizeRopeStableId,
    readRopeRecord,
} from './RopeContracts.js';

export const ROPE_SPOOL_DEFINITION_SCHEMA = 'engine.rope.spool-definition';
export const ROPE_SPOOL_DEFINITION_VERSION = '1.0.0';
export const ROPE_SPOOL_WINDING_DIRECTIONS = Object.freeze(['positive', 'negative']);

const SPOOL_KEYS = new Set([
    'schema', 'schemaVersion', 'id', 'ropeId', 'axisId', 'radiusMeters',
    'windingDirection', 'referenceAngleRadians', 'referenceFreeLengthMeters',
    'minimumFreeLengthMeters', 'maximumFreeLengthMeters', 'windingSign',
]);
const WINDING_DIRECTIONS = new Set(ROPE_SPOOL_WINDING_DIRECTIONS);
const NORMALIZED_SPOOLS = new WeakSet();

export function normalizeRopeSpoolDefinition(raw) {
    if (NORMALIZED_SPOOLS.has(raw)) return raw;
    const source = readRopeRecord(raw, 'rope spool', SPOOL_KEYS);
    if (source.schema !== ROPE_SPOOL_DEFINITION_SCHEMA) {
        throw new TypeError(`rope spool schema must be '${ROPE_SPOOL_DEFINITION_SCHEMA}'`);
    }
    if (source.schemaVersion !== ROPE_SPOOL_DEFINITION_VERSION) {
        throw new TypeError(`rope spool schemaVersion must be '${ROPE_SPOOL_DEFINITION_VERSION}'`);
    }
    const id = normalizeRopeStableId(source.id, 'rope spool id');
    const ropeId = normalizeRopeStableId(source.ropeId, 'rope spool ropeId');
    const axisId = normalizeRopeStableId(source.axisId, 'rope spool axisId');
    const radiusMeters = normalizeRopeNumber(source.radiusMeters, 'rope spool radiusMeters', {
        minimum: 0,
        maximum: FABRIK_ROPE_LIMITS.maximumRadiusMeters,
        exclusiveMinimum: true,
    });
    const windingDirection = source.windingDirection ?? 'positive';
    if (!WINDING_DIRECTIONS.has(windingDirection)) {
        throw new TypeError("rope spool windingDirection must be 'positive' or 'negative'");
    }
    const windingSign = windingDirection === 'positive' ? 1 : -1;
    if (source.windingSign != null && source.windingSign !== windingSign) {
        throw new TypeError('rope spool windingSign does not match windingDirection');
    }
    const referenceAngleRadians = normalizeRopeNumber(
        source.referenceAngleRadians ?? 0,
        'rope spool referenceAngleRadians',
        { minimum: -1e12, maximum: 1e12 },
    );
    const minimumFreeLengthMeters = normalizeRopeNumber(
        source.minimumFreeLengthMeters,
        'rope spool minimumFreeLengthMeters',
        {
            minimum: 0,
            maximum: FABRIK_ROPE_LIMITS.maximumLengthMeters,
            exclusiveMinimum: true,
        },
    );
    const maximumFreeLengthMeters = normalizeRopeNumber(
        source.maximumFreeLengthMeters,
        'rope spool maximumFreeLengthMeters',
        {
            minimum: minimumFreeLengthMeters,
            maximum: FABRIK_ROPE_LIMITS.maximumLengthMeters,
        },
    );
    if (!(maximumFreeLengthMeters > minimumFreeLengthMeters)) {
        throw new RangeError('rope spool maximumFreeLengthMeters must exceed minimumFreeLengthMeters');
    }
    const referenceFreeLengthMeters = normalizeRopeNumber(
        source.referenceFreeLengthMeters,
        'rope spool referenceFreeLengthMeters',
        { minimum: minimumFreeLengthMeters, maximum: maximumFreeLengthMeters },
    );
    const normalized = Object.freeze({
        schema: ROPE_SPOOL_DEFINITION_SCHEMA,
        schemaVersion: ROPE_SPOOL_DEFINITION_VERSION,
        id,
        ropeId,
        axisId,
        radiusMeters,
        windingDirection,
        windingSign,
        referenceAngleRadians,
        referenceFreeLengthMeters,
        minimumFreeLengthMeters,
        maximumFreeLengthMeters,
    });
    NORMALIZED_SPOOLS.add(normalized);
    return normalized;
}

/** Convert absolute spool angle into explicit bounded free-rope geometry. */
export function ropeFreeLengthFromSpool(spoolInput, angleRadians) {
    const spool = normalizeRopeSpoolDefinition(spoolInput);
    const angle = normalizeRopeNumber(angleRadians, 'rope spool angleRadians', {
        minimum: -1e12,
        maximum: 1e12,
    });
    const deltaAngleRadians = angle - spool.referenceAngleRadians;
    const woundLengthMeters = spool.windingSign * deltaAngleRadians * spool.radiusMeters;
    const unboundedFreeLengthMeters = spool.referenceFreeLengthMeters - woundLengthMeters;
    const freeLengthMeters = Math.max(
        spool.minimumFreeLengthMeters,
        Math.min(spool.maximumFreeLengthMeters, unboundedFreeLengthMeters),
    );
    return Object.freeze({
        spoolId: spool.id,
        ropeId: spool.ropeId,
        axisId: spool.axisId,
        angleRadians: angle,
        deltaAngleRadians,
        woundLengthMeters,
        unboundedFreeLengthMeters,
        freeLengthMeters,
        clamped: freeLengthMeters !== unboundedFreeLengthMeters,
        atMinimum: freeLengthMeters === spool.minimumFreeLengthMeters,
        atMaximum: freeLengthMeters === spool.maximumFreeLengthMeters,
    });
}

/** Convert free-rope length back into the matching absolute spool angle. */
export function spoolAngleFromRopeFreeLength(spoolInput, freeLengthMeters) {
    const spool = normalizeRopeSpoolDefinition(spoolInput);
    const freeLength = normalizeRopeNumber(freeLengthMeters, 'rope spool freeLengthMeters', {
        minimum: spool.minimumFreeLengthMeters,
        maximum: spool.maximumFreeLengthMeters,
    });
    const woundLengthMeters = spool.referenceFreeLengthMeters - freeLength;
    return spool.referenceAngleRadians
        + woundLengthMeters / (spool.windingSign * spool.radiusMeters);
}

/** Map constraint tension into the signed external shaft load opposing winding. */
export function ropeShaftLoadFromTension(spoolInput, tensionNewtons) {
    const spool = normalizeRopeSpoolDefinition(spoolInput);
    const tension = normalizeRopeNumber(tensionNewtons, 'rope spool tensionNewtons', {
        minimum: 0,
        maximum: FABRIK_ROPE_LIMITS.maximumForceNewtons,
    });
    const magnitudeNewtonMeters = tension * spool.radiusMeters;
    if (!Number.isFinite(magnitudeNewtonMeters) || magnitudeNewtonMeters > FABRIK_ROPE_LIMITS.maximumForceNewtons) {
        throw new RangeError('rope spool shaft load torque is out of range');
    }
    return Object.freeze({
        spoolId: spool.id,
        ropeId: spool.ropeId,
        axisId: spool.axisId,
        tensionNewtons: tension,
        radiusMeters: spool.radiusMeters,
        magnitudeNewtonMeters,
        signedLoadTorqueNewtonMeters: -spool.windingSign * magnitudeNewtonMeters,
    });
}
