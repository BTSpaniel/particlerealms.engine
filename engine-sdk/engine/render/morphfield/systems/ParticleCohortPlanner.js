// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { eigSym3 } from '../../../assets/geometry/PrincipalAxes.js';
import { mat3ToQuat } from '../../../assets/CanonicalSpace.js';
import { hashFloat2D } from '../../../core/math/MathBits.js';
import {
  vec3Cross,
  vec3Dot,
  vec3Normalize,
} from '../../../core/math/MathVec3.js';
import { compareCanonicalStrings } from '../core/serialization.js';
import { EXECUTION_FAMILY } from './RepresentationPlanner.js';

export const PARTICLE_COHORT_PLAN_SCHEMA = 'engine.morphfield.particle-cohort-plan';
export const PARTICLE_COHORT_PLAN_VERSION = '1.0.0';

/**
 * Presentation queues are intentionally independent of canonical simulation
 * authority. A page enters exactly one queue; GPU-side flag compaction may turn
 * these queue bits into indirect work lists without reclassifying the page.
 */
export const PARTICLE_COHORT_PRESENTATION_QUEUES = Object.freeze([
  'raw',
  'packed',
  'moment',
  'procedural',
  'field',
  'sleeping',
]);

export const PARTICLE_COHORT_QUEUE_INDEX = Object.freeze(Object.fromEntries(
  PARTICLE_COHORT_PRESENTATION_QUEUES.map((queue, index) => [queue, index]),
));

const QUEUE_SET = new Set(PARTICLE_COHORT_PRESENTATION_QUEUES);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;
const TAU = Math.PI * 2;
const EPSILON = 1e-12;

const QUEUE_COMPRESSION_RANK = Object.freeze({
  raw: 0,
  packed: 1,
  moment: 2,
  procedural: 3,
  field: 3,
  sleeping: 4,
});

const QUEUE_EXECUTION_FAMILY = Object.freeze({
  raw: EXECUTION_FAMILY.ANALYTIC,
  packed: EXECUTION_FAMILY.ANALYTIC,
  moment: EXECUTION_FAMILY.ORIENTED_KERNEL,
  procedural: EXECUTION_FAMILY.ANALYTIC,
  field: EXECUTION_FAMILY.SPARSE_RESIDUAL,
  sleeping: null,
});

const FALLBACK_ORDER = Object.freeze({
  raw: Object.freeze(['raw']),
  packed: Object.freeze(['packed', 'raw']),
  moment: Object.freeze(['moment', 'packed', 'raw']),
  procedural: Object.freeze(['procedural', 'moment', 'packed', 'raw']),
  field: Object.freeze(['field', 'moment', 'packed', 'raw']),
  sleeping: Object.freeze(['sleeping', 'raw']),
});

const DEFAULT_OPTIONS = Object.freeze({
  minimumResidencyFrames: 24,
  promotionFrames: 8,
  lateralSwitchFrames: 12,
  sleepingStableFrames: 120,
  sleepingMaximumSpeedMPerS: 0.01,
  packedPositionErrorMaxM: 0.025,
  packedVelocityErrorMaxMPerS: 0.25,
  momentDensityErrorMaxFraction: 0.08,
  momentMaximumProjectedRadiusPx: 7,
  proceduralPositionErrorMaxM: 0.08,
  proceduralVelocityErrorMaxMPerS: 0.5,
  proceduralMinimumCoherence: 0.9,
  fieldMassErrorMaxFraction: 0.005,
  fieldDivergenceErrorMax: 0.04,
  fieldMinimumScreenCoverage: 0.3,
});

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const entry of Object.values(value)) deepFreeze(entry, seen);
  return Object.freeze(value);
}

function finite(value, path, { minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new RangeError(`${path} must be finite in [${minimum}, ${maximum}]`);
  }
  return number;
}

