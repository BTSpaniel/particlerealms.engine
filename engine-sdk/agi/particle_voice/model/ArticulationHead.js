// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ArticulationHead.js — Phase 3 ParticleVoice model.
 *
 * Per-frame streams → `NeuralPhysiologyState` (`articulatory/NeuralPhysiologyState.js`):
 * the four control heads plus uncertainty that `ParticleTract` actually
 * consumes. This is where `spec/PhonemeSet-v0.md` §2's articulatory feature
 * vectors finally reach the vocal tract — place becomes a constriction
 * position, manner becomes a constriction degree, height/backness/rounded
 * become a vowel area profile.
 *
 * ## Rule-based, mapping features to geometry
 *
 * Like `ProsodyPlanner`, this is a deterministic feature→geometry mapping, not
 * a trained head. `spec/PhonemeSet-v0.md` §6 flags consonant place positions as
 * provisional estimates rather than MRI measurements. Production monophthong
 * and approximant profiles are now solved by `FormantSolver` against authored
 * F1/F2 (and approximant F3) targets; the earlier 3-control-point
 * height/backness mapping remains only as a safe fallback for a future
 * uncalibrated symbol. Matching acoustic targets still does not make the coarse
 * tube an MRI-derived anatomy, so its geometry remains an explicit acoustic
 * approximation rather than a measured vocal tract.
 *
 * ## Two constraints that are NOT stylistic
 *
 *  1. **`ee` must be strictly positive, even when unvoiced.** It is tempting
 *     to set the glottal excitation to 0 on a voiceless frame. That breaks
 *     `glottal_lf.js`: its Newton solve for `alpha` computes
 *     `areaPrime = (-ee / sin(wg*te)) * (...)`, so `ee = 0` makes the
 *     derivative exactly 0 and the update `alpha -= (area - target) / 0`
 *     evaluates to **NaN**, which then propagates through the whole waveguide.
 *     `NeuralPhysiologyState`'s own validator independently requires
 *     `ee > 0`. Voiceless frames therefore use a small positive
 *     `UNVOICED_EE` — inaudible, but numerically safe.
 *  2. **Areas are SMOOTHED across frames, per-manner.** Snapping the area
 *     profile to a new target at a phoneme boundary is a step change in the
 *     waveguide's reflection coefficients, which radiates as a click — the
 *     precise artifact Phase 2's exit gate spent effort eliminating. Each
 *     manner gets its own time constant because the right smoothing speed is
 *     phonetically real, not a tuning knob: a stop's closure and release ARE
 *     fast (smearing them destroys the plosive), while a vowel-to-vowel
 *     transition is genuinely slow. A single global constant would either
 *     smear plosives or click on vowels.
 *
 * ## Output shape
 *
 * `predict()` returns COMPACT typed arrays (one row per frame), not an array
 * of frozen `NeuralPhysiologyState` objects: a few seconds of speech is
 * hundreds of frames, and materializing hundreds of frozen nested objects per
 * utterance would be wasteful when the consumer reads them once, in order.
 * `physiologyStateAt(result, frame)` builds the real validated schema object
 * on demand, so the schema is genuinely exercised (and validated) rather than
 * bypassed.
 */

import { shapedAreaProfile } from '../risk/KellyLochbaumWaveguide.js';
import {
    MANNER, HEIGHT, BACKNESS, PLACE, PLACE_POSITION, STRESS,
    phonemeAt, isStructural, diphthongTargetIds, constrictionPositionOf,
} from '../frontend/PhonemeSet.js';
import { createNeuralPhysiologyState } from '../articulatory/NeuralPhysiologyState.js';
import { DEFAULT_TRACT_CONFIG } from '../articulatory/ParticleTract.js';
import { VOWEL_AREA_PARAMS, APPROXIMANT_AREA_PARAMS, profileFromParams } from '../articulatory/FormantSolver.js';

/**
 * Small but strictly positive glottal excitation for voiceless frames. See
 * constraint 1 in the header: 0 would make `glottal_lf.js`'s Newton solve
 * produce NaN.
 */
export const UNVOICED_EE = 1e-3;

// Acoustic calibration for this coarse tube, not an anatomical place constant.
// The provisional alveolar .65 profile put S/Z's strongest noise resonance at
// 2.5 kHz and 20% of its power below 3 kHz. This shorter anterior cavity puts
// that resonance around 5.7 kHz, without changing source gain.
// Front-cavity resonance and its low-frequency valley are sibilant cues; see
// Shadle et al. (2023), https://pmc.ncbi.nlm.nih.gov/articles/PMC10540850/.
// Postalveolars use a longer anterior cavity and a jet striking the incisors,
// rather than a source at the tongue-channel exit. The authored .65/.90 pair
// realizes a 2.5 kHz noise resonance with the existing source amplitude.
// Toda et al. (2002) distinguish protrusion/cavity effects from lip narrowing:
// https://www.isca-archive.org/icslp_2002/toda02_icslp.pdf.
// These are acoustic model calibrations; linguistic PLACE_POSITION is intact.
export const SIBILANT_CONSTRICTION_POSITION = Object.freeze({ S: 0.84, Z: 0.84, SH: 0.65, ZH: 0.65, CH: 0.65, JH: 0.65 });
export const POSTALVEOLAR_NOISE_OBSTACLE_POSITION = 0.90;
// The provisional .65 stop site lay inside IY's tongue-body constriction,
// attenuating T/D's rendered burst by about 13 dB relative to P/B. A separate
// anterior tongue-tip closure preserves its high-frequency release across
// IY/AA/UW. This is an authored acoustic calibration, not measured anatomy.
// Relative burst/vowel energy matters as well as peak location:
// https://pmc.ncbi.nlm.nih.gov/articles/PMC3076800/
export const STOP_CONSTRICTION_POSITION = Object.freeze({ T: 0.84, D: 0.84 });
// NG must close the oral branch downstream of the velopharyngeal junction.
// The former .30 profile closed the pharyngeal inlet to BOTH outlets. With
// reciprocal nasal loading it suppressed the nasal murmur by ~15 dB. This
// authored .50 calibration restores a low nasal pole while staying posterior
// to N's .65 closure; it is not a change to the linguistic place inventory.
const VELAR_NASAL_CLOSURE_POSITION = 0.50;

/**
 * Fallback constriction position (0 = glottis, 1 = lips) by vowel backness, and
 * cross-section by height.
 *
 * These are NO LONGER the primary path for the ten monophthongs — see
 * `vowelProfile()`. They were an articulatory-adjective mapping ("front vowels
 * constrict further forward", "high vowels constrict more tightly") that is
 * directionally right but produces whatever formants it happens to produce.
 * Since vowel identity is carried almost entirely by F1/F2, "plausible geometry"
 * is not good enough: uncalibrated profiles pull every vowel toward a neutral
 * timbre, which is heard as speech-like noise with no decipherable vowels.
 *
 * Retained only as the fallback for any vowel with no entry in
 * `VOWEL_AREA_PARAMS`, so adding a phoneme to `PhonemeSet` cannot crash
 * synthesis before it has been calibrated.
 */
export const BACKNESS_POSITION = Object.freeze({
    [BACKNESS.FRONT]: 0.62,
    [BACKNESS.CENTRAL]: 0.46,
    [BACKNESS.BACK]: 0.30,
});

export const HEIGHT_AREA = Object.freeze({
    [HEIGHT.HIGH]: 0.7,
    [HEIGHT.HIGH_MID]: 1.1,
    [HEIGHT.MID]: 1.6,
    [HEIGHT.LOW_MID]: 2.2,
    [HEIGHT.LOW]: 3.0,
});

/**
 * Constriction LENGTH by manner, as a fraction of tract length.
 *
 * A constriction specified as a single control point does not survive
 * `shapedAreaProfile`'s linear interpolation: the profile tapers to the target
 * only exactly AT that point, and since the point rarely lands on a section
 * centre, the realised minimum is far wider than requested. Measured, a stop
 * asking for 0.02 cm^2 actually reached **0.138** — nearly 7x too open. That is
 * not a cosmetic error: a stop whose closure never closes produces neither the
 * silence nor the release burst that identify it, and stops are six of the most
 * frequent consonants in English. The effect got worse when the section count
 * was corrected from 32 to 16, because coarser sections smear a point further.
 *
 * Giving the constriction a length makes it span whole sections, so it genuinely
 * reaches the target area. The values are anatomical: a stop's occlusion covers
 * roughly 1.5-2 cm of the tract, a fricative channel is comparable, and an
 * approximant's narrowing is longer and gentler. At 17 cm / 16 sections one
 * section is 1.06 cm, so 0.10 (1.7 cm) is about 1.6 sections — enough to hold
 * the target rather than merely touch it.
 */
