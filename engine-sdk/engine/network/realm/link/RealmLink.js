// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { canonicalize } from '../../../state/util/canonical.js';
import { assertRealmTransportSession, isPreferredTransport } from './TransportProvider.js';
import {
  REALM_LINK_FRAME,
  signRealmLinkFrame,
  verifyRealmLinkFrame,
  createRealmLinkReplayWindow,
  acceptRealmLinkReplay,
  snapshotRealmLinkReplayWindow,
} from './RealmLinkProtocol.js';
import {
  createContinuityRecord,
  saveContinuity,
  validateContinuityRecord,
} from './ContinuityStore.js';

export const REALM_LINK_STATE = Object.freeze({
  IDLE: 'idle',
  HANDSHAKING: 'handshaking',
  CONNECTED: 'connected',
  MIGRATING: 'migrating',
  RECONNECTING: 'reconnecting',
  DEGRADED: 'degraded',
  CLOSED: 'closed',
});

const MAX_CAPABILITIES = 128;

function boundedString(value, name, max = 1024) {
  const result = String(value ?? '').trim();
  if (!result || result.length > max) throw new TypeError(`${name} must be a non-empty bounded string`);
  return result;
}

function normalizeCapabilities(values) {
  if (!Array.isArray(values)) throw new TypeError('capabilities must be an array');
  if (values.length > MAX_CAPABILITIES) throw new RangeError('too many Realm Link capabilities');
  const result = [];
  for (const value of values) {
    const capability = boundedString(value, 'capability', 256);
    if (!result.includes(capability)) result.push(capability);
  }
  return result.sort();
}

function defaultIdFactory() {
  if (typeof globalThis.crypto?.randomUUID !== 'function') throw new Error('Realm Link requires crypto.randomUUID or an injected idFactory');
  return globalThis.crypto.randomUUID();
}

function emit(link, event, details = {}, level = 'debug') {
  link.logger({
    component: 'realm-link',
    event,
    level,
    at: link.now(),
    correlationId: details.correlationId ?? link.correlationId,
    linkId: link.linkId,
    realmId: link.realmId,
    branchId: link.branchId,
    state: link.state,
    ...details,
  });
}

function transition(link, state, reason) {
  if (link.state === REALM_LINK_STATE.CLOSED && state !== REALM_LINK_STATE.CLOSED) throw new Error('closed Realm Link cannot transition');
  const previous = link.state;
  link.state = state;
  emit(link, 'state.changed', { previous, next: state, reason }, state === REALM_LINK_STATE.DEGRADED ? 'warn' : 'debug');
  link.onStateChange({ previous, state, reason, at: link.now() });
}

function localIdentityPayload(link) {
  return Object.freeze({
    peerId: link.localIdentity.peerId,
    passportId: link.localIdentity.passportId,
    deviceId: link.localIdentity.deviceId,
  });
}

function validateHandshakePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('invalid handshake payload');
  const identity = payload.identity;
  if (!identity || typeof identity !== 'object') throw new TypeError('handshake identity is missing');
  return {
    identity: Object.freeze({
      peerId: boundedString(identity.peerId, 'remote peerId'),
      passportId: boundedString(identity.passportId, 'remote passportId'),
      deviceId: boundedString(identity.deviceId, 'remote deviceId'),
    }),
    capabilities: normalizeCapabilities(payload.capabilities ?? []),
    handshakeNonce: boundedString(payload.handshakeNonce, 'handshakeNonce', 256),
    helloMessageId: payload.helloMessageId == null ? null : boundedString(payload.helloMessageId, 'helloMessageId'),
  };
}

async function authorizeRemoteIdentity(link, frame, handshake) {
  if (handshake.identity.peerId !== frame.senderPeerId) return { ok: false, reason: 'peer-id-mismatch' };
  let result;
  try {
    result = await link.verifyIdentity({
      linkId: link.linkId,
      realmId: link.realmId,
      branchId: link.branchId,
      peerId: handshake.identity.peerId,
      passportId: handshake.identity.passportId,
      deviceId: handshake.identity.deviceId,
      signerFingerprint: frame.signerFingerprint,
      signerPublicKeyHex: frame.signerPublicKeyHex,
      frame,
    });
  } catch (error) {
    return { ok: false, reason: error?.message ?? 'identity-hook-failed' };
  }
  if (result === true) return { ok: true, identity: handshake.identity };
  if (!result || result.ok !== true) return { ok: false, reason: result?.reason ?? 'identity-not-authorized' };
  return { ok: true, identity: Object.freeze({ ...handshake.identity, ...(result.identity ?? {}) }) };
}

