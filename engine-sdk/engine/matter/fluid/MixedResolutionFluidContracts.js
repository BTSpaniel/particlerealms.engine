// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Fail-closed contracts for a future conservative mixed-resolution fluid solver.
 *
 * This module deliberately grants no execution or physical authority. It freezes
 * the evidence a GPU implementation must satisfy before fine particles, coarse
 * packets, or sparse-grid cells may replace one another as canonical mass owners.
 */

import {
    ADAPTIVE_FLUID_ERROR_CODES,
    AdaptiveFluidError,
    fluidClone,
    fluidExactObject,
    fluidFinite,
    fluidFreeze,
    fluidIdentifier,
    fluidInteger,
} from './AdaptiveFluidContracts.js';

export const MIXED_RESOLUTION_FLUID_PLAN_SCHEMA =
    'engine.matter.mixed-resolution-fluid-handoff-plan';
export const MIXED_RESOLUTION_FLUID_PLAN_VERSION = '1.0.0';
export const MIXED_RESOLUTION_FLUID_RECEIPT_SCHEMA =
    'engine.matter.mixed-resolution-fluid-conservation-receipt';
export const MIXED_RESOLUTION_FLUID_RECEIPT_VERSION = '1.0.0';
export const MIXED_RESOLUTION_FLUID_ABI_VERSION = 'mixed-fluid-physical-v1';

export const MIXED_RESOLUTION_FLUID_CARRIER_KINDS = Object.freeze([
    'fine-particle',
    'coarse-packet',
    'coarse-grid',
]);

export const MIXED_RESOLUTION_FLUID_SUPPORT_RULES = Object.freeze([
    'arithmetic-mean',
    'root-mean-square',
    'maximum',
]);

export const MIXED_RESOLUTION_FLUID_REQUIRED_WAKE_SIGNALS = Object.freeze([
    'contact',
    'coupling-residual',
    'density-residual',
    'divergence',
    'free-surface',
    'predicted-impact',
    'stale-revision',
    'user-interaction',
    'vorticity',
]);

/** The only accepted pass order for the first physical GPU implementation. */
export const MIXED_RESOLUTION_FLUID_STAGE_ORDER = Object.freeze([
    'classify-and-wake',
    'prepare-transitions',
    'validate-transition-receipts',
    'commit-ownership-at-frame-boundary',
    'predict-carriers',
    'build-reciprocal-pair-edges',
    'solve-density-constraints',
    'accumulate-mass-weighted-pair-impulses',
    'solve-grid-pressure',
    'reflux-particle-grid-interfaces',
    'finalize-carriers',
    'validate-frame-conservation',
]);

/**
 * Portable storage ABI reserved by the contract. The current SPH demo does not
 * allocate or dispatch these records.
 */
export const MIXED_RESOLUTION_FLUID_GPU_ABI = fluidFreeze({
    version: MIXED_RESOLUTION_FLUID_ABI_VERSION,
    carrier: {
        byteLength: 64,
        fields: [
            { name: 'positionMass', byteOffset: 0, format: 'f32x4' },
            { name: 'velocityVolume', byteOffset: 16, format: 'f32x4' },
            { name: 'supportRestSubgridInverseMass', byteOffset: 32, format: 'f32x4' },
            { name: 'stableIdLevelKindFlags', byteOffset: 48, format: 'u32x4' },
        ],
    },
    pairEdge: {
        byteLength: 16,
        fields: [
            { name: 'leftIndex', byteOffset: 0, format: 'u32' },
            { name: 'rightIndex', byteOffset: 4, format: 'u32' },
            { name: 'pairSupportRadiusM', byteOffset: 8, format: 'f32' },
            { name: 'flags', byteOffset: 12, format: 'u32' },
        ],
    },
    pairImpulse: {
        byteLength: 16,
        fields: [{ name: 'impulseAndConstraint', byteOffset: 0, format: 'f32x4' }],
    },
    gridCell: {
        byteLength: 64,
        fields: [
            { name: 'massAndMomentum', byteOffset: 0, format: 'f32x4' },
            { name: 'velocityAndVolume', byteOffset: 16, format: 'f32x4' },
            { name: 'pressureDivergenceFlux', byteOffset: 32, format: 'f32x4' },
            { name: 'stableIdLevelFlagsPadding', byteOffset: 48, format: 'u32x4' },
        ],
    },
}, '$.mixedResolutionFluidGpuAbi');

