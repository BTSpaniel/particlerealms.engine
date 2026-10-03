// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { canonicalize, hashIdFast } from '../../state/util/canonical.js';
import {
  GROWTH_LIMITS,
  GROWTH_SCHEMAS,
  GROWTH_SCHEMA_VERSION,
  assertGrowthKeys,
  cloneGrowthJson,
  compareGrowthIds,
  failGrowth,
  freezeGrowthJson,
  normalizeGrowthJson,
  normalizeGrowthPatch,
  normalizeGrowthUnitVector,
  normalizeGrowthVector3,
  quantizeGrowthNumber,
  requireGrowthHash,
  requireGrowthIdentifier,
  requireGrowthInteger,
  requireGrowthLineage,
  requireGrowthNumber,
  requireGrowthPlainObject,
} from './GrowthContracts.js';
import { deriveGrowthEntityId } from './GrowthLineageRng.js';

const STATE_KEYS = [
  'schema', 'version', 'assetId', 'seed', 'program', 'tick', 'revision',
  'environmentRevision', 'season', 'resources', 'branches', 'buds', 'leaves',
  'roots', 'fruits', 'damage', 'rngStreams', 'programState', 'stateHash',
];
const BRANCH_KEYS = [
  'id', 'lineage', 'parentId', 'kind', 'start', 'end', 'direction', 'length',
  'radius', 'age', 'vigor', 'resource', 'order', 'active', 'children',
];
const BUD_KEYS = [
  'id', 'lineage', 'parentId', 'position', 'direction', 'age', 'vigor',
  'resource', 'state', 'nextOrdinal',
];
const LEAF_KEYS = [
  'id', 'lineage', 'parentId', 'position', 'normal', 'size', 'age', 'health', 'active',
];
const FRUIT_KEYS = [
  'id', 'lineage', 'parentId', 'position', 'size', 'age', 'ripeness', 'health', 'active',
];
const DAMAGE_KEYS = [
  'id', 'lineage', 'targetId', 'targetKind', 'severity', 'mode', 'tick', 'active',
];
const SEASON_NAMES = new Set(['dormant', 'spring', 'summer', 'autumn']);
const BUD_STATES = new Set(['active', 'dormant', 'spent', 'dead']);
const DAMAGE_MODES = new Set(['break', 'disease', 'fire', 'prune', 'scar']);
const DAMAGE_TARGET_KINDS = new Set(['branch', 'bud', 'fruit', 'leaf', 'root']);
const normalizedGrowthStates = new WeakSet();

function sameVector(left, right, epsilon = 1e-5) {
  return Math.abs(left[0] - right[0]) <= epsilon
    && Math.abs(left[1] - right[1]) <= epsilon
    && Math.abs(left[2] - right[2]) <= epsilon;
}

export function growthVectorAdd(left, right) {
  return [0, 1, 2].map(axis => quantizeGrowthNumber(left[axis] + right[axis]));
}

export function growthVectorSubtract(left, right) {
  return [0, 1, 2].map(axis => quantizeGrowthNumber(left[axis] - right[axis]));
}

export function growthVectorScale(vector, scalar) {
  return [0, 1, 2].map(axis => quantizeGrowthNumber(vector[axis] * scalar));
}

export function growthVectorDot(left, right) {
  return quantizeGrowthNumber(left[0] * right[0] + left[1] * right[1] + left[2] * right[2]);
}

export function growthVectorCross(left, right) {
  return [
    quantizeGrowthNumber(left[1] * right[2] - left[2] * right[1]),
    quantizeGrowthNumber(left[2] * right[0] - left[0] * right[2]),
    quantizeGrowthNumber(left[0] * right[1] - left[1] * right[0]),
  ];
}

export function growthVectorLength(vector) {
  return quantizeGrowthNumber(Math.hypot(vector[0], vector[1], vector[2]));
}

export function growthVectorDistance(left, right) {
  return growthVectorLength(growthVectorSubtract(left, right));
}

export function growthVectorNormalize(vector, fallback = [0, 1, 0]) {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!(length > 1e-8)) return [...normalizeGrowthUnitVector(fallback, 'fallback direction')];
  return vector.map(component => quantizeGrowthNumber(component / length));
}

function normalizeProgram(input) {
  requireGrowthPlainObject(input, 'state.program');
  assertGrowthKeys(input, ['id', 'version'], 'state.program');
  return Object.freeze({
    id: requireGrowthIdentifier(input.id, 'state.program.id'),
    version: requireGrowthInteger(input.version, 'state.program.version', { minimum: 1 }),
  });
}

