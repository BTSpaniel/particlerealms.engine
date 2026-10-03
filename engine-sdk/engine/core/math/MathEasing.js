// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathEasing.js - Easing functions, Bezier curves, splines
// For animation, UI transitions, and procedural motion

import { PI, TAU } from './MathConstants.js';
import { clamp } from './MathScalar.js';

// ============================================================================
// STANDARD EASING FUNCTIONS (t in [0,1], output [0,1])
// ============================================================================

// Linear
export const easeLinear = (t) => t;

// Quadratic
export const easeInQuad = (t) => t * t;
export const easeOutQuad = (t) => t * (2 - t);
export const easeInOutQuad = (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

// Cubic
export const easeInCubic = (t) => t * t * t;
export const easeOutCubic = (t) => { const t1 = t - 1; return t1 * t1 * t1 + 1; };
export const easeInOutCubic = (t) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;

// Quartic
export const easeInQuart = (t) => t * t * t * t;
export const easeOutQuart = (t) => { const t1 = t - 1; return 1 - t1 * t1 * t1 * t1; };
export const easeInOutQuart = (t) => { const t1 = t - 1; return t < 0.5 ? 8 * t * t * t * t : 1 - 8 * t1 * t1 * t1 * t1; };

// Quintic
export const easeInQuint = (t) => t * t * t * t * t;
export const easeOutQuint = (t) => { const t1 = t - 1; return 1 + t1 * t1 * t1 * t1 * t1; };
export const easeInOutQuint = (t) => { const t1 = t - 1; return t < 0.5 ? 16 * t * t * t * t * t : 1 + 16 * t1 * t1 * t1 * t1 * t1; };

// Sine
export const easeInSine = (t) => 1 - Math.cos(t * PI / 2);
export const easeOutSine = (t) => Math.sin(t * PI / 2);
export const easeInOutSine = (t) => -(Math.cos(PI * t) - 1) / 2;

// Exponential
export const easeInExpo = (t) => t === 0 ? 0 : Math.pow(2, 10 * t - 10);
export const easeOutExpo = (t) => t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
export const easeInOutExpo = (t) => {
  if (t === 0) return 0;
  if (t === 1) return 1;
  return t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2;
};

// Circular
export const easeInCirc = (t) => 1 - Math.sqrt(1 - t * t);
export const easeOutCirc = (t) => Math.sqrt(1 - (t - 1) * (t - 1));
export const easeInOutCirc = (t) => t < 0.5
  ? (1 - Math.sqrt(1 - 4 * t * t)) / 2
  : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2;

// Elastic
export const easeInElastic = (t) => {
  if (t === 0 || t === 1) return t;
  return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * TAU / 3);
};
export const easeOutElastic = (t) => {
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * TAU / 3) + 1;
};
export const easeInOutElastic = (t) => {
  if (t === 0 || t === 1) return t;
  return t < 0.5
    ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * TAU / 4.5)) / 2
    : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * TAU / 4.5)) / 2 + 1;
};

// Back (overshoot)
const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;

export const easeInBack = (t) => c3 * t * t * t - c1 * t * t;
export const easeOutBack = (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
export const easeInOutBack = (t) => t < 0.5
  ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
  : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;

// Bounce
export function easeOutBounce(t) {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}
export const easeInBounce = (t) => 1 - easeOutBounce(1 - t);
export const easeInOutBounce = (t) => t < 0.5
  ? (1 - easeOutBounce(1 - 2 * t)) / 2
  : (1 + easeOutBounce(2 * t - 1)) / 2;

// Custom power easing
export const easeInPow = (t, p) => Math.pow(t, p);
export const easeOutPow = (t, p) => 1 - Math.pow(1 - t, p);
export const easeInOutPow = (t, p) => t < 0.5
  ? Math.pow(2, p - 1) * Math.pow(t, p)
  : 1 - Math.pow(-2 * t + 2, p) / 2;

// ============================================================================
// PHYSICS-BASED EASING
// ============================================================================

// Spring (critically/under/over damped)
export function easeSpring(t, mass = 1, stiffness = 100, damping = 10) {
  const omega = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 1) {
    // Underdamped (oscillates)
    const omegaD = omega * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * omega * t) * (Math.cos(omegaD * t) + (zeta * omega / omegaD) * Math.sin(omegaD * t));
  } else if (zeta === 1) {
    // Critically damped
    return 1 - (1 + omega * t) * Math.exp(-omega * t);
  } else {
    // Overdamped
    const s1 = omega * (-zeta + Math.sqrt(zeta * zeta - 1));
    const s2 = omega * (-zeta - Math.sqrt(zeta * zeta - 1));
    return 1 - (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s2 - s1);
  }
}

