// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { AdaptiveQualityGovernor } from '../../../engine/core/gpu/AdaptiveQualityGovernor.js';
import { GPUTimestampProfiler } from '../../../engine/core/gpu/GPUTimestampProfiler.js';
import { ambientProgramHasVersionedWater } from './AmbientProgramWaterClock.js';

const MAX_QUERIES = 512;
const MAX_PENDING_READS = 2;

export function ambientRuntimeV3PerformanceResourceBudgetBytes(device) {
    return device.features?.has?.('timestamp-query') && typeof device.createQuerySet === 'function'
        ? MAX_QUERIES * 8 * (2 + MAX_PENDING_READS) : 0;
}

/** Stateless V2 water applies the host tier once at the backing surface.
 * Texture-field mesh/spatial owners already scale their internal targets. */
export function ambientRuntimeV3WaterRenderScale(config, qualityDecision, laneDiagnostics = {}) {
    const source = [config?.plan?.program?.sourceWGSL, config?.plan?.appearance?.renderFunctions].filter(value => typeof value === 'string').join('\n');
    const versioned = ambientProgramHasVersionedWater(source);
    const internal = laneDiagnostics.waterField || laneDiagnostics.waterSurfaceVersion === 2;
    if (!versioned || internal) return config.renderScale ?? 1;
    const scale = Number(qualityDecision?.renderScale ?? 1);
    return (config.renderScale ?? 1) * (Number.isFinite(scale) ? Math.max(0.25, Math.min(1, scale)) : 1);
}

/** Host telemetry shares the existing device/encoder/submission lifecycle.
 * Queue completion wall is never reported as GPU execution time. */
