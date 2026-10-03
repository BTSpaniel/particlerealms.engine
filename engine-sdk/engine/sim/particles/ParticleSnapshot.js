// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleSnapshot.js - Time Rewind System for Particles
 * 
 * Enables rewinding particle simulation to any previous state.
 * Uses a circular buffer of GPU snapshots for efficient storage.
 * 
 * Features:
 * - Ring buffer of particle state snapshots (positions, velocities, meta)
 * - Emitter state history (spawn counts, positions, configs)
 * - Smooth interpolation between snapshots during playback
 * - Variable snapshot rate based on memory budget
 * 
 * Uses ParticleSchema.js for consistent snapshot data structures.
 */

import { createStorageBuffer, destroyBuffers } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";
import {
  PARTICLE_SYSTEM_SNAPSHOT_SCHEMA,
  EMITTER_SNAPSHOT_SCHEMA,
  createEmptySnapshot,
  createEmitterSnapshot,
  serializeSnapshot,
  deserializeSnapshot,
} from "./ParticleSchema.js";

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_HISTORY_SECONDS = 180; // 3 minutes
const DEFAULT_SNAPSHOT_INTERVAL = 0.001; // 1ms interval (1000 fps)
const MAX_HISTORY_FRAMES = 180000; // 3 minutes at 0.001s interval

// ============================================================================
// GPU SHADERS
// ============================================================================

const SNAPSHOT_COPY_SHADER = `
struct CopyParams {
    particleCount: u32,
    destOffset: u32,
    _pad: vec2<u32>,
}

@group(0) @binding(0) var<uniform> params: CopyParams;
@group(0) @binding(1) var<storage, read> srcPositions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> srcVelocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> srcMeta: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> historyBuffer: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> srcThermal: array<vec4<f32>>;

@compute @workgroup_size(256)
fn copyToHistory(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.particleCount) { return; }
    
    let baseIdx = params.destOffset + i * 4u;
    historyBuffer[baseIdx] = srcPositions[i];
    historyBuffer[baseIdx + 1u] = srcVelocities[i];
    historyBuffer[baseIdx + 2u] = srcMeta[i];
    historyBuffer[baseIdx + 3u] = srcThermal[i];
}
`;

const RESTORE_SHADER = `
struct RestoreParams {
    particleCount: u32,
    sourceOffset: u32,
    _pad: vec2<u32>,
}

@group(0) @binding(0) var<uniform> params: RestoreParams;
@group(0) @binding(1) var<storage, read> historyBuffer: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> dstPositions: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> dstVelocities: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> dstMeta: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> dstThermal: array<vec4<f32>>;

@compute @workgroup_size(256)
fn restoreFromHistory(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.particleCount) { return; }
    
    let baseIdx = params.sourceOffset + i * 4u;
    dstPositions[i] = historyBuffer[baseIdx];
    dstVelocities[i] = historyBuffer[baseIdx + 1u];
    dstMeta[i] = historyBuffer[baseIdx + 2u];
    dstThermal[i] = historyBuffer[baseIdx + 3u];
}
`;

const INTERPOLATE_SHADER = `
struct InterpolateParams {
    particleCount: u32,
    offsetA: u32,
    offsetB: u32,
    t: f32,
}

@group(0) @binding(0) var<uniform> params: InterpolateParams;
@group(0) @binding(1) var<storage, read> historyBuffer: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> dstPositions: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> dstVelocities: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> dstMeta: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> dstThermal: array<vec4<f32>>;

@compute @workgroup_size(256)
fn interpolateHistory(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.particleCount) { return; }
    
    let baseA = params.offsetA + i * 4u;
    let baseB = params.offsetB + i * 4u;
    
    let posA = historyBuffer[baseA];
    let posB = historyBuffer[baseB];
    let velA = historyBuffer[baseA + 1u];
    let velB = historyBuffer[baseB + 1u];
    let metaA = historyBuffer[baseA + 2u];
    let metaB = historyBuffer[baseB + 2u];
    let thermalA = historyBuffer[baseA + 3u];
    let thermalB = historyBuffer[baseB + 3u];
    
    dstPositions[i] = mix(posA, posB, params.t);
    dstVelocities[i] = mix(velA, velB, params.t);
    
    var metaOut = mix(metaA, metaB, params.t);
    metaOut.w = select(metaA.w, metaB.w, params.t > 0.5);
    dstMeta[i] = metaOut;
    
    // Interpolate temperature, snap phase/groupId/restDensity
    var thermalOut = vec4<f32>(mix(thermalA.x, thermalB.x, params.t), select(thermalA.y, thermalB.y, params.t > 0.5), select(thermalA.z, thermalB.z, params.t > 0.5), select(thermalA.w, thermalB.w, params.t > 0.5));
    dstThermal[i] = thermalOut;
}
`;