async function capabilitiesForRemote(link, identity, requested) {
  const supported = [...link.supportedCapabilities];
  const defaultAllowed = requested.filter((value) => link.supportedCapabilities.has(value));
  const result = await link.authorizeCapabilities({ identity, requested: [...requested], supported });
  return normalizeCapabilities(result == null ? defaultAllowed : result)
    .filter((value) => link.supportedCapabilities.has(value) && requested.includes(value));
}

/**
 * Create one transport-independent logical link. `verifyIdentity` is required
 * so cryptographic key ownership is also checked against Passport/device
 * authorization rather than trusted from an embedded public key.
 */
export function createRealmLink({
  linkId,
  realmId,
  branchId,
  localIdentity,
  signer,
  verifyIdentity,
  supportedCapabilities = [],
  authorizeCapabilities = async ({ requested, supported }) => requested.filter((value) => supported.includes(value)),
  onData = async () => {},
  onStateChange = () => {},
  continuityStore = null,
  continuityRecord = null,
  now = () => Date.now(),
  idFactory = defaultIdFactory,
  logger = () => {},
  correlationId = null,
} = {}) {
  if (!localIdentity || typeof localIdentity !== 'object') throw new TypeError('Realm Link requires localIdentity');
  const peerId = boundedString(localIdentity.peerId, 'local peerId');
  if (!signer || typeof signer.sign !== 'function' || signer.fingerprint !== peerId) {
    throw new TypeError('Realm Link signer must be bound to localIdentity.peerId');
  }
  if (signer.secure === false) throw new Error('Realm Link refuses an insecure fallback signer');
  if (typeof verifyIdentity !== 'function') throw new TypeError('Realm Link requires a Passport/device verifyIdentity hook');
  if (typeof authorizeCapabilities !== 'function' || typeof onData !== 'function'
    || typeof onStateChange !== 'function' || typeof now !== 'function'
    || typeof idFactory !== 'function' || typeof logger !== 'function') {
    throw new TypeError('invalid Realm Link hooks');
  }
  const restored = continuityRecord == null ? null : validateContinuityRecord(continuityRecord);
  const resolvedLinkId = boundedString(linkId, 'linkId');
  const resolvedRealmId = boundedString(realmId, 'realmId');
  const resolvedBranchId = boundedString(branchId, 'branchId');
  if (restored && (restored.linkId !== resolvedLinkId || restored.realmId !== resolvedRealmId
    || restored.branchId !== resolvedBranchId || restored.localPeerId !== peerId)) {
    throw new Error('continuity record does not match this Realm Link');
  }
  const replay = createRealmLinkReplayWindow({
    maxSequence: restored?.remoteMaxSequence ?? 0,
    seen: restored?.remoteSeenSequences ?? [],
  });
  const link = {
    linkId: resolvedLinkId,
    realmId: resolvedRealmId,
    branchId: resolvedBranchId,
    localIdentity: Object.freeze({
      peerId,
      passportId: boundedString(localIdentity.passportId, 'local passportId'),
      deviceId: boundedString(localIdentity.deviceId, 'local deviceId'),
    }),
    signer,
    verifyIdentity,
    authorizeCapabilities,
    supportedCapabilities: new Set(normalizeCapabilities(supportedCapabilities)),
    remoteCapabilities: new Set(),
    negotiatedCapabilities: new Set(),
    remoteIdentity: null,
    remotePublicKeyHex: null,
    state: REALM_LINK_STATE.IDLE,
    sessionEpoch: restored?.sessionEpoch ?? 0,
    sendSequence: restored?.lastSentSequence ?? 0,
    replay,
    transports: new Map(),
    activeBinding: null,
    pendingBinding: null,
    onData,
    onStateChange,
    continuityStore,
    restoredContinuity: restored,
    now,
    idFactory,
    logger,
    correlationId,
  };
  emit(link, 'created', { restored: !!restored });
  return link;
}

