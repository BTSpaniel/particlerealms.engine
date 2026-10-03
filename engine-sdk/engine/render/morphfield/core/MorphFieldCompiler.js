// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { crc32 } from '../../../core/math/ChecksumMath.js';
import {
  ANALYTIC_LIMITS,
  ANALYTIC_GPU_PARAMETER_MINIMUM,
  ANALYTIC_OPCODE,
  FIELDLET_FAMILY,
  FIELDLET_FLAG,
  INVALID_REF,
  MORPHFIELD_SCHEMA_VERSION,
  PAYLOAD_SHAPE,
  QUERY_MASK,
  SOURCE_KIND,
  UPDATE_CLASS,
} from './constants.js';
import {
  createCertificateBundle,
  createCollisionCertificate,
  createFieldletHeader,
  createMediumCertificate,
  createMotionCertificate,
  createOutwardF32Bounds,
  createSurfaceCertificate,
  packFieldletMeta,
  validateFieldletAbi,
} from './FieldletAbi.js';
import { MorphFieldError, failMorphField } from './errors.js';
import { buildAabbBvh } from './AabbBvh.js';
import { NexelScene, normalizeNexelPatch } from './NexelScene.js';
import { MorphFieldReferenceEvaluator } from './ReferenceQueries.js';
import { canonicalStringify, utf8Encode } from './serialization.js';
import { composeTransforms, normalizeTransform } from './Transform.js';
import {
  computeNexelBounds,
  computeNexelQueryMask,
  countAnalyticInstructions,
  normalizeNexelDescriptor,
  planRepresentation,
  sourceContainsLocalTransforms,
  validateMaterialF32Channels,
} from './validation.js';

const COMPILED_SCENE_SCHEMA = 'morphfield-compiled-scene';
const COMPILED_PATCH_SCHEMA = 'morphfield-compiled-patch';
const RUNTIME_DELTA_SCHEMA = 'morphfield-runtime-delta';
const F32_EPSILON = 2 ** -23;
const WGSL_PRIMITIVE_ULP_BUDGET = 64;
const WGSL_COMPOSITION_ULP_BUDGET = 8;
const F32_MAX = 3.4028234663852886e38;
// Runtime activation is deliberately tied to objects published by this
// compiler module.  A schema-shaped object is not proof that its conservative
// certificates were derived by MorphField.  Keep this registry private: the
// runtime receives only a predicate, never a public branding function.
const COMPILED_ABI_ARRAYS = Object.freeze([
  'fieldletHeaders',
  'bounds',
  'payloads',
  'materials',
  'certificateBundles',
  'surfaceCertificates',
  'mediumCertificates',
  'motionCertificates',
  'collisionCertificates',
  'programWords',
  'analyticParameters',
  'bvhBounds',
  'bvhMetadata',
]);
const COMPILER_PRODUCED_SCENES = new WeakMap();

function compiledSceneFingerprint(compiled) {
  const arrays = COMPILED_ABI_ARRAYS.map(name => {
    const value = compiled[name];
    if (!ArrayBuffer.isView(value)) return `${name}:missing`;
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return `${name}:${value.constructor.name}:${value.byteLength}:${crc32(bytes)}`;
  });
  return [
    compiled.schema,
    compiled.version?.major,
    compiled.version?.minor,
    compiled.sceneId,
    compiled.revision,
    compiled.sourceCrc32,
    compiled.fieldletCount,
    ...arrays,
  ].join('|');
}

function publishCompiledScene(compiled) {
  const published = Object.freeze(compiled);
  COMPILER_PRODUCED_SCENES.set(published, compiledSceneFingerprint(published));
  return published;
}

export function isCompilerProducedCompiledScene(value) {
  if (value === null || typeof value !== 'object') return false;
  const expected = COMPILER_PRODUCED_SCENES.get(value);
  return expected !== undefined && expected === compiledSceneFingerprint(value);
}

function sameCompiledArray(left, right) {
  if (left?.constructor !== right?.constructor || left?.length !== right?.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!Object.is(left[index], right[index])) return false;
  }
  return true;
}

/**
 * Qualify a structured-cloned/worker result by deterministically recompiling
 * its authoritative semantic snapshot and comparing every executable ABI
 * byte. This is the cross-realm path; normal same-realm compiler output uses
 * the private registry above and does not pay for a second compilation.
 */
export function verifyCompiledSceneProvenance(value) {
  if (isCompilerProducedCompiledScene(value)) return true;
  if (!value || typeof value !== 'object' || !value.sceneSnapshot) return false;
  try {
    const reference = compileSceneSync(NexelScene.fromJSON(value.sceneSnapshot), {
      signal: null,
      retainSourceText: false,
    });
    if (value.schema !== reference.schema
        || value.version?.major !== reference.version.major
        || value.version?.minor !== reference.version.minor
        || value.sceneId !== reference.sceneId
        || value.revision !== reference.revision
        || value.sourceCrc32 !== reference.sourceCrc32
        || value.fieldletCount !== reference.fieldletCount
        || value.bvhRoot !== reference.bvhRoot
        || !Array.isArray(value.ids) || value.ids.length !== reference.ids.length
        || value.ids.some((id, index) => id !== reference.ids[index])) return false;
    return COMPILED_ABI_ARRAYS.every(name => sameCompiledArray(value[name], reference[name]));
  } catch {
    return false;
  }
}

function hasPackedFieldletIndex(idToIndex, id) {
  return idToIndex !== null
    && typeof idToIndex === 'object'
    && Object.prototype.hasOwnProperty.call(idToIndex, id);
}

function packedFieldletIndex(idToIndex, id, path = 'compiledScene.idToIndex') {
  if (!hasPackedFieldletIndex(idToIndex, id)) {
    failMorphField('COMPILED_ID_INDEX_MISSING', `${path} has no own entry for Nexel ${JSON.stringify(id)}`, {
      path,
      nexelId: id,
    });
  }
  const index = idToIndex[id];
  if (!Number.isSafeInteger(index) || index < 0) {
    failMorphField('COMPILED_ID_INDEX_INVALID', `${path}[${JSON.stringify(id)}] must be a non-negative safe integer`, {
      path,
      nexelId: id,
      index,
    });
  }
  return index;
}

