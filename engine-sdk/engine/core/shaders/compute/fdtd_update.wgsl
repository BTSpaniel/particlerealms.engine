// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// FDTD Update Shader - Finite-Difference Time-Domain Electromagnetic Solver
// Implements Maxwell's equations with TIME-VARYING materials
//
// TIME REFLECTION PHYSICS:
// When ε(t) changes suddenly, E = D/ε shifts → creates backward wave
// When μ(t) changes suddenly, H = B/μ shifts → frequency conversion
//
// This shader implements the Yee algorithm with staggered grids:
// - E fields at integer grid points (n, n+1, ...)
// - H fields at half-integer points (n+1/2, n+3/2, ...)
// - Leapfrog time stepping for second-order accuracy

// ============================================================================
// STRUCTURES
// ============================================================================

struct Uniforms {
    gridSize: vec3u,
    pad0: u32,

    // Spatial steps (meters)
    dx: f32,
    dy: f32,
    dz: f32,
    dt: f32,

    // Physical constants
    c: f32,           // Speed of light
    epsilon0: f32,    // Vacuum permittivity
    mu0: f32,         // Vacuum permeability
    time: f32,        // Current simulation time

    // Update coefficients
    Cx: f32,          // dt/dx
    Cy: f32,          // dt/dy
    Cz: f32,          // dt/dz
    step: f32,        // Time step number

    // Time-varying material parameters
    modFreq: f32,     // Modulation frequency for time crystals
    modDepth: f32,    // Modulation depth (Δε/ε)
    stepTime: f32,    // Time of step change for time reflection
    stepEpsilon: f32, // New epsilon after step
}

// Field cell: stores D, B, E, H vectors
struct FieldCell {
    D: vec3f,         // Electric displacement
    pad0: f32,
    B: vec3f,         // Magnetic induction
    pad1: f32,
    E: vec3f,         // Electric field intensity
    pad2: f32,
    H: vec3f,         // Magnetic field intensity
    pad3: f32,
}

// Material properties per cell
struct Material {
    epsilon: f32,     // Relative permittivity ε_r
    mu: f32,          // Relative permeability μ_r
    sigma: f32,       // Electric conductivity σ
    sigmaM: f32,      // Magnetic conductivity σ_m
    materialType: f32, // 0=vacuum, 6=time-varying, 7=photonic crystal
}

// Time-varying material region
struct TimeVaryingRegion {
    minBound: vec3f,
    pad0: f32,
    maxBound: vec3f,
    pad1: f32,
    baseEpsilon: f32,
    baseMu: f32,
    modType: f32,     // 0=none, 1=sinusoidal, 2=square, 3=step
    modFreq: f32,
    modDepth: f32,
    modPhase: f32,
    stepTime: f32,
    stepValue: f32,
}

// ============================================================================
// BINDINGS
// ============================================================================

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> fieldsIn: array<FieldCell>;
@group(0) @binding(2) var<storage, read_write> fieldsOut: array<FieldCell>;
@group(0) @binding(3) var<storage, read> materials: array<Material>;

// Optional: time-varying material regions
@group(0) @binding(4) var<storage, read> tvRegions: array<TimeVaryingRegion>;
@group(0) @binding(5) var<uniform> numTVRegions: u32;

// ============================================================================
// CONSTANTS
// ============================================================================

const PI: f32 = 3.14159265359;
const VACUUM: f32 = 0.0;
const TIME_VARYING: f32 = 6.0;
const PHOTONIC_CRYSTAL: f32 = 7.0;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

fn getIndex(pos: vec3u) -> u32 {
    return pos.x + pos.y * u.gridSize.x + pos.z * u.gridSize.x * u.gridSize.y;
}

fn getIndex3D(idx: u32) -> vec3u {
    let z = idx / (u.gridSize.x * u.gridSize.y);
    let rem = idx % (u.gridSize.x * u.gridSize.y);
    let y = rem / u.gridSize.x;
    let x = rem % u.gridSize.x;
    return vec3u(x, y, z);
}

fn clampPos(pos: vec3i) -> vec3u {
    return vec3u(
        u32(clamp(pos.x, 0i, i32(u.gridSize.x) - 1i)),
        u32(clamp(pos.y, 0i, i32(u.gridSize.y) - 1i)),
        u32(clamp(pos.z, 0i, i32(u.gridSize.z) - 1i))
    );
}