// Simple spring with configurable bounce
export function easeSpringSimple(t, bounces = 3, decay = 0.4) {
  const freq = bounces * PI;
  return 1 - Math.exp(-t * 5) * Math.cos(freq * t) * Math.pow(decay, t);
}

// ============================================================================
// BEZIER CURVES
// ============================================================================

// Quadratic Bezier
export const bezier2 = (p0, p1, p2, t) => {
  const mt = 1 - t;
  return p0 * mt * mt + 2 * p1 * mt * t + p2 * t * t;
};

export const bezier2Vec2 = (p0, p1, p2, t) => {
  const mt = 1 - t;
  return [
    p0[0] * mt * mt + 2 * p1[0] * mt * t + p2[0] * t * t,
    p0[1] * mt * mt + 2 * p1[1] * mt * t + p2[1] * t * t,
  ];
};

export const bezier2Vec3 = (p0, p1, p2, t) => {
  const mt = 1 - t;
  return [
    p0[0] * mt * mt + 2 * p1[0] * mt * t + p2[0] * t * t,
    p0[1] * mt * mt + 2 * p1[1] * mt * t + p2[1] * t * t,
    p0[2] * mt * mt + 2 * p1[2] * mt * t + p2[2] * t * t,
  ];
};

// Cubic Bezier
export const bezier3 = (p0, p1, p2, p3, t) => {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return p0 * mt2 * mt + 3 * p1 * mt2 * t + 3 * p2 * mt * t2 + p3 * t2 * t;
};

export const bezier3Vec2 = (p0, p1, p2, p3, t) => {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return [
    p0[0] * mt2 * mt + 3 * p1[0] * mt2 * t + 3 * p2[0] * mt * t2 + p3[0] * t2 * t,
    p0[1] * mt2 * mt + 3 * p1[1] * mt2 * t + 3 * p2[1] * mt * t2 + p3[1] * t2 * t,
  ];
};

export const bezier3Vec3 = (p0, p1, p2, p3, t) => {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return [
    p0[0] * mt2 * mt + 3 * p1[0] * mt2 * t + 3 * p2[0] * mt * t2 + p3[0] * t2 * t,
    p0[1] * mt2 * mt + 3 * p1[1] * mt2 * t + 3 * p2[1] * mt * t2 + p3[1] * t2 * t,
    p0[2] * mt2 * mt + 3 * p1[2] * mt2 * t + 3 * p2[2] * mt * t2 + p3[2] * t2 * t,
  ];
};

// Cubic Bezier derivative (velocity/tangent)
export const bezier3Derivative = (p0, p1, p2, p3, t) => {
  const mt = 1 - t;
  return 3 * mt * mt * (p1 - p0) + 6 * mt * t * (p2 - p1) + 3 * t * t * (p3 - p2);
};

export const bezier3DerivativeVec3 = (p0, p1, p2, p3, t) => {
  const mt = 1 - t;
  return [
    3 * mt * mt * (p1[0] - p0[0]) + 6 * mt * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]),
    3 * mt * mt * (p1[1] - p0[1]) + 6 * mt * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]),
    3 * mt * mt * (p1[2] - p0[2]) + 6 * mt * t * (p2[2] - p1[2]) + 3 * t * t * (p3[2] - p2[2]),
  ];
};

export const CSS_CUBIC_BEZIER_PRESETS = Object.freeze({
  ease: Object.freeze([0.25, 0.1, 0.25, 1]),
  'ease-in': Object.freeze([0.42, 0, 1, 1]),
  'ease-out': Object.freeze([0, 0, 0.58, 1]),
  'ease-in-out': Object.freeze([0.42, 0, 0.58, 1]),
});

export const CSS_STEP_POSITION_ALIASES = Object.freeze({
  start: 'jump-start',
  end: 'jump-end',
  'jump-start': 'jump-start',
  'jump-end': 'jump-end',
  'jump-none': 'jump-none',
  'jump-both': 'jump-both',
  'step-start': 'jump-start',
  'step-end': 'jump-end',
});

const CSS_NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const CSS_POSITIVE_INTEGER_RE = /^[+]?\d+$/;

function cssFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function parseCssNumberToken(value) {
  const text = String(value ?? '').trim();
  if (!CSS_NUMBER_RE.test(text)) return NaN;
  return cssFiniteNumber(text);
}

function parseCssPositiveIntegerToken(value) {
  const text = String(value ?? '').trim();
  if (!CSS_POSITIVE_INTEGER_RE.test(text)) return NaN;
  const number = Number(text);
  return Number.isSafeInteger(number) && number > 0 ? number : NaN;
}

