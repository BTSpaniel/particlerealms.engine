// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { hashIdFast } from '../../state/util/canonical.js';

export const GROWTH_SCHEMA_VERSION = 1;
export const GROWTH_FIXED_DT_SECONDS = 0.1;

export const GROWTH_SCHEMAS = Object.freeze({
  state: 'engine-growth-state',
  patch: 'engine-growth-patch',
  environment: 'engine-growth-environment',
  bake: 'engine-growth-bake',
});

export const GROWTH_LIMITS = Object.freeze({
  MAX_BRANCHES: 8_192,
  MAX_ROOTS: 8_192,
  MAX_LEAVES: 32_768,
  MAX_FRUITS: 32_768,
  MAX_DAMAGE_ENTITIES: 8_192,
  MAX_ATTRACTORS: 65_536,
  MAX_NEW_ENTITIES_PER_TICK: 256,
  MAX_PATCH_COMMANDS: 1_024,
  MAX_BUDS: 16_384,
  MAX_LINEAGE_LENGTH: 2_048,
  MAX_ID_LENGTH: 128,
  MAX_PROGRAM_STATE_VALUES: 1_000_000,
  MAX_JSON_DEPTH: 96,
  MAX_LSYSTEM_SYMBOLS: 65_536,
  MAX_LSYSTEM_GENERATIONS: 12,
  MAX_TURTLE_STACK_DEPTH: 128,
  MAX_VOXELS: 16_777_216,
});

export const GROWTH_PROGRAM_IDS = Object.freeze({
  LEGACY_TRANSPORT_BINARY: 'legacy.transport-binary',
  SPACE_COLONIZATION: 'space-colonization.incremental',
  PARAMETRIC_LSYSTEM: 'l-system.parametric',
  SELF_ORGANIZING_HYBRID: 'self-organizing.hybrid',
});

export const GROWTH_COMMAND_TYPES = Object.freeze([
  'branch.remove',
  'branch.spawn',
  'branch.update',
  'bud.remove',
  'bud.spawn',
  'bud.update',
  'leaf.remove',
  'leaf.spawn',
  'leaf.update',
  'root.remove',
  'root.spawn',
  'root.update',
  'fruit.remove',
  'fruit.spawn',
  'fruit.update',
  'damage.remove',
  'damage.spawn',
  'damage.update',
]);

export const GROWTH_EVENT_TYPES = Object.freeze([
  'growth.budget-limited',
  'growth.completed',
  'growth.damage-applied',
  'growth.obstacle-rejected',
  'growth.pruned',
  'growth.season-changed',
]);

const COMMAND_TYPES = new Set(GROWTH_COMMAND_TYPES);
const EVENT_TYPES = new Set(GROWTH_EVENT_TYPES);
const COMMAND_ENTITY_KEYS = Object.freeze({
  branch: new Set(['id', 'lineage', 'parentId', 'kind', 'start', 'end', 'direction', 'length', 'radius', 'age', 'vigor', 'resource', 'order', 'active', 'children']),
  root: new Set(['id', 'lineage', 'parentId', 'kind', 'start', 'end', 'direction', 'length', 'radius', 'age', 'vigor', 'resource', 'order', 'active', 'children']),
  bud: new Set(['id', 'lineage', 'parentId', 'position', 'direction', 'age', 'vigor', 'resource', 'state', 'nextOrdinal']),
  leaf: new Set(['id', 'lineage', 'parentId', 'position', 'normal', 'size', 'age', 'health', 'active']),
  fruit: new Set(['id', 'lineage', 'parentId', 'position', 'size', 'age', 'ripeness', 'health', 'active']),
  damage: new Set(['id', 'lineage', 'targetId', 'targetKind', 'severity', 'mode', 'tick', 'active']),
});
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const HASH_PATTERN = /^(?:fnv1a32:32:[0-9a-f]{8}|sha256:256:[0-9a-f]{64})$/u;

export class GrowthError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'GrowthError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function failGrowth(code, message, details = undefined) {
  throw new GrowthError(code, message, details);
}

export function isGrowthPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function requireGrowthPlainObject(value, path = '$') {
  if (!isGrowthPlainObject(value)) {
    failGrowth('GROWTH_OBJECT_REQUIRED', `${path} must be a plain object`, { path });
  }
  return value;
}

export function assertGrowthKeys(value, allowed, path = '$') {
  requireGrowthPlainObject(value, path);
  const allowedSet = allowed instanceof Set ? allowed : new Set(allowed);
  const unsupported = Object.keys(value).filter(key => !allowedSet.has(key));
  if (unsupported.length > 0) {
    failGrowth('GROWTH_UNKNOWN_FIELD', `${path} contains unsupported fields: ${unsupported.join(', ')}`, {
      path,
      unsupported,
    });
  }
}

