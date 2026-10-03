// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { noise3dWGSL } from "../chunks/noise3d.js";
import { mathCommonWGSL } from "../chunks/math_common.js";
import { fullscreenQuadVertexWGSL } from "../chunks/fullscreen_quad.js";

// Volumetric smoke shader - composes from shared chunks
// Physically-based volume rendering with raymarching

const structsAndBindings = /* wgsl */`
// Vertex output for fullscreen quad
struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0)       uv       : vec2<f32>,
};

// Volume-specific structs (not shared - unique to this shader)
struct FrameData {
  viewProj    : mat4x4<f32>,
  invViewProj : mat4x4<f32>,
  cameraPos   : vec3<f32>,
  time        : f32,
  volumeMin   : vec3<f32>,
  densityScale : f32,
  volumeMax   : vec3<f32>,
  extinction  : f32,
  cameraFwd   : vec3<f32>,
  tanFovY     : f32,
  cameraRight : vec3<f32>,
  aspect      : f32,
  cameraUp    : vec3<f32>,
  _pad0       : f32,
};

struct GridData {
  resolution : vec3<f32>,
  _pad0      : f32,
};

@group(0) @binding(0) var<uniform> frame : FrameData;
@group(1) @binding(0) var<storage, read> densityField : array<f32>;
@group(1) @binding(1) var<storage, read> colorField : array<vec4<f32>>;
@group(1) @binding(2) var<uniform> grid : GridData;
@group(2) @binding(0) var sceneDepth : texture_depth_2d;

const MAX_STEPS : u32 = 128u;
const SHADOW_STEPS : u32 = 6u;
`;

const vertexShader = /* wgsl */`
@vertex
fn vs_main(@builtin(vertex_index) vertexIndex : u32) -> VSOut {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  var out : VSOut;
  out.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  out.uv = pos[vertexIndex] * 0.5 + 0.5;
  return out;
}
`;

