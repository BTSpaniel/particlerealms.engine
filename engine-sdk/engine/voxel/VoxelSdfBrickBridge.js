// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { SparsePageRuntime } from '../core/gpu/SparsePageRuntime.js';

const DEFAULT_FINE_RESOLUTION = 11;
const DEFAULT_COARSE_RESOLUTION = 5;

function positiveFinite(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new RangeError(`${name} must be positive and finite`);
  return number;
}

function positiveInteger(value, name, maximum = 256) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 2 || number > maximum) {
    throw new RangeError(`${name} must be an integer from 2 through ${maximum}`);
  }
  return number;
}

function revision(value, name) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0 || number > 0xffffffff) {
    throw new RangeError(`${name} must be a uint32`);
  }
  return number;
}

function chunkCoordinates(value) {
  if (!Array.isArray(value) || value.length !== 3) throw new TypeError('chunk must contain three integer coordinates');
  const result = value.map(Number);
  if (result.some(component => !Number.isSafeInteger(component))) {
    throw new RangeError('chunk coordinates must be safe integers');
  }
  return result;
}

function boxDistance(point, center, halfExtent) {
  const qx = Math.abs(point[0] - center[0]) - halfExtent;
  const qy = Math.abs(point[1] - center[1]) - halfExtent;
  const qz = Math.abs(point[2] - center[2]) - halfExtent;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
  return outside + Math.min(Math.max(qx, qy, qz), 0);
}

function occupiedCells({ chunk, chunkSize, voxelSize, isSolid }) {
  if (typeof isSolid !== 'function') throw new TypeError('isSolid(globalX, globalY, globalZ) is required');
  const cells = [];
  for (let z = -1; z <= chunkSize; z += 1) {
    for (let y = -1; y <= chunkSize; y += 1) {
      for (let x = -1; x <= chunkSize; x += 1) {
        const gx = chunk[0] * chunkSize + x;
        const gy = chunk[1] * chunkSize + y;
        const gz = chunk[2] * chunkSize + z;
        if (!isSolid(gx, gy, gz)) continue;
        cells.push(Object.freeze({
          center: Object.freeze([(x + 0.5) * voxelSize, (y + 0.5) * voxelSize, (z + 0.5) * voxelSize]),
        }));
      }
    }
  }
  return cells;
}

function sampleExactVoxelUnion(point, cells, voxelSize, emptyDistance) {
  let distance = emptyDistance;
  const halfExtent = voxelSize * 0.5;
  for (const cell of cells) distance = Math.min(distance, boxDistance(point, cell.center, halfExtent));
  return distance;
}

function sampleBrick({ cells, bounds, resolution, voxelSize, conservative }) {
  const dimensions = [resolution, resolution, resolution];
  const spacing = bounds.max.map((maximum, axis) => (maximum - bounds.min[axis]) / (resolution - 1));
  const conservativeInflation = conservative ? Math.hypot(...spacing) : 0;
  const emptyDistance = Math.hypot(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ) + voxelSize;
  const values = new Array(resolution ** 3);
  let write = 0;
  for (let z = 0; z < resolution; z += 1) {
    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        const point = [
          bounds.min[0] + spacing[0] * x,
          bounds.min[1] + spacing[1] * y,
          bounds.min[2] + spacing[2] * z,
        ];
        values[write] = Math.fround(
          sampleExactVoxelUnion(point, cells, voxelSize, emptyDistance) - conservativeInflation,
        );
        write += 1;
      }
    }
  }
  return Object.freeze({
    dimensions: Object.freeze(dimensions),
    values: Object.freeze(values),
    spacing: Object.freeze(spacing),
    conservativeInflation,
  });
}

/**
 * Convert one voxel chunk plus a one-voxel neighbor apron into independently
 * generated coarse and fine sampled-field pages. The coarse page is an
 * intentionally expanded conservative proxy, so a fine-page miss degrades
 * shape accuracy instead of silently removing occupied geometry.
 */