export const MANNER_WIDTH = Object.freeze({
    [MANNER.STOP]: 0.10,
    [MANNER.AFFRICATE]: 0.09,
    [MANNER.FRICATIVE]: 0.10,
    [MANNER.NASAL]: 0.10,
    [MANNER.APPROXIMANT]: 0.16,
});

/** Constriction cross-section by consonant manner — the "degree" half of spec §2's place/manner pair. */
export const MANNER_AREA = Object.freeze({
    [MANNER.STOP]: 0.02,       // full closure
    [MANNER.AFFRICATE]: 0.10,
    [MANNER.FRICATIVE]: 0.14,
    [MANNER.NASAL]: 0.02,      // oral closure; airflow goes nasal instead
    [MANNER.APPROXIMANT]: 0.85,
});

/**
 * Smoothing time constant for the glottal excitation amplitude.
 *
 * `ee` switches between `voicedEe` (1.0) and `UNVOICED_EE` (1e-3) — a factor of
 * a THOUSAND, i.e. a 60 dB step. Applied instantaneously that is a hard click
 * at every voicing transition, and an English sentence has one at every
 * voiceless consonant; several per second turns into a sputter that swamps the
 * speech. Real vocal folds cannot change amplitude discontinuously either, so
 * smoothing here is physical as well as necessary.
 *
 * Voiced onset retains the authored 30 ms attack. Voicing cessation needs its
 * own shorter envelope: at 30 ms an EH→F sequence retained enough periodic
 * energy to account for 66% of F's central power when its noise was removed.
 * An 8 ms release removes that residual vowel while remaining continuous.
 */
export const VOICING_TIME_MS = 30;
export const VOICING_RELEASE_TIME_MS = 8;

/**
 * Area-smoothing time constants in ms, by manner — the speed of the ARTICULATOR,
 * nothing else.
 *
 * ## These were far too slow, and every stop in every utterance was a glide
 *
 * The previous values (stop 25 ms, vowel 50 ms) were justified by the claim that
 * "a stop at 25 ms still reaches ~94% of its closure within a typical 70 ms
 * stop, so the plosive is preserved". That reasoning is wrong, and wrong in a way
 * worth recording: it measures the PERCENTAGE OF DISTANCE travelled, but what
 * decides whether a stop is a stop is the ABSOLUTE area reached. Going 94% of the
 * way from a vowel's ~3.0 cm^2 to a 0.02 cm^2 closure leaves **0.18 cm^2** —
 * which is not a closure at all, it is a narrow approximant. So the tract never
 * actually blocked, no stop ever produced silence or a release burst, and all six
 * English stops came out as vowel-like glides. Perceptually the whole utterance
 * collapses toward a string of semivowels, which is exactly the reported
 * "yeah yeah yeah".
 *
 * For a target near zero, percentage-of-distance and absolute-value diverge
 * arbitrarily far. This is the same relative-versus-absolute confusion that
 * produced the earlier bad thresholds in this project.
 *
 * ## Why they can now be as fast as the phonetics actually requires
 *
 * These constants USED to be doing two jobs: modelling articulator inertia AND
 * preventing the per-chunk reflection-coefficient step from clicking. The second
 * job is gone — `tract_waveguide.js` now interpolates `junction_k` per sample, so
 * geometry is continuous no matter how fast the frame targets move. That frees
 * these to be purely phonetic.
 *
 * O'Connor et al. (1957) found listeners hear a formant transition as a STOP
 * below ~50 ms and as a SEMIVOWEL above it, so a stop's gesture must complete
 * well inside 50 ms. At the 10 ms frame interval, tau = 8 ms gives alpha 0.71,
 * reaching 0.026 cm^2 (a real closure) within 50 ms. Approximants stay slower:
 * the same literature has /w j r l/ holding their formant loci for 30-50 ms,
 * i.e. genuinely gliding rather than snapping.
 */
export const GESTURE_TIME_MS = Object.freeze({
    [MANNER.STOP]: 8,
    [MANNER.AFFRICATE]: 9,
    [MANNER.FRICATIVE]: 12,
    [MANNER.NASAL]: 8,
    [MANNER.APPROXIMANT]: 12,
    [MANNER.VOWEL]: 15,
    structural: 60,
});

/**
 * Stop RELEASE BURST.
 *
 * A plosive is two acoustic events, not one: a silent closure, then a sharp
 * transient when the occlusion opens and the pressure built up behind it escapes.
 * Only the closure was being modelled, so stops had the right silence and then
 * simply faded back into the next vowel. The burst is a primary place cue — much
 * of what distinguishes /p/ from /t/ from /k/ lives in its spectrum — so without
 * it stops are detectable but not identifiable.
 *
 * Pink Trombone models the same thing, adding a transient whenever a diameter
 * goes from zero to positive; this is the equivalent, expressed through the
 * turbulence channel that already exists rather than as a new kernel input, since
 * a burst IS a brief broadband excitation at the constriction.
 *
 * Detection uses the SMOOTHED area, not the phoneme label: what matters is that
 * the tract actually opened, which is the same reason the closure test asserts
 * realised rather than target geometry. `RELEASE_AREA_CM2` is the threshold
 * below which the tract counts as closed, matching the closure the test requires.
 */
export const RELEASE_AREA_CM2 = 0.05;
export const BURST_AMPLITUDE = 1.0;
/** Oral release decay; the independent glottal aspiration has its own clock. */
export const BURST_TIME_MS = 8;
// Velar releases retain place information for longer than anterior releases
// (Kewley-Port et al., 1983, https://pubmed.ncbi.nlm.nih.gov/6223060/).
// This authored decay gives the rendered /k/ about 24 ms of oral burst energy,
// instead of the same 17 ms as /t/, without extending the following vowel.
const VOICELESS_VELAR_BURST_TIME_MS = 12;
// Let the oral release establish its place cue before glottal aspiration
// reaches full strength. On the GPU, simultaneous full aspiration exceeded
// K→EY's first-10-ms oral burst by 8.7 dB and T→UW's by 5.9 dB. This authored
// 20 ms rise reverses that balance without changing the burst, tract or VOT.
// The value is a model calibration, not a universal phonetic duration; the
// importance of dynamic onset cues is supported by Kewley-Port et al. (1983):
// https://pubmed.ncbi.nlm.nih.gov/6223060/.
const STOP_ASPIRATION_RISE_TIME_MS = 20;

export const FRICATION_PLACE_GAIN = Object.freeze({
    [PLACE.LABIODENTAL]: 0.24,
    [PLACE.DENTAL]: 0.18,
    [PLACE.ALVEOLAR]: 1.0,
    [PLACE.POSTALVEOLAR]: 0.75,
});
export const VOICED_FRICATION_GAIN = 0.35;

