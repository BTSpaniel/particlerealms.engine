// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/workflow/Reconciler.js — external-effect reconciler (spec §11, rule 43).
//
// When a delivery outcome is unknown (timeout, crash between send and ack, etc.)
// the effect is parked in the outbox as RECONCILE rather than guessed. The
// reconciler queries the external system's authoritative status for each parked
// effect and resolves it: confirm (it actually happened → ack), retry (it did
// not happen and is safe to resend → back to pending), or escalate (needs human
// / authority attention). Ambiguity is resolved by EVIDENCE, never assumption.

import { EFFECT_STATUS } from './Outbox.js';

export const RECONCILE_RESULT = Object.freeze({
  CONFIRMED: 'confirmed', // external system shows the effect succeeded
  RETRY: 'retry',         // effect did not happen; safe to resend
  ESCALATE: 'escalate',   // cannot determine / needs authority intervention
});

export class Reconciler {
  /** @param {import('./Outbox.js').Outbox} outbox */
  constructor(outbox) {
    if (!outbox) throw new TypeError('Reconciler requires an outbox');
    this._outbox = outbox;
  }

  /**
   * Reconcile every effect currently parked in RECONCILE.
   * @param {(intent:object)=>Promise<string>} probe  returns a RECONCILE_RESULT
   *        after querying the external system's authoritative status.
   * @returns {Promise<{confirmed:number, retry:number, escalate:number}>}
   */
  async reconcile(probe) {
    let confirmed = 0, retry = 0, escalate = 0;
    for (const entry of this._outbox.needsReconcile()) {
      let verdict;
      try { verdict = await probe(entry.intent); }
      catch (_) { verdict = RECONCILE_RESULT.ESCALATE; }
      if (verdict === RECONCILE_RESULT.CONFIRMED) {
        entry.status = EFFECT_STATUS.ACKED; entry.ack = entry.ack ?? true; confirmed++;
      } else if (verdict === RECONCILE_RESULT.RETRY) {
        // Only resend effects the receiver can safely dedupe (idempotent).
        if (entry.intent.idempotent) { entry.status = EFFECT_STATUS.PENDING; entry.error = null; retry++; }
        else { escalate++; } // non-idempotent + unknown outcome → must escalate
      } else {
        escalate++; // stays in RECONCILE for human/authority follow-up
      }
    }
    return { confirmed, retry, escalate };
  }
}
