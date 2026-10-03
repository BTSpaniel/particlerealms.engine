// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/chunks/SwarmScheduler.js — spread chunk fetches across multiple
// providing peers (network plan §31 swarm fetching). Pure scheduling logic;
// the actual byte transfer happens over routes/sessions from earlier phases.

/**
 * Assign each requested chunk to one candidate provider peer, load-balancing
 * so no single peer is asked for every chunk, then group the assignments
 * into fetch "lanes" of up to `maxLanes` concurrent requests.
 * @param {object} c
 * @param {string[]} c.chunkIds
 * @param {Map<string,string[]>} c.providers   chunkId -> candidate peerIds (network plan §31 provider records)
 * @param {number} [c.maxLanes]
 * @returns {{ plan:Array<{chunkId:string, peerId:string}>, lanes:Array<Array<{chunkId:string, peerId:string}>>, unresolved:string[], peerLoad:object }}
 */
export function planSwarmFetch({ chunkIds, providers, maxLanes = 4 } = {}) {
  const peerLoad = new Map(); // peerId -> assigned chunk count
  const plan = [];
  const unresolved = [];

  for (const chunkId of chunkIds) {
    const candidates = (providers.get(chunkId) || []).slice();
    if (candidates.length === 0) { unresolved.push(chunkId); continue; }
    candidates.sort((a, b) => (peerLoad.get(a) || 0) - (peerLoad.get(b) || 0));
    const peerId = candidates[0];
    peerLoad.set(peerId, (peerLoad.get(peerId) || 0) + 1);
    plan.push({ chunkId, peerId });
  }

  const lanes = [];
  for (let i = 0; i < plan.length; i += maxLanes) lanes.push(plan.slice(i, i + maxLanes));

  return { plan, lanes, unresolved, peerLoad: Object.fromEntries(peerLoad) };
}
