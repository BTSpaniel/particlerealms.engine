// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleTract.js — Phase 2 ParticleVoice Voice Box orchestrator.
 *
 * The GPU-resident articulatory synthesizer: composes the already-verified
 * Phase 2 articulatory kernels into audible speech, one fixed-size chunk at
 * a time, with all cross-chunk state persisted ON THE GPU (no CPU round
 * trip mid-pipeline). This is the production counterpart of R6's pure-CPU
 * `risk/VoiceBoxWaveguideProbe.js`, and deliberately reproduces the same
 * four controllable behaviors that probe proved: stable vowels, nasal
 * coupling, closure/release/frication, and pitch sweeps.
 *
 * Signal graph per chunk (6 GPU passes plus state copies, ONE submit):
 *
 *   glottal_lf ────────────────► voicing ──┐
 *                                          ├─ source_volume_mix ─► pressure wave ─┐
 *   constriction_noise(asp seed) ─► asp ────┘                            │
 *                                                                        ▼
 *   constriction_noise(fric seed) ─► frication ─► coupled_tract_waveguide
 *                                                       │         │
 *                                    oral radiation ◄───┘         └──► nose
 *                                        │                   │
 *                                        └── outlet_volume_mix ◄── boundary pressure
 *                                                 │
 *                                                 ▼  final PCM
 *
 * Design decisions worth knowing:
 *
 *   - **Frication is injected at the constriction, not the glottis.** The
 *     frication noise buffer goes to `tract_waveguide.js`'s
 *     `constriction_noise` input and is added to the right-going wave at
 *     `constrictionIndex`, so only the cavity in FRONT of the constriction
 *     filters it. Mixing it into `source_flow` instead would make every
 *     fricative sound like a whisper. Aspiration, which really is glottal,
 *     IS mixed into `source_flow`.
 *   - **No `lip_radiation` pass.** The production LF source is already a
 *     flow-derivative waveform, so this tract sets `radiation_difference = 0`.
 *     Applying `outputRaw - prevOutputRaw` here would differentiate it again
 *     and produce a thin, spiky source. `outlet_volume_mix` supplies the
 *     separate aperture/reflection amplitude conversion; `lip_radiation.js`
 *     remains for callers holding undifferentiated flow.
 *   - **Fixed `chunkSamples`.** `tract_waveguide.js`/`nasal_junction.js`
 *     pack their radiated signal and persisted state into one buffer whose
 *     internal offsets depend on `num_samples`, so a varying chunk size
 *     would move every offset and invalidate the pre-built bind groups. A
 *     fixed chunk size is also what a real-time audio bridge wants anyway
 *     (`streaming/VoiceChunker.js` schedules in fixed frame buckets), so it
 *     is required here rather than worked around.
 *   - **Reflection coefficients are computed CPU-side** each chunk via
 *     `risk/KellyLochbaumWaveguide.js`'s proven `reflectionCoefficients`,
 *     matching `tract_waveguide.js`'s stated contract. Changing `areas`
 *     between chunks is how closure/release is articulated.
 *   - **Outlet radiation uses volume contribution, not boundary pressure.**
 *     The two waveguides expose `(1+r)p+` at their ends, while far-field level
 *     follows outlet volume velocity `A(1-r)p+/(rho*c)`. The final GPU mix
 *     applies that area/reflection ratio under one common normalization and
 *     interpolates moving lip area per sample. It changes relative radiation
 *     level without changing any junction coefficient or resonance centre.
 *   - **The LF source crosses an explicit volume→pressure seam.**
 *     `glottal_lf` emits a normalized volume-flow derivative, but the tract's
 *     traveling waves are pressure components. `source_volume_mix` therefore
 *     applies the characteristic-impedance ratio `referenceArea/inletArea`,
 *     interpolated on the same per-sample geometry trajectory. This is a
 *     linear fixed-source-impedance approximation, not a nonlinear vocal-fold
 *     pressure solver; it preserves resonance geometry while removing the
 *     otherwise arbitrary dependence of source pressure on first-section area.
 *
 * **Visualization is optional and structurally incapable of changing the
 * PCM.** `ARCHITECTURE.md` §4 requires visualization to be "bit-identically
 * disable-able without changing rendered PCM". Here that is not a runtime
 * convention but a structural property: when `visualFramesPerChunk` is 0
 * (the default) the visualization buffers, pipeline and dispatches are never
 * created at all, and when it is enabled every visualization buffer is
 * WRITE-ONLY from the acoustic path's perspective — the field is copied OUT
 * of `tract_waveguide`/`nasal_junction`'s already-final packed outputs, and
 * nothing in the visualization path is ever read back into the acoustic
 * path. `visual_state_decimate.js` makes the same guarantee at kernel level
 * (it has no read_write access to anything the acoustic path reads).
 *
 * Known limitations, stated honestly rather than papered over:
 *
 *   - `constrictionIndex` and `nasalCoupling` remain shared top-level controls
 *     for all instances. The coupling sets the first nasal section's area
 *     relative to its authored profile, with per-instance pressure weights.
 *   - Oral and nasal pressure waves meet at a reciprocal three-port junction.
 *     The nasal tap remains a read-only visualization of oral pressure; it no
 *     longer drives an independent branch. Port weights and both tube
 *     coefficient sets interpolate per sample. This is a piecewise cylindrical
 *     acoustic model with fixed boundary reflections and frequency-independent
 *     wall loss, not a complete model of nasal cavities or yielding tissue.
 *   - The visualization field carries the THREE per-sample solver signals
 *     the kernels actually expose (oral radiated, nasal tap, nasal
 *     radiated), not one channel per tube section.
 *     `ARCHITECTURE.md` §4 describes the richer per-section field, but
 *     `tract_waveguide.js` does not emit a `[section, sample]` field — only
 *     its radiated signal, final state and the single tapped section. Adding
 *     one would mean a `numSections * chunkSamples` output block (~512 KB
 *     per chunk at 32 sections / 1024 samples) allocated whether or not
 *     visualization is on. That is a deliberate follow-up, not an oversight;
 *     the three channels here are enough to drive a ribbon/heatmap of what
 *     the solver is actually radiating.
 */

import { createUniformBuffer, createStorageBuffer, destroyBuffers } from '/engine/core/gpu/GpuBuffer.js';
import { reflectionCoefficients } from '../risk/KellyLochbaumWaveguide.js';
import { glottalLfShader, GLOTTAL_LF_WORKGROUP_SIZE } from '../nn/kernels/articulatory/glottal_lf.js';
import { constrictionNoiseShader, CONSTRICTION_NOISE_WORKGROUP_SIZE } from '../nn/kernels/articulatory/constriction_noise.js';
import { outletVolumeMixShader, OUTLET_VOLUME_MIX_WORKGROUP_SIZE } from '../nn/kernels/articulatory/outlet_volume_mix.js';
import { sourceVolumeMixShader, SOURCE_VOLUME_MIX_WORKGROUP_SIZE } from '../nn/kernels/articulatory/source_volume_mix.js';
import { coupledTractWaveguideShader, coupledTractWaveguideOutputLayout, COUPLED_TRACT_MAX_SECTIONS } from '../nn/kernels/articulatory/coupled_tract_waveguide.js';
import { visualStateDecimateShader, VISUAL_STATE_DECIMATE_WORKGROUP_SIZE } from '../nn/kernels/articulatory/visual_state_decimate.js';
import { createTractStateSnapshot } from './TractStateSnapshot.js';

/**
 * Boundary coefficients are R6's proven values. The SECTION COUNTS are not —
 * they are derived from physics, and R6's were wrong.
 *
 * ## Section count is not a free parameter: it sets the tract LENGTH
 *
 * In this waveguide a wave advances one section per sample
 * (`right[i] -> right[i+1]`), so each section is one sample of travel:
 *
 *     sectionLength = c / sampleRate
 *     tractLength   = numSections * c / sampleRate
 *
 * The count is therefore *determined* by the sample rate and the length you
 * want. At 32 kHz with c = 340 m/s a section is 1.06 cm, so a 17.5 cm adult
 * vocal tract needs **16 sections**, not 32.
 *
 * R6 used 32 sections at 32 kHz, which models a **34 cm** tube — twice human
 * length. Nothing errors: the model is a perfectly valid tube, just the wrong
 * one. Since a quarter-wave resonator's formants are `(2k-1)*c/(4L)`, doubling
 * L puts EVERY formant an octave too low — F1 at ~260 Hz instead of ~500 Hz.
 * That is not a subtle detune; it moves the formants out of the range speech
 * sounds occupy, which is audible as muffled, "underwater", vowel-less noise no
 * matter how clean the rest of the pipeline is. It was measured directly (F1
 * 261 Hz, implied length 32.6 cm) by the uniform-tube calibration check in
 * `tests/particle-voice/voicebox-audio.html`, which now guards it.
 *
 * Note the literature's 2x trap: a HALF-sample-delay Kelly-Lochbaum variant has
 * `sectionLength = c/(2*sampleRate)`, for which 32 sections at 32 kHz WOULD be
 * right (that is why published models quote e.g. 44 segments at 44.1 kHz). This
 * implementation is the full-sample form, so the full-sample relation applies.
 * The calibration test asserts the resulting length empirically rather than
 * trusting either convention.
 */
