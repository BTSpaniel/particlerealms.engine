// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Resource Barriers Helper - Explicit sync points for complex resource dependencies.
 */

function barrierDestroyedError(operation) {
    const error = new Error(`Resource barriers are destroyed; cannot ${operation}`);
    error.code = 'VGPU_RESOURCE_BARRIERS_DESTROYED';
    return error;
}

export class VGPUResourceBarriers {
    constructor(vgpu) {
        this.vgpu = vgpu;
        this.device = vgpu.device;
        this._pendingBarriers = [];
        this._resourceStates = new Map();
        this._transitionQueue = [];
        this._scopes = new Set();
        this._graphs = new Set();
        this._destroyed = false;
        this._generation = 0;
    }

    static State = {
        UNDEFINED: 'undefined',
        VERTEX_BUFFER: 'vertex',
        INDEX_BUFFER: 'index',
        UNIFORM_READ: 'uniform',
        STORAGE_READ: 'storage_read',
        STORAGE_WRITE: 'storage_write',
        COPY_SRC: 'copy_src',
        COPY_DST: 'copy_dst',
        RENDER_TARGET: 'render_target',
        DEPTH_WRITE: 'depth_write',
        DEPTH_READ: 'depth_read',
        TEXTURE_READ: 'texture_read',
        PRESENT: 'present',
        INDIRECT: 'indirect',
    };

    _assertActive(operation = 'perform work') {
        if (this._destroyed || !this._resourceStates) throw barrierDestroyedError(operation);
        return this._generation;
    }

    _isGeneration(generation) {
        return !this._destroyed && generation === this._generation;
    }

    _assertGeneration(generation, operation) {
        if (!this._isGeneration(generation)) throw barrierDestroyedError(operation);
    }

    _readExternalMember(receiver, key, generation, operation) {
        this._assertGeneration(generation, operation);
        let value;
        try {
            value = receiver?.[key];
        } finally {
            this._assertGeneration(generation, operation);
        }
        return value;
    }

    _captureExternalCallable(receiver, key, generation, operation) {
        const callable = this._readExternalMember(receiver, key, generation, operation);
        if (typeof callable !== 'function') {
            throw new TypeError(`[ResourceBarriers] ${String(key)} is not callable`);
        }
        this._assertGeneration(generation, operation);
        return { receiver, callable };
    }

    _invokeCapturedExternal(captured, args, generation, operation) {
        this._assertGeneration(generation, operation);
        let result;
        let callError = null;
        try {
            result = Reflect.apply(captured.callable, captured.receiver, args);
        } catch (error) {
            callError = error;
        }
        this._assertGeneration(generation, operation);
        if (callError) throw callError;
        return result;
    }

    _snapshotIterable(iterable, generation, operation) {
        const iteratorFactory = this._captureExternalCallable(
            iterable, Symbol.iterator, generation, `${operation} iterator`,
        );
        const iterator = this._invokeCapturedExternal(
            iteratorFactory, [], generation, `${operation} iterator`,
        );
        const next = this._captureExternalCallable(
            iterator, 'next', generation, `${operation} next`,
        );
        const values = [];
        while (true) {
            const step = this._invokeCapturedExternal(
                next, [], generation, `${operation} next`,
            );
            const done = this._readExternalMember(
                step, 'done', generation, `${operation} done`,
            );
            if (done) break;
            values.push(this._readExternalMember(
                step, 'value', generation, `${operation} value`,
            ));
        }
        return values;
    }

    trackResource(resource, state = VGPUResourceBarriers.State.UNDEFINED) {
        const generation = this._assertActive('track a resource');
        const label = this._readExternalMember(
            resource, 'label', generation, 'read a tracked resource label',
        ) || 'unnamed';
        this._resourceStates.set(resource, { current: state, pending: null, label });
        return true;
    }

    getState(resource) {
        if (this._destroyed || !this._resourceStates) {
            return VGPUResourceBarriers.State.UNDEFINED;
        }
        return this._resourceStates.get(resource)?.current
            || VGPUResourceBarriers.State.UNDEFINED;
    }

