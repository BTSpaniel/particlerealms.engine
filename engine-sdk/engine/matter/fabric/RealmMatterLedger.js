// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Durable hash-bound delta ledger for Matter instances and their Soul Seeds. */

import { cloneStrictJson } from '../../core/schema/StrictJsonValue.js';
import {
    FabricDiagnostics,
    contentHash,
    fail,
    freeze,
    requireEnum,
    requireExactKeys,
    requireHash,
    requireIdentifier,
    requireIdentifierArray,
    requireInteger,
    requireRecord,
} from './FabricSupport.js';
import { createRealmMatterState, validateRealmMatterState } from './RealmMatterContracts.js';

export const REALM_MATTER_LEDGER_SCHEMA = 'engine.matter.fabric.ledger';
export const REALM_MATTER_LEDGER_VERSION = '1.0.0';
export const REALM_MATTER_LEDGER_EVENT_SCHEMA = 'engine.matter.fabric.ledger-event';
export const REALM_MATTER_LEDGER_EVENT_VERSION = '1.0.0';

const OPERATIONS = new Set(['set', 'increment', 'remove']);
const LEDGER_INPUT_KEYS = new Set(['ledgerId', 'genesisState']);
const APPEND_KEYS = new Set([
    'eventId', 'transformationId', 'inputStateHash', 'delta', 'generatedInstanceIds',
]);
const DELTA_KEYS = new Set(['op', 'path', 'value']);
const EVENT_KEYS = new Set([
    'schema', 'schemaVersion', 'eventId', 'ledgerId', 'sequence', 'instanceId', 'soulSeedId',
    'transformationId', 'previousEventHash', 'inputStateHash', 'outputStateHash', 'delta',
    'generatedInstanceIds', 'eventHash',
]);
const SNAPSHOT_KEYS = new Set([
    'schema', 'schemaVersion', 'ledgerId', 'instanceId', 'soulSeedId', 'genesisState',
    'genesisStateHash', 'events', 'currentState', 'currentStateHash',
]);

function validateDelta(delta, path = '$.delta') {
    if (!Array.isArray(delta) || delta.length === 0) fail(path, 'must be a non-empty array');
    return delta.map((operation, index) => {
        const itemPath = `${path}[${index}]`;
        requireExactKeys(operation, DELTA_KEYS, DELTA_KEYS, itemPath);
        requireEnum(operation.op, OPERATIONS, `${itemPath}.op`);
        if (!Array.isArray(operation.path) || operation.path.length === 0 || operation.path.length > 16) {
            fail(`${itemPath}.path`, 'must contain 1 to 16 object path segments');
        }
        operation.path.forEach((segment, segmentIndex) => requireIdentifier(segment, `${itemPath}.path[${segmentIndex}]`));
        if (operation.op === 'increment' && (typeof operation.value !== 'number' || !Number.isFinite(operation.value))) {
            fail(`${itemPath}.value`, 'must be finite for increment');
        }
        if (operation.op === 'remove' && operation.value !== null) fail(`${itemPath}.value`, 'must be null for remove');
        return operation;
    });
}

function locateParent(root, path, itemPath) {
    let parent = root;
    for (let index = 0; index < path.length - 1; index += 1) {
        const segment = path[index];
        if (!parent || typeof parent !== 'object' || Array.isArray(parent) || !Object.hasOwn(parent, segment)) {
            fail(`${itemPath}.path[${index}]`, 'does not resolve to an existing object');
        }
        parent = parent[segment];
    }
    if (!parent || typeof parent !== 'object' || Array.isArray(parent)) {
        fail(`${itemPath}.path`, 'parent is not an object');
    }
    return parent;
}

function applyDelta(state, delta) {
    const result = cloneStrictJson(state, '$.ledgerState');
    delta.forEach((operation, index) => {
        const itemPath = `$.delta[${index}]`;
        const parent = locateParent(result, operation.path, itemPath);
        const key = operation.path.at(-1);
        if (operation.op === 'set') {
            parent[key] = cloneStrictJson(operation.value, `${itemPath}.value`);
        } else if (operation.op === 'increment') {
            if (!Object.hasOwn(parent, key) || typeof parent[key] !== 'number' || !Number.isFinite(parent[key])) {
                fail(`${itemPath}.path`, 'increment target must be an existing finite number');
            }
            const next = parent[key] + operation.value;
            if (!Number.isFinite(next)) fail(`${itemPath}.value`, 'increment overflowed');
            parent[key] = next;
        } else {
            if (!Object.hasOwn(parent, key)) fail(`${itemPath}.path`, 'remove target does not exist');
            delete parent[key];
        }
    });
    return createRealmMatterState(result);
}

