// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleAdvanced.js - GPU Sorting, Chunked Buffers, Wire Constraints, SDF Collision
 * 
 * Advanced particle system features:
 * - Bitonic GPU sorting for transparency
 * - Chunked buffer management for 100M+ particles
 * - Wire/spring constraints between particles
 * - SDF mesh collision
 * - GPU particle seeding
 * - Volumetric lighting integration
 */

import { createStorageBuffer, createUniformBuffer, updateBuffer, destroyBuffers } from "../../core/gpu/GpuBuffer.js";
import { random } from '../../core/math/MathRandom.js';
import { LEGACY_PARTICLE_RUNTIME_PCG_WGSL, LEGACY_PCG32_WGSL } from "../../core/math/MathBits.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";
import { OGC_WGSL_MODULE } from '../physics/OGCContact.js';
import { getStructBufferSize, createAutoSizedUniformBuffer } from "../../core/gpu/VGPUShaderReflection.js";
import { parseWGSLStruct, createStructAccessor } from "../../core/gpu/WGSLStructLayout.js";

// Reusable buffers for hot paths (reduce/reuse/recycle)
const _sortParamsBuffer = new ArrayBuffer(32);
const _sortParamsU32 = new Uint32Array(_sortParamsBuffer);
const _sortParamsF32 = new Float32Array(_sortParamsBuffer);
const _stageStepU32 = new Uint32Array(1);
const _wireParamsF32 = new Float32Array(4);
const _sdfParamsF32 = new Float32Array(8); // particleCount, sdfCount, bounciness, friction, contactRadius, barrierStiffness, dt, usePerParticleSize
const _seedParamsF32 = new Float32Array(8);
const _volParamsF32 = new Float32Array(12);

// ============================================================================
// BITONIC GPU SORTING
// ============================================================================

const BITONIC_SORT_SHADER = `
struct SortParams {
    stageParam: u32,  // Combined stage/step info
    particleCount: u32,
    cameraX: f32,
    cameraY: f32,
    cameraZ: f32,
    _pad: vec3<f32>,
}

struct SortEntry {
    distance: f32,
    index: u32,
}

@group(0) @binding(0) var<uniform> params: SortParams;
@group(0) @binding(1) var<storage, read_write> entries: array<SortEntry>;
@group(0) @binding(2) var<storage, read> positions: array<vec4<f32>>;

@compute @workgroup_size(256)
fn computeDistances(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.particleCount) { return; }
    
    let pos = positions[i].xyz;
    let camPos = vec3<f32>(params.cameraX, params.cameraY, params.cameraZ);
    let dist = distance(pos, camPos);
    
    entries[i].distance = dist;
    entries[i].index = i;
}

@compute @workgroup_size(256)
fn bitonicStep(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.particleCount) { return; }
    
    let stage = params.stageParam >> 16u;
    let step = params.stageParam & 0xFFFFu;
    
    let pairDistance = 1u << (stage - step);
    let blockSize = 1u << (stage + 1u);
    
    let blockIdx = i / blockSize;
    let localIdx = i % blockSize;
    
    // Determine sort direction for this block
    let ascending = (blockIdx % 2u) == 0u;
    
    // Find partner index
    let partner = i ^ pairDistance;
    
    if (partner > i && partner < params.particleCount) {
        let a = entries[i];
        let b = entries[partner];
        
        // For back-to-front rendering, we want descending order (far to near)
        let shouldSwap = select(a.distance > b.distance, a.distance < b.distance, ascending);
        
        if (shouldSwap) {
            entries[i] = b;
            entries[partner] = a;
        }
    }
}
`;

/**
 * Create GPU sorting system for transparent particle rendering
 */
export function createGPUSortSystem(device, maxParticles) {
    const shaderModule = device.createShaderModule({
        label: "ParticleSort.shader",
        code: BITONIC_SORT_SHADER,
    });
    
    // Sort entries buffer: [distance, index] per particle
    const entriesBuffer = createStorageBuffer(device, maxParticles * 8, {
        label: "ParticleSort.entries",
    });
    
    // Sort params uniform buffer - auto-detect size from shader struct
    const paramsBufferSize = getStructBufferSize(BITONIC_SORT_SHADER, 'SortParams');
    const paramsBuffer = createUniformBuffer(device, paramsBufferSize, {
        label: "ParticleSort.params",
    });
    
    const computeDistancesPipeline = device.createComputePipeline({
        label: "ParticleSort.computeDistances",
        layout: "auto",
        compute: { module: shaderModule, entryPoint: "computeDistances" },
    });
    
    const bitonicStepPipeline = device.createComputePipeline({
        label: "ParticleSort.bitonicStep",
        layout: "auto",
        compute: { module: shaderModule, entryPoint: "bitonicStep" },
    });
    
    labelResource(entriesBuffer, "ParticleSort.entries");
    labelResource(paramsBuffer, "ParticleSort.params");
    
    return {
        shaderModule,
        entriesBuffer,
        paramsBuffer,
        computeDistancesPipeline,
        bitonicStepPipeline,
        maxParticles,
        bindGroup: null, // Created when positions buffer is available
    };
}

/**
 * Initialize sort bind group with position buffer
 */
export function initSortBindGroup(sortSystem, device, positionsBuffer) {
    sortSystem.bindGroup = device.createBindGroup({
        label: "ParticleSort.bindGroup",
        layout: sortSystem.computeDistancesPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: sortSystem.paramsBuffer } },
            { binding: 1, resource: { buffer: sortSystem.entriesBuffer } },
            { binding: 2, resource: { buffer: positionsBuffer } },
        ],
    });
}

/**
 * Execute GPU sort pass
 */
export function executeGPUSort(sortSystem, device, particleCount, cameraPos) {
    if (!sortSystem.bindGroup || particleCount === 0) return;
    
    // Update params - reuse module-level buffers
    const u32View = _sortParamsU32;
    const f32View = _sortParamsF32;
    u32View[0] = 0; // stageParam - updated per step
    u32View[1] = particleCount;
    f32View[2] = cameraPos[0];
    f32View[3] = cameraPos[1];
    f32View[4] = cameraPos[2];
    
    updateBuffer(device, sortSystem.paramsBuffer, f32View, 0);
    
    const encoder = device.createCommandEncoder({ label: "ParticleSort.encoder" });
    
    // First pass: compute distances
    {
        const pass = encoder.beginComputePass({ label: "ParticleSort.distances" });
        pass.setPipeline(sortSystem.computeDistancesPipeline);
        pass.setBindGroup(0, sortSystem.bindGroup);
        pass.dispatchWorkgroups(Math.ceil(particleCount / 256));
        pass.end();
    }
    
    // Bitonic sort passes
    const numStages = Math.ceil(Math.log2(particleCount));
    for (let stage = 0; stage < numStages; stage++) {
        for (let step = 0; step <= stage; step++) {
            // Update stage/step param - reuse buffer
            u32View[0] = (stage << 16) | step;
            _stageStepU32[0] = u32View[0];
            updateBuffer(device, sortSystem.paramsBuffer, _stageStepU32, 0);
            
            const pass = encoder.beginComputePass({ label: `ParticleSort.stage${stage}.step${step}` });
            pass.setPipeline(sortSystem.bitonicStepPipeline);
            pass.setBindGroup(0, sortSystem.bindGroup);
            pass.dispatchWorkgroups(Math.ceil(particleCount / 256));
            pass.end();
        }
    }
    
    device.queue.submit([encoder.finish()]);
}

// ============================================================================
// CHUNKED BUFFER MANAGEMENT
// ============================================================================

const MAX_CHUNKS = 4;
const CHUNK_SIZE_LIMIT = 128 * 1024 * 1024; // 128MB per chunk

/**
 * Create chunked particle buffer system for 100M+ particles
 */
export function createChunkedBufferSystem(device, maxParticles, bytesPerParticle = 16) {
    const totalBytes = maxParticles * bytesPerParticle;
    const numChunks = Math.min(MAX_CHUNKS, Math.ceil(totalBytes / CHUNK_SIZE_LIMIT));
    const particlesPerChunk = Math.ceil(maxParticles / numChunks);
    const bytesPerChunk = particlesPerChunk * bytesPerParticle;
    
    const chunks = [];
    for (let i = 0; i < numChunks; i++) {
        const actualParticles = Math.min(particlesPerChunk, maxParticles - i * particlesPerChunk);
        const actualBytes = actualParticles * bytesPerParticle;
        
        const buffer = createStorageBuffer(device, actualBytes, {
            label: `ParticleChunk.${i}`,
        });
        labelResource(buffer, `ParticleChunk.${i}`);
        
        chunks.push({
            buffer,
            particleCount: actualParticles,
            byteSize: actualBytes,
            startIndex: i * particlesPerChunk,
        });
    }
    
    console.log(`[ParticleAdvanced] Created ${numChunks} chunks for ${maxParticles} particles`);
    
    return {
        chunks,
        numChunks,
        particlesPerChunk,
        maxParticles,
        bytesPerParticle,
    };
}

