// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// VideoMath.js - pure sequence-level video/frame math over ImageData-like frames.

import { clamp, lerp, saturate } from './MathScalar.js';
import { imageEdgeMap } from './ImageMath.js';
import {
  frameAverageReport,
  frameDataReport,
  frameDifferenceReport,
  frameKeyframeScoreReport,
  frameMotionMagnitudeMap,
  frameSceneChangeReport,
  frameSequenceDifferenceReport,
  frameTimingReport,
} from './FrameMath.js';
import { shannonEntropyFromHistogram } from './MathEntropy.js';

const RGBA_CHANNELS = 4;
const BYTE_RANGE = 255;

export function videoSequenceReport(frames, options = {}) {
  const sequence = normalizeFrameSequence(frames);
  if (sequence.length === 0) {
    return {
      frameCount: 0,
      pairCount: 0,
      width: 0,
      height: 0,
      pixelCount: 0,
      durationUs: 0,
      estimatedFps: 0,
      averageSceneChangeScore: 0,
      maxSceneChangeScore: 0,
      sceneCount: 0,
      keyframeCount: 0,
      thumbnailIndex: -1,
    };
  }

  const first = checkedFrame(sequence[0], 'frames[0]', options);
  for (let i = 1; i < sequence.length; i += 1) {
    assertMatchingFrameShape(first, checkedFrame(sequence[i], `frames[${i}]`, options));
  }

  const timing = allFramesHaveTimestamp(sequence) ? frameTimingReport(sequence, options) : null;
  const sequenceDifference = frameSequenceDifferenceReport(sequence, options);
  const scenes = videoSceneListReport(sequence, options);
  const keyframes = videoKeyframePlanReport(sequence, options);
  const motionEntropy = videoMotionEntropyReport(sequence, options);
  const temporalEntropy = videoTemporalEntropyReport(sequence, options);
  const thumbnail = videoThumbnailCandidateReport(sequence, options);

  return {
    frameCount: sequence.length,
    pairCount: Math.max(0, sequence.length - 1),
    width: first.width,
    height: first.height,
    pixelCount: first.pixelCount,
    durationUs: timing ? timing.durationUs : inferredSequenceDurationUs(sequence),
    estimatedFps: timing ? timing.estimatedFps : 0,
    averageSceneChangeScore: sequenceDifference.averageSceneChangeScore ?? 0,
    maxSceneChangeScore: sequenceDifference.maxSceneChangeScore ?? 0,
    sceneCount: scenes.sceneCount,
    keyframeCount: keyframes.keyframeCount,
    thumbnailIndex: thumbnail.index,
    timing,
    sequenceDifference,
    scenes,
    keyframes,
    motionEntropy,
    temporalEntropy,
    thumbnail,
  };
}

export function videoTemporalBlendFrame(referenceFrame, candidateFrame, amount = 0.5, options = {}) {
  const t = saturate(amount);
  const reference = checkedFrame(referenceFrame, 'referenceFrame', options);
  const candidate = checkedFrame(candidateFrame, 'candidateFrame', options);
  assertMatchingFrameShape(reference, candidate);

  const out = new Uint8ClampedArray(reference.expectedByteLength);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = clamp(Math.round(lerp(byteValue(reference.data[i], `referenceFrame.data[${i}]`), byteValue(candidate.data[i], `candidateFrame.data[${i}]`), t)), 0, BYTE_RANGE);
  }

  return {
    data: out,
    width: reference.width,
    height: reference.height,
    amount: t,
    timestampUs: blendNullableNumber(reference.timestampUs, candidate.timestampUs, t),
    durationUs: blendNullableNumber(reference.durationUs, candidate.durationUs, t),
  };
}

export function videoSceneListReport(frames, options = {}) {
  const sequence = normalizeFrameSequence(frames);
  if (sequence.length === 0) return { frameCount: 0, sceneCount: 0, cuts: [], scenes: [] };
  if (sequence.length === 1) return { frameCount: 1, sceneCount: 1, cuts: [], scenes: [{ index: 0, start: 0, end: 0, frameCount: 1, startTimestampUs: timestampOf(sequence[0]), endTimestampUs: timestampOf(sequence[0]) }] };

  const pairReport = frameSequenceDifferenceReport(sequence, options);
  const cuts = [];
  const scenes = [];
  let sceneStart = 0;
  for (const pair of pairReport.pairs) {
    if (pair.sceneChanged) {
      cuts.push({ frameIndex: pair.to, from: pair.from, to: pair.to, score: pair.score });
      scenes.push(sceneSegment(sequence, scenes.length, sceneStart, pair.from));
      sceneStart = pair.to;
    }
  }
  scenes.push(sceneSegment(sequence, scenes.length, sceneStart, sequence.length - 1));

  return {
    frameCount: sequence.length,
    sceneCount: scenes.length,
    cuts,
    scenes,
    averageSceneChangeScore: pairReport.averageSceneChangeScore,
    maxSceneChangeScore: pairReport.maxSceneChangeScore,
  };
}

