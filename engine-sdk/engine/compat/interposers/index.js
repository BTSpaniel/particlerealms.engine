// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * interposers/index.js — install per-realm API shims for a guest app.
 *
 * Guests run in the shared window, so we cannot replace globals process-wide
 * without breaking the OS. Instead we:
 *   1. build a per-realm `context` of shims (gpu/raf/storage/fetch),
 *   2. register it at `globalThis.__engineRealms.get(appId)`,
 *   3. return a code `transform` that prepends a tiny prelude to each guest
 *      script which LEXICALLY SHADOWS the relevant globals with the shims.
 *
 * Module scripts: the prelude's top-level `const`s shadow the globals within the
 * module's own scope. Classic scripts: wrapped in an IIFE (only when there's a
 * single classic script, to avoid breaking cross-script global sharing).
 *
 * Which globals are shadowed is driven by `profile.uses`, minimising both
 * collision risk and overhead.
 */

import { disposeGpuShim, installGpuCanvasBridge, makeGpuShim } from './gpu.js';
import { makeRafShim }     from './raf.js';
import { makeStorageShim } from './storage.js';
import { makeFetchShim }   from './fetch.js';
import { makeUrlShim }     from './file-export.js';
import { makeOpenShim, makeWindowProxy, makeLocationProxy, installNavCapture } from './navigation.js';
import { makeWorkerShim } from './worker.js';

const REGISTRY_KEY = '__engineRealms';

export function installInterposers({ realm, profile, ctx, app } = {}) {
    const id      = realm.id;
    const healing = profile?.healing ?? {};
    const uses    = profile?.uses ?? {};
    const metrics = app?.metrics ?? (app && (app.metrics = {}));
    const onError = (info) => {
        try { ctx?.onError?.({ appId: id, ...info }); } catch {}
        try { app?._record?.(info.type, info); } catch {}
    };

    const context = {};
    const bindings = [];   // [localName, contextKey] pairs to shadow in guest code
    const gpuHost = (uses.webgpu || uses.raf) && typeof ctx?.gpu?.openRealm === 'function'
        ? ctx.gpu.openRealm(id)
        : ctx?.gpu;
    if (gpuHost && gpuHost !== ctx?.gpu) {
        realm.addCleanup(() => gpuHost.releaseApp?.(id));
    }

    // ── WebGPU ────────────────────────────────────────────────────────────────
    if (uses.webgpu) {
        const gpuShim = makeGpuShim({
            metrics: healing.wrapQueueSubmit !== false ? metrics : null,
            onError,
            gpuHost,
            appId: id,
        });
        if (gpuShim) {
            context.navigator = makeNavigatorProxy(gpuShim);
            bindings.push(['navigator', 'navigator']);
            realm.addCleanup(() => disposeGpuShim(gpuShim));

            const canvasBridge = installGpuCanvasBridge({
                realm,
                gpuHost,
                appId: id,
                onError,
            });
            if (canvasBridge) {
                context.document = canvasBridge.document;
                bindings.push(['document', 'document']);
                realm.addCleanup(() => canvasBridge.destroy());
            }
        }
    }

    // ── requestAnimationFrame ──────────────────────────────────────────────────
    if (uses.raf) {
        const { raf, caf } = makeRafShim(realm, { gpuHost, appId: id });
        context.raf = raf; context.caf = caf;
        bindings.push(['requestAnimationFrame', 'raf'], ['cancelAnimationFrame', 'caf']);
    }

    // ── Web Storage ─────────────────────────────────────────────────────────────
    if (uses.localStorage && healing.safeStorage !== false) {
        context.localStorage   = makeStorageShim(id, safeGlobal('localStorage'));
        context.sessionStorage = makeStorageShim(id, safeGlobal('sessionStorage'));
        bindings.push(['localStorage', 'localStorage'], ['sessionStorage', 'sessionStorage']);
    }

    // ── fetch ────────────────────────────────────────────────────────────────────
    // Always shim fetch: even network-less guests need bundled files served
    // (e.g. a module that does `fetch('shader.wgsl')` or loads a `.wasm`).
    {
        const f = makeFetchShim({ profile, onError, realm });
        if (f) { context.fetch = f; bindings.push(['fetch', 'fetch']); }
    }

    // ── Workers (resolve bundled worker URLs → pre-linked blobs) ──────────────────
    if (uses.workers) {
        const WorkerShim = makeWorkerShim(realm);
        if (WorkerShim) { context.Worker = WorkerShim; bindings.push(['Worker', 'Worker']); }
    }

    // ── file export (URL.createObjectURL tracking + leak-free revoke) ──────────────
    if (uses.fileExport && healing.safeDownloads !== false) {
        const urlShim = makeUrlShim(realm, { metrics });
        if (urlShim) { context.URL = urlShim; bindings.push(['URL', 'URL']); }
    }

    // ── navigation (keep new-window / redirect attempts inside the OS) ─────────────
    // Default-on. The host routes hijacked URLs via ctx.onOpenWindow; without a
    // handler the attempt is simply swallowed (no popup, no OS unload).
    if (healing.hijackNavigation !== false) {
        const onOpenWindow = (url, info = {}) => {
            try { ctx?.onOpenWindow?.(url, { appId: id, ...info }); }
            catch (e) { onError({ type: 'navigation', message: e.message }); }
        };

        // (1) DOM click-capture — always installed (cheap; prevents off-origin
        // anchor clicks from unloading the whole OS page).
        installNavCapture(realm, { onOpenWindow, onError });

        // (2) JS-driven popups/redirects — only shadow window/open/location when
        // the probe detected such usage, to keep the shadowing surface minimal.
        if (uses.windowOpen) {
            const openShim = makeOpenShim({ onOpenWindow, onError });
            context.open     = openShim;
            context.window   = makeWindowProxy(openShim, { onOpenWindow, onError });
            context.location = makeLocationProxy({ onOpenWindow, onError });
            bindings.push(['open', 'open'], ['window', 'window'], ['location', 'location']);
        }
    }

    // Register so the injected prelude can resolve the context at runtime.
    const reg = (globalThis[REGISTRY_KEY] ??= new Map());
    reg.set(id, context);
    realm.addCleanup(() => { try { reg.delete(id); } catch {} });

    const transform = bindings.length ? makeTransform(id, bindings, realm) : null;
    return { context, transform, bindings };
}

