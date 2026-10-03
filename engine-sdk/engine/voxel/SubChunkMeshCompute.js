// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

//

// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha



/**

 * SubChunkMeshCompute.js - GPU Compute Meshing for 4³/8³ Sub-Chunks

 * 

 * Ultra-fast GPU meshing for cascaded chunk architecture.

 * Optimized for small sub-chunk regions (4³ = 64 voxels, 8³ = 512 voxels).

 * 

 * Key optimizations:

 * - Single workgroup per sub-chunk (no dispatch overhead)

 * - All voxels + neighbors fit in shared memory

 * - Atomic counting with immediate prefix sum

 * - Compact vertex format (8 bytes per vertex)

 * - Batched processing of multiple sub-chunks per dispatch

 * 

 * Performance targets:

 * - 4³ sub-chunk: ~0.01ms (10μs)

 * - 8³ sub-chunk: ~0.05ms (50μs)

 */



import { CHUNK_SIZE } from './VoxelConstants.js';



// ============================================================================

// SHADER SOURCES

// ============================================================================



// 4³ Micro-chunk meshing shader - single workgroup processes entire sub-chunk

const MESH_4_SHADER = /* wgsl */ `

const SUB_SIZE: u32 = 4u;

const SUB_VOLUME: u32 = 64u;  // 4³

const CHUNK_SIZE: u32 = 32u;

const CHUNK_SIZE_SQ: u32 = 1024u;

const MATERIAL_AIR: u32 = 0u;



// Shared memory: 6³ = 216 voxels (4³ + 1 border each side)

const SHARED_SIZE: u32 = 6u;

const SHARED_VOLUME: u32 = 216u;



struct Params {

    chunkOriginX: f32,

    chunkOriginY: f32,

    chunkOriginZ: f32,

    subOffsetX: u32,  // Sub-chunk offset within chunk (0-7 for 8 sub-chunks per axis)

    subOffsetY: u32,

    subOffsetZ: u32,

    packed: u32,

    _pad1: u32,

}



struct IndirectDraw {

    indexCount: atomic<u32>,

    instanceCount: u32,

    firstIndex: u32,

    baseVertex: u32,

    firstInstance: u32,

}



@group(0) @binding(0) var<uniform> params: Params;

@group(0) @binding(1) var<storage, read> voxels: array<u32>;

@group(0) @binding(2) var<storage, read_write> vertices: array<u32>;

@group(0) @binding(3) var<storage, read_write> indices: array<u32>;

@group(0) @binding(4) var<storage, read_write> indirectDraw: IndirectDraw;



fn readVoxel(index: u32) -> u32 {

    if (params.packed == 1u) {

        let value = voxels[index / 4u];

        return (value >> ((index % 4u) * 8u)) & 0xFFu;

    }

    return voxels[index] & 0xFFu;

}



var<workgroup> sharedVoxels: array<u32, 216>;  // 6³

var<workgroup> faceCount: atomic<u32>;

var<workgroup> vertexOffset: array<u32, 64>;  // Per-voxel vertex offset



fn chunkIndex(lx: u32, ly: u32, lz: u32) -> u32 {

    return lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE_SQ;

}



fn sharedIndex(sx: u32, sy: u32, sz: u32) -> u32 {

    return sx + sy * SHARED_SIZE + sz * SHARED_SIZE * SHARED_SIZE;

}



fn getShared(sx: i32, sy: i32, sz: i32) -> u32 {

    let cx = clamp(sx, 0, 5);

    let cy = clamp(sy, 0, 5);

    let cz = clamp(sz, 0, 5);

    return sharedVoxels[sharedIndex(u32(cx), u32(cy), u32(cz))];

}



fn isTransparent(mat: u32) -> bool {

    return mat == MATERIAL_AIR || mat == 5u;

}



fn countFaces(sx: i32, sy: i32, sz: i32, mat: u32) -> u32 {

    if (mat == MATERIAL_AIR) { return 0u; }

    var count = 0u;

    count += select(0u, 1u, isTransparent(getShared(sx + 1, sy, sz)));

    count += select(0u, 1u, isTransparent(getShared(sx - 1, sy, sz)));

    count += select(0u, 1u, isTransparent(getShared(sx, sy + 1, sz)));

    count += select(0u, 1u, isTransparent(getShared(sx, sy - 1, sz)));

    count += select(0u, 1u, isTransparent(getShared(sx, sy, sz + 1)));

    count += select(0u, 1u, isTransparent(getShared(sx, sy, sz - 1)));

    return count;

}



fn packVertex(posX: u32, posY: u32, posZ: u32, normalIdx: u32, material: u32, ao: u32) -> vec2<u32> {

    let word0 = (posX & 0x3Fu) | 

                ((posY & 0x3Fu) << 6u) | 

                ((posZ & 0x3Fu) << 12u) | 

                ((normalIdx & 0x7u) << 18u) |

                ((ao & 0x3u) << 21u);

    let word1 = material & 0xFFu;

    return vec2<u32>(word0, word1);

}



fn writeQuad(baseVert: u32, baseIdx: u32, 

             px: u32, py: u32, pz: u32, 

             faceDir: u32, material: u32) {

    // Face vertex offsets (4 vertices per quad)

    // Simplified - no AO for micro-meshes (speed > quality at this scale)

    var v0 = vec3<u32>(px, py, pz);

    var v1 = vec3<u32>(px, py, pz);

    var v2 = vec3<u32>(px, py, pz);

    var v3 = vec3<u32>(px, py, pz);

    

    switch(faceDir) {

        case 0u: { // +X

            v0 = vec3<u32>(px + 1u, py, pz);

            v1 = vec3<u32>(px + 1u, py + 1u, pz);

            v2 = vec3<u32>(px + 1u, py + 1u, pz + 1u);

            v3 = vec3<u32>(px + 1u, py, pz + 1u);

        }

        case 1u: { // -X

            v0 = vec3<u32>(px, py, pz + 1u);

            v1 = vec3<u32>(px, py + 1u, pz + 1u);

            v2 = vec3<u32>(px, py + 1u, pz);

            v3 = vec3<u32>(px, py, pz);

        }

        case 2u: { // +Y

            v0 = vec3<u32>(px, py + 1u, pz);

            v1 = vec3<u32>(px, py + 1u, pz + 1u);

            v2 = vec3<u32>(px + 1u, py + 1u, pz + 1u);

            v3 = vec3<u32>(px + 1u, py + 1u, pz);

        }

        case 3u: { // -Y

            v0 = vec3<u32>(px, py, pz + 1u);

            v1 = vec3<u32>(px, py, pz);

            v2 = vec3<u32>(px + 1u, py, pz);

            v3 = vec3<u32>(px + 1u, py, pz + 1u);

        }

        case 4u: { // +Z

            v0 = vec3<u32>(px + 1u, py, pz + 1u);

            v1 = vec3<u32>(px + 1u, py + 1u, pz + 1u);

            v2 = vec3<u32>(px, py + 1u, pz + 1u);

            v3 = vec3<u32>(px, py, pz + 1u);

        }

        case 5u: { // -Z

            v0 = vec3<u32>(px, py, pz);

            v1 = vec3<u32>(px, py + 1u, pz);

            v2 = vec3<u32>(px + 1u, py + 1u, pz);

            v3 = vec3<u32>(px + 1u, py, pz);

        }

        default: {}

    }

    

    // Write packed vertices (2 u32s each)

    let p0 = packVertex(v0.x, v0.y, v0.z, faceDir, material, 3u);

    let p1 = packVertex(v1.x, v1.y, v1.z, faceDir, material, 3u);

    let p2 = packVertex(v2.x, v2.y, v2.z, faceDir, material, 3u);

    let p3 = packVertex(v3.x, v3.y, v3.z, faceDir, material, 3u);

    

    let vOff = baseVert * 2u;

    vertices[vOff + 0u] = p0.x; vertices[vOff + 1u] = p0.y;

    vertices[vOff + 2u] = p1.x; vertices[vOff + 3u] = p1.y;

    vertices[vOff + 4u] = p2.x; vertices[vOff + 5u] = p2.y;

    vertices[vOff + 6u] = p3.x; vertices[vOff + 7u] = p3.y;

    

    // Write indices (2 triangles)

    indices[baseIdx + 0u] = baseVert;

    indices[baseIdx + 1u] = baseVert + 1u;

    indices[baseIdx + 2u] = baseVert + 2u;

    indices[baseIdx + 3u] = baseVert;

    indices[baseIdx + 4u] = baseVert + 2u;

    indices[baseIdx + 5u] = baseVert + 3u;

}



@compute @workgroup_size(64)  // 64 threads = 4³ voxels, 1 thread per voxel

fn main(

    @builtin(local_invocation_id) lid: vec3<u32>,

    @builtin(local_invocation_index) lidx: u32

) {

    // Phase 1: Load voxels into shared memory

    let subBase = vec3<u32>(params.subOffsetX * SUB_SIZE, 

                            params.subOffsetY * SUB_SIZE, 

                            params.subOffsetZ * SUB_SIZE);

    

    // Load 6³ = 216 voxels with 64 threads (each thread loads ~3-4)

    for (var i = lidx; i < SHARED_VOLUME; i += 64u) {

        let sz = i / 36u;

        let sy = (i % 36u) / 6u;

        let sx = i % 6u;

        

        // Global chunk coords (with -1 border offset)

        let gx = i32(subBase.x) + i32(sx) - 1;

        let gy = i32(subBase.y) + i32(sy) - 1;

        let gz = i32(subBase.z) + i32(sz) - 1;

        

        var voxel = MATERIAL_AIR;

        if (gx >= 0 && gx < i32(CHUNK_SIZE) &&

            gy >= 0 && gy < i32(CHUNK_SIZE) &&

            gz >= 0 && gz < i32(CHUNK_SIZE)) {

            voxel = readVoxel(chunkIndex(u32(gx), u32(gy), u32(gz)));

        }

        sharedVoxels[i] = voxel;

    }

    

    workgroupBarrier();

    

    // Phase 2: Count faces per voxel

    let lx = lidx % SUB_SIZE;

    let ly = (lidx / SUB_SIZE) % SUB_SIZE;

    let lz = lidx / (SUB_SIZE * SUB_SIZE);

    

    let sx = i32(lx) + 1;  // +1 for border offset

    let sy = i32(ly) + 1;

    let sz = i32(lz) + 1;

    

    let mat = getShared(sx, sy, sz);

    let faces = countFaces(sx, sy, sz, mat);

    

    // Atomic add to get vertex offset

    var myOffset = 0u;

    if (faces > 0u) {

        myOffset = atomicAdd(&faceCount, faces);

    }

    vertexOffset[lidx] = myOffset;

    

    workgroupBarrier();

    

    // Phase 3: Generate vertices and indices

    if (faces == 0u) { return; }

    

    let totalFaces = atomicLoad(&faceCount);

    

    // Update indirect draw buffer (first thread only)

    if (lidx == 0u) {

        atomicStore(&indirectDraw.indexCount, totalFaces * 6u);

    }

    

    // World position for this voxel

    let wx = subBase.x + lx;

    let wy = subBase.y + ly;

    let wz = subBase.z + lz;

    

    var currentFace = myOffset;

    

    // Generate faces (unrolled for speed)

    if (isTransparent(getShared(sx + 1, sy, sz))) {

        writeQuad(currentFace * 4u, currentFace * 6u, wx, wy, wz, 0u, mat);

        currentFace += 1u;

    }

    if (isTransparent(getShared(sx - 1, sy, sz))) {

        writeQuad(currentFace * 4u, currentFace * 6u, wx, wy, wz, 1u, mat);

        currentFace += 1u;

    }

    if (isTransparent(getShared(sx, sy + 1, sz))) {

        writeQuad(currentFace * 4u, currentFace * 6u, wx, wy, wz, 2u, mat);

        currentFace += 1u;

    }

    if (isTransparent(getShared(sx, sy - 1, sz))) {

        writeQuad(currentFace * 4u, currentFace * 6u, wx, wy, wz, 3u, mat);

        currentFace += 1u;

    }

    if (isTransparent(getShared(sx, sy, sz + 1))) {

        writeQuad(currentFace * 4u, currentFace * 6u, wx, wy, wz, 4u, mat);

        currentFace += 1u;

    }

    if (isTransparent(getShared(sx, sy, sz - 1))) {

        writeQuad(currentFace * 4u, currentFace * 6u, wx, wy, wz, 5u, mat);

        currentFace += 1u;

    }

}

`;



