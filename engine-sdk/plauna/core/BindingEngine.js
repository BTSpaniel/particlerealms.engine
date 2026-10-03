// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { DIRTY, NODE_STATE } from './UINode.js';

const STATE_PROPERTIES = Object.freeze({
    disabled: NODE_STATE.DISABLED,
    checked: NODE_STATE.CHECKED,
    selected: NODE_STATE.SELECTED,
    loading: NODE_STATE.LOADING,
    error: NODE_STATE.ERROR,
    visible: NODE_STATE.VISIBLE,
});

function now() {
    return globalThis.performance?.now?.() ?? Date.now();
}

function eventValue(event) {
    if (event?.detail && Object.hasOwn(event.detail, 'value')) return event.detail.value;
    if (event?.target && Object.hasOwn(event.target, 'checked') && event.target.type === 'checkbox') {
        return event.target.checked;
    }
    if (event?.target && Object.hasOwn(event.target, 'value')) return event.target.value;
    if (event && Object.hasOwn(event, 'value')) return event.value;
    return event;
}

/**
 * Lifecycle-safe StateStore -> UINode bindings and UINode -> intent dispatch.
 * Two-way bindings never promote local UI values into authoritative state.
 */
export class BindingEngine {
    constructor(options = {}) {
        this.store = options.store ?? null;
        this.dispatchIntent = options.dispatchIntent ?? null;
        this.logger = options.logger ?? console;
        this.bindings = new Map();
        this.dependencies = new Map();
        this.pendingBindings = new Set();
        this.flushScheduled = false;
        this.destroyed = false;
        this.totalBindings = 0;
        this.totalUpdates = 0;
        this.totalComputations = 0;
        this.totalComputeTime = 0;
        this.totalUpdateTime = 0;
        this.totalIntents = 0;
        this.failedIntents = 0;
    }

    setStore(store) {
        if (!store || typeof store.get !== 'function' || typeof store.subscribe !== 'function') {
            throw new TypeError('BindingEngine requires a StateStore-compatible source');
        }
        if (this.totalBindings) throw new Error('Cannot replace BindingEngine store while bindings are active');
        this.store = store;
        return this;
    }

    setIntentDispatcher(dispatchIntent) {
        if (dispatchIntent !== null && typeof dispatchIntent !== 'function') {
            throw new TypeError('Intent dispatcher must be a function or null');
        }
        this.dispatchIntent = dispatchIntent;
        return this;
    }

