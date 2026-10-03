// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Production oral/nasal waveguide with a reciprocal velopharyngeal junction.
 * Both tubes advance together: a returning nasal wave loads the oral tract
 * at the same sample, rather than driving an independent branch from a tap.
 * The separate Phase-2 kernels retain their original parity interfaces.
 *
 * The junction pressure is 2*sum(area*incoming)/sum(area); each outgoing
 * pressure wave is junction pressure minus that port's incoming wave. This
 * conserves area-weighted wave energy before the common wall loss. The caller
 * supplies start/end pressure weights and matching tube coefficients.
 * Like the existing oral kernel, intermediate samples interpolate scattering
 * coefficients, not tube areas. Endpoint geometries match; that interpolation
 * is an approximation of moving geometry, not an exact moving-wall solver.
 * A closed velum uses the original oral two-port arithmetic exactly and
 * reflects the nasal wave at its closed near end, allowing stored energy to
 * decay through wall and nostril losses rather than discarding it.
 */

import { tractWaveguideOutputLayout } from './tract_waveguide.js';
import { nasalJunctionOutputLayout } from './nasal_junction.js';

export const COUPLED_TRACT_MAX_SECTIONS = 64;
export const COUPLED_TRACT_WORKGROUP_SIZE = Object.freeze({ x: 64, y: 1, z: 1 });

export function coupledTractWaveguideOutputLayout(oralSections, nasalSections, numSamples, numInstances) {
    const oral = tractWaveguideOutputLayout(oralSections, numSamples, numInstances);
    const nasal = nasalJunctionOutputLayout(nasalSections, numSamples, numInstances);
    return { oral, nasal, nasalOffset: oral.totalLength, totalLength: oral.totalLength + nasal.totalLength };
}

// Emit both buffer parities from one recurrence. The oral two-port expressions
// intentionally match tract_waveguide.js, including noise injection order.
function sampleStep(current, next, secondaryNoise) {
    return /* wgsl */ `
            if (tid < n_sections - 1u) {
                var incoming_right = right_${current}[tid];
                let incoming_left = left_${current}[tid + 1u];
                if (i32(tid) == params.constriction_index) {
                    incoming_right = incoming_right + constriction_noise[flow_base + sample];
                }
${secondaryNoise ? `                if (i32(tid) == params.secondary_constriction_index) {
                    incoming_right = incoming_right + constriction_noise[radiated_block + flow_base + sample];
                }
` : ''}
                if (tid == port && weights.z > 0.0) {
                    let incoming_nasal = nasal_left_${current}[0u];
                    let pressure = weights.x * incoming_right + weights.y * incoming_left + weights.z * incoming_nasal;
                    right_${next}[tid + 1u] = (pressure - incoming_left) * params.wall_loss;
                    left_${next}[tid] = (pressure - incoming_right) * params.wall_loss;
                    nasal_right_${next}[0u] = (pressure - incoming_nasal) * params.wall_loss;
                } else {
                    let w = k_now * (incoming_right - incoming_left);
                    right_${next}[tid + 1u] = (incoming_right + w) * params.wall_loss;
                    left_${next}[tid] = (incoming_left + w) * params.wall_loss;
                }
            }
            if (tid < nasal_sections - 1u) {
                let incoming_right = nasal_right_${current}[tid];
                let incoming_left = nasal_left_${current}[tid + 1u];
                let w = nasal_k_now * (incoming_right - incoming_left);
                nasal_right_${next}[tid + 1u] = (incoming_right + w) * params.wall_loss;
                nasal_left_${next}[tid] = (incoming_left + w) * params.wall_loss;
            }
            if (tid == 0u) {
                right_${next}[0u] = source_flow[flow_base + sample] + params.glottal_reflection * left_${current}[0u];
                let incoming_at_lips = right_${current}[n_sections - 1u];
                left_${next}[n_sections - 1u] = params.lip_reflection * incoming_at_lips;
                let output_raw = (1.0 + params.lip_reflection) * incoming_at_lips;
                packed_out[radiated_base + sample] = output_raw - params.oral_radiation_difference * prev_output;
                prev_output = output_raw;
                // Preserve the visualization channel's pressure observation.
                packed_out[nasal_tap_base + sample] = right_${current}[u32(params.nasal_tap_index)] + left_${current}[u32(params.nasal_tap_index)];
                if (weights.z == 0.0) {
                    nasal_right_${next}[0u] = nasal_left_${current}[0u] * params.wall_loss;
                }
                let incoming_at_nostril = nasal_right_${current}[nasal_sections - 1u];
                nasal_left_${next}[nasal_sections - 1u] = params.nostril_reflection * incoming_at_nostril;
                let nasal_raw = (1.0 + params.nostril_reflection) * incoming_at_nostril;
                packed_out[nasal_radiated_base + sample] = nasal_raw - params.nasal_radiation_difference * nasal_prev_output;
                nasal_prev_output = nasal_raw;
            }
    `;
}

