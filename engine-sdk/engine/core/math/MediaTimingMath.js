// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * MediaTimingMath.js - pure WebCodecs-shaped timestamp, cadence, sync, and metadata reports.
 */

import { clamp, finiteNumber, safeDiv, saturate } from './MathScalar.js';
import { statsMean } from './MathStatistics.js';

const MICROSECONDS_PER_SECOND = 1_000_000;
const MICROSECONDS_PER_MILLISECOND = 1_000;
const DEFAULT_SYNC_TOLERANCE_US = 45_000;

function readFinite(value, fallback = 0) {
  return finiteNumber(value, fallback);
}

function readPositive(value, fallback = 1) {
  const number = readFinite(value, fallback);
  return number > 0 ? number : fallback;
}

function readNonNegative(value, fallback = 0) {
  const number = readFinite(value, fallback);
  return number >= 0 ? number : fallback;
}

function readInteger(value, fallback = 0) {
  return Math.trunc(readFinite(value, fallback));
}

function unitScaleToMicroseconds(unit = 'microseconds') {
  const name = String(unit ?? 'microseconds').toLowerCase();
  if (name === 's' || name === 'sec' || name === 'second' || name === 'seconds') return MICROSECONDS_PER_SECOND;
  if (name === 'ms' || name === 'millisecond' || name === 'milliseconds') return MICROSECONDS_PER_MILLISECOND;
  if (name === 'us' || name === 'microsecond' || name === 'microseconds') return 1;
  return 1;
}

function frameDurationUsFromOptions(options = {}) {
  if (Number.isFinite(options.frameDurationUs ?? options.expectedFrameDurationUs)) {
    return readPositive(options.frameDurationUs ?? options.expectedFrameDurationUs, 1);
  }
  const rate = readPositive(options.frameRate ?? options.fps, 0);
  return rate > 0 ? MICROSECONDS_PER_SECOND / rate : 0;
}

function sampleTimestampSource(value, options = {}) {
  if (!value || typeof value !== 'object') {
    return {
      value,
      unit: options.unit ?? options.timestampUnit ?? 'microseconds',
      present: value !== null && value !== undefined,
    };
  }
  if (value.timestampUs !== undefined) return { value: value.timestampUs, unit: 'microseconds', present: true };
  if (value.timestampMs !== undefined) return { value: value.timestampMs, unit: 'milliseconds', present: true };
  if (value.timestampSeconds !== undefined) return { value: value.timestampSeconds, unit: 'seconds', present: true };
  if (value.timestamp !== undefined) return { value: value.timestamp, unit: options.timestampUnit ?? options.unit ?? 'microseconds', present: true };
  if (value.currentTime !== undefined) return { value: value.currentTime, unit: options.timestampUnit ?? options.unit ?? 'seconds', present: true };
  return { value: null, unit: 'microseconds', present: false };
}

function sampleDurationSource(value, options = {}) {
  if (!value || typeof value !== 'object') {
    return {
      value,
      unit: options.unit ?? options.durationUnit ?? 'microseconds',
      present: value !== null && value !== undefined,
    };
  }
  if (value.durationUs !== undefined) return { value: value.durationUs, unit: 'microseconds', present: true };
  if (value.durationMs !== undefined) return { value: value.durationMs, unit: 'milliseconds', present: true };
  if (value.durationSeconds !== undefined) return { value: value.durationSeconds, unit: 'seconds', present: true };
  if (value.duration !== undefined && value.duration !== null) return { value: value.duration, unit: options.durationUnit ?? options.unit ?? 'microseconds', present: true };
  return { value: null, unit: 'microseconds', present: false };
}

function normalizeTimelineSamples(samples, options = {}) {
  return Array.from(samples ?? [], (sample, index) => mediaTimestampReport(sample, { ...options, index }));
}

function sortedValidRecords(records) {
  return records
    .filter((record) => record.valid)
    .slice()
    .sort((a, b) => a.timestampUs - b.timestampUs || a.index - b.index);
}

function nearestRecord(records, timestampUs) {
  let best = null;
  let bestAbs = Infinity;
  for (const record of records) {
    const abs = Math.abs(record.timestampUs - timestampUs);
    if (abs < bestAbs) {
      best = record;
      bestAbs = abs;
    }
  }
  return best;
}

function colorSpaceSource(value = {}) {
  if (value?.colorSpace && typeof value.colorSpace === 'object') return value.colorSpace;
  return value ?? {};
}

export function mediaTimestampUs(value, options = {}) {
  const source = sampleTimestampSource(value, options);
  if (!source.present) return null;
  return readFinite(source.value, 0) * unitScaleToMicroseconds(source.unit);
}

export function mediaDurationUs(value, options = {}) {
  const source = sampleDurationSource(value, options);
  if (!source.present) return null;
  return readNonNegative(source.value, 0) * unitScaleToMicroseconds(source.unit);
}