function cssFunctionArgs(source, name) {
  const pattern = new RegExp(`^${name}\\((.*)\\)$`, 'i');
  const match = pattern.exec(source);
  return match ? match[1].split(',').map((part) => part.trim()) : null;
}

function normalizeCssStepPosition(position = 'end') {
  return CSS_STEP_POSITION_ALIASES[String(position ?? 'end').trim().toLowerCase()] || null;
}

function cssCubicBezierParseReport(args, source) {
  if (!args || args.length !== 4 || args.some((arg) => arg.length === 0)) {
    return { valid: false, type: 'cubic-bezier', source, reason: 'cubicBezierArity' };
  }
  const [x1, y1, x2, y2] = args.map(parseCssNumberToken);
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    return { valid: false, type: 'cubic-bezier', source, reason: 'cubicBezierNonFinite' };
  }
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
    return { valid: false, type: 'cubic-bezier', source, reason: 'cubicBezierXOutOfRange', x1, y1, x2, y2 };
  }
  return {
    valid: true,
    type: 'cubic-bezier',
    source,
    x1,
    y1,
    x2,
    y2,
    serialization: `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`,
  };
}

function cssStepsParseReport(args, source) {
  if (!args || args.length < 1 || args.length > 2 || args.some((arg) => arg.length === 0)) {
    return { valid: false, type: 'steps', source, reason: 'stepsArity' };
  }
  const steps = parseCssPositiveIntegerToken(args[0]);
  if (!Number.isFinite(steps)) {
    return { valid: false, type: 'steps', source, reason: 'stepsCountInvalid' };
  }
  const position = String(args[1] ?? 'end').trim().toLowerCase() || 'end';
  const jumpPosition = normalizeCssStepPosition(position);
  if (!jumpPosition) {
    return { valid: false, type: 'steps', source, reason: 'stepsPositionInvalid', steps, position };
  }
  if (jumpPosition === 'jump-none' && steps <= 1) {
    return { valid: false, type: 'steps', source, reason: 'stepsJumpNoneNeedsMoreThanOneStep', steps, position, jumpPosition };
  }
  return {
    valid: true,
    type: 'steps',
    source,
    steps,
    position,
    jumpPosition,
    serialization: args.length === 1 ? `steps(${steps})` : `steps(${steps}, ${position})`,
  };
}

function cssCubicBezierEndpointExtension(x1, y1, x2, y2, progress) {
  if (progress < 0) {
    if (x1 > 0) return progress * (y1 / x1);
    if (x2 > 0) return progress * (y2 / x2);
    return 0;
  }
  if (progress > 1) {
    if (x2 < 1) return 1 + (progress - 1) * ((1 - y2) / (1 - x2));
    if (x1 < 1) return 1 + (progress - 1) * ((1 - y1) / (1 - x1));
    return 1;
  }
  return null;
}

function cssCubicBezierParameterForX(x1, x2, progress) {
  let guess = clamp(progress, 0, 1);
  let lower = 0;
  let upper = 1;

  for (let i = 0; i < 8; i++) {
    const x = bezier3(0, x1, x2, 1, guess) - progress;
    if (Math.abs(x) < 0.000001) return guess;
    if (x > 0) upper = guess;
    else lower = guess;

    const dx = bezier3Derivative(0, x1, x2, 1, guess);
    if (Math.abs(dx) < 0.000001) break;

    const next = guess - x / dx;
    if (next <= lower || next >= upper || !Number.isFinite(next)) break;
    guess = next;
  }

  for (let i = 0; i < 20; i++) {
    guess = (lower + upper) * 0.5;
    const x = bezier3(0, x1, x2, 1, guess);
    if (Math.abs(x - progress) < 0.000001) break;
    if (x < progress) lower = guess;
    else upper = guess;
  }

  return clamp(guess, 0, 1);
}

export function cssCubicBezierValue(x1, y1, x2, y2, progress) {
  const points = [x1, y1, x2, y2].map(cssFiniteNumber);
  const input = cssFiniteNumber(progress);
  if (!points.every(Number.isFinite) || !Number.isFinite(input)) return NaN;

  const [cx1, cy1, cx2, cy2] = points;
  if (cx1 < 0 || cx1 > 1 || cx2 < 0 || cx2 > 1) return NaN;

  const extended = cssCubicBezierEndpointExtension(cx1, cy1, cx2, cy2, input);
  if (extended !== null) return extended;

  const parameter = cssCubicBezierParameterForX(cx1, cx2, input);
  return bezier3(0, cy1, cy2, 1, parameter);
}

