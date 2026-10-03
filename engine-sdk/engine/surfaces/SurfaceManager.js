// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/surfaces/SurfaceManager.js — owns the GPU texture lifetime and the
// update scheduler for a set of RenderSurfaces. Each tick it asks the policy
// (surfaceNeedsUpload) which surfaces changed/are due/are realtime-and-visible,
// renders just those sources, and uploads them — so nothing touches the GPU
// unless it must (dirty-only by default, interval-capped, slept when off-screen).
//
// The actual GPU calls are isolated behind an injectable `uploader`, so the
// scheduling logic is testable headless (gates) without a WebGPU device.

import { SURFACE_SOURCE, surfaceNeedsUpload } from './RenderSurface.js';

const EXTERNAL_SOURCE_TYPES = new Set([
  SURFACE_SOURCE.CAMERA,
  SURFACE_SOURCE.IMAGE,
  SURFACE_SOURCE.VIDEO,
  SURFACE_SOURCE.WEBGPU,
]);

/** The uploadable image source backing a surface (canvas / img / video). */
export function surfaceImageSource(surface) {
  const s = surface.source;
  if (!s) return null;
  return s.canvas || s.element || s.source || null;
}

/** True when an external-image source has decoded enough pixels to copy. */
export function surfaceImageReady(surface) {
  const source = surface?.source;
  const image = surfaceImageSource(surface);
  if (!image) return false;
  if (typeof source?.isReady === 'function') return !!source.isReady();
  if (typeof HTMLVideoElement !== 'undefined' && image instanceof HTMLVideoElement) {
    return image.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      && image.videoWidth > 0 && image.videoHeight > 0;
  }
  if (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) {
    return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
  }
  return Number(image.width ?? surface.width) > 0 && Number(image.height ?? surface.height) > 0;
}

function defaultUploader(device) {
  return (surface) => {
    const img = surfaceImageSource(surface);
    if (!img || !surface.gpu || !surfaceImageReady(surface)) return false;
    try {
      device.queue.copyExternalImageToTexture(
        { source: img, flipY: !!surface.source?.flipY },
        { texture: surface.gpu.texture },
        [surface.width, surface.height],
      );
      return true;
    } catch (error) {
      surface.metadata.lastUploadError = error?.message || String(error);
      return false;
    }
  };
}

/**
 * Create a surface manager.
 * @param {GPUDevice|null} device WebGPU device (may be null for headless tests if an uploader is supplied)
 * @param {object} [opts] { uploader?, sampler? }
 */
