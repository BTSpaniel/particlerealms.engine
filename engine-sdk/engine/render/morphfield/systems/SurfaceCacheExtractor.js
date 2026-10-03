// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { solveQef } from './QefSolver.js';
import { SURFACE_EXTRACTOR, selectSurfaceExtractor } from './RepresentationPlanner.js';
import { validateIndexedTriangleMesh } from '../core/MeshTopologyValidation.js';

const CUBE_CORNERS = Object.freeze([
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
]);
const CUBE_EDGES = Object.freeze([
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
]);
// Translation-invariant Freudenthal tetrahedra. Shared cube faces use the same
// diagonal, so independently processed cells cannot crack at equal resolution.
const TETRAHEDRA = Object.freeze([
  [0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6],
  [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6],
]);
const TET_EDGES = Object.freeze([[0, 1], [1, 2], [2, 0], [0, 3], [1, 3], [2, 3]]);
const FACE_NAMES = Object.freeze(['-x', '+x', '-y', '+y', '-z', '+z']);
const MAX_GRID_CELLS = 128 ** 3;

function finiteArray(value, length, name) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length < length) throw new TypeError(`${name} requires ${length} values`);
  const result = Array.from(value).slice(0, length).map(Number);
  if (!result.every(Number.isFinite)) throw new RangeError(`${name} must be finite`);
  return result;
}

function normalizeResolution(value) {
  const raw = typeof value === 'number' ? [value, value, value] : finiteArray(value || [24, 24, 24], 3, 'resolution');
  const result = raw.map((item) => Math.trunc(item));
  if (result.some((item) => item < 2 || item > 512)) throw new RangeError('Surface resolution must be in [2, 512] cells per axis');
  if (result[0] * result[1] * result[2] > MAX_GRID_CELLS) throw new RangeError(`Surface extraction exceeds ${MAX_GRID_CELLS} cells`);
  return result;
}

function validateRequest(request) {
  if (!request || typeof request !== 'object') throw new TypeError('SurfaceCacheRequest is required');
  const domainId = String(request.domainId ?? '');
  if (!domainId) throw new Error('Surface cache domainId is required');
  const bounds = finiteArray(request.bounds, 6, 'bounds');
  if (bounds[3] <= bounds[0] || bounds[4] <= bounds[1] || bounds[5] <= bounds[2]) throw new RangeError('Surface bounds are empty');
  if (typeof request.sample !== 'function' && !(request.samples instanceof Float32Array)) throw new TypeError('Surface request requires sample(position) or Float32Array samples');
  const resolution = normalizeResolution(request.resolution);
  if (request.samples && request.samples.length !== (resolution[0] + 1) * (resolution[1] + 1) * (resolution[2] + 1)) {
    throw new RangeError('Surface sample-grid length does not match resolution');
  }
  const neighborLod = Array.from(request.neighborLod || [request.lod || 0, request.lod || 0, request.lod || 0, request.lod || 0, request.lod || 0, request.lod || 0]);
  if (neighborLod.length !== 6 || neighborLod.some((lod) => !Number.isInteger(lod) || Math.abs(lod - (request.lod || 0)) > 1)) {
    throw new RangeError('Surface neighbors must be present at the same LOD or an exact 2:1 adjacent LOD');
  }
  return {
    ...request, domainId, bounds, resolution, neighborLod,
    isoValue: Number.isFinite(request.isoValue) ? request.isoValue : 0,
    lod: request.lod >>> 0, sourceRevision: request.sourceRevision >>> 0,
    certificateRevision: request.certificateRevision >>> 0,
  };
}

class ScalarGrid {
  constructor(request) {
    this.request = request;
    this.nx = request.resolution[0]; this.ny = request.resolution[1]; this.nz = request.resolution[2];
    this.values = request.samples ? new Float64Array(request.samples) : new Float64Array((this.nx + 1) * (this.ny + 1) * (this.nz + 1));
    if (!request.samples) {
      for (let z = 0; z <= this.nz; z++) for (let y = 0; y <= this.ny; y++) for (let x = 0; x <= this.nx; x++) {
        const value = Number(request.sample(this.position(x, y, z)));
        if (!Number.isFinite(value)) throw new Error(`Surface sampler returned a non-finite value at ${x},${y},${z}`);
        this.values[this.index(x, y, z)] = value;
      }
    }
    for (const value of this.values) if (!Number.isFinite(value)) throw new Error('Surface sample grid contains non-finite values');
  }

