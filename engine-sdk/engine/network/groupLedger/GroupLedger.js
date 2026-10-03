// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/groupLedger/GroupLedger.js — private append-only group governance
// ledger (network plan §15/§16/§17).
//
// Reuses the Causal State Engine's `EventLog` (hash-chained append-only log,
// spec §13) and `CapabilityRegistry` as-is; governance approval decisions go
// through `GovernancePolicy.js` (PolicyEngine). Every event is a signed
// protocol envelope (protocol.js `particle-group-ledger/1`), so the ledger
// itself is a plain array of verifiable receipts — a group's current state
// is always the result of replaying it, never a separate source of truth.
//
// `EventLog` is in-memory only; callers are responsible for persisting
// `ledger.eventLog.entries()` (e.g. via webgpu-os/storage/AppSandbox on the
// OS side) and rehydrating with `replayGroupLedger()` — this module does not
// import any OS/storage code, keeping the engine layer storage-agnostic.

import { EventLog } from '../../state/integrity/EventLog.js';
import { CapabilityRegistry } from '../../state/authority/CapabilityRegistry.js';
import { makeEnvelope, signEnvelope, PROTOCOL_VERSIONS } from '../protocol.js';
import { createGovernancePolicy, GOVERNANCE_MODES } from './GovernancePolicy.js';

/**
 * Create a new (empty, ungenesised) group ledger.
 * @param {object} c
 * @param {string} c.groupId
 * @param {string[]} [c.founders]  founder membershipIds
 * @param {string} [c.mode]        GOVERNANCE_MODES
 * @param {number} [c.threshold]   for THRESHOLD mode
 * @returns {object} ledger state
 */
export function createGroupLedger({ groupId, founders = [], mode = GOVERNANCE_MODES.MAJORITY, threshold = null } = {}) {
  if (!groupId) throw new TypeError('createGroupLedger requires a groupId');
  const ledger = {
    groupId,
    mode,       // stashed for persistence round-tripping (see replayGroupLedger) — GovernancePolicy.js keeps its own closure copy for evaluation
    threshold,  // ditto
    eventLog: new EventLog(),
    capabilities: new CapabilityRegistry(),
    members: new Map(), // membershipId -> { role, joinedAt, publicKeyHex }
    founders: new Set(founders),
    _proposalVotes: new Map(), // proposalId -> Set<membershipId>
  };
  ledger.governance = createGovernancePolicy({
    mode,
    threshold,
    founders: () => ledger.founders,
    memberCount: () => Math.max(1, ledger.members.size),
  });
  return ledger;
}

/** Append the GROUP_GENESIS event and register the signing founder as the first member. */
export async function genesisGroup(ledger, { founderSigner, constitution = {} } = {}) {
  if (!founderSigner) throw new TypeError('genesisGroup requires a founderSigner');
  const env = makeEnvelope({
    protocol: PROTOCOL_VERSIONS.GROUP_LEDGER,
    type: 'GROUP_GENESIS',
    payload: { groupId: ledger.groupId, founders: [...ledger.founders], constitution },
  });
  const signed = await signEnvelope(env, founderSigner);
  const entry = ledger.eventLog.append('GROUP_GENESIS', signed);
  ledger.founders.add(founderSigner.principal);
  ledger.members.set(founderSigner.principal, { role: 'founder', joinedAt: Date.now(), publicKeyHex: founderSigner.publicKeyHex });
  return entry;
}

/** Cast a vote toward approving a pending proposal (network plan §17 eviction flow). */
export function castVote(ledger, proposalId, voterMembershipId) {
  if (!ledger._proposalVotes.has(proposalId)) ledger._proposalVotes.set(proposalId, new Set());
  const votes = ledger._proposalVotes.get(proposalId);
  votes.add(voterMembershipId);
  return votes;
}

/** Current vote set for a pending proposal (read-only copy). */
export function getVotes(ledger, proposalId) {
  return new Set(ledger._proposalVotes.get(proposalId) || []);
}

/**
 * Propose (and, if the governance policy allows, immediately commit) a
 * governance event. Safe/low-risk actions commit right away; irreversible
 * actions (MEMBER_REVOKED/MEMBER_BANNED/KEY_ROTATED/ROLE_CHANGED) require
 * enough prior `castVote()` calls under the same `proposalId` first.
 * @param {object} ledger
 * @param {object} c
 * @param {string} c.type        e.g. 'MEMBER_ADDED', 'MEMBER_REVOKED', ...
 * @param {object} [c.payload]
 * @param {object} c.signer      proposer's signer
 * @param {string} [c.proposalId]  required for actions needing approval
 * @returns {Promise<{ accepted:boolean, reason:string|null, entry?:object, verdict:object }>}
 */
