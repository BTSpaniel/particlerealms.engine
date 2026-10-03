// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// SamplingMath.js - pure sample-grid, time-window, and sample-rate report helpers.

import { clamp } from './MathScalar.js';
import { DEFAULT_SAMPLE_RATE, sampleIndexAtTime, samplesToSeconds, secondsToSamples } from './UnitMath.js';
import { resampleLengthForRate } from './MathSignal.js';
import { bilinearSample, trilinearSample } from './MathGrid.js';

export function sampleRateReport(sampleRate = DEFAULT_SAMPLE_RATE) {
  const rate = positiveFinite(sampleRate, 'sampleRate');
  return {
    sampleRate: rate,
    nyquistHz: rate / 2,
    sampleDurationSeconds: 1 / rate,
    sampleDurationMilliseconds: 1000 / rate,
    webAudioNominalSupport: rate >= 8000 && rate <= 96000,
  };
}

export function sampleIndexForTime(seconds, sampleRate = DEFAULT_SAMPLE_RATE, options = {}) {
  const raw = secondsToSamples(finiteNumber(seconds, 'seconds'), positiveFinite(sampleRate, 'sampleRate'));
  const rounding = String(options.rounding ?? 'floor').toLowerCase();
  let index;
  if (rounding === 'round' || rounding === 'nearest') index = Math.round(raw);
  else if (rounding === 'ceil') index = Math.ceil(raw);
  else index = sampleIndexAtTime(seconds, sampleRate);

  if (options.clampToLength !== undefined) {
    const length = nonnegativeInteger(options.clampToLength, 'clampToLength');
    return clamp(index, 0, Math.max(0, length - 1));
  }
  return index;
}

export function sampleTimeForIndex(index, sampleRate = DEFAULT_SAMPLE_RATE, options = {}) {
  const sampleIndex = integer(index, 'index');
  const offset = options.center === true || options.centered === true ? 0.5 : 0;
  return samplesToSeconds(sampleIndex + offset, positiveFinite(sampleRate, 'sampleRate'));
}

export function sampleWindowReport(options = {}) {
  const sampleRate = positiveFinite(options.sampleRate ?? DEFAULT_SAMPLE_RATE, 'sampleRate');
  const totalSampleCount = options.totalSampleCount === undefined ? null : nonnegativeInteger(options.totalSampleCount, 'totalSampleCount');
  const startIndex = options.startSample !== undefined
    ? integer(options.startSample, 'startSample')
    : sampleIndexForTime(options.startSeconds ?? 0, sampleRate, { rounding: options.rounding ?? 'floor' });
  const requestedSampleCount = options.sampleCount !== undefined
    ? nonnegativeInteger(options.sampleCount, 'sampleCount')
    : Math.max(0, sampleIndexForTime(options.durationSeconds ?? 0, sampleRate, { rounding: options.durationRounding ?? 'ceil' }));
  const rawEndExclusive = startIndex + requestedSampleCount;
  const clampToTotal = totalSampleCount !== null && options.clamp !== false;
  const clampedStart = clampToTotal ? clamp(startIndex, 0, totalSampleCount) : startIndex;
  const clampedEndExclusive = clampToTotal ? clamp(rawEndExclusive, clampedStart, totalSampleCount) : rawEndExclusive;
  const sampleCount = Math.max(0, clampedEndExclusive - clampedStart);

  return {
    sampleRate,
    totalSampleCount,
    rawStartIndex: startIndex,
    rawEndExclusive,
    startIndex: clampedStart,
    endExclusive: clampedEndExclusive,
    sampleCount,
    clamped: clampedStart !== startIndex || clampedEndExclusive !== rawEndExclusive,
    startSeconds: samplesToSeconds(clampedStart, sampleRate),
    endSeconds: samplesToSeconds(clampedEndExclusive, sampleRate),
    durationSeconds: samplesToSeconds(sampleCount, sampleRate),
  };
}

