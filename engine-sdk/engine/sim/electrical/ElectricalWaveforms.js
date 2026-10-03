// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { phaseFromTime, sampleWave } from '../../core/math/MathOscillator.js';

const DEGREES_TO_RADIANS = Math.PI / 180;

function finite(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(label + ' must be finite');
    }
    return value;
}

function nonNegative(value, label) {
    const number = finite(value ?? 0, label);
    if (number < 0) throw new RangeError(label + ' must be non-negative');
    return number;
}

function positive(value, label) {
    const number = finite(value, label);
    if (!(number > 0)) throw new RangeError(label + ' must be positive');
    return number;
}

/**
 * Deterministically sample a SPICE-style pulse envelope.
 *
 * Pulse width is the time held at the high value after the rising edge. When
 * rise/fall are zero their transitions occur exactly at the segment boundary.
 */
export function sampleElectricalPulse({
    low,
    high,
    delaySeconds = 0,
    riseSeconds = 0,
    fallSeconds = 0,
    pulseWidthSeconds,
    periodSeconds,
}, timeSeconds) {
    const lowValue = finite(low, 'pulse low value');
    const highValue = finite(high, 'pulse high value');
    const delay = nonNegative(delaySeconds, 'pulse delaySeconds');
    const rise = nonNegative(riseSeconds, 'pulse riseSeconds');
    const fall = nonNegative(fallSeconds, 'pulse fallSeconds');
    const width = positive(pulseWidthSeconds, 'pulse pulseWidthSeconds');
    const period = positive(periodSeconds, 'pulse periodSeconds');
    const time = nonNegative(timeSeconds, 'pulse timeSeconds');
    const activeDuration = rise + width + fall;
    if (activeDuration > period) {
        throw new RangeError('pulse rise + width + fall must not exceed periodSeconds');
    }
    if (time < delay) return lowValue;
    const elapsed = time - delay;
    const phase = elapsed - Math.floor(elapsed / period) * period;
    if (rise > 0 && phase < rise) {
        return lowValue + (highValue - lowValue) * (phase / rise);
    }
    const highStart = rise;
    const highEnd = highStart + width;
    if (phase < highEnd) return highValue;
    const fallEnd = highEnd + fall;
    if (fall > 0 && phase < fallEnd) {
        return highValue + (lowValue - highValue) * ((phase - highEnd) / fall);
    }
    return lowValue;
}

export function sampleElectricalSine({
    offset,
    amplitude,
    frequencyHz,
    phaseDegrees = 0,
    delaySeconds = 0,
}, timeSeconds) {
    const offsetValue = finite(offset, 'sine offset');
    const amplitudeValue = finite(amplitude, 'sine amplitude');
    const frequency = positive(frequencyHz, 'sine frequencyHz');
    const phase = finite(phaseDegrees, 'sine phaseDegrees') * DEGREES_TO_RADIANS;
    const delay = nonNegative(delaySeconds, 'sine delaySeconds');
    const time = nonNegative(timeSeconds, 'sine timeSeconds');
    if (time < delay) return offsetValue;
    const angle = phaseFromTime(frequency, time - delay, phase);
    return offsetValue + amplitudeValue * sampleWave('sine', angle);
}

export function sampleElectricalSource(component, timeSeconds) {
    if (!component || typeof component !== 'object') {
        throw new TypeError('component is required');
    }
    const parameters = component.parameters ?? {};
    switch (component.kind) {
        case 'voltage-source.dc':
            return finite(parameters.voltageVolts, component.id + ' voltageVolts');
        case 'current-source.dc':
            return finite(parameters.currentAmps, component.id + ' currentAmps');
        case 'voltage-source.pulse':
            return sampleElectricalPulse({
                low: parameters.lowVolts,
                high: parameters.highVolts,
                delaySeconds: parameters.delaySeconds,
                riseSeconds: parameters.riseSeconds,
                fallSeconds: parameters.fallSeconds,
                pulseWidthSeconds: parameters.pulseWidthSeconds,
                periodSeconds: parameters.periodSeconds,
            }, timeSeconds);
        case 'current-source.pulse':
            return sampleElectricalPulse({
                low: parameters.lowAmps,
                high: parameters.highAmps,
                delaySeconds: parameters.delaySeconds,
                riseSeconds: parameters.riseSeconds,
                fallSeconds: parameters.fallSeconds,
                pulseWidthSeconds: parameters.pulseWidthSeconds,
                periodSeconds: parameters.periodSeconds,
            }, timeSeconds);
        case 'voltage-source.sine':
            return sampleElectricalSine({
                offset: parameters.offsetVolts,
                amplitude: parameters.amplitudeVolts,
                frequencyHz: parameters.frequencyHz,
                phaseDegrees: parameters.phaseDegrees,
                delaySeconds: parameters.delaySeconds,
            }, timeSeconds);
        case 'current-source.sine':
            return sampleElectricalSine({
                offset: parameters.offsetAmps,
                amplitude: parameters.amplitudeAmps,
                frequencyHz: parameters.frequencyHz,
                phaseDegrees: parameters.phaseDegrees,
                delaySeconds: parameters.delaySeconds,
            }, timeSeconds);
        default:
            throw new RangeError('Component ' + String(component.id) + ' is not an electrical source waveform');
    }
}

export function resolveAveragedPwmDuty(component, controls = {}) {
    const controlId = component?.parameters?.controlId;
    const authored = finite(component?.parameters?.dutyCycle, 'PWM dutyCycle');
    const candidate = controlId && Object.hasOwn(controls, controlId)
        ? controls[controlId]
        : Object.hasOwn(controls, component.id)
            ? controls[component.id]
            : authored;
    const duty = finite(candidate, 'PWM control');
    if (duty < 0 || duty > 1) throw new RangeError('PWM control must be in [0, 1]');
    return duty;
}

export default sampleElectricalSource;
