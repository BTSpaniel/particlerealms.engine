// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  vec3,
  vec3Add,
  vec3Sub,
  vec3Scale,
  vec3Cross,
  vec3Length,
  vec3Normalize,
  mat4PerspectiveRadWebGPU,
  mat4LookAt,
} from "../../core/math/EngineMath.js";
import { clamp, damp, lerp, smoothstep } from "../../core/math/MathScalar.js";
import { inputRadialDeadzoneReport } from "../../core/math/InputSignalMath.js";
import { finiteNumberReport, vectorValidationReport } from "../../core/math/MathValidation.js";
import { sceneQueryHitReport } from "../../core/math/SceneQueryMath.js";
import { radiansToDegrees } from "../../core/math/UnitMath.js";

export const STANDARD_CAMERA_LIMITS = Object.freeze({
  defaultFovRadians: Math.PI / 4,
  minFovRadians: Math.PI / 180,
  maxFovRadians: Math.PI * 179 / 180,
  defaultNear: 0.1,
  defaultFar: 100,
  defaultFirstPersonPosition: Object.freeze([0, 2, 10]),
  defaultThirdPersonTarget: Object.freeze([0, 1, 0]),
  defaultThirdPersonDistance: 10,
  defaultThirdPersonPitch: 0.5,
  defaultMouseSensitivity: 0.005,
  defaultGamepadLookRadiansPerSecond: 2.5,
  defaultZoomWheelSensitivity: 0.001,
  defaultGamepadZoomRate: 1.5,
  defaultMinZoomDistance: 1,
  defaultMaxZoomDistance: 1000,
  defaultCameraCollisionEnabled: true,
  defaultCameraCollisionClearance: 0.25,
  defaultCameraCollisionTargetOffset: 0.5,
  defaultCameraCollisionMinDistance: 0.25,
  defaultCameraCollisionRecoverySeconds: 0.1,
  defaultCameraFocusPadding: 1.1,
  defaultCameraFocusTransitionSeconds: 0.25,
  defaultWalkStep: 0.1,
  defaultSprintStep: 0.3,
  defaultDeltaSeconds: 1 / 60,
  defaultMovementAccelerationSeconds: 0,
  defaultMovementDecelerationSeconds: 0,
  referenceFrameRate: 60,
  maxDeltaSeconds: 0.1,
  maxMovementResponseSeconds: 60,
  maxGamepadLookRadiansPerSecond: 20,
  maxZoomWheelSensitivity: 0.1,
  maxGamepadZoomRate: 20,
  maxZoomExponent: 50,
  maxCameraCollisionClearance: 1e6,
  maxCameraCollisionRecoverySeconds: 60,
  maxCameraFocusPadding: 10,
  maxCameraFocusTransitionSeconds: 60,
  maxCameraFocusBounds: 1024,
  minCameraFocusAspect: 1e-6,
  maxCameraFocusAspect: 1e6,
  firstPersonPitchLimit: Math.PI / 2 - 0.01,
  thirdPersonMinPitch: 0.1,
  thirdPersonMaxPitch: Math.PI - 0.1,
  maxViewportDimension: 1e7,
  maxWorldCoordinateMagnitude: 1e12,
  maxDistance: 1e12,
  maxAngleMagnitude: 1e9,
  maxMouseDeltaMagnitude: 1e6,
  maxMovementStep: 1e6,
  maxMovementDistance: 6e6,
});

const STANDARD_CAMERA_MOVEMENT_KEYS = Object.freeze([
  "w", "s", "a", "d", "Shift", "shift", " ", "Control",
]);

function valueOrDefault(value, fallback) {
  return value === undefined || value === null ? fallback : value;
}

function stateValue(state, flatKey, group, nestedKey, fallback) {
  const flat = state?.[flatKey];
  const nested = state?.[group]?.[nestedKey];
  return valueOrDefault(flat !== undefined ? flat : nested, fallback);
}

function vectorOrDefault(value, fallback) {
  return value === undefined || value === null ? [...fallback] : value;
}

export function standardCameraKeysReport(keys = {}) {
  const object = keys !== null && typeof keys === "object" && !Array.isArray(keys);
  const invalidKeys = [];
  if (object) {
    for (const key of STANDARD_CAMERA_MOVEMENT_KEYS) {
      if (keys[key] !== undefined && typeof keys[key] !== "boolean") invalidKeys.push(key);
    }
  }
  return {
    valid: object && invalidKeys.length === 0,
    object,
    invalidKeys,
    keys: object ? keys : null,
  };
}

export function standardCameraMovementResponseReport(currentAxes, targetAxes, options = {}) {
  const vectorOptions = { dimension: 3, componentMin: -1, componentMax: 1 };
  const current = vectorValidationReport(currentAxes, vectorOptions);
  const target = vectorValidationReport(targetAxes, vectorOptions);
  const deltaSeconds = finiteNumberReport(valueOrDefault(
    options?.deltaSeconds, STANDARD_CAMERA_LIMITS.defaultDeltaSeconds,
  ), { min: 0, max: STANDARD_CAMERA_LIMITS.maxDeltaSeconds });
  const accelerationSeconds = finiteNumberReport(valueOrDefault(
    options?.accelerationSeconds, STANDARD_CAMERA_LIMITS.defaultMovementAccelerationSeconds,
  ), { min: 0, max: STANDARD_CAMERA_LIMITS.maxMovementResponseSeconds });
  const decelerationSeconds = finiteNumberReport(valueOrDefault(
    options?.decelerationSeconds, STANDARD_CAMERA_LIMITS.defaultMovementDecelerationSeconds,
  ), { min: 0, max: STANDARD_CAMERA_LIMITS.maxMovementResponseSeconds });
  if (!current.valid || !target.valid || !deltaSeconds.valid ||
      !accelerationSeconds.valid || !decelerationSeconds.valid) {
    return { valid: false, current, target, deltaSeconds, accelerationSeconds, decelerationSeconds };
  }

  const targetMagnitude = vec3Length(targetAxes);
  const accelerating = targetMagnitude > Number.EPSILON;
  const responseSeconds = accelerating ? accelerationSeconds.value : decelerationSeconds.value;
  const instant = responseSeconds === 0;
  const retainedFraction = instant ? 0 : Math.exp(-deltaSeconds.value / responseSeconds);
  const smoothing = instant ? 0 : Math.exp(-1 / responseSeconds);
  const value = instant
    ? Array.from(targetAxes)
    : Array.from(currentAxes, (axis, index) => damp(axis, targetAxes[index], smoothing, deltaSeconds.value));
  const integrationWeight = instant || deltaSeconds.value === 0
    ? 0
    : responseSeconds / deltaSeconds.value * (1 - retainedFraction);
  const averageValue = instant
    ? Array.from(targetAxes)
    : deltaSeconds.value === 0
      ? Array.from(currentAxes)
      : Array.from(targetAxes, (axis, index) => axis + (currentAxes[index] - axis) * integrationWeight);
  const valueReport = vectorValidationReport(value, vectorOptions);
  const averageReport = vectorValidationReport(averageValue, vectorOptions);
  return {
    valid: valueReport.valid && averageReport.valid,
    current,
    target,
    deltaSeconds,
    accelerationSeconds,
    decelerationSeconds,
    accelerating,
    responseSeconds,
    instant,
    retainedFraction,
    blend: 1 - retainedFraction,
    value: Object.freeze(value),
    averageValue: Object.freeze(averageValue),
  };
}