const PLAN_KEYS = new Set([
    'schema', 'schemaVersion', 'planId', 'sourceRevision', 'frameIndex',
    'executionState', 'gpuDispatchEncoded', 'physicalAuthorityGranted',
    'abiVersion', 'source', 'carriers', 'interfaces', 'transitions',
    'wakePolicy', 'tolerance', 'stageOrder', 'carrierConservationReceipt',
    'transitionReceipts',
]);
const SOURCE_KEYS = new Set(['summary', 'ownershipTokens', 'maximumSpeedMPerS']);
const SUMMARY_KEYS = new Set([
    'massKg', 'representedVolumeM3', 'firstMassMomentKgM',
    'linearMomentumKgMPerS', 'angularMomentumKgM2PerS', 'totalEnergyJ',
]);
const TOLERANCE_KEYS = new Set([
    'massKg', 'volumeM3', 'firstMassMomentKgM', 'linearMomentumKgMPerS',
    'angularMomentumKgM2PerS', 'energyJ', 'supportRadiusM', 'relative',
]);
const CARRIER_KEYS = new Set([
    'id', 'kind', 'sourceRevision', 'representationRevision',
    'canonicalMassOwner', 'ownershipTokens', 'adjacentCarrierIds',
    'elementCount', 'resolutionLevel', 'massRangeKg',
    'representedVolumeRangeM3', 'supportRadiusRangeM',
    'restDensityRangeKgM3', 'summary',
]);
const INTERFACE_KEYS = new Set([
    'id', 'leftCarrierId', 'rightCarrierId', 'kind', 'supportRadiusRule',
    'maximumPairSupportRadiusM', 'searchCellSizeM', 'stencilRadiusCells',
    'maximumResolutionLevelDelta', 'neighborVisibility', 'pairOwnership',
    'densityWeighting', 'projectionExchange', 'transferKernel', 'gatherKernel',
    'partitionOfUnityTolerance', 'momentumCoupling', 'pressureCoupling',
]);
const TRANSITION_KEYS = new Set([
    'id', 'operation', 'ownershipTokens', 'preparedFrame', 'activationFrame',
    'sourceRevision', 'targetRevision', 'sourceElementCount',
    'targetElementCount', 'supportRadiusScale', 'before', 'after',
    'commitPolicy', 'rollbackPolicy',
]);
const WAKE_POLICY_KEYS = new Set([
    'requiredSignals', 'predictionHorizonSeconds', 'maximumSpeedMPerS',
    'contactSupportRatio', 'densityRelativeError', 'divergenceTimeProduct',
    'vorticityTimeProduct', 'surfaceIndicator', 'couplingResidualRatio',
    'minimumFineResidenceFrames', 'transitionHaloLayers', 'fineHaloWidthM',
    'maximumLevelDelta', 'staleRevisionAction', 'interactionAction',
    'interfaceFailureAction',
]);
const RECEIPT_KEYS = new Set([
    'schema', 'schemaVersion', 'operation', 'before', 'after', 'residual',
    'tolerance', 'balanced',
]);
const RESIDUAL_KEYS = new Set([
    'massKg', 'representedVolumeM3', 'firstMassMomentKgM',
    'linearMomentumKgMPerS', 'angularMomentumKgM2PerS', 'totalEnergyJ',
]);
const BALANCED_KEYS = new Set([
    'mass', 'volume', 'firstMassMoment', 'linearMomentum', 'angularMomentum',
    'energy', 'all',
]);
const TRANSITION_OPERATIONS = Object.freeze([
    'split-1-to-8',
    'merge-8-to-1',
    'particle-to-grid',
    'grid-to-particle',
]);
const TRANSFER_KERNELS = Object.freeze(['linear-hat', 'quadratic-b-spline']);
const TOLERANCE_LIMITS = Object.freeze({
    massKg: 1e-6,
    volumeM3: 1e-9,
    firstMassMomentKgM: 1e-6,
    linearMomentumKgMPerS: 1e-6,
    angularMomentumKgM2PerS: 1e-6,
    energyJ: 1e-5,
    supportRadiusM: 1e-9,
    relative: 1e-6,
});

function vector3(value, path) {
    if (!Array.isArray(value) || value.length !== 3) {
        throw new TypeError(`${path}: must contain exactly three finite values`);
    }
    return value.map((entry, axis) => fluidFinite(entry, `${path}[${axis}]`));
}

function positiveRange(value, path) {
    if (!Array.isArray(value) || value.length !== 2) {
        throw new TypeError(`${path}: must contain a positive minimum and maximum`);
    }
    const minimum = fluidFinite(value[0], `${path}[0]`, { minimum: Number.MIN_VALUE });
    const maximum = fluidFinite(value[1], `${path}[1]`, { minimum });
    return [minimum, maximum];
}

function identifiers(value, path, { allowEmpty = false } = {}) {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
        throw new TypeError(`${path}: must be ${allowEmpty ? 'an' : 'a non-empty'} identifier array`);
    }
    const result = value.map((entry, index) => fluidIdentifier(entry, `${path}[${index}]`));
    const unique = new Set(result);
    if (unique.size !== result.length) throw new RangeError(`${path}: duplicate identifier`);
    return [...result].sort((left, right) => left.localeCompare(right));
}

function enumValue(value, allowed, path) {
    if (!allowed.includes(value)) throw new RangeError(`${path}: unsupported value '${value}'`);
    return value;
}

function normalizeSummary(input, path, { positive = true } = {}) {
    const source = fluidClone(input, path);
    fluidExactObject(source, SUMMARY_KEYS, path);
    return {
        massKg: fluidFinite(source.massKg, `${path}.massKg`, {
            minimum: positive ? Number.MIN_VALUE : 0,
        }),
        representedVolumeM3: fluidFinite(
            source.representedVolumeM3,
            `${path}.representedVolumeM3`,
            { minimum: positive ? Number.MIN_VALUE : 0 },
        ),
        firstMassMomentKgM: vector3(source.firstMassMomentKgM, `${path}.firstMassMomentKgM`),
        linearMomentumKgMPerS: vector3(
            source.linearMomentumKgMPerS,
            `${path}.linearMomentumKgMPerS`,
        ),
        angularMomentumKgM2PerS: vector3(
            source.angularMomentumKgM2PerS,
            `${path}.angularMomentumKgM2PerS`,
        ),
        totalEnergyJ: fluidFinite(source.totalEnergyJ, `${path}.totalEnergyJ`, { minimum: 0 }),
    };
}

function normalizeTolerance(input = {}) {
    const source = fluidClone(input, '$.tolerance');
    fluidExactObject(source, TOLERANCE_KEYS, '$.tolerance');
    const bounded = (key, fallback) => fluidFinite(source[key] ?? fallback, `$.tolerance.${key}`, {
        minimum: 0,
        maximum: TOLERANCE_LIMITS[key],
    });
    return {
        massKg: bounded('massKg', 1e-9),
        volumeM3: bounded('volumeM3', 1e-12),
        firstMassMomentKgM: bounded('firstMassMomentKgM', 1e-9),
        linearMomentumKgMPerS: bounded('linearMomentumKgMPerS', 1e-9),
        angularMomentumKgM2PerS: bounded('angularMomentumKgM2PerS', 1e-9),
        energyJ: bounded('energyJ', 1e-8),
        supportRadiusM: bounded('supportRadiusM', 1e-12),
        relative: fluidFinite(source.relative ?? 1e-8, '$.tolerance.relative', {
            minimum: 0,
            maximum: TOLERANCE_LIMITS.relative,
        }),
    };
}

