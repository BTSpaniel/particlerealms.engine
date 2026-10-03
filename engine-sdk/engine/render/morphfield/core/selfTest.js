// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  FIELDLET_HEADER_BYTES,
  FIELDLET_FAMILY,
  MORPHFIELD_SCHEMA_VERSION,
  QUERY_MASK,
} from './constants.js';
import { readFieldletHeader, safeCertifiedStep, validateFieldletAbi } from './FieldletAbi.js';
import { AabbBvh } from './AabbBvh.js';
import { createMorphFieldCompiler } from './MorphFieldCompiler.js';
import { createNexelScene, NEXEL_PATCH_SCHEMA, NexelScene } from './NexelScene.js';
import { MORPHFIELD_SCHEMA_IDS } from '../schemas/ids.js';

function assert(condition, message) {
  if (!condition) throw new Error(`MorphField core self-test failed: ${message}`);
}

function assertNear(actual, expected, tolerance, message) {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, received ${actual}`);
}

function gridValues(dimensions, callback) {
  const values = [];
  for (let z = 0; z < dimensions[2]; z++) {
    for (let y = 0; y < dimensions[1]; y++) {
      for (let x = 0; x < dimensions[0]; x++) values.push(callback(x, y, z));
    }
  }
  return values;
}

function createDeterministicRandom(seed = 0x42564832) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function boundsOverlap(left, right) {
  return left.min.every((value, axis) => value <= right.max[axis] && left.max[axis] >= right.min[axis]);
}

export async function runMorphFieldCoreSelfTests() {
  const passed = [];
  validateFieldletAbi();
  passed.push('16-byte Fieldlet and certificate ABI');
  assertNear(safeCertifiedStep(2, [0.25, 2]), 0.875, 1e-12, 'safe certified step');

  const scene = createNexelScene({ id: 'core-self-test', units: 'meters' });
  scene.upsert({
    id: 'analytic-sphere',
    source: { kind: 'sphere', radius: 1 },
    transform: { translation: [1, 0, 0], scale: 2 },
    material: { type: 'pbr', baseColorFactor: [0.8, 0.2, 0.1, 1], roughnessFactor: 0.4 },
  });
  scene.upsert({
    id: 'analytic-csg',
    source: {
      kind: 'csg',
      operation: 'difference',
      children: [
        { kind: 'box', halfExtents: [1, 1, 1] },
        { kind: 'capsule', radius: 0.35, halfHeight: 1.2, transform: { rotation: [0, 0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4)] } },
      ],
    },
    collision: { contactSlop: 0.002 },
  });
  scene.upsert({
    id: 'sampled-field',
    source: {
      kind: 'sampled-field',
      bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
      dimensions: [3, 3, 3],
      values: gridValues([3, 3, 3], (x, y, z) => Math.hypot(x - 1, y - 1, z - 1) - 0.75),
    },
  });
  scene.upsert({
    id: 'oriented-kernels',
    source: {
      kind: 'oriented-samples',
      isoValue: 0.5,
      samples: [{ position: [0, 2, 0], normal: [0, 1, 0], radii: [0.5, 0.25, 0.5], weight: 1 }],
    },
  });
  scene.upsert({
    id: 'cached-surface',
    source: {
      kind: 'indexed-surface',
      positions: [[-1, 0, -1], [1, 0, -1], [0, 0, 1]],
      indices: [0, 1, 2],
    },
  });
  scene.upsert({
    id: 'bounded-medium',
    source: {
      kind: 'medium',
      bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
      density: 0.2,
      extinction: 0.8,
      emission: [0.1, 0.05, 0],
    },
  });
  assert(scene.revision === 6, 'scene mutations advance exactly one revision each');
  const serialized = scene.serialize();
  assert(NexelScene.fromJSON(serialized).serialize() === serialized, 'scene serialization is deterministic');
  let staleRejected = false;
  try {
    scene.applyPatch({ revision: scene.revision, upsert: [], remove: [] });
  } catch (error) {
    staleRejected = error?.code === 'STALE_SCENE_REVISION';
  }
  assert(staleRejected, 'stale patches fail closed');
  passed.push('Nexel scene validation, revisions, and canonical serialization');

  const compiler = createMorphFieldCompiler({ worker: 'main' });
  const compiled = await compiler.compile(scene);
  assert(compiled.fieldletHeaders.byteLength === scene.size * FIELDLET_HEADER_BYTES, 'header array uses 16 bytes per Fieldlet');
  assert(compiled.bounds.length === scene.size * 8, 'bounds use two vec4 values per Fieldlet');
  assert(compiled.payloads.length === scene.size * 16, 'payloads use sixteen f32 values per Fieldlet');
  assert(compiled.materials.length % 12 === 0, 'materials use three vec4 values per record');
  assert(compiled.analyticParameters.length % 16 === 0, 'analytic parameters use sixteen f32 values per record');
  const headerView = new DataView(compiled.fieldletHeaders.buffer, compiled.fieldletHeaders.byteOffset, compiled.fieldletHeaders.byteLength);
  const firstHeader = readFieldletHeader(headerView, 0);
  assert(firstHeader.queryMask & QUERY_MASK.SURFACE, 'analytic Fieldlet exposes a surface query');
  assert(new Set(compiled.representationPlan.map(entry => entry.family)).size === 4, 'automatic planning emits all four execution families');
  assert(compiled.representationPlan.some(entry => entry.family === FIELDLET_FAMILY.CACHED_SURFACE), 'indexed source selects cached-surface family');
  const evaluator = compiled.createReferenceEvaluator();
  assertNear(evaluator.evalSurface('analytic-sphere', [1, 0, 0]).distance, -2, 1e-9, 'uniformly scaled sphere center distance');
  assertNear(evaluator.evalSurface('analytic-sphere', [3, 0, 0]).distance, 0, 1e-9, 'uniformly scaled sphere boundary');
  assert(evaluator.evalMedium('bounded-medium', [0, 0, 0]).density === 0.2, 'medium query returns certified semantic density');
  assert(evaluator.evalCollision('analytic-csg', [2, 0, 0]).supported, 'collision query is available for collidable analytic Nexels');
  passed.push('deterministic compiler, canonical typed layouts, all families, and six-query reference API');

  const {
    NEXEL_CAPABILITY_PROFILE,
    NEXEL_COMPILER_MODE,
    NEXEL_GPU_QUERY_MODE,
    inspectNexelCapabilities,
  } = await import('../schemas/index.js');
  const profileByKind = new Map(NEXEL_CAPABILITY_PROFILE.sourceKinds.map(entry => [entry.kind, entry]));
  assert(profileByKind.get('sphere').compilerMode === NEXEL_COMPILER_MODE.CERTIFIED_ANALYTIC_EXECUTION,
    'analytic source capability does not declare certified analytic execution');
  assert(profileByKind.get('sampled-field').compilerMode === NEXEL_COMPILER_MODE.CERTIFIED_FIELD_EXECUTION
      && profileByKind.get('sampled-field').renderer === 'direct-field'
      && profileByKind.get('sampled-field').gpuQueryModes.surface === NEXEL_GPU_QUERY_MODE.CERTIFIED_SURFACE,
    'sampled-field capability does not declare its certified direct-field execution path');
  assert(profileByKind.get('indexed-surface').compilerMode === NEXEL_COMPILER_MODE.PACKED_MARKER,
    'indexed-surface capability does not distinguish packed marker output');
  assert(profileByKind.get('medium').gpuQueryModes.medium === NEXEL_GPU_QUERY_MODE.CERTIFICATE_MAJORANT,
    'medium GPU query capability does not identify certificate-majorant semantics');
  assert(NEXEL_CAPABILITY_PROFILE.sourceKinds.every(entry => (
    Object.keys(entry.gpuQueryModes).length === Object.keys(QUERY_MASK).filter(key => key !== 'ALL').length
  )), 'source capabilities do not publish one GPU query mode for every typed query');

  const analyticCapability = inspectNexelCapabilities(scene.get('analytic-sphere'));
  assert(analyticCapability.compilerMode === NEXEL_COMPILER_MODE.CERTIFIED_ANALYTIC_EXECUTION
      && analyticCapability.gpuQueryModes.bound === NEXEL_GPU_QUERY_MODE.CONSERVATIVE_BOUND
      && analyticCapability.gpuQueryModes.surface === NEXEL_GPU_QUERY_MODE.CERTIFIED_SURFACE
      && analyticCapability.gpuQueryModes.material === NEXEL_GPU_QUERY_MODE.MATERIAL_TABLE
      && analyticCapability.gpuQueryModes.motion === NEXEL_GPU_QUERY_MODE.UNAVAILABLE
      && analyticCapability.gpuQueryModes.collision === NEXEL_GPU_QUERY_MODE.UNAVAILABLE
      && analyticCapability.fullyGpuExecutable === analyticCapability.fullyCurrentRendererExecutable,
  'descriptor capability modes or compatibility alias drifted for an analytic Nexel');
  let rejectedCapabilityError = null;
  try {
    inspectNexelCapabilities({
      id: 'rejected-capability',
      source: { kind: 'sphere', radius: 1e100 },
      material: { type: 'pbr' },
    });
  } catch (error) {
    rejectedCapabilityError = error;
  }
  assert(rejectedCapabilityError?.code === 'NUMBER_OUT_OF_RANGE'
      && rejectedCapabilityError?.details?.path === 'nexel.source.radius',
  'invalid semantic descriptors must fail before capability reporting');
  const opaqueCapability = inspectNexelCapabilities({
    id: 'opaque-simulation-capability',
    source: { kind: 'sphere', radius: 1 },
    material: { type: 'pbr' },
    simulation: { adapter: 'opaque-core-self-test', authority: 'visual', entropy: { delta: 0.25 } },
  });
  assert(opaqueCapability.canonicalDescriptor.simulation.entropy.delta === 0.25
      && opaqueCapability.limitations.some(limitation => limitation.includes('Unqualified opaque simulation adapter'))
      && opaqueCapability.fullyCurrentRendererExecutable === false,
  'opaque simulation metadata was dropped or incorrectly qualified');
  passed.push('mode-specific compiler, GPU-query, renderer, and opaque-simulation capability reporting');

  const bvh = new AabbBvh([
    { id: 'b', sourceIndex: 1, bounds: { min: [2, 2, 2], max: [3, 3, 3] } },
    { id: 'a', sourceIndex: 0, bounds: { min: [0, 0, 0], max: [1, 1, 1] } },
  ]);
  assert(bvh.root === 0 && bvh.nodeCount === 3, 'binary BVH has deterministic preorder layout');
  assert(bvh.queryAabb({ min: [-1, -1, -1], max: [1.5, 1.5, 1.5] })[0].id === 'a', 'BVH AABB query resolves the expected leaf');
  bvh.refit(new Map([['a', { min: [4, 4, 4], max: [5, 5, 5] }]]));
  assert(bvh.queryAabb({ min: [-1, -1, -1], max: [1.5, 1.5, 1.5] }).length === 0, 'BVH refit updates ancestors');
  const random = createDeterministicRandom();
  const propertyLeaves = Array.from({ length: 128 }, (_entry, index) => {
    const center = [random() * 40 - 20, random() * 40 - 20, random() * 40 - 20];
    const extent = [random() * 1.9 + 0.1, random() * 1.9 + 0.1, random() * 1.9 + 0.1];
    return {
      id: `property-${String(index).padStart(3, '0')}`,
      sourceIndex: index,
      bounds: {
        min: center.map((value, axis) => value - extent[axis]),
        max: center.map((value, axis) => value + extent[axis]),
      },
    };
  });
  const propertyBvh = new AabbBvh(propertyLeaves);
  const verifyPropertyQueries = label => {
    for (let queryIndex = 0; queryIndex < 64; queryIndex++) {
      const center = [random() * 40 - 20, random() * 40 - 20, random() * 40 - 20];
      const extent = [random() * 4 + 0.05, random() * 4 + 0.05, random() * 4 + 0.05];
      const query = {
        min: center.map((value, axis) => value - extent[axis]),
        max: center.map((value, axis) => value + extent[axis]),
      };
      const actual = propertyBvh.queryAabb(query).map(entry => entry.id).join(',');
      const expected = propertyBvh.leaves
        .filter(entry => boundsOverlap(entry.bounds, query))
        .map(entry => entry.id)
        .sort()
        .join(',');
      assert(actual === expected, `${label} randomized BVH query ${queryIndex} differs from brute force`);
    }
  };
  verifyPropertyQueries('initial');
  const refitUpdates = new Map();
  for (let index = 0; index < propertyLeaves.length; index += 7) {
    const center = [random() * 20 - 10, random() * 20 - 10, random() * 20 - 10];
    refitUpdates.set(propertyLeaves[index].id, {
      min: center.map(value => value - 0.25),
      max: center.map(value => value + 0.25),
    });
  }
  propertyBvh.refit(refitUpdates);
  verifyPropertyQueries('refit');
  passed.push('deterministic AABB BVH construction, 128 randomized leaves, brute-force query parity, and refit');

  const patch = scene.createPatch({
    upsert: [{ id: 'analytic-sphere', source: { kind: 'sphere', radius: 1.25 } }],
    remove: ['cached-surface'],
  });
  assert(
    patch.$schema === MORPHFIELD_SCHEMA_IDS.patch
      && patch.schema === NEXEL_PATCH_SCHEMA
      && patch.version.major === MORPHFIELD_SCHEMA_VERSION.major
      && patch.version.minor === MORPHFIELD_SCHEMA_VERSION.minor,
    'canonical patch carries its JSON Schema, semantic schema, and version envelope',
  );
  const compiledPatch = await compiler.compilePatch(patch);
  assert(compiledPatch.revision === scene.revision + 1, 'compiled patch advances the baseline revision');
  assert(!Object.prototype.hasOwnProperty.call(compiledPatch.compiledScene.idToIndex, 'cached-surface'), 'compiled patch removes deleted IDs');
  passed.push('atomic incremental compilation');

  return Object.freeze({ passed: true, count: passed.length, checks: Object.freeze(passed) });
}
