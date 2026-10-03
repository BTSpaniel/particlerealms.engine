// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * constriction_noise.js — Phase 2 ParticleNN articulatory kernel.
 *
 * Turbulence/frication noise generator for a chosen internal tract
 * junction (fricatives, plosive bursts) — deliberately a SEPARATE kernel
 * from `speech/noise_source.js` rather than reusing it directly, because
 * the two have genuinely different shapes: `noise_source.js` generates one
 * flat, constant-amplitude signal for the whole dispatch (aspiration noise
 * mixed at the glottis, `risk/GlottalSource.js` (R6)'s `aspirationLevel`),
 * while frication noise needs a per-sample, per-instance TIME-VARYING
 * amplitude envelope (driven by how tightly a constriction is formed, which
 * changes continuously as an articulator moves) and per-instance start
 * index/seed so N simultaneous voices/characters never share correlated
 * turbulence. Sharing the same underlying hash rather than inventing a
 * second one is still correct reuse: `noise_at()` below is the identical
 * two-round Murmur-style avalanche hash as `noise_source.js`/
 * `risk/GlottalSource.js`'s `noiseAt` (same technique as
 * `StreamingContinuitySource.js`), just applied per-instance with an
 * amplitude that varies per output sample instead of being a single
 * dispatch-wide uniform scalar.
 *
 * ParticleTract injects this signal at the selected internal junction of
 * `tract_waveguide.js`; the tract geometry, not a phone-specific source
 * equalizer, then supplies the place-dependent acoustic filtering.
 *
 * Four spectral shapes are supported:
 *   - `direct` `noise_at()` (flat/white-ish), the default reference;
 *   - `lowpass` block-interpolated `noise_at()` for glottal aspiration,
 *     giving the noise a predominantly low-frequency, breathy character
 *     rather than a hissy fricative one;
 *   - `derivative` first-differenced `noise_at()` (blue, +6 dB/octave),
 *     retained as an exact diagnostic/parity mode;
 *   - `bandlimited` white noise through a unity-DC Hann-windowed sinc FIR,
 *     with an explicit sample rate and a configurable physical cutoff.
 *     The default 10 kHz cutoff is an engineering bandwidth choice, NOT a
 *     fitted universal frication spectrum or a trained model. Unlike the
 *     derivative it does not disproportionately excite near-Nyquist tract
 *     modes when the physical solver runs at 64 kHz.
 *
 * Shadle (1995) describes broadband/white sources whose strength depends on
 * pressure drop, and Jackson/Shadle (2000) combine coloured source noise
 * with the tract transfer function and radiation. Neither motivates an
 * unbounded blue source for every consonant:
 * https://eprints.soton.ac.uk/250106/
 * https://eprints.soton.ac.uk/253337/
 *
 * The FIR samples the deterministic hash on either side of the absolute
 * index, modulo 2^32. This stationary indexed source needs no mutable FIR
 * history, no zero-padding or chunk warmup, and no audio lookahead. Apply
 * the articulation envelope AFTER filtering, so a zero envelope stays
 * exactly silent and a burst is not delayed or smeared across its boundary.
 */

import { designWindowedSincLowpass } from '../../../streaming/PolyphaseResampler.js';

export const CONSTRICTION_NOISE_ENTRY_POINT = 'main';
export const CONSTRICTION_NOISE_WORKGROUP_SIZE = Object.freeze({ x: 256, y: 1, z: 1 });

