// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/EngineModel.js — the unified runtime object.
//
// Core rule of the ingestion runtime: a model file is raw evidence, not the
// runtime object. The importer parses a source file into an EngineModel, which
// keeps every layer explicitly separate (source ≠ visual mesh ≠ material ≠
// collider ≠ SDF ≠ skeleton ≠ animation ≠ runtime rig ≠ render surface). Layers
// that have not been built yet are explicitly null/empty — never faked — so the
// editor can show exactly what was detected vs generated.
//
// Corrections (axis/scale/origin, material fixes, rig edits) live in metadata as
// an ImportTransform / import profile and are NEVER baked destructively into the
// source: the original imported look must always be recoverable.

let _modelSeq = 0;

/**
 * Create an empty EngineModel with every layer present but unbuilt.
 * @param {object} [init]
 * @returns {object} engine model (mutable; the import pipeline fills it in)
 */
export function createEngineModel(init = {}) {
  return {
    id: init.id ?? `engine-model:${++_modelSeq}`,
    name: init.name ?? 'untitled',
    sourceHash: init.sourceHash ?? null,
    sourceFormat: init.sourceFormat ?? null,

    // --- visual graph (decoded, never guessed) ---
    nodes: init.nodes ?? [],          // EngineNode[]
    meshes: init.meshes ?? [],        // EngineMesh[]
    primitives: init.primitives ?? [], // EnginePrimitive[]
    materials: init.materials ?? [],  // EngineMaterial[] (filled in Phase 2)
    textures: init.textures ?? [],    // EngineTexture[]
    surfaceBindings: init.surfaceBindings ?? [], // SurfaceBinding[]

    // --- deformation ---
    skeletons: init.skeletons ?? [],
    skins: init.skins ?? [],
    morphTargets: init.morphTargets ?? [],
    animations: init.animations ?? [],

    // --- generated collision/contact (built on demand) ---
    colliders: init.colliders ?? [],
    sdfAssets: init.sdfAssets ?? [],
    voxelAssets: init.voxelAssets ?? [],

    // --- runtime rigs (built from detected parts; null until built) ---
    rigs: {
      vehicle: null,
      humanoid: null,
      hand: null,
      weapon: null,
      mechanical: null,
      ...(init.rigs ?? {}),
    },

    renderSurfaces: init.renderSurfaces ?? [],

    // --- spatial + correction metadata ---
    bounds: init.bounds ?? null,        // { min, max, center, radius }
    origin: init.origin ?? [0, 0, 0],
    importTransform: init.importTransform ?? createImportTransform(),
    detectedParts: init.detectedParts ?? [],
    metadata: init.metadata ?? {},      // preserves raw source blocks (recoverable)

    gpuReady: false,
  };
}

/**
 * A non-destructive correction applied at runtime (never baked into source).
 * Confidence drives the auto-apply / review / preview / neutral policy.
 */
export function createImportTransform(init = {}) {
  return {
    upAxis: init.upAxis ?? '+Y',
    forwardAxis: init.forwardAxis ?? '+Z',
    axisCorrection: init.axisCorrection ?? null, // 3x3 / quaternion, applied at load
    scaleCorrection: init.scaleCorrection ?? 1,
    originCorrection: init.originCorrection ?? [0, 0, 0],
    confidence: init.confidence ?? 1,
  };
}

/** A node in the preserved source hierarchy (transforms kept as-authored). */
export function createEngineNode(init = {}) {
  return {
    id: init.id,
    name: init.name ?? '',
    parent: init.parent ?? null,        // node id or null for roots
    children: init.children ?? [],      // node ids
    translation: init.translation ?? [0, 0, 0],
    rotation: init.rotation ?? [0, 0, 0, 1], // quaternion xyzw
    scale: init.scale ?? [1, 1, 1],
    mesh: init.mesh ?? null,            // mesh id if this node draws
    skin: init.skin ?? null,
    extras: init.extras ?? {},          // preserved source extras/metadata
  };
}

/** A mesh = a set of primitives (submeshes), each with its own material. */
export function createEngineMesh(init = {}) {
  return {
    id: init.id,
    name: init.name ?? '',
    primitives: init.primitives ?? [],  // primitive ids
    bounds: init.bounds ?? null,
  };
}

/** A primitive/submesh: geometry + a single material binding. */
export function createEnginePrimitive(init = {}) {
  return {
    id: init.id,
    mesh: init.mesh ?? null,
    material: init.material ?? null,    // material id (null = default/unbound)
    mode: init.mode ?? 'triangles',
    // interleaved or separate attribute arrays (Float32Array / typed arrays)
    attributes: init.attributes ?? {},  // { position, normal, tangent, uv0, uv1, joints, weights, color }
    indices: init.indices ?? null,
    vertexCount: init.vertexCount ?? 0,
    bounds: init.bounds ?? null,
    gpu: init.gpu ?? null,              // { vertexBuffer, indexBuffer, layout } once uploaded
  };
}

/** Canonical layer list — used by the editor to show built vs unbuilt layers. */
export const ENGINE_MODEL_LAYERS = Object.freeze([
  'nodes', 'meshes', 'primitives', 'materials', 'textures', 'surfaceBindings',
  'skeletons', 'skins', 'morphTargets', 'animations',
  'colliders', 'sdfAssets', 'voxelAssets', 'renderSurfaces',
]);

/** Report which layers are built (non-empty) vs explicitly unbuilt. */
export function layerStatus(model) {
  const status = {};
  for (const layer of ENGINE_MODEL_LAYERS) {
    const v = model[layer];
    status[layer] = Array.isArray(v) ? v.length : (v == null ? 0 : 1);
  }
  status.rigs = Object.fromEntries(Object.entries(model.rigs).map(([k, v]) => [k, v != null]));
  return status;
}