/**
 * Get chunk index for a particle index
 */
export function getChunkForParticle(chunkedSystem, particleIndex) {
    return Math.floor(particleIndex / chunkedSystem.particlesPerChunk);
}

/**
 * Get local index within a chunk
 */
export function getLocalIndex(chunkedSystem, particleIndex) {
    return particleIndex % chunkedSystem.particlesPerChunk;
}

/**
 * Destroy chunked buffer system
 */
export function destroyChunkedBufferSystem(chunkedSystem) {
    if (!chunkedSystem) return;
    for (const chunk of chunkedSystem.chunks) {
        if (chunk.buffer) {
            chunk.buffer.destroy();
        }
    }
    chunkedSystem.chunks.length = 0;
}

// ============================================================================
// WIRE/SPRING CONSTRAINTS
// ============================================================================

const WIRE_CONSTRAINT_SHADER = `
struct WireParams {
    wireCount: u32,
    stiffness: f32,
    damping: f32,
    restLength: f32,
}

struct Wire {
    particleA: u32,
    particleB: u32,
    restLength: f32,
    stiffness: f32,
}

@group(0) @binding(0) var<uniform> params: WireParams;
@group(0) @binding(1) var<storage, read> wires: array<Wire>;
@group(0) @binding(2) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> velocities: array<vec4<f32>>;

@compute @workgroup_size(256)
fn solveConstraints(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.wireCount) { return; }
    
    let wire = wires[i];
    let posA = positions[wire.particleA].xyz;
    let posB = positions[wire.particleB].xyz;
    
    let delta = posB - posA;
    let dist = length(delta);
    
    if (dist < 0.001) { return; }
    
    let diff = (dist - wire.restLength) / dist;
    let correction = delta * diff * 0.5 * wire.stiffness;
    
    // Apply position correction
    positions[wire.particleA] = vec4<f32>(posA + correction, positions[wire.particleA].w);
    positions[wire.particleB] = vec4<f32>(posB - correction, positions[wire.particleB].w);
    
    // Apply velocity damping along constraint
    let velA = velocities[wire.particleA].xyz;
    let velB = velocities[wire.particleB].xyz;
    let relVel = velB - velA;
    let normalDir = delta / dist;
    let dampingForce = dot(relVel, normalDir) * params.damping * normalDir;
    
    velocities[wire.particleA] = vec4<f32>(velA + dampingForce * 0.5, velocities[wire.particleA].w);
    velocities[wire.particleB] = vec4<f32>(velB - dampingForce * 0.5, velocities[wire.particleB].w);
}
`;

/**
 * Create wire constraint system
 */
export function createWireConstraintSystem(device, maxWires = 10000) {
    const shaderModule = device.createShaderModule({
        label: "WireConstraint.shader",
        code: WIRE_CONSTRAINT_SHADER,
    });
    
    // Wire buffer: [particleA, particleB, restLength, stiffness] per wire
    const wireBuffer = createStorageBuffer(device, maxWires * 16, {
        label: "WireConstraint.wires",
    });
    
    const paramsBuffer = createUniformBuffer(device, 16, {
        label: "WireConstraint.params",
    });
    
    const pipeline = device.createComputePipeline({
        label: "WireConstraint.pipeline",
        layout: "auto",
        compute: { module: shaderModule, entryPoint: "solveConstraints" },
    });
    
    labelResource(wireBuffer, "WireConstraint.wires");
    labelResource(paramsBuffer, "WireConstraint.params");
    
    return {
        shaderModule,
        wireBuffer,
        paramsBuffer,
        pipeline,
        maxWires,
        wireCount: 0,
        bindGroup: null,
    };
}

/**
 * Add a wire constraint between two particles
 */
export function addWireConstraint(wireSystem, device, particleA, particleB, restLength, stiffness = 0.5) {
    if (wireSystem.wireCount >= wireSystem.maxWires) {
        console.warn("[WireConstraint] Max wires reached");
        return -1;
    }
    
    const wireData = new Float32Array([
        particleA, particleB, restLength, stiffness
    ]);
    
    const offset = wireSystem.wireCount * 16;
    updateBuffer(device, wireSystem.wireBuffer, wireData, offset);
    
    wireSystem.wireCount++;
    return wireSystem.wireCount - 1;
}

/**
 * Initialize wire constraint bind group
 */
export function initWireBindGroup(wireSystem, device, positionsBuffer, velocitiesBuffer) {
    wireSystem.bindGroup = device.createBindGroup({
        label: "WireConstraint.bindGroup",
        layout: wireSystem.pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: wireSystem.paramsBuffer } },
            { binding: 1, resource: { buffer: wireSystem.wireBuffer } },
            { binding: 2, resource: { buffer: positionsBuffer } },
            { binding: 3, resource: { buffer: velocitiesBuffer } },
        ],
    });
}

/**
 * Solve wire constraints
 */
export function solveWireConstraints(wireSystem, device, iterations = 4) {
    if (!wireSystem.bindGroup || wireSystem.wireCount === 0) return;
    
    // Update params - reuse buffer
    _wireParamsF32[0] = wireSystem.wireCount;
    _wireParamsF32[1] = 0.8;
    _wireParamsF32[2] = 0.1;
    _wireParamsF32[3] = 1.0;
    updateBuffer(device, wireSystem.paramsBuffer, _wireParamsF32, 0);
    
    const encoder = device.createCommandEncoder({ label: "WireConstraint.encoder" });
    
    for (let iter = 0; iter < iterations; iter++) {
        const pass = encoder.beginComputePass({ label: `WireConstraint.iter${iter}` });
        pass.setPipeline(wireSystem.pipeline);
        pass.setBindGroup(0, wireSystem.bindGroup);
        pass.dispatchWorkgroups(Math.ceil(wireSystem.wireCount / 256));
        pass.end();
    }
    
    device.queue.submit([encoder.finish()]);
}

// ============================================================================
// SDF MESH COLLISION (OGC-enhanced)
// ============================================================================

