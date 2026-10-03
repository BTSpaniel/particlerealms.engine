// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { normalizeMaterialDescriptor } from '../../materials/MaterialSystem.js';
import {
  ANALYTIC_LIMITS,
  ANALYTIC_GPU_PARAMETER_MINIMUM,
  CSG_OPERATION,
  FEATURE_MODE,
  FIELDLET_FAMILY,
  FIELDLET_SUBTYPE,
  NEXEL_LIMITS,
  QUERY_MASK,
  SOURCE_KIND,
  TOPOLOGY_REQUIREMENT,
  UPDATE_CLASS,
} from './constants.js';
import { failMorphField } from './errors.js';
import { canonicalize, deepFreeze, isPlainObject } from './serialization.js';
import { isIdentityTransform, normalizeTransform, normalizeVector3, transformAabb } from './Transform.js';
import { validateIndexedTriangleMesh } from './MeshTopologyValidation.js';

const SOURCE_KINDS = new Set(Object.values(SOURCE_KIND));
const CSG_OPERATIONS = new Set(Object.values(CSG_OPERATION));
const UPDATE_CLASSES = new Set(Object.values(UPDATE_CLASS));
const TOPOLOGY_REQUIREMENTS = new Set(Object.values(TOPOLOGY_REQUIREMENT));
const FEATURE_MODES = new Set(Object.values(FEATURE_MODE));
const FORBIDDEN_CERTIFICATE_KEYS = new Set(['certificate', 'certificates', 'certified', 'lipschitzMax', 'fieldValueErrorMax']);
const PARTICLE_CHAIN_SIMULATION_ADAPTER = 'particle-chain-nexel-snapshot';
const PARTICLE_CHAIN_NODE_KEYS = new Set([
  'adapter',
  'authority',
  'chainId',
  'index',
  'role',
  'sourceRevision',
]);
const PARTICLE_CHAIN_LINK_KEYS = new Set([
  ...PARTICLE_CHAIN_NODE_KEYS,
  'collisionRole',
  'motionModel',
  'sourceAuthority',
]);
export const MORPHFIELD_F32_MAX = 3.4028234663852886e38;

// Keep this cutoff shared with the reference evaluator. Bounds cover the full
// non-zero kernel support, not only one iso crossing, so overlapping samples
// and later weight/iso changes cannot move evaluated density outside the AABB.
export const ORIENTED_KERNEL_SUPPORT_SQUARED_RADIUS = 18;

function finiteNumber(value, path, options = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) failMorphField('NON_FINITE_NUMBER', `${path} must be finite`, { path, value });
  const minimum = options.minimum ?? -MORPHFIELD_F32_MAX;
  const maximum = options.maximum ?? MORPHFIELD_F32_MAX;
  if (number < minimum) {
    failMorphField('NUMBER_OUT_OF_RANGE', `${path} must be at least ${minimum}`, { path, value: number });
  }
  if (number > maximum) {
    failMorphField('NUMBER_OUT_OF_RANGE', `${path} must be at most ${maximum}`, { path, value: number });
  }
  if (options.strictlyPositive && !(number > 0)) {
    failMorphField('NUMBER_OUT_OF_RANGE', `${path} must be positive`, { path, value: number });
  }
  return Object.is(number, -0) ? 0 : number;
}

function integer(value, path, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    failMorphField('INTEGER_OUT_OF_RANGE', `${path} must be an integer in [${minimum}, ${maximum}]`, {
      path,
      value,
    });
  }
  return number;
}

function compactTransform(value, path) {
  const transform = normalizeTransform(value, path);
  return Object.freeze({
    translation: Object.freeze([...transform.translation]),
    rotation: Object.freeze([...transform.rotation]),
    scale: transform.scale,
  });
}

function checkNoAuthoredCertificate(input, path) {
  for (const key of FORBIDDEN_CERTIFICATE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      failMorphField('AUTHORED_CERTIFICATE_FORBIDDEN', `${path}.${key} cannot provide a certificate; certificates are compiler-derived`, {
        path: `${path}.${key}`,
      });
    }
  }
}

