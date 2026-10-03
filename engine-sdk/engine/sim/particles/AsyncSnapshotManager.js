// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AsyncSnapshotManager.js - Async wrapper for worker-based snapshot capture
 * 
 * Coordinates between main thread (GPU readback) and worker (compression).
 * Uses TRIPLE buffering for completely non-blocking capture:
 *   Buffer A: Being filled from GPU readback
 *   Buffer B: Being processed by worker  
 *   Buffer C: Completed and ready for use
 * 
 * This ensures the render loop NEVER waits for GPU or worker.
 */

import { readbackPositionsFromGPU, readbackVelocitiesFromGPU, readbackThermalFromGPU } from "./ParticleSimWorld.js";
import { DEFAULT_MAX_PARTICLES, PARTICLE_CONFIG } from "./ParticleConfig.js";

// Worker instance (lazy-loaded)
let snapshotWorker = null;
let workerReady = false;
let pendingCaptures = new Map();
let nextCaptureId = 0;

// Triple buffer state
const BUFFER_COUNT = 3;
const tripleBuffer = {
    buffers: [null, null, null],  // Pre-allocated buffers
    states: ['free', 'free', 'free'],  // 'free', 'filling', 'processing', 'ready'
    fillIndex: 0,      // Buffer currently being filled from GPU
    processIndex: -1,  // Buffer currently being processed by worker
    readyIndex: -1,    // Buffer ready for consumption
    maxParticles: 0,   // Size of allocated buffers
};

// Throttling
let lastCaptureTime = 0;
let minCaptureIntervalMs = 16; // ~60fps max capture rate (was 1ms!)
let captureQueue = [];
let isProcessingQueue = false;

let _pendingInitData = null;
let _initInFlight = false;

function resolveCapacityCount(particleState) {
    if (!particleState) return DEFAULT_MAX_PARTICLES;
    const { positions, maxCount, world } = particleState;

    let capacityCount = (world && Number.isFinite(world.maxParticles) && world.maxParticles > 0)
        ? (world.maxParticles | 0)
        : (Number.isFinite(maxCount) && maxCount > 0)
            ? (maxCount | 0)
            : (((positions?.length || 0) / 4) | 0);

    if (!Number.isFinite(capacityCount) || capacityCount <= 0) {
        capacityCount = DEFAULT_MAX_PARTICLES;
    }

    const hardMax = (world && world.config && Number.isFinite(world.config.hardMaxParticles) && world.config.hardMaxParticles > 0)
        ? (world.config.hardMaxParticles | 0)
        : (Number.isFinite(PARTICLE_CONFIG.hardMaxParticles) && PARTICLE_CONFIG.hardMaxParticles > 0)
            ? (PARTICLE_CONFIG.hardMaxParticles | 0)
            : 0;

    if (hardMax > 0 && capacityCount > hardMax) {
        capacityCount = hardMax;
    }

    return capacityCount;
}

/**
 * Allocate triple buffers for a given particle count
 */
function allocateTripleBuffers(particleCount) {
    if (tripleBuffer.maxParticles >= particleCount) return; // Already big enough
    
    const dataSize = particleCount * 4; // vec4 per particle
    const slotSize = particleCount * 2; // 2 floats per particle
    
    const useShared = typeof SharedArrayBuffer !== 'undefined';
    const makeF32 = (len) => useShared ? new Float32Array(new SharedArrayBuffer(len * 4)) : new Float32Array(len);
    
    for (let i = 0; i < BUFFER_COUNT; i++) {
        tripleBuffer.buffers[i] = {
            positions: makeF32(dataSize),
            velocities: makeF32(dataSize),
            meta: makeF32(dataSize),
            thermal: makeF32(dataSize),
            slotInfo: makeF32(slotSize),
            freeSlots: [],
            particleCount: 0,
            timestamp: 0,
        };
        tripleBuffer.states[i] = 'free';
    }
    
    tripleBuffer.maxParticles = particleCount;
    tripleBuffer.fillIndex = 0;
    tripleBuffer.processIndex = -1;
    tripleBuffer.readyIndex = -1;
    
    console.log(`[AsyncSnapshot] Allocated triple buffers for ${particleCount} particles`);
}

/**
 * Get next free buffer for filling
 */
function getNextFreeBuffer() {
    for (let i = 0; i < BUFFER_COUNT; i++) {
        if (tripleBuffer.states[i] === 'free') {
            tripleBuffer.states[i] = 'filling';
            tripleBuffer.fillIndex = i;
            return tripleBuffer.buffers[i];
        }
    }
    return null; // All buffers busy - skip this frame
}

