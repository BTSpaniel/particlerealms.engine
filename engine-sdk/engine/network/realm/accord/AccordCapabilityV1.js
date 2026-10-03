// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Signed, short-lived Accord capability discovery records. */

import { canonicalize } from '../../../state/util/canonical.js';
import { REALM_ID_TYPE, isRealmId } from '../addressing/RealmIds.js';
import {
  authorizeWith,
  boundedToken,
  budgetWithin,
  exactKeys,
  finishSignedAccordRecord,
  normalizeBudget,
  normalizeNonce,
  normalizedBodyMatches,
  normalizeTokenList,
  normalizeWindow,
  validateActiveWindow,
  verifySignedAccordRecord,
} from './AccordCrypto.js';
import { consumeReplay } from './AccordReplayGuard.js';

export const ACCORD_CAPABILITY_ADVERTISEMENT_V1_FORMAT = 'realm-accord-capability-advertisement-v1';

export const ACCORD_CONTEXT_KINDS = Object.freeze([
  'approval-proof',
  'asset-ref',
  'capsule-ref',
  'chronicle-ref',
  'constraint',
  'instruction',
  'public-profile',
  'realm-record',
].sort());

const CONTEXT_KIND_SET = new Set(ACCORD_CONTEXT_KINDS);

function assertExecutorIdentity(value) {
  const allowed = [REALM_ID_TYPE.NAVI, REALM_ID_TYPE.AGENT, REALM_ID_TYPE.USER, REALM_ID_TYPE.DEVICE];
  if (!allowed.some(type => isRealmId(value, type))) throw new TypeError('Accord executor must be a Navi, agent, user, or device Realm ID');
  return value;
}

function normalizeVersion(value, name) {
  const version = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new TypeError(`${name} must be a semantic version`);
  }
  return version;
}

function normalizeCapability(value, index) {
  exactKeys(value, ['actions', 'contextKinds', 'domains', 'maxBudget', 'name', 'requiresApproval', 'version'], `capabilities[${index}]`);
  const contextKinds = normalizeTokenList(value.contextKinds, `capabilities[${index}].contextKinds`, { maximum: CONTEXT_KIND_SET.size });
  for (const kind of contextKinds) {
    if (!CONTEXT_KIND_SET.has(kind)) throw new TypeError(`Unsupported Accord context kind: ${kind}`);
  }
  return Object.freeze({
    name: boundedToken(value.name, `capabilities[${index}].name`, 96),
    version: normalizeVersion(value.version, `capabilities[${index}].version`),
    domains: normalizeTokenList(value.domains, `capabilities[${index}].domains`, { maximum: 32 }),
    actions: normalizeTokenList(value.actions, `capabilities[${index}].actions`, { maximum: 64 }),
    contextKinds,
    maxBudget: normalizeBudget(value.maxBudget, `capabilities[${index}].maxBudget`),
    requiresApproval: value.requiresApproval === true,
  });
}

function normalizeAdvertisement(input, { signed = false } = {}) {
  const expected = ['capabilities', 'executorId', 'expiresAt', 'format', 'issuedAt', 'nonce', 'notBefore'];
  if (signed) expected.push('advertisementId', 'signatureHex', 'signer');
  exactKeys(input, expected, 'Accord capability advertisement');
  if (input.format !== ACCORD_CAPABILITY_ADVERTISEMENT_V1_FORMAT) throw new TypeError('Accord capability advertisement format is invalid');
  if (!Array.isArray(input.capabilities) || input.capabilities.length === 0 || input.capabilities.length > 64) {
    throw new TypeError('Accord capability advertisement must contain 1 to 64 capabilities');
  }
  const capabilities = input.capabilities.map(normalizeCapability).sort((a, b) => {
    const left = `${a.name}\u0000${a.version}`;
    const right = `${b.name}\u0000${b.version}`;
    return left.localeCompare(right);
  });
  const keys = capabilities.map(capability => `${capability.name}@${capability.version}`);
  if (new Set(keys).size !== keys.length) throw new TypeError('Accord capability names and versions must be unique');
  return Object.freeze({
    format: ACCORD_CAPABILITY_ADVERTISEMENT_V1_FORMAT,
    executorId: assertExecutorIdentity(input.executorId),
    capabilities: Object.freeze(capabilities),
    ...normalizeWindow(input),
    nonce: normalizeNonce(input.nonce),
  });
}

