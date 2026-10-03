// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * EntityManager.js - Higher-level entity management utilities
 * 
 * Handles entity lifecycle including cleanup of associated resources.
 */

import { destroyEntity } from "./world/World.js";
import { removeEntityFromStorage } from "./storage/ArchetypeStorage.js";
import { destroyBuffer } from "../core/gpu/GpuBuffer.js";
import { clearGrabForEntity } from "../tools/interaction/GrabController.js";

/**
 * Delete an entity with full cleanup of associated resources.
 * @param {Object} options - Deletion options
 * @param {Object} options.ecsWorld - ECS world
 * @param {number} options.entityId - Entity ID to delete
 * @param {Array} options.spawnedEntities - Array of spawned entity entries
 * @param {Map} options.uniformBuffers - Map of entity uniform buffers
 * @param {Map} options.bindGroups - Map of entity bind groups
 * @param {Object} options.grabState - Grab state object (optional)
 * @param {Object} options.ecsState - ECS state object with selectedEntityId and inspectorApi (optional)
 * @param {Function} options.logger - Logger function (optional)
 * @returns {boolean} Whether deletion succeeded
 */
export function deleteEntity(options) {
  const {
    ecsWorld,
    entityId,
    spawnedEntities,
    uniformBuffers,
    bindGroups,
    grabState,
    ecsState,
    logger,
  } = options;

  if (!ecsWorld || entityId == null) {
    return false;
  }

  // Find and remove from spawned entities array
  let entry = null;
  if (Array.isArray(spawnedEntities)) {
    const index = spawnedEntities.findIndex((e) => e.entityId === entityId);
    if (index !== -1) {
      entry = spawnedEntities[index];

      // Clean up GPU resources
      if (uniformBuffers) {
        const uniformBuffer = uniformBuffers.get(entityId);
        if (uniformBuffer) {
          destroyBuffer(uniformBuffer);
          uniformBuffers.delete(entityId);
        }
      }
      if (bindGroups) {
        bindGroups.delete(entityId);
      }

      spawnedEntities.splice(index, 1);
    }
  }

  // Clear grab state if this entity was being grabbed
  if (grabState) {
    clearGrabForEntity(grabState, entityId);
  }

  // Remove from ECS
  removeEntityFromStorage(ecsWorld, entityId);
  destroyEntity(ecsWorld, entityId);

  // Clear selection if this was the selected entity
  if (ecsState && ecsState.selectedEntityId === entityId) {
    ecsState.selectedEntityId = null;
    if (ecsState.inspectorApi?.setSelectedEntity) {
      ecsState.inspectorApi.setSelectedEntity(null);
    }
  }

  if (logger) {
    logger.info("[DELETE] Removed entity", {
      entityId,
      type: entry?.type || "entity",
    });
  }

  return true;
}

/**
 * Delete the currently selected entity.
 * @param {Object} ecsState - ECS state with world and selectedEntityId
 * @param {Object} options - Additional options (same as deleteEntity)
 * @returns {boolean} Whether deletion succeeded
 */
export function deleteSelectedEntity(ecsState, options) {
  if (!ecsState?.world || ecsState.selectedEntityId == null) {
    return false;
  }
  return deleteEntity({
    ...options,
    ecsWorld: ecsState.world,
    entityId: ecsState.selectedEntityId,
    ecsState,
  });
}
