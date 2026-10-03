// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Hold-to-grab interaction for the engine's picking demo path.
 *
 * This controller intentionally suspends rigid-body simulation while an entity
 * follows a pick ray. Play-mode force grabs remain owned by PhysicsGrab.js.
 * Rotational handles, collision-aware sweeps, constraints, and throw momentum
 * remain explicit gaps rather than being approximated here.
 */

import { createPhysicsBody } from "../../ecs/components/PhysicsBody.js";
import { createTransform } from "../../ecs/components/Transform.js";
import {
  getEntityComponent,
  setEntityComponent,
  removeEntityComponent,
} from "../../ecs/storage/ArchetypeStorage.js";
import { positiveSafeEntityHandleReport } from "../../ecs/world/World.js";
import { vec3Add, vec3Scale } from "../../core/math/EngineMath.js";
import {
  finiteNumberReport,
  vectorValidationReport,
} from "../../core/math/MathValidation.js";

export const GRAB_CONTROLLER_LIMITS = Object.freeze({
  maxHoldMs: 60000,
  maxDistance: 1e9,
  maxCoordinateMagnitude: 1e12,
  maxDirectionComponent: 1e6,
});

export function grabControllerEntityReport(entityId) {
  const report = positiveSafeEntityHandleReport(entityId);
  return {
    valid: report.valid,
    entityId,
    reason: report.valid ? "valid" : "invalid-entity-id",
    report,
  };
}

export function grabControllerTimingReport(distance, holdMs = 750) {
  const distanceReport = finiteNumberReport(distance, {
    min: 0,
    max: GRAB_CONTROLLER_LIMITS.maxDistance,
  });
  const holdReport = finiteNumberReport(holdMs, {
    min: 0,
    max: GRAB_CONTROLLER_LIMITS.maxHoldMs,
  });
  return {
    valid: distanceReport.valid && holdReport.valid,
    distance: distanceReport,
    holdMs: holdReport,
  };
}

export function grabControllerRayReport(ray, distance) {
  const distanceReport = finiteNumberReport(distance, {
    min: 0,
    max: GRAB_CONTROLLER_LIMITS.maxDistance,
  });
  const eye = vectorValidationReport(ray?.eye, {
    dimension: 3,
    componentMin: -GRAB_CONTROLLER_LIMITS.maxCoordinateMagnitude,
    componentMax: GRAB_CONTROLLER_LIMITS.maxCoordinateMagnitude,
  });
  const direction = vectorValidationReport(ray?.dir, {
    dimension: 3,
    allowZero: false,
    componentMin: -GRAB_CONTROLLER_LIMITS.maxDirectionComponent,
    componentMax: GRAB_CONTROLLER_LIMITS.maxDirectionComponent,
  });
  if (!distanceReport.valid || !eye.valid || !direction.valid) {
    return { valid: false, distance: distanceReport, eye, direction, target: null };
  }

  const target = vec3Add(ray.eye, vec3Scale(ray.dir, distanceReport.value));
  const targetReport = vectorValidationReport(target, {
    dimension: 3,
    componentMin: -GRAB_CONTROLLER_LIMITS.maxCoordinateMagnitude,
    componentMax: GRAB_CONTROLLER_LIMITS.maxCoordinateMagnitude,
  });
  return {
    valid: targetReport.valid,
    distance: distanceReport,
    eye,
    direction,
    target: targetReport.valid ? target : null,
    targetReport,
  };
}

export function createGrabState() {
  return {
    candidateEntityId: null,
    grabbedEntityId: null,
    distance: null,
    holdTimeoutId: null,
    suspendedPhysicsBody: null,
    _candidateToken: 0,
  };
}

