// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  MATTER_FIDELITY_LEVELS,
  MATTER_REPRESENTATIONS,
} from '../contracts/MatterContracts.js';
import {
  cloneAndFreezeStrictJson,
  cloneStrictJson,
  isPlainJsonObject,
} from '../../core/schema/StrictJsonValue.js';

export const MATTER_MODEL_SCHEMA = 'engine.matter-model';
export const MATTER_MODEL_VERSION = '1.0.0';

const IDENTIFIER = /^[a-z][a-z0-9._:/-]{0,255}$/;
const PARAMETER = /^[A-Za-z][A-Za-z0-9._-]{0,255}$/;
const STATE_PATH = /^(?:conserved|fields|mechanics|structure|environment|derived)(?:\.[A-Za-z][A-Za-z0-9]*)+$/;
const FORBIDDEN_STATE_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor']);
const MODEL_DOMAINS = new Set([
  'mechanical',
  'thermal',
  'chemical',
  'electrical',
  'phase',
  'transport',
  'topology',
  'biological',
]);
const MODEL_CLASSIFICATIONS = new Set(['physical', 'empirical', 'heuristic']);
const CONSERVED_QUANTITIES = new Set([
  'speciesMassKg',
  'momentumKgMPerS',
  'internalEnergyJ',
  'electricChargeC',
]);
const RESULT_STATUSES = new Set(['applied', 'unsupported']);

function fail(path, message) {
  throw new TypeError(`${path}: ${message}`);
}

function requirePlain(value, path) {
  if (!isPlainJsonObject(value)) fail(path, 'must be a plain object');
  return value;
}

function exactKeys(value, keys, path) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) fail(`${path}.${key}`, 'unknown field');
  }
}

function requireString(value, path, { pattern = null } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512
      || /[\u0000-\u001f\u007f]/.test(value)) {
    fail(path, 'must be a non-empty bounded control-free string');
  }
  if (pattern && !pattern.test(value)) fail(path, 'has invalid syntax');
  return value;
}

function requireInteger(value, path, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail(path, `must be an integer >= ${minimum}`);
  return value;
}

function uniqueStringArray(value, path, { allowed = null, pattern = null, nonempty = false } = {}) {
  if (!Array.isArray(value) || (nonempty && value.length === 0)) fail(path, 'must be an array');
  const result = value.map((item, index) => requireString(item, `${path}[${index}]`, { pattern }));
  if (new Set(result).size !== result.length) fail(path, 'must not contain duplicates');
  if (allowed) {
    for (const item of result) if (!allowed.has(item)) fail(path, `contains unsupported value '${item}'`);
  }
  return result;
}

function statePathArray(value, path) {
  const result = uniqueStringArray(value, path, { pattern: STATE_PATH });
  for (const [index, statePath] of result.entries()) {
    if (statePath.split('.').some(part => FORBIDDEN_STATE_PATH_PARTS.has(part))) {
      fail(`${path}[${index}]`, 'contains a forbidden prototype path segment');
    }
  }
  return result;
}

/** Validate one declarative, solver-neutral model descriptor. */
export function validateMatterModelDescriptor(value, path = '$') {
  requirePlain(value, path);
  exactKeys(value, new Set([
    'schema', 'schemaVersion', 'id', 'version', 'domain', 'classification',
    'reads', 'writes', 'invalidates', 'conservedQuantities', 'representations',
    'fidelityLevels', 'requiredParameters', 'evidence',
  ]), path);
  if (value.schema !== MATTER_MODEL_SCHEMA) fail(`${path}.schema`, 'is unsupported');
  if (value.schemaVersion !== MATTER_MODEL_VERSION) fail(`${path}.schemaVersion`, 'is unsupported');
  requireString(value.id, `${path}.id`, { pattern: IDENTIFIER });
  requireInteger(value.version, `${path}.version`, 1);
  if (!MODEL_DOMAINS.has(value.domain)) fail(`${path}.domain`, 'is unsupported');
  if (!MODEL_CLASSIFICATIONS.has(value.classification)) fail(`${path}.classification`, 'is unsupported');
  statePathArray(value.reads, `${path}.reads`);
  statePathArray(value.writes, `${path}.writes`);
  statePathArray(value.invalidates, `${path}.invalidates`);
  uniqueStringArray(value.conservedQuantities, `${path}.conservedQuantities`, {
    allowed: CONSERVED_QUANTITIES,
  });
  uniqueStringArray(value.representations, `${path}.representations`, {
    allowed: new Set(MATTER_REPRESENTATIONS),
    nonempty: true,
  });
  uniqueStringArray(value.fidelityLevels, `${path}.fidelityLevels`, {
    allowed: new Set(MATTER_FIDELITY_LEVELS),
    nonempty: true,
  });
  uniqueStringArray(value.requiredParameters, `${path}.requiredParameters`, { pattern: PARAMETER });
  requirePlain(value.evidence, `${path}.evidence`);
  exactKeys(value.evidence, new Set(['sourceIds', 'note']), `${path}.evidence`);
  uniqueStringArray(value.evidence.sourceIds, `${path}.evidence.sourceIds`);
  if (value.evidence.note != null) requireString(value.evidence.note, `${path}.evidence.note`);
  return value;
}

