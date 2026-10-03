// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const WORLD_ENTITY_INDEX_BITS = 20;
export const WORLD_ENTITY_INDEX_CAPACITY = 2 ** WORLD_ENTITY_INDEX_BITS;
export const WORLD_ENTITY_INDEX_MASK = WORLD_ENTITY_INDEX_CAPACITY - 1;
export const WORLD_ENTITY_MAX_GENERATION = Math.floor(
  (Number.MAX_SAFE_INTEGER - WORLD_ENTITY_INDEX_MASK) / WORLD_ENTITY_INDEX_CAPACITY
);

const ENTITY_HANDLE_RADIX = 0x100000000;

const DEFAULT_PHASES = [
  "prePhysics",
  "physics",
  "postPhysics",
  "render",
  "lateUpdate",
];

export function positiveSafeEntityHandleReport(value) {
  if (!Number.isSafeInteger(value)) {
    return { valid: false, reason: "not-safe-integer", value: null };
  }
  if (value <= 0) {
    return { valid: false, reason: "not-positive", value: null };
  }
  return { valid: true, reason: "valid", value };
}

export function encodeEntityHandle(index, generation) {
  if (!Number.isSafeInteger(index) || index < 0 || index > WORLD_ENTITY_INDEX_MASK) {
    throw new RangeError("World entity index exceeds the 20-bit entity table");
  }
  if (
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    generation > WORLD_ENTITY_MAX_GENERATION
  ) {
    throw new RangeError("World entity generation exceeds Number-safe handle space");
  }
  const id = generation * WORLD_ENTITY_INDEX_CAPACITY + index;
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new RangeError("World entity handle is not a positive safe integer");
  }
  return id;
}

export function decodeEntityHandle(id) {
  if (!Number.isSafeInteger(id) || id < WORLD_ENTITY_INDEX_CAPACITY) {
    return null;
  }
  const generation = Math.floor(id / WORLD_ENTITY_INDEX_CAPACITY);
  const index = id - generation * WORLD_ENTITY_INDEX_CAPACITY;
  if (
    generation < 1 ||
    generation > WORLD_ENTITY_MAX_GENERATION ||
    index < 0 ||
    index > WORLD_ENTITY_INDEX_MASK ||
    encodeEntityHandle(index, generation) !== id
  ) {
    return null;
  }
  return { index, generation };
}

export function splitEntityHandle(id) {
  const report = positiveSafeEntityHandleReport(id);
  if (!report.valid) {
    throw new RangeError("Entity handle must be a positive safe integer");
  }
  const high = Math.floor(id / ENTITY_HANDLE_RADIX);
  const low = id - high * ENTITY_HANDLE_RADIX;
  return Object.freeze({ low, high });
}

export function joinEntityHandle(low, high) {
  if (!Number.isSafeInteger(low) || low < 0 || low > 0xffffffff) {
    throw new RangeError("Entity handle low word must be an unsigned 32-bit integer");
  }
  if (!Number.isSafeInteger(high) || high < 0 || high > 0x1fffff) {
    throw new RangeError("Entity handle high word exceeds Number-safe handle space");
  }
  const id = low + high * ENTITY_HANDLE_RADIX;
  if (!positiveSafeEntityHandleReport(id).valid) {
    throw new RangeError("Entity handle words do not encode a positive safe integer");
  }
  return id;
}

function requireEntityTables(world) {
  if (
    !world ||
    !Array.isArray(world._entityGenerations) ||
    !Array.isArray(world._entityAlive) ||
    !Array.isArray(world._freeList)
  ) {
    throw new TypeError("World entity tables are required");
  }
}

function reportDestroyHookError(world, id, error) {
  if (typeof world.onEntityDestroyHookError !== "function") {
    return;
  }
  try {
    world.onEntityDestroyHookError(world, id, error);
  } catch (_) {
    // Destruction remains authoritative even when an observer fails.
  }
}

function replaceArrayContents(target, values) {
  target.length = values.length;
  for (let index = 0; index < values.length; index++) {
    target[index] = values[index];
  }
}

