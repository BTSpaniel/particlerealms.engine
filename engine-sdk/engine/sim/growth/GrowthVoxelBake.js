// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  LineNetwork,
  LineToVoxelizer,
  Materials,
} from '../../core/math/LineToVoxel.js';
import { hashIdFast, hashIdSecure } from '../../state/util/canonical.js';
import {
  GROWTH_LIMITS,
  GROWTH_SCHEMAS,
  GROWTH_SCHEMA_VERSION,
  compareGrowthIds,
  failGrowth,
  freezeGrowthJson,
  normalizeGrowthVector3,
  requireGrowthInteger,
  requireGrowthNumber,
} from './GrowthContracts.js';
import { normalizeGrowthState } from './GrowthState.js';

// A centre-sampled voxel can be as far as half a voxel diagonal from a
// sub-voxel segment. Conservatively widening only the bake representation to
// this radius guarantees that every authored segment occupies at least one
// voxel without changing the authoritative metric GrowthState geometry.
const MINIMUM_CONSERVATIVE_VOXEL_RADIUS = Math.sqrt(3) * 0.5 + 1e-6;

function normalizeBakeOptions(options = {}) {
  return {
    voxelsPerMeter: requireGrowthNumber(options.voxelsPerMeter ?? 8, 'bake.voxelsPerMeter', { minimum: 0.25, maximum: 128 }),
    paddingMeters: requireGrowthNumber(options.paddingMeters ?? 0.25, 'bake.paddingMeters', { minimum: 0, maximum: 64 }),
    blendRadiusMeters: requireGrowthNumber(options.blendRadiusMeters ?? 0.02, 'bake.blendRadiusMeters', { minimum: 0, maximum: 16 }),
    includeRoots: options.includeRoots !== false,
    maxVoxels: requireGrowthInteger(options.maxVoxels ?? 1_000_000, 'bake.maxVoxels', { minimum: 1, maximum: GROWTH_LIMITS.MAX_VOXELS }),
    densityScale: requireGrowthInteger(options.densityScale ?? 1_024, 'bake.densityScale', { minimum: 1, maximum: 32_767 }),
  };
}

function scaledVector(vector, scale) {
  return vector.map(component => Math.fround(component * scale));
}

function normalizedBounds(bounds, scale) {
  if (bounds === undefined || bounds === null) return null;
  if (!bounds || typeof bounds !== 'object') failGrowth('GROWTH_BAKE_BOUNDS', 'Bake bounds must be an object with min and max');
  const min = normalizeGrowthVector3(bounds.min, 'bake.bounds.min');
  const max = normalizeGrowthVector3(bounds.max, 'bake.bounds.max');
  for (let axis = 0; axis < 3; axis++) {
    if (!(min[axis] < max[axis])) failGrowth('GROWTH_BAKE_BOUNDS', 'Bake bounds min must be less than max on every axis');
  }
  return { min: scaledVector(min, scale), max: scaledVector(max, scale) };
}

export function createGrowthLineNetwork(stateInput, options = {}) {
  const state = normalizeGrowthState(stateInput);
  const settings = normalizeBakeOptions(options);
  const segments = state.branches.map(entity => ({ family: 'branch', entity }))
    .concat(settings.includeRoots ? state.roots.map(entity => ({ family: 'root', entity })) : [])
    .sort((left, right) => compareGrowthIds(left.entity.lineage, right.entity.lineage)
      || compareGrowthIds(left.family, right.family));
  if (segments.length === 0) failGrowth('GROWTH_BAKE_EMPTY', 'A growth voxel bake requires at least one branch or root');
  const network = new LineNetwork();
  const endpointNodes = new Map();
  const lineageMap = [];
  for (const { family, entity } of segments) {
    const material = family === 'root' ? Materials.ORGANIC : Materials.WOOD;
    const sourceRadiusVoxels = entity.radius * settings.voxelsPerMeter;
    const effectiveRadiusVoxels = Math.max(sourceRadiusVoxels, MINIMUM_CONSERVATIVE_VOXEL_RADIUS);
    const parentEndpoint = entity.parentId === null ? null : endpointNodes.get(entity.parentId);
    const nodeStart = parentEndpoint ?? network.addNode(
      scaledVector(entity.start, settings.voxelsPerMeter),
      effectiveRadiusVoxels,
      material,
    );
    const nodeEnd = network.addNode(
      scaledVector(entity.end, settings.voxelsPerMeter),
      effectiveRadiusVoxels,
      material,
    );
    const edgeIndex = network.connect(nodeStart, nodeEnd);
    network.edges[edgeIndex].material = material;
    endpointNodes.set(entity.id, nodeEnd);
    lineageMap.push({
      entityId: entity.id,
      lineage: entity.lineage,
      family,
      sourceRadiusMeters: entity.radius,
      effectiveRadiusMeters: effectiveRadiusVoxels / settings.voxelsPerMeter,
      edgeIndex,
      nodeStart,
      nodeEnd,
    });
  }
  return Object.freeze({ network, lineageMap: freezeGrowthJson(lineageMap, '$.growthLineageMap'), settings: Object.freeze(settings) });
}

function rle(values, normalizeValue) {
  if (values.length === 0) return [];
  const encoded = [];
  let current = normalizeValue(values[0]);
  let count = 1;
  for (let index = 1; index < values.length; index++) {
    const value = normalizeValue(values[index]);
    if (value === current && count < 0xffffffff) {
      count += 1;
    } else {
      encoded.push(current, count);
      current = value;
      count = 1;
    }
  }
  encoded.push(current, count);
  return encoded;
}

