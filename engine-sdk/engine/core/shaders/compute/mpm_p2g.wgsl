// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MLS-MPM Particle to Grid (P2G) Transfer Shader
// Scatters particle mass and momentum to grid using quadratic B-splines
//
// Key Challenge: WebGPU has no f32 atomics
// Solution: Fixed-point i32 atomics (scale by 10000)
//
// Algorithm:
// 1. Compute stress from deformation gradient
// 2. For each particle's 3x3x3 neighborhood:
//    - Compute B-spline weight and gradient
//    - Atomically add mass (fixed-point)
//    - Atomically add momentum + stress contribution (fixed-point)

// ============================================================================
// CONSTANTS
// ============================================================================

const FIXED_POINT_SCALE: f32 = 10000.0;
const PI: f32 = 3.14159265359;

// Constitutive model types
const MODEL_NEO_HOOKEAN: u32 = 0u;
const MODEL_FIXED_COROTATED: u32 = 1u;
const MODEL_SNOW: u32 = 2u;
const MODEL_FLUID: u32 = 3u;

// ============================================================================
// STRUCTURES
// ============================================================================

struct Uniforms {
    gravity: vec3f,
    dt: f32,
    gridSize: f32,
    cellSize: f32,
    fixedPointScale: f32,
    numParticles: u32,
}

// Grid cell: mass + momentum (all fixed-point i32)
struct GridCell {
    mass: atomic<i32>,
    momentumX: atomic<i32>,
    momentumY: atomic<i32>,
    momentumZ: atomic<i32>,
}

// ============================================================================
// BINDINGS
// ============================================================================

// Particle data (SoA layout)
@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read> velocities: array<vec4f>;
@group(0) @binding(2) var<storage, read> deformations: array<mat3x3f>; // F matrices
@group(0) @binding(3) var<storage, read> affines: array<mat3x3f>;      // C matrices (APIC)
@group(0) @binding(4) var<storage, read> massVolumes: array<vec2f>;    // [mass, volume]
@group(0) @binding(5) var<storage, read> materials: array<vec4f>;      // [mu, lambda, model, Jp]

// Grid (fixed-point atomics)
@group(0) @binding(6) var<storage, read_write> grid: array<GridCell>;

// Uniforms
@group(0) @binding(7) var<uniform> uniforms: Uniforms;

// ============================================================================
// B-SPLINE FUNCTIONS
// ============================================================================

// Quadratic B-spline weight
fn bsplineWeight(x: f32) -> f32 {
    let ax = abs(x);
    if (ax < 0.5) {
        return 0.75 - ax * ax;
    } else if (ax < 1.5) {
        let t = 1.5 - ax;
        return 0.5 * t * t;
    }
    return 0.0;
}

// Quadratic B-spline gradient
fn bsplineGrad(x: f32) -> f32 {
    let ax = abs(x);
    let sign = select(-1.0, 1.0, x >= 0.0);
    if (ax < 0.5) {
        return -2.0 * x;
    } else if (ax < 1.5) {
        return sign * (ax - 1.5);
    }
    return 0.0;
}

// Compute 3D weight
fn computeWeight3D(particlePos: vec3f, gridPos: vec3i, cellSize: f32) -> f32 {
    let diff = particlePos - vec3f(gridPos) * cellSize;
    let dx = diff / cellSize;
    return bsplineWeight(dx.x) * bsplineWeight(dx.y) * bsplineWeight(dx.z);
}

// Compute 3D weight gradient
fn computeWeightGrad3D(particlePos: vec3f, gridPos: vec3i, cellSize: f32) -> vec3f {
    let diff = particlePos - vec3f(gridPos) * cellSize;
    let dx = diff / cellSize;

    let wx = bsplineWeight(dx.x);
    let wy = bsplineWeight(dx.y);
    let wz = bsplineWeight(dx.z);

    let dwx = bsplineGrad(dx.x) / cellSize;
    let dwy = bsplineGrad(dx.y) / cellSize;
    let dwz = bsplineGrad(dx.z) / cellSize;

    return vec3f(dwx * wy * wz, wx * dwy * wz, wx * wy * dwz);
}

// ============================================================================
// STRESS COMPUTATION
// ============================================================================

// Matrix determinant
fn det3x3(m: mat3x3f) -> f32 {
    return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
         - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
         + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
}

