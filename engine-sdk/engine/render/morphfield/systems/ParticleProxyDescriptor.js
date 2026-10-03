// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  vec3Cross,
  vec3Dot,
  vec3Normalize,
} from '../../../core/math/MathVec3.js';
import { computeParticleCohortMoments } from './ParticleCohortPlanner.js';
import {
  deepFreezeParticleContract,
  particleEnum,
  particleFinite,
  particleFingerprint,
  particleIdentifier,
  particleInteger,
  particleMagnitude,
  particleMat3,
  particleRecord,
  particleRevision,
  particleVec3,
} from './ParticleRepresentationContracts.js';

export const PARTICLE_PROXY_SCHEMA = 'engine.morphfield.particle-proxy-descriptor';
export const PARTICLE_PROXY_VERSION = '1.0.0';
export const PARTICLE_PROXY_DIMENSIONS = Object.freeze([0, 1, 2, 3]);
export const PARTICLE_PROXY_SIMULATION_ROLES = Object.freeze([
  'presentation-only',
  'coarse-coupled',
]);
export const PARTICLE_PROXY_RESIDUAL_MODES = Object.freeze(['none', 'inline', 'exceptions']);
export const PARTICLE_PROXY_GPU_DESCRIPTOR_BYTES = 160;
export const PARTICLE_PROXY_EXPANSION_WORKGROUP_SIZE = 64;

export const PARTICLE_PROXY_GPU_LAYOUT = deepFreezeParticleContract({
  schema: 'engine.morphfield.particle-proxy-gpu-layout',
  version: '1.0.0',
  byteLength: PARTICLE_PROXY_GPU_DESCRIPTOR_BYTES,
  alignmentBytes: 16,
  fields: [
    { name: 'originEpoch', type: 'vec4<f32>', byteOffset: 0 },
    { name: 'meanVelocityMaximumTime', type: 'vec4<f32>', byteOffset: 16 },
    { name: 'basis0Extent', type: 'vec4<f32>', byteOffset: 32 },
    { name: 'basis1Extent', type: 'vec4<f32>', byteOffset: 48 },
    { name: 'basis2Extent', type: 'vec4<f32>', byteOffset: 64 },
    { name: 'affineRow0Mass', type: 'vec4<f32>', byteOffset: 80 },
    { name: 'affineRow1Density', type: 'vec4<f32>', byteOffset: 96 },
    { name: 'affineRow2InlinePosition', type: 'vec4<f32>', byteOffset: 112 },
    { name: 'metadata', type: 'vec4<u32>', byteOffset: 128 },
    { name: 'residualBounds', type: 'vec4<f32>', byteOffset: 144 },
  ],
});

const EPSILON = 1e-12;
const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const F32_MINIMUM_NORMAL = 2 ** -126;
const ZERO_MAT3 = Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 0]);

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function proxyHash32(value) {
  let result = value >>> 0;
  result ^= result >>> 16;
  result = Math.imul(result, 0x7feb352d) >>> 0;
  result ^= result >>> 15;
  result = Math.imul(result, 0x846ca68b) >>> 0;
  result ^= result >>> 16;
  return result >>> 0;
}

function proxyRandom01(index, seed, salt) {
  const mixed = (index ^ seed ^ salt) >>> 0;
  return (proxyHash32(mixed) >>> 8) / 0x1000000;
}

