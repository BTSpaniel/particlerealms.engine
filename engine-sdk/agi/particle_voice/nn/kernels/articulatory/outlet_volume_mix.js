// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * outlet_volume_mix.js — Convert the two tract boundary-pressure streams to
 * normalized outlet-volume contributions, then mix them.
 *
 * `tract_waveguide` and `nasal_junction` expose the pressure at their open-end
 * boundaries: `(1 + r) * p+`. Far-field radiation is instead proportional to
 * outlet volume velocity, `A * (p+ - p-) / (rho*c)`, hence the host supplies
 * the dimensionless conversion `A * (1 - r) / (1 + r)` under one shared
 * reference scale. Keeping that conversion here, after both waveguides, leaves
 * their scattering recurrences and calibrated resonance frequencies untouched.
 *
 * The oral gain is per sample because lip area moves with articulation. The
 * nasal outlet is normally fixed but uses the same array contract so the mixer
 * stays flat-parallel and supports multiple simultaneous instances. The two
 * input buffers are updated in place with their physical contributions; this
 * makes visualization channels sum exactly to the final PCM rather than showing
 * pre-radiation pressure while the listener hears volume-weighted output.
 */

export const OUTLET_VOLUME_MIX_ENTRY_POINT = 'main';
export const OUTLET_VOLUME_MIX_WORKGROUP_SIZE = Object.freeze({ x: 256, y: 1, z: 1 });

export function outletVolumeMixShader() {
    return /* wgsl */ `
struct Params {
    total_elements: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> oral_boundary: array<f32>;
@group(0) @binding(2) var<storage, read_write> nasal_boundary: array<f32>;
@group(0) @binding(3) var<storage, read> oral_volume_gain: array<f32>;
@group(0) @binding(4) var<storage, read> nasal_volume_gain: array<f32>;
@group(0) @binding(5) var<storage, read_write> mixed_out: array<f32>;

@compute @workgroup_size(${OUTLET_VOLUME_MIX_WORKGROUP_SIZE.x}, 1, 1)
fn ${OUTLET_VOLUME_MIX_ENTRY_POINT}(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.total_elements) {
        return;
    }
    let oral = oral_boundary[i] * oral_volume_gain[i];
    let nasal = nasal_boundary[i] * nasal_volume_gain[i];
    oral_boundary[i] = oral;
    nasal_boundary[i] = nasal;
    mixed_out[i] = oral + nasal;
}
`;
}

export default outletVolumeMixShader;