function normalizeFlatNumbers(value, tupleSize, path, maximumValues = NEXEL_LIMITS.MAX_ARRAY_VALUES) {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
    failMorphField('EXPECTED_NUMERIC_ARRAY', `${path} must be a numeric array`, { path });
  }
  const flattened = [];
  if (Array.isArray(value) && value.length > 0 && (Array.isArray(value[0]) || ArrayBuffer.isView(value[0]))) {
    if (value.length * tupleSize > maximumValues) failMorphField('ARRAY_SIZE_LIMIT', `${path} exceeds its value limit`, { path });
    value.forEach((tuple, tupleIndex) => {
      if ((!Array.isArray(tuple) && !ArrayBuffer.isView(tuple)) || tuple.length !== tupleSize) {
        failMorphField('INVALID_TUPLE', `${path}[${tupleIndex}] must contain ${tupleSize} values`, { path });
      }
      for (let component = 0; component < tupleSize; component++) {
        flattened.push(finiteNumber(tuple[component], `${path}[${tupleIndex}][${component}]`));
      }
    });
  } else {
    if (value.length > maximumValues) failMorphField('ARRAY_SIZE_LIMIT', `${path} exceeds its value limit`, { path });
    if (value.length % tupleSize !== 0) {
      failMorphField('INVALID_TUPLE_ARRAY', `${path} length must be a multiple of ${tupleSize}`, {
        path,
        length: value.length,
      });
    }
    for (let index = 0; index < value.length; index++) flattened.push(finiteNumber(value[index], `${path}[${index}]`));
  }
  return flattened;
}

export function normalizeBounds(value, path = 'bounds') {
  const minimumInput = Array.isArray(value) && value.length === 2 ? value[0] : value?.min;
  const maximumInput = Array.isArray(value) && value.length === 2 ? value[1] : value?.max;
  const min = normalizeVector3(minimumInput, `${path}.min`);
  const max = normalizeVector3(maximumInput, `${path}.max`);
  for (let axis = 0; axis < 3; axis++) {
    if (!(min[axis] < max[axis])) {
      failMorphField('INVALID_BOUNDS', `${path}.min must be strictly less than max on every axis`, { path, min, max });
    }
  }
  return Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) });
}

function normalizeDimensions(value, path) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length !== 3) {
    failMorphField('INVALID_DIMENSIONS', `${path} must contain three integer dimensions`, { path });
  }
  const dimensions = [
    integer(value[0], `${path}[0]`, 2, 2048),
    integer(value[1], `${path}[1]`, 2, 2048),
    integer(value[2], `${path}[2]`, 2, 2048),
  ];
  const count = dimensions[0] * dimensions[1] * dimensions[2];
  if (!Number.isSafeInteger(count) || count > NEXEL_LIMITS.MAX_ARRAY_VALUES) {
    failMorphField('GRID_SIZE_LIMIT', `${path} describes too many samples`, { path, dimensions, count });
  }
  return { dimensions, count };
}

function normalizeGridSource(input, path, kind) {
  const bounds = normalizeBounds(input.bounds, `${path}.bounds`);
  const { dimensions, count } = normalizeDimensions(input.dimensions, `${path}.dimensions`);
  const values = normalizeFlatNumbers(input.values, 1, `${path}.values`);
  if (values.length !== count) {
    failMorphField('GRID_VALUE_COUNT', `${path}.values must contain exactly ${count} samples`, {
      path,
      expected: count,
      actual: values.length,
    });
  }
  const transform = compactTransform(input.transform, `${path}.transform`);
  const result = {
    kind,
    bounds,
    dimensions: Object.freeze(dimensions),
    values: Object.freeze(values),
    transform,
  };
  if (kind === SOURCE_KIND.SPARSE_RESIDUAL) {
    if (!input.base) failMorphField('MISSING_RESIDUAL_BASE', `${path}.base is required`, { path });
    result.base = normalizeSource(input.base, `${path}.base`, 1, { analyticOnly: true });
  }
  return Object.freeze(result);
}

