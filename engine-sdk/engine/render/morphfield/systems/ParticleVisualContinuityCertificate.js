// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  deepFreezeParticleContract,
  particleFinite,
  particleIdentifier,
  particleInteger,
  particleRecord,
  particleRevision,
} from './ParticleRepresentationContracts.js';
import { sha256Hex } from '../../../matter/fabric/FabricSupport.js';
import {
  compareParticlePresentationSourceStamps,
  validateParticlePresentationSourceStamp,
} from './ParticlePresentationSourceStamp.js';

export const PARTICLE_VISUAL_CONTINUITY_CONTRACT_SCHEMA =
  'engine.morphfield.particle-visual-continuity-contract';
export const PARTICLE_VISUAL_CONTINUITY_CONTRACT_VERSION = '1.0.0';
export const PARTICLE_VISUAL_FRAME_SCHEMA = 'engine.morphfield.particle-visual-frame';
export const PARTICLE_VISUAL_FRAME_VERSION = '1.0.0';
export const PARTICLE_VISUAL_CONTINUITY_CERTIFICATE_SCHEMA =
  'engine.morphfield.particle-visual-continuity-certificate';
export const PARTICLE_VISUAL_CONTINUITY_CERTIFICATE_VERSION = '1.0.0';
export const PARTICLE_VISUAL_MAX_FRAME_PIXELS = 8_847_360;
export const PARTICLE_VISUAL_MAX_CERTIFICATE_PIXEL_SAMPLES = 17_694_720;
export const PARTICLE_VISUAL_MAX_CERTIFICATE_FRAMES = 64;
export const PARTICLE_VISUAL_LIVE_CONTEXT_FIELDS = Object.freeze([
  'nowSeconds',
  'sourceStamp',
  'cameraStamp',
  'width',
  'height',
  'channels',
  'targetFormat',
  'colorEncoding',
  'deviceGeneration',
  'exposureStamp',
  'referenceHistoryStamp',
  'candidateHistoryStamp',
  'referenceShaderFingerprint',
  'candidateShaderFingerprint',
  'referenceRepresentationRevision',
  'candidateRepresentationRevision',
]);

const FRAME_PIXELS = new WeakMap();
const FRAME_SIGNALS = new WeakMap();
const SQRT2 = Math.sqrt(2);
const EPSILON = 1e-12;

const DEFAULT_LIMITS = Object.freeze({
  minimumSilhouetteIoU: 0.98,
  maximumProjectedAreaRelative: 0.02,
  maximumCentroidErrorPx: 0.5,
  maximumP95EdgeDistancePx: 1.5,
  maximumLuminanceRmse: 0.025,
  maximumLuminanceP95: 0.08,
  maximumColorRmse: 0.04,
  maximumEnergyRelative: 0.01,
  maximumConnectedOutlierFraction: 0.0025,
  maximumGridPeriodicEnergy: 0.01,
  maximumTemporalFlickerRatio: 1.1,
  maximumTemporalFlickerAbsolute: 0.01,
  maximumTemporalFlashP95: 0.08,
});

export function missingParticleVisualLiveContextFields(context) {
  if (!context || typeof context !== 'object') return [...PARTICLE_VISUAL_LIVE_CONTEXT_FIELDS];
  return PARTICLE_VISUAL_LIVE_CONTEXT_FIELDS.filter(field => context[field] == null);
}

function revisionKey(value) {
  return `${typeof value}:${String(value)}`;
}

function strongFingerprint(value) {
  return `sha256:${sha256Hex(JSON.stringify(value))}`;
}

function optionalIdentifier(value, fallback, path) {
  return particleIdentifier(value ?? fallback, path);
}

function finiteUnit(value, path, fallback) {
  return particleFinite(value ?? fallback, path, { minimum: 0, maximum: 1 });
}

function normalizedGridPeriods(input) {
  const source = input ?? [8];
  if (!Array.isArray(source) || source.length === 0 || source.length > 16) {
    throw new TypeError('contract.gridPeriodsPx must contain between 1 and 16 periods');
  }
  const periods = [...new Set(source.map((value, index) => particleInteger(
    value,
    `contract.gridPeriodsPx[${index}]`,
    { minimum: 2, maximum: 256 },
  )))].sort((left, right) => left - right);
  return periods;
}