function optionalFinite(value, fallback = Number.POSITIVE_INFINITY) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integer(value, path, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${path} must be a safe integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function identifier(value, path) {
  const result = String(value ?? '');
  if (!IDENTIFIER.test(result)) throw new TypeError(`${path} has invalid identifier syntax`);
  return result;
}

function finiteVec3(value, path, fallback = null) {
  const source = value ?? fallback;
  if ((!Array.isArray(source) && !ArrayBuffer.isView(source)) || source.length < 3) {
    throw new TypeError(`${path} requires three values`);
  }
  return [
    finite(source[0], `${path}[0]`),
    finite(source[1], `${path}[1]`),
    finite(source[2], `${path}[2]`),
  ];
}

function boolean(value, fallback = false) {
  return value === undefined ? fallback : value === true;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function reduceAngle(value) {
  const reduced = value % TAU;
  return reduced < 0 ? reduced + TAU : reduced;
}

function orthonormalBasis(axisInput, basisInput) {
  const axis = vec3Normalize(axisInput);
  if (vec3Dot(axis, axis) < 1 - 1e-9) throw new RangeError('branchField.axis cannot be zero');
  let basisX = basisInput
    ? [
      basisInput[0] - axis[0] * vec3Dot(basisInput, axis),
      basisInput[1] - axis[1] * vec3Dot(basisInput, axis),
      basisInput[2] - axis[2] * vec3Dot(basisInput, axis),
    ]
    : null;
  if (!basisX || vec3Dot(basisX, basisX) <= EPSILON) {
    const helper = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    basisX = vec3Cross(helper, axis);
  }
  basisX = vec3Normalize(basisX);
  const basisZ = vec3Normalize(vec3Cross(axis, basisX));
  basisX = vec3Normalize(vec3Cross(basisZ, axis));
  return { axis, basisX, basisZ };
}

/**
 * Validate and canonicalize a finite branch-field descriptor. The descriptor's
 * radius, axial displacement, residual, and extrapolation interval all have
 * explicit bounds; recursive exponentiation is deliberately unsupported.
 */
export function normalizeParticleBranchFieldDescriptor(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('branchField descriptor is required');
  }
  const branchCount = integer(input.branchCount ?? 1, 'branchField.branchCount', {
    minimum: 1,
    maximum: 4096,
  });
  const samplesPerBranch = integer(
    input.samplesPerBranch ?? 1,
    'branchField.samplesPerBranch',
    { minimum: 1, maximum: 16_777_216 },
  );
  if (branchCount * samplesPerBranch > 0x1_0000_0000) {
    throw new RangeError('branchField sample capacity exceeds the u32 GPU index range');
  }
  const baseRadiusM = finite(input.baseRadiusM ?? 0, 'branchField.baseRadiusM', { minimum: 0 });
  const minimumRadiusM = finite(
    input.minimumRadiusM ?? 0,
    'branchField.minimumRadiusM',
    { minimum: 0 },
  );
  const maximumRadiusM = finite(
    input.maximumRadiusM ?? Math.max(1, baseRadiusM * 8),
    'branchField.maximumRadiusM',
    { minimum: Number.MIN_VALUE },
  );
  if (minimumRadiusM > maximumRadiusM || baseRadiusM > maximumRadiusM) {
    throw new RangeError('branchField radius bounds must contain baseRadiusM');
  }
  const maximumResidualM = finite(
    input.maximumResidualM ?? 0,
    'branchField.maximumResidualM',
    { minimum: 0 },
  );
  const maximumTimeOffsetSeconds = finite(
    input.maximumTimeOffsetSeconds ?? 30,
    'branchField.maximumTimeOffsetSeconds',
    { minimum: Number.MIN_VALUE, maximum: 3600 },
  );
  const maximumAxialOffsetM = finite(
    input.maximumAxialOffsetM ?? Math.max(1, Math.abs(Number(input.pitchMPerUnit ?? 0))),
    'branchField.maximumAxialOffsetM',
    { minimum: 0 },
  );
  const maxAbsLogRadius = finite(
    input.maxAbsLogRadius ?? 8,
    'branchField.maxAbsLogRadius',
    { minimum: Number.MIN_VALUE, maximum: 16 },
  );
  const axisInput = finiteVec3(input.axis, 'branchField.axis', [0, 1, 0]);
  const basisInput = input.basisX == null
    ? null
    : finiteVec3(input.basisX, 'branchField.basisX');
  const basis = orthonormalBasis(axisInput, basisInput);
  const descriptor = {
    id: identifier(input.id ?? 'branch-field', 'branchField.id'),
    originM: finiteVec3(input.originM, 'branchField.originM', [0, 0, 0]),
    axis: basis.axis,
    basisX: basis.basisX,
    basisZ: basis.basisZ,
    meanVelocityMPerS: finiteVec3(
      input.meanVelocityMPerS,
      'branchField.meanVelocityMPerS',
      [0, 0, 0],
    ),
    axialVelocityMPerS: finite(
      input.axialVelocityMPerS ?? 0,
      'branchField.axialVelocityMPerS',
    ),
    branchCount,
    samplesPerBranch,
    sampleCapacity: branchCount * samplesPerBranch,
    seed: integer(input.seed ?? 0, 'branchField.seed', { maximum: 0xffffffff }),
    epochSeconds: finite(input.epochSeconds ?? 0, 'branchField.epochSeconds'),
    baseRadiusM,
    minimumRadiusM,
    maximumRadiusM,
    radialGrowthPerUnit: finite(
      input.radialGrowthPerUnit ?? 0,
      'branchField.radialGrowthPerUnit',
      { minimum: -32, maximum: 32 },
    ),
    maxAbsLogRadius,
    pitchMPerUnit: finite(input.pitchMPerUnit ?? 0, 'branchField.pitchMPerUnit'),
    maximumAxialOffsetM,
    angularVelocityRadPerS: finite(
      input.angularVelocityRadPerS ?? 0,
      'branchField.angularVelocityRadPerS',
      { minimum: -1e6, maximum: 1e6 },
    ),
    twistRadPerUnit: finite(
      input.twistRadPerUnit ?? 0,
      'branchField.twistRadPerUnit',
      { minimum: -1e6, maximum: 1e6 },
    ),
    phaseRad: reduceAngle(finite(input.phaseRad ?? 0, 'branchField.phaseRad')),
    phaseJitterRad: finite(
      input.phaseJitterRad ?? 0,
      'branchField.phaseJitterRad',
      { minimum: 0, maximum: Math.PI },
    ),
    radialJitterFraction: finite(
      input.radialJitterFraction ?? 0,
      'branchField.radialJitterFraction',
      { minimum: 0, maximum: 1 },
    ),
    axialJitterM: finite(input.axialJitterM ?? 0, 'branchField.axialJitterM', {
      minimum: 0,
      maximum: maximumAxialOffsetM,
    }),
    maximumResidualM,
    maximumTimeOffsetSeconds,
  };
  return deepFreeze(descriptor);
}

function reducedAngularMotion(angularVelocity, elapsedSeconds) {
  if (Math.abs(angularVelocity) <= EPSILON) return 0;
  const period = TAU / Math.abs(angularVelocity);
  return angularVelocity * (elapsedSeconds % period);
}

function boundedResidual(input, maximumLength) {
  const value = finiteVec3(input, 'sample.residualM', [0, 0, 0]);
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length <= maximumLength || length <= EPSILON) {
    return { value, clamped: false };
  }
  const scale = maximumLength / length;
  return { value: value.map(component => component * scale), clamped: true };
}

/**
 * Reconstruct one deterministic branch-field sample from an implicit index.
 * The result is a disposable presentation sample and never claims simulation
 * authority. Callers must rebase or promote the page when `bounded` is true.
 */
