// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

function ensureWorld(world) {
  if (!world || !Array.isArray(world.systems)) {
    throw new Error("SystemRegistry: world.systems array is required");
  }
}

function makeSystemId(world, baseName) {
  const prefix = baseName || "System";
  const count = world.systems.length;
  return prefix + "#" + count;
}

function normalizeDepList(value) {
  if (!value) {
    return [];
  }
  const out = [];
  const seen = new Set();
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const name = value[i];
      if (typeof name !== "string") continue;
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
  } else if (typeof value === "string") {
    out.push(value);
  }
  return out;
}

function compareSystems(a, b) {
  const ao = a && typeof a.order === "number" ? a.order : 0;
  const bo = b && typeof b.order === "number" ? b.order : 0;
  if (ao !== bo) {
    return ao - bo;
  }
  const an = a && a.name ? a.name : "";
  const bn = b && b.name ? b.name : "";
  if (an < bn) return -1;
  if (an > bn) return 1;
  const ai = a && a.id ? a.id : "";
  const bi = b && b.id ? b.id : "";
  if (ai < bi) return -1;
  if (ai > bi) return 1;
  return 0;
}

function buildPhaseSchedule(phaseName, systems) {
  const n = systems.length;
  if (n === 0) {
    return [];
  }

  const indexById = new Map();
  const indexByName = new Map();
  for (let i = 0; i < n; i++) {
    const s = systems[i];
    indexById.set(s.id, i);
    indexByName.set(s.name, i);
  }

  const inDegree = new Array(n);
  const edges = new Array(n);
  for (let i = 0; i < n; i++) {
    inDegree[i] = 0;
    edges[i] = [];
  }

  function addEdge(fromIndex, toIndex) {
    if (fromIndex === -1 || toIndex === -1) return;
    if (fromIndex === toIndex) return;
    edges[fromIndex].push(toIndex);
    inDegree[toIndex]++;
  }

  for (let i = 0; i < n; i++) {
    const s = systems[i];
    const after = s.after || [];
    const before = s.before || [];

    for (let j = 0; j < after.length; j++) {
      const dep = after[j];
      let idx = indexById.get(dep);
      if (idx === undefined) {
        idx = indexByName.get(dep);
      }
      if (typeof idx === "number") {
        addEdge(idx, i);
      }
    }

    for (let j = 0; j < before.length; j++) {
      const dep = before[j];
      let idx = indexById.get(dep);
      if (idx === undefined) {
        idx = indexByName.get(dep);
      }
      if (typeof idx === "number") {
        addEdge(i, idx);
      }
    }
  }

  const resultIndices = [];
  const queue = [];
  for (let i = 0; i < n; i++) {
    if (inDegree[i] === 0) {
      queue.push(i);
    }
  }

  while (queue.length > 0) {
    queue.sort((ia, ib) => compareSystems(systems[ia], systems[ib]));
    const index = queue.shift();
    resultIndices.push(index);
    const outgoing = edges[index];
    for (let j = 0; j < outgoing.length; j++) {
      const to = outgoing[j];
      inDegree[to]--;
      if (inDegree[to] === 0) {
        queue.push(to);
      }
    }
  }

  if (resultIndices.length !== n) {
    // Cycle or unresolved dependency; fall back to a stable order.
    return systems.slice().sort(compareSystems);
  }

  const ordered = [];
  for (let i = 0; i < resultIndices.length; i++) {
    ordered.push(systems[resultIndices[i]]);
  }
  return ordered;
}

function rebuildSystemSchedule(world) {
  ensureWorld(world);
  const systems = world.systems.slice().filter(Boolean);
  const phases =
    world.config && Array.isArray(world.config.phases)
      ? world.config.phases
      : [];

  const byPhase = Object.create(null);
  for (let i = 0; i < systems.length; i++) {
    const s = systems[i];
    const phaseName = s.phase;
    if (!byPhase[phaseName]) {
      byPhase[phaseName] = [];
    }
    byPhase[phaseName].push(s);
  }

  const schedule = Object.create(null);
  const seen = new Set();

  for (let i = 0; i < phases.length; i++) {
    const phaseName = phases[i];
    const list = byPhase[phaseName] || [];
    schedule[phaseName] = buildPhaseSchedule(phaseName, list);
    seen.add(phaseName);
  }

  const extraPhases = Object.keys(byPhase);
  for (let i = 0; i < extraPhases.length; i++) {
    const phaseName = extraPhases[i];
    if (seen.has(phaseName)) continue;
    const list = byPhase[phaseName] || [];
    schedule[phaseName] = buildPhaseSchedule(phaseName, list);
  }

  world._scheduledSystemsByPhase = schedule;
}