// 8³ Sub-chunk meshing shader - 512 threads, 1 per voxel

const MESH_8_SHADER = /* wgsl */ `

const SUB_SIZE: u32 = 8u;

const SUB_VOLUME: u32 = 512u;  // 8³

const CHUNK_SIZE: u32 = 32u;

const CHUNK_SIZE_SQ: u32 = 1024u;

const MATERIAL_AIR: u32 = 0u;



// Shared memory: 10³ = 1000 voxels (8³ + 1 border each side)

const SHARED_SIZE: u32 = 10u;

const SHARED_VOLUME: u32 = 1000u;



struct Params {

    chunkOriginX: f32,

    chunkOriginY: f32,

    chunkOriginZ: f32,

    subOffsetX: u32,

    subOffsetY: u32,

    subOffsetZ: u32,

    packed: u32,

    _pad1: u32,

}



struct IndirectDraw {

    indexCount: atomic<u32>,

    instanceCount: u32,

    firstIndex: u32,

    baseVertex: u32,

    firstInstance: u32,

}



@group(0) @binding(0) var<uniform> params: Params;

@group(0) @binding(1) var<storage, read> voxels: array<u32>;

@group(0) @binding(2) var<storage, read_write> vertices: array<u32>;

@group(0) @binding(3) var<storage, read_write> indices: array<u32>;

@group(0) @binding(4) var<storage, read_write> indirectDraw: IndirectDraw;



fn readVoxel(index: u32) -> u32 {

    if (params.packed == 1u) {

        let value = voxels[index / 4u];

        return (value >> ((index % 4u) * 8u)) & 0xFFu;

    }

    return voxels[index] & 0xFFu;

}



var<workgroup> sharedVoxels: array<u32, 1000>;  // 10³

var<workgroup> faceCount: atomic<u32>;



fn chunkIndex(lx: u32, ly: u32, lz: u32) -> u32 {

    return lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE_SQ;

}



fn sharedIndex(sx: u32, sy: u32, sz: u32) -> u32 {

    return sx + sy * SHARED_SIZE + sz * SHARED_SIZE * SHARED_SIZE;

}



fn getShared(sx: i32, sy: i32, sz: i32) -> u32 {

    let cx = clamp(sx, 0, 9);

    let cy = clamp(sy, 0, 9);

    let cz = clamp(sz, 0, 9);

    return sharedVoxels[sharedIndex(u32(cx), u32(cy), u32(cz))];

}



fn isTransparent(mat: u32) -> bool {

    return mat == MATERIAL_AIR || mat == 5u;

}



fn packVertex(posX: u32, posY: u32, posZ: u32, normalIdx: u32, material: u32, ao: u32) -> vec2<u32> {

    let word0 = (posX & 0x3Fu) | 

                ((posY & 0x3Fu) << 6u) | 

                ((posZ & 0x3Fu) << 12u) | 

                ((normalIdx & 0x7u) << 18u) |

                ((ao & 0x3u) << 21u);

    let word1 = material & 0xFFu;

    return vec2<u32>(word0, word1);

}



fn writeQuad(baseVert: u32, baseIdx: u32, 

             px: u32, py: u32, pz: u32, 

             faceDir: u32, material: u32) {

    var v0 = vec3<u32>(px, py, pz);

    var v1 = vec3<u32>(px, py, pz);

    var v2 = vec3<u32>(px, py, pz);

    var v3 = vec3<u32>(px, py, pz);

    

    switch(faceDir) {

        case 0u: { v0 = vec3<u32>(px + 1u, py, pz); v1 = vec3<u32>(px + 1u, py + 1u, pz); v2 = vec3<u32>(px + 1u, py + 1u, pz + 1u); v3 = vec3<u32>(px + 1u, py, pz + 1u); }

        case 1u: { v0 = vec3<u32>(px, py, pz + 1u); v1 = vec3<u32>(px, py + 1u, pz + 1u); v2 = vec3<u32>(px, py + 1u, pz); v3 = vec3<u32>(px, py, pz); }

        case 2u: { v0 = vec3<u32>(px, py + 1u, pz); v1 = vec3<u32>(px, py + 1u, pz + 1u); v2 = vec3<u32>(px + 1u, py + 1u, pz + 1u); v3 = vec3<u32>(px + 1u, py + 1u, pz); }

        case 3u: { v0 = vec3<u32>(px, py, pz + 1u); v1 = vec3<u32>(px, py, pz); v2 = vec3<u32>(px + 1u, py, pz); v3 = vec3<u32>(px + 1u, py, pz + 1u); }

        case 4u: { v0 = vec3<u32>(px + 1u, py, pz + 1u); v1 = vec3<u32>(px + 1u, py + 1u, pz + 1u); v2 = vec3<u32>(px, py + 1u, pz + 1u); v3 = vec3<u32>(px, py, pz + 1u); }

        case 5u: { v0 = vec3<u32>(px, py, pz); v1 = vec3<u32>(px, py + 1u, pz); v2 = vec3<u32>(px + 1u, py + 1u, pz); v3 = vec3<u32>(px + 1u, py, pz); }

        default: {}

    }

    

    let p0 = packVertex(v0.x, v0.y, v0.z, faceDir, material, 3u);

    let p1 = packVertex(v1.x, v1.y, v1.z, faceDir, material, 3u);

    let p2 = packVertex(v2.x, v2.y, v2.z, faceDir, material, 3u);

    let p3 = packVertex(v3.x, v3.y, v3.z, faceDir, material, 3u);

    

    let vOff = baseVert * 2u;

    vertices[vOff + 0u] = p0.x; vertices[vOff + 1u] = p0.y;

    vertices[vOff + 2u] = p1.x; vertices[vOff + 3u] = p1.y;

    vertices[vOff + 4u] = p2.x; vertices[vOff + 5u] = p2.y;

    vertices[vOff + 6u] = p3.x; vertices[vOff + 7u] = p3.y;

    

    indices[baseIdx + 0u] = baseVert;

    indices[baseIdx + 1u] = baseVert + 1u;

    indices[baseIdx + 2u] = baseVert + 2u;

    indices[baseIdx + 3u] = baseVert;

    indices[baseIdx + 4u] = baseVert + 2u;

    indices[baseIdx + 5u] = baseVert + 3u;

}



@compute @workgroup_size(8, 8, 8)  // 512 threads = 8³ voxels

fn main(

    @builtin(local_invocation_id) lid: vec3<u32>,

    @builtin(local_invocation_index) lidx: u32

) {

    let subBase = vec3<u32>(params.subOffsetX * SUB_SIZE, 

                            params.subOffsetY * SUB_SIZE, 

                            params.subOffsetZ * SUB_SIZE);

    

    // Phase 1: Load voxels (512 threads load 1000 cells, ~2 each)

    for (var i = lidx; i < SHARED_VOLUME; i += 512u) {

        let sz = i / 100u;

        let sy = (i % 100u) / 10u;

        let sx = i % 10u;

        

        let gx = i32(subBase.x) + i32(sx) - 1;

        let gy = i32(subBase.y) + i32(sy) - 1;

        let gz = i32(subBase.z) + i32(sz) - 1;

        

        var voxel = MATERIAL_AIR;

        if (gx >= 0 && gx < i32(CHUNK_SIZE) &&

            gy >= 0 && gy < i32(CHUNK_SIZE) &&

            gz >= 0 && gz < i32(CHUNK_SIZE)) {

            voxel = readVoxel(chunkIndex(u32(gx), u32(gy), u32(gz)));

        }

        sharedVoxels[i] = voxel;

    }

    

    workgroupBarrier();

    

    // Phase 2: Count and generate faces

    // NOTE: No early returns allowed before workgroupBarrier - use conditionals

    let sx = i32(lid.x) + 1;

    let sy = i32(lid.y) + 1;

    let sz = i32(lid.z) + 1;

    

    let mat = getShared(sx, sy, sz);

    let isSolid = mat != MATERIAL_AIR;

    

    // Count visible faces (only if solid)

    var faces = 0u;

    if (isSolid) {

        faces += select(0u, 1u, isTransparent(getShared(sx + 1, sy, sz)));

        faces += select(0u, 1u, isTransparent(getShared(sx - 1, sy, sz)));

        faces += select(0u, 1u, isTransparent(getShared(sx, sy + 1, sz)));

        faces += select(0u, 1u, isTransparent(getShared(sx, sy - 1, sz)));

        faces += select(0u, 1u, isTransparent(getShared(sx, sy, sz + 1)));

        faces += select(0u, 1u, isTransparent(getShared(sx, sy, sz - 1)));

    }

    

    // Atomic reserve space (0 faces = no-op)

    var myOffset = 0u;

    if (faces > 0u) {

        myOffset = atomicAdd(&faceCount, faces);

    }

    

    // World position

    let wx = subBase.x + lid.x;

    let wy = subBase.y + lid.y;

    let wz = subBase.z + lid.z;

    

    // Generate quads only if we have faces

    if (faces > 0u) {

        var currentFace = myOffset;

        

        if (isTransparent(getShared(sx + 1, sy, sz))) {

            writeQuad(currentFace * 4u, currentFace * 6u, wx, wy, wz, 0u, mat);

            currentFace += 1u;

        }

        if (isTransparent(getShared(sx - 1, sy, sz))) {

            writeQuad(currentFace * 4u, currentFace * 6u, wx, wy, wz, 1u, mat);

            currentFace += 1u;

        }

        if (isTransparent(getShared(sx, sy + 1, sz))) {

            writeQuad(currentFace * 4u, currentFace * 6u, wx, wy, wz, 2u, mat);

            currentFace += 1u;

        }

        if (isTransparent(getShared(sx, sy - 1, sz))) {

            writeQuad(currentFace * 4u, currentFace * 6u, wx, wy, wz, 3u, mat);

            currentFace += 1u;

        }

        if (isTransparent(getShared(sx, sy, sz + 1))) {

            writeQuad(currentFace * 4u, currentFace * 6u, wx, wy, wz, 4u, mat);

            currentFace += 1u;

        }

        if (isTransparent(getShared(sx, sy, sz - 1))) {

            writeQuad(currentFace * 4u, currentFace * 6u, wx, wy, wz, 5u, mat);

            currentFace += 1u;

        }

    }

    

    // Update indirect draw (all threads reach barrier together)

    workgroupBarrier();

    if (lidx == 0u) {

        let total = atomicLoad(&faceCount);

        atomicStore(&indirectDraw.indexCount, total * 6u);

    }

}

`;