export const DEFAULT_ARTICULATION_CONFIG = Object.freeze({
    numSections: DEFAULT_TRACT_CONFIG.numSections,
    /** LF shape ratios, matching `ProsodyPlanner`/`glottal_lf.js` conventions. */
    openQuotient: 0.6,
    peakQuotient: 0.7,
    /**
     * LF return-phase time constant as a fraction of T0.
     *
     * 0.012 is the same authored LF shape used by `ParticleTract` directly.
     * A longer 0.02 return suppressed the IY 1.5-3 kHz band from 2.35% to 0.97%
     * and left its measured F2 about 24.5 dB below the low-frequency peak. The
     * shorter return recovers 3.8 dB at F2 while the real-GPU click/finite gate
     * remains clean. This controls the SOURCE spectrum; vowel geometry and its
     * measured formant centres are unchanged.
     */
    returnQuotient: 0.012,
    /**
     * Cycle-to-cycle F0 jitter as a fraction of the frame F0.
     *
     * This authored 2.5% bound is low-pass correlated rather than independent
     * per frame, avoiding an artificial white-noise pitch trajectory. It is a
     * deterministic source perturbation, not a trained speaker measurement.
     */
    jitterAmount: 0.025,
    /**
     * Cycle-to-cycle amplitude shimmer as a fraction of the voiced ee target.
     *
     * The authored value bounds the pre-filter perturbation to 6% of the voiced
     * target. It is intentionally small and deterministic; it is not claimed as
     * a perceptual cure or as a measured property of Navi's speaker identity.
     */
    shimmerAmount: 0.06,
    /** Glottal excitation strength on a voiced frame. */
    voicedEe: 1.0,
    /**
     * Glottal-flow gain for voiced stops, fricatives and affricates.
     *
     * A supralaryngeal constriction raises oral pressure and reduces the
     * transglottal pressure drop, so a voiced obstruent cannot retain a vowel's
     * full glottal-flow derivative. The previous independent-source model did:
     * V measured 10.6 dB louder than adjacent AA before normalization, and
     * removing V's turbulence changed that by only 0.07 dB. This bounded,
     * manner-wide pressure-loading approximation fixes the source term without
     * per-phoneme gain tables or post-render loudness normalization. A future
     * coupled glottis/tract pressure solver can replace this approximation at
     * the same control seam.
     */
    voicedObstruentEeGain: 0.2,
    /** Subglottal pressure targets (arbitrary but consistent units, consumed by breath_reservoir.js). */
    voicedPressure: 800,
    voicelessPressure: 600,
    silentPressure: 0,
    /** Nasal coupling when a nasal consonant is active. */
    nasalCoupling: 0.7,
    /**
     * Turbulence amplitude for fricatives/affricates.
     *
     * Raised from 0.55 because fricatives were inaudible — the user specifically
     * could not hear Z. Two reasons, both measured. (1) The noise is injected as
     * an additive perturbation on the traveling wave at ONE junction, whereas the
     * glottal source drives the whole tube from the boundary, so a given
     * amplitude couples far less efficiently: at 0.6 the radiated noise measured
     * *below* voicing leaking through a full closure. (2) A voiced fricative
     * like Z has simultaneous glottal and turbulent sources, so frication must
     * remain audible beside the now pressure-reduced glottal source. Real /s/
     * and /z/ sit only about
     * 10-15 dB below a vowel, so the turbulence has to remain an audible source,
     * not a subtle addition. The separate `voicedObstruentEeGain` now reduces
     * the glottal component under constriction instead of asking turbulence to
     * compete with a physically impossible full-strength vowel source.
     */
    fricationAmplitude: 1.5,
    /** Aspiration-like turbulence for BREATH tokens and HH. Scaled with `fricationAmplitude` for the same injection-efficiency reason. */
    aspirationAmplitude: 1.1,
    /**
     * Positive voice-onset interval after an English aspirated stop release.
     * The r3 source started the vowel on the release frame, masking K's burst.
     * Forty milliseconds is an authored, bounded setting, not a speaker fit.
     * Initial/stressed onsets qualify; S clusters and codas do not.
     * https://www.phonetics.ucla.edu/course/chapter3/3consonants.html
     */
    stopAspirationMs: 40,
    /**
     * Continuous low-level aspiration mixed into unobstructed voiced frames.
     * This adds a bounded aperiodic component without changing area geometry.
     * GPU ablation showed that 0.01→0.08 barely changed IY upper-formant energy,
     * so it remains a modest authored texture and is not used as evidence that
     * the reported buzz has been fixed.
     */
    voicedAspiration: 0.01,
    /** Neutral (schwa) profile the tract relaxes toward during silence. */
    neutralPharynxArea: 3.0,
    neutralMidArea: 2.0,
    neutralLipArea: 2.5,
    confidence: 1.0,
});

/**
 * Vowel area profile.
 *
 * Uses the geometry SOLVED to hit each vowel's measured F1/F2 (Peterson &
 * Barney male averages) rather than one derived from height/backness adjectives.
 * The dependency is deliberately inverted: the formant targets are citable data
 * and the geometry is the derived quantity, so a vowel is defined by the sound
 * it must make rather than by a plausible-looking tube shape. See
 * `FormantSolver.js`.
 *
 * Falls back to the adjective mapping for any vowel not in the calibrated table
 * (currently none of the ten monophthongs), so an un-calibrated addition to
 * `PhonemeSet` degrades instead of throwing.
 */
function vowelProfile(entry, numSections, cfg) {
    const calibrated = VOWEL_AREA_PARAMS[entry.symbol];
    if (calibrated) return profileFromParams(calibrated, numSections);

    const position = entry.rhotic ? 0.50 : (BACKNESS_POSITION[entry.backness] ?? 0.46);
    // Rhotics have a tighter, further-back constriction than their height alone implies.
    const area = entry.rhotic ? 0.9 : (HEIGHT_AREA[entry.height] ?? 1.6);
    const lipArea = entry.rounded ? 0.9 : 3.0;
    // Low back vowels have a narrowed pharynx; front vowels an open one.
    const pharynxArea = entry.backness === BACKNESS.BACK ? 2.0 : 4.0;
    return shapedAreaProfile(numSections, [
        { pos: 0, area: pharynxArea },
        { pos: position, area },
        { pos: 1, area: lipArea },
    ]);
}

// Preserve the calibrated site whenever its closure plateau reaches a section.
// Coarser grids otherwise miss the closure entirely; use their nearest interior
// section without moving an oral tongue closure onto the lips.
function calibratedClosurePosition(symbol, numSections, positionOverride) {
    const position = positionOverride ?? (symbol === 'NG' ? VELAR_NASAL_CLOSURE_POSITION : STOP_CONSTRICTION_POSITION[symbol]);
    if (position === undefined) return undefined;
    const nearest = Math.min(numSections - 2, Math.round(position * (numSections - 1))) / (numSections - 1);
    const width = MANNER_WIDTH[symbol === 'NG' ? MANNER.NASAL : MANNER.STOP];
    return Math.abs(nearest - position) <= width / 2 ? position : nearest;
}

/**
 * Consonant area profile: a neutral tract with a constriction of
 * manner-determined degree at the place position.
 *
 * APPROXIMANTS are the exception and take the same formant-solved treatment as
 * vowels. Acoustically /w j r l/ are semivowels, not obstruents: a generic
 * place+degree constriction produces something vowel-shaped and roughly neutral,
 * so all four collapsed into one indistinct glide — which is why /r/ and /l/ were
 * simply not audible as themselves. /r/ in particular is defined by a LOW F3,
 * which no single-constriction "degree" parameter can express.
 */
function consonantProfile(entry, id, numSections, cfg, background = null, positionOverride) {
    const calibrated = APPROXIMANT_AREA_PARAMS[entry.symbol];
    if (calibrated && entry.manner === MANNER.APPROXIMANT) {
        return profileFromParams(calibrated, numSections);
    }

    const position = calibratedClosurePosition(entry.symbol, numSections, positionOverride)
        ?? SIBILANT_CONSTRICTION_POSITION[entry.symbol] ?? constrictionPositionOf(id) ?? 0.5;
    const area = MANNER_AREA[entry.manner] ?? 0.5;
    if (background && entry.manner === MANNER.STOP) {
        // Superimpose the closure on the vowel trajectory instead of replacing
        // its distant cavities with a neutral cone. That cone erased stop place:
        // P/T/K before IY shared a 7.44 kHz burst peak in the rendered waveform.
        // A local gesture preserves the cavities that shape release/transition
        // cues (Story, JASA 2005, doi:10.1121/1.1869752). The plateau and smooth
        // shoulders are authored approximations, not measured speaker anatomy.
        const width = MANNER_WIDTH[MANNER.STOP];
        return Float32Array.from(background, (value, section) => {
            const distance = Math.abs(section / (numSections - 1) - position);
            const shoulder = Math.max(0, Math.min(1, (distance - width / 2) / width));
            const weight = (1 + Math.cos(Math.PI * shoulder)) / 2;
            return value + (Math.min(area, value) - value) * weight;
        });
    }
    // W is bilabial + velar (spec correction 4), so it narrows at BOTH ends.
    const lipArea = (entry.rounded || entry.secondaryPlace) ? 0.8 : cfg.neutralLipArea;

    // The constriction is a SPAN, not a point — see MANNER_WIDTH.
    const half = (MANNER_WIDTH[entry.manner] ?? 0.10) / 2;
    const start = Math.max(0.02, position - half);
    const end = Math.min(1, position + half);
    // A bilabial constriction runs all the way to the lips, so for P/B/M the lip
    // opening IS the closure. Emitting a separate wide lip point there would put
    // two conflicting control points at position 1 and leave the lips open on a
    // sound that is defined by closing them.
    const closesAtLips = end >= 0.99;

    const points = [{ pos: 0, area: cfg.neutralPharynxArea }];
    if (entry.secondaryPlace) {
        // Secondary velar narrowing for W.
        points.push({ pos: PLACE_POSITION[entry.secondaryPlace], area: 1.0 });
    }
    // A glottal "constriction" (HH) is not an oral one: the tract stays open
    // and the turbulence is at the glottis, so do not pinch the oral tract.
    if (position > 0.05) {
        points.push({ pos: start, area });
        if (!closesAtLips && end > start) points.push({ pos: end, area });
    }
    points.push({ pos: 1, area: closesAtLips && position > 0.05 ? area : lipArea });
    // shapedAreaProfile needs its control points in increasing position order.
    points.sort((a, b) => a.pos - b.pos);
    return shapedAreaProfile(numSections, points);
}

