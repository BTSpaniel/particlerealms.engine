// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MLS-MPM Grid to Particle (G2P) Transfer Shader
// Gathers velocity from grid, updates deformation gradient, advects particles
//
// Pipeline position: After grid update, final step of MPM cycle
//
// Operations:
// 1. Gather velocity from 3x3x3 neighborhood using B-spline weights
// 2. Compute APIC affine matrix C for momentum conservation
// 3. Update deformation gradient F = (I + dt*C) * F
// 4. Advect particle position

// ============================================================================
// CONSTANTS
// ============================================================================

const PI: f32 = 3.14159265359;

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

struct GridCellVelocity {
    velocity: vec3f,
    mass: f32,
}

// ============================================================================
// BINDINGS
// ============================================================================

// Particle data (read-write)
@group(0) @binding(0) var<storage, read_write> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> deformations: array<mat3x3f>;
@group(0) @binding(3) var<storage, read_write> affines: array<mat3x3f>;
@group(0) @binding(4) var<storage, read> massVolumes: array<vec2f>;
@group(0) @binding(5) var<storage, read_write> materials: array<vec4f>; // For Jp update (snow)

// Grid velocity (from grid update)
@group(0) @binding(6) var<storage, read> gridVelocity: array<GridCellVelocity>;

// Uniforms
@group(0) @binding(7) var<uniform> uniforms: Uniforms;

// ============================================================================
// B-SPLINE FUNCTIONS
// ============================================================================

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

fn computeWeight3D(particlePos: vec3f, gridPos: vec3i, cellSize: f32) -> f32 {
    let diff = particlePos - vec3f(gridPos) * cellSize;
    let dx = diff / cellSize;
    return bsplineWeight(dx.x) * bsplineWeight(dx.y) * bsplineWeight(dx.z);
}

// ============================================================================
// HELPERS
// ============================================================================

fn gridIndex(gx: i32, gy: i32, gz: i32, gridSize: i32) -> u32 {
    return u32(gx + gy * gridSize + gz * gridSize * gridSize);
}

fn isValidGridCell(gx: i32, gy: i32, gz: i32, gridSize: i32) -> bool {
    return gx >= 0 && gx < gridSize && gy >= 0 && gy < gridSize && gz >= 0 && gz < gridSize;
}

// Matrix determinant
fn det3x3(m: mat3x3f) -> f32 {
    return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
         - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
         + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
}

// ============================================================================
// MAIN G2P KERNEL
// ============================================================================

@compute @workgroup_size(256)
fn g2p(@builtin(global_invocation_id) gid: vec3u) {
    let particleIdx = gid.x;
    if (particleIdx >= uniforms.numParticles) { return; }

    // Load particle position
    var pos = positions[particleIdx].xyz;

    let gridSize = i32(uniforms.gridSize);
    let cellSize = uniforms.cellSize;
    let dt = uniforms.dt;

    // Base grid cell
    let baseCell = vec3i(floor(pos / cellSize));

    // Initialize gathered values
    var newVel = vec3f(0.0);
    var newC = mat3x3f(
        vec3f(0.0),
        vec3f(0.0),
        vec3f(0.0)
    );

    // Gather from 3x3x3 neighborhood
    for (var dz = -1; dz <= 1; dz++) {
        for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
                let gridPos = baseCell + vec3i(dx, dy, dz);

                if (!isValidGridCell(gridPos.x, gridPos.y, gridPos.z, gridSize)) {
                    continue;
                }

                let cellIdx = gridIndex(gridPos.x, gridPos.y, gridPos.z, gridSize);
                let cell = gridVelocity[cellIdx];

                // Skip empty cells
                if (cell.mass < 1e-10) { continue; }

                let weight = computeWeight3D(pos, gridPos, cellSize);
                if (weight < 1e-10) { continue; }

                let gridVel = cell.velocity;

                // Gather velocity
                newVel += weight * gridVel;

                // APIC: C += weight * v * dpos^T * (4/dx^2)
                let dpos = vec3f(gridPos) * cellSize - pos;
                let scale = 4.0 / (cellSize * cellSize);

                // Outer product: v * dpos^T
                // C[i][j] += weight * gridVel[i] * dpos[j] * scale
                newC[0] += weight * gridVel * dpos.x * scale;
                newC[1] += weight * gridVel * dpos.y * scale;
                newC[2] += weight * gridVel * dpos.z * scale;
            }
        }
    }

    // Store new velocity and affine
    velocities[particleIdx] = vec4f(newVel, 0.0);
    affines[particleIdx] = newC;

    // Update deformation gradient: F_new = (I + dt * C) * F_old
    let F_old = deformations[particleIdx];

    let I_plus_dtC = mat3x3f(
        vec3f(1.0 + dt * newC[0][0], dt * newC[0][1], dt * newC[0][2]),
        vec3f(dt * newC[1][0], 1.0 + dt * newC[1][1], dt * newC[1][2]),
        vec3f(dt * newC[2][0], dt * newC[2][1], 1.0 + dt * newC[2][2])
    );

    var F_new = I_plus_dtC * F_old;

    // Clamp deformation gradient for stability
    let J = det3x3(F_new);
    if (J < 0.1) {
        // Prevent excessive compression
        F_new = F_new * pow(0.1 / max(J, 0.001), 1.0/3.0);
    } else if (J > 10.0) {
        // Prevent excessive expansion
        F_new = F_new * pow(10.0 / J, 1.0/3.0);
    }

    deformations[particleIdx] = F_new;

    // Advect position
    pos += newVel * dt;

    // Clamp position to grid bounds
    let margin = cellSize * 3.0;
    let gridExtent = f32(gridSize) * cellSize;
    pos = clamp(pos, vec3f(margin), vec3f(gridExtent - margin));

    positions[particleIdx] = vec4f(pos, 0.0);
}

