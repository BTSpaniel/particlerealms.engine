// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MeshAttributeMath.js - glTF-style accessor component, stride, tangent-frame, and decode helpers.

import {
  EPSILON,
} from './MathConstants.js';
import {
  checksumHex32,
  fnv1aLowByteString32,
  fnv1aTaggedFloat32Sequence32,
  fnv1aTaggedUint32Sequence32,
} from './ChecksumMath.js';
import {
  vec3Cross,
  vec3Dot,
  vec3LengthSq,
  vec3Normalize,
  vec3Scale,
  vec3Sub,
} from './MathVec3.js';

export const GLTF_COMPONENT_TYPES = Object.freeze({
  BYTE: 5120,
  UNSIGNED_BYTE: 5121,
  SHORT: 5122,
  UNSIGNED_SHORT: 5123,
  UNSIGNED_INT: 5125,
  FLOAT: 5126,
});

const COMPONENT_TYPED_ARRAYS = new Map([
  [GLTF_COMPONENT_TYPES.BYTE, Int8Array],
  [GLTF_COMPONENT_TYPES.UNSIGNED_BYTE, Uint8Array],
  [GLTF_COMPONENT_TYPES.SHORT, Int16Array],
  [GLTF_COMPONENT_TYPES.UNSIGNED_SHORT, Uint16Array],
  [GLTF_COMPONENT_TYPES.UNSIGNED_INT, Uint32Array],
  [GLTF_COMPONENT_TYPES.FLOAT, Float32Array],
]);

const COMPONENT_BYTE_SIZES = new Map([
  [GLTF_COMPONENT_TYPES.BYTE, 1],
  [GLTF_COMPONENT_TYPES.UNSIGNED_BYTE, 1],
  [GLTF_COMPONENT_TYPES.SHORT, 2],
  [GLTF_COMPONENT_TYPES.UNSIGNED_SHORT, 2],
  [GLTF_COMPONENT_TYPES.UNSIGNED_INT, 4],
  [GLTF_COMPONENT_TYPES.FLOAT, 4],
]);

const ACCESSOR_ELEMENT_COUNTS = Object.freeze({
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
});

const DEFAULT_TANGENT_NORMAL = Object.freeze([0, 0, 1]);
const DEFAULT_TANGENT_VECTOR = Object.freeze([1, 0, 0]);
const DEFAULT_TANGENT_SPLIT_ANGLE_DEGREES = 45;
const MIKK_TANGENT_UNIT_LENGTH_TOLERANCE = 1e-4;
export const TANGENT_SPACE_GENERATOR_FALLBACK = 'uv-derivative-fallback-with-corner-splits';
export const TANGENT_SPACE_GENERATOR_MIKK_FACE_OUTPUT = 'external-mikktspace-face-corner-output';
export const MIKK_REFERENCE_CORPUS_REGISTRY = Object.freeze({
  standard: 'MikkTSpace',
  version: '0-empty-unverified',
  caseCount: 0,
  cases: Object.freeze({}),
});

export const SKINNED_POSITION_BOUNDS_LIMITS = Object.freeze({
  influencesPerVertex: 4,
  maxVertices: 4_194_304,
  maxJoints: 65_536,
  maxCoordinateMagnitude: 1e9,
  weightSumTolerance: 1e-3,
});

export const MORPH_ATTRIBUTE_LIMITS = Object.freeze({
  maxVertices: 4_194_304,
  maxTargets: 256,
  maxWeightMagnitude: 1e4,
  maxValueMagnitude: 1e9,
});

const MORPH_CONTROL_MODES = Object.freeze(['animated', 'manual']);

/** Validate serializable per-model morph control state keyed by stable part index. */
export function morphWeightStateReport(value, options = {}) {
  const source = value == null ? [] : value;
  const optionsObject = !!options && typeof options === 'object' && !Array.isArray(options);
  const maxParts = optionsObject && options.maxParts !== undefined ? options.maxParts : 4096;
  const maxTargets = optionsObject && options.maxTargets !== undefined
    ? options.maxTargets : MORPH_ATTRIBUTE_LIMITS.maxTargets;
  const maxWeightMagnitude = optionsObject && options.maxWeightMagnitude !== undefined
    ? options.maxWeightMagnitude : MORPH_ATTRIBUTE_LIMITS.maxWeightMagnitude;
  const expectedTargetCounts = optionsObject && options.expectedTargetCounts instanceof Map
    ? options.expectedTargetCounts : null;
  const limitsValid = Number.isSafeInteger(maxParts) && maxParts > 0 && maxParts <= 4096
    && Number.isSafeInteger(maxTargets) && maxTargets > 0 && maxTargets <= MORPH_ATTRIBUTE_LIMITS.maxTargets
    && Number.isFinite(maxWeightMagnitude) && maxWeightMagnitude > 0
    && maxWeightMagnitude <= MORPH_ATTRIBUTE_LIMITS.maxWeightMagnitude;
  if (!Array.isArray(source) || !limitsValid || source.length > maxParts) {
    return { valid: false, value: null, reason: 'invalid-root', partCount: 0 };
  }
  const normalized = [];
  const partIndices = new Set();
  for (const entry of source) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || Object.keys(entry).some((key) => !['partIndex', 'mode', 'weights'].includes(key))
        || !Number.isSafeInteger(entry.partIndex) || entry.partIndex < 0 || entry.partIndex >= maxParts
        || partIndices.has(entry.partIndex) || !MORPH_CONTROL_MODES.includes(entry.mode)
        || !numericArrayLike(entry.weights) || entry.weights.length <= 0 || entry.weights.length > maxTargets) {
      return { valid: false, value: null, reason: 'invalid-entry', partCount: normalized.length };
    }
    const expectedCount = expectedTargetCounts?.get(entry.partIndex);
    if (expectedTargetCounts && (!Number.isSafeInteger(expectedCount) || expectedCount !== entry.weights.length)) {
      return { valid: false, value: null, reason: 'target-count-mismatch', partCount: normalized.length };
    }
    const weights = Array.from(entry.weights, Number);
    if (weights.some((weight) => !Number.isFinite(weight) || Math.abs(weight) > maxWeightMagnitude)) {
      return { valid: false, value: null, reason: 'invalid-weight', partCount: normalized.length };
    }
    partIndices.add(entry.partIndex);
    normalized.push({ partIndex: entry.partIndex, mode: entry.mode, weights });
  }
  if (expectedTargetCounts && (normalized.length !== expectedTargetCounts.size
      || [...expectedTargetCounts.keys()].some((partIndex) => !partIndices.has(partIndex)))) {
    return { valid: false, value: null, reason: 'part-set-mismatch', partCount: normalized.length };
  }
  normalized.sort((left, right) => left.partIndex - right.partIndex);
  return { valid: true, value: normalized, reason: null, partCount: normalized.length };
}

function numericArrayLike(value) {
  return Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView));
}

function positionBoundsFromValues(positions, maxMagnitude) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let invalidVertexIndex = -1;
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const offset = vertex * 3;
    const x = positions[offset];
    const y = positions[offset + 1];
    const z = positions[offset + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) ||
        Math.abs(x) > maxMagnitude || Math.abs(y) > maxMagnitude || Math.abs(z) > maxMagnitude) {
      invalidVertexIndex = vertex;
      break;
    }
    min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y); min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y); max[2] = Math.max(max[2], z);
  }
  if (invalidVertexIndex >= 0) return { valid: false, invalidVertexIndex };
  const center = min.map((value, axis) => (value + max[axis]) / 2);
  const halfExtents = min.map((value, axis) => (max[axis] - value) / 2);
  return {
    valid: true,
    invalidVertexIndex,
    min: Object.freeze(min),
    max: Object.freeze(max),
    center: Object.freeze(center),
    halfExtents: Object.freeze(halfExtents),
    radius: Math.hypot(...halfExtents),
  };
}

export function positionBoundsReport(positions, options = {}) {
  const positionsArray = numericArrayLike(positions);
  const optionsObject = options !== null && typeof options === 'object';
  const maxVertices = optionsObject && options.maxVertices !== undefined
    ? options.maxVertices
    : MORPH_ATTRIBUTE_LIMITS.maxVertices;
  const maxMagnitude = optionsObject && options.maxMagnitude !== undefined
    ? options.maxMagnitude
    : MORPH_ATTRIBUTE_LIMITS.maxValueMagnitude;
  const limitsValid = Number.isSafeInteger(maxVertices) && maxVertices > 0 &&
    maxVertices <= MORPH_ATTRIBUTE_LIMITS.maxVertices &&
    Number.isFinite(maxMagnitude) && maxMagnitude > 0 &&
    maxMagnitude <= MORPH_ATTRIBUTE_LIMITS.maxValueMagnitude;
  const vertexCount = positionsArray && positions.length % 3 === 0 ? positions.length / 3 : 0;
  const shapeValid = optionsObject && limitsValid && vertexCount > 0 && vertexCount <= maxVertices;
  if (!shapeValid) {
    return { valid: false, positionsArray, optionsObject, limitsValid, shapeValid, vertexCount, maxVertices };
  }
  return {
    positionsArray, optionsObject, limitsValid, shapeValid, vertexCount, maxVertices,
    ...positionBoundsFromValues(positions, maxMagnitude),
  };
}

