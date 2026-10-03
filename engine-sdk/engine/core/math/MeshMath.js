// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MeshMath.js - reusable peer-graph, neighbor, relay, gossip, and mesh-health helpers.

import { statsMean } from './MathStatistics.js';

export const MESH_MIN_DEGREE = 3;
export const MESH_DEFAULT_IDEAL_DEGREE = 4;
export const MESH_MAX_DEGREE = 6;
export const MESH_SUPERNODE_DEGREE = 10;
export const MESH_FULL_MESH_CEILING = 6;
export const MESH_SUPERNODE_THRESHOLD = 20;
export const MESH_SUPERNODE_SCORE = 700;
export const MESH_GOSSIP_FACTOR = 0.25;
export const MESH_GOSSIP_MIN_LAZY = 3;
export const MESH_GOSSIP_ROUNDS = 3;

export const MESH_NEIGHBOR_SCORE_WEIGHTS = Object.freeze({
  latency: 0.30,
  reputation: 0.25,
  uptime: 0.15,
  diversity: 0.10,
  integrity: 0.20,
});

export const MESH_LINK_QUALITY_WEIGHTS = Object.freeze({
  latency: 0.25,
  delivery: 0.25,
  jitter: 0.15,
  throughput: 0.15,
  stability: 0.10,
  integrity: 0.10,
});

export const MESH_SUPERNODE_TIER_MULTIPLIER = Object.freeze({
  clean: 1.0,
  warning: 0.7,
  throttled: 0.3,
  muted: 0.0,
  kicked: 0.0,
});

export const MESH_NEIGHBOR_TIER_PENALTY = Object.freeze({
  clean: 0.0,
  warning: 0.15,
  throttled: 0.45,
  muted: 0.8,
  kicked: 1.0,
});

function finiteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new RangeError(`${name} must be finite`);
  }
  return number;
}

function nonnegativeNumber(value, name) {
  const number = finiteNumber(value, name);
  if (number < 0) {
    throw new RangeError(`${name} must be nonnegative`);
  }
  return number;
}

function positiveNumber(value, name) {
  const number = finiteNumber(value, name);
  if (number <= 0) {
    throw new RangeError(`${name} must be positive`);
  }
  return number;
}

function optionalNonnegative(value, name, fallback = 0) {
  return value === undefined || value === null ? fallback : nonnegativeNumber(value, name);
}

function optionalPositive(value, name, fallback) {
  return value === undefined || value === null ? fallback : positiveNumber(value, name);
}