    transition(resource, toState) {
        const generation = this._assertActive('transition a resource');
        let info = this._resourceStates.get(resource);
        if (!info) {
            const label = this._readExternalMember(
                resource, 'label', generation, 'read a transitioned resource label',
            ) || 'unnamed';
            info = {
                current: VGPUResourceBarriers.State.UNDEFINED,
                pending: null,
                label,
            };
            this._resourceStates.set(resource, info);
        }
        if (info.current === toState) return false;

        const hazard = this._checkHazard(info.current, toState);
        if (hazard) {
            this._transitionQueue.push({
                resource,
                from: info.current,
                to: toState,
                hazard,
            });
        }
        info.pending = toState;
        return true;
    }

    transitionBatch(transitions) {
        const generation = this._assertActive('transition a resource batch');
        const transitionList = this._snapshotIterable(
            transitions, generation, 'snapshot resource transitions',
        );
        let changed = 0;
        for (const transition of transitionList) {
            const resource = this._readExternalMember(
                transition, 'resource', generation, 'read a batch transition resource',
            );
            const state = this._readExternalMember(
                transition, 'state', generation, 'read a batch transition state',
            );
            if (this.transition(resource, state)) changed++;
        }
        return changed;
    }

    flush(encoder) {
        const generation = this._assertActive('flush resource transitions');
        if (this._transitionQueue.length === 0) return false;
        const transitions = this._transitionQueue;
        this._transitionQueue = [];
        let index = 0;
        try {
            for (; index < transitions.length; index++) {
                const transition = transitions[index];
                this._assertGeneration(generation, 'flush resource transitions');
                const info = this._resourceStates.get(transition.resource);
                if (!info) continue;
                const pushMethod = this._readExternalMember(
                    encoder, 'pushDebugGroup', generation, 'resolve a transition debug marker',
                );
                if (pushMethod !== undefined && pushMethod !== null) {
                    if (typeof pushMethod !== 'function') {
                        throw new TypeError('[ResourceBarriers] pushDebugGroup is not callable');
                    }
                    const popMethod = this._readExternalMember(
                        encoder, 'popDebugGroup', generation, 'resolve a transition debug marker cleanup',
                    );
                    if (typeof popMethod !== 'function') {
                        throw new TypeError('[ResourceBarriers] popDebugGroup is not callable');
                    }
                    this._invokeCapturedExternal(
                        { receiver: encoder, callable: pushMethod },
                        [`Barrier: ${info.label} ${transition.from} -> ${transition.to}`],
                        generation,
                        'push a transition debug marker',
                    );
                    this._invokeCapturedExternal(
                        { receiver: encoder, callable: popMethod },
                        [],
                        generation,
                        'pop a transition debug marker',
                    );
                }
                info.current = transition.to;
                info.pending = null;
            }
            return true;
        } catch (error) {
            if (this._isGeneration(generation) && this._transitionQueue) {
                this._transitionQueue = transitions.slice(index).concat(this._transitionQueue);
            }
            throw error;
        }
    }

    scope(fn) {
        const generation = this._assertActive('create a barrier scope');
        const scope = new BarrierScope(this, generation);
        this._scopes.add(scope);
        try {
            if (typeof fn !== 'function') throw new TypeError('Barrier scope callback is not callable');
            this._assertGeneration(generation, 'invoke a barrier scope');
            Reflect.apply(fn, undefined, [scope]);
            this._assertGeneration(generation, 'complete a barrier scope');
            return scope.getTransitions();
        } catch (error) {
            scope.destroy();
            throw error;
        }
    }

    _checkHazard(fromState, toState) {
        const State = VGPUResourceBarriers.State;
        const writeStates = [
            State.STORAGE_WRITE,
            State.RENDER_TARGET,
            State.DEPTH_WRITE,
            State.COPY_DST,
        ];
        if (writeStates.includes(fromState) && writeStates.includes(toState)) return 'WAW';
        const readStates = [
            State.VERTEX_BUFFER,
            State.INDEX_BUFFER,
            State.UNIFORM_READ,
            State.STORAGE_READ,
            State.COPY_SRC,
            State.TEXTURE_READ,
            State.DEPTH_READ,
            State.INDIRECT,
        ];
        if (readStates.includes(fromState) && writeStates.includes(toState)) return 'WAR';
        if (writeStates.includes(fromState) && readStates.includes(toState)) return 'RAW';
        return null;
    }

