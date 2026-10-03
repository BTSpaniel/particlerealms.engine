// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { getWorldDebugSnapshot, isEntityAlive } from "../../ecs/world/World.js";
import { listComponentDefinitions } from "../../ecs/components/ComponentRegistry.js";
import {
  getArchetypeStorageSnapshot,
  getEntityComponentRecord,
  setEntityComponent,
  removeEntityComponent,
} from "../../ecs/storage/ArchetypeStorage.js";

export function createEntityInspectorModel(world, options = {}) {
  if (!world) {
    throw new Error("createEntityInspectorModel: world is required");
  }
  const maxEntitiesOption = options.maxEntities;
  const maxEntities =
    typeof maxEntitiesOption === "number" && maxEntitiesOption > 0
      ? maxEntitiesOption
      : 512;
  const includeComponents =
    options.includeComponents === undefined ? true : !!options.includeComponents;
  const snapshotOptions = {
    includeEntities: true,
    maxEntities,
  };
  const worldSnapshot = getWorldDebugSnapshot(world, snapshotOptions);
  const archetypeSnapshot = getArchetypeStorageSnapshot(world);
  const entityTable = worldSnapshot.entityTable || null;
  const entries =
    entityTable && Array.isArray(entityTable.entries)
      ? entityTable.entries
      : [];
  const entities = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) {
      continue;
    }
    const id = entry.id | 0;
    if (!id || !entry.alive) {
      continue;
    }
    if (!isEntityAlive(world, id)) {
      continue;
    }
    let components = null;
    if (includeComponents) {
      const record = getEntityComponentRecord(world, id);
      components = record || {};
    }
    entities.push({
      id,
      index: entry.index | 0,
      generation: entry.generation | 0,
      alive: !!entry.alive,
      components,
    });
  }
  const componentDefs = listComponentDefinitions();
  const componentTypes = [];
  for (let i = 0; i < componentDefs.length; i++) {
    const def = componentDefs[i];
    if (!def) {
      continue;
    }
    componentTypes.push({
      name: def.name,
      version: def.version,
      defaults: def.defaults,
    });
  }
  return {
    world: {
      name: worldSnapshot.name,
      time: worldSnapshot.time,
      config: worldSnapshot.config,
      stats: worldSnapshot.stats,
    },
    archetypes: archetypeSnapshot,
    entities,
    componentTypes,
  };
}

export function setEntityComponentFromInspector(world, entityId, componentName, value) {
  if (!world) {
    return null;
  }
  return setEntityComponent(world, entityId, componentName, value);
}

export function removeEntityComponentFromInspector(world, entityId, componentName) {
  if (!world) {
    return false;
  }
  return removeEntityComponent(world, entityId, componentName);
}
