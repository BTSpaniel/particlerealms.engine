// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { LIVE_3D_WORLD_SUBSTANCES } from './Live3DWorldModel.js';
import { uniformDistribution, mulberry32 } from '../../../core/math/MathRandom.js';

export const PARTICLE_AUTHORING_DEFAULTS = Object.freeze({
    initialize: Object.freeze({ enabled: true, spreadX: 1, spreadY: 1, speedScale: 1 }),
    field: Object.freeze({ enabled: true, turbulence: 1, densityPressure: 1, pointerStrength: 1 }),
    solver: Object.freeze({ enabled: true, gravity: 1, thermalRate: 1, timeScale: 1 }),
    renderer: Object.freeze({ enabled: true, pointScale: 1, brightness: 1 }),
    camera: Object.freeze({ enabled: true, zoom: 1, offsetX: 0, offsetY: 0 }),
    bloom: Object.freeze({ enabled: true, glow: 1, core: 1 }),
});
const GROUP_LIMITS = {
    initialize: { spreadX: [.05, 2], spreadY: [.05, 2], speedScale: [0, 3] },
    field: { turbulence: [0, 3], densityPressure: [0, 3], pointerStrength: [0, 3] },
    solver: { gravity: [0, 3], thermalRate: [0, 3], timeScale: [0, 2] },
    renderer: { pointScale: [.1, 4], brightness: [0, 3] },
    camera: { zoom: [.25, 4], offsetX: [-1, 1], offsetY: [-1, 1] }, bloom: { glow: [0, 3], core: [0, 3] },
};
/** Optional, persisted artist response. Absent data retains the historical
 * attraction law and its exact serialized plan; transport remains native. */
export const PARTICLE_POINTER_MODES = Object.freeze(['off', 'attract', 'repel', 'swirl', 'ripple']);
export const PARTICLE_POINTER_DEFAULTS = Object.freeze({
    version: 1, enabled: true, hoverMode: 'attract', hoverStrength: .35,
    pressMode: 'swirl', pressStrength: .8, dwellMode: 'attract', dwellStrength: .25,
    dwellDelay: .6, dwellDuration: 1.2, clickMode: 'repel', clickStrength: 1,
    clickDuration: .8, clickDecay: 3, radius: .16, falloff: 2,
    acceleration: 80, rippleFrequency: 14, rippleSpeed: 8,
});
export const PARTICLE_POINTER_LIMITS = Object.freeze({
    hoverStrength: [0, 3], pressStrength: [0, 3], dwellStrength: [0, 3],
    dwellDelay: [0, 10], dwellDuration: [.05, 10], clickStrength: [0, 3],
    clickDuration: [.05, 5], clickDecay: [0, 12], radius: [.01, .5],
    falloff: [.25, 8], acceleration: [0, 600], rippleFrequency: [1, 48], rippleSpeed: [0, 24],
});
export function normalizeParticlePointerResponse(value) {
    exactKeys(value, Object.keys(PARTICLE_POINTER_DEFAULTS));
    if (value.version !== 1 || typeof value.enabled !== 'boolean') throw new TypeError('Unsupported particle pointer response');
    const result = { version: 1, enabled: value.enabled };
    for (const key of ['hoverMode', 'pressMode', 'dwellMode', 'clickMode']) {
        if (!PARTICLE_POINTER_MODES.includes(value[key])) throw new TypeError(`Unsupported particle ${key}`);
        result[key] = value[key];
    }
    for (const [key, range] of Object.entries(PARTICLE_POINTER_LIMITS)) result[key] = bounded(value[key], ...range);
    // Stable property order makes authoring plan comparison deterministic.
    return Object.fromEntries(Object.keys(PARTICLE_POINTER_DEFAULTS).map(key => [key, result[key]]));
}
export function normalizeParticleAuthoring(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.emitters) || value.emitters.length > 64) throw new TypeError('Invalid Live 3D authoring program');
    exactKeys(value, ['version', 'emitters', ...Object.keys(PARTICLE_AUTHORING_DEFAULTS)]);
    const ids = new Set();
    const emitters = value.emitters.map(item => {
        exactKeys(item, ['id', 'substance', 'count', 'seed', 'temperature', 'density', 'initialSpeed']);
        if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(item.id) || ids.has(item.id)) throw new TypeError('Emitter IDs must be unique');
        ids.add(item.id);
        return { id: item.id, substance: bounded(item.substance, 0, 6, true), count: bounded(item.count, 0, 250000, true), seed: bounded(item.seed, 0, 4294967295, true),
            temperature: bounded(item.temperature, 0, 10000), density: bounded(item.density, .001, 2000), initialSpeed: bounded(item.initialSpeed, 0, 200) };
    }).sort((a, b) => a.substance - b.substance || a.id.localeCompare(b.id));
    if (emitters.reduce((sum, item) => sum + item.count, 0) > 250000) throw new TypeError('Combined emitter population exceeds 250,000');
    const result = { version: 1, emitters };
    for (const [name, defaults] of Object.entries(PARTICLE_AUTHORING_DEFAULTS)) {
        const group = value[name];
        exactKeys(group, name === 'field' && Object.hasOwn(group ?? {}, 'response') ? [...Object.keys(defaults), 'response'] : Object.keys(defaults));
        if (typeof group.enabled !== 'boolean') throw new TypeError(`${name}.enabled must be boolean`);
        result[name] = { enabled: group.enabled };
        for (const [key, range] of Object.entries(GROUP_LIMITS[name])) result[name][key] = bounded(group[key], ...range);
        if (name === 'field' && Object.hasOwn(group, 'response')) result[name].response = normalizeParticlePointerResponse(group.response);
    }
    return result;
}
export function particleAuthoringCount(value) { return value.emitters.reduce((sum, emitter) => sum + emitter.count, 0); }