function orthonormalBasis(input, path = 'proxy.basis') {
  if (!Array.isArray(input) || input.length < 2) {
    throw new TypeError(`${path} requires at least two axes`);
  }
  let axis0 = vec3Normalize(particleVec3(input[0], `${path}[0]`));
  if (vec3Dot(axis0, axis0) < 1 - 1e-9) throw new RangeError(`${path}[0] cannot be zero`);
  const raw1 = particleVec3(input[1], `${path}[1]`);
  let axis1 = raw1.map((value, axis) => value - axis0[axis] * vec3Dot(raw1, axis0));
  if (vec3Dot(axis1, axis1) <= EPSILON) {
    const helper = Math.abs(axis0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    axis1 = vec3Cross(helper, axis0);
  }
  axis1 = vec3Normalize(axis1);
  let axis2 = vec3Normalize(vec3Cross(axis0, axis1));
  const preferred2 = input[2] == null ? null : particleVec3(input[2], `${path}[2]`);
  if (preferred2 && vec3Dot(axis2, preferred2) < 0) axis2 = axis2.map(value => -value);
  axis1 = vec3Normalize(vec3Cross(axis2, axis0));
  return [axis0, axis1, axis2];
}

function normalizeException(input, index, sampleCapacity, bounds) {
  const exception = particleRecord(input, `proxy.residualPolicy.exceptions[${index}]`);
  const sampleIndex = particleInteger(
    exception.sampleIndex,
    `proxy.residualPolicy.exceptions[${index}].sampleIndex`,
    { maximum: sampleCapacity - 1 },
  );
  const positionResidualM = particleVec3(
    exception.positionResidualM,
    `proxy.residualPolicy.exceptions[${index}].positionResidualM`,
    [0, 0, 0],
  );
  const velocityResidualMPerS = particleVec3(
    exception.velocityResidualMPerS,
    `proxy.residualPolicy.exceptions[${index}].velocityResidualMPerS`,
    [0, 0, 0],
  );
  if (particleMagnitude(positionResidualM) > bounds.maximumExceptionPositionM + EPSILON) {
    throw new RangeError(`Proxy position exception ${sampleIndex} exceeds its bound`);
  }
  if (particleMagnitude(velocityResidualMPerS) > bounds.maximumExceptionVelocityMPerS + EPSILON) {
    throw new RangeError(`Proxy velocity exception ${sampleIndex} exceeds its bound`);
  }
  return { sampleIndex, positionResidualM, velocityResidualMPerS };
}

function normalizeResidualPolicy(input, sampleCapacity) {
  const policy = particleRecord(input ?? {}, 'proxy.residualPolicy');
  const mode = particleEnum(
    policy.mode ?? 'none',
    PARTICLE_PROXY_RESIDUAL_MODES,
    'proxy.residualPolicy.mode',
  );
  const bounds = {
    maximumInlinePositionM: particleFinite(
      policy.maximumInlinePositionM ?? 0,
      'proxy.residualPolicy.maximumInlinePositionM',
      { minimum: 0 },
    ),
    maximumInlineVelocityMPerS: particleFinite(
      policy.maximumInlineVelocityMPerS ?? 0,
      'proxy.residualPolicy.maximumInlineVelocityMPerS',
      { minimum: 0 },
    ),
    maximumExceptionPositionM: particleFinite(
      policy.maximumExceptionPositionM ?? 0,
      'proxy.residualPolicy.maximumExceptionPositionM',
      { minimum: 0 },
    ),
    maximumExceptionVelocityMPerS: particleFinite(
      policy.maximumExceptionVelocityMPerS ?? 0,
      'proxy.residualPolicy.maximumExceptionVelocityMPerS',
      { minimum: 0 },
    ),
  };
  const exceptions = (policy.exceptions ?? []).map((entry, index) => (
    normalizeException(entry, index, sampleCapacity, bounds)
  )).sort((left, right) => left.sampleIndex - right.sampleIndex);
  for (let index = 1; index < exceptions.length; index++) {
    if (exceptions[index].sampleIndex === exceptions[index - 1].sampleIndex) {
      throw new Error(`Duplicate proxy exception for sample ${exceptions[index].sampleIndex}`);
    }
  }
  if (mode !== 'exceptions' && exceptions.length > 0) {
    throw new Error(`Proxy residual mode '${mode}' cannot contain precision exceptions`);
  }
  if (mode === 'none' && Object.values(bounds).some(value => value !== 0)) {
    throw new Error('Proxy residual mode none requires zero residual bounds');
  }
  if (mode === 'inline'
      && (bounds.maximumExceptionPositionM !== 0 || bounds.maximumExceptionVelocityMPerS !== 0)) {
    throw new Error('Proxy residual mode inline cannot declare exception bounds');
  }
  return { mode, ...bounds, exceptions };
}

function normalizedVariances(moments) {
  const source = moments?.principalVariancesM2;
  if ((!Array.isArray(source) && !ArrayBuffer.isView(source)) || source.length < 3) {
    throw new TypeError('moments.principalVariancesM2 requires three values');
  }
  const result = Array.from(source).slice(0, 3).map((value, index) => (
    particleFinite(value, `moments.principalVariancesM2[${index}]`, { minimum: 0 })
  ));
  if (result[0] + EPSILON < result[1] || result[1] + EPSILON < result[2]) {
    throw new RangeError('moments.principalVariancesM2 must be sorted in descending order');
  }
  return result;
}

/** Select the lowest intrinsic dimension admitted by PCA energy and thickness gates. */
export function selectParticleProxyDimension(moments, options = {}) {
  const variances = normalizedVariances(moments);
  const totalVarianceM2 = variances.reduce((sum, value) => sum + value, 0);
  const pointMaximumRmsRadiusM = particleFinite(
    options.pointMaximumRmsRadiusM ?? 0.01,
    'options.pointMaximumRmsRadiusM',
    { minimum: 0 },
  );
  const lineSecondaryVarianceRatio = particleFinite(
    options.lineSecondaryVarianceRatio ?? 0.08,
    'options.lineSecondaryVarianceRatio',
    { minimum: 0, maximum: 1 },
  );
  const sheetTertiaryVarianceRatio = particleFinite(
    options.sheetTertiaryVarianceRatio ?? 0.05,
    'options.sheetTertiaryVarianceRatio',
    { minimum: 0, maximum: 1 },
  );
  const maximumDimension = particleInteger(
    options.maximumDimension ?? 3,
    'options.maximumDimension',
    { maximum: 3 },
  );
  const rmsRadiusM = Math.sqrt(totalVarianceM2);
  let dimension;
  let reason;
  if (rmsRadiusM <= pointMaximumRmsRadiusM || variances[0] <= EPSILON) {
    dimension = 0;
    reason = 'rms support fits point-proxy threshold';
  } else if (variances[1] / variances[0] <= lineSecondaryVarianceRatio) {
    dimension = 1;
    reason = 'secondary PCA energy fits route-proxy threshold';
  } else if (variances[2] / variances[0] <= sheetTertiaryVarianceRatio) {
    dimension = 2;
    reason = 'tertiary PCA energy fits sheet-proxy threshold';
  } else {
    dimension = 3;
    reason = 'volumetric PCA energy requires a bulk proxy';
  }
  if (dimension > maximumDimension) {
    dimension = maximumDimension;
    reason = 'dimension constrained by caller maximum';
  }
  const retainedVarianceM2 = variances.slice(0, dimension).reduce((sum, value) => sum + value, 0);
  const discardedVarianceM2 = Math.max(0, totalVarianceM2 - retainedVarianceM2);
  return deepFreezeParticleContract({
    dimension,
    reason,
    principalVariancesM2: variances,
    totalVarianceM2,
    retainedVarianceM2,
    discardedVarianceM2,
    retainedVarianceFraction: totalVarianceM2 <= EPSILON ? 1 : retainedVarianceM2 / totalVarianceM2,
    ratios: {
      secondaryToPrimary: variances[0] <= EPSILON ? 0 : variances[1] / variances[0],
      tertiaryToPrimary: variances[0] <= EPSILON ? 0 : variances[2] / variances[0],
    },
  });
}

export function normalizeParticleProxyDescriptor(input) {
  const proxy = particleRecord(input, 'proxy');
  if ((proxy.schema != null && proxy.schema !== PARTICLE_PROXY_SCHEMA)
      || (proxy.schemaVersion != null && proxy.schemaVersion !== PARTICLE_PROXY_VERSION)) {
    throw new Error('Unsupported particle proxy descriptor schema or version');
  }
  const dimension = particleInteger(proxy.dimension, 'proxy.dimension', { maximum: 3 });
  const sampleCapacity = particleInteger(proxy.sampleCapacity, 'proxy.sampleCapacity', {
    minimum: 1,
    maximum: 0xffffffff,
  });
  const simulationRole = particleEnum(
    proxy.simulationRole ?? 'presentation-only',
    PARTICLE_PROXY_SIMULATION_ROLES,
    'proxy.simulationRole',
  );
  const conservationCertificateId = proxy.conservationCertificateId == null
    ? null
    : particleIdentifier(proxy.conservationCertificateId, 'proxy.conservationCertificateId');
  if (simulationRole === 'coarse-coupled' && !conservationCertificateId) {
    throw new Error('A coarse-coupled proxy requires a conservation certificate id');
  }
  const extentM = particleVec3(proxy.extentM, 'proxy.extentM').map((value, index) => (
    particleFinite(value, `proxy.extentM[${index}]`, { minimum: 0 })
  ));
  const residualPolicy = normalizeResidualPolicy(proxy.residualPolicy, sampleCapacity);
  const descriptor = {
    schema: PARTICLE_PROXY_SCHEMA,
    schemaVersion: PARTICLE_PROXY_VERSION,
    id: particleIdentifier(proxy.id, 'proxy.id'),
    sourceRevision: particleRevision(proxy.sourceRevision, 'proxy.sourceRevision'),
    representationRevision: particleRevision(
      proxy.representationRevision ?? 0,
      'proxy.representationRevision',
    ),
    dimension,
    simulationRole,
    sourceSampleCount: particleInteger(
      proxy.sourceSampleCount ?? sampleCapacity,
      'proxy.sourceSampleCount',
      { minimum: 1, maximum: 0xffffffff },
    ),
    sampleCapacity,
    seed: particleInteger(proxy.seed ?? 0, 'proxy.seed', { maximum: 0xffffffff }),
    epochSeconds: particleFinite(proxy.epochSeconds ?? 0, 'proxy.epochSeconds'),
    maximumTimeOffsetSeconds: particleFinite(
      proxy.maximumTimeOffsetSeconds ?? 2,
      'proxy.maximumTimeOffsetSeconds',
      { minimum: Number.MIN_VALUE, maximum: 3600 },
    ),
    originM: particleVec3(proxy.originM, 'proxy.originM'),
    meanVelocityMPerS: particleVec3(proxy.meanVelocityMPerS, 'proxy.meanVelocityMPerS', [0, 0, 0]),
    basis: orthonormalBasis(proxy.basis),
    extentM,
    affineVelocityGradientPerS: particleMat3(
      proxy.affineVelocityGradientPerS,
      'proxy.affineVelocityGradientPerS',
      ZERO_MAT3,
    ),
    totalMassKg: particleFinite(proxy.totalMassKg, 'proxy.totalMassKg', {
      minimum: Number.MIN_VALUE,
    }),
    equivalentDensityKgPerM3: particleFinite(
      proxy.equivalentDensityKgPerM3,
      'proxy.equivalentDensityKgPerM3',
      { minimum: 0 },
    ),
    residualPolicy,
    conservationCertificateId,
    selection: proxy.selection == null ? null : deepFreezeParticleContract({ ...proxy.selection }),
    authority: {
      canonical: false,
      role: simulationRole,
      writesCanonicalParticleState: false,
      canDriveNeighborPhysics: false,
      requiresCoupling: simulationRole === 'coarse-coupled',
    },
  };
  return deepFreezeParticleContract(descriptor);
}

/** Create a proxy directly from the planner's canonical cohort moments. */
export function createParticleProxyDescriptorFromMoments(moments, options = {}) {
  const source = particleRecord(moments, 'moments');
  const selection = selectParticleProxyDimension(source, options.dimensionSelection);
  const dimension = options.dimension == null
    ? selection.dimension
    : particleInteger(options.dimension, 'options.dimension', { maximum: 3 });
  const variances = normalizedVariances(source);
  const sigmaScale = particleFinite(options.sigmaScale ?? 2, 'options.sigmaScale', {
    minimum: Number.MIN_VALUE,
  });
  const minimumExtentM = particleFinite(
    options.minimumExtentM ?? 1e-4,
    'options.minimumExtentM',
    { minimum: Number.MIN_VALUE },
  );
  const extentM = variances.map(variance => Math.max(minimumExtentM, Math.sqrt(variance) * sigmaScale));
  const volumeM3 = (4 / 3) * Math.PI * extentM[0] * extentM[1] * extentM[2];
  const totalMassKg = particleFinite(source.totalMassKg, 'moments.totalMassKg', {
    minimum: Number.MIN_VALUE,
  });
  return normalizeParticleProxyDescriptor({
    id: options.id ?? 'particle-proxy',
    sourceRevision: options.sourceRevision ?? 0,
    representationRevision: options.representationRevision ?? 0,
    dimension,
    simulationRole: options.simulationRole ?? 'presentation-only',
    sourceSampleCount: particleInteger(source.sampleCount, 'moments.sampleCount', { minimum: 1 }),
    sampleCapacity: options.sampleCapacity ?? source.sampleCount,
    seed: options.seed ?? 0,
    epochSeconds: options.epochSeconds ?? 0,
    maximumTimeOffsetSeconds: options.maximumTimeOffsetSeconds ?? 2,
    originM: source.centroidM,
    meanVelocityMPerS: source.meanVelocityMPerS,
    basis: source.principalAxes,
    extentM,
    affineVelocityGradientPerS: options.affineVelocityGradientPerS ?? ZERO_MAT3,
    totalMassKg,
    equivalentDensityKgPerM3: options.equivalentDensityKgPerM3 ?? totalMassKg / volumeM3,
    residualPolicy: options.residualPolicy ?? { mode: 'none' },
    conservationCertificateId: options.conservationCertificateId,
    selection: { ...selection, selectedDimension: dimension },
  });
}

/** Compute the existing cohort moments once, then derive a shared proxy. */
export function createParticleProxyDescriptorFromSamples(samples, options = {}) {
  const moments = computeParticleCohortMoments(samples, options.momentOptions);
  return createParticleProxyDescriptorFromMoments(moments, options);
}

function findException(exceptions, sampleIndex) {
  let low = 0;
  let high = exceptions.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const candidate = exceptions[middle];
    if (candidate.sampleIndex === sampleIndex) return candidate;
    if (candidate.sampleIndex < sampleIndex) low = middle + 1;
    else high = middle - 1;
  }
  return null;
}

