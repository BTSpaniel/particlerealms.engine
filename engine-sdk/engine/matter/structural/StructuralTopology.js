// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Deterministic mutable structural graph with persistent fracture residuals. */

import {
    cloneAndFreezeStrictJson,
    cloneStrictJson,
    isPlainJsonObject,
} from '../../core/schema/StrictJsonValue.js';
import {
    STRUCTURAL_BOND_SCHEMA,
    STRUCTURAL_SCHEMA_VERSION,
    createRigidAggregate,
    createStructuralBond,
    createStructuralCrackResidual,
    createStructuralNode,
    createStructuralRefinementRequest,
    createStructuralTopologySnapshot,
} from './StructuralContracts.js';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;
const STAGE_INDEX = new Map([
    'elastic', 'yield', 'plastic', 'fatigue', 'damage', 'fracture',
].map((stage, index) => [stage, index]));

function fail(path, message) {
    throw new TypeError(`${path}: ${message}`);
}

function identifier(value, path) {
    if (typeof value !== 'string' || !IDENTIFIER.test(value)) fail(path, 'has invalid identifier syntax');
    return value;
}

function integer(value, path, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        fail(path, `must be a safe integer in [${minimum}, ${maximum}]`);
    }
    return value;
}

function finite(value, path, minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
        fail(path, `must be finite in [${minimum}, ${maximum}]`);
    }
    return value;
}

