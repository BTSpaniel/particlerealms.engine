// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/transaction/Transaction.js — the one canonical transaction envelope.
//
// Every authoritative state change flows through this envelope (spec §6).
// A transaction must STATE everything whose correctness depends on current
// state: read-set (expected versions), predicates, consumed inputs (USOs),
// created outputs, capabilities and external-effect intents. Checking only
// written objects is insufficient — predicate/write-skew anomalies require the
// read+predicate sets to be declared up front (spec rule 20).
//
// The envelope is a plain, canonicalizable object; its transactionID is the
// secure hash of its canonical bytes (signature excluded), so the id is stable
// and tamper-evident.

import { canonicalize, hashIdFast, hashIdSecure } from '../util/canonical.js';

export const TX_SCHEMA_VERSION = 'cse-tx-1';

/**
 * Build a canonical transaction envelope. Missing fields default to safe empty
 * values so the shape is always complete (no partial transactions).
 *
 * @param {object} spec
 * @param {string}   spec.actorID            principal proposing the change
 * @param {string}   [spec.idempotencyKey]   `actor:task:operation` (deduplication)
 * @param {string[]} [spec.causalParents]    ids this tx causally depends on
 * @param {Array<{entity:string, expectedVersion:string|number}>} [spec.readSet]
 * @param {string[]} [spec.predicateSet]     named predicates that must hold
 * @param {string[]} [spec.consumeSet]       USO ids consumed (each at most once)
 * @param {string[]} [spec.createSet]        USO/version ids created
 * @param {Array}    [spec.mergeOperations]  CRDT merge ops (Phase 4)
 * @param {string[]} [spec.capabilities]     capability ids authorizing the change
 * @param {Array}    [spec.externalEffectIntents] outbox intents (Phase 3)
 * @param {string}   [spec.policyVersion]
 * @param {string}   [spec.validatorVersion]
 * @param {number}   [spec.expiryEpoch]      proposal expiry (operational time)
 * @param {string}   [spec.deterministicSeed]
 * @returns {object} a frozen envelope WITHOUT id/signature (see sealTransaction)
 */
export function makeTransaction(spec = {}) {
  const env = {
    schemaVersion: TX_SCHEMA_VERSION,
    actorID: String(spec.actorID ?? 'anonymous'),
    idempotencyKey: spec.idempotencyKey ?? null,
    causalParents: [...(spec.causalParents ?? [])].map(String),
    readSet: [...(spec.readSet ?? [])].map((r) => ({
      entity: String(r.entity),
      expectedVersion: r.expectedVersion ?? null,
    })),
    predicateSet: [...(spec.predicateSet ?? [])].map(String),
    consumeSet: [...(spec.consumeSet ?? [])].map(String),
    createSet: [...(spec.createSet ?? [])].map(String),
    mergeOperations: [...(spec.mergeOperations ?? [])],
    capabilities: [...(spec.capabilities ?? [])].map(String),
    externalEffectIntents: [...(spec.externalEffectIntents ?? [])],
    policyVersion: spec.policyVersion ?? null,
    validatorVersion: spec.validatorVersion ?? null,
    expiryEpoch: spec.expiryEpoch ?? null,
    deterministicSeed: spec.deterministicSeed ?? null,
  };
  return Object.freeze(env);
}

/** Canonical bytes of an envelope EXCLUDING id + signature (the signed body). */
export function transactionBody(env) {
  const { transactionID, signature, ...body } = env;
  return canonicalize(body);
}

/**
 * Attach a synchronous (fast) transactionID. Use for runtime/non-critical
 * transactions where a 32-bit identity is enough.
 * @returns {object} frozen envelope with `transactionID`
 */
export function sealTransactionFast(env) {
  const transactionID = hashIdFast(JSON.parse(transactionBody(env)));
  return Object.freeze({ ...env, transactionID });
}

/**
 * Attach a secure (SHA-256) transactionID and an optional signature produced by
 * an authority signer. The signature covers the transactionID.
 * @param {object} env
 * @param {{ sign?: (data:string)=>Promise<string|null>, principal?:string }} [signer]
 * @returns {Promise<object>} frozen sealed envelope
 */
export async function sealTransaction(env, signer = null) {
  const transactionID = await hashIdSecure(JSON.parse(transactionBody(env)));
  let signature = null;
  if (signer && typeof signer.sign === 'function') {
    signature = await signer.sign(transactionID);
  }
  return Object.freeze({ ...env, transactionID, signature });
}
