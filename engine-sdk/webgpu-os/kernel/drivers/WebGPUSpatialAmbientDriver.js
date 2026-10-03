// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createAmbientGpuRuntimeDriver } from './WebGPUAmbientRuntimeV3Driver.js';
import { createSpatialAmbientLane } from './SpatialAmbientLane.js';
import { validateAmbientSpatialPlan, AMBIENT_SPATIAL_ID, AMBIENT_SPATIAL_ABI, AMBIENT_SPATIAL_TYPE } from '../schema/AmbientSpatialContract.js';

export function createWebGPUSpatialAmbientDriver(options = {}) {
    return createAmbientGpuRuntimeDriver(options, { surfaceId: 'os-ambient-spatial', createLane: createSpatialAmbientLane, normalizeConfig });
}
function normalizeConfig(config, maxPixels, suspended, accessibility) {
    if (config?.type !== AMBIENT_SPATIAL_TYPE) return { ok: false, code: 'AMBIENT_SPATIAL_CONFIG_INVALID', message: 'Spatial wallpaper requires webgpu-spatial config' };
    const checked = validateAmbientSpatialPlan(config.plan);
    if (!checked.ok) return checked;
    const plan = checked.plan;
    return { ok: true, config: Object.freeze({
        type: AMBIENT_SPATIAL_TYPE, runtimeId: AMBIENT_SPATIAL_ID, runtimeAbi: AMBIENT_SPATIAL_ABI, plan, execution: checked.execution,
        staticColor: /^#[a-f0-9]{6}$/i.test(config.staticColor) ? config.staticColor : plan.accessibility.staticFallback.color,
        targetFps: bound(config.targetFps, plan.settings.targetFps, 1, 60), maxDpr: bound(config.maxDpr, plan.settings.maxDpr, .5, 4),
        maxPixels: Math.min(maxPixels, bound(config.maxPixels, plan.settings.maxPixelCount, 4, 67_108_864)),
        interactive: config.interactive !== false && plan.settings.interactive,
        suspended: config.suspended === undefined ? suspended : config.suspended === true,
        ...Object.fromEntries(['reducedMotion', 'forcedColors', 'reduceTransparency'].map(key => [key, (key === 'reducedMotion' && plan.accessibility.reducedMotion) || (config[key] === undefined ? accessibility[key] : config[key] === true)])),
    }) };
}
function bound(value, fallback, min, max) { return Math.max(min, Math.min(max, Number.isFinite(value) ? value : fallback)); }
