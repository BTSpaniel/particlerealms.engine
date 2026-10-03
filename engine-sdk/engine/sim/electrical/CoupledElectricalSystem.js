// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
    ElectricalRuntime,
    restoreElectricalRuntime,
    snapshotElectricalRuntime,
} from './ElectricalRuntime.js';

export const COUPLED_ELECTRICAL_SNAPSHOT_SCHEMA = 'engine.electrical.coupled-snapshot';
export const COUPLED_ELECTRICAL_SNAPSHOT_VERSION = '1.0.0';

function positive(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || !(value > 0)) {
        throw new RangeError(label + ' must be finite and positive');
    }
    return value;
}

function clonePlain(value) {
    if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new RangeError('Coupled report contains a non-finite number');
        return value;
    }
    if (Array.isArray(value)) return value.map(clonePlain);
    if (ArrayBuffer.isView(value)) return Array.from(value, clonePlain);
    if (typeof value === 'object') {
        const result = {};
        for (const key of Object.keys(value).sort()) result[key] = clonePlain(value[key]);
        return result;
    }
    throw new TypeError('Coupled report must contain serializable values');
}

function freezeTree(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) freezeTree(child);
    return Object.freeze(value);
}

function errorItem(error, fallbackCode = 'ELECTRICAL_COUPLED_STEP') {
    return freezeTree({
        code: typeof error?.code === 'string' ? error.code : fallbackCode,
        message: error instanceof Error ? error.message : String(error),
        details: error?.details == null ? null : clonePlain(error.details),
    });
}

function actuatorIds(runtime) {
    return [...new Set(runtime.compiled.components
        .map((component) => component.actuatorRef)
        .filter((value) => typeof value === 'string'))].sort();
}

function requireMechanicsAdapter(adapter, axes) {
    if (axes.length === 0 && adapter == null) return null;
    if (!adapter || typeof adapter !== 'object') {
        throw new TypeError('A mechanics adapter is required for actuator-backed components');
    }
    for (const method of ['beginSubstep', 'readCoordinate', 'applyEffort', 'endSubstep']) {
        if (typeof adapter[method] !== 'function') {
            throw new TypeError('Mechanics adapter requires ' + method + '()');
        }
    }
    return adapter;
}

function transactionMechanicsSnapshot(adapter) {
    if (adapter == null) return null;
    if (typeof adapter.snapshot !== 'function' || typeof adapter.restore !== 'function') {
        const error = new TypeError('Coupled mechanics must expose snapshot() and restore() for atomic stepping');
        error.code = 'ELECTRICAL_MECHANICS_NOT_RESTORABLE';
        throw error;
    }
    const snapshot = adapter.snapshot();
    if (snapshot?.restorable === false) {
        const error = new TypeError('Coupled mechanics snapshot is explicitly not restorable');
        error.code = 'ELECTRICAL_MECHANICS_NOT_RESTORABLE';
        throw error;
    }
    return snapshot;
}

function restoreOuterState(runtime, runtimeSnapshot, mechanicsAdapter, mechanicsSnapshot) {
    const runtimeRestore = restoreElectricalRuntime(runtime, runtimeSnapshot);
    let mechanicsRestored = mechanicsSnapshot == null;
    let mechanicsError = null;
    if (mechanicsSnapshot != null) {
        try {
            mechanicsAdapter.restore(mechanicsSnapshot);
            mechanicsRestored = true;
        } catch (error) {
            mechanicsError = errorItem(error, 'ELECTRICAL_MECHANICS_ROLLBACK');
        }
    }
    return {
        runtimeRestored: runtimeRestore.ok,
        mechanicsRestored,
        mechanicsError,
    };
}

/**
 * Advance one mechanical tick using fixed electrical substeps.
 *
 * Each inner step solves into an offside runtime candidate. Mechanics receives
 * the solved effort directly, and the circuit candidate is committed only
 * after the mechanics adapter successfully ends the same substep.
 */