// Matrix inverse
fn inv3x3(m: mat3x3f) -> mat3x3f {
    let det = det3x3(m);
    let invDet = select(1.0, 1.0 / det, abs(det) > 1e-10);

    return mat3x3f(
        vec3f(
            (m[1][1] * m[2][2] - m[1][2] * m[2][1]) * invDet,
            (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * invDet,
            (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * invDet
        ),
        vec3f(
            (m[1][2] * m[2][0] - m[1][0] * m[2][2]) * invDet,
            (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * invDet,
            (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * invDet
        ),
        vec3f(
            (m[1][0] * m[2][1] - m[1][1] * m[2][0]) * invDet,
            (m[0][1] * m[2][0] - m[0][0] * m[2][1]) * invDet,
            (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * invDet
        )
    );
}

// Neo-Hookean stress (Cauchy)
fn computeStressNeoHookean(F: mat3x3f, mu: f32, lambda: f32) -> mat3x3f {
    let J = det3x3(F);
    let Jclamped = max(J, 0.01);
    let logJ = log(Jclamped);

    let Finv = inv3x3(F);
    let FinvT = transpose(Finv);

    // P = mu * (F - F^-T) + lambda * log(J) * F^-T
    let P = mu * (F - FinvT) + lambda * logJ * FinvT;

    // Cauchy = P * F^T / J
    let cauchy = P * transpose(F) * (1.0 / Jclamped);

    return cauchy;
}

// Fixed Corotated stress (more stable for large deformations)
fn computeStressFixedCorotated(F: mat3x3f, mu: f32, lambda: f32) -> mat3x3f {
    let J = det3x3(F);
    let Jclamped = max(J, 0.01);

    // Simplified: use F directly (proper implementation needs SVD)
    // P = 2 * mu * (F - R) + lambda * (J - 1) * J * F^-T
    // For now, approximate R ≈ F / ||F|| (not correct but stable)

    let Fnorm = sqrt(F[0][0]*F[0][0] + F[0][1]*F[0][1] + F[0][2]*F[0][2] +
                     F[1][0]*F[1][0] + F[1][1]*F[1][1] + F[1][2]*F[1][2] +
                     F[2][0]*F[2][0] + F[2][1]*F[2][1] + F[2][2]*F[2][2]);

    let R = F * (1.0 / max(Fnorm, 0.01));

    let Finv = inv3x3(F);
    let FinvT = transpose(Finv);

    let P = 2.0 * mu * (F - R) + lambda * (Jclamped - 1.0) * Jclamped * FinvT;
    let cauchy = P * transpose(F) * (1.0 / Jclamped);

    return cauchy;
}

// Select stress based on model
fn computeStress(F: mat3x3f, mu: f32, lambda: f32, model: u32) -> mat3x3f {
    switch (model) {
        case MODEL_NEO_HOOKEAN: {
            return computeStressNeoHookean(F, mu, lambda);
        }
        case MODEL_FIXED_COROTATED: {
            return computeStressFixedCorotated(F, mu, lambda);
        }
        default: {
            return computeStressNeoHookean(F, mu, lambda);
        }
    }
}

// ============================================================================
// GRID INDEX HELPERS
// ============================================================================

fn gridIndex(gx: i32, gy: i32, gz: i32, gridSize: i32) -> u32 {
    return u32(gx + gy * gridSize + gz * gridSize * gridSize);
}

fn isValidGridCell(gx: i32, gy: i32, gz: i32, gridSize: i32) -> bool {
    return gx >= 0 && gx < gridSize && gy >= 0 && gy < gridSize && gz >= 0 && gz < gridSize;
}

// ============================================================================
// MAIN P2G KERNEL
// ============================================================================

@compute @workgroup_size(256)
fn p2g(@builtin(global_invocation_id) gid: vec3u) {
    let particleIdx = gid.x;
    if (particleIdx >= uniforms.numParticles) { return; }

    // Load particle data
    let pos = positions[particleIdx].xyz;
    let vel = velocities[particleIdx].xyz;
    let F = deformations[particleIdx];
    let C = affines[particleIdx];
    let massVol = massVolumes[particleIdx];
    let mat = materials[particleIdx];

    let mass = massVol.x;
    let volume = massVol.y;
    let mu = mat.x;
    let lambda = mat.y;
    let model = u32(mat.z);

    let gridSize = i32(uniforms.gridSize);
    let cellSize = uniforms.cellSize;
    let dt = uniforms.dt;
    let scale = uniforms.fixedPointScale;

    // Compute stress
    let stress = computeStress(F, mu, lambda, model);

    // Base grid cell
    let baseCell = vec3i(floor(pos / cellSize));

    // Loop over 3x3x3 neighborhood
    for (var dz = -1; dz <= 1; dz++) {
        for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
                let gridPos = baseCell + vec3i(dx, dy, dz);

                if (!isValidGridCell(gridPos.x, gridPos.y, gridPos.z, gridSize)) {
                    continue;
                }

                let cellIdx = gridIndex(gridPos.x, gridPos.y, gridPos.z, gridSize);

                // Compute weight and gradient
                let weight = computeWeight3D(pos, gridPos, cellSize);
                let weightGrad = computeWeightGrad3D(pos, gridPos, cellSize);

                if (weight < 1e-10) { continue; }

                // Distance from particle to grid node
                let dpos = vec3f(gridPos) * cellSize - pos;

                // APIC velocity: v + C * dpos
                let affineVel = vel + C * dpos;

                // Momentum contribution
                var momentum = mass * weight * affineVel;

                // Force from stress: f = -volume * stress * grad(w)
                let force = -volume * stress * weightGrad;
                momentum += force * dt;

                // Convert to fixed-point and atomically add
                let massFixed = i32(mass * weight * scale);
                let momXFixed = i32(momentum.x * scale);
                let momYFixed = i32(momentum.y * scale);
                let momZFixed = i32(momentum.z * scale);

                atomicAdd(&grid[cellIdx].mass, massFixed);
                atomicAdd(&grid[cellIdx].momentumX, momXFixed);
                atomicAdd(&grid[cellIdx].momentumY, momYFixed);
                atomicAdd(&grid[cellIdx].momentumZ, momZFixed);
            }
        }
    }
}

// ============================================================================
// CLEAR GRID KERNEL
// ============================================================================

@compute @workgroup_size(256)
fn clearGrid(@builtin(global_invocation_id) gid: vec3u) {
    let gridSize = u32(uniforms.gridSize);
    let totalCells = gridSize * gridSize * gridSize;
    let cellIdx = gid.x;

    if (cellIdx >= totalCells) { return; }

    atomicStore(&grid[cellIdx].mass, 0);
    atomicStore(&grid[cellIdx].momentumX, 0);
    atomicStore(&grid[cellIdx].momentumY, 0);
    atomicStore(&grid[cellIdx].momentumZ, 0);
}