export const SPEED_OF_SOUND_M_PER_S = 340;
export const ADULT_TRACT_LENGTH_M = 0.170;
export const ADULT_NASAL_LENGTH_M = 0.125;

/** @returns {number} Sections needed to model `lengthM` at `sampleRate`, for this full-sample-delay waveguide. */
export function sectionsForLength(lengthM, sampleRate, speedOfSound = SPEED_OF_SOUND_M_PER_S) {
    return Math.max(2, Math.round((lengthM * sampleRate) / speedOfSound));
}

/** @returns {number} The tract length `numSections` represents at `sampleRate`. */
export function lengthForSections(numSections, sampleRate, speedOfSound = SPEED_OF_SOUND_M_PER_S) {
    return (numSections * speedOfSound) / sampleRate;
}

export const DEFAULT_TRACT_CONFIG = Object.freeze({
    // 32 * 340 / 64000 = 0.170 m — an adult vocal tract.
    //
    // These are DERIVED from `DEFAULT_VOICE_MODEL_CONFIG.sampleRate` (64 kHz) and
    // the anatomical lengths above; they are not free choices. Doubling the sample
    // rate is what allowed doubling them, which halves the section length to
    // 0.53 cm and is what makes distinct consonant PLACES resolvable at all —
    // at 16 sections, SH/S/TH sat within 1.6 sections of each other. Pink
    // Trombone uses 44 for the same 17 cm and reports that below 38 "starts to
    // sound alien", so 32 should be read as a compromise, not a target.
    numSections: 32,
    // 24 * 340 / 64000 = 0.128 m — the nasal cavity is shorter than the oral tract.
    nasalSections: 24,
    glottalReflection: 0.85,
    lipReflection: -0.9,
    nostrilReflection: -0.85,
    /**
     * Per-section transmission factor for the traveling waves.
     *
     * The junctions conserve energy exactly, so before this the ONLY losses were
     * at the glottis and lips and the formants had unrealistically high Q. Real
     * formants have 50-100 Hz of bandwidth from wall, viscous and thermal losses;
     * a resonator without that damping rings after every glottal pulse, and 32 of
     * them ring as a metallic buzz over the speech. Correct formant FREQUENCIES
     * with no bandwidth still does not sound human.
     *
     * 0.995 per section costs `1 - 0.995^32` ~ 15% of amplitude across the tract,
     * putting F1's bandwidth in the right region without smearing the formants into
     * each other. `FormantSolver` MUST use the same value: it calibrates against a
     * CPU model of this tube, and a different loss there would be calibrating a
     * different tube than the one that renders.
     */
    wallLoss: 0.995,
    /** Maximum frication/burst noise bandwidth; low-rate tracts clamp to 40% of their sample rate. */
    fricationBandlimitHz: 10000,
    /** Odd Hann-windowed sinc FIR length for deterministic band-limiting. */
    fricationBandlimitTaps: 65,
});

/** The per-sample solver signals the visualization field carries, in channel order. Exported so a renderer indexes channels by name instead of hard-coding 0/1/2. */
export const VISUAL_CHANNELS = Object.freeze(['oralRadiated', 'nasalTap', 'nasalRadiated']);

/** LF shape defaults. `openQuotient` matches R6's `createGlottalSource({ openQuotient: 0.6 })`; the other two are LF-specific ratios with no R6 equivalent (R6 used the raised-cosine "LF-lite" shape that has no Tp/Ta at all). */
export const DEFAULT_LF_SHAPE = Object.freeze({
    openQuotient: 0.6,  // Te / T0
    peakQuotient: 0.7,  // Tp / Te   (peak flow occurs before closure)
    returnQuotient: 0.012, // Ta / T0 (return-phase time constant; small)
});

/**
 * Common outlet-volume normalization. It only fixes a shared arbitrary scale;
 * relative oral/nasal levels follow each outlet's actual area and reflection.
 */
export const OUTLET_VOLUME_REFERENCE_AREA_CM2 = 6;
export const MAX_RENDER_BATCH_CHUNKS = 32;
export const BATCH_READBACK_SLOT_COUNT = 2;
const OUTLET_VOLUME_REFERENCE_REFLECTION = -0.9;
const OUTLET_VOLUME_REFERENCE = OUTLET_VOLUME_REFERENCE_AREA_CM2
    * (1 - OUTLET_VOLUME_REFERENCE_REFLECTION)
    / (1 + OUTLET_VOLUME_REFERENCE_REFLECTION);

function outletVolumeGain(areaCm2, reflection) {
    return (areaCm2 * (1 - reflection) / (1 + reflection)) / OUTLET_VOLUME_REFERENCE;
}

const RO = 'read-only-storage';
const RW = 'storage';
const UNI = 'uniform';

function ceilDiv(a, b) {
    return Math.ceil(a / b);
}

export class ParticleTract {
    /**
     * @param {GPUDevice} device
     * @param {{ sampleRate: number, chunkSamples: number, numInstances?: number,
     *           numSections?: number, nasalSections?: number,
     *           glottalReflection?: number, lipReflection?: number,
     *           nostrilReflection?: number, nasalTapIndex?: number,
     *           fricationBandlimitHz?: number, fricationBandlimitTaps?: number,
     *           renderBatchChunks?: number,
     *           aspirationSeed?: number, fricationSeed?: number, secondaryFricationSeed?: number, label?: string }} options
     */
    constructor(device, options) {
        if (!device?.createBuffer) throw new TypeError('ParticleTract requires a GPUDevice');
        const {
            sampleRate,
            chunkSamples,
            numInstances = 1,
            numSections = DEFAULT_TRACT_CONFIG.numSections,
            nasalSections = DEFAULT_TRACT_CONFIG.nasalSections,
            glottalReflection = DEFAULT_TRACT_CONFIG.glottalReflection,
            lipReflection = DEFAULT_TRACT_CONFIG.lipReflection,
            nostrilReflection = DEFAULT_TRACT_CONFIG.nostrilReflection,
            wallLoss = DEFAULT_TRACT_CONFIG.wallLoss,
            fricationBandlimitHz = DEFAULT_TRACT_CONFIG.fricationBandlimitHz,
            fricationBandlimitTaps = DEFAULT_TRACT_CONFIG.fricationBandlimitTaps,
            renderBatchChunks = 1,
            // R6's NASAL_TAP_INDEX = floor(NUM_SECTIONS * 0.3): the velum sits
            // roughly 30% along the tract from the glottis.
            nasalTapIndex = Math.floor(numSections * 0.3),
            aspirationSeed = 0x9e37,
            fricationSeed = 0x85eb,
            secondaryFricationSeed = 0xc2b2ae35,
            // 0 (default) disables visualization ENTIRELY: no buffers, no
            // pipeline, no dispatches, no copies are created at all.
            visualFramesPerChunk = 0,
            label = 'ParticleVoice.ParticleTract',
        } = options ?? {};

        if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) throw new RangeError('ParticleTract: sampleRate must be a positive safe integer');
        if (!Number.isInteger(chunkSamples) || chunkSamples <= 0) throw new RangeError('ParticleTract: chunkSamples must be a positive integer');
        if (!Number.isInteger(numInstances) || numInstances <= 0) throw new RangeError('ParticleTract: numInstances must be a positive integer');
        if (!Number.isInteger(numSections) || numSections < 2 || numSections > COUPLED_TRACT_MAX_SECTIONS) throw new RangeError(`ParticleTract: numSections must be in [2, ${COUPLED_TRACT_MAX_SECTIONS}]`);
        if (!Number.isInteger(nasalSections) || nasalSections < 2 || nasalSections > COUPLED_TRACT_MAX_SECTIONS) throw new RangeError(`ParticleTract: nasalSections must be in [2, ${COUPLED_TRACT_MAX_SECTIONS}]`);
        if (![glottalReflection, lipReflection, nostrilReflection]
            .every((value) => Number.isFinite(value) && Math.abs(value) < 1)) {
            // Same BIBO-stability guard R6's createVocalTract enforces — a
            // magnitude >= 1 anywhere in the closed loop allows unbounded
            // energy growth, which is exactly the "energy explosion" the
            // Phase 2 exit gate forbids.
            throw new RangeError('ParticleTract: reflection coefficients must have magnitude < 1 for BIBO stability');
        }
        if (!Number.isInteger(nasalTapIndex) || nasalTapIndex < 0 || nasalTapIndex >= numSections) throw new RangeError('ParticleTract: nasalTapIndex out of range');
        // > 1 would AMPLIFY the traveling waves once per section, which is an
        // energy explosion by construction; <= 0 would mute or invert the tract.
        if (!(wallLoss > 0) || wallLoss > 1) {
            throw new RangeError(`ParticleTract: wallLoss must be in (0, 1], got ${wallLoss}`);
        }
        if (!Number.isFinite(fricationBandlimitHz) || fricationBandlimitHz <= 0) {
            throw new RangeError('ParticleTract: fricationBandlimitHz must be positive and finite');
        }
        if (!Number.isInteger(fricationBandlimitTaps)
            || fricationBandlimitTaps < 9
            || fricationBandlimitTaps > 129
            || fricationBandlimitTaps % 2 !== 1) {
            throw new RangeError('ParticleTract: fricationBandlimitTaps must be an odd integer in [9, 129]');
        }
        if (!Number.isInteger(renderBatchChunks)
            || renderBatchChunks < 1
            || renderBatchChunks > MAX_RENDER_BATCH_CHUNKS) {
            throw new RangeError(`ParticleTract: renderBatchChunks must be an integer in [1, ${MAX_RENDER_BATCH_CHUNKS}]`);
        }
        if (!Number.isInteger(visualFramesPerChunk) || visualFramesPerChunk < 0) {
            throw new RangeError('ParticleTract: visualFramesPerChunk must be a non-negative integer (0 disables visualization)');
        }
        if (visualFramesPerChunk > 0 && chunkSamples % visualFramesPerChunk !== 0) {
            // visual_state_decimate box-averages over a FIXED samples_per_frame
            // window, so an uneven split would silently drop the remainder.
            throw new RangeError(`ParticleTract: chunkSamples (${chunkSamples}) must be divisible by visualFramesPerChunk (${visualFramesPerChunk})`);
        }