function neutralProfile(numSections, cfg) {
    return shapedAreaProfile(numSections, [
        { pos: 0, area: cfg.neutralPharynxArea },
        { pos: 0.5, area: cfg.neutralMidArea },
        { pos: 1, area: cfg.neutralLipArea },
    ]);
}

/**
 * Source target before the shared voicing envelope. Voiced obstruents use the
 * same bounded pressure-loading approximation on the first frame and every
 * later frame; otherwise an utterance beginning with V/Z/B starts at a full
 * vowel drive and takes several 30 ms time constants to recover.
 */
function glottalEeTarget(entry, voiced, cfg) {
    if (!voiced) return UNVOICED_EE;
    const voicedObstruent = entry.category === 'consonant'
        && (entry.manner === MANNER.STOP
            || entry.manner === MANNER.FRICATIVE
            || entry.manner === MANNER.AFFRICATE);
    return cfg.voicedEe * (voicedObstruent ? cfg.voicedObstruentEeGain : 1);
}

/**
 * Junction where oral turbulence enters the cavity downstream of a fricative
 * or released affricate channel.
 *
 * `tract_waveguide` adds noise to the upstream traveling wave before the
 * selected junction scatters it.  Selecting the centre of the constriction
 * therefore makes the turbulent source cross the channel's own exit
 * expansion.  That is especially destructive for labiodentals: with the
 * 32-section production tract, F/V's previous junction 28 sits inside their
 * 0.14 cm² plateau and the 29→30 expansion removes most of the forward cue.
 * For these non-sibilants, select the first junction after the channel. A
 * postalveolar sibilant jet strikes the incisors farther downstream; sourcing
 * it at the tongue exit suppressed the lower anterior-cavity resonance and
 * made SH's rendered noise much weaker than the neighboring vowel.
 *
 * This is geometry-derived for every tract resolution and steady oral
 * fricative and affricate. Glottal HH remains on the aspiration path. An
 * affricate still waits for its real closure to open before emitting noise.
 */
function fricationExitJunction(entry, numSections) {
    const position = SIBILANT_CONSTRICTION_POSITION[entry.symbol] ?? PLACE_POSITION[entry.place];
    const releasedManner = entry.manner === MANNER.AFFRICATE ? MANNER.FRICATIVE : entry.manner;
    const halfWidth = (MANNER_WIDTH[releasedManner] ?? MANNER_WIDTH[MANNER.FRICATIVE]) / 2;
    const downstreamEdge = Math.min(1, position + halfWidth);
    // Strictly greater than the edge even when it lands exactly on a section.
    // `ceil(edge * (N - 1))` is still ON the constriction in that case (e.g.
    // dental .80 at 16 sections is section 12), so use floor + 1 and clamp only
    // where the lip boundary leaves no later legal junction.
    const exit = Math.min(numSections - 2, Math.max(0, Math.floor(downstreamEdge * (numSections - 1)) + 1));
    if (entry.place === PLACE.POSTALVEOLAR) {
        const obstacle = Math.min(numSections - 2, Math.round(POSTALVEOLAR_NOISE_OBSTACLE_POSITION * (numSections - 1)));
        return Math.max(exit, obstacle);
    }
    return exit;
}

/** Authored words, or structural segments for a caller's unsegmented phones. */
function phonemeContextRanges(sequence) {
    const ids = sequence.phonemeIds;
    const words = sequence.words?.length ? sequence.words : [];
    const ranges = words.length ? words : [];
    if (!words.length) {
        let start = 0;
        for (let i = 0; i <= ids.length; i++) {
            if (i < ids.length && !isStructural(ids[i])) continue;
            if (i > start) ranges.push({ startPhoneme: start, endPhoneme: i });
            start = i + 1;
        }
    }
    return ranges.filter(({startPhoneme: start, endPhoneme: end}) =>
        Number.isInteger(start) && Number.isInteger(end)
        && start >= 0 && end <= ids.length && start < end);
}

/**
 * The velum moves independently of the oral closure. Nasalization can begin
 * in the preceding vowel and continue into the following one (Flege, 1988,
 * doi:10.1044/jshr.3104.525). Keep that overlap local and bounded: excessive
 * nasalization can obscure vowel contrasts (Scarborough & Zellou, 2012,
 * doi:10.21437/Interspeech.2012-669). The 30 ms window is an authored gesture,
 * not a measured universal duration. Each edge uses at most one third of a
 * vowel, retaining an oral center even in M-vowel-N. One/two-frame vowels
 * cannot support both a transition and that center, so remain fully oral.
 */
function applyNasalVowelOverlap(sequence, spanStart, spanLen, frameRateHz, coupling, output) {
    if (coupling === 0) return;
    const ids = sequence.phonemeIds;
    const maxFrames = Math.floor(0.030 * frameRateHz);
    for (const {startPhoneme: start, endPhoneme: end} of phonemeContextRanges(sequence)) {
        for (let p = start; p < end; p++) {
            if (phonemeAt(ids[p]).category !== 'vowel') continue;
            const count = Math.min(maxFrames, Math.floor(spanLen[p] / 3));
            if (count < 1) continue;
            for (const direction of [-1, 1]) {
                const neighbor = p + direction;
                if (neighbor < start || neighbor >= end || spanLen[neighbor] === 0
                    || phonemeAt(ids[neighbor]).manner !== MANNER.NASAL) continue;
                for (let distance = 0; distance < count; distance++) {
                    const frame = direction < 0 ? spanStart[p] + distance
                        : spanStart[p] + spanLen[p] - 1 - distance;
                    const weight = (1 + Math.cos(Math.PI * (distance + 1) / (count + 1))) / 2;
                    output[frame] = Math.max(output[frame], coupling * weight);
                }
            }
        }
    }
}

/** Last sonorant phone of an aspirated onset, respecting authored word spans. */
function stopAspirationEndPhones(sequence) {
    const ids = sequence.phonemeIds;
    const ends = new Int32Array(ids.length).fill(-1);
    for (const { startPhoneme: start, endPhoneme: end } of phonemeContextRanges(sequence)) {
        for (let p = start; p < end; p++) {
            const stop = phonemeAt(ids[p]);
            if (stop.manner !== MANNER.STOP || stop.voiced) continue;
            if (p > start && phonemeAt(ids[p - 1]).symbol === 'S') continue;
            let next = p + 1;
            while (next < end && phonemeAt(ids[next]).manner === MANNER.APPROXIMANT) next++;
            if (next >= end || phonemeAt(ids[next]).category !== 'vowel') continue;
            if (p === start || sequence.stress?.[next] === STRESS.PRIMARY) ends[p] = next;
        }
    }
    return ends;
}

/**
 * A glide starts approaching its vowel before the vowel's nominal boundary.
 * Earlier movement is a measured cue distinguishing English /j/ from /i/
 * (Jaggers, 2018, doi:10.5334/labphon.36). The final 20 ms here is a bounded
 * authored overlap, not a universal measured duration. Keep at least half the
 * rendered Y at its own target, and never borrow an unrendered or next-word
 * vowel. The public isolated profile remains context-independent.
 */
function glideVowelContexts(sequence, head, spanStart, spanLen, frameRateHz) {
    const ids = sequence.phonemeIds;
    const contexts = Array(ids.length).fill(null);
    for (const { startPhoneme: start, endPhoneme: end } of phonemeContextRanges(sequence)) {
        for (let p = start; p + 1 < end; p++) {
            if (phonemeAt(ids[p]).symbol !== 'Y' || spanLen[p] < 3
                || phonemeAt(ids[p + 1]).category !== 'vowel' || spanLen[p + 1] < 1
                || spanStart[p] + spanLen[p] !== spanStart[p + 1]) continue;
            const overlap = Math.min(Math.floor(20 * frameRateHz / 1000), Math.floor(spanLen[p] / 2));
            if (overlap < 1) continue;
            contexts[p] = { to: head.profileAtProgress(ids[p + 1], 0, sequence.stress?.[p + 1]),
                start: spanStart[p + 1] - overlap - 1, end: spanStart[p + 1] };
        }
    }
    return contexts;
}

