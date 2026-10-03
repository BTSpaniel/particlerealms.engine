// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  vec3Add,
  vec3Dot,
  vec3Normalize,
  vec3Scale,
} from "../../core/math/EngineMath.js";
import { raySphere } from "../../core/math/MathGeometry.js";
import { positiveSafeEntityHandleReport } from "../../ecs/world/World.js";
import {
  finiteNumberReport,
  vectorValidationReport,
} from "../../core/math/MathValidation.js";

export const ROOM_PICKING_LIMITS = Object.freeze({
  defaultRoomSize: 50,
  defaultMinDistance: 0.25,
  defaultEntityMaxDistance: 1000,
  defaultBallRadius: 0.5,
  maxRoomSize: 1e9,
  maxDistance: 1e12,
  maxBallRadius: 1e6,
  maxCoordinateMagnitude: 1e12,
  maxDirectionComponent: 1e6,
  maxScaleMagnitude: 1e6,
  maxEntities: 100000,
});

function optionReport(options, key, fallback, bounds) {
  const value = options?.[key] === undefined ? fallback : options[key];
  return finiteNumberReport(value, bounds);
}

export function pickingRayReport(ray) {
  const eye = vectorValidationReport(ray?.eye, {
    dimension: 3,
    componentMin: -ROOM_PICKING_LIMITS.maxCoordinateMagnitude,
    componentMax: ROOM_PICKING_LIMITS.maxCoordinateMagnitude,
  });
  const direction = vectorValidationReport(ray?.dir, {
    dimension: 3,
    allowZero: false,
    componentMin: -ROOM_PICKING_LIMITS.maxDirectionComponent,
    componentMax: ROOM_PICKING_LIMITS.maxDirectionComponent,
  });
  return {
    valid: eye.valid && direction.valid,
    eye,
    direction,
    ray: eye.valid && direction.valid
      ? { eye: [...ray.eye], dir: vec3Normalize(ray.dir) }
      : null,
  };
}

export function roomPickingOptionsReport(options = {}) {
  const roomSize = optionReport(options, "roomSize", ROOM_PICKING_LIMITS.defaultRoomSize, {
    min: Number.EPSILON,
    max: ROOM_PICKING_LIMITS.maxRoomSize,
  });
  const minDistance = optionReport(options, "minDistance", ROOM_PICKING_LIMITS.defaultMinDistance, {
    min: 0,
    max: ROOM_PICKING_LIMITS.maxDistance,
  });
  const fallbackMax = roomSize.valid
    ? Math.min(ROOM_PICKING_LIMITS.maxDistance, roomSize.value * 2)
    : ROOM_PICKING_LIMITS.defaultRoomSize * 2;
  const maxDistance = optionReport(options, "maxDistance", fallbackMax, {
    min: 0,
    max: ROOM_PICKING_LIMITS.maxDistance,
  });
  const ballRadius = optionReport(options, "ballRadius", ROOM_PICKING_LIMITS.defaultBallRadius, {
    min: 0,
    max: ROOM_PICKING_LIMITS.maxBallRadius,
  });
  const ordered = minDistance.valid && maxDistance.valid && maxDistance.value >= minDistance.value;
  return {
    valid: roomSize.valid && minDistance.valid && maxDistance.valid && ballRadius.valid && ordered,
    roomSize,
    minDistance,
    maxDistance,
    ballRadius,
    ordered,
  };
}

export function entityPickingOptionsReport(options = {}) {
  const minDistance = optionReport(options, "minDistance", ROOM_PICKING_LIMITS.defaultMinDistance, {
    min: 0,
    max: ROOM_PICKING_LIMITS.maxDistance,
  });
  const maxDistance = optionReport(options, "maxDistance", ROOM_PICKING_LIMITS.defaultEntityMaxDistance, {
    min: 0,
    max: ROOM_PICKING_LIMITS.maxDistance,
  });
  const maxEntities = optionReport(options, "maxEntities", ROOM_PICKING_LIMITS.maxEntities, {
    integer: true,
    min: 1,
    max: ROOM_PICKING_LIMITS.maxEntities,
  });
  const ordered = minDistance.valid && maxDistance.valid && maxDistance.value >= minDistance.value;
  return { valid: minDistance.valid && maxDistance.valid && maxEntities.valid && ordered, minDistance, maxDistance, maxEntities, ordered };
}

