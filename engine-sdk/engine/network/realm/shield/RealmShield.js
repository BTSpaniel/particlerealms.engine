// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Runtime isolation, quotas, moderation, and tamper-evident audit for Realm entry. */

import { hashIdSecure } from '../../../state/util/canonical.js';
import {
  REALM_ID_TYPE,
  assertRealmId,
  createRealmId,
} from '../addressing/RealmIds.js';
import { deepFreeze } from '../capsule/RealmCapsuleSchema.js';
import { GATE_OUTCOME, verifyGatePlan } from '../gate/GatePlanV1.js';
import {
  boundedInteger,
  boundedText,
  boundedToken,
} from '../governance/GovernanceCrypto.js';

export const SHIELD_AUDIT_V1_FORMAT = 'realm-shield-audit-v1';
export const SHIELD_REPORT_V1_FORMAT = 'realm-shield-report-v1';
export const SHIELD_SNAPSHOT_V1_FORMAT = 'realm-shield-snapshot-v1';

export const SHIELD_RESOURCE = Object.freeze({
  MEMORY_BYTES: 'memoryBytes',
  STORAGE_BYTES: 'storageBytes',
  NETWORK_BYTES: 'networkBytes',
  OPERATIONS: 'operations',
  CPU_MS: 'cpuMs',
});

export const SHIELD_ACTION = Object.freeze({
  INSPECT: 'inspect',
  READ: 'read',
  WRITE: 'write',
  SCRIPT: 'script',
  NETWORK_READ: 'network.read',
  NETWORK_WRITE: 'network.write',
  PUBLISH: 'publish',
});

export const SHIELD_MODERATION_ACTION = Object.freeze({
  DISMISS: 'dismiss',
  BLOCK: 'block',
  QUARANTINE: 'quarantine',
  RESTORE: 'restore',
});

const RESOURCES = new Set(Object.values(SHIELD_RESOURCE));
const ACTIONS = new Set(Object.values(SHIELD_ACTION));
const MODERATION_ACTIONS = new Set(Object.values(SHIELD_MODERATION_ACTION));
const AUDIT_FIELDS = new Set([
  'format', 'sequence', 'previousAuditId', 'type', 'actorId', 'subjectId',
  'occurredAt', 'details', 'auditId',
]);
const HASH_ID = /^sha256:256:[0-9a-f]{64}$/;

const DEFAULT_QUOTAS = Object.freeze({
  maxSessionsPerIdentity: 4,
  memoryBytes: 512 * 1024 * 1024,
  storageBytes: 2 * 1024 * 1024 * 1024,
  networkBytes: 1024 * 1024 * 1024,
  operations: 100_000,
  cpuMs: 30 * 60_000,
});

const PROFILE_ACTIONS = Object.freeze({
  [GATE_OUTCOME.QUARANTINE]: Object.freeze([SHIELD_ACTION.INSPECT]),
  [GATE_OUTCOME.SAFE]: Object.freeze([SHIELD_ACTION.INSPECT, SHIELD_ACTION.READ, SHIELD_ACTION.NETWORK_READ]),
  [GATE_OUTCOME.READ_ONLY]: Object.freeze([SHIELD_ACTION.INSPECT, SHIELD_ACTION.READ, SHIELD_ACTION.NETWORK_READ]),
  [GATE_OUTCOME.FULL]: Object.freeze(Object.values(SHIELD_ACTION)),
});

function normalizeQuotas(value = {}) {
  const result = {};
  for (const [name, fallback] of Object.entries(DEFAULT_QUOTAS)) {
    result[name] = boundedInteger(value[name] ?? fallback, `Shield quota ${name}`);
  }
  if (result.maxSessionsPerIdentity < 1) throw new RangeError('Shield must allow at least one session per identity');
  return Object.freeze(result);
}

function emptyUsage() {
  return Object.fromEntries([...RESOURCES].map(name => [name, 0]));
}

function normalizeIsolation(outcome) {
  const actions = PROFILE_ACTIONS[outcome];
  if (!actions) throw new Error(`Gate outcome ${outcome} cannot create a Shield session`);
  return deepFreeze({
    outcome,
    actions: [...actions],
    origin: outcome === GATE_OUTCOME.FULL ? 'realm-scoped' : 'realm-isolated',
    storage: outcome === GATE_OUTCOME.FULL ? 'persistent-scoped' : 'ephemeral',
    network: outcome === GATE_OUTCOME.QUARANTINE ? 'disabled' : 'realm-scoped',
    scripts: outcome === GATE_OUTCOME.FULL ? 'capability-scoped' : 'disabled',
    mutation: outcome === GATE_OUTCOME.FULL ? 'capability-scoped' : 'disabled',
  });
}

