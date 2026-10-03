// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Fail-closed Realm entry planning over verified identity, content, and policy evidence. */

import {
  REALM_ID_TYPE,
  assertRealmId,
} from '../addressing/RealmIds.js';
import { verifyRealmCapsule } from '../capsule/RealmCapsule.js';
import { verifyRealmPassport } from '../identity/RealmPassport.js';
import {
  boundedInteger,
  boundedText,
  boundedToken,
  finishSignedRecord,
  verifySignedRecord,
} from '../governance/GovernanceCrypto.js';

export const GATE_PLAN_V1_FORMAT = 'realm-gate-plan-v1';

export const GATE_OUTCOME = Object.freeze({
  DENY: 'deny',
  QUARANTINE: 'quarantine',
  SAFE: 'safe',
  READ_ONLY: 'read-only',
  FULL: 'full',
});

export const GATE_ACTION = Object.freeze({
  INSPECT: 'inspect',
  ENTER: 'enter',
  PUBLISH: 'publish',
});

export const GATE_CHECK = Object.freeze({
  IDENTITY: 'identity',
  CAPSULE: 'capsule',
  DEPENDENCIES: 'dependencies',
  RIGHTS: 'rights',
  COMPATIBILITY: 'compatibility',
  PERMISSIONS: 'permissions',
  RESOURCES: 'resources',
});

const CHECK_ORDER = Object.freeze(Object.values(GATE_CHECK));
const CHECK_NAMES = new Set(CHECK_ORDER);
const ACTIONS = new Set(Object.values(GATE_ACTION));
const OUTCOMES = new Set(Object.values(GATE_OUTCOME));
const OUTCOME_RANK = Object.freeze({
  [GATE_OUTCOME.DENY]: 0,
  [GATE_OUTCOME.QUARANTINE]: 1,
  [GATE_OUTCOME.SAFE]: 2,
  [GATE_OUTCOME.READ_ONLY]: 3,
  [GATE_OUTCOME.FULL]: 4,
});
const CONTENT_ID = /^sha256:[0-9a-f]{64}$/;
const PLAN_FIELDS = new Set([
  'format', 'schemaVersion', 'realmId', 'branchId', 'requesterId', 'capsuleRoot',
  'action', 'evaluatedAt', 'expiresAt', 'checks', 'outcome', 'restrictions',
  'signer', 'planId', 'signatureHex',
]);
const RESOURCE_NAMES = Object.freeze(['memoryBytes', 'storageBytes', 'networkBytes']);

const BASE_RESTRICTIONS = Object.freeze({
  [GATE_OUTCOME.DENY]: Object.freeze(['no-entry']),
  [GATE_OUTCOME.QUARANTINE]: Object.freeze([
    'ephemeral-storage', 'isolated-origin', 'no-mutation', 'no-network', 'no-publish', 'no-scripts',
  ]),
  [GATE_OUTCOME.SAFE]: Object.freeze([
    'ephemeral-storage', 'isolated-origin', 'no-mutation', 'no-publish', 'no-scripts', 'scoped-network',
  ]),
  [GATE_OUTCOME.READ_ONLY]: Object.freeze(['no-mutation', 'no-publish', 'scoped-network']),
  [GATE_OUTCOME.FULL]: Object.freeze(['scoped-network']),
});

function contentId(value, name) {
  const normalized = String(value ?? '').toLowerCase();
  if (!CONTENT_ID.test(normalized)) throw new TypeError(`${name} must be a SHA-256 content ID`);
  return normalized;
}

