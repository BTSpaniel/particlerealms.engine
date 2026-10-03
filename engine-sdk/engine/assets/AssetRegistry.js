// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/AssetRegistry.js — the source of truth (spec §3, rule 3).
//
// The registry (not the filesystem) owns asset identity. Sources are
// deduplicated by content hash; the registry links exact duplicates, variants,
// and conflicts rather than merging them blindly. Registering an already-known
// source returns the canonical record (idempotent), so re-importing the same
// file never produces a second asset.

import { createAssetRecord } from './AssetRecord.js';
import { hashContent, classify, DEDUP } from './AssetDeduper.js';

export class AssetRegistry {
  constructor() {
    this._byId = new Map();
    this._byHash = new Map(); // sourceHash → record id
  }

  get size() { return this._byId.size; }
  list() { return [...this._byId.values()]; }
  get(id) { return this._byId.get(String(id)) ?? null; }
  getByHash(hash) { const id = this._byHash.get(hash); return id ? this._byId.get(id) : null; }

  /** Add a fully-formed record (used internally / by the resolver). */
  _add(record) {
    this._byId.set(record.id, record);
    if (record.sourceHash) this._byHash.set(record.sourceHash, record.id);
    return record;
  }

  /**
   * Register a source by its bytes. Hashes, classifies against existing records,
   * and links duplicates/variants/conflicts.
   * @param {Uint8Array|ArrayBuffer|string} bytes raw source data
   * @param {object} meta { name, sourceFormat, primary, backups, license, type, meshHash, tags }
   * @returns {Promise<{ record:object, dedup:string, canonical:object|null }>}
   */
  async registerSource(bytes, meta = {}) {
    const sourceHash = meta.sourceHash || await hashContent(bytes);
    const candidate = { sourceHash, name: meta.name, meshHash: meta.meshHash };
    const { kind, against } = classify(candidate, this.list());

    if (kind === DEDUP.EXACT_DUPLICATE) {
      // Idempotent: return the canonical record, optionally adding a new backup path.
      if (meta.primary && against.primary && meta.primary !== against.primary && !against.backups.includes(meta.primary)) {
        against.backups.push(meta.primary);
      }
      return { record: against, dedup: kind, canonical: against };
    }

    const record = createAssetRecord({
      type: meta.type, name: meta.name, sourceHash, sourceFormat: meta.sourceFormat,
      primary: meta.primary, backups: meta.backups, license: meta.license, tags: meta.tags,
      folder: meta.folder,
    });
    if (meta.meshHash) record.metadata = { ...(record.metadata ?? {}), meshHash: meta.meshHash };

    if (kind === DEDUP.VARIANT && against) {
      record.variants.push(against.id);
      against.variants.push(record.id);
    } else if (kind === DEDUP.CONFLICT && against) {
      record.conflictsWith.push(against.id);
      against.conflictsWith.push(record.id);
    }

    this._add(record);
    return { record, dedup: kind, canonical: kind === DEDUP.VARIANT ? against : null };
  }

  /** Record a converted artifact path against a registered asset. */
  setConverted(id, slot, vpath) {
    const r = this.get(id);
    if (!r) throw new Error(`AssetRegistry: unknown asset '${id}'`);
    if (!(slot in r.converted)) throw new Error(`AssetRegistry: unknown converted slot '${slot}'`);
    r.converted[slot] = vpath;
    return r;
  }

  toJSON() { return this.list(); }
}
