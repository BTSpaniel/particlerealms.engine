// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
    FABRIK_ROPE_SNAPSHOT_SCHEMA,
    FABRIK_ROPE_SNAPSHOT_VERSION,
    FABRIK_ROPE_SOLVER_VERSION,
    assertLiveFabrikRopeDefinition,
    freezeRopeValue,
    normalizeFabrikRopeAnchors,
    normalizeFabrikRopePositions,
    normalizeRopeHash,
    normalizeRopeInteger,
    normalizeRopeNumber,
    readRopeArray,
    readRopeRecord,
} from './RopeContracts.js';
import { EMPTY_ROPE_COLLIDER_SET } from './RopeCollisionContracts.js';
import { FabrikRopeSolver } from './FabrikRopeSolver.js';

export const FABRIK_ROPE_VIEW_SCHEMA = 'engine.rope.runtime-view';
export const FABRIK_ROPE_VIEW_VERSION = '1.0.0';
export const FABRIK_ROPE_RUNTIME_TELEMETRY_SCHEMA = 'engine.rope.runtime-telemetry';
export const FABRIK_ROPE_RUNTIME_TELEMETRY_VERSION = '1.0.0';

const RUNTIME_OPTION_KEYS = new Set([
    'colliderSet', 'positions', 'previousPositions', 'velocities', 'anchors',
    'freeLengthMeters', 'snapshot',
]);
const SNAPSHOT_KEYS = new Set([
    'schema', 'schemaVersion', 'solverVersion', 'ropeId', 'materialHash', 'tick',
    'positions', 'previousPositions', 'velocities', 'activeAttachments',
    'freeLengthMeters', 'brokenSegmentIds', 'breakCounters',
    'topologyOperations', 'breakReceipts', 'lastTensionNewtons',
]);

function errorDiagnostic(error, tick) {
    const code = typeof error?.code === 'string' && error.code ? error.code : 'ROPE_RUNTIME_STEP';
    const message = typeof error?.message === 'string' && error.message
        ? error.message
        : 'Unknown rope runtime failure';
    const rawDetails = error?.details;
    const details = rawDetails == null || ['string', 'number', 'boolean'].includes(typeof rawDetails)
        ? rawDetails ?? null
        : null;
    return freezeRopeValue({
        code,
        message,
        tick,
        details,
    });
}

function snapshotFromState(state) {
    return freezeRopeValue({
        schema: FABRIK_ROPE_SNAPSHOT_SCHEMA,
        schemaVersion: FABRIK_ROPE_SNAPSHOT_VERSION,
        solverVersion: FABRIK_ROPE_SOLVER_VERSION,
        ropeId: state.ropeId,
        materialHash: state.materialHash,
        tick: state.tick,
        positions: state.positions.map(position => [...position]),
        previousPositions: state.previousPositions.map(position => [...position]),
        velocities: state.velocities.map(velocity => [...velocity]),
        activeAttachments: state.anchors.map(anchor => ({
            id: anchor.id,
            position: [...anchor.position],
        })),
        freeLengthMeters: state.freeLengthMeters,
        brokenSegmentIds: [...state.brokenSegmentIds],
        breakCounters: [...state.breakCounters],
        topologyOperations: state.topologyOperations,
        breakReceipts: state.breakReceipts.map(receipt => ({ ...receipt })),
        lastTensionNewtons: state.telemetry.maxTensionNewtons,
    });
}

