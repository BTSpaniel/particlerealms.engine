// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
    LIVE_3D_WORLD_ACCESSIBILITY,
    LIVE_3D_WORLD_DEFAULT_SETTINGS,
    LIVE_3D_WORLD_FAMILIES,
    LIVE_3D_WORLD_GRID,
    LIVE_3D_WORLD_RUNTIME_ABI,
    LIVE_3D_WORLD_SUBSTANCES,
} from '../../../engine/sim/particles/ambient/Live3DWorldModel.js';
import { IncrementalSha256 } from '../../storage/IncrementalSha256.js';
import { normalizeParticleAuthoring, particleAuthoringCount } from '../../../engine/sim/particles/ambient/Live3DWorldAuthoring.js';

export const PARTICLE_AMBIENT_PLAN_SCHEMA = 'particle-realms.ambient-particle-plan.v1';
export const PARTICLE_AMBIENT_PLAN_VERSION = 1;

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/;
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const PLAN_KEYS = Object.freeze([
    'schema', 'version', 'projectId', 'revision', 'contentHash', 'runtimeAbi',
    'families', 'simulation', 'settings', 'accessibility',
]);
const FAMILY_KEYS = Object.freeze(['emitter', 'init', 'field', 'solver', 'renderer', 'camera', 'post', 'output']);
const SIMULATION_KEYS = Object.freeze(['grid', 'substances']);
const GRID_KEYS = Object.freeze(['width', 'height', 'maxInteractionRects']);
const SUBSTANCE_KEYS = Object.freeze(['id', 'baseTemperature', 'density', 'initialSpeed']);
const SETTINGS_KEYS = Object.freeze(['particleCount', 'clearColor', 'interactive', 'targetFps', 'maxDpr', 'maxPixelCount']);
const ACCESSIBILITY_KEYS = Object.freeze(['reducedMotion', 'staticFallback']);
const FALLBACK_KEYS = Object.freeze(['type', 'color']);

export const DEFAULT_PARTICLE_AMBIENT_PLAN = createParticleAmbientPlan();

/** Create a canonical Live 3D World plan with bounded runtime settings. */
export function createParticleAmbientPlan(overrides = {}) {
    const source = isPlainObject(overrides) ? overrides : {};
    const settingsSource = isPlainObject(source.settings) ? source.settings : source;
    const plan = {
        schema: PARTICLE_AMBIENT_PLAN_SCHEMA,
        version: PARTICLE_AMBIENT_PLAN_VERSION,
        projectId: normalizeProjectId(source.projectId, 'live-3d-world'),
        revision: boundedInteger(source.revision, 1, Number.MAX_SAFE_INTEGER, 1),
        runtimeAbi: LIVE_3D_WORLD_RUNTIME_ABI,
        families: cloneJson(LIVE_3D_WORLD_FAMILIES),
        simulation: {
            grid: cloneJson(LIVE_3D_WORLD_GRID),
            substances: cloneJson(LIVE_3D_WORLD_SUBSTANCES),
        },
        settings: {
            particleCount: boundedInteger(
                settingsSource.particleCount ?? settingsSource.count,
                256,
                250_000,
                LIVE_3D_WORLD_DEFAULT_SETTINGS.particleCount,
            ),
            clearColor: normalizeColor(settingsSource.clearColor, LIVE_3D_WORLD_DEFAULT_SETTINGS.clearColor),
            interactive: settingsSource.interactive !== false,
            targetFps: boundedInteger(settingsSource.targetFps, 1, 60, LIVE_3D_WORLD_DEFAULT_SETTINGS.targetFps),
            maxDpr: boundedNumber(settingsSource.maxDpr, 0.5, 4, LIVE_3D_WORLD_DEFAULT_SETTINGS.maxDpr),
            maxPixelCount: boundedInteger(
                settingsSource.maxPixelCount ?? settingsSource.maxPixels,
                16_384,
                67_108_864,
                LIVE_3D_WORLD_DEFAULT_SETTINGS.maxPixelCount,
            ),
        },
        accessibility: cloneJson(LIVE_3D_WORLD_ACCESSIBILITY),
    };
    if (source.authoring !== undefined) {
        plan.authoring = normalizeParticleAuthoring(source.authoring);
        plan.settings.particleCount = Math.max(256, particleAuthoringCount(plan.authoring));
    }
    plan.contentHash = particleAmbientPlanHash(plan);
    return deepFreeze(plan);
}