// ============================================================================
// EMITTER STATE CAPTURE/RESTORE
// ============================================================================

function captureEmitterState(emitters) {
    if (!emitters || !Array.isArray(emitters)) return [];
    
    return emitters.map(emitter => ({
        id: emitter.id,
        position: emitter.position ? [...emitter.position] : [0, 0, 0],
        rotation: emitter.rotation ? [...emitter.rotation] : [0, 0, 0, 1],
        scale: emitter.scale ?? 1,
        rate: emitter.rate ?? 100,
        enabled: emitter.enabled ?? true,
        totalSpawned: emitter.totalSpawned ?? 0,
        lifetime: emitter.lifetime ?? 2,
        speed: emitter.speed ?? 5,
        color: emitter.color ? [...emitter.color] : [1, 1, 1, 1],
        size: emitter.size ?? 0.1,
        behavior: emitter.behavior ?? 0,
        customData: emitter.customData ? { ...emitter.customData } : null,
    }));
}

function restoreEmitterState(emitters, snapshot) {
    if (!emitters || !snapshot) return;
    
    for (const saved of snapshot) {
        const emitter = emitters.find(e => e.id === saved.id);
        if (!emitter) continue;
        
        if (saved.position) emitter.position = [...saved.position];
        if (saved.rotation) emitter.rotation = [...saved.rotation];
        emitter.scale = saved.scale;
        emitter.rate = saved.rate;
        emitter.enabled = saved.enabled;
        emitter.totalSpawned = saved.totalSpawned;
        emitter.lifetime = saved.lifetime;
        emitter.speed = saved.speed;
        if (saved.color) emitter.color = [...saved.color];
        emitter.size = saved.size;
        emitter.behavior = saved.behavior;
        if (saved.customData) emitter.customData = { ...saved.customData };
    }
}

function interpolateEmitterState(emitters, snapshotA, snapshotB, t) {
    for (const emitter of emitters) {
        const a = snapshotA.find(e => e.id === emitter.id);
        const b = snapshotB.find(e => e.id === emitter.id);
        if (!a || !b) continue;
        
        if (a.position && b.position) {
            emitter.position = [
                a.position[0] + (b.position[0] - a.position[0]) * t,
                a.position[1] + (b.position[1] - a.position[1]) * t,
                a.position[2] + (b.position[2] - a.position[2]) * t,
            ];
        }
        
        if (a.rotation && b.rotation) {
            emitter.rotation = [
                a.rotation[0] + (b.rotation[0] - a.rotation[0]) * t,
                a.rotation[1] + (b.rotation[1] - a.rotation[1]) * t,
                a.rotation[2] + (b.rotation[2] - a.rotation[2]) * t,
                a.rotation[3] + (b.rotation[3] - a.rotation[3]) * t,
            ];
        }
        
        emitter.scale = a.scale + (b.scale - a.scale) * t;
        emitter.rate = a.rate + (b.rate - a.rate) * t;
        emitter.lifetime = a.lifetime + (b.lifetime - a.lifetime) * t;
        emitter.speed = a.speed + (b.speed - a.speed) * t;
        emitter.size = a.size + (b.size - a.size) * t;
        
        if (a.color && b.color) {
            emitter.color = [
                a.color[0] + (b.color[0] - a.color[0]) * t,
                a.color[1] + (b.color[1] - a.color[1]) * t,
                a.color[2] + (b.color[2] - a.color[2]) * t,
                a.color[3] + (b.color[3] - a.color[3]) * t,
            ];
        }
        
        emitter.enabled = t < 0.5 ? a.enabled : b.enabled;
        emitter.behavior = t < 0.5 ? a.behavior : b.behavior;
        emitter.totalSpawned = Math.round(a.totalSpawned + (b.totalSpawned - a.totalSpawned) * t);
    }
}

