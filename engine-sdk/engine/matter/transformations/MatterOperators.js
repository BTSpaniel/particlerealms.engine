// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  createMatterState,
  MATTER_FIDELITY_LEVELS,
  MATTER_REPRESENTATIONS,
  replaceMatterConserved as replaceConserved,
  replaceMatterConservedPacked,
  snapshotMatterNumericArray as copyTransferArray,
  snapshotMatterStates,
  snapshotMatterState,
  validateMatterState,
} from '../contracts/MatterContracts.js';
import {
  assertMatterConservation,
  createMatterConservationLedger,
  MATTER_CONSERVATION_DEFAULT_TOLERANCE,
} from '../state/MatterConservationLedger.js';
import {
  cloneAndFreezeStrictJson,
  cloneStrictJson,
  isPlainJsonObject,
} from '../../core/schema/StrictJsonValue.js';
import { compensatedSum } from '../../core/math/RobustNumericMath.js';

export const MATTER_MUTATION_EVENT_SCHEMA = 'engine.matter-mutation-event';
export const MATTER_MUTATION_EVENT_VERSION = '1.0.0';

function fail(path, message) {
  throw new TypeError(`${path}: ${message}`);
}

function finite(value, path, { minimum = -Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    fail(path, `must be finite and >= ${minimum}`);
  }
  return value;
}

function identifier(value, path) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512
      || /[\u0000-\u001f\u007f]/.test(value)) {
    fail(path, 'must be a non-empty bounded control-free string');
  }
  return value;
}

function vector3(value, path) {
  if (!Array.isArray(value) || value.length !== 3) fail(path, 'must be a 3-vector');
  return value.map((component, index) => finite(component, `${path}[${index}]`));
}

function totalMass(state) {
  return Object.values(state.conserved.speciesMassKg).reduce((sum, value) => sum + value, 0);
}

function zeroExternalDelta() {
  return {
    speciesMassKg: {},
    momentumKgMPerS: [0, 0, 0],
    internalEnergyJ: 0,
    electricChargeC: 0,
  };
}

function createEvent({ eventId, type, parentRegionIds, daughterRegionIds, details = {} }) {
  return cloneAndFreezeStrictJson({
    schema: MATTER_MUTATION_EVENT_SCHEMA,
    schemaVersion: MATTER_MUTATION_EVENT_VERSION,
    eventId: identifier(eventId, '$.eventId'),
    type,
    parentRegionIds: [...parentRegionIds],
    daughterRegionIds: [...daughterRegionIds],
    details,
  }, '$.matterMutationEvent');
}

function finishOperation({ event, beforeStates, afterStates, externalDelta = zeroExternalDelta(), energyRoundoff = null }) {
  const before = snapshotMatterStates(beforeStates, '$.beforeStates');
  const after = snapshotMatterStates(afterStates, '$.afterStates');
  const ledger = createMatterConservationLedger({ beforeStates: before, afterStates: after, externalDelta, energyRoundoff });
  try { assertMatterConservation(ledger); } catch (error) {
    error.matterOperation = Object.freeze({ event, beforeStates: before, afterStates: after, ledger });
    throw error;
  }
  // Event and ledger were constructed here as immutable strict JSON. Sharing
  // canonical states avoids repeatedly cloning the same retained inventories.
  return Object.freeze({
    schema: 'engine.matter-operation-result',
    schemaVersion: '1.0.0',
    event,
    beforeStates: before,
    afterStates: after,
    externalDelta: cloneAndFreezeStrictJson(externalDelta, '$.externalDelta'),
    ledger,
  });
}

