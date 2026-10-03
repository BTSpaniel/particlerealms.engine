// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { matmulShapeReport } from '../math/TensorShapeMath.js';

/** Shared AGI/Engine row-major matrix kernel. The caller owns GPU resources. */
export function createMatmulShader(workgroupSize = 8, { validatePrecision = false } = {}) {
  if (!Number.isInteger(workgroupSize) || workgroupSize < 1 || workgroupSize > 16) throw new RangeError('Invalid matrix workgroup size');
  return /* wgsl */`
@group(0) @binding(0) var<storage, read> matrixA: array<f32>;
@group(0) @binding(1) var<storage, read> matrixB: array<f32>;
@group(0) @binding(2) var<storage, read_write> matrixC: array<f32>;
@group(0) @binding(3) var<uniform> dims: vec3<u32>;
${validatePrecision ? '@group(0) @binding(4) var<storage, read_write> precisionStatus: atomic<u32>;' : ''}
@compute @workgroup_size(${workgroupSize}, ${workgroupSize})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let row = id.x; let col = id.y;
  if (row >= dims.x || col >= dims.z) { return; }
  var sum = 0.0; var correction = 0.0; var absoluteSum = 0.0;
  for (var k = 0u; k < dims.y; k++) {
    let product = matrixA[row * dims.y + k] * matrixB[k * dims.z + col];
    let adjusted = product - correction;
    let next = sum + adjusted;
    correction = (next - sum) - adjusted;
    sum = next; absoluteSum += abs(product);
  }
  matrixC[row * dims.z + col] = sum;
  ${validatePrecision ? `let errorBound = 0.000002 * absoluteSum + 1.0e-37 * f32(dims.y);
  if (!(abs(sum) <= 3.4e38) || !(errorBound <= 0.0001 + 0.00002 * abs(sum))) { atomicOr(&precisionStatus, 1u); }` : ''}
}`;
}

export function validateMatrixMultiply(a, b, { rows, inner, columns } = {}, { scanValues = true } = {}) {
  if (!(a instanceof Float32Array) || !(b instanceof Float32Array)) throw new TypeError('Matrix multiplication requires Float32Array inputs');
  for (const [name, value] of Object.entries({ rows, inner, columns })) if (!Number.isSafeInteger(value) || value < 1 || value > (name === 'inner' ? 4096 : 65536)) throw new RangeError(`Invalid matrix ${name}`);
  const shape = matmulShapeReport([rows, inner], [inner, columns]);
  if (!shape.valid || a.length !== rows * inner || b.length !== inner * columns || rows * columns > 16_777_216 || rows * inner * columns > 1_000_000_000) throw new RangeError('Matrix shape or operation budget exceeded');
  if (scanValues) for (const matrix of [a, b]) for (const value of matrix) if (!Number.isFinite(value) || Math.abs(value) > 10000) throw new RangeError('Matrix inputs require finite values within ±10000');
  return { rows, inner, columns };
}

/** Compensated Float32 reference matching the shared WGSL accumulation schedule. */
export function matrixMultiplyF32(a, b, dimensions) {
  const { rows, inner, columns } = validateMatrixMultiply(a, b, dimensions), output = new Float32Array(rows * columns), f = Math.fround;
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    let sum = 0, correction = 0;
    for (let k = 0; k < inner; k++) {
      const product = f(a[row * inner + k] * b[k * columns + col]), adjusted = f(product - correction), next = f(sum + adjusted);
      correction = f(f(next - sum) - adjusted); sum = next;
    }
    output[row * columns + col] = sum;
  }
  return output;
}

export default createMatmulShader;
