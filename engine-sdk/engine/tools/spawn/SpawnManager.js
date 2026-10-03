// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SpawnManager.js - Unified entity and particle spawning
 * 
 * Handles spawning physics objects with render resources,
 * and particle emitters with fluid sim integration.
 */

import { spawnPhysicsObjectAtPosition } from "./PhysicsSpawnController.js";
import { resolveSpawnAppearance, createMeshLookup } from "./SpawnTypeDefaults.js";
import { createStandardEntityRenderResources } from "../../render/scenes/StandardEntityRenderResources.js";
import { createEmitter } from "../../sim/particles/ParticleEmitterSystem.js";
import { setParticleBillboardParams } from "../../render/particles/ParticleBillboardRenderer.js";

/**
 * Spawn a physics object with full render resource setup.
 * @param {Object} options - Spawn options
 * @param {Object} options.ecsWorld - ECS world
 * @param {Array} options.position - Spawn position [x, y, z]
 * @param {string} options.type - Object type (cube, sphere, etc.)
 * @param {Object} options.spawnerProps - Optional spawner properties
 * @param {Object} options.gpu - GPU state with device
 * @param {Object} options.renderPipeline - Render pipeline
 * @param {Object} options.lightsBuffer - Lights buffer
 * @param {number} options.uniformByteLength - Uniform buffer byte length
 * @param {Object} options.meshes - Mesh lookup { cubeMesh, sphereMesh, etc. }
 * @param {Array} options.spawnedEntities - Array to add spawned entity to
 * @param {Map} options.uniformBuffers - Map to store uniform buffer
 * @param {Map} options.bindGroups - Map to store bind group
 * @param {Function} options.logger - Optional logger
 * @returns {Object|null} Spawn result or null
 */
export function spawnEntity(options) {
  const {
    ecsWorld,
    position,
    type = "cube",
    spawnerProps = null,
    gpu,
    renderPipeline,
    lightsBuffer,
    uniformByteLength,
    meshes,
    spawnedEntities,
    uniformBuffers,
    bindGroups,
    logger,
  } = options;

  if (!ecsWorld || !Array.isArray(position) || position.length < 3) {
    return null;
  }

  const spawnPos = [position[0], position[1], position[2]];
  
  const spawnResult = spawnPhysicsObjectAtPosition(
    ecsWorld,
    spawnPos,
    type,
    spawnerProps,
    logger,
  );
  
  if (!spawnResult) {
    return null;
  }

  const { entityId, scale } = spawnResult;

  // Resolve color and mesh using engine defaults
  const meshLookup = createMeshLookup(meshes);
  const { color, mesh } = resolveSpawnAppearance(type, spawnerProps, meshLookup);

  // Add to spawned entities list
  if (spawnedEntities) {
    spawnedEntities.push({ entityId, type, color, mesh });
  }

  // Create render resources
  if (gpu?.device && renderPipeline && lightsBuffer) {
    const device = gpu.device.getDevice();
    const resources = createStandardEntityRenderResources(
      device,
      renderPipeline,
      lightsBuffer,
      entityId,
      uniformByteLength,
    );
    
    if (resources) {
      if (uniformBuffers) {
        uniformBuffers.set(entityId, resources.uniformBuffer);
      }
      if (bindGroups) {
        bindGroups.set(entityId, resources.bindGroup);
      }
    }
  }

  if (logger) {
    logger.info("[SPAWN] Spawned " + type, { entityId, position, color, scale });
  }

  return { entityId, type, color, mesh, scale };
}

/**
 * Spawn a particle emitter at position.
 * @param {Object} options - Spawn options
 * @param {Array} options.position - Spawn position
 * @param {Object} options.spawnerProps - Spawner properties with color/scale
 * @param {Object} options.particles - Particle state
 * @param {Object} options.smoke - Smoke state (for fluid sim trigger)
 * @param {Function} options.onFirstEmitter - Callback for first emitter (starts fluid sim)
 * @param {number} options.maxEmitters - Max emitters before removing old ones (default: 16)
 * @param {Function} options.logger - Optional logger
 * @returns {Object|null} Created emitter or null
 */
export function spawnParticleEmitter(options) {
  const {
    position,
    spawnerProps,
    particles,
    smoke,
    onFirstEmitter,
    maxEmitters = 16,
    logger,
  } = options;

  if (!particles?.world || !particles?.renderer || !Array.isArray(position)) {
    return null;
  }

  const color = spawnerProps?.color?.length >= 3 ? spawnerProps.color : [1.0, 1.0, 1.0];
  const scale = spawnerProps?.scale?.length >= 3 ? spawnerProps.scale : [1, 1, 1];
  const size = Number.isFinite(scale[0]) && scale[0] > 0 ? scale[0] : 1.0;

  setParticleBillboardParams(particles.renderer, { size, color });

  const emitter = createEmitter({
    position: [position[0], position[1], position[2]],
    color,
    size,
    emitRate: 800,
    maxParticles: Math.min(4000, particles.maxCount || 0),
  });
  
  particles.emitters.push(emitter);

  // Trigger fluid sim on first emitter
  if (smoke && !smoke.simStartTime) {
    smoke.simStartTime = performance.now();
    if (onFirstEmitter) {
      setTimeout(onFirstEmitter, 100);
    }
  }

  // Cap emitters
  if (particles.emitters.length > maxEmitters) {
    particles.emitters.shift();
  }

  if (logger) {
    logger.info("[PARTICLES] Configured emitter", {
      position,
      size,
      emitterCount: particles.emitters.length,
    });
  }

  return emitter;
}
