// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Deterministic, fail-closed orchestration for one coupled Matter state update. */

import {
  cloneAndFreezeStrictJson,
  cloneStrictJson,
} from '../../core/schema/StrictJsonValue.js';
import { canonicalize, hashIdSecure } from '../../state/util/canonical.js';
import {
  createMatterDefinition,
  createMatterInteraction,
  createMatterState,
} from '../contracts/MatterContracts.js';
import { MatterModelRegistry } from '../models/MatterModelRegistry.js';
import { applyMatterModelResult } from '../models/MatterModelApplication.js';
import { MatterDependencyGraph } from './MatterDependencyGraph.js';
import {
  assertMatterConservation,
  createMatterConservationLedger,
  MATTER_CONSERVATION_DEFAULT_TOLERANCE,
} from '../state/MatterConservationLedger.js';

export const MATTER_COUPLING_SCHEDULE_SCHEMA = 'engine.matter.coupling-schedule';
export const MATTER_COUPLING_SCHEDULE_VERSION = '1.0.0';

const STATE_PATH = /^(?:conserved|fields|mechanics|structure|environment|derived)(?:\.[A-Za-z][A-Za-z0-9]*)+$/;
const FORBIDDEN_STATE_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor']);

function modelKey(modelId, modelVersion) {
  return `${modelId}@${modelVersion}`;
}

function modelReference(descriptor) {
  return {
    modelId: descriptor.id,
    modelVersion: descriptor.version,
  };
}

function pathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);
}

function normalizeChangedPaths(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new TypeError('MatterCouplingScheduler: changedPaths must be a non-empty array');
  }
  const seen = new Set();
  const paths = [];
  for (const [index, path] of input.entries()) {
    if (typeof path !== 'string' || !STATE_PATH.test(path)) {
      throw new TypeError(`MatterCouplingScheduler: changedPaths[${index}] has invalid state-path syntax`);
    }
    if (path.split('.').some(part => FORBIDDEN_STATE_PATH_PARTS.has(part))) {
      throw new TypeError(`MatterCouplingScheduler: changedPaths[${index}] contains a forbidden prototype segment`);
    }
    if (seen.has(path)) {
      throw new TypeError(`MatterCouplingScheduler: changedPaths duplicates '${path}'`);
    }
    seen.add(path);
    paths.push(path);
  }
  return Object.freeze(paths.sort());
}

function scalarAccumulator() {
  return { sum: 0, correction: 0 };
}

function addFinite(accumulator, value, label) {
  const adjusted = value - accumulator.correction;
  const next = accumulator.sum + adjusted;
  if (!Number.isFinite(next)) {
    throw new RangeError(`MatterCouplingScheduler: ${label} exceeds the finite numeric range`);
  }
  accumulator.correction = (next - accumulator.sum) - adjusted;
  accumulator.sum = next;
}

function cleanZero(value) {
  return value === 0 ? 0 : value;
}

class ExternalDeltaAccumulator {
  #species = new Map();
  #momentum = [scalarAccumulator(), scalarAccumulator(), scalarAccumulator()];
  #internalEnergy = scalarAccumulator();
  #electricCharge = scalarAccumulator();
  #claims = new Map();