export function reconstructParticleBranchFieldSample(descriptorInput, {
  sampleIndex,
  timeSeconds,
  normalizedCoordinate = null,
  residualM = null,
} = {}) {
  const descriptor = normalizeParticleBranchFieldDescriptor(descriptorInput);
  const index = integer(sampleIndex, 'sample.sampleIndex', {
    maximum: descriptor.sampleCapacity - 1,
  });
  const time = finite(timeSeconds, 'sample.timeSeconds');
  const branchIndex = index % descriptor.branchCount;
  const ordinal = Math.floor(index / descriptor.branchCount);
  const rawCoordinate = normalizedCoordinate == null
    ? (ordinal + 0.5) / descriptor.samplesPerBranch
    : finite(normalizedCoordinate, 'sample.normalizedCoordinate');
  const u = clamp(rawCoordinate, 0, 1);
  const elapsed = time - descriptor.epochSeconds;
  if (!Number.isFinite(elapsed)) {
    throw new RangeError('sample time offset must remain finite');
  }
  const boundedElapsed = clamp(
    elapsed,
    -descriptor.maximumTimeOffsetSeconds,
    descriptor.maximumTimeOffsetSeconds,
  );
  const timeClamped = boundedElapsed !== elapsed;
  const rawLogRadius = descriptor.radialGrowthPerUnit * u;
  const boundedLogRadius = clamp(
    rawLogRadius,
    -descriptor.maxAbsLogRadius,
    descriptor.maxAbsLogRadius,
  );
  const phaseJitter = (hashFloat2D(index, descriptor.seed) * 2 - 1)
    * descriptor.phaseJitterRad;
  const radialJitter = 1 + (hashFloat2D(index, descriptor.seed ^ 0x9e3779b9) * 2 - 1)
    * descriptor.radialJitterFraction;
  const rawRadius = descriptor.baseRadiusM * Math.exp(boundedLogRadius) * radialJitter;
  const radiusM = clamp(rawRadius, descriptor.minimumRadiusM, descriptor.maximumRadiusM);
  const thetaRad = reduceAngle(
    descriptor.phaseRad
      + TAU * branchIndex / descriptor.branchCount
      + descriptor.twistRadPerUnit * u
      + reducedAngularMotion(descriptor.angularVelocityRadPerS, elapsed)
      + phaseJitter,
  );
  const axialJitter = (hashFloat2D(index, descriptor.seed ^ 0x85ebca6b) * 2 - 1)
    * descriptor.axialJitterM;
  const rawAxialOffsetM = descriptor.pitchMPerUnit * (u - 0.5)
    + descriptor.axialVelocityMPerS * boundedElapsed
    + axialJitter;
  const axialOffsetM = clamp(
    rawAxialOffsetM,
    -descriptor.maximumAxialOffsetM,
    descriptor.maximumAxialOffsetM,
  );
  const residual = boundedResidual(residualM, descriptor.maximumResidualM);
  const cosine = Math.cos(thetaRad);
  const sine = Math.sin(thetaRad);
  const movingOrigin = descriptor.originM.map(
    (component, axis) => component + descriptor.meanVelocityMPerS[axis] * boundedElapsed,
  );
  const radialDirection = descriptor.basisX.map(
    (component, axis) => component * cosine + descriptor.basisZ[axis] * sine,
  );
  const tangent = descriptor.basisX.map(
    (component, axis) => -component * sine + descriptor.basisZ[axis] * cosine,
  );
  const positionM = finiteVec3(movingOrigin.map((component, axis) => (
    component
      + radialDirection[axis] * radiusM
      + descriptor.axis[axis] * axialOffsetM
      + residual.value[axis]
  )), 'sample reconstructed position');
  const velocityMPerS = finiteVec3(descriptor.meanVelocityMPerS.map((component, axis) => (
    component
      + descriptor.axis[axis] * descriptor.axialVelocityMPerS
      + tangent[axis] * descriptor.angularVelocityRadPerS * radiusM
  )), 'sample reconstructed velocity');
  const bounded = u !== rawCoordinate
    || timeClamped
    || boundedLogRadius !== rawLogRadius
    || radiusM !== rawRadius
    || axialOffsetM !== rawAxialOffsetM
    || residual.clamped;
  return deepFreeze({
    descriptorId: descriptor.id,
    sampleIndex: index,
    branchIndex,
    ordinal,
    normalizedCoordinate: u,
    thetaRad,
    radiusM,
    axialOffsetM,
    positionM,
    velocityMPerS,
    residualM: residual.value,
    bounded,
    bounds: {
      time: timeClamped,
      coordinate: u !== rawCoordinate,
      logRadius: boundedLogRadius !== rawLogRadius,
      radius: radiusM !== rawRadius,
      axial: axialOffsetM !== rawAxialOffsetM,
      residual: residual.clamped,
    },
    authority: {
      role: 'presentation-sample',
      canonical: false,
      writesSimulationState: false,
    },
  });
}

function samplePosition(sample, index, accessor) {
  return finiteVec3(
    accessor ? accessor(sample, index) : (sample?.positionM ?? sample?.position),
    `samples[${index}].positionM`,
  );
}

function sampleVelocity(sample, index, accessor) {
  return finiteVec3(
    accessor ? accessor(sample, index) : (sample?.velocityMPerS ?? sample?.velocity),
    `samples[${index}].velocityMPerS`,
    [0, 0, 0],
  );
}

function sampleMass(sample, index, accessor, defaultMassKg) {
  const value = accessor
    ? accessor(sample, index)
    : (sample?.massKg ?? defaultMassKg);
  return finite(value, `samples[${index}].massKg`, { minimum: 0 });
}

function weightedMomentUpdate(mean, accumulator, value, weight, nextWeight) {
  const delta = value.map((component, axis) => component - mean[axis]);
  const ratio = weight / nextWeight;
  for (let axis = 0; axis < 3; axis++) mean[axis] += delta[axis] * ratio;
  const remainder = value.map((component, axis) => component - mean[axis]);
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      accumulator[row * 3 + column] += weight * delta[row] * remainder[column];
    }
  }
}

