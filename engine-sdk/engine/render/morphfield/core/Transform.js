// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { failMorphField } from './errors.js';
import { ANALYTIC_GPU_PARAMETER_MINIMUM } from './constants.js';

const MORPHFIELD_F32_MAX = 3.4028234663852886e38;

const IDENTITY_MATRIX = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

function finiteNumber(value, path) {
  const number = Number(value);
  if (!Number.isFinite(number)) failMorphField('INVALID_TRANSFORM', `${path} must be finite`, { path, value });
  if (Math.abs(number) > MORPHFIELD_F32_MAX || !Number.isFinite(Math.fround(number))) {
    failMorphField('INVALID_TRANSFORM', `${path} must be representable as finite f32`, {
      path,
      value: number,
      maximumMagnitude: MORPHFIELD_F32_MAX,
    });
  }
  return Object.is(number, -0) ? 0 : number;
}

export function normalizeVector3(value, path = 'vector', fallback = [0, 0, 0]) {
  const source = value === undefined ? fallback : value;
  if ((!Array.isArray(source) && !ArrayBuffer.isView(source)) || source.length !== 3) {
    failMorphField('INVALID_VECTOR3', `${path} must contain exactly three numbers`, { path });
  }
  return [
    finiteNumber(source[0], `${path}[0]`),
    finiteNumber(source[1], `${path}[1]`),
    finiteNumber(source[2], `${path}[2]`),
  ];
}

export function normalizeQuaternion(value, path = 'rotation') {
  const source = value === undefined ? [0, 0, 0, 1] : value;
  if ((!Array.isArray(source) && !ArrayBuffer.isView(source)) || source.length !== 4) {
    failMorphField('INVALID_QUATERNION', `${path} must contain exactly four numbers`, { path });
  }
  const quaternion = [
    finiteNumber(source[0], `${path}[0]`),
    finiteNumber(source[1], `${path}[1]`),
    finiteNumber(source[2], `${path}[2]`),
    finiteNumber(source[3], `${path}[3]`),
  ];
  const length = Math.hypot(...quaternion);
  if (!(length > 1e-12)) failMorphField('INVALID_QUATERNION', `${path} cannot have zero length`, { path });
  for (let index = 0; index < 4; index++) quaternion[index] /= length;
  if (quaternion[3] < 0) {
    for (let index = 0; index < 4; index++) quaternion[index] = -quaternion[index];
  }
  return quaternion.map(valuePart => Object.is(valuePart, -0) ? 0 : valuePart);
}

function normalizeScale(value, path = 'scale') {
  if (value === undefined) return 1;
  if (typeof value === 'number') {
    const scale = finiteNumber(value, path);
    if (!(scale >= ANALYTIC_GPU_PARAMETER_MINIMUM)) {
      failMorphField('INVALID_SCALE', `${path} must be at least ${ANALYTIC_GPU_PARAMETER_MINIMUM} to match the GPU analytic evaluator`, {
        path,
        value,
        minimum: ANALYTIC_GPU_PARAMETER_MINIMUM,
      });
    }
    return scale;
  }
  const vector = normalizeVector3(value, path, [1, 1, 1]);
  const maximum = Math.max(Math.abs(vector[0]), Math.abs(vector[1]), Math.abs(vector[2]));
  const tolerance = Math.max(maximum * 1e-7, Number.EPSILON * 16);
  if (vector.some(component => component < ANALYTIC_GPU_PARAMETER_MINIMUM)
      || Math.abs(vector[0] - vector[1]) > tolerance || Math.abs(vector[0] - vector[2]) > tolerance) {
    failMorphField('NON_UNIFORM_SCALE', `${path} must be a uniform scale of at least ${ANALYTIC_GPU_PARAMETER_MINIMUM}`, {
      path,
      value: vector,
      minimum: ANALYTIC_GPU_PARAMETER_MINIMUM,
    });
  }
  const scale = (vector[0] + vector[1] + vector[2]) / 3;
  if (!(scale >= ANALYTIC_GPU_PARAMETER_MINIMUM)) {
    failMorphField('INVALID_SCALE', `${path} normalizes below the GPU analytic minimum`, {
      path,
      value: vector,
      scale,
      minimum: ANALYTIC_GPU_PARAMETER_MINIMUM,
    });
  }
  return scale;
}

