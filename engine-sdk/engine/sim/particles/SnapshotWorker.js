// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SnapshotWorker.js - Offload heavy snapshot compression to a separate thread
 * 
 * This worker handles:
 * - Delta calculation between frames
 * - Quantization of position/velocity data
 * - Compression of frame data
 * - Memory management for snapshot history
 * 
 * The main thread only does GPU readback (can't be done in workers) and sends
 * the raw data here for processing.
 */

import {
    packSignedRangeSNORM16,
    unpackSignedRangeSNORM16,
} from '../../core/math/MathPacking.js';

// Worker snapshot ranges are intentionally wider than ParticleSnapshotDelta.js defaults.
const POSITION_RANGE = 10000.0;
const VELOCITY_RANGE = 1000.0;
const AGE_RANGE = 300.0;
const POSITION_THRESHOLD = 0.01;
const VELOCITY_THRESHOLD = 0.1;

// Quantization helpers
function quantizeFloat(value, range) {
    return packSignedRangeSNORM16(value, range, 0);
}

function dequantizeFloat(quantized, range) {
    return unpackSignedRangeSNORM16(quantized, range, 0);
}

// State
let prevPositions = null;
let prevVelocities = null;
let prevMeta = null;
let prevSlotInfo = null;
let prevLiveCount = 0;
let prevInstanceCount = 0;
let prevFreeSlots = [];
let framesSinceKeyframe = 0;
let keyframeInterval = 60;
let positionThreshold = POSITION_THRESHOLD;
let velocityThreshold = VELOCITY_THRESHOLD;

// Reusable Sets for delta tracking
const tempCurrentFreeSet = new Set();
const tempPrevFreeSet = new Set();

/**
 * Process a frame capture request
 */
function processCapture(data) {
    const { 
        positions, velocities, meta, slotInfo, 
        liveCount, instanceCount, freeSlots, 
        particleCount, currentTimeMs, emitterStates,
        forceKeyframe 
    } = data;
    
    const isKeyframe = forceKeyframe || framesSinceKeyframe >= keyframeInterval || !prevPositions;
    
    const result = {
        timestamp: currentTimeMs,
        isKeyframe,
        emitterStates,
        byteSize: 0
    };
    
    if (isKeyframe) {
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

        result.positions = quantizePositionArray(packedPos, liveCountPacked);
        result.velocities = quantizeVelocityArray(packedVel, liveCountPacked);

        result.meta = null;
        if (meta) {
            result.meta = new Float32Array(packedSize4);
            for (let j = 0; j < liveCountPacked; j++) {
                const i = live[j];
                const src4 = i * 4;
                const dst4 = j * 4;
                result.meta[dst4] = meta[src4] ?? 1;
                result.meta[dst4 + 1] = meta[src4 + 1] ?? 1;
                result.meta[dst4 + 2] = meta[src4 + 2] ?? 1;
                result.meta[dst4 + 3] = meta[src4 + 3] ?? 44000;
            }
        }

        result.slotInfo = null;
        if (slotInfo) {
            result.slotInfo = new Float32Array(packedSize2);
            for (let j = 0; j < liveCountPacked; j++) {
                const i = live[j];
                const src2 = i * 2;
                const dst2 = j * 2;
                result.slotInfo[dst2] = slotInfo[src2] || 0;
                result.slotInfo[dst2 + 1] = slotInfo[src2 + 1] || 0;
            }
        }

        result.liveIndices = new Uint16Array(live);
        result.particleCount = particleCount;
        result.liveCount = Number.isFinite(liveCount) ? (liveCount | 0) : liveCountPacked;
        result.instanceCount = instanceCount;
        result.freeSlots = freeSlots ? new Uint16Array(freeSlots) : null;
        
        // Update prev state
        prevPositions = new Float32Array(positions);
        prevVelocities = new Float32Array(velocities);
        prevMeta = meta ? new Float32Array(meta) : null;
        prevSlotInfo = slotInfo ? new Float32Array(slotInfo) : null;
        prevLiveCount = Number.isFinite(liveCount) ? (liveCount | 0) : liveCountPacked;
        prevInstanceCount = (instanceCount || 0);
        prevFreeSlots = freeSlots ? [...freeSlots] : [];

        // Ensure prevPositions.w stores computed age (not potentially stale CPU value)
        if (slotInfo && prevPositions) {
            for (let i = 0; i < particleCount; i++) {
                const idx = i * 4;
                const slotIdx = i * 2;
                const currLifetime = slotInfo[slotIdx + 1] || 0;
                if (currLifetime > 0) {
                    const spawnTime = slotInfo[slotIdx] || 0;
                    if (spawnTime > 0) {
                        prevPositions[idx + 3] = Math.max(0, currentTimeSec - spawnTime);
                    }
                }
            }
        }
        
        framesSinceKeyframe = 0;
        
        result.byteSize = (result.positions?.byteLength || 0) + 
                          (result.velocities?.byteLength || 0) +
                          (result.meta?.byteLength || 0) +
                          (result.slotInfo?.byteLength || 0) +
                          (result.freeSlots?.byteLength || 0) +
                          (result.liveIndices?.byteLength || 0);
    } else {
        // Delta frame - only changed particles
        const delta = computeDelta(
            positions, velocities, meta, slotInfo,
            liveCount, instanceCount, freeSlots,
            particleCount, currentTimeMs
        );
        
        Object.assign(result, delta);
        framesSinceKeyframe++;
    }
    
    return result;
}

/**
 * Compute delta between current and previous frame
 */
function computeDelta(positions, velocities, meta, slotInfo, liveCount, instanceCount, freeSlots, particleCount, currentTimeMs) {
    const posThreshSq = positionThreshold * positionThreshold;
    const velThreshSq = velocityThreshold * velocityThreshold;
    const currentTimeSec = currentTimeMs / 1000;
    
    const changedIndices = [];
    const positionDeltas = [];
    const velocityDeltas = [];
    const spawnedIndices = [];
    const spawnedData = [];
    const diedIndices = [];
    const freeSlotsAdded = [];
    const freeSlotsRemoved = [];

    const metaDeltaIndices = [];
    const metaDeltasPacked = [];
    const slotInfoDeltaIndices = [];
    const slotInfoDeltasPacked = [];
    
    // Track count changes
    const liveCountDelta = (liveCount || 0) - prevLiveCount;
    const instanceCountDelta = (instanceCount || 0) - prevInstanceCount;
    
    // Track freeSlots changes
    tempCurrentFreeSet.clear();
    tempPrevFreeSet.clear();
    
    if (freeSlots) {
        for (let i = 0; i < freeSlots.length; i++) {
            tempCurrentFreeSet.add(freeSlots[i]);
        }
    }
    for (let i = 0; i < prevFreeSlots.length; i++) {
        tempPrevFreeSet.add(prevFreeSlots[i]);
    }
    
    for (const slot of tempCurrentFreeSet) {
        if (!tempPrevFreeSet.has(slot)) {
            freeSlotsAdded.push(slot);
        }
    }
    for (const slot of tempPrevFreeSet) {
        if (!tempCurrentFreeSet.has(slot)) {
            freeSlotsRemoved.push(slot);
        }
    }
    
    // Check each particle for changes - ONLY process live particles
    for (let i = 0; i < particleCount; i++) {
        const slotIdx = i * 2;
        
        // Early exit: Skip dead particles entirely
        const currLifetime = slotInfo ? slotInfo[slotIdx + 1] : 0;
        const prevLifetime = prevSlotInfo ? prevSlotInfo[slotIdx + 1] : 0;
        
        // Skip if particle is dead and was dead
        if (currLifetime === 0 && prevLifetime === 0) continue;
        
        const idx = i * 4;
        const wasSpawned = prevLifetime === 0 && currLifetime > 0;
        const wasDied = prevLifetime > 0 && currLifetime === 0;
        
        // Calculate age
        let currentAge = positions[idx + 3] || 0;
        if (slotInfo && currLifetime > 0) {
            const spawnTime = slotInfo[slotIdx] || 0;
            if (spawnTime > 0) {
                currentAge = Math.max(0, currentTimeSec - spawnTime);
            }
        }
        
        if (wasSpawned) {
            spawnedIndices.push(i);
            spawnedData.push({
                pos: [positions[idx], positions[idx+1], positions[idx+2], currentAge],
                vel: [velocities[idx], velocities[idx+1], velocities[idx+2], velocities[idx+3]],
                meta: meta ? [meta[idx], meta[idx+1], meta[idx+2], meta[idx+3]] : [1,1,1,1],
                slot: slotInfo ? [slotInfo[slotIdx], slotInfo[slotIdx+1]] : [0,0]
            });
        } else if (wasDied) {
            diedIndices.push(i);
        } else if (currLifetime > 0) {
            // Check for significant movement
            const dx = positions[idx] - (prevPositions?.[idx] || 0);
            const dy = positions[idx+1] - (prevPositions?.[idx+1] || 0);
            const dz = positions[idx+2] - (prevPositions?.[idx+2] || 0);
            const distSq = dx*dx + dy*dy + dz*dz;
            
            const dvx = velocities[idx] - (prevVelocities?.[idx] || 0);
            const dvy = velocities[idx+1] - (prevVelocities?.[idx+1] || 0);
            const dvz = velocities[idx+2] - (prevVelocities?.[idx+2] || 0);
            const velDistSq = dvx*dvx + dvy*dvy + dvz*dvz;

            const prevAge = prevPositions?.[idx + 3] || 0;
            const dAge = currentAge - prevAge;
            
            if (distSq > posThreshSq || velDistSq > velThreshSq || Math.abs(dAge) > 0.001) {
                changedIndices.push(i);
                positionDeltas.push(
                    quantizeFloat(dx, POSITION_RANGE),
                    quantizeFloat(dy, POSITION_RANGE),
                    quantizeFloat(dz, POSITION_RANGE),
                    quantizeFloat(dAge, AGE_RANGE)
                );
                velocityDeltas.push(
                    quantizeFloat(dvx, VELOCITY_RANGE),
                    quantizeFloat(dvy, VELOCITY_RANGE),
                    quantizeFloat(dvz, VELOCITY_RANGE),
                    quantizeFloat(velocities[idx+3] - (prevVelocities?.[idx+3] || 0), AGE_RANGE)
                );

                if (meta && prevMeta) {
                    const dm0 = meta[idx] - prevMeta[idx];
                    const dm1 = meta[idx + 1] - prevMeta[idx + 1];
                    const dm2 = meta[idx + 2] - prevMeta[idx + 2];
                    const dm3 = meta[idx + 3] - prevMeta[idx + 3];
                    if (dm0 !== 0 || dm1 !== 0 || dm2 !== 0 || dm3 !== 0) {
                        metaDeltaIndices.push(i);
                        metaDeltasPacked.push(dm0, dm1, dm2, dm3);
                    }
                }

                if (slotInfo && prevSlotInfo) {
                    const ds0 = slotInfo[slotIdx] - prevSlotInfo[slotIdx];
                    const ds1 = slotInfo[slotIdx + 1] - prevSlotInfo[slotIdx + 1];
                    if (ds0 !== 0 || ds1 !== 0) {
                        slotInfoDeltaIndices.push(i);
                        slotInfoDeltasPacked.push(ds0, ds1);
                    }
                }
            }
        }
    }
    
    // Update prev state
    if (positions) {
        if (!prevPositions || prevPositions.length !== positions.length) {
            prevPositions = new Float32Array(positions.length);
        }
        // Copy xyz and store computed age in w
        for (let i = 0; i < particleCount; i++) {
            const idx = i * 4;
            const slotIdx = i * 2;
            prevPositions[idx] = positions[idx] || 0;
            prevPositions[idx + 1] = positions[idx + 1] || 0;
            prevPositions[idx + 2] = positions[idx + 2] || 0;

            let age = positions[idx + 3] || 0;
            const currLifetime = slotInfo ? (slotInfo[slotIdx + 1] || 0) : 0;
            if (slotInfo && currLifetime > 0) {
                const spawnTime = slotInfo[slotIdx] || 0;
                if (spawnTime > 0) {
                    age = Math.max(0, currentTimeSec - spawnTime);
                }
            }
            prevPositions[idx + 3] = age;
        }
    }
    if (velocities) {
        if (!prevVelocities || prevVelocities.length !== velocities.length) {
            prevVelocities = new Float32Array(velocities.length);
        }
        prevVelocities.set(velocities);
    }
    if (meta) {
        if (!prevMeta || prevMeta.length !== meta.length) {
            prevMeta = new Float32Array(meta.length);
        }
        prevMeta.set(meta);
    } else {
        prevMeta = null;
    }
    if (slotInfo) {
        if (!prevSlotInfo || prevSlotInfo.length !== slotInfo.length) {
            prevSlotInfo = new Float32Array(slotInfo.length);
        }
        prevSlotInfo.set(slotInfo);
    }
    prevLiveCount = liveCount || 0;
    prevInstanceCount = instanceCount || 0;
    prevFreeSlots = freeSlots ? [...freeSlots] : [];
    
    // Convert to typed arrays for transfer
    const result = {
        changedIndices: new Uint16Array(changedIndices),
        positionDeltas: new Int16Array(positionDeltas),
        velocityDeltas: new Int16Array(velocityDeltas),
        metaDeltaIndices: metaDeltaIndices.length > 0 ? new Uint16Array(metaDeltaIndices) : null,
        metaDeltas: metaDeltasPacked.length > 0 ? new Float32Array(metaDeltasPacked) : null,
        slotInfoDeltaIndices: slotInfoDeltaIndices.length > 0 ? new Uint16Array(slotInfoDeltaIndices) : null,
        slotInfoDeltas: slotInfoDeltasPacked.length > 0 ? new Float32Array(slotInfoDeltasPacked) : null,
        spawnedIndices: new Uint16Array(spawnedIndices),
        spawnedData,
        diedIndices: new Uint16Array(diedIndices),
        freeSlotsAdded: new Uint16Array(freeSlotsAdded),
        freeSlotsRemoved: new Uint16Array(freeSlotsRemoved),
        liveCountDelta,
        instanceCountDelta,
        byteSize: changedIndices.length * 2 + positionDeltas.length * 2 + 
                  velocityDeltas.length * 2 + spawnedData.length * 32 +
                  diedIndices.length * 2 +
                  metaDeltaIndices.length * 2 + metaDeltasPacked.length * 4 +
                  slotInfoDeltaIndices.length * 2 + slotInfoDeltasPacked.length * 4
    };
    
    return result;
}

/**
 * Quantize positions to Int16
 */
function quantizePositionArray(positions, particleCount) {
    const count = particleCount * 4;
    const quantized = new Int16Array(count);
    for (let i = 0; i < count; i += 4) {
        quantized[i] = quantizeFloat(positions[i], POSITION_RANGE);
        quantized[i + 1] = quantizeFloat(positions[i + 1], POSITION_RANGE);
        quantized[i + 2] = quantizeFloat(positions[i + 2], POSITION_RANGE);
        quantized[i + 3] = quantizeFloat(positions[i + 3], AGE_RANGE);
    }
    return quantized;
}

/**
 * Quantize velocities to Int16
 */
function quantizeVelocityArray(velocities, particleCount) {
    const count = particleCount * 4;
    const quantized = new Int16Array(count);
    for (let i = 0; i < count; i += 4) {
        quantized[i] = quantizeFloat(velocities[i], VELOCITY_RANGE);
        quantized[i + 1] = quantizeFloat(velocities[i + 1], VELOCITY_RANGE);
        quantized[i + 2] = quantizeFloat(velocities[i + 2], VELOCITY_RANGE);
        quantized[i + 3] = quantizeFloat(velocities[i + 3], AGE_RANGE);
    }
    return quantized;
}

// Message handler
self.onmessage = function(e) {
    const { type, data, id } = e.data;
    
    switch (type) {
        case 'init':
            keyframeInterval = data.keyframeInterval || 60;
            positionThreshold = data.positionThreshold || POSITION_THRESHOLD;
            velocityThreshold = data.velocityThreshold || VELOCITY_THRESHOLD;
            framesSinceKeyframe = 0;
            prevPositions = null;
            prevVelocities = null;
            prevMeta = null;
            prevSlotInfo = null;
            prevLiveCount = 0;
            prevInstanceCount = 0;
            prevFreeSlots = [];
            self.postMessage({ type: 'init_done', id });
            break;
            
        case 'capture':
            try {
                const result = processCapture(data);
                // Transfer typed arrays back to main thread
                const transferables = [];
                if (result.positions) transferables.push(result.positions.buffer);
                if (result.velocities) transferables.push(result.velocities.buffer);
                if (result.meta) transferables.push(result.meta.buffer);
                if (result.slotInfo) transferables.push(result.slotInfo.buffer);
                if (result.freeSlots) transferables.push(result.freeSlots.buffer);
                if (result.liveIndices) transferables.push(result.liveIndices.buffer);
                if (result.changedIndices) transferables.push(result.changedIndices.buffer);
                if (result.positionDeltas) transferables.push(result.positionDeltas.buffer);
                if (result.velocityDeltas) transferables.push(result.velocityDeltas.buffer);
                if (result.metaDeltaIndices) transferables.push(result.metaDeltaIndices.buffer);
                if (result.metaDeltas) transferables.push(result.metaDeltas.buffer);
                if (result.slotInfoDeltaIndices) transferables.push(result.slotInfoDeltaIndices.buffer);
                if (result.slotInfoDeltas) transferables.push(result.slotInfoDeltas.buffer);
                if (result.spawnedIndices) transferables.push(result.spawnedIndices.buffer);
                if (result.diedIndices) transferables.push(result.diedIndices.buffer);
                if (result.freeSlotsAdded) transferables.push(result.freeSlotsAdded.buffer);
                if (result.freeSlotsRemoved) transferables.push(result.freeSlotsRemoved.buffer);
                
                self.postMessage({ type: 'capture_done', id, result }, transferables);
            } catch (err) {
                self.postMessage({ type: 'error', id, error: err.message });
            }
            break;
            
        case 'reset':
            framesSinceKeyframe = 0;
            prevPositions = null;
            prevVelocities = null;
            prevMeta = null;
            prevSlotInfo = null;
            prevLiveCount = 0;
            prevFreeSlots = [];
            self.postMessage({ type: 'reset_done', id });
            break;
    }
};

console.log('[SnapshotWorker] Initialized');