export function createParticleVisualContinuityContract(input = {}) {
  const source = particleRecord(input, 'contract');
  const limits = {};
  for (const [name, fallback] of Object.entries(DEFAULT_LIMITS)) {
    const minimum = name === 'maximumTemporalFlickerRatio' ? 1 : 0;
    const maximum = name === 'minimumSilhouetteIoU' ? 1 : Number.MAX_VALUE;
    limits[name] = particleFinite(source[name] ?? fallback, `contract.${name}`, {
      minimum,
      maximum,
    });
  }
  const contract = {
    schema: PARTICLE_VISUAL_CONTINUITY_CONTRACT_SCHEMA,
    schemaVersion: PARTICLE_VISUAL_CONTINUITY_CONTRACT_VERSION,
    maskMode: String(source.maskMode ?? 'luminance'),
    maskThreshold: finiteUnit(source.maskThreshold, 'contract.maskThreshold', 0.02),
    outlierThreshold: finiteUnit(source.outlierThreshold, 'contract.outlierThreshold', 0.08),
    gridPeriodsPx: normalizedGridPeriods(source.gridPeriodsPx),
    ...limits,
  };
  if (!['luminance', 'alpha', 'alpha-or-luminance'].includes(contract.maskMode)) {
    throw new RangeError('contract.maskMode must be luminance, alpha, or alpha-or-luminance');
  }
  return deepFreezeParticleContract({
    ...contract,
    fingerprint: strongFingerprint(contract),
  });
}

function normalizePixels(pixels, expectedLength, valueScale) {
  if (!Array.isArray(pixels) && !ArrayBuffer.isView(pixels)) {
    throw new TypeError('frame.pixels must be an array or typed array');
  }
  if (pixels.length !== expectedLength) {
    throw new RangeError(`frame.pixels must contain exactly ${expectedLength} values`);
  }
  let divisor = valueScale;
  if (divisor == null) {
    if (pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray) divisor = 255;
    else if (pixels instanceof Uint16Array) divisor = 65_535;
    else divisor = 1;
  }
  divisor = particleFinite(divisor, 'frame.valueScale', { minimum: Number.MIN_VALUE });
  const normalized = new Uint16Array(expectedLength);
  for (let index = 0; index < expectedLength; index++) {
    const value = particleFinite(pixels[index], `frame.pixels[${index}]`) / divisor;
    normalized[index] = Math.round(Math.max(0, Math.min(1, value)) * 65_535);
  }
  return normalized;
}

