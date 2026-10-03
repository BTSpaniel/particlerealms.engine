// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// InputSignalMath.js - pure pointer/stylus sample shaping, smoothing, and prediction helpers.

import { EPSILON, HALF_PI, TAU } from './MathConstants.js';
import { clamp, finiteNumber, lerp, mod } from './MathScalar.js';
import { finiteNumberReport, vectorValidationReport } from './MathValidation.js';
import { degreesToRadians, radiansToDegrees } from './UnitMath.js';

export const INPUT_SIGNAL_LIMITS = Object.freeze({
  minAxis: -1,
  maxAxis: 1,
  defaultDeadzone: 0.15,
  maxDeadzone: 0.999999,
  maxAxisDimensions: 4,
  maxResponseGamma: 8,
});

const DEFAULT_SMOOTH_FIELDS = Object.freeze([
  'x',
  'y',
  'pressure',
  'tiltX',
  'tiltY',
  'twist',
  'width',
  'height',
]);

function finiteInputNumber(value, fallback = 0) {
  return finiteNumber(value, fallback);
}

function positiveInputNumber(value, fallback = 1) {
  const number = finiteInputNumber(value, fallback);
  return number > 0 ? number : fallback;
}

function sampleX(sample) {
  return finiteInputNumber(sample?.x ?? sample?.clientX ?? sample?.pageX ?? sample?.screenX, 0);
}

function sampleY(sample) {
  return finiteInputNumber(sample?.y ?? sample?.clientY ?? sample?.pageY ?? sample?.screenY, 0);
}

function sampleTimeMs(sample, fallback = 0) {
  return finiteInputNumber(sample?.timeMs ?? sample?.timestamp ?? sample?.timeStamp ?? sample?.t, fallback);
}

function samplePressure(sample, fallback = 0) {
  return clamp(finiteInputNumber(sample?.pressure, fallback), 0, 1);
}

function optionalSampleNumber(sample, key, fallback = null) {
  const value = sample?.[key];
  return Number.isFinite(value) ? value : fallback;
}

function normalizeInputSample(sample, fallbackTimeMs = 0, fallbackPressure = 0) {
  return {
    x: sampleX(sample),
    y: sampleY(sample),
    timeMs: sampleTimeMs(sample, fallbackTimeMs),
    pressure: samplePressure(sample, fallbackPressure),
    tiltX: optionalSampleNumber(sample, 'tiltX', 0),
    tiltY: optionalSampleNumber(sample, 'tiltY', 0),
    twist: optionalSampleNumber(sample, 'twist', 0),
    width: optionalSampleNumber(sample, 'width', 1),
    height: optionalSampleNumber(sample, 'height', 1),
    pointerId: sample?.pointerId ?? null,
    pointerType: sample?.pointerType ?? null,
  };
}

function normalizeSamples(samples, options = {}) {
  if (!samples || typeof samples[Symbol.iterator] !== 'function') {
    throw new TypeError('samples must be iterable');
  }
  const defaultStepMs = positiveInputNumber(options.defaultStepMs ?? 16.6666666667, 16.6666666667);
  const defaultPressure = clamp(finiteInputNumber(options.defaultPressure ?? 0, 0), 0, 1);
  const normalized = [];
  let fallbackTimeMs = 0;
  for (const sample of samples) {
    const entry = normalizeInputSample(sample, fallbackTimeMs, defaultPressure);
    normalized.push(entry);
    fallbackTimeMs = entry.timeMs + defaultStepMs;
  }
  return normalized;
}

function freezeArrayObjects(values) {
  return Object.freeze(values.map((value) => Object.freeze(value)));
}

function normalizeAngleRadians(radians) {
  const value = finiteInputNumber(radians, 0);
  const wrapped = mod(value, TAU);
  return wrapped >= TAU ? 0 : wrapped;
}

function axisShapeOptionsReport(options = {}) {
  const object = options !== null && typeof options === 'object' && !Array.isArray(options);
  const deadzone = finiteNumberReport(options?.deadzone ?? INPUT_SIGNAL_LIMITS.defaultDeadzone, {
    min: 0,
    max: INPUT_SIGNAL_LIMITS.maxDeadzone,
  });
  const outerDeadzone = finiteNumberReport(options?.outerDeadzone ?? 0, {
    min: 0,
    max: INPUT_SIGNAL_LIMITS.maxDeadzone,
  });
  const gamma = finiteNumberReport(options?.gamma ?? 1, {
    min: Number.EPSILON,
    max: INPUT_SIGNAL_LIMITS.maxResponseGamma,
  });
  const invertValid = options?.invert === undefined || typeof options.invert === 'boolean';
  const ordered = deadzone.valid && outerDeadzone.valid && deadzone.value + outerDeadzone.value < 1;
  return {
    valid: object && deadzone.valid && outerDeadzone.valid && gamma.valid && invertValid && ordered,
    object,
    deadzone,
    outerDeadzone,
    gamma,
    invertValid,
    ordered,
    invert: options?.invert === true,
  };
}

