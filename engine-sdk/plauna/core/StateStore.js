// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Observable projection store used by Plauna bindings.
 *
 * The store is intentionally authority-neutral: networked UI writes arrive as
 * projections, while user actions leave through BindingEngine intent handlers.
 */

const BLOCKED_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor']);

function now() {
    return globalThis.performance?.now?.() ?? Date.now();
}

function pathParts(path) {
    if (typeof path !== 'string' || path.length === 0) {
        throw new TypeError('StateStore path must be a non-empty string');
    }
    const parts = path.split('.');
    if (parts.some((part) => !part || BLOCKED_PATH_PARTS.has(part))) {
        throw new TypeError(`Unsafe StateStore path: ${path}`);
    }
    return parts;
}

function cloneRoot(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('StateStore state must be an object');
    }
    return { ...value };
}

export class StateStore {
    constructor(initialState = {}, options = {}) {
        this.state = cloneRoot(initialState);
        this.subscribers = new Map();
        this.dependencies = new Map();
        this.computedDefinitions = new Map();
        this.computedCache = new Map();
        this.computedDeps = new Map();
        this.batchDepth = 0;
        this.batchedUpdates = new Map();
        this.destroyed = false;
        this.logger = options.logger ?? console;
        this.totalUpdates = 0;
        this.totalSubscribers = 0;
        this.totalComputeTime = 0;
        this.totalComputations = 0;
    }

    get(path, defaultValue = undefined) {
        if (path === '' || path === undefined || path === null) return this.state;
        const value = this.getNestedValue(this.state, path);
        return value === undefined ? defaultValue : value;
    }

    set(path, value) {
        this.#assertActive();
        const oldValue = this.get(path);
        if (Object.is(oldValue, value)) return false;
        this.setNestedValue(this.state, path, value);
        this.#queueOrNotify(path, value, oldValue);
        this.#invalidateComputed(path);
        this.totalUpdates++;
        return true;
    }

    update(path, updater) {
        if (typeof updater !== 'function') throw new TypeError('StateStore updater must be a function');
        return this.set(path, updater(this.get(path)));
    }

