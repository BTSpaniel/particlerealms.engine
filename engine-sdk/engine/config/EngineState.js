// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * EngineState.js - Factory functions for creating default engine state objects
 * 
 * Provides a unified way to create all state objects needed for a simulation/game,
 * with sensible defaults that can be overridden by engine.cfg.
 */

import { createGrabState } from "../tools/interaction/GrabController.js";

/**
 * Default configuration values (can be overridden by engine.cfg)
 */
export const DEFAULT_CONFIG = {
  roomSize: 50,
  lightHeight: 20,
  cameraDistance: 75,
  cameraFar: 200,
  ballRadius: 0.5,
  maxSpawnDistance: 100,
  minSpawnDistance: 0.25,
  grabHoldMs: 750,
  cameraDebugLogging: false,
  cameraMovementAccelerationSeconds: 0,
  cameraMovementDecelerationSeconds: 0,
  cameraGamepadLookRadiansPerSecond: 2.5,
  cameraZoomWheelSensitivity: 0.001,
  cameraGamepadZoomRate: 1.5,
  cameraMinZoomDistance: 1,
  cameraMaxZoomDistance: 1000,
  cameraCollisionEnabled: true,
  cameraCollisionClearance: 0.25,
  cameraCollisionTargetOffset: 0.5,
  cameraCollisionMinDistance: 0.25,
  cameraCollisionRecoverySeconds: 0.1,
  cameraFocusPadding: 1.1,
  cameraFocusTransitionSeconds: 0.25,
  // Global simulation time scale (applied to particles/fluids, recommended for all sims)
  simTimeScale: 1.0,
  // Particle system defaults
  particles: {
    maxCount: 20000,
    workgroupSize: 256,
  },
  fluid: {
    splatIntervalMs: 200,
    warmupMs: 2000,
    boundsSmoothing: 0.2,
    minFpsForSplats: 0,
    debugLogSources: false,
    debugMaxSources: 4,
    gridSize: [128, 96, 128],
    smokeDensityScale: 0.5,
    smokeExtinction: 2.0,
    waterScale: 0.5,
    logState: false,
    qualityPreset: "medium",
  },
};

/**
 * Default physics values
 */
export const DEFAULT_PHYSICS = {
  enabled: true,
  gravity: [0, -9.81, 0],
  gravityScale: 1.0,
  staticFriction: 0.5,
  dynamicFriction: 0.5,
  restitution: 0.5,
};

/**
 * Default render settings
 */
export const DEFAULT_RENDER = {
  lightBrightness: 1.5,
  shaderMode: 'standard',
  enableDiffuse: true,
  enableBounce: true,
  enableEmissive: true,
  enableSun: true,
  // Volumetric & fluid rendering toggles
  enableVolumeSmoke: true,
  enableWaterPass: true,
  showFluidBounds: false,
  fps: 0, // Updated by main loop for stats display
};

/**
 * Create GPU state object
 */
export function createGpuState() {
  return {
    device: null,
    queue: null,
    surface: null,
    context: null,
    depthTexture: null,
    depthTextureView: null,
    // Scene color texture for screen-space effects (water refraction, etc.)
    sceneColorTexture: null,
    sceneColorView: null,
  };
}

/**
 * Create water pass state object
 * Used for screen-space fluid/water/metaball rendering
 */
export function createWaterPassState() {
  return {
    pass: null,           // FluidWaterPass instance (created by createFluidWaterPass)
    enabled: true,        // Whether water rendering is enabled
    // Water appearance parameters
    sphereScale: 1.5,     // World units per particle size unit (larger = more overlap)
    blurSize: 24,         // Blur radius in pixels (larger = smoother surface)
    depthFalloff: 20,     // Depth-based blur falloff (lower = more blending)
    refractionStrength: 0.02,
    fresnelPower: 2.0,    // Lower = more transparent, less reflective
    absorptionCoeff: 0.1, // Lower = less absorption, brighter
    specularPower: 64.0,
    waterColor: [0.3, 0.6, 0.9],  // Bright cyan-blue
    thickness: 0.5,       // Thinner = less absorption
    // Light settings (can override scene light)
    lightDir: [0.5, 1.0, 0.3],
    lightColor: [1.0, 1.0, 1.0],
    ambientColor: [0.5, 0.6, 0.7],  // Brighter ambient
  };
}