export function buildVoxelSdfBrickPair(options = {}) {
  const chunk = chunkCoordinates(options.chunk ?? [0, 0, 0]);
  const chunkSize = positiveInteger(options.chunkSize ?? 32, 'chunkSize', 128);
  const voxelSize = positiveFinite(options.voxelSize ?? 1, 'voxelSize');
  const fineResolution = positiveInteger(options.fineResolution ?? DEFAULT_FINE_RESOLUTION, 'fineResolution', 129);
  const coarseResolution = positiveInteger(options.coarseResolution ?? DEFAULT_COARSE_RESOLUTION, 'coarseResolution', 65);
  if (coarseResolution > fineResolution) throw new RangeError('coarseResolution cannot exceed fineResolution');
  const sourceRevision = revision(options.sourceRevision, 'sourceRevision');
  const certificateRevision = revision(options.certificateRevision ?? sourceRevision, 'certificateRevision');
  const extent = chunkSize * voxelSize;
  const bounds = Object.freeze({
    min: Object.freeze([-voxelSize, -voxelSize, -voxelSize]),
    max: Object.freeze([extent + voxelSize, extent + voxelSize, extent + voxelSize]),
  });
  const cells = occupiedCells({ chunk, chunkSize, voxelSize, isSolid: options.isSolid });
  const coarseGrid = sampleBrick({ cells, bounds, resolution: coarseResolution, voxelSize, conservative: true });
  const fineGrid = sampleBrick({ cells, bounds, resolution: fineResolution, voxelSize, conservative: false });
  const prefix = String(options.keyPrefix ?? `voxel:${chunk.join(',')}`);
  const coarseKey = `${prefix}:coarse`;
  const fineKey = `${prefix}:fine`;
  const transform = Object.freeze({ translation: Object.freeze(chunk.map(component => component * extent)) });
  const makePayload = grid => Object.freeze({
    kind: 'sampled-field',
    bounds,
    dimensions: grid.dimensions,
    values: grid.values,
    transform,
  });
  const commonMetadata = {
    chunk: Object.freeze([...chunk]),
    occupiedCells: cells.length,
    voxelSize,
    bounds,
  };
  const coarse = Object.freeze({
    key: coarseKey,
    level: 1,
    bytes: coarseGrid.values.length * 4,
    sourceRevision,
    certificateRevision,
    fallbackKey: null,
    pinned: true,
    payload: makePayload(coarseGrid),
    metadata: Object.freeze({
      ...commonMetadata,
      role: 'conservative-coarse',
      spacing: coarseGrid.spacing,
      geometricExpansionMax: coarseGrid.conservativeInflation,
    }),
  });
  const fine = Object.freeze({
    key: fineKey,
    level: 0,
    bytes: fineGrid.values.length * 4,
    sourceRevision,
    certificateRevision,
    fallbackKey: coarseKey,
    pinned: false,
    payload: makePayload(fineGrid),
    metadata: Object.freeze({ ...commonMetadata, role: 'fine', spacing: fineGrid.spacing, geometricExpansionMax: 0 }),
  });
  return Object.freeze({ chunk: Object.freeze(chunk), coarse, fine });
}

export function voxelSdfPageToNexel(page, options = {}) {
  if (!page?.payload || page.payload.kind !== 'sampled-field') throw new TypeError('A voxel sampled-field page is required');
  return Object.freeze({
    id: String(options.id ?? page.key),
    source: page.payload,
    material: options.material,
    collision: options.collision === false ? null : (options.collision ?? true),
    intent: Object.freeze({
      updateClass: 'streamed',
      topologyRequirement: 'closed-2-manifold',
      featureMode: 'sharp',
      qualityImportance: Number(options.qualityImportance ?? 0.8),
      authoritative: options.authoritative === true,
    }),
  });
}

/**
 * Adapter only: voxel storage and dirty-queue ownership remain with the voxel
 * subsystem. Callers pass the dirty entries they already admitted this frame.
 */
export class VoxelSdfBrickBridge {
  constructor(options = {}) {
    this.pages = options.pages ?? new SparsePageRuntime({
      capacity: options.capacity ?? 512,
      byteBudget: options.byteBudget ?? (128 * 1024 * 1024),
      requireFallback: true,
      logger: options.logger,
    });
    this._logger = typeof options.logger === 'function' ? options.logger : null;
  }

  publishDirty(entries, options = {}) {
    if (!Array.isArray(entries)) throw new TypeError('entries must be an array of admitted dirty chunks');
    const revisionValue = this.pages.revision + 1;
    this.pages.beginRevision(revisionValue);
    const pairs = [];
    try {
      for (const entry of entries) {
        const chunk = [entry.x, entry.y, entry.z];
        const pair = buildVoxelSdfBrickPair({ ...options, chunk, sourceRevision: options.sourceRevision ?? revisionValue });
        this.pages.stagePage(pair.coarse);
        this.pages.stagePage(pair.fine);
        pairs.push(pair);
      }
      const publication = this.pages.commitRevision();
      this._logger?.({
        type: 'voxel-sdf-bricks-published',
        revision: publication.revision,
        dirtyChunks: entries.length,
        pages: publication.pages.length,
        bytes: publication.bytes,
      });
      return Object.freeze({ publication, pairs: Object.freeze(pairs) });
    } catch (error) {
      this.pages.rollbackRevision();
      this._logger?.({ type: 'voxel-sdf-bricks-rejected', revision: revisionValue, error: String(error) });
      throw error;
    }
  }

  resolveChunk(chunkValue) {
    const chunk = chunkCoordinates(chunkValue);
    const prefix = `voxel:${chunk.join(',')}`;
    return this.pages.resolve(`${prefix}:fine`, [`${prefix}:coarse`]);
  }

  getStats() {
    return this.pages.getStats();
  }
}

export function createVoxelSdfBrickBridge(options) {
  return new VoxelSdfBrickBridge(options);
}
