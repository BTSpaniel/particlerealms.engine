// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createEntity } from "../../ecs/world/World.js";
import { setEntityComponent } from "../../ecs/storage/ArchetypeStorage.js";
import { createTransform } from "../../ecs/components/Transform.js";
import { createPhysicsBody } from "../../ecs/components/PhysicsBody.js";
import { createCollider } from "../../ecs/components/Collider.js";
import { StandardColliderMeshIds } from "../../sim/physics/StandardColliderMeshes.js";

function isValidVec3(input) {
  return Array.isArray(input) && input.length >= 3;
}

export function spawnPhysicsObjectAtPosition(
  ecsWorld,
  position,
  type = "cube",
  spawnerProps = null,
  logger = null,
) {
  if (!ecsWorld || !isValidVec3(position)) {
    return null;
  }

  const spawnPos = [position[0], position[1], position[2]];

  let scale = [1, 1, 1];
  if (
    spawnerProps &&
    Array.isArray(spawnerProps.scale) &&
    spawnerProps.scale.length >= 3
  ) {
    scale = [
      spawnerProps.scale[0],
      spawnerProps.scale[1],
      spawnerProps.scale[2],
    ];
  } else if (type === "plane") {
    scale = [3, 1, 3];
  } else if (type === "pillar") {
    scale = [1, 3, 1];
  }

  let rotation = null;
  if (
    spawnerProps &&
    Array.isArray(spawnerProps.rotation) &&
    spawnerProps.rotation.length >= 4
  ) {
    const rx = Number(spawnerProps.rotation[0]);
    const ry = Number(spawnerProps.rotation[1]);
    const rz = Number(spawnerProps.rotation[2]);
    const rw = Number(spawnerProps.rotation[3]);
    rotation = [
      Number.isFinite(rx) ? rx : 0,
      Number.isFinite(ry) ? ry : 0,
      Number.isFinite(rz) ? rz : 0,
      Number.isFinite(rw) ? rw : 1,
    ];
  }

  const entityId = createEntity(ecsWorld);

  const transformInit = {
    position: [spawnPos[0], spawnPos[1], spawnPos[2]],
    scale,
  };
  if (rotation) {
    transformInit.rotation = rotation;
  }
  const transform = createTransform(transformInit);
  setEntityComponent(ecsWorld, entityId, "Transform", transform);

  // Use simMode from spawnerProps if provided, default to "dynamic"
  const simMode = spawnerProps?.simMode || "dynamic";
  const physicsBody = createPhysicsBody({
    simMode,
  });
  setEntityComponent(ecsWorld, entityId, "PhysicsBody", physicsBody);

  let colliderInit = null;

  if (type === "cube") {
    let sx = Number(scale[0]);
    let sy = Number(scale[1]);
    let sz = Number(scale[2]);
    if (!Number.isFinite(sx)) sx = 1;
    if (!Number.isFinite(sy)) sy = 1;
    if (!Number.isFinite(sz)) sz = 1;
    colliderInit = {
      shape: "convexMesh",
      meshId: StandardColliderMeshIds.UnitCubeConvex,
      halfExtents: [1.0 * sx, 1.0 * sy, 1.0 * sz],
    };
  } else if (type === "ball") {
    let sx = Number(scale[0]);
    let sy = Number(scale[1]);
    let sz = Number(scale[2]);
    if (!Number.isFinite(sx)) sx = 1;
    if (!Number.isFinite(sy)) sy = 1;
    if (!Number.isFinite(sz)) sz = 1;
    colliderInit = {
      shape: "box",
      halfExtents: [1.0 * sx, 1.0 * sy, 1.0 * sz],
    };
  } else if (type === "sphere") {
    let sx = Number(scale[0]);
    let sy = Number(scale[1]);
    let sz = Number(scale[2]);
    if (!Number.isFinite(sx)) sx = 1;
    if (!Number.isFinite(sy)) sy = 1;
    if (!Number.isFinite(sz)) sz = 1;
    const ax = Math.abs(sx);
    const ay = Math.abs(sy);
    const az = Math.abs(sz);
    const eps = 1e-3;
    const uniform =
      Math.abs(ax - ay) < eps &&
      Math.abs(ay - az) < eps;
    const isUnitSphere =
      uniform && Math.abs(ax - 1.0) < eps;
    if (isUnitSphere) {
      colliderInit = {
        shape: "convexMesh",
        meshId: StandardColliderMeshIds.UnitSphereConvex,
      };
    } else if (uniform) {
      colliderInit = {
        shape: "sphere",
        radius: 0.5 * ax,
      };
    } else {
      colliderInit = {
        shape: "convexMesh",
        meshId: StandardColliderMeshIds.UnitSphereConvex,
        halfExtents: [0.5 * sx, 0.5 * sy, 0.5 * sz],
      };
    }
  } else if (type === "cylinder" || type === "pillar") {
    let sx = Number(scale[0]);
    let sy = Number(scale[1]);
    let sz = Number(scale[2]);
    if (!Number.isFinite(sx)) sx = 1;
    if (!Number.isFinite(sy)) sy = 1;
    if (!Number.isFinite(sz)) sz = 1;
    colliderInit = {
      shape: "convexMesh",
      meshId: StandardColliderMeshIds.UnitCylinderConvex,
      halfExtents: [0.5 * sx, 0.5 * sy, 0.5 * sz],
    };
  } else if (type === "emitter_marker") {
    // Small floating cube for emitter visual marker
    let sx = Number(scale[0]);
    let sy = Number(scale[1]);
    let sz = Number(scale[2]);
    if (!Number.isFinite(sx)) sx = 0.3;
    if (!Number.isFinite(sy)) sy = 0.3;
    if (!Number.isFinite(sz)) sz = 0.3;
    colliderInit = {
      shape: "box",
      halfExtents: [0.5 * sx, 0.5 * sy, 0.5 * sz],
    };
  } else if (type === "plane") {
    let sx = Number(scale[0]);
    let sy = Number(scale[1]);
    let sz = Number(scale[2]);
    if (!Number.isFinite(sx)) sx = 1;
    if (!Number.isFinite(sy)) sy = 1;
    if (!Number.isFinite(sz)) sz = 1;
    const ax = Math.abs(sx);
    const ay = Math.abs(sy);
    const az = Math.abs(sz);
    const eps = 1e-3;
    const isDefaultPlane =
      Math.abs(ax - 3.0) < eps &&
      Math.abs(ay - 1.0) < eps &&
      Math.abs(az - 3.0) < eps;

    if (isDefaultPlane) {
      colliderInit = {
        shape: "convexMesh",
        meshId: StandardColliderMeshIds.Plane3x3Convex,
      };
    } else {
      colliderInit = {
        shape: "box",
        halfExtents: [1.5 * sx, 0.05 * sy, 1.5 * sz],
      };
    }
  }

  if (colliderInit) {
    const colliderComponent = createCollider(colliderInit);
    setEntityComponent(ecsWorld, entityId, "Collider", colliderComponent);
  }

  if (logger && typeof logger.info === "function") {
    try {
      logger.info(
        `[PHYSICS] Spawned physics body at (${spawnPos[0].toFixed(2)}, ${spawnPos[1].toFixed(2)}, ${spawnPos[2].toFixed(2)})`,
      );
    } catch (_) {}
  }

  return { entityId, scale, colliderInit };
}
