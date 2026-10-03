// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathScalar.js - Scalar utility functions
// Depends on: MathConstants.js

import { EPSILON, PI, TAU, DEG2RAD, RAD2DEG } from './MathConstants.js';

// Conversion
export const degToRad = (deg) => deg * DEG2RAD;
export const radToDeg = (rad) => rad * RAD2DEG;

// Clamping and saturation
export const clamp = (x, min, max) => x < min ? min : x > max ? max : x;
export const saturate = (x) => x < 0 ? 0 : x > 1 ? 1 : x;
export const clamp01 = saturate;

// Interpolation
export const lerp = (a, b, t) => a + (b - a) * t;
export const inverseLerp = (a, b, x) => Math.abs(b - a) < EPSILON ? 0 : (x - a) / (b - a);
export const remap = (x, inMin, inMax, outMin, outMax) => lerp(outMin, outMax, inverseLerp(inMin, inMax, x));
export const remapClamped = (x, inMin, inMax, outMin, outMax) => lerp(outMin, outMax, saturate(inverseLerp(inMin, inMax, x)));

// Smoothing functions
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const smootherstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

// Step functions
export const step = (edge, x) => x < edge ? 0 : 1;
export const pulse = (a, b, x) => step(a, x) - step(b, x);

// Fractional and modulo
export const fract = (x) => x - Math.floor(x);
export const mod = (x, y) => x - y * Math.floor(x / y); // True modulo (always positive)
export const wrap = (x, min, max) => min + mod(x - min, max - min);

// Sign and comparison
export const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;
export const signNonZero = (x) => x >= 0 ? 1 : -1; // Returns 1 for zero
export const approxEqual = (a, b, eps = EPSILON) => Math.abs(a - b) < eps;
export const approxZero = (x, eps = EPSILON) => Math.abs(x) < eps;

export const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
export const finiteNumber = (value, fallback = 0) => isFiniteNumber(value) ? value : fallback;

export function nearlyEqual(a, b, absEps = EPSILON, relEps = EPSILON) {
  if (Object.is(a, b)) return true;
  if (!isFiniteNumber(a) || !isFiniteNumber(b)) return false;
  const diff = Math.abs(a - b);
  if (diff <= absEps) return true;
  return diff <= Math.max(Math.abs(a), Math.abs(b), 1) * relEps;
}

export function safeDiv(numerator, denominator, fallback = 0) {
  return isFiniteNumber(numerator) && isFiniteNumber(denominator) && denominator !== 0 ? numerator / denominator : fallback;
}

function finiteStep(stepSize) {
  const stepValue = Math.abs(finiteNumber(stepSize, 0));
  return stepValue > 0 ? stepValue : 1;
}

// Quantization
export const snap = (x, grid) => Math.round(x / grid) * grid;
export const snapFloor = (x, grid) => Math.floor(x / grid) * grid;
export const snapCeil = (x, grid) => Math.ceil(x / grid) * grid;
export const roundTo = (x, stepSize = 1) => Math.round(finiteNumber(x) / finiteStep(stepSize)) * finiteStep(stepSize);
export const floorTo = (x, stepSize = 1) => Math.floor(finiteNumber(x) / finiteStep(stepSize)) * finiteStep(stepSize);
export const ceilTo = (x, stepSize = 1) => Math.ceil(finiteNumber(x) / finiteStep(stepSize)) * finiteStep(stepSize);

