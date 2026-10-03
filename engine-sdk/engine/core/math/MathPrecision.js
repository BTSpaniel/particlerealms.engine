// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathPrecision.js - numeric tolerance and world-scale split-double helpers.
// Pure math helpers for tests, serialization policy, and CPU/GPU coordinate packing.

export const DEFAULT_ABSOLUTE_TOLERANCE = 1e-6;
export const DEFAULT_RELATIVE_TOLERANCE = 1e-6;
export const DEFAULT_WORLD_SPLIT_TOLERANCE = 1e-3;

export function absoluteError(actual, expected) {
  return Math.abs(actual - expected);
}

export function relativeError(actual, expected) {
  const scale = Math.max(Math.abs(expected), 1);
  return absoluteError(actual, expected) / scale;
}

export function numberWithinTolerance(
  actual,
  expected,
  absoluteTolerance = DEFAULT_ABSOLUTE_TOLERANCE,
  relativeTolerance = DEFAULT_RELATIVE_TOLERANCE
) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
    return actual === expected;
  }
  const error = absoluteError(actual, expected);
  return error <= absoluteTolerance || error <= Math.max(Math.abs(expected), 1) * relativeTolerance;
}

export function maxAbsError(actual, expected) {
  const count = Math.min(actual.length, expected.length);
  let error = 0;
  for (let i = 0; i < count; i++) {
    error = Math.max(error, absoluteError(actual[i], expected[i]));
  }
  return error;
}

export function vecWithinTolerance(
  actual,
  expected,
  absoluteTolerance = DEFAULT_ABSOLUTE_TOLERANCE,
  relativeTolerance = DEFAULT_RELATIVE_TOLERANCE
) {
  if (!actual || !expected || actual.length !== expected.length) {
    return false;
  }
  for (let i = 0; i < actual.length; i++) {
    if (!numberWithinTolerance(actual[i], expected[i], absoluteTolerance, relativeTolerance)) {
      return false;
    }
  }
  return true;
}

export function splitFloat64ToFloat32(value) {
  if (!Number.isFinite(value)) {
    return { high: 0, low: 0, finite: false };
  }
  const high = Math.fround(value);
  const low = Math.fround(value - high);
  return { high, low, finite: true };
}

export function joinFloat32Split(split) {
  if (!split || split.finite === false) {
    return 0;
  }
  return split.high + split.low;
}

export function splitVec3Float64ToFloat32(value) {
  const x = splitFloat64ToFloat32(value[0]);
  const y = splitFloat64ToFloat32(value[1]);
  const z = splitFloat64ToFloat32(value[2]);
  return {
    high: [x.high, y.high, z.high],
    low: [x.low, y.low, z.low],
    finite: x.finite && y.finite && z.finite,
  };
}

export function joinVec3Float32Split(split) {
  if (!split || split.finite === false) {
    return [0, 0, 0];
  }
  return [
    split.high[0] + split.low[0],
    split.high[1] + split.low[1],
    split.high[2] + split.low[2],
  ];
}

export function serializeFloat32Split(split) {
  if (!split || split.finite === false) {
    return { high: 0, low: 0, finite: false };
  }
  return {
    high: Math.fround(split.high),
    low: Math.fround(split.low),
    finite: true,
  };
}

export function deserializeFloat32Split(payload) {
  if (!payload || payload.finite === false) {
    return { high: 0, low: 0, finite: false };
  }
  return {
    high: Math.fround(Number(payload.high)),
    low: Math.fround(Number(payload.low)),
    finite: Number.isFinite(Number(payload.high)) && Number.isFinite(Number(payload.low)),
  };
}

export function serializeVec3Float32Split(split) {
  if (!split || split.finite === false) {
    return {
      high: [0, 0, 0],
      low: [0, 0, 0],
      finite: false,
    };
  }
  return {
    high: split.high.map((value) => Math.fround(value)),
    low: split.low.map((value) => Math.fround(value)),
    finite: true,
  };
}

export function deserializeVec3Float32Split(payload) {
  if (!payload || payload.finite === false || !Array.isArray(payload.high) || !Array.isArray(payload.low)) {
    return {
      high: [0, 0, 0],
      low: [0, 0, 0],
      finite: false,
    };
  }
  const high = payload.high.map((value) => Math.fround(Number(value)));
  const low = payload.low.map((value) => Math.fround(Number(value)));
  return {
    high,
    low,
    finite: high.every(Number.isFinite) && low.every(Number.isFinite),
  };
}

export function jsonRoundTrip(value) {
  const encoded = JSON.stringify(value);
  return {
    encoded,
    decoded: JSON.parse(encoded),
  };
}