function assertKnownFields(value, allowed, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${name} contains unknown field ${key}`);
  }
}

function normalizeRestriction(value) {
  return boundedToken(value, 'Gate restriction', 64);
}

function normalizeCheck(value) {
  assertKnownFields(value, new Set(['name', 'outcome', 'reason', 'restrictions']), 'Gate check');
  const name = boundedToken(value.name, 'Gate check name', 32);
  if (!CHECK_NAMES.has(name)) throw new TypeError(`Unknown Gate check: ${name}`);
  const outcome = boundedToken(value.outcome, 'Gate check outcome', 32);
  if (!OUTCOMES.has(outcome)) throw new TypeError(`Unknown Gate outcome: ${outcome}`);
  const restrictions = Array.isArray(value.restrictions)
    ? [...new Set(value.restrictions.map(normalizeRestriction))].sort()
    : [];
  if (restrictions.length > 32) throw new TypeError('Gate check has too many restrictions');
  return Object.freeze({
    name,
    outcome,
    reason: boundedText(value.reason, 'Gate check reason', 512),
    restrictions: Object.freeze(restrictions),
  });
}

function normalizeChecks(values) {
  if (!Array.isArray(values) || values.length !== CHECK_ORDER.length) {
    throw new TypeError(`Gate plan requires exactly ${CHECK_ORDER.length} checks`);
  }
  const byName = new Map(values.map((value) => {
    const check = normalizeCheck(value);
    return [check.name, check];
  }));
  if (byName.size !== CHECK_ORDER.length || CHECK_ORDER.some(name => !byName.has(name))) {
    throw new TypeError('Gate plan checks must contain each required check exactly once');
  }
  return Object.freeze(CHECK_ORDER.map(name => byName.get(name)));
}

export function deriveGateOutcome(checks) {
  const normalized = normalizeChecks(checks);
  return normalized.reduce((outcome, check) => (
    OUTCOME_RANK[check.outcome] < OUTCOME_RANK[outcome] ? check.outcome : outcome
  ), GATE_OUTCOME.FULL);
}

function derivedRestrictions(outcome, checks) {
  return Object.freeze([...new Set([
    ...BASE_RESTRICTIONS[outcome],
    ...checks.flatMap(check => check.restrictions),
  ])].sort());
}

function normalizeGatePlanBody(input) {
  if (input.format !== GATE_PLAN_V1_FORMAT || input.schemaVersion !== 1) {
    throw new TypeError('Gate plan format or schema version is invalid');
  }
  const checks = normalizeChecks(input.checks);
  const outcome = boundedToken(input.outcome, 'Gate plan outcome', 32);
  if (!OUTCOMES.has(outcome)) throw new TypeError(`Unknown Gate outcome: ${outcome}`);
  const expectedOutcome = deriveGateOutcome(checks);
  if (outcome !== expectedOutcome) throw new Error('Gate plan outcome does not match its checks');
  const restrictions = Array.isArray(input.restrictions)
    ? [...new Set(input.restrictions.map(normalizeRestriction))].sort()
    : [];
  const expectedRestrictions = derivedRestrictions(outcome, checks);
  if (restrictions.join('\n') !== expectedRestrictions.join('\n')) {
    throw new Error('Gate plan restrictions do not match its checks and outcome');
  }
  const evaluatedAt = boundedInteger(input.evaluatedAt, 'Gate evaluatedAt');
  const expiresAt = boundedInteger(input.expiresAt, 'Gate expiresAt', evaluatedAt + 1);
  if (expiresAt - evaluatedAt > 5 * 60_000) throw new RangeError('Gate plan lifetime exceeds five minutes');
  const action = boundedToken(input.action, 'Gate action', 32);
  if (!ACTIONS.has(action)) throw new TypeError(`Unsupported Gate action: ${action}`);
  return Object.freeze({
    format: GATE_PLAN_V1_FORMAT,
    schemaVersion: 1,
    realmId: assertRealmId(input.realmId, REALM_ID_TYPE.REALM, 'Gate Realm ID'),
    branchId: assertRealmId(input.branchId, REALM_ID_TYPE.BRANCH, 'Gate branch ID'),
    requesterId: assertRealmId(input.requesterId, null, 'Gate requester ID'),
    capsuleRoot: contentId(input.capsuleRoot, 'Gate Capsule root'),
    action,
    evaluatedAt,
    expiresAt,
    checks,
    outcome,
    restrictions: expectedRestrictions,
  });
}

export async function createGatePlan(input, signer) {
  return finishSignedRecord(normalizeGatePlanBody(input), 'planId', signer);
}

export async function verifyGatePlan(record, options = {}) {
  try {
    assertKnownFields(record, PLAN_FIELDS, 'Gate plan');
    const signed = await verifySignedRecord(record, {
      format: GATE_PLAN_V1_FORMAT,
      idField: 'planId',
    });
    if (!signed.valid) return signed;
    const plan = normalizeGatePlanBody(record);
    const now = boundedInteger(options.now ?? Date.now(), 'Gate verification time');
    if (now < plan.evaluatedAt) return Object.freeze({ valid: false, reason: 'gate-plan-not-yet-valid' });
    if (now >= plan.expiresAt) return Object.freeze({ valid: false, reason: 'gate-plan-expired' });
    for (const [field, expected] of [
      ['realmId', options.expectedRealmId],
      ['branchId', options.expectedBranchId],
      ['requesterId', options.expectedRequesterId],
      ['capsuleRoot', options.expectedCapsuleRoot],
    ]) {
      if (expected != null && plan[field] !== expected) {
        return Object.freeze({ valid: false, reason: `gate-plan-${field}-mismatch` });
      }
    }
    if (typeof options.authorizeEvaluator === 'function'
      && !(await options.authorizeEvaluator(record.signer.fingerprint, plan, record))) {
      return Object.freeze({ valid: false, reason: 'gate-evaluator-unauthorized' });
    }
    return Object.freeze({ ...signed, valid: true, plan });
  } catch (error) {
    return Object.freeze({ valid: false, reason: error?.message ?? 'gate-plan-invalid' });
  }
}

function check(name, outcome, reason, restrictions = []) {
  return Object.freeze({ name, outcome, reason, restrictions: Object.freeze([...restrictions]) });
}

function compareVersion(left, right) {
  const tokenize = value => String(value).toLowerCase().split(/[.+_-]/).filter(Boolean);
  const a = tokenize(left);
  const b = tokenize(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const av = a[index] ?? '0';
    const bv = b[index] ?? '0';
    if (av === bv) continue;
    const an = /^\d+$/.test(av) ? Number(av) : null;
    const bn = /^\d+$/.test(bv) ? Number(bv) : null;
    if (an !== null && bn !== null) return an < bn ? -1 : 1;
    return av < bv ? -1 : 1;
  }
  return 0;
}

function normalizeResourceSet(value = {}, label = 'Gate resources') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return Object.freeze(Object.fromEntries(RESOURCE_NAMES.map(name => [
    name,
    boundedInteger(value[name] ?? 0, `${label} ${name}`),
  ])));
}

function resourceShortfall(required, available) {
  return RESOURCE_NAMES.filter(name => available[name] < required[name]);
}

function normalizeDependencyResult(value) {
  if (value == null) return Object.freeze({ available: false, verified: false });
  return Object.freeze({
    available: value.available === true,
    verified: value.verified === true,
    capsuleRoot: value.capsuleRoot ?? value.capsule?.capsuleRoot ?? null,
    capsule: value.capsule ?? null,
  });
}

/**
 * Runtime Gate evaluator. It owns no persistence and performs no entry itself;
 * it only emits a short-lived signed plan that Shield can enforce.
 */
export class RealmGate {
  constructor({
    verifyIdentity = null,
    resolveDependency = null,
    authorize = null,
    resources = null,
    networkVersion = '3',
    realmSchema = '1.0.0',
    features = [],
    migrations = [],
    now = () => Date.now(),
    planLifetimeMs = 60_000,
    diagnostic = null,
  } = {}) {
    if (!Number.isSafeInteger(planLifetimeMs) || planLifetimeMs < 1 || planLifetimeMs > 5 * 60_000) {
      throw new RangeError('Gate plan lifetime must be between one millisecond and five minutes');
    }
    this._verifyIdentity = verifyIdentity;
    this._resolveDependency = resolveDependency;
    this._authorize = authorize;
    this._resources = resources;
    this._networkVersion = String(networkVersion);
    this._realmSchema = String(realmSchema);
    this._features = new Set(features.map(value => boundedToken(value, 'Gate feature', 256)));
    this._migrations = new Set(migrations.map(value => boundedToken(value, 'Gate migration', 256)));
    this._now = now;
    this._planLifetimeMs = planLifetimeMs;
    this._diagnostic = typeof diagnostic === 'function' ? diagnostic : null;
  }

  async evaluate(request, signer) {
    const startedAt = globalThis.performance?.now?.() ?? Date.now();
    const evaluatedAt = boundedInteger(request?.evaluatedAt ?? this._now(), 'Gate evaluatedAt');
    const realmId = assertRealmId(request?.realmId, REALM_ID_TYPE.REALM, 'Gate Realm ID');
    const branchId = assertRealmId(request?.branchId, REALM_ID_TYPE.BRANCH, 'Gate branch ID');
    const requesterId = assertRealmId(request?.requesterId, null, 'Gate requester ID');
    const expectedRoot = contentId(request?.capsuleRoot, 'Gate Capsule root');
    const action = boundedToken(request?.action ?? GATE_ACTION.ENTER, 'Gate action', 32);
    if (!ACTIONS.has(action)) throw new TypeError(`Unsupported Gate action: ${action}`);

    const checks = [];
    checks.push(await this._identityCheck(request, requesterId));
    checks.push(await this._capsuleCheck(request, realmId, branchId, expectedRoot));
    checks.push(await this._dependencyCheck(request));
    checks.push(this._rightsCheck(request, action));
    checks.push(this._compatibilityCheck(request));
    checks.push(await this._permissionCheck(request, action));
    checks.push(await this._resourceCheck(request));
    const outcome = deriveGateOutcome(checks);
    const plan = await createGatePlan({
      format: GATE_PLAN_V1_FORMAT,
      schemaVersion: 1,
      realmId,
      branchId,
      requesterId,
      capsuleRoot: expectedRoot,
      action,
      evaluatedAt,
      expiresAt: evaluatedAt + this._planLifetimeMs,
      checks,
      outcome,
      restrictions: derivedRestrictions(outcome, checks),
    }, signer);
    this._emit('gate.evaluated', {
      planId: plan.planId,
      realmId,
      branchId,
      requesterId,
      outcome,
      elapsedMs: (globalThis.performance?.now?.() ?? Date.now()) - startedAt,
    });
    return plan;
  }

  async _identityCheck(request, requesterId) {
    try {
      const result = typeof this._verifyIdentity === 'function'
        ? await this._verifyIdentity(request.identity, request)
        : await verifyRealmPassport(request.identity);
      if (!result?.valid || request.identity?.passportId !== requesterId) {
        return check(GATE_CHECK.IDENTITY, GATE_OUTCOME.DENY, result?.reason ?? 'identity-does-not-match-requester');
      }
      if (result.trusted === false) {
        return check(GATE_CHECK.IDENTITY, GATE_OUTCOME.QUARANTINE, 'identity-valid-but-not-trusted', ['identity-review-required']);
      }
      return check(GATE_CHECK.IDENTITY, GATE_OUTCOME.FULL, 'identity-verified');
    } catch (error) {
      return check(GATE_CHECK.IDENTITY, GATE_OUTCOME.DENY, `identity-verification-failed:${error?.message ?? 'unknown'}`);
    }
  }

  async _capsuleCheck(request, realmId, branchId, expectedRoot) {
    try {
      const result = await verifyRealmCapsule(request.capsule, { expectedRoot });
      if (!result.ok) return check(GATE_CHECK.CAPSULE, GATE_OUTCOME.DENY, `capsule-${result.reason}`);
      if (request.capsule.realmId !== realmId || request.capsule.branchId !== branchId) {
        return check(GATE_CHECK.CAPSULE, GATE_OUTCOME.DENY, 'capsule-scope-mismatch');
      }
      return check(GATE_CHECK.CAPSULE, GATE_OUTCOME.FULL, 'capsule-and-content-root-verified');
    } catch (error) {
      return check(GATE_CHECK.CAPSULE, GATE_OUTCOME.DENY, `capsule-verification-failed:${error?.message ?? 'unknown'}`);
    }
  }

  async _dependencyCheck(request) {
    const dependencies = Array.isArray(request.capsule?.dependencies) ? request.capsule.dependencies : [];
    if (dependencies.length === 0) return check(GATE_CHECK.DEPENDENCIES, GATE_OUTCOME.FULL, 'no-external-dependencies');
    if (typeof this._resolveDependency !== 'function') {
      return check(GATE_CHECK.DEPENDENCIES, GATE_OUTCOME.DENY, 'dependency-verifier-unavailable');
    }
    const evidence = new Map();
    for (const dependency of dependencies) {
      try {
        const resolved = normalizeDependencyResult(await this._resolveDependency(dependency, request));
        let verified = resolved.available && resolved.verified;
        if (resolved.capsule) {
          const result = await verifyRealmCapsule(resolved.capsule, {
            expectedRoot: dependency.capsuleRoot ?? resolved.capsuleRoot ?? undefined,
          });
          verified = verified && result.ok;
        }
        if (dependency.capsuleRoot && resolved.capsuleRoot !== dependency.capsuleRoot
          && resolved.capsule?.capsuleRoot !== dependency.capsuleRoot) verified = false;
        evidence.set(dependency.dependencyId, { available: resolved.available, verified });
      } catch (_) {
        evidence.set(dependency.dependencyId, { available: false, verified: false });
      }
    }
    const valid = dependency => evidence.get(dependency.dependencyId)?.available
      && evidence.get(dependency.dependencyId)?.verified;
    const fallbacks = new Map();
    for (const dependency of dependencies.filter(item => item.class === 'fallback' && valid(item))) {
      fallbacks.set(dependency.fallbackFor, dependency);
    }
    const minimum = new Set(request.capsule.minimumEntry?.dependencyIds ?? []);
    const hardMissing = dependencies.filter(dependency => (
      (dependency.class === 'required' || minimum.has(dependency.dependencyId))
      && !valid(dependency)
      && !fallbacks.has(dependency.dependencyId)
    ));
    if (hardMissing.length > 0) {
      return check(GATE_CHECK.DEPENDENCIES, GATE_OUTCOME.DENY,
        `required-dependency-unavailable:${hardMissing.map(item => item.dependencyId).sort().join(',')}`);
    }
    const degraded = dependencies.filter(dependency => (
      dependency.class !== 'fallback' && !valid(dependency)
    ));
    if (degraded.length > 0) {
      return check(GATE_CHECK.DEPENDENCIES, GATE_OUTCOME.SAFE,
        `dependency-fallback-or-degraded:${degraded.map(item => item.dependencyId).sort().join(',')}`,
        ['degraded-dependencies']);
    }
    return check(GATE_CHECK.DEPENDENCIES, GATE_OUTCOME.FULL, 'all-dependencies-verified');
  }

  _rightsCheck(request, action) {
    const rights = request.capsule?.rights;
    if (!rights) return check(GATE_CHECK.RIGHTS, GATE_OUTCOME.DENY, 'rights-record-missing');
    if (rights.entry === 'deny') return check(GATE_CHECK.RIGHTS, GATE_OUTCOME.DENY, 'entry-rights-denied');
    if (rights.entry === 'prompt' && request.approvals?.entry !== true) {
      return check(GATE_CHECK.RIGHTS, GATE_OUTCOME.QUARANTINE, 'entry-approval-required', ['entry-approval-required']);
    }
    if (action === GATE_ACTION.PUBLISH && rights.replication !== 'allow') {
      return check(GATE_CHECK.RIGHTS, GATE_OUTCOME.DENY, 'replication-rights-not-granted');
    }
    if (rights.modification === 'deny'
      || (rights.modification === 'prompt' && request.approvals?.modification !== true)) {
      return check(GATE_CHECK.RIGHTS, GATE_OUTCOME.READ_ONLY, 'modification-rights-not-granted', ['rights-read-only']);
    }
    return check(GATE_CHECK.RIGHTS, GATE_OUTCOME.FULL, 'entry-and-modification-rights-satisfied');
  }

  _compatibilityCheck(request) {
    const compatibility = request.capsule?.compatibility;
    if (!compatibility) return check(GATE_CHECK.COMPATIBILITY, GATE_OUTCOME.DENY, 'compatibility-record-missing');
    if (compareVersion(this._networkVersion, compatibility.minimumNetworkVersion) < 0
      || (compatibility.maximumNetworkVersion
        && compareVersion(this._networkVersion, compatibility.maximumNetworkVersion) > 0)) {
      return check(GATE_CHECK.COMPATIBILITY, GATE_OUTCOME.DENY, 'network-version-incompatible');
    }
    if (compareVersion(this._realmSchema, compatibility.realmSchema) < 0) {
      return check(GATE_CHECK.COMPATIBILITY, GATE_OUTCOME.DENY, 'realm-schema-incompatible');
    }
    const missingFeatures = compatibility.requiredFeatures.filter(feature => !this._features.has(feature));
    if (missingFeatures.length > 0) {
      return check(GATE_CHECK.COMPATIBILITY, GATE_OUTCOME.DENY, `features-unavailable:${missingFeatures.join(',')}`);
    }
    const missingMigrations = compatibility.migrationIds.filter(migration => !this._migrations.has(migration));
    if (missingMigrations.length > 0) {
      return check(GATE_CHECK.COMPATIBILITY, GATE_OUTCOME.DENY, `migrations-unavailable:${missingMigrations.join(',')}`);
    }
    return check(GATE_CHECK.COMPATIBILITY, GATE_OUTCOME.FULL, 'runtime-compatible');
  }

  async _permissionCheck(request, action) {
    if (typeof this._authorize !== 'function') {
      return check(GATE_CHECK.PERMISSIONS, GATE_OUTCOME.DENY, 'permission-authority-unavailable');
    }
    try {
      const permission = await this._authorize(request);
      if (!permission?.view) return check(GATE_CHECK.PERMISSIONS, GATE_OUTCOME.DENY, 'view-permission-denied');
      if (action === GATE_ACTION.PUBLISH && !permission.publish) {
        return check(GATE_CHECK.PERMISSIONS, GATE_OUTCOME.DENY, 'publish-permission-denied');
      }
      if (!permission.edit) {
        return check(GATE_CHECK.PERMISSIONS, GATE_OUTCOME.READ_ONLY, 'edit-permission-not-granted', ['permission-read-only']);
      }
      if (!permission.script) {
        return check(GATE_CHECK.PERMISSIONS, GATE_OUTCOME.SAFE, 'script-permission-not-granted', ['scripts-not-authorized']);
      }
      return check(GATE_CHECK.PERMISSIONS, GATE_OUTCOME.FULL, 'requested-capabilities-authorized');
    } catch (error) {
      return check(GATE_CHECK.PERMISSIONS, GATE_OUTCOME.DENY, `permission-check-failed:${error?.message ?? 'unknown'}`);
    }
  }

  async _resourceCheck(request) {
    try {
      const minimum = normalizeResourceSet(request.resources?.minimum, 'Gate minimum resources');
      const recommended = normalizeResourceSet(request.resources?.recommended ?? minimum, 'Gate recommended resources');
      if (RESOURCE_NAMES.some(name => recommended[name] < minimum[name])) {
        return check(GATE_CHECK.RESOURCES, GATE_OUTCOME.DENY, 'recommended-resources-below-minimum');
      }
      const available = normalizeResourceSet(
        typeof this._resources === 'function' ? await this._resources(request) : {},
        'Gate available resources',
      );
      const hard = resourceShortfall(minimum, available);
      if (hard.length > 0) {
        return check(GATE_CHECK.RESOURCES, GATE_OUTCOME.DENY, `minimum-resources-unavailable:${hard.join(',')}`);
      }
      const soft = resourceShortfall(recommended, available);
      if (soft.length > 0) {
        return check(GATE_CHECK.RESOURCES, GATE_OUTCOME.SAFE, `recommended-resources-unavailable:${soft.join(',')}`,
          ['resource-constrained']);
      }
      return check(GATE_CHECK.RESOURCES, GATE_OUTCOME.FULL, 'resource-budget-satisfied');
    } catch (error) {
      return check(GATE_CHECK.RESOURCES, GATE_OUTCOME.DENY, `resource-check-failed:${error?.message ?? 'unknown'}`);
    }
  }

  _emit(type, detail) {
    if (!this._diagnostic) return;
    try { this._diagnostic(Object.freeze({ type, at: this._now(), ...detail })); }
    catch (_) { /* Diagnostics cannot change Gate decisions. */ }
  }
}

export const GatePlanV1 = Object.freeze({
  format: GATE_PLAN_V1_FORMAT,
  schemaVersion: 1,
  outcomes: GATE_OUTCOME,
  actions: GATE_ACTION,
  create: createGatePlan,
  verify: verifyGatePlan,
  deriveOutcome: deriveGateOutcome,
});
