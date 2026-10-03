// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * FormantSolver.js — Phase 3 ParticleVoice articulatory calibration.
 *
 * Measures the resonances a Kelly-Lochbaum area profile actually produces, and
 * inverts that: given target formants, searches for an area profile that hits
 * them.
 *
 * ## Why this exists
 *
 * F1 and F2 are major vowel cues, but their static values do not establish
 * intelligibility. Duration, spectral movement and consonant context also
 * matter: Hillenbrand & Nearey (1999) found contour-preserving resynthesis more
 * accurately identified than flat-formant resynthesis:
 * https://pubmed.ncbi.nlm.nih.gov/10380673/
 * This solver calibrates steady oral resonances; rendered transitions, nasal
 * coupling and listening results must be evaluated separately. An area
 * profile invented from articulatory adjectives ("high", "back", "rounded")
 * produces *some* formants, but nothing forces them to be the RIGHT ones — and
 * if they are wrong, every vowel collapses toward a neutral timbre and the
 * speech is unintelligible no matter how clean the pipeline is. That was the
 * state before this module: `ArticulationHead`'s height/backness → area mapping
 * was plausible but uncalibrated.
 *
 * Defining vowels by their measured formant targets and SOLVING for the
 * geometry inverts the dependency: the targets are citable data (Peterson &
 * Barney 1952 male averages, whose vowel set maps
 * exactly onto `spec/PhonemeSet-v0.md`'s ten monophthongs), and the geometry
 * becomes a derived quantity that stays correct if the section count or sample
 * rate changes.
 *
 * ## The response is measured with the SAME recurrence the GPU runs
 *
 * `impulseResponse()` reimplements `tract_waveguide.js`'s scattering recurrence
 * on the CPU rather than using an analytic transfer function. That is
 * deliberate: an analytic formula would be a second model that could disagree
 * with the kernel, and then a "calibrated" vowel would not actually be
 * calibrated for the thing doing the synthesis. In particular this omits the
 * lip first-difference, matching `ParticleTract`'s `radiation_difference = 0`
 * (its source is already a flow derivative).
 */

import { shapedAreaProfile, reflectionCoefficients } from '../risk/KellyLochbaumWaveguide.js';
import { SPEED_OF_SOUND_M_PER_S, DEFAULT_TRACT_CONFIG } from './ParticleTract.js';

/**
 * Peterson & Barney (1952) male averages, Hz. Their vowel set — heed, hid,
 * head, had, hod, hawed, hood, who'd, hud, heard — is exactly this project's
 * ten monophthongs, so no mapping or interpolation is needed.
 *
 * F3 is carried for `ER` only, where the unusually LOW F3 is the defining
 * rhotic cue; the other entries calibrate F1/F2 without modeling every identity cue.
 */
export const VOWEL_FORMANTS = Object.freeze({
    IY: Object.freeze({ f1: 270, f2: 2290 }),
    IH: Object.freeze({ f1: 390, f2: 1990 }),
    EH: Object.freeze({ f1: 530, f2: 1840 }),
    AE: Object.freeze({ f1: 660, f2: 1720 }),
    AA: Object.freeze({ f1: 730, f2: 1090 }),
    AO: Object.freeze({ f1: 570, f2: 840 }),
    UH: Object.freeze({ f1: 440, f2: 1020 }),
    UW: Object.freeze({ f1: 300, f2: 870 }),
    AH: Object.freeze({ f1: 640, f2: 1190 }),
    // ER's low F3 IS the r-colouring. Without f3Weight the solver ignored it and
    // settled at F3 = 2303 Hz: a neutral mid vowel, heard as a non-rhotic accent.
    ER: Object.freeze({ f1: 490, f2: 1350, f3: 1690, f3Weight: 1.5 }),
});

/**
 * The solved geometry for each vowel, produced by `fitAllVowels()` and baked here
 * so the runtime does not pay for the search (a full grid per vowel takes tens of
 * seconds).
 *
 * `tests/particle-voice/vowel-formants.html` re-verifies this table against the
 * targets cheaply on every run, so it cannot silently go stale if the section
 * count or sample rate changes — the check fails and the table is re-fitted.
 *
 * Fitted at **32 sections / 64 kHz, two constrictions, wall loss included**.
 * Measured F1/F2 vs target, worst case **21 cents** across all ten:
 *
 *   IY 270/2291   IH 390/1989   EH 530/1844   AE 661/1724   AH 640/1190
 *   ER 476/1325   AA 730/1090   AO 569/850    UH 438/1019   UW 300/867
 *
 * (ER was refitted for F3 with a third constriction; see its entry.)
 *
 * Three structural changes got here, none of them tuning:
 *
 *  1. **Doubling the resolution** (16 -> 32 sections, via 32 -> 64 kHz) made a
 *     short front cavity representable, which is what front vowels need. IY's F2
 *     went 1926 -> 2211 Hz on its own.
 *  2. **A second constriction** fixed the back rounded vowels, which a single
 *     narrowing simply could not reach: AO's F2 was 1130 Hz against an 840 Hz
 *     target (513 cents) and no better solution existed anywhere in the search
 *     space, because a low F2 requires a long back cavity AND lip rounding acting
 *     together. Worst error 513 -> 60 cents.
 *  3. **Including WALL LOSS in the calibration**, which improved it again
 *     (60 -> 21 cents). That is not a coincidence: loss gives the formants
 *     realistic bandwidth, and damped peaks are better separated and more
 *     reliably located than the near-singular peaks of a lossless tube. It also
 *     means the fit is now against the same damped tube that renders.
 *
 * Every area respects `MIN_VOWEL_AREA_CM2`, so no vowel is realised with a
 * constriction tight enough to whistle or hiss.
 */
export const VOWEL_AREA_PARAMS = Object.freeze({
    IY: Object.freeze({ backArea: 3.250, constrictionPos: 0.600, constrictionArea: 0.350, constrictionWidth: 0.300, lipArea: 7.600, secondPos: 0.150, secondArea: 3.000, secondWidth: 0.225 }),
    IH: Object.freeze({ backArea: 2.000, constrictionPos: 0.600, constrictionArea: 0.350, constrictionWidth: 0.150, lipArea: 4.400, secondPos: 0.425, secondArea: 1.000, secondWidth: 0.000 }),
    EH: Object.freeze({ backArea: 1.000, constrictionPos: 0.700, constrictionArea: 0.600, constrictionWidth: 0.150, lipArea: 7.200, secondPos: 0.550, secondArea: 0.500, secondWidth: 0.000 }),
    AE: Object.freeze({ backArea: 0.500, constrictionPos: 0.500, constrictionArea: 4.413, constrictionWidth: 0.146, lipArea: 6.000 }),
    AA: Object.freeze({ backArea: 2.000, constrictionPos: 0.200, constrictionArea: 0.350, constrictionWidth: 0.150, lipArea: 5.900, secondPos: 0.337, secondArea: 2.800, secondWidth: 0.107 }),
    AO: Object.freeze({ backArea: 6.250, constrictionPos: 0.200, constrictionArea: 0.350, constrictionWidth: 0.150, lipArea: 4.800, secondPos: 0.350, secondArea: 4.000, secondWidth: 0.120 }),
    UH: Object.freeze({ backArea: 10.250, constrictionPos: 0.200, constrictionArea: 0.600, constrictionWidth: 0.210, lipArea: 4.800, secondPos: 0.650, secondArea: 3.200, secondWidth: 0.300 }),
    UW: Object.freeze({ backArea: 10.250, constrictionPos: 0.200, constrictionArea: 0.350, constrictionWidth: 0.210, lipArea: 1.400, secondPos: 0.600, secondArea: 2.000, secondWidth: 0.300 }),
    AH: Object.freeze({ backArea: 4.000, constrictionPos: 0.200, constrictionArea: 0.600, constrictionWidth: 0.150, lipArea: 5.800, secondPos: 0.356, secondArea: 1.975, secondWidth: 0.151 }),
    // Refit with f3Weight and a third constriction: 476/1325/1749 Hz (was 490/1350/2303).
    ER: Object.freeze({ backArea: 1.000, constrictionPos: 0.900, constrictionArea: 4.600, constrictionWidth: 0.150, lipArea: 0.400, secondPos: 0.750, secondArea: 0.600, secondWidth: 0.120, thirdPos: 0.650, thirdArea: 1.700, thirdWidth: 0.075 }),
});

/**
 * Formant targets for the four approximants, Hz.
 *
 * These are consonants only in their distribution — acoustically /w j r l/ are
 * "vowel-like consonants" (semivowels), and a generic `MANNER_AREA` constriction
 * cannot produce any of them. That is why they were inaudible as themselves:
 * a single 0.85 cm^2 narrowing at a place position yields something vowel-shaped
 * and roughly neutral, so /r/, /l/, /w/ and /y/ all collapsed into the same
 * glide. Treating them like vowels — targets first, geometry solved — is the
 * only way they become distinct.
 *
 * Values from the acoustic-phonetics literature (Espy-Wilson's prevocalic
 * measurements; the Delaware ASEL synthesis tables):
 *   /w/ 250/750   — an "extreme /u/": lower F1 and F2 than the vowel
 *   /r/ 350/1000  — F1/F2 like a central rounded vowel...
 *   /l/ 400/1075  — ...nearly the same F1/F2 as /r/
 *   /y/ 300/2450  — an "extreme /i/"
 *
 * Note the F1/F2 values for /r/ and /l/ are nearly identical. **F3 is what
 * separates them**, almost entirely: /r/'s F3 falls below 2000 Hz (often close to
 * F2, which is its single most salient property), while /l/'s sits at or above
 * 2500 Hz. `f3` is carried here for that reason, and
 * `f3Weight` marks where matching it actually matters — for /r/ and /l/ an F3
 * error is not a refinement, it is the difference between the two phonemes.
 */
export const APPROXIMANT_FORMANTS = Object.freeze({
    W: Object.freeze({ f1: 250, f2: 750, f3: 2500, f3Weight: 0, thirdConstriction: true }),
    R: Object.freeze({ f1: 350, f2: 1000, f3: 1500, f3Weight: 1.5 }),
    L: Object.freeze({ f1: 400, f2: 1075, f3: 2550, f3Weight: 1.5 }),
    Y: Object.freeze({ f1: 300, f2: 2450, f3: 2600, f3Weight: 0 }),
});

/**
 * Solved approximant geometry, same provenance and staleness guard as
 * `VOWEL_AREA_PARAMS`.
 *
 * Fitted at 32 sections / 64 kHz, with the second constriction AND wall loss
 * (both must match `DEFAULT_TRACT_CONFIG`, or this calibrates a different tube
 * than the one that renders). Measured F1/F2/F3 against target:
 *
 *   W 249/852/2113  (250/750/2500)
 *   R 337/1137/1845 (350/1000/1500)
 *   L 398/1075/2556 (400/1075/2550)
 *   Y 299/2402/2688 (300/2450/2600)
 *
 * L is near-exact on all three and Y is within 50 Hz on F1/F2. The decisive
 * property holds: **R's F3 sits at 1845 Hz and L's at 2556 Hz**, a 711 Hz
 * separation, so the one cue that distinguishes /r/ from /l/ genuinely exists.
 * Before calibration both were a generic manner constriction with NO F3 contrast
 * at all — literally the same sound, which is why the user could hear neither.
 *
 * The second constriction is what made this reachable. With a single one, R's F3
 * was 2166 Hz (not rhotic at all), W's F2 was 1091 against 750, and Y's F2 was
 * 1541 against 2450. R's F3 was still ~345 Hz above target at two constrictions.
 *
 * A THIRD constriction then closed most of that gap without a side branch. R's
 * refit places it pharyngeally (pos 0.09), matching the three-constriction
 * articulation of American /r/; W's uses it to lengthen its rounded front
 * cavity (its target sets `thirdConstriction: true`, since W's F3 is not weighted). Measured:
 *
 *   W 250/758/2577  (was 249/852/2113)
 *   R 356/1002/1557 (was 337/1137/1845)
 *
 * R's remaining ~57 Hz F3 excess is where the sublingual cavity would act.
 */
export const APPROXIMANT_AREA_PARAMS = Object.freeze({
    W: Object.freeze({ backArea: 9.500, constrictionPos: 0.200, constrictionArea: 0.350, constrictionWidth: 0.285, lipArea: 0.700, secondPos: 0.562, secondArea: 0.800, secondWidth: 0.300, thirdPos: 0.520, thirdArea: 2.000, thirdWidth: 0.120 }),
    R: Object.freeze({ backArea: 4.188, constrictionPos: 0.900, constrictionArea: 5.150, constrictionWidth: 0.210, lipArea: 0.400, secondPos: 0.750, secondArea: 0.350, secondWidth: 0.050, thirdPos: 0.090, thirdArea: 0.350, thirdWidth: 0.050 }),
    L: Object.freeze({ backArea: 8.000, constrictionPos: 0.200, constrictionArea: 0.350, constrictionWidth: 0.150, lipArea: 7.000, secondPos: 0.675, secondArea: 2.900, secondWidth: 0.250 }),
    Y: Object.freeze({ backArea: 1.750, constrictionPos: 0.600, constrictionArea: 0.350, constrictionWidth: 0.270, lipArea: 8.400, secondPos: 0.250, secondArea: 3.000, secondWidth: 0.150 }),
});

/**
 * Smallest cross-section, in cm^2, a VOWEL is allowed anywhere in the tract.
 *
 * Without this the search is free to buy formant accuracy with impossible
 * geometry: an unconstrained fit put AA's constriction at 0.15 cm^2, which is
 * TIGHTER than `ArticulationHead`'s fricative constant (0.14). Two things are
 * wrong with that. Physically, a channel that narrow generates turbulence at
 * speech airflow rates — it would be a fricative, not a vowel, and a vowel that
 * hisses is not the vowel you asked for. Numerically, the extreme area ratio
 * drives junction reflection coefficients toward +-1, giving absurdly high-Q
 * resonances that ring.
 *
 * 0.35 cm^2 sits just above the turbulence onset region while still allowing the
 * tight constrictions high vowels genuinely need (measured vowel minima run from
 * ~0.3 cm^2 for /i/ upward).
 */
export const MIN_VOWEL_AREA_CM2 = 0.35;

export const DEFAULT_SOLVER_OPTIONS = Object.freeze({
    glottalReflection: 0.85,
    lipReflection: -0.9,
    // Taken from the shipping tract config, NOT restated. This solver calibrates
    // against a CPU model of the real tube, so any parameter that differs between
    // the two means calibrating a tube that is not the one being rendered. Wall
    // loss in particular changes formant BANDWIDTH, which changes which peaks a
    // peak finder can resolve at all.
    wallLoss: DEFAULT_TRACT_CONFIG.wallLoss,
    /**
     * Analysis window in MILLISECONDS, not samples.
     *
     * This was a fixed 1024 samples, which silently broke when the sample rate
     * doubled: the same count became half the DURATION, so the impulse response
     * was truncated mid-ring, its spectrum developed leakage ripple, and the peak
     * finder started reporting ripple as resonances. The uniform-tube sanity
     * check caught it reading F2 = 894 Hz against a theoretical 1500 Hz.
     *
     * Frequency resolution is set by elapsed time, never by sample count, so the
     * parameter has to be a duration. Same failure mode as section-count versus
     * tract-length: a number that looks absolute but is rate-dependent.
     */
    responseMs: 32,
    minHz: 200,
    maxHz: 3400,
    bins: 160,
    minArea: MIN_VOWEL_AREA_CM2,
});

/** @returns {number} Analysis length in samples for `opts` at `sampleRate`. */
function responseSamples(opts, sampleRate) {
    return opts.responseLength ?? Math.round((sampleRate * opts.responseMs) / 1000);
}

/**
 * Impulse response of the lossless KL chain, mirroring
 * `tract_waveguide.js`'s recurrence (and, like `ParticleTract`, WITHOUT the lip
 * first difference).
 */
export function impulseResponse(areas, { glottalReflection, lipReflection, responseLength, wallLoss = 1 }) {
    const n = areas.length;
    const k = reflectionCoefficients(areas);
    const right = new Float64Array(n);
    const left = new Float64Array(n);
    const nextRight = new Float64Array(n);
    const nextLeft = new Float64Array(n);
    const out = new Float64Array(responseLength);

    for (let t = 0; t < responseLength; t++) {
        for (let i = 0; i < n - 1; i++) {
            const incomingRight = right[i];
            const incomingLeft = left[i + 1];
            const w = k[i] * (incomingRight - incomingLeft);
            nextRight[i + 1] = (incomingRight + w) * wallLoss;
            nextLeft[i] = (incomingLeft + w) * wallLoss;
        }
        // Unit impulse at the glottis on the first sample only.
        nextRight[0] = (t === 0 ? 1 : 0) + glottalReflection * left[0];
        const incomingAtLips = right[n - 1];
        nextLeft[n - 1] = lipReflection * incomingAtLips;
        out[t] = (1 + lipReflection) * incomingAtLips;
        right.set(nextRight);
        left.set(nextLeft);
    }
    return out;
}

/** Goertzel-style magnitude at one frequency — cheaper than a full DFT when only a sparse frequency set is needed. */
function magnitudeAt(signal, hz, sampleRate) {
    const w = (2 * Math.PI * hz) / sampleRate;
    const cosW = Math.cos(w);
    const sinW = Math.sin(w);
    let re = 0;
    let im = 0;
    let c = 1;
    let s = 0;
    for (let i = 0; i < signal.length; i++) {
        re += signal[i] * c;
        im += signal[i] * s;
        const nc = c * cosW - s * sinW;
        s = s * cosW + c * sinW;
        c = nc;
    }
    return Math.hypot(re, im);
}

/**
 * Resonance frequencies of an area profile, lowest first.
 * @returns {number[]} Peak frequencies in Hz.
 */
export function findFormants(areas, sampleRate, options = {}) {
    const opts = { ...DEFAULT_SOLVER_OPTIONS, ...options };
    const ir = impulseResponse(areas, { ...opts, responseLength: responseSamples(opts, sampleRate) });

    // Taper only the TAIL of the impulse response.
    //
    // Truncating a still-ringing response leaves a step at the cut, whose spectral
    // leakage is ripple spaced ~1/T apart that a peak finder happily reports as
    // resonances. Removing it at the source beats filtering it out downstream: an
    // earlier attempt widened the peak-dominance window instead, which suppressed
    // the ripple but then also rejected genuine WEAK formants — AO's F2 was
    // skipped entirely and F3 reported in its place, reading 1132 Hz against an
    // 840 Hz target.
    //
    // A symmetric window (Hann) would be wrong here: this is a decaying impulse
    // response, so zeroing the START would discard exactly where the information
    // is. Tapering the last quarter removes the discontinuity and leaves the onset
    // untouched.
    const tail = Math.max(1, Math.floor(ir.length * 0.25));
    for (let i = ir.length - tail; i < ir.length; i++) {
        const t = (ir.length - i) / tail; // 1 -> 0 across the tail
        ir[i] *= 0.5 * (1 - Math.cos(Math.PI * t));
    }

    const { minHz, maxHz, bins } = opts;
    const mags = new Float64Array(bins);
    const freqs = new Float64Array(bins);
    for (let b = 0; b < bins; b++) {
        const hz = minHz + ((maxHz - minHz) * b) / (bins - 1);
        freqs[b] = hz;
        mags[b] = magnitudeAt(ir, hz, sampleRate);
    }

    // With the tail tapered, residual ripple is small, so the dominance window
    // only has to exceed the ripple spacing (~1/T ~ 31 Hz at 32 ms). +-2 bins at
    // 20 Hz/bin is +-40 Hz: wide enough to reject ripple, narrow enough not to
    // swallow a real formant sitting close to its neighbour (AO's F1 and F2 are
    // only 270 Hz apart).
    const HALF_WINDOW = 2;
    const peaks = [];
    const step = freqs[1] - freqs[0];
    for (let b = HALF_WINDOW; b < bins - HALF_WINDOW; b++) {
        let dominant = true;
        for (let j = b - HALF_WINDOW; j <= b + HALF_WINDOW; j++) {
            if (j !== b && mags[j] >= mags[b]) { dominant = false; break; }
        }
        if (!dominant) continue;
        // Parabolic interpolation across the peak bin and its neighbours, so
        // resolution is not limited to the bin spacing.
        const denom = mags[b - 1] - 2 * mags[b] + mags[b + 1];
        const shift = denom !== 0 ? (0.5 * (mags[b - 1] - mags[b + 1])) / denom : 0;
        peaks.push(freqs[b] + shift * step);
    }
    return peaks;
}

/**
 * Build the profile this solver searches over.
 *
 * `constrictionWidth` exists because a single control point is not enough for
 * high front vowels. `shapedAreaProfile` interpolates LINEARLY between control
 * points, so one narrow point produces a smooth V — a tract that tapers and
 * re-widens with no distinct cavities. /i/ needs the opposite: a genuinely SHORT
 * front cavity (F2 = 2290 Hz implies c/(4*F2) ~ 3.7 cm) sharply separated from a
 * long back cavity. Giving the constriction a WIDTH creates that two-cavity
 * structure, and with it F2 values a single point cannot reach (an earlier
 * 3-point version topped out at 1889 Hz against IY's 2290 Hz target, 333 cents
 * low, which made IY and IH nearly identical in F2).
 *
 * A width of 0 degenerates to the original 3-point shape, so the parametrisation
 * strictly extends the old one rather than replacing it.
 */
export function profileFromParams(params, numSections) {
    const { backArea, constrictionPos, constrictionArea, constrictionWidth = 0, lipArea } = params;
    const points = [{ pos: 0, area: backArea }];

    const addSpan = (pos, area, width) => {
        if (!Number.isFinite(pos) || !Number.isFinite(area)) return;
        const half = Math.max(0, width ?? 0) / 2;
        const start = Math.max(0.02, pos - half);
        const end = Math.min(0.98, pos + half);
        points.push({ pos: start, area });
        if (end > start) points.push({ pos: end, area });
    };

    addSpan(constrictionPos, constrictionArea, constrictionWidth);
    // The SECOND constriction. Optional, so every profile fitted before it
    // existed still builds identically.
    addSpan(params.secondPos, params.secondArea, params.secondWidth);
    // The optional THIRD constriction (rhotics). Absent in every older profile.
    addSpan(params.thirdPos, params.thirdArea, params.thirdWidth);

    points.push({ pos: 1, area: lipArea });
    points.sort((a, b) => a.pos - b.pos);

    // Two spans can land on the same position; the TIGHTER one wins, since a
    // constriction is a physical obstruction and cannot be undone by a wider
    // control point sitting at the same place.
    const merged = [];
    for (const pt of points) {
        const last = merged[merged.length - 1];
        if (last && Math.abs(last.pos - pt.pos) < 1e-6) last.area = Math.min(last.area, pt.area);
        else merged.push({ pos: pt.pos, area: pt.area });
    }
    return shapedAreaProfile(numSections, merged);
}

const SEARCH_GRID = Object.freeze({
    backArea: [0.5, 1.0, 2.0, 4.0, 8.0],
    // Extends to 0.9 because high FRONT sounds (IY, Y) need a very short front
    // cavity, and F2 = c/(4*frontLength) means the constriction has to sit close
    // to the lips to reach 2300-2500 Hz. A grid stopping at 0.8 does not bracket
    // that basin at all, and since this search is coarse-then-refine, coordinate
    // descent cannot escape into it afterwards: at 32 sections Y settled for
    // F2 = 1541 Hz against a 2450 Hz target purely because the right region was
    // never sampled.
    constrictionPos: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9],
    constrictionArea: [0.35, 0.6, 1.0, 1.8, 3.0, 4.5],
    lipArea: [0.4, 0.8, 1.5, 3.0, 6.0],
    constrictionWidth: [0.0, 0.15, 0.3],
});