function normalizeSeason(input = {}) {
  requireGrowthPlainObject(input, 'state.season');
  assertGrowthKeys(input, ['year', 'phase', 'name', 'growthFactor', 'leafFactor'], 'state.season');
  const phase = requireGrowthNumber(input.phase ?? 0, 'state.season.phase', { minimum: 0, maximum: 1 });
  const name = String(input.name ?? (phase < 0.2 ? 'dormant' : phase < 0.45 ? 'spring' : phase < 0.75 ? 'summer' : 'autumn'));
  if (!SEASON_NAMES.has(name)) failGrowth('GROWTH_SEASON_NAME', `Unsupported season '${name}'`);
  return Object.freeze({
    year: requireGrowthInteger(input.year ?? 0, 'state.season.year'),
    phase,
    name,
    growthFactor: requireGrowthNumber(input.growthFactor ?? (name === 'spring' ? 1 : name === 'summer' ? 0.8 : name === 'autumn' ? 0.25 : 0.05), 'state.season.growthFactor', { minimum: 0, maximum: 2 }),
    leafFactor: requireGrowthNumber(input.leafFactor ?? (name === 'summer' ? 1 : name === 'spring' ? 0.85 : name === 'autumn' ? 0.35 : 0), 'state.season.leafFactor', { minimum: 0, maximum: 1 }),
  });
}

function normalizeResources(input = {}) {
  requireGrowthPlainObject(input, 'state.resources');
  assertGrowthKeys(input, ['carbon', 'water', 'nutrients'], 'state.resources');
  return Object.freeze({
    carbon: requireGrowthNumber(input.carbon ?? 0, 'state.resources.carbon', { minimum: 0 }),
    water: requireGrowthNumber(input.water ?? 0, 'state.resources.water', { minimum: 0 }),
    nutrients: requireGrowthNumber(input.nutrients ?? 0, 'state.resources.nutrients', { minimum: 0 }),
  });
}

export function normalizeGrowthBranch(input, path = 'branch') {
  requireGrowthPlainObject(input, path);
  assertGrowthKeys(input, BRANCH_KEYS, path);
  const lineage = requireGrowthLineage(input.lineage, `${path}.lineage`);
  const id = requireGrowthIdentifier(input.id ?? deriveGrowthEntityId('branch', lineage), `${path}.id`);
  const expectedId = deriveGrowthEntityId('branch', lineage);
  if (id !== expectedId) {
    failGrowth('GROWTH_LINEAGE_ID_MISMATCH', `${path}.id is not derived from its lineage`, { id, expectedId, lineage });
  }
  const kind = String(input.kind ?? 'branch');
  if (kind !== 'branch') failGrowth('GROWTH_BRANCH_KIND', `${path}.kind must be branch; subterranean segments belong in state.roots`);
  const start = normalizeGrowthVector3(input.start, `${path}.start`);
  const end = normalizeGrowthVector3(input.end, `${path}.end`);
  const displacement = growthVectorSubtract(end, start);
  const measuredLength = growthVectorLength(displacement);
  if (!(measuredLength > 1e-6)) failGrowth('GROWTH_ZERO_BRANCH', `${path} must have positive length`, { id });
  const measuredDirection = normalizeGrowthUnitVector(displacement, `${path}.end-start`);
  if (input.direction !== undefined && !sameVector(normalizeGrowthUnitVector(input.direction, `${path}.direction`), measuredDirection)) {
    failGrowth('GROWTH_BRANCH_DIRECTION', `${path}.direction must match end-start`, { id });
  }
  if (input.length !== undefined && Math.abs(requireGrowthNumber(input.length, `${path}.length`, { strictlyPositive: true }) - measuredLength) > 1e-4) {
    failGrowth('GROWTH_BRANCH_LENGTH', `${path}.length must match end-start`, { id });
  }
  return Object.freeze({
    id,
    lineage,
    parentId: input.parentId === null || input.parentId === undefined
      ? null
      : requireGrowthIdentifier(input.parentId, `${path}.parentId`),
    kind,
    start,
    end,
    direction: measuredDirection,
    length: measuredLength,
    radius: requireGrowthNumber(input.radius ?? 0.01, `${path}.radius`, { strictlyPositive: true }),
    age: requireGrowthInteger(input.age ?? 0, `${path}.age`),
    vigor: requireGrowthNumber(input.vigor ?? 1, `${path}.vigor`, { minimum: 0 }),
    resource: requireGrowthNumber(input.resource ?? 0, `${path}.resource`, { minimum: 0 }),
    order: requireGrowthInteger(input.order ?? 0, `${path}.order`),
    active: input.active !== false,
    children: Object.freeze([]),
  });
}