function stateFromSnapshot(solver, definition, rawSnapshot) {
    const source = readRopeRecord(rawSnapshot, 'rope snapshot', SNAPSHOT_KEYS);
    if (source.schema !== FABRIK_ROPE_SNAPSHOT_SCHEMA
        || source.schemaVersion !== FABRIK_ROPE_SNAPSHOT_VERSION) {
        throw new TypeError(
            `Rope snapshot must use ${FABRIK_ROPE_SNAPSHOT_SCHEMA} ${FABRIK_ROPE_SNAPSHOT_VERSION}`,
        );
    }
    if (source.solverVersion !== FABRIK_ROPE_SOLVER_VERSION) {
        throw new TypeError(`Rope snapshot solverVersion must be '${FABRIK_ROPE_SOLVER_VERSION}'`);
    }
    if (source.ropeId !== definition.id) throw new TypeError(`Rope snapshot belongs to '${String(source.ropeId)}'`);
    const materialHash = normalizeRopeHash(source.materialHash, 'rope snapshot materialHash');
    if (materialHash !== definition.material.hash) {
        throw new TypeError(`Rope snapshot material hash is stale for '${definition.id}'`);
    }
    const tick = normalizeRopeInteger(source.tick, 'rope snapshot tick');
    const positions = normalizeFabrikRopePositions(
        source.positions,
        definition.segmentCount + 1,
        'rope snapshot positions',
    );
    const previousPositions = normalizeFabrikRopePositions(
        source.previousPositions,
        definition.segmentCount + 1,
        'rope snapshot previousPositions',
    );
    const velocities = normalizeFabrikRopePositions(
        source.velocities,
        definition.segmentCount + 1,
        'rope snapshot velocities',
    );
    const activeAttachments = normalizeFabrikRopeAnchors(
        source.activeAttachments,
        definition,
        'rope snapshot activeAttachments',
    );
    const freeLengthMeters = normalizeRopeNumber(
        source.freeLengthMeters,
        'rope snapshot freeLengthMeters',
        { minimum: 0, maximum: definition.restLengthMeters, exclusiveMinimum: true },
    );
    const brokenSegmentIds = readRopeArray(source.brokenSegmentIds, 'rope snapshot brokenSegmentIds', {
        maximumLength: definition.segmentCount,
    });
    const breakCounters = readRopeArray(source.breakCounters, 'rope snapshot breakCounters', {
        minimumLength: definition.segmentCount,
        maximumLength: definition.segmentCount,
    });
    const topologyOperations = normalizeRopeInteger(
        source.topologyOperations,
        'rope snapshot topologyOperations',
        { minimum: 0, maximum: definition.maximumTopologyOperations },
    );
    const breakReceipts = readRopeArray(source.breakReceipts, 'rope snapshot breakReceipts', {
        minimumLength: topologyOperations,
        maximumLength: topologyOperations,
    });
    const lastTensionNewtons = normalizeRopeNumber(
        source.lastTensionNewtons,
        'rope snapshot lastTensionNewtons',
        { minimum: 0 },
    );
    return solver.createStateFromSnapshot({
        positions,
        previousPositions,
        velocities,
        anchors: activeAttachments.map(anchor => ({ id: anchor.id, position: anchor.position })),
        freeLengthMeters,
        tick,
        brokenSegmentIds,
        breakCounters,
        topologyOperations,
        breakReceipts,
        lastTensionNewtons,
    });
}

export class FabrikRopeRuntime {
    constructor(definitionInput, options = {}) {
        const source = readRopeRecord(options, 'rope runtime options', RUNTIME_OPTION_KEYS);
        this.definition = assertLiveFabrikRopeDefinition(definitionInput);
        this._solver = new FabrikRopeSolver(this.definition, {
            colliderSet: source.colliderSet ?? EMPTY_ROPE_COLLIDER_SET,
        });
        this._disposed = false;
        this._fault = null;
        this._faultCount = 0;
        try {
            if (source.snapshot != null) {
                const conflicting = ['positions', 'previousPositions', 'velocities', 'anchors', 'freeLengthMeters']
                    .filter(key => source[key] != null);
                if (conflicting.length > 0) {
                    throw new TypeError(`Rope runtime snapshot cannot be combined with ${conflicting.join(', ')}`);
                }
                this._state = stateFromSnapshot(this._solver, this.definition, source.snapshot);
            } else {
                this._state = this._solver.createState({
                    positions: source.positions,
                    ...(source.previousPositions == null ? {} : { previousPositions: source.previousPositions }),
                    ...(source.velocities == null ? {} : { velocities: source.velocities }),
                    anchors: source.anchors,
                    ...(source.freeLengthMeters == null ? {} : { freeLengthMeters: source.freeLengthMeters }),
                });
            }
            this._lastGood = snapshotFromState(this._state);
        } catch (error) {
            this._solver.dispose();
            this._disposed = true;
            throw error;
        }
    }

    get disposed() { return this._disposed; }
    get currentState() { this._assertLive(); return this._state; }
    get lastGoodSnapshot() { this._assertLive(); return this._lastGood; }
    get faulted() { return this._fault != null; }