/**
 * Mark buffer as ready for worker processing
 */
function markBufferForProcessing(index) {
    if (tripleBuffer.states[index] === 'filling') {
        tripleBuffer.states[index] = 'processing';
        tripleBuffer.processIndex = index;
    }
}

/**
 * Mark buffer as completed (ready for use or recycle)
 */
function markBufferComplete(index) {
    if (tripleBuffer.states[index] === 'processing') {
        // If there's already a ready buffer, free it
        if (tripleBuffer.readyIndex >= 0 && tripleBuffer.states[tripleBuffer.readyIndex] === 'ready') {
            tripleBuffer.states[tripleBuffer.readyIndex] = 'free';
        }
        tripleBuffer.states[index] = 'ready';
        tripleBuffer.readyIndex = index;
    }
}

/**
 * Get the latest ready buffer (for playback)
 */
function getReadyBuffer() {
    if (tripleBuffer.readyIndex >= 0 && tripleBuffer.states[tripleBuffer.readyIndex] === 'ready') {
        return tripleBuffer.buffers[tripleBuffer.readyIndex];
    }
    return null;
}

/**
 * Initialize the async snapshot system
 */
export function initAsyncSnapshotSystem(options = {}) {
    const {
        keyframeInterval = 60,
        positionThreshold = 0.01,
        velocityThreshold = 0.1,
        captureIntervalMs = 16, // Default to 60fps capture
    } = options;
    
    minCaptureIntervalMs = captureIntervalMs;
    
    const hadWorker = !!snapshotWorker;

    // Create worker (only in dev mode — bundled runtime rewrites import.meta.url to page URL)
    const _baseUrl = import.meta.url;
    const _isBundled = !_baseUrl || !_baseUrl.endsWith('.js');
    if (!snapshotWorker && !_isBundled) {
        try {
            const workerUrl = new URL('./SnapshotWorker.js', _baseUrl);
            snapshotWorker = new Worker(workerUrl, { type: 'module' });
            
            snapshotWorker.onmessage = handleWorkerMessage;
            snapshotWorker.onerror = (e) => {
                console.warn('[AsyncSnapshot] Worker unavailable, using sync fallback');
                snapshotWorker = null;
            };
            
            console.log('[AsyncSnapshot] Worker created');
        } catch (e) {
            console.warn('[AsyncSnapshot] Failed to create worker, falling back to sync:', e);
            snapshotWorker = null;
        }
    }

    if (snapshotWorker) {
        if (hadWorker) {
            cancelQueuedAndPendingCaptures(new Error('AsyncSnapshot worker reinitialized'));
        }
        _pendingInitData = { keyframeInterval, positionThreshold, velocityThreshold };
        tryApplyPendingWorkerInit();
    }
    
    return {
        captureFrameAsync,
        captureFrameTripleBuffered,
        getStats: () => ({
            workerReady,
            pendingCaptures: pendingCaptures.size,
            queueLength: captureQueue.length,
            tripleBuffer: {
                states: [...tripleBuffer.states],
                fillIndex: tripleBuffer.fillIndex,
                processIndex: tripleBuffer.processIndex,
                readyIndex: tripleBuffer.readyIndex,
                maxParticles: tripleBuffer.maxParticles
            }
        }),
        getReadyBuffer,
        destroy: destroyAsyncSnapshot
    };
}

/**
 * Handle messages from the worker
 */
function handleWorkerMessage(e) {
    const { type, id, result, error } = e.data;
    
    switch (type) {
        case 'init_done':
            workerReady = true;
            _initInFlight = false;
            console.log('[AsyncSnapshot] Worker ready');
            processQueue();
            tryApplyPendingWorkerInit();
            break;
            
        case 'capture_done':
            const pending = pendingCaptures.get(id);
            if (pending) {
                pending.resolve(result);
                pendingCaptures.delete(id);
            }
            processQueue();
            tryApplyPendingWorkerInit();
            break;
            
        case 'reset_done':
            console.log('[AsyncSnapshot] Worker reset');
            break;
            
        case 'error':
            const errorPending = pendingCaptures.get(id);
            if (errorPending) {
                errorPending.reject(new Error(error));
                pendingCaptures.delete(id);
            }
            processQueue();
            tryApplyPendingWorkerInit();
            break;
    }
}