export function normalizeGrowthRoot(input, path = 'root') {
  requireGrowthPlainObject(input, path);
  assertGrowthKeys(input, BRANCH_KEYS, path);
  const lineage = requireGrowthLineage(input.lineage, `${path}.lineage`);
  const id = requireGrowthIdentifier(input.id ?? deriveGrowthEntityId('root', lineage), `${path}.id`);
  const expectedId = deriveGrowthEntityId('root', lineage);
  if (id !== expectedId) {
    failGrowth('GROWTH_LINEAGE_ID_MISMATCH', `${path}.id is not derived from its lineage`, { id, expectedId, lineage });
  }
  if (input.kind !== undefined && input.kind !== 'root') failGrowth('GROWTH_ROOT_KIND', `${path}.kind must be root`);
  const start = normalizeGrowthVector3(input.start, `${path}.start`);
  const end = normalizeGrowthVector3(input.end, `${path}.end`);
  const displacement = growthVectorSubtract(end, start);
  const measuredLength = growthVectorLength(displacement);
  if (!(measuredLength > 1e-6)) failGrowth('GROWTH_ZERO_ROOT', `${path} must have positive length`, { id });
  const measuredDirection = normalizeGrowthUnitVector(displacement, `${path}.end-start`);
  if (input.direction !== undefined && !sameVector(normalizeGrowthUnitVector(input.direction, `${path}.direction`), measuredDirection)) {
    failGrowth('GROWTH_ROOT_DIRECTION', `${path}.direction must match end-start`, { id });
  }
  if (input.length !== undefined && Math.abs(requireGrowthNumber(input.length, `${path}.length`, { strictlyPositive: true }) - measuredLength) > 1e-4) {
    failGrowth('GROWTH_ROOT_LENGTH', `${path}.length must match end-start`, { id });
  }
  return Object.freeze({
    id,
    lineage,
    parentId: input.parentId === null || input.parentId === undefined
      ? null
      : requireGrowthIdentifier(input.parentId, `${path}.parentId`),
    kind: 'root',
    start,
    end,
    direction: measuredDirection,
    length: measuredLength,
    radius: requireGrowthNumber(input.radius ?? 0.01, `${path}.radius`, { strictlyPositive: true }),
    age: requireGrowthInteger(input.age ?? 0, `${path}.age`),
    vigor: requireGrowthNumber(input.vigor ?? 1, `${path}.vigor`, { minimum: 0 }),
    resource: requireGrowthNumber(input.resource ?? 0, `${path}.resource`, { minimum: 0 }),
    order: requireGrowthInteger(input.order ?? 0, `${path}.order`),
    active: input.active !== false,
    children: Object.freeze([]),
  });
}

export function normalizeGrowthBud(input, path = 'bud') {
  requireGrowthPlainObject(input, path);
  assertGrowthKeys(input, BUD_KEYS, path);
  const lineage = requireGrowthLineage(input.lineage, `${path}.lineage`);
  const id = requireGrowthIdentifier(input.id ?? deriveGrowthEntityId('bud', lineage), `${path}.id`);
  const expectedId = deriveGrowthEntityId('bud', lineage);
  if (id !== expectedId) failGrowth('GROWTH_LINEAGE_ID_MISMATCH', `${path}.id is not derived from its lineage`, { id, expectedId });
  const state = String(input.state ?? 'active');
  if (!BUD_STATES.has(state)) failGrowth('GROWTH_BUD_STATE', `${path}.state '${state}' is unsupported`);
  return Object.freeze({
    id,
    lineage,
    parentId: requireGrowthIdentifier(input.parentId, `${path}.parentId`),
    position: normalizeGrowthVector3(input.position, `${path}.position`),
    direction: normalizeGrowthUnitVector(input.direction, `${path}.direction`),
    age: requireGrowthInteger(input.age ?? 0, `${path}.age`),
    vigor: requireGrowthNumber(input.vigor ?? 1, `${path}.vigor`, { minimum: 0 }),
    resource: requireGrowthNumber(input.resource ?? 0, `${path}.resource`, { minimum: 0 }),
    state,
    nextOrdinal: requireGrowthInteger(input.nextOrdinal ?? 0, `${path}.nextOrdinal`, { maximum: 0xffffffff }),
  });
}