// ============================================================================
// G2P WITH SNOW PLASTICITY
// ============================================================================

@compute @workgroup_size(256)
fn g2pSnow(@builtin(global_invocation_id) gid: vec3u) {
    let particleIdx = gid.x;
    if (particleIdx >= uniforms.numParticles) { return; }

    var pos = positions[particleIdx].xyz;
    var mat = materials[particleIdx];

    let gridSize = i32(uniforms.gridSize);
    let cellSize = uniforms.cellSize;
    let dt = uniforms.dt;

    let baseCell = vec3i(floor(pos / cellSize));

    var newVel = vec3f(0.0);
    var newC = mat3x3f(vec3f(0.0), vec3f(0.0), vec3f(0.0));

    // Gather (same as regular G2P)
    for (var dz = -1; dz <= 1; dz++) {
        for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
                let gridPos = baseCell + vec3i(dx, dy, dz);

                if (!isValidGridCell(gridPos.x, gridPos.y, gridPos.z, gridSize)) {
                    continue;
                }

                let cellIdx = gridIndex(gridPos.x, gridPos.y, gridPos.z, gridSize);
                let cell = gridVelocity[cellIdx];

                if (cell.mass < 1e-10) { continue; }

                let weight = computeWeight3D(pos, gridPos, cellSize);
                if (weight < 1e-10) { continue; }

                let gridVel = cell.velocity;
                newVel += weight * gridVel;

                let dpos = vec3f(gridPos) * cellSize - pos;
                let scale = 4.0 / (cellSize * cellSize);
                newC[0] += weight * gridVel * dpos.x * scale;
                newC[1] += weight * gridVel * dpos.y * scale;
                newC[2] += weight * gridVel * dpos.z * scale;
            }
        }
    }

    velocities[particleIdx] = vec4f(newVel, 0.0);
    affines[particleIdx] = newC;

    // Update F with plasticity
    let F_old = deformations[particleIdx];

    let I_plus_dtC = mat3x3f(
        vec3f(1.0 + dt * newC[0][0], dt * newC[0][1], dt * newC[0][2]),
        vec3f(dt * newC[1][0], 1.0 + dt * newC[1][1], dt * newC[1][2]),
        vec3f(dt * newC[2][0], dt * newC[2][1], 1.0 + dt * newC[2][2])
    );

    var F_new = I_plus_dtC * F_old;

    // Snow plasticity parameters
    let thetaC = 0.025; // Critical compression
    let thetaS = 0.0075; // Critical stretch

    // Simplified plasticity (proper implementation needs SVD)
    let J_new = det3x3(F_new);
    var Jp = mat.w; // Plastic Jacobian

    // Clamp J to prevent excessive deformation
    let J_clamped = clamp(J_new, 1.0 - thetaC, 1.0 + thetaS);

    // Update plastic Jacobian
    Jp = Jp * J_new / J_clamped;
    Jp = clamp(Jp, 0.6, 20.0);

    // Scale F to satisfy clamped J
    if (abs(J_new) > 0.001) {
        F_new = F_new * pow(J_clamped / J_new, 1.0/3.0);
    }

    deformations[particleIdx] = F_new;
    mat.w = Jp;
    materials[particleIdx] = mat;

    // Advect
    pos += newVel * dt;

    let margin = cellSize * 3.0;
    let gridExtent = f32(gridSize) * cellSize;
    pos = clamp(pos, vec3f(margin), vec3f(gridExtent - margin));

    positions[particleIdx] = vec4f(pos, 0.0);
}

// ============================================================================
// G2P FOR FLUID (No deformation gradient)
// ============================================================================

@compute @workgroup_size(256)
fn g2pFluid(@builtin(global_invocation_id) gid: vec3u) {
    let particleIdx = gid.x;
    if (particleIdx >= uniforms.numParticles) { return; }

    var pos = positions[particleIdx].xyz;

    let gridSize = i32(uniforms.gridSize);
    let cellSize = uniforms.cellSize;
    let dt = uniforms.dt;

    let baseCell = vec3i(floor(pos / cellSize));

    var newVel = vec3f(0.0);

    // Gather velocity only (no APIC for simple fluid)
    for (var dz = -1; dz <= 1; dz++) {
        for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
                let gridPos = baseCell + vec3i(dx, dy, dz);

                if (!isValidGridCell(gridPos.x, gridPos.y, gridPos.z, gridSize)) {
                    continue;
                }

                let cellIdx = gridIndex(gridPos.x, gridPos.y, gridPos.z, gridSize);
                let cell = gridVelocity[cellIdx];

                if (cell.mass < 1e-10) { continue; }

                let weight = computeWeight3D(pos, gridPos, cellSize);
                newVel += weight * cell.velocity;
            }
        }
    }

    velocities[particleIdx] = vec4f(newVel, 0.0);

    // Simple advection
    pos += newVel * dt;

    let margin = cellSize * 3.0;
    let gridExtent = f32(gridSize) * cellSize;
    pos = clamp(pos, vec3f(margin), vec3f(gridExtent - margin));

    positions[particleIdx] = vec4f(pos, 0.0);
}