// ============================================================================
// SNAPSHOT SYSTEM
// ============================================================================

/**
 * Create particle snapshot system for time rewind
 */
export function createSnapshotSystem(device, maxParticles, options = {}) {
    const historySeconds = options.historySeconds || DEFAULT_HISTORY_SECONDS;
    const snapshotInterval = options.snapshotInterval || DEFAULT_SNAPSHOT_INTERVAL; // 0.0001s default
    const maxFrames = Math.min(Math.ceil(historySeconds / snapshotInterval), MAX_HISTORY_FRAMES);
    
    const vec4sPerParticle = 4; // pos, vel, meta, thermal
    const vec4sPerSnapshot = maxParticles * vec4sPerParticle;
    const bytesPerSnapshot = vec4sPerSnapshot * 16;
    const totalHistoryBytes = bytesPerSnapshot * maxFrames;
    
    console.log(`[ParticleSnapshot] Creating: ${maxFrames} frames, ${(totalHistoryBytes / 1024 / 1024).toFixed(1)}MB`);
    
    const historyBuffer = createStorageBuffer(device, totalHistoryBytes, {
        label: "ParticleSnapshot.history",
    });
    labelResource(historyBuffer, "ParticleSnapshot.history");
    
    const paramsBuffer = createStorageBuffer(device, 16, {
        label: "ParticleSnapshot.params",
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
    });
    labelResource(paramsBuffer, "ParticleSnapshot.params");
    
    const copyModule = device.createShaderModule({ label: "ParticleSnapshot.copy", code: SNAPSHOT_COPY_SHADER });
    const restoreModule = device.createShaderModule({ label: "ParticleSnapshot.restore", code: RESTORE_SHADER });
    const interpModule = device.createShaderModule({ label: "ParticleSnapshot.interp", code: INTERPOLATE_SHADER });
    
    const copyPipeline = device.createComputePipeline({
        label: "ParticleSnapshot.copyPipeline",
        layout: "auto",
        compute: { module: copyModule, entryPoint: "copyToHistory" },
    });
    
    const restorePipeline = device.createComputePipeline({
        label: "ParticleSnapshot.restorePipeline",
        layout: "auto",
        compute: { module: restoreModule, entryPoint: "restoreFromHistory" },
    });
    
    const interpolatePipeline = device.createComputePipeline({
        label: "ParticleSnapshot.interpolatePipeline",
        layout: "auto",
        compute: { module: interpModule, entryPoint: "interpolateHistory" },
    });
    
    return {
        device,
        historyBuffer,
        paramsBuffer,
        copyPipeline,
        restorePipeline,
        interpolatePipeline,
        
        maxParticles,
        maxFrames,
        snapshotInterval, // 0.0001s = 0.1ms
        vec4sPerSnapshot,
        
        writeIndex: 0,
        frameCount: 0,
        oldestFrame: 0,
        
        emitterHistory: new Array(maxFrames).fill(null),
        timestamps: new Float64Array(maxFrames),
        
        isRewinding: false,
        playbackFrame: 0,
        playbackSpeed: -1,
        
        copyBindGroup: null,
        restoreBindGroup: null,
        interpolateBindGroup: null,
        
        lastSnapshotTime: 0,
    };
}

/**
 * Initialize bind groups with particle buffers
 */