function generatedLocalCoordinate(descriptor, sampleIndex) {
  const count = descriptor.sampleCapacity;
  const fraction = (sampleIndex + 0.5) / count;
  const rotation = proxyRandom01(0, descriptor.seed, 0xa511e9b3) * TAU;
  const angle = GOLDEN_ANGLE * sampleIndex + rotation;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  if (descriptor.dimension === 1) {
    const diskRadius = Math.sqrt(proxyRandom01(sampleIndex, descriptor.seed, 0x63d83595));
    return [fraction * 2 - 1, diskRadius * cosine, diskRadius * sine];
  }
  if (descriptor.dimension === 2) {
    const diskRadius = Math.sqrt(fraction);
    return [diskRadius * cosine, diskRadius * sine,
      proxyRandom01(sampleIndex, descriptor.seed, 0x9e3779b9) * 2 - 1];
  }
  const vertical = 1 - 2 * fraction;
  const planar = Math.sqrt(Math.max(0, 1 - vertical * vertical));
  const radius = Math.cbrt(proxyRandom01(sampleIndex, descriptor.seed, 0x85ebca6b));
  return [planar * cosine * radius, vertical * radius, planar * sine * radius];
}

function suppliedLocalCoordinate(value, dimension) {
  const coordinate = particleVec3(value, 'sample.reducedCoordinates');
  if (coordinate.some(component => component < -1 || component > 1)) {
    throw new RangeError('sample.reducedCoordinates must stay inside [-1, 1]');
  }
  if (dimension === 1 && Math.hypot(coordinate[1], coordinate[2]) > 1 + EPSILON) {
    throw new RangeError('1D proxy cross-section coordinate leaves the unit disk');
  }
  if (dimension === 2 && Math.hypot(coordinate[0], coordinate[1]) > 1 + EPSILON) {
    throw new RangeError('2D proxy coordinate leaves the unit disk');
  }
  if ((dimension === 0 || dimension === 3) && particleMagnitude(coordinate) > 1 + EPSILON) {
    throw new RangeError('Volumetric proxy coordinate leaves the unit sphere');
  }
  return coordinate;
}

