// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// FrameMath.js - pure ImageData-like frame and temporal media math helpers.

import { clamp, saturate } from './MathScalar.js';
import { imageAverageColor, imageDataReport, imageHistogramReport, imageLuminanceMap } from './ImageMath.js';
import { frameDifference as scalarFrameDifference } from './MathQuality.js';
import { shannonEntropyFromHistogram } from './MathEntropy.js';
import { statsMean } from './MathStatistics.js';

const RGBA_CHANNELS = 4;
const RGB_CHANNELS = 3;
const BYTE_RANGE = 255;

export function frameDataReport(frame, options = {}) {
  const report = imageDataReport(frame, options);
  const metadata = frameMetadata(frame, options);
  return {
    ...report,
    ...metadata,
    frameByteLength: report.expectedByteLength,
  };
}

export function frameDifferenceReport(referenceFrame, candidateFrame, options = {}) {
  const reference = checkedFrame(referenceFrame, 'referenceFrame', options);
  const candidate = checkedFrame(candidateFrame, 'candidateFrame', options);
  assertMatchingFrameShape(reference, candidate);

  const includeAlpha = options.includeAlpha === true;
  const channels = includeAlpha ? RGBA_CHANNELS : RGB_CHANNELS;
  const dataRange = positiveFinite(options.dataRange ?? BYTE_RANGE, 'dataRange');
  const changedThreshold = finiteNonnegative(options.changedThreshold ?? 0, 'changedThreshold');
  const referenceValues = new Array(reference.pixelCount * channels);
  const candidateValues = new Array(candidate.pixelCount * channels);

  let changedPixels = 0;
  let writeIndex = 0;
  for (let pixel = 0, offset = 0; pixel < reference.pixelCount; pixel += 1, offset += RGBA_CHANNELS) {
    let pixelPeak = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const expected = byteValue(reference.data[offset + channel], `referenceFrame.data[${offset + channel}]`);
      const actual = byteValue(candidate.data[offset + channel], `candidateFrame.data[${offset + channel}]`);
      referenceValues[writeIndex] = expected;
      candidateValues[writeIndex] = actual;
      pixelPeak = Math.max(pixelPeak, Math.abs(actual - expected));
      writeIndex += 1;
    }
    if (pixelPeak > changedThreshold) changedPixels += 1;
  }

  const quality = scalarFrameDifference(referenceValues, candidateValues, { ...options, dataRange });
  return {
    width: reference.width,
    height: reference.height,
    pixelCount: reference.pixelCount,
    comparedChannelCount: channels,
    includeAlpha,
    changedThreshold,
    changedPixels,
    changedRatio: reference.pixelCount === 0 ? 0 : changedPixels / reference.pixelCount,
    meanAbsoluteDifference: quality.meanAbsoluteError,
    normalizedMeanAbsoluteDifference: quality.meanAbsoluteError / dataRange,
    meanSquaredError: quality.meanSquaredError,
    rootMeanSquaredError: quality.rootMeanSquaredError,
    peakAbsoluteDifference: quality.peakAbsoluteError,
    normalizedPeakAbsoluteDifference: quality.peakAbsoluteError / dataRange,
    psnr: quality.psnr,
    snr: quality.snr,
    ssimLite: quality.ssimLite,
  };
}

export function frameMotionMagnitudeMap(referenceFrame, candidateFrame, options = {}) {
  const reference = checkedFrame(referenceFrame, 'referenceFrame', options);
  const candidate = checkedFrame(candidateFrame, 'candidateFrame', options);
  assertMatchingFrameShape(reference, candidate);

  const referenceLuma = imageLuminanceMap(reference, { ...options, output: 'float32' });
  const candidateLuma = imageLuminanceMap(candidate, { ...options, output: 'float32' });
  const byteOutput = options.output === 'uint8' || options.byteOutput === true;
  const normalized = options.normalized === true || options.normalizedOutput === true;
  const out = byteOutput ? new Uint8ClampedArray(reference.pixelCount) : new Float32Array(reference.pixelCount);

  for (let i = 0; i < reference.pixelCount; i += 1) {
    const magnitude = Math.abs(candidateLuma[i] - referenceLuma[i]);
    const value = normalized ? magnitude / BYTE_RANGE : magnitude;
    out[i] = byteOutput ? clamp(Math.round(magnitude), 0, BYTE_RANGE) : value;
  }

  return out;
}

export function frameResidualImage(referenceFrame, candidateFrame, options = {}) {
  const reference = checkedFrame(referenceFrame, 'referenceFrame', options);
  const candidate = checkedFrame(candidateFrame, 'candidateFrame', options);
  assertMatchingFrameShape(reference, candidate);

  const centered = options.centered === true || options.encoded === true;
  const zeroPoint = centered ? 128 : 0;
  const out = centered ? new Uint8ClampedArray(reference.expectedByteLength) : new Int16Array(reference.expectedByteLength);

  for (let i = 0; i < reference.expectedByteLength; i += 1) {
    const residual = byteValue(candidate.data[i], `candidateFrame.data[${i}]`) - byteValue(reference.data[i], `referenceFrame.data[${i}]`);
    out[i] = centered ? clamp(Math.round(residual + zeroPoint), 0, BYTE_RANGE) : residual;
  }

  return {
    data: out,
    width: reference.width,
    height: reference.height,
    channelCount: RGBA_CHANNELS,
    centered,
    zeroPoint,
  };
}