export function initSnapshotBindGroups(snapshot, positionBuffer, velocityBuffer, metaBuffer, thermalBuffer) {
    const device = snapshot.device;
    
    snapshot.copyBindGroup = device.createBindGroup({
        label: "ParticleSnapshot.copyBG",
        layout: snapshot.copyPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: snapshot.paramsBuffer } },
            { binding: 1, resource: { buffer: positionBuffer } },
            { binding: 2, resource: { buffer: velocityBuffer } },
            { binding: 3, resource: { buffer: metaBuffer } },
            { binding: 4, resource: { buffer: snapshot.historyBuffer } },
            { binding: 5, resource: { buffer: thermalBuffer } },
        ],
    });
    
    snapshot.restoreBindGroup = device.createBindGroup({
        label: "ParticleSnapshot.restoreBG",
        layout: snapshot.restorePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: snapshot.paramsBuffer } },
            { binding: 1, resource: { buffer: snapshot.historyBuffer } },
            { binding: 2, resource: { buffer: positionBuffer } },
            { binding: 3, resource: { buffer: velocityBuffer } },
            { binding: 4, resource: { buffer: metaBuffer } },
            { binding: 5, resource: { buffer: thermalBuffer } },
        ],
    });
    
    snapshot.interpolateBindGroup = device.createBindGroup({
        label: "ParticleSnapshot.interpBG",
        layout: snapshot.interpolatePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: snapshot.paramsBuffer } },
            { binding: 1, resource: { buffer: snapshot.historyBuffer } },
            { binding: 2, resource: { buffer: positionBuffer } },
            { binding: 3, resource: { buffer: velocityBuffer } },
            { binding: 4, resource: { buffer: metaBuffer } },
            { binding: 5, resource: { buffer: thermalBuffer } },
        ],
    });
    
    snapshot.positionBuffer = positionBuffer;
    snapshot.velocityBuffer = velocityBuffer;
    snapshot.metaBuffer = metaBuffer;
    snapshot.thermalBuffer = thermalBuffer;
}

/**
 * Take a snapshot of current state
 */
export function takeSnapshot(snapshot, emitters, currentTimeMs) {
    if (!snapshot || !snapshot.copyBindGroup) return;
    
    const device = snapshot.device;
    const frameIndex = snapshot.writeIndex;
    const destOffset = frameIndex * snapshot.vec4sPerSnapshot;
    
    const paramsData = new Uint32Array([snapshot.maxParticles, destOffset, 0, 0]);
    device.queue.writeBuffer(snapshot.paramsBuffer, 0, paramsData);
    
    const encoder = device.createCommandEncoder({ label: "ParticleSnapshot.take" });
    const pass = encoder.beginComputePass();
    pass.setPipeline(snapshot.copyPipeline);
    pass.setBindGroup(0, snapshot.copyBindGroup);
    pass.dispatchWorkgroups(Math.ceil(snapshot.maxParticles / 256));
    pass.end();
    device.queue.submit([encoder.finish()]);
    
    snapshot.emitterHistory[frameIndex] = captureEmitterState(emitters);
    snapshot.timestamps[frameIndex] = currentTimeMs;
    
    snapshot.writeIndex = (snapshot.writeIndex + 1) % snapshot.maxFrames;
    if (snapshot.frameCount < snapshot.maxFrames) {
        snapshot.frameCount++;
    } else {
        snapshot.oldestFrame = snapshot.writeIndex;
    }
    
    snapshot.lastSnapshotTime = currentTimeMs;
}

/**
 * Auto-snapshot based on interval (call every frame)
 */
export function autoSnapshot(snapshot, emitters, currentTimeMs) {
    if (!snapshot || snapshot.isRewinding) return;
    
    // snapshotInterval is in seconds (0.0001), convert to ms for comparison
    const intervalMs = snapshot.snapshotInterval * 1000;
    if (currentTimeMs - snapshot.lastSnapshotTime >= intervalMs) {
        takeSnapshot(snapshot, emitters, currentTimeMs);
    }
}

/**
 * Restore exact frame from history
 */
