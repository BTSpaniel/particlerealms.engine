// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createAction, createSequence, tickNode, NODE_STATUS } from '../../../sim/ai/AIBehaviorTree.js';
import { canonicalize } from '../../../state/util/canonical.js';

export const ACTOR_TASK_LIMITS = Object.freeze({ methods: 64, steps: 64, depth: 8, tasks: 64, observations: 32 });

export function actorTaskError(code, message) {
    return Object.assign(new Error(message), { code });
}

/** Copy bounded plain data without invoking accessors or accepting executable methods. */
export function copyActorTaskData(value) {
    const seen = new Set();
    let count = 0;
    const copy = (item, depth) => {
        if (++count > 30000 || depth > 24) throw actorTaskError('ACTOR_DATA_LIMIT', 'Actor data exceeds its structural budget');
        if (item === null || typeof item === 'boolean') return item;
        if (typeof item === 'number' && Number.isFinite(item)) return item;
        if (typeof item === 'string' && item.length <= 16384) return item;
        if (!item || typeof item !== 'object' || seen.has(item)) throw actorTaskError('ACTOR_DATA_INVALID', 'Expected acyclic plain JSON data');
        const array = Array.isArray(item);
        if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw actorTaskError('ACTOR_DATA_INVALID', 'Expected a plain data record');
        seen.add(item);
        const result = array ? [] : {};
        for (const key of Reflect.ownKeys(item)) {
            if (array && key === 'length') continue;
            const field = Object.getOwnPropertyDescriptor(item, key);
            if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)
                || !field?.enumerable || !Object.hasOwn(field, 'value')
                || (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length))) {
                throw actorTaskError('ACTOR_DATA_INVALID', 'Actor data contains an unsafe field');
            }
            result[key] = copy(field.value, depth + 1);
        }
        seen.delete(item);
        if (array && Object.keys(result).length !== item.length) throw actorTaskError('ACTOR_DATA_INVALID', 'Sparse arrays are not actor data');
        return result;
    };
    return copy(value, 0);
}

export function requireActorTaskIdentifier(value, label = 'identifier') {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/.test(value)) {
        throw actorTaskError('ACTOR_ID_INVALID', `Invalid ${label}`);
    }
    return value;
}

export function requireActorTaskRevision(value, label = 'revision') {
    if (!Number.isSafeInteger(value) || value < 0) throw actorTaskError('ACTOR_REVISION_INVALID', `${label} must be a non-negative safe integer`);
    return value;
}

export function freezeActorTaskData(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freezeActorTaskData); Object.freeze(value); }
    return value;
}

const BUILTINS = [
    { id: 'move-and-observe', version: 1, steps: [
        { id: 'move', operation: 'move', payload: {} },
        { id: 'observe', operation: 'observe', payload: {} },
    ] },
    { id: 'inspect-and-report', version: 1, steps: [
        { id: 'inspect', methodId: 'move-and-observe', methodVersion: 1 },
        { id: 'report', operation: 'communicate', payload: {} },
    ] },
    { id: 'return-to-anchor', version: 1, steps: [
        { id: 'return', operation: 'move', payload: { targetRef: { $ref: 'intent.goal.targetRef' } } },
    ] },
];
export const BUILTIN_METHODS = freezeActorTaskData(BUILTINS);

function key(id, version) {
    requireActorTaskIdentifier(id, 'method ID');
    if (!Number.isSafeInteger(version) || version < 1) throw actorTaskError('ACTOR_METHOD_VERSION', 'Method version must be a positive safe integer');
    return `${id}@${version}`;
}

/**
 * Data-only bounded hierarchical methods. Public packs name registered operations;
 * they cannot install callbacks, JavaScript expressions, or recursive methods.
 * Domain operation semantics remain with the authoritative actions port.
 */
