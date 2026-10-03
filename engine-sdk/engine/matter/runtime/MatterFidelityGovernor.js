// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Matter-specific policy layered over the engine-wide adaptive quality governor. */

import { AdaptiveQualityGovernor } from '../../core/gpu/AdaptiveQualityGovernor.js';
import {
    cloneAndFreezeStrictJson,
    cloneStrictJson,
    deepFreezeJson,
    isPlainJsonObject,
} from '../../core/schema/StrictJsonValue.js';

export const MATTER_FIDELITY_GOVERNOR_SCHEMA = 'engine.matter.fidelity-governor-snapshot';
export const MATTER_FIDELITY_GOVERNOR_VERSION = '1.0.0';

export const MATTER_QUALITY_MODES = Object.freeze([
    'auto', 'performance', 'balanced', 'quality', 'scientific',
]);

export const MATTER_PHYSICAL_TIERS = Object.freeze(['R', 'K', 'F', 'B', 'X']);

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;
const MODES = new Set(MATTER_QUALITY_MODES);
const TIERS = new Set(MATTER_PHYSICAL_TIERS);
const ERROR_KEYS = Object.freeze([
    'density', 'divergence', 'vorticity', 'velocityGradient', 'surface',
    'neighborDeficiency', 'contact', 'stress', 'temperature', 'phase', 'topology',
]);
const CRITICAL_FLAGS = Object.freeze([
    'nearContact', 'predictedImpact', 'phaseTransition', 'fractureFront', 'selected',
]);

const MODE_PROFILES = Object.freeze({
    auto: Object.freeze({
        baseTier: 'high', spatialScale: 1, temporalScale: 1,
        solverIterations: 6, materialComplexity: 0.8, surfaceQuality: 0.8,
        secondaryQuality: 0.65, collisionQuality: 0.85,
        refineThreshold: 0.42, mergeThreshold: 0.14,
    }),
    performance: Object.freeze({
        baseTier: 'performance', spatialScale: 0.55, temporalScale: 0.55,
        solverIterations: 3, materialComplexity: 0.45, surfaceQuality: 0.45,
        secondaryQuality: 0.2, collisionQuality: 0.65,
        refineThreshold: 0.66, mergeThreshold: 0.24,
    }),
    balanced: Object.freeze({
        baseTier: 'balanced', spatialScale: 0.75, temporalScale: 0.75,
        solverIterations: 5, materialComplexity: 0.65, surfaceQuality: 0.65,
        secondaryQuality: 0.45, collisionQuality: 0.75,
        refineThreshold: 0.52, mergeThreshold: 0.18,
    }),
    quality: Object.freeze({
        baseTier: 'high', spatialScale: 1, temporalScale: 1,
        solverIterations: 8, materialComplexity: 0.9, surfaceQuality: 0.95,
        secondaryQuality: 0.85, collisionQuality: 0.95,
        refineThreshold: 0.34, mergeThreshold: 0.1,
    }),
    scientific: Object.freeze({
        baseTier: 'ultra', spatialScale: 1, temporalScale: 1,
        solverIterations: 12, materialComplexity: 1, surfaceQuality: 1,
        secondaryQuality: 1, collisionQuality: 1,
        refineThreshold: 0.24, mergeThreshold: 0.06,
    }),
});

const AUTO_PROFILE_BY_ENGINE_TIER = Object.freeze({
    ultra: 'scientific',
    high: 'quality',
    balanced: 'balanced',
    performance: 'performance',
    emergency: 'performance',
});

function resolveModeProfile(qualityModeValue, engineTier) {
    const profileName = qualityModeValue === 'auto'
        ? AUTO_PROFILE_BY_ENGINE_TIER[engineTier]
        : qualityModeValue;
    if (!profileName || !Object.hasOwn(MODE_PROFILES, profileName)) {
        fail('$.engineTier', `cannot resolve a Matter profile for '${engineTier}'`);
    }
    return Object.freeze({ name: profileName, profile: MODE_PROFILES[profileName] });
}

const ERROR_WEIGHTS = Object.freeze({
    density: 1.2,
    divergence: 1.15,
    vorticity: 0.55,
    velocityGradient: 0.75,
    surface: 1.05,
    neighborDeficiency: 1.1,
    contact: 1.4,
    stress: 1.3,
    temperature: 0.7,
    phase: 1.35,
    topology: 1.5,
});