function cloneBoundedDetails(value) {
  if (value == null) return Object.freeze({});
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Shield audit details must be an object');
  const encoded = JSON.stringify(value);
  if (encoded === undefined || new TextEncoder().encode(encoded).byteLength > 16 * 1024) {
    throw new TypeError('Shield audit details exceed 16 KiB');
  }
  return deepFreeze(JSON.parse(encoded));
}

function snapshotSession(session) {
  return deepFreeze({
    sessionId: session.sessionId,
    planId: session.plan.planId,
    identityId: session.identityId,
    realmId: session.realmId,
    branchId: session.branchId,
    capsuleRoot: session.capsuleRoot,
    baseOutcome: session.baseOutcome,
    outcome: session.outcome,
    isolation: session.isolation,
    usage: { ...session.usage },
    openedAt: session.openedAt,
    suspended: session.suspended,
    suspensionReason: session.suspensionReason,
    closed: session.closed,
  });
}

async function auditIdFor(event) {
  const value = { ...event };
  delete value.auditId;
  return hashIdSecure(value, {
    domain: 'realm-network.shield.audit',
    schemaVersion: SHIELD_AUDIT_V1_FORMAT,
  });
}

export async function verifyShieldAuditTrail(events) {
  if (!Array.isArray(events)) return Object.freeze({ valid: false, reason: 'audit-trail-not-array' });
  let previousAuditId = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    try {
      if (!event || typeof event !== 'object' || Array.isArray(event)) throw new TypeError('audit event must be an object');
      if (Object.keys(event).some(key => !AUDIT_FIELDS.has(key))) throw new TypeError('audit event has unknown fields');
      if (event.format !== SHIELD_AUDIT_V1_FORMAT || event.sequence !== index + 1) throw new Error('audit sequence invalid');
      if (event.previousAuditId !== previousAuditId) throw new Error('audit chain invalid');
      if (!HASH_ID.test(String(event.auditId ?? ''))) throw new Error('audit ID invalid');
      boundedToken(event.type, 'Shield audit type', 64);
      assertRealmId(event.actorId, null, 'Shield audit actor ID');
      assertRealmId(event.subjectId, null, 'Shield audit subject ID');
      boundedInteger(event.occurredAt, 'Shield audit occurredAt');
      cloneBoundedDetails(event.details);
      const expected = await auditIdFor(event);
      if (event.auditId !== expected) throw new Error('audit hash invalid');
      previousAuditId = expected;
    } catch (error) {
      return Object.freeze({ valid: false, reason: error?.message ?? 'audit-event-invalid', index });
    }
  }
  return Object.freeze({ valid: true, count: events.length, head: previousAuditId });
}

/**
 * Realm Shield is deliberately local. It applies signed Gate plans but stores
 * no Realm authority and performs no server-side enforcement.
 */
export class RealmShield {
  constructor({
    quotas = {},
    authorizeGateEvaluator,
    authorizeModerator,
    now = () => Date.now(),
    diagnostic = null,
  } = {}) {
    if (typeof authorizeGateEvaluator !== 'function') throw new TypeError('RealmShield requires authorizeGateEvaluator');
    if (typeof authorizeModerator !== 'function') throw new TypeError('RealmShield requires authorizeModerator');
    this._quotas = normalizeQuotas(quotas);
    this._authorizeGateEvaluator = authorizeGateEvaluator;
    this._authorizeModerator = authorizeModerator;
    this._now = now;
    this._diagnostic = typeof diagnostic === 'function' ? diagnostic : null;
    this._sessions = new Map();
    this._blocks = new Map();
    this._reports = new Map();
    this._audit = [];
  }

  get quotas() { return this._quotas; }
  get auditHead() { return this._audit.at(-1)?.auditId ?? null; }
  auditTrail() { return Object.freeze([...this._audit]); }
  reports() { return Object.freeze([...this._reports.values()]); }
  session(sessionId) {
    const session = this._sessions.get(String(sessionId));
    return session ? snapshotSession(session) : null;
  }