fn worldPos(gridPos: vec3u) -> vec3f {
    return vec3f(
        f32(gridPos.x) * u.dx,
        f32(gridPos.y) * u.dy,
        f32(gridPos.z) * u.dz
    );
}

// ============================================================================
// TIME-VARYING MATERIAL FUNCTIONS
// ============================================================================

// Get time-varying permittivity
fn getTimeVaryingEpsilon(pos: vec3u, time: f32) -> f32 {
    let mat = materials[getIndex(pos)];
    var epsilon = mat.epsilon;

    // Check if this is a time-varying material
    if (mat.materialType == TIME_VARYING || mat.materialType == PHOTONIC_CRYSTAL) {
        // Step change (time reflection!)
        if (u.stepTime >= 0.0 && time >= u.stepTime) {
            epsilon = u.stepEpsilon;
        }
        // Periodic modulation (photonic time crystal)
        else if (u.modFreq > 0.0) {
            let phase = 2.0 * PI * u.modFreq * time;
            epsilon = mat.epsilon * (1.0 + u.modDepth * sin(phase));
        }
    }

    return epsilon;
}

// Get time-varying permeability
fn getTimeVaryingMu(pos: vec3u, time: f32) -> f32 {
    let mat = materials[getIndex(pos)];
    // For now, mu is constant (could add modulation)
    return mat.mu;
}

// Check if position is in time-varying region (for region-specific modulation)
fn isInTVRegion(worldP: vec3f, region: TimeVaryingRegion) -> bool {
    return all(worldP >= region.minBound) && all(worldP <= region.maxBound);
}

// ============================================================================
// CURL OPERATORS (Yee Grid)
// ============================================================================

// Curl of H for D update: ∇ × H
// Uses forward differences for Yee grid
fn curlH(pos: vec3u) -> vec3f {
    let posI = vec3i(pos);

    // Get field values at staggered positions
    let idx = getIndex(pos);
    let H = fieldsIn[idx].H;

    // Forward neighbors
    let idxXp = getIndex(clampPos(posI + vec3i(1, 0, 0)));
    let idxYp = getIndex(clampPos(posI + vec3i(0, 1, 0)));
    let idxZp = getIndex(clampPos(posI + vec3i(0, 0, 1)));

    let Hxp = fieldsIn[idxXp].H;
    let Hyp = fieldsIn[idxYp].H;
    let Hzp = fieldsIn[idxZp].H;

    // Backward neighbors
    let idxXm = getIndex(clampPos(posI - vec3i(1, 0, 0)));
    let idxYm = getIndex(clampPos(posI - vec3i(0, 1, 0)));
    let idxZm = getIndex(clampPos(posI - vec3i(0, 0, 1)));

    let Hxm = fieldsIn[idxXm].H;
    let Hym = fieldsIn[idxYm].H;
    let Hzm = fieldsIn[idxZm].H;

    // Central differences for accuracy
    let dHzdy = (Hyp.z - Hym.z) / (2.0 * u.dy);
    let dHydz = (Hzp.y - Hzm.y) / (2.0 * u.dz);
    let dHxdz = (Hzp.x - Hzm.x) / (2.0 * u.dz);
    let dHzdx = (Hxp.z - Hxm.z) / (2.0 * u.dx);
    let dHydx = (Hxp.y - Hxm.y) / (2.0 * u.dx);
    let dHxdy = (Hyp.x - Hym.x) / (2.0 * u.dy);

    // curl(H) = (∂Hz/∂y - ∂Hy/∂z, ∂Hx/∂z - ∂Hz/∂x, ∂Hy/∂x - ∂Hx/∂y)
    return vec3f(
        dHzdy - dHydz,
        dHxdz - dHzdx,
        dHydx - dHxdy
    );
}