export function sampleFrameWindowReport(sampleCount, windowSize, hopSize, options = {}) {
  const total = nonnegativeInteger(sampleCount, 'sampleCount');
  const size = positiveInteger(windowSize, 'windowSize');
  const hop = positiveInteger(hopSize, 'hopSize');
  const sampleRate = options.sampleRate === undefined ? null : positiveFinite(options.sampleRate, 'sampleRate');
  const includePartial = options.includePartial === true;
  const includeWindows = options.includeWindows === true;
  const windows = [];
  let count = 0;
  let lastStart = -1;

  if (total > 0) {
    for (let start = 0; start + size <= total; start += hop) {
      count += 1;
      lastStart = start;
      if (includeWindows) windows.push(sampleFrameWindow(start, size, total, sampleRate));
    }
    if (includePartial && (lastStart < 0 || lastStart + size < total)) {
      const start = lastStart < 0 ? 0 : lastStart + hop;
      if (start < total) {
        count += 1;
        lastStart = start;
        if (includeWindows) windows.push(sampleFrameWindow(start, size, total, sampleRate));
      }
    }
  }

  const lastEndExclusive = lastStart < 0 ? 0 : Math.min(total, lastStart + size);
  return {
    sampleCount: total,
    windowSize: size,
    hopSize: hop,
    sampleRate,
    includePartial,
    windowCount: count,
    firstStartIndex: count === 0 ? -1 : 0,
    lastStartIndex: lastStart,
    lastEndExclusive,
    coveredSampleCount: lastEndExclusive,
    uncoveredSampleCount: Math.max(0, total - lastEndExclusive),
    windows: includeWindows ? windows : null,
  };
}

export function sampleRateConversionReport(sampleCount, sourceSampleRate, targetSampleRate) {
  const count = nonnegativeInteger(sampleCount, 'sampleCount');
  const sourceRate = positiveFinite(sourceSampleRate, 'sourceSampleRate');
  const targetRate = positiveFinite(targetSampleRate, 'targetSampleRate');
  const targetSampleCount = count === 0 ? 0 : resampleLengthForRate(count, sourceRate, targetRate);
  const sourceDurationSeconds = samplesToSeconds(count, sourceRate);
  const targetDurationSeconds = samplesToSeconds(targetSampleCount, targetRate);

  return {
    sourceSampleCount: count,
    targetSampleCount,
    sourceSampleRate: sourceRate,
    targetSampleRate: targetRate,
    rateRatio: targetRate / sourceRate,
    sourceDurationSeconds,
    targetDurationSeconds,
    durationErrorSeconds: targetDurationSeconds - sourceDurationSeconds,
  };
}

export function samplePlaybackRateReport(bufferSampleRate, contextSampleRate, playbackRate = 1, options = {}) {
  const bufferRate = positiveFinite(bufferSampleRate, 'bufferSampleRate');
  const contextRate = positiveFinite(contextSampleRate, 'contextSampleRate');
  const rate = positiveFinite(playbackRate, 'playbackRate');
  const bufferSampleCount = options.bufferSampleCount === undefined ? null : nonnegativeInteger(options.bufferSampleCount, 'bufferSampleCount');
  const sourceDurationSeconds = bufferSampleCount === null ? null : samplesToSeconds(bufferSampleCount, bufferRate);
  const outputDurationSeconds = sourceDurationSeconds === null ? null : sourceDurationSeconds / rate;

  return {
    bufferSampleRate: bufferRate,
    contextSampleRate: contextRate,
    playbackRate: rate,
    sampleRateRatio: bufferRate / contextRate,
    effectiveSourceStepPerOutputSample: rate * bufferRate / contextRate,
    bufferSampleCount,
    sourceDurationSeconds,
    outputDurationSeconds,
    outputSampleCount: outputDurationSeconds === null ? null : Math.round(outputDurationSeconds * contextRate),
  };
}

export function spatialBilinearSampleReport(grid, width, height, x, y, options = {}) {
  const w = positiveInteger(width, 'width');
  const h = positiveInteger(height, 'height');
  if (w < 2 || h < 2) throw new RangeError('bilinear sampling requires width and height >= 2');
  const data = optionalArrayLike(grid, w * h, 'grid');
  const normalizedCoordinates = Boolean(options.normalizedCoordinates ?? options.normalizedCoords);
  const sx = spatialCoordinate(x, w, normalizedCoordinates, 'x');
  const sy = spatialCoordinate(y, h, normalizedCoordinates, 'y');
  const x0 = clamp(Math.floor(sx), 0, w - 2);
  const y0 = clamp(Math.floor(sy), 0, h - 2);
  const fx = sx - x0;
  const fy = sy - y0;
  const corners = [
    footprint2D(x0, y0, w, (1 - fx) * (1 - fy), data),
    footprint2D(x0 + 1, y0, w, fx * (1 - fy), data),
    footprint2D(x0, y0 + 1, w, (1 - fx) * fy, data),
    footprint2D(x0 + 1, y0 + 1, w, fx * fy, data),
  ];

  return {
    method: 'bilinear',
    dimensions: Object.freeze([w, h]),
    normalizedCoordinates,
    coordinate: Object.freeze([sx, sy]),
    base: Object.freeze([x0, y0]),
    fraction: Object.freeze([fx, fy]),
    outsideGrid: sx < 0 || sy < 0 || sx > w - 1 || sy > h - 1,
    weightSum: corners.reduce((sum, entry) => sum + entry.weight, 0),
    footprint: Object.freeze(corners),
    value: data ? bilinearSample(data, w, h, sx, sy) : null,
  };
}

