// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { constraintSpringDamperCoefficients } from '../../core/math/ConstraintMath.js';

export const ELECTRICAL_MECHANICS_SNAPSHOT_SCHEMA = 'engine.electrical.mechanics-1d-snapshot';
export const ELECTRICAL_MECHANICS_SNAPSHOT_VERSION = '1.0.0';

const AXIS_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._:/-]{0,127}$/;
const AXIS_KINDS = new Set(['linear', 'rotary']);
const POSITION_LIMIT = 1e12;
const EFFORT_LIMIT = 1e18;

export class ElectricalMechanicsError extends Error {
    constructor(code, message, details = null) {
        super(String(message));
        this.name = 'ElectricalMechanicsError';
        this.code = String(code || 'ELECTRICAL_MECHANICS');
        this.details = details;
    }
}

function fail(code, message, details = null) {
    throw new ElectricalMechanicsError(code, message, details);
}

function finite(value, label, { minimum = -POSITION_LIMIT, maximum = POSITION_LIMIT } = {}) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < minimum || number > maximum) {
        fail('ELECTRICAL_MECHANICS_NUMBER', `${label} must be finite in [${minimum}, ${maximum}]`);
    }
    return number;
}

function finitePositive(value, label) {
    return finite(value, label, { minimum: Number.MIN_VALUE, maximum: POSITION_LIMIT });
}

function normalizeAxis(raw, index) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        fail('ELECTRICAL_MECHANICS_AXIS', `axes[${index}] must be an object`);
    }
    const id = String(raw.id ?? '');
    if (!AXIS_ID_PATTERN.test(id)) fail('ELECTRICAL_MECHANICS_AXIS_ID', `axes[${index}].id is invalid`);
    const kind = String(raw.kind ?? 'linear');
    if (!AXIS_KINDS.has(kind)) fail('ELECTRICAL_MECHANICS_AXIS_KIND', `Axis '${id}' kind must be linear or rotary`);
    const effectiveMass = finitePositive(raw.effectiveMass ?? raw.mass ?? raw.inertia ?? 1, `axis '${id}' effective mass`);
    const lowerLimit = finite(raw.lowerLimit ?? raw.min ?? -POSITION_LIMIT, `axis '${id}' lower limit`);
    const upperLimit = finite(raw.upperLimit ?? raw.max ?? POSITION_LIMIT, `axis '${id}' upper limit`);
    if (!(lowerLimit < upperLimit)) fail('ELECTRICAL_MECHANICS_LIMITS', `Axis '${id}' lower limit must be below its upper limit`);
    const coefficients = constraintSpringDamperCoefficients({
        effectiveMass,
        stiffness: finite(raw.stiffness ?? 0, `axis '${id}' stiffness`, { minimum: 0, maximum: EFFORT_LIMIT }),
        damping: finite(raw.damping ?? 0, `axis '${id}' damping`, { minimum: 0, maximum: EFFORT_LIMIT }),
    });
    if (!coefficients.valid) fail('ELECTRICAL_MECHANICS_SPRING', `Axis '${id}' has invalid spring/damper coefficients`);
    const position = finite(raw.position ?? raw.restPosition ?? 0, `axis '${id}' position`);
    if (position < lowerLimit || position > upperLimit) {
        fail('ELECTRICAL_MECHANICS_POSITION', `Axis '${id}' initial position is outside its limits`);
    }
    return Object.freeze({
        id,
        kind,
        effectiveMass,
        restPosition: finite(raw.restPosition ?? 0, `axis '${id}' rest position`),
        stiffness: coefficients.stiffness,
        damping: coefficients.damping,
        viscousFriction: finite(raw.viscousFriction ?? 0, `axis '${id}' viscous friction`, { minimum: 0, maximum: EFFORT_LIMIT }),
        coulombFriction: finite(raw.coulombFriction ?? 0, `axis '${id}' Coulomb friction`, { minimum: 0, maximum: EFFORT_LIMIT }),
        lowerLimit,
        upperLimit,
        restitution: finite(raw.restitution ?? 0, `axis '${id}' restitution`, { minimum: 0, maximum: 1 }),
        initial: Object.freeze({
            position,
            velocity: finite(raw.velocity ?? 0, `axis '${id}' velocity`),
            externalLoad: finite(raw.externalLoad ?? 0, `axis '${id}' external load`, { minimum: -EFFORT_LIMIT, maximum: EFFORT_LIMIT }),
        }),
    });
}

