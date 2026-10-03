// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathVec4.js - 4D Vector operations (general purpose, not quaternion-specific)
// Depends on: MathConstants.js, MathScalar.js

import { EPSILON } from './MathConstants.js';
import { random } from './MathRandom.js';
import { clamp, fract, mod, sign, smoothstep } from './MathScalar.js';

// Creation
export const vec4 = (x = 0, y = 0, z = 0, w = 1) => [x, y, z, w];
export const vec4FromVec3 = (v, w = 1) => [v[0], v[1], v[2], w];
export const vec4FromVec2 = (v, z = 0, w = 1) => [v[0], v[1], z, w];
export const vec4FromArray = (arr, offset = 0) => [arr[offset], arr[offset + 1], arr[offset + 2], arr[offset + 3]];
export const vec4Zero = () => [0, 0, 0, 0];
export const vec4One = () => [1, 1, 1, 1];
export const vec4Clone = (v) => [v[0], v[1], v[2], v[3]];
export const vec4Copy = (out, v) => { out[0] = v[0]; out[1] = v[1]; out[2] = v[2]; out[3] = v[3]; return out; };
export const vec4Set = (out, x, y, z, w) => { out[0] = x; out[1] = y; out[2] = z; out[3] = w; return out; };

// Extract components
export const vec4ToVec3 = (v) => [v[0], v[1], v[2]];
export const vec4ToVec2 = (v) => [v[0], v[1]];
export const vec4XYZ = (v) => [v[0], v[1], v[2]];
export const vec4XY = (v) => [v[0], v[1]];

// Basic operations
export const vec4Add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
export const vec4Sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]];
export const vec4Mul = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2], a[3] * b[3]];
export const vec4Div = (a, b) => [a[0] / b[0], a[1] / b[1], a[2] / b[2], a[3] / b[3]];
export const vec4Scale = (v, s) => [v[0] * s, v[1] * s, v[2] * s, v[3] * s];
export const vec4Negate = (v) => [-v[0], -v[1], -v[2], -v[3]];
export const vec4Inverse = (v) => [1 / v[0], 1 / v[1], 1 / v[2], 1 / v[3]];

// In-place operations
export const vec4AddInto = (out, a, b) => { out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; out[2] = a[2] + b[2]; out[3] = a[3] + b[3]; return out; };
export const vec4SubInto = (out, a, b) => { out[0] = a[0] - b[0]; out[1] = a[1] - b[1]; out[2] = a[2] - b[2]; out[3] = a[3] - b[3]; return out; };
export const vec4ScaleInto = (out, v, s) => { out[0] = v[0] * s; out[1] = v[1] * s; out[2] = v[2] * s; out[3] = v[3] * s; return out; };
export const vec4ScaleAndAdd = (out, a, b, s) => { out[0] = a[0] + b[0] * s; out[1] = a[1] + b[1] * s; out[2] = a[2] + b[2] * s; out[3] = a[3] + b[3] * s; return out; };

// Products
export const vec4Dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

// Length
export const vec4LengthSq = (v) => v[0] * v[0] + v[1] * v[1] + v[2] * v[2] + v[3] * v[3];
export const vec4Length = (v) => Math.sqrt(vec4LengthSq(v));
export const vec4DistanceSq = (a, b) => (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2 + (b[3] - a[3]) ** 2;
export const vec4Distance = (a, b) => Math.sqrt(vec4DistanceSq(a, b));

// Normalization
export const vec4Normalize = (v) => {
  const l = vec4Length(v);
  return l < EPSILON ? [0, 0, 0, 0] : [v[0] / l, v[1] / l, v[2] / l, v[3] / l];
};
export const vec4NormalizeInto = (out, v) => {
  const l = vec4Length(v);
  if (l < EPSILON) { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0; }
  else { out[0] = v[0] / l; out[1] = v[1] / l; out[2] = v[2] / l; out[3] = v[3] / l; }
  return out;
};

// Interpolation
export const vec4Lerp = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
  a[3] + (b[3] - a[3]) * t,
];

