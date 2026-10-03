// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * FaceListMesher.js - Ultra-Compressed GPU Voxel Meshing
 * 
 * MASSIVE COMPRESSION: 4 bytes per FACE (not per vertex!)
 * 
 * Memory comparison per face:
 *   Old: 4 verts × 4 bytes + 6 indices × 2 bytes = 28 bytes/face
 *   New: 1 u32 per face = 4 bytes/face = 7× SMALLER!
 * 
 * Technique: Vertex Pulling
 *   - No vertex buffer, no index buffer
 *   - Single storage buffer of packed face records
 *   - Vertex shader synthesizes 6 triangle vertices per face using vertex_index
 *   - draw(faceCount * 6) instead of drawIndexed
 * 
 * Face record format (1 u32):
 *   bits 0-4:   posX (0-31)
 *   bits 5-9:   posY (0-31)
 *   bits 10-14: posZ (0-31)
 *   bits 15-17: faceDir (0-5: +X,-X,+Y,-Y,+Z,-Z)
 *   bits 18-22: material (0-31)
 *   bits 23-24: ao0 (corner 0)
 *   bits 25-26: ao1 (corner 1)
 *   bits 27-28: ao2 (corner 2)
 *   bits 29-30: ao3 (corner 3)
 *   bit 31:     unused
 */

const CHUNK_SIZE = 32;
const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;

// ============================================================================
// FACE COUNT SHADER - Same as before but atomically counts faces for allocation
// ============================================================================
const FACE_COUNT_SHADER = /* wgsl */ `
const CHUNK_SIZE: u32 = 32u;
const CHUNK_SIZE_SQ: u32 = 1024u;
const CHUNK_VOLUME: u32 = 32768u;
const MATERIAL_AIR: u32 = 0u;
const TILE_SIZE: u32 = 2u;
const WG_SIZE: u32 = 4u;
const WG_VOXELS: u32 = 8u;

struct Params {
    chunkOriginX: f32,
    chunkOriginY: f32,
    chunkOriginZ: f32,
    _pad: f32,
}

struct FaceCounter {
    opaqueCount: atomic<u32>,
    waterCount: atomic<u32>,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> voxels: array<u32>;
@group(0) @binding(2) var<storage, read_write> faceCounts: array<u32>;
@group(0) @binding(3) var<storage, read_write> faceCounter: FaceCounter;

var<workgroup> sharedVoxels: array<u32, 1000>;

fn localToIndex(lx: u32, ly: u32, lz: u32) -> u32 {
    return lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE_SQ;
}

fn sharedIndex(sx: u32, sy: u32, sz: u32) -> u32 {
    return sx + sy * 10u + sz * 100u;
}

fn getSharedVoxel(sx: i32, sy: i32, sz: i32) -> u32 {
    let cx = clamp(sx, 0, 9);
    let cy = clamp(sy, 0, 9);
    let cz = clamp(sz, 0, 9);
    return sharedVoxels[sharedIndex(u32(cx), u32(cy), u32(cz))];
}

fn isWater(mat: u32) -> bool { return mat == 5u; }

fn shouldShowFace(material: u32, neighborMat: u32) -> bool {
    if (neighborMat == MATERIAL_AIR) { return true; }
    let isT = isWater(material);
    let neighborT = isWater(neighborMat);
    if (!isT && neighborT) { return true; }
    if (isT && !neighborT) { return true; }
    return false;
}

fn countFaces(sx: i32, sy: i32, sz: i32, material: u32) -> u32 {
    if (material == MATERIAL_AIR) { return 0u; }
    var count = 0u;
    count += select(0u, 1u, shouldShowFace(material, getSharedVoxel(sx + 1, sy, sz)));
    count += select(0u, 1u, shouldShowFace(material, getSharedVoxel(sx - 1, sy, sz)));
    count += select(0u, 1u, shouldShowFace(material, getSharedVoxel(sx, sy + 1, sz)));
    count += select(0u, 1u, shouldShowFace(material, getSharedVoxel(sx, sy - 1, sz)));
    count += select(0u, 1u, shouldShowFace(material, getSharedVoxel(sx, sy, sz + 1)));
    count += select(0u, 1u, shouldShowFace(material, getSharedVoxel(sx, sy, sz - 1)));
    return count;
}

@compute @workgroup_size(4, 4, 4)
fn main(
    @builtin(global_invocation_id) gid: vec3<u32>,
    @builtin(local_invocation_id) lid: vec3<u32>,
    @builtin(workgroup_id) wid: vec3<u32>
) {
    let wgBase = wid * WG_VOXELS;
    let loadBase = vec3<i32>(wgBase) - vec3<i32>(1, 1, 1);
    
    let linearLid = lid.x + lid.y * WG_SIZE + lid.z * WG_SIZE * WG_SIZE;
    for (var i = linearLid; i < 1000u; i += 64u) {
        let sz = i / 100u;
        let sy = (i % 100u) / 10u;
        let sx = i % 10u;
        let gx = loadBase.x + i32(sx);
        let gy = loadBase.y + i32(sy);
        let gz = loadBase.z + i32(sz);
        var voxel = MATERIAL_AIR;
        if (gx >= 0 && gx < i32(CHUNK_SIZE) && gy >= 0 && gy < i32(CHUNK_SIZE) && gz >= 0 && gz < i32(CHUNK_SIZE)) {
            voxel = voxels[localToIndex(u32(gx), u32(gy), u32(gz))] & 0xFFu;
        }
        sharedVoxels[i] = voxel;
    }
    workgroupBarrier();
    
    let tileBase = lid * TILE_SIZE;
    var opaqueCount = 0u;
    var waterCount = 0u;
    
    for (var tz = 0u; tz < TILE_SIZE; tz++) {
        for (var ty = 0u; ty < TILE_SIZE; ty++) {
            for (var tx = 0u; tx < TILE_SIZE; tx++) {
                let gx = wgBase.x + tileBase.x + tx;
                let gy = wgBase.y + tileBase.y + ty;
                let gz = wgBase.z + tileBase.z + tz;
                if (gx < CHUNK_SIZE && gy < CHUNK_SIZE && gz < CHUNK_SIZE) {
                    let sx = i32(tileBase.x + tx) + 1;
                    let sy = i32(tileBase.y + ty) + 1;
                    let sz = i32(tileBase.z + tz) + 1;
                    let mat = getSharedVoxel(sx, sy, sz);
                    let count = countFaces(sx, sy, sz, mat);
                    faceCounts[localToIndex(gx, gy, gz)] = count;
                    if (isWater(mat)) {
                        waterCount += count;
                    } else {
                        opaqueCount += count;
                    }
                }
            }
        }
    }
    
    if (opaqueCount > 0u) { atomicAdd(&faceCounter.opaqueCount, opaqueCount); }
    if (waterCount > 0u) { atomicAdd(&faceCounter.waterCount, waterCount); }
}
`;

