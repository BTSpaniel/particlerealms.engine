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
import {
  evaluateGrowthSegment,
  normalizeGrowthEnvironment,
  sampleGrowthLight,
  sampleGrowthResources,
} from '../GrowthEnvironment.js';
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
  growthVectorCross,
  growthVectorNormalize,
  growthVectorScale,
  hashGrowthState,
  normalizeGrowthState,
  restoreGrowthState,
  snapshotGrowthState,
} from '../GrowthState.js';

const PROGRAM_VERSION = 1;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function targetIndex(state) {
  return new Map([
    ...state.branches.map(entity => [entity.id, { entity, kind: 'branch' }]),
    ...state.roots.map(entity => [entity.id, { entity, kind: 'root' }]),
    ...state.buds.map(entity => [entity.id, { entity, kind: 'bud' }]),
    ...state.leaves.map(entity => [entity.id, { entity, kind: 'leaf' }]),
    ...state.fruits.map(entity => [entity.id, { entity, kind: 'fruit' }]),
  ]);
}

function pruneTarget(draft, target) {
  const removed = new Set();
  if (target.kind === 'branch') {
    const lineage = target.entity.lineage;
    draft.branches = draft.branches.filter(entity => {
      const remove = entity.lineage === lineage || entity.lineage.startsWith(`${lineage}/`);
      if (remove) removed.add(entity.id);
      return !remove;
    });
  } else if (target.kind === 'root') {
    const lineage = target.entity.lineage;
    draft.roots = draft.roots.filter(entity => {
      const remove = entity.lineage === lineage || entity.lineage.startsWith(`${lineage}/`);
      if (remove) removed.add(entity.id);
      return !remove;
    });
  } else {
    removed.add(target.entity.id);
    const collection = target.kind === 'leaf' ? 'leaves' : `${target.kind}s`;
    draft[collection] = draft[collection].filter(entity => entity.id !== target.entity.id);
  }
  if (removed.size > 0) {
    draft.buds = draft.buds.filter(entity => !removed.has(entity.parentId) && !removed.has(entity.id));
    draft.leaves = draft.leaves.filter(entity => !removed.has(entity.parentId) && !removed.has(entity.id));
    draft.fruits = draft.fruits.filter(entity => !removed.has(entity.parentId) && !removed.has(entity.id));
    draft.damage = draft.damage.map(entity => removed.has(entity.targetId) ? { ...entity, active: false } : entity);
  }
  return [...removed].sort(compareGrowthIds);
}

