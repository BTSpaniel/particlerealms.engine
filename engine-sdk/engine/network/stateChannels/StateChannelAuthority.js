// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
    STATE_CHANNEL_MESSAGE,
    STATE_CHANNEL_PROJECTION,
    createMergePatch,
    createStateProjection,
    createStateReceipt,
    jsonClone,
    validateStateChannelMessage,
} from './StateChannelContract.js';

export class StateChannelAuthority {
    constructor(contract, options = {}) {
        if (!contract?.id) throw new TypeError('StateChannelAuthority requires a contract');
        this.contract = contract;
        this.state = jsonClone(options.initialState ?? contract.initialState);
        this.revision = Number(options.revision ?? 0);
        this.sequence = Number(options.sequence ?? 0);
        this.authorityId = String(options.authorityId ?? 'host');
        this.authorityEpoch = Number(options.authorityEpoch ?? 0);
        this.fencingToken = Number(options.fencingToken ?? 0);
        this.commit = typeof options.commit === 'function' ? options.commit : null;
        this.listeners = new Set();
        this.receipts = new Map();
        this.maxReceipts = Number(options.maxReceipts ?? 2048);
        this.logger = options.logger ?? console;
        this.queue = Promise.resolve();
    }

    snapshot(options = {}) {
        return createStateProjection(this.contract.id, this.state, {
            version: this.contract.wireVersion,
            projectionKind: STATE_CHANNEL_PROJECTION.SNAPSHOT,
            revision: this.revision,
            sequence: this.sequence,
            authorityId: this.authorityId,
            authorityEpoch: this.authorityEpoch,
            causedBy: options.causedBy,
        });
    }

    /** Durable authority state used by witnesses and takeover candidates. */
    checkpoint() {
        return Object.freeze({
            format: 'particle-state-channel-checkpoint-v1',
            channelId: this.contract.id,
            state: jsonClone(this.state),
            revision: this.revision,
            sequence: this.sequence,
            authorityId: this.authorityId,
            authorityEpoch: this.authorityEpoch,
            fencingToken: this.fencingToken,
            receipts: Object.freeze([...this.receipts.values()].slice(-this.maxReceipts).map(jsonClone)),
            createdAt: Date.now(),
        });
    }

    /** Restore a non-regressing checkpoint before resuming authority work. */
    restoreCheckpoint(checkpoint) {
        if (!checkpoint || checkpoint.format !== 'particle-state-channel-checkpoint-v1'
            || checkpoint.channelId !== this.contract.id) throw new TypeError('Invalid State Channel checkpoint');
        for (const field of ['revision', 'sequence', 'authorityEpoch', 'fencingToken']) {
            if (!Number.isSafeInteger(checkpoint[field]) || checkpoint[field] < 0) throw new TypeError(`Invalid checkpoint ${field}`);
        }
        if (checkpoint.fencingToken < this.fencingToken
            || checkpoint.authorityEpoch < this.authorityEpoch
            || checkpoint.revision < this.revision
            || checkpoint.sequence < this.sequence) {
            throw new Error('State Channel checkpoint would regress authority state');
        }
        this.state = jsonClone(checkpoint.state);
        this.revision = checkpoint.revision;
        this.sequence = checkpoint.sequence;
        this.authorityId = String(checkpoint.authorityId);
        this.authorityEpoch = checkpoint.authorityEpoch;
        this.fencingToken = checkpoint.fencingToken;
        this.receipts.clear();
        for (const receipt of checkpoint.receipts ?? []) {
            if (validateStateChannelMessage(receipt, this.contract.id)
                && receipt.kind === STATE_CHANNEL_MESSAGE.RECEIPT) this.#remember(Object.freeze(jsonClone(receipt)));
        }
        this.logger.debug?.(`[StateChannelAuthority][restore][exit] channel=${this.contract.id} revision=${this.revision} epoch=${this.authorityEpoch} fence=${this.fencingToken}`);
        return this.snapshot();
    }

    subscribe(listener, options = {}) {
        if (typeof listener !== 'function') throw new TypeError('Authority subscriber must be a function');
        this.listeners.add(listener);
        if (options.replay !== false) listener(this.snapshot());
        return () => this.listeners.delete(listener);
    }

    submit(intent, context = {}) {
        const run = () => this.#submit(intent, context);
        const result = this.queue.then(run, run);
        this.queue = result.catch(() => {});
        return result;
    }

    replaceState(nextState, options = {}) {
        const previous = this.state;
        this.state = jsonClone(nextState);
        this.revision = Number(options.revision ?? this.revision + 1);
        this.sequence++;
        const projection = this.#projection(previous, null, options.projectionKind);
        this.logger.debug?.(`[StateChannelAuthority][replace][exit] channel=${this.contract.id} revision=${this.revision} sequence=${this.sequence}`);
        this.#emit(projection);
        return projection;
    }

    transferAuthority({ authorityId, fencingToken }) {
        const nextToken = Number(fencingToken);
        if (!Number.isSafeInteger(nextToken) || nextToken <= this.fencingToken) {
            throw new Error('Authority transfer requires a strictly newer fencing token');
        }
        this.authorityId = String(authorityId);
        this.fencingToken = nextToken;
        this.authorityEpoch++;
        this.logger.debug?.(`[StateChannelAuthority][transfer][exit] channel=${this.contract.id} authority=${this.authorityId} epoch=${this.authorityEpoch} fence=${this.fencingToken}`);
        return this.snapshot();
    }

