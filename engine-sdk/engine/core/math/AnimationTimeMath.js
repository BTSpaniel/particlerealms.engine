// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// AnimationTimeMath.js - pure animation timing, keyframe, and sampler reports.

import { clamp, finiteNumber, lerp } from './MathScalar.js';
import { quatNormalize, quatSlerp } from './MathQuat.js';

const EPSILON = 1e-8;
const DEFAULT_ROTATION = Object.freeze([0, 0, 0, 1]);
const DEFAULT_SCALE = Object.freeze([1, 1, 1]);
const DEFAULT_TRANSLATION = Object.freeze([0, 0, 0]);
const PLAYBACK_STATE_KEYS = Object.freeze(['clipIndex', 'time', 'speed', 'playing', 'loop']);

function finiteOr(value, fallback = 0) {
  return finiteNumber(value, fallback);
}

function finiteOrInfinity(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) || number === Infinity ? number : fallback;
}

function positiveFinite(value, fallback = 1) {
  const number = finiteNumber(value, fallback);
  return number > 0 ? number : fallback;
}

function normalizeInterpolation(interpolation = 'LINEAR') {
  const value = String(interpolation || 'LINEAR').toUpperCase();
  if (value === 'STEP' || value === 'CUBICSPLINE') return value;
  return 'LINEAR';
}

function normalizePath(path = 'translation') {
  const value = String(path || 'translation');
  if (value === 'rotation' || value === 'scale' || value === 'weights') return value;
  return 'translation';
}

function normalizeUsdInterpolation(interpolation = 'linear') {
  const value = String(interpolation || 'linear').toLowerCase();
  return value === 'held' || value === 'hold' || value === 'step' ? 'held' : 'linear';
}

function positiveRate(value, fallback = 24) {
  const number = finiteNumber(value, fallback);
  return number > 0 ? number : fallback;
}

function usdTimeCodesPerSecond(options, prefix, fallback = 24) {
  const timeCodes = options?.[`${prefix}TimeCodesPerSecond`];
  if (Number.isFinite(Number(timeCodes)) && Number(timeCodes) > 0) return Number(timeCodes);
  const frames = options?.[`${prefix}FramesPerSecond`];
  if (Number.isFinite(Number(frames)) && Number(frames) > 0) return Number(frames);
  return positiveRate(options?.timeCodesPerSecond ?? options?.framesPerSecond, fallback);
}

function sortedUsdTimeSamples(times) {
  const entries = [];
  for (let i = 0; i < (times?.length ?? 0); i += 1) {
    const timeCode = Number(times[i]);
    if (Number.isFinite(timeCode)) entries.push({ timeCode, sourceIndex: i });
  }
  entries.sort((a, b) => a.timeCode - b.timeCode || a.sourceIndex - b.sourceIndex);
  const unique = [];
  for (const entry of entries) {
    const previous = unique[unique.length - 1];
    if (previous && Math.abs(previous.timeCode - entry.timeCode) <= EPSILON) {
      unique[unique.length - 1] = entry;
    } else {
      unique.push(entry);
    }
  }
  return unique;
}

function usdValueAt(values, sourceIndex, options = {}) {
  const elemCount = Math.max(0, options.elemCount | 0);
  const fallback = options.defaultValue ?? 0;
  const direct = values?.[sourceIndex];
  if (Array.isArray(direct) || ArrayBuffer.isView(direct)) return Array.from(direct, (value) => finiteOr(value, 0));
  if (elemCount > 1) {
    const out = new Array(elemCount);
    const base = sourceIndex * elemCount;
    for (let i = 0; i < elemCount; i += 1) out[i] = finiteOr(values?.[base + i], 0);
    return out;
  }
  return finiteOr(direct, finiteOr(fallback, 0));
}

function interpolateUsdValue(a, b, alpha) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const left = Array.isArray(a) ? a : [finiteOr(a, 0)];
    const right = Array.isArray(b) ? b : [finiteOr(b, 0)];
    const count = Math.min(left.length, right.length);
    const out = new Array(count);
    for (let i = 0; i < count; i += 1) out[i] = lerp(finiteOr(left[i], 0), finiteOr(right[i], 0), alpha);
    return out;
  }
  return lerp(finiteOr(a, 0), finiteOr(b, 0), alpha);
}

function defaultElement(path, elemCount = 0) {
  if (path === 'rotation') return DEFAULT_ROTATION.slice();
  if (path === 'scale') return DEFAULT_SCALE.slice(0, elemCount || 3);
  if (path === 'weights') return new Array(Math.max(0, elemCount | 0)).fill(0);
  return DEFAULT_TRANSLATION.slice(0, elemCount || 3);
}

function zeroElement(elemCount = 0) {
  return new Array(Math.max(0, elemCount | 0)).fill(0);
}

function elementCountForPath(path, fallback = 3) {
  if (path === 'rotation') return 4;
  if (path === 'scale' || path === 'translation') return 3;
  return Math.max(1, fallback | 0);
}

