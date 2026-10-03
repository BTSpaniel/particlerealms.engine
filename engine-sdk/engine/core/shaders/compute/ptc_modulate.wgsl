// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Photonic Time Crystal (PTC) Modulation Shader
// Implements time-varying permittivity and permeability for temporal band gaps
//
// Physics:
// - Periodic ε(t) = ε₀ + δ·cos(Ωt) creates momentum band gaps
// - Floquet theorem: E(t) = e^(μt) · P(t) where P(t) is periodic
// - In band gap: μ is real → exponential growth/decay
// - Outside gap: μ is imaginary → oscillatory behavior
//
// Key effects:
// - Momentum gaps (not frequency gaps like spatial crystals)
// - Parametric amplification in gap regions
// - Non-reciprocal propagation
// - Frequency preservation (unlike spatial refraction)

// ============================================================================
// CONSTANTS
// ============================================================================

const PI: f32 = 3.14159265359;
const TWO_PI: f32 = 6.28318530718;
const C: f32 = 2.998e8;           // Speed of light
const EPSILON_0: f32 = 8.854e-12; // Vacuum permittivity
const MU_0: f32 = 1.2566e-6;      // Vacuum permeability

// Saturation limits to prevent NaN/Inf
const E_SATURATION: f32 = 1e6;    // Maximum field amplitude
const GROWTH_LIMIT: f32 = 10.0;   // Maximum Floquet exponent

// ============================================================================
// STRUCTURES
// ============================================================================

struct PTCUniforms {
    time: f32,
    dt: f32,

    // Modulation parameters
    baseEpsilon: f32,
    baseMu: f32,
    modulationStrength: f32,  // δ/ε₀ (relative modulation depth)
    modulationFrequency: f32, // Ω (rad/s)
    modulationPhase: f32,     // Phase offset for μ modulation

    // Grid info
    gridSize: vec3u,
    cellSize: f32,

    // PTC zone bounds
    ptcMin: vec3f,
    ptcMax: vec3f,

    // Band gap info
    gapCenterK: f32,          // k value at gap center
    gapWidth: f32,            // Width of momentum gap

    // Saturation control
    saturationEnabled: u32,
    saturationThreshold: f32,
}

struct PTCZone {
    minBound: vec3f,
    maxBound: vec3f,
    baseEpsilon: f32,
    baseMu: f32,
    modStrength: f32,
    modFrequency: f32,
    modPhase: f32,
    enabled: f32,
}

struct FloquetResult {
    exponent: f32,       // μ (real part = growth, imaginary = oscillation)
    isInGap: f32,        // 1.0 if in band gap, 0.0 otherwise
    growthRate: f32,     // Exponential growth rate in gap
    periodicFactor: f32, // P(t) periodic component
}

// ============================================================================
// BINDINGS
// ============================================================================

@group(0) @binding(0) var<uniform> u: PTCUniforms;
@group(0) @binding(1) var<storage, read> ptcZones: array<PTCZone>;
@group(0) @binding(2) var<uniform> numZones: u32;

// Material buffers
@group(0) @binding(3) var<storage, read_write> epsilonBuffer: array<f32>;
@group(0) @binding(4) var<storage, read_write> muBuffer: array<f32>;

// Field buffers (for saturation)
@group(0) @binding(5) var<storage, read_write> fieldAmplitudes: array<f32>;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

fn getIndex(pos: vec3u) -> u32 {
    return pos.x + pos.y * u.gridSize.x + pos.z * u.gridSize.x * u.gridSize.y;
}

fn worldPos(gridPos: vec3u) -> vec3f {
    return vec3f(gridPos) * u.cellSize;
}

fn isInZone(pos: vec3f, zone: PTCZone) -> bool {
    return all(pos >= zone.minBound) && all(pos <= zone.maxBound) && zone.enabled > 0.5;
}

fn isInPTCRegion(pos: vec3f) -> bool {
    return all(pos >= u.ptcMin) && all(pos <= u.ptcMax);
}

// ============================================================================
// TIME-VARYING MATERIAL FUNCTIONS
// ============================================================================

