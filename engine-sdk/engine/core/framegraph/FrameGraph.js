// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

let nextFrameGraphId = 1;

function createResourceRecord(name, descriptor) {
  const kind = descriptor && descriptor.kind ? descriptor.kind : "generic";
  const external = !!(descriptor && descriptor.external);
  const aliasKey = descriptor && descriptor.aliasKey ? descriptor.aliasKey : null;

  return {
    name,
    kind,
    external,
    aliasKey,
    descriptor: descriptor || {},
    firstPassIndex: null,
    lastPassIndex: null,
    readers: [],
    writers: [],
    aliasId: null,
  };
}

function buildDependencyGraph(passes, resources) {
  const passCount = passes.length;
  const adjacency = new Map();
  const inDegree = new Map();

  for (let i = 0; i < passCount; i += 1) {
    adjacency.set(i, new Set());
    inDegree.set(i, 0);
  }

  for (const resource of resources.values()) {
    const writers = resource.writers;
    const readers = resource.readers;

    for (let wi = 0; wi < writers.length; wi += 1) {
      const w = writers[wi];

      for (let rIndex = 0; rIndex < readers.length; rIndex += 1) {
        const r = readers[rIndex];
        if (r > w) {
          const edges = adjacency.get(w);
          if (!edges.has(r)) {
            edges.add(r);
            inDegree.set(r, inDegree.get(r) + 1);
          }
        }
      }

      for (let rIndex = 0; rIndex < readers.length; rIndex += 1) {
        const r = readers[rIndex];
        if (w > r) {
          const edges = adjacency.get(r);
          if (!edges.has(w)) {
            edges.add(w);
            inDegree.set(w, inDegree.get(w) + 1);
          }
        }
      }

      for (let wj = wi + 1; wj < writers.length; wj += 1) {
        const w2 = writers[wj];
        if (w2 > w) {
          const edges = adjacency.get(w);
          if (!edges.has(w2)) {
            edges.add(w2);
            inDegree.set(w2, inDegree.get(w2) + 1);
          }
        }
      }
    }
  }

  return { adjacency, inDegree };
}

