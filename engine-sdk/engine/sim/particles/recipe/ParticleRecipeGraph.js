// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Shared immutable, versioned Particle Realms recipe graphs and deterministic plans.
 *
 * This module deliberately compiles descriptions rather than invoking a solver.
 * Native runtime adapters consume the resulting plan; no simulation capability
 * is claimed merely because a node type can be authored and validated here.
 */

import {
  DEFAULT_PARTICLE_SETTINGS,
  getBuiltInParticlePreset,
  normalizeParticleSettings,
} from './ParticleProjectCore.js';
import {
  PARTICLE_INTERACTIONS,
  PARTICLE_MODES,
  PARTICLE_PRESETS,
  PARTICLE_RENDER_STYLES,
  PARTICLE_REACTIONS,
} from './ParticleLabCatalog.js';

export const PARTICLE_RECIPE_GRAPH_SCHEMA = 'particle-realms.simulation-recipe.graph';
export const PARTICLE_RECIPE_GRAPH_VERSION = 1;
export const PARTICLE_RECIPE_PLAN_SCHEMA = 'particle-realms.simulation-recipe.execution-plan';
export const PARTICLE_RECIPE_PLAN_VERSION = 1;
export const PARTICLE_RECIPE_PROJECT_FIELD = 'recipeGraph';

const LEGACY_RECIPE_GRAPH_VERSION = 0;
const MAX_GRAPH_BYTES = 2 * 1024 * 1024;
const MAX_NODES = 512;
const MAX_EDGES = 2048;
const MAX_LABEL_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_TAGS = 32;
const UINT32_MAX = 0xffff_ffff;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const SAFE_EXTENSION_DEPTH = 12;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export const PARTICLE_RECIPE_NODE_FAMILIES = Object.freeze([
  'Project/Metadata', 'World/Units', 'Domain/Coordinates', 'Geometry',
  'Discretization', 'Boundary', 'Material', 'Substance', 'Emitter',
  'Initial Condition', 'Field', 'Force', 'Solver', 'Coupling', 'Constraint',
  'Physics Body', 'Sensor', 'Reduction', 'Visualizer', 'Camera', 'View Layout',
  'Timeline', 'Audio Input', 'Audio Graph/Patch', 'Telemetry Input',
  'Data Transform', 'Alert/Rule', 'External Study', 'Export/Output',
]);

export const PARTICLE_RECIPE_PORT_TYPES = deepFreeze({
  METADATA: 'Metadata', WORLD: 'World', DOMAIN: 'Domain', GEOMETRY: 'Geometry',
  SURFACE: 'Surface', VOLUME: 'Volume', DISCRETIZATION: 'Discretization',
  SCALAR: 'Scalar', VECTOR: 'Vector', TENSOR: 'Tensor', FIELD_2D: 'Field2D',
  FIELD_3D: 'Field3D', PARTICLE_SET: 'ParticleSet', SUBSTANCE_SET: 'SubstanceSet',
  MATERIAL: 'Material', BOUNDARY_CONDITION: 'BoundaryCondition',
  SOLVER_STATE: 'SolverState', PHYSICS_BODY: 'PhysicsBody', CONSTRAINT: 'Constraint',
  TIME_SERIES: 'TimeSeries', EVENT: 'Event', AUDIO_SIGNAL: 'AudioSignal',
  TELEMETRY_STREAM: 'TelemetryStream', RENDER_LAYER: 'RenderLayer',
  CAMERA: 'Camera', EXTERNAL_STUDY: 'ExternalStudy', OUTPUT: 'Output',
});

export const PARTICLE_RECIPE_CHANGE_IMPACTS = deepFreeze({
  NONE: 'none',
  AUTHORING_ONLY: 'authoring-only',
  UNIFORM_UPDATE: 'uniform-update',
  RESOURCE_RESIZE: 'resource-resize',
  PIPELINE_SPECIALIZATION: 'pipeline-specialization',
  SOLVER_RESET: 'solver-reset-required',
  FULL_GRAPH_REBUILD: 'full-graph-rebuild',
});

const IMPACT_RANK = Object.freeze({
  [PARTICLE_RECIPE_CHANGE_IMPACTS.NONE]: 0,
  [PARTICLE_RECIPE_CHANGE_IMPACTS.AUTHORING_ONLY]: 1,
  [PARTICLE_RECIPE_CHANGE_IMPACTS.UNIFORM_UPDATE]: 2,
  [PARTICLE_RECIPE_CHANGE_IMPACTS.RESOURCE_RESIZE]: 3,
  [PARTICLE_RECIPE_CHANGE_IMPACTS.PIPELINE_SPECIALIZATION]: 4,
  [PARTICLE_RECIPE_CHANGE_IMPACTS.SOLVER_RESET]: 5,
  [PARTICLE_RECIPE_CHANGE_IMPACTS.FULL_GRAPH_REBUILD]: 6,
});

const T = PARTICLE_RECIPE_PORT_TYPES;
const I = PARTICLE_RECIPE_CHANGE_IMPACTS;
const PARTICLE_MODE_IDS = Object.freeze(['inherit', ...Object.keys(PARTICLE_MODES)]);
const PARTICLE_SOLVER_TYPES = Object.freeze(['particle-runtime', 'sph', 'n-body', 'flocking', 'chemistry', 'electromagnetic', 'lennard-jones', 'pbd', 'imported-preview']);
const PARTICLE_SOLVER_FOR_MODE = Object.freeze({ galaxy: 'n-body', nbody: 'n-body', flock: 'flocking', fluid: 'sph', chemistry: 'chemistry', electromagnetic: 'electromagnetic', molecular: 'lennard-jones' });
const PARTICLE_FIELD_FOR_MODE = Object.freeze({ galaxy: 'radial', nbody: 'radial', attractor: 'radial', fountain: 'gravity' });

function input(id, types, options = {}) {
  return { id, types: Object.freeze(Array.isArray(types) ? [...types] : [types]), required: options.required === true, cardinality: options.cardinality === 'many' ? 'many' : 'one' };
}

function output(id, type) {
  return { id, type };
}

function parameter(id, type, defaultValue, options = {}) {
  return { id, type, default: defaultValue, impact: options.impact || I.UNIFORM_UPDATE, ...options };
}

function definition(type, family, label, phase, subsystem, inputs, outputs, parameters = []) {
  return { type, family, label, phase, subsystem, inputs, outputs, parameters };
}