function checkedTransferInventory(inventory, available, path = '$.inventory') {
  const safeInventory = cloneStrictJson(inventory, path);
  if (!isPlainJsonObject(safeInventory)) fail(path, 'must be a plain object');
  for (const key of Object.keys(safeInventory)) {
    if (!['speciesMassKg', 'momentumKgMPerS', 'internalEnergyJ', 'electricChargeC'].includes(key)) {
      fail(`${path}.${key}`, 'unknown field');
    }
  }
  if (!isPlainJsonObject(safeInventory.speciesMassKg)) fail(`${path}.speciesMassKg`, 'must be an object');
  const speciesTransfers = {};
  let positiveMass = false;
  for (const [speciesId, amount] of Object.entries(safeInventory.speciesMassKg)) {
    identifier(speciesId, `${path}.speciesMassKg key`);
    finite(amount, `${path}.speciesMassKg.${speciesId}`, { minimum: 0 });
    const availableMass = available.speciesMassKg[speciesId] ?? 0;
    if (amount > availableMass) fail(`${path}.speciesMassKg.${speciesId}`, `exceeds available mass ${availableMass}`);
    speciesTransfers[speciesId] = amount;
    positiveMass ||= amount > 0;
  }
  if (!positiveMass) fail(`${path}.speciesMassKg`, 'must transfer positive mass');
  const momentum = vector3(safeInventory.momentumKgMPerS, `${path}.momentumKgMPerS`);
  const internalEnergyJ = finite(safeInventory.internalEnergyJ, `${path}.internalEnergyJ`, { minimum: 0 });
  if (internalEnergyJ > available.internalEnergyJ) {
    fail(`${path}.internalEnergyJ`, 'exceeds available internal energy');
  }
  const electricChargeC = finite(safeInventory.electricChargeC, `${path}.electricChargeC`);

  return { safeInventory, speciesTransfers, momentum, internalEnergyJ, electricChargeC };
}

function snapshotPackedTransfers(input) {
  const path = '$.packedTransfers', keys = ['speciesIds', 'sourceIndices', 'targetIndices', 'quantities'];
  if (!isPlainJsonObject(input)) fail(path, 'must be a plain object');
  const fields = {};
  for (const key of Reflect.ownKeys(input)) {
    if (!keys.includes(key)) fail(path, 'contains an unknown field');
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail(`${path}.${key}`, 'must be an enumerable data property');
    fields[key] = descriptor.value;
  }
  const speciesIds = cloneStrictJson(fields.speciesIds, `${path}.speciesIds`);
  if (!Array.isArray(speciesIds) || !speciesIds.length) fail(`${path}.speciesIds`, 'must contain species identifiers');
  const seen = new Set();
  for (const id of speciesIds) {
    identifier(id, `${path}.speciesIds`);
    if (seen.has(id)) fail(`${path}.speciesIds`, 'must contain unique identifiers');
    seen.add(id);
  }
  // Species become record keys at commit; apply the same forbidden-key
  // admission as the existing object inventory before looking up a donor.
  cloneStrictJson(Object.fromEntries(speciesIds.map(id => [id, 0])), `${path}.speciesMassKg`);
  const sourceIndices = copyTransferArray(fields.sourceIndices, Uint32Array, `${path}.sourceIndices`);
  const targetIndices = copyTransferArray(fields.targetIndices, Uint32Array, `${path}.targetIndices`);
  const quantities = copyTransferArray(fields.quantities, Float64Array, `${path}.quantities`);
  const stride = speciesIds.length + 5;
  if (!sourceIndices.length || targetIndices.length !== sourceIndices.length || quantities.length !== sourceIndices.length * stride) fail(path, 'has inconsistent row dimensions');
  return { speciesIds, sourceIndices, targetIndices, quantities, stride };
}

function transferSpecies(source, target, speciesId, amount, path) {
  finite(amount, path, { minimum: 0 });
  const available = source.available.speciesMassKg[speciesId] ?? 0;
  if (amount > available) fail(path, `exceeds available mass ${available}`);
  source.available.speciesMassKg[speciesId] = available - amount;
  source.conserved.speciesMassKg[speciesId] = (source.conserved.speciesMassKg[speciesId] ?? 0) - amount;
  target.conserved.speciesMassKg[speciesId] = (target.conserved.speciesMassKg[speciesId] ?? 0) + amount;
  target.incomingSpeciesMassKg[speciesId] = (target.incomingSpeciesMassKg[speciesId] ?? 0) + amount;
}

