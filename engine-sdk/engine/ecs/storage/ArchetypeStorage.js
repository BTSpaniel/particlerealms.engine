// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { getComponentDefinition } from "../components/ComponentRegistry.js";
import {
  isEntityAlive,
  registerEntityDestroyHook,
} from "../world/World.js";

// Cached result object for getLocation (eliminates ~100+ allocs/frame from getEntityComponent)
// Safe because ALL callers destructure immediately and never store the reference
const _locResult = { archetype: null, key: '', index: 0 };
const _cleanupRegisteredWorlds = new WeakSet();

function incrementStorageVersion(storage) {
  if (!Number.isSafeInteger(storage.version) || storage.version < 0) {
    throw new RangeError("ArchetypeStorage version must be a non-negative safe integer");
  }
  if (storage.version === Number.MAX_SAFE_INTEGER) {
    throw new RangeError("ArchetypeStorage version exhausted Number-safe precision");
  }
  storage.version += 1;
}

function requireLiveEntity(world, entityId, operation) {
  if (!isEntityAlive(world, entityId)) {
    throw new RangeError(`${operation}: entity ${entityId} is not alive in this world`);
  }
}

function makeKeyFromNames(names) {
  const sorted = Array.from(new Set(names)).sort();
  return {
    key: sorted.join("|"),
    names: sorted,
  };
}

function getOrCreateStorage(world) {
  if (!world) {
    throw new Error("ArchetypeStorage: world is required");
  }
  if (!world.storage) {
    world.storage = createArchetypeStorage(world);
  }
  return world.storage;
}

export function createArchetypeStorage(world) {
  if (!world) {
    throw new Error("createArchetypeStorage: world is required");
  }
  const storage = {
    world,
    archetypesByKey: new Map(),
    entityLocations: new Map(), // entityId -> { key, index }
    version: 0,
  };
  world.storage = storage;
  if (!_cleanupRegisteredWorlds.has(world)) {
    registerEntityDestroyHook(world, (destroyedWorld, entityId) => {
      const currentStorage = destroyedWorld.storage;
      if (currentStorage && currentStorage.world === destroyedWorld) {
        removeEntityFromStorageState(currentStorage, entityId);
      }
    });
    _cleanupRegisteredWorlds.add(world);
  }
  return storage;
}

export function getArchetypeStorage(world) {
  return getOrCreateStorage(world);
}

function getOrCreateArchetype(storage, componentNames) {
  const { key, names } = makeKeyFromNames(componentNames);
  let archetype = storage.archetypesByKey.get(key);
  if (archetype) {
    return archetype;
  }

  const componentData = {};
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const def = getComponentDefinition(name);
    if (!def) {
      throw new Error(
        "ArchetypeStorage: no component definition registered for " + name
      );
    }
    componentData[name] = [];
  }

  archetype = {
    key,
    componentNames: names,
    entities: [],
    componentData,
  };

  storage.archetypesByKey.set(key, archetype);
  incrementStorageVersion(storage);
  return archetype;
}

function getLocation(storage, entityId) {
  const loc = storage.entityLocations.get(entityId);
  if (!loc) {
    return null;
  }
  const archetype = storage.archetypesByKey.get(loc.key);
  if (!archetype) {
    return null;
  }
  _locResult.archetype = archetype;
  _locResult.key = loc.key;
  _locResult.index = loc.index;
  return _locResult;
}

function removeFromArchetype(storage, archetype, index, updateVersion = true) {
  const last = archetype.entities.length - 1;
  if (!Number.isSafeInteger(index) || index < 0 || index > last) {
    return false;
  }
  const entityId = archetype.entities[index];
  if (last >= 0) {
    const lastEntity = archetype.entities[last];
    if (index !== last) {
      archetype.entities[index] = lastEntity;
    }
    archetype.entities.pop();

    for (let i = 0; i < archetype.componentNames.length; i++) {
      const name = archetype.componentNames[i];
      const arr = archetype.componentData[name];
      if (index !== last) {
        arr[index] = arr[last];
      }
      arr.pop();
    }

    if (index !== last) {
      const loc = storage.entityLocations.get(lastEntity);
      if (loc) {
        loc.index = index;
      }
    }
  }

  storage.entityLocations.delete(entityId);
  if (updateVersion) {
    incrementStorageVersion(storage);
  }
  return true;
}

function removeEntityFromStorageState(storage, entityId) {
  const loc = getLocation(storage, entityId);
  if (!loc) {
    return false;
  }
  return removeFromArchetype(storage, loc.archetype, loc.index);
}

