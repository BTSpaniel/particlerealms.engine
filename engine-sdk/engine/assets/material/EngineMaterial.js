// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/material/EngineMaterial.js — normalized material + texture
// binding schemas (spec §7). Materials are decoded, not guessed. Textures bind
// to surfaces (not loose images); UV sets, sampler wrap/filter, and texture
// transforms must survive import; packed channels are read exactly. The raw
// source material is always preserved on `.original` so the imported look stays
// recoverable even after engine normalization or shader-model approximation.

export const WORKFLOW = Object.freeze({
  METALLIC_ROUGHNESS: 'metallicRoughness',
  SPECULAR_GLOSSINESS: 'specularGlossiness',
  PHONG: 'phong',
  UNLIT: 'unlit',
  CUSTOM: 'custom',
});

export const ALPHA_MODE = Object.freeze({ OPAQUE: 'opaque', MASK: 'mask', BLEND: 'blend' });

export const TEXTURE_SLOTS = Object.freeze([
  'baseColor', 'normal', 'metallicRoughness', 'occlusion', 'emissive',
  'opacity', 'height', 'clearcoat', 'transmission', 'specularGlossiness', 'diffuse',
]);

// How a slot's channels are interpreted. glTF packs ORM-style maps; the format
// metadata wins over any filename guess.
export const COLOR_SPACE = Object.freeze({ SRGB: 'srgb', LINEAR: 'linear' });
export const TEXTURE_USAGE = Object.freeze({ COLOR: 'color', DATA: 'data', NORMAL: 'normal', MASK: 'mask', HDR: 'hdr' });

/** glTF default packing: metallic=B, roughness=G, occlusion=R. */
export function defaultChannelMap(slot) {
  switch (slot) {
    case 'metallicRoughness': return { roughness: 'g', metallic: 'b' };
    case 'occlusion': return { occlusion: 'r' };
    case 'normal': return { normal: 'rgb' };
    case 'baseColor': return { color: 'rgb', opacity: 'a' };
    default: return {};
  }
}

/**
 * Create a normalized engine material.
 * @returns {object}
 */
export function createEngineMaterial(init = {}) {
  init = init || {};
  return {
    id: init.id ?? null,
    name: init.name ?? 'material',
    sourceFormat: init.sourceFormat ?? null,
    workflow: init.workflow ?? WORKFLOW.METALLIC_ROUGHNESS,

    baseColorFactor: init.baseColorFactor ?? [1, 1, 1, 1],
    metallicFactor: init.metallicFactor ?? 1,
    roughnessFactor: init.roughnessFactor ?? 1,
    emissiveFactor: init.emissiveFactor ?? [0, 0, 0],

    alphaMode: init.alphaMode ?? ALPHA_MODE.OPAQUE,
    alphaCutoff: init.alphaCutoff ?? 0.5,
    doubleSided: !!init.doubleSided,

    // slot → TextureBinding (only present slots are set)
    textures: init.textures ?? {},

    // raw source preserved so the original is always recoverable
    original: init.original ?? { format: init.sourceFormat ?? null, rawMaterialIndex: null, raw: null },
  };
}

/**
 * Create a texture binding (a texture bound to a material slot on a surface).
 * @returns {object}
 */
export function createTextureBinding(init = {}) {
  init = init || {};
  return {
    textureId: init.textureId ?? null,
    slot: init.slot ?? 'baseColor',
    uvSet: init.uvSet ?? 0,
    transform: {
      offset: init.transform?.offset ?? [0, 0],
      rotation: init.transform?.rotation ?? 0,
      scale: init.transform?.scale ?? [1, 1],
    },
    sampler: {
      wrapU: init.sampler?.wrapU ?? 'repeat',
      wrapV: init.sampler?.wrapV ?? 'repeat',
      minFilter: init.sampler?.minFilter ?? 'linearMipmapLinear',
      magFilter: init.sampler?.magFilter ?? 'linear',
    },
    colorSpace: init.colorSpace ?? COLOR_SPACE.LINEAR,
    usage: init.usage ?? TEXTURE_USAGE.DATA,
    channelUse: init.channelUse ?? defaultChannelMap(init.slot ?? 'baseColor'),
  };
}

/** Has this binding a non-identity UV transform (KHR_texture_transform)? */
export function hasTextureTransform(binding) {
  const t = binding?.transform;
  if (!t) return false;
  return t.rotation !== 0 || t.offset[0] !== 0 || t.offset[1] !== 0 || t.scale[0] !== 1 || t.scale[1] !== 1;
}
