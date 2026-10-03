// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AudioEngine.js - Core Audio Engine
 * 
 * Central audio system for the engine. Manages AudioContext lifecycle,
 * master gain, tick loop, and coordinates all audio subsystems.
 * 
 * Usage:
 *   const engine = createAudioEngine({ maxVoices: 64 });
 *   await initAudioEngine(engine);
 *   // In main loop:
 *   tickAudioEngine(engine, dt);
 *   // Cleanup:
 *   destroyAudioEngine(engine);
 */

import { createAudioBus, setBusVolume, destroyAudioBus } from './AudioBus.js';
import { createAudioListener, updateAudioListener, destroyAudioListener } from './AudioListener.js';
import { createAudioAssetManager, destroyAudioAssetManager } from './AudioAssetManager.js';
import { createAudioConcurrency, tickConcurrency, destroyAudioConcurrency } from './AudioConcurrency.js';
import { createAudioSource, stopAudioSource, tickAudioSource, destroyAudioSource, isSourceDone } from './AudioSource.js';
import { resolveAudioEvent } from './AudioEvent.js';

// ============================================================================
// CREATION
// ============================================================================

/**
 * Create an audio engine instance.
 * @param {Object} config
 * @param {number} config.masterVolume - Master volume 0-1 (default 1.0)
 * @param {number} config.sfxVolume - SFX bus volume (default 1.0)
 * @param {number} config.musicVolume - Music bus volume (default 0.7)
 * @param {number} config.ambientVolume - Ambient bus volume (default 0.8)
 * @param {number} config.voiceVolume - Voice bus volume (default 1.0)
 * @param {number} config.uiVolume - UI bus volume (default 0.8)
 * @param {number} config.maxVoices - Max concurrent voices (default 64)
 * @param {boolean} config.spatialAudio - Enable 3D audio (default true)
 * @param {string} config.quality - Audio quality: 'low'|'medium'|'high' (default 'high')
 * @param {AudioContext} config.externalContext - Use this shared context instead of creating one
 *        (e.g. the WebGPU-OS AudioDriver context, so engine audio routes through the OS mixer).
 * @param {AudioNode} config.externalDestination - Connect masterGain here instead of context.destination
 *        (e.g. an OS per-app session input node). Requires externalContext.
 * @returns {Object} Audio engine instance
 */
export function createAudioEngine(config = {}) {
  return {
    // Web Audio API
    context: null,
    masterGain: null,

    // Subsystems
    listener: null,
    buses: null,       // { master, sfx, music, ambient, voice, ui }
    assets: null,      // AudioAssetManager
    concurrency: null, // AudioConcurrency

    // Active sources
    activeSources: new Map(), // id → AudioSource
    _nextSourceId: 1,

    // Audio events registry
    events: new Map(), // eventId → AudioEvent descriptor

    // Configuration
    config: {
      masterVolume: config.masterVolume ?? 1.0,
      sfxVolume: config.sfxVolume ?? 1.0,
      musicVolume: config.musicVolume ?? 0.7,
      ambientVolume: config.ambientVolume ?? 0.8,
      voiceVolume: config.voiceVolume ?? 1.0,
      uiVolume: config.uiVolume ?? 0.8,
      maxVoices: config.maxVoices ?? 64,
      spatialAudio: config.spatialAudio ?? true,
      quality: config.quality ?? 'high',
      externalContext: config.externalContext ?? null,
      externalDestination: config.externalDestination ?? null,
    },

    // True when the context is borrowed (external) and must NOT be closed on destroy.
    _ownsContext: true,

    // State
    initialized: false,
    suspended: false,
    time: 0,
  };
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize the audio engine. Creates AudioContext and all subsystems.
 * Must be called after a user gesture (click/tap) to comply with autoplay policy.
 * @param {Object} engine - Audio engine instance
 * @returns {Promise<boolean>} true if initialized successfully
 */
export async function initAudioEngine(engine) {
  if (engine.initialized) return true;

  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      console.warn('[AudioEngine] Web Audio API not available');
      return false;
    }

    const sampleRateMap = { low: 22050, medium: 44100, high: 48000 };
    const sampleRate = sampleRateMap[engine.config.quality] || 48000;

    // Borrow an externally-provided context (e.g. the OS AudioDriver) when given,
    // so this engine's output is mixed/controlled by the host. Otherwise own one.
    if (engine.config.externalContext) {
      engine.context = engine.config.externalContext;
      engine._ownsContext = false;
    } else {
      engine.context = new AC({ sampleRate });
      engine._ownsContext = true;
    }

    // Resume if suspended (autoplay policy)
    if (engine.context.state === 'suspended') {
      await engine.context.resume();
    }

    // Master gain → external destination (OS session input) or the context's own output.
    engine.masterGain = engine.context.createGain();
    engine.masterGain.gain.value = engine.config.masterVolume;
    engine.masterGain.connect(engine.config.externalDestination || engine.context.destination);

    // Create buses
    engine.buses = {
      sfx: createAudioBus(engine.context, engine.masterGain, { volume: engine.config.sfxVolume }),
      music: createAudioBus(engine.context, engine.masterGain, { volume: engine.config.musicVolume }),
      ambient: createAudioBus(engine.context, engine.masterGain, { volume: engine.config.ambientVolume }),
      voice: createAudioBus(engine.context, engine.masterGain, { volume: engine.config.voiceVolume }),
      ui: createAudioBus(engine.context, engine.masterGain, { volume: engine.config.uiVolume }),
    };

    // Listener
    engine.listener = createAudioListener(engine.context);

    // Asset manager
    engine.assets = createAudioAssetManager(engine.context);

    // Concurrency manager
    engine.concurrency = createAudioConcurrency({
      maxVoices: engine.config.maxVoices,
    });

    engine.initialized = true;
    console.log(`[AudioEngine] Initialized (sampleRate=${sampleRate}, maxVoices=${engine.config.maxVoices})`);
    return true;
  } catch (err) {
    console.error('[AudioEngine] Init failed:', err);
    return false;
  }
}

