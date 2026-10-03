// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SubstanceAudioResolver.js - Resolve substance key → audio config
 * 
 * Maps substance IDs to audio event configurations, supporting both
 * sample-based fallback and procedural patch references.
 */

import { getSubstance } from '../../sim/particles/substances/SubstanceRegistry.js';
import { uniformDistribution } from '../../core/math/MathRandom.js';

function _clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ============================================================================
// RESOLVE
// ============================================================================

/**
 * Resolve a substance key to its audio configuration.
 * @param {string} substanceId - e.g. 'fire', 'water', 'metal'
 * @returns {Object|null} { impactSound, ambientLoop, collisionSound, volume, pitchRange, proceduralPatch?, paramMap? }
 */
export function resolveSubstanceAudio(substanceId) {
  if (!substanceId) return null;

  const sub = getSubstance(substanceId);
  if (!sub || !sub.audio) return null;

  return sub.audio;
}

/**
 * Get the impact sound event ID for a substance.
 * @param {string} substanceId
 * @returns {string|null}
 */
export function getSubstanceImpactSound(substanceId) {
  const audio = resolveSubstanceAudio(substanceId);
  return audio?.impactSound || null;
}

/**
 * Get the ambient loop event ID for a substance.
 * @param {string} substanceId
 * @returns {string|null}
 */
export function getSubstanceAmbientLoop(substanceId) {
  const audio = resolveSubstanceAudio(substanceId);
  return audio?.ambientLoop || null;
}

/**
 * Get the collision sound event ID for a substance.
 * @param {string} substanceId
 * @returns {string|null}
 */
export function getSubstanceCollisionSound(substanceId) {
  const audio = resolveSubstanceAudio(substanceId);
  return audio?.collisionSound || null;
}

/**
 * Get procedural patch ID for a substance (if defined).
 * @param {string} substanceId
 * @returns {string|null}
 */
export function getSubstanceProceduralPatch(substanceId) {
  const audio = resolveSubstanceAudio(substanceId);
  return audio?.proceduralPatch || null;
}

/**
 * Get parameter mapping for procedural synthesis.
 * Maps emitter params → synth params.
 * @param {string} substanceId
 * @returns {Object|null} e.g. { 'emitRate': { target: 'crackle.density', scale: 0.1, offset: 0 } }
 */
export function getSubstanceParamMap(substanceId) {
  const audio = resolveSubstanceAudio(substanceId);
  return audio?.paramMap || null;
}

/**
 * Get normalized default procedural params for a substance.
 * @param {string} substanceId
 * @returns {{volume:number,pitch:number,speed:number,temperature:number,quality:number}}
 */
export function getSubstanceAudioDefaults(substanceId) {
  const sub = getSubstance(substanceId);
  const audio = sub?.audio || {};
  const pitchRange = audio.pitchRange || [1.0, 1.0];
  return {
    volume: audio.volume ?? 0.5,
    pitch: (pitchRange[0] + pitchRange[1]) / 2,
    speed: 3.0,
    temperature: sub?.thermal?.defaultTemperature ?? 300,
    quality: 1.0,
  };
}

/**
 * Apply a substance paramMap to source params.
 * Supports runtime map override keys: _map_<src>_scale / _map_<src>_offset.
 * @param {string} substanceId
 * @param {Object} params
 * @param {Object|null} mapOverrides
 * @returns {Object}
 */
