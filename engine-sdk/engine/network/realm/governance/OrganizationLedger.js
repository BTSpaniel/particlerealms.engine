// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Cryptographically verified organization history.
 *
 * The ledger uses the same contextual verifier for live persistence and replay.
 * A proposal freezes its eligible membership set and quorum at its epoch; later
 * joins cannot vote, while revoked members and superseded keys fail immediately.
 */

import { canonicalize } from '../../../state/util/canonical.js';
import {
  REALM_ID_TYPE,
  assertRealmId,
  isRealmId,
  realmKeyFingerprint,
} from '../addressing/RealmIds.js';
import {
  ORGANIZATION_POWER,
  verifyOrganizationV1,
} from './OrganizationV1.js';
import {
  boundedInteger,
  boundedText,
  boundedToken,
  finishSignedRecord,
  verifySignedRecord,
} from './GovernanceCrypto.js';

export const GOVERNANCE_ENVELOPE_FORMAT = 'realm-governance-envelope-v1';

export const GOVERNANCE_ENVELOPE_KIND = Object.freeze({
  PROPOSAL: 'proposal.created',
  VOTE: 'vote.cast',
  COMMIT: 'proposal.committed',
});

export const ORGANIZATION_ACTION = Object.freeze({
  MEMBERSHIP_ADD: 'membership.add',
  MEMBERSHIP_REVOKE: 'membership.revoke',
  ROLE_ASSIGN: 'role.assign',
  ROLE_REVOKE: 'role.revoke',
  OWNERSHIP_TRANSFER: 'ownership.transfer',
  KEY_RECOVER: 'membership.key-recover',
});

const KINDS = new Set(Object.values(GOVERNANCE_ENVELOPE_KIND));
const ACTIONS = new Set(Object.values(ORGANIZATION_ACTION));
const ACTOR_TYPES = new Set([
  REALM_ID_TYPE.USER,
  REALM_ID_TYPE.AGENT,
  REALM_ID_TYPE.ORGANIZATION,
]);
const HASH_ID = /^sha256:256:[0-9a-f]{64}$/;
const PUBLIC_KEY = /^[0-9a-f]{130}$/;
const MAX_ENVELOPE_PAYLOAD_BYTES = 256 * 1024;
const textEncoder = new TextEncoder();

function assertActorId(value, label = 'Identity ID') {
  if (![...ACTOR_TYPES].some(type => isRealmId(value, type))) {
    throw new TypeError(`${label} must be a user, agent, or organization Realm ID`);
  }
  return value;
}

function normalizePayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Governance payload must be an object');
  if (textEncoder.encode(canonicalize(value)).byteLength > MAX_ENVELOPE_PAYLOAD_BYTES) {
    throw new TypeError('Governance payload exceeds 256 KiB');
  }
  return value;
}

function normalizeEnvelope(input) {
  const kind = boundedToken(input.kind, 'governance envelope kind', 64);
  if (!KINDS.has(kind)) throw new TypeError(`Unsupported governance envelope kind: ${kind}`);
  const previousEventId = String(input.previousEventId ?? '');
  if (!HASH_ID.test(previousEventId)) throw new TypeError('Governance previous event ID is invalid');
  return {
    format: GOVERNANCE_ENVELOPE_FORMAT,
    organizationId: assertRealmId(input.organizationId, REALM_ID_TYPE.ORGANIZATION, 'Organization ID'),
    sequence: boundedInteger(input.sequence, 'governance sequence', 1),
    previousEventId,
    stateEpoch: boundedInteger(input.stateEpoch, 'governance state epoch'),
    kind,
    payload: normalizePayload(input.payload),
    issuerIdentityId: assertActorId(input.issuerIdentityId, 'Issuer identity ID'),
    issuerMembershipId: assertRealmId(input.issuerMembershipId, REALM_ID_TYPE.MEMBERSHIP, 'Issuer membership ID'),
    issuedAt: boundedInteger(input.issuedAt ?? Date.now(), 'governance issuedAt'),
  };
}

export async function createGovernanceEnvelope(input, signer) {
  return finishSignedRecord(normalizeEnvelope(input), 'eventId', signer);
}

