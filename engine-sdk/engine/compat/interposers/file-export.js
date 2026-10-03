// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * interposers/file-export.js — safe blob/download handling for a guest realm.
 *
 * Guests export files via `URL.createObjectURL(blob)` + an `<a download>` click
 * (or `showSaveFilePicker`). Two problems: created object URLs leak if never
 * revoked, and downloads are invisible to the OS. This shim wraps `URL` so every
 * `createObjectURL` is tracked (and revoked on realm destroy) and each export is
 * counted into the app's metrics — without blocking the legitimate download.
 */

export function makeUrlShim(realm, { metrics, onExport } = {}) {
    if (typeof URL === 'undefined') return null;
    const RealURL = URL;
    const created = new Set();

    const proxy = new Proxy(RealURL, {
        get(target, prop) {
            if (prop === 'createObjectURL') {
                return (obj) => {
                    const url = target.createObjectURL(obj);
                    created.add(url);
                    if (metrics) metrics.downloads = (metrics.downloads ?? 0) + 1;
                    try { onExport?.({ url, size: obj?.size ?? null, mime: obj?.type ?? null }); } catch {}
                    return url;
                };
            }
            if (prop === 'revokeObjectURL') {
                return (url) => { created.delete(url); return target.revokeObjectURL(url); };
            }
            const v = target[prop];
            return typeof v === 'function' ? v.bind(target) : v;
        },
        // Preserve `new URL(...)` behaviour through the proxy.
        construct(target, args) { return new target(...args); },
    });

    realm.addCleanup(() => {
        for (const url of created) { try { RealURL.revokeObjectURL(url); } catch {} }
        created.clear();
    });

    return proxy;
}
