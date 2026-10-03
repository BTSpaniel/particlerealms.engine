// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/surfaces/WebGPUSurface.js — a surface source that ADOPTS an externally
// rendered GPU texture instead of uploading pixels from a canvas. The host renders
// into its own render target(s) and hands the current texture/view to the surface
// each frame via `adopt()`; SurfaceManager then exposes it like any other surface
// (sampleable on a mesh) with zero copies. This backs feedback/mirror effects and
// "stream the screen onto a screen" use-cases (SURFACE_SOURCE.WEBGPU).
//
// Safety: it only ever adopts textures the host already owns — there is no capture
// of arbitrary external content.

/**
 * @param {object} opts { width, height, texture?, view? }
 * @returns {object} an external surface source
 */
export function createWebGPUSurface(opts = {}) {
  const self = {
    external: true,            // SurfaceManager: adopt, don't upload
    sourceType: 'webgpu',
    width: Math.max(1, Math.floor(opts.width ?? 512)),
    height: Math.max(1, Math.floor(opts.height ?? 512)),
    texture: opts.texture ?? null,
    view: opts.view ?? null,
    generation: 0,
    dirty: true,

    /** Adopt the host's current GPU texture (+ optional view). */
    adopt(texture, view = null) {
      const nextView = view || (texture === self.texture && self.view
        ? self.view
        : (texture ? texture.createView() : null));
      if (self.texture !== texture || self.view !== nextView) {
        self.texture = texture;
        self.view = nextView;
        self.generation++;
        self.dirty = true;
      }
      return self;
    },

    resize(w, h) { self.width = Math.max(1, Math.floor(w)); self.height = Math.max(1, Math.floor(h)); self.dirty = true; },
    dispose() { self.texture = null; self.view = null; }, // host owns the texture's lifetime
  };
  return self;
}