export function applySubstanceParamMap(substanceId, params = {}, mapOverrides = null) {
  if (!substanceId || typeof substanceId !== 'string') return { ...params };
  const map = getSubstanceParamMap(substanceId);
  if (!map) return { ...params };

  const out = { ...params };
  const overrides = mapOverrides && typeof mapOverrides === 'object' ? mapOverrides : null;

  for (const [srcKey, mapping] of Object.entries(map)) {
    const srcVal = out[srcKey];
    if (!Number.isFinite(srcVal) || !mapping) continue;
    const target = typeof mapping.target === 'string'
      ? mapping.target.split('.').pop()
      : null;
    if (!target) continue;

    const overrideScale = overrides ? overrides[`_map_${srcKey}_scale`] : undefined;
    const overrideOffset = overrides ? overrides[`_map_${srcKey}_offset`] : undefined;
    const scale = Number.isFinite(overrideScale)
      ? overrideScale
      : (Number.isFinite(mapping.scale) ? mapping.scale : 1);
    const offset = Number.isFinite(overrideOffset)
      ? overrideOffset
      : (Number.isFinite(mapping.offset) ? mapping.offset : 0);

    out[target] = srcVal * scale + offset;
  }

  return out;
}

/**
 * Build preview/runtime-friendly patch params with shared defaults + paramMap transform.
 * @param {string} substanceId
 * @param {Object} overrides
 * @param {Object} sourceParams
 * @returns {Object}
 */
export function buildSubstancePreviewParams(substanceId, overrides = {}, sourceParams = {}) {
  const defaults = getSubstanceAudioDefaults(substanceId);
  const baseSpeed = Number.isFinite(overrides.speed)
    ? overrides.speed
    : (Number.isFinite(sourceParams.speed) ? sourceParams.speed : defaults.speed);
  const baseTemperature = Number.isFinite(overrides.temperature)
    ? overrides.temperature
    : (Number.isFinite(sourceParams.temperature) ? sourceParams.temperature : defaults.temperature);
  const baseQuality = Number.isFinite(overrides.quality)
    ? overrides.quality
    : (Number.isFinite(sourceParams.quality) ? sourceParams.quality : defaults.quality);
  const base = {
    volume: Number.isFinite(overrides.volume) ? overrides.volume : defaults.volume,
    pitch: Number.isFinite(overrides.pitch) ? overrides.pitch : defaults.pitch,
    speed: baseSpeed,
    temperature: baseTemperature,
    quality: _clamp(baseQuality, 0, 1),
    emitRate: Number.isFinite(sourceParams.emitRate) ? sourceParams.emitRate : baseSpeed * 2,
    avgVelocity: Number.isFinite(sourceParams.avgVelocity) ? sourceParams.avgVelocity : baseSpeed,
    density: Number.isFinite(sourceParams.density) ? sourceParams.density : baseSpeed,
  };
  if (Number.isFinite(sourceParams.count)) base.count = sourceParams.count;

  return applySubstanceParamMap(substanceId, base, overrides);
}

/**
 * Build a complete audio trigger config from substance + event params.
 * @param {string} substanceId
 * @param {string} eventType - 'impact' | 'ambient' | 'collision'
 * @param {Object} params - { position, velocity, volume, pitch }
 * @returns {Object|null} Ready-to-trigger config for AudioEngine
 */
export function buildSubstanceTriggerConfig(substanceId, eventType, params = {}) {
  const audio = resolveSubstanceAudio(substanceId);
  if (!audio) return null;

  let soundId = null;
  switch (eventType) {
    case 'impact': soundId = audio.impactSound; break;
    case 'ambient': soundId = audio.ambientLoop; break;
    case 'collision': soundId = audio.collisionSound; break;
    default: soundId = audio.impactSound; break;
  }

  if (!soundId) return null;

  // Resolve pitch within substance's pitch range
  const pitchRange = audio.pitchRange || [1.0, 1.0];
  const pitch = (params.pitch ?? 1.0) *
    uniformDistribution(pitchRange[0], pitchRange[1], Math.random);

  return {
    eventId: soundId,
    position: params.position || null,
    velocity: params.velocity || null,
    volume: (params.volume ?? 1.0) * (audio.volume ?? 1.0),
    pitch,
    bus: eventType === 'ambient' ? 'ambient' : 'sfx',
    loop: eventType === 'ambient',
    priority: eventType === 'ambient' ? 1 : 0,
  };
}
