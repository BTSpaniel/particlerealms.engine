// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Atomic, journaled phase transcoding with deterministic crash recovery. */

import {
    cloneAndFreezeStrictJson,
    cloneStrictJson,
    isPlainJsonObject,
} from '../../core/schema/StrictJsonValue.js';
import { selectPowerOfTwoTimeBin } from '../structural/StructuralTimeBins.js';
import { validateStructuralTopologySnapshot } from '../structural/StructuralContracts.js';
import {
    PHASE_TRANSCODER_SNAPSHOT_SCHEMA,
    PHASE_TRANSCODE_VERSION,
    createPhaseState,
    createPhaseTranscodeReceipt,
    createPhaseTranscodeRequest,
    validatePhaseFamilyProfile,
} from './TranscodeContracts.js';
import { PHASE_FAMILY_PROFILES } from './PhaseFamilyProfiles.js';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;
const OPTION_KEYS = new Set(['profiles', 'topology', 'deviceGeneration', 'logger', 'maximumStates', 'maximumJournalEntries']);
const COMMIT_OPTION_KEYS = new Set(['interruptAt', 'recovered']);

function fail(path, message) { throw new TypeError(`${path}: ${message}`); }

function identifier(value, path) {
    if (typeof value !== 'string' || !IDENTIFIER.test(value)) fail(path, 'has invalid identifier syntax');
    return value;
}

function boundedText(value, path) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 512
        || /[\u0000-\u001f\u007f]/.test(value)) fail(path, 'must be a bounded control-free string');
    return value;
}

function integer(value, path, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        fail(path, `must be a safe integer in [${minimum}, ${maximum}]`);
    }
    return value;
}

