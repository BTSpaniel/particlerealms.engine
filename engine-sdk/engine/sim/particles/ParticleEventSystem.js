// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleEventSystem.js - GPU Particle Event System (exceeds Niagara parity)
 * 
 * Niagara events are CPU-only. This system is fully GPU-driven with zero-frame latency.
 * 
 * Architecture:
 *   1. Main sim shader appends events to eventBuffer (death, collision, kill zone)
 *   2. IndirectDispatch builds freeList of dead particle slot indices
 *   3. EventSpawn compute shader reads events + consumes free slots + writes new particles
 *   4. (Optional) CPU readback for gameplay callbacks (sound, damage, etc.)
 * 
 * Usage:
 *   const evtSys = initParticleEventSystem(world);
 *   registerEventHandler(evtSys, { event: 'death', subCount: 4, speed: 2 });
 *   // In render loop (after stepParticleSimWorld + executeIndirectScan):
 *   stepEventSystem(evtSys, world);
 *   // Optional async readback for gameplay:
 *   const events = await readbackEvents(evtSys);
 */

import {
  createEventSpawnSystem,
  initEventSpawnBindGroups,
  setEventSpawnConfig,
  executeEventSpawn,
  destroyEventSpawnSystem,
} from './ParticleEventSpawn.js';

// ============================================================================
// EVENT TYPE CONSTANTS
// ============================================================================

export const EVENT_DEATH = 1;
export const EVENT_GROUND_COLLISION = 2;
export const EVENT_ENTITY_COLLISION = 3;
export const EVENT_KILL_ZONE = 4;
export const EVENT_REACTION = 5;

// Event mask helpers
export const EVENT_MASK_DEATH = 1 << (EVENT_DEATH - 1);             // 0x1
export const EVENT_MASK_GROUND_COLLISION = 1 << (EVENT_GROUND_COLLISION - 1); // 0x2
export const EVENT_MASK_ENTITY_COLLISION = 1 << (EVENT_ENTITY_COLLISION - 1); // 0x4
export const EVENT_MASK_KILL_ZONE = 1 << (EVENT_KILL_ZONE - 1);     // 0x8
export const EVENT_MASK_REACTION = 1 << (EVENT_REACTION - 1);       // 0x10
export const EVENT_MASK_ALL = 0x1F;

// ============================================================================
// SYSTEM INITIALIZATION
// ============================================================================

/**
 * Initialize the GPU particle event system on a particle world.
 * Call after createParticleSimWorld + initAllAdvancedSystems (needs indirectSystem.freeList).
 * 
 * @param {Object} world - Particle world with eventBuffer, eventCounterBuffer, indirectSystem
 * @param {Object} options - { enabled: true }
 * @returns {Object} Event system instance
 */