const AREA_KEYS = Object.freeze(['backArea', 'constrictionArea', 'lipArea', 'secondArea', 'thirdArea']);

/** True when every area in `params` respects `minArea`. Areas are what must be constrained; position is free. Absent (optional) areas pass. */
function areasPlausible(params, minArea) {
    return AREA_KEYS.every((key) => params[key] === undefined || params[key] >= minArea);
}

/**
 * Grid for the SECOND constriction, searched after the first is placed.
 *
 * Some phonemes are physically double-constriction sounds and a single narrowing
 * cannot produce them at all:
 *
 *  - the RHOTIC /r/: the MRI literature is explicit that a palatal constriction
 *    decouples the back cavity (which yields F2) from the front cavity plus
 *    sublingual space (which yields the LOW F3 that defines the phoneme). With one
 *    constriction the fit reached F3 = 2166 Hz against a 1500 Hz target, i.e. it
 *    had lost the single most salient property of the sound.
 *  - **back rounded vowels** (AO, UH, UW): a low F2 needs a long back cavity AND
 *    lip rounding acting together. One constriction plus one lip area could not
 *    do it, leaving F2 200-500 cents high.
 *
 * This mirrors Pink Trombone's split between a tongue-BODY posture and a
 * tongue-TIP constriction, which is how it reaches these sounds.
 */
