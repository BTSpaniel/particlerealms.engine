// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PBR Extensions - Placeholder hooks for subsurface scattering, fog, and post-lighting effects
 */
export const pbrExtensionsWGSL = /* wgsl */`
struct PbrSurface {
  worldPos   : vec3<f32>,
  viewDir    : vec3<f32>,
  normal     : vec3<f32>,
  baseColor  : vec3<f32>,
  metallic   : f32,
  roughness  : f32,
};

fn pbrExtZero() -> vec3<f32> {
  return vec3<f32>(0.0, 0.0, 0.0);
}

fn pbrExtIdentity(color : vec3<f32>) -> vec3<f32> {
  return color;
}

fn computeSubsurfaceScattering(surface : PbrSurface) -> vec3<f32> {
  return pbrExtZero();
}

fn computeFogContribution(surface : PbrSurface, viewDistance : f32) -> vec3<f32> {
  return pbrExtZero();
}

fn applyPostLightingEffects(
  litColor : vec3<f32>,
  surface : PbrSurface
) -> vec3<f32> {
  return pbrExtIdentity(litColor);
}
`;