export function pickRoomSurfaceFromRay(ray, options = {}) {
  const admittedRay = pickingRayReport(ray);
  const admittedOptions = roomPickingOptionsReport(options);
  if (!admittedRay.valid || !admittedOptions.valid) return null;
  const { eye, dir } = admittedRay.ray;
  const roomSize = admittedOptions.roomSize.value;
  const half = roomSize * 0.5;
  const minDistance = admittedOptions.minDistance.value;
  const maxDistance = admittedOptions.maxDistance.value;
  const ballRadius = admittedOptions.ballRadius.value;
  const hits = [];

  function tryAddHit(t, point, normal) {
    if (!Number.isFinite(t) || t <= minDistance || t > maxDistance) return;
    if (vec3Dot(dir, normal) >= 0) return;
    if (!vectorValidationReport(point, { dimension: 3 }).valid) return;
    hits.push({ t, point, normal });
  }

  const denomY = dir[1];
  if (Math.abs(denomY) > 1e-4) {
    const t = (-half - eye[1]) / denomY;
    const point = vec3Add(eye, vec3Scale(dir, t));
    if (t > 0 && Math.abs(point[0]) <= half + 1e-3 && Math.abs(point[2]) <= half + 1e-3) {
      tryAddHit(t, point, [0, 1, 0]);
    }
  }

  const denomZ = dir[2];
  if (Math.abs(denomZ) > 1e-4) {
    const t = (-half - eye[2]) / denomZ;
    const point = vec3Add(eye, vec3Scale(dir, t));
    if (t > 0 && point[1] >= -half && point[1] <= half && Math.abs(point[0]) <= half + 1e-3) {
      tryAddHit(t, point, [0, 0, 1]);
    }
  }

  const denomX = dir[0];
  if (Math.abs(denomX) > 1e-4) {
    const rightT = (half - eye[0]) / denomX;
    const rightPoint = vec3Add(eye, vec3Scale(dir, rightT));
    if (rightT > 0 && rightPoint[1] >= -half && rightPoint[1] <= half && Math.abs(rightPoint[2]) <= half + 1e-3) {
      tryAddHit(rightT, rightPoint, [-1, 0, 0]);
    }
    const leftT = (-half - eye[0]) / denomX;
    const leftPoint = vec3Add(eye, vec3Scale(dir, leftT));
    if (leftT > 0 && leftPoint[1] >= -half && leftPoint[1] <= half && Math.abs(leftPoint[2]) <= half + 1e-3) {
      tryAddHit(leftT, leftPoint, [1, 0, 0]);
    }
  }

  if (hits.length === 0) return null;
  let best = hits[0];
  for (let i = 1; i < hits.length; i++) {
    if (hits[i].t < best.t) best = hits[i];
  }
  const center = vec3Add(best.point, vec3Scale(best.normal, ballRadius));
  return { point: center, normal: [...best.normal] };
}

export function pickEntityFromRay(ray, ecsWorld, spawnedEntities, options = {}) {
  const admittedRay = pickingRayReport(ray);
  const admittedOptions = entityPickingOptionsReport(options);
  if (!admittedRay.valid || !admittedOptions.valid || !ecsWorld || !Array.isArray(spawnedEntities) ||
      spawnedEntities.length === 0 || spawnedEntities.length > admittedOptions.maxEntities.value) {
    return null;
  }
  const { eye, dir } = admittedRay.ray;
  let bestId = null;
  let bestDistance = Infinity;

  for (const entry of spawnedEntities) {
    const entity = positiveSafeEntityHandleReport(entry?.entityId);
    if (!entity.valid) continue;
    let transform = null;
    try {
      transform = typeof ecsWorld.getComponent === "function"
        ? ecsWorld.getComponent(entity.value, "Transform")
        : null;
      if (!transform && typeof options.getTransform === "function") transform = options.getTransform(entity.value);
    } catch (_) {
      transform = null;
    }
    const position = vectorValidationReport(transform?.position, {
      dimension: 3,
      componentMin: -ROOM_PICKING_LIMITS.maxCoordinateMagnitude,
      componentMax: ROOM_PICKING_LIMITS.maxCoordinateMagnitude,
    });
    if (!position.valid) continue;

    let scaleRadius = 1;
    if (transform.scale != null) {
      const scale = vectorValidationReport(transform.scale, {
        dimension: 3,
        componentMin: -ROOM_PICKING_LIMITS.maxScaleMagnitude,
        componentMax: ROOM_PICKING_LIMITS.maxScaleMagnitude,
      });
      if (!scale.valid) continue;
      scaleRadius = Math.max(Math.abs(transform.scale[0]), Math.abs(transform.scale[1]), Math.abs(transform.scale[2]));
    }
    const baseRadius = entry.type === "sphere" ? 0.6 : (entry.type === "plane" ? 1.7 : 1);
    const radius = baseRadius * scaleRadius;
    if (!Number.isFinite(radius) || radius <= 0) continue;
    const hit = raySphere(eye, dir, transform.position, radius);
    if (!hit || !Number.isFinite(hit.t) || hit.t <= admittedOptions.minDistance.value || hit.t > admittedOptions.maxDistance.value) continue;
    if (hit.t < bestDistance) {
      bestDistance = hit.t;
      bestId = entity.value;
    }
  }
  return bestId === null ? null : { entityId: bestId, distance: bestDistance };
}