const NODE_DEFINITION_LIST = [
  definition('project.metadata', 'Project/Metadata', 'Project Metadata', 0, 'project', [], [output('metadata', T.METADATA)], [
    parameter('name', 'string', 'Untitled Recipe', { maxLength: MAX_LABEL_LENGTH, impact: I.AUTHORING_ONLY }),
    parameter('description', 'string', '', { maxLength: MAX_DESCRIPTION_LENGTH, impact: I.AUTHORING_ONLY }),
  ]),
  definition('world.units', 'World/Units', 'World & Units', 1, 'scene', [input('metadata', T.METADATA)], [output('world', T.WORLD)], [
    parameter('unitSystem', 'enum', 'SI', { values: ['SI'], impact: I.SOLVER_RESET }),
    parameter('lengthScale', 'number', 1, { min: 1e-9, max: 1e9, impact: I.SOLVER_RESET }),
    parameter('gravity', 'vector3', [0, -9.81, 0], { min: -1e6, max: 1e6, impact: I.UNIFORM_UPDATE }),
  ]),
  definition('domain.coordinates', 'Domain/Coordinates', 'Domain & Coordinates', 2, 'scene', [input('world', T.WORLD, { required: true })], [output('domain', T.DOMAIN)], [
    parameter('dimension', 'enum', '3d', { values: ['2d', '3d'], impact: I.FULL_GRAPH_REBUILD }),
    parameter('coordinateSystem', 'enum', 'cartesian', { values: ['cartesian', 'cylindrical', 'spherical'], impact: I.FULL_GRAPH_REBUILD }),
    parameter('size', 'vector3', [20, 20, 20], { min: 1e-6, max: 1e9, impact: I.RESOURCE_RESIZE }),
  ]),
  definition('geometry.source', 'Geometry', 'Geometry Source', 3, 'scene', [input('domain', T.DOMAIN)], [output('geometry', T.GEOMETRY), output('surface', T.SURFACE), output('volume', T.VOLUME)], [
    parameter('sourceType', 'enum', 'procedural', { values: ['procedural', 'asset', 'sdf'], impact: I.PIPELINE_SPECIALIZATION }),
    parameter('assetId', 'string', '', { maxLength: 192, impact: I.FULL_GRAPH_REBUILD }),
  ]),
  definition('discretization.particles', 'Discretization', 'Particle Discretization', 4, 'particles', [input('domain', T.DOMAIN, { required: true }), input('geometry', [T.GEOMETRY, T.VOLUME])], [output('discretization', T.DISCRETIZATION)], [
    parameter('targetCount', 'integer', 100000, { min: 1000, max: 10000000, impact: I.RESOURCE_RESIZE }),
    parameter('representation', 'enum', 'particles', { values: ['particles'], impact: I.PIPELINE_SPECIALIZATION }),
  ]),
  definition('boundary.condition', 'Boundary', 'Boundary Condition', 5, 'simulation', [input('domain', T.DOMAIN, { required: true }), input('surface', T.SURFACE)], [output('boundary', T.BOUNDARY_CONDITION)], [
    parameter('kind', 'enum', 'closed', { values: ['closed', 'open', 'periodic', 'collider'], impact: I.SOLVER_RESET }),
  ]),
  definition('material.physical', 'Material', 'Physical Material', 5, 'materials', [], [output('material', T.MATERIAL)], [
    parameter('materialId', 'string', 'material.default', { maxLength: 192, impact: I.PIPELINE_SPECIALIZATION }),
    parameter('density', 'number', 1000, { min: 1e-9, max: 1e12, impact: I.SOLVER_RESET }),
  ]),
  definition('substance.set', 'Substance', 'Substance Set', 5, 'materials', [input('material', T.MATERIAL)], [output('substances', T.SUBSTANCE_SET)], [
    parameter('substanceId', 'string', 'substance.default', { maxLength: 192, impact: I.SOLVER_RESET }),
    parameter('reaction', 'integer', 0, { min: 0, max: PARTICLE_REACTIONS.length - 1, impact: I.PIPELINE_SPECIALIZATION }),
    parameter('reactionRate', 'number', 1, { min: 0, max: 3, impact: I.UNIFORM_UPDATE }),
  ]),
  definition('emitter.particles', 'Emitter', 'Particle Emitter', 6, 'particles', [input('domain', T.DOMAIN, { required: true }), input('substances', T.SUBSTANCE_SET)], [output('particles', T.PARTICLE_SET), output('events', T.EVENT)], [
    parameter('mode', 'enum', 'initial-fill', { values: ['initial-fill', 'continuous', 'burst'], impact: I.SOLVER_RESET }),
    parameter('rate', 'number', 100000, { min: 0, max: 10000000, impact: I.UNIFORM_UPDATE }),
    parameter('enabled', 'boolean', true, { impact: I.UNIFORM_UPDATE }),
  ]),
  definition('initial-condition.state', 'Initial Condition', 'Initial Condition', 6, 'simulation', [input('domain', T.DOMAIN, { required: true }), input('particles', T.PARTICLE_SET)], [output('initialState', T.SOLVER_STATE)], [
    parameter('temperature', 'number', 293.15, { min: 0, max: 1e9, impact: I.SOLVER_RESET }),
    parameter('charge', 'number', 1, { min: -3, max: 3, impact: I.SOLVER_RESET }),
  ]),
  definition('field.vector', 'Field', 'Vector Field', 6, 'simulation', [input('domain', T.DOMAIN, { required: true })], [output('field', T.FIELD_3D)], [
    parameter('kind', 'enum', 'gravity', { values: ['gravity', 'curl', 'radial', 'custom'], impact: I.PIPELINE_SPECIALIZATION }),
    parameter('strength', 'number', 1, { min: -1e6, max: 1e6, impact: I.UNIFORM_UPDATE }),
    parameter('drag', 'number', .998, { min: .94, max: 1, impact: I.UNIFORM_UPDATE }),
    parameter('turbulence', 'number', .35, { min: 0, max: 4, impact: I.UNIFORM_UPDATE }),
    parameter('cohesion', 'number', 1.1, { min: 0, max: 4, impact: I.UNIFORM_UPDATE }),
    parameter('interaction', 'enum', 'attract', { values: Object.keys(PARTICLE_INTERACTIONS), impact: I.UNIFORM_UPDATE }),
    parameter('brushRadius', 'number', 3.5, { min: .5, max: 10, impact: I.UNIFORM_UPDATE }),
  ]),
  definition('force.field', 'Force', 'Force Field', 7, 'simulation', [input('field', [T.FIELD_2D, T.FIELD_3D], { required: true })], [output('force', T.FIELD_3D)], [
    parameter('scale', 'number', 1, { min: -1e6, max: 1e6, impact: I.UNIFORM_UPDATE }),
  ]),
  definition('physics-body.rigid', 'Physics Body', 'Rigid Physics Body', 7, 'physics', [input('geometry', T.GEOMETRY, { required: true }), input('material', T.MATERIAL)], [output('body', T.PHYSICS_BODY)], [
    parameter('motion', 'enum', 'dynamic', { values: ['static', 'dynamic', 'kinematic'], impact: I.SOLVER_RESET }),
  ]),
  definition('constraint.physics', 'Constraint', 'Physics Constraint', 8, 'physics', [input('bodies', T.PHYSICS_BODY, { required: true, cardinality: 'many' })], [output('constraint', T.CONSTRAINT)], [
    parameter('kind', 'enum', 'fixed', { values: ['fixed', 'distance', 'hinge', 'spring'], impact: I.SOLVER_RESET }),
  ]),
  definition('solver.native', 'Solver', 'Native Solver Binding', 9, 'particles', [
    input('domain', T.DOMAIN, { required: true }), input('discretization', T.DISCRETIZATION), input('particles', T.PARTICLE_SET),
    input('initialState', T.SOLVER_STATE), input('boundaries', T.BOUNDARY_CONDITION, { cardinality: 'many' }),
    input('fields', T.FIELD_3D, { cardinality: 'many' }), input('constraints', T.CONSTRAINT, { cardinality: 'many' }),
  ], [output('state', T.SOLVER_STATE)], [
    parameter('runtimeMode', 'enum', 'inherit', { values: PARTICLE_MODE_IDS, impact: I.PIPELINE_SPECIALIZATION }),
    parameter('nativeType', 'enum', 'particle-runtime', { values: PARTICLE_SOLVER_TYPES, impact: I.PIPELINE_SPECIALIZATION }),
    parameter('fixedStep', 'number', 0.008333333, { min: 0.000001, max: 1, impact: I.SOLVER_RESET }),
    parameter('substeps', 'integer', 1, { min: 1, max: 64, impact: I.SOLVER_RESET }),
  ]),
  definition('coupling.state', 'Coupling', 'State Coupling', 10, 'simulation', [input('primary', T.SOLVER_STATE, { required: true }), input('secondary', T.SOLVER_STATE, { required: true })], [output('state', T.SOLVER_STATE)], [
    parameter('mode', 'enum', 'one-way', { values: ['one-way', 'two-way'], impact: I.SOLVER_RESET }),
  ]),
  definition('sensor.sample', 'Sensor', 'Sensor', 11, 'sensors', [input('state', T.SOLVER_STATE, { required: true })], [output('series', T.TIME_SERIES)], [
    parameter('quantity', 'string', 'particleCount', { maxLength: 96, impact: I.PIPELINE_SPECIALIZATION }),
    parameter('sampleRate', 'number', 30, { min: 0.1, max: 10000, impact: I.UNIFORM_UPDATE }),
  ]),
  definition('reduction.aggregate', 'Reduction', 'Reduction', 12, 'sensors', [input('series', T.TIME_SERIES, { required: true })], [output('value', T.SCALAR), output('series', T.TIME_SERIES)], [
    parameter('operation', 'enum', 'mean', { values: ['mean', 'min', 'max', 'sum', 'rms'], impact: I.PIPELINE_SPECIALIZATION }),
  ]),
  definition('visualizer.native', 'Visualizer', 'Native Visualizer', 13, 'renderer', [input('state', T.SOLVER_STATE, { required: true })], [output('layer', T.RENDER_LAYER)], [
    parameter('kind', 'enum', 'point-particles', { values: ['point-particles', 'density', 'vector-field', 'imported-overlay'], impact: I.PIPELINE_SPECIALIZATION }),
    parameter('palette', 'enum', 'solar', { values: Object.keys(PARTICLE_PRESETS), impact: I.PIPELINE_SPECIALIZATION }),
    parameter('renderStyle', 'enum', 'glow', { values: Object.keys(PARTICLE_RENDER_STYLES), impact: I.PIPELINE_SPECIALIZATION }),
    parameter('pointSize', 'number', 2.8, { min: 0.1, max: 64, impact: I.UNIFORM_UPDATE }),
    parameter('exposure', 'number', 1.15, { min: 0, max: 32, impact: I.UNIFORM_UPDATE }),
    parameter('emission', 'number', 1, { min: 0, max: 4, impact: I.UNIFORM_UPDATE }),
    parameter('trails', 'boolean', true, { impact: I.UNIFORM_UPDATE }),
    parameter('trailPersistence', 'number', .88, { min: .7, max: .98, impact: I.UNIFORM_UPDATE }),
    parameter('bloom', 'number', 1.25, { min: 0, max: 2, impact: I.UNIFORM_UPDATE }),
  ]),
  definition('camera.view', 'Camera', 'Camera', 13, 'renderer', [], [output('camera', T.CAMERA)], [
    parameter('projection', 'enum', 'perspective', { values: ['perspective', 'orthographic'], impact: I.PIPELINE_SPECIALIZATION }),
    parameter('distance', 'number', 34, { min: 0.001, max: 1e9, impact: I.UNIFORM_UPDATE }),
    parameter('yaw', 'number', .72, { min: -1e9, max: 1e9, impact: I.UNIFORM_UPDATE }),
    parameter('pitch', 'number', .38, { min: -1.35, max: 1.35, impact: I.UNIFORM_UPDATE }),
    parameter('autoOrbit', 'number', .18, { min: 0, max: 1, impact: I.UNIFORM_UPDATE }),
  ]),
  definition('view.layout', 'View Layout', 'View Layout', 14, 'renderer', [input('layers', T.RENDER_LAYER, { required: true, cardinality: 'many' }), input('cameras', T.CAMERA, { required: true, cardinality: 'many' })], [output('view', T.OUTPUT)], [
    parameter('layout', 'enum', 'single', { values: ['single', 'studio', 'compare'], impact: I.RESOURCE_RESIZE }),
  ]),
  definition('timeline.automation', 'Timeline', 'Timeline & Automation', 7, 'timeline', [], [output('events', T.EVENT)], [
    parameter('duration', 'number', 10, { min: 0, max: 1e9, impact: I.AUTHORING_ONLY }),
    parameter('loop', 'boolean', false, { impact: I.UNIFORM_UPDATE }),
  ]),
  definition('audio.input', 'Audio Input', 'Audio Input', 7, 'audio', [], [output('signal', T.AUDIO_SIGNAL)], [
    parameter('source', 'enum', 'none', { values: ['none', 'microphone', 'asset'], impact: I.PIPELINE_SPECIALIZATION }),
  ]),
  definition('audio.patch', 'Audio Graph/Patch', 'Audio Patch', 8, 'audio', [input('signal', T.AUDIO_SIGNAL, { required: true })], [output('events', T.EVENT)], [
    parameter('patchId', 'string', '', { maxLength: 192, impact: I.PIPELINE_SPECIALIZATION }),
  ]),
  definition('telemetry.input', 'Telemetry Input', 'Telemetry Input', 7, 'telemetry', [], [output('stream', T.TELEMETRY_STREAM)], [
    parameter('channel', 'string', '', { maxLength: 192, impact: I.PIPELINE_SPECIALIZATION }),
    parameter('unit', 'string', '', { maxLength: 64, impact: I.AUTHORING_ONLY }),
  ]),
  definition('data.transform', 'Data Transform', 'Data Transform', 8, 'telemetry', [input('source', [T.TELEMETRY_STREAM, T.TIME_SERIES], { required: true })], [output('series', T.TIME_SERIES)], [
    parameter('operation', 'enum', 'identity', { values: ['identity', 'scale', 'offset', 'moving-average'], impact: I.PIPELINE_SPECIALIZATION }),
    parameter('value', 'number', 1, { min: -1e12, max: 1e12, impact: I.UNIFORM_UPDATE }),
  ]),
  definition('alert.rule', 'Alert/Rule', 'Alert Rule', 13, 'telemetry', [input('source', [T.SCALAR, T.TIME_SERIES], { required: true })], [output('events', T.EVENT)], [
    parameter('operator', 'enum', 'greater-than', { values: ['greater-than', 'less-than', 'outside-range'], impact: I.PIPELINE_SPECIALIZATION }),
    parameter('threshold', 'number', 0, { min: -1e30, max: 1e30, impact: I.UNIFORM_UPDATE }),
  ]),
  definition('external-study.import', 'External Study', 'External Study Import', 7, 'external-study', [], [output('study', T.EXTERNAL_STUDY), output('series', T.TIME_SERIES)], [
    parameter('resultId', 'string', '', { maxLength: 192, impact: I.FULL_GRAPH_REBUILD }),
    parameter('provenanceVerified', 'boolean', false, { impact: I.AUTHORING_ONLY }),
  ]),
  definition('output.export', 'Export/Output', 'Output', 15, 'output', [input('sources', [T.OUTPUT, T.RENDER_LAYER, T.TIME_SERIES, T.EVENT, T.EXTERNAL_STUDY], { required: true, cardinality: 'many' })], [output('output', T.OUTPUT)], [
    parameter('kind', 'enum', 'viewport', { values: ['viewport', 'json', 'csv', 'image'], impact: I.PIPELINE_SPECIALIZATION }),
  ]),
];

