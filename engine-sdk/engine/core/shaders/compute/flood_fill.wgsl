// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Flood Fill Wave Propagation Shader
// GPU-accelerated connectivity analysis for voxel destruction
//
// Algorithm: Each iteration, solid voxels adopt minimum component ID
// from their 6-connected neighbors. After O(log n) iterations,
// all connected voxels share the same component ID.
//
// Anchored voxels (ground, supports) have ID=1
// Floating voxels have ID>1 after convergence
// Empty voxels have ID=0

// ============================================================================
// BINDINGS
// ============================================================================

struct Uniforms {
    gridSize: vec3u,
    iteration: u32,
}

@group(0) @binding(0) var<storage, read> componentsIn: array<u32>;
@group(0) @binding(1) var<storage, read_write> componentsOut: array<u32>;
@group(0) @binding(2) var<storage, read_write> changeCounter: atomic<u32>;
@group(0) @binding(3) var<uniform> uniforms: Uniforms;

// Optional: Voxel data for solid/empty checks
@group(1) @binding(0) var<storage, read> voxelData: array<u32>;

// ============================================================================
// CONSTANTS
// ============================================================================

// Component IDs
const EMPTY_COMPONENT: u32 = 0u;
const ANCHOR_COMPONENT: u32 = 1u;

// 6-connected neighborhood (face neighbors only)
const NEIGHBOR_OFFSETS_6: array<vec3i, 6> = array<vec3i, 6>(
    vec3i(-1, 0, 0), vec3i(1, 0, 0),
    vec3i(0, -1, 0), vec3i(0, 1, 0),
    vec3i(0, 0, -1), vec3i(0, 0, 1)
);

// 26-connected neighborhood (includes diagonals)
const NEIGHBOR_OFFSETS_26: array<vec3i, 26> = array<vec3i, 26>(
    // Face neighbors (6)
    vec3i(-1, 0, 0), vec3i(1, 0, 0),
    vec3i(0, -1, 0), vec3i(0, 1, 0),
    vec3i(0, 0, -1), vec3i(0, 0, 1),
    // Edge neighbors (12)
    vec3i(-1, -1, 0), vec3i(-1, 1, 0), vec3i(1, -1, 0), vec3i(1, 1, 0),
    vec3i(-1, 0, -1), vec3i(-1, 0, 1), vec3i(1, 0, -1), vec3i(1, 0, 1),
    vec3i(0, -1, -1), vec3i(0, -1, 1), vec3i(0, 1, -1), vec3i(0, 1, 1),
    // Corner neighbors (8)
    vec3i(-1, -1, -1), vec3i(-1, -1, 1), vec3i(-1, 1, -1), vec3i(-1, 1, 1),
    vec3i(1, -1, -1), vec3i(1, -1, 1), vec3i(1, 1, -1), vec3i(1, 1, 1)
);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

fn gridIndex(pos: vec3u) -> u32 {
    let size = uniforms.gridSize;
    return pos.x + pos.y * size.x + pos.z * size.x * size.y;
}

fn isValidPos(pos: vec3i) -> bool {
    let size = vec3i(uniforms.gridSize);
    return pos.x >= 0 && pos.x < size.x &&
           pos.y >= 0 && pos.y < size.y &&
           pos.z >= 0 && pos.z < size.z;
}

fn isSolid(idx: u32) -> bool {
    return componentsIn[idx] != EMPTY_COMPONENT;
}

// ============================================================================
// MAIN PROPAGATION KERNEL (6-connected)
// ============================================================================

@compute @workgroup_size(8, 8, 8)
fn propagate(@builtin(global_invocation_id) gid: vec3u) {
    let size = uniforms.gridSize;

    // Bounds check
    if (gid.x >= size.x || gid.y >= size.y || gid.z >= size.z) {
        return;
    }

    let idx = gridIndex(gid);
    let myComponent = componentsIn[idx];

    // Skip empty voxels - they stay empty
    if (myComponent == EMPTY_COMPONENT) {
        componentsOut[idx] = EMPTY_COMPONENT;
        return;
    }

    // Find minimum component among self and solid neighbors
    var minComponent = myComponent;
    let pos = vec3i(gid);

    for (var i = 0u; i < 6u; i++) {
        let neighborPos = pos + NEIGHBOR_OFFSETS_6[i];

        if (isValidPos(neighborPos)) {
            let neighborIdx = gridIndex(vec3u(neighborPos));
            let neighborComponent = componentsIn[neighborIdx];

            // Only consider solid neighbors
            if (neighborComponent != EMPTY_COMPONENT && neighborComponent < minComponent) {
                minComponent = neighborComponent;
            }
        }
    }

    // Write result
    componentsOut[idx] = minComponent;

    // Track changes for convergence detection
    if (minComponent != myComponent) {
        atomicAdd(&changeCounter, 1u);
    }
}

// ============================================================================
// 26-CONNECTED PROPAGATION (Optional - faster convergence)
// ============================================================================

