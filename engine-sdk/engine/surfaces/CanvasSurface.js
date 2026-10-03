// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/surfaces/CanvasSurface.js — the base pixel source: a 2D canvas drawn by
// a callback. CodeSurface and TerminalSurface build on it. A source exposes the
// contract SurfaceManager expects: `.canvas`, optional `.dirty`, `.render(dt)`,
// `.resize(w,h)`, `.onPointer(e)`, `.onKey(e)`, `.dispose()`.

/** Encode a DOM or offscreen canvas through the browser's native image codec. */
export function canvasToBlob(canvas, type = 'image/png', quality = undefined) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The image could not be encoded.')), type, quality));
}

/** Allocate a 2D canvas (OffscreenCanvas when available, else a DOM canvas). */
export function make2DCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(width, height);
    return { canvas: c, ctx: c.getContext('2d') };
  }
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    return { canvas: c, ctx: c.getContext('2d') };
  }
  throw new Error('CanvasSurface: no canvas implementation available');
}

/**
 * A generic canvas source.
 * @param {object} opts { width, height, draw(ctx,info), onPointer, onKey, realtime }
 *   `draw` is called on each render; mark the source dirty (or use realtime mode)
 *   to trigger uploads. `info` = { dt, width, height, frame }.
 */
export function createCanvasSurface(opts = {}) {
  const width = Math.max(1, Math.floor(opts.width ?? 512));
  const height = Math.max(1, Math.floor(opts.height ?? 512));
  const { canvas, ctx } = make2DCanvas(width, height);
  let frame = 0;

  const self = {
    canvas,
    ctx,
    width,
    height,
    flipY: false,
    dirty: true,           // request an initial upload
    realtime: !!opts.realtime,

    render(dt = 0) {
      frame++;
      if (opts.draw) opts.draw(ctx, { dt, width: self.width, height: self.height, frame });
      if (self.realtime) self.dirty = true;
    },

    markDirty() { self.dirty = true; },

    resize(w, h) {
      self.width = canvas.width = Math.max(1, Math.floor(w));
      self.height = canvas.height = Math.max(1, Math.floor(h));
      self.dirty = true;
    },

    onPointer(e) { opts.onPointer?.(e, self); },
    onKey(e) { opts.onKey?.(e, self); },
    dispose() { opts.dispose?.(self); },
  };
  return self;
}