export const PARTICLE_RECIPE_NODE_DEFINITIONS = deepFreeze(Object.fromEntries(
  NODE_DEFINITION_LIST.map((item) => [item.type, item]),
));

/** Precise graph failure used by immutable edit helpers. */
export class ParticleRecipeGraphError extends Error {
  constructor(message, code = 'INVALID_RECIPE_GRAPH', details = null) {
    super(message);
    this.name = 'ParticleRecipeGraphError';
    this.code = code;
    this.details = details;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value) || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  Object.values(value).forEach((item) => deepFreeze(item, seen));
  return value;
}

function issue(code, message, path, details = {}) {
  return deepFreeze({ code, message, path, ...details });
}

function rejectUnknownKeys(value, allowed, path, errors) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(issue('UNKNOWN_FIELD', `${path}.${key} is not part of this schema; preserve extension data under ${path}.extensions.`, `${path}.${key}`));
  }
}

function compareText(left, right) {
  const leftText = String(left);
  const rightText = String(right);
  return leftText < rightText ? -1 : (leftText > rightText ? 1 : 0);
}

function validateSafeJSON(value, path, errors, depth = 0, seen = new WeakSet()) {
  if (depth > SAFE_EXTENSION_DEPTH) {
    errors.push(issue('VALUE_TOO_DEEP', `${path} exceeds the maximum nesting depth.`, path));
    return;
  }
  if (value == null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) errors.push(issue('NONFINITE_VALUE', `${path} must be finite.`, path));
    return;
  }
  if (typeof value === 'string') {
    if (value.length > 16384) errors.push(issue('STRING_TOO_LONG', `${path} exceeds 16384 characters.`, path));
    return;
  }
  if (typeof value !== 'object') {
    errors.push(issue('NON_JSON_VALUE', `${path} must contain JSON-compatible values.`, path));
    return;
  }
  if (seen.has(value)) {
    errors.push(issue('CYCLIC_VALUE', `${path} cannot contain a cycle.`, path));
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > 4096) errors.push(issue('ARRAY_TOO_LONG', `${path} supports at most 4096 items.`, path));
    value.slice(0, 4096).forEach((item, index) => validateSafeJSON(item, `${path}[${index}]`, errors, depth + 1, seen));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      errors.push(issue('NON_JSON_VALUE', `${path} must be a plain JSON object.`, path));
      seen.delete(value);
      return;
    }
    const keys = Object.keys(value);
    if (keys.length > 512) errors.push(issue('OBJECT_TOO_LARGE', `${path} supports at most 512 fields.`, path));
    for (const key of keys.slice(0, 512)) {
      if (FORBIDDEN_KEYS.has(key)) errors.push(issue('UNSAFE_KEY', `${path}.${key} is not permitted.`, `${path}.${key}`));
      else validateSafeJSON(value[key], `${path}.${key}`, errors, depth + 1, seen);
    }
  }
  seen.delete(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  const result = {};
  for (const key of Object.keys(value).sort(compareText)) result[key] = canonicalize(value[key]);
  return result;
}

function stableStringify(value, space = 0) {
  return JSON.stringify(canonicalize(value), null, Math.max(0, Math.min(10, Math.trunc(Number(space) || 0))));
}

function hashText(text) {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
    right ^= right >>> 13;
  }
  return `${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`;
}

function safeGraphId(value, fallback = 'recipe.graph.main') {
  const id = String(value ?? '').trim();
  return ID_PATTERN.test(id) ? id : fallback;
}

function deterministicEdgeId(fromNode, fromPort, toNode, toPort) {
  const key = `${fromNode}\u0000${fromPort}\u0000${toNode}\u0000${toPort}`;
  return `edge.${hashText(key)}`;
}

function normalizeTags(value, errors, path = 'metadata.tags') {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    errors.push(issue('INVALID_TAGS', `${path} must be an array.`, path));
    return [];
  }
  if (value.length > MAX_TAGS) errors.push(issue('TOO_MANY_TAGS', `${path} supports at most ${MAX_TAGS} tags.`, path));
  const result = [];
  const seen = new Set();
  for (let index = 0; index < Math.min(value.length, MAX_TAGS); index += 1) {
    const tag = value[index];
    if (typeof tag !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(tag)) {
      errors.push(issue('INVALID_TAG', `${path}[${index}] must be a lowercase tag identifier.`, `${path}[${index}]`));
    } else if (seen.has(tag)) {
      errors.push(issue('DUPLICATE_TAG', `${path}[${index}] duplicates ${tag}.`, `${path}[${index}]`));
    } else {
      seen.add(tag);
      result.push(tag);
    }
  }
  return result.sort(compareText);
}

function normalizeParameter(descriptor, value, path, errors) {
  const actual = value === undefined ? descriptor.default : value;
  if (descriptor.type === 'boolean') {
    if (typeof actual !== 'boolean') errors.push(issue('INVALID_PARAMETER_TYPE', `${path} must be boolean.`, path, { expected: 'boolean', received: typeof actual }));
    return typeof actual === 'boolean' ? actual : descriptor.default;
  }
  if (descriptor.type === 'string') {
    if (typeof actual !== 'string') errors.push(issue('INVALID_PARAMETER_TYPE', `${path} must be a string.`, path, { expected: 'string', received: typeof actual }));
    else if (actual.length > descriptor.maxLength) errors.push(issue('PARAMETER_TOO_LONG', `${path} exceeds ${descriptor.maxLength} characters.`, path));
    return typeof actual === 'string' ? actual.slice(0, descriptor.maxLength) : descriptor.default;
  }
  if (descriptor.type === 'enum') {
    if (!descriptor.values.includes(actual)) errors.push(issue('INVALID_PARAMETER_VALUE', `${path} must be one of: ${descriptor.values.join(', ')}.`, path, { expected: descriptor.values, received: actual }));
    return descriptor.values.includes(actual) ? actual : descriptor.default;
  }
  if (descriptor.type === 'vector3') {
    const valid = Array.isArray(actual) && actual.length === 3 && actual.every((item) => Number.isFinite(item) && item >= descriptor.min && item <= descriptor.max);
    if (!valid) errors.push(issue('INVALID_PARAMETER_VALUE', `${path} must be a finite three-component vector in [${descriptor.min}, ${descriptor.max}].`, path));
    return valid ? [...actual] : [...descriptor.default];
  }
  const validNumber = typeof actual === 'number' && Number.isFinite(actual);
  const validInteger = descriptor.type !== 'integer' || Number.isInteger(actual);
  if (!validNumber || !validInteger) {
    errors.push(issue('INVALID_PARAMETER_TYPE', `${path} must be a finite ${descriptor.type}.`, path, { expected: descriptor.type, received: typeof actual }));
    return descriptor.default;
  }
  if (actual < descriptor.min || actual > descriptor.max) {
    errors.push(issue('PARAMETER_OUT_OF_RANGE', `${path} must be in [${descriptor.min}, ${descriptor.max}].`, path, { min: descriptor.min, max: descriptor.max, received: actual }));
    return descriptor.default;
  }
  return actual;
}