function boundedInlineResidual(value, path, maximum, mode) {
  const residual = particleVec3(value, path, [0, 0, 0]);
  const magnitude = particleMagnitude(residual);
  if (magnitude > EPSILON && mode === 'none') {
    throw new Error('Proxy residual data is not admitted by residual mode none');
  }
  if (magnitude > maximum + EPSILON) throw new RangeError(`${path} exceeds its inline bound`);
  return residual;
}

/** Deterministically lift one implicit sample without granting canonical authority. */
export function liftParticleProxySample(descriptorInput, {
  sampleIndex,
  timeSeconds,
  reducedCoordinates = null,
  positionResidualM = null,
  velocityResidualMPerS = null,
} = {}) {
  const descriptor = normalizeParticleProxyDescriptor(descriptorInput);
  const index = particleInteger(sampleIndex, 'sample.sampleIndex', {
    maximum: descriptor.sampleCapacity - 1,
  });
  const time = particleFinite(timeSeconds, 'sample.timeSeconds');
  const elapsedSeconds = time - descriptor.epochSeconds;
  const boundedElapsedSeconds = clamp(
    elapsedSeconds,
    -descriptor.maximumTimeOffsetSeconds,
    descriptor.maximumTimeOffsetSeconds,
  );
  const requiresPromotion = boundedElapsedSeconds !== elapsedSeconds;
  const localUnit = reducedCoordinates == null
    ? generatedLocalCoordinate(descriptor, index)
    : suppliedLocalCoordinate(reducedCoordinates, descriptor.dimension);
  const localM = localUnit.map((value, axis) => value * descriptor.extentM[axis]);
  const baseOrigin = descriptor.originM.map((value, axis) => (
    value + descriptor.meanVelocityMPerS[axis] * boundedElapsedSeconds
  ));
  const inlinePosition = boundedInlineResidual(
    positionResidualM,
    'sample.positionResidualM',
    descriptor.residualPolicy.maximumInlinePositionM,
    descriptor.residualPolicy.mode,
  );
  const inlineVelocity = boundedInlineResidual(
    velocityResidualMPerS,
    'sample.velocityResidualMPerS',
    descriptor.residualPolicy.maximumInlineVelocityMPerS,
    descriptor.residualPolicy.mode,
  );
  const exception = findException(descriptor.residualPolicy.exceptions, index);
  const positionResidual = inlinePosition.map((value, axis) => (
    value + (exception?.positionResidualM[axis] ?? 0)
  ));
  const velocityResidual = inlineVelocity.map((value, axis) => (
    value + (exception?.velocityResidualMPerS[axis] ?? 0)
  ));
  const positionM = baseOrigin.map((value, axis) => (
    value
      + descriptor.basis[0][axis] * localM[0]
      + descriptor.basis[1][axis] * localM[1]
      + descriptor.basis[2][axis] * localM[2]
      + positionResidual[axis]
  ));
  const gradient = descriptor.affineVelocityGradientPerS;
  const affineVelocity = [
    gradient[0] * localM[0] + gradient[1] * localM[1] + gradient[2] * localM[2],
    gradient[3] * localM[0] + gradient[4] * localM[1] + gradient[5] * localM[2],
    gradient[6] * localM[0] + gradient[7] * localM[1] + gradient[8] * localM[2],
  ];
  const velocityMPerS = descriptor.meanVelocityMPerS.map((value, axis) => (
    value + affineVelocity[axis] + velocityResidual[axis]
  ));
  return deepFreezeParticleContract({
    descriptorId: descriptor.id,
    sourceRevision: descriptor.sourceRevision,
    sampleIndex: index,
    dimension: descriptor.dimension,
    reducedCoordinates: localUnit,
    coordinateSource: reducedCoordinates == null ? 'deterministic-expansion' : 'provided',
    localM,
    positionM,
    velocityMPerS,
    massKg: descriptor.totalMassKg / descriptor.sampleCapacity,
    residual: {
      positionM: positionResidual,
      velocityMPerS: velocityResidual,
      usedInline: particleMagnitude(inlinePosition) > EPSILON
        || particleMagnitude(inlineVelocity) > EPSILON,
      usedException: exception != null,
    },
    requiresPromotion,
    validAtRequestedTime: !requiresPromotion,
    authority: descriptor.authority,
  });
}

