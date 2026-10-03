// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Voronoi & Cellular Noise Patterns
 * 
 * Functions for voronoi diagrams, cellular textures, and organic patterns.
 * 
 * Key Concepts:
 *   1. Voronoi cells - Animated cellular patterns
 *   2. Smooth voronoi - Blended cell boundaries
 *   3. Polar coordinates - Radial patterns
 *   4. Ring patterns - Concentric ripples
 *   5. FBM with rotation - Reduced axis artifacts
 * 
 * Functions:
 *   - voronoi2d(p, time) - Basic 2D voronoi
 *   - voronoiSmooth(p, w, time) - Smoothed cell edges
 *   - toPolar(v) - Cartesian to polar
 *   - ringPattern(p, time) - Concentric rings with noise
 */

export const voronoiWGSL = /* wgsl */`
// ============================================================================
// HASH FUNCTIONS
// ============================================================================

// 2D -> 2D hash
fn hash22v(p : vec2<f32>) -> vec2<f32> {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * vec3<f32>(0.1031, 0.1030, 0.0973));
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// 2D -> 1D hash
fn hash12v(p : vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// 3D -> 1D hash
fn hash13v(p3 : vec3<f32>) -> f32 {
  var p = fract(p3 * 0.1031);
  p = p + dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

// ============================================================================
// COORDINATE TRANSFORMS
// ============================================================================

// Cartesian to polar (returns angle, radius)
fn toPolar(v : vec2<f32>) -> vec2<f32> {
  return vec2<f32>(atan2(v.y, v.x), length(v));
}

// Polar to cartesian
fn toCartesian(polar : vec2<f32>) -> vec2<f32> {
  return vec2<f32>(cos(polar.x), sin(polar.x)) * polar.y;
}

// ============================================================================
// BASIC 2D NOISE
// ============================================================================

fn noise2v(p : vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  
  return mix(
    mix(dot(hash22v(i + vec2<f32>(0.0, 0.0)), f - vec2<f32>(0.0, 0.0)),
        dot(hash22v(i + vec2<f32>(1.0, 0.0)), f - vec2<f32>(1.0, 0.0)), u.x),
    mix(dot(hash22v(i + vec2<f32>(0.0, 1.0)), f - vec2<f32>(0.0, 1.0)),
        dot(hash22v(i + vec2<f32>(1.0, 1.0)), f - vec2<f32>(1.0, 1.0)), u.x),
    u.y
  );
}

// ============================================================================
// VORONOI NOISE
// ============================================================================

// Basic voronoi - returns distance to nearest cell center
fn voronoi2d(p : vec2<f32>, time : f32) -> vec2<f32> {
  let n = floor(p);
  let f = fract(p);
  
  var minDist = 8.0;
  var cellId = 0.0;
  
  for (var j = -1; j <= 1; j = j + 1) {
    for (var i = -1; i <= 1; i = i + 1) {
      let g = vec2<f32>(f32(i), f32(j));
      let o = hash22v(n + g);
      // Animate cell centers
      let animO = 0.5 + 0.5 * sin(time + 6.2831 * o);
      let d = length(g - f + animO);
      
      if (d < minDist) {
        minDist = d;
        cellId = hash12v(n + g);
      }
    }
  }
  
  return vec2<f32>(minDist, cellId);
}

// Smooth voronoi with blended edges
// w controls smoothness (0.0 = sharp, 1.0 = very smooth)
fn voronoiSmooth(p : vec2<f32>, w : f32, time : f32) -> vec2<f32> {
  let n = floor(p);
  let f = fract(p);
  
  var m = vec2<f32>(8.0, 0.0);
  
  for (var j = -2; j <= 2; j = j + 1) {
    for (var i = -2; i <= 2; i = i + 1) {
      let g = vec2<f32>(f32(i), f32(j));
      let o = hash22v(n + g);
      let animO = 0.5 + 0.5 * sin(time + 6.2831 * o);
      let d = length(g - f + animO);
      
      // Smooth minimum blending
      let h = smoothstep(0.0, 1.0, 0.5 + 0.5 * (m.x - d) / w);
      m.x = mix(m.x, d, h) - h * (1.0 - h) * w / (1.0 + 3.0 * w);
      m.y = mix(m.y, 0.75, h) - h * (1.0 - h) * w / (1.0 + 3.0 * w);
    }
  }
  
  return m;
}

// Voronoi with cell edge detection
fn voronoiEdges(p : vec2<f32>, time : f32) -> f32 {
  let n = floor(p);
  let f = fract(p);
  
  var minDist1 = 8.0;
  var minDist2 = 8.0;
  
  for (var j = -1; j <= 1; j = j + 1) {
    for (var i = -1; i <= 1; i = i + 1) {
      let g = vec2<f32>(f32(i), f32(j));
      let o = hash22v(n + g);
      let animO = 0.5 + 0.5 * sin(time + 6.2831 * o);
      let d = length(g - f + animO);
      
      if (d < minDist1) {
        minDist2 = minDist1;
        minDist1 = d;
      } else if (d < minDist2) {
        minDist2 = d;
      }
    }
  }
  
  // Edge is where two cells meet
  return minDist2 - minDist1;
}

// ============================================================================
// RING PATTERNS
// ============================================================================

// Concentric rings with noise distortion
fn ringPattern(p : vec2<f32>, time : f32, ringSpacing : f32, noiseAmount : f32) -> f32 {
  let d = noise2v(p * 4.0 + time * 0.5);
  let rings = abs(fract(length(p) / ringSpacing + noiseAmount * d - time * 0.1) - 0.5) * 2.0;
  return rings;
}

// Smooth ring pattern
fn ringPatternSmooth(p : vec2<f32>, time : f32, ringSpacing : f32, ringWidth : f32) -> f32 {
  let d = length(p);
  let ring = abs(sin((d / ringSpacing - time) * 3.14159));
  return smoothstep(1.0 - ringWidth, 1.0, ring);
}

// ============================================================================
// COMBINED PATTERNS (like the portal shader)
// ============================================================================

// Portal/energy texture combining voronoi and rings
fn portalTexture(p : vec2<f32>, time : f32, fade : f32) -> f32 {
  // Convert to polar for radial effect
  var polar = toPolar(p) * 1.175;
  polar.y = polar.y - time * 0.51;
  polar.x = abs(polar.x) * 4.0;
  
  // Two layers of voronoi
  let v1 = voronoiSmooth(polar * vec2<f32>(2.5, 1.185), 0.51, time * 0.1);
  let v2 = voronoiSmooth(polar * vec2<f32>(1.5, 1.185), 0.51, time * 0.05);
  var td = v1 * v2;
  
  // Add ring pattern
  let ringP = p * 0.05;
  let ringNoise = noise2v(ringP * 4.0 + time * 0.05 * 8.0);
  let rings = fade * 0.235 + abs(fract(length(ringP) + 0.07 * ringNoise - time * 0.05 * 2.0) - 0.5) * 2.0 / 0.15;
  
  let a = 1.0 - smoothstep(0.4485, 0.4535, td.y * 0.855 + rings * 0.01);
  
  td.y = min(td.y + fade * 15.0, 1.0);
  let b = 1.0 - smoothstep(0.4785, 0.4835, td.y);
  
  return max(a, b);
}

// Animated energy rings with voronoi
fn energyRingsVoronoi(p : vec2<f32>, time : f32, fade : f32) -> f32 {
  // Voronoi layer
  var polar = toPolar(p) * 1.5;
  polar.y = polar.y - time * 0.51;
  polar.x = abs(polar.x) * 0.125;
  let td = voronoiSmooth(polar * vec2<f32>(2.5, 1.185), 0.51, time * 0.1);
  let voronoiMask = 1.0 - smoothstep(0.73, 0.735, td.x + fade);
  
  // Ring layer
  let ringP = p * 0.05;
  let ringNoise = noise2v(ringP * 4.0 + time * 0.5);
  let rings = 1.0 - smoothstep(0.01, 0.015, 
    fade * 0.5 + abs(fract(length(ringP) + 0.07 * ringNoise - time * 0.1) - 0.5) * 2.0 / 0.15);
  
  return voronoiMask * rings;
}

// ============================================================================
// FBM WITH ROTATION (Reduces axis-aligned artifacts)
// ============================================================================

// Rotation matrix for FBM
fn fbmRotMat() -> mat3x3<f32> {
  return mat3x3<f32>(
    vec3<f32>(0.00, 0.80, 0.60),
    vec3<f32>(-0.80, 0.36, -0.48),
    vec3<f32>(-0.60, -0.48, 0.64)
  );
}

// 3D noise for FBM
fn noise3v(x : vec3<f32>) -> f32 {
  let i = floor(x);
  let f = fract(x);
  let u = f * f * (3.0 - 2.0 * f);
  
  return mix(
    mix(mix(hash13v(i + vec3<f32>(0.0, 0.0, 0.0)),
            hash13v(i + vec3<f32>(1.0, 0.0, 0.0)), u.x),
        mix(hash13v(i + vec3<f32>(0.0, 1.0, 0.0)),
            hash13v(i + vec3<f32>(1.0, 1.0, 0.0)), u.x), u.y),
    mix(mix(hash13v(i + vec3<f32>(0.0, 0.0, 1.0)),
            hash13v(i + vec3<f32>(1.0, 0.0, 1.0)), u.x),
        mix(hash13v(i + vec3<f32>(0.0, 1.0, 1.0)),
            hash13v(i + vec3<f32>(1.0, 1.0, 1.0)), u.x), u.y),
    u.z
  );
}

// FBM with rotation between octaves
fn fbmRotated(p : vec3<f32>, octaves : i32) -> f32 {
  let rot = fbmRotMat();
  var q = 8.0 * p * 0.35;
  var f = 0.0;
  var amp = 0.5;
  
  for (var i = 0; i < octaves; i = i + 1) {
    f = f + amp * noise3v(q);
    q = rot * q * 2.01;
    amp = amp * 0.5;
  }
  
  return f;
}

// ============================================================================
// CLOUD VOLUMETRIC PATTERN
// ============================================================================

// Cloud density using FBM
fn cloudDensity(p : vec3<f32>, time : f32) -> f32 {
  let animated = p + vec3<f32>(0.0, 1.8, 0.0) * time;
  return fbmRotated(animated, 4) - 0.8;
}

// Simple cloud SDF (sphere with noise)
fn cloudSDF(p : vec3<f32>, time : f32, radius : f32) -> f32 {
  let baseSphere = length(p) - radius;
  let noise = cloudDensity(p, time);
  return mix(baseSphere, noise, 0.372);
}

// Cloud shading (depth-based)
fn cloudShading(depth : f32, minLight : f32, depthScale : f32) -> f32 {
  var result = 1.0;
  result = min(result, depth * 2.6 / depthScale + minLight);
  if (depth < 0.00001) {
    result = minLight;
  }
  return result;
}

// ============================================================================
// CYLINDER TEXTURE (Seamless wrap)
// ============================================================================

// UV for cylinder that blends at seam
fn cylinderUV(pos : vec3<f32>, height : f32) -> vec2<f32> {
  return 0.5 + vec2<f32>(
    atan2(pos.z, pos.x) / (3.14159 * 2.0),
    pos.y * 0.5 / height
  );
}

// Blend two 180-degree rotated samples to hide seam
fn cylinderSeamlessVoronoi(pos : vec3<f32>, height : f32, time : f32) -> f32 {
  // Two UVs offset by 180 degrees
  let uv1 = 0.5 + vec2<f32>(atan2(pos.z, pos.x) / (3.14159 * 2.0), pos.y * 0.5 / height);
  let uv2 = 0.5 + vec2<f32>(atan2(-pos.z, -pos.x) / (3.14159 * 2.0), pos.y * 0.5 / height);
  
  // Voronoi at each UV
  var p1 = uv1;
  p1.y = p1.y + time * 0.51;
  p1 = p1 * 5.0;
  let v1 = voronoiSmooth(p1 * vec2<f32>(2.5, 1.185), 0.51, time * 0.1);
  
  var p2 = uv2;
  p2.y = p2.y + time * 0.51;
  p2 = p2 * 5.0;
  let v2 = voronoiSmooth(p2 * vec2<f32>(2.5, 1.185), 0.51, time * 0.1);
  
  // Blend based on distance from seam
  let blend = smoothstep(0.0, 0.15, abs((uv1.x - 0.5) * 2.0));
  return mix(v1.y, v2.y, blend);
}
`;

export default voronoiWGSL;
