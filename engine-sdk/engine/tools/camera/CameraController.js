// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CameraController.js - admitted state management around StandardCameraController.
 */

import {
  STANDARD_CAMERA_LIMITS,
  updateStandardCamera,
  getStandardCameraEyeBasis,
  standardCameraBoomReport,
  standardCameraBoundsReport,
  standardCameraFocusReport,
  standardCameraFocusTransitionReport,
  standardCameraStateReport,
  standardCameraUpdateReport,
} from "./StandardCameraController.js";
import { createTransform } from "../../ecs/components/Transform.js";
import { setEntityComponent } from "../../ecs/storage/ArchetypeStorage.js";
import { positiveSafeEntityHandleReport } from "../../ecs/world/World.js";
import { mat4Identity, mat4LookAt, quatRotateVec3, vec3, vec3Length, vec3Sub } from "../../core/math/EngineMath.js";
import { clamp } from "../../core/math/MathScalar.js";
import { finiteNumberReport, vectorValidationReport } from "../../core/math/MathValidation.js";

export const CAMERA_CONTROLLER_LIMITS = Object.freeze({
  maxEntityId: Number.MAX_SAFE_INTEGER,
  maxFocusEntities: 1024,
  maxCompoundColliders: 1024,
});

function primitiveColliderBoundsReport(collider) {
  if (collider === null || typeof collider !== "object") {
    return { valid: false, source: "collider", reason: "invalid-object" };
  }
  const offset = vectorValidationReport(collider.localOffset ?? [0, 0, 0], {
    dimension: 3,
    componentMin: -STANDARD_CAMERA_LIMITS.maxDistance,
    componentMax: STANDARD_CAMERA_LIMITS.maxDistance,
  });
  if (!offset.valid) return { valid: false, source: "collider", offset };
  if (collider.shape === "box") {
    const halfExtents = vectorValidationReport(collider.halfExtents, {
      dimension: 3,
      componentMin: 0,
      componentMax: STANDARD_CAMERA_LIMITS.maxDistance,
    });
    if (!halfExtents.valid) return { valid: false, source: "collider", offset, halfExtents };
    const center = offsetValue(collider.localOffset);
    return {
      valid: true,
      source: "collider-box",
      bounds: {
        min: center.map((value, axis) => value - collider.halfExtents[axis]),
        max: center.map((value, axis) => value + collider.halfExtents[axis]),
      },
    };
  }
  if (collider.shape === "sphere" || collider.shape === "capsule" || collider.shape === "cylinder") {
    const radius = finiteNumberReport(collider.radius, { min: 0, max: STANDARD_CAMERA_LIMITS.maxDistance });
    const halfHeight = collider.shape === "capsule" || collider.shape === "cylinder"
      ? finiteNumberReport(collider.halfHeight, { min: 0, max: STANDARD_CAMERA_LIMITS.maxDistance })
      : { valid: true, value: 0 };
    if (!radius.valid || !halfHeight.valid) {
      return { valid: false, source: "collider", offset, radius, halfHeight };
    }
    const center = offsetValue(collider.localOffset);
    const verticalExtent = collider.shape === "capsule"
      ? radius.value + halfHeight.value
      : halfHeight.value || radius.value;
    const extents = [radius.value, verticalExtent, radius.value];
    return {
      valid: true,
      source: `collider-${collider.shape}`,
      bounds: {
        min: center.map((value, axis) => value - extents[axis]),
        max: center.map((value, axis) => value + extents[axis]),
      },
    };
  }
  return { valid: false, source: "collider", reason: "unsupported-shape" };
}

function offsetValue(value) {
  return Array.from(value ?? [0, 0, 0]);
}

function boundsCorners(bounds) {
  const points = [];
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) points.push([x, y, z]);
    }
  }
  return points;
}