export function normalizeGrowthLeaf(input, path = 'leaf') {
  requireGrowthPlainObject(input, path);
  assertGrowthKeys(input, LEAF_KEYS, path);
  const lineage = requireGrowthLineage(input.lineage, `${path}.lineage`);
  const id = requireGrowthIdentifier(input.id ?? deriveGrowthEntityId('leaf', lineage), `${path}.id`);
  const expectedId = deriveGrowthEntityId('leaf', lineage);
  if (id !== expectedId) failGrowth('GROWTH_LINEAGE_ID_MISMATCH', `${path}.id is not derived from its lineage`, { id, expectedId });
  return Object.freeze({
    id,
    lineage,
    parentId: requireGrowthIdentifier(input.parentId, `${path}.parentId`),
    position: normalizeGrowthVector3(input.position, `${path}.position`),
    normal: normalizeGrowthUnitVector(input.normal, `${path}.normal`),
    size: requireGrowthNumber(input.size ?? 0.1, `${path}.size`, { strictlyPositive: true }),
    age: requireGrowthInteger(input.age ?? 0, `${path}.age`),
    health: requireGrowthNumber(input.health ?? 1, `${path}.health`, { minimum: 0, maximum: 1 }),
    active: input.active !== false,
  });
}

export function normalizeGrowthFruit(input, path = 'fruit') {
  requireGrowthPlainObject(input, path);
  assertGrowthKeys(input, FRUIT_KEYS, path);
  const lineage = requireGrowthLineage(input.lineage, `${path}.lineage`);
  const id = requireGrowthIdentifier(input.id ?? deriveGrowthEntityId('fruit', lineage), `${path}.id`);
  const expectedId = deriveGrowthEntityId('fruit', lineage);
  if (id !== expectedId) failGrowth('GROWTH_LINEAGE_ID_MISMATCH', `${path}.id is not derived from its lineage`, { id, expectedId });
  return Object.freeze({
    id,
    lineage,
    parentId: requireGrowthIdentifier(input.parentId, `${path}.parentId`),
    position: normalizeGrowthVector3(input.position, `${path}.position`),
    size: requireGrowthNumber(input.size ?? 0.08, `${path}.size`, { strictlyPositive: true }),
    age: requireGrowthInteger(input.age ?? 0, `${path}.age`),
    ripeness: requireGrowthNumber(input.ripeness ?? 0, `${path}.ripeness`, { minimum: 0, maximum: 1 }),
    health: requireGrowthNumber(input.health ?? 1, `${path}.health`, { minimum: 0, maximum: 1 }),
    active: input.active !== false,
  });
}

export function normalizeGrowthDamage(input, path = 'damage') {
  requireGrowthPlainObject(input, path);
  assertGrowthKeys(input, DAMAGE_KEYS, path);
  const lineage = requireGrowthLineage(input.lineage, `${path}.lineage`);
  const id = requireGrowthIdentifier(input.id ?? deriveGrowthEntityId('damage', lineage), `${path}.id`);
  const expectedId = deriveGrowthEntityId('damage', lineage);
  if (id !== expectedId) failGrowth('GROWTH_LINEAGE_ID_MISMATCH', `${path}.id is not derived from its lineage`, { id, expectedId });
  const targetKind = String(input.targetKind ?? 'branch');
  const mode = String(input.mode ?? 'scar');
  if (!DAMAGE_TARGET_KINDS.has(targetKind)) failGrowth('GROWTH_DAMAGE_TARGET_KIND', `${path}.targetKind '${targetKind}' is unsupported`);
  if (!DAMAGE_MODES.has(mode)) failGrowth('GROWTH_DAMAGE_MODE', `${path}.mode '${mode}' is unsupported`);
  return Object.freeze({
    id,
    lineage,
    targetId: requireGrowthIdentifier(input.targetId, `${path}.targetId`),
    targetKind,
    severity: requireGrowthNumber(input.severity ?? 1, `${path}.severity`, { minimum: 0, maximum: 1 }),
    mode,
    tick: requireGrowthInteger(input.tick ?? 0, `${path}.tick`),
    active: input.active !== false,
  });
}