function setVec4(view, byteOffset, values, path) {
  for (let index = 0; index < 4; index++) {
    const source = values[index];
    const packed = Math.fround(source);
    if (!Number.isFinite(packed)
        || (source !== 0 && packed === 0)
        || (packed !== 0 && Math.abs(packed) < F32_MINIMUM_NORMAL)) {
      throw new RangeError(`${path}[${index}] must be zero or a finite normal f32 value`);
    }
    view.setFloat32(byteOffset + index * 4, packed, true);
  }
}

/** Pack the versioned 160-byte descriptor consumed by PARTICLE_PROXY_EXPANSION_WGSL. */
export function packParticleProxyGpuDescriptor(descriptorInput) {
  const descriptor = normalizeParticleProxyDescriptor(descriptorInput);
  const buffer = new ArrayBuffer(PARTICLE_PROXY_GPU_DESCRIPTOR_BYTES);
  const view = new DataView(buffer);
  setVec4(view, 0, [...descriptor.originM, descriptor.epochSeconds], 'proxy.originEpoch');
  setVec4(
    view,
    16,
    [...descriptor.meanVelocityMPerS, descriptor.maximumTimeOffsetSeconds],
    'proxy.meanVelocityMaximumTime',
  );
  setVec4(view, 32, [...descriptor.basis[0], descriptor.extentM[0]], 'proxy.basis0Extent');
  setVec4(view, 48, [...descriptor.basis[1], descriptor.extentM[1]], 'proxy.basis1Extent');
  setVec4(view, 64, [...descriptor.basis[2], descriptor.extentM[2]], 'proxy.basis2Extent');
  setVec4(
    view,
    80,
    [...descriptor.affineVelocityGradientPerS.slice(0, 3), descriptor.totalMassKg],
    'proxy.affineRow0Mass',
  );
  setVec4(view, 96, [
    ...descriptor.affineVelocityGradientPerS.slice(3, 6),
    descriptor.equivalentDensityKgPerM3,
  ], 'proxy.affineRow1Density');
  setVec4(view, 112, [
    ...descriptor.affineVelocityGradientPerS.slice(6, 9),
    descriptor.residualPolicy.maximumInlinePositionM,
  ], 'proxy.affineRow2InlinePosition');
  let flags = descriptor.simulationRole === 'coarse-coupled' ? 2 : 1;
  if (descriptor.residualPolicy.mode === 'inline') flags |= 4;
  if (descriptor.residualPolicy.mode === 'exceptions') flags |= 12;
  view.setUint32(128, descriptor.dimension, true);
  view.setUint32(132, descriptor.sampleCapacity, true);
  view.setUint32(136, descriptor.seed, true);
  view.setUint32(140, flags, true);
  setVec4(view, 144, [
    descriptor.residualPolicy.maximumExceptionPositionM,
    descriptor.residualPolicy.maximumInlineVelocityMPerS,
    descriptor.residualPolicy.maximumExceptionVelocityMPerS,
    descriptor.residualPolicy.exceptions.length,
  ], 'proxy.residualBounds');
  return buffer;
}