export function createWorld(options = {}) {
  const phasesOption =
    options && Array.isArray(options.phases) ? options.phases : null;
  const phases =
    phasesOption && phasesOption.length > 0
      ? phasesOption.slice()
      : DEFAULT_PHASES.slice();

  const world = {
    name: options.name || "World",
    time: {
      tick: 0,
      time: 0,
      fixedDelta: options.fixedDelta || 1 / 60,
    },
    config: {
      phases,
    },
    metrics: {
      lastStepDuration: 0,
      systems: [],
    },
    systems: [],
    _entityGenerations: [],
    _entityAlive: [],
    _freeList: [],
    _entityDestroyHooks: new Set(),
    _entityDestroying: new Set(),
  };

  return world;
}

export function createEntity(world) {
  requireEntityTables(world);
  let index;
  const freeList = world._freeList;
  const gens = world._entityGenerations;
  const alive = world._entityAlive;

  if (freeList.length > 0) {
    index = freeList.pop();
    if (!Number.isSafeInteger(index) || index < 0 || index >= gens.length) {
      throw new RangeError("World free list contains an invalid entity index");
    }
    if (alive[index]) {
      throw new Error("World free list contains a live entity index");
    }
    const currentGeneration = gens[index];
    if (
      !Number.isSafeInteger(currentGeneration) ||
      currentGeneration < 0 ||
      currentGeneration >= WORLD_ENTITY_MAX_GENERATION
    ) {
      throw new RangeError("World entity generation cannot be reused safely");
    }
    gens[index] = currentGeneration + 1;
  } else {
    index = gens.length;
    if (index > WORLD_ENTITY_INDEX_MASK) {
      throw new RangeError("World entity table exhausted its 20-bit index space");
    }
    gens.push(1);
    alive.push(false);
  }

  alive[index] = true;
  const id = encodeEntityHandle(index, gens[index]);
  return id;
}

export function destroyEntity(world, id) {
  requireEntityTables(world);
  const decoded = decodeEntityHandle(id);
  if (!decoded) {
    return false;
  }
  const { index, generation } = decoded;
  const gens = world._entityGenerations;
  const alive = world._entityAlive;
  const freeList = world._freeList;

  if (index < 0 || index >= gens.length) {
    return false;
  }

  const currentGen = gens[index];
  if (!alive[index] || currentGen !== generation) {
    return false;
  }

  const destroying = world._entityDestroying instanceof Set
    ? world._entityDestroying
    : (world._entityDestroying = new Set());
  if (destroying.has(id)) {
    return false;
  }
  destroying.add(id);
  alive[index] = false;
  try {
    const hooks = world._entityDestroyHooks instanceof Set
      ? Array.from(world._entityDestroyHooks)
      : [];
    for (let hookIndex = 0; hookIndex < hooks.length; hookIndex++) {
      try {
        const result = hooks[hookIndex](world, id);
        if (result && typeof result.then === "function") {
          throw new TypeError("World entity destroy hooks must complete synchronously");
        }
      } catch (error) {
        reportDestroyHookError(world, id, error);
      }
    }
  } finally {
    freeList.push(index);
    destroying.delete(id);
  }
  return true;
}

export function isEntityAlive(world, id) {
  if (
    !world ||
    !Array.isArray(world._entityGenerations) ||
    !Array.isArray(world._entityAlive)
  ) {
    return false;
  }
  const decoded = decodeEntityHandle(id);
  if (!decoded) {
    return false;
  }
  const { index, generation } = decoded;
  const gens = world._entityGenerations;
  const alive = world._entityAlive;

  if (index < 0 || index >= gens.length) {
    return false;
  }

  return !!alive[index] && gens[index] === generation;
}

export function registerEntityDestroyHook(world, hook) {
  requireEntityTables(world);
  if (typeof hook !== "function") {
    throw new TypeError("registerEntityDestroyHook requires a function");
  }
  const hooks = world._entityDestroyHooks instanceof Set
    ? world._entityDestroyHooks
    : (world._entityDestroyHooks = new Set());
  hooks.add(hook);
  let registered = true;
  return Object.freeze({
    dispose() {
      if (!registered) {
        return false;
      }
      registered = false;
      return hooks.delete(hook);
    },
  });
}

