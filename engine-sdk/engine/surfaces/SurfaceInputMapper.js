// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/surfaces/SurfaceInputMapper.js — route input to a focused RenderSurface.
//
// Pointer events arrive as a UV hit (from the renderer's raycast against the mesh
// the surface is mapped to); this maps UV → surface pixel coords and dispatches
// to the surface's source. Keyboard events go to whichever surface is "focused"
// (typically the last one clicked). Only surfaces whose `permissions.input` is
// true receive events — surfaces are inert by default.

/** Convert a UV hit (with v measured top-down) to integer surface pixels. */
export function uvToPixel(surface, u, v) {
  if (!Number.isFinite(u) || !Number.isFinite(v)) {
    throw new RangeError('uvToPixel requires finite UV coordinates');
  }
  const boundedU = Math.max(0, Math.min(1, u));
  const boundedV = Math.max(0, Math.min(1, v));
  return {
    x: Math.min(surface.width - 1, Math.floor(boundedU * surface.width)),
    y: Math.min(surface.height - 1, Math.floor(boundedV * surface.height)),
  };
}

/**
 * Create an input mapper over a set of surfaces (or a SurfaceManager).
 * @param {object} [opts] { getSurface(id), surfaces:Map|Array }
 */
export function createSurfaceInputMapper(opts = {}) {
  let focusedId = null;
  const capturedPointers = new Map();
  const resolve = (id) => {
    if (opts.getSurface) return opts.getSurface(id);
    if (opts.surfaces instanceof Map) return opts.surfaces.get(id);
    if (Array.isArray(opts.surfaces)) return opts.surfaces.find((s) => s.id === id);
    return null;
  };
  const canInput = (s) => !!(s && s.permissions?.input && s.source);

  function changeFocus(nextId) {
    const next = nextId == null ? null : resolve(nextId);
    if (nextId != null && !canInput(next)) return false;
    if (focusedId === nextId) return true;
    const previous = resolve(focusedId);
    previous?.source?.onBlur?.({ relatedSurfaceId: nextId });
    focusedId = nextId;
    next?.source?.onFocus?.({ relatedSurfaceId: previous?.id ?? null });
    return true;
  }

  /**
   * Dispatch a pointer event onto a surface from a UV hit.
   * @param {string} surfaceId
   * @param {object} ev { type:'down'|'move'|'up', u, v, button? }
   * @returns {boolean} handled
   */
  function pointer(surfaceId, ev) {
    const pointerId = ev.pointerId ?? 0;
    const capturedId = capturedPointers.get(pointerId);
    const routedId = capturedId ?? surfaceId;
    const s = resolve(routedId);
    if (!canInput(s)) return false;
    if (ev.type === 'down') {
      changeFocus(routedId);
      capturedPointers.set(pointerId, routedId);
    }
    const px = uvToPixel(s, ev.u, ev.v);
    s.source.onPointer?.({ ...ev, x: px.x, y: px.y, u: ev.u, v: ev.v });
    s.dirty = true;
    if (ev.type === 'up' || ev.type === 'cancel') capturedPointers.delete(pointerId);
    return true;
  }

  /**
   * Dispatch a keyboard event to the focused surface.
   * @param {object} ev DOM-like { key, ctrlKey, metaKey, type }
   * @returns {boolean} handled (caller can preventDefault)
   */
  function key(ev) {
    const s = resolve(focusedId);
    if (!canInput(s) || typeof s.source.onKey !== 'function') return false;
    s.source.onKey(ev);
    return true;
  }

  function focus(id) { return changeFocus(id); }
  function blur() {
    capturedPointers.clear();
    return changeFocus(null);
  }
  function focused() { return focusedId; }
  function captured(pointerId = 0) { return capturedPointers.get(pointerId) ?? null; }

  return { pointer, key, focus, blur, focused, captured };
}
