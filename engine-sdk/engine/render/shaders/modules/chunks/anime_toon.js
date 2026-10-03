// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Anime / Toon Shading
 * 
 * Stylized rendering techniques for anime/manga aesthetic.
 * 
 * Key Concepts:
 *   1. Multi-step shading - Discrete color bands
 *   2. Outline rendering - Edge detection
 *   3. Specular highlights - Sharp anime-style
 *   4. Rim lighting - Edge glow
 *   5. Hatching/cross-hatching - Manga shadows
 *   6. Subsurface scattering - Skin glow
 * 
 * Eye/Face Functions:
 *   - animeEye() - Full eye with iris, highlights
 *   - animeBrow() - Eyebrow curves
 *   - animeBlush() - Cheek flush marks
 *   - animeMouth() - Lip curves
 */

export const animeToonWGSL = /* wgsl */`
// ============================================================================
// ANIME SHADING CONSTANTS
// ============================================================================

const PI_TOON : f32 = 3.14159265;

// ============================================================================
// UTILITY - BEZIER CURVES (for facial features)
// ============================================================================

// 2D cross product
fn cro2d(a : vec2<f32>, b : vec2<f32>) -> f32 {
  return a.x * b.y - a.y * b.x;
}

// Quadratic Bezier curve point
fn bezierPoint(start : vec2<f32>, control : vec2<f32>, end : vec2<f32>, t : f32) -> vec2<f32> {
  let oneMinusT = 1.0 - t;
  return oneMinusT * oneMinusT * start + 2.0 * t * oneMinusT * control + t * t * end;
}

// Bezier tangent
fn bezierTangent(start : vec2<f32>, control : vec2<f32>, end : vec2<f32>, t : f32) -> vec2<f32> {
  let oneMinusT = 1.0 - t;
  return 2.0 * oneMinusT * (control - start) + 2.0 * t * (end - control);
}

// Distance to quadratic Bezier (returns signed distance and curve parameter)
fn sdBezierCurve(pos : vec2<f32>, a : vec2<f32>, c : vec2<f32>, b : vec2<f32>) -> vec2<f32> {
  let aVec = b - a;
  let bVec = a - 2.0 * b + c;
  let cVec = aVec * 2.0;
  let dVec = a - pos;
  
  let kk = 1.0 / dot(bVec, bVec);
  let kx = kk * dot(aVec, bVec);
  let ky = kk * (2.0 * dot(aVec, aVec) + dot(dVec, bVec)) / 3.0;
  let kz = kk * dot(dVec, aVec);
  
  let p = ky - kx * kx;
  let q = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  let p3 = p * p * p;
  let q2 = q * q;
  let h = q2 + 4.0 * p3;
  
  var res : f32;
  var curveT : f32;
  
  if (h >= 0.0) {
    let sqrtH = sqrt(h);
    let x = (vec2<f32>(sqrtH, -sqrtH) - q) / 2.0;
    let uv = sign(x) * pow(abs(x), vec2<f32>(1.0 / 3.0));
    curveT = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    let qVec = dVec + (cVec + bVec * curveT) * curveT;
    res = length(qVec);
    let sgn = cro2d(cVec + 2.0 * bVec * curveT, qVec);
    res = res * sign(sgn);
  } else {
    let z = sqrt(-p);
    let v = acos(-q / (p * z * 2.0)) / 3.0;
    let m = cos(v);
    let n = sin(v) * 1.732050808;
    let tVals = clamp(vec3<f32>(m + m, -n - m, n - m) * z - kx, vec3<f32>(0.0), vec3<f32>(1.0));
    
    let qx = dVec + (cVec + bVec * tVals.x) * tVals.x;
    let dx = dot(qx, qx);
    let sx = cro2d(cVec + 2.0 * bVec * tVals.x, qx);
    
    let qy = dVec + (cVec + bVec * tVals.y) * tVals.y;
    let dy = dot(qy, qy);
    let sy = cro2d(cVec + 2.0 * bVec * tVals.y, qy);
    
    if (dx < dy) {
      res = sqrt(dx) * sign(sx);
      curveT = tVals.x;
    } else {
      res = sqrt(dy) * sign(sy);
      curveT = tVals.y;
    }
  }
  
  return vec2<f32>(res, curveT);
}

// ============================================================================
// MULTI-STEP SHADING (Cel Shading)
// ============================================================================

// Quantize value to discrete steps (anime color banding)
fn multiStep(value : f32, levels : f32, minValue : f32, offset : f32) -> f32 {
  if (levels <= 1.0) {
    return 1.0;
  }
  
  let curLevel = value * levels;
  var curOffset = floor(curLevel) / (levels - 1.0);
  var level = floor(curLevel + mix(offset, 0.0, curOffset));
  
  curOffset = level / (levels - 1.0);
  level = level + mix(minValue, 1.0, curOffset);
  level = level / levels;
  
  return level;
}

// Simple 2-tone cel shading
fn celShade2(ndotl : f32, threshold : f32) -> f32 {
  return step(threshold, ndotl);
}

// 3-tone cel shading (shadow, mid, highlight)
fn celShade3(ndotl : f32, shadowThresh : f32, highlightThresh : f32) -> f32 {
  let shadow = step(shadowThresh, ndotl);
  let highlight = step(highlightThresh, ndotl);
  return shadow * 0.5 + highlight * 0.5;
}

// Smooth cel shading with configurable softness
fn celShadeSmooth(ndotl : f32, threshold : f32, softness : f32) -> f32 {
  return smoothstep(threshold - softness, threshold + softness, ndotl);
}

// Multi-band cel shading
fn celShadeBands(ndotl : f32, bands : i32) -> f32 {
  let stepped = floor(ndotl * f32(bands)) / f32(bands - 1);
  return clamp(stepped, 0.0, 1.0);
}

// ============================================================================
// ANIME SPECULAR HIGHLIGHTS
// ============================================================================

// Sharp anime specular (Blinn-Phong with step)
fn animeSpecular(halfVec : vec3<f32>, normal : vec3<f32>, threshold : f32) -> f32 {
  let ndoth = max(dot(normal, halfVec), 0.0);
  return step(threshold, ndoth);
}

// Soft anime specular
fn animeSpecularSoft(halfVec : vec3<f32>, normal : vec3<f32>, threshold : f32, softness : f32) -> f32 {
  let ndoth = max(dot(normal, halfVec), 0.0);
  return smoothstep(threshold - softness, threshold + softness, ndoth);
}

// Anisotropic hair specular (Kajiya-Kay style, stepped)
fn animeHairSpecular(tangent : vec3<f32>, halfVec : vec3<f32>, shift : f32, threshold : f32) -> f32 {
  let tdoth = dot(tangent, halfVec);
  let sinTH = sqrt(1.0 - tdoth * tdoth);
  let spec = pow(sinTH, 20.0 + shift * 100.0);
  return step(threshold, spec);
}

// ============================================================================
// RIM / FRESNEL LIGHTING
// ============================================================================

// Basic rim light
fn animeRim(normal : vec3<f32>, viewDir : vec3<f32>, power : f32, threshold : f32) -> f32 {
  let ndotv = max(dot(normal, viewDir), 0.0);
  let rim = pow(1.0 - ndotv, power);
  return step(threshold, rim);
}

// Soft rim light
fn animeRimSoft(normal : vec3<f32>, viewDir : vec3<f32>, power : f32, threshold : f32, softness : f32) -> f32 {
  let ndotv = max(dot(normal, viewDir), 0.0);
  let rim = pow(1.0 - ndotv, power);
  return smoothstep(threshold - softness, threshold + softness, rim);
}

// ============================================================================
// OUTLINE DETECTION
// ============================================================================

// Fresnel-based outline (view angle)
fn outlineFresnel(normal : vec3<f32>, viewDir : vec3<f32>, thickness : f32) -> f32 {
  let ndotv = abs(dot(normal, viewDir));
  return smoothstep(thickness, 0.0, ndotv);
}

// Depth-based outline factor
fn outlineDepth(centerDepth : f32, neighborDepth : f32, threshold : f32) -> f32 {
  let diff = abs(centerDepth - neighborDepth);
  return step(threshold, diff);
}

// Normal-based outline factor
fn outlineNormal(centerNormal : vec3<f32>, neighborNormal : vec3<f32>, threshold : f32) -> f32 {
  let diff = 1.0 - dot(centerNormal, neighborNormal);
  return step(threshold, diff);
}

// ============================================================================
// SUBSURFACE SCATTERING (Skin)
// ============================================================================

// Simple SSS approximation for anime skin
fn animeSSSSimple(ndotl : f32, sssStrength : f32) -> vec3<f32> {
  let pndl = clamp(ndotl, 0.0, 1.0);
  let nndl = clamp(-ndotl, 0.0, 1.0);
  
  let sss = vec3<f32>(1.0, 0.1, 0.0) * 0.25 * (1.0 - pndl) * (1.0 - pndl) * pow(1.0 - nndl, 3.0 / (sssStrength + 0.001));
  
  return vec3<f32>(pndl) + sss * clamp(sssStrength - 0.04, 0.0, 1.0);
}

// ============================================================================
// ANIME EYE RENDERING
// ============================================================================

struct AnimeEyeParams {
  pupilPos : vec2<f32>,      // Pupil offset from center
  pupilScale : f32,          // Pupil size
  irisSize : f32,            // Iris radius
  highlightPos : vec2<f32>,  // Main highlight position
  highlightSize : f32,       // Highlight radius
  lidOpenness : f32,         // 0 = closed, 1 = fully open
}

// Anime eye iris pattern
fn animeIris(uv : vec2<f32>, params : AnimeEyeParams, pixelSize : f32) -> vec4<f32> {
  var color = vec4<f32>(1.0, 1.0, 1.0, 0.0);
  
  // Iris circle
  let irisCenter = params.pupilPos * 0.3;
  let irisDist = length(uv - irisCenter) - params.irisSize * params.pupilScale;
  
  // Black outline
  color = mix(color, vec4<f32>(0.0, 0.0, 0.0, 1.0), smoothstep(pixelSize, 0.0, irisDist));
  
  // White inside outline
  color = mix(color, vec4<f32>(1.0, 1.0, 1.0, 1.0), smoothstep(-0.02 + pixelSize, -0.02, irisDist));
  
  // Pupil
  let pupilCenter = irisCenter + params.pupilPos * 0.1;
  let pupilSize = params.irisSize * 0.4 * params.pupilScale;
  let pupilDist = length(uv - pupilCenter) - pupilSize;
  color = mix(color, vec4<f32>(0.0, 0.0, 0.0, 1.0), smoothstep(pixelSize, 0.0, pupilDist));
  
  // Main highlight
  let highlightDist = length(uv - params.highlightPos) - params.highlightSize;
  color = mix(color, vec4<f32>(1.0, 1.0, 1.0, 1.0), smoothstep(pixelSize, 0.0, highlightDist));
  
  // Small secondary highlight
  let smallHighlightPos = -params.highlightPos * 0.5 + vec2<f32>(0.0, -0.1);
  let smallHighlightDist = length(uv - smallHighlightPos) - params.highlightSize * 0.4;
  color = mix(color, vec4<f32>(1.0, 1.0, 1.0, 1.0), smoothstep(pixelSize, 0.0, smallHighlightDist));
  
  return color;
}

// Eyelid mask
fn animeEyelid(uv : vec2<f32>, openness : f32, isUpper : bool) -> f32 {
  let lidY = select(-0.3, 0.3, isUpper);
  let closedY = 0.0;
  let currentY = mix(closedY, lidY, openness);
  
  if (isUpper) {
    return smoothstep(currentY - 0.05, currentY, uv.y);
  } else {
    return smoothstep(currentY + 0.05, currentY, uv.y);
  }
}

// ============================================================================
// ANIME BLUSH (Cheek flush)
// ============================================================================

fn animeBlush(uv : vec2<f32>, center : vec2<f32>, size : vec2<f32>, lineDir : vec2<f32>, lineSpacing : f32, pixelSize : f32) -> f32 {
  // Ellipse mask
  let ellipseDist = length((uv - center) / size);
  let mask = 1.0 - smoothstep(0.8, 1.0, ellipseDist);
  
  // Hatching lines
  let lineProj = dot(uv, normalize(lineDir));
  let lineDist = abs(fract(lineProj / lineSpacing) - 0.5) * lineSpacing;
  let lines = smoothstep(pixelSize, 0.0, lineDist - pixelSize * 0.5);
  
  return mask * lines;
}

// ============================================================================
// ANIME HAIR HIGHLIGHT
// ============================================================================

fn animeHairHighlight(uv : vec2<f32>, angle : f32, waveFreq : f32, waveAmp : f32, thickness : f32) -> f32 {
  // Wavy highlight band
  let wave = sin(uv.x * waveFreq + angle) * waveAmp;
  let highlightY = 0.8 + wave;
  let dist = abs(uv.y - highlightY);
  
  // Modulated thickness
  let thickMod = thickness * (0.5 + 0.5 * sin(uv.x * waveFreq * 0.3));
  
  return smoothstep(thickMod, 0.0, dist);
}

// ============================================================================
// HATCHING / CROSS-HATCHING (Manga style)
// ============================================================================

fn hatchingPattern(uv : vec2<f32>, angle : f32, spacing : f32, thickness : f32) -> f32 {
  let c = cos(angle);
  let s = sin(angle);
  let rotatedUV = vec2<f32>(uv.x * c - uv.y * s, uv.x * s + uv.y * c);
  let lineDist = abs(fract(rotatedUV.x / spacing) - 0.5) * spacing;
  return smoothstep(thickness, 0.0, lineDist);
}

fn crossHatchingPattern(uv : vec2<f32>, angle1 : f32, angle2 : f32, spacing : f32, thickness : f32, density : f32) -> f32 {
  let hatch1 = hatchingPattern(uv, angle1, spacing, thickness);
  let hatch2 = hatchingPattern(uv, angle2, spacing, thickness);
  return max(hatch1, hatch2) * density;
}

// Shadow with hatching
fn animeShadowHatched(ndotl : f32, uv : vec2<f32>, threshold : f32, hatchAngle : f32, hatchSpacing : f32) -> f32 {
  let inShadow = 1.0 - step(threshold, ndotl);
  let hatch = hatchingPattern(uv, hatchAngle, hatchSpacing, hatchSpacing * 0.3);
  return inShadow * hatch;
}

// ============================================================================
// COMPLETE ANIME SHADING
// ============================================================================

struct AnimeShadingResult {
  color : vec3<f32>,
  outline : f32,
}

fn animeShading(
  baseColor : vec3<f32>,
  shadowColor : vec3<f32>,
  normal : vec3<f32>,
  lightDir : vec3<f32>,
  viewDir : vec3<f32>,
  shadowThreshold : f32,
  specThreshold : f32,
  rimPower : f32,
  rimThreshold : f32
) -> AnimeShadingResult {
  var result : AnimeShadingResult;
  
  let ndotl = dot(normal, lightDir);
  let halfVec = normalize(lightDir + viewDir);
  
  // Cel shading
  let shadow = celShadeSmooth(ndotl, shadowThreshold, 0.02);
  
  // Specular
  let spec = animeSpecularSoft(halfVec, normal, specThreshold, 0.05);
  
  // Rim
  let rim = animeRimSoft(normal, viewDir, rimPower, rimThreshold, 0.1);
  
  // Combine
  result.color = mix(shadowColor, baseColor, shadow);
  result.color = result.color + vec3<f32>(1.0) * spec * 0.5;
  result.color = result.color + baseColor * rim * 0.3;
  
  // Outline
  result.outline = outlineFresnel(normal, viewDir, 0.3);
  
  return result;
}

// Full anime material
fn animeFullShading(
  baseColor : vec3<f32>,
  normal : vec3<f32>,
  lightDir : vec3<f32>,
  viewDir : vec3<f32>,
  lightColor : vec3<f32>,
  ambientColor : vec3<f32>,
  sssStrength : f32
) -> vec3<f32> {
  let ndotl = dot(normal, lightDir);
  
  // Multi-step diffuse
  let diffuse = multiStep(ndotl * 0.5 + 0.5, 3.0, 0.3, 0.0);
  
  // SSS for skin
  let sss = animeSSSSimple(ndotl, sssStrength);
  
  // Specular
  let halfVec = normalize(lightDir + viewDir);
  let spec = animeSpecular(halfVec, normal, 0.9);
  
  // Rim
  let rim = animeRim(normal, viewDir, 3.0, 0.7);
  
  // Combine
  var color = baseColor * (diffuse * lightColor + ambientColor);
  color = color * sss;
  color = color + lightColor * spec * 0.3;
  color = color + baseColor * rim * 0.2;
  
  return color;
}
`;

export default animeToonWGSL;