export function getWorldStats(world) {
  const alive = world._entityAlive;
  let aliveCount = 0;
  for (let i = 0; i < alive.length; i++) {
    if (alive[i]) {
      aliveCount++;
    }
  }

  return {
    name: world.name,
    entitiesAlive: aliveCount,
    capacity: alive.length,
    freeSlots: world._freeList.length,
    tick: world.time.tick,
    time: world.time.time,
  };
}

export function getWorldDebugSnapshot(world, options = {}) {
  const stats = getWorldStats(world);
  const snapshot = {
    name: world.name,
    time: {
      tick: world.time.tick,
      time: world.time.time,
      fixedDelta: world.time.fixedDelta,
    },
    config: {
      phases: Array.isArray(world.config && world.config.phases)
        ? world.config.phases.slice()
        : [],
    },
    stats,
  };

  const includeEntities =
    options.includeEntities === undefined ? true : !!options.includeEntities;
  if (includeEntities) {
    const maxEntities =
      typeof options.maxEntities === "number" && options.maxEntities > 0
        ? options.maxEntities
        : 256;
    const gens = world._entityGenerations;
    const alive = world._entityAlive;
    const entries = [];
    for (let index = 0; index < gens.length; index++) {
      const generation = gens[index];
      const isAlive = !!alive[index];
      entries.push({
        index,
        generation,
        alive: isAlive,
        id: generation ? encodeEntityHandle(index, generation) : 0,
      });
      if (entries.length >= maxEntities) {
        break;
      }
    }
    snapshot.entityTable = {
      count: gens.length,
      entries,
    };
  }

  return snapshot;
}

export function captureWorldSnapshot(world, options) {
  return getWorldDebugSnapshot(world, options);
}

export function restoreWorldFromSnapshot(world, snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }

  if (snapshot.name) {
    world.name = snapshot.name;
  }

  if (snapshot.time) {
    if (typeof snapshot.time.tick === "number") {
      world.time.tick = snapshot.time.tick;
    }
    if (typeof snapshot.time.time === "number") {
      world.time.time = snapshot.time.time;
    }
    if (typeof snapshot.time.fixedDelta === "number") {
      world.time.fixedDelta = snapshot.time.fixedDelta;
    }
  }

  if (snapshot.config && Array.isArray(snapshot.config.phases)) {
    world.config.phases = snapshot.config.phases.slice();
  }

  if (snapshot.entityTable && Array.isArray(snapshot.entityTable.entries)) {
    const nextGenerations = [];
    const nextAlive = [];
    const nextFreeList = [];
    const entries = snapshot.entityTable.entries;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const index = entry.index;
      const generation = entry.generation;
      const isAlive = !!entry.alive;
      if (!Number.isSafeInteger(index) || index < 0 || index > WORLD_ENTITY_INDEX_MASK) {
        throw new RangeError("World snapshot contains an invalid entity index");
      }
      if (
        !Number.isSafeInteger(generation) ||
        generation < 0 ||
        generation > WORLD_ENTITY_MAX_GENERATION ||
        (isAlive && generation < 1)
      ) {
        throw new RangeError("World snapshot contains an invalid entity generation");
      }
      if (index >= nextGenerations.length) {
        const missing = index + 1 - nextGenerations.length;
        for (let j = 0; j < missing; j++) {
          nextGenerations.push(0);
          nextAlive.push(false);
        }
      }
      nextGenerations[index] = generation;
      nextAlive[index] = isAlive;
    }
    for (let index = 0; index < nextGenerations.length; index++) {
      if (!nextAlive[index]) {
        nextFreeList.push(index);
      }
    }
    replaceArrayContents(world._entityGenerations, nextGenerations);
    replaceArrayContents(world._entityAlive, nextAlive);
    replaceArrayContents(world._freeList, nextFreeList);
  }
}