function abortIfRequested(signal) {
  if (signal?.aborted) {
    if (typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
    throw new DOMException('MorphField compilation was aborted', 'AbortError');
  }
}

function f32Error(value) {
  return Math.abs(Number(value) - Math.fround(Number(value)));
}

function wgslArithmeticError(magnitude, ulpBudget) {
  return Math.max(Math.abs(Number(magnitude)), 1e-30) * F32_EPSILON * ulpBudget;
}

function ensureFiniteF32Parameter(value, name, details = {}) {
  if (!Number.isFinite(value) || Math.abs(value) > F32_MAX || !Number.isFinite(Math.fround(value))) {
    failMorphField('ANALYTIC_PARAMETER_F32_RANGE', `${name} cannot be represented as a finite f32 analytic parameter`, {
      ...details,
      name,
      value,
      maximumMagnitude: F32_MAX,
    });
  }
  return value;
}

function boundsMagnitude(bounds) {
  return Math.max(
    ...bounds.min.map(Math.abs),
    ...bounds.max.map(Math.abs),
    ...bounds.max.map((value, axis) => Math.abs(value - bounds.min[axis])),
    1e-30,
  );
}

function materialKey(material) {
  return canonicalStringify(material);
}

function packMaterial(material, path) {
  validateMaterialF32Channels(material, path);
  const emission = [...material.emissiveFactor];
  const emissionStrength = Math.max(...emission);
  let flags = 0;
  if (material.baseColorFactor[3] >= 0.999) flags |= 1;
  if (emissionStrength > 0) flags |= 1 << 1;
  if (material.baseColorTexture) flags |= 1 << 2;
  if (material.normalTexture) flags |= 1 << 3;
  return [
    material.baseColorFactor[0],
    material.baseColorFactor[1],
    material.baseColorFactor[2],
    material.baseColorFactor[3],
    material.roughnessFactor,
    material.metallicFactor,
    flags,
    1.5,
    emission[0],
    emission[1],
    emission[2],
    0,
  ];
}

function shapeCodeForSource(source) {
  switch (source.kind) {
    case SOURCE_KIND.SPHERE: return PAYLOAD_SHAPE.SPHERE;
    case SOURCE_KIND.BOX: return PAYLOAD_SHAPE.BOX;
    case SOURCE_KIND.CAPSULE: return PAYLOAD_SHAPE.CAPSULE;
    case SOURCE_KIND.CSG: return PAYLOAD_SHAPE.CSG;
    case SOURCE_KIND.SAMPLED_FIELD: return PAYLOAD_SHAPE.SAMPLED_FIELD;
    case SOURCE_KIND.SPARSE_RESIDUAL: return PAYLOAD_SHAPE.SPARSE_RESIDUAL;
    case SOURCE_KIND.ORIENTED_SAMPLES: return PAYLOAD_SHAPE.ORIENTED_SAMPLES;
    case SOURCE_KIND.INDEXED_SURFACE: return PAYLOAD_SHAPE.INDEXED_SURFACE;
    case SOURCE_KIND.MEDIUM: return PAYLOAD_SHAPE.MEDIUM;
    default: failMorphField('UNKNOWN_SOURCE_KIND', `Cannot assign a payload shape to ${String(source.kind)}`);
  }
}

function sourceLocalShape(source) {
  switch (source.kind) {
    case SOURCE_KIND.SPHERE:
      return { radius: source.radius, size: [source.radius, source.radius, source.radius] };
    case SOURCE_KIND.BOX:
      return { radius: Math.hypot(...source.halfExtents), size: [...source.halfExtents] };
    case SOURCE_KIND.CAPSULE:
      return {
        radius: source.radius,
        size: [source.radius, source.halfHeight, source.radius],
      };
    default:
      return null;
  }
}

function isDirectAnalyticSource(source) {
  return source?.kind === SOURCE_KIND.SPHERE
    || source?.kind === SOURCE_KIND.BOX
    || source?.kind === SOURCE_KIND.CAPSULE;
}

function analyticParameterRecord(source, transform, details = {}) {
  if (!(transform.scale >= ANALYTIC_GPU_PARAMETER_MINIMUM)) {
    failMorphField('ANALYTIC_SCALE_BELOW_GPU_MINIMUM', `Composed analytic scale must be at least ${ANALYTIC_GPU_PARAMETER_MINIMUM}`, {
      ...details,
      sourceKind: source.kind,
      scale: transform.scale,
      minimum: ANALYTIC_GPU_PARAMETER_MINIMUM,
    });
  }
  const shapeParameters = source.kind === SOURCE_KIND.SPHERE
    ? [source.radius, 0, 0]
    : source.kind === SOURCE_KIND.BOX
      ? [...source.halfExtents]
      : [source.radius, source.halfHeight, 0];
  const record = [
    transform.translation[0], transform.translation[1], transform.translation[2], transform.scale,
    transform.rotation[0], transform.rotation[1], transform.rotation[2], transform.rotation[3],
    shapeParameters[0], shapeParameters[1], shapeParameters[2], shapeCodeForSource(source),
    0, 0, 0, 0,
  ];
  record.forEach((value, index) => ensureFiniteF32Parameter(value, `analyticParameter[${index}]`, {
    ...details,
    sourceKind: source.kind,
  }));
  return record;
}

function analyticPrimitiveError(source, transform, evaluationMagnitude) {
  const parameters = analyticParameterRecord(source, transform);
  let storageError = 0;
  let parameterMagnitude = Math.abs(Number(evaluationMagnitude));
  for (const value of parameters) {
    storageError += f32Error(value);
    parameterMagnitude = Math.max(parameterMagnitude, Math.abs(value));
  }
  return storageError + wgslArithmeticError(parameterMagnitude, WGSL_PRIMITIVE_ULP_BUDGET);
}

function sourceLipschitzAndError(source, evaluationMagnitude = 1, inheritedTransform = normalizeTransform()) {
  switch (source.kind) {
    case SOURCE_KIND.SPHERE:
    case SOURCE_KIND.BOX:
    case SOURCE_KIND.CAPSULE: {
      const localTransform = composeTransforms(inheritedTransform, normalizeTransform(source.transform));
      return {
        lipschitzMax: 1,
        fieldValueErrorMax: analyticPrimitiveError(source, localTransform, evaluationMagnitude),
      };
    }
    case SOURCE_KIND.CSG: {
      const csgTransform = composeTransforms(inheritedTransform, normalizeTransform(source.transform));
      let lipschitzMax = 0;
      let fieldValueErrorMax = 0;
      for (const child of source.children) {
        const childCertificate = sourceLipschitzAndError(child, evaluationMagnitude, csgTransform);
        lipschitzMax = Math.max(lipschitzMax, childCertificate.lipschitzMax);
        fieldValueErrorMax = Math.max(fieldValueErrorMax, childCertificate.fieldValueErrorMax);
      }
      return {
        lipschitzMax,
        fieldValueErrorMax: fieldValueErrorMax
          + wgslArithmeticError(evaluationMagnitude, WGSL_COMPOSITION_ULP_BUDGET),
      };
    }
    case SOURCE_KIND.SAMPLED_FIELD: {
      const [nx, ny, nz] = source.dimensions;
      const spacing = source.bounds.max.map((value, axis) => (value - source.bounds.min[axis]) / (source.dimensions[axis] - 1));
      const index = (x, y, z) => x + nx * (y + ny * z);
      const maxima = [0, 0, 0];
      let fieldValueErrorMax = 0;
      let fieldMagnitude = 0;
      for (let z = 0; z < nz; z++) {
        for (let y = 0; y < ny; y++) {
          for (let x = 0; x < nx; x++) {
            const value = source.values[index(x, y, z)];
            fieldValueErrorMax = Math.max(fieldValueErrorMax, f32Error(value));
            fieldMagnitude = Math.max(fieldMagnitude, Math.abs(value));
            if (x + 1 < nx) maxima[0] = Math.max(maxima[0], Math.abs(source.values[index(x + 1, y, z)] - value) / spacing[0]);
            if (y + 1 < ny) maxima[1] = Math.max(maxima[1], Math.abs(source.values[index(x, y + 1, z)] - value) / spacing[1]);
            if (z + 1 < nz) maxima[2] = Math.max(maxima[2], Math.abs(source.values[index(x, y, z + 1)] - value) / spacing[2]);
          }
        }
      }
      return {
        lipschitzMax: Math.max(Math.hypot(...maxima), 1e-12),
        fieldValueErrorMax: fieldValueErrorMax + wgslArithmeticError(
          Math.max(evaluationMagnitude, fieldMagnitude),
          WGSL_PRIMITIVE_ULP_BUDGET,
        ),
      };
    }
    case SOURCE_KIND.SPARSE_RESIDUAL: {
      const residualTransform = composeTransforms(inheritedTransform, normalizeTransform(source.transform));
      const base = sourceLipschitzAndError(source.base, evaluationMagnitude, residualTransform);
      const residual = sourceLipschitzAndError({ ...source, kind: SOURCE_KIND.SAMPLED_FIELD }, evaluationMagnitude, inheritedTransform);
      return {
        lipschitzMax: base.lipschitzMax + residual.lipschitzMax,
        fieldValueErrorMax: base.fieldValueErrorMax + residual.fieldValueErrorMax
          + wgslArithmeticError(evaluationMagnitude, WGSL_COMPOSITION_ULP_BUDGET),
      };
    }
    case SOURCE_KIND.ORIENTED_SAMPLES: {
      let lipschitzMax = 0;
      let fieldValueErrorMax = f32Error(source.isoValue);
      for (const sample of source.samples) {
        lipschitzMax += sample.weight / (Math.min(...sample.radii) * Math.sqrt(Math.E));
        fieldValueErrorMax = Math.max(fieldValueErrorMax, f32Error(sample.weight), ...sample.radii.map(f32Error));
      }
      return {
        lipschitzMax: Math.max(lipschitzMax, 1e-12),
        fieldValueErrorMax: fieldValueErrorMax
          + wgslArithmeticError(evaluationMagnitude, WGSL_PRIMITIVE_ULP_BUDGET),
      };
    }
    default:
      return null;
  }
}

function emitAnalyticProgram(source, state, inheritedTransform = normalizeTransform()) {
  const localTransform = composeTransforms(inheritedTransform, normalizeTransform(source.transform));
  const emitPrimitive = opcode => {
    const parameterRef = state.parameterData.length / 16;
    const parameter = {
      kind: source.kind,
      transform: {
        translation: [...localTransform.translation],
        rotation: [...localTransform.rotation],
        scale: localTransform.scale,
      },
    };
    if (source.kind === SOURCE_KIND.SPHERE) parameter.radius = source.radius;
    else if (source.kind === SOURCE_KIND.BOX) parameter.halfExtents = [...source.halfExtents];
    else if (source.kind === SOURCE_KIND.CAPSULE) {
      parameter.radius = source.radius;
      parameter.halfHeight = source.halfHeight;
    }
    state.parameterData.push(...analyticParameterRecord(source, localTransform, { nexelId: state.nexelId }));
    state.parameterDescriptors.push(Object.freeze(parameter));
    state.instructions.push(opcode, parameterRef);
  };
  if (source.kind === SOURCE_KIND.SPHERE) emitPrimitive(ANALYTIC_OPCODE.SPHERE);
  else if (source.kind === SOURCE_KIND.BOX) emitPrimitive(ANALYTIC_OPCODE.BOX);
  else if (source.kind === SOURCE_KIND.CAPSULE) emitPrimitive(ANALYTIC_OPCODE.CAPSULE);
  else if (source.kind === SOURCE_KIND.CSG) {
    const csgTransform = localTransform;
    emitAnalyticProgram(source.children[0], state, csgTransform);
    for (let index = 1; index < source.children.length; index++) {
      emitAnalyticProgram(source.children[index], state, csgTransform);
      state.instructions.push(
        source.operation === 'union'
          ? ANALYTIC_OPCODE.UNION
          : source.operation === 'intersection'
            ? ANALYTIC_OPCODE.INTERSECTION
            : ANALYTIC_OPCODE.DIFFERENCE,
        0,
      );
    }
  } else {
    failMorphField('NON_ANALYTIC_SOURCE', `Cannot emit analytic program for ${source.kind}`);
  }
}

function emitGridFieldData(source, state, inheritedTransform, nexelId) {
  while (state.parameterData.length % 16 !== 0) state.parameterData.push(0);
  const headerRef = state.parameterData.length / 4;
  const transform = composeTransforms(inheritedTransform, normalizeTransform(source.transform));
  const isResidual = source.kind === SOURCE_KIND.SPARSE_RESIDUAL;
  let baseProgramOffset = -1;
  let baseProgramLength = 0;
  const headerOffset = state.parameterData.length;
  // Reserve two complete 16-float ABI records. Analytic operands are indexed
  // in 16-float records, so residual metadata must not break that alignment.
  state.parameterData.push(...new Array(32).fill(0));

  if (isResidual) {
    baseProgramLength = countAnalyticInstructions(source.base);
    if (baseProgramLength > ANALYTIC_LIMITS.MAX_PROGRAM_INSTRUCTIONS) {
      failMorphField('ANALYTIC_PROGRAM_LIMIT', `Nexel ${nexelId} residual base requires ${baseProgramLength} instructions`, {
        nexelId,
        programLength: baseProgramLength,
      });
    }
    baseProgramOffset = state.instructions.length / 2;
    emitAnalyticProgram(source.base, state, transform);
    validateProgram(state.instructions, baseProgramOffset * 2, baseProgramLength);
  }

  const valuesRef = state.parameterData.length / 4;
  state.parameterData.push(...source.values);
  while (state.parameterData.length % 4 !== 0) state.parameterData.push(0);
  const header = [
    source.dimensions[0], source.dimensions[1], source.dimensions[2], isResidual ? 1 : 0,
    source.bounds.min[0], source.bounds.min[1], source.bounds.min[2], source.values.length,
    source.bounds.max[0], source.bounds.max[1], source.bounds.max[2], valuesRef,
    transform.translation[0], transform.translation[1], transform.translation[2], transform.scale,
    transform.rotation[0], transform.rotation[1], transform.rotation[2], transform.rotation[3],
    baseProgramOffset, baseProgramLength, 0, 0,
  ];
  header.forEach((value, index) => ensureFiniteF32Parameter(value, `gridFieldHeader[${index}]`, {
    nexelId,
    sourceKind: source.kind,
  }));
  state.parameterData.splice(headerOffset, header.length, ...header);
  while (state.parameterData.length % 16 !== 0) state.parameterData.push(0);
  return Object.freeze({ headerRef, valuesRef, baseProgramOffset, baseProgramLength });
}

function validateProgram(words, startWord, instructionCount) {
  let depth = 0;
  let maximumDepth = 0;
  for (let instruction = 0; instruction < instructionCount; instruction++) {
    const opcode = words[startWord + instruction * 2];
    if (opcode === ANALYTIC_OPCODE.SPHERE || opcode === ANALYTIC_OPCODE.BOX || opcode === ANALYTIC_OPCODE.CAPSULE) depth += 1;
    else if (opcode === ANALYTIC_OPCODE.UNION || opcode === ANALYTIC_OPCODE.INTERSECTION || opcode === ANALYTIC_OPCODE.DIFFERENCE) {
      if (depth < 2) failMorphField('ANALYTIC_STACK_UNDERFLOW', 'Analytic program would underflow its value stack');
      depth -= 1;
    } else {
      failMorphField('UNKNOWN_ANALYTIC_OPCODE', `Unknown analytic opcode ${opcode}`);
    }
    maximumDepth = Math.max(maximumDepth, depth);
  }
  if (depth !== 1) failMorphField('ANALYTIC_STACK_RESULT', `Analytic program leaves ${depth} values instead of one`);
  if (maximumDepth > ANALYTIC_LIMITS.MAX_STACK_DEPTH) {
    failMorphField('ANALYTIC_STACK_LIMIT', `Analytic program requires ${maximumDepth} stack values`);
  }
}

function deriveMediumCertificate(nexel, boundsRadius, motionRadiusMax) {
  if (nexel.source.kind !== SOURCE_KIND.MEDIUM) return null;
  const emissionLuminance = 0.2126 * nexel.source.emission[0]
    + 0.7152 * nexel.source.emission[1]
    + 0.0722 * nexel.source.emission[2];
  return {
    densityMax: nexel.source.density,
    extinctionMax: nexel.source.extinction,
    emissionLuminanceMax: emissionLuminance,
    motionRadiusMax: Math.max(motionRadiusMax, boundsRadius),
  };
}

function deriveMotionCertificate(nexel, boundsRadius) {
  if (!nexel.motion) return null;
  const speedMax = Math.hypot(...nexel.motion.velocity) + Math.hypot(...nexel.motion.angularVelocity) * boundsRadius;
  const accelerationMax = Math.hypot(...nexel.motion.acceleration);
  const duration = nexel.motion.validDuration;
  return {
    displacementMax: speedMax * duration + 0.5 * accelerationMax * duration * duration,
    speedMax,
    accelerationMax,
    validDuration: duration,
  };
}

function appendRecord(records, factory, descriptor) {
  if (!descriptor) return INVALID_REF;
  const reference = records.length / 4;
  records.push(...factory(descriptor));
  return reference;
}

function fieldletFlags(nexel, queryMask, plan) {
  let flags = 0;
  if (nexel.intent.updateClass !== UPDATE_CLASS.STATIC) flags |= FIELDLET_FLAG.DYNAMIC;
  if (nexel.intent.authoritative) flags |= FIELDLET_FLAG.AUTHORITATIVE;
  if (nexel.material.baseColorFactor[3] >= 0.999) flags |= FIELDLET_FLAG.OPAQUE;
  if (sourceContainsLocalTransforms(nexel.source)) flags |= FIELDLET_FLAG.HAS_LOCAL_TRANSFORMS;
  if (queryMask & QUERY_MASK.SURFACE) flags |= FIELDLET_FLAG.CERTIFIED_SURFACE;
  if (queryMask & QUERY_MASK.MEDIUM) flags |= FIELDLET_FLAG.CERTIFIED_MEDIUM;
  if (queryMask & QUERY_MASK.MOTION) flags |= FIELDLET_FLAG.CERTIFIED_MOTION;
  if (queryMask & QUERY_MASK.COLLISION) flags |= FIELDLET_FLAG.CERTIFIED_COLLISION;
  if (plan.family === FIELDLET_FAMILY.SPARSE_RESIDUAL) flags |= FIELDLET_FLAG.STREAMABLE;
  if (plan.family === FIELDLET_FAMILY.CACHED_SURFACE) flags |= FIELDLET_FLAG.DISPOSABLE_CACHE;
  return flags;
}

function compileSceneSync(scene, options) {
  validateFieldletAbi();
  abortIfRequested(options.signal);
  const descriptors = scene.values();
  const count = descriptors.length;
  const fieldletHeaders = new Uint32Array(count * 4);
  const bounds = new Float32Array(count * 8);
  const payloads = new Float32Array(count * 16);
  const certificateBundles = new Uint32Array(count * 4);
  const surfaceRecords = [];
  const mediumRecords = [];
  const motionRecords = [];
  const collisionRecords = [];
  const instructionWords = [];
  const analyticParameterData = [];
  const analyticParameterDescriptors = [];
  const payloadDescriptors = [];
  const representationPlan = [];
  const materialsList = [];
  const materialIndexByKey = new Map();
  const materialData = [];
  const bvhLeaves = [];
  // Nexel ids are schema-valid strings, including names such as "__proto__"
  // and "constructor". A null prototype makes every packed id an ordinary own
  // property and prevents inherited Object members from aliasing Fieldlets.
  const idToIndex = Object.create(null);

  for (let index = 0; index < count; index++) {
    abortIfRequested(options.signal);
    const nexel = descriptors[index];
    const plan = planRepresentation(nexel.source);
    const queryMask = computeNexelQueryMask(nexel);
    const nexelBounds = computeNexelBounds(nexel);
    const halfExtents = nexelBounds.max.map((value, axis) => (value - nexelBounds.min[axis]) * 0.5);
    const center = nexelBounds.min.map((value, axis) => value + halfExtents[axis]);
    const boundsRadius = Math.hypot(...halfExtents);
    const nexelTransform = normalizeTransform(nexel.transform);
    const materialKeyValue = materialKey(nexel.material);
    let materialIndex = materialIndexByKey.get(materialKeyValue);
    if (materialIndex === undefined) {
      materialIndex = materialsList.length;
      materialIndexByKey.set(materialKeyValue, materialIndex);
      materialsList.push(nexel.material);
      materialData.push(...packMaterial(nexel.material, `nexel[${JSON.stringify(nexel.id)}].material`));
    }
    let programOffset = -1;
    let programLength = 0;
    let fieldData = null;
    if (plan.family === FIELDLET_FAMILY.ANALYTIC
        && nexel.source.kind !== SOURCE_KIND.MEDIUM
        && !isDirectAnalyticSource(nexel.source)) {
      programLength = countAnalyticInstructions(nexel.source);
      if (programLength > ANALYTIC_LIMITS.MAX_PROGRAM_INSTRUCTIONS) {
        failMorphField('ANALYTIC_PROGRAM_LIMIT', `Nexel ${nexel.id} requires ${programLength} instructions; the certified R2 program limit is ${ANALYTIC_LIMITS.MAX_PROGRAM_INSTRUCTIONS}`, {
          nexelId: nexel.id,
          programLength,
        });
      }
      programOffset = instructionWords.length / 2;
      const state = {
        instructions: instructionWords,
        parameterData: analyticParameterData,
        parameterDescriptors: analyticParameterDescriptors,
        nexelId: nexel.id,
      };
      emitAnalyticProgram(nexel.source, state, nexelTransform);
      validateProgram(instructionWords, programOffset * 2, programLength);
    }
    if (plan.family === FIELDLET_FAMILY.SPARSE_RESIDUAL) {
      fieldData = emitGridFieldData(nexel.source, {
        instructions: instructionWords,
        parameterData: analyticParameterData,
        parameterDescriptors: analyticParameterDescriptors,
        nexelId: nexel.id,
      }, nexelTransform, nexel.id);
      programOffset = fieldData.headerRef;
      programLength = 0;
    }
    const surfaceDescriptor = sourceLipschitzAndError(nexel.source, boundsMagnitude(nexelBounds), nexelTransform);
    const motionDescriptor = deriveMotionCertificate(nexel, boundsRadius);
    const motionRadiusMax = motionDescriptor?.displacementMax ?? 0;
    const mediumDescriptor = deriveMediumCertificate(nexel, boundsRadius, motionRadiusMax);
    const surfaceRef = appendRecord(surfaceRecords, createSurfaceCertificate, surfaceDescriptor && {
      ...surfaceDescriptor,
      fallbackBand: Math.max(surfaceDescriptor.fieldValueErrorMax * 4, 1e-6),
      motionRadiusMax,
    });
    const mediumRef = appendRecord(mediumRecords, createMediumCertificate, mediumDescriptor);
    const motionRef = appendRecord(motionRecords, createMotionCertificate, motionDescriptor);
    const collisionRef = appendRecord(collisionRecords, createCollisionCertificate,
      nexel.collision && surfaceDescriptor ? {
        ...surfaceDescriptor,
        contactOffset: nexel.collision.contactOffset,
        motionRadiusMax,
      } : null);
    const surfaceErrorRadius = surfaceRef === INVALID_REF ? 0 : surfaceRecords[surfaceRef * 4];
    const traceBounds = createOutwardF32Bounds(nexelBounds, surfaceErrorRadius);
    const bundle = createCertificateBundle({ surfaceRef, mediumRef, motionRef, collisionRef });
    certificateBundles.set(bundle, index * 4);
    const flags = fieldletFlags(nexel, queryMask, plan)
      & ~(surfaceRef === INVALID_REF ? FIELDLET_FLAG.CERTIFIED_SURFACE : 0)
      & ~(mediumRef === INVALID_REF ? FIELDLET_FLAG.CERTIFIED_MEDIUM : 0)
      & ~(motionRef === INVALID_REF ? FIELDLET_FLAG.CERTIFIED_MOTION : 0)
      & ~(collisionRef === INVALID_REF ? FIELDLET_FLAG.CERTIFIED_COLLISION : 0);
    const meta = packFieldletMeta({ subtype: plan.subtype, family: plan.family, queryMask, flags });
    fieldletHeaders.set(createFieldletHeader({ boundsRef: index, payloadRef: index, meta, certificateRef: index }), index * 4);
    bounds.set([traceBounds.min[0], traceBounds.min[1], traceBounds.min[2], 0], index * 8);
    bounds.set([traceBounds.max[0], traceBounds.max[1], traceBounds.max[2], 0], index * 8 + 4);
    const sourceShape = sourceLocalShape(nexel.source);
    const sourceTransform = normalizeTransform(nexel.source.transform);
    const combinedTransform = composeTransforms(nexelTransform, sourceTransform);
    const size = sourceShape
      ? sourceShape.size.map(value => value * combinedTransform.scale)
      : halfExtents;
    const radius = sourceShape ? sourceShape.radius * combinedTransform.scale : boundsRadius;
    payloads.set([
      center[0], center[1], center[2], radius,
      size[0], size[1], size[2], shapeCodeForSource(nexel.source),
      combinedTransform.rotation[0], combinedTransform.rotation[1], combinedTransform.rotation[2], combinedTransform.rotation[3],
      programOffset, programLength, materialIndex, queryMask,
    ], index * 16);
    payloadDescriptors.push(Object.freeze({
      index,
      nexelId: nexel.id,
      family: plan.family,
      subtype: plan.subtype,
      shape: shapeCodeForSource(nexel.source),
      source: nexel.source,
      programOffset,
      programLength,
      fieldData,
      materialIndex,
      queryMask,
    }));
    representationPlan.push(Object.freeze({ nexelId: nexel.id, ...plan }));
    bvhLeaves.push({ id: nexel.id, sourceIndex: index, bounds: traceBounds });
    idToIndex[nexel.id] = index;
  }
  const bvh = buildAabbBvh(bvhLeaves);
  const bvhGpu = bvh.toGpuArrays();
  const sceneSnapshot = scene.toJSON();
  const canonicalSource = canonicalStringify(sceneSnapshot);
  const compiled = {
    schema: COMPILED_SCENE_SCHEMA,
    version: Object.freeze({ ...MORPHFIELD_SCHEMA_VERSION }),
    sceneId: scene.id,
    units: scene.units,
    revision: scene.revision,
    sourceCrc32: crc32(utf8Encode(canonicalSource)),
    sourceText: options.retainSourceText === false ? null : canonicalSource,
    sceneSnapshot,
    descriptors: Object.freeze(descriptors),
    ids: Object.freeze(descriptors.map(descriptor => descriptor.id)),
    idToIndex: Object.freeze(idToIndex),
    fieldletCount: count,
    fieldletHeaders,
    bounds,
    payloads,
    materials: new Float32Array(materialData),
    materialDescriptors: Object.freeze(materialsList),
    certificateBundles,
    surfaceCertificates: new Float32Array(surfaceRecords),
    mediumCertificates: new Float32Array(mediumRecords),
    motionCertificates: new Float32Array(motionRecords),
    collisionCertificates: new Float32Array(collisionRecords),
    programWords: new Uint32Array(instructionWords),
    analyticParameters: new Float32Array(analyticParameterData),
    analyticParameterDescriptors: Object.freeze(analyticParameterDescriptors),
    payloadDescriptors: Object.freeze(payloadDescriptors),
    representationPlan: Object.freeze(representationPlan),
    bvh,
    bvhBounds: bvhGpu.bounds,
    bvhMetadata: bvhGpu.metadata,
    bvhRoot: bvhGpu.root,
    statistics: Object.freeze({
      fieldletCount: count,
      materialCount: materialsList.length,
      analyticInstructionCount: instructionWords.length / 2,
      analyticParameterCount: analyticParameterData.length / 16,
      fieldParameterVec4Count: analyticParameterData.length / 4,
      residualSampleCount: representationPlan.reduce((sum, entry, planIndex) => (
        entry.family === FIELDLET_FAMILY.SPARSE_RESIDUAL
          ? sum + descriptors[planIndex].source.values.length
          : sum
      ), 0),
      bvhNodeCount: bvh.nodeCount,
      certificateRecordCount: (surfaceRecords.length + mediumRecords.length + motionRecords.length + collisionRecords.length) / 4,
      execution: 'main-thread',
    }),
  };
  compiled.certificates = Object.freeze({
    bundles: certificateBundles,
    surface: compiled.surfaceCertificates,
    medium: compiled.mediumCertificates,
    motion: compiled.motionCertificates,
    collision: compiled.collisionCertificates,
  });
  compiled.createReferenceEvaluator = () => new MorphFieldReferenceEvaluator(compiled);
  return publishCompiledScene(compiled);
}

function normalizeSceneInput(input) {
  if (input instanceof NexelScene) return input.clone();
  return NexelScene.fromJSON(input);
}

/**
 * Run the compiler's exact isolated-descriptor admission gates synchronously.
 * Capability inspection uses this probe so it cannot claim a direct GPU path
 * for a descriptor that compilation would later reject.
 */
export function inspectNexelCompilerFeasibility(input) {
  try {
    const descriptor = normalizeNexelDescriptor(input, 'nexel');
    const isolatedScene = new NexelScene({
      id: 'morphfield-compiler-feasibility',
      units: 'meters',
      nexels: [{ ...descriptor, collision: descriptor.collision ?? false }],
    });
    compileSceneSync(isolatedScene, { signal: null, retainSourceText: false });
    return Object.freeze({ feasible: true, code: null, message: null });
  } catch (error) {
    if (!(error instanceof MorphFieldError)) throw error;
    return Object.freeze({
      feasible: false,
      code: error.code,
      message: error.message,
    });
  }
}

function isPrimitiveOpcode(opcode) {
  return opcode === ANALYTIC_OPCODE.SPHERE
    || opcode === ANALYTIC_OPCODE.BOX
    || opcode === ANALYTIC_OPCODE.CAPSULE;
}

function immutableNumbers(values) {
  return Object.freeze([...values].map(value => Number(value)));
}

function compiledLayoutSignature(compiled) {
  return Object.freeze({
    fieldletCount: compiled.fieldletCount,
    fieldletHeaders: compiled.fieldletHeaders.byteLength,
    bounds: compiled.bounds.byteLength,
    payloads: compiled.payloads.byteLength,
    certificateBundles: compiled.certificateBundles.byteLength,
    surfaceCertificates: Math.max(16, compiled.surfaceCertificates.byteLength),
    mediumCertificates: Math.max(16, compiled.mediumCertificates.byteLength),
    motionCertificates: Math.max(16, compiled.motionCertificates.byteLength),
    collisionCertificates: Math.max(16, compiled.collisionCertificates.byteLength),
    programWords: Math.max(8, compiled.programWords.byteLength),
    analyticParameters: Math.max(64, compiled.analyticParameters.byteLength),
    materials: Math.max(48, compiled.materials.byteLength),
    bvhBounds: Math.max(32, compiled.bvhBounds.byteLength),
    bvhMetadata: Math.max(4, compiled.bvhMetadata.byteLength),
  });
}

function programLayout(compiled, fieldletIndex) {
  const payloadBase = fieldletIndex * 16;
  const programOffset = compiled.payloads[payloadBase + 12];
  const programLength = compiled.payloads[payloadBase + 13];
  if (!Number.isInteger(programOffset) || programOffset < 0
      || !Number.isInteger(programLength) || programLength <= 0
      || (programOffset + programLength) * 2 > compiled.programWords.length) return null;
  const parameterRefs = [];
  for (let instruction = 0; instruction < programLength; instruction += 1) {
    const wordOffset = (programOffset + instruction) * 2;
    const opcode = compiled.programWords[wordOffset];
    if (isPrimitiveOpcode(opcode)) parameterRefs.push(compiled.programWords[wordOffset + 1]);
  }
  if (parameterRefs.length === 0) return null;
  const parameterBase = parameterRefs[0];
  if (parameterRefs.some((reference, index) => reference !== parameterBase + index)
      || (parameterBase + parameterRefs.length) * 16 > compiled.analyticParameters.length) return null;
  return Object.freeze({ programOffset, programLength, parameterBase, parameterCount: parameterRefs.length });
}

function certificatePresence(bundleArray, bundleIndex) {
  const base = bundleIndex * 4;
  return Array.from({ length: 4 }, (_, index) => bundleArray[base + index] !== INVALID_REF);
}

function sameBooleanRecords(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function cloneCompiledAbi(previous) {
  return {
    fieldletHeaders: new Uint32Array(previous.fieldletHeaders),
    bounds: new Float32Array(previous.bounds),
    payloads: new Float32Array(previous.payloads),
    certificateBundles: new Uint32Array(previous.certificateBundles),
    surfaceCertificates: new Float32Array(previous.surfaceCertificates),
    mediumCertificates: new Float32Array(previous.mediumCertificates),
    motionCertificates: new Float32Array(previous.motionCertificates),
    collisionCertificates: new Float32Array(previous.collisionCertificates),
    programWords: new Uint32Array(previous.programWords),
    analyticParameters: new Float32Array(previous.analyticParameters),
    materials: new Float32Array(previous.materials),
  };
}

function copyCertificateRecord(target, targetRef, source, sourceRef) {
  if (targetRef === INVALID_REF || sourceRef === INVALID_REF) return targetRef === sourceRef;
  const targetBase = targetRef * 4;
  const sourceBase = sourceRef * 4;
  if (targetBase + 4 > target.length || sourceBase + 4 > source.length) return false;
  target.set(source.subarray(sourceBase, sourceBase + 4), targetBase);
  return true;
}

function collectRefitNodes(bvh, ids) {
  const nodes = new Set();
  for (const id of ids) {
    const leafIndex = bvh.leafIndexById.get(id);
    if (leafIndex === undefined) return null;
    let nodeIndex = bvh.leafNodeIndices[leafIndex];
    while (nodeIndex >= 0) {
      nodes.add(nodeIndex);
      nodeIndex = bvh.parents[nodeIndex];
    }
  }
  return [...nodes].sort((a, b) => a - b);
}

function stableAnalyticPatch(previous, nextScene, patch, options) {
  if (!previous) return Object.freeze({ reason: 'missing-compiled-baseline' });
  if (patch.completeSnapshot) return Object.freeze({ reason: 'complete-snapshot' });
  if (patch.remove.length > 0) return Object.freeze({ reason: 'remove-changes-layout' });
  if (patch.upsert.some(descriptor => !hasPackedFieldletIndex(previous.idToIndex, descriptor.id))) {
    return Object.freeze({ reason: 'new-id-changes-layout' });
  }
  if (!previous.bvh || typeof previous.bvh.clone !== 'function') {
    return Object.freeze({ reason: 'baseline-bvh-not-refittable' });
  }

  const abi = cloneCompiledAbi(previous);
  const descriptors = [...previous.descriptors];
  const payloadDescriptors = [...previous.payloadDescriptors];
  const representationPlan = [...previous.representationPlan];
  const parameterDescriptors = [...previous.analyticParameterDescriptors];
  const touchedIndices = [];
  const surfaceRefs = new Set();
  const mediumRefs = new Set();
  const motionRefs = new Set();
  const collisionRefs = new Set();
  const parameterRefs = new Set();
  const programRanges = [];
  const refitBounds = new Map();

  for (const descriptor of patch.upsert) {
    abortIfRequested(options.signal);
    const fieldletIndex = packedFieldletIndex(previous.idToIndex, descriptor.id, 'previous.idToIndex');
    const previousPayloadBase = fieldletIndex * 16;
    const previousMeta = previous.fieldletHeaders[fieldletIndex * 4 + 2];
    const previousFamily = (previousMeta >>> 12) & 0xF;
    const previousQueryMask = (previousMeta >>> 16) & 0x3F;
    if (previousFamily !== FIELDLET_FAMILY.ANALYTIC
        || materialKey(descriptor.material) !== materialKey(previous.materialDescriptors[previous.payloads[previousPayloadBase + 14]])) {
      return Object.freeze({ reason: previousFamily !== FIELDLET_FAMILY.ANALYTIC
        ? 'non-analytic-baseline'
        : 'material-ownership-changed' });
    }

    const isolatedScene = new NexelScene({
      id: nextScene.id,
      units: nextScene.units,
      revision: nextScene.revision,
      // Normalized descriptors use null for a disabled collision query, while
      // the public descriptor grammar spells that state as `false`.
      nexels: [{ ...descriptor, collision: descriptor.collision ?? false }],
    });
    const isolated = compileSceneSync(isolatedScene, options);
    const isolatedMeta = isolated.fieldletHeaders[2];
    const isolatedFamily = (isolatedMeta >>> 12) & 0xF;
    const isolatedQueryMask = (isolatedMeta >>> 16) & 0x3F;
    if (isolatedFamily !== FIELDLET_FAMILY.ANALYTIC || isolatedQueryMask !== previousQueryMask) {
      return Object.freeze({ reason: isolatedFamily !== previousFamily
        ? 'execution-family-changed'
        : 'query-mask-changed' });
    }
    const previousCertificatePresence = certificatePresence(previous.certificateBundles, fieldletIndex);
    const isolatedCertificatePresence = certificatePresence(isolated.certificateBundles, 0);
    if (!sameBooleanRecords(previousCertificatePresence, isolatedCertificatePresence)) {
      return Object.freeze({ reason: 'certificate-layout-changed' });
    }
    const previousProgram = programLayout(previous, fieldletIndex);
    const isolatedProgram = programLayout(isolated, 0);
    const directPrimitiveLayout = previousProgram === null && isolatedProgram === null;
    if (!directPrimitiveLayout && (!previousProgram || !isolatedProgram
        || previousProgram.programLength !== isolatedProgram.programLength
        || previousProgram.parameterCount !== isolatedProgram.parameterCount)) {
      return Object.freeze({ reason: 'analytic-program-layout-changed' });
    }

    const oldBundleBase = fieldletIndex * 4;
    const oldBundle = previous.certificateBundles.subarray(oldBundleBase, oldBundleBase + 4);
    const isolatedBundle = isolated.certificateBundles.subarray(0, 4);
    const certificateCopies = [
      [abi.surfaceCertificates, oldBundle[0], isolated.surfaceCertificates, isolatedBundle[0], surfaceRefs],
      [abi.mediumCertificates, oldBundle[1], isolated.mediumCertificates, isolatedBundle[1], mediumRefs],
      [abi.motionCertificates, oldBundle[2], isolated.motionCertificates, isolatedBundle[2], motionRefs],
      [abi.collisionCertificates, oldBundle[3], isolated.collisionCertificates, isolatedBundle[3], collisionRefs],
    ];
    for (const [target, targetRef, source, sourceRef, touchedRefs] of certificateCopies) {
      if (!copyCertificateRecord(target, targetRef, source, sourceRef)) {
        return Object.freeze({ reason: 'certificate-record-out-of-range' });
      }
      if (targetRef !== INVALID_REF) touchedRefs.add(targetRef);
    }

    const headerBase = fieldletIndex * 4;
    abi.fieldletHeaders[headerBase + 2] = isolatedMeta;
    abi.bounds.set(isolated.bounds.subarray(0, 8), fieldletIndex * 8);
    abi.payloads.set(isolated.payloads.subarray(0, 12), previousPayloadBase);
    abi.payloads[previousPayloadBase + 12] = directPrimitiveLayout ? -1 : previousProgram.programOffset;
    abi.payloads[previousPayloadBase + 13] = directPrimitiveLayout ? 0 : previousProgram.programLength;
    abi.payloads[previousPayloadBase + 14] = previous.payloads[previousPayloadBase + 14];
    abi.payloads[previousPayloadBase + 15] = previousQueryMask;

    if (!directPrimitiveLayout) {
      for (let instruction = 0; instruction < previousProgram.programLength; instruction += 1) {
        const targetWord = (previousProgram.programOffset + instruction) * 2;
        const sourceWord = (isolatedProgram.programOffset + instruction) * 2;
        const opcode = isolated.programWords[sourceWord];
        abi.programWords[targetWord] = opcode;
        abi.programWords[targetWord + 1] = isPrimitiveOpcode(opcode)
          ? previousProgram.parameterBase + isolated.programWords[sourceWord + 1] - isolatedProgram.parameterBase
          : isolated.programWords[sourceWord + 1];
      }
      programRanges.push(Object.freeze({
        offset: previousProgram.programOffset * 2,
        length: previousProgram.programLength * 2,
      }));
      for (let parameter = 0; parameter < previousProgram.parameterCount; parameter += 1) {
        const targetRef = previousProgram.parameterBase + parameter;
        const sourceRef = isolatedProgram.parameterBase + parameter;
        abi.analyticParameters.set(
          isolated.analyticParameters.subarray(sourceRef * 16, sourceRef * 16 + 16),
          targetRef * 16,
        );
        parameterDescriptors[targetRef] = isolated.analyticParameterDescriptors[sourceRef];
        parameterRefs.add(targetRef);
      }
    }

    descriptors[fieldletIndex] = descriptor;
    payloadDescriptors[fieldletIndex] = Object.freeze({
      ...isolated.payloadDescriptors[0],
      index: fieldletIndex,
      nexelId: descriptor.id,
      programOffset: directPrimitiveLayout ? -1 : previousProgram.programOffset,
      programLength: directPrimitiveLayout ? 0 : previousProgram.programLength,
      materialIndex: previous.payloads[previousPayloadBase + 14],
    });
    representationPlan[fieldletIndex] = Object.freeze({
      ...isolated.representationPlan[0],
      nexelId: descriptor.id,
    });
    touchedIndices.push(fieldletIndex);
    refitBounds.set(descriptor.id, {
      min: Array.from(abi.bounds.subarray(fieldletIndex * 8, fieldletIndex * 8 + 3)),
      max: Array.from(abi.bounds.subarray(fieldletIndex * 8 + 4, fieldletIndex * 8 + 7)),
    });
  }

  const bvh = previous.bvh.clone();
  const refitNodes = collectRefitNodes(bvh, patch.upsert.map(descriptor => descriptor.id));
  if (!refitNodes) return Object.freeze({ reason: 'bvh-leaf-layout-changed' });
  bvh.refit(refitBounds);
  const bvhGpu = bvh.toGpuArrays();
  const sceneSnapshot = nextScene.toJSON();
  const canonicalSource = canonicalStringify(sceneSnapshot);
  const sourceCrc32 = crc32(utf8Encode(canonicalSource));
  const compiled = {
    schema: COMPILED_SCENE_SCHEMA,
    version: previous.version,
    sceneId: nextScene.id,
    units: nextScene.units,
    revision: nextScene.revision,
    sourceCrc32,
    sourceText: options.retainSourceText === false ? null : canonicalSource,
    sceneSnapshot,
    descriptors: Object.freeze(descriptors),
    ids: previous.ids,
    idToIndex: previous.idToIndex,
    fieldletCount: previous.fieldletCount,
    ...abi,
    materialDescriptors: previous.materialDescriptors,
    analyticParameterDescriptors: Object.freeze(parameterDescriptors),
    payloadDescriptors: Object.freeze(payloadDescriptors),
    representationPlan: Object.freeze(representationPlan),
    bvh,
    bvhBounds: bvhGpu.bounds,
    bvhMetadata: bvhGpu.metadata,
    bvhRoot: bvhGpu.root,
    statistics: previous.statistics,
  };
  compiled.certificates = Object.freeze({
    bundles: compiled.certificateBundles,
    surface: compiled.surfaceCertificates,
    medium: compiled.mediumCertificates,
    motion: compiled.motionCertificates,
    collision: compiled.collisionCertificates,
  });
  compiled.createReferenceEvaluator = () => new MorphFieldReferenceEvaluator(compiled);

  const fieldletIndices = immutableNumbers(touchedIndices.sort((a, b) => a - b));
  const runtimeDelta = Object.freeze({
    schema: RUNTIME_DELTA_SCHEMA,
    version: 1,
    mode: 'stable-analytic',
    sceneId: nextScene.id,
    baseRevision: previous.revision,
    revision: nextScene.revision,
    baselineSourceCrc32: previous.sourceCrc32,
    sourceCrc32,
    baselineLayout: compiledLayoutSignature(previous),
    fieldletIndices,
    certificateRecords: Object.freeze({
      surface: immutableNumbers([...surfaceRefs].sort((a, b) => a - b)),
      medium: immutableNumbers([...mediumRefs].sort((a, b) => a - b)),
      motion: immutableNumbers([...motionRefs].sort((a, b) => a - b)),
      collision: immutableNumbers([...collisionRefs].sort((a, b) => a - b)),
    }),
    programRanges: Object.freeze(programRanges),
    analyticParameterIndices: immutableNumbers([...parameterRefs].sort((a, b) => a - b)),
    bvhNodeIndices: immutableNumbers(refitNodes),
    writesTrailer: true,
  });
  compiled.runtimeDelta = runtimeDelta;
  return Object.freeze({ compiledScene: publishCompiledScene(compiled), runtimeDelta, reason: null });
}

export class MorphFieldCompiler {
  #scene = null;
  #compiledScene = null;

  constructor(options = {}) {
    const worker = options.worker ?? 'auto';
    if (!['auto', 'main'].includes(worker)) {
      failMorphField('UNSUPPORTED_COMPILER_WORKER_MODE', `Unsupported compiler worker mode: ${String(worker)}`);
    }
    this.options = Object.freeze({ worker, retainSourceText: options.retainSourceText !== false });
  }

  async compile(sceneInput, options = {}) {
    const scene = normalizeSceneInput(sceneInput);
    abortIfRequested(options.signal);
    const compiled = compileSceneSync(scene, {
      ...this.options,
      ...options,
    });
    this.#scene = scene;
    this.#compiledScene = compiled;
    return compiled;
  }

  async compilePatch(patchInput, options = {}) {
    if (!this.#scene) failMorphField('COMPILER_BASELINE_REQUIRED', 'compilePatch requires a successful full compile first');
    const patch = normalizeNexelPatch(patchInput);
    const nextScene = this.#scene.clone();
    nextScene.applyPatch(patch);
    const compileOptions = { ...this.options, ...options };
    const incremental = stableAnalyticPatch(this.#compiledScene, nextScene, patch, compileOptions);
    const compiledScene = incremental.compiledScene || compileSceneSync(nextScene, compileOptions);
    this.#scene = nextScene;
    this.#compiledScene = compiledScene;
    return Object.freeze({
      schema: COMPILED_PATCH_SCHEMA,
      version: Object.freeze({ ...MORPHFIELD_SCHEMA_VERSION }),
      sceneId: nextScene.id,
      revision: nextScene.revision,
      completeSnapshot: patch.completeSnapshot,
      upsert: Object.freeze(patch.upsert.map(descriptor => descriptor.id)),
      remove: Object.freeze([...patch.remove]),
      upsertIndices: new Uint32Array(patch.upsert.map(descriptor => packedFieldletIndex(
        compiledScene.idToIndex,
        descriptor.id,
      ))),
      compilationMode: incremental.compiledScene ? 'incremental-stable-analytic' : 'full',
      fallbackReason: incremental.reason,
      runtimeDelta: incremental.runtimeDelta || null,
      compiledScene,
    });
  }

  reset() {
    this.#scene = null;
    this.#compiledScene = null;
  }
}

export function createMorphFieldCompiler(options) {
  return new MorphFieldCompiler(options);
}

export async function compileMorphFieldScene(scene, options) {
  return new MorphFieldCompiler(options).compile(scene, options);
}

export { COMPILED_PATCH_SCHEMA, COMPILED_SCENE_SCHEMA, RUNTIME_DELTA_SCHEMA };