export function standardCameraZoomReport(distance, options = {}) {
  const current = finiteNumberReport(distance, { min: Number.EPSILON, max: STANDARD_CAMERA_LIMITS.maxDistance });
  const deltaSeconds = finiteNumberReport(valueOrDefault(
    options?.deltaSeconds, STANDARD_CAMERA_LIMITS.defaultDeltaSeconds,
  ), { min: 0, max: STANDARD_CAMERA_LIMITS.maxDeltaSeconds });
  const wheelDelta = finiteNumberReport(valueOrDefault(options?.wheelDelta, 0), {
    min: -STANDARD_CAMERA_LIMITS.maxMouseDeltaMagnitude,
    max: STANDARD_CAMERA_LIMITS.maxMouseDeltaMagnitude,
  });
  const zoomAxis = finiteNumberReport(valueOrDefault(options?.zoomAxis, 0), { min: -1, max: 1 });
  const wheelSensitivity = finiteNumberReport(valueOrDefault(
    options?.wheelSensitivity, STANDARD_CAMERA_LIMITS.defaultZoomWheelSensitivity,
  ), { min: 0, max: STANDARD_CAMERA_LIMITS.maxZoomWheelSensitivity });
  const gamepadRate = finiteNumberReport(valueOrDefault(
    options?.gamepadRate, STANDARD_CAMERA_LIMITS.defaultGamepadZoomRate,
  ), { min: 0, max: STANDARD_CAMERA_LIMITS.maxGamepadZoomRate });
  const minDistance = finiteNumberReport(valueOrDefault(
    options?.minDistance, STANDARD_CAMERA_LIMITS.defaultMinZoomDistance,
  ), { min: Number.EPSILON, max: STANDARD_CAMERA_LIMITS.maxDistance });
  const maxDistance = finiteNumberReport(valueOrDefault(
    options?.maxDistance, STANDARD_CAMERA_LIMITS.defaultMaxZoomDistance,
  ), { min: Number.EPSILON, max: STANDARD_CAMERA_LIMITS.maxDistance });
  const ordered = minDistance.valid && maxDistance.valid && maxDistance.value >= minDistance.value;
  const valid = current.valid && deltaSeconds.valid && wheelDelta.valid && zoomAxis.valid &&
    wheelSensitivity.valid && gamepadRate.valid && minDistance.valid && maxDistance.valid && ordered;
  if (!valid) {
    return {
      valid, current, deltaSeconds, wheelDelta, zoomAxis, wheelSensitivity,
      gamepadRate, minDistance, maxDistance, ordered,
    };
  }
  const baseDistance = clamp(current.value, minDistance.value, maxDistance.value);
  const rawExponent = wheelDelta.value * wheelSensitivity.value +
    zoomAxis.value * gamepadRate.value * deltaSeconds.value;
  const exponent = clamp(
    rawExponent, -STANDARD_CAMERA_LIMITS.maxZoomExponent, STANDARD_CAMERA_LIMITS.maxZoomExponent,
  );
  const value = clamp(baseDistance * Math.exp(exponent), minDistance.value, maxDistance.value);
  return {
    valid: Number.isFinite(value),
    current,
    deltaSeconds,
    wheelDelta,
    zoomAxis,
    wheelSensitivity,
    gamepadRate,
    minDistance,
    maxDistance,
    ordered,
    baseDistance,
    rawExponent,
    exponent,
    exponentClamped: exponent !== rawExponent,
    value,
    changed: value !== current.value,
  };
}