function canonicalNode(raw, index, errors) {
  const path = `nodes[${index}]`;
  if (!isRecord(raw)) {
    errors.push(issue('INVALID_NODE', `${path} must be an object.`, path));
    return null;
  }
  rejectUnknownKeys(raw, new Set(['id', 'type', 'family', 'label', 'enabled', 'parameters', 'position', 'extensions']), path, errors);
  const type = String(raw.type ?? '');
  const descriptor = PARTICLE_RECIPE_NODE_DEFINITIONS[type];
  if (!descriptor) {
    errors.push(issue('UNKNOWN_NODE_TYPE', `${path}.type is not registered: ${type || '(empty)'}.`, `${path}.type`, { received: type }));
    return null;
  }
  const id = String(raw.id ?? '').trim();
  if (!ID_PATTERN.test(id)) errors.push(issue('INVALID_NODE_ID', `${path}.id must be a stable recipe identifier.`, `${path}.id`));
  if (raw.family != null && raw.family !== descriptor.family) errors.push(issue('NODE_FAMILY_MISMATCH', `${path}.family must be ${descriptor.family}.`, `${path}.family`, { expected: descriptor.family, received: raw.family }));
  const label = raw.label == null ? descriptor.label : raw.label;
  if (typeof label !== 'string' || !label.trim() || label.length > MAX_LABEL_LENGTH) errors.push(issue('INVALID_NODE_LABEL', `${path}.label must contain 1-${MAX_LABEL_LENGTH} characters.`, `${path}.label`));
  const enabled = raw.enabled == null ? true : raw.enabled;
  if (typeof enabled !== 'boolean') errors.push(issue('INVALID_NODE_ENABLED', `${path}.enabled must be boolean.`, `${path}.enabled`));
  const position = raw.position == null ? { x: 0, y: 0 } : raw.position;
  rejectUnknownKeys(position, new Set(['x', 'y']), `${path}.position`, errors);
  if (!isRecord(position) || !Number.isFinite(position.x) || !Number.isFinite(position.y) || Math.abs(position.x) > 100000 || Math.abs(position.y) > 100000) {
    errors.push(issue('INVALID_NODE_POSITION', `${path}.position must contain finite x/y coordinates within the authoring canvas.`, `${path}.position`));
  }
  const suppliedParameters = raw.parameters == null ? {} : raw.parameters;
  if (!isRecord(suppliedParameters)) errors.push(issue('INVALID_NODE_PARAMETERS', `${path}.parameters must be an object.`, `${path}.parameters`));
  const parameters = {};
  const parameterSource = isRecord(suppliedParameters) ? suppliedParameters : {};
  const knownParameters = new Set(descriptor.parameters.map((item) => item.id));
  for (const key of Object.keys(parameterSource)) {
    if (!knownParameters.has(key)) errors.push(issue('UNKNOWN_PARAMETER', `${path}.parameters.${key} is not defined for ${type}.`, `${path}.parameters.${key}`));
  }
  for (const item of descriptor.parameters) parameters[item.id] = normalizeParameter(item, parameterSource[item.id], `${path}.parameters.${item.id}`, errors);
  const extensions = raw.extensions == null ? {} : raw.extensions;
  if (!isRecord(extensions)) errors.push(issue('INVALID_EXTENSIONS', `${path}.extensions must be an object.`, `${path}.extensions`));
  else validateSafeJSON(extensions, `${path}.extensions`, errors);
  return {
    id,
    type,
    family: descriptor.family,
    label: typeof label === 'string' ? label : descriptor.label,
    enabled: typeof enabled === 'boolean' ? enabled : true,
    parameters,
    position: isRecord(position) && Number.isFinite(position.x) && Number.isFinite(position.y) ? { x: position.x, y: position.y } : { x: 0, y: 0 },
    extensions: isRecord(extensions) ? canonicalize(extensions) : {},
  };
}

function portById(descriptor, direction, portId) {
  return descriptor?.[direction]?.find((port) => port.id === portId) || null;
}

function canonicalEdge(raw, index, nodeMap, errors) {
  const path = `edges[${index}]`;
  if (!isRecord(raw)) {
    errors.push(issue('INVALID_EDGE', `${path} must be an object.`, path));
    return null;
  }
  rejectUnknownKeys(raw, new Set(['id', 'from', 'to', 'dataType']), path, errors);
  const from = isRecord(raw.from) ? raw.from : { nodeId: raw.fromNode, portId: raw.fromPort };
  const to = isRecord(raw.to) ? raw.to : { nodeId: raw.toNode, portId: raw.toPort };
  rejectUnknownKeys(from, new Set(['nodeId', 'portId']), `${path}.from`, errors);
  rejectUnknownKeys(to, new Set(['nodeId', 'portId']), `${path}.to`, errors);
  const fromNode = String(from.nodeId ?? '');
  const fromPort = String(from.portId ?? '');
  const toNode = String(to.nodeId ?? '');
  const toPort = String(to.portId ?? '');
  const id = String(raw.id ?? deterministicEdgeId(fromNode, fromPort, toNode, toPort));
  if (!ID_PATTERN.test(id)) errors.push(issue('INVALID_EDGE_ID', `${path}.id must be a stable recipe identifier.`, `${path}.id`));
  if (fromNode === toNode) errors.push(issue('SELF_EDGE', `${path} cannot connect a node to itself.`, path, { nodeId: fromNode }));
  const sourceNode = nodeMap.get(fromNode);
  const targetNode = nodeMap.get(toNode);
  if (!sourceNode) errors.push(issue('MISSING_SOURCE_NODE', `${path} references missing source node ${fromNode || '(empty)'}.`, `${path}.from.nodeId`, { nodeId: fromNode }));
  if (!targetNode) errors.push(issue('MISSING_TARGET_NODE', `${path} references missing target node ${toNode || '(empty)'}.`, `${path}.to.nodeId`, { nodeId: toNode }));
  const sourceDefinition = PARTICLE_RECIPE_NODE_DEFINITIONS[sourceNode?.type];
  const targetDefinition = PARTICLE_RECIPE_NODE_DEFINITIONS[targetNode?.type];
  const sourceSocket = portById(sourceDefinition, 'outputs', fromPort);
  const targetSocket = portById(targetDefinition, 'inputs', toPort);
  if (sourceNode && !sourceSocket) errors.push(issue('MISSING_SOURCE_PORT', `${path} references missing output ${fromNode}.${fromPort}.`, `${path}.from.portId`, { nodeId: fromNode, portId: fromPort }));
  if (targetNode && !targetSocket) errors.push(issue('MISSING_TARGET_PORT', `${path} references missing input ${toNode}.${toPort}.`, `${path}.to.portId`, { nodeId: toNode, portId: toPort }));
  const dataType = sourceSocket?.type || String(raw.dataType ?? '');
  if (sourceSocket && raw.dataType != null && raw.dataType !== sourceSocket.type) {
    errors.push(issue('EDGE_TYPE_DECLARATION_MISMATCH', `${path}.dataType must equal source type ${sourceSocket.type}.`, `${path}.dataType`, { expected: sourceSocket.type, received: raw.dataType }));
  }
  if (sourceSocket && targetSocket && !targetSocket.types.includes(sourceSocket.type)) {
    errors.push(issue('INCOMPATIBLE_PORT_TYPES', `${fromNode}.${fromPort} provides ${sourceSocket.type}; ${toNode}.${toPort} expects ${targetSocket.types.join(' | ')}.`, path, {
      expected: targetSocket.types,
      received: sourceSocket.type,
      fromNode,
      fromPort,
      toNode,
      toPort,
    }));
  }
  if (sourceNode && targetNode && targetNode.enabled && !sourceNode.enabled) {
    errors.push(issue('DISABLED_SOURCE', `${path} feeds enabled node ${toNode} from disabled node ${fromNode}.`, path, { fromNode, toNode }));
  }
  return { id, from: { nodeId: fromNode, portId: fromPort }, to: { nodeId: toNode, portId: toPort }, dataType };
}

function detectCycle(nodes, edges) {
  const adjacency = new Map(nodes.filter((node) => node.enabled).map((node) => [node.id, []]));
  for (const edge of edges) {
    if (adjacency.has(edge.from.nodeId) && adjacency.has(edge.to.nodeId)) adjacency.get(edge.from.nodeId).push(edge.to.nodeId);
  }
  adjacency.forEach((targets) => targets.sort(compareText));
  const active = new Set();
  const finished = new Set();
  const stack = [];
  let cycle = null;
  const visit = (nodeId) => {
    if (cycle || finished.has(nodeId)) return;
    if (active.has(nodeId)) {
      const start = stack.indexOf(nodeId);
      cycle = [...stack.slice(start), nodeId];
      return;
    }
    active.add(nodeId);
    stack.push(nodeId);
    for (const target of adjacency.get(nodeId) || []) visit(target);
    stack.pop();
    active.delete(nodeId);
    finished.add(nodeId);
  };
  [...adjacency.keys()].sort(compareText).forEach(visit);
  return cycle;
}

