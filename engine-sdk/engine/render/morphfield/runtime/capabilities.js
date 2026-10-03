// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const BUFFER_USAGE_FALLBACK = Object.freeze({
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
  QUERY_RESOLVE: 0x0200,
});

const TEXTURE_USAGE_FALLBACK = Object.freeze({
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
});

const SHADER_STAGE_FALLBACK = Object.freeze({
  VERTEX: 0x01,
  FRAGMENT: 0x02,
  COMPUTE: 0x04,
});

function flag(tableName, fallback, name) {
  return globalThis[tableName]?.[name] ?? fallback[name] ?? 0;
}

export function bufferUsage(...names) {
  return names.reduce((usage, name) => usage | flag("GPUBufferUsage", BUFFER_USAGE_FALLBACK, name), 0);
}

export function textureUsage(...names) {
  return names.reduce((usage, name) => usage | flag("GPUTextureUsage", TEXTURE_USAGE_FALLBACK, name), 0);
}

export function shaderStages(...names) {
  return names.reduce((stages, name) => stages | flag("GPUShaderStage", SHADER_STAGE_FALLBACK, name), 0);
}

function hasFunction(value, name) {
  return Boolean(value && typeof value[name] === "function");
}

function hasFeature(features, name) {
  if (!features) return false;
  if (typeof features.has === "function") return features.has(name);
  if (Array.isArray(features)) return features.includes(name);
  if (typeof features[Symbol.iterator] === "function") {
    for (const feature of features) {
      if (feature === name) return true;
    }
  }
  return false;
}

function languageFeaturesFrom(value) {
  if (value) return value;
  try {
    return globalThis.navigator?.gpu?.wgslLanguageFeatures || null;
  } catch (_) {
    return null;
  }
}

function finiteLimit(limits, name, fallback) {
  const value = Number(limits?.[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function validateBorrowedDevice(device) {
  if (!device || typeof device !== "object") {
    throw new TypeError("MorphField: a borrowed GPUDevice-compatible object is required");
  }

  const required = [
    "createBuffer",
    "createTexture",
    "createSampler",
    "createShaderModule",
    "createBindGroupLayout",
    "createPipelineLayout",
    "createBindGroup",
    "createComputePipeline",
    "createRenderPipeline",
  ];
  const missing = required.filter((name) => !hasFunction(device, name));
  if (missing.length > 0) {
    throw new TypeError(`MorphField: device facade is missing ${missing.join(", ")}`);
  }
  if (!device.queue || !hasFunction(device.queue, "writeBuffer")) {
    throw new TypeError("MorphField: device facade must expose queue.writeBuffer");
  }

  return device;
}

export function validateExternalEncoder(encoder) {
  if (!encoder || !hasFunction(encoder, "beginComputePass") || !hasFunction(encoder, "beginRenderPass")) {
    throw new TypeError("MorphField.encode: an external GPUCommandEncoder-compatible object is required");
  }
  if (hasFunction(encoder, "finish")) {
    // A real command encoder has finish(). MorphField deliberately never invokes it.
    return encoder;
  }
  return encoder;
}

export function inspectDeviceCapabilities(device) {
  validateBorrowedDevice(device);
  const features = device.features;
  const limits = device.limits || {};
  const capabilities = {
    optional: {
      timestampQuery: hasFeature(features, "timestamp-query"),
      shaderF16: hasFeature(features, "shader-f16"),
      subgroups: hasFeature(features, "subgroups"),
      indirectFirstInstance: hasFeature(features, "indirect-first-instance"),
    },
    limits: {
      maxBindGroups: finiteLimit(limits, "maxBindGroups", 4),
      maxBindingsPerBindGroup: finiteLimit(limits, "maxBindingsPerBindGroup", 1000),
      maxStorageBuffersPerShaderStage: finiteLimit(limits, "maxStorageBuffersPerShaderStage", 8),
      maxStorageBufferBindingSize: finiteLimit(limits, "maxStorageBufferBindingSize", 128 * 1024 * 1024),
      maxBufferSize: finiteLimit(limits, "maxBufferSize", 256 * 1024 * 1024),
      minStorageBufferOffsetAlignment: finiteLimit(limits, "minStorageBufferOffsetAlignment", 256),
      maxColorAttachments: finiteLimit(limits, "maxColorAttachments", 8),
      maxColorAttachmentBytesPerSample: finiteLimit(limits, "maxColorAttachmentBytesPerSample", 32),
      maxTextureDimension2D: finiteLimit(limits, "maxTextureDimension2D", 8192),
      maxComputeWorkgroupsPerDimension: finiteLimit(limits, "maxComputeWorkgroupsPerDimension", 65535),
    },
  };

  if (capabilities.limits.maxStorageBuffersPerShaderStage < 8) {
    throw new Error("MorphField: the device must support at least eight storage buffers per shader stage");
  }
  if (capabilities.limits.maxColorAttachments < 4
      || capabilities.limits.maxColorAttachmentBytesPerSample < 32) {
    throw new Error("MorphField: the device cannot support the four-target 32-byte G-buffer baseline");
  }

  return Object.freeze({
    optional: Object.freeze(capabilities.optional),
    limits: Object.freeze(capabilities.limits),
  });
}

/**
 * Reports optional compute paths separately from the portable u32 baseline.
 * Support is not evidence that a pipeline selected or used a feature; callers
 * must record those two states alongside benchmark results.
 */
export function inspectNexelComputeCapabilities(device, { wgslLanguageFeatures } = {}) {
  validateBorrowedDevice(device);
  const deviceFeatures = device.features;
  const languageFeatures = languageFeaturesFrom(wgslLanguageFeatures);
  const packedDot = hasFeature(languageFeatures, 'packed_4x8_integer_dot_product');
  return Object.freeze({
    portableU32: true,
    device: Object.freeze({
      shaderF16: hasFeature(deviceFeatures, 'shader-f16'),
      subgroups: hasFeature(deviceFeatures, 'subgroups'),
      subgroupSizeControl: hasFeature(deviceFeatures, 'subgroup-size-control'),
      timestampQuery: hasFeature(deviceFeatures, 'timestamp-query'),
    }),
    language: Object.freeze({
      packed4x8IntegerDotProduct: packedDot,
      subgroups: hasFeature(languageFeatures, 'subgroups'),
      readonlyAndReadwriteStorageTextures: hasFeature(languageFeatures, 'readonly_and_readwrite_storage_textures'),
    }),
    selected: Object.freeze({
      affineDecode: 'portable-u32',
      neuralDot: packedDot ? 'benchmark-w8a8-dp4a-against-portable' : 'portable-scalar',
    }),
    used: Object.freeze({
      affineDecode: Object.freeze(['u32', 'xor', 'shift', 'mask']),
      optionalFeatures: Object.freeze([]),
    }),
  });
}

export function positiveExtent(value, maximum) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < 1) return 1;
  return Math.min(number, maximum);
}