function copyElement(values, elemCount, index, path, stride = elemCount, valueOffset = 0, normalizeRotation = true) {
  const count = elementCountForPath(path, elemCount);
  const out = defaultElement(path, count);
  const base = index * stride + valueOffset;
  for (let i = 0; i < Math.min(count, elemCount); i += 1) {
    const value = Number(values?.[base + i]);
    out[i] = Number.isFinite(value) ? value : out[i];
  }
  return path === 'rotation' && normalizeRotation ? quatNormalize(out) : out;
}

function lerpArray(a, b, t) {
  const count = Math.min(a.length, b.length);
  const out = new Array(count);
  for (let i = 0; i < count; i += 1) out[i] = lerp(a[i], b[i], t);
  return out;
}

function cubicSplineArray(v0, outTangent0, v1, inTangent1, t, dt) {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const count = Math.min(v0.length, outTangent0.length, v1.length, inTangent1.length);
  const out = new Array(count);
  for (let i = 0; i < count; i += 1) {
    out[i] = h00 * v0[i] + dt * h10 * outTangent0[i] + h01 * v1[i] + dt * h11 * inTangent1[i];
  }
  return out;
}

export function animationActiveDuration(iterationDuration, iterationCount = 1) {
  const duration = finiteOrInfinity(iterationDuration, 0);
  const count = iterationCount === Infinity ? Infinity : finiteOr(iterationCount, 1);
  if (duration <= 0 || count <= 0) return 0;
  if (duration === Infinity || count === Infinity) return Infinity;
  return duration * count;
}

export function animationWrapTime(time, duration, options = {}) {
  const t = finiteOr(time, 0);
  const d = finiteOr(duration, 0);
  if (d <= 0) return { valid: false, time: 0, duration: d, wrapped: false, loopCount: 0 };
  if (options.loop === false) {
    return {
      valid: true,
      time: clamp(t, 0, d),
      duration: d,
      wrapped: false,
      loopCount: t >= d ? 1 : 0,
    };
  }
  let wrapped = t % d;
  if (wrapped < 0) wrapped += d;
  return {
    valid: true,
    time: wrapped,
    duration: d,
    wrapped: wrapped !== t,
    loopCount: Math.floor(t / d),
  };
}

export function animationFrameWrap(frame, frameCount) {
  const count = Math.max(1, frameCount | 0);
  let wrapped = finiteOr(frame, 0);
  if (count > 1) {
    wrapped %= count;
    if (wrapped < 0) wrapped += count;
  } else {
    wrapped = 0;
  }
  const floor = Math.floor(wrapped);
  return {
    valid: count > 0,
    frame: wrapped,
    frameCount: count,
    floor,
    next: count > 1 ? (floor + 1) % count : 0,
    alpha: wrapped - floor,
  };
}

export function animationPlaybackRateReport(options = {}) {
  const playbackRate = finiteOr(options.playbackRate ?? options.rate, 1);
  const pendingValue = Number(options.pendingPlaybackRate);
  const hasPendingPlaybackRate = Number.isFinite(pendingValue);
  const effectivePlaybackRate = hasPendingPlaybackRate ? pendingValue : playbackRate;
  const previousPlaybackRate = finiteOr(options.previousPlaybackRate ?? options.previousRate ?? playbackRate, playbackRate);
  const timeScale = finiteOr(options.timeScale ?? options.scale, 1);
  const effectiveScale = effectivePlaybackRate * timeScale;
  const previousEffectiveScale = previousPlaybackRate * timeScale;
  const zeroRate = Math.abs(effectiveScale) <= EPSILON;
  const reversed = effectiveScale < -EPSILON;
  const previousZeroRate = Math.abs(previousEffectiveScale) <= EPSILON;
  const previousReversed = previousEffectiveScale < -EPSILON;
  const direction = zeroRate ? 'stopped' : reversed ? 'reverse' : 'forward';
  const previousDirection = previousZeroRate ? 'stopped' : previousReversed ? 'reverse' : 'forward';
  return {
    valid: Number.isFinite(playbackRate) && Number.isFinite(effectivePlaybackRate) && Number.isFinite(timeScale),
    playbackRate,
    pendingPlaybackRate: hasPendingPlaybackRate ? pendingValue : null,
    hasPendingPlaybackRate,
    effectivePlaybackRate,
    previousPlaybackRate,
    timeScale,
    effectiveScale,
    previousEffectiveScale,
    speedMultiplier: Math.abs(effectiveScale),
    zeroRate,
    reversed,
    direction,
    previousDirection,
    changed: Math.abs(effectiveScale - previousEffectiveScale) > EPSILON,
    changedDirection: direction !== previousDirection,
  };
}

