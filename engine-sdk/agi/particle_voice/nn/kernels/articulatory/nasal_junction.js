// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * nasal_junction.js — Phase 2 ParticleNN articulatory kernel.
 *
 * Production nasal branch: a second, independent Kelly-Lochbaum tube chain
 * generalizing risk/KellyLochbaumWaveguide.js (R6)'s proven
 * createNasalBranch().step() to run a whole sample chunk times N instances
 * on GPU, using the exact same one-thread-per-section /
 * double-buffered-workgroup-memory / sequential-workgroupBarrier-per-sample
 * structure as tract_waveguide.js (see that file's docstring for the full
 * parallelization rationale, not repeated here).
 *
 * Differences from tract_waveguide.js's oral tract, matching R6's
 * createNasalBranch() exactly:
 *   - The near end has no reflection term at all: nextRight[0] = inputFlow
 *     (R6's oral tract instead does sourceFlow + glottalReflection *
 *     left[0]) — the nasal branch is driven directly by a coupled fraction
 *     of an oral-tract tap signal, not its own glottal source.
 *   - The far end uses a single nostrilReflection coefficient (R6's
 *     lipReflection equivalent). `radiation_difference` selects whether the
 *     first-difference radiation filter is applied: 1.0 for R6's flow-domain
 *     parity path, 0.0 for ParticleTract's LF-derivative-domain production path.
 *
 * This kernel does not itself compute the oral-tract tap signal fed into
 * inputFlow — that is tract_waveguide.js's nasal_tap output block, and
 * inputFlow is an ordinary per-instance per-sample input buffer here,
 * matching every other Phase 2 kernel's convention of not silently reaching
 * into another kernel's state.
 *
 * input_gain is the velum/nasal COUPLING fraction. R6's createNasalBranch()
 * has no such parameter because its caller pre-multiplied the tap signal
 * (nasalCoupling * nasalTapSignal) before calling step(). On GPU that would
 * force either a whole extra scaling kernel or a CPU round-trip in the
 * middle of an otherwise GPU-resident chunk, so the scalar lives here
 * instead — exactly where this file's own docstring already says the
 * branch is "driven by a coupled fraction of an oral-tract tap signal".
 * input_gain = 1.0 reproduces R6's step() bit-for-bit, which is what the
 * parity test in phase2-dsp.html pins.
 */

export const NASAL_JUNCTION_MAX_SECTIONS = 64;
export const NASAL_JUNCTION_ENTRY_POINT = 'main';
export const NASAL_JUNCTION_WORKGROUP_SIZE = Object.freeze({ x: NASAL_JUNCTION_MAX_SECTIONS, y: 1, z: 1 });

/** Shared flat-output-buffer layout — mirrors tractWaveguideOutputLayout() exactly (same three persisted-state pieces plus the radiated signal), kept as its own function per kernel so a future layout change to one tract type can never silently affect the other. */
export function nasalJunctionOutputLayout(numSections, numSamples, numInstances) {
    const radiatedOffset = 0;
    const radiatedLength = numInstances * numSamples;
    const finalRightOffset = radiatedOffset + radiatedLength;
    const finalRightLength = numInstances * numSections;
    const finalLeftOffset = finalRightOffset + finalRightLength;
    const finalLeftLength = numInstances * numSections;
    const finalPrevOutputOffset = finalLeftOffset + finalLeftLength;
    const finalPrevOutputLength = numInstances;
    const totalLength = finalPrevOutputOffset + finalPrevOutputLength;
    return { radiatedOffset, radiatedLength, finalRightOffset, finalRightLength, finalLeftOffset, finalLeftLength, finalPrevOutputOffset, finalPrevOutputLength, totalLength };
}

export function nasalJunctionShader() {
    return /* wgsl */ `
const MAX_SECTIONS: u32 = ${NASAL_JUNCTION_MAX_SECTIONS}u;

struct Params {
    num_sections: u32,
    num_samples: u32,
    num_instances: u32,
    _pad0: u32,
    nostril_reflection: f32,
    input_gain: f32,
    radiation_difference: f32,
    wall_loss: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> junction_k: array<f32>; // [num_instances, num_sections - 1]
@group(0) @binding(2) var<storage, read> input_flow: array<f32>; // [num_instances, num_samples]
@group(0) @binding(3) var<storage, read> initial_right: array<f32>; // [num_instances, num_sections]
@group(0) @binding(4) var<storage, read> initial_left: array<f32>; // [num_instances, num_sections]
@group(0) @binding(5) var<storage, read> initial_prev_output: array<f32>; // [num_instances]
@group(0) @binding(6) var<storage, read_write> packed_out: array<f32>;

var<workgroup> right_a: array<f32, MAX_SECTIONS>;
var<workgroup> left_a: array<f32, MAX_SECTIONS>;
var<workgroup> right_b: array<f32, MAX_SECTIONS>;
var<workgroup> left_b: array<f32, MAX_SECTIONS>;
var<workgroup> prev_output: f32;

@compute @workgroup_size(${NASAL_JUNCTION_WORKGROUP_SIZE.x}, 1, 1)
fn ${NASAL_JUNCTION_ENTRY_POINT}(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
    let inst = wid.x;
    if (inst >= params.num_instances) {
        return;
    }
    let tid = lid.x;
    let n_sections = params.num_sections;
    let k_base = inst * (n_sections - 1u);
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
    var sample: u32 = 0u;
    loop {
        if (sample >= params.num_samples) { break; }
        let use_a_as_current = (sample % 2u) == 0u;

        if (use_a_as_current) {
            if (tid < n_sections - 1u) {
                let incoming_right = right_a[tid];
                let incoming_left = left_a[tid + 1u];
                let w = junction_k[k_base + tid] * (incoming_right - incoming_left);
                right_b[tid + 1u] = (incoming_right + w) * params.wall_loss;
                left_b[tid] = (incoming_left + w) * params.wall_loss;
            }
            if (tid == 0u) {
                right_b[0u] = params.input_gain * input_flow[flow_base + sample];
                let incoming_at_nostril = right_a[n_sections - 1u];
                left_b[n_sections - 1u] = params.nostril_reflection * incoming_at_nostril;
                let output_raw = (1.0 + params.nostril_reflection) * incoming_at_nostril;
                packed_out[radiated_base + sample] = output_raw - params.radiation_difference * prev_output;
                prev_output = output_raw;
            }
        } else {
            if (tid < n_sections - 1u) {
                let incoming_right = right_b[tid];
                let incoming_left = left_b[tid + 1u];
                let w = junction_k[k_base + tid] * (incoming_right - incoming_left);
                right_a[tid + 1u] = (incoming_right + w) * params.wall_loss;
                left_a[tid] = (incoming_left + w) * params.wall_loss;
            }
            if (tid == 0u) {
                right_a[0u] = params.input_gain * input_flow[flow_base + sample];
                let incoming_at_nostril = right_b[n_sections - 1u];
                left_a[n_sections - 1u] = params.nostril_reflection * incoming_at_nostril;
                let output_raw = (1.0 + params.nostril_reflection) * incoming_at_nostril;
                packed_out[radiated_base + sample] = output_raw - params.radiation_difference * prev_output;
                prev_output = output_raw;
            }
        }
        workgroupBarrier();
        sample = sample + 1u;
    }

    // Layout matches nasalJunctionOutputLayout() — see tract_waveguide.js's
    // matching comment for why each block's fixed start offset is computed
    // independently of inst before adding inst * n_sections (or inst alone
    // for the scalar prev-output block), rather than chaining off an
    // earlier per-instance-indexed base.
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

export default nasalJunctionShader;
