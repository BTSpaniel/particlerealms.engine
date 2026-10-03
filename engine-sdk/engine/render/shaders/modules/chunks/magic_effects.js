// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

//

// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha



/**

 * Magic & Energy Effects

 *

 * Reusable patterns for magical orbs, energy shields, portals, etc.

 *

 * Key Concepts:

 *   1. Energy swirls: Rotating polar patterns

 *   2. Arcane runes: Geometric symmetry patterns

 *   3. Core pulse: Breathing/pulsing intensity

 *   4. Sparkle field: Random energy glints

 *   5. Rim glow: Fresnel-based mystical aura

 *

 * Functions:

 *   - energySwirl(pos, time, arms) - Rotating arm pattern

 *   - arcaneRunes(pos, time, symmetry) - Geometric rune overlay

 *   - magicPulse(time, speed, intensity) - Breathing effect

 *   - sparkleField(pos, time, density) - Random glints

 *   - portalRing(pos, time, radius) - Circular portal effect

 */

import {
  LEGACY_PCG32_WGSL,
  MAGIC_EFFECTS_PCG_HASH_WGSL,
} from '../../../../core/math/MathBits.js';


export const magicEffectsWGSL = /* wgsl */`

// ============================================================================

// MAGIC PATTERN FUNCTIONS

// ============================================================================



// Energy swirl - rotating arms around an axis

// arms = number of swirl arms (3-8 typical)

fn energySwirl(pos : vec3<f32>, time : f32, arms : f32) -> f32 {

  let angle = atan2(pos.z, pos.x);

  let swirlAngle = angle + time * 2.0 + pos.y * 1.5;

  return sin(swirlAngle * arms) * 0.5 + 0.5;

}



// Concentric energy rings expanding outward

fn energyRings(pos : vec3<f32>, time : f32, frequency : f32, speed : f32) -> f32 {

  let radius = length(pos.xz);

  return sin(radius * frequency - time * speed) * 0.5 + 0.5;

}



// Arcane runes - geometric patterns with N-fold symmetry

fn arcaneRunes(pos : vec3<f32>, time : f32, symmetry : f32) -> f32 {

  let angle = atan2(pos.z, pos.x);

  // Primary rune pattern

  let runeAngle = angle * symmetry * 0.5 + time;

  let rune = pow(abs(sin(runeAngle)), 8.0);

  // Secondary vertical bands

  let vertical = pow(abs(sin(pos.y * 6.0 + time * 0.5)), 4.0);

  return max(rune, vertical);

}



// Hexagonal grid pattern (for shields, barriers)

fn hexPattern(pos : vec2<f32>, scale : f32) -> f32 {

  let p = pos * scale;

  let q = vec2<f32>(p.x * 1.1547, p.y + p.x * 0.5774);

  let qi = floor(q);

  let qf = fract(q) - 0.5;

  // Distance to hex center

  let d = length(qf);

  return smoothstep(0.5, 0.4, d);

}



// Magic pulse - smooth breathing effect

fn magicPulse(time : f32, speed : f32, minVal : f32, maxVal : f32) -> f32 {

  return minVal + (maxVal - minVal) * (sin(time * speed) * 0.5 + 0.5);

}



// Double pulse - two frequencies for more organic feel

fn magicPulseDouble(time : f32, speed1 : f32, speed2 : f32) -> f32 {

  let pulse1 = sin(time * speed1) * 0.5 + 0.5;

  let pulse2 = sin(time * speed2 + 1.0) * 0.5 + 0.5;

  return pulse1 * 0.7 + pulse2 * 0.3;

}



// PCG hash - deterministic across all GPUs
${LEGACY_PCG32_WGSL}
${MAGIC_EFFECTS_PCG_HASH_WGSL}


fn pcg_hash2f(a: f32, b: f32, offset: u32) -> f32 {

    let seed = pcg_magic(bitcast<u32>(a) + pcg_magic(bitcast<u32>(b) + offset));

    return f32(seed) / 4294967295.0;

}



// Sparkle field - random energy glints

// Returns 1.0 for sparkle, 0.0 otherwise

fn sparkleField(pos : vec3<f32>, time : f32, threshold : f32) -> f32 {

  // Three layers of sparkles at different scales (deterministic PCG)

  let t = bitcast<u32>(time);

  let s1 = pcg_hash2f(pos.x, pos.z, t * 5u);

  let s2 = pcg_hash2f(pos.y, pos.z, t * 7u + 111u);

  let s3 = pcg_hash2f(pos.x, pos.y, t * 3u + 222u);



  return max(step(threshold, s1), max(step(threshold, s2), step(threshold, s3)));

}



// Soft sparkle (with falloff instead of hard threshold)

fn sparkleSoft(pos : vec3<f32>, time : f32, density : f32) -> f32 {

  let seed = pcg_magic(bitcast<u32>(pos.x) + pcg_magic(bitcast<u32>(pos.y) + pcg_magic(bitcast<u32>(pos.z) + bitcast<u32>(time * 5.0))));

  let hash = f32(seed) / 4294967295.0;

  let sparkle = pow(hash, 1.0 / density);

  return sparkle * sparkle;

}



// ============================================================================

// PORTAL / VORTEX EFFECTS

// ============================================================================



// Portal ring - circular vortex effect

fn portalRing(pos : vec3<f32>, time : f32, innerRadius : f32, outerRadius : f32) -> f32 {

  let radius = length(pos.xz);

  let angle = atan2(pos.z, pos.x);



  // Ring mask

  let inner = smoothstep(innerRadius - 0.1, innerRadius, radius);

  let outer = 1.0 - smoothstep(outerRadius, outerRadius + 0.1, radius);

  let ringMask = inner * outer;



  // Swirling pattern on ring

  let swirl = sin(angle * 8.0 - time * 4.0 + radius * 3.0) * 0.5 + 0.5;



  return ringMask * (0.5 + swirl * 0.5);

}



// Vortex distortion - for warping effects

fn vortexDistort(pos : vec2<f32>, center : vec2<f32>, strength : f32, time : f32) -> vec2<f32> {

  let toCenter = pos - center;

  let dist = length(toCenter);

  let angle = atan2(toCenter.y, toCenter.x);

  let newAngle = angle + strength / (dist + 0.1) + time;

  return center + vec2<f32>(cos(newAngle), sin(newAngle)) * dist;

}



// ============================================================================

// SHIELD / BARRIER EFFECTS

// ============================================================================



// Energy shield - hex grid with pulse on impact

fn energyShield(pos : vec3<f32>, normal : vec3<f32>, time : f32, impactPos : vec3<f32>, impactTime : f32) -> f32 {

  // Base hex pattern

  let hex = hexPattern(pos.xz, 4.0);



  // Impact ripple

  let toImpact = length(pos - impactPos);

  let timeSinceImpact = time - impactTime;

  let rippleRadius = timeSinceImpact * 3.0;

  let ripple = 1.0 - smoothstep(rippleRadius - 0.3, rippleRadius + 0.3, toImpact);

  let rippleFade = exp(-timeSinceImpact * 2.0);



  // Fresnel edge glow

  let fresnel = pow(1.0 - abs(normal.z), 3.0);



  return (hex * 0.3 + fresnel * 0.5 + ripple * rippleFade * 0.8);

}



// ============================================================================

// COLOR UTILITIES FOR MAGIC

// ============================================================================



// Hue shift for magical color variation

fn hueShift(color : vec3<f32>, shift : f32) -> vec3<f32> {

  let k = vec3<f32>(0.57735);

  let cosAngle = cos(shift);

  return color * cosAngle + cross(k, color) * sin(shift) + k * dot(k, color) * (1.0 - cosAngle);

}



// Rainbow cycle based on position/time

fn rainbowColor(phase : f32) -> vec3<f32> {

  return vec3<f32>(

    sin(phase) * 0.5 + 0.5,

    sin(phase + 2.094) * 0.5 + 0.5,

    sin(phase + 4.189) * 0.5 + 0.5

  );

}



// Mystical color palette (cool magical tones)

fn mysticalColor(t : f32, baseColor : vec3<f32>) -> vec3<f32> {

  let coolShift = vec3<f32>(0.8, 1.0, 1.2);

  let warmShift = vec3<f32>(1.2, 0.9, 0.8);

  let shifted = mix(baseColor * coolShift, baseColor * warmShift, t);

  return shifted;

}



// ============================================================================

// COMPLETE MAGIC ORB EFFECT

// ============================================================================



fn calculateMagicOrb(

  worldPos : vec3<f32>,

  viewDir : vec3<f32>,

  normal : vec3<f32>,

  time : f32,

  baseColor : vec3<f32>,

  emissiveIntensity : f32

) -> vec4<f32> {

  let NdotV = max(dot(normal, viewDir), 0.0);



  // Patterns

  let swirl = energySwirl(worldPos, time, 4.0);

  let rings = energyRings(worldPos, time, 8.0, 3.0);

  let runes = arcaneRunes(worldPos, time, 6.0);

  let sparkle = sparkleField(worldPos, time, 0.92);



  // Pulse

  let pulse = magicPulseDouble(time, 3.0, 1.7);



  // Intensities

  let coreIntensity = pow(NdotV, 1.5) * emissiveIntensity * pulse;

  let rimIntensity = pow(1.0 - NdotV, 3.0) * emissiveIntensity * 2.0;

  let runeIntensity = runes * (1.0 - NdotV) * emissiveIntensity * 0.8;



  // Colors

  let core = vec3<f32>(1.0) * coreIntensity * 0.6;

  let main = baseColor * (coreIntensity + rimIntensity * 0.5) * (0.7 + swirl * 0.3);

  let rim = mysticalColor(0.3, baseColor) * rimIntensity;

  let runeGlow = (baseColor + 0.3) * runeIntensity;

  let ringGlow = baseColor * rings * pow(1.0 - NdotV, 2.0) * 0.3;

  let sparkleGlow = (baseColor + 0.5) * sparkle * rimIntensity;



  let finalColor = core + main + rim + runeGlow + ringGlow + sparkleGlow;

  let alpha = coreIntensity * 0.4 + rimIntensity * 0.2;



  return vec4<f32>(finalColor, alpha);

}

`;



export default magicEffectsWGSL;