export function requireGrowthIdentifier(value, path = 'id', options = {}) {
  const text = typeof value === 'string' ? value : '';
  const length = Array.from(text).length;
  const maximum = options.maximum ?? GROWTH_LIMITS.MAX_ID_LENGTH;
  if (length === 0 || length > maximum || /[\u0000-\u001f\u007f]/u.test(text)) {
    failGrowth('GROWTH_INVALID_ID', `${path} must be a non-empty stable identifier of at most ${maximum} characters`, {
      path,
      value,
      length,
    });
  }
  return text;
}

export function requireGrowthLineage(value, path = 'lineage') {
  return requireGrowthIdentifier(value, path, { maximum: GROWTH_LIMITS.MAX_LINEAGE_LENGTH });
}

export function requireGrowthInteger(value, path, options = {}) {
  const number = Number(value);
  const minimum = options.minimum ?? 0;
  const maximum = options.maximum ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    failGrowth('GROWTH_INTEGER_RANGE', `${path} must be an integer in [${minimum}, ${maximum}]`, {
      path,
      value,
      minimum,
      maximum,
    });
  }
  return number;
}

export function quantizeGrowthNumber(value) {
  const number = Math.fround(Number(value));
  if (!Number.isFinite(number)) {
    failGrowth('GROWTH_NON_FINITE_NUMBER', 'Growth continuous values must be finite f32 numbers', { value });
  }
  return Object.is(number, -0) ? 0 : number;
}

export function requireGrowthNumber(value, path, options = {}) {
  const number = quantizeGrowthNumber(value);
  const minimum = options.minimum ?? -Number.MAX_VALUE;
  const maximum = options.maximum ?? Number.MAX_VALUE;
  if (number < minimum || number > maximum || (options.strictlyPositive && !(number > 0))) {
    failGrowth('GROWTH_NUMBER_RANGE', `${path} is outside its permitted range`, {
      path,
      value: number,
      minimum,
      maximum,
    });
  }
  return number;
}

export function normalizeGrowthVector3(value, path = 'vector', fallback = null) {
  const source = value ?? fallback;
  if (!Array.isArray(source) || source.length !== 3) {
    failGrowth('GROWTH_VECTOR3_REQUIRED', `${path} must contain exactly three numbers`, { path, value });
  }
  return Object.freeze(source.map((component, index) => requireGrowthNumber(component, `${path}[${index}]`)));
}

export function normalizeGrowthUnitVector(value, path = 'direction', fallback = [0, 1, 0]) {
  const vector = normalizeGrowthVector3(value, path, fallback);
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!(length > 1e-8)) {
    failGrowth('GROWTH_ZERO_DIRECTION', `${path} must have non-zero length`, { path, value });
  }
  return Object.freeze(vector.map(component => quantizeGrowthNumber(component / length)));
}

export function compareGrowthIds(left, right) {
  const a = String(left);
  const b = String(right);
  const limit = Math.min(a.length, b.length);
  for (let index = 0; index < limit; index++) {
    const difference = a.charCodeAt(index) - b.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

function normalizeJsonInternal(value, path, depth, budget, options) {
  if (depth > (options.maximumDepth ?? GROWTH_LIMITS.MAX_JSON_DEPTH)) {
    failGrowth('GROWTH_JSON_DEPTH', `${path} exceeds the canonical JSON depth limit`, { path });
  }
  budget.count += 1;
  if (budget.count > (options.maximumValues ?? GROWTH_LIMITS.MAX_PROGRAM_STATE_VALUES)) {
    failGrowth('GROWTH_JSON_SIZE', `${path} exceeds the canonical JSON value limit`, { path });
  }
  if (value === null) return null;
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return value;
    case 'number':
      if (!Number.isFinite(value)) {
        failGrowth('GROWTH_NON_FINITE_NUMBER', `${path} must be finite`, { path, value });
      }
      if (Number.isInteger(value) && Number.isSafeInteger(value)) return Object.is(value, -0) ? 0 : value;
      return quantizeGrowthNumber(value);
    case 'object':
      break;
    default:
      failGrowth('GROWTH_NON_JSON_VALUE', `${path} contains unsupported ${typeof value} data`, { path });
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => normalizeJsonInternal(entry, `${path}[${index}]`, depth + 1, budget, options));
  }
  requireGrowthPlainObject(value, path);
  const normalized = {};
  for (const key of Object.keys(value).sort(compareGrowthIds)) {
    if (FORBIDDEN_KEYS.has(key)) {
      failGrowth('GROWTH_UNSAFE_KEY', `${path}.${key} is not permitted`, { path, key });
    }
    if (value[key] === undefined) {
      failGrowth('GROWTH_UNDEFINED_VALUE', `${path}.${key} cannot be undefined`, { path: `${path}.${key}` });
    }
    normalized[key] = normalizeJsonInternal(value[key], `${path}.${key}`, depth + 1, budget, options);
  }
  return normalized;
}