export function restoreFrame(snapshot, emitters, frameIndex) {
    if (!snapshot || !snapshot.restoreBindGroup) return false;
    if (frameIndex < 0 || frameIndex >= snapshot.frameCount) return false;
    
    const device = snapshot.device;
    const actualIndex = (snapshot.oldestFrame + frameIndex) % snapshot.maxFrames;
    const sourceOffset = actualIndex * snapshot.vec4sPerSnapshot;
    
    const paramsData = new Uint32Array([snapshot.maxParticles, sourceOffset, 0, 0]);
    device.queue.writeBuffer(snapshot.paramsBuffer, 0, paramsData);
    
    const encoder = device.createCommandEncoder({ label: "ParticleSnapshot.restore" });
    const pass = encoder.beginComputePass();
    pass.setPipeline(snapshot.restorePipeline);
    pass.setBindGroup(0, snapshot.restoreBindGroup);
    pass.dispatchWorkgroups(Math.ceil(snapshot.maxParticles / 256));
    pass.end();
    device.queue.submit([encoder.finish()]);
    
    const emitterSnap = snapshot.emitterHistory[actualIndex];
    if (emitterSnap) restoreEmitterState(emitters, emitterSnap);
    
    return true;
}

/**
 * Restore with interpolation between two frames
 */
export function restoreInterpolated(snapshot, emitters, frameA, frameB, t) {
    if (!snapshot || !snapshot.interpolateBindGroup) return false;
    if (frameA < 0 || frameB < 0 || frameA >= snapshot.frameCount || frameB >= snapshot.frameCount) return false;
    
    const device = snapshot.device;
    const actualA = (snapshot.oldestFrame + frameA) % snapshot.maxFrames;
    const actualB = (snapshot.oldestFrame + frameB) % snapshot.maxFrames;
    const offsetA = actualA * snapshot.vec4sPerSnapshot;
    const offsetB = actualB * snapshot.vec4sPerSnapshot;
    
    const paramsData = new ArrayBuffer(16);
    new Uint32Array(paramsData, 0, 3).set([snapshot.maxParticles, offsetA, offsetB]);
    new Float32Array(paramsData, 12, 1)[0] = Math.max(0, Math.min(1, t));
    device.queue.writeBuffer(snapshot.paramsBuffer, 0, new Uint8Array(paramsData));
    
    const encoder = device.createCommandEncoder({ label: "ParticleSnapshot.interp" });
    const pass = encoder.beginComputePass();
    pass.setPipeline(snapshot.interpolatePipeline);
    pass.setBindGroup(0, snapshot.interpolateBindGroup);
    pass.dispatchWorkgroups(Math.ceil(snapshot.maxParticles / 256));
    pass.end();
    device.queue.submit([encoder.finish()]);
    
    const emitterA = snapshot.emitterHistory[actualA];
    const emitterB = snapshot.emitterHistory[actualB];
    if (emitterA && emitterB && emitters) {
        interpolateEmitterState(emitters, emitterA, emitterB, t);
    }
    
    return true;
}

/**
 * Seek to a specific time in history
 */
export function seekToTime(snapshot, emitters, targetTimeMs) {
    if (!snapshot || snapshot.frameCount === 0) return false;
    
    let frameA = -1, frameB = -1;
    let timeA = 0, timeB = 0;
    
    for (let i = 0; i < snapshot.frameCount; i++) {
        const idx = (snapshot.oldestFrame + i) % snapshot.maxFrames;
        const t = snapshot.timestamps[idx];
        
        if (t <= targetTimeMs) {
            frameA = i;
            timeA = t;
        }
        if (t >= targetTimeMs && frameB === -1) {
            frameB = i;
            timeB = t;
            break;
        }
    }
    
    if (frameA === -1) frameA = 0;
    if (frameB === -1) frameB = snapshot.frameCount - 1;
    
    if (frameA === frameB || timeA === timeB) {
        return restoreFrame(snapshot, emitters, frameA);
    }
    
    const t = (targetTimeMs - timeA) / (timeB - timeA);
    return restoreInterpolated(snapshot, emitters, frameA, frameB, t);
}