// Min/max/clamp
export const vec4Min = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
export const vec4Max = (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
export const vec4Clamp = (v, min, max) => [
  clamp(v[0], min[0], max[0]),
  clamp(v[1], min[1], max[1]),
  clamp(v[2], min[2], max[2]),
  clamp(v[3], min[3], max[3]),
];
export const vec4ClampScalar = (v, min, max) => [
  clamp(v[0], min, max),
  clamp(v[1], min, max),
  clamp(v[2], min, max),
  clamp(v[3], min, max),
];

// Rounding
export const vec4Floor = (v) => [Math.floor(v[0]), Math.floor(v[1]), Math.floor(v[2]), Math.floor(v[3])];
export const vec4Ceil = (v) => [Math.ceil(v[0]), Math.ceil(v[1]), Math.ceil(v[2]), Math.ceil(v[3])];
export const vec4Round = (v) => [Math.round(v[0]), Math.round(v[1]), Math.round(v[2]), Math.round(v[3])];
export const vec4Abs = (v) => [Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2]), Math.abs(v[3])];

// Perspective divide (for clip space to NDC)
export const vec4PerspectiveDivide = (v) => {
  if (Math.abs(v[3]) < EPSILON) return [0, 0, 0, 0];
  const inv = 1 / v[3];
  return [v[0] * inv, v[1] * inv, v[2] * inv, 1];
};

// Transform by 4x4 matrix
export const vec4TransformMat4 = (v, m) => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
  m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
];
export const vec4TransformMat4Into = (out, v, m) => {
  const x = v[0], y = v[1], z = v[2], w = v[3];
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
  out[3] = m[3] * x + m[7] * y + m[11] * z + m[15] * w;
  return out;
};

// Comparison
export const vec4Equals = (a, b, eps = EPSILON) =>
  Math.abs(a[0] - b[0]) < eps &&
  Math.abs(a[1] - b[1]) < eps &&
  Math.abs(a[2] - b[2]) < eps &&
  Math.abs(a[3] - b[3]) < eps;
export const vec4IsZero = (v, eps = EPSILON) =>
  Math.abs(v[0]) < eps && Math.abs(v[1]) < eps && Math.abs(v[2]) < eps && Math.abs(v[3]) < eps;
export const vec4IsFinite = (v) =>
  Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]) && Number.isFinite(v[3]);

// Color operations (RGBA)
export const vec4FromRGBA = (r, g, b, a = 1) => [r / 255, g / 255, b / 255, a];
export const vec4ToRGBA = (v) => [Math.round(v[0] * 255), Math.round(v[1] * 255), Math.round(v[2] * 255), v[3]];
export const vec4FromHex = (hex) => {
  const r = ((hex >> 24) & 0xff) / 255;
  const g = ((hex >> 16) & 0xff) / 255;
  const b = ((hex >> 8) & 0xff) / 255;
  const a = (hex & 0xff) / 255;
  return [r, g, b, a];
};
export const vec4ToHex = (v) => {
  const r = Math.round(v[0] * 255) & 0xff;
  const g = Math.round(v[1] * 255) & 0xff;
  const b = Math.round(v[2] * 255) & 0xff;
  const a = Math.round(v[3] * 255) & 0xff;
  return (r << 24) | (g << 16) | (b << 8) | a;
};
export const vec4Premultiply = (v) => [v[0] * v[3], v[1] * v[3], v[2] * v[3], v[3]];
export const vec4Unpremultiply = (v) => {
  if (v[3] < EPSILON) return [0, 0, 0, 0];
  const inv = 1 / v[3];
  return [v[0] * inv, v[1] * inv, v[2] * inv, v[3]];
};

// Random
export const vec4Random = () => [random(), random(), random(), random()];
export const vec4RandomUnit = () => vec4Normalize([
  random() * 2 - 1,
  random() * 2 - 1,
  random() * 2 - 1,
  random() * 2 - 1,
]);

