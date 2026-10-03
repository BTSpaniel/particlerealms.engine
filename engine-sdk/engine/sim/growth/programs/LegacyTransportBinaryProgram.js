// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  ProceduralTreeGenerator,
  TREE_SPECIES,
} from '../../../world/generation/ProceduralTreeGenerator.js';
import {
  GROWTH_LIMITS,
  GROWTH_PROGRAM_IDS,
  failGrowth,
  freezeGrowthJson,
  requireGrowthIdentifier,
  requireGrowthInteger,
  requireGrowthNumber,
  validateGrowthStepTiming,
} from '../GrowthContracts.js';
import { normalizeGrowthEnvironment } from '../GrowthEnvironment.js';
import { deriveGrowthEntityId, deriveGrowthLineage } from '../GrowthLineageRng.js';
import {
  commitGrowthStep,
  createGrowthBudgetStall,
  createInitialGrowthState,
  hashGrowthState,
  normalizeGrowthState,
  restoreGrowthState,
  snapshotGrowthState,
} from '../GrowthState.js';

const PROGRAM_VERSION = 1;
const VALID_SPECIES = new Set(Object.values(TREE_SPECIES));

function canonicalizeLegacyTree(tree) {
  if (!tree || !Array.isArray(tree.branches) || tree.branches.length === 0) {
    failGrowth('GROWTH_LEGACY_EMPTY', 'Legacy tree generator did not produce a branch hierarchy');
  }
  const branches = [];
  const leaves = [];
  function visit(branch, parentRecord, childOrdinal) {
    if (!branch || typeof branch !== 'object') return;
    const length = Number(branch.length);
    if (!Number.isFinite(length) || length <= 1e-6) return;
    const lineage = parentRecord === null
      ? deriveGrowthLineage(null, 'root', 0)
      : deriveGrowthLineage(parentRecord.lineage, 'branch', childOrdinal);
    const id = deriveGrowthEntityId('branch', lineage);
    const start = [...branch.position];
    const end = typeof branch.getEndPosition === 'function'
      ? [...branch.getEndPosition()]
      : start.map((value, axis) => value + branch.direction[axis] * length);
    const record = {
      id,
      lineage,
      parentId: parentRecord?.id ?? null,
      kind: 'branch',
      start,
      end,
      radius: Math.max(0.001, Number(branch.radius) || 0.001),
      age: 0,
      vigor: 1,
      resource: 0,
      active: true,
    };
    branches.push(record);
    if (branch.isLeaf === true) {
      const leafLineage = deriveGrowthLineage(lineage, 'leaf', 0);
      leaves.push({
        id: deriveGrowthEntityId('leaf', leafLineage),
        lineage: leafLineage,
        parentId: id,
        position: end,
        normal: branch.direction,
        size: Math.max(0.025, Math.min(4, Number(branch.radius || 0.1) * 4)),
        age: 0,
        health: 1,
        active: true,
      });
    }
    visit(branch.childA, record, 0);
    visit(branch.childB, record, 1);
  }
  visit(tree.branches[0], null, 0);
  if (branches.length > GROWTH_LIMITS.MAX_BRANCHES || leaves.length > GROWTH_LIMITS.MAX_LEAVES) {
    failGrowth('GROWTH_LEGACY_LIMIT', 'Legacy tree exceeds growth entity limits before activation', {
      branches: branches.length,
      leaves: leaves.length,
    });
  }
  return freezeGrowthJson({ branches, leaves }, '$.legacyCanonicalTree');
}

export class LegacyTransportBinaryProgram {
  constructor(options = {}) {
    this.id = GROWTH_PROGRAM_IDS.LEGACY_TRANSPORT_BINARY;
    this.version = PROGRAM_VERSION;
    this.label = 'Legacy transport binary';
    this.options = freezeGrowthJson({
      species: requireGrowthInteger(options.species ?? TREE_SPECIES.OAK, 'legacy species', { maximum: 7 }),
      growthIterations: requireGrowthInteger(options.growthIterations ?? 50, 'legacy growthIterations', { minimum: 1, maximum: 256 }),
      nutrientRate: requireGrowthNumber(options.nutrientRate ?? 2, 'legacy nutrientRate', { strictlyPositive: true }),
      revealPerTick: requireGrowthInteger(options.revealPerTick ?? 64, 'legacy revealPerTick', {
        minimum: 1,
        maximum: GROWTH_LIMITS.MAX_NEW_ENTITIES_PER_TICK,
      }),
    }, '$.legacyOptions');
    if (!VALID_SPECIES.has(this.options.species)) failGrowth('GROWTH_LEGACY_SPECIES', `Unsupported legacy species ${this.options.species}`);
  }