function cloneAuthoredGraph(value) {
  const errors = [];
  validateSafeJSON(value, 'graph', errors);
  return errors.length ? null : deepFreeze(canonicalize(value));
}

function prepareLegacyGraph(value) {
  if (!isRecord(value) || value.version !== LEGACY_RECIPE_GRAPH_VERSION) return value;
  const nodes = Array.isArray(value.nodes) ? value.nodes.map((node) => ({
    id: node?.id,
    type: node?.type ?? node?.kind,
    family: node?.family,
    label: node?.label,
    enabled: node?.enabled,
    parameters: node?.parameters ?? node?.params,
    position: node?.position ?? { x: node?.x ?? 0, y: node?.y ?? 0 },
    extensions: node?.extensions,
  })) : value.nodes;
  const legacyEdges = Array.isArray(value.edges) ? value.edges : value.connections;
  const edges = Array.isArray(legacyEdges) ? legacyEdges.map((edge) => ({
    id: edge?.id,
    from: edge?.from ?? { nodeId: edge?.fromNode, portId: edge?.fromPort },
    to: edge?.to ?? { nodeId: edge?.toNode, portId: edge?.toPort },
    dataType: edge?.dataType,
  })) : legacyEdges;
  return {
    schema: PARTICLE_RECIPE_GRAPH_SCHEMA,
    version: PARTICLE_RECIPE_GRAPH_VERSION,
    id: value.id ?? 'recipe.graph.migrated',
    revision: Number.isInteger(value.revision) ? value.revision : 1,
    seed: Number.isInteger(value.seed) ? value.seed : 0,
    metadata: value.metadata ?? { name: value.name ?? 'Migrated Recipe', description: '', tags: [] },
    nodes,
    edges,
    extensions: { ...(isRecord(value.extensions) ? value.extensions : {}), migratedFromVersion: LEGACY_RECIPE_GRAPH_VERSION },
  };
}

/**
 * Validate without mutating or repairing the authored graph.
 * @returns {{ok:boolean,errors:ReadonlyArray<object>,warnings:ReadonlyArray<object>,graph:object|null,authoredGraph:object|null}}
 */
export function validateParticleRecipeGraph(value, options = {}) {
  const errors = [];
  const warnings = [];
  const source = prepareLegacyGraph(value);
  const authoredGraph = cloneAuthoredGraph(value);
  if (!isRecord(source)) {
    return deepFreeze({ ok: false, errors: [issue('INVALID_GRAPH', 'Recipe graph must be an object.', 'graph')], warnings, graph: null, authoredGraph });
  }
  rejectUnknownKeys(source, new Set(['schema', 'version', 'id', 'revision', 'seed', 'metadata', 'nodes', 'edges', 'extensions']), 'graph', errors);
  if (source.schema !== PARTICLE_RECIPE_GRAPH_SCHEMA) errors.push(issue('UNSUPPORTED_SCHEMA', `schema must equal ${PARTICLE_RECIPE_GRAPH_SCHEMA}.`, 'schema', { expected: PARTICLE_RECIPE_GRAPH_SCHEMA, received: source.schema }));
  if (source.version !== PARTICLE_RECIPE_GRAPH_VERSION) errors.push(issue('UNSUPPORTED_VERSION', `version must equal ${PARTICLE_RECIPE_GRAPH_VERSION}.`, 'version', { expected: PARTICLE_RECIPE_GRAPH_VERSION, received: source.version }));
  const id = String(source.id ?? '').trim();
  if (!ID_PATTERN.test(id)) errors.push(issue('INVALID_GRAPH_ID', 'id must be a stable recipe identifier.', 'id'));
  if (!Number.isInteger(source.revision) || source.revision < 0 || source.revision > Number.MAX_SAFE_INTEGER) errors.push(issue('INVALID_REVISION', 'revision must be a nonnegative safe integer.', 'revision'));
  if (!Number.isInteger(source.seed) || source.seed < 0 || source.seed > UINT32_MAX) errors.push(issue('INVALID_SEED', 'seed must be an unsigned 32-bit integer.', 'seed'));
  const metadata = source.metadata == null ? {} : source.metadata;
  if (!isRecord(metadata)) errors.push(issue('INVALID_METADATA', 'metadata must be an object.', 'metadata'));
  const metadataSource = isRecord(metadata) ? metadata : {};
  rejectUnknownKeys(metadataSource, new Set(['name', 'description', 'tags']), 'metadata', errors);
  const name = metadataSource.name == null ? id : metadataSource.name;
  const description = metadataSource.description == null ? '' : metadataSource.description;
  if (typeof name !== 'string' || !name.trim() || name.length > MAX_LABEL_LENGTH) errors.push(issue('INVALID_RECIPE_NAME', `metadata.name must contain 1-${MAX_LABEL_LENGTH} characters.`, 'metadata.name'));
  if (typeof description !== 'string' || description.length > MAX_DESCRIPTION_LENGTH) errors.push(issue('INVALID_RECIPE_DESCRIPTION', `metadata.description must contain at most ${MAX_DESCRIPTION_LENGTH} characters.`, 'metadata.description'));
  const tags = normalizeTags(metadataSource.tags, errors);
  if (!Array.isArray(source.nodes)) errors.push(issue('INVALID_NODES', 'nodes must be an array.', 'nodes'));
  else if (source.nodes.length > MAX_NODES) errors.push(issue('TOO_MANY_NODES', `nodes supports at most ${MAX_NODES} items.`, 'nodes'));
  if (!Array.isArray(source.edges)) errors.push(issue('INVALID_EDGES', 'edges must be an array.', 'edges'));
  else if (source.edges.length > MAX_EDGES) errors.push(issue('TOO_MANY_EDGES', `edges supports at most ${MAX_EDGES} items.`, 'edges'));
  const nodes = [];
  const nodeMap = new Map();
  for (let index = 0; index < Math.min(source.nodes?.length || 0, MAX_NODES); index += 1) {
    const node = canonicalNode(source.nodes[index], index, errors);
    if (!node) continue;
    if (nodeMap.has(node.id)) errors.push(issue('DUPLICATE_NODE_ID', `nodes[${index}].id duplicates ${node.id}.`, `nodes[${index}].id`, { nodeId: node.id }));
    else {
      nodeMap.set(node.id, node);
      nodes.push(node);
    }
  }
  const edges = [];
  const edgeIds = new Set();
  const edgeEndpoints = new Set();
  const targetInputs = new Map();
  for (let index = 0; index < Math.min(source.edges?.length || 0, MAX_EDGES); index += 1) {
    const edge = canonicalEdge(source.edges[index], index, nodeMap, errors);
    if (!edge) continue;
    const endpointKey = `${edge.from.nodeId}\u0000${edge.from.portId}\u0000${edge.to.nodeId}\u0000${edge.to.portId}`;
    if (edgeIds.has(edge.id)) errors.push(issue('DUPLICATE_EDGE_ID', `edges[${index}].id duplicates ${edge.id}.`, `edges[${index}].id`, { edgeId: edge.id }));
    else edgeIds.add(edge.id);
    if (edgeEndpoints.has(endpointKey)) errors.push(issue('DUPLICATE_EDGE', `edges[${index}] duplicates an existing connection.`, `edges[${index}]`, { edgeId: edge.id }));
    else edgeEndpoints.add(endpointKey);
    const targetDefinition = PARTICLE_RECIPE_NODE_DEFINITIONS[nodeMap.get(edge.to.nodeId)?.type];
    const targetSocket = portById(targetDefinition, 'inputs', edge.to.portId);
    const targetKey = `${edge.to.nodeId}\u0000${edge.to.portId}`;
    const count = (targetInputs.get(targetKey) || 0) + 1;
    targetInputs.set(targetKey, count);
    if (targetSocket?.cardinality === 'one' && count > 1) errors.push(issue('INPUT_CARDINALITY', `${edge.to.nodeId}.${edge.to.portId} accepts one connection.`, `edges[${index}]`, { nodeId: edge.to.nodeId, portId: edge.to.portId }));
    edges.push(edge);
  }
  for (const node of nodes.filter((item) => item.enabled)) {
    const descriptor = PARTICLE_RECIPE_NODE_DEFINITIONS[node.type];
    for (const port of descriptor.inputs.filter((item) => item.required)) {
      const connected = edges.some((edge) => edge.to.nodeId === node.id && edge.to.portId === port.id && nodeMap.get(edge.from.nodeId)?.enabled);
      if (!connected) errors.push(issue('REQUIRED_INPUT_MISSING', `${node.id}.${port.id} requires ${port.types.join(' | ')}.`, `nodes.${node.id}.inputs.${port.id}`, { nodeId: node.id, portId: port.id, expected: port.types }));
    }
  }
  const cycle = detectCycle(nodes, edges);
  if (cycle) errors.push(issue('GRAPH_CYCLE', `Recipe graph contains a cycle: ${cycle.join(' -> ')}.`, 'edges', { cycle }));
  if (!nodes.some((node) => node.enabled && node.family === 'Export/Output')) errors.push(issue('OUTPUT_REQUIRED', 'Recipe graph needs at least one enabled Export/Output node.', 'nodes'));
  const availableSubsystems = Array.isArray(options.availableSubsystems) ? new Set(options.availableSubsystems.map(String)) : null;
  if (availableSubsystems) {
    for (const node of nodes.filter((item) => item.enabled)) {
      const subsystem = PARTICLE_RECIPE_NODE_DEFINITIONS[node.type].subsystem;
      if (!availableSubsystems.has(subsystem)) {
        const item = issue('MISSING_SUBSYSTEM', `${node.id} requires unavailable subsystem ${subsystem}.`, `nodes.${node.id}`, { nodeId: node.id, subsystem });
        (options.allowUnavailableSubsystems === true ? warnings : errors).push(item);
      }
    }
  }
  nodes.filter((node) => !node.enabled).forEach((node) => warnings.push(issue('NODE_DISABLED', `${node.id} is disabled and will not be compiled.`, `nodes.${node.id}`, { nodeId: node.id })));
  const rootExtensions = source.extensions == null ? {} : source.extensions;
  if (!isRecord(rootExtensions)) errors.push(issue('INVALID_EXTENSIONS', 'extensions must be an object.', 'extensions'));
  else validateSafeJSON(rootExtensions, 'extensions', errors);
  const graph = errors.length ? null : deepFreeze({
    schema: PARTICLE_RECIPE_GRAPH_SCHEMA,
    version: PARTICLE_RECIPE_GRAPH_VERSION,
    id,
    revision: source.revision,
    seed: source.seed >>> 0,
    metadata: { name, description, tags },
    nodes: nodes.sort((left, right) => compareText(left.id, right.id)),
    edges: edges.sort((left, right) => compareText(left.id, right.id)),
    extensions: canonicalize(rootExtensions),
  });
  return deepFreeze({ ok: errors.length === 0, errors, warnings, graph, authoredGraph });
}

