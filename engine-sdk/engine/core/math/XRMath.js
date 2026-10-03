// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * XRMath.js - pure WebXR-shaped pose, view, projection, and depth reports.
 */

import { clamp, finiteNumber, safeDiv } from './MathScalar.js';

const EPSILON = 1e-9;

function readFinite(value, fallback = 0) {
  return finiteNumber(value, fallback);
}

function readPositive(value, fallback = 1) {
  const number = readFinite(value, fallback);
  return number > 0 ? number : fallback;
}

function finiteArray(values, length) {
  if (!values || values.length < length) return false;
  for (let i = 0; i < length; i++) {
    if (!Number.isFinite(values[i])) return false;
  }
  return true;
}

function identity4() {
  return new Float64Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

function copyMatrix4(matrix, fallback = identity4()) {
  if (!finiteArray(matrix, 16)) return new Float64Array(fallback);
  return new Float64Array(Array.from(matrix).slice(0, 16));
}

function readVec3(value, fallback = Object.freeze({ x: 0, y: 0, z: 0 })) {
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    return Object.freeze({
      x: readFinite(value[0], fallback.x),
      y: readFinite(value[1], fallback.y),
      z: readFinite(value[2], fallback.z),
    });
  }
  return Object.freeze({
    x: readFinite(value?.x, fallback.x),
    y: readFinite(value?.y, fallback.y),
    z: readFinite(value?.z, fallback.z),
  });
}

function readQuat(value) {
  const raw = Array.isArray(value) || ArrayBuffer.isView(value)
    ? {
      x: readFinite(value[0], 0),
      y: readFinite(value[1], 0),
      z: readFinite(value[2], 0),
      w: readFinite(value[3], 1),
    }
    : {
      x: readFinite(value?.x, 0),
      y: readFinite(value?.y, 0),
      z: readFinite(value?.z, 0),
      w: readFinite(value?.w, 1),
    };
  const length = Math.hypot(raw.x, raw.y, raw.z, raw.w);
  if (length <= EPSILON) {
    return Object.freeze({ x: 0, y: 0, z: 0, w: 1, normalized: false });
  }
  return Object.freeze({
    x: raw.x / length,
    y: raw.y / length,
    z: raw.z / length,
    w: raw.w / length,
    normalized: Math.abs(length - 1) <= 1e-6,
  });
}

function matrixFromRotationTranslation(quaternion, position) {
  const x = quaternion.x;
  const y = quaternion.y;
  const z = quaternion.z;
  const w = quaternion.w;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;

  return new Float64Array([
    1 - yy - zz, xy + wz, xz - wy, 0,
    xy - wz, 1 - xx - zz, yz + wx, 0,
    xz + wy, yz - wx, 1 - xx - yy, 0,
    position.x, position.y, position.z, 1,
  ]);
}

function extractPosition(matrix) {
  return Object.freeze({
    x: readFinite(matrix?.[12], 0),
    y: readFinite(matrix?.[13], 0),
    z: readFinite(matrix?.[14], 0),
  });
}

function inverseRigidMatrix4(matrix) {
  const m = copyMatrix4(matrix);
  const tx = m[12];
  const ty = m[13];
  const tz = m[14];
  const out = identity4();

  out[0] = m[0];
  out[1] = m[4];
  out[2] = m[8];
  out[4] = m[1];
  out[5] = m[5];
  out[6] = m[9];
  out[8] = m[2];
  out[9] = m[6];
  out[10] = m[10];

  out[12] = -(out[0] * tx + out[4] * ty + out[8] * tz);
  out[13] = -(out[1] * tx + out[5] * ty + out[9] * tz);
  out[14] = -(out[2] * tx + out[6] * ty + out[10] * tz);
  return out;
}

function multiplyColumnMajor4(a, b) {
  const left = copyMatrix4(a);
  const right = copyMatrix4(b);
  const out = new Float64Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      out[column * 4 + row] =
        left[0 * 4 + row] * right[column * 4 + 0] +
        left[1 * 4 + row] * right[column * 4 + 1] +
        left[2 * 4 + row] * right[column * 4 + 2] +
        left[3 * 4 + row] * right[column * 4 + 3];
    }
  }
  return out;
}