function optionalFinite(value, name, fallback) {
  return value === undefined || value === null ? fallback : finiteNumber(value, name);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function boundedRatio(value, name, fallback) {
  const number = value === undefined || value === null ? fallback : finiteNumber(value, name);
  if (number < 0 || number > 1) {
    throw new RangeError(`${name} must be between 0 and 1`);
  }
  return number;
}

function inverseLerpClamped(value, bad, good) {
  if (bad === good) return value <= good ? 1 : 0;
  return clamp01((value - bad) / (good - bad));
}

function scoreLabel(score01) {
  if (score01 >= 0.9) return 'excellent';
  if (score01 >= 0.75) return 'good';
  if (score01 >= 0.5) return 'fair';
  if (score01 >= 0.25) return 'poor';
  return 'bad';
}

function normalizeId(value, name = 'peerId') {
  if (value === undefined || value === null || value === '') {
    throw new RangeError(`${name} is required`);
  }
  return String(value);
}

function peerIdFor(peer, index = 0) {
  if (typeof peer === 'string' || typeof peer === 'number') return String(peer);
  return normalizeId(peer?.peerId ?? peer?.id ?? peer?.pub ?? peer?.publicKey ?? peer?.label ?? `peer-${index}`, 'peerId');
}

function peerRecord(peer, index = 0) {
  if (typeof peer === 'string' || typeof peer === 'number') {
    return { peerId: String(peer), id: String(peer) };
  }
  const id = peerIdFor(peer, index);
  return { ...peer, peerId: id, id };
}

function normalizePeerMap(peers = []) {
  if (!Array.isArray(peers)) {
    throw new TypeError('peers must be an array');
  }
  const peerMap = new Map();
  for (let i = 0; i < peers.length; i++) {
    const peer = peerRecord(peers[i], i);
    peerMap.set(peer.peerId, peer);
  }
  return peerMap;
}

function edgeEndpoint(edge, first) {
  if (Array.isArray(edge)) return edge[first ? 0 : 1];
  return first
    ? (edge?.source ?? edge?.from ?? edge?.a ?? edge?.left ?? edge?.peerA)
    : (edge?.target ?? edge?.to ?? edge?.b ?? edge?.right ?? edge?.peerB);
}

function normalizeGraph(options = {}) {
  const peerMap = normalizePeerMap(options.peers ?? []);
  const adjacency = new Map();
  const ensurePeer = (id) => {
    if (!peerMap.has(id)) peerMap.set(id, { peerId: id, id });
    if (!adjacency.has(id)) adjacency.set(id, new Set());
  };

  for (const id of peerMap.keys()) ensurePeer(id);

  const rawEdges = options.edges ?? options.links ?? [];
  if (!Array.isArray(rawEdges)) {
    throw new TypeError('edges must be an array');
  }

  const seen = new Set();
  const edges = [];
  let selfLoopCount = 0;
  let duplicateEdgeCount = 0;

  for (const edge of rawEdges) {
    const source = normalizeId(edgeEndpoint(edge, true), 'edge.source');
    const target = normalizeId(edgeEndpoint(edge, false), 'edge.target');
    ensurePeer(source);
    ensurePeer(target);
    if (source === target) {
      selfLoopCount++;
      continue;
    }
    const key = source < target ? `${source}\u0000${target}` : `${target}\u0000${source}`;
    if (seen.has(key)) {
      duplicateEdgeCount++;
      continue;
    }
    seen.add(key);
    edges.push({ source, target });
    adjacency.get(source).add(target);
    adjacency.get(target).add(source);
  }

  return {
    peerMap,
    peerIds: [...peerMap.keys()].sort(),
    adjacency,
    edges,
    edgeCount: edges.length,
    selfLoopCount,
    duplicateEdgeCount,
  };
}

function degreeEntries(peerIds, adjacency) {
  return peerIds.map((peerId) => Object.freeze({
    peerId,
    degree: adjacency.get(peerId)?.size ?? 0,
  }));
}

function connectedComponents(peerIds, adjacency) {
  const visited = new Set();
  const components = [];
  for (const start of peerIds) {
    if (visited.has(start)) continue;
    const peers = [];
    const queue = [start];
    visited.add(start);
    for (let i = 0; i < queue.length; i++) {
      const peerId = queue[i];
      peers.push(peerId);
      for (const next of adjacency.get(peerId) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    peers.sort();
    components.push(Object.freeze({ peers: Object.freeze(peers), size: peers.length }));
  }
  components.sort((a, b) => b.size - a.size || a.peers[0].localeCompare(b.peers[0]));
  return components.map((component, index) => Object.freeze({ componentId: index, ...component }));
}

function graphDensity(nodeCount, edgeCount) {
  if (nodeCount <= 1) return 0;
  return (2 * edgeCount) / (nodeCount * (nodeCount - 1));
}

export function meshGraphReport(options = {}) {
  const graph = normalizeGraph(options);
  const degrees = degreeEntries(graph.peerIds, graph.adjacency);
  const nodeCount = graph.peerIds.length;
  const totalDegree = degrees.reduce((sum, entry) => sum + entry.degree, 0);
  const components = connectedComponents(graph.peerIds, graph.adjacency);
  const largestComponentSize = components[0]?.size ?? 0;
  const isolatedPeers = degrees.filter((entry) => entry.degree === 0).map((entry) => entry.peerId);
  return {
    nodeCount,
    peerCount: nodeCount,
    edgeCount: graph.edgeCount,
    selfLoopCount: graph.selfLoopCount,
    duplicateEdgeCount: graph.duplicateEdgeCount,
    density: graphDensity(nodeCount, graph.edgeCount),
    averageDegree: nodeCount === 0 ? 0 : totalDegree / nodeCount,
    minDegree: nodeCount === 0 ? 0 : Math.min(...degrees.map((entry) => entry.degree)),
    maxDegree: nodeCount === 0 ? 0 : Math.max(...degrees.map((entry) => entry.degree)),
    degreeMap: Object.freeze(Object.fromEntries(degrees.map((entry) => [entry.peerId, entry.degree]))),
    degrees: Object.freeze(degrees),
    isolatedPeers: Object.freeze(isolatedPeers),
    components: Object.freeze(components),
    componentCount: components.length,
    largestComponentSize,
    largestComponentRatio: nodeCount === 0 ? 1 : largestComponentSize / nodeCount,
    connected: nodeCount <= 1 || components.length === 1,
    partitioned: nodeCount > 1 && components.length > 1,
  };
}

export function peerDegreeReport(options = {}) {
  const graph = meshGraphReport(options);
  return {
    nodeCount: graph.nodeCount,
    peerCount: graph.peerCount,
    edgeCount: graph.edgeCount,
    density: graph.density,
    averageDegree: graph.averageDegree,
    minDegree: graph.minDegree,
    maxDegree: graph.maxDegree,
    degreeMap: graph.degreeMap,
    degrees: graph.degrees,
    isolatedPeers: graph.isolatedPeers,
  };
}

export function partitionDetectionReport(options = {}) {
  const graph = meshGraphReport(options);
  return {
    nodeCount: graph.nodeCount,
    edgeCount: graph.edgeCount,
    connected: graph.connected,
    partitioned: graph.partitioned,
    componentCount: graph.componentCount,
    components: graph.components,
    largestComponentSize: graph.largestComponentSize,
    largestComponentRatio: graph.largestComponentRatio,
    isolatedPeers: graph.isolatedPeers,
  };
}

function integrityRatio(peer = {}) {
  const tier = peer.integrityTier ?? peer.tier ?? 'clean';
  const penalty = MESH_NEIGHBOR_TIER_PENALTY[tier] ?? 0;
  const trust = clamp01(optionalFinite(peer.integrityTrust ?? peer.trust, 'integrityTrust', 0));
  const social = optionalFinite(peer.socialModifier ?? peer.social, 'socialModifier', 0);
  return clamp01(1 - penalty + trust * 0.2 + social * 0.15);
}

export function meshLinkQualityScore(options = {}) {
  const latencyMs = optionalNonnegative(options.latencyMs ?? options.latency ?? options.rttMs, 'latencyMs', 100);
  const jitterMs = optionalNonnegative(options.jitterMs ?? options.avgJitterMs, 'jitterMs', 0);
  const deliveryRatio = options.deliveryRatio === undefined && options.lossRatio !== undefined
    ? clamp01(1 - boundedRatio(options.lossRatio, 'lossRatio', 0))
    : boundedRatio(options.deliveryRatio, 'deliveryRatio', 1);
  const throughputRatio = options.throughputRatio !== undefined
    ? boundedRatio(options.throughputRatio, 'throughputRatio', 1)
    : clamp01(optionalNonnegative(options.throughputBps ?? options.goodputBps, 'throughputBps', 1) / optionalPositive(options.targetThroughputBps, 'targetThroughputBps', 1));
  const stabilityRatio = boundedRatio(options.stabilityRatio ?? options.stability, 'stabilityRatio', 1);
  const integrity = options.integrityRatio === undefined
    ? integrityRatio(options)
    : boundedRatio(options.integrityRatio, 'integrityRatio', 1);
  const weights = { ...MESH_LINK_QUALITY_WEIGHTS, ...(options.weights ?? {}) };
  const subScores = Object.freeze({
    latency: inverseLerpClamped(latencyMs, optionalPositive(options.badLatencyMs, 'badLatencyMs', 500), optionalNonnegative(options.idealLatencyMs, 'idealLatencyMs', 30)),
    delivery: deliveryRatio,
    jitter: inverseLerpClamped(jitterMs, optionalPositive(options.badJitterMs, 'badJitterMs', 100), optionalNonnegative(options.idealJitterMs, 'idealJitterMs', 5)),
    throughput: throughputRatio,
    stability: stabilityRatio,
    integrity,
  });
  const weightSum = Object.values(weights).reduce((sum, value) => sum + nonnegativeNumber(value, 'weight'), 0) || 1;
  const qualityScore = clamp01(Object.entries(weights).reduce((sum, [name, weight]) => sum + (subScores[name] ?? 0) * weight, 0) / weightSum);
  return {
    peerId: options.peerId ?? options.id ?? null,
    latencyMs,
    jitterMs,
    qualityScore,
    score: Math.round(qualityScore * 1000),
    quality: scoreLabel(qualityScore),
    subScores,
    weights: Object.freeze({ ...weights }),
  };
}

export function peerNeighborScoreReport(peer = {}, options = {}) {
  const record = peerRecord(peer, 0);
  const latencyMs = optionalNonnegative(record.latencyMs ?? record.latency, 'latencyMs', 999);
  const reputationScore = clamp01(optionalNonnegative(record.score ?? record.reputationScore, 'reputationScore', 500) / 1000);
  const uptimeMs = optionalNonnegative(record.uptimeMs ?? record.uptime, 'uptimeMs', 0);
  const weights = { ...MESH_NEIGHBOR_SCORE_WEIGHTS, ...(options.weights ?? {}) };
  const subScores = Object.freeze({
    latency: inverseLerpClamped(latencyMs, optionalPositive(options.badLatencyMs, 'badLatencyMs', 500), optionalNonnegative(options.idealLatencyMs, 'idealLatencyMs', 10)),
    reputation: reputationScore,
    uptime: clamp01((uptimeMs / 60000) / optionalPositive(options.fullUptimeMinutes, 'fullUptimeMinutes', 30)),
    diversity: record.isSupernode ? 1 : boundedRatio(options.defaultDiversityScore, 'defaultDiversityScore', 0.5),
    integrity: integrityRatio(record),
  });
  const weightSum = Object.values(weights).reduce((sum, value) => sum + nonnegativeNumber(value, 'weight'), 0) || 1;
  const scoreRatio = clamp01(Object.entries(weights).reduce((sum, [name, weight]) => sum + (subScores[name] ?? 0) * weight, 0) / weightSum);
  const score = scoreRatio * 1000;
  return {
    peerId: record.peerId,
    score,
    neighborScore: score,
    scoreRatio,
    quality: scoreLabel(scoreRatio),
    subScores,
    weights: Object.freeze({ ...weights }),
  };
}

export function neighborSelectionReport(options = {}) {
  const peers = (options.peers ?? []).map((peer, index) => peerRecord(peer, index));
  const excludedPeerIds = new Set((options.excludePeerIds ?? []).map(String));
  if (options.selfPeerId !== undefined && options.selfPeerId !== null) excludedPeerIds.add(String(options.selfPeerId));
  const connectedPeerIds = new Set((options.connectedPeerIds ?? peers.filter((peer) => peer.isConnected).map((peer) => peer.peerId)).map(String));
  const includeFastPeers = options.includeFastPeers === true;
  const targetDegree = Math.max(0, Math.floor(optionalNonnegative(options.targetDegree ?? options.k ?? MESH_DEFAULT_IDEAL_DEGREE, 'targetDegree', MESH_DEFAULT_IDEAL_DEGREE)));
  const candidates = peers
    .filter((peer) => !excludedPeerIds.has(peer.peerId))
    .filter((peer) => includeFastPeers || !peer.isFastPeer)
    .map((peer) => ({ ...peer, neighborScoreReport: peerNeighborScoreReport(peer, options) }))
    .map((peer) => ({ ...peer, neighborScore: peer.neighborScoreReport.score }))
    .sort((a, b) => b.neighborScore - a.neighborScore || a.peerId.localeCompare(b.peerId));

  const selected = candidates.slice(0, Math.min(targetDegree, candidates.length));
  if (options.requireSupernode && !selected.some((peer) => peer.isSupernode)) {
    const bestSupernode = candidates.find((peer) => peer.isSupernode);
    if (bestSupernode && !selected.some((peer) => peer.peerId === bestSupernode.peerId)) {
      if (selected.length < targetDegree) {
        selected.push(bestSupernode);
      } else {
        const replaceIndex = [...selected].reverse().findIndex((peer) => !peer.isSupernode);
        if (replaceIndex >= 0) selected[selected.length - 1 - replaceIndex] = bestSupernode;
      }
    }
  }

  const selectedIds = new Set(selected.map((peer) => peer.peerId));
  const rejected = candidates.filter((peer) => !selectedIds.has(peer.peerId));
  return {
    targetDegree,
    candidateCount: candidates.length,
    selectedPeerIds: Object.freeze([...selectedIds]),
    selectedPeers: Object.freeze(selected.map((peer) => Object.freeze({
      peerId: peer.peerId,
      neighborScore: peer.neighborScore,
      isSupernode: !!peer.isSupernode,
      isConnected: !!peer.isConnected || connectedPeerIds.has(peer.peerId),
      subScores: peer.neighborScoreReport.subScores,
    }))),
    rejectedPeers: Object.freeze(rejected.map((peer) => Object.freeze({
      peerId: peer.peerId,
      neighborScore: peer.neighborScore,
      isSupernode: !!peer.isSupernode,
    }))),
    connectPeerIds: Object.freeze(selected.filter((peer) => !connectedPeerIds.has(peer.peerId)).map((peer) => peer.peerId)),
    disconnectPeerIds: Object.freeze([...connectedPeerIds].filter((peerId) => !selectedIds.has(peerId))),
  };
}

export function supernodeScoreReport(options = {}) {
  const tier = options.tier ?? options.integrityTier ?? 'clean';
  const tierMultiplier = MESH_SUPERNODE_TIER_MULTIPLIER[tier] ?? 0;
  const baseScore = optionalNonnegative(options.score ?? options.selfScore ?? options.reputationScore, 'score', 0);
  const latencyMs = optionalNonnegative(options.latencyMs ?? options.selfLatencyAvg ?? options.rttMs, 'latencyMs', 999);
  const trust = clamp01(optionalFinite(options.trust ?? options.integrityTrust, 'trust', 0));
  const socialModifier = optionalFinite(options.socialModifier ?? options.social, 'socialModifier', 0);
  const threshold = optionalPositive(options.threshold ?? options.supernodeScoreThreshold, 'threshold', MESH_SUPERNODE_SCORE);
  const latencyBonus = Math.max(0, 1 - latencyMs / 200) * 200;
  const trustBonus = trust * 100;
  const socialBonus = Math.max(0, socialModifier) * 50;
  const rawScore = baseScore + latencyBonus + trustBonus + socialBonus;
  const blockedByTier = tierMultiplier === 0;
  const blockedByBaseScore = baseScore < threshold;
  const supernodeScore = blockedByTier || blockedByBaseScore ? 0 : rawScore * tierMultiplier;
  return {
    tier,
    tierMultiplier,
    baseScore,
    latencyMs,
    latencyBonus,
    trust,
    trustBonus,
    socialModifier,
    socialBonus,
    rawScore,
    supernodeScore,
    threshold,
    eligible: supernodeScore >= threshold,
    blockedByTier,
    blockedByBaseScore,
  };
}

export function relaySelectionReport(options = {}) {
  const peers = (options.peers ?? []).map((peer, index) => peerRecord(peer, index));
  const maxRelays = Math.max(0, Math.floor(optionalNonnegative(options.maxRelays ?? options.count ?? MESH_GOSSIP_MIN_LAZY, 'maxRelays', MESH_GOSSIP_MIN_LAZY)));
  const excludedPeerIds = new Set((options.excludePeerIds ?? []).map(String));
  const preferredPeerIds = new Set((options.preferredPeerIds ?? []).map(String));
  const scoredRelays = peers
    .filter((peer) => !excludedPeerIds.has(peer.peerId))
    .map((peer) => {
      const linkQuality = peer.linkQualityScore ?? peer.qualityScore ?? meshLinkQualityScore(peer).qualityScore;
      const reputation = clamp01(optionalNonnegative(peer.score ?? peer.reputationScore, 'reputationScore', 500) / 1000);
      const capacityRatio = peer.relayCapacity !== undefined
        ? boundedRatio(peer.relayCapacity, 'relayCapacity', 0.5)
        : clamp01(1 - optionalNonnegative(peer.load ?? 0, 'load', 0) / optionalPositive(peer.capacity ?? peer.cap, 'capacity', 1));
      const supernodeBonus = peer.isSupernode || peer.canRelay ? 1 : 0;
      const trust = clamp01(optionalFinite(peer.integrityTrust ?? peer.trust, 'trust', 0));
      const localBonus = peer.local || peer.isLocal ? 0.05 : 0;
      const preferredBonus = preferredPeerIds.has(peer.peerId) ? 0.1 : 0;
      const scoreRatio = clamp01(
        linkQuality * 0.35 +
        reputation * 0.25 +
        capacityRatio * 0.20 +
        supernodeBonus * 0.10 +
        trust * 0.10 +
        localBonus +
        preferredBonus,
      );
      return {
        peerId: peer.peerId,
        relayScore: scoreRatio * 1000,
        scoreRatio,
        quality: scoreLabel(scoreRatio),
        linkQuality,
        reputation,
        capacityRatio,
        isSupernode: !!peer.isSupernode,
        canRelay: !!peer.canRelay,
      };
    })
    .sort((a, b) => b.relayScore - a.relayScore || a.peerId.localeCompare(b.peerId));
  return {
    maxRelays,
    selectedRelayIds: Object.freeze(scoredRelays.slice(0, maxRelays).map((relay) => relay.peerId)),
    selectedRelays: Object.freeze(scoredRelays.slice(0, maxRelays).map(Object.freeze)),
    rankedRelays: Object.freeze(scoredRelays.map(Object.freeze)),
  };
}

export function nearestPeerReport(options = {}) {
  const peers = (options.peers ?? []).map((peer, index) => peerRecord(peer, index));
  const excludedPeerIds = new Set((options.excludePeerIds ?? []).map(String));
  const maxPeers = Math.max(0, Math.floor(optionalNonnegative(options.maxPeers ?? options.count ?? 1, 'maxPeers', 1)));
  const maxDistance = optionalPositive(options.maxDistance ?? options.badDistance ?? 1000, 'maxDistance', 1000);
  const rankedPeers = peers
    .filter((peer) => !excludedPeerIds.has(peer.peerId))
    .map((peer) => {
      const latencyMs = optionalNonnegative(peer.latencyMs ?? peer.latency ?? peer.rttMs, 'latencyMs', 999);
      const latencyScore = inverseLerpClamped(latencyMs, optionalPositive(options.badLatencyMs, 'badLatencyMs', 500), optionalNonnegative(options.idealLatencyMs, 'idealLatencyMs', 10));
      const hasDistance = peer.distance !== undefined || peer.distanceMeters !== undefined;
      const distance = hasDistance ? optionalNonnegative(peer.distance ?? peer.distanceMeters, 'distance', 0) : null;
      const distanceScore = hasDistance ? inverseLerpClamped(distance, maxDistance, 0) : latencyScore;
      const scoreRatio = clamp01((latencyScore + distanceScore) / 2);
      return {
        peerId: peer.peerId,
        latencyMs,
        distance,
        nearestScore: scoreRatio * 1000,
        scoreRatio,
      };
    })
    .sort((a, b) => b.nearestScore - a.nearestScore || a.peerId.localeCompare(b.peerId));
  return {
    nearestPeer: rankedPeers[0] ?? null,
    selectedPeerIds: Object.freeze(rankedPeers.slice(0, maxPeers).map((peer) => peer.peerId)),
    selectedPeers: Object.freeze(rankedPeers.slice(0, maxPeers).map(Object.freeze)),
    rankedPeers: Object.freeze(rankedPeers.map(Object.freeze)),
  };
}

export function gossipFanoutReport(options = {}) {
  const eligiblePeerCount = Math.max(0, Math.floor(optionalNonnegative(options.eligiblePeerCount ?? options.peerCount ?? options.peers?.length ?? 0, 'eligiblePeerCount', 0)));
  const gossipFactor = boundedRatio(options.gossipFactor ?? options.factor, 'gossipFactor', MESH_GOSSIP_FACTOR);
  const minLazy = Math.max(0, Math.floor(optionalNonnegative(options.minLazy ?? options.minFanout, 'minLazy', MESH_GOSSIP_MIN_LAZY)));
  const rounds = Math.max(0, Math.floor(optionalNonnegative(options.rounds, 'rounds', MESH_GOSSIP_ROUNDS)));
  const proportionalFanout = Math.ceil(eligiblePeerCount * gossipFactor);
  const fanout = eligiblePeerCount === 0 ? 0 : Math.min(eligiblePeerCount, Math.max(Math.min(minLazy, eligiblePeerCount), proportionalFanout));
  const selectionProbability = eligiblePeerCount === 0 ? 0 : fanout / eligiblePeerCount;
  const coverageProbability = rounds === 0 ? 0 : 1 - ((1 - selectionProbability) ** rounds);
  return {
    eligiblePeerCount,
    gossipFactor,
    minLazy,
    rounds,
    proportionalFanout,
    fanout,
    selectionProbability,
    coverageProbability,
    expectedTransmissions: fanout * rounds,
  };
}

function bfsPath(adjacency, sourcePeerId, targetPeerId) {
  const queue = [sourcePeerId];
  const previous = new Map([[sourcePeerId, null]]);
  for (let i = 0; i < queue.length; i++) {
    const peerId = queue[i];
    if (peerId === targetPeerId) break;
    for (const next of adjacency.get(peerId) ?? []) {
      if (previous.has(next)) continue;
      previous.set(next, peerId);
      queue.push(next);
    }
  }
  if (!previous.has(targetPeerId)) return [];
  const path = [];
  for (let at = targetPeerId; at !== null; at = previous.get(at)) path.push(at);
  path.reverse();
  return path;
}

function cloneAdjacency(adjacency) {
  const clone = new Map();
  for (const [peerId, neighbors] of adjacency) clone.set(peerId, new Set(neighbors));
  return clone;
}

function removePathEdges(adjacency, path) {
  for (let i = 0; i < path.length - 1; i++) {
    adjacency.get(path[i])?.delete(path[i + 1]);
    adjacency.get(path[i + 1])?.delete(path[i]);
  }
}

export function redundantPathReport(options = {}) {
  const sourcePeerId = normalizeId(options.sourcePeerId ?? options.source ?? options.from, 'sourcePeerId');
  const targetPeerId = normalizeId(options.targetPeerId ?? options.target ?? options.to, 'targetPeerId');
  const maxPaths = Math.max(1, Math.floor(optionalPositive(options.maxPaths, 'maxPaths', 4)));
  const graph = normalizeGraph(options);
  const working = cloneAdjacency(graph.adjacency);
  const paths = [];
  for (let i = 0; i < maxPaths; i++) {
    const path = bfsPath(working, sourcePeerId, targetPeerId);
    if (path.length === 0) break;
    paths.push(Object.freeze(path));
    removePathEdges(working, path);
  }
  return {
    sourcePeerId,
    targetPeerId,
    pathCount: paths.length,
    redundant: paths.length >= 2,
    shortestPath: paths[0] ?? Object.freeze([]),
    paths: Object.freeze(paths),
    edgeDisjointPathLimit: maxPaths,
  };
}

export function meshHealthReport(options = {}) {
  const graph = meshGraphReport(options);
  const targetDegree = optionalPositive(options.targetDegree ?? options.k ?? MESH_DEFAULT_IDEAL_DEGREE, 'targetDegree', MESH_DEFAULT_IDEAL_DEGREE);
  const targetDensity = graph.nodeCount <= 1 ? 0 : Math.min(1, targetDegree / (graph.nodeCount - 1));
  const degreeScore = targetDegree === 0 ? 1 : clamp01(graph.averageDegree / targetDegree);
  const densityScore = targetDensity === 0 ? (graph.edgeCount === 0 ? 1 : 0) : clamp01(graph.density / targetDensity);
  const isolationScore = graph.nodeCount === 0 ? 1 : clamp01(1 - graph.isolatedPeers.length / graph.nodeCount);
  const linkScores = (options.linkQualityScores ?? (options.peers ?? []).map((peer) => meshLinkQualityScore(peer).qualityScore))
    .map((score) => clamp01(finiteNumber(score, 'linkQualityScore')));
  const linkQualityScore = linkScores.length === 0 ? 1 : statsMean(linkScores);
  const connectivityScore = graph.largestComponentRatio;
  const rawScore = clamp01(
    connectivityScore * 0.30 +
    degreeScore * 0.20 +
    densityScore * 0.15 +
    isolationScore * 0.15 +
    linkQualityScore * 0.20,
  );
  const healthScore = graph.partitioned ? rawScore * graph.largestComponentRatio : rawScore;
  return {
    healthScore,
    score: Math.round(healthScore * 1000),
    health: scoreLabel(healthScore),
    graph,
    targetDegree,
    targetDensity,
    connectivityScore,
    degreeScore,
    densityScore,
    isolationScore,
    linkQualityScore,
    partitionPenaltyApplied: graph.partitioned,
  };
}

export function topologyModeReport(options = {}) {
  const peerCount = Math.max(0, Math.floor(optionalNonnegative(options.peerCount ?? options.peers?.length ?? 0, 'peerCount', 0)));
  const fullMeshCeiling = Math.max(0, Math.floor(optionalNonnegative(options.fullMeshCeiling, 'fullMeshCeiling', MESH_FULL_MESH_CEILING)));
  const supernodeThreshold = Math.max(1, Math.floor(optionalPositive(options.supernodeThreshold, 'supernodeThreshold', MESH_SUPERNODE_THRESHOLD)));
  const defaultDegree = Math.max(MESH_MIN_DEGREE, Math.floor(optionalPositive(options.defaultDegree ?? options.k, 'defaultDegree', MESH_DEFAULT_IDEAL_DEGREE)));
  const supernodeDegree = Math.max(defaultDegree, Math.floor(optionalPositive(options.supernodeDegree ?? options.kSupernode, 'supernodeDegree', MESH_SUPERNODE_DEGREE)));
  const isSupernode = options.isSupernode === true;
  const mode = peerCount <= fullMeshCeiling ? 'full_mesh' : (peerCount >= supernodeThreshold ? 'supernode' : 'partial_mesh');
  const targetDegree = mode === 'full_mesh'
    ? Math.max(0, peerCount - 1)
    : Math.min(peerCount, isSupernode ? supernodeDegree : defaultDegree);
  return {
    peerCount,
    mode,
    fullMeshCeiling,
    supernodeThreshold,
    defaultDegree,
    supernodeDegree,
    isSupernode,
    targetDegree,
    expectedEdgeCount: mode === 'full_mesh'
      ? (peerCount * Math.max(0, peerCount - 1)) / 2
      : Math.ceil((peerCount * targetDegree) / 2),
  };
}
