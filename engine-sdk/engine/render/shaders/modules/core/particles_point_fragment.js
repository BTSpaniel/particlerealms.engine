// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Point fragment shader - spherical falloff
export const particlesPointFragmentWGSL = /* wgsl */`
@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  let shape = i32(input.shape + 0.5);
  let dist = length(input.localPos);

  if (shape != 13 && dist > 1.0) {
    discard;
  }

  let lifetime = max(input.lifetime, 0.0001);
  let t = clamp(input.age / lifetime, 0.0, 1.0);

  let rm = i32(input.renderMode + 0.5);
  let isSolid = select(0.0, 1.0, rm == 2 || rm == 4);

  if (isSolid < 0.5 && t >= 1.0) {
    discard;
  }
  let fadeInT = smoothstep(0.0, 0.05, t);
  let fadeOut = 1.0 - smoothstep(0.9, 1.0, t);
  let fadeInAge = smoothstep(0.0, 0.12, input.age);
  let lifeMask = mix(fadeInT * fadeOut, fadeInAge, isSolid);

  let r2 = dot(input.localPos, input.localPos);
  let baseK = select(6.0, 2.2, shape == 2);
  let k = select(baseK, 3.0, shape == 13);
  let falloff = exp(-r2 * k);

  let solidAlpha = select(0.10, 0.14, shape == 13);
  let baseAlpha = select(0.18, solidAlpha, isSolid > 0.5);
  var alpha = baseAlpha * falloff * lifeMask * input.color.a;
  var color = input.color.rgb;

  if (rm == 4) {
    let tex = textureSampleLevel(uAlbedoTex, uAlbedoSampler, input.uv, 0.0);
    color = tex.rgb;
    if (tex.a > 0.01) {
      alpha = alpha * tex.a;
    }
  }
  return vec4<f32>(color, alpha);
}
`;
