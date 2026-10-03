// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Domain Warping Functions
 * 
 * Distort input coordinates using noise to create organic shapes.
 * Creates flowing, natural-looking distortions.
 */

import { fbmWGSL } from '../noise/fbm.js';

export const domainWarpWGSL = /* wgsl */`
${fbmWGSL}

// ============================================================================
// DOMAIN WARPING - Distort coordinates for organic shapes
// ============================================================================

// 2D domain warp using FBM
fn domainWarp2d(p: vec2<f32>, strength: f32, octaves: i32) -> vec2<f32> {
  let offset1 = fbm2d(p, octaves);
  let offset2 = fbm2d(p + vec2<f32>(5.2, 1.3), octaves);
  return p + vec2<f32>(offset1, offset2) * strength;
}

// 3D domain warp using FBM
fn domainWarp3d(p: vec3<f32>, strength: f32, octaves: i32) -> vec3<f32> {
  let offset1 = fbm3d(p, octaves);
  let offset2 = fbm3d(p + vec3<f32>(5.2, 1.3, 8.4), octaves);
  let offset3 = fbm3d(p + vec3<f32>(2.7, 9.1, 3.5), octaves);
  return p + vec3<f32>(offset1, offset2, offset3) * strength;
}

// Layered domain warp - warp the warp for extreme distortion
fn domainWarpLayered2d(p: vec2<f32>, strength: f32, octaves: i32, layers: i32) -> vec2<f32> {
  var pos = p;
  for (var i = 0; i < layers; i = i + 1) {
    pos = domainWarp2d(pos, strength, octaves);
  }
  return pos;
}

// Directional warp - warp along specific direction
fn domainWarpDirectional2d(p: vec2<f32>, direction: vec2<f32>, strength: f32, octaves: i32) -> vec2<f32> {
  let warp = fbm2d(p, octaves);
  return p + direction * warp * strength;
}

// Swirl warp - create rotating distortion
fn domainWarpSwirl2d(p: vec2<f32>, center: vec2<f32>, strength: f32, octaves: i32) -> vec2<f32> {
  let offset = p - center;
  let dist = length(offset);
  let angle = atan2(offset.y, offset.x);
  let warp = fbm2d(p, octaves);
  let newAngle = angle + warp * strength;
  return center + vec2<f32>(cos(newAngle), sin(newAngle)) * dist;
}
`;