export function startGrabCandidate(grabState, ecsWorld, entityId, distance, holdMs = 750) {
  const entity = grabControllerEntityReport(entityId);
  const timing = grabControllerTimingReport(distance, holdMs);
  if (!grabState || !ecsWorld || !entity.valid || !timing.valid || grabState.grabbedEntityId !== null) {
    return false;
  }

  grabState.candidateEntityId = entityId;
  grabState.distance = timing.distance.value;
  if (grabState.holdTimeoutId !== null) {
    clearTimeout(grabState.holdTimeoutId);
    grabState.holdTimeoutId = null;
  }

  grabState._candidateToken = (grabState._candidateToken ?? 0) + 1;
  const candidateToken = grabState._candidateToken;
  grabState.holdTimeoutId = setTimeout(() => {
    grabState.holdTimeoutId = null;
    if (!ecsWorld || grabState.grabbedEntityId !== null || grabState._candidateToken !== candidateToken) {
      return;
    }
    const candidateId = grabState.candidateEntityId;
    if (candidateId == null) return;

    const body = getEntityComponent(ecsWorld, candidateId, "PhysicsBody");
    if (!body) return;

    removeEntityComponent(ecsWorld, candidateId, "PhysicsBody");
    grabState.suspendedPhysicsBody = { entityId: candidateId, body };
    grabState.grabbedEntityId = candidateId;
  }, timing.holdMs.value);
  return true;
}

export function cancelGrabCandidate(grabState) {
  if (!grabState) return false;
  if (grabState.holdTimeoutId !== null) {
    clearTimeout(grabState.holdTimeoutId);
    grabState.holdTimeoutId = null;
  }
  grabState._candidateToken = (grabState._candidateToken ?? 0) + 1;
  grabState.candidateEntityId = null;
  return true;
}

export function releaseGrabbed(grabState, ecsWorld) {
  if (!grabState) return false;
  if (grabState.holdTimeoutId !== null) {
    clearTimeout(grabState.holdTimeoutId);
    grabState.holdTimeoutId = null;
  }
  grabState._candidateToken = (grabState._candidateToken ?? 0) + 1;
  grabState.candidateEntityId = null;

  if (ecsWorld && grabState.grabbedEntityId !== null) {
    const entityId = grabState.grabbedEntityId;
    const transform = getEntityComponent(ecsWorld, entityId, "Transform");
    if (transform) {
      const suspended = grabState.suspendedPhysicsBody;
      const body = suspended?.entityId === entityId && suspended.body
        ? suspended.body
        : createPhysicsBody({ simMode: "dynamic" });
      setEntityComponent(ecsWorld, entityId, "PhysicsBody", body);
    }
  }

  grabState.grabbedEntityId = null;
  grabState.distance = null;
  grabState.suspendedPhysicsBody = null;
  return true;
}

/** Update a grabbed entity position along an admitted pick ray. */
export function updateGrabbedEntity(grabState, ecsWorld, ray) {
  const grabbedId = grabState?.grabbedEntityId;
  const entity = grabControllerEntityReport(grabbedId);
  const rayReport = grabControllerRayReport(ray, grabState?.distance);
  if (!ecsWorld || !entity.valid || !rayReport.valid) return false;

  const transform = getEntityComponent(ecsWorld, grabbedId, "Transform");
  if (!transform) return false;

  const rotation = Array.isArray(transform.rotation) && transform.rotation.length >= 4
    ? [transform.rotation[0], transform.rotation[1], transform.rotation[2], transform.rotation[3]]
    : undefined;
  const scale = Array.isArray(transform.scale) && transform.scale.length >= 3
    ? [transform.scale[0], transform.scale[1], transform.scale[2]]
    : undefined;
  const next = createTransform({
    position: [...rayReport.target],
    rotation,
    scale,
  });
  setEntityComponent(ecsWorld, grabbedId, "Transform", next);
  return true;
}

/** Clear only grab state owned by a deleted entity. */
export function clearGrabForEntity(grabState, entityId) {
  if (!grabState || !grabControllerEntityReport(entityId).valid) return false;

  if (grabState.candidateEntityId === entityId) {
    if (grabState.holdTimeoutId !== null) {
      clearTimeout(grabState.holdTimeoutId);
      grabState.holdTimeoutId = null;
    }
    grabState._candidateToken = (grabState._candidateToken ?? 0) + 1;
    grabState.candidateEntityId = null;
  }
  if (grabState.grabbedEntityId === entityId) {
    grabState.grabbedEntityId = null;
    grabState.distance = null;
    grabState.suspendedPhysicsBody = null;
  }
  return true;
}