function transferDynamics(source, target, x, y, z, internalEnergyJ, electricChargeC, path) {
  finite(x, `${path}.momentumX`); finite(y, `${path}.momentumY`); finite(z, `${path}.momentumZ`);
  finite(internalEnergyJ, `${path}.internalEnergyJ`, { minimum: 0 }); finite(electricChargeC, `${path}.electricChargeC`);
  if (internalEnergyJ > source.available.internalEnergyJ) fail(`${path}.internalEnergyJ`, 'exceeds available internal energy');
  source.available.internalEnergyJ -= internalEnergyJ;
  source.energyTerms.push(-internalEnergyJ); target.energyTerms.push(internalEnergyJ);
  source.conserved.momentumKgMPerS[0] -= x; target.conserved.momentumKgMPerS[0] += x;
  source.conserved.momentumKgMPerS[1] -= y; target.conserved.momentumKgMPerS[1] += y;
  source.conserved.momentumKgMPerS[2] -= z; target.conserved.momentumKgMPerS[2] += z;
  source.conserved.electricChargeC -= electricChargeC; target.conserved.electricChargeC += electricChargeC;
  source.touched = true; target.touched = true;
}

/** Transfer an explicit conserved inventory between two regions. */
export function transferMatterInventory({ sourceState, targetState, inventory, eventId, energyRoundoff = null }) {
  sourceState = snapshotMatterState(sourceState, '$.sourceState');
  targetState = snapshotMatterState(targetState, '$.targetState');
  if (sourceState.regionId === targetState.regionId) fail('$.targetState.regionId', 'must differ from source');
  const { safeInventory, speciesTransfers, momentum, internalEnergyJ, electricChargeC } = checkedTransferInventory(inventory, sourceState.conserved);

  // Admission above supplies immutable, validated numeric inventories.
  // Copy only lanes this operation changes; raw callers still cross the
  // complete state schema and cannot retain mutable receipt descendants.
  const sourceConserved = { ...sourceState.conserved, speciesMassKg: { ...sourceState.conserved.speciesMassKg },
    momentumKgMPerS: [...sourceState.conserved.momentumKgMPerS] };
  const targetConserved = { ...targetState.conserved, speciesMassKg: { ...targetState.conserved.speciesMassKg },
    momentumKgMPerS: [...targetState.conserved.momentumKgMPerS] };
  for (const [speciesId, amount] of Object.entries(speciesTransfers)) {
    sourceConserved.speciesMassKg[speciesId] -= amount;
    targetConserved.speciesMassKg[speciesId] = (targetConserved.speciesMassKg[speciesId] ?? 0) + amount;
  }
  sourceConserved.momentumKgMPerS = sourceConserved.momentumKgMPerS
    .map((component, index) => component - momentum[index]);
  targetConserved.momentumKgMPerS = targetConserved.momentumKgMPerS
    .map((component, index) => component + momentum[index]);
  sourceConserved.internalEnergyJ -= internalEnergyJ;
  targetConserved.internalEnergyJ += internalEnergyJ;
  sourceConserved.electricChargeC -= electricChargeC;
  targetConserved.electricChargeC += electricChargeC;

  const dirty = { dirtyPaths: ['fields', 'mechanics', 'structure', 'environment'] };
  const nextSource = replaceConserved(sourceState, sourceConserved, { derived: dirty });
  const nextTarget = replaceConserved(targetState, targetConserved, { derived: dirty });
  const event = createEvent({
    eventId,
    type: 'inventory-transfer',
    parentRegionIds: [sourceState.regionId, targetState.regionId],
    daughterRegionIds: [nextSource.regionId, nextTarget.regionId],
    details: { inventory: safeInventory },
  });
  return finishOperation({
    event,
    beforeStates: [sourceState, targetState],
    afterStates: [nextSource, nextTarget],
    energyRoundoff,
  });
}

/** Atomically transfer a batch against the original donor inventories.
 * Incoming material cannot fund another outgoing edge in the same batch.
 * The immutable candidate and shared conservation receipt are built once per
 * region, rather than reconstructing all ownership evidence for every edge.
 * packedTransfers is an alternative numeric ABI: source/target Uint32 indices
 * address states; each Float64 row contains species masses in speciesIds order,
 * momentum x/y/z, internal energy and charge. Its receipt retains JSON arrays. */
