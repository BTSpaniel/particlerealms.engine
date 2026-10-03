// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { eigSym3 } from '../../assets/geometry/PrincipalAxes.js';
import { morton3DEncode } from '../../core/math/MathBits.js';
import { compareOrdinal, sha256Hex } from '../fabric/FabricSupport.js';

export const PARTICLE_KINEMATICS_SPATIAL_PLAN_SCHEMA =
  'engine.matter.particle-kinematics-spatial-page-plan';
export const PARTICLE_KINEMATICS_SPATIAL_PLAN_VERSION = '1.0.0';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;
const DEFAULT_MAXIMUM_CONDITION = 1e8;
const DEFAULT_EIGENVALUE_FLOOR_M2 = 1e-10;

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const entry of Object.values(value)) deepFreeze(entry, seen);
  return Object.freeze(value);
}

function record(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value;
}

function integer(value, path, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${path} must be a safe integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function finite(value, path) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new RangeError(`${path} must be finite`);
  return number;
}

function nonNegativeLimit(value, path, fallback) {
  if (value == null) return fallback === Number.POSITIVE_INFINITY ? Number.MAX_VALUE : fallback;
  if (value === Number.POSITIVE_INFINITY) return Number.MAX_VALUE;
  const number = finite(value, path);
  if (number < 0) throw new RangeError(`${path} must be non-negative`);
  return number;
}

function identifier(value, path) {
  const result = String(value ?? '');
  if (!IDENTIFIER.test(result)) throw new TypeError(`${path} has invalid identifier syntax`);
  return result;
}

function fingerprint(value) {
  const chunks = [];
  for (let start = 0; start < value.length; start += 2048) {
    chunks.push(sha256Hex(JSON.stringify(value.slice(start, start + 2048))));
  }
  return `sha256:${sha256Hex(JSON.stringify({ count: value.length, chunks }))}`;
}

function vector3(value, path) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length < 3) {
    throw new TypeError(`${path} requires three values`);
  }
  return [
    finite(value[0], `${path}[0]`),
    finite(value[1], `${path}[1]`),
    finite(value[2], `${path}[2]`),
  ];
}

function defaultPosition(particle) {
  return particle?.positionM ?? particle?.position ?? particle?.positionLife;
}

function normalizeDomain(domainInput, items) {
  if (items.length === 0) {
    const source = domainInput ?? { minimumM: [0, 0, 0], maximumM: [1, 1, 1] };
    return normalizeDomain(source, [{ positionM: [0, 0, 0] }, { positionM: [1, 1, 1] }]);
  }
  let minimumM;
  let maximumM;
  let configured = false;
  if (domainInput != null) {
    configured = true;
    if (Array.isArray(domainInput) || ArrayBuffer.isView(domainInput)) {
      if (domainInput.length < 6) throw new TypeError('domain requires six values');
      minimumM = vector3(domainInput, 'domain.minimumM');
      maximumM = vector3(Array.from(domainInput).slice(3), 'domain.maximumM');
    } else {
      const domain = record(domainInput, 'domain');
      minimumM = vector3(domain.minimumM ?? domain.minimum, 'domain.minimumM');
      maximumM = vector3(domain.maximumM ?? domain.maximum, 'domain.maximumM');
    }
  } else {
    minimumM = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    maximumM = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const item of items) {
      for (let axis = 0; axis < 3; axis++) {
        minimumM[axis] = Math.min(minimumM[axis], item.positionM[axis]);
        maximumM[axis] = Math.max(maximumM[axis], item.positionM[axis]);
      }
    }
  }
  for (let axis = 0; axis < 3; axis++) {
    if (maximumM[axis] < minimumM[axis]) {
      throw new RangeError(`domain.maximumM[${axis}] cannot be less than domain.minimumM[${axis}]`);
    }
    if (maximumM[axis] === minimumM[axis]) {
      const padding = Math.max(1e-6, Math.abs(maximumM[axis]) * 1e-9);
      minimumM[axis] -= padding;
      maximumM[axis] += padding;
    }
  }
  return { minimumM, maximumM, configured };
}