export function frameAverageReport(frame, options = {}) {
  const report = checkedFrame(frame, 'frame', options);
  const average = imageAverageColor(report, options);
  const histogram = imageHistogramReport(report, { ...options, includeLuminance: true });
  const luminanceEntropy = histogram.luminance ? shannonEntropyFromHistogram(histogram.luminance) : 0;
  const maxEntropy = histogram.luminance && report.pixelCount > 1 ? Math.log2(Math.min(256, report.pixelCount)) : 0;

  return {
    width: report.width,
    height: report.height,
    pixelCount: report.pixelCount,
    averageRgba: average.rgba,
    r: average.r,
    g: average.g,
    b: average.b,
    a: average.a,
    luminanceEntropy,
    normalizedLuminanceEntropy: maxEntropy === 0 ? 0 : luminanceEntropy / maxEntropy,
  };
}

export function frameSceneChangeReport(referenceFrame, candidateFrame, options = {}) {
  const threshold = saturate(options.threshold ?? 0.25);
  const difference = frameDifferenceReport(referenceFrame, candidateFrame, options);
  const meanWeight = finiteNonnegative(options.meanWeight ?? 0.55, 'meanWeight');
  const changedWeight = finiteNonnegative(options.changedWeight ?? 0.35, 'changedWeight');
  const peakWeight = finiteNonnegative(options.peakWeight ?? 0.10, 'peakWeight');
  const weightTotal = Math.max(1e-9, meanWeight + changedWeight + peakWeight);
  const score = saturate((
    difference.normalizedMeanAbsoluteDifference * meanWeight +
    difference.changedRatio * changedWeight +
    difference.normalizedPeakAbsoluteDifference * peakWeight
  ) / weightTotal);

  return {
    ...difference,
    threshold,
    score,
    sceneChanged: score >= threshold,
  };
}

export function frameKeyframeScoreReport(referenceFrame, candidateFrame, options = {}) {
  const threshold = saturate(options.threshold ?? 0.35);
  const previousScene = frameSceneChangeReport(referenceFrame, candidateFrame, options);
  const nextFrame = options.nextFrame ?? null;
  const nextScene = nextFrame ? frameSceneChangeReport(candidateFrame, nextFrame, options) : null;
  const nextContribution = nextScene ? nextScene.score * finiteNonnegative(options.nextWeight ?? 0.5, 'nextWeight') : 0;
  const score = saturate(Math.max(previousScene.score, nextContribution));

  return {
    width: previousScene.width,
    height: previousScene.height,
    pixelCount: previousScene.pixelCount,
    threshold,
    score,
    keyframeRecommended: score >= threshold,
    previousScene,
    nextScene,
  };
}

export function frameSequenceDifferenceReport(frames, options = {}) {
  const sequence = Array.from(frames ?? []);
  if (sequence.length < 2) {
    return { frameCount: sequence.length, pairCount: 0, averageSceneChangeScore: 0, maxSceneChangeScore: 0, pairs: [] };
  }

  const pairs = [];
  let maxScore = 0;
  for (let i = 1; i < sequence.length; i += 1) {
    const scene = frameSceneChangeReport(sequence[i - 1], sequence[i], options);
    const pair = { index: i - 1, from: i - 1, to: i, ...scene };
    pairs.push(pair);
    maxScore = Math.max(maxScore, scene.score);
  }

  const averageSceneChangeScore = statsMean(pairs.map((pair) => pair.score));

  return {
    frameCount: sequence.length,
    pairCount: pairs.length,
    averageSceneChangeScore,
    maxSceneChangeScore: maxScore,
    pairs,
  };
}

export function runtimeFrameDeltaSeconds(timestampMs, previousTimestampMs, maxDeltaSeconds = 0.1) {
  const timestamp = Number(timestampMs);
  const previous = Number(previousTimestampMs);
  const requestedMax = Number(maxDeltaSeconds);
  const maxDelta = requestedMax === Infinity
    ? Infinity
    : (Number.isFinite(requestedMax) && requestedMax >= 0 ? requestedMax : 0.1);
  if (!Number.isFinite(timestamp) || !Number.isFinite(previous) || previous <= 0) return 0;
  const delta = (timestamp - previous) / 1000;
  return Number.isFinite(delta) ? clamp(delta, 0, maxDelta) : 0;
}