    merge(path, updates) {
        if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
            throw new TypeError('StateStore merge value must be an object');
        }
        const current = this.get(path, {});
        if (!current || typeof current !== 'object' || Array.isArray(current)) {
            throw new TypeError(`Cannot merge into non-object path: ${path}`);
        }
        return this.set(path, { ...current, ...updates });
    }

    subscribe(path, callback, options = {}) {
        this.#assertActive();
        if (typeof callback !== 'function') throw new TypeError('StateStore subscriber must be a function');
        if (path !== '*') pathParts(path.endsWith('.*') ? path.slice(0, -2) : path);
        const callbacks = this.subscribers.get(path) ?? new Set();
        callbacks.add(callback);
        this.subscribers.set(path, callbacks);
        const paths = this.dependencies.get(callback) ?? new Set();
        paths.add(path);
        this.dependencies.set(callback, paths);
        this.totalSubscribers++;
        if (options.immediate) {
            const immediatePath = path === '*' ? null : path.replace(/\.\*$/, '');
            callback(this.get(immediatePath), undefined, path);
        }
        let active = true;
        return () => {
            if (!active) return false;
            active = false;
            return this.unsubscribe(path, callback);
        };
    }

    unsubscribe(path, callback) {
        const callbacks = this.subscribers.get(path);
        if (!callbacks?.delete(callback)) return false;
        if (callbacks.size === 0) this.subscribers.delete(path);
        const paths = this.dependencies.get(callback);
        paths?.delete(path);
        if (paths?.size === 0) this.dependencies.delete(callback);
        this.totalSubscribers = Math.max(0, this.totalSubscribers - 1);
        return true;
    }

    unsubscribeAll(path) {
        const callbacks = this.subscribers.get(path);
        if (!callbacks) return 0;
        const count = callbacks.size;
        for (const callback of callbacks) {
            const paths = this.dependencies.get(callback);
            paths?.delete(path);
            if (paths?.size === 0) this.dependencies.delete(callback);
        }
        this.subscribers.delete(path);
        this.totalSubscribers = Math.max(0, this.totalSubscribers - count);
        return count;
    }

    computed(path, computeFn, deps = []) {
        this.#assertActive();
        if (typeof computeFn !== 'function') throw new TypeError('Computed value requires a function');
        pathParts(path);
        deps.forEach(pathParts);
        this.computedDefinitions.set(path, computeFn);
        this.computedDeps.set(path, new Set(deps));
        this.#recomputeComputed(path);
        return () => this.get(path);
    }

    batch(updatesOrCallback) {
        this.startBatch();
        try {
            if (typeof updatesOrCallback === 'function') return updatesOrCallback(this);
            for (const [path, value] of Object.entries(updatesOrCallback ?? {})) this.set(path, value);
        } finally {
            this.endBatch();
        }
    }

    startBatch() {
        this.#assertActive();
        this.batchDepth++;
    }

    endBatch() {
        if (this.batchDepth <= 0) throw new Error('StateStore batch underflow');
        this.batchDepth--;
        if (this.batchDepth === 0) this.flushBatchedUpdates();
    }

    flushBatchedUpdates() {
        const updates = [...this.batchedUpdates.values()];
        this.batchedUpdates.clear();
        for (const update of updates) this.#notifySubscribers(update.path, update.newValue, update.oldValue);
    }

    getNestedValue(object, path) {
        let current = object;
        for (const part of pathParts(path)) {
            if (current === null || current === undefined) return undefined;
            current = current[part];
        }
        return current;
    }

    setNestedValue(object, path, value) {
        const parts = pathParts(path);
        let current = object;
        for (let index = 0; index < parts.length - 1; index++) {
            const part = parts[index];
            const child = current[part];
            if (!child || typeof child !== 'object' || Array.isArray(child)) current[part] = {};
            current = current[part];
        }
        current[parts.at(-1)] = value;
    }

    getState() {
        return { ...this.state };
    }

    setState(newState) {
        this.#assertActive();
        const next = cloneRoot(newState);
        const previous = this.state;
        this.state = next;
        this.computedCache.clear();
        for (const path of this.computedDefinitions.keys()) this.#recomputeComputed(path);
        for (const path of this.subscribers.keys()) {
            if (path === '*' || path.endsWith('.*')) continue;
            const oldValue = this.getNestedValue(previous, path);
            const newValue = this.getNestedValue(next, path);
            if (!Object.is(oldValue, newValue)) this.#queueOrNotify(path, newValue, oldValue);
        }
        this.#notifySubscribers('*', next, previous);
        this.totalUpdates++;
    }

    reset(initialState = {}) {
        this.setState(initialState);
    }

    validate() {
        const errors = [];
        for (const path of this.computedDefinitions.keys()) {
            if (!this.computedCache.has(path)) errors.push(`Computed value ${path} has no cache entry`);
        }
        for (const [path, deps] of this.computedDeps) {
            for (const dep of deps) {
                if (this.get(dep) === undefined && !this.computedDefinitions.has(dep)) {
                    errors.push(`Computed ${path} depends on non-existent ${dep}`);
                }
            }
        }
        if (errors.length) this.logger.error?.('[Plauna][StateStore][validate]', errors);
        return errors.length === 0;
    }

    getDebugInfo() {
        return {
            state: this.getState(),
            subscriberPaths: this.subscribers.size,
            computed: this.computedDefinitions.size,
            batchDepth: this.batchDepth,
            performance: {
                totalUpdates: this.totalUpdates,
                totalSubscribers: this.totalSubscribers,
                totalComputations: this.totalComputations,
                totalComputeTime: this.totalComputeTime,
                averageComputeTime: this.totalComputations ? this.totalComputeTime / this.totalComputations : 0,
            },
        };
    }

    printState() {
        this.logger.log?.('[Plauna][StateStore][state]', this.getState());
    }

    printSubscribers() {
        this.logger.log?.('[Plauna][StateStore][subscribers]',
            [...this.subscribers].map(([path, callbacks]) => ({ path, count: callbacks.size })));
    }

    destroy() {
        if (this.destroyed) return;
        this.subscribers.clear();
        this.dependencies.clear();
        this.computedDefinitions.clear();
        this.computedCache.clear();
        this.computedDeps.clear();
        this.batchedUpdates.clear();
        this.state = {};
        this.batchDepth = 0;
        this.totalSubscribers = 0;
        this.destroyed = true;
    }

    #queueOrNotify(path, newValue, oldValue) {
        if (this.batchDepth > 0) {
            const existing = this.batchedUpdates.get(path);
            this.batchedUpdates.set(path, { path, newValue, oldValue: existing?.oldValue ?? oldValue });
            return;
        }
        this.#notifySubscribers(path, newValue, oldValue);
    }

    #notifySubscribers(path, newValue, oldValue) {
        const calls = [];
        if (this.subscribers.has(path)) calls.push([path, this.subscribers.get(path)]);
        if (path !== '*' && this.subscribers.has('*')) calls.push(['*', this.subscribers.get('*')]);
        if (path !== '*') {
            for (const [pattern, callbacks] of this.subscribers) {
                if (!pattern.endsWith('.*')) continue;
                const prefix = pattern.slice(0, -1);
                if (path === prefix.slice(0, -1) || path.startsWith(prefix)) calls.push([pattern, callbacks]);
            }
        }
        for (const [subscriberPath, callbacks] of calls) {
            for (const callback of [...callbacks]) {
                try {
                    callback(newValue, oldValue, path);
                } catch (error) {
                    this.logger.error?.(`[Plauna][StateStore][subscriber] path=${subscriberPath}`, error);
                }
            }
        }
        if (path !== '*') {
            const descendantPrefix = `${path}.`;
            for (const [subscriberPath, callbacks] of this.subscribers) {
                if (subscriberPath.endsWith('*') || !subscriberPath.startsWith(descendantPrefix)) continue;
                const relativePath = subscriberPath.slice(descendantPrefix.length);
                const descendantNew = newValue == null ? undefined : this.getNestedValue(newValue, relativePath);
                const descendantOld = oldValue == null ? undefined : this.getNestedValue(oldValue, relativePath);
                if (Object.is(descendantNew, descendantOld)) continue;
                for (const callback of [...callbacks]) {
                    try {
                        callback(descendantNew, descendantOld, subscriberPath);
                    } catch (error) {
                        this.logger.error?.(`[Plauna][StateStore][subscriber] path=${subscriberPath}`, error);
                    }
                }
            }
        }
    }

    #invalidateComputed(changedPath) {
        for (const [path, deps] of this.computedDeps) {
            if (![...deps].some((dep) => dep === changedPath || changedPath.startsWith(`${dep}.`) || dep.startsWith(`${changedPath}.`))) continue;
            this.#recomputeComputed(path);
        }
    }

    #recomputeComputed(path) {
        const computeFn = this.computedDefinitions.get(path);
        if (!computeFn) return;
        const started = now();
        try {
            const previous = this.get(path);
            const result = computeFn.call({ get: (depPath) => this.get(depPath), state: this.state });
            this.computedCache.set(path, result);
            this.setNestedValue(this.state, path, result);
            if (!Object.is(previous, result)) this.#queueOrNotify(path, result, previous);
        } catch (error) {
            this.logger.error?.(`[Plauna][StateStore][computed] path=${path}`, error);
        } finally {
            this.totalComputations++;
            this.totalComputeTime += now() - started;
        }
    }

    #assertActive() {
        if (this.destroyed) throw new Error('StateStore has been destroyed');
    }
}

export function createStore(initialState = {}, options = {}) {
    return new StateStore(initialState, options);
}

/**
 * Framework-neutral compatibility helper. The third tuple item subscribes to
 * future values; no React global or hidden lifecycle is required.
 */
export function useStore(store, path, defaultValue) {
    return [
        store.get(path, defaultValue),
        (newValue) => store.set(path, newValue),
        (callback, options) => store.subscribe(path, callback, options),
    ];
}