  initialize(definition = {}, seedOverride = undefined) {
    const assetId = requireGrowthIdentifier(definition.assetId ?? 'growth.legacy.asset', 'assetId');
    const seed = requireGrowthInteger(seedOverride ?? definition.seed ?? 0, 'seed', { maximum: 0xffffffff });
    const environment = normalizeGrowthEnvironment(definition.environment ?? {});
    const position = Array.isArray(definition.position) ? definition.position : [0, 0, 0];
    if (position.length !== 3 || position.some(value => !Number.isFinite(Number(value)))) {
      failGrowth('GROWTH_LEGACY_POSITION', 'Legacy tree position must contain three finite numbers');
    }
    const species = definition.species === undefined
      ? this.options.species
      : requireGrowthInteger(definition.species, 'legacy species', { maximum: 7 });
    if (!VALID_SPECIES.has(species)) failGrowth('GROWTH_LEGACY_SPECIES', `Unsupported legacy species ${species}`);
    const generator = new ProceduralTreeGenerator({
      defaultSpecies: species,
      growthIterations: this.options.growthIterations,
      nutrientRate: this.options.nutrientRate,
    });
    // The live legacy hierarchy and its closure RNG never cross this call.
    const canonicalTree = canonicalizeLegacyTree(generator.generateTree(
      Number(position[0]), Number(position[1]), Number(position[2]), species, seed,
    ));
    return createInitialGrowthState({
      assetId,
      seed,
      programId: this.id,
      programVersion: this.version,
      environmentRevision: environment.revision,
      season: environment.season,
      programState: {
        species,
        branchCursor: 0,
        leafCursor: 0,
        canonicalBranches: canonicalTree.branches,
        canonicalLeaves: canonicalTree.leaves,
        completed: false,
      },
    });
  }

  step(stateInput, input = {}, budget = {}) {
    const state = this.restore(stateInput);
    validateGrowthStepTiming(state, input);
    const requested = (state.programState.canonicalBranches.length - state.programState.branchCursor)
      + (state.programState.canonicalLeaves.length - state.programState.leafCursor);
    const maximum = Math.min(
      this.options.revealPerTick,
      requireGrowthInteger(budget.maxNewEntities ?? GROWTH_LIMITS.MAX_NEW_ENTITIES_PER_TICK, 'budget.maxNewEntities', {
        minimum: 0,
        maximum: GROWTH_LIMITS.MAX_NEW_ENTITIES_PER_TICK,
      }),
    );
    if (maximum === 0 && requested > 0) {
      return createGrowthBudgetStall(state, { requested, programId: this.id, telemetry: { completed: false } });
    }
    const draft = JSON.parse(JSON.stringify(state));
    delete draft.stateHash;
    const programState = draft.programState;
    let remaining = maximum;
    while (remaining > 0 && programState.branchCursor < programState.canonicalBranches.length) {
      draft.branches.push(programState.canonicalBranches[programState.branchCursor]);
      programState.branchCursor += 1;
      remaining -= 1;
    }
    const visibleBranches = new Set(draft.branches.map(branch => branch.id));
    while (remaining > 0 && programState.leafCursor < programState.canonicalLeaves.length) {
      const leaf = programState.canonicalLeaves[programState.leafCursor];
      if (!visibleBranches.has(leaf.parentId)) break;
      draft.leaves.push(leaf);
      programState.leafCursor += 1;
      remaining -= 1;
    }
    const completed = programState.branchCursor === programState.canonicalBranches.length
      && programState.leafCursor === programState.canonicalLeaves.length;
    const events = [];
    const committedCount = maximum - remaining;
    const retained = Math.max(0, requested - committedCount);
    if (retained > 0) events.push({ type: 'growth.budget-limited', details: { requested, committed: committedCount, retained, unit: 'entities' } });
    if (completed && !programState.completed) events.push({ type: 'growth.completed', details: { programId: this.id } });
    programState.completed = completed;
    draft.environmentRevision = input.environment
      ? normalizeGrowthEnvironment(input.environment).revision
      : state.environmentRevision;
    const committed = commitGrowthStep(state, draft, { reason: 'legacy-reveal', events });
    return Object.freeze({
      ...committed,
      events: committed.patch.events,
      telemetry: freezeGrowthJson({
        programId: this.id,
        tick: committed.state.tick,
        revealedBranches: committed.state.branches.length,
        totalBranches: programState.canonicalBranches.length,
        revealedLeaves: committed.state.leaves.length,
        totalLeaves: programState.canonicalLeaves.length,
        completed,
        requested,
        committed: committedCount,
        retained,
        backlog: retained,
      }, '$.legacyTelemetry'),
    });
  }

  snapshot(state) { return snapshotGrowthState(this.assertStateIdentity(state)); }
  restore(snapshot) { return this.assertStateIdentity(restoreGrowthState(snapshot)); }
  hash(state) { return hashGrowthState(this.assertStateIdentity(state)); }

  assertStateIdentity(stateInput) {
    const state = normalizeGrowthState(stateInput);
    if (state.program.id !== this.id || state.program.version !== this.version) {
      failGrowth('GROWTH_PROGRAM_STATE_IDENTITY', `State does not belong to ${this.id} v${this.version}`);
    }
    return state;
  }
}

export function createLegacyTransportBinaryProgram(options) {
  return new LegacyTransportBinaryProgram(options);
}