function compoundColliderBoundsReport(collider) {
  const children = collider?.compoundColliders;
  const array = Array.isArray(children);
  const count = array ? children.length : 0;
  const countValid = count > 0 && count <= CAMERA_CONTROLLER_LIMITS.maxCompoundColliders;
  const entries = [];
  const points = [];
  let entriesValid = countValid;
  if (countValid) {
    for (let i = 0; i < count; i++) {
      const child = children[i];
      const primitive = primitiveColliderBoundsReport(child);
      const localRotation = vectorValidationReport(child?.localRotation ?? [0, 0, 0, 1], {
        dimension: 4,
        requireUnit: true,
        tolerance: 1e-3,
      });
      const nested = Array.isArray(child?.compoundColliders);
      const valid = primitive.valid && localRotation.valid && !nested;
      const entry = { valid, primitive, localRotation, nested };
      entries.push(entry);
      if (!valid) {
        entriesValid = false;
        continue;
      }
      const center = offsetValue(child.localOffset);
      const childPoints = boundsCorners(primitive.bounds).map((point) => {
        const relative = point.map((value, axis) => value - center[axis]);
        return quatRotateVec3(relative, child.localRotation ?? [0, 0, 0, 1])
          .map((value, axis) => value + center[axis]);
      });
      entry.points = childPoints;
      points.push(...childPoints);
    }
  }
  const aggregate = entriesValid
    ? standardCameraBoundsReport([{
      min: [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis]))),
      max: [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis]))),
    }])
    : { valid: false };
  return {
    valid: array && countValid && entriesValid && aggregate.valid,
    source: "collider-compound",
    array,
    count,
    countValid,
    entriesValid,
    entries,
    bounds: aggregate.valid ? { min: [...aggregate.min], max: [...aggregate.max] } : null,
    points: aggregate.valid ? points : null,
  };
}

function localFocusBoundsReport(subject) {
  const collider = subject?.collider;
  const meshBounds = subject?.meshBounds;
  const runtimeBounds = subject?.runtimeBounds;
  if (runtimeBounds !== undefined && runtimeBounds !== null) {
    const report = standardCameraBoundsReport([runtimeBounds]);
    return report.valid
      ? { valid: true, source: "runtime-geometry", bounds: { min: [...report.min], max: [...report.max] } }
      : { valid: false, source: "runtime-geometry", report };
  }
  if (collider !== undefined && collider !== null) {
    if (typeof collider !== "object") return { valid: false, source: "collider" };
    if (Array.isArray(collider.compoundColliders) && collider.compoundColliders.length > 0) {
      return compoundColliderBoundsReport(collider);
    }
    const primitive = primitiveColliderBoundsReport(collider);
    if (primitive.valid) return primitive;
    if (collider.shape !== "convexMesh" && collider.shape !== "triangleMesh") return primitive;
  }
  if (meshBounds !== undefined && meshBounds !== null) {
    const report = standardCameraBoundsReport([meshBounds]);
    return report.valid
      ? { valid: true, source: "mesh", bounds: { min: [...report.min], max: [...report.max] } }
      : { valid: false, source: "mesh", report };
  }
  return { valid: true, source: "point", bounds: { min: [0, 0, 0], max: [0, 0, 0] } };
}

function worldBoundsFromLocal(localBounds, transform) {
  const worldPoints = [];
  const localPoints = localBounds.points ?? boundsCorners(localBounds);
  for (const point of localPoints) {
    const scaled = point.map((value, axis) => value * transform.scale[axis]);
    const rotated = quatRotateVec3(scaled, transform.rotation);
    worldPoints.push(rotated.map((value, axis) => value + transform.position[axis]));
  }
  return {
    min: [0, 1, 2].map((axis) => Math.min(...worldPoints.map((point) => point[axis]))),
    max: [0, 1, 2].map((axis) => Math.max(...worldPoints.map((point) => point[axis]))),
  };
}