export function matrixFromRigidUniformTransform(translation, rotation, scale) {
  const [x, y, z, w] = rotation;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * scale,
    (2 * (xy + wz)) * scale,
    (2 * (xz - wy)) * scale,
    0,
    (2 * (xy - wz)) * scale,
    (1 - 2 * (xx + zz)) * scale,
    (2 * (yz + wx)) * scale,
    0,
    (2 * (xz + wy)) * scale,
    (2 * (yz - wx)) * scale,
    (1 - 2 * (xx + yy)) * scale,
    0,
    translation[0], translation[1], translation[2], 1,
  ];
}

function determinant3(columns) {
  const [a, b, c] = columns;
  return a[0] * (b[1] * c[2] - b[2] * c[1])
    - b[0] * (a[1] * c[2] - a[2] * c[1])
    + c[0] * (a[1] * b[2] - a[2] * b[1]);
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function quaternionFromColumns(columns) {
  const [c0, c1, c2] = columns;
  const m00 = c0[0]; const m01 = c1[0]; const m02 = c2[0];
  const m10 = c0[1]; const m11 = c1[1]; const m12 = c2[1];
  const m20 = c0[2]; const m21 = c1[2]; const m22 = c2[2];
  const trace = m00 + m11 + m22;
  let x;
  let y;
  let z;
  let w;
  if (trace > 0) {
    const root = Math.sqrt(trace + 1) * 2;
    w = 0.25 * root;
    x = (m21 - m12) / root;
    y = (m02 - m20) / root;
    z = (m10 - m01) / root;
  } else if (m00 > m11 && m00 > m22) {
    const root = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / root;
    x = 0.25 * root;
    y = (m01 + m10) / root;
    z = (m02 + m20) / root;
  } else if (m11 > m22) {
    const root = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / root;
    x = (m01 + m10) / root;
    y = 0.25 * root;
    z = (m12 + m21) / root;
  } else {
    const root = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / root;
    x = (m02 + m20) / root;
    y = (m12 + m21) / root;
    z = 0.25 * root;
  }
  return normalizeQuaternion([x, y, z, w]);
}

function decomposeRigidUniformMatrix(value, path) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length !== 16) {
    failMorphField('INVALID_MATRIX', `${path} must contain exactly sixteen column-major numbers`, { path });
  }
  const matrix = Array.from(value, (entry, index) => finiteNumber(entry, `${path}[${index}]`));
  const affineTolerance = 1e-7;
  if (Math.abs(matrix[3]) > affineTolerance || Math.abs(matrix[7]) > affineTolerance
      || Math.abs(matrix[11]) > affineTolerance || Math.abs(matrix[15] - 1) > affineTolerance) {
    failMorphField('NON_AFFINE_MATRIX', `${path} must be an affine matrix`, { path });
  }
  const columns = [
    [matrix[0], matrix[1], matrix[2]],
    [matrix[4], matrix[5], matrix[6]],
    [matrix[8], matrix[9], matrix[10]],
  ];
  const lengths = columns.map(column => Math.hypot(...column));
  const scale = (lengths[0] + lengths[1] + lengths[2]) / 3;
  if (!(scale >= ANALYTIC_GPU_PARAMETER_MINIMUM)) {
    failMorphField('SINGULAR_MATRIX', `${path} scale must be at least ${ANALYTIC_GPU_PARAMETER_MINIMUM} to match the GPU analytic evaluator`, {
      path,
      scale,
      minimum: ANALYTIC_GPU_PARAMETER_MINIMUM,
    });
  }
  const tolerance = Math.max(scale * 1e-6, Number.EPSILON * 16);
  if (lengths.some(length => Math.abs(length - scale) > tolerance)) {
    failMorphField('NON_UNIFORM_SCALE', `${path} contains nonuniform scale`, { path, lengths });
  }
  const normalized = columns.map(column => column.map(component => component / scale));
  if (Math.abs(dot(normalized[0], normalized[1])) > 1e-6
      || Math.abs(dot(normalized[0], normalized[2])) > 1e-6
      || Math.abs(dot(normalized[1], normalized[2])) > 1e-6) {
    failMorphField('SHEARED_MATRIX', `${path} contains shear`, { path });
  }
  const determinant = determinant3(normalized);
  if (Math.abs(determinant - 1) > 1e-5) {
    failMorphField('REFLECTED_MATRIX', `${path} must contain a proper rotation without reflection`, { path, determinant });
  }
  return {
    translation: [matrix[12], matrix[13], matrix[14]],
    rotation: quaternionFromColumns(normalized),
    scale,
  };
}

