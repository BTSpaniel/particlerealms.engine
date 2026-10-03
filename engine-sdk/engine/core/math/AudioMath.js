// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// AudioMath.js - pure PCM/audio-domain math helpers.

import { clamp } from './MathScalar.js';
import { dbToGain, gainToDb } from './UnitMath.js';
import { signalPeakReport, signalRms } from './MathSignal.js';
import { shannonEntropyFromHistogram } from './MathEntropy.js';

export const DEFAULT_AUDIO_MIN_DB = -100;
export const DEFAULT_AUDIO_MAX_DB = -30;

export const audioDbToGain = dbToGain;
export const audioGainToDb = gainToDb;

export function audioClipSample(sample, limit = 1) {
  const bound = _positiveFinite(limit, 'limit');
  return clamp(_finiteNumber(sample, 'sample'), -bound, bound);
}

export function audioSoftClipSample(sample, drive = 1) {
  const amount = _positiveFinite(drive, 'drive');
  return Math.tanh(_finiteNumber(sample, 'sample') * amount);
}

export function audioClipSignal(signal, limit = 1) {
  const samples = _audioSamples(signal);
  return Array.from(samples, (sample, index) => audioClipSample(_finiteSample(sample, index), limit));
}

export function audioSoftClipSignal(signal, drive = 1) {
  const samples = _audioSamples(signal);
  return Array.from(samples, (sample, index) => audioSoftClipSample(_finiteSample(sample, index), drive));
}

export function audioApplyGain(signal, gain = 1, options = {}) {
  const samples = _audioSamples(signal);
  const scalar = _finiteNumber(gain, 'gain');
  const clip = options.clip === true;
  const limit = options.limit === undefined ? 1 : _positiveFinite(options.limit, 'limit');
  return Array.from(samples, (sample, index) => {
    const value = _finiteSample(sample, index) * scalar;
    return clip ? audioClipSample(value, limit) : value;
  });
}

export function audioMix(signals, options = {}) {
  if (!signals || typeof signals[Symbol.iterator] !== 'function') {
    throw new TypeError('signals must be iterable');
  }

  const lanes = Array.from(signals, (signal, index) => _audioSamples(signal, `signals[${index}]`));
  if (lanes.length === 0) return [];

  const gains = options.gains === undefined
    ? lanes.map(() => 1)
    : _audioGains(options.gains, lanes.length);
  const targetLength = options.length === undefined
    ? lanes.reduce((maxLength, lane) => Math.max(maxLength, lane.length), 0)
    : _nonnegativeInteger(options.length, 'length');
  const normalize = options.normalize === true;
  const clip = options.clip === true;
  const limit = options.limit === undefined ? 1 : _positiveFinite(options.limit, 'limit');
  const gainWeight = gains.reduce((sum, gain) => sum + Math.abs(gain), 0);
  const divisor = normalize && gainWeight > 0 ? gainWeight : 1;
  const mixed = new Array(targetLength);

  for (let i = 0; i < targetLength; i++) {
    let value = 0;
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex++) {
      const lane = lanes[laneIndex];
      if (i >= lane.length) continue;
      value += _finiteSample(lane[i], i, `signals[${laneIndex}]`) * gains[laneIndex];
    }
    value /= divisor;
    mixed[i] = clip ? audioClipSample(value, limit) : value;
  }

  return mixed;
}

export function audioNormalize(signal, targetPeak = 1) {
  const samples = _audioSamples(signal);
  const target = _positiveFinite(targetPeak, 'targetPeak');
  const peak = signalPeakReport(samples).peakAbs;
  if (samples.length === 0 || peak === 0) return new Array(samples.length).fill(0);
  const gain = target / peak;
  return Array.from(samples, (sample, index) => _finiteSample(sample, index) * gain);
}

export function audioStereoToMono(left, right) {
  const leftSamples = _audioSamples(left, 'left');
  const rightSamples = _audioSamples(right, 'right');
  const length = Math.max(leftSamples.length, rightSamples.length);
  const mono = new Array(length);

  for (let i = 0; i < length; i++) {
    const l = i < leftSamples.length ? _finiteSample(leftSamples[i], i, 'left') : 0;
    const r = i < rightSamples.length ? _finiteSample(rightSamples[i], i, 'right') : 0;
    mono[i] = (l + r) * 0.5;
  }

  return mono;
}

export function audioMonoToStereo(mono) {
  const samples = _audioSamples(mono, 'mono');
  return {
    left: Array.from(samples, (sample, index) => _finiteSample(sample, index, 'mono')),
    right: Array.from(samples, (sample, index) => _finiteSample(sample, index, 'mono'))
  };
}

export function audioEqualPowerPanGains(pan) {
  const normalizedPan = clamp(_finiteNumber(pan, 'pan'), -1, 1);
  const x = (normalizedPan + 1) * 0.5;
  return {
    pan: normalizedPan,
    leftGain: Math.cos(x * Math.PI * 0.5),
    rightGain: Math.sin(x * Math.PI * 0.5)
  };
}

