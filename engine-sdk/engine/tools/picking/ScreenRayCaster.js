// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  vec3Add,
  vec3Dot,
  vec3Normalize,
  vec3Scale,
} from "../../core/math/EngineMath.js";
import {
  finiteNumberReport,
  vectorValidationReport,
} from "../../core/math/MathValidation.js";
import {
  getStandardCameraEyeBasis,
  standardCameraStateReport,
} from "../camera/StandardCameraController.js";

export const SCREEN_RAY_LIMITS = Object.freeze({
  defaultFovRadians: Math.PI / 4,
  minFovRadians: Math.PI / 180,
  maxFovRadians: Math.PI * 179 / 180,
  maxViewportDimension: 1e7,
  maxScreenCoordinateMagnitude: 1e9,
  maxWorldCoordinateMagnitude: 1e12,
  maxBasisComponent: 1e6,
});

export function screenPickInputReport(canvas, clientX, clientY, fovRadians = SCREEN_RAY_LIMITS.defaultFovRadians) {
  const xReport = finiteNumberReport(clientX, {
    min: -SCREEN_RAY_LIMITS.maxScreenCoordinateMagnitude,
    max: SCREEN_RAY_LIMITS.maxScreenCoordinateMagnitude,
  });
  const yReport = finiteNumberReport(clientY, {
    min: -SCREEN_RAY_LIMITS.maxScreenCoordinateMagnitude,
    max: SCREEN_RAY_LIMITS.maxScreenCoordinateMagnitude,
  });
  const fov = finiteNumberReport(fovRadians, {
    min: SCREEN_RAY_LIMITS.minFovRadians,
    max: SCREEN_RAY_LIMITS.maxFovRadians,
  });
  let rect = null;
  try {
    rect = typeof canvas?.getBoundingClientRect === "function"
      ? canvas.getBoundingClientRect()
      : null;
  } catch (_) {
    rect = null;
  }
  const width = finiteNumberReport(rect?.width, {
    min: Number.EPSILON,
    max: SCREEN_RAY_LIMITS.maxViewportDimension,
  });
  const height = finiteNumberReport(rect?.height, {
    min: Number.EPSILON,
    max: SCREEN_RAY_LIMITS.maxViewportDimension,
  });
  const left = finiteNumberReport(rect?.left, {
    min: -SCREEN_RAY_LIMITS.maxScreenCoordinateMagnitude,
    max: SCREEN_RAY_LIMITS.maxScreenCoordinateMagnitude,
  });
  const top = finiteNumberReport(rect?.top, {
    min: -SCREEN_RAY_LIMITS.maxScreenCoordinateMagnitude,
    max: SCREEN_RAY_LIMITS.maxScreenCoordinateMagnitude,
  });
  const valid = xReport.valid && yReport.valid && fov.valid && width.valid && height.valid && left.valid && top.valid;
  if (!valid) return { valid: false, clientX: xReport, clientY: yReport, fov, width, height, left, top };

  const localX = xReport.value - left.value;
  const localY = yReport.value - top.value;
  const nx = (localX / width.value) * 2 - 1;
  const ny = 1 - (localY / height.value) * 2;
  const aspect = width.value / height.value;
  const tanFovY = Math.tan(fov.value / 2);
  const tanFovX = tanFovY * aspect;
  const derivedValid = [localX, localY, nx, ny, aspect, tanFovX, tanFovY].every(Number.isFinite);
  return {
    valid: derivedValid,
    clientX: xReport,
    clientY: yReport,
    fov,
    width,
    height,
    left,
    top,
    localX,
    localY,
    nx,
    ny,
    aspect,
    tanFovX,
    tanFovY,
  };
}

export function screenCameraBasisReport(basis) {
  const eye = vectorValidationReport(basis?.eye, {
    dimension: 3,
    componentMin: -SCREEN_RAY_LIMITS.maxWorldCoordinateMagnitude,
    componentMax: SCREEN_RAY_LIMITS.maxWorldCoordinateMagnitude,
  });
  const vectorOptions = {
    dimension: 3,
    allowZero: false,
    componentMin: -SCREEN_RAY_LIMITS.maxBasisComponent,
    componentMax: SCREEN_RAY_LIMITS.maxBasisComponent,
  };
  const forward = vectorValidationReport(basis?.forward, vectorOptions);
  const right = vectorValidationReport(basis?.right, vectorOptions);
  const up = vectorValidationReport(basis?.up, vectorOptions);
  if (!eye.valid || !forward.valid || !right.valid || !up.valid) {
    return {
      valid: false,
      eyeReport: eye,
      forwardReport: forward,
      rightReport: right,
      upReport: up,
      eye: null,
      forward: null,
      right: null,
      up: null,
      orthogonal: false,
    };
  }
  const normalized = {
    eye: [...basis.eye],
    forward: vec3Normalize(basis.forward),
    right: vec3Normalize(basis.right),
    up: vec3Normalize(basis.up),
  };
  const orthogonal = Math.abs(vec3Dot(normalized.forward, normalized.right)) < 0.999999 &&
    Math.abs(vec3Dot(normalized.forward, normalized.up)) < 0.999999 &&
    Math.abs(vec3Dot(normalized.right, normalized.up)) < 0.999999;
  return {
    valid: orthogonal,
    eyeReport: eye,
    forwardReport: forward,
    rightReport: right,
    upReport: up,
    ...normalized,
    orthogonal,
  };
}

export function screenCameraStateReport(cameraState) {
  return standardCameraStateReport(cameraState);
}

export function getPickRayForCanvas(canvas, cameraState, clientX, clientY, options = {}) {
  if (!screenCameraStateReport(cameraState).valid) return null;
  const fovRadians = options?.fovRadians ?? SCREEN_RAY_LIMITS.defaultFovRadians;
  const input = screenPickInputReport(canvas, clientX, clientY, fovRadians);
  if (!input.valid) return null;

  const basis = screenCameraBasisReport(getStandardCameraEyeBasis(cameraState));
  if (!basis.valid) return null;
  let dir = vec3Add(basis.forward, vec3Scale(basis.right, input.nx * input.tanFovX));
  dir = vec3Add(dir, vec3Scale(basis.up, input.ny * input.tanFovY));
  dir = vec3Normalize(dir);
  if (!vectorValidationReport(dir, { dimension: 3, allowZero: false }).valid) return null;
  return { eye: [...basis.eye], dir };
}
