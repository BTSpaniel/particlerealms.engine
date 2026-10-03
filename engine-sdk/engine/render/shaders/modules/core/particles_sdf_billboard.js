// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Volumetric SDF Particle Shader
 * 
 * Complete billboard + SDF raymarching shader for realistic particle volumes.
 * 
 * ==================== ARCHITECTURE NOTES (for future AI/developers) ====================
 * 
 * THIS IS THE ACTIVE RENDERER. EditorParticles.js sets:
 *   particles.pipeline = sdfRenderer.pipeline
 *   particles.dataBindGroup = createParticleSdfDataBindGroup(...)
 * The billboard shader (particles_billboard_vertex.js) exists but is NOT used for rendering.
 * 
 * DATA FLOW:
 *   CPU (ParticleEmitterSystem.js stepEmitters):
 *     singleMeta[0..2] = emitterColor (from elementMixToEmitterConfig)
 *     → device.queue.writeBuffer(metaBuffer, offset, singleMeta)
 *   GPU vertex:
 *     uMeta[ii].xyz → input.color (uses instance_index directly, NO alive list)
 *   GPU fragment:
 *     input.color → volumetric lighting + thermal glow → vec4(lit, finalAlpha)
 *   Compositing:
 *     SDF output → half-res texture (pre-multiplied by src-alpha blend)
 *     → ParticleHalfResComposite (pre-multiplied blend onto scene)
 * 
 * BUFFER BINDINGS (group 1 - data):
 *   binding 0: uPositions  (vec4: xyz=position, w=age)
 *   binding 1: uMeta       (vec4: rgb=color, w=packed size/shape/behavior)
 *   binding 2: uParams      (uniform: defaultSize, quality, lodBias, cullThreshold)
 *   binding 3: uVelocities  (vec4: xyz=velocity, w=lifetime)
 *   binding 4: uThermalData (vec4: x=temperature(K), y=phase, z=packed group|matIdx, w=latent)
 * 
 * THERMAL COLOR MODULATION:
 *   thermalGlow > 0: hot particles shift toward orange/white (>500K)
 *   thermalGlow < 0: cold particles shift toward blue (<250K)
 *   270K (water+ice) = no modulation (room temp range)
 *   982K (fire) = 0.32 glow → 25% orange overlay
 * 
 * PARTICLE CULLING:
 *   Dead particles (t >= 1.0) or invisible (radius < 0.001) are collapsed to
 *   degenerate quads behind the far plane — zero fragment shader cost.
 */

import { ShaderComposer } from '../../ShaderComposer.js';