function exact(value, allowed, required, path) {
    if (!isPlainJsonObject(value)) fail(path, 'must be a plain object');
    for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${path}.${key}`, 'unknown field');
    for (const key of required) if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, 'is required');
    return value;
}

function safeOptions(input, allowed, path) {
    if (!isPlainJsonObject(input)) fail(path, 'must be a plain object');
    const output = {};
    for (const key of Reflect.ownKeys(input)) {
        if (typeof key !== 'string') fail(path, 'symbol keys are not supported');
        if (!allowed.has(key)) fail(`${path}.${key}`, 'unknown field');
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor?.enumerable) fail(`${path}.${key}`, 'non-enumerable fields are not supported');
        if (!Object.hasOwn(descriptor, 'value')) fail(`${path}.${key}`, 'accessors are not supported');
        output[key] = descriptor.value;
    }
    return output;
}

function nowMs() { return globalThis.performance?.now?.() ?? Date.now(); }

function log(logger, type, details = {}) {
    try { logger?.(Object.freeze({ type, ...details })); } catch (_) { /* diagnostics own no state */ }
}

function hashToken(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function mutable(value) { return cloneStrictJson(value); }

function normalizeProfiles(profilesInput) {
    if (!Array.isArray(profilesInput) || profilesInput.length === 0) fail('$.options.profiles', 'must be non-empty');
    const profiles = new Map();
    profilesInput.forEach((profile, index) => {
        validatePhaseFamilyProfile(profile, `$.options.profiles[${index}]`);
        if (profiles.has(profile.id)) fail(`$.options.profiles[${index}].id`, 'duplicates an earlier profile');
        profiles.set(profile.id, cloneAndFreezeStrictJson(profile));
    });
    return profiles;
}

function transitionFor(profile, fromPhaseId, toPhaseId) {
    return profile.transitions.find(entry => (
        entry.fromPhaseId === fromPhaseId && entry.toPhaseId === toPhaseId
    )) ?? null;
}

function assertDeltaBounds(delta, bounds) {
    for (const key of ['materialMassKg', 'waterMassKg', 'internalEnergyJ']) {
        if (delta[key] < bounds[key].minimum || delta[key] > bounds[key].maximum) {
            fail(`$.transcodeRequest.reservoirDelta.${key}`, 'is outside transition bounds');
        }
    }
}

function sameJson(left, right) {
    if (left === right) return true;
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    if (Array.isArray(left)) {
        return left.length === right.length && left.every((value, index) => sameJson(value, right[index]));
    }
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
        && leftKeys.every((key, index) => key === rightKeys[index] && sameJson(left[key], right[key]));
}

export class TranscodeInterruptedError extends Error {
    constructor(transactionId, point) {
        super(`Phase transcode '${transactionId}' was interrupted at ${point}`);
        this.name = 'TranscodeInterruptedError';
        this.transactionId = transactionId;
        this.point = point;
    }
}

export class AtomicPhaseTranscoder {
    #profiles;
    #topology;
    #deviceGeneration;
    #logger;
    #states = new Map();
    #journal = new Map();
    #receipts = new Map();
    #maximumStates;
    #maximumJournalEntries;
    #destroyed = false;

    constructor(optionsInput = {}) {
        const options = safeOptions(optionsInput, OPTION_KEYS, '$.options');
        this.#profiles = normalizeProfiles(options.profiles ?? PHASE_FAMILY_PROFILES);
        this.#topology = options.topology ?? null;
        if (this.#topology !== null && (typeof this.#topology.snapshot !== 'function'
            || typeof this.#topology.restore !== 'function')) {
            fail('$.options.topology', 'must implement the StructuralTopology snapshot interface');
        }
        this.#deviceGeneration = integer(options.deviceGeneration ?? this.#topology?.deviceGeneration ?? 0,
            '$.options.deviceGeneration');
        if (this.#topology && this.#topology.deviceGeneration !== this.#deviceGeneration) {
            fail('$.options.deviceGeneration', 'does not match topology generation');
        }
        if (options.logger != null && typeof options.logger !== 'function') fail('$.options.logger', 'must be a function or null');
        this.#logger = options.logger ?? null;
        this.#maximumStates = integer(options.maximumStates ?? 1_000_000, '$.options.maximumStates', 1, 10_000_000);
        this.#maximumJournalEntries = integer(options.maximumJournalEntries ?? 1_000_000,
            '$.options.maximumJournalEntries', 1, 10_000_000);
        log(this.#logger, 'phase-transcoder-initialize', { deviceGeneration: this.#deviceGeneration });
    }

    #assertAlive() {
        if (this.#destroyed) throw new Error('AtomicPhaseTranscoder is destroyed');
    }

    get deviceGeneration() { return this.#deviceGeneration; }
    get stateCount() { return this.#states.size; }
    get pendingTransactionCount() {
        return [...this.#journal.values()].filter(entry => ['prepared', 'applying', 'interrupted'].includes(entry.status)).length;
    }

    registerState(stateInput) {
        this.#assertAlive();
        const started = nowMs();
        try {
            const state = createPhaseState(stateInput);
            if (state.deviceGeneration !== this.#deviceGeneration) fail('$.phaseState.deviceGeneration', 'is stale');
            const profile = this.#profiles.get(state.familyId);
            if (!profile) throw new RangeError(`Unknown phase family '${state.familyId}'`);
            if (!profile.phases.includes(state.phaseId)) fail('$.phaseState.phaseId', 'is not in its family');
            if (this.#states.has(state.regionId)) fail('$.phaseState.regionId', 'is already registered');
            if (this.#states.size >= this.#maximumStates) throw new RangeError('Phase state capacity exhausted');
            if (this.#topology) {
                for (const nodeId of state.structuralNodeIds) {
                    if (!this.#topology.node(nodeId)) fail('$.phaseState.structuralNodeIds', `contains unknown node '${nodeId}'`);
                }
            }
            this.#states.set(state.regionId, mutable(state));
            log(this.#logger, 'phase-state-registered', {
                regionId: state.regionId, phaseId: state.phaseId, durationMs: nowMs() - started,
            });
            return state;
        } catch (error) {
            log(this.#logger, 'phase-state-register-error', { message: error.message, durationMs: nowMs() - started });
            throw error;
        }
    }

    state(regionIdInput) {
        this.#assertAlive();
        const state = this.#states.get(identifier(regionIdInput, '$.regionId'));
        return state ? cloneAndFreezeStrictJson(state) : null;
    }

    states() {
        this.#assertAlive();
        return cloneAndFreezeStrictJson([...this.#states.values()].sort((a, b) => a.regionId.localeCompare(b.regionId)));
    }

    preview(requestInput) {
        this.#assertAlive();
        const request = createPhaseTranscodeRequest(requestInput);
        const before = this.#states.get(request.regionId);
        if (!before) throw new RangeError(`Unknown phase region '${request.regionId}'`);
        if (request.familyId !== before.familyId) fail('$.transcodeRequest.familyId', 'does not match state');
        if (request.expectedRevision !== before.revision) fail('$.transcodeRequest.expectedRevision', 'is stale');
        if (request.expectedDeviceGeneration !== this.#deviceGeneration
            || before.deviceGeneration !== this.#deviceGeneration) {
            fail('$.transcodeRequest.expectedDeviceGeneration', 'is stale');
        }
        if (request.fromPhaseId !== before.phaseId) fail('$.transcodeRequest.fromPhaseId', 'does not match state');
        const family = this.#profiles.get(request.familyId);
        if (!family) throw new RangeError(`Unknown phase family '${request.familyId}'`);
        const transition = transitionFor(family, request.fromPhaseId, request.toPhaseId);
        if (!transition) fail('$.transcodeRequest', 'requests an unsupported phase edge');
        if (request.temperatureK < transition.minimumTemperatureK
            || request.temperatureK > transition.maximumTemperatureK) {
            fail('$.transcodeRequest.temperatureK', 'is outside transition bounds');
        }
        assertDeltaBounds(request.reservoirDelta, transition.deltaBounds);
        if (request.structuralPolicy.mode !== transition.structuralMode) {
            fail('$.transcodeRequest.structuralPolicy.mode', `must be '${transition.structuralMode}' for this edge`);
        }
        if (request.structuralPolicy.damageDelta < transition.minimumDamageDelta) {
            fail('$.transcodeRequest.structuralPolicy.damageDelta', 'is below the transition minimum');
        }
        if (request.structuralPolicy.mode !== 'preserve' && before.structuralNodeIds.length > 0 && !this.#topology) {
            fail('$.transcodeRequest.structuralPolicy', 'requires a structural topology');
        }
        const reservoirs = {};
        for (const key of ['materialMassKg', 'waterMassKg', 'internalEnergyJ']) {
            reservoirs[key] = before.reservoirs[key] + request.reservoirDelta[key];
            if (!Number.isFinite(reservoirs[key]) || reservoirs[key] < 0) {
                fail(`$.transcodeRequest.reservoirDelta.${key}`, 'would make the reservoir negative or non-finite');
            }
        }
        if (reservoirs.materialMassKg <= 0) fail('$.transcodeRequest.reservoirDelta.materialMassKg', 'would remove all material');
        const timeBin = selectPowerOfTwoTimeBin({
            currentExponent: before.timeBinExponent,
            maximumExponent: 30,
            predictedTimeToImpactS: null,
            baseStepSeconds: 1,
            strainRatio: 0,
            phaseChanging: true,
            interacting: true,
        });
        if (request.requestedTimeBinExponent < timeBin.exponent) {
            fail('$.transcodeRequest.requestedTimeBinExponent', 'cannot be faster than the selected bin');
        }
        const after = createPhaseState({
            ...before,
            phaseId: request.toPhaseId,
            revision: before.revision + 1,
            timeBinExponent: timeBin.exponent,
            temperatureK: request.temperatureK,
            reservoirs,
        });
        return cloneAndFreezeStrictJson({ request, before, after, transition });
    }

    prepare(requestInput) {
        this.#assertAlive();
        const started = nowMs();
        log(this.#logger, 'phase-transcode-prepare-enter');
        try {
            const request = createPhaseTranscodeRequest(requestInput);
            const existing = this.#journal.get(request.transactionId);
            if (existing) {
                if (!sameJson(existing.request, request)) fail('$.transcodeRequest.transactionId', 'was reused for different input');
                return cloneAndFreezeStrictJson(existing);
            }
            const preview = this.preview(request);
            if (this.#journal.size >= this.#maximumJournalEntries) throw new RangeError('Phase transaction journal capacity exhausted');
            const entry = {
                transactionId: preview.request.transactionId,
                status: 'prepared',
                attempts: 0,
                request: mutable(preview.request),
                before: mutable(preview.before),
                after: mutable(preview.after),
                topologyBefore: null,
                deletedBondIds: [],
                weakenedBondIds: [],
                error: null,
            };
            this.#journal.set(entry.transactionId, entry);
            log(this.#logger, 'phase-transcode-prepared', {
                transactionId: entry.transactionId, durationMs: nowMs() - started,
            });
            return cloneAndFreezeStrictJson(entry);
        } catch (error) {
            log(this.#logger, 'phase-transcode-prepare-error', { message: error.message, durationMs: nowMs() - started });
            throw error;
        }
    }

    commitPrepared(transactionIdInput, optionsInput = {}) {
        this.#assertAlive();
        const started = nowMs();
        const transactionId = identifier(transactionIdInput, '$.transactionId');
        const options = cloneStrictJson(optionsInput, '$.commitOptions');
        exact(options, COMMIT_OPTION_KEYS, new Set(), '$.commitOptions');
        const interruptAt = options.interruptAt ?? null;
        if (![null, 'after-prepare', 'after-structural'].includes(interruptAt)) {
            fail('$.commitOptions.interruptAt', 'is unsupported');
        }
        if (options.recovered != null && typeof options.recovered !== 'boolean') {
            fail('$.commitOptions.recovered', 'must be boolean');
        }
        const entry = this.#journal.get(transactionId);
        if (!entry) throw new RangeError(`Unknown phase transaction '${transactionId}'`);
        if (entry.status === 'committed') return this.#receipts.get(transactionId);
        if (entry.status === 'aborted') throw new Error(`Phase transaction '${transactionId}' is aborted: ${entry.error}`);
        const current = this.#states.get(entry.before.regionId);
        if (!current || current.revision !== entry.before.revision || current.deviceGeneration !== entry.before.deviceGeneration
            || !sameJson(current, entry.before)) {
            entry.status = 'aborted';
            entry.error = 'stale state';
            log(this.#logger, 'phase-transcode-stale', { transactionId });
            throw new Error(`Phase transaction '${transactionId}' is stale`);
        }

        entry.status = 'applying';
        entry.attempts++;
        entry.error = null;
        entry.topologyBefore = this.#topology ? mutable(this.#topology.snapshot()) : null;
        log(this.#logger, 'phase-transcode-commit-enter', { transactionId, attempt: entry.attempts });
        let structuralAttempted = false;
        try {
            if (interruptAt === 'after-prepare') throw new TranscodeInterruptedError(transactionId, interruptAt);
            let deletedBondIds = [];
            let weakenedBondIds = [];
            const policy = entry.request.structuralPolicy;
            const nodeIds = entry.before.structuralNodeIds;
            if (policy.mode === 'weaken' && nodeIds.length > 0) {
                structuralAttempted = true;
                const changed = this.#topology.weakenBondsForNodes(nodeIds, policy.damageDelta);
                weakenedBondIds = changed.map(bond => bond.id).sort((a, b) => a.localeCompare(b));
            } else if (policy.mode === 'delete' && nodeIds.length > 0) {
                structuralAttempted = true;
                const cracks = this.#topology.deleteBondsForNodes(nodeIds, {
                    fractureEventId: `phase.${hashToken(transactionId)}`,
                    createdStep: this.#topology.stepIndex,
                });
                deletedBondIds = cracks.map(crack => crack.bondId).sort((a, b) => a.localeCompare(b));
            }
            entry.deletedBondIds = [...deletedBondIds];
            entry.weakenedBondIds = [...weakenedBondIds];
            if (interruptAt === 'after-structural') throw new TranscodeInterruptedError(transactionId, interruptAt);
            const receipt = createPhaseTranscodeReceipt({
                transactionId,
                status: 'committed',
                recovered: options.recovered ?? false,
                before: entry.before,
                after: entry.after,
                reservoirDelta: entry.request.reservoirDelta,
                deletedBondIds: entry.deletedBondIds,
                weakenedBondIds: entry.weakenedBondIds,
            });
            this.#states.set(entry.after.regionId, mutable(entry.after));
            entry.status = 'committed';
            entry.topologyBefore = null;
            this.#receipts.set(transactionId, receipt);
            log(this.#logger, 'phase-transcode-state-committed', {
                transactionId, phaseId: entry.after.phaseId, revision: entry.after.revision,
            });
            log(this.#logger, 'phase-transcode-commit-exit', {
                transactionId, durationMs: nowMs() - started,
            });
            log(this.#logger, 'phase-transcode-performance', {
                transactionId, durationMs: nowMs() - started,
            });
            return receipt;
        } catch (error) {
            if (structuralAttempted && entry.topologyBefore) this.#topology.restore(entry.topologyBefore);
            entry.status = error instanceof TranscodeInterruptedError ? 'interrupted' : 'aborted';
            entry.error = error.message;
            entry.topologyBefore = null;
            entry.deletedBondIds = [];
            entry.weakenedBondIds = [];
            log(this.#logger, 'phase-transcode-commit-error', {
                transactionId, status: entry.status, message: error.message, durationMs: nowMs() - started,
            });
            throw error;
        }
    }

    transcode(requestInput, optionsInput = {}) {
        const prepared = this.prepare(requestInput);
        if (prepared.status === 'committed') return this.#receipts.get(prepared.transactionId);
        return this.commitPrepared(prepared.transactionId, optionsInput);
    }

    abortPrepared(transactionIdInput, reasonInput) {
        this.#assertAlive();
        const transactionId = identifier(transactionIdInput, '$.transactionId');
        const reason = boundedText(reasonInput, '$.reason');
        const entry = this.#journal.get(transactionId);
        if (!entry) throw new RangeError(`Unknown phase transaction '${transactionId}'`);
        if (entry.status === 'committed') {
            throw new Error(`Committed phase transaction '${transactionId}' cannot be aborted`);
        }
        if (entry.status === 'aborted') return cloneAndFreezeStrictJson(entry);
        if (entry.topologyBefore && this.#topology) this.#topology.restore(entry.topologyBefore);
        entry.status = 'aborted';
        entry.error = reason;
        entry.topologyBefore = null;
        entry.deletedBondIds = [];
        entry.weakenedBondIds = [];
        log(this.#logger, 'phase-transcode-aborted', { transactionId, reason });
        return cloneAndFreezeStrictJson(entry);
    }

    recoverTransactions() {
        this.#assertAlive();
        const recovered = [];
        const aborted = [];
        for (const entry of [...this.#journal.values()].sort((a, b) => a.transactionId.localeCompare(b.transactionId))) {
            if (!['prepared', 'applying', 'interrupted'].includes(entry.status)) continue;
            let current = this.#states.get(entry.before.regionId);
            if (entry.status === 'applying' && current && sameJson(current, entry.after)) {
                const receipt = createPhaseTranscodeReceipt({
                    transactionId: entry.transactionId,
                    status: 'committed',
                    recovered: true,
                    before: entry.before,
                    after: entry.after,
                    reservoirDelta: entry.request.reservoirDelta,
                    deletedBondIds: entry.deletedBondIds,
                    weakenedBondIds: entry.weakenedBondIds,
                });
                entry.status = 'committed';
                entry.error = null;
                entry.topologyBefore = null;
                this.#receipts.set(entry.transactionId, receipt);
                recovered.push(receipt);
                continue;
            }
            if (entry.status === 'applying' && entry.topologyBefore && this.#topology) {
                this.#topology.restore(entry.topologyBefore);
                entry.status = 'interrupted';
                entry.error = 'recovered an incomplete structural application';
                entry.topologyBefore = null;
                entry.deletedBondIds = [];
                entry.weakenedBondIds = [];
            }
            current = this.#states.get(entry.before.regionId);
            if (!current || !sameJson(current, entry.before)) {
                entry.status = 'aborted';
                entry.error = 'stale state during recovery';
                entry.topologyBefore = null;
                aborted.push(entry.transactionId);
                continue;
            }
            try {
                recovered.push(this.commitPrepared(entry.transactionId, { recovered: true }));
            } catch (error) {
                if (entry.status === 'aborted') aborted.push(entry.transactionId);
                else throw error;
            }
        }
        log(this.#logger, 'phase-transcode-recovery-complete', {
            recoveredCount: recovered.length, abortedCount: aborted.length,
        });
        return cloneAndFreezeStrictJson({ recovered, aborted });
    }

    journalEntry(transactionIdInput) {
        this.#assertAlive();
        const entry = this.#journal.get(identifier(transactionIdInput, '$.transactionId'));
        return entry ? cloneAndFreezeStrictJson(entry) : null;
    }

    snapshot() {
        this.#assertAlive();
        return cloneAndFreezeStrictJson({
            schema: PHASE_TRANSCODER_SNAPSHOT_SCHEMA,
            schemaVersion: PHASE_TRANSCODE_VERSION,
            deviceGeneration: this.#deviceGeneration,
            states: [...this.#states.values()].sort((a, b) => a.regionId.localeCompare(b.regionId)),
            journal: [...this.#journal.values()].sort((a, b) => a.transactionId.localeCompare(b.transactionId)),
            receipts: [...this.#receipts.values()].sort((a, b) => a.transactionId.localeCompare(b.transactionId)),
            topology: this.#topology ? this.#topology.snapshot() : null,
        });
    }

    restore(snapshotInput) {
        this.#assertAlive();
        const snapshot = cloneStrictJson(snapshotInput, '$.transcoderSnapshot');
        exact(snapshot, new Set(['schema', 'schemaVersion', 'deviceGeneration', 'states', 'journal', 'receipts', 'topology']),
            new Set(['schema', 'schemaVersion', 'deviceGeneration', 'states', 'journal', 'receipts', 'topology']), '$.transcoderSnapshot');
        if (snapshot.schema !== PHASE_TRANSCODER_SNAPSHOT_SCHEMA || snapshot.schemaVersion !== PHASE_TRANSCODE_VERSION) {
            fail('$.transcoderSnapshot', 'uses an unsupported schema');
        }
        const generation = integer(snapshot.deviceGeneration, '$.transcoderSnapshot.deviceGeneration');
        if (![snapshot.states, snapshot.journal, snapshot.receipts].every(Array.isArray)) {
            fail('$.transcoderSnapshot', 'state, journal, and receipts must be arrays');
        }
        if (snapshot.states.length > this.#maximumStates || snapshot.journal.length > this.#maximumJournalEntries) {
            throw new RangeError('Phase transcoder snapshot exceeds configured capacity');
        }
        const states = new Map();
        snapshot.states.forEach((input, index) => {
            const state = createPhaseState(input);
            if (state.deviceGeneration !== generation) fail(`$.transcoderSnapshot.states[${index}]`, 'generation differs');
            if (states.has(state.regionId)) fail(`$.transcoderSnapshot.states[${index}].regionId`, 'duplicates an earlier state');
            const family = this.#profiles.get(state.familyId);
            if (!family?.phases.includes(state.phaseId)) fail(`$.transcoderSnapshot.states[${index}]`, 'uses an unknown family phase');
            if (index > 0 && snapshot.states[index - 1].regionId.localeCompare(state.regionId) >= 0) {
                fail('$.transcoderSnapshot.states', 'must be strictly sorted');
            }
            states.set(state.regionId, mutable(state));
        });
        const journal = new Map();
        snapshot.journal.forEach((entry, index) => {
            exact(entry, new Set(['transactionId', 'status', 'attempts', 'request', 'before', 'after', 'topologyBefore', 'deletedBondIds', 'weakenedBondIds', 'error']),
                new Set(['transactionId', 'status', 'attempts', 'request', 'before', 'after', 'topologyBefore', 'deletedBondIds', 'weakenedBondIds', 'error']),
                `$.transcoderSnapshot.journal[${index}]`);
            identifier(entry.transactionId, `$.transcoderSnapshot.journal[${index}].transactionId`);
            if (!['prepared', 'applying', 'interrupted', 'committed', 'aborted'].includes(entry.status)) {
                fail(`$.transcoderSnapshot.journal[${index}].status`, 'is unsupported');
            }
            integer(entry.attempts, `$.transcoderSnapshot.journal[${index}].attempts`);
            entry.request = mutable(createPhaseTranscodeRequest(entry.request));
            entry.before = mutable(createPhaseState(entry.before));
            entry.after = mutable(createPhaseState(entry.after));
            if (entry.transactionId !== entry.request.transactionId) fail(`$.transcoderSnapshot.journal[${index}]`, 'identity differs');
            if (entry.error !== null && typeof entry.error !== 'string') fail(`$.transcoderSnapshot.journal[${index}].error`, 'must be string or null');
            for (const key of ['deletedBondIds', 'weakenedBondIds']) {
                if (!Array.isArray(entry[key]) || entry[key].some((value, itemIndex) => (
                    typeof value !== 'string' || !IDENTIFIER.test(value)
                    || (itemIndex > 0 && entry[key][itemIndex - 1].localeCompare(value) >= 0)
                ))) {
                    fail(`$.transcoderSnapshot.journal[${index}].${key}`, 'must be an identifier array');
                }
            }
            if (index > 0 && snapshot.journal[index - 1].transactionId.localeCompare(entry.transactionId) >= 0) {
                fail('$.transcoderSnapshot.journal', 'must be strictly sorted');
            }
            if (entry.topologyBefore !== null) validateStructuralTopologySnapshot(
                entry.topologyBefore,
                `$.transcoderSnapshot.journal[${index}].topologyBefore`,
            );
            if (journal.has(entry.transactionId)) fail(`$.transcoderSnapshot.journal[${index}]`, 'duplicates an earlier entry');
            journal.set(entry.transactionId, mutable(entry));
        });
        const receipts = new Map();
        snapshot.receipts.forEach((input, index) => {
            const receipt = createPhaseTranscodeReceipt(input);
            if (receipts.has(receipt.transactionId)) fail(`$.transcoderSnapshot.receipts[${index}]`, 'duplicates an earlier receipt');
            if (index > 0 && snapshot.receipts[index - 1].transactionId.localeCompare(receipt.transactionId) >= 0) {
                fail('$.transcoderSnapshot.receipts', 'must be strictly sorted');
            }
            receipts.set(receipt.transactionId, receipt);
        });
        if ((snapshot.topology === null) !== (this.#topology === null)) {
            fail('$.transcoderSnapshot.topology', 'presence does not match this transcoder');
        }
        if (snapshot.topology !== null && snapshot.topology.deviceGeneration !== generation) {
            fail('$.transcoderSnapshot.topology.deviceGeneration', 'generation differs');
        }
        if (snapshot.topology !== null) validateStructuralTopologySnapshot(snapshot.topology, '$.transcoderSnapshot.topology');
        for (const [transactionId, entry] of journal) {
            const receipt = receipts.get(transactionId);
            if ((entry.status === 'committed') !== Boolean(receipt)) {
                fail('$.transcoderSnapshot', `committed journal/receipt mismatch for '${transactionId}'`);
            }
            if (receipt && (!sameJson(receipt.before, entry.before) || !sameJson(receipt.after, entry.after)
                || !sameJson(receipt.reservoirDelta, entry.request.reservoirDelta))) {
                fail('$.transcoderSnapshot', `receipt content mismatch for '${transactionId}'`);
            }
        }
        if (snapshot.topology !== null) this.#topology.restore(snapshot.topology);
        this.#states = states;
        this.#journal = journal;
        this.#receipts = receipts;
        this.#deviceGeneration = generation;
        log(this.#logger, 'phase-transcoder-snapshot-restored', { deviceGeneration: generation });
        return this;
    }

    replay(actionsInput) {
        this.#assertAlive();
        const actions = cloneStrictJson(actionsInput, '$.replayActions');
        if (!Array.isArray(actions) || actions.length > 1_000_000) fail('$.replayActions', 'must be a bounded array');
        const results = [];
        actions.forEach((action, index) => {
            exact(action, new Set(['type', 'payload']), new Set(['type', 'payload']), `$.replayActions[${index}]`);
            if (action.type === 'register-state') results.push(this.registerState(action.payload));
            else if (action.type === 'transcode') results.push(this.transcode(action.payload));
            else fail(`$.replayActions[${index}].type`, 'is unsupported');
        });
        log(this.#logger, 'phase-transcoder-replay-complete', { actionCount: actions.length });
        return cloneAndFreezeStrictJson(results);
    }

    recreateDevice(nextGenerationInput) {
        this.#assertAlive();
        const nextGeneration = integer(nextGenerationInput, '$.nextGeneration');
        if (nextGeneration <= this.#deviceGeneration) fail('$.nextGeneration', 'must advance');
        if (this.#topology && this.#topology.deviceGeneration < nextGeneration) {
            this.#topology.recreateDevice(nextGeneration);
        }
        if (this.#topology && this.#topology.deviceGeneration !== nextGeneration) {
            fail('$.nextGeneration', 'does not match topology generation');
        }
        for (const [regionId, state] of this.#states) {
            this.#states.set(regionId, mutable(createPhaseState({ ...state, deviceGeneration: nextGeneration })));
        }
        for (const entry of this.#journal.values()) {
            if (!['prepared', 'applying', 'interrupted'].includes(entry.status)) continue;
            entry.status = 'aborted';
            entry.error = 'device generation changed';
            entry.topologyBefore = null;
        }
        this.#deviceGeneration = nextGeneration;
        log(this.#logger, 'phase-transcoder-device-recreated', {
            deviceGeneration: nextGeneration, stateCount: this.#states.size,
        });
        return nextGeneration;
    }

    destroy() {
        if (this.#destroyed) return false;
        this.#states.clear();
        this.#journal.clear();
        this.#receipts.clear();
        this.#destroyed = true;
        log(this.#logger, 'phase-transcoder-destroyed');
        return true;
    }
}
