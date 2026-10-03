// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * profile-cache.js — persist & version compatibility profiles.
 *
 * Storage layout (via the kernel StorageManager facade):
 *   /os/compat/profiles/{id}.json        ← active (stable or testing) profile
 *   /os/compat/index.json                ← { [id]: { knownVersions: [...] } }
 *   /os/compat/snapshots/{id}/{ts}.json  ← runtime snapshots (Phase 7)
 *
 * If no storage facade is provided (or a write fails), it degrades to an
 * in-memory cache so the bootloader still works in a bare harness/test.
 */

const DIR        = '/os/compat';
const PROFILE_DIR = '/os/compat/profiles';
const INDEX_PATH  = '/os/compat/index.json';

export class ProfileCache {
    /** @param {object} [storage] — kernel.storageManager (readJSON/writeJSON/mkdir) */
    constructor(storage = null) {
        this._storage = storage;
        this._mem = new Map();      // id -> profile
        this._index = new Map();    // id -> { knownVersions: [] }
        this._ready = false;
    }

    async init() {
        if (this._ready) return;
        this._ready = true;
        if (!this._storage) return;
        try { await this._storage.mkdir(DIR); } catch {}
        try { await this._storage.mkdir(PROFILE_DIR); } catch {}
        try {
            const idx = await this._storage.readJSON(INDEX_PATH);
            if (idx && typeof idx === 'object') for (const [k, v] of Object.entries(idx)) this._index.set(k, v);
        } catch {}
    }

    /** Find a saved profile for an app id (or null). */
    async find(id) {
        if (!id) return null;
        await this.init();
        if (this._mem.has(id)) return this._mem.get(id);
        if (this._storage) {
            try {
                const p = await this._storage.readJSON(`${PROFILE_DIR}/${safe(id)}.json`);
                if (p) { this._mem.set(id, p); return p; }
            } catch {}
        }
        return null;
    }

    /**
     * Save/promote a profile. Tracks knownVersions by sourceHash, marking the
     * newest as 'testing' until `promote()` flips it to 'stable'.
     * @returns {{ changed: boolean, status: string }}
     */
    async save(id, profile, sourceHash = null) {
        if (!id || !profile) return { changed: false, status: 'none' };
        await this.init();
        const prev = await this.find(id);
        const changed = !prev || (sourceHash && prev.sourceHash !== sourceHash);

        this._mem.set(id, profile);

        const entry = this._index.get(id) ?? { knownVersions: [] };
        if (sourceHash && !entry.knownVersions.some(v => v.hash === sourceHash)) {
            entry.knownVersions.push({
                hash: sourceHash,
                version: profile.version ?? 'unknown',
                status: 'testing',
                seenAt: new Date().toISOString(),
            });
            // Keep the list bounded.
            if (entry.knownVersions.length > 20) entry.knownVersions.shift();
        }
        this._index.set(id, entry);

        if (this._storage) {
            try { await this._storage.writeJSON(`${PROFILE_DIR}/${safe(id)}.json`, profile); } catch {}
            try { await this._storage.writeJSON(INDEX_PATH, Object.fromEntries(this._index)); } catch {}
        }
        return { changed, status: changed ? 'testing' : 'stable' };
    }

    /** Mark a hash as stable (it booted successfully). */
    async promote(id, sourceHash) {
        await this.init();
        const entry = this._index.get(id);
        if (!entry) return;
        for (const v of entry.knownVersions) if (v.hash === sourceHash) v.status = 'stable';
        this._index.set(id, entry);
        if (this._storage) { try { await this._storage.writeJSON(INDEX_PATH, Object.fromEntries(this._index)); } catch {} }
    }

    /** Known versions for an app id. */
    async knownVersions(id) {
        await this.init();
        return (this._index.get(id)?.knownVersions ?? []).slice();
    }

    /** True if this exact source hash was seen and marked stable before. */
    async isKnownStable(id, sourceHash) {
        const vs = await this.knownVersions(id);
        return vs.some(v => v.hash === sourceHash && v.status === 'stable');
    }

    /** Persist a runtime snapshot (Phase 7). */
    async saveSnapshot(id, snapshot) {
        if (!this._storage || !id) return;
        const ts = Date.now();
        try {
            await this._storage.mkdir(`${DIR}/snapshots/${safe(id)}`);
            await this._storage.writeJSON(`${DIR}/snapshots/${safe(id)}/${ts}.json`, snapshot);
        } catch {}
    }

    /**
     * Forget everything cached for an app id: in-memory profile, persisted
     * profile JSON, runtime snapshots, and the index entry. Used when an app is
     * uninstalled with "also delete cached data".
     */
    async purge(id) {
        if (!id) return false;
        await this.init();
        this._mem.delete(id);
        const had = this._index.delete(id);
        if (this._storage) {
            try { await this._storage.delete(`${PROFILE_DIR}/${safe(id)}.json`); } catch {}
            try { await this._storage.delete(`${DIR}/snapshots/${safe(id)}`); } catch {}
            try { await this._storage.writeJSON(INDEX_PATH, Object.fromEntries(this._index)); } catch {}
        }
        return had;
    }
}

function safe(id) {
    return String(id).replace(/[^\w.-]/g, '_');
}
