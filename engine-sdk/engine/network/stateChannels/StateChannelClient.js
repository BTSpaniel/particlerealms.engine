// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
    STATE_CHANNEL_MESSAGE,
    applyStateProjection,
    createStateIntent,
    jsonClone,
    readStateChannelMessage,
} from './StateChannelContract.js';

export class StateChannelClient {
    constructor(contract, options = {}) {
        if (!contract?.id) throw new TypeError('StateChannelClient requires a contract');
        this.contract = contract;
        this.clientId = String(options.clientId ?? `client-${Math.random().toString(36).slice(2)}`);
        this.state = jsonClone(options.initialState ?? contract.initialState);
        this.revision = Number(options.revision ?? 0);
        this.sequence = Number(options.sequence ?? 0);
        this.authorityEpoch = Number(options.authorityEpoch ?? 0);
        this.transport = null;
        this.unsubscribe = null;
        this.listeners = new Set();
        this.receiptListeners = new Set();
        this.pending = new Map();
        this.timeoutMs = Number(options.timeoutMs ?? 15_000);
        this.logger = options.logger ?? console;
        this.status = 'idle';
    }

    async connect(transport) {
        if (!transport?.subscribe || !transport?.sendIntent) throw new TypeError('Invalid state channel transport');
        this.disconnect();
        this.transport = transport;
        this.unsubscribe = transport.subscribe((message) => this.receive(message));
        this.status = 'connected';
        if (typeof transport.start === 'function') await transport.start();
        if (typeof transport.requestSnapshot === 'function') await transport.requestSnapshot();
        this.logger.debug?.(`[StateChannelClient][connect][exit] channel=${this.contract.id} client=${this.clientId}`);
        return this;
    }

    disconnect() {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.transport?.stop?.();
        this.transport = null;
        this.status = 'idle';
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error('State channel disconnected'));
        }
        this.pending.clear();
        this.logger.debug?.(`[StateChannelClient][disconnect][exit] channel=${this.contract.id} client=${this.clientId}`);
    }

    subscribe(listener, options = {}) {
        if (typeof listener !== 'function') throw new TypeError('State channel subscriber must be a function');
        this.listeners.add(listener);
        if (options.immediate !== false) listener(this.getState(), null);
        return () => this.listeners.delete(listener);
    }

    onReceipt(listener) {
        this.receiptListeners.add(listener);
        return () => this.receiptListeners.delete(listener);
    }

    getState() {
        return jsonClone(this.state);
    }

    submit(action, payload, options = {}) {
        if (!this.transport) return Promise.reject(new Error('State channel is not connected'));
        const intent = createStateIntent(this.contract.id, action, payload, {
            ...options,
            version: options.version ?? this.contract.wireVersion,
            clientId: this.clientId,
            expectedRevision: options.expectedRevision ?? this.revision,
            authorityEpoch: options.authorityEpoch ?? this.authorityEpoch,
        });
        this.logger.debug?.(`[StateChannelClient][submit][entry] channel=${this.contract.id} intent=${intent.id} action=${action} expectedRevision=${intent.expectedRevision}`);
        const receiptPromise = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(intent.id);
                reject(new Error(`State channel intent timed out: ${intent.id}`));
            }, options.timeoutMs ?? this.timeoutMs);
            this.pending.set(intent.id, {
                resolve,
                reject,
                timer,
                clientId: intent.clientId,
                authorityEpoch: intent.authorityEpoch,
            });
        });
        Promise.resolve(this.transport.sendIntent(intent)).catch((error) => {
            const pending = this.pending.get(intent.id);
            if (!pending) return;
            clearTimeout(pending.timer);
            this.pending.delete(intent.id);
            pending.reject(error);
        });
        return receiptPromise;
    }

    receive(message) {
        let safeMessage;
        try { safeMessage = readStateChannelMessage(message, this.contract.id); }
        catch { return false; }
        if (safeMessage.kind === STATE_CHANNEL_MESSAGE.PROJECTION) return this.#receiveProjection(safeMessage);
        if (safeMessage.kind === STATE_CHANNEL_MESSAGE.RECEIPT) return this.#receiveReceipt(safeMessage);
        return false;
    }

    #receiveProjection(message) {
        if (message.authorityEpoch < this.authorityEpoch) return false;
        if (message.authorityEpoch === this.authorityEpoch && message.sequence < this.sequence) return false;
        const hasGap = message.sequence > this.sequence + 1 && message.projectionKind !== 'snapshot';
        if (hasGap) {
            this.logger.warn?.(`[StateChannelClient][projection][gap] channel=${this.contract.id} current=${this.sequence} received=${message.sequence}`);
            this.transport?.requestSnapshot?.();
            return false;
        }
        const previous = this.state;
        this.state = applyStateProjection(this.state, message);
        this.revision = message.revision;
        this.sequence = message.sequence;
        this.authorityEpoch = message.authorityEpoch;
        for (const listener of [...this.listeners]) {
            try { listener(this.getState(), message, jsonClone(previous)); }
            catch (error) { this.logger.error?.('[StateChannelClient][listener]', error); }
        }
        this.logger.debug?.(`[StateChannelClient][projection][applied] channel=${this.contract.id} revision=${this.revision} sequence=${this.sequence}`);
        return true;
    }

    #receiveReceipt(receipt) {
        const pending = this.pending.get(receipt.intentId);
        if (receipt.clientId !== this.clientId) return false;
        if (pending && (receipt.clientId !== pending.clientId
            || (pending.authorityEpoch !== null && receipt.authorityEpoch < pending.authorityEpoch))) return false;
        if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(receipt.intentId);
            if (receipt.status === 'rejected') pending.reject(Object.assign(new Error(receipt.reason ?? 'Intent rejected'), { receipt }));
            else pending.resolve(receipt);
        }
        for (const listener of [...this.receiptListeners]) listener(receipt);
        this.logger.debug?.(`[StateChannelClient][receipt] channel=${this.contract.id} intent=${receipt.intentId} status=${receipt.status}`);
        return true;
    }
}