function validateExternalDelta(value, path) {
  if (value == null) return;
  requirePlain(value, path);
  exactKeys(value, new Set([
    'speciesMassKg', 'momentumKgMPerS', 'internalEnergyJ', 'electricChargeC',
  ]), path);
  if (value.speciesMassKg != null) {
    requirePlain(value.speciesMassKg, `${path}.speciesMassKg`);
    for (const [speciesId, amount] of Object.entries(value.speciesMassKg)) {
      requireString(speciesId, `${path}.speciesMassKg key`, { pattern: IDENTIFIER });
      if (typeof amount !== 'number' || !Number.isFinite(amount)) {
        fail(`${path}.speciesMassKg.${speciesId}`, 'must be finite');
      }
    }
  }
  if (value.momentumKgMPerS != null) {
    if (!Array.isArray(value.momentumKgMPerS) || value.momentumKgMPerS.length !== 3
        || value.momentumKgMPerS.some(component => typeof component !== 'number' || !Number.isFinite(component))) {
      fail(`${path}.momentumKgMPerS`, 'must be a finite 3-vector');
    }
  }
  for (const key of ['internalEnergyJ', 'electricChargeC']) {
    if (value[key] != null && (typeof value[key] !== 'number' || !Number.isFinite(value[key]))) {
      fail(`${path}.${key}`, 'must be finite');
    }
  }
}

function pathDeclared(path, declarations) {
  return declarations.some(declared => path === declared || path.startsWith(`${declared}.`));
}

function validateModelResult(value, descriptor, path = '$.modelResult') {
  requirePlain(value, path);
  exactKeys(value, new Set([
    'status', 'mutations', 'externalDelta', 'invalidatedPaths', 'diagnostics',
  ]), path);
  if (!RESULT_STATUSES.has(value.status)) fail(`${path}.status`, 'is unsupported');
  if (!Array.isArray(value.mutations)) fail(`${path}.mutations`, 'must be an array');
  for (const [index, mutation] of value.mutations.entries()) {
    const at = `${path}.mutations[${index}]`;
    requirePlain(mutation, at);
    exactKeys(mutation, new Set(['path', 'value']), at);
    statePathArray([mutation.path], `${at}.path`);
    if (!pathDeclared(mutation.path, descriptor.writes)) {
      fail(`${at}.path`, `is outside model '${descriptor.id}' declared writes`);
    }
    const conservedPath = /^conserved\.([A-Za-z][A-Za-z0-9]*)/.exec(mutation.path)?.[1] ?? null;
    if (conservedPath != null && !descriptor.conservedQuantities.includes(conservedPath)) {
      fail(`${at}.path`, `mutates undeclared conserved quantity '${conservedPath}'`);
    }
    cloneStrictJson(mutation.value, `${at}.value`);
  }
  const mutationPaths = value.mutations.map(mutation => mutation.path);
  if (new Set(mutationPaths).size !== mutationPaths.length) fail(`${path}.mutations`, 'contains duplicate paths');
  statePathArray(value.invalidatedPaths, `${path}.invalidatedPaths`);
  for (const invalidatedPath of value.invalidatedPaths) {
    if (!pathDeclared(invalidatedPath, descriptor.invalidates)) {
      fail(`${path}.invalidatedPaths`, `contains undeclared path '${invalidatedPath}'`);
    }
  }
  if (!Array.isArray(value.diagnostics)) fail(`${path}.diagnostics`, 'must be an array');
  for (const [index, diagnostic] of value.diagnostics.entries()) {
    requireString(diagnostic, `${path}.diagnostics[${index}]`);
  }
  validateExternalDelta(value.externalDelta, `${path}.externalDelta`);
  for (const quantity of Object.keys(value.externalDelta ?? {})) {
    if (!descriptor.conservedQuantities.includes(quantity)) {
      fail(`${path}.externalDelta.${quantity}`, `is not declared by model '${descriptor.id}'`);
    }
  }
  if (value.status === 'unsupported' && value.mutations.length !== 0) {
    fail(`${path}.mutations`, 'unsupported results cannot mutate state');
  }
  return value;
}