/** Independent emitter streams reproduce the old interleaved distribution at
 * defaults, yet deleting a substance cannot move another substance's samples. */
export function createAuthoredParticleInitialData(value, width, height, allocation = null) {
    const program = normalizeParticleAuthoring(value), count = particleAuthoringCount(program);
    const data = new Float32Array(Math.max(count, allocation ?? count) * 8), streams = program.emitters.map(emitter => {
        const random = mulberry32(emitter.seed);
        for (let i = 0; i < emitter.substance * 5; i++) random();
        return random;
    });
    let at = 0;
    for (let local = 0, remaining = count; remaining; local++) for (const [index, emitter] of program.emitters.entries()) {
        if (local >= emitter.count) continue;
        const random = streams[index], density = emitter.density, speed = emitter.initialSpeed * program.initialize.speedScale;
        const x = uniformDistribution(.02, .98, random), y = program.initialize.enabled
            ? uniformDistribution(density > 500 ? .06 : .32, density > 500 ? .68 : .94, random)
            : uniformDistribution(.02, .98, random);
        data[at++] = (.5 + (x - .5) * program.initialize.spreadX) * width;
        data[at++] = (.5 + (y - .5) * program.initialize.spreadY) * height;
        data[at++] = uniformDistribution(.15, 1, random); data[at++] = emitter.substance;
        data[at++] = uniformDistribution(-speed * .5, speed * .5, random); data[at++] = uniformDistribution(-speed * .5, speed * .5, random);
        // Exactly representable below 2^24 at the 250k population limit. The
        // local identity survives a different emitter being removed or reordered.
        data[at++] = emitter.temperature; data[at++] = local * 64 + index;
        // Five values per legacy particle, seven interleaved substances.
        for (let i = 0; i < 30; i++) random();
        remaining--;
    }
    return data;
}

export function isDefaultParticleAuthoring(value, count = 20000) {
    if (!value || value.emitters.length !== 7) return false;
    if (Object.entries(PARTICLE_AUTHORING_DEFAULTS).some(([key, defaults]) => JSON.stringify(value[key]) !== JSON.stringify(defaults))) return false;
    return value.emitters.every((emitter, i) => { const original = LIVE_3D_WORLD_SUBSTANCES[i]; return emitter.substance === i && emitter.seed === 7314 && emitter.count === Math.floor(count / 7) + (i < count % 7 ? 1 : 0) && emitter.temperature === original.baseTemperature && emitter.density === original.density && emitter.initialSpeed === original.initialSpeed; });
}
function bounded(value, min, max, integer = false) { if (!Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) throw new RangeError(`Authoring value must be ${integer ? 'an integer ' : ''}in [${min}, ${max}]`); return value; }
function exactKeys(value, keys) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new TypeError('Unknown or missing Live 3D authoring field'); }
