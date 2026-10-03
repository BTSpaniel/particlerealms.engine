// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleEffects.js - Advanced particle system effects
 * 
 * Features:
 * - Line rendering between nearby particles
 * - Mouse interaction
 * - Curl noise turbulence
 * - Attractors/repellers
 * - Dissolve transitions
 * - Sub-emitters
 */

import { createStorageBuffer, createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { random } from '../../core/math/MathRandom.js';
import { degreesToRadians } from '../../core/math/UnitMath.js';
import { labelResource } from "../../core/gpu/GpuDebug.js";

// ============================================================================
// LINE RENDERING - GPU-generated connections between particles
// ============================================================================

const LINE_COMPUTE_SHADER = `
struct SimUniforms {
    viewProj: mat4x4<f32>,
    mouse: vec2<f32>,
    mouseActive: u32,
    particleCount: u32,
    bounds: f32,
    cellSize: f32,
    dt: f32,
    connectionDistance: f32,
    gridDims: vec3<u32>,
    cellCap: u32,
    maxLineVertices: u32,
    time: f32,
    _pad: vec2<f32>,
}

struct LineVertex {
    pos: vec4<f32>,
    color: vec4<f32>,
}

struct DrawIndirect {
    vertexCount: atomic<u32>,
    instanceCount: u32,
    firstVertex: u32,
    firstInstance: u32,
}

@group(0) @binding(0) var<uniform> sim: SimUniforms;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> cellCounts: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> cellIndices: array<u32>;
@group(0) @binding(5) var<storage, read_write> lineVertices: array<LineVertex>;
@group(0) @binding(6) var<storage, read_write> drawArgs: DrawIndirect;

fn hash01(x: u32) -> f32 {
    var v = x;
    v ^= v >> 16u;
    v *= 0x7feb352du;
    v ^= v >> 15u;
    v *= 0x846ca68bu;
    v ^= v >> 16u;
    return f32(v & 0x00FFFFFFu) / 16777215.0;
}

fn cellIndexFromPos(pos: vec3<f32>) -> u32 {
    let gd = sim.gridDims;
    let b = sim.bounds;
    let minp = vec3<f32>(-b, -b, -b);
    let p = clamp(pos, minp, -minp);
    let rel = (p - minp) / sim.cellSize;
    let cx = u32(clamp(floor(rel.x), 0.0, f32(gd.x - 1u)));
    let cy = u32(clamp(floor(rel.y), 0.0, f32(gd.y - 1u)));
    let cz = u32(clamp(floor(rel.z), 0.0, f32(gd.z - 1u)));
    return cx + cy * gd.x + cz * gd.x * gd.y;
}

fn cellCoordFromIndex(idx: u32) -> vec3<u32> {
    let gd = sim.gridDims;
    let plane = gd.x * gd.y;
    let z = idx / plane;
    let rem = idx - z * plane;
    let y = rem / gd.x;
    let x = rem - y * gd.x;
    return vec3<u32>(x, y, z);
}

fn cellIndexFromCoord(c: vec3<u32>) -> u32 {
    let gd = sim.gridDims;
    return c.x + c.y * gd.x + c.z * gd.x * gd.y;
}

@compute @workgroup_size(256)
fn clearGrid(@builtin(global_invocation_id) gid: vec3<u32>) {
    let gd = sim.gridDims;
    let cellCount = gd.x * gd.y * gd.z;
    let idx = gid.x;
    if (idx < cellCount) {
        atomicStore(&cellCounts[idx], 0u);
    }
}

@compute @workgroup_size(64)
fn clearCounters(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x == 0u) {
        atomicStore(&drawArgs.vertexCount, 0u);
        drawArgs.instanceCount = 1u;
        drawArgs.firstVertex = 0u;
        drawArgs.firstInstance = 0u;
    }
}

@compute @workgroup_size(256)
fn binParticles(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= sim.particleCount) {
        return;
    }
    // Dead particle early-out: don't bin dead particles
    let age = positions[i].w;
    let lifetime = velocities[i].w;
    if (age >= lifetime) { return; }

    let pos = positions[i].xyz;
    let ci = cellIndexFromPos(pos);
    let slot = atomicAdd(&cellCounts[ci], 1u);
    if (slot < sim.cellCap) {
        cellIndices[ci * sim.cellCap + slot] = i;
    }
}

@compute @workgroup_size(256)
fn generateLines(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= sim.particleCount) {
        return;
    }
    // Dead particle early-out: don't generate lines from dead particles
    let age = positions[i].w;
    let lifetime = velocities[i].w;
    if (age >= lifetime) { return; }

    if (atomicLoad(&drawArgs.vertexCount) >= sim.maxLineVertices) {
        return;
    }

    let p0 = positions[i].xyz;
    let cd = sim.connectionDistance;
    let cd2 = cd * cd;

    let cellIdx = cellIndexFromPos(p0);
    let baseCoord = cellCoordFromIndex(cellIdx);
    let gd = sim.gridDims;

    var made: u32 = 0u;
    let maxPerParticle: u32 = 4u;

    // Search neighboring cells
    for (var dz: i32 = -1; dz <= 1; dz = dz + 1) {
        for (var dy: i32 = -1; dy <= 1; dy = dy + 1) {
            for (var dx: i32 = -1; dx <= 1; dx = dx + 1) {
                if (made >= maxPerParticle) { break; }

                let nx = i32(baseCoord.x) + dx;
                let ny = i32(baseCoord.y) + dy;
                let nz = i32(baseCoord.z) + dz;

                if (nx < 0 || ny < 0 || nz < 0) { continue; }
                if (nx >= i32(gd.x) || ny >= i32(gd.y) || nz >= i32(gd.z)) { continue; }

                let nci = cellIndexFromCoord(vec3<u32>(u32(nx), u32(ny), u32(nz)));
                let count = min(atomicLoad(&cellCounts[nci]), sim.cellCap);

                for (var k: u32 = 0u; k < count; k = k + 1u) {
                    if (made >= maxPerParticle) { break; }

                    let j = cellIndices[nci * sim.cellCap + k];
                    if (j <= i) { continue; }

                    let p1 = positions[j].xyz;
                    let d = p0 - p1;
                    let dist2 = dot(d, d);
                    
                    if (dist2 < cd2) {
                        let dist = sqrt(max(dist2, 1e-6));
                        let t = clamp(1.0 - (dist / cd), 0.0, 1.0);
                        let opacity = t * t * 0.8;

                        let base = atomicAdd(&drawArgs.vertexCount, 2u);
                        if (base + 1u >= sim.maxLineVertices) { return; }
                        
                        // Cyan color for lines
                        lineVertices[base].pos = vec4<f32>(p0, 1.0);
                        lineVertices[base].color = vec4<f32>(0.0, 0.85, 1.0, opacity);
                        lineVertices[base + 1u].pos = vec4<f32>(p1, 1.0);
                        lineVertices[base + 1u].color = vec4<f32>(0.0, 0.85, 1.0, opacity);
                        made = made + 1u;
                    }
                }
            }
        }
    }
}
`;

const LINE_RENDER_SHADER = `
struct Uniforms {
    viewProj: mat4x4<f32>,
}

struct VertexInput {
    @location(0) position: vec4<f32>,
    @location(1) color: vec4<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.position = uniforms.viewProj * input.position;
    output.color = input.color;
    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    return input.color;
}
`;

// ============================================================================
// CURL NOISE - Turbulence fields for organic movement
// ============================================================================

const CURL_NOISE_SNIPPET = `
// Simplex noise helpers
fn mod289_3(x: vec3<f32>) -> vec3<f32> { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn mod289_4(x: vec4<f32>) -> vec4<f32> { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn permute(x: vec4<f32>) -> vec4<f32> { return mod289_4(((x * 34.0) + 1.0) * x); }
fn taylorInvSqrt(r: vec4<f32>) -> vec4<f32> { return 1.79284291400159 - 0.85373472095314 * r; }

fn snoise(v: vec3<f32>) -> f32 {
    let C = vec2<f32>(1.0/6.0, 1.0/3.0);
    let D = vec4<f32>(0.0, 0.5, 1.0, 2.0);

    var i = floor(v + dot(v, C.yyy));
    let x0 = v - i + dot(i, C.xxx);

    let g = step(x0.yzx, x0.xyz);
    let l = 1.0 - g;
    let i1 = min(g.xyz, l.zxy);
    let i2 = max(g.xyz, l.zxy);

    let x1 = x0 - i1 + C.xxx;
    let x2 = x0 - i2 + C.yyy;
    let x3 = x0 - D.yyy;

    i = mod289_3(i);
    let p = permute(permute(permute(
        i.z + vec4<f32>(0.0, i1.z, i2.z, 1.0))
        + i.y + vec4<f32>(0.0, i1.y, i2.y, 1.0))
        + i.x + vec4<f32>(0.0, i1.x, i2.x, 1.0));

    let n_ = 0.142857142857;
    let ns = n_ * D.wyz - D.xzx;

    let j = p - 49.0 * floor(p * ns.z * ns.z);

    let x_ = floor(j * ns.z);
    let y_ = floor(j - 7.0 * x_);

    let x = x_ * ns.x + ns.yyyy;
    let y = y_ * ns.x + ns.yyyy;
    let h = 1.0 - abs(x) - abs(y);

    let b0 = vec4<f32>(x.xy, y.xy);
    let b1 = vec4<f32>(x.zw, y.zw);

    let s0 = floor(b0) * 2.0 + 1.0;
    let s1 = floor(b1) * 2.0 + 1.0;
    let sh = -step(h, vec4<f32>(0.0));

    let a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    let a1 = b1.xzyw + s1.xzyw * sh.zzww;

    var p0 = vec3<f32>(a0.xy, h.x);
    var p1 = vec3<f32>(a0.zw, h.y);
    var p2 = vec3<f32>(a1.xy, h.z);
    var p3 = vec3<f32>(a1.zw, h.w);

    let norm = taylorInvSqrt(vec4<f32>(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    var m = max(0.6 - vec4<f32>(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), vec4<f32>(0.0));
    m = m * m;
    return 42.0 * dot(m * m, vec4<f32>(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

fn curlNoise(p: vec3<f32>) -> vec3<f32> {
    let e = 0.1;
    let dx = vec3<f32>(e, 0.0, 0.0);
    let dy = vec3<f32>(0.0, e, 0.0);
    let dz = vec3<f32>(0.0, 0.0, e);

    let p_x0 = snoise(p - dx);
    let p_x1 = snoise(p + dx);
    let p_y0 = snoise(p - dy);
    let p_y1 = snoise(p + dy);
    let p_z0 = snoise(p - dz);
    let p_z1 = snoise(p + dz);

    let x = (p_y1 - p_y0) - (p_z1 - p_z0);
    let y = (p_z1 - p_z0) - (p_x1 - p_x0);
    let z = (p_x1 - p_x0) - (p_y1 - p_y0);

    return normalize(vec3<f32>(x, y, z)) * 0.5;
}
`;

// ============================================================================
// ATTRACTORS & REPELLERS
// ============================================================================

const MAX_FORCE_POINTS = 16;

/**
 * Create force point buffer for attractors/repellers
 * Each force point: [x, y, z, strength] where negative = repel
 */
export function createForcePointBuffer(device, maxPoints = MAX_FORCE_POINTS) {
    const size = maxPoints * 16; // 4 floats * 4 bytes
    const buffer = createStorageBuffer(device, size, {
        label: "ParticleEffects.forcePoints",
    });
    labelResource(buffer, "ParticleEffects.forcePoints");
    return buffer;
}

/**
 * Update force points in the buffer
 */
export function updateForcePoints(device, buffer, forcePoints) {
    const data = new Float32Array(MAX_FORCE_POINTS * 4);
    for (let i = 0; i < Math.min(forcePoints.length, MAX_FORCE_POINTS); i++) {
        const fp = forcePoints[i];
        data[i * 4 + 0] = fp.x || 0;
        data[i * 4 + 1] = fp.y || 0;
        data[i * 4 + 2] = fp.z || 0;
        data[i * 4 + 3] = fp.strength || 0; // negative = repel
    }
    updateBuffer(device, buffer, data, 0);
}

const FORCE_POINTS_SNIPPET = `
struct ForcePoint {
    pos: vec3<f32>,
    strength: f32,
}

fn applyForcePoints(particlePos: vec3<f32>, forcePoints: array<ForcePoint, 16>, count: u32) -> vec3<f32> {
    var totalForce = vec3<f32>(0.0);
    for (var i = 0u; i < count; i = i + 1u) {
        let fp = forcePoints[i];
        let dir = fp.pos - particlePos;
        let dist = length(dir);
        if (dist > 0.1) {
            let falloff = 1.0 / (dist * dist + 0.1);
            totalForce += normalize(dir) * fp.strength * falloff;
        }
    }
    return totalForce;
}
`;

// ============================================================================
// DISSOLVE TRANSITIONS
// ============================================================================

/**
 * Calculate dissolve factor for fade in/out
 */
export function calculateDissolve(startTime, duration, direction = 'in') {
    const elapsed = (performance.now() - startTime) / 1000;
    const t = Math.min(1, elapsed / duration);
    return direction === 'in' ? t : 1 - t;
}

// ============================================================================
// SUB-EMITTERS
// ============================================================================

/**
 * Sub-emitter configuration
 */
export const SUB_EMITTER_EVENTS = {
    ON_DEATH: 'death',
    ON_COLLISION: 'collision',
    ON_LIFETIME: 'lifetime',
};

/**
 * Process sub-emitter spawning from dead particles
 * @deprecated Use GPU event system instead (ParticleEventSystem.js) for zero-frame latency.
 * This CPU fallback scans all slots and has 1-2 frame latency from GPU readback.
 */
export function processSubEmitters(particles, subEmitterConfig, currentTime) {
    if (!subEmitterConfig || !particles.slotInfo) return [];
    
    const newParticles = [];
    const slotInfo = particles.slotInfo;
    const positions = particles.positions;
    const maxSlots = particles.instanceCount || 0;
    
    for (let i = 0; i < maxSlots; i++) {
        const spawnTime = slotInfo[i * 2];
        const lifetime = slotInfo[i * 2 + 1];
        if (lifetime <= 0) continue;
        
        const age = currentTime - spawnTime;
        // Check if particle just died this frame (within one frame's dt)
        if (age >= lifetime && age < lifetime + 0.034) {
            const x = positions[i * 4];
            const y = positions[i * 4 + 1];
            const z = positions[i * 4 + 2];
            
            // Spawn sub-particles
            const count = subEmitterConfig.count || 3;
            for (let j = 0; j < count; j++) {
                newParticles.push({
                    position: [x, y, z],
                    velocity: [
                        (random() - 0.5) * subEmitterConfig.speed,
                        random() * subEmitterConfig.speed,
                        (random() - 0.5) * subEmitterConfig.speed,
                    ],
                    lifetime: subEmitterConfig.lifetime || 0.5,
                    size: subEmitterConfig.size || 0.1,
                    color: subEmitterConfig.color || [1, 0.5, 0],
                });
            }
        }
    }
    
    return newParticles;
}

// ============================================================================
// MOUSE INTERACTION
// ============================================================================

const MOUSE_INTERACTION_SNIPPET = `
fn applyMouseForce(particlePos: vec3<f32>, particleVel: vec3<f32>, viewProj: mat4x4<f32>, mouse: vec2<f32>, mouseActive: u32) -> vec3<f32> {
    if (mouseActive == 0u) {
        return vec3<f32>(0.0);
    }
    
    let clip = viewProj * vec4<f32>(particlePos, 1.0);
    if (clip.w < 0.1) {
        return vec3<f32>(0.0);
    }
    
    let ndc = clip.xy / clip.w;
    let dx = mouse.x - ndc.x;
    let dy = mouse.y - ndc.y;
    let d2 = dx * dx + dy * dy;
    
    if (d2 < 0.09) {
        let dist = sqrt(max(d2, 1e-6));
        let force = (0.3 - dist) / 0.3 * 0.8;
        return vec3<f32>(dx, dy, 0.0) * force;
    }
    
    return vec3<f32>(0.0);
}
`;

// ============================================================================
// TRAIL RENDERING
// ============================================================================

/**
 * Create trail history buffer
 * Stores N previous positions per particle for trail rendering
 */
export function createTrailBuffer(device, maxParticles, historyLength = 8) {
    // Each history entry: vec4<f32> (x, y, z, alpha)
    const size = maxParticles * historyLength * 16;
    const buffer = createStorageBuffer(device, size, {
        label: "ParticleEffects.trailHistory",
    });
    labelResource(buffer, "ParticleEffects.trailHistory");
    return { buffer, historyLength };
}

const TRAIL_UPDATE_SNIPPET = `
fn updateTrailHistory(particleIdx: u32, newPos: vec3<f32>, historyLength: u32, trailHistory: ptr<storage, array<vec4<f32>>, read_write>) {
    let baseIdx = particleIdx * historyLength;
    
    // Shift history back
    for (var i = historyLength - 1u; i > 0u; i = i - 1u) {
        (*trailHistory)[baseIdx + i] = (*trailHistory)[baseIdx + i - 1u];
    }
    
    // Insert new position
    (*trailHistory)[baseIdx] = vec4<f32>(newPos, 1.0);
}
`;

// ============================================================================
// TEXTURE ATLAS
// ============================================================================

/**
 * Particle texture atlas configuration
 */
export const PARTICLE_TEXTURES = {
    SOFT_CIRCLE: 0,
    SPARK: 1,
    SMOKE: 2,
    FIRE: 3,
    STAR: 4,
    RING: 5,
    DUST: 6,
    SNOW: 7,
};

/**
 * Generate a procedural particle texture atlas
 */
export function generateParticleAtlas(device, size = 512, tilesPerRow = 4) {
    const tileSize = size / tilesPerRow;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    // Clear to transparent
    ctx.clearRect(0, 0, size, size);
    
    const drawTile = (index, drawFunc) => {
        const x = (index % tilesPerRow) * tileSize;
        const y = Math.floor(index / tilesPerRow) * tileSize;
        ctx.save();
        ctx.translate(x + tileSize / 2, y + tileSize / 2);
        drawFunc(ctx, tileSize / 2 - 4);
        ctx.restore();
    };
    
    // Tile 0: Soft circle
    drawTile(0, (ctx, r) => {
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(0.5, 'rgba(255,255,255,0.5)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
    });
    
    // Tile 1: Spark
    drawTile(1, (ctx, r) => {
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.3);
        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
        ctx.fill();
    });
    
    // Tile 2: Smoke (soft blob)
    drawTile(2, (ctx, r) => {
        const gradient = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
        gradient.addColorStop(0, 'rgba(255,255,255,0.8)');
        gradient.addColorStop(0.6, 'rgba(255,255,255,0.3)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
    });
    
    // Tile 3: Fire
    drawTile(3, (ctx, r) => {
        const gradient = ctx.createRadialGradient(0, r * 0.3, 0, 0, 0, r);
        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(0.3, 'rgba(255,200,100,0.8)');
        gradient.addColorStop(0.7, 'rgba(255,100,0,0.4)');
        gradient.addColorStop(1, 'rgba(255,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.7, r, 0, 0, Math.PI * 2);
        ctx.fill();
    });
    
    // Tile 4: Star
    drawTile(4, (ctx, r) => {
        ctx.fillStyle = 'white';
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
            const angle = degreesToRadians(i * 72 - 90);
            const innerAngle = degreesToRadians((i * 72) + 36 - 90);
            if (i === 0) {
                ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
            } else {
                ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
            }
            ctx.lineTo(Math.cos(innerAngle) * r * 0.4, Math.sin(innerAngle) * r * 0.4);
        }
        ctx.closePath();
        ctx.fill();
    });
    
    // Tile 5: Ring
    drawTile(5, (ctx, r) => {
        ctx.strokeStyle = 'white';
        ctx.lineWidth = r * 0.2;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
        ctx.stroke();
    });
    
    // Tile 6: Dust
    drawTile(6, (ctx, r) => {
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.5);
        gradient.addColorStop(0, 'rgba(255,255,255,0.6)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
        ctx.fill();
    });
    
    // Tile 7: Snow
    drawTile(7, (ctx, r) => {
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        for (let i = 0; i < 6; i++) {
            const angle = degreesToRadians(i * 60);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(Math.cos(angle) * r * 0.8, Math.sin(angle) * r * 0.8);
            ctx.stroke();
        }
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.15, 0, Math.PI * 2);
        ctx.fill();
    });
    
    return canvas;
}

// ============================================================================
// GPU SORTING (Bitonic Sort for transparency)
// ============================================================================

const BITONIC_SORT_SHADER = `
struct SortParams {
    stageParam: u32,
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

    let ascending = (blockIdx % 2u) == 0u;

    let partner = i ^ pairDistance;

    if (partner > i && partner < params.particleCount) {
        let a = entries[i];
        let b = entries[partner];

        let shouldSwap = select(a.distance > b.distance, a.distance < b.distance, ascending);

        if (shouldSwap) {
            entries[i] = b;
            entries[partner] = a;
        }
    }
}
`;

// ============================================================================
// VOLUMETRIC LIGHTING
// ============================================================================

const VOLUMETRIC_LIGHTING_SNIPPET = `
fn sampleVolumetricLight(particlePos: vec3<f32>, lightPos: vec3<f32>, lightColor: vec3<f32>, density: f32, scattering: f32) -> vec3<f32> {
    let toLight = lightPos - particlePos;
    let dist = length(toLight);
    let lightDir = toLight / max(dist, 0.001);
    
    // Henyey-Greenstein phase function
    let g = 0.5; // anisotropy
    let cosTheta = dot(lightDir, vec3<f32>(0.0, 1.0, 0.0)); // view direction
    let phase = (1.0 - g * g) / (4.0 * 3.14159 * pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5));
    
    // Beer's law attenuation
    let attenuation = exp(-density * dist * 0.1);
    
    // Light intensity falloff
    let intensity = 1.0 / (1.0 + dist * dist * 0.01);
    
    return lightColor * phase * attenuation * intensity * scattering;
}
`;

// ============================================================================
// EXPORTS
// ============================================================================

export {
    LINE_COMPUTE_SHADER,
    LINE_RENDER_SHADER,
    CURL_NOISE_SNIPPET,
    FORCE_POINTS_SNIPPET,
    MOUSE_INTERACTION_SNIPPET,
    TRAIL_UPDATE_SNIPPET,
    BITONIC_SORT_SHADER,
    VOLUMETRIC_LIGHTING_SNIPPET,
    MAX_FORCE_POINTS,
};

export default {
    createForcePointBuffer,
    updateForcePoints,
    calculateDissolve,
    processSubEmitters,
    createTrailBuffer,
    generateParticleAtlas,
    PARTICLE_TEXTURES,
    SUB_EMITTER_EVENTS,
};
