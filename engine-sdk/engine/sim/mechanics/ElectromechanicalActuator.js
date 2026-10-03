// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
    constraintMotorTargetErrorReport,
    constraintSpringDamperCoefficients,
} from '../../core/math/ConstraintMath.js';

/**
 * Deterministic one-degree-of-freedom spring, motor, and coil state.
 *
 * Gameplay mechanisms own one of these records. Renderers only read it, so a
 * single authoritative state drives force, travel, copper glow, and diagnostics.
 */
export function createElectromechanicalActuator(options = {}) {
    const min = finite(options.min, 0);
    const max = Math.max(min, finite(options.max, 1));
    const position = clamp(finite(options.position, min), min, max);
    return {
        min,
        max,
        position,
        velocity: finite(options.velocity, 0),
        target: clamp(finite(options.target, position), min, max),
        effectiveMass: Math.max(1e-6, finite(options.effectiveMass, 1)),
        frequencyHz: Math.max(0, finite(options.frequencyHz, 10)),
        dampingRatio: Math.max(0, finite(options.dampingRatio, 0.82)),
        maxEffort: Math.max(0, finite(options.maxEffort, 1000)),
        effort: 0,
        normalizedEffort: 0,
        coilPower: 0,
        temperature: clamp(finite(options.temperature, 0), 0, 1),
        phase: String(options.phase ?? 'idle'),
        energized: false,
        atTarget: true,
        saturated: false,
        storedEnergy: 0,
    };
}

export function resetElectromechanicalActuator(actuator, position = actuator?.min ?? 0) {
    if (!actuator) return null;
    actuator.position = clamp(finite(position, actuator.min), actuator.min, actuator.max);
    actuator.velocity = 0;
    actuator.target = actuator.position;
    actuator.effort = 0;
    actuator.normalizedEffort = 0;
    actuator.coilPower = 0;
    actuator.temperature = 0;
    actuator.phase = 'idle';
    actuator.energized = false;
    actuator.atTarget = true;
    actuator.saturated = false;
    actuator.storedEnergy = 0;
    return actuator;
}

/** Advance a constrained spring/PD motor by one fixed simulation step. */
export function stepElectromechanicalActuator(actuator, dt, drive = {}) {
    if (!actuator || !(dt > 0)) return actuator;
    const min = actuator.min;
    const max = actuator.max;
    const target = clamp(finite(drive.target, actuator.target), min, max);
    const effectiveMass = Math.max(1e-6, finite(drive.effectiveMass, actuator.effectiveMass));
    const frequencyHz = Math.max(0, finite(drive.frequencyHz, actuator.frequencyHz));
    const dampingRatio = Math.max(0, finite(drive.dampingRatio, actuator.dampingRatio));
    const maxEffort = Math.max(0, finite(drive.maxEffort, actuator.maxEffort));
    const coefficients = constraintSpringDamperCoefficients({
        mode: 'frequency', frequencyHz, dampingRatio, effectiveMass, timeStep: dt,
    });
    const report = constraintMotorTargetErrorReport(actuator.position, target, {
        currentVelocity: actuator.velocity,
        targetVelocity: finite(drive.targetVelocity, 0),
        coefficients,
        maxEffort,
        tolerance: Math.max(0, finite(drive.tolerance, 0.002)),
    });

    actuator.target = target;
    actuator.effectiveMass = effectiveMass;
    actuator.frequencyHz = frequencyHz;
    actuator.dampingRatio = dampingRatio;
    actuator.maxEffort = maxEffort;
    actuator.effort = report.effort;
    actuator.normalizedEffort = maxEffort > 0
        ? clamp(Math.abs(report.effort) / maxEffort, 0, 1)
        : 0;
    actuator.velocity += (report.effort / effectiveMass) * dt;
    const velocityLimit = Math.max(0, finite(drive.velocityLimit, Infinity));
    if (Number.isFinite(velocityLimit)) {
        actuator.velocity = clamp(actuator.velocity, -velocityLimit, velocityLimit);
    }
    actuator.position += actuator.velocity * dt;
    if (actuator.position <= min) {
        actuator.position = min;
        if (actuator.velocity < 0) actuator.velocity *= -Math.max(0, finite(drive.endStopBounce, 0));
    } else if (actuator.position >= max) {
        actuator.position = max;
        if (actuator.velocity > 0) actuator.velocity *= -Math.max(0, finite(drive.endStopBounce, 0));
    }

    actuator.energized = drive.energized === true;
    actuator.phase = String(drive.phase ?? actuator.phase);
    const minimumCurrent = actuator.energized
        ? clamp(finite(drive.minimumCurrent, 0), 0, 1)
        : 0;
    actuator.coilPower = actuator.energized
        ? Math.max(minimumCurrent, actuator.normalizedEffort)
        : 0;
    const heating = actuator.coilPower * actuator.coilPower * Math.max(0, finite(drive.heatingRate, 0.28));
    const cooling = Math.max(0, finite(drive.coolingRate, 0.16));
    actuator.temperature = clamp(actuator.temperature + (heating - cooling * actuator.temperature) * dt, 0, 1);
    actuator.atTarget = Math.abs(target - actuator.position) <= Math.max(0, finite(drive.tolerance, 0.002)) &&
        Math.abs(actuator.velocity) <= Math.max(0, finite(drive.velocityTolerance, 0.02));
    actuator.saturated = report.saturated;
    actuator.storedEnergy = 0.5 * coefficients.stiffness * (target - actuator.position) ** 2;
    return actuator;
}

/** Hooke-law energy stored by a mechanism compressed away from its rest point. */
export function actuatorElasticEnergy(actuator, rest = actuator?.min ?? 0) {
    if (!actuator) return 0;
    const displacement = actuator.position - finite(rest, actuator.min);
    const angularFrequency = Math.PI * 2 * Math.max(0, actuator.frequencyHz);
    const stiffness = actuator.effectiveMass * angularFrequency * angularFrequency;
    return 0.5 * stiffness * displacement * displacement;
}

function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