const SNAPSHOT_KEYS = new Set([
    'schema', 'schemaVersion', 'configuration', 'frameIndex', 'lastDecisionSequence',
    'recentFrames', 'regionResidency', 'metrics',
]);
const CONFIGURATION_KEYS = new Set([
    'qualityMode', 'targetFrameMs', 'targetSimulationMs', 'vramHeadroomFraction',
    'physicalErrorTolerance', 'surfaceErrorTolerance', 'refinementAggressiveness',
    'mergeAggressiveness', 'predictiveRefinement', 'representationTranscoding',
    'conservationValidation', 'deterministicReplay', 'minimumResidencyFrames',
    'splitCooldownFrames', 'mergeCooldownFrames', 'maximumRefinementsPerFrame',
    'maximumMergesPerFrame', 'maximumPromotionsPerFrame', 'maximumBytesPerFrame',
]);

function fail(path, message) {
    throw new TypeError(`${path}: ${message}`);
}

function safeOptions(value) {
    if (!isPlainJsonObject(value)) fail('$.options', 'must be a plain object');
    const result = {};
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string') fail('$.options', 'symbol keys are not supported');
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
            fail(`$.options.${key}`, 'must be an enumerable data property');
        }
        result[key] = descriptor.value;
    }
    return result;
}

function exactObject(value, keys, path) {
    if (!isPlainJsonObject(value)) fail(path, 'must be a plain object');
    for (const key of Object.keys(value)) {
        if (!keys.has(key)) fail(`${path}.${key}`, 'unknown field');
    }
    return value;
}

function finite(value, path, { minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE } = {}) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
        fail(path, `must be finite in [${minimum}, ${maximum}]`);
    }
    return value;
}

function integer(value, path, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        fail(path, `must be a safe integer in [${minimum}, ${maximum}]`);
    }
    return value;
}

function boolean(value, path) {
    if (typeof value !== 'boolean') fail(path, 'must be boolean');
    return value;
}

function identifier(value, path) {
    if (typeof value !== 'string' || !IDENTIFIER.test(value)) fail(path, 'has invalid identifier syntax');
    return value;
}

function qualityMode(value, path = '$.qualityMode') {
    if (typeof value !== 'string' || !MODES.has(value)) fail(path, 'is unsupported');
    return value;
}

function configurationFrom(options) {
    return {
        qualityMode: qualityMode(options.qualityMode ?? 'auto'),
        targetFrameMs: finite(options.targetFrameMs ?? (1000 / 60), '$.targetFrameMs', { minimum: 0.1 }),
        targetSimulationMs: finite(options.targetSimulationMs ?? 8, '$.targetSimulationMs', { minimum: 0.1 }),
        vramHeadroomFraction: finite(options.vramHeadroomFraction ?? 0.2, '$.vramHeadroomFraction', { minimum: 0, maximum: 0.95 }),
        physicalErrorTolerance: finite(options.physicalErrorTolerance ?? 0.02, '$.physicalErrorTolerance', { minimum: Number.MIN_VALUE }),
        surfaceErrorTolerance: finite(options.surfaceErrorTolerance ?? 0.015, '$.surfaceErrorTolerance', { minimum: Number.MIN_VALUE }),
        refinementAggressiveness: finite(options.refinementAggressiveness ?? 1, '$.refinementAggressiveness', { minimum: 0.05, maximum: 8 }),
        mergeAggressiveness: finite(options.mergeAggressiveness ?? 1, '$.mergeAggressiveness', { minimum: 0.05, maximum: 8 }),
        predictiveRefinement: boolean(options.predictiveRefinement ?? true, '$.predictiveRefinement'),
        representationTranscoding: boolean(options.representationTranscoding ?? true, '$.representationTranscoding'),
        conservationValidation: boolean(options.conservationValidation ?? true, '$.conservationValidation'),
        deterministicReplay: boolean(options.deterministicReplay ?? true, '$.deterministicReplay'),
        minimumResidencyFrames: integer(options.minimumResidencyFrames ?? 24, '$.minimumResidencyFrames', { maximum: 1_000_000 }),
        splitCooldownFrames: integer(options.splitCooldownFrames ?? 12, '$.splitCooldownFrames', { maximum: 1_000_000 }),
        mergeCooldownFrames: integer(options.mergeCooldownFrames ?? 36, '$.mergeCooldownFrames', { maximum: 1_000_000 }),
        maximumRefinementsPerFrame: integer(options.maximumRefinementsPerFrame ?? 64, '$.maximumRefinementsPerFrame', { minimum: 1, maximum: 1_000_000 }),
        maximumMergesPerFrame: integer(options.maximumMergesPerFrame ?? 64, '$.maximumMergesPerFrame', { minimum: 1, maximum: 1_000_000 }),
        maximumPromotionsPerFrame: integer(options.maximumPromotionsPerFrame ?? 128, '$.maximumPromotionsPerFrame', { minimum: 1, maximum: 1_000_000 }),
        maximumBytesPerFrame: integer(options.maximumBytesPerFrame ?? (32 * 1024 * 1024), '$.maximumBytesPerFrame', { minimum: 1 }),
    };
}

