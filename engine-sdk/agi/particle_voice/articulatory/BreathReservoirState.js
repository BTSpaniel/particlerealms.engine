// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * BreathReservoirState.js — Phase 2 Voice Box state schema (`v0`).
 *
 * "Lung pressure, compliance, target subglottal pressure" per
 * `ARCHITECTURE.md` §4 — the JS-side state container wrapping
 * `nn/kernels/articulatory/breath_reservoir.js`'s per-instance recurrence
 * (`pressure[n] = pressure[n-1] + (target[n] - pressure[n-1]) * lagRate`,
 * proven against `risk/BreathReservoir.js` (R6A)). This module owns the
 * `lagRate` derivation from `compliance`/`sampleRate` (the caller-computed
 * value that kernel's docstring says it expects pre-computed, not
 * recomputed in-shader) and the timestamped state container the kernel's
 * `initial_pressure`/`pressure_out` buffers round-trip through across
 * chunks — it does not itself dispatch the kernel (that is
 * `ParticleTract.js`'s job once a real model exists to drive it).
 */

/** `lagRate = 1 - exp(-1/(compliance*sampleRate))` — matches `risk/BreathReservoir.js` (R6A)'s proven formula exactly; `breath_reservoir.js`'s own docstring requires this be computed by the caller, not the kernel. */
export function lagRateFromCompliance(compliance, sampleRate) {
    if (typeof compliance !== 'number' || compliance <= 0) throw new RangeError('compliance must be a positive number');
    if (typeof sampleRate !== 'number' || sampleRate <= 0) throw new RangeError('sampleRate must be a positive number');
    return 1 - Math.exp(-1 / (compliance * sampleRate));
}

/** @returns {object} A validated, timestamped `BreathReservoirState` for one instance. */
export function createBreathReservoirState({ sampleIndex, pressure, compliance, targetSubglottalPressure }) {
    if (!Number.isInteger(sampleIndex) || sampleIndex < 0) throw new TypeError('BreathReservoirState.sampleIndex must be a non-negative integer absolute sample counter');
    if (typeof pressure !== 'number' || !Number.isFinite(pressure) || pressure < 0) throw new TypeError('BreathReservoirState.pressure must be a non-negative finite number');
    if (typeof compliance !== 'number' || compliance <= 0) throw new RangeError('BreathReservoirState.compliance must be a positive number');
    if (typeof targetSubglottalPressure !== 'number' || !Number.isFinite(targetSubglottalPressure) || targetSubglottalPressure < 0) {
        throw new TypeError('BreathReservoirState.targetSubglottalPressure must be a non-negative finite number');
    }
    return Object.freeze({ sampleIndex, pressure, compliance, targetSubglottalPressure });
}

/** Advance one `BreathReservoirState` by one sample using the exact same recurrence `breath_reservoir.js`/`risk/BreathReservoir.js` implement — the CPU-side single-sample equivalent, useful for tests and for any non-GPU fallback path, not a replacement for the GPU kernel's chunked dispatch. */
export function stepBreathReservoirState(state, sampleRate) {
    const lagRate = lagRateFromCompliance(state.compliance, sampleRate);
    const pressure = state.pressure + (state.targetSubglottalPressure - state.pressure) * lagRate;
    return createBreathReservoirState({ sampleIndex: state.sampleIndex + 1, pressure, compliance: state.compliance, targetSubglottalPressure: state.targetSubglottalPressure });
}

export default createBreathReservoirState;
