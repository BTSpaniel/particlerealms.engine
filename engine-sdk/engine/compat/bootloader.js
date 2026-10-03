// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * bootloader.js — the Engine Compatibility Bootloader entry point.
 *
 * Boot flow (Phases 1-2 implemented here; 3-7 plug in via ctx hooks):
 *   1. load source              (source-loader)
 *   2. parse HTML               (html-ingestor)
 *   3. static probe → profile   (probe-scanner + profile-builder)
 *   4. merge with cached profile(profile-cache)
 *   5. [validate]               (ctx.validate — schema-registry, Phase 3)
 *   6. [heal]                   (ctx.heal — healing-pipeline, Phase 4)
 *   7. build scoped realm + heal DOM + scope CSS   (runtime-realm)
 *   8. [interpose]              (ctx.interpose — interposers, Phase 5)
 *   9. execute guest scripts
 *  10. cache profile, install error recovery, return an app handle
 *
 * The bootloader is engine-agnostic: pass a `ctx` with optional { storage,
 * profileCache, gpu, scheduler, validate, heal, interpose, onError }.
 */

import { loadSource }   from './source-loader.js';
import { parseHTML }    from './html-ingestor.js';
import { scanSource }   from './probe-scanner.js';
import { buildProfile, mergeProfiles } from './profile-builder.js';
import { ProfileCache } from './profile-cache.js';
import { RuntimeRealm } from './runtime-realm.js';
import { IframeRealm } from './iframe-realm.js';
import { installInterposers } from './interposers/index.js';
import { installErrorRecovery, makeSafeProfile } from './error-recovery.js';
import { selectSurface } from './surface/surface-manager.js';

export class CompatBootloader {
    /** @param {object} ctx — { storage, profileCache, gpu, scheduler, validate, heal, interpose, onError } */
    constructor(ctx = {}) {
        this.ctx = ctx;
        this.profileCache = ctx.profileCache ?? new ProfileCache(ctx.storage ?? null);
        this.apps = new Map();  // id -> handle
    }

    /**
     * Boot a guest app into `mount`.
     * @param {object} options — { id, source, mount, mode?, permissions?, profile?, liveSource? }
     * @returns {Promise<CompatApp>}
     */
    async boot(options) {
        const { id, source, mount } = options;
        if (!id)     throw new Error('compat.boot: options.id required');
        if (!source) throw new Error('compat.boot: options.source required');
        if (!mount)  throw new Error('compat.boot: options.mount (host element) required');

        // If this id is already running, tear it down first (reload semantics).
        if (this.apps.has(id)) { try { this.apps.get(id).destroy(); } catch {} }

        const app = new CompatApp(id, options, this);
        this.apps.set(id, app);
        await app._boot();
        return app;
    }

    get(id) { return this.apps.get(id) ?? null; }

    destroy(id) {
        const app = this.apps.get(id);
        if (app) { try { app.destroy(); } catch {} this.apps.delete(id); }
    }

    destroyAll() {
        for (const id of [...this.apps.keys()]) this.destroy(id);
    }
}

/** A booted guest app handle. */
export class CompatApp {
    constructor(id, options, boot) {
        this.id = id;
        this.options = options;
        this._boot_ = boot;
        this.profile = options.profile ?? null;
        this.realm = null;
        this.metrics = { gpuSubmits: 0, errors: 0, scripts: 0, bootMs: 0 };
        this.errors = [];
        this._errorHandlers = null;
    }

    async _boot() {
        const ctx = this._boot_.ctx;
        const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

        // 1-2. Load + parse (loaded source is kept for reboots).
        const loaded = await loadSource(this.options.source, ctx);
        this._loaded = loaded;
        const model = parseHTML(loaded.html, loaded.baseUrl);

        // 3-4. Probe → profile, merged with the cached one.
        const scan = scanSource(model, loaded.files);
        const fresh = buildProfile(this.id, scan, {
            sourceType: loaded.sourceType,
            sourceHash: loaded.sourceHash,
            liveSource: this.options.liveSource ?? null,
        });
        const saved = this.options.profile ?? await this._boot_.profileCache.find(this.id);
        const profile = mergeProfiles(saved, fresh);
        this.profile = profile;

        // 5. Schema validation (Phase 3) — structural errors block the boot.
        if (typeof ctx.validate === 'function') {
            const v = await ctx.validate(profile);
            if (v && v.valid === false) {
                throw new Error(`compat profile invalid: ${(v.errors ?? []).join('; ')}`);
            }
        }

        // 6-9. Heal + build realm + interpose + execute.
        this._installErrorRecovery();
        await this._prepareAndRun(profile, model);
        this.metrics.scripts = (model.scripts ?? []).length;

        // 10. Persist the profile + promote if it booted clean + snapshot.
        const res = await this._boot_.profileCache.save(this.id, profile, loaded.sourceHash);
        if (this.metrics.errors === 0) {
            await this._boot_.profileCache.promote(this.id, loaded.sourceHash);
            try { await this._boot_.profileCache.saveSnapshot(this.id, this.snapshot()); } catch {}
        }
        this.profileStatus = res.status;
        this.metrics.bootMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
        return this;
    }