@compute @workgroup_size(8, 8, 8)
fn propagate26(@builtin(global_invocation_id) gid: vec3u) {
    let size = uniforms.gridSize;

    if (gid.x >= size.x || gid.y >= size.y || gid.z >= size.z) {
        return;
    }

    let idx = gridIndex(gid);
    let myComponent = componentsIn[idx];

    if (myComponent == EMPTY_COMPONENT) {
        componentsOut[idx] = EMPTY_COMPONENT;
        return;
    }

    var minComponent = myComponent;
    let pos = vec3i(gid);

    // Check all 26 neighbors
    for (var i = 0u; i < 26u; i++) {
        let neighborPos = pos + NEIGHBOR_OFFSETS_26[i];

        if (isValidPos(neighborPos)) {
            let neighborIdx = gridIndex(vec3u(neighborPos));
            let neighborComponent = componentsIn[neighborIdx];

            if (neighborComponent != EMPTY_COMPONENT && neighborComponent < minComponent) {
                minComponent = neighborComponent;
            }
        }
    }

    componentsOut[idx] = minComponent;

    if (minComponent != myComponent) {
        atomicAdd(&changeCounter, 1u);
    }
}

// ============================================================================
// INITIALIZATION KERNEL
// ============================================================================

@compute @workgroup_size(8, 8, 8)
fn initialize(@builtin(global_invocation_id) gid: vec3u) {
    let size = uniforms.gridSize;

    if (gid.x >= size.x || gid.y >= size.y || gid.z >= size.z) {
        return;
    }

    let idx = gridIndex(gid);
    let voxel = voxelData[idx];

    if (voxel == 0u) {
        // Empty voxel
        componentsOut[idx] = EMPTY_COMPONENT;
    } else if (gid.y == 0u) {
        // Bottom layer = anchored (simple anchor rule)
        componentsOut[idx] = ANCHOR_COMPONENT;
    } else {
        // Solid voxel - assign unique ID based on position
        // Using Morton code for better spatial locality
        componentsOut[idx] = idx + 2u; // +2 to skip EMPTY and ANCHOR
    }
}

// ============================================================================
// MARK ANCHORS KERNEL
// ============================================================================

// Separate anchor marking (call after initialize)
@compute @workgroup_size(8, 8, 8)
fn markAnchors(
    @builtin(global_invocation_id) gid: vec3u
) {
    let size = uniforms.gridSize;

    if (gid.x >= size.x || gid.y >= size.y || gid.z >= size.z) {
        return;
    }

    let idx = gridIndex(gid);

    // Check if this voxel touches the bottom (Y=0)
    if (gid.y == 0u && componentsOut[idx] != EMPTY_COMPONENT) {
        componentsOut[idx] = ANCHOR_COMPONENT;
    }
}

// ============================================================================
// EXTRACT FLOATING KERNEL
// ============================================================================

// After propagation converges, mark floating components
@compute @workgroup_size(256)
fn extractFloating(
    @builtin(global_invocation_id) gid: vec3u
) {
    let totalCells = uniforms.gridSize.x * uniforms.gridSize.y * uniforms.gridSize.z;
    let idx = gid.x;

    if (idx >= totalCells) {
        return;
    }

    let component = componentsIn[idx];

    // Floating = solid but not connected to anchor
    if (component != EMPTY_COMPONENT && component != ANCHOR_COMPONENT) {
        // This voxel is floating - could write to a separate buffer
        // for later processing (physics, debris spawning, etc.)
        atomicAdd(&changeCounter, 1u);
    }
}

// ============================================================================
// OPTIMIZED: SHARED MEMORY VERSION
// ============================================================================

var<workgroup> sharedComponents: array<u32, 512>; // 8×8×8

@compute @workgroup_size(8, 8, 8)
fn propagateShared(
    @builtin(global_invocation_id) gid: vec3u,
    @builtin(local_invocation_id) lid: vec3u,
    @builtin(local_invocation_index) lidx: u32
) {
    let size = uniforms.gridSize;

    // Load into shared memory
    if (gid.x < size.x && gid.y < size.y && gid.z < size.z) {
        let idx = gridIndex(gid);
        sharedComponents[lidx] = componentsIn[idx];
    } else {
        sharedComponents[lidx] = EMPTY_COMPONENT;
    }

    workgroupBarrier();

    // Bounds check for output
    if (gid.x >= size.x || gid.y >= size.y || gid.z >= size.z) {
        return;
    }

    let myComponent = sharedComponents[lidx];

    if (myComponent == EMPTY_COMPONENT) {
        let idx = gridIndex(gid);
        componentsOut[idx] = EMPTY_COMPONENT;
        return;
    }

    var minComponent = myComponent;

    // Check neighbors (mix of shared and global memory)
    for (var i = 0u; i < 6u; i++) {
        let offset = NEIGHBOR_OFFSETS_6[i];
        let neighborLid = vec3i(lid) + offset;

        // Check if neighbor is in shared memory
        if (neighborLid.x >= 0 && neighborLid.x < 8 &&
            neighborLid.y >= 0 && neighborLid.y < 8 &&
            neighborLid.z >= 0 && neighborLid.z < 8) {
            // Read from shared memory
            let sharedIdx = u32(neighborLid.x) + u32(neighborLid.y) * 8u + u32(neighborLid.z) * 64u;
            let neighborComponent = sharedComponents[sharedIdx];
            if (neighborComponent != EMPTY_COMPONENT && neighborComponent < minComponent) {
                minComponent = neighborComponent;
            }
        } else {
            // Read from global memory (boundary)
            let neighborPos = vec3i(gid) + offset;
            if (isValidPos(neighborPos)) {
                let neighborIdx = gridIndex(vec3u(neighborPos));
                let neighborComponent = componentsIn[neighborIdx];
                if (neighborComponent != EMPTY_COMPONENT && neighborComponent < minComponent) {
                    minComponent = neighborComponent;
                }
            }
        }
    }

    let idx = gridIndex(gid);
    componentsOut[idx] = minComponent;

    if (minComponent != myComponent) {
        atomicAdd(&changeCounter, 1u);
    }
}
