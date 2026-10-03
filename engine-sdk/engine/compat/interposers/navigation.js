// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * navigation.js — keep a guest's "open a new window" / external navigation
 * INSIDE the OS instead of spawning a real browser popup or navigating the whole
 * OS page away.
 *
 * Guests run in the shared OS document (light DOM, not an iframe), so an
 * unhandled `<a href>` click or `window.open()` would either pop a real browser
 * window or unload the entire OS. We intercept both and hand the URL to the host
 * via `onOpenWindow(url, info)` — the host decides where it goes (default: the
 * in-OS Browser app).
 *
 * Two mechanisms:
 *   1. DOM click-capture on the realm container — anchors that open a new window
 *      (target=_blank/_new) or point off-origin are cancelled and routed. Always
 *      installed (cheap, prevents the OS-unload footgun).
 *   2. Lexically-shadowed `window.open` / `open()` / `location` — routes
 *      JS-driven popups and redirects. Only bound when the probe detected such
 *      usage (`profile.uses.windowOpen`), to minimise shadowing blast radius.
 */

/** Replacement for window.open / open(): route the URL, return a harmless stub. */
export function makeOpenShim({ onOpenWindow, onError } = {}) {
    return function open(url, target, features) {
        try {
            const resolved = _resolve(url);
            if (resolved) onOpenWindow?.(resolved, { target: target ?? '_blank', features: features ?? '', via: 'window.open' });
        } catch (e) { _err(onError, e); }
        // Many guests do `const w = window.open(...); w && w.focus()` — never return
        // null/undefined or they crash; hand back an inert window-like stub.
        return _stubWindow();
    };
}

/** Proxy over the real window that only overrides `open` and `location` writes. */
export function makeWindowProxy(openShim, { onOpenWindow, onError } = {}) {
    const real = (typeof window !== 'undefined') ? window : {};
    return new Proxy(real, {
        get(t, p) {
            if (p === 'open') return openShim;
            const v = t[p];
            return (typeof v === 'function') ? v.bind(t) : v;
        },
        set(t, p, val) {
            if (p === 'location') {
                try { onOpenWindow?.(_resolve(val), { via: 'window.location', replace: false }); }
                catch (e) { _err(onError, e); }
                return true;
            }
            try { t[p] = val; } catch {}
            return true;
        },
    });
}

/** Proxy over location: reads pass through; href=/assign/replace are routed. */
export function makeLocationProxy({ onOpenWindow, onError } = {}) {
    const real = (typeof location !== 'undefined') ? location : {};
    return new Proxy(real, {
        get(t, p) {
            if (p === 'assign' || p === 'replace') {
                return (url) => {
                    try { onOpenWindow?.(_resolve(url), { via: 'location.' + p, replace: p === 'replace' }); }
                    catch (e) { _err(onError, e); }
                };
            }
            if (p === 'reload') return () => { try { real.reload(); } catch {} };
            const v = t[p];
            return (typeof v === 'function') ? v.bind(t) : v;
        },
        set(t, p, val) {
            if (p === 'href') {
                try { onOpenWindow?.(_resolve(val), { via: 'location.href', replace: false }); }
                catch (e) { _err(onError, e); }
                return true;
            }
            try { t[p] = val; } catch {}
            return true;
        },
    });
}

/**
 * Capture-phase click handler on the realm container. Cancels + routes anchor
 * navigations that would open a new window or leave the OS origin.
 * Returns a cleanup function (also registered on the realm).
 */
export function installNavCapture(realm, { onOpenWindow, onError } = {}) {
    const root = realm?.container;
    if (!root || typeof root.addEventListener !== 'function') return () => {};

    const osOrigin = (typeof location !== 'undefined') ? location.origin : null;
    // For a guest loaded from a real site, relative links resolve against the OS
    // origin (the guest is in the OS document, not an iframe) — so we re-resolve
    // against the guest's original base URL. A guest with an http(s) base is a
    // "remote" app: EVERY navigation should leave the OS shell, so we route them
    // all to the in-OS Browser rather than unloading the page.
    let baseUrl = null, baseIsRemote = false;
    try {
        baseUrl = realm.baseUrl ?? null;
        baseIsRemote = !!baseUrl && /^https?:/i.test(baseUrl);
    } catch { baseUrl = null; baseIsRemote = false; }

    const onClick = (e) => {
        try {
            const a = e.target?.closest?.('a[href]');
            if (!a) return;

            const raw = a.getAttribute('href') || '';
            if (!raw || raw.startsWith('#')) return; // in-page / no-op
            if (/^\s*javascript:/i.test(raw)) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            if (/^(mailto:|tel:|sms:)/i.test(raw)) return;                             // let the OS/host decide

            // Resolve the true destination: relative hrefs against the guest base
            // (remote apps) so they point at the real site, not the OS path.
            const isAbsolute = /^[a-z][\w+.-]*:|^\/\//i.test(raw);
            let dest;
            try { dest = (!isAbsolute && baseUrl) ? new URL(raw, baseUrl).href : a.href; }
            catch { dest = a.href; }
            if (!dest) return;

            const target = (a.getAttribute('target') || '').toLowerCase();
            const opensNewWindow = target === '_blank' || target === '_new';

            let offOrigin = false;
            try { offOrigin = !!osOrigin && new URL(dest).origin !== osOrigin; } catch { offOrigin = false; }

            // Intercept: explicit new-window links, anything that leaves the OS
            // origin, or ANY navigation from a remote-loaded guest (whose relative
            // links would otherwise unload the OS). Local-package intra-app links
            // (same OS origin, no remote base) are left to the guest's own router.
            if (!opensNewWindow && !offOrigin && !baseIsRemote) return;

            e.preventDefault();
            e.stopPropagation();
            onOpenWindow?.(dest, { target: target || '_blank', via: 'anchor', external: offOrigin });
        } catch (err) { _err(onError, err); }
    };

    root.addEventListener('click', onClick, true); // capture phase — beat the default nav
    const cleanup = () => { try { root.removeEventListener('click', onClick, true); } catch {} };
    realm.addCleanup?.(cleanup);
    return cleanup;
}

// ── internals ─────────────────────────────────────────────────────────────────

function _stubWindow() {
    const noop = () => {};
    return {
        closed: false,
        focus: noop, blur: noop, close() { this.closed = true; },
        postMessage: noop, moveTo: noop, resizeTo: noop, print: noop,
        location: { href: '', assign: noop, replace: noop, reload: noop },
        document: null, opener: null,
    };
}

function _resolve(url) {
    if (url == null) return '';
    try { return new URL(String(url), (typeof location !== 'undefined' ? location.href : undefined)).href; }
    catch { return String(url); }
}

function _err(onError, e) {
    try { onError?.({ type: 'navigation', message: e?.message ?? String(e) }); } catch {}
}