export function createRegisteredMethods({ methods = BUILTIN_METHODS } = {}) {
    const definitions = new Map();
    const register = raw => {
        const value = copyActorTaskData(raw);
        const methodKey = key(value.id, value.version);
        if (definitions.has(methodKey)) throw actorTaskError('ACTOR_METHOD_DUPLICATE', 'A method version is immutable once registered');
        if (definitions.size >= ACTOR_TASK_LIMITS.methods || !Array.isArray(value.steps)
            || value.steps.length < 1 || value.steps.length > ACTOR_TASK_LIMITS.steps
            || Object.keys(value).some(field => !['id', 'version', 'steps', 'description'].includes(field))) {
            throw actorTaskError('ACTOR_METHOD_INVALID', 'Invalid method definition or method budget');
        }
        const ids = new Set();
        for (const step of value.steps) {
            requireActorTaskIdentifier(step.id, 'step ID');
            if (ids.has(step.id)) throw actorTaskError('ACTOR_METHOD_INVALID', 'Sibling step IDs must be unique');
            ids.add(step.id);
            if (Object.hasOwn(step, 'methodId')) {
                key(step.methodId, step.methodVersion);
                if (Object.keys(step).some(field => !['id', 'methodId', 'methodVersion'].includes(field))) throw actorTaskError('ACTOR_METHOD_INVALID', 'Submethods contain references only');
            } else {
                requireActorTaskIdentifier(step.operation, 'operation');
                if (Object.keys(step).some(field => !['id', 'operation', 'payload'].includes(field))) throw actorTaskError('ACTOR_METHOD_INVALID', 'Unknown method step field');
                step.payload ??= {};
            }
        }
        definitions.set(methodKey, freezeActorTaskData(value));
        return copyActorTaskData(value);
    };
    const expand = (id, version) => {
        const result = [];
        const walk = (methodId, methodVersion, path, ancestors) => {
            const methodKey = key(methodId, methodVersion);
            if (ancestors.has(methodKey) || ancestors.size >= ACTOR_TASK_LIMITS.depth) throw actorTaskError('ACTOR_METHOD_RECURSION', 'Methods must form a bounded acyclic hierarchy');
            const method = definitions.get(methodKey);
            if (!method) throw actorTaskError('ACTOR_METHOD_UNKNOWN', `Unregistered method ${methodKey}`);
            const next = new Set([...ancestors, methodKey]);
            for (const step of method.steps) {
                const stepPath = [...path, `${methodKey}/${step.id}`];
                if (Object.hasOwn(step, 'methodId')) walk(step.methodId, step.methodVersion, stepPath, next);
                else {
                    if (result.length >= ACTOR_TASK_LIMITS.steps) throw actorTaskError('ACTOR_METHOD_LIMIT', 'Expanded method exceeds the step budget');
                    result.push({ stepId: stepPath.join('>'), operation: step.operation, payload: step.payload });
                }
            }
        };
        walk(id, version, [], new Set());
        return freezeActorTaskData(copyActorTaskData(result));
    };
    for (const method of methods) register(method);
    return Object.freeze({ register, expand, list: () => [...definitions.values()].map(copyActorTaskData) });
}

/** Read-only behavior-tree projection of completed work; no tree callback writes to a world. */
export function nextRegisteredStep(steps, completed) {
    let frontier = -1;
    const tree = createSequence('registered-method', steps.map((step, index) => createAction(step.stepId, () => {
        if (completed[index]?.status === 'completed') return NODE_STATUS.SUCCESS;
        frontier = index;
        return NODE_STATUS.RUNNING;
    })));
    return tickNode(tree, {}, 0) === NODE_STATUS.SUCCESS ? -1 : frontier;
}

/** Bind explicit data references. This is lookup only, never eval or arbitrary property execution. */
export function resolveMethodPayload(template, context) {
    const input = copyActorTaskData(template);
    const bind = value => {
        if (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, '$ref')) {
            if (Object.keys(value).length !== 1 || typeof value.$ref !== 'string') throw actorTaskError('ACTOR_METHOD_REFERENCE', 'Invalid data reference');
            const segments = value.$ref.split('.');
            if (!['intent', 'meaning', 'results'].includes(segments[0]) || segments.length > 16
                || segments.some(segment => !/^[A-Za-z0-9_-]+$/.test(segment) || ['__proto__', 'constructor', 'prototype'].includes(segment))) {
                throw actorTaskError('ACTOR_METHOD_REFERENCE', 'Reference is outside method context');
            }
            let result = context;
            for (const segment of segments) {
                if (result === null || typeof result !== 'object' || !Object.hasOwn(result, segment)) throw actorTaskError('ACTOR_METHOD_REFERENCE', `Unresolved reference ${value.$ref}`);
                result = result[segment];
            }
            return copyActorTaskData(result);
        }
        if (Array.isArray(value)) return value.map(bind);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, bind(child)]));
        return value;
    };
    return bind(input);
}

export const sameActorTaskData = (left, right) => canonicalize(left) === canonicalize(right);