async function makeFrame(link, binding, type, payload) {
  link.sendSequence += 1;
  return signRealmLinkFrame({
    linkId: link.linkId,
    realmId: link.realmId,
    branchId: link.branchId,
    senderPeerId: link.localIdentity.peerId,
    sessionEpoch: binding.epoch,
    sequence: link.sendSequence,
    messageId: link.idFactory(),
    issuedAt: link.now(),
    type,
    payload,
    signer: link.signer,
  });
}

async function sendOnBinding(link, binding, type, payload) {
  const startedAt = link.now();
  const frame = await makeFrame(link, binding, type, payload);
  await binding.session.send(frame);
  emit(link, 'frame.sent', {
    transportId: binding.session.id,
    sessionEpoch: binding.epoch,
    frameType: type,
    sequence: frame.sequence,
    durationMs: Math.max(0, link.now() - startedAt),
  });
  return frame;
}

async function startHandshake(link, binding) {
  const frame = await sendOnBinding(link, binding, REALM_LINK_FRAME.HELLO, {
    identity: localIdentityPayload(link),
    capabilities: [...link.supportedCapabilities],
    handshakeNonce: link.idFactory(),
    migrationFromEpoch: link.activeBinding?.epoch ?? null,
  });
  binding.helloMessageId = frame.messageId;
  binding.handshakeStartedAt = link.now();
  return frame;
}

function installBinding(link, session) {
  assertRealmTransportSession(session);
  if (link.transports.has(session.id)) throw new Error(`transport already attached: ${session.id}`);
  link.sessionEpoch += 1;
  const binding = {
    session,
    epoch: link.sessionEpoch,
    remoteEpoch: null,
    unsubscribe: null,
    helloMessageId: null,
    ackMessageId: null,
    handshakeStartedAt: null,
  };
  const unsubscribe = session.subscribe((frame) => {
    Promise.resolve(handleRealmLinkFrame(link, frame, { binding })).catch((error) => {
      emit(link, 'frame.handler-failed', { transportId: session.id, reason: error?.message ?? 'handler-failed' }, 'error');
    });
  });
  binding.unsubscribe = typeof unsubscribe === 'function' ? unsubscribe : null;
  link.transports.set(session.id, binding);
  return binding;
}

/** Attach an existing transport session and optionally initiate the authenticated handshake. */
export async function attachRealmLinkTransport(link, session, { initiate = true } = {}) {
  if (link.state === REALM_LINK_STATE.CLOSED) throw new Error('cannot attach transport to a closed Realm Link');
  const binding = installBinding(link, session);
  link.pendingBinding = binding;
  transition(link, link.activeBinding ? REALM_LINK_STATE.MIGRATING : REALM_LINK_STATE.HANDSHAKING, 'transport-attached');
  emit(link, 'transport.attached', { transportId: session.id, kind: session.kind ?? null, sessionEpoch: binding.epoch });
  if (initiate) await startHandshake(link, binding);
  return binding;
}

async function promoteBinding(link, binding, reason) {
  const previous = link.activeBinding;
  link.activeBinding = binding;
  if (link.pendingBinding === binding) link.pendingBinding = null;
  transition(link, REALM_LINK_STATE.CONNECTED, reason);
  if (previous && previous !== binding) {
    previous.unsubscribe?.();
    link.transports.delete(previous.session.id);
    try { await previous.session.close('realm-link-transport-migrated'); } catch (_) { /* Best effort after new path is live. */ }
    emit(link, 'transport.retired', { transportId: previous.session.id, replacementId: binding.session.id });
  }
  if (link.continuityStore) await persistRealmLinkContinuity(link);
}

function remoteKeyMatches(link, frame) {
  return !!link.remoteIdentity
    && frame.senderPeerId === link.remoteIdentity.peerId
    && frame.signerPublicKeyHex === link.remotePublicKeyHex;
}