function normalizeOrientedSamples(input, path) {
  if (!Array.isArray(input.samples) || input.samples.length > NEXEL_LIMITS.MAX_ORIENTED_SAMPLES) {
    failMorphField('INVALID_ORIENTED_SAMPLES', `${path}.samples must be an array within the sample limit`, { path });
  }
  const samples = input.samples.map((sample, index) => {
    const samplePath = `${path}.samples[${index}]`;
    if (!isPlainObject(sample)) failMorphField('INVALID_ORIENTED_SAMPLE', `${samplePath} must be an object`, { path: samplePath });
    const normal = normalizeVector3(sample.normal, `${samplePath}.normal`, [0, 1, 0]);
    const normalLength = Math.hypot(...normal);
    if (!(normalLength > 1e-12)) failMorphField('INVALID_ORIENTED_SAMPLE', `${samplePath}.normal cannot be zero`, { path: samplePath });
    const radiusInput = sample.radii ?? sample.radius ?? 1;
    let radii;
    if (typeof radiusInput === 'number') {
      const radius = finiteNumber(radiusInput, `${samplePath}.radius`, { strictlyPositive: true });
      radii = [radius, radius, radius];
    } else {
      radii = normalizeVector3(radiusInput, `${samplePath}.radii`);
      radii.forEach((radius, axis) => {
        if (!(radius > 0)) failMorphField('INVALID_ORIENTED_SAMPLE', `${samplePath}.radii[${axis}] must be positive`, { path: samplePath });
      });
    }
    return Object.freeze({
      position: Object.freeze(normalizeVector3(sample.position, `${samplePath}.position`)),
      normal: Object.freeze(normal.map(component => component / normalLength)),
      radii: Object.freeze(radii),
      weight: finiteNumber(sample.weight ?? 1, `${samplePath}.weight`, { strictlyPositive: true }),
    });
  });
  if (samples.length === 0) failMorphField('EMPTY_ORIENTED_SAMPLES', `${path}.samples cannot be empty`, { path });
  return Object.freeze({
    kind: SOURCE_KIND.ORIENTED_SAMPLES,
    samples: Object.freeze(samples),
    isoValue: finiteNumber(input.isoValue ?? 0.5, `${path}.isoValue`, { minimum: 0 }),
    transform: compactTransform(input.transform, `${path}.transform`),
  });
}

function normalizeIndexedSurface(input, path) {
  const positions = normalizeFlatNumbers(input.positions, 3, `${path}.positions`, NEXEL_LIMITS.MAX_TRIANGLES * 9);
  if (positions.length < 9) failMorphField('EMPTY_INDEXED_SURFACE', `${path}.positions must contain at least three vertices`, { path });
  if (!Array.isArray(input.indices) && !ArrayBuffer.isView(input.indices)) {
    failMorphField('INVALID_INDICES', `${path}.indices must be an integer array`, { path });
  }
  if (input.indices.length < 3 || input.indices.length % 3 !== 0 || input.indices.length / 3 > NEXEL_LIMITS.MAX_TRIANGLES) {
    failMorphField('INVALID_INDICES', `${path}.indices must describe between one and ${NEXEL_LIMITS.MAX_TRIANGLES} triangles`, {
      path,
      length: input.indices.length,
    });
  }
  const vertexCount = positions.length / 3;
  const indices = Array.from(input.indices, (entry, index) => integer(entry, `${path}.indices[${index}]`, 0, vertexCount - 1));
  const topology = validateIndexedTriangleMesh(
    { positions, indices },
    { topologyRequirement: input.closed === true ? 'closed-2-manifold' : 'open' },
  );
  if (!topology.valid) {
    failMorphField('INVALID_INDEXED_SURFACE_TOPOLOGY', `${path} failed mesh topology validation: ${topology.errors.join('; ')}`, {
      path,
      topology,
    });
  }
  return Object.freeze({
    kind: SOURCE_KIND.INDEXED_SURFACE,
    positions: Object.freeze(positions),
    indices: Object.freeze(indices),
    closed: input.closed === true,
    transform: compactTransform(input.transform, `${path}.transform`),
  });
}

function normalizeMedium(input, path) {
  const emission = normalizeVector3(input.emission, `${path}.emission`, [0, 0, 0]);
  emission.forEach((value, axis) => {
    if (value < 0) failMorphField('INVALID_MEDIUM', `${path}.emission[${axis}] cannot be negative`, { path });
  });
  return Object.freeze({
    kind: SOURCE_KIND.MEDIUM,
    bounds: normalizeBounds(input.bounds, `${path}.bounds`),
    density: finiteNumber(input.density ?? 0, `${path}.density`, { minimum: 0 }),
    extinction: finiteNumber(input.extinction ?? 0, `${path}.extinction`, { minimum: 0 }),
    emission: Object.freeze(emission),
    transform: compactTransform(input.transform, `${path}.transform`),
  });
}