export function transferMatterInventories({ states, transfers, packedTransfers, eventId, energyRoundoff = null }) {
  if (!Array.isArray(states) || states.length === 0) fail('$.states', 'must contain matter states');
  if ((transfers === undefined) === (packedTransfers === undefined)) fail('$.transfers', 'supply exactly one transfer representation');
  if (packedTransfers === undefined && (!Array.isArray(transfers) || transfers.length === 0)) fail('$.transfers', 'must contain inventory transfers');
  states = snapshotMatterStates(states, '$.states');
  identifier(eventId, '$.eventId');
  const packed = packedTransfers === undefined ? null : snapshotPackedTransfers(packedTransfers);
  const batch = packed ? null : cloneStrictJson(transfers, '$.transfers');
  const regions = new Map();
  for (let index = 0; index < states.length; index += 1) {
    const state = states[index];
    validateMatterState(state, `$.states[${index}]`);
    if (regions.has(state.regionId)) fail(`$.states[${index}].regionId`, 'duplicates a batch region');
    regions.set(state.regionId, {
      state,
      // State admission above already establishes an immutable, finite
      // conserved record. Copy its numeric lanes directly for the candidate.
      conserved: { ...state.conserved, speciesMassKg: { ...state.conserved.speciesMassKg }, momentumKgMPerS: [...state.conserved.momentumKgMPerS] },
      available: { speciesMassKg: { ...state.conserved.speciesMassKg }, internalEnergyJ: state.conserved.internalEnergyJ },
      incomingSpeciesMassKg: {},
      energyTerms: [state.conserved.internalEnergyJ],
      touched: false,
    });
  }
  const safeTransfers = [], regionList = [...regions.values()];
  if (packed) for (let index = 0; index < packed.sourceIndices.length; index += 1) {
    const path = `$.packedTransfers[${index}]`, sourceIndex = packed.sourceIndices[index], targetIndex = packed.targetIndices[index];
    if (sourceIndex === targetIndex) fail(path, 'source and target must differ');
    const source = regionList[sourceIndex], target = regionList[targetIndex];
    if (!source || !target) fail(path, 'source and target must belong to the supplied states');
    let positiveMass = false;
    const offset = index * packed.stride, values = packed.quantities, speciesCount = packed.speciesIds.length;
    for (let lane = 0; lane < speciesCount; lane += 1) {
      const amount = values[offset + lane];
      // Zero lanes are absent transfers, not new zero-mass species records.
      if (amount !== 0) transferSpecies(source, target, packed.speciesIds[lane], amount, `${path}.speciesMassKg[${lane}]`);
      positiveMass ||= amount > 0;
    }
    if (!positiveMass) fail(path, 'must transfer positive mass');
    transferDynamics(source, target, values[offset + speciesCount], values[offset + speciesCount + 1], values[offset + speciesCount + 2],
      values[offset + speciesCount + 3], values[offset + speciesCount + 4], path);
  }
  else for (let index = 0; index < batch.length; index += 1) {
    const input = batch[index], path = `$.transfers[${index}]`;
    if (!isPlainJsonObject(input)) fail(path, 'must be a plain object');
    for (const key of Object.keys(input)) {
      if (!['sourceRegionId', 'targetRegionId', 'inventory'].includes(key)) fail(`${path}.${key}`, 'unknown field');
    }
    const sourceId = identifier(input.sourceRegionId, `${path}.sourceRegionId`);
    const targetId = identifier(input.targetRegionId, `${path}.targetRegionId`);
    if (sourceId === targetId) fail(`${path}.targetRegionId`, 'must differ from source');
    const source = regions.get(sourceId), target = regions.get(targetId);
    if (!source || !target) fail(path, 'source and target must belong to the supplied states');
    const { safeInventory, speciesTransfers, momentum, internalEnergyJ, electricChargeC }
      = checkedTransferInventory(input.inventory, source.available, `${path}.inventory`);
    for (const [speciesId, amount] of Object.entries(speciesTransfers)) {
      transferSpecies(source, target, speciesId, amount, `${path}.inventory.speciesMassKg.${speciesId}`);
    }
    transferDynamics(source, target, ...momentum, internalEnergyJ, electricChargeC, `${path}.inventory`);
    safeTransfers.push({ sourceRegionId: sourceId, targetRegionId: targetId, inventory: safeInventory });
  }
  const dirty = { dirtyPaths: ['fields', 'mechanics', 'structure', 'environment'] };
  const changed = [];
  let afterStates = regionList.map((region, index) => {
    if (!region.touched) return region.state;
    // A small incoming inventory must survive depletion of a much larger
    // original donor. Adding it before subtracting the donor loses the trace
    // mass through cancellation even though every outgoing edge was bounded.
    for (const id of Object.keys(region.conserved.speciesMassKg)) region.conserved.speciesMassKg[id]
      = (region.available.speciesMassKg[id] ?? 0) + (region.incomingSpeciesMassKg[id] ?? 0);
    const energy = compensatedSum(region.energyTerms).sum;
    // Each donor withdrawal was already bounded above. At exact depletion,
    // compensated re-evaluation can expose a negative sub-tolerance residue
    // from the input float representation. Zero is its admissible endpoint;
    // the unchanged global conservation ledger still verifies the result.
    region.conserved.internalEnergyJ = energy < 0 && energy >= -MATTER_CONSERVATION_DEFAULT_TOLERANCE ? 0 : energy;
    if (packed) { changed.push({ region, index }); return region.state; }
    return replaceConserved(region.state, region.conserved, { derived: dirty });
  });
  if (packed) {
    const speciesIds = [], speciesSlots = new Map(), offsets = new Uint32Array(changed.length + 1);
    let speciesCount = 0;
    const entries = changed.map(({ region }, row) => {
      const rowEntries = Object.entries(region.conserved.speciesMassKg); offsets[row] = speciesCount; speciesCount += rowEntries.length;
      for (const [id] of rowEntries) if (!speciesSlots.has(id)) { speciesSlots.set(id, speciesIds.length); speciesIds.push(id); }
      return rowEntries;
    });
    offsets[changed.length] = speciesCount;
    const speciesIndices = new Uint32Array(speciesCount), speciesMassKg = new Float64Array(speciesCount), dynamics = new Float64Array(changed.length * 5);
    for (let row = 0; row < changed.length; row++) {
      const conserved = changed[row].region.conserved;
      entries[row].forEach(([id, mass], index) => { const lane = offsets[row] + index; speciesIndices[lane] = speciesSlots.get(id); speciesMassKg[lane] = mass; });
      dynamics.set(conserved.momentumKgMPerS, row * 5); dynamics[row * 5 + 3] = conserved.internalEnergyJ; dynamics[row * 5 + 4] = conserved.electricChargeC;
    }
    const allTouched = changed.length === states.length;
    const candidates = replaceMatterConservedPacked(allTouched ? states : changed.map(({ region }) => region.state),
      { speciesIds, speciesOffsets: offsets, speciesIndices, speciesMassKg, dynamics }, { derived: dirty });
    if (allTouched) afterStates = candidates;
    else changed.forEach(({ index }, row) => { afterStates[index] = candidates[row]; });
  }
  let event;
  if (packed) {
    // Every lane was copied and checked above. Convert once to immutable JSON
    // evidence without another descriptor walk over every numeric element.
    const evidence = Object.freeze({ speciesIds: Object.freeze(packed.speciesIds), sourceIndices: Object.freeze(Array.from(packed.sourceIndices)),
      targetIndices: Object.freeze(Array.from(packed.targetIndices)), quantities: Object.freeze(Array.from(packed.quantities)) });
    // These IDs come only from admitted immutable states, and eventId was
    // validated before the batch. Keep separate arrays in the original order.
    event = Object.freeze({
      schema: MATTER_MUTATION_EVENT_SCHEMA, schemaVersion: MATTER_MUTATION_EVENT_VERSION,
      eventId, type: 'inventory-transfer-batch',
      parentRegionIds: Object.freeze(states.map(state => state.regionId)),
      daughterRegionIds: Object.freeze(afterStates.map(state => state.regionId)),
      details: Object.freeze({ packedTransfers: evidence }),
    });
  } else event = createEvent({
    eventId,
    type: 'inventory-transfer-batch',
    parentRegionIds: states.map(state => state.regionId),
    daughterRegionIds: afterStates.map(state => state.regionId),
    details: { transfers: safeTransfers },
  });
  return finishOperation({ event, beforeStates: states, afterStates, energyRoundoff });
}