export function initParticleEventSystem(world, options = {}) {
  if (!world?.device || !world?.eventBuffer || !world?.eventCounterBuffer) {
    console.warn('[EventSystem] Particle world with event buffers required');
    return null;
  }

  if (!world.indirectSystem?.freeListBuffer) {
    console.warn('[EventSystem] IndirectDispatch with freeList required (call initAllAdvancedSystems first)');
    return null;
  }

  const device = world.device;
  const spawnSystem = createEventSpawnSystem(device);
  initEventSpawnBindGroups(spawnSystem, world);

  // Default config: spawn 4 sub-particles on death, with moderate inheritance
  setEventSpawnConfig(spawnSystem, {
    subCount: 4,
    inheritVelocity: 0.3,
    speed: 2.0,
    spread: 1.0,
    lifetime: 0.5,
    size: 0.1,
    inheritTemperature: 0.5,
    color: [1, 0.5, 0],
    packedMetaW: 100000,
    eventMask: EVENT_MASK_ALL,
    maxSpawnPerFrame: 512,
  });

  // Staging buffers for optional CPU readback
  const stagingEventCounter = device.createBuffer({
    label: "EventSystem.staging.counter",
    size: 8,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  const maxEvents = world.maxGpuEvents || 1024;
  const stagingEventBuffer = device.createBuffer({
    label: "EventSystem.staging.events",
    size: maxEvents * 2 * 16,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  const system = {
    device,
    world,
    spawnSystem,
    enabled: options.enabled !== false,
    stagingEventCounter,
    stagingEventBuffer,
    maxEvents,
    _readbackPending: false,
    _lastEvents: [],
    _callbacks: new Map(), // eventType → [callback, ...]
  };

  world.eventSystem = system;
  console.log(`[EventSystem] GPU particle event system initialized (maxEvents: ${maxEvents})`);
  return system;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Register/update the sub-emitter event handler configuration.
 * @param {Object} system - Event system
 * @param {Object} config - Sub-emitter configuration:
 *   {
 *     event: 'death' | 'collision' | 'killZone' | 'all',  // Which events trigger spawning
 *     subCount: 4,          // Sub-particles per event (1-16)
 *     speed: 2.0,           // Base outward speed
 *     spread: 1.0,          // Angular spread (0=focused, 1=hemi, 2=sphere)
 *     lifetime: 0.5,        // Sub-particle lifetime (seconds)
 *     size: 0.1,            // Sub-particle size
 *     color: [1, 0.5, 0],   // Sub-particle color [r,g,b]
 *     inheritVelocity: 0.3, // Fraction of parent velocity to inherit
 *     inheritTemperature: 0.5, // Fraction of parent temperature
 *     packedMetaW: 100000,  // Packed meta value (size*1e4 + renderMode*1e3 + shape*10 + behavior)
 *     maxSpawnPerFrame: 512, // Global cap
 *   }
 */
export function registerEventHandler(system, config = {}) {
  if (!system?.spawnSystem) return;

  // Convert event name to mask
  let eventMask = EVENT_MASK_ALL;
  if (config.event === 'death') eventMask = EVENT_MASK_DEATH;
  else if (config.event === 'collision') eventMask = EVENT_MASK_GROUND_COLLISION | EVENT_MASK_ENTITY_COLLISION;
  else if (config.event === 'groundCollision') eventMask = EVENT_MASK_GROUND_COLLISION;
  else if (config.event === 'entityCollision') eventMask = EVENT_MASK_ENTITY_COLLISION;
  else if (config.event === 'killZone') eventMask = EVENT_MASK_KILL_ZONE;
  else if (config.event === 'reaction') eventMask = EVENT_MASK_REACTION;
  else if (typeof config.eventMask === 'number') eventMask = config.eventMask;

  setEventSpawnConfig(system.spawnSystem, {
    ...config,
    eventMask,
  });
}

/**
 * Register a CPU callback for a specific event type (called after readback)
 * @param {Object} system
 * @param {number} eventType - EVENT_DEATH, EVENT_GROUND_COLLISION, etc.
 * @param {Function} callback - (event) => void, where event = { position, velocity, temperature, type }
 */
export function onParticleEvent(system, eventType, callback) {
  if (!system?._callbacks) return;
  if (!system._callbacks.has(eventType)) {
    system._callbacks.set(eventType, []);
  }
  system._callbacks.get(eventType).push(callback);
}

/**
 * Remove all callbacks for an event type
 */
export function offParticleEvent(system, eventType) {
  if (!system?._callbacks) return;
  system._callbacks.delete(eventType);
}

// ============================================================================
// STEP (PER-FRAME)
// ============================================================================

/**
 * Step the event system: execute GPU event spawn.
 * Call AFTER stepParticleSimWorld + executeIndirectScan.
 * 
 * @param {Object} system - Event system
 */
export function stepEventSystem(system) {
  if (!system?.enabled || !system?.spawnSystem || !system?.world) return;

  const device = system.device;
  const encoder = device.createCommandEncoder({ label: "EventSystem.step.encoder" });
  executeEventSpawn(encoder, system.spawnSystem, system.world);
  device.queue.submit([encoder.finish()]);
}

// ============================================================================
// CPU READBACK (OPTIONAL, FOR GAMEPLAY)
// ============================================================================

/**
 * Async readback of particle events from GPU for gameplay callbacks.
 * Returns array of events. Tolerates 1-2 frame latency.
 * @param {Object} system
 * @returns {Promise<Array>} Array of { position: [x,y,z], velocity: [x,y,z], temperature, type }
 */
export async function readbackEvents(system) {
  if (!system || system._readbackPending) return system._lastEvents;
  if (!system.world?.eventCounterBuffer || !system.world?.eventBuffer) return [];

  system._readbackPending = true;

  try {
    const device = system.device;

    // Copy event counter + event buffer to staging
    const encoder = device.createCommandEncoder({ label: "EventSystem.readback.encoder" });
    encoder.copyBufferToBuffer(system.world.eventCounterBuffer, 0, system.stagingEventCounter, 0, 8);
    encoder.copyBufferToBuffer(
      system.world.eventBuffer, 0,
      system.stagingEventBuffer, 0,
      system.maxEvents * 2 * 16,
    );
    device.queue.submit([encoder.finish()]);

    // Map staging buffers
    await Promise.all([
      system.stagingEventCounter.mapAsync(GPUMapMode.READ),
      system.stagingEventBuffer.mapAsync(GPUMapMode.READ),
    ]);

    const counterData = new Uint32Array(system.stagingEventCounter.getMappedRange());
    const eventCount = Math.min(counterData[0], system.maxEvents);

    const eventData = new Float32Array(system.stagingEventBuffer.getMappedRange());
    const events = [];

    for (let i = 0; i < eventCount; i++) {
      const base = i * 8; // 2 vec4 per event = 8 floats
      const evt = {
        position: [eventData[base], eventData[base + 1], eventData[base + 2]],
        type: eventData[base + 3],
        velocity: [eventData[base + 4], eventData[base + 5], eventData[base + 6]],
        temperature: eventData[base + 7],
      };
      events.push(evt);
    }

    system.stagingEventCounter.unmap();
    system.stagingEventBuffer.unmap();
    system._lastEvents = events;

    // Fire CPU callbacks
    if (system._callbacks.size > 0) {
      for (const evt of events) {
        const callbacks = system._callbacks.get(evt.type);
        if (callbacks) {
          for (const cb of callbacks) {
            try { cb(evt); } catch (e) { /* silently ignore callback errors */ }
          }
        }
      }
    }
  } catch (e) {
    // Readback failed — keep last known events
  }

  system._readbackPending = false;
  return system._lastEvents;
}

/**
 * Get the last readback events (non-async, returns cached result)
 */
export function getLastEvents(system) {
  return system?._lastEvents || [];
}

// ============================================================================
// ENABLE / DISABLE
// ============================================================================

export function enableEventSystem(system) {
  if (system) system.enabled = true;
}

export function disableEventSystem(system) {
  if (system) system.enabled = false;
}

// ============================================================================
// DESTROY
// ============================================================================

export function destroyParticleEventSystem(system) {
  if (!system) return;
  destroyEventSpawnSystem(system.spawnSystem);
  if (system.stagingEventCounter) system.stagingEventCounter.destroy();
  if (system.stagingEventBuffer) system.stagingEventBuffer.destroy();
  system._callbacks.clear();
  system._lastEvents = [];
  if (system.world) system.world.eventSystem = null;
  system.world = null;
  system.device = null;
}