function pixelFingerprint(pixels) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < pixels.length; index++) {
    const word = pixels[index];
    hash = Math.imul((hash ^ (word & 0xff)) >>> 0, 0x01000193) >>> 0;
    hash = Math.imul((hash ^ ((word >>> 8) & 0xff)) >>> 0, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Capture an owned CPU readback without exposing mutable pixel storage. */
export function captureParticleVisualFrame(input) {
  const source = particleRecord(input, 'frame');
  const width = particleInteger(source.width, 'frame.width', { minimum: 1, maximum: 32_768 });
  const height = particleInteger(source.height, 'frame.height', { minimum: 1, maximum: 32_768 });
  const channels = particleInteger(source.channels ?? 4, 'frame.channels', {
    minimum: 1,
    maximum: 4,
  });
  const pixelCount = width * height;
  if (pixelCount > PARTICLE_VISUAL_MAX_FRAME_PIXELS) {
    throw new RangeError(
      `frame exceeds the ${PARTICLE_VISUAL_MAX_FRAME_PIXELS} pixel evidence budget`,
    );
  }
  const pixels = normalizePixels(source.pixels, pixelCount * channels, source.valueScale);
  const sourceStamp = validateParticlePresentationSourceStamp(source.sourceStamp);
  const metadata = {
    schema: PARTICLE_VISUAL_FRAME_SCHEMA,
    schemaVersion: PARTICLE_VISUAL_FRAME_VERSION,
    id: optionalIdentifier(source.id, 'particle-visual-frame', 'frame.id'),
    width,
    height,
    channels,
    targetFormat: optionalIdentifier(source.targetFormat, 'rgba8unorm', 'frame.targetFormat'),
    colorEncoding: optionalIdentifier(source.colorEncoding, 'linear-srgb', 'frame.colorEncoding'),
    cameraStamp: particleIdentifier(source.cameraStamp, 'frame.cameraStamp'),
    shaderFingerprint: particleIdentifier(
      source.shaderFingerprint,
      'frame.shaderFingerprint',
    ),
    representationRevision: particleRevision(
      source.representationRevision ?? 0,
      'frame.representationRevision',
    ),
    deviceGeneration: particleRevision(
      source.deviceGeneration ?? 0,
      'frame.deviceGeneration',
    ),
    exposureStamp: optionalIdentifier(source.exposureStamp, 'exposure.default', 'frame.exposureStamp'),
    historyStamp: optionalIdentifier(source.historyStamp, 'history.none', 'frame.historyStamp'),
    capturedAtSeconds: particleFinite(source.capturedAtSeconds, 'frame.capturedAtSeconds'),
    sourceStamp,
    pixelFingerprint: pixelFingerprint(pixels),
  };
  const frame = deepFreezeParticleContract({
    ...metadata,
    contextFingerprint: strongFingerprint({
      width,
      height,
      channels,
      targetFormat: metadata.targetFormat,
      colorEncoding: metadata.colorEncoding,
      cameraStamp: metadata.cameraStamp,
      shaderFingerprint: metadata.shaderFingerprint,
      representationRevision: revisionKey(metadata.representationRevision),
      deviceGeneration: revisionKey(metadata.deviceGeneration),
      exposureStamp: metadata.exposureStamp,
      historyStamp: metadata.historyStamp,
      topologyKey: sourceStamp.topologyKey,
    }),
  });
  FRAME_PIXELS.set(frame, pixels);
  return frame;
}

function framePixels(frame, path) {
  if (!frame || frame.schema !== PARTICLE_VISUAL_FRAME_SCHEMA
      || frame.schemaVersion !== PARTICLE_VISUAL_FRAME_VERSION
      || !FRAME_PIXELS.has(frame)) {
    throw new TypeError(`${path} must be a frame returned by captureParticleVisualFrame()`);
  }
  return FRAME_PIXELS.get(frame);
}

function frameSignals(frame, contract) {
  let cache = FRAME_SIGNALS.get(frame);
  if (!cache) {
    cache = new Map();
    FRAME_SIGNALS.set(frame, cache);
  }
  if (cache.has(contract.fingerprint)) return cache.get(contract.fingerprint);
  const pixels = framePixels(frame, 'frame');
  const count = frame.width * frame.height;
  const luminance = new Float32Array(count);
  const mask = new Uint8Array(count);
  let energy = 0;
  let area = 0;
  let centroidX = 0;
  let centroidY = 0;
  for (let pixel = 0; pixel < count; pixel++) {
    const offset = pixel * frame.channels;
    const red = pixels[offset] / 65_535;
    const green = frame.channels >= 3 ? pixels[offset + 1] / 65_535 : red;
    const blue = frame.channels >= 3 ? pixels[offset + 2] / 65_535 : red;
    const alpha = frame.channels >= 4 ? pixels[offset + 3] / 65_535 : 1;
    const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    const covered = contract.maskMode === 'alpha'
      ? alpha > contract.maskThreshold
      : contract.maskMode === 'alpha-or-luminance'
        ? Math.max(alpha, luma) > contract.maskThreshold
        : luma > contract.maskThreshold;
    luminance[pixel] = luma;
    mask[pixel] = covered ? 1 : 0;
    energy += luma;
    if (covered) {
      area += 1;
      centroidX += pixel % frame.width;
      centroidY += Math.floor(pixel / frame.width);
    }
  }
  const signals = {
    luminance,
    mask,
    energy,
    area,
    centroid: area > 0 ? [centroidX / area, centroidY / area] : [0, 0],
  };
  cache.set(contract.fingerprint, signals);
  return signals;
}

function histogramQuantile(values, quantile, maximumValue = null) {
  if (values.length === 0) return 0;
  let maximum = maximumValue ?? 0;
  if (maximumValue == null) {
    for (const value of values) maximum = Math.max(maximum, value);
  }
  if (maximum <= EPSILON) return 0;
  const bins = new Uint32Array(2048);
  for (const value of values) {
    const index = Math.min(bins.length - 1, Math.floor(value / maximum * (bins.length - 1)));
    bins[index] += 1;
  }
  const target = Math.max(1, Math.ceil(values.length * quantile));
  let cumulative = 0;
  for (let index = 0; index < bins.length; index++) {
    cumulative += bins[index];
    if (cumulative >= target) return index / (bins.length - 1) * maximum;
  }
  return maximum;
}

function edgeMask(mask, width, height) {
  const edges = new Uint8Array(mask.length);
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (!mask[index]) continue;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1
          || !mask[index - 1] || !mask[index + 1]
          || !mask[index - width] || !mask[index + width]) {
        edges[index] = 1;
        count += 1;
      }
    }
  }
  return { edges, count };
}

function edgeDistanceField(edges, width, height) {
  const distance = new Float32Array(edges.length);
  for (let index = 0; index < edges.length; index++) {
    distance[index] = edges[index] ? 0 : Number.POSITIVE_INFINITY;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      let value = distance[index];
      if (x > 0) value = Math.min(value, distance[index - 1] + 1);
      if (y > 0) value = Math.min(value, distance[index - width] + 1);
      if (x > 0 && y > 0) value = Math.min(value, distance[index - width - 1] + SQRT2);
      if (x + 1 < width && y > 0) value = Math.min(value, distance[index - width + 1] + SQRT2);
      distance[index] = value;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const index = y * width + x;
      let value = distance[index];
      if (x + 1 < width) value = Math.min(value, distance[index + 1] + 1);
      if (y + 1 < height) value = Math.min(value, distance[index + width] + 1);
      if (x + 1 < width && y + 1 < height) {
        value = Math.min(value, distance[index + width + 1] + SQRT2);
      }
      if (x > 0 && y + 1 < height) {
        value = Math.min(value, distance[index + width - 1] + SQRT2);
      }
      distance[index] = value;
    }
  }
  return distance;
}