        this._device = device;
        this.sampleRate = sampleRate;
        this.chunkSamples = chunkSamples;
        this.numInstances = numInstances;
        this.numSections = numSections;
        this.nasalSections = nasalSections;
        this._glottalReflection = glottalReflection;
        this._lipReflection = lipReflection;
        this._nostrilReflection = nostrilReflection;
        this._wallLoss = wallLoss;
        this._fricationBandlimitHz = Math.min(fricationBandlimitHz, sampleRate * 0.4);
        this._fricationBandlimitTaps = fricationBandlimitTaps;
        this.renderBatchChunks = renderBatchChunks;
        this._configuration = Object.freeze({
            sampleRate,
            chunkSamples,
            numInstances,
            numSections,
            nasalSections,
            glottalReflection,
            lipReflection,
            nostrilReflection,
            wallLoss,
            nasalTapIndex,
            fricationBandlimitHz: this._fricationBandlimitHz,
            fricationBandlimitTaps: this._fricationBandlimitTaps,
            renderBatchChunks,
            outletVolumeReferenceAreaCm2: OUTLET_VOLUME_REFERENCE_AREA_CM2,
        });
        this._nasalTapIndex = nasalTapIndex;
        this._absoluteSample = 0;
        // Per-instance GLOTTAL PHASE, as a normalized cycle fraction [0, 1).
        // This must be tracked separately from `_absoluteSample` and separately
        // from a sample offset within the period — see `encodeChunk`'s note.
        // f64 keeps the running fractional accumulation from drifting.
        this._glottalPhaseCycles = new Float64Array(numInstances);
        this._destroyed = false;

        const I = numInstances;
        const S = chunkSamples;
        const total = I * S;
        this._total = total;
        this._coupledLayout = coupledTractWaveguideOutputLayout(numSections, nasalSections, S, I);
        this._oralLayout = this._coupledLayout.oral;
        this._nasalLayout = this._coupledLayout.nasal;

        this._buffers = [];
        const store = (byteLength, name) => {
            const b = createStorageBuffer(device, byteLength, { label: `${label}.${name}` });
            this._buffers.push(b);
            return b;
        };
        const uni = (byteLength, name) => {
            const b = createUniformBuffer(device, byteLength, { label: `${label}.${name}` });
            this._buffers.push(b);
            return b;
        };

        // ── Glottal LF source ────────────────────────────────────────────
        this._lfT0 = store(I * 4, 'lf.t0');
        this._lfTe = store(I * 4, 'lf.te');
        this._lfTp = store(I * 4, 'lf.tp');
        this._lfTa = store(I * 4, 'lf.ta');
        this._lfEe = store(I * 8, 'lf.ee');
        this._lfStartPhase = store(I * 4, 'lf.startPhase');
        this._voicing = store(total * 4, 'voicing');

        // The optional second oral source has an independent indexed seed.
        // Pack both oral streams in the existing bindings, primary first;
        // primary seeds, clocks and arithmetic retain their original values.
        this._aspSeed = store(I * 4, 'asp.seed');
        this._aspStart = store(I * 4, 'asp.start');
        this._aspEnv = store(total * 4, 'asp.env');
        this._aspNoise = store(total * 4, 'asp.noise');
        this._fricSeed = store(I * 8, 'fric.seed');
        this._fricStart = store(I * 8, 'fric.start');
        this._fricEnv = store(total * 8, 'fric.env');
        this._fricNoise = store(total * 8, 'fric.noise');

        this._sourceFlow = store(total * 4, 'sourceFlow');
        this._sourceVolumeGain = store(total * 4, 'sourceVolumeGain');

        // ── Oral tract ───────────────────────────────────────────────────
        // Two coefficient sets per instance: [start, end]. The kernel
        // interpolates between them per sample so tract geometry is continuous
        // across chunk boundaries.
        this._oralK = store(I * (2 * (numSections - 1) + 6) * 4, 'oral.k-and-port');
        this._oralRightIn = store(I * (numSections + nasalSections) * 4, 'tract.rightIn');
        this._oralLeftIn = store(I * (numSections + nasalSections) * 4, 'tract.leftIn');
        this._oralPrevIn = store(I * 2 * 4, 'tract.prevIn');
        this._oralPacked = store(this._coupledLayout.totalLength * 4, 'tract.packed');

        // ── Nasal branch ─────────────────────────────────────────────────
        this._nasalK = store(I * 2 * (nasalSections - 1) * 4, 'nasal.k');
        this._nasalPacked = store(this._nasalLayout.totalLength * 4, 'nasal.packed');

        // Per-sample pressure→volume conversion at the two radiating outlets.
        this._oralOutletGain = store(total * 4, 'oral.outletVolumeGain');
        this._nasalOutletGain = store(total * 4, 'nasal.outletVolumeGain');

        this._output = store(total * 4, 'output');

        // ── Optional visualization ───────────────────────────────────────
        // Nothing below is allocated when visualFramesPerChunk is 0, which is
        // what makes "disabled" structural rather than a runtime branch.
        this.visualFramesPerChunk = visualFramesPerChunk;
        this.visualChannels = visualFramesPerChunk > 0 ? VISUAL_CHANNELS.length : 0;
        this._visualEnabled = visualFramesPerChunk > 0;
        if (this._visualEnabled) {
            const channels = VISUAL_CHANNELS.length;
            const samplesPerFrame = chunkSamples / visualFramesPerChunk;
            this._visualSamplesPerFrame = samplesPerFrame;
            this._visualFieldLength = I * channels * S;
            this._visualOutLength = I * channels * visualFramesPerChunk;
            this._visualField = store(this._visualFieldLength * 4, 'visual.field');
            this._visualDecimated = store(this._visualOutLength * 4, 'visual.decimated');
            this._visualU = uni(16, 'visual.params');
            device.queue.writeBuffer(this._visualU, 0, new Uint32Array([channels, samplesPerFrame, visualFramesPerChunk, I]));
            this._visualStaging = device.createBuffer({
                label: `${label}.visual.staging`,
                size: this._visualOutLength * 4,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            });
        }