// Curl of E for B update: ∇ × E
fn curlE(pos: vec3u) -> vec3f {
    let posI = vec3i(pos);

    let idx = getIndex(pos);
    let E = fieldsOut[idx].E;  // Use updated E from same time step

    let idxXp = getIndex(clampPos(posI + vec3i(1, 0, 0)));
    let idxYp = getIndex(clampPos(posI + vec3i(0, 1, 0)));
    let idxZp = getIndex(clampPos(posI + vec3i(0, 0, 1)));
    let idxXm = getIndex(clampPos(posI - vec3i(1, 0, 0)));
    let idxYm = getIndex(clampPos(posI - vec3i(0, 1, 0)));
    let idxZm = getIndex(clampPos(posI - vec3i(0, 0, 1)));

    let Exp = fieldsOut[idxXp].E;
    let Eyp = fieldsOut[idxYp].E;
    let Ezp = fieldsOut[idxZp].E;
    let Exm = fieldsOut[idxXm].E;
    let Eym = fieldsOut[idxYm].E;
    let Ezm = fieldsOut[idxZm].E;

    let dEzdy = (Eyp.z - Eym.z) / (2.0 * u.dy);
    let dEydz = (Ezp.y - Ezm.y) / (2.0 * u.dz);
    let dExdz = (Ezp.x - Ezm.x) / (2.0 * u.dz);
    let dEzdx = (Exp.z - Exm.z) / (2.0 * u.dx);
    let dEydx = (Exp.y - Exm.y) / (2.0 * u.dx);
    let dExdy = (Eyp.x - Eym.x) / (2.0 * u.dy);

    return vec3f(
        dEzdy - dEydz,
        dExdz - dEzdx,
        dEydx - dExdy
    );
}

// ============================================================================
// FDTD UPDATE KERNELS
// ============================================================================

// Step 1: Update D from curl(H)
// D^(n+1) = D^n + dt * curl(H^(n+1/2))
// This is Faraday's law in integral form
@compute @workgroup_size(8, 8, 4)
fn updateD(@builtin(global_invocation_id) gid: vec3u) {
    if (any(gid >= u.gridSize)) { return; }

    let idx = getIndex(gid);
    let mat = materials[idx];

    // Skip PEC cells (D = 0)
    if (mat.materialType == 3.0) {
        fieldsOut[idx].D = vec3f(0.0);
        return;
    }

    let curl_H = curlH(gid);

    // Ampère's law: ∂D/∂t = curl(H) - J
    // D^(n+1) = D^n + dt * curl(H)
    let D_new = fieldsIn[idx].D + u.dt * curl_H;

    // With conduction current: J = σE
    // D^(n+1) = D^n + dt * (curl(H) - σE)
    var D_final = D_new;
    if (mat.sigma > 0.0) {
        D_final = D_new - u.dt * mat.sigma * fieldsIn[idx].E;
    }

    fieldsOut[idx].D = D_final;
}

// Step 2: Update E from D
// E = D / ε(t)
//
// ████████╗██╗███╗   ███╗███████╗    ██████╗ ███████╗███████╗██╗     ███████╗ ██████╗████████╗██╗ ██████╗ ███╗   ██╗
// ╚══██╔══╝██║████╗ ████║██╔════╝    ██╔══██╗██╔════╝██╔════╝██║     ██╔════╝██╔════╝╚══██╔══╝██║██╔═══██╗████╗  ██║
//    ██║   ██║██╔████╔██║█████╗      ██████╔╝█████╗  █████╗  ██║     █████╗  ██║        ██║   ██║██║   ██║██╔██╗ ██║
//    ██║   ██║██║╚██╔╝██║██╔══╝      ██╔══██╗██╔══╝  ██╔══╝  ██║     ██╔══╝  ██║        ██║   ██║██║   ██║██║╚██╗██║
//    ██║   ██║██║ ╚═╝ ██║███████╗    ██║  ██║███████╗██║     ███████╗███████╗╚██████╗   ██║   ██║╚██████╔╝██║ ╚████║
//    ╚═╝   ╚═╝╚═╝     ╚═╝╚══════╝    ╚═╝  ╚═╝╚══════╝╚═╝     ╚══════╝╚══════╝ ╚═════╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
//
// THIS IS WHERE THE MAGIC HAPPENS!
// When ε(t) changes suddenly:
// - D (displacement) is continuous (conserved quantity)
// - E = D/ε instantaneously changes
// - This creates a BACKWARD-PROPAGATING wave!
// - Frequency is preserved but wavelength changes
//
// For periodic ε(t) → Photonic Time Crystal:
// - Creates temporal band gaps
// - Exponential amplification of certain frequencies
// - Non-reciprocal wave propagation
//
@compute @workgroup_size(8, 8, 4)
fn updateE(@builtin(global_invocation_id) gid: vec3u) {
    if (any(gid >= u.gridSize)) { return; }

    let idx = getIndex(gid);
    let mat = materials[idx];

    // Skip PEC cells
    if (mat.materialType == 3.0) {
        fieldsOut[idx].E = vec3f(0.0);
        return;
    }

    // Get time-varying permittivity - THE KEY TO TIME REFLECTION!
    let epsilon = getTimeVaryingEpsilon(gid, u.time);
    let epsilon_abs = epsilon * u.epsilon0;

    // E = D / ε
    // When ε changes, E changes instantaneously while D stays constant
    // This is the constitutive relation that enables time reflection
    var E_new = fieldsOut[idx].D / epsilon_abs;

    // With conductivity (lossy media)
    if (mat.sigma > 0.0) {
        let loss_factor = mat.sigma * u.dt / (2.0 * epsilon_abs);
        E_new = E_new * (1.0 - loss_factor) / (1.0 + loss_factor);
    }

    fieldsOut[idx].E = E_new;
}

