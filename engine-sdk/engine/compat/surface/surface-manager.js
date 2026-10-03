// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * surface/surface-manager.js — pick the presentation surface for a guest.
 *
 * Selected by `profile.gpu.presentation`. `webgpu-canvas` (and `canvas-2d`) are
 * implemented. `offscreen` requires an explicit worker renderer module;
 * `engine-texture` requires a host-compositor factory. Missing prerequisites
 * fall back to the ordinary canvas surface without claiming support.
 */

import { WebgpuCanvasSurface }  from './webgpu-canvas-surface.js';
import { EngineTextureSurface } from './engine-texture-surface.js';
import { OffscreenSurface }     from './offscreen-surface.js';

export function selectSurface(profile, deps = {}) {
    const kind = profile?.gpu?.presentation ?? 'webgpu-canvas';
    switch (kind) {
        case 'engine-texture': return tryCreate(EngineTextureSurface, deps) ?? new WebgpuCanvasSurface(deps);
        case 'offscreen':      return tryCreate(OffscreenSurface, deps)     ?? new WebgpuCanvasSurface(deps);
        case 'none':           return null;
        case 'canvas-2d':
        case 'webgpu-canvas':
        default:               return new WebgpuCanvasSurface(deps);
    }
}

function tryCreate(Cls, deps) {
    try { const s = new Cls(deps); return s.supported ? s : null; }
    catch { return null; }
}
