// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/AssetResolver.js — virtual-path resolution + backup repair
// (spec §3, rule 5). Files move, browser permissions expire, cloud mirrors lag.
// The resolver maps a scheme:// path to a concrete backend and, when reading a
// registered asset, tries the primary then each backup, verifying by content
// hash. If a backup matches the expected hash it repairs the primary; if a
// candidate's hash differs it is flagged a conflict (never silently accepted).

import { parseVPath } from './vpath.js';
import { hashContent } from './AssetDeduper.js';

/**
 * A backend is { async read(path) -> Uint8Array|null, async write?(path, bytes) }.
 * Schemes without a registered backend simply fail to resolve (caller falls back).
 */
export class AssetResolver {
  constructor(opts = {}) {
    this._backends = new Map();
    if (opts.cache) this.registerBackend('cache', backendFromCache(opts.cache));
    if (opts.fetchBase != null) {
      const fb = makeFetchBackend(opts.fetchBase);
      this.registerBackend('asset', fb);
      this.registerBackend('cloud', fb);
    }
  }

  registerBackend(scheme, backend) { this._backends.set(scheme, backend); return this; }
  hasBackend(scheme) { return this._backends.has(scheme); }

  /** Read raw bytes for a single virtual path, or null if unavailable. */
  async read(vpath) {
    const p = parseVPath(vpath);
    if (!p) return null;
    const backend = this._backends.get(p.scheme);
    if (!backend || typeof backend.read !== 'function') return null;
    try { return await backend.read(p.path); } catch (_) { return null; }
  }

  async write(vpath, bytes) {
    const p = parseVPath(vpath);
    if (!p) throw new Error(`AssetResolver: invalid path '${vpath}'`);
    const backend = this._backends.get(p.scheme);
    if (!backend || typeof backend.write !== 'function') throw new Error(`AssetResolver: backend '${p.scheme}' is read-only`);
    return backend.write(p.path, bytes);
  }

  /**
   * Resolve a registered asset's bytes with backup fallback + hash repair.
   * @param {object} record an AssetRecord (needs primary, backups, sourceHash)
   * @returns {Promise<{ ok:boolean, bytes:Uint8Array|null, source:string|null, repaired:boolean, conflicts:string[], reason?:string }>}
   */
  async resolveAsset(record) {
    const want = record.sourceHash || null;
    const conflicts = [];
    const candidates = [record.primary, ...(record.backups || [])].filter(Boolean);
    if (candidates.length === 0) return { ok: false, bytes: null, source: null, repaired: false, conflicts, reason: 'no paths' };

    let primaryOk = false;
    let result = null;

    for (let i = 0; i < candidates.length; i++) {
      const path = candidates[i];
      const bytes = await this.read(path);
      if (!bytes) continue;
      const hash = want ? await hashContent(bytes) : null;

      if (want && hash !== want) {
        conflicts.push(path); // present but wrong content — never accept as the same asset
        continue;
      }
      // Hash matches (or none expected). First good candidate wins.
      if (i === 0) primaryOk = true;
      result = { path, bytes };
      break;
    }

    if (!result) {
      return { ok: false, bytes: null, source: null, repaired: false, conflicts, reason: conflicts.length ? 'all candidates conflicted' : 'unreadable' };
    }

    // Repair: if a backup served the asset, try to rewrite the primary.
    let repaired = false;
    if (!primaryOk && record.primary) {
      try { await this.write(record.primary, result.bytes); repaired = true; } catch (_) { /* primary backend read-only */ }
    }

    record.lastVerified = Date.now();
    return { ok: true, bytes: result.bytes, source: result.path, repaired, conflicts };
  }
}

/** Adapt an AssetCache instance to a resolver backend (cache:// scheme). */
export function backendFromCache(cache) {
  return {
    async read(path) { return cache.get(`cache://${path}`); },
    async write(path, bytes) { return cache.put(`cache://${path}`, bytes); },
  };
}

/** A read-only backend that fetches relative to a base URL (asset://, cloud://). */
export function makeFetchBackend(base) {
  const root = String(base).replace(/\/$/, '');
  return {
    async read(path) {
      if (typeof fetch !== 'function') return null;
      try {
        const r = await fetch(`${root}/${path}`);
        if (!r.ok) return null;
        return new Uint8Array(await r.arrayBuffer());
      } catch (_) { return null; }
    },
  };
}

/** A simple in-memory backend (temp:// drag-drop, user:// session mounts). */
export function makeMemoryBackend(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async read(path) { return store.get(path) ?? null; },
    async write(path, bytes) { store.set(path, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); },
  };
}
