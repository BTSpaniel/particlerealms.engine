// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Atomic compare-and-swap storage for immutable matter-region states. */

import { cloneStrictJson, deepFreezeJson, isPlainJsonObject } from '../../core/schema/StrictJsonValue.js';
import { createMatterState } from '../contracts/MatterContracts.js';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;
const COMMIT_KEYS = new Set(['transactionId', 'expectedRevisions', 'put', 'remove']);

function fail(message) {
    throw new TypeError(`MatterStateStore: ${message}`);
}

function identifier(value, label) {
    if (typeof value !== 'string' || !IDENTIFIER.test(value)) fail(`${label} has invalid syntax`);
    return value;
}

function revision(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative safe integer`);
    return value;
}

function exactCommit(value) {
    if (!isPlainJsonObject(value)) fail('commit request must be a plain object');
    for (const key of Object.keys(value)) {
        if (!COMMIT_KEYS.has(key)) fail(`commit.${key} is an unknown field`);
    }
    if (!Object.hasOwn(value, 'transactionId')) fail('commit.transactionId is required');
    return value;
}

function frozenOrdered(states) {
    return deepFreezeJson(
        [...states.values()].sort((left, right) => left.regionId.localeCompare(right.regionId)),
        '$.matterStateStore.states',
    );
}

export class MatterStateStore {
    #states;
    #ordered;
    #transactionIds;

    constructor(states = []) {
        if (!Array.isArray(states)) fail('constructor states must be an array');
        this.#states = new Map();
        this.#transactionIds = new Set();
        for (const [index, input] of states.entries()) {
            const state = createMatterState(input);
            if (this.#states.has(state.regionId)) {
                fail(`constructor state ${index} duplicates region '${state.regionId}'`);
            }
            this.#states.set(state.regionId, state);
        }
        this.#ordered = frozenOrdered(this.#states);
        Object.freeze(this);
    }

    get size() {
        return this.#states.size;
    }

    has(regionId) {
        return this.#states.has(identifier(regionId, 'regionId'));
    }

    get(regionId) {
        return this.#states.get(identifier(regionId, 'regionId')) ?? null;
    }

    list() {
        return this.#ordered;
    }

    commit(request) {
        const source = exactCommit(cloneStrictJson(request, '$.matterStateStore.commit'));
        const transactionId = identifier(source.transactionId, 'commit.transactionId');
        if (this.#transactionIds.has(transactionId)) fail(`transaction '${transactionId}' is duplicated`);

        const expectedRevisions = source.expectedRevisions ?? {};
        if (!isPlainJsonObject(expectedRevisions)) fail('commit.expectedRevisions must be a plain object');
        const expected = new Map();
        for (const [regionId, value] of Object.entries(expectedRevisions)) {
            const id = identifier(regionId, 'commit.expectedRevisions regionId');
            expected.set(id, revision(value, `commit.expectedRevisions.${id}`));
        }

        const putInput = source.put ?? [];
        const removeInput = source.remove ?? [];
        if (!Array.isArray(putInput)) fail('commit.put must be an array');
        if (!Array.isArray(removeInput)) fail('commit.remove must be an array');

        const puts = new Map();
        for (const [index, input] of putInput.entries()) {
            const state = createMatterState(input);
            if (puts.has(state.regionId)) fail(`commit.put duplicates region '${state.regionId}'`);
            puts.set(state.regionId, state);
            if (state.regionId !== input.regionId) fail(`commit.put[${index}] changed region identity during normalization`);
        }

        const removes = new Set();
        for (const [index, input] of removeInput.entries()) {
            const regionId = identifier(input, `commit.remove[${index}]`);
            if (removes.has(regionId)) fail(`commit.remove duplicates region '${regionId}'`);
            if (puts.has(regionId)) fail(`commit cannot put and remove region '${regionId}'`);
            removes.add(regionId);
        }

        for (const [regionId, expectedRevision] of expected) {
            const current = this.#states.get(regionId);
            if (!current) fail(`expected revision names unknown region '${regionId}'`);
            if (current.revision !== expectedRevision) {
                fail(`stale revision for '${regionId}': expected ${expectedRevision}, current ${current.revision}`);
            }
        }

        const candidate = new Map(this.#states);
        for (const [regionId, state] of puts) {
            const current = this.#states.get(regionId);
            if (current) {
                if (!expected.has(regionId)) fail(`existing put '${regionId}' requires an expected revision`);
                if (state.revision !== current.revision + 1) {
                    fail(`existing put '${regionId}' revision must equal ${current.revision + 1}`);
                }
            } else if (state.revision !== 0) {
                fail(`new put '${regionId}' revision must equal 0`);
            }
            candidate.set(regionId, state);
        }
        for (const regionId of removes) {
            if (!this.#states.has(regionId)) fail(`remove names unknown region '${regionId}'`);
            if (!expected.has(regionId)) fail(`remove '${regionId}' requires an expected revision`);
            candidate.delete(regionId);
        }

        const before = this.#ordered;
        const after = frozenOrdered(candidate);
        const receipt = deepFreezeJson({
            transactionId,
            putRegionIds: [...puts.keys()].sort(),
            removedRegionIds: [...removes].sort(),
            before,
            after,
        }, '$.matterStateStore.receipt');

        this.#states = candidate;
        this.#ordered = after;
        this.#transactionIds.add(transactionId);
        return receipt;
    }
}

export default MatterStateStore;

