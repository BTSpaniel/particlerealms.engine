// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MLS-MPM Grid Update Shader
// Converts momentum to velocity, applies forces and boundary conditions
//
// Pipeline position: After P2G, before G2P
//
// Operations:
// 1. Convert fixed-point momentum to f32 velocity
// 2. Apply gravity
// 3. Apply boundary conditions (walls, ground)
// 4. Store velocity for G2P gather

// ============================================================================
// CONSTANTS
// ============================================================================

const FIXED_POINT_SCALE: f32 = 10000.0;
const BOUNDARY_CELLS: i32 = 3; // Cells from edge to apply boundary

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

// Input grid (fixed-point from P2G)
struct GridCellFixed {
    mass: i32,
    momentumX: i32,
    momentumY: i32,
    momentumZ: i32,
}

// Output grid (f32 velocities for G2P)
struct GridCellVelocity {
    velocity: vec3f,
    mass: f32,
}

// ============================================================================
// BINDINGS
// ============================================================================

@group(0) @binding(0) var<storage, read> gridFixed: array<GridCellFixed>;
@group(0) @binding(1) var<storage, read_write> gridVelocity: array<GridCellVelocity>;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

// ============================================================================
// HELPERS
// ============================================================================

fn gridIndex(gx: i32, gy: i32, gz: i32, gridSize: i32) -> u32 {
    return u32(gx + gy * gridSize + gz * gridSize * gridSize);
}

fn indexToCoord(idx: u32, gridSize: u32) -> vec3i {
    let gz = i32(idx / (gridSize * gridSize));
    let rem = idx % (gridSize * gridSize);
    let gy = i32(rem / gridSize);
    let gx = i32(rem % gridSize);
    return vec3i(gx, gy, gz);
}

// ============================================================================
// MAIN GRID UPDATE KERNEL
// ============================================================================

@compute @workgroup_size(256)
fn gridUpdate(@builtin(global_invocation_id) gid: vec3u) {
    let gridSize = u32(uniforms.gridSize);
    let totalCells = gridSize * gridSize * gridSize;
    let cellIdx = gid.x;

    if (cellIdx >= totalCells) { return; }

    let cell = gridFixed[cellIdx];
    let scale = uniforms.fixedPointScale;

    // Convert fixed-point to f32
    let mass = f32(cell.mass) / scale;

    // Skip empty cells
    if (mass < 1e-10) {
        gridVelocity[cellIdx].velocity = vec3f(0.0);
        gridVelocity[cellIdx].mass = 0.0;
        return;
    }

    // Convert momentum to velocity
    var velocity = vec3f(
        f32(cell.momentumX) / scale / mass,
        f32(cell.momentumY) / scale / mass,
        f32(cell.momentumZ) / scale / mass
    );

    // Apply gravity
    velocity += uniforms.gravity * uniforms.dt;

    // Get grid coordinates
    let coord = indexToCoord(cellIdx, gridSize);
    let gridSizeI = i32(gridSize);

    // Boundary conditions
    // Ground (bottom)
    if (coord.y < BOUNDARY_CELLS && velocity.y < 0.0) {
        velocity.y = 0.0;
        // Friction on ground
        velocity.x *= 0.9;
        velocity.z *= 0.9;
    }

    // Ceiling (top)
    if (coord.y > gridSizeI - BOUNDARY_CELLS - 1 && velocity.y > 0.0) {
        velocity.y = 0.0;
    }

    // Walls (X)
    if (coord.x < BOUNDARY_CELLS && velocity.x < 0.0) {
        velocity.x = 0.0;
    }
    if (coord.x > gridSizeI - BOUNDARY_CELLS - 1 && velocity.x > 0.0) {
        velocity.x = 0.0;
    }

    // Walls (Z)
    if (coord.z < BOUNDARY_CELLS && velocity.z < 0.0) {
        velocity.z = 0.0;
    }
    if (coord.z > gridSizeI - BOUNDARY_CELLS - 1 && velocity.z > 0.0) {
        velocity.z = 0.0;
    }

    // Clamp maximum velocity for stability
    let maxVel = 50.0;
    let speed = length(velocity);
    if (speed > maxVel) {
        velocity = velocity * (maxVel / speed);
    }

    // Store result
    gridVelocity[cellIdx].velocity = velocity;
    gridVelocity[cellIdx].mass = mass;
}

// ============================================================================
// ALTERNATIVE: STICKY BOUNDARIES
// ============================================================================

