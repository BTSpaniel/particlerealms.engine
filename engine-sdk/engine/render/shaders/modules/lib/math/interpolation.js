// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Interpolation Functions
 * 
 * Various interpolation curves and easing functions.
 */

export const interpolationWGSL = /* wgsl */`
// ============================================================================
// INTERPOLATION - Easing and interpolation curves
// ============================================================================

// Smoothstep (cubic hermite)
fn smoothstepCubic(edge0: f32, edge1: f32, x: f32) -> f32 {
  let t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// Smootherstep (quintic)
fn smootherstep(edge0: f32, edge1: f32, x: f32) -> f32 {
  let t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

// Ease in quad
fn easeInQuad(t: f32) -> f32 {
  return t * t;
}

// Ease out quad
fn easeOutQuad(t: f32) -> f32 {
  return t * (2.0 - t);
}

// Ease in-out quad
fn easeInOutQuad(t: f32) -> f32 {
  return select(2.0 * t * t, 1.0 - pow(-2.0 * t + 2.0, 2.0) / 2.0, t < 0.5);
}

// Ease in cubic
fn easeInCubic(t: f32) -> f32 {
  return t * t * t;
}

// Ease out cubic
fn easeOutCubic(t: f32) -> f32 {
  let u = 1.0 - t;
  return 1.0 - u * u * u;
}

// Ease in-out cubic
fn easeInOutCubic(t: f32) -> f32 {
  return select(4.0 * t * t * t, 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0, t < 0.5);
}

// Exponential ease in
fn easeInExpo(t: f32) -> f32 {
  return select(pow(2.0, 10.0 * t - 10.0), 0.0, t == 0.0);
}

// Exponential ease out
fn easeOutExpo(t: f32) -> f32 {
  return select(1.0 - pow(2.0, -10.0 * t), 1.0, t == 1.0);
}

// Elastic ease out
fn easeOutElastic(t: f32) -> f32 {
  let c4 = (2.0 * 3.14159265) / 3.0;
  return select(pow(2.0, -10.0 * t) * sin((t * 10.0 - 0.75) * c4) + 1.0, 1.0, t == 0.0 || t == 1.0);
}

// Bounce ease out
fn easeOutBounce(t: f32) -> f32 {
  let n1 = 7.5625;
  let d1 = 2.75;
  var x = t;
  
  if (x < 1.0 / d1) {
    return n1 * x * x;
  } else if (x < 2.0 / d1) {
    x = x - 1.5 / d1;
    return n1 * x * x + 0.75;
  } else if (x < 2.5 / d1) {
    x = x - 2.25 / d1;
    return n1 * x * x + 0.9375;
  } else {
    x = x - 2.625 / d1;
    return n1 * x * x + 0.984375;
  }
}

// Remap value from one range to another
fn remap(value: f32, fromMin: f32, fromMax: f32, toMin: f32, toMax: f32) -> f32 {
  let t = (value - fromMin) / (fromMax - fromMin);
  return toMin + t * (toMax - toMin);
}

// Remap with clamping
fn remapClamped(value: f32, fromMin: f32, fromMax: f32, toMin: f32, toMax: f32) -> f32 {
  let t = clamp((value - fromMin) / (fromMax - fromMin), 0.0, 1.0);
  return toMin + t * (toMax - toMin);
}
`;
