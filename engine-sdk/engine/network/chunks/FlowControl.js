// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/chunks/FlowControl.js — credit-based flow control + priority
// lanes (network plan §28). QUIC-style: a receiver advertises how much
// in-flight data it can absorb; senders must reserve credit before sending
// and the receiver restores it once a fragment is verified/written.

/** Create a flow-control window. */
export function createFlowControl({ maxInFlightBytes = 16 * 1024 * 1024 } = {}) {
  return { maxInFlightBytes, inFlightBytes: 0 };
}

/** Try to reserve `bytes` of send credit. Returns false (caller must pause) if it would exceed the window. */
export function tryReserveCredit(fc, bytes) {
  if (bytes < 0) throw new RangeError('tryReserveCredit: bytes must be >= 0');
  if (fc.inFlightBytes + bytes > fc.maxInFlightBytes) return false;
  fc.inFlightBytes += bytes;
  return true;
}

/** Restore credit after a fragment is verified/written (or dropped/timed out). */
export function releaseCredit(fc, bytes) {
  fc.inFlightBytes = Math.max(0, fc.inFlightBytes - bytes);
}

/** Bytes of credit still available right now. */
export function availableCredit(fc) {
  return Math.max(0, fc.maxInFlightBytes - fc.inFlightBytes);
}

// ── Priority lanes (network plan §28) ────────────────────────────────────────
// Bulk file transfer must never block governance/control traffic.

export const PRIORITY_LANE = Object.freeze({
  GOVERNANCE: 0, // revokes, bans, key rotation
  CONTROL: 1,    // heartbeat, signaling, route changes
  MANIFEST: 2,   // manifests and ledgers
  NORMAL: 3,     // normal chunks
  BULK: 4,       // bulk chunks
});

/** Create an empty multi-lane priority queue. */
export function createPriorityQueue() {
  return { _lanes: new Map() }; // lane:number -> item[]
}

/** Enqueue an item on a priority lane (lower lane number = served first). */
export function enqueue(pq, lane, item) {
  if (!pq._lanes.has(lane)) pq._lanes.set(lane, []);
  pq._lanes.get(lane).push(item);
}

/** Dequeue the next item, always draining the lowest non-empty lane first. */
export function dequeue(pq) {
  const lanes = [...pq._lanes.keys()].sort((a, b) => a - b);
  for (const lane of lanes) {
    const arr = pq._lanes.get(lane);
    if (arr && arr.length) return arr.shift();
  }
  return null;
}

/** True if every lane is empty. */
export function isQueueEmpty(pq) {
  for (const arr of pq._lanes.values()) if (arr.length) return false;
  return true;
}