const SECOND_GRID = Object.freeze({
    secondPos: [0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85],
    secondArea: [0.35, 0.6, 1.0, 1.8, 3.0],
    secondWidth: [0.0, 0.12, 0.25],
});

/**
 * Grid for an optional THIRD constriction, searched only where F3 is decisive
 * (`f3Weight > 0`) or when `options.thirdConstriction` asks for it.
 *
 * American English /r/ and /ɝ/ are made with three simultaneous narrowings —
 * pharyngeal, palatal and labial — and those sit near the velocity maxima of
 * the third resonance, which is why together they pull F3 down to ~1500-1700 Hz
 * (Delattre & Freeman 1968; Espy-Wilson et al. 2000, JASA, "Acoustic modeling
 * of American English /r/"). Two constrictions left R's F3 at
 * 1845 Hz and ER's at 2303 Hz. The pharyngeal region is what the second stage
 * never occupied for these sounds, so the grid favours it but spans the tract.
 * The sublingual side cavity is still not representable in a 1-D tube.
 */
const THIRD_GRID = Object.freeze({
    thirdPos: [0.1, 0.18, 0.26, 0.34, 0.45, 0.55, 0.65],
    thirdArea: [0.35, 0.6, 1.0, 1.8],
    thirdWidth: [0.0, 0.12, 0.25],
});