export function stepWorld(world, deltaSeconds) {
  const start =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();

  world.time.time += deltaSeconds;
  world.time.tick++;

  const systems = Array.isArray(world.systems) ? world.systems : [];
  const phases =
    world.config && Array.isArray(world.config.phases)
      ? world.config.phases
      : [undefined];

  const scheduledByPhase = world._scheduledSystemsByPhase || null;

  const metrics = world.metrics;
  metrics.systems.length = 0;

  for (let p = 0; p < phases.length; p++) {
    const phaseName = phases[p];

    const phaseSystems =
      scheduledByPhase && scheduledByPhase[phaseName]
        ? scheduledByPhase[phaseName]
        : systems;

    for (let i = 0; i < phaseSystems.length; i++) {
      const system = phaseSystems[i];
      if (!system || system.enabled === false) {
        continue;
      }
      if (phaseName !== undefined && system.phase !== phaseName) {
        continue;
      }
      if (system.updateKind === "frame") {
        continue;
      }
      if (typeof system.update !== "function") {
        continue;
      }

      const sysStart =
        typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now();
      let error = null;
      try {
        system.update(world, deltaSeconds, system);
      } catch (e) {
        error = e || new Error("Unknown system error");
        if (!system.errorCount) {
          system.errorCount = 0;
        }
        system.errorCount++;
        if (!system.lastError) {
          system.lastError = error;
        }
        if (world.onSystemError && typeof world.onSystemError === "function") {
          try {
            world.onSystemError(world, system, error);
          } catch (hookError) {
            // Swallow errors from error hooks to avoid infinite loops.
          }
        }
      } finally {
        const sysEnd =
          typeof performance !== "undefined" && performance.now
            ? performance.now()
            : Date.now();
        const durationMs = sysEnd - sysStart;
        if (!system.totalTimeMs) {
          system.totalTimeMs = 0;
        }
        system.lastTimeMs = durationMs;
        system.totalTimeMs += durationMs;
        metrics.systems.push({
          id: system.id,
          name: system.name,
          phase: system.phase,
          order: system.order,
          enabled: system.enabled !== false,
          lastTimeMs: durationMs,
          totalTimeMs: system.totalTimeMs,
          errorCount: system.errorCount || 0,
          kind: "tick",
        });
      }
    }
  }

  const end =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  metrics.lastStepDuration = end - start;
}

export function stepWorldFrame(world, deltaSeconds) {
  const start =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();

  const systems = Array.isArray(world.systems) ? world.systems : [];
  const phases =
    world.config && Array.isArray(world.config.phases)
      ? world.config.phases
      : [undefined];

  const scheduledByPhase = world._scheduledSystemsByPhase || null;

  const metrics = world.metrics;
  metrics.systems.length = 0;

  for (let p = 0; p < phases.length; p++) {
    const phaseName = phases[p];

    const phaseSystems =
      scheduledByPhase && scheduledByPhase[phaseName]
        ? scheduledByPhase[phaseName]
        : systems;

    for (let i = 0; i < phaseSystems.length; i++) {
      const system = phaseSystems[i];
      if (!system || system.enabled === false) {
        continue;
      }
      if (phaseName !== undefined && system.phase !== phaseName) {
        continue;
      }
      if (system.updateKind === "tick") {
        continue;
      }
      if (typeof system.update !== "function") {
        continue;
      }

      const sysStart =
        typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now();
      let error = null;
      try {
        system.update(world, deltaSeconds, system);
      } catch (e) {
        error = e || new Error("Unknown system error");
        if (!system.errorCount) {
          system.errorCount = 0;
        }
        system.errorCount++;
        if (!system.lastError) {
          system.lastError = error;
        }
        if (world.onSystemError && typeof world.onSystemError === "function") {
          try {
            world.onSystemError(world, system, error);
          } catch (hookError) {
            // Swallow errors from error hooks to avoid infinite loops.
          }
        }
      } finally {
        const sysEnd =
          typeof performance !== "undefined" && performance.now
            ? performance.now()
            : Date.now();
        const durationMs = sysEnd - sysStart;
        if (!system.totalTimeMs) {
          system.totalTimeMs = 0;
        }
        system.lastTimeMs = durationMs;
        system.totalTimeMs += durationMs;
        metrics.systems.push({
          id: system.id,
          name: system.name,
          phase: system.phase,
          order: system.order,
          enabled: system.enabled !== false,
          lastTimeMs: durationMs,
          totalTimeMs: system.totalTimeMs,
          errorCount: system.errorCount || 0,
          kind: "frame",
        });
      }
    }
  }

  const end =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  metrics.lastStepDuration = end - start;
}

export function debugDecodeEntityId(id) {
  return decodeEntityHandle(id) || { index: 0, generation: 0 };
}