// ============================================================================
// PREFIX SUM SHADER - Compute face offsets
// ============================================================================
const PREFIX_SUM_SHADER = /* wgsl */ `
const CHUNK_VOLUME: u32 = 32768u;

struct Params {
    step: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> data: array<u32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= CHUNK_VOLUME) { return; }
    let step = params.step;
    if (idx >= step) {
        data[idx] = data[idx] + data[idx - step];
    }
}
`;

// ============================================================================
// FACE GENERATION SHADER - Write 1 u32 per face (ULTRA COMPRESSED!)
// ============================================================================
const GENERATE_FACES_SHADER = /* wgsl */ `
const CHUNK_SIZE: u32 = 32u;
const CHUNK_SIZE_SQ: u32 = 1024u;
const CHUNK_VOLUME: u32 = 32768u;
const MATERIAL_AIR: u32 = 0u;
const TILE_SIZE: u32 = 2u;
const WG_SIZE: u32 = 4u;
const WG_VOXELS: u32 = 8u;

struct Params {
    chunkOriginX: f32,
    chunkOriginY: f32,
    chunkOriginZ: f32,
    _pad: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> voxels: array<u32>;
@group(0) @binding(2) var<storage, read> faceOffsets: array<u32>;
@group(0) @binding(3) var<storage, read_write> opaqueFaces: array<u32>;
@group(0) @binding(4) var<storage, read_write> waterFaces: array<u32>;
@group(0) @binding(5) var<storage, read_write> counters: array<atomic<u32>>;

var<workgroup> sharedVoxels: array<u32, 1000>;

fn localToIndex(lx: u32, ly: u32, lz: u32) -> u32 {
    return lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE_SQ;
}

fn sharedIndex(sx: u32, sy: u32, sz: u32) -> u32 {
    return sx + sy * 10u + sz * 100u;
}

fn getSharedVoxel(sx: i32, sy: i32, sz: i32) -> u32 {
    let cx = clamp(sx, 0, 9);
    let cy = clamp(sy, 0, 9);
    let cz = clamp(sz, 0, 9);
    return sharedVoxels[sharedIndex(u32(cx), u32(cy), u32(cz))];
}

fn isWater(mat: u32) -> bool { return mat == 5u; }

fn shouldShowFace(material: u32, neighborMat: u32) -> bool {
    if (neighborMat == MATERIAL_AIR) { return true; }
    let isT = isWater(material);
    let neighborT = isWater(neighborMat);
    if (!isT && neighborT) { return true; }
    if (isT && !neighborT) { return true; }
    return false;
}

fn packFace(posX: u32, posY: u32, posZ: u32, faceDir: u32, material: u32, ao0: u32, ao1: u32, ao2: u32, ao3: u32) -> u32 {
    return (posX & 0x1Fu) |
           ((posY & 0x1Fu) << 5u) |
           ((posZ & 0x1Fu) << 10u) |
           ((faceDir & 0x7u) << 15u) |
           ((material & 0x1Fu) << 18u) |
           ((ao0 & 0x3u) << 23u) |
           ((ao1 & 0x3u) << 25u) |
           ((ao2 & 0x3u) << 27u) |
           ((ao3 & 0x3u) << 29u);
}

fn generateVoxelFaces(gx: u32, gy: u32, gz: u32, sx: i32, sy: i32, sz: i32, material: u32) {
    if (material == MATERIAL_AIR) { return; }
    
    let isW = isWater(material);
    
    // +X face (faceDir = 0)
    if (shouldShowFace(material, getSharedVoxel(sx + 1, sy, sz))) {
        let packed = packFace(gx, gy, gz, 0u, material, 0u, 0u, 0u, 0u);
        if (isW) {
            let idx = atomicAdd(&counters[1], 1u);
            waterFaces[idx] = packed;
        } else {
            let idx = atomicAdd(&counters[0], 1u);
            opaqueFaces[idx] = packed;
        }
    }
    
    // -X face (faceDir = 1)
    if (shouldShowFace(material, getSharedVoxel(sx - 1, sy, sz))) {
        let packed = packFace(gx, gy, gz, 1u, material, 0u, 0u, 0u, 0u);
        if (isW) {
            let idx = atomicAdd(&counters[1], 1u);
            waterFaces[idx] = packed;
        } else {
            let idx = atomicAdd(&counters[0], 1u);
            opaqueFaces[idx] = packed;
        }
    }
    
    // +Y face (faceDir = 2)
    if (shouldShowFace(material, getSharedVoxel(sx, sy + 1, sz))) {
        let packed = packFace(gx, gy, gz, 2u, material, 0u, 0u, 0u, 0u);
        if (isW) {
            let idx = atomicAdd(&counters[1], 1u);
            waterFaces[idx] = packed;
        } else {
            let idx = atomicAdd(&counters[0], 1u);
            opaqueFaces[idx] = packed;
        }
    }
    
    // -Y face (faceDir = 3)
    if (shouldShowFace(material, getSharedVoxel(sx, sy - 1, sz))) {
        let packed = packFace(gx, gy, gz, 3u, material, 0u, 0u, 0u, 0u);
        if (isW) {
            let idx = atomicAdd(&counters[1], 1u);
            waterFaces[idx] = packed;
        } else {
            let idx = atomicAdd(&counters[0], 1u);
            opaqueFaces[idx] = packed;
        }
    }
    
    // +Z face (faceDir = 4)
    if (shouldShowFace(material, getSharedVoxel(sx, sy, sz + 1))) {
        let packed = packFace(gx, gy, gz, 4u, material, 0u, 0u, 0u, 0u);
        if (isW) {
            let idx = atomicAdd(&counters[1], 1u);
            waterFaces[idx] = packed;
        } else {
            let idx = atomicAdd(&counters[0], 1u);
            opaqueFaces[idx] = packed;
        }
    }
    
    // -Z face (faceDir = 5)
    if (shouldShowFace(material, getSharedVoxel(sx, sy, sz - 1))) {
        let packed = packFace(gx, gy, gz, 5u, material, 0u, 0u, 0u, 0u);
        if (isW) {
            let idx = atomicAdd(&counters[1], 1u);
            waterFaces[idx] = packed;
        } else {
            let idx = atomicAdd(&counters[0], 1u);
            opaqueFaces[idx] = packed;
        }
    }
}

@compute @workgroup_size(4, 4, 4)
fn main(
    @builtin(global_invocation_id) gid: vec3<u32>,
    @builtin(local_invocation_id) lid: vec3<u32>,
    @builtin(workgroup_id) wid: vec3<u32>
) {
    let wgBase = wid * WG_VOXELS;
    let loadBase = vec3<i32>(wgBase) - vec3<i32>(1, 1, 1);
    
    let linearLid = lid.x + lid.y * WG_SIZE + lid.z * WG_SIZE * WG_SIZE;
    for (var i = linearLid; i < 1000u; i += 64u) {
        let sz = i / 100u;
        let sy = (i % 100u) / 10u;
        let sx = i % 10u;
        let gx = loadBase.x + i32(sx);
        let gy = loadBase.y + i32(sy);
        let gz = loadBase.z + i32(sz);
        var voxel = MATERIAL_AIR;
        if (gx >= 0 && gx < i32(CHUNK_SIZE) && gy >= 0 && gy < i32(CHUNK_SIZE) && gz >= 0 && gz < i32(CHUNK_SIZE)) {
            voxel = voxels[localToIndex(u32(gx), u32(gy), u32(gz))] & 0xFFu;
        }
        sharedVoxels[i] = voxel;
    }
    workgroupBarrier();
    
    let tileBase = lid * TILE_SIZE;
    for (var tz = 0u; tz < TILE_SIZE; tz++) {
        for (var ty = 0u; ty < TILE_SIZE; ty++) {
            for (var tx = 0u; tx < TILE_SIZE; tx++) {
                let gx = wgBase.x + tileBase.x + tx;
                let gy = wgBase.y + tileBase.y + ty;
                let gz = wgBase.z + tileBase.z + tz;
                if (gx < CHUNK_SIZE && gy < CHUNK_SIZE && gz < CHUNK_SIZE) {
                    let sx = i32(tileBase.x + tx) + 1;
                    let sy = i32(tileBase.y + ty) + 1;
                    let sz = i32(tileBase.z + tz) + 1;
                    let mat = getSharedVoxel(sx, sy, sz);
                    generateVoxelFaces(gx, gy, gz, sx, sy, sz, mat);
                }
            }
        }
    }
}
`;