    bindOneWay(node, property, sourcePath, options = {}) {
        this.#assertReady();
        const binding = this.#createBinding(node, property, {
            type: 'one-way',
            sourcePath,
            transform: options.transform,
        });
        binding.unsubscribers.push(this.store.subscribe(sourcePath, () => this.#schedule(binding)));
        if (options.immediate !== false) this.updateBinding(binding);
        return binding;
    }

    bindTwoWay(node, property, sourcePath, options = {}) {
        const binding = this.bindOneWay(node, property, sourcePath, options);
        binding.type = 'intent';
        binding.eventType = options.eventType ?? 'input';
        binding.action = options.action ?? 'state.set';
        binding.reverseTransform = options.reverseTransform;
        binding.intent = options.intent ?? null;
        binding.pendingPath = options.pendingPath ?? null;
        binding.errorPath = options.errorPath ?? null;
        binding.eventHandler = (event) => this.#dispatchBindingIntent(binding, event);
        node.addEventListener(binding.eventType, binding.eventHandler);
        return binding;
    }

    bindIntent(node, eventType, intent, options = {}) {
        this.#assertActive();
        if (!node?.id || typeof node.addEventListener !== 'function') {
            throw new TypeError('Intent binding requires a UINode');
        }
        if (typeof intent !== 'function' && (!intent || typeof intent !== 'object')) {
            throw new TypeError('Intent binding requires an intent object or factory');
        }
        const binding = this.#createBinding(node, options.property ?? `@${eventType}`, {
            type: 'event-intent',
            intent,
            eventType,
            pendingPath: options.pendingPath ?? null,
            errorPath: options.errorPath ?? null,
        });
        binding.eventHandler = (event) => this.#dispatchBindingIntent(binding, event);
        node.addEventListener(eventType, binding.eventHandler);
        return binding;
    }

    bindComputed(node, property, computeFn, dependencies = [], options = {}) {
        this.#assertReady();
        if (typeof computeFn !== 'function') throw new TypeError('Computed binding requires a function');
        const binding = this.#createBinding(node, property, {
            type: 'computed',
            computeFn,
            dependencies: [...dependencies],
            transform: options.transform,
            value: undefined,
            dirty: true,
        });
        for (const path of dependencies) {
            binding.unsubscribers.push(this.store.subscribe(path, () => {
                binding.dirty = true;
                this.#schedule(binding);
            }));
        }
        if (options.immediate !== false) this.updateBinding(binding);
        return binding;
    }

    updateBinding(binding) {
        if (!binding || binding.disposed || binding.type === 'event-intent') return false;
        if (binding.node.hasState(NODE_STATE.DISABLED) && binding.property !== 'state.disabled') return false;
        const started = now();
        try {
            let value;
            if (binding.type === 'computed') {
                if (binding.dirty) this.#computeBinding(binding);
                value = binding.value;
            } else {
                value = this.store.get(binding.sourcePath);
            }
            if (binding.transform) value = binding.transform(value, this.store, binding.node);
            const changed = this.#applyNodeProperty(binding.node, binding.property, value);
            binding.value = value;
            binding.dirty = false;
            this.totalUpdates++;
            return changed;
        } catch (error) {
            this.logger.error?.(`[Plauna][BindingEngine][update] node=${binding.node.id} property=${binding.property}`, error);
            return false;
        } finally {
            this.totalUpdateTime += now() - started;
        }
    }

    getSourceValue(path) {
        this.#assertReady();
        return this.store.get(path);
    }

    flushUpdates() {
        this.flushScheduled = false;
        const updates = [...this.pendingBindings];
        this.pendingBindings.clear();
        updates.sort((left, right) => (left.dependencies?.length ?? 0) - (right.dependencies?.length ?? 0));
        for (const binding of updates) this.updateBinding(binding);
    }

    removeBindings(node) {
        const bindings = this.bindings.get(node.id);
        if (!bindings) return 0;
        const count = bindings.size;
        for (const binding of [...bindings]) this.#disposeBinding(binding);
        return count;
    }

    removeBinding(node, property) {
        const bindings = this.bindings.get(node.id);
        if (!bindings) return false;
        const binding = [...bindings].find((candidate) => candidate.property === property);
        return binding ? this.#disposeBinding(binding) : false;
    }

    getBindings(node) {
        return new Set(this.bindings.get(node.id) ?? []);
    }

    getBindingInfo(node, property) {
        const binding = [...(this.bindings.get(node.id) ?? [])].find((candidate) => candidate.property === property);
        if (!binding) return null;
        return {
            type: binding.type,
            sourcePath: binding.sourcePath,
            value: binding.value,
            dirty: binding.dirty,
            dependencies: binding.dependencies ? [...binding.dependencies] : [],
            pending: Boolean(binding.pending),
        };
    }

    validate() {
        const errors = [];
        if (!this.store) errors.push('BindingEngine has no StateStore');
        for (const [nodeId, bindings] of this.bindings) {
            for (const binding of bindings) {
                if (!binding.node) errors.push(`Binding references missing node: ${nodeId}`);
                if (!binding.property) errors.push(`Binding missing property: ${nodeId}`);
                if (binding.type === 'computed' && typeof binding.computeFn !== 'function') {
                    errors.push(`Computed binding missing function: ${nodeId}.${binding.property}`);
                }
                if (['one-way', 'intent'].includes(binding.type) && !binding.sourcePath) {
                    errors.push(`State binding missing path: ${nodeId}.${binding.property}`);
                }
            }
        }
        if (errors.length) this.logger.error?.('[Plauna][BindingEngine][validate]', errors);
        return errors.length === 0;
    }

    getPerformanceStats() {
        return {
            totalBindings: this.totalBindings,
            totalUpdates: this.totalUpdates,
            totalComputations: this.totalComputations,
            totalComputeTime: this.totalComputeTime,
            totalUpdateTime: this.totalUpdateTime,
            averageComputeTime: this.totalComputations ? this.totalComputeTime / this.totalComputations : 0,
            averageUpdateTime: this.totalUpdates ? this.totalUpdateTime / this.totalUpdates : 0,
            totalIntents: this.totalIntents,
            failedIntents: this.failedIntents,
            pendingUpdates: this.pendingBindings.size,
        };
    }

    resetPerformanceStats() {
        this.totalUpdates = 0;
        this.totalComputations = 0;
        this.totalComputeTime = 0;
        this.totalUpdateTime = 0;
        this.totalIntents = 0;
        this.failedIntents = 0;
    }

    clearAllBindings() {
        for (const bindings of [...this.bindings.values()]) {
            for (const binding of [...bindings]) this.#disposeBinding(binding);
        }
        this.bindings.clear();
        this.dependencies.clear();
        this.pendingBindings.clear();
        this.totalBindings = 0;
    }

    destroy() {
        if (this.destroyed) return;
        this.clearAllBindings();
        this.destroyed = true;
    }

    #createBinding(node, property, fields) {
        this.#assertActive();
        if (!node?.id || typeof node.markDirty !== 'function') throw new TypeError('Binding requires a UINode');
        if (typeof property !== 'string' || !property) throw new TypeError('Binding property is required');
        const binding = { node, property, unsubscribers: [], disposed: false, pending: false, ...fields };
        binding.dispose = () => this.#disposeBinding(binding);
        const nodeBindings = this.bindings.get(node.id) ?? new Set();
        nodeBindings.add(binding);
        this.bindings.set(node.id, nodeBindings);
        const dependencies = this.dependencies.get(node.id) ?? new Set();
        if (binding.sourcePath) dependencies.add(binding.sourcePath);
        for (const path of binding.dependencies ?? []) dependencies.add(path);
        this.dependencies.set(node.id, dependencies);
        this.totalBindings++;
        return binding;
    }

    #disposeBinding(binding) {
        if (binding.disposed) return false;
        binding.disposed = true;
        for (const unsubscribe of binding.unsubscribers) unsubscribe();
        if (binding.eventHandler) binding.node.removeEventListener(binding.eventType, binding.eventHandler);
        this.pendingBindings.delete(binding);
        const nodeBindings = this.bindings.get(binding.node.id);
        nodeBindings?.delete(binding);
        if (nodeBindings?.size === 0) {
            this.bindings.delete(binding.node.id);
            this.dependencies.delete(binding.node.id);
        }
        this.totalBindings = Math.max(0, this.totalBindings - 1);
        return true;
    }

    #schedule(binding) {
        if (binding.disposed) return;
        this.pendingBindings.add(binding);
        if (this.flushScheduled) return;
        this.flushScheduled = true;
        queueMicrotask(() => {
            if (!this.destroyed) this.flushUpdates();
        });
    }

    #computeBinding(binding) {
        const started = now();
        try {
            binding.value = binding.computeFn.call({
                get: (path) => this.store.get(path),
                state: this.store.getState(),
                node: binding.node,
            });
        } finally {
            binding.dirty = false;
            this.totalComputations++;
            this.totalComputeTime += now() - started;
        }
    }

    #applyNodeProperty(node, property, value) {
        if (property === 'textContent' || property === 'text') {
            const next = value === null || value === undefined ? '' : String(value);
            if (node.textContent === next) return false;
            node.setTextContent(next);
            return true;
        }
        if (property.startsWith('state.')) {
            const stateName = property.slice(6);
            const flag = STATE_PROPERTIES[stateName];
            if (!flag) throw new TypeError(`Unknown UINode state property: ${property}`);
            const enabled = Boolean(value);
            if (node.hasState(flag) === enabled) return false;
            node.setState(flag, enabled);
            return true;
        }
        if (property.startsWith('aria.')) {
            const field = `aria${property.slice(5, 6).toUpperCase()}${property.slice(6)}`;
            if (node[field] === value) return false;
            node[field] = value;
            node.markDirty(DIRTY.ACCESSIBILITY);
            return true;
        }
        if (property.startsWith('node.')) {
            const field = property.slice(5);
            if (node[field] === value) return false;
            node[field] = value;
            node.markDirty(DIRTY.PAINT);
            return true;
        }
        if (Object.is(node.getStyle(property), value)) return false;
        node.setStyle(property, value);
        return true;
    }

    async #dispatchBindingIntent(binding, event) {
        if (binding.node.hasState(NODE_STATE.DISABLED)) return null;
        if (typeof this.dispatchIntent !== 'function') throw new Error('BindingEngine has no intent dispatcher');
        const rawValue = eventValue(event);
        const value = binding.reverseTransform ? binding.reverseTransform(rawValue, event) : rawValue;
        const intent = typeof binding.intent === 'function'
            ? binding.intent({ event, value, node: binding.node, store: this.store })
            : { ...(binding.intent ?? {}), action: binding.intent?.action ?? binding.action, path: binding.sourcePath, value };
        binding.pending = true;
        const started = now();
        this.logger.debug?.(`[Plauna][BindingEngine][intent][entry] node=${binding.node.id} action=${intent.action ?? 'unknown'}`);
        if (binding.pendingPath) this.store.set(binding.pendingPath, true);
        if (binding.errorPath) this.store.set(binding.errorPath, null);
        this.totalIntents++;
        try {
            return await this.dispatchIntent(intent, { node: binding.node, event, binding });
        } catch (error) {
            this.failedIntents++;
            if (binding.errorPath) this.store.set(binding.errorPath, error?.message ?? String(error));
            this.logger.error?.(`[Plauna][BindingEngine][intent] node=${binding.node.id}`, error);
            throw error;
        } finally {
            binding.pending = false;
            if (binding.pendingPath) this.store.set(binding.pendingPath, false);
            this.logger.debug?.(`[Plauna][BindingEngine][intent][exit] node=${binding.node.id} action=${intent.action ?? 'unknown'} durationMs=${(now() - started).toFixed(3)}`);
        }
    }

    #assertReady() {
        this.#assertActive();
        if (!this.store) throw new Error('BindingEngine requires a StateStore before binding state');
    }

    #assertActive() {
        if (this.destroyed) throw new Error('BindingEngine has been destroyed');
    }
}

export const BindingUtils = Object.freeze({
    oneWay: (engine, node, property, path, options) => engine.bindOneWay(node, property, path, options),
    twoWay: (engine, node, property, path, options) => engine.bindTwoWay(node, property, path, options),
    computed: (engine, node, property, computeFn, dependencies, options) =>
        engine.bindComputed(node, property, computeFn, dependencies, options),
    intent: (engine, node, eventType, intent, options) => engine.bindIntent(node, eventType, intent, options),
    remove: (engine, node, property) => engine.removeBinding(node, property),
    removeAll: (engine, node) => engine.removeBindings(node),
    getValue: (engine, node, property) => engine.getBindingInfo(node, property)?.value,
    hasBinding: (engine, node, property) => engine.getBindingInfo(node, property) !== null,
    updateAll: (engine, node) => {
        for (const binding of engine.getBindings(node)) engine.updateBinding(binding);
    },
});
