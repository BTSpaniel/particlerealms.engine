// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * interposers/fetch.js — default-deny network egress for guest apps + serving
 * bundled package files.
 *
 * Resolution order:
 *   1. If the ref resolves to a bundled package file (e.g. `fetch('data.json')`
 *      or a `.wasm`), serve it directly from the file map — relative paths in a
 *      blob-loaded module would otherwise 404 against the OS origin.
 *   2. Same-origin, relative, `blob:` and `data:` requests pass through.
 *   3. Cross-origin requests are blocked unless the profile granted
 *      `network.fetch` — preventing a wrapped third-party app from phoning home.
 */

export function makeFetchShim({ profile, onError, realm = null } = {}) {
    const realFetch = (typeof fetch !== 'undefined') ? fetch.bind(globalThis) : null;
    if (!realFetch) return null;
    const allowNet = !!profile?.permissions?.['network.fetch'];

    return async (input, init) => {
        const url = requestUrl(input);

        // 1. Serve bundled package files from the in-memory file map.
        const bundled = realm?.bundledFile?.(url);
        if (bundled && bundled.content != null) {
            return new Response(bundled.content, {
                status: 200,
                headers: { 'Content-Type': bundled.mime || 'application/octet-stream' },
            });
        }

        const resolved = realm?.resolveExternalUrl?.(url) ?? url;
        if (allowNet || isLocalUrl(resolved)) return realFetch(resolveInput(input, resolved), init);
        onError?.({ type: 'fetch-blocked', message: `blocked cross-origin fetch to ${resolved} (no network.fetch permission)` });
        throw new TypeError(`Compatibility policy: network access to "${resolved}" is not permitted for this app.`);
    };
}

function resolveInput(input, url) {
    if (typeof input === 'string') return url;
    if (typeof URL !== 'undefined' && input instanceof URL) return url;
    if (typeof Request !== 'undefined' && input instanceof Request && input.url !== url) {
        return new Request(url, input);
    }
    return input;
}

function requestUrl(input) {
    if (typeof input === 'string') return input;
    if (typeof URL !== 'undefined' && input instanceof URL) return input.href;
    return input?.url ?? '';
}

function isLocalUrl(url) {
    if (!url) return true;
    if (/^(blob:|data:)/i.test(url)) return true;
    try {
        const u = new URL(url, (typeof location !== 'undefined' ? location.href : 'http://localhost/'));
        return typeof location !== 'undefined' && u.origin === location.origin;
    } catch {
        return true; // relative / unparsable → treat as local
    }
}