function bindingIdentity(modelId, version) {
  return `${modelId}@${version}`;
}

/**
 * Open registry of versioned physical models. Evaluators remain executable
 * capabilities; immutable descriptors are safe to inspect and serialize.
 */
export class MatterModelRegistry {
  #entries = new Map();

  register(descriptorInput, evaluator) {
    if (typeof evaluator !== 'function') throw new TypeError('Matter model evaluator must be a function');
    const descriptor = cloneAndFreezeStrictJson(descriptorInput, '$.matterModelDescriptor');
    validateMatterModelDescriptor(descriptor, '$.matterModelDescriptor');
    const key = bindingIdentity(descriptor.id, descriptor.version);
    if (this.#entries.has(key)) throw new TypeError(`Matter model '${key}' is already registered`);
    this.#entries.set(key, Object.freeze({ descriptor, evaluator }));
    return this;
  }

  has(modelId, version) {
    return this.#entries.has(bindingIdentity(String(modelId), version));
  }

  get(modelId, version) {
    return this.#entries.get(bindingIdentity(String(modelId), version))?.descriptor ?? null;
  }

  list() {
    return Object.freeze([...this.#entries.values()]
      .map(entry => entry.descriptor)
      .sort((left, right) => left.id.localeCompare(right.id) || left.version - right.version));
  }

  evaluate(binding, context) {
    const safeBinding = cloneAndFreezeStrictJson(binding, '$.modelBinding');
    requirePlain(safeBinding, '$.modelBinding');
    const safeContext = cloneAndFreezeStrictJson(context, '$.modelContext');
    const key = bindingIdentity(safeBinding.modelId, safeBinding.modelVersion);
    const entry = this.#entries.get(key);
    if (!entry) throw new TypeError(`Matter model '${key}' is not registered`);
    const { descriptor, evaluator } = entry;
    requirePlain(safeBinding.parameters, '$.modelBinding.parameters');
    for (const parameter of descriptor.requiredParameters) {
      if (!Object.hasOwn(safeBinding.parameters, parameter)) {
        return cloneAndFreezeStrictJson({
          status: 'unsupported',
          mutations: [],
          externalDelta: {},
          invalidatedPaths: [],
          diagnostics: [`Missing required parameter '${parameter}'`],
        }, '$.modelResult');
      }
    }
    const representation = safeContext?.state?.representation;
    if (!descriptor.representations.includes(representation?.kind)
        || !descriptor.fidelityLevels.includes(representation?.fidelityLevel)) {
      return cloneAndFreezeStrictJson({
        status: 'unsupported',
        mutations: [],
        externalDelta: {},
        invalidatedPaths: [],
        diagnostics: [`Model '${key}' does not support ${representation?.kind ?? 'unknown'} ${representation?.fidelityLevel ?? 'unknown'}`],
      }, '$.modelResult');
    }
    const rawResult = evaluator(Object.freeze({
      ...safeContext,
      descriptor,
      binding: safeBinding,
    }));
    const result = cloneAndFreezeStrictJson(rawResult, '$.modelResult');
    validateModelResult(result, descriptor);
    return result;
  }
}

const DEFAULT_REPRESENTATIONS = Object.freeze([...MATTER_REPRESENTATIONS]);
const DEFAULT_FIDELITY = Object.freeze([...MATTER_FIDELITY_LEVELS]);

function externalImpulseEvaluator({ state, interaction }) {
  const impulse = interaction.inputs.impulseKgMPerS;
  if (impulse == null) {
    return {
      status: 'unsupported',
      mutations: [],
      externalDelta: {},
      invalidatedPaths: [],
      diagnostics: ['The interaction does not provide impulseKgMPerS'],
    };
  }
  return {
    status: 'applied',
    mutations: [{
      path: 'conserved.momentumKgMPerS',
      value: state.conserved.momentumKgMPerS.map((component, index) => component + impulse[index]),
    }],
    externalDelta: { momentumKgMPerS: [...impulse] },
    invalidatedPaths: ['derived.dirtyPaths'],
    diagnostics: [],
  };
}

function thermalCapacityEvaluator({ state, binding, interaction }) {
  const energyJ = interaction.inputs.energyJ;
  if (energyJ == null) {
    return {
      status: 'unsupported',
      mutations: [],
      externalDelta: {},
      invalidatedPaths: [],
      diagnostics: ['The interaction does not provide energyJ'],
    };
  }
  const massKg = Object.values(state.conserved.speciesMassKg).reduce((sum, value) => sum + value, 0);
  const specificHeat = binding.parameters.specificHeatJPerKgK;
  if (!(massKg > 0)) {
    return {
      status: 'unsupported',
      mutations: [],
      externalDelta: {},
      invalidatedPaths: [],
      diagnostics: ['Temperature cannot be evaluated without positive tracked mass'],
    };
  }
  if (!(typeof specificHeat === 'number' && Number.isFinite(specificHeat) && specificHeat > 0)) {
    return {
      status: 'unsupported',
      mutations: [],
      externalDelta: {},
      invalidatedPaths: [],
      diagnostics: ['specificHeatJPerKgK is unavailable or invalid'],
    };
  }
  const mutations = [{
    path: 'conserved.internalEnergyJ',
    value: state.conserved.internalEnergyJ + energyJ,
  }];
  if (state.fields?.temperatureK != null) {
    mutations.push({
      path: 'fields.temperatureK',
      value: state.fields.temperatureK + energyJ / (massKg * specificHeat),
    });
  }
  return {
    status: 'applied',
    mutations,
    externalDelta: { internalEnergyJ: energyJ },
    invalidatedPaths: ['derived.dirtyPaths'],
    diagnostics: state.fields?.temperatureK == null
      ? ['Energy was conserved; temperature remains unevaluated because no temperature state was supplied']
      : [],
  };
}

/** Registry containing only universal models whose parameters are explicit. */
export function createDefaultMatterModelRegistry() {
  return new MatterModelRegistry()
    .register({
      schema: MATTER_MODEL_SCHEMA,
      schemaVersion: MATTER_MODEL_VERSION,
      id: 'engine.matter.model.external-impulse',
      version: 1,
      domain: 'mechanical',
      classification: 'physical',
      reads: ['conserved.momentumKgMPerS'],
      writes: ['conserved.momentumKgMPerS'],
      invalidates: ['derived.dirtyPaths'],
      conservedQuantities: ['momentumKgMPerS'],
      representations: DEFAULT_REPRESENTATIONS,
      fidelityLevels: DEFAULT_FIDELITY,
      requiredParameters: [],
      evidence: {
        sourceIds: [],
        note: 'Applies an explicitly supplied external impulse without a damage inference.',
      },
    }, externalImpulseEvaluator)
    .register({
      schema: MATTER_MODEL_SCHEMA,
      schemaVersion: MATTER_MODEL_VERSION,
      id: 'engine.matter.model.thermal-capacity',
      version: 1,
      domain: 'thermal',
      classification: 'physical',
      reads: ['conserved.internalEnergyJ', 'conserved.speciesMassKg', 'fields.temperatureK'],
      writes: ['conserved.internalEnergyJ', 'fields.temperatureK'],
      invalidates: ['derived.dirtyPaths'],
      conservedQuantities: ['internalEnergyJ'],
      representations: DEFAULT_REPRESENTATIONS,
      fidelityLevels: DEFAULT_FIDELITY,
      requiredParameters: ['specificHeatJPerKgK'],
      evidence: {
        sourceIds: [],
        note: 'Requires sourced specific heat and never fabricates temperature state.',
      },
    }, thermalCapacityEvaluator);
}
