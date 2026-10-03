// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const INVALID_REF = 0xffffffff;
const compareCanonicalStrings = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const failBounds = (code, message, details) => { throw Object.assign(new Error(message), { code, details }); };
const normalizeBounds = (value, path = 'bounds') => {
  const min = Array.from(value?.min || []), max = Array.from(value?.max || []);
  if (min.length !== 3 || max.length !== 3 || min.some((coordinate, axis) => !Number.isFinite(coordinate) || !Number.isFinite(max[axis]) || coordinate > max[axis])) failBounds('INVALID_BOUNDS', `${path} needs finite ordered 3D bounds`);
  return { min, max };
};

function unionBounds(a, b) {
  return {
    min: [
      Math.min(a.min[0], b.min[0]),
      Math.min(a.min[1], b.min[1]),
      Math.min(a.min[2], b.min[2]),
    ],
    max: [
      Math.max(a.max[0], b.max[0]),
      Math.max(a.max[1], b.max[1]),
      Math.max(a.max[2], b.max[2]),
    ],
  };
}

function centroid(bounds, axis) {
  return (bounds.min[axis] + bounds.max[axis]) * 0.5;
}

function chooseSplitAxis(items) {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (const item of items) {
    for (let axis = 0; axis < 3; axis++) {
      const value = centroid(item.bounds, axis);
      minimum[axis] = Math.min(minimum[axis], value);
      maximum[axis] = Math.max(maximum[axis], value);
    }
  }
  const extent = maximum.map((value, axis) => value - minimum[axis]);
  if (extent[1] > extent[0] && extent[1] >= extent[2]) return 1;
  if (extent[2] > extent[0] && extent[2] > extent[1]) return 2;
  return 0;
}

function rayBoundsDistance(origin, direction, min, max, maximumDistance) {
  let near = 0;
  let far = maximumDistance;
  for (let axis = 0; axis < 3; axis++) {
    const component = direction[axis];
    if (Math.abs(component) < 1e-15) {
      if (origin[axis] < min[axis] || origin[axis] > max[axis]) return Infinity;
      continue;
    }
    const inverse = 1 / component;
    let first = (min[axis] - origin[axis]) * inverse;
    let second = (max[axis] - origin[axis]) * inverse;
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (near > far) return Infinity;
  }
  return near;
}

export class AabbBvh {
  constructor(leaves = [], { normalize = normalizeBounds, fail = failBounds } = {}) {
    this.normalizeBounds = normalize;
    this.fail = fail;
    if (!Array.isArray(leaves)) this.fail('INVALID_BVH_LEAVES', 'AabbBvh leaves must be an array');
    const ids = new Set();
    this.leaves = leaves.map((leaf, index) => {
      const id = String(leaf?.id ?? index);
      if (ids.has(id)) this.fail('DUPLICATE_BVH_LEAF', `Duplicate BVH leaf id: ${id}`);
      ids.add(id);
      return {
        id,
        sourceIndex: Number.isSafeInteger(leaf?.sourceIndex) ? leaf.sourceIndex : index,
        bounds: this.normalizeBounds(leaf?.bounds, `leaves[${index}].bounds`),
      };
    }).sort((a, b) => compareCanonicalStrings(a.id, b.id));
    this.leafIndexById = new Map(this.leaves.map((leaf, index) => [leaf.id, index]));
    this.root = INVALID_REF;
    this.bounds = new Float64Array(0);
    this.children = new Int32Array(0);
    this.parents = new Int32Array(0);
    this.nodeLeafIndices = new Int32Array(0);
    this.leafNodeIndices = new Int32Array(this.leaves.length).fill(-1);
    this.#build();
  }

