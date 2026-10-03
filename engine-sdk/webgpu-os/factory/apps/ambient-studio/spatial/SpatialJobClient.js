// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** One cancellable preparation transaction. A result never commits project state. */
export class SpatialJobClient {
    constructor({ getProjectToken = () => null, workerURL = new URL('./PreparationWorker.js', import.meta.url) } = {}) {
        this.getProjectToken = getProjectToken;
        this.workerURL = workerURL;
        this.pending = null;
        this.serial = 0;
        this.disposed = false;
    }

    run(task, payload, { projectToken = this.getProjectToken(), onProgress = () => {}, signal, transfer = [] } = {}) {
        if (this.disposed) return Promise.reject(new DOMException('Preparation client is disposed.', 'InvalidStateError'));
        if (signal?.aborted) return Promise.reject(new DOMException('Preparation cancelled.', 'AbortError'));
        this.cancel();
        const id = ++this.serial;
        const started = performance.now();
        console.debug('[AmbientSpatial] preparation started', { id, task });
        return new Promise((resolve, reject) => {
            let worker;
            try { worker = new Worker(this.workerURL, { type: 'module', name: `ambient-${task}` }); }
            catch (error) { reject(error); return; }
            const abort = () => finish(new DOMException('Preparation cancelled.', 'AbortError'));
            const finish = (error, result) => {
                if (this.pending?.id !== id) return;
                this.pending = null;
                signal?.removeEventListener('abort', abort);
                worker.terminate();
                console.debug('[AmbientSpatial] preparation finished', { id, task, elapsedMs: performance.now() - started, error: error?.message ?? null });
                if (error) reject(error); else resolve(result);
            };
            this.pending = { id, worker, finish };
            signal?.addEventListener('abort', abort, { once: true });
            worker.onerror = event => finish(new Error(event.message || 'Preparation worker failed.'));
            worker.onmessageerror = () => finish(new Error('Preparation worker returned unreadable data.'));
            worker.onmessage = event => {
                const message = event.data;
                if (this.pending?.id !== id || message?.id !== id) return;
                if (!Object.is(this.getProjectToken(), projectToken)) {
                    finish(new DOMException('Project changed during preparation; reopen the tool before applying.', 'InvalidStateError'));
                    return;
                }
                if (message.type === 'progress') {
                    try { onProgress(message.progress); } catch (error) { finish(error); }
                } else if (message.type === 'result') finish(null, message.result);
                else if (message.type === 'error') finish(new Error(message.error || 'Preparation failed.'));
            };
            try { worker.postMessage({ id, task, payload }, transfer); }
            catch (error) { finish(error); }
        });
    }

    cancel() { this.pending?.finish(new DOMException('Preparation cancelled.', 'AbortError')); }
    get running() { return !!this.pending; }
    dispose() { this.cancel(); this.disposed = true; }
}
