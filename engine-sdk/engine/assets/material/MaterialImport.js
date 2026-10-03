// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/material/MaterialImport.js — decode source materials into the
// normalized EngineMaterial (spec §7). Materials are decoded exactly, never
// guessed: UV sets, sampler wrap/filter, and KHR_texture_transform survive;
// packed channels are read per the format (metadata wins over filename). The raw
// material is preserved on `.original` so the imported look stays recoverable.

import {
  createEngineMaterial, createTextureBinding, WORKFLOW, ALPHA_MODE,
  COLOR_SPACE, TEXTURE_USAGE, defaultChannelMap,
} from './EngineMaterial.js';

// glTF sampler enum → engine string.
const WRAP = { 33071: 'clamp-to-edge', 33648: 'mirror-repeat', 10497: 'repeat' };
const MAG = { 9728: 'nearest', 9729: 'linear' };
const MIN = {
  9728: 'nearest', 9729: 'linear',
  9984: 'nearestMipmapNearest', 9985: 'linearMipmapNearest',
  9986: 'nearestMipmapLinear', 9987: 'linearMipmapLinear',
};

function samplerFor(model, textureIndex) {
  const tex = model.textures?.[textureIndex]?.raw;
  const s = tex && tex.sampler != null ? model.metadata.gltfSamplers?.[tex.sampler] : null;
  return {
    wrapU: WRAP[s?.wrapS] ?? 'repeat',
    wrapV: WRAP[s?.wrapT] ?? 'repeat',
    minFilter: MIN[s?.minFilter] ?? 'linearMipmapLinear',
    magFilter: MAG[s?.magFilter] ?? 'linear',
  };
}

/**
 * Build a TextureBinding from a glTF textureInfo, preserving uvSet, sampler, and
 * KHR_texture_transform exactly.
 */
function bindingFromInfo(model, info, slot, colorSpace, usage) {
  if (!info || info.index == null) return null;
  const xform = info.extensions?.KHR_texture_transform || {};
  return createTextureBinding({
    textureId: `texture:${info.index}`,
    slot,
    uvSet: xform.texCoord ?? info.texCoord ?? 0,
    transform: {
      offset: xform.offset ?? [0, 0],
      rotation: xform.rotation ?? 0,
      scale: xform.scale ?? [1, 1],
    },
    sampler: samplerFor(model, info.index),
    colorSpace,
    usage,
    channelUse: defaultChannelMap(slot),
  });
}

function decodeGltfMaterial(model, raw, index) {
  const unlit = !!raw.extensions?.KHR_materials_unlit;
  const sg = raw.extensions?.KHR_materials_pbrSpecularGlossiness;
  const pbr = raw.pbrMetallicRoughness || {};
  const workflow = unlit ? WORKFLOW.UNLIT : (sg ? WORKFLOW.SPECULAR_GLOSSINESS : WORKFLOW.METALLIC_ROUGHNESS);

  const textures = {};
  const set = (slot, binding) => { if (binding) textures[slot] = binding; };

  if (sg) {
    set('diffuse', bindingFromInfo(model, sg.diffuseTexture, 'diffuse', COLOR_SPACE.SRGB, TEXTURE_USAGE.COLOR));
    set('specularGlossiness', bindingFromInfo(model, sg.specularGlossinessTexture, 'specularGlossiness', COLOR_SPACE.SRGB, TEXTURE_USAGE.COLOR));
  } else {
    set('baseColor', bindingFromInfo(model, pbr.baseColorTexture, 'baseColor', COLOR_SPACE.SRGB, TEXTURE_USAGE.COLOR));
    set('metallicRoughness', bindingFromInfo(model, pbr.metallicRoughnessTexture, 'metallicRoughness', COLOR_SPACE.LINEAR, TEXTURE_USAGE.DATA));
  }
  set('normal', bindingFromInfo(model, raw.normalTexture, 'normal', COLOR_SPACE.LINEAR, TEXTURE_USAGE.NORMAL));
  set('occlusion', bindingFromInfo(model, raw.occlusionTexture, 'occlusion', COLOR_SPACE.LINEAR, TEXTURE_USAGE.MASK));
  set('emissive', bindingFromInfo(model, raw.emissiveTexture, 'emissive', COLOR_SPACE.SRGB, TEXTURE_USAGE.COLOR));

  return createEngineMaterial({
    id: `material:${index}`,
    name: raw.name ?? `material_${index}`,
    sourceFormat: 'gltf',
    workflow,
    baseColorFactor: sg ? (sg.diffuseFactor ?? [1, 1, 1, 1]) : (pbr.baseColorFactor ?? [1, 1, 1, 1]),
    metallicFactor: pbr.metallicFactor ?? (sg ? 0 : 1),
    roughnessFactor: pbr.roughnessFactor ?? (sg ? 1 - (sg.glossinessFactor ?? 1) : 1),
    emissiveFactor: raw.emissiveFactor ?? [0, 0, 0],
    alphaMode: (raw.alphaMode ?? 'OPAQUE').toLowerCase(),
    alphaCutoff: raw.alphaCutoff ?? 0.5,
    doubleSided: !!raw.doubleSided,
    textures,
    original: { format: 'gltf', rawMaterialIndex: index, raw },
  });
}

function decodeObjMaterial(raw, index) {
  const textures = {};
  if (raw?.textures?.baseColor) textures.baseColor = createTextureBinding({ textureId: raw.textures.baseColor, slot: 'baseColor', colorSpace: COLOR_SPACE.SRGB, usage: TEXTURE_USAGE.COLOR });
  if (raw?.textures?.normal) textures.normal = createTextureBinding({ textureId: raw.textures.normal, slot: 'normal', colorSpace: COLOR_SPACE.LINEAR, usage: TEXTURE_USAGE.NORMAL });
  return createEngineMaterial({
    id: `material:${index}`,
    name: raw?.name ?? `material_${index}`,
    sourceFormat: 'obj',
    workflow: WORKFLOW.METALLIC_ROUGHNESS,
    baseColorFactor: raw?.baseColorFactor ?? [0.8, 0.8, 0.8, 1],
    metallicFactor: 0,
    roughnessFactor: raw?.roughnessFactor ?? 1,
    textures,
    original: { format: 'obj', rawMaterialIndex: index, raw },
  });
}

/**
 * Decode every material in a model into EngineMaterial in place.
 * Idempotent: a material already carrying `.original` is left untouched.
 * @returns {object[]} the decoded materials
 */
export function importMaterials(model) {
  model.materials = model.materials.map((m, i) => {
    if (m && m.original) return m; // already decoded
    const raw = m?.raw ?? null;
    if (model.sourceFormat === 'obj') return decodeObjMaterial(raw, i);
    if (raw) return decodeGltfMaterial(model, raw, i);
    return createEngineMaterial({ id: m?.id ?? `material:${i}`, name: m?.name ?? `material_${i}` });
  });
  model.metadata.materialsDecoded = true;
  return model.materials;
}

export { WORKFLOW, ALPHA_MODE };