/** Apply an explicitly sourced energy input without inferring temperature. */
export function addMatterEnergy({ state, energyJ, eventId }) {
  validateMatterState(state, '$.state');
  finite(energyJ, '$.energyJ');
  if (state.conserved.internalEnergyJ + energyJ < 0) fail('$.energyJ', 'would make internal energy negative');
  const conserved = cloneStrictJson(state.conserved, '$.state.conserved');
  conserved.internalEnergyJ += energyJ;
  const next = replaceConserved(state, conserved, {
    derived: { dirtyPaths: ['fields.temperatureK', 'fields.phaseFractions', 'mechanics', 'structure'] },
  });
  const event = createEvent({
    eventId,
    type: 'external-energy',
    parentRegionIds: [state.regionId],
    daughterRegionIds: [next.regionId],
    details: { energyJ },
  });
  return finishOperation({
    event,
    beforeStates: [state],
    afterStates: [next],
    externalDelta: { ...zeroExternalDelta(), internalEnergyJ: energyJ },
  });
}

/** Apply an explicitly supplied external impulse. */
export function addMatterImpulse({ state, impulseKgMPerS, eventId }) {
  validateMatterState(state, '$.state');
  const impulse = vector3(impulseKgMPerS, '$.impulseKgMPerS');
  const conserved = cloneStrictJson(state.conserved, '$.state.conserved');
  conserved.momentumKgMPerS = conserved.momentumKgMPerS
    .map((component, index) => component + impulse[index]);
  const next = replaceConserved(state, conserved, {
    derived: { dirtyPaths: ['mechanics', 'structure'] },
  });
  const event = createEvent({
    eventId,
    type: 'external-impulse',
    parentRegionIds: [state.regionId],
    daughterRegionIds: [next.regionId],
    details: { impulseKgMPerS: impulse },
  });
  return finishOperation({
    event,
    beforeStates: [state],
    afterStates: [next],
    externalDelta: { ...zeroExternalDelta(), momentumKgMPerS: impulse },
  });
}

