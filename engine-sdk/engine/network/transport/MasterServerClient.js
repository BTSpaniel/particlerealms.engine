// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/transport/MasterServerClient.js — live WebSocket signaling client
// for a single Masterserver (network plan §7/§8/§12, Phase 2b). Speaks the
// tiny HELLO -> PROVE -> PING/PONG -> DISCOVER wire protocol implemented by
// Masterserver/app/routes.py. All outgoing envelopes use the
// `particle-discovery/1` namespace — the server validates `protocol` and
// `type` independently (Masterserver/app/protocol.py validate_envelope), so
// a single namespace for every message type from this client is sufficient
// and matches the confirmed-live wire format.
//
// PROVE requires signing the exact raw challenge bytes the server issued
// (Masterserver/app/session_crypto.py verifies a raw P1363 ECDSA signature
// over those bytes) — NOT a stringified/hex-encoded form of them. This is
// why deviceSigner.signRaw() (engine/state/authority/Identity.js) is used
// here instead of the string-based signer.sign().

import { PROTOCOL_VERSIONS } from '../protocol.js';
import { byteSignature } from '../../core/math/FormatMath.js';
import { rttSampleMs } from '../../core/math/NetworkMetricMath.js';

/** Connection lifecycle states surfaced via onEvent(). */
export const MS_CLIENT_STATE = Object.freeze({
  IDLE: 'idle',
  CONNECTING: 'connecting',
  HELLO_SENT: 'hello_sent',
  PROVING: 'proving',
  CONNECTED: 'connected',
  ERROR: 'error',
  CLOSED: 'closed',
});

const HEARTBEAT_INTERVAL_MS = 15_000;
let _requestIdSequence = 0;

function _hexToBytes(hex) {
  const clean = String(hex ?? '').replace(/^0x/, '');
  const bytes = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  return bytes;
}

function _newId(prefix) {
  const cryptoApi = globalThis.crypto;
  let rnd = null;
  try {
    if (typeof cryptoApi?.randomUUID === 'function') {
      rnd = cryptoApi.randomUUID();
    } else if (typeof cryptoApi?.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      rnd = byteSignature(bytes);
    }
  } catch {}
  if (!rnd) rnd = `${Date.now().toString(36)}-${(++_requestIdSequence).toString(36)}`;
  return `${prefix}-${rnd}`;
}

/**
 * Create a live client for one Masterserver. Does not auto-connect —
 * call `connect()` explicitly.
 * @param {object} cfg
 * @param {string} cfg.url            wss:// URL of the Masterserver's /v1/ws endpoint
 * @param {object} [cfg.deviceSigner] signer from createDeviceIdentity() — required to complete PROVE
 * @param {(event:{type:string,state:string,sessionId:?string,latencyMs:?number,[key:string]:*}) => void} [cfg.onEvent]
 * @returns {object} client { connect, disconnect, ping, discover, getState }
 */