function canonicalizeBranches(input) {
  if (!Array.isArray(input)) failGrowth('GROWTH_BRANCH_ARRAY', 'state.branches must be an array');
  if (input.length > GROWTH_LIMITS.MAX_BRANCHES) failGrowth('GROWTH_BRANCH_LIMIT', `Growth state exceeds ${GROWTH_LIMITS.MAX_BRANCHES} branches`);
  const byId = new Map();
  const byLineage = new Map();
  for (let index = 0; index < input.length; index++) {
    const branch = normalizeGrowthBranch(input[index], `state.branches[${index}]`);
    if (byId.has(branch.id) || byLineage.has(branch.lineage)) {
      failGrowth('GROWTH_DUPLICATE_BRANCH', `Duplicate branch id or lineage at state.branches[${index}]`, { id: branch.id, lineage: branch.lineage });
    }
    byId.set(branch.id, branch);
    byLineage.set(branch.lineage, branch.id);
  }
  const children = new Map([...byId.keys()].map(id => [id, []]));
  const depths = new Map();
  const visiting = new Set();
  function depthFor(branch) {
    if (depths.has(branch.id)) return depths.get(branch.id);
    if (visiting.has(branch.id)) failGrowth('GROWTH_BRANCH_CYCLE', `Branch parent cycle includes ${branch.id}`);
    visiting.add(branch.id);
    let depth = 0;
    if (branch.parentId !== null) {
      const parent = byId.get(branch.parentId);
      if (!parent) failGrowth('GROWTH_MISSING_PARENT', `Branch ${branch.id} references missing parent ${branch.parentId}`);
      if (!sameVector(branch.start, parent.end, 1e-4)) {
        failGrowth('GROWTH_DISCONNECTED_BRANCH', `Branch ${branch.id} does not start at parent ${parent.id} endpoint`);
      }
      depth = depthFor(parent) + 1;
      children.get(parent.id).push(branch.id);
    }
    visiting.delete(branch.id);
    depths.set(branch.id, depth);
    return depth;
  }
  for (const branch of byId.values()) depthFor(branch);
  return [...byId.values()].map(branch => Object.freeze({
    ...branch,
    order: depths.get(branch.id),
    children: Object.freeze(children.get(branch.id).sort(compareGrowthIds)),
  })).sort((left, right) => compareGrowthIds(left.lineage, right.lineage));
}

function canonicalizeRoots(input, branches) {
  if (!Array.isArray(input)) failGrowth('GROWTH_ROOT_ARRAY', 'state.roots must be an array');
  if (input.length > GROWTH_LIMITS.MAX_ROOTS) failGrowth('GROWTH_ROOT_LIMIT', `Growth state exceeds ${GROWTH_LIMITS.MAX_ROOTS} roots`);
  const branchById = new Map(branches.map(branch => [branch.id, branch]));
  const byId = new Map();
  const byLineage = new Map();
  for (let index = 0; index < input.length; index++) {
    const root = normalizeGrowthRoot(input[index], `state.roots[${index}]`);
    if (byId.has(root.id) || byLineage.has(root.lineage)) {
      failGrowth('GROWTH_DUPLICATE_ROOT', `Duplicate root id or lineage at state.roots[${index}]`, { id: root.id, lineage: root.lineage });
    }
    byId.set(root.id, root);
    byLineage.set(root.lineage, root.id);
  }
  const children = new Map([...byId.keys()].map(id => [id, []]));
  const depths = new Map();
  const visiting = new Set();
  function depthFor(root) {
    if (depths.has(root.id)) return depths.get(root.id);
    if (visiting.has(root.id)) failGrowth('GROWTH_ROOT_CYCLE', `Root parent cycle includes ${root.id}`);
    visiting.add(root.id);
    let depth = 0;
    if (root.parentId !== null) {
      const parentRoot = byId.get(root.parentId);
      const parentBranch = branchById.get(root.parentId);
      const parent = parentRoot ?? parentBranch;
      if (!parent) failGrowth('GROWTH_MISSING_PARENT', `Root ${root.id} references missing segment ${root.parentId}`);
      if (!sameVector(root.start, parent.end, 1e-4)) {
        failGrowth('GROWTH_DISCONNECTED_ROOT', `Root ${root.id} does not start at parent ${parent.id} endpoint`);
      }
      depth = parentRoot ? depthFor(parentRoot) + 1 : parent.order + 1;
      if (parentRoot) children.get(parentRoot.id).push(root.id);
    }
    visiting.delete(root.id);
    depths.set(root.id, depth);
    return depth;
  }
  for (const root of byId.values()) depthFor(root);
  return [...byId.values()].map(root => Object.freeze({
    ...root,
    order: depths.get(root.id),
    children: Object.freeze(children.get(root.id).sort(compareGrowthIds)),
  })).sort((left, right) => compareGrowthIds(left.lineage, right.lineage));
}