export function createParticleProxyGpuExpansionPlan(descriptorInput, options = {}) {
  const descriptor = normalizeParticleProxyDescriptor(descriptorInput);
  const firstInstance = particleInteger(options.firstInstance ?? 0, 'options.firstInstance', {
    maximum: 0xffffffff,
  });
  const instanceCount = particleInteger(
    options.instanceCount ?? descriptor.sampleCapacity,
    'options.instanceCount',
    { minimum: 1, maximum: descriptor.sampleCapacity },
  );
  if (firstInstance + instanceCount > descriptor.sampleCapacity) {
    throw new RangeError('Expansion range exceeds proxy sample capacity');
  }
  const canonicalDescriptorBytes = packParticleProxyGpuDescriptor(descriptor);
  const plan = {
    schema: 'engine.morphfield.particle-proxy-expansion-plan',
    schemaVersion: '1.0.0',
    descriptorId: descriptor.id,
    sourceRevision: descriptor.sourceRevision,
    firstInstance,
    instanceCount,
    dispatchWorkgroups: Math.ceil(instanceCount / PARTICLE_PROXY_EXPANSION_WORKGROUP_SIZE),
    workgroupSize: PARTICLE_PROXY_EXPANSION_WORKGROUP_SIZE,
    descriptorFingerprint: particleFingerprint(Array.from(new Uint8Array(canonicalDescriptorBytes))),
    exceptionCount: descriptor.residualPolicy.exceptions.length,
    authority: descriptor.authority,
  };
  // Freezing an ArrayBuffer only freezes its object properties, not its bytes.
  // Keep the validated bytes private and return a fresh transfer-safe copy on
  // every read so a caller cannot mutate a plan after validation.
  Object.defineProperty(plan, 'descriptorBytes', {
    enumerable: true,
    get: () => canonicalDescriptorBytes.slice(0),
  });
  return deepFreezeParticleContract(plan);
}