// ==================== VERTEX SHADER ====================
// Reads per-particle data from storage buffers using instance_index directly.
// NO alive list indirection — relies on IndirectDispatch setting drawIndirect.instanceCount
// to the alive particle count. Dead/uninitialized particles are culled in-shader.
const vertexWGSL = /* wgsl */`
struct FrameUniforms {
  viewProj: mat4x4<f32>,
  viewRight: vec3<f32>,
  _pad0: f32,
  viewUp: vec3<f32>,
  _pad1: f32,
  cameraPos: vec3<f32>,
  _pad2: f32,
  particleCount: u32,
  depthScaleX: f32,
  depthScaleY: f32,
  flags: u32,
  sunDir: vec3<f32>,
  sunIntensity: f32,
  sunColor: vec3<f32>,
  ambientIntensity: f32,
  ambientColor: vec3<f32>,
  time: f32,
  debugMode: f32,
  _padD0: f32,
  _padD1: f32,
  _padD2: f32,
};

struct ParticleParams {
  defaultSize: f32,
  quality: f32,
  lodBias: f32,
  cullThreshold: f32,
};

@group(0) @binding(0) var<uniform> uFrame: FrameUniforms;
@group(1) @binding(0) var<storage, read> uPositions: array<vec4<f32>>;
@group(1) @binding(1) var<storage, read> uMeta: array<vec4<f32>>;
@group(1) @binding(2) var<uniform> uParams: ParticleParams;
@group(1) @binding(3) var<storage, read> uVelocities: array<vec4<f32>>;
@group(1) @binding(4) var<storage, read> uThermalData: array<vec4<f32>>;
@group(1) @binding(5) var<storage, read> uSPHDensity: array<vec2<f32>>; // per-particle (density, pressure) from SPH sim
@group(1) @binding(6) var<storage, read> uClassification: array<u32>; // 0=none,1=bulk,2=surface,3=spray,4=foam,5=bubble

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) particleCenter: vec3<f32>,
  @location(2) color: vec3<f32>,
  @location(3) localPos: vec2<f32>,
  @location(4) particleDensity: f32,
  @location(5) velocity: vec3<f32>,
  @location(6) @interpolate(flat) particleIdx: u32,
  @location(7) @interpolate(flat) particleShape: u32,
  @location(8) thermalGlow: f32,
  @location(9) @interpolate(flat) depthScale: vec2<f32>,
  @location(10) lifetimeT: f32,
  @location(11) phase: f32,
  @location(12) temperature: f32,
  @location(13) latentProgress: f32,
  @location(14) cameraDist: f32,
  @location(15) globalTime: f32,
  // NOTE: particleDensity (@location(4)) repurposed to carry sphDensRatio (SPH density / restDensity).
  // sizeFactor * sprayFade is recomputed in the fragment from lifetimeT.
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  let pos4 = uPositions[ii];
  let center = pos4.xyz;
  let age = pos4.w;
  
  // Per-particle color from CPU meta buffer (set in ParticleEmitterSystem.js stepEmitters)
  // meta.rgb = emitterColor from elementMixToEmitterConfig (e.g. [0.5,0.7,0.9] for water+ice)
  // meta.w = packed: mass*1e8 + drag*1e6 + size*1e4 + renderMode*1e3 + shape*10 + behavior
  let particleMeta = uMeta[ii];
  let color = particleMeta.xyz;
  let packedValue = select(uParams.defaultSize * 1e5, particleMeta.w, particleMeta.w > 0.001);
  let particleSize = (floor(packedValue / 1e4) % 100.0) * 0.1;
  // Extract shape from packed value: mass*1e8 + drag*1e6 + size*1e4 + renderMode*1e3 + shape*10 + behavior
  let particleShape = u32(floor(packedValue / 10.0) % 10.0);
  
  let vel4 = uVelocities[ii];
  let velocity = vel4.xyz;
  let lifetime = max(vel4.w, 0.1);
  let t = clamp(age / lifetime, 0.0, 1.0);
  
  // Read thermal data (written by CPU at spawn, modified by GPU sim for conduction/reactions)
  // thermal.x = temperature in Kelvin (293=room, 270=sleet, 982=fire)
  // thermal.y = phase (0=solid, 1=liquid, 2=gas, 3=plasma)
  // thermal.z = packed: (groupId << 8) | materialIdx
  // thermal.w = latent energy accumulator
  let thermal = uThermalData[ii];
  let temperature = thermal.x; // Kelvin
  // Thermal glow: 0 at room temp, ramps up above 500K, maxes at 2000K
  let thermalGlow = clamp((temperature - 500.0) / 1500.0, 0.0, 1.0);
  // Cold tint: ramps up below 250K
  let coldTint = clamp((250.0 - temperature) / 200.0, 0.0, 1.0);
  
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0),
  );
  
  let corner = corners[vi % 6u];
  let sizeFactor = smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(0.9, 1.0, t));
  
  // Density-based sizing for liquid particles (GAP 4)
  // Isolated droplets (low SPH density) shrink; clustered fluid (high density) grows slightly.
  // Only affects liquid phase (phase ~1.0). Other phases use base size.
  let sphDP = uSPHDensity[ii]; // x=density, y=pressure
  let sphDensity = sphDP.x;
  let phaseIsLiquid = step(0.5, thermal.y) * step(thermal.y, 1.5); // 1.0 only for liquid
  // restDensity ~1000 for water. Ratio < 1 = isolated, > 1 = clustered.
  // Wider range: isolated droplets shrink to 15%, dense clusters grow to 180%.
  // sqrt smoothing for less jarring transitions.
  let densityRatio = select(1.0, sqrt(clamp(sphDensity / 1000.0, 0.15, 1.8)), sphDensity > 0.0);
  let densityScale = mix(1.0, densityRatio, phaseIsLiquid);
  // Spray alpha fade: very isolated liquid particles fade out
  let sprayFade = select(1.0, smoothstep(0.2, 0.5, sphDensity / 1000.0), phaseIsLiquid > 0.5 && sphDensity > 0.0);
  let radius = particleSize * 0.5 * sizeFactor * densityScale;
  
  // Camera distance for LOD (GAP 14)
  let cameraDist = distance(center, uFrame.cameraPos);
  
  // GAP 14: Sub-pixel culling — estimate screen-space size and cull tiny particles
  // Approximate pixel radius = worldRadius / cameraDist * screenHeight/2
  // Use lodBias as screen height proxy (default ~500)
  let screenRadius = select(radius / cameraDist * max(uParams.lodBias, 200.0), 999.0, cameraDist < 0.01);
  let cullSize = max(uParams.cullThreshold, 0.5); // minimum screen pixels to render
  
  // GPU culling: collapse dead/invisible/sub-pixel particles to degenerate quad
  if (t >= 1.0 || radius < 0.001 || screenRadius < cullSize) {
    var out: VSOut;
    out.position = vec4<f32>(0.0, 0.0, 2.0, 1.0); // behind far plane
    out.worldPos = vec3<f32>(0.0);
    out.particleCenter = vec3<f32>(0.0);
    out.color = vec3<f32>(0.0);
    out.localPos = vec2<f32>(0.0);
    out.particleDensity = 1.0; // sphDensRatio default = 1 (rest density)
    out.velocity = vec3<f32>(0.0);
    out.particleIdx = ii;
    out.particleShape = 0u;
    out.thermalGlow = 0.0;
    out.lifetimeT = 0.0;
    out.phase = 0.0;
    out.temperature = 293.0;
    out.latentProgress = 0.0;
    out.cameraDist = 0.0;
    out.globalTime = 0.0;
    return out;
  }
  
  let viewRight = uFrame.viewRight;
  let viewUp = uFrame.viewUp;
  let phaseVal = thermal.y; // 0=solid, 1=liquid, 2=gas, 3=plasma
  
  // Velocity stretching for solid + liquid phase particles
  // Gas/smoke/fire remain round puffs; plasma remains round glow.
  var worldOffset: vec3<f32>;
  let speed = length(velocity);
  if (phaseVal < 0.5 && speed > 0.5) {
    // Solid: stretch billboard along velocity direction
    let stretchFactor = clamp(speed * 0.4, 0.0, 3.0);
    let velDir = normalize(velocity);
    let velScreen = normalize(vec2<f32>(dot(velDir, viewRight), dot(velDir, viewUp)));
    let stretchRight = viewRight * (velScreen.x * stretchFactor + corner.x) * radius;
    let stretchUp = viewUp * (velScreen.y * stretchFactor + corner.y) * radius;
    let baseOffset = viewRight * corner.x * radius + viewUp * corner.y * radius;
    worldOffset = mix(baseOffset, stretchRight + stretchUp, 0.6);
  } else if (phaseVal > 0.5 && phaseVal < 1.5 && speed > 1.0) {
    // Liquid: gentler stretch — fluid motion, not rigid elongation
    let stretchFactor = clamp(speed * 0.15, 0.0, 2.0);
    let velDir = normalize(velocity);
    let velScreen = normalize(vec2<f32>(dot(velDir, viewRight), dot(velDir, viewUp)));
    let stretchRight = viewRight * (velScreen.x * stretchFactor + corner.x) * radius;
    let stretchUp = viewUp * (velScreen.y * stretchFactor + corner.y) * radius;
    let baseOffset = viewRight * corner.x * radius + viewUp * corner.y * radius;
    worldOffset = mix(baseOffset, stretchRight + stretchUp, 0.4);
  } else {
    // Gas, plasma, slow liquid: standard screen-facing billboard
    worldOffset = viewRight * corner.x * radius + viewUp * corner.y * radius;
  }
  let worldPos = center + worldOffset;
  
  let clipPos = uFrame.viewProj * vec4<f32>(worldPos, 1.0);
  
  var out: VSOut;
  out.position = clipPos;
  out.worldPos = worldPos;
  out.particleCenter = center;
  out.color = color;
  out.localPos = corner;
  // Repurpose particleDensity to carry sphDensRatio for fluid color ramp in fragment.
  // sizeFactor * sprayFade is recomputed in the fragment from lifetimeT.
  let rawDensRatio = select(1.0, clamp(sphDensity / 1000.0, 0.0, 2.0), sphDensity > 0.0);
  out.particleDensity = select(rawDensRatio, 1.0, phaseIsLiquid < 0.5); // only meaningful for liquid
  out.velocity = velocity;
  out.particleIdx = ii;
  // Pack classId into upper 16 bits of particleShape to avoid adding a new VSOut location
  let classId = uClassification[ii];
  out.particleShape = particleShape | (classId << 16u);
  out.thermalGlow = thermalGlow - coldTint; // Positive = hot glow, negative = cold tint
  out.depthScale = vec2<f32>(uFrame.depthScaleX, uFrame.depthScaleY);
  out.lifetimeT = t;
  out.phase = thermal.y;
  out.temperature = temperature;
  out.latentProgress = clamp(thermal.w / 100.0, 0.0, 1.0);
  out.cameraDist = cameraDist;
  out.globalTime = uFrame.time;
  return out;
}
`;