const SDF_COLLISION_SHADER = `
// OGC Contact Model - SIGGRAPH 2025
${OGC_WGSL_MODULE}

struct SDFParams {
    particleCount: u32,
    sdfCount: u32,
    bounciness: f32,
    friction: f32,
    contactRadius: f32,    // OGC contact offset radius (fallback if no per-particle size)
    barrierStiffness: f32, // OGC barrier stiffness
    dt: f32,               // Time step for barrier impulse
    time: f32,             // Global time for animated effects
}

struct SDFCollider {
    center: vec3<f32>,
    radius: f32,
    type_: u32,  // 0=sphere, 1=box, 2=cylinder
    halfExtents: vec3<f32>,
}

@group(0) @binding(0) var<uniform> params: SDFParams;
@group(0) @binding(1) var<storage, read> sdfColliders: array<SDFCollider>;
@group(0) @binding(2) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> particleMeta: array<vec4<f32>>;

// ============================================================================
// SDF PRIMITIVES (same as visual rendering in CustomParticleEffect.js)
// ============================================================================

fn sdSphere(p: vec3<f32>, r: f32) -> f32 {
    return length(p) - r;
}

fn sdBox(p: vec3<f32>, b: vec3<f32>) -> f32 {
    let q = abs(p) - b;
    return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn sdOctahedron(p: vec3<f32>, s: f32) -> f32 {
    let q = abs(p);
    return (q.x + q.y + q.z - s) * 0.57735027;
}

fn sdTorus(p: vec3<f32>, t: vec2<f32>) -> f32 {
    let q = vec2<f32>(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

fn sdCapsule(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, r: f32) -> f32 {
    let pa = p - a;
    let ba = b - a;
    let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
}

fn sdCylinder(p: vec3<f32>, h: f32, r: f32) -> f32 {
    let d = abs(vec2<f32>(length(p.xz), p.y)) - vec2<f32>(r, h);
    return min(max(d.x, d.y), 0.0) + length(max(d, vec2<f32>(0.0)));
}

fn sdCross(p: vec3<f32>, size: f32, thick: f32) -> f32 {
    let ax = abs(p.x);
    let ay = abs(p.y);
    let cross2d = min(ax, ay) - thick;
    let bounded = max(max(ax, ay) - size, abs(p.z) - thick);
    return max(cross2d, bounded);
}

// Smooth min for organic blending
fn smin(a: f32, b: f32, k: f32) -> f32 {
    let h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * k * 0.25;
}

${LEGACY_PCG32_WGSL}
${LEGACY_PARTICLE_RUNTIME_PCG_WGSL}

// Deterministic 3D noise hash (replaces fract-chain hash)
fn hash3(p: vec3<f32>) -> f32 {
    let seed = pcg_hash_sdf(bitcast<u32>(p.x) + pcg_hash_sdf(bitcast<u32>(p.y) + pcg_hash_sdf(bitcast<u32>(p.z))));
    return f32(seed) / 4294967295.0;
}

fn noise3(p: vec3<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(hash3(i), hash3(i + vec3<f32>(1.0, 0.0, 0.0)), u.x),
            mix(hash3(i + vec3<f32>(0.0, 1.0, 0.0)), hash3(i + vec3<f32>(1.0, 1.0, 0.0)), u.x), u.y),
        mix(mix(hash3(i + vec3<f32>(0.0, 0.0, 1.0)), hash3(i + vec3<f32>(1.0, 0.0, 1.0)), u.x),
            mix(hash3(i + vec3<f32>(0.0, 1.0, 1.0)), hash3(i + vec3<f32>(1.0, 1.0, 1.0)), u.x), u.y), u.z);
}

// ============================================================================
// PARTICLE SHAPE SDFs - Matches visual rendering shapes exactly
// Shape: 0=sphere, 1=point, 2=soft/smoke, 3=spark, 4=ring, 5=beam, 6=rune, 7=mist, 8=halo
// ============================================================================

fn particleShapeSDF(localPos: vec3<f32>, shape: u32, radius: f32, time: f32, age: f32) -> f32 {
    let p = localPos / radius;  // Normalize to unit space
    
    switch(shape) {
        // Shape 0: SPHERE - solid ball
        case 0u: {
            return sdSphere(p, 1.0) * radius;
        }
        // Shape 1: POINT - tiny concentrated dot (smaller collision)
        case 1u: {
            return sdSphere(p, 0.5) * radius;
        }
        // Shape 2: SOFT/SMOKE - organic noise-distorted cloud
        case 2u: {
            let noiseOffset = noise3(p * 3.0 + vec3<f32>(age * 0.3, 0.0, 0.0)) * 0.3;
            return (sdSphere(p, 1.2) - noiseOffset) * radius;
        }
        // Shape 3: SPARK/STAR - cross shape
        case 3u: {
            let cross = sdCross(p, 1.0, 0.3);
            let sphere = sdSphere(p, 0.5);
            return smin(cross, sphere, 0.2) * radius;
        }
        // Shape 4: RING - hollow torus
        case 4u: {
            return sdTorus(p, vec2<f32>(0.6, 0.2)) * radius;
        }
        // Shape 5: BEAM - vertical column
        case 5u: {
            return sdCylinder(p, 1.0, 0.3) * radius;
        }
        // Shape 6: RUNE - circle + cross glyph
        case 6u: {
            let circle = sdTorus(p, vec2<f32>(0.85, 0.1));
            let cross = sdCross(p, 0.7, 0.1);
            return min(circle, cross) * radius;
        }
        // Shape 7: MIST/FOG - large soft organic blob
        case 7u: {
            let noiseOffset = noise3(p * 2.0 + vec3<f32>(0.0, age * 0.2, 0.0)) * 0.4;
            return (sdSphere(p, 1.4) - noiseOffset) * radius;
        }
        // Shape 8: HALO - ring with soft glow
        case 8u: {
            let ring = sdTorus(p, vec2<f32>(0.7, 0.15));
            let glow = sdSphere(p, 0.9);
            return smin(ring, glow, 0.3) * radius;
        }
        // Default: sphere
        default: {
            return sdSphere(p, 1.0) * radius;
        }
    }
}

// ============================================================================
// EXTRACT PARTICLE PROPERTIES FROM PACKED META
// Packing: mass * 1e8 + drag * 1e6 + size * 1e4 + renderMode * 1e3 + shape * 10 + behavior
// ============================================================================

fn extractParticleSize(packedMeta: f32) -> f32 {
    let sizeEncoded = (floor(packedMeta / 1e4) % 100.0) * 0.1;
    // Match visual: particleSize * 0.5
    return max(0.05, sizeEncoded * 0.5);
}

fn extractParticleShape(packedMeta: f32) -> u32 {
    return u32(floor(packedMeta / 10.0)) % 10u;
}

// Get collision radius accounting for shape, age animation, and depth blend
fn getParticleCollisionRadius(packedMeta: f32, age: f32, lifetime: f32) -> f32 {
    let baseRadius = extractParticleSize(packedMeta);
    let shape = extractParticleShape(packedMeta);
    
    // Age-based size animation (matches vertex shader)
    let t = clamp(age / max(lifetime, 0.1), 0.0, 1.0);
    let fadeIn = smoothstep(0.0, 0.08, t);
    let fadeOut = 1.0 - smoothstep(0.9, 1.0, t);
    let sizeFactor = fadeIn * fadeOut * 0.9 + 0.1;
    
    // Shape-specific collision scale
    var shapeScale = 1.0;
    switch(shape) {
        case 1u: { shapeScale = 0.5; }  // Point - smaller
        case 2u: { shapeScale = 0.7; }  // Soft - penetrates more
        case 4u: { shapeScale = 0.6; }  // Ring - hollow
        case 7u: { shapeScale = 0.6; }  // Mist - very soft
        default: { shapeScale = 1.0; }
    }
    
    // Depth blend offset for soft edges
    let depthBlendOffset = 0.15;
    
    return baseRadius * sizeFactor * shapeScale * (1.0 - depthBlendOffset);
}

// ============================================================================
// WORLD SDF COLLIDERS (entities in the scene)
// ============================================================================

fn sdfSphereWorld(p: vec3<f32>, center: vec3<f32>, radius: f32) -> f32 {
    return length(p - center) - radius;
}

fn sdfBoxWorld(p: vec3<f32>, center: vec3<f32>, halfExtents: vec3<f32>) -> f32 {
    let d = abs(p - center) - halfExtents;
    return length(max(d, vec3<f32>(0.0))) + min(max(d.x, max(d.y, d.z)), 0.0);
}

fn sdfCylinderWorld(p: vec3<f32>, center: vec3<f32>, radius: f32, halfHeight: f32) -> f32 {
    let d = abs(vec2<f32>(length(p.xz - center.xz), p.y - center.y)) - vec2<f32>(radius, halfHeight);
    return min(max(d.x, d.y), 0.0) + length(max(d, vec2<f32>(0.0)));
}

// Gradient for world SDF colliders
fn sdfColliderGradient(p: vec3<f32>, sdf: SDFCollider) -> vec3<f32> {
    let e = 0.01;
    var d: f32;
    var dx: f32;
    var dy: f32;
    var dz: f32;
    
    if (sdf.type_ == 0u) {
        d = sdfSphereWorld(p, sdf.center, sdf.radius);
        dx = sdfSphereWorld(p + vec3<f32>(e, 0.0, 0.0), sdf.center, sdf.radius) - d;
        dy = sdfSphereWorld(p + vec3<f32>(0.0, e, 0.0), sdf.center, sdf.radius) - d;
        dz = sdfSphereWorld(p + vec3<f32>(0.0, 0.0, e), sdf.center, sdf.radius) - d;
    } else if (sdf.type_ == 1u) {
        d = sdfBoxWorld(p, sdf.center, sdf.halfExtents);
        dx = sdfBoxWorld(p + vec3<f32>(e, 0.0, 0.0), sdf.center, sdf.halfExtents) - d;
        dy = sdfBoxWorld(p + vec3<f32>(0.0, e, 0.0), sdf.center, sdf.halfExtents) - d;
        dz = sdfBoxWorld(p + vec3<f32>(0.0, 0.0, e), sdf.center, sdf.halfExtents) - d;
    } else {
        d = sdfCylinderWorld(p, sdf.center, sdf.radius, sdf.halfExtents.y);
        dx = sdfCylinderWorld(p + vec3<f32>(e, 0.0, 0.0), sdf.center, sdf.radius, sdf.halfExtents.y) - d;
        dy = sdfCylinderWorld(p + vec3<f32>(0.0, e, 0.0), sdf.center, sdf.radius, sdf.halfExtents.y) - d;
        dz = sdfCylinderWorld(p + vec3<f32>(0.0, 0.0, e), sdf.center, sdf.radius, sdf.halfExtents.y) - d;
    }
    
    return normalize(vec3<f32>(dx, dy, dz));
}

// Gradient for particle shape SDF
fn particleShapeGradient(localPos: vec3<f32>, shape: u32, radius: f32, time: f32, age: f32) -> vec3<f32> {
    let e = 0.01;
    let d = particleShapeSDF(localPos, shape, radius, time, age);
    let dx = particleShapeSDF(localPos + vec3<f32>(e, 0.0, 0.0), shape, radius, time, age) - d;
    let dy = particleShapeSDF(localPos + vec3<f32>(0.0, e, 0.0), shape, radius, time, age) - d;
    let dz = particleShapeSDF(localPos + vec3<f32>(0.0, 0.0, e), shape, radius, time, age) - d;
    return normalize(vec3<f32>(dx, dy, dz));
}

// ============================================================================
// VELOCITY-STRETCHED CAPSULE COLLISION (Motion Blur Collision)
// For fast-moving particles, use capsule from prev→current position
// ============================================================================

fn sdfCapsuleSwept(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, r: f32) -> f32 {
    let ab = b - a;
    let ap = p - a;
    let abLen2 = dot(ab, ab);
    var t = 0.0;
    if (abLen2 > 0.0001) {
        t = clamp(dot(ap, ab) / abLen2, 0.0, 1.0);
    }
    let closest = a + t * ab;
    return length(p - closest) - r;
}

// Evaluate SDF against swept capsule (for CCD)
fn evaluateSweptCollision(
    prevPos: vec3<f32>,
    currPos: vec3<f32>,
    radius: f32,
    colliderPos: vec3<f32>,
    colliderType: u32,
    colliderRadius: f32,
    colliderHalfExtents: vec3<f32>
) -> f32 {
    // Sample multiple points along the motion path
    var minDist = 1e10;
    for (var step = 0u; step < 4u; step++) {
        let t = f32(step) / 3.0;
        let samplePos = mix(prevPos, currPos, t);
        var dist: f32;
        if (colliderType == 0u) {
            dist = sdfSphereWorld(samplePos, colliderPos, colliderRadius);
        } else if (colliderType == 1u) {
            dist = sdfBoxWorld(samplePos, colliderPos, colliderHalfExtents);
        } else {
            dist = sdfCylinderWorld(samplePos, colliderPos, colliderRadius, colliderHalfExtents.y);
        }
        minDist = min(minDist, dist);
    }
    return minDist - radius;
}

// ============================================================================
// CONSERVATIVE DISPLACEMENT BOUNDS (CCD - Continuous Collision Detection)
// Prevents tunneling by limiting movement based on distance to obstacles
// ============================================================================

fn conservativeDisplacementBound(currentDist: f32, contactRadius: f32) -> f32 {
    let activationDist = 2.0 * contactRadius;
    if (currentDist >= activationDist) {
        return (currentDist - activationDist) * 0.5;
    }
    return max(0.0, currentDist * 0.25);
}

// ============================================================================
// MASS EXTRACTION from packed meta
// ============================================================================

fn extractMass(packedMeta: f32) -> f32 {
    let massEncoded = floor(packedMeta / 1e8) % 100.0;
    return max(0.1, massEncoded * 0.1);  // 0.1 to 9.9 range
}

@compute @workgroup_size(256)
fn collideWithSDF(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.particleCount) { return; }
    
    let age = positions[i].w;
    let lifetime = velocities[i].w;
    
    // Dead particle early-out: skip all SDF collision for particles past lifetime
    if (age >= lifetime) { return; }
    
    var pos = positions[i].xyz;
    var vel = velocities[i].xyz;
    
    // Get particle properties from meta buffer
    let pMeta = particleMeta[i];
    let shape = extractParticleShape(pMeta.w);
    let mass = extractMass(pMeta.w);
    let invMass = 1.0 / mass;
    
    // Get collision radius accounting for shape, age animation, and depth blend
    let r = getParticleCollisionRadius(pMeta.w, age, lifetime);
    let activationDist = 2.0 * r;
    let stiffness = params.barrierStiffness;
    let dt = params.dt;
    let time = params.time;
    
    // ========== SLEEPING/LOD OPTIMIZATION ==========
    // Skip detailed collision for particles near end of life or moving slowly
    let speed = length(vel);
    let lifeRatio = age / max(lifetime, 0.1);
    let isSleeping = (speed < 0.01 && lifeRatio > 0.8);
    
    // Near death - skip collision (no write needed, values unchanged)
    if (lifeRatio > 0.95) { return; }
    
    // ========== VELOCITY-STRETCHED COLLISION (CCD for fast particles) ==========
    let prevPos = pos - vel * dt;  // Approximate previous position
    let useCCD = (speed * dt > r * 0.5);  // Use CCD if moving more than half radius per frame
    
    for (var s = 0u; s < params.sdfCount; s = s + 1u) {
        let sdf = sdfColliders[s];
        var dist: f32;
        
        // Use swept collision for fast particles (CCD)
        if (useCCD) {
            dist = evaluateSweptCollision(prevPos, pos, r, sdf.center, sdf.type_, sdf.radius, sdf.halfExtents);
        } else {
            // Standard collision for slow particles
            if (sdf.type_ == 0u) {
                dist = sdfSphereWorld(pos, sdf.center, sdf.radius);
            } else if (sdf.type_ == 1u) {
                dist = sdfBoxWorld(pos, sdf.center, sdf.halfExtents);
            } else {
                dist = sdfCylinderWorld(pos, sdf.center, sdf.radius, sdf.halfExtents.y);
            }
        }
        
        // For non-sphere shapes, use shape-aware collision detection
        var effectiveRadius = r;
        if (shape != 0u && shape != 1u && !isSleeping) {
            let toSurface = sdfColliderGradient(pos, sdf);
            let localSample = toSurface * r;
            let shapeDist = particleShapeSDF(localSample, shape, r, time, age);
            effectiveRadius = r - shapeDist;
        }
        
        // OGC: Offset the distance by particle's effective collision radius
        let offsetDist = dist - effectiveRadius;
        
        if (offsetDist < activationDist) {
            let normal = sdfColliderGradient(pos, sdf);
            
            // ========== MASS-WEIGHTED POSITION CORRECTION ==========
            // Lighter particles get pushed more
            if (offsetDist < 0.0) {
                let massScale = min(invMass, 2.0);  // Cap at 2x for very light particles
                pos = pos + normal * (-offsetDist) * massScale;
            }
            
            // ========== CONSERVATIVE BOUNDS (prevent tunneling) ==========
            let maxDisplacement = conservativeDisplacementBound(offsetDist + effectiveRadius, effectiveRadius);
            let clampedVel = vel;
            let velTowardSurface = -dot(vel, normal);
            if (velTowardSurface > 0.0 && velTowardSurface * dt > maxDisplacement) {
                // Clamp velocity to not exceed safe displacement
                let safeSpeed = maxDisplacement / dt;
                let reduction = safeSpeed / velTowardSurface;
                vel = vel + normal * velTowardSurface * (1.0 - reduction);
            }
            
            // ========== OGC BARRIER FORCE (mass-weighted) ==========
            let forceMag = -ogcBarrierForce(offsetDist, effectiveRadius) * stiffness;
            let impulse = forceMag * dt * invMass;
            vel = vel + normal * impulse;
            
            // ========== PROPER FRICTION MODEL ==========
            // Separate normal (bounce) and tangent (friction) components
            if (offsetDist < effectiveRadius) {
                let velNormal = dot(vel, normal);
                let velTangent = vel - normal * velNormal;
                let tangentSpeed = length(velTangent);
                
                // Normal component: bounce with restitution (bounciness)
                let bounciness = params.bounciness;
                var newVelNormal = 0.0;
                if (velNormal < 0.0) {
                    // Moving into surface - reflect with bounciness
                    newVelNormal = -velNormal * bounciness;
                } else {
                    // Moving away from surface - keep velocity
                    newVelNormal = velNormal;
                }
                
                // Tangent component: apply Coulomb friction
                // Friction force = μ * normal force
                let frictionCoef = params.friction;
                let normalForce = abs(forceMag);
                let maxFriction = frictionCoef * normalForce * dt * invMass;
                
                var newVelTangent = velTangent;
                if (tangentSpeed > 0.001) {
                    let frictionReduction = min(maxFriction / tangentSpeed, 1.0);
                    newVelTangent = velTangent * (1.0 - frictionReduction);
                }
                
                vel = normal * newVelNormal + newVelTangent;
            }
        }
    }
    
    positions[i] = vec4<f32>(pos, positions[i].w);
    velocities[i] = vec4<f32>(vel, velocities[i].w);
}
`;

