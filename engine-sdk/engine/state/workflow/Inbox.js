// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/workflow/Inbox.js — idempotent inbox / effect receiver (spec §11, rule 42).
//
// The outbox delivers at-least-once, so the receiving side MUST deduplicate by
// the stable effect id to make the end-to-end behavior effectively-once. The
// inbox records the first result for each effect id; a redelivery returns the
// stored result and does NOT re-run the handler (mirrors the transaction
// IdempotencyRegistry, but for inbound external effects).

export class Inbox {
  constructor() {
    this._processed = new Map(); // effectId → { result, at }
  }

  get size() { return this._processed.size; }

  /** Has this effect id already been processed? */
  has(effectId) { return this._processed.has(String(effectId)); }

  /** Stored result for an effect id, or null. */
  get(effectId) { return this._processed.get(String(effectId))?.result ?? null; }

  /**
   * Receive an effect exactly once. On first sight, runs `handler(intent)` and
   * stores its result; on redelivery, returns the stored result without
   * re-running the handler.
   * @param {object} intent  must carry a stable `id`
   * @param {(intent:object)=>Promise<*>|*} handler
   * @returns {Promise<{ result:*, duplicate:boolean }>}
   */
  async receive(intent, handler) {
    if (!intent?.id) throw new TypeError('Inbox.receive: intent needs an id');
    const id = String(intent.id);
    const prior = this._processed.get(id);
    if (prior) return { result: prior.result, duplicate: true };
    const result = await handler(intent);
    this._processed.set(id, { result, at: null });
    return { result, duplicate: false };
  }
}