/**
 * Binding-free WGSL contract. Engines embed this source and supply descriptor,
 * time, and instance index. Residual streams are applied explicitly so a base
 * proxy can never silently consume missing precision exceptions.
 */
export const PARTICLE_PROXY_EXPANSION_WGSL = /* wgsl */`
struct ParticleProxyGpuDescriptor {
  originEpoch: vec4<f32>,
  meanVelocityMaximumTime: vec4<f32>,
  basis0Extent: vec4<f32>,
  basis1Extent: vec4<f32>,
  basis2Extent: vec4<f32>,
  affineRow0Mass: vec4<f32>,
  affineRow1Density: vec4<f32>,
  affineRow2InlinePosition: vec4<f32>,
  metadata: vec4<u32>,
  residualBounds: vec4<f32>,
};

struct ParticleProxyLiftResult {
  positionM: vec3<f32>,
  validAtRequestedTime: u32,
  velocityMPerS: vec3<f32>,
  massKg: f32,
};

fn particleProxyHash32(inputValue: u32) -> u32 {
  var value = inputValue;
  value = value ^ (value >> 16u);
  value = value * 0x7feb352du;
  value = value ^ (value >> 15u);
  value = value * 0x846ca68bu;
  return value ^ (value >> 16u);
}

fn particleProxyRandom01(index: u32, seed: u32, salt: u32) -> f32 {
  return f32(particleProxyHash32(index ^ seed ^ salt) >> 8u) * (1.0 / 16777216.0);
}

fn particleProxyGeneratedCoordinate(proxy: ParticleProxyGpuDescriptor, index: u32) -> vec3<f32> {
  let count = max(1u, proxy.metadata.y);
  let fraction = (f32(index) + 0.5) / f32(count);
  let rotation = particleProxyRandom01(0u, proxy.metadata.z, 0xa511e9b3u) * 6.283185307179586;
  let angle = 2.399963229728653 * f32(index) + rotation;
  let cosine = cos(angle);
  let sine = sin(angle);
  if (proxy.metadata.x == 1u) {
    let radius = sqrt(particleProxyRandom01(index, proxy.metadata.z, 0x63d83595u));
    return vec3<f32>(fraction * 2.0 - 1.0, radius * cosine, radius * sine);
  }
  if (proxy.metadata.x == 2u) {
    let radius = sqrt(fraction);
    let thickness = particleProxyRandom01(index, proxy.metadata.z, 0x9e3779b9u) * 2.0 - 1.0;
    return vec3<f32>(radius * cosine, radius * sine, thickness);
  }
  let vertical = 1.0 - 2.0 * fraction;
  let planar = sqrt(max(0.0, 1.0 - vertical * vertical));
  let radius = pow(particleProxyRandom01(index, proxy.metadata.z, 0x85ebca6bu), 1.0 / 3.0);
  return vec3<f32>(planar * cosine * radius, vertical * radius, planar * sine * radius);
}

fn particleProxyLiftBase(
  proxy: ParticleProxyGpuDescriptor,
  index: u32,
  timeSeconds: f32,
) -> ParticleProxyLiftResult {
  let rawElapsed = timeSeconds - proxy.originEpoch.w;
  let elapsed = clamp(
    rawElapsed,
    -proxy.meanVelocityMaximumTime.w,
    proxy.meanVelocityMaximumTime.w,
  );
  let coordinate = particleProxyGeneratedCoordinate(proxy, index);
  let localM = coordinate * vec3<f32>(
    proxy.basis0Extent.w,
    proxy.basis1Extent.w,
    proxy.basis2Extent.w,
  );
  let worldLocal = proxy.basis0Extent.xyz * localM.x
    + proxy.basis1Extent.xyz * localM.y
    + proxy.basis2Extent.xyz * localM.z;
  let positionM = proxy.originEpoch.xyz + proxy.meanVelocityMaximumTime.xyz * elapsed + worldLocal;
  let affineVelocity = vec3<f32>(
    dot(proxy.affineRow0Mass.xyz, localM),
    dot(proxy.affineRow1Density.xyz, localM),
    dot(proxy.affineRow2InlinePosition.xyz, localM),
  );
  return ParticleProxyLiftResult(
    positionM,
    select(0u, 1u, rawElapsed == elapsed),
    proxy.meanVelocityMaximumTime.xyz + affineVelocity,
    proxy.affineRow0Mass.w / f32(max(1u, proxy.metadata.y)),
  );
}

fn particleProxyApplyResidual(
  base: ParticleProxyLiftResult,
  positionResidualM: vec3<f32>,
  velocityResidualMPerS: vec3<f32>,
) -> ParticleProxyLiftResult {
  return ParticleProxyLiftResult(
    base.positionM + positionResidualM,
    base.validAtRequestedTime,
    base.velocityMPerS + velocityResidualMPerS,
    base.massKg,
  );
}
`;

export default normalizeParticleProxyDescriptor;
