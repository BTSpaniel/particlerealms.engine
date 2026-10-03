// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createSampledTexture2D } from "./GpuTexture.js";
import {
  createKtx2PayloadDecodeRequest,
  getKtx2LevelPayloadView,
  isKtx2Container,
  ktx2DirectUploadPlan,
  ktx2PayloadPlan,
  parseKtx2Container,
} from "./Ktx2Container.js";
import {
  textureSelectTranscodeTarget,
  textureFormatIsSupported,
  textureWebGpuUploadLayout,
} from "../math/TextureMath.js";
import {
  getDefaultSampler,
  getLinearSampler,
  getPointSampler,
} from "./GpuSampler.js";

const DEFAULT_SAMPLED_FORMAT = "rgba8unorm";
const GPU_TEXTURE_USAGE_FALLBACK = Object.freeze({
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
});

export {
  isKtx2Container,
  ktx2DirectUploadPlan,
  ktx2PayloadPlan,
  parseKtx2Container,
};

export function selectKtx2TargetFormat(features, options = {}) {
  const srgb = options.srgb === true || options.colorSpace === 'srgb';
  const semantic = String(options.semantic || options.usageClass || 'color').toLowerCase();
  const mobileOrApple = options.mobileOrApple ?? /Macintosh|iPhone|iPad|Android/i.test(
    globalThis.navigator?.userAgent || '',
  );
  const isNormalMap = semantic === 'normal' || semantic === 'normal-map';
  const candidates = (mobileOrApple
    ? [
      'astc-4x4-unorm',
      isNormalMap ? 'eac-rg11unorm' : 'etc2-rgba8unorm',
      isNormalMap ? 'bc5-rg-unorm' : 'bc7-rgba-unorm',
    ]
    : [
      isNormalMap ? 'bc5-rg-unorm' : 'bc7-rgba-unorm',
      'astc-4x4-unorm',
      isNormalMap ? 'eac-rg11unorm' : 'etc2-rgba8unorm',
    ]).map((format, index) => ({ format, priority: [1, 0.35, 0.1][index] }));
  const selected = textureSelectTranscodeTarget({
    width: options.width || 1,
    height: options.height || options.width || 1,
    mipLevels: options.mipLevels || 1,
    depthOrArrayLayers: options.depthOrArrayLayers || 1,
    candidates,
    supportedFeatures: features,
    needsAlpha: !isNormalMap && options.needsAlpha !== false,
    preferSrgb: srgb && !isNormalMap,
  });
  return Object.freeze({
    ...selected,
    compressed: Boolean(selected.feature),
    platformClass: mobileOrApple ? 'mobile-apple' : 'desktop',
  });
}

function deviceTextureFeatures(device, options = {}) {
  return options.supportedFeatures
    || options.features
    || device?.features
    || device?.getCapabilities?.()?.features
    || null;
}

function textureUsageFlag(name) {
  return globalThis.GPUTextureUsage?.[name] ?? GPU_TEXTURE_USAGE_FALLBACK[name] ?? 0;
}

function defaultSampledTextureUsage() {
  return textureUsageFlag("TEXTURE_BINDING")
    | textureUsageFlag("COPY_DST")
    | textureUsageFlag("COPY_SRC");
}

function positiveTextureExtent(value) {
  return Math.max(1, Math.floor(Number(value) || 1));
}

function toByteView(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new TypeError("GpuTextureLoader: ArrayBuffer or typed-array texture data is required");
}

function resolveKtx2Decoder(options = {}) {
  return options.decodeKtx2Payload
    || options.transcodeKtx2
    || options.decoder?.decodeKtx2Payload
    || options.decoder?.transcodeKtx2
    || null;
}

function decodedKtx2Levels(decoded) {
  if (Array.isArray(decoded?.levels)) return decoded.levels;
  if (Array.isArray(decoded?.mipLevels)) return decoded.mipLevels;
  const data = decoded?.data || decoded?.bytes || decoded?.payload;
  if (data) return [{ mipLevel: 0, data }];
  return [];
}

function decodedKtx2LevelBytes(level) {
  return toByteView(level?.data || level?.bytes || level?.payload || level);
}

