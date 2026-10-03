// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * TextureMath.js - shared UV, atlas, format, and mip pyramid helpers.
 */

import { clamp, mod, saturate, smoothstep } from './MathScalar.js';
import { qualitySizeScore } from './MathQuality.js';
import { vec2FMA } from './MathVec2.js';

export const TEXTURE_FORMAT_BLOCKS = Object.freeze({
  r8unorm: [1, 1, 1],
  r8snorm: [1, 1, 1],
  r8uint: [1, 1, 1],
  r8sint: [1, 1, 1],
  r16uint: [1, 1, 2],
  r16sint: [1, 1, 2],
  r16float: [1, 1, 2],
  rg8unorm: [1, 1, 2],
  rg8snorm: [1, 1, 2],
  rg8uint: [1, 1, 2],
  rg8sint: [1, 1, 2],
  r32uint: [1, 1, 4],
  r32sint: [1, 1, 4],
  r32float: [1, 1, 4],
  rg16uint: [1, 1, 4],
  rg16sint: [1, 1, 4],
  rg16float: [1, 1, 4],
  rgba8unorm: [1, 1, 4],
  'rgba8unorm-srgb': [1, 1, 4],
  rgba8snorm: [1, 1, 4],
  rgba8uint: [1, 1, 4],
  rgba8sint: [1, 1, 4],
  bgra8unorm: [1, 1, 4],
  'bgra8unorm-srgb': [1, 1, 4],
  rgb10a2unorm: [1, 1, 4],
  rg11b10ufloat: [1, 1, 4],
  rgb9e5ufloat: [1, 1, 4],
  rg32uint: [1, 1, 8],
  rg32sint: [1, 1, 8],
  rg32float: [1, 1, 8],
  rgba16uint: [1, 1, 8],
  rgba16sint: [1, 1, 8],
  rgba16float: [1, 1, 8],
  rgba32uint: [1, 1, 16],
  rgba32sint: [1, 1, 16],
  rgba32float: [1, 1, 16],
  stencil8: [1, 1, 1],
  depth16unorm: [1, 1, 2],
  depth24plus: [1, 1, 4],
  'depth24plus-stencil8': [1, 1, 4],
  depth32float: [1, 1, 4],
  'depth32float-stencil8': [1, 1, 5],
  'bc1-rgba-unorm': [4, 4, 8],
  'bc1-rgba-unorm-srgb': [4, 4, 8],
  'bc2-rgba-unorm': [4, 4, 16],
  'bc2-rgba-unorm-srgb': [4, 4, 16],
  'bc3-rgba-unorm': [4, 4, 16],
  'bc3-rgba-unorm-srgb': [4, 4, 16],
  'bc4-r-unorm': [4, 4, 8],
  'bc4-r-snorm': [4, 4, 8],
  'bc5-rg-unorm': [4, 4, 16],
  'bc5-rg-snorm': [4, 4, 16],
  'bc6h-rgb-ufloat': [4, 4, 16],
  'bc6h-rgb-float': [4, 4, 16],
  'bc7-rgba-unorm': [4, 4, 16],
  'bc7-rgba-unorm-srgb': [4, 4, 16],
  'etc2-rgb8unorm': [4, 4, 8],
  'etc2-rgb8unorm-srgb': [4, 4, 8],
  'etc2-rgb8a1unorm': [4, 4, 8],
  'etc2-rgb8a1unorm-srgb': [4, 4, 8],
  'etc2-rgba8unorm': [4, 4, 16],
  'etc2-rgba8unorm-srgb': [4, 4, 16],
  'eac-r11unorm': [4, 4, 8],
  'eac-r11snorm': [4, 4, 8],
  'eac-rg11unorm': [4, 4, 16],
  'eac-rg11snorm': [4, 4, 16],
  'astc-4x4-unorm': [4, 4, 16],
  'astc-4x4-unorm-srgb': [4, 4, 16],
  'astc-5x4-unorm': [5, 4, 16],
  'astc-5x4-unorm-srgb': [5, 4, 16],
  'astc-5x5-unorm': [5, 5, 16],
  'astc-5x5-unorm-srgb': [5, 5, 16],
  'astc-6x5-unorm': [6, 5, 16],
  'astc-6x5-unorm-srgb': [6, 5, 16],
  'astc-6x6-unorm': [6, 6, 16],
  'astc-6x6-unorm-srgb': [6, 6, 16],
  'astc-8x5-unorm': [8, 5, 16],
  'astc-8x5-unorm-srgb': [8, 5, 16],
  'astc-8x6-unorm': [8, 6, 16],
  'astc-8x6-unorm-srgb': [8, 6, 16],
  'astc-8x8-unorm': [8, 8, 16],
  'astc-8x8-unorm-srgb': [8, 8, 16],
  'astc-10x5-unorm': [10, 5, 16],
  'astc-10x5-unorm-srgb': [10, 5, 16],
  'astc-10x6-unorm': [10, 6, 16],
  'astc-10x6-unorm-srgb': [10, 6, 16],
  'astc-10x8-unorm': [10, 8, 16],
  'astc-10x8-unorm-srgb': [10, 8, 16],
  'astc-10x10-unorm': [10, 10, 16],
  'astc-10x10-unorm-srgb': [10, 10, 16],
  'astc-12x10-unorm': [12, 10, 16],
  'astc-12x10-unorm-srgb': [12, 10, 16],
  'astc-12x12-unorm': [12, 12, 16],
  'astc-12x12-unorm-srgb': [12, 12, 16],
});

export const TEXTURE_TRANSCODE_TARGETS = Object.freeze([
  { format: 'bc7-rgba-unorm', family: 'bc', alpha: 'full', quality: 0.96, priority: 1 },
  { format: 'bc1-rgba-unorm', family: 'bc', alpha: 'punchthrough', quality: 0.86, priority: 1 },
  { format: 'astc-4x4-unorm', family: 'astc', alpha: 'full', quality: 0.92, priority: 0.9 },
  { format: 'etc2-rgba8unorm', family: 'etc2', alpha: 'full', quality: 0.82, priority: 0.8 },
  { format: 'etc2-rgb8unorm', family: 'etc2', alpha: 'none', quality: 0.78, priority: 0.8 },
  { format: 'rgba8unorm', family: 'uncompressed', alpha: 'full', quality: 1, priority: 0.1 },
]);

export const KTX_SUPERCOMPRESSION_SCHEMES = Object.freeze({
  NONE: 0,
  BASIS_LZ: 1,
  ZSTANDARD: 2,
  ZLIB: 3,
  ASOBO: 0x10000,
});

export const WEBGPU_COPY_BYTES_PER_ROW_ALIGNMENT = 256;

