// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/syncManager/SyncTransport.js — moves the group-workstation CRDT
// bytes that SyncManager.js only ever decided WHETHER to send (network plan
// §20, plus §18/§19's workstation CRDT). Reuses a caller-owned, already
// connected + already route-attached Particle daemon or explicitly enabled
// legacy client as the wire: local ops use `client.signal(routeId, ...)` to
// every other session attached to the route, and incoming SIGNAL events for
// that routeId are folded in via CRDT join (`mergeWorkstationState`). CRDTs
// are commutative/idempotent by construction, so no ordering, ack, or
// conflict-resolution logic is needed here — this is intentionally the
// entire transport.
//
// This module owns no socket/timer of its own; it is pure glue between
// SyncManager's gate (`shouldSync`), Workstation's CRDT state, and whatever
// Particle signaling session + opaque route tag the caller has brought up
// (e.g. factory/apps/network-manager's Routes tab, or a future group app).

import { shouldSync } from './SyncManager.js';
import { mergeWorkstationState } from '../workstation/WorkstationState.js';
import { ORSet, LWWRegister } from '../../state/consistency/CRDT.js';

const SYNC_MESSAGE_TYPE = 'WORKSTATION_SYNC';

// ── Wire (de)serialization ────────────────────────────────────────────────────
// Deliberately preserves ORSet's add-tags/tombstones and LWWRegister's
// (value, ts, node) — NOT WorkstationState.js's `snapshotWorkstationState()`
// `.value()` view, which is display-only and loses the CRDT metadata a
// future merge needs to stay convergent.

function _serializeORSet(set) {
  return {
    adds: [...set._adds.entries()].map(([el, tags]) => [el, [...tags]]),
    removes: [...set._removes],
  };
}

function _deserializeORSet(wire) {
  return new ORSet(
    new Map((wire?.adds || []).map(([el, tags]) => [el, new Set(tags)])),
    new Set(wire?.removes || []),
  );
}

function _serializeLWW(reg) {
  return { value: reg.value(), ts: reg.timestamp(), node: reg._node };
}

function _deserializeLWW(wire) {
  return new LWWRegister(wire?.value ?? null, wire?.ts ?? 0, wire?.node ?? '');
}

/** Serialize a WorkstationState.js state object into a JSON-safe wire payload. */
export function serializeWorkstationState(state) {
  return {
    pinnedApps: _serializeORSet(state.pinnedApps),
    folders: _serializeORSet(state.folders),
    agents: _serializeORSet(state.agents),
    windowLayout: Object.fromEntries([...state.windowLayout.entries()].map(([id, reg]) => [id, _serializeLWW(reg)])),
    wallpaper: _serializeLWW(state.wallpaper),
  };
}

/** Inverse of serializeWorkstationState — reconstructs real CRDT instances (not plain values). */
export function deserializeWorkstationState(wire) {
  const windowLayout = new Map(Object.entries(wire?.windowLayout || {}).map(([id, w]) => [id, _deserializeLWW(w)]));
  return {
    pinnedApps: _deserializeORSet(wire?.pinnedApps),
    folders: _deserializeORSet(wire?.folders),
    agents: _deserializeORSet(wire?.agents),
    windowLayout,
    wallpaper: _deserializeLWW(wire?.wallpaper),
  };
}

// ── Transport ──────────────────────────────────────────────────────────────

/**
 * Wire a live group workstation to a connected + route-attached
 * MasterServerClient. Both push (outgoing) and handleEvent (incoming) are
 * gated by the same `shouldSync` check, so disabling a category locally
 * stops us from both broadcasting AND accepting that category's updates.
 *
 * @param {object} c
 * @param {object} c.client       a connected `transport/MasterServerClient.js`
 *   instance — caller must have already called `client.attachRoute(routeId)`
 * @param {string} c.routeId      the route both local and remote sessions are attached to
 * @param {object} c.syncManager  from `createSyncManager()`
 * @param {string} c.category     a `SYNC_CATEGORIES` entry gating this transport (typically 'desktop')
 * @param {string} c.targetScope  the `SYNC_SCOPE` this route represents (e.g. `SYNC_SCOPE.PRIVATE_GROUP`)
 * @param {() => {groupId:string, state:object}} c.getWorkstation  returns the current workstation
 * @param {(next:{groupId:string, state:object}) => void} c.setWorkstation  called with the merged workstation after an incoming update
 * @returns {{ push: () => boolean, handleEvent: (evt:object) => boolean }}
 */
export function createSyncTransport({ client, routeId, syncManager, category, targetScope, getWorkstation, setWorkstation }) {
  if (!client || !routeId) throw new TypeError('createSyncTransport requires a client and routeId');
  if (typeof getWorkstation !== 'function' || typeof setWorkstation !== 'function') {
    throw new TypeError('createSyncTransport requires getWorkstation/setWorkstation');
  }
  if (!category || !targetScope) throw new TypeError('createSyncTransport requires category and targetScope');

  /**
   * Broadcast the current local workstation state to every other session on
   * the route, if the sync rule currently allows it.
   * @returns {boolean} true if a broadcast was actually sent
   */
  function push() {
    if (!shouldSync(syncManager, category, targetScope)) return false;
    const workstation = getWorkstation();
    client.signal(routeId, {
      type: SYNC_MESSAGE_TYPE,
      category,
      groupId: workstation.groupId,
      state: serializeWorkstationState(workstation.state),
    });
    return true;
  }

  /**
   * Feed every 'signal' onEvent from the client through this — it is a
   * silent no-op for anything not addressed to this transport's routeId/
   * category/message type.
   * @returns {boolean} true if the event was ours and got merged in
   */
  function handleEvent(evt) {
    if (evt?.type !== 'signal' || (evt.routeTag ?? evt.routeId) !== routeId) return false;
    const msg = evt.message;
    if (!msg || msg.type !== SYNC_MESSAGE_TYPE || msg.category !== category) return false;
    if (!shouldSync(syncManager, category, targetScope)) return false; // rule disabled locally — ignore incoming too
    const workstation = getWorkstation();
    if (msg.groupId && workstation.groupId && msg.groupId !== workstation.groupId) return false;
    const incoming = deserializeWorkstationState(msg.state);
    setWorkstation({ ...workstation, state: mergeWorkstationState(workstation.state, incoming) });
    return true;
  }

  return { push, handleEvent };
}
