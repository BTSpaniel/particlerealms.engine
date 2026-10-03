// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Indirect Dispatch Generator
// Stream compaction + indirect args generation.

struct Uniforms {
    gridDims: vec3u,
    flagMask: u32,
    workgroupsPerJob: u32,
    maxJobs: u32,
    pad0: u32,
    pad1: u32,
}

struct Job {
    chunkX: i32,
    chunkY: i32,
    chunkZ: i32,
    flags: u32,
}

@group(0) @binding(0) var<storage, read> chunkFlags: array<u32>;
@group(0) @binding(1) var<storage, read_write> jobList: array<Job>;
@group(0) @binding(2) var<storage, read_write> indirectArgs: array<u32>;
@group(0) @binding(3) var<storage, read_write> counter: atomic<u32>;
@group(0) @binding(4) var<uniform> uniforms: Uniforms;

var<workgroup> localCounter: atomic<u32>;
var<workgroup> globalOffset: u32;

fn chunkIndexToCoords(idx: u32) -> vec3u {
    let dims = uniforms.gridDims;
    let xy = dims.x * dims.y;
    let z = idx / xy;
    let rem = idx % xy;
    let y = rem / dims.x;
    let x = rem % dims.x;
    return vec3u(x, y, z);
}

@compute @workgroup_size(1)
fn clearCounter() {
    atomicStore(&counter, 0u);
    indirectArgs[0] = 0u;
    indirectArgs[1] = 1u;
    indirectArgs[2] = 1u;
}

@compute @workgroup_size(64)
fn compactJobs(
    @builtin(global_invocation_id) gid: vec3u,
    @builtin(local_invocation_index) lid: u32
) {
    let totalChunks = uniforms.gridDims.x * uniforms.gridDims.y * uniforms.gridDims.z;
    let chunkIdx = gid.x;

    if (lid == 0u) {
        atomicStore(&localCounter, 0u);
    }
    workgroupBarrier();

    var isActive = false;
    var flags: u32 = 0u;

    if (chunkIdx < totalChunks) {
        flags = chunkFlags[chunkIdx];
        isActive = (flags & uniforms.flagMask) != 0u;
    }

    var localSlot: u32 = 0u;
    if (isActive) {
        localSlot = atomicAdd(&localCounter, 1u);
    }
    workgroupBarrier();

    if (lid == 0u) {
        let localCount = atomicLoad(&localCounter);
        if (localCount > 0u) {
            globalOffset = atomicAdd(&counter, localCount);
        } else {
            globalOffset = 0u;
        }
    }
    workgroupBarrier();

    if (isActive) {
        let globalSlot = globalOffset + localSlot;

        if (globalSlot < uniforms.maxJobs) {
            let coords = chunkIndexToCoords(chunkIdx);
            jobList[globalSlot].chunkX = i32(coords.x);
            jobList[globalSlot].chunkY = i32(coords.y);
            jobList[globalSlot].chunkZ = i32(coords.z);
            jobList[globalSlot].flags = flags;
        }
    }
}

@compute @workgroup_size(1)
fn finalizeIndirect() {
    let jobCount = min(atomicLoad(&counter), uniforms.maxJobs);
    let totalWorkgroups = jobCount * uniforms.workgroupsPerJob;

    indirectArgs[0] = totalWorkgroups;
    indirectArgs[1] = 1u;
    indirectArgs[2] = 1u;
}