export function normalizeSource(input, path = 'source', depth = 0, options = {}) {
  if (!isPlainObject(input)) failMorphField('INVALID_SOURCE', `${path} must be an object`, { path });
  checkNoAuthoredCertificate(input, path);
  if (depth > ANALYTIC_LIMITS.MAX_SOURCE_DEPTH) {
    failMorphField('SOURCE_DEPTH_LIMIT', `${path} exceeds the maximum source depth`, { path });
  }
  const kind = String(input.kind || input.type || '');
  if (!SOURCE_KINDS.has(kind)) failMorphField('UNKNOWN_SOURCE_KIND', `Unknown source kind at ${path}: ${kind}`, { path, kind });
  if (options.analyticOnly && ![SOURCE_KIND.SPHERE, SOURCE_KIND.BOX, SOURCE_KIND.CAPSULE, SOURCE_KIND.CSG].includes(kind)) {
    failMorphField('NON_ANALYTIC_SOURCE', `${path} must be analytic`, { path, kind });
  }
  const transform = compactTransform(input.transform, `${path}.transform`);
  switch (kind) {
    case SOURCE_KIND.SPHERE:
      return Object.freeze({
        kind,
        radius: finiteNumber(input.radius ?? 0.5, `${path}.radius`, { minimum: ANALYTIC_GPU_PARAMETER_MINIMUM }),
        transform,
      });
    case SOURCE_KIND.BOX: {
      const halfExtents = normalizeVector3(input.halfExtents ?? input.size?.map?.(value => value * 0.5) ?? [0.5, 0.5, 0.5], `${path}.halfExtents`);
      halfExtents.forEach((extent, axis) => {
        if (!(extent >= ANALYTIC_GPU_PARAMETER_MINIMUM)) {
          failMorphField('INVALID_BOX', `${path}.halfExtents[${axis}] must be at least ${ANALYTIC_GPU_PARAMETER_MINIMUM} to match the GPU analytic evaluator`, {
            path: `${path}.halfExtents[${axis}]`,
            value: extent,
            minimum: ANALYTIC_GPU_PARAMETER_MINIMUM,
          });
        }
      });
      return Object.freeze({ kind, halfExtents: Object.freeze(halfExtents), transform });
    }
    case SOURCE_KIND.CAPSULE:
      return Object.freeze({
        kind,
        radius: finiteNumber(input.radius ?? 0.25, `${path}.radius`, { minimum: ANALYTIC_GPU_PARAMETER_MINIMUM }),
        halfHeight: finiteNumber(input.halfHeight ?? 0.5, `${path}.halfHeight`, { minimum: 0 }),
        transform,
      });
    case SOURCE_KIND.CSG: {
      const operation = String(input.operation || input.op || '');
      if (!CSG_OPERATIONS.has(operation)) failMorphField('UNKNOWN_CSG_OPERATION', `${path}.operation is invalid`, { path, operation });
      if (!Array.isArray(input.children)) failMorphField('INVALID_CSG_CHILDREN', `${path}.children must be an array`, { path });
      const requiredMinimum = operation === CSG_OPERATION.DIFFERENCE ? 2 : 2;
      const requiredMaximum = operation === CSG_OPERATION.DIFFERENCE ? 2 : ANALYTIC_LIMITS.MAX_CSG_CHILDREN;
      if (input.children.length < requiredMinimum || input.children.length > requiredMaximum) {
        failMorphField('INVALID_CSG_ARITY', `${path}.${operation} requires ${operation === CSG_OPERATION.DIFFERENCE ? 'exactly two' : 'between two and 32'} children`, {
          path,
          count: input.children.length,
        });
      }
      const children = input.children.map((child, index) => normalizeSource(child, `${path}.children[${index}]`, depth + 1, { analyticOnly: true }));
      return Object.freeze({ kind, operation, children: Object.freeze(children), transform });
    }
    case SOURCE_KIND.SAMPLED_FIELD:
      return normalizeGridSource(input, path, kind);
    case SOURCE_KIND.SPARSE_RESIDUAL:
      return normalizeGridSource(input, path, kind);
    case SOURCE_KIND.ORIENTED_SAMPLES:
      return normalizeOrientedSamples(input, path);
    case SOURCE_KIND.INDEXED_SURFACE:
      return normalizeIndexedSurface(input, path);
    case SOURCE_KIND.MEDIUM:
      return normalizeMedium(input, path);
    default:
      failMorphField('UNKNOWN_SOURCE_KIND', `Unknown source kind at ${path}: ${kind}`, { path, kind });
  }
}

function normalizeMotion(value, path) {
  if (value === undefined || value === null || value === false) return null;
  if (!isPlainObject(value)) failMorphField('INVALID_MOTION', `${path} must be an object`, { path });
  return Object.freeze({
    velocity: Object.freeze(normalizeVector3(value.velocity, `${path}.velocity`, [0, 0, 0])),
    angularVelocity: Object.freeze(normalizeVector3(value.angularVelocity, `${path}.angularVelocity`, [0, 0, 0])),
    acceleration: Object.freeze(normalizeVector3(value.acceleration, `${path}.acceleration`, [0, 0, 0])),
    validDuration: finiteNumber(value.validDuration ?? 1 / 60, `${path}.validDuration`, { strictlyPositive: true }),
  });
}