function transformPoint4(matrix, point) {
  const m = copyMatrix4(matrix);
  const x = readFinite(point?.x ?? point?.[0], 0);
  const y = readFinite(point?.y ?? point?.[1], 0);
  const z = readFinite(point?.z ?? point?.[2], 0);
  const w = readFinite(point?.w ?? point?.[3], 1);
  return Object.freeze({
    x: m[0] * x + m[4] * y + m[8] * z + m[12] * w,
    y: m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    z: m[2] * x + m[6] * y + m[10] * z + m[14] * w,
    w: m[3] * x + m[7] * y + m[11] * z + m[15] * w,
  });
}

function readDepthRaw(data, index, bytesPerSample, littleEndian) {
  if (!data) return 0;
  if (ArrayBuffer.isView(data) && typeof data[index] === 'number' && data.BYTES_PER_ELEMENT > 1) {
    return readFinite(data[index], 0);
  }
  const bytes = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
  const byteIndex = index * bytesPerSample;
  if (byteIndex < 0 || byteIndex + bytesPerSample > bytes.byteLength) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytesPerSample === 1) return view.getUint8(byteIndex);
  if (bytesPerSample === 2) return view.getUint16(byteIndex, littleEndian);
  if (bytesPerSample === 4) return view.getUint32(byteIndex, littleEndian);
  return 0;
}

export function xrRigidTransformReport(transform = {}, options = {}) {
  const source = transform ?? {};
  const position = readVec3(source.position ?? options.position ?? extractPosition(source.matrix));
  const orientation = readQuat(source.orientation ?? options.orientation);
  const matrix = finiteArray(source.matrix, 16)
    ? copyMatrix4(source.matrix)
    : matrixFromRotationTranslation(orientation, position);
  const inverseMatrix = finiteArray(source.inverse?.matrix, 16)
    ? copyMatrix4(source.inverse.matrix)
    : inverseRigidMatrix4(matrix);

  return {
    schema: 'particle-realms.xr-rigid-transform.v1',
    valid: finiteArray(matrix, 16) && finiteArray(inverseMatrix, 16),
    matrix,
    inverseMatrix,
    position: Object.freeze({
      x: readFinite(source.position?.x ?? position.x, matrix[12]),
      y: readFinite(source.position?.y ?? position.y, matrix[13]),
      z: readFinite(source.position?.z ?? position.z, matrix[14]),
    }),
    orientation,
    hasProvidedMatrix: finiteArray(source.matrix, 16),
    hasProvidedInverse: finiteArray(source.inverse?.matrix, 16),
  };
}

export function xrPoseViewMatrix(transform = {}, options = {}) {
  return xrRigidTransformReport(transform, options).inverseMatrix;
}

export function xrViewProjectionReport(view = {}, options = {}) {
  const transform = xrRigidTransformReport(view.transform ?? view, options);
  const projectionMatrix = copyMatrix4(view.projectionMatrix ?? options.projectionMatrix);
  const viewMatrix = transform.inverseMatrix;
  const viewProjectionMatrix = multiplyColumnMajor4(projectionMatrix, viewMatrix);

  return {
    schema: 'particle-realms.xr-view-projection.v1',
    valid: transform.valid && finiteArray(projectionMatrix, 16),
    eye: String(view.eye ?? options.eye ?? 'none'),
    projectionMatrix,
    transformMatrix: transform.matrix,
    viewMatrix,
    viewProjectionMatrix,
  };
}

export function xrViewerPoseReport(views = [], options = {}) {
  const reports = Array.from(views ?? [], (view) => xrViewProjectionReport(view, options));
  const left = reports.find((view) => view.eye === 'left');
  const right = reports.find((view) => view.eye === 'right');
  const leftPosition = left ? extractPosition(left.transformMatrix) : null;
  const rightPosition = right ? extractPosition(right.transformMatrix) : null;
  const interPupillaryDistance = leftPosition && rightPosition
    ? Math.hypot(rightPosition.x - leftPosition.x, rightPosition.y - leftPosition.y, rightPosition.z - leftPosition.z)
    : 0;

  return {
    schema: 'particle-realms.xr-viewer-pose.v1',
    valid: reports.every((view) => view.valid),
    viewCount: reports.length,
    eyes: Object.freeze(reports.map((view) => view.eye)),
    views: Object.freeze(reports),
    hasStereoPair: Boolean(left && right),
    interPupillaryDistance,
  };
}

