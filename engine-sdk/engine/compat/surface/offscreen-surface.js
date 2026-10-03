// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { GpuRenderWorkerHost } from '../../core/gpu/GpuRenderWorkerHost.js';

/**
 * Worker-owned OffscreenCanvas presentation for compatibility applications.
 *
 * The profile must name a worker renderer module. Arbitrary main-thread guest
 * GPU code is never moved implicitly, and no GPU object crosses the worker
 * boundary.
 */
export class OffscreenSurface {
    constructor({ realm, profile, ctx, app } = {}) {
        this.kind = 'offscreen';
        this.realm = realm;
        this.profile = profile;
        this.ctx = ctx;
        this.app = app;
        this.workerModule = String(profile?.gpu?.workerModule || '');
        this.supported = !!this.workerModule
            && typeof globalThis.Worker === 'function'
            && typeof globalThis.HTMLCanvasElement !== 'undefined'
            && typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function';
        this.host = null;
        this._resizeObserver = null;
        this._resizeDesired = null;
        this._resizeTail = Promise.resolve();
        this._destroyed = false;
        this._attachEpoch = 0;
        this._attachPromise = null;
        this._canvasOverride = null;
        this._terminalError = null;
    }

    get canvas() {
        return this._canvasOverride || this.realm?.container?.querySelector?.('canvas') || null;
    }

    async attach() {
        if (!this.supported) throw new Error('OffscreenSurface requires Worker, OffscreenCanvas transfer, and gpu.workerModule');
        if (this._destroyed) throw new Error('OffscreenSurface has been destroyed');
        if (this._terminalError) throw this._terminalError;
        if (this.host) return this.host.snapshot();
        if (this._attachPromise) return this._attachPromise;
        const canvas = this.canvas;
        if (!canvas) throw new Error('OffscreenSurface could not find the application canvas');

        const rendererModule = this.realm?.resolveWorkerUrl?.(this.workerModule) || this.workerModule;
        const workerFactory = this.ctx?.gpu?.renderWorkerFactory;
        const epoch = ++this._attachEpoch;
        let candidate = null;
        const attachPromise = (async () => {
            try {
                candidate = await GpuRenderWorkerHost.create({
                    canvas,
                    rendererModule,
                    profile: this.profile?.gpu?.workerProfile || 'baseline-render',
                    deviceOptions: this.profile?.gpu?.workerDeviceOptions || {},
                    presentation: this.profile?.gpu?.presentationOptions || {},
                    name: `compat-gpu-${this.realm?.id || 'app'}`,
                    ...(typeof workerFactory === 'function' ? { workerFactory } : {}),
                });
                if (this._destroyed || epoch !== this._attachEpoch) {
                    await candidate.destroy();
                    candidate = null;
                    throw new Error('OffscreenSurface attachment was cancelled by destroy');
                }
                candidate.on('error', error => this._report('gpu-worker', error));
                candidate.on('recovery-failed', error => this._report('gpu-worker-recovery', error));
                this.realm?.addCleanup?.(() => { void this.destroy(); });
                canvas.style.width = '100%';
                canvas.style.height = '100%';
                canvas.style.display = 'block';
                if (this.profile?.healing?.autoCanvasSize !== false) this._observeSize(canvas);
                if (this._destroyed || epoch !== this._attachEpoch) {
                    await candidate.destroy();
                    candidate = null;
                    throw new Error('OffscreenSurface attachment was cancelled by destroy');
                }
                this.host = candidate;
                candidate = null;
                return this.host.snapshot();
            } catch (error) {
                if (candidate) {
                    try { await candidate.destroy(); }
                    catch (destroyError) { this._report('gpu-worker-destroy', destroyError); }
                    candidate = null;
                }
                if (error?.canvasTransferred === true && !this._destroyed
                    && !this._replaceTransferredCanvas(canvas, error)) {
                    const terminal = new Error('OffscreenSurface cannot recover its transferred canvas after worker startup failure');
                    terminal.code = 'GPU_OFFSCREEN_SURFACE_TERMINAL';
                    terminal.cause = error;
                    this._terminalError = terminal;
                }
                throw error;
            }
        })();
        this._attachPromise = attachPromise;
        try { return await attachPromise; }
        finally {
            if (this._attachPromise === attachPromise) this._attachPromise = null;
        }
    }