export function standardCameraBoomReport(target, desiredEye, hit = null, options = {}) {
  const vectorOptions = {
    dimension: 3,
    componentMin: -STANDARD_CAMERA_LIMITS.maxWorldCoordinateMagnitude,
    componentMax: STANDARD_CAMERA_LIMITS.maxWorldCoordinateMagnitude,
  };
  const targetReport = vectorValidationReport(target, vectorOptions);
  const desiredEyeReport = vectorValidationReport(desiredEye, vectorOptions);
  const deltaSeconds = finiteNumberReport(valueOrDefault(
    options?.deltaSeconds, STANDARD_CAMERA_LIMITS.defaultDeltaSeconds,
  ), { min: 0, max: STANDARD_CAMERA_LIMITS.maxDeltaSeconds });
  const clearance = finiteNumberReport(valueOrDefault(
    options?.clearance, STANDARD_CAMERA_LIMITS.defaultCameraCollisionClearance,
  ), { min: 0, max: STANDARD_CAMERA_LIMITS.maxCameraCollisionClearance });
  const targetOffset = finiteNumberReport(valueOrDefault(
    options?.targetOffset, STANDARD_CAMERA_LIMITS.defaultCameraCollisionTargetOffset,
  ), { min: 0, max: STANDARD_CAMERA_LIMITS.maxDistance });
  const minDistance = finiteNumberReport(valueOrDefault(
    options?.minDistance, STANDARD_CAMERA_LIMITS.defaultCameraCollisionMinDistance,
  ), { min: Number.EPSILON, max: STANDARD_CAMERA_LIMITS.maxDistance });
  const recoverySeconds = finiteNumberReport(valueOrDefault(
    options?.recoverySeconds, STANDARD_CAMERA_LIMITS.defaultCameraCollisionRecoverySeconds,
  ), { min: 0, max: STANDARD_CAMERA_LIMITS.maxCameraCollisionRecoverySeconds });
  const desiredDelta = targetReport.valid && desiredEyeReport.valid
    ? vec3Sub(desiredEye, target)
    : [0, 0, 0];
  const desiredDistance = finiteNumberReport(vec3Length(desiredDelta), {
    min: Number.EPSILON,
    max: STANDARD_CAMERA_LIMITS.maxDistance,
  });
  const currentDistance = finiteNumberReport(valueOrDefault(
    options?.currentDistance, desiredDistance.value,
  ), { min: Number.EPSILON, max: STANDARD_CAMERA_LIMITS.maxDistance });
  const geometryValid = targetReport.valid && desiredEyeReport.valid && desiredDistance.valid;
  const validOptions = deltaSeconds.valid && clearance.valid && targetOffset.valid &&
    minDistance.valid && recoverySeconds.valid && currentDistance.valid;
  if (!geometryValid || !validOptions) {
    return {
      valid: false,
      target: targetReport,
      desiredEye: desiredEyeReport,
      desiredDistance,
      currentDistance,
      deltaSeconds,
      clearance,
      targetOffset,
      minDistance,
      recoverySeconds,
      hit: null,
    };
  }

  const targetValue = Array.from(target);
  const direction = vec3Scale(desiredDelta, 1 / desiredDistance.value);
  const appliedTargetOffset = Math.min(targetOffset.value, desiredDistance.value);
  const queryOrigin = vec3Add(targetValue, vec3Scale(direction, appliedTargetOffset));
  const queryDistance = desiredDistance.value - appliedTargetOffset;
  const hasHit = hit !== null && hit !== undefined;
  const hitReport = hasHit
    ? sceneQueryHitReport(hit, { minDistance: 0, maxDistance: queryDistance })
    : null;
  if (hasHit && !hitReport.valid) {
    return {
      valid: false,
      target: targetReport,
      desiredEye: desiredEyeReport,
      desiredDistance,
      currentDistance,
      deltaSeconds,
      clearance,
      targetOffset,
      minDistance,
      recoverySeconds,
      direction,
      queryOrigin,
      queryDistance,
      hit: hitReport,
    };
  }

  const blocking = Boolean(hitReport?.blocking) && queryDistance > 0;
  const minimum = Math.min(minDistance.value, desiredDistance.value);
  const collisionDistance = blocking
    ? clamp(
      appliedTargetOffset + hitReport.distance - clearance.value,
      minimum,
      desiredDistance.value,
    )
    : desiredDistance.value;
  const current = clamp(currentDistance.value, minimum, desiredDistance.value);
  const retracting = collisionDistance < current;
  const recovering = collisionDistance > current;
  const instantRecovery = recoverySeconds.value === 0;
  const value = retracting || instantRecovery
    ? collisionDistance
    : recovering
      ? damp(
        current,
        collisionDistance,
        Math.exp(-1 / recoverySeconds.value),
        deltaSeconds.value,
      )
      : current;
  const resolvedDistance = clamp(value, minimum, desiredDistance.value);
  const eye = vec3Add(targetValue, vec3Scale(direction, resolvedDistance));
  const eyeReport = vectorValidationReport(eye, vectorOptions);
  return {
    valid: eyeReport.valid && Number.isFinite(resolvedDistance),
    target: targetReport,
    desiredEye: desiredEyeReport,
    desiredDistance,
    currentDistance,
    deltaSeconds,
    clearance,
    targetOffset,
    minDistance,
    recoverySeconds,
    direction: Object.freeze(direction),
    queryOrigin: Object.freeze(queryOrigin),
    queryDistance,
    hit: hitReport,
    blocking,
    collisionActive: blocking && collisionDistance < desiredDistance.value,
    collisionDistance,
    retracting,
    recovering,
    instantRecovery,
    resolvedDistance,
    eye: Object.freeze(eye),
  };
}

export function standardCameraMovementIntentReport(
  keys, yaw, distance, movementAxes = [0, 0, 0], responseOptions = {},
) {
  const keyReport = standardCameraKeysReport(keys);
  const yawReport = finiteNumberReport(yaw, {
    min: -STANDARD_CAMERA_LIMITS.maxAngleMagnitude,
    max: STANDARD_CAMERA_LIMITS.maxAngleMagnitude,
  });
  const distanceReport = finiteNumberReport(distance, {
    min: 0,
    max: STANDARD_CAMERA_LIMITS.maxMovementDistance,
  });
  const analogAxes = vectorValidationReport(movementAxes, {
    dimension: 3,
    componentMin: -1,
    componentMax: 1,
  });
  if (!keyReport.valid || !yawReport.valid || !distanceReport.valid || !analogAxes.valid) {
    return { valid: false, keys: keyReport, yaw: yawReport, distance: distanceReport, analogAxes };
  }

  const forwardAxis = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
  const rightAxis = (keys.a ? 1 : 0) - (keys.d ? 1 : 0);
  const verticalAxis = (keys[" "] ? 1 : 0) - (keys.Control ? 1 : 0);
  const digitalAxes = Object.freeze([rightAxis, verticalAxis, forwardAxis]);
  const combinedAxesRaw = digitalAxes.map((value, index) => value + movementAxes[index]);
  const combinedAxes = combinedAxesRaw.map((value) => clamp(value, -1, 1));
  const shapedAxes = inputRadialDeadzoneReport(combinedAxes, {
    dimension: 3,
    deadzone: 0,
    outerDeadzone: 0,
    gamma: 1,
  });
  if (!shapedAxes.valid) {
    return { valid: false, keys: keyReport, yaw: yawReport, distance: distanceReport, analogAxes, shapedAxes };
  }
  const response = standardCameraMovementResponseReport(
    responseOptions?.currentAxes ?? shapedAxes.value,
    shapedAxes.value,
    responseOptions,
  );
  if (!response.valid) {
    return { valid: false, keys: keyReport, yaw: yawReport, distance: distanceReport, analogAxes, shapedAxes, response };
  }
  const [combinedRight, combinedVertical, combinedForward] = response.averageValue;
  const forward = vec3(Math.sin(yawReport.value), 0, Math.cos(yawReport.value));
  const right = vec3(Math.cos(yawReport.value), 0, -Math.sin(yawReport.value));
  let raw = vec3Add(vec3Scale(forward, combinedForward), vec3Scale(right, combinedRight));
  raw = vec3Add(raw, vec3(0, combinedVertical, 0));
  const rawMagnitude = vec3Length(raw);
  const delta = vec3Scale(raw, distanceReport.value);
  return {
    valid: vectorValidationReport(delta, { dimension: 3 }).valid,
    keys: keyReport,
    yaw: yawReport,
    distance: distanceReport,
    axes: response.value,
    appliedAxes: response.averageValue,
    targetAxes: shapedAxes.value,
    digitalAxes,
    analogAxes: Object.freeze(Array.from(movementAxes)),
    combinedAxesRaw: Object.freeze(combinedAxesRaw),
    combinedAxes: Object.freeze(combinedAxes),
    activeAxisCount: response.value.filter((value) => value !== 0).length,
    rawMagnitude,
    normalized: shapedAxes.normalized,
    direction: raw,
    shapedAxes,
    response,
    delta,
    distanceApplied: vec3Length(delta),
  };
}