export function gcd(a, b) {
  let x = Math.abs(Math.trunc(finiteNumber(a, 0)));
  let y = Math.abs(Math.trunc(finiteNumber(b, 0)));
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

export function lcm(a, b) {
  const x = Math.abs(Math.trunc(finiteNumber(a, 0)));
  const y = Math.abs(Math.trunc(finiteNumber(b, 0)));
  return x === 0 || y === 0 ? 0 : (x / gcd(x, y)) * y;
}

export function normalizeRange(min, max) {
  const a = finiteNumber(min, 0);
  const b = finiteNumber(max, a);
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  return { min: low, max: high, span: high - low, empty: low === high };
}

export function clampRange(value, min, max) {
  const range = normalizeRange(min, max);
  return clamp(finiteNumber(value, range.min), range.min, range.max);
}

export function rangeContains(value, min, max, inclusive = true) {
  const range = normalizeRange(min, max);
  const x = finiteNumber(value, Number.NaN);
  return inclusive ? x >= range.min && x <= range.max : x > range.min && x < range.max;
}

export function rangeOverlap(aMin, aMax, bMin, bMax, inclusive = true) {
  const a = normalizeRange(aMin, aMax);
  const b = normalizeRange(bMin, bMax);
  return inclusive ? a.min <= b.max && b.min <= a.max : a.min < b.max && b.min < a.max;
}

export function rangeIntersection(aMin, aMax, bMin, bMax) {
  if (!rangeOverlap(aMin, aMax, bMin, bMax)) {
    return { min: 0, max: 0, span: 0, empty: true };
  }
  return normalizeRange(Math.max(normalizeRange(aMin, aMax).min, normalizeRange(bMin, bMax).min), Math.min(normalizeRange(aMin, aMax).max, normalizeRange(bMin, bMax).max));
}

export function rangeUnion(aMin, aMax, bMin, bMax) {
  const a = normalizeRange(aMin, aMax);
  const b = normalizeRange(bMin, bMax);
  return normalizeRange(Math.min(a.min, b.min), Math.max(a.max, b.max));
}

export function splitRange(min, max, segments) {
  const range = normalizeRange(min, max);
  const count = Math.max(1, Math.trunc(finiteNumber(segments, 1)));
  const stepSize = range.span / count;
  return Array.from({ length: count }, (_, index) => normalizeRange(range.min + stepSize * index, index === count - 1 ? range.max : range.min + stepSize * (index + 1)));
}

// Angle utilities
export const wrapAngle = (angle) => mod(angle + PI, TAU) - PI; // [-PI, PI]
export const wrapAnglePositive = (angle) => mod(angle, TAU); // [0, TAU]
export const angleDiff = (a, b) => wrapAngle(b - a);
export const lerpAngle = (a, b, t) => a + angleDiff(a, b) * t;
export const angleBetween = (a, b) => Math.abs(angleDiff(a, b));

// Min/max extensions
export const min3 = (a, b, c) => Math.min(a, Math.min(b, c));
export const max3 = (a, b, c) => Math.max(a, Math.max(b, c));
export const min4 = (a, b, c, d) => Math.min(Math.min(a, b), Math.min(c, d));
export const max4 = (a, b, c, d) => Math.max(Math.max(a, b), Math.max(c, d));
export const minArray = (arr) => arr.reduce((a, b) => Math.min(a, b), Infinity);
export const maxArray = (arr) => arr.reduce((a, b) => Math.max(a, b), -Infinity);

// Move toward target
export const moveToward = (current, target, maxDelta) => {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + sign(diff) * maxDelta;
};

// Damping (for smooth following)
export const damp = (current, target, smoothing, dt) => {
  return lerp(current, target, 1 - Math.pow(smoothing, dt));
};

// Spring damping (critically damped spring)
export const springDamp = (current, target, velocity, smoothTime, dt) => {
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (velocity + omega * change) * dt;
  const newVelocity = (velocity - omega * temp) * exp;
  const newValue = target + (change + temp) * exp;
  return { value: newValue, velocity: newVelocity };
};

// Ping pong (triangle wave)
export const pingPong = (t, length) => {
  const t2 = mod(t, length * 2);
  return length - Math.abs(t2 - length);
};

// Repeat (sawtooth wave)
export const repeat = (t, length) => mod(t, length);

// Delta angle (shortest path)
export const deltaAngle = (current, target) => {
  let delta = mod(target - current, TAU);
  if (delta > PI) delta -= TAU;
  return delta;
};

// Move toward angle
export const moveTowardAngle = (current, target, maxDelta) => {
  const delta = deltaAngle(current, target);
  if (Math.abs(delta) <= maxDelta) return target;
  return current + clamp(delta, -maxDelta, maxDelta);
};

// WGSL parity
export const inverseSqrt = (x) => 1 / Math.sqrt(x);
export const fma = (a, b, c) => a * b + c;

// Perlin bias/gain (Ken Perlin, Texturing and Modeling)
export const bias = (x, b) => Math.pow(x, Math.log(b) / Math.log(0.5));
export const gain = (x, g) => x < 0.5 ? bias(2 * x, g) * 0.5 : 1 - bias(2 - 2 * x, g) * 0.5;

// Almost identity (Inigo Quilez - useful for soft minimum / smooth transition from 0)
export const almostIdentity = (x, threshold, value) => {
  if (x > threshold) return x;
  const a = 2 * value - threshold;
  const b = 2 * threshold - 3 * value;
  const t = x / threshold;
  return (a * t + b) * t * t + value;
};
