// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/material/MaterialVariant.js — variants + shader-model fallback
// (spec §7). Imported materials won't always match the engine shader model, so
// we normalize into EngineMaterial, can generate a metallic-roughness fallback
// approximation when needed, and always keep the original recoverable. Variants
// (e.g. a re-tinted body panel) share the source material and only narrow/adjust.

import { createEngineMaterial, WORKFLOW, COLOR_SPACE } from './EngineMaterial.js';
import { clamp as clampScalar } from '../../core/math/MathScalar.js';

let _variantSeq = 0;

/**
 * Create a material variant that overrides a few fields of a base material while
 * preserving the original (recoverable) and recording the variant lineage.
 * @returns {object}
 */
export function createMaterialVariant(base, overrides = {}) {
  const v = createEngineMaterial({
    ...base,
    ...overrides,
    id: overrides.id ?? `${base.id}#var${++_variantSeq}`,
    name: overrides.name ?? `${base.name} (variant)`,
    textures: { ...base.textures, ...(overrides.textures || {}) },
    original: base.original ?? { format: base.sourceFormat, rawMaterialIndex: null, raw: base },
  });
  v.variantOf = base.id;
  return v;
}

const clamp01 = (x) => Math.max(0, clampScalar(x, 0, 1));

/**
 * Approximate a non-metallic-roughness material as metallic-roughness for the
 * engine's PBR shader. The original is preserved so the imported look can always
 * be restored. This is a deliberate, labelled approximation — not an exact port.
 * @returns {object} a new EngineMaterial (workflow = metallicRoughness)
 */
export function approximateToMetallicRoughness(material) {
  if (!material || material.workflow === WORKFLOW.METALLIC_ROUGHNESS) return material;
  const original = material.original ?? { format: material.sourceFormat, rawMaterialIndex: null, raw: material };

  if (material.workflow === WORKFLOW.UNLIT) {
    const out = createEngineMaterial({
      ...material,
      workflow: WORKFLOW.METALLIC_ROUGHNESS,
      metallicFactor: 0,
      roughnessFactor: 1,
      // make it read as flat/bright like unlit by pushing colour into emissive
      emissiveFactor: material.baseColorFactor.slice(0, 3),
      original,
    });
    out.approximatedFrom = WORKFLOW.UNLIT;
    return out;
  }

  if (material.workflow === WORKFLOW.SPECULAR_GLOSSINESS) {
    const raw = original.raw?.extensions?.KHR_materials_pbrSpecularGlossiness || {};
    const diffuse = raw.diffuseFactor ?? material.baseColorFactor ?? [1, 1, 1, 1];
    const spec = raw.specularFactor ?? [1, 1, 1];
    const gloss = raw.glossinessFactor ?? (1 - material.roughnessFactor);
    const specMax = Math.max(spec[0], spec[1], spec[2]);
    const metallic = clamp01((specMax - 0.04) / 0.96);
    // base colour leans to spec when metallic, to diffuse when dielectric
    const base = diffuse.map((d, i) => (i < 3 ? d * (1 - metallic) + (spec[i] ?? 0) * metallic : d));
    const out = createEngineMaterial({
      ...material,
      workflow: WORKFLOW.METALLIC_ROUGHNESS,
      baseColorFactor: base.length === 4 ? base : [...base, 1],
      metallicFactor: metallic,
      roughnessFactor: clamp01(1 - gloss),
      original,
    });
    out.approximatedFrom = WORKFLOW.SPECULAR_GLOSSINESS;
    return out;
  }

  const out = createEngineMaterial({ ...material, workflow: WORKFLOW.METALLIC_ROUGHNESS, original });
  out.approximatedFrom = material.workflow;
  return out;
}

/** Restore the original imported material descriptor (the raw source block). */
export function restoreOriginal(material) {
  return material?.original?.raw ?? null;
}

export { COLOR_SPACE };
