// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Versioned contracts shared by the adaptive SPH and sparse-grid references. */

import {
    cloneAndFreezeStrictJson,
    cloneStrictJson,
    isPlainJsonObject,
} from '../../core/schema/StrictJsonValue.js';
import { validateMatterPacketHandle } from '../codec/MatterPacketContracts.js';

export const ADAPTIVE_FLUID_PACKET_SCHEMA = 'engine.matter.adaptive-fluid-packet';
export const ADAPTIVE_FLUID_PACKET_VERSION = '1.0.0';
export const ADAPTIVE_FLUID_SECONDARY_SCHEMA = 'engine.matter.adaptive-fluid-secondary';
export const ADAPTIVE_FLUID_SECONDARY_VERSION = '1.0.0';
export const ADAPTIVE_FLUID_ANALYSIS_SCHEMA = 'engine.matter.adaptive-fluid-analysis';
export const ADAPTIVE_FLUID_ANALYSIS_VERSION = '1.0.0';

export const ADAPTIVE_FLUID_MODES = Object.freeze([
    'uniform-reference',
    'adaptive-sph',
    'particle-grid',
]);

export const ADAPTIVE_FLUID_SECONDARY_MODES = Object.freeze([
    'canonical-physical',
    'render-only',
]);

export const ADAPTIVE_FLUID_CLASSIFICATIONS = Object.freeze([
    'bulk',
    'near-surface',
    'surface',
    'spray',
    'droplet',
    'bubble',
    'boundary-contact',
]);

/** Numerically closed radius interval for the CPU SPH kernel powers. */
export const ADAPTIVE_FLUID_SMOOTHING_RADIUS_BOUNDS_M = Object.freeze({
    minimum: 1e-6,
    maximum: 1e6,
});

/** Bounded positive density interval accepted by adaptive fluid packets. */
export const ADAPTIVE_FLUID_REST_DENSITY_BOUNDS_KG_M3 = Object.freeze({
    minimum: 1e-6,
    maximum: 1e12,
});

/** Secondary packet kinds with explicit behavior in the adaptive SPH classifier. */
export const ADAPTIVE_FLUID_SECONDARY_KINDS = Object.freeze([
    'spray',
    'droplet',
    'bubble',
    'foam',
]);

export const ADAPTIVE_FLUID_MAX_COMPOSITION_COMPONENTS = 64;
export const ADAPTIVE_FLUID_COMPOSITION_SUM_TOLERANCE = 1e-9;

export const ADAPTIVE_FLUID_ERROR_CODES = Object.freeze({
    CAPACITY_EXHAUSTED: 'ADAPTIVE_FLUID_CAPACITY_EXHAUSTED',
    CONSERVATION_FAILURE: 'ADAPTIVE_FLUID_CONSERVATION_FAILURE',
    DESTROYED: 'ADAPTIVE_FLUID_DESTROYED',
    INVALID_INPUT: 'ADAPTIVE_FLUID_INVALID_INPUT',
    REVISION_CONFLICT: 'ADAPTIVE_FLUID_REVISION_CONFLICT',
    STALE_PROJECTION: 'ADAPTIVE_FLUID_STALE_PROJECTION',
    TRANSACTION_FAILED: 'ADAPTIVE_FLUID_TRANSACTION_FAILED',
});

export const ADAPTIVE_FLUID_QUALITY_PROFILES = Object.freeze({
    auto: Object.freeze({
        name: 'auto', maxResolutionLevel: 2, targetNeighborRange: Object.freeze([16, 34]),
        refineThreshold: 0.64, mergeThreshold: 0.22, mergeResidencySeconds: 0.9,
        transitionShellWidth: 1.5, pressureIterations: 8, surfaceTileResolution: 12,
        physicalSecondaryMatter: true,
    }),
    performance: Object.freeze({
        name: 'performance', maxResolutionLevel: 1, targetNeighborRange: Object.freeze([12, 28]),
        refineThreshold: 0.3, mergeThreshold: 0.16, mergeResidencySeconds: 1.4,
        transitionShellWidth: 1.25, pressureIterations: 4, surfaceTileResolution: 8,
        physicalSecondaryMatter: false,
    }),
    balanced: Object.freeze({
        name: 'balanced', maxResolutionLevel: 2, targetNeighborRange: Object.freeze([16, 34]),
        refineThreshold: 0.62, mergeThreshold: 0.2, mergeResidencySeconds: 0.9,
        transitionShellWidth: 1.5, pressureIterations: 8, surfaceTileResolution: 12,
        physicalSecondaryMatter: true,
    }),
    quality: Object.freeze({
        name: 'quality', maxResolutionLevel: 3, targetNeighborRange: Object.freeze([20, 42]),
        refineThreshold: 0.48, mergeThreshold: 0.14, mergeResidencySeconds: 1.2,
        transitionShellWidth: 1.75, pressureIterations: 12, surfaceTileResolution: 16,
        physicalSecondaryMatter: true,
    }),
    scientific: Object.freeze({
        name: 'scientific', maxResolutionLevel: 4, targetNeighborRange: Object.freeze([24, 52]),
        refineThreshold: 0.36, mergeThreshold: 0.09, mergeResidencySeconds: 1.6,
        transitionShellWidth: 2, pressureIterations: 20, surfaceTileResolution: 24,
        physicalSecondaryMatter: true,
    }),
});

