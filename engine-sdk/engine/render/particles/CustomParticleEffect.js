// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CustomParticleEffect.js - Unified Particle Effect System
 * 
 * KEY PRINCIPLE: ONE SDF function defines BOTH:
 *   1. Visual rendering (raymarching in fragment shader)
 *   2. Collision detection (compute shader physics)
 * 
 * This ensures particle appearance ALWAYS matches collision shape.
 */

// ============================================================================
// EFFECT STRUCTURE
// ============================================================================

/**
 * @typedef {Object} CustomParticleEffect
 * @property {string} id - Unique identifier
 * @property {string} name - Display name
 * @property {string} description - Description
 * @property {number} version - Version number
 * @property {string} sdfCode - WGSL code for customSDF function
 * @property {string} colorCode - WGSL code for customColor function
 * @property {string} [helperCode] - Additional helper functions
 * @property {Object} [params] - Custom parameter definitions
 * @property {boolean} [isBuiltin] - Whether this is a built-in preset
 */

import { LEGACY_PCG32_WGSL } from '../../core/math/MathBits.js';

let _customEffectSequence = 0;

function _nextCustomEffectSuffix() {
  return `${Date.now()}_${++_customEffectSequence}`;
}

export function createCustomEffectId() {
  return `custom_${_nextCustomEffectSuffix()}`;
}

export function createCustomEffectCloneId(effectId) {
  return `${effectId}_copy_${_nextCustomEffectSuffix()}`;
}

export function createImportedEffectId(effectId) {
  return `${effectId}_imported_${_nextCustomEffectSuffix()}`;
}

export const CUSTOM_PARTICLE_SPARKLE_PCG_HASH_WGSL = /* wgsl */ `
fn customParticleSparkleHash3D(bits: vec3<u32>) -> u32 {
  return legacyPcgSparkleHash3D(bits);
}
`;

// ============================================================================
// BUILT-IN SDF HELPER FUNCTIONS (Injected into all shaders)
// ============================================================================