// Step 3: Update B from -curl(E)
// B^(n+1) = B^n - dt * curl(E^(n+1))
// This is Faraday's law
@compute @workgroup_size(8, 8, 4)
fn updateB(@builtin(global_invocation_id) gid: vec3u) {
    if (any(gid >= u.gridSize)) { return; }

    let idx = getIndex(gid);
    let mat = materials[idx];

    // Skip PMC cells (B = 0)
    if (mat.materialType == 4.0) {
        fieldsOut[idx].B = vec3f(0.0);
        return;
    }

    let curl_E = curlE(gid);

    // Faraday's law: ∂B/∂t = -curl(E)
    // B^(n+1) = B^n - dt * curl(E)
    let B_new = fieldsIn[idx].B - u.dt * curl_E;

    // With magnetic conductivity
    var B_final = B_new;
    if (mat.sigmaM > 0.0) {
        B_final = B_new - u.dt * mat.sigmaM * fieldsIn[idx].H;
    }

    fieldsOut[idx].B = B_final;
}

// Step 4: Update H from B
// H = B / μ(t)
// Similar to E update, can enable magnetic time effects
@compute @workgroup_size(8, 8, 4)
fn updateH(@builtin(global_invocation_id) gid: vec3u) {
    if (any(gid >= u.gridSize)) { return; }

    let idx = getIndex(gid);
    let mat = materials[idx];

    // Skip PMC cells
    if (mat.materialType == 4.0) {
        fieldsOut[idx].H = vec3f(0.0);
        return;
    }

    // Get time-varying permeability
    let mu = getTimeVaryingMu(gid, u.time);
    let mu_abs = mu * u.mu0;

    // H = B / μ
    var H_new = fieldsOut[idx].B / mu_abs;

    // With magnetic conductivity
    if (mat.sigmaM > 0.0) {
        let loss_factor = mat.sigmaM * u.dt / (2.0 * mu_abs);
        H_new = H_new * (1.0 - loss_factor) / (1.0 + loss_factor);
    }

    fieldsOut[idx].H = H_new;
}

// ============================================================================
// COMBINED UPDATE (Alternative: single pass)
// ============================================================================

@compute @workgroup_size(8, 8, 4)
fn updateAll(@builtin(global_invocation_id) gid: vec3u) {
    if (any(gid >= u.gridSize)) { return; }

    let idx = getIndex(gid);
    let mat = materials[idx];

    // Get time-varying material properties
    let epsilon = getTimeVaryingEpsilon(gid, u.time) * u.epsilon0;
    let mu = getTimeVaryingMu(gid, u.time) * u.mu0;

    // Step 1: Update D
    let curl_H = curlH(gid);
    let D_new = fieldsIn[idx].D + u.dt * curl_H;
    fieldsOut[idx].D = D_new;

    // Step 2: Update E from D (TIME REFLECTION!)
    fieldsOut[idx].E = D_new / epsilon;

    // Step 3: Update B
    let curl_E = curlE(gid);
    let B_new = fieldsIn[idx].B - u.dt * curl_E;
    fieldsOut[idx].B = B_new;

    // Step 4: Update H from B
    fieldsOut[idx].H = B_new / mu;
}

// ============================================================================
// SOURCE INJECTION
// ============================================================================

struct Source {
    position: vec3f,
    sourceType: f32,  // 0=gaussian, 1=sinusoidal, 2=ricker
    amplitude: f32,
    frequency: f32,
    bandwidth: f32,
    delay: f32,
    polarization: vec3f,
    pad: f32,
}

@group(1) @binding(0) var<storage, read> sources: array<Source>;
@group(1) @binding(1) var<uniform> numSources: u32;

fn gaussianPulse(t: f32, t0: f32, freq: f32) -> f32 {
    let arg = (t - t0) / (t0 / 4.0);
    return exp(-arg * arg) * sin(2.0 * PI * freq * t);
}

