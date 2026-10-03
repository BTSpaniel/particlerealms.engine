// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * KellyLochbaumWaveguide.js — R6 Phase -1 risk spike.
 *
 * Single-delay-per-section digital waveguide vocal tract model (Kelly &
 * Lochbaum 1962 scattering junctions, as described in e.g. Julius O.
 * Smith's "Physical Audio Signal Processing"). N cylindrical tube sections
 * with cross-sectional areas A[0..N-1] give N-1 internal junction
 * reflection coefficients k_i = (A_i - A_{i+1}) / (A_i + A_{i+1}).
 *
 * Boundary conditions:
 *   - Glottal end: source flow is injected with a partial reflection
 *     (`glottalReflection`) of the wave returning from the tract.
 *   - Lip end: an idealized open-end reflection (`lipReflection`, negative)
 *     plus a first-difference "radiation" filter approximating the
 *     differentiating characteristic of lip radiation.
 *
 * All boundary/junction coefficients are kept strictly inside (-1, 1), so
 * the closed-loop lattice is passive/BIBO-stable by construction (no
 * combination of area profile changes can cause unbounded energy growth).
 *
 * Nasal coupling and constriction noise are deliberate simplifications, not
 * a rigorous multi-port (3-way) junction scattering derivation — see
 * createNasalBranch() and step()'s constrictionIndex handling. Phase 2's
 * `NasalTractJunction.js`/`ConstrictionNoise.js` need the rigorous version;
 * this is enough to prove the overall architecture is stable and produces
 * plausible, controllable behavior.
 */

export function reflectionCoefficients(areas) {
    const k = new Float32Array(areas.length - 1);
    for (let i = 0; i < k.length; i++) {
        k[i] = (areas[i] - areas[i + 1]) / (areas[i] + areas[i + 1] + 1e-6);
    }
    return k;
}

export function uniformAreaProfile(numSections, area) {
    return new Float32Array(numSections).fill(area);
}

/** Linearly interpolated area profile through named (position, area) control points, position in [0, 1]. */
export function shapedAreaProfile(numSections, controlPoints) {
    const areas = new Float32Array(numSections);
    for (let i = 0; i < numSections; i++) {
        const pos = i / (numSections - 1);
        let lo = controlPoints[0];
        let hi = controlPoints[controlPoints.length - 1];
        for (let c = 0; c < controlPoints.length - 1; c++) {
            if (pos >= controlPoints[c].pos && pos <= controlPoints[c + 1].pos) {
                lo = controlPoints[c];
                hi = controlPoints[c + 1];
                break;
            }
        }
        const span = hi.pos - lo.pos;
        const t = span > 1e-9 ? (pos - lo.pos) / span : 0;
        areas[i] = lo.area + t * (hi.area - lo.area);
    }
    return areas;
}

export function createVocalTract({ numSections, areas, glottalReflection = 0.85, lipReflection = -0.9 }) {
    if (Math.abs(glottalReflection) >= 1 || Math.abs(lipReflection) >= 1) {
        throw new Error('glottalReflection and lipReflection must have magnitude < 1 for BIBO stability');
    }
    let k = reflectionCoefficients(areas);
    const right = new Float32Array(numSections);
    const left = new Float32Array(numSections);
    let prevOutputRaw = 0;

    /** Recompute junction reflection coefficients for a new area profile (e.g. a moving constriction). */
    function updateAreas(newAreas) {
        k = reflectionCoefficients(newAreas);
    }

    /**
     * Advance one sample.
     * `constrictionIndex`/`constrictionNoiseSample` inject turbulence at a
     * chosen internal junction (frication); `nasalTapIndex` reports the
     * (uncoupled) pressure-like signal at a chosen section for the caller
     * to feed into a separate nasal branch — the main tract is not itself
     * perturbed by the tap (simplification noted above).
     */
    function step(sourceFlow, { constrictionIndex = -1, constrictionNoiseSample = 0, nasalTapIndex = -1 } = {}) {
        const nextRight = new Float32Array(numSections);
        const nextLeft = new Float32Array(numSections);

        for (let i = 0; i < numSections - 1; i++) {
            let incomingRight = right[i];
            const incomingLeft = left[i + 1];
            if (i === constrictionIndex) incomingRight += constrictionNoiseSample;
            const w = k[i] * (incomingRight - incomingLeft);
            nextRight[i + 1] = incomingRight + w;
            nextLeft[i] = incomingLeft + w;
        }

        nextRight[0] = sourceFlow + glottalReflection * left[0];

        const incomingAtLips = right[numSections - 1];
        nextLeft[numSections - 1] = lipReflection * incomingAtLips;
        const outputRaw = (1 + lipReflection) * incomingAtLips;
        const radiated = outputRaw - prevOutputRaw;
        prevOutputRaw = outputRaw;

        const nasalTapSignal = (nasalTapIndex >= 0 && nasalTapIndex < numSections)
            ? right[nasalTapIndex] + left[nasalTapIndex] : 0;

        right.set(nextRight);
        left.set(nextLeft);

        return { radiated, nasalTapSignal };
    }

    return { step, updateAreas, numSections };
}

/** Simplified nasal branch: its own short KL chain, driven by a coupled fraction of an oral-tract tap signal. */
export function createNasalBranch({ numSections, areas, nostrilReflection = -0.9 }) {
    if (Math.abs(nostrilReflection) >= 1) {
        throw new Error('nostrilReflection must have magnitude < 1 for BIBO stability');
    }
    const k = reflectionCoefficients(areas);
    const right = new Float32Array(numSections);
    const left = new Float32Array(numSections);
    let prevOutputRaw = 0;

    function step(inputFlow) {
        const nextRight = new Float32Array(numSections);
        const nextLeft = new Float32Array(numSections);
        for (let i = 0; i < numSections - 1; i++) {
            const incomingRight = right[i];
            const incomingLeft = left[i + 1];
            const w = k[i] * (incomingRight - incomingLeft);
            nextRight[i + 1] = incomingRight + w;
            nextLeft[i] = incomingLeft + w;
        }
        nextRight[0] = inputFlow;
        const incomingAtNostril = right[numSections - 1];
        nextLeft[numSections - 1] = nostrilReflection * incomingAtNostril;
        const outputRaw = (1 + nostrilReflection) * incomingAtNostril;
        const radiated = outputRaw - prevOutputRaw;
        prevOutputRaw = outputRaw;
        right.set(nextRight);
        left.set(nextLeft);
        return radiated;
    }

    return { step };
}
