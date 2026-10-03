// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createQuery, forEachEntity } from "../query/Query.js";
import { registerSystem } from "./SystemRegistry.js";
import { quatRotateVec3, quatConjugate } from "../../core/math/EngineMath.js";
import { createClothSimWorld, destroyClothSimWorld, addClothInstance, removeClothInstance, stepClothSimWorld } from "../../sim/cloth/ClothSimWorld.js";

function createClothQuery() {
  return createQuery({
    name: "ClothSystemQuery",
    all: ["Cloth", "Transform"],
  });
}

export function registerClothSystem(world, options = {}) {
  const phase = options.phase || "postPhysics";
  const updateKind = options.updateKind || "tick";
  const name = options.name || "ClothSystem";

  const solverOptions = options && typeof options === "object" ? options : {};
  const solverMaxDeltaRaw = solverOptions.maxDelta;
  const solverIterationsRaw = solverOptions.structuralIterations;
  const solverSubstepsRaw = solverOptions.substeps;
  const solverMaxDelta =
    typeof solverMaxDeltaRaw === "number" && Number.isFinite(solverMaxDeltaRaw) &&
    solverMaxDeltaRaw > 0
      ? solverMaxDeltaRaw
      : 0.05;
  const solverIterations =
    typeof solverIterationsRaw === "number" &&
    Number.isFinite(solverIterationsRaw) &&
    solverIterationsRaw >= 1
      ? (solverIterationsRaw | 0) || 1
      : 1;
  const solverSubsteps =
    typeof solverSubstepsRaw === "number" &&
    Number.isFinite(solverSubstepsRaw) &&
    solverSubstepsRaw >= 1
      ? (solverSubstepsRaw | 0) || 1
      : 1;
  const shouldSimulateCloth =
    typeof solverOptions.shouldSimulateCloth === "function"
      ? solverOptions.shouldSimulateCloth
      : null;

  return registerSystem(world, {
    name,
    phase,
    updateKind,
    group: options.group || "Sim",
    createState() {
      return {
        clothWorld: createClothSimWorld({ name: `${name}.World` }),
        query: createClothQuery(),
        entityToInstance: new Map(),
        activeEntities: new Set(),
        solverMaxDelta,
        solverIterations,
        solverSubsteps,
        shouldSimulateCloth,
      };
    },
    teardown(worldRef, system) {
      const state = system && system.state;
      if (!state) {
        return;
      }
      if (state.clothWorld) {
        destroyClothSimWorld(state.clothWorld);
        state.clothWorld = null;
      }
      if (state.entityToInstance) {
        state.entityToInstance.clear();
      }
      if (state.activeEntities) {
        state.activeEntities.clear();
      }
    },
    update(worldRef, deltaSeconds, system) {
      const state = system.state;
      const clothWorld = state.clothWorld;
      const query = state.query;
      const entityToInstance = state.entityToInstance;
      const activeEntities = state.activeEntities;
      const solverMaxDelta = state.solverMaxDelta;
      const solverIterations = state.solverIterations;
      const solverSubsteps = state.solverSubsteps;
      const shouldSimulateCloth = state.shouldSimulateCloth;

      if (worldRef && !worldRef.clothWorld && clothWorld) {
        worldRef.clothWorld = clothWorld;
      }

      if (!clothWorld || !query) {
        return;
      }

      // Track which entities are currently active cloth instances this frame.
      activeEntities.clear();

      // For now, we only ensure that each enabled Cloth entity has a
      // corresponding instance in the ClothSimWorld. Detailed simulation
      // will come later.
      forEachEntity(worldRef, query, (entityId, get) => {
        const cloth = get("Cloth");
        const transform = get("Transform");
        if (!cloth || !transform) {
          return;
        }
        if (cloth.enabled === false) {
          return;
        }
        if (
          shouldSimulateCloth &&
          !shouldSimulateCloth(worldRef, entityId, cloth, transform)
        ) {
          return;
        }
        activeEntities.add(entityId);

        if (!entityToInstance.has(entityId)) {
          const instanceId = addClothInstance(clothWorld, {
            entityId,
            topology: cloth.topology,
            material: cloth.material,
            constraints: cloth.constraints,
            transform,
          });
          entityToInstance.set(entityId, instanceId);
        }
      });

      // Remove any instances whose entities are no longer active (either
      // destroyed or cloth disabled).
      for (const [entityId, instanceId] of entityToInstance.entries()) {
        if (!activeEntities.has(entityId)) {
          removeClothInstance(clothWorld, instanceId);
          entityToInstance.delete(entityId);
        }
      }

      const physicsWorld = worldRef && worldRef.physicsWorld
        ? worldRef.physicsWorld
        : null;

      const substeps = solverSubsteps >= 1 ? solverSubsteps : 1;
      const stepDt = substeps > 1 ? deltaSeconds / substeps : deltaSeconds;

      for (let s = 0; s < substeps; s++) {
        if (!physicsWorld) {
          stepClothSimWorld(clothWorld, stepDt, {
            maxDelta: solverMaxDelta,
            structuralIterations: solverIterations,
          });
          continue;
        }

        stepClothSimWorld(clothWorld, stepDt, {
          maxDelta: solverMaxDelta,
          structuralIterations: solverIterations,
          resolveParticleCollision(instance, particle, prev, pos) {
            return resolveClothParticleCollisionWithPhysicsWorld(
              physicsWorld,
              instance,
              particle,
              prev,
              pos
            );
          },
        });
      }
    },
  });
}