/**
 * Ensure the AudioContext is resumed (call after user gesture).
 * @param {Object} engine
 */
export async function resumeAudioEngine(engine) {
  if (!engine.context) return;
  if (engine.context.state === 'suspended') {
    await engine.context.resume();
    engine.suspended = false;
  }
}

// ============================================================================
// TICK (call every frame)
// ============================================================================

/**
 * Tick the audio engine. Updates active sources, cleans up finished ones.
 * @param {Object} engine
 * @param {number} dt - Delta time in seconds
 */
export function tickAudioEngine(engine, dt) {
  if (!engine.initialized) return;

  engine.time += dt;

  // Tick active sources — remove finished ones
  const toRemove = [];
  for (const [id, source] of engine.activeSources) {
    tickAudioSource(source, dt);
    if (isSourceDone(source)) {
      destroyAudioSource(source);
      toRemove.push(id);
    }
  }
  for (const id of toRemove) {
    engine.activeSources.delete(id);
  }

  // Tick concurrency
  tickConcurrency(engine.concurrency, engine.activeSources, engine.time);
}

// ============================================================================
// PLAYBACK API
// ============================================================================

/**
 * Trigger an audio event by ID.
 * @param {Object} engine
 * @param {string} eventId - Registered event ID or direct sound asset path
 * @param {Object} options
 * @param {number[]} options.position - [x, y, z] world position
 * @param {number[]} options.velocity - [x, y, z] source velocity
 * @param {number} options.volume - Volume override (0-1)
 * @param {number} options.pitch - Pitch multiplier (default 1.0)
 * @param {string} options.bus - Bus name: 'sfx'|'music'|'ambient'|'voice'|'ui'
 * @param {number} options.priority - Priority for voice stealing (higher = keep)
 * @param {boolean} options.loop - Loop the sound
 * @returns {number|null} Source ID, or null if couldn't play
 */
export function triggerAudioEvent(engine, eventId, options = {}) {
  if (!engine.initialized) return null;

  // Resolve event to concrete play parameters
  const event = engine.events.get(eventId);
  const resolved = resolveAudioEvent(event, eventId, options, engine.time);
  if (!resolved) return null;

  // Get target bus
  const busName = resolved.bus || options.bus || 'sfx';
  const bus = engine.buses[busName];
  if (!bus) return null;

  // Get audio buffer
  const buffer = engine.assets ? engine.assets.cache.get(resolved.sound) : null;
  if (!buffer) {
    // Try to load and play async
    _loadAndPlay(engine, resolved, bus, options);
    return null;
  }

  return _playBuffer(engine, buffer, resolved, bus, options);
}

/**
 * Backward-compatible alias used by older bridge code.
 * @param {Object} engine
 * @param {string} eventId
 * @param {Object} options
 * @returns {number|null}
 */
export function playSound(engine, eventId, options = {}) {
  return triggerAudioEvent(engine, eventId, options);
}

/**
 * Play a buffer directly (bypasses event resolution).
 * @param {Object} engine
 * @param {AudioBuffer} buffer
 * @param {Object} options - Same as triggerAudioEvent options
 * @returns {number|null}
 */
export function playBuffer(engine, buffer, options = {}) {
  if (!engine.initialized || !buffer) return null;
  const busName = options.bus || 'sfx';
  const bus = engine.buses[busName];
  if (!bus) return null;

  const resolved = {
    sound: '__direct__',
    volume: options.volume ?? 1.0,
    pitch: options.pitch ?? 1.0,
    loop: options.loop ?? false,
    priority: options.priority ?? 0,
    bus: busName,
  };

  return _playBuffer(engine, buffer, resolved, bus, options);
}