// ============================================================================
// VERTEX PULLING SHADER BASE - Constants and functions (NO BINDINGS!)
// Bindings are added by VoxelRenderer.js to match its layout
// ============================================================================
export const FACE_PULL_SHADER_BASE = /* wgsl */ `
const MATERIAL_COLORS: array<vec4<f32>, 25> = array<vec4<f32>, 25>(
    vec4<f32>(0.0, 0.0, 0.0, 0.0),
    vec4<f32>(0.502, 0.502, 0.549, 1.0),
    vec4<f32>(0.545, 0.353, 0.169, 1.0),
    vec4<f32>(0.337, 0.596, 0.231, 1.0),
    vec4<f32>(0.929, 0.788, 0.686, 1.0),
    vec4<f32>(0.118, 0.471, 0.784, 0.706),
    vec4<f32>(0.627, 0.471, 0.314, 1.0),
    vec4<f32>(0.176, 0.353, 0.176, 1.0),
    vec4<f32>(0.961, 0.961, 1.0, 1.0),
    vec4<f32>(0.627, 0.831, 0.91, 1.0),
    vec4<f32>(1.0, 0.314, 0.078, 1.0),
    vec4<f32>(0.235, 0.549, 0.235, 1.0),
    vec4<f32>(0.275, 0.275, 0.333, 1.0),
    vec4<f32>(0.118, 0.098, 0.157, 1.0),
    vec4<f32>(1.0, 0.392, 0.118, 1.0),
    vec4<f32>(0.706, 0.471, 1.0, 1.0),
    vec4<f32>(0.059, 0.039, 0.098, 1.0),
    vec4<f32>(0.549, 0.353, 0.706, 1.0),
    vec4<f32>(0.392, 0.275, 0.471, 1.0),
    vec4<f32>(0.784, 0.784, 0.863, 1.0),
    vec4<f32>(0.157, 0.137, 0.118, 1.0),
    vec4<f32>(0.471, 1.0, 0.314, 1.0),
    vec4<f32>(0.392, 0.373, 0.353, 1.0),
    vec4<f32>(0.706, 0.706, 0.765, 1.0),
    vec4<f32>(0.914, 0.271, 0.376, 1.0),
);

const FACE_NORMALS: array<vec3<f32>, 6> = array<vec3<f32>, 6>(
    vec3<f32>(1.0, 0.0, 0.0),
    vec3<f32>(-1.0, 0.0, 0.0),
    vec3<f32>(0.0, 1.0, 0.0),
    vec3<f32>(0.0, -1.0, 0.0),
    vec3<f32>(0.0, 0.0, 1.0),
    vec3<f32>(0.0, 0.0, -1.0),
);

const AO_VALUES: array<f32, 4> = array<f32, 4>(1.0, 0.75, 0.5, 0.25);

// Quad vertex offsets for each face direction
// Order: 0,1,2, 0,2,3 (two triangles)
const QUAD_OFFSETS: array<array<vec3<f32>, 4>, 6> = array<array<vec3<f32>, 4>, 6>(
    // +X
    array<vec3<f32>, 4>(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(1.0, 1.0, 0.0), vec3<f32>(1.0, 1.0, 1.0), vec3<f32>(1.0, 0.0, 1.0)),
    // -X
    array<vec3<f32>, 4>(vec3<f32>(0.0, 0.0, 1.0), vec3<f32>(0.0, 1.0, 1.0), vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(0.0, 0.0, 0.0)),
    // +Y
    array<vec3<f32>, 4>(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(0.0, 1.0, 1.0), vec3<f32>(1.0, 1.0, 1.0), vec3<f32>(1.0, 1.0, 0.0)),
    // -Y
    array<vec3<f32>, 4>(vec3<f32>(0.0, 0.0, 1.0), vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(1.0, 0.0, 1.0)),
    // +Z
    array<vec3<f32>, 4>(vec3<f32>(1.0, 0.0, 1.0), vec3<f32>(1.0, 1.0, 1.0), vec3<f32>(0.0, 1.0, 1.0), vec3<f32>(0.0, 0.0, 1.0)),
    // -Z
    array<vec3<f32>, 4>(vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0)),
);

// Triangle indices: 0,1,2, 0,2,3
const TRI_INDICES: array<u32, 6> = array<u32, 6>(0u, 1u, 2u, 0u, 2u, 3u);

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) ao: f32,
    @location(3) worldPos: vec3<f32>,
    @location(4) uv: vec2<f32>,
    @location(5) @interpolate(flat) materialIdx: u32,
    @location(6) @interpolate(flat) faceDir: u32,
}

struct ChunkUniforms {
    chunkOrigin: vec3<f32>,
    _pad0: f32,
}

// NOTE: Bindings are NOT declared here - they are added by VoxelRenderer.js
// to match the specific pipeline layout being used

// unpackFaceData extracts face data without setting position (caller provides viewProj)
fn unpackFaceData(packed: u32, vertexInFace: u32, chunkOrigin: vec3<f32>) -> VertexOutput {
    let posX = f32(packed & 0x1Fu);
    let posY = f32((packed >> 5u) & 0x1Fu);
    let posZ = f32((packed >> 10u) & 0x1Fu);
    let faceDir = (packed >> 15u) & 0x7u;
    let materialIdx = (packed >> 18u) & 0x1Fu;
    
    let aoCorner = select(
        select(select((packed >> 29u) & 0x3u, (packed >> 27u) & 0x3u, vertexInFace == 2u),
               (packed >> 25u) & 0x3u, vertexInFace == 1u),
        (packed >> 23u) & 0x3u, vertexInFace == 0u);
    
    let quadVert = TRI_INDICES[vertexInFace];
    let offset = QUAD_OFFSETS[faceDir][quadVert];
    let worldPos = chunkOrigin + vec3<f32>(posX, posY, posZ) + offset;

    let baseUv = array<vec2<f32>, 4>(
        vec2<f32>(0.0, 0.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(1.0, 0.0)
    );
    var uv = baseUv[quadVert];
    if (faceDir == 1u || faceDir == 5u) {
        uv.x = 1.0 - uv.x;
    }
    if (faceDir == 3u) {
        uv.y = 1.0 - uv.y;
    }
    
    var out: VertexOutput;
    out.position = vec4<f32>(0.0); // Set by caller with proper viewProj
    out.color = MATERIAL_COLORS[min(materialIdx, 24u)];
    out.normal = FACE_NORMALS[faceDir];
    out.ao = AO_VALUES[aoCorner];
    out.worldPos = worldPos;
    out.uv = uv;
    out.materialIdx = materialIdx;
    out.faceDir = faceDir;
    return out;
}
`;