/** Normalize and freeze a valid current or legacy graph. */
export function normalizeParticleRecipeGraph(value, options = {}) {
  const validation = validateParticleRecipeGraph(value, options);
  if (!validation.ok) throw new ParticleRecipeGraphError(validation.errors.map((item) => item.message).join(' '), 'INVALID_RECIPE_GRAPH', validation.errors);
  return validation.graph;
}

/** Migrate a supported graph version and return the canonical v1 form. */
export function migrateParticleRecipeGraph(value, options = {}) {
  if (!isRecord(value)) throw new ParticleRecipeGraphError('Recipe graph must be an object.', 'INVALID_RECIPE_GRAPH');
  if (value.schema !== PARTICLE_RECIPE_GRAPH_SCHEMA) throw new ParticleRecipeGraphError(`Unsupported recipe graph schema: ${String(value.schema)}.`, 'UNSUPPORTED_SCHEMA');
  if (value.version !== LEGACY_RECIPE_GRAPH_VERSION && value.version !== PARTICLE_RECIPE_GRAPH_VERSION) throw new ParticleRecipeGraphError(`Unsupported recipe graph version: ${String(value.version)}.`, 'UNSUPPORTED_VERSION');
  return normalizeParticleRecipeGraph(value, options);
}

/** Build one immutable typed node. */
export function createParticleRecipeNode(type, overrides = {}) {
  const descriptor = PARTICLE_RECIPE_NODE_DEFINITIONS[type];
  if (!descriptor) throw new ParticleRecipeGraphError(`Unknown recipe node type: ${String(type)}.`, 'UNKNOWN_NODE_TYPE');
  const raw = { id: overrides.id ?? type, type, family: descriptor.family, label: overrides.label ?? descriptor.label, enabled: overrides.enabled ?? true, parameters: overrides.parameters ?? {}, position: overrides.position ?? { x: 0, y: 0 }, extensions: overrides.extensions ?? {} };
  const errors = [];
  const node = canonicalNode(raw, 0, errors);
  if (errors.length) throw new ParticleRecipeGraphError(errors.map((item) => item.message).join(' '), 'INVALID_NODE', errors);
  return deepFreeze(node);
}

/** Build one stable edge. Its data type is resolved during graph validation. */
export function createParticleRecipeEdge(fromNode, fromPort, toNode, toPort, overrides = {}) {
  const edge = {
    id: overrides.id ?? deterministicEdgeId(fromNode, fromPort, toNode, toPort),
    from: { nodeId: String(fromNode), portId: String(fromPort) },
    to: { nodeId: String(toNode), portId: String(toPort) },
  };
  if (overrides.dataType != null) edge.dataType = String(overrides.dataType);
  return deepFreeze(edge);
}

function starterNodes(settings = DEFAULT_PARTICLE_SETTINGS, metadata = {}) {
  return [
    createParticleRecipeNode('project.metadata', { id: 'metadata.main', position: { x: 20, y: 20 }, parameters: { name: metadata.name || 'Particle Recipe', description: metadata.description || '' } }),
    createParticleRecipeNode('world.units', { id: 'world.main', position: { x: 220, y: 20 }, parameters: { gravity: [0, -settings.gravity, 0] } }),
    createParticleRecipeNode('domain.coordinates', { id: 'domain.main', position: { x: 420, y: 20 } }),
    createParticleRecipeNode('discretization.particles', { id: 'discretization.main', position: { x: 620, y: 20 }, parameters: { targetCount: settings.count, representation: 'particles' } }),
    createParticleRecipeNode('material.physical', { id: 'material.main', position: { x: 420, y: 340 }, parameters: { materialId: `material.${settings.mode}` } }),
    createParticleRecipeNode('substance.set', { id: 'substance.main', position: { x: 620, y: 420 }, parameters: { substanceId: `substance.${settings.mode}`, reaction: settings.reaction, reactionRate: settings.reactionRate } }),
    createParticleRecipeNode('emitter.particles', { id: 'emitter.main', position: { x: 620, y: 180 }, parameters: { mode: 'initial-fill', rate: settings.count, enabled: true } }),
    createParticleRecipeNode('initial-condition.state', { id: 'initial.main', position: { x: 840, y: 360 }, parameters: { temperature: settings.temperature, charge: settings.charge } }),
    createParticleRecipeNode('field.vector', { id: 'field.main', position: { x: 620, y: 300 }, parameters: { kind: PARTICLE_FIELD_FOR_MODE[settings.mode] || 'custom', strength: settings.force, drag: settings.drag, turbulence: settings.turbulence, cohesion: settings.cohesion, interaction: settings.interaction, brushRadius: settings.brushRadius } }),
    createParticleRecipeNode('solver.native', { id: 'solver.main', position: { x: 840, y: 120 }, parameters: { runtimeMode: settings.mode, nativeType: PARTICLE_SOLVER_FOR_MODE[settings.mode] || 'particle-runtime' } }),
    createParticleRecipeNode('visualizer.native', { id: 'visualizer.main', position: { x: 1040, y: 80 }, parameters: { kind: 'point-particles', palette: settings.preset, renderStyle: settings.renderStyle, pointSize: settings.size, exposure: settings.exposure, emission: settings.emission, trails: settings.trails, trailPersistence: settings.trailPersistence, bloom: settings.bloom } }),
    createParticleRecipeNode('camera.view', { id: 'camera.main', position: { x: 1040, y: 280 }, parameters: { projection: 'perspective', distance: settings.cameraDistance, yaw: settings.cameraYaw, pitch: settings.cameraPitch, autoOrbit: settings.autoOrbit } }),
    createParticleRecipeNode('view.layout', { id: 'view.main', position: { x: 1240, y: 140 } }),
    createParticleRecipeNode('output.export', { id: 'output.main', position: { x: 1440, y: 140 } }),
  ];
}

function starterEdges() {
  return [
    createParticleRecipeEdge('metadata.main', 'metadata', 'world.main', 'metadata'),
    createParticleRecipeEdge('world.main', 'world', 'domain.main', 'world'),
    createParticleRecipeEdge('domain.main', 'domain', 'discretization.main', 'domain'),
    createParticleRecipeEdge('domain.main', 'domain', 'emitter.main', 'domain'),
    createParticleRecipeEdge('domain.main', 'domain', 'initial.main', 'domain'),
    createParticleRecipeEdge('domain.main', 'domain', 'field.main', 'domain'),
    createParticleRecipeEdge('domain.main', 'domain', 'solver.main', 'domain'),
    createParticleRecipeEdge('material.main', 'material', 'substance.main', 'material'),
    createParticleRecipeEdge('substance.main', 'substances', 'emitter.main', 'substances'),
    createParticleRecipeEdge('discretization.main', 'discretization', 'solver.main', 'discretization'),
    createParticleRecipeEdge('emitter.main', 'particles', 'initial.main', 'particles'),
    createParticleRecipeEdge('emitter.main', 'particles', 'solver.main', 'particles'),
    createParticleRecipeEdge('initial.main', 'initialState', 'solver.main', 'initialState'),
    createParticleRecipeEdge('field.main', 'field', 'solver.main', 'fields'),
    createParticleRecipeEdge('solver.main', 'state', 'visualizer.main', 'state'),
    createParticleRecipeEdge('visualizer.main', 'layer', 'view.main', 'layers'),
    createParticleRecipeEdge('camera.main', 'camera', 'view.main', 'cameras'),
    createParticleRecipeEdge('view.main', 'view', 'output.main', 'sources'),
  ];
}

/** Create a valid generic recipe graph. */
export function createParticleRecipeGraph(options = {}) {
  const seed = Number.isInteger(options.seed) && options.seed >= 0 && options.seed <= UINT32_MAX ? options.seed >>> 0 : DEFAULT_PARTICLE_SETTINGS.seed;
  const metadata = { name: options.name || 'Particle Recipe', description: options.description || '', tags: options.tags || [] };
  return normalizeParticleRecipeGraph({
    schema: PARTICLE_RECIPE_GRAPH_SCHEMA,
    version: PARTICLE_RECIPE_GRAPH_VERSION,
    id: safeGraphId(options.id),
    revision: Number.isInteger(options.revision) && options.revision >= 0 ? options.revision : 1,
    seed,
    metadata,
    nodes: options.nodes ?? starterNodes(normalizeParticleSettings(options.settings || {}, options.maximum), metadata),
    edges: options.edges ?? starterEdges(),
    extensions: options.extensions || {},
  });
}