/**
 * Create SDF collision system
 */
export function createSDFCollisionSystem(device, initialCapacity = 64) {
    const shaderModule = device.createShaderModule({
        label: "SDFCollision.shader",
        code: SDF_COLLISION_SHADER,
    });
    
    // SDFCollider WGSL layout: center(vec3,off0) radius(f32,off12) type_(u32,off16) pad(12B) halfExtents(vec3,off32) pad(4B) = 48 bytes
    const COLLIDER_STRIDE = 48;
    const colliderBuffer = createStorageBuffer(device, initialCapacity * COLLIDER_STRIDE, {
        label: "SDFCollision.colliders",
    });
    
    // SDFParams: 8 floats (32 bytes) - particleCount, sdfCount, bounciness, friction, contactRadius, barrierStiffness, dt, usePerParticleSize
    const paramsBuffer = createUniformBuffer(device, 32, {
        label: "SDFCollision.params",
    });
    
    const pipeline = device.createComputePipeline({
        label: "SDFCollision.pipeline",
        layout: "auto",
        compute: { module: shaderModule, entryPoint: "collideWithSDF" },
    });
    
    labelResource(colliderBuffer, "SDFCollision.colliders");
    labelResource(paramsBuffer, "SDFCollision.params");
    
    // Single-collider staging buffer (shared underlying ArrayBuffer, zero alloc per addSDFCollider call)
    const singleBuf = new ArrayBuffer(COLLIDER_STRIDE);
    
    return {
        shaderModule,
        colliderBuffer,
        paramsBuffer,
        pipeline,
        maxColliders: initialCapacity,
        colliderCount: 0,
        bindGroup: null,
        colliders: [],
        COLLIDER_STRIDE,
        // Stored for auto-rebind after buffer grow
        _positionsBuffer: null,
        _velocitiesBuffer: null,
        _metaBuffer: null,
        // Cached staging buffers (avoid per-frame allocations)
        _stagingBuf: null,    // ArrayBuffer for rebuildSDFColliders
        _stagingF: null,      // Float32Array view
        _stagingU: null,      // Uint32Array view
        _stagingBytes: null,  // Uint8Array view for updateBuffer
        _stagingCap: 0,       // current staging capacity in colliders
        // Single-collider staging (all views share singleBuf)
        _singleF: new Float32Array(singleBuf),
        _singleU: new Uint32Array(singleBuf),
        _singleBytes: new Uint8Array(singleBuf),
    };
}