function compensatedSum(values) {
    let sum = 0;
    let compensation = 0;
    for (const value of values) {
        const corrected = value - compensation;
        const next = sum + corrected;
        compensation = (next - sum) - corrected;
        sum = next;
    }
    return sum;
}

function sumVectors(values) {
    return [0, 1, 2].map(axis => compensatedSum(values.map(value => value[axis])));
}

function sumSummaries(summaries) {
    return {
        massKg: compensatedSum(summaries.map(value => value.massKg)),
        representedVolumeM3: compensatedSum(summaries.map(value => value.representedVolumeM3)),
        firstMassMomentKgM: sumVectors(summaries.map(value => value.firstMassMomentKgM)),
        linearMomentumKgMPerS: sumVectors(summaries.map(value => value.linearMomentumKgMPerS)),
        angularMomentumKgM2PerS: sumVectors(summaries.map(value => value.angularMomentumKgM2PerS)),
        totalEnergyJ: compensatedSum(summaries.map(value => value.totalEnergyJ)),
    };
}

function subtractVectors(after, before) {
    return after.map((value, axis) => value - before[axis]);
}

function scalarBalanced(residual, before, after, absolute, relative) {
    return Math.abs(residual) <= absolute
        + relative * Math.max(Number.MIN_VALUE, Math.abs(before), Math.abs(after));
}

function vectorBalanced(residual, before, after, absolute, relative) {
    return residual.every((value, axis) => scalarBalanced(
        value,
        before[axis],
        after[axis],
        absolute,
        relative,
    ));
}

function buildReceipt(operation, beforeInput, afterInput, toleranceInput) {
    const before = normalizeSummary(beforeInput, '$.receipt.before', { positive: false });
    const after = normalizeSummary(afterInput, '$.receipt.after', { positive: false });
    const tolerance = normalizeTolerance(toleranceInput);
    const residual = {
        massKg: after.massKg - before.massKg,
        representedVolumeM3: after.representedVolumeM3 - before.representedVolumeM3,
        firstMassMomentKgM: subtractVectors(after.firstMassMomentKgM, before.firstMassMomentKgM),
        linearMomentumKgMPerS: subtractVectors(
            after.linearMomentumKgMPerS,
            before.linearMomentumKgMPerS,
        ),
        angularMomentumKgM2PerS: subtractVectors(
            after.angularMomentumKgM2PerS,
            before.angularMomentumKgM2PerS,
        ),
        totalEnergyJ: after.totalEnergyJ - before.totalEnergyJ,
    };
    const balanced = {
        mass: scalarBalanced(
            residual.massKg,
            before.massKg,
            after.massKg,
            tolerance.massKg,
            tolerance.relative,
        ),
        volume: scalarBalanced(
            residual.representedVolumeM3,
            before.representedVolumeM3,
            after.representedVolumeM3,
            tolerance.volumeM3,
            tolerance.relative,
        ),
        firstMassMoment: vectorBalanced(
            residual.firstMassMomentKgM,
            before.firstMassMomentKgM,
            after.firstMassMomentKgM,
            tolerance.firstMassMomentKgM,
            tolerance.relative,
        ),
        linearMomentum: vectorBalanced(
            residual.linearMomentumKgMPerS,
            before.linearMomentumKgMPerS,
            after.linearMomentumKgMPerS,
            tolerance.linearMomentumKgMPerS,
            tolerance.relative,
        ),
        angularMomentum: vectorBalanced(
            residual.angularMomentumKgM2PerS,
            before.angularMomentumKgM2PerS,
            after.angularMomentumKgM2PerS,
            tolerance.angularMomentumKgM2PerS,
            tolerance.relative,
        ),
        energy: scalarBalanced(
            residual.totalEnergyJ,
            before.totalEnergyJ,
            after.totalEnergyJ,
            tolerance.energyJ,
            tolerance.relative,
        ),
    };
    balanced.all = Object.values(balanced).every(Boolean);
    return fluidFreeze({
        schema: MIXED_RESOLUTION_FLUID_RECEIPT_SCHEMA,
        schemaVersion: MIXED_RESOLUTION_FLUID_RECEIPT_VERSION,
        operation: fluidIdentifier(operation, '$.receipt.operation'),
        before,
        after,
        residual,
        tolerance,
        balanced,
    }, '$.mixedResolutionFluidConservationReceipt');
}

function validateReceiptShape(input, expected, path) {
    const value = fluidClone(input, path);
    fluidExactObject(value, RECEIPT_KEYS, path);
    fluidExactObject(value.residual, RESIDUAL_KEYS, `${path}.residual`);
    fluidExactObject(value.balanced, BALANCED_KEYS, `${path}.balanced`);
    if (JSON.stringify(value) !== JSON.stringify(expected)) {
        throw new AdaptiveFluidError(
            ADAPTIVE_FLUID_ERROR_CODES.CONSERVATION_FAILURE,
            `${path}: supplied receipt differs from independently derived conservation evidence`,
        );
    }
}

/** Create an independently derived six-invariant conservation receipt. */
export function createMixedResolutionFluidConservationReceipt({
    operation,
    before,
    after,
    tolerance = {},
} = {}) {
    return buildReceipt(operation, before, after, tolerance);
}