export function xrReferenceSpaceOffsetReport(baseTransform = {}, offsetTransform = {}, options = {}) {
  const base = xrRigidTransformReport(baseTransform, options);
  const offset = xrRigidTransformReport(offsetTransform, options);
  const matrix = multiplyColumnMajor4(base.matrix, offset.matrix);
  return {
    schema: 'particle-realms.xr-reference-space-offset.v1',
    valid: base.valid && offset.valid && finiteArray(matrix, 16),
    matrix,
    inverseMatrix: inverseRigidMatrix4(matrix),
    baseMatrix: base.matrix,
    offsetMatrix: offset.matrix,
  };
}

export function xrProjectionDepthRangeReport(depthNear, depthFar) {
  const near = readPositive(depthNear, 0.1);
  const far = readPositive(depthFar, 1000);
  return {
    schema: 'particle-realms.xr-projection-depth-range.v1',
    valid: near > 0 && far > 0,
    near,
    far,
    reversed: near > far,
    span: Math.abs(far - near),
    ratio: safeDiv(Math.max(near, far), Math.min(near, far), Infinity),
  };
}

export function xrDepthRawToMeters(rawDepth, rawValueToMeters = 1) {
  const raw = readFinite(rawDepth, 0);
  const scale = readFinite(rawValueToMeters, 1);
  return raw * scale;
}

export function xrDepthUvTransformPoint(point = {}, matrix = identity4()) {
  const transformed = transformPoint4(matrix, {
    x: point?.x ?? point?.u ?? point?.[0],
    y: point?.y ?? point?.v ?? point?.[1],
    z: point?.z ?? point?.[2] ?? 0,
    w: point?.w ?? point?.[3] ?? 1,
  });
  const reciprocalW = Math.abs(transformed.w) > EPSILON ? 1 / transformed.w : 1;
  return {
    schema: 'particle-realms.xr-depth-uv-transform.v1',
    valid: Number.isFinite(transformed.x) && Number.isFinite(transformed.y) && Number.isFinite(transformed.w),
    x: transformed.x * reciprocalW,
    y: transformed.y * reciprocalW,
    z: transformed.z * reciprocalW,
    w: transformed.w,
  };
}

export function xrDepthSampleIndex(width, height, u, v, options = {}) {
  const sampleWidth = Math.max(1, Math.trunc(readFinite(width, 1)));
  const sampleHeight = Math.max(1, Math.trunc(readFinite(height, 1)));
  const column = Math.min(sampleWidth - 1, Math.floor(clamp(readFinite(u, 0), 0, 1) * sampleWidth));
  const row = Math.min(sampleHeight - 1, Math.floor(clamp(readFinite(v, 0), 0, 1) * sampleHeight));
  const bytesPerSample = Math.max(1, Math.trunc(readFinite(options.bytesPerSample, 2)));
  const index = row * sampleWidth + column;
  return {
    schema: 'particle-realms.xr-depth-sample-index.v1',
    valid: sampleWidth > 0 && sampleHeight > 0,
    width: sampleWidth,
    height: sampleHeight,
    u: clamp(readFinite(u, 0), 0, 1),
    v: clamp(readFinite(v, 0), 0, 1),
    column,
    row,
    index,
    byteIndex: index * bytesPerSample,
    bytesPerSample,
  };
}

export function xrDepthSampleMeters(depthData, width, height, u, v, options = {}) {
  const bytesPerSample = Math.max(1, Math.trunc(readFinite(options.bytesPerSample, depthData?.BYTES_PER_ELEMENT ?? 2)));
  const indexReport = xrDepthSampleIndex(width, height, u, v, { bytesPerSample });
  const rawDepth = readDepthRaw(depthData, indexReport.index, bytesPerSample, options.littleEndian !== false);
  return {
    ...indexReport,
    schema: 'particle-realms.xr-depth-sample-meters.v1',
    valid: indexReport.valid,
    rawDepth,
    rawValueToMeters: readFinite(options.rawValueToMeters, 1),
    meters: xrDepthRawToMeters(rawDepth, options.rawValueToMeters),
  };
}