function createTextureFromDecodedKtx2Payload(device, decoded, options = {}, decodeRequest = null) {
  const queue = device.queue || device.getQueue && device.getQueue();
  if (!queue || typeof queue.writeTexture !== "function") {
    throw new Error("createTextureFromDecodedKtx2Payload: device.queue.writeTexture is not available");
  }
  if (!decoded || typeof decoded !== "object") {
    throw new Error("createTextureFromDecodedKtx2Payload: decoder returned no texture payload");
  }

  const format = decoded.format || decoded.webgpuFormat || decoded.targetFormat || options.targetFormat || null;
  if (!format) {
    throw new Error("createTextureFromDecodedKtx2Payload: decoder output must include a WebGPU format");
  }
  const supportedFeatures = decoded.supportedFeatures || deviceTextureFeatures(device, options);
  if (!textureFormatIsSupported(format, supportedFeatures)) {
    throw new Error(`createTextureFromDecodedKtx2Payload: decoded format is not supported by current features: ${format}`);
  }
  const width = positiveTextureExtent(decoded.width ?? decodeRequest?.width);
  const height = positiveTextureExtent(decoded.height ?? decodeRequest?.height ?? width);
  const depthOrArrayLayers = positiveTextureExtent(
    decoded.depthOrArrayLayers
      ?? decoded.layers
      ?? decoded.depth
      ?? decodeRequest?.depthOrArrayLayers
      ?? 1
  );
  const levels = decodedKtx2Levels(decoded);
  if (levels.length === 0) {
    throw new Error("createTextureFromDecodedKtx2Payload: decoder returned no mip level data");
  }

  const descriptor = {
    size: { width, height, depthOrArrayLayers },
    format,
    mipLevelCount: positiveTextureExtent(decoded.mipLevelCount ?? levels.length),
    dimension: decoded.dimension || (Number(decoded.depth || 0) > 1 ? "3d" : "2d"),
    usage: decoded.usage ?? options.usage ?? defaultSampledTextureUsage(),
    label: decoded.label || options.label || options.debugLabel || "ktx2_decoded_texture",
  };
  const texture = device.createTexture(descriptor);
  const view = texture.createView(options.viewDescriptor || {});

  for (let index = 0; index < levels.length; index++) {
    const level = levels[index];
    const mipLevel = Math.max(0, Math.floor(Number(level?.mipLevel ?? index) || 0));
    const payload = decodedKtx2LevelBytes(level);
    const layout = textureWebGpuUploadLayout({
      width,
      height,
      depthOrArrayLayers,
      format,
      mipLevel,
    });
    const dataLayout = level?.dataLayout || {
      offset: Math.max(0, Math.floor(Number(level?.offset) || 0)),
      bytesPerRow: positiveTextureExtent(level?.bytesPerRow ?? layout.dataLayout.bytesPerRow),
      rowsPerImage: positiveTextureExtent(level?.rowsPerImage ?? layout.dataLayout.rowsPerImage),
    };
    if (dataLayout.bytesPerRow < layout.tightBytesPerRow) {
      throw new Error(`createTextureFromDecodedKtx2Payload: mip ${mipLevel} bytesPerRow is smaller than ${format} requires`);
    }
    if (payload.byteLength < layout.tightByteLength) {
      throw new Error(`createTextureFromDecodedKtx2Payload: mip ${mipLevel} payload is too small for ${format}`);
    }
    queue.writeTexture(
      {
        texture,
        mipLevel,
        origin: level?.origin || { x: 0, y: 0, z: 0 },
      },
      payload,
      dataLayout,
      level?.copySize || layout.copySize
    );
  }

  const sampler = chooseSampler(device, options.samplerKind || options.sampler);
  return {
    handle: {
      texture,
      view,
      width,
      height,
      format,
      sampleCount: 1,
      usage: descriptor.usage,
      label: descriptor.label,
    },
    texture,
    view,
    sampler,
    width,
    height,
    format,
    mipLevelCount: descriptor.mipLevelCount,
    label: descriptor.label,
    ktx2: {
      decodeRequest,
      decoded: {
        format,
        width,
        height,
        depthOrArrayLayers,
        mipLevelCount: descriptor.mipLevelCount,
      },
    },
  };
}

function getExternalImageSize(source) {
  if (!source) {
    throw new Error("GpuTextureLoader: source is required");
  }

  if (typeof source.naturalWidth === "number" && source.naturalWidth > 0) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }

  if (typeof source.width === "number" && typeof source.height === "number") {
    return { width: source.width, height: source.height };
  }

  throw new Error("GpuTextureLoader: unable to determine source dimensions");
}

function chooseSampler(device, samplerKind) {
  const kind = samplerKind || "default";
  switch (kind) {
    case "point":
      return getPointSampler(device);
    case "linear":
      return getLinearSampler(device);
    case "default":
    default:
      return getDefaultSampler(device);
  }
}