const volumeFunctions = /* wgsl */`
// Ray-box intersection
// ----------------------------------------------------------------------------

fn intersectBox(ro : vec3<f32>, rd : vec3<f32>, boxMin : vec3<f32>, boxMax : vec3<f32>) -> vec2<f32> {
  // Robust ray-box intersection handling near-zero directions
  let eps = 0.0001;
  let invRd = vec3<f32>(
    select(1.0 / rd.x, 1e10 * sign(rd.x + eps), abs(rd.x) < eps),
    select(1.0 / rd.y, 1e10 * sign(rd.y + eps), abs(rd.y) < eps),
    select(1.0 / rd.z, 1e10 * sign(rd.z + eps), abs(rd.z) < eps)
  );
  
  let t0 = (boxMin - ro) * invRd;
  let t1 = (boxMax - ro) * invRd;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  let tNear = max(max(tmin.x, tmin.y), tmin.z);
  let tFar = min(min(tmax.x, tmax.y), tmax.z);
  return vec2<f32>(max(tNear, 0.0), tFar);
}

// ----------------------------------------------------------------------------
// DENSITY SAMPLING WITH TRILINEAR INTERPOLATION
// ----------------------------------------------------------------------------

fn sampleDensityRaw(cellCoord : vec3<i32>) -> f32 {
  let res = vec3<i32>(grid.resolution);
  let c = clamp(cellCoord, vec3<i32>(0), res - 1);
  let idx = c.z * res.x * res.y + c.y * res.x + c.x;
  
  if (u32(idx) >= arrayLength(&densityField)) {
    return 0.0;
  }
  return densityField[idx];
}

fn sampleDensity(worldPos : vec3<f32>) -> f32 {
  let volumeSize = frame.volumeMax - frame.volumeMin;
  let normalized = (worldPos - frame.volumeMin) / volumeSize;
  
  // Out of bounds check
  if (any(normalized < vec3<f32>(0.0)) || any(normalized > vec3<f32>(1.0))) {
    return 0.0;
  }
  
  let gridPos = normalized * grid.resolution - 0.5;
  let cellMin = vec3<i32>(floor(gridPos));
  let f = fract(gridPos);
  
  // Trilinear interpolation
  let d000 = sampleDensityRaw(cellMin + vec3<i32>(0, 0, 0));
  let d100 = sampleDensityRaw(cellMin + vec3<i32>(1, 0, 0));
  let d010 = sampleDensityRaw(cellMin + vec3<i32>(0, 1, 0));
  let d110 = sampleDensityRaw(cellMin + vec3<i32>(1, 1, 0));
  let d001 = sampleDensityRaw(cellMin + vec3<i32>(0, 0, 1));
  let d101 = sampleDensityRaw(cellMin + vec3<i32>(1, 0, 1));
  let d011 = sampleDensityRaw(cellMin + vec3<i32>(0, 1, 1));
  let d111 = sampleDensityRaw(cellMin + vec3<i32>(1, 1, 1));
  
  let d00 = mix(d000, d100, f.x);
  let d10 = mix(d010, d110, f.x);
  let d01 = mix(d001, d101, f.x);
  let d11 = mix(d011, d111, f.x);
  
  let d0 = mix(d00, d10, f.y);
  let d1 = mix(d01, d11, f.y);
  
  return mix(d0, d1, f.z);
}

// Sample with detail noise for realism
fn sampleDensityDetailed(worldPos : vec3<f32>) -> f32 {
  let baseDensity = sampleDensity(worldPos);
  if (baseDensity <= 0.0) {
    return 0.0;
  }
  
  // Domain warp the sample position for organic turbulence
  // This creates swirling, flowing patterns instead of static noise
  let animOffset = vec3<f32>(frame.time * 0.08, frame.time * 0.03, frame.time * 0.05);
  let warpedPos = domainWarp(worldPos * 0.4 + animOffset, 0.8, 0.3);
  
  // Use rotated FBM for better quality (no axis-aligned banding)
  let detail = fbm3dRotated(warpedPos, 4);
  
  // Modulate density with noise (erode edges, add wisps)
  // The 0.4 + detail*0.8 keeps it in a nice range
  let modulated = baseDensity * (0.4 + detail * 0.8);
  return max(modulated, 0.0);
}

// Sample color from color grid (splatted from particles)
fn sampleColor(worldPos : vec3<f32>) -> vec3<f32> {
  let volumeSize = frame.volumeMax - frame.volumeMin;
  let normalized = (worldPos - frame.volumeMin) / volumeSize;
  
  // Out of bounds - return white (default)
  if (any(normalized < vec3<f32>(0.0)) || any(normalized > vec3<f32>(1.0))) {
    return vec3<f32>(1.0);
  }
  
  let gx = i32(grid.resolution.x);
  let gy = i32(grid.resolution.y);
  let gz = i32(grid.resolution.z);
  
  let ix = i32(normalized.x * f32(gx));
  let iy = i32(normalized.y * f32(gy));
  let iz = i32(normalized.z * f32(gz));
  
  let clampedX = clamp(ix, 0, gx - 1);
  let clampedY = clamp(iy, 0, gy - 1);
  let clampedZ = clamp(iz, 0, gz - 1);
  
  let idx = clampedX + clampedY * gx + clampedZ * gx * gy;
  
  if (u32(idx) >= arrayLength(&colorField)) {
    return vec3<f32>(1.0);
  }
  
  let colorData = colorField[idx];
  let weight = colorData.a;
  
  // If no particles contributed, return white
  if (weight < 0.001) {
    return vec3<f32>(1.0);
  }
  
  // Normalize by weight to get average color
  return colorData.rgb / weight;
}

// ----------------------------------------------------------------------------
// PHASE FUNCTIONS
// ----------------------------------------------------------------------------

// Henyey-Greenstein phase function - anisotropic scattering
// g > 0: forward scattering, g < 0: back scattering, g = 0: isotropic
fn phaseHG(cosTheta : f32, g : f32) -> f32 {
  let g2 = g * g;
  let denom = 1.0 + g2 - 2.0 * g * cosTheta;
  return (1.0 - g2) / (4.0 * PI * pow(max(denom, 0.0001), 1.5));
}

// Rayleigh scattering phase function - for small particles (smoke, dust, atmosphere)
// Symmetric forward/backward peaks, minimum at 90 degrees
fn phaseRayleigh(cosTheta : f32) -> f32 {
  return (3.0 / (16.0 * PI)) * (1.0 + cosTheta * cosTheta);
}

// Dual-lobe phase (mix forward and back scatter) - for larger particles
fn phaseDualLobe(cosTheta : f32) -> f32 {
  let forward = phaseHG(cosTheta, 0.6);   // Strong forward scatter (sun glow)
  let back = phaseHG(cosTheta, -0.3);     // Weak back scatter (rim lighting)
  return mix(back, forward, 0.7);
}

// Combined phase function - blends HG with Rayleigh for realistic smoke
// Smoke has both large particles (HG) and fine particles (Rayleigh)
fn phaseSmoke(cosTheta : f32) -> f32 {
  let hg = phaseDualLobe(cosTheta);
  let rayleigh = phaseRayleigh(cosTheta);
  // Blend: mostly HG but add some Rayleigh for atmospheric feel
  return mix(hg, rayleigh, 0.2);
}

// ----------------------------------------------------------------------------
// LIGHTING
// ----------------------------------------------------------------------------

fn lightMarch(pos : vec3<f32>, lightDir : vec3<f32>) -> f32 {
  // March toward light to compute shadow/transmission
  let stepSize = length(frame.volumeMax - frame.volumeMin) / f32(SHADOW_STEPS) * 0.5;
  var shadowDensity = 0.0;
  var p = pos;
  
  for (var i = 0u; i < SHADOW_STEPS; i = i + 1u) {
    p = p + lightDir * stepSize;
    shadowDensity = shadowDensity + sampleDensity(p) * stepSize;
  }
  
  // Beer-Lambert
  return exp(-shadowDensity * 2.0);
}
`;