export function constrictionNoiseShader({ spectralShape = 'direct', lowpassHold = 32, sampleRate, bandlimitHz = 10000, bandlimitTaps = 65 } = {}) {
    if (!['direct', 'lowpass', 'derivative', 'bandlimited'].includes(spectralShape)) {
        throw new RangeError('constrictionNoiseShader: unknown spectralShape');
    }
    if (spectralShape === 'lowpass' && (!Number.isInteger(lowpassHold) || lowpassHold < 1 || lowpassHold > 1048576)) {
        throw new RangeError('constrictionNoiseShader: lowpassHold must be an integer in [1, 1048576]');
    }
    let bandlimitedHelper = '';
    if (spectralShape === 'bandlimited') {
        if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) {
            throw new RangeError('constrictionNoiseShader: bandlimited noise requires an explicit positive integer sampleRate');
        }
        if (!Number.isFinite(bandlimitHz) || bandlimitHz <= 0 || bandlimitHz >= sampleRate / 2) {
            throw new RangeError('constrictionNoiseShader: bandlimitHz must be finite and strictly between zero and Nyquist');
        }
        if (!Number.isInteger(bandlimitTaps) || bandlimitTaps < 9 || bandlimitTaps > 129 || bandlimitTaps % 2 !== 1) {
            throw new RangeError('constrictionNoiseShader: bandlimitTaps must be an odd integer in [9, 129]');
        }
        const coefficients = designWindowedSincLowpass(bandlimitTaps, bandlimitHz / sampleRate);
        bandlimitedHelper = `
const BANDLIMIT_TAPS: u32 = ${bandlimitTaps}u;
const BANDLIMIT_RADIUS: u32 = ${(bandlimitTaps - 1) / 2}u;
const BANDLIMIT_COEFFICIENTS = array<f32, ${bandlimitTaps}>(
    ${Array.from(coefficients, (value) => `${Math.fround(value).toExponential(9)}f`).join(', ')}
);
fn noise_bandlimited_at(absolute_index: u32, seed: u32) -> f32 {
    var sample = 0.0;
    for (var tap = 0u; tap < BANDLIMIT_TAPS; tap += 1u) {
        sample += BANDLIMIT_COEFFICIENTS[tap] * noise_at(absolute_index + BANDLIMIT_RADIUS - tap, seed);
    }
    return sample;
}
`;
    }
    const derivativeHelper = spectralShape === 'derivative' ? `
fn noise_derivative_at(absolute_index: u32, seed: u32) -> f32 {
    let prev = select(absolute_index - 1u, absolute_index, absolute_index == 0u);
    return noise_at(absolute_index, seed) - noise_at(prev, seed);
}
` : '';
    const lowpassHelper = spectralShape === 'lowpass' ? `
const LOWPASS_HOLD: u32 = ${lowpassHold}u;
fn noise_lowpass_at(absolute_index: u32, seed: u32) -> f32 {
    let block = absolute_index / LOWPASS_HOLD;
    let next = block + 1u;
    let frac = f32(absolute_index % LOWPASS_HOLD) / f32(LOWPASS_HOLD);
    let x0 = noise_at(block, seed);
    let x1 = noise_at(next, seed);
    return x0 + (x1 - x0) * frac;
}
` : '';
    const noiseFn = spectralShape === 'derivative' ? 'noise_derivative_at'
        : spectralShape === 'lowpass' ? 'noise_lowpass_at'
        : spectralShape === 'bandlimited' ? 'noise_bandlimited_at'
        : 'noise_at';
    return /* wgsl */ `
struct Params {
    num_samples: u32,
    num_instances: u32,
    _pad0: u32,
    _pad1: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> seed_per_instance: array<u32>; // [num_instances]
@group(0) @binding(2) var<storage, read> start_index_per_instance: array<u32>; // [num_instances], absolute sample counter at the start of this chunk
@group(0) @binding(3) var<storage, read> amplitude_envelope: array<f32>; // [num_instances, num_samples]
@group(0) @binding(4) var<storage, read_write> noise_out: array<f32>; // [num_instances, num_samples]

fn noise_at(absolute_index: u32, seed: u32) -> f32 {
    var x = absolute_index ^ seed;
    x = (x ^ (x >> 16u)) * 0x45d9f3bu;
    x = (x ^ (x >> 16u)) * 0x45d9f3bu;
    x = x ^ (x >> 16u);
    return (f32(x) / 4294967295.0) * 2.0 - 1.0;
}
${derivativeHelper}${lowpassHelper}${bandlimitedHelper}
@compute @workgroup_size(${CONSTRICTION_NOISE_WORKGROUP_SIZE.x}, 1, 1)
fn ${CONSTRICTION_NOISE_ENTRY_POINT}(@builtin(global_invocation_id) gid: vec3<u32>) {
    let total = params.num_instances * params.num_samples;
    let idx = gid.x;
    if (idx >= total) {
        return;
    }
    let inst = idx / params.num_samples;
    let n = idx % params.num_samples;
    let absolute_index = start_index_per_instance[inst] + n;
    noise_out[idx] = amplitude_envelope[idx] * ${noiseFn}(absolute_index, seed_per_instance[inst]);
}
`;
}

export default constrictionNoiseShader;