/**
 * Create scene configuration state (merge with engine.cfg overrides)
 */
export function createConfigState(overrides = {}) {
  return { ...DEFAULT_CONFIG, ...overrides };
}

/**
 * Create physics configuration state
 */
export function createPhysicsState(overrides = {}) {
  return { ...DEFAULT_PHYSICS, ...overrides };
}

/**
 * Create ECS state object
 */
export function createEcsState() {
  return {
    world: null,
    lightEntity: null,
    cameraEntity: null,
    spawnedEntities: [],
    uniformBuffers: new Map(),
    bindGroups: new Map(),
    selectedEntityId: null,
    inspectorApi: null,
  };
}

/**
 * Create spawn/ghost state object
 */
export function createSpawnState() {
  return {
    pendingPosition: [0, 1, 0],
    basePosition: [0, 1, 0],
    pendingNormal: null,
    lastPickNormal: null,
    pendingType: "cube",
    ghostOffset: [0, 0, 0],
    previewScale: [1, 1, 1],
    previewColor: [0.5, 0.5, 0.5],
  };
}

/**
 * Create particle system state object
 */
export function createParticlesState() {
  return {
    world: null,
    renderer: null,
    maxCount: 0,
    positions: null,
    velocities: null,
    pipeline: null,
    frameBuffer: null,
    frameBindGroup: null,
    dataBindGroup: null,
    instanceCount: 0,
    emitters: [],
    collidersData: null,
    // Slot tracking for dead particle reuse
    slotInfo: null,        // Float32Array: [spawnTime, lifetime] per slot (2 floats each)
    freeSlots: [],         // Array of indices that are dead and can be reused
    liveCount: 0,          // Estimated live particle count
    deadCount: 0,          // Estimated dead particle count
    totalSpawned: 0,       // Total particles ever spawned
  };
}

/**
 * Create volumetric smoke state object
 */
export function createSmokeState() {
  return {
    fluidWorld: null,
    pipeline: null,
    frameBuffer: null,
    gridBuffer: null,
    frameBindGroup: null,
    dataBindGroup: null,
    depthBindGroup: null,
    worldMin: null,
    worldMax: null,
    lastSplatTime: null,
    simStartTime: null,
    initializing: false,
  };
}

/**
 * Create render settings state
 */
export function createRenderState(overrides = {}) {
  return { ...DEFAULT_RENDER, ...overrides };
}

/**
 * Create camera state object
 */
export function createCameraState(config = {}) {
  const cameraDistance = config.cameraDistance || DEFAULT_CONFIG.cameraDistance;
  return {
    mode: 1, // 1 = first person, 2 = third person
    fp: { position: null, yaw: Math.PI, pitch: 0 },
    tp: {
      distance: cameraDistance,
      resolvedDistance: cameraDistance,
      yaw: 0,
      pitch: 0.5,
      collisionActive: false,
      collisionQueryFailed: false,
      collisionObjectId: null,
      focusTransition: null,
    },
    projection: null,
    view: null,
    lastLogTime: null,
    movementResponseAxes: [0, 0, 0],
  };
}

/**
 * Create input state object
 */
export function createInputState() {
  return {
    keys: {},
    movementAxes: [0, 0, 0],
    lookAxes: [0, 0],
    triggerValues: [0, 0],
    zoomAxis: 0,
    zoomDelta: 0,
    mouseDown: false,
    mouseX: 0,
    mouseY: 0,
    mouseDeltaX: 0,
    mouseDeltaY: 0,
    lastMouseX: 0,
    lastMouseY: 0,
    grabState: createGrabState(),
  };
}

/**
 * Create audio state object
 */
export function createAudioState() {
  return {
    engine: null,         // AudioEngine instance (created by createAudioEngine)
    initialized: false,   // Whether audio engine has been initialized
    // Bridge references (populated by bridge init)
    particleBridge: null,
    physicsBridge: null,
    spellBridge: null,
    weatherBridge: null,
    destructionBridge: null,
    fluidBridge: null,
    emitterBridge: null,
  };
}

