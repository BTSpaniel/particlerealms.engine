// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  GROWTH_LIMITS,
  GROWTH_PROGRAM_IDS,
  compareGrowthIds,
  failGrowth,
  freezeGrowthJson,
  normalizeGrowthVector3,
  requireGrowthIdentifier,
  requireGrowthInteger,
  requireGrowthNumber,
  validateGrowthStepTiming,
} from '../GrowthContracts.js';
import { evaluateGrowthSegment, normalizeGrowthEnvironment } from '../GrowthEnvironment.js';
import {
  GrowthRngStreams,
  deriveGrowthEntityId,
  deriveGrowthLineage,
  restoreGrowthRngStreams,
} from '../GrowthLineageRng.js';
import {
  commitGrowthStep,
  createGrowthBudgetStall,
  createInitialGrowthState,
  growthVectorAdd,
  growthVectorDistance,
  growthVectorNormalize,
  growthVectorScale,
  growthVectorSubtract,
  hashGrowthState,
  normalizeGrowthState,
  restoreGrowthState,
  snapshotGrowthState,
} from '../GrowthState.js';

const PROGRAM_VERSION = 1;

function cellKey(position, size) {
  return `${Math.floor(position[0] / size)},${Math.floor(position[1] / size)},${Math.floor(position[2] / size)}`;
}

function buildBudGrid(buds, size) {
  const grid = new Map();
  for (const bud of buds.filter(entry => entry.state === 'active').sort((a, b) => compareGrowthIds(a.lineage, b.lineage))) {
    const key = cellKey(bud.position, size);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(bud);
  }
  return grid;
}

function nearbyBuds(grid, position, size) {
  const base = position.map(value => Math.floor(value / size));
  const candidates = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        const bucket = grid.get(`${base[0] + x},${base[1] + y},${base[2] + z}`);
        if (bucket) candidates.push(...bucket);
      }
    }
  }
  return candidates;
}

function normalizeAttractors(input, streams, options) {
  if (input !== undefined) {
    if (!Array.isArray(input) || input.length > GROWTH_LIMITS.MAX_ATTRACTORS) {
      failGrowth('GROWTH_ATTRACTOR_LIMIT', `Attractors must be an array of at most ${GROWTH_LIMITS.MAX_ATTRACTORS}`);
    }
    const seen = new Set();
    return input.map((entry, index) => {
      const id = requireGrowthIdentifier(entry.id ?? `attractor.${String(index).padStart(6, '0')}`, `attractors[${index}].id`);
      if (seen.has(id)) failGrowth('GROWTH_DUPLICATE_ATTRACTOR', `Duplicate attractor '${id}'`);
      seen.add(id);
      return {
        id,
        position: [...normalizeGrowthVector3(entry.position, `attractors[${index}].position`)],
        active: entry.active !== false,
      };
    }).sort((left, right) => compareGrowthIds(left.id, right.id));
  }
  const attractors = [];
  for (let index = 0; index < options.attractorCount; index++) {
    const purpose = `attractor-${index}`;
    const rng = streams.stream('root', purpose);
    const angle = rng.nextFloat() * Math.PI * 2;
    const radial = Math.sqrt(rng.nextFloat()) * options.crownRadius;
    const height = options.initialLength + rng.nextFloat() * options.crownHeight;
    attractors.push({
      id: `attractor.${String(index).padStart(6, '0')}`,
      position: [Math.cos(angle) * radial, height, Math.sin(angle) * radial],
      active: true,
    });
  }
  return attractors;
}

export class SpaceColonizationProgram {
  constructor(options = {}) {
    this.id = GROWTH_PROGRAM_IDS.SPACE_COLONIZATION;
    this.version = PROGRAM_VERSION;
    this.label = 'Incremental space colonization';
    this.options = freezeGrowthJson({
      initialLength: requireGrowthNumber(options.initialLength ?? 0.35, 'space colonization initialLength', { strictlyPositive: true }),
      segmentLength: requireGrowthNumber(options.segmentLength ?? 0.28, 'space colonization segmentLength', { strictlyPositive: true }),
      initialRadius: requireGrowthNumber(options.initialRadius ?? 0.045, 'space colonization initialRadius', { strictlyPositive: true }),
      attractorCount: requireGrowthInteger(options.attractorCount ?? 384, 'space colonization attractorCount', { minimum: 1, maximum: GROWTH_LIMITS.MAX_ATTRACTORS }),
      crownRadius: requireGrowthNumber(options.crownRadius ?? 3, 'space colonization crownRadius', { strictlyPositive: true }),
      crownHeight: requireGrowthNumber(options.crownHeight ?? 5, 'space colonization crownHeight', { strictlyPositive: true }),
      influenceRadius: requireGrowthNumber(options.influenceRadius ?? 1.25, 'space colonization influenceRadius', { strictlyPositive: true }),
      killDistance: requireGrowthNumber(options.killDistance ?? 0.32, 'space colonization killDistance', { strictlyPositive: true }),
      maxNewPerTick: requireGrowthInteger(options.maxNewPerTick ?? 32, 'space colonization maxNewPerTick', { minimum: 1, maximum: 128 }),
    }, '$.spaceColonizationOptions');
    if (this.options.killDistance >= this.options.influenceRadius) {
      failGrowth('GROWTH_COLONIZATION_RADII', 'Space-colonization killDistance must be smaller than influenceRadius');
    }
  }