/**
 * Grow the collider buffer to fit the required count.
 * Destroys old buffer, creates larger one, and rebuilds bind group.
 */
function _growColliderBuffer(sdfSystem, device, requiredCount) {
    let newCap = sdfSystem.maxColliders;
    while (newCap < requiredCount) newCap *= 2;
    
    // Destroy old buffer
    if (sdfSystem.colliderBuffer) sdfSystem.colliderBuffer.destroy();
    
    const STRIDE = sdfSystem.COLLIDER_STRIDE || 48;
    sdfSystem.colliderBuffer = createStorageBuffer(device, newCap * STRIDE, {
        label: "SDFCollision.colliders",
    });
    labelResource(sdfSystem.colliderBuffer, "SDFCollision.colliders");
    sdfSystem.maxColliders = newCap;
    
    // Rebuild bind group if particle buffers are known
    if (sdfSystem._positionsBuffer) {
        initSDFBindGroup(sdfSystem, device, sdfSystem._positionsBuffer, sdfSystem._velocitiesBuffer, sdfSystem._metaBuffer);
    }
}

/**
 * Add an SDF collider
 */
export function addSDFCollider(sdfSystem, device, type, center, radius, halfExtents = [1, 1, 1]) {
    if (sdfSystem.colliderCount >= sdfSystem.maxColliders) {
        _growColliderBuffer(sdfSystem, device, sdfSystem.colliderCount + 1);
    }
    
    const typeCode = type === 'sphere' ? 0 : type === 'box' ? 1 : 2;
    // Reuse cached single-collider staging buffer (zero alloc)
    const f = sdfSystem._singleF;
    const u = sdfSystem._singleU;
    f[0] = center[0]; f[1] = center[1]; f[2] = center[2]; f[3] = radius;
    u[4] = typeCode;
    f[5] = 0; f[6] = 0; f[7] = 0; // clear padding
    f[8] = halfExtents[0]; f[9] = halfExtents[1]; f[10] = halfExtents[2];
    f[11] = 0; // clear padding
    
    const STRIDE = sdfSystem.COLLIDER_STRIDE || 48;
    const offset = sdfSystem.colliderCount * STRIDE;
    updateBuffer(device, sdfSystem.colliderBuffer, sdfSystem._singleBytes, offset);
    
    sdfSystem.colliderCount++;
    return sdfSystem.colliderCount - 1;
}

/**
 * Clear all SDF colliders (for per-frame rebuild from entity shapes)
 */
export function clearSDFColliders(sdfSystem) {
    if (!sdfSystem) return;
    sdfSystem.colliderCount = 0;
    sdfSystem.colliders.length = 0;
}

/**
 * Batch-write SDF colliders from an array of collider descriptors.
 * Much more efficient than calling addSDFCollider() in a loop.
 * @param {object} sdfSystem - SDF collision system
 * @param {GPUDevice} device - WebGPU device
 * @param {Array<{type: string, center: number[], radius: number, halfExtents: number[]}>} colliders
 */
export function rebuildSDFColliders(sdfSystem, device, colliders) {
    if (!sdfSystem || !device || !colliders) return;
    const STRIDE = sdfSystem.COLLIDER_STRIDE || 48;
    const count = colliders.length;
    if (count === 0) { sdfSystem.colliderCount = 0; return; }
    
    // Auto-grow GPU buffer if needed
    if (count > sdfSystem.maxColliders) {
        _growColliderBuffer(sdfSystem, device, count);
    }
    
    // Reuse cached staging buffer, only reallocate when capacity grows
    if (count > sdfSystem._stagingCap) {
        const totalBytes = count * STRIDE;
        sdfSystem._stagingBuf = new ArrayBuffer(totalBytes);
        sdfSystem._stagingF = new Float32Array(sdfSystem._stagingBuf);
        sdfSystem._stagingU = new Uint32Array(sdfSystem._stagingBuf);
        sdfSystem._stagingBytes = new Uint8Array(sdfSystem._stagingBuf);
        sdfSystem._stagingCap = count;
    }
    
    const f = sdfSystem._stagingF;
    const u = sdfSystem._stagingU;
    const floatsPerCollider = STRIDE / 4; // 12 floats per 48 bytes
    
    for (let i = 0; i < count; i++) {
        const c = colliders[i];
        const typeCode = c.type === 'sphere' ? 0 : c.type === 'box' ? 1 : 2;
        const base = i * floatsPerCollider;
        f[base + 0] = c.center[0]; f[base + 1] = c.center[1]; f[base + 2] = c.center[2];
        f[base + 3] = c.radius;
        u[base + 4] = typeCode;
        f[base + 8] = c.halfExtents[0]; f[base + 9] = c.halfExtents[1]; f[base + 10] = c.halfExtents[2];
    }
    
    // Upload only the bytes we wrote (subarray view, no alloc)
    updateBuffer(device, sdfSystem.colliderBuffer, sdfSystem._stagingBytes.subarray(0, count * STRIDE), 0);
    sdfSystem.colliderCount = count;
}

/**
 * Initialize SDF collision bind group
 * @param {object} sdfSystem - SDF collision system
 * @param {GPUDevice} device - WebGPU device
 * @param {GPUBuffer} positionsBuffer - Particle positions buffer
 * @param {GPUBuffer} velocitiesBuffer - Particle velocities buffer
 * @param {GPUBuffer} metaBuffer - Particle meta buffer (for per-particle size)
 */