function phyllotacticDirection(direction, ordinal, branchiness) {
  const forward = growthVectorNormalize(direction);
  const reference = Math.abs(forward[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const right = growthVectorNormalize(growthVectorCross(forward, reference), [1, 0, 0]);
  const up = growthVectorNormalize(growthVectorCross(right, forward), [0, 0, 1]);
  const angle = ordinal * GOLDEN_ANGLE;
  const lateral = growthVectorAdd(growthVectorScale(right, Math.cos(angle)), growthVectorScale(up, Math.sin(angle)));
  return growthVectorNormalize(growthVectorAdd(forward, growthVectorScale(lateral, branchiness)), forward);
}

function applyPipeRule(segments, tipRadius, exponent, scale) {
  const byId = new Map(segments.map(segment => [segment.id, segment]));
  const sorted = [...segments].sort((left, right) => right.order - left.order || compareGrowthIds(right.lineage, left.lineage));
  for (const segment of sorted) {
    const children = segment.children.map(id => byId.get(id)).filter(Boolean);
    const area = children.length === 0
      ? tipRadius ** exponent
      : children.reduce((sum, child) => sum + child.radius ** exponent, 0);
    segment.radius = Math.max(tipRadius, area ** (1 / exponent) * scale);
  }
}

function normalizedDamageRequests(input) {
  const requests = [];
  if (input.prune !== undefined) {
    if (!Array.isArray(input.prune)) failGrowth('GROWTH_PRUNE_INPUT', 'step input.prune must be an array of target IDs');
    for (const targetId of input.prune) requests.push({ targetId, severity: 1, mode: 'prune' });
  }
  if (input.damage !== undefined) {
    if (!Array.isArray(input.damage)) failGrowth('GROWTH_DAMAGE_INPUT', 'step input.damage must be an array');
    for (const entry of input.damage) {
      if (!entry || typeof entry !== 'object') failGrowth('GROWTH_DAMAGE_INPUT', 'Damage requests must be objects');
      requests.push({
        targetId: entry.targetId,
        severity: requireGrowthNumber(entry.severity ?? 1, 'damage severity', { minimum: 0, maximum: 1 }),
        mode: String(entry.mode ?? 'scar'),
      });
    }
  }
  return requests;
}

function normalizeBranchLoads(input, state, failureThreshold) {
  if (input.branchLoads === undefined) return [];
  if (!input.branchLoads || typeof input.branchLoads !== 'object' || Array.isArray(input.branchLoads)) {
    failGrowth('GROWTH_BRANCH_LOADS', 'step input.branchLoads must be an object keyed by stable branch lineage');
  }
  const byLineage = new Map(state.branches.map(branch => [branch.lineage, branch]));
  return Object.keys(input.branchLoads).sort(compareGrowthIds).map(lineage => {
    const branch = byLineage.get(lineage);
    if (!branch) failGrowth('GROWTH_BRANCH_LOAD_TARGET', `Loaded branch lineage '${lineage}' does not exist`);
    const entry = input.branchLoads[lineage];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) failGrowth('GROWTH_BRANCH_LOAD', `Branch load '${lineage}' must be an object`);
    if (entry.lineageId !== undefined && entry.lineageId !== lineage) {
      failGrowth('GROWTH_BRANCH_LOAD_LINEAGE', `Branch load key '${lineage}' disagrees with projection lineageId '${entry.lineageId}'`);
    }
    const force = [...normalizeGrowthVector3(
      entry.forceNewtons ?? entry.forceVector ?? entry.force ?? [0, 0, 0],
      `branchLoads.${lineage}.forceNewtons`,
    )];
    const magnitude = requireGrowthNumber(
      entry.loadNewtons ?? entry.magnitude ?? Math.hypot(...force),
      `branchLoads.${lineage}.loadNewtons`,
      { minimum: 0 },
    );
    const area = Math.PI * branch.radius * branch.radius;
    const stress = magnitude / Math.max(area, 1e-8);
    return {
      lineage,
      branchId: branch.id,
      endpoint: branch.end,
      force,
      magnitude,
      stress,
      failed: stress >= failureThreshold,
    };
  });
}

export class SelfOrganizingHybridProgram {
  constructor(options = {}) {
    this.id = GROWTH_PROGRAM_IDS.SELF_ORGANIZING_HYBRID;
    this.version = PROGRAM_VERSION;
    this.label = 'Self-organizing hybrid';
    this.options = freezeGrowthJson({
      initialLength: requireGrowthNumber(options.initialLength ?? 0.32, 'hybrid initialLength', { strictlyPositive: true }),
      segmentLength: requireGrowthNumber(options.segmentLength ?? 0.24, 'hybrid segmentLength', { strictlyPositive: true }),
      tipRadius: requireGrowthNumber(options.tipRadius ?? 0.012, 'hybrid tipRadius', { strictlyPositive: true }),
      initialRadius: requireGrowthNumber(options.initialRadius ?? 0.05, 'hybrid initialRadius', { strictlyPositive: true }),
      branchiness: requireGrowthNumber(options.branchiness ?? 0.42, 'hybrid branchiness', { minimum: 0, maximum: 2 }),
      apicalDominance: requireGrowthNumber(options.apicalDominance ?? 0.7, 'hybrid apicalDominance', { minimum: 0, maximum: 1 }),
      minimumAllocation: requireGrowthNumber(options.minimumAllocation ?? 0.08, 'hybrid minimumAllocation', { minimum: 0 }),
      pipeExponent: requireGrowthNumber(options.pipeExponent ?? 2, 'hybrid pipeExponent', { minimum: 1, maximum: 4 }),
      pipeScale: requireGrowthNumber(options.pipeScale ?? 1, 'hybrid pipeScale', { minimum: 0.5, maximum: 2 }),
      rootTipCount: requireGrowthInteger(options.rootTipCount ?? 4, 'hybrid rootTipCount', { minimum: 1, maximum: 16 }),
      maxNewPerTick: requireGrowthInteger(options.maxNewPerTick ?? 48, 'hybrid maxNewPerTick', { minimum: 1, maximum: 128 }),
      pruneSeverity: requireGrowthNumber(options.pruneSeverity ?? 0.75, 'hybrid pruneSeverity', { minimum: 0, maximum: 1 }),
      loadFailureThreshold: requireGrowthNumber(options.loadFailureThreshold ?? 20_000, 'hybrid loadFailureThreshold', { strictlyPositive: true }),
      loadVigorScale: requireGrowthNumber(options.loadVigorScale ?? 0.00002, 'hybrid loadVigorScale', { minimum: 0 }),
    }, '$.hybridOptions');
  }

  initialize(definition = {}, seedOverride = undefined) {
    const assetId = requireGrowthIdentifier(definition.assetId ?? 'growth.hybrid.asset', 'assetId');
    const seed = requireGrowthInteger(seedOverride ?? definition.seed ?? 0, 'seed', { maximum: 0xffffffff });
    const environment = normalizeGrowthEnvironment(definition.environment ?? {});
    const origin = Array.isArray(definition.origin) ? definition.origin : [0, 0, 0];
    const streams = new GrowthRngStreams({ assetSeed: seed, programId: this.id, programVersion: this.version });
    const rootLineage = deriveGrowthLineage(null, 'root', 0);
    const branchId = deriveGrowthEntityId('branch', rootLineage);
    const end = growthVectorAdd(origin, growthVectorScale([0, 1, 0], this.options.initialLength));
    const budLineage = deriveGrowthLineage(rootLineage, 'bud', 0);
    const rootTips = [];
    for (let index = 0; index < this.options.rootTipCount; index++) {
      const angle = index / this.options.rootTipCount * Math.PI * 2;
      rootTips.push({
        parentId: null,
        parentLineage: rootLineage,
        nextOrdinal: 1_000 + index,
        position: origin,
        direction: growthVectorNormalize([Math.cos(angle) * 0.55, -1, Math.sin(angle) * 0.55]),
        radius: this.options.tipRadius,
      });
    }
    return createInitialGrowthState({
      assetId,
      seed,
      programId: this.id,
      programVersion: this.version,
      environmentRevision: environment.revision,
      season: environment.season,
      branches: [{
        id: branchId, lineage: rootLineage, parentId: null, kind: 'branch', start: origin, end,
        radius: this.options.initialRadius, age: 0, vigor: 1, resource: 0, active: true,
      }],
      buds: [{
        id: deriveGrowthEntityId('bud', budLineage), lineage: budLineage, parentId: branchId,
        position: end, direction: [0, 1, 0], age: 0, vigor: 1, resource: 0,
        state: 'active', nextOrdinal: 0,
      }],
      rngStreams: streams.snapshot(),
      programState: {
        environment,
        rootTips,
        nextDamageOrdinal: 0,
        lastSeason: environment.season.name,
      },
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
    const maximum = Math.min(
      this.options.maxNewPerTick,
      requireGrowthInteger(budget.maxNewEntities ?? GROWTH_LIMITS.MAX_NEW_ENTITIES_PER_TICK, 'budget.maxNewEntities', {
        minimum: 0,
        maximum: GROWTH_LIMITS.MAX_NEW_ENTITIES_PER_TICK,
      }),
    );
    const branchLoadResponses = normalizeBranchLoads(input, state, this.options.loadFailureThreshold);
    const damageRequests = normalizedDamageRequests(input);
    for (const response of branchLoadResponses) {
      if (response.failed) damageRequests.push({ targetId: response.branchId, severity: 1, mode: 'break' });
    }
    const initiallyRequested = damageRequests.length
      + state.buds.filter(bud => bud.state === 'active').length * 2
      + (state.programState.rootTips?.length ?? 0);
    if (maximum === 0 && initiallyRequested > 0) {
      return createGrowthBudgetStall(state, {
        requested: initiallyRequested,
        programId: this.id,
        telemetry: { branchLoadResponses },
      });
    }
    if (damageRequests.length > maximum) {
      failGrowth('GROWTH_DAMAGE_BUDGET', 'Damage requests exceed the tick entity budget; none were applied', {
        requests: damageRequests.length,
        maximum,
      });
    }
    const streams = restoreGrowthRngStreams(state);
    const events = [];
    let created = 0;
    const loadedDraftBranches = new Map(draft.branches.map(branch => [branch.id, branch]));
    for (const response of branchLoadResponses) {
      const branch = loadedDraftBranches.get(response.branchId);
      if (branch && !response.failed) {
        branch.vigor = Math.max(0, branch.vigor - response.stress * this.options.loadVigorScale);
      }
    }
    const targets = targetIndex(state);
    for (const request of damageRequests) {
      const targetId = requireGrowthIdentifier(request.targetId, 'damage targetId');
      const target = targets.get(targetId);
      if (!target) failGrowth('GROWTH_DAMAGE_TARGET', `Damage target '${targetId}' does not exist`);
      if (!['break', 'disease', 'fire', 'prune', 'scar'].includes(request.mode)) {
        failGrowth('GROWTH_DAMAGE_MODE', `Unsupported damage mode '${request.mode}'`);
      }
      const ordinal = 50_000 + draft.programState.nextDamageOrdinal++;
      const lineage = deriveGrowthLineage(target.entity.lineage, 'damage', ordinal);
      const destructive = request.mode === 'prune' || request.mode === 'break' || request.severity >= this.options.pruneSeverity;
      const removed = destructive ? pruneTarget(draft, target) : [];
      draft.damage.push({
        id: deriveGrowthEntityId('damage', lineage),
        lineage,
        targetId,
        targetKind: target.kind,
        severity: request.severity,
        mode: request.mode,
        tick: state.tick + 1,
        active: !destructive,
      });
      events.push({ type: 'growth.damage-applied', lineage, targetId, details: { mode: request.mode, severity: request.severity } });
      if (removed.length > 0) events.push({
        type: 'growth.pruned',
        lineage: target.entity.lineage,
        targetId,
        details: { removedCount: removed.length, removedIds: removed.slice(0, 64) },
      });
      created += 1;
    }
    if (draft.programState.lastSeason !== environment.season.name) {
      events.push({ type: 'growth.season-changed', details: { from: draft.programState.lastSeason, to: environment.season.name } });
      draft.programState.lastSeason = environment.season.name;
    }
    if (environment.season.leafFactor < 1) {
      draft.leaves = draft.leaves.filter(leaf => {
        const rng = streams.stream(leaf.lineage, `season-${environment.season.year}-${environment.season.name}`);
        return rng.nextFloat() <= environment.season.leafFactor;
      });
    }
    draft.fruits = draft.fruits
      .map(fruit => ({ ...fruit, age: fruit.age + 1, ripeness: Math.min(1, fruit.ripeness + (environment.season.name === 'summer' ? 0.08 : 0.02)) }))
      .filter(fruit => !(environment.season.name === 'autumn' && fruit.ripeness >= 1));

    const liveBranchIds = new Set(draft.branches.map(branch => branch.id));
    draft.buds = draft.buds.filter(bud => liveBranchIds.has(bud.parentId));
    const branchById = new Map(draft.branches.map(branch => [branch.id, branch]));
    const competitors = draft.buds.map(bud => ({ id: bud.id, position: bud.position, radius: 0.2 }))
      .concat(draft.leaves.map(leaf => ({ id: leaf.id, position: leaf.position, radius: leaf.size })));
    const candidates = draft.buds.filter(bud => bud.state === 'active').map(bud => {
      const light = sampleGrowthLight(environment, bud.position, { competitors: competitors.filter(entry => entry.id !== bud.id) });
      const resources = sampleGrowthResources(environment, bud.position);
      const score = Math.max(0, light.intensity * (resources.water + resources.nutrients) * bud.vigor * environment.season.growthFactor);
      return { bud, light, resources, score };
    }).sort((left, right) => right.score - left.score || compareGrowthIds(left.bud.lineage, right.bud.lineage));
    const totalScore = candidates.reduce((sum, candidate) => sum + candidate.score, 0);
    const requested = damageRequests.length + candidates.length * 2 + draft.programState.rootTips.length;
    const supplied = input.resources ?? {};
    const carbonPool = requireGrowthNumber(supplied.carbon ?? state.resources.carbon + environment.season.growthFactor, 'resources.carbon', { minimum: 0 });
    const waterPool = requireGrowthNumber(supplied.water ?? state.resources.water + environment.baseResources.water, 'resources.water', { minimum: 0 });
    const nutrientPool = requireGrowthNumber(supplied.nutrients ?? state.resources.nutrients + environment.baseResources.nutrients, 'resources.nutrients', { minimum: 0 });
    let consumedCarbon = 0;
    let consumedWater = 0;
    let consumedNutrients = 0;
    const draftBudById = new Map(draft.buds.map(bud => [bud.id, bud]));
    for (const candidate of candidates) {
      if (created + 2 > maximum || draft.branches.length >= GROWTH_LIMITS.MAX_BRANCHES) break;
      const allocation = totalScore > 0 ? carbonPool * candidate.score / totalScore : 0;
      if (allocation < this.options.minimumAllocation) continue;
      const bud = draftBudById.get(candidate.bud.id);
      if (!bud) continue;
      const parent = branchById.get(bud.parentId);
      if (!parent) continue;
      const lineage = deriveGrowthLineage(parent.lineage, 'branch', bud.nextOrdinal);
      const baseDirection = phyllotacticDirection(bud.direction, bud.nextOrdinal, this.options.branchiness * (1 - this.options.apicalDominance * 0.5));
      const rng = streams.stream(lineage, 'hybrid-direction');
      const desired = growthVectorNormalize(growthVectorAdd(baseDirection, [
        rng.nextSignedFloat() * 0.04,
        rng.nextSignedFloat() * 0.02,
        rng.nextSignedFloat() * 0.04,
      ]), baseDirection);
      const evaluated = evaluateGrowthSegment(environment, {
        start: bud.position,
        direction: desired,
        length: this.options.segmentLength * Math.max(0.25, Math.min(1.5, allocation)),
        radius: this.options.tipRadius,
        kind: 'branch',
        competitors,
      });
      if (!evaluated.allowed) {
        events.push({ type: 'growth.obstacle-rejected', id: bud.id, lineage: bud.lineage, details: { obstacleId: evaluated.obstacle.obstacleId } });
        continue;
      }
      const id = deriveGrowthEntityId('branch', lineage);
      const branch = {
        id, lineage, parentId: parent.id, kind: 'branch', start: bud.position, end: evaluated.end,
        radius: this.options.tipRadius, age: 0, vigor: Math.min(2, candidate.score),
        resource: allocation, active: true,
      };
      draft.branches.push(branch);
      branchById.set(id, branch);
      bud.nextOrdinal += 1;
      bud.age += 1;
      bud.vigor = Math.max(0.05, bud.vigor * this.options.apicalDominance);
      bud.resource = allocation;
      const childBudLineage = deriveGrowthLineage(lineage, 'bud', 0);
      const childBud = {
        id: deriveGrowthEntityId('bud', childBudLineage), lineage: childBudLineage, parentId: id,
        position: evaluated.end, direction: evaluated.direction, age: 0, vigor: Math.min(2, candidate.score),
        resource: allocation, state: 'active', nextOrdinal: 0,
      };
      draft.buds.push(childBud);
      draftBudById.set(childBud.id, childBud);
      created += 2;
      consumedCarbon += allocation;
      consumedWater += Math.min(Math.max(0, waterPool - consumedWater), allocation * 0.5);
      consumedNutrients += Math.min(Math.max(0, nutrientPool - consumedNutrients), allocation * 0.25);
      if (parent.order >= 2 && environment.season.leafFactor > 0.1 && created < maximum) {
        const leafLineage = deriveGrowthLineage(lineage, 'leaf', 10_000);
        draft.leaves.push({
          id: deriveGrowthEntityId('leaf', leafLineage), lineage: leafLineage, parentId: id,
          position: evaluated.end, normal: evaluated.direction, size: 0.1 * environment.season.leafFactor,
          age: 0, health: 1, active: true,
        });
        created += 1;
      }
      if (parent.order >= 3 && environment.season.name === 'summer' && created < maximum
          && streams.stream(lineage, 'fruit-set').nextFloat() < 0.08) {
        const fruitLineage = deriveGrowthLineage(lineage, 'fruit', 20_000);
        draft.fruits.push({
          id: deriveGrowthEntityId('fruit', fruitLineage), lineage: fruitLineage, parentId: id,
          position: evaluated.end, size: 0.06, age: 0, ripeness: 0, health: 1, active: true,
        });
        created += 1;
      }
    }

    for (const tip of draft.programState.rootTips.sort((left, right) => compareGrowthIds(`${left.parentLineage}/${left.nextOrdinal}`, `${right.parentLineage}/${right.nextOrdinal}`))) {
      if (created >= maximum || draft.roots.length >= GROWTH_LIMITS.MAX_ROOTS) break;
      const lineage = deriveGrowthLineage(tip.parentLineage, 'root', tip.nextOrdinal);
      const evaluated = evaluateGrowthSegment(environment, {
        start: tip.position,
        direction: tip.direction,
        length: this.options.segmentLength * 0.8,
        radius: tip.radius,
        kind: 'root',
      });
      if (!evaluated.allowed) {
        events.push({ type: 'growth.obstacle-rejected', lineage, details: { obstacleId: evaluated.obstacle.obstacleId } });
        continue;
      }
      const id = deriveGrowthEntityId('root', lineage);
      draft.roots.push({
        id, lineage, parentId: tip.parentId, kind: 'root', start: tip.position, end: evaluated.end,
        radius: tip.radius, age: 0, vigor: 1, resource: evaluated.resources.water + evaluated.resources.nutrients,
        active: true,
      });
      tip.parentId = id;
      tip.parentLineage = lineage;
      tip.nextOrdinal = 0;
      tip.position = evaluated.end;
      tip.direction = evaluated.direction;
      tip.radius = Math.max(this.options.tipRadius * 0.5, tip.radius * 0.96);
      consumedWater += Math.min(Math.max(0, waterPool - consumedWater), 0.02);
      consumedNutrients += Math.min(Math.max(0, nutrientPool - consumedNutrients), 0.01);
      created += 1;
    }

    draft.resources = {
      carbon: Math.max(0, carbonPool - consumedCarbon),
      water: Math.max(0, waterPool - consumedWater),
      nutrients: Math.max(0, nutrientPool - consumedNutrients),
    };

    // Rebuild temporary child lists before applying the declared pipe-area rule.
    const branchChildren = new Map(draft.branches.map(branch => [branch.id, []]));
    for (const branch of draft.branches) if (branch.parentId && branchChildren.has(branch.parentId)) branchChildren.get(branch.parentId).push(branch.id);
    for (const branch of draft.branches) branch.children = branchChildren.get(branch.id).sort(compareGrowthIds);
    applyPipeRule(draft.branches, this.options.tipRadius, this.options.pipeExponent, this.options.pipeScale);
    const rootChildren = new Map(draft.roots.map(root => [root.id, []]));
    for (const root of draft.roots) if (root.parentId && rootChildren.has(root.parentId)) rootChildren.get(root.parentId).push(root.id);
    for (const root of draft.roots) root.children = rootChildren.get(root.id).sort(compareGrowthIds);
    applyPipeRule(draft.roots, this.options.tipRadius * 0.5, this.options.pipeExponent, this.options.pipeScale);

    const retained = Math.max(0, requested - created);
    if (retained > 0 && created >= maximum) {
      events.push({ type: 'growth.budget-limited', details: { requested, committed: created, retained, unit: 'entities' } });
    }
    draft.rngStreams = streams.snapshot();
    const committed = commitGrowthStep(state, draft, { reason: 'self-organizing-hybrid', events });
    return Object.freeze({
      ...committed,
      events: committed.patch.events,
      telemetry: freezeGrowthJson({
        programId: this.id,
        tick: committed.state.tick,
        branches: committed.state.branches.length,
        roots: committed.state.roots.length,
        buds: committed.state.buds.length,
        leaves: committed.state.leaves.length,
        fruits: committed.state.fruits.length,
        activeDamage: committed.state.damage.filter(entry => entry.active).length,
        candidateBuds: candidates.length,
        lightCompetitionTotal: totalScore,
        created,
        resources: committed.state.resources,
        season: committed.state.season.name,
        branchLoadResponses,
        requested,
        committed: created,
        retained,
        backlog: retained,
      }, '$.hybridTelemetry'),
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

export function createSelfOrganizingHybridProgram(options) {
  return new SelfOrganizingHybridProgram(options);
}