// ============================================================================
// GPU BUFFER POOL - Recycle buffers to avoid allocation overhead
// ============================================================================
export class GPUBufferPool {
    constructor() {
        this.device = null;
        this.pools = new Map();  // size -> [buffer, ...]
        this.stats = {
            allocations: 0,
            reuses: 0,
            totalBytes: 0,
        };
    }
    
    init(device) {
        this.device = device;
    }
    
    acquire(size, usage, label = 'Pooled Buffer') {
        const key = `${size}_${usage}`;
        const pool = this.pools.get(key);
        
        if (pool && pool.length > 0) {
            this.stats.reuses++;
            return pool.pop();
        }
        
        this.stats.allocations++;
        this.stats.totalBytes += size;
        
        return this.device.createBuffer({
            label,
            size,
            usage,
        });
    }
    
    release(buffer) {
        if (!buffer) return;
        const key = `${buffer.size}_${buffer.usage}`;
        let pool = this.pools.get(key);
        if (!pool) {
            pool = [];
            this.pools.set(key, pool);
        }
        if (pool.length < 64) {
            pool.push(buffer);
        } else {
            buffer.destroy();
        }
    }
    
    destroy() {
        for (const pool of this.pools.values()) {
            for (const buffer of pool) {
                buffer.destroy();
            }
        }
        this.pools.clear();
    }
}