export async function verifyGovernanceEnvelope(record) {
  const verified = await verifySignedRecord(record, {
    format: GOVERNANCE_ENVELOPE_FORMAT,
    idField: 'eventId',
  });
  if (!verified.valid) return verified;
  try {
    return { ...verified, envelope: Object.freeze(normalizeEnvelope(record)) };
  } catch (error) {
    return { valid: false, reason: error?.message ?? 'governance-envelope-invalid' };
  }
}

function copyMember(member) {
  if (!member) return null;
  return Object.freeze({
    membershipId: member.membershipId,
    identityId: member.identityId,
    publicKeyHex: member.publicKeyHex,
    fingerprint: member.fingerprint,
    active: member.active,
    joinedEpoch: member.joinedEpoch,
    revokedEpoch: member.revokedEpoch,
    roles: Object.freeze([...member.roles].sort()),
    keyLineage: Object.freeze(member.keyLineage.map(entry => Object.freeze({ ...entry }))),
    compromisedFingerprints: Object.freeze([...member.compromisedFingerprints].sort()),
  });
}

function normalizePublicKey(value, label = 'public key') {
  const key = String(value ?? '').toLowerCase();
  if (!PUBLIC_KEY.test(key) || !key.startsWith('04')) throw new TypeError(`${label} must be a raw P-256 public key`);
  return key;
}

export class RealmOrganizationLedger {
  static async open(organizationRecord, options = {}) {
    const verified = await verifyOrganizationV1(organizationRecord);
    if (!verified.valid) throw new Error(`OrganizationV1 rejected: ${verified.reason}`);
    return new RealmOrganizationLedger(organizationRecord, verified.organization, options);
  }

  static async replay(organizationRecord, envelopes, options = {}) {
    if (!Array.isArray(envelopes)) throw new TypeError('Organization replay requires an envelope array');
    const ledger = await RealmOrganizationLedger.open(organizationRecord, options);
    for (const envelope of envelopes) {
      const result = await ledger.acceptEnvelope(envelope, { replay: true });
      if (!result.accepted) {
        throw new Error(`Organization replay rejected sequence ${envelope?.sequence ?? '?'}: ${result.reason}`);
      }
    }
    return ledger;
  }

  constructor(organizationRecord, organization, { now = () => Date.now(), diagnostic = null } = {}) {
    this.organizationRecord = organizationRecord;
    this.organization = organization;
    this.organizationId = organization.organizationId;
    this._now = now;
    this._diagnostic = typeof diagnostic === 'function' ? diagnostic : null;
    this._stateEpoch = 0;
    this._events = [];
    this._eventIds = new Set([organizationRecord.organizationRecordId]);
    this._lastEventId = organizationRecord.organizationRecordId;
    this._members = new Map();
    this._proposals = new Map();
    this._ownerMembershipId = organization.ownerMembershipId;
    this._members.set(organization.ownerMembershipId, {
      membershipId: organization.ownerMembershipId,
      identityId: organization.ownerIdentityId,
      publicKeyHex: organizationRecord.signer.publicKeyHex,
      fingerprint: organizationRecord.signer.fingerprint,
      active: true,
      joinedEpoch: 0,
      revokedEpoch: null,
      roles: new Set(['owner']),
      keyLineage: [{
        fingerprint: organizationRecord.signer.fingerprint,
        publicKeyHex: organizationRecord.signer.publicKeyHex,
        activatedEpoch: 0,
        retiredEpoch: null,
      }],
      compromisedFingerprints: new Set(),
    });
  }

  get stateEpoch() { return this._stateEpoch; }
  get sequence() { return this._events.length; }
  get ownerMembershipId() { return this._ownerMembershipId; }

  history() { return Object.freeze([this.organizationRecord, ...this._events]); }
  envelopes() { return Object.freeze([...this._events]); }
  getMembership(membershipId) { return copyMember(this._members.get(String(membershipId))); }

  listMemberships({ activeOnly = false } = {}) {
    return Object.freeze([...this._members.values()]
      .filter(member => !activeOnly || member.active)
      .map(copyMember)
      .sort((left, right) => left.membershipId.localeCompare(right.membershipId)));
  }