async function loadImageElementFromUrl(url, options = {}) {
  if (typeof Image === "undefined") {
    throw new Error("GpuTextureLoader: Image constructor is not available in this environment");
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    if (options.crossOrigin) {
      img.crossOrigin = options.crossOrigin;
    } else {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => {
      resolve(img);
    };
    img.onerror = (event) => {
      reject(new Error("GpuTextureLoader: failed to load image from URL: " + url));
    };
    img.src = url;
  });
}

async function createTextureFromExternalImage(device, source, options = {}) {
  if (!device) {
    throw new Error("GpuTextureLoader.createTextureFromExternalImage: device is required");
  }

  const size = getExternalImageSize(source);
  const width = Math.max(1, Math.floor(size.width));
  const height = Math.max(1, Math.floor(size.height));

  const format = options.format || DEFAULT_SAMPLED_FORMAT;
  const label = options.label || options.debugLabel || "sampled_texture";

  const handle = createSampledTexture2D(device, width, height, {
    format,
    usageExtra: options.usageExtra,
    label,
  });

  const queue = device.queue || device.getQueue && device.getQueue();
  if (!queue || typeof queue.copyExternalImageToTexture !== "function") {
    throw new Error("GpuTextureLoader: device.queue.copyExternalImageToTexture is not available");
  }

  queue.copyExternalImageToTexture(
    { source },
    { texture: handle.texture },
    { width, height }
  );

  const sampler = chooseSampler(device, options.samplerKind || options.sampler);

  if (options.debug) {
    const sourceLabel = options.url || label;
    console.log("GpuTextureLoader: loaded texture", {
      source: sourceLabel,
      width,
      height,
      format: handle.format,
      samplerKind: options.samplerKind || options.sampler || "default",
    });
  }

  return {
    handle,
    texture: handle.texture,
    view: handle.view,
    sampler,
    width,
    height,
    format: handle.format,
    label: handle.label,
  };
}

export async function loadTextureFromUrl(device, url, options = {}) {
  if (!url) {
    throw new Error("loadTextureFromUrl: url is required");
  }

  const image = await loadImageElementFromUrl(url, options.imageOptions || {});

  return createTextureFromExternalImage(device, image, {
    ...options,
    url,
  });
}

export function createTextureFromKtx2Data(device, data, options = {}) {
  if (!device) {
    throw new Error("createTextureFromKtx2Data: device is required");
  }
  const queue = device.queue || device.getQueue && device.getQueue();
  if (!queue || typeof queue.writeTexture !== "function") {
    throw new Error("createTextureFromKtx2Data: device.queue.writeTexture is not available");
  }

  const bytes = toByteView(data);
  const supportedFeatures = deviceTextureFeatures(device, options);
  const plan = ktx2DirectUploadPlan(bytes, {
    ...options,
    supportedFeatures,
    usage: options.usage ?? defaultSampledTextureUsage(),
  });
  if (!plan.directUploadReady || !plan.textureDescriptor) {
    throw new Error(`createTextureFromKtx2Data: KTX2 payload is not direct-upload ready: ${plan.issues.join(", ") || "unknown"}`);
  }

  const descriptor = {
    ...plan.textureDescriptor,
    label: options.label || options.debugLabel || "ktx2_texture",
  };
  const texture = device.createTexture(descriptor);
  const view = texture.createView(options.viewDescriptor || {});

  for (const level of plan.levels) {
    const payload = getKtx2LevelPayloadView(bytes, level.mipLevel);
    queue.writeTexture(
      {
        texture,
        mipLevel: level.mipLevel,
        origin: level.writeTexture.destination.origin,
      },
      payload,
      {
        offset: 0,
        bytesPerRow: level.writeTexture.dataLayout.bytesPerRow,
        rowsPerImage: level.writeTexture.dataLayout.rowsPerImage,
      },
      level.writeTexture.copySize
    );
  }

  const sampler = chooseSampler(device, options.samplerKind || options.sampler);
  return {
    handle: {
      texture,
      view,
      width: descriptor.size.width,
      height: descriptor.size.height,
      format: descriptor.format,
      sampleCount: 1,
      usage: descriptor.usage,
      label: descriptor.label,
    },
    texture,
    view,
    sampler,
    width: descriptor.size.width,
    height: descriptor.size.height,
    format: descriptor.format,
    mipLevelCount: descriptor.mipLevelCount,
    label: descriptor.label,
    ktx2: plan,
  };
}