/**
 * Create all state objects at once.
 * @param {Object} options - Configuration options
 * @param {Object} options.configOverrides - Overrides for config state
 * @param {Object} options.physicsOverrides - Overrides for physics state
 * @param {Object} options.renderOverrides - Overrides for render state
 * @returns {Object} All state objects
 */
export function createAllState(options = {}) {
  const { configOverrides = {}, physicsOverrides = {}, renderOverrides = {} } = options;
  
  const config = createConfigState(configOverrides);
  const physics = createPhysicsState(physicsOverrides);
  const render = createRenderState(renderOverrides);
  
  return {
    gpu: createGpuState(),
    config,
    physics,
    ecs: createEcsState(),
    spawn: createSpawnState(),
    particles: createParticlesState(),
    smoke: createSmokeState(),
    render,
    camera: createCameraState(config),
    input: createInputState(),
    audio: createAudioState(),
  };
}

/**
 * Apply engine.cfg values to config state.
 * Call this after loading engine.cfg.
 * @param {Object} config - Config state to update
 * @param {Object} cfg - Loaded engine.cfg values
 */
export function applyEngineConfigToState(config, cfg) {
  if (!cfg || typeof cfg !== "object") return;

  const roomSize = Number(cfg.room?.size);
  if (Number.isFinite(roomSize) && roomSize > 0) {
    config.roomSize = roomSize;
    const offset = Number(cfg.room?.lightHeightOffset);
    config.lightHeight = roomSize / 2 - (Number.isFinite(offset) ? offset : 5);
  }

  const cameraFarMult = Number(cfg.render?.cameraFarMultiplier);
  if (Number.isFinite(cameraFarMult) && cameraFarMult > 0) {
    config.cameraFar = config.roomSize * cameraFarMult;
  }

  const cameraDistMult = Number(cfg.render?.initialCameraDistanceMult);
  if (Number.isFinite(cameraDistMult) && cameraDistMult > 0) {
    config.cameraDistance = config.roomSize * cameraDistMult;
  }

  if (typeof cfg.render?.cameraDebugLogging === "boolean") {
    config.cameraDebugLogging = cfg.render.cameraDebugLogging;
  }

  const cameraAccelerationSeconds = Number(cfg.render?.cameraMovementAccelerationSeconds);
  if (Number.isFinite(cameraAccelerationSeconds) && cameraAccelerationSeconds >= 0) {
    config.cameraMovementAccelerationSeconds = cameraAccelerationSeconds;
  }

  const cameraDecelerationSeconds = Number(cfg.render?.cameraMovementDecelerationSeconds);
  if (Number.isFinite(cameraDecelerationSeconds) && cameraDecelerationSeconds >= 0) {
    config.cameraMovementDecelerationSeconds = cameraDecelerationSeconds;
  }

  const cameraGamepadLookRadiansPerSecond = Number(cfg.render?.cameraGamepadLookRadiansPerSecond);
  if (Number.isFinite(cameraGamepadLookRadiansPerSecond) && cameraGamepadLookRadiansPerSecond >= 0) {
    config.cameraGamepadLookRadiansPerSecond = cameraGamepadLookRadiansPerSecond;
  }

  const cameraZoomWheelSensitivity = Number(cfg.render?.cameraZoomWheelSensitivity);
  if (Number.isFinite(cameraZoomWheelSensitivity) && cameraZoomWheelSensitivity >= 0) {
    config.cameraZoomWheelSensitivity = cameraZoomWheelSensitivity;
  }
  const cameraGamepadZoomRate = Number(cfg.render?.cameraGamepadZoomRate);
  if (Number.isFinite(cameraGamepadZoomRate) && cameraGamepadZoomRate >= 0) {
    config.cameraGamepadZoomRate = cameraGamepadZoomRate;
  }
  const cameraMinZoomDistance = Number(cfg.render?.cameraMinZoomDistance);
  const cameraMaxZoomDistance = Number(cfg.render?.cameraMaxZoomDistance);
  if (Number.isFinite(cameraMinZoomDistance) && Number.isFinite(cameraMaxZoomDistance) &&
      cameraMinZoomDistance > 0 && cameraMaxZoomDistance >= cameraMinZoomDistance) {
    config.cameraMinZoomDistance = cameraMinZoomDistance;
    config.cameraMaxZoomDistance = cameraMaxZoomDistance;
  }
  if (typeof cfg.render?.cameraCollisionEnabled === "boolean") {
    config.cameraCollisionEnabled = cfg.render.cameraCollisionEnabled;
  }
  const cameraCollisionClearance = Number(cfg.render?.cameraCollisionClearance);
  if (Number.isFinite(cameraCollisionClearance) && cameraCollisionClearance >= 0) {
    config.cameraCollisionClearance = cameraCollisionClearance;
  }
  const cameraCollisionTargetOffset = Number(cfg.render?.cameraCollisionTargetOffset);
  if (Number.isFinite(cameraCollisionTargetOffset) && cameraCollisionTargetOffset >= 0) {
    config.cameraCollisionTargetOffset = cameraCollisionTargetOffset;
  }
  const cameraCollisionMinDistance = Number(cfg.render?.cameraCollisionMinDistance);
  if (Number.isFinite(cameraCollisionMinDistance) && cameraCollisionMinDistance > 0) {
    config.cameraCollisionMinDistance = cameraCollisionMinDistance;
  }
  const cameraCollisionRecoverySeconds = Number(cfg.render?.cameraCollisionRecoverySeconds);
  if (Number.isFinite(cameraCollisionRecoverySeconds) && cameraCollisionRecoverySeconds >= 0) {
    config.cameraCollisionRecoverySeconds = cameraCollisionRecoverySeconds;
  }
  const cameraFocusPadding = Number(cfg.render?.cameraFocusPadding);
  if (Number.isFinite(cameraFocusPadding) && cameraFocusPadding >= 1) {
    config.cameraFocusPadding = cameraFocusPadding;
  }
  const cameraFocusTransitionSeconds = Number(cfg.render?.cameraFocusTransitionSeconds);
  if (Number.isFinite(cameraFocusTransitionSeconds) && cameraFocusTransitionSeconds >= 0 && cameraFocusTransitionSeconds <= 60) {
    config.cameraFocusTransitionSeconds = cameraFocusTransitionSeconds;
  }

  // Optional render toggles (volumetric smoke, water surface, debug bounds)
  if (typeof cfg.render?.enableVolumeSmoke === "boolean") {
    config.renderEnableVolumeSmoke = cfg.render.enableVolumeSmoke;
  }
  if (typeof cfg.render?.enableWaterPass === "boolean") {
    config.renderEnableWaterPass = cfg.render.enableWaterPass;
  }
  if (typeof cfg.render?.showFluidBounds === "boolean") {
    config.renderShowFluidBounds = cfg.render.showFluidBounds;
  }

  const ballRadius = Number(cfg.spawn?.ballRadius);
  if (Number.isFinite(ballRadius) && ballRadius > 0) {
    config.ballRadius = ballRadius;
  }

  const simTimeScale = Number(cfg.sim?.timeScale);
  if (Number.isFinite(simTimeScale) && simTimeScale > 0) {
    config.simTimeScale = simTimeScale;
  }

  const minSpawn = Number(cfg.spawn?.minSpawnDistance);
  if (Number.isFinite(minSpawn) && minSpawn > 0) {
    config.minSpawnDistance = minSpawn;
  }

  const maxSpawnMult = Number(cfg.spawn?.maxSpawnDistanceMultiplier);
  if (Number.isFinite(maxSpawnMult) && maxSpawnMult > 0) {
    config.maxSpawnDistance = config.roomSize * maxSpawnMult;
  }

  const grabMs = Number(cfg.spawn?.grabHoldMs);
  if (Number.isFinite(grabMs) && grabMs > 0) {
    config.grabHoldMs = grabMs;
  }

  // Particles config
  if (cfg.particles) {
    if (!config.particles) config.particles = {};
    
    const maxCount = Number(cfg.particles.maxCount);
    if (Number.isFinite(maxCount) && maxCount > 0) {
      config.particles.maxCount = maxCount;
    }
    
    const workgroupSize = Number(cfg.particles.workgroupSize);
    if (Number.isFinite(workgroupSize) && workgroupSize > 0) {
      config.particles.workgroupSize = workgroupSize;
    }
  }

  if (cfg.fluid) {
    if (!config.fluid) config.fluid = {};
    const f = cfg.fluid;
    const splatMs = Number(f.splatIntervalMs);
    if (Number.isFinite(splatMs) && splatMs > 0) {
      config.fluid.splatIntervalMs = splatMs;
    }
    const warmMs = Number(f.warmupMs);
    if (Number.isFinite(warmMs) && warmMs >= 0) {
      config.fluid.warmupMs = warmMs;
    }
    const smooth = Number(f.boundsSmoothing);
    if (Number.isFinite(smooth) && smooth >= 0 && smooth <= 1) {
      config.fluid.boundsSmoothing = smooth;
    }
    const minFps = Number(f.minFpsForSplats);
    if (Number.isFinite(minFps) && minFps >= 0) {
      config.fluid.minFpsForSplats = minFps;
    }
    if (typeof f.debugLogSources === "boolean") {
      config.fluid.debugLogSources = f.debugLogSources;
    }
    const dbgMax = Number(f.debugMaxSources);
    if (Number.isFinite(dbgMax) && dbgMax > 0) {
      config.fluid.debugMaxSources = dbgMax;
    }
    if (Array.isArray(f.gridSize) && f.gridSize.length >= 3) {
      const gx = Number(f.gridSize[0]);
      const gy = Number(f.gridSize[1]);
      const gz = Number(f.gridSize[2]);
      if (
        Number.isFinite(gx) && gx > 0 &&
        Number.isFinite(gy) && gy > 0 &&
        Number.isFinite(gz) && gz > 0
      ) {
        config.fluid.gridSize = [gx | 0, gy | 0, gz | 0];
      }
    }
    if (typeof f.qualityPreset === "string") {
      const preset = f.qualityPreset.toLowerCase();
      let presetGrid = null;
      let presetWaterScale = null;
      if (preset === "low") {
        presetGrid = [96, 72, 96];
        presetWaterScale = 0.5;
      } else if (preset === "medium") {
        presetGrid = [128, 96, 128];
        presetWaterScale = 0.5;
      } else if (preset === "high") {
        presetGrid = [192, 144, 192];
        presetWaterScale = 1.0;
      }
      if (presetGrid) {
        config.fluid.gridSize = presetGrid;
      }
      if (presetWaterScale) {
        config.fluid.waterScale = presetWaterScale;
      }
      config.fluid.qualityPreset = preset;
    }
    const smokeDensityScale = Number(f.smokeDensityScale);
    if (Number.isFinite(smokeDensityScale) && smokeDensityScale > 0) {
      config.fluid.smokeDensityScale = smokeDensityScale;
    }
    const smokeExtinction = Number(f.smokeExtinction);
    if (Number.isFinite(smokeExtinction) && smokeExtinction > 0) {
      config.fluid.smokeExtinction = smokeExtinction;
    }
    const waterScale = Number(f.waterScale);
    if (Number.isFinite(waterScale) && waterScale > 0 && waterScale <= 1) {
      config.fluid.waterScale = waterScale;
    }
    if (typeof f.logState === "boolean") {
      config.fluid.logState = f.logState;
    }
  }
}

/**
 * Apply engine.cfg values to physics state.
 * @param {Object} physics - Physics state to update
 * @param {Object} cfg - Loaded engine.cfg values
 */
export function applyEngineConfigToPhysics(physics, cfg) {
  if (!cfg?.physics) return;

  if (typeof cfg.physics.enabled === "boolean") {
    physics.enabled = cfg.physics.enabled;
  }
  if (Array.isArray(cfg.physics.gravity) && cfg.physics.gravity.length >= 3) {
    physics.gravity = [...cfg.physics.gravity];
  }
  if (Number.isFinite(cfg.physics.gravityScale)) {
    physics.gravityScale = cfg.physics.gravityScale;
  }
  if (Number.isFinite(cfg.physics.staticFriction)) {
    physics.staticFriction = cfg.physics.staticFriction;
  }
  if (Number.isFinite(cfg.physics.dynamicFriction)) {
    physics.dynamicFriction = cfg.physics.dynamicFriction;
  }
  if (Number.isFinite(cfg.physics.restitution)) {
    physics.restitution = cfg.physics.restitution;
  }
}