  #build() {
    if (this.leaves.length === 0) return;
    const nodes = [];
    const buildNode = (items, parent) => {
      const nodeIndex = nodes.length;
      const node = { parent, left: -1, right: -1, leafIndex: -1, bounds: null };
      nodes.push(node);
      if (items.length === 1) {
        node.leafIndex = items[0].leafIndex;
        node.bounds = items[0].bounds;
        return nodeIndex;
      }
      const axis = chooseSplitAxis(items);
      items.sort((a, b) => {
        const difference = centroid(a.bounds, axis) - centroid(b.bounds, axis);
        return difference || compareCanonicalStrings(a.id, b.id);
      });
      const middle = Math.floor(items.length / 2);
      node.left = buildNode(items.slice(0, middle), nodeIndex);
      node.right = buildNode(items.slice(middle), nodeIndex);
      node.bounds = unionBounds(nodes[node.left].bounds, nodes[node.right].bounds);
      return nodeIndex;
    };
    this.root = buildNode(this.leaves.map((leaf, leafIndex) => ({ ...leaf, leafIndex })), -1);
    this.bounds = new Float64Array(nodes.length * 6);
    this.children = new Int32Array(nodes.length * 2).fill(-1);
    this.parents = new Int32Array(nodes.length).fill(-1);
    this.nodeLeafIndices = new Int32Array(nodes.length).fill(-1);
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
      const node = nodes[nodeIndex];
      this.bounds.set([...node.bounds.min, ...node.bounds.max], nodeIndex * 6);
      this.children[nodeIndex * 2] = node.left;
      this.children[nodeIndex * 2 + 1] = node.right;
      this.parents[nodeIndex] = node.parent;
      this.nodeLeafIndices[nodeIndex] = node.leafIndex;
      if (node.leafIndex >= 0) this.leafNodeIndices[node.leafIndex] = nodeIndex;
    }
  }

  get nodeCount() { return this.nodeLeafIndices.length; }
  get leafCount() { return this.leaves.length; }

  clone() {
    const clone = Object.create(Object.getPrototypeOf(this));
    clone.normalizeBounds = this.normalizeBounds;
    clone.fail = this.fail;
    clone.leaves = this.leaves.map(leaf => ({
      id: leaf.id,
      sourceIndex: leaf.sourceIndex,
      bounds: {
        min: [...leaf.bounds.min],
        max: [...leaf.bounds.max],
      },
    }));
    clone.leafIndexById = new Map(this.leafIndexById);
    clone.root = this.root;
    clone.bounds = new Float64Array(this.bounds);
    clone.children = new Int32Array(this.children);
    clone.parents = new Int32Array(this.parents);
    clone.nodeLeafIndices = new Int32Array(this.nodeLeafIndices);
    clone.leafNodeIndices = new Int32Array(this.leafNodeIndices);
    return clone;
  }

  getNodeBounds(nodeIndex) {
    if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= this.nodeCount) {
      this.fail('BVH_NODE_RANGE', `BVH node ${nodeIndex} is out of range`);
    }
    const offset = nodeIndex * 6;
    return {
      min: Array.from(this.bounds.subarray(offset, offset + 3)),
      max: Array.from(this.bounds.subarray(offset + 3, offset + 6)),
    };
  }

  refit(updates) {
    if (this.nodeCount === 0) return this;
    const entries = updates instanceof Map
      ? [...updates.entries()]
      : Array.isArray(updates)
        ? updates.map((bounds, index) => [this.leaves[index]?.id, bounds])
        : Object.entries(updates || {});
    const changedLeaves = new Set();
    for (const [idValue, boundsValue] of entries) {
      const id = String(idValue);
      const leafIndex = this.leafIndexById.get(id);
      if (leafIndex === undefined) this.fail('UNKNOWN_BVH_LEAF', `Cannot refit unknown BVH leaf ${id}`);
      const bounds = this.normalizeBounds(boundsValue, `updates.${id}`);
      this.leaves[leafIndex].bounds = bounds;
      const nodeIndex = this.leafNodeIndices[leafIndex];
      this.bounds.set([...bounds.min, ...bounds.max], nodeIndex * 6);
      changedLeaves.add(nodeIndex);
    }
    const dirty = new Set();
    for (const nodeIndex of changedLeaves) {
      let parent = this.parents[nodeIndex];
      while (parent >= 0) {
        if (dirty.has(parent)) break;
        dirty.add(parent);
        parent = this.parents[parent];
      }
    }
    const ordered = [...dirty].sort((a, b) => b - a);
    for (const nodeIndex of ordered) {
      const left = this.children[nodeIndex * 2];
      const right = this.children[nodeIndex * 2 + 1];
      for (let axis = 0; axis < 3; axis++) {
        this.bounds[nodeIndex * 6 + axis] = Math.min(this.bounds[left * 6 + axis], this.bounds[right * 6 + axis]);
        this.bounds[nodeIndex * 6 + axis + 3] = Math.max(this.bounds[left * 6 + axis + 3], this.bounds[right * 6 + axis + 3]);
      }
    }
    return this;
  }

  queryAabb(boundsValue, { ordered = true } = {}) {
    if (this.root === INVALID_REF) return [];
    const query = this.normalizeBounds(boundsValue, 'queryBounds');
    const results = [];
    const stack = [this.root];
    while (stack.length > 0) {
      const nodeIndex = stack.pop();
      const offset = nodeIndex * 6;
      if (this.bounds[offset] > query.max[0] || this.bounds[offset + 3] < query.min[0]
        || this.bounds[offset + 1] > query.max[1] || this.bounds[offset + 4] < query.min[1]
        || this.bounds[offset + 2] > query.max[2] || this.bounds[offset + 5] < query.min[2]) continue;
      const leafIndex = this.nodeLeafIndices[nodeIndex];
      if (leafIndex >= 0) {
        results.push(this.leaves[leafIndex]);
      } else {
        stack.push(this.children[nodeIndex * 2 + 1]);
        stack.push(this.children[nodeIndex * 2]);
      }
    }
    return ordered ? results.sort((a, b) => compareCanonicalStrings(a.id, b.id)) : results;
  }

  queryRay(originValue, directionValue, maximumDistance = Infinity) {
    if (this.root === INVALID_REF) return [];
    const origin = Array.from(originValue || []);
    const direction = Array.from(directionValue || []);
    if (origin.length !== 3 || direction.length !== 3 || !origin.every(Number.isFinite) || !direction.every(Number.isFinite)) {
      this.fail('INVALID_RAY', 'BVH ray origin and direction must contain three finite values');
    }
    const directionLength = Math.hypot(...direction);
    if (!(directionLength > 1e-15)) this.fail('INVALID_RAY', 'BVH ray direction cannot be zero');
    const normalizedDirection = direction.map(value => value / directionLength);
    const limit = Number(maximumDistance);
    if (!(limit >= 0) || Number.isNaN(limit)) this.fail('INVALID_RAY', 'maximumDistance must be non-negative');
    const results = [];
    const stack = [this.root];
    while (stack.length > 0) {
      const nodeIndex = stack.pop();
      const offset = nodeIndex * 6;
      const distance = rayBoundsDistance(
        origin,
        normalizedDirection,
        this.bounds.subarray(offset, offset + 3),
        this.bounds.subarray(offset + 3, offset + 6),
        limit,
      );
      if (!Number.isFinite(distance)) continue;
      const leafIndex = this.nodeLeafIndices[nodeIndex];
      if (leafIndex >= 0) {
        results.push({ ...this.leaves[leafIndex], distance });
      } else {
        stack.push(this.children[nodeIndex * 2 + 1]);
        stack.push(this.children[nodeIndex * 2]);
      }
    }
    return results.sort((a, b) => a.distance - b.distance || compareCanonicalStrings(a.id, b.id));
  }

  toGpuArrays() {
    const gpuBounds = new Float32Array(this.nodeCount * 8);
    const metadata = new Uint32Array(this.nodeCount * 4);
    for (let nodeIndex = 0; nodeIndex < this.nodeCount; nodeIndex++) {
      const sourceOffset = nodeIndex * 6;
      const targetOffset = nodeIndex * 8;
      gpuBounds.set(this.bounds.subarray(sourceOffset, sourceOffset + 3), targetOffset);
      gpuBounds.set(this.bounds.subarray(sourceOffset + 3, sourceOffset + 6), targetOffset + 4);
      const childOffset = nodeIndex * 2;
      const leafIndex = this.nodeLeafIndices[nodeIndex];
      metadata[nodeIndex * 4] = this.children[childOffset] < 0 ? INVALID_REF : this.children[childOffset];
      metadata[nodeIndex * 4 + 1] = this.children[childOffset + 1] < 0 ? INVALID_REF : this.children[childOffset + 1];
      metadata[nodeIndex * 4 + 2] = leafIndex < 0 ? INVALID_REF : this.leaves[leafIndex].sourceIndex;
      metadata[nodeIndex * 4 + 3] = leafIndex >= 0 ? 1 : 0;
    }
    return Object.freeze({ bounds: gpuBounds, metadata, root: this.root });
  }
}

export function buildAabbBvh(leaves) {
  return new AabbBvh(leaves);
}
