// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * interposers/raf.js — managed requestAnimationFrame for a guest realm.
 *
 * Guest render loops are the #1 resource leak when an app's window closes: the
 * raw `requestAnimationFrame` loop keeps running forever. This shim tracks every
 * pending frame and cancels them all on `realm.destroy()`, so closing a guest
 * window actually stops its GPU work. Errors thrown inside a frame callback are
 * reported instead of silently killing the loop's owner.
 */

export function makeRafShim(realm, { gpuHost = null, appId = null } = {}) {
    const map = new Map();   // guestId → { kind, handle }
    let nextId = 1;
    let active = true;

    const raf = (cb) => {
        if (!active) throw new Error('Compatibility RAF realm is destroyed');
        if (typeof cb !== 'function') throw new TypeError('requestAnimationFrame callback must be a function');
        const id = nextId++;
        const invoke = t => {
            map.delete(id);
            if (!active) return;
            try { cb(t); }
            catch (e) { realm._report?.('raf', e); }
        };
        if (typeof gpuHost?.requestAnimationFrame === 'function') {
            const handle = gpuHost.requestAnimationFrame(appId, invoke);
            map.set(id, { kind: 'gpu', handle });
        } else {
            const handle = requestAnimationFrame(invoke);
            map.set(id, { kind: 'browser', handle });
        }
        return id;
    };

    const caf = (id) => {
        const record = map.get(id);
        if (record?.kind === 'gpu') gpuHost.cancelAnimationFrame?.(record.handle);
        else if (record) cancelAnimationFrame(record.handle);
        map.delete(id);
    };

    realm.addCleanup(() => {
        active = false;
        for (const record of map.values()) {
            try {
                if (record.kind === 'gpu') gpuHost.cancelAnimationFrame?.(record.handle);
                else cancelAnimationFrame(record.handle);
            } catch {}
        }
        map.clear();
    });

    return { raf, caf };
}