fn rickerWavelet(t: f32, t0: f32, freq: f32) -> f32 {
    let tp = t - t0;
    let arg = pow(PI * freq * tp, 2.0);
    return (1.0 - 2.0 * arg) * exp(-arg);
}

@compute @workgroup_size(64)
fn injectSources(@builtin(global_invocation_id) gid: vec3u) {
    let srcIdx = gid.x;
    if (srcIdx >= numSources) { return; }

    let src = sources[srcIdx];

    // Get grid position
    let gridPos = vec3u(
        u32(src.position.x / u.dx),
        u32(src.position.y / u.dy),
        u32(src.position.z / u.dz)
    );

    if (any(gridPos >= u.gridSize)) { return; }

    let idx = getIndex(gridPos);
    let t = u.time - src.delay;

    var value: f32;
    let t0 = 1.0 / src.bandwidth;

    if (src.sourceType == 0.0) {
        value = src.amplitude * gaussianPulse(t, t0, src.frequency);
    } else if (src.sourceType == 1.0) {
        value = src.amplitude * sin(2.0 * PI * src.frequency * t);
    } else {
        value = src.amplitude * rickerWavelet(t, t0, src.frequency);
    }

    // Add to E field (soft source)
    fieldsOut[idx].E = fieldsOut[idx].E + value * src.polarization;
}

// ============================================================================
// PML ABSORBING BOUNDARY
// ============================================================================

// PML conductivity profile (polynomial grading)
fn pmlSigma(depth: f32, maxDepth: f32, sigmaMax: f32) -> f32 {
    let normalized = depth / maxDepth;
    return sigmaMax * pow(normalized, 3.0);  // Cubic profile
}

@compute @workgroup_size(8, 8, 4)
fn applyPML(@builtin(global_invocation_id) gid: vec3u) {
    if (any(gid >= u.gridSize)) { return; }

    let idx = getIndex(gid);
    let pmlDepth = 8u;
    let sigmaMax = 1.0;  // Adjust for optimal absorption

    // Check if in PML region
    var sigma = vec3f(0.0);

    // X boundaries
    if (gid.x < pmlDepth) {
        sigma.x = pmlSigma(f32(pmlDepth - gid.x), f32(pmlDepth), sigmaMax);
    } else if (gid.x >= u.gridSize.x - pmlDepth) {
        sigma.x = pmlSigma(f32(gid.x - (u.gridSize.x - pmlDepth)), f32(pmlDepth), sigmaMax);
    }

    // Y boundaries
    if (gid.y < pmlDepth) {
        sigma.y = pmlSigma(f32(pmlDepth - gid.y), f32(pmlDepth), sigmaMax);
    } else if (gid.y >= u.gridSize.y - pmlDepth) {
        sigma.y = pmlSigma(f32(gid.y - (u.gridSize.y - pmlDepth)), f32(pmlDepth), sigmaMax);
    }

    // Z boundaries
    if (gid.z < pmlDepth) {
        sigma.z = pmlSigma(f32(pmlDepth - gid.z), f32(pmlDepth), sigmaMax);
    } else if (gid.z >= u.gridSize.z - pmlDepth) {
        sigma.z = pmlSigma(f32(gid.z - (u.gridSize.z - pmlDepth)), f32(pmlDepth), sigmaMax);
    }

    // Apply absorption
    let decay = exp(-sigma * u.dt);
    fieldsOut[idx].E = fieldsOut[idx].E * decay;
    fieldsOut[idx].H = fieldsOut[idx].H * decay;
}

// ============================================================================
// VISUALIZATION HELPERS
// ============================================================================

// Convert field magnitude to color for visualization
fn fieldToColor(field: vec3f) -> vec4f {
    let magnitude = length(field);

    // Hot colormap
    let t = clamp(magnitude * 10.0, 0.0, 1.0);
    let r = clamp(t * 3.0, 0.0, 1.0);
    let g = clamp(t * 3.0 - 1.0, 0.0, 1.0);
    let b = clamp(t * 3.0 - 2.0, 0.0, 1.0);

    return vec4f(r, g, b, 1.0);
}

// Poynting vector (energy flow direction)
fn poyntingVector(E: vec3f, H: vec3f) -> vec3f {
    return cross(E, H);
}

// Energy density
fn energyDensity(E: vec3f, H: vec3f, epsilon: f32, mu: f32) -> f32 {
    return 0.5 * (epsilon * dot(E, E) + mu * dot(H, H));
}