export function morphAttributeDeltasReport(baseValues, morphTargets, morphWeights, options = {}) {
  const baseArray = numericArrayLike(baseValues);
  const targetsArray = Array.isArray(morphTargets);
  const weightsArray = numericArrayLike(morphWeights);
  const optionsObject = options !== null && typeof options === 'object';
  const field = optionsObject && typeof options.field === 'string' ? options.field : 'positions';
  const baseStride = optionsObject && options.baseStride !== undefined ? options.baseStride : 3;
  const deltaStride = optionsObject && options.deltaStride !== undefined ? options.deltaStride : baseStride;
  const deformedComponents = optionsObject && options.deformedComponents !== undefined
    ? options.deformedComponents
    : deltaStride;
  const maxVertices = optionsObject && options.maxVertices !== undefined
    ? options.maxVertices
    : MORPH_ATTRIBUTE_LIMITS.maxVertices;
  const maxTargets = optionsObject && options.maxTargets !== undefined
    ? options.maxTargets
    : MORPH_ATTRIBUTE_LIMITS.maxTargets;
  const output = optionsObject && options.output !== undefined ? options.output : null;
  const outputValid = output === null || (numericArrayLike(output) && output.length === baseValues?.length);
  const limitsValid = Number.isSafeInteger(baseStride) && baseStride > 0 && baseStride <= 16 &&
    Number.isSafeInteger(deltaStride) && deltaStride > 0 && deltaStride <= baseStride &&
    Number.isSafeInteger(deformedComponents) && deformedComponents > 0 && deformedComponents <= deltaStride &&
    Number.isSafeInteger(maxVertices) && maxVertices > 0 && maxVertices <= MORPH_ATTRIBUTE_LIMITS.maxVertices &&
    Number.isSafeInteger(maxTargets) && maxTargets > 0 && maxTargets <= MORPH_ATTRIBUTE_LIMITS.maxTargets;
  const vertexCount = baseArray && baseValues.length % baseStride === 0 ? baseValues.length / baseStride : 0;
  const targetCount = targetsArray ? morphTargets.length : 0;
  const shapeValid = optionsObject && limitsValid && outputValid && baseArray && targetsArray && weightsArray &&
    vertexCount > 0 && vertexCount <= maxVertices && targetCount > 0 && targetCount <= maxTargets &&
    morphWeights.length === targetCount;
  let valuesValid = shapeValid;
  let invalidTargetIndex = -1;
  let invalidValueIndex = -1;
  let activeTargetCount = 0;
  if (shapeValid) {
    for (let index = 0; index < baseValues.length; index++) {
      const value = baseValues[index];
      if (!Number.isFinite(value) || Math.abs(value) > MORPH_ATTRIBUTE_LIMITS.maxValueMagnitude) {
        valuesValid = false;
        invalidValueIndex = index;
        break;
      }
    }
  }
  if (valuesValid) {
    for (let targetIndex = 0; targetIndex < targetCount; targetIndex++) {
      const target = morphTargets[targetIndex];
      const weight = morphWeights[targetIndex];
      if (!target || typeof target !== 'object' || !Number.isFinite(weight) ||
          Math.abs(weight) > MORPH_ATTRIBUTE_LIMITS.maxWeightMagnitude) {
        valuesValid = false;
        invalidTargetIndex = targetIndex;
        break;
      }
      if (weight !== 0) activeTargetCount++;
      const deltas = target[field];
      if (deltas === undefined || deltas === null) continue;
      if (!numericArrayLike(deltas) || deltas.length !== vertexCount * deltaStride) {
        valuesValid = false;
        invalidTargetIndex = targetIndex;
        break;
      }
      for (let index = 0; index < deltas.length; index++) {
        const value = deltas[index];
        if (!Number.isFinite(value) || Math.abs(value) > MORPH_ATTRIBUTE_LIMITS.maxValueMagnitude) {
          valuesValid = false;
          invalidTargetIndex = targetIndex;
          invalidValueIndex = index;
          break;
        }
      }
      if (!valuesValid) break;
    }
  }
  const valid = shapeValid && valuesValid;
  if (!valid) {
    return {
      valid, baseArray, targetsArray, weightsArray, optionsObject, limitsValid, outputValid,
      shapeValid, valuesValid, vertexCount, targetCount, activeTargetCount,
      invalidTargetIndex, invalidValueIndex,
    };
  }
  const values = output || new Float32Array(baseValues.length);
  for (let index = 0; index < baseValues.length; index++) values[index] = baseValues[index];
  for (let targetIndex = 0; targetIndex < targetCount; targetIndex++) {
    const weight = morphWeights[targetIndex];
    const deltas = morphTargets[targetIndex][field];
    if (weight === 0 || deltas === undefined || deltas === null) continue;
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const baseOffset = vertex * baseStride;
      const deltaOffset = vertex * deltaStride;
      for (let component = 0; component < deformedComponents; component++) {
        const value = values[baseOffset + component] + weight * deltas[deltaOffset + component];
        if (!Number.isFinite(value) || Math.abs(value) > MORPH_ATTRIBUTE_LIMITS.maxValueMagnitude) {
          return {
            valid: false, baseArray, targetsArray, weightsArray, optionsObject, limitsValid, outputValid,
            shapeValid, valuesValid: false, vertexCount, targetCount, activeTargetCount,
            invalidTargetIndex: targetIndex, invalidValueIndex: deltaOffset + component,
          };
        }
        values[baseOffset + component] = value;
      }
    }
  }
  return {
    valid, baseArray, targetsArray, weightsArray, optionsObject, limitsValid, outputValid,
    shapeValid, valuesValid, vertexCount, targetCount, activeTargetCount,
    invalidTargetIndex, invalidValueIndex, values,
  };
}

export function morphedPositionBoundsReport(basePositions, morphTargets, morphWeights, options = {}) {
  const morph = morphAttributeDeltasReport(basePositions, morphTargets, morphWeights, {
    ...options,
    field: 'positions',
    baseStride: 3,
    deltaStride: 3,
    deformedComponents: 3,
  });
  if (!morph.valid) return morph;
  const bounds = positionBoundsReport(morph.values, {
    maxVertices: options?.maxVertices ?? MORPH_ATTRIBUTE_LIMITS.maxVertices,
    maxMagnitude: MORPH_ATTRIBUTE_LIMITS.maxValueMagnitude,
  });
  return { ...morph, ...bounds, valid: morph.valid && bounds.valid };
}