  #claim(quantity, active, model) {
    if (!active) return;
    const prior = this.#claims.get(quantity);
    if (prior) {
      throw new TypeError(
        `MatterCouplingScheduler: external delta '${quantity}' is claimed by both '${prior}' and '${model}'`,
      );
    }
    this.#claims.set(quantity, model);
  }

  add(delta, model) {
    for (const speciesId of Object.keys(delta.speciesMassKg ?? {}).sort()) {
      this.#claim(`speciesMassKg.${speciesId}`, delta.speciesMassKg[speciesId] !== 0, model);
      let accumulator = this.#species.get(speciesId);
      if (!accumulator) {
        accumulator = scalarAccumulator();
        this.#species.set(speciesId, accumulator);
      }
      addFinite(accumulator, delta.speciesMassKg[speciesId], `${model} species '${speciesId}' external delta`);
    }
    this.#claim('momentumKgMPerS', (delta.momentumKgMPerS ?? []).some(value => value !== 0), model);
    for (let axis = 0; axis < 3; axis += 1) {
      addFinite(this.#momentum[axis], delta.momentumKgMPerS?.[axis] ?? 0, `${model} momentum axis ${axis} external delta`);
    }
    this.#claim('internalEnergyJ', (delta.internalEnergyJ ?? 0) !== 0, model);
    this.#claim('electricChargeC', (delta.electricChargeC ?? 0) !== 0, model);
    addFinite(this.#internalEnergy, delta.internalEnergyJ ?? 0, `${model} internal-energy external delta`);
    addFinite(this.#electricCharge, delta.electricChargeC ?? 0, `${model} electric-charge external delta`);
  }

  value() {
    const speciesMassKg = {};
    for (const speciesId of [...this.#species.keys()].sort()) {
      speciesMassKg[speciesId] = cleanZero(this.#species.get(speciesId).sum);
    }
    return {
      speciesMassKg,
      momentumKgMPerS: this.#momentum.map(accumulator => cleanZero(accumulator.sum)),
      internalEnergyJ: cleanZero(this.#internalEnergy.sum),
      electricChargeC: cleanZero(this.#electricCharge.sum),
    };
  }
}

function assertDescriptorAuthority(plannedDescriptor, registry) {
  const registered = registry.get(plannedDescriptor.id, plannedDescriptor.version);
  const key = modelKey(plannedDescriptor.id, plannedDescriptor.version);
  if (!registered) {
    throw new TypeError(`MatterCouplingScheduler: planned model '${key}' is not registered`);
  }
  if (canonicalize(registered) !== canonicalize(plannedDescriptor)) {
    throw new TypeError(`MatterCouplingScheduler: dependency descriptor for '${key}' differs from the registry`);
  }
  return registered;
}

function assertGraphAuthority(graph, registry) {
  const graphDescriptors = graph.order();
  const registeredDescriptors = registry.list();
  if (graphDescriptors.length !== registeredDescriptors.length) {
    throw new TypeError('MatterCouplingScheduler: dependency graph and registry contain different model sets');
  }
  const registeredByKey = new Map(registeredDescriptors.map(descriptor => [
    modelKey(descriptor.id, descriptor.version),
    descriptor,
  ]));
  for (const graphDescriptor of graphDescriptors) {
    const registered = registeredByKey.get(modelKey(graphDescriptor.id, graphDescriptor.version));
    if (!registered || canonicalize(registered) !== canonicalize(graphDescriptor)) {
      throw new TypeError(
        `MatterCouplingScheduler: dependency descriptor for '${modelKey(graphDescriptor.id, graphDescriptor.version)}' differs from the registry`,
      );
    }
  }
}

function assertNoMutationConflict(claims, path, model) {
  for (const claim of claims) {
    if (!pathsOverlap(claim.path, path)) continue;
    throw new TypeError(
      `MatterCouplingScheduler: mutation conflict '${claim.path}' from '${claim.model}' overlaps '${path}' from '${model}'`,
    );
  }
  claims.push({ path, model });
}

function bindingMap(definition) {
  return new Map(definition.modelBindings.map(binding => [
    modelKey(binding.modelId, binding.modelVersion),
    binding,
  ]));
}

function requireRegistry(value) {
  if (!(value instanceof MatterModelRegistry)) {
    throw new TypeError('MatterCouplingScheduler: registry must be a MatterModelRegistry');
  }
  return value;
}

function requireGraph(value) {
  if (!(value instanceof MatterDependencyGraph)) {
    throw new TypeError('MatterCouplingScheduler: graph must be a MatterDependencyGraph');
  }
  return value;
}

function secureHashDigest(value, label) {
  const match = /^sha256(?::256)?:([0-9a-f]{64})$/.exec(value);
  if (!match) throw new TypeError(`MatterCouplingScheduler: ${label} must be a secure SHA-256 hash`);
  return match[1];
}

/**
 * Execute the bound portion of an explicit dependency plan exactly once.
 * The scheduler returns a candidate state and receipt; durable commit remains
 * the MatterStateStore authority.
 */
export class MatterCouplingScheduler {
  #registry;
  #graph;

  constructor({ registry, graph } = {}) {
    this.#registry = requireRegistry(registry);
    this.#graph = requireGraph(graph);
    Object.freeze(this);
  }

  async schedule({
    definition: definitionInput,
    definitionHash,
    state: stateInput,
    interaction: interactionInput,
    changedPaths: changedPathInput,
    tolerance = MATTER_CONSERVATION_DEFAULT_TOLERANCE,
  } = {}) {
    const definition = createMatterDefinition(definitionInput);
    const beforeState = createMatterState(stateInput);
    const interaction = createMatterInteraction(interactionInput);
    const changedPaths = normalizeChangedPaths(changedPathInput);

    if (definition.id !== beforeState.definitionId) {
      throw new TypeError(`MatterCouplingScheduler: state definition '${beforeState.definitionId}' does not match '${definition.id}'`);
    }
    if (definitionHash !== beforeState.definitionHash) {
      throw new TypeError(`MatterCouplingScheduler: definition hash does not match region '${beforeState.regionId}'`);
    }
    const expectedDefinitionHash = await hashIdSecure(definition, {
      domain: 'engine.matter.definition',
      schemaVersion: definition.schemaVersion,
    });
    if (secureHashDigest(definitionHash, 'definitionHash')
        !== secureHashDigest(expectedDefinitionHash, 'computed definition hash')) {
      throw new TypeError(`MatterCouplingScheduler: definition hash does not match definition '${definition.id}' content`);
    }
    if (interaction.targetRegionIds.length !== 1 || interaction.targetRegionIds[0] !== beforeState.regionId) {
      throw new TypeError(`MatterCouplingScheduler: interaction must target only region '${beforeState.regionId}'`);
    }
    if (beforeState.revision === Number.MAX_SAFE_INTEGER) {
      throw new RangeError(`MatterCouplingScheduler: region '${beforeState.regionId}' revision cannot advance`);
    }

    let graphPlan;
    try {
      assertGraphAuthority(this.#graph, this.#registry);
      graphPlan = this.#graph.plan(changedPaths);
    } catch (error) {
      throw new TypeError(`MatterCouplingScheduler: dependency plan rejected: ${error.message}`, { cause: error });
    }

    const bindings = bindingMap(definition);
    const selected = [];
    const skippedUnboundModels = [];
    for (const plannedDescriptor of graphPlan) {
      const key = modelKey(plannedDescriptor.id, plannedDescriptor.version);
      const descriptor = assertDescriptorAuthority(plannedDescriptor, this.#registry);
      const binding = bindings.get(key);
      if (!binding) {
        skippedUnboundModels.push(modelReference(plannedDescriptor));
        continue;
      }
      selected.push({ descriptor, binding });
    }
    if (selected.length === 0) {
      throw new TypeError('MatterCouplingScheduler: dependency plan contains no bound model');
    }

    let working = cloneStrictJson(beforeState, '$.matterCoupling.beforeState');
    const claims = [];
    const invalidations = new Set();
    const external = new ExternalDeltaAccumulator();
    const modelReceipts = [];

    for (const { descriptor, binding } of selected) {
      const key = modelKey(descriptor.id, descriptor.version);
      const currentState = createMatterState(working);
      let result;
      try {
        result = this.#registry.evaluate(binding, {
          state: currentState,
          definition,
          interaction,
          changedPaths,
        });
      } catch (error) {
        throw new TypeError(`MatterCouplingScheduler: model '${key}' evaluation failed: ${error.message}`, { cause: error });
      }
      if (result.status !== 'applied') {
        const diagnostics = result.diagnostics.length > 0 ? `: ${result.diagnostics.join('; ')}` : '';
        throw new TypeError(`MatterCouplingScheduler: model '${key}' is unsupported${diagnostics}`);
      }

      for (const mutation of result.mutations) {
        assertNoMutationConflict(claims, mutation.path, key);
      }
      for (const path of result.invalidatedPaths) invalidations.add(path);
      external.add(result.externalDelta, key);

      try {
        working = cloneStrictJson(applyMatterModelResult(working, result, {
          advanceRevision: false,
        }), '$.matterCoupling.intermediateState');
      } catch (error) {
        throw new TypeError(`MatterCouplingScheduler: model '${key}' produced invalid state: ${error.message}`, { cause: error });
      }
      modelReceipts.push({
        modelId: descriptor.id,
        modelVersion: descriptor.version,
        status: result.status,
        mutations: result.mutations,
        externalDelta: result.externalDelta,
        invalidatedPaths: [...result.invalidatedPaths].sort(),
        diagnostics: result.diagnostics,
      });
    }

    working.revision = beforeState.revision + 1;
    const afterState = createMatterState(working);
    const externalDelta = external.value();
    const conservationLedger = createMatterConservationLedger({
      beforeStates: [beforeState],
      afterStates: [afterState],
      externalDelta,
      tolerance,
    });
    try {
      assertMatterConservation(conservationLedger);
    } catch (error) {
      throw new RangeError(`MatterCouplingScheduler: conservation imbalance: ${error.message}`, { cause: error });
    }

    return cloneAndFreezeStrictJson({
      schema: MATTER_COUPLING_SCHEDULE_SCHEMA,
      schemaVersion: MATTER_COUPLING_SCHEDULE_VERSION,
      status: 'applied',
      eventId: interaction.eventId,
      regionId: beforeState.regionId,
      definitionId: definition.id,
      definitionHash,
      changedPaths,
      plannedModels: graphPlan.map(modelReference),
      skippedUnboundModels,
      modelReceipts,
      invalidatedPaths: [...invalidations].sort(),
      externalDelta,
      beforeState,
      afterState,
      conservationLedger,
    }, '$.matterCouplingSchedule');
  }
}

export default MatterCouplingScheduler;
