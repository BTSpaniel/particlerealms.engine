// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  canonicalParticleStrings,
  deepFreezeParticleContract,
  particleFinite,
  particleIdentifier,
  particleRecord,
  particleRevision,
} from './ParticleRepresentationContracts.js';
import { sha256Hex } from '../../../matter/fabric/FabricSupport.js';

export const PARTICLE_PRESENTATION_SOURCE_STAMP_SCHEMA =
  'engine.morphfield.particle-presentation-source-stamp';
export const PARTICLE_PRESENTATION_SOURCE_STAMP_VERSION = '1.0.0';

const SHA256_FINGERPRINT = /^sha256:[0-9a-f]{64}$/;

function revisionKey(value) {
  return `${typeof value}:${String(value)}`;
}

function memberListFingerprint(sourceId, topologyRevision, memberIds) {
  const chunks = [];
  for (let start = 0; start < memberIds.length; start += 2048) {
    chunks.push(sha256Hex(JSON.stringify(memberIds.slice(start, start + 2048))));
  }
  return `sha256:${sha256Hex(JSON.stringify({
    sourceId,
    topologyRevision: revisionKey(topologyRevision),
    memberCount: memberIds.length,
    chunks,
  }))}`;
}

function membershipFingerprint(source, sourceId, topologyRevision) {
  if (source.membershipFingerprint != null) {
    const fingerprint = particleIdentifier(
      source.membershipFingerprint,
      'sourceStamp.membershipFingerprint',
    );
    if (!SHA256_FINGERPRINT.test(fingerprint)) {
      throw new TypeError('sourceStamp.membershipFingerprint must be a SHA-256 content id');
    }
    return fingerprint;
  }
  if (source.memberIds != null) {
    const memberIds = canonicalParticleStrings(source.memberIds, 'sourceStamp.memberIds');
    return memberListFingerprint(sourceId, topologyRevision, memberIds);
  }
  throw new TypeError(
    'sourceStamp.membershipFingerprint or sourceStamp.memberIds is required',
  );
}

/**
 * Identity shared by adaptive presentation pipelines. topologyRevision and the
 * membership fingerprint describe semantic population identity. stateSampleId
 * identifies only a telemetry/readback observation and must never reset a
 * cohort by itself.
 */
export function createParticlePresentationSourceStamp(input) {
  const source = particleRecord(input, 'sourceStamp');
  const sourceId = particleIdentifier(source.sourceId, 'sourceStamp.sourceId');
  const topologyRevision = particleRevision(
    source.topologyRevision,
    'sourceStamp.topologyRevision',
  );
  const stateSampleId = particleRevision(
    source.stateSampleId,
    'sourceStamp.stateSampleId',
  );
  const sampledAtSeconds = particleFinite(
    source.sampledAtSeconds,
    'sourceStamp.sampledAtSeconds',
  );
  const fingerprint = membershipFingerprint(source, sourceId, topologyRevision);
  const topologyKey = `sha256:${sha256Hex(JSON.stringify({
    sourceId,
    topologyRevision: revisionKey(topologyRevision),
    membershipFingerprint: fingerprint,
  }))}`;
  const sampleKey = `sha256:${sha256Hex(JSON.stringify({
    topologyKey,
    stateSampleId: revisionKey(stateSampleId),
    sampledAtSeconds,
  }))}`;
  return deepFreezeParticleContract({
    schema: PARTICLE_PRESENTATION_SOURCE_STAMP_SCHEMA,
    schemaVersion: PARTICLE_PRESENTATION_SOURCE_STAMP_VERSION,
    sourceId,
    topologyRevision,
    stateSampleId,
    sampledAtSeconds,
    membershipFingerprint: fingerprint,
    topologyKey,
    sampleKey,
    authority: {
      topologyRevisionControlsMembership: true,
      stateSampleIdIsTelemetryOnly: true,
      grantsSimulationAuthority: false,
    },
  });
}

export function validateParticlePresentationSourceStamp(input) {
  const source = particleRecord(input, 'sourceStamp');
  if (source.schema !== PARTICLE_PRESENTATION_SOURCE_STAMP_SCHEMA
      || source.schemaVersion !== PARTICLE_PRESENTATION_SOURCE_STAMP_VERSION) {
    throw new Error('Unsupported particle presentation source stamp schema or version');
  }
  const normalized = createParticlePresentationSourceStamp(source);
  if (source.topologyKey !== normalized.topologyKey
      || source.sampleKey !== normalized.sampleKey) {
    throw new Error('Particle presentation source stamp fingerprint mismatch');
  }
  if (source.authority?.topologyRevisionControlsMembership !== true
      || source.authority?.stateSampleIdIsTelemetryOnly !== true
      || source.authority?.grantsSimulationAuthority !== false) {
    throw new Error('Particle presentation source stamp authority contract is inconsistent');
  }
  return normalized;
}

export function compareParticlePresentationSourceStamps(leftInput, rightInput) {
  const left = validateParticlePresentationSourceStamp(leftInput);
  const right = validateParticlePresentationSourceStamp(rightInput);
  const reasonCodes = [];
  if (left.sourceId !== right.sourceId) reasonCodes.push('source-id-changed');
  if (revisionKey(left.topologyRevision) !== revisionKey(right.topologyRevision)) {
    reasonCodes.push('topology-revision-changed');
  }
  if (left.membershipFingerprint !== right.membershipFingerprint) {
    reasonCodes.push('membership-changed');
  }
  const sameTopology = reasonCodes.length === 0;
  const sameStateSample = sameTopology
    && revisionKey(left.stateSampleId) === revisionKey(right.stateSampleId)
    && left.sampledAtSeconds === right.sampledAtSeconds;
  return deepFreezeParticleContract({
    sameTopology,
    sameStateSample,
    topologyChanged: !sameTopology,
    telemetryChanged: sameTopology && !sameStateSample,
    reasonCodes,
    leftTopologyKey: left.topologyKey,
    rightTopologyKey: right.topologyKey,
    leftSampleKey: left.sampleKey,
    rightSampleKey: right.sampleKey,
  });
}

export function sameParticlePresentationTopology(left, right) {
  return compareParticlePresentationSourceStamps(left, right).sameTopology;
}

export function sameParticlePresentationStateSample(left, right) {
  return compareParticlePresentationSourceStamps(left, right).sameStateSample;
}

export function advanceParticlePresentationStateSample(stampInput, {
  stateSampleId,
  sampledAtSeconds,
} = {}) {
  const stamp = validateParticlePresentationSourceStamp(stampInput);
  return createParticlePresentationSourceStamp({
    sourceId: stamp.sourceId,
    topologyRevision: stamp.topologyRevision,
    stateSampleId,
    sampledAtSeconds,
    membershipFingerprint: stamp.membershipFingerprint,
  });
}

export default createParticlePresentationSourceStamp;