// Calculate time-varying permittivity
// ε(t) = ε₀(1 + δ·cos(Ωt))
fn calculateTimeVaryingEpsilon(pos: vec3u, time: f32) -> f32 {
    let worldP = worldPos(pos);

    // Check if in any PTC zone
    for (var i = 0u; i < numZones; i++) {
        let zone = ptcZones[i];
        if (isInZone(worldP, zone)) {
            let phase = zone.modFrequency * time;
            return zone.baseEpsilon * (1.0 + zone.modStrength * cos(phase));
        }
    }

    // Check global PTC region
    if (isInPTCRegion(worldP)) {
        let phase = u.modulationFrequency * time;
        return u.baseEpsilon * (1.0 + u.modulationStrength * cos(phase));
    }

    return 1.0; // Vacuum
}

// Calculate time-varying permeability
// μ(t) = μ₀(1 + δ·cos(Ωt + φ))
// Phase shift φ allows for mixed ε-μ modulation effects
fn calculateTimeVaryingMu(pos: vec3u, time: f32) -> f32 {
    let worldP = worldPos(pos);

    for (var i = 0u; i < numZones; i++) {
        let zone = ptcZones[i];
        if (isInZone(worldP, zone)) {
            let phase = zone.modFrequency * time + zone.modPhase;
            return zone.baseMu * (1.0 + zone.modStrength * cos(phase));
        }
    }

    if (isInPTCRegion(worldP)) {
        let phase = u.modulationFrequency * time + u.modulationPhase;
        return u.baseMu * (1.0 + u.modulationStrength * cos(phase));
    }

    return 1.0; // Vacuum
}

// Calculate instantaneous phase velocity
// v = c / n = c / sqrt(ε·μ)
fn calculatePhaseVelocity(epsilon: f32, mu: f32) -> f32 {
    let n = sqrt(epsilon * mu);
    return C / n;
}

// Calculate instantaneous impedance
// η = sqrt(μ/ε)
fn calculateImpedance(epsilon: f32, mu: f32) -> f32 {
    return sqrt(mu / max(epsilon, 0.001));
}

// ============================================================================
// FLOQUET ANALYSIS
// ============================================================================

// Compute Floquet exponent for wave in PTC
// For periodic medium, solutions are: E(t) = e^(μt) · P(t)
// where P(t) has the same period as the modulation
fn computeFloquetExponent(k: f32, omega: f32) -> FloquetResult {
    var result: FloquetResult;

    // Modulation parameters
    let Omega = u.modulationFrequency;
    let delta = u.modulationStrength;
    let epsilon0 = u.baseEpsilon;

    // Base phase velocity
    let c0 = C / sqrt(epsilon0);

    // Momentum gap locations: k_gap = n·Ω/(2·c₀)
    let kGap = Omega / (2.0 * c0);

    // Distance to nearest gap
    let n = round(k / kGap);
    let kNearest = n * kGap;
    let distToGap = abs(k - kNearest);

    // Gap width scales with modulation depth
    let gapHalfWidth = delta * kGap * 0.5;

    // Check if in gap
    result.isInGap = select(0.0, 1.0, distToGap < gapHalfWidth && n > 0.0);

    if (result.isInGap > 0.5) {
        // In band gap: exponential growth/decay
        // Growth rate: μ ≈ Ω·δ/4 at gap center
        let gapPosition = distToGap / gapHalfWidth; // 0 at center, 1 at edge
        result.growthRate = Omega * delta * 0.25 * (1.0 - gapPosition * gapPosition);
        result.exponent = result.growthRate;
    } else {
        // Outside gap: oscillatory (imaginary exponent)
        result.growthRate = 0.0;
        result.exponent = 0.0;
    }

    // Periodic factor P(t)
    let phase = Omega * u.time;
    result.periodicFactor = 1.0 + delta * 0.5 * cos(phase);

    return result;
}

