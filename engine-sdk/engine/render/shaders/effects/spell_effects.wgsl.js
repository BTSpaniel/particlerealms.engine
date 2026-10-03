// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Spell Effects Composed Shader
 * 
 * Combines electricity, anime_explosion, and magic_effects chunks
 * for GPU-rendered spell visuals.
 * 
 * Usage: Full-screen pass that renders active spell effects at their world positions.
 */

import { fullscreenQuadVertexWGSL } from "../modules/chunks/fullscreen_quad.js";
import { electricityWGSL } from "../modules/chunks/electricity.js";
import { animeExplosionWGSL } from "../modules/chunks/anime_explosion.js";
import { magicEffectsWGSL } from "../modules/chunks/magic_effects.js";

// Spell type constants (must match SpellConfig.js SPELL_TYPES)
const SPELL_TYPE_CONSTS = /* wgsl */`
const SPELL_TYPE_PROJECTILE : u32 = 0u;
const SPELL_TYPE_BEAM : u32 = 1u;
const SPELL_TYPE_AOE : u32 = 2u;
const SPELL_TYPE_SHIELD : u32 = 3u;
const SPELL_TYPE_BUFF : u32 = 4u;
const SPELL_TYPE_DEBUFF : u32 = 5u;
const SPELL_TYPE_SUMMON : u32 = 6u;
const SPELL_TYPE_UTILITY : u32 = 7u;

// Effect sub-types
const EFFECT_FIRE : u32 = 0u;
const EFFECT_ICE : u32 = 1u;
const EFFECT_LIGHTNING : u32 = 2u;
const EFFECT_ARCANE : u32 = 3u;
const EFFECT_HOLY : u32 = 4u;
const EFFECT_DARK : u32 = 5u;
const EFFECT_NATURE : u32 = 6u;
const EFFECT_WIND : u32 = 7u;

const MAX_ACTIVE_SPELLS : u32 = 16u;
`;

// Spell uniform structure
const spellUniformsWGSL = /* wgsl */`
struct SpellInstance {
  position : vec3<f32>,      // World position
  radius : f32,              // Effect radius
  direction : vec3<f32>,     // Direction (for beams)
  intensity : f32,           // 0-1 intensity
  color : vec3<f32>,         // Base color
  spellType : u32,           // SPELL_TYPE_*
  effectType : u32,          // EFFECT_*
  phase : f32,               // Animation phase (0-1 for lifecycle)
  time : f32,                // Time since cast
  _pad : f32,
}

struct SpellEffectUniforms {
  viewProj : mat4x4<f32>,
  invViewProj : mat4x4<f32>,
  cameraPos : vec3<f32>,
  globalTime : f32,
  screenSize : vec2<f32>,
  spellCount : u32,
  _pad : u32,
}

@group(0) @binding(0) var<uniform> uniforms : SpellEffectUniforms;
@group(0) @binding(1) var<storage, read> spells : array<SpellInstance, 16>;
@group(0) @binding(2) var sceneDepth : texture_2d<f32>;
`;