/**
 * Start rewind mode
 */
export function startRewind(snapshot) {
    if (!snapshot || snapshot.frameCount === 0) return false;
    snapshot.isRewinding = true;
    snapshot.playbackFrame = snapshot.frameCount - 1;
    snapshot.playbackSpeed = -1;
    return true;
}

/**
 * Stop rewind and resume simulation
 */
export function stopRewind(snapshot) {
    if (!snapshot) return;
    snapshot.isRewinding = false;
}

/**
 * Step rewind playback (call each frame while rewinding)
 */
export function stepRewind(snapshot, emitters, dt) {
    if (!snapshot || !snapshot.isRewinding) return;
    
    // dt is in ms, snapshotInterval is in seconds (0.0001)
    // Calculate how many frames to step based on playback speed
    const frameStep = snapshot.playbackSpeed * (dt / 1000) / snapshot.snapshotInterval;
    snapshot.playbackFrame += frameStep;
    
    snapshot.playbackFrame = Math.max(0, Math.min(snapshot.frameCount - 1, snapshot.playbackFrame));
    
    const frameA = Math.floor(snapshot.playbackFrame);
    const frameB = Math.min(frameA + 1, snapshot.frameCount - 1);
    const t = snapshot.playbackFrame - frameA;
    
    if (frameA === frameB) {
        restoreFrame(snapshot, emitters, frameA);
    } else {
        restoreInterpolated(snapshot, emitters, frameA, frameB, t);
    }
    
    if (snapshot.playbackFrame <= 0 || snapshot.playbackFrame >= snapshot.frameCount - 1) {
        if (snapshot.playbackSpeed < 0 && snapshot.playbackFrame <= 0) {
            snapshot.playbackFrame = 0;
        }
    }
}

/**
 * Set playback speed (-1 = reverse, 1 = forward, 0.5 = slow forward, etc.)
 */
export function setPlaybackSpeed(snapshot, speed) {
    if (!snapshot) return;
    snapshot.playbackSpeed = speed;
}

/**
 * Get current playback info
 */
export function getSnapshotInfo(snapshot) {
    if (!snapshot) return null;
    
    return {
        frameCount: snapshot.frameCount,
        maxFrames: snapshot.maxFrames,
        isRewinding: snapshot.isRewinding,
        playbackFrame: snapshot.playbackFrame,
        playbackSpeed: snapshot.playbackSpeed,
        oldestTime: snapshot.frameCount > 0 ? snapshot.timestamps[snapshot.oldestFrame] : 0,
        newestTime: snapshot.frameCount > 0 ? snapshot.timestamps[(snapshot.writeIndex - 1 + snapshot.maxFrames) % snapshot.maxFrames] : 0,
        memoryMB: (snapshot.vec4sPerSnapshot * snapshot.maxFrames * 16) / 1024 / 1024,
    };
}

/**
 * Clear all history
 */
export function clearHistory(snapshot) {
    if (!snapshot) return;
    snapshot.writeIndex = 0;
    snapshot.frameCount = 0;
    snapshot.oldestFrame = 0;
    snapshot.emitterHistory.fill(null);
    snapshot.timestamps.fill(0);
    snapshot.playbackFrame = 0;
}

/**
 * Destroy snapshot system
 */
export function destroySnapshotSystem(snapshot) {
    if (!snapshot) return;
    destroyBuffers([snapshot.historyBuffer, snapshot.paramsBuffer]);
    snapshot.historyBuffer = null;
    snapshot.paramsBuffer = null;
    snapshot.emitterHistory = null;
}

export default {
    createSnapshotSystem,
    initSnapshotBindGroups,
    takeSnapshot,
    autoSnapshot,
    restoreFrame,
    restoreInterpolated,
    seekToTime,
    startRewind,
    stopRewind,
    stepRewind,
    setPlaybackSpeed,
    getSnapshotInfo,
    clearHistory,
    destroySnapshotSystem,
};
