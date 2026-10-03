// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Optional adapter over public PhysX joint handles. This module deliberately
 * imports no PhysX binding and never owns or mutates protected physics code.
 */

const AXIS_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._:/-]{0,127}$/;

function finite(value, label, { positive = false } = {}) {
    const number = Number(value);
    if (!Number.isFinite(number) || (positive && number <= 0)) {
        throw new TypeError(`${label} must be ${positive ? 'positive and ' : ''}finite`);
    }
    return number;
}

export class PhysXMechanics1DAdapter {
    constructor({
        axisId,
        kind = 'rotary',
        joint,
        effectiveMass = 1,
        readPosition = null,
        readVelocity = null,
        applyPublicEffort = null,
        stepPublicWorld = null,
        restorePublicState = null,
        externalLoad = 0,
        lowerLimit = -Infinity,
        upperLimit = Infinity,
    } = {}) {
        this.axisId = String(axisId ?? '');
        if (!AXIS_ID_PATTERN.test(this.axisId)) throw new TypeError('PhysX mechanics axisId is invalid');
        if (kind !== 'linear' && kind !== 'rotary') throw new TypeError('PhysX mechanics kind must be linear or rotary');
        if (!joint || typeof joint !== 'object') throw new TypeError('PhysX mechanics requires a public joint handle');
        this.kind = kind;
        this.joint = joint;
        this.effectiveMass = finite(effectiveMass, 'PhysX effective mass', { positive: true });
        this._readPosition = readPosition ?? (() => {
            if (typeof joint.getAngle !== 'function') throw new Error('PhysX joint exposes no public position reader');
            return joint.getAngle();
        });
        this._readVelocity = readVelocity;
        this._applyPublicEffort = applyPublicEffort;
        this._stepPublicWorld = stepPublicWorld;
        if (restorePublicState != null && typeof restorePublicState !== 'function') {
            throw new TypeError('PhysX restorePublicState must be a function when supplied');
        }
        this._restorePublicState = restorePublicState;
        this._externalLoad = finite(externalLoad, 'PhysX external load');
        this._lowerLimit = Number(lowerLimit);
        this._upperLimit = Number(upperLimit);
        if (!(this._lowerLimit < this._upperLimit)) throw new TypeError('PhysX mechanics limits are invalid');
        this._lastPosition = finite(this._readPosition(), 'PhysX initial position');
        this._velocity = readVelocity ? finite(readVelocity(), 'PhysX initial velocity') : 0;
        this._active = null;
        this._disposed = false;
        this._steps = 0;
    }

    _live() {
        if (this._disposed) throw new Error('PhysX mechanics adapter is disposed');
    }

    beginSubstep(h) {
        this._live();
        if (this._active) throw new Error('PhysX mechanics substep is already active');
        this._active = { h: finite(h, 'PhysX substep', { positive: true }), effort: 0 };
    }

    readCoordinate(axisId) {
        this._live();
        if (String(axisId) !== this.axisId) throw new Error(`Unknown PhysX mechanics axis '${axisId}'`);
        const position = finite(this._readPosition(), 'PhysX position');
        const velocity = this._readVelocity ? finite(this._readVelocity(), 'PhysX velocity') : this._velocity;
        return Object.freeze({
            axisId: this.axisId,
            kind: this.kind,
            position,
            velocity,
            externalLoad: this._externalLoad,
            atMin: position <= this._lowerLimit,
            atMax: position >= this._upperLimit,
            lowerLimit: this._lowerLimit,
            upperLimit: this._upperLimit,
        });
    }

    applyEffort(axisId, effort) {
        this._live();
        if (!this._active) throw new Error('PhysX applyEffort requires an active substep');
        if (String(axisId) !== this.axisId) throw new Error(`Unknown PhysX mechanics axis '${axisId}'`);
        this._active.effort = finite(this._active.effort + finite(effort, 'PhysX effort'), 'PhysX summed effort');
        return this._active.effort;
    }

