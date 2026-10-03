// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/material/TextureImport.js — normalize textures + decode pixels
// (spec §7). A texture's colour space and usage are inferred from the material
// slots that bind it (sRGB for colour/emissive, linear for data/normal/ORM), so
// the same image used as colour vs data is handled correctly. Pixel decode is a
// separate, browser-only step (createImageBitmap) kept out of parsing. KTX2/
// Basis stay compressed here and are routed by TextureManager to the existing
// native upload or registered decoder/transcoder hook path.

import { COLOR_SPACE, TEXTURE_USAGE } from './EngineMaterial.js';

/**
 * Infer per-texture colour space + usage from the decoded material bindings, and
 * normalize model.textures into self-describing EngineTexture records. Requires
 * importMaterials() to have run first (so bindings exist).
 * @returns {object[]} normalized textures
 */
export function normalizeTextures(model) {
  // Map textureId → { colorSpace, usage } from material bindings.
  const usageById = new Map();
  for (const mat of model.materials || []) {
    for (const binding of Object.values(mat.textures || {})) {
      if (!binding?.textureId) continue;
      const prev = usageById.get(binding.textureId);
      // sRGB wins if any colour use; otherwise keep linear/data.
      if (!prev || binding.colorSpace === COLOR_SPACE.SRGB) {
        usageById.set(binding.textureId, { colorSpace: binding.colorSpace, usage: binding.usage });
      }
    }
  }

  model.textures = (model.textures || []).map((tex, i) => {
    const id = tex.id ?? `texture:${i}`;
    const inferred = usageById.get(id) || { colorSpace: COLOR_SPACE.LINEAR, usage: TEXTURE_USAGE.DATA };
    const compressed = tex.mimeType === 'image/ktx2' || /\.ktx2$/i.test(tex.uri || '');
    return {
      id,
      name: tex.name ?? `texture_${i}`,
      image: tex.image ?? null,
      mimeType: tex.mimeType ?? null,
      uri: tex.uri ?? null,
      imageBytes: tex.imageBytes ?? null,
      hasBytes: !!tex.imageBytes,
      compressed,
      decoded: false,
      bitmap: null,
      colorSpace: inferred.colorSpace,
      usage: inferred.usage,
      raw: tex.raw ?? null, // recoverable
    };
  });
  model.metadata.texturesNormalized = true;
  return model.textures;
}

/**
 * Decode a normalized texture's pixels to an ImageBitmap (browser only).
 * Returns the bitmap (also cached on the texture) or null when undecodable
 * (no bytes, external uri, or a compressed format with no transcoder).
 * @returns {Promise<ImageBitmap|null>}
 */
export async function decodeTexture(tex) {
  if (!tex || tex.bitmap) return tex?.bitmap ?? null;
  if (tex.compressed) return null; // GPU upload/transcode is owned by TextureManager.
  if (typeof createImageBitmap !== 'function') return null;
  try {
    let blob = null;
    if (tex.imageBytes) blob = new Blob([tex.imageBytes], { type: tex.mimeType || 'image/png' });
    else if (tex.uri && typeof fetch === 'function') { const r = await fetch(tex.uri); if (r.ok) blob = await r.blob(); }
    if (!blob) return null;
    const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    tex.bitmap = bitmap; tex.decoded = true;
    return bitmap;
  } catch (_) {
    return null;
  }
}

/** Decode every decodable texture in a model. Returns the count decoded. */
export async function decodeAllTextures(model) {
  let n = 0;
  for (const tex of model.textures || []) { if (await decodeTexture(tex)) n++; }
  return n;
}
