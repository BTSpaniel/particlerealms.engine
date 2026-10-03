// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Typed, read-only adapter from the authoritative ECS Transform + Renderable
 * archetypes to the State-First presentation source protocol.
 *
 * ECS continues to own identity and transform/renderable state. Presentation
 * owns mesh bounds, importance, dirty state, and the currently materialized
 * representation through explicit resolver callbacks. The adapter retains no
 * entity records and applies policy only through `applyPresentation`.
 */

import { transformedAabbBoundingSphereReport } from '../../core/math/MathGeometry.js';
import { createQuery, forEachEntity } from '../../ecs/query/Query.js';
import { getArchetypeStorage } from '../../ecs/storage/ArchetypeStorage.js';
import {
  STATE_FIRST_DIRTY,
  STATE_FIRST_REPRESENTATION,
} from './StateFirstRasterizer.js';
import {
  STATE_FIRST_SOURCE_KIND,
  STATE_FIRST_SOURCE_VERSION,
} from './StateFirstSourceBridge.js';

export const STATE_FIRST_ECS_METADATA_VERSION = 'state-first-ecs-metadata-v1';

const OPTION_KEYS = new Set([
  'id',
  'getLocalBounds',
  'getImportance',
  'getDirtyMask',
  'getCurrentRepresentation',
  'applyPresentation',
]);
const REPRESENTATIONS = new Set(Object.values(STATE_FIRST_REPRESENTATION));
const KNOWN_DIRTY_MASK = Object.values(STATE_FIRST_DIRTY)
  .reduce((mask, value) => mask | value, 0) >>> 0;

function requiredFunction(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function`);
  return value;
}

function nonemptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a nonempty string`);
  return value.trim();
}

function assertExactOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('State-First ECS source options must be an object');
  }
  for (const key of Object.keys(options)) {
    if (!OPTION_KEYS.has(key)) {
      throw new RangeError(`State-First ECS source option '${key}' is not part of ${STATE_FIRST_ECS_METADATA_VERSION}`);
    }
  }
}

function authoritativeStorage(world) {
  if (!world || typeof world !== 'object') {
    throw new TypeError('State-First ECS sources require an ECS world');
  }
  const storage = getArchetypeStorage(world);
  if (!(storage?.archetypesByKey instanceof Map)
    || !(storage.entityLocations instanceof Map)) {
    throw new TypeError('State-First ECS sources require authoritative ArchetypeStorage');
  }
  return storage;
}

function finiteVec3(value, label) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value))
    || value.length !== 3
    || !Array.from(value).every(Number.isFinite)) {
    throw new TypeError(`${label} must be a finite vec3`);
  }
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}

function localBounds(value, entityId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`State-First ECS entity '${entityId}' local bounds must be an object`);
  }
  const min = finiteVec3(value.min, `State-First ECS entity '${entityId}' local bounds min`);
  const max = finiteVec3(value.max, `State-First ECS entity '${entityId}' local bounds max`);
  for (let axis = 0; axis < 3; axis += 1) {
    if (min[axis] > max[axis]) {
      throw new RangeError(`State-First ECS entity '${entityId}' local bounds are unordered`);
    }
  }
  return { min, max };
}

function importanceValue(value, entityId) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`State-First ECS entity '${entityId}' importance must be finite in [0, 1]`);
  }
  return value;
}

function dirtyMaskValue(value, entityId) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`State-First ECS entity '${entityId}' dirty mask must be an unsigned 32-bit integer`);
  }
  const normalized = value >>> 0;
  if ((normalized & (~KNOWN_DIRTY_MASK >>> 0)) !== 0) {
    throw new RangeError(`State-First ECS entity '${entityId}' dirty mask contains unknown ${STATE_FIRST_ECS_METADATA_VERSION} bits`);
  }
  return normalized;
}

function representationValue(value, entityId) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || !REPRESENTATIONS.has(value)) {
    throw new RangeError(`State-First ECS entity '${entityId}' has an unsupported current representation`);
  }
  return value;
}

function presentationEntity(adapter, entityId, transform, renderable) {
  const bounds = localBounds(
    adapter.getLocalBounds(entityId, transform, renderable),
    entityId,
  );
  const worldBounds = transformedAabbBoundingSphereReport(
    bounds.min,
    bounds.max,
    transform?.position,
    transform?.rotation,
    transform?.scale,
  );
  if (!worldBounds.valid || !Number.isFinite(worldBounds.radius) || worldBounds.radius < 0) {
    throw new RangeError(`State-First ECS entity '${entityId}' could not produce finite world bounds`);
  }
  const position = Object.freeze(worldBounds.center.slice());
  return Object.freeze({
    id: entityId,
    position,
    boundsRadius: worldBounds.radius,
    importance: importanceValue(
      adapter.getImportance(entityId, transform, renderable),
      entityId,
    ),
    dirtyMask: dirtyMaskValue(
      adapter.getDirtyMask(entityId, transform, renderable),
      entityId,
    ),
    currentRepresentation: representationValue(
      adapter.getCurrentRepresentation(entityId, transform, renderable),
      entityId,
    ),
    visible: renderable?.visible === true,
  });
}

export class StateFirstEcsSourceAdapter {
  constructor(world, options) {
    authoritativeStorage(world);
    assertExactOptions(options);
    this.world = world;
    this.id = nonemptyString(options.id ?? `${world.name || 'world'}:ecs`, 'State-First ECS source id');
    this.getLocalBounds = requiredFunction(options.getLocalBounds, 'State-First ECS getLocalBounds');
    this.getImportance = requiredFunction(options.getImportance, 'State-First ECS getImportance');
    this.getDirtyMask = requiredFunction(options.getDirtyMask, 'State-First ECS getDirtyMask');
    this.getCurrentRepresentation = requiredFunction(
      options.getCurrentRepresentation,
      'State-First ECS getCurrentRepresentation',
    );
    this.applyPresentation = requiredFunction(options.applyPresentation, 'State-First ECS applyPresentation');
    this.query = createQuery({
      name: `StateFirstEcsSource:${this.id}`,
      all: ['Transform', 'Renderable'],
    });
    this.descriptor = Object.freeze({
      version: STATE_FIRST_SOURCE_VERSION,
      id: this.id,
      kind: STATE_FIRST_SOURCE_KIND.CPU_ENTITIES,
      format: STATE_FIRST_ECS_METADATA_VERSION,
      getEntities: () => this.getEntities(),
      apply: decision => this.apply(decision),
    });
  }

  getStateFirstSourceDescriptor() {
    return this.descriptor;
  }

  getEntities() {
    if (!this.world) throw new Error('State-First ECS source adapter has been destroyed');
    const entities = [];
    forEachEntity(this.world, this.query, (entityId, get) => {
      entities.push(presentationEntity(
        this,
        entityId,
        get('Transform'),
        get('Renderable'),
      ));
    });
    return Object.freeze(entities);
  }

  apply(decision) {
    if (!this.applyPresentation) throw new Error('State-First ECS source adapter has been destroyed');
    return this.applyPresentation(decision);
  }

  destroy() {
    this.world = null;
    this.query = null;
    this.getLocalBounds = null;
    this.getImportance = null;
    this.getDirtyMask = null;
    this.getCurrentRepresentation = null;
    this.applyPresentation = null;
  }
}

export function createStateFirstEcsSourceAdapter(world, options) {
  return new StateFirstEcsSourceAdapter(world, options);
}

export default createStateFirstEcsSourceAdapter;
