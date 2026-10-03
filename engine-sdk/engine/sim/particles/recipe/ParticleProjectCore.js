// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Cycle-free shared particle settings and immutable built-in preset primitives. */

import {
  ENGINE_PARTICLE_HARD_LIMIT,
  PARTICLE_INTERACTIONS,
  PARTICLE_MATERIAL_PROFILES,
  PARTICLE_MODES,
  PARTICLE_PRESETS,
  PARTICLE_RENDER_STYLES,
  PARTICLE_REACTIONS,
} from './ParticleLabCatalog.js';

export const PARTICLE_PRESET_SCHEMA = 'particle-realms.particle-preset';
export const PARTICLE_PRESET_VERSION = 1;
export const PARTICLE_DEFAULT_MAXIMUM = 10_000_000;
export const PARTICLE_MODE_ALIASES = Object.freeze({ gather: 'attractor', burst: 'fountain', orbit: 'vortex' });

const MIN_PARTICLES = 1_000;

export const DEFAULT_PARTICLE_SETTINGS = Object.freeze({
  mode: 'galaxy',
  preset: 'solar',
  renderStyle: 'glow',
  materialProfile: 'adaptive',
  materialDetail: .55,
  interaction: 'attract',
  count: 100_000,
  force: 1,
  size: 2.8,
  exposure: 1.15,
  emission: 1,
  paused: false,
  cameraYaw: .72,
  cameraPitch: .38,
  cameraDistance: 34,
  trails: true,
  trailPersistence: .88,
  bloom: 1.25,
  autoOrbit: .18,
  brushRadius: 3.5,
  gravity: 0,
  drag: .998,
  turbulence: .35,
  cohesion: 1.1,
  temperature: 1200,
  reactionRate: 1,
  reaction: 0,
  charge: 1,
  seed: 0x50c3a17e,
});

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boundedNumber(value, fallback, min, max) {
  const number = finiteNumber(value);
  return Math.max(min, Math.min(max, number == null ? fallback : number));
}

function boundedInteger(value, fallback, min, max) {
  return Math.round(boundedNumber(value, fallback, min, max));
}

function normalizedBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

