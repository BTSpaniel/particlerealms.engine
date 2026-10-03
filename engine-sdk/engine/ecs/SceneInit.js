// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SceneInit.js - ECS scene initialization helpers
 * 
 * Simplifies ECS world creation and physics sandbox setup.
 */

import { createWorld } from "./world/World.js";
import { configurePhysicsSandboxScene } from "../scenes/PhysicsSandboxScene.js";

/**
 * Initialize ECS world with physics sandbox scene.
 * @param {Object} options - Initialization options
 * @param {Object} options.ecs - ECS state object to populate
 * @param {Object} options.config - Config state { roomSize, lightHeight, cameraFar }
 * @param {Object} options.physics - Physics state { gravity, staticFriction, dynamicFriction, restitution }
 * @param {Object} options.render - Render state { lightBrightness }
 * @param {string} options.worldName - World name (default: "SimWorld")
 * @param {number} options.fixedDelta - Fixed timestep (default: 1/60)
 * @param {Function} options.logger - Optional logger
 * @returns {Object} Created world
 */
export function initEcsWorld(options) {
  const {
    ecs,
    config,
    physics,
    render,
    worldName = "SimWorld",
    fixedDelta = 1 / 60,
    logger,
  } = options;

  const world = createWorld({
    name: worldName,
    fixedDelta,
  });

  // Set up error handler
  world.onSystemError = (worldRef, system, error) => {
    if (logger) {
      logger.error("[ECS] System error", {
        world: worldRef?.name,
        systemId: system?.id,
        systemName: system?.name,
        phase: system?.phase,
        error,
      });
    }
  };

  // Configure physics sandbox scene
  const sceneInfo = configurePhysicsSandboxScene(world, {
    roomSize: config.roomSize,
    baseGravity: physics.gravity,
    staticFriction: physics.staticFriction,
    dynamicFriction: physics.dynamicFriction,
    restitution: physics.restitution,
    lightIntensity: render.lightBrightness,
    lightHeight: config.lightHeight,
    cameraFar: config.cameraFar,
    physicsSystemName: `${worldName}PhysicsSystem`,
  });

  // Populate ECS state
  ecs.world = world;
  ecs.lightEntity = sceneInfo?.lightEntityId ?? null;
  ecs.cameraEntity = sceneInfo?.cameraEntityId ?? null;

  return world;
}

/**
 * Create a minimal ECS world without physics sandbox.
 * @param {Object} options - Options
 * @returns {Object} Created world
 */
export function createMinimalWorld(options = {}) {
  const { name = "MinimalWorld", fixedDelta = 1 / 60 } = options;
  return createWorld({ name, fixedDelta });
}
