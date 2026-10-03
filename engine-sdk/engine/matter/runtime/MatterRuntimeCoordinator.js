// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Deterministic frame orchestration, diagnostics, replay, and device recreation for Matter. */

import {
    cloneAndFreezeStrictJson,
    cloneStrictJson,
    deepFreezeJson,
    isPlainJsonObject,
} from '../../core/schema/StrictJsonValue.js';

export const MATTER_FRAME_STAGES = Object.freeze([
    'apply-fields',
    'predict-positions',
    'calculate-spatial-keys',
    'stable-spatial-sort',
    'build-cell-ranges',
    'query-neighbors',
    'solve-physical-models',
    'solve-bonds-damage',
    'estimate-refinement-error',
    'mark-representation-candidates',
    'scan-allocations',
    'transcode-packets',
    'validate-conservation',
    'rebuild-fracture-connectivity',
    'classify-packets',
    'prepare-render-data',
    'encode-compact-diagnostics',
]);

export const MATTER_REPLAY_CHECKPOINT_SCHEMA = 'engine.matter.replay-checkpoint';
export const MATTER_REPLAY_CHECKPOINT_VERSION = '1.0.0';
export const MATTER_BENCHMARK_REPORT_SCHEMA = 'engine.matter.benchmark-report';
export const MATTER_BENCHMARK_REPORT_VERSION = '1.0.0';
export const MATTER_FRAME_DIAGNOSTICS_RECEIPT_SCHEMA =
    'engine.matter.frame-diagnostics-receipt';
export const MATTER_FRAME_DIAGNOSTICS_RECEIPT_VERSION = '1.0.0';

const STAGES = new Set(MATTER_FRAME_STAGES);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;
const FRAME_ADMISSION_STATES = new Set([
    'admitted', 'rejected', 'disabled', 'warming', 'unreported',
]);

function fail(path, message) {
    throw new TypeError(`${path}: ${message}`);
}

function identifier(value, path) {
    if (typeof value !== 'string' || !IDENTIFIER.test(value)) fail(path, 'has invalid identifier syntax');
    return value;
}

function integer(value, path, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        fail(path, `must be a safe integer in [${minimum}, ${maximum}]`);
    }
    return value;
}

function finite(value, path, { minimum = -Number.MAX_VALUE } = {}) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
        fail(path, `must be finite and >= ${minimum}`);
    }
    return value;
}

function boolean(value, path) {
    if (typeof value !== 'boolean') fail(path, 'must be boolean');
    return value;
}

function boundedText(value, path, { nullable = false, maximumLength = 2048 } = {}) {
    if (nullable && value == null) return null;
    if (typeof value !== 'string' || value.length > maximumLength) {
        fail(path, `must be a string no longer than ${maximumLength} characters`);
    }
    return value;
}

function finiteRange(value, path, minimum, maximum) {
    const result = finite(value, path, { minimum });
    if (result > maximum) fail(path, `must be <= ${maximum}`);
    return result;
}

function errorList(value, path) {
    if (!Array.isArray(value) || value.length > 64) {
        fail(path, 'must be an array of at most 64 messages');
    }
    return value.map((message, index) => boundedText(
        message,
        `${path}[${index}]`,
        { maximumLength: 2048 },
    ));
}

function exactObject(value, keys, path) {
    if (!isPlainJsonObject(value)) fail(path, 'must be a plain object');
    for (const key of Object.keys(value)) {
        if (!keys.has(key)) fail(`${path}.${key}`, 'unknown field');
    }
    return value;
}

function safeOptions(value, allowed, path = '$.options') {
    if (!isPlainJsonObject(value)) fail(path, 'must be a plain object');
    const result = {};
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string' || !allowed.has(key)) fail(`${path}.${String(key)}`, 'unknown field');
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
            fail(`${path}.${key}`, 'must be an enumerable data property');
        }
        result[key] = descriptor.value;
    }
    return result;
}

function nowMs() {
    return globalThis.performance?.now?.() ?? Date.now();
}

