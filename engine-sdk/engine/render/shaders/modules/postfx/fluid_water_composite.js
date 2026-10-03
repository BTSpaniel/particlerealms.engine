// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

//

// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha



// =============================================================================

// FLUID WATER COMPOSITE - Final water/metaball surface rendering

// =============================================================================

// This is Pass 3 of the screen-space water rendering pipeline.

//

// Reconstructs surface normals from the blurred depth texture, then:

// - For water: applies Fresnel reflection + refraction + Beer's law absorption

// - For metaball orbs: applies emissive shading with rim glow

//

// The result is composited over the scene color using proper depth testing.

import {
  FLUID_WATER_PCG_HASH_WGSL,
  LEGACY_PCG32_WGSL,
} from '../../../../core/math/MathBits.js';


export const fluidWaterCompositeWGSL = /* wgsl */`

// =============================================================================

// WATER/METABALL COMPOSITE

// =============================================================================



struct FrameData {

  invProj     : mat4x4<f32>,

  invView     : mat4x4<f32>,

  cameraPos   : vec3<f32>,

  time        : f32,

  screenSize  : vec2<f32>,

  waterColor  : vec2<f32>,  // Packed RGB as two floats (will decode)

  // Water properties

  refractionStrength : f32,

  fresnelPower       : f32,

  absorptionCoeff    : f32,

  specularPower      : f32,

  // Light

  lightDir    : vec3<f32>,

  renderMode  : f32,        // 0 = water, 1 = plasma/fire, 2 = magic

  lightColor  : vec3<f32>,

  emissiveIntensity : f32,  // For plasma/magic orbs

  ambientColor : vec3<f32>,

  _pad3       : f32,

  waterColorRGB : vec3<f32>,  // Actual water/orb color

  thickness   : f32,          // Fake thickness for Beer's law

};



@group(0) @binding(0) var<uniform> frame : FrameData;

@group(0) @binding(1) var fluidDepth : texture_2d<f32>;

@group(0) @binding(2) var sceneColor : texture_2d<f32>;

@group(0) @binding(3) var sceneDepth : texture_depth_2d;

// Note: Sampler removed - we use textureLoad instead of textureSample

@group(0) @binding(5) var thicknessTex : texture_2d<f32>;



struct VSOut {

  @builtin(position) position : vec4<f32>,

  @location(0) uv : vec2<f32>,

};



// Fullscreen triangle

@vertex

fn vs_main(@builtin(vertex_index) vertexIndex : u32) -> VSOut {

  var out : VSOut;



  var positions = array<vec2<f32>, 3>(

    vec2<f32>(-1.0, -1.0),

    vec2<f32>( 3.0, -1.0),

    vec2<f32>(-1.0,  3.0)

  );



  let pos = positions[vertexIndex];

  out.position = vec4<f32>(pos, 0.0, 1.0);

  out.uv = pos * 0.5 + 0.5;

  out.uv.y = 1.0 - out.uv.y;



  return out;

}



// Reconstruct view-space position from depth

fn viewPosFromDepth(uv : vec2<f32>, depth : f32) -> vec3<f32> {

  let ndc = vec4<f32>(uv * 2.0 - 1.0, depth, 1.0);

  let viewPos = frame.invProj * ndc;

  return viewPos.xyz / viewPos.w;

}



// Compute normal from depth using central differences

// Uses textureLoad to avoid non-uniform control flow issues

fn computeNormalLoad(pixelCoord : vec2<i32>, depth : f32) -> vec3<f32> {

  let texelSize = 1.0 / frame.screenSize;

  let uv = vec2<f32>(pixelCoord) / frame.screenSize;



  // Sample neighboring depths using textureLoad

  let depthL = textureLoad(fluidDepth, pixelCoord - vec2<i32>(1, 0), 0).r;

  let depthR = textureLoad(fluidDepth, pixelCoord + vec2<i32>(1, 0), 0).r;

  let depthU = textureLoad(fluidDepth, pixelCoord - vec2<i32>(0, 1), 0).r;

  let depthD = textureLoad(fluidDepth, pixelCoord + vec2<i32>(0, 1), 0).r;



  // Reconstruct positions

  let posC = viewPosFromDepth(uv, depth);

  let posL = viewPosFromDepth(uv - vec2<f32>(texelSize.x, 0.0), depthL);

  let posR = viewPosFromDepth(uv + vec2<f32>(texelSize.x, 0.0), depthR);

  let posU = viewPosFromDepth(uv - vec2<f32>(0.0, texelSize.y), depthU);

  let posD = viewPosFromDepth(uv + vec2<f32>(0.0, texelSize.y), depthD);



  // Compute tangent vectors (use smallest difference to handle edges)

  let useLeft = abs(depthL - depth) < abs(depthR - depth);

  let ddx = select(posR - posC, posC - posL, useLeft);



  let useUp = abs(depthU - depth) < abs(depthD - depth);

  let ddy = select(posD - posC, posC - posU, useUp);



  // Normal from cross product

  let normal = normalize(cross(ddy, ddx));

  return normal;

}



// Fresnel approximation (Schlick)

fn fresnel(cosTheta : f32, f0 : f32) -> f32 {

  return f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);

}



// Beer's law absorption

fn absorption(distance : f32, color : vec3<f32>) -> vec3<f32> {

  let absorb = exp(-frame.absorptionCoeff * distance * (vec3<f32>(1.0) - color));

  return absorb;

}



// ============================================================================

// CAUSTICS - Animated underwater light patterns

// ============================================================================



// PCG hash - deterministic across all GPUs
${LEGACY_PCG32_WGSL}
${FLUID_WATER_PCG_HASH_WGSL}


// Deterministic 2D hash for caustic noise

fn hashCaustic(p : vec2<f32>) -> f32 {

  let seed = pcg_water(bitcast<u32>(p.x) + pcg_water(bitcast<u32>(p.y)));

  return f32(seed) / 4294967295.0;

}



// 2D value noise for caustics

fn noiseCaustic(p : vec2<f32>) -> f32 {

  let i = floor(p);

  let f = fract(p);

  let u = f * f * (3.0 - 2.0 * f);



  let a = hashCaustic(i + vec2<f32>(0.0, 0.0));

  let b = hashCaustic(i + vec2<f32>(1.0, 0.0));

  let c = hashCaustic(i + vec2<f32>(0.0, 1.0));

  let d = hashCaustic(i + vec2<f32>(1.0, 1.0));



  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);

}



// Multi-octave caustic pattern

fn causticPattern(worldPos : vec3<f32>, time : f32) -> f32 {

  // Project onto XZ plane with animation

  var p = worldPos.xz * 2.0;



  // Two layers moving in different directions

  let t1 = time * 0.3;

  let t2 = time * 0.2;



  var caustic = 0.0;



  // Layer 1: primary caustic cells

  let p1 = p + vec2<f32>(t1, t1 * 0.7);

  let n1 = noiseCaustic(p1 * 3.0);

  let n2 = noiseCaustic(p1 * 6.0 + 100.0);

  caustic += abs(n1 - 0.5) * 2.0;

  caustic += abs(n2 - 0.5) * 1.0;



  // Layer 2: secondary interference

  let p2 = p * 1.3 - vec2<f32>(t2 * 1.2, t2);

  let n3 = noiseCaustic(p2 * 4.0 + 50.0);

  caustic += abs(n3 - 0.5) * 0.8;



  // Normalize and sharpen

  caustic = caustic / 3.8;

  caustic = pow(caustic, 0.7);  // Boost contrast



  return caustic;

}



// DEBUG: Set to true to visualize liquid/plasma detection (bright cyan where detected)

const DEBUG_WATER_DETECTION: bool = false;



@fragment

fn fs_main(input : VSOut) -> @location(0) vec4<f32> {

  // Use textureLoad to ensure uniform control flow

  let pixelCoord = vec2<i32>(input.uv * frame.screenSize);

  let fluidDepthVal = textureLoad(fluidDepth, pixelCoord, 0).r;

  let sceneDepthVal = textureLoad(sceneDepth, pixelCoord, 0);

  let sceneColorVal = textureLoad(sceneColor, pixelCoord, 0).rgb;



  // Check if we should skip this pixel (no fluid or fluid behind scene)

  let noFluid = fluidDepthVal <= 0.0 || fluidDepthVal >= 1.0;

  let fluidBehind = fluidDepthVal > sceneDepthVal;

  let skipFluid = noFluid || fluidBehind;



  // DEBUG: Show bright cyan where water depth is detected

  if (DEBUG_WATER_DETECTION && !noFluid) {

    return vec4<f32>(0.0, 1.0, 1.0, 1.0);  // Bright cyan

  }



  // Reconstruct surface normal (always compute to maintain uniform flow)

  let viewNormal = computeNormalLoad(pixelCoord, fluidDepthVal);

  let worldNormal = (frame.invView * vec4<f32>(viewNormal, 0.0)).xyz;



  // View direction

  let viewPos = viewPosFromDepth(input.uv, fluidDepthVal);

  let worldPos = (frame.invView * vec4<f32>(viewPos, 1.0)).xyz;

  let viewDir = normalize(frame.cameraPos - worldPos);



  // Fresnel

  let NdotV = max(dot(worldNormal, viewDir), 0.0);

  let fresnelVal = fresnel(NdotV, 0.02);  // Water F0 ≈ 0.02



  // =========================================================================

  // RENDER MODE BRANCHING (using select to maintain uniform control flow)

  // =========================================================================

  // 0 = water (refraction + Fresnel + Beer's law)

  // 1 = plasma/fire (emissive core + hot rim)

  // 2 = magic (emissive + pulsing + mystical rim)



  let renderMode = i32(frame.renderMode);



  // Compute all possible final colors to avoid non-uniform textureSample



  // --- PLASMA/FIRE ORB ---

  // Enhanced fire using turbulence accumulation pattern

  // Core concept: layer multiple frequency waves for organic motion



  // Base fire position (animated upward flow)

  var firePos = worldPos;

  firePos.y = firePos.y - frame.time * 0.8;  // Fire rises



  // =========================================================================

  // TURBULENCE: Accumulate distortion at increasing frequencies

  // Each octave adds finer detail with decreasing amplitude

  // =========================================================================

  var turbulence = vec3<f32>(0.0);

  var freq = 2.0;

  for (var oct = 0; oct < 4; oct = oct + 1) {

    // Offset each axis differently for organic motion

    let phase = vec3<f32>(

      frame.time * 0.3,

      frame.time * 0.5 + f32(oct) * 0.7,

      f32(oct) * 1.3

    );

    // Add wave distortion at this frequency

    turbulence = turbulence + cos((firePos.yzx + phase) * freq) / freq;

    freq = freq * 1.7;  // Increase frequency each octave

  }



  // Apply turbulence to position

  let distortedPos = firePos + turbulence * 0.4;



  // =========================================================================

  // TWIST: Rotate XZ based on height (fire spirals as it rises)

  // =========================================================================

  let twistAngle = distortedPos.y * 0.5;

  let cosT = cos(twistAngle);

  let sinT = sin(twistAngle);

  let twistedX = distortedPos.x * cosT - distortedPos.z * sinT;

  let twistedZ = distortedPos.x * sinT + distortedPos.z * cosT;



  // =========================================================================

  // EXPANSION: Fire spreads wider as it rises

  // =========================================================================

  let expansion = max(distortedPos.y * 0.15 + 1.0, 0.2);

  let expandedX = twistedX / expansion;

  let expandedZ = twistedZ / expansion;



  // =========================================================================

  // FIRE SHAPE: Hollow cone / flame silhouette

  // =========================================================================

  let coneRadius = length(vec2<f32>(expandedX, expandedZ));

  let flameShape = coneRadius + distortedPos.y * 0.25 - 0.4;

  let flameMask = 1.0 - smoothstep(-0.2, 0.3, flameShape);



  // =========================================================================

  // FIRE COLOR: Hot core → orange → red tips

  // Based on turbulence intensity and position

  // =========================================================================

  let turbulenceIntensity = length(turbulence);

  let heatGradient = clamp(1.0 - distortedPos.y * 0.3, 0.0, 1.0);



  // Hot white/yellow core

  let coreHeat = pow(NdotV, 2.0) * frame.emissiveIntensity;

  let coreColor = vec3<f32>(1.0, 0.95, 0.7) * coreHeat;



  // Orange mid-flames

  let midFlame = flameMask * (0.5 + turbulenceIntensity * 0.5);

  let midColor = frame.waterColorRGB * midFlame * frame.emissiveIntensity;



  // Red/dark rim and tips

  let rimIntensity = pow(1.0 - NdotV, 2.5) * frame.emissiveIntensity;

  let rimColor = vec3<f32>(0.9, 0.2, 0.05) * rimIntensity * heatGradient;



  // Flicker animation

  let flicker = 0.85 + 0.15 * sin(frame.time * 12.0 + worldPos.x * 5.0 + turbulenceIntensity * 8.0);



  // Combine fire layers

  let plasmaColor = (coreColor + midColor + rimColor) * flicker * flameMask;

  let fireAlpha = coreHeat * 0.5 + flameMask * 0.3;

  let finalPlasma = plasmaColor + sceneColorVal * (1.0 - fireAlpha);



  // --- MAGIC ORB ---

  // Enhanced with energy swirls and arcane patterns



  // =========================================================================

  // ENERGY SWIRL: Rotating patterns around the orb

  // =========================================================================

  let magicPos = worldPos;



  // Polar coordinates for swirl

  let polarAngle = atan2(magicPos.z, magicPos.x);

  let polarRadius = length(magicPos.xz);



  // Swirl pattern - rotates based on time and height

  let swirlSpeed = frame.time * 2.0;

  let swirlAngle = polarAngle + swirlSpeed + magicPos.y * 1.5;

  let swirlPattern = sin(swirlAngle * 4.0) * 0.5 + 0.5;



  // Energy bands - concentric rings

  let ringPattern = sin(polarRadius * 8.0 - frame.time * 3.0) * 0.5 + 0.5;



  // =========================================================================

  // ARCANE RUNES: Geometric patterns on surface

  // =========================================================================

  // Six-fold symmetry for mystical look

  let runeAngle = polarAngle * 3.0 + frame.time;

  let runePattern = pow(abs(sin(runeAngle)), 8.0);



  // Vertical bands

  let verticalRune = pow(abs(sin(magicPos.y * 6.0 + frame.time * 0.5)), 4.0);



  // Combine rune patterns

  let runeIntensity = max(runePattern, verticalRune) * (1.0 - abs(NdotV));



  // =========================================================================

  // CORE PULSE: Breathing energy center

  // =========================================================================

  let pulsePhase = frame.time * 3.0 + magicPos.y * 2.0;

  let pulse = 0.6 + 0.4 * sin(pulsePhase);

  let secondaryPulse = 0.8 + 0.2 * sin(pulsePhase * 1.7 + 1.0);



  // Core intensity based on view angle

  let magicCoreIntensity = pow(NdotV, 1.5) * frame.emissiveIntensity * pulse;



  // Rim glow (mystical aura)

  let rimFresnel = pow(1.0 - NdotV, 3.0);

  let magicRimIntensity = rimFresnel * frame.emissiveIntensity * 2.0 * secondaryPulse;



  // =========================================================================

  // SPARKLE FIELD: Random glints of energy

  // =========================================================================

  // Multiple sparkle layers at different scales

  let st = bitcast<u32>(frame.time);

  let sparkle1 = f32(pcg_water(bitcast<u32>(magicPos.x) + pcg_water(bitcast<u32>(magicPos.z) + st * 5u))) / 4294967295.0;

  let sparkle2 = f32(pcg_water(bitcast<u32>(magicPos.y) + pcg_water(bitcast<u32>(magicPos.z) + st * 7u + 111u))) / 4294967295.0;

  let sparkle3 = f32(pcg_water(bitcast<u32>(magicPos.x) + pcg_water(bitcast<u32>(magicPos.y) + st * 3u + 222u))) / 4294967295.0;



  // Only show sparkles above threshold (sparse glints)

  let sparkleThreshold = 0.92;

  let sparkleIntensity = max(

    step(sparkleThreshold, sparkle1),

    max(step(sparkleThreshold, sparkle2), step(sparkleThreshold, sparkle3))

  ) * magicRimIntensity;



  // =========================================================================

  // COLOR COMPOSITION

  // =========================================================================

  // White/bright core

  let magicCoreColor = vec3<f32>(1.0, 1.0, 1.0) * magicCoreIntensity * 0.6;



  // Main orb color with swirl modulation

  let swirlModulation = 0.7 + swirlPattern * 0.3;

  let mainColor = frame.waterColorRGB * (magicCoreIntensity + magicRimIntensity * 0.5) * swirlModulation;



  // Rim glow (slightly shifted hue for mystical effect)

  let rimHueShift = vec3<f32>(0.8, 1.0, 1.2);  // Shift toward cooler tones

  let magicRimColor = frame.waterColorRGB * rimHueShift * magicRimIntensity;



  // Rune glow (brighter version of base color)

  let runeColor = (frame.waterColorRGB + vec3<f32>(0.3)) * runeIntensity * frame.emissiveIntensity * 0.8;



  // Ring pattern (subtle)

  let ringColor = frame.waterColorRGB * ringPattern * rimFresnel * 0.3;



  // Sparkle (pure white/color bursts)

  let sparkleColor = (frame.waterColorRGB + vec3<f32>(0.5)) * sparkleIntensity;



  // Final magic composition

  let magicEmission = magicCoreColor + mainColor + magicRimColor + runeColor + ringColor + sparkleColor;

  let magicAlpha = magicCoreIntensity * 0.4 + magicRimIntensity * 0.2;

  let finalMagic = magicEmission + sceneColorVal * (1.0 - magicAlpha);



  // --- WATER (default) ---

  // Use scene color directly (no offset refraction to avoid textureSample in non-uniform flow)

  let sampledThickness = textureLoad(thicknessTex, pixelCoord, 0).r;

  let waterThickness = max(sampledThickness, frame.thickness);

  let absorbedColor = sceneColorVal * absorption(waterThickness, frame.waterColorRGB);

  let waterTint = mix(absorbedColor, frame.waterColorRGB * 0.3, 0.2);



  // =========================================================================

  // CAUSTICS: Animated light patterns on water surface

  // =========================================================================

  let caustic = causticPattern(worldPos, frame.time);

  let causticIntensity = 0.3 * (1.0 - waterThickness * 0.5);  // Fade with depth

  let causticColor = frame.lightColor * caustic * causticIntensity;



  let lightReflect = reflect(-frame.lightDir, worldNormal);

  let specular = pow(max(dot(viewDir, lightReflect), 0.0), frame.specularPower);

  let specularColor = frame.lightColor * specular * fresnelVal;

  let reflectionColor = frame.ambientColor * 0.5 + specularColor + causticColor;

  let waterBlend = mix(waterTint, reflectionColor, fresnelVal * 0.5);

  let finalWater = waterBlend + specularColor * 0.5 + causticColor * 0.3;

  let waterRimStrength = pow(1.0 - NdotV, 3.0) * 0.3;

  let waterRimColor = frame.waterColorRGB * waterRimStrength;

  let waterResult = finalWater + waterRimColor;



  // Select final color based on render mode

  var fluidColor = waterResult;

  if (renderMode == 1) {

    fluidColor = finalPlasma;

  } else if (renderMode == 2) {

    fluidColor = finalMagic;

  }



  // Return scene color if no fluid, otherwise blend

  return vec4<f32>(select(fluidColor, sceneColorVal, skipFluid), 1.0);

}

`;



export default fluidWaterCompositeWGSL;