// Approximate momentum band gap boundaries
// Returns (k_lower, k_upper) for nth gap
fn getBandGapBounds(n: u32) -> vec2f {
    let Omega = u.modulationFrequency;
    let delta = u.modulationStrength;
    let c0 = C / sqrt(u.baseEpsilon);

    let kCenter = f32(n) * Omega / (2.0 * c0);
    let gapWidth = delta * kCenter;

    return vec2f(kCenter - gapWidth * 0.5, kCenter + gapWidth * 0.5);
}

// ============================================================================
// SATURATION / STABILITY CONTROL
// ============================================================================

// Soft clipping to prevent numerical explosion
// Uses tanh for smooth saturation: E_final = E_sat · tanh(E/E_sat)
fn saturateField(E: f32) -> f32 {
    if (u.saturationEnabled == 0u) {
        return E;
    }
    return u.saturationThreshold * tanh(E / u.saturationThreshold);
}

fn saturateFieldVec3(E: vec3f) -> vec3f {
    return vec3f(
        saturateField(E.x),
        saturateField(E.y),
        saturateField(E.z)
    );
}

// Clamp Floquet growth to prevent runaway
fn clampGrowth(growth: f32, dt: f32) -> f32 {
    let maxGrowthPerStep = GROWTH_LIMIT * dt;
    return clamp(growth * dt, -maxGrowthPerStep, maxGrowthPerStep);
}

// Apply parametric amplification with saturation
fn applyParametricGain(amplitude: f32, floquet: FloquetResult, dt: f32) -> f32 {
    if (floquet.isInGap < 0.5) {
        return amplitude; // No amplification outside gap
    }

    // Exponential growth: A(t+dt) = A(t) · e^(μ·dt)
    let growthFactor = exp(clampGrowth(floquet.growthRate, dt));
    var newAmplitude = amplitude * growthFactor;

    // Apply saturation
    newAmplitude = saturateField(newAmplitude);

    return newAmplitude;
}

// ============================================================================
// COMPUTE KERNELS
// ============================================================================

// Update material properties buffer with time-varying values
@compute @workgroup_size(8, 8, 4)
fn updateMaterials(@builtin(global_invocation_id) gid: vec3u) {
    if (any(gid >= u.gridSize)) { return; }

    let idx = getIndex(gid);

    // Calculate time-varying ε and μ
    let epsilon = calculateTimeVaryingEpsilon(gid, u.time);
    let mu = calculateTimeVaryingMu(gid, u.time);

    // Write to material buffers
    epsilonBuffer[idx] = epsilon;
    muBuffer[idx] = mu;
}

// Apply parametric amplification to fields in band gap regions
@compute @workgroup_size(8, 8, 4)
fn applyParametricAmplification(@builtin(global_invocation_id) gid: vec3u) {
    if (any(gid >= u.gridSize)) { return; }

    let idx = getIndex(gid);
    let worldP = worldPos(gid);

    // Only process PTC regions
    if (!isInPTCRegion(worldP)) { return; }

    // Get current field amplitude
    var amplitude = fieldAmplitudes[idx];

    // Estimate local wave vector (would come from field gradients in practice)
    // Simplified: use characteristic k based on base frequency
    let omega = u.modulationFrequency; // Assume wave at modulation frequency
    let k = omega * sqrt(u.baseEpsilon) / C;

    // Compute Floquet analysis
    let floquet = computeFloquetExponent(k, omega);

    // Apply amplification
    amplitude = applyParametricGain(amplitude, floquet, u.dt);

    // Write back
    fieldAmplitudes[idx] = amplitude;
}

// Combined material update with stability checks
@compute @workgroup_size(8, 8, 4)
fn updateMaterialsWithStability(@builtin(global_invocation_id) gid: vec3u) {
    if (any(gid >= u.gridSize)) { return; }

    let idx = getIndex(gid);
    let worldP = worldPos(gid);

    // Calculate time-varying materials
    var epsilon = calculateTimeVaryingEpsilon(gid, u.time);
    var mu = calculateTimeVaryingMu(gid, u.time);

    // Stability: ensure positive ε and μ
    epsilon = max(epsilon, 0.01);
    mu = max(mu, 0.01);

    // CFL stability check: c·dt/dx < 1/√3
    let c_local = C / sqrt(epsilon * mu);
    let cfl = c_local * u.dt / u.cellSize;
    let cfl_limit = 0.577; // 1/√3

    // If CFL violated, increase ε to slow down waves
    if (cfl > cfl_limit) {
        let required_n = c_local * u.dt / (u.cellSize * cfl_limit);
        epsilon = required_n * required_n / mu;
    }

    // Write to buffers
    epsilonBuffer[idx] = epsilon;
    muBuffer[idx] = mu;
}

