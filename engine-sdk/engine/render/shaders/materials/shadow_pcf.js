// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Shadow PCF - Percentage-closer filtering for soft shadows
 */
export const shadowPcfWGSL = /* wgsl */`
fn saturateShadow(x : f32) -> f32 {
  return clamp(x, 0.0, 1.0);
}

fn sampleShadowPCF3x3(
  shadowMap : texture_depth_2d,
  shadowSampler : sampler_comparison,
  uv : vec2<f32>,
  depthRef : f32,
  texelSize : vec2<f32>
) -> f32 {
  var sum : f32 = 0.0;
  var count : f32 = 0.0;

  for (var y : i32 = -1; y <= 1; y = y + 1) {
    for (var x : i32 = -1; x <= 1; x = x + 1) {
      let offset = vec2<f32>(f32(x), f32(y)) * texelSize;
      let coord = uv + offset;
      let value = textureSampleCompare(
        shadowMap,
        shadowSampler,
        coord,
        depthRef
      );
      sum = sum + value;
      count = count + 1.0;
    }
  }

  if (count <= 0.0) {
    return 1.0;
  }

  return saturateShadow(sum / count);
}
`;