async function handleHello(link, frame, binding, handshake, authorization) {
  if (link.activeBinding && link.activeBinding !== binding
    && ![REALM_LINK_STATE.RECONNECTING, REALM_LINK_STATE.DEGRADED].includes(link.state)
    && !isPreferredTransport(binding.session, link.activeBinding.session)) {
    binding.unsubscribe?.();
    link.transports.delete(binding.session.id);
    if (link.pendingBinding === binding) link.pendingBinding = null;
    try { await binding.session.close('realm-link-duplicate-or-downgrade'); } catch (_) { /* Rejection is already final locally. */ }
    return { handled: true, accepted: false, reason: 'duplicate-or-downgrade' };
  }
  const accepted = await capabilitiesForRemote(link, authorization.identity, handshake.capabilities);
  link.remoteIdentity = authorization.identity;
  link.remotePublicKeyHex = frame.signerPublicKeyHex;
  link.remoteCapabilities = new Set(accepted);
  const ack = await sendOnBinding(link, binding, REALM_LINK_FRAME.HELLO_ACK, {
    identity: localIdentityPayload(link),
    capabilities: [...link.supportedCapabilities],
    acceptedCapabilities: accepted,
    handshakeNonce: link.idFactory(),
    helloMessageId: frame.messageId,
  });
  binding.ackMessageId = ack.messageId;
  await promoteBinding(link, binding, link.activeBinding ? 'remote-transport-migration' : 'remote-handshake-accepted');
  return { handled: true, accepted: true, reason: null };
}

async function handleHelloAck(link, frame, binding, handshake, authorization) {
  if (!binding.helloMessageId || handshake.helloMessageId !== binding.helloMessageId) {
    return { handled: true, accepted: false, reason: 'hello-ack-mismatch' };
  }
  const acceptedByRemote = normalizeCapabilities(frame.payload.acceptedCapabilities ?? []);
  if (acceptedByRemote.some((value) => !link.supportedCapabilities.has(value))) {
    return { handled: true, accepted: false, reason: 'capability-escalation' };
  }
  link.remoteIdentity = authorization.identity;
  link.remotePublicKeyHex = frame.signerPublicKeyHex;
  link.negotiatedCapabilities = new Set(acceptedByRemote);
  const acceptedForRemote = await capabilitiesForRemote(link, authorization.identity, handshake.capabilities);
  link.remoteCapabilities = new Set(acceptedForRemote);
  await sendOnBinding(link, binding, REALM_LINK_FRAME.HELLO_CONFIRM, {
    helloAckMessageId: frame.messageId,
    acceptedCapabilities: acceptedForRemote,
  });
  await promoteBinding(link, binding, link.activeBinding ? 'transport-upgraded' : 'handshake-complete');
  return { handled: true, accepted: true, reason: null };
}

function handleHelloConfirm(link, frame, binding) {
  const payload = frame.payload;
  if (!payload || payload.helloAckMessageId !== binding.ackMessageId) {
    return { handled: true, accepted: false, reason: 'hello-confirm-mismatch' };
  }
  const accepted = normalizeCapabilities(payload.acceptedCapabilities ?? []);
  if (accepted.some((value) => !link.supportedCapabilities.has(value))) {
    return { handled: true, accepted: false, reason: 'capability-escalation' };
  }
  link.negotiatedCapabilities = new Set(accepted);
  return { handled: true, accepted: true, reason: null };
}