// ============================================================================
// BAND GAP ANALYSIS KERNEL
// ============================================================================

struct BandGapInfo {
    isInGap: f32,
    gapIndex: f32,
    distanceToCenter: f32,
    growthRate: f32,
}

@group(1) @binding(0) var<storage, read_write> bandGapMap: array<BandGapInfo>;

// Compute band gap map for visualization
@compute @workgroup_size(8, 8, 4)
fn computeBandGapMap(@builtin(global_invocation_id) gid: vec3u) {
    if (any(gid >= u.gridSize)) { return; }

    let idx = getIndex(gid);
    let worldP = worldPos(gid);

    var info: BandGapInfo;
    info.isInGap = 0.0;
    info.gapIndex = 0.0;
    info.distanceToCenter = 1.0;
    info.growthRate = 0.0;

    if (isInPTCRegion(worldP)) {
        // Check multiple band gaps
        for (var n = 1u; n <= 5u; n++) {
            let bounds = getBandGapBounds(n);
            let kTest = u.gapCenterK; // Would use actual local k

            if (kTest >= bounds.x && kTest <= bounds.y) {
                info.isInGap = 1.0;
                info.gapIndex = f32(n);

                let gapCenter = (bounds.x + bounds.y) * 0.5;
                let gapWidth = bounds.y - bounds.x;
                info.distanceToCenter = abs(kTest - gapCenter) / (gapWidth * 0.5);

                // Growth rate peaks at gap center
                info.growthRate = u.modulationFrequency * u.modulationStrength * 0.25 *
                                  (1.0 - info.distanceToCenter * info.distanceToCenter);
                break;
            }
        }
    }

    bandGapMap[idx] = info;
}

// ============================================================================
// VISUALIZATION HELPERS
// ============================================================================

// Color for band gap regions (for debug visualization)
fn bandGapColor(info: BandGapInfo) -> vec4f {
    if (info.isInGap < 0.5) {
        return vec4f(0.0, 0.0, 0.0, 0.0); // Transparent outside gap
    }

    // Color by gap index
    var baseColor: vec3f;
    let gapIdx = u32(info.gapIndex);
    switch (gapIdx) {
        case 1u: { baseColor = vec3f(1.0, 0.2, 0.2); } // Red - first gap
        case 2u: { baseColor = vec3f(0.2, 1.0, 0.2); } // Green - second gap
        case 3u: { baseColor = vec3f(0.2, 0.2, 1.0); } // Blue - third gap
        case 4u: { baseColor = vec3f(1.0, 1.0, 0.2); } // Yellow
        default: { baseColor = vec3f(1.0, 0.2, 1.0); } // Magenta
    }

    // Intensity by distance to gap center (brighter at center)
    let intensity = 1.0 - info.distanceToCenter * 0.5;

    // Pulse based on growth rate
    let pulse = 0.8 + 0.2 * sin(info.growthRate * 10.0);

    return vec4f(baseColor * intensity * pulse, 0.5);
}

// Modulation phase visualization
fn modulationPhaseColor(pos: vec3u, time: f32) -> vec3f {
    let epsilon = calculateTimeVaryingEpsilon(pos, time);
    let normalizedEpsilon = (epsilon - u.baseEpsilon * (1.0 - u.modulationStrength)) /
                            (2.0 * u.baseEpsilon * u.modulationStrength);

    // Blue = low ε (fast), Red = high ε (slow)
    return mix(vec3f(0.2, 0.4, 1.0), vec3f(1.0, 0.3, 0.2), normalizedEpsilon);
}
