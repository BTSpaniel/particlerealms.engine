// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * glottal_lf.js — Phase 2 ParticleNN articulatory kernel.
 *
 * The full Liljencrants-Fant (LF) glottal flow DERIVATIVE model, replacing
 * `speech/harmonic_source.js`'s raised-cosine "LF-lite" stand-in
 * (`risk/GlottalSource.js` (R6)'s own docstring calls that shape a
 * deliberate simplification and names `articulatory/glottal_lf.js` as the
 * real implementation it stands in for).
 *
 * Per period, given control instants Te (glottal closure / main excitation,
 * 0 < Te < T0), Tp (peak-flow instant, 0 < Tp < Te), Ta (return-phase time
 * constant), and Ee (excitation strength), the classic two-segment LF
 * waveform is:
 *
 *   E(t) = E0 * exp(alpha*t) * sin(wg*t)                            0<=t<Te
 *   E(t) = -(Ee/(eps*Ta)) * (exp(-eps*(t-Te)) - exp(-eps*(T0-Te)))  Te<=t<T0
 *
 * with `wg = pi/Tp`. `E0`, `alpha`, and `eps` are NOT free parameters —
 * they are pinned by three physical constraints this file's author derived
 * and verified algebraically (rather than recalling a textbook formula from
 * memory, to avoid presenting an unverified transcendental equation as
 * fact):
 *
 *   1. Boundary match at Te: E(Te-) = -Ee, giving
 *      `E0 = -Ee / (exp(alpha*Te) * sin(wg*Te))`.
 *   2. `eps` solves `eps*Ta = 1 - exp(-eps*(T0-Te))` (the standard LF
 *      return-phase time-constant equation) via Newton-Raphson with the
 *      exact analytic derivative `f(eps)=eps*Ta-1+exp(-eps*(T0-Te))`,
 *      `f'(eps)=Ta-(T0-Te)*exp(-eps*(T0-Te))`, started at `eps0=1/Ta`.
 *   3. `alpha` solves the area-balance constraint (glottal flow is
 *      periodic, so its derivative integrates to zero over one full
 *      period): substituting constraint 1 into the closed-form
 *      `int[0,Te] E0*exp(alpha*t)*sin(wg*t) dt` (standard
 *      `exp(at)sin(bt)` antiderivative) and the closed-form return-phase
 *      integral (simplified using constraint 2) gives
 *      `Area(alpha) = -Ee/sin(wg*Te) * N(alpha)/D(alpha)` where
 *      `N(alpha) = alpha*sin(wg*Te) - wg*cos(wg*Te) + wg*exp(-alpha*Te)`
 *      and `D(alpha) = alpha^2 + wg^2`; this is solved for
 *      `Area(alpha) = Ee/eps - Ee*(T0-Te)*exp(-eps*(T0-Te))/(eps*Ta)` via
 *      Newton-Raphson using the exact analytic derivative of `N/D`
 *      (quotient rule from `N'(alpha) = sin(wg*Te) - wg*Te*exp(-alpha*Te)`,
 *      `D'(alpha) = 2*alpha`), started at `alpha0 = 0` (a safe, singularity-
 *      free starting point: `D(0) = wg^2 != 0`).
 *
 * Both Newton solves run for a fixed, generous iteration count (8 each) —
 * cheap scalar math, and every thread in this kernel redoes the same
 * per-instance solve redundantly rather than solving once and broadcasting
 * through workgroup memory: unlike `tract_waveguide.js`'s per-sample
 * recurrence, LF generation has NO cross-sample dependency at all (like
 * `harmonic_source.js`/`noise_source.js`), so the simplest correct design
 * is one thread per (instance, sample) output element, matching those
 * kernels' flat-parallel convention exactly. If per-period solve cost ever
 * matters at scale, hoisting it into its own once-per-instance kernel
 * (mirroring `tract_transfer.js`'s role for `tract_waveguide.js`) is a
 * straightforward follow-up, not a design change.
 *
 * Every control instant is expressed in SAMPLES (not seconds), matching
 * `harmonic_source.js`'s `period_samples`/`open_samples`/`start_phase`
 * convention and this kernel's own absolute-sample-counter continuity
 * requirement across chunk boundaries.
 */

export const GLOTTAL_LF_ENTRY_POINT = 'main';
export const GLOTTAL_LF_WORKGROUP_SIZE = Object.freeze({ x: 256, y: 1, z: 1 });
export const GLOTTAL_LF_NEWTON_ITERATIONS = 8;

/**
 * CPU-side reference implementation of the exact same closed-form/Newton-
 * Raphson math the WGSL kernel below runs — used by the parity test and
 * documented here as the canonical derivation any future GPU-side
 * per-instance solve kernel (see docstring) must also match bit-for-bit in
 * structure (same iteration count, same starting values).
 */
export function solveLfShapeParameters({ t0, te, tp, ta, ee }) {
    const wg = Math.PI / tp;
    const sinWgTe = Math.sin(wg * te);
    const cosWgTe = Math.cos(wg * te);
    const tail = t0 - te;

    let eps = 1 / ta;
    for (let i = 0; i < GLOTTAL_LF_NEWTON_ITERATIONS; i++) {
        const expTerm = Math.exp(-eps * tail);
        const f = eps * ta - 1 + expTerm;
        const fPrime = ta - tail * expTerm;
        eps = eps - f / fPrime;
    }

    // int[Te,Tc] E dt = -(Ee/(eps*Ta)) * (Ta - tail*exp(-eps*tail))
    //                 = -Ee/eps + Ee*tail*exp(-eps*tail)/(eps*Ta)
    // (an earlier draft of this derivation dropped the 1/eps factor on the
    // first term, i.e. wrote "-Ee" instead of "-Ee/eps" — caught by
    // `tests/particle-voice/phase2-dsp.html`'s full-period area-balance
    // self-check against direct numerical integration, not by GPU/CPU
    // parity alone, since the WGSL kernel faithfully reproduced the same
    // mistake). area_target = -int[Te,Tc] E dt, per the area-balance
    // constraint int[0,Te] E dt + int[Te,Tc] E dt = 0.
    const areaTarget = ee / eps - (ee * tail * Math.exp(-eps * tail)) / (eps * ta);

    let alpha = 0;
    for (let i = 0; i < GLOTTAL_LF_NEWTON_ITERATIONS; i++) {
        const expNegAlphaTe = Math.exp(-alpha * te);
        const n = alpha * sinWgTe - wg * cosWgTe + wg * expNegAlphaTe;
        const d = alpha * alpha + wg * wg;
        const area = (-ee / sinWgTe) * (n / d);

        const nPrime = sinWgTe - wg * te * expNegAlphaTe;
        const dPrime = 2 * alpha;
        const areaPrime = (-ee / sinWgTe) * ((nPrime * d - n * dPrime) / (d * d));

        alpha = alpha - (area - areaTarget) / areaPrime;
    }

    const e0 = -ee / (Math.exp(alpha * te) * sinWgTe);
    return { wg, eps, alpha, e0 };
}

/** CPU-side reference for a single sample's LF value, given already-solved shape parameters — matches the WGSL kernel's per-sample branch exactly. */
export function evaluateLfSample(cyclePos, { t0, te, ta, ee, wg, eps, alpha, e0 }) {
    if (cyclePos < te) {
        return e0 * Math.exp(alpha * cyclePos) * Math.sin(wg * cyclePos);
    }
    return -(ee / (eps * ta)) * (Math.exp(-eps * (cyclePos - te)) - Math.exp(-eps * (t0 - te)));
}

/**
 * The standalone kernel keeps one Ee per instance. ParticleTract opts into
 * [previous, target] pairs so its already-smoothed excitation does not acquire
 * a second, chunk-rate staircase. Only LF amplitude is interpolated; pulse
 * phase, shape and the independently generated aspiration remain unchanged.
 * Connected source gestures: Fant & Kruckenberg (1996),
 * https://www.isca-archive.org/spm_1996/fant96_spm.html
 */
export function glottalLfShader({ interpolateExcitation = false } = {}) {
    return /* wgsl */ `
struct Params {
    num_samples: u32,
    num_instances: u32,
    _pad0: u32,
    _pad1: u32,
};

const PI: f32 = 3.14159265358979323846;
const NEWTON_ITERATIONS: u32 = ${GLOTTAL_LF_NEWTON_ITERATIONS}u;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> t0_samples: array<f32>; // [num_instances]
@group(0) @binding(2) var<storage, read> te_samples: array<f32>; // [num_instances]
@group(0) @binding(3) var<storage, read> tp_samples: array<f32>; // [num_instances]
@group(0) @binding(4) var<storage, read> ta_samples: array<f32>; // [num_instances]
@group(0) @binding(5) var<storage, read> ee_values: array<f32>; // ${interpolateExcitation ? '[num_instances, previous/target]' : '[num_instances]'}
@group(0) @binding(6) var<storage, read> start_phase: array<f32>; // [num_instances], absolute sample counter
@group(0) @binding(7) var<storage, read_write> output_data: array<f32>; // [num_instances, num_samples]

@compute @workgroup_size(${GLOTTAL_LF_WORKGROUP_SIZE.x}, 1, 1)
fn ${GLOTTAL_LF_ENTRY_POINT}(@builtin(global_invocation_id) gid: vec3<u32>) {
    let total = params.num_instances * params.num_samples;
    let idx = gid.x;
    if (idx >= total) {
        return;
    }
    let inst = idx / params.num_samples;
    let n = idx % params.num_samples;

    let t0 = t0_samples[inst];
    let te = te_samples[inst];
    let tp = tp_samples[inst];
    let ta = ta_samples[inst];
    let ee = ee_values[${interpolateExcitation ? 'inst * 2u + 1u' : 'inst'}];
    ${interpolateExcitation ? 'let previous_ee = ee_values[inst * 2u];' : ''}

    let wg = PI / tp;
    let sin_wg_te = sin(wg * te);
    let cos_wg_te = cos(wg * te);
    let tail = t0 - te;

    var eps: f32 = 1.0 / ta;
    var i: u32 = 0u;
    loop {
        if (i >= NEWTON_ITERATIONS) { break; }
        let expTerm = exp(-eps * tail);
        let f = eps * ta - 1.0 + expTerm;
        let fPrime = ta - tail * expTerm;
        eps = eps - f / fPrime;
        i = i + 1u;
    }

    let area_target = ee / eps - (ee * tail * exp(-eps * tail)) / (eps * ta);

    var alpha: f32 = 0.0;
    i = 0u;
    loop {
        if (i >= NEWTON_ITERATIONS) { break; }
        let expNegAlphaTe = exp(-alpha * te);
        let nn = alpha * sin_wg_te - wg * cos_wg_te + wg * expNegAlphaTe;
        let dd = alpha * alpha + wg * wg;
        let area = (-ee / sin_wg_te) * (nn / dd);

        let nPrime = sin_wg_te - wg * te * expNegAlphaTe;
        let dPrime = 2.0 * alpha;
        let areaPrime = (-ee / sin_wg_te) * ((nPrime * dd - nn * dPrime) / (dd * dd));

        alpha = alpha - (area - area_target) / areaPrime;
        i = i + 1u;
    }

    let e0 = -ee / (exp(alpha * te) * sin_wg_te);

    let abs_idx = start_phase[inst] + f32(n);
    let cycle_pos = abs_idx - t0 * floor(abs_idx / t0);

    var value: f32;
    if (cycle_pos < te) {
        value = e0 * exp(alpha * cycle_pos) * sin(wg * cycle_pos);
    } else {
        value = -(ee / (eps * ta)) * (exp(-eps * (cycle_pos - te)) - exp(-eps * (t0 - te)));
    }
    ${interpolateExcitation ? `// Preserve the exact target sample and steady-state source arithmetic.
    // The first sample uses the preceding chunk's exact final excitation.
    var excitation_gain = 1.0;
    if (previous_ee != ee && n + 1u < params.num_samples) {
        let fraction = f32(n) / f32(max(1u, params.num_samples - 1u));
        excitation_gain = (previous_ee + (ee - previous_ee) * fraction) / ee;
    }
    output_data[idx] = value * excitation_gain;` : 'output_data[idx] = value;'}
}
`;
}

export default glottalLfShader;