export function spatialTrilinearSampleReport(grid, width, height, depth, x, y, z, options = {}) {
  const w = positiveInteger(width, 'width');
  const h = positiveInteger(height, 'height');
  const d = positiveInteger(depth, 'depth');
  if (w < 2 || h < 2 || d < 2) throw new RangeError('trilinear sampling requires width, height, and depth >= 2');
  const data = optionalArrayLike(grid, w * h * d, 'grid');
  const normalizedCoordinates = Boolean(options.normalizedCoordinates ?? options.normalizedCoords);
  const sx = spatialCoordinate(x, w, normalizedCoordinates, 'x');
  const sy = spatialCoordinate(y, h, normalizedCoordinates, 'y');
  const sz = spatialCoordinate(z, d, normalizedCoordinates, 'z');
  const x0 = clamp(Math.floor(sx), 0, w - 2);
  const y0 = clamp(Math.floor(sy), 0, h - 2);
  const z0 = clamp(Math.floor(sz), 0, d - 2);
  const fx = sx - x0;
  const fy = sy - y0;
  const fz = sz - z0;
  const footprint = [];
  for (let dz = 0; dz <= 1; dz++) {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const wx = dx === 0 ? 1 - fx : fx;
        const wy = dy === 0 ? 1 - fy : fy;
        const wz = dz === 0 ? 1 - fz : fz;
        footprint.push(footprint3D(x0 + dx, y0 + dy, z0 + dz, w, h, wx * wy * wz, data));
      }
    }
  }

  return {
    method: 'trilinear',
    dimensions: Object.freeze([w, h, d]),
    normalizedCoordinates,
    coordinate: Object.freeze([sx, sy, sz]),
    base: Object.freeze([x0, y0, z0]),
    fraction: Object.freeze([fx, fy, fz]),
    outsideGrid: sx < 0 || sy < 0 || sz < 0 || sx > w - 1 || sy > h - 1 || sz > d - 1,
    weightSum: footprint.reduce((sum, entry) => sum + entry.weight, 0),
    footprint: Object.freeze(footprint),
    value: data ? trilinearSample(data, w, h, d, sx, sy, sz) : null,
  };
}

export function catmullRomSample(p0, p1, p2, p3, t) {
  const a = finiteNumber(p0, 'p0');
  const b = finiteNumber(p1, 'p1');
  const c = finiteNumber(p2, 'p2');
  const d = finiteNumber(p3, 'p3');
  const u = finiteNumber(t, 't');
  const weights = catmullRomWeights(u);
  return a * weights[0] + b * weights[1] + c * weights[2] + d * weights[3];
}

export function catmullRomSampleReport(samples, x, options = {}) {
  const data = requiredArrayLike(samples, 1, 'samples');
  const coordinate = finiteNumber(x, 'x');
  const base = Math.floor(coordinate);
  const t = coordinate - base;
  const edgeMode = normalizedEdgeMode(options.edgeMode ?? 'clamp');
  const sourceIndices = [base - 1, base, base + 1, base + 2].map((index) => spatialIndex(index, data.length, edgeMode));
  const values = sourceIndices.map((index) => finiteNumber(data[index], `samples[${index}]`));
  const weights = catmullRomWeights(t);
  const contributions = values.map((value, i) => Object.freeze({
    sourceIndex: sourceIndices[i],
    value,
    weight: weights[i],
    contribution: value * weights[i],
  }));

  return {
    method: 'catmull-rom',
    coordinate,
    baseIndex: base,
    fraction: t,
    edgeMode,
    sourceIndices: Object.freeze(sourceIndices),
    weights: Object.freeze(weights),
    weightSum: weights.reduce((sum, weight) => sum + weight, 0),
    contributions: Object.freeze(contributions),
    value: contributions.reduce((sum, entry) => sum + entry.contribution, 0),
  };
}