  initialize(definition = {}, seedOverride = undefined) {
    const assetId = requireGrowthIdentifier(definition.assetId ?? 'growth.colonization.asset', 'assetId');
    const seed = requireGrowthInteger(seedOverride ?? definition.seed ?? 0, 'seed', { maximum: 0xffffffff });
    const environment = normalizeGrowthEnvironment(definition.environment ?? {});
    const origin = [...normalizeGrowthVector3(definition.origin, 'origin', [0, 0, 0])];
    const streams = new GrowthRngStreams({ assetSeed: seed, programId: this.id, programVersion: this.version });
    const attractors = normalizeAttractors(definition.attractors, streams, this.options);
    const rootLineage = deriveGrowthLineage(null, 'root', 0);
    const rootId = deriveGrowthEntityId('branch', rootLineage);
    const end = growthVectorAdd(origin, growthVectorScale([0, 1, 0], this.options.initialLength));
    const budLineage = deriveGrowthLineage(rootLineage, 'bud', 0);
    return createInitialGrowthState({
      assetId,
      seed,
      programId: this.id,
      programVersion: this.version,
      environmentRevision: environment.revision,
      season: environment.season,
      branches: [{
        id: rootId,
        lineage: rootLineage,
        parentId: null,
        kind: 'branch',
        start: origin,
        end,
        radius: this.options.initialRadius,
        age: 0,
        vigor: 1,
        resource: 0,
        active: true,
      }],
      buds: [{
        id: deriveGrowthEntityId('bud', budLineage),
        lineage: budLineage,
        parentId: rootId,
        position: end,
        direction: [0, 1, 0],
        age: 0,
        vigor: 1,
        resource: 0,
        state: 'active',
        nextOrdinal: 0,
      }],
      rngStreams: streams.snapshot(),
      programState: { environment, attractors, completed: false },
    });
  }