  getProposal(proposalId) {
    const proposal = this._proposals.get(String(proposalId));
    if (!proposal) return null;
    return Object.freeze({
      proposalId: proposal.proposalId,
      action: proposal.action,
      actionPayload: proposal.actionPayload,
      proposalEpoch: proposal.proposalEpoch,
      eligibleMembershipIds: Object.freeze([...proposal.eligibleMembershipIds].sort()),
      requiredApprovals: proposal.requiredApprovals,
      approvals: Object.freeze([...proposal.approvals.keys()].sort()),
      rejections: Object.freeze([...proposal.rejections.keys()].sort()),
      expiresAt: proposal.expiresAt,
      committed: proposal.committed,
    });
  }

  memberHasPower(membershipId, power) {
    const member = this._members.get(String(membershipId));
    if (!member?.active || !Object.values(ORGANIZATION_POWER).includes(power)) return false;
    return [...member.roles].some(role => this.organization.roles[role]?.powers.includes(power));
  }

  authorizeMembership(membershipId, fingerprint, power = ORGANIZATION_POWER.ADMIN) {
    const member = this._members.get(String(membershipId));
    return !!member?.active && member.fingerprint === String(fingerprint).toLowerCase()
      && this.memberHasPower(membershipId, power);
  }

  async propose({ action, payload, expiresAt = null }, signer, membershipId) {
    const member = this._requireCurrentSigner(membershipId);
    const normalizedAction = boundedToken(action, 'organization action', 64);
    if (!ACTIONS.has(normalizedAction)) throw new TypeError(`Unsupported organization action: ${normalizedAction}`);
    const actionPayload = await this._validateAction(normalizedAction, payload);
    const issuedAt = boundedInteger(this._now(), 'proposal time');
    const maximumExpiry = issuedAt + this.organization.constitution.proposalTtlMs;
    const normalizedExpiry = expiresAt == null ? maximumExpiry : boundedInteger(expiresAt, 'proposal expiry', issuedAt + 1);
    if (normalizedExpiry > maximumExpiry) throw new RangeError('Proposal expiry exceeds the OrganizationV1 TTL');
    const envelope = await this._makeEnvelope(GOVERNANCE_ENVELOPE_KIND.PROPOSAL, {
      action: normalizedAction,
      actionPayload,
      proposalEpoch: this._stateEpoch,
      expiresAt: normalizedExpiry,
    }, signer, member, issuedAt);
    const result = await this.acceptEnvelope(envelope);
    if (!result.accepted) throw new Error(`Proposal rejected: ${result.reason}`);
    return Object.freeze({ envelope, proposal: this.getProposal(envelope.eventId) });
  }

  async vote(proposalId, decision, signer, membershipId) {
    const member = this._requireCurrentSigner(membershipId);
    const normalizedDecision = boundedToken(decision, 'vote decision', 16);
    if (!['approve', 'reject'].includes(normalizedDecision)) throw new TypeError('Vote decision must be approve or reject');
    const envelope = await this._makeEnvelope(GOVERNANCE_ENVELOPE_KIND.VOTE, {
      proposalId: boundedText(proposalId, 'proposal ID', 96),
      decision: normalizedDecision,
    }, signer, member);
    const result = await this.acceptEnvelope(envelope);
    if (!result.accepted) throw new Error(`Vote rejected: ${result.reason}`);
    return envelope;
  }

  async commitProposal(proposalId, signer, membershipId) {
    const member = this._requireCurrentSigner(membershipId);
    const proposal = this._proposals.get(String(proposalId));
    if (!proposal) throw new Error('Unknown governance proposal');
    const voteEventIds = [...proposal.approvals.values()].sort();
    const envelope = await this._makeEnvelope(GOVERNANCE_ENVELOPE_KIND.COMMIT, {
      proposalId: proposal.proposalId,
      action: proposal.action,
      actionPayload: proposal.actionPayload,
      voteEventIds,
    }, signer, member);
    const result = await this.acceptEnvelope(envelope);
    if (!result.accepted) throw new Error(`Proposal commit rejected: ${result.reason}`);
    return envelope;
  }

