// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleSnapshotDelta.js - Delta-Compressed Particle State History
 * 
 * Like the WorldTimeline system, uses delta compression to store only changes:
 * - Keyframes: Full state snapshots at intervals
 * - Delta frames: Only particles that moved significantly
 * - No max frame limit - unlimited history with efficient storage
 * 
 * Compression approach:
 * - Track which particles changed since last frame
 * - Store only changed particle indices + their new state
 * - Periodic keyframes for random access
 */

import { createStorageBuffer, destroyBuffers, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";
import { readbackPositionsFromGPU, readbackVelocitiesFromGPU, readbackThermalFromGPU } from "./ParticleSimWorld.js";
import { crc32 } from "../../world/storage/VoxelCompression.js";
import { initAsyncSnapshotSystem } from "./AsyncSnapshotManager.js";

// Import compression utilities from dedicated module
import {
    runLengthEncode, runLengthDecode, packSmallIntegers, unpackSmallIntegers,
    computeCovarianceMatrix, powerIteration, dct1d, idct1d, quantizeDCT,
    quantizeFloat, dequantizeFloat, quantizePosition, quantizeVelocity,
    dequantizePosition, dequantizeVelocity, quantizePositionArray, quantizeVelocityArray,
    dequantizePositionArray, dequantizeVelocityArray,
    catmullRomInterpolate, hermiteInterpolate, entropyEncodeResiduals, entropyDecodeResiduals
} from './ParticleCompression.js';

import {
    packSignedRangeSNORMBits,
    packSignedRangeUNORMBits,
    unpackSignedRangeSNORMBits,
    unpackSignedRangeUNORMBits,
} from "../../core/math/MathPacking.js";
import { legacyFnv1aNumberSequenceHash32 } from "../../core/math/ChecksumMath.js";

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_SNAPSHOT_INTERVAL = 0.001; // 1ms interval - capture every frame for timeline sync
const KEYFRAME_INTERVAL = 60;            // Full keyframe every 60 delta frames
const POSITION_THRESHOLD = 0.01;         // Min change to record (increased from 0.001 to reduce data)
const VELOCITY_THRESHOLD = 0.1;          // Min velocity change (increased from 0.01)
const DEFAULT_MEMORY_BUDGET_MB = 512;    // 512MB budget for PCA+DCT compressed data

// Quantization ranges (must match ParticleCompression.js)
const POSITION_RANGE = 1000.0;
const VELOCITY_RANGE = 100.0;
const AGE_RANGE = 100.0;
const MIN_KEYFRAMES_TO_KEEP = 2;         // Always keep at least N keyframes for rewind
const PCA_WINDOW_SIZE = 128;             // Window size for PCA+DCT compression (from research paper)
const DCT_COEFFICIENT_RETENTION = 0.7;   // Retain 70% of DCT coefficients (balance compression vs quality)
const KEYFRAME_FORMAT = Object.freeze({ INT16: 1, LOSSLESS: 2, TIERED: 3 });

// ============================================================================
// ASYNC/BACKGROUND PROCESSING HELPERS
// ============================================================================

// Time budget for idle callbacks (ms) - stay well under 50ms limit
const IDLE_TIME_BUDGET_MS = 8;
// Chunk size for processing particles in batches
const PARTICLE_CHUNK_SIZE = 10000;

/**
 * Schedule work during browser idle time using requestIdleCallback
 * Falls back to setTimeout for environments without support
 */
const scheduleIdleWork = typeof requestIdleCallback !== 'undefined'
    ? (callback, options) => requestIdleCallback(callback, options)
    : (callback, options) => setTimeout(() => callback({ 
        didTimeout: false, 
        timeRemaining: () => IDLE_TIME_BUDGET_MS 
      }), 1);

const cancelIdleWork = typeof cancelIdleCallback !== 'undefined'
    ? (id) => cancelIdleCallback(id)
    : (id) => clearTimeout(id);

/**
 * Yield to event loop - allows UI to remain responsive
 */
function yieldToMain() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

function hasTimeRemaining(deadline) {
    if (!deadline) return true;
    if (deadline.didTimeout) return true;
    if (typeof deadline.timeRemaining !== 'function') return true;
    return deadline.timeRemaining() > 0;
}

function _keyframeHasPayload(frame) {
    if (!frame || !frame.isKeyframe) return false;
    const pos = frame._quantizedPositions || frame.positions;
    const vel = frame._quantizedVelocities || frame.velocities;
    return (pos instanceof Int16Array) && (vel instanceof Int16Array);
}

function _isOffloadedKeyframe(frame) {
    if (!frame || !frame.isKeyframe) return false;
    if (!frame._offloaded) return false;
    return !_keyframeHasPayload(frame);
}

function _lruGet(map, key) {
    if (!(map instanceof Map)) return null;
    const value = map.get(key);
    if (value != null) {
        map.delete(key);
        map.set(key, value);
    }
    return value ?? null;
}

function _lruSet(map, key, value, maxSize) {
    if (!(map instanceof Map)) return;
    map.delete(key);
    map.set(key, value);
    const max = Number.isFinite(maxSize) ? (maxSize | 0) : 0;
    if (max <= 0) {
        map.clear();
        return;
    }
    while (map.size > max) {
        const oldestKey = map.keys().next().value;
        map.delete(oldestKey);
    }
}

function _getLoadedKeyframe(snapshot, frameIndex) {
    if (!snapshot) return null;
    return _lruGet(snapshot._loadedKeyframesLRU, frameIndex);
}

function _putLoadedKeyframe(snapshot, frameIndex, frame) {
    if (!snapshot) return;
    _lruSet(snapshot._loadedKeyframesLRU, frameIndex, frame, snapshot.offloadCacheKeyframes);
}

function _scheduleKeyframeLoad(snapshot, frameIndex) {
    if (!snapshot || !snapshot.offloadEnabled) return;
    if (typeof snapshot._retrieveFrame !== 'function') return;
    if (!snapshot.frames || frameIndex < 0 || frameIndex >= snapshot.frames.length) return;

    const placeholder = snapshot.frames[frameIndex];
    if (!placeholder || !placeholder.isKeyframe) return;
    if (!_isOffloadedKeyframe(placeholder)) return;
    if (_getLoadedKeyframe(snapshot, frameIndex)) return;

    if (!(snapshot._keyframeLoadPromises instanceof Map)) {
        snapshot._keyframeLoadPromises = new Map();
    }

    const epoch = snapshot._historyEpoch || 0;
    const existing = snapshot._keyframeLoadPromises.get(frameIndex);
    if (existing && existing.epoch === epoch) return;

    const promise = (async () => {
        let raw = null;
        try {
            raw = await snapshot._retrieveFrame(frameIndex);
        } catch (e) {
            raw = null;
        }

        const currentEpoch = snapshot._historyEpoch || 0;
        if (currentEpoch !== epoch) {
            return null;
        }

        snapshot._keyframeLoadPromises.delete(frameIndex);

        if (!raw) return null;

        let loaded = null;
        if (typeof snapshot._ingestWorkerFrame === 'function') {
            loaded = snapshot._ingestWorkerFrame(raw);
        } else {
            loaded = raw;
        }

        if (!loaded) return null;

        const ph = snapshot.frames?.[frameIndex] || null;
        if (ph) {
            if (loaded.shaderState == null && ph.shaderState != null) loaded.shaderState = ph.shaderState;
            if (loaded.emitterStates == null && ph.emitterStates != null) loaded.emitterStates = ph.emitterStates;
            if (Number.isFinite(ph._integritySemantic) && ph._integritySemantic !== 0) loaded._integritySemantic = ph._integritySemantic;
            if (Number.isFinite(ph._integrityRaw) && ph._integrityRaw !== 0) loaded._integrityRaw = ph._integrityRaw;
            if (ph._offloaded) loaded._offloaded = ph._offloaded;
        }

        if (loaded.isKeyframe && !_keyframeHasPayload(loaded)) {
            return null;
        }
        if (!validateParticleKeyframeSchema(loaded)) {
            return null;
        }

        _putLoadedKeyframe(snapshot, frameIndex, loaded);
        return loaded;
    })();

    snapshot._keyframeLoadPromises.set(frameIndex, { epoch, promise });
}

function _maybeScheduleOffload(snapshot) {
    if (!snapshot || !snapshot.offloadEnabled) return;
    if (typeof snapshot._storeFrame !== 'function') return;
    if (!snapshot.frames || snapshot.frames.length === 0) return;
    if (snapshot._offloadScheduled || snapshot._offloadInFlight) return;

    let protectedMinKeyframeIndex = Infinity;
    let protectedCount = 0;
    for (let i = snapshot.frames.length - 1; i >= 0; i--) {
        const f = snapshot.frames[i];
        if (f && f.isKeyframe) {
            protectedMinKeyframeIndex = i;
            protectedCount++;
            if (protectedCount >= MIN_KEYFRAMES_TO_KEEP) break;
        }
    }

    const keepRecent = Math.max(0, snapshot.offloadKeepRecentFrames | 0);
    const limit = snapshot.frames.length - keepRecent;
    if (limit <= 0) return;

    let hasWork = false;
    for (let i = 0; i < limit; i++) {
        const f = snapshot.frames[i];
        if (i >= protectedMinKeyframeIndex) break;
        if (!f || !f.isKeyframe) continue;
        if (f._offloaded) continue;
        if (!_keyframeHasPayload(f)) continue;
        hasWork = true;
        break;
    }
    if (!hasWork) return;

    snapshot._offloadScheduled = true;
    scheduleIdleWork((deadline) => {
        (async () => {
            const epoch = snapshot._historyEpoch || 0;
            snapshot._offloadScheduled = false;
            snapshot._offloadInFlight = true;
            try {
                let protectedMin2 = Infinity;
                let protectedCount2 = 0;
                for (let j = snapshot.frames.length - 1; j >= 0; j--) {
                    const f2 = snapshot.frames[j];
                    if (f2 && f2.isKeyframe) {
                        protectedMin2 = j;
                        protectedCount2++;
                        if (protectedCount2 >= MIN_KEYFRAMES_TO_KEEP) break;
                    }
                }

                const keepRecent2 = Math.max(0, snapshot.offloadKeepRecentFrames | 0);
                const limit2 = snapshot.frames.length - keepRecent2;
                for (let i = 0; i < limit2; i++) {
                    if (!hasTimeRemaining(deadline)) break;
                    if ((snapshot._historyEpoch || 0) !== epoch) break;
                    const f = snapshot.frames[i];
                    if (i >= protectedMin2) break;
                    if (!f || !f.isKeyframe) continue;
                    if (f._offloaded) continue;
                    if (!_keyframeHasPayload(f)) continue;
                    const oldSize = (typeof f.getByteSize === 'function') ? f.getByteSize() : (f?.byteSize || 0);
                    let stored = false;
                    try {
                        stored = await snapshot._storeFrame(i, f);
                    } catch (e) {
                        stored = false;
                    }
                    if (!stored) continue;
                    f._offloaded = stored;

                    f.positions = null;
                    f.velocities = null;
                    f.meta = null;
                    f.slotInfo = null;
                    f.freeSlots = null;
                    f.liveIndices = null;
                    f._quantizedPositions = null;
                    f._quantizedVelocities = null;
                    f._positionResiduals = null;
                    f._velocityResiduals = null;
                    f._verifiedIntegrity = false;

                    const newSize = (typeof f.getByteSize === 'function') ? f.getByteSize() : (f?.byteSize || 0);
                    if (snapshot.stats && Number.isFinite(snapshot.stats.totalBytes)) {
                        snapshot.stats.totalBytes += (newSize - oldSize);
                    }
                }
            } finally {
                snapshot._offloadInFlight = false;
            }

            if ((snapshot._historyEpoch || 0) === epoch) {
                _maybeScheduleOffload(snapshot);
            }
        })();
    }, { timeout: 250 });
}

const _textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

function _u8View(typedArray) {
    if (!typedArray || !typedArray.buffer) return null;
    return new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
}

function _crcOf(value) {
    if (!value) return 0;
    const u8 = _u8View(value);
    if (u8) return crc32(u8);
    if (typeof value === 'string') {
        if (!_textEncoder) return 0;
        return crc32(_textEncoder.encode(value));
    }
    if (typeof value === 'number') {
        const b = new ArrayBuffer(8);
        const dv = new DataView(b);
        dv.setFloat64(0, value, true);
        return crc32(new Uint8Array(b));
    }
    try {
        if (!_textEncoder) return 0;
        return crc32(_textEncoder.encode(JSON.stringify(value)));
    } catch {
        return 0;
    }
}

function _hashEmitterStates(emitterStates) {
    if (!emitterStates || !Array.isArray(emitterStates) || emitterStates.length === 0) return 0;
    const strideBytes = 4 + (3 * 4) + (4 * 4) + 4 + 4 + 4;
    const buf = new ArrayBuffer(strideBytes * emitterStates.length);
    const dv = new DataView(buf);
    let o = 0;
    for (let i = 0; i < emitterStates.length; i++) {
        const s = emitterStates[i] || {};
        const id = s.id;
        const idHash = (typeof id === 'number') ? (id >>> 0) : _crcOf(String(id)) >>> 0;
        dv.setUint32(o, idHash, true); o += 4;
        const p = s.position || [0, 0, 0];
        dv.setFloat32(o, p[0] || 0, true); o += 4;
        dv.setFloat32(o, p[1] || 0, true); o += 4;
        dv.setFloat32(o, p[2] || 0, true); o += 4;
        const r = s.rotation || [0, 0, 0, 1];
        dv.setFloat32(o, r[0] || 0, true); o += 4;
        dv.setFloat32(o, r[1] || 0, true); o += 4;
        dv.setFloat32(o, r[2] || 0, true); o += 4;
        dv.setFloat32(o, (r[3] ?? 1), true); o += 4;
        dv.setFloat32(o, (s.scale ?? 1), true); o += 4;
        dv.setUint32(o, (s.enabled ? 1 : 0) >>> 0, true); o += 4;
        dv.setUint32(o, (s.totalSpawned ?? 0) >>> 0, true); o += 4;
    }
    return crc32(new Uint8Array(buf));
}

export function hashParticleKeyframe(frame) {
    if (!frame) return 0;
    const pos = frame._quantizedPositions || frame.positions;
    const vel = frame._quantizedVelocities || frame.velocities;
    const a = _crcOf(pos);
    const b = _crcOf(vel);
    const c = _crcOf(frame.meta);
    const d = _crcOf(frame.slotInfo);
    const e = _crcOf(frame.freeSlots);
    const f = _hashEmitterStates(frame.emitterStates);
    const g = _crcOf(frame.liveIndices);
    return legacyFnv1aNumberSequenceHash32([a, b, c, d, e, f, g]);
}

export function hashParticleKeyframeSemantic(frame, sampleVec4Count = 1024) {
    if (!frame || !frame.isKeyframe) return 0;
    const posQ = frame._quantizedPositions || frame.positions;
    const velQ = frame._quantizedVelocities || frame.velocities;
    if (!(posQ instanceof Int16Array) || !(velQ instanceof Int16Array)) return 0;

    const hp = _hashFloatSamplesFromQuantizedVec4(posQ, POSITION_RANGE, POSITION_RANGE, POSITION_RANGE, AGE_RANGE, sampleVec4Count);
    const hv = _hashFloatSamplesFromQuantizedVec4(velQ, VELOCITY_RANGE, VELOCITY_RANGE, VELOCITY_RANGE, AGE_RANGE, sampleVec4Count);
    const hm = _hashFloatSamplesFromFloat32(frame.meta, Math.min(sampleVec4Count * 4, 4096));
    const hs = _hashFloatSamplesFromFloat32(frame.slotInfo, Math.min(sampleVec4Count * 2, 4096));
    const hf = _hashU16Samples(frame.freeSlots, 2048);
    const he = _hashEmitterStates(frame.emitterStates);
    const hi = _hashU16Samples(frame.liveIndices, 2048);
    return legacyFnv1aNumberSequenceHash32([
        hp,
        hv,
        hm,
        hs,
        hf,
        he,
        hi,
        frame.particleCount ?? 0,
        frame.liveCount ?? 0,
        frame.instanceCount ?? 0,
    ]);
}

function validateParticleKeyframeSchema(frame) {
    if (!frame || !frame.isKeyframe) return true;
    const pos = frame._quantizedPositions || frame.positions;
    const vel = frame._quantizedVelocities || frame.velocities;
    if (!(pos instanceof Int16Array)) return false;
    if (!(vel instanceof Int16Array)) return false;
    if (frame.meta && !(frame.meta instanceof Float32Array)) return false;
    if (frame.slotInfo && !(frame.slotInfo instanceof Float32Array)) return false;
    if (frame.freeSlots && !(frame.freeSlots instanceof Uint16Array)) return false;
    if (frame.liveIndices && !(frame.liveIndices instanceof Uint16Array)) return false;
    return true;
}

function verifyParticleKeyframe(frame) {
    if (!frame || !frame.isKeyframe) return true;
    if (frame._verifiedIntegrity) return true;
    const expectedSemantic = frame._integritySemantic;
    const expectedRaw = frame._integrityRaw;
    if ((!Number.isFinite(expectedSemantic) || expectedSemantic === 0) && (!Number.isFinite(expectedRaw) || expectedRaw === 0)) {
        return true;
    }
    const actualSemantic = Number.isFinite(expectedSemantic) && expectedSemantic !== 0 ? hashParticleKeyframeSemantic(frame) : null;
    const actualRaw = Number.isFinite(expectedRaw) && expectedRaw !== 0 ? hashParticleKeyframe(frame) : null;
    const semanticOk = (actualSemantic == null) || (actualSemantic === expectedSemantic);
    const rawOk = (actualRaw == null) || (actualRaw === expectedRaw);
    if (!semanticOk || !rawOk) {
        if (!frame._warnedIntegrity) {
            frame._warnedIntegrity = true;
            console.warn('[ParticleSnapshot] keyframe integrity check failed', {
                timestamp: frame.timestamp,
                expectedSemantic,
                actualSemantic,
                expectedRaw,
                actualRaw,
            });
        }
        return false;
    }
    frame._verifiedIntegrity = true;
    return true;
}

const _hashScratch = {
    buf: new ArrayBuffer(4096),
};

function _ensureHashScratch(byteLength) {
    if (_hashScratch.buf.byteLength < byteLength) {
        _hashScratch.buf = new ArrayBuffer(Math.max(byteLength, _hashScratch.buf.byteLength * 2));
    }
    return _hashScratch.buf;
}

function _hashFloatSamplesFromQuantizedVec4(int16Vec4, r0, r1, r2, r3, sampleVec4Count) {
    if (!(int16Vec4 instanceof Int16Array) || int16Vec4.length < 4) return 0;
    const vecCount = Math.floor(int16Vec4.length / 4);
    const samples = Math.min(sampleVec4Count, vecCount);
    const bytesPerSample = 16;
    const buf = _ensureHashScratch(samples * bytesPerSample);
    const dv = new DataView(buf);

    for (let s = 0; s < samples; s++) {
        const vecIndex = (samples === 1) ? 0 : Math.floor((s * (vecCount - 1)) / (samples - 1));
        const base = vecIndex * 4;
        const o = s * bytesPerSample;
        dv.setFloat32(o + 0, dequantizeFloat(int16Vec4[base + 0], r0), true);
        dv.setFloat32(o + 4, dequantizeFloat(int16Vec4[base + 1], r1), true);
        dv.setFloat32(o + 8, dequantizeFloat(int16Vec4[base + 2], r2), true);
        dv.setFloat32(o + 12, dequantizeFloat(int16Vec4[base + 3], r3), true);
    }

    return crc32(new Uint8Array(buf, 0, samples * bytesPerSample));
}

function _hashFloatSamplesFromFloat32(float32Arr, sampleCount) {
    if (!(float32Arr instanceof Float32Array) || float32Arr.length === 0) return 0;
    const samples = Math.min(sampleCount, float32Arr.length);
    const bytesPerSample = 4;
    const buf = _ensureHashScratch(samples * bytesPerSample);
    const dv = new DataView(buf);

    for (let s = 0; s < samples; s++) {
        const idx = (samples === 1) ? 0 : Math.floor((s * (float32Arr.length - 1)) / (samples - 1));
        dv.setFloat32(s * 4, float32Arr[idx], true);
    }

    return crc32(new Uint8Array(buf, 0, samples * bytesPerSample));
}

function _hashU16Samples(uint16Arr, sampleCount) {
    if (!(uint16Arr instanceof Uint16Array) || uint16Arr.length === 0) return 0;
    const samples = Math.min(sampleCount, uint16Arr.length);
    const bytesPerSample = 2;
    const buf = _ensureHashScratch(samples * bytesPerSample);
    const dv = new DataView(buf);

    for (let s = 0; s < samples; s++) {
        const idx = (samples === 1) ? 0 : Math.floor((s * (uint16Arr.length - 1)) / (samples - 1));
        dv.setUint16(s * 2, uint16Arr[idx], true);
    }

    return crc32(new Uint8Array(buf, 0, samples * bytesPerSample));
}

// ============================================================================
// ADVANCED COMPRESSION HELPERS
// ============================================================================

/**
 * Run-Length Encode an array of indices (compress consecutive sequences)
 * Returns: { runs: [[startIdx, count], ...], singles: [idx, ...] }
 */
// Compression utilities moved to ParticleCompression.js

function advancedInterpolate(snapshot, particleState, emitters, frameA, frameB, t) {
    // Get surrounding frames for Catmull-Rom (if available)
    const frameBefore = frameA > 0 ? frameA - 1 : frameA;
    const frameAfter = frameB < snapshot.frames.length - 1 ? frameB + 1 : frameB;
    
    const stateA = reconstructState(snapshot, frameA);
    const stateB = reconstructState(snapshot, frameB);
    if (!stateA || !stateB) return false;
    
    // Check if we have enough frames for Catmull-Rom
    const useCatmullRom = frameBefore !== frameA && frameAfter !== frameB;
    
    if (useCatmullRom) {
        const stateBefore = reconstructState(snapshot, frameBefore);
        const stateAfter = reconstructState(snapshot, frameAfter);
        
        if (stateBefore && stateAfter) {
            const ok = interpolateCatmullRom(particleState, stateBefore, stateA, stateB, stateAfter, t);
            if (ok) {
                interpolateEmitterState(emitters, stateA.emitterStates, stateB.emitterStates, t);
            }
            return ok;
        }
    }
    
    // Fallback to Hermite (velocity-aware) or simple lerp
    const ok = interpolateHermite(particleState, stateA, stateB, t);
    if (ok) {
        interpolateEmitterState(emitters, stateA.emitterStates, stateB.emitterStates, t);
    }
    return ok;
}

/**
 * Catmull-Rom interpolation for particle positions
 */
function interpolateCatmullRom(particleState, s0, s1, s2, s3, t) {
    const { positions, velocities, meta } = particleState;
    const count = Math.min(s1.positions.length, s2.positions.length);
    
    // Apply smootherstep easing for natural motion
    const easedT = EASING.smootherstep(t);
    
    for (let i = 0; i < count; i += 4) {
        // Interpolate x, y, z with Catmull-Rom
        if (positions) {
            positions[i] = catmullRomInterpolate(s0.positions[i], s1.positions[i], s2.positions[i], s3.positions[i], easedT);
            positions[i + 1] = catmullRomInterpolate(s0.positions[i + 1], s1.positions[i + 1], s2.positions[i + 1], s3.positions[i + 1], easedT);
            positions[i + 2] = catmullRomInterpolate(s0.positions[i + 2], s1.positions[i + 2], s2.positions[i + 2], s3.positions[i + 2], easedT);
            positions[i + 3] = s1.positions[i + 3] + (s2.positions[i + 3] - s1.positions[i + 3]) * easedT; // Age: linear
        }
        
        // Velocities: Hermite interpolation (physics-aware)
        if (velocities && s1.velocities && s2.velocities) {
            velocities[i] = hermiteInterpolate(s1.positions[i], s2.positions[i], s1.velocities[i], s2.velocities[i], easedT);
            velocities[i + 1] = hermiteInterpolate(s1.positions[i + 1], s2.positions[i + 1], s1.velocities[i + 1], s2.velocities[i + 1], easedT);
            velocities[i + 2] = hermiteInterpolate(s1.positions[i + 2], s2.positions[i + 2], s1.velocities[i + 2], s2.velocities[i + 2], easedT);
            velocities[i + 3] = s1.velocities[i + 3] + (s2.velocities[i + 3] - s1.velocities[i + 3]) * easedT; // Lifetime: linear
        }
        
        // Meta: linear interpolation
        if (meta && s1.meta && s2.meta) {
            meta[i] = s1.meta[i] + (s2.meta[i] - s1.meta[i]) * easedT;
            meta[i + 1] = s1.meta[i + 1] + (s2.meta[i + 1] - s1.meta[i + 1]) * easedT;
            meta[i + 2] = s1.meta[i + 2] + (s2.meta[i + 2] - s1.meta[i + 2]) * easedT;
            meta[i + 3] = s1.meta[i + 3] + (s2.meta[i + 3] - s1.meta[i + 3]) * easedT;
        }
    }
    
    return syncToGPU(particleState, s1, s2, t);
}

/**
 * Hermite interpolation using velocity data
 */
function interpolateHermite(particleState, s1, s2, t) {
    const { positions, velocities, meta } = particleState;
    const count = Math.min(s1.positions.length, s2.positions.length);
    
    const easedT = EASING.smootherstep(t);
    
    for (let i = 0; i < count; i += 4) {
        if (positions && velocities && s1.velocities && s2.velocities) {
            // Use velocity for Hermite interpolation
            positions[i] = hermiteInterpolate(s1.positions[i], s2.positions[i], s1.velocities[i], s2.velocities[i], easedT);
            positions[i + 1] = hermiteInterpolate(s1.positions[i + 1], s2.positions[i + 1], s1.velocities[i + 1], s2.velocities[i + 1], easedT);
            positions[i + 2] = hermiteInterpolate(s1.positions[i + 2], s2.positions[i + 2], s1.velocities[i + 2], s2.velocities[i + 2], easedT);
            positions[i + 3] = s1.positions[i + 3] + (s2.positions[i + 3] - s1.positions[i + 3]) * easedT;
            
            // Interpolate velocities
            velocities[i] = s1.velocities[i] + (s2.velocities[i] - s1.velocities[i]) * easedT;
            velocities[i + 1] = s1.velocities[i + 1] + (s2.velocities[i + 1] - s1.velocities[i + 1]) * easedT;
            velocities[i + 2] = s1.velocities[i + 2] + (s2.velocities[i + 2] - s1.velocities[i + 2]) * easedT;
            velocities[i + 3] = s1.velocities[i + 3] + (s2.velocities[i + 3] - s1.velocities[i + 3]) * easedT;
        } else if (positions) {
            // Fallback to smoothstep lerp
            positions[i] = s1.positions[i] + (s2.positions[i] - s1.positions[i]) * easedT;
            positions[i + 1] = s1.positions[i + 1] + (s2.positions[i + 1] - s1.positions[i + 1]) * easedT;
            positions[i + 2] = s1.positions[i + 2] + (s2.positions[i + 2] - s1.positions[i + 2]) * easedT;
            positions[i + 3] = s1.positions[i + 3] + (s2.positions[i + 3] - s1.positions[i + 3]) * easedT;
        }
        
        if (meta && s1.meta && s2.meta) {
            meta[i] = s1.meta[i] + (s2.meta[i] - s1.meta[i]) * easedT;
            meta[i + 1] = s1.meta[i + 1] + (s2.meta[i + 1] - s1.meta[i + 1]) * easedT;
            meta[i + 2] = s1.meta[i + 2] + (s2.meta[i + 2] - s1.meta[i + 2]) * easedT;
            meta[i + 3] = s1.meta[i + 3] + (s2.meta[i + 3] - s1.meta[i + 3]) * easedT;
        }
    }
    
    return syncToGPU(particleState, s1, s2, t);
}

/**
 * Sync interpolated state to GPU
 */
function syncToGPU(particleState, s1, s2, t) {
    const { positions, velocities, meta, slotInfo, freeSlots, world } = particleState;
    
    // Interpolate counts
    particleState.liveCount = Math.round(s1.liveCount + (s2.liveCount - s1.liveCount) * t);
    particleState.instanceCount = Math.round(s1.instanceCount + (s2.instanceCount - s1.instanceCount) * t);
    particleState.activeInstanceCount = particleState.instanceCount;
    
    // Use closer state for discrete data
    const useStateB = t >= 0.5;
    const slotState = useStateB ? s2 : s1;
    
    if (slotInfo && slotState.slotInfo) {
        for (let i = 0; i < slotState.slotInfo.length; i++) {
            slotInfo[i] = slotState.slotInfo[i];
        }
    }
    
    if (freeSlots && slotState.freeSlots) {
        freeSlots.length = 0;
        for (const slot of slotState.freeSlots) {
            freeSlots.push(slot);
        }
    }
    
    // Sync to GPU
    if (world && world.device) {
        const device = world.device;
        if (positions && world.positionBuffer) {
            updateBuffer(device, world.positionBuffer, positions, 0);
        }
        if (velocities && world.velocityBuffer) {
            updateBuffer(device, world.velocityBuffer, velocities, 0);
        }
        if (meta && world.metaBuffer) {
            updateBuffer(device, world.metaBuffer, meta, 0);
        }
    }
    
    return true;
}

// ============================================================================
// DELTA FRAME STRUCTURE
// ============================================================================

/**
 * A single frame of particle state (keyframe or delta)
 * Captures EVERYTHING: positions, velocities, meta, slotInfo, spawn times, lifetimes
 */
class ParticleFrame {
    constructor(timestamp, isKeyframe = false) {
        this.timestamp = timestamp;
        this.isKeyframe = isKeyframe;
        
        if (isKeyframe) {
            // Full state - ALL particle data for complete rewind
            // Using Int16 quantization for 50% memory savings
            this.positions = null;   // Int16Array (quantized x,y,z,age per particle)
            this.velocities = null;  // Int16Array (quantized vx,vy,vz,lifetime per particle)
            this.meta = null;        // Float32Array (r,g,b,packed per particle) - keep full precision for colors
            this.slotInfo = null;    // Float32Array (spawnTime,lifetime per particle) - keep full precision
            this.liveIndices = null; // Uint16Array (slot indices for packed keyframes)
            this.particleCount = 0;
            this.liveCount = 0;
            this.instanceCount = 0;
            this.freeSlots = null;   // Uint16Array of free slot indices (saves 50% vs Array)
            // Shader/render state
            this.shaderState = null; // { showLines, showParticles, qualityScale, connectionDistance }
            this._keyframeFormat = null;
            this._integritySemantic = null;
            this._integrityRaw = null;
        } else {
            // Delta - only changed particles (start as arrays, convert to typed arrays later)
            this.changedIndices = [];     // Will become Uint16Array
            this.positionDeltas = [];     // Will become Int16Array
            this.velocityDeltas = [];     // Will become Int16Array
            this.metaDeltas = [];         // [dr,dg,db,dPacked] per changed particle (usually 0, sparse)
            this.slotInfoDeltas = [];     // [dSpawnTime, dLifetime] per changed particle (sparse)
            // Spawned/died particles this frame
            this.spawnedIndices = [];     // Will become Uint16Array
            this.spawnedData = [];        // Full data for spawned particles (small count)
            this.diedIndices = [];        // Will become Uint16Array
            // Count changes
            this.liveCountDelta = 0;
            this.instanceCountDelta = 0;
            this.freeSlotsAdded = [];     // Will become Uint16Array
            this.freeSlotsRemoved = [];   // Will become Uint16Array
        }
        
        // Emitter state (always stored - small)
        this.emitterStates = null;
    }
    
    /**
     * Get compressed byte size estimate
     */
    getByteSize() {
        if (this.isKeyframe) {
            // Handle lossless compressed format (Int16 + Float32 residuals)
            if (this._losslessCompressed || this._keyframeFormat === KEYFRAME_FORMAT.LOSSLESS) {
                // Be defensive: during migrations, some frames may still have positions/velocities
                // on the old fields. Count whichever fields are actually populated.
                return (this._quantizedPositions?.byteLength || this.positions?.byteLength || 0) +
                       (this._positionResiduals?.byteLength || 0) +
                       (this._quantizedVelocities?.byteLength || this.velocities?.byteLength || 0) +
                       (this._velocityResiduals?.byteLength || 0) +
                       (this.meta?.byteLength || 0) +
                       (this.slotInfo?.byteLength || 0) +
                       (this.freeSlots?.byteLength || 0) +
                       (this.liveIndices?.byteLength || 0);
            }
            // Standard format: positions/velocities as typed arrays
            return (this.positions?.byteLength || 0) + 
                   (this.velocities?.byteLength || 0) +
                   (this.meta?.byteLength || 0) +
                   (this.slotInfo?.byteLength || 0) +
                   (this.freeSlots?.byteLength || 0) +
                   (this.liveIndices?.byteLength || 0);
        } else {
            // Delta: handle both array and typed array cases
            const changedLen = this.changedIndices?.byteLength ?? (this.changedIndices?.length || 0) * 2;
            const posLen = this.positionDeltas?.byteLength ?? (this.positionDeltas?.length || 0) * 8;
            const velLen = this.velocityDeltas?.byteLength ?? (this.velocityDeltas?.length || 0) * 8;
            const spawnIdxLen = this.spawnedIndices?.byteLength ?? (this.spawnedIndices?.length || 0) * 2;
            const diedLen = this.diedIndices?.byteLength ?? (this.diedIndices?.length || 0) * 2;
            const freeAddLen = this.freeSlotsAdded?.byteLength ?? (this.freeSlotsAdded?.length || 0) * 2;
            const freeRemLen = this.freeSlotsRemoved?.byteLength ?? (this.freeSlotsRemoved?.length || 0) * 2;

            const metaLen = (this.metaDeltas?.byteLength) ? this.metaDeltas.byteLength : 0;
            const slotLen = (this.slotInfoDeltas?.byteLength) ? this.slotInfoDeltas.byteLength : 0;
            const metaIdxLen = this.metaDeltaIndices?.byteLength ?? (this.metaDeltaIndices?.length || 0) * 2;
            const slotIdxLen = this.slotInfoDeltaIndices?.byteLength ?? (this.slotInfoDeltaIndices?.length || 0) * 2;

            return changedLen + posLen + velLen + spawnIdxLen +
                   (this.spawnedData?.length || 0) * 32 + diedLen +
                   freeAddLen + freeRemLen +
                   metaLen + slotLen + metaIdxLen + slotIdxLen;
        }
    }
}

// ============================================================================
// EMITTER STATE CAPTURE
// ============================================================================

function captureEmitterState(emitters) {
    if (!emitters || !Array.isArray(emitters)) return [];
    
    return emitters.map(emitter => {
        const pos = emitter.position ? [...emitter.position] : [0, 0, 0];
        const emitterId = emitter.entityId || emitter.id;
        return {
            id: emitterId,
            position: pos,
            rotation: emitter.rotation ? [...emitter.rotation] : [0, 0, 0, 1],
            scale: emitter.scale ?? 1,
            enabled: emitter.enabled ?? true,
            totalSpawned: emitter.totalSpawned ?? 0,
            accumulator: emitter.accumulator ?? 0,
            remaining: emitter.remaining ?? undefined,
        };
    });
}

function restoreEmitterState(emitters, snapshot) {
    if (!emitters || !snapshot) {
        return;
    }
    
    for (const saved of snapshot) {
        const emitter = emitters.find(e => (e.entityId || e.id) === saved.id);
        if (!emitter) continue;
        
        if (saved.position) {
            emitter.position = [...saved.position];
        }
        if (saved.rotation) emitter.rotation = [...saved.rotation];
        if (saved.scale != null) emitter.scale = saved.scale;
        if (saved.enabled != null) emitter.enabled = saved.enabled;
        if (saved.totalSpawned != null) emitter.totalSpawned = saved.totalSpawned;
        if (saved.accumulator != null) emitter.accumulator = saved.accumulator;
        if (saved.remaining != null) emitter.remaining = saved.remaining;
    }
}

function interpolateEmitterState(emitters, stateA, stateB, t) {
    if (!emitters || !stateA || !stateB) {
        return;
    }
    
    for (const emitter of emitters) {
        const emitterId = emitter.entityId || emitter.id;
        const a = stateA.find(e => e.id === emitterId);
        const b = stateB.find(e => e.id === emitterId);
        if (!a || !b) {
            continue;
        }
        
        if (a.position && b.position) {
            emitter.position = [
                a.position[0] + (b.position[0] - a.position[0]) * t,
                a.position[1] + (b.position[1] - a.position[1]) * t,
                a.position[2] + (b.position[2] - a.position[2]) * t,
            ];
        }
        
        if (a.scale != null && b.scale != null) emitter.scale = a.scale + (b.scale - a.scale) * t;
        emitter.enabled = t < 0.5 ? a.enabled : b.enabled;
        emitter.totalSpawned = Math.round((a.totalSpawned ?? 0) + ((b.totalSpawned ?? 0) - (a.totalSpawned ?? 0)) * t);

        if (a.accumulator != null && b.accumulator != null) {
            emitter.accumulator = a.accumulator + (b.accumulator - a.accumulator) * t;
        } else if (a.accumulator != null || b.accumulator != null) {
            emitter.accumulator = (t < 0.5 ? (a.accumulator ?? 0) : (b.accumulator ?? 0));
        }

        if (a.remaining != null || b.remaining != null) {
            const ra = a.remaining;
            const rb = b.remaining;
            if (ra != null && rb != null && Number.isFinite(ra) && Number.isFinite(rb)) {
                emitter.remaining = ra + (rb - ra) * t;
            } else {
                emitter.remaining = t < 0.5 ? ra : rb;
            }
        }
    }
}

// ============================================================================
// DELTA SNAPSHOT SYSTEM
// ============================================================================

/**
 * Create delta-compressed particle snapshot system
 */
export function createDeltaSnapshotSystem(options = {}) {
    const snapshotInterval = options.snapshotInterval || DEFAULT_SNAPSHOT_INTERVAL;
    const keyframeInterval = options.keyframeInterval || KEYFRAME_INTERVAL;
    
    const memoryBudgetMB = options.memoryBudgetMB ?? DEFAULT_MEMORY_BUDGET_MB;
    const unlimitedBudget = (!Number.isFinite(memoryBudgetMB) || memoryBudgetMB <= 0);
    const useAdvancedInterpolation = options.useAdvancedInterpolation !== false; // Default: enabled
    const budgetLabel = unlimitedBudget ? 'unlimited' : `${memoryBudgetMB}MB`;
    console.log(`[ParticleSnapshot] Delta compression: interval=${snapshotInterval}s, keyframe every ${keyframeInterval} frames, memory budget: ${budgetLabel}`);
    
    return {
        // Config
        snapshotInterval,
        keyframeInterval,
        positionThreshold: options.positionThreshold || POSITION_THRESHOLD,
        velocityThreshold: options.velocityThreshold || VELOCITY_THRESHOLD,
        memoryBudgetBytes: unlimitedBudget ? 0 : (memoryBudgetMB * 1024 * 1024),
        
        offloadEnabled: options.offloadEnabled !== false,
        offloadKeepRecentFrames: Number.isFinite(options.offloadKeepRecentFrames) ? (options.offloadKeepRecentFrames | 0) : 120,
        offloadCacheKeyframes: Number.isFinite(options.offloadCacheKeyframes) ? (options.offloadCacheKeyframes | 0) : 4,

        _storeFrame: (typeof options.storeFrame === 'function') ? options.storeFrame : null,
        _retrieveFrame: (typeof options.retrieveFrame === 'function') ? options.retrieveFrame : null,
        _freeFrame: (typeof options.freeFrame === 'function') ? options.freeFrame : null,

        _loadedKeyframesLRU: new Map(),
        _keyframeLoadPromises: new Map(),
        _offloadScheduled: false,
        _offloadInFlight: false,

        // Frame history (trimmed when memory budget exceeded)
        frames: [],
        framesSinceKeyframe: 0,
        
        // Previous state for delta calculation (ALL particle data)
        prevPositions: null,
        prevVelocities: null,
        prevMeta: null,
        prevSlotInfo: null,
        prevLiveCount: 0,
        prevInstanceCount: 0,
        prevFreeSlots: null,
        
        // Reusable objects to reduce allocations (reduce/reuse/recycle)
        _tempCurrentFreeSet: new Set(),
        _tempPrevFreeSet: new Set(),
        
        // Playback state
        isRewinding: false,
        playbackFrame: 0,
        playbackSpeed: -1,
        easingType: options.easingType || 'smoothstep', // Default to smooth interpolation
        useAdvancedInterpolation, // Enable Catmull-Rom/Hermite splines
        
        // Worker capture (optional)
        _asyncSystem: options.useWorkerCapture ? initAsyncSnapshotSystem({
            keyframeInterval,
            positionThreshold: options.positionThreshold || POSITION_THRESHOLD,
            velocityThreshold: options.velocityThreshold || VELOCITY_THRESHOLD,
            captureIntervalMs: Math.max(8, Math.round(snapshotInterval * 1000)),
        }) : null,

        _ingestWorkerFrame: (raw) => {
            if (!raw) return null;
            if (raw instanceof ParticleFrame) return raw;
            const frame = new ParticleFrame(raw.timestamp, !!raw.isKeyframe);
            Object.assign(frame, raw);
            if (frame.isKeyframe) {
                if (frame._keyframeFormat == null) {
                    if (frame._positionsCompressed || frame._velocitiesCompressed) {
                        frame._keyframeFormat = KEYFRAME_FORMAT.TIERED;
                    } else if (frame._losslessCompressed || frame._quantizedPositions || frame._positionResiduals || frame._quantizedVelocities || frame._velocityResiduals) {
                        frame._keyframeFormat = KEYFRAME_FORMAT.LOSSLESS;
                    } else if ((frame.positions instanceof Int16Array) && (frame.velocities instanceof Int16Array)) {
                        frame._keyframeFormat = KEYFRAME_FORMAT.INT16;
                    }
                }
                if ((frame._keyframeFormat === KEYFRAME_FORMAT.INT16 || frame._keyframeFormat === KEYFRAME_FORMAT.LOSSLESS) && (!Number.isFinite(frame._integritySemantic) || frame._integritySemantic === 0)) {
                    frame._integritySemantic = hashParticleKeyframeSemantic(frame);
                }
                if ((frame._keyframeFormat === KEYFRAME_FORMAT.INT16 || frame._keyframeFormat === KEYFRAME_FORMAT.LOSSLESS) && (!Number.isFinite(frame._integrityRaw) || frame._integrityRaw === 0)) {
                    frame._integrityRaw = hashParticleKeyframe(frame);
                }
            }
            return frame;
        },

        _trimIfOverBudget: function () {
            trimIfOverBudget(this);
            _maybeScheduleOffload(this);
        },

        _hardOverBudget: false,
        _warnedHardOverBudget: false,

        _historyEpoch: 0,

        // Timing
        lastSnapshotTime: 0,
        
        // Async/background processing state
        isCapturing: false,           // Prevent concurrent captures
        pendingReadback: null,        // Double-buffered: previous frame's readback promise
        readbackPositions: null,      // Double-buffered: positions from previous readback
        readbackVelocities: null,     // Double-buffered: velocities from previous readback
        readbackTimestamp: 0,         // Timestamp of pending readback
        idleCallbackId: null,         // ID of scheduled idle callback
        processingQueue: [],          // Queue of frames waiting to be processed
        
        // Stats
        stats: {
            totalFrames: 0,
            keyframes: 0,
            deltaFrames: 0,
            totalBytes: 0,
            avgDeltaSize: 0,
            droppedFrames: 0,         // Frames dropped due to backpressure
            avgCaptureTimeMs: 0,      // Average capture time
        },
    };
}

/**
 * Capture a snapshot (keyframe or delta based on interval)
 * Captures EVERYTHING: positions, velocities, meta, slotInfo, liveCount, freeSlots
 * 
 * @param {Object} snapshot - Snapshot system
 * @param {Object} particleState - Full particle state { positions, velocities, meta, slotInfo, liveCount, instanceCount, freeSlots }
 * @param {Array} emitters - Emitter array
 * @param {number} currentTimeMs - Current time in milliseconds
 */
export async function captureFrame(snapshot, particleState, emitters, currentTimeMs) {
    if (!snapshot || !particleState) {
        console.warn('[ParticleSnapshot] captureFrame: missing snapshot or particleState');
        return;
    }

    const unlimitedBudget = (!Number.isFinite(snapshot.memoryBudgetBytes) || snapshot.memoryBudgetBytes <= 0);
    if (unlimitedBudget && snapshot._hardOverBudget) {
        snapshot._hardOverBudget = false;
    }
    
    const { positions, velocities, meta, slotInfo, liveCount, instanceCount, freeSlots, maxCount } = particleState;
    const maxFromState = (Number.isFinite(maxCount) && maxCount > 0)
        ? maxCount
        : ((positions?.length || 0) / 4) | 0;
    const particleCount = (Number.isFinite(instanceCount) && instanceCount > 0)
        ? Math.min(instanceCount | 0, maxFromState)
        : maxFromState;
    
    if (!positions || particleCount === 0) {
        // Only warn once per session to avoid spam
        if (!snapshot._warnedNoPositions) {
            console.warn('[ParticleSnapshot] captureFrame: no positions or particleCount=0', { hasPositions: !!positions, particleCount, maxCount, instanceCount });
            snapshot._warnedNoPositions = true;
        }
        return;
    }

    if (snapshot._hardOverBudget) {
        snapshot.stats.droppedFrames = (snapshot.stats.droppedFrames || 0) + 1;
        if (!snapshot._warnedHardOverBudget) {
            console.warn('[ParticleSnapshot] captureFrame: snapshot memory budget exceeded, capture paused', {
                totalBytes: snapshot.stats.totalBytes,
                memoryBudgetBytes: snapshot.memoryBudgetBytes,
            });
            snapshot._warnedHardOverBudget = true;
        }
        return;
    }
    
    // Read GPU-simulated positions, velocities, and thermal data back to CPU BEFORE any capture
    // This is needed for accurate delta tracking (spawn/death detection uses positions)
    const gpuWorld = particleState.world;
    const thermal = particleState.thermal || null;
    if (gpuWorld && gpuWorld.device) {
        await readbackPositionsFromGPU(gpuWorld, positions, particleCount);
        await readbackVelocitiesFromGPU(gpuWorld, velocities, particleCount);
        if (thermal) {
            await readbackThermalFromGPU(gpuWorld, thermal, particleCount);
        }
    }
    
    const forceKeyframe = snapshot.keyframeInterval <= 1 ||
                          snapshot.framesSinceKeyframe >= snapshot.keyframeInterval ||
                          snapshot.frames.length === 0;
    
    const frame = new ParticleFrame(currentTimeMs, forceKeyframe);
    frame.emitterStates = captureEmitterState(emitters);
    
    if (forceKeyframe) {
        const currentTimeSec = currentTimeMs / 1000;
        const live = [];
        if (slotInfo) {
            for (let i = 0; i < particleCount; i++) {
                const si = i * 2;
                const lifetime = slotInfo[si + 1] || 0;
                if (!(lifetime > 0)) continue;
                live.push(i);
            }
        } else {
            for (let i = 0; i < particleCount; i++) live.push(i);
        }

        const liveCountPacked = live.length;
        const packedSize4 = liveCountPacked * 4;
        const packedSize2 = liveCountPacked * 2;

        frame.particleCount = particleCount;
        frame.liveCount = Number.isFinite(liveCount) ? (liveCount | 0) : liveCountPacked;
        frame.instanceCount = instanceCount || 0;
        frame.liveIndices = new Uint16Array(live);

        const packedPos = new Float32Array(packedSize4);
        const packedVel = new Float32Array(packedSize4);
        for (let j = 0; j < liveCountPacked; j++) {
            const i = live[j];
            const src4 = i * 4;
            const dst4 = j * 4;
            packedPos[dst4] = positions[src4] || 0;
            packedPos[dst4 + 1] = positions[src4 + 1] || 0;
            packedPos[dst4 + 2] = positions[src4 + 2] || 0;
            if (slotInfo) {
                const spawnTime = slotInfo[i * 2] || 0;
                const age = (spawnTime > 0) ? Math.max(0, currentTimeSec - spawnTime) : (positions[src4 + 3] || 0);
                packedPos[dst4 + 3] = age;
            } else {
                packedPos[dst4 + 3] = positions[src4 + 3] || 0;
            }
            packedVel[dst4] = velocities[src4] || 0;
            packedVel[dst4 + 1] = velocities[src4 + 1] || 0;
            packedVel[dst4 + 2] = velocities[src4 + 2] || 0;
            packedVel[dst4 + 3] = velocities[src4 + 3] || 0;
        }

        frame.positions = quantizePositionArray(packedPos);
        frame.velocities = quantizeVelocityArray(packedVel);

        if (meta) {
            frame.meta = new Float32Array(packedSize4);
            for (let j = 0; j < liveCountPacked; j++) {
                const i = live[j];
                const src4 = i * 4;
                const dst4 = j * 4;
                frame.meta[dst4] = meta[src4] ?? 1;
                frame.meta[dst4 + 1] = meta[src4 + 1] ?? 1;
                frame.meta[dst4 + 2] = meta[src4 + 2] ?? 1;
                frame.meta[dst4 + 3] = meta[src4 + 3] ?? 44000;
            }
        }

        if (thermal) {
            frame.thermal = new Float32Array(packedSize4);
            for (let j = 0; j < liveCountPacked; j++) {
                const i = live[j];
                const src4 = i * 4;
                const dst4 = j * 4;
                frame.thermal[dst4] = thermal[src4] || 0;
                frame.thermal[dst4 + 1] = thermal[src4 + 1] || 0;
                frame.thermal[dst4 + 2] = thermal[src4 + 2] || 0;
                frame.thermal[dst4 + 3] = thermal[src4 + 3] || 0;
            }
        }

        if (slotInfo) {
            frame.slotInfo = new Float32Array(packedSize2);
            for (let j = 0; j < liveCountPacked; j++) {
                const i = live[j];
                const src2 = i * 2;
                const dst2 = j * 2;
                frame.slotInfo[dst2] = slotInfo[src2] || 0;
                frame.slotInfo[dst2 + 1] = slotInfo[src2 + 1] || 0;
            }
        }
        
        // Capture freeSlots as Uint16Array (50% savings vs number array)
        if (freeSlots && Array.isArray(freeSlots)) {
            frame.freeSlots = new Uint16Array(freeSlots);
        }
        
        // Capture shader/render state from world
        const world = particleState.world;
        if (world) {
            frame.shaderState = {
                showLines: world.showLines ?? true,
                showParticles: world.showParticles ?? true,
                qualityScale: world.qualityScale ?? 1.0,
                connectionDistance: world.connectionDistance ?? 2.0,
                activeParticleCount: world.activeParticleCount ?? particleCount,
            };
        }
        
        frame._keyframeFormat = KEYFRAME_FORMAT.INT16;
        frame._integritySemantic = hashParticleKeyframeSemantic(frame);
        frame._integrityRaw = hashParticleKeyframe(frame);
        frame._verifiedIntegrity = false;
        
        // Update previous state for next delta (MUST remain Float32 world-space values)
        // IMPORTANT: frame.positions/frame.velocities are Int16-quantized, and must NOT be used as prev state.
        // Using quantized data here breaks delta computation and leads to drift/corruption on restore.
        const dataSize = particleCount * 4;
        const slotSize = particleCount * 2;
        if (!snapshot.prevPositions || snapshot.prevPositions.length !== dataSize) {
            snapshot.prevPositions = new Float32Array(dataSize);
        }
        snapshot.prevPositions.set(positions.subarray(0, dataSize));

        // Ensure prevPositions.w stores computed age (not potentially stale CPU value)
        if (slotInfo && snapshot.prevPositions) {
            for (let i = 0; i < particleCount; i++) {
                const idx = i * 4;
                const slotIdx = i * 2;
                const currLifetime = slotInfo[slotIdx + 1] || 0;
                if (currLifetime > 0) {
                    const spawnTime = slotInfo[slotIdx] || 0;
                    if (spawnTime > 0) {
                        snapshot.prevPositions[idx + 3] = Math.max(0, currentTimeSec - spawnTime);
                    }
                }
            }
        }
        
        if (!snapshot.prevVelocities || snapshot.prevVelocities.length !== dataSize) {
            snapshot.prevVelocities = new Float32Array(dataSize);
        }
        snapshot.prevVelocities.set(velocities.subarray(0, dataSize));
        
        if (meta) {
            if (!snapshot.prevMeta || snapshot.prevMeta.length !== dataSize) {
                snapshot.prevMeta = new Float32Array(dataSize);
            }
            snapshot.prevMeta.set(meta.subarray(0, dataSize));
        }
        
        if (slotInfo) {
            if (!snapshot.prevSlotInfo || snapshot.prevSlotInfo.length !== slotSize) {
                snapshot.prevSlotInfo = new Float32Array(slotSize);
            }
            snapshot.prevSlotInfo.set(slotInfo.subarray(0, slotSize));
        }
        snapshot.prevLiveCount = Number.isFinite(liveCount) ? (liveCount | 0) : liveCountPacked;
        snapshot.prevInstanceCount = frame.instanceCount;
        snapshot.prevFreeSlots = freeSlots ? [...freeSlots] : [];
        
        snapshot.framesSinceKeyframe = 0;
        snapshot.stats.keyframes++;
    } else {
        // Delta frame - track changes and spawn/death events
        const posThreshSq = snapshot.positionThreshold * snapshot.positionThreshold;
        const velThreshSq = snapshot.velocityThreshold * snapshot.velocityThreshold;
        const currentTimeSec = currentTimeMs / 1000;

        const metaDeltaIndices = [];
        const metaDeltasPacked = [];
        const slotInfoDeltaIndices = [];
        const slotInfoDeltasPacked = [];
        
        // Track count changes
        frame.liveCountDelta = (liveCount || 0) - snapshot.prevLiveCount;
        frame.instanceCountDelta = (instanceCount || 0) - snapshot.prevInstanceCount;
        
        // Track freeSlots changes - reuse Sets to avoid allocations
        const currentFreeSet = snapshot._tempCurrentFreeSet;
        const prevFreeSet = snapshot._tempPrevFreeSet;
        currentFreeSet.clear();
        prevFreeSet.clear();
        
        if (freeSlots) {
            for (let i = 0; i < freeSlots.length; i++) {
                currentFreeSet.add(freeSlots[i]);
            }
        }
        if (snapshot.prevFreeSlots) {
            for (let i = 0; i < snapshot.prevFreeSlots.length; i++) {
                prevFreeSet.add(snapshot.prevFreeSlots[i]);
            }
        }
        
        for (const slot of currentFreeSet) {
            if (!prevFreeSet.has(slot)) {
                frame.freeSlotsAdded.push(slot);
            }
        }
        for (const slot of prevFreeSet) {
            if (!currentFreeSet.has(slot)) {
                frame.freeSlotsRemoved.push(slot);
            }
        }
        
        // Check each particle for changes - ONLY process live particles
        for (let i = 0; i < particleCount; i++) {
            const slotIdx = i * 2;
            
            // Early exit: Skip dead particles entirely
            const currLifetime = slotInfo ? slotInfo[slotIdx + 1] : 0;
            const prevLifetime = snapshot.prevSlotInfo ? snapshot.prevSlotInfo[slotIdx + 1] : 0;
            
            // Skip if particle is dead and was dead (no change)
            if (currLifetime === 0 && prevLifetime === 0) continue;
            
            const idx = i * 4;
            const wasSpawned = prevLifetime === 0 && currLifetime > 0;
            const wasDied = prevLifetime > 0 && currLifetime === 0;
            
            // Calculate correct age from slotInfo (GPU updates age but doesn't write to CPU)
            let currentAge = positions[idx + 3] || 0;
            if (slotInfo && currLifetime > 0) {
                const spawnTime = slotInfo[slotIdx] || 0;
                if (spawnTime > 0) {
                    currentAge = Math.max(0, currentTimeSec - spawnTime);
                }
            }
            
            if (wasSpawned) {
                // New particle spawned - store full data with calculated age
                frame.spawnedIndices.push(i);
                
                // Quantize spawn data to save memory
                const spawnData = {
                    pos: [
                        Math.round(positions[idx] * 100) / 100,
                        Math.round(positions[idx+1] * 100) / 100,
                        Math.round(positions[idx+2] * 100) / 100,
                        Math.round(currentAge * 1000) / 1000
                    ],
                    vel: [
                        Math.round(velocities[idx] * 1000) / 1000,
                        Math.round(velocities[idx+1] * 1000) / 1000,
                        Math.round(velocities[idx+2] * 1000) / 1000,
                        Math.round(velocities[idx+3] * 1000) / 1000
                    ]
                };
                
                // Only store meta if it's non-default
                if (meta) {
                    const m0 = meta[idx], m1 = meta[idx+1], m2 = meta[idx+2], m3 = meta[idx+3];
                    if (m0 !== 1 || m1 !== 1 || m2 !== 1 || m3 !== 0) {
                        spawnData.meta = [m0, m1, m2, m3];
                    }
                }
                
                // Only store slot if it's non-zero
                if (slotInfo) {
                    const s0 = slotInfo[slotIdx], s1 = slotInfo[slotIdx+1];
                    if (s0 !== 0 || s1 !== currLifetime) {
                        spawnData.slot = [s0, s1];
                    }
                }
                
                frame.spawnedData.push(spawnData);
            } else if (wasDied) {
                // Particle died
                frame.diedIndices.push(i);
            } else if (currLifetime > 0) {
                // Existing particle - check for changes using calculated age
                const dx = positions[idx] - (snapshot.prevPositions[idx] || 0);
                const dy = positions[idx + 1] - (snapshot.prevPositions[idx + 1] || 0);
                const dz = positions[idx + 2] - (snapshot.prevPositions[idx + 2] || 0);
                const prevAge = snapshot.prevPositions[idx + 3] || 0;
                const dAge = currentAge - prevAge;
                const posDist = dx * dx + dy * dy + dz * dz;
                
                const dvx = velocities[idx] - (snapshot.prevVelocities[idx] || 0);
                const dvy = velocities[idx + 1] - (snapshot.prevVelocities[idx + 1] || 0);
                const dvz = velocities[idx + 2] - (snapshot.prevVelocities[idx + 2] || 0);
                const dLife = velocities[idx + 3] - (snapshot.prevVelocities[idx + 3] || 0);
                const velDist = dvx * dvx + dvy * dvy + dvz * dvz;
                
                if (posDist > posThreshSq || velDist > velThreshSq || Math.abs(dAge) > 0.001) {
                    frame.changedIndices.push(i);
                    
                    // Quantize deltas to reduce memory (16-bit precision)
                    // Position: ±327m range with 0.01m precision
                    const quantPos = [
                        Math.round(dx * 100) / 100,
                        Math.round(dy * 100) / 100,
                        Math.round(dz * 100) / 100,
                        Math.round(dAge * 1000) / 1000
                    ];
                    
                    // Velocity: ±32 m/s range with 0.001 m/s precision
                    const quantVel = [
                        Math.round(dvx * 1000) / 1000,
                        Math.round(dvy * 1000) / 1000,
                        Math.round(dvz * 1000) / 1000,
                        Math.round(dLife * 1000) / 1000
                    ];
                    
                    frame.positionDeltas.push(quantPos);
                    frame.velocityDeltas.push(quantVel);
                    
                    if (meta && snapshot.prevMeta) {
                        const dm0 = meta[idx] - snapshot.prevMeta[idx];
                        const dm1 = meta[idx + 1] - snapshot.prevMeta[idx + 1];
                        const dm2 = meta[idx + 2] - snapshot.prevMeta[idx + 2];
                        const dm3 = meta[idx + 3] - snapshot.prevMeta[idx + 3];
                        if (dm0 !== 0 || dm1 !== 0 || dm2 !== 0 || dm3 !== 0) {
                            metaDeltaIndices.push(i);
                            metaDeltasPacked.push(dm0, dm1, dm2, dm3);
                        }
                    }

                    if (slotInfo && snapshot.prevSlotInfo) {
                        const ds0 = slotInfo[slotIdx] - snapshot.prevSlotInfo[slotIdx];
                        const ds1 = slotInfo[slotIdx + 1] - snapshot.prevSlotInfo[slotIdx + 1];
                        if (ds0 !== 0 || ds1 !== 0) {
                            slotInfoDeltaIndices.push(i);
                            slotInfoDeltasPacked.push(ds0, ds1);
                        }
                    }
                }
            }
        }

        if (metaDeltaIndices.length > 0) {
            frame.metaDeltaIndices = new Uint16Array(metaDeltaIndices);
            frame.metaDeltas = new Float32Array(metaDeltasPacked);
        } else {
            frame.metaDeltaIndices = null;
            frame.metaDeltas = null;
        }

        if (slotInfoDeltaIndices.length > 0) {
            frame.slotInfoDeltaIndices = new Uint16Array(slotInfoDeltaIndices);
            frame.slotInfoDeltas = new Float32Array(slotInfoDeltasPacked);
        } else {
            frame.slotInfoDeltaIndices = null;
            frame.slotInfoDeltas = null;
        }
        
        // Update previous state with calculated ages
        for (let i = 0; i < particleCount; i++) {
            const idx = i * 4;
            const slotIdx = i * 2;
            if (snapshot.prevPositions) {
                snapshot.prevPositions[idx] = positions[idx] || 0;
                snapshot.prevPositions[idx + 1] = positions[idx + 1] || 0;
                snapshot.prevPositions[idx + 2] = positions[idx + 2] || 0;
                // Store calculated age, not stale CPU value
                const currLifetime = slotInfo ? slotInfo[slotIdx + 1] : 0;
                if (slotInfo && currLifetime > 0) {
                    const spawnTime = slotInfo[slotIdx] || 0;
                    snapshot.prevPositions[idx + 3] = spawnTime > 0 ? Math.max(0, currentTimeSec - spawnTime) : (positions[idx + 3] || 0);
                } else {
                    snapshot.prevPositions[idx + 3] = positions[idx + 3] || 0;
                }
            }
            if (snapshot.prevVelocities) {
                snapshot.prevVelocities[idx] = velocities[idx] || 0;
                snapshot.prevVelocities[idx + 1] = velocities[idx + 1] || 0;
                snapshot.prevVelocities[idx + 2] = velocities[idx + 2] || 0;
                snapshot.prevVelocities[idx + 3] = velocities[idx + 3] || 0;
            }
            if (snapshot.prevMeta && meta) {
                snapshot.prevMeta[idx] = meta[idx] || 0;
                snapshot.prevMeta[idx + 1] = meta[idx + 1] || 0;
                snapshot.prevMeta[idx + 2] = meta[idx + 2] || 0;
                snapshot.prevMeta[idx + 3] = meta[idx + 3] || 0;
            }
        }
        if (snapshot.prevSlotInfo && slotInfo) {
            for (let i = 0; i < particleCount * 2; i++) {
                snapshot.prevSlotInfo[i] = slotInfo[i] || 0;
            }
        }
        snapshot.prevLiveCount = liveCount || 0;
        snapshot.prevInstanceCount = instanceCount || 0;
        snapshot.prevFreeSlots = freeSlots ? [...freeSlots] : [];
        
        snapshot.framesSinceKeyframe++;
        snapshot.stats.deltaFrames++;
    }
    
    // Convert delta frame arrays to typed arrays for memory efficiency
    if (!frame.isKeyframe) {
        // Convert indices to Uint16Array
        if (frame.changedIndices && frame.changedIndices.length > 0) {
            const indices = frame.changedIndices;
            frame.changedIndices = new Uint16Array(indices);
            
            // Quantize position deltas to Int16
            const posDeltas = new Int16Array(indices.length * 4);
            for (let i = 0; i < indices.length; i++) {
                const d = frame.positionDeltas[i];
                posDeltas[i * 4] = quantizeFloat(d[0], POSITION_RANGE);
                posDeltas[i * 4 + 1] = quantizeFloat(d[1], POSITION_RANGE);
                posDeltas[i * 4 + 2] = quantizeFloat(d[2], POSITION_RANGE);
                posDeltas[i * 4 + 3] = quantizeFloat(d[3], AGE_RANGE);
            }
            frame.positionDeltas = posDeltas;
            
            // Quantize velocity deltas to Int16
            const velDeltas = new Int16Array(indices.length * 4);
            for (let i = 0; i < indices.length; i++) {
                const d = frame.velocityDeltas[i];
                velDeltas[i * 4] = quantizeFloat(d[0], VELOCITY_RANGE);
                velDeltas[i * 4 + 1] = quantizeFloat(d[1], VELOCITY_RANGE);
                velDeltas[i * 4 + 2] = quantizeFloat(d[2], VELOCITY_RANGE);
                velDeltas[i * 4 + 3] = quantizeFloat(d[3], AGE_RANGE);
            }
            frame.velocityDeltas = velDeltas;
        }
        
        // Convert spawn/death indices to Uint16Array
        if (frame.spawnedIndices && frame.spawnedIndices.length > 0) {
            frame.spawnedIndices = new Uint16Array(frame.spawnedIndices);
        }
        if (frame.diedIndices && frame.diedIndices.length > 0) {
            frame.diedIndices = new Uint16Array(frame.diedIndices);
        }
        if (frame.freeSlotsAdded && frame.freeSlotsAdded.length > 0) {
            frame.freeSlotsAdded = new Uint16Array(frame.freeSlotsAdded);
        }
        if (frame.freeSlotsRemoved && frame.freeSlotsRemoved.length > 0) {
            frame.freeSlotsRemoved = new Uint16Array(frame.freeSlotsRemoved);
        }
    }
    
    // Add frame to history
    snapshot.frames.push(frame);
    snapshot.stats.totalFrames++;
    snapshot.stats.totalBytes += frame.getByteSize();
    snapshot.stats.avgDeltaSize = snapshot.stats.totalBytes / snapshot.stats.totalFrames;
    snapshot.lastSnapshotTime = currentTimeMs;
    
    // Trim old frames if memory budget exceeded
    if (typeof snapshot._trimIfOverBudget === 'function') {
        snapshot._trimIfOverBudget();
    } else {
        trimIfOverBudget(snapshot);
        _maybeScheduleOffload(snapshot);
    }
}

/**
 * Memory management for particle snapshots
 * Uses LOSSLESS compression: Int16 quantization + Float32 residuals
 * 
 * Based on Residual Vector Quantization (RVQ) principles:
 * 1. Quantize to Int16 (50% size reduction)
 * 2. Store exact Float32 residuals for perfect reconstruction
 * 3. RLE compress zero residuals (common case)
 * 
 * Result: ~60-70% compression with ZERO quality loss
 */
function trimIfOverBudget(snapshot) {
    if (!snapshot || !snapshot.memoryBudgetBytes) return;
    if (snapshot.stats.totalBytes <= snapshot.memoryBudgetBytes) {
        snapshot._hardOverBudget = false;
        return;
    }
    
    // Compress old frames using lossless Int16 + Float32 residual approach
    const COMPRESS_AFTER_FRAMES = 60; // Only compress frames older than 2 seconds
    
    let compressedBytes = 0;
    let framesCompressed = 0;
    const frameCount = snapshot.frames.length;
    
    for (let i = 0; i < frameCount - COMPRESS_AFTER_FRAMES; i++) {
        const frame = snapshot.frames[i];
        if (frame._losslessCompressed || frame._keyframeFormat === KEYFRAME_FORMAT.LOSSLESS) continue;
        
        const oldSize = frame.getByteSize();
        losslessCompressFrame(frame);
        const newSize = frame.getByteSize();
        
        compressedBytes += (oldSize - newSize);
        framesCompressed++;
    }
    
    snapshot.stats.totalBytes -= compressedBytes;

    let totalBytes = 0;
    let keyframes = 0;
    let deltaFrames = 0;
    for (let i = 0; i < snapshot.frames.length; i++) {
        const f = snapshot.frames[i];
        const sz = (f && typeof f.getByteSize === 'function') ? f.getByteSize() : (f?.byteSize || 0);
        totalBytes += sz;
        if (f?.isKeyframe) keyframes++;
        else deltaFrames++;
    }
    snapshot.stats.totalBytes = totalBytes;
    snapshot.stats.totalFrames = snapshot.frames.length;
    snapshot.stats.keyframes = keyframes;
    snapshot.stats.deltaFrames = deltaFrames;
    snapshot.stats.avgDeltaSize = snapshot.stats.totalFrames > 0 ? (totalBytes / snapshot.stats.totalFrames) : 0;

    snapshot._hardOverBudget = snapshot.stats.totalBytes > snapshot.memoryBudgetBytes;

    let framesSinceKeyframe = 0;
    for (let i = snapshot.frames.length - 1; i >= 0; i--) {
        if (snapshot.frames[i]?.isKeyframe) {
            framesSinceKeyframe = (snapshot.frames.length - 1) - i;
            break;
        }
    }
    snapshot.framesSinceKeyframe = framesSinceKeyframe;

    // Log periodically
    if (!snapshot._compressCount) snapshot._compressCount = 0;
    snapshot._compressCount++;
    if (snapshot._compressCount % 30 === 1 && framesCompressed > 0) {
        const savedMB = (compressedBytes / 1024 / 1024).toFixed(1);
        console.log(`[ParticleSnapshot] Lossless compression: ${framesCompressed} frames, saved ${savedMB}MB, ${frameCount} total`);
    }
}

/**
 * Lossless compression using Int16 quantization + exact Float32 residuals
 * Uses the SAME quantization as existing delta system for consistency
 */
function losslessCompressFrame(frame) {
    if (!frame || !frame.isKeyframe) return;
    if (frame._losslessCompressed || frame._keyframeFormat === KEYFRAME_FORMAT.LOSSLESS) return;
    if (frame._positionsCompressed || frame._velocitiesCompressed) return;
    if (!frame.positions && !frame.velocities && (frame._quantizedPositions || frame._quantizedVelocities)) {
        frame._losslessCompressed = true;
        frame._keyframeFormat = KEYFRAME_FORMAT.LOSSLESS;
        if (!Number.isFinite(frame._integritySemantic) || frame._integritySemantic === 0) {
            frame._integritySemantic = hashParticleKeyframeSemantic(frame);
        }
        if (!Number.isFinite(frame._integrityRaw) || frame._integrityRaw === 0) {
            frame._integrityRaw = hashParticleKeyframe(frame);
        }
        frame._verifiedIntegrity = false;
        return;
    }

    if (!validateParticleKeyframeSchema(frame)) {
        console.warn('[ParticleSnapshot] losslessCompressFrame: schema validation failed, skipping compression');
        return;
    }

    const beforeSemantic = hashParticleKeyframeSemantic(frame);
    const beforeRaw = hashParticleKeyframe(frame);

    const prev = {
        positions: frame.positions,
        velocities: frame.velocities,
        _quantizedPositions: frame._quantizedPositions,
        _quantizedVelocities: frame._quantizedVelocities,
        _positionResiduals: frame._positionResiduals,
        _velocityResiduals: frame._velocityResiduals,
        _losslessCompressed: frame._losslessCompressed,
        _keyframeFormat: frame._keyframeFormat,
        _integritySemantic: frame._integritySemantic,
        _integrityRaw: frame._integrityRaw,
        _verifiedIntegrity: frame._verifiedIntegrity,
    };
    
    // IMPORTANT:
    // Keyframes in this system are already stored as Int16Array via quantizePositionArray/quantizeVelocityArray.
    // The primary goal here is to move data into the *_quantized* slots (and null-out the legacy fields)
    // so decompression always returns Float32Array values (never raw Int16s).
    
    // Positions
    if (frame.positions) {
        if (frame.positions instanceof Int16Array) {
            // Already quantized; move to canonical field
            frame._quantizedPositions = frame.positions;
            frame._positionResiduals = null;
            frame.positions = null;
        } else {
            // Float32 (or array-like) -> quantize + residuals
            const original = frame.positions;
            const quantized = quantizePositionArray(original);
            const dequantized = dequantizePositionArray(quantized);
            const residuals = new Float32Array(original.length);
            let nonZeroCount = 0;
            for (let i = 0; i < original.length; i++) {
                residuals[i] = original[i] - dequantized[i];
                if (residuals[i] !== 0) nonZeroCount++;
            }
            frame._quantizedPositions = quantized;
            frame._positionResiduals = nonZeroCount > 0 ? residuals : null;
            frame.positions = null;
        }
    }
    
    // Compress velocities
    if (frame.velocities) {
        if (frame.velocities instanceof Int16Array) {
            frame._quantizedVelocities = frame.velocities;
            frame._velocityResiduals = null;
            frame.velocities = null;
        } else {
            const original = frame.velocities;
            const quantized = quantizeVelocityArray(original);
            const dequantized = dequantizeVelocityArray(quantized);
            const residuals = new Float32Array(original.length);
            let nonZeroCount = 0;
            for (let i = 0; i < original.length; i++) {
                residuals[i] = original[i] - dequantized[i];
                if (residuals[i] !== 0) nonZeroCount++;
            }
            frame._quantizedVelocities = quantized;
            frame._velocityResiduals = nonZeroCount > 0 ? residuals : null;
            frame.velocities = null;
        }
    }
    
    frame._losslessCompressed = true;
    frame._keyframeFormat = KEYFRAME_FORMAT.LOSSLESS;
    frame._verifiedIntegrity = false;

    const afterSemantic = hashParticleKeyframeSemantic(frame);
    const afterRaw = hashParticleKeyframe(frame);

    if (beforeRaw !== afterRaw || beforeSemantic !== afterSemantic) {
        frame.positions = prev.positions;
        frame.velocities = prev.velocities;
        frame._quantizedPositions = prev._quantizedPositions;
        frame._quantizedVelocities = prev._quantizedVelocities;
        frame._positionResiduals = prev._positionResiduals;
        frame._velocityResiduals = prev._velocityResiduals;
        frame._losslessCompressed = prev._losslessCompressed;
        frame._keyframeFormat = prev._keyframeFormat;
        frame._integritySemantic = prev._integritySemantic;
        frame._integrityRaw = prev._integrityRaw;
        frame._verifiedIntegrity = prev._verifiedIntegrity;
        console.warn('[ParticleSnapshot] losslessCompressFrame: integrity hash mismatch, compression rejected', {
            beforeRaw,
            afterRaw,
            beforeSemantic,
            afterSemantic,
        });
    } else {
        frame._integrityRaw = afterRaw;
        frame._integritySemantic = afterSemantic;
        frame._verifiedIntegrity = false;
    }
}

/**
 * Decompress lossless-compressed frame data
 * Returns exact original values (quantized + residuals = original)
 */
function losslessDecompressPositions(frame) {
    // Prefer canonical field, but support legacy fallback
    const q = frame._quantizedPositions || frame.positions;
    if (!q) return null;
    
    // If q is still Int16Array, dequantize. Otherwise assume it's already float-like.
    const dequantized = (q instanceof Int16Array) ? dequantizePositionArray(q) : new Float32Array(q);
    
    if (frame._positionResiduals) {
        for (let i = 0; i < dequantized.length; i++) {
            dequantized[i] += frame._positionResiduals[i];
        }
    }
    
    return dequantized;
}

function losslessDecompressVelocities(frame) {
    const q = frame._quantizedVelocities || frame.velocities;
    if (!q) return null;
    
    const dequantized = (q instanceof Int16Array) ? dequantizeVelocityArray(q) : new Float32Array(q);
    
    if (frame._velocityResiduals) {
        for (let i = 0; i < dequantized.length; i++) {
            dequantized[i] += frame._velocityResiduals[i];
        }
    }
    
    return dequantized;
}

/**
 * Apply tiered compression to a frame
 * @param {Object} frame - Frame to compress
 * @param {number} tier - 0=none, 1=lossless, 2=lossy, 3=archived
 */
function compressFrame(frame, tier) {
    if (!frame || tier <= 0) return;
    
    const quality = tier === 3 ? 8 : tier === 2 ? 12 : 16; // Bit depth
    
    // Compress position data with quantization + residuals
    if (frame.positions && !frame._positionsCompressed) {
        const original = frame.positions;
        const quantized = quantizePositions(original, quality);
        // Use position-specific residual computation
        const residuals = computePositionResiduals(original, quantized, quality);
        
        frame._positionsQuantized = quantized;
        frame._positionsResiduals = entropyEncodeResiduals(residuals);
        frame._positionsBitDepth = quality;
        frame._positionsCompressed = true;
        
        // Free original (will reconstruct from quantized + residuals)
        if (tier >= 2) {
            frame.positions = null;
        }
    }
    
    // Compress velocity data
    if (frame.velocities && !frame._velocitiesCompressed) {
        const original = frame.velocities;
        const quantized = quantizeVelocities(original, quality);
        // Use velocity-specific residual computation
        const residuals = computeVelocityResiduals(original, quantized, quality);
        
        frame._velocitiesQuantized = quantized;
        frame._velocitiesResiduals = entropyEncodeResiduals(residuals);
        frame._velocitiesBitDepth = quality;
        frame._velocitiesCompressed = true;
        
        if (tier >= 2) {
            frame.velocities = null;
        }
    }
    
    frame._compressionTier = tier;
}

/**
 * Quantize positions to lower bit depth (unsigned normalization)
 * Maps [-POSITION_RANGE, +POSITION_RANGE] → [0, maxVal]
 */
function quantizePositions(positions, bitDepth) {
    const quantized = new Uint16Array(positions.length);
    for (let i = 0; i < positions.length; i++) {
        quantized[i] = packSignedRangeUNORMBits(positions[i], POSITION_RANGE, bitDepth, -POSITION_RANGE);
    }
    return quantized;
}

/**
 * Dequantize positions (must match quantizePositions exactly)
 */
function dequantizePositions(quantized, bitDepth) {
    const positions = new Float32Array(quantized.length);
    for (let i = 0; i < quantized.length; i++) {
        positions[i] = unpackSignedRangeUNORMBits(quantized[i], POSITION_RANGE, bitDepth, -POSITION_RANGE);
    }
    return positions;
}

/**
 * Quantize velocities to lower bit depth (signed normalization)
 * Maps [-VELOCITY_RANGE, +VELOCITY_RANGE] → [-maxVal/2, +maxVal/2]
 */
function quantizeVelocities(velocities, bitDepth) {
    const quantized = new Int16Array(velocities.length);
    for (let i = 0; i < velocities.length; i++) {
        quantized[i] = packSignedRangeSNORMBits(velocities[i], VELOCITY_RANGE, bitDepth, 0);
    }
    return quantized;
}

/**
 * Dequantize velocities (must match quantizeVelocities exactly)
 */
function dequantizeVelocities(quantized, bitDepth) {
    const velocities = new Float32Array(quantized.length);
    for (let i = 0; i < quantized.length; i++) {
        velocities[i] = unpackSignedRangeSNORMBits(quantized[i], VELOCITY_RANGE, bitDepth, 0);
    }
    return velocities;
}

/**
 * Compute residuals for lossless reconstruction
 * Uses the exact same dequantization formula to ensure perfect reconstruction
 */
function computePositionResiduals(original, quantized, bitDepth) {
    const reconstructed = dequantizePositions(quantized, bitDepth);
    const residuals = new Float32Array(original.length);
    for (let i = 0; i < original.length; i++) {
        residuals[i] = original[i] - reconstructed[i];
    }
    return residuals;
}

/**
 * Compute velocity residuals for lossless reconstruction
 */
function computeVelocityResiduals(original, quantized, bitDepth) {
    const reconstructed = dequantizeVelocities(quantized, bitDepth);
    const residuals = new Float32Array(original.length);
    for (let i = 0; i < original.length; i++) {
        residuals[i] = original[i] - reconstructed[i];
    }
    return residuals;
}

// entropyEncodeResiduals and entropyDecodeResiduals imported from ParticleCompression.js

/**
 * Decompress positions from tiered compression format
 * Uses the same dequantization function as compression for perfect symmetry
 * @param {Object} frame - Frame with compressed position data
 * @returns {Float32Array} Decompressed positions
 */
function decompressPositions(frame) {
    if (!frame._positionsQuantized) return null;
    
    const quantized = frame._positionsQuantized;
    const bitDepth = frame._positionsBitDepth || 16;
    const length = quantized.length;
    
    // Use the same dequantization function as used in residual computation
    const positions = dequantizePositions(quantized, bitDepth);
    
    // Apply residuals for lossless reconstruction
    if (frame._positionsResiduals) {
        const residuals = entropyDecodeResiduals(frame._positionsResiduals, length);
        if (residuals) {
            for (let i = 0; i < length; i++) {
                positions[i] += residuals[i];
            }
        }
    }
    
    return positions;
}

/**
 * Decompress velocities from tiered compression format
 * Uses the same dequantization function as compression for perfect symmetry
 * @param {Object} frame - Frame with compressed velocity data
 * @returns {Float32Array} Decompressed velocities
 */
function decompressVelocities(frame) {
    if (!frame._velocitiesQuantized) return null;
    
    const quantized = frame._velocitiesQuantized;
    const bitDepth = frame._velocitiesBitDepth || 16;
    const length = quantized.length;
    
    // Use the same dequantization function as used in residual computation
    const velocities = dequantizeVelocities(quantized, bitDepth);
    
    // Apply residuals for lossless reconstruction
    if (frame._velocitiesResiduals) {
        const residuals = entropyDecodeResiduals(frame._velocitiesResiduals, length);
        if (residuals) {
            for (let i = 0; i < length; i++) {
                velocities[i] += residuals[i];
            }
        }
    }
    
    return velocities;
}

/**
 * Auto-capture based on interval - NON-BLOCKING version
 * Uses double-buffered GPU readback to avoid blocking the main thread
 * 
 * @param {Object} snapshot - Snapshot system
 * @param {Object} particleState - Full particle state object
 * @param {Array} emitters - Emitter array
 * @param {number} currentTimeMs - Current time in milliseconds
 */
export async function autoCapture(snapshot, particleState, emitters, currentTimeMs) {
    if (!snapshot || snapshot.isRewinding) return;

    const unlimitedBudget = (!Number.isFinite(snapshot.memoryBudgetBytes) || snapshot.memoryBudgetBytes <= 0);
    if (unlimitedBudget && snapshot._hardOverBudget) {
        snapshot._hardOverBudget = false;
    }

    if (snapshot._hardOverBudget) {
        snapshot.stats.droppedFrames = (snapshot.stats.droppedFrames || 0) + 1;
        return;
    }

    if (snapshot._asyncSystem?.captureFrameTripleBuffered) {
        snapshot._asyncSystem.captureFrameTripleBuffered(snapshot, particleState, emitters, currentTimeMs);
        return;
    }
    
    const intervalMs = snapshot.snapshotInterval * 1000;
    if (currentTimeMs - snapshot.lastSnapshotTime < intervalMs) return;
    
    // Double-buffered approach: start new readback, process previous one
    const gpuWorld = particleState.world;
    const { positions, velocities, meta, slotInfo, liveCount, instanceCount, freeSlots, maxCount } = particleState;
    const maxFromState = (Number.isFinite(maxCount) && maxCount > 0)
        ? maxCount
        : ((positions?.length || 0) / 4) | 0;
    const particleCount = (Number.isFinite(instanceCount) && instanceCount > 0)
        ? Math.min(instanceCount | 0, maxFromState)
        : maxFromState;
    
    if (!positions || particleCount === 0) return;
    
    // If we have a pending readback from previous frame, process it now (non-blocking)
    if (snapshot.pendingReadback && snapshot.readbackPositions) {
        // Schedule processing during idle time to avoid blocking render
        scheduleIdleWork((deadline) => {
            processReadbackData(snapshot, particleState, emitters, snapshot.readbackTimestamp, deadline);
        }, { timeout: 100 }); // Timeout ensures it runs within 100ms even if no idle time
    }
    
    // Start new async GPU readback for THIS frame (don't await - fire and forget)
    if (gpuWorld && gpuWorld.device && !snapshot.isCapturing) {
        snapshot.isCapturing = true;
        snapshot.readbackTimestamp = currentTimeMs;
        
        // Clone current CPU state for the readback (fast typed array copy)
        const dataSize = particleCount * 4;
        if (!snapshot.readbackPositions || snapshot.readbackPositions.length !== dataSize) {
            snapshot.readbackPositions = new Float32Array(dataSize);
            snapshot.readbackVelocities = new Float32Array(dataSize);
            snapshot.readbackThermal = new Float32Array(dataSize);
        }
        
        // Fire off async GPU readback - don't block!
        snapshot.pendingReadback = (async () => {
            try {
                await readbackPositionsFromGPU(gpuWorld, snapshot.readbackPositions, particleCount);
                await readbackVelocitiesFromGPU(gpuWorld, snapshot.readbackVelocities, particleCount);
                if (gpuWorld.thermalBuffer) {
                    await readbackThermalFromGPU(gpuWorld, snapshot.readbackThermal, particleCount);
                }
            } catch (e) {
                console.warn('[ParticleSnapshot] GPU readback failed:', e);
            } finally {
                snapshot.isCapturing = false;
            }
        })();
    }
    
    snapshot.lastSnapshotTime = currentTimeMs;
}

/**
 * Process readback data during idle time (non-blocking)
 * Called via requestIdleCallback to avoid blocking render
 */
function processReadbackData(snapshot, particleState, emitters, timestamp, deadline) {
    if (!snapshot.readbackPositions) return;
    
    const startTime = performance.now();
    const { meta, slotInfo, liveCount, instanceCount, freeSlots, maxCount } = particleState;
    const maxFromState = (Number.isFinite(maxCount) && maxCount > 0)
        ? maxCount
        : ((snapshot.readbackPositions?.length || 0) / 4) | 0;
    const particleCount = (Number.isFinite(instanceCount) && instanceCount > 0)
        ? Math.min(instanceCount | 0, maxFromState)
        : maxFromState;
    
    // Use the readback data instead of live positions/velocities
    const positions = snapshot.readbackPositions;
    const velocities = snapshot.readbackVelocities;
    
    const forceKeyframe = snapshot.keyframeInterval <= 1 ||
                          snapshot.framesSinceKeyframe >= snapshot.keyframeInterval ||
                          snapshot.frames.length === 0;
    
    const frame = new ParticleFrame(timestamp, forceKeyframe);
    frame.emitterStates = captureEmitterState(emitters);
    
    if (forceKeyframe) {
        const currentTimeSec = timestamp / 1000;
        const live = [];
        if (slotInfo) {
            for (let i = 0; i < particleCount; i++) {
                const si = i * 2;
                const lifetime = slotInfo[si + 1] || 0;
                if (!(lifetime > 0)) continue;
                live.push(i);
            }
        } else {
            for (let i = 0; i < particleCount; i++) live.push(i);
        }

        const liveCountPacked = live.length;
        const packedSize4 = liveCountPacked * 4;
        const packedSize2 = liveCountPacked * 2;

        frame.particleCount = particleCount;
        frame.liveCount = Number.isFinite(liveCount) ? (liveCount | 0) : liveCountPacked;
        frame.instanceCount = instanceCount || 0;
        frame.liveIndices = new Uint16Array(live);

        const packedPos = new Float32Array(packedSize4);
        const packedVel = new Float32Array(packedSize4);
        for (let j = 0; j < liveCountPacked; j++) {
            const i = live[j];
            const src4 = i * 4;
            const dst4 = j * 4;
            packedPos[dst4] = positions[src4] || 0;
            packedPos[dst4 + 1] = positions[src4 + 1] || 0;
            packedPos[dst4 + 2] = positions[src4 + 2] || 0;
            if (slotInfo) {
                const spawnTime = slotInfo[i * 2] || 0;
                const age = (spawnTime > 0) ? Math.max(0, currentTimeSec - spawnTime) : (positions[src4 + 3] || 0);
                packedPos[dst4 + 3] = age;
            } else {
                packedPos[dst4 + 3] = positions[src4 + 3] || 0;
            }
            packedVel[dst4] = velocities[src4] || 0;
            packedVel[dst4 + 1] = velocities[src4 + 1] || 0;
            packedVel[dst4 + 2] = velocities[src4 + 2] || 0;
            packedVel[dst4 + 3] = velocities[src4 + 3] || 0;
        }

        frame.positions = quantizePositionArray(packedPos);
        frame.velocities = quantizeVelocityArray(packedVel);

        if (meta) {
            frame.meta = new Float32Array(packedSize4);
            for (let j = 0; j < liveCountPacked; j++) {
                const i = live[j];
                const src4 = i * 4;
                const dst4 = j * 4;
                frame.meta[dst4] = meta[src4] ?? 1;
                frame.meta[dst4 + 1] = meta[src4 + 1] ?? 1;
                frame.meta[dst4 + 2] = meta[src4 + 2] ?? 1;
                frame.meta[dst4 + 3] = meta[src4 + 3] ?? 44000;
            }
        }

        if (slotInfo) {
            frame.slotInfo = new Float32Array(packedSize2);
            for (let j = 0; j < liveCountPacked; j++) {
                const i = live[j];
                const src2 = i * 2;
                const dst2 = j * 2;
                frame.slotInfo[dst2] = slotInfo[src2] || 0;
                frame.slotInfo[dst2 + 1] = slotInfo[src2 + 1] || 0;
            }
        }
        
        if (freeSlots && Array.isArray(freeSlots)) {
            frame.freeSlots = new Uint16Array(freeSlots);
        }
        
        frame._keyframeFormat = KEYFRAME_FORMAT.INT16;
        frame._integritySemantic = hashParticleKeyframeSemantic(frame);
        frame._integrityRaw = hashParticleKeyframe(frame);
        
        // Update previous state for next delta (MUST remain Float32 world-space values)
        // IMPORTANT: frame.positions/frame.velocities are Int16-quantized, and must NOT be used as prev state.
        // Using quantized data here breaks delta computation and leads to drift/corruption on restore.
        const dataSize = particleCount * 4;
        const slotSize = particleCount * 2;
        if (!snapshot.prevPositions || snapshot.prevPositions.length !== dataSize) {
            snapshot.prevPositions = new Float32Array(dataSize);
        }
        snapshot.prevPositions.set(positions.subarray(0, dataSize));

        // Ensure prevPositions.w stores computed age (not potentially stale CPU value)
        if (slotInfo && snapshot.prevPositions) {
            for (let i = 0; i < particleCount; i++) {
                const idx = i * 4;
                const slotIdx = i * 2;
                const currLifetime = slotInfo[slotIdx + 1] || 0;
                if (currLifetime > 0) {
                    const spawnTime = slotInfo[slotIdx] || 0;
                    if (spawnTime > 0) {
                        snapshot.prevPositions[idx + 3] = Math.max(0, currentTimeSec - spawnTime);
                    }
                }
            }
        }
        
        if (!snapshot.prevVelocities || snapshot.prevVelocities.length !== dataSize) {
            snapshot.prevVelocities = new Float32Array(dataSize);
        }
        snapshot.prevVelocities.set(velocities.subarray(0, dataSize));

        if (meta) {
            if (!snapshot.prevMeta || snapshot.prevMeta.length !== dataSize) {
                snapshot.prevMeta = new Float32Array(dataSize);
            }
            snapshot.prevMeta.set(meta.subarray(0, dataSize));
        }

        if (slotInfo) {
            if (!snapshot.prevSlotInfo || snapshot.prevSlotInfo.length !== slotSize) {
                snapshot.prevSlotInfo = new Float32Array(slotSize);
            }
            snapshot.prevSlotInfo.set(slotInfo.subarray(0, slotSize));
        }

        snapshot.prevLiveCount = Number.isFinite(liveCount) ? (liveCount | 0) : liveCountPacked;
        snapshot.prevInstanceCount = frame.instanceCount;
        snapshot.prevFreeSlots = freeSlots ? [...freeSlots] : [];
        
        snapshot.framesSinceKeyframe = 0;
        snapshot.stats.keyframes++;
    } else {
        // Delta frame - process in chunks if needed to stay within time budget
        const changedIndices = [];
        const positionDeltas = [];
        const velocityDeltas = [];
        const spawnedIndices = [];
        const diedIndices = [];
        
        const posThreshSq = snapshot.positionThreshold * snapshot.positionThreshold;
        const velThreshSq = snapshot.velocityThreshold * snapshot.velocityThreshold;
        const currentTimeSec = timestamp / 1000;
        
        // Process particles - check time budget periodically
        for (let i = 0; i < particleCount; i++) {
            const idx = i * 4;
            const slotIdx = i * 2;
            
            const prevLifetime = snapshot.prevSlotInfo ? snapshot.prevSlotInfo[slotIdx + 1] : 0;
            const currLifetime = slotInfo ? slotInfo[slotIdx + 1] : 0;
            const wasSpawned = prevLifetime === 0 && currLifetime > 0;
            const wasDied = prevLifetime > 0 && currLifetime === 0;
            
            if (wasSpawned) {
                spawnedIndices.push(i);
            } else if (wasDied) {
                diedIndices.push(i);
            } else if (currLifetime > 0 && snapshot.prevPositions) {
                const dx = positions[idx] - (snapshot.prevPositions[idx] || 0);
                const dy = positions[idx + 1] - (snapshot.prevPositions[idx + 1] || 0);
                const dz = positions[idx + 2] - (snapshot.prevPositions[idx + 2] || 0);
                const posDist = dx * dx + dy * dy + dz * dz;
                
                const dvx = velocities[idx] - (snapshot.prevVelocities[idx] || 0);
                const dvy = velocities[idx + 1] - (snapshot.prevVelocities[idx + 1] || 0);
                const dvz = velocities[idx + 2] - (snapshot.prevVelocities[idx + 2] || 0);
                const velDist = dvx * dvx + dvy * dvy + dvz * dvz;
                
                if (posDist > posThreshSq || velDist > velThreshSq) {
                    changedIndices.push(i);
                    positionDeltas.push([dx, dy, dz, 0]);
                    velocityDeltas.push([dvx, dvy, dvz, 0]);
                }
            }
        }
        
        // Skip frame if nothing changed (no movement, spawns, or deaths)
        // BUT always capture if this is the first frame or if we're approaching keyframe interval
        const hasChanges = changedIndices.length > 0 || spawnedIndices.length > 0 || diedIndices.length > 0;
        const isFirstFrame = snapshot.frames.length === 0;
        const needsKeyframeSoon = snapshot.framesSinceKeyframe >= (snapshot.keyframeInterval - 5);
        
        if (!hasChanges && !isFirstFrame && !needsKeyframeSoon) {
            // Nothing changed and not critical - skip snapshot
            snapshot.framesSinceKeyframe++;
            return;
        }
        
        // Convert to typed arrays with advanced compression
        if (changedIndices.length > 0) {
            // Use variable-length encoding for indices (saves ~50% on index storage)
            frame.changedIndices = packSmallIntegers(changedIndices);
            frame._isPackedIndices = true; // Flag for decoder
            
            const posDeltas = new Int16Array(changedIndices.length * 4);
            const velDeltas = new Int16Array(changedIndices.length * 4);
            for (let i = 0; i < changedIndices.length; i++) {
                const d = positionDeltas[i];
                posDeltas[i * 4] = quantizeFloat(d[0], POSITION_RANGE);
                posDeltas[i * 4 + 1] = quantizeFloat(d[1], POSITION_RANGE);
                posDeltas[i * 4 + 2] = quantizeFloat(d[2], POSITION_RANGE);
                posDeltas[i * 4 + 3] = 0;
                const v = velocityDeltas[i];
                velDeltas[i * 4] = quantizeFloat(v[0], VELOCITY_RANGE);
                velDeltas[i * 4 + 1] = quantizeFloat(v[1], VELOCITY_RANGE);
                velDeltas[i * 4 + 2] = quantizeFloat(v[2], VELOCITY_RANGE);
                velDeltas[i * 4 + 3] = 0;
            }
            frame.positionDeltas = posDeltas;
            frame.velocityDeltas = velDeltas;
        }
        // Use variable-length encoding for spawn/death indices
        if (spawnedIndices.length > 0) {
            frame.spawnedIndices = packSmallIntegers(spawnedIndices);
            frame._isPackedSpawned = true;
        }
        if (diedIndices.length > 0) {
            frame.diedIndices = packSmallIntegers(diedIndices);
            frame._isPackedDied = true;
        }
        
        // Update previous state
        if (snapshot.prevPositions) snapshot.prevPositions.set(positions);
        if (snapshot.prevVelocities) snapshot.prevVelocities.set(velocities);
        if (slotInfo && snapshot.prevSlotInfo) snapshot.prevSlotInfo.set(slotInfo);
        
        snapshot.framesSinceKeyframe++;
        snapshot.stats.deltaFrames++;
    }
    
    // Add frame to history
    snapshot.frames.push(frame);
    snapshot.stats.totalFrames++;
    snapshot.stats.totalBytes += frame.getByteSize();
    
    // Update timing stats
    const captureTime = performance.now() - startTime;
    snapshot.stats.avgCaptureTimeMs = snapshot.stats.avgCaptureTimeMs * 0.9 + captureTime * 0.1;
    
    // Trim if over budget (defer to next idle if no time left)
    const doTrim = () => {
        if (typeof snapshot._trimIfOverBudget === 'function') {
            snapshot._trimIfOverBudget();
        } else {
            trimIfOverBudget(snapshot);
            _maybeScheduleOffload(snapshot);
        }
    };
    if (hasTimeRemaining(deadline)) {
        doTrim();
    } else {
        scheduleIdleWork(() => doTrim());
    }
}

/**
 * Find nearest keyframe at or before target frame index
 */
function findKeyframeBefore(snapshot, frameIndex) {
    for (let i = Math.min(frameIndex, snapshot.frames.length - 1); i >= 0; i--) {
        if (snapshot.frames[i].isKeyframe) {
            return i;
        }
    }
    return -1;
}

/**
 * Reconstruct FULL particle state at a specific frame by applying deltas from keyframe
 * Includes positions, velocities, meta, slotInfo, liveCount, freeSlots - everything needed for complete rewind
 * Handles both quantized (Int16) and unquantized (Float32) data formats
 */
export function reconstructState(snapshot, frameIndex) {
    if (!snapshot || frameIndex < 0 || frameIndex >= snapshot.frames.length) {
        return null;
    }
    
    const keyframeIdx = findKeyframeBefore(snapshot, frameIndex);
    if (keyframeIdx < 0) return null;
    
    const keyframePlaceholder = snapshot.frames[keyframeIdx];
    let keyframe = keyframePlaceholder;
    if (_isOffloadedKeyframe(keyframePlaceholder)) {
        const loaded = _getLoadedKeyframe(snapshot, keyframeIdx);
        if (loaded) {
            keyframe = loaded;
        } else {
            _scheduleKeyframeLoad(snapshot, keyframeIdx);
            return null;
        }
    }

    if (!verifyParticleKeyframe(keyframe)) {
        return null;
    }
    
    // Start with keyframe state - handle all compression formats
    let positions, velocities;
    if (keyframe._losslessCompressed || keyframe._keyframeFormat === KEYFRAME_FORMAT.LOSSLESS || keyframe._quantizedPositions || keyframe._positionResiduals || keyframe._quantizedVelocities || keyframe._velocityResiduals) {
        // New lossless format: Int16 quantized + Float32 residuals = exact original
        positions = losslessDecompressPositions(keyframe);
        velocities = losslessDecompressVelocities(keyframe);
    } else if (keyframe._positionsCompressed && keyframe._positionsQuantized) {
        // Old tiered compression (deprecated)
        positions = decompressPositions(keyframe);
        velocities = decompressVelocities(keyframe);
    } else if (keyframe.positions instanceof Int16Array) {
        // Already quantized Int16 format
        positions = dequantizePositionArray(keyframe.positions);
        velocities = dequantizeVelocityArray(keyframe.velocities);
    } else if (keyframe.positions) {
        // Uncompressed Float32 format
        positions = new Float32Array(keyframe.positions);
        velocities = new Float32Array(keyframe.velocities);
    } else {
        // No position data available
        return null;
    }
    const particleCount = keyframe.particleCount;
    const liveIndices = (keyframe.liveIndices instanceof Uint16Array) ? keyframe.liveIndices : null;
    const packedMeta = keyframe.meta ? new Float32Array(keyframe.meta) : null;
    const packedSlotInfo = keyframe.slotInfo ? new Float32Array(keyframe.slotInfo) : null;
    let meta = packedMeta;
    let slotInfo = packedSlotInfo;

    if (liveIndices && Number.isFinite(particleCount) && particleCount > 0) {
        const denseCount4 = (particleCount | 0) * 4;
        const denseCount2 = (particleCount | 0) * 2;
        const densePositions = new Float32Array(denseCount4);
        const denseVelocities = new Float32Array(denseCount4);
        const denseMeta = packedMeta ? new Float32Array(denseCount4) : null;
        const denseSlotInfo = packedSlotInfo ? new Float32Array(denseCount2) : null;

        for (let i = 0; i < (particleCount | 0); i++) {
            const o = i * 4;
            densePositions[o] = 0;
            densePositions[o + 1] = -1000;
            densePositions[o + 2] = 0;
            densePositions[o + 3] = 999;
            if (denseMeta) {
                denseMeta[o] = 1;
                denseMeta[o + 1] = 1;
                denseMeta[o + 2] = 1;
                denseMeta[o + 3] = 44000;
            }
        }

        const liveCountPacked = Math.min(liveIndices.length, Math.floor((positions?.length || 0) / 4), Math.floor((velocities?.length || 0) / 4));
        for (let j = 0; j < liveCountPacked; j++) {
            const slot = liveIndices[j] | 0;
            if (slot < 0 || slot >= (particleCount | 0)) continue;
            const dst4 = slot * 4;
            const src4 = j * 4;
            densePositions[dst4] = positions[src4];
            densePositions[dst4 + 1] = positions[src4 + 1];
            densePositions[dst4 + 2] = positions[src4 + 2];
            densePositions[dst4 + 3] = positions[src4 + 3];
            denseVelocities[dst4] = velocities[src4];
            denseVelocities[dst4 + 1] = velocities[src4 + 1];
            denseVelocities[dst4 + 2] = velocities[src4 + 2];
            denseVelocities[dst4 + 3] = velocities[src4 + 3];
            if (denseMeta && packedMeta) {
                denseMeta[dst4] = packedMeta[src4];
                denseMeta[dst4 + 1] = packedMeta[src4 + 1];
                denseMeta[dst4 + 2] = packedMeta[src4 + 2];
                denseMeta[dst4 + 3] = packedMeta[src4 + 3];
            }
            if (denseSlotInfo && packedSlotInfo) {
                const dst2 = slot * 2;
                const src2 = j * 2;
                denseSlotInfo[dst2] = packedSlotInfo[src2];
                denseSlotInfo[dst2 + 1] = packedSlotInfo[src2 + 1];
            }
        }

        positions = densePositions;
        velocities = denseVelocities;
        meta = denseMeta;
        slotInfo = denseSlotInfo;
    }
    let liveCount = keyframe.liveCount;
    let instanceCount = keyframe.instanceCount;
    let freeSlots = keyframe.freeSlots ? Array.from(keyframe.freeSlots) : [];
    
    // Apply deltas from keyframe to target frame
    for (let f = keyframeIdx + 1; f <= frameIndex; f++) {
        const frame = snapshot.frames[f];
        if (frame.isKeyframe) continue;
        
        // Apply spawn events - particles that were born
        const spawnedIndices = frame._isPackedSpawned ? unpackSmallIntegers(frame.spawnedIndices) : (frame.spawnedIndices || null);
        const spawnedLen = spawnedIndices ? spawnedIndices.length : 0;
        for (let i = 0; i < spawnedLen; i++) {
            const particleIdx = spawnedIndices[i];
            const data = frame.spawnedData?.[i];
            if (!data) continue;
            const idx = particleIdx * 4;
            const slotIdx = particleIdx * 2;
            
            positions[idx] = data.pos[0];
            positions[idx + 1] = data.pos[1];
            positions[idx + 2] = data.pos[2];
            positions[idx + 3] = data.pos[3];
            
            velocities[idx] = data.vel[0];
            velocities[idx + 1] = data.vel[1];
            velocities[idx + 2] = data.vel[2];
            velocities[idx + 3] = data.vel[3];
            
            if (meta) {
                if (data.meta) {
                    meta[idx] = data.meta[0];
                    meta[idx + 1] = data.meta[1];
                    meta[idx + 2] = data.meta[2];
                    meta[idx + 3] = data.meta[3];
                } else {
                    // Default values if not stored
                    meta[idx] = 1;
                    meta[idx + 1] = 1;
                    meta[idx + 2] = 1;
                    meta[idx + 3] = 44000;
                }
            }
            
            if (slotInfo) {
                if (data.slot) {
                    slotInfo[slotIdx] = data.slot[0];
                    slotInfo[slotIdx + 1] = data.slot[1];
                } else {
                    const lifetime = data.vel?.[3] ?? 0;
                    slotInfo[slotIdx + 1] = lifetime;
                    const frameTimeSec = (frame.timestamp || 0) / 1000;
                    const age = data.pos?.[3] ?? 0;
                    const spawnTime = frameTimeSec - age;
                    slotInfo[slotIdx] = (spawnTime > 0) ? spawnTime : 0;
                }
            }
        }
        
        // Apply death events - particles that died
        const diedIndices = frame._isPackedDied ? unpackSmallIntegers(frame.diedIndices) : (frame.diedIndices || null);
        const diedLen = diedIndices ? diedIndices.length : 0;
        for (let i = 0; i < diedLen; i++) {
            const particleIdx = diedIndices[i];
            const slotIdx = particleIdx * 2;
            if (slotInfo) {
                slotInfo[slotIdx + 1] = 0; // Clear lifetime = dead
            }
        }
        
        // Apply position/velocity deltas for existing particles
        // Unpack indices if they were compressed
        const changedIndices = frame._isPackedIndices ? unpackSmallIntegers(frame.changedIndices) : (frame.changedIndices || null);
        const changedLen = changedIndices ? changedIndices.length : 0;
        const isQuantized = frame.positionDeltas instanceof Int16Array;
        for (let i = 0; i < changedLen; i++) {
            const particleIdx = changedIndices[i];
            const idx = particleIdx * 4;
            const slotIdx = particleIdx * 2;
            
            if (isQuantized) {
                // Quantized format: flat Int16Array, need to dequantize
                const di = i * 4;
                positions[idx] += dequantizeFloat(frame.positionDeltas[di], POSITION_RANGE);
                positions[idx + 1] += dequantizeFloat(frame.positionDeltas[di + 1], POSITION_RANGE);
                positions[idx + 2] += dequantizeFloat(frame.positionDeltas[di + 2], POSITION_RANGE);
                positions[idx + 3] += dequantizeFloat(frame.positionDeltas[di + 3], AGE_RANGE);
                
                velocities[idx] += dequantizeFloat(frame.velocityDeltas[di], VELOCITY_RANGE);
                velocities[idx + 1] += dequantizeFloat(frame.velocityDeltas[di + 1], VELOCITY_RANGE);
                velocities[idx + 2] += dequantizeFloat(frame.velocityDeltas[di + 2], VELOCITY_RANGE);
                velocities[idx + 3] += dequantizeFloat(frame.velocityDeltas[di + 3], AGE_RANGE);
            } else if (frame.positionDeltas?.[i]) {
                // Unquantized format: array of arrays
                positions[idx] += frame.positionDeltas[i][0];
                positions[idx + 1] += frame.positionDeltas[i][1];
                positions[idx + 2] += frame.positionDeltas[i][2];
                positions[idx + 3] += frame.positionDeltas[i][3];
                
                velocities[idx] += frame.velocityDeltas[i][0];
                velocities[idx + 1] += frame.velocityDeltas[i][1];
                velocities[idx + 2] += frame.velocityDeltas[i][2];
                velocities[idx + 3] += frame.velocityDeltas[i][3];
            }
            
            if (meta && frame.metaDeltas && !frame.metaDeltaIndices) {
                if (frame.metaDeltas instanceof Float32Array) {
                    const mi = i * 4;
                    meta[idx] += frame.metaDeltas[mi];
                    meta[idx + 1] += frame.metaDeltas[mi + 1];
                    meta[idx + 2] += frame.metaDeltas[mi + 2];
                    meta[idx + 3] += frame.metaDeltas[mi + 3];
                } else if (frame.metaDeltas[i]) {
                    meta[idx] += frame.metaDeltas[i][0];
                    meta[idx + 1] += frame.metaDeltas[i][1];
                    meta[idx + 2] += frame.metaDeltas[i][2];
                    meta[idx + 3] += frame.metaDeltas[i][3];
                }
            }
            
            if (slotInfo && frame.slotInfoDeltas && !frame.slotInfoDeltaIndices) {
                if (frame.slotInfoDeltas instanceof Float32Array) {
                    const si = i * 2;
                    slotInfo[slotIdx] += frame.slotInfoDeltas[si];
                    slotInfo[slotIdx + 1] += frame.slotInfoDeltas[si + 1];
                } else if (frame.slotInfoDeltas[i]) {
                    slotInfo[slotIdx] += frame.slotInfoDeltas[i][0];
                    slotInfo[slotIdx + 1] += frame.slotInfoDeltas[i][1];
                }
            }
        }

        if (meta && frame.metaDeltaIndices && frame.metaDeltas) {
            const ids = (frame.metaDeltaIndices instanceof Uint16Array)
                ? frame.metaDeltaIndices
                : new Uint16Array(frame.metaDeltaIndices);
            if (frame.metaDeltas instanceof Float32Array) {
                const deltas = frame.metaDeltas;
                for (let j = 0; j < ids.length; j++) {
                    const particleIdx = ids[j];
                    const pi = particleIdx * 4;
                    const di = j * 4;
                    meta[pi] += deltas[di];
                    meta[pi + 1] += deltas[di + 1];
                    meta[pi + 2] += deltas[di + 2];
                    meta[pi + 3] += deltas[di + 3];
                }
            }
        }

        if (slotInfo && frame.slotInfoDeltaIndices && frame.slotInfoDeltas) {
            const ids = (frame.slotInfoDeltaIndices instanceof Uint16Array)
                ? frame.slotInfoDeltaIndices
                : new Uint16Array(frame.slotInfoDeltaIndices);
            if (frame.slotInfoDeltas instanceof Float32Array) {
                const deltas = frame.slotInfoDeltas;
                for (let j = 0; j < ids.length; j++) {
                    const particleIdx = ids[j];
                    const pi = particleIdx * 2;
                    const di = j * 2;
                    slotInfo[pi] += deltas[di];
                    slotInfo[pi + 1] += deltas[di + 1];
                }
            }
        }
        
        // Apply count changes
        liveCount += frame.liveCountDelta || 0;
        instanceCount += frame.instanceCountDelta || 0;
        
        // Apply freeSlots changes
        for (const slot of frame.freeSlotsAdded || []) {
            if (!freeSlots.includes(slot)) freeSlots.push(slot);
        }
        for (const slot of frame.freeSlotsRemoved || []) {
            const idx = freeSlots.indexOf(slot);
            if (idx >= 0) freeSlots.splice(idx, 1);
        }
    }
    
    // Get shader state from nearest keyframe
    let shaderState = null;
    for (let f = frameIndex; f >= 0; f--) {
        if (snapshot.frames[f].shaderState) {
            shaderState = snapshot.frames[f].shaderState;
            break;
        }
    }
    
    return { 
        positions, 
        velocities, 
        meta,
        slotInfo,
        particleCount, 
        liveCount,
        instanceCount,
        freeSlots,
        shaderState,
        emitterStates: snapshot.frames[frameIndex].emitterStates 
    };
}

/**
 * Restore FULL particle state to a specific frame
 * @param {Object} snapshot - Snapshot system
 * @param {Object} particleState - Target particle state object to restore into
 * @param {Array} emitters - Emitter array
 * @param {number} frameIndex - Target frame index
 */
export function restoreToFrame(snapshot, particleState, emitters, frameIndex) {
    const state = reconstructState(snapshot, frameIndex);
    if (!state) {
        console.warn('[ParticleSnapshot] restoreToFrame: reconstructState returned null for frame', frameIndex);
        return false;
    }
    
    const { positions, velocities, meta, slotInfo, freeSlots, world } = particleState;
    
    // Copy ALL reconstructed state to CPU buffers
    for (let i = 0; i < state.positions.length; i++) {
        if (positions) positions[i] = state.positions[i];
        if (velocities) velocities[i] = state.velocities[i];
        if (meta && state.meta) meta[i] = state.meta[i];
    }
    
    // Restore slotInfo (spawn times and lifetimes)
    if (slotInfo && state.slotInfo) {
        for (let i = 0; i < state.slotInfo.length; i++) {
            slotInfo[i] = state.slotInfo[i];
        }
    }
    
    // Restore counts (set all count properties used by renderer)
    particleState.liveCount = state.liveCount;
    particleState.instanceCount = state.instanceCount;
    particleState.activeInstanceCount = state.instanceCount;
    
    // Restore freeSlots
    if (freeSlots && state.freeSlots) {
        freeSlots.length = 0;
        for (const slot of state.freeSlots) {
            freeSlots.push(slot);
        }
    }

    if (particleState) {
        const fs = particleState.freeSlots;
        if (fs && Array.isArray(fs)) {
            if (!(particleState.freeSlotsSet instanceof Set)) {
                particleState.freeSlotsSet = new Set();
            }
            particleState.freeSlotsSet.clear();
            for (let i = 0; i < fs.length; i++) {
                particleState.freeSlotsSet.add(fs[i]);
            }
        }
    }
    
    // Sync CPU arrays to GPU buffers for rendering
    if (world && world.device) {
        const device = world.device;
        if (positions && world.positionBuffer) {
            updateBuffer(device, world.positionBuffer, positions, 0);
        }
        if (velocities && world.velocityBuffer) {
            updateBuffer(device, world.velocityBuffer, velocities, 0);
        }
        if (meta && world.metaBuffer) {
            updateBuffer(device, world.metaBuffer, meta, 0);
        }
        
        // Restore shader/render state to world
        if (state.shaderState) {
            world.showLines = state.shaderState.showLines;
            world.showParticles = state.shaderState.showParticles;
            world.qualityScale = state.shaderState.qualityScale;
            world.connectionDistance = state.shaderState.connectionDistance;
            world.activeParticleCount = state.shaderState.activeParticleCount;
        }
        
    }
    
    // Restore emitter state
    restoreEmitterState(emitters, state.emitterStates);
    
    return true;
}

/**
 * Restore with interpolation between two frames
 * @param {Object} snapshot - Snapshot system
 * @param {Object} particleState - Target particle state object
 * @param {Array} emitters - Emitter array
 * @param {number} frameA - First frame index
 * @param {number} frameB - Second frame index
 * @param {number} t - Interpolation factor (0-1)
 */
export function restoreInterpolated(snapshot, particleState, emitters, frameA, frameB, t) {
    // Use advanced interpolation if enabled (Catmull-Rom or Hermite)
    if (snapshot.useAdvancedInterpolation) {
        return advancedInterpolate(snapshot, particleState, emitters, frameA, frameB, t);
    }
    
    // Cache reconstructed states to avoid redundant work during scrubbing
    if (!snapshot._scrubCache) snapshot._scrubCache = {};
    
    let stateA = snapshot._scrubCache[frameA];
    if (!stateA) {
        stateA = reconstructState(snapshot, frameA);
        if (stateA) snapshot._scrubCache[frameA] = stateA;
    }
    
    let stateB = snapshot._scrubCache[frameB];
    if (!stateB) {
        stateB = reconstructState(snapshot, frameB);
        if (stateB) snapshot._scrubCache[frameB] = stateB;
    }
    
    // Limit cache size to avoid memory bloat
    const cacheKeys = Object.keys(snapshot._scrubCache);
    if (cacheKeys.length > 4) {
        // Keep only the 2 most recent frames
        const toRemove = cacheKeys.filter(k => +k !== frameA && +k !== frameB);
        for (const k of toRemove) delete snapshot._scrubCache[k];
    }
    if (!stateA || !stateB) return false;
    
    const { positions, velocities, meta, slotInfo, freeSlots, world } = particleState;
    const count = Math.min(stateA.positions.length, stateB.positions.length);
    
    // Apply easing to interpolation factor
    const easingFn = EASING[snapshot.easingType] || EASING.smoothstep;
    const easedT = easingFn(t);
    
    // Interpolate positions and velocities with easing
    for (let i = 0; i < count; i++) {
        if (positions) positions[i] = stateA.positions[i] + (stateB.positions[i] - stateA.positions[i]) * easedT;
        if (velocities) velocities[i] = stateA.velocities[i] + (stateB.velocities[i] - stateA.velocities[i]) * easedT;
        if (meta && stateA.meta && stateB.meta) {
            meta[i] = stateA.meta[i] + (stateB.meta[i] - stateA.meta[i]) * easedT;
        }
    }
    
    // For slotInfo, use the state closer to t
    const useStateB = t >= 0.5;
    const slotState = useStateB ? stateB : stateA;
    if (slotInfo && slotState.slotInfo) {
        for (let i = 0; i < slotState.slotInfo.length; i++) {
            slotInfo[i] = slotState.slotInfo[i];
        }
    }
    
    // Interpolate counts (set all count properties used by renderer)
    particleState.liveCount = Math.round(stateA.liveCount + (stateB.liveCount - stateA.liveCount) * t);
    particleState.instanceCount = Math.round(stateA.instanceCount + (stateB.instanceCount - stateA.instanceCount) * t);
    particleState.activeInstanceCount = particleState.instanceCount;
    
    // Use freeSlots from closer state
    if (freeSlots && slotState.freeSlots) {
        freeSlots.length = 0;
        for (const slot of slotState.freeSlots) {
            freeSlots.push(slot);
        }
    }

    if (particleState) {
        const fs = particleState.freeSlots;
        if (fs && Array.isArray(fs)) {
            if (!(particleState.freeSlotsSet instanceof Set)) {
                particleState.freeSlotsSet = new Set();
            }
            particleState.freeSlotsSet.clear();
            for (let i = 0; i < fs.length; i++) {
                particleState.freeSlotsSet.add(fs[i]);
            }
        }
    }
    
    // Sync CPU arrays to GPU buffers for rendering
    if (world && world.device) {
        const device = world.device;
        if (positions && world.positionBuffer) {
            updateBuffer(device, world.positionBuffer, positions, 0);
        }
        if (velocities && world.velocityBuffer) {
            updateBuffer(device, world.velocityBuffer, velocities, 0);
        }
        if (meta && world.metaBuffer) {
            updateBuffer(device, world.metaBuffer, meta, 0);
        }
        
        // Interpolate and restore shader/render state
        const shaderA = stateA.shaderState;
        const shaderB = stateB.shaderState;
        if (shaderA && shaderB) {
            world.showLines = easedT < 0.5 ? shaderA.showLines : shaderB.showLines;
            world.showParticles = easedT < 0.5 ? shaderA.showParticles : shaderB.showParticles;
            world.qualityScale = shaderA.qualityScale + (shaderB.qualityScale - shaderA.qualityScale) * easedT;
            world.connectionDistance = shaderA.connectionDistance + (shaderB.connectionDistance - shaderA.connectionDistance) * easedT;
            world.activeParticleCount = Math.round(shaderA.activeParticleCount + (shaderB.activeParticleCount - shaderA.activeParticleCount) * easedT);
        } else if (shaderA || shaderB) {
            const shader = shaderA || shaderB;
            world.showLines = shader.showLines;
            world.showParticles = shader.showParticles;
            world.qualityScale = shader.qualityScale;
            world.connectionDistance = shader.connectionDistance;
            world.activeParticleCount = shader.activeParticleCount;
        }
        
    } else {
        console.warn('[ParticleSnapshot] GPU sync SKIPPED - world:', !!world, 'device:', !!(world?.device));
    }
    
    interpolateEmitterState(emitters, stateA.emitterStates, stateB.emitterStates, t);
    
    return true;
}

/**
 * Seek to specific time
 * @param {Object} snapshot - Snapshot system
 * @param {Object} particleState - Target particle state object
 * @param {Array} emitters - Emitter array
 * @param {number} targetTimeMs - Target time in milliseconds
 */
export function seekToTime(snapshot, particleState, emitters, targetTimeMs) {
    if (!snapshot || snapshot.frames.length === 0) {
        console.warn('[ParticleSnapshot] seekToTime: no frames captured');
        return false;
    }
    
    // Find frames bracketing target time
    let frameA = 0, frameB = snapshot.frames.length - 1;
    
    for (let i = 0; i < snapshot.frames.length; i++) {
        if (snapshot.frames[i].timestamp <= targetTimeMs) {
            frameA = i;
        }
        if (snapshot.frames[i].timestamp >= targetTimeMs) {
            frameB = i;
            break;
        }
    }
    
    // Ensure frameB >= frameA (handle edge case where target is beyond all frames)
    if (frameB < frameA) {
        frameB = frameA;
    }

    const kA = findKeyframeBefore(snapshot, frameA);
    if (kA >= 0) _scheduleKeyframeLoad(snapshot, kA);
    const kB = findKeyframeBefore(snapshot, frameB);
    if (kB >= 0) _scheduleKeyframeLoad(snapshot, kB);
    
    if (frameA === frameB) {
        return restoreToFrame(snapshot, particleState, emitters, frameA);
    }
    
    const timeA = snapshot.frames[frameA].timestamp;
    const timeB = snapshot.frames[frameB].timestamp;
    const t = (targetTimeMs - timeA) / (timeB - timeA);
    
    return restoreInterpolated(snapshot, particleState, emitters, frameA, frameB, t);
}

/**
 * Start rewind mode
 */
export function startRewind(snapshot) {
    if (!snapshot || snapshot.frames.length === 0) return false;
    snapshot.isRewinding = true;
    snapshot.playbackFrame = snapshot.frames.length - 1;
    snapshot.playbackSpeed = -1;
    return true;
}

/**
 * Stop rewind
 */
export function stopRewind(snapshot) {
    if (!snapshot) return;
    snapshot.isRewinding = false;
}

/**
 * Step rewind playback - restores FULL particle state including spawn/death
 * @param {Object} snapshot - Snapshot system
 * @param {Object} particleState - Target particle state object
 * @param {Array} emitters - Emitter array
 * @param {number} dtMs - Delta time in milliseconds
 */
export function stepRewind(snapshot, particleState, emitters, dtMs) {
    if (!snapshot || !snapshot.isRewinding) return;
    
    const frameStep = snapshot.playbackSpeed * (dtMs / 1000) / snapshot.snapshotInterval;
    snapshot.playbackFrame += frameStep;
    snapshot.playbackFrame = Math.max(0, Math.min(snapshot.frames.length - 1, snapshot.playbackFrame));
    
    const frameA = Math.floor(snapshot.playbackFrame);
    const frameB = Math.min(frameA + 1, snapshot.frames.length - 1);
    const t = snapshot.playbackFrame - frameA;
    
    if (frameA === frameB) {
        restoreToFrame(snapshot, particleState, emitters, frameA);
    } else {
        restoreInterpolated(snapshot, particleState, emitters, frameA, frameB, t);
    }
}

/**
 * Set playback speed
 */
export function setPlaybackSpeed(snapshot, speed) {
    if (!snapshot) return;
    snapshot.playbackSpeed = speed;
}

/**
 * Set easing type for interpolation
 * @param {Object} snapshot - Snapshot system
 * @param {string} easingType - One of: linear, easeInQuad, easeOutQuad, easeInOutQuad, 
 *                              easeInCubic, easeOutCubic, easeInOutCubic, easeOutElastic,
 *                              easeOutBounce, smoothstep, smootherstep
 */
export function setEasingType(snapshot, easingType) {
    if (!snapshot) return;
    if (EASING[easingType]) {
        snapshot.easingType = easingType;
    } else {
        console.warn(`[ParticleSnapshot] Unknown easing type: ${easingType}, available:`, Object.keys(EASING));
    }
}

/**
 * Get available easing types
 */
export function getEasingTypes() {
    return Object.keys(EASING);
}

/**
 * Get snapshot info
 */
export function getSnapshotInfo(snapshot) {
    if (!snapshot) return null;
    
    const oldestTime = snapshot.frames.length > 0 ? snapshot.frames[0].timestamp : 0;
    const newestTime = snapshot.frames.length > 0 ? snapshot.frames[snapshot.frames.length - 1].timestamp : 0;
    
    return {
        frameCount: snapshot.frames.length,
        keyframes: snapshot.stats.keyframes,
        deltaFrames: snapshot.stats.deltaFrames,
        totalBytes: snapshot.stats.totalBytes,
        avgDeltaSize: snapshot.stats.avgDeltaSize,
        memoryMB: snapshot.stats.totalBytes / 1024 / 1024,
        isRewinding: snapshot.isRewinding,
        playbackFrame: snapshot.playbackFrame,
        playbackSpeed: snapshot.playbackSpeed,
        oldestTime,
        newestTime,
        historyDurationMs: newestTime - oldestTime,
    };
}

export function truncateHistoryAfterTime(snapshot, timeMs) {
    if (!snapshot || !snapshot.frames || snapshot.frames.length === 0) return false;
    if (typeof timeMs !== 'number' || !Number.isFinite(timeMs)) return false;

    const oldFrames = snapshot.frames;
    const oldLen = oldFrames.length;

    let keepCount = 0;
    for (let i = 0; i < snapshot.frames.length; i++) {
        if (snapshot.frames[i].timestamp <= timeMs) {
            keepCount = i + 1;
        } else {
            break;
        }
    }

    if (keepCount >= oldLen) {
        return false;
    }

    snapshot._historyEpoch = (snapshot._historyEpoch || 0) + 1;

    if (keepCount < oldLen && typeof snapshot._freeFrame === 'function') {
        for (let i = keepCount; i < oldLen; i++) {
            const f = oldFrames[i];
            if (f?.isKeyframe && f._offloaded) {
                Promise.resolve(snapshot._freeFrame(i)).catch(() => {});
            }
        }
    }

    if (snapshot._loadedKeyframesLRU instanceof Map) {
        for (const k of Array.from(snapshot._loadedKeyframesLRU.keys())) {
            if ((k | 0) >= keepCount) snapshot._loadedKeyframesLRU.delete(k);
        }
    }

    if (snapshot._keyframeLoadPromises instanceof Map) {
        snapshot._keyframeLoadPromises.clear();
    }

    if (keepCount <= 0) {
        snapshot.frames = [];
    } else {
        snapshot.frames.length = keepCount;
    }

    snapshot._scrubCache = null;

    let totalBytes = 0;
    let keyframes = 0;
    let deltaFrames = 0;
    for (let i = 0; i < snapshot.frames.length; i++) {
        const f = snapshot.frames[i];
        const sz = (f && typeof f.getByteSize === 'function') ? f.getByteSize() : (f?.byteSize || 0);
        totalBytes += sz;
        if (f?.isKeyframe) keyframes++;
        else deltaFrames++;
    }
    snapshot.stats.totalBytes = totalBytes;
    snapshot.stats.totalFrames = snapshot.frames.length;
    snapshot.stats.keyframes = keyframes;
    snapshot.stats.deltaFrames = deltaFrames;
    snapshot.stats.avgDeltaSize = snapshot.stats.totalFrames > 0 ? (totalBytes / snapshot.stats.totalFrames) : 0;
    snapshot._hardOverBudget = snapshot.memoryBudgetBytes ? (snapshot.stats.totalBytes > snapshot.memoryBudgetBytes) : false;

    snapshot.prevPositions = null;
    snapshot.prevVelocities = null;
    snapshot.prevMeta = null;
    snapshot.prevSlotInfo = null;
    snapshot.prevLiveCount = 0;
    snapshot.prevInstanceCount = 0;
    snapshot.prevFreeSlots = null;

    snapshot.framesSinceKeyframe = snapshot.keyframeInterval;
    snapshot.lastSnapshotTime = timeMs - (snapshot.snapshotInterval * 1000);

    snapshot._warnedHardOverBudget = false;
    return true;
}

/**
 * Clear all history
 */
export function clearHistory(snapshot) {
    if (!snapshot) return;
    const oldFrames = snapshot.frames || [];
    const oldLen = oldFrames.length;

    snapshot._historyEpoch = (snapshot._historyEpoch || 0) + 1;

    if (snapshot._keyframeLoadPromises instanceof Map) snapshot._keyframeLoadPromises.clear();
    if (snapshot._loadedKeyframesLRU instanceof Map) snapshot._loadedKeyframesLRU.clear();
    snapshot._offloadScheduled = false;
    snapshot._offloadInFlight = false;

    if (oldLen > 0 && typeof snapshot._freeFrame === 'function') {
        for (let i = 0; i < oldLen; i++) {
            const f = oldFrames[i];
            if (f?.isKeyframe && f._offloaded) {
                Promise.resolve(snapshot._freeFrame(i)).catch(() => {});
            }
        }
    }
    snapshot.frames = [];
    snapshot.framesSinceKeyframe = 0;
    snapshot.prevPositions = null;
    snapshot.prevVelocities = null;
    snapshot.prevMeta = null;
    snapshot.prevSlotInfo = null;
    snapshot.prevLiveCount = 0;
    snapshot.prevInstanceCount = 0;
    snapshot.prevFreeSlots = null;
    snapshot.playbackFrame = 0;
    snapshot.isRewinding = false;
    snapshot.isCapturing = false;
    snapshot.lastSnapshotTime = 0;  // Critical: reset so new captures work
    snapshot._warnedNoPositions = false;  // Reset debug flag
    snapshot._warnedHardOverBudget = false;
    snapshot._hardOverBudget = false;
    snapshot._scrubCache = null;
    snapshot.stats = {
        totalFrames: 0,
        keyframes: 0,
        deltaFrames: 0,
        totalBytes: 0,
        avgDeltaSize: 0,
        droppedFrames: 0,
        avgCaptureTimeMs: 0,
    };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
    createDeltaSnapshotSystem,
    captureFrame,
    autoCapture,
    reconstructState,
    restoreToFrame,
    restoreInterpolated,
    seekToTime,
    startRewind,
    stopRewind,
    stepRewind,
    setPlaybackSpeed,
    getSnapshotInfo,
    truncateHistoryAfterTime,
    clearHistory,
};