function topoSort(passes, graph) {
  const { adjacency, inDegree } = graph;
  const order = [];
  const queue = [];

  for (let i = 0; i < passes.length; i += 1) {
    if (inDegree.get(i) === 0) {
      queue.push(i);
    }
  }

  while (queue.length > 0) {
    const node = queue.shift();
    order.push(node);

    for (const neighbor of adjacency.get(node)) {
      const nextDegree = inDegree.get(neighbor) - 1;
      inDegree.set(neighbor, nextDegree);
      if (nextDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (order.length !== passes.length) {
    throw new Error("FrameGraph: cyclic dependency detected between passes");
  }

  return order;
}

function computeResourceLifetimes(passes, resources) {
  for (let i = 0; i < passes.length; i += 1) {
    const pass = passes[i];

    for (const name of pass.reads) {
      const resource = resources.get(name);
      if (!resource) {
        throw new Error(`FrameGraph: pass '${pass.name}' reads unknown resource '${name}'`);
      }
      resource.readers.push(i);
      if (resource.firstPassIndex === null || i < resource.firstPassIndex) {
        resource.firstPassIndex = i;
      }
      if (resource.lastPassIndex === null || i > resource.lastPassIndex) {
        resource.lastPassIndex = i;
      }
    }

    for (const name of pass.writes) {
      const resource = resources.get(name);
      if (!resource) {
        throw new Error(`FrameGraph: pass '${pass.name}' writes unknown resource '${name}'`);
      }
      resource.writers.push(i);
      if (resource.firstPassIndex === null || i < resource.firstPassIndex) {
        resource.firstPassIndex = i;
      }
      if (resource.lastPassIndex === null || i > resource.lastPassIndex) {
        resource.lastPassIndex = i;
      }
    }
  }
}

function computeAliasing(resources) {
  const internalResources = [];

  for (const resource of resources.values()) {
    if (!resource.external && resource.aliasKey) {
      internalResources.push(resource);
    }
  }

  internalResources.sort((a, b) => {
    return a.firstPassIndex - b.firstPassIndex;
  });

  const aliasSlots = [];
  let nextAliasId = 1;

  for (const resource of internalResources) {
    let chosenSlot = null;

    for (const slot of aliasSlots) {
      if (
        slot.aliasKey === resource.aliasKey &&
        slot.lastPassIndex < resource.firstPassIndex
      ) {
        chosenSlot = slot;
        break;
      }
    }

    if (!chosenSlot) {
      chosenSlot = {
        aliasKey: resource.aliasKey,
        aliasId: `alias_${nextAliasId}`,
        lastPassIndex: resource.lastPassIndex,
      };
      nextAliasId += 1;
      aliasSlots.push(chosenSlot);
    } else {
      chosenSlot.lastPassIndex = resource.lastPassIndex;
    }

    resource.aliasId = chosenSlot.aliasId;
  }
}

function createCompiledFrameGraph(id, passes, order, resources) {
  const orderedPasses = order.map((index) => passes[index]);

  function execute(context) {
    for (let i = 0; i < orderedPasses.length; i += 1) {
      const pass = orderedPasses[i];
      const info = {
        index: i,
        name: pass.name,
        kind: pass.kind,
        reads: pass.reads.slice(),
        writes: pass.writes.slice(),
      };

      pass.execute(context, info);
    }
  }

  function getDebugSnapshot() {
    const resourceSnapshot = [];
    for (const resource of resources.values()) {
      resourceSnapshot.push({
        name: resource.name,
        kind: resource.kind,
        external: resource.external,
        aliasKey: resource.aliasKey,
        aliasId: resource.aliasId,
        firstPassIndex: resource.firstPassIndex,
        lastPassIndex: resource.lastPassIndex,
        readers: resource.readers.slice(),
        writers: resource.writers.slice(),
      });
    }

    const passSnapshot = orderedPasses.map((pass, index) => ({
      index,
      name: pass.name,
      kind: pass.kind,
      reads: pass.reads.slice(),
      writes: pass.writes.slice(),
    }));

    return {
      id,
      passes: passSnapshot,
      resources: resourceSnapshot,
    };
  }

  return {
    id,
    execute,
    getDebugSnapshot,
  };
}

export function createFrameGraph() {
  const id = nextFrameGraphId;
  nextFrameGraphId += 1;

  const passes = [];
  const resources = new Map();

  function addResource(name, descriptor = {}) {
    if (!name) {
      throw new Error("FrameGraph: resource name is required");
    }
    if (resources.has(name)) {
      throw new Error(`FrameGraph: resource '${name}' already exists`);
    }

    const record = createResourceRecord(name, descriptor);
    resources.set(name, record);
    return record;
  }

  function addPass(options) {
    const name = options && options.name ? options.name : null;
    if (!name) {
      throw new Error("FrameGraph: pass name is required");
    }

    const kind = options.kind || "generic";
    const reads = Array.isArray(options.reads) ? options.reads.slice() : [];
    const writes = Array.isArray(options.writes) ? options.writes.slice() : [];
    const execute = typeof options.execute === "function" ? options.execute : null;

    if (!execute) {
      throw new Error(`FrameGraph: pass '${name}' requires an execute(context, info) function`);
    }

    passes.push({ name, kind, reads, writes, execute });
  }

  function compile() {
    for (const resource of resources.values()) {
      resource.firstPassIndex = null;
      resource.lastPassIndex = null;
      resource.readers.length = 0;
      resource.writers.length = 0;
      resource.aliasId = null;
    }

    computeResourceLifetimes(passes, resources);

    const graph = buildDependencyGraph(passes, resources);
    const order = topoSort(passes, graph);

    computeAliasing(resources);

    return createCompiledFrameGraph(id, passes, order, resources);
  }

  function getResources() {
    return resources;
  }

  function getPasses() {
    return passes.slice();
  }

  return {
    id,
    addResource,
    addPass,
    compile,
    getResources,
    getPasses,
  };
}
