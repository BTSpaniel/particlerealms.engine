// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Voxel World Module - shared terrain functions for voxel-style materials.
 *
 * This chunk does NOT declare entry points. It only provides reusable
 * WGSL helpers for triplanar noise, terrain palette, and voxel edge darkening.
 */
export const voxelWorldModuleWGSL = /* wgsl */`
// ============================================================================
// VOXEL TERRAIN HELPERS
// ============================================================================

// Simple hash for noise
fn voxelHash(p: vec3<f32>) -> f32 {
  var p3 = fract(p * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// 3D value noise
fn voxelNoise3D(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);

  return mix(
    mix(mix(voxelHash(i + vec3(0.0, 0.0, 0.0)), voxelHash(i + vec3(1.0, 0.0, 0.0)), u.x),
        mix(voxelHash(i + vec3(0.0, 1.0, 0.0)), voxelHash(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
    mix(mix(voxelHash(i + vec3(0.0, 0.0, 1.0)), voxelHash(i + vec3(1.0, 0.0, 1.0)), u.x),
        mix(voxelHash(i + vec3(0.0, 1.0, 1.0)), voxelHash(i + vec3(1.0, 1.0, 1.0)), u.x), u.y),
    u.z
  );
}

// Triplanar blend weights from normal
fn voxelTriplanarWeights(normal: vec3<f32>) -> vec3<f32> {
  var weights = abs(normal);
  weights = weights * weights;  // Sharpen blend
  weights = weights / (weights.x + weights.y + weights.z + 0.0001);
  return weights;
}

// Triplanar procedural noise
fn voxelTriplanarNoise(worldPos: vec3<f32>, normal: vec3<f32>, scale: f32) -> f32 {
  let weights = voxelTriplanarWeights(normal);

  let texYZ = voxelNoise3D(vec3(worldPos.y, worldPos.z, 0.0) * scale);
  let texXZ = voxelNoise3D(vec3(worldPos.x, worldPos.z, 1.0) * scale);
  let texXY = voxelNoise3D(vec3(worldPos.x, worldPos.y, 2.0) * scale);

  return texYZ * weights.x + texXZ * weights.y + texXY * weights.z;
}

// Multi-octave FBM for fine detail
fn voxelFBMNoise(p: vec3<f32>, octaves: i32) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var frequency = 1.0;

  for (var i = 0; i < octaves; i = i + 1) {
    value = value + amplitude * voxelNoise3D(p * frequency);
    amplitude = amplitude * 0.5;
    frequency = frequency * 2.0;
  }

  return value;
}

// Edge factor for subtle voxel grid (1 = center of face, 0 = near edge)
fn voxelEdgeFactor(worldPos: vec3<f32>, normal: vec3<f32>) -> f32 {
  let absNormal = abs(normal);
  var edgeDist: f32;

  if (absNormal.y > 0.5) {
    let fx = fract(worldPos.x);
    let fz = fract(worldPos.z);
    edgeDist = min(min(fx, 1.0 - fx), min(fz, 1.0 - fz));
  } else if (absNormal.x > 0.5) {
    let fy = fract(worldPos.y);
    let fz = fract(worldPos.z);
    edgeDist = min(min(fy, 1.0 - fy), min(fz, 1.0 - fz));
  } else {
    let fx = fract(worldPos.x);
    let fy = fract(worldPos.y);
    edgeDist = min(min(fx, 1.0 - fx), min(fy, 1.0 - fy));
  }

  return smoothstep(0.0, 0.08, edgeDist);
}

// Terrain palette based on slope (normal.y) and height (worldPos.y)
fn voxelTerrainPalette(worldPos: vec3<f32>, normal: vec3<f32>) -> vec3<f32> {
  let height = worldPos.y;
  let slope = 1.0 - clamp(normal.y, 0.0, 1.0); // 0 = flat, 1 = vertical

  var rockWeight = smoothstep(0.35, 0.85, slope);
  var grassWeight = smoothstep(-5.0, 5.0, height) * (1.0 - rockWeight);
  var dirtWeight = 1.0 - max(rockWeight, grassWeight);

  // High peaks become rockier
  let peak = smoothstep(25.0, 40.0, height);
  rockWeight = clamp(rockWeight + peak * 0.4, 0.0, 1.0);
  grassWeight = grassWeight * (1.0 - peak * 0.6);
  dirtWeight = clamp(dirtWeight, 0.0, 1.0);

  let wSum = rockWeight + dirtWeight + grassWeight + 0.0001;
  rockWeight = rockWeight / wSum;
  dirtWeight = dirtWeight / wSum;
  grassWeight = grassWeight / wSum;

  let rockColor = vec3<f32>(0.32, 0.33, 0.37);
  let dirtColor = vec3<f32>(0.33, 0.24, 0.18);
  let grassColor = vec3<f32>(0.18, 0.36, 0.18);

  return rockColor * rockWeight + dirtColor * dirtWeight + grassColor * grassWeight;
}

// Full terrain base color with procedural detail and optional AO factor
fn voxelTerrainBaseColor(worldPos: vec3<f32>, normal: vec3<f32>, ao: f32) -> vec3<f32> {
  var baseColor = voxelTerrainPalette(worldPos, normal);

  // Coarse triplanar detail
  let texScale = 0.5;
  let detail = voxelTriplanarNoise(worldPos, normal, texScale);
  let colorVariation = 0.9 + detail * 0.2;
  baseColor = baseColor * colorVariation;

  // Fine grain detail
  let fineDetail = voxelFBMNoise(worldPos * 2.0, 2);
  baseColor = baseColor * (0.95 + fineDetail * 0.1);

  // Apply AO if provided (1.0 = none)
  baseColor = baseColor * ao;

  return baseColor;
}
`;

export default voxelWorldModuleWGSL;