function moveEntityToArchetype(
  storage,
  entityId,
  fromArchetype,
  fromIndex,
  targetComponentNames,
  overrides
) {
  const archetype = getOrCreateArchetype(storage, targetComponentNames);
  const newIndex = archetype.entities.length;
  archetype.entities.push(entityId);

  for (let i = 0; i < archetype.componentNames.length; i++) {
    const name = archetype.componentNames[i];
    const arr = archetype.componentData[name];
    let value;
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, name)) {
      value = overrides[name];
    } else if (
      fromArchetype &&
      fromArchetype.componentNames.indexOf(name) !== -1
    ) {
      const srcArr = fromArchetype.componentData[name];
      value = srcArr[fromIndex];
    } else {
      const def = getComponentDefinition(name);
      value = def ? def.create(undefined) : null;
    }
    arr[newIndex] = value;
  }

  if (fromArchetype) {
    // Remove from the previous archetype first so we drop the old
    // entityLocations entry before writing the new one.
    removeFromArchetype(storage, fromArchetype, fromIndex, false);
  }

  storage.entityLocations.set(entityId, { key: archetype.key, index: newIndex });
  incrementStorageVersion(storage);
}

export function setEntityComponent(world, entityId, componentName, value) {
  requireLiveEntity(world, entityId, "setEntityComponent");
  const storage = getOrCreateStorage(world);
  const def = getComponentDefinition(componentName);
  if (!def) {
    throw new Error(
      "setEntityComponent: unknown component type " + componentName
    );
  }
  const normalized = def.create(value);

  const loc = getLocation(storage, entityId);
  const overrides = { [componentName]: normalized };

  if (!loc) {
    moveEntityToArchetype(storage, entityId, null, -1, [componentName], overrides);
    return normalized;
  }

  const { archetype, index } = loc;
  const names = archetype.componentNames;
  if (names.indexOf(componentName) !== -1) {
    archetype.componentData[componentName][index] = normalized;
    return normalized;
  }

  const nextNames = names.concat(componentName);
  moveEntityToArchetype(storage, entityId, archetype, index, nextNames, overrides);
  return normalized;
}

/**
 * Fast path: update an existing component WITHOUT normalization.
 * Use ONLY when the value is already known-valid (e.g., from physics engine output).
 * The entity MUST already have this component — this will NOT add new components.
 * Returns the value if successful, null if entity/component not found.
 */
export function setEntityComponentDirect(world, entityId, componentName, value) {
  if (!isEntityAlive(world, entityId)) return null;
  const storage = getOrCreateStorage(world);
  const loc = getLocation(storage, entityId);
  if (!loc) return null;
  const { archetype, index } = loc;
  if (archetype.componentNames.indexOf(componentName) === -1) return null;
  archetype.componentData[componentName][index] = value;
  return value;
}

export function removeEntityComponent(world, entityId, componentName) {
  const storage = getOrCreateStorage(world);
  const loc = getLocation(storage, entityId);
  if (!loc) {
    return false;
  }

  const { archetype, index } = loc;
  const names = archetype.componentNames;
  if (names.indexOf(componentName) === -1) {
    return false;
  }

  if (names.length === 1) {
    removeFromArchetype(storage, archetype, index);
    return true;
  }

  const nextNames = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (name !== componentName) {
      nextNames.push(name);
    }
  }

  moveEntityToArchetype(storage, entityId, archetype, index, nextNames, null);
  return true;
}

export function removeEntityFromStorage(world, entityId) {
  const storage = getOrCreateStorage(world);
  return removeEntityFromStorageState(storage, entityId);
}

export function getEntityComponent(world, entityId, componentName) {
  if (!isEntityAlive(world, entityId)) {
    return null;
  }
  const storage = getOrCreateStorage(world);
  const loc = getLocation(storage, entityId);
  if (!loc) {
    return null;
  }
  const { archetype, index } = loc;
  if (archetype.componentNames.indexOf(componentName) === -1) {
    return null;
  }
  const arr = archetype.componentData[componentName];
  return arr[index];
}

export function getEntityComponentRecord(world, entityId) {
  if (!isEntityAlive(world, entityId)) {
    return null;
  }
  const storage = getOrCreateStorage(world);
  const loc = getLocation(storage, entityId);
  if (!loc) {
    return null;
  }
  const { archetype, index } = loc;
  const names = archetype.componentNames;
  const record = {};
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const arr = archetype.componentData[name];
    record[name] = arr[index];
  }
  return record;
}

export function getArchetypeStorageSnapshot(world) {
  const storage = getOrCreateStorage(world);
  const archetypes = [];
  for (const [key, archetype] of storage.archetypesByKey.entries()) {
    archetypes.push({
      key,
      components: archetype.componentNames.slice(),
      entityCount: archetype.entities.length,
    });
  }
  return {
    worldName: world.name,
    archetypeCount: archetypes.length,
    entityCount: storage.entityLocations.size,
    archetypes,
  };
}
