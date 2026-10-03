// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const tlasRefitWGSL = /* wgsl */`
struct InstanceData {
    worldMat: mat4x4<f32>,
    assetId: u32,
    mode: u32,
    halfExtentsX: f32,
    halfExtentsY: f32,
    halfExtentsZ: f32,
    padding0: u32,
    padding1: u32,
    padding2: u32,
}

struct TLASNode {
    min: vec3<f32>,
    max: vec3<f32>,
    left: u32,
    right: u32,
    instanceId: u32,
    assetId: u32,
}

@group(0) @binding(0) var<storage,read> instances: array<InstanceData>;
@group(0) @binding(1) var<storage,read_write> tlasNodes: array<TLASNode>;
@group(0) @binding(2) var<storage,read> assetHalfExtents: array<vec3<f32>>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let idx = global_id.x;
    if (idx >= arrayLength(&instances)) {
        return;
    }
    
    let inst = instances[idx];
    let halfExtents = assetHalfExtents[inst.assetId];
    
    var worldMin = vec3<f32>(1e10, 1e10, 1e10);
    var worldMax = vec3<f32>(-1e10, -1e10, -1e10);
    
    let corners = array<vec3<f32>, 8>(
        vec3<f32>(-halfExtents.x, -halfExtents.y, -halfExtents.z),
        vec3<f32>( halfExtents.x, -halfExtents.y, -halfExtents.z),
        vec3<f32>(-halfExtents.x,  halfExtents.y, -halfExtents.z),
        vec3<f32>( halfExtents.x,  halfExtents.y, -halfExtents.z),
        vec3<f32>(-halfExtents.x, -halfExtents.y,  halfExtents.z),
        vec3<f32>( halfExtents.x, -halfExtents.y,  halfExtents.z),
        vec3<f32>(-halfExtents.x,  halfExtents.y,  halfExtents.z),
        vec3<f32>( halfExtents.x,  halfExtents.y,  halfExtents.z),
    );
    
    for (var i = 0; i < 8; i++) {
        let worldPos = (inst.worldMat * vec4<f32>(corners[i], 1.0)).xyz;
        worldMin = min(worldMin, worldPos);
        worldMax = max(worldMax, worldPos);
    }
    
    let nodeIdx = idx;
    if (nodeIdx < arrayLength(&tlasNodes)) {
        tlasNodes[nodeIdx].min = worldMin;
        tlasNodes[nodeIdx].max = worldMax;
    }
}
`;

export default tlasRefitWGSL;
