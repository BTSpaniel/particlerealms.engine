// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SceneSerializer.js - Save and load scene state
 * 
 * Handles serialization/deserialization of spawned entities.
 */

import { getEntityComponent } from "../../ecs/storage/ArchetypeStorage.js";

/**
 * Serialize spawned entities to JSON-compatible object.
 * @param {Object} options - Serialization options
 * @param {Array} options.entities - Spawned entities array
 * @param {Object} options.ecsWorld - ECS world
 * @param {Object} options.physicsState - Physics state { enabled, baseGravity, gravityScale, staticFriction, dynamicFriction, restitution }
 * @param {Object} options.renderState - Render state { shaderMode, enableDiffuse, enableBounce, enableEmissive, enableSun, lightBrightness }
 * @returns {Object} Serialized scene data
 */
export function serializeScene(options) {
  const { entities, ecsWorld, physicsState, renderState } = options;
  
  const serializedEntities = [];
  
  for (const entry of entities) {
    const transform = getEntityComponent(ecsWorld, entry.entityId, "Transform");
    const physicsBody = getEntityComponent(ecsWorld, entry.entityId, "PhysicsBody");
    
    serializedEntities.push({
      type: entry.type,
      color: entry.color ? [...entry.color] : null,
      position: transform?.position ? [...transform.position] : [0, 0, 0],
      rotation: transform?.rotation ? [...transform.rotation] : [0, 0, 0, 1],
      scale: transform?.scale ? [...transform.scale] : [1, 1, 1],
      simMode: physicsBody?.simMode || "dynamic",
    });
  }
  
  // Serialize physics defaults
  const physics = {};
  if (physicsState) {
    if (typeof physicsState.enabled === "boolean") physics.enabled = physicsState.enabled;
    if (Array.isArray(physicsState.baseGravity) && physicsState.baseGravity.length >= 3) {
      physics.baseGravity = [...physicsState.baseGravity];
    }
    if (typeof physicsState.gravityScale === "number") physics.gravityScale = physicsState.gravityScale;
    if (typeof physicsState.staticFriction === "number") physics.staticFriction = physicsState.staticFriction;
    if (typeof physicsState.dynamicFriction === "number") physics.dynamicFriction = physicsState.dynamicFriction;
    if (typeof physicsState.restitution === "number") physics.restitution = physicsState.restitution;
  }
  
  // Serialize render defaults
  const render = {};
  if (renderState) {
    if (typeof renderState.shaderMode === "string") render.shaderMode = renderState.shaderMode;
    if (typeof renderState.enableDiffuse === "boolean") render.enableDiffuse = renderState.enableDiffuse;
    if (typeof renderState.enableBounce === "boolean") render.enableBounce = renderState.enableBounce;
    if (typeof renderState.enableEmissive === "boolean") render.enableEmissive = renderState.enableEmissive;
    if (typeof renderState.enableSun === "boolean") render.enableSun = renderState.enableSun;
    if (typeof renderState.lightBrightness === "number") render.lightBrightness = renderState.lightBrightness;
  }
  
  return {
    version: 1,
    timestamp: Date.now(),
    entities: serializedEntities,
    physics: Object.keys(physics).length > 0 ? physics : undefined,
    render: Object.keys(render).length > 0 ? render : undefined,
  };
}

/**
 * Export scene to JSON string.
 * @param {Object} options - Serialization options
 * @returns {string} JSON string
 */
export function exportSceneToJson(options) {
  const data = serializeScene(options);
  return JSON.stringify(data, null, 2);
}

/**
 * Download scene as JSON file.
 * @param {Object} options - Serialization options
 * @param {string} filename - Download filename (default: "scene.json")
 */
export function downloadScene(options, filename = "scene.json") {
  const json = exportSceneToJson(options);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  
  URL.revokeObjectURL(url);
}

/**
 * Parse scene JSON data.
 * @param {string} json - JSON string
 * @returns {Object|null} Parsed scene data or null on error
 */
export function parseSceneJson(json) {
  try {
    const data = JSON.parse(json);
    if (data.version !== 1) {
      console.warn("[SceneSerializer] Unknown scene version:", data.version);
    }
    return data;
  } catch (err) {
    console.error("[SceneSerializer] Failed to parse scene:", err);
    return null;
  }
}

/**
 * Load scene from JSON and spawn entities.
 * @param {Object} options - Load options
 * @param {string} options.json - JSON string
 * @param {Function} options.spawnEntity - Function to spawn entity
 * @param {Function} options.clearScene - Optional function to clear existing entities
 * @param {Function} options.applyPhysicsState - Optional function to apply physics state
 * @param {Function} options.applyRenderState - Optional function to apply render state
 * @param {Function} options.logger - Optional logger
 * @returns {Object} Load result { entityCount, physics, render }
 */
export function loadSceneFromJson(options) {
  const { json, spawnEntity, clearScene, applyPhysicsState, applyRenderState, logger } = options;
  
  const data = parseSceneJson(json);
  if (!data || !Array.isArray(data.entities)) {
    if (logger) logger.error("[SCENE] Invalid scene data");
    return { entityCount: 0, physics: null, render: null };
  }
  
  // Clear existing entities if requested
  if (clearScene) {
    clearScene();
  }
  
  // Apply physics defaults from scene
  if (data.physics && applyPhysicsState) {
    applyPhysicsState(data.physics);
    if (logger) {
      logger.info("[SCENE] Applied physics defaults", data.physics);
    }
  }
  
  // Apply render defaults from scene
  if (data.render && applyRenderState) {
    applyRenderState(data.render);
    if (logger) {
      logger.info("[SCENE] Applied render defaults", data.render);
    }
  }
  
  let count = 0;
  for (const entity of data.entities) {
    spawnEntity({
      position: entity.position,
      type: entity.type,
      spawnerProps: {
        color: entity.color,
        scale: entity.scale,
        rotation: entity.rotation,
        simMode: entity.simMode,
      },
    });
    count++;
  }
  
  if (logger) {
    logger.info(`[SCENE] Loaded ${count} entities`);
  }
  
  return { entityCount: count, physics: data.physics || null, render: data.render || null };
}

/**
 * Load scene from file input.
 * @param {File} file - File object
 * @param {Object} options - Load options (spawnEntity, clearScene, logger)
 * @returns {Promise<number>} Number of entities loaded
 */
export async function loadSceneFromFile(file, options) {
  const text = await file.text();
  return loadSceneFromJson({ ...options, json: text });
}

/**
 * Create a file input for loading scenes.
 * @param {Object} options - Load options
 * @returns {HTMLInputElement} File input element
 */
export function createSceneFileInput(options) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.style.display = "none";
  
  input.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      await loadSceneFromFile(file, options);
    }
    input.value = ""; // Reset for next use
  });
  
  document.body.appendChild(input);
  return input;
}
