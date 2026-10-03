// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AppBootstrap.js - Application bootstrap helper
 * 
 * Consolidates common app initialization: WebGPU check, canvas ready,
 * config loading, ECS world, GPU init, and main loop setup.
 */

import { isWebGpuSupported, waitForCanvasReady, initGpuState } from "./gpu/GpuInit.js";
import { initEcsWorld } from "../ecs/SceneInit.js";
import { loadEngineConfig } from "../config/EngineConfig.js";
import { ageAndCullParticles } from "../sim/particles/ParticleEmitterSystem.js";
import { runtimeFrameDeltaSeconds } from "./math/FrameMath.js";
import { emaCreate, emaPush } from "./math/MathStatistics.js";

/**
 * Bootstrap a complete application.
 * @param {Object} options - Bootstrap options
 * @param {HTMLCanvasElement} options.canvas - Canvas element
 * @param {Object} options.gpu - GPU state object
 * @param {Object} options.ecs - ECS state object
 * @param {Object} options.config - Config state object
 * @param {Object} options.physics - Physics state object
 * @param {Object} options.render - Render state object
 * @param {string} options.worldName - World name (default: "AppWorld")
 * @param {string} options.configUrl - Config file URL (default: "./engine.cfg")
 * @param {Function} options.applyConfig - Function to apply config overrides
 * @param {Function} options.logger - Logger
 * @returns {Promise<Object>} { device, world } or throws on failure
 */
export async function bootstrapApp(options) {
  const {
    canvas,
    gpu,
    ecs,
    config,
    physics,
    render,
    worldName = "AppWorld",
    configUrl = "./engine.cfg",
    applyConfig,
    logger,
  } = options;

  // 1. Check WebGPU support
  if (!isWebGpuSupported()) {
    const msg = "WebGPU not supported: navigator.gpu is not available";
    if (logger) logger.error(msg);
    throw new Error(msg);
  }

  // 2. Wait for canvas to be properly sized
  await waitForCanvasReady(canvas);

  // 3. Load and apply engine configuration
  try {
    const cfg = await loadEngineConfig({ configUrl, logger });
    if (applyConfig) {
      applyConfig(cfg);
    }
  } catch (configError) {
    if (logger) {
      logger.warn("[CONFIG] Failed to load config, using defaults", { error: configError });
    }
  }

  // 4. Initialize ECS world
  const world = initEcsWorld({
    ecs,
    config,
    physics,
    render,
    worldName,
    logger,
  });

  // 5. Initialize GPU
  if (logger) logger.info("Requesting WebGPU device...");
  const gpuContext = await initGpuState({
    gpu,
    canvasSelector: `#${canvas.id}`,
    label: `${worldName}WebGPUDevice`,
    logger,
  });

  return { device: gpuContext.device, world, disposeGpu: gpuContext.dispose };
}

/**
 * Create main loop with standard update/render pattern.
 * @param {Object} options - Loop options
 * @param {Object} options.ecs - ECS state
 * @param {Function} options.stepWorld - World step function
 * @param {Function} options.stepWorldFrame - World frame step function
 * @param {Function} options.syncInput - Input sync function
 * @param {Function} options.updateCamera - Camera update function
 * @param {Function} options.updateGrab - Grab update function
 * @param {Function} options.stepSimulations - Simulations step function
 * @param {Function} options.drawScene - Scene draw function
 * @param {Function} options.createTestLoop - Loop creator function
 * @param {Object} options.render - Render state for FPS tracking
 * @param {Function} options.logger - Logger
 */