// Utility
export const vec4ToString = (v, precision = 3) =>
  `(${v[0].toFixed(precision)}, ${v[1].toFixed(precision)}, ${v[2].toFixed(precision)}, ${v[3].toFixed(precision)})`;
export const vec4ToArray = (v, out = [], offset = 0) => {
  out[offset] = v[0]; out[offset + 1] = v[1]; out[offset + 2] = v[2]; out[offset + 3] = v[3];
  return out;
};
export const vec4GetComponent = (v, index) => v[index];
export const vec4SetComponent = (v, index, value) => { const out = vec4Clone(v); out[index] = value; return out; };

// ============================================================================
// DEEP AUDIT ADDITIONS — parity with MathVec3, Godot, Unity, WGSL
// ============================================================================

// Creation extras
export const vec4FromScalar = (s) => [s, s, s, s];
export const vec4Infinity = () => [Infinity, Infinity, Infinity, Infinity];
export const vec4NegInfinity = () => [-Infinity, -Infinity, -Infinity, -Infinity];

// Basic extras
export const vec4AddScalar = (v, s) => [v[0] + s, v[1] + s, v[2] + s, v[3] + s];
export const vec4SubScalar = (v, s) => [v[0] - s, v[1] - s, v[2] - s, v[3] - s];

// In-place extras
export const vec4MulInto = (out, a, b) => { out[0] = a[0]*b[0]; out[1] = a[1]*b[1]; out[2] = a[2]*b[2]; out[3] = a[3]*b[3]; return out; };
export const vec4NegateInto = (out, v) => { out[0] = -v[0]; out[1] = -v[1]; out[2] = -v[2]; out[3] = -v[3]; return out; };

// Length/distance extras
export const vec4Manhattan = (a, b) => Math.abs(b[0]-a[0])+Math.abs(b[1]-a[1])+Math.abs(b[2]-a[2])+Math.abs(b[3]-a[3]);
export const vec4Chebyshev = (a, b) => Math.max(Math.abs(b[0]-a[0]),Math.abs(b[1]-a[1]),Math.abs(b[2]-a[2]),Math.abs(b[3]-a[3]));
export const vec4ManhattanLength = (v) => Math.abs(v[0])+Math.abs(v[1])+Math.abs(v[2])+Math.abs(v[3]);

// Normalization extras
export const vec4SetLength = (v, len) => { const l = vec4Length(v); return l < EPSILON ? [0,0,0,0] : vec4Scale(v, len/l); };
export const vec4ClampLength = (v, min, max) => { const l = vec4Length(v); return l < EPSILON ? [0,0,0,0] : vec4Scale(v, clamp(l,min,max)/l); };
export const vec4Limit = (v, maxLen) => { const l = vec4Length(v); return l > maxLen ? vec4Scale(v, maxLen/l) : vec4Clone(v); };
export const vec4SafeNormalize = (v, fallback = [0,0,0,1]) => { const l = vec4Length(v); return l < EPSILON ? [...fallback] : [v[0]/l,v[1]/l,v[2]/l,v[3]/l]; };

// Interpolation extras
export const vec4LerpInto = (out, a, b, t) => { out[0]=a[0]+(b[0]-a[0])*t; out[1]=a[1]+(b[1]-a[1])*t; out[2]=a[2]+(b[2]-a[2])*t; out[3]=a[3]+(b[3]-a[3])*t; return out; };
export const vec4LerpUnclamped = (a, b, t) => [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t, a[3]+(b[3]-a[3])*t];
export const vec4LerpV = (a, b, t) => [a[0]+(b[0]-a[0])*t[0], a[1]+(b[1]-a[1])*t[1], a[2]+(b[2]-a[2])*t[2], a[3]+(b[3]-a[3])*t[3]];
export const vec4SmoothStep = (a, b, t) => vec4Lerp(a, b, smoothstep(0, 1, t));
export const vec4Midpoint = (a, b) => [(a[0]+b[0])*0.5, (a[1]+b[1])*0.5, (a[2]+b[2])*0.5, (a[3]+b[3])*0.5];