export function videoKeyframePlanReport(frames, options = {}) {
  const sequence = normalizeFrameSequence(frames);
  const threshold = saturate(options.threshold ?? options.keyframeThreshold ?? 0.35);
  const minIntervalFrames = positiveInteger(options.minIntervalFrames ?? 1, 'minIntervalFrames');
  if (sequence.length === 0) return { frameCount: 0, keyframeCount: 0, threshold, minIntervalFrames, keyframes: [] };

  const keyframes = [{ index: 0, timestampUs: timestampOf(sequence[0]), score: 1, reason: 'first-frame' }];
  let lastKeyframe = 0;
  for (let i = 1; i < sequence.length; i += 1) {
    const score = frameKeyframeScoreReport(sequence[i - 1], sequence[i], {
      ...options,
      threshold,
      nextFrame: sequence[i + 1] ?? null,
    });
    if (score.keyframeRecommended && i - lastKeyframe >= minIntervalFrames) {
      keyframes.push({ index: i, timestampUs: timestampOf(sequence[i]), score: score.score, reason: 'scene-change' });
      lastKeyframe = i;
    }
  }

  return {
    frameCount: sequence.length,
    keyframeCount: keyframes.length,
    threshold,
    minIntervalFrames,
    keyframes,
  };
}

export function videoMotionEntropyReport(frames, options = {}) {
  const sequence = normalizeFrameSequence(frames);
  if (sequence.length < 2) return entropyEmptyReport(sequence.length, 'motion');

  const histogram = new Uint32Array(256);
  let sampleCount = 0;
  let motionSum = 0;
  let peakMotion = 0;
  for (let i = 1; i < sequence.length; i += 1) {
    const motion = frameMotionMagnitudeMap(sequence[i - 1], sequence[i], { ...options, output: 'uint8' });
    for (const value of motion) {
      const byte = byteValue(value, 'motionMagnitude');
      histogram[byte] += 1;
      sampleCount += 1;
      motionSum += byte;
      peakMotion = Math.max(peakMotion, byte);
    }
  }

  const entropy = shannonEntropyFromHistogram(histogram);
  const maxEntropy = sampleCount > 1 ? Math.log2(Math.min(256, sampleCount)) : 0;
  return {
    kind: 'motion',
    frameCount: sequence.length,
    pairCount: sequence.length - 1,
    sampleCount,
    averageMotionMagnitude: sampleCount === 0 ? 0 : motionSum / sampleCount,
    normalizedAverageMotionMagnitude: sampleCount === 0 ? 0 : motionSum / sampleCount / BYTE_RANGE,
    peakMotionMagnitude: peakMotion,
    entropy,
    normalizedEntropy: maxEntropy === 0 ? 0 : entropy / maxEntropy,
    histogram,
  };
}

export function videoTemporalEntropyReport(frames, options = {}) {
  const sequence = normalizeFrameSequence(frames);
  if (sequence.length < 2) return entropyEmptyReport(sequence.length, 'temporal');

  const binCount = positiveInteger(options.binCount ?? 16, 'binCount');
  const histogram = new Uint32Array(binCount);
  const pairReport = frameSequenceDifferenceReport(sequence, options);
  for (const pair of pairReport.pairs) {
    const index = Math.min(binCount - 1, Math.floor(saturate(pair.score) * binCount));
    histogram[index] += 1;
  }

  const entropy = shannonEntropyFromHistogram(histogram);
  const maxEntropy = pairReport.pairCount > 1 ? Math.log2(Math.min(binCount, pairReport.pairCount)) : 0;
  return {
    kind: 'temporal',
    frameCount: sequence.length,
    pairCount: pairReport.pairCount,
    binCount,
    entropy,
    normalizedEntropy: maxEntropy === 0 ? 0 : entropy / maxEntropy,
    averageSceneChangeScore: pairReport.averageSceneChangeScore,
    maxSceneChangeScore: pairReport.maxSceneChangeScore,
    histogram,
  };
}

