// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Bounded replay and monotonic-sequence protection for verified Accord records. */

import { safeInteger } from './AccordCrypto.js';

export class AccordReplayGuard {
  constructor({ now = () => Date.now(), maximumEntries = 4096, onDiagnostic = null } = {}) {
    if (typeof now !== 'function') throw new TypeError('AccordReplayGuard now must be a function');
    this._now = now;
    this._maximumEntries = safeInteger(maximumEntries, 'maximumEntries', 16, 65_536);
    this._onDiagnostic = typeof onDiagnostic === 'function' ? onDiagnostic : null;
    this._seen = new Map();
    this._sequences = new Map();
  }

  _emit(type, details) {
    try { this._onDiagnostic?.(Object.freeze({ type, at: this._now(), ...details })); } catch (_) { /* diagnostics are isolated */ }
  }

  _purge(at) {
    for (const [recordId, expiresAt] of this._seen) {
      if (expiresAt <= at) this._seen.delete(recordId);
    }
  }

  accept({ recordId, expiresAt, streamKey = null, sequence = null }) {
    const at = safeInteger(this._now(), 'replay time');
    const expiry = safeInteger(expiresAt, 'replay expiry', at + 1);
    this._purge(at);
    if (this._seen.has(recordId)) {
      this._emit('replay-rejected', { recordId, reason: 'duplicate-record' });
      return Object.freeze({ accepted: false, reason: 'replay' });
    }
    if (streamKey !== null) {
      const key = String(streamKey);
      const next = safeInteger(sequence, 'replay sequence', 0);
      const previous = this._sequences.get(key);
      if (previous !== undefined && next <= previous) {
        this._emit('replay-rejected', { recordId, reason: 'non-monotonic-sequence', streamKey: key, sequence: next, previous });
        return Object.freeze({ accepted: false, reason: 'non-monotonic-sequence' });
      }
      this._sequences.set(key, next);
    }
    if (this._seen.size >= this._maximumEntries) {
      const oldest = this._seen.keys().next().value;
      this._seen.delete(oldest);
      this._emit('replay-window-evicted', { recordId: oldest });
    }
    this._seen.set(String(recordId), expiry);
    this._emit('record-accepted', { recordId: String(recordId) });
    return Object.freeze({ accepted: true });
  }

  has(recordId) {
    this._purge(safeInteger(this._now(), 'replay time'));
    return this._seen.has(String(recordId));
  }

  clear() {
    this._seen.clear();
    this._sequences.clear();
  }

  snapshot() {
    this._purge(safeInteger(this._now(), 'replay time'));
    return Object.freeze({ records: this._seen.size, streams: this._sequences.size });
  }
}

export function consumeReplay(replayGuard, record, { idField, streamKey = null, sequence = null } = {}) {
  if (replayGuard == null) return Object.freeze({ valid: true });
  if (!(replayGuard instanceof AccordReplayGuard)) return Object.freeze({ valid: false, reason: 'replay-guard-invalid' });
  const result = replayGuard.accept({
    recordId: record[idField],
    expiresAt: record.expiresAt,
    streamKey,
    sequence,
  });
  return result.accepted
    ? Object.freeze({ valid: true })
    : Object.freeze({ valid: false, reason: result.reason });
}
