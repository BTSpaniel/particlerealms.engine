// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Transactional bridge from derived structural aggregates to an injected
 * rigid-body backend. The proxy is a COM-anchored box around the node AABB;
 * it is deliberately not advertised as a convex reconstruction.
 */

import {
    cloneAndFreezeStrictJson,
    cloneStrictJson,
} from '../../core/schema/StrictJsonValue.js';
import {
    createStructuralNode,
    createStructuralRefinementRequest,
    validateRigidAggregate,
} from './StructuralContracts.js';
import { StructuralTopology } from './StructuralTopology.js';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;
const BACKEND_KEYS = new Set(['world', 'createBody', 'getBody', 'removeBody']);
const OPTION_KEYS = new Set([
    'topology', 'backend', 'minimumNodes', 'minimumHalfExtentM', 'logger',
]);

function fail(path, message) {
    throw new TypeError(`${path}: ${message}`);
}

function nowMs() {
    return globalThis.performance?.now?.() ?? Date.now();
}

function log(logger, type, details = {}) {
    try { logger?.(Object.freeze({ type, ...details })); } catch (_) { /* diagnostics have no authority */ }
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

function ownData(object, key, path, required = true) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor) {
        if (required) fail(`${path}.${key}`, 'is required');
        return undefined;
    }
    if (!descriptor.enumerable) fail(`${path}.${key}`, 'must be enumerable');
    if (!Object.hasOwn(descriptor, 'value')) fail(`${path}.${key}`, 'accessors are not supported');
    return descriptor.value;
}

function exactDataObject(input, allowed, path) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) fail(path, 'must be an object');
    const output = {};
    for (const key of Reflect.ownKeys(input)) {
        if (typeof key !== 'string') fail(path, 'symbol keys are not supported');
        if (!allowed.has(key)) fail(`${path}.${key}`, 'unknown field');
        output[key] = ownData(input, key, path);
    }
    return output;
}

function validateBackend(input, path = '$.backend') {
    const backend = exactDataObject(input, BACKEND_KEYS, path);
    for (const key of BACKEND_KEYS) {
        if (!Object.hasOwn(backend, key)) fail(`${path}.${key}`, 'is required');
    }
    if (backend.world === null || (typeof backend.world !== 'object' && typeof backend.world !== 'function')) {
        fail(`${path}.world`, 'must be a non-null backend world');
    }
    for (const key of ['createBody', 'getBody', 'removeBody']) {
        if (typeof backend[key] !== 'function') fail(`${path}.${key}`, 'must be a function');
    }
    return Object.freeze(backend);
}

function vector(value, path, length = 3) {
    if (!Array.isArray(value) && !ArrayBuffer.isView(value)) fail(path, `must be a ${length}-vector`);
    if (value.length !== length) fail(path, `must be a ${length}-vector`);
    return Array.from(value, (entry, index) => finite(entry, `${path}[${index}]`));
}

function quaternion(value, path) {
    const candidate = vector(value, path, 4);
    const magnitude = Math.hypot(...candidate);
    if (magnitude <= Number.EPSILON) fail(path, 'must have non-zero magnitude');
    return candidate.map(entry => entry / magnitude);
}

function rotateVector(q, value) {
    const [qx, qy, qz, qw] = q;
    const [vx, vy, vz] = value;
    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);
    return [
        vx + qw * tx + qy * tz - qz * ty,
        vy + qw * ty + qz * tx - qx * tz,
        vz + qw * tz + qx * ty - qy * tx,
    ];
}

function cross(left, right) {
    return [
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    ];
}