const PACKET_KEYS = new Set([
    'schema', 'schemaVersion', 'id', 'handle', 'regionId', 'definitionId', 'phase',
    'componentId', 'sourceRevision', 'representationRevision', 'positionM',
    'velocityMPerS', 'massKg', 'representedVolumeM3', 'smoothingRadiusM',
    'resolutionLevel', 'targetNeighborRange', 'restDensityKgM3', 'temperatureK',
    'composition', 'gasFraction', 'secondaryKind', 'secondaryMode',
    'canonicalMassOwner', 'boundaryDistanceM', 'predictedImpactSeconds',
    'inspectionWeight',
]);
const SECONDARY_KEYS = new Set([
    'schema', 'schemaVersion', 'canonicalMassOwner',
    'id', 'positionM', 'velocityMPerS', 'representedVolumeM3', 'massKg', 'kind',
    'mode', 'sourcePacketId', 'sourceRevision', 'definitionId', 'phase',
]);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;

export class AdaptiveFluidError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'AdaptiveFluidError';
        this.code = code;
        this.details = cloneAndFreezeStrictJson(details, '$.adaptiveFluidError.details');
    }
}

export function fluidExactObject(value, keys, path) {
    if (!isPlainJsonObject(value)) throw new TypeError(`${path}: must be a plain object`);
    for (const key of Object.keys(value)) {
        if (!keys.has(key)) throw new TypeError(`${path}.${key}: unknown field`);
    }
    return value;
}

export function fluidFinite(value, path, { minimum = -Infinity, maximum = Infinity } = {}) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
        throw new RangeError(`${path}: must be finite and within [${minimum}, ${maximum}]`);
    }
    return value;
}

export function fluidInteger(value, path, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
    fluidFinite(value, path, { minimum, maximum });
    if (!Number.isSafeInteger(value)) throw new RangeError(`${path}: must be a safe integer`);
    return value;
}

export function fluidIdentifier(value, path) {
    if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
        throw new TypeError(`${path}: has invalid identifier syntax`);
    }
    return value;
}

function fluidNullableCodecHandle(value, path) {
    if (value === null) return null;
    validateMatterPacketHandle(value, path);
    return value;
}

function fluidComposition(value, path) {
    if (!isPlainJsonObject(value)) throw new TypeError(`${path}: must be a plain composition object`);
    const entries = Object.entries(value);
    if (entries.length < 1 || entries.length > ADAPTIVE_FLUID_MAX_COMPOSITION_COMPONENTS) {
        throw new RangeError(
            `${path}: must contain between 1 and ${ADAPTIVE_FLUID_MAX_COMPOSITION_COMPONENTS} components`,
        );
    }
    let total = 0;
    for (const [componentId, fraction] of entries) {
        fluidIdentifier(componentId, `${path} component key`);
        total += fluidFinite(fraction, `${path}.${componentId}`, { minimum: 0, maximum: 1 });
    }
    if (Math.abs(total - 1) > ADAPTIVE_FLUID_COMPOSITION_SUM_TOLERANCE) {
        throw new RangeError(`${path}: component fractions must sum to 1`);
    }
    return value;
}

function fluidNullableSecondaryKind(value, path) {
    if (value === null) return null;
    if (typeof value !== 'string' || !ADAPTIVE_FLUID_SECONDARY_KINDS.includes(value)) {
        throw new RangeError(`${path}: unsupported secondary kind`);
    }
    return value;
}

