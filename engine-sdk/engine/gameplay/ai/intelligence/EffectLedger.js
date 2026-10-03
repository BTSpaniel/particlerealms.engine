// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
    actorTaskError, copyActorTaskData, freezeActorTaskData, requireActorTaskIdentifier,
    requireActorTaskRevision, sameActorTaskData, ACTOR_TASK_LIMITS,
} from './RegisteredMethods.js';

function normalizeEffect(raw) {
    const effect = copyActorTaskData(raw);
    for (const field of ['actorId', 'taskId', 'intentId', 'admissionId', 'operation']) requireActorTaskIdentifier(effect[field], field);
    requireActorTaskRevision(effect.expectedRevision, 'expectedRevision');
    if (!Object.hasOwn(effect, 'payload') || !Array.isArray(effect.sourceRefs)) throw actorTaskError('ACTOR_EFFECT_INVALID', 'Effects require payload and original source references');
    return freezeActorTaskData(effect);
}

function normalizeReceipt(raw, effect) {
    const receipt = copyActorTaskData(raw);
    if (receipt.actorId !== effect.actorId || receipt.taskId !== effect.taskId || receipt.intentId !== effect.intentId
        || !['pending', 'completed', 'rejected'].includes(receipt.status)) {
        throw actorTaskError('ACTOR_RECEIPT_SCOPE', 'Effect receipt does not identify the requested actor, task and intent');
    }
    requireActorTaskRevision(receipt.revision, 'receipt revision');
    if (receipt.revision < effect.expectedRevision) throw actorTaskError('ACTOR_RECEIPT_REVISION', 'Effect receipt predates its expected revision');
    return freezeActorTaskData(receipt);
}

/**
 * A checkpoint journal, not an effect authority. The actions owner MUST atomically
 * compare expectedRevision, authorize the complete request, apply its domain
 * change and durably record a receipt in executeOnce. An intent ID is scoped to
 * actor+task and immutable payload. readReceipt is that SAME owner's authoritative
 * lookup. Separate localStorage writes or a memory Set cannot satisfy this port.
 * A lost reply or absent receipt never authorizes redispatch.
 * Snapshot-only validation may omit callbacks. Reconciliation requires an
 * explicit checkpoint writer; execution additionally requires a synchronous
 * dispatch assertion. Neither has an implicit permissive default.
 */
