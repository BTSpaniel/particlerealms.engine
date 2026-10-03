// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// GPU transfer helpers: staging uploads and readbacks for debugging/tools.
// These APIs are intentionally generic and engine-agnostic.

import { recordBufferCreate } from "./GpuMetrics.js";

function createStagingBuffer(device, byteSize, label, usage) {
  const size = Math.max(1, Math.floor(byteSize));
  const descriptor = {
    size,
    usage,
  };
  if (label) {
    descriptor.label = label;
  }
  const buffer = device.createBuffer(descriptor);
  recordBufferCreate(size, "staging");
  return buffer;
}

/**
 * Upload data to a GPU buffer via a transient staging buffer.
 * Useful for large or streaming uploads when you want explicit control
 * over copy operations rather than relying solely on queue.writeBuffer.
 */
export async function uploadBufferWithStaging(
  device,
  dstBuffer,
  data,
  dstOffsetBytes = 0,
  label = "gpu_staging_upload"
) {
  if (!device || !dstBuffer || !data) {
    throw new Error("uploadBufferWithStaging: device, dstBuffer, and data are required");
  }

  let byteLength;
  if (ArrayBuffer.isView(data)) {
    byteLength = data.byteLength;
  } else if (data instanceof ArrayBuffer) {
    byteLength = data.byteLength;
    data = new Uint8Array(data);
  } else {
    throw new TypeError(
      "uploadBufferWithStaging: data must be an ArrayBuffer or ArrayBufferView"
    );
  }

  const stagingUsage =
    GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC;
  const staging = createStagingBuffer(device, byteLength, label, stagingUsage);

  // Map, copy data, unmap
  await staging.mapAsync(GPUMapMode.WRITE);
  const arrayBuffer = staging.getMappedRange();
  new Uint8Array(arrayBuffer).set(
    ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data)
  );
  staging.unmap();

  const encoder = device.createCommandEncoder({ label: `${label}_encoder` });
  encoder.copyBufferToBuffer(staging, 0, dstBuffer, dstOffsetBytes, byteLength);
  const commandBuffer = encoder.finish();
  device.queue.submit([commandBuffer]);

  if (typeof staging.destroy === "function") {
    staging.destroy();
  }
}

/**
 * Read back the contents of a GPU buffer into a Uint8Array.
 * Intended for debugging and tooling, not per-frame critical paths.
 */
export async function readBufferToUint8Array(
  device,
  srcBuffer,
  byteOffset,
  byteLength,
  label = "gpu_readback_buffer"
) {
  if (!device || !srcBuffer) {
    throw new Error("readBufferToUint8Array: device and srcBuffer are required");
  }

  const size = Math.max(1, Math.floor(byteLength));
  const stagingUsage = GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST;
  const staging = createStagingBuffer(device, size, label, stagingUsage);

  const encoder = device.createCommandEncoder({ label: `${label}_encoder` });
  encoder.copyBufferToBuffer(srcBuffer, byteOffset, staging, 0, size);
  const commandBuffer = encoder.finish();
  device.queue.submit([commandBuffer]);

  await staging.mapAsync(GPUMapMode.READ);
  const mapped = staging.getMappedRange();
  const copy = new Uint8Array(mapped.byteLength);
  copy.set(new Uint8Array(mapped));
  staging.unmap();

  if (typeof staging.destroy === "function") {
    staging.destroy();
  }

  return copy;
}

function alignTo(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

/**
 * Read a 2D texture into a buffer for debugging.
 * Caller must provide bytesPerPixel for the chosen format.
 * Returns an object with the raw data and layout information.
 */
export async function readTexture2D(
  device,
  srcTexture,
  width,
  height,
  {
    bytesPerPixel,
    mipLevel = 0,
    label = "gpu_readback_texture2d",
  }
) {
  if (!device || !srcTexture) {
    throw new Error("readTexture2D: device and srcTexture are required");
  }
  if (!bytesPerPixel || bytesPerPixel <= 0) {
    throw new Error("readTexture2D: bytesPerPixel must be a positive number");
  }

  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));

  const bytesPerRow = alignTo(w * bytesPerPixel, 256);
  const rowsPerImage = h;
  const size = bytesPerRow * rowsPerImage;

  const stagingUsage = GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST;
  const staging = createStagingBuffer(device, size, label, stagingUsage);

  const encoder = device.createCommandEncoder({ label: `${label}_encoder` });
  encoder.copyTextureToBuffer(
    {
      texture: srcTexture,
      mipLevel,
      origin: { x: 0, y: 0, z: 0 },
    },
    {
      buffer: staging,
      bytesPerRow,
      rowsPerImage,
    },
    {
      width: w,
      height: h,
      depthOrArrayLayers: 1,
    }
  );
  const commandBuffer = encoder.finish();
  device.queue.submit([commandBuffer]);

  await staging.mapAsync(GPUMapMode.READ);
  const mapped = staging.getMappedRange();
  const copy = new Uint8Array(mapped.byteLength);
  copy.set(new Uint8Array(mapped));
  staging.unmap();

  if (typeof staging.destroy === "function") {
    staging.destroy();
  }

  return {
    data: copy,
    width: w,
    height: h,
    bytesPerPixel,
    bytesPerRow,
    rowsPerImage,
  };
}