  async acceptEnvelope(record, { replay = false } = {}) {
    const startedAt = globalThis.performance?.now?.() ?? Date.now();
    const result = await this._acceptEnvelope(record, { replay });
    const elapsedMs = (globalThis.performance?.now?.() ?? Date.now()) - startedAt;
    this._emit('governance.envelope', {
      accepted: result.accepted,
      reason: result.reason ?? null,
      eventId: record?.eventId ?? null,
      kind: record?.kind ?? null,
      replay,
      stateEpoch: this._stateEpoch,
      elapsedMs,
    });
    return result;
  }

  async _acceptEnvelope(record, { replay = false } = {}) {
    try {
      if (this._eventIds.has(record?.eventId)) return { accepted: false, duplicate: true, reason: 'event-replay' };
      const verified = await verifyGovernanceEnvelope(record);
      if (!verified.valid) return { accepted: false, reason: verified.reason };
      const envelope = verified.envelope;
      if (envelope.organizationId !== this.organizationId) return { accepted: false, reason: 'wrong-organization' };
      if (envelope.sequence !== this._events.length + 1) return { accepted: false, reason: 'sequence-mismatch' };
      if (envelope.previousEventId !== this._lastEventId) return { accepted: false, reason: 'history-parent-mismatch' };
      if (envelope.stateEpoch !== this._stateEpoch) return { accepted: false, reason: 'state-epoch-mismatch' };
      const member = this._members.get(envelope.issuerMembershipId);
      const signerCheck = this._checkMemberSigner(member, envelope, record.signer);
      if (!signerCheck.ok) return { accepted: false, reason: signerCheck.reason };
      const prepared = await this._prepareEnvelope(record, envelope, member, replay);
      if (!prepared.accepted) return prepared;
      this._events.push(record);
      this._eventIds.add(record.eventId);
      this._lastEventId = record.eventId;
      await prepared.apply();
      return { accepted: true, eventId: record.eventId, sequence: envelope.sequence, stateEpoch: this._stateEpoch };
    } catch (error) {
      return { accepted: false, reason: error?.message ?? 'governance-envelope-rejected' };
    }
  }

  async _makeEnvelope(kind, payload, signer, member, issuedAt = null) {
    return createGovernanceEnvelope({
      organizationId: this.organizationId,
      sequence: this._events.length + 1,
      previousEventId: this._lastEventId,
      stateEpoch: this._stateEpoch,
      kind,
      payload,
      issuerIdentityId: member.identityId,
      issuerMembershipId: member.membershipId,
      issuedAt: issuedAt ?? this._now(),
    }, signer);
  }

  _requireCurrentSigner(membershipId) {
    const member = this._members.get(String(membershipId));
    if (!member?.active) throw new Error('Membership is not active');
    return member;
  }

  _checkMemberSigner(member, envelope, signer) {
    if (!member?.active) return { ok: false, reason: 'membership-not-active' };
    if (member.identityId !== envelope.issuerIdentityId) return { ok: false, reason: 'membership-identity-mismatch' };
    if (member.fingerprint !== signer?.fingerprint || member.publicKeyHex !== signer?.publicKeyHex) {
      return { ok: false, reason: 'membership-key-mismatch' };
    }
    if (member.compromisedFingerprints.has(signer.fingerprint)) return { ok: false, reason: 'membership-key-compromised' };
    return { ok: true, reason: null };
  }