export function standardCameraStateReport(state) {
  const object = state !== null && typeof state === "object";
  const modeValue = state?.cameraMode ?? state?.mode;
  const mode = finiteNumberReport(modeValue, { integer: true, min: 1, max: 2 });
  const positionValue = vectorOrDefault(
    state?.fpPosition !== undefined ? state.fpPosition : state?.fp?.position,
    STANDARD_CAMERA_LIMITS.defaultFirstPersonPosition,
  );
  const targetValue = vectorOrDefault(
    state?.tpTarget !== undefined ? state.tpTarget : state?.tp?.target,
    STANDARD_CAMERA_LIMITS.defaultThirdPersonTarget,
  );
  const vectorOptions = {
    dimension: 3,
    componentMin: -STANDARD_CAMERA_LIMITS.maxWorldCoordinateMagnitude,
    componentMax: STANDARD_CAMERA_LIMITS.maxWorldCoordinateMagnitude,
  };
  const fpPosition = vectorValidationReport(positionValue, vectorOptions);
  const tpTarget = vectorValidationReport(targetValue, vectorOptions);
  const movementResponseValue = vectorOrDefault(state?.movementResponseAxes, [0, 0, 0]);
  const movementResponseAxes = vectorValidationReport(movementResponseValue, {
    dimension: 3,
    componentMin: -1,
    componentMax: 1,
  });
  const angleOptions = {
    min: -STANDARD_CAMERA_LIMITS.maxAngleMagnitude,
    max: STANDARD_CAMERA_LIMITS.maxAngleMagnitude,
  };
  const fpYaw = finiteNumberReport(stateValue(state, "fpYaw", "fp", "yaw", 0), angleOptions);
  const fpPitch = finiteNumberReport(stateValue(state, "fpPitch", "fp", "pitch", 0), angleOptions);
  const tpDistance = finiteNumberReport(stateValue(
    state, "tpDistance", "tp", "distance", STANDARD_CAMERA_LIMITS.defaultThirdPersonDistance,
  ), { min: Number.EPSILON, max: STANDARD_CAMERA_LIMITS.maxDistance });
  const tpResolvedDistance = finiteNumberReport(valueOrDefault(
    state?.tpResolvedDistance ?? state?.tp?.resolvedDistance,
    stateValue(state, "tpDistance", "tp", "distance", STANDARD_CAMERA_LIMITS.defaultThirdPersonDistance),
  ), { min: Number.EPSILON, max: STANDARD_CAMERA_LIMITS.maxDistance });
  const tpYaw = finiteNumberReport(stateValue(state, "tpYaw", "tp", "yaw", 0), angleOptions);
  const tpPitch = finiteNumberReport(stateValue(
    state, "tpPitch", "tp", "pitch", STANDARD_CAMERA_LIMITS.defaultThirdPersonPitch,
  ), angleOptions);
  const mouseDeltaX = finiteNumberReport(valueOrDefault(state?.mouseDeltaX, 0), {
    min: -STANDARD_CAMERA_LIMITS.maxMouseDeltaMagnitude,
    max: STANDARD_CAMERA_LIMITS.maxMouseDeltaMagnitude,
  });
  const mouseDeltaY = finiteNumberReport(valueOrDefault(state?.mouseDeltaY, 0), {
    min: -STANDARD_CAMERA_LIMITS.maxMouseDeltaMagnitude,
    max: STANDARD_CAMERA_LIMITS.maxMouseDeltaMagnitude,
  });
  const lastLogTime = state?.lastLogTime === undefined || state?.lastLogTime === null
    ? { valid: true, value: null }
    : finiteNumberReport(state.lastLogTime, { min: 0, max: Number.MAX_SAFE_INTEGER });
  const valid = object && mode.valid && fpPosition.valid && tpTarget.valid && fpYaw.valid && fpPitch.valid &&
    tpDistance.valid && tpResolvedDistance.valid && tpYaw.valid && tpPitch.valid && movementResponseAxes.valid &&
    mouseDeltaX.valid && mouseDeltaY.valid && lastLogTime.valid;
  return {
    valid,
    object,
    mode,
    fpPosition,
    fpYaw,
    fpPitch,
    tpDistance,
    tpResolvedDistance,
    tpYaw,
    tpPitch,
    tpTarget,
    movementResponseAxes,
    mouseDeltaX,
    mouseDeltaY,
    lastLogTime,
    state: valid ? {
      cameraMode: mode.value,
      fpPosition: Array.from(positionValue),
      fpYaw: fpYaw.value,
      fpPitch: fpPitch.value,
      tpDistance: tpDistance.value,
      tpResolvedDistance: tpResolvedDistance.value,
      tpYaw: tpYaw.value,
      tpPitch: tpPitch.value,
      tpTarget: Array.from(targetValue),
      movementResponseAxes: Array.from(movementResponseValue),
      mouseDeltaX: mouseDeltaX.value,
      mouseDeltaY: mouseDeltaY.value,
      lastLogTime: lastLogTime.value,
    } : null,
  };
}

export function standardCameraSphereFitReport(radius, options = {}) {
  const radiusReport = finiteNumberReport(radius, { min: 0, max: STANDARD_CAMERA_LIMITS.maxDistance });
  const padding = finiteNumberReport(valueOrDefault(
    options?.padding, STANDARD_CAMERA_LIMITS.defaultCameraFocusPadding,
  ), { min: 1, max: STANDARD_CAMERA_LIMITS.maxCameraFocusPadding });
  const fovRadians = finiteNumberReport(valueOrDefault(
    options?.fovRadians, STANDARD_CAMERA_LIMITS.defaultFovRadians,
  ), { min: STANDARD_CAMERA_LIMITS.minFovRadians, max: STANDARD_CAMERA_LIMITS.maxFovRadians });
  const aspect = finiteNumberReport(valueOrDefault(options?.aspect, 1), {
    min: STANDARD_CAMERA_LIMITS.minCameraFocusAspect,
    max: STANDARD_CAMERA_LIMITS.maxCameraFocusAspect,
  });
  const minDistance = finiteNumberReport(valueOrDefault(
    options?.minDistance, STANDARD_CAMERA_LIMITS.defaultMinZoomDistance,
  ), { min: Number.EPSILON, max: STANDARD_CAMERA_LIMITS.maxDistance });
  const maxDistance = finiteNumberReport(valueOrDefault(
    options?.maxDistance, STANDARD_CAMERA_LIMITS.defaultMaxZoomDistance,
  ), { min: Number.EPSILON, max: STANDARD_CAMERA_LIMITS.maxDistance });
  const ordered = minDistance.valid && maxDistance.valid && maxDistance.value >= minDistance.value;
  const valid = radiusReport.valid && padding.valid && fovRadians.valid && aspect.valid &&
    minDistance.valid && maxDistance.valid && ordered;
  if (!valid) {
    return {
      valid,
      radius: radiusReport,
      padding,
      fovRadians,
      aspect,
      minDistance,
      maxDistance,
      ordered,
    };
  }

  const verticalHalfFov = fovRadians.value / 2;
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * aspect.value);
  const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov);
  const paddedRadius = radiusReport.value * padding.value;
  const fittedDistance = paddedRadius / Math.sin(limitingHalfFov);
  const value = clamp(fittedDistance, minDistance.value, maxDistance.value);
  return {
    valid: Number.isFinite(value),
    radius: radiusReport,
    padding,
    fovRadians,
    aspect,
    minDistance,
    maxDistance,
    ordered,
    verticalHalfFov,
    horizontalHalfFov,
    limitingHalfFov,
    paddedRadius,
    fittedDistance,
    value,
    clamped: value !== fittedDistance,
  };
}