const fragmentShader = /* wgsl */`
// DEBUG: Set to true to visualize volume bounds instead of smoke
// Toggle these to diagnose where the volume is actually being rendered
const DEBUG_SHOW_VOLUME_BOUNDS: bool = false;
const DEBUG_SHOW_RAY_HIT: bool = false;  // Disabled - set true to show red where rays hit volume

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  // ============================================================================
  // SCREEN-TO-WORLD RAY CALCULATION (WORKING - DO NOT MODIFY WITHOUT TESTING)
  // ============================================================================
  // 
  // This section converts screen pixel coordinates to world-space rays for
  // volumetric raymarching. The key insight is using UV coordinates from the
  // vertex shader, which are derived from clip space positions.
  //
  // Coordinate System Chain:
  //   Vertex Shader: pos[i] in clip space → UV = pos * 0.5 + 0.5
  //   Fragment Shader: UV → NDC → Clip → World (via invViewProj)
  //
  // Why UV works (and input.position doesn't):
  //   - UV is derived from clip space: UV (0,0) = clip (-1,-1), UV (1,1) = clip (1,1)
  //   - input.position is in framebuffer coords where Y=0 is TOP (flipped)
  //   - Using UV avoids the Y-flip confusion entirely
  //
  // ============================================================================
  
  // Convert UV to NDC - NO Y FLIP needed because UV comes from clip space
  let ndcX = input.uv.x * 2.0 - 1.0;
  let ndcY = input.uv.y * 2.0 - 1.0;
  
  // Unproject screen point to world space using inverse view-projection matrix
  // WebGPU clip space Z: 0 = near plane, 1 = far plane
  // We unproject a point on the far plane to get a world-space target for ray direction
  let clipFar = vec4<f32>(ndcX, ndcY, 1.0, 1.0);
  var worldFar = frame.invViewProj * clipFar;
  worldFar = worldFar / worldFar.w;  // Perspective divide to get actual world position
  
  // Ray originates from camera position, points toward unprojected world point
  // This gives us a world-space ray that correctly tracks with camera movement
  // while keeping the smoke volume fixed in world space (at emitter positions)
  let rayOrigin = frame.cameraPos;
  let rayDir = normalize(worldFar.xyz - rayOrigin);
  
  // Intersect volume bounds
  let hit = intersectBox(rayOrigin, rayDir, frame.volumeMin, frame.volumeMax);
  var tMin = hit.x;
  var tMax = hit.y;
  
  // DEBUG: Visualize where volume bounds are being rendered
  if (DEBUG_SHOW_RAY_HIT && tMax > tMin) {
    // Show red tint where rays hit the volume - this shows the ACTUAL rendered location
    return vec4<f32>(1.0, 0.0, 0.0, 0.3);
  }
  
  // DEBUG: Show volume bounds outline
  if (DEBUG_SHOW_VOLUME_BOUNDS && tMax > tMin) {
    let entryPoint = rayOrigin + rayDir * tMin;
    // Normalize entry point to [0,1] within volume
    let volSize = frame.volumeMax - frame.volumeMin;
    let normEntry = (entryPoint - frame.volumeMin) / volSize;
    // Show edges of volume as colored outline
    let edgeThreshold = 0.02;
    let nearEdgeX = normEntry.x < edgeThreshold || normEntry.x > (1.0 - edgeThreshold);
    let nearEdgeY = normEntry.y < edgeThreshold || normEntry.y > (1.0 - edgeThreshold);
    let nearEdgeZ = normEntry.z < edgeThreshold || normEntry.z > (1.0 - edgeThreshold);
    if (nearEdgeX || nearEdgeY || nearEdgeZ) {
      return vec4<f32>(0.0, 1.0, 0.0, 0.8);  // Green outline
    }
  }
  
  // No intersection - fully transparent
  if (tMax <= tMin) {
    return vec4<f32>(0.0);
  }
  
  // Use scene depth to clamp the ray so smoke does not render behind opaque geometry
  let pixelCoord = vec2<i32>(i32(input.position.x), i32(input.position.y));
  let depth = textureLoad(sceneDepth, pixelCoord, 0);

  if (depth > 0.0 && depth < 1.0) {
    // Reconstruct world-space position at the depth buffer sample
    // WebGPU uses [0,1] clip space Z, but our projection matrix outputs OpenGL-style [-1,1]
    // The depth buffer stores values after the GPU maps from [-1,1] to [0,1]
    // So we need to convert back: clipZ = depth * 2.0 - 1.0
    // However, if projection already outputs [0,1], use depth directly
    // Testing both approaches - using [0,1] directly for WebGPU native
    let clipZ = depth;  // WebGPU native [0,1] depth
    let clipDepth = vec4<f32>(ndcX, ndcY, clipZ, 1.0);
    var worldDepth = frame.invViewProj * clipDepth;
    worldDepth = worldDepth / worldDepth.w;

    // Distance along the ray to the first surface
    let tDepth = dot(worldDepth.xyz - rayOrigin, rayDir);
    tMax = min(tMax, tDepth);
  }

  // If depth clamping removed all valid range, nothing to render
  if (tMax <= tMin) {
    return vec4<f32>(0.0);
  }
  
  // Raymarching parameters
  let rayLength = tMax - tMin;
  let stepSize = rayLength / f32(MAX_STEPS);
  
  // Blue noise jitter to reduce banding
  let jitter = hash3d(vec3<f32>(input.position.xy, frame.time)) * stepSize;
  
  // Light setup - physically inspired colors
  let sunDir = normalize(vec3<f32>(0.3, 1.0, 0.2));
  let sunColor = vec3<f32>(1.0, 0.95, 0.85) * 3.0;     // Warm sun
  let skyColor = vec3<f32>(0.5, 0.6, 0.8);              // Cool sky (zenith)
  let groundColor = vec3<f32>(0.3, 0.25, 0.2) * 0.3;    // Warm ground bounce
  let ambientColor = vec3<f32>(0.4, 0.5, 0.6) * 0.5;
  
  // Integration variables
  var transmittance = 1.0;
  var scatteredLight = vec3<f32>(0.0);
  var t = tMin + jitter;
  
  // Volume rendering parameters - use from frame uniform if available
  let densityScale = select(0.5, frame.densityScale, frame.densityScale > 0.0);
  let extinction = select(2.0, frame.extinction, frame.extinction > 0.0);
  
  // Main raymarch loop - volumetric rendering with grid-based color
  for (var i = 0u; i < MAX_STEPS; i = i + 1u) {
    if (t >= tMax || transmittance < 0.01) {
      break;
    }
    
    let pos = rayOrigin + rayDir * t;
    let density = sampleDensityDetailed(pos) * densityScale;
    
    if (density > 0.001) {
      // Get color from splatted color grid (no runtime particle sampling!)
      let smokeColor = sampleColor(pos);
      
      // Extinction - reduce for bright colors (white smoke = less absorption)
      let colorBrightness = dot(smokeColor, vec3<f32>(0.299, 0.587, 0.114));
      let adjustedExtinction = extinction * mix(1.0, 0.3, colorBrightness);
      let sampleExtinction = density * adjustedExtinction * stepSize;
      let sampleTransmittance = exp(-sampleExtinction);
      
      // Lighting with improved scattering
      let lightTransmit = lightMarch(pos, sunDir);
      let cosTheta = dot(rayDir, sunDir);
      
      // Use combined smoke phase function (HG + Rayleigh blend)
      let phase = phaseSmoke(cosTheta);
      
      // Boost brightness for light-colored particles (snow, fog, etc.)
      let brightnessBoost = 1.0 + colorBrightness * 2.0;
      let directLight = sunColor * lightTransmit * phase * brightnessBoost;
      
      // Improved ambient: blend sky (from above) and ground (from below)
      // based on surface normal approximation from density gradient
      let normalY = clamp(rayDir.y, -1.0, 1.0);
      let skyWeight = normalY * 0.5 + 0.5;  // 1 when looking up, 0 when looking down
      let ambientBlend = mix(groundColor, skyColor, skyWeight);
      
      // Multi-scattering approximation: add some scattered light back
      // This simulates light bouncing multiple times through the volume
      let multiScatter = 0.15 * (1.0 - lightTransmit) * sunColor * phaseRayleigh(0.0);
      
      let ambient = (ambientBlend + ambientColor + multiScatter) * brightnessBoost;
      let luminance = (directLight + ambient) * density * smokeColor;
      
      // Integrate (front-to-back compositing)
      let integScatter = luminance * (1.0 - sampleTransmittance) / max(sampleExtinction, 0.0001);
      scatteredLight = scatteredLight + transmittance * integScatter * stepSize;
      transmittance = transmittance * sampleTransmittance;
    }
    
    t = t + stepSize;
  }
  
  let alpha = 1.0 - transmittance;
  
  // Tone mapping
  let finalColor = scatteredLight / (scatteredLight + 1.0);
  
  return vec4<f32>(finalColor, alpha);
}
`;

// Compose final shader from chunks
// Order: math utilities → structs → noise → vertex → volume functions → fragment
export const volumeSmokeWGSL = mathCommonWGSL + structsAndBindings + noise3dWGSL + vertexShader + volumeFunctions + fragmentShader;