  async _prepareEnvelope(record, envelope, member, replay) {
    if (envelope.kind === GOVERNANCE_ENVELOPE_KIND.PROPOSAL) {
      if (!this.organization.constitution.allowMemberProposals
        && !this.memberHasPower(member.membershipId, ORGANIZATION_POWER.ADMIN)) {
        return { accepted: false, reason: 'proposal-admin-required' };
      }
      const action = boundedToken(envelope.payload.action, 'proposal action', 64);
      if (!ACTIONS.has(action)) return { accepted: false, reason: 'unsupported-organization-action' };
      if (envelope.payload.proposalEpoch !== this._stateEpoch) return { accepted: false, reason: 'proposal-epoch-mismatch' };
      const expiresAt = boundedInteger(envelope.payload.expiresAt, 'proposal expiry', envelope.issuedAt + 1);
      if (expiresAt > envelope.issuedAt + this.organization.constitution.proposalTtlMs) {
        return { accepted: false, reason: 'proposal-ttl-exceeded' };
      }
      const actionPayload = await this._validateAction(action, envelope.payload.actionPayload);
      const eligibleMembershipIds = this._eligibleMembers();
      const requiredApprovals = this._requiredApprovals(eligibleMembershipIds.size);
      return {
        accepted: true,
        apply: async () => {
          this._proposals.set(record.eventId, {
            proposalId: record.eventId,
            action,
            actionPayload,
            proposalEpoch: this._stateEpoch,
            eligibleMembershipIds,
            requiredApprovals,
            approvals: new Map(),
            rejections: new Map(),
            expiresAt,
            committed: false,
          });
        },
      };
    }

    if (envelope.kind === GOVERNANCE_ENVELOPE_KIND.VOTE) {
      const proposal = this._proposals.get(String(envelope.payload.proposalId));
      if (!proposal) return { accepted: false, reason: 'proposal-not-found' };
      if (proposal.committed) return { accepted: false, reason: 'proposal-already-committed' };
      if (!replay && this._now() >= proposal.expiresAt) return { accepted: false, reason: 'proposal-expired' };
      if (envelope.issuedAt >= proposal.expiresAt) return { accepted: false, reason: 'vote-after-expiry' };
      if (!proposal.eligibleMembershipIds.has(member.membershipId)) return { accepted: false, reason: 'voter-not-eligible-at-proposal-epoch' };
      if (!this._isVoteEligible(member)) return { accepted: false, reason: 'voter-no-longer-eligible' };
      if (proposal.approvals.has(member.membershipId) || proposal.rejections.has(member.membershipId)) {
        return { accepted: false, reason: 'membership-already-voted' };
      }
      const decision = boundedToken(envelope.payload.decision, 'vote decision', 16);
      if (!['approve', 'reject'].includes(decision)) return { accepted: false, reason: 'invalid-vote-decision' };
      return {
        accepted: true,
        apply: async () => {
          const votes = decision === 'approve' ? proposal.approvals : proposal.rejections;
          votes.set(member.membershipId, record.eventId);
        },
      };
    }

    const proposal = this._proposals.get(String(envelope.payload.proposalId));
    if (!proposal) return { accepted: false, reason: 'proposal-not-found' };
    if (proposal.committed) return { accepted: false, reason: 'proposal-already-committed' };
    if (!this.memberHasPower(member.membershipId, ORGANIZATION_POWER.ADMIN)) {
      return { accepted: false, reason: 'commit-admin-required' };
    }
    if (!replay && this._now() >= proposal.expiresAt) return { accepted: false, reason: 'proposal-expired' };
    if (envelope.issuedAt >= proposal.expiresAt) return { accepted: false, reason: 'commit-after-expiry' };
    if (proposal.approvals.size < proposal.requiredApprovals) return { accepted: false, reason: 'quorum-not-reached' };
    if (envelope.payload.action !== proposal.action
      || canonicalize(envelope.payload.actionPayload) !== canonicalize(proposal.actionPayload)) {
      return { accepted: false, reason: 'commit-action-mismatch' };
    }
    const expectedVotes = [...proposal.approvals.values()].sort();
    if (!Array.isArray(envelope.payload.voteEventIds)
      || canonicalize([...envelope.payload.voteEventIds].sort()) !== canonicalize(expectedVotes)) {
      return { accepted: false, reason: 'commit-vote-proof-mismatch' };
    }
    const actionPayload = await this._validateAction(proposal.action, proposal.actionPayload);
    return {
      accepted: true,
      apply: async () => {
        await this._applyAction(proposal.action, actionPayload);
        proposal.committed = true;
        this._stateEpoch += 1;
      },
    };
  }

  _eligibleMembers() {
    return new Set([...this._members.values()]
      .filter(member => this._isVoteEligible(member))
      .map(member => member.membershipId));
  }

  _isVoteEligible(member) {
    if (!member?.active) return false;
    const eligible = new Set(this.organization.constitution.eligibleRoles);
    return [...member.roles].some(role => eligible.has(role) && this.organization.roles[role]?.canVote);
  }

  _requiredApprovals(eligibleCount) {
    const constitution = this.organization.constitution;
    return Math.max(
      constitution.minApprovals,
      Math.ceil((eligibleCount * constitution.quorumNumerator) / constitution.quorumDenominator),
    );
  }