// ── Internals ───────────────────────────────────────────────────────────────

function makeNavigatorProxy(gpuShim) {
    const realNav = (typeof navigator !== 'undefined') ? navigator : {};
    return new Proxy(realNav, {
        get(t, p) {
            if (p === 'gpu') return gpuShim;
            const v = t[p];
            return typeof v === 'function' ? v.bind(t) : v;
        },
    });
}

function safeGlobal(name) {
    try { return globalThis[name] ?? null; } catch { return null; }
}

function makeTransform(id, bindings, realm) {
    // Each binding falls back to the REAL global when no realm context is present
    // (e.g. the same module loaded inside a Worker, where __engineRealms doesn't
    // exist) — so transformed bundled modules stay correct off the main thread.
    const decls = bindings
        .map(([local, key]) => `${local}=(__R&&__R.${key}!==undefined)?__R.${key}:globalThis.${local}`)
        .join(',');
    const reg = `(globalThis.${REGISTRY_KEY}&&globalThis.${REGISTRY_KEY}.get(${JSON.stringify(id)}))||null`;
    const prelude = `const __R=${reg};const ${decls};`;
    return (code, meta) => {
        if (meta.module) {
            // Top-level const in a module shadows the global within this module only.
            // (import declarations are hoisted, so a preceding const is legal.)
            return prelude + '\n' + code;
        }
        // Classic scripts share the global scope — only safe to wrap a lone script.
        if (realm._classicCount > 1) return code;
        return `(function(){${prelude}\n${code}\n}).call(this);`;
    };
}
