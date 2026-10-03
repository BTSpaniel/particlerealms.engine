// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/uso/USORegistry.js — the unspent-output set + double-commit detector.
//
// Tracks which outputs currently exist (unspent) and which have been consumed
// (spent). Enforces the core safety invariant: an output is never committed as
// spent twice (spec §19). A spend transaction's inputs must ALL be currently
// unspent; on commit they move to the spent set and the new outputs are created
// atomically by the caller (CommitCoordinator).

import { isUSO } from './USO.js';

export class USORegistry {
  constructor() {
    this._unspent = new Map(); // id → USO
    this._spent = new Map();   // id → { uso, byTx }
  }

  /** Number of currently unspent outputs. */
  get size() { return this._unspent.size; }

  /** Register a freshly created output as unspent. Throws on id reuse. */
  create(uso) {
    if (!isUSO(uso)) throw new TypeError('USORegistry.create: not a USO');
    if (this._unspent.has(uso.id)) throw new Error(`USO already exists: ${uso.id}`);
    if (this._spent.has(uso.id)) throw new Error(`USO id reused after spend: ${uso.id}`);
    this._unspent.set(uso.id, uso);
    return uso;
  }

  /** True if the output id is currently unspent (available to consume). */
  isUnspent(id) { return this._unspent.has(String(id)); }

  /** True if the output id has already been consumed. */
  isSpent(id) { return this._spent.has(String(id)); }

  /** Get an unspent output by id, or null. */
  get(id) { return this._unspent.get(String(id)) ?? null; }

  /**
   * Double-commit detector: validate that EVERY id in `inputIds` is currently
   * unspent and that there are no duplicate ids in the request itself.
   * Returns the conflict reason instead of throwing so the coordinator can emit
   * a witness either way.
   * @param {string[]} inputIds
   * @returns {{ ok:boolean, reason:string|null, conflicts:string[] }}
   */
  checkSpendable(inputIds) {
    const seen = new Set();
    const conflicts = [];
    for (const raw of inputIds) {
      const id = String(raw);
      if (seen.has(id)) { conflicts.push(id); continue; } // duplicate input
      seen.add(id);
      if (this._spent.has(id)) conflicts.push(id);        // already spent
      else if (!this._unspent.has(id)) conflicts.push(id); // never existed
    }
    if (conflicts.length) {
      const dbl = conflicts.some((id) => this._spent.has(id));
      return { ok: false, reason: dbl ? 'double-commit' : 'unknown-or-duplicate-input', conflicts };
    }
    return { ok: true, reason: null, conflicts: [] };
  }

  /**
   * Atomically consume inputs and create outputs. Validates spendability first;
   * if any input is unspendable, NOTHING changes. Returns the result so the
   * coordinator can record a witness.
   * @param {string[]} inputIds
   * @param {object[]} outputs  new USOs to create
   * @param {string}   byTx     transaction id performing the spend
   * @returns {{ ok:boolean, reason:string|null, conflicts:string[], created:string[] }}
   */
  applySpend(inputIds, outputs, byTx) {
    const check = this.checkSpendable(inputIds);
    if (!check.ok) return { ...check, created: [] };
    // Pre-validate outputs before mutating (all-or-nothing).
    for (const out of outputs) {
      if (!isUSO(out)) return { ok: false, reason: 'invalid-output', conflicts: [], created: [] };
      if (this._unspent.has(out.id) || this._spent.has(out.id)) {
        return { ok: false, reason: 'output-id-collision', conflicts: [out.id], created: [] };
      }
    }
    for (const raw of inputIds) {
      const id = String(raw);
      const uso = this._unspent.get(id);
      this._unspent.delete(id);
      this._spent.set(id, { uso, byTx: String(byTx) });
    }
    const created = [];
    for (const out of outputs) { this._unspent.set(out.id, out); created.push(out.id); }
    return { ok: true, reason: null, conflicts: [], created };
  }

  /** Snapshot the unspent-output id set (for state roots / debugging). */
  unspentIds() { return [...this._unspent.keys()].sort(); }
}