  index(x, y, z) { return x + (this.nx + 1) * (y + (this.ny + 1) * z); }
  value(x, y, z) { return this.values[this.index(x, y, z)]; }
  position(x, y, z) {
    const b = this.request.bounds;
    return [b[0] + (b[3] - b[0]) * (x / this.nx), b[1] + (b[4] - b[1]) * (y / this.ny), b[2] + (b[5] - b[2]) * (z / this.nz)];
  }
  sign(value, x, y, z) {
    const delta = value - this.request.isoValue;
    if (Math.abs(delta) > 1e-12) return delta < 0;
    return ((x + y + z) & 1) === 0;
  }
  gradient(position) {
    if (typeof this.request.gradient === 'function') {
      const supplied = finiteArray(this.request.gradient(position), 3, 'surface gradient');
      const length = Math.hypot(...supplied);
      if (length > 1e-12) return supplied.map((v) => v / length);
    }
    if (typeof this.request.sample !== 'function') return [0, 1, 0];
    const b = this.request.bounds;
    const h = Math.max(1e-6, Math.min((b[3] - b[0]) / this.nx, (b[4] - b[1]) / this.ny, (b[5] - b[2]) / this.nz) * 0.25);
    const sample = (x, y, z) => Number(this.request.sample([x, y, z]));
    const n = [
      sample(position[0] + h, position[1], position[2]) - sample(position[0] - h, position[1], position[2]),
      sample(position[0], position[1] + h, position[2]) - sample(position[0], position[1] - h, position[2]),
      sample(position[0], position[1], position[2] + h) - sample(position[0], position[1], position[2] - h),
    ];
    const length = Math.hypot(...n);
    return length > 1e-12 && n.every(Number.isFinite) ? n.map((v) => v / length) : [0, 1, 0];
  }
}