function resolveClothParticleCollisionWithPhysicsWorld(
  physicsWorld,
  instance,
  particle,
  prev,
  pos
) {
  if (!physicsWorld || !physicsWorld.bodies) {
    return null;
  }

  if (!pos || pos.length < 3) {
    return null;
  }

  const material = instance && instance.material ? instance.material : null;
  const thicknessValue = material ? Number(material.thickness) : NaN;
  let particleRadius =
    Number.isFinite(thicknessValue) && thicknessValue > 0
      ? thicknessValue * 0.5
      : 0.05;

  const px = pos[0];
  const py = pos[1];
  const pz = pos[2];

  let bestResult = null;
  let bestMoveSq = Infinity;
  let bestNormal = null;

  const frictionRaw = material ? Number(material.collisionFriction) : NaN;
  const stickinessRaw = material ? Number(material.collisionStickiness) : NaN;
  let collisionFriction =
    Number.isFinite(frictionRaw) && frictionRaw >= 0 ? frictionRaw : 0.5;
  let collisionStickiness =
    Number.isFinite(stickinessRaw) && stickinessRaw >= 0 ? stickinessRaw : 0;
  if (collisionFriction > 1) {
    collisionFriction = 1;
  }
  if (collisionStickiness > 1) {
    collisionStickiness = 1;
  }

  for (const body of physicsWorld.bodies.values()) {
    if (!body) {
      continue;
    }

    if (body.colliderIsTrigger) {
      continue;
    }

    const center = body.position;
    if (!Array.isArray(center) || center.length < 3) {
      continue;
    }

    const cx = center[0];
    const cy = center[1];
    const cz = center[2];
    if (
      !Number.isFinite(cx) ||
      !Number.isFinite(cy) ||
      !Number.isFinite(cz)
    ) {
      continue;
    }

    const shape = body.colliderShape || "box";
    const rotation = Array.isArray(body.rotation) && body.rotation.length >= 4
      ? body.rotation
      : [0, 0, 0, 1];
    const invRotation = quatConjugate(rotation);

    if (shape === "sphere") {
      const r = Number(body.colliderRadius);
      const colliderRadius =
        Number.isFinite(r) && r > 0 ? r : 0.5;
      const effectiveRadius = colliderRadius + particleRadius;
      if (!(effectiveRadius > 0)) {
        continue;
      }

      const dx = px - cx;
      const dy = py - cy;
      const dz = pz - cz;
      const distSq = dx * dx + dy * dy + dz * dz;
      const radiusSq = effectiveRadius * effectiveRadius;
      if (!(distSq < radiusSq)) {
        continue;
      }

      const dist = Math.sqrt(distSq);
      let nx = 0;
      let ny = 1;
      let nz = 0;
      if (dist > 1e-4) {
        const invDist = 1 / dist;
        nx = dx * invDist;
        ny = dy * invDist;
        nz = dz * invDist;
      }

      const correctedX = cx + nx * effectiveRadius;
      const correctedY = cy + ny * effectiveRadius;
      const correctedZ = cz + nz * effectiveRadius;

      const moveX = correctedX - px;
      const moveY = correctedY - py;
      const moveZ = correctedZ - pz;
      const moveSq = moveX * moveX + moveY * moveY + moveZ * moveZ;

      if (moveSq < bestMoveSq) {
        bestMoveSq = moveSq;
        bestResult = [correctedX, correctedY, correctedZ];
        bestNormal = [nx, ny, nz];
      }
      continue;
    }

    if (shape === "capsule") {
      const r = Number(body.colliderRadius);
      const h = Number(body.colliderHalfHeight);
      const radiusValue = Number.isFinite(r) && r > 0 ? r : 0.5;
      const halfHeight = Number.isFinite(h) && h > 0 ? h : 0.5;
      const effectiveRadius = radiusValue + particleRadius;
      if (!(effectiveRadius > 0)) {
        continue;
      }

      const localA = [0, -halfHeight, 0];
      const localB = [0, halfHeight, 0];
      const worldA = quatRotateVec3(localA, rotation);
      const worldB = quatRotateVec3(localB, rotation);

      const ax = cx + worldA[0];
      const ay = cy + worldA[1];
      const az = cz + worldA[2];
      const bx = cx + worldB[0];
      const by = cy + worldB[1];
      const bz = cz + worldB[2];

      const abx = bx - ax;
      const aby = by - ay;
      const abz = bz - az;
      const abLenSq = abx * abx + aby * aby + abz * abz;
      let t = 0.5;
      if (abLenSq > 1e-6) {
        const apx = px - ax;
        const apy = py - ay;
        const apz = pz - az;
        t = (apx * abx + apy * aby + apz * abz) / abLenSq;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
      }

      const cxSeg = ax + abx * t;
      const cySeg = ay + aby * t;
      const czSeg = az + abz * t;

      const dx = px - cxSeg;
      const dy = py - cySeg;
      const dz = pz - czSeg;
      const distSq = dx * dx + dy * dy + dz * dz;
      const radiusSq = effectiveRadius * effectiveRadius;
      if (!(distSq < radiusSq)) {
        continue;
      }

      const dist = Math.sqrt(distSq);
      let nx = 0;
      let ny = 1;
      let nz = 0;
      if (dist > 1e-4) {
        const invDist = 1 / dist;
        nx = dx * invDist;
        ny = dy * invDist;
        nz = dz * invDist;
      }

      const correctedX = cxSeg + nx * effectiveRadius;
      const correctedY = cySeg + ny * effectiveRadius;
      const correctedZ = czSeg + nz * effectiveRadius;

      const moveX = correctedX - px;
      const moveY = correctedY - py;
      const moveZ = correctedZ - pz;
      const moveSq = moveX * moveX + moveY * moveY + moveZ * moveZ;

      if (moveSq < bestMoveSq) {
        bestMoveSq = moveSq;
        bestResult = [correctedX, correctedY, correctedZ];
        bestNormal = [nx, ny, nz];
      }
      continue;
    }

    const he = Array.isArray(body.colliderHalfExtents)
      ? body.colliderHalfExtents
      : [0.5, 0.5, 0.5];
    const hx = Number(he[0]);
    const hy = Number(he[1]);
    const hz = Number(he[2]);
    const ex = Number.isFinite(hx) ? hx : 0.5;
    const ey = Number.isFinite(hy) ? hy : 0.5;
    const ez = Number.isFinite(hz) ? hz : 0.5;

    const localPos = quatRotateVec3([px - cx, py - cy, pz - cz], invRotation);
    const lx = localPos[0];
    const ly = localPos[1];
    const lz = localPos[2];

    const minX = -ex - particleRadius;
    const maxX = ex + particleRadius;
    const minY = -ey - particleRadius;
    const maxY = ey + particleRadius;
    const minZ = -ez - particleRadius;
    const maxZ = ez + particleRadius;

    const insideX = lx > minX && lx < maxX;
    const insideY = ly > minY && ly < maxY;
    const insideZ = lz > minZ && lz < maxZ;

    if (!(insideX && insideY && insideZ)) {
      continue;
    }

    const distToMinX = lx - minX;
    const distToMaxX = maxX - lx;
    const distToMinY = ly - minY;
    const distToMaxY = maxY - ly;
    const distToMinZ = lz - minZ;
    const distToMaxZ = maxZ - lz;

    let axis = 0;
    let sign = 1;
    let minDist = distToMinX;

    if (distToMaxX < minDist) {
      minDist = distToMaxX;
      axis = 0;
      sign = -1;
    }
    if (distToMinY < minDist) {
      minDist = distToMinY;
      axis = 1;
      sign = 1;
    }
    if (distToMaxY < minDist) {
      minDist = distToMaxY;
      axis = 1;
      sign = -1;
    }
    if (distToMinZ < minDist) {
      minDist = distToMinZ;
      axis = 2;
      sign = 1;
    }
    if (distToMaxZ < minDist) {
      minDist = distToMaxZ;
      axis = 2;
      sign = -1;
    }

    let correctedLocalX = lx;
    let correctedLocalY = ly;
    let correctedLocalZ = lz;

    if (axis === 0) {
      correctedLocalX = lx + sign * minDist;
    } else if (axis === 1) {
      correctedLocalY = ly + sign * minDist;
    } else {
      correctedLocalZ = lz + sign * minDist;
    }

    const correctedOffsetWorld = quatRotateVec3(
      [correctedLocalX, correctedLocalY, correctedLocalZ],
      rotation
    );
    const correctedX = cx + correctedOffsetWorld[0];
    const correctedY = cy + correctedOffsetWorld[1];
    const correctedZ = cz + correctedOffsetWorld[2];

    let nxBox = 0;
    let nyBox = 1;
    let nzBox = 0;
    if (axis === 0) {
      const localN = [sign, 0, 0];
      const worldN = quatRotateVec3(localN, rotation);
      nxBox = worldN[0];
      nyBox = worldN[1];
      nzBox = worldN[2];
    } else if (axis === 1) {
      const localN = [0, sign, 0];
      const worldN = quatRotateVec3(localN, rotation);
      nxBox = worldN[0];
      nyBox = worldN[1];
      nzBox = worldN[2];
    } else {
      const localN = [0, 0, sign];
      const worldN = quatRotateVec3(localN, rotation);
      nxBox = worldN[0];
      nyBox = worldN[1];
      nzBox = worldN[2];
    }
    const lenSqN = nxBox * nxBox + nyBox * nyBox + nzBox * nzBox;
    if (lenSqN > 0) {
      const invLenN = 1 / Math.sqrt(lenSqN);
      nxBox *= invLenN;
      nyBox *= invLenN;
      nzBox *= invLenN;
    } else {
      nxBox = 0;
      nyBox = 1;
      nzBox = 0;
    }

    const moveX = correctedX - px;
    const moveY = correctedY - py;
    const moveZ = correctedZ - pz;
    const moveSq = moveX * moveX + moveY * moveY + moveZ * moveZ;

    if (moveSq < bestMoveSq) {
      bestMoveSq = moveSq;
      bestResult = [correctedX, correctedY, correctedZ];
      bestNormal = [nxBox, nyBox, nzBox];
    }
  }

  const groundY = 0;
  const minY = groundY + particleRadius;
  if (py < minY) {
    const correctedX = px;
    const correctedY = minY;
    const correctedZ = pz;
    const moveY = correctedY - py;
    const moveSq = moveY * moveY;
    if (moveSq < bestMoveSq) {
      bestMoveSq = moveSq;
      bestResult = [correctedX, correctedY, correctedZ];
      bestNormal = [0, 1, 0];
    }
  }

  if (!bestResult) {
    return null;
  }

  if (
    bestNormal &&
    prev &&
    Array.isArray(prev) &&
    prev.length >= 3 &&
    pos &&
    Array.isArray(pos) &&
    pos.length >= 3
  ) {
    const vx = pos[0] - prev[0];
    const vy = pos[1] - prev[1];
    const vz = pos[2] - prev[2];

    const nx = bestNormal[0];
    const ny = bestNormal[1];
    const nz = bestNormal[2];
    const vn = vx * nx + vy * ny + vz * nz;

    let vnX = 0;
    let vnY = 0;
    let vnZ = 0;
    if (vn < 0) {
      vnX = nx * vn;
      vnY = ny * vn;
      vnZ = nz * vn;
    }

    let vtX = vx - vnX;
    let vtY = vy - vnY;
    let vtZ = vz - vnZ;

    const frictionFactor = 1 - collisionFriction;
    vtX *= frictionFactor;
    vtY *= frictionFactor;
    vtZ *= frictionFactor;

    const vtLenSq = vtX * vtX + vtY * vtY + vtZ * vtZ;
    if (vtLenSq > 0) {
      const vtLen = Math.sqrt(vtLenSq);
      const stickThreshold = 0.01 + 0.09 * collisionStickiness;
      if (vtLen < stickThreshold) {
        vtX = 0;
        vtY = 0;
        vtZ = 0;
      }
    }

    const finalVx = vtX;
    const finalVy = vtY;
    const finalVz = vtZ;

    prev[0] = bestResult[0] - finalVx;
    prev[1] = bestResult[1] - finalVy;
    prev[2] = bestResult[2] - finalVz;
  }

  return bestResult;
}