// ============================================================================
// FACE LIST MESHER CLASS
// ============================================================================
export class FaceListMesher {
    constructor() {
        this.device = null;
        this.bufferPool = new GPUBufferPool();
        
        this.faceCountPipeline = null;
        this.prefixSumPipeline = null;
        this.generateFacesPipeline = null;
        
        this.faceCountLayout = null;
        this.prefixSumLayout = null;
        this.generateFacesLayout = null;
        
        this.paramsBuffer = null;
        this.voxelBuffer = null;
        this.faceCountsBuffer = null;
        this.faceCounterBuffer = null;
        this.countersBuffer = null;
        this.prefixSumParamsBuffer = null;
        
        this.readbackBuffer = null;
        
        this.initialized = false;
        this.meshingInProgress = false;
        this.meshQueue = [];
        this.processingQueue = false;
        
        this.stats = {
            meshCount: 0,
            totalFaces: 0,
            passCount: 0,
            totalPasses: 0,
            bytesAllocated: 0,
        };
        
        // Pre-allocated typed arrays to avoid per-mesh allocations
        this._voxelData = new Uint32Array(32768);  // CHUNK_VOLUME
        this._paramsData = new Float32Array(4);
        this._faceCounterReset = new Uint32Array([0, 0]);
        this._countersReset = new Uint32Array([0, 0]);
        this._prefixSumParams = new Uint32Array(4);
        
        this.metricsCallback = null;
    }
    
