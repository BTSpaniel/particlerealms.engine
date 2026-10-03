// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * interposers/storage.js — per-app namespaced localStorage / sessionStorage.
 *
 * Guests freely use `localStorage.foo = x` and `localStorage.getItem(...)`. Left
 * unscoped they would collide with each other and with the OS. This shim
 * transparently prefixes every key with `compat:<appId>:` and supports both the
 * Storage method API and direct property access (via a Proxy). Falls back to an
 * in-memory store when Web Storage is unavailable.
 */

export function makeStorageShim(appId, backing) {
    const prefix = `compat:${appId}:`;
    if (!backing) return makeMemoryStorage();
    try { backing.length; } catch { return makeMemoryStorage(); }
    return makeNamespaced(backing, prefix);
}

function makeNamespaced(backing, prefix) {
    const scopedKeys = () => {
        const out = [];
        for (let i = 0; i < backing.length; i++) {
            const k = backing.key(i);
            if (k && k.startsWith(prefix)) out.push(k.slice(prefix.length));
        }
        return out;
    };
    const api = {
        getItem:    (k) => backing.getItem(prefix + k),
        setItem:    (k, v) => backing.setItem(prefix + k, String(v)),
        removeItem: (k) => backing.removeItem(prefix + k),
        clear:      () => scopedKeys().forEach(k => backing.removeItem(prefix + k)),
        key:        (i) => scopedKeys()[i] ?? null,
        get length() { return scopedKeys().length; },
    };
    return wrapProxy(api, {
        read:  (k) => backing.getItem(prefix + k),
        write: (k, v) => backing.setItem(prefix + k, String(v)),
        del:   (k) => backing.removeItem(prefix + k),
    });
}

function makeMemoryStorage() {
    const m = new Map();
    const api = {
        getItem:    (k) => (m.has(k) ? m.get(k) : null),
        setItem:    (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
        clear:      () => m.clear(),
        key:        (i) => [...m.keys()][i] ?? null,
        get length() { return m.size; },
    };
    return wrapProxy(api, {
        read:  (k) => (m.has(k) ? m.get(k) : null),
        write: (k, v) => m.set(k, String(v)),
        del:   (k) => m.delete(k),
    });
}

/** Allow both `s.getItem('k')` and `s.k` / `s.k = v` / `delete s.k`. */
function wrapProxy(api, raw) {
    return new Proxy(api, {
        get(t, p) {
            if (p in t) return t[p];
            if (typeof p === 'string') return raw.read(p);
            return undefined;
        },
        set(t, p, v) {
            if (p in t) return false;
            if (typeof p === 'string') { raw.write(p, v); return true; }
            return false;
        },
        has(t, p) { return (p in t) || (typeof p === 'string' && raw.read(p) != null); },
        deleteProperty(t, p) { if (typeof p === 'string') raw.del(p); return true; },
    });
}