export const SDF_HELPERS_WGSL = /* wgsl */`
${LEGACY_PCG32_WGSL}
${CUSTOM_PARTICLE_SPARKLE_PCG_HASH_WGSL}

// ============================================================================
// SDF HELPER FUNCTIONS (from Inigo Quilez)
// ============================================================================

// Smooth minimum - blend two SDFs smoothly
fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

// Smooth maximum
fn smax(a: f32, b: f32, k: f32) -> f32 {
  return -smin(-a, -b, k);
}

// 3D hash function
fn hash3(p: vec3<f32>) -> f32 {
  var p3 = fract(p * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// 3D noise
fn noise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  
  return mix(
    mix(
      mix(hash3(i + vec3(0.0, 0.0, 0.0)), hash3(i + vec3(1.0, 0.0, 0.0)), u.x),
      mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), u.x),
      u.y
    ),
    mix(
      mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), u.x),
      mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), u.x),
      u.y
    ),
    u.z
  );
}

// Fractal Brownian Motion
fn fbm(p: vec3<f32>, octaves: i32) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var pos = p;
  for (var i = 0; i < octaves; i++) {
    value += amplitude * noise3(pos);
    pos *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

// FBM with default 4 octaves
fn fbm4(p: vec3<f32>) -> f32 {
  return fbm(p, 4);
}

// ============================================================================
// SDF PRIMITIVES
// ============================================================================

fn sdSphere(p: vec3<f32>, r: f32) -> f32 {
  return length(p) - r;
}

fn sdBox(p: vec3<f32>, b: vec3<f32>) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn sdOctahedron(p: vec3<f32>, s: f32) -> f32 {
  let q = abs(p);
  return (q.x + q.y + q.z - s) * 0.57735027;
}

fn sdTorus(p: vec3<f32>, t: vec2<f32>) -> f32 {
  let q = vec2(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

fn sdCapsule(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, r: f32) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

fn sdCylinder(p: vec3<f32>, h: f32, r: f32) -> f32 {
  let d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
  return min(max(d.x, d.y), 0.0) + length(max(d, vec2(0.0)));
}

fn sdCone(p: vec3<f32>, c: vec2<f32>, h: f32) -> f32 {
  let q = h * vec2(c.x / c.y, -1.0);
  let w = vec2(length(p.xz), p.y);
  let a = w - q * clamp(dot(w, q) / dot(q, q), 0.0, 1.0);
  let b = w - q * vec2(clamp(w.x / q.x, 0.0, 1.0), 1.0);
  let k = sign(q.y);
  let d = min(dot(a, a), dot(b, b));
  let s = max(k * (w.x * q.y - w.y * q.x), k * (w.y - q.y));
  return sqrt(d) * sign(s);
}

// ============================================================================
// SDF OPERATIONS
// ============================================================================

fn opUnion(d1: f32, d2: f32) -> f32 {
  return min(d1, d2);
}

fn opSubtract(d1: f32, d2: f32) -> f32 {
  return max(-d1, d2);
}

fn opIntersect(d1: f32, d2: f32) -> f32 {
  return max(d1, d2);
}

fn opSmoothUnion(d1: f32, d2: f32, k: f32) -> f32 {
  return smin(d1, d2, k);
}

fn opSmoothSubtract(d1: f32, d2: f32, k: f32) -> f32 {
  return smax(-d1, d2, k);
}

fn opSmoothIntersect(d1: f32, d2: f32, k: f32) -> f32 {
  return smax(d1, d2, k);
}

// Domain repetition
fn opRep(p: vec3<f32>, c: vec3<f32>) -> vec3<f32> {
  return p - c * round(p / c);
}

// Twist around Y axis
fn opTwist(p: vec3<f32>, k: f32) -> vec3<f32> {
  let c = cos(k * p.y);
  let s = sin(k * p.y);
  let m = mat2x2<f32>(c, -s, s, c);
  return vec3(m * p.xz, p.y);
}

// Bend around Y axis
fn opBend(p: vec3<f32>, k: f32) -> vec3<f32> {
  let c = cos(k * p.x);
  let s = sin(k * p.x);
  let m = mat2x2<f32>(c, -s, s, c);
  return vec3(m * p.xy, p.z);
}

// Calculate normal from SDF gradient
fn calcSDFNormal(p: vec3<f32>, time: f32, params: vec4<f32>) -> vec3<f32> {
  let e = vec2(0.001, 0.0);
  return normalize(vec3(
    customSDF(p + e.xyy, time, params) - customSDF(p - e.xyy, time, params),
    customSDF(p + e.yxy, time, params) - customSDF(p - e.yxy, time, params),
    customSDF(p + e.yyx, time, params) - customSDF(p - e.yyx, time, params)
  ));
}
`;

// ============================================================================
// BUILT-IN EFFECT PRESETS
// ============================================================================

