// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathVec2.js - 2D Vector operations
// Depends on: MathConstants.js, MathScalar.js

import { EPSILON, TAU } from './MathConstants.js';
import { random } from './MathRandom.js';
import { clamp, fract, mod, sign, smoothstep } from './MathScalar.js';

// Creation
export const vec2 = (x = 0, y = 0) => [x, y];
export const vec2FromAngle = (angle, len = 1) => [Math.cos(angle) * len, Math.sin(angle) * len];
export const vec2FromArray = (arr, offset = 0) => [arr[offset], arr[offset + 1]];
export const vec2Zero = () => [0, 0];
export const vec2One = () => [1, 1];
export const vec2Up = () => [0, 1];
export const vec2Down = () => [0, -1];
export const vec2Left = () => [-1, 0];
export const vec2Right = () => [1, 0];
export const vec2Clone = (v) => [v[0], v[1]];
export const vec2Copy = (out, v) => { out[0] = v[0]; out[1] = v[1]; return out; };
export const vec2Set = (out, x, y) => { out[0] = x; out[1] = y; return out; };

// Basic operations
export const vec2Add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const vec2Sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const vec2Mul = (a, b) => [a[0] * b[0], a[1] * b[1]];
export const vec2Div = (a, b) => [a[0] / b[0], a[1] / b[1]];
export const vec2Scale = (v, s) => [v[0] * s, v[1] * s];
export const vec2Negate = (v) => [-v[0], -v[1]];
export const vec2Inverse = (v) => [1 / v[0], 1 / v[1]];

// In-place operations (mutating)
export const vec2AddInto = (out, a, b) => { out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; return out; };
export const vec2SubInto = (out, a, b) => { out[0] = a[0] - b[0]; out[1] = a[1] - b[1]; return out; };
export const vec2ScaleInto = (out, v, s) => { out[0] = v[0] * s; out[1] = v[1] * s; return out; };
export const vec2ScaleAndAdd = (out, a, b, s) => { out[0] = a[0] + b[0] * s; out[1] = a[1] + b[1] * s; return out; };

// Products
export const vec2Dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const vec2Cross = (a, b) => a[0] * b[1] - a[1] * b[0]; // Pseudo cross (returns scalar)

// Length and distance
export const vec2LengthSq = (v) => v[0] * v[0] + v[1] * v[1];
export const vec2Length = (v) => Math.sqrt(v[0] * v[0] + v[1] * v[1]);
export const vec2DistanceSq = (a, b) => (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
export const vec2Distance = (a, b) => Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
export const vec2Manhattan = (a, b) => Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
export const vec2Chebyshev = (a, b) => Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));

// Normalization
export const vec2Normalize = (v) => {
  const l = vec2Length(v);
  return l < EPSILON ? [0, 0] : [v[0] / l, v[1] / l];
};
export const vec2NormalizeInto = (out, v) => {
  const l = vec2Length(v);
  if (l < EPSILON) { out[0] = 0; out[1] = 0; }
  else { out[0] = v[0] / l; out[1] = v[1] / l; }
  return out;
};
export const vec2SetLength = (v, len) => {
  const l = vec2Length(v);
  return l < EPSILON ? [0, 0] : vec2Scale(v, len / l);
};
export const vec2ClampLength = (v, min, max) => {
  const l = vec2Length(v);
  return l < EPSILON ? [0, 0] : vec2Scale(v, clamp(l, min, max) / l);
};
export const vec2Limit = (v, maxLen) => {
  const l = vec2Length(v);
  return l > maxLen ? vec2Scale(v, maxLen / l) : vec2Clone(v);
};

// Interpolation
export const vec2Lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const vec2SmoothStep = (a, b, t) => vec2Lerp(a, b, smoothstep(0, 1, t));
export const vec2Bezier2 = (p0, p1, p2, t) => {
  const mt = 1 - t;
  return [
    p0[0] * mt * mt + 2 * p1[0] * mt * t + p2[0] * t * t,
    p0[1] * mt * mt + 2 * p1[1] * mt * t + p2[1] * t * t,
  ];
};
export const vec2Bezier3 = (p0, p1, p2, p3, t) => {
  const mt = 1 - t, mt2 = mt * mt, t2 = t * t;
  return [
    p0[0] * mt2 * mt + 3 * p1[0] * mt2 * t + 3 * p2[0] * mt * t2 + p3[0] * t2 * t,
    p0[1] * mt2 * mt + 3 * p1[1] * mt2 * t + 3 * p2[1] * mt * t2 + p3[1] * t2 * t,
  ];
};

