// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  KTX_SUPERCOMPRESSION_SCHEMES,
  textureFormatFeature,
  textureFormatIsSupported,
  textureKtxSupercompressionPolicy,
  textureKtxSupercompressionSchemeInfo,
  textureWebGpuUploadLayout,
} from '../math/TextureMath.js';

export const KTX2_IDENTIFIER = Object.freeze([
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export const KTX2_IDENTIFIER_BYTE_LENGTH = 12;
export const KTX2_HEADER_BYTE_LENGTH = 80;
export const KTX2_LEVEL_INDEX_ENTRY_BYTE_LENGTH = 24;

export const KTX2_VK_FORMAT_TO_WEBGPU_FORMAT = Object.freeze({
  37: 'rgba8unorm',
  43: 'rgba8unorm-srgb',
  44: 'bgra8unorm',
  50: 'bgra8unorm-srgb',
  131: 'bc1-rgba-unorm',
  132: 'bc1-rgba-unorm-srgb',
  133: 'bc1-rgba-unorm',
  134: 'bc1-rgba-unorm-srgb',
  135: 'bc2-rgba-unorm',
  136: 'bc2-rgba-unorm-srgb',
  137: 'bc3-rgba-unorm',
  138: 'bc3-rgba-unorm-srgb',
  139: 'bc4-r-unorm',
  140: 'bc4-r-snorm',
  141: 'bc5-rg-unorm',
  142: 'bc5-rg-snorm',
  143: 'bc6h-rgb-ufloat',
  144: 'bc6h-rgb-float',
  145: 'bc7-rgba-unorm',
  146: 'bc7-rgba-unorm-srgb',
  147: 'etc2-rgb8unorm',
  148: 'etc2-rgb8unorm-srgb',
  149: 'etc2-rgb8a1unorm',
  150: 'etc2-rgb8a1unorm-srgb',
  151: 'etc2-rgba8unorm',
  152: 'etc2-rgba8unorm-srgb',
  153: 'eac-r11unorm',
  154: 'eac-r11snorm',
  155: 'eac-rg11unorm',
  156: 'eac-rg11snorm',
  157: 'astc-4x4-unorm',
  158: 'astc-4x4-unorm-srgb',
  159: 'astc-5x4-unorm',
  160: 'astc-5x4-unorm-srgb',
  161: 'astc-5x5-unorm',
  162: 'astc-5x5-unorm-srgb',
  163: 'astc-6x5-unorm',
  164: 'astc-6x5-unorm-srgb',
  165: 'astc-6x6-unorm',
  166: 'astc-6x6-unorm-srgb',
  167: 'astc-8x5-unorm',
  168: 'astc-8x5-unorm-srgb',
  169: 'astc-8x6-unorm',
  170: 'astc-8x6-unorm-srgb',
  171: 'astc-8x8-unorm',
  172: 'astc-8x8-unorm-srgb',
  173: 'astc-10x5-unorm',
  174: 'astc-10x5-unorm-srgb',
  175: 'astc-10x6-unorm',
  176: 'astc-10x6-unorm-srgb',
  177: 'astc-10x8-unorm',
  178: 'astc-10x8-unorm-srgb',
  179: 'astc-10x10-unorm',
  180: 'astc-10x10-unorm-srgb',
  181: 'astc-12x10-unorm',
  182: 'astc-12x10-unorm-srgb',
  183: 'astc-12x12-unorm',
  184: 'astc-12x12-unorm-srgb',
});

function toByteView(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new TypeError('Ktx2Container: ArrayBuffer or typed-array data is required');
}

function toDataView(data) {
  const bytes = toByteView(data);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readUint64(view, byteOffset) {
  const low = view.getUint32(byteOffset, true);
  const high = view.getUint32(byteOffset + 4, true);
  return high * 0x100000000 + low;
}

function rangeInfo(name, byteOffset, byteLength, fileByteLength) {
  const offset = Math.max(0, Math.floor(Number(byteOffset) || 0));
  const length = Math.max(0, Math.floor(Number(byteLength) || 0));
  const present = length > 0;
  const endOffset = present ? offset + length : offset;
  const offsetZeroWhenAbsent = present || offset === 0;
  const withinFile = !present || (offset > 0 && endOffset <= fileByteLength);
  return {
    name,
    byteOffset: offset,
    byteLength: length,
    endOffset,
    present,
    offsetZeroWhenAbsent,
    withinFile,
    valid: offsetZeroWhenAbsent && withinFile,
  };
}

function maxPresentEnd(...ranges) {
  return ranges.reduce((maxEnd, range) => (
    range.present ? Math.max(maxEnd, range.endOffset) : maxEnd
  ), KTX2_HEADER_BYTE_LENGTH);
}

function uniqueIssues(issues) {
  return [...new Set(issues)];
}

function positiveCount(value) {
  return Math.max(1, Math.floor(Number(value) || 1));
}

function mipExtent(value, mipLevel) {
  return Math.max(1, Math.floor(positiveCount(value) / (2 ** Math.max(0, Math.floor(mipLevel)))));
}

function ktx2LevelDepthOrArrayLayers(header, mipLevel) {
  if (Number(header.pixelDepth || 0) > 0) {
    return mipExtent(header.pixelDepth, mipLevel);
  }
  return Math.max(1, Number(header.layerCount || 0) || 1) * positiveCount(header.faceCount);
}

function payloadViewForRange(data, range) {
  const bytes = toByteView(data);
  if (!range?.present || !range.valid) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, 0);
  }
  return new Uint8Array(
    bytes.buffer,
    bytes.byteOffset + range.byteOffset,
    range.byteLength
  );
}

export function ktx2VkFormatInfo(vkFormat = 0, supportedFeatures = null) {
  const id = Math.max(0, Math.floor(Number(vkFormat) || 0));
  const webgpuFormat = KTX2_VK_FORMAT_TO_WEBGPU_FORMAT[id] || null;
  const feature = webgpuFormat ? textureFormatFeature(webgpuFormat) : null;
  return {
    vkFormat: id,
    webgpuFormat,
    feature,
    undefinedFormat: id === 0,
    known: Boolean(webgpuFormat),
    supported: webgpuFormat ? textureFormatIsSupported(webgpuFormat, supportedFeatures) : false,
  };
}

export function isKtx2Container(data) {
  let bytes;
  try {
    bytes = toByteView(data);
  } catch (_) {
    return false;
  }
  if (bytes.byteLength < KTX2_IDENTIFIER_BYTE_LENGTH) return false;
  for (let index = 0; index < KTX2_IDENTIFIER_BYTE_LENGTH; index++) {
    if (bytes[index] !== KTX2_IDENTIFIER[index]) return false;
  }
  return true;
}

export function parseKtx2Container(data, options = {}) {
  const bytes = toByteView(data);
  const view = toDataView(bytes);
  const issues = [];
  const fileByteLength = bytes.byteLength;
  const identifierValid = isKtx2Container(bytes);
  const headerComplete = fileByteLength >= KTX2_HEADER_BYTE_LENGTH;

  if (!identifierValid) issues.push('invalid-identifier');
  if (!headerComplete) issues.push('truncated-header');

  if (!headerComplete) {
    return {
      container: 'ktx2',
      valid: false,
      identifierValid,
      headerComplete,
      fileByteLength,
      header: null,
      levels: [],
      sections: {},
      issues,
    };
  }

  let cursor = KTX2_IDENTIFIER_BYTE_LENGTH;
  const header = {
    vkFormat: view.getUint32(cursor, true), typeSize: view.getUint32(cursor + 4, true),
    pixelWidth: view.getUint32(cursor + 8, true), pixelHeight: view.getUint32(cursor + 12, true),
    pixelDepth: view.getUint32(cursor + 16, true), layerCount: view.getUint32(cursor + 20, true),
    faceCount: view.getUint32(cursor + 24, true), levelCount: view.getUint32(cursor + 28, true),
    supercompressionScheme: view.getUint32(cursor + 32, true),
  };
  cursor += 36;
  header.dfdByteOffset = view.getUint32(cursor, true);
  header.dfdByteLength = view.getUint32(cursor + 4, true);
  header.kvdByteOffset = view.getUint32(cursor + 8, true);
  header.kvdByteLength = view.getUint32(cursor + 12, true);
  cursor += 16;
  header.sgdByteOffset = readUint64(view, cursor);
  header.sgdByteLength = readUint64(view, cursor + 8);

  const indexLevelCount = Math.max(1, header.levelCount || 1);
  const levelIndexOffset = KTX2_HEADER_BYTE_LENGTH;
  const levelIndexByteLength = indexLevelCount * KTX2_LEVEL_INDEX_ENTRY_BYTE_LENGTH;
  const levelIndexEndOffset = levelIndexOffset + levelIndexByteLength;
  const levelIndexWithinFile = levelIndexEndOffset <= fileByteLength;
  if (!levelIndexWithinFile) issues.push('truncated-level-index');

  const levels = [];
  if (levelIndexWithinFile) {
    for (let index = 0; index < indexLevelCount; index++) {
      const entryOffset = levelIndexOffset + index * KTX2_LEVEL_INDEX_ENTRY_BYTE_LENGTH;
      const byteOffset = readUint64(view, entryOffset);
      const byteLength = readUint64(view, entryOffset + 8);
      const uncompressedByteLength = readUint64(view, entryOffset + 16);
      const range = rangeInfo(`level-${index}`, byteOffset, byteLength, fileByteLength);
      if (!range.valid) issues.push(`invalid-level-${index}-range`);
      levels.push({
        mipLevel: index,
        byteOffset,
        byteLength,
        uncompressedByteLength,
        endOffset: range.endOffset,
        rangeWithinFile: range.withinFile,
        rangeValid: range.valid,
      });
    }
  }

  const dfd = rangeInfo('dfd', header.dfdByteOffset, header.dfdByteLength, fileByteLength);
  const kvd = rangeInfo('kvd', header.kvdByteOffset, header.kvdByteLength, fileByteLength);
  const sgd = rangeInfo('sgd', header.sgdByteOffset, header.sgdByteLength, fileByteLength);
  if (!dfd.valid) issues.push('invalid-dfd-range');
  if (!kvd.valid) issues.push('invalid-kvd-range');
  if (!sgd.valid) issues.push('invalid-sgd-range');

  const precedingByteEnd = Math.max(
    levelIndexEndOffset,
    maxPresentEnd(dfd, kvd)
  );
  const supercompression = textureKtxSupercompressionPolicy({
    supercompressionScheme: header.supercompressionScheme,
    levels,
    sgdByteOffset: header.sgdByteOffset,
    sgdByteLength: header.sgdByteLength,
    precedingByteEnd,
    faceCount: header.faceCount,
    layerCount: header.layerCount,
  });
  if (!supercompression.valid) issues.push('invalid-supercompression-policy');

  const rangesValid = levelIndexWithinFile
    && levels.every((level) => level.rangeValid)
    && dfd.valid
    && kvd.valid
    && sgd.valid;
  const valid = identifierValid
    && headerComplete
    && rangesValid
    && supercompression.valid;

  return {
    container: 'ktx2',
    valid,
    identifierValid,
    headerComplete,
    fileByteLength,
    header,
    indexLevelCount,
    levelIndexOffset,
    levelIndexByteLength,
    levelIndexEndOffset,
    levelIndexWithinFile,
    levels,
    sections: { dfd, kvd, sgd },
    precedingByteEnd,
    scheme: textureKtxSupercompressionSchemeInfo(header.supercompressionScheme),
    supercompression,
    issues: uniqueIssues(issues),
    strict: Boolean(options.strict),
  };
}

export function ktx2PayloadPlan(containerOrData, options = {}) {
  const parsed = containerOrData?.container === 'ktx2'
    ? containerOrData
    : parseKtx2Container(containerOrData, options);
  const scheme = parsed.scheme || textureKtxSupercompressionSchemeInfo(
    parsed.header?.supercompressionScheme ?? KTX_SUPERCOMPRESSION_SCHEMES.NONE
  );
  const requiresInflation = Boolean(scheme.requiresInflation);
  const requiresBasisTranscode = scheme.scheme === KTX_SUPERCOMPRESSION_SCHEMES.BASIS_LZ;
  const directUploadCandidate = parsed.valid
    && !requiresInflation
    && Number(parsed.header?.vkFormat || 0) !== 0;
  return {
    container: 'ktx2',
    valid: parsed.valid,
    scheme,
    requiresInflation,
    requiresBasisTranscode,
    requiresPayloadDecoder: requiresInflation,
    requiresGlobalData: Boolean(scheme.usesGlobalData),
    directUploadCandidate,
    vkFormat: parsed.header?.vkFormat ?? 0,
    levelCount: parsed.levels.length,
    levels: parsed.levels.map((level) => ({
      mipLevel: level.mipLevel,
      byteOffset: level.byteOffset,
      byteLength: level.byteLength,
      uncompressedByteLength: level.uncompressedByteLength,
      endOffset: level.endOffset,
      rangeWithinFile: level.rangeWithinFile,
      compressed: requiresInflation,
    })),
    globalData: parsed.sections?.sgd || null,
    issues: parsed.issues,
  };
}

export function getKtx2SectionPayloadView(data, section = 'sgd') {
  const parsed = parseKtx2Container(data);
  const key = String(section || 'sgd').toLowerCase();
  return payloadViewForRange(data, parsed.sections?.[key]);
}

export function createKtx2PayloadDecodeRequest(data, options = {}) {
  const bytes = toByteView(data);
  const parsed = options.container?.container === 'ktx2'
    ? options.container
    : parseKtx2Container(bytes, options);
  const payloadPlan = ktx2PayloadPlan(parsed, options);
  const header = parsed.header || {};
  const levels = parsed.levels.map((level) => ({
    mipLevel: level.mipLevel,
    byteOffset: level.byteOffset,
    byteLength: level.byteLength,
    uncompressedByteLength: level.uncompressedByteLength,
    width: mipExtent(header.pixelWidth || 1, level.mipLevel),
    height: mipExtent(header.pixelHeight || 1, level.mipLevel),
    depthOrArrayLayers: ktx2LevelDepthOrArrayLayers(header, level.mipLevel),
    payload: getKtx2LevelPayloadView(bytes, level.mipLevel),
    compressed: payloadPlan.requiresPayloadDecoder,
  }));
  const targetFormat = options.targetFormat
    || options.webgpuFormat
    || options.format
    || null;
  const issues = [...(parsed.issues || [])];
  if (!payloadPlan.requiresPayloadDecoder) issues.push('payload-decoder-not-required');
  return {
    container: 'ktx2',
    valid: parsed.valid && payloadPlan.requiresPayloadDecoder,
    parsed,
    payloadPlan,
    scheme: payloadPlan.scheme,
    requiresInflation: payloadPlan.requiresInflation,
    requiresBasisTranscode: payloadPlan.requiresBasisTranscode,
    requiresGlobalData: payloadPlan.requiresGlobalData,
    width: positiveCount(header.pixelWidth || 1),
    height: positiveCount(header.pixelHeight || 1),
    depthOrArrayLayers: ktx2LevelDepthOrArrayLayers(header, 0),
    vkFormat: header.vkFormat ?? 0,
    targetFormat,
    supportedFeatures: options.supportedFeatures || options.features || null,
    levels,
    dfd: payloadViewForRange(bytes, parsed.sections?.dfd),
    kvd: payloadViewForRange(bytes, parsed.sections?.kvd),
    supercompressionGlobalData: payloadViewForRange(bytes, parsed.sections?.sgd),
    globalData: parsed.sections?.sgd || null,
    issues: uniqueIssues(issues),
  };
}

export function ktx2DirectUploadPlan(containerOrData, options = {}) {
  const parsed = containerOrData?.container === 'ktx2'
    ? containerOrData
    : parseKtx2Container(containerOrData, options);
  const supportedFeatures = options.supportedFeatures || options.features || null;
  const formatInfo = ktx2VkFormatInfo(parsed.header?.vkFormat ?? 0, supportedFeatures);
  const scheme = parsed.scheme || textureKtxSupercompressionSchemeInfo(
    parsed.header?.supercompressionScheme ?? KTX_SUPERCOMPRESSION_SCHEMES.NONE
  );
  const issues = [...(parsed.issues || [])];
  if (!parsed.valid) issues.push('invalid-container');
  if (scheme.scheme !== KTX_SUPERCOMPRESSION_SCHEMES.NONE) issues.push('requires-payload-decoder');
  if (formatInfo.undefinedFormat) issues.push('vk-format-undefined');
  if (!formatInfo.known) issues.push('unsupported-vk-format');
  if (formatInfo.known && !formatInfo.supported) issues.push('webgpu-format-feature-not-supported');

  const header = parsed.header || {};
  const levels = parsed.levels.map((level) => {
    const mipLevel = level.mipLevel;
    const layout = formatInfo.webgpuFormat
      ? textureWebGpuUploadLayout({
        width: header.pixelWidth,
        height: header.pixelHeight,
        depthOrArrayLayers: ktx2LevelDepthOrArrayLayers(header, mipLevel),
        format: formatInfo.webgpuFormat,
        mipLevel,
        offset: level.byteOffset,
      })
      : null;
    const copyBufferLayout = formatInfo.webgpuFormat
      ? textureWebGpuUploadLayout({
        width: header.pixelWidth,
        height: header.pixelHeight,
        depthOrArrayLayers: ktx2LevelDepthOrArrayLayers(header, mipLevel),
        format: formatInfo.webgpuFormat,
        mipLevel,
        offset: level.byteOffset,
        copyBufferToTexture: true,
      })
      : null;
    const expectedByteLength = layout?.tightByteLength ?? 0;
    const byteLengthMatches = Boolean(layout) && level.byteLength === expectedByteLength;
    if (!byteLengthMatches) issues.push(`level-${mipLevel}-byte-length-mismatch`);
    return {
      mipLevel,
      byteOffset: level.byteOffset,
      byteLength: level.byteLength,
      expectedByteLength,
      byteLengthMatches,
      writeTexture: layout ? {
        destination: { mipLevel, origin: { x: 0, y: 0, z: 0 } },
        dataLayout: layout.dataLayout,
        copySize: layout.copySize,
      } : null,
      copyBufferToTexture: copyBufferLayout ? {
        source: {
          offset: copyBufferLayout.offset,
          bytesPerRow: copyBufferLayout.bytesPerRow,
          rowsPerImage: copyBufferLayout.rowsPerImage,
        },
        destination: { mipLevel, origin: { x: 0, y: 0, z: 0 } },
        copySize: copyBufferLayout.copySize,
        requiresRowPadding: copyBufferLayout.needsRowPadding,
        paddedByteLength: copyBufferLayout.byteLength,
      } : null,
    };
  });

  const levelsReady = levels.length > 0 && levels.every((level) => level.byteLengthMatches);
  const ready = parsed.valid
    && scheme.scheme === KTX_SUPERCOMPRESSION_SCHEMES.NONE
    && formatInfo.known
    && formatInfo.supported
    && levelsReady;
  const textureDescriptor = ready ? {
    size: {
      width: positiveCount(header.pixelWidth),
      height: positiveCount(header.pixelHeight),
      depthOrArrayLayers: ktx2LevelDepthOrArrayLayers(header, 0),
    },
    format: formatInfo.webgpuFormat,
    mipLevelCount: levels.length,
    dimension: Number(header.pixelDepth || 0) > 0 ? '3d' : '2d',
  } : null;
  if (textureDescriptor && options.usage != null) {
    textureDescriptor.usage = options.usage;
  }

  return {
    container: 'ktx2',
    valid: ready,
    directUploadReady: ready,
    parsedValid: parsed.valid,
    format: formatInfo.webgpuFormat,
    formatInfo,
    scheme,
    levelCount: levels.length,
    levels,
    textureDescriptor,
    issues: uniqueIssues(issues),
  };
}

export function getKtx2LevelPayloadView(data, level = 0) {
  const bytes = toByteView(data);
  const parsed = parseKtx2Container(bytes);
  const index = typeof level === 'number' ? level : Number(level?.mipLevel || 0);
  const entry = parsed.levels[index];
  if (!parsed.valid || !entry || !entry.rangeValid) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, 0);
  }
  return new Uint8Array(
    bytes.buffer,
    bytes.byteOffset + entry.byteOffset,
    entry.byteLength
  );
}
