// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * FrameContext — Per-frame shared state passed to every pipeline stage.
 *
 * The engine provides a minimal base context with timing and GPU fields.
 * Consumers (editor, game) extend it with their own fields via the
 * overrides parameter.
 *
 * Usage:
 *   const ctx = createFrameContext({
 *       dt: 0.016, currentTime: performance.now(),
 *       device: gpuDevice, camera: myCamera,
 *       editor: editorApp, scene: editorApp.scene,
 *   });
 *   pipeline.execute(ctx);
 */

/**
 * Create a per-frame context object.
 * @param {Object} [overrides]  Consumer-specific fields merged into the context
 * @returns {Object} FrameContext
 */
export function createFrameContext(overrides) {
    const ctx = {
        // Timing — set by consumer before execute()
        dt: 0,
        currentTime: 0,
        accumulator: 0,
        fixedDt: 0,
        fixedStepCount: 0,
        fixedAlpha: 0,          // interpolation alpha (accumulator remainder / fixedDt) [0,1]

        // GPU handles — set by consumer
        device: null,
        encoder: null,

        // Inter-stage data slots — stages write here, later stages read
        shared: {},
    };

    if (overrides) {
        const keys = Object.keys(overrides);
        for (let i = 0; i < keys.length; i++) {
            ctx[keys[i]] = overrides[keys[i]];
        }
    }

    return ctx;
}