/**
 * Stop a specific source by ID.
 * @param {Object} engine
 * @param {number} sourceId
 * @param {number} fadeOut - Fade out time in seconds (default 0.05)
 */
export function stopSource(engine, sourceId, fadeOut = 0.05) {
  const source = engine.activeSources.get(sourceId);
  if (source) {
    stopAudioSource(source, fadeOut);
  }
}

/**
 * Stop all active sources.
 * @param {Object} engine
 * @param {number} fadeOut
 */
export function stopAllSources(engine, fadeOut = 0.1) {
  for (const source of engine.activeSources.values()) {
    stopAudioSource(source, fadeOut);
  }
}

// ============================================================================
// EVENT REGISTRATION
// ============================================================================

/**
 * Register an audio event descriptor.
 * @param {Object} engine
 * @param {string} eventId
 * @param {Object} descriptor - See AudioEvent.js for format
 */
export function registerAudioEvent(engine, eventId, descriptor) {
  if (!engine) return;
  engine.events.set(eventId, descriptor);
}

/**
 * Unregister an audio event.
 * @param {Object} engine
 * @param {string} eventId
 */
export function unregisterAudioEvent(engine, eventId) {
  if (!engine) return;
  engine.events.delete(eventId);
}

// ============================================================================
// VOLUME CONTROLS
// ============================================================================

/**
 * Set master volume.
 * @param {Object} engine
 * @param {number} volume - 0 to 1
 */
export function setMasterVolume(engine, volume) {
  if (!engine.initialized) return;
  engine.config.masterVolume = Math.max(0, Math.min(1, volume));
  engine.masterGain.gain.setTargetAtTime(engine.config.masterVolume, engine.context.currentTime, 0.02);
}

/**
 * Set volume for a specific bus.
 * @param {Object} engine
 * @param {string} busName - 'sfx'|'music'|'ambient'|'voice'|'ui'
 * @param {number} volume - 0 to 1
 */
export function setBusVolumeByName(engine, busName, volume) {
  if (!engine.initialized) return;
  const bus = engine.buses[busName];
  if (!bus) return;
  engine.config[busName + 'Volume'] = Math.max(0, Math.min(1, volume));
  setBusVolume(bus, volume, engine.context.currentTime);
}

// ============================================================================
// DESTROY
// ============================================================================

/**
 * Destroy the audio engine and release all resources.
 * @param {Object} engine
 */
export function destroyAudioEngine(engine) {
  if (!engine) return;

  // Stop all sources
  for (const source of engine.activeSources.values()) {
    destroyAudioSource(source);
  }
  engine.activeSources.clear();

  // Destroy subsystems
  if (engine.buses) {
    for (const bus of Object.values(engine.buses)) {
      destroyAudioBus(bus);
    }
    engine.buses = null;
  }

  destroyAudioListener(engine.listener);
  engine.listener = null;

  destroyAudioAssetManager(engine.assets);
  engine.assets = null;

  destroyAudioConcurrency(engine.concurrency);
  engine.concurrency = null;

  // Close the context only if we own it; borrowed/external contexts are the host's.
  if (engine._ownsContext && engine.context && engine.context.state !== 'closed') {
    engine.context.close().catch(() => {});
  } else if (engine.masterGain) {
    try { engine.masterGain.disconnect(); } catch (_) {}
  }
  engine.context = null;
  engine.masterGain = null;
  engine.events.clear();
  engine.initialized = false;
}

// ============================================================================
// INTERNAL
// ============================================================================

function _playBuffer(engine, buffer, resolved, bus, options) {
  const id = engine._nextSourceId++;

  const source = createAudioSource(engine.context, {
    id,
    buffer,
    bus,
    position: options.position || null,
    velocity: options.velocity || null,
    volume: resolved.volume,
    pitch: resolved.pitch,
    loop: resolved.loop,
    priority: resolved.priority,
    spatialAudio: engine.config.spatialAudio && !!options.position,
    refDistance: options.refDistance || 1,
    maxDistance: options.maxDistance || 100,
    rolloff: options.rolloff || 1,
    time: engine.time,
  });

  if (!source) return null;

  engine.activeSources.set(id, source);
  return id;
}

async function _loadAndPlay(engine, resolved, bus, options) {
  if (!engine.assets) return;
  try {
    const buffer = await engine.assets.load(resolved.sound);
    if (buffer && engine.initialized) {
      _playBuffer(engine, buffer, resolved, bus, options);
    }
  } catch (err) {
    // Silent fail — asset not found
  }
}