export function stepCoupledSystem(runtime, dtSeconds, inputs = {}, mechanicsAdapter = null, substepParticipant = null) {
    if (!(runtime instanceof ElectricalRuntime)) {
        throw new TypeError('ElectricalRuntime is required');
    }
    const dt = positive(dtSeconds, 'coupled dtSeconds');
    const substepCount = runtime.compiled.settings.electricalSubsteps;
    if (!Number.isSafeInteger(substepCount) || substepCount < 1) {
        throw new RangeError('Compiled electricalSubsteps must be a positive safe integer');
    }
    const h = dt / substepCount;
    positive(h, 'electrical substep h');
    const axes = actuatorIds(runtime);
    const mechanics = requireMechanicsAdapter(mechanicsAdapter, axes);
    const runtimeSnapshot = snapshotElectricalRuntime(runtime);
    let mechanicsSnapshot = null;
    let participantSnapshot = null;
    try {
        mechanicsSnapshot = transactionMechanicsSnapshot(mechanics);
        if (substepParticipant != null) {
            for (const method of ['captureState', 'restoreState', 'beginSubstep', 'endSubstep']) {
                if (typeof substepParticipant[method] !== 'function') throw new TypeError('Electrical substep participant requires ' + method + '()');
            }
            participantSnapshot = substepParticipant.captureState();
        }
    } catch (error) {
        return freezeTree({
            ok: false,
            errors: [errorItem(error)],
            statePreserved: true,
            runtimeStatePreserved: true,
            mechanicsStatePreserved: true,
            failedSubstep: 0,
            completedSubsteps: 0,
            dtSeconds: dt,
            electricalSubsteps: substepCount,
            h,
            startTimeSeconds: runtimeSnapshot.timeSeconds,
            endTimeSeconds: runtimeSnapshot.timeSeconds,
            startStepCount: runtimeSnapshot.stepCount,
            endStepCount: runtimeSnapshot.stepCount,
        });
    }
    const startTimeSeconds = runtimeSnapshot.timeSeconds;
    const startStepCount = runtimeSnapshot.stepCount;
    const substeps = [];
    const mechanicsReports = [];
    const effortSums = new Map(axes.map((axisId) => [axisId, 0]));

    for (let substep = 0; substep < substepCount; substep += 1) {
        let mechanicsActive = false;
        try {
            const coordinates = new Map();
            if (mechanics) {
                mechanics.beginSubstep(h);
                mechanicsActive = true;
                for (const axisId of axes) {
                    const coordinate = mechanics.readCoordinate(axisId);
                    if (!coordinate || typeof coordinate !== 'object') {
                        throw new TypeError('Mechanics coordinate ' + axisId + ' is invalid');
                    }
                    coordinates.set(axisId, coordinate);
                }
            }
            const stepInputs = substepParticipant == null ? inputs : substepParticipant.beginSubstep(h, runtime, inputs, coordinates);
            const prepared = runtime._prepareSubstep(h, stepInputs, coordinates);
            if (!prepared.ok) {
                const error = new Error(prepared.report.errors[0]?.message ?? 'Electrical substep failed');
                error.code = prepared.report.errors[0]?.code ?? 'ELECTRICAL_COUPLED_SOLVE';
                error.details = prepared.report.errors[0]?.details ?? null;
                throw error;
            }
            for (const axisId of axes) {
                const effort = prepared.efforts.get(axisId) ?? 0;
                mechanics.applyEffort(axisId, effort);
                effortSums.set(axisId, effortSums.get(axisId) + effort);
            }
            const mechanicsReport = mechanics ? mechanics.endSubstep(h) : null;
            mechanicsActive = false;
            const electricalReport = runtime._commitPrepared(prepared);
            substepParticipant?.endSubstep(electricalReport);
            substeps.push(electricalReport);
            if (mechanicsReport != null) mechanicsReports.push(clonePlain(mechanicsReport));
        } catch (error) {
            if (mechanicsActive && typeof mechanics?.cancelSubstep === 'function') {
                try {
                    mechanics.cancelSubstep();
                } catch {
                    // Rollback below remains authoritative.
                }
            }
            const rollback = restoreOuterState(
                runtime,
                runtimeSnapshot,
                mechanics,
                mechanicsSnapshot,
            );
            const errors = [errorItem(error)];
            if (rollback.mechanicsError) errors.push(rollback.mechanicsError);
            let participantRestored = participantSnapshot == null;
            if (participantSnapshot != null) {
                try { substepParticipant.restoreState(participantSnapshot); participantRestored = true; }
                catch (participantError) { errors.push(errorItem(participantError, 'ELECTRICAL_CONTROLLER_ROLLBACK')); }
            }
            return freezeTree({
                ok: false,
                errors,
                statePreserved: rollback.runtimeRestored && rollback.mechanicsRestored && participantRestored,
                runtimeStatePreserved: rollback.runtimeRestored,
                mechanicsStatePreserved: rollback.mechanicsRestored,
                ...(substepParticipant == null ? {} : { controllerStatePreserved: participantRestored }),
                failedSubstep: substep,
                completedSubsteps: substeps.length,
                dtSeconds: dt,
                electricalSubsteps: substepCount,
                h,
                startTimeSeconds,
                endTimeSeconds: runtime.telemetry().timeSeconds,
                startStepCount,
                endStepCount: runtime.telemetry().stepCount,
            });
        }
    }

    const telemetry = runtime.telemetry();
    return freezeTree({
        ok: true,
        errors: [],
        dtSeconds: dt,
        electricalSubsteps: substepCount,
        h,
        startTimeSeconds,
        endTimeSeconds: telemetry.timeSeconds,
        startStepCount,
        endStepCount: telemetry.stepCount,
        efforts: Object.fromEntries([...effortSums.entries()]),
        averageEfforts: Object.fromEntries([...effortSums.entries()].map(([id, sum]) => [
            id,
            sum / substepCount,
        ])),
        substeps,
        mechanics: mechanicsReports,
    });
}

