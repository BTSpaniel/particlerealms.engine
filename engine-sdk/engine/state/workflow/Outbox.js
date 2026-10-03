// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/workflow/Outbox.js — transactional outbox (spec §11, rule 41).
//
// A canonical commit cannot atomically control an unrelated email server,
// payment processor, OS call, or device. CSE solves this dual-write problem by
// writing an external-effect INTENT into the same atomic transaction as the
// internal state change (the CommitCoordinator appends intents here on commit);
// a separate worker later delivers each intent and receivers deduplicate by a
// stable effect id (rule 42). This module owns the durable intent queue and its
// status lifecycle:
//
//   pending → delivering → delivered → acked
//                       ↘ failed → (reconcile | retry)
//
// Re-recording the same effect id is a no-op, so commit retries never enqueue an
// effect twice. Delivery is at-least-once; idempotent receivers (see Inbox.js)
// make the end-to-end behavior effectively-once.

import { hashIdFast } from '../util/canonical.js';

export const EFFECT_STATUS = Object.freeze({
  PENDING: 'pending',
  DELIVERING: 'delivering',
  DELIVERED: 'delivered',
  ACKED: 'acked',
  FAILED: 'failed',
  RECONCILE: 'reconcile',
});

/**
 * Declare an external-effect intent. Every effect must state its reversibility
 * profile so the workflow plane knows whether it can be compensated, retried, or
 * must pause for approval (spec §11).
 * @param {object} spec
 * @param {string} spec.kind          e.g. 'email.send', 'file.write', 'tool.call'
 * @param {*}      [spec.payload]      opaque delivery data
 * @param {boolean}[spec.idempotent]   receiver can safely receive twice
 * @param {boolean}[spec.reversible]   effect can be undone directly
 * @param {boolean}[spec.compensatable] a compensating action exists
 * @param {boolean}[spec.irreversiblePivot] crossing this point cannot be undone
 * @param {boolean}[spec.requiresApproval] needs explicit human/authority sign-off
 * @param {string} [spec.reconciliation] named reconciliation procedure
 * @param {string} [spec.id]           stable effect id (auto-derived if omitted)
 * @returns {object} frozen intent with a stable `id`
 */
export function makeEffectIntent(spec = {}) {
  const core = {
    kind: String(spec.kind ?? 'effect'),
    payload: spec.payload ?? null,
    idempotent: spec.idempotent !== false,
    reversible: !!spec.reversible,
    compensatable: !!spec.compensatable,
    irreversiblePivot: !!spec.irreversiblePivot,
    requiresApproval: !!spec.requiresApproval,
    reconciliation: spec.reconciliation ?? null,
  };
  const id = spec.id ?? `effect:${core.kind}:${hashIdFast(core)}`;
  return Object.freeze({ id, ...core });
}

export class Outbox {
  constructor() {
    this._entries = new Map(); // effectId → { intent, status, txId, attempts, ack, error }
  }

  get size() { return this._entries.size; }

  /**
   * Record an intent (called atomically with the commit). Idempotent: an effect
   * id already present is returned unchanged, so commit retries never duplicate
   * the effect (rule 41/42).
   * @returns {object} the stored entry
   */
  record(intent, txId = null) {
    if (!intent?.id) throw new TypeError('Outbox.record: intent needs an id');
    const existing = this._entries.get(intent.id);
    if (existing) return existing;
    const entry = { intent, status: EFFECT_STATUS.PENDING, txId: txId ?? null, attempts: 0, ack: null, error: null };
    this._entries.set(intent.id, entry);
    return entry;
  }

  /** All entries currently awaiting delivery (pending or previously failed/retry). */
  pending() {
    return [...this._entries.values()].filter(
      (e) => e.status === EFFECT_STATUS.PENDING || e.status === EFFECT_STATUS.FAILED,
    );
  }

  /** Entries needing manual/automated reconciliation (ambiguous outcomes). */
  needsReconcile() {
    return [...this._entries.values()].filter((e) => e.status === EFFECT_STATUS.RECONCILE);
  }

  /** Status for an effect id, or null. */
  status(effectId) { return this._entries.get(String(effectId))?.status ?? null; }

  get(effectId) { return this._entries.get(String(effectId)) ?? null; }

  /**
   * Drain pending intents through a delivery function. The deliver fn returns
   * `{ ok, ack }` on success, throws or returns `{ ok:false }` on failure, or
   * `{ ambiguous:true }` when the outcome is unknown (→ RECONCILE, never guessed,
   * rule 43). Effects requiring approval are skipped until approved.
   * @param {(intent:object)=>Promise<{ok?:boolean, ack?:*, ambiguous?:boolean}>} deliver
   * @param {{ maxAttempts?:number, isApproved?:(intent:object)=>boolean }} [opts]
   * @returns {Promise<{delivered:number, failed:number, reconcile:number, skipped:number}>}
   */
  async drain(deliver, opts = {}) {
    const maxAttempts = opts.maxAttempts ?? 5;
    const isApproved = opts.isApproved ?? (() => true);
    let delivered = 0, failed = 0, reconcile = 0, skipped = 0;
    for (const entry of this.pending()) {
      if (entry.intent.requiresApproval && !isApproved(entry.intent)) { skipped++; continue; }
      entry.status = EFFECT_STATUS.DELIVERING;
      entry.attempts += 1;
      let res;
      try { res = await deliver(entry.intent); }
      catch (err) { res = { ok: false, error: err }; }
      if (res && res.ambiguous) {
        entry.status = EFFECT_STATUS.RECONCILE; reconcile++;
      } else if (res && res.ok) {
        entry.status = res.ack != null ? EFFECT_STATUS.ACKED : EFFECT_STATUS.DELIVERED;
        entry.ack = res.ack ?? null; delivered++;
      } else {
        entry.error = res?.error ?? 'delivery-failed';
        // Exhausted retries without a clear failure → escalate to reconcile.
        entry.status = entry.attempts >= maxAttempts ? EFFECT_STATUS.RECONCILE : EFFECT_STATUS.FAILED;
        if (entry.status === EFFECT_STATUS.RECONCILE) reconcile++; else failed++;
      }
    }
    return { delivered, failed, reconcile, skipped };
  }

  /** Mark an effect acknowledged by the receiver (idempotent inbox confirmed). */
  ack(effectId, ack = true) {
    const e = this._entries.get(String(effectId));
    if (!e) return false;
    e.status = EFFECT_STATUS.ACKED; e.ack = ack; return true;
  }
}