    createDependencyGraph(passes) {
        const generation = this._assertActive('create a dependency graph');
        const graph = new DependencyGraph(this, generation);
        this._graphs.add(graph);
        try {
            for (const pass of passes) {
                this._assertGeneration(generation, 'create a dependency graph');
                graph.addNode(pass.name);
                for (const read of pass.reads || []) {
                    const writer = this._findLastWriter(passes, read, pass, generation);
                    if (writer) graph.addEdge(writer.name, pass.name, { resource: read, type: 'RAW' });
                }
                for (const write of pass.writes || []) {
                    const reader = this._findLastReader(passes, write, pass, generation);
                    if (reader) graph.addEdge(reader.name, pass.name, { resource: write, type: 'WAR' });
                }
            }
            this._assertGeneration(generation, 'publish a dependency graph');
            return graph;
        } catch (error) {
            graph.destroy();
            throw error;
        }
    }

    _findLastWriter(passes, resource, beforePass, generation) {
        for (let index = passes.indexOf(beforePass) - 1; index >= 0; index--) {
            const writes = passes[index].writes;
            this._assertGeneration(generation, 'inspect dependency writers');
            if (writes?.includes(resource)) return passes[index];
        }
        return null;
    }

    _findLastReader(passes, resource, beforePass, generation) {
        for (let index = passes.indexOf(beforePass) - 1; index >= 0; index--) {
            const reads = passes[index].reads;
            this._assertGeneration(generation, 'inspect dependency readers');
            if (reads?.includes(resource)) return passes[index];
        }
        return null;
    }

    _releaseScope(scope) {
        this._scopes?.delete(scope);
    }

    _releaseGraph(graph) {
        this._graphs?.delete(graph);
    }

    reset() {
        this._assertActive('reset resource barriers');
        this._resourceStates.clear();
        this._pendingBarriers.splice(0);
        this._transitionQueue.splice(0);
        return true;
    }

    getDebugInfo() {
        if (this._destroyed || !this._resourceStates) return [];
        const info = [];
        for (const state of this._resourceStates.values()) {
            info.push({
                label: state.label,
                current: state.current,
                pending: state.pending,
            });
        }
        return info;
    }

    destroy() {
        if (this._destroyed) return false;
        const scopes = this._scopes ? Array.from(this._scopes) : [];
        const graphs = this._graphs ? Array.from(this._graphs) : [];
        this._destroyed = true;
        this._generation++;
        this._pendingBarriers?.splice(0);
        this._resourceStates?.clear();
        this._transitionQueue?.splice(0);
        this._scopes?.clear();
        this._graphs?.clear();
        this._pendingBarriers = null;
        this._resourceStates = null;
        this._transitionQueue = null;
        this._scopes = null;
        this._graphs = null;
        this.device = null;
        this.vgpu = null;
        for (const scope of scopes) scope._destroyFromParent();
        for (const graph of graphs) graph._destroyFromParent();
        return true;
    }

    dispose() {
        return this.destroy();
    }
}

class BarrierScope {
    constructor(barriers, managerGeneration = barriers?._generation) {
        this.barriers = barriers;
        this._managerGeneration = managerGeneration;
        this._transitions = [];
        this._destroyed = false;
    }

    _assertActive(operation) {
        if (
            this._destroyed
            || !this.barriers
            || !this.barriers._isGeneration(this._managerGeneration)
        ) throw barrierDestroyedError(operation);
    }