function exactObject(value, allowed, path) {
    if (!isPlainJsonObject(value)) fail(path, 'must be a plain object');
    for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${path}.${key}`, 'unknown field');
    return value;
}

function safeOptions(input, allowed, path) {
    if (!isPlainJsonObject(input)) fail(path, 'must be a plain object');
    const output = {};
    for (const key of Reflect.ownKeys(input)) {
        if (typeof key !== 'string') fail(path, 'symbol keys are not supported');
        if (!allowed.has(key)) fail(`${path}.${key}`, 'unknown field');
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor?.enumerable) fail(`${path}.${key}`, 'non-enumerable fields are not supported');
        if (!Object.hasOwn(descriptor, 'value')) fail(`${path}.${key}`, 'accessors are not supported');
        output[key] = descriptor.value;
    }
    return output;
}

function nowMs() {
    return globalThis.performance?.now?.() ?? Date.now();
}

function callLogger(logger, type, details = {}) {
    try { logger?.(Object.freeze({ type, ...details })); } catch (_) { /* diagnostics have no state authority */ }
}

function hashToken(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function mutable(value) {
    return cloneStrictJson(value);
}

function sortedValues(map) {
    return [...map.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function sortedIds(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizeVector(vector, fallback = [1, 0, 0]) {
    if (!Array.isArray(vector) || vector.length !== 3) fail('$.vector', 'must be a 3-vector');
    vector.forEach((entry, index) => finite(entry, `$.vector[${index}]`));
    const length = Math.hypot(...vector);
    if (length <= Number.EPSILON) return [...fallback];
    return vector.map(entry => entry / length);
}

export class StructuralTopology {
    #topologyId;
    #revision = 0;
    #deviceGeneration;
    #stepIndex = 0;
    #nodes = new Map();
    #bonds = new Map();
    #cracks = new Map();
    #aggregates = new Map();
    #hooks = new Map();
    #logger;
    #destroyed = false;
    #maximumNodes;
    #maximumBonds;

    constructor(optionsInput = {}) {
        const options = safeOptions(optionsInput, new Set([
            'topologyId', 'deviceGeneration', 'maximumNodes', 'maximumBonds', 'logger',
        ]), '$.options');
        this.#topologyId = identifier(options.topologyId, '$.options.topologyId');
        this.#deviceGeneration = integer(options.deviceGeneration ?? 0, '$.options.deviceGeneration');
        this.#maximumNodes = integer(options.maximumNodes ?? 1_000_000, '$.options.maximumNodes', 1, 10_000_000);
        this.#maximumBonds = integer(options.maximumBonds ?? 4_000_000, '$.options.maximumBonds', 1, 40_000_000);
        if (options.logger != null && typeof options.logger !== 'function') fail('$.options.logger', 'must be a function or null');
        this.#logger = options.logger ?? null;
        this.#log('structural-topology-initialize', {
            topologyId: this.#topologyId,
            deviceGeneration: this.#deviceGeneration,
        });
    }

    #assertAlive() {
        if (this.#destroyed) throw new Error('StructuralTopology is destroyed');
    }

    #log(type, details = {}) {
        callLogger(this.#logger, type, details);
    }

    get topologyId() { return this.#topologyId; }
    get revision() { return this.#revision; }
    get stepIndex() { return this.#stepIndex; }
    get deviceGeneration() { return this.#deviceGeneration; }
    get nodeCount() { return this.#nodes.size; }
    get bondCount() { return this.#bonds.size; }
    get crackCount() { return this.#cracks.size; }

    addNode(nodeInput) {
        this.#assertAlive();
        const started = nowMs();
        try {
            const node = createStructuralNode(nodeInput);
            if (this.#nodes.has(node.id)) fail('$.structuralNode.id', `duplicates '${node.id}'`);
            if (this.#nodes.size >= this.#maximumNodes) throw new RangeError('Structural node capacity exhausted');
            this.#nodes.set(node.id, mutable(node));
            this.#aggregates.clear();
            this.#revision++;
            this.#log('structural-node-added', {
                topologyId: this.#topologyId,
                nodeId: node.id,
                revision: this.#revision,
                durationMs: nowMs() - started,
            });
            return node;
        } catch (error) {
            this.#log('structural-node-add-error', { message: error.message, durationMs: nowMs() - started });
            throw error;
        }
    }

    addBond(bondInput) {
        this.#assertAlive();
        const started = nowMs();
        try {
            const bond = createStructuralBond(bondInput);
            if (bond.lifecycle === 'fracture') fail('$.structuralBond.lifecycle', 'fractured bonds cannot be active');
            if (this.#bonds.has(bond.id)) fail('$.structuralBond.id', `duplicates '${bond.id}'`);
            if (!this.#nodes.has(bond.nodeAId) || !this.#nodes.has(bond.nodeBId)) {
                fail('$.structuralBond', 'references an unknown node');
            }
            for (const existing of this.#bonds.values()) {
                if (existing.nodeAId === bond.nodeAId && existing.nodeBId === bond.nodeBId) {
                    fail('$.structuralBond', `duplicates endpoint pair '${bond.nodeAId}:${bond.nodeBId}'`);
                }
            }
            if (this.#bonds.size >= this.#maximumBonds) throw new RangeError('Structural bond capacity exhausted');
            this.#bonds.set(bond.id, mutable(bond));
            this.#aggregates.clear();
            this.#revision++;
            this.#log('structural-bond-added', {
                topologyId: this.#topologyId,
                bondId: bond.id,
                revision: this.#revision,
                durationMs: nowMs() - started,
            });
            return bond;
        } catch (error) {
            this.#log('structural-bond-add-error', { message: error.message, durationMs: nowMs() - started });
            throw error;
        }
    }

    node(nodeId) {
        this.#assertAlive();
        const node = this.#nodes.get(identifier(nodeId, '$.nodeId'));
        return node ? cloneAndFreezeStrictJson(node) : null;
    }

    bond(bondId) {
        this.#assertAlive();
        const bond = this.#bonds.get(identifier(bondId, '$.bondId'));
        return bond ? cloneAndFreezeStrictJson(bond) : null;
    }

    bonds() {
        this.#assertAlive();
        return cloneAndFreezeStrictJson(sortedValues(this.#bonds));
    }

    setNodeKinematics(nodeId, updateInput) {
        this.#assertAlive();
        const id = identifier(nodeId, '$.nodeId');
        const current = this.#nodes.get(id);
        if (!current) throw new RangeError(`Unknown structural node '${id}'`);
        const update = cloneStrictJson(updateInput, '$.kinematics');
        exactObject(update, new Set(['positionM', 'previousPositionM', 'velocityMPerS']), '$.kinematics');
        const candidate = createStructuralNode({ ...current, ...update });
        this.#nodes.set(id, mutable(candidate));
        this.#aggregates.clear();
        return candidate;
    }

    updateBondState(bondId, patchInput) {
        this.#assertAlive();
        const id = identifier(bondId, '$.bondId');
        const current = this.#bonds.get(id);
        if (!current) throw new RangeError(`Unknown structural bond '${id}'`);
        const patch = cloneStrictJson(patchInput, '$.bondPatch');
        exactObject(patch, new Set([
            'plasticRestLengthM', 'lambda', 'lifecycle', 'fatigue', 'damage',
            'revision', 'timeBinExponent',
        ]), '$.bondPatch');
        const candidate = createStructuralBond({ ...current, ...patch });
        if (candidate.lifecycle === 'fracture') {
            fail('$.bondPatch.lifecycle', 'use fractureBond so the active edge is actually deleted');
        }
        if (STAGE_INDEX.get(candidate.lifecycle) < STAGE_INDEX.get(current.lifecycle)) {
            fail('$.bondPatch.lifecycle', 'cannot regress');
        }
        if (candidate.damage < current.damage) fail('$.bondPatch.damage', 'cannot decrease');
        if (candidate.revision !== current.revision + 1) fail('$.bondPatch.revision', 'must advance exactly once');
        this.#bonds.set(id, mutable(candidate));
        this.#aggregates.clear();
        return candidate;
    }

    advanceStep(stepIndex) {
        this.#assertAlive();
        const next = integer(stepIndex, '$.stepIndex');
        if (next <= this.#stepIndex) fail('$.stepIndex', 'must advance');
        this.#stepIndex = next;
        return next;
    }

    fractureBond(bondId, optionsInput = {}) {
        this.#assertAlive();
        const started = nowMs();
        try {
            const id = identifier(bondId, '$.bondId');
            const options = cloneStrictJson(optionsInput, '$.fractureOptions');
            exactObject(options, new Set(['fractureEventId', 'separationNormal', 'createdStep']), '$.fractureOptions');
            const bond = this.#bonds.get(id);
            if (!bond) throw new RangeError(`Unknown active structural bond '${id}'`);
            const eventId = identifier(options.fractureEventId, '$.fractureOptions.fractureEventId');
            const separationNormal = normalizeVector(options.separationNormal ?? bond.restDirection);
            const createdStep = integer(options.createdStep ?? this.#stepIndex, '$.fractureOptions.createdStep');
            const nextRevision = this.#revision + 1;
            const crack = createStructuralCrackResidual({
                id: `crack.${nextRevision}.${hashToken(`${id}:${eventId}`)}`,
                bondId: id,
                nodeAId: bond.nodeAId,
                nodeBId: bond.nodeBId,
                profileId: bond.profileId,
                fractureEventId: eventId,
                revision: nextRevision,
                damage: 1,
                separationNormal,
                createdStep,
            });
            this.#bonds.delete(id);
            this.#cracks.set(crack.id, mutable(crack));
            this.#aggregates.clear();
            this.#revision = nextRevision;
            const components = this.connectedComponents([bond.nodeAId, bond.nodeBId]);
            const result = cloneAndFreezeStrictJson({ crack, components });
            this.#log('structural-bond-fractured', {
                topologyId: this.#topologyId,
                bondId: id,
                crackId: crack.id,
                componentCount: components.length,
                revision: this.#revision,
                durationMs: nowMs() - started,
            });
            return result;
        } catch (error) {
            this.#log('structural-bond-fracture-error', { message: error.message, durationMs: nowMs() - started });
            throw error;
        }
    }

    connectedComponents(seedNodeIds = null) {
        this.#assertAlive();
        const started = nowMs();
        let seeds;
        if (seedNodeIds === null) {
            seeds = sortedIds(this.#nodes.keys());
        } else {
            const input = cloneStrictJson(seedNodeIds, '$.seedNodeIds');
            if (!Array.isArray(input) || input.length === 0) fail('$.seedNodeIds', 'must be a non-empty array');
            seeds = sortedIds(input.map((value, index) => identifier(value, `$.seedNodeIds[${index}]`)));
            for (const seed of seeds) if (!this.#nodes.has(seed)) fail('$.seedNodeIds', `contains unknown node '${seed}'`);
        }
        const adjacency = new Map([...this.#nodes.keys()].map(id => [id, []]));
        for (const bond of this.#bonds.values()) {
            adjacency.get(bond.nodeAId).push(bond.nodeBId);
            adjacency.get(bond.nodeBId).push(bond.nodeAId);
        }
        for (const neighbors of adjacency.values()) neighbors.sort((left, right) => left.localeCompare(right));
        const visited = new Set();
        const components = [];
        for (const seed of seeds) {
            if (visited.has(seed)) continue;
            const queue = [seed];
            visited.add(seed);
            const component = [];
            for (let cursor = 0; cursor < queue.length; cursor++) {
                const nodeId = queue[cursor];
                component.push(nodeId);
                for (const neighbor of adjacency.get(nodeId)) {
                    if (visited.has(neighbor)) continue;
                    visited.add(neighbor);
                    queue.push(neighbor);
                }
            }
            components.push(component.sort((left, right) => left.localeCompare(right)));
        }
        components.sort((left, right) => left[0].localeCompare(right[0]));
        this.#log('structural-components-rebuilt', {
            topologyId: this.#topologyId,
            seedCount: seeds.length,
            componentCount: components.length,
            durationMs: nowMs() - started,
        });
        return cloneAndFreezeStrictJson(components);
    }

    buildRigidAggregates(optionsInput = {}) {
        this.#assertAlive();
        const started = nowMs();
        const options = cloneStrictJson(optionsInput, '$.aggregateOptions');
        exactObject(options, new Set(['minimumNodes']), '$.aggregateOptions');
        const minimumNodes = integer(options.minimumNodes ?? 2, '$.aggregateOptions.minimumNodes', 1);
        const components = this.connectedComponents();
        const next = new Map();
        components.forEach((component, index) => {
            if (component.length < minimumNodes) return;
            let massKg = 0;
            const moment = [0, 0, 0];
            const velocityMoment = [0, 0, 0];
            for (const nodeId of component) {
                const node = this.#nodes.get(nodeId);
                massKg += node.massKg;
                for (let axis = 0; axis < 3; axis++) {
                    moment[axis] += node.positionM[axis] * node.massKg;
                    velocityMoment[axis] += node.velocityMPerS[axis] * node.massKg;
                }
            }
            const centerOfMassM = moment.map(value => value / massKg);
            const linearVelocityMPerS = velocityMoment.map(value => value / massKg);
            const angularMomentum = [0, 0, 0];
            let scalarInertia = 0;
            for (const nodeId of component) {
                const node = this.#nodes.get(nodeId);
                const radius = node.positionM.map((value, axis) => value - centerOfMassM[axis]);
                const relativeVelocity = node.velocityMPerS.map((value, axis) => value - linearVelocityMPerS[axis]);
                angularMomentum[0] += node.massKg * (radius[1] * relativeVelocity[2] - radius[2] * relativeVelocity[1]);
                angularMomentum[1] += node.massKg * (radius[2] * relativeVelocity[0] - radius[0] * relativeVelocity[2]);
                angularMomentum[2] += node.massKg * (radius[0] * relativeVelocity[1] - radius[1] * relativeVelocity[0]);
                scalarInertia += node.massKg * radius.reduce((sum, value) => sum + value * value, 0);
            }
            const nodeSet = new Set(component);
            const sourceBondIds = sortedValues(this.#bonds)
                .filter(bond => nodeSet.has(bond.nodeAId) && nodeSet.has(bond.nodeBId))
                .map(bond => bond.id);
            const crackResidualIds = sortedValues(this.#cracks)
                .filter(crack => nodeSet.has(crack.nodeAId) || nodeSet.has(crack.nodeBId))
                .map(crack => crack.id);
            const aggregate = createRigidAggregate({
                id: `aggregate.${this.#revision}.${index}`,
                topologyId: this.#topologyId,
                revision: this.#revision,
                nodeIds: component,
                sourceBondIds,
                crackResidualIds,
                centerOfMassM,
                linearVelocityMPerS,
                angularVelocityRadPerS: scalarInertia <= Number.EPSILON
                    ? [0, 0, 0]
                    : angularMomentum.map(value => value / scalarInertia),
                massKg,
                representation: 'rigid-aggregate',
                sourceDeviceGeneration: this.#deviceGeneration,
            });
            next.set(aggregate.id, mutable(aggregate));
        });
        this.#aggregates = next;
        this.#log('structural-rigid-aggregates-built', {
            topologyId: this.#topologyId,
            aggregateCount: next.size,
            durationMs: nowMs() - started,
        });
        return cloneAndFreezeStrictJson(sortedValues(next));
    }

    registerPredictiveRefinementHook(hookId, hook) {
        this.#assertAlive();
        const id = identifier(hookId, '$.hookId');
        if (typeof hook !== 'function') fail('$.hook', 'must be a function');
        if (this.#hooks.has(id)) fail('$.hookId', `duplicates '${id}'`);
        this.#hooks.set(id, hook);
        this.#log('structural-refinement-hook-registered', { hookId: id });
        return () => this.#hooks.delete(id);
    }

    evaluatePredictiveRefinement(contextInput = {}) {
        this.#assertAlive();
        const started = nowMs();
        const context = cloneStrictJson(contextInput, '$.refinementContext');
        if (!isPlainJsonObject(context)) fail('$.refinementContext', 'must be a plain object');
        const requests = [];
        try {
            for (const [hookId, hook] of [...this.#hooks.entries()].sort()) {
                const output = hook(cloneAndFreezeStrictJson(context), {
                    topologyId: this.#topologyId,
                    revision: this.#revision,
                    stepIndex: this.#stepIndex,
                    deviceGeneration: this.#deviceGeneration,
                });
                const entries = output == null ? [] : (Array.isArray(output) ? output : [output]);
                entries.forEach((entry, index) => {
                    requests.push(createStructuralRefinementRequest(entry, `$.hooks.${hookId}[${index}]`));
                });
            }
            requests.sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
            this.#log('structural-refinement-evaluated', {
                requestCount: requests.length,
                durationMs: nowMs() - started,
            });
            return cloneAndFreezeStrictJson(requests);
        } catch (error) {
            this.#log('structural-refinement-error', { message: error.message, durationMs: nowMs() - started });
            throw error;
        }
    }

    deleteBondsForNodes(nodeIdsInput, optionsInput = {}) {
        this.#assertAlive();
        const nodeInput = cloneStrictJson(nodeIdsInput, '$.nodeIds');
        if (!Array.isArray(nodeInput) || nodeInput.length === 0) fail('$.nodeIds', 'must be non-empty');
        const nodeIds = new Set(nodeInput.map((value, index) => identifier(value, `$.nodeIds[${index}]`)));
        for (const nodeId of nodeIds) if (!this.#nodes.has(nodeId)) fail('$.nodeIds', `contains unknown node '${nodeId}'`);
        const options = cloneStrictJson(optionsInput, '$.deleteBondOptions');
        exactObject(options, new Set(['fractureEventId', 'createdStep']), '$.deleteBondOptions');
        const affected = sortedValues(this.#bonds)
            .filter(bond => nodeIds.has(bond.nodeAId) || nodeIds.has(bond.nodeBId))
            .map(bond => bond.id);
        return cloneAndFreezeStrictJson(affected.map((bondId, index) => this.fractureBond(bondId, {
            fractureEventId: `phase-fracture.${hashToken(`${identifier(options.fractureEventId, '$.deleteBondOptions.fractureEventId')}:${bondId}:${index}`)}`,
            createdStep: options.createdStep ?? this.#stepIndex,
        }).crack));
    }

    weakenBondsForNodes(nodeIdsInput, damageDelta) {
        this.#assertAlive();
        const nodeInput = cloneStrictJson(nodeIdsInput, '$.nodeIds');
        if (!Array.isArray(nodeInput) || nodeInput.length === 0) fail('$.nodeIds', 'must be non-empty');
        const ids = new Set(nodeInput.map((value, index) => identifier(value, `$.nodeIds[${index}]`)));
        for (const nodeId of ids) if (!this.#nodes.has(nodeId)) fail('$.nodeIds', `contains unknown node '${nodeId}'`);
        const delta = finite(damageDelta, '$.damageDelta', 0, 1);
        const changed = [];
        for (const bond of sortedValues(this.#bonds)) {
            if (!ids.has(bond.nodeAId) && !ids.has(bond.nodeBId)) continue;
            const damage = Math.min(1, bond.damage + delta);
            const lifecycle = damage > 0 ? 'damage' : bond.lifecycle;
            changed.push(this.updateBondState(bond.id, {
                damage,
                lifecycle,
                revision: bond.revision + 1,
            }));
        }
        if (changed.length > 0) this.#revision++;
        this.#log('structural-bonds-weakened', { bondCount: changed.length, damageDelta: delta });
        return cloneAndFreezeStrictJson(changed);
    }

    snapshot() {
        this.#assertAlive();
        const started = nowMs();
        const snapshot = createStructuralTopologySnapshot({
            topologyId: this.#topologyId,
            revision: this.#revision,
            deviceGeneration: this.#deviceGeneration,
            stepIndex: this.#stepIndex,
            nodes: sortedValues(this.#nodes),
            bonds: sortedValues(this.#bonds),
            crackResiduals: sortedValues(this.#cracks),
            aggregates: sortedValues(this.#aggregates),
        });
        this.#log('structural-snapshot-created', {
            revision: this.#revision,
            durationMs: nowMs() - started,
        });
        return snapshot;
    }

    restore(snapshotInput) {
        this.#assertAlive();
        const started = nowMs();
        try {
            const snapshot = createStructuralTopologySnapshot(snapshotInput);
            if (snapshot.topologyId !== this.#topologyId) fail('$.structuralTopology.topologyId', 'does not match this topology');
            if (snapshot.nodes.length > this.#maximumNodes || snapshot.bonds.length > this.#maximumBonds) {
                throw new RangeError('Structural snapshot exceeds configured capacity');
            }
            const nodes = new Map(snapshot.nodes.map(entry => [entry.id, mutable(entry)]));
            const bonds = new Map(snapshot.bonds.map(entry => [entry.id, mutable(entry)]));
            const cracks = new Map(snapshot.crackResiduals.map(entry => [entry.id, mutable(entry)]));
            const aggregates = new Map(snapshot.aggregates.map(entry => [entry.id, mutable(entry)]));
            this.#nodes = nodes;
            this.#bonds = bonds;
            this.#cracks = cracks;
            this.#aggregates = aggregates;
            this.#revision = snapshot.revision;
            this.#deviceGeneration = snapshot.deviceGeneration;
            this.#stepIndex = snapshot.stepIndex;
            this.#log('structural-snapshot-restored', {
                revision: this.#revision,
                durationMs: nowMs() - started,
            });
            return this;
        } catch (error) {
            this.#log('structural-restore-error', { message: error.message, durationMs: nowMs() - started });
            throw error;
        }
    }

    replay(actionsInput) {
        this.#assertAlive();
        const actions = cloneStrictJson(actionsInput, '$.actions');
        if (!Array.isArray(actions) || actions.length > 1_000_000) fail('$.actions', 'must be a bounded array');
        const receipts = [];
        for (const [index, action] of actions.entries()) {
            exactObject(action, new Set(['type', 'payload']), `$.actions[${index}]`);
            switch (action.type) {
                case 'add-node': receipts.push(this.addNode(action.payload)); break;
                case 'add-bond': receipts.push(this.addBond(action.payload)); break;
                case 'fracture-bond': receipts.push(this.fractureBond(action.payload.bondId, action.payload.options)); break;
                default: fail(`$.actions[${index}].type`, 'is unsupported');
            }
        }
        this.#log('structural-replay-complete', { actionCount: actions.length });
        return cloneAndFreezeStrictJson(receipts);
    }

    recreateDevice(nextGenerationInput) {
        this.#assertAlive();
        const nextGeneration = integer(nextGenerationInput, '$.nextGeneration');
        if (nextGeneration <= this.#deviceGeneration) fail('$.nextGeneration', 'must advance');
        this.#log('structural-device-recreation-start', { nextGeneration });
        this.#deviceGeneration = nextGeneration;
        this.#aggregates.clear();
        this.#log('structural-device-recreated', {
            nextGeneration,
            preservedCracks: this.#cracks.size,
            preservedBonds: this.#bonds.size,
        });
        return nextGeneration;
    }

    destroy() {
        if (this.#destroyed) return false;
        this.#log('structural-topology-destroy-start', { topologyId: this.#topologyId });
        this.#nodes.clear();
        this.#bonds.clear();
        this.#cracks.clear();
        this.#aggregates.clear();
        this.#hooks.clear();
        this.#destroyed = true;
        this.#log('structural-topology-destroyed', { topologyId: this.#topologyId });
        return true;
    }
}

export function createDefaultStructuralBond(input) {
    const candidate = cloneStrictJson(input, '$.defaultStructuralBond');
    exactObject(candidate, new Set([
        'id', 'nodeAId', 'nodeBId', 'profileId', 'restLengthM', 'restDirection',
        'timeBinExponent',
    ]), '$.defaultStructuralBond');
    for (const key of ['id', 'nodeAId', 'nodeBId', 'profileId', 'restLengthM', 'restDirection']) {
        if (!Object.hasOwn(candidate, key)) fail(`$.defaultStructuralBond.${key}`, 'is required');
    }
    return createStructuralBond({
        schema: STRUCTURAL_BOND_SCHEMA,
        schemaVersion: STRUCTURAL_SCHEMA_VERSION,
        id: candidate.id,
        nodeAId: candidate.nodeAId,
        nodeBId: candidate.nodeBId,
        profileId: candidate.profileId,
        restLengthM: candidate.restLengthM,
        plasticRestLengthM: candidate.restLengthM,
        restDirection: candidate.restDirection,
        bendRestRadians: 0,
        lambda: { tension: 0, compression: 0, shear: 0, bend: 0 },
        lifecycle: 'elastic',
        fatigue: 0,
        damage: 0,
        revision: 0,
        timeBinExponent: candidate.timeBinExponent ?? 0,
    });
}