function shapedAxisMagnitude(magnitude, options) {
  if (magnitude <= options.deadzone.value) return 0;
  const outerEdge = 1 - options.outerDeadzone.value;
  const remapped = clamp((magnitude - options.deadzone.value) / (outerEdge - options.deadzone.value), 0, 1);
  return Math.pow(remapped, options.gamma.value);
}

export function inputAxisRemapReport(axis, options = {}) {
  const value = finiteNumberReport(axis, {
    min: INPUT_SIGNAL_LIMITS.minAxis,
    max: INPUT_SIGNAL_LIMITS.maxAxis,
  });
  const shape = axisShapeOptionsReport(options);
  if (!value.valid || !shape.valid) return { valid: false, axis: value, shape };
  const source = shape.invert ? -value.value : value.value;
  const magnitude = Math.abs(source);
  const remappedMagnitude = shapedAxisMagnitude(magnitude, shape);
  const remapped = Math.sign(source) * remappedMagnitude;
  return {
    valid: true,
    axis: value,
    shape,
    source,
    magnitude,
    active: remappedMagnitude > 0,
    remappedMagnitude,
    value: remapped,
  };
}

export function inputRadialDeadzoneReport(axes, options = {}) {
  const inferredDimension = axes !== null && axes !== undefined && Number.isSafeInteger(axes.length)
    ? axes.length
    : 0;
  const dimension = finiteNumberReport(options?.dimension ?? inferredDimension, {
    integer: true,
    min: 1,
    max: INPUT_SIGNAL_LIMITS.maxAxisDimensions,
  });
  const vector = dimension.valid
    ? vectorValidationReport(axes, {
      dimension: dimension.value,
      componentMin: INPUT_SIGNAL_LIMITS.minAxis,
      componentMax: INPUT_SIGNAL_LIMITS.maxAxis,
    })
    : { valid: false };
  const shape = axisShapeOptionsReport(options);
  if (!dimension.valid || !vector.valid || !shape.valid) {
    return { valid: false, dimension, axes: vector, shape };
  }

  const source = Array.from(axes);
  const rawMagnitude = Math.hypot(...source);
  const clampedMagnitude = Math.min(rawMagnitude, 1);
  const remappedMagnitude = shapedAxisMagnitude(clampedMagnitude, shape);
  const direction = rawMagnitude > EPSILON
    ? source.map((component) => component / rawMagnitude)
    : source.map(() => 0);
  const value = direction.map((component) => component * remappedMagnitude);
  return {
    valid: value.every(Number.isFinite),
    dimension,
    axes: vector,
    shape,
    source: Object.freeze(source),
    rawMagnitude,
    clampedMagnitude,
    active: remappedMagnitude > 0,
    normalized: rawMagnitude > 1,
    remappedMagnitude,
    direction: Object.freeze(direction),
    value: Object.freeze(value),
  };
}

export function inputPressureCurve(pressure, options = {}) {
  const minPressure = finiteInputNumber(options.minPressure ?? options.min ?? 0, 0);
  const maxPressure = finiteInputNumber(options.maxPressure ?? options.max ?? 1, 1);
  const low = Math.min(minPressure, maxPressure);
  const high = Math.max(minPressure, maxPressure);
  if (Math.abs(high - low) <= EPSILON) return 0;

  const normalized = clamp((finiteInputNumber(pressure, low) - low) / (high - low), 0, 1);
  const deadzone = clamp(finiteInputNumber(options.deadzone ?? 0, 0), 0, 0.999999);
  const adjusted = normalized <= deadzone ? 0 : (normalized - deadzone) / (1 - deadzone);
  const gamma = positiveInputNumber(options.gamma ?? 1, 1);
  const floor = clamp(finiteInputNumber(options.floor ?? 0, 0), 0, 1);
  return floor + (1 - floor) * Math.pow(adjusted, gamma);
}