function canonicalizeDependents(input, normalizer, label, maximum, branchIds) {
  if (!Array.isArray(input)) failGrowth(`GROWTH_${label.toUpperCase()}_ARRAY`, `state.${label} must be an array`);
  if (input.length > maximum) failGrowth(`GROWTH_${label.toUpperCase()}_LIMIT`, `Growth state exceeds ${maximum} ${label}`);
  const ids = new Set();
  const lineages = new Set();
  const normalized = input.map((entry, index) => {
    const entity = normalizer(entry, `state.${label}[${index}]`);
    if (ids.has(entity.id) || lineages.has(entity.lineage)) {
      failGrowth(`GROWTH_DUPLICATE_${label.toUpperCase()}`, `Duplicate ${label} id or lineage`, { id: entity.id, lineage: entity.lineage });
    }
    if (!branchIds.has(entity.parentId)) {
      failGrowth('GROWTH_MISSING_PARENT', `${label} ${entity.id} references missing branch ${entity.parentId}`);
    }
    ids.add(entity.id);
    lineages.add(entity.lineage);
    return entity;
  });
  return normalized.sort((left, right) => compareGrowthIds(left.lineage, right.lineage));
}

function canonicalizeDamage(input, targets) {
  if (!Array.isArray(input)) failGrowth('GROWTH_DAMAGE_ARRAY', 'state.damage must be an array');
  if (input.length > GROWTH_LIMITS.MAX_DAMAGE_ENTITIES) {
    failGrowth('GROWTH_DAMAGE_LIMIT', `Growth state exceeds ${GROWTH_LIMITS.MAX_DAMAGE_ENTITIES} damage entities`);
  }
  const ids = new Set();
  const lineages = new Set();
  return input.map((entry, index) => {
    const damage = normalizeGrowthDamage(entry, `state.damage[${index}]`);
    if (ids.has(damage.id) || lineages.has(damage.lineage)) {
      failGrowth('GROWTH_DUPLICATE_DAMAGE', `Duplicate damage id or lineage`, { id: damage.id, lineage: damage.lineage });
    }
    const targetKind = targets.get(damage.targetId);
    if (damage.active && targetKind !== damage.targetKind) {
      failGrowth('GROWTH_DAMAGE_TARGET', `Damage ${damage.id} references missing or mismatched ${damage.targetKind} ${damage.targetId}`);
    }
    ids.add(damage.id);
    lineages.add(damage.lineage);
    return damage;
  }).sort((left, right) => compareGrowthIds(left.lineage, right.lineage));
}

function hashableState(state) {
  const { stateHash: _stateHash, ...contents } = state;
  return contents;
}

export function hashGrowthState(state) {
  return hashIdFast(hashableState(state), { domain: 'engine-growth-state', schemaVersion: '1' });
}