function stateRecord(axis, source = axis.initial) {
    return {
        position: source.position,
        velocity: source.velocity,
        externalLoad: source.externalLoad,
        effort: 0,
        reactionImpulse: 0,
        atMin: source.position <= axis.lowerLimit,
        atMax: source.position >= axis.upperLimit,
    };
}

function frozenCoordinate(axis, state) {
    return Object.freeze({
        axisId: axis.id,
        kind: axis.kind,
        position: state.position,
        velocity: state.velocity,
        externalLoad: state.externalLoad,
        atMin: state.atMin,
        atMax: state.atMax,
        lowerLimit: axis.lowerLimit,
        upperLimit: axis.upperLimit,
        reactionImpulse: state.reactionImpulse,
    });
}

export class DeterministicMechanics1D {
    constructor({ axes } = {}) {
        if (!Array.isArray(axes) || axes.length === 0 || axes.length > 256) {
            fail('ELECTRICAL_MECHANICS_AXES', 'Mechanics requires between 1 and 256 axes');
        }
        this._axes = axes.map(normalizeAxis).sort((left, right) => left.id.localeCompare(right.id));
        if (new Set(this._axes.map(axis => axis.id)).size !== this._axes.length) {
            fail('ELECTRICAL_MECHANICS_DUPLICATE_AXIS', 'Mechanics axis IDs must be unique');
        }
        this._axisById = new Map(this._axes.map(axis => [axis.id, axis]));
        this._state = new Map(this._axes.map(axis => [axis.id, stateRecord(axis)]));
        this._active = null;
        this._disposed = false;
        this._stepCount = 0;
        this._lastStep = null;
    }

    _assertLive() {
        if (this._disposed) fail('ELECTRICAL_MECHANICS_DISPOSED', 'Mechanics adapter is disposed');
    }

    _requireAxis(axisId) {
        const id = String(axisId ?? '');
        const axis = this._axisById.get(id);
        if (!axis) fail('ELECTRICAL_MECHANICS_UNKNOWN_AXIS', `Unknown mechanics axis '${id}'`);
        return axis;
    }

    beginSubstep(h) {
        this._assertLive();
        if (this._active) fail('ELECTRICAL_MECHANICS_NESTED_STEP', 'A mechanics substep is already active');
        const dt = finitePositive(h, 'mechanics substep');
        const candidate = new Map();
        for (const axis of this._axes) {
            const current = this._state.get(axis.id);
            candidate.set(axis.id, { ...current, effort: 0, reactionImpulse: 0 });
        }
        this._active = { h: dt, candidate };
        return true;
    }

    readCoordinate(axisId) {
        this._assertLive();
        const axis = this._requireAxis(axisId);
        const state = (this._active?.candidate ?? this._state).get(axis.id);
        return frozenCoordinate(axis, state);
    }

    applyEffort(axisId, effort) {
        this._assertLive();
        if (!this._active) fail('ELECTRICAL_MECHANICS_STEP_REQUIRED', 'applyEffort requires an active substep');
        const axis = this._requireAxis(axisId);
        const state = this._active.candidate.get(axis.id);
        state.effort = finite(state.effort + finite(effort, `axis '${axis.id}' effort`, {
            minimum: -EFFORT_LIMIT,
            maximum: EFFORT_LIMIT,
        }), `axis '${axis.id}' summed effort`, { minimum: -EFFORT_LIMIT, maximum: EFFORT_LIMIT });
        return state.effort;
    }