export function spatialBicubicSampleReport(grid, width, height, x, y, options = {}) {
  const w = positiveInteger(width, 'width');
  const h = positiveInteger(height, 'height');
  const data = requiredArrayLike(grid, w * h, 'grid');
  const normalizedCoordinates = Boolean(options.normalizedCoordinates ?? options.normalizedCoords);
  const edgeMode = normalizedEdgeMode(options.edgeMode ?? 'clamp');
  const sx = spatialCoordinate(x, w, normalizedCoordinates, 'x');
  const sy = spatialCoordinate(y, h, normalizedCoordinates, 'y');
  const baseX = Math.floor(sx);
  const baseY = Math.floor(sy);
  const fx = sx - baseX;
  const fy = sy - baseY;
  const xWeights = catmullRomWeights(fx);
  const yWeights = catmullRomWeights(fy);
  const xIndices = [baseX - 1, baseX, baseX + 1, baseX + 2].map((index) => spatialIndex(index, w, edgeMode));
  const yIndices = [baseY - 1, baseY, baseY + 1, baseY + 2].map((index) => spatialIndex(index, h, edgeMode));
  const footprint = [];
  let value = 0;

  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const sourceIndex = yIndices[j] * w + xIndices[i];
      const sample = finiteNumber(data[sourceIndex], `grid[${sourceIndex}]`);
      const weight = xWeights[i] * yWeights[j];
      value += sample * weight;
      footprint.push(Object.freeze({
        x: xIndices[i],
        y: yIndices[j],
        index: sourceIndex,
        value: sample,
        weight,
        contribution: sample * weight,
      }));
    }
  }

  return {
    method: 'bicubic-catmull-rom',
    dimensions: Object.freeze([w, h]),
    normalizedCoordinates,
    coordinate: Object.freeze([sx, sy]),
    base: Object.freeze([baseX, baseY]),
    fraction: Object.freeze([fx, fy]),
    edgeMode,
    xIndices: Object.freeze(xIndices),
    yIndices: Object.freeze(yIndices),
    xWeights: Object.freeze(xWeights),
    yWeights: Object.freeze(yWeights),
    weightSum: footprint.reduce((sum, entry) => sum + entry.weight, 0),
    footprint: Object.freeze(footprint),
    value,
  };
}

export function spatialAreaSampleReport(grid, width, height, area = {}, options = {}) {
  const w = positiveInteger(width, 'width');
  const h = positiveInteger(height, 'height');
  const data = requiredArrayLike(grid, w * h, 'grid');
  const x0 = finiteNumber(area.x ?? area.left ?? 0, 'area.x');
  const y0 = finiteNumber(area.y ?? area.top ?? 0, 'area.y');
  const areaWidth = positiveFinite(area.width ?? area.w ?? 1, 'area.width');
  const areaHeight = positiveFinite(area.height ?? area.h ?? 1, 'area.height');
  const x1 = x0 + areaWidth;
  const y1 = y0 + areaHeight;
  const clip = options.clip !== false;
  const left = clip ? clamp(Math.min(x0, x1), 0, w) : Math.min(x0, x1);
  const top = clip ? clamp(Math.min(y0, y1), 0, h) : Math.min(y0, y1);
  const right = clip ? clamp(Math.max(x0, x1), 0, w) : Math.max(x0, x1);
  const bottom = clip ? clamp(Math.max(y0, y1), 0, h) : Math.max(y0, y1);
  const samples = [];
  let weightedSum = 0;
  let totalWeight = 0;

  for (let py = Math.floor(top); py < Math.ceil(bottom); py++) {
    if (py < 0 || py >= h) continue;
    const overlapY = Math.max(0, Math.min(bottom, py + 1) - Math.max(top, py));
    for (let px = Math.floor(left); px < Math.ceil(right); px++) {
      if (px < 0 || px >= w) continue;
      const overlapX = Math.max(0, Math.min(right, px + 1) - Math.max(left, px));
      const weight = overlapX * overlapY;
      if (weight <= 0) continue;
      const index = py * w + px;
      const value = finiteNumber(data[index], `grid[${index}]`);
      weightedSum += value * weight;
      totalWeight += weight;
      samples.push(Object.freeze({ x: px, y: py, index, value, weight, contribution: value * weight }));
    }
  }

  return {
    method: 'area-average',
    dimensions: Object.freeze([w, h]),
    requestedArea: Object.freeze({ x: x0, y: y0, width: areaWidth, height: areaHeight }),
    clippedArea: Object.freeze({ x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }),
    clipped: left !== Math.min(x0, x1) || top !== Math.min(y0, y1) || right !== Math.max(x0, x1) || bottom !== Math.max(y0, y1),
    totalWeight,
    sampleCount: samples.length,
    samples: Object.freeze(samples),
    weightedSum,
    value: totalWeight > 0 ? weightedSum / totalWeight : null,
  };
}