export function registerSystem(world, descriptor) {
  ensureWorld(world);

  if (!descriptor || typeof descriptor !== "object") {
    throw new Error("registerSystem: descriptor object is required");
  }

  if (typeof descriptor.update !== "function") {
    throw new Error("registerSystem: descriptor.update(world, delta, system) is required");
  }

  const systems = world.systems;

  const id = descriptor.id || descriptor.name || makeSystemId(world, "System");
  const name = descriptor.name || id;
  const phaseList =
    world.config && Array.isArray(world.config.phases)
      ? world.config.phases
      : null;
  const defaultPhase =
    phaseList && phaseList.length > 0 ? phaseList[0] : "update";
  const phase = descriptor.phase || defaultPhase;
  const order = typeof descriptor.order === "number" ? descriptor.order : 0;
  const enabled = descriptor.enabled !== false;
  const before = normalizeDepList(descriptor.before);
  const after = normalizeDepList(descriptor.after || descriptor.dependsOn);
  let updateKind = "tick";
  if (
    descriptor.updateKind === "frame" ||
    descriptor.updateKind === "both" ||
    descriptor.updateKind === "tick"
  ) {
    updateKind = descriptor.updateKind;
  } else if (descriptor.perFrame === true) {
    updateKind = "frame";
  }

  const group =
    typeof descriptor.group === "string" && descriptor.group.length > 0
      ? descriptor.group
      : null;

  for (let i = 0; i < systems.length; i++) {
    const s = systems[i];
    if (s && s.id === id) {
      throw new Error("registerSystem: system id already registered: " + id);
    }
  }

  const system = {
    id,
    name,
    phase,
    order,
    enabled,
    updateKind,
    group,
    before,
    after,
    init: typeof descriptor.init === "function" ? descriptor.init : null,
    update: descriptor.update,
    teardown:
      typeof descriptor.teardown === "function" ? descriptor.teardown : null,
    state:
      typeof descriptor.createState === "function"
        ? descriptor.createState(world)
        : descriptor.state !== undefined
        ? descriptor.state
        : null,
  };

  systems.push(system);
  systems.sort(compareSystems);

  if (system.init) {
    system.init(world, system);
  }

  rebuildSystemSchedule(world);

  return system;
}

function findSystemIndex(world, systemOrId) {
  ensureWorld(world);
  const systems = world.systems;
  if (!systems.length) {
    return -1;
  }

  if (typeof systemOrId === "string") {
    for (let i = 0; i < systems.length; i++) {
      const s = systems[i];
      if (s && (s.id === systemOrId || s.name === systemOrId)) {
        return i;
      }
    }
  } else {
    for (let i = 0; i < systems.length; i++) {
      if (systems[i] === systemOrId) {
        return i;
      }
    }
  }

  return -1;
}

export function unregisterSystem(world, systemOrId) {
  ensureWorld(world);
  const systems = world.systems;
  const index = findSystemIndex(world, systemOrId);
  if (index === -1) {
    return false;
  }

  const [system] = systems.splice(index, 1);
  if (system && typeof system.teardown === "function") {
    system.teardown(world, system);
  }

  rebuildSystemSchedule(world);

  return true;
}

export function setSystemEnabled(world, systemOrId, enabled) {
  ensureWorld(world);
  const systems = world.systems;
  const index = findSystemIndex(world, systemOrId);
  if (index === -1) {
    return false;
  }

  const system = systems[index];
  system.enabled = !!enabled;
  return true;
}

export function getRegisteredSystems(world) {
  ensureWorld(world);
  return world.systems.slice();
}

export function setSystemGroupEnabled(world, groupName, enabled) {
  ensureWorld(world);
  if (typeof groupName !== "string" || !groupName) {
    return false;
  }
  const systems = world.systems;
  let changed = false;
  for (let i = 0; i < systems.length; i++) {
    const s = systems[i];
    if (s && s.group === groupName) {
      s.enabled = !!enabled;
      changed = true;
    }
  }
  return changed;
}