function p95SymmetricEdgeDistance(reference, candidate, width, height) {
  const referenceEdge = edgeMask(reference, width, height);
  const candidateEdge = edgeMask(candidate, width, height);
  if (referenceEdge.count === 0 && candidateEdge.count === 0) return 0;
  if (referenceEdge.count === 0 || candidateEdge.count === 0) return Math.hypot(width, height);
  const toReference = edgeDistanceField(referenceEdge.edges, width, height);
  const toCandidate = edgeDistanceField(candidateEdge.edges, width, height);
  const distances = new Float32Array(referenceEdge.count + candidateEdge.count);
  let cursor = 0;
  for (let index = 0; index < reference.length; index++) {
    if (referenceEdge.edges[index]) distances[cursor++] = toCandidate[index];
    if (candidateEdge.edges[index]) distances[cursor++] = toReference[index];
  }
  return histogramQuantile(distances, 0.95);
}

function maximumConnectedOutlierFraction(errors, width, height, threshold) {
  const visited = new Uint8Array(errors.length);
  const queue = new Int32Array(errors.length);
  let largest = 0;
  for (let seed = 0; seed < errors.length; seed++) {
    if (visited[seed] || errors[seed] <= threshold) continue;
    visited[seed] = 1;
    let head = 0;
    let tail = 1;
    queue[0] = seed;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const candidates = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        index >= width ? index - width : -1,
        index + width < errors.length ? index + width : -1,
      ];
      for (const candidate of candidates) {
        if (candidate >= 0 && !visited[candidate] && errors[candidate] > threshold) {
          visited[candidate] = 1;
          queue[tail++] = candidate;
        }
      }
    }
    largest = Math.max(largest, tail);
  }
  return largest / errors.length;
}

function gridPeriodicEnergy(errors, width, height, periods) {
  let maximum = 0;
  for (const period of periods) {
    const xCosine = new Float64Array(width);
    const xSine = new Float64Array(width);
    const yCosine = new Float64Array(height);
    const ySine = new Float64Array(height);
    for (let x = 0; x < width; x++) {
      const phase = x * Math.PI * 2 / period;
      xCosine[x] = Math.cos(phase);
      xSine[x] = Math.sin(phase);
    }
    for (let y = 0; y < height; y++) {
      const phase = y * Math.PI * 2 / period;
      yCosine[y] = Math.cos(phase);
      ySine[y] = Math.sin(phase);
    }
    let xCos = 0;
    let xSin = 0;
    let yCos = 0;
    let ySin = 0;
    for (let index = 0; index < errors.length; index++) {
      const x = index % width;
      const y = Math.floor(index / width);
      const magnitude = errors[index];
      xCos += magnitude * xCosine[x];
      xSin += magnitude * xSine[x];
      yCos += magnitude * yCosine[y];
      ySin += magnitude * ySine[y];
    }
    const inverse = 2 / errors.length;
    maximum = Math.max(
      maximum,
      Math.hypot(xCos, xSin) * inverse,
      Math.hypot(yCos, ySin) * inverse,
    );
  }
  return maximum;
}

function incompatibleFrameReason(reference, candidate) {
  const sourceComparison = compareParticlePresentationSourceStamps(
    reference.sourceStamp,
    candidate.sourceStamp,
  );
  if (!sourceComparison.sameStateSample) return 'state-sample-mismatch';
  const fields = [
    'width', 'height', 'channels', 'targetFormat', 'colorEncoding',
    'cameraStamp', 'deviceGeneration', 'exposureStamp',
  ];
  for (const field of fields) {
    if (revisionKey(reference[field]) !== revisionKey(candidate[field])) {
      return `frame-${field}-mismatch`;
    }
  }
  if (reference.capturedAtSeconds !== candidate.capturedAtSeconds) {
    return 'capture-time-mismatch';
  }
  return null;
}