export function inputPressureReport(samples, options = {}) {
  const normalized = normalizeSamples(samples, options);
  const curveOptions = options.curveOptions ?? options;
  const activeThreshold = clamp(finiteInputNumber(options.activeThreshold ?? 0, 0), 0, 1);

  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let curvedSum = 0;
  let activeCount = 0;

  for (const sample of normalized) {
    const pressure = sample.pressure;
    min = Math.min(min, pressure);
    max = Math.max(max, pressure);
    sum += pressure;
    curvedSum += inputPressureCurve(pressure, curveOptions);
    if (pressure > activeThreshold) activeCount++;
  }

  const count = normalized.length;
  return {
    count,
    valid: count > 0,
    min: count > 0 ? min : 0,
    max: count > 0 ? max : 0,
    average: count > 0 ? sum / count : 0,
    curvedAverage: count > 0 ? curvedSum / count : 0,
    activeCount,
    activeRatio: count > 0 ? activeCount / count : 0,
  };
}

export function pointerTiltToAltitudeAzimuth(tiltX = 0, tiltY = 0) {
  const tx = degreesToRadians(clamp(finiteInputNumber(tiltX, 0), -89.999999, 89.999999));
  const ty = degreesToRadians(clamp(finiteInputNumber(tiltY, 0), -89.999999, 89.999999));
  const tangentX = Math.tan(tx);
  const tangentY = Math.tan(ty);
  const tangentMagnitude = Math.hypot(tangentX, tangentY);
  const altitudeAngle = tangentMagnitude <= EPSILON ? HALF_PI : Math.atan(1 / tangentMagnitude);
  const azimuthAngle = tangentMagnitude <= EPSILON ? 0 : normalizeAngleRadians(Math.atan2(tangentX, tangentY));

  return {
    tiltX: radiansToDegrees(tx),
    tiltY: radiansToDegrees(ty),
    altitudeAngle,
    azimuthAngle,
    altitudeDegrees: radiansToDegrees(altitudeAngle),
    azimuthDegrees: radiansToDegrees(azimuthAngle),
  };
}

export function pointerAltitudeAzimuthToTilt(altitudeAngle = HALF_PI, azimuthAngle = 0) {
  const altitude = clamp(finiteInputNumber(altitudeAngle, HALF_PI), EPSILON, HALF_PI);
  const azimuth = normalizeAngleRadians(azimuthAngle);
  const tangentMagnitude = 1 / Math.tan(altitude);
  const tangentX = tangentMagnitude * Math.sin(azimuth);
  const tangentY = tangentMagnitude * Math.cos(azimuth);
  const tiltX = radiansToDegrees(Math.atan(tangentX));
  const tiltY = radiansToDegrees(Math.atan(tangentY));

  return {
    tiltX,
    tiltY,
    altitudeAngle: altitude,
    azimuthAngle: azimuth,
    altitudeDegrees: radiansToDegrees(altitude),
    azimuthDegrees: radiansToDegrees(azimuth),
  };
}

export function inputSampleVelocityReport(samples, options = {}) {
  const normalized = normalizeSamples(samples, options);
  const segments = [];
  let distance = 0;
  let durationMs = 0;
  let peakSpeed = 0;
  let previousSpeed = null;
  let skippedSegmentCount = 0;

  for (let i = 1; i < normalized.length; i++) {
    const previous = normalized[i - 1];
    const current = normalized[i];
    const dtMs = current.timeMs - previous.timeMs;
    if (dtMs <= 0) {
      skippedSegmentCount++;
      continue;
    }

    const dtSeconds = dtMs / 1000;
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    const segmentDistance = Math.hypot(dx, dy);
    const velocityX = dx / dtSeconds;
    const velocityY = dy / dtSeconds;
    const speed = segmentDistance / dtSeconds;
    const acceleration = previousSpeed === null ? 0 : (speed - previousSpeed) / dtSeconds;
    previousSpeed = speed;
    distance += segmentDistance;
    durationMs += dtMs;
    peakSpeed = Math.max(peakSpeed, speed);
    segments.push({
      index: i - 1,
      fromIndex: i - 1,
      toIndex: i,
      dtMs,
      dx,
      dy,
      distance: segmentDistance,
      velocityX,
      velocityY,
      speed,
      acceleration,
    });
  }

  return {
    count: normalized.length,
    segmentCount: segments.length,
    skippedSegmentCount,
    durationMs,
    distance,
    averageSpeed: durationMs > 0 ? distance / (durationMs / 1000) : 0,
    peakSpeed,
    averageVelocityX: durationMs > 0 && segments.length > 0 ? (normalized.at(-1).x - normalized[0].x) / (durationMs / 1000) : 0,
    averageVelocityY: durationMs > 0 && segments.length > 0 ? (normalized.at(-1).y - normalized[0].y) / (durationMs / 1000) : 0,
    segments: freezeArrayObjects(segments),
  };
}

