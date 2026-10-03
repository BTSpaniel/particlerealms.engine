// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  MATTER_FIDELITY_LEVELS,
  MATTER_REPRESENTATIONS,
  validateMatterState,
} from '../contracts/MatterContracts.js';
import {
  cloneAndFreezeStrictJson,
  cloneStrictJson,
  isPlainJsonObject,
} from '../../core/schema/StrictJsonValue.js';

export const MATTER_BACKEND_ADAPTER_SCHEMA = 'engine.matter-backend-adapter';
export const MATTER_BACKEND_ADAPTER_VERSION = '1.0.0';

const IDENTIFIER = /^[a-z][a-z0-9._:/-]{0,255}$/;
const CAPABILITIES = new Set(['project', 'collect', 'contacts', 'topology', 'thermal', 'transport']);

function fail(path, message) {
  throw new TypeError(`${path}: ${message}`);
}

function validateDescriptor(value, path = '$') {
  if (!isPlainJsonObject(value)) fail(path, 'must be a plain object');
  for (const key of Object.keys(value)) {
    if (![
      'schema', 'schemaVersion', 'id', 'version', 'representation',
      'fidelityLevels', 'capabilities', 'solverAuthority',
    ].includes(key)) fail(`${path}.${key}`, 'unknown field');
  }
  if (value.schema !== MATTER_BACKEND_ADAPTER_SCHEMA) fail(`${path}.schema`, 'is unsupported');
  if (value.schemaVersion !== MATTER_BACKEND_ADAPTER_VERSION) fail(`${path}.schemaVersion`, 'is unsupported');
  if (typeof value.id !== 'string' || !IDENTIFIER.test(value.id)) fail(`${path}.id`, 'has invalid syntax');
  if (!Number.isSafeInteger(value.version) || value.version < 1) fail(`${path}.version`, 'must be a positive integer');
  if (!MATTER_REPRESENTATIONS.includes(value.representation)) fail(`${path}.representation`, 'is unsupported');
  if (!Array.isArray(value.fidelityLevels) || value.fidelityLevels.length === 0
      || value.fidelityLevels.some(level => !MATTER_FIDELITY_LEVELS.includes(level))) {
    fail(`${path}.fidelityLevels`, 'must contain supported fidelity levels');
  }
  if (new Set(value.fidelityLevels).size !== value.fidelityLevels.length) fail(`${path}.fidelityLevels`, 'contains duplicates');
  if (!Array.isArray(value.capabilities)
      || value.capabilities.some(capability => !CAPABILITIES.has(capability))) {
    fail(`${path}.capabilities`, 'contains unsupported capabilities');
  }
  if (new Set(value.capabilities).size !== value.capabilities.length) fail(`${path}.capabilities`, 'contains duplicates');
  if (typeof value.solverAuthority !== 'string' || !IDENTIFIER.test(value.solverAuthority)) {
    fail(`${path}.solverAuthority`, 'has invalid syntax');
  }
  return value;
}

function requireBackendState(descriptor, state, path) {
  if (state.representation.backendId !== descriptor.id) {
    fail(`${path}.representation.backendId`, `must match backend '${descriptor.id}'`);
  }
  if (descriptor.representation !== state.representation.kind
      || !descriptor.fidelityLevels.includes(state.representation.fidelityLevel)) {
    fail(`${path}.representation`, `is unsupported by backend '${descriptor.id}'`);
  }
}

function requireCollectedRepresentation(backendId, priorState, candidate) {
  for (const field of ['kind', 'fidelityLevel', 'backendId']) {
    if (candidate.representation[field] !== priorState.representation[field]) {
      throw new TypeError(
        `Matter backend '${backendId}' candidate representation is unsupported by backend collection authority: `
        + `collect cannot change '${field}' from '${priorState.representation[field]}' `
        + `to '${candidate.representation[field]}'. Use transitionMatterRepresentation() for representation transitions`,
      );
    }
  }
}

/**
 * Open bridge registry for PhysX, FEM, MPM, particle, fluid, voxel, aerosol,
 * and future solvers. Backends retain numerical authority; Matter retains the
 * semantic state and validates every collected candidate state.
 */
export class MatterBackendAdapterRegistry {
  #entries = new Map();

  register(descriptorInput, adapter) {
    const descriptor = cloneAndFreezeStrictJson(descriptorInput, '$.matterBackendDescriptor');
    validateDescriptor(descriptor, '$.matterBackendDescriptor');
    if (!adapter || typeof adapter !== 'object') throw new TypeError('Matter backend adapter object is required');
    for (const capability of descriptor.capabilities) {
      if (['project', 'collect'].includes(capability) && typeof adapter[capability] !== 'function') {
        throw new TypeError(`Matter backend '${descriptor.id}' declares ${capability} without implementing it`);
      }
    }
    const key = `${descriptor.id}@${descriptor.version}`;
    if (this.#entries.has(key)) throw new TypeError(`Matter backend '${key}' is already registered`);
    this.#entries.set(key, Object.freeze({ descriptor, adapter }));
    return this;
  }

  get(id, version) {
    return this.#entries.get(`${String(id)}@${version}`)?.descriptor ?? null;
  }

  list() {
    return Object.freeze([...this.#entries.values()]
      .map(entry => entry.descriptor)
      .sort((left, right) => left.id.localeCompare(right.id) || left.version - right.version));
  }

  project(id, version, state, context = {}) {
    const entry = this.#entries.get(`${String(id)}@${version}`);
    if (!entry) throw new TypeError(`Matter backend '${String(id)}@${version}' is not registered`);
    if (!entry.descriptor.capabilities.includes('project')) throw new TypeError(`Matter backend '${id}' cannot project`);
    const safeState = cloneAndFreezeStrictJson(state, '$.state');
    validateMatterState(safeState, '$.state');
    requireBackendState(entry.descriptor, safeState, '$.state');
    return cloneAndFreezeStrictJson(entry.adapter.project(Object.freeze({
      state: safeState,
      context: cloneStrictJson(context, '$.context'),
      descriptor: entry.descriptor,
    })), '$.backendProjection');
  }

  collect(id, version, projection, priorState, context = {}) {
    const entry = this.#entries.get(`${String(id)}@${version}`);
    if (!entry) throw new TypeError(`Matter backend '${String(id)}@${version}' is not registered`);
    if (!entry.descriptor.capabilities.includes('collect')) throw new TypeError(`Matter backend '${id}' cannot collect`);
    const safePriorState = cloneAndFreezeStrictJson(priorState, '$.priorState');
    validateMatterState(safePriorState, '$.priorState');
    requireBackendState(entry.descriptor, safePriorState, '$.priorState');
    const candidate = cloneAndFreezeStrictJson(entry.adapter.collect(Object.freeze({
      projection: cloneAndFreezeStrictJson(projection, '$.projection'),
      priorState: safePriorState,
      context: cloneStrictJson(context, '$.context'),
      descriptor: entry.descriptor,
    })), '$.candidateState');
    validateMatterState(candidate, '$.candidateState');
    requireCollectedRepresentation(entry.descriptor.id, safePriorState, candidate);
    requireBackendState(entry.descriptor, candidate, '$.candidateState');
    if (candidate.regionId !== safePriorState.regionId
        || candidate.definitionId !== safePriorState.definitionId
        || candidate.definitionHash !== safePriorState.definitionHash) {
      throw new TypeError(`Matter backend '${id}' changed region or definition identity`);
    }
    if (candidate.revision !== safePriorState.revision + 1) {
      throw new TypeError(`Matter backend '${id}' candidate revision must advance exactly once`);
    }
    return candidate;
  }
}
