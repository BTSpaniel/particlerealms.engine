// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/transaction/CommitCoordinator.js — the atomic commit protocol (spec §7).
//
// No authoritative state change happens outside this pipeline (spec rule 19).
// It runs the 14-step protocol over a sealed transaction envelope and a set of
// canonical registries, then either commits atomically and returns a signed
// witness receipt, or rejects with a receipt explaining what failed. The
// pipeline enforces the CSE safety invariants: single-spend USOs, expected
// versions, valid + non-revoked authority, fencing-token freshness, predicate
// and invariant checks, idempotent replay, and a post-state root that matches
// the committed outputs.

import { transactionBody } from './Transaction.js';
import { hashIdFast, hashIdSecure, parseHashId } from '../util/canonical.js';
import { validateFacts, SCOPE_COMMIT } from '../facts/Constraints.js';
import { rootFromStores } from '../integrity/StateRoot.js';
import { makeReceipt } from '../witness/Witness.js';

async function recomputeTransactionId(env) {
  const tag = parseHashId(env.transactionID);
  const body = JSON.parse(transactionBody(env));
  if (tag && tag.alg === 'sha256') return hashIdSecure(body);
  return hashIdFast(body);
}

/**
 * Create a commit coordinator bound to a set of canonical registries.
 *
 * @param {object} cfg
 * @param {import('../uso/USORegistry.js').USORegistry} cfg.usoRegistry
 * @param {import('./Idempotency.js').IdempotencyRegistry} [cfg.idempotency]
 * @param {import('../causal/CausalParents.js').CausalGraph} [cfg.causal]
 * @param {import('../authority/CapabilityRegistry.js').CapabilityRegistry} [cfg.capabilities]
 * @param {import('../entity/EntityRegistry.js').EntityRegistry} [cfg.entities]
 * @param {import('../time/Fencing.js').FencingDomain} [cfg.fencing]
 * @param {import('../integrity/EventLog.js').EventLog} [cfg.eventLog]
 * @param {Object<string,(ctx:object)=>boolean>} [cfg.predicates] named predicates
 * @param {Array} [cfg.invariants] commit-strength constraints over live facts
 * @param {(env:object)=>Promise<boolean>} [cfg.verifySignature] authority signature check
 * @param {string} [cfg.authority] authority label embedded in receipts
 * @param {string} [cfg.policyVersion]
 * @param {string} [cfg.validatorVersion]
 */