function inverseRigidUniformMatrix(matrix, scale) {
  const inverseScaleSquared = 1 / (scale * scale);
  const result = [
    matrix[0] * inverseScaleSquared,
    matrix[4] * inverseScaleSquared,
    matrix[8] * inverseScaleSquared,
    0,
    matrix[1] * inverseScaleSquared,
    matrix[5] * inverseScaleSquared,
    matrix[9] * inverseScaleSquared,
    0,
    matrix[2] * inverseScaleSquared,
    matrix[6] * inverseScaleSquared,
    matrix[10] * inverseScaleSquared,
    0,
    0, 0, 0, 1,
  ];
  const tx = matrix[12];
  const ty = matrix[13];
  const tz = matrix[14];
  result[12] = -(result[0] * tx + result[4] * ty + result[8] * tz);
  result[13] = -(result[1] * tx + result[5] * ty + result[9] * tz);
  result[14] = -(result[2] * tx + result[6] * ty + result[10] * tz);
  return result;
}

export function normalizeTransform(input = undefined, path = 'transform') {
  let translation;
  let rotation;
  let scale;
  if (input === undefined || input === null) {
    translation = [0, 0, 0];
    rotation = [0, 0, 0, 1];
    scale = 1;
  } else if (Array.isArray(input) || ArrayBuffer.isView(input)) {
    ({ translation, rotation, scale } = decomposeRigidUniformMatrix(input, path));
  } else if (typeof input === 'object') {
    if (input.matrix !== undefined) {
      ({ translation, rotation, scale } = decomposeRigidUniformMatrix(input.matrix, `${path}.matrix`));
    } else {
      translation = normalizeVector3(input.translation, `${path}.translation`, [0, 0, 0]);
      rotation = normalizeQuaternion(input.rotation, `${path}.rotation`);
      scale = normalizeScale(input.scale, `${path}.scale`);
    }
  } else {
    failMorphField('INVALID_TRANSFORM', `${path} must be a transform object or 4x4 matrix`, { path });
  }
  const matrix = matrixFromRigidUniformTransform(translation, rotation, scale);
  const inverseMatrix = inverseRigidUniformMatrix(matrix, scale);
  return Object.freeze({
    translation: Object.freeze([...translation]),
    rotation: Object.freeze([...rotation]),
    scale,
    matrix: Object.freeze(matrix),
    inverseMatrix: Object.freeze(inverseMatrix),
  });
}

export function isIdentityTransform(transform) {
  const matrix = transform?.matrix || IDENTITY_MATRIX;
  return matrix.every((value, index) => Math.abs(value - IDENTITY_MATRIX[index]) <= 1e-12);
}

export function transformPoint(matrix, point) {
  const x = point[0];
  const y = point[1];
  const z = point[2];
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

export function transformDirection(matrix, direction) {
  const x = direction[0];
  const y = direction[1];
  const z = direction[2];
  const transformed = [
    matrix[0] * x + matrix[4] * y + matrix[8] * z,
    matrix[1] * x + matrix[5] * y + matrix[9] * z,
    matrix[2] * x + matrix[6] * y + matrix[10] * z,
  ];
  const length = Math.hypot(...transformed);
  return length > 1e-15 ? transformed.map(value => value / length) : [0, 1, 0];
}

export function transformAabb(bounds, transform) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let mask = 0; mask < 8; mask++) {
    const point = transformPoint(transform.matrix, [
      (mask & 1) ? bounds.max[0] : bounds.min[0],
      (mask & 2) ? bounds.max[1] : bounds.min[1],
      (mask & 4) ? bounds.max[2] : bounds.min[2],
    ]);
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  }
  return { min, max };
}

export function composeTransforms(parent, child) {
  const translation = transformPoint(parent.matrix, child.translation);
  const [ax, ay, az, aw] = parent.rotation;
  const [bx, by, bz, bw] = child.rotation;
  const rotation = normalizeQuaternion([
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]);
  return normalizeTransform({ translation, rotation, scale: parent.scale * child.scale });
}
