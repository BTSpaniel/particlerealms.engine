// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/import/GpuUploader.js — upload EngineModel primitives to the GPU.
//
// Parsing is GPU-free; this is the separate, device-driven step (spec §9: upload
// GPU buffers incrementally). Each primitive is interleaved into a standard
// [position(3), normal(3), uv(2)] vertex layout (generating flat normals when a
// source lacks them) plus an optional index buffer, so the importer/viewer and
// the engine renderer can draw it with one shared layout. Buffers are recorded
// on `primitive.gpu`; `model.gpuReady` flips true when all primitives upload.

export const STANDARD_STRIDE_FLOATS = 8; // pos3 + nrm3 + uv2

/** The WebGPU vertex buffer layout matching interleaveStandard(). */
export function standardVertexLayout() {
  return {
    arrayStride: STANDARD_STRIDE_FLOATS * 4,
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },  // position
      { shaderLocation: 1, offset: 12, format: 'float32x3' }, // normal
      { shaderLocation: 2, offset: 24, format: 'float32x2' }, // uv
    ],
  };
}

/** Build flat normals (per triangle) for a non-indexed or indexed position set. */
function computeFlatNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  const addFace = (a, b, c) => {
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { normals[i * 3] += nx; normals[i * 3 + 1] += ny; normals[i * 3 + 2] += nz; }
  };
  if (indices) for (let i = 0; i < indices.length; i += 3) addFace(indices[i], indices[i + 1], indices[i + 2]);
  else for (let i = 0; i < positions.length / 3; i += 3) addFace(i, i + 1, i + 2);
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= len; normals[i + 1] /= len; normals[i + 2] /= len;
  }
  return normals;
}

/** Interleave a primitive's attributes into the standard layout. */
export function interleaveStandard(primitive) {
  const pos = primitive.attributes.position;
  if (!pos) return null;
  const vertexCount = pos.length / 3;
  const nrm = primitive.attributes.normal && primitive.attributes.normal.length === pos.length
    ? primitive.attributes.normal
    : computeFlatNormals(pos, primitive.indices);
  const uv = primitive.attributes.uv0 && primitive.attributes.uv0.length === vertexCount * 2
    ? primitive.attributes.uv0 : null;
  const out = new Float32Array(vertexCount * STANDARD_STRIDE_FLOATS);
  for (let i = 0; i < vertexCount; i++) {
    const o = i * STANDARD_STRIDE_FLOATS;
    out[o] = pos[i * 3]; out[o + 1] = pos[i * 3 + 1]; out[o + 2] = pos[i * 3 + 2];
    out[o + 3] = nrm[i * 3]; out[o + 4] = nrm[i * 3 + 1]; out[o + 5] = nrm[i * 3 + 2];
    out[o + 6] = uv ? uv[i * 2] : 0; out[o + 7] = uv ? uv[i * 2 + 1] : 0;
  }
  return { data: out, vertexCount };
}

/**
 * Upload one primitive to the GPU. Records `primitive.gpu`.
 * @returns {object|null} the gpu descriptor
 */
export function uploadPrimitive(device, primitive) {
  const inter = interleaveStandard(primitive);
  if (!inter) return null;
  const vertexBuffer = device.createBuffer({
    size: inter.data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, inter.data);

  let indexBuffer = null;
  let indexCount = 0;
  let indexFormat = 'uint32';
  if (primitive.indices && primitive.indices.length) {
    indexCount = primitive.indices.length;
    const use32 = !(primitive.indices instanceof Uint16Array);
    indexFormat = use32 ? 'uint32' : 'uint16';
    const idx = use32 ? (primitive.indices instanceof Uint32Array ? primitive.indices : new Uint32Array(primitive.indices)) : primitive.indices;
    // queue.writeBuffer requires a size that is a multiple of 4; pad uint16 with
    // an odd index count (e.g. a single triangle = 6 bytes) up to 4-byte stride.
    const raw = new Uint8Array(idx.buffer, idx.byteOffset, idx.byteLength);
    const padded = raw.byteLength % 4 === 0 ? raw : (() => { const p = new Uint8Array(Math.ceil(raw.byteLength / 4) * 4); p.set(raw); return p; })();
    indexBuffer = device.createBuffer({ size: padded.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(indexBuffer, 0, padded);
  }

  primitive.gpu = {
    vertexBuffer, indexBuffer, vertexCount: inter.vertexCount, indexCount, indexFormat,
    layout: standardVertexLayout(), strideFloats: STANDARD_STRIDE_FLOATS,
  };
  return primitive.gpu;
}

/** Upload every primitive in a model. Returns the number uploaded. */
export function uploadModel(device, model) {
  let n = 0;
  for (const prim of model.primitives) { if (uploadPrimitive(device, prim)) n++; }
  model.gpuReady = n > 0;
  return n;
}

/** Free GPU buffers held by a model's primitives. */
export function releaseModelGpu(model) {
  for (const prim of model.primitives) {
    if (!prim.gpu) continue;
    prim.gpu.vertexBuffer?.destroy?.();
    prim.gpu.indexBuffer?.destroy?.();
    prim.gpu = null;
  }
  model.gpuReady = false;
}
