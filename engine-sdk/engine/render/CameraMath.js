// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// CameraMath - minimal matrix utilities for camera view/projection
// Pure data/maths, no ECS or rendering side effects.
// NOTE: WebGPU uses [0, 1] clip space Z range, different from OpenGL's [-1, 1]

import {
  mat4PerspectiveDeg,
  mat4PerspectiveDegWebGPU,
  mat4OrthographicWebGPU,
  mat4Identity,
  mat4Multiply as multiplyMat4,
} from "../core/math/EngineMath.js";

function invertRigidTransform(position, rotation) {
  // rotation is unit quaternion [x,y,z,w]
  const x = rotation[0];
  const y = rotation[1];
  const z = rotation[2];
  const w = rotation[3];

  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;

  // Rotation matrix R from quaternion (column-major)
  const r00 = 1 - 2 * (yy + zz);
  const r01 = 2 * (xy + wz);
  const r02 = 2 * (xz - wy);

  const r10 = 2 * (xy - wz);
  const r11 = 1 - 2 * (xx + zz);
  const r12 = 2 * (yz + wx);

  const r20 = 2 * (xz + wy);
  const r21 = 2 * (yz - wx);
  const r22 = 1 - 2 * (xx + yy);

  // View = R^T * T^-1 where T translates by -position
  const tx = -position[0];
  const ty = -position[1];
  const tz = -position[2];

  const out = mat4Identity();
  // Upper-left 3x3 is transpose of R
  out[0] = r00; out[1] = r10; out[2] = r20;
  out[4] = r01; out[5] = r11; out[6] = r21;
  out[8] = r02; out[9] = r12; out[10] = r22;

  // Translation = R^T * (-position)
  out[12] = r00 * tx + r01 * ty + r02 * tz;
  out[13] = r10 * tx + r11 * ty + r12 * tz;
  out[14] = r20 * tx + r21 * ty + r22 * tz;

  return out;
}

/**
 * Compute perspective projection matrix.
 * @param {Object} camera - Camera with fov, aspect, near, far
 * @param {number} aspectFallback - Fallback aspect ratio
 * @param {Object} options - Optional settings
 * @param {boolean} options.webgpuStyle - Use WebGPU [0,1] depth range (default: true)
 * @returns {Float32Array} Projection matrix
 */
export function computePerspectiveProjection(camera, aspectFallback, options = {}) {
  const aspect =
    typeof camera.aspect === "number" && camera.aspect > 0
      ? camera.aspect
      : aspectFallback;
  // Default to WebGPU-style [0,1] depth range for modern WebGPU rendering
  const useWebGPU = options.webgpuStyle !== false;
  if (useWebGPU) {
    return mat4PerspectiveDegWebGPU(camera.fov, aspect, camera.near, camera.far);
  }
  return mat4PerspectiveDeg(camera.fov, aspect, camera.near, camera.far);
}

export function computeOrthographicProjection(camera, viewHeight, aspectFallback) {
  const aspect =
    typeof camera.aspect === "number" && camera.aspect > 0
      ? camera.aspect
      : aspectFallback;
  const halfHeight = viewHeight * 0.5;
  const halfWidth = halfHeight * aspect;
  return mat4OrthographicWebGPU(
    -halfWidth,
    halfWidth,
    -halfHeight,
    halfHeight,
    camera.near,
    camera.far
  );
}

export function computeViewMatrixFromTransform(transform) {
  return invertRigidTransform(transform.position, transform.rotation);
}

export function computeViewProjMatrix(camera, transform, viewportWidth, viewportHeight) {
  const aspect = viewportWidth / Math.max(1, viewportHeight);
  const view = computeViewMatrixFromTransform(transform);
  const proj =
    camera.projection === "orthographic"
      ? computeOrthographicProjection(camera, 10, aspect)
      : computePerspectiveProjection(camera, aspect);
  const viewProj = multiplyMat4(proj, view);
  return { view, proj, viewProj };
}