export function cameraEntityBoundsReport(subjects) {
  const array = Array.isArray(subjects);
  const count = array ? subjects.length : 0;
  const countValid = count > 0 && count <= CAMERA_CONTROLLER_LIMITS.maxFocusEntities;
  const entries = [];
  const worldBounds = [];
  let entriesValid = countValid;
  if (countValid) {
    for (let i = 0; i < count; i++) {
      const subject = subjects[i];
      const object = subject !== null && typeof subject === "object";
      const entity = positiveSafeEntityHandleReport(subject?.entityId);
      const position = vectorValidationReport(subject?.transform?.position, {
        dimension: 3,
        componentMin: -STANDARD_CAMERA_LIMITS.maxWorldCoordinateMagnitude,
        componentMax: STANDARD_CAMERA_LIMITS.maxWorldCoordinateMagnitude,
      });
      const rotation = vectorValidationReport(subject?.transform?.rotation ?? [0, 0, 0, 1], {
        dimension: 4,
        requireUnit: true,
        tolerance: 1e-3,
      });
      const scale = vectorValidationReport(subject?.transform?.scale ?? [1, 1, 1], {
        dimension: 3,
        componentMin: -STANDARD_CAMERA_LIMITS.maxDistance,
        componentMax: STANDARD_CAMERA_LIMITS.maxDistance,
      });
      const local = localFocusBoundsReport(subject);
      const valid = object && entity.valid && position.valid && rotation.valid && scale.valid && local.valid;
      const entry = { valid, object, entity, position, rotation, scale, local };
      entries.push(entry);
      if (!valid) {
        entriesValid = false;
        continue;
      }
      const bounds = worldBoundsFromLocal({ ...local.bounds, points: local.points }, {
        position: Array.from(subject.transform.position),
        rotation: Array.from(subject.transform.rotation ?? [0, 0, 0, 1]),
        scale: Array.from(subject.transform.scale ?? [1, 1, 1]),
      });
      entry.bounds = bounds;
      worldBounds.push(bounds);
    }
  }
  const aggregate = entriesValid ? standardCameraBoundsReport(worldBounds) : { valid: false };
  return {
    valid: array && countValid && entriesValid && aggregate.valid,
    array,
    count,
    countValid,
    entriesValid,
    entries,
    aggregate,
    min: aggregate.valid ? aggregate.min : null,
    max: aggregate.valid ? aggregate.max : null,
    center: aggregate.valid ? aggregate.center : null,
    halfExtents: aggregate.valid ? aggregate.halfExtents : null,
    radius: aggregate.valid ? aggregate.radius : null,
  };
}

function cameraStateFromNested(camera, input = {}) {
  if (!camera || typeof camera !== "object") return null;
  return {
    cameraMode: camera.mode,
    fpPosition: camera.fp?.position,
    fpYaw: camera.fp?.yaw,
    fpPitch: camera.fp?.pitch,
    tpDistance: camera.tp?.distance,
    tpResolvedDistance: camera.tp?.resolvedDistance ?? camera.tp?.distance,
    tpYaw: camera.tp?.yaw,
    tpPitch: camera.tp?.pitch,
    tpTarget: camera.tp?.target,
    movementResponseAxes: camera.movementResponseAxes,
    mouseDeltaX: input?.mouseDeltaX,
    mouseDeltaY: input?.mouseDeltaY,
    lastLogTime: camera.lastLogTime,
  };
}