    applyReactionImpulse(axisId, impulse) {
        this._assertLive();
        if (!this._active) fail('ELECTRICAL_MECHANICS_STEP_REQUIRED', 'applyReactionImpulse requires an active substep');
        const axis = this._requireAxis(axisId);
        const state = this._active.candidate.get(axis.id);
        const value = finite(impulse, `axis '${axis.id}' reaction impulse`, {
            minimum: -EFFORT_LIMIT,
            maximum: EFFORT_LIMIT,
        });
        state.velocity = finite(state.velocity + value / axis.effectiveMass, `axis '${axis.id}' impulse velocity`);
        state.reactionImpulse = finite(state.reactionImpulse + value, `axis '${axis.id}' total reaction impulse`, {
            minimum: -EFFORT_LIMIT,
            maximum: EFFORT_LIMIT,
        });
        return state.reactionImpulse;
    }

    setExternalLoad(axisId, load) {
        this._assertLive();
        const axis = this._requireAxis(axisId);
        const target = (this._active?.candidate ?? this._state).get(axis.id);
        target.externalLoad = finite(load, `axis '${axis.id}' external load`, {
            minimum: -EFFORT_LIMIT,
            maximum: EFFORT_LIMIT,
        });
        return target.externalLoad;
    }

    endSubstep(h = this._active?.h) {
        this._assertLive();
        if (!this._active) fail('ELECTRICAL_MECHANICS_STEP_REQUIRED', 'endSubstep requires an active substep');
        const dt = finitePositive(h, 'mechanics substep');
        if (dt !== this._active.h) fail('ELECTRICAL_MECHANICS_STEP_MISMATCH', 'Mechanics begin/end substeps must match exactly');
        const committed = new Map();
        const reports = [];
        for (const axis of this._axes) {
            const state = this._active.candidate.get(axis.id);
            const direction = Math.abs(state.velocity) > 1e-12
                ? Math.sign(state.velocity)
                : Math.sign(state.effort - state.externalLoad - axis.stiffness * (state.position - axis.restPosition));
            const springEffort = axis.stiffness * (state.position - axis.restPosition);
            const dampingEffort = (axis.damping + axis.viscousFriction) * state.velocity;
            const frictionEffort = direction * axis.coulombFriction;
            const netEffort = state.effort - state.externalLoad - springEffort - dampingEffort - frictionEffort;
            let velocity = finite(state.velocity + (netEffort / axis.effectiveMass) * dt, `axis '${axis.id}' next velocity`);
            let position = finite(state.position + velocity * dt, `axis '${axis.id}' next position`);
            let limitImpulse = 0;
            if (position < axis.lowerLimit) {
                position = axis.lowerLimit;
                if (velocity < 0) {
                    const before = velocity;
                    velocity = -velocity * axis.restitution;
                    limitImpulse = axis.effectiveMass * (velocity - before);
                }
            } else if (position > axis.upperLimit) {
                position = axis.upperLimit;
                if (velocity > 0) {
                    const before = velocity;
                    velocity = -velocity * axis.restitution;
                    limitImpulse = axis.effectiveMass * (velocity - before);
                }
            }
            const next = {
                position,
                velocity,
                externalLoad: state.externalLoad,
                effort: state.effort,
                reactionImpulse: finite(state.reactionImpulse + limitImpulse, `axis '${axis.id}' committed reaction impulse`, {
                    minimum: -EFFORT_LIMIT,
                    maximum: EFFORT_LIMIT,
                }),
                atMin: position <= axis.lowerLimit,
                atMax: position >= axis.upperLimit,
            };
            committed.set(axis.id, next);
            reports.push(Object.freeze({
                ...frozenCoordinate(axis, next),
                appliedEffort: state.effort,
                netEffort,
                springEffort,
                dampingEffort,
                frictionEffort,
            }));
        }
        this._state = committed;
        this._active = null;
        this._stepCount += 1;
        this._lastStep = Object.freeze({ h: dt, stepCount: this._stepCount, axes: Object.freeze(reports) });
        return this._lastStep;
    }