    setExternalLoad(axisId, load) {
        this._live();
        if (String(axisId) !== this.axisId) throw new Error(`Unknown PhysX mechanics axis '${axisId}'`);
        this._externalLoad = finite(load, 'PhysX external load');
        return this._externalLoad;
    }

    endSubstep(h = this._active?.h) {
        this._live();
        if (!this._active) throw new Error('PhysX endSubstep requires an active substep');
        const dt = finite(h, 'PhysX substep', { positive: true });
        if (dt !== this._active.h) throw new Error('PhysX begin/end substeps must match exactly');
        const positionBefore = finite(this._readPosition(), 'PhysX position');
        const effort = this._active.effort - this._externalLoad;
        if (typeof this._applyPublicEffort === 'function') {
            this._applyPublicEffort(effort, dt, this.joint);
        } else if (typeof this.joint.setMotorVelocity === 'function') {
            const currentVelocity = this._readVelocity
                ? finite(this._readVelocity(), 'PhysX velocity')
                : this._velocity;
            this.joint.setMotorVelocity(currentVelocity + (effort / this.effectiveMass) * dt);
        } else {
            throw new Error('PhysX joint exposes no supported public effort operation');
        }
        if (typeof this._stepPublicWorld === 'function') this._stepPublicWorld(dt);
        const position = finite(this._readPosition(), 'PhysX position');
        this._velocity = this._readVelocity
            ? finite(this._readVelocity(), 'PhysX velocity')
            : (position - positionBefore) / dt;
        this._lastPosition = position;
        this._active = null;
        this._steps += 1;
        return Object.freeze({
            axisId: this.axisId,
            position,
            velocity: this._velocity,
            reactionImpulse: 0,
            appliedEffort: effort,
            diagnostics: Object.freeze({ backend: 'physx-public', steps: this._steps }),
        });
    }

    cancelSubstep() {
        if (!this._active) return false;
        this._active = null;
        return true;
    }

    snapshot() {
        this._live();
        const coordinate = this.readCoordinate(this.axisId);
        return Object.freeze({
            schema: 'engine.electrical.physx-mechanics-snapshot',
            version: '1.0.0',
            axisId: this.axisId,
            position: coordinate.position,
            velocity: coordinate.velocity,
            externalLoad: coordinate.externalLoad,
            steps: this._steps,
            restorable: typeof this._restorePublicState === 'function',
        });
    }

    restore(snapshot) {
        this._live();
        if (typeof this._restorePublicState !== 'function') {
            throw new Error('Public PhysX joint handles do not expose deterministic pose restoration');
        }
        if (!snapshot || snapshot.schema !== 'engine.electrical.physx-mechanics-snapshot'
            || snapshot.version !== '1.0.0' || snapshot.axisId !== this.axisId
            || snapshot.restorable !== true || !Number.isSafeInteger(snapshot.steps)
            || snapshot.steps < 0) {
            throw new TypeError('PhysX mechanics snapshot is incompatible or not restorable');
        }
        const position = finite(snapshot.position, 'PhysX snapshot position');
        const velocity = finite(snapshot.velocity, 'PhysX snapshot velocity');
        const externalLoad = finite(snapshot.externalLoad, 'PhysX snapshot external load');
        this._restorePublicState(Object.freeze({ position, velocity }), this.joint);
        const restoredPosition = finite(this._readPosition(), 'PhysX restored position');
        const restoredVelocity = this._readVelocity
            ? finite(this._readVelocity(), 'PhysX restored velocity')
            : velocity;
        if (restoredPosition !== position || restoredVelocity !== velocity) {
            throw new Error('PhysX public restore did not reproduce the exact snapshot pose');
        }
        this._lastPosition = restoredPosition;
        this._velocity = restoredVelocity;
        this._externalLoad = externalLoad;
        this._steps = snapshot.steps;
        this._active = null;
        return this.snapshot();
    }

    dispose() {
        if (this._disposed) return false;
        this._active = null;
        this._disposed = true;
        return true;
    }
}

export function createPhysXMechanics1DAdapter(options) {
    return new PhysXMechanics1DAdapter(options);
}

export default createPhysXMechanics1DAdapter;