export function standardCameraBoundsReport(bounds) {
  const array = Array.isArray(bounds);
  const count = array ? bounds.length : 0;
  const countValid = count > 0 && count <= STANDARD_CAMERA_LIMITS.maxCameraFocusBounds;
  const entries = [];
  let aggregateMin = [Infinity, Infinity, Infinity];
  let aggregateMax = [-Infinity, -Infinity, -Infinity];
  let entriesValid = countValid;
  if (countValid) {
    for (let i = 0; i < count; i++) {
      const object = bounds[i] !== null && typeof bounds[i] === "object";
      const min = vectorValidationReport(bounds[i]?.min, {
        dimension: 3,
        componentMin: -STANDARD_CAMERA_LIMITS.maxWorldCoordinateMagnitude,
        componentMax: STANDARD_CAMERA_LIMITS.maxWorldCoordinateMagnitude,
      });
      const max = vectorValidationReport(bounds[i]?.max, {
        dimension: 3,
        componentMin: -STANDARD_CAMERA_LIMITS.maxWorldCoordinateMagnitude,
        componentMax: STANDARD_CAMERA_LIMITS.maxWorldCoordinateMagnitude,
      });
      const ordered = min.valid && max.valid && bounds[i].min.every((value, axis) => value <= bounds[i].max[axis]);
      const valid = object && min.valid && max.valid && ordered;
      entries.push({ valid, object, min, max, ordered });
      if (!valid) {
        entriesValid = false;
        continue;
      }
      for (let axis = 0; axis < 3; axis++) {
        aggregateMin[axis] = Math.min(aggregateMin[axis], bounds[i].min[axis]);
        aggregateMax[axis] = Math.max(aggregateMax[axis], bounds[i].max[axis]);
      }
    }
  }
  const valid = array && countValid && entriesValid;
  if (!valid) return { valid, array, count, countValid, entriesValid, entries };
  const center = aggregateMin.map((value, axis) => (value + aggregateMax[axis]) / 2);
  const halfExtents = aggregateMin.map((value, axis) => (aggregateMax[axis] - value) / 2);
  const radius = Math.hypot(...halfExtents);
  return {
    valid: center.every(Number.isFinite) && halfExtents.every(Number.isFinite) && Number.isFinite(radius),
    array,
    count,
    countValid,
    entriesValid,
    entries,
    min: Object.freeze(aggregateMin),
    max: Object.freeze(aggregateMax),
    center: Object.freeze(center),
    halfExtents: Object.freeze(halfExtents),
    radius,
  };
}

export function standardCameraBoundsFocusReport(bounds, options = {}) {
  const aggregate = standardCameraBoundsReport(bounds);
  const fit = aggregate.valid
    ? standardCameraSphereFitReport(aggregate.radius, options)
    : { valid: false };
  return {
    valid: aggregate.valid && fit.valid,
    aggregate,
    fit,
    target: aggregate.valid ? aggregate.center : null,
    radius: aggregate.valid ? aggregate.radius : null,
    distance: fit.valid ? fit.value : null,
  };
}

export function standardCameraFocusReport(state, target, options = {}) {
  const camera = standardCameraStateReport(state);
  const targetReport = vectorValidationReport(target, {
    dimension: 3,
    componentMin: -STANDARD_CAMERA_LIMITS.maxWorldCoordinateMagnitude,
    componentMax: STANDARD_CAMERA_LIMITS.maxWorldCoordinateMagnitude,
  });
  const radiusProvided = options?.radius !== undefined && options?.radius !== null;
  const distanceProvided = options?.distance !== undefined && options?.distance !== null;
  const fit = standardCameraSphereFitReport(radiusProvided ? options.radius : 0, options);
  const radius = radiusProvided ? fit.radius : { valid: true, value: null };
  const distance = distanceProvided
    ? finiteNumberReport(options.distance, {
      min: Number.EPSILON,
      max: STANDARD_CAMERA_LIMITS.maxDistance,
    })
    : { valid: true, value: null };
  const valid = camera.valid && targetReport.valid && radius.valid && distance.valid && fit.valid;
  if (!valid) {
    return {
      valid,
      camera,
      target: targetReport,
      radius,
      distance,
      padding: fit.padding,
      fovRadians: fit.fovRadians,
      aspect: fit.aspect,
      minDistance: fit.minDistance,
      maxDistance: fit.maxDistance,
      ordered: fit.ordered,
    };
  }
  const fittedDistance = radiusProvided ? fit.fittedDistance : camera.state.tpDistance;
  const requestedDistance = distanceProvided ? distance.value : fittedDistance;
  const value = clamp(requestedDistance, fit.minDistance.value, fit.maxDistance.value);
  const distanceSource = distanceProvided ? "explicit" : radiusProvided ? "sphere-fit" : "retained";
  return {
    valid: Number.isFinite(value),
    camera,
    target: targetReport,
    radius,
    distance,
    padding: fit.padding,
    fovRadians: fit.fovRadians,
    aspect: fit.aspect,
    minDistance: fit.minDistance,
    maxDistance: fit.maxDistance,
    ordered: fit.ordered,
    verticalHalfFov: fit.verticalHalfFov,
    horizontalHalfFov: fit.horizontalHalfFov,
    limitingHalfFov: fit.limitingHalfFov,
    paddedRadius: radiusProvided ? fit.paddedRadius : null,
    fittedDistance,
    requestedDistance,
    distanceSource,
    value,
    clamped: value !== requestedDistance,
    state: {
      ...camera.state,
      cameraMode: 2,
      tpTarget: Object.freeze(Array.from(target)),
      tpDistance: value,
      tpResolvedDistance: value,
      movementResponseAxes: Object.freeze([0, 0, 0]),
    },
  };
}