export function hashParticleString32(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function normalizeParticleSeed(value, fallback = DEFAULT_PARTICLE_SETTINGS.seed) {
  const normalizedFallback = finiteNumber(fallback);
  const number = finiteNumber(value);
  return Math.trunc(number == null ? (normalizedFallback ?? DEFAULT_PARTICLE_SETTINGS.seed) : number) >>> 0;
}

export function normalizeParticleSettings(value = {}, maximum = PARTICLE_DEFAULT_MAXIMUM) {
  const source = isRecord(value) ? value : {};
  const maximumValue = finiteNumber(maximum);
  const safeMaximum = Math.max(MIN_PARTICLES, Math.min(
    ENGINE_PARTICLE_HARD_LIMIT,
    Math.floor(maximumValue == null ? PARTICLE_DEFAULT_MAXIMUM : maximumValue),
  ));
  const requestedMode = PARTICLE_MODE_ALIASES[source.mode] || source.mode;
  const mode = PARTICLE_MODES[requestedMode] ? requestedMode : DEFAULT_PARTICLE_SETTINGS.mode;
  return {
    mode,
    preset: PARTICLE_PRESETS[source.preset] ? source.preset : DEFAULT_PARTICLE_SETTINGS.preset,
    renderStyle: PARTICLE_RENDER_STYLES[source.renderStyle] ? source.renderStyle : DEFAULT_PARTICLE_SETTINGS.renderStyle,
    materialProfile: PARTICLE_MATERIAL_PROFILES[source.materialProfile] ? source.materialProfile : DEFAULT_PARTICLE_SETTINGS.materialProfile,
    materialDetail: boundedNumber(source.materialDetail, DEFAULT_PARTICLE_SETTINGS.materialDetail, 0, 1),
    interaction: PARTICLE_INTERACTIONS[source.interaction] ? source.interaction : DEFAULT_PARTICLE_SETTINGS.interaction,
    count: boundedInteger(source.count, DEFAULT_PARTICLE_SETTINGS.count, MIN_PARTICLES, safeMaximum),
    force: boundedNumber(source.force, DEFAULT_PARTICLE_SETTINGS.force, .1, 4),
    size: boundedNumber(source.size, DEFAULT_PARTICLE_SETTINGS.size, .35, 8),
    exposure: boundedNumber(source.exposure, DEFAULT_PARTICLE_SETTINGS.exposure, .35, 3),
    emission: boundedNumber(source.emission, DEFAULT_PARTICLE_SETTINGS.emission, 0, 4),
    paused: normalizedBoolean(source.paused, DEFAULT_PARTICLE_SETTINGS.paused),
    cameraYaw: finiteNumber(source.cameraYaw) ?? DEFAULT_PARTICLE_SETTINGS.cameraYaw,
    cameraPitch: boundedNumber(source.cameraPitch, DEFAULT_PARTICLE_SETTINGS.cameraPitch, -1.35, 1.35),
    cameraDistance: boundedNumber(source.cameraDistance, DEFAULT_PARTICLE_SETTINGS.cameraDistance, 4, 120),
    trails: normalizedBoolean(source.trails, DEFAULT_PARTICLE_SETTINGS.trails),
    trailPersistence: boundedNumber(source.trailPersistence, DEFAULT_PARTICLE_SETTINGS.trailPersistence, .7, .98),
    bloom: boundedNumber(source.bloom, DEFAULT_PARTICLE_SETTINGS.bloom, 0, 2),
    autoOrbit: boundedNumber(source.autoOrbit, DEFAULT_PARTICLE_SETTINGS.autoOrbit, 0, 1),
    brushRadius: boundedNumber(source.brushRadius, DEFAULT_PARTICLE_SETTINGS.brushRadius, .5, 10),
    gravity: boundedNumber(source.gravity, DEFAULT_PARTICLE_SETTINGS.gravity, -3, 3),
    drag: boundedNumber(source.drag, DEFAULT_PARTICLE_SETTINGS.drag, .94, 1),
    turbulence: boundedNumber(source.turbulence, DEFAULT_PARTICLE_SETTINGS.turbulence, 0, 4),
    cohesion: boundedNumber(source.cohesion, DEFAULT_PARTICLE_SETTINGS.cohesion, 0, 4),
    temperature: boundedNumber(source.temperature, DEFAULT_PARTICLE_SETTINGS.temperature, 50, 15_000),
    reactionRate: boundedNumber(source.reactionRate, DEFAULT_PARTICLE_SETTINGS.reactionRate, 0, 3),
    reaction: boundedInteger(source.reaction, DEFAULT_PARTICLE_SETTINGS.reaction, 0, PARTICLE_REACTIONS.length - 1),
    charge: boundedNumber(source.charge, DEFAULT_PARTICLE_SETTINGS.charge, -3, 3),
    seed: normalizeParticleSeed(source.seed),
  };
}

function createBuiltInPreset(modeId) {
  const mode = PARTICLE_MODES[modeId];
  const settings = normalizeParticleSettings({
    ...DEFAULT_PARTICLE_SETTINGS,
    ...mode.defaults,
    mode: modeId,
    seed: hashParticleString32(mode.presetId),
  });
  return deepFreeze({
    schema: PARTICLE_PRESET_SCHEMA,
    version: PARTICLE_PRESET_VERSION,
    id: mode.presetId,
    modeId,
    name: mode.title,
    description: mode.description,
    category: mode.category,
    classification: mode.classification,
    tags: [...mode.tags],
    difficulty: mode.difficulty,
    fidelity: mode.fidelity,
    limitations: [...mode.limitations],
    model: mode.model,
    macros: mode.macros.map((macro) => ({ ...macro })),
    nativeMigration: { ...mode.nativeMigration, systems: [...mode.nativeMigration.systems] },
    settings,
    builtIn: true,
    immutable: true,
  });
}

const builtInPresetList = Object.keys(PARTICLE_MODES)
  .sort((left, right) => PARTICLE_MODES[left].id - PARTICLE_MODES[right].id)
  .map(createBuiltInPreset);

export const BUILT_IN_PARTICLE_PRESETS = deepFreeze(Object.fromEntries(
  builtInPresetList.map((preset) => [preset.id, preset]),
));

export const BUILT_IN_PARTICLE_PRESET_LIST = Object.freeze([...builtInPresetList]);

export function getBuiltInParticlePreset(presetIdOrMode) {
  const key = String(presetIdOrMode ?? '');
  if (BUILT_IN_PARTICLE_PRESETS[key]) return BUILT_IN_PARTICLE_PRESETS[key];
  const mode = PARTICLE_MODES[PARTICLE_MODE_ALIASES[key] || key];
  return mode ? BUILT_IN_PARTICLE_PRESETS[mode.presetId] : null;
}