function normalizeCollision(value, path) {
  if (value === undefined || value === null || value === false || value?.enabled === false) return null;
  const source = value === true ? {} : value;
  if (!isPlainObject(source)) failMorphField('INVALID_COLLISION', `${path} must be a boolean or object`, { path });
  const contactOffset = finiteNumber(
    source.contactOffset ?? source.contactSlop ?? 0.001,
    `${path}.contactOffset`,
    { minimum: 0 },
  );
  const restOffset = finiteNumber(source.restOffset ?? 0, `${path}.restOffset`);
  if (restOffset > contactOffset) {
    failMorphField('INVALID_COLLISION_OFFSETS', `${path}.restOffset must not exceed contactOffset`, {
      path,
      contactOffset,
      restOffset,
    });
  }
  return Object.freeze({
    // Preserve contactSlop as the compatibility spelling. contactOffset is the
    // predictive shell; restOffset is the desired visual resting separation.
    contactOffset,
    restOffset,
    contactSlop: contactOffset,
    layer: integer(source.layer ?? 0, `${path}.layer`, 0, 31),
    mask: integer(source.mask ?? 0xffffffff, `${path}.mask`, 0, 0xffffffff) >>> 0,
  });
}

function normalizeSimulation(value, path) {
  if (value === undefined || value === null || value === false) return null;
  if (!isPlainObject(value)) failMorphField('INVALID_SIMULATION', `${path} must be an object`, { path });
  if (typeof value.adapter !== 'string' || Array.from(value.adapter).length === 0
      || Array.from(value.adapter).length > NEXEL_LIMITS.MAX_ID_LENGTH
      || /[\u0000-\u001f\u007f]/u.test(value.adapter)) {
    failMorphField('INVALID_SIMULATION_ADAPTER', `${path}.adapter must be a non-empty stable adapter id`, {
      path: `${path}.adapter`,
      value: value.adapter,
    });
  }
  if (value.authority !== undefined && value.authority !== 'authoritative' && value.authority !== 'visual') {
    failMorphField('INVALID_SIMULATION_AUTHORITY', `${path}.authority must be "authoritative" or "visual"`, {
      path: `${path}.authority`,
      value: value.authority,
    });
  }
  if (value.adapter === PARTICLE_CHAIN_SIMULATION_ADAPTER) {
    const required = ['adapter', 'chainId', 'role', 'index', 'authority', 'sourceRevision'];
    const missing = required.filter(key => !Object.prototype.hasOwnProperty.call(value, key));
    if (missing.length > 0) {
      failMorphField(
        'INVALID_PARTICLE_CHAIN_SIMULATION',
        `${path} is missing required particle-chain metadata: ${missing.join(', ')}`,
        { path, missing },
      );
    }
    if (typeof value.chainId !== 'string' || Array.from(value.chainId).length === 0 || Array.from(value.chainId).length > 80
        || /[\u0000-\u001f\u007f]/u.test(value.chainId)) {
      failMorphField('INVALID_PARTICLE_CHAIN_SIMULATION', `${path}.chainId must be a stable string of 1..80 characters`, {
        path: `${path}.chainId`,
        value: value.chainId,
      });
    }
    if (value.role !== 'node' && value.role !== 'link') {
      failMorphField('INVALID_PARTICLE_CHAIN_SIMULATION', `${path}.role must be "node" or "link"`, {
        path: `${path}.role`,
        value: value.role,
      });
    }
    if (typeof value.index !== 'number' || !Number.isSafeInteger(value.index) || value.index < 0 || value.index > 4095) {
      failMorphField('INVALID_PARTICLE_CHAIN_SIMULATION', `${path}.index must be an integer in [0, 4095]`, {
        path: `${path}.index`,
        value: value.index,
      });
    }
    if (value.authority !== 'authoritative' && value.authority !== 'visual') {
      failMorphField('INVALID_PARTICLE_CHAIN_SIMULATION', `${path}.authority must be "authoritative" or "visual"`, {
        path: `${path}.authority`,
        value: value.authority,
      });
    }
    if (typeof value.sourceRevision !== 'number' || !Number.isSafeInteger(value.sourceRevision)
        || value.sourceRevision < 0) {
      failMorphField('INVALID_PARTICLE_CHAIN_SIMULATION', `${path}.sourceRevision must be a non-negative safe integer`, {
        path: `${path}.sourceRevision`,
        value: value.sourceRevision,
      });
    }
    const allowedKeys = value.role === 'link' ? PARTICLE_CHAIN_LINK_KEYS : PARTICLE_CHAIN_NODE_KEYS;
    const forbidden = Object.keys(value).filter(key => !allowedKeys.has(key));
    if (forbidden.length > 0) {
      failMorphField(
        'INVALID_PARTICLE_CHAIN_SIMULATION',
        `${path} contains unsupported ${value.role} metadata: ${forbidden.join(', ')}`,
        { path, forbidden, role: value.role },
      );
    }
    if (value.role === 'link') {
      if (value.authority !== 'visual') {
        failMorphField('INVALID_PARTICLE_CHAIN_SIMULATION', `${path}.authority must be "visual" for link snapshots`, {
          path: `${path}.authority`,
          value: value.authority,
        });
      }
      if ((value.sourceAuthority !== 'authoritative' && value.sourceAuthority !== 'visual')
          || value.motionModel !== 'rigid-link-envelope'
          || value.collisionRole !== 'queryable-visual-skin') {
        failMorphField(
          'INVALID_PARTICLE_CHAIN_SIMULATION',
          `${path} link snapshots require sourceAuthority, rigid-link-envelope motion, and queryable-visual-skin collision metadata`,
          { path },
        );
      }
    }
    return deepFreeze(canonicalize(value, path));
  }
  return deepFreeze(canonicalize(value, path));
}

