// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * InspectorConfigFactory.js - Factory for creating inspector configurations
 * 
 * Simplifies the creation of inspector config objects by providing
 * standard getters/setters for common state.
 */

import { createLight } from "../../ecs/components/Light.js";
import { setEntityComponent, getEntityComponent } from "../../ecs/storage/ArchetypeStorage.js";

/**
 * Create a standard inspector configuration.
 * @param {Object} options - Configuration options
 * @param {Object} options.ecs - ECS state { world, lightEntity, selectedEntityId, inspectorApi }
 * @param {Object} options.spawn - Spawn state { pendingPosition, basePosition, ghostOffset, pendingType }
 * @param {Object} options.render - Render state { shaderMode, enableDiffuse, enableBounce, etc. }
 * @param {Object} options.physics - Physics state { enabled, gravityScale, staticFriction, etc. }
 * @param {Object} options.particles - Particle state { instanceCount, emitters }
 * @param {Array} options.spawnedEntities - Array of spawned entity objects
 * @param {Function} options.spawnObjectAtPosition - Spawn function
 * @param {Function} options.spawnParticlesAtPosition - Particle spawn function
 * @param {Function} options.deleteEntityById - Delete function
 * @param {Object} options.uiElements - Optional UI elements { brightnessSlider, brightnessValue }
 * @param {Function} options.logger - Optional logger
 * @returns {Object} Inspector configuration
 */
