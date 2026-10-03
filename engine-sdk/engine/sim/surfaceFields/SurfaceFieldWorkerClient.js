// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { cloneStrictJson } from '../../core/schema/StrictJsonValue.js';

/** One exact material owner per worker, with a read-only presentation mirror.
 * By default the caller lends serial GPU transport, never device handles.
 * transportMode:'worker-gpu' owns a native liquid device in that same worker;
 * it fails explicitly if unavailable and makes dispose() awaitable.
 * Snapshot and material edits are asynchronous; public SurfaceFieldWorld's
 * synchronous CPU reference API remains unchanged. */
export async function createSurfaceFieldWorker({ topology, materials, transport, transportMode = 'borrowed', logger = null, signal = null, runoff = false, supports = false } = {}) {
    if (!['borrowed', 'worker-gpu'].includes(transportMode)) throw new RangeError('Invalid surface worker transport mode');
    if (!topology?.identity || (transportMode === 'borrowed' && typeof transport !== 'function')) throw new TypeError('Surface worker requires topology and GPU transport');
    if (signal?.aborted) throw new Error('Surface worker creation cancelled');
    const worker = new Worker(new URL('./SurfaceFieldWorker.js', import.meta.url), { type: 'module', name: 'Surface exact materials' });
    let sequence = 0, active = null, disposed = false, tail = Promise.resolve(), current = null, closing = null, terminalError = null;
    let gpuInfo = { mode: transportMode, ownedBytes: 0, steps: 0, adapter: null, deviceDestroyed: false };
    const mirror = { topology, materials, backend: transportMode === 'worker-gpu' ? 'worker-f64+owned-webgpu-films' : 'worker-f64+webgpu-films',
        get transportInfo() { return structuredClone(gpuInfo); },
        stats: () => structuredClone(current.stats),
        chemicals: { cell: index => {
            if (!Number.isInteger(index) || index < 0 || index >= topology.count) throw new RangeError('Invalid chemical cell');
            return { carbonateKg: current.carbonate[index], initialCarbonateKg: current.initialCarbonateKg[index],
                hclMassFraction: current.liquidProperties[index * 4], aqueousTemperatureK: current.liquidProperties[index * 4 + 1] };
        } },
        step: (dt, options) => request('step', { dt, options }).then(() => mirror.stats()),
        applyBrush: brush => request('brush', brush).then(value => value.affected),
        configureSupports: definitions => request('configure-supports', definitions).then(() => mirror.supportFrame),
        applySupportBrush: brush => request('support-brush', brush).then(() => mirror.supportFrame),
        applySupportBrushes: brushes => request('support-brushes', cloneStrictJson(brushes, '$.supportBrushes')).then(() => mirror.supportFrame),
        restore: snapshot => request('restore', snapshot).then(() => mirror),
        snapshot: () => request('snapshot', null).then(value => value.snapshot),
        dispose: () => terminate(new Error('Surface worker disposed')),
    };
    function terminate(error) {
        if (disposed) return closing?.promise;
        disposed = true; terminalError = error; signal?.removeEventListener('abort', abort);
        if (active) { clearTimeout(active.timeout); active.reject(error); active = null; }
        if (transportMode === 'borrowed') { worker.terminate(); return; }
        const id = ++sequence;
        const promise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                worker.terminate(); reject(new Error('Surface worker GPU teardown acknowledgement timed out'));
            }, 5000);
            closing = { id, resolve, reject, timeout };
            try { worker.postMessage({ id, operation: 'dispose' }); }
            catch (failure) { clearTimeout(timeout); worker.terminate(); reject(failure); }
        });
        closing.promise = promise;
        // Existing fire-and-forget teardown remains rejection-safe, while an
        // awaiting owner still receives explicit acknowledgement failures.
        promise.catch(failure => console.warn('[SurfaceFieldWorker] GPU teardown failed', failure));
        return promise;
    }
    const abort = () => terminate(new Error('Surface worker cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = event => terminate(new Error(event.message || 'Surface material worker failed'));
    worker.onmessageerror = () => terminate(new Error('Surface worker response could not be decoded'));
    worker.onmessage = async ({ data }) => {
        if (closing && data.id === closing.id) {
            clearTimeout(closing.timeout); worker.terminate();
            if (data.error || !data.value?.disposed) closing.reject(new Error(data.error?.message || 'Invalid Surface worker teardown acknowledgement'));
            else { gpuInfo = data.value.transportInfo; closing.resolve(data.value); }
            return;
        }
        if (disposed) return;
        if (data.fatal) {
            if (data.transportInfo) gpuInfo = data.transportInfo;
            terminate(new Error(data.fatal.message)); return;
        }
        if (data.log) {
            try { logger?.(data.log.message, data.log.detail); }
            catch (error) { console.warn('[SurfaceFieldWorker] diagnostic observer failed', error); }
            return;
        }
        if (data.id !== active?.id) return;
        if (data.transport) {
            if (transportMode !== 'borrowed') { terminate(new Error('Owned Surface GPU transport unexpectedly crossed the worker boundary')); return; }
            const id = data.id;
            try {
                const result = await transport(data.transport);
                if (!disposed && active?.id === id) worker.postMessage({ id, transportResult: result }, [...new Set([result.fields.buffer, result.flux.buffer])]);
            } catch (error) { if (!disposed && active?.id === id) worker.postMessage({ id, transportError: error.message }); }
            return;
        }
        const job = active; active = null; clearTimeout(job.timeout);
        if (data.error) { const error = new Error(data.error.message); error.name = data.error.name; job.reject(error); return; }
        if (data.value.transportInfo) gpuInfo = data.value.transportInfo;
        if (data.value.frame) {
            current = data.value.frame;
            for (const key of ['fields', 'auxiliary', 'emissions', 'flowSources', 'structuralState', 'supportFrame', 'supportLoads', 'liquidProperties', 'runoff', 'ledger', 'options', 'steps', 'timeSeconds']) mirror[key] = current[key];
        }
        job.resolve(data.value);
    };
    function request(operation, payload) {
        const run = () => new Promise((resolve, reject) => {
            if (disposed) { reject(terminalError ?? new Error('Surface worker disposed')); return; }
            const id = ++sequence;
            const timeout = setTimeout(() => terminate(new Error(`Surface worker timed out during ${operation}`)), 30000);
            active = { id, resolve, reject, timeout };
            try { worker.postMessage({ id, operation, payload }); }
            catch (error) { active = null; clearTimeout(timeout); reject(error); }
        });
        const pending = tail.then(run); tail = pending.catch(() => {}); return pending;
    }
    try {
        await request('init', { topology: { n: topology.n, seams: topology.seams, closed: topology.closed, domains: topology.domains }, materials, transportMode, runoff, supports });
        logger?.('Exact material worker ready', { backend: mirror.backend, cells: topology.count, transport: mirror.transportInfo });
        return mirror;
    } catch (error) { await terminate(error); throw error; }
}
