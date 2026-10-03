// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * interposers/worker.js — resolve guest Worker(url) references to bundled blobs.
 *
 * A guest's `new Worker('worker.js')` references a path relative to its original
 * document, which won't resolve once the guest runs from blob URLs in the OS
 * realm. This shim rewrites a relative/bundled worker URL to its pre-linked
 * module blob (imports already rewritten + shims applied), or a blob of the
 * bundled file. Remote/absolute URLs pass through unchanged.
 *
 * Returns a Worker subclass, or null if Worker is unavailable.
 */

export function makeWorkerShim(realm, RealWorker = (typeof Worker !== 'undefined' ? Worker : null)) {
    if (!RealWorker) return null;
    return class CompatWorker extends RealWorker {
        constructor(url, options) {
            let resolved = url;
            try { resolved = realm?.resolveWorkerUrl?.(url) ?? url; } catch { resolved = url; }
            super(resolved, options);
        }
    };
}