export function initSDFBindGroup(sdfSystem, device, positionsBuffer, velocitiesBuffer, metaBuffer = null) {
    // Store refs for auto-rebind after buffer grow
    sdfSystem._positionsBuffer = positionsBuffer;
    sdfSystem._velocitiesBuffer = velocitiesBuffer;
    sdfSystem._metaBuffer = metaBuffer;
    
    const entries = [
        { binding: 0, resource: { buffer: sdfSystem.paramsBuffer } },
        { binding: 1, resource: { buffer: sdfSystem.colliderBuffer } },
        { binding: 2, resource: { buffer: positionsBuffer } },
        { binding: 3, resource: { buffer: velocitiesBuffer } },
    ];
    
    // Add meta buffer for per-particle size (required binding)
    if (metaBuffer) {
        entries.push({ binding: 4, resource: { buffer: metaBuffer } });
        sdfSystem.hasMetaBuffer = true;
    } else {
        // Create a dummy buffer if no meta buffer provided
        if (!sdfSystem.dummyMetaBuffer) {
            sdfSystem.dummyMetaBuffer = createStorageBuffer(device, 16, { label: "SDFCollision.dummyMeta" });
        }
        entries.push({ binding: 4, resource: { buffer: sdfSystem.dummyMetaBuffer } });
        sdfSystem.hasMetaBuffer = false;
    }
    
    sdfSystem.bindGroup = device.createBindGroup({
        label: "SDFCollision.bindGroup",
        layout: sdfSystem.pipeline.getBindGroupLayout(0),
        entries,
    });
}

/**
 * Execute SDF collision pass
 * @param {object} sdfSystem - SDF collision system
 * @param {GPUDevice} device - WebGPU device
 * @param {number} particleCount - Number of particles to process
 * @param {number} bounciness - Bounce coefficient (0-1)
 * @param {number} friction - Friction coefficient (0-1)
 * @param {object} options - Additional options { contactRadius, barrierStiffness, dt, usePerParticleSize }
 */
export function executeSDFCollision(sdfSystem, device, particleCount, bounciness = 0.3, friction = 0.1, options = {}) {
    if (!sdfSystem.bindGroup || sdfSystem.colliderCount === 0 || particleCount === 0) return;
    
    const contactRadius = options.contactRadius ?? 0.1;
    const barrierStiffness = options.barrierStiffness ?? 1e5;
    const dt = options.dt ?? (1/60);
    const time = options.time ?? 0;  // Global time for animated shape effects
    
    // Update params - reuse buffer
    // SDFParams: particleCount(u32), sdfCount(u32), bounciness, friction, contactRadius, barrierStiffness, dt, time
    const paramsU32 = new Uint32Array(_sdfParamsF32.buffer);
    paramsU32[0] = particleCount;
    paramsU32[1] = sdfSystem.colliderCount;
    _sdfParamsF32[2] = bounciness;
    _sdfParamsF32[3] = friction;
    _sdfParamsF32[4] = contactRadius;
    _sdfParamsF32[5] = barrierStiffness;
    _sdfParamsF32[6] = dt;
    _sdfParamsF32[7] = time;
    updateBuffer(device, sdfSystem.paramsBuffer, _sdfParamsF32, 0);
    
    const encoder = device.createCommandEncoder({ label: "SDFCollision.encoder" });
    const pass = encoder.beginComputePass({ label: "SDFCollision.pass" });
    pass.setPipeline(sdfSystem.pipeline);
    pass.setBindGroup(0, sdfSystem.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(particleCount / 256));
    pass.end();
    
    device.queue.submit([encoder.finish()]);
}

// ============================================================================
// GPU PARTICLE SEEDING
// ============================================================================

const SEED_PARTICLES_SHADER = `
struct SeedParams {
    particleCount: u32,
    seed: u32,
    spawnRadius: f32,
    initialSpeed: f32,
    spawnCenter: vec3<f32>,
    _pad: f32,
}

@group(0) @binding(0) var<uniform> params: SeedParams;
@group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>;

fn hash(x: u32) -> u32 {
    var v = x;
    v ^= v >> 16u;
    v *= 0x7feb352du;
    v ^= v >> 15u;
    v *= 0x846ca68bu;
    v ^= v >> 16u;
    return v;
}

fn hashFloat(x: u32) -> f32 {
    return f32(hash(x) & 0x00FFFFFFu) / 16777215.0;
}

@compute @workgroup_size(256)
fn seedParticles(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.particleCount) { return; }
    
    let baseSeed = params.seed + i * 7u;
    
    // Random position on sphere
    let theta = hashFloat(baseSeed) * 6.28318;
    let phi = acos(hashFloat(baseSeed + 1u) * 2.0 - 1.0);
    let r = pow(hashFloat(baseSeed + 2u), 0.333) * params.spawnRadius;
    
    let x = r * sin(phi) * cos(theta);
    let y = r * sin(phi) * sin(theta);
    let z = r * cos(phi);
    
    positions[i] = vec4<f32>(
        params.spawnCenter.x + x,
        params.spawnCenter.y + y,
        params.spawnCenter.z + z,
        1.0
    );
    
    // Random velocity
    let vx = (hashFloat(baseSeed + 3u) - 0.5) * params.initialSpeed;
    let vy = (hashFloat(baseSeed + 4u) - 0.5) * params.initialSpeed;
    let vz = (hashFloat(baseSeed + 5u) - 0.5) * params.initialSpeed;
    
    velocities[i] = vec4<f32>(vx, vy, vz, 0.0);
}
`;

/**
 * Create GPU particle seeding system
 */
export function createSeedingSystem(device) {
    const shaderModule = device.createShaderModule({
        label: "ParticleSeed.shader",
        code: SEED_PARTICLES_SHADER,
    });
    
    const paramsBuffer = createUniformBuffer(device, 32, {
        label: "ParticleSeed.params",
    });
    
    const pipeline = device.createComputePipeline({
        label: "ParticleSeed.pipeline",
        layout: "auto",
        compute: { module: shaderModule, entryPoint: "seedParticles" },
    });
    
    labelResource(paramsBuffer, "ParticleSeed.params");
    
    return {
        shaderModule,
        paramsBuffer,
        pipeline,
        bindGroup: null,
    };
}

/**
 * Initialize seeding bind group
 */
export function initSeedingBindGroup(seedSystem, device, positionsBuffer, velocitiesBuffer) {
    seedSystem.bindGroup = device.createBindGroup({
        label: "ParticleSeed.bindGroup",
        layout: seedSystem.pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: seedSystem.paramsBuffer } },
            { binding: 1, resource: { buffer: positionsBuffer } },
            { binding: 2, resource: { buffer: velocitiesBuffer } },
        ],
    });
}

/**
 * Seed particles on GPU
 */
export function seedParticlesGPU(seedSystem, device, particleCount, options = {}) {
    if (!seedSystem.bindGroup) return;
    
    const seed = options.seed || Math.floor(random() * 0xFFFFFFFF);
    const spawnRadius = options.spawnRadius || 10;
    const initialSpeed = options.initialSpeed || 1;
    const center = options.center || [0, 0, 0];
    
    // Reuse buffer - share backing ArrayBuffer for u32/f32 views
    const u32View = new Uint32Array(_seedParamsF32.buffer);
    u32View[0] = particleCount;
    u32View[1] = seed;
    _seedParamsF32[2] = spawnRadius;
    _seedParamsF32[3] = initialSpeed;
    _seedParamsF32[4] = center[0];
    _seedParamsF32[5] = center[1];
    _seedParamsF32[6] = center[2];
    _seedParamsF32[7] = 0;
    
    updateBuffer(device, seedSystem.paramsBuffer, _seedParamsF32, 0);
    
    const encoder = device.createCommandEncoder({ label: "ParticleSeed.encoder" });
    const pass = encoder.beginComputePass({ label: "ParticleSeed.pass" });
    pass.setPipeline(seedSystem.pipeline);
    pass.setBindGroup(0, seedSystem.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(particleCount / 256));
    pass.end();
    
    device.queue.submit([encoder.finish()]);
}

// ============================================================================
// VOLUMETRIC LIGHTING
// ============================================================================