    _assertLive() {
        if (this._disposed) throw new Error(`Rope runtime '${this.definition.id}' is disposed`);
    }

    step(input = {}) {
        this._assertLive();
        const priorState = this._state;
        const priorLastGood = this._lastGood;
        try {
            const candidate = this._solver.step(priorState, input);
            const candidateSnapshot = snapshotFromState(candidate);
            this._state = candidate;
            this._lastGood = candidateSnapshot;
            this._fault = null;
            return Object.freeze({
                ok: true,
                committed: true,
                tick: candidate.tick,
                state: candidate,
                telemetry: candidate.telemetry,
                breakReceipts: candidate.telemetry.breakReceipts,
                lastGood: candidateSnapshot,
            });
        } catch (error) {
            this._state = priorState;
            this._lastGood = priorLastGood;
            this._faultCount += 1;
            this._fault = errorDiagnostic(error, priorState.tick + 1);
            return Object.freeze({
                ok: false,
                committed: false,
                tick: priorState.tick + 1,
                diagnostic: this._fault,
                lastGood: priorLastGood,
            });
        }
    }

    snapshot() {
        this._assertLive();
        return this._lastGood;
    }

    restore(snapshot) {
        this._assertLive();
        const priorState = this._state;
        const priorLastGood = this._lastGood;
        try {
            const candidate = stateFromSnapshot(this._solver, this.definition, snapshot);
            const candidateSnapshot = snapshotFromState(candidate);
            this._state = candidate;
            this._lastGood = candidateSnapshot;
            this._fault = null;
            return Object.freeze({
                ok: true,
                restored: true,
                tick: candidate.tick,
                state: candidate,
                snapshot: candidateSnapshot,
            });
        } catch (error) {
            this._state = priorState;
            this._lastGood = priorLastGood;
            this._faultCount += 1;
            this._fault = errorDiagnostic(error, priorState.tick);
            return Object.freeze({
                ok: false,
                restored: false,
                tick: priorState.tick,
                diagnostic: this._fault,
                lastGood: priorLastGood,
            });
        }
    }

    /** Immutable renderer/query input; the runtime remains the only authority. */
    view() {
        this._assertLive();
        return Object.freeze({
            schema: FABRIK_ROPE_VIEW_SCHEMA,
            schemaVersion: FABRIK_ROPE_VIEW_VERSION,
            ropeId: this.definition.id,
            tick: this._state.tick,
            segmentIds: this.definition.segmentIds,
            pointIds: this.definition.pointIds,
            positions: this._state.positions,
            previousPositions: this._state.previousPositions,
            radiusMeters: this.definition.radiusMeters,
            brokenSegmentIds: this._state.brokenSegmentIds,
            materialId: this.definition.material.id,
            materialHash: this.definition.material.hash,
            rendererId: this.definition.rendererId,
        });
    }

    telemetry() {
        this._assertLive();
        return Object.freeze({
            schema: FABRIK_ROPE_RUNTIME_TELEMETRY_SCHEMA,
            schemaVersion: FABRIK_ROPE_RUNTIME_TELEMETRY_VERSION,
            ropeId: this.definition.id,
            tick: this._state.tick,
            faultCount: this._faultCount,
            fault: this._fault,
            solver: this._state.telemetry,
        });
    }

    dispose() {
        if (this._disposed) return false;
        this._solver.dispose();
        this._state = null;
        this._lastGood = null;
        this._fault = null;
        this._disposed = true;
        return true;
    }
}

export function createFabrikRopeRuntime(definition, options) {
    return new FabrikRopeRuntime(definition, options);
}

export function validateFabrikRopeSnapshot(definitionInput, snapshot, { colliderSet = EMPTY_ROPE_COLLIDER_SET } = {}) {
    const definition = assertLiveFabrikRopeDefinition(definitionInput);
    const solver = new FabrikRopeSolver(definition, { colliderSet });
    try {
        const state = stateFromSnapshot(solver, definition, snapshot);
        return Object.freeze({ ok: true, errors: Object.freeze([]), snapshot: snapshotFromState(state) });
    } catch (error) {
        return Object.freeze({ ok: false, errors: Object.freeze([errorDiagnostic(error, 0)]) });
    } finally {
        solver.dispose();
    }
}