/**
 * Convert a built-in preset, legacy mode key, project, or settings record into
 * a graph backed by the current native particle runtime contract.
 */
export function createDefaultParticleRecipe(presetOrMode = 'galaxy', settings = {}, options = {}) {
  const source = isRecord(presetOrMode) ? presetOrMode : {};
  const requested = typeof presetOrMode === 'string' ? presetOrMode : (source.sourcePresetId || source.id || source.mode || source.settings?.mode);
  const preset = getBuiltInParticlePreset(requested) || getBuiltInParticlePreset(source.settings?.mode) || getBuiltInParticlePreset('galaxy');
  const suppliedSettings = isRecord(settings) ? settings : {};
  const runtimeSettings = normalizeParticleSettings({ ...preset.settings, ...(isRecord(source.settings) ? source.settings : source), ...suppliedSettings }, options.maximum);
  const name = options.name || source.name || preset.name;
  return createParticleRecipeGraph({
    id: options.id || `recipe.${preset.id.replace(/[^A-Za-z0-9._:-]/g, '-')}`,
    revision: options.revision ?? 1,
    seed: runtimeSettings.seed,
    name,
    description: options.description || source.description || preset.description,
    tags: options.tags || source.tags || preset.tags,
    settings: runtimeSettings,
    extensions: { sourcePresetId: preset.id, sourceModeId: runtimeSettings.mode, classification: source.classification || preset.classification },
  });
}

function editableGraph(value) {
  const source = isRecord(value) ? value : {};
  if (source.schema !== PARTICLE_RECIPE_GRAPH_SCHEMA || source.version !== PARTICLE_RECIPE_GRAPH_VERSION || !Array.isArray(source.nodes) || !Array.isArray(source.edges)) throw new ParticleRecipeGraphError('Graph edit helpers require a version-1 recipe graph.', 'INVALID_RECIPE_GRAPH');
  return canonicalize(source);
}

function finalizeEdit(source) {
  source.revision = (Number.isSafeInteger(source.revision) ? source.revision : 0) + 1;
  source.nodes.sort((left, right) => compareText(left.id, right.id));
  source.edges.sort((left, right) => compareText(left.id, right.id));
  return deepFreeze(source);
}

/** Add a node immutably; disconnected required inputs may make the authored graph invalid. */
export function addParticleRecipeNode(graph, typeOrNode, overrides = {}) {
  const source = editableGraph(graph);
  const node = typeof typeOrNode === 'string' ? createParticleRecipeNode(typeOrNode, overrides) : createParticleRecipeNode(typeOrNode?.type, typeOrNode);
  if (source.nodes.some((item) => item.id === node.id)) throw new ParticleRecipeGraphError(`Node ID already exists: ${node.id}.`, 'DUPLICATE_NODE_ID', { nodeId: node.id });
  if (source.nodes.length >= MAX_NODES) throw new ParticleRecipeGraphError(`Recipe graph supports at most ${MAX_NODES} nodes.`, 'TOO_MANY_NODES');
  source.nodes.push(canonicalize(node));
  return finalizeEdit(source);
}

/** Update a node immutably while preserving its stable ID and type. */
export function updateParticleRecipeNode(graph, nodeId, patch = {}) {
  const source = editableGraph(graph);
  const index = source.nodes.findIndex((item) => item.id === nodeId);
  if (index < 0) throw new ParticleRecipeGraphError(`Unknown recipe node: ${nodeId}.`, 'MISSING_NODE', { nodeId });
  const current = source.nodes[index];
  if (patch.id != null && patch.id !== nodeId) throw new ParticleRecipeGraphError('updateParticleRecipeNode cannot change a stable node ID.', 'IMMUTABLE_NODE_ID', { nodeId });
  if (patch.type != null && patch.type !== current.type) throw new ParticleRecipeGraphError('updateParticleRecipeNode cannot change a node type.', 'IMMUTABLE_NODE_TYPE', { nodeId });
  source.nodes[index] = canonicalize(createParticleRecipeNode(current.type, {
    ...current,
    ...patch,
    id: current.id,
    type: current.type,
    parameters: { ...current.parameters, ...(isRecord(patch.parameters) ? patch.parameters : {}) },
    position: { ...current.position, ...(isRecord(patch.position) ? patch.position : {}) },
    extensions: { ...current.extensions, ...(isRecord(patch.extensions) ? patch.extensions : {}) },
  }));
  return finalizeEdit(source);
}

/** Remove a node and every incident edge without mutating the source graph. */
export function removeParticleRecipeNode(graph, nodeId) {
  const source = editableGraph(graph);
  if (!source.nodes.some((item) => item.id === nodeId)) return graph;
  source.nodes = source.nodes.filter((item) => item.id !== nodeId);
  source.edges = source.edges.filter((edge) => edge.from.nodeId !== nodeId && edge.to.nodeId !== nodeId);
  return finalizeEdit(source);
}

/**
 * Connect two typed sockets immutably. Invalid types, cycles, duplicate links,
 * and one-input cardinality violations are rejected before a graph is returned.
 */
export function connectParticleRecipeNodes(graph, fromNode, fromPort, toNode, toPort, overrides = {}) {
  const source = editableGraph(graph);
  const edge = createParticleRecipeEdge(fromNode, fromPort, toNode, toPort, overrides);
  if (source.edges.length >= MAX_EDGES) throw new ParticleRecipeGraphError(`Recipe graph supports at most ${MAX_EDGES} edges.`, 'TOO_MANY_EDGES');
  const candidate = finalizeEdit({ ...source, nodes: [...source.nodes], edges: [...source.edges, canonicalize(edge)] });
  const result = validateParticleRecipeGraph(candidate);
  if (!result.ok) {
    const edgeFailureCodes = new Set([
      'DISABLED_SOURCE',
      'DUPLICATE_EDGE',
      'DUPLICATE_EDGE_ID',
      'EDGE_TYPE_DECLARATION_MISMATCH',
      'GRAPH_CYCLE',
      'INCOMPATIBLE_PORT_TYPES',
      'INPUT_CARDINALITY',
      'MISSING_SOURCE_NODE',
      'MISSING_SOURCE_PORT',
      'MISSING_TARGET_NODE',
      'MISSING_TARGET_PORT',
      'SELF_EDGE',
    ]);
    const errors = result.errors.filter((item) => edgeFailureCodes.has(item.code));
    if (errors.length) throw new ParticleRecipeGraphError(errors.map((item) => item.message).join(' '), errors[0].code, errors);
    // A builder must be able to connect the first socket of a node that has
    // several required inputs. Keep the valid edge even while the authored
    // graph remains incomplete; compilation still rejects it until complete.
    return candidate;
  }
  return result.graph;
}

/** Return currently available, type-compatible target sockets for one output. */
export function listCompatibleParticleRecipeInputs(graph, fromNodeId, fromPortId) {
  const source = editableGraph(graph);
  const sourceNode = source.nodes.find((node) => node.id === fromNodeId && node.enabled);
  const sourceDefinition = PARTICLE_RECIPE_NODE_DEFINITIONS[sourceNode?.type];
  const output = portById(sourceDefinition, 'outputs', fromPortId);
  if (!sourceNode || !output) return deepFreeze([]);
  const targets = [];
  for (const node of source.nodes) {
    if (!node.enabled || node.id === sourceNode.id) continue;
    const definition = PARTICLE_RECIPE_NODE_DEFINITIONS[node.type];
    for (const input of definition?.inputs || []) {
      if (!input.types.includes(output.type)) continue;
      const occupied = input.cardinality === 'one' && source.edges.some((edge) => edge.to.nodeId === node.id && edge.to.portId === input.id);
      if (occupied) continue;
      targets.push({ nodeId: node.id, portId: input.id, dataType: output.type, acceptedTypes: [...input.types] });
    }
  }
  targets.sort((left, right) => compareText(left.nodeId, right.nodeId) || compareText(left.portId, right.portId));
  return deepFreeze(targets);
}

/** Disconnect one edge by ID or endpoint tuple. */
export function disconnectParticleRecipeEdge(graph, edgeOrId) {
  const source = editableGraph(graph);
  const predicate = typeof edgeOrId === 'string'
    ? (edge) => edge.id === edgeOrId
    : (edge) => edge.from.nodeId === (edgeOrId?.fromNode ?? edgeOrId?.from?.nodeId)
      && edge.from.portId === (edgeOrId?.fromPort ?? edgeOrId?.from?.portId)
      && edge.to.nodeId === (edgeOrId?.toNode ?? edgeOrId?.to?.nodeId)
      && edge.to.portId === (edgeOrId?.toPort ?? edgeOrId?.to?.portId);
  const filtered = source.edges.filter((edge) => !predicate(edge));
  if (filtered.length === source.edges.length) return graph;
  source.edges = filtered;
  return finalizeEdit(source);
}

/** Deterministic canonical graph JSON. */
export function serializeParticleRecipeGraph(graph, space = 2) {
  const normalized = normalizeParticleRecipeGraph(graph);
  return stableStringify(normalized, space);
}

