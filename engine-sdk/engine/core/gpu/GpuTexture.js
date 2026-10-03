// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  DEFAULT_COLOR_FORMAT,
  DEFAULT_DEPTH_FORMAT,
  DEFAULT_SAMPLE_COUNT,
} from "./GpuFormats.js";
import { recordTextureCreate } from "./GpuMetrics.js";

function createAttachmentTexture(
  device,
  width,
  height,
  format,
  usage,
  sampleCount,
  label
) {
  const descriptor = {
    size: {
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height)),
      depthOrArrayLayers: 1,
    },
    format,
    usage,
    sampleCount,
  };
  if (label) {
    descriptor.label = label;
  }

  const texture = device.createTexture(descriptor);
  const view = texture.createView();

  recordTextureCreate(descriptor.size.width, descriptor.size.height);

  return {
    texture,
    view,
    width: descriptor.size.width,
    height: descriptor.size.height,
    format,
    sampleCount,
    usage,
    label: label || "",
  };
}

export function createColorTexture(device, width, height, options = {}) {
  const format = options.format || DEFAULT_COLOR_FORMAT;
  const sampleCount = options.sampleCount || DEFAULT_SAMPLE_COUNT;
  const usageExtra = options.usageExtra || 0;

  const usage =
    GPUTextureUsage.RENDER_ATTACHMENT |
    GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.COPY_SRC |
    GPUTextureUsage.COPY_DST |
    usageExtra;

  return createAttachmentTexture(
    device,
    width,
    height,
    format,
    usage,
    sampleCount,
    options.label
  );
}

export function createSampledTexture2D(device, width, height, options = {}) {
  const format = options.format || "rgba8unorm";
  const usageExtra = options.usageExtra || 0;

  const usage =
    GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.COPY_SRC |
    GPUTextureUsage.COPY_DST |
    usageExtra;

  return createAttachmentTexture(
    device,
    width,
    height,
    format,
    usage,
    1,
    options.label
  );
}

export function createDepthTexture(device, width, height, options = {}) {
  const format = options.format || DEFAULT_DEPTH_FORMAT;
  const sampleCount = options.sampleCount || DEFAULT_SAMPLE_COUNT;

  const usage = GPUTextureUsage.RENDER_ATTACHMENT;

  return createAttachmentTexture(
    device,
    width,
    height,
    format,
    usage,
    sampleCount,
    options.label
  );
}

export function resizeAttachmentTexture(device, handle, width, height) {
  if (!handle) {
    throw new Error("Attachment handle is required for resize");
  }

  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));

  if (handle.width === w && handle.height === h) {
    return handle;
  }

  if (handle.texture && typeof handle.texture.destroy === "function") {
    handle.texture.destroy();
  }

  return createAttachmentTexture(
    device,
    w,
    h,
    handle.format,
    handle.usage,
    handle.sampleCount,
    handle.label
  );
}

export function destroyAttachmentHandle(handle) {
  if (!handle) {
    return;
  }

  if (handle.texture && typeof handle.texture.destroy === "function") {
    handle.texture.destroy();
  }

  handle.texture = null;
  handle.view = null;
}

export function destroyAttachmentHandles(handles) {
  if (!handles) {
    return;
  }

  if (Array.isArray(handles)) {
    for (const handle of handles) {
      destroyAttachmentHandle(handle);
    }
  } else {
    destroyAttachmentHandle(handles);
  }
}