export function createAmbientRuntimeV3Performance({ device, generation, targetFPS = 60, isCurrent = () => true, logger = null }) {
    const governor = new AdaptiveQualityGovernor({ targetFPS, initialTier: 'high', renderBudgetMs: 1000 / targetFPS * 0.75,
        minimumGpuSamples: 5, logger });
    const makeProfiler = () => new GPUTimestampProfiler(device, { generation, maxQueries: MAX_QUERIES, maxPendingReads: MAX_PENDING_READS });
    const profiler = makeProfiler();
    let disposed = false, queueDepth = 0, timingPending = 0, lastCpuMs = 0, latestGpu = null, completionWallMs = null, lastPresentation = null, attemptedFrameTime = null;
    let quality = governor.getDecision(), sampleSequence = 0, acceptedSampleSequence = 0;
    let timingComplete = true, skippedPassesAtFrameStart = 0;
    const nativeEncoders = new WeakMap();
    const alive = () => !disposed && isCurrent();
    const now = () => performance.now();
    const resourceBudgetBytes = profiler.enabled ? MAX_QUERIES * 8 * (2 + MAX_PENDING_READS) : 0;

    return Object.freeze({
        resourceBudgetBytes,
        beforeFrame(nowMs, target = targetFPS) {
            if (!alive()) return { qualityDecision: quality, admitted: false };
            const cadence = lastPresentation === null ? null : Math.max(0, nowMs - lastPresentation);
            attemptedFrameTime = nowMs;
            if (Math.abs(governor.targetFrameMs - 1000 / target) > 0.01) {
                governor.targetFrameMs = 1000 / target; governor.renderBudgetMs = governor.targetFrameMs * 0.75; governor.reset();
            }
            const gpu = latestGpu; latestGpu = null;
            const automatic = governor.recordFrame({ cpuMs: lastCpuMs, gpuMs: gpu?.gpuMs ?? null,
                totalMs: Math.max(lastCpuMs, gpu?.gpuMs ?? 0), frameMs: cadence ?? 0, presentationMs: cadence,
                displayIntervalMs: cadence, nowMs, gpuTimingAvailable: profiler.enabled,
                gpuSamplePending: timingPending, queueDepth, queueCapacity: 3, queueThrottled: queueDepth >= 3,
                queueCompletionWallMs: completionWallMs, passTimes: gpu?.passTimes ?? {},
                timingSource: profiler.enabled ? 'gpu-timestamp' : 'cpu-work' });
            // Four times the current GPU cost is a conservative admission bound
            // for doubling both FFT axes. A candidate still needs native timing
            // after the host admits it; this flag is eligibility, not proof.
            const headroom = profiler.enabled && gpu !== null && automatic.gpuSamples >= 5 && timingPending === 0 && queueDepth === 0
                && automatic.name === 'ultra' && Math.max(automatic.cpuP97Ms, automatic.gpuP97Ms * 4) < automatic.targetFrameMs * 0.75;
            quality = Object.freeze({ ...automatic, resolutionPolicy: 'host-adaptive',
                waterFieldResolution: headroom ? 256 : 128, waterField256Eligible: headroom, hostResourceBytes: resourceBudgetBytes });
            lastCpuMs = 0;
            return { qualityDecision: quality, admitted: queueDepth < 3 };
        },
        beginFrame(nowMs) {
            timingComplete = true; skippedPassesAtFrameStart = profiler.getStats().skippedPasses;
            if (profiler.enabled) profiler.beginFrame({ generation, nowMs });
        },
        wrapEncoder(encoder) {
            if (!profiler.enabled) return encoder;
            const methods = new Map();
            const wrapped = new Proxy(encoder, { get(target, key) {
                const value = Reflect.get(target, key, target);
                if (typeof value !== 'function') return value;
                if (!methods.has(key)) methods.set(key, (...args) => {
                    if (key === 'beginComputePass' || key === 'beginRenderPass') {
                        const descriptor = args[0] ?? {};
                        const name = descriptor.label ?? (key === 'beginComputePass' ? 'ambient.compute' : 'ambient.render');
                        if (descriptor.timestampWrites) timingComplete = false;
                        return Reflect.apply(value, target, [descriptor.timestampWrites ? descriptor : profiler.addToPassDescriptor(name, descriptor)]);
                    }
                    return Reflect.apply(value, target, args);
                });
                return methods.get(key);
            } });
            nativeEncoders.set(wrapped,encoder);return wrapped;
        },
        resolve(encoder) {
            if (!profiler.enabled) return false;
            if (!timingComplete || profiler.getStats().skippedPasses !== skippedPassesAtFrameStart) {
                logger?.({ type: 'ambient-timestamp-incomplete-frame' });
                return false;
            }
            return profiler.resolveAndRead(nativeEncoders.get(encoder) ?? encoder, { generation, nowMs: now() });
        },
        submitted(cpuMs, timingQueued) {
            lastCpuMs = Math.max(0, cpuMs); const started = now(), sequence = ++sampleSequence;
            if (attemptedFrameTime !== null) lastPresentation = attemptedFrameTime;
            queueDepth++;
            const completion = typeof device.queue.onSubmittedWorkDone === 'function' ? device.queue.onSubmittedWorkDone() : Promise.resolve();
            const fence = Promise.resolve(completion).then(() => { if (alive()) completionWallMs = Math.max(0, now() - started); })
                .catch(error => { if (alive()) logger?.({ type: 'ambient-queue-completion-error', error: error.message }); throw error; })
                .finally(() => { if (!disposed) queueDepth = Math.max(0, queueDepth - 1); });
            void fence.catch(() => {});
            if (timingQueued) {
                const submittedProfiler = profiler;
                timingPending++;
                void profiler.markSubmitted(device.queue, { nowMs: started }, Object.freeze({ receiver: undefined, callable: () => completion }));
                void profiler.readResults().then(result => {
                    if (!alive() || submittedProfiler !== profiler || result.frame?.generation !== generation || sequence <= acceptedSampleSequence) return;
                    const durations = result.durations.filter(Number.isFinite);
                    if (!durations.length) return;
                    acceptedSampleSequence = sequence;
                    const passTimes = {};
                    result.passNames.forEach((name, index) => { const duration = result.durations[index];
                        if (Number.isFinite(duration)) passTimes[name] = (passTimes[name] ?? 0) + duration;
                    });
                    latestGpu = { gpuMs: durations.reduce((sum, duration) => sum + duration, 0), passTimes };
                }).catch(error => { if (alive()) logger?.({ type: 'ambient-timestamp-error', error: error.message }); })
                    .finally(() => { if (!disposed && submittedProfiler === profiler) timingPending = Math.max(0, timingPending - 1); });
            }
            return fence;
        },
        snapshot() { return { qualityDecision: quality, governor: governor.getStats(), gpuTimingAvailable: profiler.enabled,
            queueDepth, queueCapacity: 3, gpuSamplePending: timingPending, queueCompletionWallMs: completionWallMs,
            resourceBudgetBytes, timestamp: profiler.getStats() }; },
        resourceCounts() { const stats = profiler.getStats(); return { buffers: (profiler.resolveBuffer ? 1 : 0) + stats.pendingReads + stats.activeReads, textures: 0 }; },
        // Keep the original reservation until the host retires this owner.
        // Reallocating a profiler here could overlap deferred prior GPU uses.
        abortFrame() { profiler.destroy(); latestGpu = null; timingPending = 0; },
        dispose() { if (disposed) return; disposed = true; profiler.destroy(); latestGpu = null; queueDepth = 0; timingPending = 0; },
    });
}