function validateConfiguration(value, path = '$.configuration') {
    exactObject(value, CONFIGURATION_KEYS, path);
    for (const key of CONFIGURATION_KEYS) {
        if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, 'is required');
    }
    return configurationFrom(value);
}

function normalizedError(value, path) {
    const source = value ?? {};
    if (!isPlainJsonObject(source)) fail(path, 'must be a plain object');
    for (const key of Object.keys(source)) {
        if (!ERROR_KEYS.includes(key)) fail(`${path}.${key}`, 'unknown error channel');
    }
    return Object.fromEntries(ERROR_KEYS.map(key => [
        key,
        finite(source[key] ?? 0, `${path}.${key}`, { minimum: 0, maximum: 1_000_000 }),
    ]));
}

function normalizedFlags(value, path) {
    const source = value ?? {};
    if (!isPlainJsonObject(source)) fail(path, 'must be a plain object');
    for (const key of Object.keys(source)) {
        if (!CRITICAL_FLAGS.includes(key)) fail(`${path}.${key}`, 'unknown flag');
    }
    return Object.fromEntries(CRITICAL_FLAGS.map(key => [
        key,
        boolean(source[key] ?? false, `${path}.${key}`),
    ]));
}

const FRAME_SAMPLE_KEYS = new Set([
    'cpuMs', 'gpuMs', 'frameMs', 'totalMs', 'nowMs', 'passTimes',
    'gpuSamplePending', 'queueDepth', 'queueCapacity', 'queueThrottled', 'gpuTimingAvailable',
    'vramBytes', 'vramBudgetBytes', 'presentationMs', 'displayIntervalMs',
    'queueCompletionWallMs',
]);

function normalizeFrameSample(input, path = '$.frameSample', { memoryPressure = false } = {}) {
    const source = cloneStrictJson(input, path);
    if (!isPlainJsonObject(source)) fail(path, 'must be a plain object');
    const allowed = memoryPressure ? new Set([...FRAME_SAMPLE_KEYS, 'memoryPressure']) : FRAME_SAMPLE_KEYS;
    for (const key of Object.keys(source)) {
        if (!allowed.has(key)) fail(`${path}.${key}`, 'unknown field');
    }
    const result = {};
    for (const key of [
        'cpuMs', 'gpuMs', 'frameMs', 'totalMs', 'nowMs', 'vramBytes',
        'vramBudgetBytes', 'presentationMs', 'displayIntervalMs',
        'queueCompletionWallMs',
    ]) {
        if (Object.hasOwn(source, key)) result[key] = finite(source[key], `${path}.${key}`, { minimum: 0 });
    }
    for (const key of ['gpuSamplePending', 'queueDepth', 'queueCapacity']) {
        if (Object.hasOwn(source, key)) result[key] = integer(source[key], `${path}.${key}`);
    }
    for (const key of ['queueThrottled', 'gpuTimingAvailable']) {
        if (Object.hasOwn(source, key)) result[key] = boolean(source[key], `${path}.${key}`);
    }
    if (Object.hasOwn(source, 'passTimes')) {
        if (!isPlainJsonObject(source.passTimes)) fail(`${path}.passTimes`, 'must be a plain object');
        result.passTimes = {};
        for (const [name, value] of Object.entries(source.passTimes)) {
            identifier(name, `${path}.passTimes key`);
            result.passTimes[name] = finite(value, `${path}.passTimes.${name}`, { minimum: 0 });
        }
    }
    if (memoryPressure) {
        if (!['normal', 'warning', 'critical'].includes(source.memoryPressure)) {
            fail(`${path}.memoryPressure`, 'must be normal, warning, or critical');
        }
        result.memoryPressure = source.memoryPressure;
    }
    return result;
}