function requireRangeContainsTotal(range, count, total, path, tolerance) {
    const minimum = range[0] * count;
    const maximum = range[1] * count;
    const slack = tolerance + Math.abs(total) * 1e-12;
    if (total < minimum - slack || total > maximum + slack) {
        throw new RangeError(`${path}: aggregate does not fit element count and declared range`);
    }
}

function normalizeCarrier(input, index, sourceRevision, tolerance) {
    const path = `$.carriers[${index}]`;
    const source = fluidClone(input, path);
    fluidExactObject(source, CARRIER_KEYS, path);
    const summary = normalizeSummary(source.summary, `${path}.summary`);
    const elementCount = fluidInteger(source.elementCount, `${path}.elementCount`, {
        minimum: 1,
        maximum: 1_000_000_000,
    });
    const massRangeKg = positiveRange(source.massRangeKg, `${path}.massRangeKg`);
    const representedVolumeRangeM3 = positiveRange(
        source.representedVolumeRangeM3,
        `${path}.representedVolumeRangeM3`,
    );
    const restDensityRangeKgM3 = positiveRange(
        source.restDensityRangeKgM3,
        `${path}.restDensityRangeKgM3`,
    );
    requireRangeContainsTotal(
        massRangeKg,
        elementCount,
        summary.massKg,
        `${path}.massRangeKg`,
        tolerance.massKg,
    );
    requireRangeContainsTotal(
        representedVolumeRangeM3,
        elementCount,
        summary.representedVolumeM3,
        `${path}.representedVolumeRangeM3`,
        tolerance.volumeM3,
    );
    const aggregateDensity = summary.massKg / summary.representedVolumeM3;
    if (aggregateDensity < restDensityRangeKgM3[0] * (1 - tolerance.relative)
        || aggregateDensity > restDensityRangeKgM3[1] * (1 + tolerance.relative)) {
        throw new RangeError(`${path}.restDensityRangeKgM3: excludes aggregate carrier density`);
    }
    const canonicalMassOwner = source.canonicalMassOwner;
    if (canonicalMassOwner !== true) {
        throw new AdaptiveFluidError(
            ADAPTIVE_FLUID_ERROR_CODES.INVALID_INPUT,
            `${path}.canonicalMassOwner: every physical carrier must own its partition exclusively`,
        );
    }
    const carrierRevision = fluidInteger(source.sourceRevision, `${path}.sourceRevision`);
    if (carrierRevision !== sourceRevision) {
        throw new AdaptiveFluidError(
            ADAPTIVE_FLUID_ERROR_CODES.REVISION_CONFLICT,
            `${path}.sourceRevision: carrier is stale for this plan`,
        );
    }
    return {
        id: fluidIdentifier(source.id, `${path}.id`),
        kind: enumValue(source.kind, MIXED_RESOLUTION_FLUID_CARRIER_KINDS, `${path}.kind`),
        sourceRevision: carrierRevision,
        representationRevision: fluidInteger(
            source.representationRevision,
            `${path}.representationRevision`,
        ),
        canonicalMassOwner,
        ownershipTokens: identifiers(source.ownershipTokens, `${path}.ownershipTokens`),
        adjacentCarrierIds: identifiers(
            source.adjacentCarrierIds ?? [],
            `${path}.adjacentCarrierIds`,
            { allowEmpty: true },
        ),
        elementCount,
        resolutionLevel: fluidInteger(source.resolutionLevel, `${path}.resolutionLevel`, {
            maximum: 31,
        }),
        massRangeKg,
        representedVolumeRangeM3,
        supportRadiusRangeM: positiveRange(
            source.supportRadiusRangeM,
            `${path}.supportRadiusRangeM`,
        ),
        restDensityRangeKgM3,
        summary,
    };
}

function pairKey(leftId, rightId) {
    return [leftId, rightId].sort((left, right) => left.localeCompare(right)).join('|');
}

function pairSupportRadius(left, right, rule) {
    const leftRadius = left.supportRadiusRangeM[1];
    const rightRadius = right.supportRadiusRangeM[1];
    if (rule === 'arithmetic-mean') return 0.5 * (leftRadius + rightRadius);
    if (rule === 'root-mean-square') {
        return Math.sqrt(0.5 * (leftRadius * leftRadius + rightRadius * rightRadius));
    }
    return Math.max(leftRadius, rightRadius);
}