export function mediaTimestampReport(sample = {}, options = {}) {
  const timestampUs = mediaTimestampUs(sample, options);
  const durationUs = mediaDurationUs(sample, options);
  const type = sample?.type ?? options.type ?? null;
  const byteLength = readNonNegative(sample?.byteLength ?? sample?.data?.byteLength ?? options.byteLength, 0);
  const index = readInteger(options.index ?? sample?.index, 0);
  const valid = Number.isFinite(timestampUs);
  return {
    schema: 'particle-realms.media-timestamp.v1',
    valid,
    index,
    timestampUs,
    timestampSeconds: valid ? timestampUs / MICROSECONDS_PER_SECOND : null,
    durationUs,
    durationSeconds: durationUs === null ? null : durationUs / MICROSECONDS_PER_SECOND,
    endTimestampUs: valid && durationUs !== null ? timestampUs + durationUs : null,
    type,
    keyFrame: type === 'key' || sample?.keyFrame === true,
    byteLength,
    mediaType: sample?.mediaType ?? options.mediaType ?? 'unknown',
  };
}

export function mediaFrameIndexAtTimestamp(timestamp, options = {}) {
  const timestampUs = mediaTimestampUs(timestamp, options) ?? 0;
  const startTimestampUs = readFinite(options.startTimestampUs ?? options.startTimestamp ?? 0, 0);
  const frameDurationUs = frameDurationUsFromOptions(options);
  const fractionalIndex = frameDurationUs > 0 ? (timestampUs - startTimestampUs) / frameDurationUs : 0;
  const rounding = String(options.rounding ?? 'floor');
  const frameIndex = rounding === 'nearest'
    ? Math.round(fractionalIndex)
    : rounding === 'ceil'
      ? Math.ceil(fractionalIndex)
      : Math.floor(fractionalIndex + 1e-9);
  return {
    schema: 'particle-realms.media-frame-index.v1',
    valid: frameDurationUs > 0,
    timestampUs,
    startTimestampUs,
    frameDurationUs,
    fractionalIndex,
    frameIndex,
    presentationTimeSeconds: timestampUs / MICROSECONDS_PER_SECOND,
  };
}

export function mediaTimestampForFrameIndex(frameIndex, options = {}) {
  const index = Math.max(0, readInteger(frameIndex, 0));
  const startTimestampUs = readFinite(options.startTimestampUs ?? options.startTimestamp ?? 0, 0);
  const frameDurationUs = frameDurationUsFromOptions(options);
  const timestampUs = startTimestampUs + index * frameDurationUs;
  return {
    schema: 'particle-realms.media-frame-timestamp.v1',
    valid: frameDurationUs > 0,
    frameIndex: index,
    startTimestampUs,
    frameDurationUs,
    timestampUs,
    timestampSeconds: timestampUs / MICROSECONDS_PER_SECOND,
  };
}

export function mediaTimelineReport(samples = [], options = {}) {
  const records = normalizeTimelineSamples(samples, options);
  const sorted = sortedValidRecords(records);
  const expectedFrameDurationUs = frameDurationUsFromOptions(options) || null;
  const gapThresholdUs = readPositive(options.gapThresholdUs ?? (expectedFrameDurationUs ? expectedFrameDurationUs * 1.5 : 0), 0);
  const outOfOrderCount = records.reduce((count, record, index) => (
    index > 0 && records[index - 1].valid && record.valid && record.timestampUs < records[index - 1].timestampUs ? count + 1 : count
  ), 0);

  const deltas = [];
  let minDeltaUs = Infinity;
  let maxDeltaUs = 0;
  let droppedFrameEstimate = 0;
  let gapCount = 0;
  let overlapCount = 0;
  let jitterSumUs = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    const delta = current.timestampUs - previous.timestampUs;
    deltas.push(delta);
    minDeltaUs = Math.min(minDeltaUs, delta);
    maxDeltaUs = Math.max(maxDeltaUs, delta);
    if (expectedFrameDurationUs) {
      droppedFrameEstimate += Math.max(0, Math.round(delta / expectedFrameDurationUs) - 1);
      jitterSumUs += Math.abs(delta - expectedFrameDurationUs);
    }
    if (gapThresholdUs > 0 && delta > gapThresholdUs) gapCount += 1;
    if (previous.endTimestampUs !== null && current.timestampUs < previous.endTimestampUs) overlapCount += 1;
  }

  const first = sorted[0] ?? null;
  const last = sorted[sorted.length - 1] ?? null;
  const lastEnd = last?.endTimestampUs ?? (last && expectedFrameDurationUs ? last.timestampUs + expectedFrameDurationUs : last?.timestampUs ?? 0);
  const durationUs = first && last ? Math.max(0, lastEnd - first.timestampUs) : 0;
  const averageDeltaUs = statsMean(deltas);
  return {
    schema: 'particle-realms.media-timeline.v1',
    valid: records.every((record) => record.valid),
    sampleCount: records.length,
    validSampleCount: sorted.length,
    firstTimestampUs: first?.timestampUs ?? null,
    lastTimestampUs: last?.timestampUs ?? null,
    durationUs,
    durationSeconds: durationUs / MICROSECONDS_PER_SECOND,
    expectedFrameDurationUs,
    deltaCount: deltas.length,
    averageDeltaUs,
    minDeltaUs: deltas.length === 0 ? 0 : minDeltaUs,
    maxDeltaUs,
    estimatedRate: averageDeltaUs > 0 ? MICROSECONDS_PER_SECOND / averageDeltaUs : 0,
    droppedFrameEstimate,
    gapCount,
    overlapCount,
    outOfOrderCount,
    averageJitterUs: deltas.length === 0 ? 0 : safeDiv(jitterSumUs, deltas.length, 0),
    records,
    sortedRecords: sorted,
    deltas,
  };
}