export async function createAccordCapabilityAdvertisement(input, signer) {
  const allowed = ['capabilities', 'executorId', 'expiresAt', 'issuedAt', 'nonce', 'notBefore'];
  const unknown = Object.keys(input ?? {}).filter(key => !allowed.includes(key));
  if (unknown.length) throw new TypeError(`Accord capability advertisement input contains unsupported fields: ${unknown.sort().join(', ')}`);
  const window = normalizeWindow(input);
  const normalized = normalizeAdvertisement({
    format: ACCORD_CAPABILITY_ADVERTISEMENT_V1_FORMAT,
    executorId: input.executorId,
    capabilities: input.capabilities,
    ...window,
    nonce: input.nonce,
  });
  return finishSignedAccordRecord(normalized, 'advertisementId', signer);
}

export async function verifyAccordCapabilityAdvertisement(record, {
  now = Date.now(),
  expectedExecutorId = null,
  authorizeExecutor = null,
  replayGuard = null,
  allowExpired = false,
} = {}) {
  const signed = await verifySignedAccordRecord(record, {
    format: ACCORD_CAPABILITY_ADVERTISEMENT_V1_FORMAT,
    idField: 'advertisementId',
  });
  if (!signed.valid) return signed;
  try {
    const normalized = normalizeAdvertisement(record, { signed: true });
    if (!normalizedBodyMatches(record, normalized)) return Object.freeze({ valid: false, reason: 'non-canonical-record' });
    if (expectedExecutorId !== null && normalized.executorId !== expectedExecutorId) {
      return Object.freeze({ valid: false, reason: 'executor-mismatch' });
    }
    const active = validateActiveWindow(normalized, now, { allowExpired });
    if (!active.valid) return active;
    const authorized = await authorizeWith(authorizeExecutor, record, 'executor');
    if (!authorized.valid) return authorized;
    const replay = consumeReplay(replayGuard, record, { idField: 'advertisementId' });
    if (!replay.valid) return replay;
    return Object.freeze({ ...signed, advertisement: normalized });
  } catch (error) {
    return Object.freeze({ valid: false, reason: error?.message ?? 'capability-advertisement-invalid' });
  }
}

/** Select a verified capability that can satisfy an exact bounded request. */
export async function negotiateAccordCapability(advertisements, request, options = {}) {
  if (!Array.isArray(advertisements) || advertisements.length === 0 || advertisements.length > 256) {
    throw new TypeError('Capability negotiation requires 1 to 256 advertisements');
  }
  exactKeys(request, ['actions', 'budget', 'contextKinds', 'domain', 'name', 'version'], 'Accord capability request');
  const wanted = Object.freeze({
    name: boundedToken(request.name, 'capability request name', 96),
    version: normalizeVersion(request.version, 'capability request version'),
    domain: boundedToken(request.domain, 'capability request domain', 96),
    actions: normalizeTokenList(request.actions, 'capability request actions', { maximum: 64 }),
    contextKinds: normalizeTokenList(request.contextKinds, 'capability request contextKinds', { maximum: CONTEXT_KIND_SET.size }),
    budget: normalizeBudget(request.budget, 'capability request budget'),
  });
  const matches = [];
  for (const advertisement of advertisements) {
    const verified = await verifyAccordCapabilityAdvertisement(advertisement, { ...options, replayGuard: null });
    if (!verified.valid) continue;
    for (const capability of verified.advertisement.capabilities) {
      if (capability.name !== wanted.name || capability.version !== wanted.version) continue;
      if (!capability.domains.includes(wanted.domain)) continue;
      if (wanted.actions.some(action => !capability.actions.includes(action))) continue;
      if (wanted.contextKinds.some(kind => !capability.contextKinds.includes(kind))) continue;
      if (!budgetWithin(wanted.budget, capability.maxBudget)) continue;
      matches.push(Object.freeze({ advertisement, capability }));
    }
  }
  matches.sort((a, b) => canonicalize(a.advertisement.advertisementId).localeCompare(canonicalize(b.advertisement.advertisementId)));
  return matches[0] ?? null;
}

export const AccordCapabilityAdvertisementV1 = Object.freeze({
  format: ACCORD_CAPABILITY_ADVERTISEMENT_V1_FORMAT,
  create: createAccordCapabilityAdvertisement,
  verify: verifyAccordCapabilityAdvertisement,
  negotiate: negotiateAccordCapability,
  contextKinds: ACCORD_CONTEXT_KINDS,
});