/** Validate and normalize the serializable state of one animation player. */
export function animationPlaybackStateReport(value = {}, options = {}) {
  const defaults = options.defaults && typeof options.defaults === 'object'
    ? options.defaults
    : {};
  const source = value == null ? {} : value;
  const objectValid = !!source && typeof source === 'object' && !Array.isArray(source);
  const strictKeys = options.strictKeys !== false;
  const keysValid = objectValid && (!strictKeys
    || Object.keys(source).every((key) => PLAYBACK_STATE_KEYS.includes(key)));
  const durations = Array.isArray(options.clipDurations)
    ? options.clipDurations.map((duration) => Number(duration))
    : null;
  const durationsValid = durations === null
    || durations.every((duration) => Number.isFinite(duration) && duration >= 0);
  const clipCount = durations
    ? durations.length
    : Math.max(1, Number.isInteger(options.clipCount) ? options.clipCount : 1);
  const defaultClipIndex = Number.isInteger(defaults.clipIndex) ? defaults.clipIndex : 0;
  const clipIndex = objectValid && source.clipIndex !== undefined
    ? Number(source.clipIndex)
    : defaultClipIndex;
  const clipValid = Number.isInteger(clipIndex) && clipIndex >= 0 && clipIndex < clipCount;
  const selectedDuration = clipValid && durations ? durations[clipIndex] : null;
  const maxTime = Number.isFinite(selectedDuration)
    ? selectedDuration
    : positiveFinite(options.maxTime, 1e9);
  const time = objectValid && source.time !== undefined
    ? Number(source.time)
    : finiteOr(defaults.time, 0);
  const speed = objectValid && source.speed !== undefined
    ? Number(source.speed)
    : finiteOr(defaults.speed, 1);
  const maxAbsSpeed = positiveFinite(options.maxAbsSpeed, 16);
  const playing = objectValid && source.playing !== undefined
    ? source.playing
    : (typeof defaults.playing === 'boolean' ? defaults.playing : true);
  const loop = objectValid && source.loop !== undefined
    ? source.loop
    : (typeof defaults.loop === 'boolean' ? defaults.loop : true);
  const timeValid = Number.isFinite(time) && time >= 0 && time <= maxTime;
  const speedValid = Number.isFinite(speed) && Math.abs(speed) <= maxAbsSpeed;
  const booleansValid = typeof playing === 'boolean' && typeof loop === 'boolean';
  const valid = objectValid && keysValid && durationsValid && clipCount > 0
    && clipValid && timeValid && speedValid && booleansValid;
  return {
    valid,
    value: valid ? { clipIndex, time, speed, playing, loop } : null,
    clipCount,
    selectedDuration,
    maxTime,
    maxAbsSpeed,
    reason: !objectValid ? 'invalid-object'
      : !keysValid ? 'unknown-key'
        : !durationsValid || clipCount <= 0 ? 'invalid-clips'
          : !clipValid ? 'invalid-clip-index'
            : !timeValid ? 'invalid-time'
              : !speedValid ? 'invalid-speed'
                : !booleansValid ? 'invalid-boolean' : null,
  };
}

export function animationTimeScaleReport(time, options = {}) {
  const inputTime = finiteOr(time ?? options.time, 0);
  const origin = finiteOr(options.origin ?? options.startTime, 0);
  const offset = finiteOr(options.offset ?? options.timeOffset ?? options.startOffset, 0);
  const timeScale = finiteOr(options.timeScale ?? options.scale, 1);
  const playbackRate = finiteOr(options.effectivePlaybackRate ?? options.playbackRate ?? options.rate, 1);
  const effectiveScale = timeScale * playbackRate;
  const scaledTime = (inputTime - origin) * effectiveScale + offset;
  const duration = finiteOr(options.duration, 0);
  const loop = options.loop !== false;
  const wrap = duration > 0
    ? animationWrapTime(scaledTime, duration, { loop })
    : { valid: false, time: scaledTime, duration, wrapped: false, loopCount: 0 };
  const sampleTime = duration > 0 ? wrap.time : scaledTime;
  return {
    valid: Number.isFinite(inputTime) && Number.isFinite(origin) && Number.isFinite(offset) && Number.isFinite(effectiveScale),
    inputTime,
    origin,
    offset,
    timeScale,
    playbackRate,
    effectiveScale,
    scaledTime,
    sampleTime,
    duration,
    loop,
    wrapped: duration > 0 ? wrap.wrapped : false,
    loopCount: duration > 0 ? wrap.loopCount : 0,
    wrap,
  };
}