export function cameraCollisionOptionsReport(options = {}) {
  const config = options?.config ?? {};
  const enabledValue = config.cameraCollisionEnabled ??
    STANDARD_CAMERA_LIMITS.defaultCameraCollisionEnabled;
  const enabledValid = typeof enabledValue === "boolean";
  const query = options?.collisionQuery;
  const queryValid = query === undefined || query === null || typeof query === "function";
  const clearance = finiteNumberReport(
    config.cameraCollisionClearance ?? STANDARD_CAMERA_LIMITS.defaultCameraCollisionClearance,
    { min: 0, max: STANDARD_CAMERA_LIMITS.maxCameraCollisionClearance },
  );
  const targetOffset = finiteNumberReport(
    config.cameraCollisionTargetOffset ?? STANDARD_CAMERA_LIMITS.defaultCameraCollisionTargetOffset,
    { min: 0, max: STANDARD_CAMERA_LIMITS.maxDistance },
  );
  const minDistance = finiteNumberReport(
    config.cameraCollisionMinDistance ?? STANDARD_CAMERA_LIMITS.defaultCameraCollisionMinDistance,
    { min: Number.EPSILON, max: STANDARD_CAMERA_LIMITS.maxDistance },
  );
  const recoverySeconds = finiteNumberReport(
    config.cameraCollisionRecoverySeconds ?? STANDARD_CAMERA_LIMITS.defaultCameraCollisionRecoverySeconds,
    { min: 0, max: STANDARD_CAMERA_LIMITS.maxCameraCollisionRecoverySeconds },
  );
  const valid = enabledValid && queryValid && clearance.valid && targetOffset.valid &&
    minDistance.valid && recoverySeconds.valid;
  return {
    valid,
    enabled: enabledValue === true,
    enabledValid,
    enabledValue,
    queryValid,
    query: typeof query === "function" ? query : null,
    clearance,
    targetOffset,
    minDistance,
    recoverySeconds,
  };
}

export function cameraFocusReport(camera, target, options = {}) {
  const shape = nestedCameraShape(camera);
  const config = options?.config ?? {};
  const canvasAspect = Number(options?.canvas?.clientWidth) / Number(options?.canvas?.clientHeight);
  const focus = standardCameraFocusReport(cameraStateFromNested(camera), target, {
    radius: options?.radius,
    distance: options?.distance,
    padding: options?.padding ?? config.cameraFocusPadding,
    fovRadians: options?.fovRadians ?? camera?.pickFovRadians ?? config.cameraFovRadians,
    aspect: options?.aspect ?? (Number.isFinite(canvasAspect) && canvasAspect > 0 ? canvasAspect : undefined),
    minDistance: options?.minDistance ?? config.cameraMinZoomDistance,
    maxDistance: options?.maxDistance ?? config.cameraMaxZoomDistance,
  });
  const transitionSeconds = finiteNumberReport(
    options?.transitionSeconds ?? config.cameraFocusTransitionSeconds ?? 0,
    { min: 0, max: STANDARD_CAMERA_LIMITS.maxCameraFocusTransitionSeconds },
  );
  return { valid: shape && focus.valid && transitionSeconds.valid, shape, focus, transitionSeconds };
}

export function cameraEntityFocusReport(camera, subjects, options = {}) {
  const bounds = cameraEntityBoundsReport(subjects);
  const focus = bounds.valid
    ? cameraFocusReport(camera, bounds.center, { ...options, radius: bounds.radius })
    : { valid: false };
  return { valid: bounds.valid && focus.valid, bounds, focus };
}

function applyCameraFocus(camera, focus, transitionSeconds) {
  camera.mode = 2;
  if (transitionSeconds > 0) {
    camera.tp.focusTransition = {
      startTarget: [...focus.camera.state.tpTarget],
      startDistance: focus.camera.state.tpDistance,
      goalTarget: [...focus.state.tpTarget],
      goalDistance: focus.state.tpDistance,
      elapsedSeconds: 0,
      durationSeconds: transitionSeconds,
    };
  } else {
    camera.tp.target = [...focus.state.tpTarget];
    camera.tp.distance = focus.state.tpDistance;
    camera.tp.resolvedDistance = focus.state.tpResolvedDistance;
    delete camera.tp.focusTransition;
  }
  camera.tp.collisionActive = false;
  camera.tp.collisionQueryFailed = false;
  camera.tp.collisionObjectId = null;
  camera.movementResponseAxes = [0, 0, 0];
}

export function focusThirdPersonCamera(camera, target, options = {}) {
  const admission = cameraFocusReport(camera, target, options);
  if (!admission.valid) return false;
  applyCameraFocus(camera, admission.focus, admission.transitionSeconds.value);
  globalThis.document?.exitPointerLock?.();
  return true;
}

