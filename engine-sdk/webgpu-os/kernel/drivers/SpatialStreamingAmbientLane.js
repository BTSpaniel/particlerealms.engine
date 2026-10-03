// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { selectSpatialCloudFrontier } from '../../factory/apps/ambient-studio/spatial/SpatialCloudHierarchy.js';
import { normalizeSpatialStreamingPolicy, spatialCloudReservation, spatialCloudSelectionHierarchy } from '../../factory/apps/ambient-studio/spatial/SpatialCloudStreaming.js';
import { loadSpatialCloudFrontier } from './SpatialCloudResidency.js';

/** Atomic, bounded progressive lane. GPU submission stays in the shared frame
 * coordinator; async work only prepares the next lane. A parent remains visible
 * through loading, failures, cancellation and viewport changes. */
export async function createSpatialStreamingAmbientLane(options) {
    const { plan, signal, createLane } = options, hierarchy = plan.source.hierarchy, policy = normalizeSpatialStreamingPolicy(plan.source.streaming);
    const selectionHierarchy = spatialCloudSelectionHierarchy(hierarchy, plan.spatial.objectEdits);
    const lifetime = new AbortController();
    let disposed = false, active = null, staged = null, loading = null, width = 0, height = 0, suspended = false;
    let activeIds = [hierarchy.rootId], stagedIds = [], activeBytes = spatialCloudReservation(hierarchy, activeIds, plan.assets), reservedBytes = 0;
    let lastSelection = -Infinity, lastError = null, swaps = 0, loads = 0, failedUntil = 0, requestedKey = '', budgetLimited = false;
    const dispose = () => {
        if (disposed) return; disposed = true; lifetime.abort(); loading?.abort();
        staged?.dispose(); active?.dispose(); staged = active = null; reservedBytes = activeBytes = 0;
        signal?.removeEventListener('abort', dispose);
        console.debug('[SpatialStreaming][dispose]', { projectId: plan.projectId });
    };
    signal?.addEventListener('abort', dispose, { once: true });
    const prepare = async (ids, controller) => {
        loads++;
        const result = await loadSpatialCloudFrontier({ plan, nodeIds: ids, assetResolver: options.assetResolver, signal: controller.signal });
        controller.signal.throwIfAborted();
        const childPlan = { ...plan, source: { ...plan.source, hierarchy: null, streaming: null, cloudAssetId: null }, spatial: { ...plan.spatial, cloud: result.cloud } };
        const lane = await createLane({ ...options, plan: childPlan, signal: controller.signal,
            preparation: { sourceIds: result.sourceIds, groupBounds: hierarchy.groupBounds, bounds: hierarchy.bounds, coordinateOrigin: hierarchy.origin } });
        if (controller.signal.aborted || disposed) { lane.dispose(); controller.signal.throwIfAborted(); throw new DOMException('Disposed', 'AbortError'); }
        return lane;
    };
    const start = (ids, reservation) => {
        const controller = new AbortController(), onAbort = () => controller.abort(lifetime.signal.reason);
        lifetime.signal.addEventListener('abort', onAbort, { once: true });
        loading = controller; reservedBytes = reservation; requestedKey = ids.join(',');
        console.debug('[SpatialStreaming][load]', { nodes: ids.length, reservedBytes, residentBytes: activeBytes });
        void prepare(ids, controller).then(lane => {
            if (disposed || loading !== controller) { lane.dispose(); return; }
            staged = lane; stagedIds = ids; lastError = null;
        }).catch(error => {
            if (!disposed && loading === controller && !controller.signal.aborted) {
                lastError = String(error.message); failedUntil = performance.now() + 5000;
                console.debug('[SpatialStreaming][retain-parent]', { error: lastError });
            }
        }).finally(() => {
            lifetime.signal.removeEventListener('abort', onAbort);
            if (loading === controller) { loading = null; if (!staged) reservedBytes = 0; }
        });
    };
    try {
        if (signal?.aborted) { dispose(); signal.throwIfAborted(); }
        active = await prepare(activeIds, lifetime);
        const choose = camera => {
            const frame = plan.spatial.cloudFrame, unitScale = frame.unitScale;
            const local = { ...camera, localOrigin: hierarchy.origin, eye: camera.eye.map((x, axis) => x / unitScale + (frame.origin[axis] - hierarchy.origin[axis])) };
            const available = policy.maxResidentBytes - activeBytes;
            let points = Math.min(policy.maxPoints, plan.spatial.count), selection = null, desiredCount = null;
            const activeCount = activeIds.reduce((sum, id) => sum + hierarchy.nodes.find(node => node.id === id).count, 0);
            while (points >= hierarchy.nodes.find(node => node.id === hierarchy.rootId).count) {
                selection = selectSpatialCloudFrontier(selectionHierarchy, local, { viewportHeight: height, maxPoints: points, maxNodes: 128, pixelError: policy.pixelError, hysteresis: policy.hysteresis, previousNodeIds: activeIds });
                desiredCount ??= selection.count;
                if (selection.nodeIds.join(',') === activeIds.join(',')) return { ...selection, reservation: 0, budgetLimited: points < Math.min(policy.maxPoints, plan.spatial.count) || selection.budgetLimited };
                // Insufficient transition headroom must not oscillate between
                // coarse and fine while the camera has not asked to coarsen.
                if (desiredCount >= activeCount && selection.count < activeCount) return null;
                const reservation = spatialCloudReservation(hierarchy, selection.nodeIds, plan.assets);
                if (reservation <= available) return { ...selection, reservation, budgetLimited: selection.budgetLimited || points < Math.min(policy.maxPoints, plan.spatial.count) };
                points = Math.min(points - 1, Math.floor(points * .7));
            }
            return null;
        };
        return Object.freeze({
            encode(encoder, target, clear, detail) {
                if (disposed) throw new Error('Progressive spatial lane is disposed.');
                const pressed = detail.frame.pointerState[1] > 0;
                let drawn = false;
                if (staged && !pressed) {
                    try {
                        staged.restoreState?.(active.captureState?.());
                        if (width && height) staged.resize(width, height);
                        staged.setSuspended(suspended);
                        staged.encode(encoder, target, clear, detail);
                        drawn = true;
                    } catch (error) {
                        const failed = staged; staged = null; stagedIds = []; reservedBytes = 0;
                        lastError = String(error.message); failedUntil = performance.now() + 5000;
                        try { failed.dispose(); } catch (cleanupError) { console.debug('[SpatialStreaming][staged-dispose-failed]', { error: String(cleanupError.message) }); }
                        console.debug('[SpatialStreaming][retain-parent]', { error: lastError });
                    }
                    if (staged) {
                        const previous = active; active = staged; staged = null; activeIds = stagedIds; stagedIds = []; activeBytes = reservedBytes; reservedBytes = 0; swaps++;
                        previous.dispose();
                        console.debug('[SpatialStreaming][publish]', { nodes: activeIds.length, residentBytes: activeBytes });
                    }
                }
                if (!drawn) active.encode(encoder, target, clear, detail);
                const now = performance.now(), camera = active.camera?.();
                if (camera && !suspended && !pressed && !loading && !staged && now >= failedUntil && now - lastSelection >= policy.settleMs) {
                    lastSelection = now; const selection = choose(camera); budgetLimited = !selection || selection.budgetLimited;
                    if (selection && selection.nodeIds.join(',') !== activeIds.join(',')) start(selection.nodeIds, selection.reservation);
                }
            },
            resize(w, h) { width = w; height = h; return active?.resize(w, h) ?? false; },
            setSuspended(value) { suspended = value; active?.setSuspended(value); staged?.setSuspended(value); },
            reset(detail) { active?.reset(detail); staged?.reset(detail); },
            camera: () => active?.camera?.() ?? null,
            diagnostics: () => ({ ...active?.diagnostics(), streaming: { enabled: true, activeNodes: [...activeIds], pendingNodes: staged ? [...stagedIds] : loading ? requestedKey.split(',') : [], residentBytes: activeBytes, reservedBytes, maxResidentBytes: policy.maxResidentBytes, budgetLimited, loads, swaps, error: lastError } }),
            resourceCounts() { const a = active?.resourceCounts() ?? {}, b = staged?.resourceCounts() ?? {}; return Object.fromEntries(Object.keys({ ...a, ...b }).map(key => [key, (a[key] ?? 0) + (b[key] ?? 0)])); },
            oneShotBudget() { const a = active?.oneShotBudget() ?? { operations: 0, bytes: 0 }, b = staged?.oneShotBudget() ?? { operations: 0, bytes: 0 }; return { operations: a.operations + b.operations, bytes: a.bytes + b.bytes }; },
            dispose,
        });
    } catch (error) { dispose(); throw error; }
}