export function stratifiedSampleGridReport(columns, rows, options = {}) {
  const cols = positiveInteger(columns, 'columns');
  const rowCount = positiveInteger(rows, 'rows');
  const jitter = options.jitter === undefined ? null : requiredArrayLike(options.jitter, cols * rowCount * 2, 'jitter');
  const samples = [];

  for (let y = 0; y < rowCount; y++) {
    for (let x = 0; x < cols; x++) {
      const sampleIndex = y * cols + x;
      const jitterOffset = sampleIndex * 2;
      const jx = jitter ? clamp(finiteNumber(jitter[jitterOffset], `jitter[${jitterOffset}]`), 0, 1) : 0.5;
      const jy = jitter ? clamp(finiteNumber(jitter[jitterOffset + 1], `jitter[${jitterOffset + 1}]`), 0, 1) : 0.5;
      samples.push(Object.freeze({
        index: sampleIndex,
        cell: Object.freeze([x, y]),
        jitter: Object.freeze([jx, jy]),
        point: Object.freeze([(x + jx) / cols, (y + jy) / rowCount]),
        cellBounds: Object.freeze({
          x0: x / cols,
          y0: y / rowCount,
          x1: (x + 1) / cols,
          y1: (y + 1) / rowCount,
        }),
      }));
    }
  }

  return {
    method: 'stratified-grid-2d',
    dimensions: Object.freeze([cols, rowCount]),
    sampleCount: samples.length,
    cellArea: 1 / (cols * rowCount),
    jittered: jitter !== null,
    samples: Object.freeze(samples),
  };
}

export function weightedSampleDistributionReport(weights, options = {}) {
  const data = requiredArrayLike(weights, 1, 'weights');
  const normalizedWeights = [];
  const cumulative = [];
  const errors = [];
  let totalWeight = 0;

  for (let i = 0; i < data.length; i++) {
    const weight = finiteNumber(data[i], `weights[${i}]`);
    if (weight < 0) errors.push(`weight-negative:${i}`);
    const sanitized = Math.max(0, weight);
    normalizedWeights.push(sanitized);
    totalWeight += sanitized;
  }

  let running = 0;
  for (const weight of normalizedWeights) {
    running += totalWeight > 0 ? weight / totalWeight : 0;
    cumulative.push(running);
  }
  if (cumulative.length > 0 && totalWeight > 0) cumulative[cumulative.length - 1] = 1;

  const u = options.u === undefined ? null : clamp(finiteNumber(options.u, 'u'), 0, 1);
  const selectedIndex = u === null || totalWeight <= 0 ? null : selectCumulative(cumulative, u);
  const probabilities = normalizedWeights.map((weight) => totalWeight > 0 ? weight / totalWeight : 0);
  const effectiveSampleSize = probabilities.reduce((sum, probability) => sum + probability * probability, 0);

  return {
    method: 'weighted-discrete',
    valid: errors.length === 0 && totalWeight > 0,
    errors: Object.freeze(errors),
    count: data.length,
    totalWeight,
    weights: Object.freeze([...normalizedWeights]),
    probabilities: Object.freeze(probabilities),
    cumulative: Object.freeze(cumulative),
    selectedU: u,
    selectedIndex,
    selectedProbability: selectedIndex === null ? null : probabilities[selectedIndex],
    effectiveSampleCount: effectiveSampleSize > 0 ? 1 / effectiveSampleSize : 0,
  };
}

export function discreteImportanceSampleReport(weights, u, options = {}) {
  const distribution = weightedSampleDistributionReport(weights, { u });
  const selectedIndex = distribution.selectedIndex;
  const selectedProbability = distribution.selectedProbability;
  const targetWeight = options.targetWeights === undefined
    ? null
    : weightedSampleDistributionReport(options.targetWeights).probabilities;
  const targetProbability = targetWeight && selectedIndex !== null ? targetWeight[selectedIndex] ?? 0 : null;

  return {
    method: 'discrete-importance',
    distribution,
    selectedIndex,
    selectedProbability,
    targetProbability,
    inverseProbabilityWeight: selectedProbability && selectedProbability > 0 ? 1 / selectedProbability : null,
    balanceWeight: targetProbability !== null && selectedProbability && selectedProbability > 0
      ? targetProbability / selectedProbability
      : null,
  };
}