export function fluidVector3(value, path) {
    if (!Array.isArray(value) || value.length !== 3) {
        throw new TypeError(`${path}: must contain exactly three values`);
    }
    return value.map((entry, axis) => fluidFinite(entry, `${path}[${axis}]`));
}

export function fluidClone(value, path = '$') {
    return cloneStrictJson(value, path);
}

export function fluidFreeze(value, path = '$') {
    return cloneAndFreezeStrictJson(value, path);
}

export function resolveAdaptiveFluidQualityProfile(profile) {
    let name = profile;
    if (typeof profile !== 'string') {
        if (!isPlainJsonObject(profile)) {
            throw new TypeError('$.qualityProfile: must be a profile name or plain profile object');
        }
        const candidate = cloneStrictJson(profile, '$.qualityProfile');
        if (!Object.hasOwn(candidate, 'name') || typeof candidate.name !== 'string') {
            throw new TypeError('$.qualityProfile.name: must be an own string field');
        }
        name = candidate.name;
    }
    if (!Object.hasOwn(ADAPTIVE_FLUID_QUALITY_PROFILES, name)) {
        throw new RangeError(`$.qualityProfile: unsupported quality profile '${name}'`);
    }
    const resolved = ADAPTIVE_FLUID_QUALITY_PROFILES[name];
    return resolved;
}

export function validateAdaptiveFluidMode(mode) {
    if (!ADAPTIVE_FLUID_MODES.includes(mode)) {
        throw new RangeError(`$.mode: unsupported adaptive fluid mode '${mode}'`);
    }
    return mode;
}