export async function createTextureFromKtx2DataWithDecoder(device, data, options = {}) {
  const bytes = toByteView(data);
  const supportedFeatures = deviceTextureFeatures(device, options);
  const container = parseKtx2Container(bytes, options);
  const explicitTargetSupported = !options.targetFormat
    || textureFormatIsSupported(options.targetFormat, supportedFeatures);
  if (!explicitTargetSupported) {
    throw new Error(`createTextureFromKtx2DataWithDecoder: explicit target format is not supported by current features: ${options.targetFormat}`);
  }
  const targetSelection = options.targetFormat
    ? Object.freeze({
      ...textureSelectTranscodeTarget({
        candidates: [options.targetFormat],
        supportedFeatures,
        needsAlpha: options.needsAlpha !== false,
        preferSrgb: options.srgb === true || options.colorSpace === 'srgb',
      }),
      compressed: options.targetFormat !== 'rgba8unorm'
        && options.targetFormat !== 'rgba8unorm-srgb',
      platformClass: 'explicit',
    })
    : selectKtx2TargetFormat(supportedFeatures, {
      ...options,
      width: container.header?.pixelWidth,
      height: container.header?.pixelHeight,
      mipLevels: container.header?.levelCount,
      depthOrArrayLayers: container.header?.layerCount || container.header?.pixelDepth || 1,
    });
  const resolvedOptions = {
    ...options,
    container,
    supportedFeatures,
    targetFormat: targetSelection.format,
  };
  const directPlan = ktx2DirectUploadPlan(bytes, {
    ...resolvedOptions,
    usage: options.usage ?? defaultSampledTextureUsage(),
  });
  if (directPlan.directUploadReady) {
    const uploaded = createTextureFromKtx2Data(device, bytes, resolvedOptions);
    uploaded.ktx2 = { ...uploaded.ktx2, targetSelection };
    return uploaded;
  }

  const payloadPlan = ktx2PayloadPlan(bytes, resolvedOptions);
  if (!payloadPlan.requiresPayloadDecoder) {
    throw new Error(`createTextureFromKtx2DataWithDecoder: KTX2 payload is not direct-upload ready: ${directPlan.issues.join(", ") || "unknown"}`);
  }

  const decoder = resolveKtx2Decoder(resolvedOptions);
  if (typeof decoder !== "function") {
    throw new Error(`createTextureFromKtx2DataWithDecoder: KTX2 payload requires a decoder/transcoder hook: ${payloadPlan.scheme?.name || "unknown"}`);
  }

  const decodeRequest = createKtx2PayloadDecodeRequest(bytes, resolvedOptions);
  if (!decodeRequest.valid) {
    throw new Error(`createTextureFromKtx2DataWithDecoder: KTX2 decode request is invalid: ${decodeRequest.issues.join(", ") || "unknown"}`);
  }

  const decoded = await decoder(decodeRequest);
  const uploaded = createTextureFromDecodedKtx2Payload(device, decoded, resolvedOptions, decodeRequest);
  uploaded.ktx2.targetSelection = targetSelection;
  return uploaded;
}

export async function loadKtx2TextureFromUrl(device, url, options = {}) {
  if (!url) {
    throw new Error("loadKtx2TextureFromUrl: url is required");
  }

  const response = await fetch(url, options.fetchOptions || {});
  if (!response.ok) {
    throw new Error(`loadKtx2TextureFromUrl: failed to fetch ${url}: HTTP ${response.status}`);
  }

  const data = await response.arrayBuffer();
  return createTextureFromKtx2DataWithDecoder(device, data, {
    ...options,
    url,
  });
}

export function inspectKtx2TextureData(data, options = {}) {
  const container = parseKtx2Container(data, options);
  return {
    container,
    payloadPlan: ktx2PayloadPlan(container, options),
    directUploadPlan: ktx2DirectUploadPlan(container, options),
  };
}

export async function inspectKtx2TextureFromUrl(url, options = {}) {
  if (!url) {
    throw new Error("inspectKtx2TextureFromUrl: url is required");
  }

  const response = await fetch(url, options.fetchOptions || {});
  if (!response.ok) {
    throw new Error(`inspectKtx2TextureFromUrl: failed to fetch ${url}: HTTP ${response.status}`);
  }

  const data = await response.arrayBuffer();
  return inspectKtx2TextureData(data, options);
}

export async function createTextureFromImage(device, image, options = {}) {
  if (!image) {
    throw new Error("createTextureFromImage: image is required");
  }

  return createTextureFromExternalImage(device, image, options);
}

export async function createTextureFromImageBitmap(device, bitmap, options = {}) {
  if (!bitmap) {
    throw new Error("createTextureFromImageBitmap: bitmap is required");
  }

  return createTextureFromExternalImage(device, bitmap, options);
}