  step(stateInput, input = {}, budget = {}) {
    const state = this.restore(stateInput);
    validateGrowthStepTiming(state, input);
    const draft = JSON.parse(JSON.stringify(state));
    delete draft.stateHash;
    const environment = normalizeGrowthEnvironment(input.environment ?? draft.programState.environment);
    draft.programState.environment = environment;
    draft.environmentRevision = environment.revision;
    draft.season = environment.season;
    const streams = restoreGrowthRngStreams(state);
    const activeBuds = state.buds.filter(bud => bud.state === 'active');
    const grid = buildBudGrid(activeBuds, this.options.influenceRadius);
    const assignments = new Map();
    const remainingAttractors = [];
    for (const attractor of state.programState.attractors) {
      if (!attractor.active) continue;
      let nearest = null;
      let nearestDistance = Infinity;
      for (const bud of nearbyBuds(grid, attractor.position, this.options.influenceRadius)) {
        const distance = growthVectorDistance(attractor.position, bud.position);
        if (distance < nearestDistance || (distance === nearestDistance && nearest && compareGrowthIds(bud.lineage, nearest.lineage) < 0)) {
          nearest = bud;
          nearestDistance = distance;
        }
      }
      if (nearest && nearestDistance <= this.options.killDistance) continue;
      remainingAttractors.push(attractor);
      if (nearest && nearestDistance <= this.options.influenceRadius) {
        if (!assignments.has(nearest.id)) assignments.set(nearest.id, []);
        assignments.get(nearest.id).push(attractor);
      }
    }
    // Before the crown enters the influence radius, extend the lexically stable
    // leading tip toward its nearest attractor. This is the trunk phase of the
    // space-colonization algorithm, not a completion condition.
    if (assignments.size === 0 && remainingAttractors.length > 0 && activeBuds.length > 0) {
      const leader = [...activeBuds].sort((left, right) => right.position[1] - left.position[1]
        || compareGrowthIds(left.lineage, right.lineage))[0];
      let nearest = remainingAttractors[0];
      let nearestDistance = growthVectorDistance(leader.position, nearest.position);
      for (let index = 1; index < remainingAttractors.length; index++) {
        const candidate = remainingAttractors[index];
        const distance = growthVectorDistance(leader.position, candidate.position);
        if (distance < nearestDistance || (distance === nearestDistance && compareGrowthIds(candidate.id, nearest.id) < 0)) {
          nearest = candidate;
          nearestDistance = distance;
        }
      }
      assignments.set(leader.id, [nearest]);
    }
    draft.programState.attractors = remainingAttractors;
    const maximum = Math.min(
      this.options.maxNewPerTick,
      requireGrowthInteger(budget.maxNewEntities ?? GROWTH_LIMITS.MAX_NEW_ENTITIES_PER_TICK, 'budget.maxNewEntities', {
        minimum: 0,
        maximum: GROWTH_LIMITS.MAX_NEW_ENTITIES_PER_TICK,
      }),
      GROWTH_LIMITS.MAX_BRANCHES - state.branches.length,
    );
    const requested = assignments.size * 2;
    if (maximum === 0 && requested > 0) {
      return createGrowthBudgetStall(state, {
        requested,
        programId: this.id,
        telemetry: { activeAttractors: state.programState.attractors.length, assignedBuds: assignments.size },
      });
    }
    const branchById = new Map(state.branches.map(branch => [branch.id, branch]));
    const draftBudById = new Map(draft.buds.map(bud => [bud.id, bud]));
    const competitors = state.leaves.map(leaf => ({ id: leaf.id, position: leaf.position, radius: leaf.size }));
    const events = [];
    let created = 0;
    for (const bud of activeBuds.sort((a, b) => compareGrowthIds(a.lineage, b.lineage))) {
      if (created + 2 > maximum) break;
      const attracted = assignments.get(bud.id);
      if (!attracted || attracted.length === 0) continue;
      let direction = [0, 0, 0];
      for (const attractor of attracted.sort((a, b) => compareGrowthIds(a.id, b.id))) {
        direction = growthVectorAdd(direction, growthVectorNormalize(growthVectorSubtract(attractor.position, bud.position)));
      }
      const jitter = streams.stream(bud.lineage, `colonization-${bud.nextOrdinal}`);
      direction = growthVectorNormalize(growthVectorAdd(direction, [
        jitter.nextSignedFloat() * 0.04,
        jitter.nextSignedFloat() * 0.02,
        jitter.nextSignedFloat() * 0.04,
      ]), bud.direction);
      const evaluated = evaluateGrowthSegment(environment, {
        start: bud.position,
        direction,
        length: this.options.segmentLength,
        radius: Math.max(0.002, branchById.get(bud.parentId)?.radius * 0.94),
        kind: 'branch',
        competitors,
      });
      if (!evaluated.allowed) {
        events.push({ type: 'growth.obstacle-rejected', id: bud.id, lineage: bud.lineage, details: { obstacleId: evaluated.obstacle.obstacleId } });
        continue;
      }
      const parent = branchById.get(bud.parentId);
      if (!parent) failGrowth('GROWTH_COLONIZATION_PARENT', `Bud ${bud.id} has no parent branch`);
      const lineage = deriveGrowthLineage(parent.lineage, 'branch', bud.nextOrdinal);
      const branchId = deriveGrowthEntityId('branch', lineage);
      const radius = Math.max(0.002, parent.radius * 0.94);
      draft.branches.push({
        id: branchId,
        lineage,
        parentId: parent.id,
        kind: 'branch',
        start: bud.position,
        end: evaluated.end,
        radius,
        age: 0,
        vigor: Math.min(2, evaluated.light.intensity),
        resource: evaluated.resources.water + evaluated.resources.nutrients,
        active: true,
      });
      const mutableBud = draftBudById.get(bud.id);
      mutableBud.nextOrdinal += 1;
      mutableBud.age += 1;
      const childBudLineage = deriveGrowthLineage(lineage, 'bud', 0);
      const childBud = {
        id: deriveGrowthEntityId('bud', childBudLineage),
        lineage: childBudLineage,
        parentId: branchId,
        position: evaluated.end,
        direction: evaluated.direction,
        age: 0,
        vigor: Math.min(2, evaluated.light.intensity),
        resource: evaluated.resources.water + evaluated.resources.nutrients,
        state: 'active',
        nextOrdinal: 0,
      };
      draft.buds.push(childBud);
      draftBudById.set(childBud.id, childBud);
      branchById.set(branchId, draft.branches[draft.branches.length - 1]);
      created += 2;
    }
    const completed = remainingAttractors.length === 0 || (assignments.size === 0 && created === 0);
    const retained = Math.max(0, requested - created);
    if (retained > 0) events.push({ type: 'growth.budget-limited', details: { requested, committed: created, retained, unit: 'entities' } });
    if (completed && !draft.programState.completed) events.push({ type: 'growth.completed', details: { programId: this.id } });
    draft.programState.completed = completed;
    draft.rngStreams = streams.snapshot();
    const committed = commitGrowthStep(state, draft, { reason: 'space-colonization', events });
    return Object.freeze({
      ...committed,
      events: committed.patch.events,
      telemetry: freezeGrowthJson({
        programId: this.id,
        tick: committed.state.tick,
        activeAttractors: remainingAttractors.length,
        assignedBuds: assignments.size,
        branches: committed.state.branches.length,
        buds: committed.state.buds.length,
        created,
        completed,
        requested,
        committed: created,
        retained,
        backlog: retained,
      }, '$.colonizationTelemetry'),
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

export function createSpaceColonizationProgram(options) {
  return new SpaceColonizationProgram(options);
}