export function cssStepEasing(progress, steps = 1, position = 'end', options = {}) {
  const input = cssFiniteNumber(progress);
  const stepCount = cssFiniteNumber(steps);
  const jumpPosition = normalizeCssStepPosition(position);
  if (!Number.isFinite(input) || !Number.isSafeInteger(stepCount) || stepCount < 1 || !jumpPosition) return NaN;
  if (jumpPosition === 'jump-none' && stepCount <= 1) return NaN;

  let currentStep = Math.floor(input * stepCount);
  if (jumpPosition === 'jump-start' || jumpPosition === 'jump-both') currentStep += 1;
  if (options?.before === true && Number.isInteger(input * stepCount)) currentStep -= 1;

  let jumps = stepCount;
  if (jumpPosition === 'jump-none') jumps -= 1;
  else if (jumpPosition === 'jump-both') jumps += 1;

  if (input >= 0 && currentStep < 0) currentStep = 0;
  if (input <= 1 && currentStep > jumps) currentStep = jumps;

  return currentStep / jumps;
}

export function cssEasingParseReport(easing) {
  const source = String(easing ?? '').trim().toLowerCase();
  if (!source) return { valid: false, source, reason: 'emptyEasing' };

  if (source === 'linear') {
    return { valid: true, type: 'linear', source, serialization: 'linear' };
  }

  const preset = CSS_CUBIC_BEZIER_PRESETS[source];
  if (preset) {
    const [x1, y1, x2, y2] = preset;
    return { valid: true, type: 'cubic-bezier', source, keyword: source, x1, y1, x2, y2, serialization: source };
  }

  if (source === 'step-start' || source === 'step-end') {
    const position = source === 'step-start' ? 'start' : 'end';
    return {
      valid: true,
      type: 'steps',
      source,
      keyword: source,
      steps: 1,
      position,
      jumpPosition: normalizeCssStepPosition(position),
      serialization: source,
    };
  }

  if (source.startsWith('cubic-bezier(')) return cssCubicBezierParseReport(cssFunctionArgs(source, 'cubic-bezier'), source);
  if (source.startsWith('steps(')) return cssStepsParseReport(cssFunctionArgs(source, 'steps'), source);

  return { valid: false, source, reason: 'unsupportedEasing' };
}

export function cssEasingReport(easing, progress, options = {}) {
  const parsed = cssEasingParseReport(easing);
  const input = cssFiniteNumber(progress);
  const before = options?.before === true;
  const fallbackValue = Number.isFinite(options?.fallbackValue) ? options.fallbackValue : input;
  if (!Number.isFinite(input)) return { ...parsed, progress: input, before, value: NaN, reason: parsed.reason || 'nonFiniteProgress' };
  if (!parsed.valid) return { ...parsed, progress: input, before, value: fallbackValue };

  if (parsed.type === 'linear') return { ...parsed, progress: input, before, value: input };
  if (parsed.type === 'cubic-bezier') {
    return { ...parsed, progress: input, before, value: cssCubicBezierValue(parsed.x1, parsed.y1, parsed.x2, parsed.y2, input) };
  }
  if (parsed.type === 'steps') {
    return { ...parsed, progress: input, before, value: cssStepEasing(input, parsed.steps, parsed.jumpPosition, { before }) };
  }

  return { ...parsed, progress: input, before, value: fallbackValue };
}

export function cssEasingValue(easing, progress, options = {}) {
  return cssEasingReport(easing, progress, options).value;
}

// CSS cubic-bezier easing (like CSS transitions)
export function cubicBezierEasing(x1, y1, x2, y2) {
  return function(t) {
    return cssCubicBezierValue(x1, y1, x2, y2, t);
  };
}

// Common CSS easing presets
export const cssEase = cubicBezierEasing(0.25, 0.1, 0.25, 1);
export const cssEaseIn = cubicBezierEasing(0.42, 0, 1, 1);
export const cssEaseOut = cubicBezierEasing(0, 0, 0.58, 1);
export const cssEaseInOut = cubicBezierEasing(0.42, 0, 0.58, 1);

// ============================================================================
// CATMULL-ROM SPLINES
// ============================================================================

export function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

export const catmullRomVec3 = (p0, p1, p2, p3, t) => [
  catmullRom(p0[0], p1[0], p2[0], p3[0], t),
  catmullRom(p0[1], p1[1], p2[1], p3[1], t),
  catmullRom(p0[2], p1[2], p2[2], p3[2], t),
];