function eventPayload(event) {
    const { eventHash: _eventHash, ...payload } = event;
    return payload;
}

function validateEvent(value, path, previousHash, state) {
    requireExactKeys(value, EVENT_KEYS, EVENT_KEYS, path);
    if (value.schema !== REALM_MATTER_LEDGER_EVENT_SCHEMA) fail(`${path}.schema`, 'is unsupported');
    if (value.schemaVersion !== REALM_MATTER_LEDGER_EVENT_VERSION) fail(`${path}.schemaVersion`, 'is unsupported');
    for (const field of ['eventId', 'ledgerId', 'instanceId', 'soulSeedId', 'transformationId']) {
        requireIdentifier(value[field], `${path}.${field}`);
    }
    requireInteger(value.sequence, `${path}.sequence`, { minimum: 1 });
    if (value.previousEventHash !== null) requireHash(value.previousEventHash, `${path}.previousEventHash`);
    requireHash(value.inputStateHash, `${path}.inputStateHash`);
    requireHash(value.outputStateHash, `${path}.outputStateHash`);
    requireHash(value.eventHash, `${path}.eventHash`);
    validateDelta(value.delta, `${path}.delta`);
    requireIdentifierArray(value.generatedInstanceIds, `${path}.generatedInstanceIds`);
    if (value.generatedInstanceIds.includes(value.instanceId)) {
        fail(`${path}.generatedInstanceIds`, 'cannot regenerate the source instance identity');
    }
    if (value.previousEventHash !== previousHash) fail(`${path}.previousEventHash`, 'does not match the ledger chain');
    const actualInputHash = contentHash(state, `${path}.inputState`);
    if (value.inputStateHash !== actualInputHash) fail(`${path}.inputStateHash`, 'does not match replay state');
    const outputState = applyDelta(state, value.delta);
    if (outputState.instanceId !== state.instanceId || outputState.soulSeedId !== state.soulSeedId) {
        fail(`${path}.delta`, 'changes durable instance or Soul Seed identity');
    }
    if (outputState.revision !== state.revision + 1) fail(`${path}.delta`, 'does not advance revision exactly once');
    const expectedHistory = [...state.historyEventIds, value.eventId];
    if (JSON.stringify(outputState.historyEventIds) !== JSON.stringify(expectedHistory)) {
        fail(`${path}.delta`, 'does not append exactly one history event');
    }
    const actualOutputHash = contentHash(outputState, `${path}.outputState`);
    if (value.outputStateHash !== actualOutputHash) fail(`${path}.outputStateHash`, 'does not match the applied delta');
    const actualEventHash = contentHash(eventPayload(value), `${path}.eventPayload`);
    if (value.eventHash !== actualEventHash) fail(`${path}.eventHash`, 'does not bind the event payload');
    return outputState;
}

export class RealmMatterLedger {
    #ledgerId;
    #genesis;
    #genesisHash;
    #current;
    #events = [];
    #eventIds = new Set();
    #generatedInstanceIds = new Set();
    #diagnostics;

    constructor(input, { logger = null } = {}) {
        this.#diagnostics = new FabricDiagnostics('matter.fabric.ledger', logger);
        const token = this.#diagnostics.begin('ledger.create');
        try {
            const candidate = cloneStrictJson(input, '$.ledger');
            requireExactKeys(candidate, LEDGER_INPUT_KEYS, LEDGER_INPUT_KEYS, '$.ledger');
            this.#ledgerId = requireIdentifier(candidate.ledgerId, '$.ledger.ledgerId');
            this.#genesis = createRealmMatterState(candidate.genesisState);
            this.#genesisHash = contentHash(this.#genesis, '$.genesisState');
            this.#current = this.#genesis;
            this.#diagnostics.end(token, { ledgerId: this.#ledgerId, genesisStateHash: this.#genesisHash }, { stateChanged: true });
        } catch (error) {
            this.#diagnostics.error(token, error);
            throw error;
        }
    }