const VOLUMETRIC_LIGHTING_SHADER = `
struct VolumetricParams {
    lightPos: vec3<f32>,
    lightIntensity: f32,
    lightColor: vec3<f32>,
    density: f32,
    scattering: f32,
    absorption: f32,
    particleCount: u32,
    _pad: f32,
}

struct LightContrib {
    color: vec3<f32>,
    intensity: f32,
}

@group(0) @binding(0) var<uniform> params: VolumetricParams;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> lightContribs: array<LightContrib>;
@group(0) @binding(3) var<storage, read> thermalData: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> velocities: array<vec4<f32>>;

// Henyey-Greenstein phase function
fn hgPhase(cosTheta: f32, g: f32) -> f32 {
    let g2 = g * g;
    let denom = 1.0 + g2 - 2.0 * g * cosTheta;
    return (1.0 - g2) / (4.0 * 3.14159 * pow(denom, 1.5));
}

// Thermal emission color: maps temperature to blackbody-like color
// Cool → red → orange → yellow → white → blue-white
fn thermalEmissionColor(temp: f32) -> vec3<f32> {
    let t = clamp((temp - 500.0) / 4500.0, 0.0, 1.0); // 500K to 5000K range
    let r = clamp(t * 3.0, 0.0, 1.0);
    let g = clamp((t - 0.2) * 2.0, 0.0, 1.0);
    let b = clamp((t - 0.5) * 2.5, 0.0, 1.0);
    return vec3<f32>(r, g, b);
}

@compute @workgroup_size(256)
fn computeLightContrib(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.particleCount) { return; }
    
    // Dead particle early-out: skip light computation for dead particles
    let age = positions[i].w;
    let lifetime = velocities[i].w;
    if (age >= lifetime) {
        lightContribs[i].color = vec3<f32>(0.0);
        lightContribs[i].intensity = 0.0;
        return;
    }
    
    let pos = positions[i].xyz;
    let toLight = params.lightPos - pos;
    let dist = length(toLight);
    let lightDir = toLight / max(dist, 0.001);
    
    // View direction (assuming camera at origin for simplicity)
    let viewDir = normalize(-pos);
    let cosTheta = dot(lightDir, viewDir);
    
    // Phase function with forward scattering
    let phase = hgPhase(cosTheta, 0.5);
    
    // Beer's law attenuation
    let attenuation = exp(-params.absorption * dist * 0.01);
    
    // Light falloff
    let falloff = params.lightIntensity / (1.0 + dist * dist * 0.01);
    
    let finalIntensity = phase * attenuation * falloff * params.scattering;
    var color = params.lightColor * finalIntensity;
    var totalIntensity = finalIntensity;
    
    // Thermal self-emission: hot particles (>500K) emit light proportional to temperature
    let temp = thermalData[i].x;
    if (temp > 500.0) {
        let emissionStrength = clamp((temp - 500.0) * 0.001, 0.0, 2.0);
        let emissionColor = thermalEmissionColor(temp);
        color += emissionColor * emissionStrength;
        totalIntensity += emissionStrength;
    }
    
    lightContribs[i].color = color;
    lightContribs[i].intensity = totalIntensity;
}
`;

/**
 * Create volumetric lighting system for particles
 */
export function createVolumetricLightingSystem(device, maxParticles) {
    const shaderModule = device.createShaderModule({
        label: "VolumetricLight.shader",
        code: VOLUMETRIC_LIGHTING_SHADER,
    });
    
    const paramsBuffer = createUniformBuffer(device, 48, {
        label: "VolumetricLight.params",
    });
    
    // Light contribution per particle: vec3 color + f32 intensity = 16 bytes
    const lightContribBuffer = createStorageBuffer(device, maxParticles * 16, {
        label: "VolumetricLight.contribs",
    });
    
    const pipeline = device.createComputePipeline({
        label: "VolumetricLight.pipeline",
        layout: "auto",
        compute: { module: shaderModule, entryPoint: "computeLightContrib" },
    });
    
    labelResource(paramsBuffer, "VolumetricLight.params");
    labelResource(lightContribBuffer, "VolumetricLight.contribs");
    
    return {
        shaderModule,
        paramsBuffer,
        lightContribBuffer,
        pipeline,
        maxParticles,
        bindGroup: null,
    };
}

/**
 * Initialize volumetric lighting bind group
 */
export function initVolumetricBindGroup(volSystem, device, positionsBuffer, thermalBuffer, velocitiesBuffer) {
    const entries = [
        { binding: 0, resource: { buffer: volSystem.paramsBuffer } },
        { binding: 1, resource: { buffer: positionsBuffer } },
        { binding: 2, resource: { buffer: volSystem.lightContribBuffer } },
        { binding: 3, resource: { buffer: thermalBuffer } },
    ];
    // Velocities buffer for dead particle early-out (lifetime stored in vel.w)
    if (velocitiesBuffer) {
        entries.push({ binding: 4, resource: { buffer: velocitiesBuffer } });
    }
    volSystem.bindGroup = device.createBindGroup({
        label: "VolumetricLight.bindGroup",
        layout: volSystem.pipeline.getBindGroupLayout(0),
        entries,
    });
}

/**
 * Compute volumetric lighting for particles
 */
export function computeVolumetricLighting(volSystem, device, particleCount, lightPos, lightColor, options = {}) {
    if (!volSystem.bindGroup || particleCount === 0) return;
    
    const intensity = options.intensity || 1.0;
    const density = options.density || 0.1;
    const scattering = options.scattering || 1.0;
    const absorption = options.absorption || 0.1;
    
    // Reuse buffer
    _volParamsF32[0] = lightPos[0];
    _volParamsF32[1] = lightPos[1];
    _volParamsF32[2] = lightPos[2];
    _volParamsF32[3] = intensity;
    _volParamsF32[4] = lightColor[0];
    _volParamsF32[5] = lightColor[1];
    _volParamsF32[6] = lightColor[2];
    _volParamsF32[7] = density;
    _volParamsF32[8] = scattering;
    _volParamsF32[9] = absorption;
    const u32View = new Uint32Array(_volParamsF32.buffer);
    u32View[10] = particleCount;
    _volParamsF32[11] = 0;
    
    updateBuffer(device, volSystem.paramsBuffer, _volParamsF32, 0);
    
    const encoder = device.createCommandEncoder({ label: "VolumetricLight.encoder" });
    const pass = encoder.beginComputePass({ label: "VolumetricLight.pass" });
    pass.setPipeline(volSystem.pipeline);
    pass.setBindGroup(0, volSystem.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(particleCount / 256));
    pass.end();
    
    device.queue.submit([encoder.finish()]);
}

// ============================================================================
// EXPORTS
// ============================================================================
// DEPTH BUFFER COLLISION - Particles collide with scene geometry via depth buffer
// ============================================================================