export function blueNoiseSampleSetReport(points, options = {}) {
  const pointList = normalizePointList(points);
  const minDistance = options.minDistance === undefined ? null : positiveFinite(options.minDistance, 'minDistance');
  const wrap = options.wrap === true;
  let minNearestDistance = pointList.length <= 1 ? null : Infinity;
  let maxNearestDistance = pointList.length <= 1 ? null : 0;
  let nearestDistanceSum = 0;
  let violationCount = 0;
  const nearestDistances = [];
  const violations = [];

  for (let i = 0; i < pointList.length; i++) {
    let nearest = Infinity;
    let nearestIndex = -1;
    for (let j = 0; j < pointList.length; j++) {
      if (i === j) continue;
      const distance = pointDistance2D(pointList[i], pointList[j], wrap);
      if (distance < nearest) {
        nearest = distance;
        nearestIndex = j;
      }
    }
    if (nearestIndex >= 0) {
      nearestDistances.push(nearest);
      nearestDistanceSum += nearest;
      minNearestDistance = Math.min(minNearestDistance, nearest);
      maxNearestDistance = Math.max(maxNearestDistance, nearest);
      if (minDistance !== null && nearest < minDistance) {
        violationCount += 1;
        violations.push(Object.freeze({ index: i, nearestIndex, distance: nearest }));
      }
    }
  }

  const meanNearestDistance = nearestDistances.length > 0 ? nearestDistanceSum / nearestDistances.length : null;
  const minDistanceRatio = minDistance && minDistance > 0 && minNearestDistance !== null ? minNearestDistance / minDistance : null;

  return {
    method: 'blue-noise-nearest-neighbor',
    pointCount: pointList.length,
    minDistance,
    wrap,
    valid: minDistance === null ? true : violationCount === 0,
    violationCount,
    violations: Object.freeze(violations),
    nearestDistances: Object.freeze(nearestDistances),
    minNearestDistance: minNearestDistance === Infinity ? null : minNearestDistance,
    maxNearestDistance,
    meanNearestDistance,
    minDistanceRatio,
  };
}

export function sobol2DSample(index) {
  const sampleIndex = nonnegativeInteger(index, 'index');
  if (sampleIndex > 0xffffffff) throw new RangeError('index must fit in 32 bits for sobol2DSample');
  return Object.freeze([
    sobolCoordinate(sampleIndex, 0),
    sobolCoordinate(sampleIndex, 1),
  ]);
}

export function lowDiscrepancySequenceReport(count, options = {}) {
  const sampleCount = nonnegativeInteger(count, 'count');
  const sequence = String(options.sequence ?? options.type ?? 'sobol2d').toLowerCase();
  const startIndex = nonnegativeInteger(options.startIndex ?? 0, 'startIndex');
  const samples = [];

  for (let i = 0; i < sampleCount; i++) {
    const index = startIndex + i;
    const point = sequence === 'sobol2d' || sequence === 'sobol'
      ? sobol2DSample(index)
      : null;
    if (point === null) throw new RangeError(`Unsupported low-discrepancy sequence: ${sequence}`);
    samples.push(Object.freeze({ index, point }));
  }

  const points = samples.map((sample) => sample.point);
  return {
    method: 'low-discrepancy-sequence',
    sequence: sequence === 'sobol' ? 'sobol2d' : sequence,
    sampleCount,
    startIndex,
    exactSobol2D: sequence === 'sobol' || sequence === 'sobol2d',
    samples: Object.freeze(samples),
    uniformity: sampleSetUniformityReport(points, { gridSize: options.gridSize }),
  };
}