    read(resource, state) {
        this._assertActive('record a scoped read');
        const readStates = {
            vertex: VGPUResourceBarriers.State.VERTEX_BUFFER,
            index: VGPUResourceBarriers.State.INDEX_BUFFER,
            uniform: VGPUResourceBarriers.State.UNIFORM_READ,
            storage: VGPUResourceBarriers.State.STORAGE_READ,
            texture: VGPUResourceBarriers.State.TEXTURE_READ,
            depth: VGPUResourceBarriers.State.DEPTH_READ,
            indirect: VGPUResourceBarriers.State.INDIRECT,
        };
        const targetState = readStates[state] || state;
        if (this.barriers.transition(resource, targetState)) {
            this._transitions.push({ resource, state: targetState, type: 'read' });
        }
        return this;
    }

    write(resource, state) {
        this._assertActive('record a scoped write');
        const writeStates = {
            storage: VGPUResourceBarriers.State.STORAGE_WRITE,
            render: VGPUResourceBarriers.State.RENDER_TARGET,
            depth: VGPUResourceBarriers.State.DEPTH_WRITE,
            copy: VGPUResourceBarriers.State.COPY_DST,
        };
        const targetState = writeStates[state] || state;
        if (this.barriers.transition(resource, targetState)) {
            this._transitions.push({ resource, state: targetState, type: 'write' });
        }
        return this;
    }

    getTransitions() {
        if (this._destroyed || !this._transitions) return [];
        return this._transitions.slice();
    }

    _destroyFromParent() {
        if (this._destroyed) return false;
        const barriers = this.barriers;
        this._destroyed = true;
        this._transitions?.splice(0);
        this._transitions = null;
        this.barriers = null;
        barriers?._releaseScope(this);
        return true;
    }

    destroy() {
        return this._destroyFromParent();
    }
}

class DependencyGraph {
    constructor(barriers = null, managerGeneration = barriers?._generation) {
        this._barriers = barriers;
        this._managerGeneration = managerGeneration;
        this._nodes = new Set();
        this._edges = [];
        this._destroyed = false;
    }

    _assertMutable(operation) {
        if (
            this._destroyed
            || (this._barriers && !this._barriers._isGeneration(this._managerGeneration))
        ) throw barrierDestroyedError(operation);
    }

    addNode(name) {
        this._assertMutable('add a dependency node');
        this._nodes.add(name);
        return this;
    }

    addEdge(from, to, data = {}) {
        this._assertMutable('add a dependency edge');
        this._edges.push({ from, to, ...data });
        return this;
    }

    getExecutionOrder() {
        if (this._destroyed || !this._nodes || !this._edges) return [];
        const inDegree = new Map();
        const adjacency = new Map();
        for (const node of this._nodes) {
            inDegree.set(node, 0);
            adjacency.set(node, []);
        }
        for (const edge of this._edges) {
            adjacency.get(edge.from)?.push(edge.to);
            inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
        }
        const queue = [];
        for (const [node, degree] of inDegree) if (degree === 0) queue.push(node);
        const order = [];
        while (queue.length > 0) {
            const node = queue.shift();
            order.push(node);
            for (const neighbor of adjacency.get(node) || []) {
                const degree = inDegree.get(neighbor) - 1;
                inDegree.set(neighbor, degree);
                if (degree === 0) queue.push(neighbor);
            }
        }
        if (order.length !== this._nodes.size) {
            console.warn('[DependencyGraph] Cycle detected in graph');
        }
        return order;
    }

    getParallelGroups() {
        if (this._destroyed) return [];
        const order = this.getExecutionOrder();
        const levels = new Map();
        for (const node of order) {
            let maxLevel = -1;
            for (const edge of this._edges) {
                if (edge.to === node) maxLevel = Math.max(maxLevel, levels.get(edge.from) || 0);
            }
            levels.set(node, maxLevel + 1);
        }
        const groups = [];
        for (const [node, level] of levels) {
            if (!groups[level]) groups[level] = [];
            groups[level].push(node);
        }
        return groups;
    }

    _destroyFromParent() {
        if (this._destroyed) return false;
        const barriers = this._barriers;
        this._destroyed = true;
        this._nodes?.clear();
        this._edges?.splice(0);
        this._nodes = null;
        this._edges = null;
        this._barriers = null;
        barriers?._releaseGraph(this);
        return true;
    }

    destroy() {
        return this._destroyFromParent();
    }
}

export { BarrierScope, DependencyGraph };