export function createMainLoop(options) {
  const {
    ecs,
    config,
    stepWorld,
    stepWorldFrame,
    syncInput,
    updateCamera,
    updateGrab,
    stepSimulations,
    drawScene,
    createTestLoop,
    render: renderState,
    logger,
    particles,  // Optional: particle state for culling on resume
  } = options;

  // FPS tracking with exponential moving average for smooth display
  let frameCount = 0;
  let lastFpsTime = performance.now();
  
  // Simulation performance tracking
  // Measures actual time spent in simulation to show real performance impact
  let simTimeAccum = 0;      // Accumulated sim execution time (ms)
  let simFrameCount = 0;     // Frames in current measurement window
  let lastSimMeasureTime = performance.now();
  
  // Exponential moving average smoothing factor (0.1 = smooth, 0.5 = responsive)
  const EMA_ALPHA = 0.15;
  let smoothFps = 60;
  let smoothSimMs = 0;       // Smoothed sim time per frame (ms)
  const fpsEma = emaCreate(EMA_ALPHA);
  fpsEma.value = smoothFps;
  fpsEma.initialized = true;
  const simTimeEma = emaCreate(EMA_ALPHA);
  simTimeEma.value = smoothSimMs;
  simTimeEma.initialized = true;

  return createTestLoop({
    logger,
    update(delta, info) {
      // Get user-configured sim time scale
      const simTimeScale =
        config && typeof config.simTimeScale === "number" && Number.isFinite(config.simTimeScale)
          ? config.simTimeScale
          : 1.0;
      
      // Apply catchup slowdown if resuming from hidden/blur
      // simScaleMod is 0.3 → 1.0 during catchup period
      const catchupMod = (info && typeof info.simScaleMod === "number") ? info.simScaleMod : 1.0;
      const simDelta = delta * simTimeScale * catchupMod;
      
      // If resuming from hidden, cull particles that died while we were away
      const hiddenDuration = info?.hiddenDuration || 0;
      if (hiddenDuration > 0 && particles) {
        ageAndCullParticles(particles, hiddenDuration, { logger });
      }
      
      // Track simulation execution time
      const simStartTime = performance.now();
      
      // Sync input
      if (syncInput) syncInput();
      
      // Update camera and grab
      if (updateCamera) updateCamera(delta);
      if (updateGrab) updateGrab();
      
      // Step ECS world
      if (ecs.world && stepWorld) {
        stepWorld(ecs.world, simDelta);
      }
      
      // Step simulations
      if (stepSimulations) {
        stepSimulations(simDelta);
      }
      
      // Measure actual simulation execution time
      const simEndTime = performance.now();
      const simFrameTime = runtimeFrameDeltaSeconds(simEndTime, simStartTime, Infinity) * 1000;
      simTimeAccum += simFrameTime;
      simFrameCount++;
      
      // Update sim performance metric every 250ms
      const measureNow = performance.now();
      const measureElapsed = runtimeFrameDeltaSeconds(measureNow, lastSimMeasureTime, Infinity) * 1000;
      const acceptedMeasureTime = lastSimMeasureTime + measureElapsed;
      if (measureElapsed >= 250) {
        // Calculate average sim time per frame
        const avgSimMs = simFrameCount > 0 ? simTimeAccum / simFrameCount : 0;
        // Apply EMA smoothing
        smoothSimMs = emaPush(simTimeEma, avgSimMs);
        
        // Convert to "effective FPS" - how many frames worth of sim we could do in 1 second
        // If sim takes 16.67ms, we could do 60 sims/sec. If it takes 33ms, only 30/sec.
        // Cap at actual render FPS since that's the max rate simulations actually run
        const effectiveSimFps = smoothSimMs > 0.1 ? 1000 / smoothSimMs : (renderState?.fps || 144);
        if (renderState) renderState.simFps = Math.min(effectiveSimFps, renderState.fps || 999);
        
        // Reset accumulators
        simTimeAccum = 0;
        simFrameCount = 0;
        lastSimMeasureTime = acceptedMeasureTime;
      }
    },
    render(delta) {
      const simTimeScale =
        config && typeof config.simTimeScale === "number" && Number.isFinite(config.simTimeScale)
          ? config.simTimeScale
          : 1.0;
      const simDelta = delta * simTimeScale;
      
      // FPS tracking with EMA smoothing
      frameCount++;
      const now = performance.now();
      const elapsed = runtimeFrameDeltaSeconds(now, lastFpsTime, Infinity) * 1000;
      const acceptedFpsTime = lastFpsTime + elapsed;
      if (elapsed >= 250) { // Update every 250ms for responsiveness
        const instantFps = frameCount / (elapsed / 1000);
        // Apply EMA smoothing
        smoothFps = emaPush(fpsEma, instantFps);
        if (renderState) renderState.fps = smoothFps;
        frameCount = 0;
        lastFpsTime = acceptedFpsTime;
      }
      
      // Step world frame
      if (ecs.world && stepWorldFrame) {
        stepWorldFrame(ecs.world, simDelta);
      }
      
      // Draw scene
      if (drawScene) drawScene();
    },
  });
}

/**
 * Full app bootstrap + loop in one call.
 * @param {Object} options - All options combined
 * @returns {Promise<Object>} { device, world, loop }
 */
export async function runApp(options) {
  const {
    // Bootstrap options
    canvas,
    gpu,
    ecs,
    config,
    physics,
    render,
    worldName,
    configUrl,
    applyConfig,
    // Init callback
    onInit,
    // Loop options
    stepWorld,
    stepWorldFrame,
    syncInput,
    updateCamera,
    updateGrab,
    stepSimulations,
    drawScene,
    createTestLoop,
    logger,
    particles,
  } = options;

  // Bootstrap
  const { device, world, disposeGpu } = await bootstrapApp({
    canvas,
    gpu,
    ecs,
    config,
    physics,
    render,
    worldName,
    configUrl,
    applyConfig,
    logger,
  });

  // Custom init callback (for rendering setup, etc.)
  if (onInit) {
    await onInit(device);
  }

  // Create main loop
  const loop = createMainLoop({
    ecs,
    config,
    stepWorld,
    stepWorldFrame,
    syncInput,
    updateCamera,
    updateGrab,
    stepSimulations,
    drawScene,
    createTestLoop,
    render,
    logger,
    particles,
  });

  return { device, world, loop, disposeGpu };
}