// Fragment shader that renders spell effects
const spellEffectFragmentWGSL = /* wgsl */`
// Project world position to screen UV
fn worldToScreen(worldPos : vec3<f32>) -> vec3<f32> {
  let clip = uniforms.viewProj * vec4<f32>(worldPos, 1.0);
  let ndc = clip.xyz / clip.w;
  return vec3<f32>(
    ndc.x * 0.5 + 0.5,
    1.0 - (ndc.y * 0.5 + 0.5),  // Flip Y for screen coords
    ndc.z
  );
}

// Unproject screen UV to world ray
fn screenToWorldRay(uv : vec2<f32>) -> vec3<f32> {
  let ndcX = uv.x * 2.0 - 1.0;
  let ndcY = (1.0 - uv.y) * 2.0 - 1.0;
  
  let clipFar = vec4<f32>(ndcX, ndcY, 1.0, 1.0);
  var worldFar = uniforms.invViewProj * clipFar;
  worldFar = worldFar / worldFar.w;
  
  return normalize(worldFar.xyz - uniforms.cameraPos);
}

// Render lightning/electric arc effect
fn renderLightningEffect(
  uv : vec2<f32>,
  spell : SpellInstance,
  localUV : vec2<f32>,
  dist : f32
) -> vec4<f32> {
  // Electric arc pattern
  let arcDist = electricArc(localUV * 2.0 - 1.0, spell.time * 3.0, 4.0, 0.3);
  let arcGlow = electricGlow(arcDist, 0.02, 0.15);
  
  // Color based on intensity
  let coreColor = vec3<f32>(1.0, 1.0, 1.0);
  let coronaColor = spell.color;
  let col = electricColor(arcDist, coreColor, coronaColor, 0.05);
  
  // Sparkle overlay
  let sparkle = sparkleField(vec3<f32>(localUV * 10.0, spell.time), spell.time, 0.95);
  
  let alpha = arcGlow * spell.intensity * (1.0 - smoothstep(0.0, 1.0, dist / spell.radius));
  return vec4<f32>(col + sparkle * coronaColor, alpha);
}

// Render fire/explosion effect
fn renderFireEffect(
  uv : vec2<f32>,
  spell : SpellInstance,
  localUV : vec2<f32>,
  dist : f32
) -> vec4<f32> {
  let centered = localUV * 2.0 - 1.0;
  
  // Explosion burst
  let burst = explosionBurst(centered, spell.time * 2.0, spell.phase);
  let core = explosionCore(centered, spell.phase);
  
  // Shockwave if in impact phase
  let wave = shockwaveRing(centered, spell.phase, 1.2, 0.08);
  
  // Color gradient
  let intensity = burst * 0.7 + core * 0.3;
  let col = animeExplosionColor(intensity, spell.phase);
  
  // Add rays for dramatic effect
  let rays = impactRays(centered, 8.0, spell.time, spell.phase) * 0.5;
  
  var alpha = (burst + core * 2.0 + wave + rays) * spell.intensity;
  alpha *= 1.0 - smoothstep(0.0, 1.0, dist / spell.radius);
  
  return vec4<f32>(col, alpha);
}

// Render ice/frost effect
fn renderIceEffect(
  uv : vec2<f32>,
  spell : SpellInstance,
  localUV : vec2<f32>,
  dist : f32
) -> vec4<f32> {
  let centered = localUV * 2.0 - 1.0;
  
  // Crystalline pattern using hex grid
  let hexScale = 8.0 + sin(spell.time) * 2.0;
  let hex = hexPattern(centered, hexScale);
  
  // Energy rings
  let rings = energyRings(vec3<f32>(centered, 0.0), spell.time, 6.0, 2.0);
  
  // Ice colors
  let coldBlue = vec3<f32>(0.6, 0.85, 1.0);
  let white = vec3<f32>(1.0, 1.0, 1.0);
  var col = mix(coldBlue, white, hex * 0.5 + rings * 0.5);
  
  // Sparkle for frost glitter
  let sparkle = sparkleField(vec3<f32>(localUV * 15.0, spell.time * 0.5), spell.time, 0.92);
  col += sparkle * 0.5;
  
  var alpha = (hex * 0.6 + rings * 0.4) * spell.intensity;
  alpha *= 1.0 - smoothstep(0.0, 1.0, dist / spell.radius);
  
  return vec4<f32>(col, alpha);
}

// Render arcane/magic effect
fn renderArcaneEffect(
  uv : vec2<f32>,
  spell : SpellInstance,
  localUV : vec2<f32>,
  dist : f32
) -> vec4<f32> {
  let centered = localUV * 2.0 - 1.0;
  let pos3d = vec3<f32>(centered, spell.time * 0.5);
  
  // Swirling energy
  let swirl = energySwirl(pos3d, spell.time, 5.0);
  
  // Arcane runes
  let runes = arcaneRunes(pos3d, spell.time * 0.3, 6.0);
  
  // Pulsing
  let pulse = magicPulse(spell.time, 3.0, 0.6, 1.0);
  
  // Portal ring at edge
  let ringDist = abs(length(centered) - 0.7);
  let ring = smoothstep(0.08, 0.0, ringDist) * pulse;
  
  // Arcane purple/blue color
  let purple = vec3<f32>(0.6, 0.2, 1.0);
  let cyan = vec3<f32>(0.2, 0.8, 1.0);
  var col = mix(purple, cyan, swirl) * pulse;
  col += vec3<f32>(1.0, 0.8, 1.0) * runes * 0.5;
  col += spell.color * ring;
  
  var alpha = (swirl * 0.5 + runes * 0.3 + ring * 0.4) * spell.intensity;
  alpha *= 1.0 - smoothstep(0.0, 1.0, dist / spell.radius);
  
  return vec4<f32>(col, alpha);
}

// ===== NOISE FUNCTIONS FOR SHIELD BUBBLE =====

// Random hash function
fn shieldHash(p: vec3<f32>) -> f32 {
  var p3 = fract(p * vec3<f32>(443.897, 441.423, 437.195));
  p3 += dot(p3, p3.yzx + 19.19);
  return fract((p3.x + p3.y) * p3.z);
}

// 3D gradient noise
fn shieldNoise3D(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  
  return mix(
    mix(
      mix(shieldHash(i + vec3<f32>(0.0, 0.0, 0.0)), shieldHash(i + vec3<f32>(1.0, 0.0, 0.0)), u.x),
      mix(shieldHash(i + vec3<f32>(0.0, 1.0, 0.0)), shieldHash(i + vec3<f32>(1.0, 1.0, 0.0)), u.x),
      u.y
    ),
    mix(
      mix(shieldHash(i + vec3<f32>(0.0, 0.0, 1.0)), shieldHash(i + vec3<f32>(1.0, 0.0, 1.0)), u.x),
      mix(shieldHash(i + vec3<f32>(0.0, 1.0, 1.0)), shieldHash(i + vec3<f32>(1.0, 1.0, 1.0)), u.x),
      u.y
    ),
    u.z
  );
}

// Fractal Brownian Motion (fbm) for organic turbulence
fn shieldFbm(p: vec3<f32>) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var pos = p;
  for (var i = 0; i < 4; i++) {
    value += amplitude * shieldNoise3D(pos);
    pos *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

// Voronoise-like function for bubbly distortion
fn shieldVoronoise(p: vec3<f32>, u: f32, v: f32) -> f32 {
  let k = 1.0 + 63.0 * pow(1.0 - v, 6.0);
  let i = floor(p);
  let f = fract(p);
  
  var a = vec2<f32>(0.0);
  for (var z = -2.0; z <= 2.0; z += 1.0) {
    for (var y = -2.0; y <= 2.0; y += 1.0) {
      for (var x = -2.0; x <= 2.0; x += 1.0) {
        let g = vec3<f32>(x, y, z);
        let o = vec3<f32>(
          shieldHash(i + g),
          shieldHash(i + g + vec3<f32>(31.0, 17.0, 53.0)),
          shieldHash(i + g + vec3<f32>(71.0, 23.0, 97.0))
        ) * vec3<f32>(u, u, 1.0);
        let d = g - f + o + 0.5;
        let w = pow(1.0 - smoothstep(0.0, 1.414, length(d)), k);
        a += vec2<f32>(o.z * w, w);
      }
    }
  }
  return a.x / max(a.y, 0.001);
}

// Render shield effect - wavy energy bubble
fn renderShieldEffect(
  uv : vec2<f32>,
  spell : SpellInstance,
  localUV : vec2<f32>,
  dist : f32
) -> vec4<f32> {
  let centered = localUV * 2.0 - 1.0;
  
  // Shield colors - bright and vivid
  let innerColor = spell.color * 0.6 + vec3<f32>(0.2);
  let outerColor = spell.color * 1.5 + vec3<f32>(0.3);
  
  // Base sphere size
  let sphereSize = 0.85;
  let uvScale = 8.0;
  
  // Create wavy sphere using noise
  var shape = 1.0 - (length(centered * uvScale) - sphereSize * uvScale);
  
  // Add voronoise for organic bubble texture
  let noisePos = vec3<f32>(centered * uvScale, spell.time * 2.0);
  shape += shieldVoronoise(noisePos, 1.2, 0.5) * 1.5;
  
  // Add fbm for wispy effect
  let fbmPos = vec3<f32>(centered * 5.0, spell.time * 0.5);
  var shape2 = (shape + 1.0) + shieldFbm(fbmPos) * 0.8;
  shape2 = pow(abs(shape2), 1.8) * sign(shape2) + shape;
  
  // Normalize shapes
  shape *= 0.5;
  shape = clamp(shape, 0.0, 1.0);
  shape2 = clamp(shape2, -2.0, 1.0);
  
  // Combine shapes
  shape = (shape + shape2) / 2.0;
  
  // Create gradient from 0-1 for color mixing
  var gradient = 0.0;
  if (shape > 0.0) {
    gradient = clamp((1.0 - shape * 0.5), 0.1, 1.0);
  }
  
  // Calculate edge glow (Fresnel-like effect) - stronger
  let edgeDist = abs(length(centered) - sphereSize);
  let edge = smoothstep(0.25, 0.0, edgeDist);
  
  // Pulse effect
  let pulse = 0.85 + 0.15 * sin(spell.time * 3.0);
  
  // Mix colors based on gradient
  var col = vec3<f32>(0.0);
  if (gradient > 0.0) {
    col = mix(innerColor, outerColor, gradient);
    col += edge * outerColor * 0.8; // Strong edge highlight
  }
  
  // Calculate alpha - MORE VISIBLE
  var alpha = 0.0;
  if (gradient > 0.0) {
    // Much higher alpha values
    alpha = gradient * 0.8 + edge * 0.6;
    alpha *= spell.intensity * pulse;
    alpha = clamp(alpha, 0.0, 1.0);
  }
  
  // Add strong inner glow
  let innerGlow = smoothstep(sphereSize, 0.0, length(centered)) * 0.3;
  col += spell.color * innerGlow * 1.5;
  alpha = max(alpha, innerGlow * spell.intensity * 0.8);
  
  // Boost overall visibility
  col *= 1.3;
  
  return vec4<f32>(col, alpha);
}

// Main fragment shader
@fragment
fn fs_spell_effect(input : FullscreenVSOut) -> @location(0) vec4<f32> {
  var totalColor = vec4<f32>(0.0);
  
  // Process each active spell
  for (var i = 0u; i < uniforms.spellCount && i < MAX_ACTIVE_SPELLS; i = i + 1u) {
    let spell = spells[i];
    
    // Project spell position to screen
    let screenPos = worldToScreen(spell.position);
    
    // Skip if behind camera
    if (screenPos.z < 0.0 || screenPos.z > 1.0) {
      continue;
    }
    
    // Calculate screen-space distance
    let screenDiff = input.uv - screenPos.xy;
    let aspect = uniforms.screenSize.x / uniforms.screenSize.y;
    let correctedDiff = vec2<f32>(screenDiff.x * aspect, screenDiff.y);
    let screenDist = length(correctedDiff);
    
    // Calculate approximate world-space distance for effect sizing
    let worldDist = screenDist * 10.0;  // Rough approximation
    
    // Skip if too far from spell
    if (worldDist > spell.radius * 2.0) {
      continue;
    }
    
    // Local UV within spell effect area
    let localUV = (correctedDiff / (spell.radius * 0.2)) * 0.5 + 0.5;
    
    var effectColor = vec4<f32>(0.0);
    
    // Select effect based on type
    if (spell.effectType == EFFECT_LIGHTNING) {
      effectColor = renderLightningEffect(input.uv, spell, localUV, worldDist);
    } else if (spell.effectType == EFFECT_FIRE) {
      effectColor = renderFireEffect(input.uv, spell, localUV, worldDist);
    } else if (spell.effectType == EFFECT_ICE) {
      effectColor = renderIceEffect(input.uv, spell, localUV, worldDist);
    } else if (spell.effectType == EFFECT_ARCANE) {
      effectColor = renderArcaneEffect(input.uv, spell, localUV, worldDist);
    } else if (spell.spellType == SPELL_TYPE_SHIELD) {
      effectColor = renderShieldEffect(input.uv, spell, localUV, worldDist);
    } else {
      // Default: fire effect
      effectColor = renderFireEffect(input.uv, spell, localUV, worldDist);
    }
    
    // Additive blend
    totalColor = vec4<f32>(
      totalColor.rgb + effectColor.rgb * effectColor.a,
      max(totalColor.a, effectColor.a)
    );
  }
  
  return totalColor;
}
`;

// Export the complete shader
export const spellEffectsWGSL = 
  SPELL_TYPE_CONSTS +
  electricityWGSL +
  animeExplosionWGSL +
  magicEffectsWGSL +
  spellUniformsWGSL +
  fullscreenQuadVertexWGSL +
  spellEffectFragmentWGSL;

// Export individual pieces for flexibility
export { SPELL_TYPE_CONSTS, spellUniformsWGSL, spellEffectFragmentWGSL };