// Min/max/clamp
export const vec2Min = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
export const vec2Max = (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
export const vec2Clamp = (v, min, max) => [clamp(v[0], min[0], max[0]), clamp(v[1], min[1], max[1])];
export const vec2ClampScalar = (v, min, max) => [clamp(v[0], min, max), clamp(v[1], min, max)];

// Rounding
export const vec2Floor = (v) => [Math.floor(v[0]), Math.floor(v[1])];
export const vec2Ceil = (v) => [Math.ceil(v[0]), Math.ceil(v[1])];
export const vec2Round = (v) => [Math.round(v[0]), Math.round(v[1])];
export const vec2Trunc = (v) => [Math.trunc(v[0]), Math.trunc(v[1])];
export const vec2Fract = (v) => [fract(v[0]), fract(v[1])];
export const vec2Abs = (v) => [Math.abs(v[0]), Math.abs(v[1])];
export const vec2Sign = (v) => [sign(v[0]), sign(v[1])];
export const vec2Snap = (v, step) => [Math.round(v[0] / step) * step, Math.round(v[1] / step) * step];
export const vec2SnapV = (v, step) => [Math.round(v[0] / step[0]) * step[0], Math.round(v[1] / step[1]) * step[1]];

// Angle operations
export const vec2Angle = (v) => Math.atan2(v[1], v[0]);
export const vec2AngleBetween = (a, b) => Math.atan2(vec2Cross(a, b), vec2Dot(a, b));
export const vec2AngleTo = (from, to) => Math.atan2(to[1] - from[1], to[0] - from[0]);

// Rotation
export const vec2Rotate = (v, angle) => {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
};
export const vec2RotateAround = (v, center, angle) => {
  const dx = v[0] - center[0], dy = v[1] - center[1];
  const c = Math.cos(angle), s = Math.sin(angle);
  return [center[0] + dx * c - dy * s, center[1] + dx * s + dy * c];
};

// Perpendicular
export const vec2Perpendicular = (v) => [-v[1], v[0]]; // CCW 90°
export const vec2PerpendicularCW = (v) => [v[1], -v[0]]; // CW 90°

// Reflection and projection
export const vec2Reflect = (v, n) => {
  const d = 2 * vec2Dot(v, n);
  return [v[0] - d * n[0], v[1] - d * n[1]];
};
export const vec2Project = (v, onto) => {
  const d = vec2Dot(onto, onto);
  if (d < EPSILON) return [0, 0];
  const s = vec2Dot(v, onto) / d;
  return [onto[0] * s, onto[1] * s];
};
export const vec2Reject = (v, from) => vec2Sub(v, vec2Project(v, from));

// Movement
export const vec2MoveToward = (cur, tgt, maxDelta) => {
  const dx = tgt[0] - cur[0], dy = tgt[1] - cur[1];
  const dSq = dx * dx + dy * dy;
  if (dSq < EPSILON || (maxDelta >= 0 && dSq <= maxDelta * maxDelta)) return [tgt[0], tgt[1]];
  const s = maxDelta / Math.sqrt(dSq);
  return [cur[0] + dx * s, cur[1] + dy * s];
};

// Comparison
export const vec2Equals = (a, b, eps = EPSILON) => Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;
export const vec2IsZero = (v, eps = EPSILON) => Math.abs(v[0]) < eps && Math.abs(v[1]) < eps;
export const vec2IsNormalized = (v, eps = EPSILON) => Math.abs(vec2LengthSq(v) - 1) < eps;
export const vec2IsFinite = (v) => Number.isFinite(v[0]) && Number.isFinite(v[1]);

// Random
export const vec2Random = (scale = 1) => {
  const a = random() * TAU;
  return [Math.cos(a) * scale, Math.sin(a) * scale];
};
export const vec2RandomInCircle = (r = 1) => {
  const rad = Math.sqrt(random()) * r;
  const a = random() * TAU;
  return [Math.cos(a) * rad, Math.sin(a) * rad];
};
export const vec2RandomInRect = (w, h) => [random() * w, random() * h];
export const vec2RandomInRectCentered = (w, h) => [(random() - 0.5) * w, (random() - 0.5) * h];

// Complex number operations (treating vec2 as complex)
export const vec2ComplexMul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
export const vec2ComplexDiv = (a, b) => {
  const d = b[0] * b[0] + b[1] * b[1];
  if (d < EPSILON) return [0, 0];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
export const vec2ComplexPow = (v, n) => {
  const r = vec2Length(v), theta = vec2Angle(v);
  const rn = Math.pow(r, n), nt = n * theta;
  return [rn * Math.cos(nt), rn * Math.sin(nt)];
};
export const vec2ComplexSqrt = (v) => vec2ComplexPow(v, 0.5);

// Transform by 2x2 matrix [a, b, c, d] column-major
export const vec2TransformMat2 = (v, m) => [m[0] * v[0] + m[2] * v[1], m[1] * v[0] + m[3] * v[1]];

// Transform by 3x3 matrix (with translation in last row)
export const vec2TransformMat3 = (v, m) => [
  m[0] * v[0] + m[3] * v[1] + m[6],
  m[1] * v[0] + m[4] * v[1] + m[7],
];

// Utility
export const vec2ToString = (v, precision = 3) => `(${v[0].toFixed(precision)}, ${v[1].toFixed(precision)})`;
export const vec2ToArray = (v, out = [], offset = 0) => { out[offset] = v[0]; out[offset + 1] = v[1]; return out; };
export const vec2GetComponent = (v, index) => v[index];
export const vec2SetComponent = (v, index, value) => { const out = vec2Clone(v); out[index] = value; return out; };

// ============================================================================
// DEEP AUDIT ADDITIONS — parity with MathVec3, Godot, Unity, WGSL
// ============================================================================

// Creation extras
export const vec2FromScalar = (s) => [s, s];
export const vec2Infinity = () => [Infinity, Infinity];
export const vec2NegInfinity = () => [-Infinity, -Infinity];

// Basic extras
export const vec2AddScalar = (v, s) => [v[0] + s, v[1] + s];
export const vec2SubScalar = (v, s) => [v[0] - s, v[1] - s];

// In-place extras
export const vec2MulInto = (out, a, b) => { out[0] = a[0] * b[0]; out[1] = a[1] * b[1]; return out; };
export const vec2NegateInto = (out, v) => { out[0] = -v[0]; out[1] = -v[1]; return out; };

// Length extras
export const vec2ManhattanLength = (v) => Math.abs(v[0]) + Math.abs(v[1]);

// Normalization extras
export const vec2SafeNormalize = (v, fallback = [0, 1]) => {
  const l = vec2Length(v);
  return l < EPSILON ? [...fallback] : [v[0] / l, v[1] / l];
};

// Interpolation extras
export const vec2LerpInto = (out, a, b, t) => { out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; return out; };
export const vec2LerpUnclamped = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const vec2LerpV = (a, b, t) => [a[0] + (b[0] - a[0]) * t[0], a[1] + (b[1] - a[1]) * t[1]];
export const vec2Hermite = (p0, t0, p1, t1, t) => {
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  return [p0[0]*h00+t0[0]*h10+p1[0]*h01+t1[0]*h11, p0[1]*h00+t0[1]*h10+p1[1]*h01+t1[1]*h11];
};
export const vec2CatmullRom = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return [
    0.5*((2*p1[0])+(-p0[0]+p2[0])*t+(2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2+(-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3),
    0.5*((2*p1[1])+(-p0[1]+p2[1])*t+(2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2+(-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3),
  ];
};
export const vec2BezierDerivative = (p0, p1, p2, p3, t) => {
  const mt = 1 - t;
  return [
    3*(mt*mt*(p1[0]-p0[0])+2*mt*t*(p2[0]-p1[0])+t*t*(p3[0]-p2[0])),
    3*(mt*mt*(p1[1]-p0[1])+2*mt*t*(p2[1]-p1[1])+t*t*(p3[1]-p2[1])),
  ];
};

// Direction and movement extras
export const vec2DirectionTo = (from, to) => vec2Normalize(vec2Sub(to, from));
export const vec2Midpoint = (a, b) => [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
export const vec2Slide = (v, n) => { const d = vec2Dot(v, n); return [v[0] - d * n[0], v[1] - d * n[1]]; };
export const vec2Bounce = (v, n) => { const d = 2 * vec2Dot(v, n); return [-v[0] + d * n[0], -v[1] + d * n[1]]; };

// Spring-damper smooth follow (Unity: SmoothDamp — 2D)
export function vec2SmoothDamp(current, target, currentVelocity, smoothTime, dt, maxSpeed = Infinity) {
  const st = Math.max(0.0001, smoothTime);
  const omega = 2 / st;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  let dx = current[0] - target[0], dy = current[1] - target[1];
  const maxChange = maxSpeed * st, maxChangeSq = maxChange * maxChange;
  const sqDist = dx * dx + dy * dy;
  if (sqDist > maxChangeSq) { const mag = Math.sqrt(sqDist); dx = dx / mag * maxChange; dy = dy / mag * maxChange; }
  const tx = (currentVelocity[0] + omega * dx) * dt;
  const ty = (currentVelocity[1] + omega * dy) * dt;
  const nvx = (currentVelocity[0] - omega * tx) * exp;
  const nvy = (currentVelocity[1] - omega * ty) * exp;
  let outX = (current[0] - dx) + (dx + tx) * exp;
  let outY = (current[1] - dy) + (dy + ty) * exp;
  if ((target[0]-current[0])*(outX-target[0])+(target[1]-current[1])*(outY-target[1]) > 0) {
    outX = target[0]; outY = target[1];
    return { value: [outX, outY], velocity: [(target[0]-outX)/dt, (target[1]-outY)/dt] };
  }
  return { value: [outX, outY], velocity: [nvx, nvy] };
}

// WGSL parity
export const vec2FaceForward = (v, incident, reference) =>
  vec2Dot(reference, incident) < 0 ? [v[0], v[1]] : [-v[0], -v[1]];
export function vec2Refract(incident, normal, eta) {
  const d = vec2Dot(normal, incident);
  const k = 1 - eta * eta * (1 - d * d);
  if (k < 0) return [0, 0];
  const f = eta * d + Math.sqrt(k);
  return [eta * incident[0] - f * normal[0], eta * incident[1] - f * normal[1]];
}
export const vec2Saturate = (v) => [clamp(v[0], 0, 1), clamp(v[1], 0, 1)];
export const vec2InverseSqrt = (v) => [1 / Math.sqrt(v[0]), 1 / Math.sqrt(v[1])];
export const vec2FMA = (a, b, c) => [a[0] * b[0] + c[0], a[1] * b[1] + c[1]];
export const vec2Step = (edge, v) => [v[0] < edge[0] ? 0 : 1, v[1] < edge[1] ? 0 : 1];
export const vec2StepScalar = (edge, v) => [v[0] < edge ? 0 : 1, v[1] < edge ? 0 : 1];
export const vec2SmoothStepV = (low, high, v) => [smoothstep(low[0], high[0], v[0]), smoothstep(low[1], high[1], v[1])];

// Godot parity
export const vec2PosMod = (v, m) => [mod(v[0], m), mod(v[1], m)];
export const vec2PosModV = (v, m) => [mod(v[0], m[0]), mod(v[1], m[1])];
export const vec2MinScalar = (v, s) => [Math.min(v[0], s), Math.min(v[1], s)];
export const vec2MaxScalar = (v, s) => [Math.max(v[0], s), Math.max(v[1], s)];

// Comparison extras
export const vec2ExactEquals = (a, b) => a[0] === b[0] && a[1] === b[1];
export const vec2IsNaN = (v) => Number.isNaN(v[0]) || Number.isNaN(v[1]);

// Component-wise
export const vec2MinComponent = (v) => Math.min(v[0], v[1]);
export const vec2MaxComponent = (v) => Math.max(v[0], v[1]);
export const vec2Sum = (v) => v[0] + v[1];
export const vec2Average = (v) => (v[0] + v[1]) / 2;