function normalizeInterface(input, index, carriersById, tolerance) {
    const path = `$.interfaces[${index}]`;
    const source = fluidClone(input, path);
    fluidExactObject(source, INTERFACE_KEYS, path);
    const leftCarrierId = fluidIdentifier(source.leftCarrierId, `${path}.leftCarrierId`);
    const rightCarrierId = fluidIdentifier(source.rightCarrierId, `${path}.rightCarrierId`);
    if (leftCarrierId === rightCarrierId) throw new RangeError(`${path}: self interface is invalid`);
    const left = carriersById.get(leftCarrierId);
    const right = carriersById.get(rightCarrierId);
    if (!left || !right) throw new RangeError(`${path}: references an unknown carrier`);
    const hasGrid = left.kind === 'coarse-grid' || right.kind === 'coarse-grid';
    if (left.kind === 'coarse-grid' && right.kind === 'coarse-grid') {
        throw new RangeError(`${path}: grid-to-grid adjacency belongs to one grid carrier`);
    }
    const kind = enumValue(source.kind, ['symmetric-sph', 'particle-grid'], `${path}.kind`);
    if (kind !== (hasGrid ? 'particle-grid' : 'symmetric-sph')) {
        throw new RangeError(`${path}.kind: does not match its carrier kinds`);
    }
    const levelDelta = Math.abs(left.resolutionLevel - right.resolutionLevel);
    const maximumResolutionLevelDelta = fluidInteger(
        source.maximumResolutionLevelDelta,
        `${path}.maximumResolutionLevelDelta`,
        { minimum: 1, maximum: 1 },
    );
    if (levelDelta > maximumResolutionLevelDelta) {
        throw new RangeError(`${path}: adjacent carriers violate the graded 2:1 level boundary`);
    }
    if (left.kind === 'fine-particle' && right.kind !== 'fine-particle'
        && left.resolutionLevel !== right.resolutionLevel + 1) {
        throw new RangeError(`${path}: fine carrier must be exactly one level above its coarse neighbor`);
    }
    if (right.kind === 'fine-particle' && left.kind !== 'fine-particle'
        && right.resolutionLevel !== left.resolutionLevel + 1) {
        throw new RangeError(`${path}: fine carrier must be exactly one level above its coarse neighbor`);
    }
    const supportRadiusRule = enumValue(
        source.supportRadiusRule,
        MIXED_RESOLUTION_FLUID_SUPPORT_RULES,
        `${path}.supportRadiusRule`,
    );
    const derivedMaximum = pairSupportRadius(left, right, supportRadiusRule);
    const maximumPairSupportRadiusM = fluidFinite(
        source.maximumPairSupportRadiusM,
        `${path}.maximumPairSupportRadiusM`,
        { minimum: Number.MIN_VALUE },
    );
    if (!scalarBalanced(
        maximumPairSupportRadiusM - derivedMaximum,
        derivedMaximum,
        maximumPairSupportRadiusM,
        tolerance.supportRadiusM,
        tolerance.relative,
    )) {
        throw new RangeError(`${path}.maximumPairSupportRadiusM: differs from the symmetric rule`);
    }
    const searchCellSizeM = fluidFinite(source.searchCellSizeM, `${path}.searchCellSizeM`, {
        minimum: Number.MIN_VALUE,
    });
    const stencilRadiusCells = fluidInteger(
        source.stencilRadiusCells,
        `${path}.stencilRadiusCells`,
        { minimum: 1, maximum: 1024 },
    );
    if (stencilRadiusCells < Math.ceil(maximumPairSupportRadiusM / searchCellSizeM)) {
        throw new RangeError(`${path}.stencilRadiusCells: cannot cover the maximum pair support`);
    }
    if (source.neighborVisibility !== 'reciprocal') {
        throw new RangeError(`${path}.neighborVisibility: must be reciprocal`);
    }
    if (kind === 'symmetric-sph') {
        if (source.pairOwnership !== 'one-edge-one-evaluation'
            || source.densityWeighting !== 'neighbor-mass'
            || source.projectionExchange !== 'mass-weighted-equal-and-opposite'
            || source.transferKernel !== null || source.gatherKernel !== null
            || source.partitionOfUnityTolerance !== null
            || source.momentumCoupling !== 'pair-impulse'
            || source.pressureCoupling !== 'shared-density-constraint') {
            throw new AdaptiveFluidError(
                ADAPTIVE_FLUID_ERROR_CODES.INVALID_INPUT,
                `${path}: symmetric SPH interface lacks conservative single-edge exchange`,
            );
        }
    } else {
        const transferKernel = enumValue(source.transferKernel, TRANSFER_KERNELS, `${path}.transferKernel`);
        if (source.gatherKernel !== transferKernel
            || source.pairOwnership !== 'single-interface-sample'
            || source.densityWeighting !== 'partition-of-unity-mass'
            || source.projectionExchange !== 'particle-grid-reflux'
            || source.momentumCoupling !== 'apic-with-interface-reflux'
            || source.pressureCoupling !== 'shared-face-flux-reflux') {
            throw new AdaptiveFluidError(
                ADAPTIVE_FLUID_ERROR_CODES.INVALID_INPUT,
                `${path}: particle-grid interface lacks matching transfers and reflux`,
            );
        }
        fluidFinite(
            source.partitionOfUnityTolerance,
            `${path}.partitionOfUnityTolerance`,
            { minimum: 0, maximum: 1e-6 },
        );
    }
    return {
        id: fluidIdentifier(source.id, `${path}.id`),
        leftCarrierId,
        rightCarrierId,
        kind,
        supportRadiusRule,
        maximumPairSupportRadiusM,
        searchCellSizeM,
        stencilRadiusCells,
        maximumResolutionLevelDelta,
        neighborVisibility: source.neighborVisibility,
        pairOwnership: source.pairOwnership,
        densityWeighting: source.densityWeighting,
        projectionExchange: source.projectionExchange,
        transferKernel: source.transferKernel,
        gatherKernel: source.gatherKernel,
        partitionOfUnityTolerance: source.partitionOfUnityTolerance,
        momentumCoupling: source.momentumCoupling,
        pressureCoupling: source.pressureCoupling,
    };
}

