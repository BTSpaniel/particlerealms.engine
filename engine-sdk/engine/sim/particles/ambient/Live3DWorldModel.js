// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Meaning-bearing identity for the original WebGPU OS Live 3D World.
 *
 * The runtime implementation and the OS plan contract both consume this one
 * description so the built-in wallpaper and authored previews cannot drift
 * into two subtly different particle simulations.
 */

export const LIVE_3D_WORLD_RUNTIME_ABI = 'particle-realms.ambient-particles.runtime.v1';

export const LIVE_3D_WORLD_FAMILIES = deepFreeze({
    emitter: 'emitter.stratified-seven-substance.v1',
    init: 'initial-condition.density-split.v1',
    field: 'field.screen-density-turbulence.v1',
    solver: 'solver.thermal-reaction-buoyancy.v1',
    renderer: 'renderer.additive-substance-sprites.v1',
    camera: 'camera.orthographic-screen.v1',
    post: 'post.sprite-core-bloom.v1',
    output: 'output.premultiplied-canvas.v1',
});

export const LIVE_3D_WORLD_GRID = deepFreeze({
    width: 160,
    height: 90,
    maxInteractionRects: 64,
});

export const LIVE_3D_WORLD_SUBSTANCES = deepFreeze([
    { id: 'water', baseTemperature: 20, density: 1000, initialSpeed: 12 },
    { id: 'fire', baseTemperature: 900, density: 0.3, initialSpeed: 40 },
    { id: 'acid', baseTemperature: 50, density: 1200, initialSpeed: 18 },
    { id: 'plasma', baseTemperature: 6000, density: 0.001, initialSpeed: 70 },
    { id: 'sand', baseTemperature: 35, density: 1600, initialSpeed: 8 },
    { id: 'steam', baseTemperature: 120, density: 0.6, initialSpeed: 25 },
    { id: 'oil', baseTemperature: 25, density: 850, initialSpeed: 10 },
]);

export const LIVE_3D_WORLD_DEFAULT_SETTINGS = deepFreeze({
    particleCount: 20_000,
    clearColor: '#07090f',
    interactive: true,
    targetFps: 60,
    maxDpr: 4,
    maxPixelCount: 67_108_864,
});

export const LIVE_3D_WORLD_ACCESSIBILITY = deepFreeze({
    reducedMotion: 'pause',
    staticFallback: {
        type: 'css',
        color: '#07090f',
    },
});

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}