@compute @workgroup_size(256)
fn gridUpdateSticky(@builtin(global_invocation_id) gid: vec3u) {
    let gridSize = u32(uniforms.gridSize);
    let totalCells = gridSize * gridSize * gridSize;
    let cellIdx = gid.x;

    if (cellIdx >= totalCells) { return; }

    let cell = gridFixed[cellIdx];
    let scale = uniforms.fixedPointScale;
    let mass = f32(cell.mass) / scale;

    if (mass < 1e-10) {
        gridVelocity[cellIdx].velocity = vec3f(0.0);
        gridVelocity[cellIdx].mass = 0.0;
        return;
    }

    var velocity = vec3f(
        f32(cell.momentumX) / scale / mass,
        f32(cell.momentumY) / scale / mass,
        f32(cell.momentumZ) / scale / mass
    );

    velocity += uniforms.gravity * uniforms.dt;

    let coord = indexToCoord(cellIdx, gridSize);
    let gridSizeI = i32(gridSize);

    // Sticky: zero all velocity at boundaries
    let nearBoundary = coord.x < BOUNDARY_CELLS ||
                       coord.x > gridSizeI - BOUNDARY_CELLS - 1 ||
                       coord.y < BOUNDARY_CELLS ||
                       coord.y > gridSizeI - BOUNDARY_CELLS - 1 ||
                       coord.z < BOUNDARY_CELLS ||
                       coord.z > gridSizeI - BOUNDARY_CELLS - 1;

    if (nearBoundary) {
        velocity = vec3f(0.0);
    }

    gridVelocity[cellIdx].velocity = velocity;
    gridVelocity[cellIdx].mass = mass;
}

// ============================================================================
// ALTERNATIVE: SEPARATE BOUNDARY WITH FRICTION
// ============================================================================

@compute @workgroup_size(256)
fn gridUpdateFriction(@builtin(global_invocation_id) gid: vec3u) {
    let gridSize = u32(uniforms.gridSize);
    let totalCells = gridSize * gridSize * gridSize;
    let cellIdx = gid.x;

    if (cellIdx >= totalCells) { return; }

    let cell = gridFixed[cellIdx];
    let scale = uniforms.fixedPointScale;
    let mass = f32(cell.mass) / scale;

    if (mass < 1e-10) {
        gridVelocity[cellIdx].velocity = vec3f(0.0);
        gridVelocity[cellIdx].mass = 0.0;
        return;
    }

    var velocity = vec3f(
        f32(cell.momentumX) / scale / mass,
        f32(cell.momentumY) / scale / mass,
        f32(cell.momentumZ) / scale / mass
    );

    velocity += uniforms.gravity * uniforms.dt;

    let coord = indexToCoord(cellIdx, gridSize);
    let gridSizeI = i32(gridSize);
    let friction = 0.5;

    // Ground with Coulomb friction
    if (coord.y < BOUNDARY_CELLS) {
        if (velocity.y < 0.0) {
            // Normal impulse
            let normalImpulse = -velocity.y;
            velocity.y = 0.0;

            // Tangential velocity
            let tangentVel = vec2f(velocity.x, velocity.z);
            let tangentSpeed = length(tangentVel);

            if (tangentSpeed > 0.0) {
                // Friction cone
                let maxFriction = friction * normalImpulse;
                if (tangentSpeed > maxFriction) {
                    let frictionScale = 1.0 - maxFriction / tangentSpeed;
                    velocity.x *= frictionScale;
                    velocity.z *= frictionScale;
                } else {
                    velocity.x = 0.0;
                    velocity.z = 0.0;
                }
            }
        }
    }

    // Simple walls (no friction)
    if (coord.x < BOUNDARY_CELLS && velocity.x < 0.0) { velocity.x = 0.0; }
    if (coord.x > gridSizeI - BOUNDARY_CELLS - 1 && velocity.x > 0.0) { velocity.x = 0.0; }
    if (coord.y > gridSizeI - BOUNDARY_CELLS - 1 && velocity.y > 0.0) { velocity.y = 0.0; }
    if (coord.z < BOUNDARY_CELLS && velocity.z < 0.0) { velocity.z = 0.0; }
    if (coord.z > gridSizeI - BOUNDARY_CELLS - 1 && velocity.z > 0.0) { velocity.z = 0.0; }

    gridVelocity[cellIdx].velocity = velocity;
    gridVelocity[cellIdx].mass = mass;
}
