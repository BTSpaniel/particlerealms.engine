// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { AdaptiveQualityGovernor, MORPHFIELD_QUALITY_TIERS } from "./AdaptiveQualityGovernor.js";
import {
  inspectDeviceCapabilities,
  inspectNexelComputeCapabilities,
  validateBorrowedDevice,
} from "./capabilities.js";
import { MorphFieldRenderer, MORPHFIELD_LOGICAL_PHASES } from "./MorphFieldRenderer.js";
import { MorphFieldQueryEncoder } from "./QueryEncoder.js";
import {
  NexelMicrostructureRenderer,
  createNexelMicrostructureRenderer,
} from "./NexelMicrostructureRenderer.js";
import {
  NexelAffineBrickRenderer,
  createNexelAffineBrickRenderer,
} from "./NexelAffineBrickRenderer.js";
import {
  MorphFieldWavefrontPathTracer,
  createWavefrontPathTracer,
} from "./wavefront/index.js";
import {
  ANALYTIC_SUBTYPE,
  FIELDLET_FAMILY,
  FIELDLET_SUBTYPE,
  QUERY_KIND,
  normalizeCompiledScene,
  validateCompiledSceneAbi,
} from "./SceneBufferUploader.js";

export async function createRenderer(options) {
  return MorphFieldRenderer.create(options);
}

/**
 * Validates and detaches the canonical typed-array ABI published by this
 * realm's MorphFieldCompiler. Authored object Fieldlets and cloned certificate
 * arrays are not a certification boundary and are rejected.
 */
export function canonicalizeCompiledScene(scene) {
  return normalizeCompiledScene(scene);
}

export {
  AdaptiveQualityGovernor,
  ANALYTIC_SUBTYPE,
  FIELDLET_FAMILY,
  FIELDLET_SUBTYPE,
  MORPHFIELD_LOGICAL_PHASES,
  MORPHFIELD_QUALITY_TIERS,
  MorphFieldQueryEncoder,
  MorphFieldRenderer,
  NexelAffineBrickRenderer,
  NexelMicrostructureRenderer,
  MorphFieldWavefrontPathTracer,
  QUERY_KIND,
  validateCompiledSceneAbi,
  createWavefrontPathTracer,
  createNexelAffineBrickRenderer,
  createNexelMicrostructureRenderer,
  inspectDeviceCapabilities,
  inspectNexelComputeCapabilities,
  validateBorrowedDevice,
};

export default Object.freeze({
  createRenderer,
  canonicalizeCompiledScene,
  AdaptiveQualityGovernor,
  ANALYTIC_SUBTYPE,
  FIELDLET_FAMILY,
  FIELDLET_SUBTYPE,
  MORPHFIELD_LOGICAL_PHASES,
  MORPHFIELD_QUALITY_TIERS,
  MorphFieldWavefrontPathTracer,
  NexelAffineBrickRenderer,
  NexelMicrostructureRenderer,
  QUERY_KIND,
  validateCompiledSceneAbi,
  createWavefrontPathTracer,
  createNexelAffineBrickRenderer,
  createNexelMicrostructureRenderer,
  inspectDeviceCapabilities,
  inspectNexelComputeCapabilities,
  validateBorrowedDevice,
});
