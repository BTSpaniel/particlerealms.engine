// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * tract_waveguide.js — Phase 2 ParticleNN articulatory kernel.
 *
 * Production Kelly-Lochbaum single-delay-per-section digital waveguide
 * vocal tract, generalizing `risk/KellyLochbaumWaveguide.js` (R6)'s proven
 * `createVocalTract().step()` recurrence to run entirely on GPU across a
 * whole chunk of samples and N simultaneous voice/capsule instances.
 * Junction reflection coefficients (`k[i] = (A_i - A_{i+1}) / (A_i +
 * A_{i+1})`) are computed CPU-side by the caller via
 * `risk/KellyLochbaumWaveguide.js`'s `reflectionCoefficients` (a fixed-shape,
 * typically-small computation — same rationale `mel_filterbank.js` gives for
 * precomputing its filter matrix CPU-side rather than reproducing it in
 * WGSL) and passed in as `junction_k`, not recomputed here.
 *
 * Constriction noise injection (`constriction_index` +
 * `constriction_noise`) and the nasal TAP signal (`nasal_tap_index`) ARE
 * implemented, as faithful ports of R6's proven `step()` options — they
 * were deferred when this kernel was first written, but `ParticleTract.js`
 * cannot produce real fricatives or real nasal coupling without them:
 *
 *   - `constriction_index >= 0` adds that sample's `constriction_noise`
 *     value to the RIGHT-going wave entering junction `constriction_index`,
 *     exactly as R6's `if (i === constrictionIndex) incomingRight +=
 *     constrictionNoiseSample`. Injecting at the junction (rather than
 *     mixing noise into `source_flow` at the glottis) is what makes a
 *     fricative a fricative: only the cavity IN FRONT of the constriction
 *     filters the turbulence.
 *   - `nasal_tap_index >= 0` writes `right[i] + left[i]` for that section
 *     into the packed output's `nasal_tap` block every sample, giving
 *     `nasal_junction.js` an anatomically-meaningful `input_flow` to be
 *     driven by. Matching R6 exactly, the tap is a READ-ONLY observation:
 *     the oral tract is not itself perturbed by it. That remains a
 *     simplification versus a rigorous 3-port scattering junction (R6's own
 *     docstring says the same); it is enough for controllable, stable nasal
 *     coupling, and the honest limitation is recorded here rather than
 *     overstated.
 *
 * Both are opt-in: a negative index disables that feature entirely, so
 * callers that want neither pass `-1` and get bit-identical behavior to
 * this kernel before they existed.
 *
 * ## `radiation_difference` must match what the SOURCE already is
 *
 * Lip radiation is approximately a differentiator, so R6's `step()` ends with
 * `radiated = outputRaw - prevOutputRaw`. That is correct when the excitation
 * is glottal FLOW, which is what R6's `GlottalSource.js` raised-cosine pulse
 * produced.
 *
 * It is WRONG when the excitation is already the flow derivative.
 * `glottal_lf.js` is explicitly the LF glottal flow DERIVATIVE model, so
 * feeding it in and then differencing again yields the SECOND derivative:
 * +6 dB/octave of spurious tilt (audibly reedy/buzzy) and a far spikier
 * waveform, whose large crest factor then drives any downstream limiter into
 * distorting every single pitch pulse. Injecting a derivative source and
 * skipping the difference is what gives the correct radiated pressure, and is
 * why formant synthesizers use the LF derivative directly.
 *
 * `radiation_difference` therefore has to agree with the caller's source:
 * 1.0 for a flow source (R6 parity), 0.0 for `glottal_lf.js`. There is no safe
 * default that suits both, so it is an explicit parameter rather than a
 * built-in assumption.
 *
 * ## `wall_loss`: the tube was perfectly lossless, and that is audible
 *
 * Scattering at a Kelly-Lochbaum junction conserves energy exactly, so with only
 * the glottis and lips absorbing anything, the formants of this tube had very
 * high Q. Real vocal tracts lose energy continuously to yielding walls plus
 * viscous and thermal effects, which is what gives formants their bandwidth
 * (roughly 50-100 Hz for F1, more higher up). A resonator with too little damping
 * rings after every excitation, and a whole tube of them reads as a metallic,
 * synthetic buzz laid over the speech no matter how accurate the formant
 * FREQUENCIES are — accurate centres with no bandwidth still does not sound human.
 *
 * `wall_loss` multiplies each traveling wave once per section per sample, so a
 * wave crossing the whole tract is attenuated `wall_loss^num_sections`. Because
 * it is applied per section rather than once at a boundary, the loss accumulates
 * with distance travelled, which is the correct behaviour for a distributed
 * effect. It is a frequency-INDEPENDENT approximation of a loss that really does
 * grow with frequency; the honest limitation is recorded here rather than
 * overstated, and a one-pole filter per junction would be the refinement.
 *
 * 1.0 restores the lossless tube exactly, which is what the R6 parity test uses.
 *
 * One digital-waveguide step is inherently sequential in time (sample n
 * depends on sample n-1's right/left traveling-wave state), but the N-1
 * junction updates *within* one sample step are independent of each other
 * (each reads only the previous sample's `right`/`left`, matching R6's
 * `step()` computing a full `nextRight`/`nextLeft` array before committing
 * it) — so this kernel assigns one thread per tube section
 * (`local_invocation_id.x`), keeps the whole tract's traveling-wave state in
 * workgroup memory (double-buffered, since every junction read is the
 * *previous* sample's state), and walks the chunk's samples sequentially
 * with a `workgroupBarrier()` between samples. `workgroup_id.x` selects
 * which of up to `num_instances` simultaneous tracts to process, matching
 * every other Phase 2 kernel's per-instance batching convention
 * (`breath_reservoir.js`, `lip_radiation.js`).
 *
 * `MAX_SECTIONS = 64` is a compile-time workgroup-memory cap, comfortably
 * above R6's proven `NUM_SECTIONS = 32` oral / `NASAL_SECTIONS = 16` nasal
 * tract discretizations (`risk/VoiceBoxWaveguideProbe.js`) — `num_sections`
 * over this cap is a caller error, not a silently-truncated tract.
 *
 * To keep this kernel within the project's "N read-only storage inputs then
 * one read_write storage output" binding convention
 * (`KernelRegistry.bindGroupLayoutEntriesFor`), all four pieces of
 * kernel-produced data (`radiated_out`, the two persisted traveling-wave
 * state arrays, and the persisted previous-lip-output scalar needed for the
 * next chunk's radiation first-difference) are packed into ONE flat output
 * buffer at fixed uniform-computed offsets, documented in the struct
 * comments below, rather than needing four separate output bindings.
 */

export const TRACT_WAVEGUIDE_MAX_SECTIONS = 64;
export const TRACT_WAVEGUIDE_ENTRY_POINT = 'main';
export const TRACT_WAVEGUIDE_WORKGROUP_SIZE = Object.freeze({ x: TRACT_WAVEGUIDE_MAX_SECTIONS, y: 1, z: 1 });

/**
 * Compute the flat-output-buffer layout `tract_waveguide.js` writes to and
 * `TractWaveguideModel.js` (Phase 3+ consumer) must read from, given
 * `numSections`/`numSamples`/`numInstances` — kept as one shared function so
 * the WGSL offsets below and any future JS-side reader can never drift
 * apart.
 */
export function tractWaveguideOutputLayout(numSections, numSamples, numInstances) {
    const radiatedOffset = 0;
    const radiatedLength = numInstances * numSamples;
    const finalRightOffset = radiatedOffset + radiatedLength;
    const finalRightLength = numInstances * numSections;
    const finalLeftOffset = finalRightOffset + finalRightLength;
    const finalLeftLength = numInstances * numSections;
    const finalPrevOutputOffset = finalLeftOffset + finalLeftLength;
    const finalPrevOutputLength = numInstances;
    // Nasal tap is appended LAST so every pre-existing offset above keeps the
    // exact value it had before the tap existed — a reader that ignores the
    // tap block is unaffected.
    const nasalTapOffset = finalPrevOutputOffset + finalPrevOutputLength;
    const nasalTapLength = numInstances * numSamples;
    const totalLength = nasalTapOffset + nasalTapLength;
    return { radiatedOffset, radiatedLength, finalRightOffset, finalRightLength, finalLeftOffset, finalLeftLength, finalPrevOutputOffset, finalPrevOutputLength, nasalTapOffset, nasalTapLength, totalLength };
}

export function tractWaveguideShader() {
    return /* wgsl */ `