export function createSurfaceManager(device, opts = {}) {
  const surfaces = new Map();
  const upload = opts.uploader || (device ? defaultUploader(device) : () => false);
  let sharedSampler = opts.sampler || null;

  function sampler() {
    if (sharedSampler) return sharedSampler;
    if (!device) return null;
    sharedSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    return sharedSampler;
  }

  function ensureGpu(surface) {
    // External (adopted) sources own their own GPU texture — e.g. a WebGPUSurface
    // fed a render target. We just point at the source's current texture/view
    // (it may ping-pong each frame) and never allocate or destroy it here.
    if (surface.source?.external) {
      const src = surface.source;
      const changed = !surface.gpu
        || surface.gpu.texture !== src.texture
        || surface.gpu.view !== src.view
        || surface.gpu.sourceGeneration !== src.generation;
      if (!changed) return surface.gpu;
      surface.generation++;
      surface.gpu = {
        texture: src.texture,
        view: src.view,
        sampler: sampler(),
        width: src.width ?? surface.width,
        height: src.height ?? surface.height,
        generation: surface.generation,
        sourceGeneration: src.generation ?? 0,
        colorSpace: surface.colorSpace,
        external: true,
      };
      return surface.gpu;
    }
    const fresh = !surface.gpu || surface.gpu.width !== surface.width || surface.gpu.height !== surface.height;
    if (!fresh) return surface.gpu;
    surface.gpu?.texture?.destroy?.();
    if (!device) {
      surface.generation++;
      surface.gpu = {
        texture: null, view: null, sampler: null,
        width: surface.width, height: surface.height,
        generation: surface.generation, colorSpace: surface.colorSpace, external: false,
      };
      return surface.gpu;
    }
    const texture = device.createTexture({
      size: [surface.width, surface.height, 1],
      format: surface.colorSpace === 'srgb' ? 'rgba8unorm-srgb' : 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    surface.generation++;
    surface.gpu = {
      texture,
      view: texture.createView(),
      sampler: sampler(),
      width: surface.width,
      height: surface.height,
      generation: surface.generation,
      colorSpace: surface.colorSpace,
      external: false,
    };
    return surface.gpu;
  }

  function register(surface) {
    if (!surface?.id) throw new TypeError('SurfaceManager.register requires a surface id');
    if (surfaces.has(surface.id)) throw new Error(`SurfaceManager: duplicate surface id "${surface.id}"`);
    if (EXTERNAL_SOURCE_TYPES.has(surface.sourceType) && !surface.permissions?.external) {
      throw new Error(`SurfaceManager: external permission required for ${surface.sourceType} surface "${surface.id}"`);
    }
    surfaces.set(surface.id, surface);
    surface.source?.resize?.(surface.width, surface.height);
    return surface;
  }
  function unregister(id) {
    const s = surfaces.get(id);
    if (s && !s.gpu?.external) s.gpu?.texture?.destroy?.(); // never destroy adopted textures
    s?.source?.dispose?.();
    surfaces.delete(id);
  }
  function get(id) { return surfaces.get(id) || null; }
  function all() { return [...surfaces.values()]; }
  function setVisible(id, v) { const s = surfaces.get(id); if (s) s.visible = !!v; }

  /**
   * Advance all surfaces. Renders + uploads only those the policy selects.
   * @returns {number} how many surfaces uploaded this tick
   */
  function tick(nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()), dt = 0) {
    let uploaded = 0;
    for (const surface of surfaces.values()) {
      try {
        // Bridge source-driven changes (e.g. a keystroke in a terminal) into the
        // surface's upload flag, so DIRTY mode reacts without polling pixels.
        if (surface.source && surface.source.dirty) { surface.dirty = true; surface.source.dirty = false; }
        if (!surface.visible) continue;
        // External GPU sources: adopt the latest texture/view; there is nothing to
        // upload (the source rendered straight into its own texture).
        if (surface.source?.external) {
          const previousGeneration = surface.gpu?.generation;
          ensureGpu(surface);
          const changed = surface.dirty || previousGeneration !== surface.gpu?.generation;
          if (changed) {
            surface.dirty = false;
            surface.lastUploadMs = nowMs;
            surface.uploads++;
            uploaded++;
          }
          delete surface.metadata.lastSourceError;
          continue;
        }
        if (!surfaceNeedsUpload(surface, nowMs)) continue;
        ensureGpu(surface);
        surface.source?.render?.(dt, surface); // refresh pixels just before upload
        const ok = upload(surface);
        if (ok) {
          surface.dirty = false;
          surface.lastUploadMs = nowMs;
          surface.uploads++;
          delete surface.metadata.lastUploadError;
          delete surface.metadata.lastSourceError;
          uploaded++;
        } else {
          // A video/image may not have decoded a frame yet. Preserve dirty state so
          // the first valid frame is retried instead of freezing a blank texture.
          surface.dirty = true;
        }
      } catch (error) {
        surface.dirty = true;
        surface.metadata.lastSourceError = error?.message || String(error);
      }
    }
    return uploaded;
  }

  function dispose() {
    for (const id of [...surfaces.keys()]) unregister(id);
    sharedSampler = null;
  }

  return { register, unregister, get, all, setVisible, ensureGpu, tick, dispose };
}
