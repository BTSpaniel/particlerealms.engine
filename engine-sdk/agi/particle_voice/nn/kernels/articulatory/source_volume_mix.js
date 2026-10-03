// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * source_volume_mix.js — Mix glottal volume-flow-derivative sources and
 * convert them to the pressure-wave convention used by the tract recurrence.
 *
 * A Kelly-Lochbaum traveling wave stores pressure components, while
 * `glottal_lf` emits a volume-flow derivative. Characteristic impedance is
 * proportional to `1 / area`, so an area-independent pressure injection made
 * wide-inlet vowel profiles much louder than narrow-inlet ones. The host
 * supplies the per-sample common-scale conversion `referenceArea / inletArea`.
 * This is a linear fixed-source-impedance approximation, not a nonlinear model
 * of vocal-fold/tract coupling.
 */

export const SOURCE_VOLUME_MIX_ENTRY_POINT = 'main';
export const SOURCE_VOLUME_MIX_WORKGROUP_SIZE = Object.freeze({ x: 256, y: 1, z: 1 });

export function sourceVolumeMixShader() {
    return /* wgsl */ `
struct Params {
    total_elements: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> glottal_flow_derivative: array<f32>;
@group(0) @binding(2) var<storage, read> aspiration_flow_derivative: array<f32>;
@group(0) @binding(3) var<storage, read> pressure_gain: array<f32>;
@group(0) @binding(4) var<storage, read_write> pressure_wave_out: array<f32>;

@compute @workgroup_size(${SOURCE_VOLUME_MIX_WORKGROUP_SIZE.x}, 1, 1)
fn ${SOURCE_VOLUME_MIX_ENTRY_POINT}(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.total_elements) {
        return;
    }
    pressure_wave_out[i] = (glottal_flow_derivative[i] + aspiration_flow_derivative[i]) * pressure_gain[i];
}
`;
}

export default sourceVolumeMixShader;