const MAX_SECTIONS: u32 = ${TRACT_WAVEGUIDE_MAX_SECTIONS}u;

struct Params {
    num_sections: u32,
    num_samples: u32,
    num_instances: u32,
    _pad0: u32,
    glottal_reflection: f32,
    lip_reflection: f32,
    // 1.0 applies the first-difference lip-radiation filter; 0.0 skips it.
    // MUST be 0.0 when the source is already a flow DERIVATIVE (see below).
    radiation_difference: f32,
    // Per-section transmission factor for the traveling waves, in (0, 1].
    // 1.0 is the lossless tube (R6 parity); see the loss note below.
    wall_loss: f32,
    // Negative disables the feature. i32 (not u32) precisely so "disabled"
    // needs no magic sentinel value that could collide with a real index.
    constriction_index: i32,
    nasal_tap_index: i32,
    _pad3: i32,
    _pad4: i32,
};

@group(0) @binding(0) var<uniform> params: Params;
// [num_instances, 2, num_sections - 1] — TWO coefficient sets per instance:
// index 0 is the geometry at the START of the chunk, index 1 at the END. The
// kernel interpolates between them per sample (see k_now below).
@group(0) @binding(1) var<storage, read> junction_k: array<f32>;
@group(0) @binding(2) var<storage, read> source_flow: array<f32>; // [num_instances, num_samples]
@group(0) @binding(3) var<storage, read> constriction_noise: array<f32>; // [num_instances, num_samples]; ignored when constriction_index < 0
@group(0) @binding(4) var<storage, read> initial_right: array<f32>; // [num_instances, num_sections]
@group(0) @binding(5) var<storage, read> initial_left: array<f32>; // [num_instances, num_sections]
@group(0) @binding(6) var<storage, read> initial_prev_output: array<f32>; // [num_instances]
// Packed output: [radiated_out (num_instances*num_samples)] then
// [final_right (num_instances*num_sections)] then
// [final_left (num_instances*num_sections)] then
// [final_prev_output (num_instances)] then
// [nasal_tap (num_instances*num_samples)] — offsets computed at runtime from
// params, matching tractWaveguideOutputLayout() exactly.
@group(0) @binding(7) var<storage, read_write> packed_out: array<f32>;