/** Parse, migrate, validate, and freeze a recipe graph document. */
export function deserializeParticleRecipeGraph(text, options = {}) {
  if (typeof text !== 'string') throw new TypeError('Recipe graph text must be a string.');
  if (new TextEncoder().encode(text).byteLength > MAX_GRAPH_BYTES) throw new ParticleRecipeGraphError(`Recipe graph exceeds ${MAX_GRAPH_BYTES} bytes.`, 'GRAPH_TOO_LARGE');
  const parsed = JSON.parse(text);
  return migrateParticleRecipeGraph(parsed, options);
}

/** Stable 64-bit hexadecimal content fingerprint (not a security signature). */
export function hashParticleRecipeGraph(graph) {
  return hashText(serializeParticleRecipeGraph(graph, 0));
}

function maxImpact(left, right) {
  return IMPACT_RANK[right] > IMPACT_RANK[left] ? right : left;
}

/** Validate that an execution plan is a deterministic product of its source graph. */
export function validateParticleRecipeExecutionPlan(value) {
  const errors = [];
  if (!isRecord(value)) {
    return deepFreeze({ ok: false, errors: [issue('INVALID_EXECUTION_PLAN', 'Execution plan must be an object.', 'plan')], plan: null });
  }
  if (value.schema !== PARTICLE_RECIPE_PLAN_SCHEMA) errors.push(issue('UNSUPPORTED_PLAN_SCHEMA', `plan.schema must equal ${PARTICLE_RECIPE_PLAN_SCHEMA}.`, 'plan.schema'));
  if (value.version !== PARTICLE_RECIPE_PLAN_VERSION) errors.push(issue('UNSUPPORTED_PLAN_VERSION', `plan.version must equal ${PARTICLE_RECIPE_PLAN_VERSION}.`, 'plan.version'));
  if (!Object.prototype.hasOwnProperty.call(IMPACT_RANK, value.changeImpact)) errors.push(issue('INVALID_CHANGE_IMPACT', 'plan.changeImpact is not recognized.', 'plan.changeImpact'));
  const graphValidation = validateParticleRecipeGraph(value.sourceGraph);
  if (!graphValidation.ok) {
    errors.push(issue('INVALID_PLAN_SOURCE_GRAPH', 'Execution plan sourceGraph is invalid.', 'plan.sourceGraph', { causes: graphValidation.errors }));
  } else if (errors.length === 0) {
    const expected = buildExecutionPlan(graphValidation.graph, null);
    const deterministicFields = ['graphId', 'graphRevision', 'graphSignature', 'seed', 'executionModel', 'requiredSubsystems', 'steps', 'outputBindings', 'sourceGraph'];
    for (const field of deterministicFields) {
      if (stableStringify(value[field]) !== stableStringify(expected[field])) errors.push(issue('PLAN_CONTENT_MISMATCH', `plan.${field} does not match its source graph.`, `plan.${field}`, { field }));
    }
  }
  return deepFreeze({ ok: errors.length === 0, errors, plan: errors.length ? null : value });
}

function graphFromPlan(plan) {
  return plan?.schema === PARTICLE_RECIPE_PLAN_SCHEMA && plan.version === PARTICLE_RECIPE_PLAN_VERSION ? plan.sourceGraph : null;
}

/** Classify the smallest safe runtime response between two valid graph states. */
export function classifyParticleRecipeGraphChange(previousGraph, nextGraph) {
  if (!previousGraph) return I.FULL_GRAPH_REBUILD;
  let previous;
  let next;
  try {
    previous = normalizeParticleRecipeGraph(previousGraph);
    next = normalizeParticleRecipeGraph(nextGraph);
  } catch {
    return I.FULL_GRAPH_REBUILD;
  }
  const previousNodes = new Map(previous.nodes.map((node) => [node.id, node]));
  const nextNodes = new Map(next.nodes.map((node) => [node.id, node]));
  if (previousNodes.size !== nextNodes.size || [...previousNodes.keys()].some((id) => !nextNodes.has(id))) return I.FULL_GRAPH_REBUILD;
  if (stableStringify(previous.edges) !== stableStringify(next.edges)) return I.FULL_GRAPH_REBUILD;
  let impact = previous.seed === next.seed ? I.NONE : I.SOLVER_RESET;
  for (const [id, before] of previousNodes) {
    const after = nextNodes.get(id);
    if (before.type !== after.type || before.enabled !== after.enabled) return I.FULL_GRAPH_REBUILD;
    const descriptor = PARTICLE_RECIPE_NODE_DEFINITIONS[before.type];
    for (const parameterDescriptor of descriptor.parameters) {
      if (stableStringify(before.parameters[parameterDescriptor.id]) !== stableStringify(after.parameters[parameterDescriptor.id])) impact = maxImpact(impact, parameterDescriptor.impact);
    }
    const beforeAuthoring = { label: before.label, position: before.position, extensions: before.extensions };
    const afterAuthoring = { label: after.label, position: after.position, extensions: after.extensions };
    if (stableStringify(beforeAuthoring) !== stableStringify(afterAuthoring)) impact = maxImpact(impact, I.AUTHORING_ONLY);
  }
  if (stableStringify(previous.metadata) !== stableStringify(next.metadata) || stableStringify(previous.extensions) !== stableStringify(next.extensions)) impact = maxImpact(impact, I.AUTHORING_ONLY);
  return impact;
}

function deterministicTopologicalOrder(graph) {
  const nodes = graph.nodes.filter((node) => node.enabled);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from.nodeId) || !nodeIds.has(edge.to.nodeId)) continue;
    outgoing.get(edge.from.nodeId).push(edge.to.nodeId);
    indegree.set(edge.to.nodeId, indegree.get(edge.to.nodeId) + 1);
  }
  outgoing.forEach((targets) => targets.sort(compareText));
  const ready = [...indegree.entries()].filter(([, count]) => count === 0).map(([id]) => id).sort(compareText);
  const order = [];
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    for (const target of outgoing.get(id)) {
      const count = indegree.get(target) - 1;
      indegree.set(target, count);
      if (count === 0) {
        ready.push(target);
        ready.sort(compareText);
      }
    }
  }
  return order;
}

function buildExecutionPlan(graph, previousPlan) {
  const order = deterministicTopologicalOrder(graph);
  const stepIndex = new Map(order.map((id, index) => [id, index]));
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const steps = order.map((nodeId, index) => {
    const node = nodes.get(nodeId);
    const descriptor = PARTICLE_RECIPE_NODE_DEFINITIONS[node.type];
    const inputs = graph.edges.filter((edge) => edge.to.nodeId === nodeId && stepIndex.has(edge.from.nodeId)).sort((left, right) => compareText(left.id, right.id)).map((edge) => ({
      edgeId: edge.id,
      portId: edge.to.portId,
      dataType: edge.dataType,
      source: { nodeId: edge.from.nodeId, portId: edge.from.portId, stepIndex: stepIndex.get(edge.from.nodeId) },
    }));
    return {
      index,
      nodeId,
      type: node.type,
      family: descriptor.family,
      phase: descriptor.phase,
      subsystem: descriptor.subsystem,
      parameters: node.parameters,
      inputs,
      outputs: descriptor.outputs.map((port) => ({ portId: port.id, dataType: port.type })),
    };
  });
  const graphSignature = hashParticleRecipeGraph(graph);
  const changeImpact = classifyParticleRecipeGraphChange(graphFromPlan(previousPlan), graph);
  const outputBindings = steps.filter((step) => step.family === 'Export/Output').flatMap((step) => step.outputs.map((port) => ({ nodeId: step.nodeId, portId: port.portId, dataType: port.dataType, stepIndex: step.index })));
  return deepFreeze({
    schema: PARTICLE_RECIPE_PLAN_SCHEMA,
    version: PARTICLE_RECIPE_PLAN_VERSION,
    graphId: graph.id,
    graphRevision: graph.revision,
    graphSignature,
    seed: graph.seed,
    executionModel: 'adapter-bound-native-subsystems',
    changeImpact,
    requiredSubsystems: [...new Set(steps.map((step) => step.subsystem))].sort(compareText),
    steps,
    outputBindings,
    sourceGraph: graph,
  });
}

/**
 * Compile a valid graph deterministically. Invalid authored state is returned
 * unchanged while `options.previousPlan` remains the active stale plan.
 */
export function compileParticleRecipeGraph(value, options = {}) {
  const validation = validateParticleRecipeGraph(value, options);
  const previousPlanValidation = options.previousPlan == null ? null : validateParticleRecipeExecutionPlan(options.previousPlan);
  const previousPlan = previousPlanValidation?.ok ? options.previousPlan : null;
  if (previousPlanValidation && !previousPlanValidation.ok) options.logger?.warn?.('[ParticleRecipeGraph] invalid previous plan ignored', { errors: previousPlanValidation.errors.map((item) => item.code) });
  if (!validation.ok) {
    options.logger?.warn?.('[ParticleRecipeGraph] compile rejected; preserving last valid plan', { graphId: value?.id ?? null, errors: validation.errors.map((item) => item.code), stale: Boolean(previousPlan) });
    return deepFreeze({ ok: false, stale: Boolean(previousPlan), plan: previousPlan, graph: null, authoredGraph: validation.authoredGraph, errors: validation.errors, warnings: validation.warnings, changeImpact: I.FULL_GRAPH_REBUILD });
  }
  const plan = buildExecutionPlan(validation.graph, previousPlan);
  options.logger?.debug?.('[ParticleRecipeGraph] compile complete', { graphId: plan.graphId, signature: plan.graphSignature, steps: plan.steps.length, impact: plan.changeImpact });
  return deepFreeze({ ok: true, stale: false, plan, graph: validation.graph, authoredGraph: validation.authoredGraph, errors: validation.errors, warnings: validation.warnings, changeImpact: plan.changeImpact });
}