    setMetricsCallback(callback) {
        this.metricsCallback = callback;
    }
    
    resetFrameStats() {
        this.stats.passCount = 0;
    }
    
    async init(device) {
        this.device = device;
        this.bufferPool.init(device);
        
        const faceCountModule = device.createShaderModule({
            label: 'Face Count Shader',
            code: FACE_COUNT_SHADER,
        });
        
        const prefixSumModule = device.createShaderModule({
            label: 'Prefix Sum Shader',
            code: PREFIX_SUM_SHADER,
        });
        
        const generateFacesModule = device.createShaderModule({
            label: 'Generate Faces Shader',
            code: GENERATE_FACES_SHADER,
        });
        
        this.faceCountLayout = device.createBindGroupLayout({
            label: 'Face Count Layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });
        
        this.prefixSumLayout = device.createBindGroupLayout({
            label: 'Prefix Sum Layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });
        
        this.generateFacesLayout = device.createBindGroupLayout({
            label: 'Generate Faces Layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });
        
        this.faceCountPipeline = device.createComputePipeline({
            label: 'Face Count Pipeline',
            layout: device.createPipelineLayout({ bindGroupLayouts: [this.faceCountLayout] }),
            compute: { module: faceCountModule, entryPoint: 'main' },
        });
        
        this.prefixSumPipeline = device.createComputePipeline({
            label: 'Prefix Sum Pipeline',
            layout: device.createPipelineLayout({ bindGroupLayouts: [this.prefixSumLayout] }),
            compute: { module: prefixSumModule, entryPoint: 'main' },
        });
        
        this.generateFacesPipeline = device.createComputePipeline({
            label: 'Generate Faces Pipeline',
            layout: device.createPipelineLayout({ bindGroupLayouts: [this.generateFacesLayout] }),
            compute: { module: generateFacesModule, entryPoint: 'main' },
        });
        
        this.paramsBuffer = device.createBuffer({
            label: 'Mesh Params',
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        this.prefixSumParamsBuffer = device.createBuffer({
            label: 'Prefix Sum Params',
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        this.voxelBuffer = device.createBuffer({
            label: 'Voxels',
            size: CHUNK_VOLUME * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        this.faceCountsBuffer = device.createBuffer({
            label: 'Face Counts',
            size: CHUNK_VOLUME * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        
        this.faceCounterBuffer = device.createBuffer({
            label: 'Face Counter',
            size: 8,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        
        this.countersBuffer = device.createBuffer({
            label: 'Atomic Counters',
            size: 8,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        this.readbackBuffer = device.createBuffer({
            label: 'Readback',
            size: 8,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        
        this.initialized = true;
        console.log('[FaceListMesher] Initialized - Ultra-compressed face-list format (4 bytes/face!)');
    }
    
    queueMeshChunk(chunk) {
        return new Promise((resolve, reject) => {
            const entry = { chunk, resolve, reject, isDamage: !!chunk.isDamage };
            
            // PRIORITY: Damage chunks go to FRONT of queue for instant response
            if (chunk.isDamage) {
                this.meshQueue.unshift(entry);
            } else {
                this.meshQueue.push(entry);
            }
            this._processQueue();
        });
    }
    
    async _processQueue() {
        if (this.processingQueue || this.meshQueue.length === 0) return;
        this.processingQueue = true;
        
        // Process sequentially (shared GPU buffers prevent true parallelism)
        // But process ALL queued chunks without artificial limits
        while (this.meshQueue.length > 0) {
            const { chunk, resolve, reject } = this.meshQueue.shift();
            try {
                const result = await this.meshChunk(chunk);
                resolve(result);
            } catch (err) {
                reject(err);
            }
        }
        
        this.processingQueue = false;
    }
    
    async meshChunk(chunk) {
        if (!this.initialized) return null;
        
        // Track concurrent meshing (no blocking - just for stats)
        this.activeMeshCount = (this.activeMeshCount || 0) + 1;
        
        const device = this.device;
        const startTime = performance.now();
        
        try {
            if (chunk.isHomogeneous) {
                if (chunk.homogeneousMaterial === 0) {
                    return { opaqueFaceBuffer: null, waterFaceBuffer: null, opaqueFaceCount: 0, waterFaceCount: 0 };
                }
                chunk.expand();
            }
            
            const [ox, oy, oz] = chunk.getWorldOrigin();
            
            // Use pre-allocated buffers to avoid per-mesh allocations
            const voxelData = this._voxelData;
            for (let i = 0; i < CHUNK_VOLUME; i++) {
                voxelData[i] = chunk.voxels[i];
            }
            device.queue.writeBuffer(this.voxelBuffer, 0, voxelData);
            this._paramsData[0] = ox; this._paramsData[1] = oy; this._paramsData[2] = oz; this._paramsData[3] = 0;
            device.queue.writeBuffer(this.paramsBuffer, 0, this._paramsData);
            device.queue.writeBuffer(this.faceCounterBuffer, 0, this._faceCounterReset);
            
            // Pass 1: Count faces
            {
                const encoder = device.createCommandEncoder();
                const bindGroup = device.createBindGroup({
                    layout: this.faceCountLayout,
                    entries: [
                        { binding: 0, resource: { buffer: this.paramsBuffer } },
                        { binding: 1, resource: { buffer: this.voxelBuffer } },
                        { binding: 2, resource: { buffer: this.faceCountsBuffer } },
                        { binding: 3, resource: { buffer: this.faceCounterBuffer } },
                    ],
                });
                const pass = encoder.beginComputePass();
                pass.setPipeline(this.faceCountPipeline);
                pass.setBindGroup(0, bindGroup);
                pass.dispatchWorkgroups(4, 4, 4);
                pass.end();
                device.queue.submit([encoder.finish()]);
                this.stats.passCount++;
            }
            
            // Readback face counts
            const copyEncoder = device.createCommandEncoder();
            copyEncoder.copyBufferToBuffer(this.faceCounterBuffer, 0, this.readbackBuffer, 0, 8);
            device.queue.submit([copyEncoder.finish()]);
            
            await this.readbackBuffer.mapAsync(GPUMapMode.READ);
            const countsData = new Uint32Array(this.readbackBuffer.getMappedRange());
            const opaqueFaceCount = countsData[0];
            const waterFaceCount = countsData[1];
            this.readbackBuffer.unmap();
            
            if (opaqueFaceCount === 0 && waterFaceCount === 0) {
                return { opaqueFaceBuffer: null, waterFaceBuffer: null, opaqueFaceCount: 0, waterFaceCount: 0 };
            }
            
            // Allocate face buffers from pool
            const opaqueFaceBuffer = opaqueFaceCount > 0 
                ? this.bufferPool.acquire(
                    opaqueFaceCount * 4, 
                    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
                    `Chunk ${chunk.key} Opaque Faces`
                  )
                : null;
                
            const waterFaceBuffer = waterFaceCount > 0
                ? this.bufferPool.acquire(
                    waterFaceCount * 4,
                    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
                    `Chunk ${chunk.key} Water Faces`
                  )
                : null;
            
            // Reset counters for generation pass
            device.queue.writeBuffer(this.countersBuffer, 0, this._countersReset);
            
            // Pass 2: Generate faces
            {
                const maxFaces = Math.max(opaqueFaceCount, waterFaceCount, 1);
                const tempOpaqueBuffer = opaqueFaceBuffer || device.createBuffer({
                    size: 4,
                    usage: GPUBufferUsage.STORAGE,
                });
                const tempWaterBuffer = waterFaceBuffer || device.createBuffer({
                    size: 4,
                    usage: GPUBufferUsage.STORAGE,
                });
                
                const encoder = device.createCommandEncoder();
                const bindGroup = device.createBindGroup({
                    layout: this.generateFacesLayout,
                    entries: [
                        { binding: 0, resource: { buffer: this.paramsBuffer } },
                        { binding: 1, resource: { buffer: this.voxelBuffer } },
                        { binding: 2, resource: { buffer: this.faceCountsBuffer } },
                        { binding: 3, resource: { buffer: tempOpaqueBuffer } },
                        { binding: 4, resource: { buffer: tempWaterBuffer } },
                        { binding: 5, resource: { buffer: this.countersBuffer } },
                    ],
                });
                const pass = encoder.beginComputePass();
                pass.setPipeline(this.generateFacesPipeline);
                pass.setBindGroup(0, bindGroup);
                pass.dispatchWorkgroups(4, 4, 4);
                pass.end();
                device.queue.submit([encoder.finish()]);
                this.stats.passCount++;
                
                if (!opaqueFaceBuffer && tempOpaqueBuffer.size === 4) tempOpaqueBuffer.destroy();
                if (!waterFaceBuffer && tempWaterBuffer.size === 4) tempWaterBuffer.destroy();
            }
            
            const meshTime = performance.now() - startTime;
            this.stats.meshCount++;
            this.stats.totalFaces += opaqueFaceCount + waterFaceCount;
            this.stats.totalPasses += 2;
            this.stats.bytesAllocated += (opaqueFaceCount + waterFaceCount) * 4;
            
            // Call metrics callback
            if (this.metricsCallback) {
                this.metricsCallback(meshTime, opaqueFaceCount + waterFaceCount);
            }
            
            return {
                opaqueFaceBuffer,
                waterFaceBuffer,
                opaqueFaceCount,
                waterFaceCount,
                meshTime,
                useFacePull: true,
                chunkOrigin: [ox, oy, oz],
            };
            
        } finally {
            this.activeMeshCount = Math.max(0, (this.activeMeshCount || 1) - 1);
        }
    }
    
    releaseBuffers(result) {
        if (result?.opaqueFaceBuffer) {
            this.bufferPool.release(result.opaqueFaceBuffer);
        }
        if (result?.waterFaceBuffer) {
            this.bufferPool.release(result.waterFaceBuffer);
        }
    }
    
    destroy() {
        this.paramsBuffer?.destroy();
        this.prefixSumParamsBuffer?.destroy();
        this.voxelBuffer?.destroy();
        this.faceCountsBuffer?.destroy();
        this.faceCounterBuffer?.destroy();
        this.countersBuffer?.destroy();
        this.readbackBuffer?.destroy();
        this.bufferPool.destroy();
        this.initialized = false;
    }
}

export default FaceListMesher;