  async openSession({ plan, nonce } = {}) {
    const now = boundedInteger(this._now(), 'Shield current time');
    const verification = await verifyGatePlan(plan, { now, authorizeEvaluator: this._authorizeGateEvaluator });
    if (!verification.valid) return this._result(false, `gate-${verification.reason}`);
    if (verification.plan.outcome === GATE_OUTCOME.DENY) return this._result(false, 'gate-denied');
    const identityId = verification.plan.requesterId;
    if (this._activeBlock(identityId, now)) return this._result(false, 'identity-blocked');
    const activeSessions = [...this._sessions.values()].filter(session => (
      session.identityId === identityId && !session.closed
    )).length;
    if (activeSessions >= this._quotas.maxSessionsPerIdentity) return this._result(false, 'session-quota-exceeded');
    const normalizedNonce = boundedText(nonce, 'Shield session nonce', 256);
    const sessionId = await createRealmId(REALM_ID_TYPE.PUBLICATION, {
      kind: 'realm-shield-session',
      planId: plan.planId,
      identityId,
      nonce: normalizedNonce,
    });
    if (this._sessions.has(sessionId)) return this._result(false, 'session-replay', { sessionId });
    const session = {
      sessionId,
      plan,
      identityId,
      realmId: verification.plan.realmId,
      branchId: verification.plan.branchId,
      capsuleRoot: verification.plan.capsuleRoot,
      baseOutcome: verification.plan.outcome,
      outcome: verification.plan.outcome,
      isolation: normalizeIsolation(verification.plan.outcome),
      usage: emptyUsage(),
      openedAt: now,
      suspended: false,
      suspensionReason: null,
      closed: false,
    };
    this._sessions.set(sessionId, session);
    await this._appendAudit('session-opened', identityId, identityId, {
      sessionId,
      planId: plan.planId,
      outcome: session.outcome,
      realmId: session.realmId,
      branchId: session.branchId,
    });
    return this._result(true, null, { session: snapshotSession(session) });
  }

  authorize(sessionId, action, scope = {}) {
    const session = this._sessions.get(String(sessionId));
    if (!session || session.closed) return this._result(false, 'unknown-session');
    const normalizedAction = boundedToken(action, 'Shield action', 64);
    if (!ACTIONS.has(normalizedAction)) return this._result(false, 'unknown-action');
    if (this._activeBlock(session.identityId, this._now())) return this._result(false, 'identity-blocked');
    if (session.suspended) return this._result(false, session.suspensionReason ?? 'session-suspended');
    if (scope.realmId != null && scope.realmId !== session.realmId) return this._result(false, 'realm-scope-mismatch');
    if (scope.branchId != null && scope.branchId !== session.branchId) return this._result(false, 'branch-scope-mismatch');
    if (!session.isolation.actions.includes(normalizedAction)) return this._result(false, 'isolation-policy-denied');
    return this._result(true, null, { isolation: session.isolation });
  }

  async consume(sessionId, resource, amount) {
    const session = this._sessions.get(String(sessionId));
    if (!session || session.closed) return this._result(false, 'unknown-session');
    const normalizedResource = String(resource);
    if (!RESOURCES.has(normalizedResource)) return this._result(false, 'unknown-resource');
    const quantity = boundedInteger(amount, 'Shield resource amount');
    const next = session.usage[normalizedResource] + quantity;
    if (!Number.isSafeInteger(next) || next > this._quotas[normalizedResource]) {
      session.suspended = true;
      session.suspensionReason = `quota-exceeded:${normalizedResource}`;
      await this._appendAudit('quota-exceeded', session.identityId, session.identityId, {
        sessionId: session.sessionId,
        resource: normalizedResource,
        attempted: quantity,
        used: session.usage[normalizedResource],
        limit: this._quotas[normalizedResource],
      });
      return this._result(false, session.suspensionReason);
    }
    session.usage[normalizedResource] = next;
    this._emit('shield.resource-consumed', {
      sessionId: session.sessionId,
      resource: normalizedResource,
      used: next,
      limit: this._quotas[normalizedResource],
    });
    return this._result(true, null, { used: next, remaining: this._quotas[normalizedResource] - next });
  }

  async closeSession(sessionId, actorId, reason = 'session-closed') {
    const session = this._sessions.get(String(sessionId));
    if (!session || session.closed) return this._result(false, 'unknown-session');
    assertRealmId(actorId, null, 'Shield close actor ID');
    session.closed = true;
    await this._appendAudit('session-closed', actorId, session.identityId, {
      sessionId: session.sessionId,
      reason: boundedText(reason, 'Shield close reason', 512),
    });
    return this._result(true, null, { session: snapshotSession(session) });
  }

