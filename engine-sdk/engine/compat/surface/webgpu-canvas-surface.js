// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * surface/webgpu-canvas-surface.js — default presentation: the guest's own
 * <canvas> inside the realm container.
 *
 * For trusted same-origin guests this is mostly pass-through (the app configures
 * its own WebGPU canvas context). The surface's job is to LOCATE the primary
 * canvas and, when `profile.healing.autoCanvasSize` is enabled, keep its backing
 * store sized to the container with a clamped device-pixel-ratio — fixing the
 * common "canvas stuck at 300×150 / wrong DPR" class of bugs without fighting an
 * app that manages its own sizing.
 */

export class WebgpuCanvasSurface {
    constructor({ realm, profile, ctx } = {}) {
        this.kind = 'webgpu-canvas';
        this.supported = true;
        this.realm = realm;
        this.profile = profile;
        this.ctx = ctx;
        this._ro = null;
    }

    get canvas() {
        const c = this.realm?.container;
        return c ? c.querySelector('canvas') : null;
    }

    attach() {
        const container = this.realm?.container;
        if (!container) return;
        if (this.profile?.healing?.autoCanvasSize) this._enableAutoSize(container);
        this.realm?.addCleanup?.(() => this.destroy());
    }

    _enableAutoSize(container) {
        const canvas = this.canvas;
        if (!canvas || typeof ResizeObserver === 'undefined') return;
        const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
        const apply = () => {
            const w = Math.max(1, Math.round(container.clientWidth  * dpr));
            const h = Math.max(1, Math.round(container.clientHeight * dpr));
            if (canvas.width  !== w) canvas.width  = w;
            if (canvas.height !== h) canvas.height = h;
        };
        this._ro = new ResizeObserver(apply);
        this._ro.observe(container);
        apply();
    }

    resize() { /* driven by the ResizeObserver when auto-size is enabled */ }

    destroy() {
        try { this._ro?.disconnect(); } catch {}
        this._ro = null;
    }
}
