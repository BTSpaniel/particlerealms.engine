// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/consistency/Reservation.js — reservations + bounded-counter escrow
// (spec §5 fragmentation fix, §10, rule 16).
//
// Two coordination-avoidance tools that sit in front of the commit path:
//
//  • ReservationManager — a reservation is itself a USO (single-use, exclusive).
//    Reserving a scarce resource creates a reservation output; it is later
//    CONSUMED on commit or RELEASED/expired. A reservation can never be consumed
//    twice (inherits the USO double-commit guarantee), and an expired
//    reservation cannot mutate protected state (liveness: aborted reservation is
//    eventually released).
//
//  • BoundedCounterEscrow — divides decrement rights for a scarce quantity among
//    holders so each can withdraw from its local grant WITHOUT coordination,
//    while preserving the lower-bound invariant (quantity never drops below the
//    floor). Coordination is only needed when a holder exhausts its grant and
//    must be rebalanced. This is the escrow / bounded-counter CRDT pattern.

import { makeUSO, USO_KIND } from '../uso/USO.js';

export class ReservationManager {
  /** @param {import('../uso/USORegistry.js').USORegistry} usoRegistry */
  constructor(usoRegistry) {
    if (!usoRegistry) throw new TypeError('ReservationManager requires a USORegistry');
    this._uso = usoRegistry;
    this._meta = new Map(); // reservationId → { resource, holder, expiryEpoch }
  }

  /**
   * Reserve a resource for a holder until `expiryEpoch` (operational time).
   * Creates a reservation USO; returns its id.
   * @returns {{ id:string }}
   */
  reserve({ resource, holder, expiryEpoch = null } = {}) {
    const uso = makeUSO({
      kind: USO_KIND.DECISION,
      entity: String(resource),
      discriminator: `reserve:${holder}:${expiryEpoch ?? '∞'}`,
      payload: { holder: String(holder), expiryEpoch },
    });
    this._uso.create(uso);
    this._meta.set(uso.id, { resource: String(resource), holder: String(holder), expiryEpoch });
    return { id: uso.id };
  }

  /** True if the reservation is unspent and not past its expiry at `epoch`. */
  isActive(reservationId, epoch = null) {
    const id = String(reservationId);
    if (!this._uso.isUnspent(id)) return false;
    const meta = this._meta.get(id);
    if (meta && meta.expiryEpoch != null && epoch != null && epoch > meta.expiryEpoch) return false;
    return true;
  }

  /**
   * Consume a reservation (the holder commits). Fails if expired or already
   * consumed/released — guaranteeing it is honored at most once.
   * @returns {{ ok:boolean, reason:string|null }}
   */
  consume(reservationId, epoch = null, byTx = 'reservation-consume') {
    const id = String(reservationId);
    if (!this.isActive(id, epoch)) {
      return { ok: false, reason: this._uso.isUnspent(id) ? 'expired' : 'already-settled' };
    }
    const r = this._uso.applySpend([id], [], byTx);
    return { ok: r.ok, reason: r.ok ? null : r.reason };
  }

  /**
   * Release a reservation (holder abandons it or it expired). Marks the
   * reservation USO spent so it can never be consumed afterward.
   * @returns {{ ok:boolean, reason:string|null }}
   */
  release(reservationId, byTx = 'reservation-release') {
    const id = String(reservationId);
    if (!this._uso.isUnspent(id)) return { ok: false, reason: 'already-settled' };
    const r = this._uso.applySpend([id], [], byTx);
    return { ok: r.ok, reason: r.ok ? null : r.reason };
  }
}

export class BoundedCounterEscrow {
  /**
   * @param {number} total  total quantity available for withdrawal above floor
   * @param {number} [floor] lower-bound invariant the counter must never breach
   */
  constructor(total, floor = 0) {
    if (!Number.isFinite(total) || total < 0) throw new RangeError('escrow total must be ≥ 0');
    this._floor = floor;
    this._pool = total;          // ungranted, withdrawable headroom (above floor)
    this._grants = new Map();    // holder → local withdrawal rights
    this._withdrawn = 0;         // total withdrawn (for invariant audit)
  }

  /** Withdrawable headroom not yet granted to any holder. */
  get available() { return this._pool; }
  /** Total withdrawn across all holders. */
  get withdrawn() { return this._withdrawn; }
  /** Remaining quantity above the floor (pool + all outstanding grants). */
  get remaining() {
    let granted = 0; for (const g of this._grants.values()) granted += g;
    return this._pool + granted;
  }
  /** A holder's local (coordination-free) withdrawal rights. */
  balance(holder) { return this._grants.get(String(holder)) ?? 0; }

  /**
   * Grant part of the ungranted pool to a holder as local withdrawal rights.
   * Returns the amount actually granted (may be less than requested).
   */
  grant(holder, amount) {
    const give = Math.max(0, Math.min(amount, this._pool));
    if (give === 0) return 0;
    const h = String(holder);
    this._grants.set(h, (this._grants.get(h) ?? 0) + give);
    this._pool -= give;
    return give;
  }

  /**
   * Withdraw `n` from a holder's LOCAL grant — no coordination required while
   * the holder has rights. Preserves the lower-bound invariant because the sum
   * of all grants never exceeds `total`.
   * @returns {{ ok:boolean, reason:string|null }}
   */
  withdraw(holder, n) {
    if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: 'invalid-amount' };
    const h = String(holder);
    const bal = this._grants.get(h) ?? 0;
    if (bal < n) return { ok: false, reason: 'insufficient-local-grant' }; // needs rebalance
    this._grants.set(h, bal - n);
    this._withdrawn += n;
    return { ok: true, reason: null };
  }

  /** Return unused local rights to the shared pool (e.g. holder going offline). */
  reclaim(holder) {
    const h = String(holder);
    const bal = this._grants.get(h) ?? 0;
    this._pool += bal;
    this._grants.delete(h);
    return bal;
  }

  /** The lower-bound invariant the escrow guarantees holds at all times. */
  invariantHolds() { return this.remaining >= 0 && this._withdrawn <= this._initialTotal(); }
  _initialTotal() { return this.remaining + this._withdrawn; }
}
