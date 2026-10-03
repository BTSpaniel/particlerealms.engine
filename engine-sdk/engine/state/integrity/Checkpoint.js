// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/integrity/Checkpoint.js — compaction + fast restoration (spec §13).
//
// A checkpoint summarizes history without pretending it never existed: it links
// to the previous checkpoint and the event range it covers, and pins the
// canonical state root, unspent-output root, and policy/schema/validator
// versions. A restored system must verify its state root before accepting new
// commits (spec rule 64). Checkpoints carry an optional authority signature.

import { hashIdFast } from '../util/canonical.js';

/**
 * Build a checkpoint record.
 * @param {object} c
 * @param {string} [c.previousCheckpoint] prior checkpoint id (null for first)
 * @param {string} c.eventRangeRoot       event-log head hash at this point
 * @param {string} c.stateRoot            canonical state root
 * @param {string} c.unspentRoot          root over unspent outputs
 * @param {number} [c.fromSeq]            first covered event seq
 * @param {number} [c.toSeq]              last covered event seq
 * @param {string} [c.policyVersion]
 * @param {string} [c.schemaVersion]
 * @param {string} [c.validatorVersion]
 * @param {string|null} [c.signature]     authority signature over the checkpoint id
 * @returns {object} frozen checkpoint with a stable `id`
 */
export function makeCheckpoint(c = {}) {
  const body = {
    previousCheckpoint: c.previousCheckpoint ?? null,
    eventRangeRoot: String(c.eventRangeRoot ?? ''),
    stateRoot: String(c.stateRoot ?? ''),
    unspentRoot: String(c.unspentRoot ?? ''),
    fromSeq: c.fromSeq ?? 0,
    toSeq: c.toSeq ?? 0,
    policyVersion: c.policyVersion ?? null,
    schemaVersion: c.schemaVersion ?? null,
    validatorVersion: c.validatorVersion ?? null,
  };
  const id = hashIdFast(body, { schemaVersion: 'checkpoint-v1' });
  return Object.freeze({ id, ...body, signature: c.signature ?? null });
}

/**
 * Verify a checkpoint's stateRoot matches a freshly computed root, and (if a
 * predecessor is provided) that the chain links correctly (spec rule 60,64).
 * @returns {{ ok:boolean, reason:string|null }}
 */
export function verifyCheckpoint(checkpoint, computedStateRoot, predecessor = null) {
  if (checkpoint.stateRoot !== computedStateRoot) return { ok: false, reason: 'state-root-mismatch' };
  if (predecessor && checkpoint.previousCheckpoint !== predecessor.id) {
    return { ok: false, reason: 'broken-checkpoint-chain' };
  }
  return { ok: true, reason: null };
}