export function normalizeGrowthJson(value, path = '$', options = {}) {
  return normalizeJsonInternal(value, path, 0, { count: 0 }, options);
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const entry of Array.isArray(value) ? value : Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

export function freezeGrowthJson(value, path = '$', options = {}) {
  return deepFreeze(normalizeGrowthJson(value, path, options));
}

export function cloneGrowthJson(value, path = '$', options = {}) {
  return normalizeGrowthJson(value, path, options);
}

export function requireGrowthHash(value, path = 'hash') {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    failGrowth('GROWTH_INVALID_HASH', `${path} must be a tagged FNV-1a or SHA-256 hash`, { path, value });
  }
  return value;
}

export function validateGrowthStepTiming(state, input = {}) {
  requireGrowthPlainObject(input, 'growth step input');
  const expectedTick = requireGrowthInteger(state?.tick, 'state.tick') + 1;
  const tick = input.tick === undefined
    ? expectedTick
    : requireGrowthInteger(input.tick, 'step.tick', { minimum: 1 });
  if (tick !== expectedTick) {
    failGrowth('GROWTH_STEP_TICK', `Growth step tick must be ${expectedTick}, received ${tick}`, { expectedTick, tick });
  }
  const fixedDt = input.fixedDt === undefined
    ? quantizeGrowthNumber(GROWTH_FIXED_DT_SECONDS)
    : requireGrowthNumber(input.fixedDt, 'step.fixedDt', { strictlyPositive: true });
  if (fixedDt !== quantizeGrowthNumber(GROWTH_FIXED_DT_SECONDS)) {
    failGrowth('GROWTH_STEP_RATE', `Growth programs require an exact 10 Hz fixedDt of ${GROWTH_FIXED_DT_SECONDS} seconds`, {
      expected: GROWTH_FIXED_DT_SECONDS,
      received: input.fixedDt,
    });
  }
  return Object.freeze({ tick, fixedDt });
}

function normalizeGrowthCommand(command, index) {
  const path = `patch.commands[${index}]`;
  requireGrowthPlainObject(command, path);
  const type = String(command.type ?? '');
  if (!COMMAND_TYPES.has(type)) {
    failGrowth('GROWTH_UNKNOWN_COMMAND', `${path}.type '${type}' is unsupported`, { path, type });
  }
  const isRemove = type.endsWith('.remove');
  assertGrowthKeys(command, isRemove ? ['type', 'id'] : ['type', 'id', 'entity'], path);
  const id = requireGrowthIdentifier(command.id, `${path}.id`);
  if (isRemove) return Object.freeze({ type, id });
  const entity = freezeGrowthJson(command.entity, `${path}.entity`, { maximumValues: 512 });
  const family = type.split('.')[0];
  assertGrowthKeys(entity, COMMAND_ENTITY_KEYS[family], `${path}.entity`);
  if (entity.id !== id) {
    failGrowth('GROWTH_COMMAND_ID_MISMATCH', `${path}.entity.id must equal ${path}.id`, { id, entityId: entity.id });
  }
  requireGrowthLineage(entity.lineage, `${path}.entity.lineage`);
  return Object.freeze({ type, id, entity });
}

function normalizeGrowthEvent(event, index) {
  const path = `patch.events[${index}]`;
  requireGrowthPlainObject(event, path);
  assertGrowthKeys(event, ['type', 'id', 'lineage', 'targetId', 'details'], path);
  const type = String(event.type ?? '');
  if (!EVENT_TYPES.has(type)) failGrowth('GROWTH_UNKNOWN_EVENT', `${path}.type '${type}' is unsupported`, { path, type });
  const normalized = { type };
  if (event.id !== undefined) normalized.id = requireGrowthIdentifier(event.id, `${path}.id`);
  if (event.lineage !== undefined) normalized.lineage = requireGrowthLineage(event.lineage, `${path}.lineage`);
  if (event.targetId !== undefined) normalized.targetId = requireGrowthIdentifier(event.targetId, `${path}.targetId`);
  if (event.details !== undefined) normalized.details = freezeGrowthJson(event.details, `${path}.details`, { maximumValues: 256 });
  return Object.freeze(normalized);
}