export function animationTimelineOffsetReport(options = {}) {
  const timelineTime = finiteOr(options.timelineTime ?? options.now, 0);
  const timelineActive = options.timelineActive !== false;
  const startValue = Number(options.startTime);
  const holdValue = Number(options.holdTime);
  const explicitCurrentValue = Number(options.currentTime);
  const hasStartTime = Number.isFinite(startValue);
  const hasHoldTime = Number.isFinite(holdValue);
  const hasExplicitCurrentTime = Number.isFinite(explicitCurrentValue);
  const playbackRate = finiteOr(options.playbackRate ?? options.rate, 1);

  let currentTime = Number.NaN;
  let resolved = false;
  let source = 'unresolved';
  if (hasHoldTime) {
    currentTime = holdValue;
    resolved = true;
    source = 'holdTime';
  } else if (timelineActive && hasStartTime) {
    currentTime = (timelineTime - startValue) * playbackRate;
    resolved = true;
    source = 'timeline';
  } else if (hasExplicitCurrentTime) {
    currentTime = explicitCurrentValue;
    resolved = true;
    source = 'currentTime';
  }

  const pendingValue = Number(options.pendingPlaybackRate ?? options.newPlaybackRate);
  const hasPendingPlaybackRate = Number.isFinite(pendingValue);
  const newPlaybackRate = hasPendingPlaybackRate ? pendingValue : playbackRate;
  const timelineOffset = hasStartTime ? timelineTime - startValue : Number.NaN;
  let preservedStartTime = Number.NaN;
  if (resolved && timelineActive) {
    preservedStartTime = Math.abs(newPlaybackRate) <= EPSILON
      ? timelineTime
      : timelineTime - (currentTime / newPlaybackRate);
  }

  const seekValue = Number(options.seekTime);
  const hasSeekTime = Number.isFinite(seekValue);
  let seekStartTime = Number.NaN;
  if (hasSeekTime && timelineActive) {
    seekStartTime = Math.abs(newPlaybackRate) <= EPSILON
      ? timelineTime
      : timelineTime - (seekValue / newPlaybackRate);
  }

  return {
    valid: Number.isFinite(timelineTime) && Number.isFinite(playbackRate),
    timelineTime,
    timelineActive,
    startTime: hasStartTime ? startValue : null,
    holdTime: hasHoldTime ? holdValue : null,
    playbackRate,
    currentTime,
    resolved,
    source,
    timelineOffset,
    pendingPlaybackRate: hasPendingPlaybackRate ? pendingValue : null,
    hasPendingPlaybackRate,
    newPlaybackRate,
    preservedStartTime,
    seekTime: hasSeekTime ? seekValue : null,
    seekStartTime,
  };
}

export function animationOpenUsdLayerOffsetReport(timeCode, options = {}) {
  const sourceTimeCode = finiteOr(timeCode ?? options.timeCode, 0);
  const sourceTimeCodesPerSecond = usdTimeCodesPerSecond(options, 'source', positiveRate(options.layerTimeCodesPerSecond, 24));
  const targetTimeCodesPerSecond = usdTimeCodesPerSecond(options, 'target', positiveRate(options.stageTimeCodesPerSecond, sourceTimeCodesPerSecond));
  const automaticScale = targetTimeCodesPerSecond / sourceTimeCodesPerSecond;
  const layerOffsetScale = finiteOr(options.layerOffsetScale ?? options.scale, 1);
  const layerOffset = finiteOr(options.layerOffset ?? options.offset, 0);
  const layerOffsetApplied = layerOffsetScale > 0;
  const scaledTimeCode = sourceTimeCode * automaticScale;
  const adjustedTimeCode = layerOffsetApplied ? (scaledTimeCode * layerOffsetScale) + layerOffset : scaledTimeCode;
  const seconds = adjustedTimeCode / targetTimeCodesPerSecond;
  const sourceSeconds = sourceTimeCode / sourceTimeCodesPerSecond;
  const startTimeCode = Number(options.startTimeCode);
  const endTimeCode = Number(options.endTimeCode);
  const hasPlaybackRange = Number.isFinite(startTimeCode) && Number.isFinite(endTimeCode);
  const rangeMin = hasPlaybackRange ? Math.min(startTimeCode, endTimeCode) : Number.NaN;
  const rangeMax = hasPlaybackRange ? Math.max(startTimeCode, endTimeCode) : Number.NaN;
  const withinPlaybackRange = hasPlaybackRange ? adjustedTimeCode >= rangeMin && adjustedTimeCode <= rangeMax : true;
  return {
    valid: Number.isFinite(sourceTimeCode) && sourceTimeCodesPerSecond > 0 && targetTimeCodesPerSecond > 0 && layerOffsetApplied,
    sourceTimeCode,
    sourceTimeCodesPerSecond,
    targetTimeCodesPerSecond,
    automaticScale,
    layerOffsetScale,
    layerOffset,
    layerOffsetApplied,
    adjustedTimeCode,
    seconds,
    sourceSeconds,
    startTimeCode: hasPlaybackRange ? startTimeCode : null,
    endTimeCode: hasPlaybackRange ? endTimeCode : null,
    hasPlaybackRange,
    withinPlaybackRange,
    playbackRangeIsValueResolutionRange: false,
  };
}