export function validateMaterialF32Channels(material, path = 'material') {
  for (const channel of ['baseColorFactor', 'emissiveFactor']) {
    const values = material?.[channel];
    if (!Array.isArray(values)) {
      failMorphField('INVALID_MATERIAL_CHANNEL', `${path}.${channel} must be an array`, {
        path: `${path}.${channel}`,
      });
    }
    const minimum = 0;
    const maximum = channel === 'baseColorFactor' ? 1 : MORPHFIELD_F32_MAX;
    for (let index = 0; index < values.length; index++) {
      const value = values[index];
      if (!Number.isFinite(value) || value < minimum || value > maximum
          || !Number.isFinite(Math.fround(value))) {
        failMorphField(
          'MATERIAL_F32_RANGE',
          `${path}.${channel}[${index}] must be a finite f32 material channel in [${minimum}, ${maximum}]`,
          {
            path: `${path}.${channel}[${index}]`,
            value,
            minimum,
            maximum,
          },
        );
      }
    }
  }
  return material;
}

function normalizeIntent(value, path, defaultUpdateClass = UPDATE_CLASS.STATIC) {
  const source = value === undefined ? {} : value;
  if (!isPlainObject(source)) failMorphField('INVALID_INTENT', `${path} must be an object`, { path });
  const updateClass = String(source.updateClass ?? defaultUpdateClass);
  const topologyRequirement = String(source.topologyRequirement ?? TOPOLOGY_REQUIREMENT.UNSPECIFIED);
  const featureMode = String(source.featureMode ?? FEATURE_MODE.SMOOTH);
  if (!UPDATE_CLASSES.has(updateClass)) failMorphField('INVALID_INTENT', `${path}.updateClass is invalid`, { path, updateClass });
  if (!TOPOLOGY_REQUIREMENTS.has(topologyRequirement)) failMorphField('INVALID_INTENT', `${path}.topologyRequirement is invalid`, { path, topologyRequirement });
  if (!FEATURE_MODES.has(featureMode)) failMorphField('INVALID_INTENT', `${path}.featureMode is invalid`, { path, featureMode });
  return Object.freeze({
    updateClass,
    topologyRequirement,
    featureMode,
    qualityImportance: finiteNumber(source.qualityImportance ?? 0.5, `${path}.qualityImportance`, { minimum: 0, maximum: 1 }),
    authoritative: source.authoritative === true,
  });
}

export function validateNexelId(value, path = 'id') {
  const length = typeof value === 'string' ? Array.from(value).length : null;
  if (typeof value !== 'string' || length === 0 || length > NEXEL_LIMITS.MAX_ID_LENGTH
      || /[\u0000-\u001f\u007f]/u.test(value)) {
    failMorphField('INVALID_NEXEL_ID', `${path} must be a non-empty string without control characters`, {
      path,
      length,
    });
  }
  return value;
}