  async report({ reporterId, subjectId, category, reason, evidenceIds = [], reportedAt = this._now() } = {}) {
    assertRealmId(reporterId, null, 'Shield reporter ID');
    assertRealmId(subjectId, null, 'Shield report subject ID');
    const normalizedCategory = boundedToken(category, 'Shield report category', 64);
    const normalizedReason = boundedText(reason, 'Shield report reason', 2048);
    const normalizedEvidence = [...new Set(evidenceIds.map(value => boundedText(value, 'Shield evidence ID', 256)))].sort();
    if (normalizedEvidence.length !== evidenceIds.length || normalizedEvidence.length > 64) {
      throw new TypeError('Shield evidence IDs must be unique and bounded');
    }
    const record = {
      format: SHIELD_REPORT_V1_FORMAT,
      reporterId,
      subjectId,
      category: normalizedCategory,
      reason: normalizedReason,
      evidenceIds: Object.freeze(normalizedEvidence),
      reportedAt: boundedInteger(reportedAt, 'Shield reportedAt'),
    };
    const reportId = await hashIdSecure(record, {
      domain: 'realm-network.shield.report',
      schemaVersion: SHIELD_REPORT_V1_FORMAT,
    });
    if (this._reports.has(reportId)) return this._result(false, 'report-replay', { report: this._reports.get(reportId) });
    const report = deepFreeze({ ...record, reportId, status: 'open', moderation: null });
    this._reports.set(reportId, report);
    await this._appendAudit('report-created', reporterId, subjectId, { reportId, category: normalizedCategory });
    return this._result(true, null, { report });
  }

  async blockIdentity({ moderatorId, subjectId, reason, expiresAt = null } = {}) {
    await this._requireModerator(moderatorId, SHIELD_MODERATION_ACTION.BLOCK, subjectId);
    return this._blockIdentity(moderatorId, subjectId, reason, expiresAt);
  }

  async _blockIdentity(moderatorId, subjectId, reason, expiresAt) {
    assertRealmId(subjectId, null, 'Shield block subject ID');
    const now = boundedInteger(this._now(), 'Shield block time');
    const normalizedExpiry = expiresAt == null ? null : boundedInteger(expiresAt, 'Shield block expiresAt', now + 1);
    const block = deepFreeze({
      subjectId,
      moderatorId,
      reason: boundedText(reason, 'Shield block reason', 1024),
      blockedAt: now,
      expiresAt: normalizedExpiry,
    });
    this._blocks.set(subjectId, block);
    for (const session of this._sessions.values()) {
      if (session.identityId === subjectId && !session.closed) {
        session.suspended = true;
        session.suspensionReason = 'identity-blocked';
      }
    }
    await this._appendAudit('identity-blocked', moderatorId, subjectId, {
      reason: block.reason,
      expiresAt: block.expiresAt,
    });
    return this._result(true, null, { block });
  }

  async unblockIdentity({ moderatorId, subjectId, reason } = {}) {
    await this._requireModerator(moderatorId, SHIELD_MODERATION_ACTION.RESTORE, subjectId);
    if (!this._blocks.has(subjectId)) return this._result(false, 'identity-not-blocked');
    this._blocks.delete(subjectId);
    await this._appendAudit('identity-unblocked', moderatorId, subjectId, {
      reason: boundedText(reason, 'Shield unblock reason', 1024),
    });
    return this._result(true, null);
  }