export function animationOpenUsdTimeSampleBracket(times, timeCode, options = {}) {
  const entries = sortedUsdTimeSamples(times);
  const sampleCount = entries.length;
  const queryTimeCode = finiteOr(timeCode ?? options.timeCode, 0);
  const interpolation = normalizeUsdInterpolation(options.interpolation ?? options.interpolationType);
  const preTime = options.preTime === true || String(options.timeCodeType || '').toLowerCase() === 'pretime';
  if (sampleCount <= 0) {
    return {
      valid: false,
      resolved: false,
      sampleCount,
      queryTimeCode,
      interpolation,
      preTime,
      lowerIndex: -1,
      upperIndex: -1,
      lowerSourceIndex: -1,
      upperSourceIndex: -1,
      lowerTimeCode: Number.NaN,
      upperTimeCode: Number.NaN,
      alpha: 0,
      exact: false,
      edge: 'empty',
    };
  }
  if (sampleCount === 1 || queryTimeCode < entries[0].timeCode || Math.abs(queryTimeCode - entries[0].timeCode) <= EPSILON) {
    return {
      valid: true,
      resolved: true,
      sampleCount,
      queryTimeCode,
      interpolation,
      preTime,
      lowerIndex: 0,
      upperIndex: 0,
      lowerSourceIndex: entries[0].sourceIndex,
      upperSourceIndex: entries[0].sourceIndex,
      lowerTimeCode: entries[0].timeCode,
      upperTimeCode: entries[0].timeCode,
      alpha: 0,
      exact: Math.abs(queryTimeCode - entries[0].timeCode) <= EPSILON,
      edge: queryTimeCode < entries[0].timeCode ? 'before' : sampleCount === 1 ? 'single' : 'exact',
    };
  }
  const last = sampleCount - 1;
  if (queryTimeCode > entries[last].timeCode || Math.abs(queryTimeCode - entries[last].timeCode) <= EPSILON) {
    if (preTime && sampleCount > 1 && Math.abs(queryTimeCode - entries[last].timeCode) <= EPSILON) {
      return {
        valid: true,
        resolved: true,
        sampleCount,
        queryTimeCode,
        interpolation,
        preTime,
        lowerIndex: last - 1,
        upperIndex: last,
        lowerSourceIndex: entries[last - 1].sourceIndex,
        upperSourceIndex: entries[last].sourceIndex,
        lowerTimeCode: entries[last - 1].timeCode,
        upperTimeCode: entries[last].timeCode,
        alpha: 1,
        exact: true,
        edge: 'pre-time',
      };
    }
    return {
      valid: true,
      resolved: true,
      sampleCount,
      queryTimeCode,
      interpolation,
      preTime,
      lowerIndex: last,
      upperIndex: last,
      lowerSourceIndex: entries[last].sourceIndex,
      upperSourceIndex: entries[last].sourceIndex,
      lowerTimeCode: entries[last].timeCode,
      upperTimeCode: entries[last].timeCode,
      alpha: 0,
      exact: Math.abs(queryTimeCode - entries[last].timeCode) <= EPSILON,
      edge: queryTimeCode > entries[last].timeCode ? 'after' : 'exact',
    };
  }
  let lowerIndex = 0;
  while (lowerIndex < last && entries[lowerIndex + 1].timeCode < queryTimeCode) lowerIndex += 1;
  const upperIndex = lowerIndex + 1;
  const lowerTimeCode = entries[lowerIndex].timeCode;
  const upperTimeCode = entries[upperIndex].timeCode;
  const exactUpper = Math.abs(queryTimeCode - upperTimeCode) <= EPSILON;
  if (exactUpper && !preTime) {
    return {
      valid: true,
      resolved: true,
      sampleCount,
      queryTimeCode,
      interpolation,
      preTime,
      lowerIndex: upperIndex,
      upperIndex,
      lowerSourceIndex: entries[upperIndex].sourceIndex,
      upperSourceIndex: entries[upperIndex].sourceIndex,
      lowerTimeCode: upperTimeCode,
      upperTimeCode,
      alpha: 0,
      exact: true,
      edge: 'exact',
    };
  }
  if (preTime && exactUpper) {
    return {
      valid: true,
      resolved: true,
      sampleCount,
      queryTimeCode,
      interpolation,
      preTime,
      lowerIndex,
      upperIndex,
      lowerSourceIndex: entries[lowerIndex].sourceIndex,
      upperSourceIndex: entries[upperIndex].sourceIndex,
      lowerTimeCode,
      upperTimeCode,
      alpha: 1,
      exact: true,
      edge: 'pre-time',
    };
  }
  const alpha = upperTimeCode === lowerTimeCode ? 0 : (queryTimeCode - lowerTimeCode) / (upperTimeCode - lowerTimeCode);
  return {
    valid: true,
    resolved: true,
    sampleCount,
    queryTimeCode,
    interpolation,
    preTime,
    lowerIndex,
    upperIndex,
    lowerSourceIndex: entries[lowerIndex].sourceIndex,
    upperSourceIndex: entries[upperIndex].sourceIndex,
    lowerTimeCode,
    upperTimeCode,
    alpha: clamp(alpha, 0, 1),
    exact: false,
    edge: 'between',
  };
}