function interpolate(grid, a, b, va, vb) {
  const denominator = vb - va;
  const t = Math.abs(denominator) < 1e-20 ? 0.5 : Math.min(1, Math.max(0, (grid.request.isoValue - va) / denominator));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function triangleAreaSquared(a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  return cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2;
}

class MeshBuilder {
  constructor(grid) { this.grid = grid; this.positions = []; this.normals = []; this.materialRefs = []; this.indices = []; this.edgeVertices = new Map(); }
  vertex(key, position) {
    const existing = this.edgeVertices.get(key); if (existing !== undefined) return existing;
    const index = this.positions.length / 3; const normal = this.grid.gradient(position);
    this.positions.push(...position); this.normals.push(...normal);
    const material = typeof this.grid.request.sampleMaterial === 'function' ? this.grid.request.sampleMaterial(position) : 0;
    this.materialRefs.push(Number.isInteger(material) && material >= 0 ? material >>> 0 : 0);
    this.edgeVertices.set(key, index); return index;
  }
  triangle(a, b, c) {
    if (a === b || b === c || c === a) return;
    const pa = this.positions.slice(a * 3, a * 3 + 3); const pb = this.positions.slice(b * 3, b * 3 + 3); const pc = this.positions.slice(c * 3, c * 3 + 3);
    if (triangleAreaSquared(pa, pb, pc) <= 1e-20) return;
    const ab = pb.map((v, i) => v - pa[i]); const ac = pc.map((v, i) => v - pa[i]);
    const face = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const normal = [0, 1, 2].map((i) => this.normals[a * 3 + i] + this.normals[b * 3 + i] + this.normals[c * 3 + i]);
    if (face[0] * normal[0] + face[1] * normal[1] + face[2] * normal[2] < 0) this.indices.push(a, c, b); else this.indices.push(a, b, c);
  }
  finish(metadata) {
    return createEntry(metadata, new Float32Array(this.positions), new Float32Array(this.normals), new Uint32Array(this.materialRefs), new Uint32Array(this.indices));
  }
}

function nodeKey(x, y, z) { return `${x},${y},${z}`; }
function edgeKey(a, b) { const ka = nodeKey(...a); const kb = nodeKey(...b); return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`; }

function extractRegular(request, grid) {
  const builder = new MeshBuilder(grid);
  for (let z = 0; z < grid.nz; z++) for (let y = 0; y < grid.ny; y++) for (let x = 0; x < grid.nx; x++) {
    const nodes = CUBE_CORNERS.map(([dx, dy, dz]) => [x + dx, y + dy, z + dz]);
    const positions = nodes.map((node) => grid.position(...node)); const values = nodes.map((node) => grid.value(...node));
    for (const tet of TETRAHEDRA) {
      const crossings = [];
      for (const [ta, tb] of TET_EDGES) {
        const ca = tet[ta]; const cb = tet[tb]; const na = nodes[ca]; const nb = nodes[cb];
        if (grid.sign(values[ca], ...na) === grid.sign(values[cb], ...nb)) continue;
        const key = edgeKey(na, nb); const position = interpolate(grid, positions[ca], positions[cb], values[ca], values[cb]);
        crossings.push(builder.vertex(key, position));
      }
      const unique = Array.from(new Set(crossings));
      if (unique.length === 3) builder.triangle(unique[0], unique[1], unique[2]);
      else if (unique.length === 4) {
        const p = unique.map((index) => builder.positions.slice(index * 3, index * 3 + 3));
        const d02 = p[0].reduce((sum, v, i) => sum + (v - p[2][i]) ** 2, 0); const d13 = p[1].reduce((sum, v, i) => sum + (v - p[3][i]) ** 2, 0);
        if (d02 <= d13) { builder.triangle(unique[0], unique[1], unique[2]); builder.triangle(unique[0], unique[2], unique[3]); }
        else { builder.triangle(unique[0], unique[1], unique[3]); builder.triangle(unique[1], unique[2], unique[3]); }
      }
    }
  }
  return builder.finish({
    request,
    extractorKind: 'regular-transition',
    transitionMode: request.neighborLod.some((lod) => lod !== request.lod) ? 'full-domain-promotion-required' : 'equal-resolution',
    topologyGuarantee: 'finite-index-edge-incidence-audited',
  });
}

function extractDual(request, grid) {
  const positions = []; const normals = []; const materialRefs = []; const indices = []; const cellVertices = new Map();
  const cellKey = (x, y, z) => `${x},${y},${z}`;
  for (let z = 0; z < grid.nz; z++) for (let y = 0; y < grid.ny; y++) for (let x = 0; x < grid.nx; x++) {
    const nodes = CUBE_CORNERS.map(([dx, dy, dz]) => [x + dx, y + dy, z + dz]);
    const values = nodes.map((node) => grid.value(...node)); const signs = nodes.map((node, i) => grid.sign(values[i], ...node));
    if (signs.every(Boolean) || signs.every((value) => !value)) continue;
    const intersections = []; const hermiteNormals = [];
    for (const [a, b] of CUBE_EDGES) {
      if (signs[a] === signs[b]) continue;
      const pa = grid.position(...nodes[a]); const pb = grid.position(...nodes[b]);
      const point = interpolate(grid, pa, pb, values[a], values[b]);
      intersections.push(point); hermiteNormals.push(grid.gradient(point));
    }
    if (intersections.length < 3) continue;
    const min = grid.position(x, y, z); const max = grid.position(x + 1, y + 1, z + 1);
    const solution = solveQef(intersections, hermiteNormals, [...min, ...max], request.qefOptions);
    const index = positions.length / 3; positions.push(...solution.position);
    const normal = hermiteNormals.reduce((sum, n) => [sum[0] + n[0], sum[1] + n[1], sum[2] + n[2]], [0, 0, 0]);
    const length = Math.hypot(...normal) || 1; normals.push(normal[0] / length, normal[1] / length, normal[2] / length);
    const material = typeof request.sampleMaterial === 'function' ? request.sampleMaterial(solution.position) : 0;
    materialRefs.push(Number.isInteger(material) && material >= 0 ? material >>> 0 : 0); cellVertices.set(cellKey(x, y, z), index);
  }
  const addQuad = (cells, insideAtStart) => {
    const quad = cells.map((cell) => cellVertices.get(cellKey(...cell)));
    if (quad.some((index) => index === undefined) || new Set(quad).size !== 4) return;
    const ordered = insideAtStart ? quad : [quad[0], quad[3], quad[2], quad[1]];
    const p = ordered.map((index) => positions.slice(index * 3, index * 3 + 3));
    const d02 = p[0].reduce((sum, v, i) => sum + (v - p[2][i]) ** 2, 0); const d13 = p[1].reduce((sum, v, i) => sum + (v - p[3][i]) ** 2, 0);
    if (d02 <= d13) indices.push(ordered[0], ordered[1], ordered[2], ordered[0], ordered[2], ordered[3]);
    else indices.push(ordered[0], ordered[1], ordered[3], ordered[1], ordered[2], ordered[3]);
  };
  for (let z = 1; z < grid.nz; z++) for (let y = 1; y < grid.ny; y++) for (let x = 0; x < grid.nx; x++) {
    if (grid.sign(grid.value(x, y, z), x, y, z) !== grid.sign(grid.value(x + 1, y, z), x + 1, y, z)) addQuad([[x, y - 1, z - 1], [x, y, z - 1], [x, y, z], [x, y - 1, z]], grid.sign(grid.value(x, y, z), x, y, z));
  }
  for (let z = 1; z < grid.nz; z++) for (let y = 0; y < grid.ny; y++) for (let x = 1; x < grid.nx; x++) {
    if (grid.sign(grid.value(x, y, z), x, y, z) !== grid.sign(grid.value(x, y + 1, z), x, y + 1, z)) addQuad([[x - 1, y, z - 1], [x - 1, y, z], [x, y, z], [x, y, z - 1]], grid.sign(grid.value(x, y, z), x, y, z));
  }
  for (let z = 0; z < grid.nz; z++) for (let y = 1; y < grid.ny; y++) for (let x = 1; x < grid.nx; x++) {
    if (grid.sign(grid.value(x, y, z), x, y, z) !== grid.sign(grid.value(x, y, z + 1), x, y, z + 1)) addQuad([[x - 1, y - 1, z], [x, y - 1, z], [x, y, z], [x - 1, y, z]], grid.sign(grid.value(x, y, z), x, y, z));
  }
  return createEntry({ request, extractorKind: SURFACE_EXTRACTOR.MANIFOLD_DUAL, transitionMode: 'coherent-domain', topologyGuarantee: 'finite-index-edge-incidence-audited' }, new Float32Array(positions), new Float32Array(normals), new Uint32Array(materialRefs), new Uint32Array(indices));
}

function createEntry(metadata, positions, normals, materialRefs, indices) {
  const request = metadata.request;
  const validation = validateMesh({ positions, normals, indices }, request.topologyRequirement || request.intent?.topologyRequirement);
  const signatures = boundarySignatures(positions, request.bounds);
  const bytes = positions.byteLength + normals.byteLength + materialRefs.byteLength + indices.byteLength;
  return Object.freeze({
    domainId: request.domainId, sourceRevision: request.sourceRevision,
    certificateRevision: request.certificateRevision, extractorKind: metadata.extractorKind,
    extractorRevision: 1, transitionMode: metadata.transitionMode, topologyGuarantee: metadata.topologyGuarantee,
    bounds: Object.freeze(request.bounds.slice()), lod: request.lod,
    positions, normals, materialRefs, indices,
    vertexCount: positions.length / 3, indexCount: indices.length, triangleCount: indices.length / 3,
    bytes, measuredError: Number(request.measuredError ?? 0),
    boundarySignatures: Object.freeze(signatures), validation: Object.freeze(validation),
  });
}

export function validateMesh(mesh, topologyRequirement = 'unspecified') {
  return validateIndexedTriangleMesh(mesh, { topologyRequirement });
}

function boundarySignatures(positions, bounds) {
  const epsilon = Math.max(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2]) * 1e-6 + 1e-9;
  const faces = Array.from({ length: 6 }, () => []);
  for (let i = 0; i < positions.length; i += 3) {
    const p = [positions[i], positions[i + 1], positions[i + 2]];
    if (Math.abs(p[0] - bounds[0]) <= epsilon) faces[0].push(p);
    if (Math.abs(p[0] - bounds[3]) <= epsilon) faces[1].push(p);
    if (Math.abs(p[1] - bounds[1]) <= epsilon) faces[2].push(p);
    if (Math.abs(p[1] - bounds[4]) <= epsilon) faces[3].push(p);
    if (Math.abs(p[2] - bounds[2]) <= epsilon) faces[4].push(p);
    if (Math.abs(p[2] - bounds[5]) <= epsilon) faces[5].push(p);
  }
  return Object.fromEntries(faces.map((points, index) => [FACE_NAMES[index], hashBoundary(points, bounds)]));
}

function hashBoundary(points, bounds) {
  const scale = 1e6 / Math.max(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2], 1e-9);
  const records = points.map((p) => p.map((value, axis) => Math.round((value - bounds[axis]) * scale)).join(',')).sort();
  let hash = 0x811c9dc5;
  for (const char of records.join('|')) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash.toString(16).padStart(8, '0');
}

/** Device-independent surface cache extractor and validation boundary. */
export class SurfaceCacheExtractor {
  extract(input) {
    const request = validateRequest(input); const grid = new ScalarGrid(request);
    const requested = request.extractorPolicy === 'auto'
      ? selectSurfaceExtractor(request.intent, { certifiedHermite: request.certifiedHermite === true })
      : request.extractorPolicy;
    if (requested === SURFACE_EXTRACTOR.DIRECT) return null;
    const entry = requested === SURFACE_EXTRACTOR.MANIFOLD_DUAL ? extractDual(request, grid) : extractRegular(request, grid);
    if (!entry.validation.valid) throw new Error(`Surface cache validation failed: ${entry.validation.errors.join('; ')}`);
    if (requested === SURFACE_EXTRACTOR.REGULAR_TRANSITION && entry.transitionMode === 'full-domain-promotion-required') {
      throw new Error('Exact 2:1 transition data is not present; promote the connected domain to a shared resolution before publication');
    }
    return entry;
  }
}

/** Stages complete connected domains and atomically replaces validated entries. */
export class SurfaceCacheManager {
  constructor(options = {}) {
    this.extractor = options.extractor || new SurfaceCacheExtractor(); this.entries = new Map(); this.staged = new Map(); this.revision = 0;
  }
  stage(request) { const entry = this.extractor.extract(request); if (entry) this.staged.set(entry.domainId, entry); return entry; }
  /**
   * Crack-safe portable fallback for a connected mixed-LOD domain. Every member
   * is resampled at the finest cell size before staging, trading memory for an
   * exact shared boundary until a validated transition-cell backend is active.
   */
  stageConnected(requests) {
    if (!Array.isArray(requests) || !requests.length) throw new TypeError('stageConnected requires one or more requests');
    const validated = requests.map(validateRequest);
    const finest = [Infinity, Infinity, Infinity];
    for (const request of validated) for (let axis = 0; axis < 3; axis++) {
      finest[axis] = Math.min(finest[axis], (request.bounds[axis + 3] - request.bounds[axis]) / request.resolution[axis]);
    }
    const entries = [];
    for (const request of validated) {
      const resolution = [0, 1, 2].map((axis) => Math.max(2, Math.round((request.bounds[axis + 3] - request.bounds[axis]) / finest[axis])));
      const promoted = {
        ...request,
        resolution,
        samples: undefined,
        neighborLod: [request.lod, request.lod, request.lod, request.lod, request.lod, request.lod],
      };
      if (typeof promoted.sample !== 'function') throw new Error(`Connected-domain promotion for ${request.domainId} requires a source sampler`);
      const entry = this.extractor.extract(promoted);
      if (entry) { this.staged.set(entry.domainId, entry); entries.push(entry); }
    }
    return entries;
  }
  discard(domainId) { this.staged.delete(String(domainId)); }
  publish(domainId, neighborChecks = []) {
    const id = String(domainId); const entry = this.staged.get(id); if (!entry) throw new Error(`No staged surface domain ${id}`);
    for (const check of neighborChecks) {
      const neighbor = this.staged.get(String(check.domainId)) || this.entries.get(String(check.domainId));
      if (!neighbor) throw new Error(`Missing neighboring surface domain ${check.domainId}`);
      if (entry.extractorKind !== neighbor.extractorKind) throw new Error('Different extractor kinds cannot share a mesh border');
      if (entry.boundarySignatures[check.face] !== neighbor.boundarySignatures[check.neighborFace]) throw new Error(`Boundary signature mismatch on ${id}:${check.face}`);
    }
    this.entries.set(id, entry); this.staged.delete(id); this.revision++; return entry;
  }
  get(domainId) { return this.entries.get(String(domainId)) || null; }
  remove(domainId) { this.staged.delete(String(domainId)); return this.entries.delete(String(domainId)); }
  getStats() { return { revision: this.revision, publishedDomains: this.entries.size, stagedDomains: this.staged.size, bytes: Array.from(this.entries.values()).reduce((sum, entry) => sum + entry.bytes, 0) }; }
}