// Catmull-Rom spline through array of points
export function catmullRomSpline(points, t, closed = false) {
  const n = points.length;
  if (n < 2) return points[0] || [0, 0, 0];

  const totalT = t * (closed ? n : n - 1);
  const i = Math.floor(totalT);
  const localT = totalT - i;

  const getPoint = (idx) => {
    if (closed) return points[((idx % n) + n) % n];
    return points[clamp(idx, 0, n - 1)];
  };

  return catmullRomVec3(
    getPoint(i - 1),
    getPoint(i),
    getPoint(i + 1),
    getPoint(i + 2),
    localT
  );
}

// ============================================================================
// HERMITE INTERPOLATION
// ============================================================================

export function hermite(p0, m0, p1, m1, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
}

export const hermiteVec3 = (p0, m0, p1, m1, t) => [
  hermite(p0[0], m0[0], p1[0], m1[0], t),
  hermite(p0[1], m0[1], p1[1], m1[1], t),
  hermite(p0[2], m0[2], p1[2], m1[2], t),
];

// ============================================================================
// B-SPLINES
// ============================================================================

function bsplineBasis(i, k, t, knots) {
  if (k === 1) {
    return (t >= knots[i] && t < knots[i + 1]) ? 1 : 0;
  }

  const d1 = knots[i + k - 1] - knots[i];
  const d2 = knots[i + k] - knots[i + 1];

  let c1 = 0, c2 = 0;
  if (d1 !== 0) c1 = ((t - knots[i]) / d1) * bsplineBasis(i, k - 1, t, knots);
  if (d2 !== 0) c2 = ((knots[i + k] - t) / d2) * bsplineBasis(i + 1, k - 1, t, knots);

  return c1 + c2;
}

export function bspline(points, t, degree = 3) {
  const n = points.length;
  const k = degree + 1;

  // Generate uniform knot vector
  const knots = [];
  for (let i = 0; i < n + k; i++) {
    knots.push(i);
  }

  const tMapped = t * (n - k + 1) + k - 1;

  let result = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const basis = bsplineBasis(i, k, tMapped, knots);
    result[0] += points[i][0] * basis;
    result[1] += points[i][1] * basis;
    result[2] += points[i][2] * basis;
  }

  return result;
}

// ============================================================================
// ARC LENGTH PARAMETERIZATION
// ============================================================================

export function computeArcLengthTable(curveFn, segments = 100) {
  const table = [{ t: 0, length: 0 }];
  let totalLength = 0;
  let prevPoint = curveFn(0);

  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const point = curveFn(t);
    const dx = point[0] - prevPoint[0];
    const dy = point[1] - prevPoint[1];
    const dz = point[2] !== undefined ? point[2] - prevPoint[2] : 0;
    totalLength += Math.sqrt(dx * dx + dy * dy + dz * dz);
    table.push({ t, length: totalLength });
    prevPoint = point;
  }

  return { table, totalLength };
}

export function getUniformT(arcTable, u) {
  const targetLength = u * arcTable.totalLength;
  const table = arcTable.table;

  // Binary search
  let low = 0, high = table.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (table[mid].length < targetLength) low = mid + 1;
    else high = mid;
  }

  if (low === 0) return 0;

  const prev = table[low - 1];
  const curr = table[low];
  const segmentLength = curr.length - prev.length;
  if (segmentLength < 0.0001) return curr.t;

  const segmentT = (targetLength - prev.length) / segmentLength;
  return prev.t + segmentT * (curr.t - prev.t);
}

// ============================================================================
// EASING LOOKUP BY NAME
// ============================================================================

export const EASING_FUNCTIONS = {
  linear: easeLinear,
  inQuad: easeInQuad, outQuad: easeOutQuad, inOutQuad: easeInOutQuad,
  inCubic: easeInCubic, outCubic: easeOutCubic, inOutCubic: easeInOutCubic,
  inQuart: easeInQuart, outQuart: easeOutQuart, inOutQuart: easeInOutQuart,
  inQuint: easeInQuint, outQuint: easeOutQuint, inOutQuint: easeInOutQuint,
  inSine: easeInSine, outSine: easeOutSine, inOutSine: easeInOutSine,
  inExpo: easeInExpo, outExpo: easeOutExpo, inOutExpo: easeInOutExpo,
  inCirc: easeInCirc, outCirc: easeOutCirc, inOutCirc: easeInOutCirc,
  inElastic: easeInElastic, outElastic: easeOutElastic, inOutElastic: easeInOutElastic,
  inBack: easeInBack, outBack: easeOutBack, inOutBack: easeInOutBack,
  inBounce: easeInBounce, outBounce: easeOutBounce, inOutBounce: easeInOutBounce,
};

export const getEasing = (name) => EASING_FUNCTIONS[name] || easeLinear;
