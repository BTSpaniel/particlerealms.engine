// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/surfaces/RenderSurfaceMaterial.js — bind a RenderSurface onto a mesh as
// baseColor or emissive, in world- or screen-space, reusing the EngineMaterial
// schema so surfaces flow through the same material/binding path as imported
// textures. The GPU resource accessor lets any renderer drop the surface's live
// texture into a bind group without knowing how it is produced.

import { createEngineMaterial, WORKFLOW } from '../assets/material/EngineMaterial.js';

export const SURFACE_SLOT = Object.freeze({ BASE_COLOR: 'baseColor', EMISSIVE: 'emissive' });
export const SURFACE_SPACE = Object.freeze({ WORLD: 'world', SCREEN: 'screen' });

/**
 * Create an EngineMaterial that samples a RenderSurface. Screens usually want
 * the UNLIT workflow + the EMISSIVE slot (they emit their own light) so they stay
 * bright regardless of scene lighting.
 * @param {object} surface RenderSurface
 * @param {object} [opts] { slot, space, unlit, emissiveStrength, name }
 * @returns {object} EngineMaterial (with a `.surface` binding block)
 */
export function createSurfaceMaterial(surface, opts = {}) {
  const slot = opts.slot ?? SURFACE_SLOT.EMISSIVE;
  const space = opts.space ?? SURFACE_SPACE.WORLD;
  const unlit = opts.unlit ?? (slot === SURFACE_SLOT.EMISSIVE);
  const mat = createEngineMaterial({
    name: opts.name ?? `surface:${surface.id}`,
    workflow: unlit ? WORKFLOW.UNLIT : WORKFLOW.METALLIC_ROUGHNESS,
    baseColorFactor: [1, 1, 1, 1],
    emissiveFactor: slot === SURFACE_SLOT.EMISSIVE ? [1, 1, 1] : [0, 0, 0],
  });
  // Reference the surface via a virtual texture id so existing binding code that
  // keys textures by id keeps working; the manager owns the real GPU texture.
  mat.textures = mat.textures || {};
  mat.textures[slot] = { textureId: `surface://${surface.id}`, uvSet: 0, surface: true };
  mat.surface = {
    surfaceId: surface.id, slot, space,
    emissiveStrength: opts.emissiveStrength ?? 1,
  };
  return mat;
}

/**
 * Live GPU resource for a surface, for inserting into a bind group.
 * @returns {{ view: GPUTextureView, sampler: GPUSampler }|null} null until first upload
 */
export function surfaceTextureResource(surface) {
  if (!surface?.gpu?.view || !surface.gpu.sampler) return null;
  return {
    texture: surface.gpu.texture,
    view: surface.gpu.view,
    sampler: surface.gpu.sampler,
    width: surface.gpu.width ?? surface.width,
    height: surface.gpu.height ?? surface.height,
    generation: surface.gpu.generation ?? surface.generation ?? 0,
    colorSpace: surface.gpu.colorSpace ?? surface.colorSpace,
    external: !!surface.gpu.external,
  };
}

/** Is this material backed by a render surface? Returns its binding block or null. */
export function materialSurfaceBinding(material) {
  return material?.surface || null;
}

/** Map a virtual surface texture id (`surface://id`) back to the surface id. */
export function surfaceIdFromTextureId(textureId) {
  return typeof textureId === 'string' && textureId.startsWith('surface://') ? textureId.slice('surface://'.length) : null;
}
