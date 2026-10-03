// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { validateMatterModelDescriptor } from '../models/MatterModelRegistry.js';
import { cloneAndFreezeStrictJson } from '../../core/schema/StrictJsonValue.js';

function modelKey(descriptor) {
  return `${descriptor.id}@${descriptor.version}`;
}

function pathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);
}

function descriptorCompare(left, right) {
  return left.id.localeCompare(right.id) || left.version - right.version;
}

/**
 * Deterministic coupling graph inferred from declared model read/write sets.
 * An edge A -> B means a write or invalidation from A can dirty a read of B.
 */
export class MatterDependencyGraph {
  #descriptors = new Map();
  #outgoing = new Map();
  #incoming = new Map();
  #dirty = true;
  #ordered = Object.freeze([]);

  constructor(descriptors = []) {
    if (!Array.isArray(descriptors)) throw new TypeError('Matter dependency descriptors must be an array');
    for (const descriptor of descriptors) this.add(descriptor);
  }

  add(descriptor) {
    const safeDescriptor = cloneAndFreezeStrictJson(descriptor, '$.matterModelDescriptor');
    validateMatterModelDescriptor(safeDescriptor, '$.matterModelDescriptor');
    const key = modelKey(safeDescriptor);
    if (this.#descriptors.has(key)) throw new TypeError(`Matter dependency model '${key}' is already present`);
    this.#descriptors.set(key, safeDescriptor);
    this.#dirty = true;
    return this;
  }

  has(modelId, version) {
    return this.#descriptors.has(`${String(modelId)}@${version}`);
  }

  #rebuild() {
    if (!this.#dirty) return;
    this.#outgoing = new Map([...this.#descriptors.keys()].map(key => [key, new Set()]));
    this.#incoming = new Map([...this.#descriptors.keys()].map(key => [key, new Set()]));
    const entries = [...this.#descriptors.entries()];
    for (const [sourceKey, source] of entries) {
      const dirtyPaths = [...source.writes, ...source.invalidates];
      for (const [targetKey, target] of entries) {
        if (sourceKey === targetKey) continue;
        if (!dirtyPaths.some(write => target.reads.some(read => pathsOverlap(write, read)))) continue;
        this.#outgoing.get(sourceKey).add(targetKey);
        this.#incoming.get(targetKey).add(sourceKey);
      }
    }
    const indegree = new Map([...this.#incoming].map(([key, incoming]) => [key, incoming.size]));
    const ready = [...this.#descriptors.keys()]
      .filter(key => indegree.get(key) === 0)
      .sort((left, right) => descriptorCompare(this.#descriptors.get(left), this.#descriptors.get(right)));
    const ordered = [];
    while (ready.length > 0) {
      const key = ready.shift();
      ordered.push(key);
      for (const target of [...this.#outgoing.get(key)].sort()) {
        indegree.set(target, indegree.get(target) - 1);
        if (indegree.get(target) === 0) {
          ready.push(target);
          ready.sort((left, right) => descriptorCompare(this.#descriptors.get(left), this.#descriptors.get(right)));
        }
      }
    }
    if (ordered.length !== this.#descriptors.size) {
      const cyclic = [...indegree.entries()]
        .filter(([, count]) => count > 0)
        .map(([key]) => key)
        .sort();
      throw new TypeError(`Matter model dependency cycle: ${cyclic.join(', ')}`);
    }
    this.#ordered = Object.freeze(ordered.map(key => this.#descriptors.get(key)));
    this.#dirty = false;
  }

  /** Return a deterministic plan for models dirtied by the supplied state paths. */
  plan(changedPaths) {
    if (!Array.isArray(changedPaths)) throw new TypeError('Matter changed paths must be an array');
    for (const [index, path] of changedPaths.entries()) {
      if (typeof path !== 'string' || path.length === 0) {
        throw new TypeError(`Matter changed path ${index} must be a non-empty string`);
      }
    }
    this.#rebuild();
    const selected = new Set();
    const queue = [];
    for (const descriptor of this.#ordered) {
      if (descriptor.reads.some(read => changedPaths.some(path => pathsOverlap(read, path)))) {
        const key = modelKey(descriptor);
        selected.add(key);
        queue.push(key);
      }
    }
    while (queue.length > 0) {
      const source = queue.shift();
      for (const target of this.#outgoing.get(source)) {
        if (selected.has(target)) continue;
        selected.add(target);
        queue.push(target);
      }
    }
    return Object.freeze(this.#ordered.filter(descriptor => selected.has(modelKey(descriptor))));
  }

  order() {
    this.#rebuild();
    return this.#ordered;
  }

  describe() {
    this.#rebuild();
    return Object.freeze(this.#ordered.map(descriptor => Object.freeze({
      modelId: descriptor.id,
      modelVersion: descriptor.version,
      downstream: Object.freeze([...this.#outgoing.get(modelKey(descriptor))].sort()),
    })));
  }
}

export function buildMatterDependencyGraph(registry) {
  if (!registry || typeof registry.list !== 'function') {
    throw new TypeError('Matter model registry with list() is required');
  }
  return new MatterDependencyGraph(registry.list());
}