function sourceItems(source, options) {
  if (source.particles != null) {
    if (!Array.isArray(source.particles)) throw new TypeError('particles must be an array');
    const positionAccessor = options.positionAccessor ?? defaultPosition;
    const identityAccessor = options.identityAccessor
      ?? ((particle, index) => particle?.id ?? particle?.sourceParticleIndex ?? index);
    if (typeof positionAccessor !== 'function') throw new TypeError('positionAccessor must be a function');
    if (typeof identityAccessor !== 'function') throw new TypeError('identityAccessor must be a function');
    return source.particles.map((particle, sourceIndex) => ({
      sourceIndex,
      id: identifier(identityAccessor(particle, sourceIndex), `particles[${sourceIndex}].id`),
      positionM: vector3(
        positionAccessor(particle, sourceIndex),
        `particles[${sourceIndex}].positionM`,
      ),
    }));
  }
  const positions = source.positions;
  if (!Array.isArray(positions) && !ArrayBuffer.isView(positions)) {
    throw new TypeError('particles or flat positions are required');
  }
  const stride = integer(source.positionStride ?? 3, 'positionStride', 3, 64);
  const count = integer(
    source.count ?? Math.floor(positions.length / stride),
    'count',
    0,
    Math.floor(positions.length / stride),
  );
  const ids = source.particleIds;
  if (ids != null && (!Array.isArray(ids) || ids.length < count)) {
    throw new TypeError('particleIds must contain one id per position');
  }
  return Array.from({ length: count }, (_unused, sourceIndex) => ({
    sourceIndex,
    id: identifier(ids?.[sourceIndex] ?? sourceIndex, `particleIds[${sourceIndex}]`),
    positionM: vector3(
      positions.slice(sourceIndex * stride, sourceIndex * stride + 3),
      `positions[${sourceIndex}]`,
    ),
  }));
}

function quantizedAxis(value, minimum, maximum) {
  const normalized = (value - minimum) / (maximum - minimum);
  return Math.max(0, Math.min(1023, Math.round(normalized * 1023)));
}

function annotateSpatialIdentity(items, domain) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) throw new Error(`Particle spatial identity '${item.id}' is duplicated`);
    seen.add(item.id);
    item.outsideDomain = item.positionM.some((value, axis) => (
      value < domain.minimumM[axis] || value > domain.maximumM[axis]
    ));
    item.mortonCode = morton3DEncode(
      quantizedAxis(item.positionM[0], domain.minimumM[0], domain.maximumM[0]),
      quantizedAxis(item.positionM[1], domain.minimumM[1], domain.maximumM[1]),
      quantizedAxis(item.positionM[2], domain.minimumM[2], domain.maximumM[2]),
    ) >>> 0;
  }
  items.sort((left, right) => (
    left.mortonCode - right.mortonCode
    || compareOrdinal(left.id, right.id)
    || left.sourceIndex - right.sourceIndex
  ));
}

function clusterMoments(items, eigenvalueFloorM2) {
  const count = items.length;
  const centroidM = [0, 0, 0];
  const minimumM = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const maximumM = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const item of items) {
    for (let axis = 0; axis < 3; axis++) {
      centroidM[axis] += item.positionM[axis];
      minimumM[axis] = Math.min(minimumM[axis], item.positionM[axis]);
      maximumM[axis] = Math.max(maximumM[axis], item.positionM[axis]);
    }
  }
  for (let axis = 0; axis < 3; axis++) centroidM[axis] /= count;
  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;
  let supportRadiusM = 0;
  for (const item of items) {
    const x = item.positionM[0] - centroidM[0];
    const y = item.positionM[1] - centroidM[1];
    const z = item.positionM[2] - centroidM[2];
    xx += x * x;
    xy += x * y;
    xz += x * z;
    yy += y * y;
    yz += y * z;
    zz += z * z;
    supportRadiusM = Math.max(supportRadiusM, Math.hypot(x, y, z));
  }
  const inverseCount = 1 / count;
  const covarianceM2 = [
    xx * inverseCount, xy * inverseCount, xz * inverseCount,
    xy * inverseCount, yy * inverseCount, yz * inverseCount,
    xz * inverseCount, yz * inverseCount, zz * inverseCount,
  ];
  const decomposition = eigSym3(covarianceM2);
  const principalVariancesM2 = [...decomposition.values].sort((left, right) => right - left);
  const significantVariancesM2 = principalVariancesM2.filter(value => value > eigenvalueFloorM2);
  const intrinsicDimension = significantVariancesM2.length;
  const covarianceConditionNumber = intrinsicDimension <= 1
    ? 1
    : significantVariancesM2[0] / significantVariancesM2[intrinsicDimension - 1];
  const boundsDiagonalM = Math.hypot(
    maximumM[0] - minimumM[0],
    maximumM[1] - minimumM[1],
    maximumM[2] - minimumM[2],
  );
  return {
    centroidM,
    covarianceM2,
    principalVariancesM2,
    intrinsicDimension,
    covarianceConditionNumber,
    supportRadiusM,
    boundsM: [...minimumM, ...maximumM],
    boundsDiagonalM,
  };
}