export function standardCameraFocusTransitionReport(transition, deltaSeconds) {
  const object = transition !== null && typeof transition === "object";
  const startTarget = vectorValidationReport(transition?.startTarget, {
    dimension: 3,
    componentMin: -STANDARD_CAMERA_LIMITS.maxWorldCoordinateMagnitude,
    componentMax: STANDARD_CAMERA_LIMITS.maxWorldCoordinateMagnitude,
  });
  const goalTarget = vectorValidationReport(transition?.goalTarget, {
    dimension: 3,
    componentMin: -STANDARD_CAMERA_LIMITS.maxWorldCoordinateMagnitude,
    componentMax: STANDARD_CAMERA_LIMITS.maxWorldCoordinateMagnitude,
  });
  const startDistance = finiteNumberReport(transition?.startDistance, {
    min: Number.EPSILON,
    max: STANDARD_CAMERA_LIMITS.maxDistance,
  });
  const goalDistance = finiteNumberReport(transition?.goalDistance, {
    min: Number.EPSILON,
    max: STANDARD_CAMERA_LIMITS.maxDistance,
  });
  const elapsedSeconds = finiteNumberReport(transition?.elapsedSeconds, {
    min: 0,
    max: STANDARD_CAMERA_LIMITS.maxCameraFocusTransitionSeconds,
  });
  const durationSeconds = finiteNumberReport(transition?.durationSeconds, {
    min: 0,
    max: STANDARD_CAMERA_LIMITS.maxCameraFocusTransitionSeconds,
  });
  const delta = finiteNumberReport(valueOrDefault(
    deltaSeconds, STANDARD_CAMERA_LIMITS.defaultDeltaSeconds,
  ), { min: 0, max: STANDARD_CAMERA_LIMITS.maxDeltaSeconds });
  const ordered = elapsedSeconds.valid && durationSeconds.valid &&
    elapsedSeconds.value <= durationSeconds.value;
  const valid = object && startTarget.valid && goalTarget.valid && startDistance.valid &&
    goalDistance.valid && elapsedSeconds.valid && durationSeconds.valid && delta.valid && ordered;
  if (!valid) {
    return {
      valid,
      object,
      startTarget,
      goalTarget,
      startDistance,
      goalDistance,
      elapsedSeconds,
      durationSeconds,
      delta,
      ordered,
    };
  }

  const candidateElapsed = Math.min(durationSeconds.value, elapsedSeconds.value + delta.value);
  const completionTolerance = Math.max(1, durationSeconds.value) * 1e-12;
  const nextElapsed = durationSeconds.value - candidateElapsed <= completionTolerance
    ? durationSeconds.value
    : candidateElapsed;
  const progress = durationSeconds.value === 0 ? 1 : nextElapsed / durationSeconds.value;
  const easedProgress = smoothstep(0, 1, progress);
  const startTargetValue = Array.from(transition.startTarget);
  const goalTargetValue = Array.from(transition.goalTarget);
  const target = startTargetValue.map((value, index) =>
    lerp(value, goalTargetValue[index], easedProgress));
  const distance = lerp(startDistance.value, goalDistance.value, easedProgress);
  const completed = progress === 1;
  return {
    valid: target.every(Number.isFinite) && Number.isFinite(distance),
    object,
    startTarget,
    goalTarget,
    startDistance,
    goalDistance,
    elapsedSeconds,
    durationSeconds,
    delta,
    ordered,
    elapsed: nextElapsed,
    progress,
    easedProgress,
    target: Object.freeze(target),
    distance,
    completed,
    transition: Object.freeze({
      startTarget: Object.freeze(startTargetValue),
      startDistance: startDistance.value,
      goalTarget: Object.freeze(goalTargetValue),
      goalDistance: goalDistance.value,
      elapsedSeconds: nextElapsed,
      durationSeconds: durationSeconds.value,
    }),
  };
}