export const EFFECT_PRESETS = {
  sphere: {
    id: 'sphere',
    name: 'Sphere',
    description: 'Simple sphere (default)',
    version: 1,
    isBuiltin: true,
    sdfCode: /* wgsl */`
fn customSDF(p: vec3<f32>, time: f32, params: vec4<f32>) -> f32 {
  return sdSphere(p, 1.0);
}`,
    colorCode: /* wgsl */`
fn customColor(p: vec3<f32>, normal: vec3<f32>, dist: f32, time: f32, baseColor: vec4<f32>, params: vec4<f32>) -> vec4<f32> {
  let viewDir = normalize(-p);
  let fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.0);
  return vec4(baseColor.rgb + fresnel * 0.3, baseColor.a);
}`,
  },

  fireball: {
    id: 'fireball',
    name: 'Fireball',
    description: 'Animated fire with noise displacement',
    version: 1,
    isBuiltin: true,
    sdfCode: /* wgsl */`
fn customSDF(p: vec3<f32>, time: f32, params: vec4<f32>) -> f32 {
  let noiseScale = select(3.0, params.x, params.x > 0.0);
  let speed = select(2.0, params.y, params.y > 0.0);
  let q = p * noiseScale + vec3(0.0, time * speed, 0.0);
  let noise = (sin(q.x) * sin(q.y) * sin(q.z) + 
               sin(q.x * 2.1) * sin(q.y * 2.3) * sin(q.z * 1.9) * 0.5) * 0.15;
  let elongate = 1.0 + params.w * 0.3;
  let stretched = vec3(p.x, p.y, p.z * elongate);
  return length(stretched) - 1.0 - noise;
}`,
    colorCode: /* wgsl */`
fn customColor(p: vec3<f32>, normal: vec3<f32>, dist: f32, time: f32, baseColor: vec4<f32>, params: vec4<f32>) -> vec4<f32> {
  let temp = 1.0 - length(p);
  var col: vec3<f32>;
  if (temp > 0.7) { col = vec3(1.0, 1.0, 0.9); }
  else if (temp > 0.5) { col = vec3(1.0, 0.9, 0.2); }
  else if (temp > 0.3) { col = vec3(1.0, 0.5, 0.0); }
  else { col = vec3(1.0, 0.2, 0.0); }
  return vec4(col * baseColor.rgb * 1.5, baseColor.a);
}`,
    params: {
      noiseScale: { type: 'f32', default: 3.0, min: 1.0, max: 10.0, label: 'Noise Scale' },
      speed: { type: 'f32', default: 2.0, min: 0.0, max: 10.0, label: 'Animation Speed' },
    }
  },

  ice: {
    id: 'ice',
    name: 'Ice Crystal',
    description: 'Rotating crystalline octahedron',
    version: 1,
    isBuiltin: true,
    sdfCode: /* wgsl */`
fn customSDF(p: vec3<f32>, time: f32, params: vec4<f32>) -> f32 {
  let rotSpeed = select(0.5, params.x, params.x > 0.0);
  let angle = time * rotSpeed;
  let c = cos(angle);
  let s = sin(angle);
  let rp = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
  return sdOctahedron(rp, 1.0);
}`,
    colorCode: /* wgsl */`
fn customColor(p: vec3<f32>, normal: vec3<f32>, dist: f32, time: f32, baseColor: vec4<f32>, params: vec4<f32>) -> vec4<f32> {
  let viewDir = normalize(-p);
  let fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
  let cold = vec3(0.6, 0.85, 1.0);
  let _sp1 = p * 20.0;
  let sparkleBits = vec3<u32>(bitcast<u32>(_sp1.x), bitcast<u32>(_sp1.y), bitcast<u32>(_sp1.z));
  let sparkle = step(0.98, f32(customParticleSparkleHash3D(sparkleBits)) / 4294967295.0);
  var col = mix(cold, vec3(1.0), fresnel * 0.8) + sparkle * 0.5;
  return vec4(col * baseColor.rgb, 0.85 + fresnel * 0.15);
}`,
    params: {
      rotSpeed: { type: 'f32', default: 0.5, min: 0.0, max: 5.0, label: 'Rotation Speed' },
    }
  },

  lightning: {
    id: 'lightning',
    name: 'Lightning Orb',
    description: 'Electric plasma sphere with pulse',
    version: 1,
    isBuiltin: true,
    sdfCode: /* wgsl */`
fn customSDF(p: vec3<f32>, time: f32, params: vec4<f32>) -> f32 {
  let freq = select(5.0, params.x, params.x > 0.0);
  let pulseSpeed = select(8.0, params.y, params.y > 0.0);
  let t = time * freq;
  let noise = sin(p.x * 8.0 + t) * sin(p.y * 8.0 - t * 0.7) * sin(p.z * 8.0 + t * 1.3) * 0.1;
  let pulse = 1.0 + sin(time * pulseSpeed) * 0.05;
  return sdSphere(p, pulse) - noise;
}`,
    colorCode: /* wgsl */`
fn customColor(p: vec3<f32>, normal: vec3<f32>, dist: f32, time: f32, baseColor: vec4<f32>, params: vec4<f32>) -> vec4<f32> {
  let viewDir = normalize(-p);
  let fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.0);
  let core = vec3(1.0, 1.0, 1.0);
  let corona = vec3(0.3, 0.8, 1.0);
  var col = mix(core, corona, length(p));
  col *= 0.8 + 0.2 * sin(time * 30.0 + p.y * 20.0);
  col += fresnel * corona;
  return vec4(col * 1.5 * baseColor.rgb, 1.0);
}`,
    params: {
      freq: { type: 'f32', default: 5.0, min: 1.0, max: 20.0, label: 'Noise Frequency' },
      pulseSpeed: { type: 'f32', default: 8.0, min: 1.0, max: 30.0, label: 'Pulse Speed' },
    }
  },

  arcane: {
    id: 'arcane',
    name: 'Arcane Orb',
    description: 'Swirling magic with rune patterns',
    version: 1,
    isBuiltin: true,
    sdfCode: /* wgsl */`
fn customSDF(p: vec3<f32>, time: f32, params: vec4<f32>) -> f32 {
  let runeCount = select(6.0, params.x, params.x > 0.0);
  let angle = atan2(p.z, p.x);
  let rune = pow(abs(sin(angle * runeCount + time)), 8.0) * 0.1 * (1.0 - length(p.xz));
  return length(vec3(p.x, p.y * 0.9, p.z)) - 1.0 - rune;
}`,
    colorCode: /* wgsl */`
fn customColor(p: vec3<f32>, normal: vec3<f32>, dist: f32, time: f32, baseColor: vec4<f32>, params: vec4<f32>) -> vec4<f32> {
  let viewDir = normalize(-p);
  let fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
  let angle = atan2(p.z, p.x);
  let swirl = sin(angle * 4.0 - time * 2.0 + length(p) * 3.0) * 0.5 + 0.5;
  let purple = vec3(0.6, 0.2, 1.0);
  let cyan = vec3(0.2, 0.8, 1.0);
  var col = mix(purple, cyan, swirl);
  let runes = pow(abs(sin(angle * 6.0 + time)), 8.0) * (1.0 - length(p.xz));
  col += vec3(1.0, 0.8, 1.0) * runes * 0.5;
  col += fresnel * cyan;
  col *= 0.8 + 0.2 * sin(time * 3.0);
  return vec4(col * baseColor.rgb, 0.9);
}`,
    params: {
      runeCount: { type: 'f32', default: 6.0, min: 3.0, max: 12.0, label: 'Rune Count' },
    }
  },

  smoke: {
    id: 'smoke',
    name: 'Smoke Puff',
    description: 'Soft volumetric smoke cloud',
    version: 1,
    isBuiltin: true,
    sdfCode: /* wgsl */`
fn customSDF(p: vec3<f32>, time: f32, params: vec4<f32>) -> f32 {
  let turbulence = select(0.5, params.x, params.x > 0.0);
  let q = p * 2.0 + vec3(0.0, time * turbulence, 0.0);
  let noise = (sin(q.x * 1.5) * sin(q.y * 1.7) * sin(q.z * 1.3) +
               sin(q.x * 3.1) * sin(q.y * 2.9) * sin(q.z * 3.3) * 0.3) * 0.2;
  return sdSphere(p, 1.2) - noise;
}`,
    colorCode: /* wgsl */`
fn customColor(p: vec3<f32>, normal: vec3<f32>, dist: f32, time: f32, baseColor: vec4<f32>, params: vec4<f32>) -> vec4<f32> {
  let d = length(p);
  let smokeColor = vec3(0.3, 0.3, 0.35);
  let density = smoothstep(1.2, 0.0, d) * 0.6;
  let variation = sin(p.x * 5.0 + p.y * 3.0 + time) * 0.05;
  return vec4(smokeColor + variation, density * baseColor.a);
}`,
    params: {
      turbulence: { type: 'f32', default: 0.5, min: 0.0, max: 3.0, label: 'Turbulence' },
    }
  },

  heal: {
    id: 'heal',
    name: 'Healing Light',
    description: 'Pulsing diamond with sparkles',
    version: 1,
    isBuiltin: true,
    sdfCode: /* wgsl */`
fn customSDF(p: vec3<f32>, time: f32, params: vec4<f32>) -> f32 {
  let pulseSpeed = select(4.0, params.x, params.x > 0.0);
  let pulse = sin(time * pulseSpeed) * 0.1;
  return sdOctahedron(p, 0.8) - pulse;
}`,
    colorCode: /* wgsl */`
fn customColor(p: vec3<f32>, normal: vec3<f32>, dist: f32, time: f32, baseColor: vec4<f32>, params: vec4<f32>) -> vec4<f32> {
  let viewDir = normalize(-p);
  let fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.0);
  let green = vec3(0.2, 1.0, 0.5);
  let white = vec3(1.0, 1.0, 0.9);
  let _hp1 = p * 30.0 + time * 5.0;
  let sparkleBits = vec3<u32>(bitcast<u32>(_hp1.x), bitcast<u32>(_hp1.y), bitcast<u32>(_hp1.z));
  let sparkle = step(0.95, f32(customParticleSparkleHash3D(sparkleBits)) / 4294967295.0);
  var col = mix(green, white, fresnel * 0.6) + sparkle * 0.8;
  col *= 1.3;
  return vec4(col * baseColor.rgb, 0.8 + fresnel * 0.2);
}`,
    params: {
      pulseSpeed: { type: 'f32', default: 4.0, min: 1.0, max: 15.0, label: 'Pulse Speed' },
    }
  },

  vortex: {
    id: 'vortex',
    name: 'Gravity Vortex',
    description: 'Swirling dark matter torus',
    version: 1,
    isBuiltin: true,
    sdfCode: /* wgsl */`
fn customSDF(p: vec3<f32>, time: f32, params: vec4<f32>) -> f32 {
  let swirlSpeed = select(4.0, params.x, params.x > 0.0);
  let angle = atan2(p.z, p.x);
  let swirl = sin(angle * 3.0 - time * swirlSpeed) * 0.1;
  return sdTorus(p, vec2(0.6, 0.3)) - swirl;
}`,
    colorCode: /* wgsl */`
fn customColor(p: vec3<f32>, normal: vec3<f32>, dist: f32, time: f32, baseColor: vec4<f32>, params: vec4<f32>) -> vec4<f32> {
  let angle = atan2(p.z, p.x);
  let swirl = sin(angle * 8.0 - time * 6.0) * 0.5 + 0.5;
  let dark = vec3(0.1, 0.0, 0.2);
  let bright = vec3(0.5, 0.2, 1.0);
  var col = mix(dark, bright, swirl);
  let edgeDist = abs(length(p.xz) - 0.6);
  let edge = smoothstep(0.3, 0.0, edgeDist);
  col += bright * edge * 0.5;
  return vec4(col * baseColor.rgb, 0.9);
}`,
    params: {
      swirlSpeed: { type: 'f32', default: 4.0, min: 1.0, max: 15.0, label: 'Swirl Speed' },
    }
  },

  shield: {
    id: 'shield',
    name: 'Energy Shield',
    description: 'Protective bubble with hex pattern',
    version: 1,
    isBuiltin: true,
    sdfCode: /* wgsl */`
fn customSDF(p: vec3<f32>, time: f32, params: vec4<f32>) -> f32 {
  let thickness = select(0.1, params.x, params.x > 0.0);
  let outer = sdSphere(p, 1.0);
  let inner = sdSphere(p, 1.0 - thickness);
  return max(outer, -inner);
}`,
    colorCode: /* wgsl */`
fn customColor(p: vec3<f32>, normal: vec3<f32>, dist: f32, time: f32, baseColor: vec4<f32>, params: vec4<f32>) -> vec4<f32> {
  let viewDir = normalize(-p);
  let fresnel = pow(1.0 - abs(dot(normal, viewDir)), 3.0);
  let angle = atan2(p.z, p.x);
  let hex = sin(angle * 8.0) * sin(p.y * 12.0 + time) * 0.5 + 0.5;
  var col = baseColor.rgb * (0.5 + hex * 0.3);
  col += fresnel * baseColor.rgb * 1.5;
  let pulse = 0.7 + 0.3 * sin(time * 3.0);
  return vec4(col * pulse, fresnel * 0.8 + 0.2);
}`,
    params: {
      thickness: { type: 'f32', default: 0.1, min: 0.02, max: 0.3, label: 'Shell Thickness' },
    }
  },

  explosion: {
    id: 'explosion',
    name: 'Explosion',
    description: 'Expanding burst with debris',
    version: 1,
    isBuiltin: true,
    sdfCode: /* wgsl */`
fn customSDF(p: vec3<f32>, time: f32, params: vec4<f32>) -> f32 {
  let expandSpeed = select(2.0, params.x, params.x > 0.0);
  let phase = fract(time * 0.5);
  let radius = phase * expandSpeed;
  let noise = fbm4(p * 3.0 + time) * 0.3;
  return sdSphere(p, radius + 0.1) - noise;
}`,
    colorCode: /* wgsl */`
fn customColor(p: vec3<f32>, normal: vec3<f32>, dist: f32, time: f32, baseColor: vec4<f32>, params: vec4<f32>) -> vec4<f32> {
  let phase = fract(time * 0.5);
  let temp = 1.0 - phase;
  var col: vec3<f32>;
  if (temp > 0.7) { col = vec3(1.0, 1.0, 0.9); }
  else if (temp > 0.5) { col = vec3(1.0, 0.8, 0.2); }
  else if (temp > 0.3) { col = vec3(1.0, 0.4, 0.1); }
  else { col = vec3(0.3, 0.1, 0.05); }
  col *= (1.0 - phase) * 2.0;
  return vec4(col * baseColor.rgb, (1.0 - phase) * baseColor.a);
}`,
    params: {
      expandSpeed: { type: 'f32', default: 2.0, min: 0.5, max: 5.0, label: 'Expand Speed' },
    }
  },
};