export function compareParticleVisualFrames(reference, candidate, contractInput = {}) {
  const referencePixels = framePixels(reference, 'reference');
  const candidatePixels = framePixels(candidate, 'candidate');
  const contract = createParticleVisualContinuityContract(contractInput);
  const incompatibility = incompatibleFrameReason(reference, candidate);
  if (incompatibility) {
    return deepFreezeParticleContract({
      accepted: false,
      reasonCodes: [incompatibility],
      measurements: {},
    });
  }
  const referenceSignals = frameSignals(reference, contract);
  const candidateSignals = frameSignals(candidate, contract);
  const pixelCount = reference.width * reference.height;
  const errors = new Float32Array(pixelCount);
  let intersection = 0;
  let union = 0;
  let sumSquaredLuminance = 0;
  let sumSquaredColor = 0;
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const referenceCovered = referenceSignals.mask[pixel] === 1;
    const candidateCovered = candidateSignals.mask[pixel] === 1;
    if (referenceCovered && candidateCovered) intersection += 1;
    if (referenceCovered || candidateCovered) union += 1;
    const lumaError = Math.abs(
      referenceSignals.luminance[pixel] - candidateSignals.luminance[pixel],
    );
    errors[pixel] = lumaError;
    sumSquaredLuminance += lumaError * lumaError;
    const pixelOffset = pixel * reference.channels;
    for (let channel = 0; channel < 3; channel++) {
      const sourceChannel = reference.channels >= 3 ? channel : 0;
      const difference = (referencePixels[pixelOffset + sourceChannel]
        - candidatePixels[pixelOffset + sourceChannel]) / 65_535;
      sumSquaredColor += difference * difference;
    }
  }
  const measurements = {
    silhouetteIoU: union === 0 ? 1 : intersection / union,
    projectedAreaRelative: Math.abs(candidateSignals.area - referenceSignals.area)
      / Math.max(referenceSignals.area, 1),
    centroidErrorPx: Math.hypot(
      candidateSignals.centroid[0] - referenceSignals.centroid[0],
      candidateSignals.centroid[1] - referenceSignals.centroid[1],
    ),
    p95EdgeDistancePx: p95SymmetricEdgeDistance(
      referenceSignals.mask,
      candidateSignals.mask,
      reference.width,
      reference.height,
    ),
    luminanceRmse: Math.sqrt(sumSquaredLuminance / pixelCount),
    luminanceP95: histogramQuantile(errors, 0.95, 1),
    colorRmse: Math.sqrt(sumSquaredColor / (pixelCount * 3)),
    energyRelative: Math.abs(candidateSignals.energy - referenceSignals.energy)
      / Math.max(referenceSignals.energy, EPSILON),
    connectedOutlierFraction: maximumConnectedOutlierFraction(
      errors,
      reference.width,
      reference.height,
      contract.outlierThreshold,
    ),
    gridPeriodicEnergy: gridPeriodicEnergy(
      errors,
      reference.width,
      reference.height,
      contract.gridPeriodsPx,
    ),
  };
  const checks = [
    ['silhouette-iou', measurements.silhouetteIoU < contract.minimumSilhouetteIoU],
    ['projected-area', measurements.projectedAreaRelative > contract.maximumProjectedAreaRelative],
    ['centroid', measurements.centroidErrorPx > contract.maximumCentroidErrorPx],
    ['edge-distance', measurements.p95EdgeDistancePx > contract.maximumP95EdgeDistancePx],
    ['luminance-rmse', measurements.luminanceRmse > contract.maximumLuminanceRmse],
    ['luminance-p95', measurements.luminanceP95 > contract.maximumLuminanceP95],
    ['color-rmse', measurements.colorRmse > contract.maximumColorRmse],
    ['energy', measurements.energyRelative > contract.maximumEnergyRelative],
    ['connected-outlier', measurements.connectedOutlierFraction
      > contract.maximumConnectedOutlierFraction],
    ['grid-periodicity', measurements.gridPeriodicEnergy > contract.maximumGridPeriodicEnergy],
  ];
  const reasonCodes = checks.filter(([_code, failed]) => failed).map(([code]) => code);
  return deepFreezeParticleContract({
    accepted: reasonCodes.length === 0,
    reasonCodes,
    measurements,
  });
}

function temporalMeasurements(previousReference, reference, previousCandidate, candidate, contract) {
  const previousReferenceSignals = frameSignals(previousReference, contract);
  const referenceSignals = frameSignals(reference, contract);
  const previousCandidateSignals = frameSignals(previousCandidate, contract);
  const candidateSignals = frameSignals(candidate, contract);
  const referenceDelta = new Float32Array(referenceSignals.luminance.length);
  const candidateDelta = new Float32Array(referenceSignals.luminance.length);
  const flashExcess = new Float32Array(referenceSignals.luminance.length);
  for (let index = 0; index < referenceDelta.length; index++) {
    referenceDelta[index] = Math.abs(
      referenceSignals.luminance[index] - previousReferenceSignals.luminance[index],
    );
    candidateDelta[index] = Math.abs(
      candidateSignals.luminance[index] - previousCandidateSignals.luminance[index],
    );
    flashExcess[index] = Math.max(0, candidateDelta[index] - referenceDelta[index]);
  }
  const referenceFlickerP95 = histogramQuantile(referenceDelta, 0.95, 1);
  const candidateFlickerP95 = histogramQuantile(candidateDelta, 0.95, 1);
  return {
    referenceFlickerP95,
    candidateFlickerP95,
    allowedCandidateFlickerP95: referenceFlickerP95
      * contract.maximumTemporalFlickerRatio
      + contract.maximumTemporalFlickerAbsolute,
    flashExcessP95: histogramQuantile(flashExcess, 0.95, 1),
  };
}

function certificateIdentity(certificate) {
  return {
    contractFingerprint: certificate.contract.fingerprint,
    sourceTopologyKey: certificate.sourceStamp.topologyKey,
    binding: certificate.binding,
    frameCount: certificate.frameCount,
    metrics: certificate.metrics,
    accepted: certificate.accepted,
    reasonCodes: certificate.reasonCodes,
    capturedAtSeconds: certificate.capturedAtSeconds,
    validUntilSeconds: certificate.validUntilSeconds,
    authority: certificate.authority,
  };
}