/**
 * Search for an area profile whose first two resonances match `target`.
 *
 * Error is measured in the LOG-frequency domain, because formant perception is
 * roughly logarithmic: being 100 Hz off matters far more at F1 = 270 than at
 * F2 = 2290, and a linear error would happily sacrifice F1 accuracy to shave a
 * little off F2.
 *
 * Exhaustive over a coarse grid, then a local refinement pass. Exhaustive
 * rather than gradient-based on purpose: the map from geometry to formants is
 * non-monotonic (moving a constriction can swap which cavity dominates F2), so
 * a descent method lands in whichever basin it started in.
 */
export function fitVowelAreas(target, numSections, sampleRate, options = {}) {
    const opts = { ...DEFAULT_SOLVER_OPTIONS, ...options };
    const score = (params) => {
        const areas = profileFromParams(params, numSections);
        const peaks = findFormants(areas, sampleRate, opts);
        if (peaks.length < 2) return { error: Infinity, peaks };
        const e1 = Math.log(peaks[0] / target.f1);
        const e2 = Math.log(peaks[1] / target.f2);
        // F1 weighted slightly higher: it carries vowel height, and height
        // errors are the ones that collapse distinct vowels together.
        let error = 1.3 * e1 * e1 + e2 * e2;
        // F3 only enters the objective where it is phonemically decisive, which
        // `f3Weight` marks. For /r/ versus /l/ the F1/F2 targets are nearly
        // identical and F3 IS the contrast, so ignoring it would let the solver
        // return two indistinguishable profiles that both "pass". For vowels it
        // is left out so the search is not pulled away from F1/F2, which is what
        // actually carries their identity.
        if (target.f3Weight > 0 && target.f3) {
            if (peaks.length < 3) return { error: Infinity, peaks };
            const e3 = Math.log(peaks[2] / target.f3);
            error += target.f3Weight * e3 * e3;
        }
        return { error, peaks };
    };

    let best = null;
    for (const backArea of SEARCH_GRID.backArea) {
        for (const constrictionPos of SEARCH_GRID.constrictionPos) {
            for (const constrictionArea of SEARCH_GRID.constrictionArea) {
                for (const lipArea of SEARCH_GRID.lipArea) {
                    for (const constrictionWidth of SEARCH_GRID.constrictionWidth) {
                        const params = { backArea, constrictionPos, constrictionArea, lipArea, constrictionWidth };
                        if (!areasPlausible(params, opts.minArea)) continue;
                        const { error, peaks } = score(params);
                        if (!best || error < best.error) best = { params, error, peaks };
                    }
                }
            }
        }
    }
    if (!best) throw new Error('FormantSolver: no candidate satisfied the minimum-area constraint');

    // Stage 2: place a SECOND constriction on top of the winner. Searched
    // separately rather than as part of one huge product grid, which would be
    // ~200x larger; the first constriction's placement is a good enough base that
    // the joint refinement below can clean up the interaction.
    for (const secondPos of SECOND_GRID.secondPos) {
        for (const secondArea of SECOND_GRID.secondArea) {
            for (const secondWidth of SECOND_GRID.secondWidth) {
                const params = { ...best.params, secondPos, secondArea, secondWidth };
                if (!areasPlausible(params, opts.minArea)) continue;
                const { error, peaks } = score(params);
                if (error < best.error) best = { params, error, peaks };
            }
        }
    }

    // Stage 3 (rhotics): a third constriction, adopted only if it lowers the error.
    if (target.f3Weight > 0 || target.thirdConstriction || opts.thirdConstriction) {
        const base = best.params;
        for (const thirdPos of THIRD_GRID.thirdPos) {
            for (const thirdArea of THIRD_GRID.thirdArea) {
                for (const thirdWidth of THIRD_GRID.thirdWidth) {
                    const params = { ...base, thirdPos, thirdArea, thirdWidth };
                    if (!areasPlausible(params, opts.minArea)) continue;
                    const { error, peaks } = score(params);
                    if (error < best.error) best = { params, error, peaks };
                }
            }
        }
    }

    // Local refinement: shrink steps around the winner, now over every constriction.
    let step = {
        backArea: 0.75, constrictionPos: 0.05, constrictionArea: 0.2, lipArea: 0.4, constrictionWidth: 0.06,
        secondPos: 0.05, secondArea: 0.2, secondWidth: 0.05, thirdPos: 0.04, thirdArea: 0.2, thirdWidth: 0.05,
    };
    for (let pass = 0; pass < 6; pass++) {
        let improved = false;
        for (const key of ['backArea', 'constrictionPos', 'constrictionArea', 'lipArea', 'constrictionWidth', 'secondPos', 'secondArea', 'secondWidth', 'thirdPos', 'thirdArea', 'thirdWidth']) {
            if (best.params[key] === undefined) continue;
            for (const dir of [-1, 1]) {
                const candidate = { ...best.params, [key]: best.params[key] + dir * step[key] };
                if (candidate.constrictionPos <= 0.05 || candidate.constrictionPos >= 0.95) continue;
                if (candidate.constrictionWidth < 0 || candidate.constrictionWidth > 0.6) continue;
                if (candidate.secondPos !== undefined && (candidate.secondPos <= 0.05 || candidate.secondPos >= 0.95)) continue;
                if (candidate.secondWidth !== undefined && (candidate.secondWidth < 0 || candidate.secondWidth > 0.6)) continue;
                if (candidate.thirdPos !== undefined && (candidate.thirdPos <= 0.05 || candidate.thirdPos >= 0.95)) continue;
                if (candidate.thirdWidth !== undefined && (candidate.thirdWidth < 0 || candidate.thirdWidth > 0.6)) continue;
                // The refinement must respect the same constraint as the grid, or
                // it walks straight back into the unphysical region the grid was
                // filtered to exclude.
                if (!areasPlausible(candidate, opts.minArea)) continue;
                const { error, peaks } = score(candidate);
                if (error < best.error) {
                    best = { params: candidate, error, peaks };
                    improved = true;
                }
            }
        }
        if (!improved) {
            for (const key of Object.keys(step)) step[key] *= 0.5;
        }
    }

    return {
        params: best.params,
        areas: profileFromParams(best.params, numSections),
        achieved: { f1: best.peaks[0], f2: best.peaks[1], f3: best.peaks[2] ?? null },
        error: best.error,
    };
}

/** Fit every entry in a formant-target table. Slow (a full grid per entry) — intended for a calibration tool/test, not a hot path. */
export function fitTargets(targets, numSections, sampleRate, options = {}) {
    const out = {};
    for (const [symbol, target] of Object.entries(targets)) {
        out[symbol] = { target, ...fitVowelAreas(target, numSections, sampleRate, options) };
    }
    return out;
}

export function fitAllVowels(numSections, sampleRate, options = {}) {
    return fitTargets(VOWEL_FORMANTS, numSections, sampleRate, options);
}

export function fitAllApproximants(numSections, sampleRate, options = {}) {
    return fitTargets(APPROXIMANT_FORMANTS, numSections, sampleRate, options);
}

/** The tract length a section count represents, for reporting alongside a fit. */
export function tractLengthFor(numSections, sampleRate) {
    return (numSections * SPEED_OF_SOUND_M_PER_S) / sampleRate;
}

export default fitVowelAreas;
