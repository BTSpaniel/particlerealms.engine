// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/surfaces/RenderSurface.js — a RenderSurface is a live, drawable texture
// fed by a source (canvas / code / terminal / camera / webgpu / image / video)
// that can be mapped onto a mesh as baseColor/emissive and optionally receive
// pointer/keyboard input via UV hit-testing.
//
// This module owns the schema + update policy (when a surface should re-upload to
// the GPU) and is deliberately GPU-free: SurfaceManager performs the upload, the
// source produces pixels, and RenderSurfaceMaterial binds it to a mesh. Keeping
// these concerns separate makes surfaces reusable across demos, editor, runtime.

/** What feeds a surface's pixels. */
export const SURFACE_SOURCE = Object.freeze({
  CANVAS: 'canvas',     // a 2D canvas drawn by a callback
  CODE: 'code',         // syntax-lite code view
  TERMINAL: 'terminal', // scrolling terminal/REPL
  CAMERA: 'camera',     // a getUserMedia video feed (permissioned)
  WEBGPU: 'webgpu',     // an externally-rendered GPU texture (adopted)
  IMAGE: 'image',       // a static decoded image
  VIDEO: 'video',       // an HTMLVideoElement
});

/**
 * Update cadence. `dirty` only re-uploads when the source flags a change;
 * `interval` re-uploads at most every intervalMs; `realtime` every frame the
 * surface is visible. `static` uploads once.
 */
export const UPDATE_MODE = Object.freeze({
  STATIC: 'static', DIRTY: 'dirty', INTERVAL: 'interval', REALTIME: 'realtime',
});

let _seq = 0;

/**
 * Create a RenderSurface descriptor.
 * @param {object} init
 * @returns {object} surface
 */
export function createRenderSurface(init = {}) {
  init = init || {};
  const width = Math.max(1, Math.floor(init.width ?? 512));
  const height = Math.max(1, Math.floor(init.height ?? 512));
  return {
    id: init.id ?? `surface:${_seq++}`,
    sourceType: init.sourceType ?? SURFACE_SOURCE.CANVAS,
    width,
    height,
    colorSpace: init.colorSpace ?? 'srgb', // srgb for visible content, linear for data
    updateMode: init.updateMode ?? UPDATE_MODE.DIRTY,
    intervalMs: init.intervalMs ?? 250,

    // The pixel source. Must expose `.canvas` (or `.source` for external image)
    // and optionally `.render(dt)`, `.onPointer(e)`, `.onKey(e)`, `.resize(w,h)`.
    source: init.source ?? null,

    // Permissions gate what a surface may do (rule: own content only).
    permissions: {
      input: init.permissions?.input ?? false,        // accept pointer/keyboard
      external: init.permissions?.external ?? false,   // allow camera/video/external
    },

    // Runtime state (managed here + by SurfaceManager).
    dirty: true,           // needs (re)upload
    visible: true,         // off-screen surfaces are throttled/slept
    lastUploadMs: -Infinity,
    uploads: 0,            // counter (gates/inspectors)
    generation: 0,         // increments whenever the sampled GPU resource changes
    gpu: null,             // { texture, view, sampler } — set by SurfaceManager

    metadata: { ...(init.metadata || {}) },
  };
}

/** Flag a surface as needing a GPU re-upload. */
export function markSurfaceDirty(surface) {
  if (surface) surface.dirty = true;
}

/** Resize a surface (also resizes its source canvas) and flag it dirty. */
export function resizeSurface(surface, width, height) {
  surface.width = Math.max(1, Math.floor(width));
  surface.height = Math.max(1, Math.floor(height));
  surface.source?.resize?.(surface.width, surface.height);
  // Keep the old resource reachable so SurfaceManager can destroy it safely
  // when it allocates the replacement. Dropping the reference here leaked the
  // previous GPUTexture on every resize.
  surface.dirty = true;
}

/**
 * Decide whether a surface should upload to the GPU this tick. Pure (no side
 * effects) so it is unit-testable; SurfaceManager applies the result.
 * @param {object} surface
 * @param {number} nowMs
 * @returns {boolean}
 */
export function surfaceNeedsUpload(surface, nowMs) {
  if (!surface.visible) return false;       // off-screen → sleep
  if (!surface.gpu) return true;            // not yet on GPU
  switch (surface.updateMode) {
    case UPDATE_MODE.STATIC:
      return surface.uploads === 0 || surface.dirty;
    case UPDATE_MODE.DIRTY:
      return surface.dirty;
    case UPDATE_MODE.INTERVAL:
      // Interval is a ceiling as well as a refresh request: dirty content waits
      // for the next scheduled slot instead of bypassing the cadence.
      return (nowMs - surface.lastUploadMs) >= surface.intervalMs;
    case UPDATE_MODE.REALTIME:
      return true;
    default:
      return surface.dirty;
  }
}