        // ── Uniforms ─────────────────────────────────────────────────────
        // These three never change after construction: shape is fixed.
        this._lfU = uni(16, 'lf.params');
        device.queue.writeBuffer(this._lfU, 0, new Uint32Array([S, I, 0, 0]));
        this._noiseU = uni(16, 'noise.params');
        device.queue.writeBuffer(this._noiseU, 0, new Uint32Array([S, I, 0, 0]));
        this._fricNoiseU = uni(16, 'fric.noise.params');
        device.queue.writeBuffer(this._fricNoiseU, 0, new Uint32Array([S, I * 2, 0, 0]));
        this._addU = uni(16, 'add.params');
        device.queue.writeBuffer(this._addU, 0, new Uint32Array([total, 0, 0, 0]));
        // Per-chunk articulation; port coupling lives in the geometry weights.
        this._tractU = uni(64, 'oral.params');

        // Seeds are constant for the tract's lifetime; distinct per instance so
        // N simultaneous voices never share correlated turbulence.
        const aspSeeds = new Uint32Array(I);
        const fricSeeds = new Uint32Array(I * 2);
        for (let i = 0; i < I; i++) {
            aspSeeds[i] = (aspirationSeed + i * 0x9e3779b9) >>> 0;
            fricSeeds[i] = (fricationSeed + i * 0x85ebca6b) >>> 0;
            fricSeeds[I + i] = (secondaryFricationSeed + i * 0x85ebca6b) >>> 0;
        }
        device.queue.writeBuffer(this._aspSeed, 0, aspSeeds);
        device.queue.writeBuffer(this._fricSeed, 0, fricSeeds);

