// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Volumetric Clouds & Fog Rendering
 * 
 * Advanced volumetric rendering with dynamic step size and fog integration.
 * 
 * Key Concepts:
 *   1. Deformed periodic grid noise - Cheap volume noise
 *   2. Dynamic step size - Adaptive raymarch based on density
 *   3. Fog integral difference - Proper fog accumulation
 *   4. Multi-octave displacement - FBM-like volume noise
 *   5. Saturation-preserving interpolation - Better color blending
 */

export const volumetricCloudsWGSL = /* wgsl */`
// ============================================================================
// VOLUMETRIC CONSTANTS
// ============================================================================

const VOL_PI : f32 = 3.14159265359;

// Rotation matrix for noise (nimitz style)
const NOISE_ROT_MAT : mat3x3<f32> = mat3x3<f32>(
  vec3<f32>(0.33338, 0.56034, -0.71817),
  vec3<f32>(-0.87887, 0.32651, -0.15323),
  vec3<f32>(0.15162, 0.69596, 0.61339)
) * 1.93;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// 2D rotation matrix
fn rot2d(a : f32) -> mat2x2<f32> {
  let c = cos(a);
  let s = sin(a);
  return mat2x2<f32>(c, s, -s, c);
}

// Squared magnitude (cheaper than length)
fn mag2(p : vec2<f32>) -> f32 {
  return dot(p, p);
}

// Linear step (like smoothstep but linear)
fn linstep(mn : f32, mx : f32, x : f32) -> f32 {
  return clamp((x - mn) / (mx - mn), 0.0, 1.0);
}

// Henyey-Greenstein phase function for anisotropic scattering
// g: anisotropy (-1 = back scatter, 0 = isotropic, 1 = forward scatter)
// Typical cloud values: 0.3 to 0.8 (forward scattering due to water droplets)
fn henyeyGreensteinVol(cosTheta : f32, g : f32) -> f32 {
  let g2 = g * g;
  let denom = 1.0 + g2 - 2.0 * g * cosTheta;
  return (1.0 / (4.0 * VOL_PI)) * ((1.0 - g2) / pow(denom, 1.5));
}

// Two-lobe HG for more realistic cloud scattering
// Combines forward and back scattering
fn henyeyGreensteinTwoLobe(cosTheta : f32, g1 : f32, g2 : f32, blend : f32) -> f32 {
  let hg1 = henyeyGreensteinVol(cosTheta, g1);
  let hg2 = henyeyGreensteinVol(cosTheta, g2);
  return mix(hg1, hg2, blend);
}

// ============================================================================
// VOLUMETRIC NOISE
// ============================================================================

// Displacement function for camera/volume path
fn volumeDisplacement(t : f32) -> vec2<f32> {
  return vec2<f32>(sin(t * 0.22), cos(t * 0.175)) * 2.0;
}

// Main volume density function
// Returns vec2(density, radial distance for coloring)
fn volumeDensity(
  pos : vec3<f32>,
  time : f32,
  param : f32,  // Animation parameter
  displacementAmp : f32
) -> vec2<f32> {
  var p = pos;
  var p2 = pos;
  
  // Apply path displacement
  let disp = volumeDisplacement(p.z);
  p2.x = p2.x - disp.x;
  p2.y = p2.y - disp.y;
  
  // Rotate based on Z and time
  let rotAngle = sin(p.z + time) * (0.1 + param * 0.05) + time * 0.09;
  let rotMat = rot2d(rotAngle);
  p.x = rotMat[0][0] * p.x + rotMat[0][1] * p.y;
  p.y = rotMat[1][0] * p.x + rotMat[1][1] * p.y;
  
  // Radial distance from center
  let cl = mag2(p2.xy);
  
  // Multi-octave volume noise
  var d = 0.0;
  p = p * 0.61;
  var z = 1.0;
  var trk = 1.0;
  let dspAmp = 0.1 + param * 0.2;
  
  for (var i = 0; i < 5; i = i + 1) {
    // Displace position with sine waves
    p = p + sin(p.zxy * 0.75 * trk + time * trk * 0.8) * dspAmp;
    // Accumulate noise using dot(cos, sin) pattern
    d = d - abs(dot(cos(p), sin(p.yzx)) * z);
    z = z * 0.57;
    trk = trk * 1.4;
    // Rotate for next octave
    p = NOISE_ROT_MAT * p;
  }
  
  // Final density
  d = abs(d + param * 3.0) + param * 0.3 - 2.5;
  
  return vec2<f32>(d + cl * 0.2 + 0.25, cl);
}

// ============================================================================
// VOLUMETRIC RENDERING
// ============================================================================

struct VolumeRenderParams {
  maxSteps : i32,
  maxDist : f32,
  densityThreshold : f32,
  densityMultiplier : f32,
  lightDist : f32,
  fogDensity : f32,
}

fn defaultVolumeParams() -> VolumeRenderParams {
  return VolumeRenderParams(
    130,    // maxSteps
    100.0,  // maxDist
    0.3,    // densityThreshold
    1.12,   // densityMultiplier
    8.0,    // lightDist
    0.2     // fogDensity
  );
}

// Main volume rendering function
fn renderVolume(
  ro : vec3<f32>,
  rd : vec3<f32>,
  time : f32,
  param : f32,
  params : VolumeRenderParams
) -> vec4<f32> {
  var result = vec4<f32>(0.0);
  
  // Light position (moves with camera)
  let lpos = vec3<f32>(
    volumeDisplacement(time + params.lightDist) * 0.5,
    time + params.lightDist
  );
  
  var t = 1.5;
  var fogT = 0.0;
  
  for (var i = 0; i < params.maxSteps; i = i + 1) {
    if (result.a > 0.99) { break; }
    
    let pos = ro + t * rd;
    let mpv = volumeDensity(pos, time, param, 0.85);
    let den = clamp(mpv.x - params.densityThreshold, 0.0, 1.0) * params.densityMultiplier;
    let dn = clamp(mpv.x + 2.0, 0.0, 3.0);
    
    var col = vec4<f32>(0.0);
    
    if (mpv.x > 0.6) {
      // Cloud color based on position
      let cloudColor = sin(vec3<f32>(5.0, 0.4, 0.2) + mpv.y * 0.1 + sin(pos.z * 0.4) * 0.5 + 1.8) * 0.5 + 0.5;
      col = vec4<f32>(cloudColor, 0.08);
      col = col * den * den * den;
      col = vec4<f32>(col.rgb * linstep(4.0, -2.5, mpv.x) * 2.3, col.a);
      
      // Simple diffuse lighting via density gradient
      let dif = clamp((den - volumeDensity(pos + vec3<f32>(0.8, 0.0, 0.0), time, param, 0.85).x) / 9.0, 0.001, 1.0);
      let dif2 = clamp((den - volumeDensity(pos + vec3<f32>(0.35, 0.0, 0.0), time, param, 0.85).x) / 2.5, 0.001, 1.0);
      col = vec4<f32>(col.xyz * den * (vec3<f32>(0.005, 0.045, 0.075) + 1.5 * vec3<f32>(0.033, 0.07, 0.03) * (dif + dif2)), col.a);
    }
    
    // Fog accumulation using integral difference
    let fogC = exp(t * params.fogDensity - 2.2);
    col = col + vec4<f32>(0.06, 0.11, 0.11, 0.1) * clamp(fogC - fogT, 0.0, 1.0);
    fogT = fogC;
    
    // Front-to-back compositing
    result = result + col * (1.0 - result.a);
    
    // Dynamic step size based on density (key optimization!)
    t = t + clamp(0.5 - dn * dn * 0.05, 0.09, 0.3);
  }
  
  return clamp(result, vec4<f32>(0.0), vec4<f32>(1.0));
}

// ============================================================================
// SATURATION-PRESERVING INTERPOLATION
// ============================================================================

// Get saturation of color
fn getSaturation(c : vec3<f32>) -> f32 {
  let mi = min(min(c.x, c.y), c.z);
  let ma = max(max(c.x, c.y), c.z);
  return (ma - mi) / (ma + 1e-7);
}

// Interpolate colors while preserving saturation (by nimitz)
fn iLerp(a : vec3<f32>, b : vec3<f32>, x : f32) -> vec3<f32> {
  var ic = mix(a, b, x) + vec3<f32>(1e-6, 0.0, 0.0);
  let sd = abs(getSaturation(ic) - mix(getSaturation(a), getSaturation(b), x));
  let dir = normalize(vec3<f32>(
    2.0 * ic.x - ic.y - ic.z,
    2.0 * ic.y - ic.x - ic.z,
    2.0 * ic.z - ic.y - ic.x
  ));
  let lgt = dot(vec3<f32>(1.0), ic);
  let ff = dot(dir, normalize(ic));
  ic = ic + 1.5 * dir * sd * ff * lgt;
  return clamp(ic, vec3<f32>(0.0), vec3<f32>(1.0));
}

// ============================================================================
// POST-PROCESSING
// ============================================================================

// Vignette effect
fn vignetteQuad(uv : vec2<f32>, strength : f32, offset : f32) -> f32 {
  return pow(16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y), strength) * (1.0 - offset) + offset;
}

// Color grading for volumetrics
fn volumetricColorGrade(col : vec3<f32>, gamma : vec3<f32>, tint : vec3<f32>) -> vec3<f32> {
  return pow(col, gamma) * tint;
}

// ============================================================================
// CAMERA PATH
// ============================================================================

// Smooth camera path following displacement
fn cameraPath(time : f32, amplitude : f32) -> vec3<f32> {
  return vec3<f32>(volumeDisplacement(time) * amplitude, time);
}

// Build camera matrix for volume rendering
fn volumeCameraMatrix(
  ro : vec3<f32>,
  cameraTarget : vec3<f32>
) -> mat3x3<f32> {
  let forward = normalize(cameraTarget - ro);
  let right = normalize(cross(forward, vec3<f32>(0.0, 1.0, 0.0)));
  let up = normalize(cross(right, forward));
  return mat3x3<f32>(right, up, -forward);
}

// ============================================================================
// SIMPLIFIED CLOUD LAYER
// ============================================================================

// Simple 2D cloud for backgrounds
fn cloudLayer2D(uv : vec2<f32>, time : f32, scale : f32, speed : f32) -> f32 {
  var p = uv * scale;
  p.x = p.x + time * speed;
  
  var cloud = 0.0;
  var amp = 0.5;
  var freq = 1.0;
  
  for (var i = 0; i < 5; i = i + 1) {
    let n = sin(p.x * freq) * cos(p.y * freq * 0.7);
    cloud = cloud + n * amp;
    amp = amp * 0.5;
    freq = freq * 2.0;
    p = rot2d(0.5) * p;
  }
  
  return cloud * 0.5 + 0.5;
}

// ============================================================================
// BLUE NOISE DITHERING (Key Optimization!)
// ============================================================================

// Apply blue noise offset to raymarch start (reduces banding with fewer steps)
// blueNoise: sample from blue noise texture at gl_FragCoord.xy / 1024.0
// frame: current frame number for temporal variation
fn blueNoiseDitherOffset(blueNoise : f32, frame : u32) -> f32 {
  // Temporal blue noise - reduces visible dithering pattern
  return fract(blueNoise + f32(frame % 32u) / sqrt(0.5));
}

// Apply dithered offset to raymarch depth
fn applyDitherOffset(startDepth : f32, marchSize : f32, offset : f32) -> f32 {
  return startDepth + marchSize * offset;
}

// ============================================================================
// BEER'S LAW (Physically-Based Absorption)
// ============================================================================

// Beer-Lambert law for light absorption through medium
fn beersLaw(distance : f32, absorption : f32) -> f32 {
  return exp(-distance * absorption);
}

// Beer's powder approximation (Horizon Zero Dawn style)
// Creates denser-looking clouds with bright edges
fn beersPowder(distance : f32, absorption : f32) -> f32 {
  let beer = beersLaw(distance, absorption);
  let powder = 1.0 - exp(-distance * absorption * 2.0);
  return beer * powder * 2.0;
}

// ============================================================================
// PHYSICALLY-BASED CLOUD RENDERING
// ============================================================================

// Raymarch with Beer's law absorption
fn raymarchPhysical(
  ro : vec3<f32>,
  rd : vec3<f32>,
  sunDir : vec3<f32>,
  maxSteps : i32,
  marchSize : f32,
  absorptionCoeff : f32,
  scatteringAniso : f32,
  offset : f32  // Blue noise offset
) -> f32 {
  var depth = marchSize * offset;  // Dithered start
  var totalTransmittance = 1.0;
  var lightEnergy = 0.0;
  
  // Pre-compute phase function
  let phase = henyeyGreensteinVol(dot(rd, sunDir), scatteringAniso);
  
  for (var i = 0; i < maxSteps; i = i + 1) {
    let p = ro + depth * rd;
    let density = 1.0; // Replace with your density function
    
    if (density > 0.0) {
      let transmittance = beersLaw(density * marchSize, absorptionCoeff);
      let luminance = 0.025 + density * phase; // Small ambient + scattered
      
      totalTransmittance = totalTransmittance * transmittance;
      lightEnergy = lightEnergy + totalTransmittance * luminance;
    }
    
    depth = depth + marchSize;
  }
  
  return lightEnergy;
}

// ============================================================================
// QUICK NOISE FUNCTIONS
// ============================================================================

// Cheap 3D noise using sin/cos dot product
fn cheapNoise3D(p : vec3<f32>) -> f32 {
  return dot(cos(p), sin(p.yzx));
}

// Multi-octave cheap noise
fn cheapNoiseOctaves(p : vec3<f32>, octaves : i32, persistence : f32) -> f32 {
  var sum = 0.0;
  var amp = 1.0;
  var freq = 1.0;
  var pos = p;
  
  for (var i = 0; i < octaves; i = i + 1) {
    sum = sum + cheapNoise3D(pos * freq) * amp;
    amp = amp * persistence;
    freq = freq * 2.0;
    pos = NOISE_ROT_MAT * pos;
  }
  
  return sum;
}
`;

export default volumetricCloudsWGSL;