function normalizeTransition(input, index, plan, sourceTokens, tolerance) {
    const path = `$.transitions[${index}]`;
    const source = fluidClone(input, path);
    fluidExactObject(source, TRANSITION_KEYS, path);
    const operation = enumValue(source.operation, TRANSITION_OPERATIONS, `${path}.operation`);
    const ownershipTokens = identifiers(source.ownershipTokens, `${path}.ownershipTokens`);
    for (const token of ownershipTokens) {
        if (!sourceTokens.has(token)) throw new RangeError(`${path}.ownershipTokens: unknown source token '${token}'`);
    }
    const preparedFrame = fluidInteger(source.preparedFrame, `${path}.preparedFrame`);
    const activationFrame = fluidInteger(source.activationFrame, `${path}.activationFrame`);
    if (preparedFrame !== plan.frameIndex || activationFrame <= preparedFrame) {
        throw new RangeError(`${path}: transition must activate after its exact prepared frame`);
    }
    const sourceRevision = fluidInteger(source.sourceRevision, `${path}.sourceRevision`);
    const targetRevision = fluidInteger(source.targetRevision, `${path}.targetRevision`);
    if (sourceRevision !== plan.sourceRevision || targetRevision !== sourceRevision + 1) {
        throw new AdaptiveFluidError(
            ADAPTIVE_FLUID_ERROR_CODES.REVISION_CONFLICT,
            `${path}: transition revisions are not the plan revision and its direct successor`,
        );
    }
    const sourceElementCount = fluidInteger(
        source.sourceElementCount,
        `${path}.sourceElementCount`,
        { minimum: 1, maximum: 1_000_000_000 },
    );
    const targetElementCount = fluidInteger(
        source.targetElementCount,
        `${path}.targetElementCount`,
        { minimum: 1, maximum: 1_000_000_000 },
    );
    const supportRadiusScale = fluidFinite(
        source.supportRadiusScale,
        `${path}.supportRadiusScale`,
        { minimum: Number.MIN_VALUE, maximum: 1_000_000 },
    );
    if (operation === 'split-1-to-8'
        && (sourceElementCount !== 1 || targetElementCount !== 8 || supportRadiusScale !== 0.5)) {
        throw new RangeError(`${path}: split must be 1-to-8 with a 0.5 support-radius scale`);
    }
    if (operation === 'merge-8-to-1'
        && (sourceElementCount !== 8 || targetElementCount !== 1 || supportRadiusScale !== 2)) {
        throw new RangeError(`${path}: merge must be 8-to-1 with a 2.0 support-radius scale`);
    }
    if (operation === 'particle-to-grid' && supportRadiusScale < 1) {
        throw new RangeError(`${path}: particle-to-grid support cannot become finer`);
    }
    if (operation === 'grid-to-particle' && supportRadiusScale > 1) {
        throw new RangeError(`${path}: grid-to-particle support cannot become coarser`);
    }
    if (source.commitPolicy !== 'validate-target-then-retire-source-at-frame-boundary'
        || source.rollbackPolicy !== 'restore-source-before-next-substep') {
        throw new AdaptiveFluidError(
            ADAPTIVE_FLUID_ERROR_CODES.INVALID_INPUT,
            `${path}: transition does not provide atomic commit and rollback`,
        );
    }
    const before = normalizeSummary(source.before, `${path}.before`);
    const after = normalizeSummary(source.after, `${path}.after`);
    const receipt = buildReceipt(operation, before, after, tolerance);
    if (!receipt.balanced.all) {
        throw new AdaptiveFluidError(
            ADAPTIVE_FLUID_ERROR_CODES.CONSERVATION_FAILURE,
            `${path}: transition violates mass, volume, moment, momentum, angular momentum, or energy`,
            { operation, residual: receipt.residual },
        );
    }
    return {
        transition: {
            id: fluidIdentifier(source.id, `${path}.id`),
            operation,
            ownershipTokens,
            preparedFrame,
            activationFrame,
            sourceRevision,
            targetRevision,
            sourceElementCount,
            targetElementCount,
            supportRadiusScale,
            before,
            after,
            commitPolicy: source.commitPolicy,
            rollbackPolicy: source.rollbackPolicy,
        },
        receipt,
    };
}

function normalizeWakePolicy(input, source, carriers) {
    const path = '$.wakePolicy';
    const value = fluidClone(input, path);
    fluidExactObject(value, WAKE_POLICY_KEYS, path);
    const requiredSignals = identifiers(value.requiredSignals, `${path}.requiredSignals`);
    if (JSON.stringify(requiredSignals) !== JSON.stringify(MIXED_RESOLUTION_FLUID_REQUIRED_WAKE_SIGNALS)) {
        throw new AdaptiveFluidError(
            ADAPTIVE_FLUID_ERROR_CODES.INVALID_INPUT,
            `${path}.requiredSignals: must contain every mandatory wake/refine signal exactly once`,
        );
    }
    const predictionHorizonSeconds = fluidFinite(
        value.predictionHorizonSeconds,
        `${path}.predictionHorizonSeconds`,
        { minimum: Number.MIN_VALUE, maximum: 0.5 },
    );
    const maximumSpeedMPerS = fluidFinite(
        value.maximumSpeedMPerS,
        `${path}.maximumSpeedMPerS`,
        { minimum: 0, maximum: 1_000_000 },
    );
    if (maximumSpeedMPerS !== source.maximumSpeedMPerS) {
        throw new RangeError(`${path}.maximumSpeedMPerS: differs from source evidence`);
    }
    const fineHaloWidthM = fluidFinite(value.fineHaloWidthM, `${path}.fineHaloWidthM`, {
        minimum: Number.MIN_VALUE,
    });
    let maximumSupport = 0;
    for (const carrier of carriers) {
        maximumSupport = Math.max(maximumSupport, carrier.supportRadiusRangeM[1]);
    }
    const requiredHalo = maximumSupport + maximumSpeedMPerS * predictionHorizonSeconds;
    if (fineHaloWidthM < requiredHalo) {
        throw new RangeError(`${path}.fineHaloWidthM: cannot cover support plus predicted motion`);
    }
    const actions = {
        staleRevisionAction: 'wake-before-use',
        interactionAction: 'wake-before-impulse',
        interfaceFailureAction: 'rollback-and-wake',
    };
    for (const [key, expected] of Object.entries(actions)) {
        if (value[key] !== expected) throw new RangeError(`${path}.${key}: must be '${expected}'`);
    }
    return {
        requiredSignals,
        predictionHorizonSeconds,
        maximumSpeedMPerS,
        contactSupportRatio: fluidFinite(value.contactSupportRatio, `${path}.contactSupportRatio`, {
            minimum: 0,
            maximum: 2,
        }),
        densityRelativeError: fluidFinite(value.densityRelativeError, `${path}.densityRelativeError`, {
            minimum: 0,
            maximum: 1,
        }),
        divergenceTimeProduct: fluidFinite(
            value.divergenceTimeProduct,
            `${path}.divergenceTimeProduct`,
            { minimum: 0, maximum: 10 },
        ),
        vorticityTimeProduct: fluidFinite(
            value.vorticityTimeProduct,
            `${path}.vorticityTimeProduct`,
            { minimum: 0, maximum: 10 },
        ),
        surfaceIndicator: fluidFinite(value.surfaceIndicator, `${path}.surfaceIndicator`, {
            minimum: 0,
            maximum: 1,
        }),
        couplingResidualRatio: fluidFinite(
            value.couplingResidualRatio,
            `${path}.couplingResidualRatio`,
            { minimum: 0, maximum: 1e-2 },
        ),
        minimumFineResidenceFrames: fluidInteger(
            value.minimumFineResidenceFrames,
            `${path}.minimumFineResidenceFrames`,
            { minimum: 2, maximum: 1_000_000 },
        ),
        transitionHaloLayers: fluidInteger(
            value.transitionHaloLayers,
            `${path}.transitionHaloLayers`,
            { minimum: 2, maximum: 64 },
        ),
        fineHaloWidthM,
        maximumLevelDelta: fluidInteger(value.maximumLevelDelta, `${path}.maximumLevelDelta`, {
            minimum: 1,
            maximum: 1,
        }),
        ...actions,
    };
}