function tryApplyPendingWorkerInit() {
    if (!snapshotWorker) return;
    if (!_pendingInitData) return;
    if (_initInFlight) return;
    if (pendingCaptures.size > 0) return;
    if (captureQueue.length > 0) return;

    for (let i = 0; i < tripleBuffer.states.length; i++) {
        const s = tripleBuffer.states[i];
        if (s === 'filling' || s === 'processing') return;
    }

    const data = _pendingInitData;
    _pendingInitData = null;
    workerReady = false;
    _initInFlight = true;
    snapshotWorker.postMessage({
        type: 'init',
        id: nextCaptureId++,
        data,
    });
}

function cancelQueuedAndPendingCaptures(err) {
    if (captureQueue.length > 0) {
        const queued = captureQueue;
        captureQueue = [];
        for (let i = 0; i < queued.length; i++) {
            const q = queued[i];
            try {
                q?.reject?.(err);
            } catch (_) {
                // ignore
            }
        }
    }

    if (pendingCaptures.size > 0) {
        for (const [, pending] of pendingCaptures) {
            try {
                pending?.reject?.(err);
            } catch (_) {
                // ignore
            }
        }
        pendingCaptures.clear();
    }

    isProcessingQueue = false;
}

/**
 * Process queued captures
 */
function processQueue() {
    if (isProcessingQueue || captureQueue.length === 0) return;
    if (!workerReady || pendingCaptures.size > 2) return; // Limit concurrent captures
    
    isProcessingQueue = true;
    
    const next = captureQueue.shift();
    if (next) {
        sendToWorker(next);
    }
    
    isProcessingQueue = false;
}

/**
 * Send capture request to worker
 */
function sendToWorker(captureData) {
    const { positions, velocities, meta, slotInfo, freeSlots, particleCount, 
            liveCount, instanceCount, currentTimeMs, emitterStates, forceKeyframe, resolve, reject } = captureData;
    
    const id = nextCaptureId++;
    pendingCaptures.set(id, { resolve, reject });
    
    // Transfer buffers to worker (zero-copy) when using normal ArrayBuffer.
    // For SharedArrayBuffer-backed typed arrays, do NOT transfer (they are shared).
    const transferables = [];
    const maybeTransfer = (arr) => {
        if (!arr || !arr.buffer) return;
        if (typeof SharedArrayBuffer !== 'undefined' && arr.buffer instanceof SharedArrayBuffer) return;
        transferables.push(arr.buffer);
    };
    maybeTransfer(positions);
    maybeTransfer(velocities);
    maybeTransfer(meta);
    maybeTransfer(slotInfo);
    
    snapshotWorker.postMessage({
        type: 'capture',
        id,
        data: {
            positions,
            velocities,
            meta,
            slotInfo,
            freeSlots,
            particleCount,
            liveCount,
            instanceCount,
            currentTimeMs,
            emitterStates,
            forceKeyframe
        }
    }, transferables);
}

/**
 * Capture a frame asynchronously
 * GPU readback happens on main thread, compression in worker
 */
export async function captureFrameAsync(snapshot, particleState, emitters, currentTimeMs) {
    if (!snapshot || !particleState) return null;

    const unlimitedBudget = (!Number.isFinite(snapshot.memoryBudgetBytes) || snapshot.memoryBudgetBytes <= 0);
    if (unlimitedBudget && snapshot._hardOverBudget) {
        snapshot._hardOverBudget = false;
    }
    
    // Throttle captures to reduce CPU load
    const now = performance.now();
    if (now - lastCaptureTime < minCaptureIntervalMs) {
        return null; // Skip this frame
    }
    lastCaptureTime = now;
    
    const { positions, velocities, meta, slotInfo, liveCount, instanceCount, freeSlots, world } = particleState;
    const capacityCount = resolveCapacityCount(particleState);
    const activeCount = (world && Number.isFinite(world.activeParticleCount) && world.activeParticleCount > 0)
        ? (world.activeParticleCount | 0)
        : capacityCount;
    const particleCount = (Number.isFinite(instanceCount) && instanceCount > 0)
        ? Math.min(instanceCount | 0, activeCount, capacityCount)
        : Math.min(activeCount, capacityCount);
    
    if (!positions || particleCount === 0) return null;
    
    // GPU readback (must happen on main thread)
    // Use non-blocking readback if available
    if (world && world.device) {
        // Start readback but don't await - let it happen async
        const readbackPromise = Promise.all([
            readbackPositionsFromGPU(world, positions, particleCount),
            readbackVelocitiesFromGPU(world, velocities, particleCount)
        ]);
        
        // If worker is available, queue the capture
        if (snapshotWorker && workerReady) {
            await readbackPromise; // Wait for GPU data
            
            // Copy data for worker (original buffers may be reused)
            const posCopy = new Float32Array(positions.subarray(0, particleCount * 4));
            const velCopy = new Float32Array(velocities.subarray(0, particleCount * 4));
            const metaCopy = meta ? new Float32Array(meta.subarray(0, particleCount * 4)) : null;
            const slotCopy = slotInfo ? new Float32Array(slotInfo.subarray(0, particleCount * 2)) : null;
            const freeCopy = freeSlots ? [...freeSlots] : null;
            
            const forceKeyframe = snapshot.framesSinceKeyframe >= snapshot.keyframeInterval || 
                                  snapshot.frames.length === 0;
            
            // Capture emitter state (small, do on main thread)
            const emitterStates = captureEmitterStateLight(emitters);
            
            return new Promise((resolve, reject) => {
                // Queue for worker processing
                captureQueue.push({
                    positions: posCopy,
                    velocities: velCopy,
                    meta: metaCopy,
                    slotInfo: slotCopy,
                    freeSlots: freeCopy,
                    particleCount,
                    liveCount,
                    instanceCount,
                    currentTimeMs,
                    emitterStates,
                    forceKeyframe,
                    resolve,
                    reject
                });
                
                processQueue();
            });
        } else {
            // Fallback: sync capture (worker not available)
            await readbackPromise;
            return null; // Let original system handle it
        }
    }
    
    return null;
}