var<workgroup> right_a: array<f32, MAX_SECTIONS>;
var<workgroup> left_a: array<f32, MAX_SECTIONS>;
var<workgroup> right_b: array<f32, MAX_SECTIONS>;
var<workgroup> left_b: array<f32, MAX_SECTIONS>;
var<workgroup> prev_output: f32;

@compute @workgroup_size(${TRACT_WAVEGUIDE_WORKGROUP_SIZE.x}, 1, 1)
fn ${TRACT_WAVEGUIDE_ENTRY_POINT}(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
    let inst = wid.x;
    if (inst >= params.num_instances) {
        return;
    }
    let tid = lid.x;
    let n_sections = params.num_sections;
    let n_junctions = n_sections - 1u;
    // Two coefficient sets per instance (start, end).
    let k_base = inst * 2u * n_junctions;
    let state_base = inst * n_sections;
    let flow_base = inst * params.num_samples;

    if (tid < n_sections) {
        right_a[tid] = initial_right[state_base + tid];
        left_a[tid] = initial_left[state_base + tid];
    }
    if (tid == 0u) {
        prev_output = initial_prev_output[inst];
    }
    workgroupBarrier();

    let radiated_base = inst * params.num_samples;
    // nasal_tap is the LAST block in the packed layout (see
    // tractWaveguideOutputLayout): after radiated + 2 state blocks + the
    // per-instance scalar block.
    let nasal_tap_base = params.num_instances * params.num_samples
        + 2u * params.num_instances * n_sections
        + params.num_instances
        + inst * params.num_samples;
    // Each thread owns one junction, so its start/end coefficients are read
    // once and interpolated per sample rather than re-fetched.
    var k_start: f32 = 0.0;
    var k_end: f32 = 0.0;
    if (tid < n_junctions) {
        k_start = junction_k[k_base + tid];
        k_end = junction_k[k_base + n_junctions + tid];
    }
    let k_denom = f32(max(1u, params.num_samples - 1u));

    var sample: u32 = 0u;
    loop {
        if (sample >= params.num_samples) { break; }
        let use_a_as_current = (sample % 2u) == 0u;

        // PER-SAMPLE geometry. Holding the reflection coefficients constant for
        // a whole chunk makes the tract's shape a staircase: it steps at every
        // chunk boundary, and a step in a resonator's geometry is an impulse
        // that rings its formants. At any realistic chunk size that repetition
        // rate is audible as a buzzing tone with the timbre visibly shifting
        // underneath it (~31 Hz at 1024 samples, ~125 Hz at 256) rather than as
        // speech. Interpolating from the previous chunk's geometry to this
        // chunk's target makes the shape continuous across boundaries, so the
        // only excitation is the glottal source itself.
        let k_now = k_start + (k_end - k_start) * (f32(sample) / k_denom);

        // Junction updates: thread tid handles the junction between section
        // tid and tid+1, for tid in [0, n_sections - 1) — matches R6's
        // for (i = 0; i < numSections - 1; i++) loop body exactly, reading
        // only the previous sample's (current-buffer) state.
        if (use_a_as_current) {
            if (tid < n_sections - 1u) {
                var incoming_right = right_a[tid];
                let incoming_left = left_a[tid + 1u];
                if (i32(tid) == params.constriction_index) {
                    incoming_right = incoming_right + constriction_noise[flow_base + sample];
                }
                let w = k_now * (incoming_right - incoming_left);
                right_b[tid + 1u] = (incoming_right + w) * params.wall_loss;
                left_b[tid] = (incoming_left + w) * params.wall_loss;
            }
            if (tid == 0u) {
                right_b[0u] = source_flow[flow_base + sample] + params.glottal_reflection * left_a[0u];
                let incoming_at_lips = right_a[n_sections - 1u];
                left_b[n_sections - 1u] = params.lip_reflection * incoming_at_lips;
                let output_raw = (1.0 + params.lip_reflection) * incoming_at_lips;
                packed_out[radiated_base + sample] = output_raw - params.radiation_difference * prev_output;
                prev_output = output_raw;
                // Tap the CURRENT (pre-update) state, matching R6's
                // nasalTapSignal being read before right.set(nextRight).
                // right_a/left_a are not written anywhere in this branch, so
                // this read is race-free without an extra barrier. Always
                // written (0 when disabled, as R6 returns) so the buffer is
                // deterministic rather than carrying stale data.
                var tap: f32 = 0.0;
                if (params.nasal_tap_index >= 0) {
                    let ti = u32(params.nasal_tap_index);
                    tap = right_a[ti] + left_a[ti];
                }
                packed_out[nasal_tap_base + sample] = tap;
            }
        } else {
            if (tid < n_sections - 1u) {
                var incoming_right = right_b[tid];
                let incoming_left = left_b[tid + 1u];
                if (i32(tid) == params.constriction_index) {
                    incoming_right = incoming_right + constriction_noise[flow_base + sample];
                }
                let w = k_now * (incoming_right - incoming_left);
                right_a[tid + 1u] = (incoming_right + w) * params.wall_loss;
                left_a[tid] = (incoming_left + w) * params.wall_loss;
            }
            if (tid == 0u) {
                right_a[0u] = source_flow[flow_base + sample] + params.glottal_reflection * left_b[0u];
                let incoming_at_lips = right_b[n_sections - 1u];
                left_a[n_sections - 1u] = params.lip_reflection * incoming_at_lips;
                let output_raw = (1.0 + params.lip_reflection) * incoming_at_lips;
                packed_out[radiated_base + sample] = output_raw - params.radiation_difference * prev_output;
                prev_output = output_raw;
                var tap: f32 = 0.0;
                if (params.nasal_tap_index >= 0) {
                    let ti = u32(params.nasal_tap_index);
                    tap = right_b[ti] + left_b[ti];
                }
                packed_out[nasal_tap_base + sample] = tap;
            }
        }
        workgroupBarrier();
        sample = sample + 1u;
    }

    // Layout matches tractWaveguideOutputLayout(): radiated block first
    // (already written above), then final_right, final_left, final_prev_output.
    // Each block's FIXED start offset (independent of inst) is computed
    // first, then indexed by inst * n_sections (array blocks) or inst
    // (the scalar prev-output block) separately — chaining a later block's
    // base off an earlier *per-instance-indexed* base (rather than off the
    // fixed block-size sum) was the original bug here: it silently carried
    // instance 0's block-relative offset forward into every later block,
    // so final_prev_output for any instance other than 0 was written to
    // the wrong (or out-of-range) index and never read back correctly by
    // the next chunk's dispatch.
    let final_state_is_a = (params.num_samples % 2u) == 0u;
    let radiated_block_size = params.num_instances * params.num_samples;
    let state_block_size = params.num_instances * n_sections;
    let final_right_fixed_base = radiated_block_size;
    let final_left_fixed_base = radiated_block_size + state_block_size;
    let final_prev_fixed_base = radiated_block_size + 2u * state_block_size;
    let final_right_base = final_right_fixed_base + inst * n_sections;
    let final_left_base = final_left_fixed_base + inst * n_sections;
    if (tid < n_sections) {
        if (final_state_is_a) {
            packed_out[final_right_base + tid] = right_a[tid];
            packed_out[final_left_base + tid] = left_a[tid];
        } else {
            packed_out[final_right_base + tid] = right_b[tid];
            packed_out[final_left_base + tid] = left_b[tid];
        }
    }
    if (tid == 0u) {
        packed_out[final_prev_fixed_base + inst] = prev_output;
    }
}
`;
}

export default tractWaveguideShader;