export function animationOpenUsdSampleValue(times, values, timeCode, options = {}) {
  const bracket = animationOpenUsdTimeSampleBracket(times, timeCode, options);
  if (!bracket.valid || !bracket.resolved) {
    return {
      valid: false,
      resolved: false,
      queryTimeCode: bracket.queryTimeCode,
      interpolation: bracket.interpolation,
      value: options.defaultValue ?? null,
      lowerValue: null,
      upperValue: null,
      bracket,
    };
  }
  const lowerValue = usdValueAt(values, bracket.lowerSourceIndex, options);
  const upperValue = usdValueAt(values, bracket.upperSourceIndex, options);
  const held = bracket.interpolation === 'held' || bracket.lowerSourceIndex === bracket.upperSourceIndex;
  const value = held ? lowerValue : interpolateUsdValue(lowerValue, upperValue, bracket.alpha);
  return {
    valid: true,
    resolved: true,
    queryTimeCode: bracket.queryTimeCode,
    interpolation: bracket.interpolation,
    held,
    value,
    lowerValue,
    upperValue,
    bracket,
  };
}

export function animationTimingReport(options = {}) {
  const localTime = finiteOr(options.localTime ?? options.time, 0);
  const delay = finiteOr(options.delay ?? options.startDelay, 0);
  const endDelay = finiteOr(options.endDelay, 0);
  const iterationDuration = finiteOrInfinity(options.iterationDuration ?? options.duration, 0);
  const iterationCount = options.iterationCount === Infinity ? Infinity : finiteOr(options.iterationCount ?? options.iterations, 1);
  const fill = String(options.fill ?? options.fillMode ?? 'none').toLowerCase();
  const direction = String(options.direction ?? 'normal').toLowerCase();
  const activeDuration = animationActiveDuration(iterationDuration, iterationCount);
  const activeStart = delay;
  const activeEnd = activeDuration === Infinity ? Infinity : delay + activeDuration;
  const endTime = activeEnd === Infinity ? Infinity : activeEnd + endDelay;
  const before = localTime < activeStart;
  const after = activeEnd !== Infinity && localTime >= activeEnd;
  const active = !before && !after;
  const phase = before ? 'before' : after ? 'after' : 'active';
  const fillsBefore = fill === 'backwards' || fill === 'both';
  const fillsAfter = fill === 'forwards' || fill === 'both';

  let activeTime = Number.NaN;
  if (active) activeTime = localTime - delay;
  else if (before && fillsBefore) activeTime = Math.max(localTime - delay, 0);
  else if (after && fillsAfter) activeTime = Math.max(Math.min(localTime - delay, activeDuration), 0);
  const resolved = Number.isFinite(activeTime);
  const overallProgress = resolved
    ? (iterationDuration <= 0 ? 0 : activeTime / iterationDuration)
    : Number.NaN;
  let currentIteration = resolved ? Math.floor(overallProgress) : -1;
  if (resolved && activeDuration !== Infinity && activeTime === activeDuration && iterationCount > 0) {
    currentIteration = Math.max(0, Math.ceil(iterationCount) - 1);
  }
  let simpleProgress = resolved && iterationDuration > 0 ? overallProgress - Math.floor(overallProgress) : Number.NaN;
  if (resolved && activeDuration !== Infinity && activeTime === activeDuration) simpleProgress = 1;
  if (Number.isFinite(simpleProgress)) simpleProgress = clamp(simpleProgress, 0, 1);

  let reverse = false;
  if (direction === 'reverse') reverse = true;
  else if (direction === 'alternate' || direction === 'alternate-reverse') {
    let d = currentIteration;
    if (direction === 'alternate-reverse') d += 1;
    reverse = Number.isFinite(d) && Math.abs(d % 2) === 1;
  }
  const directedProgress = Number.isFinite(simpleProgress) ? (reverse ? 1 - simpleProgress : simpleProgress) : Number.NaN;
  return {
    valid: iterationDuration >= 0 && iterationCount >= 0,
    localTime,
    delay,
    endDelay,
    iterationDuration,
    iterationCount,
    activeDuration,
    activeStart,
    activeEnd,
    endTime,
    phase,
    resolved,
    activeTime,
    overallProgress,
    simpleProgress,
    currentIteration,
    direction,
    currentDirection: reverse ? 'reverse' : 'forwards',
    directedProgress,
    fill,
  };
}

export function animationKeyframeBracket(times, time, options = {}) {
  const count = times?.length ?? 0;
  if (count <= 0) {
    return { valid: false, resolved: false, time: finiteOr(time, 0), lowerIndex: -1, upperIndex: -1, alpha: 0, edge: 'empty' };
  }
  const t = finiteOr(time, 0);
  if (count === 1 || t <= times[0]) {
    return { valid: true, resolved: true, time: t, lowerIndex: 0, upperIndex: 0, alpha: 0, edge: t <= times[0] ? 'start' : 'single' };
  }
  const last = count - 1;
  if (t >= times[last]) {
    return { valid: true, resolved: true, time: t, lowerIndex: last, upperIndex: last, alpha: 0, edge: 'end' };
  }
  let lo = Math.max(0, Math.min(options.hintIndex | 0, last - 1));
  if (times[lo] > t) lo = 0;
  while (lo < last - 1 && times[lo + 1] <= t) lo += 1;
  if (times[lo] > t || times[lo + 1] < t) {
    lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t) lo = mid;
      else hi = mid;
    }
  }
  const hi = lo + 1;
  const t0 = finiteOr(times[lo], 0);
  const t1 = finiteOr(times[hi], t0);
  const span = Math.max(EPSILON, t1 - t0);
  return {
    valid: true,
    resolved: true,
    time: t,
    lowerIndex: lo,
    upperIndex: hi,
    lowerTime: t0,
    upperTime: t1,
    duration: t1 - t0,
    alpha: clamp((t - t0) / span, 0, 1),
    edge: 'middle',
  };
}

