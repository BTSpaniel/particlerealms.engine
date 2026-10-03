// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Shared alpha compositing, separable blend, coverage, and ordered-dither helpers for WGSL.
 */

export const blendMathWGSL = /* wgsl */`
const BLEND_BAYER_4X4 : array<u32, 16> = array<u32, 16>(
  0u, 8u, 2u, 10u,
  12u, 4u, 14u, 6u,
  3u, 11u, 1u, 9u,
  15u, 7u, 13u, 5u
);

fn blendSaturate(value : f32) -> f32 {
  return clamp(value, 0.0, 1.0);
}

fn blendStraightRgba(color : vec4<f32>, opacity : f32) -> vec4<f32> {
  return vec4<f32>(
    clamp(color.rgb, vec3<f32>(0.0), vec3<f32>(1.0)),
    blendSaturate(color.a * blendSaturate(opacity))
  );
}

fn blendPremultiplyAlpha(color : vec4<f32>, opacity : f32) -> vec4<f32> {
  let c = blendStraightRgba(color, opacity);
  return vec4<f32>(c.rgb * c.a, c.a);
}

fn blendUnpremultiplyAlpha(color : vec4<f32>) -> vec4<f32> {
  let a = blendSaturate(color.a);
  if (a <= 0.0) {
    return vec4<f32>(0.0);
  }
  return vec4<f32>(clamp(color.rgb / a, vec3<f32>(0.0), vec3<f32>(1.0)), a);
}

fn blendAlphaSourceOver(backdrop : vec4<f32>, source : vec4<f32>, opacity : f32) -> vec4<f32> {
  let cb = blendStraightRgba(backdrop, 1.0);
  let cs = blendStraightRgba(source, opacity);
  let outA = cs.a + cb.a * (1.0 - cs.a);
  if (outA <= 0.0) {
    return vec4<f32>(0.0);
  }
  let rgb = (cs.rgb * cs.a + cb.rgb * cb.a * (1.0 - cs.a)) / outA;
  return vec4<f32>(rgb, outA);
}

fn blendPremultipliedSourceOver(backdrop : vec4<f32>, source : vec4<f32>, opacity : f32) -> vec4<f32> {
  let sourceOpacity = blendSaturate(opacity);
  let csA = blendSaturate(source.a) * sourceOpacity;
  let cbA = blendSaturate(backdrop.a);
  return vec4<f32>(
    clamp(source.rgb * sourceOpacity + backdrop.rgb * (1.0 - csA), vec3<f32>(0.0), vec3<f32>(1.0)),
    blendSaturate(csA + cbA * (1.0 - csA))
  );
}

fn blendNormalChannel(_cb : f32, cs : f32) -> f32 {
  return blendSaturate(cs);
}

fn blendMultiplyChannel(cb : f32, cs : f32) -> f32 {
  return blendSaturate(cb) * blendSaturate(cs);
}

fn blendScreenChannel(cb : f32, cs : f32) -> f32 {
  let b = blendSaturate(cb);
  let s = blendSaturate(cs);
  return b + s - b * s;
}

fn blendOverlayChannel(cb : f32, cs : f32) -> f32 {
  let b = blendSaturate(cb);
  let s = blendSaturate(cs);
  if (b <= 0.5) {
    return 2.0 * b * s;
  }
  return 1.0 - 2.0 * (1.0 - b) * (1.0 - s);
}

fn blendDarkenChannel(cb : f32, cs : f32) -> f32 {
  return min(blendSaturate(cb), blendSaturate(cs));
}

fn blendLightenChannel(cb : f32, cs : f32) -> f32 {
  return max(blendSaturate(cb), blendSaturate(cs));
}

fn blendColorDodgeChannel(cb : f32, cs : f32) -> f32 {
  let b = blendSaturate(cb);
  let s = blendSaturate(cs);
  if (b <= 0.0) {
    return 0.0;
  }
  if (s >= 1.0) {
    return 1.0;
  }
  return min(1.0, b / (1.0 - s));
}

fn blendColorBurnChannel(cb : f32, cs : f32) -> f32 {
  let b = blendSaturate(cb);
  let s = blendSaturate(cs);
  if (b >= 1.0) {
    return 1.0;
  }
  if (s <= 0.0) {
    return 0.0;
  }
  return 1.0 - min(1.0, (1.0 - b) / s);
}

fn blendHardLightChannel(cb : f32, cs : f32) -> f32 {
  let s = blendSaturate(cs);
  if (s <= 0.5) {
    return blendMultiplyChannel(cb, 2.0 * s);
  }
  return blendScreenChannel(cb, 2.0 * s - 1.0);
}

fn blendSoftLightChannel(cb : f32, cs : f32) -> f32 {
  let b = blendSaturate(cb);
  let s = blendSaturate(cs);
  let d = select(sqrt(b), ((16.0 * b - 12.0) * b + 4.0) * b, b <= 0.25);
  if (s <= 0.5) {
    return b - (1.0 - 2.0 * s) * b * (1.0 - b);
  }
  return b + (2.0 * s - 1.0) * (d - b);
}

fn blendDifferenceChannel(cb : f32, cs : f32) -> f32 {
  return abs(blendSaturate(cb) - blendSaturate(cs));
}

fn blendExclusionChannel(cb : f32, cs : f32) -> f32 {
  let b = blendSaturate(cb);
  let s = blendSaturate(cs);
  return b + s - 2.0 * b * s;
}

fn blendAddChannel(cb : f32, cs : f32) -> f32 {
  return min(1.0, blendSaturate(cb) + blendSaturate(cs));
}

fn blendSubtractChannel(cb : f32, cs : f32) -> f32 {
  return max(0.0, blendSaturate(cb) - blendSaturate(cs));
}

fn blendRgbMultiply(backdrop : vec3<f32>, source : vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    blendMultiplyChannel(backdrop.x, source.x),
    blendMultiplyChannel(backdrop.y, source.y),
    blendMultiplyChannel(backdrop.z, source.z)
  );
}

fn blendRgbScreen(backdrop : vec3<f32>, source : vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    blendScreenChannel(backdrop.x, source.x),
    blendScreenChannel(backdrop.y, source.y),
    blendScreenChannel(backdrop.z, source.z)
  );
}

fn blendRgbOverlay(backdrop : vec3<f32>, source : vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    blendOverlayChannel(backdrop.x, source.x),
    blendOverlayChannel(backdrop.y, source.y),
    blendOverlayChannel(backdrop.z, source.z)
  );
}

fn blendCompositeStraightFromRgb(
  backdrop : vec4<f32>,
  source : vec4<f32>,
  blended : vec3<f32>,
  opacity : f32,
) -> vec4<f32> {
  let cb = blendStraightRgba(backdrop, 1.0);
  let cs = blendStraightRgba(source, opacity);
  let overlap = cb.a * cs.a;
  let outA = cs.a + cb.a * (1.0 - cs.a);
  if (outA <= 0.0) {
    return vec4<f32>(0.0);
  }
  let rgb = (
    cs.rgb * cs.a * (1.0 - cb.a) +
    cb.rgb * cb.a * (1.0 - cs.a) +
    blended * overlap
  ) / outA;
  return vec4<f32>(rgb, outA);
}

fn blendCompositeMultiplyStraight(backdrop : vec4<f32>, source : vec4<f32>, opacity : f32) -> vec4<f32> {
  let cb = blendStraightRgba(backdrop, 1.0);
  let cs = blendStraightRgba(source, opacity);
  return blendCompositeStraightFromRgb(cb, cs, blendRgbMultiply(cb.rgb, cs.rgb), 1.0);
}

fn blendCompositeScreenStraight(backdrop : vec4<f32>, source : vec4<f32>, opacity : f32) -> vec4<f32> {
  let cb = blendStraightRgba(backdrop, 1.0);
  let cs = blendStraightRgba(source, opacity);
  return blendCompositeStraightFromRgb(cb, cs, blendRgbScreen(cb.rgb, cs.rgb), 1.0);
}

fn blendCompositeOverlayStraight(backdrop : vec4<f32>, source : vec4<f32>, opacity : f32) -> vec4<f32> {
  let cb = blendStraightRgba(backdrop, 1.0);
  let cs = blendStraightRgba(source, opacity);
  return blendCompositeStraightFromRgb(cb, cs, blendRgbOverlay(cb.rgb, cs.rgb), 1.0);
}

fn blendCoverageAlpha(coveredSamples : u32, sampleCount : u32) -> f32 {
  let samples = max(1u, sampleCount);
  let covered = min(coveredSamples, samples);
  return f32(covered) / f32(samples);
}

fn blendAlphaToCoverage(alpha : f32, sampleCount : u32) -> vec4<f32> {
  let samples = max(1u, sampleCount);
  let value = blendSaturate(alpha);
  let coveredSamples = min(samples, u32(round(value * f32(samples))));
  return vec4<f32>(
    value,
    f32(samples),
    f32(coveredSamples),
    blendCoverageAlpha(coveredSamples, samples)
  );
}

fn blendModI32(value : i32, divisor : i32) -> i32 {
  let remainder = value % divisor;
  return select(remainder + divisor, remainder, remainder >= 0);
}

fn blendBayer4Threshold(x : i32, y : i32) -> f32 {
  let index = u32(blendModI32(y, 4) * 4 + blendModI32(x, 4));
  return (f32(BLEND_BAYER_4X4[index]) + 0.5) / 16.0;
}

fn blendDitherAlpha(alpha : f32, x : i32, y : i32, frame : i32) -> f32 {
  let threshold = blendBayer4Threshold(x + frame, y + frame);
  return select(0.0, 1.0, blendSaturate(alpha) >= threshold);
}
`;

export default blendMathWGSL;