function safetyReasons(items, moments, configuration) {
  const reasons = [];
  if (items.some(item => item.outsideDomain)) reasons.push('outside-domain');
  if (moments.supportRadiusM > configuration.maximumPageRadiusM) {
    reasons.push('support-radius-exceeded');
  }
  if (moments.boundsDiagonalM > configuration.maximumBoundsDiagonalM) {
    reasons.push('bounds-diagonal-exceeded');
  }
  if (moments.principalVariancesM2.some(value => (
    !Number.isFinite(value) || value < -configuration.covarianceNegativeToleranceM2
  ))) {
    reasons.push('covariance-not-positive-semidefinite');
  }
  if (!Number.isFinite(moments.covarianceConditionNumber)
      || moments.covarianceConditionNumber > configuration.maximumCovarianceConditionNumber) {
    reasons.push('covariance-condition-exceeded');
  }
  return reasons;
}

function splitAxisForMoments(moments) {
  const extents = [0, 1, 2].map(axis => moments.boundsM[axis + 3] - moments.boundsM[axis]);
  return extents.indexOf(Math.max(...extents));
}

function pageRecord(items, moments, depth, reasonCodes, ordinal) {
  const canonicalMembers = [...items].sort((left, right) => compareOrdinal(left.id, right.id));
  const memberIds = canonicalMembers.map(item => item.id);
  const memberIndices = canonicalMembers.map(item => item.sourceIndex);
  const membershipFingerprint = fingerprint(memberIds);
  const eligibleForCompression = reasonCodes.length === 0;
  let minimumMortonCode = 0xffffffff;
  let maximumMortonCode = 0;
  for (const item of items) {
    minimumMortonCode = Math.min(minimumMortonCode, item.mortonCode);
    maximumMortonCode = Math.max(maximumMortonCode, item.mortonCode);
  }
  return {
    id: `particle-spatial-page.${membershipFingerprint.slice('sha256:'.length)}`,
    pageIndex: ordinal,
    memberCount: items.length,
    memberIds,
    memberIndices,
    spatialMemberIndices: items.map(item => item.sourceIndex),
    membershipFingerprint,
    mortonRange: [minimumMortonCode, maximumMortonCode],
    centroidM: moments.centroidM,
    covarianceM2: moments.covarianceM2,
    principalVariancesM2: moments.principalVariancesM2,
    intrinsicDimension: moments.intrinsicDimension,
    covarianceConditionNumber: moments.covarianceConditionNumber,
    supportRadiusM: moments.supportRadiusM,
    boundsM: moments.boundsM,
    boundsDiagonalM: moments.boundsDiagonalM,
    subdivisionDepth: depth,
    eligibleForCompression,
    fallbackRepresentation: eligibleForCompression ? null : 'raw',
    reasonCodes,
  };
}

/**
 * Morton-cluster particles before page construction. Unsafe candidate pages
 * are split along their longest spatial axis until safe or until the configured
 * minimum size/depth is reached; an irreducible unsafe page remains present
 * with explicit canonical-raw fallback ownership.
 */