    _report(type, detail) {
        try {
            this.ctx?.onError?.({
                appId: this.realm?.id,
                type,
                message: detail?.message || String(detail || ''),
            });
        } catch (_) {}
    }

    _replaceTransferredCanvas(canvas, cause) {
        const parent = canvas?.parentNode;
        if (!parent || typeof canvas.cloneNode !== 'function' || typeof parent.replaceChild !== 'function') return false;
        try {
            const replacement = canvas.cloneNode(false);
            replacement.width = canvas.width;
            replacement.height = canvas.height;
            parent.replaceChild(replacement, canvas);
            this._canvasOverride = replacement;
            try {
                this.ctx?.gpu?.onSurfaceCanvasReplaced?.({
                    appId: this.realm?.id,
                    previousCanvas: canvas,
                    canvas: replacement,
                    cause,
                });
            } catch (error) { this._report('gpu-worker-canvas-replaced', error); }
            return true;
        } catch (error) {
            this._report('gpu-worker-canvas-recovery', error);
            return false;
        }
    }

    _observeSize(canvas) {
        const container = this.realm?.container;
        if (!container || typeof ResizeObserver !== 'function') return;
        const apply = entries => {
            const entry = entries?.[0];
            const deviceBox = entry?.devicePixelContentBoxSize?.[0];
            const dpr = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
            const width = deviceBox?.inlineSize
                || Math.max(1, Math.round((entry?.contentRect?.width || container.clientWidth || canvas.width) * dpr));
            const height = deviceBox?.blockSize
                || Math.max(1, Math.round((entry?.contentRect?.height || container.clientHeight || canvas.height) * dpr));
            this.resize(width, height);
        };
        this._resizeObserver = new ResizeObserver(apply);
        try { this._resizeObserver.observe(container, { box: 'device-pixel-content-box' }); }
        catch (_) { this._resizeObserver.observe(container); }
    }

    resize(width, height, options = {}) {
        if (!this.host || this._destroyed) return Promise.resolve(null);
        this._resizeDesired = { width, height, options };
        this._resizeTail = this._resizeTail.then(async () => {
            let result = null;
            while (this._resizeDesired && !this._destroyed) {
                const desired = this._resizeDesired;
                this._resizeDesired = null;
                result = await this.host.resize(desired.width, desired.height, desired.options);
            }
            return result;
        }).catch(error => {
            this._report('gpu-worker-resize', error);
            return null;
        });
        return this._resizeTail;
    }

    render(payload = null, transfer = []) {
        if (!this.host) return Promise.reject(new Error('OffscreenSurface is not attached'));
        return this.host.render(payload, transfer);
    }

    command(command, payload = null, transfer = []) {
        if (!this.host) return Promise.reject(new Error('OffscreenSurface is not attached'));
        return this.host.command(command, payload, transfer);
    }

    snapshot() {
        return this.host?.snapshot() || Object.freeze({
            state: this._destroyed ? 'destroyed' : (this._terminalError ? 'failed' : 'detached'),
        });
    }

    async destroy() {
        if (this._destroyed) return false;
        this._destroyed = true;
        this._attachEpoch++;
        this._resizeDesired = null;
        try { this._resizeObserver?.disconnect(); } catch (_) {}
        this._resizeObserver = null;
        this._terminalError = null;
        const attachPromise = this._attachPromise;
        const host = this.host;
        this.host = null;
        if (host) await host.destroy();
        if (attachPromise) {
            try { await attachPromise; } catch (_) {}
        }
        this._canvasOverride = null;
        return true;
    }
}

export default OffscreenSurface;