export function standardCameraOptionsReport(options) {
  const object = options !== null && typeof options === "object";
  const width = finiteNumberReport(options?.width, { min: 0, max: STANDARD_CAMERA_LIMITS.maxViewportDimension });
  const height = finiteNumberReport(options?.height, { min: 0, max: STANDARD_CAMERA_LIMITS.maxViewportDimension });
  const near = finiteNumberReport(valueOrDefault(options?.cameraNear, STANDARD_CAMERA_LIMITS.defaultNear), {
    min: Number.EPSILON,
    max: STANDARD_CAMERA_LIMITS.maxDistance,
  });
  const far = finiteNumberReport(valueOrDefault(options?.cameraFar, STANDARD_CAMERA_LIMITS.defaultFar), {
    min: Number.EPSILON,
    max: STANDARD_CAMERA_LIMITS.maxDistance,
  });
  const fovRadians = finiteNumberReport(valueOrDefault(
    options?.fovRadians, STANDARD_CAMERA_LIMITS.defaultFovRadians,
  ), { min: STANDARD_CAMERA_LIMITS.minFovRadians, max: STANDARD_CAMERA_LIMITS.maxFovRadians });
  const mouseSensitivity = finiteNumberReport(valueOrDefault(
    options?.mouseSensitivity, STANDARD_CAMERA_LIMITS.defaultMouseSensitivity,
  ), { min: 0, max: 1 });
  const walkStep = finiteNumberReport(valueOrDefault(options?.walkStep, STANDARD_CAMERA_LIMITS.defaultWalkStep), {
    min: 0,
    max: STANDARD_CAMERA_LIMITS.maxMovementStep,
  });
  const sprintStep = finiteNumberReport(valueOrDefault(options?.sprintStep, STANDARD_CAMERA_LIMITS.defaultSprintStep), {
    min: 0,
    max: STANDARD_CAMERA_LIMITS.maxMovementStep,
  });
  const deltaSeconds = finiteNumberReport(valueOrDefault(
    options?.deltaSeconds, STANDARD_CAMERA_LIMITS.defaultDeltaSeconds,
  ), { min: 0, max: STANDARD_CAMERA_LIMITS.maxDeltaSeconds });
  const movementAccelerationSeconds = finiteNumberReport(valueOrDefault(
    options?.movementAccelerationSeconds, STANDARD_CAMERA_LIMITS.defaultMovementAccelerationSeconds,
  ), { min: 0, max: STANDARD_CAMERA_LIMITS.maxMovementResponseSeconds });
  const movementDecelerationSeconds = finiteNumberReport(valueOrDefault(
    options?.movementDecelerationSeconds, STANDARD_CAMERA_LIMITS.defaultMovementDecelerationSeconds,
  ), { min: 0, max: STANDARD_CAMERA_LIMITS.maxMovementResponseSeconds });
  const keys = standardCameraKeysReport(options?.keys ?? {});
  const movementAxes = vectorValidationReport(options?.movementAxes ?? [0, 0, 0], {
    dimension: 3,
    componentMin: -1,
    componentMax: 1,
  });
  const lookAxes = vectorValidationReport(options?.lookAxes ?? [0, 0], {
    dimension: 2,
    componentMin: -1,
    componentMax: 1,
  });
  const gamepadLookRadiansPerSecond = finiteNumberReport(valueOrDefault(
    options?.gamepadLookRadiansPerSecond, STANDARD_CAMERA_LIMITS.defaultGamepadLookRadiansPerSecond,
  ), { min: 0, max: STANDARD_CAMERA_LIMITS.maxGamepadLookRadiansPerSecond });
  const zoom = standardCameraZoomReport(STANDARD_CAMERA_LIMITS.defaultThirdPersonDistance, {
    deltaSeconds: deltaSeconds.value,
    wheelDelta: options?.zoomDelta,
    zoomAxis: options?.zoomAxis,
    wheelSensitivity: options?.zoomWheelSensitivity,
    gamepadRate: options?.gamepadZoomRate,
    minDistance: options?.minZoomDistance,
    maxDistance: options?.maxZoomDistance,
  });
  const orderedClip = near.valid && far.valid && far.value > near.value;
  const valid = object && width.valid && height.valid && near.valid && far.valid && fovRadians.valid &&
    mouseSensitivity.valid && walkStep.valid && sprintStep.valid && deltaSeconds.valid &&
    movementAccelerationSeconds.valid && movementDecelerationSeconds.valid && keys.valid &&
    movementAxes.valid && lookAxes.valid && gamepadLookRadiansPerSecond.valid && zoom.valid && orderedClip;
  return {
    valid,
    object,
    width,
    height,
    near,
    far,
    fovRadians,
    mouseSensitivity,
    walkStep,
    sprintStep,
    deltaSeconds,
    movementAccelerationSeconds,
    movementDecelerationSeconds,
    keys,
    movementAxes,
    lookAxes,
    gamepadLookRadiansPerSecond,
    zoom,
    orderedClip,
    options: valid ? {
      width: width.value,
      height: height.value,
      cameraNear: near.value,
      cameraFar: far.value,
      fovRadians: fovRadians.value,
      mouseSensitivity: mouseSensitivity.value,
      walkStep: walkStep.value,
      sprintStep: sprintStep.value,
      deltaSeconds: deltaSeconds.value,
      movementAccelerationSeconds: movementAccelerationSeconds.value,
      movementDecelerationSeconds: movementDecelerationSeconds.value,
      movementScale: deltaSeconds.value * STANDARD_CAMERA_LIMITS.referenceFrameRate,
      keys: keys.keys,
      movementAxes: Array.from(options?.movementAxes ?? [0, 0, 0]),
      lookAxes: Array.from(options?.lookAxes ?? [0, 0]),
      gamepadLookRadiansPerSecond: gamepadLookRadiansPerSecond.value,
      zoomDelta: zoom.wheelDelta.value,
      zoomAxis: zoom.zoomAxis.value,
      zoomWheelSensitivity: zoom.wheelSensitivity.value,
      gamepadZoomRate: zoom.gamepadRate.value,
      minZoomDistance: zoom.minDistance.value,
      maxZoomDistance: zoom.maxDistance.value,
      cameraDebugLogging: options.cameraDebugLogging === true,
      logger: options.logger ?? null,
    } : null,
  };
}

export function standardCameraUpdateReport(state, options) {
  const stateReport = standardCameraStateReport(state);
  const optionsReport = standardCameraOptionsReport(options);
  return { valid: stateReport.valid && optionsReport.valid, state: stateReport, options: optionsReport };
}

function cameraResult(state, options, projection, view, lastLogTime = state.lastLogTime, movementIntent = null) {
  return {
    projection,
    view,
    cameraMode: state.cameraMode,
    fpPosition: state.fpPosition,
    fpYaw: state.fpYaw,
    fpPitch: state.fpPitch,
    tpDistance: state.tpDistance,
    tpResolvedDistance: state.tpResolvedDistance,
    tpYaw: state.tpYaw,
    tpPitch: state.tpPitch,
    tpTarget: state.tpTarget,
    movementResponseAxes: state.movementResponseAxes,
    mouseDeltaX: 0,
    mouseDeltaY: 0,
    lastLogTime,
    fovRadians: options.fovRadians,
    cameraNear: options.cameraNear,
    cameraFar: options.cameraFar,
    deltaSeconds: options.deltaSeconds,
    movementScale: options.movementScale,
    movementAccelerationSeconds: options.movementAccelerationSeconds,
    movementDecelerationSeconds: options.movementDecelerationSeconds,
    lookAxes: options.lookAxes,
    gamepadLookRadiansPerSecond: options.gamepadLookRadiansPerSecond,
    zoomDelta: options.zoomDelta,
    zoomAxis: options.zoomAxis,
    zoomWheelSensitivity: options.zoomWheelSensitivity,
    gamepadZoomRate: options.gamepadZoomRate,
    minZoomDistance: options.minZoomDistance,
    maxZoomDistance: options.maxZoomDistance,
    movementIntent,
  };
}