export function multiJitteredSampleGridReport(size, options = {}) {
  const side = positiveInteger(size, 'size');
  const jitter = options.jitter === undefined ? null : requiredArrayLike(options.jitter, side * side * 2, 'jitter');
  const samples = [];

  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const sampleIndex = y * side + x;
      const jitterOffset = sampleIndex * 2;
      const xSubcell = (x + y) % side;
      const ySubcell = (x + y) % side;
      const jx = jitter ? clamp(finiteNumber(jitter[jitterOffset], `jitter[${jitterOffset}]`), 0, 1) : 0.5;
      const jy = jitter ? clamp(finiteNumber(jitter[jitterOffset + 1], `jitter[${jitterOffset + 1}]`), 0, 1) : 0.5;
      const point = Object.freeze([
        (x + (xSubcell + jx) / side) / side,
        (y + (ySubcell + jy) / side) / side,
      ]);
      samples.push(Object.freeze({
        index: sampleIndex,
        cell: Object.freeze([x, y]),
        subcell: Object.freeze([xSubcell, ySubcell]),
        jitter: Object.freeze([jx, jy]),
        point,
      }));
    }
  }

  return {
    method: 'multi-jittered-grid-2d',
    dimensions: Object.freeze([side, side]),
    sampleCount: samples.length,
    jittered: jitter !== null,
    samples: Object.freeze(samples),
    uniformity: sampleSetUniformityReport(samples.map((sample) => sample.point), { gridSize: side }),
  };
}

export function sampleSetUniformityReport(points, options = {}) {
  const pointList = normalizePointList(points);
  const gridSize = positiveInteger(options.gridSize ?? Math.max(1, Math.ceil(Math.sqrt(Math.max(1, pointList.length)))), 'gridSize');
  const occupancy = new Array(gridSize * gridSize).fill(0);
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  let sumX = 0;
  let sumY = 0;

  for (const point of pointList) {
    sumX += point[0];
    sumY += point[1];
    bounds.minX = Math.min(bounds.minX, point[0]);
    bounds.minY = Math.min(bounds.minY, point[1]);
    bounds.maxX = Math.max(bounds.maxX, point[0]);
    bounds.maxY = Math.max(bounds.maxY, point[1]);
    const gx = clamp(Math.floor(point[0] * gridSize), 0, gridSize - 1);
    const gy = clamp(Math.floor(point[1] * gridSize), 0, gridSize - 1);
    occupancy[gy * gridSize + gx] += 1;
  }

  const expectedPerCell = pointList.length / occupancy.length;
  let emptyCellCount = 0;
  let maxCellCount = 0;
  let maxCellDeviation = 0;
  for (const count of occupancy) {
    if (count === 0) emptyCellCount += 1;
    maxCellCount = Math.max(maxCellCount, count);
    maxCellDeviation = Math.max(maxCellDeviation, Math.abs(count - expectedPerCell));
  }

  const nearest = blueNoiseSampleSetReport(pointList);
  return {
    method: 'sample-set-uniformity',
    pointCount: pointList.length,
    gridSize,
    occupancy: Object.freeze(occupancy),
    emptyCellCount,
    maxCellCount,
    expectedPerCell,
    maxCellDeviation,
    mean: Object.freeze(pointList.length > 0 ? [sumX / pointList.length, sumY / pointList.length] : [null, null]),
    bounds: Object.freeze({
      minX: bounds.minX === Infinity ? null : bounds.minX,
      minY: bounds.minY === Infinity ? null : bounds.minY,
      maxX: bounds.maxX === -Infinity ? null : bounds.maxX,
      maxY: bounds.maxY === -Infinity ? null : bounds.maxY,
    }),
    minNearestDistance: nearest.minNearestDistance,
    meanNearestDistance: nearest.meanNearestDistance,
  };
}

function sampleFrameWindow(start, windowSize, sampleCount, sampleRate) {
  const endExclusive = Math.min(sampleCount, start + windowSize);
  const frame = {
    startIndex: start,
    endExclusive,
    sampleCount: Math.max(0, endExclusive - start),
    centerIndex: start + Math.max(0, endExclusive - start) / 2,
  };
  if (sampleRate !== null) {
    frame.startSeconds = samplesToSeconds(frame.startIndex, sampleRate);
    frame.endSeconds = samplesToSeconds(frame.endExclusive, sampleRate);
    frame.centerSeconds = samplesToSeconds(frame.centerIndex, sampleRate);
  }
  return frame;
}

function selectCumulative(cumulative, u) {
  for (let i = 0; i < cumulative.length; i++) {
    if (u <= cumulative[i]) return i;
  }
  return Math.max(0, cumulative.length - 1);
}

function normalizePointList(points) {
  if (!points || typeof points.length !== 'number') throw new TypeError('points must be array-like');
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (!point || typeof point.length !== 'number' || point.length < 2) throw new TypeError(`points[${i}] must be a 2D point`);
    out.push(Object.freeze([
      finiteNumber(point[0], `points[${i}][0]`),
      finiteNumber(point[1], `points[${i}][1]`),
    ]));
  }
  return Object.freeze(out);
}