function requireRepresentation(value, path) {
  if (!isPlainJsonObject(value)) fail(path, 'must be an object');
  for (const key of Object.keys(value)) {
    if (!['kind', 'fidelityLevel', 'backendId'].includes(key)) fail(`${path}.${key}`, 'unknown field');
  }
  if (!MATTER_REPRESENTATIONS.includes(value.kind)) fail(`${path}.kind`, 'is unsupported');
  if (!MATTER_FIDELITY_LEVELS.includes(value.fidelityLevel)) fail(`${path}.fidelityLevel`, 'is unsupported');
  identifier(value.backendId, `${path}.backendId`);
  return value;
}

/** Change only the numerical/solver representation; physical inventory is identical. */
export function transitionMatterRepresentation({ state, representation, eventId }) {
  validateMatterState(state, '$.state');
  const safeRepresentation = cloneStrictJson(representation, '$.representation');
  requireRepresentation(safeRepresentation, '$.representation');
  const input = cloneStrictJson(state, '$.state');
  input.revision += 1;
  input.representation = safeRepresentation;
  input.derived = { dirtyPaths: ['fields', 'mechanics', 'structure', 'environment'] };
  const next = createMatterState(input);
  const event = createEvent({
    eventId,
    type: 'representation-transition',
    parentRegionIds: [state.regionId],
    daughterRegionIds: [next.regionId],
    details: { from: state.representation, to: safeRepresentation },
  });
  return finishOperation({ event, beforeStates: [state], afterStates: [next] });
}

