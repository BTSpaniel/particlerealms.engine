// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Anime Explosion Effects
 * 
 * Stylized explosion effects inspired by anime/manga aesthetics.
 * 
 * Key Features:
 *   1. Spiky burst shapes - Sharp radial spikes
 *   2. Color banding - Discrete anime-style colors
 *   3. Impact rays - Speed lines radiating outward
 *   4. Shockwave rings - Expanding circular waves
 *   5. Debris particles - Flying sparks and chunks
 *   6. Smoke puffs - Stylized cloud shapes
 * 
 * Functions:
 *   - explosionBurst(uv, time) - Main explosion shape
 *   - impactRays(uv, count, time) - Speed lines
 *   - shockwaveRing(uv, time, speed) - Expanding ring
 *   - animeColorBand(intensity, colors) - Discrete color steps
 */

export const animeExplosionWGSL = /* wgsl */`
// ============================================================================
// ANIME EXPLOSION CONSTANTS
// ============================================================================

const PI_EXP : f32 = 3.14159265;
const TAU_EXP : f32 = 6.28318530;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Hash for randomness
fn hashExp(p : vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn hashExp2(p : vec2<f32>) -> vec2<f32> {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * vec3<f32>(0.1031, 0.1030, 0.0973));
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// Smooth noise
fn noiseExp(p : vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  
  return mix(
    mix(hashExp(i + vec2<f32>(0.0, 0.0)), hashExp(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(hashExp(i + vec2<f32>(0.0, 1.0)), hashExp(i + vec2<f32>(1.0, 1.0)), u.x),
    u.y
  );
}

// ============================================================================
// EXPLOSION BURST SHAPE
// ============================================================================

// Spiky star burst shape
fn spikyBurst(uv : vec2<f32>, spikes : f32, sharpness : f32) -> f32 {
  let angle = atan2(uv.y, uv.x);
  let dist = length(uv);
  
  // Create spikes using sine waves
  let spikePattern = sin(angle * spikes) * 0.5 + 0.5;
  let spikeShape = pow(spikePattern, sharpness);
  
  // Combine with radial falloff
  let radius = 0.3 + spikeShape * 0.4;
  return smoothstep(radius, radius - 0.1, dist);
}

// Anime explosion with irregular edges
fn explosionBurst(uv : vec2<f32>, time : f32, phase : f32) -> f32 {
  let dist = length(uv);
  let angle = atan2(uv.y, uv.x);
  
  // Expansion over time
  let expand = phase * 1.5;
  
  // Multiple spike frequencies for complexity
  var edge = 0.0;
  edge += sin(angle * 5.0 + time * 2.0) * 0.15;
  edge += sin(angle * 8.0 - time * 3.0) * 0.1;
  edge += sin(angle * 13.0 + time) * 0.05;
  
  // Add noise for organic feel
  let noiseVal = noiseExp(vec2<f32>(angle * 2.0, time)) * 0.1;
  edge += noiseVal;
  
  // Explosion radius with irregular edge
  let radius = expand * (0.5 + edge);
  
  // Hard edge for anime style
  return smoothstep(radius, radius - 0.02, dist);
}

// Inner core (brighter center)
fn explosionCore(uv : vec2<f32>, phase : f32) -> f32 {
  let dist = length(uv);
  let coreRadius = phase * 0.3;
  return smoothstep(coreRadius, 0.0, dist);
}

// ============================================================================
// IMPACT RAYS (Speed Lines)
// ============================================================================

// Radial speed lines
fn impactRays(uv : vec2<f32>, rayCount : f32, time : f32, phase : f32) -> f32 {
  let angle = atan2(uv.y, uv.x);
  let dist = length(uv);
  
  // Create rays
  let rayAngle = fract(angle / TAU_EXP * rayCount);
  let rayPattern = abs(rayAngle - 0.5) * 2.0;
  let ray = smoothstep(0.1, 0.0, rayPattern);
  
  // Rays extend outward over time
  let minDist = phase * 0.2;
  let maxDist = phase * 1.5;
  let rayMask = smoothstep(minDist, minDist + 0.1, dist) * smoothstep(maxDist, maxDist - 0.3, dist);
  
  // Animate individual rays
  let rayNoise = hashExp(vec2<f32>(floor(angle / TAU_EXP * rayCount), 0.0));
  let rayAlpha = step(0.3, rayNoise);
  
  return ray * rayMask * rayAlpha;
}

// Thick dramatic rays
fn dramaticRays(uv : vec2<f32>, rayCount : f32, thickness : f32, phase : f32) -> f32 {
  let angle = atan2(uv.y, uv.x);
  let dist = length(uv);
  
  var rays = 0.0;
  for (var i = 0; i < 12; i = i + 1) {
    let rayAngle = f32(i) / 12.0 * TAU_EXP;
    let angleDiff = abs(atan2(sin(angle - rayAngle), cos(angle - rayAngle)));
    let ray = smoothstep(thickness, 0.0, angleDiff);
    
    // Random length per ray
    let rayLen = 0.5 + hashExp(vec2<f32>(f32(i), 1.0)) * 0.5;
    let rayMask = smoothstep(0.1, 0.2, dist) * smoothstep(rayLen * phase, rayLen * phase - 0.2, dist);
    
    rays = max(rays, ray * rayMask);
  }
  
  return rays;
}

// ============================================================================
// SHOCKWAVE RING
// ============================================================================

// Expanding shockwave
fn shockwaveRing(uv : vec2<f32>, time : f32, speed : f32, thickness : f32) -> f32 {
  let dist = length(uv);
  let ringRadius = time * speed;
  
  // Ring with soft edges
  let ring = smoothstep(ringRadius - thickness, ringRadius, dist) *
             smoothstep(ringRadius + thickness, ringRadius, dist);
  
  // Fade as it expands
  let fade = 1.0 - smoothstep(0.0, 1.5, ringRadius);
  
  return ring * fade;
}

// Multiple shockwave rings
fn multiShockwave(uv : vec2<f32>, time : f32, count : i32) -> f32 {
  var waves = 0.0;
  
  for (var i = 0; i < count; i = i + 1) {
    let delay = f32(i) * 0.15;
    let t = max(0.0, time - delay);
    waves += shockwaveRing(uv, t, 0.8, 0.03) * (1.0 - f32(i) * 0.2);
  }
  
  return min(waves, 1.0);
}

// Distorted shockwave
fn distortedShockwave(uv : vec2<f32>, time : f32) -> f32 {
  let angle = atan2(uv.y, uv.x);
  let dist = length(uv);
  
  // Add wobble to the ring
  let wobble = sin(angle * 6.0 + time * 5.0) * 0.02;
  let ringRadius = time * 0.7 + wobble;
  
  let ring = smoothstep(ringRadius - 0.04, ringRadius, dist) *
             smoothstep(ringRadius + 0.04, ringRadius, dist);
  
  return ring * (1.0 - time * 0.8);
}

// ============================================================================
// ANIME COLOR BANDING
// ============================================================================

// Discrete color steps (anime style)
fn animeColorBand(intensity : f32, steps : f32) -> f32 {
  return floor(intensity * steps) / steps;
}

// Classic anime explosion colors
fn animeExplosionColor(intensity : f32, phase : f32) -> vec3<f32> {
  // White core -> Yellow -> Orange -> Red -> Dark red -> Black
  let white = vec3<f32>(1.0, 1.0, 0.95);
  let yellow = vec3<f32>(1.0, 0.95, 0.3);
  let orange = vec3<f32>(1.0, 0.5, 0.1);
  let red = vec3<f32>(0.9, 0.2, 0.05);
  let darkRed = vec3<f32>(0.4, 0.05, 0.02);
  let black = vec3<f32>(0.1, 0.05, 0.02);
  
  // Discrete banding
  let t = animeColorBand(intensity, 5.0);
  
  var col = black;
  col = mix(col, darkRed, smoothstep(0.0, 0.2, t));
  col = mix(col, red, smoothstep(0.2, 0.4, t));
  col = mix(col, orange, smoothstep(0.4, 0.6, t));
  col = mix(col, yellow, smoothstep(0.6, 0.8, t));
  col = mix(col, white, smoothstep(0.8, 1.0, t));
  
  // Add emissive boost
  col = col * (1.0 + intensity * 2.0);
  
  return col;
}

// Energy blast colors (blue/cyan)
fn energyBlastColor(intensity : f32) -> vec3<f32> {
  let white = vec3<f32>(1.0, 1.0, 1.0);
  let cyan = vec3<f32>(0.3, 0.9, 1.0);
  let blue = vec3<f32>(0.1, 0.4, 1.0);
  let darkBlue = vec3<f32>(0.05, 0.1, 0.4);
  
  let t = animeColorBand(intensity, 4.0);
  
  var col = darkBlue;
  col = mix(col, blue, smoothstep(0.0, 0.33, t));
  col = mix(col, cyan, smoothstep(0.33, 0.66, t));
  col = mix(col, white, smoothstep(0.66, 1.0, t));
  
  return col * (1.0 + intensity * 3.0);
}

// ============================================================================
// DEBRIS & SPARKS
// ============================================================================

// Flying debris particles
fn debrisParticles(uv : vec2<f32>, time : f32, count : i32) -> f32 {
  var particles = 0.0;
  
  for (var i = 0; i < count; i = i + 1) {
    // Random initial direction
    let seed = vec2<f32>(f32(i), f32(i) * 1.3);
    let randAngle = hashExp(seed) * TAU_EXP;
    let randSpeed = 0.5 + hashExp(seed + 1.0) * 1.0;
    let randSize = 0.01 + hashExp(seed + 2.0) * 0.02;
    
    // Particle position (with gravity)
    var particlePos = vec2<f32>(cos(randAngle), sin(randAngle)) * randSpeed * time;
    particlePos.y -= time * time * 0.3;  // Gravity
    
    // Distance to particle
    let d = length(uv - particlePos);
    
    // Particle with trail
    let particle = smoothstep(randSize, 0.0, d);
    
    // Fade over time
    let fade = 1.0 - smoothstep(0.5, 1.5, time);
    
    particles += particle * fade;
  }
  
  return min(particles, 1.0);
}

// Spark trails
fn sparkTrails(uv : vec2<f32>, time : f32, count : i32) -> f32 {
  var sparks = 0.0;
  
  for (var i = 0; i < count; i = i + 1) {
    let seed = vec2<f32>(f32(i) * 7.3, f32(i) * 13.7);
    let angle = hashExp(seed) * TAU_EXP;
    let speed = 0.8 + hashExp(seed + 1.0) * 0.8;
    
    // Spark position
    let sparkPos = vec2<f32>(cos(angle), sin(angle)) * speed * time;
    
    // Trail effect (line from origin to current pos)
    let toSpark = sparkPos;
    let toPoint = uv;
    let t = clamp(dot(toPoint, toSpark) / dot(toSpark, toSpark), 0.0, 1.0);
    let closest = toSpark * t;
    let d = length(uv - closest);
    
    // Thin bright trail
    let trail = smoothstep(0.015, 0.0, d) * t;
    
    // Bright head
    let head = smoothstep(0.02, 0.0, length(uv - sparkPos)) * 2.0;
    
    sparks += (trail + head) * (1.0 - time * 0.5);
  }
  
  return min(sparks, 1.0);
}

// ============================================================================
// SMOKE PUFFS
// ============================================================================

// Stylized smoke cloud
fn smokePuff(uv : vec2<f32>, center : vec2<f32>, size : f32, time : f32) -> f32 {
  let p = (uv - center) / size;
  
  // Base circle with noise displacement
  let angle = atan2(p.y, p.x);
  let dist = length(p);
  
  var edge = 1.0;
  edge += noiseExp(vec2<f32>(angle * 3.0 + time, time)) * 0.3;
  edge += noiseExp(vec2<f32>(angle * 7.0 - time * 0.5, time * 0.3)) * 0.15;
  
  return smoothstep(edge, edge - 0.2, dist);
}

// Rising smoke column
fn smokeColumn(uv : vec2<f32>, time : f32, phase : f32) -> f32 {
  var smoke = 0.0;
  
  // Multiple puffs rising
  for (var i = 0; i < 5; i = i + 1) {
    let delay = f32(i) * 0.2;
    let t = max(0.0, time - delay);
    
    let riseSpeed = 0.3 + f32(i) * 0.1;
    let center = vec2<f32>(
      sin(f32(i) * 2.3 + t) * 0.1,
      t * riseSpeed
    );
    
    let size = 0.15 + t * 0.2;
    let puff = smokePuff(uv, center, size, t);
    let fade = 1.0 - smoothstep(0.5, 2.0, t);
    
    smoke = max(smoke, puff * fade * 0.6);
  }
  
  return smoke;
}

// ============================================================================
// COMPLETE ANIME EXPLOSION
// ============================================================================

struct AnimeExplosionResult {
  color : vec3<f32>,
  alpha : f32,
  emission : f32,
}

fn renderAnimeExplosion(
  uv : vec2<f32>,
  time : f32,
  duration : f32
) -> AnimeExplosionResult {
  var result : AnimeExplosionResult;
  
  // Normalized phase (0 = start, 1 = end)
  let phase = clamp(time / duration, 0.0, 1.0);
  
  // Main explosion burst
  let burst = explosionBurst(uv, time, phase);
  let core = explosionCore(uv, phase);
  
  // Impact rays
  let rays = impactRays(uv, 16.0, time, phase) * (1.0 - phase);
  
  // Shockwave
  let shockwave = multiShockwave(uv, time * 0.8, 3);
  
  // Sparks (delayed start)
  let sparks = sparkTrails(uv, max(0.0, time - 0.1), 20) * step(0.1, time);
  
  // Smoke (appears later)
  let smoke = smokeColumn(uv, max(0.0, time - 0.3), phase) * step(0.3, time);
  
  // Combine intensity
  let intensity = core + burst * 0.7 + rays * 0.5 + sparks;
  
  // Color based on intensity
  result.color = animeExplosionColor(clamp(intensity, 0.0, 1.0), phase);
  
  // Add shockwave (white flash)
  result.color = result.color + vec3<f32>(1.0) * shockwave * 0.5;
  
  // Add smoke (dark)
  result.color = mix(result.color, vec3<f32>(0.2, 0.15, 0.1), smoke * 0.7);
  
  // Alpha and emission
  result.alpha = clamp(burst + rays * 0.3 + shockwave * 0.5 + smoke, 0.0, 1.0);
  result.emission = intensity * (1.0 - phase * 0.5);
  
  return result;
}

// Energy blast variant (for beam attacks)
fn renderEnergyBlast(
  uv : vec2<f32>,
  time : f32
) -> AnimeExplosionResult {
  var result : AnimeExplosionResult;
  
  let phase = clamp(time / 0.5, 0.0, 1.0);
  
  // Expanding ring burst
  let dist = length(uv);
  let burstRadius = phase * 0.8;
  let burst = smoothstep(burstRadius, burstRadius - 0.1, dist) * (1.0 - phase);
  
  // Core flash
  let core = smoothstep(0.3, 0.0, dist) * (1.0 - phase * 0.8);
  
  // Rays
  let rays = dramaticRays(uv, 12.0, 0.08, phase);
  
  // Intensity
  let intensity = core + burst * 0.5 + rays * 0.8;
  
  result.color = energyBlastColor(clamp(intensity, 0.0, 1.0));
  result.alpha = clamp(intensity, 0.0, 1.0);
  result.emission = intensity * 2.0;
  
  return result;
}
`;

export default animeExplosionWGSL;