export function audioEqualPowerPanMono(mono, pan) {
  const samples = _audioSamples(mono, 'mono');
  const gains = audioEqualPowerPanGains(pan);
  return {
    ...gains,
    left: Array.from(samples, (sample, index) => _finiteSample(sample, index, 'mono') * gains.leftGain),
    right: Array.from(samples, (sample, index) => _finiteSample(sample, index, 'mono') * gains.rightGain)
  };
}

export function audioWaveformPeaks(signal, bucketCount) {
  const samples = _audioSamples(signal);
  const buckets = _positiveInteger(bucketCount, 'bucketCount');
  const result = [];
  if (samples.length === 0) {
    for (let i = 0; i < buckets; i++) {
      result.push({ index: i, start: 0, end: 0, min: 0, max: 0, peakAbs: 0 });
    }
    return { sampleCount: 0, bucketCount: buckets, buckets: result };
  }

  for (let i = 0; i < buckets; i++) {
    const start = Math.floor(i * samples.length / buckets);
    const end = Math.max(start + 1, Math.floor((i + 1) * samples.length / buckets));
    let min = Infinity;
    let max = -Infinity;
    let peakAbs = 0;
    for (let j = start; j < Math.min(end, samples.length); j++) {
      const sample = _finiteSample(samples[j], j);
      min = Math.min(min, sample);
      max = Math.max(max, sample);
      peakAbs = Math.max(peakAbs, Math.abs(sample));
    }
    result.push({ index: i, start, end: Math.min(end, samples.length), min, max, peakAbs });
  }

  return { sampleCount: samples.length, bucketCount: buckets, buckets: result };
}

export function audioWindowedRmsReport(signal, windowSize, hopSize = windowSize) {
  const samples = _audioSamples(signal);
  const window = _positiveInteger(windowSize, 'windowSize');
  const hop = _positiveInteger(hopSize, 'hopSize');
  const frames = [];
  let maxRms = 0;
  let sumRms = 0;
  let peakAbs = 0;

  for (let start = 0; start < samples.length; start += hop) {
    const end = Math.min(samples.length, start + window);
    const frame = Array.from({ length: end - start }, (_, index) => {
      const sampleIndex = start + index;
      return _finiteSample(samples[sampleIndex], sampleIndex);
    });
    const rms = frame.length === 0 ? 0 : signalRms(frame);
    const peak = frame.length === 0 ? 0 : signalPeakReport(frame).peakAbs;
    maxRms = Math.max(maxRms, rms);
    peakAbs = Math.max(peakAbs, peak);
    sumRms += rms;
    frames.push({ index: frames.length, start, end, sampleCount: frame.length, rms, peakAbs: peak });
  }

  return {
    sampleCount: samples.length,
    windowSize: window,
    hopSize: hop,
    frameCount: frames.length,
    averageRms: frames.length === 0 ? 0 : sumRms / frames.length,
    maxRms,
    peakAbs,
    frames
  };
}

export function audioSilenceReport(signal, options = {}) {
  const samples = _audioSamples(signal);
  const thresholdDb = options.thresholdDb ?? -60;
  const threshold = options.thresholdGain ?? audioDbToGain(thresholdDb);
  const minQuietRatio = options.minQuietRatio ?? 1;
  _nonnegativeFinite(threshold, 'thresholdGain');
  const requiredRatio = clamp(_finiteNumber(minQuietRatio, 'minQuietRatio'), 0, 1);
  let quietSamples = 0;
  let peakAbs = 0;

  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(_finiteSample(samples[i], i));
    if (abs <= threshold) quietSamples++;
    peakAbs = Math.max(peakAbs, abs);
  }

  const quietRatio = samples.length === 0 ? 1 : quietSamples / samples.length;
  return {
    sampleCount: samples.length,
    thresholdDb,
    thresholdGain: threshold,
    quietSamples,
    quietRatio,
    peakAbs,
    rms: samples.length === 0 ? 0 : signalRms(samples),
    silent: quietRatio >= requiredRatio
  };
}

export function audioNoiseFloorReport(signal, options = {}) {
  const windowSize = options.windowSize ?? 1024;
  const hopSize = options.hopSize ?? windowSize;
  const percentile = clamp(_finiteNumber(options.percentile ?? 0.1, 'percentile'), 0, 1);
  const windows = audioWindowedRmsReport(signal, windowSize, hopSize);
  const sorted = windows.frames.map((frame) => frame.rms).sort((a, b) => a - b);
  const index = sorted.length === 0 ? -1 : Math.min(sorted.length - 1, Math.floor(percentile * (sorted.length - 1)));
  const floorRms = index < 0 ? 0 : sorted[index];

  return {
    sampleCount: windows.sampleCount,
    windowSize: windows.windowSize,
    hopSize: windows.hopSize,
    percentile,
    floorRms,
    floorDb: audioGainToDb(floorRms, -Infinity),
    frameCount: windows.frameCount,
    maxRms: windows.maxRms
  };
}