/** Verify, deduplicate, authorize, and dispatch one inbound Realm Link frame. */
export async function handleRealmLinkFrame(link, frame, { binding = null } = {}) {
  if (link.state === REALM_LINK_STATE.CLOSED) return { handled: true, accepted: false, reason: 'closed' };
  const resolvedBinding = binding ?? link.transports.get(frame?.transportId) ?? link.activeBinding;
  if (!resolvedBinding || !link.transports.has(resolvedBinding.session.id)) return { handled: false, accepted: false, reason: 'unknown-transport' };
  const verified = await verifyRealmLinkFrame(frame, {
    linkId: link.linkId,
    realmId: link.realmId,
    branchId: link.branchId,
    now: link.now(),
  });
  if (!verified.ok) {
    emit(link, 'frame.rejected', { transportId: resolvedBinding.session.id, reason: verified.reason }, 'warn');
    return { handled: true, accepted: false, reason: verified.reason };
  }
  const isHandshake = frame.type === REALM_LINK_FRAME.HELLO || frame.type === REALM_LINK_FRAME.HELLO_ACK;
  let handshake = null;
  let authorization = null;
  if (isHandshake) {
    try { handshake = validateHandshakePayload(frame.payload); }
    catch (_) { return { handled: true, accepted: false, reason: 'malformed-handshake' }; }
    authorization = await authorizeRemoteIdentity(link, frame, handshake);
    if (!authorization.ok) {
      emit(link, 'frame.rejected', { transportId: resolvedBinding.session.id, frameType: frame.type, reason: authorization.reason }, 'warn');
      return { handled: true, accepted: false, reason: authorization.reason };
    }
    if (resolvedBinding.remoteEpoch != null && frame.sessionEpoch !== resolvedBinding.remoteEpoch) {
      return { handled: true, accepted: false, reason: 'transport-epoch-mismatch' };
    }
    resolvedBinding.remoteEpoch = frame.sessionEpoch;
  } else {
    if (!remoteKeyMatches(link, frame)) return { handled: true, accepted: false, reason: 'unrecognized-remote-key' };
    if (resolvedBinding.remoteEpoch == null || frame.sessionEpoch !== resolvedBinding.remoteEpoch) {
      return { handled: true, accepted: false, reason: 'transport-epoch-mismatch' };
    }
  }
  const replay = acceptRealmLinkReplay(link.replay, frame, { now: link.now() });
  if (!replay.ok) {
    emit(link, 'frame.replayed', { transportId: resolvedBinding.session.id, reason: replay.reason, messageId: frame.messageId }, 'warn');
    return { handled: true, accepted: false, reason: replay.reason };
  }
  let result;
  if (frame.type === REALM_LINK_FRAME.HELLO) result = await handleHello(link, frame, resolvedBinding, handshake, authorization);
  else if (frame.type === REALM_LINK_FRAME.HELLO_ACK) result = await handleHelloAck(link, frame, resolvedBinding, handshake, authorization);
  else {
    if (frame.type === REALM_LINK_FRAME.HELLO_CONFIRM) {
      result = handleHelloConfirm(link, frame, resolvedBinding);
    } else if (frame.type === REALM_LINK_FRAME.DATA) {
      const capability = frame.payload?.capability ?? null;
      if (capability != null && !link.remoteCapabilities.has(capability)) {
        result = { handled: true, accepted: false, reason: 'capability-not-negotiated' };
      } else {
        await link.onData({
          kind: boundedString(frame.payload?.kind, 'data kind', 256),
          payload: frame.payload?.payload ?? null,
          capability,
          remoteIdentity: link.remoteIdentity,
          messageId: frame.messageId,
          sequence: frame.sequence,
        });
        result = { handled: true, accepted: true, reason: null };
      }
    } else if (frame.type === REALM_LINK_FRAME.GOODBYE) {
      transition(link, REALM_LINK_STATE.RECONNECTING, frame.payload?.reason ?? 'remote-goodbye');
      result = { handled: true, accepted: true, reason: null };
    } else {
      result = { handled: true, accepted: false, reason: 'unsupported-control-frame' };
    }
  }
  if (!result.accepted) emit(link, 'frame.rejected', {
    transportId: resolvedBinding.session.id,
    frameType: frame.type,
    reason: result.reason,
  }, 'warn');
  else emit(link, 'frame.accepted', {
    transportId: resolvedBinding.session.id,
    frameType: frame.type,
    sequence: frame.sequence,
  });
  return result;
}

export async function sendRealmLinkData(link, kind, payload, { capability = null } = {}) {
  if (link.state !== REALM_LINK_STATE.CONNECTED || !link.activeBinding) throw new Error('Realm Link is not connected');
  if (capability != null && !link.negotiatedCapabilities.has(capability)) {
    throw new Error(`remote did not accept capability: ${capability}`);
  }
  return sendOnBinding(link, link.activeBinding, REALM_LINK_FRAME.DATA, {
    kind: boundedString(kind, 'data kind', 256),
    capability,
    payload,
  });
}

/** Attempt a higher-priority channel while the current one remains live. */
export async function upgradeRealmLinkTransport(link, candidateSession) {
  assertRealmTransportSession(candidateSession);
  if (link.activeBinding && !isPreferredTransport(candidateSession, link.activeBinding.session)) {
    await candidateSession.close('realm-link-upgrade-not-preferred');
    return false;
  }
  await attachRealmLinkTransport(link, candidateSession, { initiate: true });
  return true;
}