export function runtimeMonotonicClockStep(timestampMs, previousTimestampMs = 0) {
  const timestamp = Number(timestampMs);
  const previous = Number(previousTimestampMs);
  const acceptedPrevious = Number.isFinite(previous) && previous >= 0 ? previous : 0;
  const initialTimestamp = Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : 0;
  const elapsedSeconds = acceptedPrevious > 0
    ? runtimeFrameDeltaSeconds(timestamp, acceptedPrevious, Infinity)
    : initialTimestamp / 1000;
  const elapsedMs = elapsedSeconds * 1000;
  return {
    timestampMs: acceptedPrevious > 0 ? acceptedPrevious + elapsedMs : initialTimestamp,
    elapsedMs,
    elapsedSeconds,
  };
}

export function frameRateFromDurations(durationsSeconds) {
  const durations = Array.from(durationsSeconds ?? [], (value, index) => (
    finiteNonnegative(value, `durationsSeconds[${index}]`)
  ));
  if (durations.length === 0) return 0;
  const averageDuration = statsMean(durations);
  return averageDuration > 0 ? 1 / averageDuration : 0;
}

export function frameTimingReport(frames, options = {}) {
  const sequence = Array.from(frames ?? []);
  const expectedDuration = options.expectedFrameDurationUs === undefined
    ? null
    : positiveFinite(options.expectedFrameDurationUs, 'expectedFrameDurationUs');
  const records = sequence.map((frame, index) => {
    const metadata = frameMetadata(frame, options);
    if (metadata.timestampUs === null) {
      throw new RangeError(`frames[${index}] timestampUs is required`);
    }
    return { index, ...metadata };
  }).sort((a, b) => a.timestampUs - b.timestampUs);

  const deltas = [];
  let minDeltaUs = Infinity;
  let maxDeltaUs = 0;
  let droppedFrameEstimate = 0;
  for (let i = 1; i < records.length; i += 1) {
    const delta = records[i].timestampUs - records[i - 1].timestampUs;
    if (delta < 0) throw new RangeError('frame timestamps must be nondecreasing');
    deltas.push(delta);
    minDeltaUs = Math.min(minDeltaUs, delta);
    maxDeltaUs = Math.max(maxDeltaUs, delta);
    if (expectedDuration !== null && expectedDuration > 0) {
      droppedFrameEstimate += Math.max(0, Math.round(delta / expectedDuration) - 1);
    }
  }

  const averageDeltaUs = statsMean(deltas);
  const durationUs = records.length === 0 ? 0 : records[records.length - 1].timestampUs - records[0].timestampUs;
  return {
    frameCount: records.length,
    firstTimestampUs: records.length === 0 ? null : records[0].timestampUs,
    lastTimestampUs: records.length === 0 ? null : records[records.length - 1].timestampUs,
    durationUs,
    durationSeconds: durationUs / 1_000_000,
    deltaCount: deltas.length,
    averageDeltaUs,
    minDeltaUs: deltas.length === 0 ? 0 : minDeltaUs,
    maxDeltaUs,
    estimatedFps: averageDeltaUs > 0 ? 1_000_000 / averageDeltaUs : 0,
    expectedFrameDurationUs: expectedDuration,
    droppedFrameEstimate,
    records,
    deltas,
  };
}

function frameMetadata(frame, options = {}) {
  const source = frame && typeof frame === 'object' ? frame : options;
  const timestampValue = source?.timestampUs ?? source?.timestamp ?? options.timestampUs ?? options.timestamp ?? null;
  const durationValue = source?.durationUs ?? source?.duration ?? options.durationUs ?? options.duration ?? null;
  const timestampUs = timestampValue === null || timestampValue === undefined ? null : finiteNumber(timestampValue, 'timestampUs');
  const durationUs = durationValue === null || durationValue === undefined ? null : finiteNonnegative(durationValue, 'durationUs');
  return { timestampUs, durationUs };
}

function checkedFrame(frame, name, options = {}) {
  const report = frameDataReport(frame, options);
  if (!report.valid) {
    throw new RangeError(`${name} is not valid ImageData-like frame data: ${report.errors.join(', ')}`);
  }
  return report;
}

function assertMatchingFrameShape(reference, candidate) {
  if (reference.width !== candidate.width || reference.height !== candidate.height || reference.expectedByteLength !== candidate.expectedByteLength) {
    throw new RangeError('frame dimensions and byte lengths must match');
  }
}

function byteValue(value, name) {
  if (!Number.isFinite(Number(value))) throw new RangeError(`${name} must be finite`);
  return clamp(Math.round(Number(value)), 0, BYTE_RANGE);
}

function finiteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new RangeError(`${name} must be finite`);
  return number;
}

function finiteNonnegative(value, name) {
  const number = finiteNumber(value, name);
  if (number < 0) throw new RangeError(`${name} must be nonnegative`);
  return number;
}

function positiveFinite(value, name) {
  const number = finiteNumber(value, name);
  if (number <= 0) throw new RangeError(`${name} must be positive`);
  return number;
}