export function focusThirdPersonCameraOnEntities(camera, subjects, options = {}) {
  const admission = cameraEntityFocusReport(camera, subjects, options);
  if (!admission.valid) return false;
  applyCameraFocus(
    camera,
    admission.focus.focus,
    admission.focus.transitionSeconds.value,
  );
  globalThis.document?.exitPointerLock?.();
  return true;
}

export function cameraFocusTransitionReport(camera, deltaSeconds, options = {}) {
  const shape = nestedCameraShape(camera);
  const transition = shape ? camera.tp.focusTransition : null;
  const cancelled = options?.cancel === true;
  if (transition === undefined || transition === null || cancelled) {
    return {
      valid: shape,
      shape,
      active: false,
      cancelled: shape && cancelled && transition !== undefined && transition !== null,
      step: null,
    };
  }
  const step = standardCameraFocusTransitionReport(transition, deltaSeconds);
  return { valid: shape && step.valid, shape, active: true, cancelled: false, step };
}

function nestedCameraShape(camera) {
  return camera !== null && typeof camera === "object" &&
    camera.fp !== null && typeof camera.fp === "object" &&
    camera.tp !== null && typeof camera.tp === "object";
}

function retainedMatrix(matrix) {
  return vectorValidationReport(matrix, { dimension: 16 }).valid ? matrix : mat4Identity();
}

function retainedCameraMatrices(camera) {
  return { projection: retainedMatrix(camera?.projection), view: retainedMatrix(camera?.view) };
}

export function cameraControllerStepReport(camera, input, options) {
  const object = nestedCameraShape(camera) &&
    input !== null && typeof input === "object" && options !== null && typeof options === "object";
  const canvas = object && options.canvas !== null && typeof options.canvas === "object";
  const config = object && (options.config === undefined ||
    (options.config !== null && typeof options.config === "object"));
  const collision = cameraCollisionOptionsReport(object ? options : {});
  const zoomDelta = options?.zoomDelta ?? input?.zoomDelta ?? 0;
  const zoomAxis = options?.zoomAxis ?? input?.zoomAxis ?? 0;
  const focusTransition = cameraFocusTransitionReport(camera, options?.deltaSeconds, {
    cancel: camera?.mode !== 2 || zoomDelta !== 0 || zoomAxis !== 0,
  });
  const baseState = cameraStateFromNested(camera, input);
  const state = focusTransition.active && focusTransition.step.valid ? {
    ...baseState,
    tpTarget: focusTransition.step.target,
    tpDistance: focusTransition.step.distance,
    tpResolvedDistance: focusTransition.step.distance,
  } : baseState;
  const update = standardCameraUpdateReport(state, {
    width: canvas ? options.canvas.clientWidth : undefined,
    height: canvas ? options.canvas.clientHeight : undefined,
    cameraNear: options?.config?.cameraNear,
    cameraFar: options?.config?.cameraFar,
    fovRadians: options?.fovRadians ?? camera?.pickFovRadians ?? options?.config?.cameraFovRadians,
    mouseSensitivity: options?.config?.cameraMouseSensitivity,
    walkStep: options?.config?.cameraWalkStep,
    sprintStep: options?.config?.cameraSprintStep,
    deltaSeconds: options?.deltaSeconds,
    movementAccelerationSeconds: options?.config?.cameraMovementAccelerationSeconds,
    movementDecelerationSeconds: options?.config?.cameraMovementDecelerationSeconds,
    keys: options?.keys,
    movementAxes: options?.movementAxes ?? input?.movementAxes,
    lookAxes: options?.lookAxes ?? input?.lookAxes,
    gamepadLookRadiansPerSecond: options?.config?.cameraGamepadLookRadiansPerSecond,
    zoomDelta: options?.zoomDelta ?? input?.zoomDelta,
    zoomAxis: options?.zoomAxis ?? input?.zoomAxis,
    zoomWheelSensitivity: options?.config?.cameraZoomWheelSensitivity,
    gamepadZoomRate: options?.config?.cameraGamepadZoomRate,
    minZoomDistance: options?.config?.cameraMinZoomDistance,
    maxZoomDistance: options?.config?.cameraMaxZoomDistance,
    cameraDebugLogging: options?.config?.cameraDebugLogging,
    logger: options?.logger,
  });
  return {
    valid: object && canvas && config && collision.valid && focusTransition.valid && update.valid,
    object,
    canvas,
    config,
    collision,
    focusTransition,
    update,
  };
}