/** Vowel endpoints around stops; structural boundaries always end context. */
function stopVowelContexts(sequence, head, spanStart, spanLen, frameToPhoneme) {
    const ids = sequence.phonemeIds;
    const previous = new Int32Array(ids.length).fill(-1);
    const next = new Int32Array(ids.length).fill(-1);
    const beforeS = new Uint8Array(ids.length);
    const ranges = phonemeContextRanges(sequence);
    for (const {startPhoneme: start, endPhoneme: end} of ranges) {
        let vowel = -1;
        for (let p = start; p < end; p++) {
            if (p + 1 < end && spanLen[p + 1] > 0 && phonemeAt(ids[p]).symbol === 'K'
                && phonemeAt(ids[p + 1]).symbol === 'S') beforeS[p] = 1;
            previous[p] = vowel;
            if (isStructural(ids[p])) vowel = -1;
            else if (phonemeAt(ids[p]).category === 'vowel' && spanLen[p] > 0) vowel = p;
        }
        vowel = -1;
        for (let p = end - 1; p >= start; p--) {
            next[p] = vowel;
            if (isStructural(ids[p])) vowel = -1;
            else if (phonemeAt(ids[p]).category === 'vowel' && spanLen[p] > 0) vowel = p;
        }
    }
    // A final stop can approach the immediately following word's vowel during
    // connected speech. Extend only its background, never onset aspiration or
    // same-word KS calibration. Require explicit phrase identity and ordered
    // authored spans; legacy/malformed metadata keeps its former behavior.
    const words = sequence.words;
    const valid = new Set(ranges);
    if (Array.isArray(words) && words.every((word, i) => valid.has(word)
        && (i === 0 || words[i - 1].endPhoneme <= word.startPhoneme))) {
        for (let i = 1; i < words.length; i++) {
            const leftWord = words[i - 1], rightWord = words[i];
            const p = leftWord.endPhoneme - 1, q = rightWord.startPhoneme;
            if (q !== p + 1 || !Number.isInteger(leftWord.phraseIndex) || leftWord.phraseIndex < 0
                || rightWord.phraseIndex !== leftWord.phraseIndex
                || phonemeAt(ids[p]).manner !== MANNER.STOP || phonemeAt(ids[q]).category !== 'vowel'
                || spanLen[p] < 1 || spanLen[q] < 1
                || spanStart[p] + spanLen[p] !== spanStart[q]) continue;
            // Counts alone cannot prove continuity for a custom frame map.
            let contiguous = true;
            for (let f = spanStart[p]; f < spanStart[q] + spanLen[q]; f++) {
                if (frameToPhoneme[f] !== (f < spanStart[q] ? p : q)) { contiguous = false; break; }
            }
            if (contiguous) next[p] = q;
        }
    }
    return Array.from(ids, (id, p) => {
        if (phonemeAt(id).manner !== MANNER.STOP) return null;
        const left = previous[p], right = next[p];
        if (left < 0 && right < 0) return null;
        // A one-frame diphthong only realises its onset (the frame loop uses
        // progress 0); do not introduce an offglide that was never articulated.
        const source = left >= 0 ? left : right;
        const from = head.profileAtProgress(ids[source],
            left >= 0 && spanLen[left] > 1 ? 1 : 0, sequence.stress?.[source]);
        const to = right >= 0 ? head.profileAtProgress(ids[right], 0, sequence.stress?.[right]) : from;
        // The former .30 K target loses its place cue in the /ks/ cluster.
        // .50 is a measured model calibration for these same-word contexts,
        // not an anatomical constant or a global K/G change. Natural velar
        // contact varies strongly with context (Liker & Gibbon, 2008):
        // https://pubmed.ncbi.nlm.nih.gov/18253872/
        return {from, to, closurePosition: beforeS[p] ? 0.50 : undefined,
            start: left >= 0 ? spanStart[left] + spanLen[left] - 1 : spanStart[p],
            end: right >= 0 ? spanStart[right] : spanStart[p]};
    });
}

export class ArticulationHead {
    constructor(config = {}) {
        this.config = { ...DEFAULT_ARTICULATION_CONFIG, ...config };
        if (!Number.isFinite(this.config.stopAspirationMs)
            || this.config.stopAspirationMs < 0 || this.config.stopAspirationMs > 80) {
            throw new RangeError('ArticulationHead: stopAspirationMs must be in [0, 80]');
        }
        const n = this.config.numSections;
        if (!Number.isInteger(n) || n < 4) throw new RangeError('ArticulationHead: numSections must be an integer >= 4');
        if (!Number.isFinite(this.config.voicedObstruentEeGain)
            || !(this.config.voicedObstruentEeGain > 0)
            || this.config.voicedObstruentEeGain > 1) {
            throw new RangeError('ArticulationHead: voicedObstruentEeGain must be in (0, 1]');
        }
        this._profileCache = new Map();
    }

    /** Cached steady target. Only explicitly unstressed AH selects schwa; callers without stress retain the original isolated profile. */
    targetProfile(id, stress) {
        const entry = phonemeAt(id);
        const schwa = entry.symbol === 'AH' && stress === STRESS.UNSTRESSED;
        const cacheKey = schwa ? 'AH:unstressed' : id;
        const cached = this._profileCache.get(cacheKey);
        if (cached) return cached;
        const cfg = this.config;
        let profile;
        if (entry.category === 'structural' || schwa) {
            // The lexicon encodes reduced schwa as AH0 and full STRUT as AH2.
            // Reuse the existing neutral vowel geometry for that reduced target.
            // The voiced flag, duration, pressure and continuous gesture remain
            // authoritative; this does not turn a vowel into a silent token.
            // Stress distinguishes schwa from STRUT, while realized schwa also
            // depends on its context and duration (Cohen Priva & Strand, 2023):
            // https://urielcpublic.s3.amazonaws.com/papers/CohenPriva_Strand_Schwa-Accepted.pdf
            profile = neutralProfile(cfg.numSections, cfg);
        } else if (entry.category === 'vowel') {
            // A diphthong has no static profile: callers interpolate between
            // its two monophthong targets, so cache those instead.
            profile = entry.glide ? null : vowelProfile(entry, cfg.numSections, cfg);
        } else {
            // CH/JH release into the same postalveolar channel as SH/ZH.
            // A separate affricate width/area produced a different spectrum,
            // even after its stop had opened. The release should retain the
            // postalveolar fricative's cavity; closure remains independently
            // timed by the STOP profile below.
            const released = entry.manner === MANNER.AFFRICATE ? { ...entry, manner: MANNER.FRICATIVE } : entry;
            profile = consonantProfile(released, id, cfg.numSections, cfg);
        }
        this._profileCache.set(cacheKey, profile);
        return profile;
    }

    /** Profile through a phoneme's duration (progress 0..1). Optional lexical stress selects AH0 schwa; diphthong endpoints retain their full targets. */
    profileAtProgress(id, progress, stress) {
        const entry = phonemeAt(id);
        // AFFRICATE: stop closure -> narrow fricative channel. A static narrow
        // channel sounds like a fricative (e.g. JH -> "zee"), so the profile
        // must close first and then open to the frication degree.
        if (entry.category === 'consonant' && entry.manner === MANNER.AFFRICATE) {
            // Hold the closure target while the articulator reaches it, then
            // open during the second half. Ramping open from the very first
            // frame fought the 9 ms geometry lag: planned JH only reached
            // 0.0788 cm², never the 0.05 closure threshold, and emitted no burst.
            // The endpoint profiles and total phoneme duration are unchanged.
            // Hold the released channel as well: interpolating for the entire
            // second half delayed the realised opening until 90 ms of a 120 ms
            // CH/JH, leaving only 30 ms of noise. The existing 9 ms geometry
            // envelope supplies the physical transition to this held target.
            const t = progress <= 0.5 ? 0 : 1;
            const closure = consonantProfile({ ...entry, manner: MANNER.STOP }, id, this.config.numSections, this.config);
            const fricative = this.targetProfile(id);
            const out = new Float32Array(closure.length);
            for (let i = 0; i < closure.length; i++) out[i] = closure[i] + (fricative[i] - closure[i]) * t;
            return out;
        }
        const direct = this.targetProfile(id, stress);
        if (direct) return direct;
        // Diphthong: glide from the first monophthong target to the second,
        // then hold the second target for its final quarter so the off-glide is
        // fully realised rather than trailing off into a breathy neutral vowel.
        const { fromId, toId } = diphthongTargetIds(id);
        const a = this.targetProfile(fromId);
        const b = this.targetProfile(toId);
        const t = Math.min(1, Math.max(0, progress) / 0.75);
        const out = new Float32Array(a.length);
        for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * t;
        return out;
    }