/**
 * Convert the historical `{ count, clearColor, interactive }` configuration
 * into exactly the same canonical plan used by authored particle wallpapers.
 */
export function particleAmbientPlanFromLegacyConfig(config = {}) {
    const source = isPlainObject(config) ? config : {};
    return createParticleAmbientPlan({
        projectId: 'live-3d-world',
        revision: 1,
        count: source.count,
        clearColor: source.clearColor,
        interactive: source.interactive,
        targetFps: source.targetFps,
        maxDpr: source.maxDpr,
        maxPixels: source.maxPixels,
    });
}

/** Validate shape, bounds, fixed engine families, and the canonical hash. */
export function validateParticleAmbientPlan(value) {
    try {
        assertPlainObject(value, 'plan');
        assertExactKeys(value, value.authoring === undefined ? PLAN_KEYS : [...PLAN_KEYS, 'authoring'], 'plan');
        if (value.schema !== PARTICLE_AMBIENT_PLAN_SCHEMA || value.version !== PARTICLE_AMBIENT_PLAN_VERSION) {
            return failure('PARTICLE_AMBIENT_PLAN_SCHEMA', 'Particle wallpaper plan schema or version is unsupported.');
        }
        if (!PROJECT_ID_PATTERN.test(String(value.projectId ?? ''))) {
            return failure('PARTICLE_AMBIENT_PLAN_PROJECT', 'Particle wallpaper projectId is invalid.');
        }
        if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
            return failure('PARTICLE_AMBIENT_PLAN_REVISION', 'Particle wallpaper revision is invalid.');
        }
        if (value.runtimeAbi !== LIVE_3D_WORLD_RUNTIME_ABI) {
            return failure('PARTICLE_AMBIENT_PLAN_ABI', 'Particle wallpaper runtime ABI is unsupported.');
        }
        assertPlainObject(value.families, 'plan.families');
        assertExactKeys(value.families, FAMILY_KEYS, 'plan.families');
        for (const key of FAMILY_KEYS) {
            if (value.families[key] !== LIVE_3D_WORLD_FAMILIES[key]) {
                return failure('PARTICLE_AMBIENT_PLAN_FAMILY', `Particle wallpaper ${key} family is unsupported.`);
            }
        }
        assertPlainObject(value.simulation, 'plan.simulation');
        assertExactKeys(value.simulation, SIMULATION_KEYS, 'plan.simulation');
        assertPlainObject(value.simulation.grid, 'plan.simulation.grid');
        assertExactKeys(value.simulation.grid, GRID_KEYS, 'plan.simulation.grid');
        if (canonicalJson(value.simulation.grid) !== canonicalJson(LIVE_3D_WORLD_GRID)) {
            return failure('PARTICLE_AMBIENT_PLAN_GRID', 'Particle wallpaper grid contract is unsupported.');
        }
        if (!Array.isArray(value.simulation.substances)
            || value.simulation.substances.length !== LIVE_3D_WORLD_SUBSTANCES.length) {
            return failure('PARTICLE_AMBIENT_PLAN_SUBSTANCES', 'Particle wallpaper substance contract is incomplete.');
        }
        value.simulation.substances.forEach((substance, index) => {
            assertPlainObject(substance, `plan.simulation.substances[${index}]`);
            assertExactKeys(substance, SUBSTANCE_KEYS, `plan.simulation.substances[${index}]`);
        });
        if (canonicalJson(value.simulation.substances) !== canonicalJson(LIVE_3D_WORLD_SUBSTANCES)) {
            return failure('PARTICLE_AMBIENT_PLAN_SUBSTANCES', 'Particle wallpaper substance contract is unsupported.');
        }
        assertSettings(value.settings);
        if (value.authoring !== undefined) {
            const authoring = normalizeParticleAuthoring(value.authoring);
            if (canonicalJson(authoring) !== canonicalJson(value.authoring) || value.settings.particleCount !== Math.max(256, particleAuthoringCount(authoring))) throw new TypeError('Live 3D authoring must be canonical and match the allocated population');
        }
        assertAccessibility(value.accessibility);
        if (!HASH_PATTERN.test(String(value.contentHash ?? ''))) {
            return failure('PARTICLE_AMBIENT_PLAN_HASH', 'Particle wallpaper contentHash is invalid.');
        }
        const expectedHash = particleAmbientPlanHash(value);
        if (value.contentHash !== expectedHash) {
            return failure('PARTICLE_AMBIENT_PLAN_HASH_MISMATCH', 'Particle wallpaper contentHash does not match its canonical payload.');
        }
        return Object.freeze({ ok: true, plan: deepFreeze(cloneJson(value)), code: null, message: '' });
    } catch (error) {
        return failure('PARTICLE_AMBIENT_PLAN_INVALID', error?.message ?? String(error));
    }
}

