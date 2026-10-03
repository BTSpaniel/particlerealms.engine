// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/perception/ResonanceIndex.js — the Resonance/Perception extension
// reattached as an OPTIONAL indexing layer (spec §16, rules 52–56).
//
// This is where the codebook / resonance / spatial layers belong: approximate
// retrieval, never the trusted authority path. The discipline is strict and
// one-directional:
//
//   approximate similarity  → retrieves CANDIDATES   (cosine over feature vectors)
//   exact identity (hash)    → verifies BYTES         (cryptographic/fast hash)
//   semantic constraints     → verify MEANING         (predicate over content)
//   commit logic             → establishes TRUTH      (elsewhere; not here)
//
// A near match is only ever a suggestion. This module will NEVER return a
// similar-but-not-byte-identical item as a verified match — similarity suggests
// candidates; it never establishes identity (rule 53). Nearest-neighbour search
// may repair a visual cache or rank suggestions, but must never silently repair
// inventory, permissions, ownership, or other authoritative semantic state.

import { cosineSimilarity } from '../resonance/ResonanceVector.js';
import { hashIdFast } from '../util/canonical.js';

export class ResonanceIndex {
  constructor() {
    this._items = new Map(); // id → { id, vector, contentHash, content }
  }

  get size() { return this._items.size; }

  /**
   * Add an item: a feature `vector` for approximate retrieval plus its exact
   * `content` (the bytes that identity is verified against).
   */
  add(id, vector, content) {
    const key = String(id);
    this._items.set(key, { id: key, vector, content, contentHash: hashIdFast(content) });
    return this;
  }

  /**
   * Approximate retrieval: top-`k` candidates ranked by cosine similarity. These
   * are SUGGESTIONS only — never treat the top hit as an identity.
   * @returns {Array<{ id:string, similarity:number }>}
   */
  candidates(queryVector, k = 5) {
    const scored = [];
    for (const item of this._items.values()) {
      scored.push({ id: item.id, similarity: cosineSimilarity(queryVector, item.vector) });
    }
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, k);
  }

  /** Exact identity check: do the stored bytes hash-match the supplied bytes? */
  verifyExact(id, exactContent) {
    const item = this._items.get(String(id));
    if (!item) return false;
    return item.contentHash === hashIdFast(exactContent);
  }

  /**
   * The full §16 pipeline: retrieve candidates by similarity, then return the
   * first that EXACTLY matches `exactContent` by hash AND passes the optional
   * semantic predicate. Returns `match:null` if no candidate is byte-identical —
   * a merely-similar candidate is never accepted.
   * @param {*} queryVector
   * @param {*} exactContent the authoritative bytes to verify identity against
   * @param {object} [opts] @param {number} [opts.k] @param {(content:*)=>boolean} [opts.semantic]
   * @returns {{ match:string|null, verifiedBy:string|null, similarity:number|null, reason?:string }}
   */
  resolve(queryVector, exactContent, opts = {}) {
    const k = opts.k ?? 5;
    const semantic = opts.semantic ?? (() => true);
    const exactHash = hashIdFast(exactContent);
    for (const cand of this.candidates(queryVector, k)) {
      const item = this._items.get(cand.id);
      if (item.contentHash !== exactHash) continue;       // exact identity gate
      if (!semantic(item.content)) continue;              // semantic meaning gate
      return { match: cand.id, verifiedBy: 'exact-hash+semantic', similarity: cand.similarity };
    }
    return { match: null, verifiedBy: null, similarity: null, reason: 'no-exact-verified-candidate' };
  }
}