export function skinnedPositionBoundsReport(
  bindPositions,
  jointIndices,
  jointWeights,
  skinMatrices,
  options = {},
) {
  const positionsArray = numericArrayLike(bindPositions);
  const indicesArray = numericArrayLike(jointIndices);
  const weightsArray = numericArrayLike(jointWeights);
  const matricesArray = numericArrayLike(skinMatrices);
  const influences = SKINNED_POSITION_BOUNDS_LIMITS.influencesPerVertex;
  const vertexCount = positionsArray && bindPositions.length % 3 === 0 ? bindPositions.length / 3 : 0;
  const jointCount = matricesArray && skinMatrices.length % 16 === 0 ? skinMatrices.length / 16 : 0;
  const optionsObject = options !== null && typeof options === 'object';
  const maxVerticesProvided = optionsObject && options.maxVertices !== undefined;
  const maxVerticesValid = !maxVerticesProvided || (
    Number.isSafeInteger(options.maxVertices) && options.maxVertices > 0 &&
    options.maxVertices <= SKINNED_POSITION_BOUNDS_LIMITS.maxVertices
  );
  const maxVertices = maxVerticesProvided && maxVerticesValid
    ? options.maxVertices
    : SKINNED_POSITION_BOUNDS_LIMITS.maxVertices;
  const shapeValid = optionsObject && maxVerticesValid &&
    positionsArray && indicesArray && weightsArray && matricesArray &&
    vertexCount > 0 && vertexCount <= maxVertices &&
    jointCount > 0 && jointCount <= SKINNED_POSITION_BOUNDS_LIMITS.maxJoints &&
    jointIndices.length === vertexCount * influences &&
    jointWeights.length === vertexCount * influences;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let valuesValid = shapeValid;
  let invalidVertexIndex = -1;
  if (shapeValid) {
    for (let matrixIndex = 0; matrixIndex < skinMatrices.length; matrixIndex++) {
      const value = skinMatrices[matrixIndex];
      if (!Number.isFinite(value) || Math.abs(value) > SKINNED_POSITION_BOUNDS_LIMITS.maxCoordinateMagnitude) {
        valuesValid = false;
        break;
      }
    }
  }
  if (valuesValid) {
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const positionOffset = vertex * 3;
      const influenceOffset = vertex * influences;
      const px = bindPositions[positionOffset];
      const py = bindPositions[positionOffset + 1];
      const pz = bindPositions[positionOffset + 2];
      let weightSum = 0;
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let vertexValid = Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz) &&
        Math.abs(px) <= SKINNED_POSITION_BOUNDS_LIMITS.maxCoordinateMagnitude &&
        Math.abs(py) <= SKINNED_POSITION_BOUNDS_LIMITS.maxCoordinateMagnitude &&
        Math.abs(pz) <= SKINNED_POSITION_BOUNDS_LIMITS.maxCoordinateMagnitude;
      for (let influence = 0; influence < influences && vertexValid; influence++) {
        const joint = jointIndices[influenceOffset + influence];
        const weight = jointWeights[influenceOffset + influence];
        vertexValid = Number.isInteger(joint) && joint >= 0 && joint < jointCount &&
          Number.isFinite(weight) && weight >= 0 && weight <= 1;
        if (!vertexValid) break;
        weightSum += weight;
        const matrixOffset = joint * 16;
        sx += weight * (skinMatrices[matrixOffset] * px + skinMatrices[matrixOffset + 4] * py +
          skinMatrices[matrixOffset + 8] * pz + skinMatrices[matrixOffset + 12]);
        sy += weight * (skinMatrices[matrixOffset + 1] * px + skinMatrices[matrixOffset + 5] * py +
          skinMatrices[matrixOffset + 9] * pz + skinMatrices[matrixOffset + 13]);
        sz += weight * (skinMatrices[matrixOffset + 2] * px + skinMatrices[matrixOffset + 6] * py +
          skinMatrices[matrixOffset + 10] * pz + skinMatrices[matrixOffset + 14]);
      }
      vertexValid = vertexValid &&
        Math.abs(weightSum - 1) <= SKINNED_POSITION_BOUNDS_LIMITS.weightSumTolerance &&
        Number.isFinite(sx) && Number.isFinite(sy) && Number.isFinite(sz) &&
        Math.abs(sx) <= SKINNED_POSITION_BOUNDS_LIMITS.maxCoordinateMagnitude &&
        Math.abs(sy) <= SKINNED_POSITION_BOUNDS_LIMITS.maxCoordinateMagnitude &&
        Math.abs(sz) <= SKINNED_POSITION_BOUNDS_LIMITS.maxCoordinateMagnitude;
      if (!vertexValid) {
        valuesValid = false;
        invalidVertexIndex = vertex;
        break;
      }
      min[0] = Math.min(min[0], sx); min[1] = Math.min(min[1], sy); min[2] = Math.min(min[2], sz);
      max[0] = Math.max(max[0], sx); max[1] = Math.max(max[1], sy); max[2] = Math.max(max[2], sz);
    }
  }
  const valid = shapeValid && valuesValid;
  if (!valid) {
    return {
      valid, positionsArray, indicesArray, weightsArray, matricesArray,
      optionsObject, maxVerticesValid, shapeValid, valuesValid,
      vertexCount, jointCount, maxVertices, invalidVertexIndex,
    };
  }
  const center = min.map((value, axis) => (value + max[axis]) / 2);
  const halfExtents = min.map((value, axis) => (max[axis] - value) / 2);
  return {
    valid, positionsArray, indicesArray, weightsArray, matricesArray,
    optionsObject, maxVerticesValid, shapeValid, valuesValid,
    vertexCount, jointCount, maxVertices, invalidVertexIndex,
    min: Object.freeze(min), max: Object.freeze(max), center: Object.freeze(center),
    halfExtents: Object.freeze(halfExtents), radius: Math.hypot(...halfExtents),
  };
}

function asUint8Array(source) {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  }
  return null;
}

