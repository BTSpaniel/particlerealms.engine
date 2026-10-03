// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * healers/gpu-healer.js — normalise GPU-related profile fields before boot.
 *
 * Sets a sensible `gpu.presentation` and ensures the runtime healing flags the
 * interposer relies on (`clampGpuLimits`, `wrapQueueSubmit`) are populated. The
 * actual limit-clamping happens at runtime in `interposers/gpu.js`.
 */

export function healGpu({ profile }, report) {
    const u = profile.uses ?? (profile.uses = {});
    const g = profile.gpu  ?? (profile.gpu  = {});
    const h = profile.healing ?? (profile.healing = {});

    if (!g.presentation) {
        g.presentation = u.webgpu ? 'webgpu-canvas' : (u.canvas2d ? 'canvas-2d' : 'none');
    }
    if (u.webgpu) {
        if (h.clampGpuLimits == null)  h.clampGpuLimits = true;
        if (h.wrapQueueSubmit == null) h.wrapQueueSubmit = true;
    }
    report.push(`gpu: presentation=${g.presentation}`);
}