export function createInspectorConfig(options) {
  const {
    ecs,
    spawn,
    render,
    physics,
    particles,
    smoke,
    config,
    spawnedEntities,
    spawnObjectAtPosition,
    spawnParticlesAtPosition,
    deleteEntityById,
    uiElements = {},
    logger,
  } = options;

  const { brightnessSlider, brightnessValue } = uiElements;

  return {
    getWorld: () => ecs.world,
    
    onSelectionChanged: (entityId) => {
      ecs.selectedEntityId = entityId || null;
    },
    
    onRemoveEntity: (world, entityId) => {
      if (!world || world !== ecs.world) return;
      deleteEntityById(entityId);
    },
    
    logger,
    
    // Spawn state
    getSpawnState: () => ({
      pendingSpawnPosition: spawn.pendingPosition,
      baseSpawnPosition: spawn.basePosition,
      ghostOffset: spawn.ghostOffset,
      pendingSpawnType: spawn.pendingType,
      previewScale: Array.isArray(spawn.previewScale) ? [...spawn.previewScale] : [1, 1, 1],
      previewColor: Array.isArray(spawn.previewColor) ? [...spawn.previewColor] : [0.5, 0.5, 0.5],
    }),
    
    spawnObjectAtPosition,
    spawnParticlesAtPosition,

    setPendingSpawnType: (modeId) => {
      spawn.pendingType = modeId;
    },

    setSpawnPreviewProps: (props) => {
      if (props?.scale && Array.isArray(props.scale) && props.scale.length >= 3) {
        spawn.previewScale = [
          Number(props.scale[0]) || 1,
          Number(props.scale[1]) || 1,
          Number(props.scale[2]) || 1,
        ];
      }
      if (props?.color && Array.isArray(props.color) && props.color.length >= 3) {
        spawn.previewColor = [
          Number(props.color[0]) || 0.5,
          Number(props.color[1]) || 0.5,
          Number(props.color[2]) || 0.5,
        ];
      }
    },
    
    // Shader state
    getShaderState: () => ({
      shaderMode: render.shaderMode,
      enableDiffuse: render.enableDiffuse,
      enableBounce: render.enableBounce,
      enableEmissive: render.enableEmissive,
      enableSun: render.enableSun,
      enableVolumeSmoke: render.enableVolumeSmoke !== false,
      enableWaterPass: render.enableWaterPass !== false,
      showFluidBounds: !!render.showFluidBounds,
    }),
    
    setShaderState: (patch) => {
      if (patch.shaderMode !== undefined) {
        render.shaderMode = patch.shaderMode;
        if (logger) logger.info(`[SHADER] Switched to ${render.shaderMode} mode`);
      }
      if (patch.enableDiffuse !== undefined) render.enableDiffuse = patch.enableDiffuse;
      if (patch.enableBounce !== undefined) render.enableBounce = patch.enableBounce;
      if (patch.enableEmissive !== undefined) render.enableEmissive = patch.enableEmissive;
      if (patch.enableSun !== undefined) render.enableSun = patch.enableSun;
      if (patch.enableVolumeSmoke !== undefined) render.enableVolumeSmoke = !!patch.enableVolumeSmoke;
      if (patch.enableWaterPass !== undefined) render.enableWaterPass = !!patch.enableWaterPass;
      if (patch.showFluidBounds !== undefined) render.showFluidBounds = !!patch.showFluidBounds;
    },
    
    // Light state
    getLightState: () => {
      let intensity = render.lightBrightness;
      if (ecs.world && ecs.lightEntity !== null) {
        const light = getEntityComponent(ecs.world, ecs.lightEntity, "Light");
        if (light?.intensity != null) intensity = light.intensity;
      }
      return { intensity };
    },
    
    setLightState: (patch) => {
      if (patch?.intensity == null || !Number.isFinite(patch.intensity)) return;
      
      const v = Math.max(0, Math.min(20, patch.intensity));
      render.lightBrightness = v;
      
      // Update UI if present
      if (brightnessSlider && brightnessValue) {
        brightnessSlider.value = String(v);
        brightnessValue.textContent = v.toFixed(1);
      }
      
      // Update ECS light component
      if (ecs.world && ecs.lightEntity !== null) {
        const comp = createLight({ intensity: v });
        setEntityComponent(ecs.world, ecs.lightEntity, "Light", comp);
      }
    },
    
    // Physics state
    getPhysicsState: () => ({
      enabled: physics.enabled,
      gravityScale: physics.gravityScale,
      staticFriction: physics.staticFriction,
      dynamicFriction: physics.dynamicFriction,
      restitution: physics.restitution,
    }),
    
    setPhysicsState: (patch) => {
      if (!patch) return;
      if (Object.prototype.hasOwnProperty.call(patch, "enabled")) {
        physics.enabled = !!patch.enabled;
      }
      if (typeof patch.gravityScale === "number" && Number.isFinite(patch.gravityScale)) {
        physics.gravityScale = Math.max(-1, Math.min(1, patch.gravityScale));
      }
      if (typeof patch.staticFriction === "number" && Number.isFinite(patch.staticFriction)) {
        physics.staticFriction = patch.staticFriction;
      }
      if (typeof patch.dynamicFriction === "number" && Number.isFinite(patch.dynamicFriction)) {
        physics.dynamicFriction = patch.dynamicFriction;
      }
      if (typeof patch.restitution === "number" && Number.isFinite(patch.restitution)) {
        physics.restitution = patch.restitution;
      }
    },
    
    // Stats for performance monitoring (FPS, particle count, entity count, emitter count, fluid stats)
    // simFps is the actual measured simulation update rate (may lag behind target during heavy load)
    getStats: () => ({
      fps: render?.fps || 0,
      simTimeScale: config?.simTimeScale ?? 1.0,
      simFps: render?.simFps || render?.fps || 0,
      particleCount: particles?.instanceCount || 0,
      particleLive: particles?.liveCount || 0,
      particleDead: particles?.deadCount || 0,
      particleFree: particles?.freeSlots?.length || 0,
      entityCount: spawnedEntities?.length || 0,
      emitterCount: particles?.emitters?.length || 0,
      // Fluid/smoke stats
      fluidGridSize: smoke?.fluidWorld?.gridSizeX || 0,
      fluidWorldMin: smoke?.worldMin || null,
      fluidWorldMax: smoke?.worldMax || null,
      fluidSourceCount: smoke?._lastSourceCount || 0,
    }),
    
    // Get selected emitter for editing.
    // 1) If an entity is selected, prefer an emitter whose markerEntityId
    //    matches that entity.
    // 2) Otherwise, fall back to the current spawn.pendingType
    //    (e.g. "emitter_fountain") and pick an emitter of that type.
    getSelectedEmitter: () => {
      const list = particles?.emitters;
      if (!Array.isArray(list) || list.length === 0) {
        return null;
      }

      const selectedId = ecs?.selectedEntityId;
      if (selectedId != null) {
        const selectedNum = Number(selectedId);
        for (let i = list.length - 1; i >= 0; i--) {
          const e = list[i];
          if (!e || e.markerEntityId == null) continue;
          const markerNum = Number(e.markerEntityId);
          if (Number.isFinite(selectedNum) && Number.isFinite(markerNum) && markerNum === selectedNum) {
            return e;
          }
        }
      }

      const modeId = spawn?.pendingType;
      if (typeof modeId === "string" && modeId.startsWith("emitter_")) {
        const emitterType = modeId.replace("emitter_", "");
        for (let i = list.length - 1; i >= 0; i--) {
          const e = list[i];
          if (e && e.type === emitterType) {
            return e;
          }
        }
      }

      // Fallback: last emitter in the list
      return list[list.length - 1] || null;
    },
    
    // Friendly display name for an entity in the inspector list.
    // Uses spawnedEntities metadata when available.
    getEntityLabel: (entityId) => {
      const idNum = Number(entityId);
      if (!Array.isArray(spawnedEntities) || !Number.isFinite(idNum)) {
        return "Entity";
      }

      for (let i = 0; i < spawnedEntities.length; i++) {
        const entry = spawnedEntities[i];
        if (!entry || entry.entityId == null) continue;
        const eid = Number(entry.entityId);
        if (!Number.isFinite(eid)) continue;
        if (eid === idNum) {
          const t = entry.type || "";
          if (t === "emitter_marker") {
            return "Emitter";
          }
          if (typeof t === "string" && t.length > 0) {
            return t.charAt(0).toUpperCase() + t.slice(1);
          }
        }
      }

      return "Entity";
    },
    
    // Engine config getter/setter
    getConfig: () => ({
      particles: { ...config?.particles },
      roomSize: config?.roomSize,
      simTimeScale: config?.simTimeScale ?? 1.0,
    }),
    
    setConfig: (path, value) => {
      if (!config) return;
      const parts = path.split(".");
      let obj = config;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!obj[parts[i]]) obj[parts[i]] = {};
        obj = obj[parts[i]];
      }
      obj[parts[parts.length - 1]] = value;
    },
  };
}