function pointDistance2D(a, b, wrap) {
  let dx = Math.abs(a[0] - b[0]);
  let dy = Math.abs(a[1] - b[1]);
  if (wrap) {
    dx = Math.min(dx, 1 - dx);
    dy = Math.min(dy, 1 - dy);
  }
  return Math.hypot(dx, dy);
}

function sobolCoordinate(index, dimension) {
  let gray = (index ^ (index >>> 1)) >>> 0;
  let result = 0;
  let bit = 0;
  while (gray !== 0) {
    if ((gray & 1) !== 0) {
      result = (result ^ sobolDirectionNumber(dimension, bit)) >>> 0;
    }
    gray >>>= 1;
    bit += 1;
  }
  return result / 4294967296;
}

function sobolDirectionNumber(dimension, bit) {
  if (dimension === 0) return (0x80000000 >>> bit) >>> 0;
  let direction = 0x80000000;
  for (let i = 0; i < bit; i++) {
    direction = (direction ^ (direction >>> 1)) >>> 0;
  }
  return direction >>> 0;
}

function spatialCoordinate(value, size, normalizedCoordinates, name) {
  const coordinate = finiteNumber(value, name);
  return normalizedCoordinates ? coordinate * (size - 1) : coordinate;
}

function optionalArrayLike(value, minLength, name) {
  if (value == null) return null;
  return requiredArrayLike(value, minLength, name);
}

function requiredArrayLike(value, minLength, name) {
  if (!value || typeof value.length !== 'number') throw new TypeError(`${name} must be array-like`);
  if (value.length < minLength) throw new RangeError(`${name} must contain at least ${minLength} values`);
  return value;
}

function footprint2D(x, y, width, weight, data) {
  const index = y * width + x;
  const value = data ? finiteNumber(data[index], `grid[${index}]`) : null;
  return Object.freeze({
    x,
    y,
    index,
    weight,
    value,
    contribution: value === null ? null : value * weight,
  });
}

function footprint3D(x, y, z, width, height, weight, data) {
  const index = z * width * height + y * width + x;
  const value = data ? finiteNumber(data[index], `grid[${index}]`) : null;
  return Object.freeze({
    x,
    y,
    z,
    index,
    weight,
    value,
    contribution: value === null ? null : value * weight,
  });
}

function catmullRomWeights(t) {
  const u = finiteNumber(t, 't');
  const u2 = u * u;
  const u3 = u2 * u;
  return [
    -0.5 * u3 + u2 - 0.5 * u,
    1.5 * u3 - 2.5 * u2 + 1,
    -1.5 * u3 + 2 * u2 + 0.5 * u,
    0.5 * u3 - 0.5 * u2,
  ];
}

function normalizedEdgeMode(edgeMode) {
  const mode = String(edgeMode || 'clamp').toLowerCase();
  if (mode === 'wrap' || mode === 'mirror' || mode === 'none') return mode;
  return 'clamp';
}

function spatialIndex(index, size, edgeMode) {
  if (edgeMode === 'wrap') return ((index % size) + size) % size;
  if (edgeMode === 'mirror') {
    if (size <= 1) return 0;
    const period = size * 2 - 2;
    const wrapped = ((index % period) + period) % period;
    return wrapped < size ? wrapped : period - wrapped;
  }
  if (edgeMode === 'none') {
    if (index < 0 || index >= size) throw new RangeError(`sample index ${index} out of bounds for size ${size}`);
    return index;
  }
  return clamp(index, 0, size - 1);
}

function finiteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new RangeError(`${name} must be finite`);
  return number;
}

function positiveFinite(value, name) {
  const number = finiteNumber(value, name);
  if (number <= 0) throw new RangeError(`${name} must be positive`);
  return number;
}

function integer(value, name) {
  const number = finiteNumber(value, name);
  if (!Number.isSafeInteger(number)) throw new RangeError(`${name} must be a safe integer`);
  return number;
}

function nonnegativeInteger(value, name) {
  const number = integer(value, name);
  if (number < 0) throw new RangeError(`${name} must be nonnegative`);
  return number;
}

function positiveInteger(value, name) {
  const number = integer(value, name);
  if (number <= 0) throw new RangeError(`${name} must be positive`);
  return number;
}