  async _validateAction(action, rawPayload) {
    const payload = normalizePayload(rawPayload);
    if (action === ORGANIZATION_ACTION.MEMBERSHIP_ADD) {
      const membershipId = assertRealmId(payload.membershipId, REALM_ID_TYPE.MEMBERSHIP, 'Membership ID');
      if (this._members.get(membershipId)?.active) throw new Error('Membership is already active');
      const identityId = assertActorId(payload.identityId, 'Member identity ID');
      const publicKeyHex = normalizePublicKey(payload.publicKeyHex, 'Member public key');
      const fingerprint = await realmKeyFingerprint(publicKeyHex);
      if (payload.fingerprint != null && String(payload.fingerprint).toLowerCase() !== fingerprint) {
        throw new Error('Member fingerprint does not match its public key');
      }
      const roles = this._normalizeRoles(payload.roles ?? ['member']);
      return Object.freeze({ membershipId, identityId, publicKeyHex, fingerprint, roles });
    }
    if (action === ORGANIZATION_ACTION.MEMBERSHIP_REVOKE) {
      const membershipId = assertRealmId(payload.membershipId, REALM_ID_TYPE.MEMBERSHIP, 'Membership ID');
      const target = this._members.get(membershipId);
      if (!target?.active) throw new Error('Membership is not active');
      if (membershipId === this._ownerMembershipId) throw new Error('Current owner membership cannot be revoked');
      return Object.freeze({ membershipId, reason: boundedText(payload.reason, 'Membership revocation reason', 1024) });
    }
    if (action === ORGANIZATION_ACTION.ROLE_ASSIGN || action === ORGANIZATION_ACTION.ROLE_REVOKE) {
      const membershipId = assertRealmId(payload.membershipId, REALM_ID_TYPE.MEMBERSHIP, 'Membership ID');
      const target = this._members.get(membershipId);
      if (!target?.active) throw new Error('Membership is not active');
      const role = boundedToken(payload.role, 'Organization role', 64);
      if (!this.organization.roles[role]) throw new Error(`Unknown organization role: ${role}`);
      if (action === ORGANIZATION_ACTION.ROLE_ASSIGN && target.roles.has(role)) throw new Error('Membership already has this role');
      if (action === ORGANIZATION_ACTION.ROLE_REVOKE && !target.roles.has(role)) throw new Error('Membership does not have this role');
      if (action === ORGANIZATION_ACTION.ROLE_REVOKE && role === 'owner') throw new Error('Owner role changes require ownership.transfer');
      return Object.freeze({ membershipId, role });
    }
    if (action === ORGANIZATION_ACTION.OWNERSHIP_TRANSFER) {
      const membershipId = assertRealmId(payload.membershipId, REALM_ID_TYPE.MEMBERSHIP, 'New owner membership ID');
      if (!this._members.get(membershipId)?.active) throw new Error('New owner membership is not active');
      if (membershipId === this._ownerMembershipId) throw new Error('Membership is already the owner');
      return Object.freeze({ membershipId });
    }
    if (action === ORGANIZATION_ACTION.KEY_RECOVER) {
      const membershipId = assertRealmId(payload.membershipId, REALM_ID_TYPE.MEMBERSHIP, 'Recovered membership ID');
      const target = this._members.get(membershipId);
      if (!target?.active) throw new Error('Recovered membership is not active');
      const publicKeyHex = normalizePublicKey(payload.publicKeyHex, 'Recovered public key');
      const fingerprint = await realmKeyFingerprint(publicKeyHex);
      if (fingerprint === target.fingerprint || target.compromisedFingerprints.has(fingerprint)) {
        throw new Error('Recovered membership key must be a new trusted key');
      }
      if (payload.fingerprint != null && String(payload.fingerprint).toLowerCase() !== fingerprint) {
        throw new Error('Recovered fingerprint does not match its public key');
      }
      return Object.freeze({
        membershipId,
        publicKeyHex,
        fingerprint,
        reason: boundedText(payload.reason, 'Key recovery reason', 1024),
      });
    }
    throw new TypeError(`Unsupported organization action: ${action}`);
  }

