// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { fibonacciSphere } from '../../../core/math/MathRandom.js';
import {
  vec3Cross,
  vec3Dot,
  vec3Normalize,
} from '../../../core/math/MathVec3.js';
import { computeParticleCohortMoments } from './ParticleCohortPlanner.js';
import {
  liftParticleProxySample,
  normalizeParticleProxyDescriptor,
  PARTICLE_PROXY_GPU_DESCRIPTOR_BYTES,
} from './ParticleProxyDescriptor.js';
import {
  deepFreezeParticleContract,
  particleFinite,
  particleFingerprint,
  particleIdentifier,
  particleInteger,
  particleMagnitude,
  particleRecord,
  particleRelativeError,
  particleRevision,
  particleVec3,
  particleVectorDistance,
} from './ParticleRepresentationContracts.js';

export const PARTICLE_PROJECTION_CERTIFICATE_SCHEMA = 'engine.morphfield.particle-projection-certificate';
export const PARTICLE_PROJECTION_CERTIFICATE_VERSION = '1.0.0';
export const PARTICLE_PROJECTION_COMPARISON_SCHEMA = 'engine.morphfield.particle-projection-comparison';
export const PARTICLE_PROJECTION_COMPARISON_VERSION = '1.0.0';

export const PARTICLE_PROJECTION_DEFAULT_LIMITS = deepFreezeParticleContract({
  physical: {
    massRelative: 0.001,
    linearMomentumRelative: 0.01,
    kineticEnergyRelative: 0.05,
    densityRelative: 0.05,
    rmsRadiusM: 0.025,
  },
  visual: {
    projectedAreaRelative: 0.08,
    projectedCentroidM: 0.025,
    depthRangeM: 0.05,
  },
  temporal: {
    captureDeltaSeconds: 1 / 120,
    maximumAgeSeconds: 0.25,
  },
  memory: {
    maximumEncodedRatio: 1,
  },
});

const EPSILON = 1e-12;