export function stepCamera(camera, input, options = {}) {
  const admission = cameraControllerStepReport(camera, input, options);
  if (!admission.valid) return retainedCameraMatrices(camera);
  const settings = admission.update.options.options;
  if (settings.width === 0 || settings.height === 0) return retainedCameraMatrices(camera);
  const result = updateStandardCamera(admission.update.state.state, settings);
  if (!result?.projection || !result?.view) return retainedCameraMatrices(camera);
  const collision = admission.collision;
  let view = result.view;
  let collisionHit = null;
  let collisionQueryFailed = false;
  let boom = null;
  if (result.cameraMode === 2) {
    const desiredBasis = getStandardCameraEyeBasis({
      ...result,
      tpResolvedDistance: result.tpDistance,
    });
    if (!desiredBasis) return retainedCameraMatrices(camera);
    const boomOptions = {
      currentDistance: camera.tp.resolvedDistance ?? result.tpDistance,
      deltaSeconds: settings.deltaSeconds,
      clearance: collision.clearance.value,
      targetOffset: collision.targetOffset.value,
      minDistance: collision.minDistance.value,
      recoverySeconds: collision.enabled ? collision.recoverySeconds.value : 0,
    };
    const queryPlan = standardCameraBoomReport(result.tpTarget, desiredBasis.eye, null, boomOptions);
    if (!queryPlan.valid) return retainedCameraMatrices(camera);
    if (collision.enabled && collision.query && queryPlan.queryDistance > 0) {
      try {
        collisionHit = collision.query(
          [...queryPlan.queryOrigin],
          [...queryPlan.direction],
          queryPlan.queryDistance,
          {
            target: [...result.tpTarget],
            desiredEye: [...desiredBasis.eye],
            clearance: collision.clearance.value,
            targetOffset: collision.targetOffset.value,
          },
        ) ?? null;
      } catch (_) {
        collisionQueryFailed = true;
        collisionHit = null;
      }
    }
    boom = standardCameraBoomReport(result.tpTarget, desiredBasis.eye, collisionHit, boomOptions);
    if (!boom.valid) return retainedCameraMatrices(camera);
    view = mat4LookAt(boom.eye, result.tpTarget, vec3(0, 1, 0));
  }

  camera.projection = result.projection;
  camera.view = view;
  camera.mode = result.cameraMode;
  camera.fp.position = result.fpPosition;
  camera.fp.yaw = result.fpYaw;
  camera.fp.pitch = result.fpPitch;
  camera.tp.distance = result.tpDistance;
  camera.tp.resolvedDistance = boom?.resolvedDistance ?? result.tpDistance;
  camera.tp.collisionActive = boom?.collisionActive === true;
  camera.tp.collisionQueryFailed = collisionQueryFailed;
  camera.tp.collisionObjectId = boom?.hit?.objectId ?? null;
  camera.tp.yaw = result.tpYaw;
  camera.tp.pitch = result.tpPitch;
  if (camera.tp.target !== undefined || result.tpTarget.some((value, index) =>
    value !== STANDARD_CAMERA_LIMITS.defaultThirdPersonTarget[index])) {
    camera.tp.target = result.tpTarget;
  }
  camera.pickFovRadians = result.fovRadians;
  camera.cameraNear = result.cameraNear;
  camera.cameraFar = result.cameraFar;
  camera.lastDeltaSeconds = result.deltaSeconds;
  camera.movementResponseAxes = result.movementResponseAxes;
  camera.lastLogTime = result.lastLogTime;
  if (admission.focusTransition.cancelled || admission.focusTransition.step?.completed) {
    delete camera.tp.focusTransition;
  } else if (admission.focusTransition.active) {
    camera.tp.focusTransition = {
      ...admission.focusTransition.step.transition,
      startTarget: [...admission.focusTransition.step.transition.startTarget],
      goalTarget: [...admission.focusTransition.step.transition.goalTarget],
    };
  }
  input.mouseDeltaX = 0;
  input.mouseDeltaY = 0;
  input.zoomDelta = 0;
  return { projection: result.projection, view, cameraCollision: boom };
}