export function planParticleKinematicsSpatialPages(input, options = {}) {
  const source = record(input, 'input');
  const pageSize = integer(options.pageSize ?? source.pageSize ?? 256, 'pageSize', 1, 65_536);
  const minimumPageSize = integer(
    options.minimumPageSize ?? source.minimumPageSize ?? Math.min(8, pageSize),
    'minimumPageSize',
    1,
    pageSize,
  );
  const configuration = {
    pageSize,
    minimumPageSize,
    maximumSubdivisionDepth: integer(
      options.maximumSubdivisionDepth ?? 16,
      'maximumSubdivisionDepth',
      0,
      64,
    ),
    maximumPageRadiusM: nonNegativeLimit(
      options.maximumPageRadiusM,
      'maximumPageRadiusM',
      Number.POSITIVE_INFINITY,
    ),
    maximumBoundsDiagonalM: nonNegativeLimit(
      options.maximumBoundsDiagonalM,
      'maximumBoundsDiagonalM',
      Number.POSITIVE_INFINITY,
    ),
    maximumCovarianceConditionNumber: nonNegativeLimit(
      options.maximumCovarianceConditionNumber,
      'maximumCovarianceConditionNumber',
      DEFAULT_MAXIMUM_CONDITION,
    ),
    covarianceEigenvalueFloorM2: nonNegativeLimit(
      options.covarianceEigenvalueFloorM2,
      'covarianceEigenvalueFloorM2',
      DEFAULT_EIGENVALUE_FLOOR_M2,
    ),
    covarianceNegativeToleranceM2: nonNegativeLimit(
      options.covarianceNegativeToleranceM2,
      'covarianceNegativeToleranceM2',
      1e-9,
    ),
  };
  if (configuration.covarianceEigenvalueFloorM2 === 0) {
    throw new RangeError('covarianceEigenvalueFloorM2 must be greater than zero');
  }
  const items = sourceItems(source, options);
  const domain = normalizeDomain(options.domain ?? source.domain, items);
  annotateSpatialIdentity(items, domain);
  const pages = [];
  let subdivisionCount = 0;

  const appendCluster = (cluster, depth) => {
    const moments = clusterMoments(cluster, configuration.covarianceEigenvalueFloorM2);
    const reasons = safetyReasons(cluster, moments, configuration);
    const canSplit = reasons.length > 0
      && cluster.length >= minimumPageSize * 2
      && depth < configuration.maximumSubdivisionDepth;
    if (canSplit) {
      subdivisionCount += 1;
      const axis = splitAxisForMoments(moments);
      const ordered = [...cluster].sort((left, right) => (
        left.positionM[axis] - right.positionM[axis]
        || left.mortonCode - right.mortonCode
        || compareOrdinal(left.id, right.id)
      ));
      const midpoint = Math.floor(ordered.length / 2);
      appendCluster(ordered.slice(0, midpoint), depth + 1);
      appendCluster(ordered.slice(midpoint), depth + 1);
      return;
    }
    pages.push(pageRecord(cluster, moments, depth, reasons, pages.length));
  };

  for (let start = 0; start < items.length; start += pageSize) {
    appendCluster(items.slice(start, Math.min(items.length, start + pageSize)), 0);
  }
  const membershipFingerprint = fingerprint(items.map(item => item.id).sort(compareOrdinal));
  return deepFreeze({
    schema: PARTICLE_KINEMATICS_SPATIAL_PLAN_SCHEMA,
    schemaVersion: PARTICLE_KINEMATICS_SPATIAL_PLAN_VERSION,
    ordering: 'morton-before-page-formation',
    domain,
    configuration,
    sourceParticleCount: items.length,
    sourceMembershipFingerprint: membershipFingerprint,
    pages,
    metrics: {
      pageCount: pages.length,
      eligiblePageCount: pages.filter(page => page.eligibleForCompression).length,
      fallbackPageCount: pages.filter(page => !page.eligibleForCompression).length,
      subdivisionCount,
      maximumMemberCount: pages.reduce((maximum, page) => Math.max(maximum, page.memberCount), 0),
    },
    authority: {
      clustersBeforeEncoding: true,
      unsafePagesRetainCanonicalFallback: true,
      grantsSimulationAuthority: false,
    },
  });
}

export default planParticleKinematicsSpatialPages;