// ============================================================================
// SHADER GENERATION
// ============================================================================

/**
 * Generate visual raymarching shader from effect
 */
export function generateVisualShader(effect, options = {}) {
  const maxSteps = options.maxSteps || 64;
  const maxDist = options.maxDist || 10.0;
  const surfaceThreshold = options.surfaceThreshold || 0.001;
  
  const sdfCode = effect.sdfCode || EFFECT_PRESETS.sphere.sdfCode;
  const colorCode = effect.colorCode || EFFECT_PRESETS.sphere.colorCode;
  const helperCode = effect.helperCode || '';
  
  return /* wgsl */`
${SDF_HELPERS_WGSL}

// User helper functions
${helperCode}

// User SDF function
${sdfCode}

// User color function
${colorCode}

// Raymarching constants
const MAX_STEPS: i32 = ${maxSteps};
const MAX_DIST: f32 = ${maxDist};
const SURF_DIST: f32 = ${surfaceThreshold};

// Raymarch the custom SDF
fn raymarchSDF(ro: vec3<f32>, rd: vec3<f32>, time: f32, params: vec4<f32>) -> vec2<f32> {
  var t = 0.0;
  for (var i = 0; i < MAX_STEPS; i++) {
    let p = ro + rd * t;
    let d = customSDF(p, time, params);
    if (d < SURF_DIST) {
      return vec2(t, f32(i));
    }
    if (t > MAX_DIST) {
      break;
    }
    t += d * 0.8; // Slight understepping for stability
  }
  return vec2(-1.0, f32(MAX_STEPS));
}

// Render particle with custom effect
fn renderCustomParticle(
  ro: vec3<f32>,
  rd: vec3<f32>,
  time: f32,
  baseColor: vec4<f32>,
  params: vec4<f32>
) -> vec4<f32> {
  let hit = raymarchSDF(ro, rd, time, params);
  if (hit.x < 0.0) {
    return vec4(0.0);
  }
  
  let p = ro + rd * hit.x;
  let normal = calcSDFNormal(p, time, params);
  let dist = customSDF(p, time, params);
  
  return customColor(p, normal, dist, time, baseColor, params);
}
`;
}