export function createEffectLedger({ actions, entries = [], checkpoint = null, assertDispatch = null } = {}) {
    for (const name of ['executeOnce', 'readReceipt']) {
        if (typeof actions?.[name] !== 'function') throw actorTaskError('ACTOR_EFFECT_OWNER_MISSING', `Authoritative actions.${name} is required`);
    }
    if ((checkpoint !== null && typeof checkpoint !== 'function')
        || (assertDispatch !== null && typeof assertDispatch !== 'function')) throw new TypeError('Ledger callbacks must be callable when supplied');
    if (!Array.isArray(entries) || entries.length > ACTOR_TASK_LIMITS.steps) throw actorTaskError('ACTOR_EFFECT_LIMIT', 'Invalid effect checkpoint');
    const records = new Map();
    let busy = false;
    for (const raw of entries) {
        const entry = copyActorTaskData(raw);
        entry.effect = normalizeEffect(entry.effect);
        if (!['dispatching', 'uncertain', 'pending', 'completed', 'rejected'].includes(entry.status)
            || records.has(entry.effect.intentId)) throw actorTaskError('ACTOR_EFFECT_CHECKPOINT', 'Invalid or duplicate effect checkpoint');
        entry.receipt = entry.receipt === null ? null : normalizeReceipt(entry.receipt, entry.effect);
        if (['completed', 'rejected'].includes(entry.status) && entry.receipt?.status !== entry.status) throw actorTaskError('ACTOR_EFFECT_CHECKPOINT', 'Terminal effect state requires its matching receipt');
        if ((entry.status === 'dispatching' && entry.receipt !== null)
            || (entry.status === 'pending' && entry.receipt?.status !== 'pending')) throw actorTaskError('ACTOR_EFFECT_CHECKPOINT', 'Effect state conflicts with its retained receipt');
        records.set(entry.effect.intentId, entry);
    }
    const snapshot = () => [...records.values()].map(copyActorTaskData);
    const requireCheckpoint = () => {
        if (typeof checkpoint !== 'function') throw actorTaskError('ACTOR_CHECKPOINT_MISSING', 'Effect operations require an explicit checkpoint writer');
    };
    const save = async () => {
        requireCheckpoint();
        if (await checkpoint(snapshot()) === false) throw actorTaskError('ACTOR_CHECKPOINT_FAILED', 'Effect checkpoint was not accepted');
    };
    const requireDispatch = () => {
        const result = assertDispatch();
        if (result?.then) {
            void Promise.resolve(result).catch(() => {});
            throw actorTaskError('ACTOR_EFFECT_DISPATCH_ASYNC', 'Effect dispatch assertion must be synchronous');
        }
        if (result === false) throw actorTaskError('ACTOR_EFFECT_DISPATCH_DENIED', 'Effect dispatch assertion refused the request');
    };
    const settle = async (entry, raw) => {
        if (raw == null) {
            entry.status = 'uncertain'; entry.errorCode = 'ACTOR_RECEIPT_UNAVAILABLE';
        } else {
            const receipt = normalizeReceipt(raw, entry.effect);
            if (entry.receipt && ['completed', 'rejected'].includes(entry.receipt.status)
                && !sameActorTaskData(receipt, entry.receipt)) throw actorTaskError('ACTOR_RECEIPT_CHANGED', 'Authoritative terminal receipt changed');
            entry.receipt = receipt; entry.status = receipt.status; entry.errorCode = null;
        }
        await save();
        return copyActorTaskData(entry);
    };
    const reconcileEntry = async entry => {
        try {
            const effect = entry.effect;
            return await settle(entry, await actions.readReceipt(freezeActorTaskData({
                actorId: effect.actorId, taskId: effect.taskId, intentId: effect.intentId,
            })));
        } catch (error) {
            entry.status = 'uncertain'; entry.errorCode = error?.code ?? 'ACTOR_RECEIPT_READ_FAILED';
            await save();
            return copyActorTaskData(entry);
        }
    };
    const exclusive = async work => {
        if (busy) throw actorTaskError('ACTOR_EFFECT_BUSY', 'An effect owner operation is already pending');
        busy = true;
        try { return await work(); } finally { busy = false; }
    };
    return Object.freeze({
        snapshot,
        execute: raw => exclusive(async () => {
            requireCheckpoint();
            if (typeof assertDispatch !== 'function') throw actorTaskError('ACTOR_EFFECT_DISPATCH_MISSING', 'Effect execution requires an explicit dispatch assertion');
            const effect = normalizeEffect(raw);
            const prior = records.get(effect.intentId);
            if (prior) {
                if (!sameActorTaskData(prior.effect, effect)) throw actorTaskError('ACTOR_EFFECT_CONFLICT', 'An intent ID cannot be rebound to another effect');
                return reconcileEntry(prior);
            }
            if (records.size >= ACTOR_TASK_LIMITS.steps) throw actorTaskError('ACTOR_EFFECT_LIMIT', 'Task effect budget exhausted');
            const entry = { effect, status: 'dispatching', receipt: null, errorCode: null };
            records.set(effect.intentId, entry);
            // Persist dispatch uncertainty BEFORE contacting the owner. If this
            // checkpoint fails, nothing is dispatched, and recovery remains closed.
            try { await save(); requireDispatch(); }
            catch (error) {
                // This live call knows executeOnce has never been invoked. A
                // successfully persisted removal permits safe future work; it
                // does not invent an owner rejection or effect receipt. A
                // crash before removal persists still restores closed.
                records.delete(effect.intentId);
                try { await save(); }
                catch {
                    entry.status = 'uncertain'; entry.errorCode = error?.code ?? 'ACTOR_CHECKPOINT_FAILED';
                    records.set(effect.intentId, entry);
                    await save().catch(() => {});
                }
                throw error;
            }
            try { return await settle(entry, await actions.executeOnce(effect)); }
            catch (error) {
                entry.status = 'uncertain'; entry.errorCode = error?.code ?? 'ACTOR_EFFECT_OUTCOME_UNKNOWN';
                await save();
                return copyActorTaskData(entry);
            }
        }),
        reconcile: intentId => exclusive(async () => {
            requireCheckpoint();
            const entry = records.get(intentId);
            if (!entry) throw actorTaskError('ACTOR_EFFECT_UNKNOWN', 'No checkpoint exists for this effect');
            return reconcileEntry(entry);
        }),
    });
}