function sameArray(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameIdentity(binding, aggregate, deviceGeneration) {
    return binding.topologyRevision === aggregate.revision
        && binding.deviceGeneration === deviceGeneration
        && sameArray(binding.nodeIds, aggregate.nodeIds)
        && sameArray(binding.sourceBondIds, aggregate.sourceBondIds)
        && sameArray(binding.crackResidualIds, aggregate.crackResidualIds);
}

function sortedUniqueIdentifiers(valuesInput, path, { allowEmpty = true } = {}) {
    const values = cloneStrictJson(valuesInput, path);
    if (!Array.isArray(values) || (!allowEmpty && values.length === 0)) {
        fail(path, allowEmpty ? 'must be an array' : 'must be a non-empty array');
    }
    const seen = new Set();
    const result = values.map((entry, index) => {
        const id = identifier(entry, `${path}[${index}]`);
        if (seen.has(id)) fail(`${path}[${index}]`, 'duplicates an earlier identifier');
        seen.add(id);
        return id;
    });
    return result.sort((left, right) => left.localeCompare(right));
}

function bodyMotion(backend, binding) {
    const body = backend.getBody(backend.world, binding.bodyHandle);
    if (body === null || typeof body !== 'object') {
        throw new Error(`Rigid aggregate body ${binding.bodyHandle} is unavailable`);
    }
    const linearValue = Object.hasOwn(body, 'linearVelocity')
        ? ownData(body, 'linearVelocity', '$.body')
        : ownData(body, 'velocity', '$.body');
    return Object.freeze({
        positionM: vector(ownData(body, 'position', '$.body'), '$.body.position'),
        rotation: quaternion(ownData(body, 'rotation', '$.body'), '$.body.rotation'),
        linearVelocityMPerS: vector(linearValue, '$.body.linearVelocity'),
        angularVelocityRadPerS: vector(
            ownData(body, 'angularVelocity', '$.body'), '$.body.angularVelocity',
        ),
    });
}

function publicBinding(binding) {
    return {
        aggregateId: binding.aggregateId,
        bodyHandle: binding.bodyHandle,
        topologyId: binding.topologyId,
        topologyRevision: binding.topologyRevision,
        deviceGeneration: binding.deviceGeneration,
        nodeIds: [...binding.nodeIds],
        sourceBondIds: [...binding.sourceBondIds],
        crackResidualIds: [...binding.crackResidualIds],
        massKg: binding.massKg,
        proxy: {
            shape: 'box',
            accuracy: 'node-aabb-proxy',
            halfExtentsM: [...binding.proxyHalfExtentsM],
            localOffsetM: [...binding.proxyLocalOffsetM],
            minimumHalfExtentM: binding.minimumHalfExtentM,
        },
    };
}

/**
 * Owns the broad rigid representation while the fine topology remains the
 * canonical identity and conservation ledger.
 */
export class RigidAggregateBackendHandoff {
    #topology;
    #backend;
    #minimumNodes;
    #minimumHalfExtentM;
    #logger;
    #bindings = new Map();
    #destroyed = false;
    #deviceGeneration;
    #lastRecreationReceipt = null;

    constructor(optionsInput) {
        const options = exactDataObject(optionsInput, OPTION_KEYS, '$.options');
        if (!(options.topology instanceof StructuralTopology)) {
            fail('$.options.topology', 'must be a StructuralTopology');
        }
        this.#topology = options.topology;
        this.#backend = validateBackend(options.backend);
        this.#minimumNodes = integer(options.minimumNodes ?? 2, '$.options.minimumNodes', 1, 10_000_000);
        this.#minimumHalfExtentM = finite(
            options.minimumHalfExtentM ?? 0.005,
            '$.options.minimumHalfExtentM',
            Number.MIN_VALUE,
            1_000_000,
        );
        if (options.logger != null && typeof options.logger !== 'function') {
            fail('$.options.logger', 'must be a function or null');
        }
        this.#logger = options.logger ?? null;
        this.#deviceGeneration = this.#topology.deviceGeneration;
        log(this.#logger, 'rigid-aggregate-handoff-initialize', {
            topologyId: this.#topology.topologyId,
            deviceGeneration: this.#deviceGeneration,
            minimumNodes: this.#minimumNodes,
            minimumHalfExtentM: this.#minimumHalfExtentM,
        });
    }

    #assertAlive() {
        if (this.#destroyed) throw new Error('RigidAggregateBackendHandoff is destroyed');
    }

    #geometry(aggregate) {
        validateRigidAggregate(aggregate);
        const nodes = aggregate.nodeIds.map(nodeId => {
            const node = this.#topology.node(nodeId);
            if (!node) throw new RangeError(`Rigid aggregate references unknown node '${nodeId}'`);
            return node;
        });
        const minimum = [...nodes[0].positionM];
        const maximum = [...nodes[0].positionM];
        for (const node of nodes.slice(1)) {
            for (let axis = 0; axis < 3; axis++) {
                minimum[axis] = Math.min(minimum[axis], node.positionM[axis]);
                maximum[axis] = Math.max(maximum[axis], node.positionM[axis]);
            }
        }
        const aabbCenterM = minimum.map((value, axis) => (value + maximum[axis]) / 2);
        const proxyHalfExtentsM = minimum.map((value, axis) => Math.max(
            (maximum[axis] - value) / 2,
            this.#minimumHalfExtentM,
        ));
        const proxyLocalOffsetM = aabbCenterM.map((value, axis) => value - aggregate.centerOfMassM[axis]);
        const localOffsets = new Map(nodes.map(node => [
            node.id,
            node.positionM.map((value, axis) => value - aggregate.centerOfMassM[axis]),
        ]));
        const dynamic = nodes.some(node => node.inverseMassPerKg > 0);
        return { nodes, proxyHalfExtentsM, proxyLocalOffsetM, localOffsets, dynamic };
    }

    #stageBinding(aggregate, occupiedHandles) {
        const geometry = this.#geometry(aggregate);
        const identityLedger = {
            aggregateId: aggregate.id,
            topologyId: aggregate.topologyId,
            topologyRevision: aggregate.revision,
            deviceGeneration: this.#deviceGeneration,
            nodeIds: [...aggregate.nodeIds],
            sourceBondIds: [...aggregate.sourceBondIds],
            crackResidualIds: [...aggregate.crackResidualIds],
        };
        const descriptor = {
            entityId: `matter-rigid:${aggregate.topologyId}:${aggregate.id}`,
            simMode: geometry.dynamic ? 'dynamic' : 'static',
            position: [...aggregate.centerOfMassM],
            rotation: [0, 0, 0, 1],
            linearVelocity: [...aggregate.linearVelocityMPerS],
            angularVelocity: [...aggregate.angularVelocityRadPerS],
            mass: aggregate.massKg,
            collider: {
                shape: 'box',
                halfExtents: [...geometry.proxyHalfExtentsM],
                localOffset: [...geometry.proxyLocalOffsetM],
            },
            userData: cloneAndFreezeStrictJson({
                representation: 'node-aabb-proxy',
                identityLedger,
            }),
        };
        let body = null;
        try {
            body = this.#backend.createBody(this.#backend.world, descriptor);
            if (body === null || typeof body !== 'object') fail('$.createdBody', 'must be an object');
            const bodyHandle = integer(ownData(body, 'handle', '$.createdBody'), '$.createdBody.handle');
            if (occupiedHandles.has(bodyHandle)) fail('$.createdBody.handle', 'duplicates an active body handle');
            if (this.#backend.getBody(this.#backend.world, bodyHandle) !== body) {
                fail('$.createdBody', 'is not retrievable by its handle');
            }
            occupiedHandles.add(bodyHandle);
            return {
                aggregateId: aggregate.id,
                bodyHandle,
                topologyId: aggregate.topologyId,
                topologyRevision: aggregate.revision,
                deviceGeneration: this.#deviceGeneration,
                nodeIds: [...aggregate.nodeIds],
                sourceBondIds: [...aggregate.sourceBondIds],
                crackResidualIds: [...aggregate.crackResidualIds],
                massKg: aggregate.massKg,
                proxyHalfExtentsM: [...geometry.proxyHalfExtentsM],
                proxyLocalOffsetM: [...geometry.proxyLocalOffsetM],
                minimumHalfExtentM: this.#minimumHalfExtentM,
                localOffsets: geometry.localOffsets,
                aggregate,
            };
        } catch (error) {
            const descriptor = body && Object.getOwnPropertyDescriptor(body, 'handle');
            if (descriptor && Object.hasOwn(descriptor, 'value') && Number.isSafeInteger(descriptor.value)) {
                try { this.#backend.removeBody(this.#backend.world, descriptor.value); } catch (_) { /* outer rollback logs */ }
            }
            throw error;
        }
    }

    #removeBinding(aggregateId, { strict = true } = {}) {
        const binding = this.#bindings.get(aggregateId);
        if (!binding) return false;
        try {
            const before = this.#backend.getBody(this.#backend.world, binding.bodyHandle);
            if (before !== null) {
                const reported = this.#backend.removeBody(this.#backend.world, binding.bodyHandle);
                const after = this.#backend.getBody(this.#backend.world, binding.bodyHandle);
                if (after !== null || (reported === false && before === after)) {
                    throw new Error(`Rigid aggregate body ${binding.bodyHandle} was not removed`);
                }
            }
            this.#bindings.delete(aggregateId);
            log(this.#logger, 'rigid-aggregate-body-released', {
                aggregateId,
                bodyHandle: binding.bodyHandle,
                topologyRevision: binding.topologyRevision,
            });
            return true;
        } catch (error) {
            log(this.#logger, 'rigid-aggregate-body-release-error', {
                aggregateId,
                bodyHandle: binding.bodyHandle,
                message: error.message,
            });
            if (strict) throw error;
            this.#bindings.delete(aggregateId);
            return false;
        }
    }

    #rollbackStaged(staged) {
        const failures = [];
        for (const binding of [...staged].reverse()) {
            try {
                const present = this.#backend.getBody(this.#backend.world, binding.bodyHandle);
                if (present !== null) this.#backend.removeBody(this.#backend.world, binding.bodyHandle);
                if (this.#backend.getBody(this.#backend.world, binding.bodyHandle) !== null) {
                    failures.push(binding.bodyHandle);
                }
            } catch (_) {
                failures.push(binding.bodyHandle);
            }
        }
        log(this.#logger, 'rigid-aggregate-handoff-rollback', {
            stagedCount: staged.length,
            unreleasedBodyHandles: failures,
        });
        return failures;
    }

    get topology() { return this.#topology; }
    get deviceGeneration() { return this.#deviceGeneration; }
    get bindingCount() { return this.#bindings.size; }

    binding(aggregateIdInput) {
        this.#assertAlive();
        const aggregateId = identifier(aggregateIdInput, '$.aggregateId');
        const binding = this.#bindings.get(aggregateId);
        return binding ? cloneAndFreezeStrictJson(publicBinding(binding)) : null;
    }

    bindings() {
        this.#assertAlive();
        return cloneAndFreezeStrictJson([...this.#bindings.values()]
            .sort((left, right) => left.aggregateId.localeCompare(right.aggregateId))
            .map(publicBinding));
    }

    pullMotion(aggregateIdsInput = null) {
        this.#assertAlive();
        const started = nowMs();
        const aggregateIds = aggregateIdsInput === null
            ? [...this.#bindings.keys()].sort((left, right) => left.localeCompare(right))
            : sortedUniqueIdentifiers(aggregateIdsInput, '$.aggregateIds');
        log(this.#logger, 'rigid-aggregate-motion-pull-enter', { aggregateCount: aggregateIds.length });
        try {
            const staged = [];
            for (const aggregateId of aggregateIds) {
                const binding = this.#bindings.get(aggregateId);
                if (!binding) throw new RangeError(`Unknown active rigid aggregate '${aggregateId}'`);
                let motion;
                try {
                    motion = bodyMotion(this.#backend, binding);
                } catch (error) {
                    const body = this.#backend.getBody(this.#backend.world, binding.bodyHandle);
                    if (body === null) this.#bindings.delete(aggregateId);
                    throw error;
                }
                for (const nodeId of binding.nodeIds) {
                    const node = this.#topology.node(nodeId);
                    if (!node) throw new RangeError(`Rigid aggregate references unknown node '${nodeId}'`);
                    const rotatedOffset = rotateVector(motion.rotation, binding.localOffsets.get(nodeId));
                    const angularVelocity = cross(motion.angularVelocityRadPerS, rotatedOffset);
                    const candidate = createStructuralNode({
                        ...node,
                        previousPositionM: [...node.positionM],
                        positionM: motion.positionM.map((value, axis) => value + rotatedOffset[axis]),
                        velocityMPerS: motion.linearVelocityMPerS
                            .map((value, axis) => value + angularVelocity[axis]),
                    });
                    staged.push({ aggregateId, nodeId, candidate });
                }
            }
            for (const entry of staged) {
                this.#topology.setNodeKinematics(entry.nodeId, {
                    positionM: entry.candidate.positionM,
                    previousPositionM: entry.candidate.previousPositionM,
                    velocityMPerS: entry.candidate.velocityMPerS,
                });
            }
            const receipt = cloneAndFreezeStrictJson({
                topologyId: this.#topology.topologyId,
                topologyRevision: this.#topology.revision,
                deviceGeneration: this.#deviceGeneration,
                aggregateIds,
                nodeIds: [...new Set(staged.map(entry => entry.nodeId))]
                    .sort((left, right) => left.localeCompare(right)),
            });
            log(this.#logger, 'rigid-aggregate-motion-pull-exit', {
                aggregateCount: aggregateIds.length,
                nodeCount: receipt.nodeIds.length,
            });
            log(this.#logger, 'rigid-aggregate-motion-pull-performance', {
                durationMs: nowMs() - started,
                nodeCount: receipt.nodeIds.length,
            });
            return receipt;
        } catch (error) {
            log(this.#logger, 'rigid-aggregate-motion-pull-error', {
                message: error.message,
                durationMs: nowMs() - started,
            });
            throw error;
        }
    }

    synchronize() {
        this.#assertAlive();
        const started = nowMs();
        log(this.#logger, 'rigid-aggregate-handoff-sync-enter', {
            topologyRevision: this.#topology.revision,
            activeBindings: this.#bindings.size,
        });
        const staged = [];
        try {
            if (this.#topology.deviceGeneration !== this.#deviceGeneration) {
                throw new Error('Topology and rigid aggregate device generations differ');
            }
            if (this.#bindings.size > 0) this.pullMotion();
            const aggregates = this.#topology.buildRigidAggregates({ minimumNodes: this.#minimumNodes });
            const desired = new Map(aggregates.map(aggregate => [aggregate.id, aggregate]));
            const reusable = new Map();
            for (const [aggregateId, binding] of this.#bindings) {
                const aggregate = desired.get(aggregateId);
                if (aggregate && sameIdentity(binding, aggregate, this.#deviceGeneration)) {
                    reusable.set(aggregateId, binding);
                }
            }
            const occupiedHandles = new Set([...this.#bindings.values()].map(binding => binding.bodyHandle));
            for (const aggregate of aggregates) {
                if (reusable.has(aggregate.id)) continue;
                staged.push(this.#stageBinding(aggregate, occupiedHandles));
            }
            const obsoleteIds = [...this.#bindings.keys()]
                .filter(aggregateId => !reusable.has(aggregateId))
                .sort((left, right) => left.localeCompare(right));
            for (const aggregateId of obsoleteIds) this.#removeBinding(aggregateId);
            for (const [aggregateId, binding] of reusable) {
                binding.aggregate = desired.get(aggregateId);
                binding.massKg = binding.aggregate.massKg;
            }
            for (const binding of staged) {
                this.#bindings.set(binding.aggregateId, binding);
                log(this.#logger, 'rigid-aggregate-body-created', {
                    aggregateId: binding.aggregateId,
                    bodyHandle: binding.bodyHandle,
                    nodeCount: binding.nodeIds.length,
                    proxyAccuracy: 'node-aabb-proxy',
                });
            }
            const receipt = cloneAndFreezeStrictJson({
                topologyId: this.#topology.topologyId,
                topologyRevision: this.#topology.revision,
                deviceGeneration: this.#deviceGeneration,
                createdAggregateIds: staged.map(binding => binding.aggregateId).sort(),
                reusedAggregateIds: [...reusable.keys()].sort(),
                removedAggregateIds: obsoleteIds,
                bindings: this.bindings(),
            });
            log(this.#logger, 'rigid-aggregate-handoff-sync-exit', {
                createdCount: receipt.createdAggregateIds.length,
                reusedCount: receipt.reusedAggregateIds.length,
                removedCount: receipt.removedAggregateIds.length,
                activeBindings: this.#bindings.size,
            });
            log(this.#logger, 'rigid-aggregate-handoff-sync-performance', {
                durationMs: nowMs() - started,
                aggregateCount: this.#bindings.size,
            });
            return receipt;
        } catch (error) {
            if (staged.length > 0) this.#rollbackStaged(staged);
            if (this.#bindings.size > 0
                && [...this.#bindings.values()].some(binding => (
                    binding.topologyRevision !== this.#topology.revision
                    || binding.deviceGeneration !== this.#deviceGeneration
                ))) {
                for (const aggregateId of [...this.#bindings.keys()]) {
                    const binding = this.#bindings.get(aggregateId);
                    if (binding.topologyRevision !== this.#topology.revision
                        || binding.deviceGeneration !== this.#deviceGeneration) {
                        this.#removeBinding(aggregateId, { strict: false });
                    }
                }
            }
            log(this.#logger, 'rigid-aggregate-handoff-sync-error', {
                message: error.message,
                durationMs: nowMs() - started,
            });
            throw error;
        }
    }

    releaseForRefinement(requestsInput) {
        this.#assertAlive();
        const started = nowMs();
        log(this.#logger, 'rigid-aggregate-refinement-release-enter');
        try {
            const raw = cloneStrictJson(requestsInput, '$.refinementRequests');
            if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100_000) {
                fail('$.refinementRequests', 'must be a non-empty bounded array');
            }
            const seen = new Set();
            const requests = raw.map((entry, index) => {
                const request = createStructuralRefinementRequest(entry, `$.refinementRequests[${index}]`);
                if (seen.has(request.id)) fail(`$.refinementRequests[${index}].id`, 'duplicates an earlier request');
                seen.add(request.id);
                if (request.topologyId !== this.#topology.topologyId) {
                    fail(`$.refinementRequests[${index}].topologyId`, 'does not match the topology');
                }
                if (request.revision !== this.#topology.revision) {
                    fail(`$.refinementRequests[${index}].revision`, 'is stale');
                }
                for (const nodeId of request.nodeIds) {
                    if (!this.#topology.node(nodeId)) {
                        fail(`$.refinementRequests[${index}].nodeIds`, `contains unknown node '${nodeId}'`);
                    }
                }
                return request;
            });
            const requestedNodeIds = new Set(requests.flatMap(request => request.nodeIds));
            const aggregateIds = [...this.#bindings.values()]
                .filter(binding => binding.nodeIds.some(nodeId => requestedNodeIds.has(nodeId)))
                .map(binding => binding.aggregateId)
                .sort((left, right) => left.localeCompare(right));
            if (aggregateIds.length > 0) this.pullMotion(aggregateIds);
            const released = [];
            const resumedNodeIds = new Set();
            for (const aggregateId of aggregateIds) {
                const binding = this.#bindings.get(aggregateId);
                if (!binding) continue;
                if (this.#removeBinding(aggregateId)) {
                    released.push(aggregateId);
                    binding.nodeIds.forEach(nodeId => resumedNodeIds.add(nodeId));
                }
            }
            const receipt = cloneAndFreezeStrictJson({
                topologyId: this.#topology.topologyId,
                topologyRevision: this.#topology.revision,
                deviceGeneration: this.#deviceGeneration,
                requestIds: requests.map(request => request.id).sort(),
                releasedAggregateIds: released,
                resumedNodeIds: [...resumedNodeIds].sort((left, right) => left.localeCompare(right)),
            });
            log(this.#logger, 'rigid-aggregate-refinement-release-exit', {
                requestCount: requests.length,
                releasedCount: released.length,
                resumedNodeCount: receipt.resumedNodeIds.length,
            });
            log(this.#logger, 'rigid-aggregate-refinement-release-performance', {
                durationMs: nowMs() - started,
                releasedCount: released.length,
            });
            return receipt;
        } catch (error) {
            log(this.#logger, 'rigid-aggregate-refinement-release-error', {
                message: error.message,
                durationMs: nowMs() - started,
            });
            throw error;
        }
    }

    evaluateAndReleaseRefinements(contextInput = {}) {
        this.#assertAlive();
        const requests = this.#topology.evaluatePredictiveRefinement(contextInput);
        const release = requests.length > 0 ? this.releaseForRefinement(requests) : cloneAndFreezeStrictJson({
            topologyId: this.#topology.topologyId,
            topologyRevision: this.#topology.revision,
            deviceGeneration: this.#deviceGeneration,
            requestIds: [],
            releasedAggregateIds: [],
            resumedNodeIds: [],
        });
        return cloneAndFreezeStrictJson({ requests, release });
    }

    recreateDevice(nextGenerationInput, backendInput = null) {
        this.#assertAlive();
        const started = nowMs();
        const nextGeneration = integer(nextGenerationInput, '$.nextGeneration');
        if (nextGeneration < this.#deviceGeneration) fail('$.nextGeneration', 'cannot regress');
        if (nextGeneration < this.#topology.deviceGeneration) {
            fail('$.nextGeneration', 'precedes the topology device generation');
        }
        if (nextGeneration === this.#deviceGeneration
            && nextGeneration === this.#topology.deviceGeneration
            && this.#bindings.size > 0) {
            if (backendInput !== null) validateBackend(backendInput, '$.replacementBackend');
            if (this.#lastRecreationReceipt) return this.#lastRecreationReceipt;
            return cloneAndFreezeStrictJson({
                previousGeneration: nextGeneration,
                deviceGeneration: nextGeneration,
                recreated: false,
                sync: null,
            });
        }
        const replacement = backendInput === null
            ? this.#backend
            : validateBackend(backendInput, '$.replacementBackend');
        const previousGeneration = this.#deviceGeneration;
        log(this.#logger, 'rigid-aggregate-device-recreation-enter', {
            previousGeneration,
            nextGeneration,
            activeBindings: this.#bindings.size,
        });
        try {
            for (const aggregateId of [...this.#bindings.keys()]) {
                this.#removeBinding(aggregateId, { strict: false });
            }
            this.#backend = replacement;
            if (this.#topology.deviceGeneration < nextGeneration) {
                this.#topology.recreateDevice(nextGeneration);
            }
            this.#deviceGeneration = nextGeneration;
            const sync = this.synchronize();
            this.#lastRecreationReceipt = cloneAndFreezeStrictJson({
                previousGeneration,
                deviceGeneration: nextGeneration,
                recreated: previousGeneration !== nextGeneration || backendInput !== null,
                sync,
            });
            log(this.#logger, 'rigid-aggregate-device-recreation-exit', {
                previousGeneration,
                nextGeneration,
                bodyCount: this.#bindings.size,
            });
            log(this.#logger, 'rigid-aggregate-device-recreation-performance', {
                durationMs: nowMs() - started,
                bodyCount: this.#bindings.size,
            });
            return this.#lastRecreationReceipt;
        } catch (error) {
            log(this.#logger, 'rigid-aggregate-device-recreation-error', {
                message: error.message,
                durationMs: nowMs() - started,
            });
            throw error;
        }
    }

    destroy() {
        if (this.#destroyed) return false;
        const started = nowMs();
        log(this.#logger, 'rigid-aggregate-handoff-destroy-enter', { activeBindings: this.#bindings.size });
        for (const aggregateId of [...this.#bindings.keys()]) {
            this.#removeBinding(aggregateId, { strict: false });
        }
        this.#destroyed = true;
        log(this.#logger, 'rigid-aggregate-handoff-destroy-exit', { durationMs: nowMs() - started });
        log(this.#logger, 'rigid-aggregate-handoff-destroy-performance', { durationMs: nowMs() - started });
        return true;
    }
}

export function createRigidAggregateBackendHandoff(options) {
    return new RigidAggregateBackendHandoff(options);
}