function sameData(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Create a deterministic plan after validating every currently provable
 * conservation, ownership, coupling, transition, and wake invariant.
 *
 * Version 1 remains `contract-only`; callers cannot opt into GPU dispatch or
 * physical authority by setting flags in untrusted input.
 */
export function createMixedResolutionFluidHandoffPlan(input) {
    const sourceInput = fluidClone(input, '$.mixedResolutionFluidPlan');
    fluidExactObject(sourceInput, PLAN_KEYS, '$.mixedResolutionFluidPlan');
    if (sourceInput.schema != null && sourceInput.schema !== MIXED_RESOLUTION_FLUID_PLAN_SCHEMA) {
        throw new TypeError('$.schema: unsupported mixed-resolution fluid plan schema');
    }
    if (sourceInput.schemaVersion != null
        && sourceInput.schemaVersion !== MIXED_RESOLUTION_FLUID_PLAN_VERSION) {
        throw new TypeError('$.schemaVersion: unsupported mixed-resolution fluid plan version');
    }
    if ((sourceInput.executionState ?? 'contract-only') !== 'contract-only'
        || (sourceInput.gpuDispatchEncoded ?? false) !== false
        || (sourceInput.physicalAuthorityGranted ?? false) !== false) {
        throw new AdaptiveFluidError(
            ADAPTIVE_FLUID_ERROR_CODES.INVALID_INPUT,
            'Mixed-resolution fluid v1 is contract-only and cannot grant dispatch or physical authority',
        );
    }
    if ((sourceInput.abiVersion ?? MIXED_RESOLUTION_FLUID_ABI_VERSION)
        !== MIXED_RESOLUTION_FLUID_ABI_VERSION) {
        throw new TypeError('$.abiVersion: unsupported mixed-resolution physical ABI');
    }
    const stageOrder = sourceInput.stageOrder ?? MIXED_RESOLUTION_FLUID_STAGE_ORDER;
    if (!sameData(stageOrder, MIXED_RESOLUTION_FLUID_STAGE_ORDER)) {
        throw new RangeError('$.stageOrder: conservative mixed-fluid pass order changed');
    }
    const planId = fluidIdentifier(sourceInput.planId, '$.planId');
    const sourceRevision = fluidInteger(sourceInput.sourceRevision, '$.sourceRevision');
    const frameIndex = fluidInteger(sourceInput.frameIndex, '$.frameIndex');
    const tolerance = normalizeTolerance(sourceInput.tolerance ?? {});
    const sourceRecord = fluidClone(sourceInput.source, '$.source');
    fluidExactObject(sourceRecord, SOURCE_KEYS, '$.source');
    const source = {
        summary: normalizeSummary(sourceRecord.summary, '$.source.summary'),
        ownershipTokens: identifiers(sourceRecord.ownershipTokens, '$.source.ownershipTokens'),
        maximumSpeedMPerS: fluidFinite(
            sourceRecord.maximumSpeedMPerS,
            '$.source.maximumSpeedMPerS',
            { minimum: 0, maximum: 1_000_000 },
        ),
    };
    if (!Array.isArray(sourceInput.carriers) || sourceInput.carriers.length < 2
        || sourceInput.carriers.length > 1_000_000) {
        throw new RangeError('$.carriers: a mixed plan requires at least two bounded carriers');
    }
    const carriers = sourceInput.carriers.map((carrier, index) => (
        normalizeCarrier(carrier, index, sourceRevision, tolerance)
    ));
    const carrierIds = new Set(carriers.map(carrier => carrier.id));
    if (carrierIds.size !== carriers.length) throw new RangeError('$.carriers: duplicate carrier id');
    if (!carriers.some(carrier => carrier.kind === 'fine-particle')
        || !carriers.some(carrier => carrier.kind !== 'fine-particle')) {
        throw new RangeError('$.carriers: plan must mix a fine-particle carrier with a coarse carrier');
    }
    const sourceTokenSet = new Set(source.ownershipTokens);
    const observedTokens = [];
    for (const carrier of carriers) observedTokens.push(...carrier.ownershipTokens);
    if (new Set(observedTokens).size !== observedTokens.length) {
        throw new AdaptiveFluidError(
            ADAPTIVE_FLUID_ERROR_CODES.CONSERVATION_FAILURE,
            '$.carriers: canonical ownership tokens overlap across physical carriers',
        );
    }
    const sortedObservedTokens = [...observedTokens].sort((left, right) => left.localeCompare(right));
    if (!sameData(sortedObservedTokens, source.ownershipTokens)) {
        throw new AdaptiveFluidError(
            ADAPTIVE_FLUID_ERROR_CODES.CONSERVATION_FAILURE,
            '$.carriers: canonical ownership partition is missing or inventing source tokens',
        );
    }
    const carrierConservationReceipt = buildReceipt(
        'carrier-partition',
        source.summary,
        sumSummaries(carriers.map(carrier => carrier.summary)),
        tolerance,
    );
    if (!carrierConservationReceipt.balanced.all) {
        throw new AdaptiveFluidError(
            ADAPTIVE_FLUID_ERROR_CODES.CONSERVATION_FAILURE,
            '$.carriers: physical carrier partition violates conservation',
            { residual: carrierConservationReceipt.residual },
        );
    }
    if (sourceInput.carrierConservationReceipt != null) {
        validateReceiptShape(
            sourceInput.carrierConservationReceipt,
            carrierConservationReceipt,
            '$.carrierConservationReceipt',
        );
    }
    const carriersById = new Map(carriers.map(carrier => [carrier.id, carrier]));
    const expectedInterfacePairs = new Set();
    for (const carrier of carriers) {
        for (const neighborId of carrier.adjacentCarrierIds) {
            const neighbor = carriersById.get(neighborId);
            if (!neighbor || neighborId === carrier.id
                || !neighbor.adjacentCarrierIds.includes(carrier.id)) {
                throw new RangeError(`$.carriers.${carrier.id}: adjacency must be known, distinct, and reciprocal`);
            }
            expectedInterfacePairs.add(pairKey(carrier.id, neighborId));
        }
    }
    if (!Array.isArray(sourceInput.interfaces)) throw new TypeError('$.interfaces: must be an array');
    const interfaces = sourceInput.interfaces.map((entry, index) => (
        normalizeInterface(entry, index, carriersById, tolerance)
    ));
    const interfaceIds = new Set(interfaces.map(entry => entry.id));
    const interfacePairs = interfaces.map(entry => pairKey(entry.leftCarrierId, entry.rightCarrierId));
    if (interfaceIds.size !== interfaces.length || new Set(interfacePairs).size !== interfacePairs.length) {
        throw new RangeError('$.interfaces: duplicate interface id or carrier pair');
    }
    if (!sameData([...new Set(interfacePairs)].sort(), [...expectedInterfacePairs].sort())) {
        throw new RangeError('$.interfaces: must exactly cover every declared reciprocal adjacency');
    }
    const transitionInputs = sourceInput.transitions ?? [];
    if (!Array.isArray(transitionInputs)) throw new TypeError('$.transitions: must be an array');
    const normalizedTransitions = transitionInputs.map((entry, index) => (
        normalizeTransition(
            entry,
            index,
            { frameIndex, sourceRevision },
            sourceTokenSet,
            tolerance,
        )
    ));
    const transitions = normalizedTransitions.map(value => value.transition);
    const transitionReceipts = normalizedTransitions.map(value => value.receipt);
    const transitionIds = new Set(transitions.map(value => value.id));
    const transitionTokens = transitions.flatMap(value => value.ownershipTokens);
    if (transitionIds.size !== transitions.length
        || new Set(transitionTokens).size !== transitionTokens.length) {
        throw new RangeError('$.transitions: duplicate transition id or simultaneous ownership token');
    }
    if (sourceInput.transitionReceipts != null) {
        if (!Array.isArray(sourceInput.transitionReceipts)
            || sourceInput.transitionReceipts.length !== transitionReceipts.length) {
            throw new TypeError('$.transitionReceipts: does not match transition count');
        }
        sourceInput.transitionReceipts.forEach((receipt, index) => validateReceiptShape(
            receipt,
            transitionReceipts[index],
            `$.transitionReceipts[${index}]`,
        ));
    }
    const wakePolicy = normalizeWakePolicy(sourceInput.wakePolicy, source, carriers);
    return fluidFreeze({
        schema: MIXED_RESOLUTION_FLUID_PLAN_SCHEMA,
        schemaVersion: MIXED_RESOLUTION_FLUID_PLAN_VERSION,
        planId,
        sourceRevision,
        frameIndex,
        executionState: 'contract-only',
        gpuDispatchEncoded: false,
        physicalAuthorityGranted: false,
        abiVersion: MIXED_RESOLUTION_FLUID_ABI_VERSION,
        source,
        carriers,
        interfaces,
        transitions,
        wakePolicy,
        tolerance,
        stageOrder: [...MIXED_RESOLUTION_FLUID_STAGE_ORDER],
        carrierConservationReceipt,
        transitionReceipts,
    }, '$.mixedResolutionFluidPlan');
}

/** Revalidate a serialized or previously created contract-only plan. */
export function validateMixedResolutionFluidHandoffPlan(plan) {
    return createMixedResolutionFluidHandoffPlan(plan);
}

/**
 * Explicit physical-authority gate. Version 1 always rejects because no live
 * solver certificate/dispatch receipt exists yet.
 */
export function requireMixedResolutionFluidPhysicalAuthority(plan) {
    const validated = validateMixedResolutionFluidHandoffPlan(plan);
    throw new AdaptiveFluidError(
        ADAPTIVE_FLUID_ERROR_CODES.INVALID_INPUT,
        'Mixed-resolution physical authority is unavailable: contract evidence is not a solver dispatch certificate',
        {
            planId: validated.planId,
            executionState: validated.executionState,
            gpuDispatchEncoded: validated.gpuDispatchEncoded,
            physicalAuthorityGranted: validated.physicalAuthorityGranted,
        },
    );
}