function finiteOrDefault(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function textureFormatKey(format = 'rgba8unorm') {
  return String(format || 'rgba8unorm').toLowerCase();
}

function positiveExtent(value) {
  return Math.max(1, Math.floor(finiteOrDefault(value, 1)));
}

function nonNegativeInteger(value) {
  return Math.max(0, Math.floor(finiteOrDefault(value)));
}

function positiveCount(value) {
  return Math.max(1, Math.floor(finiteOrDefault(value, 1)));
}

function gcd(a, b) {
  let x = Math.abs(nonNegativeInteger(a));
  let y = Math.abs(nonNegativeInteger(b));
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

function lcm(a, b) {
  const x = positiveCount(a);
  const y = positiveCount(b);
  return (x / gcd(x, y)) * y;
}

function uint16Lane(value) {
  return clamp(nonNegativeInteger(value), 0, 0xffff);
}

function finiteVec2(value, fallback = [0, 0]) {
  const source = Array.isArray(value) || ArrayBuffer.isView(value) ? value : fallback;
  return [
    finiteOrDefault(source[0], fallback[0]),
    finiteOrDefault(source[1], fallback[1]),
  ];
}

export function uvWrap(uv, min = [0, 0], max = [1, 1]) {
  const v = finiteVec2(uv);
  const lo = finiteVec2(min);
  const hi = finiteVec2(max, [1, 1]);
  return [
    hi[0] === lo[0] ? lo[0] : lo[0] + mod(v[0] - lo[0], hi[0] - lo[0]),
    hi[1] === lo[1] ? lo[1] : lo[1] + mod(v[1] - lo[1], hi[1] - lo[1]),
  ];
}

export function uvClamp(uv, min = [0, 0], max = [1, 1]) {
  const v = finiteVec2(uv);
  const lo = finiteVec2(min);
  const hi = finiteVec2(max, [1, 1]);
  return [clamp(v[0], lo[0], hi[0]), clamp(v[1], lo[1], hi[1])];
}

export function uvMirror(uv) {
  const v = finiteVec2(uv);
  const mirror = (x) => 1 - Math.abs(mod(x, 2) - 1);
  return [mirror(v[0]), mirror(v[1])];
}

export function tileUV(uv, scale = [1, 1], offset = [0, 0]) {
  const v = finiteVec2(uv);
  const s = finiteVec2(scale, [1, 1]);
  const o = finiteVec2(offset);
  return vec2FMA(v, s, o);
}

export function textureTransformUV(uv, transform = {}) {
  const v = finiteVec2(uv);
  const t = transform || {};
  const offset = Array.isArray(t.offset) || ArrayBuffer.isView(t.offset)
    ? finiteVec2(t.offset)
    : [finiteOrDefault(t.offsetX), finiteOrDefault(t.offsetY)];
  const scale = Array.isArray(t.scale) || ArrayBuffer.isView(t.scale)
    ? finiteVec2(t.scale, [1, 1])
    : [finiteOrDefault(t.scaleX, 1), finiteOrDefault(t.scaleY, 1)];
  const origin = Array.isArray(t.origin) || ArrayBuffer.isView(t.origin)
    ? finiteVec2(t.origin)
    : [finiteOrDefault(t.originX), finiteOrDefault(t.originY)];
  const rotation = finiteOrDefault(t.rotation ?? t.rotationRadians, 0);
  const x = (v[0] - origin[0]) * scale[0];
  const y = (v[1] - origin[1]) * scale[1];
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  return [
    origin[0] + offset[0] + x * c - y * s,
    origin[1] + offset[1] + x * s + y * c,
  ];
}

export function atlasUVTransform(x, y, width, height, atlasWidth, atlasHeight = atlasWidth) {
  const aw = positiveExtent(atlasWidth);
  const ah = positiveExtent(atlasHeight);
  return {
    offsetX: finiteOrDefault(x) / aw,
    offsetY: finiteOrDefault(y) / ah,
    scaleX: finiteOrDefault(width) / aw,
    scaleY: finiteOrDefault(height) / ah,
  };
}

export function textureMipExtent3D(width, height = width, depth = 1, mipLevel = 0) {
  const divisor = 2 ** Math.max(0, Math.floor(finiteOrDefault(mipLevel)));
  return {
    width: Math.max(1, Math.floor(positiveExtent(width) / divisor)),
    height: Math.max(1, Math.floor(positiveExtent(height) / divisor)),
    depth: Math.max(1, Math.floor(positiveExtent(depth) / divisor)),
  };
}

export function atlasUV(uv, transform) {
  const v = finiteVec2(uv);
  const t = transform || {};
  return [
    finiteOrDefault(t.offsetX) + v[0] * finiteOrDefault(t.scaleX, 1),
    finiteOrDefault(t.offsetY) + v[1] * finiteOrDefault(t.scaleY, 1),
  ];
}

export function atlasPaddedExtent(width, height = width, padding = 1) {
  const pad = nonNegativeInteger(padding);
  const contentWidth = positiveExtent(width);
  const contentHeight = positiveExtent(height);
  return {
    width: contentWidth + pad * 2,
    height: contentHeight + pad * 2,
    contentWidth,
    contentHeight,
    padding: pad,
  };
}

export function atlasContentRect(x, y, width, height, padding = 1) {
  const padded = atlasPaddedExtent(width, height, padding);
  const paddedX = finiteOrDefault(x);
  const paddedY = finiteOrDefault(y);
  return {
    x: paddedX + padded.padding,
    y: paddedY + padded.padding,
    width: padded.contentWidth,
    height: padded.contentHeight,
    paddedX,
    paddedY,
    paddedWidth: padded.width,
    paddedHeight: padded.height,
    padding: padded.padding,
  };
}

export function atlasPaddedRectFromContent(x, y, width, height, padding = 1) {
  const padded = atlasPaddedExtent(width, height, padding);
  return {
    x: finiteOrDefault(x) - padded.padding,
    y: finiteOrDefault(y) - padded.padding,
    width: padded.width,
    height: padded.height,
    padding: padded.padding,
  };
}

export function atlasPaddedArea(width, height, padding = 1) {
  const padded = atlasPaddedExtent(width, height, padding);
  return padded.width * padded.height;
}

export function atlasRegionUVs(x, y, width, height, atlasWidth, atlasHeight = atlasWidth) {
  const transform = atlasUVTransform(x, y, width, height, atlasWidth, atlasHeight);
  return {
    u0: transform.offsetX,
    v0: transform.offsetY,
    u1: transform.offsetX + transform.scaleX,
    v1: transform.offsetY + transform.scaleY,
  };
}

export function virtualTexturePageGrid(pageTableWidth = 2048, pageTableHeight = pageTableWidth) {
  const width = positiveExtent(pageTableWidth);
  const height = positiveExtent(pageTableHeight);
  return {
    width,
    height,
    pageCount: width * height,
  };
}

export function virtualTexturePageId(pageX, pageY, pageTableWidth = 2048, pageTableHeight = pageTableWidth) {
  const grid = virtualTexturePageGrid(pageTableWidth, pageTableHeight);
  const x = clamp(nonNegativeInteger(pageX), 0, grid.width - 1);
  const y = clamp(nonNegativeInteger(pageY), 0, grid.height - 1);
  return y * grid.width + x;
}

export function virtualTexturePageCoord(pageId, pageTableWidth = 2048, pageTableHeight = pageTableWidth) {
  const grid = virtualTexturePageGrid(pageTableWidth, pageTableHeight);
  const id = clamp(nonNegativeInteger(pageId), 0, grid.pageCount - 1);
  return {
    x: id % grid.width,
    y: Math.floor(id / grid.width),
    id,
    width: grid.width,
    height: grid.height,
  };
}

export function virtualTexturePageCoordFromUV(uv, pageTableWidth = 2048, pageTableHeight = pageTableWidth) {
  const grid = virtualTexturePageGrid(pageTableWidth, pageTableHeight);
  const v = finiteVec2(uv);
  const scaledX = v[0] * grid.width;
  const scaledY = v[1] * grid.height;
  const x = clamp(Math.floor(scaledX), 0, grid.width - 1);
  const y = clamp(Math.floor(scaledY), 0, grid.height - 1);
  return {
    x,
    y,
    id: y * grid.width + x,
    localU: mod(scaledX, 1),
    localV: mod(scaledY, 1),
    width: grid.width,
    height: grid.height,
  };
}

export function virtualTexturePhysicalPageGrid(cacheWidth = 4096, pageSize = 256, cacheHeight = cacheWidth) {
  const size = positiveExtent(pageSize);
  const width = positiveExtent(cacheWidth);
  const height = positiveExtent(cacheHeight);
  const pagesX = Math.max(1, Math.floor(width / size));
  const pagesY = Math.max(1, Math.floor(height / size));
  return {
    cacheWidth: width,
    cacheHeight: height,
    pageSize: size,
    pagesX,
    pagesY,
    pageCount: pagesX * pagesY,
  };
}

export function virtualTexturePhysicalPageOrigin(slotIndex, cacheWidth = 4096, pageSize = 256, cacheHeight = cacheWidth) {
  const grid = virtualTexturePhysicalPageGrid(cacheWidth, pageSize, cacheHeight);
  const slot = clamp(nonNegativeInteger(slotIndex), 0, grid.pageCount - 1);
  const pageX = slot % grid.pagesX;
  const pageY = Math.floor(slot / grid.pagesX);
  return {
    x: pageX * grid.pageSize,
    y: pageY * grid.pageSize,
    pageX,
    pageY,
    slot,
  };
}

export function virtualTexturePhysicalUV(
  uv,
  physicalPage,
  {
    pageTableWidth = 2048,
    pageTableHeight = pageTableWidth,
    pageSize = 256,
    cacheWidth = 4096,
    cacheHeight = cacheWidth,
  } = {}
) {
  const page = virtualTexturePageCoordFromUV(uv, pageTableWidth, pageTableHeight);
  const physical = physicalPage || {};
  const physicalPageX = nonNegativeInteger(physical.pageX ?? physical[0] ?? finiteOrDefault(physical.x) / positiveExtent(pageSize));
  const physicalPageY = nonNegativeInteger(physical.pageY ?? physical[1] ?? finiteOrDefault(physical.y) / positiveExtent(pageSize));
  const size = positiveExtent(pageSize);
  return [
    (physicalPageX * size + page.localU * size) / positiveExtent(cacheWidth),
    (physicalPageY * size + page.localV * size) / positiveExtent(cacheHeight),
  ];
}

export function virtualTexturePageTableEntry(
  pageId,
  physicalLocation,
  {
    pageTableWidth = 2048,
    pageTableHeight = pageTableWidth,
    pageSize = 256,
    resident = 1,
    reserved = 0,
  } = {}
) {
  const page = virtualTexturePageCoord(pageId, pageTableWidth, pageTableHeight);
  const physical = physicalLocation || {};
  const size = positiveExtent(pageSize);
  const physicalPageX = uint16Lane(physical.pageX ?? physical[0] ?? finiteOrDefault(physical.x) / size);
  const physicalPageY = uint16Lane(physical.pageY ?? physical[1] ?? finiteOrDefault(physical.y) / size);
  return {
    pageX: page.x,
    pageY: page.y,
    pageId: page.id,
    physicalPageX,
    physicalPageY,
    resident: uint16Lane(resident),
    reserved: uint16Lane(reserved),
    values: [physicalPageX, physicalPageY, uint16Lane(resident), uint16Lane(reserved)],
  };
}

export function virtualTextureFeedbackBufferLayout(
  pageTableWidth = 2048,
  pageTableHeight = pageTableWidth,
  bytesPerFlag = 4
) {
  const grid = virtualTexturePageGrid(pageTableWidth, pageTableHeight);
  const stride = positiveCount(bytesPerFlag);
  return {
    width: grid.width,
    height: grid.height,
    pageCount: grid.pageCount,
    flagCount: grid.pageCount,
    bytesPerFlag: stride,
    byteLength: grid.pageCount * stride,
  };
}

export function virtualTextureFeedbackBufferByteSize(
  pageTableWidth = 2048,
  pageTableHeight = pageTableWidth,
  bytesPerFlag = 4
) {
  return virtualTextureFeedbackBufferLayout(pageTableWidth, pageTableHeight, bytesPerFlag).byteLength;
}

export function virtualTextureFeedbackIndex(pageId, pageTableWidth = 2048, pageTableHeight = pageTableWidth) {
  return virtualTexturePageCoord(pageId, pageTableWidth, pageTableHeight).id;
}

function pageSetHas(pageSet, pageId) {
  if (!pageSet) return false;
  if (typeof pageSet.has === 'function') return pageSet.has(pageId);
  if (Array.isArray(pageSet)) return pageSet.includes(pageId);
  if (typeof pageSet === 'object') return Boolean(pageSet[pageId]);
  return false;
}

function feedbackFlagsView(feedbackData) {
  if (feedbackData instanceof Uint32Array) return feedbackData;
  if (ArrayBuffer.isView(feedbackData)) {
    return new Uint32Array(
      feedbackData.buffer,
      feedbackData.byteOffset,
      Math.floor(feedbackData.byteLength / 4)
    );
  }
  if (feedbackData instanceof ArrayBuffer) return new Uint32Array(feedbackData);
  return Array.isArray(feedbackData) ? feedbackData : [];
}

export function compactVirtualTextureFeedback(
  feedbackData,
  {
    pageTableWidth = 2048,
    pageTableHeight = pageTableWidth,
    maxRequests = Infinity,
    residentPages = null,
  } = {}
) {
  const flags = feedbackFlagsView(feedbackData);
  const grid = virtualTexturePageGrid(pageTableWidth, pageTableHeight);
  const scanCount = Math.min(flags.length, grid.pageCount);
  const limit = Number.isFinite(Number(maxRequests))
    ? nonNegativeInteger(maxRequests)
    : Infinity;
  const pageIds = [];
  let totalRequests = 0;
  let droppedRequests = 0;
  let residentSkipped = 0;

  for (let pageId = 0; pageId < scanCount; pageId++) {
    if (finiteOrDefault(flags[pageId]) <= 0) continue;
    totalRequests++;
    if (pageSetHas(residentPages, pageId)) {
      residentSkipped++;
      continue;
    }
    if (pageIds.length < limit) {
      pageIds.push(pageId);
    } else {
      droppedRequests++;
    }
  }

  return {
    pageIds,
    requestedPages: pageIds,
    totalRequests,
    droppedRequests,
    residentSkipped,
    scannedFlags: scanCount,
    missingFlags: Math.max(0, grid.pageCount - scanCount),
    pageCount: grid.pageCount,
    overflow: droppedRequests > 0 || scanCount < grid.pageCount,
  };
}

export function pixelToUV(pixel, textureSize, centered = false) {
  const p = finiteVec2(pixel);
  const size = finiteVec2(textureSize, [1, 1]).map(positiveExtent);
  const bias = centered ? 0.5 : 0;
  return [(p[0] + bias) / size[0], (p[1] + bias) / size[1]];
}

export function uvToPixel(uv, textureSize, centered = false) {
  const v = finiteVec2(uv);
  const size = finiteVec2(textureSize, [1, 1]).map(positiveExtent);
  const bias = centered ? 0.5 : 0;
  return [v[0] * size[0] - bias, v[1] * size[1] - bias];
}

export function triplanarWeights(normal, sharpness = 1) {
  const n = Array.isArray(normal) || ArrayBuffer.isView(normal) ? normal : [0, 1, 0];
  const s = Math.max(0, finiteOrDefault(sharpness, 1));
  const weights = [
    Math.pow(Math.abs(finiteOrDefault(n[0])), s),
    Math.pow(Math.abs(finiteOrDefault(n[1], 1)), s),
    Math.pow(Math.abs(finiteOrDefault(n[2])), s),
  ];
  const sum = weights[0] + weights[1] + weights[2];
  if (sum <= 0) return [0, 1, 0];
  return [weights[0] / sum, weights[1] / sum, weights[2] / sum];
}

export function textureMipLevelCount(width, height = width, depth = 1, maxMipLevels = Infinity) {
  const maxExtent = Math.max(positiveExtent(width), positiveExtent(height), positiveExtent(depth));
  const levels = Math.floor(Math.log2(maxExtent)) + 1;
  const maxLevels = Number.isFinite(Number(maxMipLevels)) ? positiveExtent(maxMipLevels) : levels;
  return Math.max(1, Math.min(levels, maxLevels));
}

export function textureMipExtent(width, height, mipLevel = 0) {
  const divisor = 2 ** Math.max(0, Math.floor(finiteOrDefault(mipLevel)));
  return {
    width: Math.max(1, Math.floor(positiveExtent(width) / divisor)),
    height: Math.max(1, Math.floor(positiveExtent(height) / divisor)),
  };
}

export function textureMipByteSize(width, height, bytesPerPixel = 4, mipLevels = 1, depthOrArrayLayers = 1) {
  const bpp = Math.max(0, finiteOrDefault(bytesPerPixel, 4));
  const layers = positiveExtent(depthOrArrayLayers);
  const levels = positiveExtent(mipLevels);
  let total = 0;
  for (let mip = 0; mip < levels; mip++) {
    const extent = textureMipExtent(width, height, mip);
    total += extent.width * extent.height * layers * bpp;
  }
  return total;
}

export function textureFormatBlockInfo(format = 'rgba8unorm', fallbackBytesPerPixel = 4) {
  const key = textureFormatKey(format);
  const block = TEXTURE_FORMAT_BLOCKS[key];
  if (block) {
    return {
      format: key,
      blockWidth: block[0],
      blockHeight: block[1],
      blockDepth: 1,
      bytesPerBlock: block[2],
      compressed: block[0] > 1 || block[1] > 1,
    };
  }

  const bytes = Math.max(0, finiteOrDefault(fallbackBytesPerPixel, 4));
  return {
    format: key,
    blockWidth: 1,
    blockHeight: 1,
    blockDepth: 1,
    bytesPerBlock: bytes,
    compressed: false,
  };
}

export function textureFormatFamily(format = 'rgba8unorm') {
  const key = textureFormatKey(format);
  if (key.startsWith('bc')) return 'bc';
  if (key.startsWith('astc')) return 'astc';
  if (key.startsWith('etc2') || key.startsWith('eac')) return 'etc2';
  if (TEXTURE_FORMAT_BLOCKS[key]) return 'uncompressed';
  return 'unknown';
}

export function textureFormatFeature(format = 'rgba8unorm') {
  const family = textureFormatFamily(format);
  if (family === 'bc') return 'texture-compression-bc';
  if (family === 'astc') return 'texture-compression-astc';
  if (family === 'etc2') return 'texture-compression-etc2';
  return null;
}

export function textureFormatAlphaMode(format = 'rgba8unorm') {
  const key = textureFormatKey(format);
  if (key.includes('depth') || key.includes('stencil')) return 'none';
  if (key.startsWith('bc1-rgba') || key.startsWith('etc2-rgb8a1')) return 'punchthrough';
  if (
    key.includes('rgba')
    || key.includes('bgra')
    || key.includes('rgb10a2')
    || key.startsWith('bc2')
    || key.startsWith('bc3')
    || key.startsWith('bc7')
    || key.startsWith('astc')
  ) {
    return 'full';
  }
  return 'none';
}

function featureSetHas(features, feature) {
  if (!feature) return true;
  const source = features?.features ?? features;
  if (!source) return false;
  const shortName = feature.replace('texture-compression-', '');
  if (typeof source.has === 'function') {
    return source.has(feature) || source.has(shortName);
  }
  if (Array.isArray(source)) {
    return source.includes(feature) || source.includes(shortName);
  }
  if (typeof source === 'object') {
    return Boolean(source[feature] ?? source[shortName]);
  }
  return false;
}

export function textureFormatIsSupported(format = 'rgba8unorm', features = null) {
  return featureSetHas(features, textureFormatFeature(format));
}

function textureSrgbVariant(format, preferSrgb = false) {
  const key = textureFormatKey(format);
  if (!preferSrgb || key.includes('srgb')) return key;
  const srgb = key.replace('unorm', 'unorm-srgb');
  return TEXTURE_FORMAT_BLOCKS[srgb] ? srgb : key;
}

function textureDefaultFormatQuality(format) {
  const key = textureFormatKey(format);
  if (key.startsWith('bc7')) return 0.96;
  if (key.startsWith('bc1')) return 0.86;
  if (key.startsWith('bc6h')) return 0.9;
  if (key.startsWith('bc2') || key.startsWith('bc3') || key.startsWith('bc5')) return 0.84;
  if (key.startsWith('bc4')) return 0.78;
  if (key.startsWith('astc-4x4')) return 0.92;
  if (key.startsWith('astc')) return 0.86;
  if (key.startsWith('etc2-rgba')) return 0.82;
  if (key.startsWith('etc2-rgb8')) return 0.78;
  if (key.startsWith('eac')) return 0.76;
  return TEXTURE_FORMAT_BLOCKS[key] ? 1 : 0.5;
}

function textureDefaultFormatPriority(format) {
  const family = textureFormatFamily(format);
  if (family === 'bc') return 1;
  if (family === 'astc') return 0.9;
  if (family === 'etc2') return 0.8;
  if (family === 'uncompressed') return 0.1;
  return 0;
}

export function textureDefaultTranscodeTargets({ needsAlpha = true, preferSrgb = false } = {}) {
  const formats = needsAlpha
    ? ['bc7-rgba-unorm', 'astc-4x4-unorm', 'etc2-rgba8unorm', 'rgba8unorm']
    : ['bc1-rgba-unorm', 'astc-4x4-unorm', 'etc2-rgb8unorm', 'rgba8unorm'];
  return formats.map((format) => textureSrgbVariant(format, preferSrgb));
}

export function textureBytesPerPixel(format = 'rgba8unorm', fallbackBytesPerPixel = 4) {
  const block = textureFormatBlockInfo(format, fallbackBytesPerPixel);
  return block.bytesPerBlock / (block.blockWidth * block.blockHeight);
}

export function textureFormatBitsPerPixel(format = 'rgba8unorm', fallbackBytesPerPixel = 4) {
  return textureBytesPerPixel(format, fallbackBytesPerPixel) * 8;
}

export function textureMipBlockExtent(width, height, format = 'rgba8unorm', mipLevel = 0) {
  const extent = textureMipExtent(width, height, mipLevel);
  const block = typeof format === 'object'
    ? format
    : textureFormatBlockInfo(format);
  const blockWidth = positiveExtent(block.blockWidth ?? block.width ?? 1);
  const blockHeight = positiveExtent(block.blockHeight ?? block.height ?? 1);
  return {
    width: Math.ceil(extent.width / blockWidth),
    height: Math.ceil(extent.height / blockHeight),
    texelWidth: extent.width,
    texelHeight: extent.height,
    blockWidth,
    blockHeight,
  };
}

export function textureMipBlockExtent3D(width, height, depth = 1, format = 'rgba8unorm', mipLevel = 0) {
  const extent = textureMipExtent3D(width, height, depth, mipLevel);
  const block = typeof format === 'object'
    ? format
    : textureFormatBlockInfo(format);
  const blockWidth = positiveExtent(block.blockWidth ?? block.width ?? 1);
  const blockHeight = positiveExtent(block.blockHeight ?? block.height ?? 1);
  const blockDepth = positiveExtent(block.blockDepth ?? block.depth ?? 1);
  return {
    width: Math.ceil(extent.width / blockWidth),
    height: Math.ceil(extent.height / blockHeight),
    depth: Math.ceil(extent.depth / blockDepth),
    texelWidth: extent.width,
    texelHeight: extent.height,
    texelDepth: extent.depth,
    blockWidth,
    blockHeight,
    blockDepth,
  };
}

export function textureFormatMipByteSize(
  width,
  height,
  format = 'rgba8unorm',
  mipLevels = 1,
  depthOrArrayLayers = 1
) {
  const block = textureFormatBlockInfo(format);
  const layers = positiveExtent(depthOrArrayLayers);
  const levels = positiveExtent(mipLevels);
  let total = 0;
  for (let mip = 0; mip < levels; mip++) {
    const blocks = textureMipBlockExtent(width, height, block, mip);
    total += blocks.width * blocks.height * block.bytesPerBlock * layers;
  }
  return total;
}

export function textureDescriptorByteSize(descriptor = {}) {
  const size = descriptor?.size ?? {};
  const sequenceSize = Array.isArray(size) || ArrayBuffer.isView(size);
  const width = positiveExtent(sequenceSize ? size[0] : size.width);
  const height = positiveExtent(sequenceSize ? size[1] : size.height);
  const depthOrArrayLayers = positiveExtent(sequenceSize ? size[2] : size.depthOrArrayLayers);
  const mipLevels = positiveCount(descriptor?.mipLevelCount);
  const sampleCount = positiveCount(descriptor?.sampleCount);
  const dimension = String(descriptor?.dimension ?? '2d').toLowerCase();
  const block = textureFormatBlockInfo(descriptor?.format);
  let total = 0;

  for (let mip = 0; mip < mipLevels; mip++) {
    if (dimension === '3d') {
      const blocks = textureMipBlockExtent3D(width, height, depthOrArrayLayers, block, mip);
      total += blocks.width * blocks.height * blocks.depth * block.bytesPerBlock;
    } else {
      const blocks = textureMipBlockExtent(width, height, block, mip);
      total += blocks.width * blocks.height * depthOrArrayLayers * block.bytesPerBlock;
    }
  }

  return total * sampleCount;
}

export function textureContainerLevelByteSize({
  width,
  height = width,
  depth = 1,
  format = 'rgba8unorm',
  mipLevel = 0,
  layerCount = 1,
  faceCount = 1,
} = {}) {
  const block = textureFormatBlockInfo(format);
  const blocks = textureMipBlockExtent3D(width, height, depth, block, mipLevel);
  const layers = positiveCount(layerCount);
  const faces = positiveCount(faceCount);
  return blocks.width * blocks.height * blocks.depth * block.bytesPerBlock * layers * faces;
}

export function textureKtxLevelAlignment(format = 'rgba8unorm', supercompressionScheme = 0) {
  return Number(supercompressionScheme) === 0
    ? lcm(textureFormatBlockInfo(format).bytesPerBlock, 4)
    : 1;
}

export function alignByteOffset(byteOffset, alignment = 1) {
  const offset = Math.max(0, finiteOrDefault(byteOffset));
  const align = positiveCount(alignment);
  return Math.ceil(offset / align) * align;
}

export function textureKtxMipPadding(byteOffset, format = 'rgba8unorm', supercompressionScheme = 0) {
  return alignByteOffset(byteOffset, textureKtxLevelAlignment(format, supercompressionScheme)) - Math.max(0, finiteOrDefault(byteOffset));
}

function uint32OrInvalid(value) {
  const number = Math.floor(finiteOrDefault(value, 0));
  return Number.isFinite(number) ? number : 0;
}

export function textureKtxSupercompressionSchemeInfo(supercompressionScheme = 0) {
  const scheme = uint32OrInvalid(supercompressionScheme);
  const base = {
    scheme,
    known: false,
    valid: false,
    vendor: false,
    proprietary: false,
    reservedRange: null,
    supercompressed: scheme !== 0,
    requiresInflation: scheme !== 0,
    usesGlobalData: false,
    globalDataRequirement: 'forbidden',
    levelUncompressedByteLengthPolicy: 'invalid',
    levelAlignment: scheme === 0 ? 'lcm(texelBlockSize,4)' : 1,
  };

  if (scheme < 0 || scheme > 0xffffffff) {
    return {
      ...base,
      name: 'invalid',
      reservedRange: 'invalid',
      supercompressed: false,
      requiresInflation: false,
      levelAlignment: 1,
    };
  }

  switch (scheme) {
    case KTX_SUPERCOMPRESSION_SCHEMES.NONE:
      return {
        ...base,
        name: 'none',
        known: true,
        valid: true,
        supercompressed: false,
        requiresInflation: false,
        levelUncompressedByteLengthPolicy: 'matches-byte-length',
      };
    case KTX_SUPERCOMPRESSION_SCHEMES.BASIS_LZ:
      return {
        ...base,
        name: 'basis-lz',
        known: true,
        valid: true,
        usesGlobalData: true,
        globalDataRequirement: 'required',
        levelUncompressedByteLengthPolicy: 'zero',
      };
    case KTX_SUPERCOMPRESSION_SCHEMES.ZSTANDARD:
      return {
        ...base,
        name: 'zstandard',
        known: true,
        valid: true,
        levelUncompressedByteLengthPolicy: 'after-inflation',
      };
    case KTX_SUPERCOMPRESSION_SCHEMES.ZLIB:
      return {
        ...base,
        name: 'zlib',
        known: true,
        valid: true,
        levelUncompressedByteLengthPolicy: 'after-inflation',
      };
    case KTX_SUPERCOMPRESSION_SCHEMES.ASOBO:
      return {
        ...base,
        name: 'asobo',
        known: true,
        valid: true,
        vendor: true,
        proprietary: true,
        usesGlobalData: true,
        globalDataRequirement: 'required',
        levelUncompressedByteLengthPolicy: 'after-inflation',
      };
    default:
      if (scheme >= 4 && scheme <= 0xffff) {
        return {
          ...base,
          name: 'reserved-ktx',
          reservedRange: 'ktx',
        };
      }
      if (scheme >= 0x10001 && scheme <= 0x1ffff) {
        return {
          ...base,
          name: 'reserved-vendor',
          vendor: true,
          reservedRange: 'vendor',
        };
      }
      return {
        ...base,
        name: 'reserved',
        reservedRange: 'reserved',
      };
  }
}

export function textureKtxSupercompressionLevelReport({
  byteLength = 0,
  uncompressedByteLength = byteLength,
  supercompressionScheme = 0,
  expectedUncompressedByteLength = null,
  faceCount = 1,
  layerCount = 1,
} = {}) {
  const info = textureKtxSupercompressionSchemeInfo(supercompressionScheme);
  const compressedLength = nonNegativeInteger(byteLength);
  const reflatedLength = nonNegativeInteger(uncompressedByteLength);
  const expectedLength = expectedUncompressedByteLength == null
    ? null
    : nonNegativeInteger(expectedUncompressedByteLength);
  const faces = positiveCount(faceCount);
  const layers = Math.max(1, nonNegativeInteger(layerCount));
  const levelDivisor = faces * layers;
  let uncompressedPolicySatisfied = false;
  if (info.levelUncompressedByteLengthPolicy === 'matches-byte-length') {
    uncompressedPolicySatisfied = reflatedLength === compressedLength;
  } else if (info.levelUncompressedByteLengthPolicy === 'zero') {
    uncompressedPolicySatisfied = reflatedLength === 0;
  } else if (info.levelUncompressedByteLengthPolicy === 'after-inflation') {
    uncompressedPolicySatisfied = reflatedLength > 0;
  }
  const expectedUncompressedSatisfied = expectedLength == null || reflatedLength === expectedLength;
  const divisorSatisfied = levelDivisor > 0 && reflatedLength % levelDivisor === 0;
  const compressionRatio = compressedLength > 0 && reflatedLength > 0
    ? reflatedLength / compressedLength
    : 0;
  const savingsRatio = compressedLength > 0 && reflatedLength > 0
    ? 1 - compressedLength / reflatedLength
    : 0;
  const valid = info.valid
    && uncompressedPolicySatisfied
    && expectedUncompressedSatisfied
    && divisorSatisfied;
  return {
    scheme: info.scheme,
    schemeName: info.name,
    info,
    byteLength: compressedLength,
    compressedByteLength: compressedLength,
    uncompressedByteLength: reflatedLength,
    expectedUncompressedByteLength: expectedLength,
    faceCount: faces,
    layerCount: layers,
    levelDivisor,
    compressionRatio,
    savingsRatio,
    uncompressedPolicySatisfied,
    expectedUncompressedSatisfied,
    divisorSatisfied,
    valid,
  };
}

export function textureKtxSupercompressionGlobalDataRange({
  byteOffset = 0,
  byteLength = 0,
  precedingByteEnd = 0,
  supercompressionScheme = 0,
} = {}) {
  const info = textureKtxSupercompressionSchemeInfo(supercompressionScheme);
  const offset = nonNegativeInteger(byteOffset);
  const length = nonNegativeInteger(byteLength);
  const previousEnd = nonNegativeInteger(precedingByteEnd);
  const requiredOffset = alignByteOffset(previousEnd, 8);
  const padding = requiredOffset - previousEnd;
  const actualPadding = length > 0 ? Math.max(0, offset - previousEnd) : 0;
  const present = length > 0;
  const aligned = !present || offset === alignByteOffset(offset, 8);
  const offsetZeroWhenAbsent = present || offset === 0;
  const minimumOffsetSatisfied = !present || offset >= requiredOffset;
  const allowed = info.usesGlobalData || !present;
  const required = info.globalDataRequirement === 'required';
  const valid = info.valid
    && offsetZeroWhenAbsent
    && (present
      ? allowed && aligned && minimumOffsetSatisfied
      : !required);
  return {
    scheme: info.scheme,
    schemeName: info.name,
    info,
    byteOffset: offset,
    byteLength: length,
    endOffset: present ? offset + length : offset,
    precedingByteEnd: previousEnd,
    requiredOffset,
    padding,
    actualPadding,
    present,
    aligned,
    offsetZeroWhenAbsent,
    minimumOffsetSatisfied,
    allowed,
    required,
    valid,
  };
}

export function textureKtxSupercompressionPolicy({
  supercompressionScheme = 0,
  levels = [],
  expectedUncompressedByteLengths = null,
  sgdByteOffset = 0,
  sgdByteLength = 0,
  precedingByteEnd = 0,
  faceCount = 1,
  layerCount = 1,
} = {}) {
  const info = textureKtxSupercompressionSchemeInfo(supercompressionScheme);
  const levelList = Array.isArray(levels) || ArrayBuffer.isView(levels)
    ? Array.from(levels)
    : [];
  const expectedList = Array.isArray(expectedUncompressedByteLengths) || ArrayBuffer.isView(expectedUncompressedByteLengths)
    ? expectedUncompressedByteLengths
    : null;
  const reports = levelList.map((level, index) => {
    const source = typeof level === 'number' ? { byteLength: level } : (level || {});
    return {
      mipLevel: nonNegativeInteger(source.mipLevel ?? index),
      ...textureKtxSupercompressionLevelReport({
        byteLength: source.byteLength,
        uncompressedByteLength: source.uncompressedByteLength,
        expectedUncompressedByteLength: expectedList ? expectedList[index] : source.expectedUncompressedByteLength,
        supercompressionScheme,
        faceCount: source.faceCount ?? faceCount,
        layerCount: source.layerCount ?? layerCount,
      }),
    };
  });
  const globalData = textureKtxSupercompressionGlobalDataRange({
    byteOffset: sgdByteOffset,
    byteLength: sgdByteLength,
    precedingByteEnd,
    supercompressionScheme,
  });
  const totalCompressedByteLength = reports.reduce((sum, level) => sum + level.byteLength, 0);
  const totalUncompressedByteLength = reports.reduce((sum, level) => sum + level.uncompressedByteLength, 0);
  const compressionRatio = totalCompressedByteLength > 0 && totalUncompressedByteLength > 0
    ? totalUncompressedByteLength / totalCompressedByteLength
    : 0;
  const savingsRatio = totalCompressedByteLength > 0 && totalUncompressedByteLength > 0
    ? 1 - totalCompressedByteLength / totalUncompressedByteLength
    : 0;
  const levelsValid = reports.every((level) => level.valid);
  return {
    scheme: info.scheme,
    schemeName: info.name,
    info,
    levels: reports,
    levelCount: reports.length,
    levelsValid,
    globalData,
    totalCompressedByteLength,
    totalUncompressedByteLength,
    compressionRatio,
    savingsRatio,
    valid: info.valid && levelsValid && globalData.valid,
  };
}

export function textureContainerImageLayout({
  width,
  height = width,
  depth = 1,
  format = 'rgba8unorm',
  mipLevel = 0,
  layerCount = 1,
  faceCount = 1,
} = {}) {
  const block = textureFormatBlockInfo(format);
  const blocks = textureMipBlockExtent3D(width, height, depth, block, mipLevel);
  const layers = positiveCount(layerCount);
  const faces = positiveCount(faceCount);
  const rowStride = blocks.width * block.bytesPerBlock;
  const zSliceStride = rowStride * blocks.height;
  const faceStride = zSliceStride * blocks.depth;
  const layerStride = faceStride * faces;
  return {
    mipLevel: nonNegativeInteger(mipLevel),
    width: blocks.texelWidth,
    height: blocks.texelHeight,
    depth: blocks.texelDepth,
    blocksX: blocks.width,
    blocksY: blocks.height,
    blocksZ: blocks.depth,
    blockWidth: blocks.blockWidth,
    blockHeight: blocks.blockHeight,
    blockDepth: blocks.blockDepth,
    bytesPerBlock: block.bytesPerBlock,
    rowStride,
    zSliceStride,
    faceStride,
    layerStride,
    layerCount: layers,
    faceCount: faces,
    byteLength: layerStride * layers,
  };
}

export function textureContainerImageByteOffset(layout, layer = 0, face = 0, zSlice = 0) {
  const info = layout || {};
  const layers = positiveCount(info.layerCount);
  const faces = positiveCount(info.faceCount);
  const zSlices = positiveCount(info.blocksZ);
  const layerIndex = clamp(nonNegativeInteger(layer), 0, layers - 1);
  const faceIndex = clamp(nonNegativeInteger(face), 0, faces - 1);
  const zIndex = clamp(nonNegativeInteger(zSlice), 0, zSlices - 1);
  return layerIndex * finiteOrDefault(info.layerStride)
    + faceIndex * finiteOrDefault(info.faceStride)
    + zIndex * finiteOrDefault(info.zSliceStride);
}

export function textureWebGpuUploadLayout({
  width,
  height = width,
  depthOrArrayLayers = 1,
  format = 'rgba8unorm',
  mipLevel = 0,
  offset = 0,
  bytesPerRowAlignment = 1,
  copyBufferToTexture = false,
} = {}) {
  const block = textureFormatBlockInfo(format);
  const blocks = textureMipBlockExtent3D(width, height, depthOrArrayLayers, block, mipLevel);
  const tightBytesPerRow = blocks.width * block.bytesPerBlock;
  const requiredAlignment = copyBufferToTexture
    ? Math.max(WEBGPU_COPY_BYTES_PER_ROW_ALIGNMENT, positiveCount(bytesPerRowAlignment))
    : positiveCount(bytesPerRowAlignment);
  const bytesPerRow = alignByteOffset(tightBytesPerRow, requiredAlignment);
  const rowsPerImage = blocks.height;
  const tightBytesPerImage = tightBytesPerRow * rowsPerImage;
  const bytesPerImage = bytesPerRow * rowsPerImage;
  const imageCount = blocks.depth;
  const tightByteLength = tightBytesPerImage * imageCount;
  const byteLength = bytesPerImage * imageCount;
  const needsRowPadding = bytesPerRow !== tightBytesPerRow;
  return {
    mipLevel: nonNegativeInteger(mipLevel),
    format: textureFormatKey(format),
    width: blocks.texelWidth,
    height: blocks.texelHeight,
    depthOrArrayLayers: blocks.texelDepth,
    blocksX: blocks.width,
    blocksY: blocks.height,
    blocksZ: blocks.depth,
    blockWidth: blocks.blockWidth,
    blockHeight: blocks.blockHeight,
    blockDepth: blocks.blockDepth,
    bytesPerBlock: block.bytesPerBlock,
    offset: nonNegativeInteger(offset),
    bytesPerRow,
    rowsPerImage,
    tightBytesPerRow,
    tightBytesPerImage,
    bytesPerImage,
    tightByteLength,
    byteLength,
    copyBufferToTexture,
    bytesPerRowAlignment: requiredAlignment,
    needsRowPadding,
    dataLayout: {
      offset: nonNegativeInteger(offset),
      bytesPerRow,
      rowsPerImage,
    },
    copySize: {
      width: blocks.texelWidth,
      height: blocks.texelHeight,
      depthOrArrayLayers: blocks.texelDepth,
    },
  };
}

export function textureKtxLevelLayout({
  width,
  height = width,
  depth = 1,
  format = 'rgba8unorm',
  levelCount = textureMipLevelCount(width, height, depth),
  layerCount = 1,
  faceCount = 1,
  startOffset = 0,
  supercompressionScheme = 0,
  levelByteLengths = null,
  uncompressedLevelByteLengths = null,
  physicalOrder = 'smallest-first',
} = {}) {
  const count = positiveCount(levelCount);
  const levels = Array.from({ length: count }, (_, mipLevel) => {
    const imageLayout = textureContainerImageLayout({
      width,
      height,
      depth,
      format,
      mipLevel,
      layerCount,
      faceCount,
    });
    const explicitByteLength = Array.isArray(levelByteLengths) || ArrayBuffer.isView(levelByteLengths)
      ? levelByteLengths[mipLevel]
      : undefined;
    const explicitUncompressed = Array.isArray(uncompressedLevelByteLengths) || ArrayBuffer.isView(uncompressedLevelByteLengths)
      ? uncompressedLevelByteLengths[mipLevel]
      : undefined;
    return {
      ...imageLayout,
      byteOffset: 0,
      byteLength: Math.max(0, finiteOrDefault(explicitByteLength, imageLayout.byteLength)),
      uncompressedByteLength: Math.max(0, finiteOrDefault(explicitUncompressed, imageLayout.byteLength)),
      mipPadding: 0,
    };
  });

  const fileOrder = physicalOrder === 'largest-first'
    ? levels.map((_, index) => index)
    : levels.map((_, index) => count - 1 - index);
  let cursor = Math.max(0, finiteOrDefault(startOffset));
  for (const mipLevel of fileOrder) {
    const level = levels[mipLevel];
    const aligned = alignByteOffset(cursor, textureKtxLevelAlignment(format, supercompressionScheme));
    level.mipPadding = aligned - cursor;
    level.byteOffset = aligned;
    cursor = aligned + level.byteLength;
  }

  return {
    levels,
    fileOrder,
    byteLength: cursor - Math.max(0, finiteOrDefault(startOffset)),
    startOffset: Math.max(0, finiteOrDefault(startOffset)),
    endOffset: cursor,
    alignment: textureKtxLevelAlignment(format, supercompressionScheme),
  };
}

export function textureMemorySavingsRatio(
  width,
  height,
  compressedFormat,
  referenceFormat = 'rgba8unorm',
  mipLevels = 1
) {
  const referenceSize = textureFormatMipByteSize(width, height, referenceFormat, mipLevels);
  if (referenceSize <= 0) return 0;
  const compressedSize = textureFormatMipByteSize(width, height, compressedFormat, mipLevels);
  return 1 - compressedSize / referenceSize;
}

export function textureQualitySizeScore({
  width,
  height = width,
  format = 'rgba8unorm',
  referenceFormat = 'rgba8unorm',
  mipLevels = 1,
  depthOrArrayLayers = 1,
  quality = 1,
  byteBudget = Infinity,
  budgetBytes = byteBudget,
  qualityWeight = 0.7,
  sizeWeight = 0.3,
  budgetWeight,
} = {}) {
  const levels = positiveCount(mipLevels);
  const layers = positiveCount(depthOrArrayLayers);
  const byteSize = textureFormatMipByteSize(width, height, format, levels, layers);
  const referenceByteSize = textureFormatMipByteSize(width, height, referenceFormat, levels, layers);
  return qualitySizeScore({
    quality,
    byteSize,
    referenceByteSize,
    budgetBytes,
    qualityWeight,
    sizeWeight,
    budgetWeight,
  });
}

export function textureTranscodeTargetScore(target, {
  width,
  height = width,
  referenceFormat = 'rgba8unorm',
  mipLevels = 1,
  depthOrArrayLayers = 1,
  supportedFeatures = null,
  needsAlpha = true,
  allowPunchthroughAlpha = false,
  preferSrgb = false,
  byteBudget = Infinity,
  qualityWeight = 0.7,
  sizeWeight = 0.3,
  budgetWeight,
} = {}) {
  const candidate = typeof target === 'string' ? { format: target } : (target || {});
  const format = textureSrgbVariant(candidate.format || 'rgba8unorm', preferSrgb);
  const feature = textureFormatFeature(format);
  const family = textureFormatFamily(format);
  const alphaMode = textureFormatAlphaMode(format);
  const supported = textureFormatIsSupported(format, supportedFeatures);
  const alphaCompatible = !needsAlpha
    || alphaMode === 'full'
    || (allowPunchthroughAlpha && alphaMode === 'punchthrough');
  const quality = finiteOrDefault(
    candidate.quality ?? candidate.qualityScore,
    textureDefaultFormatQuality(format)
  );
  const priority = saturate(finiteOrDefault(
    candidate.priority ?? candidate.preference,
    textureDefaultFormatPriority(format)
  ));
  const qualitySize = textureQualitySizeScore({
    width,
    height,
    format,
    referenceFormat,
    mipLevels,
    depthOrArrayLayers,
    quality,
    byteBudget,
    qualityWeight,
    sizeWeight,
    budgetWeight,
  });
  const eligible = supported && alphaCompatible;
  const score = eligible
    ? saturate(qualitySize.score * 0.85 + priority * 0.15)
    : 0;

  return {
    format,
    family,
    feature,
    alphaMode,
    supported,
    alphaCompatible,
    eligible,
    priority,
    ...qualitySize,
    qualitySizeScore: qualitySize.score,
    score,
  };
}

export function textureRankTranscodeTargets({
  candidates = null,
  needsAlpha = true,
  preferSrgb = false,
  ...options
} = {}) {
  const targets = candidates || textureDefaultTranscodeTargets({ needsAlpha, preferSrgb });
  return targets
    .map((target, index) => ({
      ...textureTranscodeTargetScore(target, {
        ...options,
        needsAlpha,
        preferSrgb,
      }),
      index,
    }))
    .sort((a, b) => Number(b.eligible) - Number(a.eligible)
      || b.score - a.score
      || b.priority - a.priority
      || a.index - b.index)
    .map((entry, rank) => ({ ...entry, rank }));
}

export function textureSelectTranscodeTarget(options = {}) {
  const ranked = textureRankTranscodeTargets(options);
  const selected = ranked.find((entry) => entry.eligible);
  if (selected) return selected;
  return textureTranscodeTargetScore('rgba8unorm', {
    ...options,
    supportedFeatures: null,
    needsAlpha: true,
  });
}

export function textureStreamingPriorityScore({
  priority = 0,
  distance = Infinity,
  lastUsedFrame = 0,
  frameIndex = 0,
  distanceScale = 0.01,
  recencyScale = 0.1,
  distanceWeight = 10,
  recencyWeight = 5,
} = {}) {
  const explicitPriority = finiteOrDefault(priority);
  const distanceValue = Number.isFinite(Number(distance))
    ? Math.max(0, Number(distance))
    : Infinity;
  const distanceFactor = distanceValue === Infinity
    ? 0
    : 1 / (1 + distanceValue * Math.max(0, finiteOrDefault(distanceScale, 0.01)));
  const frameDelta = Math.max(0, finiteOrDefault(frameIndex) - finiteOrDefault(lastUsedFrame));
  const recencyFactor = 1 / (1 + frameDelta * Math.max(0, finiteOrDefault(recencyScale, 0.1)));
  return explicitPriority
    + distanceFactor * finiteOrDefault(distanceWeight, 10)
    + recencyFactor * finiteOrDefault(recencyWeight, 5);
}

export function mipLevelFromPixelSize(pixelSize, maxMipLevel = Infinity) {
  const mip = Math.floor(Math.log2(Math.max(1, finiteOrDefault(pixelSize, 1))));
  const maxLevel = Number.isFinite(Number(maxMipLevel)) ? positiveExtent(maxMipLevel) - 1 : mip;
  return Math.max(0, Math.min(mip, maxLevel));
}

export function textureFade(distance, fadeStart, fadeEnd) {
  const t = smoothstep(fadeStart, fadeEnd, finiteOrDefault(distance));
  return saturate(1 - t);
}