    cancelSubstep() {
        if (!this._active) return false;
        this._active = null;
        return true;
    }

    snapshot() {
        this._assertLive();
        if (this._active) fail('ELECTRICAL_MECHANICS_SNAPSHOT_ACTIVE', 'Cannot snapshot mechanics during an active substep');
        return Object.freeze({
            schema: ELECTRICAL_MECHANICS_SNAPSHOT_SCHEMA,
            version: ELECTRICAL_MECHANICS_SNAPSHOT_VERSION,
            stepCount: this._stepCount,
            axes: Object.freeze(this._axes.map(axis => Object.freeze({
                id: axis.id,
                ...frozenCoordinate(axis, this._state.get(axis.id)),
            }))),
        });
    }

    restore(snapshot) {
        this._assertLive();
        if (this._active) fail('ELECTRICAL_MECHANICS_RESTORE_ACTIVE', 'Cannot restore mechanics during an active substep');
        if (snapshot?.schema !== ELECTRICAL_MECHANICS_SNAPSHOT_SCHEMA
            || snapshot?.version !== ELECTRICAL_MECHANICS_SNAPSHOT_VERSION
            || !Array.isArray(snapshot.axes)
            || snapshot.axes.length !== this._axes.length) {
            fail('ELECTRICAL_MECHANICS_SNAPSHOT', 'Mechanics snapshot schema, version, or axis count is invalid');
        }
        const byId = new Map(snapshot.axes.map(record => [String(record?.id ?? ''), record]));
        const restored = new Map();
        for (const axis of this._axes) {
            const record = byId.get(axis.id);
            if (!record || byId.size !== this._axes.length) {
                fail('ELECTRICAL_MECHANICS_SNAPSHOT_AXIS', `Mechanics snapshot is missing axis '${axis.id}'`);
            }
            const position = finite(record.position, `snapshot axis '${axis.id}' position`);
            if (position < axis.lowerLimit || position > axis.upperLimit) {
                fail('ELECTRICAL_MECHANICS_SNAPSHOT_POSITION', `Snapshot axis '${axis.id}' is outside its limits`);
            }
            restored.set(axis.id, {
                position,
                velocity: finite(record.velocity, `snapshot axis '${axis.id}' velocity`),
                externalLoad: finite(record.externalLoad, `snapshot axis '${axis.id}' external load`, {
                    minimum: -EFFORT_LIMIT,
                    maximum: EFFORT_LIMIT,
                }),
                effort: finite(record.appliedEffort ?? 0, `snapshot axis '${axis.id}' effort`, {
                    minimum: -EFFORT_LIMIT,
                    maximum: EFFORT_LIMIT,
                }),
                reactionImpulse: finite(record.reactionImpulse ?? 0, `snapshot axis '${axis.id}' reaction impulse`, {
                    minimum: -EFFORT_LIMIT,
                    maximum: EFFORT_LIMIT,
                }),
                atMin: position <= axis.lowerLimit,
                atMax: position >= axis.upperLimit,
            });
        }
        const stepCount = Number(snapshot.stepCount);
        if (!Number.isSafeInteger(stepCount) || stepCount < 0) {
            fail('ELECTRICAL_MECHANICS_SNAPSHOT_STEP', 'Mechanics snapshot stepCount must be a non-negative safe integer');
        }
        this._state = restored;
        this._stepCount = stepCount;
        this._lastStep = null;
        return this.snapshot();
    }

    telemetry() {
        this._assertLive();
        return Object.freeze({
            stepCount: this._stepCount,
            active: this._active != null,
            axes: Object.freeze(this._axes.map(axis => frozenCoordinate(axis, this._state.get(axis.id)))),
            lastStep: this._lastStep,
        });
    }

    dispose() {
        if (this._disposed) return false;
        this._active = null;
        this._state.clear();
        this._disposed = true;
        return true;
    }
}

export function createDeterministicMechanics1D(options) {
    return new DeterministicMechanics1D(options);
}

export default createDeterministicMechanics1D;
