// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Electricity & Plasma Effects
 * 
 * Patterns for lightning, plasma, energy beams, and electrical arcs.
 * 
 * Key Concepts:
 *   1. Simplex 3D noise - Smooth organic patterns
 *   2. Sharp glow falloff - Electric intensity
 *   3. Color intensification - Plasma color math
 *   4. Animated distortion - Moving energy
 * 
 * Functions:
 *   - simplex3d(p) - 3D simplex noise
 *   - electricNoise(p) - Multi-octave electric noise
 *   - plasmaGlow(intensity, falloff) - Sharp glow
 *   - electricArc(uv, time) - Lightning bolt pattern
 *   - plasmaColor(intensity, baseColor) - Energy coloring
 */

export const electricityWGSL = /* wgsl */`
// ============================================================================
// SIMPLEX 3D NOISE (Organic patterns for electricity)
// ============================================================================

// Simplex constants
const F3 : f32 = 0.3333333;
const G3 : f32 = 0.1666667;

// Pseudo-random 3D -> 3D
fn random3(c : vec3<f32>) -> vec3<f32> {
  let j = 4096.0 * sin(dot(c, vec3<f32>(17.0, 59.4, 15.0)));
  var r : vec3<f32>;
  r.z = fract(512.0 * j);
  let j2 = j * 0.125;
  r.x = fract(512.0 * j2);
  let j3 = j2 * 0.125;
  r.y = fract(512.0 * j3);
  return r - 0.5;
}

// 3D Simplex noise
fn simplex3d(p : vec3<f32>) -> f32 {
  // Find tetrahedron vertices
  let s = floor(p + dot(p, vec3<f32>(F3)));
  let x = p - s + dot(s, vec3<f32>(G3));
  
  // Calculate i1 and i2
  let e = step(vec3<f32>(0.0), x - x.yzx);
  let i1 = e * (1.0 - e.zxy);
  let i2 = 1.0 - e.zxy * (1.0 - e);
  
  // Unskewed coordinates relative to vertices
  let x1 = x - i1 + G3;
  let x2 = x - i2 + 2.0 * G3;
  let x3 = x - 1.0 + 3.0 * G3;
  
  // Surflet weights
  var w : vec4<f32>;
  w.x = dot(x, x);
  w.y = dot(x1, x1);
  w.z = dot(x2, x2);
  w.w = dot(x3, x3);
  
  // Fade from 0.6 at center to 0.0 at margin
  w = max(vec4<f32>(0.6) - w, vec4<f32>(0.0));
  
  // Surflet components
  var d : vec4<f32>;
  d.x = dot(random3(s), x);
  d.y = dot(random3(s + i1), x1);
  d.z = dot(random3(s + i2), x2);
  d.w = dot(random3(s + 1.0), x3);
  
  // w^4 * d
  w = w * w;
  w = w * w;
  d = d * w;
  
  return dot(d, vec4<f32>(52.0));
}

// Multi-octave simplex noise
fn simplexFbm(p : vec3<f32>, octaves : i32) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var frequency = 1.0;
  
  for (var i = 0; i < octaves; i = i + 1) {
    value = value + amplitude * simplex3d(p * frequency);
    frequency = frequency * 2.0;
    amplitude = amplitude * 0.5;
  }
  
  return value;
}

// Standard electric noise (4 octaves)
fn electricNoise(p : vec3<f32>) -> f32 {
  return 0.5333333 * simplex3d(p)
       + 0.2666667 * simplex3d(2.0 * p)
       + 0.1333333 * simplex3d(4.0 * p)
       + 0.0666667 * simplex3d(8.0 * p);
}

// ============================================================================
// PLASMA GLOW (Sharp electric intensity)
// ============================================================================

// Sharp glow falloff (smaller power = sharper glow)
fn plasmaGlow(dist : f32, falloff : f32) -> f32 {
  return pow(max(dist, 0.0001), falloff);
}

// Inverse glow (bright at center, dark at edges)
fn plasmaGlowInverse(dist : f32, falloff : f32) -> f32 {
  return 1.0 - pow(max(dist, 0.0001), falloff);
}

// Soft glow with core
fn electricGlow(dist : f32, coreSize : f32, glowSize : f32) -> f32 {
  let core = smoothstep(coreSize, 0.0, dist);
  let glow = exp(-dist * dist / (glowSize * glowSize));
  return core + glow * 0.5;
}

// ============================================================================
// PLASMA COLORING
// ============================================================================

// Classic plasma color intensification
// Squares color multiple times for intense, saturated look
fn plasmaColor(intensity : f32, baseColor : vec3<f32>) -> vec3<f32> {
  let g = pow(intensity, 0.2);  // Sharp falloff
  var col = baseColor * (1.0 - g) + baseColor;
  col = col * col;  // Square once
  col = col * col;  // Square again (total x^4)
  return col;
}

// Electric color with core and corona
fn electricColor(
  dist : f32,
  coreColor : vec3<f32>,
  coronaColor : vec3<f32>,
  coreSize : f32
) -> vec3<f32> {
  let coreFactor = smoothstep(coreSize, 0.0, dist);
  let coronaFactor = exp(-dist * 2.0);
  
  let core = coreColor * coreFactor * 2.0;
  let corona = coronaColor * coronaFactor;
  
  return core + corona;
}

// Temperature-based plasma color (cold blue -> hot white)
fn plasmaTemperature(temp : f32) -> vec3<f32> {
  // Cold: blue/purple
  let cold = vec3<f32>(0.3, 0.4, 1.0);
  // Mid: cyan/white
  let mid = vec3<f32>(0.7, 0.9, 1.0);
  // Hot: white/yellow
  let hot = vec3<f32>(1.0, 1.0, 0.9);
  
  var col = cold;
  col = mix(col, mid, smoothstep(0.0, 0.5, temp));
  col = mix(col, hot, smoothstep(0.5, 1.0, temp));
  
  return col;
}

// ============================================================================
// ELECTRIC ARC / LIGHTNING
// ============================================================================

// Simple lightning bolt along Y axis
fn electricArc(uv : vec2<f32>, time : f32, frequency : f32, amplitude : f32) -> f32 {
  let noisePos = vec3<f32>(uv.y * frequency, time, 0.0);
  let offset = electricNoise(noisePos) * amplitude;
  
  // Distance from displaced center line
  let dist = abs(uv.x - offset);
  
  return dist;
}

// Branching lightning
fn lightningBolt(
  uv : vec2<f32>,
  time : f32,
  segments : i32,
  branchProb : f32
) -> f32 {
  var minDist = 1.0;
  var pos = vec2<f32>(0.0, -1.0);
  var dir = vec2<f32>(0.0, 1.0);
  let segmentLen = 2.0 / f32(segments);
  
  for (var i = 0; i < segments; i = i + 1) {
    // Random deviation
    let noise = simplex3d(vec3<f32>(f32(i), time * 10.0, 0.0));
    dir.x = dir.x + noise * 0.5;
    dir = normalize(dir);
    
    let nextPos = pos + dir * segmentLen;
    
    // Distance to line segment
    let pa = uv - pos;
    let ba = nextPos - pos;
    let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    let dist = length(pa - ba * h);
    
    minDist = min(minDist, dist);
    pos = nextPos;
  }
  
  return minDist;
}

// Electric arc between two points
fn arcBetweenPoints(
  uv : vec2<f32>,
  p1 : vec2<f32>,
  p2 : vec2<f32>,
  time : f32,
  thickness : f32
) -> f32 {
  let dir = p2 - p1;
  let len = length(dir);
  let n = normalize(dir);
  
  // Project point onto line
  let t = dot(uv - p1, n) / len;
  let projected = p1 + n * t * len;
  
  // Perpendicular distance
  let perpDist = length(uv - projected);
  
  // Add noise displacement
  let noisePos = vec3<f32>(t * 10.0, time * 5.0, 0.0);
  let displacement = simplex3d(noisePos) * 0.1 * sin(t * 3.14159);
  
  let dist = abs(perpDist - displacement);
  
  // Only render between points
  let inRange = step(0.0, t) * step(t, 1.0);
  
  return dist + (1.0 - inRange) * 10.0;
}

// ============================================================================
// PLASMA FIELD EFFECTS
// ============================================================================

// Animated plasma field
fn plasmaField(uv : vec2<f32>, time : f32, scale : f32) -> f32 {
  let p = vec3<f32>(uv * scale, time * 0.4);
  return electricNoise(p * 12.0 + 12.0);
}

// Plasma with horizontal concentration (like the original shader)
fn horizontalPlasma(uv : vec2<f32>, time : f32) -> f32 {
  let p = vec3<f32>(uv, time * 0.4);
  let intensity = electricNoise(p * 12.0 + 12.0);
  
  // Concentrate toward center (horizontal)
  let t = clamp(uv.x * -uv.x * 0.16 + 0.15, 0.0, 1.0);
  let y = abs(intensity * -t + uv.y);
  
  return y;
}

// Spherical plasma (for orbs)
fn sphericalPlasma(pos : vec3<f32>, center : vec3<f32>, time : f32, radius : f32) -> f32 {
  let localPos = (pos - center) / radius;
  let dist = length(localPos);
  
  // Noise on sphere surface
  let surfaceNoise = electricNoise(localPos * 5.0 + vec3<f32>(time, 0.0, 0.0));
  
  // Combine distance and noise
  return dist + surfaceNoise * 0.1;
}

// ============================================================================
// COMPLETE ELECTRICITY EFFECT
// ============================================================================

// Full plasma electricity render
fn renderElectricity(
  uv : vec2<f32>,
  time : f32,
  baseColor : vec3<f32>
) -> vec3<f32> {
  // Get plasma intensity
  let plasmaY = horizontalPlasma(uv, time);
  
  // Sharp glow falloff
  let glow = plasmaGlow(plasmaY, 0.2);
  
  // Intensify color
  var col = baseColor * (1.0 - glow) + baseColor;
  col = col * col;
  col = col * col;
  
  return col;
}

// Electric arc with glow
fn renderElectricArc(
  uv : vec2<f32>,
  time : f32,
  arcColor : vec3<f32>,
  glowColor : vec3<f32>
) -> vec3<f32> {
  // Get arc distance
  let arcDist = electricArc(uv, time, 8.0, 0.3);
  
  // Core (bright center)
  let core = smoothstep(0.02, 0.0, arcDist);
  
  // Glow (softer falloff)
  let glow = exp(-arcDist * 10.0);
  
  // Flicker
  let flicker = 0.8 + 0.2 * sin(time * 30.0 + uv.y * 20.0);
  
  return (arcColor * core + glowColor * glow) * flicker;
}

// Lightning bolt with branches
fn renderLightning(
  uv : vec2<f32>,
  time : f32,
  boltColor : vec3<f32>
) -> vec3<f32> {
  let dist = lightningBolt(uv, time, 12, 0.3);
  
  // Sharp core
  let core = smoothstep(0.03, 0.0, dist);
  
  // Outer glow
  let glow = exp(-dist * 15.0) * 0.5;
  
  // Random flash intensity
  let flash = 0.5 + 0.5 * simplex3d(vec3<f32>(time * 20.0, 0.0, 0.0));
  
  return boltColor * (core + glow) * flash;
}
`;

export default electricityWGSL;