export function animationSampleScalar(a, b, t) {
  return lerp(finiteOr(a, 0), finiteOr(b, 0), clamp(finiteOr(t, 0), 0, 1));
}

export function animationSampleVector(a, b, t) {
  return lerpArray(Array.from(a || []), Array.from(b || []), clamp(finiteOr(t, 0), 0, 1));
}

export function animationSampleQuaternion(a, b, t) {
  return quatNormalize(quatSlerp(a || DEFAULT_ROTATION, b || DEFAULT_ROTATION, clamp(finiteOr(t, 0), 0, 1)));
}

export function animationCubicSplineSample(v0, outTangent0, v1, inTangent1, t, duration = 1, options = {}) {
  const path = normalizePath(options.path);
  const count = elementCountForPath(path, options.elemCount ?? options.elementSize ?? 3);
  const value = cubicSplineArray(
    Array.from(v0 || defaultElement(path, count)),
    Array.from(outTangent0 || zeroElement(count)),
    Array.from(v1 || defaultElement(path, count)),
    Array.from(inTangent1 || zeroElement(count)),
    clamp(finiteOr(t, 0), 0, 1),
    positiveFinite(duration, 1),
  );
  return path === 'rotation' ? quatNormalize(value) : value;
}

export function animationSampleChannel(times, values, time, options = {}) {
  const path = normalizePath(options.path ?? options.targetPath);
  const interpolation = normalizeInterpolation(options.interpolation);
  const elemCount = elementCountForPath(path, options.elemCount ?? options.elementSize ?? 3);
  const stride = interpolation === 'CUBICSPLINE' ? elemCount * 3 : elemCount;
  const valueOffset = interpolation === 'CUBICSPLINE' ? elemCount : 0;
  const bracket = animationKeyframeBracket(times, time, options);
  if (!bracket.valid) {
    return {
      valid: false,
      interpolation,
      path,
      value: defaultElement(path, elemCount),
      bracket,
    };
  }
  if (bracket.lowerIndex === bracket.upperIndex || interpolation === 'STEP') {
    return {
      valid: true,
      interpolation,
      path,
      value: copyElement(values, elemCount, bracket.lowerIndex, path, stride, valueOffset),
      bracket,
    };
  }
  const lower = bracket.lowerIndex;
  const upper = bracket.upperIndex;
  const v0 = copyElement(values, elemCount, lower, path, stride, valueOffset);
  const v1 = copyElement(values, elemCount, upper, path, stride, valueOffset);
  let value;
  if (interpolation === 'CUBICSPLINE') {
    const outTangent0 = copyElement(values, elemCount, lower, path, stride, elemCount * 2, false);
    const inTangent1 = copyElement(values, elemCount, upper, path, stride, 0, false);
    value = animationCubicSplineSample(v0, outTangent0, v1, inTangent1, bracket.alpha, bracket.duration, { path });
  } else if (path === 'rotation') {
    value = animationSampleQuaternion(v0, v1, bracket.alpha);
  } else {
    value = animationSampleVector(v0, v1, bracket.alpha);
  }
  return {
    valid: true,
    interpolation,
    path,
    value,
    bracket,
  };
}

