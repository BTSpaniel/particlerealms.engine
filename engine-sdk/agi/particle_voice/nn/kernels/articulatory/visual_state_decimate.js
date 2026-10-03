// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * visual_state_decimate.js — Phase 2 ParticleNN articulatory kernel.
 *
 * Decimates a high-rate, multi-CHANNEL tract field (e.g. a per-section
 * pressure-like signal, one channel per tube section) down to one
 * box-averaged value per channel per fixed-size frame — the
 * `VisualAirflowState` `ARCHITECTURE.md` §4 names as "a decimated field for
 * ribbon/particle/heatmap visualization".
 *
 * Deliberately NOT a reuse of `physiology_feedback_reduce.js` despite the
 * similar per-thread "small sequential average over a window" shape: that
 * kernel reduces a single FLAT per-instance signal to (mean, RMS) pairs for
 * model feedback (a statistics reduction); this kernel decimates a
 * multi-CHANNEL per-instance FIELD (extra channel/section axis) down to
 * mean-only per channel per frame, because a rendered airflow ribbon/
 * heatmap needs a representative value per tube section over time, not an
 * energy statistic, and box-averaging over the decimation window (rather
 * than picking every Nth raw sample) avoids visual aliasing/flicker in the
 * downsampled field — ordinary decimation-filter practice, and consistent
 * with how `overlap_add.js`/`stft.js` already treat windowing as the
 * caller's/kernel's job rather than raw strided subsampling.
 *
 * `ARCHITECTURE.md` §4 also requires that visualization "must be bit-
 * identically disable-able without changing rendered PCM" — this kernel
 * reads its input field only (never writes back into it), so skipping this
 * kernel's dispatch entirely when visualization is off cannot affect the
 * `tract_waveguide.js`/`nasal_junction.js` PCM path in any way; that
 * invariant is structural (this kernel has no read_write access to
 * anything the acoustic path also reads), not merely a runtime convention.
 */

export const VISUAL_STATE_DECIMATE_ENTRY_POINT = 'main';
export const VISUAL_STATE_DECIMATE_WORKGROUP_SIZE = Object.freeze({ x: 256, y: 1, z: 1 });

export function visualStateDecimateShader() {
    return /* wgsl */ `
struct Params {
    num_channels: u32,
    samples_per_frame: u32,
    num_frames: u32,
    num_instances: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> field: array<f32>; // [num_instances, num_channels, num_frames * samples_per_frame]
@group(0) @binding(2) var<storage, read_write> decimated_out: array<f32>; // [num_instances, num_channels, num_frames]

@compute @workgroup_size(${VISUAL_STATE_DECIMATE_WORKGROUP_SIZE.x}, 1, 1)
fn ${VISUAL_STATE_DECIMATE_ENTRY_POINT}(@builtin(global_invocation_id) gid: vec3<u32>) {
    let total = params.num_instances * params.num_channels * params.num_frames;
    let idx = gid.x;
    if (idx >= total) {
        return;
    }
    let frame = idx % params.num_frames;
    let rest = idx / params.num_frames;
    let channel = rest % params.num_channels;
    let inst = rest / params.num_channels;

    let num_samples = params.num_frames * params.samples_per_frame;
    let channel_base = (inst * params.num_channels + channel) * num_samples;
    let window_base = channel_base + frame * params.samples_per_frame;

    var sum: f32 = 0.0;
    var n: u32 = 0u;
    loop {
        if (n >= params.samples_per_frame) { break; }
        sum = sum + field[window_base + n];
        n = n + 1u;
    }
    decimated_out[idx] = sum / f32(params.samples_per_frame);
}
`;
}

export default visualStateDecimateShader;