export function normalizeNexelDescriptor(input, path = 'nexel') {
  if (!isPlainObject(input)) failMorphField('INVALID_NEXEL', `${path} must be an object`, { path });
  checkNoAuthoredCertificate(input, path);
  const source = normalizeSource(input.source, `${path}.source`);
  const motion = normalizeMotion(input.motion, `${path}.motion`);
  const collision = normalizeCollision(input.collision, `${path}.collision`);
  const simulation = normalizeSimulation(input.simulation, `${path}.simulation`);
  const intent = normalizeIntent(input.intent, `${path}.intent`, motion ? UPDATE_CLASS.DYNAMIC : UPDATE_CLASS.STATIC);
  const material = deepFreeze(canonicalize(normalizeMaterialDescriptor(input.material), `${path}.material`));
  validateMaterialF32Channels(material, `${path}.material`);
  if (motion && input.intent?.updateClass === UPDATE_CLASS.STATIC) {
    failMorphField('STATIC_NEXEL_HAS_MOTION', `${path}.intent.updateClass cannot be static when motion is present`, {
      path: `${path}.intent.updateClass`,
    });
  }
  if (collision && (source.kind === SOURCE_KIND.MEDIUM || source.kind === SOURCE_KIND.INDEXED_SURFACE)) {
    failMorphField(
      'UNSUPPORTED_NEXEL_COLLISION_SOURCE',
      `${path}.collision is not supported for ${source.kind}; use an analytic, sampled-field, sparse-residual, or oriented-samples collision source`,
      { path: `${path}.collision`, sourceKind: source.kind },
    );
  }
  if (simulation?.authority === 'authoritative' && !intent.authoritative) {
    failMorphField('SIMULATION_AUTHORITY_MISMATCH', `${path}.intent.authoritative must be true for an authoritative simulation`, {
      path: `${path}.intent.authoritative`,
    });
  }
  if (simulation?.authority === 'visual' && intent.authoritative) {
    failMorphField('SIMULATION_AUTHORITY_MISMATCH', `${path}.intent.authoritative must be false for a visual simulation`, {
      path: `${path}.intent.authoritative`,
    });
  }
  const descriptor = {
    id: validateNexelId(input.id, `${path}.id`),
    source,
    transform: compactTransform(input.transform, `${path}.transform`),
    material,
    motion,
    collision,
    simulation,
    intent,
  };
  return Object.freeze(descriptor);
}

export function planRepresentation(source) {
  switch (source.kind) {
    case SOURCE_KIND.SPHERE:
    case SOURCE_KIND.BOX:
    case SOURCE_KIND.CAPSULE:
    case SOURCE_KIND.CSG:
    case SOURCE_KIND.MEDIUM:
      return Object.freeze({
        family: FIELDLET_FAMILY.ANALYTIC,
        subtype: source.kind === SOURCE_KIND.MEDIUM ? FIELDLET_SUBTYPE.ANALYTIC_MEDIUM : FIELDLET_SUBTYPE.ANALYTIC_PROGRAM,
        reason: source.kind === SOURCE_KIND.MEDIUM ? 'bounded-analytic-medium' : 'certifiable-analytic-source',
      });
    case SOURCE_KIND.SAMPLED_FIELD:
      return Object.freeze({ family: FIELDLET_FAMILY.SPARSE_RESIDUAL, subtype: FIELDLET_SUBTYPE.SAMPLED_FIELD, reason: 'sampled-field' });
    case SOURCE_KIND.SPARSE_RESIDUAL:
      return Object.freeze({ family: FIELDLET_FAMILY.SPARSE_RESIDUAL, subtype: FIELDLET_SUBTYPE.ANALYTIC_PLUS_RESIDUAL, reason: 'analytic-plus-residual' });
    case SOURCE_KIND.ORIENTED_SAMPLES:
      return Object.freeze({ family: FIELDLET_FAMILY.ORIENTED_KERNEL, subtype: FIELDLET_SUBTYPE.ANISOTROPIC_SAMPLES, reason: 'oriented-samples' });
    case SOURCE_KIND.INDEXED_SURFACE:
      return Object.freeze({ family: FIELDLET_FAMILY.CACHED_SURFACE, subtype: FIELDLET_SUBTYPE.INDEXED_TRIANGLES, reason: 'authored-indexed-surface' });
    default:
      failMorphField('UNKNOWN_SOURCE_KIND', `Cannot plan source kind ${String(source.kind)}`, { kind: source.kind });
  }
}