export async function proposeGroupEvent(ledger, { type, payload = {}, signer, proposalId = null } = {}) {
  if (!type) throw new TypeError('proposeGroupEvent requires a type');
  if (!signer) throw new TypeError('proposeGroupEvent requires a signer');

  const approvals = proposalId ? getVotes(ledger, proposalId) : new Set();
  const verdict = ledger.governance.engine.evaluate(
    { action: type, principal: signer.principal, ...payload },
    { isApproved: (ctx) => ledger.governance.isApproved({ ...ctx, approvals }) },
  );
  if (!verdict.allowed) return { accepted: false, reason: verdict.reason, verdict };

  const env = makeEnvelope({
    protocol: PROTOCOL_VERSIONS.GROUP_LEDGER,
    type,
    payload: { groupId: ledger.groupId, ...payload },
  });
  const signed = await signEnvelope(env, signer);
  const entry = ledger.eventLog.append(type, signed);
  _applyMembershipSideEffect(ledger, type, payload);
  if (proposalId) ledger._proposalVotes.delete(proposalId);
  return { accepted: true, reason: null, entry, verdict };
}

function _applyMembershipSideEffect(ledger, type, payload) {
  if (type === 'MEMBER_ADDED' && payload.membershipId) {
    ledger.members.set(payload.membershipId, {
      role: payload.role || 'member', joinedAt: Date.now(), publicKeyHex: payload.publicKeyHex || null,
    });
  } else if ((type === 'MEMBER_REVOKED' || type === 'MEMBER_BANNED') && payload.membershipId) {
    ledger.members.delete(payload.membershipId);
  } else if (type === 'ROLE_CHANGED' && payload.membershipId && ledger.members.has(payload.membershipId)) {
    ledger.members.get(payload.membershipId).role = payload.role;
  }
}

/** True if the ledger's hash chain is intact end-to-end (tamper check). */
export function verifyGroupLedger(ledger) {
  return ledger.eventLog.verify();
}

/**
 * Rebuild a live ledger from previously-persisted `ledger.eventLog.entries()`
 * (network plan §15 persistence gap — see this file's header comment; OS-side
 * storage, e.g. webgpu-os/storage/AppSandbox, is the caller's job, not this
 * module's). Replays each entry through `EventLog.append()` (recomputing the
 * exact same hash chain deterministically) and re-derives `members`/
 * `founders` via the same side-effect rules `genesisGroup`/`proposeGroupEvent`
 * apply live, so a rehydrated ledger behaves identically to one built by
 * replaying the same operations in real time — with one honest limitation:
 * `EventLog` entries carry no wall-clock timestamp, and a `GROUP_GENESIS`
 * envelope only embeds the ONE signer's public key, so a `members` entry
 * reconstructed from genesis (unlike a later `MEMBER_ADDED`, whose payload
 * carries full details) will have `joinedAt: null` and, for any co-founder
 * who isn't the genesis envelope's own signer, `publicKeyHex: null`. This
 * does NOT weaken governance security — founder-protected mode checks
 * `ledger.founders` (a Set of principals, fully and exactly restored from
 * the genesis payload), not the `members` map.
 * @param {object} c
 * @param {string} c.groupId
 * @param {string[]} [c.founders]  same shape as createGroupLedger (only matters if entries is empty)
 * @param {string} [c.mode]
 * @param {number} [c.threshold]
 * @param {Array<object>} c.entries  from a prior `ledger.eventLog.entries()`
 * @returns {object} a live ledger
 * @throws {Error} if replaying a persisted entry doesn't recompute its original hash (tamper/corruption/out-of-order)
 */
export function replayGroupLedger({ groupId, founders = [], mode = GOVERNANCE_MODES.MAJORITY, threshold = null, entries = [] } = {}) {
  const ledger = createGroupLedger({ groupId, founders, mode, threshold });
  for (const entry of entries) {
    const appended = ledger.eventLog.append(entry.type, entry.payload);
    if (appended.hash !== entry.hash) {
      throw new Error(`replayGroupLedger: hash mismatch at seq ${entry.seq ?? appended.seq} — persisted ledger entries are corrupted or out of order`);
    }
    const inner = entry.payload?.payload || {};
    if (entry.type === 'GROUP_GENESIS') {
      for (const f of (inner.founders || [])) ledger.founders.add(f);
      if (inner.founders?.length === 1) {
        ledger.members.set(inner.founders[0], {
          role: 'founder', joinedAt: null,
          publicKeyHex: entry.payload?.signerPublicKeyHex || null,
        });
      }
    } else {
      _applyMembershipSideEffect(ledger, entry.type, inner);
    }
  }
  return ledger;
}