export function audioTransientReport(signal, options = {}) {
  const windowSize = options.windowSize ?? 128;
  const hopSize = options.hopSize ?? windowSize;
  const attackDb = options.attackDb ?? 6;
  const minRms = options.minRms ?? 1e-6;
  const attackRatio = audioDbToGain(attackDb);
  const windows = audioWindowedRmsReport(signal, windowSize, hopSize);
  const transients = [];

  for (let i = 1; i < windows.frames.length; i++) {
    const previous = Math.max(windows.frames[i - 1].rms, minRms);
    const current = windows.frames[i].rms;
    const ratio = current / previous;
    if (current >= minRms && ratio >= attackRatio) {
      transients.push({
        frameIndex: i,
        start: windows.frames[i].start,
        rms: current,
        previousRms: windows.frames[i - 1].rms,
        ratio,
        attackDb: audioGainToDb(ratio, 0)
      });
    }
  }

  return {
    sampleCount: windows.sampleCount,
    windowSize: windows.windowSize,
    hopSize: windows.hopSize,
    attackDb,
    attackRatio,
    transientCount: transients.length,
    transients
  };
}

export function audioSpectralEntropyReport(spectrum, options = {}) {
  const values = _audioSamples(spectrum, 'spectrum');
  const usePower = options.power !== false;
  const weights = new Array(values.length);
  let total = 0;
  let activeBins = 0;

  for (let i = 0; i < values.length; i++) {
    const magnitude = Math.max(0, _finiteSample(values[i], i, 'spectrum'));
    const weight = usePower ? magnitude * magnitude : magnitude;
    weights[i] = weight;
    total += weight;
    if (weight > 0) activeBins++;
  }

  const probabilities = total === 0 ? weights : weights.map((value) => value / total);
  const entropy = total === 0 ? 0 : shannonEntropyFromHistogram(weights);
  const maxEntropy = values.length > 1 ? Math.log2(values.length) : 0;
  const normalizedEntropy = maxEntropy === 0 ? 0 : entropy / maxEntropy;

  return {
    binCount: values.length,
    activeBins,
    totalWeight: total,
    power: usePower,
    entropy,
    maxEntropy,
    normalizedEntropy,
    probabilities
  };
}

export function audioAnalyserByteToDb(byteValue, minDb = DEFAULT_AUDIO_MIN_DB, maxDb = DEFAULT_AUDIO_MAX_DB) {
  const value = _byteValue(byteValue, 'byteValue');
  const range = _dbRange(minDb, maxDb);
  return range.minDb + (value / 255) * (range.maxDb - range.minDb);
}

export function audioDecibelsToAnalyserByte(db, minDb = DEFAULT_AUDIO_MIN_DB, maxDb = DEFAULT_AUDIO_MAX_DB) {
  const value = _finiteNumber(db, 'db');
  const range = _dbRange(minDb, maxDb);
  const scaled = 255 * (value - range.minDb) / (range.maxDb - range.minDb);
  return clamp(Math.floor(scaled), 0, 255);
}

function _audioSamples(signal, name = 'signal') {
  if (!signal || typeof signal.length !== 'number') {
    throw new TypeError(`${name} must be array-like`);
  }
  if (!Number.isInteger(signal.length) || signal.length < 0) {
    throw new RangeError(`${name}.length must be a nonnegative integer`);
  }
  return signal;
}

function _audioGains(gains, expectedLength) {
  if (!gains || typeof gains.length !== 'number') {
    throw new TypeError('gains must be array-like');
  }
  if (gains.length !== expectedLength) {
    throw new RangeError('gains length must match signal count');
  }
  return Array.from(gains, (gain, index) => _finiteNumber(gain, `gains[${index}]`));
}

function _finiteSample(value, index, name = 'signal') {
  const sample = Number(value);
  if (!Number.isFinite(sample)) {
    throw new RangeError(`${name}[${index}] must be a finite number`);
  }
  return sample;
}

function _finiteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new RangeError(`${name} must be a finite number`);
  }
  return number;
}

function _nonnegativeFinite(value, name) {
  const number = _finiteNumber(value, name);
  if (number < 0) throw new RangeError(`${name} must be nonnegative`);
  return number;
}

function _positiveFinite(value, name) {
  const number = _finiteNumber(value, name);
  if (number <= 0) throw new RangeError(`${name} must be positive`);
  return number;
}

function _positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

function _nonnegativeInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative integer`);
  }
  return value;
}

function _byteValue(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new RangeError(`${name} must be an integer in [0, 255]`);
  }
  return value;
}

function _dbRange(minDb, maxDb) {
  const min = _finiteNumber(minDb, 'minDb');
  const max = _finiteNumber(maxDb, 'maxDb');
  if (max <= min) throw new RangeError('maxDb must be greater than minDb');
  return { minDb: min, maxDb: max };
}