    async #submit(intent, context) {
        const startedAt = globalThis.performance?.now?.() ?? Date.now();
        this.logger.debug?.(`[StateChannelAuthority][submit][entry] channel=${this.contract.id} intent=${intent?.id ?? 'invalid'} action=${intent?.action ?? 'invalid'}`);
        let rejection = this.#validateIntent(intent, context);
        if (this.receipts.has(intent?.id)) {
            const original = this.receipts.get(intent.id);
            const duplicate = createStateReceipt(intent, {
                version: this.contract.wireVersion,
                status: 'duplicate',
                reason: original.status,
                revision: original.revision,
                sequence: this.sequence,
                authorityEpoch: this.authorityEpoch,
            });
            this.#emit(duplicate);
            this.logger.debug?.(`[StateChannelAuthority][submit][duplicate] channel=${this.contract.id} intent=${intent.id}`);
            return duplicate;
        }
        if (!rejection && this.contract.authorize) {
            const authorization = await this.contract.authorize(intent, this.state, context);
            if (authorization !== true) rejection = typeof authorization === 'string' ? authorization : 'unauthorized';
        }
        if (rejection) return this.#reject(intent, rejection);

        const descriptor = this.contract.intents[intent.action];
        const validate = typeof descriptor === 'object' ? descriptor.validate : null;
        if (validate) {
            const validation = await validate(intent.payload, { intent, state: jsonClone(this.state), context });
            if (validation !== true) return this.#reject(intent, typeof validation === 'string' ? validation : 'invalid-payload');
        }
        const reduce = typeof descriptor === 'function' ? descriptor : descriptor?.reduce ?? this.contract.reduce;
        if (typeof reduce !== 'function') return this.#reject(intent, 'missing-reducer');

        const previous = this.state;
        let next = await reduce(jsonClone(previous), intent.payload, { intent, context, contract: this.contract });
        next = jsonClone(next);
        if (this.commit) {
            const committed = await this.commit(next, { previous: jsonClone(previous), intent, context, revision: this.revision });
            if (committed?.ok === false) return this.#reject(intent, committed.reason ?? 'commit-failed');
            next = jsonClone(committed?.state ?? committed?.value ?? next);
        }
        this.state = next;
        this.revision++;
        this.sequence++;
        const projection = this.#projection(previous, intent);
        this.#emit(projection);
        const receipt = createStateReceipt(intent, {
            version: this.contract.wireVersion,
            status: 'accepted',
            revision: this.revision,
            sequence: this.sequence,
            authorityEpoch: this.authorityEpoch,
        });
        this.#remember(receipt);
        this.#emit(receipt);
        const durationMs = (globalThis.performance?.now?.() ?? Date.now()) - startedAt;
        this.logger.debug?.(`[StateChannelAuthority][submit][exit] channel=${this.contract.id} intent=${intent.id} revision=${this.revision} durationMs=${durationMs.toFixed(3)}`);
        return receipt;
    }

    #validateIntent(intent, context) {
        if (!validateStateChannelMessage(intent, this.contract.id) || intent.kind !== STATE_CHANNEL_MESSAGE.INTENT) return 'invalid-intent';
        if (!Object.hasOwn(this.contract.intents, intent.action)) return 'unknown-action';
        if (intent.expectedRevision != null && intent.expectedRevision !== this.revision) return 'revision-conflict';
        if (intent.authorityEpoch != null && intent.authorityEpoch !== this.authorityEpoch) return 'stale-authority';
        if (context.fencingToken !== undefined && Number(context.fencingToken) !== this.fencingToken) return 'stale-fencing-token';
        return null;
    }

    #projection(previous, intent, forcedKind = null) {
        if (this.contract.project) {
            const projected = this.contract.project({ state: jsonClone(this.state), previous: jsonClone(previous), intent });
            const projectionKind = projected?.projectionKind ?? STATE_CHANNEL_PROJECTION.MERGE_PATCH;
            return createStateProjection(this.contract.id, projected?.data ?? projected, {
                version: this.contract.wireVersion,
                projectionKind,
                revision: this.revision,
                sequence: this.sequence,
                authorityId: this.authorityId,
                authorityEpoch: this.authorityEpoch,
                causedBy: intent?.id,
            });
        }
        const projectionKind = forcedKind ?? STATE_CHANNEL_PROJECTION.MERGE_PATCH;
        const data = projectionKind === STATE_CHANNEL_PROJECTION.SNAPSHOT ? this.state : createMergePatch(previous, this.state);
        return createStateProjection(this.contract.id, data, {
            version: this.contract.wireVersion,
            projectionKind,
            revision: this.revision,
            sequence: this.sequence,
            authorityId: this.authorityId,
            authorityEpoch: this.authorityEpoch,
            causedBy: intent?.id,
        });
    }

    #reject(intent, reason) {
        const safeIntent = {
            channelId: this.contract.id,
            id: String(intent?.id ?? 'invalid'),
            clientId: String(intent?.clientId ?? 'anonymous'),
        };
        const receipt = createStateReceipt(safeIntent, {
            version: this.contract.wireVersion,
            status: 'rejected', reason, revision: this.revision, sequence: this.sequence, authorityEpoch: this.authorityEpoch,
        });
        if (intent?.id) this.#remember(receipt);
        this.logger.warn?.(`[StateChannelAuthority][submit][rejected] channel=${this.contract.id} intent=${safeIntent.id} reason=${reason}`);
        this.#emit(receipt);
        return receipt;
    }

    #remember(receipt) {
        this.receipts.set(receipt.intentId, receipt);
        while (this.receipts.size > this.maxReceipts) this.receipts.delete(this.receipts.keys().next().value);
    }

    #emit(message) {
        for (const listener of [...this.listeners]) {
            try { listener(message); }
            catch (error) { this.logger.error?.('[StateChannelAuthority][listener]', error); }
        }
    }
}
