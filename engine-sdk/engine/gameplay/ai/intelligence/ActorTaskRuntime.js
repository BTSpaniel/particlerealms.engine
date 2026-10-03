// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createWorkingMemory } from '../../../sim/ai/AIMemory.js';
import { createEffectLedger } from './EffectLedger.js';
import {
    ACTOR_TASK_LIMITS, actorTaskError, copyActorTaskData, createRegisteredMethods,
    freezeActorTaskData, nextRegisteredStep, requireActorTaskIdentifier,
    requireActorTaskRevision, resolveMethodPayload, sameActorTaskData,
} from './RegisteredMethods.js';

export const ACTOR_TASK_PORTS = Object.freeze(['self', 'perception', 'memory', 'meaning', 'navigation', 'actions', 'communication']);
const TERMINAL = new Set(['completed', 'cancelled', 'rejected']);
const STATUSES = new Set(['proposed', 'active', 'paused', 'blocked', ...TERMINAL]);
const ARCHIVE_RETAINED_TASKS = 4;
const REQUIRED = Object.freeze({
    self: ['read'], perception: ['observe'], memory: ['read', 'write'], meaning: ['resolve'],
    navigation: ['resolveTarget'], actions: ['admitTask', 'executeOnce', 'readReceipt', 'suspendTask'],
    communication: ['prepare'],
});

function normalizedIntent(raw, actorId) {
    const intent = copyActorTaskData(raw);
    requireActorTaskIdentifier(intent.taskId, 'taskId');
    if (intent.actorId !== actorId || !intent.goal || typeof intent.goal !== 'object' || Array.isArray(intent.goal)) {
        throw actorTaskError('ACTOR_TASK_SCOPE', 'Task intent must name this actor and contain a structured goal');
    }
    requireActorTaskIdentifier(intent.methodId, 'methodId');
    if (!Number.isSafeInteger(intent.methodVersion) || intent.methodVersion < 1) throw actorTaskError('ACTOR_METHOD_VERSION', 'An exact registered method version is required');
    for (const name of ['constraints', 'quantities']) {
        intent[name] ??= {};
        if (!intent[name] || typeof intent[name] !== 'object' || Array.isArray(intent[name])) throw actorTaskError('ACTOR_INTENT_INVALID', `${name} must be a data record`);
    }
    intent.sourceRefs ??= [];
    if (!Array.isArray(intent.sourceRefs) || intent.sourceRefs.length > 64
        || intent.sourceRefs.some(value => typeof value !== 'string' || !value.length || value.length > 2048)) {
        throw actorTaskError('ACTOR_INTENT_INVALID', 'Task source references must be bounded non-empty strings');
    }
    return intent;
}

function unresolved(task) {
    return task.effects.some(effect => !['completed', 'rejected'].includes(effect.status));
}

function availableData(raw, port) {
    const value = raw == null ? null : copyActorTaskData(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.available === false || value.supported === false || value.resolved === false
        || ['unavailable', 'unsupported', 'unresolved', 'blocked', 'rejected', 'failed', 'pending', 'unknown', 'budget-exhausted'].includes(value.status)) {
        throw actorTaskError(`ACTOR_${port.toUpperCase()}_UNAVAILABLE`, `${port} did not provide an available host result`);
    }
    return value;
}

/**
 * One actor-private state and one task owner. Seven injected host ports supply
 * observations, meanings, navigation and effect authority. This interpreter
 * never writes world inventory, cargo, poses, program state or communications.
 * Its memory port stores private checkpoints/archives; actions owns atomic effects/receipts.
 * The host must serialize actor admission against its authoritative revision.
 * Clock/random are host-owned; no wall-clock time or global RNG enters state.
 */