function normalizedCandidate(input, index) {
    const path = `$.candidates[${index}]`;
    const value = cloneStrictJson(input, path);
    const keys = new Set([
        'regionId', 'sourceRevision', 'representationRevision', 'currentLevel',
        'minimumLevel', 'maximumLevel', 'residencyFrames', 'lastSplitFrame',
        'lastMergeFrame', 'physicalTier', 'visible', 'timeToImpactS', 'error',
        'flags', 'estimatedSplitBytes', 'estimatedSolverCostMs', 'currentTimeBin',
    ]);
    exactObject(value, keys, path);
    identifier(value.regionId, `${path}.regionId`);
    const currentLevel = integer(value.currentLevel, `${path}.currentLevel`, { maximum: 31 });
    const minimumLevel = integer(value.minimumLevel ?? 0, `${path}.minimumLevel`, { maximum: 31 });
    const maximumLevel = integer(value.maximumLevel ?? 31, `${path}.maximumLevel`, { maximum: 31 });
    if (minimumLevel > currentLevel || currentLevel > maximumLevel) {
        fail(path, 'requires minimumLevel <= currentLevel <= maximumLevel');
    }
    const tier = value.physicalTier ?? 'K';
    if (!TIERS.has(tier)) fail(`${path}.physicalTier`, 'is unsupported');
    return {
        regionId: value.regionId,
        sourceRevision: integer(value.sourceRevision, `${path}.sourceRevision`),
        representationRevision: integer(value.representationRevision, `${path}.representationRevision`),
        currentLevel,
        minimumLevel,
        maximumLevel,
        residencyFrames: integer(value.residencyFrames ?? 0, `${path}.residencyFrames`),
        lastSplitFrame: integer(value.lastSplitFrame ?? 0, `${path}.lastSplitFrame`),
        lastMergeFrame: integer(value.lastMergeFrame ?? 0, `${path}.lastMergeFrame`),
        physicalTier: tier,
        visible: boolean(value.visible ?? true, `${path}.visible`),
        timeToImpactS: value.timeToImpactS == null
            ? null
            : finite(value.timeToImpactS, `${path}.timeToImpactS`, { minimum: 0 }),
        error: normalizedError(value.error, `${path}.error`),
        flags: normalizedFlags(value.flags, `${path}.flags`),
        estimatedSplitBytes: integer(value.estimatedSplitBytes ?? 0, `${path}.estimatedSplitBytes`),
        estimatedSolverCostMs: finite(value.estimatedSolverCostMs ?? 0, `${path}.estimatedSolverCostMs`, { minimum: 0 }),
        currentTimeBin: integer(value.currentTimeBin ?? 0, `${path}.currentTimeBin`, { maximum: 30 }),
    };
}

function weightedScore(candidate, configuration) {
    let sum = 0;
    let maximum = 0;
    for (const key of ERROR_KEYS) {
        const tolerance = key === 'surface'
            ? configuration.surfaceErrorTolerance
            : configuration.physicalErrorTolerance;
        const normalized = candidate.error[key] / tolerance;
        const weighted = normalized * ERROR_WEIGHTS[key];
        sum += weighted;
        maximum = Math.max(maximum, weighted);
    }
    let score = (maximum * 0.7 + (sum / ERROR_KEYS.length) * 0.3)
        * configuration.refinementAggressiveness;
    if (candidate.visible) score *= 1.08;
    if (candidate.flags.selected) score += 4;
    if (candidate.flags.nearContact) score += 3;
    if (candidate.flags.fractureFront) score += 5;
    if (candidate.flags.phaseTransition) score += 4;
    if (configuration.predictiveRefinement && candidate.flags.predictedImpact) score += 4;
    if (configuration.predictiveRefinement && candidate.timeToImpactS !== null) {
        score += Math.max(0, 1 - candidate.timeToImpactS / 0.5) * 3;
    }
    return score;
}

function freezeDecision(value) {
    return deepFreezeJson(value, '$.matterFidelityDecision');
}

/**
 * Chooses bounded spatial and temporal work without ever deleting canonical mass.
 * Every action is revision-bound so callers can reject a stale plan atomically.
 */
