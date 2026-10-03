// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import * as Assets from './assets/index.js';
import * as Core from './core/index.js';
import * as Runtime from './runtime/index.js';
import * as Schemas from './schemas/index.js';
import * as Systems from './systems/index.js';

export * from './core/index.js';
export * from './assets/index.js';
export * from './systems/index.js';
export * from './schemas/index.js';

export {
  MORPHFIELD_LOGICAL_PHASES,
  MORPHFIELD_QUALITY_TIERS,
  MorphFieldQueryEncoder,
  MorphFieldRenderer,
  NexelAffineBrickRenderer,
  NexelMicrostructureRenderer,
  MorphFieldWavefrontPathTracer,
  canonicalizeCompiledScene,
  createNexelAffineBrickRenderer,
  createNexelMicrostructureRenderer,
  createWavefrontPathTracer,
  inspectDeviceCapabilities,
  inspectNexelComputeCapabilities,
  validateCompiledSceneAbi,
  validateBorrowedDevice,
} from './runtime/index.js';

/** Create a device-independent semantic Nexel scene. */
export function createScene(options) {
  return Core.createNexelScene(options);
}

/** Create a deterministic device-independent MorphField compiler. */
export function createCompiler(options) {
  return Core.createMorphFieldCompiler(options);
}

/** Encode a semantic scene into a bounded, checksummed MOR2 container. */
export function encodeAsset(scene, options) {
  return Assets.encodeMorphAsset(scene, options);
}

/**
 * Load a MOR2 container and return its authoritative semantic Nexel scene.
 * Use inspectAsset() when chunk metadata or provenance is also required.
 */
export async function loadAsset(source, options) {
  const container = await Assets.loadMorphAsset(source, options);
  return container.scene;
}

/** Decode a MOR2 container while retaining provenance and optional chunks. */
export function inspectAsset(source, options) {
  return Assets.loadMorphAsset(source, options);
}

/** Create an external-encoder renderer that borrows its host GPUDevice. */
export function createRenderer(options) {
  return Runtime.createRenderer(options);
}

/** Create the bounded-queue progressive compute path tracer. */
export function createPathTracer(options) {
  return Runtime.createWavefrontPathTracer(options);
}

/** Create the portable u32 render-cluster decoder on a borrowed GPU device. */
export function createMicrostructureRenderer(options) {
  return Runtime.createNexelMicrostructureRenderer(options);
}

/** Create the direct 32-byte AFFINE4 brick decoder on a borrowed GPU device. */
export function createAffineBrickRenderer(options) {
  return Runtime.createNexelAffineBrickRenderer(options);
}

/**
 * Stable public namespace used by Engine.MorphField and bundled window.PE.
 * Internal implementation groups remain inspectable without flattening
 * conflicting ABI aliases into the public method surface.
 */
export const MorphField = Object.freeze({
  createScene,
  createCompiler,
  encodeAsset,
  loadAsset,
  inspectAsset,
  createRenderer,
  createPathTracer,
  createMicrostructureRenderer,
  createAffineBrickRenderer,
  Core: Object.freeze({ ...Core }),
  Assets: Object.freeze({ ...Assets }),
  Runtime: Object.freeze({ ...Runtime }),
  Schemas: Object.freeze({ ...Schemas }),
  Systems: Object.freeze({ ...Systems }),
});

export default MorphField;
