// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Fire & Turbulence Effects
 * 
 * Reusable patterns for fire, smoke, and turbulent effects.
 * Based on multi-frequency wave accumulation technique.
 * 
 * Key Concepts:
 *   1. Turbulence: Sum of cos() waves at increasing frequencies
 *   2. Twist: Rotate XZ based on Y for spiral motion
 *   3. Expansion: Divide by height for spreading flames
 *   4. Hollow cone SDF: Classic flame silhouette shape
 * 
 * Functions:
 *   - fireTurbulence(pos, time, octaves) - Multi-octave distortion
 *   - fireColor(heat, turbulence) - Heat-based color gradient
 *   - flameShape(pos) - Hollow cone distance field
 *   - twistPosition(pos, rate) - Helical twist transform
 */

export const fireTurbulenceWGSL = /* wgsl */`
// ============================================================================
// FIRE TURBULENCE FUNCTIONS
// ============================================================================

// Multi-octave turbulence distortion
// Returns a vec3 displacement to add to position
fn fireTurbulence(pos : vec3<f32>, time : f32, octaves : i32) -> vec3<f32> {
  var turbulence = vec3<f32>(0.0);
  var freq = 2.0;
  
  for (var i = 0; i < octaves; i = i + 1) {
    // Phase offset for organic motion
    let phase = vec3<f32>(
      time * 0.3,
      time * 0.5 + f32(i) * 0.7,
      f32(i) * 1.3
    );
    // Accumulate wave at this frequency (yzx swizzle adds variation)
    turbulence = turbulence + cos((pos.yzx + phase) * freq) / freq;
    freq = freq * 1.7;
  }
  
  return turbulence;
}

// Simplified turbulence (faster, 3 octaves hardcoded)
fn fireTurbulenceFast(pos : vec3<f32>, time : f32) -> vec3<f32> {
  var p = pos;
  var turb = vec3<f32>(0.0);
  
  // Octave 1
  turb = turb + cos((p.yzx + vec3<f32>(time * 0.3, time * 0.5, 0.0)) * 2.0) * 0.5;
  // Octave 2
  turb = turb + cos((p.yzx + vec3<f32>(time * 0.3, time * 0.5 + 0.7, 1.3)) * 3.4) * 0.29;
  // Octave 3
  turb = turb + cos((p.yzx + vec3<f32>(time * 0.3, time * 0.5 + 1.4, 2.6)) * 5.8) * 0.17;
  
  return turb;
}

// Twist transform - rotates XZ based on Y position
// Creates helical/spiral motion in fire
fn twistPosition(pos : vec3<f32>, twistRate : f32) -> vec3<f32> {
  let angle = pos.y * twistRate;
  let c = cos(angle);
  let s = sin(angle);
  return vec3<f32>(
    pos.x * c - pos.z * s,
    pos.y,
    pos.x * s + pos.z * c
  );
}

// Expand position outward based on height
// Makes fire spread wider as it rises
fn expandUpward(pos : vec3<f32>, rate : f32, minScale : f32) -> vec3<f32> {
  let scale = max(pos.y * rate + 1.0, minScale);
  return vec3<f32>(pos.x / scale, pos.y, pos.z / scale);
}

// Hollow cone distance field (classic flame shape)
// Returns distance to flame surface
fn flameShapeSDF(pos : vec3<f32>, coneSlope : f32, radius : f32) -> f32 {
  let r = length(pos.xz);
  return r + pos.y * coneSlope - radius;
}

// Convert flame SDF to soft mask
fn flameMask(sdf : f32, softness : f32) -> f32 {
  return 1.0 - smoothstep(-softness, softness, sdf);
}

// ============================================================================
// FIRE COLOR FUNCTIONS  
// ============================================================================

// Heat-based fire color (white → yellow → orange → red → black)
fn fireColorGradient(heat : f32) -> vec3<f32> {
  // Approximate blackbody radiation colors
  let white = vec3<f32>(1.0, 1.0, 0.9);
  let yellow = vec3<f32>(1.0, 0.9, 0.3);
  let orange = vec3<f32>(1.0, 0.5, 0.1);
  let red = vec3<f32>(0.8, 0.2, 0.05);
  let dark = vec3<f32>(0.1, 0.02, 0.0);
  
  var color = dark;
  color = mix(color, red, smoothstep(0.0, 0.25, heat));
  color = mix(color, orange, smoothstep(0.25, 0.5, heat));
  color = mix(color, yellow, smoothstep(0.5, 0.75, heat));
  color = mix(color, white, smoothstep(0.75, 1.0, heat));
  
  return color;
}

// Stylized fire color with customizable palette
fn fireColorCustom(heat : f32, hotColor : vec3<f32>, midColor : vec3<f32>, coolColor : vec3<f32>) -> vec3<f32> {
  var color = coolColor;
  color = mix(color, midColor, smoothstep(0.0, 0.5, heat));
  color = mix(color, hotColor, smoothstep(0.5, 1.0, heat));
  return color;
}

// Fire flicker animation
fn fireFlicker(pos : vec3<f32>, time : f32, intensity : f32) -> f32 {
  let noise = sin(time * 12.0 + pos.x * 5.0) * sin(time * 8.0 + pos.z * 4.0);
  return 1.0 - intensity + intensity * (noise * 0.5 + 0.5);
}

// ============================================================================
// COMPLETE FIRE EFFECT
// ============================================================================

// All-in-one fire calculation
// Returns vec4(color.rgb, alpha)
fn calculateFire(
  worldPos : vec3<f32>,
  time : f32,
  baseColor : vec3<f32>,
  emissiveIntensity : f32
) -> vec4<f32> {
  // Animate upward
  var pos = worldPos;
  pos.y = pos.y - time * 0.8;
  
  // Apply turbulence
  let turb = fireTurbulenceFast(pos, time);
  pos = pos + turb * 0.4;
  
  // Twist and expand
  pos = twistPosition(pos, 0.5);
  pos = expandUpward(pos, 0.15, 0.2);
  
  // Flame shape
  let sdf = flameShapeSDF(pos, 0.25, 0.4);
  let mask = flameMask(sdf, 0.25);
  
  // Heat based on position and turbulence
  let turbIntensity = length(turb);
  let heightFade = clamp(1.0 - pos.y * 0.3, 0.0, 1.0);
  let heat = mask * (0.5 + turbIntensity * 0.3) * heightFade;
  
  // Color
  let coreColor = fireColorGradient(heat * 1.2) * emissiveIntensity;
  let tintColor = baseColor * mask * emissiveIntensity * 0.5;
  let flicker = fireFlicker(worldPos, time, 0.15);
  
  let finalColor = (coreColor + tintColor) * flicker;
  let alpha = heat * 0.7;
  
  return vec4<f32>(finalColor, alpha);
}
`;

export default fireTurbulenceWGSL;