/**
 * Mass-weighted, numerically stable aggregate moments for a bounded page.
 * Position and velocity covariance use the population convention (divide by
 * total mass), matching an oriented density kernel rather than an estimator.
 */
export function computeParticleCohortMoments(samples, options = {}) {
  if (!Array.isArray(samples) && !ArrayBuffer.isView(samples)) {
    throw new TypeError('samples must be array-like');
  }
  if (samples.length === 0) throw new RangeError('samples cannot be empty');
  const defaultMassKg = finite(options.defaultMassKg ?? 1, 'options.defaultMassKg', {
    minimum: Number.MIN_VALUE,
  });
  for (const name of ['positionAccessor', 'velocityAccessor', 'massAccessor']) {
    if (options[name] != null && typeof options[name] !== 'function') {
      throw new TypeError(`options.${name} must be a function`);
    }
  }
  const normalized = [];
  const centroidM = [0, 0, 0];
  const meanVelocityMPerS = [0, 0, 0];
  const positionM2 = Array(9).fill(0);
  const velocityM2 = Array(9).fill(0);
  const minimum = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const maximum = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  let totalMassKg = 0;
  let contributingSamples = 0;
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    const positionM = samplePosition(sample, index, options.positionAccessor);
    const velocityMPerS = sampleVelocity(sample, index, options.velocityAccessor);
    const massKg = sampleMass(sample, index, options.massAccessor, defaultMassKg);
    normalized.push({ positionM, velocityMPerS, massKg });
    if (massKg <= 0) continue;
    for (let axis = 0; axis < 3; axis++) {
      minimum[axis] = Math.min(minimum[axis], positionM[axis]);
      maximum[axis] = Math.max(maximum[axis], positionM[axis]);
    }
    const previousMassKg = totalMassKg;
    const nextMassKg = previousMassKg + massKg;
    weightedMomentUpdate(
      centroidM,
      positionM2,
      positionM,
      massKg,
      nextMassKg,
    );
    weightedMomentUpdate(
      meanVelocityMPerS,
      velocityM2,
      velocityMPerS,
      massKg,
      nextMassKg,
    );
    totalMassKg = nextMassKg;
    contributingSamples += 1;
  }
  if (!(totalMassKg > 0)) throw new RangeError('samples require positive total mass');
  const positionCovarianceM2 = positionM2.map(value => value / totalMassKg);
  const velocityCovarianceM2PerS2 = velocityM2.map(value => value / totalMassKg);
  for (const [left, right] of [[1, 3], [2, 6], [5, 7]]) {
    const positionAverage = (positionCovarianceM2[left] + positionCovarianceM2[right]) * 0.5;
    positionCovarianceM2[left] = positionAverage;
    positionCovarianceM2[right] = positionAverage;
    const velocityAverage = (
      velocityCovarianceM2PerS2[left] + velocityCovarianceM2PerS2[right]
    ) * 0.5;
    velocityCovarianceM2PerS2[left] = velocityAverage;
    velocityCovarianceM2PerS2[right] = velocityAverage;
  }
  const linearMomentumKgMPerS = meanVelocityMPerS.map(value => value * totalMassKg);
  const angularMomentumAboutOriginKgM2PerS = [0, 0, 0];
  const angularMomentumAboutCentroidKgM2PerS = [0, 0, 0];
  let kineticEnergyJ = 0;
  for (const sample of normalized) {
    const momentum = sample.velocityMPerS.map(value => value * sample.massKg);
    const angularOrigin = vec3Cross(sample.positionM, momentum);
    const relativePosition = sample.positionM.map((value, axis) => value - centroidM[axis]);
    const relativeMomentum = sample.velocityMPerS.map(
      (value, axis) => (value - meanVelocityMPerS[axis]) * sample.massKg,
    );
    const angularCentroid = vec3Cross(relativePosition, relativeMomentum);
    for (let axis = 0; axis < 3; axis++) {
      angularMomentumAboutOriginKgM2PerS[axis] += angularOrigin[axis];
      angularMomentumAboutCentroidKgM2PerS[axis] += angularCentroid[axis];
    }
    kineticEnergyJ += 0.5 * sample.massKg * vec3Dot(sample.velocityMPerS, sample.velocityMPerS);
  }
  const decomposition = eigSym3(positionCovarianceM2);
  const order = [0, 1, 2].sort((left, right) => (
    decomposition.values[right] - decomposition.values[left] || left - right
  ));
  const principalVariancesM2 = order.map(index => Math.max(0, decomposition.values[index]));
  const principalAxes = order.map(index => vec3Normalize(decomposition.vectors[index]));
  if (vec3Dot(vec3Cross(principalAxes[0], principalAxes[1]), principalAxes[2]) < 0) {
    principalAxes[2] = principalAxes[2].map(value => -value);
  }
  return deepFreeze({
    sampleCount: samples.length,
    contributingSamples,
    totalMassKg,
    centroidM,
    meanVelocityMPerS,
    linearMomentumKgMPerS,
    angularMomentumAboutOriginKgM2PerS,
    angularMomentumAboutCentroidKgM2PerS,
    kineticEnergyJ,
    positionCovarianceM2,
    velocityCovarianceM2PerS2,
    principalVariancesM2,
    principalAxes,
    rmsRadiusM: Math.sqrt(
      positionCovarianceM2[0] + positionCovarianceM2[4] + positionCovarianceM2[8],
    ),
    boundsM: [...minimum, ...maximum],
  });
}