export function normalizeGrowthState(input) {
  if (input && typeof input === 'object' && normalizedGrowthStates.has(input)) return input;
  requireGrowthPlainObject(input, 'state');
  assertGrowthKeys(input, STATE_KEYS, 'state');
  if ((input.schema ?? GROWTH_SCHEMAS.state) !== GROWTH_SCHEMAS.state
      || Number(input.version ?? GROWTH_SCHEMA_VERSION) !== GROWTH_SCHEMA_VERSION) {
    failGrowth('GROWTH_STATE_VERSION', `Expected ${GROWTH_SCHEMAS.state} v${GROWTH_SCHEMA_VERSION}`);
  }
  const branches = canonicalizeBranches(input.branches ?? []);
  const roots = canonicalizeRoots(input.roots ?? [], branches);
  const segmentIds = new Set([...branches, ...roots].map(segment => segment.id));
  const buds = canonicalizeDependents(input.buds ?? [], normalizeGrowthBud, 'buds', GROWTH_LIMITS.MAX_BUDS, segmentIds);
  const leaves = canonicalizeDependents(input.leaves ?? [], normalizeGrowthLeaf, 'leaves', GROWTH_LIMITS.MAX_LEAVES, segmentIds);
  const fruits = canonicalizeDependents(input.fruits ?? [], normalizeGrowthFruit, 'fruits', GROWTH_LIMITS.MAX_FRUITS, segmentIds);
  const targets = new Map([
    ...branches.map(entity => [entity.id, 'branch']),
    ...roots.map(entity => [entity.id, 'root']),
    ...buds.map(entity => [entity.id, 'bud']),
    ...leaves.map(entity => [entity.id, 'leaf']),
    ...fruits.map(entity => [entity.id, 'fruit']),
  ]);
  const damage = canonicalizeDamage(input.damage ?? [], targets);
  const programState = freezeGrowthJson(input.programState ?? {}, 'state.programState');
  if (programState.environment !== undefined) {
    requireGrowthPlainObject(programState.environment, 'state.programState.environment');
    const capturedRevision = requireGrowthIdentifier(programState.environment.revision, 'state.programState.environment.revision');
    const stateRevision = requireGrowthIdentifier(input.environmentRevision ?? 'environment.default.v1', 'state.environmentRevision');
    if (capturedRevision !== stateRevision) {
      failGrowth('GROWTH_ENVIRONMENT_REVISION_MISMATCH', 'Growth state environmentRevision disagrees with its captured program environment', {
        stateRevision,
        capturedRevision,
      });
    }
  }
  if (Array.isArray(programState.attractors) && programState.attractors.length > GROWTH_LIMITS.MAX_ATTRACTORS) {
    failGrowth('GROWTH_ATTRACTOR_LIMIT', `Growth state exceeds ${GROWTH_LIMITS.MAX_ATTRACTORS} attractors`);
  }
  const normalized = {
    schema: GROWTH_SCHEMAS.state,
    version: GROWTH_SCHEMA_VERSION,
    assetId: requireGrowthIdentifier(input.assetId, 'state.assetId'),
    seed: requireGrowthInteger(input.seed, 'state.seed', { maximum: 0xffffffff }),
    program: normalizeProgram(input.program),
    tick: requireGrowthInteger(input.tick ?? 0, 'state.tick'),
    revision: requireGrowthInteger(input.revision ?? 0, 'state.revision'),
    environmentRevision: requireGrowthIdentifier(input.environmentRevision ?? 'environment.default.v1', 'state.environmentRevision'),
    season: normalizeSeason(input.season),
    resources: normalizeResources(input.resources),
    branches: Object.freeze(branches),
    buds: Object.freeze(buds),
    leaves: Object.freeze(leaves),
    roots: Object.freeze(roots),
    fruits: Object.freeze(fruits),
    damage: Object.freeze(damage),
    rngStreams: freezeGrowthJson(input.rngStreams ?? [], 'state.rngStreams'),
    programState,
  };
  const stateHash = hashGrowthState(normalized);
  if (input.stateHash !== undefined && requireGrowthHash(input.stateHash, 'state.stateHash') !== stateHash) {
    failGrowth('GROWTH_STATE_HASH_MISMATCH', 'Growth state hash does not match canonical state contents', {
      expected: stateHash,
      received: input.stateHash,
    });
  }
  const state = Object.freeze({ ...normalized, stateHash });
  normalizedGrowthStates.add(state);
  return state;
}

export function createInitialGrowthState({
  assetId,
  seed = 0,
  programId,
  programVersion = 1,
  environmentRevision = 'environment.default.v1',
  season = { year: 0, phase: 0.3, name: 'spring' },
  resources = { carbon: 0, water: 0, nutrients: 0 },
  branches = [],
  buds = [],
  leaves = [],
  roots = [],
  fruits = [],
  damage = [],
  rngStreams = [],
  programState = {},
} = {}) {
  return normalizeGrowthState({
    assetId,
    seed,
    program: { id: programId, version: programVersion },
    tick: 0,
    revision: 0,
    environmentRevision,
    season,
    resources,
    branches,
    buds,
    leaves,
    roots,
    fruits,
    damage,
    rngStreams,
    programState,
  });
}

export function snapshotGrowthState(state) {
  return normalizeGrowthState(state);
}

export function restoreGrowthState(snapshot) {
  return normalizeGrowthState(snapshot);
}

export function cloneGrowthState(state) {
  return cloneGrowthJson(normalizeGrowthState(state), '$.stateClone');
}

function entityMap(entities) {
  return new Map(entities.map(entity => [entity.id, entity]));
}

function entityChanged(left, right) {
  return canonicalize(left) !== canonicalize(right);
}

function diffEntityFamily(previousEntities, nextEntities, family) {
  const previous = entityMap(previousEntities);
  const next = entityMap(nextEntities);
  const commands = [];
  const removed = [...previous.values()].filter(entity => !next.has(entity.id))
    .sort((left, right) => (right.order ?? 0) - (left.order ?? 0) || compareGrowthIds(right.lineage, left.lineage));
  const spawned = [...next.values()].filter(entity => !previous.has(entity.id))
    .sort((left, right) => compareGrowthIds(left.lineage, right.lineage));
  const updated = [...next.values()].filter(entity => previous.has(entity.id) && entityChanged(previous.get(entity.id), entity))
    .sort((left, right) => compareGrowthIds(left.lineage, right.lineage));
  for (const entity of removed) commands.push({ type: `${family}.remove`, id: entity.id });
  for (const entity of spawned) commands.push({ type: `${family}.spawn`, id: entity.id, entity });
  for (const entity of updated) commands.push({ type: `${family}.update`, id: entity.id, entity });
  return { commands, spawned: spawned.length };
}