export function cameraControllerEntityReport(camera, cameraEntityId) {
  const state = standardCameraStateReport(camera);
  const entity = positiveSafeEntityHandleReport(cameraEntityId);
  const shape = nestedCameraShape(camera);
  return { valid: shape && state.valid && entity.valid, shape, state, entity };
}

export function syncCameraToEcs(camera, ecsWorld, cameraEntityId) {
  const admission = cameraControllerEntityReport(camera, cameraEntityId);
  if (!admission.valid || !ecsWorld) return false;
  const eyeBasis = getStandardCameraEyeBasis(admission.state.state);
  if (!eyeBasis) return false;
  const transform = createTransform({ position: [...eyeBasis.eye] });
  try {
    setEntityComponent(ecsWorld, admission.entity.value, "Transform", transform);
    return true;
  } catch (_) {
    return false;
  }
}

export function updateCameraFull(camera, input, options = {}) {
  const { ecsWorld, cameraEntityId, ...stepOptions } = options;
  const result = stepCamera(camera, input, stepOptions);
  syncCameraToEcs(camera, ecsWorld, cameraEntityId);
  return result;
}

export function cameraModeSwitchReport(camera, mode, options = {}) {
  const state = standardCameraStateReport(camera);
  const nextMode = finiteNumberReport(mode, { integer: true, min: 1, max: 2 });
  const target = options.lookAtTarget === undefined
    ? { valid: true, value: null }
    : {
      ...vectorValidationReport(options.lookAtTarget, {
        dimension: 3,
        componentMin: -STANDARD_CAMERA_LIMITS.maxWorldCoordinateMagnitude,
        componentMax: STANDARD_CAMERA_LIMITS.maxWorldCoordinateMagnitude,
      }),
      value: options.lookAtTarget,
    };
  const shape = nestedCameraShape(camera);
  const focus = nextMode.valid && nextMode.value === 2 && target.valid && target.value
    ? cameraFocusReport(camera, target.value, options)
    : { valid: true, shape, focus: null };
  return {
    valid: shape && state.valid && nextMode.valid && target.valid && focus.valid,
    shape,
    state,
    mode: nextMode,
    target,
    focus,
  };
}

export function switchCameraMode(camera, mode, options = {}) {
  const admission = cameraModeSwitchReport(camera, mode, options);
  if (!admission.valid) return false;
  camera.mode = admission.mode.value;
  camera.movementResponseAxes = [0, 0, 0];
  if (admission.mode.value === 1) delete camera.tp.focusTransition;
  if (admission.mode.value === 1 && admission.target.value) {
    const delta = vec3Sub(admission.target.value, admission.state.state.fpPosition);
    const length = vec3Length(delta);
    if (length > 0.001) {
      camera.fp.yaw = Math.atan2(delta[0], delta[2]);
      camera.fp.pitch = Math.asin(clamp(delta[1] / length, -1, 1));
    }
  }
  if (admission.mode.value === 2 && admission.focus.focus) {
    applyCameraFocus(camera, admission.focus.focus, admission.focus.transitionSeconds.value);
  } else if (admission.mode.value === 2) {
    camera.tp.resolvedDistance = camera.tp.distance;
    camera.tp.collisionActive = false;
    camera.tp.collisionQueryFailed = false;
    camera.tp.collisionObjectId = null;
  }
  if (admission.mode.value === 2) globalThis.document?.exitPointerLock?.();
  return true;
}