// ==================== FRAGMENT SHADER ====================
// Performs per-particle volumetric SDF raymarching for realistic 3D volumes.
// Color comes from vertex shader (input.color = meta buffer RGB).
// Thermal glow modulates color based on temperature from thermalData buffer.
// Output is NON-premultiplied vec4(lit, finalAlpha) — the SDF pipeline's
// src-alpha blend into the half-res texture produces pre-multiplied results.
// See ParticleHalfResComposite.js for why the composite uses srcFactor='one'.
const fragmentWGSL = /* wgsl */`
// Soft particles: scene depth texture for depth-fade at geometry intersections
// Bound via createParticleSdfDepthBindGroup (only depth texture, no alive list)
@group(2) @binding(0) var uSceneDepth: texture_depth_2d;

// Color gradient + lifetime curves LUT textures (group 3)
// Color gradient: 1D RGBA texture sampled by lifetimeT (from ParticleColorGradient.js)
// Lifetime curves: 1D RGBA texture (R=size, G=alpha, B=velocity, A=1) from ParticleLifetimeCurves.js
@group(3) @binding(0) var uColorGradient: texture_2d<f32>;
@group(3) @binding(1) var uColorGradientSampler: sampler;
@group(3) @binding(2) var uLifetimeCurves: texture_2d<f32>;
@group(3) @binding(3) var uLifetimeCurvesSampler: sampler;

// Six-way directional lightmaps for volumetric billboard smoke (merged into group 3)
@group(3) @binding(4) var uSixWayRight: texture_2d<f32>;
@group(3) @binding(5) var uSixWayLeft: texture_2d<f32>;
@group(3) @binding(6) var uSixWayTop: texture_2d<f32>;
@group(3) @binding(7) var uSixWayBottom: texture_2d<f32>;
@group(3) @binding(8) var uSixWayFront: texture_2d<f32>;
@group(3) @binding(9) var uSixWayBack: texture_2d<f32>;
@group(3) @binding(10) var uSixWaySampler: sampler;
struct SixWayParams {
  lightDir: vec3<f32>,
  intensity: f32,
};
@group(3) @binding(11) var<uniform> uSixWayParams: SixWayParams;

const SHAPE_SPHERE: u32 = 0u;
const SHAPE_ELLIPSOID: u32 = 1u;
const SHAPE_CAPSULE: u32 = 2u;
const SHAPE_ROUNDED_BOX: u32 = 3u;
const SHAPE_TORUS: u32 = 4u;
const SHAPE_CONE: u32 = 5u;
const SHAPE_CYLINDER: u32 = 6u;

struct RaymarchResult {
  hit: bool,
  dist: f32,
  steps: i32,
  density: f32,
  noiseDetail: f32,
  volumetricLight: vec3<f32>,
};

// Local cylinder SDF (not in library)
fn sdCylinderLocal(p: vec3<f32>, h: f32, r: f32) -> f32 {
  let d = abs(vec2<f32>(length(p.xz), p.y)) - vec2<f32>(r, h);
  return min(max(d.x, d.y), 0.0) + length(max(d, vec2<f32>(0.0)));
}

// Map scene for single particle with shape selection
// Uses SDF functions from sdf/shapes library
fn mapSceneSingleParticle(p: vec3<f32>, shapeScale: vec3<f32>, shape: u32, velDir: vec3<f32>) -> f32 {
  // Rotate point to align with velocity direction for oriented shapes
  var rotP = p;
  let speed = length(velDir);
  if (speed > 0.1) {
    let up = vec3<f32>(0.0, 1.0, 0.0);
    let dir = normalize(velDir);
    // Simple rotation toward velocity
    let cosA = dot(up, dir);
    if (abs(cosA) < 0.999) {
      let axis = normalize(cross(up, dir));
      let sinA = length(cross(up, dir));
      // Rodrigues rotation
      rotP = p * cosA + cross(axis, p) * sinA + axis * dot(axis, p) * (1.0 - cosA);
    }
  }
  
  let r = shapeScale.x;
  
  switch(shape) {
    case SHAPE_ELLIPSOID: {
      // Velocity-stretched ellipsoid (uses library sdEllipsoid)
      let stretch = clamp(1.0 + speed * 0.3, 1.0, 3.0);
      return sdEllipsoid(rotP, vec3<f32>(r, r * stretch, r));
    }
    case SHAPE_CAPSULE: {
      // Library sdCapsule(p, a, b, r) uses two endpoints
      let h = r * 0.8;
      return sdCapsule(rotP, vec3<f32>(0.0, -h, 0.0), vec3<f32>(0.0, h, 0.0), r * 0.5);
    }
    case SHAPE_ROUNDED_BOX: {
      // Library uses sdRoundBox
      return sdRoundBox(p, vec3<f32>(r * 0.7), r * 0.15);
    }
    case SHAPE_TORUS: {
      return sdTorus(p, vec2<f32>(r * 0.6, r * 0.25));
    }
    case SHAPE_CONE: {
      // Library sdCone(p, c, h) where c is vec2 angle
      return sdCone(rotP, vec2<f32>(0.5, 0.866), r * 1.2);
    }
    case SHAPE_CYLINDER: {
      return sdCylinderLocal(rotP, r * 0.6, r * 0.4);
    }
    default: {
      // SHAPE_SPHERE (0) or unknown - uses library sdSphere
      return sdSphere(p, r);
    }
  }
}

// Phase-aware raymarch: different density/noise behavior per phase
fn raymarchPhase(ro: vec3<f32>, rd: vec3<f32>, shapeScale: vec3<f32>, worldPos: vec3<f32>, shape: u32, vel: vec3<f32>, phase: f32, cameraDist: f32, lifetimeT: f32, globalTime: f32, particleIdx: u32) -> RaymarchResult {
  var result: RaymarchResult;
  result.hit = false;
  result.dist = 0.0;
  result.steps = 0;
  result.density = 0.0;
  result.noiseDetail = 0.0;
  result.volumetricLight = vec3<f32>(0.0);
  
  let radius = shapeScale.x;
  // GAP 14: Distance-adaptive raymarching — fewer steps for distant particles
  // Close (<5): 16 steps (full quality), Medium (5-15): 10, Far (15-40): 6, Very far (>40): 4
  let lodSteps = select(select(select(4, 6, cameraDist < 40.0), 10, cameraDist < 15.0), 16, cameraDist < 5.0);
  let STEPS = lodSteps;
  let maxDist = radius * 3.0;
  let dt = maxDist / f32(STEPS);
  
  // Phase-specific parameters
  let isLiquid = (phase > 0.5 && phase < 1.5);
  let isSolid  = (phase < 0.5);
  let isPlasma = (phase > 2.5);
  
  // Noise strength: gas=full, liquid=dynamic, solid=subtle, plasma=medium
  var noiseStrength: f32;
  let liquidSpeed = length(vel);
  if (isLiquid) { noiseStrength = 0.2 + clamp(liquidSpeed * 0.15, 0.0, 0.25); } // animated wobble
  else if (isSolid) { noiseStrength = 0.15; }  // slight surface texture
  else if (isPlasma) { noiseStrength = 0.4; }  // medium turbulence
  else { noiseStrength = 1.0; }                // full wispy gas
  
  // Absorption coefficient: liquid/solid = opaque, gas = translucent
  var absorptionCoeff: f32;
  if (isLiquid) { absorptionCoeff = 1.0; }     // semi-transparent liquid (water is clear!)
  else if (isSolid) { absorptionCoeff = 5.0; } // very opaque solid
  else if (isPlasma) { absorptionCoeff = 2.0; } // semi-translucent plasma glow
  else { absorptionCoeff = 0.4; }              // translucent gas
  
  // Density falloff: liquid/solid = sharp edge, gas = soft falloff
  var edgeSharpness: f32;
  if (isLiquid || isSolid) { edgeSharpness = 0.05; } // sharp surface
  else { edgeSharpness = 0.2; }                       // soft gas edge
  var falloffWidth: f32;
  if (isLiquid || isSolid) { falloffWidth = -0.3; }   // tight
  else { falloffWidth = -0.8; }                        // wide wispy
  
  // Precompute for gas volumetric light accumulation
  let isGasPhase = (!isLiquid && !isSolid && !isPlasma);
  var gasLightDir = vec3<f32>(0.0, -1.0, 0.0);
  var gasHG: f32 = 0.08;
  if (isGasPhase) {
    gasLightDir = normalize(-uFrame.sunDir);
    let cosTheta = dot(rd, -gasLightDir);
    let g = 0.35; // forward scattering (silver lining)
    gasHG = (1.0 - g * g) / (12.566 * pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5));
  }
  
  var transmittance = 1.0;
  var t = 0.0;
  var lastNoise = 0.5;
  
  for (var i = 0; i < STEPS; i++) {
    if (transmittance < 0.01) { break; }
    
    let p = ro + rd * t;
    let d = mapSceneSingleParticle(p, shapeScale, shape, vel);
    let normalizedDist = d / radius;
    
    var localDensity = smoothstep(edgeSharpness, falloffWidth, normalizedDist);
    
    if (localDensity < 0.001) {
      t += dt;
      continue;
    }
    
    // 3D noise turbulence — modulated by phase
    // Gas: add temporal scroll so fire shapes dance/flicker as particle ages
    // Liquid: animate with globalTime for wobbling surface
    var noiseP = worldPos * 1.5 + p * 3.5;
    if (isGasPhase) {
      noiseP += vec3<f32>(lifetimeT * 3.0, lifetimeT * 8.0, lifetimeT * 2.5);
    } else if (isLiquid) {
      let particleSeed = fract(f32(particleIdx) * 0.618034) * 6.28;
      noiseP += vec3<f32>(globalTime * 1.2 + particleSeed, globalTime * 0.8, globalTime * 1.5);
      noiseP += normalize(vel + vec3<f32>(0.001)) * liquidSpeed * 0.3;
    }
    let noiseVal = noise3d(noiseP);
    lastNoise = noiseVal * 0.5 + 0.5;
    
    // Noise modulation: gas=strong wispy, liquid/solid=barely visible
    localDensity *= (1.0 - noiseStrength + lastNoise * noiseStrength);
    
    // Beer-Lambert absorption for this step
    let stepExtinction = localDensity * absorptionCoeff * dt;
    let stepTrans = exp(-stepExtinction);
    let absorbed = transmittance * (1.0 - stepTrans);
    
    // Gas: accumulate in-scattered light per-step (proper volumetric rendering)
    if (isGasPhase) {
      // Self-shadow: use SDF depth-inside as proxy for light path occlusion
      let depthInside = max(-d, 0.0);
      let selfShadow = exp(-depthInside * absorptionCoeff * 3.0);
      // In-scattered light: sun (with self-shadow + HG phase) + ambient
      let sunIn = uFrame.sunColor * uFrame.sunIntensity * selfShadow * gasHG;
      let ambIn = uFrame.ambientColor * uFrame.ambientIntensity;
      result.volumetricLight += absorbed * (sunIn + ambIn);
    }
    
    transmittance *= stepTrans;
    t += dt;
  }
  
  let finalDensity = 1.0 - transmittance;
  if (finalDensity > 0.005) {
    result.hit = true;
    result.dist = t * 0.25;
    result.noiseDetail = lastNoise;
    result.density = clamp(finalDensity, 0.0, 1.0);
  }
  
  return result;
}

// Legacy wrapper
fn raymarch(ro: vec3<f32>, rd: vec3<f32>, shapeScale: vec3<f32>, worldPos: vec3<f32>, shape: u32, vel: vec3<f32>) -> RaymarchResult {
  return raymarchPhase(ro, rd, shapeScale, worldPos, shape, vel, 2.0, 0.0, 0.0, 0.0, 0u); // default gas, full quality
}

fn calcNormal(p: vec3<f32>, shapeScale: vec3<f32>, shape: u32, vel: vec3<f32>) -> vec3<f32> {
  let eps = 0.002;
  let h = vec2<f32>(eps, 0.0);
  return normalize(vec3<f32>(
    mapSceneSingleParticle(p + h.xyy, shapeScale, shape, vel) - mapSceneSingleParticle(p - h.xyy, shapeScale, shape, vel),
    mapSceneSingleParticle(p + h.yxy, shapeScale, shape, vel) - mapSceneSingleParticle(p - h.yxy, shapeScale, shape, vel),
    mapSceneSingleParticle(p + h.yyx, shapeScale, shape, vel) - mapSceneSingleParticle(p - h.yyx, shapeScale, shape, vel)
  ));
}

// ========== FIRE COLOR RAMP ==========
// Maps a 0-1 "heat intensity" to physically-inspired fire colors:
// 0.0 = dark/black -> 0.2 = deep red -> 0.4 = orange-red -> 0.6 = orange -> 0.8 = yellow -> 1.0 = white-hot
fn fireColorRamp(heat: f32) -> vec3<f32> {
  // Shifted left for brighter colors at lower heat (additive composite needs bright base)
  let r = smoothstep(0.0, 0.25, heat);
  let g = smoothstep(0.1, 0.6, heat);
  let b = smoothstep(0.45, 0.9, heat) * 0.7;
  return vec3<f32>(r, g, b);
}

// ========== GAS VOLUMETRIC LIGHTING (existing) ==========
fn volumetricLightingGas(
  normal: vec3<f32>,
  viewDir: vec3<f32>,
  color: vec3<f32>,
  density: f32
) -> vec3<f32> {
  let lightDir = normalize(-uFrame.sunDir);
  // Wrap lighting for translucent gas: softer diffuse falloff
  let wrapNdl = dot(normal, lightDir) * 0.5 + 0.5;
  let diffuse = color * uFrame.sunColor * uFrame.sunIntensity * wrapNdl * 0.8;
  let ambient = color * uFrame.ambientColor * uFrame.ambientIntensity * 2.0;
  let fresnel = pow(1.0 - abs(dot(normal, viewDir)), 2.5);
  let rim = uFrame.sunColor * fresnel * 0.4;
  // Subsurface: light passes through translucent gas, stronger when less dense
  let backLight = max(dot(-normal, lightDir), 0.0);
  let translucency = 1.0 - density;
  let subsurface = color * uFrame.sunColor * backLight * 0.35 * translucency;
  return diffuse + ambient + rim + subsurface;
}

// ========== FLUID DENSITY COLOR RAMP (from Particle Storm / Thermal demo) ==========
// Maps SPH density ratio to water color: sparse droplets = deep blue, dense bulk = cyan, surface foam = white
// Mirrors the playground's iceberg melt water coloring: dark core → bright surface
fn fluidDensityColor(densityRatio: f32, baseColor: vec3<f32>) -> vec3<f32> {
  // densityRatio: 0 = isolated droplet, 1 = rest density, >1 = compressed
  let t = clamp(densityRatio, 0.0, 1.5) / 1.5;
  // 3-stop ramp: deep ocean blue → clear cyan → white foam crest
  let deepBlue  = vec3<f32>(0.04, 0.12, 0.55);  // deep water body
  let clearCyan = vec3<f32>(0.15, 0.55, 0.88);  // mid-density clear water
  let foamWhite = vec3<f32>(0.82, 0.92, 1.00);  // surface foam / spray
  var ramp: vec3<f32>;
  if (t < 0.5) {
    ramp = mix(deepBlue, clearCyan, t * 2.0);
  } else {
    ramp = mix(clearCyan, foamWhite, (t - 0.5) * 2.0);
  }
  // Blend with emitter base color so custom water colors still show through
  return mix(ramp, baseColor, 0.22);
}

// ========== LIQUID LIGHTING (transparent water with specular + Fresnel + caustics) ==========
fn liquidLighting(
  normal: vec3<f32>,
  viewDir: vec3<f32>,
  color: vec3<f32>,
  densityRatio: f32
) -> vec3<f32> {
  let lightDir = normalize(-uFrame.sunDir);
  // Density-driven color ramp: isolated droplets are deep blue, dense bulk is cyan, foam is white
  let waterTint = fluidDensityColor(densityRatio, color);
  // Inherent water body color — water is visibly blue even in shadow
  let bodyColor = waterTint * 0.38;
  // Diffuse lighting
  let ndl = max(dot(normal, lightDir), 0.0);
  let diffuse = waterTint * uFrame.sunColor * uFrame.sunIntensity * ndl * 0.55;
  // Ambient
  let ambient = waterTint * uFrame.ambientColor * uFrame.ambientIntensity * 0.65;
  // Blue-tinted specular for sun glint (NOT pure white)
  let halfVec = normalize(lightDir + viewDir);
  let specSharp = pow(max(dot(normal, halfVec), 0.0), 96.0);
  let specTint = mix(vec3<f32>(0.6, 0.8, 1.0), uFrame.sunColor, 0.3);
  let specular = specTint * uFrame.sunIntensity * specSharp * 0.5;
  // Fresnel reflection (Schlick) — water IOR ~1.33
  let cosTheta = max(dot(normal, viewDir), 0.0);
  let f0 = 0.02;
  let fresnel = f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);
  // Environment reflection: deep blue sky at edges
  let skyColor = vec3<f32>(0.2, 0.35, 0.7);
  let reflection = skyColor * fresnel * 0.6;
  // Foam highlight: dense surface particles get extra white brightness
  let foamBoost = smoothstep(0.8, 1.4, densityRatio) * 0.25;
  let foam = vec3<f32>(foamBoost);
  // Clamp but allow blue to shine through
  return min(bodyColor + diffuse + ambient + specular + reflection + foam, vec3<f32>(0.6, 0.78, 1.0));
}

// ========== SOLID LIGHTING (matte diffuse) ==========
fn solidLighting(
  normal: vec3<f32>,
  viewDir: vec3<f32>,
  color: vec3<f32>
) -> vec3<f32> {
  let lightDir = normalize(-uFrame.sunDir);
  let ndl = max(dot(normal, lightDir), 0.0);
  let diffuse = color * uFrame.sunColor * uFrame.sunIntensity * ndl * 0.8;
  let ambient = color * uFrame.ambientColor * uFrame.ambientIntensity * 1.2;
  // Subtle specular for rough surface
  let halfVec = normalize(lightDir + viewDir);
  let spec = pow(max(dot(normal, halfVec), 0.0), 8.0);
  let specular = uFrame.sunColor * spec * 0.15;
  return diffuse + ambient + specular;
}

// ========== PLASMA LIGHTING (emissive glow) ==========
fn plasmaLighting(
  normal: vec3<f32>,
  viewDir: vec3<f32>,
  color: vec3<f32>,
  density: f32
) -> vec3<f32> {
  // Plasma is mostly emissive but tinted by sun color
  let coreFactor = density * density;
  let coreColor = vec3<f32>(1.0, 1.0, 1.0);
  let edgeColor = color * 2.0;
  let emissive = mix(edgeColor, coreColor, coreFactor);
  // Pulsating glow at edges, tinted by sun
  let fresnel = pow(1.0 - abs(dot(normal, viewDir)), 2.0);
  let glow = color * fresnel * 1.5;
  // Subtle sun tint on plasma
  let sunTint = uFrame.sunColor * uFrame.sunIntensity * 0.1;
  return emissive + glow + sunTint;
}

// Legacy wrapper for compatibility
fn volumetricLighting(
  p: vec3<f32>,
  normal: vec3<f32>,
  viewDir: vec3<f32>,
  color: vec3<f32>,
  density: f32
) -> vec3<f32> {
  return volumetricLightingGas(normal, viewDir, color, density);
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
  // Early radial discard — skip raymarch for fragments outside billboard
  let radialDistEarly = length(input.localPos);
  if (radialDistEarly > 1.15) {
    discard;
  }
  
  // Ray setup in particle local space
  let rayOrigin = vec3<f32>(input.localPos.x, input.localPos.y, 1.2);
  let rayDir = vec3<f32>(0.0, 0.0, -1.0);
  
  // SDF scale — fills most of the billboard quad
  let baseScale = 0.85;
  let shapeScale = vec3<f32>(baseScale, baseScale, baseScale);
  
  // Unpack shape and classId from packed particleShape
  let packedShape = input.particleShape;
  let shapeId = packedShape & 0xFFFFu;
  let classId = packedShape >> 16u;
  // CLASS constants: 0=none,1=bulk,2=surface,3=spray,4=foam,5=bubble
  let isFoam   = (classId == 4u);
  let isSpray  = (classId == 3u);
  let isBubble = (classId == 5u);
  let isSurface = (classId == 2u);

  // Phase constants for branching
  let phaseVal = input.phase;
  let isLiquid = (phaseVal > 0.5 && phaseVal < 1.5);
  let isSolid  = (phaseVal < 0.5);
  let isPlasma = (phaseVal > 2.5);
  let isGas    = !isLiquid && !isSolid && !isPlasma;
  
  // Phase-aware raymarch: different density/noise/absorption per phase (GAP 14: distance-adaptive steps)
  let result = raymarchPhase(rayOrigin, rayDir, shapeScale, input.particleCenter, shapeId, input.velocity, phaseVal, input.cameraDist, input.lifetimeT, input.globalTime, input.particleIdx);
  
  if (!result.hit) {
    discard;
  }
  
  // ========== DEBUG MODE OVERRIDE ==========
  // Early return for debug visualization — skips all color/thermal/lighting
  let debugMode = u32(uFrame.debugMode);
  if (debugMode >= 1u) {
    let dbgNormal = normalize(vec3<f32>(input.localPos.x, input.localPos.y, 0.6));
    let dbgFade = smoothstep(0.0, 0.1, input.lifetimeT) * (1.0 - smoothstep(0.9, 1.0, input.lifetimeT));
    let dbgAlpha = min(result.density * dbgFade, 0.95);
    if (debugMode == 1u) {
      // Normals: surface normal as RGB
      return vec4<f32>(dbgNormal * 0.5 + 0.5, dbgAlpha);
    }
    if (debugMode == 2u) {
      // Depth: linearized clip-space depth as grayscale
      let d = input.position.z;
      return vec4<f32>(vec3<f32>(1.0 - d), dbgAlpha);
    }
    if (debugMode == 3u) {
      // Roughness: phase-based estimate (liquid=smooth, solid=rough, gas=very rough)
      var roughness: f32;
      if (isLiquid) { roughness = 0.1; }
      else if (isSolid) { roughness = 0.8; }
      else if (isPlasma) { roughness = 0.05; }
      else { roughness = 0.95; }
      return vec4<f32>(vec3<f32>(roughness), dbgAlpha);
    }
  }
  
  // ========== COLOR ==========
  // Color gradient LUT over lifetime
  let gradientUV = vec2<f32>(clamp(input.lifetimeT, 0.0, 1.0), 0.5);
  let gradColor = textureSampleLevel(uColorGradient, uColorGradientSampler, gradientUV, 0.0);
  let baseParticleColor = mix(input.color, gradColor.rgb, gradColor.a);
  
  // Lifetime curves (size/alpha/velocity)
  let curveDims = textureDimensions(uLifetimeCurves);
  let curveTexelX = i32(clamp(input.lifetimeT, 0.0, 1.0) * f32(curveDims.x - 1u));
  let curves = textureLoad(uLifetimeCurves, vec2<i32>(curveTexelX, 0), 0);
  let alphaOverLife = curves.g;
  
  // Noise-based color variation for organic look
  var particleColor = baseParticleColor * (0.85 + result.noiseDetail * 0.3);
  
  // ========== BLACKBODY RADIATION + THERMAL MODULATION ==========
  let thermalGlow = input.thermalGlow;
  if (thermalGlow > 0.0 && isGas) {
    // ---- FIRE: density-driven color ramp with flickering ----
    // Dense core = white/yellow hot, medium = orange, thin edges = red, very thin = dark smoke
    let densityHeat = pow(result.density, 0.5);  // boost core brightness
    // Lifetime cooling: young particles are hot (yellow), old particles cool (red -> dark)
    let lifetimeHeat = 1.0 - input.lifetimeT * 0.6;
    // Vertical gradient within particle: bottom hotter, top cooler (fire rises)
    let verticalHeat = clamp(0.55 - input.localPos.y * 0.35, 0.0, 1.0);
    // Noise turbulence for color flickering (organic, dancing look)
    let noiseTurb = (result.noiseDetail - 0.5) * 0.25;
    // Per-particle variation so adjacent particles aren't identical
    let particleSeed = fract(f32(input.particleIdx) * 0.618034) * 0.1;
    // Weighted average (NOT multiplicative) so mid-density areas are orange, not dark red
    let heat = clamp(
      densityHeat * 0.4 + lifetimeHeat * 0.3 + verticalHeat * 0.15 + noiseTurb + particleSeed,
      0.0, 1.0
    );
    // Scale by temperature: 900K candle=warm orange, 1200K fire=bright orange/yellow, 2000K=white-hot
    let fireHeat = clamp(heat * (0.5 + thermalGlow * 0.7), 0.0, 1.0);
    particleColor = fireColorRamp(fireHeat);
  } else if (thermalGlow > 0.0) {
    // ---- NON-GAS HOT PARTICLES (lava, sparks): standard blackbody blend ----
    let temp = max(input.temperature, 800.0);
    let t100 = temp / 100.0;
    var bbR: f32; var bbG: f32; var bbB: f32;
    if (t100 <= 66.0) {
      bbR = 1.0;
      bbG = clamp((99.4708025861 * log(t100) - 161.1195681661) / 255.0, 0.0, 1.0);
    } else {
      bbR = clamp(329.698727446 * pow(t100 - 60.0, -0.1332047592) / 255.0, 0.0, 1.0);
      bbG = clamp(288.1221695283 * pow(t100 - 60.0, -0.0755148492) / 255.0, 0.0, 1.0);
    }
    if (t100 >= 66.0) { bbB = 1.0; }
    else if (t100 <= 19.0) { bbB = 0.0; }
    else { bbB = clamp((138.5177312231 * log(t100 - 10.0) - 305.0447927307) / 255.0, 0.0, 1.0); }
    let bbColor = vec3<f32>(bbR, bbG, bbB);
    particleColor = mix(particleColor, bbColor, thermalGlow * 0.85);
    particleColor += bbColor * smoothstep(0.2, 0.8, thermalGlow) * 0.8;
  } else if (thermalGlow < 0.0) {
    let coldColor = vec3<f32>(0.3, 0.5, 1.0);
    particleColor = mix(particleColor, coldColor, -thermalGlow * 0.6);
  }
  
  // ========== CONTINUOUS PHASE-BLEND COLOR (from Thermal demo CS_ICE_WATER pattern) ==========
  // Mirrors the playground's smoothstep phase blending: ice/water/steam coexist continuously
  // Uses normalized temperature: 0=cold ice, 0.294=melt, 0.88=boil, 1=hot steam
  // Editor uses Kelvin: 273K=melt, 373K=boil → normalize to [0,1] over [0K, 1000K]
  let tempNorm = clamp(input.temperature / 1000.0, 0.0, 1.0);
  let iceFac   = 1.0 - smoothstep(0.22, 0.30, tempNorm);  // solid ice below ~220K
  let steamFac = smoothstep(0.35, 0.42, tempNorm);         // steam above ~350K
  let waterFac = max(0.0, 1.0 - iceFac - steamFac);        // liquid between
  // Ice frost overlay: cold particles get a white-blue crystalline tint
  if (iceFac > 0.01) {
    let frostColor = vec3<f32>(0.82, 0.90, 1.00);
    particleColor = mix(particleColor, frostColor, iceFac * 0.65);
  }
  // Steam translucency: hot gas gets a pale grey-white wash (condensation)
  if (steamFac > 0.01 && !isLiquid && !isSolid) {
    let steamColor = vec3<f32>(0.78, 0.82, 0.88);
    particleColor = mix(particleColor, steamColor, steamFac * 0.5);
  }
  // Phase transition VFX
  particleColor = applyPhaseVFX(particleColor, input.localPos * 0.5 + 0.5, 0.0, input.phase, input.temperature, input.latentProgress);
  
  // ========== PHASE-AWARE LIGHTING ==========
  let fakeNormal = normalize(vec3<f32>(input.localPos.x, input.localPos.y, 0.6));
  let viewDir = vec3<f32>(0.0, 0.0, 1.0);
  var lit: vec3<f32>;
  
  if (isLiquid) {
    // Liquid: density-driven color ramp + specular + Fresnel reflection
    // input.particleDensity carries sphDensRatio (repurposed from sizeFactor*sprayFade)
    var liquidColor = particleColor;
    // Foam: white frothy tint — isolated slow surface particles
    if (isFoam) {
      let foamWhite = vec3<f32>(0.88, 0.94, 1.0);
      liquidColor = mix(liquidColor, foamWhite, 0.75);
    }
    // Spray: bright saturated droplet — fast isolated particles
    if (isSpray) {
      let sprayBlue = vec3<f32>(0.4, 0.75, 1.0);
      liquidColor = mix(liquidColor, sprayBlue, 0.5);
    }
    // Bubble: pale translucent rising sphere
    if (isBubble) {
      let bubbleColor = vec3<f32>(0.7, 0.88, 1.0);
      liquidColor = mix(liquidColor, bubbleColor, 0.6);
    }
    // Surface: slight bright highlight at the water-air interface
    if (isSurface) {
      liquidColor = liquidColor * 1.15;
    }
    lit = liquidLighting(fakeNormal, viewDir, liquidColor, input.particleDensity);
  } else if (isSolid) {
    // Solid: matte diffuse (rock/debris/snow look)
    lit = solidLighting(fakeNormal, viewDir, particleColor);
  } else if (isPlasma) {
    // Plasma: emissive glow
    lit = plasmaLighting(fakeNormal, viewDir, particleColor, result.density);
  } else {
    // Gas: proper volumetric lighting accumulated during raymarch
    // result.volumetricLight is unmodulated in-scatter; multiply by albedo here
    lit = result.volumetricLight * particleColor;
    // Self-emission for hot gas (fire/lava vapor) — fire glows from within,
    // it doesn't need external light to be visible. Cold smoke (thermalGlow=0) unaffected.
    // Boosted 3-5× because additive composite + low fire alpha needs bright base color.
    if (thermalGlow > 0.0) {
      let emissionStrength = thermalGlow * (2.5 + result.density * 3.5);
      lit += particleColor * emissionStrength;
    }
  }
  
  // Six-way directional lightmaps (gas/smoke only — liquid/solid/plasma have own lighting)
  if (isGas && uSixWayParams.intensity > 0.01) {
    let sixWayUV = input.localPos * 0.5 + 0.5;
    let ld = normalize(uSixWayParams.lightDir);
    let posX = max(ld.x, 0.0); let negX = max(-ld.x, 0.0);
    let posY = max(ld.y, 0.0); let negY = max(-ld.y, 0.0);
    let posZ = max(ld.z, 0.0); let negZ = max(-ld.z, 0.0);
    let swRight  = textureSampleLevel(uSixWayRight, uSixWaySampler, sixWayUV, 0.0).rgb * posX;
    let swLeft   = textureSampleLevel(uSixWayLeft, uSixWaySampler, sixWayUV, 0.0).rgb * negX;
    let swTop    = textureSampleLevel(uSixWayTop, uSixWaySampler, sixWayUV, 0.0).rgb * posY;
    let swBottom = textureSampleLevel(uSixWayBottom, uSixWaySampler, sixWayUV, 0.0).rgb * negY;
    let swFront  = textureSampleLevel(uSixWayFront, uSixWaySampler, sixWayUV, 0.0).rgb * posZ;
    let swBack   = textureSampleLevel(uSixWayBack, uSixWaySampler, sixWayUV, 0.0).rgb * negZ;
    let sixWayLight = swRight + swLeft + swTop + swBottom + swFront + swBack;
    lit = mix(lit, lit * sixWayLight * 2.0, uSixWayParams.intensity);
  }
  
  // ========== DARK FRAGMENT SKIP ==========
  // Only discard truly invisible fragments (near-zero alpha AND near-zero brightness)
  let brightness = max(lit.r, max(lit.g, lit.b));
  if (brightness < 0.005 && result.density < 0.01) {
    discard;
  }
  
  // ========== PHASE-AWARE ALPHA ==========
  // Recompute sizeFactor * sprayFade from lifetimeT (particleDensity is now sphDensRatio)
  let sizeFactor = smoothstep(0.0, 0.1, input.lifetimeT) * (1.0 - smoothstep(0.9, 1.0, input.lifetimeT));
  // sprayFade: for liquid, fade isolated droplets; for other phases, always 1.0
  let sprayFade = select(1.0, smoothstep(0.2, 0.5, input.particleDensity), isLiquid && input.particleDensity < 1.0);
  let lifetimeFade = sizeFactor * sprayFade;
  var finalAlpha = result.density * lifetimeFade;
  
  // Lifetime alpha curve from LUT
  finalAlpha *= alphaOverLife;
  
  // Phase-specific alpha handling:
  if (isLiquid) {
    // Liquid: moderate alpha for additive composite — each particle adds a blue tint.
    // With blue-dominant lighting, overlapping particles build visible blue water.
    let specPunch = max(lit.r, max(lit.g, lit.b));
    let specBoost = smoothstep(0.5, 1.0, specPunch) * 0.08;
    finalAlpha = min(result.density * lifetimeFade * alphaOverLife * 0.18 + specBoost, 0.25);
  } else if (isSolid) {
    // Solid: fully opaque particles
    finalAlpha = min(finalAlpha * 2.5, 0.98);
  } else if (isPlasma) {
    // Plasma: bright emissive, moderate alpha for glow bleed
    finalAlpha = min(finalAlpha * 1.5, 0.85);
  } else {
    // Gas: split fire vs smoke alpha handling
    if (thermalGlow > 0.0) {
      // Fire: very low alpha — composite is fully additive (one+one), so each particle's
      // contribution is ADDED to the scene. Low alpha prevents the half-res texture from
      // saturating into an opaque red wall. Bright emission compensates for low alpha.
      finalAlpha = min(result.density * lifetimeFade * alphaOverLife * 0.12, 0.06);
    } else {
      // Smoke: normal alpha for visible volumetric coverage
      finalAlpha = min(result.density * lifetimeFade * alphaOverLife, 0.7);
    }
  }
  
  // Soft particles: depth-fade at geometry intersections
  let depthDims = textureDimensions(uSceneDepth);
  let screenUV = vec2<u32>(input.position.xy * input.depthScale);
  if (screenUV.x < depthDims.x && screenUV.y < depthDims.y) {
    let sceneDepth = textureLoad(uSceneDepth, vec2<i32>(screenUV), 0);
    let particleDepth = input.position.z;
    let depthDiff = sceneDepth - particleDepth;
    let softFade = clamp(depthDiff * 500.0, 0.0, 1.0);
    finalAlpha *= softFade;
  }
  
  // Distance fog — subtle atmospheric perspective at far range
  let fogFactor = exp(-input.cameraDist * 0.0015);
  let fogColor = uFrame.ambientColor * uFrame.ambientIntensity * 0.5;
  lit = mix(fogColor, lit, fogFactor);
  finalAlpha *= mix(0.7, 1.0, fogFactor); // gentle transparency at extreme distance
  
  return vec4<f32>(lit, finalAlpha);
}
`;

export const particlesSdfBillboardShader = ShaderComposer.compose({
  libs: ['sdf/shapes', 'noise/noise3d', 'particles/phase_vfx'],
  vertex: vertexWGSL,
  fragment: fragmentWGSL
});