/**
 * Triple-buffered capture - completely non-blocking
 * Returns immediately, GPU readback and worker processing happen in background
 */
export function captureFrameTripleBuffered(snapshot, particleState, emitters, currentTimeMs) {
    if (!snapshot || !particleState) return false;

    const unlimitedBudget = (!Number.isFinite(snapshot.memoryBudgetBytes) || snapshot.memoryBudgetBytes <= 0);
    if (unlimitedBudget && snapshot._hardOverBudget) {
        snapshot._hardOverBudget = false;
    }

    if (snapshot._hardOverBudget) {
        if (snapshot.stats) {
            snapshot.stats.droppedFrames = (snapshot.stats.droppedFrames || 0) + 1;
        }
        return false;
    }
    
    // Throttle captures
    const now = performance.now();
    if (now - lastCaptureTime < minCaptureIntervalMs) {
        return false; // Skip this frame
    }
    lastCaptureTime = now;
    
    const { positions, velocities, meta, slotInfo, liveCount, instanceCount, freeSlots, world } = particleState;
    const capacityCount = resolveCapacityCount(particleState);
    const activeCount = (world && Number.isFinite(world.activeParticleCount) && world.activeParticleCount > 0)
        ? (world.activeParticleCount | 0)
        : capacityCount;
    const particleCount = (Number.isFinite(instanceCount) && instanceCount > 0)
        ? Math.min(instanceCount | 0, activeCount, capacityCount)
        : Math.min(activeCount, capacityCount);
    
    if (!positions || particleCount === 0) return false;
    
    // Ensure buffers are allocated
    allocateTripleBuffers(capacityCount);
    
    // Get a free buffer (non-blocking - returns null if all busy)
    const buffer = getNextFreeBuffer();
    if (!buffer) {
        // All buffers busy - skip this frame (no blocking!)
        return false;
    }
    
    const bufferIndex = tripleBuffer.fillIndex;
    buffer.particleCount = particleCount;
    buffer.timestamp = currentTimeMs;
    
    // Start async GPU readback into the buffer (fire-and-forget)
    if (world && world.device) {
        // Positions/velocities come from GPU readback; avoid redundant million-float copies here.
        // Meta/slotInfo are CPU-side, so we still capture them.
        if (meta) buffer.meta.set(meta.subarray(0, particleCount * 4));
        if (slotInfo) buffer.slotInfo.set(slotInfo.subarray(0, particleCount * 2));
        buffer.freeSlots = freeSlots ? [...freeSlots] : [];
        buffer.liveCount = liveCount;
        buffer.instanceCount = instanceCount;
        buffer.emitterStates = captureEmitterStateLight(emitters);
        
        // GPU readback runs async, doesn't block render
        const readbacks = [
            readbackPositionsFromGPU(world, buffer.positions, particleCount),
            readbackVelocitiesFromGPU(world, buffer.velocities, particleCount),
        ];
        if (world.thermalBuffer && buffer.thermal) {
            readbacks.push(readbackThermalFromGPU(world, buffer.thermal, particleCount));
        }
        Promise.all(readbacks).then((results) => {
            if (!results || results[0] !== true || results[1] !== true) {
                tripleBuffer.states[bufferIndex] = 'free';
                return;
            }
            // Mark buffer ready for worker processing
            markBufferForProcessing(bufferIndex);
            
            // Queue for worker if available
            if (snapshotWorker && workerReady) {
                const historyEpoch = snapshot?._historyEpoch || 0;
                const forceKeyframe = snapshot.framesSinceKeyframe >= snapshot.keyframeInterval || 
                                      snapshot.frames.length === 0;

                const dataSize = particleCount * 4;
                const slotSize = particleCount * 2;
                const useShared = typeof SharedArrayBuffer !== 'undefined' && buffer.positions?.buffer instanceof SharedArrayBuffer;

                const clipF32 = (arr, len) => (arr ? arr.subarray(0, len) : null);
                const toWorkerF32 = (arr, len) => {
                    const view = clipF32(arr, len);
                    if (!view) return null;
                    return useShared ? view : new Float32Array(view);
                };

                captureQueue.push({
                    positions: toWorkerF32(buffer.positions, dataSize),
                    velocities: toWorkerF32(buffer.velocities, dataSize),
                    meta: buffer.meta ? toWorkerF32(buffer.meta, dataSize) : null,
                    slotInfo: buffer.slotInfo ? toWorkerF32(buffer.slotInfo, slotSize) : null,
                    freeSlots: buffer.freeSlots,
                    particleCount,
                    liveCount: buffer.liveCount,
                    instanceCount: buffer.instanceCount,
                    currentTimeMs,
                    emitterStates: buffer.emitterStates,
                    forceKeyframe,
                    bufferIndex,
                    resolve: (result) => {
                        // Store result and mark buffer complete
                        markBufferComplete(bufferIndex);

                        if ((snapshot?._historyEpoch || 0) !== historyEpoch) {
                            return;
                        }
                        // Add to snapshot frames
                        if (snapshot.frames) {
                            const frame = typeof snapshot._ingestWorkerFrame === 'function'
                                ? snapshot._ingestWorkerFrame(result)
                                : result;
                            if (frame) {
                                snapshot.frames.push(frame);
                                snapshot.framesSinceKeyframe = frame.isKeyframe ? 0 : snapshot.framesSinceKeyframe + 1;
                                snapshot.stats.totalFrames++;
                                const sz = (typeof frame.getByteSize === 'function') ? frame.getByteSize() : (frame.byteSize || 0);
                                snapshot.stats.totalBytes += sz;
                                snapshot.stats.avgDeltaSize = snapshot.stats.totalFrames > 0 ? (snapshot.stats.totalBytes / snapshot.stats.totalFrames) : 0;
                                if (frame.isKeyframe) snapshot.stats.keyframes++;
                                else snapshot.stats.deltaFrames++;
                                if (typeof snapshot._trimIfOverBudget === 'function') {
                                    snapshot._trimIfOverBudget();
                                }
                            }
                        }
                    },
                    reject: (err) => {
                        console.warn('[AsyncSnapshot] Capture failed:', err);
                        tripleBuffer.states[bufferIndex] = 'free';
                    }
                });
                
                processQueue();
            } else {
                // No worker - just mark complete
                markBufferComplete(bufferIndex);
            }
        }).catch(err => {
            console.warn('[AsyncSnapshot] GPU readback failed:', err);
            tripleBuffer.states[bufferIndex] = 'free';
        });
    }
    
    return true; // Capture started (non-blocking)
}

/**
 * Light emitter state capture (main thread)
 */
function captureEmitterStateLight(emitters) {
    if (!emitters || !Array.isArray(emitters)) return [];
    
    return emitters.map(emitter => ({
        id: emitter.entityId || emitter.id,
        position: emitter.position ? [...emitter.position] : [0, 0, 0],
        rotation: emitter.rotation ? [...emitter.rotation] : [0, 0, 0, 1],
        scale: emitter.scale ?? 1,
        enabled: emitter.enabled ?? true,
        totalSpawned: emitter.totalSpawned ?? 0,
    }));
}

/**
 * Clean up
 */
export function destroyAsyncSnapshot() {
    if (snapshotWorker) {
        snapshotWorker.terminate();
        snapshotWorker = null;
    }
    workerReady = false;
    pendingCaptures.clear();
    captureQueue = [];
    _pendingInitData = null;
    _initInFlight = false;
}

/**
 * Set capture interval (for quality/performance tradeoff)
 */
export function setSnapshotCaptureInterval(intervalMs) {
    minCaptureIntervalMs = Math.max(8, intervalMs); // Min 8ms (~120fps)
    console.log(`[AsyncSnapshot] Capture interval set to ${minCaptureIntervalMs}ms`);
}