export class MatterFidelityGovernor {
    #configuration;
    #base;
    #logger;
    #frameIndex = 0;
    #lastDecisionSequence = 0;
    #recentFrames = [];
    #regionResidency = new Map();
    #metrics = {
        plans: 0,
        refinements: 0,
        merges: 0,
        promotions: 0,
        deferred: 0,
        rejected: 0,
        memoryPressureFrames: 0,
    };

    constructor(optionsInput = {}) {
        const options = safeOptions(optionsInput);
        const allowed = new Set([...CONFIGURATION_KEYS, 'logger', 'baseGovernor', 'snapshot']);
        for (const key of Object.keys(options)) {
            if (!allowed.has(key)) fail(`$.options.${key}`, 'unknown field');
        }
        if (options.logger != null && typeof options.logger !== 'function') {
            fail('$.options.logger', 'must be a function or null');
        }
        if (options.baseGovernor != null && !(options.baseGovernor instanceof AdaptiveQualityGovernor)) {
            fail('$.options.baseGovernor', 'must be an AdaptiveQualityGovernor');
        }
        this.#logger = options.logger ?? null;
        this.#configuration = configurationFrom(options);
        this.#base = options.baseGovernor ?? this.#createBaseGovernor();
        this.#applyModeToBase();
        this.#log('matter-fidelity-initialize', { configuration: this.#configuration });
        if (options.snapshot != null) this.restore(options.snapshot);
    }

    #log(type, details = {}) {
        try {
            this.#logger?.(Object.freeze({ type, ...details }));
        } catch (_error) {
            // Diagnostics never gain simulation authority.
        }
    }

    #createBaseGovernor() {
        return new AdaptiveQualityGovernor({
            targetFrameMs: this.#configuration.targetFrameMs,
            mode: this.#configuration.qualityMode === 'auto' ? 'auto' : 'fixed',
            tier: MODE_PROFILES[this.#configuration.qualityMode].baseTier,
            logger: event => this.#log('matter-fidelity-base-event', { event }),
        });
    }

    #applyModeToBase() {
        const mode = this.#configuration.qualityMode;
        const profile = MODE_PROFILES[mode];
        if (Math.abs(this.#base.targetFrameMs - this.#configuration.targetFrameMs) > 1e-9) {
            this.#base.setTargetFPS(1000 / this.#configuration.targetFrameMs);
        }
        const current = this.#base.getDecision();
        if (mode === 'auto') {
            if (current.mode !== 'auto') this.#base.setMode('auto');
            return;
        }
        if (current.mode !== 'fixed' || current.name !== profile.baseTier) {
            this.#base.setMode('fixed', profile.baseTier);
        }
    }

    get configuration() {
        return cloneAndFreezeStrictJson(this.#configuration, '$.configuration');
    }

    setConfiguration(patchInput) {
        this.#log('matter-fidelity-configure-start');
        const patch = cloneStrictJson(patchInput, '$.configurationPatch');
        if (!isPlainJsonObject(patch)) fail('$.configurationPatch', 'must be a plain object');
        for (const key of Object.keys(patch)) {
            if (!CONFIGURATION_KEYS.has(key)) fail(`$.configurationPatch.${key}`, 'unknown field');
        }
        this.#configuration = validateConfiguration({ ...this.#configuration, ...patch });
        this.#applyModeToBase();
        const configuration = this.configuration;
        this.#log('matter-fidelity-configured', { configuration });
        return configuration;
    }

    recordFrame(sampleInput = {}) {
        this.#log('matter-fidelity-frame-start', { nextFrameIndex: this.#frameIndex + 1 });
        const sample = normalizeFrameSample(sampleInput);
        const vramBytes = finite(sample.vramBytes ?? 0, '$.frameSample.vramBytes', { minimum: 0 });
        const vramBudgetBytes = finite(sample.vramBudgetBytes ?? 0, '$.frameSample.vramBudgetBytes', { minimum: 0 });
        const usedFraction = vramBudgetBytes > 0 ? vramBytes / vramBudgetBytes : 0;
        const memoryPressure = usedFraction >= 1 - this.#configuration.vramHeadroomFraction
            ? (usedFraction >= 0.98 ? 'critical' : 'warning')
            : 'normal';
        if (memoryPressure !== 'normal') this.#metrics.memoryPressureFrames += 1;
        const baseSample = {
            ...sample,
            memoryPressure,
        };
        delete baseSample.vramBytes;
        delete baseSample.vramBudgetBytes;
        const baseDecision = this.#base.recordFrame(baseSample);
        const resolvedProfile = resolveModeProfile(this.#configuration.qualityMode, baseDecision.name);
        this.#frameIndex += 1;
        const retainedSample = {
            ...sample,
            vramBytes,
            vramBudgetBytes,
            memoryPressure,
        };
        this.#recentFrames.push(retainedSample);
        if (this.#recentFrames.length > 64) this.#recentFrames.shift();
        const decision = freezeDecision({
            schema: 'engine.matter.fidelity-frame-decision',
            schemaVersion: '1.0.0',
            frameIndex: this.#frameIndex,
            memoryPressure,
            usedVramFraction: usedFraction,
            qualityMode: this.#configuration.qualityMode,
            engineTier: baseDecision.name,
            effectiveMatterProfile: resolvedProfile.name,
            targetFrameMs: this.#configuration.targetFrameMs,
            targetSimulationMs: this.#configuration.targetSimulationMs,
        });
        this.#log('matter-fidelity-frame', decision);
        return decision;
    }

    plan(candidatesInput, budgetInput = {}) {
        this.#log('matter-fidelity-plan-start', { frameIndex: this.#frameIndex });
        try {
            const candidates = cloneStrictJson(candidatesInput, '$.candidates');
            if (!Array.isArray(candidates)) fail('$.candidates', 'must be an array');
            if (candidates.length > 1_000_000) fail('$.candidates', 'exceeds the bounded candidate limit');
            const normalized = candidates.map(normalizedCandidate);
            const regionIds = new Set();
            for (const candidate of normalized) {
                if (regionIds.has(candidate.regionId)) fail('$.candidates', `duplicates region '${candidate.regionId}'`);
                regionIds.add(candidate.regionId);
            }
            const budget = cloneStrictJson(budgetInput, '$.budget');
            const budgetKeys = new Set(['availablePacketSlots', 'availableBytes', 'availableSimulationMs']);
            exactObject(budget, budgetKeys, '$.budget');
            const availablePacketSlots = integer(
                budget.availablePacketSlots ?? Number.MAX_SAFE_INTEGER,
                '$.budget.availablePacketSlots',
            );
            const availableBytes = Math.min(
                integer(budget.availableBytes ?? this.#configuration.maximumBytesPerFrame, '$.budget.availableBytes'),
                this.#configuration.maximumBytesPerFrame,
            );
            const availableSimulationMs = finite(
                budget.availableSimulationMs ?? this.#configuration.targetSimulationMs,
                '$.budget.availableSimulationMs',
                { minimum: 0 },
            );
            const base = this.#base.getDecision();
            const resolvedProfile = resolveModeProfile(this.#configuration.qualityMode, base.name);
            const profile = resolvedProfile.profile;
            const tierPressureScale = base.name === 'emergency' ? 1.8
                : base.name === 'performance' ? 1.35
                    : base.name === 'balanced' ? 1.1 : 1;
            const latest = this.#recentFrames[this.#recentFrames.length - 1];
            const memoryPressure = latest?.memoryPressure ?? 'normal';
            const refineThreshold = profile.refineThreshold * tierPressureScale
                * (memoryPressure === 'critical' ? 4 : memoryPressure === 'warning' ? 1.8 : 1);
            const mergeThreshold = profile.mergeThreshold * this.#configuration.mergeAggressiveness
                * (memoryPressure === 'critical' ? 3 : memoryPressure === 'warning' ? 1.7 : 1);

            const scored = normalized.map(candidate => ({
                candidate,
                score: weightedScore(candidate, this.#configuration),
            }));
            const refinements = scored
                .filter(({ candidate, score }) => (
                    score >= refineThreshold
                    && candidate.currentLevel < candidate.maximumLevel
                    && this.#frameIndex - candidate.lastMergeFrame >= this.#configuration.splitCooldownFrames
                ))
                .sort((left, right) => right.score - left.score
                    || left.candidate.regionId.localeCompare(right.candidate.regionId));
            const merges = scored
                .filter(({ candidate, score }) => (
                    score <= mergeThreshold
                    && candidate.currentLevel > candidate.minimumLevel
                    && candidate.residencyFrames >= this.#configuration.minimumResidencyFrames
                    && this.#frameIndex - candidate.lastSplitFrame >= this.#configuration.mergeCooldownFrames
                    && !CRITICAL_FLAGS.some(key => candidate.flags[key])
                ))
                .sort((left, right) => left.score - right.score
                    || left.candidate.regionId.localeCompare(right.candidate.regionId));

            let remainingSlots = availablePacketSlots;
            let remainingBytes = availableBytes;
            let remainingSimulationMs = availableSimulationMs;
            const actions = [];
            const deferredRegions = new Set();
            let promotionCount = 0;
            const markDeferred = candidate => {
                if (deferredRegions.has(candidate.regionId)) return;
                deferredRegions.add(candidate.regionId);
                this.#metrics.deferred += 1;
            };
            const appendAction = (candidate, action) => {
                const promotesFidelity = action.physicalTier !== candidate.physicalTier
                    || action.timeBin < candidate.currentTimeBin;
                if (promotesFidelity && promotionCount >= this.#configuration.maximumPromotionsPerFrame) {
                    markDeferred(candidate);
                    return false;
                }
                if (promotesFidelity) promotionCount += 1;
                actions.push(action);
                return true;
            };
            for (const { candidate, score } of refinements) {
                if (actions.filter(action => action.spatialAction === 'split').length
                    >= this.#configuration.maximumRefinementsPerFrame) break;
                const slots = 7;
                if (remainingSlots < slots
                    || remainingBytes < candidate.estimatedSplitBytes
                    || remainingSimulationMs < candidate.estimatedSolverCostMs) {
                    markDeferred(candidate);
                    continue;
                }
                const action = this.#action(candidate, score, 'split', 0, profile, refineThreshold);
                if (!appendAction(candidate, action)) continue;
                remainingSlots -= slots;
                remainingBytes -= candidate.estimatedSplitBytes;
                remainingSimulationMs -= candidate.estimatedSolverCostMs;
            }
            const selected = new Set(actions.map(action => action.regionId));
            for (const { candidate, score } of merges) {
                if (actions.filter(action => action.spatialAction === 'merge').length
                    >= this.#configuration.maximumMergesPerFrame) break;
                if (selected.has(candidate.regionId)) continue;
                appendAction(
                    candidate,
                    this.#action(
                        candidate,
                        score,
                        'merge',
                        Math.min(30, candidate.currentTimeBin + 1),
                        profile,
                        refineThreshold,
                    ),
                );
            }
            for (const { candidate, score } of scored
                .filter(entry => !selected.has(entry.candidate.regionId))
                .sort((left, right) => right.score - left.score
                    || left.candidate.regionId.localeCompare(right.candidate.regionId))) {
                if (actions.some(action => action.regionId === candidate.regionId)) continue;
                const urgent = score >= refineThreshold || CRITICAL_FLAGS.some(key => candidate.flags[key]);
                const nextTimeBin = urgent ? 0 : Math.min(30, candidate.currentTimeBin + (score <= mergeThreshold ? 1 : 0));
                const action = this.#action(
                    candidate,
                    score,
                    'retain',
                    nextTimeBin,
                    profile,
                    refineThreshold,
                );
                if (!appendAction(candidate, action)) {
                    actions.push({
                        ...this.#action(
                            candidate,
                            score,
                            'retain',
                            candidate.currentTimeBin,
                            profile,
                            refineThreshold,
                        ),
                        physicalTier: candidate.physicalTier,
                    });
                }
            }

            const splitCount = actions.filter(action => action.spatialAction === 'split').length;
            const mergeCount = actions.filter(action => action.spatialAction === 'merge').length;
            this.#metrics.plans += 1;
            this.#metrics.refinements += splitCount;
            this.#metrics.merges += mergeCount;
            this.#metrics.promotions += promotionCount;
            this.#lastDecisionSequence += 1;
            for (const action of actions) this.#regionResidency.set(action.regionId, action.residencyFrames);
            const decision = freezeDecision({
                schema: 'engine.matter.fidelity-plan',
                schemaVersion: '1.0.0',
                decisionId: `matter-fidelity.${this.#lastDecisionSequence}`,
                frameIndex: this.#frameIndex,
                qualityMode: this.#configuration.qualityMode,
                engineTier: base.name,
                effectiveMatterProfile: resolvedProfile.name,
                actions,
                budget: {
                    availablePacketSlots,
                    availableBytes,
                    availableSimulationMs,
                    remainingPacketSlots: remainingSlots,
                    remainingBytes,
                    remainingSimulationMs,
                },
                summary: {
                    candidateCount: normalized.length,
                    splitCount,
                    mergeCount,
                    retainedCount: actions.length - splitCount - mergeCount,
                    deferredCount: deferredRegions.size,
                },
            });
            this.#log('matter-fidelity-plan', { decisionId: decision.decisionId, summary: decision.summary });
            return decision;
        } catch (error) {
            this.#metrics.rejected += 1;
            this.#log('matter-fidelity-plan-failed', { message: error.message });
            throw error;
        }
    }

    #action(candidate, score, spatialAction, timeBin, profile, refineThreshold) {
        const tierIndex = MATTER_PHYSICAL_TIERS.indexOf(candidate.physicalTier);
        const highDetail = score >= refineThreshold;
        const physicalTier = highDetail && tierIndex < MATTER_PHYSICAL_TIERS.length - 1
            ? MATTER_PHYSICAL_TIERS[tierIndex + 1]
            : candidate.physicalTier;
        return {
            regionId: candidate.regionId,
            sourceRevision: candidate.sourceRevision,
            representationRevision: candidate.representationRevision,
            score,
            spatialAction,
            requestedLevel: spatialAction === 'split'
                ? candidate.currentLevel + 1
                : spatialAction === 'merge' ? candidate.currentLevel - 1 : candidate.currentLevel,
            physicalTier,
            timeBin,
            solverIterations: Math.max(1, Math.round(profile.solverIterations / (2 ** timeBin))),
            spatialScale: profile.spatialScale,
            temporalScale: profile.temporalScale,
            materialComplexity: profile.materialComplexity,
            surfaceQuality: profile.surfaceQuality,
            secondaryQuality: profile.secondaryQuality,
            collisionQuality: profile.collisionQuality,
            residencyFrames: candidate.residencyFrames + 1,
        };
    }

    snapshot() {
        return deepFreezeJson({
            schema: MATTER_FIDELITY_GOVERNOR_SCHEMA,
            schemaVersion: MATTER_FIDELITY_GOVERNOR_VERSION,
            configuration: cloneStrictJson(this.#configuration),
            frameIndex: this.#frameIndex,
            lastDecisionSequence: this.#lastDecisionSequence,
            recentFrames: cloneStrictJson(this.#recentFrames),
            regionResidency: Object.fromEntries([...this.#regionResidency.entries()].sort()),
            metrics: cloneStrictJson(this.#metrics),
        }, '$.matterFidelityGovernorSnapshot');
    }

    restore(snapshotInput) {
        this.#log('matter-fidelity-restore-start');
        try {
            const snapshot = validateMatterFidelityGovernorSnapshot(snapshotInput);
            const base = new AdaptiveQualityGovernor({
                targetFrameMs: snapshot.configuration.targetFrameMs,
                mode: snapshot.configuration.qualityMode === 'auto' ? 'auto' : 'fixed',
                tier: MODE_PROFILES[snapshot.configuration.qualityMode].baseTier,
                logger: event => this.#log('matter-fidelity-base-event', { event }),
            });
            for (const sample of snapshot.recentFrames) {
                const replay = { ...sample };
                delete replay.vramBytes;
                delete replay.vramBudgetBytes;
                base.recordFrame(replay);
            }
            this.#configuration = cloneStrictJson(snapshot.configuration);
            this.#base = base;
            this.#frameIndex = snapshot.frameIndex;
            this.#lastDecisionSequence = snapshot.lastDecisionSequence;
            this.#recentFrames = cloneStrictJson(snapshot.recentFrames);
            this.#regionResidency = new Map(Object.entries(snapshot.regionResidency));
            this.#metrics = cloneStrictJson(snapshot.metrics);
            this.#log('matter-fidelity-restored', { frameIndex: this.#frameIndex });
            return this;
        } catch (error) {
            this.#log('matter-fidelity-restore-failed', { message: error.message });
            throw error;
        }
    }

    stats() {
        return cloneAndFreezeStrictJson({
            ...this.#metrics,
            frameIndex: this.#frameIndex,
            lastDecisionSequence: this.#lastDecisionSequence,
            engine: this.#base.getStats(),
        }, '$.matterFidelityGovernorStats');
    }
}

export function validateMatterFidelityGovernorSnapshot(snapshotInput) {
    const snapshot = cloneStrictJson(snapshotInput, '$.matterFidelityGovernorSnapshot');
    exactObject(snapshot, SNAPSHOT_KEYS, '$.matterFidelityGovernorSnapshot');
    for (const key of SNAPSHOT_KEYS) {
        if (!Object.hasOwn(snapshot, key)) fail(`$.matterFidelityGovernorSnapshot.${key}`, 'is required');
    }
    if (snapshot.schema !== MATTER_FIDELITY_GOVERNOR_SCHEMA
        || snapshot.schemaVersion !== MATTER_FIDELITY_GOVERNOR_VERSION) {
        fail('$.matterFidelityGovernorSnapshot', 'uses an unsupported schema');
    }
    snapshot.configuration = validateConfiguration(snapshot.configuration);
    integer(snapshot.frameIndex, '$.matterFidelityGovernorSnapshot.frameIndex');
    integer(snapshot.lastDecisionSequence, '$.matterFidelityGovernorSnapshot.lastDecisionSequence');
    if (!Array.isArray(snapshot.recentFrames) || snapshot.recentFrames.length > 64) {
        fail('$.matterFidelityGovernorSnapshot.recentFrames', 'must contain at most 64 samples');
    }
    snapshot.recentFrames = snapshot.recentFrames.map((sample, index) => normalizeFrameSample(
        sample,
        `$.matterFidelityGovernorSnapshot.recentFrames[${index}]`,
        { memoryPressure: true },
    ));
    exactObject(snapshot.regionResidency, new Set(Object.keys(snapshot.regionResidency)), '$.matterFidelityGovernorSnapshot.regionResidency');
    for (const [regionId, frames] of Object.entries(snapshot.regionResidency)) {
        identifier(regionId, '$.matterFidelityGovernorSnapshot.regionResidency key');
        integer(frames, `$.matterFidelityGovernorSnapshot.regionResidency.${regionId}`);
    }
    const metricKeys = new Set([
        'plans', 'refinements', 'merges', 'promotions', 'deferred', 'rejected', 'memoryPressureFrames',
    ]);
    exactObject(snapshot.metrics, metricKeys, '$.matterFidelityGovernorSnapshot.metrics');
    for (const key of metricKeys) integer(snapshot.metrics[key], `$.matterFidelityGovernorSnapshot.metrics.${key}`);
    for (const key of ['predictiveRefinement', 'representationTranscoding', 'conservationValidation', 'deterministicReplay']) {
        boolean(snapshot.configuration[key], `$.matterFidelityGovernorSnapshot.configuration.${key}`);
    }
    return deepFreezeJson(snapshot, '$.matterFidelityGovernorSnapshot');
}

export function createMatterFidelityGovernor(options = {}) {
    return new MatterFidelityGovernor(options);
}

export default MatterFidelityGovernor;