export function mediaDroppedFrameReport(samples = [], options = {}) {
  const timeline = mediaTimelineReport(samples, options);
  const expectedFrameDurationUs = timeline.expectedFrameDurationUs ?? frameDurationUsFromOptions(options);
  const expectedFrameCount = expectedFrameDurationUs > 0 && timeline.validSampleCount > 0
    ? Math.floor(safeDiv((timeline.lastTimestampUs - timeline.firstTimestampUs), expectedFrameDurationUs, 0) + 1.000001)
    : timeline.validSampleCount;
  const droppedFrameCount = Math.max(0, expectedFrameCount - timeline.validSampleCount, timeline.droppedFrameEstimate);
  return {
    schema: 'particle-realms.media-dropped-frame.v1',
    valid: timeline.valid && expectedFrameDurationUs > 0,
    observedFrameCount: timeline.validSampleCount,
    expectedFrameCount,
    expectedFrameDurationUs,
    droppedFrameCount,
    dropRatio: expectedFrameCount > 0 ? droppedFrameCount / expectedFrameCount : 0,
    score: saturate(1 - (expectedFrameCount > 0 ? droppedFrameCount / expectedFrameCount : 0)),
    timeline,
  };
}

export function mediaDriftReport(reference, candidate, options = {}) {
  const referenceTimestampUs = mediaTimestampUs(reference, options) ?? 0;
  const candidateTimestampUs = mediaTimestampUs(candidate, options) ?? 0;
  const toleranceUs = readNonNegative(options.toleranceUs ?? DEFAULT_SYNC_TOLERANCE_US, DEFAULT_SYNC_TOLERANCE_US);
  const driftUs = candidateTimestampUs - referenceTimestampUs;
  return {
    schema: 'particle-realms.media-drift.v1',
    valid: Number.isFinite(referenceTimestampUs) && Number.isFinite(candidateTimestampUs),
    referenceTimestampUs,
    candidateTimestampUs,
    driftUs,
    absoluteDriftUs: Math.abs(driftUs),
    driftSeconds: driftUs / MICROSECONDS_PER_SECOND,
    toleranceUs,
    withinTolerance: Math.abs(driftUs) <= toleranceUs,
  };
}

export function mediaAvSyncReport(audioSamples = [], videoSamples = [], options = {}) {
  const toleranceUs = readNonNegative(options.toleranceUs ?? DEFAULT_SYNC_TOLERANCE_US, DEFAULT_SYNC_TOLERANCE_US);
  const audioRecords = sortedValidRecords(normalizeTimelineSamples(audioSamples, { ...options, mediaType: 'audio' }));
  const videoRecords = sortedValidRecords(normalizeTimelineSamples(videoSamples, { ...options, mediaType: 'video' }));
  const pairs = videoRecords.map((video) => {
    const audio = nearestRecord(audioRecords, video.timestampUs);
    const driftUs = audio ? video.timestampUs - audio.timestampUs : 0;
    return {
      videoIndex: video.index,
      audioIndex: audio?.index ?? -1,
      videoTimestampUs: video.timestampUs,
      audioTimestampUs: audio?.timestampUs ?? null,
      driftUs,
      absoluteDriftUs: Math.abs(driftUs),
      withinTolerance: audio ? Math.abs(driftUs) <= toleranceUs : false,
    };
  });
  const maxAbsDriftUs = pairs.reduce((max, pair) => Math.max(max, pair.absoluteDriftUs), 0);
  const averageDriftUs = statsMean(pairs.map((pair) => pair.driftUs));
  const averageAbsDriftUs = statsMean(pairs.map((pair) => pair.absoluteDriftUs));
  const outOfSyncCount = pairs.filter((pair) => !pair.withinTolerance).length;
  return {
    schema: 'particle-realms.media-av-sync.v1',
    valid: audioRecords.length > 0 && videoRecords.length > 0,
    audioCount: audioRecords.length,
    videoCount: videoRecords.length,
    pairCount: pairs.length,
    toleranceUs,
    averageDriftUs,
    averageAbsDriftUs,
    maxAbsDriftUs,
    outOfSyncCount,
    inSyncRatio: pairs.length === 0 ? 1 : (pairs.length - outOfSyncCount) / pairs.length,
    state: outOfSyncCount === 0 ? 'in-sync' : maxAbsDriftUs <= toleranceUs * 2 ? 'borderline' : 'out-of-sync',
    pairs,
  };
}