export function createAdaptiveFluidPacket(input) {
    const source = fluidClone(input, '$.adaptiveFluidPacket');
    fluidExactObject(source, PACKET_KEYS, '$.adaptiveFluidPacket');
    if (source.schema != null && source.schema !== ADAPTIVE_FLUID_PACKET_SCHEMA) {
        throw new TypeError('$.adaptiveFluidPacket.schema: unsupported schema');
    }
    if (source.schemaVersion != null && source.schemaVersion !== ADAPTIVE_FLUID_PACKET_VERSION) {
        throw new TypeError('$.adaptiveFluidPacket.schemaVersion: unsupported version');
    }
    const id = fluidIdentifier(source.id, '$.adaptiveFluidPacket.id');
    const regionId = fluidIdentifier(source.regionId ?? `region.${id}`, '$.adaptiveFluidPacket.regionId');
    const definitionId = fluidIdentifier(
        source.definitionId ?? 'matter.definition.water',
        '$.adaptiveFluidPacket.definitionId',
    );
    const phase = fluidIdentifier(source.phase ?? 'liquid', '$.adaptiveFluidPacket.phase');
    const componentId = fluidIdentifier(
        source.componentId ?? `component.${regionId}`,
        '$.adaptiveFluidPacket.componentId',
    );
    const massKg = fluidFinite(source.massKg, '$.adaptiveFluidPacket.massKg', { minimum: 0 });
    const representedVolumeM3 = fluidFinite(
        source.representedVolumeM3,
        '$.adaptiveFluidPacket.representedVolumeM3',
        { minimum: Number.MIN_VALUE },
    );
    const canonicalMassOwner = source.canonicalMassOwner ?? true;
    if (typeof canonicalMassOwner !== 'boolean') {
        throw new TypeError('$.adaptiveFluidPacket.canonicalMassOwner: must be boolean');
    }
    if (canonicalMassOwner && massKg <= 0) {
        throw new RangeError('$.adaptiveFluidPacket.massKg: canonical packets require positive mass');
    }
    if (!canonicalMassOwner && massKg !== 0) {
        throw new RangeError('$.adaptiveFluidPacket.massKg: projections and render-only samples must have zero mass');
    }
    const targetNeighborRange = source.targetNeighborRange ?? [16, 34];
    if (!Array.isArray(targetNeighborRange) || targetNeighborRange.length !== 2) {
        throw new TypeError('$.adaptiveFluidPacket.targetNeighborRange: must contain two integers');
    }
    const targetMinimum = fluidInteger(targetNeighborRange[0], '$.adaptiveFluidPacket.targetNeighborRange[0]', {
        minimum: 1, maximum: 4096,
    });
    const targetMaximum = fluidInteger(targetNeighborRange[1], '$.adaptiveFluidPacket.targetNeighborRange[1]', {
        minimum: targetMinimum, maximum: 4096,
    });
    const secondaryMode = source.secondaryMode ?? 'canonical-physical';
    if (!ADAPTIVE_FLUID_SECONDARY_MODES.includes(secondaryMode)) {
        throw new RangeError('$.adaptiveFluidPacket.secondaryMode: unsupported mode');
    }
    if (secondaryMode === 'render-only' && canonicalMassOwner) {
        throw new RangeError('$.adaptiveFluidPacket: render-only packets cannot own canonical mass');
    }
    return fluidFreeze({
        schema: ADAPTIVE_FLUID_PACKET_SCHEMA,
        schemaVersion: ADAPTIVE_FLUID_PACKET_VERSION,
        id,
        handle: fluidNullableCodecHandle(source.handle ?? null, '$.adaptiveFluidPacket.handle'),
        regionId,
        definitionId,
        phase,
        componentId,
        sourceRevision: fluidInteger(source.sourceRevision ?? 0, '$.adaptiveFluidPacket.sourceRevision'),
        representationRevision: fluidInteger(
            source.representationRevision ?? 0,
            '$.adaptiveFluidPacket.representationRevision',
        ),
        positionM: fluidVector3(source.positionM, '$.adaptiveFluidPacket.positionM'),
        velocityMPerS: fluidVector3(source.velocityMPerS, '$.adaptiveFluidPacket.velocityMPerS'),
        massKg,
        representedVolumeM3,
        smoothingRadiusM: fluidFinite(
            source.smoothingRadiusM,
            '$.adaptiveFluidPacket.smoothingRadiusM',
            ADAPTIVE_FLUID_SMOOTHING_RADIUS_BOUNDS_M,
        ),
        resolutionLevel: fluidInteger(
            source.resolutionLevel ?? 0,
            '$.adaptiveFluidPacket.resolutionLevel',
            { maximum: 31 },
        ),
        targetNeighborRange: [targetMinimum, targetMaximum],
        restDensityKgM3: fluidFinite(
            source.restDensityKgM3 ?? massKg / representedVolumeM3,
            '$.adaptiveFluidPacket.restDensityKgM3',
            ADAPTIVE_FLUID_REST_DENSITY_BOUNDS_KG_M3,
        ),
        temperatureK: fluidFinite(source.temperatureK ?? 293.15, '$.adaptiveFluidPacket.temperatureK', {
            minimum: 0,
        }),
        composition: fluidComposition(
            source.composition ?? { [definitionId]: 1 },
            '$.adaptiveFluidPacket.composition',
        ),
        gasFraction: fluidFinite(source.gasFraction ?? 0, '$.adaptiveFluidPacket.gasFraction', {
            minimum: 0, maximum: 1,
        }),
        secondaryKind: fluidNullableSecondaryKind(
            source.secondaryKind ?? null,
            '$.adaptiveFluidPacket.secondaryKind',
        ),
        secondaryMode,
        canonicalMassOwner,
        boundaryDistanceM: fluidFinite(
            source.boundaryDistanceM ?? Number.MAX_VALUE,
            '$.adaptiveFluidPacket.boundaryDistanceM',
            { minimum: 0 },
        ),
        predictedImpactSeconds: fluidFinite(
            source.predictedImpactSeconds ?? Number.MAX_VALUE,
            '$.adaptiveFluidPacket.predictedImpactSeconds',
            { minimum: 0 },
        ),
        inspectionWeight: fluidFinite(
            source.inspectionWeight ?? 0,
            '$.adaptiveFluidPacket.inspectionWeight',
            { minimum: 0, maximum: 1 },
        ),
    }, '$.adaptiveFluidPacket');
}