    appendEvent(input) {
        const token = this.#diagnostics.begin('ledger.append');
        try {
            const candidate = cloneStrictJson(input, '$.ledgerAppend');
            requireExactKeys(candidate, APPEND_KEYS, APPEND_KEYS, '$.ledgerAppend');
            requireIdentifier(candidate.eventId, '$.ledgerAppend.eventId');
            requireIdentifier(candidate.transformationId, '$.ledgerAppend.transformationId');
            requireHash(candidate.inputStateHash, '$.ledgerAppend.inputStateHash');
            requireIdentifierArray(candidate.generatedInstanceIds, '$.ledgerAppend.generatedInstanceIds');
            if (candidate.generatedInstanceIds.includes(this.#genesis.instanceId)) {
                fail('$.ledgerAppend.generatedInstanceIds', 'cannot regenerate the source instance identity');
            }
            candidate.generatedInstanceIds.forEach((id, index) => {
                if (this.#generatedInstanceIds.has(id)) {
                    fail(`$.ledgerAppend.generatedInstanceIds[${index}]`, 'was already generated by this lineage');
                }
            });
            const delta = validateDelta(candidate.delta, '$.ledgerAppend.delta');
            if (this.#eventIds.has(candidate.eventId)) fail('$.ledgerAppend.eventId', 'already exists in this ledger');
            const currentHash = contentHash(this.#current, '$.currentState');
            if (candidate.inputStateHash !== currentHash) fail('$.ledgerAppend.inputStateHash', 'is stale');
            const outputState = applyDelta(this.#current, delta);
            if (outputState.instanceId !== this.#genesis.instanceId || outputState.soulSeedId !== this.#genesis.soulSeedId) {
                fail('$.ledgerAppend.delta', 'cannot change instance or Soul Seed identity');
            }
            if (outputState.revision !== this.#current.revision + 1) {
                fail('$.ledgerAppend.delta', 'must advance state revision exactly once');
            }
            const expectedHistory = [...this.#current.historyEventIds, candidate.eventId];
            if (JSON.stringify(outputState.historyEventIds) !== JSON.stringify(expectedHistory)) {
                fail('$.ledgerAppend.delta', 'must append exactly the eventId to historyEventIds without rewriting history');
            }
            const payload = {
                schema: REALM_MATTER_LEDGER_EVENT_SCHEMA,
                schemaVersion: REALM_MATTER_LEDGER_EVENT_VERSION,
                eventId: candidate.eventId,
                ledgerId: this.#ledgerId,
                sequence: this.#events.length + 1,
                instanceId: this.#genesis.instanceId,
                soulSeedId: this.#genesis.soulSeedId,
                transformationId: candidate.transformationId,
                previousEventHash: this.#events.at(-1)?.eventHash ?? null,
                inputStateHash: currentHash,
                outputStateHash: contentHash(outputState, '$.outputState'),
                delta,
                generatedInstanceIds: candidate.generatedInstanceIds,
            };
            const event = freeze({ ...payload, eventHash: contentHash(payload, '$.ledgerEventPayload') }, '$.ledgerEvent');
            this.#events.push(event);
            this.#eventIds.add(event.eventId);
            event.generatedInstanceIds.forEach(id => this.#generatedInstanceIds.add(id));
            this.#current = outputState;
            this.#diagnostics.end(token, {
                eventId: event.eventId,
                sequence: event.sequence,
                deltaOperations: event.delta.length,
            }, { stateChanged: true });
            return event;
        } catch (error) {
            this.#diagnostics.error(token, error);
            throw error;
        }
    }

    currentState() { return this.#current; }
    currentStateHash() { return contentHash(this.#current, '$.currentState'); }
    events() { return freeze([...this.#events], '$.ledgerEvents'); }

    replay() {
        let state = this.#genesis;
        let previousHash = null;
        this.#events.forEach((event, index) => {
            state = validateEvent(event, `$.events[${index}]`, previousHash, state);
            previousHash = event.eventHash;
        });
        return state;
    }

    snapshot() {
        return freeze({
            schema: REALM_MATTER_LEDGER_SCHEMA,
            schemaVersion: REALM_MATTER_LEDGER_VERSION,
            ledgerId: this.#ledgerId,
            instanceId: this.#genesis.instanceId,
            soulSeedId: this.#genesis.soulSeedId,
            genesisState: this.#genesis,
            genesisStateHash: this.#genesisHash,
            events: [...this.#events],
            currentState: this.#current,
            currentStateHash: this.currentStateHash(),
        }, '$.ledgerSnapshot');
    }

    diagnostics() { return this.#diagnostics.snapshot(); }

    static restore(snapshot, options = {}) {
        const candidate = cloneStrictJson(snapshot, '$.ledgerSnapshot');
        requireRecord(candidate, '$.ledgerSnapshot');
        requireExactKeys(candidate, SNAPSHOT_KEYS, SNAPSHOT_KEYS, '$.ledgerSnapshot');
        if (candidate.schema !== REALM_MATTER_LEDGER_SCHEMA) fail('$.ledgerSnapshot.schema', 'is unsupported');
        if (candidate.schemaVersion !== REALM_MATTER_LEDGER_VERSION) fail('$.ledgerSnapshot.schemaVersion', 'is unsupported');
        requireIdentifier(candidate.ledgerId, '$.ledgerSnapshot.ledgerId');
        requireIdentifier(candidate.instanceId, '$.ledgerSnapshot.instanceId');
        requireIdentifier(candidate.soulSeedId, '$.ledgerSnapshot.soulSeedId');
        validateRealmMatterState(candidate.genesisState, '$.ledgerSnapshot.genesisState');
        validateRealmMatterState(candidate.currentState, '$.ledgerSnapshot.currentState');
        requireHash(candidate.genesisStateHash, '$.ledgerSnapshot.genesisStateHash');
        requireHash(candidate.currentStateHash, '$.ledgerSnapshot.currentStateHash');
        if (!Array.isArray(candidate.events)) fail('$.ledgerSnapshot.events', 'must be an array');
        if (candidate.instanceId !== candidate.genesisState.instanceId || candidate.soulSeedId !== candidate.genesisState.soulSeedId) {
            fail('$.ledgerSnapshot', 'identity does not match genesis state');
        }
        if (candidate.genesisStateHash !== contentHash(candidate.genesisState, '$.ledgerSnapshot.genesisState')) {
            fail('$.ledgerSnapshot.genesisStateHash', 'does not match genesis state');
        }
        const ledger = new RealmMatterLedger({ ledgerId: candidate.ledgerId, genesisState: candidate.genesisState }, options);
        let state = ledger.#genesis;
        let previousHash = null;
        candidate.events.forEach((event, index) => {
            if (event.sequence !== index + 1) fail(`$.ledgerSnapshot.events[${index}].sequence`, 'is not contiguous');
            if (event.ledgerId !== candidate.ledgerId || event.instanceId !== candidate.instanceId
                || event.soulSeedId !== candidate.soulSeedId) {
                fail(`$.ledgerSnapshot.events[${index}]`, 'ledger identity changed');
            }
            if (ledger.#eventIds.has(event.eventId)) fail(`$.ledgerSnapshot.events[${index}].eventId`, 'duplicates an earlier event');
            event.generatedInstanceIds?.forEach((id, generatedIndex) => {
                if (ledger.#generatedInstanceIds.has(id)) {
                    fail(`$.ledgerSnapshot.events[${index}].generatedInstanceIds[${generatedIndex}]`,
                        'was already generated by an earlier event');
                }
            });
            state = validateEvent(event, `$.ledgerSnapshot.events[${index}]`, previousHash, state);
            previousHash = event.eventHash;
            const frozenEvent = freeze(event, `$.ledgerSnapshot.events[${index}]`);
            ledger.#events.push(frozenEvent);
            ledger.#eventIds.add(frozenEvent.eventId);
            frozenEvent.generatedInstanceIds.forEach(id => ledger.#generatedInstanceIds.add(id));
        });
        if (contentHash(state, '$.ledgerSnapshot.replayedState') !== candidate.currentStateHash) {
            fail('$.ledgerSnapshot.currentStateHash', 'does not match replayed state');
        }
        if (contentHash(candidate.currentState, '$.ledgerSnapshot.currentState') !== candidate.currentStateHash) {
            fail('$.ledgerSnapshot.currentState', 'does not match currentStateHash');
        }
        ledger.#current = state;
        return ledger;
    }
}

export function createRealmMatterLedger(input, options = {}) {
    return new RealmMatterLedger(input, options);
}

export function restoreRealmMatterLedger(snapshot, options = {}) {
    return RealmMatterLedger.restore(snapshot, options);
}
