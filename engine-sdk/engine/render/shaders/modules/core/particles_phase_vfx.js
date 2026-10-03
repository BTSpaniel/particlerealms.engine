// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * particles_phase_vfx.js - Phase Transition Visual Effects Shader (GAP 43)
 *
 * Visual feedback when particles change phase:
 *   - Melt: wet/glossy sheen, drip distortion
 *   - Freeze: frost crystallization pattern, ice crackle
 *   - Boil: bubble emission pattern, steam distortion
 *   - Ionize: plasma glow + electricity arcs
 *
 * Per-particle phase from thermalData.y → drives material blend in fragment.
 * Transition animation uses latentEnergy (thermalData.w) as 0→1 progress.
 */

import {
  LEGACY_PCG32_WGSL,
  PHASE_VFX_PCG_HASH_WGSL,
} from '../../../../core/math/MathBits.js';

export const phaseVFXWGSL = /* wgsl */`
// ============================================================================
// PHASE TRANSITION VISUAL EFFECTS
// ============================================================================

// Phase constants
const PHASE_SOLID: f32 = 0.0;
const PHASE_LIQUID: f32 = 1.0;
const PHASE_GAS: f32 = 2.0;
const PHASE_PLASMA: f32 = 3.0;

// PCG hash for deterministic noise
${LEGACY_PCG32_WGSL}
${PHASE_VFX_PCG_HASH_WGSL}

fn phaseHash(p: vec2<f32>) -> f32 {
  let seed = pcg_phase(bitcast<u32>(p.x * 100.0) + pcg_phase(bitcast<u32>(p.y * 100.0)));
  return f32(seed) / 4294967295.0;
}

// ============================================================================
// FROST / FREEZE EFFECT
// ============================================================================

// Frost crystal pattern: Voronoi-based crystallization
fn frostPattern(uv: vec2<f32>, time: f32, progress: f32) -> f32 {
  let scale = 6.0;
  let p = uv * scale;
  let ip = floor(p);
  let fp = fract(p);

  var minDist = 1.0;
  for (var dy = -1.0; dy <= 1.0; dy += 1.0) {
    for (var dx = -1.0; dx <= 1.0; dx += 1.0) {
      let neighbor = vec2<f32>(dx, dy);
      let cellId = ip + neighbor;
      let h1 = phaseHash(cellId);
      let h2 = phaseHash(cellId + vec2<f32>(37.0, 17.0));
      let cellPoint = neighbor + vec2<f32>(h1, h2) * 0.5 + 0.25;
      let diff = cellPoint - fp;
      let dist = length(diff);
      minDist = min(minDist, dist);
    }
  }

  // Crystal edges appear as progress increases
  let edgeWidth = 0.05 + progress * 0.15;
  let crystal = smoothstep(edgeWidth + 0.02, edgeWidth, minDist);

  // Frost grows from center outward
  let centerDist = length(uv - vec2<f32>(0.5));
  let growthRadius = progress * 1.5;
  let growthMask = smoothstep(growthRadius + 0.1, growthRadius, centerDist);

  return crystal * growthMask;
}

// Apply freeze visual effect to color
fn applyFreezeEffect(
  baseColor: vec3<f32>,
  uv: vec2<f32>,
  time: f32,
  progress: f32, // 0 = liquid, 1 = fully frozen
) -> vec3<f32> {
  let frost = frostPattern(uv, time, progress);

  // Ice color: white-blue tint
  let iceColor = vec3<f32>(0.85, 0.92, 1.0);
  let frostedColor = mix(baseColor, iceColor, frost * 0.8);

  // Specular highlight on ice crystals
  let specular = frost * 0.3;

  return frostedColor + vec3<f32>(specular);
}

// ============================================================================
// MELT EFFECT
// ============================================================================

// Apply melt visual effect: wet sheen + drip distortion
fn applyMeltEffect(
  baseColor: vec3<f32>,
  uv: vec2<f32>,
  time: f32,
  progress: f32, // 0 = solid, 1 = fully liquid
) -> vec3<f32> {
  // Wet sheen: darken slightly + add reflective highlights
  let wetColor = baseColor * (0.7 + 0.3 * progress);

  // Drip distortion: vertical stretching
  let dripNoise = phaseHash(uv * 3.0 + vec2<f32>(0.0, time * 0.5));
  let dripMask = smoothstep(0.4, 0.6, progress) * smoothstep(0.3, 0.0, abs(uv.x - 0.5));
  let dripAmount = dripNoise * dripMask * 0.2;

  // Glossy highlight
  let glossy = smoothstep(0.7, 0.9, progress);
  let highlight = glossy * 0.15 * smoothstep(0.6, 0.4, length(uv - vec2<f32>(0.3, 0.3)));

  return wetColor + vec3<f32>(highlight + dripAmount * 0.1);
}

// ============================================================================
// BOIL EFFECT
// ============================================================================

// Bubble pattern for boiling
fn bubblePattern(uv: vec2<f32>, time: f32, progress: f32) -> f32 {
  var bubbleIntensity = 0.0;

  // Multiple bubble seeds
  for (var i = 0u; i < 8u; i++) {
    let fi = f32(i);
    let h = phaseHash(vec2<f32>(fi * 13.7, fi * 29.3));
    let bx = fract(h + time * (0.1 + h * 0.2));
    let by = fract(h * 1.7 + time * (0.3 + h * 0.1));
    let bPos = vec2<f32>(bx, by);
    let dist = length(uv - bPos);
    let bubbleSize = 0.02 + h * 0.04;
    let bubble = smoothstep(bubbleSize + 0.01, bubbleSize, dist);
    bubbleIntensity += bubble;
  }

  return clamp(bubbleIntensity * progress, 0.0, 1.0);
}

// Apply boil visual effect
fn applyBoilEffect(
  baseColor: vec3<f32>,
  uv: vec2<f32>,
  time: f32,
  progress: f32, // 0 = liquid, 1 = fully gas
) -> vec3<f32> {
  let bubbles = bubblePattern(uv, time, progress);

  // Bubbles are bright spots
  let bubbleColor = baseColor * 1.3 + vec3<f32>(0.2, 0.15, 0.1);
  let result = mix(baseColor, bubbleColor, bubbles);

  // Steam: fade to transparent white at high progress
  let steamAmount = smoothstep(0.6, 1.0, progress);
  let steamColor = vec3<f32>(0.9, 0.9, 0.95);
  return mix(result, steamColor, steamAmount * 0.5);
}

// ============================================================================
// IONIZATION / PLASMA EFFECT
// ============================================================================

// Apply plasma ionization effect
fn applyIonizeEffect(
  baseColor: vec3<f32>,
  uv: vec2<f32>,
  time: f32,
  progress: f32, // 0 = gas, 1 = fully plasma
) -> vec3<f32> {
  // Electric arc noise
  let p = vec2<f32>(uv.y * 8.0 + time * 3.0, uv.x * 4.0);
  let arcNoise = phaseHash(p) * phaseHash(p + vec2<f32>(17.0, 31.0));
  let arc = smoothstep(0.3, 0.7, arcNoise) * progress;

  // Plasma glow: blue-white core
  let plasmaColor = vec3<f32>(0.4, 0.6, 1.0);
  let coreColor = vec3<f32>(1.0, 1.0, 1.0);
  let glowColor = mix(plasmaColor, coreColor, arc);

  // Pulsating emission
  let pulse = 0.7 + 0.3 * sin(time * 8.0 + uv.x * 6.28);
  let emission = glowColor * (progress * pulse * 2.0);

  return baseColor + emission + vec3<f32>(arc * 0.5);
}

// ============================================================================
// UNIFIED PHASE VFX APPLICATOR
// ============================================================================

// Apply the appropriate phase transition VFX based on current and target phase.
// transitionProgress: 0→1 during phase change (from latent energy accumulator)
fn applyPhaseVFX(
  baseColor: vec3<f32>,
  uv: vec2<f32>,
  time: f32,
  currentPhase: f32,
  temperature: f32,
  latentProgress: f32, // thermalData.w normalized to 0-1
) -> vec3<f32> {
  var color = baseColor;

  // Determine transition direction from phase + temperature
  if (currentPhase < 0.5) {
    // Solid: check if melting
    if (latentProgress > 0.01) {
      color = applyMeltEffect(color, uv, time, latentProgress);
    } else {
      // Frozen state: show frost
      color = applyFreezeEffect(color, uv, time, 1.0);
    }
  } else if (currentPhase < 1.5) {
    // Liquid: check if freezing or boiling
    if (latentProgress > 0.01 && temperature > 300.0) {
      color = applyBoilEffect(color, uv, time, latentProgress);
    } else if (latentProgress > 0.01 && temperature < 300.0) {
      color = applyFreezeEffect(color, uv, time, latentProgress);
    }
  } else if (currentPhase < 2.5) {
    // Gas: check if ionizing
    if (temperature > 5000.0) {
      let ionizeProgress = clamp((temperature - 5000.0) / 5000.0, 0.0, 1.0);
      color = applyIonizeEffect(color, uv, time, ionizeProgress);
    }
  } else {
    // Plasma: full ionization effect
    color = applyIonizeEffect(color, uv, time, 1.0);
  }

  return color;
}
`;

export default phaseVFXWGSL;