export function createMasterServerClient({ url, deviceSigner = null, onEvent = null } = {}) {
  if (!url) throw new TypeError('createMasterServerClient requires a url');

  let ws = null;
  let state = MS_CLIENT_STATE.IDLE;
  let sessionId = null;
  let latencyMs = null;
  let pingSentAt = null;
  let heartbeatTimer = null;

  function _emit(type, extra = {}) {
    try { onEvent?.({ type, state, sessionId, latencyMs, url, protocol: PROTOCOL_VERSIONS.DISCOVERY, ...extra }); } catch (_) { /* listener errors are non-fatal */ }
  }

  function _stopHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function ping() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    pingSentAt = Date.now();
    ws.send(JSON.stringify({ protocol: PROTOCOL_VERSIONS.DISCOVERY, type: 'PING', id: _newId('ping') }));
  }

  function _startHeartbeat() {
    _stopHeartbeat();
    heartbeatTimer = setInterval(ping, HEARTBEAT_INTERVAL_MS);
    ping();
  }

  function discover(routeId = null) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ protocol: PROTOCOL_VERSIONS.DISCOVERY, type: 'DISCOVER', id: _newId('discover'), payload: { routeId } }));
  }

  /** Subscribe this session to a route so SIGNAL/FORWARD/PUBLISH fan out to it. */
  function attachRoute(routeId) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !routeId) return;
    ws.send(JSON.stringify({ protocol: PROTOCOL_VERSIONS.DISCOVERY, type: 'ATTACH_ROUTE', id: _newId('attach'), payload: { routeId } }));
  }

  function detachRoute(routeId) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !routeId) return;
    ws.send(JSON.stringify({ protocol: PROTOCOL_VERSIONS.DISCOVERY, type: 'DETACH_ROUTE', id: _newId('detach'), payload: { routeId } }));
  }

  /**
   * Relay an arbitrary opaque JSON message to every other session attached to
   * `routeId` (server never inspects contents beyond routeId/ttl — network
   * plan §12). Used by engine/collab/CollabSignal.js as a cross-internet
   * WebRTC signaling tier alongside BroadcastChannel/SharedWorker/BitTorrent.
   * @param {string} routeId
   * @param {object} message  arbitrary JSON payload (merged in, so put your
   *                          own `type`/`from`/`to` fields directly on it)
   */
  function signal(routeId, message = {}) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !routeId) return;
    ws.send(JSON.stringify({
      protocol: PROTOCOL_VERSIONS.DISCOVERY, type: 'SIGNAL', id: _newId('signal'),
      payload: { ...message, routeId },
    }));
  }

  async function _handleMessage(evt) {
    let data;
    try { data = JSON.parse(evt.data); } catch (_) { return; }

    if (data.type === 'HELLO') {
      sessionId = data.payload?.sessionId ?? null;
      const challengeHex = data.payload?.challengeHex;
      if (!challengeHex || !deviceSigner?.signRaw) {
        state = MS_CLIENT_STATE.ERROR;
        _emit('error', { message: 'no challenge or device signer unavailable' });
        return;
      }
      const signatureHex = await deviceSigner.signRaw(_hexToBytes(challengeHex));
      state = MS_CLIENT_STATE.PROVING;
      _emit('proving', { sessionId });
      ws.send(JSON.stringify({
        protocol: PROTOCOL_VERSIONS.DISCOVERY, type: 'PROVE', id: _newId('prove'),
        payload: { signatureHex },
      }));
    } else if (data.type === 'PROVE') {
      if (data.payload?.ok) {
        state = MS_CLIENT_STATE.CONNECTED;
        _emit('connected', { sessionId });
        _startHeartbeat();
      } else {
        state = MS_CLIENT_STATE.ERROR;
        _emit('error', { message: 'PROVE rejected' });
      }
    } else if (data.type === 'PONG') {
      if (pingSentAt != null) {
        const pongReceivedAt = Date.now();
        latencyMs = Number.isFinite(pingSentAt) && pongReceivedAt >= pingSentAt
          ? rttSampleMs({ sentAtMs: pingSentAt, ackReceivedAtMs: pongReceivedAt })
          : pongReceivedAt - pingSentAt;
        pingSentAt = null;
        _emit('pong', { latencyMs });
      }
    } else if (data.type === 'PEERS') {
      _emit('peers', { routeId: data.payload?.routeId ?? null, peers: data.payload?.peers ?? [] });
    } else if (data.type === 'ATTACH_ROUTE') {
      _emit('route-attached', { routeId: data.payload?.routeId ?? null, ok: !!data.payload?.ok });
    } else if (data.type === 'SIGNAL' || data.type === 'FORWARD' || data.type === 'PUBLISH') {
      const { routeId = null, ...message } = data.payload || {};
      _emit('signal', { routeId, message });
    } else if (data.type === 'ERROR') {
      _emit('protocol-error', { code: data.code, message: data.message });
    }
  }

  function connect() {
    if (ws) return;
    state = MS_CLIENT_STATE.CONNECTING;
    _emit('connecting');
    try {
      ws = new WebSocket(url);
    } catch (err) {
      state = MS_CLIENT_STATE.ERROR;
      _emit('error', { message: err?.message ?? 'failed to open WebSocket' });
      ws = null;
      return;
    }
    ws.onopen = () => {
      state = MS_CLIENT_STATE.HELLO_SENT;
      const hello = {
        protocol: PROTOCOL_VERSIONS.DISCOVERY, type: 'HELLO', id: _newId('hello'),
        client: 'webgpu-os', version: 1,
        payload: deviceSigner?.publicKeyHex ? { publicKeyHex: deviceSigner.publicKeyHex } : {},
      };
      ws.send(JSON.stringify(hello));
      _emit('hello_sent');
    };
    ws.onmessage = (evt) => { _handleMessage(evt); };
    ws.onerror = () => {
      state = MS_CLIENT_STATE.ERROR;
      _emit('error', { message: 'WebSocket error' });
    };
    ws.onclose = () => {
      _stopHeartbeat();
      sessionId = null;
      latencyMs = null;
      ws = null;
      state = MS_CLIENT_STATE.CLOSED;
      _emit('closed');
    };
  }

  function disconnect() {
    _stopHeartbeat();
    try { ws?.close(); } catch (_) { /* already closed */ }
    ws = null;
    sessionId = null;
    state = MS_CLIENT_STATE.CLOSED;
  }

  function getState() {
    return { state, sessionId, latencyMs, url, protocol: PROTOCOL_VERSIONS.DISCOVERY };
  }

  return Object.freeze({ connect, disconnect, ping, discover, attachRoute, detachRoute, signal, getState });
}
