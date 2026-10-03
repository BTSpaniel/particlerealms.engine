// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * RayPicking.js - Unified, admitted camera and room/entity picking wrappers.
 */

import { finiteNumberReport } from "../../core/math/MathValidation.js";
import { getStandardCameraEyeBasis } from "../camera/StandardCameraController.js";
import {
  getPickRayForCanvas as getPickRayForCanvasFromScreen,
  SCREEN_RAY_LIMITS,
  screenCameraBasisReport,
  screenCameraStateReport,
} from "./ScreenRayCaster.js";
import { pickRoomSurfaceFromRay, pickEntityFromRay } from "./RoomPicking.js";

export const RAY_PICKER_LIMITS = Object.freeze({
  defaultFovRadians: SCREEN_RAY_LIMITS.defaultFovRadians,
  minFovRadians: SCREEN_RAY_LIMITS.minFovRadians,
  maxFovRadians: SCREEN_RAY_LIMITS.maxFovRadians,
});

function cameraState(camera) {
  if (!camera || typeof camera !== "object") return null;
  return {
    cameraMode: camera.mode,
    fpPosition: camera.fp?.position,
    fpYaw: camera.fp?.yaw,
    fpPitch: camera.fp?.pitch,
    tpDistance: camera.tp?.resolvedDistance ?? camera.tp?.distance,
    tpResolvedDistance: camera.tp?.resolvedDistance ?? camera.tp?.distance,
    tpYaw: camera.tp?.yaw,
    tpPitch: camera.tp?.pitch,
    tpTarget: camera.tp?.target,
  };
}

export function resolvePickFovRadians(options = {}, camera = null, config = null) {
  const value = options?.fovRadians ?? camera?.pickFovRadians ?? config?.pickFovRadians ??
    RAY_PICKER_LIMITS.defaultFovRadians;
  const report = finiteNumberReport(value, {
    min: RAY_PICKER_LIMITS.minFovRadians,
    max: RAY_PICKER_LIMITS.maxFovRadians,
  });
  return { ...report, source: options?.fovRadians !== undefined ? "options" :
    (camera?.pickFovRadians !== undefined ? "camera" :
      (config?.pickFovRadians !== undefined ? "config" : "default")) };
}

export function rayPickerOptionsReport(options) {
  const object = options !== null && typeof options === "object";
  const canvas = object && typeof options.canvas?.getBoundingClientRect === "function";
  const cameraObject = object && options.camera !== null && typeof options.camera === "object";
  const state = cameraState(cameraObject ? options.camera : null);
  const cameraStateValidation = screenCameraStateReport(state);
  const camera = cameraObject && cameraStateValidation.valid;
  const config = object && (options.config === undefined ||
    (options.config !== null && typeof options.config === "object"));
  const fov = resolvePickFovRadians(object ? options : {}, camera ? options.camera : null,
    config ? options.config : null);
  return {
    valid: object && canvas && camera && config && fov.valid,
    object,
    canvas,
    camera,
    config,
    fov,
    cameraState: cameraStateValidation,
  };
}

export function createRayPicker(options = {}) {
  const admitted = rayPickerOptionsReport(options);
  const canvas = admitted.valid ? options.canvas : null;
  const camera = admitted.valid ? options.camera : null;
  const config = admitted.valid ? (options.config ?? {}) : {};
  const fovRadians = admitted.fov.valid ? admitted.fov.value : RAY_PICKER_LIMITS.defaultFovRadians;

  function getCameraEyeBasis() {
    return getCameraEyeBasisFromState(camera);
  }

  function getPickRay(clientX, clientY) {
    if (!admitted.valid) return null;
    return getPickRayForCanvasFromScreen(canvas, cameraState(camera), clientX, clientY, { fovRadians });
  }

  function pickWorldPosition(clientX, clientY) {
    const ray = getPickRay(clientX, clientY);
    if (!ray) return null;
    return pickRoomSurfaceFromRay(ray, {
      roomSize: config.roomSize,
      minDistance: config.minSpawnDistance,
      maxDistance: config.maxSpawnDistance,
      ballRadius: config.ballRadius,
    });
  }

  function pickEntity(clientX, clientY, ecsWorld, entities, getTransform) {
    if (!ecsWorld || !Array.isArray(entities) || entities.length === 0) return null;
    const ray = getPickRay(clientX, clientY);
    if (!ray) return null;
    return pickEntityFromRay(ray, ecsWorld, entities, {
      minDistance: config.minSpawnDistance,
      maxDistance: config.maxSpawnDistance,
      getTransform,
    });
  }

  return { getCameraEyeBasis, getPickRay, pickWorldPosition, pickEntity };
}

export function getCameraEyeBasisFromState(camera) {
  const state = cameraState(camera);
  if (!screenCameraStateReport(state).valid) return null;
  let raw = null;
  try {
    raw = getStandardCameraEyeBasis(state);
  } catch (_) {
    return null;
  }
  const report = screenCameraBasisReport(raw);
  if (!report.valid) return null;
  return { eye: [...report.eye], forward: [...report.forward], right: [...report.right], up: [...report.up] };
}

export function getPickRayFromState(canvas, camera, clientX, clientY, options = {}) {
  const state = cameraState(camera);
  if (!state) return null;
  const fov = resolvePickFovRadians(options, camera, options?.config);
  if (!fov.valid) return null;
  return getPickRayForCanvasFromScreen(canvas, state, clientX, clientY, { fovRadians: fov.value });
}