function quantizedDensity(value, scale) {
  return Math.max(-32_768, Math.min(32_767, Math.round(Number(value) * scale)));
}

function outputHashInput(bake) {
  const { outputHash: _outputHash, ...contents } = bake;
  return contents;
}

export function bakeGrowthStateToVoxels(stateInput, options = {}) {
  const state = normalizeGrowthState(stateInput);
  const { network, lineageMap, settings } = createGrowthLineNetwork(state, options);
  const explicitBounds = normalizedBounds(options.bounds, settings.voxelsPerMeter);
  const rawBounds = explicitBounds ?? network.getBoundingBox();
  const paddedBounds = explicitBounds ?? {
    min: rawBounds.min.map(value => value - settings.paddingMeters * settings.voxelsPerMeter),
    max: rawBounds.max.map(value => value + settings.paddingMeters * settings.voxelsPerMeter),
  };
  const size = [0, 1, 2].map(axis => Math.ceil(paddedBounds.max[axis] - paddedBounds.min[axis]));
  if (size.some(value => !Number.isSafeInteger(value) || value <= 0)) {
    failGrowth('GROWTH_BAKE_SIZE', 'Growth bake dimensions must be positive safe integers', { size });
  }
  const voxelCount = size[0] * size[1] * size[2];
  if (!Number.isSafeInteger(voxelCount) || voxelCount > settings.maxVoxels) {
    failGrowth('GROWTH_BAKE_VOXEL_LIMIT', `Growth bake requires ${voxelCount} voxels; maximum is ${settings.maxVoxels}`, {
      size,
      voxelCount,
      maximum: settings.maxVoxels,
    });
  }
  const voxelizer = new LineToVoxelizer({
    resolution: settings.voxelsPerMeter,
    padding: 0,
    blendRadius: settings.blendRadiusMeters * settings.voxelsPerMeter,
  });
  const result = voxelizer.voxelize(network, {
    min: [...paddedBounds.min],
    max: [...paddedBounds.max],
  });
  if (result.density.length !== voxelCount || result.materials.length !== voxelCount) {
    failGrowth('GROWTH_BAKE_OUTPUT_SIZE', 'Line-to-voxel output size does not match validated allocation');
  }
  const densityRle = rle(result.density, value => quantizedDensity(value, settings.densityScale));
  const materialRle = rle(result.materials, value => Number(value) & 0xff);
  const bake = {
    schema: GROWTH_SCHEMAS.bake,
    version: GROWTH_SCHEMA_VERSION,
    assetId: state.assetId,
    source: {
      stateHash: state.stateHash,
      seed: state.seed,
      tick: state.tick,
      revision: state.revision,
      programId: state.program.id,
      programVersion: state.program.version,
      environmentRevision: state.environmentRevision,
    },
    settings: {
      voxelsPerMeter: settings.voxelsPerMeter,
      paddingMeters: settings.paddingMeters,
      blendRadiusMeters: settings.blendRadiusMeters,
      includeRoots: settings.includeRoots,
      densityScale: settings.densityScale,
    },
    size: result.size,
    voxelCount,
    bounds: {
      min: result.bounds.min.map(value => Math.fround(value / settings.voxelsPerMeter)),
      max: result.bounds.max.map(value => Math.fround(value / settings.voxelsPerMeter)),
    },
    encoding: {
      density: 'rle-signed-i16-pairs',
      densitySemantic: 'signed-distance-times-scale',
      materials: 'rle-u8-pairs',
    },
    densityRle,
    materialRle,
    lineageMap,
  };
  const outputHash = hashIdFast(bake, { domain: 'engine-growth-voxel-bake', schemaVersion: '1' });
  return freezeGrowthJson({ ...bake, outputHash }, '$.growthVoxelBake', {
    maximumValues: Math.max(GROWTH_LIMITS.MAX_PROGRAM_STATE_VALUES, densityRle.length + materialRle.length + lineageMap.length * 8 + 256),
  });
}

export async function createSecureGrowthBakeReceipt(bakeInput) {
  if (!bakeInput || bakeInput.schema !== GROWTH_SCHEMAS.bake || bakeInput.version !== GROWTH_SCHEMA_VERSION) {
    failGrowth('GROWTH_BAKE_VERSION', `Expected ${GROWTH_SCHEMAS.bake} v${GROWTH_SCHEMA_VERSION}`);
  }
  const expected = hashIdFast(outputHashInput(bakeInput), { domain: 'engine-growth-voxel-bake', schemaVersion: '1' });
  if (bakeInput.outputHash !== expected) {
    failGrowth('GROWTH_BAKE_HASH_MISMATCH', 'Growth bake output hash does not match its contents', {
      expected,
      received: bakeInput.outputHash,
    });
  }
  const authorityHash = await hashIdSecure(bakeInput, {
    domain: 'engine-growth-voxel-bake-receipt',
    schemaVersion: '1',
  });
  return freezeGrowthJson({
    schema: 'engine-growth-bake-receipt',
    version: GROWTH_SCHEMA_VERSION,
    assetId: bakeInput.assetId,
    stateHash: bakeInput.source.stateHash,
    outputHash: bakeInput.outputHash,
    authorityHash,
  }, '$.growthBakeReceipt');
}