const MESH_8_FALLBACK_64_SHADER = buildMesh8Fallback64Shader(MESH_8_SHADER);



function buildMesh8Fallback64Shader(source) {

    const mainMarker = '@compute @workgroup_size(8, 8, 8)';

    const mainIndex = source.indexOf(mainMarker);

    if (mainIndex < 0) throw new Error('SubChunkMeshCompute: 8³ shader main marker missing');

    return source.slice(0, mainIndex) + /* wgsl */ `

@compute @workgroup_size(64)

fn main(@builtin(local_invocation_index) lidx: u32) {

    let subBase = vec3<u32>(params.subOffsetX * SUB_SIZE,

                            params.subOffsetY * SUB_SIZE,

                            params.subOffsetZ * SUB_SIZE);



    // Baseline adapters guarantee 256 invocations. Sixty-four lanes cooperatively

    // load shared memory, then each lane processes eight voxels serially.

    for (var i = lidx; i < SHARED_VOLUME; i += 64u) {

        let z = i / 100u;

        let y = (i % 100u) / 10u;

        let x = i % 10u;

        let gx = i32(subBase.x) + i32(x) - 1;

        let gy = i32(subBase.y) + i32(y) - 1;

        let gz = i32(subBase.z) + i32(z) - 1;

        var voxel = MATERIAL_AIR;

        if (gx >= 0 && gx < i32(CHUNK_SIZE) &&

            gy >= 0 && gy < i32(CHUNK_SIZE) &&

            gz >= 0 && gz < i32(CHUNK_SIZE)) {

            voxel = readVoxel(chunkIndex(u32(gx), u32(gy), u32(gz)));

        }

        sharedVoxels[i] = voxel;

    }



    workgroupBarrier();



    for (var voxelIndex = lidx; voxelIndex < SUB_VOLUME; voxelIndex += 64u) {

        let lx = voxelIndex % SUB_SIZE;

        let ly = (voxelIndex / SUB_SIZE) % SUB_SIZE;

        let lz = voxelIndex / (SUB_SIZE * SUB_SIZE);

        let sx = i32(lx) + 1;

        let sy = i32(ly) + 1;

        let sz = i32(lz) + 1;

        let mat = getShared(sx, sy, sz);

        var faces = 0u;

        if (mat != MATERIAL_AIR) {

            faces += select(0u, 1u, isTransparent(getShared(sx + 1, sy, sz)));

            faces += select(0u, 1u, isTransparent(getShared(sx - 1, sy, sz)));

            faces += select(0u, 1u, isTransparent(getShared(sx, sy + 1, sz)));

            faces += select(0u, 1u, isTransparent(getShared(sx, sy - 1, sz)));

            faces += select(0u, 1u, isTransparent(getShared(sx, sy, sz + 1)));

            faces += select(0u, 1u, isTransparent(getShared(sx, sy, sz - 1)));

        }

        var currentFace = 0u;

        if (faces > 0u) {

            currentFace = atomicAdd(&faceCount, faces);

            let wx = subBase.x + lx;

            let wy = subBase.y + ly;

            let wz = subBase.z + lz;

            if (isTransparent(getShared(sx + 1, sy, sz))) {

                writeQuad(currentFace * 4u, currentFace * 6u, wx, wy, wz, 0u, mat);

                currentFace += 1u;

            }

            if (isTransparent(getShared(sx - 1, sy, sz))) {

                writeQuad(currentFace * 4u, currentFace * 6u, wx, wy, wz, 1u, mat);

                currentFace += 1u;

            }

            if (isTransparent(getShared(sx, sy + 1, sz))) {

                writeQuad(currentFace * 4u, currentFace * 6u, wx, wy, wz, 2u, mat);

                currentFace += 1u;

            }

            if (isTransparent(getShared(sx, sy - 1, sz))) {

                writeQuad(currentFace * 4u, currentFace * 6u, wx, wy, wz, 3u, mat);

                currentFace += 1u;

            }

            if (isTransparent(getShared(sx, sy, sz + 1))) {

                writeQuad(currentFace * 4u, currentFace * 6u, wx, wy, wz, 4u, mat);

                currentFace += 1u;

            }

            if (isTransparent(getShared(sx, sy, sz - 1))) {

                writeQuad(currentFace * 4u, currentFace * 6u, wx, wy, wz, 5u, mat);

            }

        }

    }



    workgroupBarrier();

    if (lidx == 0u) {

        atomicStore(&indirectDraw.indexCount, atomicLoad(&faceCount) * 6u);

    }

}

`;

}