export function createAdaptiveFluidSecondary(input) {
    const source = fluidClone(input, '$.adaptiveFluidSecondary');
    fluidExactObject(source, SECONDARY_KEYS, '$.adaptiveFluidSecondary');
    if (source.schema != null && source.schema !== ADAPTIVE_FLUID_SECONDARY_SCHEMA) {
        throw new TypeError('$.adaptiveFluidSecondary.schema: unsupported schema');
    }
    if (source.schemaVersion != null && source.schemaVersion !== ADAPTIVE_FLUID_SECONDARY_VERSION) {
        throw new TypeError('$.adaptiveFluidSecondary.schemaVersion: unsupported version');
    }
    const mode = source.mode ?? 'render-only';
    if (!ADAPTIVE_FLUID_SECONDARY_MODES.includes(mode)) {
        throw new RangeError('$.adaptiveFluidSecondary.mode: unsupported mode');
    }
    const massKg = fluidFinite(source.massKg ?? 0, '$.adaptiveFluidSecondary.massKg', { minimum: 0 });
    if (mode === 'render-only' && massKg !== 0) {
        throw new RangeError('$.adaptiveFluidSecondary.massKg: render-only matter must be massless');
    }
    if (mode === 'canonical-physical' && massKg <= 0) {
        throw new RangeError('$.adaptiveFluidSecondary.massKg: physical secondary matter requires mass');
    }
    if (source.canonicalMassOwner != null
        && source.canonicalMassOwner !== (mode === 'canonical-physical')) {
        throw new RangeError('$.adaptiveFluidSecondary.canonicalMassOwner: contradicts secondary mode');
    }
    return fluidFreeze({
        schema: ADAPTIVE_FLUID_SECONDARY_SCHEMA,
        schemaVersion: ADAPTIVE_FLUID_SECONDARY_VERSION,
        id: fluidIdentifier(source.id, '$.adaptiveFluidSecondary.id'),
        positionM: fluidVector3(source.positionM, '$.adaptiveFluidSecondary.positionM'),
        velocityMPerS: fluidVector3(source.velocityMPerS, '$.adaptiveFluidSecondary.velocityMPerS'),
        representedVolumeM3: fluidFinite(
            source.representedVolumeM3,
            '$.adaptiveFluidSecondary.representedVolumeM3',
            { minimum: Number.MIN_VALUE },
        ),
        massKg,
        kind: fluidIdentifier(source.kind ?? 'spray', '$.adaptiveFluidSecondary.kind'),
        mode,
        sourcePacketId: fluidIdentifier(source.sourcePacketId, '$.adaptiveFluidSecondary.sourcePacketId'),
        sourceRevision: fluidInteger(source.sourceRevision ?? 0, '$.adaptiveFluidSecondary.sourceRevision'),
        definitionId: fluidIdentifier(
            source.definitionId ?? 'matter.definition.water',
            '$.adaptiveFluidSecondary.definitionId',
        ),
        phase: fluidIdentifier(source.phase ?? 'liquid', '$.adaptiveFluidSecondary.phase'),
        canonicalMassOwner: mode === 'canonical-physical',
    }, '$.adaptiveFluidSecondary');
}

export function summarizeAdaptiveFluidConservation(packets) {
    if (!Array.isArray(packets)) throw new TypeError('$.packets: must be an array');
    let massKg = 0;
    let representedVolumeM3 = 0;
    const linearMomentumKgMPerS = [0, 0, 0];
    const firstMassMomentKgM = [0, 0, 0];
    let physicalPackets = 0;
    let renderOnlySamples = 0;
    for (const input of packets) {
        const packet = createAdaptiveFluidPacket(input);
        const ownsMass = packet?.canonicalMassOwner === true;
        if (!ownsMass) {
            renderOnlySamples += 1;
            continue;
        }
        physicalPackets += 1;
        massKg += packet.massKg;
        representedVolumeM3 += packet.representedVolumeM3;
        for (let axis = 0; axis < 3; axis += 1) {
            linearMomentumKgMPerS[axis] += packet.massKg * packet.velocityMPerS[axis];
            firstMassMomentKgM[axis] += packet.massKg * packet.positionM[axis];
        }
    }
    const centerOfMassM = massKg > 0
        ? firstMassMomentKgM.map(value => value / massKg)
        : [0, 0, 0];
    return fluidFreeze({
        massKg,
        representedVolumeM3,
        linearMomentumKgMPerS,
        firstMassMomentKgM,
        centerOfMassM,
        physicalPackets,
        renderOnlySamples,
    }, '$.adaptiveFluidConservationSummary');
}

export function logAdaptiveFluid(logger, level, event, details = {}) {
    const method = logger?.[level];
    if (typeof method !== 'function') return;
    try {
        method.call(logger, `[AdaptiveMatterFluid] ${event}`, details);
    } catch (_error) {
        // Diagnostics are observational and never become simulation authority.
    }
}