        this._stages = this._buildStages(label);
        this._staging = device.createBuffer({
            label: `${label}.staging`,
            size: total * 4,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        // Whole-utterance rendering can keep two bounded readbacks in flight.
        // Each slot holds up to `renderBatchChunks` consecutive PCM chunks plus
        // their optional decimated visualization fields. Acoustic state and
        // controls remain in the existing per-chunk buffers; batching removes
        // only the per-chunk CPU/GPU map barrier.
        this._batchStates = new WeakMap();
        this._activeBatchHandles = new Set();
        this._batchPcmChunkBytes = total * 4;
        this._batchVisualChunkBytes = this._visualEnabled ? this._visualOutLength * 4 : 0;
        this._batchVisualBaseBytes = renderBatchChunks * this._batchPcmChunkBytes;
        this._batchSlotBytes = this._batchVisualBaseBytes
            + renderBatchChunks * this._batchVisualChunkBytes;
        this._batchReadbackSlots = [];
        if (renderBatchChunks > 1) {
            try {
                for (let slot = 0; slot < BATCH_READBACK_SLOT_COUNT; slot++) {
                    this._batchReadbackSlots.push({
                        buffer: device.createBuffer({
                            label: `${label}.batchReadback${slot}`,
                            size: this._batchSlotBytes,
                            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
                        }),
                        free: true,
                    });
                }
            } catch (error) {
                // A constructor that never returns has no owner that can call
                // destroy(). Roll back every buffer allocated by this partial
                // tract, including an earlier batch slot, before propagating
                // the allocation failure.
                try {
                    destroyBuffers([
                        ...this._batchReadbackSlots.map((slot) => slot.buffer),
                        this._staging,
                        this._visualStaging,
                        ...this._buffers,
                    ].filter(Boolean));
                } catch (cleanupError) {
                    throw new AggregateError(
                        [error, cleanupError],
                        'ParticleTract batch readback allocation and rollback both failed',
                    );
                }
                throw error;
            }
        }

        // Scratch typed arrays, allocated once: renderChunk() runs per audio
        // chunk, so it must not allocate per call.
        this._scratch = {
            t0: new Float32Array(I), te: new Float32Array(I), tp: new Float32Array(I),
            ta: new Float32Array(I), ee: new Float32Array(I * 2), startPhase: new Float32Array(I),
            startIndex: new Uint32Array(I),
            fricStartIndex: new Uint32Array(I * 2),
            aspEnv: new Float32Array(total), fricEnv: new Float32Array(total * 2),
            // Noise amplitudes the previous chunk ENDED at, so this chunk can ramp
            // from them instead of stepping. See the ramp in encodeChunk.
            previousAsp: new Float32Array(I), previousFric: new Float32Array(I),
            oralK: new Float32Array(I * (2 * (numSections - 1) + 6)),
            // Geometry the previous chunk ENDED at, so this chunk can start there.
            previousK: new Float32Array(I * (numSections - 1)),
            previousPortWeights: new Float32Array(I * 3),
            previousNasalK: new Float32Array(I * (nasalSections - 1)),
            previousOralOutletArea: new Float32Array(I),
            previousOralInletArea: new Float32Array(I),
            previousNasalOutletGain: new Float32Array(I),
            sourceVolumeGain: new Float32Array(total),
            oralOutletGain: new Float32Array(total),
            nasalOutletGain: new Float32Array(total),
            hasPreviousK: false,
            nasalK: new Float32Array(I * 2 * (nasalSections - 1)),
            tractU: new ArrayBuffer(64),
        };

        this.reset();
    }

    /** The GPU buffer holding the most recent chunk's PCM. Exposed so a caller can hand it straight to `streaming/GPUReadbackRing.js` and keep the audio GPU-resident instead of paying for `renderChunk()`'s readback. */
    get outputBuffer() {
        return this._output;
    }

    get absoluteSample() {
        return this._absoluteSample;
    }

    /** Frozen resolved numeric controls for diagnostics; reading it acquires no resources. */
    get configuration() {
        return this._configuration;
    }

    _buildStage(label, code, bindings, workgroups) {
        const device = this._device;
        const module = device.createShaderModule({ label, code });
        const bindGroupLayout = device.createBindGroupLayout({
            label: `${label}.bgl`,
            entries: bindings.map((b, i) => ({ binding: i, visibility: GPUShaderStage.COMPUTE, buffer: { type: b.type } })),
        });
        const pipeline = device.createComputePipeline({
            label,
            layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
            compute: { module, entryPoint: 'main' },
        });
        const bindGroup = device.createBindGroup({
            label: `${label}.bg`,
            layout: bindGroupLayout,
            entries: bindings.map((b, i) => ({
                binding: i,
                resource: b.size === undefined ? { buffer: b.buffer } : { buffer: b.buffer, offset: 0, size: b.size },
            })),
        });
        return { label, pipeline, bindGroup, workgroups };
    }

    _buildStages(label) {
        const I = this.numInstances;
        const total = this._total;
        const flat = ceilDiv(total, GLOTTAL_LF_WORKGROUP_SIZE.x);

        const visual = this._visualEnabled
            ? this._buildStage(`${label}.visual_state_decimate`, visualStateDecimateShader(), [
                { buffer: this._visualU, type: UNI },
                { buffer: this._visualField, type: RO },
                { buffer: this._visualDecimated, type: RW },
            ], ceilDiv(this._visualOutLength, VISUAL_STATE_DECIMATE_WORKGROUP_SIZE.x))
            : null;

        return {
            visual,
            glottal: this._buildStage(`${label}.glottal_lf`, glottalLfShader({ interpolateExcitation: true }), [
                { buffer: this._lfU, type: UNI },
                { buffer: this._lfT0, type: RO }, { buffer: this._lfTe, type: RO },
                { buffer: this._lfTp, type: RO }, { buffer: this._lfTa, type: RO },
                { buffer: this._lfEe, type: RO }, { buffer: this._lfStartPhase, type: RO },
                { buffer: this._voicing, type: RW },
            ], flat),

            aspiration: this._buildStage(`${label}.aspiration`, constrictionNoiseShader({ spectralShape: 'lowpass', lowpassHold: 32 }), [
                { buffer: this._noiseU, type: UNI },
                { buffer: this._aspSeed, type: RO }, { buffer: this._aspStart, type: RO },
                { buffer: this._aspEnv, type: RO },
                { buffer: this._aspNoise, type: RW },
            ], ceilDiv(total, CONSTRICTION_NOISE_WORKGROUP_SIZE.x)),

            frication: this._buildStage(`${label}.frication`, constrictionNoiseShader({
                spectralShape: 'bandlimited',
                sampleRate: this.sampleRate,
                bandlimitHz: this._fricationBandlimitHz,
                bandlimitTaps: this._fricationBandlimitTaps,
            }), [
                { buffer: this._fricNoiseU, type: UNI },
                { buffer: this._fricSeed, type: RO }, { buffer: this._fricStart, type: RO },
                { buffer: this._fricEnv, type: RO },
                { buffer: this._fricNoise, type: RW },
            ], ceilDiv(total, CONSTRICTION_NOISE_WORKGROUP_SIZE.x)),

            sourceMix: this._buildStage(`${label}.source_volume_mix`, sourceVolumeMixShader(), [
                { buffer: this._addU, type: UNI },
                { buffer: this._voicing, type: RO }, { buffer: this._aspNoise, type: RO },
                { buffer: this._sourceVolumeGain, type: RO },
                { buffer: this._sourceFlow, type: RW },
            ], ceilDiv(total, SOURCE_VOLUME_MIX_WORKGROUP_SIZE.x)),

            coupled: this._buildStage(`${label}.coupled_tract_waveguide`, coupledTractWaveguideShader({ secondaryNoise: true }), [
                { buffer: this._tractU, type: UNI },
                { buffer: this._oralK, type: RO }, { buffer: this._nasalK, type: RO },
                { buffer: this._sourceFlow, type: RO },
                { buffer: this._fricNoise, type: RO },
                { buffer: this._oralRightIn, type: RO }, { buffer: this._oralLeftIn, type: RO },
                { buffer: this._oralPrevIn, type: RO },
                { buffer: this._oralPacked, type: RW },
            ], I),

            // The radiated block sits at offset 0 in BOTH packed buffers (see
            // tractWaveguideOutputLayout), so these bindings can read a
            // zero-offset sub-range directly — no copy needed, and offset 0
            // trivially satisfies minStorageBufferOffsetAlignment.
            outputMix: this._buildStage(`${label}.outlet_volume_mix`, outletVolumeMixShader(), [
                { buffer: this._addU, type: UNI },
                { buffer: this._oralPacked, type: RW, size: total * 4 },
                { buffer: this._nasalPacked, type: RW, size: total * 4 },
                { buffer: this._oralOutletGain, type: RO },
                { buffer: this._nasalOutletGain, type: RO },
                { buffer: this._output, type: RW },
            ], ceilDiv(total, OUTLET_VOLUME_MIX_WORKGROUP_SIZE.x)),
        };
    }

    /** Clear all persisted traveling-wave state and restart the absolute sample counter — the utterance-boundary / cancellation reset, mirroring `streaming/SharedPCMRing.js`'s reset-on-discontinuity convention. */
    reset() {
        this._assertNotDestroyed();
        if (this._activeBatchHandles.size > 0) {
            throw new Error('ParticleTract: cannot reset while a chunk batch readback is in flight');
        }
        const q = this._device.queue;
        const I = this.numInstances;
        q.writeBuffer(this._oralRightIn, 0, new Float32Array(I * (this.numSections + this.nasalSections)));
        q.writeBuffer(this._oralLeftIn, 0, new Float32Array(I * (this.numSections + this.nasalSections)));
        q.writeBuffer(this._oralPrevIn, 0, new Float32Array(I * 2));
        this._absoluteSample = 0;
        this._glottalPhaseCycles.fill(0);
        // Forget the previous geometry too: after a reset the next chunk must
        // start AT its target rather than sliding in from a discarded utterance's
        // shape, which would be an audible swoop at every utterance start.
        if (this._scratch) {
            this._scratch.hasPreviousK = false;
            this._scratch.hasPreviousEnv = false;
        }
    }

    /**
     * Per-instance glottal phase in samples of the most recently dispatched
     * period. This preserves the original public diagnostic unit even though
     * the oscillator is now stored internally in normalized cycles.
     */
    glottalPhaseAt(instance) {
        return this._glottalPhaseCycles[instance] * this._scratch.t0[instance];
    }

    /** Per-instance normalized glottal phase in cycles `[0, 1)`. */
    glottalPhaseCyclesAt(instance) {
        return this._glottalPhaseCycles[instance];
    }

    /**
     * Render exactly `chunkSamples` samples per instance.
     *
     * @param {{ instances: Array<object>, constrictionIndex?: number, secondaryConstrictionIndex?: number, nasalCoupling?: number }} controls
     *   `instances[i]` supplies `{ areas, nasalAreas?, f0Hz, ee?, openQuotient?,
     *   peakQuotient?, returnQuotient?, sourceGain?, aspiration?, aspirationEnvelope?,
     *   frication?, fricationEnvelope?, secondaryFricationEnvelope? }`. `sourceGain` is a bounded post-LF
     *   gate for an already-solved source; omitted means unity.
     *   `nasalCoupling` in [0, 1] scales the first nasal section's area;
     *   zero closes the port. Both top-level controls are shared by instances.
     *   A second oral source is optional: its index defaults to -1 and its
     *   per-sample envelope defaults to zero. Sources at the same junction add
     *   before scattering. An omitted second source leaves the primary exact.
     * @returns {Promise<Float32Array>} `[numInstances, chunkSamples]` PCM.
     */
    async renderChunk(controls) {
        this._assertNotDestroyed();
        this.encodeChunk(controls);
        return this._readOutput();
    }

    /**
     * Encode + submit one chunk without reading it back, leaving the PCM in
     * `outputBuffer`. Separate from `renderChunk()` so a GPU-resident caller
     * (e.g. feeding `GPUReadbackRing`) never pays for a map/copy it does not
     * want.
     */
    encodeChunk(controls) {
        return this._encodeChunk(controls, null);
    }

    _encodeChunk(controls, batchCopy) {
        this._assertNotDestroyed();
        const device = this._device;
        const I = this.numInstances;
        const S = this.chunkSamples;
        const instances = controls?.instances;
        if (!Array.isArray(instances) || instances.length !== I) {
            throw new RangeError(`ParticleTract: controls.instances must be an array of ${I} entries`);
        }
        const constrictionIndex = controls.constrictionIndex ?? -1;
        if (!Number.isInteger(constrictionIndex) || constrictionIndex < -1 || constrictionIndex >= this.numSections - 1) {
            // Junction i couples sections i and i+1, so only [0, numSections-1) exist.
            throw new RangeError(`ParticleTract: constrictionIndex must be an integer in [-1, ${this.numSections - 2}]`);
        }
        const secondaryConstrictionIndex = controls.secondaryConstrictionIndex ?? -1;
        if (!Number.isInteger(secondaryConstrictionIndex) || secondaryConstrictionIndex < -1
            || secondaryConstrictionIndex >= this.numSections - 1) {
            throw new RangeError(`ParticleTract: secondaryConstrictionIndex must be an integer in [-1, ${this.numSections - 2}]`);
        }
        const nasalCoupling = controls.nasalCoupling ?? 0;
        if (!Number.isFinite(nasalCoupling) || nasalCoupling < 0 || nasalCoupling > 1) {
            throw new RangeError('ParticleTract: nasalCoupling must be finite and in [0, 1]');
        }

        // Reject an invalid chunk before advancing any instance's phase,
        // excitation or geometry history. A late envelope/nasal error used to
        // leave a partially advanced chunk behind, corrupting a valid retry.
        const resolvedInstances = Array.from(instances, (instance, i) => {
            const c = instance ?? {};
            const {
                areas, nasalAreas, f0Hz, ee = 1,
                openQuotient = DEFAULT_LF_SHAPE.openQuotient,
                peakQuotient = DEFAULT_LF_SHAPE.peakQuotient,
                returnQuotient = DEFAULT_LF_SHAPE.returnQuotient,
                sourceGain = 1,
                aspiration = 0, aspirationEnvelope, frication = 0, fricationEnvelope,
                secondaryFricationEnvelope,
            } = c;

            if (!(areas?.length === this.numSections)) {
                throw new RangeError(`ParticleTract: instance ${i} areas must have length ${this.numSections}`);
            }
            for (let section = 0; section < areas.length; section++) {
                if (!Number.isFinite(areas[section]) || areas[section] <= 0) {
                    throw new RangeError(`ParticleTract: instance ${i} areas[${section}] must be positive and finite`);
                }
            }
            if (!Number.isFinite(f0Hz) || f0Hz <= 0) throw new RangeError(`ParticleTract: instance ${i} f0Hz must be positive`);
            if (!Number.isFinite(ee) || ee <= 0) throw new RangeError(`ParticleTract: instance ${i} ee must be positive and finite`);
            if (!Number.isFinite(openQuotient) || !(openQuotient > 0 && openQuotient < 1)) throw new RangeError(`ParticleTract: instance ${i} openQuotient must be finite and in (0, 1)`);
            if (!Number.isFinite(peakQuotient) || !(peakQuotient > 0 && peakQuotient < 1)) throw new RangeError(`ParticleTract: instance ${i} peakQuotient must be finite and in (0, 1)`);
            if (!Number.isFinite(returnQuotient) || !(returnQuotient > 0 && returnQuotient < 1)) throw new RangeError(`ParticleTract: instance ${i} returnQuotient must be finite and in (0, 1)`);
            if (!Number.isFinite(sourceGain) || sourceGain < 0 || sourceGain > 1) {
                throw new RangeError(`ParticleTract: instance ${i} sourceGain must be finite and in [0, 1]`);
            }
            for (const [name, value] of [['aspiration', aspiration], ['frication', frication]]) {
                if (!Number.isFinite(value)) throw new RangeError(`ParticleTract: instance ${i} ${name} must be finite`);
            }
            for (const [name, envelope] of [['aspirationEnvelope', aspirationEnvelope], ['fricationEnvelope', fricationEnvelope],
                ['secondaryFricationEnvelope', secondaryFricationEnvelope]]) {
                if (envelope === undefined || envelope === null) continue;
                if (envelope.length !== S) throw new RangeError(`ParticleTract: instance ${i} ${name} must have length ${S}`);
                for (let sample = 0; sample < S; sample++) {
                    if (!Number.isFinite(envelope[sample])) throw new RangeError(`ParticleTract: instance ${i} ${name}[${sample}] must be finite`);
                }
            }
            if (nasalAreas) {
                if (nasalAreas.length !== this.nasalSections) throw new RangeError(`ParticleTract: instance ${i} nasalAreas must have length ${this.nasalSections}`);
                for (let section = 0; section < nasalAreas.length; section++) {
                    if (!Number.isFinite(nasalAreas[section]) || nasalAreas[section] <= 0) {
                        throw new RangeError(`ParticleTract: instance ${i} nasalAreas[${section}] must be positive and finite`);
                    }
                }
            }
            return { areas, nasalAreas, f0Hz, ee, openQuotient, peakQuotient, returnQuotient,
                sourceGain, aspiration, aspirationEnvelope, frication, fricationEnvelope, secondaryFricationEnvelope };
        });

        const s = this._scratch;
        for (let i = 0; i < I; i++) {
            const { areas, nasalAreas, f0Hz, ee, openQuotient, peakQuotient, returnQuotient,
                sourceGain, aspiration, aspirationEnvelope, frication, fricationEnvelope, secondaryFricationEnvelope } = resolvedInstances[i];

            // LF control instants in SAMPLES, matching glottal_lf.js's stated
            // convention. Ordering 0 < Tp < Te < T0 is guaranteed by the
            // quotient ranges validated above, so the kernel's Newton solves
            // never see a degenerate configuration.
            const t0 = this.sampleRate / f0Hz;
            s.t0[i] = t0;
            s.te[i] = openQuotient * t0;
            s.tp[i] = peakQuotient * s.te[i];
            s.ta[i] = returnQuotient * t0;
            // Ee already includes the caller's pressure multiplier. Carry its
            // exact prior endpoint and interpolate only the LF source; scaling
            // source_volume_mix instead would also distort aspiration bursts.
            s.ee[2 * i] = s.hasPreviousEnv ? s.ee[2 * i + 1] : ee;
            s.ee[2 * i + 1] = ee;

            // ── Glottal phase: a maintained NORMALIZED-CYCLE accumulator,
            // not the absolute sample counter and not a sample offset.
            //
            // `glottal_lf.js` computes `cycle_pos = (start_phase + n) mod t0`.
            // Passing the absolute sample counter here is only phase-continuous
            // while `t0` never changes — and F0 changes EVERY chunk (declination,
            // stress, terminal contour). `absoluteSample mod t0` then jumps
            // discontinuously at every chunk boundary, and the jump GROWS with
            // elapsed samples: by sample 80 000 a half-sample change in `t0`
            // rotates the phase by most of a period. That scrambles the glottal
            // pulse train at the chunk rate (31 Hz at 1024/32 kHz), which is
            // audible as a low buzzing sputter rather than as speech.
            //
            // A sample offset is still wrong when `t0` changes: e.g. sample 240
            // is phase 0.45 at T0=533 but phase 0.48 at T0=500. Since Te, Tp and
            // Ta all scale with T0, reinterpreting the old sample coordinate in
            // the new period jumps to a different point on the LF pulse at every
            // control boundary. With 4 ms chunks those impulses repeat at
            // 250 Hz, heard as a throat-like buzz.
            //
            // Phase angle is the continuous state of a variable-frequency
            // oscillator, so carry it in cycles. Convert to the kernel's sample
            // convention only for this dispatch, then advance by the exact
            // number of cycles elapsed under this chunk's T0.
            const phaseCycles = this._glottalPhaseCycles[i];
            s.startPhase[i] = phaseCycles * t0;
            this._glottalPhaseCycles[i] = (phaseCycles + S / t0) % 1;

            // Noise streams DO want the absolute counter: it decorrelates
            // aspiration/frication across time and instances, and has no
            // periodicity to preserve.
            s.startIndex[i] = this._absoluteSample >>> 0;
            s.fricStartIndex[i] = s.startIndex[i];
            s.fricStartIndex[I + i] = s.startIndex[i];

            const base = i * S;
            // RAMP the noise amplitudes across the chunk rather than holding them
            // constant.
            //
            // `fill()` made each envelope piecewise-constant, so turbulence level
            // stepped once per chunk — the same staircase artifact that was fixed
            // for the tract geometry, injecting energy at the chunk rate. It stayed
            // hidden while frication was quiet and became significant the moment
            // `fricationAmplitude` was raised to a realistic level: the chunk-size
            // invariance check fell to 0.74 cosine similarity.
            //
            // Before the first chunk (and after `reset()`) there is no previous
            // value, so the chunk starts AT its target rather than ramping up from
            // zero, which would soften every utterance's first consonant.
            if (aspirationEnvelope) {
                s.aspEnv.set(aspirationEnvelope, base);
                s.previousAsp[i] = aspirationEnvelope[S - 1];
            } else {
                const aspFrom = s.hasPreviousEnv ? s.previousAsp[i] : aspiration;
                for (let n = 0; n < S; n++) {
                    s.aspEnv[base + n] = aspFrom + ((aspiration - aspFrom) * (n + 1)) / S;
                }
                s.previousAsp[i] = aspiration;
            }

            if (fricationEnvelope) {
                // An explicit per-sample envelope is already resolved in time, so
                // interpolating it would fight the caller.
                s.fricEnv.set(fricationEnvelope, base);
                s.previousFric[i] = fricationEnvelope[S - 1];
            } else {
                const fricFrom = s.hasPreviousEnv ? s.previousFric[i] : frication;
                for (let n = 0; n < S; n++) {
                    s.fricEnv[base + n] = fricFrom + ((frication - fricFrom) * (n + 1)) / S;
                }
                s.previousFric[i] = frication;
            }
            const secondaryBase = this._total + base;
            if (secondaryFricationEnvelope) s.fricEnv.set(secondaryFricationEnvelope, secondaryBase);
            else s.fricEnv.fill(0, secondaryBase, secondaryBase + S);

            // Interpolate FROM where the previous chunk's geometry ended TO this
            // chunk's target. On the very first chunk after a reset there is no
            // previous geometry, so start and end are the same — the utterance
            // simply begins already in its first shape rather than sliding into
            // it from an arbitrary one.
            const J = this.numSections - 1;
            const target = reflectionCoefficients(areas);
            const startSlot = i * (2 * J + 6);
            if (s.hasPreviousK) {
                s.oralK.set(s.previousK.subarray(i * J, (i + 1) * J), startSlot);
            } else {
                s.oralK.set(target, startSlot);
            }
            s.oralK.set(target, startSlot + J);
            s.previousK.set(target, i * J);
            const targetOutletArea = areas[this.numSections - 1];
            const startOutletArea = s.hasPreviousK ? s.previousOralOutletArea[i] : targetOutletArea;
            const targetInletArea = areas[0];
            const startInletArea = s.hasPreviousK ? s.previousOralInletArea[i] : targetInletArea;
            const outletDenom = Math.max(1, S - 1);
            for (let n = 0; n < S; n++) {
                const t = n / outletDenom;
                const oralArea = startOutletArea + (targetOutletArea - startOutletArea) * t;
                s.oralOutletGain[base + n] = outletVolumeGain(oralArea, this._lipReflection);
                const inletArea = startInletArea + (targetInletArea - startInletArea) * t;
                // Convert the solved LF derivative-shaped source into the
                // tract's normalized pressure-wave convention. `sourceGain`
                // is applied here, after LF solving, so a deliberately silent
                // prefix can be exactly gated without ever sending ee=0 into
                // the LF kernel's Newton solve.
                s.sourceVolumeGain[base + n] = (OUTLET_VOLUME_REFERENCE_AREA_CM2 / inletArea) * sourceGain;
            }
            s.previousOralOutletArea[i] = targetOutletArea;
            s.previousOralInletArea[i] = targetInletArea;
            const NJ = this.nasalSections - 1;
            const nasalSlot = i * 2 * NJ;
            let targetNasalGain = 0;
            let portArea = 0;
            if (nasalAreas) {
                portArea = nasalAreas[0] * nasalCoupling;
                const nasalTarget = reflectionCoefficients(nasalAreas);
                // The first nasal section is the moving velar port. Its area
                // must agree with the target three-port scattering weights,
                // including the exactly closed limit. Between chunk endpoints
                // we retain the oral kernel's coefficient-interpolation
                // approximation rather than solving exact moving-area flow.
                nasalTarget[0] = (portArea - nasalAreas[1]) / (portArea + nasalAreas[1]);
                s.nasalK.set(nasalTarget, nasalSlot + NJ);
                targetNasalGain = outletVolumeGain(nasalAreas[this.nasalSections - 1], this._nostrilReflection);
            } else {
                // An omitted nose disconnects the port. Retain its last tube
                // shape so any stored waves decay instead of being reset.
                s.nasalK.set(s.previousNasalK.subarray(i * NJ, (i + 1) * NJ), nasalSlot + NJ);
            }
            const nasalTarget = s.nasalK.subarray(nasalSlot + NJ, nasalSlot + 2 * NJ);
            s.nasalK.set(s.hasPreviousK ? s.previousNasalK.subarray(i * NJ, (i + 1) * NJ) : nasalTarget, nasalSlot);
            s.previousNasalK.set(nasalTarget, i * NJ);
            const port = Math.min(this._nasalTapIndex, this.numSections - 2);
            const areaSum = areas[port] + areas[port + 1] + portArea;
            const weightSlot = startSlot + 2 * J;
            s.oralK[weightSlot + 3] = 2 * areas[port] / areaSum;
            s.oralK[weightSlot + 4] = 2 * areas[port + 1] / areaSum;
            s.oralK[weightSlot + 5] = 2 * portArea / areaSum;
            const targetWeights = s.oralK.subarray(weightSlot + 3, weightSlot + 6);
            s.oralK.set(s.hasPreviousK ? s.previousPortWeights.subarray(i * 3, i * 3 + 3) : targetWeights, weightSlot);
            s.previousPortWeights.set(targetWeights, i * 3);
            const startNasalGain = s.hasPreviousK ? s.previousNasalOutletGain[i] : targetNasalGain;
            for (let n = 0; n < S; n++) {
                s.nasalOutletGain[base + n] = startNasalGain + (targetNasalGain - startNasalGain) * n / outletDenom;
            }
            s.previousNasalOutletGain[i] = targetNasalGain;
        }
        s.hasPreviousK = true;
        s.hasPreviousEnv = true;

        const q = device.queue;
        q.writeBuffer(this._lfT0, 0, s.t0);
        q.writeBuffer(this._lfTe, 0, s.te);
        q.writeBuffer(this._lfTp, 0, s.tp);
        q.writeBuffer(this._lfTa, 0, s.ta);
        q.writeBuffer(this._lfEe, 0, s.ee);
        q.writeBuffer(this._lfStartPhase, 0, s.startPhase);
        q.writeBuffer(this._aspStart, 0, s.startIndex);
        q.writeBuffer(this._fricStart, 0, s.fricStartIndex);
        q.writeBuffer(this._aspEnv, 0, s.aspEnv);
        q.writeBuffer(this._fricEnv, 0, s.fricEnv);
        q.writeBuffer(this._sourceVolumeGain, 0, s.sourceVolumeGain);
        q.writeBuffer(this._oralK, 0, s.oralK);
        q.writeBuffer(this._nasalK, 0, s.nasalK);
        q.writeBuffer(this._oralOutletGain, 0, s.oralOutletGain);
        q.writeBuffer(this._nasalOutletGain, 0, s.nasalOutletGain);

        const tu32 = new Uint32Array(s.tractU);
        const tf32 = new Float32Array(s.tractU);
        const ti32 = new Int32Array(s.tractU);
        tu32[0] = this.numSections; tu32[1] = this.nasalSections; tu32[2] = S; tu32[3] = I;
        // radiation_difference = 0: this tract's excitation is `glottal_lf`,
        // which is already the glottal flow DERIVATIVE. Applying the lip
        // first-difference on top would double-differentiate — +6 dB/octave of
        // spurious tilt plus a spiky waveform that drives the limiter into
        // distorting every pitch pulse. See tract_waveguide.js's note.
        tf32[4] = this._glottalReflection; tf32[5] = this._lipReflection; tf32[6] = this._nostrilReflection; tf32[7] = this._wallLoss;
        ti32[8] = constrictionIndex; ti32[9] = this._nasalTapIndex; tf32[10] = 0; tf32[11] = 0;
        ti32[12] = secondaryConstrictionIndex;
        q.writeBuffer(this._tractU, 0, s.tractU);

        const st = this._stages;
        const encoder = device.createCommandEncoder({ label: 'ParticleTract.chunk' });
        const run = (stage, workgroups = stage.workgroups) => {
            const pass = encoder.beginComputePass({ label: stage.label });
            pass.setPipeline(stage.pipeline);
            pass.setBindGroup(0, stage.bindGroup);
            pass.dispatchWorkgroups(workgroups, 1, 1);
            pass.end();
        };

        run(st.glottal);
        run(st.aspiration);
        run(st.frication, secondaryConstrictionIndex >= 0
            ? ceilDiv(this._total * 2, CONSTRICTION_NOISE_WORKGROUP_SIZE.x) : st.frication.workgroups);
        run(st.sourceMix);
        run(st.coupled);

        // Retain the mixer's original zero-offset nasal layout. The appended
        // block need not satisfy storage-buffer alignment, so copy it rather
        // than binding an unaligned range into the combined solver output.
        encoder.copyBufferToBuffer(this._oralPacked, this._coupledLayout.nasalOffset * 4, this._nasalPacked, 0, this._nasalLayout.totalLength * 4);
        run(st.outputMix);

        // Visualization, if enabled. Every operation here READS the acoustic
        // path's already-final outputs and writes only into visualization
        // buffers, so it cannot perturb the PCM — and when disabled none of it
        // is encoded at all.
        if (this._visualEnabled) {
            const channels = VISUAL_CHANNELS.length;
            const bytesPerChannel = S * 4;
            for (let i = 0; i < I; i++) {
                const dst = (c) => (i * channels + c) * bytesPerChannel;
                encoder.copyBufferToBuffer(this._oralPacked, (this._oralLayout.radiatedOffset + i * S) * 4, this._visualField, dst(0), bytesPerChannel);
                encoder.copyBufferToBuffer(this._oralPacked, (this._oralLayout.nasalTapOffset + i * S) * 4, this._visualField, dst(1), bytesPerChannel);
                encoder.copyBufferToBuffer(this._nasalPacked, (this._nasalLayout.radiatedOffset + i * S) * 4, this._visualField, dst(2), bytesPerChannel);
            }
            run(st.visual);
            if (batchCopy) {
                encoder.copyBufferToBuffer(
                    this._visualDecimated,
                    0,
                    batchCopy.buffer,
                    batchCopy.visualByteOffset,
                    this._batchVisualChunkBytes,
                );
            } else {
                encoder.copyBufferToBuffer(this._visualDecimated, 0, this._visualStaging, 0, this._visualOutLength * 4);
            }
        }

        // Persist traveling-wave state for the next chunk, entirely on GPU.
        const oralStateBytes = I * this.numSections * 4;
        encoder.copyBufferToBuffer(this._oralPacked, this._oralLayout.finalRightOffset * 4, this._oralRightIn, 0, oralStateBytes);
        encoder.copyBufferToBuffer(this._oralPacked, this._oralLayout.finalLeftOffset * 4, this._oralLeftIn, 0, oralStateBytes);
        encoder.copyBufferToBuffer(this._oralPacked, this._oralLayout.finalPrevOutputOffset * 4, this._oralPrevIn, 0, I * 4);
        const nasalStateBytes = I * this.nasalSections * 4;
        encoder.copyBufferToBuffer(this._nasalPacked, this._nasalLayout.finalRightOffset * 4, this._oralRightIn, oralStateBytes, nasalStateBytes);
        encoder.copyBufferToBuffer(this._nasalPacked, this._nasalLayout.finalLeftOffset * 4, this._oralLeftIn, oralStateBytes, nasalStateBytes);
        encoder.copyBufferToBuffer(this._nasalPacked, this._nasalLayout.finalPrevOutputOffset * 4, this._oralPrevIn, I * 4, I * 4);

        if (batchCopy) {
            encoder.copyBufferToBuffer(
                this._output,
                0,
                batchCopy.buffer,
                batchCopy.pcmByteOffset,
                this._batchPcmChunkBytes,
            );
        } else {
            encoder.copyBufferToBuffer(this._output, 0, this._staging, 0, this._total * 4);
        }
        device.queue.submit([encoder.finish()]);

        this._absoluteSample += S;
    }

    /**
     * Submit a bounded group of consecutive chunks and begin one combined
     * PCM/visual map. At most two handles may be live, so callers get explicit
     * backpressure instead of allocating an unbounded staging queue.
     *
     * `beforeEncode` is invoked immediately before every ordered GPU submit;
     * ParticleVoiceModel uses it for generation/AbortSignal checks.
     */
    async beginChunkBatch(controlsList, { beforeEncode = null } = {}) {
        this._assertNotDestroyed();
        if (this.renderBatchChunks <= 1) {
            throw new Error('ParticleTract: chunk batching is disabled when renderBatchChunks is 1');
        }
        if (!Array.isArray(controlsList)
            || controlsList.length < 1
            || controlsList.length > this.renderBatchChunks) {
            throw new RangeError(`ParticleTract: controlsList must contain 1 to ${this.renderBatchChunks} chunks`);
        }
        if (beforeEncode !== null && typeof beforeEncode !== 'function') {
            throw new TypeError('ParticleTract: beforeEncode must be a function when present');
        }
        const slotIndex = this._batchReadbackSlots.findIndex((slot) => slot.free);
        if (slotIndex < 0) {
            throw new Error(`ParticleTract: no free batch readback slot (${BATCH_READBACK_SLOT_COUNT} in flight)`);
        }

        const slot = this._batchReadbackSlots[slotIndex];
        slot.free = false;
        const handle = Object.freeze({ chunkCount: controlsList.length });
        const state = {
            slot,
            slotIndex,
            chunkCount: controlsList.length,
            startSample: this._absoluteSample,
            mapPromise: null,
            mapped: false,
            claimed: false,
            released: false,
        };
        this._batchStates.set(handle, state);
        this._activeBatchHandles.add(handle);

        let submitted = 0;
        try {
            for (let chunk = 0; chunk < controlsList.length; chunk++) {
                beforeEncode?.(chunk);
                this._encodeChunk(controlsList[chunk], {
                    buffer: slot.buffer,
                    pcmByteOffset: chunk * this._batchPcmChunkBytes,
                    visualByteOffset: this._batchVisualBaseBytes
                        + chunk * this._batchVisualChunkBytes,
                });
                submitted += 1;
            }
            state.mapPromise = slot.buffer.mapAsync(GPUMapMode.READ, 0, this._batchSlotBytes);
            // A caller may be cancelled before it reaches readChunkBatch(); keep
            // the pending map from becoming a global unhandled rejection while
            // preserving the original promise for explicit cleanup/readback.
            void state.mapPromise.catch(() => {});
            return handle;
        } catch (error) {
            // Device/validation failures after an earlier chunk was submitted
            // must settle queue use before this staging slot can be reused.
            if (submitted > 0) await this._device.queue.onSubmittedWorkDone().catch(() => {});
            state.released = true;
            slot.free = true;
            this._activeBatchHandles.delete(handle);
            throw error;
        }
    }

    /** Resolve one batch in submission order and release its staging slot. */
    async readChunkBatch(handle) {
        const state = this._claimChunkBatch(handle);
        try {
            await state.mapPromise;
            state.mapped = true;
            const mapped = state.slot.buffer.getMappedRange(0, this._batchSlotBytes);
            const pcmBytes = state.chunkCount * this._batchPcmChunkBytes;
            const pcm = new Float32Array(mapped.slice(0, pcmBytes));
            const visualSnapshots = [];
            if (this._visualEnabled) {
                const visualBytes = state.chunkCount * this._batchVisualChunkBytes;
                const visualFlat = new Float32Array(mapped.slice(
                    this._batchVisualBaseBytes,
                    this._batchVisualBaseBytes + visualBytes,
                ));
                const channels = VISUAL_CHANNELS.length;
                const frames = this.visualFramesPerChunk;
                const perInstance = channels * frames;
                for (let chunk = 0; chunk < state.chunkCount; chunk++) {
                    const chunkBase = chunk * this._visualOutLength;
                    for (let instance = 0; instance < this.numInstances; instance++) {
                        const start = chunkBase + instance * perInstance;
                        visualSnapshots.push(createTractStateSnapshot({
                            sampleIndex: state.startSample + chunk * this.chunkSamples,
                            numChannels: channels,
                            numFrames: frames,
                            field: visualFlat.subarray(start, start + perInstance),
                        }));
                    }
                }
            }
            return { pcm, visualSnapshots, chunks: state.chunkCount };
        } finally {
            this._releaseChunkBatch(handle, state);
        }
    }

    /** Settle and release a batch whose PCM must not be delivered after cancel. */
    async discardChunkBatch(handle) {
        const state = this._claimChunkBatch(handle);
        try {
            await state.mapPromise;
            state.mapped = true;
        } finally {
            this._releaseChunkBatch(handle, state);
        }
    }

    _chunkBatchState(handle) {
        const state = this._batchStates.get(handle);
        if (!state || state.released) throw new Error('ParticleTract: invalid or released chunk batch handle');
        return state;
    }

    _claimChunkBatch(handle) {
        const state = this._chunkBatchState(handle);
        if (state.claimed) throw new Error('ParticleTract: chunk batch handle already has a consumer');
        state.claimed = true;
        return state;
    }

    _releaseChunkBatch(handle, state) {
        if (state.released) return;
        if (state.mapped) state.slot.buffer.unmap();
        state.released = true;
        state.slot.free = true;
        this._activeBatchHandles.delete(handle);
    }

    /**
     * Read the most recent chunk's decimated visualization field as one
     * `TractStateSnapshot` per instance (channel order: `VISUAL_CHANNELS`).
     * Must be called after `renderChunk()`/`encodeChunk()`. Returns an empty
     * array when visualization is disabled, rather than throwing, so a caller
     * can poll unconditionally.
     */
    async readVisualSnapshots() {
        this._assertNotDestroyed();
        if (!this._visualEnabled) return [];
        const bytes = this._visualOutLength * 4;
        await this._visualStaging.mapAsync(GPUMapMode.READ, 0, bytes);
        const flat = new Float32Array(this._visualStaging.getMappedRange(0, bytes).slice(0));
        this._visualStaging.unmap();

        const channels = VISUAL_CHANNELS.length;
        const frames = this.visualFramesPerChunk;
        const perInstance = channels * frames;
        const snapshots = [];
        for (let i = 0; i < this.numInstances; i++) {
            snapshots.push(createTractStateSnapshot({
                // The counter has already advanced past this chunk, so subtract
                // to report the sample index the chunk STARTED at.
                sampleIndex: Math.max(0, this._absoluteSample - this.chunkSamples),
                numChannels: channels,
                numFrames: frames,
                field: flat.subarray(i * perInstance, (i + 1) * perInstance),
            }));
        }
        return snapshots;
    }

    async _readOutput() {
        const bytes = this._total * 4;
        await this._staging.mapAsync(GPUMapMode.READ, 0, bytes);
        const copy = new Float32Array(this._staging.getMappedRange(0, bytes).slice(0));
        this._staging.unmap();
        return copy;
    }

    destroy() {
        if (this._destroyed) return;
        for (const handle of this._activeBatchHandles) {
            const state = this._batchStates.get(handle);
            if (state) state.released = true;
        }
        this._activeBatchHandles.clear();
        for (const slot of this._batchReadbackSlots) slot.buffer.destroy();
        this._staging.destroy();
        if (this._visualStaging) this._visualStaging.destroy();
        destroyBuffers(this._buffers);
        this._destroyed = true;
    }

    _assertNotDestroyed() {
        if (this._destroyed) throw new Error('ParticleTract: used after destroy()');
    }
}

export function createParticleTract(device, options) {
    return new ParticleTract(device, options);
}

export default ParticleTract;
