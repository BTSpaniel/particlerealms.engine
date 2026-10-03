// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { recordBufferCreate } from "./GpuMetrics.js";

function alignTo(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

function createBuffer(device, size, usage, label, usageKind) {
  const allocationSize = Math.max(4, alignTo(size, 4));
  const descriptor = {
    size: allocationSize,
    usage,
  };
  if (label) {
    descriptor.label = label;
  }
  const buffer = device.createBuffer(descriptor);
  recordBufferCreate(allocationSize, usageKind || "other");
  return buffer;
}

function byteView(data) {
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new TypeError("Data must be an ArrayBuffer or ArrayBufferView");
}

function writeToBuffer(device, buffer, data, offsetBytes) {
  const source = byteView(data);
  if (offsetBytes % 4 !== 0 || source.byteOffset % 4 !== 0 || source.byteLength % 4 !== 0) {
    throw new RangeError("GPU buffer writes require 4-byte-aligned offsets and byte lengths");
  }
  if (source.byteLength === 0) return;
  device.queue.writeBuffer(buffer, offsetBytes, source.buffer, source.byteOffset, source.byteLength);
}

function writeCreatedBuffer(device, buffer, data) {
  const source = byteView(data);
  if (source.byteLength === 0) return;
  if (source.byteOffset % 4 === 0 && source.byteLength % 4 === 0) {
    device.queue.writeBuffer(buffer, 0, source.buffer, source.byteOffset, source.byteLength);
    return;
  }
  const uploadSize = alignTo(source.byteLength, 4);
  const upload = new Uint8Array(uploadSize);
  upload.set(source);
  device.queue.writeBuffer(buffer, 0, upload.buffer, 0, upload.byteLength);
}

function cleanupFailure(errors, message, code) {
  const failure = new AggregateError(errors, message);
  failure.code = code;
  failure.cleanupUncertain = true;
  return failure;
}

function rollbackCreatedBuffer(buffer, primaryError, label) {
  try {
    buffer.destroy?.();
  } catch (cleanupError) {
    throw cleanupFailure(
      [primaryError, cleanupError],
      `${label} upload and rollback both failed`,
      "GPU_BUFFER_UPLOAD_ROLLBACK_FAILED"
    );
  }
  throw primaryError;
}

export function createVertexBuffer(device, data, options = {}) {
  if (!data) {
    throw new Error("Vertex buffer data is required");
  }
  const size = data.byteLength;
  const usage = GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST;
  const buffer = createBuffer(device, size, usage, options.label, "vertex");
  try {
    writeCreatedBuffer(device, buffer, data);
  } catch (error) {
    rollbackCreatedBuffer(buffer, error, "Vertex buffer");
  }
  return buffer;
}

export function createIndexBuffer(device, data, options = {}) {
  if (!data) {
    throw new Error("Index buffer data is required");
  }
  const size = data.byteLength;
  const usage = GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST;
  const buffer = createBuffer(device, size, usage, options.label, "index");
  try {
    writeCreatedBuffer(device, buffer, data);
  } catch (error) {
    rollbackCreatedBuffer(buffer, error, "Index buffer");
  }
  return buffer;
}

export function createUniformBuffer(device, byteSize, options = {}) {
  const alignedSize = alignTo(byteSize, 16);
  const usage = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
  return createBuffer(device, alignedSize, usage, options.label, "uniform");
}

export function createStorageBuffer(device, byteSizeOrData, options = {}) {
  let size = 0;
  if (typeof byteSizeOrData === "number") {
    size = byteSizeOrData;
  } else if (ArrayBuffer.isView(byteSizeOrData)) {
    size = byteSizeOrData.byteLength;
  } else if (byteSizeOrData instanceof ArrayBuffer) {
    size = byteSizeOrData.byteLength;
  } else {
    throw new TypeError(
      "Storage buffer requires a byte size or ArrayBuffer/ArrayBufferView"
    );
  }

  const baseUsage =
    GPUBufferUsage.STORAGE |
    GPUBufferUsage.COPY_DST |
    GPUBufferUsage.COPY_SRC;
  const usage = options.usageExtra
    ? baseUsage | options.usageExtra
    : baseUsage;

  const buffer = createBuffer(device, size, usage, options.label, "storage");

  if (byteSizeOrData && typeof byteSizeOrData !== "number") {
    try {
      writeCreatedBuffer(device, buffer, byteSizeOrData);
    } catch (error) {
      rollbackCreatedBuffer(buffer, error, "Storage buffer");
    }
  }

  return buffer;
}

export function updateBuffer(device, buffer, data, offsetBytes = 0) {
  writeToBuffer(device, buffer, data, offsetBytes);
}

export function destroyBuffer(buffer) {
  if (!buffer || typeof buffer.destroy !== "function") {
    return;
  }
  buffer.destroy();
}

export function destroyBuffers(buffers) {
  if (!buffers) {
    return;
  }

  const values = Array.isArray(buffers) ? buffers : [buffers];
  const errors = [];
  for (const buffer of values) {
    try {
      destroyBuffer(buffer);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw cleanupFailure(
      errors,
      `Failed to destroy ${errors.length} GPU buffer resource(s)`,
      "GPU_BUFFER_DESTROY_FAILED"
    );
  }
}