/** Build an OrientedKernelSet-compatible descriptor from aggregate moments. */
export function createParticleCohortKernelDescriptor(moments, options = {}) {
  if (!moments || typeof moments !== 'object') throw new TypeError('moments are required');
  const center = finiteVec3(moments.centroidM, 'moments.centroidM');
  const covariance = moments.positionCovarianceM2;
  if ((!Array.isArray(covariance) && !ArrayBuffer.isView(covariance)) || covariance.length < 9) {
    throw new TypeError('moments.positionCovarianceM2 requires nine values');
  }
  const validatedCovariance = Array.from(covariance).slice(0, 9).map((value, index) => (
    finite(value, `moments.positionCovarianceM2[${index}]`)
  ));
  const decomposition = eigSym3(validatedCovariance);
  const order = [0, 1, 2].sort((left, right) => (
    decomposition.values[right] - decomposition.values[left] || left - right
  ));
  const axes = order.map(index => vec3Normalize(decomposition.vectors[index]));
  if (vec3Dot(vec3Cross(axes[0], axes[1]), axes[2]) < 0) {
    axes[2] = axes[2].map(value => -value);
  }
  const sigmaScale = finite(options.sigmaScale ?? 2, 'options.sigmaScale', {
    minimum: Number.MIN_VALUE,
  });
  const minimumRadiusM = finite(options.minimumRadiusM ?? 1e-4, 'options.minimumRadiusM', {
    minimum: Number.MIN_VALUE,
  });
  const maximumRadiusM = finite(options.maximumRadiusM ?? 1e6, 'options.maximumRadiusM', {
    minimum: minimumRadiusM,
  });
  const principalVariancesM2 = order.map(index => Math.max(0, decomposition.values[index]));
  const radius = principalVariancesM2.map(variance => (
    clamp(Math.sqrt(variance) * sigmaScale, minimumRadiusM, maximumRadiusM)
  ));
  const rotationMatrix = [
    axes[0][0], axes[1][0], axes[2][0],
    axes[0][1], axes[1][1], axes[2][1],
    axes[0][2], axes[1][2], axes[2][2],
  ];
  const orientation = mat3ToQuat(rotationMatrix);
  const quaternionLength = Math.hypot(...orientation);
  const normalizedOrientation = quaternionLength > EPSILON
    ? orientation.map(value => value / quaternionLength)
    : [0, 0, 0, 1];
  return deepFreeze({
    id: identifier(options.id ?? 'particle-cohort-kernel', 'options.id'),
    center,
    radius,
    orientation: normalizedOrientation,
    color: finiteVec3(options.color, 'options.color', [1, 1, 1]),
    opacity: clamp(finite(options.opacity ?? 1, 'options.opacity'), 0, 1),
    motion: {
      velocityMPerS: finiteVec3(
        moments.meanVelocityMPerS,
        'moments.meanVelocityMPerS',
        [0, 0, 0],
      ),
    },
    aggregate: {
      sampleCount: integer(moments.sampleCount, 'moments.sampleCount', { minimum: 1 }),
      massKg: finite(moments.totalMassKg, 'moments.totalMassKg', { minimum: Number.MIN_VALUE }),
      covarianceM2: validatedCovariance,
      principalVariancesM2,
      axes,
    },
  });
}

function configurationFrom(options) {
  return deepFreeze({
    minimumResidencyFrames: integer(
      options.minimumResidencyFrames ?? DEFAULT_OPTIONS.minimumResidencyFrames,
      'options.minimumResidencyFrames',
      { maximum: 1_000_000 },
    ),
    promotionFrames: integer(
      options.promotionFrames ?? DEFAULT_OPTIONS.promotionFrames,
      'options.promotionFrames',
      { minimum: 1, maximum: 1_000_000 },
    ),
    lateralSwitchFrames: integer(
      options.lateralSwitchFrames ?? DEFAULT_OPTIONS.lateralSwitchFrames,
      'options.lateralSwitchFrames',
      { minimum: 1, maximum: 1_000_000 },
    ),
    sleepingStableFrames: integer(
      options.sleepingStableFrames ?? DEFAULT_OPTIONS.sleepingStableFrames,
      'options.sleepingStableFrames',
      { minimum: 1, maximum: 1_000_000 },
    ),
    sleepingMaximumSpeedMPerS: finite(
      options.sleepingMaximumSpeedMPerS ?? DEFAULT_OPTIONS.sleepingMaximumSpeedMPerS,
      'options.sleepingMaximumSpeedMPerS',
      { minimum: 0 },
    ),
    packedPositionErrorMaxM: finite(
      options.packedPositionErrorMaxM ?? DEFAULT_OPTIONS.packedPositionErrorMaxM,
      'options.packedPositionErrorMaxM',
      { minimum: 0 },
    ),
    packedVelocityErrorMaxMPerS: finite(
      options.packedVelocityErrorMaxMPerS ?? DEFAULT_OPTIONS.packedVelocityErrorMaxMPerS,
      'options.packedVelocityErrorMaxMPerS',
      { minimum: 0 },
    ),
    momentDensityErrorMaxFraction: finite(
      options.momentDensityErrorMaxFraction ?? DEFAULT_OPTIONS.momentDensityErrorMaxFraction,
      'options.momentDensityErrorMaxFraction',
      { minimum: 0, maximum: 1 },
    ),
    momentMaximumProjectedRadiusPx: finite(
      options.momentMaximumProjectedRadiusPx ?? DEFAULT_OPTIONS.momentMaximumProjectedRadiusPx,
      'options.momentMaximumProjectedRadiusPx',
      { minimum: 0 },
    ),
    proceduralPositionErrorMaxM: finite(
      options.proceduralPositionErrorMaxM ?? DEFAULT_OPTIONS.proceduralPositionErrorMaxM,
      'options.proceduralPositionErrorMaxM',
      { minimum: 0 },
    ),
    proceduralVelocityErrorMaxMPerS: finite(
      options.proceduralVelocityErrorMaxMPerS ?? DEFAULT_OPTIONS.proceduralVelocityErrorMaxMPerS,
      'options.proceduralVelocityErrorMaxMPerS',
      { minimum: 0 },
    ),
    proceduralMinimumCoherence: finite(
      options.proceduralMinimumCoherence ?? DEFAULT_OPTIONS.proceduralMinimumCoherence,
      'options.proceduralMinimumCoherence',
      { minimum: 0, maximum: 1 },
    ),
    fieldMassErrorMaxFraction: finite(
      options.fieldMassErrorMaxFraction ?? DEFAULT_OPTIONS.fieldMassErrorMaxFraction,
      'options.fieldMassErrorMaxFraction',
      { minimum: 0, maximum: 1 },
    ),
    fieldDivergenceErrorMax: finite(
      options.fieldDivergenceErrorMax ?? DEFAULT_OPTIONS.fieldDivergenceErrorMax,
      'options.fieldDivergenceErrorMax',
      { minimum: 0 },
    ),
    fieldMinimumScreenCoverage: finite(
      options.fieldMinimumScreenCoverage ?? DEFAULT_OPTIONS.fieldMinimumScreenCoverage,
      'options.fieldMinimumScreenCoverage',
      { minimum: 0, maximum: 1 },
    ),
  });
}