export function coupledTractWaveguideShader({ secondaryNoise = false } = {}) {
    return /* wgsl */ `
const MAX_SECTIONS: u32 = ${COUPLED_TRACT_MAX_SECTIONS}u;
struct Params {
    oral_sections: u32,
    nasal_sections: u32,
    num_samples: u32,
    num_instances: u32,
    glottal_reflection: f32,
    lip_reflection: f32,
    nostril_reflection: f32,
    wall_loss: f32,
    constriction_index: i32,
    nasal_tap_index: i32,
    oral_radiation_difference: f32,
    nasal_radiation_difference: f32,
${secondaryNoise ? `    secondary_constriction_index: i32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
` : ''}
};
@group(0) @binding(0) var<uniform> params: Params;
// Per instance: start oral k, end oral k, start three weights, end three weights.
@group(0) @binding(1) var<storage, read> oral_geometry: array<f32>;
// Per instance: start nasal k, end nasal k.
@group(0) @binding(2) var<storage, read> nasal_geometry: array<f32>;
@group(0) @binding(3) var<storage, read> source_flow: array<f32>;
@group(0) @binding(4) var<storage, read> constriction_noise: array<f32>;
// Each state input contains the full oral block followed by the full nasal block.
@group(0) @binding(5) var<storage, read> initial_right: array<f32>;
@group(0) @binding(6) var<storage, read> initial_left: array<f32>;
@group(0) @binding(7) var<storage, read> initial_prev_output: array<f32>;
// Original oral output layout followed by the original nasal output layout.
@group(0) @binding(8) var<storage, read_write> packed_out: array<f32>;
var<workgroup> right_a: array<f32, MAX_SECTIONS>;
var<workgroup> left_a: array<f32, MAX_SECTIONS>;
var<workgroup> right_b: array<f32, MAX_SECTIONS>;
var<workgroup> left_b: array<f32, MAX_SECTIONS>;
var<workgroup> nasal_right_a: array<f32, MAX_SECTIONS>;
var<workgroup> nasal_left_a: array<f32, MAX_SECTIONS>;
var<workgroup> nasal_right_b: array<f32, MAX_SECTIONS>;
var<workgroup> nasal_left_b: array<f32, MAX_SECTIONS>;
var<workgroup> prev_output: f32;
var<workgroup> nasal_prev_output: f32;

@compute @workgroup_size(${COUPLED_TRACT_WORKGROUP_SIZE.x}, 1, 1)
fn main(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
    let inst = wid.x;
    if (inst >= params.num_instances) { return; }
    let tid = lid.x;
    let n_sections = params.oral_sections;
    let nasal_sections = params.nasal_sections;
    let n_junctions = n_sections - 1u;
    let nasal_junctions = nasal_sections - 1u;
    let k_base = inst * (2u * n_junctions + 6u);
    let nasal_k_base = inst * 2u * nasal_junctions;
    let state_base = inst * n_sections;
    let nasal_state_base = params.num_instances * n_sections + inst * nasal_sections;
    let flow_base = inst * params.num_samples;
    let port = min(u32(params.nasal_tap_index), n_sections - 2u);
    if (tid < n_sections) {
        right_a[tid] = initial_right[state_base + tid];
        left_a[tid] = initial_left[state_base + tid];
    }
    if (tid < nasal_sections) {
        nasal_right_a[tid] = initial_right[nasal_state_base + tid];
        nasal_left_a[tid] = initial_left[nasal_state_base + tid];
    }
    if (tid == 0u) {
        prev_output = initial_prev_output[inst];
        nasal_prev_output = initial_prev_output[params.num_instances + inst];
    }
    workgroupBarrier();
    let radiated_block = params.num_instances * params.num_samples;
    let oral_state_block = params.num_instances * n_sections;
    let nasal_state_block = params.num_instances * nasal_sections;
    let nasal_offset = 2u * radiated_block + 2u * oral_state_block + params.num_instances;
    let radiated_base = flow_base;
    let nasal_tap_base = radiated_block + 2u * oral_state_block + params.num_instances + flow_base;
    let nasal_radiated_base = nasal_offset + flow_base;
    var k_start: f32 = 0.0;
    var k_end: f32 = 0.0;
    var nasal_k_start: f32 = 0.0;
    var nasal_k_end: f32 = 0.0;
    if (tid < n_junctions) {
        k_start = oral_geometry[k_base + tid];
        k_end = oral_geometry[k_base + n_junctions + tid];
    }
    if (tid < nasal_junctions) {
        nasal_k_start = nasal_geometry[nasal_k_base + tid];
        nasal_k_end = nasal_geometry[nasal_k_base + nasal_junctions + tid];
    }
    let weight_base = k_base + 2u * n_junctions;
    let weights_start = vec3<f32>(oral_geometry[weight_base], oral_geometry[weight_base + 1u], oral_geometry[weight_base + 2u]);
    let weights_end = vec3<f32>(oral_geometry[weight_base + 3u], oral_geometry[weight_base + 4u], oral_geometry[weight_base + 5u]);
    let k_denom = f32(max(1u, params.num_samples - 1u));
    var sample: u32 = 0u;
    loop {
        if (sample >= params.num_samples) { break; }
        let t = f32(sample) / k_denom;
        let k_now = k_start + (k_end - k_start) * t;
        let nasal_k_now = nasal_k_start + (nasal_k_end - nasal_k_start) * t;
        let weights = weights_start + (weights_end - weights_start) * t;
        if ((sample % 2u) == 0u) {
${sampleStep('a', 'b', secondaryNoise)}
        } else {
${sampleStep('b', 'a', secondaryNoise)}
        }
        workgroupBarrier();
        sample = sample + 1u;
    }
    let final_state_is_a = (params.num_samples % 2u) == 0u;
    if (tid < n_sections) {
        let right_offset = radiated_block + state_base + tid;
        let left_offset = radiated_block + oral_state_block + state_base + tid;
        if (final_state_is_a) {
            packed_out[right_offset] = right_a[tid]; packed_out[left_offset] = left_a[tid];
        } else {
            packed_out[right_offset] = right_b[tid]; packed_out[left_offset] = left_b[tid];
        }
    }
    if (tid < nasal_sections) {
        let right_offset = nasal_offset + radiated_block + inst * nasal_sections + tid;
        let left_offset = nasal_offset + radiated_block + nasal_state_block + inst * nasal_sections + tid;
        if (final_state_is_a) {
            packed_out[right_offset] = nasal_right_a[tid]; packed_out[left_offset] = nasal_left_a[tid];
        } else {
            packed_out[right_offset] = nasal_right_b[tid]; packed_out[left_offset] = nasal_left_b[tid];
        }
    }
    if (tid == 0u) {
        packed_out[radiated_block + 2u * oral_state_block + inst] = prev_output;
        packed_out[nasal_offset + radiated_block + 2u * nasal_state_block + inst] = nasal_prev_output;
    }
}
`;
}
