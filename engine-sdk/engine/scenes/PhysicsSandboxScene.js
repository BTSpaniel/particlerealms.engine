// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createEntity } from "../ecs/world/World.js";
import { createTransform } from "../ecs/components/Transform.js";
import { createLight } from "../ecs/components/Light.js";
import { createCamera } from "../ecs/components/Camera.js";
import { createPhysicsBody } from "../ecs/components/PhysicsBody.js";
import { createCollider } from "../ecs/components/Collider.js";
import { setEntityComponent } from "../ecs/storage/ArchetypeStorage.js";
import { registerPhysicsSystem } from "../ecs/systems/PhysicsSystem.js";

function asVec3(input, fallback) {
  if (Array.isArray(input) && input.length >= 3) {
    return [
      Number.isFinite(Number(input[0])) ? Number(input[0]) : fallback[0],
      Number.isFinite(Number(input[1])) ? Number(input[1]) : fallback[1],
      Number.isFinite(Number(input[2])) ? Number(input[2]) : fallback[2],
    ];
  }
  return fallback.slice();
}

export function configurePhysicsSandboxScene(world, options = {}) {
  if (!world) {
    throw new Error("configurePhysicsSandboxScene: world is required");
  }

  const roomSize = Number(options.roomSize);
  const size = Number.isFinite(roomSize) && roomSize > 0 ? roomSize : 50;
  const half = size * 0.5;

  const baseGravity = asVec3(options.baseGravity, [0, -9.81, 0]);

  const staticFriction = Number.isFinite(options.staticFriction)
    ? options.staticFriction
    : 0.5;
  const dynamicFriction = Number.isFinite(options.dynamicFriction)
    ? options.dynamicFriction
    : 0.5;
  const restitution = Number.isFinite(options.restitution)
    ? options.restitution
    : 0.5;

  const lightIntensity = Number.isFinite(options.lightIntensity)
    ? options.lightIntensity
    : 1.5;

  const lightHeight = Number.isFinite(options.lightHeight)
    ? options.lightHeight
    : half - 5;

  const cameraFar = Number.isFinite(options.cameraFar)
    ? options.cameraFar
    : size * 4;

  const lightEntity = createEntity(world);
  const lightTransform = createTransform({
    position: [0, lightHeight, 0],
  });
  const lightComp = createLight({ intensity: lightIntensity });
  setEntityComponent(world, lightEntity, "Transform", lightTransform);
  setEntityComponent(world, lightEntity, "Light", lightComp);

  const cameraEntity = createEntity(world);
  const camTransform = createTransform({
    position: [0, 0, 0],
  });
  const camComponent = createCamera({
    fov: 60,
    near: 0.1,
    far: cameraFar,
    mode: "free",
  });
  setEntityComponent(world, cameraEntity, "Transform", camTransform);
  setEntityComponent(world, cameraEntity, "Camera", camComponent);

  registerPhysicsSystem(world, {
    name: options.physicsSystemName || "PhysicsSandboxSystem",
    phase: "physics",
    updateKind: "tick",
    worldOptions: {
      gravity: baseGravity,
      maxStep: 1 / 120,
      maxSubSteps: 4,
      material: {
        staticFriction,
        dynamicFriction,
        restitution,
      },
    },
  });

  const floorEntity = createEntity(world);
  const floorTransform = createTransform({
    // Raise the physical floor a small amount above the visual plane to avoid visible sinking
    position: [0, -half - 0.2, 0],
  });
  const floorCollider = createCollider({
    shape: "box",
    halfExtents: [half, 0.25, half],
  });
  const floorBody = createPhysicsBody({
    simMode: "static",
  });
  setEntityComponent(world, floorEntity, "Transform", floorTransform);
  setEntityComponent(world, floorEntity, "Collider", floorCollider);
  setEntityComponent(world, floorEntity, "PhysicsBody", floorBody);

  const backWallEntity = createEntity(world);
  const backWallTransform = createTransform({
    position: [0, 0, -half - 0.25],
  });
  const backWallCollider = createCollider({
    shape: "box",
    halfExtents: [half, half, 0.25],
  });
  const backWallBody = createPhysicsBody({
    simMode: "static",
  });
  setEntityComponent(world, backWallEntity, "Transform", backWallTransform);
  setEntityComponent(world, backWallEntity, "Collider", backWallCollider);
  setEntityComponent(world, backWallEntity, "PhysicsBody", backWallBody);

  const leftWallEntity = createEntity(world);
  const leftWallTransform = createTransform({
    position: [-half - 0.25, 0, 0],
  });
  const leftWallCollider = createCollider({
    shape: "box",
    halfExtents: [0.25, half, half],
  });
  const leftWallBody = createPhysicsBody({
    simMode: "static",
  });
  setEntityComponent(world, leftWallEntity, "Transform", leftWallTransform);
  setEntityComponent(world, leftWallEntity, "Collider", leftWallCollider);
  setEntityComponent(world, leftWallEntity, "PhysicsBody", leftWallBody);

  const rightWallEntity = createEntity(world);
  const rightWallTransform = createTransform({
    position: [half + 0.25, 0, 0],
  });
  const rightWallCollider = createCollider({
    shape: "box",
    halfExtents: [0.25, half, half],
  });
  const rightWallBody = createPhysicsBody({
    simMode: "static",
  });
  setEntityComponent(world, rightWallEntity, "Transform", rightWallTransform);
  setEntityComponent(world, rightWallEntity, "Collider", rightWallCollider);
  setEntityComponent(world, rightWallEntity, "PhysicsBody", rightWallBody);

  const frontWallEntity = createEntity(world);
  const frontWallTransform = createTransform({
    position: [0, 0, half + 0.25],
  });
  const frontWallCollider = createCollider({
    shape: "box",
    halfExtents: [half, half, 0.25],
  });
  const frontWallBody = createPhysicsBody({
    simMode: "static",
  });
  setEntityComponent(world, frontWallEntity, "Transform", frontWallTransform);
  setEntityComponent(world, frontWallEntity, "Collider", frontWallCollider);
  setEntityComponent(world, frontWallEntity, "PhysicsBody", frontWallBody);

  return {
    lightEntityId: lightEntity,
    cameraEntityId: cameraEntity,
    roomSize: size,
  };
}