function normalizePreferredQueue(value, path) {
  if (value == null || value === 'automatic' || value === 'auto') return 'automatic';
  const queue = String(value).toLowerCase();
  if (!QUEUE_SET.has(queue)) throw new TypeError(`${path} has unsupported queue '${queue}'`);
  return queue;
}

function normalizePage(page, index) {
  if (!page || typeof page !== 'object') throw new TypeError(`pages[${index}] must be an object`);
  const id = identifier(page.id, `pages[${index}].id`);
  const capabilitiesInput = page.capabilities ?? {};
  const certificatesInput = page.certificates ?? {};
  const errorsInput = page.errors ?? {};
  const activityInput = page.activity ?? {};
  const presentationInput = page.presentation ?? {};
  const capabilities = Object.fromEntries(PARTICLE_COHORT_PRESENTATION_QUEUES.map(queue => [
    queue,
    queue === 'raw' || boolean(capabilitiesInput[queue]),
  ]));
  const branchField = capabilities.procedural
    ? normalizeParticleBranchFieldDescriptor(page.branchField)
    : null;
  const contacts = Math.max(0, Math.floor(optionalFinite(activityInput.contactCount, 0)));
  const rayHits = Math.max(0, Math.floor(optionalFinite(activityInput.rayHitCount, 0)));
  const predictedRefinements = Math.max(
    0,
    Math.floor(optionalFinite(activityInput.predictedRefinements, 0)),
  );
  const selected = boolean(activityInput.selected);
  const requiresExplicitState = boolean(activityInput.requiresExplicitState)
    || selected || contacts > 0 || rayHits > 0 || predictedRefinements > 0;
  return deepFreeze({
    id,
    sourceRevision: integer(page.sourceRevision ?? 0, `pages[${index}].sourceRevision`),
    representationRevision: integer(
      page.representationRevision ?? 0,
      `pages[${index}].representationRevision`,
    ),
    simulationAuthority: identifier(
      page.simulationAuthority ?? 'particle-storm',
      `pages[${index}].simulationAuthority`,
    ),
    preferredQueue: normalizePreferredQueue(
      page.preferredQueue,
      `pages[${index}].preferredQueue`,
    ),
    capabilities,
    certificates: {
      packed: boolean(certificatesInput.packed),
      moment: boolean(certificatesInput.moment),
      procedural: boolean(certificatesInput.procedural),
      field: boolean(certificatesInput.field),
      hasCoarseResidentFieldLevel: boolean(certificatesInput.hasCoarseResidentFieldLevel),
    },
    errors: {
      packedPositionM: optionalFinite(errorsInput.packedPositionM),
      packedVelocityMPerS: optionalFinite(errorsInput.packedVelocityMPerS),
      momentDensityFraction: optionalFinite(errorsInput.momentDensityFraction),
      proceduralPositionM: optionalFinite(errorsInput.proceduralPositionM),
      proceduralVelocityMPerS: optionalFinite(errorsInput.proceduralVelocityMPerS),
      fieldMassFraction: optionalFinite(errorsInput.fieldMassFraction),
      fieldDivergence: optionalFinite(errorsInput.fieldDivergence),
    },
    activity: {
      contacts,
      rayHits,
      predictedRefinements,
      selected,
      requiresExplicitState,
      stableFrames: Math.max(0, Math.floor(optionalFinite(activityInput.stableFrames, 0))),
      speedMPerS: Math.max(0, optionalFinite(activityInput.speedMPerS)),
    },
    presentation: {
      visible: boolean(presentationInput.visible, true),
      projectedRadiusPx: Math.max(0, optionalFinite(presentationInput.projectedRadiusPx)),
      screenCoverage: clamp(optionalFinite(presentationInput.screenCoverage, 0), 0, 1),
      volumetric: boolean(presentationInput.volumetric),
      coherence: clamp(optionalFinite(presentationInput.coherence, 0), 0, 1),
    },
    branchField,
  });
}