function finiteOrDefault(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function finiteVec3(source, fallback) {
  return [
    finiteOrDefault(source?.[0], fallback[0]),
    finiteOrDefault(source?.[1], fallback[1]),
    finiteOrDefault(source?.[2], fallback[2]),
  ];
}

function normalizeOrFallback(value, fallback) {
  const normalized = vec3Normalize(value);
  return vec3LengthSq(normalized) <= EPSILON * EPSILON ? [...fallback] : normalized;
}

function fallbackTangentForNormal(normal) {
  const axis = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const projected = vec3Sub(axis, vec3Scale(normal, vec3Dot(axis, normal)));
  return normalizeOrFallback(projected, DEFAULT_TANGENT_VECTOR);
}

function triangleTangentBasis(positions, uvs, i0, i1, i2) {
  const p0 = i0 * 3;
  const p1 = i1 * 3;
  const p2 = i2 * 3;
  const uv0 = i0 * 2;
  const uv1 = i1 * 2;
  const uv2 = i2 * 2;

  const x1 = finiteOrDefault(positions[p1]) - finiteOrDefault(positions[p0]);
  const y1 = finiteOrDefault(positions[p1 + 1]) - finiteOrDefault(positions[p0 + 1]);
  const z1 = finiteOrDefault(positions[p1 + 2]) - finiteOrDefault(positions[p0 + 2]);
  const x2 = finiteOrDefault(positions[p2]) - finiteOrDefault(positions[p0]);
  const y2 = finiteOrDefault(positions[p2 + 1]) - finiteOrDefault(positions[p0 + 1]);
  const z2 = finiteOrDefault(positions[p2 + 2]) - finiteOrDefault(positions[p0 + 2]);

  const s1 = finiteOrDefault(uvs[uv1]) - finiteOrDefault(uvs[uv0]);
  const t1 = finiteOrDefault(uvs[uv1 + 1]) - finiteOrDefault(uvs[uv0 + 1]);
  const s2 = finiteOrDefault(uvs[uv2]) - finiteOrDefault(uvs[uv0]);
  const t2 = finiteOrDefault(uvs[uv2 + 1]) - finiteOrDefault(uvs[uv0 + 1]);
  const denom = s1 * t2 - s2 * t1;
  if (Math.abs(denom) <= EPSILON) return null;

  const r = 1 / denom;
  return {
    tangent: [
      (t2 * x1 - t1 * x2) * r,
      (t2 * y1 - t1 * y2) * r,
      (t2 * z1 - t1 * z2) * r,
    ],
    bitangent: [
      (s1 * x2 - s2 * x1) * r,
      (s1 * y2 - s2 * y1) * r,
      (s1 * z2 - s2 * z1) * r,
    ],
  };
}

function tangentCandidateForVertex(normals, vertex, basis, defaultHandedness = 1) {
  const nBase = vertex * 3;
  const normal = normalizeOrFallback(
    [normals[nBase], normals[nBase + 1], normals[nBase + 2]],
    DEFAULT_TANGENT_NORMAL
  );
  const tangentFallback = fallbackTangentForNormal(normal);
  const tangent = normalizeOrFallback(
    vec3Sub(basis.tangent, vec3Scale(normal, vec3Dot(normal, basis.tangent))),
    tangentFallback
  );
  const handedness = vec3LengthSq(basis.bitangent) > EPSILON * EPSILON
    ? (vec3Dot(vec3Cross(normal, tangent), basis.bitangent) < 0 ? -1 : 1)
    : defaultHandedness;
  return { tangent, handedness };
}

function trianglePositionDegenerate(positions, i0, i1, i2) {
  const p0 = i0 * 3;
  const p1 = i1 * 3;
  const p2 = i2 * 3;
  const edgeA = [
    finiteOrDefault(positions[p1]) - finiteOrDefault(positions[p0]),
    finiteOrDefault(positions[p1 + 1]) - finiteOrDefault(positions[p0 + 1]),
    finiteOrDefault(positions[p1 + 2]) - finiteOrDefault(positions[p0 + 2]),
  ];
  const edgeB = [
    finiteOrDefault(positions[p2]) - finiteOrDefault(positions[p0]),
    finiteOrDefault(positions[p2 + 1]) - finiteOrDefault(positions[p0 + 1]),
    finiteOrDefault(positions[p2 + 2]) - finiteOrDefault(positions[p0 + 2]),
  ];
  return vec3LengthSq(vec3Cross(edgeA, edgeB)) <= EPSILON * EPSILON;
}

function triangleNonFiniteAttributeComponents(source, componentCount, indices) {
  let count = 0;
  for (const index of indices) {
    const base = index * componentCount;
    for (let component = 0; component < componentCount; component++) {
      if (!Number.isFinite(source?.[base + component])) count++;
    }
  }
  return count;
}

function attributeCopyConstructor(source, fallback = Float32Array) {
  return ArrayBuffer.isView(source) ? source.constructor : fallback;
}

function duplicateAttributeBySourceVertices(source, sourceVertices, componentCount, fallbackCtor = Float32Array) {
  if (!source || source.length < sourceVertices.sourceVertexCount * componentCount) return source || null;
  const Ctor = attributeCopyConstructor(source, fallbackCtor);
  const output = new Ctor(sourceVertices.length * componentCount);
  for (let outputVertex = 0; outputVertex < sourceVertices.length; outputVertex++) {
    const sourceVertex = sourceVertices[outputVertex];
    const inBase = sourceVertex * componentCount;
    const outBase = outputVertex * componentCount;
    for (let component = 0; component < componentCount; component++) {
      output[outBase + component] = source[inBase + component];
    }
  }
  return output;
}

function alignedByteOffset(bufferByteOffset, relativeByteOffset, alignment) {
  return ((bufferByteOffset + relativeByteOffset) % alignment) === 0;
}

export function componentTypedArray(componentType) {
  return COMPONENT_TYPED_ARRAYS.get(componentType) ?? null;
}

export function componentByteSize(componentType) {
  return COMPONENT_BYTE_SIZES.get(componentType) ?? 4;
}

export function accessorElementCount(type) {
  return ACCESSOR_ELEMENT_COUNTS[type] ?? 1;
}

export function normalizedComponentRange(componentType) {
  switch (componentType) {
    case GLTF_COMPONENT_TYPES.BYTE:
    case GLTF_COMPONENT_TYPES.SHORT:
      return [-1, 1];
    case GLTF_COMPONENT_TYPES.UNSIGNED_BYTE:
    case GLTF_COMPONENT_TYPES.UNSIGNED_SHORT:
    case GLTF_COMPONENT_TYPES.UNSIGNED_INT:
      return [0, 1];
    default:
      return null;
  }
}

export function normalizeAccessorComponent(value, componentType) {
  switch (componentType) {
    case GLTF_COMPONENT_TYPES.BYTE:
      return Math.max(value / 127, -1);
    case GLTF_COMPONENT_TYPES.UNSIGNED_BYTE:
      return value / 255;
    case GLTF_COMPONENT_TYPES.SHORT:
      return Math.max(value / 32767, -1);
    case GLTF_COMPONENT_TYPES.UNSIGNED_SHORT:
      return value / 65535;
    case GLTF_COMPONENT_TYPES.UNSIGNED_INT:
      return value / 4294967295;
    default:
      return value;
  }
}

export function readAccessorComponent(view, byteOffset, componentType, normalized = false) {
  let value;
  switch (componentType) {
    case GLTF_COMPONENT_TYPES.BYTE:
      value = view.getInt8(byteOffset);
      break;
    case GLTF_COMPONENT_TYPES.UNSIGNED_BYTE:
      value = view.getUint8(byteOffset);
      break;
    case GLTF_COMPONENT_TYPES.SHORT:
      value = view.getInt16(byteOffset, true);
      break;
    case GLTF_COMPONENT_TYPES.UNSIGNED_SHORT:
      value = view.getUint16(byteOffset, true);
      break;
    case GLTF_COMPONENT_TYPES.UNSIGNED_INT:
      value = view.getUint32(byteOffset, true);
      break;
    case GLTF_COMPONENT_TYPES.FLOAT:
      value = view.getFloat32(byteOffset, true);
      break;
    default:
      value = view.getFloat32(byteOffset, true);
      break;
  }
  return normalized ? normalizeAccessorComponent(value, componentType) : value;
}

export function accessorPackedByteStride(accessor) {
  return accessorElementCount(accessor?.type) * componentByteSize(accessor?.componentType);
}

export function accessorByteLayout(accessor, bufferView = {}) {
  const componentCount = accessorElementCount(accessor?.type);
  const componentSize = componentByteSize(accessor?.componentType);
  const packedByteStride = componentCount * componentSize;
  const byteStride = bufferView?.byteStride || packedByteStride;
  const byteOffset = (bufferView?.byteOffset || 0) + (accessor?.byteOffset || 0);
  const count = Math.max(0, accessor?.count || 0);
  const byteSpan = count > 0 ? (count - 1) * byteStride + packedByteStride : 0;
  return {
    componentCount,
    componentSize,
    packedByteStride,
    byteStride,
    byteOffset,
    byteSpan,
    count,
    tightlyPacked: byteStride === packedByteStride,
  };
}

export function readAccessorArray(source, accessor, bufferView = {}, options = {}) {
  const bytes = asUint8Array(source);
  const TypedArray = componentTypedArray(accessor?.componentType);
  if (!bytes || !TypedArray || !accessor) return null;

  const layout = accessorByteLayout(accessor, bufferView);
  const valueCount = layout.count * layout.componentCount;
  const outputMode = options.output || (accessor.normalized ? 'float32' : 'typed');

  if (
    outputMode !== 'float32' &&
    layout.tightlyPacked &&
    alignedByteOffset(bytes.byteOffset, layout.byteOffset, TypedArray.BYTES_PER_ELEMENT)
  ) {
    return new TypedArray(bytes.buffer, bytes.byteOffset + layout.byteOffset, valueCount);
  }

  const ResultArray = outputMode === 'float32' ? Float32Array : TypedArray;
  const result = new ResultArray(valueCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let out = 0;

  for (let i = 0; i < layout.count; i++) {
    const base = layout.byteOffset + i * layout.byteStride;
    for (let j = 0; j < layout.componentCount; j++) {
      result[out++] = readAccessorComponent(
        view,
        base + j * layout.componentSize,
        accessor.componentType,
        outputMode === 'float32' && accessor.normalized
      );
    }
  }

  return result;
}

export function accessorDecodeMetadata(accessor, bufferView = {}) {
  const layout = accessorByteLayout(accessor, bufferView);
  const normalizedRange = accessor?.normalized
    ? normalizedComponentRange(accessor.componentType)
    : null;
  return {
    componentType: accessor?.componentType,
    type: accessor?.type || 'SCALAR',
    count: layout.count,
    componentCount: layout.componentCount,
    componentSize: layout.componentSize,
    packedByteStride: layout.packedByteStride,
    byteStride: layout.byteStride,
    byteOffset: layout.byteOffset,
    byteSpan: layout.byteSpan,
    tightlyPacked: layout.tightlyPacked,
    normalized: !!accessor?.normalized,
    quantized: accessor?.componentType !== GLTF_COMPONENT_TYPES.FLOAT,
    normalizedRange,
    min: Array.isArray(accessor?.min) ? accessor.min.slice() : null,
    max: Array.isArray(accessor?.max) ? accessor.max.slice() : null,
  };
}

export function attributeBounds(values, componentCount = 3) {
  const count = Math.floor((values?.length || 0) / componentCount);
  const min = new Array(componentCount).fill(Infinity);
  const max = new Array(componentCount).fill(-Infinity);

  for (let i = 0; i < count; i++) {
    const base = i * componentCount;
    for (let c = 0; c < componentCount; c++) {
      const value = values[base + c];
      if (!Number.isFinite(value)) continue;
      min[c] = Math.min(min[c], value);
      max[c] = Math.max(max[c], value);
    }
  }

  for (let c = 0; c < componentCount; c++) {
    if (min[c] === Infinity) min[c] = 0;
    if (max[c] === -Infinity) max[c] = 0;
  }

  return { min, max, count };
}

export function attributeScaleBiasFromBounds(min, max) {
  const count = Math.min(min?.length || 0, max?.length || 0);
  const scale = new Array(count);
  const bias = new Array(count);
  for (let i = 0; i < count; i++) {
    bias[i] = Number.isFinite(min[i]) ? min[i] : 0;
    scale[i] = Number.isFinite(max[i]) && Number.isFinite(min[i]) ? max[i] - min[i] : 0;
  }
  return { scale, bias };
}

export function meshoptDecodeMetadata(extension = {}, bufferView = {}) {
  const count = Math.max(0, extension.count || 0);
  const byteStride = extension.byteStride || bufferView.byteStride || 0;
  return {
    buffer: extension.buffer,
    byteOffset: extension.byteOffset || 0,
    byteLength: extension.byteLength || 0,
    byteStride,
    count,
    mode: extension.mode || 'ATTRIBUTES',
    filter: extension.filter || 'NONE',
    decodedByteLength: count * byteStride,
    parentByteLength: bufferView.byteLength || 0,
    parentMatchesDecodedLength: (bufferView.byteLength || 0) === count * byteStride,
  };
}

export function indexBounds(indices, vertexCount) {
  let min = Infinity;
  let max = -Infinity;
  let outOfBounds = 0;
  const count = indices?.length || 0;

  for (let i = 0; i < count; i++) {
    const value = indices[i];
    if (!Number.isFinite(value)) {
      outOfBounds++;
      continue;
    }
    min = Math.min(min, value);
    max = Math.max(max, value);
    if (value < 0 || value >= vertexCount) outOfBounds++;
  }

  return {
    count,
    min: min === Infinity ? 0 : min,
    max: max === -Infinity ? 0 : max,
    vertexCount,
    outOfBounds,
    withinBounds: outOfBounds === 0,
  };
}

export function tangentHandedness(tangent, fallback = 1) {
  const signSource = finiteOrDefault(tangent?.[3], fallback);
  return signSource < 0 ? -1 : 1;
}

export function tangentFrameFromNormalTangent(normal, tangent, options = {}) {
  const normalFallback = finiteVec3(options.normalFallback, DEFAULT_TANGENT_NORMAL);
  const n = normalizeOrFallback(finiteVec3(normal, normalFallback), normalFallback);
  const tangentFallback = fallbackTangentForNormal(n);
  const sourceTangent = finiteVec3(tangent, tangentFallback);
  const projectedTangent = vec3Sub(sourceTangent, vec3Scale(n, vec3Dot(sourceTangent, n)));
  const t = normalizeOrFallback(projectedTangent, tangentFallback);
  const handedness = tangentHandedness(tangent, options.handedness ?? 1);
  const b = vec3Scale(normalizeOrFallback(vec3Cross(n, t), vec3Cross(n, tangentFallback)), handedness);
  const determinant = vec3Dot(vec3Cross(t, b), n);

  return {
    tangent: t,
    bitangent: b,
    normal: n,
    handedness,
    determinant,
    valid: vec3LengthSq(t) > EPSILON * EPSILON && vec3LengthSq(b) > EPSILON * EPSILON,
  };
}

export function gltfBitangentFromTangent(normal, tangent, options = {}) {
  return tangentFrameFromNormalTangent(normal, tangent, options).bitangent;
}

export function decodeNormalTextureSample(sample, normalScale = 1, options = {}) {
  const scale = finiteOrDefault(normalScale, 1);
  const greenSign = options.greenChannel === 'down' || options.flipGreen === true ? -1 : 1;
  const tangentNormal = [
    (finiteOrDefault(sample?.[0], 0.5) * 2 - 1) * scale,
    (finiteOrDefault(sample?.[1], 0.5) * 2 - 1) * scale * greenSign,
    finiteOrDefault(sample?.[2], 1) * 2 - 1,
  ];
  return normalizeOrFallback(tangentNormal, DEFAULT_TANGENT_NORMAL);
}

export function normalTextureSampleToWorld(sample, normal, tangent, normalScale = 1, options = {}) {
  const frame = tangentFrameFromNormalTangent(normal, tangent, options);
  const local = decodeNormalTextureSample(sample, normalScale, options);
  const world = [
    frame.tangent[0] * local[0] + frame.bitangent[0] * local[1] + frame.normal[0] * local[2],
    frame.tangent[1] * local[0] + frame.bitangent[1] * local[1] + frame.normal[1] * local[2],
    frame.tangent[2] * local[0] + frame.bitangent[2] * local[1] + frame.normal[2] * local[2],
  ];
  return normalizeOrFallback(world, frame.normal);
}

export function prepareMikkTSpaceInputGeometry(geometry) {
  const positions = geometry?.positions;
  const normals = geometry?.normals;
  const uvs = geometry?.uvs;
  const indices = geometry?.indices || null;
  const vertexCount = Math.floor((positions?.length || 0) / 3);
  const indexCount = indices?.length || vertexCount;
  const triangleCount = Math.floor(indexCount / 3);
  const analysis = {
    sourceVertexCount: vertexCount,
    sourceIndexCount: indexCount,
    sourceTriangleCount: triangleCount,
    validTriangleCount: 0,
    invalidIndexCount: 0,
    degenerateTriangleCount: 0,
    nonFiniteTriangleCount: 0,
    nonFinitePositionComponentCount: 0,
    nonFiniteNormalComponentCount: 0,
    nonFiniteUvComponentCount: 0,
    outputVertexCount: 0,
    requiresUnindexedOutput: true,
    exactMikkTSpace: false,
    ready: false,
  };

  if (
    vertexCount <= 0 ||
    (normals?.length || 0) < vertexCount * 3 ||
    (uvs?.length || 0) < vertexCount * 2 ||
    triangleCount <= 0
  ) {
    return {
      geometry: null,
      faceVertexMap: new Uint32Array(0),
      faceTriangleMap: new Uint32Array(0),
      analysis,
      ready: false,
    };
  }

  const sourceVertices = [];
  const sourceTriangles = [];
  for (let tri = 0; tri < triangleCount; tri++) {
    const offset = tri * 3;
    const triIndices = [
      indices ? indices[offset] : offset,
      indices ? indices[offset + 1] : offset + 1,
      indices ? indices[offset + 2] : offset + 2,
    ];
    if (triIndices.some((i) => !Number.isInteger(i) || i < 0 || i >= vertexCount)) {
      analysis.invalidIndexCount++;
      continue;
    }
    const nonFinitePositions = triangleNonFiniteAttributeComponents(positions, 3, triIndices);
    const nonFiniteNormals = triangleNonFiniteAttributeComponents(normals, 3, triIndices);
    const nonFiniteUvs = triangleNonFiniteAttributeComponents(uvs, 2, triIndices);
    if (nonFinitePositions + nonFiniteNormals + nonFiniteUvs > 0) analysis.nonFiniteTriangleCount++;
    analysis.nonFinitePositionComponentCount += nonFinitePositions;
    analysis.nonFiniteNormalComponentCount += nonFiniteNormals;
    analysis.nonFiniteUvComponentCount += nonFiniteUvs;
    if (trianglePositionDegenerate(positions, triIndices[0], triIndices[1], triIndices[2]) ||
      !triangleTangentBasis(positions, uvs, triIndices[0], triIndices[1], triIndices[2])) {
      analysis.degenerateTriangleCount++;
    }
    for (let corner = 0; corner < 3; corner++) {
      sourceVertices.push(triIndices[corner]);
      sourceTriangles.push(tri);
    }
    analysis.validTriangleCount++;
  }

  analysis.outputVertexCount = sourceVertices.length;
  analysis.ready = analysis.validTriangleCount > 0;
  sourceVertices.sourceVertexCount = vertexCount;

  if (!analysis.ready) {
    return {
      geometry: null,
      faceVertexMap: new Uint32Array(0),
      faceTriangleMap: new Uint32Array(0),
      analysis,
      ready: false,
    };
  }

  function duplicateMorphTargets(morphTargets) {
    if (!Array.isArray(morphTargets)) return morphTargets || null;
    return morphTargets.map((target) => {
      const duplicated = { ...target };
      if (target.positions) duplicated.positions = duplicateAttributeBySourceVertices(target.positions, sourceVertices, 3);
      if (target.normals) duplicated.normals = duplicateAttributeBySourceVertices(target.normals, sourceVertices, 3);
      if (target.tangents) duplicated.tangents = duplicateAttributeBySourceVertices(target.tangents, sourceVertices, 3);
      if (target.uvs) duplicated.uvs = duplicateAttributeBySourceVertices(target.uvs, sourceVertices, 2);
      return duplicated;
    });
  }

  const outputGeometry = {
    ...geometry,
    positions: duplicateAttributeBySourceVertices(positions, sourceVertices, 3),
    normals: duplicateAttributeBySourceVertices(normals, sourceVertices, 3),
    uvs: duplicateAttributeBySourceVertices(uvs, sourceVertices, 2),
    indices: null,
  };
  if (geometry.tangents) outputGeometry.tangents = duplicateAttributeBySourceVertices(geometry.tangents, sourceVertices, 4);
  if (geometry.joints) outputGeometry.joints = duplicateAttributeBySourceVertices(geometry.joints, sourceVertices, 4, Uint16Array);
  if (geometry.weights) outputGeometry.weights = duplicateAttributeBySourceVertices(geometry.weights, sourceVertices, 4);
  if (geometry.morphTargets) outputGeometry.morphTargets = duplicateMorphTargets(geometry.morphTargets);

  return {
    geometry: outputGeometry,
    faceVertexMap: new Uint32Array(sourceVertices),
    faceTriangleMap: new Uint32Array(sourceTriangles),
    analysis,
    ready: true,
  };
}

export function mikkTSpaceReferenceFingerprint(preparedInput, faceTangents = null) {
  const geometry = preparedInput?.geometry || null;
  const vertexCount = preparedInput?.analysis?.outputVertexCount ??
    Math.floor((geometry?.positions?.length || 0) / 3);
  const triangleCount = preparedInput?.analysis?.validTriangleCount || Math.floor(vertexCount / 3);
  let inputHash = fnv1aLowByteString32('mikk-input-v1|');
  inputHash = fnv1aTaggedFloat32Sequence32(geometry?.positions, { seed: inputHash });
  inputHash = fnv1aTaggedFloat32Sequence32(geometry?.normals, { seed: inputHash });
  inputHash = fnv1aTaggedFloat32Sequence32(geometry?.uvs, { seed: inputHash });
  inputHash = fnv1aTaggedUint32Sequence32(preparedInput?.faceVertexMap, { seed: inputHash });
  inputHash = fnv1aTaggedUint32Sequence32(preparedInput?.faceTriangleMap, { seed: inputHash });

  const result = {
    inputHash: `fnv1a32:${checksumHex32(inputHash)}`,
    tangentHash: null,
    vertexCount,
    triangleCount,
    tangentLength: faceTangents?.length || 0,
  };

  if (faceTangents) {
    let tangentHash = fnv1aLowByteString32('mikk-tangent-v1|');
    tangentHash = fnv1aTaggedFloat32Sequence32(faceTangents, { seed: tangentHash });
    result.tangentHash = `fnv1a32:${checksumHex32(tangentHash)}`;
  }

  return result;
}

export function mikkTSpaceReferenceRegistryReport(registry = MIKK_REFERENCE_CORPUS_REGISTRY) {
  const errors = [];
  const cases = registry?.cases && typeof registry.cases === 'object' ? registry.cases : null;
  const keys = cases ? Object.keys(cases) : [];
  if (!registry || typeof registry !== 'object') errors.push('registry');
  if (registry?.standard !== 'MikkTSpace') errors.push('standard');
  if (typeof registry?.version !== 'string' || registry.version.trim().length === 0) errors.push('version');
  if (!Number.isInteger(registry?.caseCount) || registry.caseCount < 0) {
    errors.push('caseCount');
  } else if (registry.caseCount !== keys.length) {
    errors.push('caseCountMismatch');
  }
  if (!cases) errors.push('cases');

  for (const key of keys) {
    const entry = cases[key];
    if (!key.includes(':')) errors.push(`${key}.key`);
    if (!entry || typeof entry !== 'object') {
      errors.push(`${key}.entry`);
      continue;
    }
    if (entry.standard !== 'MikkTSpace') errors.push(`${key}.standard`);
    if (typeof entry.generator !== 'string' || entry.generator.trim().length === 0) errors.push(`${key}.generator`);
    if (typeof entry.inputHash !== 'string' || !entry.inputHash.startsWith('fnv1a32:')) errors.push(`${key}.inputHash`);
    if (typeof entry.tangentHash !== 'string' || !entry.tangentHash.startsWith('fnv1a32:')) errors.push(`${key}.tangentHash`);
    if (!Number.isInteger(entry.vertexCount) || entry.vertexCount <= 0) errors.push(`${key}.vertexCount`);
    if (!Number.isInteger(entry.triangleCount) || entry.triangleCount <= 0) errors.push(`${key}.triangleCount`);
  }

  return {
    valid: errors.length === 0,
    errors,
    standard: registry?.standard || null,
    version: registry?.version || null,
    declaredCaseCount: Number.isInteger(registry?.caseCount) ? registry.caseCount : null,
    actualCaseCount: keys.length,
  };
}

export function mikkTSpaceReferenceProofReport(
  preparedInput,
  faceTangents,
  proof = null,
  registry = MIKK_REFERENCE_CORPUS_REGISTRY
) {
  const fingerprint = mikkTSpaceReferenceFingerprint(preparedInput, faceTangents);
  const registryReport = mikkTSpaceReferenceRegistryReport(registry);
  const required = ['standard', 'generator', 'corpusId', 'caseId', 'inputHash', 'tangentHash'];
  const missing = [];
  const mismatches = [];
  const p = proof && typeof proof === 'object' ? proof : {};
  const inputNonFiniteComponentCount =
    (preparedInput?.analysis?.nonFinitePositionComponentCount || 0) +
    (preparedInput?.analysis?.nonFiniteNormalComponentCount || 0) +
    (preparedInput?.analysis?.nonFiniteUvComponentCount || 0);

  for (const field of required) {
    if (typeof p[field] !== 'string' || p[field].trim().length === 0) missing.push(field);
  }
  if (p.standard && p.standard !== 'MikkTSpace') mismatches.push('standard');
  if (p.inputHash && p.inputHash !== fingerprint.inputHash) mismatches.push('inputHash');
  if (p.tangentHash && p.tangentHash !== fingerprint.tangentHash) mismatches.push('tangentHash');
  if (p.vertexCount !== undefined && p.vertexCount !== fingerprint.vertexCount) mismatches.push('vertexCount');
  if (p.triangleCount !== undefined && p.triangleCount !== fingerprint.triangleCount) mismatches.push('triangleCount');
  if (inputNonFiniteComponentCount > 0) mismatches.push('inputNonFinite');

  const cases = registry?.cases && typeof registry.cases === 'object' ? registry.cases : {};
  const caseKey = typeof p.corpusId === 'string' && typeof p.caseId === 'string'
    ? `${p.corpusId}:${p.caseId}`
    : '';
  const registeredCase = caseKey ? cases[caseKey] : null;
  if (!registryReport.valid) mismatches.push('registry');
  if (missing.length === 0) {
    if (!registeredCase) {
      mismatches.push('registeredCase');
    } else {
      if (registeredCase.standard && registeredCase.standard !== p.standard) mismatches.push('registeredCase.standard');
      if (registeredCase.generator && registeredCase.generator !== p.generator) mismatches.push('registeredCase.generator');
      if (registeredCase.inputHash && registeredCase.inputHash !== p.inputHash) mismatches.push('registeredCase.inputHash');
      if (registeredCase.tangentHash && registeredCase.tangentHash !== p.tangentHash) mismatches.push('registeredCase.tangentHash');
      if (registeredCase.vertexCount !== undefined && registeredCase.vertexCount !== fingerprint.vertexCount) {
        mismatches.push('registeredCase.vertexCount');
      }
      if (registeredCase.triangleCount !== undefined && registeredCase.triangleCount !== fingerprint.triangleCount) {
        mismatches.push('registeredCase.triangleCount');
      }
    }
  }

  const verified =
    preparedInput?.ready === true &&
    !!fingerprint.tangentHash &&
    registryReport.valid &&
    !!registeredCase &&
    missing.length === 0 &&
    mismatches.length === 0;

  return {
    verified,
    exactMikkTSpace: verified,
    registryVersion: registry?.version || null,
    registryReport,
    registryMatch: !!registeredCase,
    caseKey,
    fingerprint,
    inputFinite: inputNonFiniteComponentCount === 0,
    inputNonFiniteComponentCount,
    missing,
    mismatches,
    proof: p,
  };
}

export function mikkTSpaceFaceTangentOutputReport(faceTangents, expectedVertexCount, options = {}) {
  const unitLengthTolerance = Number.isFinite(options.unitLengthTolerance)
    ? Math.max(0, options.unitLengthTolerance)
    : MIKK_TANGENT_UNIT_LENGTH_TOLERANCE;
  const expectedCount = Number.isInteger(expectedVertexCount) && expectedVertexCount > 0 ? expectedVertexCount : 0;
  const expectedTangentLength = expectedCount * 4;
  const actualTangentLength = faceTangents?.length || 0;
  const lengthMatches = expectedTangentLength > 0 && actualTangentLength === expectedTangentLength;
  const inspectedVertexCount = Math.floor(Math.min(actualTangentLength, expectedTangentLength || actualTangentLength) / 4);
  let nonFiniteComponentCount = 0;
  let nonFiniteTangentCount = 0;
  let zeroTangentCount = 0;
  let nonUnitTangentCount = 0;
  let invalidHandednessCount = 0;
  let maxUnitLengthError = 0;
  let maxHandednessError = 0;

  for (let i = 0; i < inspectedVertexCount; i++) {
    const base = i * 4;
    const x = faceTangents[base];
    const y = faceTangents[base + 1];
    const z = faceTangents[base + 2];
    const w = faceTangents[base + 3];
    const components = [x, y, z, w];
    const badComponents = components.filter((value) => !Number.isFinite(value)).length;
    if (badComponents > 0) {
      nonFiniteComponentCount += badComponents;
      nonFiniteTangentCount++;
    }

    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      const lengthSq = x * x + y * y + z * z;
      if (lengthSq <= EPSILON * EPSILON) {
        zeroTangentCount++;
      } else {
        const unitLengthError = Math.abs(Math.sqrt(lengthSq) - 1);
        maxUnitLengthError = Math.max(maxUnitLengthError, unitLengthError);
        if (unitLengthError > unitLengthTolerance) nonUnitTangentCount++;
      }
    }

    const handednessError = Number.isFinite(w) ? Math.abs(Math.abs(w) - 1) : Number.POSITIVE_INFINITY;
    maxHandednessError = Math.max(maxHandednessError, handednessError);
    if (handednessError > unitLengthTolerance) invalidHandednessCount++;
  }

  return {
    valid: (
      lengthMatches &&
      nonFiniteComponentCount === 0 &&
      zeroTangentCount === 0 &&
      nonUnitTangentCount === 0 &&
      invalidHandednessCount === 0
    ),
    expectedVertexCount: expectedCount,
    inspectedVertexCount,
    expectedTangentLength,
    actualTangentLength,
    lengthMatches,
    unitLengthTolerance,
    nonFiniteComponentCount,
    nonFiniteTangentCount,
    zeroTangentCount,
    nonUnitTangentCount,
    invalidHandednessCount,
    maxUnitLengthError,
    maxHandednessError,
  };
}

export function applyMikkTSpaceFaceTangents(preparedInput, faceTangents, options = {}) {
  const preparedGeometry = preparedInput?.geometry || null;
  const expectedVertexCount = preparedInput?.analysis?.outputVertexCount ??
    Math.floor((preparedGeometry?.positions?.length || 0) / 3);
  const expectedTangentLength = expectedVertexCount * 4;
  const actualTangentLength = faceTangents?.length || 0;
  const inputReady = preparedInput?.ready === true && !!preparedGeometry;
  const usesFaceCornerGeometry = inputReady && preparedGeometry.indices == null;
  const outputReport = mikkTSpaceFaceTangentOutputReport(faceTangents, expectedVertexCount, options);
  const lengthMatches = outputReport.lengthMatches;
  const referenceProof = mikkTSpaceReferenceProofReport(
    preparedInput,
    faceTangents,
    options.referenceProof,
    options.referenceRegistry
  );
  const analysis = {
    source: options.source || TANGENT_SPACE_GENERATOR_MIKK_FACE_OUTPUT,
    expectedVertexCount,
    expectedTangentLength,
    actualTangentLength,
    inputReady,
    usesFaceCornerGeometry,
    lengthMatches,
    outputValid: outputReport.valid,
    outputReport,
    exactMikkTSpace: referenceProof.verified && outputReport.valid,
    referenceProof,
    ready: false,
  };

  if (!inputReady || !usesFaceCornerGeometry || !lengthMatches) {
    return {
      geometry: null,
      tangents: null,
      faceVertexMap: preparedInput?.faceVertexMap || new Uint32Array(0),
      faceTriangleMap: preparedInput?.faceTriangleMap || new Uint32Array(0),
      analysis,
      ready: false,
    };
  }

  const tangents = new Float32Array(expectedTangentLength);
  for (let i = 0; i < expectedVertexCount; i++) {
    const base = i * 4;
    tangents[base] = finiteOrDefault(faceTangents[base], DEFAULT_TANGENT_VECTOR[0]);
    tangents[base + 1] = finiteOrDefault(faceTangents[base + 1], DEFAULT_TANGENT_VECTOR[1]);
    tangents[base + 2] = finiteOrDefault(faceTangents[base + 2], DEFAULT_TANGENT_VECTOR[2]);
    tangents[base + 3] = tangentHandedness(faceTangents.subarray ? faceTangents.subarray(base, base + 4) : [
      faceTangents[base],
      faceTangents[base + 1],
      faceTangents[base + 2],
      faceTangents[base + 3],
    ]);
  }

  analysis.ready = true;
  analysis.outputValid = outputReport.valid;
  analysis.exactMikkTSpace = referenceProof.verified && outputReport.valid;
  const geometry = {
    ...preparedGeometry,
    tangents,
    tangentSpace: {
      ...(preparedGeometry.tangentSpace || {}),
      source: analysis.source,
      generator: options.generator || TANGENT_SPACE_GENERATOR_MIKK_FACE_OUTPUT,
      exactMikkTSpace: analysis.exactMikkTSpace,
      faceCornerOutput: true,
      oldIndexListReused: false,
      referenceProof,
      analysis,
    },
  };

  return {
    geometry,
    tangents,
    faceVertexMap: preparedInput.faceVertexMap,
    faceTriangleMap: preparedInput.faceTriangleMap,
    analysis,
    ready: true,
  };
}

export function splitGeometryForTangentSpace(geometry, options = {}) {
  const positions = geometry?.positions;
  const normals = geometry?.normals;
  const uvs = geometry?.uvs;
  const indices = geometry?.indices || null;
  const vertexCount = Math.floor((positions?.length || 0) / 3);
  if (
    vertexCount <= 0 ||
    (normals?.length || 0) < vertexCount * 3 ||
    (uvs?.length || 0) < vertexCount * 2
  ) {
    return {
      geometry,
      tangents: null,
      didSplit: false,
      analysis: {
        vertexCount,
        triangleCount: 0,
        invalidIndexCount: 0,
        degenerateTriangleCount: 0,
        splitVertexCount: 0,
        outputVertexCount: vertexCount,
        requiresSplit: false,
      },
    };
  }

  const splitAngleDegrees = Number.isFinite(options.splitAngleDegrees)
    ? Math.max(0, Math.min(180, options.splitAngleDegrees))
    : DEFAULT_TANGENT_SPLIT_ANGLE_DEGREES;
  const tangentDotThreshold = Math.cos(splitAngleDegrees * Math.PI / 180);
  const defaultHandedness = options.handedness === -1 ? -1 : 1;
  const indexCount = indices?.length || vertexCount;
  const triangleCount = Math.floor(indexCount / 3);
  const groupsByVertex = Array.from({ length: vertexCount }, () => []);
  const cornerGroups = new Int32Array(indexCount);
  cornerGroups.fill(0);
  let invalidIndexCount = 0;
  let degenerateTriangleCount = 0;

  for (let tri = 0; tri < triangleCount; tri++) {
    const offset = tri * 3;
    const triIndices = [
      indices ? indices[offset] : offset,
      indices ? indices[offset + 1] : offset + 1,
      indices ? indices[offset + 2] : offset + 2,
    ];
    if (triIndices.some((i) => !Number.isInteger(i) || i < 0 || i >= vertexCount)) {
      invalidIndexCount++;
      continue;
    }

    const basis = triangleTangentBasis(positions, uvs, triIndices[0], triIndices[1], triIndices[2]);
    if (!basis) {
      degenerateTriangleCount++;
      continue;
    }

    for (let corner = 0; corner < 3; corner++) {
      const vertex = triIndices[corner];
      const candidate = tangentCandidateForVertex(normals, vertex, basis, defaultHandedness);
      const groups = groupsByVertex[vertex];
      let groupIndex = -1;
      for (let group = 0; group < groups.length; group++) {
        const existing = groups[group];
        if (
          existing.handedness === candidate.handedness &&
          vec3Dot(existing.tangent, candidate.tangent) >= tangentDotThreshold
        ) {
          groupIndex = group;
          break;
        }
      }
      if (groupIndex < 0) {
        groups.push(candidate);
        groupIndex = groups.length - 1;
      }
      cornerGroups[offset + corner] = groupIndex;
    }
  }

  let splitVertexCount = 0;
  let maxGroupsPerVertex = 1;
  for (const groups of groupsByVertex) {
    if (groups.length > 1) splitVertexCount++;
    maxGroupsPerVertex = Math.max(maxGroupsPerVertex, groups.length || 1);
  }

  const analysis = {
    vertexCount,
    triangleCount,
    invalidIndexCount,
    degenerateTriangleCount,
    splitVertexCount,
    outputVertexCount: vertexCount,
    maxGroupsPerVertex,
    splitAngleDegrees,
    requiresSplit: splitVertexCount > 0,
  };

  if (invalidIndexCount > 0 || splitVertexCount === 0) {
    const tangents = generateTangentsFromGeometry(positions, normals, uvs, indices, options);
    return {
      geometry: { ...geometry, tangents },
      tangents,
      didSplit: false,
      analysis,
    };
  }

  const indexArray = new Uint32Array(indexCount);
  const remap = new Map();
  const sourceVertices = [];
  for (let i = 0; i < indexCount; i++) {
    const sourceVertex = indices ? indices[i] : i;
    if (!Number.isInteger(sourceVertex) || sourceVertex < 0 || sourceVertex >= vertexCount) continue;
    const group = cornerGroups[i] || 0;
    const key = `${sourceVertex}:${group}`;
    let outputVertex = remap.get(key);
    if (outputVertex === undefined) {
      outputVertex = sourceVertices.length;
      remap.set(key, outputVertex);
      sourceVertices.push(sourceVertex);
    }
    indexArray[i] = outputVertex;
  }
  const usedSourceVertices = new Set(sourceVertices);
  for (let sourceVertex = 0; sourceVertex < vertexCount; sourceVertex++) {
    if (!usedSourceVertices.has(sourceVertex)) sourceVertices.push(sourceVertex);
  }

  function duplicateAttribute(source, componentCount) {
    if (!source || source.length < vertexCount * componentCount) return source || null;
    const Ctor = ArrayBuffer.isView(source) ? source.constructor : Array;
    const output = new Ctor(sourceVertices.length * componentCount);
    for (let outputVertex = 0; outputVertex < sourceVertices.length; outputVertex++) {
      const sourceVertex = sourceVertices[outputVertex];
      const inBase = sourceVertex * componentCount;
      const outBase = outputVertex * componentCount;
      for (let component = 0; component < componentCount; component++) {
        output[outBase + component] = source[inBase + component];
      }
    }
    return output;
  }

  function duplicateMorphTargets(morphTargets) {
    if (!Array.isArray(morphTargets)) return morphTargets || null;
    return morphTargets.map((target) => {
      const duplicated = { ...target };
      if (target.positions) duplicated.positions = duplicateAttribute(target.positions, 3);
      if (target.normals) duplicated.normals = duplicateAttribute(target.normals, 3);
      if (target.tangents) duplicated.tangents = duplicateAttribute(target.tangents, 3);
      if (target.uvs) duplicated.uvs = duplicateAttribute(target.uvs, 2);
      return duplicated;
    });
  }

  const splitGeometry = {
    ...geometry,
    positions: duplicateAttribute(positions, 3),
    normals: duplicateAttribute(normals, 3),
    uvs: duplicateAttribute(uvs, 2),
    indices: indexArray,
    tangents: null,
  };
  if (geometry.uv1s) splitGeometry.uv1s = duplicateAttribute(geometry.uv1s, 2);
  if (geometry.joints) splitGeometry.joints = duplicateAttribute(geometry.joints, 4);
  if (geometry.weights) splitGeometry.weights = duplicateAttribute(geometry.weights, 4);
  if (geometry.morphTargets) splitGeometry.morphTargets = duplicateMorphTargets(geometry.morphTargets);
  const tangents = generateTangentsFromGeometry(
    splitGeometry.positions,
    splitGeometry.normals,
    splitGeometry.uvs,
    splitGeometry.indices,
    options
  );
  splitGeometry.tangents = tangents;
  analysis.outputVertexCount = sourceVertices.length;

  return {
    geometry: splitGeometry,
    tangents,
    didSplit: true,
    analysis,
  };
}

export function tangentSpaceCompatibilityReport(geometry, referenceTangents = null, options = {}) {
  const split = splitGeometryForTangentSpace(geometry, options);
  const outputGeometry = split.geometry || geometry;
  const tangents = outputGeometry?.tangents || split.tangents || null;
  const mikkInput = prepareMikkTSpaceInputGeometry(outputGeometry);
  const vertexCount = Math.floor((outputGeometry?.positions?.length || 0) / 3);
  const tolerance = Number.isFinite(options.tolerance) ? Math.max(0, options.tolerance) : 1e-5;
  const angleToleranceDegrees = Number.isFinite(options.angleToleranceDegrees)
    ? Math.max(0, options.angleToleranceDegrees)
    : 0.1;

  const report = {
    generator: TANGENT_SPACE_GENERATOR_FALLBACK,
    exactMikkTSpace: false,
    generated: !!tangents,
    didSplit: split.didSplit,
    analysis: split.analysis,
    mikkInputReady: mikkInput.ready,
    mikkInputAnalysis: mikkInput.analysis,
    vertexCount,
    referenceCompared: false,
    referenceCompatible: null,
    maxAbsComponentError: null,
    maxAngularErrorDegrees: null,
    handednessMismatches: null,
  };

  if (!tangents || !referenceTangents || referenceTangents.length < tangents.length) {
    return report;
  }

  report.referenceCompared = true;
  report.maxAbsComponentError = 0;
  report.maxAngularErrorDegrees = 0;
  report.handednessMismatches = 0;

  for (let i = 0; i < vertexCount; i++) {
    const base = i * 4;
    const actual = normalizeOrFallback(
      [tangents[base], tangents[base + 1], tangents[base + 2]],
      DEFAULT_TANGENT_VECTOR
    );
    const expected = normalizeOrFallback(
      [referenceTangents[base], referenceTangents[base + 1], referenceTangents[base + 2]],
      DEFAULT_TANGENT_VECTOR
    );
    const dot = Math.max(-1, Math.min(1, vec3Dot(actual, expected)));
    const angle = Math.acos(dot) * 180 / Math.PI;
    report.maxAngularErrorDegrees = Math.max(report.maxAngularErrorDegrees, angle);
    for (let component = 0; component < 4; component++) {
      report.maxAbsComponentError = Math.max(
        report.maxAbsComponentError,
        Math.abs(finiteOrDefault(tangents[base + component]) - finiteOrDefault(referenceTangents[base + component]))
      );
    }
    const actualTangent = [tangents[base], tangents[base + 1], tangents[base + 2], tangents[base + 3]];
    const referenceTangent = [
      referenceTangents[base],
      referenceTangents[base + 1],
      referenceTangents[base + 2],
      referenceTangents[base + 3],
    ];
    if (tangentHandedness(actualTangent) !== tangentHandedness(referenceTangent)) {
      report.handednessMismatches++;
    }
  }

  report.referenceCompatible =
    report.maxAbsComponentError <= tolerance &&
    report.maxAngularErrorDegrees <= angleToleranceDegrees &&
    report.handednessMismatches === 0;
  return report;
}

export function generateTangentsFromGeometry(positions, normals, uvs, indices = null, options = {}) {
  const vertexCount = Math.floor((positions?.length || 0) / 3);
  if (
    vertexCount <= 0 ||
    (normals?.length || 0) < vertexCount * 3 ||
    (uvs?.length || 0) < vertexCount * 2
  ) {
    return null;
  }

  const tan1 = new Float32Array(vertexCount * 3);
  const tan2 = new Float32Array(vertexCount * 3);
  const output = new Float32Array(vertexCount * 4);
  const indexCount = indices?.length || vertexCount;
  const triangleCount = Math.floor(indexCount / 3);

  for (let tri = 0; tri < triangleCount; tri++) {
    const i0 = indices ? indices[tri * 3] : tri * 3;
    const i1 = indices ? indices[tri * 3 + 1] : tri * 3 + 1;
    const i2 = indices ? indices[tri * 3 + 2] : tri * 3 + 2;
    if (
      !Number.isInteger(i0) || !Number.isInteger(i1) || !Number.isInteger(i2) ||
      i0 < 0 || i1 < 0 || i2 < 0 ||
      i0 >= vertexCount || i1 >= vertexCount || i2 >= vertexCount
    ) {
      continue;
    }

    const basis = triangleTangentBasis(positions, uvs, i0, i1, i2);
    if (!basis) continue;

    for (const vertex of [i0, i1, i2]) {
      const base = vertex * 3;
      tan1[base] += basis.tangent[0];
      tan1[base + 1] += basis.tangent[1];
      tan1[base + 2] += basis.tangent[2];
      tan2[base] += basis.bitangent[0];
      tan2[base + 1] += basis.bitangent[1];
      tan2[base + 2] += basis.bitangent[2];
    }
  }

  const defaultHandedness = options.handedness === -1 ? -1 : 1;
  for (let i = 0; i < vertexCount; i++) {
    const nBase = i * 3;
    const normal = normalizeOrFallback(
      [normals[nBase], normals[nBase + 1], normals[nBase + 2]],
      DEFAULT_TANGENT_NORMAL
    );
    const tangentFallback = fallbackTangentForNormal(normal);
    const rawTangent = [tan1[nBase], tan1[nBase + 1], tan1[nBase + 2]];
    const tangent = normalizeOrFallback(
      vec3Sub(rawTangent, vec3Scale(normal, vec3Dot(normal, rawTangent))),
      tangentFallback
    );
    const rawBitangent = [tan2[nBase], tan2[nBase + 1], tan2[nBase + 2]];
    const handedness = vec3LengthSq(rawBitangent) > EPSILON * EPSILON
      ? (vec3Dot(vec3Cross(normal, tangent), rawBitangent) < 0 ? -1 : 1)
      : defaultHandedness;
    const out = i * 4;
    output[out] = tangent[0];
    output[out + 1] = tangent[1];
    output[out + 2] = tangent[2];
    output[out + 3] = handedness;
  }

  return output;
}

export default {
  GLTF_COMPONENT_TYPES,
  MIKK_REFERENCE_CORPUS_REGISTRY,
  componentTypedArray,
  componentByteSize,
  accessorElementCount,
  normalizedComponentRange,
  normalizeAccessorComponent,
  readAccessorComponent,
  accessorPackedByteStride,
  accessorByteLayout,
  readAccessorArray,
  accessorDecodeMetadata,
  attributeBounds,
  attributeScaleBiasFromBounds,
  meshoptDecodeMetadata,
  indexBounds,
  tangentHandedness,
  tangentFrameFromNormalTangent,
  gltfBitangentFromTangent,
  decodeNormalTextureSample,
  normalTextureSampleToWorld,
  prepareMikkTSpaceInputGeometry,
  mikkTSpaceReferenceFingerprint,
  mikkTSpaceReferenceRegistryReport,
  mikkTSpaceReferenceProofReport,
  mikkTSpaceFaceTangentOutputReport,
  applyMikkTSpaceFaceTangents,
  splitGeometryForTangentSpace,
  tangentSpaceCompatibilityReport,
  generateTangentsFromGeometry,
};
