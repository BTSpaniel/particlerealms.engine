// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Adapter for a host-compositor-owned engine texture surface.
 *
 * The kernel supplies `gpu.createTextureSurface()` because only the host may
 * bind the shared physical device and compositor. The compatibility guest sees
 * this lifecycle adapter, never the raw device.
 */
export class EngineTextureSurface {
    constructor({ realm, profile, ctx, app } = {}) {
        this.kind = 'engine-texture';
        this.realm = realm;
        this.profile = profile;
        this.ctx = ctx;
        this.app = app;
        this._factory = ctx?.gpu?.createTextureSurface;
        this.supported = typeof this._factory === 'function';
        this._surface = null;
        this._destroyed = false;
        this._attachEpoch = 0;
        this._attachPromise = null;
    }

    async attach() {
        if (!this.supported) throw new Error('EngineTextureSurface requires a host compositor surface factory');
        if (this._destroyed) throw new Error('EngineTextureSurface has been destroyed');
        if (this._surface) return this.snapshot();
        if (this._attachPromise) return this._attachPromise;
        const container = this.realm?.container;
        if (!container) throw new Error('EngineTextureSurface requires an application container');
        const epoch = ++this._attachEpoch;
        let candidate = null;
        const attachPromise = (async () => {
            try {
                candidate = await this._factory({
                    appId: this.realm?.id,
                    container,
                    profile: this.profile,
                    format: this.profile?.gpu?.textureFormat || 'rgba8unorm',
                });
                if (!candidate
                    || typeof candidate.getTexture !== 'function'
                    || typeof candidate.resize !== 'function'
                    || typeof candidate.destroy !== 'function') {
                    try { await candidate?.destroy?.(); } finally { candidate = null; }
                    throw new Error('Host compositor returned an invalid engine texture surface');
                }
                if (this._destroyed || epoch !== this._attachEpoch) {
                    await candidate.destroy();
                    candidate = null;
                    throw new Error('EngineTextureSurface attachment was cancelled by destroy');
                }
                this.realm?.addCleanup?.(() => { void this.destroy(); });
                if (this._destroyed || epoch !== this._attachEpoch) {
                    await candidate.destroy();
                    candidate = null;
                    throw new Error('EngineTextureSurface attachment was cancelled by destroy');
                }
                this._surface = candidate;
                candidate = null;
                return this.snapshot();
            } catch (error) {
                if (candidate) {
                    try { await candidate.destroy?.(); } catch (_) {}
                    candidate = null;
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

    getTexture(frameToken) {
        if (!this._surface || this._destroyed) return null;
        return this._surface.getTexture(frameToken);
    }

    resize(width, height, options = {}) {
        if (!this._surface || this._destroyed) return Promise.resolve(null);
        return Promise.resolve(this._surface.resize(width, height, options));
    }

    snapshot() {
        const host = this._surface?.snapshot?.() || {};
        return Object.freeze({
            kind: this.kind,
            state: this._destroyed ? 'destroyed' : (this._surface ? 'ready' : 'detached'),
            generation: host.generation ?? null,
            format: host.format ?? this.profile?.gpu?.textureFormat ?? null,
            size: host.size ?? null,
        });
    }

    async destroy() {
        if (this._destroyed) return false;
        this._destroyed = true;
        this._attachEpoch++;
        const attachPromise = this._attachPromise;
        const surface = this._surface;
        this._surface = null;
        if (surface) await surface.destroy();
        if (attachPromise) {
            try { await attachPromise; } catch (_) {}
        }
        return true;
    }
}

export default EngineTextureSurface;