/** Deterministic synchronous SHA-256 over all meaning-bearing plan fields. */
export function particleAmbientPlanHash(value) {
    const payload = cloneJson(value);
    delete payload.contentHash;
    const hasher = new IncrementalSha256();
    hasher.update(new TextEncoder().encode(canonicalJson(payload)));
    return `sha256:${hasher.hex()}`;
}

/** Resolve either a new plan config or the original ThemeEngine config. */
export function normalizeParticleAmbientConfig(config = {}) {
    if (!isPlainObject(config)) return failure('PARTICLE_AMBIENT_CONFIG_INVALID', 'Particle wallpaper config must be an object.');
    const plan = config.plan == null ? particleAmbientPlanFromLegacyConfig(config) : config.plan;
    const checked = validateParticleAmbientPlan(plan);
    if (!checked.ok) return checked;
    return Object.freeze({
        ok: true,
        plan: checked.plan,
        config: Object.freeze({
            plan: checked.plan,
            suspended: config.suspended === true,
            reducedMotion: config.reducedMotion === true,
            forcedColors: config.forcedColors === true,
            reduceTransparency: config.reduceTransparency === true,
        }),
        code: null,
        message: '',
    });
}

function assertSettings(value) {
    assertPlainObject(value, 'plan.settings');
    assertExactKeys(value, SETTINGS_KEYS, 'plan.settings');
    if (!Number.isSafeInteger(value.particleCount) || value.particleCount < 256 || value.particleCount > 250_000) {
        throw new RangeError('plan.settings.particleCount must be an integer from 256 through 250000');
    }
    if (!COLOR_PATTERN.test(String(value.clearColor ?? ''))) throw new TypeError('plan.settings.clearColor must be #rrggbb');
    if (typeof value.interactive !== 'boolean') throw new TypeError('plan.settings.interactive must be boolean');
    if (!Number.isSafeInteger(value.targetFps) || value.targetFps < 1 || value.targetFps > 60) {
        throw new RangeError('plan.settings.targetFps must be an integer from 1 through 60');
    }
    if (!Number.isFinite(value.maxDpr) || value.maxDpr < 0.5 || value.maxDpr > 4) {
        throw new RangeError('plan.settings.maxDpr must be from 0.5 through 4');
    }
    if (!Number.isSafeInteger(value.maxPixelCount) || value.maxPixelCount < 16_384 || value.maxPixelCount > 67_108_864) {
        throw new RangeError('plan.settings.maxPixelCount is outside the supported range');
    }
}

function assertAccessibility(value) {
    assertPlainObject(value, 'plan.accessibility');
    assertExactKeys(value, ACCESSIBILITY_KEYS, 'plan.accessibility');
    if (value.reducedMotion !== 'pause') throw new TypeError('plan.accessibility.reducedMotion is unsupported');
    assertPlainObject(value.staticFallback, 'plan.accessibility.staticFallback');
    assertExactKeys(value.staticFallback, FALLBACK_KEYS, 'plan.accessibility.staticFallback');
    if (value.staticFallback.type !== 'css' || !COLOR_PATTERN.test(String(value.staticFallback.color ?? ''))) {
        throw new TypeError('plan.accessibility.staticFallback is invalid');
    }
}

function normalizeProjectId(value, fallback) {
    const id = String(value ?? fallback).trim().toLowerCase();
    return PROJECT_ID_PATTERN.test(id) ? id : fallback;
}

function normalizeColor(value, fallback) {
    const color = String(value ?? fallback).trim().toLowerCase();
    return COLOR_PATTERN.test(color) ? color : fallback;
}

function boundedInteger(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isSafeInteger(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function boundedNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function assertPlainObject(value, label) {
    if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain object`);
}

function assertExactKeys(value, expected, label) {
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
        throw new TypeError(`${label} contains unknown or missing fields`);
    }
}

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function canonicalJson(value) {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError('Canonical JSON forbids non-finite numbers');
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (!isPlainObject(value)) throw new TypeError('Canonical JSON accepts only plain objects');
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function failure(code, message) {
    return Object.freeze({ ok: false, plan: null, config: null, code, message });
}