export function smoothInputSamples(samples, options = {}) {
  const normalized = normalizeSamples(samples, options);
  if (normalized.length === 0) return Object.freeze([]);
  const alpha = clamp(finiteInputNumber(options.alpha ?? options.smoothingAlpha ?? 0.5, 0.5), 0, 1);
  const fields = Object.freeze([...(options.fields ?? DEFAULT_SMOOTH_FIELDS)]);
  const smoothed = [];

  let previous = { ...normalized[0] };
  smoothed.push(previous);
  for (let i = 1; i < normalized.length; i++) {
    const current = normalized[i];
    const next = { ...current };
    for (const field of fields) {
      if (Number.isFinite(previous[field]) && Number.isFinite(current[field])) {
        next[field] = lerp(previous[field], current[field], alpha);
      }
    }
    previous = next;
    smoothed.push(next);
  }

  return freezeArrayObjects(smoothed);
}

export function predictInputSample(samples, lookaheadMs = 16.6666666667, options = {}) {
  const normalized = normalizeSamples(samples, options);
  if (normalized.length === 0) return null;
  const last = normalized[normalized.length - 1];
  const leadMs = Math.max(0, finiteInputNumber(lookaheadMs, 0));

  let previous = null;
  for (let i = normalized.length - 2; i >= 0; i--) {
    const candidate = normalized[i];
    if (last.timeMs - candidate.timeMs > 0) {
      previous = candidate;
      break;
    }
  }

  if (!previous || leadMs === 0) {
    return Object.freeze({ ...last, predicted: false, lookaheadMs: leadMs });
  }

  const dtMs = last.timeMs - previous.timeMs;
  const scale = leadMs / dtMs;
  const pressure = options.predictPressure === true
    ? clamp(last.pressure + (last.pressure - previous.pressure) * scale, 0, 1)
    : last.pressure;

  return Object.freeze({
    ...last,
    x: last.x + (last.x - previous.x) * scale,
    y: last.y + (last.y - previous.y) * scale,
    timeMs: last.timeMs + leadMs,
    pressure,
    predicted: true,
    lookaheadMs: leadMs,
    sourceDtMs: dtMs,
  });
}

export function blendInputSamples(leftSample, rightSample, amount = 0.5, options = {}) {
  const t = clamp(finiteInputNumber(amount, 0.5), 0, 1);
  const left = normalizeInputSample(leftSample, 0, options.defaultPressure ?? 0);
  const right = normalizeInputSample(rightSample, left.timeMs, options.defaultPressure ?? left.pressure);
  const blended = { ...left };
  for (const field of DEFAULT_SMOOTH_FIELDS) {
    if (Number.isFinite(left[field]) && Number.isFinite(right[field])) {
      blended[field] = lerp(left[field], right[field], t);
    }
  }
  blended.timeMs = lerp(left.timeMs, right.timeMs, t);
  blended.pointerId = right.pointerId ?? left.pointerId;
  blended.pointerType = right.pointerType ?? left.pointerType;
  blended.blendAmount = t;
  return Object.freeze(blended);
}

export function inputStrokeStabilizationReport(samples, options = {}) {
  const smoothingAlpha = clamp(finiteInputNumber(options.smoothingAlpha ?? options.alpha ?? 0.45, 0.45), 0, 1);
  const predictionMs = Math.max(0, finiteInputNumber(options.predictionMs ?? 0, 0));
  const smoothedSamples = smoothInputSamples(samples, { ...options, alpha: smoothingAlpha });
  const velocityReport = inputSampleVelocityReport(smoothedSamples, options);
  const predictedSample = predictionMs > 0 ? predictInputSample(smoothedSamples, predictionMs, options) : null;

  return {
    count: smoothedSamples.length,
    smoothingAlpha,
    predictionMs,
    smoothedSamples,
    predictedSample,
    velocityReport,
  };
}

export default {
  INPUT_SIGNAL_LIMITS,
  inputAxisRemapReport,
  inputRadialDeadzoneReport,
  inputPressureCurve,
  inputPressureReport,
  pointerTiltToAltitudeAzimuth,
  pointerAltitudeAzimuthToTilt,
  inputSampleVelocityReport,
  smoothInputSamples,
  predictInputSample,
  blendInputSamples,
  inputStrokeStabilizationReport,
};
