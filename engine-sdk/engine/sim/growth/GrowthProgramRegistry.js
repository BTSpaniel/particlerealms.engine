// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  GROWTH_PROGRAM_IDS,
  compareGrowthIds,
  failGrowth,
  freezeGrowthJson,
  requireGrowthIdentifier,
  requireGrowthInteger,
} from './GrowthContracts.js';
import { normalizeGrowthState, restoreGrowthState, snapshotGrowthState } from './GrowthState.js';
import { LegacyTransportBinaryProgram } from './programs/LegacyTransportBinaryProgram.js';
import { SpaceColonizationProgram } from './programs/SpaceColonizationProgram.js';
import { ParametricLSystemProgram } from './programs/ParametricLSystemProgram.js';
import { SelfOrganizingHybridProgram } from './programs/SelfOrganizingHybridProgram.js';

export class GrowthProgram {
  constructor({ id, version = 1, label = id } = {}) {
    this.id = requireGrowthIdentifier(id, 'growth program id');
    this.version = requireGrowthInteger(version, 'growth program version', { minimum: 1 });
    this.label = requireGrowthIdentifier(label, 'growth program label');
  }

  initialize() {
    failGrowth('GROWTH_PROGRAM_ABSTRACT', `${this.id}.initialize() must be implemented`);
  }

  step() {
    failGrowth('GROWTH_PROGRAM_ABSTRACT', `${this.id}.step() must be implemented`);
  }

  snapshot(state) {
    const normalized = normalizeGrowthState(state);
    this.assertStateIdentity(normalized);
    return snapshotGrowthState(normalized);
  }

  restore(snapshot) {
    const state = restoreGrowthState(snapshot);
    this.assertStateIdentity(state);
    return state;
  }

  hash(state) {
    const normalized = normalizeGrowthState(state);
    this.assertStateIdentity(normalized);
    return normalized.stateHash;
  }

  assertStateIdentity(state) {
    if (state.program.id !== this.id || state.program.version !== this.version) {
      failGrowth('GROWTH_PROGRAM_STATE_IDENTITY', `State belongs to ${state.program.id} v${state.program.version}, not ${this.id} v${this.version}`);
    }
    return state;
  }

  describe() {
    return freezeGrowthJson({ id: this.id, version: this.version, label: this.label }, '$.growthProgramDescription');
  }
}

function validateProgram(program, expectedId = null) {
  if (!program || typeof program !== 'object') failGrowth('GROWTH_PROGRAM_REQUIRED', 'Growth program factory must return an object');
  const id = requireGrowthIdentifier(program.id, 'growth program id');
  requireGrowthInteger(program.version, 'growth program version', { minimum: 1 });
  if (expectedId !== null && id !== expectedId) {
    failGrowth('GROWTH_PROGRAM_FACTORY_ID', `Growth program factory returned '${id}' instead of '${expectedId}'`);
  }
  for (const method of ['initialize', 'step', 'snapshot', 'restore', 'hash']) {
    if (typeof program[method] !== 'function') failGrowth('GROWTH_PROGRAM_METHOD', `Growth program '${id}' is missing ${method}()`);
  }
  return program;
}

export class GrowthProgramRegistry {
  constructor() {
    this._factories = new Map();
  }

  register(id, factory, { version = 1, label = id } = {}) {
    const programId = requireGrowthIdentifier(id, 'growth program id');
    if (typeof factory !== 'function') failGrowth('GROWTH_PROGRAM_FACTORY', `Factory for '${programId}' must be a function`);
    if (this._factories.has(programId)) failGrowth('GROWTH_PROGRAM_DUPLICATE', `Growth program '${programId}' is already registered`);
    const descriptor = Object.freeze({
      id: programId,
      version: requireGrowthInteger(version, 'growth program version', { minimum: 1 }),
      label: requireGrowthIdentifier(label, 'growth program label'),
      factory,
    });
    this._factories.set(programId, descriptor);
    return this;
  }

  has(id) {
    return this._factories.has(String(id));
  }

  list() {
    return Object.freeze([...this._factories.values()]
      .sort((left, right) => compareGrowthIds(left.id, right.id))
      .map(({ factory: _factory, ...descriptor }) => Object.freeze(descriptor)));
  }

  create(id, options = {}) {
    const programId = requireGrowthIdentifier(id, 'growth program id');
    const descriptor = this._factories.get(programId);
    if (!descriptor) failGrowth('GROWTH_PROGRAM_UNKNOWN', `Unknown growth program '${programId}'`);
    const program = validateProgram(descriptor.factory(options), programId);
    if (program.version !== descriptor.version) {
      failGrowth('GROWTH_PROGRAM_VERSION', `Growth program '${programId}' factory version does not match its registry descriptor`);
    }
    return program;
  }
}

export function createDefaultGrowthProgramRegistry() {
  return new GrowthProgramRegistry()
    .register(GROWTH_PROGRAM_IDS.LEGACY_TRANSPORT_BINARY, options => new LegacyTransportBinaryProgram(options), {
      label: 'Legacy transport binary',
    })
    .register(GROWTH_PROGRAM_IDS.SPACE_COLONIZATION, options => new SpaceColonizationProgram(options), {
      label: 'Space colonization',
    })
    .register(GROWTH_PROGRAM_IDS.PARAMETRIC_LSYSTEM, options => new ParametricLSystemProgram(options), {
      label: 'Parametric L-system',
    })
    .register(GROWTH_PROGRAM_IDS.SELF_ORGANIZING_HYBRID, options => new SelfOrganizingHybridProgram(options), {
      label: 'Self-organizing hybrid',
    });
}
