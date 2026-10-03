// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/AssetCache.js — local engine cache (spec §3, cache://).
//
// Converted artifacts (engine binaries, preview meshes, thumbnails, colliders,
// SDFs, material packs) are cached under cache:// keyed by content hash so a
// re-import of the same source is instant. The primary backend is the Origin
// Private File System (OPFS) — origin-private and optimized for file access; an
// in-memory Map backs environments without OPFS (Node tests, locked-down
// contexts) so the rest of the runtime is backend-agnostic.

import { parseVPath, normalizeSegments } from './vpath.js';

const hasOPFS = () => typeof navigator !== 'undefined'
  && navigator.storage && typeof navigator.storage.getDirectory === 'function';

export class AssetCache {
  /**
   * @param {object} [opts]
   * @param {boolean} [opts.preferOPFS=true]
   * @param {string}  [opts.root='pe-asset-cache'] OPFS root directory name
   */
  constructor(opts = {}) {
    this._preferOPFS = opts.preferOPFS !== false && hasOPFS();
    this._rootName = opts.root || 'pe-asset-cache';
    this._mem = new Map();    // key → Uint8Array (fallback + write-through index)
    this._opfsRoot = null;
  }

  get backend() { return this._preferOPFS ? 'opfs' : 'memory'; }

  async _root() {
    if (!this._preferOPFS) return null;
    if (this._opfsRoot) return this._opfsRoot;
    const base = await navigator.storage.getDirectory();
    this._opfsRoot = await base.getDirectoryHandle(this._rootName, { create: true });
    return this._opfsRoot;
  }

  /** Map a cache:// vpath (or bare key) to a flat, filesystem-safe filename. */
  _keyOf(vpathOrKey) {
    const parsed = parseVPath(vpathOrKey);
    const path = parsed ? parsed.path : normalizeSegments(vpathOrKey);
    return path.replace(/[\\/]/g, '__');
  }

  /**
   * Store bytes under a cache key. Returns the key written.
   * @param {string} vpathOrKey
   * @param {Uint8Array|ArrayBuffer} data
   */
  async put(vpathOrKey, data) {
    const key = this._keyOf(vpathOrKey);
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this._mem.set(key, bytes);
    if (this._preferOPFS) {
      try {
        const root = await this._root();
        const fh = await root.getFileHandle(key, { create: true });
        const w = await fh.createWritable();
        await w.write(bytes);
        await w.close();
      } catch (_) { /* memory copy still holds it */ }
    }
    return key;
  }

  /**
   * Read bytes for a cache key, or null if absent.
   * @returns {Promise<Uint8Array|null>}
   */
  async get(vpathOrKey) {
    const key = this._keyOf(vpathOrKey);
    if (this._mem.has(key)) return this._mem.get(key);
    if (this._preferOPFS) {
      try {
        const root = await this._root();
        const fh = await root.getFileHandle(key, { create: false });
        const file = await fh.getFile();
        const bytes = new Uint8Array(await file.arrayBuffer());
        this._mem.set(key, bytes);
        return bytes;
      } catch (_) { return null; }
    }
    return null;
  }

  async has(vpathOrKey) {
    return (await this.get(vpathOrKey)) != null;
  }

  async delete(vpathOrKey) {
    const key = this._keyOf(vpathOrKey);
    this._mem.delete(key);
    if (this._preferOPFS) {
      try { const root = await this._root(); await root.removeEntry(key); } catch (_) { /* already gone */ }
    }
  }

  /** Best-effort listing of known cache keys (memory index + OPFS entries). */
  async keys() {
    const out = new Set(this._mem.keys());
    if (this._preferOPFS) {
      try {
        const root = await this._root();
        for await (const name of root.keys()) out.add(name);
      } catch (_) { /* ignore */ }
    }
    return [...out];
  }
}
