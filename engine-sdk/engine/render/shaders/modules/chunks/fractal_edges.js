// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Fractal & Edge Detection Effects
 * 
 * Raymarching fractals with stylized edge rendering.
 * 
 * Key Concepts:
 *   1. Fractal distance functions - Amazing Surface, Mandelbulb, etc.
 *   2. Edge detection via Laplacian - Dark outlines from SDF
 *   3. Normal-based coloring - No lighting, just normal as color
 *   4. Rainbow/color bands - Animated stripes
 *   5. Stylized sky/sun - Radial gradient with rays
 *   6. Camera path animation - Smooth path following
 */

export const fractalEdgesWGSL = /* wgsl */`
// ============================================================================
// FRACTAL CONSTANTS
// ============================================================================

const FRAC_PI : f32 = 3.14159265;

// ============================================================================
// 2D ROTATION
// ============================================================================

fn rot2d(angle : f32) -> mat2x2<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return mat2x2<f32>(c, s, -s, c);
}

// ============================================================================
// FRACTAL FORMULAS
// ============================================================================

// "Amazing Surface" fractal iteration
fn amazingSurface(p : vec4<f32>) -> vec4<f32> {
  var q = p;
  q.x = abs(q.x + 1.0) - abs(q.x - 1.0) - q.x;
  q.z = abs(q.z + 1.0) - abs(q.z - 1.0) - q.z;
  q.y = q.y - 0.25;
  
  // Rotate xy
  let angle = radians(35.0);
  let c = cos(angle);
  let s = sin(angle);
  let newX = q.x * c + q.y * s;
  let newY = -q.x * s + q.y * c;
  q.x = newX;
  q.y = newY;
  
  // Scale by inverse of clamped dot product
  let scale = 2.0 / clamp(dot(q.xyz, q.xyz), 0.2, 1.0);
  return q * scale;
}

// Amazing Surface distance function
fn deAmazingSurface(pos : vec3<f32>, iterations : i32) -> f32 {
  var tpos = pos;
  let wrappedZ = tpos.z - floor(tpos.z / 6.0) * 6.0;

  tpos.z = abs(3.0 - wrappedZ);
  
  var p = vec4<f32>(tpos, 1.0);
  for (var i = 0; i < iterations; i = i + 1) {
    p = amazingSurface(p);
  }
  
  return (length(max(vec2<f32>(0.0), p.yz - 1.5)) - 1.0) / p.w;
}

// Mandelbulb fractal
fn deMandelbulb(pos : vec3<f32>, power : f32, iterations : i32) -> f32 {
  var z = pos;
  var dr = 1.0;
  var r = 0.0;
  
  for (var i = 0; i < iterations; i = i + 1) {
    r = length(z);
    if (r > 2.0) { break; }
    
    // Convert to polar
    let theta = acos(clamp(z.z / max(r, 0.000001), -1.0, 1.0));
    let phi = atan2(z.y, z.x);
    dr = pow(r, power - 1.0) * power * dr + 1.0;
    
    // Scale and rotate
    let zr = pow(r, power);
    let newTheta = theta * power;
    let newPhi = phi * power;
    
    // Convert back to cartesian
    z = zr * vec3<f32>(
      sin(newTheta) * cos(newPhi),
      sin(newPhi) * sin(newTheta),
      cos(newTheta)
    );
    z = z + pos;
  }
  
  return 0.5 * log(max(r, 1.0001)) * r / max(dr, 0.000001);
}

// Menger sponge
fn deMenger(pos : vec3<f32>, iterations : i32) -> f32 {
  var p = pos;
  let boxOffset = abs(p) - vec3<f32>(1.0);
  var d = length(max(boxOffset, vec3<f32>(0.0))) + min(max(boxOffset.x, max(boxOffset.y, boxOffset.z)), 0.0);
  var s = 1.0;
  
  for (var i = 0; i < iterations; i = i + 1) {
    let scaled = p * s;
    let a = scaled - floor(scaled * 0.5) * 2.0 - 1.0;
    s = s * 3.0;
    let r = abs(1.0 - 3.0 * abs(a));
    
    let da = max(r.x, r.y);
    let db = max(r.y, r.z);
    let dc = max(r.z, r.x);
    let c = (min(da, min(db, dc)) - 1.0) / s;
    d = max(d, c);
  }
  
  return d;
}

// Sierpinski tetrahedron
fn deSierpinski(pos : vec3<f32>, iterations : i32) -> f32 {
  var p = pos;
  let scale = 2.0;
  
  for (var i = 0; i < iterations; i = i + 1) {
    if (p.x + p.y < 0.0) {

      let previous = p;

      p.x = -previous.y;

      p.y = -previous.x;

    }
    if (p.x + p.z < 0.0) {

      let previous = p;

      p.x = -previous.z;

      p.z = -previous.x;

    }
    if (p.y + p.z < 0.0) {

      let previous = p;

      p.y = -previous.z;

      p.z = -previous.y;

    }
    p = p * scale - (scale - 1.0);
  }
  
  return length(p) * pow(scale, -f32(iterations));
}

// ============================================================================
// Mandelbox. The derivative follows the box fold, sphere fold, scale, and
// offset recurrence so callers can sphere-trace it with a conservative factor.
fn deMandelbox(pos : vec3<f32>, scale : f32, iterations : i32) -> f32 {
  var z = pos;
  var derivative = 1.0;
  let minimumRadius2 = 0.25;
  let fixedRadius2 = 1.0;
  for (var i = 0; i < iterations; i = i + 1) {
    z = clamp(z, vec3<f32>(-1.0), vec3<f32>(1.0)) * 2.0 - z;
    let radius2 = dot(z, z);
    if (radius2 < minimumRadius2) {
      let fold = fixedRadius2 / minimumRadius2;
      z = z * fold;
      derivative = derivative * fold;
    } else if (radius2 < fixedRadius2) {
      let fold = fixedRadius2 / max(radius2, 0.000001);
      z = z * fold;
      derivative = derivative * fold;
    }
    z = z * scale + pos;
    derivative = derivative * abs(scale) + 1.0;
  }
  return length(z) / max(abs(derivative), 0.000001);
}

// EDGE DETECTION FROM SDF
// ============================================================================

// Compute edge factor using Laplacian of distance field
// This finds edges by detecting where the surface curves sharply
fn computeEdge(
  pos : vec3<f32>,
  epsilon : f32,
  sdfCenter : f32
) -> f32 {
  // Sample distance field in 6 directions
  // Note: You need to provide the SDF function externally
  // This is a template showing the pattern
  
  // edge = |d - 0.5*(d+x + d-x)| + |d - 0.5*(d+y + d-y)| + |d - 0.5*(d+z + d-z)|
  // Returns 0 for flat surfaces, higher for edges/corners
  
  return 0.0; // Placeholder - implement with your SDF
}

// Edge detection helper - call this with sampled SDF values
fn edgeFromSamples(
  center : f32,
  xPlus : f32, xMinus : f32,
  yPlus : f32, yMinus : f32,
  zPlus : f32, zMinus : f32,
  edgePower : f32,
  edgeScale : f32
) -> f32 {
  var edge = abs(center - 0.5 * (xPlus + xMinus));
  edge = edge + abs(center - 0.5 * (yPlus + yMinus));
  edge = edge + abs(center - 0.5 * (zPlus + zMinus));
  return min(1.0, pow(edge, edgePower) * edgeScale);
}

// ============================================================================
// NORMAL-BASED COLORING (No Lighting)
// ============================================================================

// Color directly from normal - stylized look
fn colorFromNormal(normal : vec3<f32>, edge : f32) -> vec3<f32> {
  // Use inverted absolute normal as color
  let col = (1.0 - abs(normal)) * max(0.0, 1.0 - edge * 0.8);
  return col;
}

// Wireframe-style rendering
fn wireframeColor(edge : f32) -> vec3<f32> {
  return vec3<f32>(1.0 - edge);
}

// ============================================================================
// RAINBOW / COLOR BANDS
// ============================================================================

// Rainbow stripe pattern (like Nyan Cat trail)
fn rainbowStripes(p : vec2<f32>, time : f32) -> vec4<f32> {
  var uv = p;
  let wave = sin(uv.x * 7.0 + time * 70.0) * 0.08;
  uv.y = uv.y + wave;
  uv.y = uv.y * 1.1;
  
  var col = vec4<f32>(0.0);
  
  if (uv.x > 0.0) {
    col = vec4<f32>(0.0);
  } else if (uv.y > 0.0 && uv.y < 1.0/6.0) {
    col = vec4<f32>(1.0, 0.169, 0.055, 1.0); // Red
  } else if (uv.y > 1.0/6.0 && uv.y < 2.0/6.0) {
    col = vec4<f32>(1.0, 0.659, 0.024, 1.0); // Orange
  } else if (uv.y > 2.0/6.0 && uv.y < 3.0/6.0) {
    col = vec4<f32>(1.0, 0.957, 0.0, 1.0);   // Yellow
  } else if (uv.y > 3.0/6.0 && uv.y < 4.0/6.0) {
    col = vec4<f32>(0.2, 0.918, 0.02, 1.0);  // Green
  } else if (uv.y > 4.0/6.0 && uv.y < 5.0/6.0) {
    col = vec4<f32>(0.031, 0.639, 1.0, 1.0); // Blue
  } else if (uv.y > 5.0/6.0 && uv.y < 1.0) {
    col = vec4<f32>(0.478, 0.333, 1.0, 1.0); // Purple
  }
  
  // Edge borders
  if (abs(uv.y) - 0.05 < 0.0001 || abs(uv.y - 1.0) - 0.05 < 0.0001) {
    col = vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }
  
  // Fade at edges
  col.a = col.a * (0.8 - min(0.8, abs(uv.x * 0.08)));
  
  // Slight desaturation
  col = vec4<f32>(mix(col.xyz, vec3<f32>(length(col.xyz)), 0.15), col.a);
  
  return col;
}

// Simple rainbow gradient
fn rainbowGradient(t : f32) -> vec3<f32> {
  return vec3<f32>(
    sin(t) * 0.5 + 0.5,
    sin(t + 2.094) * 0.5 + 0.5,
    sin(t + 4.189) * 0.5 + 0.5
  );
}

// ============================================================================
// STYLIZED SKY & SUN
// ============================================================================

fn stylizedSky(
  dir : vec3<f32>,
  time : f32,
  sunSize : f32
) -> vec3<f32> {
  var d = dir;
  d.y = d.y - 0.02;
  
  let angle = atan2(d.x, d.y) + time * 1.5;
  
  // Sun disc
  let sunDist = length(d.xy) * sunSize;
  let sunRays = abs(0.2 - (angle % 0.4));
  let sun = pow(clamp(1.0 - sunDist - sunRays, 0.0, 1.0), 0.1);
  
  // Sun border
  let sunBorder = pow(clamp(1.0 - length(d.xy) * (sunSize - 0.2) - sunRays, 0.0, 1.0), 0.1);
  
  // Sun glow rays
  let sunGlow = pow(clamp(1.0 - length(d.xy) * (sunSize - 4.5) - 0.5 * sunRays, 0.0, 1.0), 3.0);
  
  // Gradient sky
  let gradient = mix(0.45, 1.2, pow(smoothstep(0.0, 1.0, 0.75 - d.y), 2.0)) * (1.0 - sunBorder * 0.5);
  
  // Combine
  var sky = vec3<f32>(0.5, 0.0, 1.0) * ((1.0 - sun) * (1.0 - sunGlow) * gradient + (1.0 - sunBorder) * sunGlow * vec3<f32>(1.0, 0.8, 0.15) * 3.0);
  sky = sky + vec3<f32>(1.0, 0.9, 0.1) * sun;
  sky = max(sky, sunGlow * vec3<f32>(1.0, 0.9, 0.5));
  
  return sky;
}

// ============================================================================
// CAMERA PATH
// ============================================================================

// Smooth animated camera path
fn cameraPath(t : f32) -> vec3<f32> {
  let ti = t * 1.5;
  return vec3<f32>(
    sin(ti),
    (1.0 - sin(ti * 2.0)) * 0.5,
    -ti * 5.0
  ) * 0.5;
}

// Get camera orientation along path
fn getCameraAlongPath(
  t : f32,
  lookahead : f32
) -> mat3x3<f32> {
  let pos = cameraPath(t);
  let cameraTarget = cameraPath(t + lookahead);
  let forward = normalize(cameraTarget - pos);
  let right = normalize(cross(vec3<f32>(0.0, 1.0, 0.0), forward));
  let up = cross(forward, right);
  return mat3x3<f32>(right, up, forward);
}

// ============================================================================
// DOMAIN MODIFIERS FOR FRACTALS
// ============================================================================

// Wave distortion
fn waveDistort(pos : vec3<f32>, time : f32, amplitude : f32, frequency : f32) -> vec3<f32> {
  var p = pos;
  p.y = p.y + sin(p.z - time * 6.0) * amplitude;
  return p;
}

// Fold space (for fractals)
fn foldSpace(p : vec3<f32>) -> vec3<f32> {
  var q = p;
  q.x = abs(q.x);
  q.z = abs(q.z);
  return q;
}

// Box fold
fn boxFold(p : vec3<f32>, foldLimit : f32) -> vec3<f32> {
  return clamp(p, vec3<f32>(-foldLimit), vec3<f32>(foldLimit)) * 2.0 - p;
}

// Sphere fold
fn sphereFold(p : vec3<f32>, minRadius : f32, maxRadius : f32) -> vec3<f32> {
  let r2 = dot(p, p);
  let minR2 = minRadius * minRadius;
  let maxR2 = maxRadius * maxRadius;
  
  if (r2 < minR2) {
    return p * (maxR2 / minR2);
  } else if (r2 < maxR2) {
    return p * (maxR2 / r2);
  }
  return p;
}

// ============================================================================
// POST-PROCESSING
// ============================================================================

// Stylized color grading
fn stylizedGrade(
  col : vec3<f32>,
  brightness : f32,
  gamma : f32,
  saturation : f32
) -> vec3<f32> {
  var c = pow(col, vec3<f32>(gamma)) * brightness;
  c = mix(vec3<f32>(length(c)), c, saturation);
  return c;
}

// Distance fog to color
fn distanceFog(col : vec3<f32>, fogColor : vec3<f32>, dist : f32, density : f32) -> vec3<f32> {
  return mix(fogColor, col, exp(-density * dist * dist));
}

// Vignette
fn vignette(col : vec3<f32>, uv : vec2<f32>, strength : f32) -> vec3<f32> {
  let vignetteUV = uv * uv * uv;
  let vignetteFactor = pow(max(0.0, 0.95 - length(vignetteUV * vec2<f32>(1.05, 1.1))), strength);
  return col * vignetteFactor;
}
`;

export default fractalEdgesWGSL;