function queueEligibility(page, configuration) {
  const blockedByInteraction = page.activity.requiresExplicitState;
  const eligible = {
    raw: { eligible: true, reason: blockedByInteraction ? 'explicit interaction requires raw presentation' : 'raw presentation is always available' },
    packed: {
      eligible: !blockedByInteraction
        && page.capabilities.packed
        && page.certificates.packed
        && page.errors.packedPositionM <= configuration.packedPositionErrorMaxM
        && page.errors.packedVelocityMPerS <= configuration.packedVelocityErrorMaxMPerS,
      reason: 'page-relative packed state is certified within position and velocity error bounds',
    },
    moment: {
      eligible: !blockedByInteraction
        && page.capabilities.moment
        && page.certificates.moment
        && page.errors.momentDensityFraction <= configuration.momentDensityErrorMaxFraction
        && page.presentation.projectedRadiusPx <= configuration.momentMaximumProjectedRadiusPx,
      reason: 'aggregate moment kernel is certified below the screen-space density bound',
    },
    procedural: {
      eligible: !blockedByInteraction
        && page.capabilities.procedural
        && page.certificates.procedural
        && page.branchField !== null
        && page.presentation.coherence >= configuration.proceduralMinimumCoherence
        && page.errors.proceduralPositionM <= configuration.proceduralPositionErrorMaxM
        && page.errors.proceduralVelocityMPerS <= configuration.proceduralVelocityErrorMaxMPerS,
      reason: 'bounded branch field is certified within motion residual bounds',
    },
    field: {
      eligible: !blockedByInteraction
        && page.capabilities.field
        && page.certificates.field
        && page.certificates.hasCoarseResidentFieldLevel
        && page.errors.fieldMassFraction <= configuration.fieldMassErrorMaxFraction
        && page.errors.fieldDivergence <= configuration.fieldDivergenceErrorMax,
      reason: 'sparse field has a certified resident fallback within conservation bounds',
    },
    sleeping: {
      eligible: !blockedByInteraction
        && page.capabilities.sleeping
        && !page.presentation.visible
        && page.activity.stableFrames >= configuration.sleepingStableFrames
        && page.activity.speedMPerS <= configuration.sleepingMaximumSpeedMPerS,
      reason: 'invisible stable page emits no presentation work while simulation remains authoritative',
    },
  };
  for (const queue of PARTICLE_COHORT_PRESENTATION_QUEUES) {
    if (!eligible[queue].eligible && queue !== 'raw') {
      eligible[queue].reason = `${queue} certificate or admission gate failed`;
    }
  }
  return eligible;
}

function automaticQueue(page, eligibility, configuration) {
  if (page.activity.requiresExplicitState) return 'raw';
  if (eligibility.sleeping.eligible) return 'sleeping';
  if (eligibility.field.eligible
      && page.presentation.volumetric
      && page.presentation.screenCoverage >= configuration.fieldMinimumScreenCoverage) {
    return 'field';
  }
  if (eligibility.procedural.eligible) return 'procedural';
  if (eligibility.moment.eligible) return 'moment';
  if (eligibility.packed.eligible) return 'packed';
  return 'raw';
}

function requestedQueue(page, eligibility, configuration) {
  const preferred = page.preferredQueue;
  if (preferred === 'automatic') return automaticQueue(page, eligibility, configuration);
  return FALLBACK_ORDER[preferred].find(queue => eligibility[queue].eligible) ?? 'raw';
}

function emitLog(logger, event, detail) {
  if (typeof logger === 'function') {
    logger(event, detail);
  } else if (typeof logger?.debug === 'function') {
    logger.debug(`[ParticleCohortPlanner] ${event}`, detail);
  }
}

/**
 * Stateful hysteresis controller for page-level presentation only. Canonical
 * simulation buffers are never mutated or reassigned by this planner.
 */
export class ParticleCohortPlanner {
  constructor(options = {}) {
    this.configuration = configurationFrom(options);
    this.logger = options.logger ?? null;
    this._state = new Map();
    this._lastFrameIndex = -1;
    this._metrics = {
      plans: 0,
      transitions: 0,
      immediateFallbacks: 0,
      hysteresisHolds: 0,
      revisionResets: 0,
      retiredPages: 0,
    };
  }