// ============================================================================

// SubChunkMeshCompute CLASS

// ============================================================================



export class SubChunkMeshCompute {

    constructor(externalBufferPool = null) {

        this.device = null;

        this.initialized = false;

        

        // Pipelines

        this.mesh4Pipeline = null;

        this.mesh8Pipeline = null;

        this.mesh8Mode = 'uninitialized';

        

        // Shared buffers

        this.paramsBuffer = null;

        this.voxelBuffer = null;

        

        // External buffer pool (SubChunkBufferPool) - preferred

        this.bufferPool = externalBufferPool;

        

        // Internal fallback pools (used if no external pool)

        this.vertexBufferPool = [];

        this.indexBufferPool = [];

        this.indirectBufferPool = [];

        

        // Max faces per sub-chunk (for buffer sizing)

        this.maxFaces4 = 64 * 6;   // 4³ voxels × 6 faces max = 384 faces

        this.maxFaces8 = 512 * 6;  // 8³ voxels × 6 faces max = 3072 faces

        

        // Stats

        this.stats = {

            mesh4Calls: 0,

            mesh8Calls: 0,

            totalTime: 0,

            poolHits: 0,

            poolMisses: 0,

        };

        

        // Pre-allocated typed arrays to avoid per-mesh allocations

        this._voxelData = new Uint32Array(32 * 32 * 32);

        this._paramsBuffer = new ArrayBuffer(32);

        this._paramsFloat = new Float32Array(this._paramsBuffer, 0, 3);

        this._paramsInt = new Uint32Array(this._paramsBuffer, 12, 5);

        this._indirectReset = new Uint32Array([0, 1, 0, 0, 0]);

        

        // Metrics callback for performance tracking

        this.metricsCallback = null;

    }

    