export function animationSampleChannelInto(times, values, time, out, outOffset = 0, options = {}) {
  const path = normalizePath(options.path ?? options.targetPath);
  const interpolation = normalizeInterpolation(options.interpolation);
  const elemCount = elementCountForPath(path, options.elemCount ?? options.elementSize ?? 3);
  const stride = interpolation === 'CUBICSPLINE' ? elemCount * 3 : elemCount;
  const valueOffset = interpolation === 'CUBICSPLINE' ? elemCount : 0;
  const bracket = animationKeyframeBracket(times, time, options);
  const offset = Math.max(0, outOffset | 0);

  let value;
  if (!bracket.valid) {
    value = defaultElement(path, elemCount);
  } else if (bracket.lowerIndex === bracket.upperIndex || interpolation === 'STEP') {
    value = copyElement(values, elemCount, bracket.lowerIndex, path, stride, valueOffset);
  } else {
    const lower = bracket.lowerIndex;
    const upper = bracket.upperIndex;
    if (interpolation === 'CUBICSPLINE') {
      const v0 = copyElement(values, elemCount, lower, path, stride, valueOffset);
      const v1 = copyElement(values, elemCount, upper, path, stride, valueOffset);
      const outTangent0 = copyElement(values, elemCount, lower, path, stride, elemCount * 2, false);
      const inTangent1 = copyElement(values, elemCount, upper, path, stride, 0, false);
      value = animationCubicSplineSample(v0, outTangent0, v1, inTangent1, bracket.alpha, bracket.duration, { path, elemCount });
    } else if (path === 'rotation') {
      value = animationSampleQuaternion(
        copyElement(values, elemCount, lower, path, stride, valueOffset),
        copyElement(values, elemCount, upper, path, stride, valueOffset),
        bracket.alpha,
      );
    } else {
      value = null;
      const baseLower = lower * stride + valueOffset;
      const baseUpper = upper * stride + valueOffset;
      for (let i = 0; i < elemCount; i += 1) {
        const a = finiteOr(values?.[baseLower + i], 0);
        const b = finiteOr(values?.[baseUpper + i], 0);
        out[offset + i] = animationSampleScalar(a, b, bracket.alpha);
      }
    }
  }

  if (value) {
    for (let i = 0; i < Math.min(elemCount, value.length); i += 1) {
      out[offset + i] = value[i];
    }
  }

  return {
    valid: !!bracket.valid,
    interpolation,
    path,
    elementCount: elemCount,
    outOffset: offset,
    bracket,
  };
}

export function animationClipSampleTimeReport(time, options = {}) {
  const fps = positiveFinite(options.fps, 60);
  const duration = finiteOr(options.duration ?? options.durationSeconds, 0);
  const frameCount = Math.max(1, options.frameCount | 0 || Math.max(1, Math.floor(duration * fps + 0.5) + 1));
  const loop = options.loop !== false;
  const wrappedTime = duration > 0 ? animationWrapTime(time, duration, { loop }) : { valid: false, time: 0, duration, wrapped: false, loopCount: 0 };
  const sampleTime = wrappedTime.valid ? wrappedTime.time : finiteOr(time, 0);
  const frame = sampleTime * fps;
  const frameWrap = loop ? animationFrameWrap(frame, frameCount) : {
    valid: true,
    frame: clamp(frame, 0, frameCount - 1),
    frameCount,
    floor: Math.floor(clamp(frame, 0, frameCount - 1)),
    next: Math.min(frameCount - 1, Math.floor(clamp(frame, 0, frameCount - 1)) + 1),
    alpha: clamp(frame, 0, frameCount - 1) - Math.floor(clamp(frame, 0, frameCount - 1)),
  };
  return {
    valid: fps > 0 && frameCount > 0,
    inputTime: finiteOr(time, 0),
    sampleTime,
    duration,
    fps,
    frameCount,
    frame: frameWrap.frame,
    frameIndex: frameWrap.floor,
    nextFrameIndex: frameWrap.next,
    alpha: frameWrap.alpha,
    wrapped: wrappedTime.wrapped,
    loopCount: wrappedTime.loopCount,
    loop,
  };
}

export function animationKeyframeReductionReport(times, values, options = {}) {
  const count = times?.length ?? 0;
  const elemCount = Math.max(1, options.elemCount ?? options.elementSize ?? 1);
  const path = normalizePath(options.path);
  const tolerance = Math.max(0, finiteOr(options.tolerance, 1e-4));
  if (count <= 2) {
    return { valid: count > 0, removable: Object.freeze([]), kept: [...Array(count).keys()], maxError: 0, originalCount: count, reducedCount: count };
  }
  const removable = [];
  let maxError = 0;
  for (let i = 1; i < count - 1; i += 1) {
    const t0 = finiteOr(times[i - 1], 0);
    const t1 = finiteOr(times[i + 1], t0);
    const local = Math.abs(t1 - t0) <= EPSILON ? 0 : clamp((finiteOr(times[i], t0) - t0) / (t1 - t0), 0, 1);
    const prev = copyElement(values, elemCount, i - 1, path, elemCount, 0);
    const next = copyElement(values, elemCount, i + 1, path, elemCount, 0);
    const actual = copyElement(values, elemCount, i, path, elemCount, 0);
    const predicted = path === 'rotation' ? animationSampleQuaternion(prev, next, local) : animationSampleVector(prev, next, local);
    let error = 0;
    for (let c = 0; c < Math.min(actual.length, predicted.length); c += 1) {
      error = Math.max(error, Math.abs(actual[c] - predicted[c]));
    }
    maxError = Math.max(maxError, error);
    if (error <= tolerance) removable.push(i);
  }
  const removableSet = new Set(removable);
  const kept = [...Array(count).keys()].filter((index) => !removableSet.has(index));
  return {
    valid: true,
    originalCount: count,
    reducedCount: kept.length,
    removable,
    kept,
    maxError,
    tolerance,
    reductionRatio: count > 0 ? 1 - kept.length / count : 0,
  };
}