export function videoThumbnailCandidateReport(frames, options = {}) {
  const sequence = normalizeFrameSequence(frames);
  if (sequence.length === 0) return { frameCount: 0, index: -1, score: 0, candidates: [] };

  const entropyWeight = finiteNonnegative(options.entropyWeight ?? 0.50, 'entropyWeight');
  const edgeWeight = finiteNonnegative(options.edgeWeight ?? 0.30, 'edgeWeight');
  const centerWeight = finiteNonnegative(options.centerWeight ?? 0.20, 'centerWeight');
  const motionPenaltyWeight = finiteNonnegative(options.motionPenaltyWeight ?? 0.15, 'motionPenaltyWeight');
  const sceneScores = adjacentSceneScores(sequence, options);
  const midpoint = (sequence.length - 1) / 2;
  const centerDenominator = Math.max(1, midpoint);
  const candidates = sequence.map((frame, index) => {
    const average = frameAverageReport(frame, options);
    const edges = imageEdgeMap(frame, { ...options, output: 'float32' });
    let edgeSum = 0;
    for (const value of edges) edgeSum += value;
    const normalizedEdge = edges.length === 0 ? 0 : clamp(edgeSum / edges.length / BYTE_RANGE, 0, 1);
    const centerBias = sequence.length === 1 ? 1 : clamp(1 - Math.abs(index - midpoint) / centerDenominator, 0, 1);
    const localMotion = Math.max(sceneScores[index - 1] ?? 0, sceneScores[index] ?? 0);
    const score = saturate(
      average.normalizedLuminanceEntropy * entropyWeight +
      normalizedEdge * edgeWeight +
      centerBias * centerWeight -
      localMotion * motionPenaltyWeight
    );
    return {
      index,
      timestampUs: timestampOf(frame),
      score,
      normalizedLuminanceEntropy: average.normalizedLuminanceEntropy,
      normalizedEdge,
      centerBias,
      localMotion,
    };
  });

  let best = candidates[0];
  for (const candidate of candidates) {
    if (candidate.score > best.score) best = candidate;
  }

  return {
    frameCount: sequence.length,
    index: best.index,
    timestampUs: best.timestampUs,
    score: best.score,
    candidate: best,
    candidates,
  };
}

function normalizeFrameSequence(frames) {
  if (!frames) return [];
  return Array.from(frames);
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
    throw new RangeError('video frame dimensions and byte lengths must match');
  }
}

function sceneSegment(sequence, index, start, end) {
  return {
    index,
    start,
    end,
    frameCount: end >= start ? end - start + 1 : 0,
    startTimestampUs: timestampOf(sequence[start]),
    endTimestampUs: timestampOf(sequence[end]),
  };
}

function adjacentSceneScores(sequence, options) {
  const scores = [];
  for (let i = 1; i < sequence.length; i += 1) {
    scores.push(frameSceneChangeReport(sequence[i - 1], sequence[i], options).score);
  }
  return scores;
}

function allFramesHaveTimestamp(sequence) {
  return sequence.every((frame) => timestampOf(frame) !== null);
}

function inferredSequenceDurationUs(sequence) {
  const first = timestampOf(sequence[0]);
  const last = timestampOf(sequence[sequence.length - 1]);
  if (first !== null && last !== null) return Math.max(0, last - first);
  let duration = 0;
  for (const frame of sequence) {
    const frameDuration = durationOf(frame);
    if (frameDuration !== null) duration += frameDuration;
  }
  return duration;
}

function timestampOf(frame) {
  const value = frame?.timestampUs ?? frame?.timestamp ?? null;
  return value === null || value === undefined ? null : finiteNumber(value, 'timestampUs');
}

function durationOf(frame) {
  const value = frame?.durationUs ?? frame?.duration ?? null;
  return value === null || value === undefined ? null : finiteNonnegative(value, 'durationUs');
}

function blendNullableNumber(a, b, amount) {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return lerp(a, b, amount);
}

function entropyEmptyReport(frameCount, kind) {
  return {
    kind,
    frameCount,
    pairCount: 0,
    sampleCount: 0,
    entropy: 0,
    normalizedEntropy: 0,
    histogram: new Uint32Array(kind === 'temporal' ? 16 : 256),
  };
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

function positiveInteger(value, name) {
  const number = finiteNumber(value, name);
  if (!Number.isInteger(number) || number <= 0) throw new RangeError(`${name} must be a positive integer`);
  return number;
}