export function snapshotRealmLink(link) {
  return Object.freeze({
    linkId: link.linkId,
    realmId: link.realmId,
    branchId: link.branchId,
    state: link.state,
    localIdentity: link.localIdentity,
    remoteIdentity: link.remoteIdentity,
    sessionEpoch: link.sessionEpoch,
    lastSentSequence: link.sendSequence,
    replay: snapshotRealmLinkReplayWindow(link.replay),
    activeTransport: link.activeBinding ? Object.freeze({
      id: link.activeBinding.session.id,
      kind: link.activeBinding.session.kind ?? null,
      priority: link.activeBinding.session.priority ?? 0,
      epoch: link.activeBinding.epoch,
    }) : null,
    negotiatedCapabilities: Object.freeze([...link.negotiatedCapabilities].sort()),
    remoteCapabilities: Object.freeze([...link.remoteCapabilities].sort()),
  });
}

export function realmLinkContinuityRecord(link, overrides = {}) {
  const restored = link.restoredContinuity;
  return createContinuityRecord({
    linkId: link.linkId,
    realmId: link.realmId,
    branchId: link.branchId,
    localPeerId: link.localIdentity.peerId,
    remotePeerId: link.remoteIdentity?.peerId ?? restored?.remotePeerId ?? null,
    sessionEpoch: link.sessionEpoch,
    lastSentSequence: link.sendSequence,
    remoteMaxSequence: link.replay.maxSequence,
    remoteSeenSequences: [...link.replay.seen],
    sealedReconnectCredential: overrides.sealedReconnectCredential ?? restored?.sealedReconnectCredential ?? null,
    peerTicket: overrides.peerTicket ?? restored?.peerTicket ?? null,
    routeHints: overrides.routeHints ?? restored?.routeHints ?? [],
    transfers: overrides.transfers ?? restored?.transfers ?? [],
    updatedAt: link.now(),
  });
}

export async function persistRealmLinkContinuity(link, overrides = {}) {
  if (!link.continuityStore) throw new Error('Realm Link has no continuity store');
  const record = await saveContinuity(link.continuityStore, realmLinkContinuityRecord(link, overrides));
  link.restoredContinuity = record;
  return record;
}

export async function markRealmLinkDisconnected(link, reason = 'transport-disconnected') {
  if (link.state === REALM_LINK_STATE.CLOSED) return;
  transition(link, REALM_LINK_STATE.RECONNECTING, reason);
  if (link.continuityStore) await persistRealmLinkContinuity(link);
}

export async function closeRealmLink(link, reason = 'local-close') {
  if (link.state === REALM_LINK_STATE.CLOSED) return;
  if (link.activeBinding && link.state === REALM_LINK_STATE.CONNECTED) {
    try { await sendOnBinding(link, link.activeBinding, REALM_LINK_FRAME.GOODBYE, { reason: boundedString(reason, 'close reason', 256) }); }
    catch (_) { /* Closing must continue if the transport is already gone. */ }
  }
  const bindings = [...link.transports.values()];
  link.transports.clear();
  link.activeBinding = null;
  link.pendingBinding = null;
  for (const binding of bindings) {
    binding.unsubscribe?.();
    try { await binding.session.close(reason); } catch (_) { /* Best effort. */ }
  }
  transition(link, REALM_LINK_STATE.CLOSED, reason);
}

/** Canonical digest input for diagnostics/evidence without exposing keys or payloads. */
export function realmLinkEvidence(link) {
  const snapshot = snapshotRealmLink(link);
  return canonicalize({
    linkId: snapshot.linkId,
    realmId: snapshot.realmId,
    branchId: snapshot.branchId,
    state: snapshot.state,
    sessionEpoch: snapshot.sessionEpoch,
    lastSentSequence: snapshot.lastSentSequence,
    remoteMaxSequence: snapshot.replay.maxSequence,
    activeTransport: snapshot.activeTransport,
    negotiatedCapabilities: snapshot.negotiatedCapabilities,
  });
}