    /** Build the scoped realm for `profile` against a freshly parsed `model`, then run it. */
    async _prepareAndRun(profile, model) {
        const ctx = this._boot_.ctx;

        // Hard-isolation tier: run the guest in a sandboxed (opaque-origin) iframe
        // instead of the shared-origin light-DOM realm. Used for untrusted apps.
        // Untrusted non-WebGPU apps always use iframe regardless of stored profile —
        // old packages may have profile.isolation='realm' from before the default changed.
        const trusted = this.options.trusted ?? false;
        const usesWebGpu = profile.uses?.webgpu === true;
        const defaultIsolation = (trusted || usesWebGpu) ? 'realm' : 'iframe';
        const requestedIsolation = this.options.isolation ?? profile.isolation ?? defaultIsolation;
        const explicitIsolation = this.options.isolation != null;
        const isolation = (!trusted && !usesWebGpu && !explicitIsolation) ? 'iframe' : requestedIsolation;
        if (isolation === 'iframe') return this._prepareAndRunIframe(profile, model, ctx);

        // Healing pass (Phase 4) — mutates model/profile in place.
        if (typeof ctx.heal === 'function') {
            try { await ctx.heal({ model, profile, files: this._loaded.files, appId: this.id }); }
            catch (e) { this._record('heal', e); }
        }

        // Interpose hook installs built-in API shims, then any custom ctx.interpose.
        const interpose = async (realm) => {
            if (this.options.interpose !== false) {
                try {
                    const { transform } = installInterposers({ realm, profile, ctx, app: this });
                    if (transform) realm.setScriptTransform(transform);
                } catch (e) { this._record('interpose', e); }
            }
            if (typeof ctx.interpose === 'function') {
                await ctx.interpose({ realm, profile, app: this, ctx });
            }
        };

        this.realm = new RuntimeRealm({
            id: this.id,
            mount: this.options.mount,
            profile,
            files: this._loaded.files,
            baseUrl: this._loaded.baseUrl,
            interpose,
            onError: (info) => this._record(info.type, info),
        });
        this.realm.build(model);
        await this.realm.execute();

        // Attach the presentation surface AFTER scripts run, once the guest's
        // canvas and the linked worker-module URLs exist.
        try {
            this.surface = selectSurface(profile, { realm: this.realm, profile, ctx, app: this });
            await this.surface?.attach?.();
        } catch (e) { this._record('surface', e); }
    }

    /**
     * Hard-isolation path: run the guest in a sandboxed iframe (opaque origin).
     * No host interposers/surface — the guest is self-contained and can't reach
     * the OS. Navigation is routed up via ctx.onOpenWindow. Note: the healing
     * pipeline is skipped here (its asset-healer emits parent-origin blob URLs
     * the iframe can't read; the iframe inlines assets as data: URLs instead).
     */
    async _prepareAndRunIframe(profile, model, ctx) {
        this.isolation = 'iframe';
        // Host capability bridge — scoped persisted storage + mediated network so
        // the sandboxed guest can still save data and connect, under OS control.
        let bridge = null;
        try { bridge = ctx.createGuestBridge?.({ appId: this.id, profile }) ?? null; }
        catch (e) { this._record('bridge', e); }

        this.realm = new IframeRealm({
            id: this.id,
            mount: this.options.mount,
            profile,
            files: this._loaded.files,
            baseUrl: this._loaded.baseUrl,
            onError: (info) => this._record(info.type, info),
            onOpenWindow: ctx.onOpenWindow,
            bridge,
        });
        await this.realm.build(model);
        await this.realm.execute();
    }

    /**
     * Rebuild and re-run the guest from its cached source (Phase 7 recovery). Used
     * by the recovery ladder and the manual Restart button.
     * @param {{ safeMode?: boolean, resetRecovery?: boolean }} [opts]
     */
    async reboot({ safeMode = false, resetRecovery = false } = {}) {
        if (this._rebooting || !this._loaded) return;
        this._rebooting = true;
        try {
            try { this.realm?.destroy(); } catch {}
            this.realm = null;
            this.metrics.errors = 0;
            this.metrics.gpuSubmits = 0;
            if (resetRecovery) {
                try { this._errorHandlers?.(); } catch {}
                this._installErrorRecovery();
            }
            const profile = safeMode ? makeSafeProfile(this.profile) : this.profile;
            const model = parseHTML(this._loaded.html, this._loaded.baseUrl);
            await this._prepareAndRun(profile, model);
        } finally {
            this._rebooting = false;
        }
    }

    _installErrorRecovery() {
        const ctx = this._boot_.ctx;
        // A host can supply its own recovery system; otherwise use the built-in
        // ladder (reboot → safe-mode reboot → error panel).
        this._errorHandlers = (typeof ctx.installErrorRecovery === 'function')
            ? ctx.installErrorRecovery(this)
            : installErrorRecovery(this);
    }

    _record(type, info) {
        this.metrics.errors++;
        const entry = { type, ...info, at: Date.now() };
        this.errors.push(entry);
        const ctx = this._boot_.ctx;
        try { ctx.onError?.({ appId: this.id, type, ...info }); } catch {}
        // Feed the recovery controller (counts crash-type errors toward the ladder).
        try { this._recoveryFeed?.(entry); } catch {}
    }

    /** A snapshot for recovery / debugging. */
    snapshot() { return this.realm?.snapshot() ?? null; }

    destroy() {
        try { this._errorHandlers?.(); } catch {}
        this._errorHandlers = null;
        try { this.realm?.destroy(); } catch {}
        this.realm = null;
        this._boot_.apps.delete(this.id);
    }
}

/** Convenience one-shot boot without holding a CompatBootloader instance. */
export async function bootExternalApp(options, ctx = {}) {
    return new CompatBootloader(ctx).boot(options);
}