export class CoupledElectricalSystem {
    constructor(runtime, mechanicsAdapter = null, options = {}) {
        if (!(runtime instanceof ElectricalRuntime)) {
            throw new TypeError('ElectricalRuntime is required');
        }
        const axes = actuatorIds(runtime);
        this.runtime = runtime;
        this.mechanicsAdapter = requireMechanicsAdapter(mechanicsAdapter, axes);
        this.ownsRuntime = options.ownsRuntime === true;
        this.ownsMechanics = options.ownsMechanics === true;
        this._disposed = false;
    }

    _assertLive() {
        if (this._disposed) throw new Error('Coupled electrical system is disposed');
    }

    step(dtSeconds, inputs = {}) {
        this._assertLive();
        return stepCoupledSystem(this.runtime, dtSeconds, inputs, this.mechanicsAdapter);
    }

    snapshot() {
        this._assertLive();
        const mechanics = transactionMechanicsSnapshot(this.mechanicsAdapter);
        return freezeTree({
            schema: COUPLED_ELECTRICAL_SNAPSHOT_SCHEMA,
            version: COUPLED_ELECTRICAL_SNAPSHOT_VERSION,
            runtime: snapshotElectricalRuntime(this.runtime),
            mechanics: mechanics == null ? null : clonePlain(mechanics),
        });
    }

    restore(snapshot) {
        this._assertLive();
        if (!snapshot || snapshot.schema !== COUPLED_ELECTRICAL_SNAPSHOT_SCHEMA ||
            snapshot.version !== COUPLED_ELECTRICAL_SNAPSHOT_VERSION) {
            return freezeTree({
                ok: false,
                errors: [errorItem(new RangeError('Coupled snapshot schema or version is invalid'))],
                statePreserved: true,
            });
        }
        const previousRuntime = snapshotElectricalRuntime(this.runtime);
        let previousMechanics;
        try {
            previousMechanics = transactionMechanicsSnapshot(this.mechanicsAdapter);
        } catch (error) {
            return freezeTree({
                ok: false,
                errors: [errorItem(error, 'ELECTRICAL_COUPLED_RESTORE')],
                statePreserved: true,
            });
        }
        try {
            const runtimeReport = restoreElectricalRuntime(this.runtime, snapshot.runtime);
            if (!runtimeReport.ok) {
                const error = new Error(runtimeReport.errors[0].message);
                error.code = runtimeReport.errors[0].code;
                throw error;
            }
            if (snapshot.mechanics != null) {
                if (typeof this.mechanicsAdapter?.restore !== 'function') {
                    throw new TypeError('Mechanics adapter cannot restore the coupled snapshot');
                }
                this.mechanicsAdapter.restore(snapshot.mechanics);
            }
            return freezeTree({ ok: true, errors: [], snapshot: this.snapshot() });
        } catch (error) {
            restoreElectricalRuntime(this.runtime, previousRuntime);
            if (previousMechanics != null) this.mechanicsAdapter.restore(previousMechanics);
            return freezeTree({
                ok: false,
                errors: [errorItem(error, 'ELECTRICAL_COUPLED_RESTORE')],
                statePreserved: true,
            });
        }
    }

    telemetry() {
        this._assertLive();
        return freezeTree({
            runtime: this.runtime.telemetry(),
            mechanics: typeof this.mechanicsAdapter?.telemetry === 'function'
                ? clonePlain(this.mechanicsAdapter.telemetry())
                : null,
        });
    }

    dispose() {
        if (this._disposed) return false;
        if (this.ownsMechanics && typeof this.mechanicsAdapter?.dispose === 'function') {
            this.mechanicsAdapter.dispose();
        }
        if (this.ownsRuntime) this.runtime.dispose();
        this._disposed = true;
        return true;
    }
}

export function createCoupledElectricalSystem(runtime, mechanicsAdapter = null, options = {}) {
    return new CoupledElectricalSystem(runtime, mechanicsAdapter, options);
}

export default stepCoupledSystem;