function compareGrowthEvents(left, right) {
  for (const field of ['lineage', 'type', 'id', 'targetId']) {
    const comparison = compareGrowthIds(left[field] ?? '', right[field] ?? '');
    if (comparison !== 0) return comparison;
  }
  return compareGrowthIds(JSON.stringify(left.details ?? null), JSON.stringify(right.details ?? null));
}

export function normalizeGrowthPatch(input) {
  requireGrowthPlainObject(input, 'patch');
  assertGrowthKeys(input, [
    'schema', 'version', 'assetId', 'programId', 'programVersion', 'seed', 'tick',
    'baseRevision', 'revision', 'environmentRevision', 'previousStateHash',
    'stateHash', 'reason', 'commands', 'events', 'patchHash',
  ], 'patch');
  if (input.schema !== GROWTH_SCHEMAS.patch || Number(input.version) !== GROWTH_SCHEMA_VERSION) {
    failGrowth('GROWTH_PATCH_VERSION', `Expected ${GROWTH_SCHEMAS.patch} v${GROWTH_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(input.commands) || input.commands.length > GROWTH_LIMITS.MAX_PATCH_COMMANDS) {
    failGrowth('GROWTH_PATCH_COMMAND_LIMIT', `GrowthPatch commands must not exceed ${GROWTH_LIMITS.MAX_PATCH_COMMANDS}`);
  }
  const baseRevision = requireGrowthInteger(input.baseRevision, 'patch.baseRevision');
  const revision = requireGrowthInteger(input.revision, 'patch.revision');
  if (revision !== baseRevision + 1) {
    failGrowth('GROWTH_PATCH_REVISION', 'GrowthPatch revision must advance exactly once', { baseRevision, revision });
  }
  const commands = input.commands.map(normalizeGrowthCommand);
  if (input.events !== undefined && !Array.isArray(input.events)) {
    failGrowth('GROWTH_PATCH_EVENTS', 'GrowthPatch events must be an array');
  }
  if ((input.events?.length ?? 0) > GROWTH_LIMITS.MAX_PATCH_COMMANDS) {
    failGrowth('GROWTH_PATCH_EVENT_LIMIT', `GrowthPatch events must not exceed ${GROWTH_LIMITS.MAX_PATCH_COMMANDS}`);
  }
  const events = (input.events ?? []).map(normalizeGrowthEvent).sort(compareGrowthEvents);
  const touched = new Set();
  for (const command of commands) {
    const key = `${command.type.split('.')[0]}\u0000${command.id}`;
    if (touched.has(key)) {
      failGrowth('GROWTH_PATCH_DUPLICATE_ENTITY', `GrowthPatch touches ${command.id} more than once`, { id: command.id });
    }
    touched.add(key);
  }
  const normalized = {
    schema: GROWTH_SCHEMAS.patch,
    version: GROWTH_SCHEMA_VERSION,
    assetId: requireGrowthIdentifier(input.assetId, 'patch.assetId'),
    programId: requireGrowthIdentifier(input.programId, 'patch.programId'),
    programVersion: requireGrowthInteger(input.programVersion, 'patch.programVersion', { minimum: 1 }),
    seed: requireGrowthInteger(input.seed, 'patch.seed', { maximum: 0xffffffff }),
    tick: requireGrowthInteger(input.tick, 'patch.tick', { minimum: 1 }),
    baseRevision,
    revision,
    environmentRevision: requireGrowthIdentifier(input.environmentRevision, 'patch.environmentRevision'),
    previousStateHash: requireGrowthHash(input.previousStateHash, 'patch.previousStateHash'),
    stateHash: requireGrowthHash(input.stateHash, 'patch.stateHash'),
    reason: requireGrowthIdentifier(input.reason ?? 'growth-step', 'patch.reason'),
    commands: Object.freeze(commands),
    events: Object.freeze(events),
  };
  const patchHash = hashIdFast(normalized, { domain: 'engine-growth-patch', schemaVersion: '1' });
  if (input.patchHash !== undefined && input.patchHash !== patchHash) {
    failGrowth('GROWTH_PATCH_HASH_MISMATCH', 'GrowthPatch hash does not match its canonical contents', {
      expected: patchHash,
      received: input.patchHash,
    });
  }
  return Object.freeze({ ...normalized, patchHash });
}