function localSourceBounds(source) {
  switch (source.kind) {
    case SOURCE_KIND.SPHERE:
      return { min: [-source.radius, -source.radius, -source.radius], max: [source.radius, source.radius, source.radius] };
    case SOURCE_KIND.BOX:
      return { min: source.halfExtents.map(value => -value), max: [...source.halfExtents] };
    case SOURCE_KIND.CAPSULE:
      return {
        min: [-source.radius, -source.halfHeight - source.radius, -source.radius],
        max: [source.radius, source.halfHeight + source.radius, source.radius],
      };
    case SOURCE_KIND.CSG: {
      const childBounds = source.children.map(child => computeSourceBounds(child));
      if (source.operation === CSG_OPERATION.DIFFERENCE) return childBounds[0];
      const min = [...childBounds[0].min];
      const max = [...childBounds[0].max];
      for (let index = 1; index < childBounds.length; index++) {
        for (let axis = 0; axis < 3; axis++) {
          if (source.operation === CSG_OPERATION.UNION) {
            min[axis] = Math.min(min[axis], childBounds[index].min[axis]);
            max[axis] = Math.max(max[axis], childBounds[index].max[axis]);
          } else {
            min[axis] = Math.max(min[axis], childBounds[index].min[axis]);
            max[axis] = Math.min(max[axis], childBounds[index].max[axis]);
          }
        }
      }
      if (min.some((value, axis) => !(value < max[axis]))) {
        failMorphField('EMPTY_CSG_INTERSECTION', 'CSG intersection has no non-empty conservative bounds');
      }
      return { min, max };
    }
    case SOURCE_KIND.SAMPLED_FIELD:
      return { min: [...source.bounds.min], max: [...source.bounds.max] };
    case SOURCE_KIND.SPARSE_RESIDUAL: {
      const baseBounds = computeSourceBounds(source.base);
      return {
        min: source.bounds.min.map((value, axis) => Math.min(value, baseBounds.min[axis])),
        max: source.bounds.max.map((value, axis) => Math.max(value, baseBounds.max[axis])),
      };
    }
    case SOURCE_KIND.ORIENTED_SAMPLES: {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      const supportRadius = Math.sqrt(ORIENTED_KERNEL_SUPPORT_SQUARED_RADIUS);
      for (const sample of source.samples) {
        for (let axis = 0; axis < 3; axis++) {
          const extent = sample.radii[axis] * supportRadius;
          min[axis] = Math.min(min[axis], sample.position[axis] - extent);
          max[axis] = Math.max(max[axis], sample.position[axis] + extent);
        }
      }
      return { min, max };
    }
    case SOURCE_KIND.INDEXED_SURFACE: {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let index = 0; index < source.positions.length; index += 3) {
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], source.positions[index + axis]);
          max[axis] = Math.max(max[axis], source.positions[index + axis]);
        }
      }
      const epsilon = Math.max(1e-6, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * 1e-7);
      for (let axis = 0; axis < 3; axis++) {
        if (!(min[axis] < max[axis])) {
          min[axis] -= epsilon;
          max[axis] += epsilon;
        }
      }
      return { min, max };
    }
    case SOURCE_KIND.MEDIUM:
      return { min: [...source.bounds.min], max: [...source.bounds.max] };
    default:
      failMorphField('UNKNOWN_SOURCE_KIND', `Cannot compute bounds for ${String(source.kind)}`);
  }
}

export function computeSourceBounds(source) {
  const localBounds = localSourceBounds(source);
  const transform = normalizeTransform(source.transform);
  return isIdentityTransform(transform) ? localBounds : transformAabb(localBounds, transform);
}

export function computeNexelBounds(nexel) {
  return transformAabb(computeSourceBounds(nexel.source), normalizeTransform(nexel.transform));
}

export function computeNexelQueryMask(nexel) {
  let mask = QUERY_MASK.BOUND;
  if (nexel.source.kind === SOURCE_KIND.MEDIUM) mask |= QUERY_MASK.MEDIUM;
  else mask |= QUERY_MASK.SURFACE | QUERY_MASK.MATERIAL;
  if (nexel.motion) mask |= QUERY_MASK.MOTION;
  if (nexel.collision && nexel.source.kind !== SOURCE_KIND.MEDIUM) mask |= QUERY_MASK.COLLISION;
  return mask;
}

export function sourceContainsLocalTransforms(source) {
  if (!isIdentityTransform(normalizeTransform(source.transform))) return true;
  return source.kind === SOURCE_KIND.CSG && source.children.some(sourceContainsLocalTransforms);
}

export function countAnalyticInstructions(source) {
  if ([SOURCE_KIND.SPHERE, SOURCE_KIND.BOX, SOURCE_KIND.CAPSULE].includes(source.kind)) return 1;
  if (source.kind !== SOURCE_KIND.CSG) return 0;
  return source.children.reduce((sum, child) => sum + countAnalyticInstructions(child), 0) + source.children.length - 1;
}

export function maximumAnalyticStackDepth(source) {
  if ([SOURCE_KIND.SPHERE, SOURCE_KIND.BOX, SOURCE_KIND.CAPSULE].includes(source.kind)) return 1;
  if (source.kind !== SOURCE_KIND.CSG || source.children.length === 0) return 0;
  let maximum = maximumAnalyticStackDepth(source.children[0]);
  for (let index = 1; index < source.children.length; index++) {
    maximum = Math.max(maximum, 1 + maximumAnalyticStackDepth(source.children[index]));
  }
  return maximum;
}