    /**
     * @param {object} frames `LengthRegulator.expand()` output.
     * @param {{phonemeIds: ArrayLike<number>}} sequence The phoneme sequence the frames index into.
     * @param {{ sampleRate: number, startSample?: number, prepareLeadingSilence?: boolean }} options
     * @returns {{
     *   totalFrames: number, numSections: number, sampleRate: number, frameRateHz: number,
     *   areas: Float32Array, t0Samples: Float32Array, teSamples: Float32Array,
     *   tpSamples: Float32Array, taSamples: Float32Array, ee: Float32Array,
     *   pressure: Float32Array, constrictionIndex: Int32Array,
     *   constrictionAmplitude: Float32Array, releaseAspiration: Float32Array, nasalCoupling: Float32Array,
     *   confidence: Float32Array, sampleIndex: Float64Array, releaseBursts: ReadonlyArray<object>,
     *   pressurePreparation: null|Readonly<{kind: 'leading-silence', leadingFrames: number,
     *     targetPressure: number, absoluteSpeechStartSample: number}>
     * }}
     */
    predict(frames, sequence, {
        sampleRate,
        startSample = 0,
        prepareLeadingSilence = false,
    }) {
        const cfg = this.config;
        if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('ArticulationHead: sampleRate must be positive');
        if (!Number.isInteger(startSample) || startSample < 0) throw new RangeError('ArticulationHead: startSample must be a non-negative integer');
        if (typeof prepareLeadingSilence !== 'boolean') throw new TypeError('ArticulationHead: prepareLeadingSilence must be a boolean');
        const { totalFrames, frameF0Hz, frameVoiced, frameToPhoneme, frameRateHz } = frames ?? {};
        if (!Number.isInteger(totalFrames) || !frameF0Hz || !frameVoiced || !frameToPhoneme) {
            throw new TypeError('ArticulationHead.predict requires LengthRegulator.expand() output');
        }
        if (!Number.isFinite(frameRateHz) || frameRateHz <= 0) throw new RangeError('ArticulationHead: frames.frameRateHz must be positive');
        const phonemeIds = sequence?.phonemeIds;
        if (!phonemeIds) throw new TypeError('ArticulationHead.predict requires sequence.phonemeIds');

        const S = cfg.numSections;
        const areas = new Float32Array(totalFrames * S);
        const t0Samples = new Float32Array(totalFrames);
        const teSamples = new Float32Array(totalFrames);
        const tpSamples = new Float32Array(totalFrames);
        const taSamples = new Float32Array(totalFrames);
        const ee = new Float32Array(totalFrames);
        const pressure = new Float32Array(totalFrames);
        const constrictionIndex = new Int32Array(totalFrames);
        const constrictionAmplitude = new Float32Array(totalFrames);
        const releaseAspiration = new Float32Array(totalFrames);
        const nasalCoupling = new Float32Array(totalFrames);
        const confidence = new Float32Array(totalFrames).fill(cfg.confidence);
        const sampleIndex = new Float64Array(totalFrames);
        const releaseBursts = [];

        const result = {
            totalFrames, numSections: S, sampleRate, frameRateHz,
            areas, t0Samples, teSamples, tpSamples, taSamples, ee, pressure, releaseAspiration,
            constrictionIndex, constrictionAmplitude, nasalCoupling, confidence, sampleIndex,
            pressurePreparation: null,
            releaseBursts: Object.freeze([]),
        };
        if (totalFrames === 0) return result;

        // Frame spans and state-independent drive/timestamps are resolved first,
        // so preparation reads the same actual pressure stream as the renderer.
        const spanStart = new Int32Array(phonemeIds.length).fill(-1);
        const spanLen = new Int32Array(phonemeIds.length);
        const aspirationEndPhones = stopAspirationEndPhones(sequence);
        for (let f = 0; f < totalFrames; f++) {
            const p = frameToPhoneme[f];
            if (spanStart[p] < 0) spanStart[p] = f;
            spanLen[p] += 1;
            const id = phonemeIds[p];
            const entry = phonemeAt(id);
            pressure[f] = isStructural(id)
                ? (entry.symbol === 'BREATH' ? cfg.voicelessPressure : cfg.silentPressure)
                : (frameVoiced[f] === 1 ? cfg.voicedPressure : cfg.voicelessPressure);
            sampleIndex[f] = startSample + Math.round((f * sampleRate) / frameRateHz);
        }

        applyNasalVowelOverlap(sequence, spanStart, spanLen, frameRateHz, cfg.nasalCoupling, nasalCoupling);
        const stopContexts = stopVowelContexts(sequence, this, spanStart, spanLen, frameToPhoneme);
        const glideContexts = glideVowelContexts(sequence, this, spanStart, spanLen, frameRateHz);
        const targetAtFrame = (p, frame, progress = 0) => {
            const id = phonemeIds[p];
            const context = stopContexts[p];
            if (!context) {
                const target = this.profileAtProgress(id, progress, sequence.stress?.[p]);
                const glide = glideContexts[p];
                if (!glide || frame <= glide.start) return target;
                const blend = Math.min(1, (frame - glide.start) / (glide.end - glide.start));
                return Float32Array.from(target, (area, section) => area + (glide.to[section] - area) * blend);
            }
            const t = context.end > context.start
                ? Math.max(0, Math.min(1, (frame - context.start) / (context.end - context.start))) : 0;
            const background = Float32Array.from(context.from,
                (area, s) => area + (context.to[s] - area) * t);
            return consonantProfile(phonemeAt(id), id, S, cfg, background, context.closurePosition);
        };

        // Use only an actual silent prefix, with the existing renderer-side
        // source hold. An initial vowel otherwise voices its neutral-to-target
        // movement: E measured 438/1772 Hz at onset versus its 270/2291 Hz target.
        // A fricative likewise emits noise before its channel is ready; pressure
        // preparation alone made S's first 25 ms 7.3 dB louder than its sustain.
        // Preparing these measured gestures under silence fixes both seams.
        let leadingFrames = 0;
        let initialGesture = null;
        if (prepareLeadingSilence) {
            while (leadingFrames < totalFrames) {
                const entry = phonemeAt(phonemeIds[frameToPhoneme[leadingFrames]]);
                if (entry.symbol !== 'SIL' || pressure[leadingFrames] !== 0) break;
                leadingFrames += 1;
            }
            if (leadingFrames > 0 && leadingFrames < totalFrames) {
                const onsetId = phonemeIds[frameToPhoneme[leadingFrames]];
                const onsetEntry = phonemeAt(onsetId);
                const targetPressure = pressure[leadingFrames];
                const oralFricative = onsetEntry.manner === MANNER.FRICATIVE
                    && onsetEntry.place !== PLACE.GLOTTAL;
                // Affricates also need stored pressure before their closure
                // releases. Excluding JH halved G's consonant/vowel level ratio
                // after normalization. This prepares pressure only; its real
                // closure, release timing and voicing envelopes remain intact.
                const preparationEligible = oralFricative || onsetEntry.manner !== MANNER.FRICATIVE;
                if (!isStructural(onsetId) && preparationEligible
                    && Number.isFinite(targetPressure) && targetPressure > 0) {
                    result.pressurePreparation = Object.freeze({
                        kind: 'leading-silence', leadingFrames, targetPressure,
                        absoluteSpeechStartSample: sampleIndex[leadingFrames],
                    });
                    // Stops/nasals remain pressure-only. Approximants also need
                    // their onset profile: unprepared initial Y measured an
                    // audible neutral glide before reaching its IY-like target.
                    // Diphthongs prepare their initial profile;
                    // their authored glide still starts on the first speech frame.
                    if (onsetEntry.category === 'vowel' || oralFricative
                        || onsetEntry.manner === MANNER.APPROXIMANT) {
                        initialGesture = this.profileAtProgress(onsetId, 0, sequence.stress?.[frameToPhoneme[leadingFrames]]);
                    }
                }
            }
        }

        const frameMs = 1000 / frameRateHz;
        // Smoothed tract state, started AT the first frame's target so the
        // utterance does not open with a ramp from an arbitrary shape.
        const current = Float32Array.from(initialGesture
            ?? targetAtFrame(frameToPhoneme[0], 0));
        // Smoothed excitation amplitude, likewise started at its own target.
        const eeAlpha = 1 - Math.exp(-frameMs / VOICING_TIME_MS);
        const eeReleaseAlpha = 1 - Math.exp(-frameMs / VOICING_RELEASE_TIME_MS);
        const firstEntry = phonemeAt(phonemeIds[frameToPhoneme[0]]);
        let currentEe = glottalEeTarget(firstEntry, frameVoiced[0] === 1, cfg);

        // Low-pass-correlated jitter/shimmer state. A simple first-order pole
        // avoids an independent white-noise control trajectory while preserving
        // deterministic rendering. These are authored perturbations, not a
        // trained or listener-validated speaker model. The pole's effective
        // time constant is ~100 ms at the 100 Hz frame rate.
        const PINK_POLE = 1.0 - (frameMs / 100.0);
        let jitterState = 0.0;
        let shimmerState = 0.0;

        // Release-burst state, carried across frames. See RELEASE_AREA_CM2.
        let burstDecay = Math.exp(-frameMs / BURST_TIME_MS);
        let burst = 0;
        let burstSection = 0;
        let previousClosed = false;
        let previousClosedSection = 0;
        let burstEligible = false;
        let burstOriginManner = null;
        let burstOriginVoiced = false;
        let burstOriginJunction = 0;
        let burstOriginPhone = -1;
        let aspirationUntilFrame = 0;
        let aspirationStartFrame = 0;
        let releaseEvent = null;

        for (let f = 0; f < totalFrames; f++) {
            const p = frameToPhoneme[f];
            const id = phonemeIds[p];
            const entry = phonemeAt(id);
            const progress = spanLen[p] > 1 ? (f - spanStart[p]) / (spanLen[p] - 1) : 0;
            const target = initialGesture && f < leadingFrames
                ? initialGesture : targetAtFrame(p, f, progress);

            // One-pole smoothing toward the target, with a per-manner time
            // constant (see header constraint 2).
            const tauMs = entry.category === 'structural'
                ? GESTURE_TIME_MS.structural
                : (GESTURE_TIME_MS[entry.manner] ?? 30);
            // alpha = 1 - exp(-dt/tau): the standard one-pole coefficient, so
            // the same tau behaves identically at any frame rate.
            const alpha = 1 - Math.exp(-frameMs / tauMs);
            for (let s = 0; s < S; s++) {
                current[s] += (target[s] - current[s]) * alpha;
                // Areas must stay strictly positive: reflectionCoefficients
                // divides by (A_i + A_{i+1}), and NeuralPhysiologyState's
                // validator rejects non-positive areas outright.
                areas[f * S + s] = Math.max(1e-4, current[s]);
            }

            // ── Glottal state ────────────────────────────────────────────
            // F0 JITTER & SHIMMER: deterministic 1/f (pink) perturbations.
            //
            // Perfectly fixed controls produce a rigid harmonic comb. These small,
            // low-pass-correlated perturbations vary that source without moving
            // the tract formants. They are not asserted to solve intelligibility
            // by themselves; the hashes are deterministic so tests reproduce the
            // exact same acoustic input.
            const f0Clean = Math.max(1, frameF0Hz[f]);
            let jitterHash = (f * 2654435761) >>> 0;
            jitterHash = ((jitterHash ^ (jitterHash >>> 16)) * 0x45d9f3b) >>> 0;
            const jitterWhite = (jitterHash / 4294967295.0) * 2.0 - 1.0;
            jitterState = PINK_POLE * jitterState + (1.0 - PINK_POLE) * jitterWhite;
            const jitter = 1.0 + (jitterState * cfg.jitterAmount);

            let shimmerHash = (f * 1597334677) >>> 0;
            shimmerHash = ((shimmerHash ^ (shimmerHash >>> 16)) * 0x45d9f3b) >>> 0;
            const shimmerWhite = (shimmerHash / 4294967295.0) * 2.0 - 1.0;
            shimmerState = PINK_POLE * shimmerState + (1.0 - PINK_POLE) * shimmerWhite;
            const shimmer = 1.0 + (shimmerState * cfg.shimmerAmount);

            const f0 = f0Clean * jitter;
            const t0 = sampleRate / f0;
            const te = cfg.openQuotient * t0;
            const tp = cfg.peakQuotient * te;
            const ta = cfg.returnQuotient * t0;
            t0Samples[f] = t0;
            teSamples[f] = te;
            tpSamples[f] = tp;
            taSamples[f] = ta;
            const voiced = frameVoiced[f] === 1;
            // Strictly positive even when unvoiced — see header constraint 1 —
            // and SMOOTHED, because the voiced/unvoiced ratio is 1000:1 and a
            // step that large is a click (see VOICING_TIME_MS).

            // ── Articulation events ──────────────────────────────────────
            let ampl = 0;
            let nasal = 0;
            let cIndex = -1;
            if (entry.category === 'consonant') {
                const pos = calibratedClosurePosition(entry.symbol, S, stopContexts[p]?.closurePosition)
                    ?? constrictionPositionOf(id) ?? 0.5;
                // Junction i couples sections i and i+1, so the last legal
                // junction is numSections-2 (ParticleTract enforces this too).
                cIndex = Math.min(S - 2, Math.max(0, Math.round(pos * (S - 1))));
                if (entry.manner === MANNER.FRICATIVE || entry.manner === MANNER.AFFRICATE) {
                    if (entry.place === PLACE.GLOTTAL) {
                        cIndex = -1;
                        ampl = cfg.aspirationAmplitude;
                    } else {
                        // The noise source belongs immediately DOWNSTREAM of
                        // the narrow channel, not at its centre.  The latter
                        // subjects the source to the channel's exit reflection
                        // before it can enter the front cavity and can erase a
                        // quiet nonsibilant such as F.  Bursts may override this
                        // below with their independently latched closure site.
                        cIndex = fricationExitJunction(entry, S);
                        const placeGain = FRICATION_PLACE_GAIN[entry.place] ?? 0.22;
                        const voiceGain = entry.voiced ? VOICED_FRICATION_GAIN : 1;
                        ampl = cfg.fricationAmplitude * placeGain * voiceGain;
                    }
                } else if (entry.manner === MANNER.NASAL) {
                    // Use the same authored velum coupling for all nasal places.
                    // The former N-only 1.4 boost overloaded its murmur: N/EH
                    // RMS was 1.45 in the letter name and N/UW was 1.98 in moon.
                    // Place differences belong to the tract, not an extra gain
                    // that also lowers the opening consonant after normalization.
                    nasal = cfg.nasalCoupling;
                }
            } else if (isStructural(id) && entry.symbol === 'BREATH') {
                cIndex = -1;
                ampl = cfg.aspirationAmplitude;
            }

            // VOICED ASPIRATION: small continuous glottal turbulence on every
            // voiced frame with no oral constriction (vowels and approximants).
            // It is a bounded aperiodic texture, not a stand-alone intelligibility
            // fix; the aspiration is routed through the same glottal nozzle as
            // HH/BREATH (constrictionIndex < 0).
            if (voiced && cIndex < 0 && ampl === 0) {
                ampl = cfg.voicedAspiration;
            }

            // ── Stop release burst ───────────────────────────────────────
            // Fire when the tract has just STOPPED being closed. Read off the
            // smoothed geometry rather than the phoneme sequence, so it triggers
            // only when a closure genuinely formed and genuinely opened — a stop
            // whose gesture failed to close produces no burst, which is correct
            // and also makes the burst a witness that the closure was real.
            let tightest = Infinity;
            let tightestSection = 0;
            for (let s = 0; s < S; s++) {
                const a = areas[f * S + s];
                if (a < tightest) { tightest = a; tightestSection = s; }
            }
            const closedNow = tightest < RELEASE_AREA_CM2;
            const sibilantPosition = SIBILANT_CONSTRICTION_POSITION[entry.symbol];
            if (sibilantPosition !== undefined) {
                // A full jet cannot exist while EH→S still has an open vowel
                // channel. Scale its availability by the local area ratio;
                // inspecting the global minimum would select a different vowel
                // constriction. This bounded approximation preserves settled
                // gain and prepared initial S/Z, while removing the spurious
                // broadband onset from a source inside the still-open tract.
                const channel = Math.round(sibilantPosition * (S - 1));
                const targetArea = this.targetProfile(id)[channel];
                ampl *= Math.min(1, targetArea / areas[f * S + channel]);
            }
            // Affrication is the RELEASE of a closure, not continuous noise
            // while the tract is still closing. Couple the steady source to
            // both the authored release phase and realised geometry. The
            // independently latched burst is added below only on a real opening.
            // Plain fricatives, their source routing and startup remain intact.
            if (entry.manner === MANNER.AFFRICATE && (progress <= 0.5 || closedNow)) {
                ampl = 0;
            }
            if (closedNow) {
                if (entry.manner === MANNER.NASAL || nasal > 0) {
                    burstEligible = false;
                } else if (entry.manner === MANNER.STOP || entry.manner === MANNER.AFFRICATE) {
                    burstEligible = true;
                    burstOriginManner = entry.manner;
                    burstOriginVoiced = entry.voiced === true;
                    burstOriginJunction = fricationExitJunction(entry, S);
                    burstOriginPhone = p;
                }
            }
            if (previousClosed && !closedNow && burstEligible) {
                const aspirationEnd = aspirationEndPhones[burstOriginPhone];
                if (aspirationEnd >= p && cfg.stopAspirationMs > 0) {
                    // Keep at least half of the following sonorant interval
                    // available to voice, including unusually short caller plans.
                    const available = spanStart[aspirationEnd] + spanLen[aspirationEnd] - f;
                    aspirationStartFrame = f;
                    aspirationUntilFrame = f + Math.min(Math.round(cfg.stopAspirationMs / frameMs),
                        Math.floor(available / 2));
                }
                // Affricates need a full burst to sound like stop + fricative;
                // voiced stops alone are quieter to keep them from clicking.
                // Use the closure that CREATED stored pressure, not the next
                // phone whose opening geometry happens to trigger release: K→OW
                // must stay an unvoiced K burst, and B→AA a voiced B burst.
                const isAffricate = burstOriginManner === MANNER.AFFRICATE;
                const isVoicedStop = burstOriginVoiced && !isAffricate;
                burst = isVoicedStop ? BURST_AMPLITUDE * 0.5 : BURST_AMPLITUDE;
                const isVoicelessVelar = !isAffricate && !burstOriginVoiced
                    && phonemeAt(phonemeIds[burstOriginPhone]).place === PLACE.VELAR;
                burstDecay = Math.exp(-frameMs / (isVoicelessVelar
                    ? VOICELESS_VELAR_BURST_TIME_MS : BURST_TIME_MS));
                // Burst at the place that was occluded, which is where the
                // pressure was. This is what carries the place cue.
                // The released affricate jet belongs downstream of its channel,
                // just like steady frication. The old minimum-area junction lay
                // inside that channel and suppressed G/J's release by about 5 dB.
                burstSection = isAffricate ? burstOriginJunction
                    : Math.min(S - 2, Math.max(0, previousClosedSection));
                releaseEvent = { frame: f, section: burstSection, originManner: burstOriginManner,
                    amplitudes: [], combinedAmplitudes: [], combinedIndices: [], steadyIndices: [] };
            }
            previousClosed = closedNow;
            if (closedNow) previousClosedSection = tightestSection;
            else {
                burstEligible = false;
                burstOriginManner = null;
                burstOriginVoiced = false;
            }

            if (burst > cfg.fricationAmplitude * 0.02) {
                // Retain the independent fricative location before the legacy
                // combined control chooses the dominant source. K and S can
                // overlap at different oral junctions without moving either jet.
                // Independent constriction sources avoid location jumps:
                // https://www.vocaltractlab.de/publications/birkholz-2014-issp.pdf
                releaseEvent.steadyIndices.push(cIndex);
                // The burst supplements whatever turbulence the phoneme already
                // asks for (an affricate has both), and dictates the injection
                // point while it dominates.
                if (burst > ampl) cIndex = burstSection;
                if (releaseEvent.amplitudes.length === 0) releaseBursts.push(releaseEvent);
                releaseEvent.amplitudes.push(burst);
                ampl += burst;
                burst *= burstDecay;
            } else {
                burst = 0;
                releaseEvent = null;
            }

            constrictionIndex[f] = cIndex;
            constrictionAmplitude[f] = ampl;
            const aspirating = f < aspirationUntilFrame && !closedNow
                && (entry.category === 'vowel' || entry.manner === MANNER.APPROXIMANT);
            // An independent glottal source is necessary while the oral burst
            // owns the constriction junction. Never reinterpret the burst as HH.
            // Mid-frame samples keep a short, single-frame aspirated interval
            // audible. The existing interval independently controls phonation,
            // so shaping this source cannot extend VOT or consume vowel time.
            const aspirationRise = Math.min(1,
                ((f - aspirationStartFrame) * frameMs + frameMs / 2) / STOP_ASPIRATION_RISE_TIME_MS);
            releaseAspiration[f] = aspirating ? cfg.aspirationAmplitude * 0.5 * aspirationRise : 0;
            const phonating = voiced && !aspirating;
            const eeTarget = glottalEeTarget(entry, phonating, cfg) * shimmer;
            currentEe += (eeTarget - currentEe) * (phonating ? eeAlpha : eeReleaseAlpha);
            ee[f] = Math.max(UNVOICED_EE, currentEe);
            // Vowel-edge overlap was planned independently of oral gestures;
            // it must not change stop release eligibility or excitation.
            if (entry.category !== 'vowel') nasalCoupling[f] = nasal;
            if (releaseEvent) {
                releaseEvent.combinedAmplitudes.push(constrictionAmplitude[f]);
                releaseEvent.combinedIndices.push(cIndex);
            }

        }

        // Keep the public combined controls authoritative. These immutable
        // provenance snapshots let the renderer align a stop's burst separately
        // from steady frication without losing caller edits to those controls.
        result.releaseBursts = Object.freeze(releaseBursts.map((event) => Object.freeze({
            ...event,
            amplitudes: Object.freeze(event.amplitudes),
            combinedAmplitudes: Object.freeze(event.combinedAmplitudes),
            combinedIndices: Object.freeze(event.combinedIndices),
            steadyIndices: Object.freeze(event.steadyIndices),
        })));
        return result;
    }
}