function projectionBasis(direction) {
  const helper = Math.abs(direction[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const axisU = vec3Normalize(vec3Cross(helper, direction));
  const axisV = vec3Normalize(vec3Cross(direction, axisU));
  return { axisU, axisV };
}

/** Deterministic equal-area directions with stable tangent frames. */
export function createEqualAreaProjectionDirections(count = 16, options = {}) {
  const directionCount = particleInteger(count, 'count', { minimum: 4, maximum: 1024 });
  const rotationRad = particleFinite(options.rotationRad ?? 0, 'options.rotationRad');
  const directions = [];
  for (let index = 0; index < directionCount; index++) {
    const direction = fibonacciSphere(index, directionCount, rotationRad);
    const basis = projectionBasis(direction);
    directions.push({
      id: `equal-area.${directionCount}.${index}`,
      index,
      direction,
      axisU: basis.axisU,
      axisV: basis.axisV,
      solidAngleSteradians: 4 * Math.PI / directionCount,
    });
  }
  return deepFreezeParticleContract({
    schema: 'engine.morphfield.equal-area-directions',
    schemaVersion: '1.0.0',
    count: directionCount,
    rotationRad,
    fingerprint: particleFingerprint(directions.map(entry => entry.direction)),
    directions,
  });
}

function sampleRadius(sample, index, defaultRadiusM) {
  return particleFinite(sample?.radiusM ?? defaultRadiusM, `samples[${index}].radiusM`, {
    minimum: 0,
  });
}

function cross2(origin, left, right) {
  return (left[0] - origin[0]) * (right[1] - origin[1])
    - (left[1] - origin[1]) * (right[0] - origin[0]);
}

function convexHull(points) {
  if (points.length <= 1) return [...points];
  const sorted = [...points].sort((left, right) => (
    left[0] - right[0] || left[1] - right[1]
  ));
  const unique = sorted.filter((point, index) => (
    index === 0 || point[0] !== sorted[index - 1][0] || point[1] !== sorted[index - 1][1]
  ));
  if (unique.length <= 2) return unique;
  const lower = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross2(lower.at(-2), lower.at(-1), point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let index = unique.length - 1; index >= 0; index--) {
    const point = unique[index];
    while (upper.length >= 2 && cross2(upper.at(-2), upper.at(-1), point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function polygonAreaAndPerimeter(points) {
  if (points.length <= 1) return { area: 0, perimeter: 0 };
  if (points.length === 2) {
    return { area: 0, perimeter: 2 * Math.hypot(
      points[1][0] - points[0][0],
      points[1][1] - points[0][1],
    ) };
  }
  let doubledArea = 0;
  let perimeter = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    doubledArea += current[0] * next[1] - current[1] * next[0];
    perimeter += Math.hypot(next[0] - current[0], next[1] - current[1]);
  }
  return { area: Math.abs(doubledArea) * 0.5, perimeter };
}

function projectionForDirection(samples, direction) {
  const points = [];
  let weightedU = 0;
  let weightedV = 0;
  let totalMassKg = 0;
  let minimumDepthM = Number.POSITIVE_INFINITY;
  let maximumDepthM = Number.NEGATIVE_INFINITY;
  let maximumRadiusM = 0;
  for (const sample of samples) {
    const u = vec3Dot(sample.positionM, direction.axisU);
    const v = vec3Dot(sample.positionM, direction.axisV);
    const depth = vec3Dot(sample.positionM, direction.direction);
    points.push([u, v]);
    weightedU += u * sample.massKg;
    weightedV += v * sample.massKg;
    totalMassKg += sample.massKg;
    minimumDepthM = Math.min(minimumDepthM, depth - sample.radiusM);
    maximumDepthM = Math.max(maximumDepthM, depth + sample.radiusM);
    maximumRadiusM = Math.max(maximumRadiusM, sample.radiusM);
  }
  const hull = convexHull(points);
  const geometry = polygonAreaAndPerimeter(hull);
  const projectedAreaM2 = geometry.area
    + geometry.perimeter * maximumRadiusM
    + Math.PI * maximumRadiusM * maximumRadiusM;
  return {
    directionId: direction.id,
    direction: direction.direction,
    projectedAreaM2,
    projectedCentroidM: [weightedU / totalMassKg, weightedV / totalMassKg],
    depthRangeM: maximumDepthM - minimumDepthM,
    minimumDepthM,
    maximumDepthM,
    hullVertexCount: hull.length,
    supportRadiusM: maximumRadiusM,
  };
}

function normalizeSamples(samples, options) {
  if (!Array.isArray(samples) && !ArrayBuffer.isView(samples)) {
    throw new TypeError('samples must be array-like');
  }
  if (samples.length === 0) throw new RangeError('samples cannot be empty');
  const defaultMassKg = particleFinite(options.defaultMassKg ?? 1, 'options.defaultMassKg', {
    minimum: Number.MIN_VALUE,
  });
  const defaultRadiusM = particleFinite(options.defaultRadiusM ?? 0, 'options.defaultRadiusM', {
    minimum: 0,
  });
  return Array.from(samples, (sample, index) => ({
    positionM: particleVec3(sample?.positionM ?? sample?.position, `samples[${index}].positionM`),
    velocityMPerS: particleVec3(
      sample?.velocityMPerS ?? sample?.velocity,
      `samples[${index}].velocityMPerS`,
      [0, 0, 0],
    ),
    massKg: particleFinite(sample?.massKg ?? defaultMassKg, `samples[${index}].massKg`, {
      minimum: Number.MIN_VALUE,
    }),
    radiusM: sampleRadius(sample, index, defaultRadiusM),
  }));
}

function projectionIdentity(projection) {
  return {
    directionId: projection.directionId,
    direction: projection.direction,
    projectedAreaM2: projection.projectedAreaM2,
    projectedCentroidM: projection.projectedCentroidM,
    depthRangeM: projection.depthRangeM,
    minimumDepthM: projection.minimumDepthM,
    maximumDepthM: projection.maximumDepthM,
    hullVertexCount: projection.hullVertexCount,
    supportRadiusM: projection.supportRadiusM,
  };
}

function finiteCertificateProjection(input, index, expectedDirection) {
  const projection = particleRecord(input, `certificate.projections[${index}]`);
  const centroid = projection.projectedCentroidM;
  if ((!Array.isArray(centroid) && !ArrayBuffer.isView(centroid)) || centroid.length < 2) {
    throw new TypeError(`certificate.projections[${index}].projectedCentroidM requires two values`);
  }
  const direction = particleVec3(
    projection.direction,
    `certificate.projections[${index}].direction`,
  );
  if (particleVectorDistance(direction, expectedDirection.direction) > 1e-6) {
    throw new Error(`certificate.projections[${index}].direction does not match its direction set`);
  }
  const minimumDepthM = particleFinite(
    projection.minimumDepthM,
    `certificate.projections[${index}].minimumDepthM`,
  );
  const maximumDepthM = particleFinite(
    projection.maximumDepthM,
    `certificate.projections[${index}].maximumDepthM`,
  );
  const depthRangeM = particleFinite(
    projection.depthRangeM,
    `certificate.projections[${index}].depthRangeM`,
    { minimum: 0 },
  );
  if (maximumDepthM < minimumDepthM
      || Math.abs(depthRangeM - (maximumDepthM - minimumDepthM)) > EPSILON) {
    throw new Error(`certificate.projections[${index}] has inconsistent depth bounds`);
  }
  return projectionIdentity({
    directionId: particleIdentifier(projection.directionId, `certificate.projections[${index}].directionId`),
    direction,
    projectedAreaM2: particleFinite(
      projection.projectedAreaM2,
      `certificate.projections[${index}].projectedAreaM2`,
      { minimum: 0 },
    ),
    projectedCentroidM: [
      particleFinite(centroid[0], `certificate.projections[${index}].projectedCentroidM[0]`),
      particleFinite(centroid[1], `certificate.projections[${index}].projectedCentroidM[1]`),
    ],
    depthRangeM,
    minimumDepthM,
    maximumDepthM,
    hullVertexCount: particleInteger(
      projection.hullVertexCount,
      `certificate.projections[${index}].hullVertexCount`,
      { minimum: 1, maximum: 0xffffffff },
    ),
    supportRadiusM: particleFinite(
      projection.supportRadiusM,
      `certificate.projections[${index}].supportRadiusM`,
      { minimum: 0 },
    ),
  });
}

function validateEqualAreaDirectionSet(input) {
  const directionSet = particleRecord(input, 'certificate.directionSet');
  if (directionSet.schema !== 'engine.morphfield.equal-area-directions'
      || directionSet.schemaVersion !== '1.0.0') {
    throw new Error('Unsupported equal-area direction schema or version');
  }
  const count = particleInteger(directionSet.count, 'certificate.directionSet.count', {
    minimum: 4,
    maximum: 1024,
  });
  const rotationRad = particleFinite(
    directionSet.rotationRad,
    'certificate.directionSet.rotationRad',
  );
  const fingerprint = particleIdentifier(
    directionSet.fingerprint,
    'certificate.directionSet.fingerprint',
  );
  if (!Array.isArray(directionSet.directions) || directionSet.directions.length !== count) {
    throw new Error('Equal-area direction count does not match its direction array');
  }
  const canonicalDirectionSet = createEqualAreaProjectionDirections(count, { rotationRad });
  const normalizedDirections = directionSet.directions.map((entry, index) => {
    const direction = particleRecord(entry, `certificate.directionSet.directions[${index}]`);
    const vector = particleVec3(
      direction.direction,
      `certificate.directionSet.directions[${index}].direction`,
    );
    const axisU = particleVec3(direction.axisU, `certificate.directionSet.directions[${index}].axisU`);
    const axisV = particleVec3(direction.axisV, `certificate.directionSet.directions[${index}].axisV`);
    const solidAngleSteradians = particleFinite(
      direction.solidAngleSteradians,
      `certificate.directionSet.directions[${index}].solidAngleSteradians`,
      { minimum: Number.MIN_VALUE },
    );
    if (particleInteger(direction.index, `certificate.directionSet.directions[${index}].index`, {
      maximum: count - 1,
    }) !== index) {
      throw new Error('Equal-area direction indices must be contiguous and ordered');
    }
    const tolerance = 1e-6;
    if (Math.abs(particleMagnitude(vector) - 1) > tolerance
        || Math.abs(particleMagnitude(axisU) - 1) > tolerance
        || Math.abs(particleMagnitude(axisV) - 1) > tolerance
        || Math.abs(vec3Dot(vector, axisU)) > tolerance
        || Math.abs(vec3Dot(vector, axisV)) > tolerance
        || Math.abs(vec3Dot(axisU, axisV)) > tolerance
        || vec3Dot(vec3Cross(axisU, axisV), vector) < 1 - tolerance) {
      throw new Error('Equal-area direction frame is not right-handed and orthonormal');
    }
    const expected = canonicalDirectionSet.directions[index];
    if (particleVectorDistance(vector, expected.direction) > tolerance
        || particleVectorDistance(axisU, expected.axisU) > tolerance
        || particleVectorDistance(axisV, expected.axisV) > tolerance) {
      throw new Error('Equal-area direction does not match its deterministic sequence');
    }
    if (Math.abs(solidAngleSteradians - 4 * Math.PI / count) > 1e-9) {
      throw new Error('Equal-area direction has an inconsistent solid angle');
    }
    const id = particleIdentifier(
      direction.id,
      `certificate.directionSet.directions[${index}].id`,
    );
    if (id !== expected.id) {
      throw new Error('Equal-area direction id does not match its deterministic sequence');
    }
    return {
      id,
      direction: vector,
    };
  });
  const ids = new Set(normalizedDirections.map(direction => direction.id));
  if (ids.size !== count) throw new Error('Equal-area direction ids must be unique');
  const expectedFingerprint = canonicalDirectionSet.fingerprint;
  if (fingerprint !== expectedFingerprint
      || particleFingerprint(normalizedDirections.map(entry => entry.direction)) !== fingerprint) {
    throw new Error('Equal-area direction fingerprint does not match its vectors');
  }
  return { count, fingerprint, normalizedDirections, canonicalDirectionSet };
}

/** Capture physical and multi-view visual evidence from one bounded state. */
export function createParticleProjectionCertificate(samplesInput, options = {}) {
  const samples = normalizeSamples(samplesInput, options);
  const moments = computeParticleCohortMoments(samples);
  const directions = createEqualAreaProjectionDirections(options.directionCount ?? 16, {
    rotationRad: options.rotationRad ?? 0,
  });
  const projections = directions.directions.map(direction => projectionForDirection(samples, direction));
  const maximumRadiusM = samples.reduce((maximum, sample) => Math.max(maximum, sample.radiusM), 0);
  const ellipsoidRadii = moments.principalVariancesM2.map(variance => (
    Math.max(maximumRadiusM, Math.sqrt(variance) * 2, 1e-9)
  ));
  const equivalentVolumeM3 = (4 / 3) * Math.PI
    * ellipsoidRadii[0] * ellipsoidRadii[1] * ellipsoidRadii[2];
  const logicalByteLength = particleInteger(
    options.logicalByteLength ?? samples.length * 32,
    'options.logicalByteLength',
    { minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
  );
  const encodedByteLength = particleInteger(
    options.encodedByteLength ?? logicalByteLength,
    'options.encodedByteLength',
    { minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
  );
  const captureTimeSeconds = particleFinite(
    options.captureTimeSeconds ?? 0,
    'options.captureTimeSeconds',
  );
  const sourceRevision = particleRevision(options.sourceRevision ?? 0, 'options.sourceRevision');
  const summary = {
    physical: {
      massKg: moments.totalMassKg,
      linearMomentumKgMPerS: moments.linearMomentumKgMPerS,
      kineticEnergyJ: moments.kineticEnergyJ,
      densityKgPerM3: options.densityKgPerM3 == null
        ? moments.totalMassKg / equivalentVolumeM3
        : particleFinite(options.densityKgPerM3, 'options.densityKgPerM3', { minimum: 0 }),
      rmsRadiusM: moments.rmsRadiusM,
    },
    visual: {
      areaModel: 'convex-hull-max-radius-dilation',
      meanProjectedAreaM2: projections.reduce((sum, value) => sum + value.projectedAreaM2, 0)
        / projections.length,
      minimumProjectedAreaM2: Math.min(...projections.map(value => value.projectedAreaM2)),
      maximumProjectedAreaM2: Math.max(...projections.map(value => value.projectedAreaM2)),
    },
    temporal: {
      captureTimeSeconds,
      validUntilSeconds: captureTimeSeconds + particleFinite(
        options.validForSeconds ?? 0,
        'options.validForSeconds',
        { minimum: 0, maximum: 3600 },
      ),
    },
    memory: {
      logicalByteLength,
      encodedByteLength,
      compressionRatio: encodedByteLength === 0
        ? (logicalByteLength === 0 ? 1 : Number.POSITIVE_INFINITY)
        : logicalByteLength / encodedByteLength,
    },
  };
  const identity = {
    sourceRevision,
    sampleCount: samples.length,
    directionFingerprint: directions.fingerprint,
    projections: projections.map(projectionIdentity),
    summary,
  };
  return deepFreezeParticleContract({
    schema: PARTICLE_PROJECTION_CERTIFICATE_SCHEMA,
    schemaVersion: PARTICLE_PROJECTION_CERTIFICATE_VERSION,
    id: particleIdentifier(options.id ?? 'particle-projection-certificate', 'options.id'),
    sourceRevision,
    sampleCount: samples.length,
    directionSet: directions,
    projections,
    ...summary,
    fingerprint: particleFingerprint(identity),
    authority: {
      role: 'fidelity-evidence',
      grantsSimulationAuthority: false,
      deterministicDirections: true,
    },
  });
}

/** Sample an implicit proxy without materializing its full expansion. */
export function createParticleProxyProjectionCertificate(descriptorInput, options = {}) {
  const descriptor = normalizeParticleProxyDescriptor(descriptorInput);
  const requestedCount = particleInteger(
    options.sampleCount ?? Math.min(descriptor.sampleCapacity, 4096),
    'options.sampleCount',
    { minimum: 1, maximum: descriptor.sampleCapacity },
  );
  const timeSeconds = particleFinite(
    options.timeSeconds ?? descriptor.epochSeconds,
    'options.timeSeconds',
  );
  const mandatoryIndices = descriptor.residualPolicy.exceptions.map(exception => exception.sampleIndex);
  if (mandatoryIndices.length > requestedCount) {
    throw new RangeError('Proxy projection sample budget cannot cover every precision exception');
  }
  const selectedIndices = new Set(mandatoryIndices);
  for (let ordinal = 0; ordinal < requestedCount && selectedIndices.size < requestedCount; ordinal++) {
    selectedIndices.add(Math.min(
      descriptor.sampleCapacity - 1,
      Math.floor((ordinal + 0.5) * descriptor.sampleCapacity / requestedCount),
    ));
  }
  for (let sampleIndex = 0;
    sampleIndex < descriptor.sampleCapacity && selectedIndices.size < requestedCount;
    sampleIndex++) {
    selectedIndices.add(sampleIndex);
  }
  const samples = [];
  for (const sampleIndex of [...selectedIndices].sort((left, right) => left - right)) {
    const lifted = liftParticleProxySample(descriptor, { sampleIndex, timeSeconds });
    if (!lifted.validAtRequestedTime) {
      throw new RangeError('Proxy projection requested outside its certified time interval');
    }
    samples.push({
      positionM: lifted.positionM,
      velocityMPerS: lifted.velocityMPerS,
      massKg: descriptor.totalMassKg / requestedCount,
      radiusM: options.radiusM ?? Math.cbrt(
        (descriptor.extentM[0] * descriptor.extentM[1] * descriptor.extentM[2])
          / descriptor.sampleCapacity,
      ),
    });
  }
  return createParticleProjectionCertificate(samples, {
    ...options,
    id: options.id ?? `${descriptor.id}.projection`,
    sourceRevision: descriptor.sourceRevision,
    captureTimeSeconds: timeSeconds,
    logicalByteLength: options.logicalByteLength ?? descriptor.sourceSampleCount * 32,
    encodedByteLength: options.encodedByteLength
      ?? PARTICLE_PROXY_GPU_DESCRIPTOR_BYTES + descriptor.residualPolicy.exceptions.length * 24,
    densityKgPerM3: descriptor.equivalentDensityKgPerM3,
  });
}

export function validateParticleProjectionCertificate(input) {
  const certificate = particleRecord(input, 'certificate');
  if (certificate.schema !== PARTICLE_PROJECTION_CERTIFICATE_SCHEMA
      || certificate.schemaVersion !== PARTICLE_PROJECTION_CERTIFICATE_VERSION) {
    throw new Error('Unsupported particle projection certificate schema or version');
  }
  const id = particleIdentifier(certificate.id, 'certificate.id');
  const sourceRevision = particleRevision(certificate.sourceRevision, 'certificate.sourceRevision');
  const sampleCount = particleInteger(certificate.sampleCount, 'certificate.sampleCount', { minimum: 1 });
  const fingerprint = particleIdentifier(certificate.fingerprint, 'certificate.fingerprint');
  const directionSet = validateEqualAreaDirectionSet(certificate.directionSet);
  if (!Array.isArray(certificate.projections)
      || certificate.projections.length !== directionSet.count) {
    throw new Error('Projection certificate direction and projection counts differ');
  }
  const projections = certificate.projections.map((projection, index) => (
    finiteCertificateProjection(
      projection,
      index,
      directionSet.canonicalDirectionSet.directions[index],
    )
  ));
  for (let index = 0; index < projections.length; index++) {
    if (projections[index].directionId !== directionSet.normalizedDirections[index].id) {
      throw new Error('Projection certificate direction order does not match its direction set');
    }
  }
  const physical = particleRecord(certificate.physical, 'certificate.physical');
  const normalizedPhysical = {
    massKg: particleFinite(physical.massKg, 'certificate.physical.massKg', { minimum: Number.MIN_VALUE }),
    linearMomentumKgMPerS: particleVec3(
      physical.linearMomentumKgMPerS,
      'certificate.physical.linearMomentumKgMPerS',
    ),
    kineticEnergyJ: particleFinite(
      physical.kineticEnergyJ,
      'certificate.physical.kineticEnergyJ',
      { minimum: 0 },
    ),
    densityKgPerM3: particleFinite(
      physical.densityKgPerM3,
      'certificate.physical.densityKgPerM3',
      { minimum: 0 },
    ),
    rmsRadiusM: particleFinite(physical.rmsRadiusM, 'certificate.physical.rmsRadiusM', { minimum: 0 }),
  };
  const visual = particleRecord(certificate.visual, 'certificate.visual');
  if (visual.areaModel !== 'convex-hull-max-radius-dilation') {
    throw new Error('Projection certificate uses an unsupported visual area model');
  }
  const normalizedVisual = {
    areaModel: visual.areaModel,
    meanProjectedAreaM2: particleFinite(
      visual.meanProjectedAreaM2,
      'certificate.visual.meanProjectedAreaM2',
      { minimum: 0 },
    ),
    minimumProjectedAreaM2: particleFinite(
      visual.minimumProjectedAreaM2,
      'certificate.visual.minimumProjectedAreaM2',
      { minimum: 0 },
    ),
    maximumProjectedAreaM2: particleFinite(
      visual.maximumProjectedAreaM2,
      'certificate.visual.maximumProjectedAreaM2',
      { minimum: 0 },
    ),
  };
  const measuredMeanArea = projections.reduce((sum, value) => sum + value.projectedAreaM2, 0)
    / projections.length;
  const measuredMinimumArea = Math.min(...projections.map(value => value.projectedAreaM2));
  const measuredMaximumArea = Math.max(...projections.map(value => value.projectedAreaM2));
  if (Math.abs(normalizedVisual.meanProjectedAreaM2 - measuredMeanArea) > EPSILON
      || normalizedVisual.minimumProjectedAreaM2 !== measuredMinimumArea
      || normalizedVisual.maximumProjectedAreaM2 !== measuredMaximumArea) {
    throw new Error('Projection certificate visual summary does not match its projections');
  }
  const temporal = particleRecord(certificate.temporal, 'certificate.temporal');
  const normalizedTemporal = {
    captureTimeSeconds: particleFinite(
      temporal.captureTimeSeconds,
      'certificate.temporal.captureTimeSeconds',
    ),
    validUntilSeconds: particleFinite(
      temporal.validUntilSeconds,
      'certificate.temporal.validUntilSeconds',
    ),
  };
  if (normalizedTemporal.validUntilSeconds < normalizedTemporal.captureTimeSeconds) {
    throw new Error('Projection certificate validity cannot end before capture');
  }
  const memory = particleRecord(certificate.memory, 'certificate.memory');
  const logicalByteLength = particleInteger(
    memory.logicalByteLength,
    'certificate.memory.logicalByteLength',
    { minimum: 1 },
  );
  const encodedByteLength = particleInteger(
    memory.encodedByteLength,
    'certificate.memory.encodedByteLength',
    { minimum: 1 },
  );
  const normalizedMemory = {
    logicalByteLength,
    encodedByteLength,
    compressionRatio: logicalByteLength / encodedByteLength,
  };
  if (memory.compressionRatio !== normalizedMemory.compressionRatio) {
    throw new Error('Projection certificate compression ratio is inconsistent');
  }
  const authority = particleRecord(certificate.authority, 'certificate.authority');
  if (authority.role !== 'fidelity-evidence'
      || authority.grantsSimulationAuthority !== false
      || authority.deterministicDirections !== true) {
    throw new Error('Projection certificate authority contract is inconsistent');
  }
  const identity = {
    sourceRevision,
    sampleCount,
    directionFingerprint: directionSet.fingerprint,
    projections,
    summary: {
      physical: normalizedPhysical,
      visual: normalizedVisual,
      temporal: normalizedTemporal,
      memory: normalizedMemory,
    },
  };
  if (particleFingerprint(identity) !== fingerprint) {
    throw new Error('Projection certificate fingerprint does not match its evidence');
  }
  return deepFreezeParticleContract({
    schema: PARTICLE_PROJECTION_CERTIFICATE_SCHEMA,
    schemaVersion: PARTICLE_PROJECTION_CERTIFICATE_VERSION,
    id,
    sourceRevision,
    sampleCount,
    directionSet: directionSet.canonicalDirectionSet,
    projections,
    physical: normalizedPhysical,
    visual: normalizedVisual,
    temporal: normalizedTemporal,
    memory: normalizedMemory,
    fingerprint,
    authority: {
      role: 'fidelity-evidence',
      grantsSimulationAuthority: false,
      deterministicDirections: true,
    },
  });
}

function normalizedLimits(input = {}) {
  const result = {};
  for (const domain of Object.keys(PARTICLE_PROJECTION_DEFAULT_LIMITS)) {
    result[domain] = {};
    const values = input[domain] ?? {};
    for (const [name, fallback] of Object.entries(PARTICLE_PROJECTION_DEFAULT_LIMITS[domain])) {
      result[domain][name] = particleFinite(values[name] ?? fallback, `limits.${domain}.${name}`, {
        minimum: 0,
      });
    }
  }
  return result;
}

function domainResult(failures, measurements) {
  return { eligible: failures.length === 0, failures, measurements };
}

function failedComparison(reason, detail) {
  return deepFreezeParticleContract({
    schema: PARTICLE_PROJECTION_COMPARISON_SCHEMA,
    schemaVersion: PARTICLE_PROJECTION_COMPARISON_VERSION,
    accepted: false,
    reasonCodes: [reason],
    domains: {
      physical: domainResult([{ code: reason, detail }], {}),
      visual: domainResult([{ code: reason, detail }], {}),
      temporal: domainResult([{ code: reason, detail }], {}),
      memory: domainResult([{ code: reason, detail }], {}),
    },
  });
}

function recordFailure(failures, code, measured, limit) {
  if (!Number.isFinite(measured) || measured > limit) failures.push({ code, measured, limit });
}

/** Compare two certificates; malformed, stale, or direction-mismatched evidence rejects. */
export function compareParticleProjectionCertificates(referenceInput, candidateInput, options = {}) {
  let reference;
  let candidate;
  let limits;
  try {
    reference = validateParticleProjectionCertificate(referenceInput);
    candidate = validateParticleProjectionCertificate(candidateInput);
    limits = normalizedLimits(options.limits);
  } catch (error) {
    return failedComparison('invalid-certificate', error?.message ?? String(error));
  }
  if (reference.sourceRevision !== candidate.sourceRevision) {
    return failedComparison('source-revision-mismatch', {
      reference: reference.sourceRevision,
      candidate: candidate.sourceRevision,
    });
  }
  if (reference.directionSet.fingerprint !== candidate.directionSet.fingerprint
      || reference.projections.length !== candidate.projections.length) {
    return failedComparison('projection-direction-mismatch', {
      reference: reference.directionSet.fingerprint,
      candidate: candidate.directionSet.fingerprint,
    });
  }

  const physicalFailures = [];
  const physicalMeasurements = {
    massRelative: particleRelativeError(reference.physical.massKg, candidate.physical.massKg),
    linearMomentumRelative: particleVectorDistance(
      reference.physical.linearMomentumKgMPerS,
      candidate.physical.linearMomentumKgMPerS,
    ) / Math.max(particleMagnitude(reference.physical.linearMomentumKgMPerS), EPSILON),
    kineticEnergyRelative: particleRelativeError(
      reference.physical.kineticEnergyJ,
      candidate.physical.kineticEnergyJ,
    ),
    densityRelative: particleRelativeError(
      reference.physical.densityKgPerM3,
      candidate.physical.densityKgPerM3,
    ),
    rmsRadiusM: Math.abs(reference.physical.rmsRadiusM - candidate.physical.rmsRadiusM),
  };
  for (const [name, measured] of Object.entries(physicalMeasurements)) {
    recordFailure(physicalFailures, `physical-${name}`, measured, limits.physical[name]);
  }

  let projectedAreaRelative = 0;
  let projectedCentroidM = 0;
  let depthRangeM = 0;
  for (let index = 0; index < reference.projections.length; index++) {
    const referenceProjection = reference.projections[index];
    const candidateProjection = candidate.projections[index];
    if (referenceProjection.directionId !== candidateProjection.directionId) {
      return failedComparison('projection-direction-order-mismatch', { index });
    }
    projectedAreaRelative = Math.max(projectedAreaRelative, particleRelativeError(
      referenceProjection.projectedAreaM2,
      candidateProjection.projectedAreaM2,
    ));
    projectedCentroidM = Math.max(projectedCentroidM, Math.hypot(
      referenceProjection.projectedCentroidM[0] - candidateProjection.projectedCentroidM[0],
      referenceProjection.projectedCentroidM[1] - candidateProjection.projectedCentroidM[1],
    ));
    depthRangeM = Math.max(depthRangeM, Math.abs(
      referenceProjection.depthRangeM - candidateProjection.depthRangeM,
    ));
  }
  const visualFailures = [];
  const visualMeasurements = { projectedAreaRelative, projectedCentroidM, depthRangeM };
  for (const [name, measured] of Object.entries(visualMeasurements)) {
    recordFailure(visualFailures, `visual-${name}`, measured, limits.visual[name]);
  }

  const comparisonTimeSeconds = options.comparisonTimeSeconds == null
    ? Math.max(reference.temporal.captureTimeSeconds, candidate.temporal.captureTimeSeconds)
    : particleFinite(options.comparisonTimeSeconds, 'options.comparisonTimeSeconds');
  const temporalFailures = [];
  const temporalMeasurements = {
    captureDeltaSeconds: Math.abs(
      reference.temporal.captureTimeSeconds - candidate.temporal.captureTimeSeconds,
    ),
    maximumAgeSeconds: Math.max(0, comparisonTimeSeconds - candidate.temporal.validUntilSeconds),
  };
  for (const [name, measured] of Object.entries(temporalMeasurements)) {
    recordFailure(temporalFailures, `temporal-${name}`, measured, limits.temporal[name]);
  }

  const memoryFailures = [];
  const memoryMeasurements = {
    maximumEncodedRatio: candidate.memory.encodedByteLength
      / Math.max(reference.memory.encodedByteLength, 1),
  };
  recordFailure(
    memoryFailures,
    'memory-maximumEncodedRatio',
    memoryMeasurements.maximumEncodedRatio,
    limits.memory.maximumEncodedRatio,
  );
  const domains = {
    physical: domainResult(physicalFailures, physicalMeasurements),
    visual: domainResult(visualFailures, visualMeasurements),
    temporal: domainResult(temporalFailures, temporalMeasurements),
    memory: domainResult(memoryFailures, memoryMeasurements),
  };
  const requiredDomains = options.requiredDomains ?? ['physical', 'visual', 'temporal', 'memory'];
  if (!Array.isArray(requiredDomains) || requiredDomains.some(domain => !domains[domain])) {
    return failedComparison('invalid-required-domains', { requiredDomains });
  }
  const reasonCodes = requiredDomains.flatMap(domain => domains[domain].failures.map(entry => entry.code));
  return deepFreezeParticleContract({
    schema: PARTICLE_PROJECTION_COMPARISON_SCHEMA,
    schemaVersion: PARTICLE_PROJECTION_COMPARISON_VERSION,
    accepted: reasonCodes.length === 0,
    sourceRevision: reference.sourceRevision,
    referenceCertificateId: reference.id,
    candidateCertificateId: candidate.id,
    requiredDomains: [...requiredDomains],
    reasonCodes,
    limits,
    domains,
  });
}

export default createParticleProjectionCertificate;