export function createActorTaskRuntime({ actorId, ports, clock, random, methods = createRegisteredMethods(), logger = null, state = null } = {}) {
    requireActorTaskIdentifier(actorId, 'actorId');
    if (typeof clock !== 'function' || typeof random !== 'function') throw new TypeError('Actor runtime requires host clock and random functions');
    for (const name of ACTOR_TASK_PORTS) for (const method of REQUIRED[name]) {
        if (typeof ports?.[name]?.[method] !== 'function') throw actorTaskError('ACTOR_PORT_MISSING', `${name}.${method} is required`);
    }
    const archival = typeof ports.memory.archive === 'function';
    if (archival !== (typeof ports.memory.hasArchivedTask === 'function')
        || (ports.memory.archive != null && !archival)
        || (ports.memory.hasArchivedTask != null && typeof ports.memory.hasArchivedTask !== 'function')) {
        throw actorTaskError('ACTOR_ARCHIVE_PORT_INVALID', 'Archival requires paired archive and hasArchivedTask memory methods');
    }
    if (typeof methods?.expand !== 'function') throw new TypeError('A registered method catalog is required');
    const carePorts = ['prepareCareInterruption', 'validateCareReturn'];
    const careEnabled = carePorts.every(name => typeof ports.actions[name] === 'function');
    if (!careEnabled && carePorts.some(name => ports.actions[name] != null)) throw actorTaskError('ACTOR_CARE_PORT_INVALID', 'Care requires paired interruption and return validation ports');
    let current = { format: 'actor-task-runtime', version: 1, actorId, tick: 0,
        currentTask: null, history: [], workingMemory: createWorkingMemory(ACTOR_TASK_LIMITS.observations) };
    let generation = 0;
    let readyPromise = null;
    let initialized = false;
    let operationTail = Promise.resolve();
    let checkpointTail = Promise.resolve();
    let ledger = null;
    let activeTicket = null;
    let restored = false;
    let archiveUncertain = false;
    let careTransitionUncertain = false;
    const log = (event, detail = {}) => {
        try { logger?.debug?.({ component: 'ActorTaskRuntime', event, actorId, taskId: current.currentTask?.intent.taskId ?? null, ...detail }); }
        catch { /* Diagnostics do not alter task or effect authority. */ }
    };
    const tick = () => {
        const value = requireActorTaskRevision(clock(), 'host tick');
        if (value < current.tick) throw actorTaskError('ACTOR_CLOCK_REWOUND', 'Host clock cannot move backwards');
        current.tick = value;
        return value;
    };
    const snapshot = () => freezeActorTaskData(copyActorTaskData(current));
    const assertPersistence = () => {
        if (archiveUncertain) throw actorTaskError('ACTOR_ARCHIVE_UNCERTAIN', 'Reopen private storage and restore the actor before further work');
        if (careTransitionUncertain) throw actorTaskError('ACTOR_CARE_TRANSITION_UNCERTAIN', 'Restore the authoritative checkpoint before continuing a care transition');
    };
    const save = ({ careTransition = false } = {}) => {
        // Snapshot at actual write time, so a concurrent pause/cancel cannot be
        // overwritten by an older in-flight effect's checkpoint.
        const pending = checkpointTail.catch(() => {}).then(async () => {
            assertPersistence();
            try {
                const written = await ports.memory.write(snapshot());
                if (written === false || (careTransition && written !== true)) throw actorTaskError('ACTOR_CHECKPOINT_FAILED', 'Actor checkpoint was not accepted');
            } catch (error) {
                // Set the fence inside the write queue before a concurrent
                // pause/cancel can write a stale side of this durable swap.
                if (careTransition) {
                    careTransitionUncertain = true; generation += 1;
                    const task = current.currentTask;
                    if (task && !TERMINAL.has(task.status)) {
                        task.status = 'paused'; task.reason = 'care-transition-uncertain';
                        await suspendOwner(task, task.reason).catch(() => {});
                    }
                    log('care-transition-uncertain', { code: error?.code ?? 'checkpoint-failed' });
                    throw actorTaskError('ACTOR_CARE_TRANSITION_UNCERTAIN', 'Care checkpoint outcome requires authoritative restore');
                }
                throw error;
            }
        });
        checkpointTail = pending;
        return pending;
    };
    const assertActive = ticket => {
        if (ticket !== generation || current.currentTask?.status !== 'active') throw actorTaskError('ACTOR_TASK_RETIRED', 'This actor task is not active');
    };
    const bindLedger = () => {
        const task = current.currentTask;
        ledger = task ? createEffectLedger({ actions: ports.actions, entries: task.effects,
            assertDispatch: () => assertActive(activeTicket),
            checkpoint: async entries => { task.effects = entries; await save(); },
        }) : null;
    };
    const validateCheckpoint = raw => {
        const record = copyActorTaskData(raw);
        if (record.format !== current.format || ![1, 2].includes(record.version) || record.actorId !== actorId
            || (record.version === 1 && Object.hasOwn(record, 'suspendedTask'))
            || (record.version === 2 && !(record.suspendedTask === null || (record.suspendedTask && typeof record.suspendedTask === 'object' && !Array.isArray(record.suspendedTask))))
            || !Array.isArray(record.history) || record.history.length > ACTOR_TASK_LIMITS.tasks) throw actorTaskError('ACTOR_CHECKPOINT_INVALID', 'Actor checkpoint scope or version is invalid');
        requireActorTaskRevision(record.tick, 'checkpoint tick');
        const seen = new Set();
        for (const task of [...record.history, ...(record.currentTask ? [record.currentTask] : []), ...(record.suspendedTask ? [record.suspendedTask] : [])]) {
            task.intent = normalizedIntent(task.intent, actorId);
            const steps = methods.expand(task.intent.methodId, task.intent.methodVersion);
            if (seen.has(task.intent.taskId) || !STATUSES.has(task.status) || !sameActorTaskData(task.steps, steps)
                || !Array.isArray(task.results) || task.results.length !== steps.length
                || !Array.isArray(task.effects) || task.effects.length > steps.length) throw actorTaskError('ACTOR_CHECKPOINT_INVALID', 'Task checkpoint conflicts with its registered method');
            seen.add(task.intent.taskId);
            requireActorTaskRevision(task.ownerRevision, 'task owner revision');
            if (record.version === 1 && (Object.hasOwn(task, 'interruption') || Object.hasOwn(task, 'careReturnRequired'))) {
                throw actorTaskError('ACTOR_CHECKPOINT_INVALID', 'Care continuation metadata requires checkpoint schema 2');
            }
            if (task.interruption) {
                validateInterruption(task.interruption, task.intent.taskId);
                if (typeof task.careReturnRequired !== 'boolean' || task.interruption.careTaskId === task.intent.taskId) {
                    throw actorTaskError('ACTOR_CHECKPOINT_INVALID', 'Care continuation requires a distinct care task and explicit return state');
                }
            } else if (Object.hasOwn(task, 'careReturnRequired')) throw actorTaskError('ACTOR_CHECKPOINT_INVALID', 'Return state requires its original interruption context');
            if (task.results.some(result => result !== null && (!result || result.status !== 'completed'))) throw actorTaskError('ACTOR_CHECKPOINT_INVALID', 'Invalid task progress result');
            const entries = createEffectLedger({ actions: ports.actions, entries: task.effects }).snapshot();
            let gap = false;
            for (let index = 0; index < steps.length; index += 1) {
                const result = task.results[index];
                const entry = entries.find(item => item.effect.intentId === `effect:${task.intent.methodVersion}:${index}`);
                if (!result) gap = true;
                else {
                    if (gap) throw actorTaskError('ACTOR_CHECKPOINT_INVALID', 'Completed progress must be a contiguous method prefix');
                    requireActorTaskRevision(result.tick, 'result tick');
                    if (result.tick > record.tick) throw actorTaskError('ACTOR_CHECKPOINT_INVALID', 'Completed progress is ahead of its checkpoint');
                    if (steps[index].operation === 'observe') {
                        if (result.intentId !== null || entry) throw actorTaskError('ACTOR_CHECKPOINT_INVALID', 'Observations cannot impersonate effect receipts');
                        availableData(result.result, 'perception');
                    // A later owner-read outage can make a previously received
                    // completion uncertain without erasing its original receipt
                    // or measured progress. It remains non-dispatchable until
                    // reconciliation verifies that exact immutable receipt.
                    } else if (!entry || !['completed', 'uncertain'].includes(entry.status) || entry.receipt?.status !== 'completed' || result.intentId !== entry.effect.intentId
                        || !sameActorTaskData(result.result, entry.receipt.result ?? null)
                        || (steps[index].operation === 'move' && result.result?.arrived !== true)) {
                        throw actorTaskError('ACTOR_CHECKPOINT_INVALID', 'Completed effect progress requires its matching authoritative receipt');
                    }
                }
            }
            for (const entry of entries) {
                const index = steps.findIndex((step, position) => entry.effect.intentId === `effect:${task.intent.methodVersion}:${position}`);
                const effect = entry.effect;
                if (index < 0 || steps[index].operation === 'observe' || effect.actorId !== actorId || effect.taskId !== task.intent.taskId
                    || effect.operation !== steps[index].operation || effect.stepId !== steps[index].stepId
                    || effect.methodId !== task.intent.methodId || effect.methodVersion !== task.intent.methodVersion
                    || !sameActorTaskData(effect.sourceRefs, task.intent.sourceRefs)
                    || task.results.slice(0, index).some(result => result === null)) {
                    throw actorTaskError('ACTOR_CHECKPOINT_INVALID', 'Effect checkpoint is outside its actor, method or execution frontier');
                }
            }
            if (task.status === 'completed' && task.results.some(result => result === null)) throw actorTaskError('ACTOR_CHECKPOINT_INVALID', 'Completed task retains unfinished steps');
            if (record.history.includes(task) && (!TERMINAL.has(task.status) || unresolved(task))) throw actorTaskError('ACTOR_CHECKPOINT_INVALID', 'Task history contains unfinished work');
        }
        if (record.suspendedTask && (!record.currentTask || record.suspendedTask.status !== 'paused'
            || record.suspendedTask.reason !== 'care-interruption' || !record.suspendedTask.interruption || record.suspendedTask.careReturnRequired !== true
            || unresolved(record.suspendedTask))) throw actorTaskError('ACTOR_CHECKPOINT_INVALID', 'Suspended primary work must be paused with settled effects and its interruption anchor');
        const returnFor = (task, primary) => task.intent.methodId === 'return-to-anchor' && task.intent.methodVersion === 1
            && task.intent.goal.targetRef === primary.interruption.anchorRef
            && task.intent.constraints.interruptedTaskId === primary.intent.taskId
            && sameActorTaskData(task.intent.sourceRefs, primary.intent.sourceRefs)
            && sameActorTaskData(task.steps, [{ stepId: 'return-to-anchor@1/return', operation: 'move',
                payload: { targetRef: { $ref: 'intent.goal.targetRef' } } }]);
        if (record.suspendedTask) {
            const primary = record.suspendedTask, active = record.currentTask;
            const care = record.history.find(task => task.intent.taskId === primary.interruption.careTaskId);
            if (active.intent.taskId !== primary.interruption.careTaskId
                && (!care || !TERMINAL.has(care.status) || unresolved(care) || !returnFor(active, primary))) {
                throw actorTaskError('ACTOR_CHECKPOINT_INVALID', 'Suspended work must retain its care task or a scoped return after settled care');
            }
        } else if (record.currentTask?.careReturnRequired && !TERMINAL.has(record.currentTask.status)) {
            const primary = record.currentTask;
            const careIndex = record.history.findIndex(task => task.intent.taskId === primary.interruption.careTaskId);
            // Before first primary admission, both records are still retained:
            // archival requires a terminal current task. Later admissions and
            // cancellation may legitimately archive these historical witnesses.
            if (careIndex < 0 || !record.history.slice(careIndex + 1).some(task => task.status === 'completed'
                && !unresolved(task) && returnFor(task, primary))) {
                throw actorTaskError('ACTOR_CHECKPOINT_INVALID', 'Unadmitted primary continuation requires its retained care and completed return');
            }
        }
        if (record.workingMemory?.type !== 'working' || record.workingMemory.capacity !== ACTOR_TASK_LIMITS.observations
            || !Array.isArray(record.workingMemory.items) || record.workingMemory.items.length > ACTOR_TASK_LIMITS.observations) throw actorTaskError('ACTOR_CHECKPOINT_INVALID', 'Working memory exceeds its actor budget');
        return record;
    };
    const initialize = () => {
        if (readyPromise) return readyPromise;
        readyPromise = Promise.resolve().then(async () => {
            const stored = state === null ? await ports.memory.read() : state;
            if (stored != null) {
                current = validateCheckpoint(stored);
                restored = true;
                if (current.currentTask && !TERMINAL.has(current.currentTask.status)) {
                    current.currentTask.status = 'paused';
                    current.currentTask.reason = 'restored-requires-admission';
                }
                bindLedger();
            }
            tick();
            initialized = true;
            log('initialized', { restored });
            return snapshot();
        });
        return readyPromise;
    };
    const exclusive = work => {
        const ticket = generation;
        const operation = operationTail.catch(() => {}).then(async () => {
            await initialize(); assertPersistence();
            if (ticket !== generation) throw actorTaskError('ACTOR_TASK_RETIRED', 'Queued work belongs to a retired actor task generation');
            return work();
        });
        operationTail = operation;
        return operation;
    };
    const archiveHistory = async ({ keep = ARCHIVE_RETAINED_TASKS } = {}) => {
        if (!Number.isSafeInteger(keep) || keep < 0 || keep > ACTOR_TASK_LIMITS.tasks) throw actorTaskError('ACTOR_ARCHIVE_LIMIT', 'Retained task count must fit the actor history budget');
        if (!archival) throw actorTaskError('ACTOR_ARCHIVE_UNAVAILABLE', 'Actor memory does not provide durable task archival');
        const settled = task => !task || (TERMINAL.has(task.status) && !unresolved(task));
        if (current.suspendedTask || !settled(current.currentTask) || current.history.some(task => !settled(task))) throw actorTaskError('ACTOR_TASK_BUSY', 'Archival requires terminal tasks with settled effects and no suspended primary work');
        if (current.history.length <= keep) return snapshot();
        // Initialization and receipt reconciliation can advance the private
        // checkpoint. Persist those changes before its exact compare-and-swap.
        await save();
        const pending = checkpointTail.catch(() => {}).then(async () => {
            assertPersistence();
            const before = snapshot();
            const count = before.history.length - keep;
            const tasks = before.history.slice(0, count);
            const after = freezeActorTaskData({ ...copyActorTaskData(before), history: copyActorTaskData(before.history.slice(count)) });
            const expected = { format: 'particle-actor-archive-receipt-v1', actorId,
                taskIds: tasks.map(task => task.intent.taskId), checkpoint: after };
            log('archive-started', { taskCount: count });
            try {
                const receipt = copyActorTaskData(await ports.memory.archive(freezeActorTaskData({ before, after, tasks })));
                if (!sameActorTaskData(receipt, expected) || !sameActorTaskData(snapshot(), before)) {
                    throw actorTaskError('ACTOR_ARCHIVE_RECEIPT_INVALID', 'Archive acknowledgment does not match the exact private checkpoint transfer');
                }
                // Retain current object identities and retire only the verified
                // prefix. Pause/cancel can change generation while awaiting this
                // receipt, but a terminal task cannot be revived by archival.
                current.history.splice(0, count);
                log('archived', { taskCount: count, retained: current.history.length });
            } catch (error) {
                archiveUncertain = true;
                generation += 1;
                log('archive-uncertain', { code: error?.code ?? 'archive-failed' });
                throw actorTaskError('ACTOR_ARCHIVE_UNCERTAIN', 'Archive outcome requires reopening private storage before further work');
            }
        });
        checkpointTail = pending;
        await pending;
        return snapshot();
    };
    const self = async () => {
        const value = copyActorTaskData(await ports.self.read());
        if (value.actorId !== actorId) throw actorTaskError('ACTOR_SELF_SCOPE', 'Self port returned another actor');
        requireActorTaskRevision(value.revision, 'self revision');
        return value;
    };
    const validateInterruption = (raw, taskId, careTaskId = null, revision = null) => {
        const value = copyActorTaskData(raw);
        if (value?.available !== true || value.actorId !== actorId || value.taskId !== taskId
            || (Object.hasOwn(value, 'supported') && value.supported !== true)
            || (Object.hasOwn(value, 'resolved') && value.resolved !== true)
            || (Object.hasOwn(value, 'status') && !['ready', 'available', 'prepared', 'validated'].includes(value.status))
            || (careTaskId !== null && value.careTaskId !== careTaskId)
            || (revision !== null && value.revision !== revision)) throw actorTaskError('ACTOR_CARE_ANCHOR_INVALID', 'Care anchor must identify the exact actor, primary task, care task and owner revision');
        requireActorTaskIdentifier(value.careTaskId, 'careTaskId');
        requireActorTaskIdentifier(value.anchorRef, 'interruption anchor');
        requireActorTaskRevision(value.revision, 'interruption revision');
        return value;
    };
    const requireCare = () => {
        if (!careEnabled) throw actorTaskError('ACTOR_CARE_UNAVAILABLE', 'The actor owner does not provide interruption and measured return validation');
    };
    const assertTicket = ticket => {
        if (ticket !== generation) throw actorTaskError('ACTOR_TASK_RETIRED', 'The pending actor transition was retired');
    };
    const assertNewTask = async intent => {
        const tasks = [...current.history, current.currentTask, current.suspendedTask].filter(Boolean);
        if (tasks.some(task => task.intent.taskId === intent.taskId)) throw actorTaskError('ACTOR_TASK_DUPLICATE', 'Task IDs cannot be reused');
        if (archival) {
            const archived = await ports.memory.hasArchivedTask(intent.taskId);
            if (typeof archived !== 'boolean') throw actorTaskError('ACTOR_ARCHIVE_LOOKUP_UNAVAILABLE', 'Archived task identity lookup must return a definite answer');
            if (archived) throw actorTaskError('ACTOR_TASK_DUPLICATE', 'Archived task IDs cannot be reused');
        }
    };
    const prepareTask = async (intent, ticket, identityChecked = false) => {
        if (!identityChecked) await assertNewTask(intent);
        assertTicket(ticket);
        const steps = methods.expand(intent.methodId, intent.methodVersion);
        const actor = await self(); assertTicket(ticket);
        const meaning = copyActorTaskData(await ports.meaning.resolve(freezeActorTaskData(copyActorTaskData(intent))));
        assertTicket(ticket);
        return { intent, meaning, status: 'proposed', reason: null, admission: null,
            ownerRevision: actor.revision, proposedTick: tick(), steps: copyActorTaskData(steps),
            results: steps.map(() => null), effects: [] };
    };
    const validateCareReturn = async (task, actor) => {
        requireCare();
        const interruption = validateInterruption(task.interruption, task.intent.taskId);
        const reply = copyActorTaskData(await ports.actions.validateCareReturn(freezeActorTaskData({ actorId,
            taskId: task.intent.taskId, careTaskId: interruption.careTaskId, expectedRevision: actor.revision,
            interruption, intent: task.intent, completedSteps: task.results.filter(Boolean).length })));
        if (reply?.ready !== true || reply.arrived !== true || reply.actorId !== actorId
            || reply.taskId !== task.intent.taskId || reply.revision !== actor.revision
            || reply.anchorRef !== interruption.anchorRef
            || (Object.hasOwn(reply, 'available') && reply.available !== true)
            || (Object.hasOwn(reply, 'supported') && reply.supported !== true)
            || (Object.hasOwn(reply, 'resolved') && reply.resolved !== true)
            || (Object.hasOwn(reply, 'status') && !['ready', 'available', 'validated'].includes(reply.status))) {
            throw actorTaskError('ACTOR_CARE_RETURN_UNAVAILABLE', 'Current owner must verify care eligibility, retained context and measured return to the interruption anchor');
        }
    };
    const remember = (type, data) => {
        // Reuse AIMemory's bounded working-memory shape. Its push helper stamps
        // performance.now(), so authoritative entries instead use the host tick.
        const memory = current.workingMemory;
        if (memory.items.length >= memory.capacity) memory.items.shift();
        memory.items.push({ type, data: copyActorTaskData(data), priority: 1, timestamp: tick() });
        memory.focus = { type: 'task', data: current.currentTask?.intent.taskId ?? null, timestamp: current.tick };
    };
    const suspendOwner = (task, reason, admissionId = task?.admission?.admissionId ?? null) => {
        if (!task) return Promise.resolve();
        // Host contract: synchronously retire movement/dispatch leases before
        // returning a promise. Completion of an already committed effect is retained.
        try { return Promise.resolve(ports.actions.suspendTask(freezeActorTaskData({ actorId,
            taskId: task.intent.taskId, admissionId, reason }))); }
        catch (error) { return Promise.reject(error); }
    };
    const reconcileTask = async () => {
        const task = current.currentTask;
        if (!task || !ledger) return;
        for (const effect of ledger.snapshot()) {
            const entry = await ledger.reconcile(effect.effect.intentId);
            const index = task.steps.findIndex((step, position) => entry.effect.intentId === `effect:${task.intent.methodVersion}:${position}`);
            if (index < 0 || entry.effect.actorId !== actorId || entry.effect.taskId !== task.intent.taskId
                || entry.effect.operation !== task.steps[index].operation) throw actorTaskError('ACTOR_CHECKPOINT_INVALID', 'Effect does not belong to a registered task step');
            acceptReceipt(task, index, entry);
        }
        restored = false;
    };
    const acceptReceipt = (task, index, entry) => {
        if (entry.receipt) task.ownerRevision = Math.max(task.ownerRevision, entry.receipt.revision);
        if (entry.status === 'completed') {
            if (task.steps[index].operation === 'move' && entry.receipt.result?.arrived !== true) {
                task.reason = 'movement-arrival-unproven';
                if (task.status === 'active') task.status = 'blocked';
                return;
            }
            const result = copyActorTaskData(entry.receipt.result ?? null);
            if (task.results[index]) {
                if (task.results[index].intentId !== entry.effect.intentId || !sameActorTaskData(task.results[index].result, result)) {
                    throw actorTaskError('ACTOR_RECEIPT_CHANGED', 'Stored task progress conflicts with its authoritative receipt');
                }
            } else {
                task.results[index] = { status: 'completed', tick: tick(), result, intentId: entry.effect.intentId };
                remember('effect-receipt', { intentId: entry.effect.intentId, status: entry.status, revision: entry.receipt.revision });
            }
        } else {
            if (task.status === 'active') task.status = 'blocked';
            task.reason = entry.status === 'rejected' ? 'effect-rejected' : entry.status === 'pending' ? 'effect-pending' : 'effect-outcome-unknown';
        }
    };
    const admitTask = async () => {
        const task = current.currentTask;
        if (!task || TERMINAL.has(task.status)) throw actorTaskError('ACTOR_TASK_UNAVAILABLE', 'No resumable actor task');
        const ticket = generation;
        if (!task.meaning || typeof task.meaning !== 'object' || Array.isArray(task.meaning)
            || task.meaning.resolved !== true || task.meaning.executable === false
            || task.meaning.available === false || task.meaning.supported === false
            || ['unavailable', 'unsupported', 'unresolved', 'blocked', 'rejected', 'failed', 'pending', 'unknown', 'budget-exhausted'].includes(task.meaning.status)) {
            task.status = 'blocked'; task.reason = 'meaning-unresolved'; await save(); return snapshot();
        }
        if (restored || unresolved(task)) await reconcileTask();
        if (ticket !== generation || task !== current.currentTask || TERMINAL.has(task.status)) return snapshot();
        if (unresolved(task)) { task.status = 'blocked'; task.reason = 'effect-outcome-unknown'; await save(); return snapshot(); }
        if (task.effects.some(entry => entry.status === 'rejected')) { task.status = 'blocked'; task.reason = 'effect-rejected'; await save(); return snapshot(); }
        const actor = await self();
        if (ticket !== generation) return snapshot();
        if (task.careReturnRequired) {
            await validateCareReturn(task, actor);
            if (ticket !== generation) return snapshot();
        }
        const admission = copyActorTaskData(await ports.actions.admitTask(freezeActorTaskData({
            actorId, taskId: task.intent.taskId, intent: task.intent, expectedRevision: actor.revision,
            ...(task.interruption ? { continuation: { interruption: task.interruption, completedSteps: task.results.filter(Boolean).length } } : {}),
        })));
        if (ticket !== generation) { await suspendOwner(task, task.status, admission.admissionId ?? null); return snapshot(); }
        if (admission.admitted !== true) {
            task.status = 'blocked'; task.reason = admission.reason ?? 'admission-denied'; await save(); return snapshot();
        }
        requireActorTaskIdentifier(admission.admissionId, 'admissionId');
        requireActorTaskRevision(admission.revision, 'admission revision');
        if (admission.revision < actor.revision) throw actorTaskError('ACTOR_ADMISSION_REVISION', 'Task admission predates the actor revision');
        const careReturnRequired = task.careReturnRequired === true;
        task.admission = admission; task.ownerRevision = admission.revision;
        if (task.interruption) task.careReturnRequired = false;
        task.status = 'active'; task.reason = null; tick();
        try { await save(); }
        catch (error) {
            if (careReturnRequired) task.careReturnRequired = true;
            if (ticket === generation && task.status === 'active') { task.status = 'blocked'; task.reason = 'checkpoint-unavailable'; }
            await suspendOwner(task, task.reason); throw error;
        }
        log('admitted');
        return snapshot();
    };
    const step = () => exclusive(async () => {
        const task = current.currentTask;
        if (!task || task.status !== 'active') return snapshot();
        const ticket = generation;
        activeTicket = ticket;
        tick();
        try {
            const index = nextRegisteredStep(task.steps, task.results);
            if (index < 0) {
                task.status = 'completed'; task.reason = null;
                await suspendOwner(task, 'completed'); await save(); log('completed'); return snapshot();
            }
            const registered = task.steps[index];
            const payload = resolveMethodPayload(registered.payload, { intent: task.intent, meaning: task.meaning, results: task.results });
            // A registered route can visit several admitted anchors. Its exact
            // step target takes precedence, including explicit invalid/null
            // values that the navigation owner must refuse instead of falling
            // back to an unrelated task-level destination.
            const stepTarget = registered.operation === 'move' && payload !== null && typeof payload === 'object'
                && Object.hasOwn(payload, 'targetRef') ? payload.targetRef : task.intent.goal.targetRef ?? null;
            const context = { actorId, taskId: task.intent.taskId, targetRef: stepTarget,
                constraints: task.intent.constraints, quantities: task.intent.quantities,
                sourceRefs: task.intent.sourceRefs, payload };
            if (registered.operation === 'observe') {
                const observation = availableData(await ports.perception.observe(freezeActorTaskData(context)), 'perception');
                assertActive(ticket);
                task.results[index] = { status: 'completed', tick: tick(), result: observation, intentId: null };
                remember('observation', observation); await save(); log('observed', { step: index });
                return snapshot();
            }
            const prior = ledger.snapshot().find(entry => entry.effect.intentId === `effect:${task.intent.methodVersion}:${index}`);
            let entry;
            if (prior) entry = await ledger.reconcile(prior.effect.intentId);
            else {
                let prepared = payload;
                if (registered.operation === 'move') prepared = availableData(await ports.navigation.resolveTarget(freezeActorTaskData(context)), 'navigation');
                if (registered.operation === 'communicate') prepared = availableData(await ports.communication.prepare(freezeActorTaskData({ ...context,
                    recipientRef: task.intent.goal.recipientRef ?? null,
                    observations: task.results.filter(result => result?.intentId === null).map(result => result.result),
                })), 'communication');
                assertActive(ticket);
                entry = await ledger.execute({ actorId, taskId: task.intent.taskId,
                    intentId: `effect:${task.intent.methodVersion}:${index}`, admissionId: task.admission.admissionId,
                    expectedRevision: task.ownerRevision, operation: registered.operation, payload: prepared,
                    sourceRefs: task.intent.sourceRefs, methodId: task.intent.methodId, methodVersion: task.intent.methodVersion,
                    stepId: registered.stepId });
            }
            // A late receipt is progress, not permission to revive a cancelled or paused task.
            acceptReceipt(task, index, entry);
            await save(); log('effect-reconciled', { step: index, outcome: entry.status });
            return snapshot();
        } catch (error) {
            if (ticket === generation && task.status === 'active') { task.status = 'blocked'; task.reason = error?.code ?? 'task-step-failed'; }
            await suspendOwner(task, task.reason ?? task.status).catch(() => {});
            await save().catch(() => {});
            log('step-failed', { code: error?.code ?? 'task-step-failed' });
            if (error?.code === 'ACTOR_TASK_RETIRED' || /^ACTOR_(PERCEPTION|NAVIGATION|COMMUNICATION)_UNAVAILABLE$/.test(error?.code ?? '')) return snapshot();
            throw error;
        } finally { activeTicket = null; }
    });
    const retire = async status => {
        // Once initialized, retire synchronously before the first await. An
        // already pending owner call may finish, but no successor can dispatch.
        generation += 1;
        if (!initialized) await initialize();
        const task = current.currentTask;
        if (!task || TERMINAL.has(task.status)) return snapshot();
        task.status = status; task.reason = status; tick();
        const retirement = suspendOwner(task, status);
        await save(); await retirement;
        log(status); return snapshot();
    };
    const interruptForCare = raw => {
        requireCare(); assertPersistence();
        const intent = normalizedIntent(raw, actorId);
        if (current.suspendedTask) throw actorTaskError('ACTOR_CARE_NESTED', 'Only one primary task may be suspended for care');
        // This call stops the existing owner before any await. Its late accepted
        // receipt drains on operationTail before a new task/ledger is installed.
        const retirement = retire('paused').then(() => null, error => error);
        const ticket = generation;
        return exclusive(async () => {
            const retirementError = await retirement;
            if (retirementError) throw retirementError;
            assertTicket(ticket);
            const primary = current.currentTask;
            if (current.suspendedTask) throw actorTaskError('ACTOR_CARE_NESTED', 'Only one primary task may be suspended for care');
            if (!primary || TERMINAL.has(primary.status)) throw actorTaskError('ACTOR_TASK_UNAVAILABLE', 'Care interruption requires unfinished primary work');
            // Reserve room for both the care and return records. Neither can be
            // silently evicted while this primary remains suspended.
            if (current.history.length > ACTOR_TASK_LIMITS.tasks - 2) throw actorTaskError('ACTOR_HISTORY_LIMIT', 'Care needs two retained completion slots');
            await reconcileTask(); assertTicket(ticket);
            if (unresolved(primary)) throw actorTaskError('ACTOR_TASK_BUSY', 'Reconcile unknown primary effects before starting care');
            const care = await prepareTask(intent, ticket);
            const actor = await self(); assertTicket(ticket);
            const interruption = validateInterruption(await ports.actions.prepareCareInterruption(freezeActorTaskData({ actorId,
                taskId: primary.intent.taskId, careTaskId: intent.taskId, expectedRevision: actor.revision,
                intent: primary.intent })), primary.intent.taskId, intent.taskId, actor.revision);
            assertTicket(ticket);
            primary.status = 'paused'; primary.reason = 'care-interruption'; primary.interruption = interruption; primary.careReturnRequired = true;
            current.version = 2; current.suspendedTask = primary; current.currentTask = care;
            bindLedger(); restored = false;
            await save({ careTransition: true });
            log('care-interrupted', { primaryTaskId: primary.intent.taskId }); return snapshot();
        });
    };
    const returnFromCare = ({ taskId } = {}) => exclusive(async () => {
        requireCare(); const ticket = generation;
        const primary = current.suspendedTask, care = current.currentTask;
        if (!primary || !care || !TERMINAL.has(care.status)) throw actorTaskError('ACTOR_TASK_BUSY', 'Finish or cancel care before returning to primary work');
        if (restored || unresolved(care)) await reconcileTask(); assertTicket(ticket);
        if (unresolved(care)) throw actorTaskError('ACTOR_TASK_BUSY', 'Care effects must settle before returning');
        if (current.history.length >= ACTOR_TASK_LIMITS.tasks - 1) throw actorTaskError('ACTOR_HISTORY_LIMIT', 'Returning from care requires retained history space');
        const intent = normalizedIntent({ actorId, taskId, methodId: 'return-to-anchor', methodVersion: 1,
            goal: { targetRef: primary.interruption.anchorRef }, constraints: { interruptedTaskId: primary.intent.taskId },
            quantities: {}, sourceRefs: primary.intent.sourceRefs }, actorId);
        const returning = await prepareTask(intent, ticket);
        const expected = [{ stepId: 'return-to-anchor@1/return', operation: 'move',
            payload: { targetRef: { $ref: 'intent.goal.targetRef' } } }];
        if (!sameActorTaskData(returning.steps, expected)) throw actorTaskError('ACTOR_CARE_RETURN_METHOD', 'Return requires the exact registered single-move method');
        current.history.push(care); current.currentTask = returning; bindLedger();
        await save({ careTransition: true }); log('care-return-proposed'); return snapshot();
    });
    const resumeInterruptedTask = () => exclusive(async () => {
        requireCare(); const ticket = generation;
        const primary = current.suspendedTask, returning = current.currentTask;
        if (!primary || returning?.status !== 'completed' || returning.intent.methodId !== 'return-to-anchor'
            || returning.intent.methodVersion !== 1 || returning.intent.goal.targetRef !== primary.interruption.anchorRef
            || returning.intent.constraints.interruptedTaskId !== primary.intent.taskId) {
            throw actorTaskError('ACTOR_CARE_RETURN_REQUIRED', 'Complete the admitted return task before restoring primary work');
        }
        if (restored || unresolved(returning)) await reconcileTask(); assertTicket(ticket);
        if (unresolved(returning)) throw actorTaskError('ACTOR_TASK_BUSY', 'Return movement outcome must be settled');
        // Revalidate the suspended receipts without rewriting them as uncertain
        // inside the suspended slot. An outage leaves that slot intact and stops
        // the transition; a restored primary reconciles normally before admission.
        for (const entry of primary.effects) {
            const receipt = await ports.actions.readReceipt(freezeActorTaskData({ actorId,
                taskId: primary.intent.taskId, intentId: entry.effect.intentId }));
            assertTicket(ticket);
            if (!sameActorTaskData(receipt, entry.receipt)) throw actorTaskError('ACTOR_CARE_RETURN_UNAVAILABLE', 'Primary receipts cannot be verified for resumption');
        }
        const actor = await self(); assertTicket(ticket);
        await validateCareReturn(primary, actor); assertTicket(ticket);
        if (current.history.length >= ACTOR_TASK_LIMITS.tasks) throw actorTaskError('ACTOR_HISTORY_LIMIT', 'Retain the completed return before resuming');
        current.history.push(returning); current.currentTask = primary; current.suspendedTask = null;
        primary.reason = 'care-return-requires-admission'; bindLedger(); restored = true;
        await save({ careTransition: true }); log('care-primary-restored'); return snapshot();
    });
    const cancelInterruptedTask = () => exclusive(async () => {
        const primary = current.suspendedTask;
        if (!primary) throw actorTaskError('ACTOR_TASK_UNAVAILABLE', 'No suspended primary task to cancel');
        if (unresolved(primary)) throw actorTaskError('ACTOR_TASK_BUSY', 'Unknown primary effects cannot be discarded');
        if (current.history.length >= ACTOR_TASK_LIMITS.tasks) throw actorTaskError('ACTOR_HISTORY_LIMIT', 'Cancellation must retain the original primary record');
        // Its owner is already suspended. Cancellation only retires future
        // primary work; it neither undoes accepted effects nor consumes cargo.
        primary.status = 'cancelled'; primary.reason = 'cancelled'; tick();
        current.history.push(primary); current.suspendedTask = null;
        await save({ careTransition: true }); log('care-primary-cancelled'); return snapshot();
    });
    return Object.freeze({
        initialize, snapshot, step, interruptForCare, returnFromCare, resumeInterruptedTask, cancelInterruptedTask,
        // Reuse the exact restore grammar without initializing this interpreter
        // or contacting its clock, observation, admission or persistence ports.
        validateCheckpoint: raw => freezeActorTaskData(validateCheckpoint(raw)),
        archiveHistory: options => exclusive(() => archiveHistory(options)),
        // Disposal first retires the host lease synchronously, then waits for
        // already accepted calls/checkpoints. Their original promises retain
        // any errors; cleanup itself still waits through those failures.
        drain: async () => { await operationTail.catch(() => {}); await checkpointTail.catch(() => {}); return snapshot(); },
        propose: raw => exclusive(async () => {
            const ticket = generation;
            const intent = normalizedIntent(raw, actorId);
            if (current.suspendedTask) throw actorTaskError('ACTOR_CARE_PENDING', 'Return to or cancel the interrupted primary before proposing unrelated work');
            if (restored) await reconcileTask();
            if (ticket !== generation) throw actorTaskError('ACTOR_TASK_RETIRED', 'Proposal was retired while reconciling the prior task');
            const existing = current.currentTask;
            if (existing && (!TERMINAL.has(existing.status) || unresolved(existing))) throw actorTaskError('ACTOR_TASK_BUSY', 'Current task or uncertain effects must be settled first');
            await assertNewTask(intent); assertTicket(ticket);
            if (archival) {
                if (current.history.length >= ARCHIVE_RETAINED_TASKS) await archiveHistory({ keep: ARCHIVE_RETAINED_TASKS - 1 });
                if (ticket !== generation) throw actorTaskError('ACTOR_TASK_RETIRED', 'Proposal was retired during archival');
            }
            if (current.history.length >= ACTOR_TASK_LIMITS.tasks) throw actorTaskError('ACTOR_HISTORY_LIMIT', 'Actor task history requires host archival');
            const proposal = await prepareTask(intent, ticket, true);
            if (existing) current.history.push(existing);
            current.currentTask = proposal;
            bindLedger(); await save(); log('proposed'); return snapshot();
        }),
        admit: () => exclusive(admitTask),
        resume: () => exclusive(admitTask),
        pause: () => retire('paused'),
        cancel: () => retire('cancelled'),
        reconcile: () => exclusive(async () => { await reconcileTask(); await save(); return snapshot(); }),
    });
}