export function createParticleVisualContinuityCertificate(input) {
  const source = particleRecord(input, 'certificateInput');
  if (!Array.isArray(source.referenceFrames) || !Array.isArray(source.candidateFrames)
      || source.referenceFrames.length === 0
      || source.referenceFrames.length !== source.candidateFrames.length) {
    throw new TypeError('referenceFrames and candidateFrames must be equal non-empty arrays');
  }
  if (source.referenceFrames.length > PARTICLE_VISUAL_MAX_CERTIFICATE_FRAMES) {
    throw new RangeError(
      `certificate exceeds the ${PARTICLE_VISUAL_MAX_CERTIFICATE_FRAMES} frame-pair budget`,
    );
  }
  const contract = createParticleVisualContinuityContract(source.contract ?? {});
  const firstReference = source.referenceFrames[0];
  const firstCandidate = source.candidateFrames[0];
  framePixels(firstReference, 'referenceFrames[0]');
  framePixels(firstCandidate, 'candidateFrames[0]');
  let pixelSamples = 0;
  for (let index = 0; index < source.referenceFrames.length; index++) {
    framePixels(source.referenceFrames[index], `referenceFrames[${index}]`);
    framePixels(source.candidateFrames[index], `candidateFrames[${index}]`);
    pixelSamples += source.referenceFrames[index].width * source.referenceFrames[index].height;
  }
  if (pixelSamples > PARTICLE_VISUAL_MAX_CERTIFICATE_PIXEL_SAMPLES) {
    throw new RangeError(
      `certificate exceeds the ${PARTICLE_VISUAL_MAX_CERTIFICATE_PIXEL_SAMPLES} pixel-sample budget`,
    );
  }
  const sourceStamp = firstReference.sourceStamp;
  const binding = {
    width: firstReference.width,
    height: firstReference.height,
    channels: firstReference.channels,
    targetFormat: firstReference.targetFormat,
    colorEncoding: firstReference.colorEncoding,
    cameraStamp: firstReference.cameraStamp,
    deviceGeneration: firstReference.deviceGeneration,
    exposureStamp: firstReference.exposureStamp,
    referenceHistoryStamp: firstReference.historyStamp,
    candidateHistoryStamp: firstCandidate.historyStamp,
    referenceShaderFingerprint: firstReference.shaderFingerprint,
    candidateShaderFingerprint: firstCandidate.shaderFingerprint,
    referenceRepresentationRevision: firstReference.representationRevision,
    candidateRepresentationRevision: firstCandidate.representationRevision,
  };
  const metrics = {
    minimumSilhouetteIoU: 1,
    maximumProjectedAreaRelative: 0,
    maximumCentroidErrorPx: 0,
    maximumP95EdgeDistancePx: 0,
    maximumLuminanceRmse: 0,
    maximumLuminanceP95: 0,
    maximumColorRmse: 0,
    maximumEnergyRelative: 0,
    maximumConnectedOutlierFraction: 0,
    maximumGridPeriodicEnergy: 0,
    maximumReferenceFlickerP95: 0,
    maximumCandidateFlickerP95: 0,
    minimumAllowedCandidateFlickerP95: Number.POSITIVE_INFINITY,
    maximumTemporalFlashP95: 0,
  };
  const reasons = new Set();
  for (let index = 0; index < source.referenceFrames.length; index++) {
    const reference = source.referenceFrames[index];
    const candidate = source.candidateFrames[index];
    const topology = compareParticlePresentationSourceStamps(sourceStamp, reference.sourceStamp);
    if (!topology.sameTopology) reasons.add('reference-topology-changed');
    if (reference.width !== binding.width || reference.height !== binding.height
        || reference.channels !== binding.channels
        || reference.cameraStamp !== binding.cameraStamp
        || revisionKey(reference.deviceGeneration) !== revisionKey(binding.deviceGeneration)
        || reference.targetFormat !== binding.targetFormat
        || reference.colorEncoding !== binding.colorEncoding
        || reference.exposureStamp !== binding.exposureStamp
        || reference.shaderFingerprint !== binding.referenceShaderFingerprint
        || revisionKey(reference.representationRevision)
          !== revisionKey(binding.referenceRepresentationRevision)
        || reference.historyStamp !== binding.referenceHistoryStamp) {
      reasons.add('reference-context-changed');
    }
    if (candidate.width !== binding.width || candidate.height !== binding.height
        || candidate.channels !== binding.channels
        || candidate.cameraStamp !== binding.cameraStamp
        || revisionKey(candidate.deviceGeneration) !== revisionKey(binding.deviceGeneration)
        || candidate.targetFormat !== binding.targetFormat
        || candidate.colorEncoding !== binding.colorEncoding
        || candidate.exposureStamp !== binding.exposureStamp
        || candidate.shaderFingerprint !== binding.candidateShaderFingerprint
        || revisionKey(candidate.representationRevision)
          !== revisionKey(binding.candidateRepresentationRevision)
        || candidate.historyStamp !== binding.candidateHistoryStamp) {
      reasons.add('candidate-context-changed');
    }
    const comparison = compareParticleVisualFrames(reference, candidate, contract);
    comparison.reasonCodes.forEach(reason => reasons.add(reason));
    const measured = comparison.measurements;
    if (Object.keys(measured).length > 0) {
      metrics.minimumSilhouetteIoU = Math.min(
        metrics.minimumSilhouetteIoU,
        measured.silhouetteIoU,
      );
      metrics.maximumProjectedAreaRelative = Math.max(
        metrics.maximumProjectedAreaRelative,
        measured.projectedAreaRelative,
      );
      metrics.maximumCentroidErrorPx = Math.max(
        metrics.maximumCentroidErrorPx,
        measured.centroidErrorPx,
      );
      metrics.maximumP95EdgeDistancePx = Math.max(
        metrics.maximumP95EdgeDistancePx,
        measured.p95EdgeDistancePx,
      );
      metrics.maximumLuminanceRmse = Math.max(
        metrics.maximumLuminanceRmse,
        measured.luminanceRmse,
      );
      metrics.maximumLuminanceP95 = Math.max(
        metrics.maximumLuminanceP95,
        measured.luminanceP95,
      );
      metrics.maximumColorRmse = Math.max(metrics.maximumColorRmse, measured.colorRmse);
      metrics.maximumEnergyRelative = Math.max(
        metrics.maximumEnergyRelative,
        measured.energyRelative,
      );
      metrics.maximumConnectedOutlierFraction = Math.max(
        metrics.maximumConnectedOutlierFraction,
        measured.connectedOutlierFraction,
      );
      metrics.maximumGridPeriodicEnergy = Math.max(
        metrics.maximumGridPeriodicEnergy,
        measured.gridPeriodicEnergy,
      );
    }
    if (index > 0 && Object.keys(measured).length > 0) {
      const temporal = temporalMeasurements(
        source.referenceFrames[index - 1],
        reference,
        source.candidateFrames[index - 1],
        candidate,
        contract,
      );
      metrics.maximumReferenceFlickerP95 = Math.max(
        metrics.maximumReferenceFlickerP95,
        temporal.referenceFlickerP95,
      );
      metrics.maximumCandidateFlickerP95 = Math.max(
        metrics.maximumCandidateFlickerP95,
        temporal.candidateFlickerP95,
      );
      metrics.minimumAllowedCandidateFlickerP95 = Math.min(
        metrics.minimumAllowedCandidateFlickerP95,
        temporal.allowedCandidateFlickerP95,
      );
      metrics.maximumTemporalFlashP95 = Math.max(
        metrics.maximumTemporalFlashP95,
        temporal.flashExcessP95,
      );
      if (temporal.candidateFlickerP95 > temporal.allowedCandidateFlickerP95) {
        reasons.add('temporal-flicker');
      }
      if (temporal.flashExcessP95 > contract.maximumTemporalFlashP95) {
        reasons.add('temporal-flash');
      }
    }
  }
  if (!Number.isFinite(metrics.minimumAllowedCandidateFlickerP95)) {
    metrics.minimumAllowedCandidateFlickerP95 = contract.maximumTemporalFlickerAbsolute;
  }
  const capturedAtSeconds = Math.max(
    ...source.referenceFrames.map(frame => frame.capturedAtSeconds),
  );
  if (source.capturedAtSeconds != null
      && particleFinite(source.capturedAtSeconds, 'certificateInput.capturedAtSeconds')
        !== capturedAtSeconds) {
    throw new RangeError('certificateInput.capturedAtSeconds must equal the latest captured frame');
  }
  const validForSeconds = particleFinite(
    source.validForSeconds ?? 0.5,
    'certificateInput.validForSeconds',
    { minimum: 0, maximum: 3600 },
  );
  const reasonCodes = [...reasons].sort();
  const certificate = {
    schema: PARTICLE_VISUAL_CONTINUITY_CERTIFICATE_SCHEMA,
    schemaVersion: PARTICLE_VISUAL_CONTINUITY_CERTIFICATE_VERSION,
    id: optionalIdentifier(source.id, 'particle-visual-continuity', 'certificateInput.id'),
    contract,
    sourceStamp,
    binding,
    frameCount: source.referenceFrames.length,
    metrics,
    accepted: reasonCodes.length === 0,
    reasonCodes,
    capturedAtSeconds,
    validUntilSeconds: capturedAtSeconds + validForSeconds,
    authority: {
      role: 'pixel-temporal-fidelity-evidence',
      grantsSimulationAuthority: false,
      canonicalPixelsRequiredForCapture: true,
    },
  };
  certificate.fingerprint = strongFingerprint(certificateIdentity(certificate));
  return deepFreezeParticleContract(certificate);
}