  async moderateReport(reportId, { moderatorId, action, reason, blockExpiresAt = null } = {}) {
    const report = this._reports.get(String(reportId));
    if (!report) return this._result(false, 'unknown-report');
    if (report.status !== 'open') return this._result(false, 'report-already-moderated');
    const normalizedAction = boundedToken(action, 'Shield moderation action', 32);
    if (!MODERATION_ACTIONS.has(normalizedAction)) return this._result(false, 'unknown-moderation-action');
    await this._requireModerator(moderatorId, normalizedAction, report.subjectId);
    const normalizedReason = boundedText(reason, 'Shield moderation reason', 1024);
    if (normalizedAction === SHIELD_MODERATION_ACTION.BLOCK) {
      await this._blockIdentity(moderatorId, report.subjectId, normalizedReason, blockExpiresAt);
    } else if (normalizedAction === SHIELD_MODERATION_ACTION.QUARANTINE) {
      for (const session of this._sessions.values()) {
        if (session.identityId === report.subjectId && !session.closed) {
          session.outcome = GATE_OUTCOME.QUARANTINE;
          session.isolation = normalizeIsolation(GATE_OUTCOME.QUARANTINE);
        }
      }
    } else if (normalizedAction === SHIELD_MODERATION_ACTION.RESTORE) {
      this._blocks.delete(report.subjectId);
      for (const session of this._sessions.values()) {
        if (session.identityId === report.subjectId && !session.closed) this._restoreSessionState(session);
      }
    }
    const moderated = deepFreeze({
      ...report,
      status: normalizedAction === SHIELD_MODERATION_ACTION.DISMISS ? 'dismissed' : 'resolved',
      moderation: {
        moderatorId,
        action: normalizedAction,
        reason: normalizedReason,
        moderatedAt: boundedInteger(this._now(), 'Shield moderatedAt'),
      },
    });
    this._reports.set(report.reportId, moderated);
    await this._appendAudit('report-moderated', moderatorId, report.subjectId, {
      reportId: report.reportId,
      action: normalizedAction,
      reason: normalizedReason,
    });
    return this._result(true, null, { report: moderated });
  }

  async restoreSession({ sessionId, moderatorId, reason, expectedAuditHead = null } = {}) {
    const session = this._sessions.get(String(sessionId));
    if (!session || session.closed) return this._result(false, 'unknown-session');
    await this._requireModerator(moderatorId, SHIELD_MODERATION_ACTION.RESTORE, session.identityId);
    if (expectedAuditHead != null && expectedAuditHead !== this.auditHead) return this._result(false, 'stale-audit-head');
    if (this._activeBlock(session.identityId, this._now())) return this._result(false, 'identity-blocked');
    this._restoreSessionState(session);
    await this._appendAudit('session-restored', moderatorId, session.identityId, {
      sessionId: session.sessionId,
      reason: boundedText(reason, 'Shield restoration reason', 1024),
      outcome: session.outcome,
    });
    return this._result(true, null, { session: snapshotSession(session) });
  }

  snapshot() {
    return deepFreeze({
      format: SHIELD_SNAPSHOT_V1_FORMAT,
      quotas: this._quotas,
      sessions: [...this._sessions.values()].map(snapshotSession),
      blocks: [...this._blocks.values()],
      reports: [...this._reports.values()],
      auditHead: this.auditHead,
      auditCount: this._audit.length,
      capturedAt: boundedInteger(this._now(), 'Shield snapshot time'),
    });
  }

  _restoreSessionState(session) {
    session.outcome = session.baseOutcome;
    session.isolation = normalizeIsolation(session.baseOutcome);
    session.usage = emptyUsage();
    session.suspended = false;
    session.suspensionReason = null;
  }

  _activeBlock(subjectId, now) {
    const block = this._blocks.get(String(subjectId));
    if (!block) return null;
    if (block.expiresAt != null && now >= block.expiresAt) {
      this._blocks.delete(String(subjectId));
      return null;
    }
    return block;
  }

  async _requireModerator(moderatorId, action, subjectId) {
    assertRealmId(moderatorId, null, 'Shield moderator ID');
    if (!(await this._authorizeModerator(moderatorId, action, subjectId))) {
      throw new Error('Shield moderator is unauthorized');
    }
  }

  async _appendAudit(type, actorId, subjectId, details) {
    const body = {
      format: SHIELD_AUDIT_V1_FORMAT,
      sequence: this._audit.length + 1,
      previousAuditId: this.auditHead,
      type: boundedToken(type, 'Shield audit type', 64),
      actorId: assertRealmId(actorId, null, 'Shield audit actor ID'),
      subjectId: assertRealmId(subjectId, null, 'Shield audit subject ID'),
      occurredAt: boundedInteger(this._now(), 'Shield audit occurredAt'),
      details: cloneBoundedDetails(details),
    };
    const event = deepFreeze({ ...body, auditId: await auditIdFor(body) });
    this._audit.push(event);
    this._emit('shield.audit-appended', {
      auditId: event.auditId,
      auditType: event.type,
      sequence: event.sequence,
      subjectId,
    });
    return event;
  }

  _result(allowed, reason, detail = {}) {
    return Object.freeze({ allowed, reason: reason ?? null, ...detail });
  }

  _emit(type, detail) {
    if (!this._diagnostic) return;
    try { this._diagnostic(Object.freeze({ type, at: this._now(), ...detail })); }
    catch (_) { /* Diagnostics cannot alter Shield enforcement. */ }
  }
}