/**
 * Generate collision compute shader from effect
 */
export function generateCollisionShader(effect) {
  const sdfCode = effect.sdfCode || EFFECT_PRESETS.sphere.sdfCode;
  const helperCode = effect.helperCode || '';
  
  return /* wgsl */`
${SDF_HELPERS_WGSL}

// User helper functions
${helperCode}

// User SDF function - SAME as visual shader!
${sdfCode}

// Evaluate SDF at world position relative to particle
fn evaluateParticleSDF(
  queryPos: vec3<f32>,
  particlePos: vec3<f32>,
  particleRadius: f32,
  time: f32,
  params: vec4<f32>
) -> f32 {
  // Transform to local particle space (normalized)
  let localPos = (queryPos - particlePos) / particleRadius;
  return customSDF(localPos, time, params) * particleRadius;
}

// Get collision normal from SDF gradient
fn getCollisionNormal(
  queryPos: vec3<f32>,
  particlePos: vec3<f32>,
  particleRadius: f32,
  time: f32,
  params: vec4<f32>
) -> vec3<f32> {
  let localPos = (queryPos - particlePos) / particleRadius;
  return calcSDFNormal(localPos, time, params);
}
`;
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate effect WGSL code
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateEffect(effect) {
  const errors = [];
  
  if (!effect.id) {
    errors.push('Effect must have an id');
  }
  
  if (!effect.name) {
    errors.push('Effect must have a name');
  }
  
  if (!effect.sdfCode) {
    errors.push('Effect must have sdfCode');
  } else {
    // Check for required function signature
    if (!effect.sdfCode.includes('fn customSDF')) {
      errors.push('sdfCode must contain "fn customSDF(p: vec3<f32>, time: f32, params: vec4<f32>) -> f32"');
    }
  }
  
  if (effect.colorCode && !effect.colorCode.includes('fn customColor')) {
    errors.push('colorCode must contain "fn customColor(...) -> vec4<f32>"');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Compile effect shaders on device (validates WGSL syntax)
 */
export async function compileEffect(device, effect) {
  const validation = validateEffect(effect);
  if (!validation.valid) {
    return { success: false, errors: validation.errors };
  }
  
  const errors = [];
  
  // Try compiling visual shader
  try {
    const visualCode = generateVisualShader(effect);
    const visualModule = device.createShaderModule({
      label: `CustomEffect.${effect.id}.visual`,
      code: visualCode,
    });
    
    // Check for compilation errors
    const visualInfo = await visualModule.getCompilationInfo();
    for (const msg of visualInfo.messages) {
      if (msg.type === 'error') {
        errors.push(`Visual shader error: ${msg.message} (line ${msg.lineNum})`);
      }
    }
  } catch (e) {
    errors.push(`Visual shader compilation failed: ${e.message}`);
  }
  
  // Try compiling collision shader
  try {
    const collisionCode = generateCollisionShader(effect);
    const collisionModule = device.createShaderModule({
      label: `CustomEffect.${effect.id}.collision`,
      code: collisionCode,
    });
    
    const collisionInfo = await collisionModule.getCompilationInfo();
    for (const msg of collisionInfo.messages) {
      if (msg.type === 'error') {
        errors.push(`Collision shader error: ${msg.message} (line ${msg.lineNum})`);
      }
    }
  } catch (e) {
    errors.push(`Collision shader compilation failed: ${e.message}`);
  }
  
  return {
    success: errors.length === 0,
    errors
  };
}

// ============================================================================
// EFFECT CREATION HELPERS
// ============================================================================

/**
 * Create a new custom effect from template
 */
export function createEffect(options = {}) {
  const id = options.id || createCustomEffectId();
  return {
    id,
    name: options.name || 'New Effect',
    description: options.description || '',
    version: 1,
    isBuiltin: false,
    sdfCode: options.sdfCode || EFFECT_PRESETS.sphere.sdfCode,
    colorCode: options.colorCode || EFFECT_PRESETS.sphere.colorCode,
    helperCode: options.helperCode || '',
    params: options.params || {},
  };
}

/**
 * Clone an existing effect
 */
export function cloneEffect(effect, newId) {
  return {
    ...effect,
    id: newId || createCustomEffectCloneId(effect.id),
    name: `${effect.name} (Copy)`,
    isBuiltin: false,
    version: 1,
  };
}

/**
 * Get all built-in presets as array
 */
export function getPresets() {
  return Object.values(EFFECT_PRESETS);
}

/**
 * Get preset by ID
 */
export function getPreset(id) {
  return EFFECT_PRESETS[id] || null;
}

export default {
  EFFECT_PRESETS,
  SDF_HELPERS_WGSL,
  generateVisualShader,
  generateCollisionShader,
  validateEffect,
  compileEffect,
  createEffect,
  cloneEffect,
  getPresets,
  getPreset,
};