/**
 * Materialize one frame of a `predict()` result as a validated
 * `NeuralPhysiologyState`. Built on demand rather than eagerly — see the
 * header's "output shape" note — so the schema and its validators are
 * genuinely exercised without allocating hundreds of frozen objects per
 * utterance.
 */
export function physiologyStateAt(result, frame, { glottalReflection, lipReflection } = {}) {
    if (!Number.isInteger(frame) || frame < 0 || frame >= result.totalFrames) {
        throw new RangeError(`physiologyStateAt: frame must be in [0, ${result.totalFrames})`);
    }
    const S = result.numSections;
    const areas = result.areas.subarray(frame * S, (frame + 1) * S);
    const tractGesture = { areas };
    if (glottalReflection !== undefined) tractGesture.glottalReflection = glottalReflection;
    if (lipReflection !== undefined) tractGesture.lipReflection = lipReflection;

    const cIndex = result.constrictionIndex[frame];
    return createNeuralPhysiologyState({
        sampleIndex: result.sampleIndex[frame],
        respiratoryDrive: { targetSubglottalPressure: result.pressure[frame] },
        glottalState: {
            t0Samples: result.t0Samples[frame],
            teSamples: result.teSamples[frame],
            tpSamples: result.tpSamples[frame],
            taSamples: result.taSamples[frame],
            ee: result.ee[frame],
        },
        tractGesture,
        // The schema requires a non-negative integer constrictionIndex when
        // present, so "no constriction" is expressed by omitting the field
        // rather than by smuggling in -1.
        articulationEvent: {
            ...(cIndex >= 0 ? { constrictionIndex: cIndex } : {}),
            constrictionAmplitude: result.constrictionAmplitude[frame],
            releaseAspiration: result.releaseAspiration?.[frame] ?? 0,
            nasalCoupling: result.nasalCoupling[frame],
        },
        uncertainty: { confidence: result.confidence[frame] },
    });
}

export function createArticulationHead(config) {
    return new ArticulationHead(config);
}

export default ArticulationHead;
