// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Shared sRGB, luminance, contrast, YUV/YCbCr, and tone-map helpers for WGSL.
 */

export const colorMathWGSL = /* wgsl */`
const COLOR_LUMA_REC709 : vec3<f32> = vec3<f32>(0.2126, 0.7152, 0.0722);
const COLOR_LUMA_REC601 : vec3<f32> = vec3<f32>(0.299, 0.587, 0.114);
const COLOR_LUMA_REC2020 : vec3<f32> = vec3<f32>(0.2627, 0.6780, 0.0593);

fn colorSrgbChannelToLinear(value : f32) -> f32 {
  if (value <= 0.04045) {
    return value / 12.92;
  }
  return pow((value + 0.055) / 1.055, 2.4);
}

fn colorLinearChannelToSrgb(value : f32) -> f32 {
  if (value <= 0.0031308) {
    return value * 12.92;
  }
  return 1.055 * pow(max(0.0, value), 1.0 / 2.4) - 0.055;
}

fn colorSrgbToLinear(rgb : vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    colorSrgbChannelToLinear(rgb.r),
    colorSrgbChannelToLinear(rgb.g),
    colorSrgbChannelToLinear(rgb.b)
  );
}

fn colorLinearToSrgb(rgb : vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    colorLinearChannelToSrgb(rgb.r),
    colorLinearChannelToSrgb(rgb.g),
    colorLinearChannelToSrgb(rgb.b)
  );
}

fn colorLinearLuminance(rgb : vec3<f32>) -> f32 {
  return dot(rgb, COLOR_LUMA_REC709);
}

fn colorRelativeLuminance(rgb : vec3<f32>) -> f32 {
  return colorLinearLuminance(colorSrgbToLinear(clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0))));
}

fn colorContrastRatio(a : vec3<f32>, b : vec3<f32>) -> f32 {
  let la = colorRelativeLuminance(a);
  let lb = colorRelativeLuminance(b);
  let lighter = max(la, lb);
  let darker = min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

fn colorRgbToYuv601(rgb : vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    dot(rgb, COLOR_LUMA_REC601),
    dot(rgb, vec3<f32>(-0.14713, -0.28886, 0.436)),
    dot(rgb, vec3<f32>(0.615, -0.51499, -0.10001))
  );
}

fn colorYuv601ToRgb(yuv : vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    dot(yuv, vec3<f32>(1.0, 0.0, 1.13983)),
    dot(yuv, vec3<f32>(1.0, -0.39465, -0.58060)),
    dot(yuv, vec3<f32>(1.0, 2.03211, 0.0))
  );
}

fn colorRgbToYCbCr601(rgb : vec3<f32>) -> vec3<f32> {
  let y = dot(rgb, COLOR_LUMA_REC601);
  return vec3<f32>(
    y,
    0.5 + (rgb.b - y) / 1.772,
    0.5 + (rgb.r - y) / 1.402
  );
}

fn colorYCbCr601ToRgb(ycbcr : vec3<f32>) -> vec3<f32> {
  let cb = ycbcr.y - 0.5;
  let cr = ycbcr.z - 0.5;
  return vec3<f32>(
    ycbcr.x + 1.402 * cr,
    ycbcr.x - 0.344136 * cb - 0.714136 * cr,
    ycbcr.x + 1.772 * cb
  );
}

fn colorToneMapReinhard(color : vec3<f32>) -> vec3<f32> {
  return color / (vec3<f32>(1.0) + color);
}

fn colorToneMapReinhardExtended(color : vec3<f32>, whitePoint : f32) -> vec3<f32> {
  let wp = max(0.000001, whitePoint);
  let wp2 = wp * wp;
  return (color * (vec3<f32>(1.0) + color / wp2)) / (vec3<f32>(1.0) + color);
}

fn colorToneMapACES(color : vec3<f32>) -> vec3<f32> {
  let x = max(color, vec3<f32>(0.0));
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + vec3<f32>(b))) / (x * (c * x + vec3<f32>(d)) + vec3<f32>(e)), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn colorExposure(color : vec3<f32>, ev : f32) -> vec3<f32> {
  return color * exp2(ev);
}

fn colorContrastAdjust(color : vec3<f32>, amount : f32) -> vec3<f32> {
  return (color - vec3<f32>(0.5)) * amount + vec3<f32>(0.5);
}

fn colorSaturationAdjust(color : vec3<f32>, amount : f32) -> vec3<f32> {
  let luma = colorLinearLuminance(color);
  return mix(vec3<f32>(luma), color, amount);
}
`;

export default colorMathWGSL;