export function createCommitCoordinator(cfg = {}) {
  const {
    usoRegistry, idempotency = null, causal = null, capabilities = null,
    entities = null, fencing = null, eventLog = null, outbox = null,
    predicates = {}, invariants = [], verifySignature = null,
    authority = 'local-primary', policyVersion = null, validatorVersion = null,
  } = cfg;

  if (!usoRegistry) throw new TypeError('CommitCoordinator requires a usoRegistry');

  function reject(env, rejection, extra = {}) {
    const receipt = makeReceipt({
      decision: 'rejected', transactionID: env.transactionID, authority,
      rejection, causalParents: env.causalParents, policyVersion, validatorVersion,
      consumed: env.consumeSet, ...extra,
    });
    return { ok: false, committed: null, replayed: false, receipt };
  }

  return {
    /**
     * Run the atomic commit protocol.
     * @param {object} base  the canonical FactStore (mutated atomically on success)
     * @param {object} env   a sealed transaction envelope
     * @param {object} [io]
     * @param {{add?:string[], revoke?:string[]}} [io.factDelta] fact changes to apply
     * @param {object[]} [io.outputs]  concrete USOs to create (ids must equal env.createSet)
     * @param {object} [io.context]    context passed to predicates/caveats
     * @param {number} [io.fencingToken]
     * @param {object} [io.signer]     { sign } for the witness receipt signature
     * @returns {Promise<{ok:boolean, committed:object|null, replayed:boolean, receipt:object}>}
     */
    async commit(base, env, io = {}) {
      const { factDelta = {}, outputs = [], context = {}, fencingToken = null, signer = null } = io;

      // 1. Canonicalize + 2. verify transaction id (and signature).
      const recomputed = await recomputeTransactionId(env);
      if (recomputed !== env.transactionID) return reject(env, 'bad-transaction-id');
      if (verifySignature) {
        let sigOk = false;
        try { sigOk = await verifySignature(env); } catch (_) { sigOk = false; }
        if (!sigOk) return reject(env, 'bad-signature');
      }

      // 3. Idempotency: a replay returns the original receipt, never repeats.
      if (idempotency && env.idempotencyKey && idempotency.has(env.idempotencyKey)) {
        const prior = idempotency.get(env.idempotencyKey);
        return { ok: prior.receipt.decision === 'committed', committed: null, replayed: true, receipt: prior.receipt };
      }

      // 4./5. Validate every capability (authority re-checked AT commit).
      for (const capId of env.capabilities) {
        if (!capabilities) return reject(env, 'no-capability-registry');
        const verdict = capabilities.check(capId, {
          principal: env.actorID, object: context.object, action: context.action,
          epoch: env.expiryEpoch, context,
        });
        if (!verdict.ok) return reject(env, `capability:${verdict.reason}`);
      }

      // 6a. Verify causal parents are known.
      if (causal) {
        const pc = causal.verifyParents(env.causalParents);
        if (!pc.ok) return reject(env, 'unknown-causal-parents', { violations: pc.unknown });
      }
      // 6b. Verify expected versions (optimistic read set / write-skew guard).
      if (entities) {
        for (const r of env.readSet) {
          if (!entities.matchesVersion(r.entity, r.expectedVersion)) {
            return reject(env, 'version-conflict', { violations: [r] });
          }
        }
      }

      // 7. Verify every consumed output is currently unspent (double-commit).
      const spendCheck = usoRegistry.checkSpendable(env.consumeSet);
      if (!spendCheck.ok) return reject(env, spendCheck.reason, { violations: spendCheck.conflicts });

      // Outputs supplied must match the declared createSet exactly.
      const outIds = outputs.map((o) => o.id).sort();
      const declared = [...env.createSet].sort();
      if (outIds.length !== declared.length || outIds.some((id, i) => id !== declared[i])) {
        return reject(env, 'create-set-mismatch', { violations: declared });
      }

      // 8. Fencing token / commit epoch freshness.
      if (fencing) {
        const fc = fencing.check(fencingToken);
        if (!fc.ok) return reject(env, fc.reason);
      }

      // 9. Predicates + invariants. Predicates run against context; invariants
      //    run against the PROJECTED post-commit live facts.
      for (const name of env.predicateSet) {
        const pred = predicates[name];
        if (typeof pred !== 'function') return reject(env, `unknown-predicate:${name}`);
        let ok = false; try { ok = !!pred(context); } catch (_) { ok = false; }
        if (!ok) return reject(env, `predicate-failed:${name}`);
      }
      const next = base.clone();
      for (const f of (factDelta.add || [])) next.add(f);
      for (const f of (factDelta.revoke || [])) next.revoke(f);
      const invCheck = validateFacts(next.live(), invariants, { phase: SCOPE_COMMIT });
      if (!invCheck.ok) return reject(env, 'invariant', { violations: invCheck.violations });

      // 10./11. Atomic transition: pre-root → spend USOs → apply facts →
      //          append event → post-root. USORegistry.applySpend is all-or-nothing.
      const preStateRoot = rootFromStores({ factStore: base, usoRegistry, entityRegistry: entities });
      const spend = usoRegistry.applySpend(env.consumeSet, outputs, env.transactionID);
      if (!spend.ok) return reject(env, spend.reason, { violations: spend.conflicts });

      base.merge(next); // facts are monotonic — union the committed delta in
      if (causal) causal.record(env.transactionID, env.causalParents);
      if (fencing && fencingToken != null) fencing.accept(fencingToken);

      // Consume single-use capabilities now that the commit succeeded.
      if (capabilities) {
        for (const capId of env.capabilities) {
          const cap = capabilities.get(capId);
          if (cap && cap.singleUse) capabilities.consume(capId);
        }
      }

      // 11 (external effects). Append external-effect intents to the outbox in
      // the SAME atomic step as the state change (transactional outbox, spec §11,
      // rule 41). Each intent gets a stable id; the outbox dedupes, so commit
      // retries never enqueue an effect twice. Delivery happens later, async.
      const pendingEffectIds = env.externalEffectIntents.map((e, i) => e.id ?? `effect:${env.transactionID}:${i}`);
      if (outbox) {
        env.externalEffectIntents.forEach((e, i) => {
          outbox.record(e.id ? e : { ...e, id: pendingEffectIds[i] }, env.transactionID);
        });
      }

      const postStateRoot = rootFromStores({ factStore: base, usoRegistry, entityRegistry: entities });

      // 12. Signed witness receipt.
      let signature = null;
      const receiptCore = {
        decision: 'committed', transactionID: env.transactionID, authority,
        preStateRoot, postStateRoot, consumed: env.consumeSet, created: spend.created,
        invariantsChecked: invariants.map((c) => c.id), policyVersion, validatorVersion,
        causalParents: env.causalParents,
        externalEffectsPending: pendingEffectIds,
      };
      if (signer && typeof signer.sign === 'function') {
        signature = await signer.sign(hashIdFast(receiptCore, { schemaVersion: 'receipt-v1' }));
      }
      const receipt = makeReceipt({ ...receiptCore, signature });

      // Append to the append-only log (spec §13).
      if (eventLog) eventLog.append('commit', receipt);

      // 3 (record). Remember the result for idempotency replay.
      if (idempotency && env.idempotencyKey) idempotency.record(env.idempotencyKey, env.transactionID, receipt);

      // 13./14. Projections + external effects are handled asynchronously by the
      //          Workflow plane (Phase 3); intents are recorded as pending above.
      return { ok: true, committed: base, replayed: false, receipt };
    },
  };
}