export function updateStandardCamera(state, options) {
  if (!state || !options) throw new Error("updateStandardCamera: state and options are required");
  const admission = standardCameraUpdateReport(state, options);
  if (!admission.valid) return null;
  const current = admission.state.state;
  const settings = admission.options.options;
  if (settings.width === 0 || settings.height === 0) return cameraResult(current, settings, null, null);

  const aspect = settings.width / settings.height;
  const projection = mat4PerspectiveRadWebGPU(
    settings.fovRadians, aspect, settings.cameraNear, settings.cameraFar,
  );
  let fpPosition = [...current.fpPosition];
  let fpYaw = current.fpYaw;
  let fpPitch = current.fpPitch;
  let tpYaw = current.tpYaw;
  let tpPitch = current.tpPitch;
  let tpDistance = current.tpDistance;
  let lastLogTime = current.lastLogTime;
  let movementIntent = null;
  let movementResponseAxes = [...current.movementResponseAxes];
  const lookYawDelta = current.mouseDeltaX * settings.mouseSensitivity +
    settings.lookAxes[0] * settings.gamepadLookRadiansPerSecond * settings.deltaSeconds;
  const lookPitchDelta = current.mouseDeltaY * settings.mouseSensitivity +
    settings.lookAxes[1] * settings.gamepadLookRadiansPerSecond * settings.deltaSeconds;
  let view;

  if (current.cameraMode === 1) {
    fpYaw -= lookYawDelta;
    fpPitch = clamp(
      fpPitch - lookPitchDelta,
      -STANDARD_CAMERA_LIMITS.firstPersonPitchLimit,
      STANDARD_CAMERA_LIMITS.firstPersonPitchLimit,
    );
    const referenceStep = settings.keys.Shift || settings.keys.shift ? settings.sprintStep : settings.walkStep;
    const speed = referenceStep * settings.movementScale;
    movementIntent = standardCameraMovementIntentReport(settings.keys, fpYaw, speed, settings.movementAxes, {
      currentAxes: current.movementResponseAxes,
      deltaSeconds: settings.deltaSeconds,
      accelerationSeconds: settings.movementAccelerationSeconds,
      decelerationSeconds: settings.movementDecelerationSeconds,
    });
    if (!movementIntent.valid) return null;
    movementResponseAxes = [...movementIntent.axes];
    fpPosition = vec3Add(fpPosition, movementIntent.delta);
    if (!vectorValidationReport(fpPosition, {
      dimension: 3,
      componentMin: -STANDARD_CAMERA_LIMITS.maxWorldCoordinateMagnitude,
      componentMax: STANDARD_CAMERA_LIMITS.maxWorldCoordinateMagnitude,
    }).valid) return null;

    const lookDir = vec3(
      Math.sin(fpYaw) * Math.cos(fpPitch),
      Math.sin(fpPitch),
      Math.cos(fpYaw) * Math.cos(fpPitch),
    );
    view = mat4LookAt(fpPosition, vec3Add(fpPosition, lookDir), vec3(0, 1, 0));
    if (settings.cameraDebugLogging && typeof settings.logger?.info === "function") {
      const now = Date.now();
      if (lastLogTime === null || now - lastLogTime > 1000) {
        try {
          settings.logger.info(
            `[CAMERA] First-person at (${fpPosition[0].toFixed(1)}, ${fpPosition[1].toFixed(1)}, ${fpPosition[2].toFixed(1)}) yaw=${radiansToDegrees(fpYaw).toFixed(1)}° pitch=${radiansToDegrees(fpPitch).toFixed(1)}°`,
          );
        } catch (_) {}
        lastLogTime = now;
      }
    }
  } else {
    movementResponseAxes = [0, 0, 0];
    const zoom = standardCameraZoomReport(tpDistance, {
      deltaSeconds: settings.deltaSeconds,
      wheelDelta: settings.zoomDelta,
      zoomAxis: settings.zoomAxis,
      wheelSensitivity: settings.zoomWheelSensitivity,
      gamepadRate: settings.gamepadZoomRate,
      minDistance: settings.minZoomDistance,
      maxDistance: settings.maxZoomDistance,
    });
    if (!zoom.valid) return null;
    tpDistance = zoom.value;
    tpYaw -= lookYawDelta;
    tpPitch = clamp(
      tpPitch - lookPitchDelta,
      STANDARD_CAMERA_LIMITS.thirdPersonMinPitch,
      STANDARD_CAMERA_LIMITS.thirdPersonMaxPitch,
    );
    const target = current.tpTarget;
    const camX = target[0] + tpDistance * Math.sin(tpYaw) * Math.sin(tpPitch);
    const camY = target[1] + tpDistance * Math.cos(tpPitch);
    const camZ = target[2] + tpDistance * Math.cos(tpYaw) * Math.sin(tpPitch);
    const eye = vec3(camX, camY, camZ);
    view = mat4LookAt(eye, target, vec3(0, 1, 0));
    if (settings.cameraDebugLogging && typeof settings.logger?.info === "function") {
      const now = Date.now();
      if (lastLogTime === null || now - lastLogTime > 1000) {
        try {
          settings.logger.info(
            `[CAMERA] Third-person at (${camX.toFixed(1)}, ${camY.toFixed(1)}, ${camZ.toFixed(1)}) looking at (${target[0].toFixed(1)}, ${target[1].toFixed(1)}, ${target[2].toFixed(1)}), distance=${tpDistance.toFixed(1)}`,
          );
        } catch (_) {}
        lastLogTime = now;
      }
    }
  }

  return cameraResult({
    ...current,
    fpPosition,
    fpYaw,
    fpPitch,
    tpYaw,
    tpPitch,
    tpDistance,
    tpResolvedDistance: tpDistance,
    movementResponseAxes,
  }, settings, projection, view, lastLogTime, movementIntent);
}

export function getStandardCameraEyeBasis(state) {
  const admission = standardCameraStateReport(state);
  if (!admission.valid) return null;
  const camera = admission.state;
  if (camera.cameraMode === 1) {
    const pitch = clamp(
      camera.fpPitch,
      -STANDARD_CAMERA_LIMITS.firstPersonPitchLimit,
      STANDARD_CAMERA_LIMITS.firstPersonPitchLimit,
    );
    const forward = vec3Normalize(vec3(
      Math.sin(camera.fpYaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(camera.fpYaw) * Math.cos(pitch),
    ));
    const right = vec3Normalize(vec3Cross(forward, vec3(0, 1, 0)));
    const up = vec3Normalize(vec3Cross(right, forward));
    return { eye: [...camera.fpPosition], forward, right, up };
  }

  const pitch = clamp(
    camera.tpPitch,
    STANDARD_CAMERA_LIMITS.thirdPersonMinPitch,
    STANDARD_CAMERA_LIMITS.thirdPersonMaxPitch,
  );
  const eye = [
    camera.tpTarget[0] + camera.tpResolvedDistance * Math.sin(camera.tpYaw) * Math.sin(pitch),
    camera.tpTarget[1] + camera.tpResolvedDistance * Math.cos(pitch),
    camera.tpTarget[2] + camera.tpResolvedDistance * Math.cos(camera.tpYaw) * Math.sin(pitch),
  ];
  const forward = vec3Normalize(vec3Sub(camera.tpTarget, eye));
  const right = vec3Normalize(vec3Cross(forward, vec3(0, 1, 0)));
  const up = vec3Normalize(vec3Cross(right, forward));
  return { eye, forward, right, up };
}
