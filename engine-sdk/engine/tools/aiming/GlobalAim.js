// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// GlobalAim.js - shared aiming helpers for player and NPC logic
// Pure math + ECS utilities: no rendering or input side effects.

import { vec3Sub, vec3Normalize, vec3Length } from "../../core/math/EngineMath.js";
import { getEntityComponent } from "../../ecs/storage/ArchetypeStorage.js";

/**
 * Get an entity's world position with an optional vertical offset.
 * Returns null if the entity or Transform is missing.
 */
export function getEntityWorldPosition(ecsWorld, entityId, heightOffset = 0) {
  if (!ecsWorld || entityId == null) return null;
  const transform = getEntityComponent(ecsWorld, entityId, "Transform");
  if (!transform || !Array.isArray(transform.position) || transform.position.length < 3) {
    return null;
  }
  const p = transform.position;
  return [p[0], p[1] + heightOffset, p[2]];
}

/**
 * Compute an aim line from one entity to another.
 *
 * Returns { origin, target, direction, distance } or null if invalid.
 */
export function computeAimBetweenEntities(
  ecsWorld,
  sourceEntityId,
  targetEntityId,
  options = {},
) {
  const srcOffset = Number.isFinite(options.sourceHeightOffset) ? options.sourceHeightOffset : 0;
  const dstOffset = Number.isFinite(options.targetHeightOffset) ? options.targetHeightOffset : 0;
  const maxDistance = Number.isFinite(options.maxDistance) ? options.maxDistance : Infinity;
  const minDistance = Number.isFinite(options.minDistance) ? options.minDistance : 0.01;

  const origin = getEntityWorldPosition(ecsWorld, sourceEntityId, srcOffset);
  const target = getEntityWorldPosition(ecsWorld, targetEntityId, dstOffset);
  if (!origin || !target) return null;

  const toTarget = vec3Sub(target, origin);
  const dist = vec3Length(toTarget);
  if (!Number.isFinite(dist) || dist < minDistance) return null;

  const clampedDist = Math.min(dist, maxDistance);
  const dir = vec3Normalize(toTarget);

  const finalTarget = [
    origin[0] + dir[0] * clampedDist,
    origin[1] + dir[1] * clampedDist,
    origin[2] + dir[2] * clampedDist,
  ];

  return {
    origin,
    target: finalTarget,
    direction: dir,
    distance: clampedDist,
  };
}

/**
 * Compute an aim line from an entity to an arbitrary world-space point.
 */
export function computeAimFromEntityToPoint(
  ecsWorld,
  sourceEntityId,
  worldPoint,
  options = {},
) {
  const srcOffset = Number.isFinite(options.sourceHeightOffset) ? options.sourceHeightOffset : 0;
  const maxDistance = Number.isFinite(options.maxDistance) ? options.maxDistance : Infinity;
  const minDistance = Number.isFinite(options.minDistance) ? options.minDistance : 0.01;

  const origin = getEntityWorldPosition(ecsWorld, sourceEntityId, srcOffset);
  if (!origin || !Array.isArray(worldPoint) || worldPoint.length < 3) return null;

  const toTarget = vec3Sub(worldPoint, origin);
  const dist = vec3Length(toTarget);
  if (!Number.isFinite(dist) || dist < minDistance) return null;

  const clampedDist = Math.min(dist, maxDistance);
  const dir = vec3Normalize(toTarget);

  const finalTarget = [
    origin[0] + dir[0] * clampedDist,
    origin[1] + dir[1] * clampedDist,
    origin[2] + dir[2] * clampedDist,
  ];

  return {
    origin,
    target: finalTarget,
    direction: dir,
    distance: clampedDist,
  };
}