export function mediaAudioDataTimingReport(audioData = {}, options = {}) {
  const sampleRate = readPositive(audioData.sampleRate ?? options.sampleRate, 48_000);
  const numberOfFrames = Math.max(0, readInteger(audioData.numberOfFrames ?? options.numberOfFrames, 0));
  const computedDurationUs = numberOfFrames / sampleRate * MICROSECONDS_PER_SECOND;
  const declaredDurationUs = mediaDurationUs(audioData, options) ?? computedDurationUs;
  const timestampUs = mediaTimestampUs(audioData, options) ?? 0;
  const durationDriftUs = declaredDurationUs - computedDurationUs;
  return {
    schema: 'particle-realms.media-audio-data-timing.v1',
    valid: sampleRate > 0 && numberOfFrames >= 0,
    sampleRate,
    numberOfFrames,
    numberOfChannels: Math.max(0, readInteger(audioData.numberOfChannels ?? options.numberOfChannels, 0)),
    timestampUs,
    computedDurationUs,
    declaredDurationUs,
    durationDriftUs,
    endTimestampUs: timestampUs + declaredDurationUs,
  };
}

export function mediaColorSpaceReport(videoFrameOrColorSpace = {}, options = {}) {
  const source = colorSpaceSource(videoFrameOrColorSpace);
  const primaries = String(source.primaries ?? options.primaries ?? 'unknown').toLowerCase();
  const transfer = String(source.transfer ?? options.transfer ?? 'unknown').toLowerCase();
  const matrix = String(source.matrix ?? options.matrix ?? 'unknown').toLowerCase();
  const fullRangeValue = source.fullRange ?? source.fullRangeVideo ?? options.fullRange ?? null;
  const fullRange = fullRangeValue === null || fullRangeValue === undefined ? null : Boolean(fullRangeValue);
  const preset = primaries === 'bt709' && transfer === 'iec61966-2-1' && matrix === 'rgb' && fullRange === true
    ? 'srgb'
    : primaries === 'smpte432' && transfer === 'iec61966-2-1' && matrix === 'rgb' && fullRange === true
      ? 'display-p3'
      : primaries === 'bt709' && transfer === 'bt709' && matrix === 'bt709' && fullRange === false
        ? 'rec709'
        : 'custom';
  return {
    schema: 'particle-realms.media-color-space.v1',
    valid: primaries !== 'unknown' || transfer !== 'unknown' || matrix !== 'unknown' || fullRange !== null,
    primaries,
    transfer,
    matrix,
    fullRange,
    preset,
    limitedRange: fullRange === null ? null : !fullRange,
  };
}

export function mediaQueuePressureReport(queue = {}, options = {}) {
  const decodeQueueSize = readNonNegative(queue.decodeQueueSize ?? queue.decode ?? 0, 0);
  const encodeQueueSize = readNonNegative(queue.encodeQueueSize ?? queue.encode ?? 0, 0);
  const queueSize = readNonNegative(queue.queueSize ?? decodeQueueSize + encodeQueueSize, decodeQueueSize + encodeQueueSize);
  const targetQueueSize = readNonNegative(options.targetQueueSize ?? queue.targetQueueSize ?? 2, 2);
  const maxQueueSize = readPositive(options.maxQueueSize ?? queue.maxQueueSize ?? Math.max(1, targetQueueSize * 4), Math.max(1, targetQueueSize * 4));
  const loadRatio = clamp(safeDiv(queueSize, maxQueueSize, 0), 0, 1);
  const pressureRatio = clamp(safeDiv(queueSize - targetQueueSize, Math.max(1, maxQueueSize - targetQueueSize), 0), 0, 1);
  return {
    schema: 'particle-realms.media-queue-pressure.v1',
    valid: maxQueueSize > 0,
    decodeQueueSize,
    encodeQueueSize,
    queueSize,
    targetQueueSize,
    maxQueueSize,
    loadRatio,
    pressureRatio,
    state: pressureRatio === 0 ? 'clear' : pressureRatio < 0.5 ? 'building' : pressureRatio < 0.9 ? 'pressured' : 'saturated',
  };
}