function scaledConserved(parent, fraction, previous, isLast) {
  const result = {
    speciesMassKg: {},
    momentumKgMPerS: [0, 0, 0],
    internalEnergyJ: 0,
    electricChargeC: 0,
  };
  for (const [speciesId, amount] of Object.entries(parent.speciesMassKg)) {
    result.speciesMassKg[speciesId] = isLast
      ? amount - previous.reduce((sum, entry) => sum + entry.speciesMassKg[speciesId], 0)
      : amount * fraction;
  }
  result.momentumKgMPerS = parent.momentumKgMPerS.map((component, index) => (
    isLast
      ? component - previous.reduce((sum, entry) => sum + entry.momentumKgMPerS[index], 0)
      : component * fraction
  ));
  result.internalEnergyJ = isLast
    ? parent.internalEnergyJ - previous.reduce((sum, entry) => sum + entry.internalEnergyJ, 0)
    : parent.internalEnergyJ * fraction;
  result.electricChargeC = isLast
    ? parent.electricChargeC - previous.reduce((sum, entry) => sum + entry.electricChargeC, 0)
    : parent.electricChargeC * fraction;
  return result;
}

/**
 * Split one region into explicitly described daughters. No fracture criterion,
 * fragment count, or representation is guessed by this operator.
 */
export function splitMatterRegion({ parentState, daughters, eventId }) {
  validateMatterState(parentState, '$.parentState');
  const safeDaughters = cloneStrictJson(daughters, '$.daughters');
  if (!Array.isArray(safeDaughters) || safeDaughters.length < 2) fail('$.daughters', 'must contain at least two daughters');
  const ids = new Set();
  let fractionSum = 0;
  for (const [index, daughter] of safeDaughters.entries()) {
    const at = `$.daughters[${index}]`;
    if (!isPlainJsonObject(daughter)) fail(at, 'must be an object');
    for (const key of Object.keys(daughter)) {
      if (!['regionId', 'fraction', 'representation', 'fields'].includes(key)) fail(`${at}.${key}`, 'unknown field');
    }
    identifier(daughter.regionId, `${at}.regionId`);
    if (ids.has(daughter.regionId) || daughter.regionId === parentState.regionId) fail(`${at}.regionId`, 'must be unique');
    ids.add(daughter.regionId);
    fractionSum += finite(daughter.fraction, `${at}.fraction`, { minimum: Number.MIN_VALUE });
    requireRepresentation(daughter.representation, `${at}.representation`);
    if (daughter.fields != null) cloneStrictJson(daughter.fields, `${at}.fields`);
  }
  if (Math.abs(fractionSum - 1) > 1e-12) fail('$.daughters', 'fractions must sum to one');

  const conservedParts = [];
  const nextStates = safeDaughters.map((daughter, index) => {
    const conserved = scaledConserved(
      parentState.conserved,
      daughter.fraction,
      conservedParts,
      index === safeDaughters.length - 1,
    );
    conservedParts.push(conserved);
    return createMatterState({
      schema: parentState.schema,
      schemaVersion: parentState.schemaVersion,
      regionId: daughter.regionId,
      definitionId: parentState.definitionId,
      definitionHash: parentState.definitionHash,
      revision: 0,
      representation: cloneStrictJson(daughter.representation, `$.daughters[${index}].representation`),
      ancestry: {
        rootRegionId: parentState.ancestry.rootRegionId,
        parentRegionId: parentState.regionId,
        eventId,
        generation: parentState.ancestry.generation + 1,
      },
      conserved,
      ...(daughter.fields == null ? {} : { fields: cloneStrictJson(daughter.fields, `$.daughters[${index}].fields`) }),
      derived: { dirtyPaths: ['fields', 'mechanics', 'structure', 'environment'] },
    });
  });
  const event = createEvent({
    eventId,
    type: 'topology-split',
    parentRegionIds: [parentState.regionId],
    daughterRegionIds: nextStates.map(state => state.regionId),
    details: {
      fractions: safeDaughters.map(daughter => ({ regionId: daughter.regionId, fraction: daughter.fraction })),
      parentMassKg: totalMass(parentState),
    },
  });
  return finishOperation({ event, beforeStates: [parentState], afterStates: nextStates });
}