// Rounding extras
export const vec4Trunc = (v) => [Math.trunc(v[0]), Math.trunc(v[1]), Math.trunc(v[2]), Math.trunc(v[3])];
export const vec4Fract = (v) => [fract(v[0]), fract(v[1]), fract(v[2]), fract(v[3])];
export const vec4Sign = (v) => [sign(v[0]), sign(v[1]), sign(v[2]), sign(v[3])];
export const vec4Snap = (v, step) => [Math.round(v[0]/step)*step, Math.round(v[1]/step)*step, Math.round(v[2]/step)*step, Math.round(v[3]/step)*step];
export const vec4SnapV = (v, step) => [Math.round(v[0]/step[0])*step[0], Math.round(v[1]/step[1])*step[1], Math.round(v[2]/step[2])*step[2], Math.round(v[3]/step[3])*step[3]];

// WGSL parity
export const vec4Saturate = (v) => [clamp(v[0],0,1), clamp(v[1],0,1), clamp(v[2],0,1), clamp(v[3],0,1)];
export const vec4InverseSqrt = (v) => [1/Math.sqrt(v[0]), 1/Math.sqrt(v[1]), 1/Math.sqrt(v[2]), 1/Math.sqrt(v[3])];
export const vec4FMA = (a, b, c) => [a[0]*b[0]+c[0], a[1]*b[1]+c[1], a[2]*b[2]+c[2], a[3]*b[3]+c[3]];
export const vec4Step = (edge, v) => [v[0]<edge[0]?0:1, v[1]<edge[1]?0:1, v[2]<edge[2]?0:1, v[3]<edge[3]?0:1];
export const vec4StepScalar = (edge, v) => [v[0]<edge?0:1, v[1]<edge?0:1, v[2]<edge?0:1, v[3]<edge?0:1];
export const vec4SmoothStepV = (low, high, v) => [smoothstep(low[0],high[0],v[0]), smoothstep(low[1],high[1],v[1]), smoothstep(low[2],high[2],v[2]), smoothstep(low[3],high[3],v[3])];

// Godot parity
export const vec4PosMod = (v, m) => [mod(v[0],m), mod(v[1],m), mod(v[2],m), mod(v[3],m)];
export const vec4PosModV = (v, m) => [mod(v[0],m[0]), mod(v[1],m[1]), mod(v[2],m[2]), mod(v[3],m[3])];
export const vec4MinScalar = (v, s) => [Math.min(v[0],s), Math.min(v[1],s), Math.min(v[2],s), Math.min(v[3],s)];
export const vec4MaxScalar = (v, s) => [Math.max(v[0],s), Math.max(v[1],s), Math.max(v[2],s), Math.max(v[3],s)];
export const vec4DirectionTo = (from, to) => vec4Normalize(vec4Sub(to, from));

// Comparison extras
export const vec4ExactEquals = (a, b) => a[0]===b[0] && a[1]===b[1] && a[2]===b[2] && a[3]===b[3];
export const vec4IsNormalized = (v, eps = EPSILON) => Math.abs(vec4LengthSq(v) - 1) < eps;
export const vec4IsNaN = (v) => Number.isNaN(v[0]) || Number.isNaN(v[1]) || Number.isNaN(v[2]) || Number.isNaN(v[3]);

// Component-wise
export const vec4MinComponent = (v) => Math.min(v[0], v[1], v[2], v[3]);
export const vec4MaxComponent = (v) => Math.max(v[0], v[1], v[2], v[3]);
export const vec4Sum = (v) => v[0] + v[1] + v[2] + v[3];
export const vec4Average = (v) => (v[0] + v[1] + v[2] + v[3]) / 4;