    /**

     * Set metrics callback for performance tracking

     * @param {Function} callback - (size, timeMs, faceCount) => void

     */

    setMetricsCallback(callback) {

        this.metricsCallback = callback;

    }

    

    /**

     * Set external buffer pool

     * @param {SubChunkBufferPool} pool 

     */

    setBufferPool(pool) {

        this.bufferPool = pool;

    }

    

    /**

     * Initialize GPU resources

     * @param {GPUDevice} device 

     */

    async init(device) {

        this.device = device;

        

        // Create shader modules

        const mesh4Module = device.createShaderModule({

            label: 'SubChunk Mesh 4³',

            code: MESH_4_SHADER,

        });

        

        const maxInvocations = Number(device.limits?.maxComputeInvocationsPerWorkgroup) || 0;

        this.mesh8Mode = maxInvocations >= 512 ? 'native-512' : 'fallback-64';

        const mesh8Module = device.createShaderModule({

            label: `SubChunk Mesh 8³ (${this.mesh8Mode})`,

            code: this.mesh8Mode === 'native-512' ? MESH_8_SHADER : MESH_8_FALLBACK_64_SHADER,

        });

        

        // Create bind group layout (shared between 4³ and 8³)

        this.bindGroupLayout = device.createBindGroupLayout({

            label: 'SubChunk Mesh Layout',

            entries: [

                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },

                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },

                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },

                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },

                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },

            ],

        });

        

        const pipelineLayout = device.createPipelineLayout({

            bindGroupLayouts: [this.bindGroupLayout],

        });

        

        // Create pipelines

        this.mesh4Pipeline = device.createComputePipeline({

            label: 'SubChunk Mesh 4³ Pipeline',

            layout: pipelineLayout,

            compute: { module: mesh4Module, entryPoint: 'main' },

        });

        

        this.mesh8Pipeline = device.createComputePipeline({

            label: 'SubChunk Mesh 8³ Pipeline',

            layout: pipelineLayout,

            compute: { module: mesh8Module, entryPoint: 'main' },

        });

        

        // Create params buffer

        this.paramsBuffer = device.createBuffer({

            label: 'SubChunk Params',

            size: 32,  // 8 × 4 bytes

            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,

        });

        

        // Create voxel buffer (full chunk for neighbor access)

        this.voxelBuffer = device.createBuffer({

            label: 'SubChunk Voxels',

            size: 32 * 32 * 32 * 4,  // Full chunk

            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,

        });

        

        this.initialized = true;

        console.log(`[SubChunkMeshCompute] Initialized with 4³ and 8³ pipelines (${this.mesh8Mode})`);

    }

    

    /**

     * Get or create a vertex buffer from pool

     * @param {number} vertexCount - Number of vertices needed

     * @returns {{buffer: GPUBuffer, bucket: number}}

     */

    _getVertexBuffer(vertexCount) {

        // Use external pool if available

        if (this.bufferPool && this.bufferPool.initialized) {

            const result = this.bufferPool.acquireVertexBuffer(vertexCount);

            this.stats.poolHits++;

            return result;

        }

        

        // Fallback to internal pool

        const size = vertexCount * 8; // 8 bytes per packed vertex

        for (let i = 0; i < this.vertexBufferPool.length; i++) {

            if (this.vertexBufferPool[i].size >= size) {

                this.stats.poolHits++;

                return { buffer: this.vertexBufferPool.splice(i, 1)[0], bucket: -1 };

            }

        }

        

        this.stats.poolMisses++;

        return {

            buffer: this.device.createBuffer({

                label: 'SubChunk Vertices',

                size: Math.max(size, 1024),

                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,

            }),

            bucket: -1,

        };

    }

    

    /**

     * Get or create an index buffer from pool

     * @param {number} indexCount - Number of indices needed

     * @returns {{buffer: GPUBuffer, bucket: number}}

     */

    _getIndexBuffer(indexCount) {

        // Use external pool if available

        if (this.bufferPool && this.bufferPool.initialized) {

            const result = this.bufferPool.acquireIndexBuffer(indexCount);

            return result;

        }

        

        // Fallback to internal pool

        const size = indexCount * 4;

        for (let i = 0; i < this.indexBufferPool.length; i++) {

            if (this.indexBufferPool[i].size >= size) {

                return { buffer: this.indexBufferPool.splice(i, 1)[0], bucket: -1 };

            }

        }

        

        return {

            buffer: this.device.createBuffer({

                label: 'SubChunk Indices',

                size: Math.max(size, 1024),

                usage: GPUBufferUsage.INDEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,

            }),

            bucket: -1,

        };

    }

    

    /**

     * Get or create an indirect buffer from pool

     * @returns {GPUBuffer}

     */

    _getIndirectBuffer() {

        // Use external pool if available

        if (this.bufferPool && this.bufferPool.initialized) {

            return this.bufferPool.acquireIndirectBuffer();

        }

        

        // Fallback to internal pool

        if (this.indirectBufferPool.length > 0) {

            return this.indirectBufferPool.pop();

        }

        

        return this.device.createBuffer({

            label: 'SubChunk Indirect',

            size: 20,

            usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,

        });

    }

    

    /**

     * Return buffers to pool

     * @param {GPUBuffer} vertexBuffer 

     * @param {GPUBuffer} indexBuffer 

     * @param {GPUBuffer} indirectBuffer 

     * @param {number} vertexBucket - Bucket index for vertex buffer

     * @param {number} indexBucket - Bucket index for index buffer

     */

    returnBuffers(vertexBuffer, indexBuffer, indirectBuffer, vertexBucket = -1, indexBucket = -1) {

        // Use external pool if available

        if (this.bufferPool && this.bufferPool.initialized) {

            if (vertexBuffer) this.bufferPool.returnVertexBuffer(vertexBuffer, vertexBucket);

            if (indexBuffer) this.bufferPool.returnIndexBuffer(indexBuffer, indexBucket);

            if (indirectBuffer) this.bufferPool.returnIndirectBuffer(indirectBuffer);

            return;

        }

        

        // Fallback to internal pool

        if (vertexBuffer && this.vertexBufferPool.length < 32) {

            this.vertexBufferPool.push(vertexBuffer);

        }

        if (indexBuffer && this.indexBufferPool.length < 32) {

            this.indexBufferPool.push(indexBuffer);

        }

        if (indirectBuffer && this.indirectBufferPool.length < 32) {

            this.indirectBufferPool.push(indirectBuffer);

        }

    }

    

    /**

     * Mesh a 4³ sub-chunk on GPU

     * @param {VoxelChunk} chunk - Parent chunk

     * @param {number} sx - Sub-chunk X offset (0-7)

     * @param {number} sy - Sub-chunk Y offset (0-7)

     * @param {number} sz - Sub-chunk Z offset (0-7)

     * @returns {Promise<{vertexBuffer, indexBuffer, indexCount}>}

     */

    async meshSubChunk4(chunk, sx, sy, sz) {

        if (!this.initialized) return null;

        

        const startTime = performance.now();

        

        // Upload chunk voxels (use pre-allocated buffer)

        const voxelData = this._voxelData;

        const voxelSource = chunk.gpuBuffer ?? this.voxelBuffer;

        if (!chunk.gpuBuffer) {

            voxelData.fill(0);

            if (chunk.voxels) {

                for (let i = 0; i < chunk.voxels.length; i++) voxelData[i] = chunk.voxels[i];

            }

            this.device.queue.writeBuffer(this.voxelBuffer, 0, voxelData);

        }

        

        // Update params (use pre-allocated buffers)

        const origin = chunk.getWorldOrigin();

        this._paramsFloat[0] = origin[0]; this._paramsFloat[1] = origin[1]; this._paramsFloat[2] = origin[2];

        this._paramsInt[0] = sx; this._paramsInt[1] = sy; this._paramsInt[2] = sz; this._paramsInt[3] = chunk.gpuBuffer ? 1 : 0;

        this.device.queue.writeBuffer(this.paramsBuffer, 0, this._paramsBuffer);

        

        // Allocate output buffers from pool

        const maxVerts = this.maxFaces4 * 4;  // 4 verts per face

        const maxIndices = this.maxFaces4 * 6; // 6 indices per face

        

        const vertexResult = this._getVertexBuffer(maxVerts);

        const indexResult = this._getIndexBuffer(maxIndices);

        const indirectBuffer = this._getIndirectBuffer();

        

        const vertexBuffer = vertexResult.buffer;

        const indexBuffer = indexResult.buffer;

        const vertexBucket = vertexResult.bucket;

        const indexBucket = indexResult.bucket;

        

        // Clear indirect buffer (use pre-allocated buffer)

        this.device.queue.writeBuffer(indirectBuffer, 0, this._indirectReset);

        

        // Create bind group

        const bindGroup = this.device.createBindGroup({

            layout: this.bindGroupLayout,

            entries: [

                { binding: 0, resource: { buffer: this.paramsBuffer } },

                { binding: 1, resource: { buffer: voxelSource } },

                { binding: 2, resource: { buffer: vertexBuffer } },

                { binding: 3, resource: { buffer: indexBuffer } },

                { binding: 4, resource: { buffer: indirectBuffer } },

            ],

        });

        

        // Dispatch compute

        const encoder = this.device.createCommandEncoder();

        const pass = encoder.beginComputePass();

        pass.setPipeline(this.mesh4Pipeline);

        pass.setBindGroup(0, bindGroup);

        pass.dispatchWorkgroups(1);  // Single workgroup for 4³

        pass.end();

        

        this.device.queue.submit([encoder.finish()]);

        

        // Read back index count

        const readbackBuffer = this.device.createBuffer({

            size: 4,

            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,

        });

        

        const copyEncoder = this.device.createCommandEncoder();

        copyEncoder.copyBufferToBuffer(indirectBuffer, 0, readbackBuffer, 0, 4);

        this.device.queue.submit([copyEncoder.finish()]);

        

        await readbackBuffer.mapAsync(GPUMapMode.READ);

        const indexCount = new Uint32Array(readbackBuffer.getMappedRange())[0];

        readbackBuffer.unmap();

        readbackBuffer.destroy();

        

        const meshTime = performance.now() - startTime;

        this.stats.mesh4Calls++;

        this.stats.totalTime += meshTime;

        

        // Report to metrics callback

        if (this.metricsCallback) {

            this.metricsCallback(4, meshTime, indexCount / 6);

        }

        

        return { vertexBuffer, indexBuffer, indexCount, indirectBuffer, vertexBucket, indexBucket };

    }

    

    /**

     * Mesh an 8³ sub-chunk on GPU

     * @param {VoxelChunk} chunk - Parent chunk

     * @param {number} sx - Sub-chunk X offset (0-3)

     * @param {number} sy - Sub-chunk Y offset (0-3)

     * @param {number} sz - Sub-chunk Z offset (0-3)

     * @returns {Promise<{vertexBuffer, indexBuffer, indexCount}>}

     */

    async meshSubChunk8(chunk, sx, sy, sz) {

        if (!this.initialized) return null;

        

        const startTime = performance.now();

        

        // Upload chunk voxels (use pre-allocated buffer)

        const voxelData = this._voxelData;

        const voxelSource = chunk.gpuBuffer ?? this.voxelBuffer;

        if (!chunk.gpuBuffer) {

            voxelData.fill(0);

            if (chunk.voxels) {

                for (let i = 0; i < chunk.voxels.length; i++) voxelData[i] = chunk.voxels[i];

            }

            this.device.queue.writeBuffer(this.voxelBuffer, 0, voxelData);

        }

        

        // Update params (use pre-allocated buffers)

        const origin = chunk.getWorldOrigin();

        this._paramsFloat[0] = origin[0]; this._paramsFloat[1] = origin[1]; this._paramsFloat[2] = origin[2];

        this._paramsInt[0] = sx; this._paramsInt[1] = sy; this._paramsInt[2] = sz; this._paramsInt[3] = chunk.gpuBuffer ? 1 : 0;

        this.device.queue.writeBuffer(this.paramsBuffer, 0, this._paramsBuffer);

        

        // Allocate output buffers from pool

        const maxVerts = this.maxFaces8 * 4;

        const maxIndices = this.maxFaces8 * 6;

        

        const vertexResult = this._getVertexBuffer(maxVerts);

        const indexResult = this._getIndexBuffer(maxIndices);

        const indirectBuffer = this._getIndirectBuffer();

        

        const vertexBuffer = vertexResult.buffer;

        const indexBuffer = indexResult.buffer;

        const vertexBucket = vertexResult.bucket;

        const indexBucket = indexResult.bucket;

        

        // Clear indirect buffer (use pre-allocated buffer)

        this.device.queue.writeBuffer(indirectBuffer, 0, this._indirectReset);

        

        // Create bind group

        const bindGroup = this.device.createBindGroup({

            layout: this.bindGroupLayout,

            entries: [

                { binding: 0, resource: { buffer: this.paramsBuffer } },

                { binding: 1, resource: { buffer: voxelSource } },

                { binding: 2, resource: { buffer: vertexBuffer } },

                { binding: 3, resource: { buffer: indexBuffer } },

                { binding: 4, resource: { buffer: indirectBuffer } },

            ],

        });

        

        // Dispatch compute

        const encoder = this.device.createCommandEncoder();

        const pass = encoder.beginComputePass();

        pass.setPipeline(this.mesh8Pipeline);

        pass.setBindGroup(0, bindGroup);

        pass.dispatchWorkgroups(1);  // Single workgroup for 8³

        pass.end();

        

        this.device.queue.submit([encoder.finish()]);

        

        // Read back index count

        const readbackBuffer = this.device.createBuffer({

            size: 4,

            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,

        });

        

        const copyEncoder = this.device.createCommandEncoder();

        copyEncoder.copyBufferToBuffer(indirectBuffer, 0, readbackBuffer, 0, 4);

        this.device.queue.submit([copyEncoder.finish()]);

        

        await readbackBuffer.mapAsync(GPUMapMode.READ);

        const indexCount = new Uint32Array(readbackBuffer.getMappedRange())[0];

        readbackBuffer.unmap();

        readbackBuffer.destroy();

        

        const meshTime = performance.now() - startTime;

        this.stats.mesh8Calls++;

        this.stats.totalTime += meshTime;

        

        // Report to metrics callback

        if (this.metricsCallback) {

            this.metricsCallback(8, meshTime, indexCount / 6);

        }

        

        return { vertexBuffer, indexBuffer, indexCount, indirectBuffer, vertexBucket, indexBucket };

    }

    

    /**

     * Get performance statistics

     */

    getStats() {

        const avg4 = this.stats.mesh4Calls > 0 ? 

            (this.stats.totalTime / (this.stats.mesh4Calls + this.stats.mesh8Calls)).toFixed(3) : 0;

        return {

            ...this.stats,

            avgTimeMs: avg4,

            mesh8Mode: this.mesh8Mode,

        };

    }

}



export default SubChunkMeshCompute;

