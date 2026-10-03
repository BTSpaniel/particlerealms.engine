// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { getArchetypeStorage } from "../storage/ArchetypeStorage.js";

function normalizeNameList(list) {
  if (!list) return [];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const name = list[i];
    if (typeof name !== "string") continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  out.sort();
  return out;
}

function archetypeMatches(archetype, query) {
  const names = archetype.componentNames;

  // all: every required component must be present
  for (let i = 0; i < query.all.length; i++) {
    if (names.indexOf(query.all[i]) === -1) {
      return false;
    }
  }

  // any: at least one present (if any specified)
  if (query.any.length > 0) {
    let found = false;
    for (let i = 0; i < query.any.length; i++) {
      if (names.indexOf(query.any[i]) !== -1) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }

  // none: none of these may be present
  for (let i = 0; i < query.none.length; i++) {
    if (names.indexOf(query.none[i]) !== -1) {
      return false;
    }
  }

  return true;
}

function ensureCompiled(world, query) {
  const storage = getArchetypeStorage(world);
  const version = storage.version | 0;
  if (query._lastVersion === version && query._archetypes) {
    return { storage, archetypes: query._archetypes };
  }

  const archetypes = [];
  for (const archetype of storage.archetypesByKey.values()) {
    if (archetypeMatches(archetype, query)) {
      archetypes.push(archetype);
    }
  }

  query._lastVersion = version;
  query._archetypes = archetypes;
  return { storage, archetypes };
}

export function createQuery(options) {
  const opts = options || {};
  const all = normalizeNameList(opts.all);
  const any = normalizeNameList(opts.any);
  const none = normalizeNameList(opts.none);

  const name = opts.name || opts.debugName || "Query";

  return {
    name,
    all,
    any,
    none,
    _lastVersion: -1,
    _archetypes: null,
  };
}

export function forEachEntity(world, query, callback) {
  if (!world) {
    throw new Error("forEachEntity: world is required");
  }
  if (!query) {
    throw new Error("forEachEntity: query is required");
  }
  if (typeof callback !== "function") {
    throw new Error("forEachEntity: callback(entityId, get, meta) is required");
  }

  const { storage, archetypes } = ensureCompiled(world, query);

  for (let a = 0; a < archetypes.length; a++) {
    const archetype = archetypes[a];
    const entitiesSnapshot = archetype.entities.slice();
    for (let i = 0; i < entitiesSnapshot.length; i++) {
      const entityId = entitiesSnapshot[i];
      const loc = storage.entityLocations.get(entityId);
      if (!loc || loc.key !== archetype.key) {
        continue;
      }
      const rowIndex = loc.index;

      const meta = {
        archetypeKey: archetype.key,
        rowIndex,
        components: archetype.componentNames,
      };

      function getComponent(name) {
        const arr = archetype.componentData[name];
        return arr ? arr[rowIndex] : null;
      }

      callback(entityId, getComponent, meta);
    }
  }
}

export function getQueryDebugSnapshot(world, query) {
  if (!world || !query) {
    return null;
  }
  const { storage, archetypes } = ensureCompiled(world, query);
  const list = [];
  for (let i = 0; i < archetypes.length; i++) {
    const a = archetypes[i];
    list.push({
      key: a.key,
      components: a.componentNames.slice(),
      entityCount: a.entities.length,
    });
  }
  return {
    worldName: world.name,
    queryName: query.name,
    all: query.all.slice(),
    any: query.any.slice(),
    none: query.none.slice(),
    archetypeCount: list.length,
    matchedArchetypes: list,
    totalEntities: storage.entityLocations.size,
  };
}
