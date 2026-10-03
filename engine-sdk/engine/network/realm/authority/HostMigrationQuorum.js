// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { canonicalBytes, hashIdSecure } from '../../../state/util/canonical.js';
import { verifyWithKey } from '../../../state/authority/Identity.js';
import { byteSignature } from '../../../core/math/FormatMath.js';
import { assertRealmId, realmKeyFingerprint } from '../addressing/RealmIds.js';

export const HOST_MIGRATION_VOTE_FORMAT = 'realm-host-migration-vote-v1';

function unsigned(vote) {
  const result = { ...vote };
  delete result.voteId;
  delete result.signatureHex;
  return result;
}

function bytes(vote) {
  return canonicalBytes(unsigned(vote), { domain: 'realm-network.host-migration.signature', schemaVersion: HOST_MIGRATION_VOTE_FORMAT });
}

function signature(value) {
  if (typeof value === 'string' && /^[0-9a-f]+$/i.test(value)) return value.toLowerCase();
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return byteSignature(value instanceof ArrayBuffer ? new Uint8Array(value) : value);
  throw new TypeError('Host migration signer returned an invalid signature');
}

export async function createHostMigrationVote(input, signer) {
  if (!signer || signer.secure === false || typeof signer.sign !== 'function') throw new Error('A secure host migration signer is required');
  const publicKeyHex = String(signer.publicKeyHex ?? '').toLowerCase();
  const fingerprint = await realmKeyFingerprint(publicKeyHex);
  if (signer.fingerprint && signer.fingerprint !== fingerprint) throw new Error('Host migration signer fingerprint mismatch');
  const vote = {
    format: HOST_MIGRATION_VOTE_FORMAT,
    proposalId: String(input.proposalId),
    realmId: assertRealmId(input.realmId, 'realm'),
    branchId: assertRealmId(input.branchId, 'branch'),
    candidateId: assertRealmId(input.candidateId),
    voterId: assertRealmId(input.voterId),
    authorityMapRoot: String(input.authorityMapRoot),
    checkpointId: assertRealmId(input.checkpointId, 'checkpoint'),
    membershipEpoch: Number(input.membershipEpoch),
    approve: input.approve === true,
    occurredAt: Number(input.occurredAt ?? Date.now()),
    signer: Object.freeze({ publicKeyHex, fingerprint }),
  };
  if (!vote.proposalId || !vote.authorityMapRoot || !Number.isSafeInteger(vote.membershipEpoch) || vote.membershipEpoch < 0
    || !Number.isSafeInteger(vote.occurredAt) || vote.occurredAt < 0) throw new TypeError('Host migration vote fields are invalid');
  const voteId = await hashIdSecure(unsigned(vote), { domain: 'realm-network.host-migration', schemaVersion: HOST_MIGRATION_VOTE_FORMAT });
  return Object.freeze({ ...vote, voteId, signatureHex: signature(await signer.sign(bytes(vote))) });
}

export async function verifyHostMigrationVote(vote, authorizeVoter = null) {
  try {
    if (!vote || vote.format !== HOST_MIGRATION_VOTE_FORMAT) return { valid: false, reason: 'malformed-vote' };
    assertRealmId(vote.realmId, 'realm');
    assertRealmId(vote.branchId, 'branch');
    assertRealmId(vote.candidateId);
    assertRealmId(vote.voterId);
    assertRealmId(vote.checkpointId, 'checkpoint');
    const fingerprint = await realmKeyFingerprint(vote.signer?.publicKeyHex);
    if (fingerprint !== vote.signer?.fingerprint) return { valid: false, reason: 'signer-fingerprint-mismatch' };
    const expected = await hashIdSecure(unsigned(vote), { domain: 'realm-network.host-migration', schemaVersion: HOST_MIGRATION_VOTE_FORMAT });
    if (expected !== vote.voteId) return { valid: false, reason: 'vote-id-mismatch' };
    if (!(await verifyWithKey(vote.signer.publicKeyHex, bytes(vote), vote.signatureHex))) return { valid: false, reason: 'signature-invalid' };
    if (authorizeVoter && !(await authorizeVoter(vote.voterId, fingerprint, vote))) return { valid: false, reason: 'voter-unauthorized' };
    return { valid: true, voteId: expected };
  } catch (error) {
    return { valid: false, reason: error?.message ?? 'vote-invalid' };
  }
}

export class HostMigrationQuorum {
  constructor({ proposalId, eligibleVoterIds, threshold, authorizeVoter = null } = {}) {
    this.proposalId = String(proposalId ?? '');
    this.eligible = new Set(eligibleVoterIds ?? []);
    this.threshold = Number(threshold);
    this.authorizeVoter = authorizeVoter;
    this.votes = new Map();
    if (!this.proposalId || !Number.isSafeInteger(this.threshold) || this.threshold < 1 || this.threshold > this.eligible.size) {
      throw new TypeError('HostMigrationQuorum configuration is invalid');
    }
  }

  async add(vote) {
    if (vote?.proposalId !== this.proposalId) return { accepted: false, reason: 'proposal-mismatch' };
    if (!this.eligible.has(vote.voterId)) return { accepted: false, reason: 'voter-ineligible' };
    const verified = await verifyHostMigrationVote(vote, this.authorizeVoter);
    if (!verified.valid) return { accepted: false, reason: verified.reason };
    const existing = this.votes.get(vote.voterId);
    if (existing && existing.voteId !== vote.voteId) return { accepted: false, reason: 'voter-equivocation' };
    this.votes.set(vote.voterId, vote);
    return { accepted: true, duplicate: !!existing, decision: this.decision() };
  }

  decision() {
    const approvals = [...this.votes.values()].filter(vote => vote.approve).length;
    const rejections = this.votes.size - approvals;
    return Object.freeze({
      reached: approvals >= this.threshold,
      rejected: rejections > this.eligible.size - this.threshold,
      approvals,
      rejections,
      threshold: this.threshold,
    });
  }
}