  _normalizeRoles(values) {
    if (!Array.isArray(values) || values.length === 0 || values.length > 16) throw new TypeError('Membership roles are invalid');
    const roles = [...new Set(values.map(value => boundedToken(value, 'Membership role', 64)))].sort();
    if (roles.length !== values.length) throw new TypeError('Membership roles must not contain duplicates');
    for (const role of roles) if (!this.organization.roles[role]) throw new TypeError(`Unknown organization role: ${role}`);
    if (roles.includes('owner')) throw new Error('Owner role can only be assigned through ownership.transfer');
    return Object.freeze(roles);
  }

  async _applyAction(action, payload) {
    if (action === ORGANIZATION_ACTION.MEMBERSHIP_ADD) {
      this._members.set(payload.membershipId, {
        membershipId: payload.membershipId,
        identityId: payload.identityId,
        publicKeyHex: payload.publicKeyHex,
        fingerprint: payload.fingerprint,
        active: true,
        joinedEpoch: this._stateEpoch + 1,
        revokedEpoch: null,
        roles: new Set(payload.roles),
        keyLineage: [{
          fingerprint: payload.fingerprint,
          publicKeyHex: payload.publicKeyHex,
          activatedEpoch: this._stateEpoch + 1,
          retiredEpoch: null,
        }],
        compromisedFingerprints: new Set(),
      });
      this._emit('governance.state-change', { action, membershipId: payload.membershipId, nextEpoch: this._stateEpoch + 1 });
      return;
    }
    const member = this._members.get(payload.membershipId);
    if (action === ORGANIZATION_ACTION.MEMBERSHIP_REVOKE) {
      member.active = false;
      member.revokedEpoch = this._stateEpoch + 1;
      this._emit('governance.state-change', { action, membershipId: payload.membershipId, nextEpoch: this._stateEpoch + 1 });
      return;
    }
    if (action === ORGANIZATION_ACTION.ROLE_ASSIGN) {
      member.roles.add(payload.role);
      this._emit('governance.state-change', { action, membershipId: payload.membershipId, role: payload.role, nextEpoch: this._stateEpoch + 1 });
      return;
    }
    if (action === ORGANIZATION_ACTION.ROLE_REVOKE) {
      member.roles.delete(payload.role);
      this._emit('governance.state-change', { action, membershipId: payload.membershipId, role: payload.role, nextEpoch: this._stateEpoch + 1 });
      return;
    }
    if (action === ORGANIZATION_ACTION.OWNERSHIP_TRANSFER) {
      const formerOwner = this._members.get(this._ownerMembershipId);
      formerOwner.roles.delete('owner');
      if (formerOwner.roles.size === 0) formerOwner.roles.add('administrator');
      member.roles.add('owner');
      this._ownerMembershipId = member.membershipId;
      this._emit('governance.state-change', { action, membershipId: payload.membershipId, nextEpoch: this._stateEpoch + 1 });
      return;
    }
    if (action === ORGANIZATION_ACTION.KEY_RECOVER) {
      const activeKey = member.keyLineage[member.keyLineage.length - 1];
      activeKey.retiredEpoch = this._stateEpoch + 1;
      member.compromisedFingerprints.add(member.fingerprint);
      member.publicKeyHex = payload.publicKeyHex;
      member.fingerprint = payload.fingerprint;
      member.keyLineage.push({
        fingerprint: payload.fingerprint,
        publicKeyHex: payload.publicKeyHex,
        activatedEpoch: this._stateEpoch + 1,
        retiredEpoch: null,
      });
      this._emit('governance.state-change', {
        action,
        membershipId: payload.membershipId,
        fingerprint: payload.fingerprint,
        nextEpoch: this._stateEpoch + 1,
      });
    }
  }

  _emit(type, detail) {
    if (!this._diagnostic) return;
    try {
      this._diagnostic(Object.freeze({
        type,
        organizationId: this.organizationId,
        at: this._now(),
        ...detail,
      }));
    } catch (_) {
      // Diagnostics are observational and must never alter governance decisions.
    }
  }
}

export async function replayOrganizationLedger(organizationRecord, envelopes, options = {}) {
  return RealmOrganizationLedger.replay(organizationRecord, envelopes, options);
}