const DEPTH_COLLISION_SHADER = `
struct DepthCollisionParams {
    viewProj: mat4x4<f32>,
    invViewProj: mat4x4<f32>,
    resolution: vec2<f32>,
    particleCount: u32,
    dt: f32,
    bounciness: f32,
    friction: f32,
    particleRadius: f32,
    depthBias: f32,
    cameraPos: vec3<f32>,
    minCameraDist: f32,
}

@group(0) @binding(0) var<uniform> params: DepthCollisionParams;
@group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(3) var uDepth: texture_depth_2d;

// Project world position to screen pixel coords + NDC depth
fn worldToScreen(worldPos: vec3<f32>) -> vec3<f32> {
    let clip = params.viewProj * vec4<f32>(worldPos, 1.0);
    let ndc = clip.xyz / clip.w;
    // WebGPU NDC: x,y in [-1,1], z in [0,1]
    let screenX = (ndc.x * 0.5 + 0.5) * params.resolution.x;
    let screenY = (1.0 - (ndc.y * 0.5 + 0.5)) * params.resolution.y;
    return vec3<f32>(screenX, screenY, ndc.z);
}

// Unproject screen pixel + depth back to world space
fn screenToWorld(screenXY: vec2<f32>, depth: f32) -> vec3<f32> {
    let ndcX = screenXY.x / params.resolution.x * 2.0 - 1.0;
    let ndcY = 1.0 - screenXY.y / params.resolution.y * 2.0;
    let clip = params.invViewProj * vec4<f32>(ndcX, ndcY, depth, 1.0);
    return clip.xyz / clip.w;
}

@compute @workgroup_size(256)
fn depthCollide(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.particleCount) { return; }

    let age = positions[i].w;
    let lifetime = velocities[i].w;
    if (age >= lifetime) { return; }

    let pos = positions[i].xyz;
    let vel = velocities[i].xyz;

    // Project particle to screen
    let screen = worldToScreen(pos);
    let particleDepth = screen.z;

    // Out-of-frustum check
    if (particleDepth < 0.0 || particleDepth > 1.0) { return; }
    let px = vec2<i32>(screen.xy);
    let dims = textureDimensions(uDepth);
    if (px.x < 1 || px.y < 1 || px.x >= i32(dims.x) - 1 || px.y >= i32(dims.y) - 1) { return; }

    // Sample scene depth at particle's pixel
    let sceneDepth = textureLoad(uDepth, px, 0);

    // Penetration: particle is behind scene geometry when particleDepth > sceneDepth
    let penetration = particleDepth - sceneDepth;
    if (penetration <= params.depthBias) { return; }

    // Skip huge penetrations — camera inside a mesh creates shallow depth values,
    // making distant particles appear deeply penetrated. Only handle gentle contacts.
    if (penetration > 0.05) { return; }

    // Reconstruct surface point in world space
    let surfacePoint = screenToWorld(screen.xy, sceneDepth);

    // Skip collision when the surface is close to the camera (camera inside mesh).
    // The depth buffer shows mesh interior faces at short distances; all nearby
    // particles appear to penetrate, causing constant chaotic collision.
    let camDist = length(surfacePoint - params.cameraPos);
    if (camDist < params.minCameraDist) { return; }

    // Estimate surface normal from depth gradient (central differences, 1px offset)
    let dL = textureLoad(uDepth, px + vec2<i32>(-1, 0), 0);
    let dR = textureLoad(uDepth, px + vec2<i32>(1, 0), 0);
    let dU = textureLoad(uDepth, px + vec2<i32>(0, -1), 0);
    let dD = textureLoad(uDepth, px + vec2<i32>(0, 1), 0);

    let pL = screenToWorld(screen.xy + vec2<f32>(-1.0, 0.0), dL);
    let pR = screenToWorld(screen.xy + vec2<f32>(1.0, 0.0), dR);
    let pU = screenToWorld(screen.xy + vec2<f32>(0.0, -1.0), dU);
    let pD = screenToWorld(screen.xy + vec2<f32>(0.0, 1.0), dD);

    let tangentX = pR - pL;
    let tangentY = pD - pU;
    var normal = normalize(cross(tangentX, tangentY));

    // Ensure normal faces toward the camera (toward the particle)
    let toParticle = pos - surfacePoint;
    if (dot(normal, toParticle) < 0.0) {
        normal = -normal;
    }

    // Push particle to the surface + radius along normal
    let newPos = surfacePoint + normal * params.particleRadius;

    // Reflect velocity off surface
    let velDotN = dot(vel, normal);
    if (velDotN < 0.0) {
        // Decompose velocity into normal and tangent components
        let velN = normal * velDotN;
        let velT = vel - velN;
        let newVel = velT * (1.0 - params.friction) - velN * params.bounciness;
        velocities[i] = vec4<f32>(newVel, lifetime);
    }

    positions[i] = vec4<f32>(newPos, age);
}
`;

// Auto-compute struct layout from the WGSL definition (no manual offset math)
const _depthColLayout = parseWGSLStruct(DEPTH_COLLISION_SHADER);
const _depthColAccessor = createStructAccessor(_depthColLayout);

/**
 * Create depth buffer collision system.
 * Bind group is created separately via initDepthCollisionBindGroup (recreate on depth texture resize).
 */
export function createDepthCollisionSystem(device, maxParticles) {
    const shaderModule = device.createShaderModule({
        label: "DepthCollision.shader",
        code: DEPTH_COLLISION_SHADER,
    });

    const paramsBuffer = createUniformBuffer(device, _depthColLayout.size, {
        label: "DepthCollision.params",
    });
    labelResource(paramsBuffer, "DepthCollision.params");

    const pipeline = device.createComputePipeline({
        label: "DepthCollision.pipeline",
        layout: "auto",
        compute: { module: shaderModule, entryPoint: "depthCollide" },
    });

    console.log("[DepthCollision] Depth buffer collision system created");
    return {
        pipeline,
        paramsBuffer,
        maxParticles,
        bindGroup: null,
        _cachedDepthView: null,
    };
}

/**
 * Initialize or recreate the depth collision bind group.
 * Must be called whenever the depth texture changes (e.g., on window resize).
 */
export function initDepthCollisionBindGroup(system, device, positionsBuffer, velocitiesBuffer, depthTextureView) {
    if (!system || !depthTextureView) return;

    // Skip if texture view hasn't changed
    if (system._cachedDepthView === depthTextureView && system.bindGroup) return;
    system._cachedDepthView = depthTextureView;

    system.bindGroup = device.createBindGroup({
        label: "DepthCollision.bindGroup",
        layout: system.pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: system.paramsBuffer } },
            { binding: 1, resource: { buffer: positionsBuffer } },
            { binding: 2, resource: { buffer: velocitiesBuffer } },
            { binding: 3, resource: depthTextureView },
        ],
    });
}

/**
 * Execute depth buffer collision compute pass.
 * @param {Object} system - Depth collision system
 * @param {GPUDevice} device - WebGPU device
 * @param {number} particleCount - Number of particles to process
 * @param {Float32Array} viewProj - 4x4 view-projection matrix (column-major, 16 floats)
 * @param {Float32Array} invViewProj - 4x4 inverse view-projection matrix (column-major, 16 floats)
 * @param {Object} options - { resolution, dt, bounciness, friction, particleRadius, depthBias }
 */
export function executeDepthCollision(system, device, particleCount, viewProj, invViewProj, options = {}) {
    if (!system || !system.bindGroup || particleCount === 0) return;

    const resolution = options.resolution || [1920, 1080];
    const dt = options.dt || 1 / 60;
    const bounciness = options.bounciness ?? 0.3;
    const friction = options.friction ?? 0.2;
    const particleRadius = options.particleRadius ?? 0.05;
    const depthBias = options.depthBias ?? 0.0001;
    const cameraPos = options.cameraPos || [0, 0, 0];
    const minCameraDist = options.minCameraDist ?? 1.5;

    // Upload params using auto-struct accessor (offsets derived from WGSL definition)
    const data = new Float32Array(_depthColLayout.size / 4);
    _depthColAccessor.set(data, 'viewProj', viewProj);
    _depthColAccessor.set(data, 'invViewProj', invViewProj);
    _depthColAccessor.set(data, 'resolution', resolution);
    _depthColAccessor.set(data, 'particleCount', particleCount);
    _depthColAccessor.set(data, 'dt', dt);
    _depthColAccessor.set(data, 'bounciness', bounciness);
    _depthColAccessor.set(data, 'friction', friction);
    _depthColAccessor.set(data, 'particleRadius', particleRadius);
    _depthColAccessor.set(data, 'depthBias', depthBias);
    _depthColAccessor.set(data, 'cameraPos', cameraPos);
    _depthColAccessor.set(data, 'minCameraDist', minCameraDist);

    updateBuffer(device, system.paramsBuffer, data, 0);

    const encoder = device.createCommandEncoder({ label: "DepthCollision.encoder" });
    const pass = encoder.beginComputePass({ label: "DepthCollision.pass" });
    pass.setPipeline(system.pipeline);
    pass.setBindGroup(0, system.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(particleCount / 256));
    pass.end();
    device.queue.submit([encoder.finish()]);
}

// ============================================================================

export default {
    // GPU Sorting
    createGPUSortSystem,
    initSortBindGroup,
    executeGPUSort,
    
    // Chunked Buffers
    createChunkedBufferSystem,
    getChunkForParticle,
    getLocalIndex,
    destroyChunkedBufferSystem,
    
    // Wire Constraints
    createWireConstraintSystem,
    addWireConstraint,
    initWireBindGroup,
    solveWireConstraints,
    
    // SDF Collision
    createSDFCollisionSystem,
    addSDFCollider,
    initSDFBindGroup,
    executeSDFCollision,
    
    // GPU Seeding
    createSeedingSystem,
    initSeedingBindGroup,
    seedParticlesGPU,
    
    // Volumetric Lighting
    createVolumetricLightingSystem,
    initVolumetricBindGroup,
    computeVolumetricLighting,
    
    // Depth Buffer Collision
    createDepthCollisionSystem,
    initDepthCollisionBindGroup,
    executeDepthCollision,
};