function percentile(sorted, fraction) {
    if (sorted.length === 0) return 0;
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!isPlainJsonObject(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

async function sha256(value) {
    if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable');
    const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function callLogger(logger, type, details = {}) {
    try {
        logger?.(Object.freeze({ type, ...details }));
    } catch (_error) {
        // Observability is deliberately outside simulation authority.
    }
}

function normalizeFrameDiagnosticsContext(contextInput) {
    const context = cloneStrictJson(contextInput, '$.frameDiagnosticsContext');
    exactObject(context, new Set([
        'frame', 'device', 'authority', 'workload', 'admission', 'timing',
        'quality', 'errors', 'metadata', 'encodeReceipt',
    ]), '$.frameDiagnosticsContext');

    const frame = context.frame ?? {};
    exactObject(frame, new Set([
        'frameId', 'frameSequence', 'sourceRevision', 'representationRevision',
        'deviceGeneration',
    ]), '$.frameDiagnosticsContext.frame');
    const normalizedFrame = {
        frameId: identifier(frame.frameId, '$.frameDiagnosticsContext.frame.frameId'),
        frameSequence: integer(
            frame.frameSequence,
            '$.frameDiagnosticsContext.frame.frameSequence',
            { minimum: 1 },
        ),
        sourceRevision: integer(
            frame.sourceRevision,
            '$.frameDiagnosticsContext.frame.sourceRevision',
        ),
        representationRevision: integer(
            frame.representationRevision,
            '$.frameDiagnosticsContext.frame.representationRevision',
        ),
        deviceGeneration: integer(
            frame.deviceGeneration,
            '$.frameDiagnosticsContext.frame.deviceGeneration',
        ),
    };

    const device = context.device ?? {};
    exactObject(device, new Set([
        'adapterKey', 'backend', 'featureLevel', 'compatibilityMode', 'fallbackAdapter',
    ]), '$.frameDiagnosticsContext.device');
    const normalizedDevice = {
        adapterKey: boundedText(
            device.adapterKey ?? 'unreported',
            '$.frameDiagnosticsContext.device.adapterKey',
            { maximumLength: 512 },
        ),
        backend: boundedText(
            device.backend ?? 'unknown',
            '$.frameDiagnosticsContext.device.backend',
            { maximumLength: 64 },
        ),
        featureLevel: boundedText(
            device.featureLevel ?? 'unknown',
            '$.frameDiagnosticsContext.device.featureLevel',
            { maximumLength: 64 },
        ),
        compatibilityMode: boolean(
            device.compatibilityMode ?? false,
            '$.frameDiagnosticsContext.device.compatibilityMode',
        ),
        fallbackAdapter: device.fallbackAdapter == null
            ? null
            : boolean(
                device.fallbackAdapter,
                '$.frameDiagnosticsContext.device.fallbackAdapter',
            ),
    };

    const authority = context.authority ?? {};
    exactObject(authority, new Set([
        'simulation', 'presentation', 'physicalHandoff', 'reason',
    ]), '$.frameDiagnosticsContext.authority');
    const normalizedAuthority = {
        simulation: boundedText(
            authority.simulation ?? 'unreported',
            '$.frameDiagnosticsContext.authority.simulation',
            { maximumLength: 128 },
        ),
        presentation: boundedText(
            authority.presentation ?? 'unreported',
            '$.frameDiagnosticsContext.authority.presentation',
            { maximumLength: 128 },
        ),
        physicalHandoff: boolean(
            authority.physicalHandoff ?? false,
            '$.frameDiagnosticsContext.authority.physicalHandoff',
        ),
        reason: boundedText(
            authority.reason ?? '',
            '$.frameDiagnosticsContext.authority.reason',
        ),
    };

    const workload = context.workload ?? {};
    const workloadCountKeys = [
        'activePackets', 'renderedSamples', 'allocatedPackets', 'pairCount',
        'substeps', 'dispatchCount', 'gpuBytes',
    ];
    const workloadScalarKeys = [
        'fixedStepSeconds', 'maximumStepSeconds', 'droppedSimulationSeconds',
    ];
    exactObject(workload, new Set([...workloadCountKeys, ...workloadScalarKeys]),
        '$.frameDiagnosticsContext.workload');
    const normalizedWorkload = Object.fromEntries(workloadCountKeys.map(key => [
        key,
        integer(workload[key] ?? 0, `$.frameDiagnosticsContext.workload.${key}`),
    ]));
    for (const key of workloadScalarKeys) {
        normalizedWorkload[key] = finite(
            workload[key] ?? 0,
            `$.frameDiagnosticsContext.workload.${key}`,
            { minimum: 0 },
        );
    }
    if (normalizedWorkload.maximumStepSeconds > 0
        && normalizedWorkload.fixedStepSeconds > normalizedWorkload.maximumStepSeconds) {
        fail(
            '$.frameDiagnosticsContext.workload.maximumStepSeconds',
            'must be zero/unreported or at least fixedStepSeconds',
        );
    }

    const admission = context.admission ?? {};
    exactObject(admission, new Set(['state', 'code', 'reason', 'numericBounds']),
        '$.frameDiagnosticsContext.admission');
    const admissionState = admission.state ?? 'unreported';
    if (!FRAME_ADMISSION_STATES.has(admissionState)) {
        fail('$.frameDiagnosticsContext.admission.state', 'has unsupported admission state');
    }
    const numericBounds = admission.numericBounds == null
        ? null
        : cloneStrictJson(
            admission.numericBounds,
            '$.frameDiagnosticsContext.admission.numericBounds',
        );
    if (numericBounds != null && !isPlainJsonObject(numericBounds)) {
        fail('$.frameDiagnosticsContext.admission.numericBounds', 'must be a plain object or null');
    }
    const normalizedAdmission = {
        state: admissionState,
        code: boundedText(
            admission.code ?? null,
            '$.frameDiagnosticsContext.admission.code',
            { nullable: true, maximumLength: 192 },
        ),
        reason: boundedText(
            admission.reason ?? null,
            '$.frameDiagnosticsContext.admission.reason',
            { nullable: true },
        ),
        numericBounds,
    };

    const timing = context.timing ?? {};
    const timingKeys = [
        'frameMs', 'simulationGpuMs', 'presentationGpuMs', 'readbackMs', 'cpuEncodeMs',
    ];
    exactObject(timing, new Set(timingKeys), '$.frameDiagnosticsContext.timing');
    const normalizedTiming = Object.fromEntries(timingKeys.map(key => [
        key,
        finite(timing[key] ?? 0, `$.frameDiagnosticsContext.timing.${key}`, { minimum: 0 }),
    ]));

    const quality = context.quality ?? {};
    const qualityScalarKeys = [
        'densityError', 'volumeLoss', 'maximumPositionM', 'clippedHdrFraction',
    ];
    const qualityCountKeys = [
        'escapedParticles', 'recycledParticles', 'proxyPromotions', 'proxyWakes',
        'proxyRebuilds', 'staleSamples',
    ];
    exactObject(quality, new Set([...qualityScalarKeys, ...qualityCountKeys]),
        '$.frameDiagnosticsContext.quality');
    const normalizedQuality = Object.fromEntries(qualityScalarKeys.map(key => [
        key,
        finite(quality[key] ?? 0, `$.frameDiagnosticsContext.quality.${key}`, { minimum: 0 }),
    ]));
    normalizedQuality.clippedHdrFraction = finiteRange(
        normalizedQuality.clippedHdrFraction,
        '$.frameDiagnosticsContext.quality.clippedHdrFraction',
        0,
        1,
    );
    for (const key of qualityCountKeys) {
        normalizedQuality[key] = integer(
            quality[key] ?? 0,
            `$.frameDiagnosticsContext.quality.${key}`,
        );
    }

    const errors = context.errors ?? {};
    const errorKeys = ['validation', 'outOfMemory', 'internal', 'uncaptured', 'deviceLoss'];
    exactObject(errors, new Set(errorKeys), '$.frameDiagnosticsContext.errors');
    const normalizedErrors = Object.fromEntries(errorKeys.map(key => [
        key,
        errorList(errors[key] ?? [], `$.frameDiagnosticsContext.errors.${key}`),
    ]));

    const metadata = context.metadata == null
        ? {}
        : cloneStrictJson(context.metadata, '$.frameDiagnosticsContext.metadata');
    if (!isPlainJsonObject(metadata)) {
        fail('$.frameDiagnosticsContext.metadata', 'must be a plain object');
    }

    const encodeReceipt = context.encodeReceipt == null
        ? null
        : cloneStrictJson(context.encodeReceipt, '$.frameDiagnosticsContext.encodeReceipt');
    if (encodeReceipt != null) {
        if (!isPlainJsonObject(encodeReceipt)
            || encodeReceipt.schema !== 'engine.matter.frame-encode-receipt'
            || encodeReceipt.schemaVersion !== '1.0.0') {
            fail('$.frameDiagnosticsContext.encodeReceipt', 'must be a version 1 Matter frame encode receipt');
        }
        for (const key of [
            'frameId', 'frameSequence', 'sourceRevision', 'representationRevision',
            'deviceGeneration',
        ]) {
            if (encodeReceipt[key] !== normalizedFrame[key]) {
                fail(`$.frameDiagnosticsContext.encodeReceipt.${key}`, 'does not match frame identity');
            }
        }
        if (encodeReceipt.mustDiscardEncoder !== false) {
            fail('$.frameDiagnosticsContext.encodeReceipt.mustDiscardEncoder',
                'must identify a successfully encoded frame');
        }
    }

    return {
        frame: normalizedFrame,
        device: normalizedDevice,
        authority: normalizedAuthority,
        workload: normalizedWorkload,
        admission: normalizedAdmission,
        timing: normalizedTiming,
        quality: normalizedQuality,
        errors: normalizedErrors,
        metadata,
        encodeReceipt,
    };
}

/**
 * Records the canonical seventeen-stage Matter frame into a caller-owned encoder.
 * A failed stage marks the encoder unusable; the caller must discard it instead of submitting.
 */
export class MatterFramePipeline {
    #stages = new Map();
    #logger;
    #frameSequence = 0;
    #deviceGeneration;
    #destroyed = false;
    #metrics = { encodedFrames: 0, rejectedFrames: 0, encodedStages: 0 };

    constructor(optionsInput = {}) {
        const options = safeOptions(optionsInput, new Set(['logger', 'deviceGeneration']));
        if (options.logger != null && typeof options.logger !== 'function') fail('$.options.logger', 'must be a function or null');
        this.#logger = options.logger ?? null;
        this.#deviceGeneration = integer(options.deviceGeneration ?? 0, '$.options.deviceGeneration');
        callLogger(this.#logger, 'matter-frame-pipeline-initialize', { deviceGeneration: this.#deviceGeneration });
    }

    registerStage(stageName, encode, optionsInput = {}) {
        if (this.#destroyed) throw new Error('MatterFramePipeline is destroyed');
        if (!STAGES.has(stageName)) fail('$.stageName', 'is unsupported');
        if (typeof encode !== 'function') fail('$.encode', 'must be a function');
        const options = safeOptions(optionsInput, new Set(['required', 'enabled']));
        const descriptor = Object.freeze({
            stageName,
            encode,
            required: options.required === true,
            enabled: options.enabled !== false,
        });
        this.#stages.set(stageName, descriptor);
        callLogger(this.#logger, 'matter-frame-stage-registered', { stageName, required: descriptor.required });
        return () => this.#stages.delete(stageName);
    }

    setStageEnabled(stageName, enabled) {
        if (!STAGES.has(stageName)) fail('$.stageName', 'is unsupported');
        if (typeof enabled !== 'boolean') fail('$.enabled', 'must be boolean');
        const current = this.#stages.get(stageName);
        if (!current) return false;
        this.#stages.set(stageName, Object.freeze({ ...current, enabled }));
        return true;
    }

    encode(encoder, contextInput = {}) {
        if (this.#destroyed) throw new Error('MatterFramePipeline is destroyed');
        if (!encoder || typeof encoder !== 'object' || typeof encoder.finish !== 'function') {
            fail('$.encoder', 'must be a live caller-owned GPUCommandEncoder-like object');
        }
        const context = cloneStrictJson(contextInput, '$.frameContext');
        const contextKeys = new Set([
            'frameId', 'sourceRevision', 'representationRevision', 'deviceGeneration',
            'activePackets', 'renderedSamples', 'metadata',
        ]);
        exactObject(context, contextKeys, '$.frameContext');
        const frameId = identifier(context.frameId, '$.frameContext.frameId');
        const sourceRevision = integer(context.sourceRevision, '$.frameContext.sourceRevision');
        const representationRevision = integer(context.representationRevision, '$.frameContext.representationRevision');
        const deviceGeneration = integer(context.deviceGeneration, '$.frameContext.deviceGeneration');
        if (deviceGeneration !== this.#deviceGeneration) {
            throw new Error(`Matter frame device generation ${deviceGeneration} is stale; expected ${this.#deviceGeneration}`);
        }
        integer(context.activePackets ?? 0, '$.frameContext.activePackets');
        integer(context.renderedSamples ?? 0, '$.frameContext.renderedSamples');
        const metadata = context.metadata == null
            ? {}
            : cloneStrictJson(context.metadata, '$.frameContext.metadata');
        if (!isPlainJsonObject(metadata)) fail('$.frameContext.metadata', 'must be a plain object');
        this.#frameSequence += 1;
        const stageReceipts = [];
        callLogger(this.#logger, 'matter-frame-encode-start', { frameId, frameSequence: this.#frameSequence });
        try {
            for (const stageName of MATTER_FRAME_STAGES) {
                const descriptor = this.#stages.get(stageName);
                if (!descriptor || !descriptor.enabled) {
                    if (descriptor?.required) throw new Error(`Required Matter stage '${stageName}' is disabled`);
                    stageReceipts.push({ stageName, status: 'skipped', encodedPasses: 0, cpuEncodeMs: 0 });
                    continue;
                }
                const started = nowMs();
                const resultInput = descriptor.encode(encoder, Object.freeze({
                    frameId,
                    frameSequence: this.#frameSequence,
                    sourceRevision,
                    representationRevision,
                    deviceGeneration,
                    activePackets: context.activePackets ?? 0,
                    renderedSamples: context.renderedSamples ?? 0,
                    metadata: deepFreezeJson(cloneStrictJson(metadata)),
                    stageName,
                }));
                if (resultInput && typeof resultInput.then === 'function') {
                    throw new Error(`Matter stage '${stageName}' returned a Promise; frame encoding must be synchronous`);
                }
                const result = resultInput == null ? {} : cloneStrictJson(resultInput, `$.stageResult.${stageName}`);
                if (!isPlainJsonObject(result)) fail(`$.stageResult.${stageName}`, 'must be a plain object');
                const allowedResult = new Set(['encodedPasses', 'workItems', 'metrics', 'sourceRevision', 'representationRevision']);
                exactObject(result, allowedResult, `$.stageResult.${stageName}`);
                const stageSourceRevision = integer(result.sourceRevision ?? sourceRevision, `$.stageResult.${stageName}.sourceRevision`);
                const stageRepresentationRevision = integer(
                    result.representationRevision ?? representationRevision,
                    `$.stageResult.${stageName}.representationRevision`,
                );
                if (stageSourceRevision !== sourceRevision || stageRepresentationRevision !== representationRevision) {
                    throw new Error(`Matter stage '${stageName}' returned a stale or unauthorized revision`);
                }
                const receipt = {
                    stageName,
                    status: 'encoded',
                    encodedPasses: integer(result.encodedPasses ?? 0, `$.stageResult.${stageName}.encodedPasses`),
                    workItems: integer(result.workItems ?? 0, `$.stageResult.${stageName}.workItems`),
                    cpuEncodeMs: Math.max(0, nowMs() - started),
                    metrics: result.metrics == null ? {} : cloneStrictJson(result.metrics),
                };
                if (!isPlainJsonObject(receipt.metrics)) fail(`$.stageResult.${stageName}.metrics`, 'must be a plain object');
                stageReceipts.push(receipt);
                this.#metrics.encodedStages += 1;
            }
            this.#metrics.encodedFrames += 1;
            const receipt = cloneAndFreezeStrictJson({
                schema: 'engine.matter.frame-encode-receipt',
                schemaVersion: '1.0.0',
                frameId,
                frameSequence: this.#frameSequence,
                sourceRevision,
                representationRevision,
                deviceGeneration,
                mustDiscardEncoder: false,
                stageReceipts,
                totalCpuEncodeMs: stageReceipts.reduce((sum, item) => sum + item.cpuEncodeMs, 0),
            }, '$.matterFrameEncodeReceipt');
            callLogger(this.#logger, 'matter-frame-encoded', {
                frameId,
                encodedStages: stageReceipts.filter(item => item.status === 'encoded').length,
                totalCpuEncodeMs: receipt.totalCpuEncodeMs,
            });
            return receipt;
        } catch (error) {
            this.#metrics.rejectedFrames += 1;
            const details = cloneAndFreezeStrictJson({
                frameId,
                frameSequence: this.#frameSequence,
                mustDiscardEncoder: true,
                completedStages: stageReceipts,
                failedMessage: error.message,
            }, '$.matterFrameFailure');
            callLogger(this.#logger, 'matter-frame-encode-failed', details);
            const wrapped = new Error(`Matter frame '${frameId}' failed; discard its command encoder: ${error.message}`);
            wrapped.cause = error;
            wrapped.details = details;
            throw wrapped;
        }
    }

    recreateDevice(deviceGeneration) {
        const next = integer(deviceGeneration, '$.deviceGeneration');
        if (next <= this.#deviceGeneration) fail('$.deviceGeneration', 'must advance');
        this.#deviceGeneration = next;
        callLogger(this.#logger, 'matter-frame-device-recreated', { deviceGeneration: next });
        return next;
    }

    stats() {
        return cloneAndFreezeStrictJson({
            ...this.#metrics,
            frameSequence: this.#frameSequence,
            deviceGeneration: this.#deviceGeneration,
            registeredStages: [...this.#stages.keys()].sort(),
        });
    }

    destroy() {
        if (this.#destroyed) return;
        callLogger(this.#logger, 'matter-frame-pipeline-destroy-start');
        this.#stages.clear();
        this.#destroyed = true;
        callLogger(this.#logger, 'matter-frame-pipeline-destroyed');
    }
}

/** Bounded, truthful metrics store for pass timings, invariants, and representation events. */
export class MatterDiagnostics {
    #logger;
    #maximumEvents;
    #events = [];
    #passes = new Map();
    #invariants = new Map();
    #counters = new Map();
    #sequence = 0;

    constructor(optionsInput = {}) {
        const options = safeOptions(optionsInput, new Set(['logger', 'maximumEvents']));
        if (options.logger != null && typeof options.logger !== 'function') fail('$.options.logger', 'must be a function or null');
        this.#logger = options.logger ?? null;
        this.#maximumEvents = integer(options.maximumEvents ?? 512, '$.options.maximumEvents', { minimum: 1, maximum: 100_000 });
        callLogger(this.#logger, 'matter-diagnostics-initialize', { maximumEvents: this.#maximumEvents });
    }

    recordPass(name, milliseconds, detailsInput = {}) {
        const passName = identifier(name, '$.passName');
        const value = finite(milliseconds, '$.milliseconds', { minimum: 0 });
        const details = cloneStrictJson(detailsInput, '$.details');
        if (!isPlainJsonObject(details)) fail('$.details', 'must be a plain object');
        const history = this.#passes.get(passName) ?? [];
        history.push(value);
        if (history.length > 256) history.shift();
        this.#passes.set(passName, history);
        this.recordEvent('pass-timing', { ...details, passName, milliseconds: value });
    }

    recordInvariant(name, { balanced, residual = 0, tolerance = 0, details = {} } = {}) {
        const invariantName = identifier(name, '$.invariantName');
        if (typeof balanced !== 'boolean') fail('$.balanced', 'must be boolean');
        const record = {
            balanced,
            residual: finite(residual, '$.residual'),
            tolerance: finite(tolerance, '$.tolerance', { minimum: 0 }),
            details: cloneStrictJson(details, '$.details'),
        };
        if (!isPlainJsonObject(record.details)) fail('$.details', 'must be a plain object');
        this.#invariants.set(invariantName, record);
        this.recordEvent(balanced ? 'invariant-balanced' : 'invariant-failed', {
            invariantName,
            residual: record.residual,
            tolerance: record.tolerance,
        });
        return cloneAndFreezeStrictJson(record);
    }

    increment(name, amount = 1) {
        const counterName = identifier(name, '$.counterName');
        const delta = finite(amount, '$.amount');
        const next = (this.#counters.get(counterName) ?? 0) + delta;
        if (!Number.isFinite(next)) fail('$.amount', 'overflows counter range');
        this.#counters.set(counterName, next);
        return next;
    }

    recordEvent(type, detailsInput = {}) {
        const eventType = identifier(type, '$.eventType');
        const details = cloneStrictJson(detailsInput, '$.details');
        if (!isPlainJsonObject(details)) fail('$.details', 'must be a plain object');
        this.#sequence += 1;
        const event = deepFreezeJson({ sequence: this.#sequence, type: eventType, details });
        this.#events.push(event);
        if (this.#events.length > this.#maximumEvents) this.#events.shift();
        callLogger(this.#logger, 'matter-diagnostic-event', { event });
        return event;
    }

    snapshot() {
        const passStats = {};
        for (const [name, samples] of [...this.#passes.entries()].sort()) {
            const sorted = [...samples].sort((left, right) => left - right);
            passStats[name] = {
                samples: samples.length,
                latestMs: samples[samples.length - 1] ?? 0,
                p50Ms: percentile(sorted, 0.5),
                p95Ms: percentile(sorted, 0.95),
                maximumMs: sorted[sorted.length - 1] ?? 0,
            };
        }
        return cloneAndFreezeStrictJson({
            sequence: this.#sequence,
            events: this.#events,
            passes: passStats,
            invariants: Object.fromEntries([...this.#invariants.entries()].sort()),
            counters: Object.fromEntries([...this.#counters.entries()].sort()),
        }, '$.matterDiagnosticsSnapshot');
    }

    /**
     * Export one immutable, versioned frame receipt across device admission,
     * authority, workload, timing, quality, and GPU-error evidence. The method
     * observes diagnostics only; it cannot grant simulation or presentation
     * authority and it never mutates the frame pipeline.
     */
    exportFrameReceipt(contextInput) {
        const context = normalizeFrameDiagnosticsContext(contextInput);
        const receipt = deepFreezeJson({
            schema: MATTER_FRAME_DIAGNOSTICS_RECEIPT_SCHEMA,
            schemaVersion: MATTER_FRAME_DIAGNOSTICS_RECEIPT_VERSION,
            ...context,
            diagnostics: this.snapshot(),
            generatedAtSequence: this.#sequence,
        }, '$.matterFrameDiagnosticsReceipt');
        callLogger(this.#logger, 'matter-frame-diagnostics-receipt-exported', {
            frameId: receipt.frame.frameId,
            frameSequence: receipt.frame.frameSequence,
            admission: receipt.admission.state,
            physicalHandoff: receipt.authority.physicalHandoff,
        });
        return receipt;
    }

    exportBenchmarkReport(contextInput = {}) {
        const context = cloneStrictJson(contextInput, '$.benchmarkContext');
        if (!isPlainJsonObject(context)) fail('$.benchmarkContext', 'must be a plain object');
        const allowed = new Set([
            'scenarioId', 'qualityMode', 'device', 'renderedSamples', 'activePackets',
            'allocatedPackets', 'bytesPerPacket', 'vramBytes', 'dispatchCount',
            'densityError', 'volumeLoss', 'averageNeighbors', 'maximumNeighbors',
            'substeps', 'timeStepS',
        ]);
        exactObject(context, allowed, '$.benchmarkContext');
        identifier(context.scenarioId, '$.benchmarkContext.scenarioId');
        const numeric = [
            'renderedSamples', 'activePackets', 'allocatedPackets', 'bytesPerPacket',
            'vramBytes', 'dispatchCount', 'densityError', 'volumeLoss',
            'averageNeighbors', 'maximumNeighbors', 'substeps', 'timeStepS',
        ];
        for (const key of numeric) {
            if (Object.hasOwn(context, key)) finite(context[key], `$.benchmarkContext.${key}`, { minimum: 0 });
        }
        const report = deepFreezeJson({
            schema: MATTER_BENCHMARK_REPORT_SCHEMA,
            schemaVersion: MATTER_BENCHMARK_REPORT_VERSION,
            context,
            diagnostics: this.snapshot(),
            generatedAtSequence: this.#sequence,
        }, '$.matterBenchmarkReport');
        callLogger(this.#logger, 'matter-benchmark-report-exported', { scenarioId: context.scenarioId });
        return report;
    }
}

/** Atomic multi-participant checkpoints with hash verification and two-phase device recreation. */
export class MatterReplayController {
    #participants = new Map();
    #actions = [];
    #sequence = 0;
    #logger;
    #maximumActions;
    #deviceGeneration = 0;

    constructor(optionsInput = {}) {
        const options = safeOptions(optionsInput, new Set(['logger', 'maximumActions', 'deviceGeneration']));
        if (options.logger != null && typeof options.logger !== 'function') fail('$.options.logger', 'must be a function or null');
        this.#logger = options.logger ?? null;
        this.#maximumActions = integer(options.maximumActions ?? 10_000, '$.options.maximumActions', { minimum: 1, maximum: 1_000_000 });
        this.#deviceGeneration = integer(options.deviceGeneration ?? 0, '$.options.deviceGeneration');
        callLogger(this.#logger, 'matter-replay-initialize', { deviceGeneration: this.#deviceGeneration });
    }

    registerParticipant(descriptorInput) {
        if (!descriptorInput || typeof descriptorInput !== 'object') fail('$.participant', 'must be an object');
        const allowed = new Set(['id', 'snapshot', 'restore', 'prepareDevice']);
        const values = {};
        for (const key of Reflect.ownKeys(descriptorInput)) {
            if (typeof key !== 'string' || !allowed.has(key)) fail(`$.participant.${String(key)}`, 'unknown field');
            const descriptor = Object.getOwnPropertyDescriptor(descriptorInput, key);
            if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
                fail(`$.participant.${key}`, 'must be an enumerable data property');
            }
            values[key] = descriptor.value;
        }
        const id = identifier(values.id, '$.participant.id');
        const snapshot = values.snapshot;
        const restore = values.restore;
        const prepareDevice = values.prepareDevice ?? null;
        if (typeof snapshot !== 'function' || typeof restore !== 'function') {
            fail('$.participant', 'requires snapshot and restore functions');
        }
        if (prepareDevice != null && typeof prepareDevice !== 'function') fail('$.participant.prepareDevice', 'must be a function');
        if (this.#participants.has(id)) fail('$.participant.id', `duplicates '${id}'`);
        this.#participants.set(id, Object.freeze({ id, snapshot, restore, prepareDevice }));
        callLogger(this.#logger, 'matter-replay-participant-registered', { id });
        return () => this.#participants.delete(id);
    }

    recordAction(type, payloadInput = {}) {
        const actionType = identifier(type, '$.actionType');
        const payload = cloneStrictJson(payloadInput, '$.payload');
        this.#sequence += 1;
        const action = deepFreezeJson({ sequence: this.#sequence, type: actionType, payload });
        this.#actions.push(action);
        if (this.#actions.length > this.#maximumActions) this.#actions.shift();
        callLogger(this.#logger, 'matter-replay-action', { sequence: action.sequence, actionType });
        return action;
    }

    async checkpoint(checkpointId) {
        const id = identifier(checkpointId, '$.checkpointId');
        callLogger(this.#logger, 'matter-replay-checkpoint-start', { checkpointId: id });
        const participants = {};
        for (const [participantId, participant] of [...this.#participants.entries()].sort()) {
            const value = participant.snapshot();
            if (value && typeof value.then === 'function') {
                participants[participantId] = cloneStrictJson(await value, `$.participants.${participantId}`);
            } else {
                participants[participantId] = cloneStrictJson(value, `$.participants.${participantId}`);
            }
        }
        const body = {
            checkpointId: id,
            sequence: this.#sequence,
            deviceGeneration: this.#deviceGeneration,
            participants,
            actions: cloneStrictJson(this.#actions),
        };
        const contentHash = await sha256(body);
        const checkpoint = deepFreezeJson({
            schema: MATTER_REPLAY_CHECKPOINT_SCHEMA,
            schemaVersion: MATTER_REPLAY_CHECKPOINT_VERSION,
            ...body,
            contentHash,
        }, '$.matterReplayCheckpoint');
        callLogger(this.#logger, 'matter-replay-checkpoint', { checkpointId: id, contentHash });
        return checkpoint;
    }

    async restore(checkpointInput) {
        callLogger(this.#logger, 'matter-replay-restore-start');
        const checkpoint = cloneStrictJson(checkpointInput, '$.matterReplayCheckpoint');
        const keys = new Set([
            'schema', 'schemaVersion', 'checkpointId', 'sequence', 'deviceGeneration',
            'participants', 'actions', 'contentHash',
        ]);
        exactObject(checkpoint, keys, '$.matterReplayCheckpoint');
        for (const key of keys) if (!Object.hasOwn(checkpoint, key)) fail(`$.matterReplayCheckpoint.${key}`, 'is required');
        if (checkpoint.schema !== MATTER_REPLAY_CHECKPOINT_SCHEMA
            || checkpoint.schemaVersion !== MATTER_REPLAY_CHECKPOINT_VERSION) {
            fail('$.matterReplayCheckpoint', 'uses an unsupported schema');
        }
        identifier(checkpoint.checkpointId, '$.matterReplayCheckpoint.checkpointId');
        integer(checkpoint.sequence, '$.matterReplayCheckpoint.sequence');
        integer(checkpoint.deviceGeneration, '$.matterReplayCheckpoint.deviceGeneration');
        if (!isPlainJsonObject(checkpoint.participants)) fail('$.matterReplayCheckpoint.participants', 'must be an object');
        if (!Array.isArray(checkpoint.actions) || checkpoint.actions.length > this.#maximumActions) {
            fail('$.matterReplayCheckpoint.actions', 'is not a bounded action array');
        }
        let previousActionSequence = -1;
        for (const [index, action] of checkpoint.actions.entries()) {
            const path = `$.matterReplayCheckpoint.actions[${index}]`;
            exactObject(action, new Set(['sequence', 'type', 'payload']), path);
            for (const key of ['sequence', 'type', 'payload']) {
                if (!Object.hasOwn(action, key)) fail(`${path}.${key}`, 'is required');
            }
            const actionSequence = integer(action.sequence, `${path}.sequence`, { minimum: 1 });
            if (actionSequence <= previousActionSequence || actionSequence > checkpoint.sequence) {
                fail(`${path}.sequence`, 'must be strictly increasing and within checkpoint sequence');
            }
            previousActionSequence = actionSequence;
            identifier(action.type, `${path}.type`);
        }
        if (checkpoint.actions.length === 0 && checkpoint.sequence !== 0) {
            fail('$.matterReplayCheckpoint.sequence', 'must be zero when no actions exist');
        }
        if (checkpoint.actions.length > 0 && previousActionSequence !== checkpoint.sequence) {
            fail('$.matterReplayCheckpoint.sequence', 'must equal the latest retained action sequence');
        }
        if (typeof checkpoint.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(checkpoint.contentHash)) {
            fail('$.matterReplayCheckpoint.contentHash', 'must be a lowercase SHA-256 digest');
        }
        const body = {
            checkpointId: checkpoint.checkpointId,
            sequence: checkpoint.sequence,
            deviceGeneration: checkpoint.deviceGeneration,
            participants: checkpoint.participants,
            actions: checkpoint.actions,
        };
        if (await sha256(body) !== checkpoint.contentHash) fail('$.matterReplayCheckpoint.contentHash', 'does not match checkpoint content');
        const expectedIds = [...this.#participants.keys()].sort();
        const actualIds = Object.keys(checkpoint.participants).sort();
        for (const participantId of actualIds) {
            identifier(participantId, '$.matterReplayCheckpoint.participants key');
        }
        if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds)) {
            fail('$.matterReplayCheckpoint.participants', 'does not exactly match registered participants');
        }
        const rollback = new Map();
        for (const [participantId, participant] of this.#participants) {
            rollback.set(participantId, cloneStrictJson(await participant.snapshot(), `$.rollback.${participantId}`));
        }
        const attempted = [];
        try {
            for (const participantId of expectedIds) {
                attempted.push(participantId);
                await this.#participants.get(participantId).restore(checkpoint.participants[participantId]);
            }
        } catch (error) {
            const rollbackFailures = [];
            for (const participantId of attempted.reverse()) {
                try {
                    await this.#participants.get(participantId).restore(rollback.get(participantId));
                } catch (rollbackError) {
                    rollbackFailures.push(`${participantId}: ${rollbackError.message}`);
                }
            }
            callLogger(this.#logger, 'matter-replay-restore-failed', { message: error.message, rollbackFailures });
            if (rollbackFailures.length > 0) {
                throw new AggregateError([error], `Matter replay rollback failed: ${rollbackFailures.join('; ')}`);
            }
            throw error;
        }
        this.#sequence = checkpoint.sequence;
        this.#deviceGeneration = checkpoint.deviceGeneration;
        this.#actions = cloneStrictJson(checkpoint.actions);
        callLogger(this.#logger, 'matter-replay-restored', { checkpointId: checkpoint.checkpointId });
        return this;
    }

    async recreateDevice(device, nextGenerationInput) {
        const nextGeneration = integer(nextGenerationInput, '$.nextGeneration');
        if (nextGeneration <= this.#deviceGeneration) fail('$.nextGeneration', 'must advance');
        if (!device || typeof device !== 'object') fail('$.device', 'must be a GPUDevice-like object');
        callLogger(this.#logger, 'matter-device-recreation-start', { nextGeneration });
        const prepared = [];
        try {
            for (const [id, participant] of [...this.#participants.entries()].sort()) {
                if (!participant.prepareDevice) continue;
                const candidate = await participant.prepareDevice(device, {
                    nextGeneration,
                    snapshot: cloneStrictJson(await participant.snapshot(), `$.deviceSnapshot.${id}`),
                });
                if (!candidate
                    || typeof candidate.commit !== 'function'
                    || typeof candidate.rollback !== 'function'
                    || typeof candidate.finalize !== 'function'
                    || typeof candidate.destroy !== 'function') {
                    throw new Error(`Participant '${id}' returned an invalid device candidate`);
                }
                prepared.push({ id, candidate, committed: false });
            }
            for (const entry of prepared) {
                entry.committed = true;
                await entry.candidate.commit();
            }
            this.#deviceGeneration = nextGeneration;
            const finalizeFailures = [];
            for (const { id, candidate } of prepared) {
                try { await candidate.finalize(); } catch (error) {
                    finalizeFailures.push(`${id}: ${error.message}`);
                }
            }
            if (finalizeFailures.length > 0) {
                callLogger(this.#logger, 'matter-device-recreation-finalize-failed', {
                    nextGeneration,
                    failures: finalizeFailures,
                });
            }
            callLogger(this.#logger, 'matter-device-recreated', { nextGeneration, participants: prepared.length });
            return nextGeneration;
        } catch (error) {
            const rollbackFailures = [];
            for (const { id, candidate, committed } of [...prepared].reverse()) {
                if (committed) {
                    try { await candidate.rollback(); } catch (rollbackError) {
                        rollbackFailures.push(`${id}: ${rollbackError.message}`);
                    }
                }
                try { await candidate.destroy(); } catch (cleanupError) {
                    rollbackFailures.push(`${id} cleanup: ${cleanupError.message}`);
                }
            }
            callLogger(this.#logger, 'matter-device-recreation-failed', {
                nextGeneration,
                message: error.message,
                rollbackFailures,
            });
            if (rollbackFailures.length > 0) {
                throw new AggregateError([error], `Matter device recreation rollback failed: ${rollbackFailures.join('; ')}`);
            }
            throw error;
        }
    }

    stats() {
        return cloneAndFreezeStrictJson({
            participants: [...this.#participants.keys()].sort(),
            actionCount: this.#actions.length,
            sequence: this.#sequence,
            deviceGeneration: this.#deviceGeneration,
        });
    }
}

export function createMatterFramePipeline(options = {}) {
    return new MatterFramePipeline(options);
}

export function createMatterDiagnostics(options = {}) {
    return new MatterDiagnostics(options);
}

export function createMatterReplayController(options = {}) {
    return new MatterReplayController(options);
}