  _resolvePage(page, frameIndex) {
    const eligibility = queueEligibility(page, this.configuration);
    const requested = requestedQueue(page, eligibility, this.configuration);
    let state = this._state.get(page.id);
    let revisionReset = false;
    let transition = null;
    let heldForHysteresis = false;
    if (!state) {
      state = {
        queue: 'raw',
        sourceRevision: page.sourceRevision,
        sinceFrame: frameIndex,
        candidate: null,
        candidateFrames: 0,
        lastObservedFrame: frameIndex - 1,
      };
      this._state.set(page.id, state);
    } else if (state.sourceRevision !== page.sourceRevision) {
      const previousQueue = state.queue;
      state.queue = 'raw';
      state.sourceRevision = page.sourceRevision;
      state.sinceFrame = frameIndex;
      state.candidate = null;
      state.candidateFrames = 0;
      state.lastObservedFrame = frameIndex;
      revisionReset = true;
      this._metrics.revisionResets += 1;
      if (previousQueue !== 'raw') {
        transition = { from: previousQueue, to: 'raw', reason: 'source revision changed' };
        this._metrics.transitions += 1;
      }
    }

    const previousQueue = state.queue;
    const currentEligible = eligibility[state.queue].eligible;
    if (!currentEligible) {
      const safeFallback = FALLBACK_ORDER[previousQueue].find(
        queue => eligibility[queue].eligible,
      ) ?? 'raw';
      state.queue = safeFallback;
      state.sinceFrame = frameIndex;
      state.candidate = null;
      state.candidateFrames = 0;
      state.lastObservedFrame = frameIndex;
      if (previousQueue !== safeFallback) {
        transition = {
          from: previousQueue,
          to: safeFallback,
          reason: `${previousQueue} error gate failed`,
        };
        this._metrics.transitions += 1;
        this._metrics.immediateFallbacks += 1;
      }
    } else if (!revisionReset && requested !== state.queue) {
      if (state.candidate !== requested) {
        state.candidate = requested;
        state.candidateFrames = 0;
      }
      if (state.lastObservedFrame !== frameIndex) state.candidateFrames += 1;
      state.lastObservedFrame = frameIndex;
      const currentRank = QUEUE_COMPRESSION_RANK[state.queue];
      const requestedRank = QUEUE_COMPRESSION_RANK[requested];
      const requiredFrames = requestedRank > currentRank
        ? this.configuration.promotionFrames
        : requestedRank === currentRank
          ? this.configuration.lateralSwitchFrames
          : 0;
      const residenceFrames = Math.max(0, frameIndex - state.sinceFrame);
      const canSwitch = requiredFrames === 0
        || (state.candidateFrames >= requiredFrames
          && residenceFrames >= this.configuration.minimumResidencyFrames);
      if (canSwitch) {
        state.queue = requested;
        state.sinceFrame = frameIndex;
        state.candidate = null;
        state.candidateFrames = 0;
        transition = {
          from: previousQueue,
          to: requested,
          reason: requiredFrames === 0
            ? 'quality expansion bypassed compression hysteresis'
            : 'candidate satisfied presentation hysteresis',
        };
        this._metrics.transitions += 1;
      } else {
        heldForHysteresis = true;
        this._metrics.hysteresisHolds += 1;
      }
    } else {
      state.candidate = null;
      state.candidateFrames = 0;
      state.lastObservedFrame = frameIndex;
    }
    if (transition) emitLog(this.logger, 'presentation-transition', {
      pageId: page.id,
      frameIndex,
      ...transition,
      simulationAuthority: page.simulationAuthority,
    });
    const queue = state.queue;
    const queueIndex = PARTICLE_COHORT_QUEUE_INDEX[queue];
    return deepFreeze({
      pageId: page.id,
      sourceRevision: page.sourceRevision,
      representationRevision: page.representationRevision,
      queue,
      requestedQueue: requested,
      queueIndex,
      queueBit: 2 ** queueIndex,
      executionFamily: QUEUE_EXECUTION_FAMILY[queue],
      emitsPresentationWork: queue !== 'sleeping',
      heldForHysteresis,
      candidateFrames: state.candidateFrames,
      residenceFrames: Math.max(0, frameIndex - state.sinceFrame),
      revisionReset,
      transition,
      reason: heldForHysteresis
        ? `${requested} is eligible but has not satisfied hysteresis`
        : eligibility[queue].reason,
      eligibleQueues: PARTICLE_COHORT_PRESENTATION_QUEUES.filter(
        candidate => eligibility[candidate].eligible,
      ),
      gateReasons: Object.fromEntries(PARTICLE_COHORT_PRESENTATION_QUEUES.map(candidate => [
        candidate,
        eligibility[candidate].reason,
      ])),
      authority: {
        simulation: page.simulationAuthority,
        presentation: queue,
        canonicalSimulationUnchanged: true,
        simulationSleeps: false,
        writesSimulationState: false,
      },
    });
  }

  plan(pages, { frameIndex = 0 } = {}) {
    if (!Array.isArray(pages)) throw new TypeError('ParticleCohortPlanner.plan requires an array');
    const frame = integer(frameIndex, 'context.frameIndex');
    if (frame < this._lastFrameIndex) {
      throw new RangeError('context.frameIndex cannot move backwards');
    }
    this._lastFrameIndex = frame;
    const normalized = pages.map(normalizePage).sort((left, right) => (
      compareCanonicalStrings(left.id, right.id)
    ));
    const ids = new Set();
    for (const page of normalized) {
      if (ids.has(page.id)) throw new Error(`Duplicate particle cohort page '${page.id}'`);
      ids.add(page.id);
    }
    for (const id of Array.from(this._state.keys())) {
      if (!ids.has(id)) {
        this._state.delete(id);
        this._metrics.retiredPages += 1;
      }
    }
    const decisions = normalized.map(page => this._resolvePage(page, frame));
    const queues = Object.fromEntries(PARTICLE_COHORT_PRESENTATION_QUEUES.map(queue => [
      queue,
      decisions.filter(decision => decision.queue === queue).map(decision => decision.pageId),
    ]));
    const assignmentCount = Object.values(queues).reduce((sum, entries) => sum + entries.length, 0);
    const assignedIds = new Set(Object.values(queues).flat());
    if (assignmentCount !== decisions.length || assignedIds.size !== decisions.length) {
      throw new Error('Particle cohort queue assignment is not exclusive and complete');
    }
    this._metrics.plans += 1;
    return deepFreeze({
      schema: PARTICLE_COHORT_PLAN_SCHEMA,
      schemaVersion: PARTICLE_COHORT_PLAN_VERSION,
      frameIndex: frame,
      decisions,
      queues,
      counts: Object.fromEntries(PARTICLE_COHORT_PRESENTATION_QUEUES.map(queue => [
        queue,
        queues[queue].length,
      ])),
      invariants: {
        pageCount: decisions.length,
        assignmentCount,
        uniqueAssignmentCount: assignedIds.size,
        exclusive: assignmentCount === decisions.length && assignedIds.size === decisions.length,
        unassigned: decisions.length - assignedIds.size,
      },
      authority: {
        role: 'presentation-planner',
        canonicalSimulationUnchanged: true,
        writesSimulationState: false,
        presentationQueuesExclusive: true,
      },
      metrics: { ...this._metrics },
    });
  }

  getPageState(pageId) {
    const state = this._state.get(String(pageId));
    return state ? deepFreeze({ ...state }) : null;
  }

  reset(pageId = null) {
    if (pageId == null) {
      this._state.clear();
      this._lastFrameIndex = -1;
      emitLog(this.logger, 'reset-all', {});
      return;
    }
    const id = String(pageId);
    this._state.delete(id);
    emitLog(this.logger, 'reset-page', { pageId: id });
  }

  getTelemetry() {
    return deepFreeze({
      configuration: this.configuration,
      activePages: this._state.size,
      lastFrameIndex: this._lastFrameIndex,
      metrics: { ...this._metrics },
    });
  }
}

export function createParticleCohortPlanner(options = {}) {
  return new ParticleCohortPlanner(options);
}

export default ParticleCohortPlanner;