function validationResult(valid, reasonCodes, certificate = null) {
  return deepFreezeParticleContract({
    valid,
    reasonCodes: [...new Set(reasonCodes)],
    certificateId: certificate?.id ?? null,
    certificateFingerprint: certificate?.fingerprint ?? null,
  });
}

/** Validate the certificate against live render state; telemetry may advance. */
export function validateParticleVisualContinuityCertificate(certificateInput, context = {}) {
  try {
    const certificate = particleRecord(certificateInput, 'certificate');
    if (certificate.schema !== PARTICLE_VISUAL_CONTINUITY_CERTIFICATE_SCHEMA
        || certificate.schemaVersion !== PARTICLE_VISUAL_CONTINUITY_CERTIFICATE_VERSION) {
      return validationResult(false, ['invalid-certificate-schema']);
    }
    const normalizedContract = createParticleVisualContinuityContract(certificate.contract);
    if (normalizedContract.fingerprint !== certificate.contract?.fingerprint) {
      return validationResult(false, ['certificate-contract-fingerprint-mismatch'], certificate);
    }
    validateParticlePresentationSourceStamp(certificate.sourceStamp);
    if (certificate.authority?.role !== 'pixel-temporal-fidelity-evidence'
        || certificate.authority?.grantsSimulationAuthority !== false
        || certificate.authority?.canonicalPixelsRequiredForCapture !== true) {
      return validationResult(false, ['certificate-authority-mismatch'], certificate);
    }
    const missingContext = missingParticleVisualLiveContextFields(context);
    if (missingContext.length > 0) {
      return validationResult(false, [
        'live-visual-context-incomplete',
        ...missingContext.map(field => `live-context-missing-${field}`),
      ], certificate);
    }
    if (certificate.fingerprint !== strongFingerprint(certificateIdentity(certificate))) {
      return validationResult(false, ['certificate-fingerprint-mismatch'], certificate);
    }
    const reasonCodes = [];
    if (certificate.accepted !== true) reasonCodes.push('certificate-rejected');
    if (context.deviceLost === true) reasonCodes.push('device-lost');
    if (context.cameraCut === true) reasonCodes.push('camera-cut');
    if (context.resized === true) reasonCodes.push('render-target-resized');
    const nowSeconds = particleFinite(context.nowSeconds, 'context.nowSeconds');
    if (nowSeconds < certificate.capturedAtSeconds) reasonCodes.push('certificate-not-yet-valid');
    if (nowSeconds > certificate.validUntilSeconds) reasonCodes.push('certificate-stale');
    if (context.sourceStamp != null) {
      const comparison = compareParticlePresentationSourceStamps(
        certificate.sourceStamp,
        context.sourceStamp,
      );
      if (!comparison.sameTopology) reasonCodes.push('source-topology-changed');
    }
    const checks = [
      ['cameraStamp', 'camera-changed'],
      ['targetFormat', 'target-format-changed'],
      ['colorEncoding', 'color-encoding-changed'],
      ['exposureStamp', 'exposure-changed'],
      ['referenceHistoryStamp', 'reference-history-changed'],
      ['candidateHistoryStamp', 'candidate-history-changed'],
      ['referenceShaderFingerprint', 'reference-shader-changed'],
      ['candidateShaderFingerprint', 'candidate-shader-changed'],
    ];
    for (const [field, reason] of checks) {
      if (context[field] != null && String(context[field]) !== String(certificate.binding[field])) {
        reasonCodes.push(reason);
      }
    }
    if ((context.width != null && Number(context.width) !== certificate.binding.width)
        || (context.height != null && Number(context.height) !== certificate.binding.height)
        || (context.channels != null && Number(context.channels) !== certificate.binding.channels)) {
      reasonCodes.push('render-target-resized');
    }
    if (context.deviceGeneration != null
        && revisionKey(context.deviceGeneration) !== revisionKey(certificate.binding.deviceGeneration)) {
      reasonCodes.push('device-generation-changed');
    }
    if (context.referenceRepresentationRevision != null
        && revisionKey(context.referenceRepresentationRevision)
          !== revisionKey(certificate.binding.referenceRepresentationRevision)) {
      reasonCodes.push('reference-representation-revision-changed');
    }
    if (context.candidateRepresentationRevision != null
        && revisionKey(context.candidateRepresentationRevision)
          !== revisionKey(certificate.binding.candidateRepresentationRevision)) {
      reasonCodes.push('candidate-representation-revision-changed');
    }
    return validationResult(reasonCodes.length === 0, reasonCodes, certificate);
  } catch (error) {
    return validationResult(false, ['invalid-certificate', error?.message ?? String(error)]);
  }
}

export default createParticleVisualContinuityCertificate;