export function createGrowthPatchBetween(previousState, nextState, { reason = 'growth-step', events = [] } = {}) {
  const previous = normalizeGrowthState(previousState);
  const next = normalizeGrowthState(nextState);
  if (previous.assetId !== next.assetId || previous.seed !== next.seed
      || previous.program.id !== next.program.id || previous.program.version !== next.program.version) {
    failGrowth('GROWTH_PATCH_IDENTITY', 'GrowthPatch states must share asset, seed, and program identity');
  }
  if (next.revision !== previous.revision + 1 || next.tick !== previous.tick + 1) {
    failGrowth('GROWTH_STEP_CONTINUITY', 'Growth state must advance tick and revision exactly once', {
      previousTick: previous.tick,
      nextTick: next.tick,
      previousRevision: previous.revision,
      nextRevision: next.revision,
    });
  }
  const leaf = diffEntityFamily(previous.leaves, next.leaves, 'leaf');
  const fruit = diffEntityFamily(previous.fruits, next.fruits, 'fruit');
  const bud = diffEntityFamily(previous.buds, next.buds, 'bud');
  const damage = diffEntityFamily(previous.damage, next.damage, 'damage');
  const root = diffEntityFamily(previous.roots, next.roots, 'root');
  const branch = diffEntityFamily(previous.branches, next.branches, 'branch');
  const spawned = leaf.spawned + fruit.spawned + bud.spawned + damage.spawned + root.spawned + branch.spawned;
  if (spawned > GROWTH_LIMITS.MAX_NEW_ENTITIES_PER_TICK) {
    failGrowth('GROWTH_NEW_ENTITY_LIMIT', `Growth tick creates ${spawned} entities; maximum is ${GROWTH_LIMITS.MAX_NEW_ENTITIES_PER_TICK}`, { spawned });
  }
  const commands = [
    ...damage.commands,
    ...leaf.commands,
    ...fruit.commands,
    ...bud.commands,
    ...root.commands,
    ...branch.commands,
  ];
  if (commands.length > GROWTH_LIMITS.MAX_PATCH_COMMANDS) {
    failGrowth('GROWTH_PATCH_COMMAND_LIMIT', `Growth tick emits ${commands.length} commands; maximum is ${GROWTH_LIMITS.MAX_PATCH_COMMANDS}`, {
      commands: commands.length,
    });
  }
  return normalizeGrowthPatch({
    schema: GROWTH_SCHEMAS.patch,
    version: GROWTH_SCHEMA_VERSION,
    assetId: next.assetId,
    programId: next.program.id,
    programVersion: next.program.version,
    seed: next.seed,
    tick: next.tick,
    baseRevision: previous.revision,
    revision: next.revision,
    environmentRevision: next.environmentRevision,
    previousStateHash: previous.stateHash,
    stateHash: next.stateHash,
    reason,
    commands,
    events,
  });
}

export function commitGrowthStep(previousState, draft, { reason = 'growth-step', events = [] } = {}) {
  const previous = normalizeGrowthState(previousState);
  requireGrowthPlainObject(draft, 'growth draft');
  const candidate = {
    ...normalizeGrowthJson(draft, '$.growthDraft'),
    schema: GROWTH_SCHEMAS.state,
    version: GROWTH_SCHEMA_VERSION,
    assetId: previous.assetId,
    seed: previous.seed,
    program: previous.program,
    tick: previous.tick + 1,
    revision: previous.revision + 1,
  };
  delete candidate.stateHash;
  const state = normalizeGrowthState(candidate);
  const patch = createGrowthPatchBetween(previous, state, { reason, events });
  return Object.freeze({ state, patch });
}

export function createGrowthBudgetStall(stateInput, {
  requested,
  programId = null,
  unit = 'entities',
  telemetry = {},
} = {}) {
  const state = normalizeGrowthState(stateInput);
  const retained = requireGrowthInteger(requested, 'budget requested work');
  const event = freezeGrowthJson({
    type: 'growth.budget-limited',
    details: { requested: retained, committed: 0, retained, unit },
  }, '$.growthBudgetStallEvent');
  return Object.freeze({
    state,
    patch: null,
    events: Object.freeze([event]),
    telemetry: freezeGrowthJson({
      programId: programId ?? state.program.id,
      tick: state.tick,
      attemptedTick: state.tick + 1,
      requested: retained,
      committed: 0,
      retained,
      backlog: retained,
      budgetExhausted: true,
      ...telemetry,
    }, '$.growthBudgetStallTelemetry'),
  });
}
