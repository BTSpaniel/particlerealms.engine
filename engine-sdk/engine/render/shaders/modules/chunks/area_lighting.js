// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Area Lighting & Soft Shadows
 * 
 * Physically-based area light calculations for soft shadows and lighting.
 * Supports spherical lights and occluders.
 * 
 * Key Concepts:
 *   1. Sphere occlusion - AO contribution from nearby spheres
 *   2. Area shadows - Soft shadows from spherical lights/occluders
 *   3. Sphere area lights - Proper falloff for spherical emitters
 *   4. Floor occlusion - Ground plane ambient darkening
 * 
 * Functions:
 *   - sphOcclusion(pos, nor, sph) - AO from single sphere
 *   - sphAreaShadow(P, light, occluder) - Soft shadow
 *   - sphAreaLight(P, N, light) - Area light contribution
 *   - floorOcclusion(P, N, floorY) - Ground plane AO
 */

export const areaLightingWGSL = /* wgsl */`
// ============================================================================
// AREA LIGHTING CONSTANTS
// ============================================================================

const AREA_BIAS : f32 = 0.0001;
const PI_AREA : f32 = 3.1415927;

// ============================================================================
// SPHERE INTERSECTION (optimized for lighting)
// ============================================================================

// Fast sphere intersection for shadow/reflection rays
// sph.xyz = center, sph.w = radius
fn sphIntersectFast(ro : vec3<f32>, rd : vec3<f32>, sph : vec4<f32>) -> f32 {
  let oc = ro - sph.xyz;
  let b = dot(oc, rd);
  let c = dot(oc, oc) - sph.w * sph.w;
  let h = b * b - c;
  
  if (h < 0.0) {
    return -1.0;
  }
  
  return -b - sqrt(h);
}

// ============================================================================
// SPHERE OCCLUSION (Ambient Occlusion from spheres)
// ============================================================================

// Calculate AO contribution from a single sphere
// pos = surface position, nor = surface normal
// sph.xyz = sphere center, sph.w = sphere radius
fn sphOcclusion(pos : vec3<f32>, nor : vec3<f32>, sph : vec4<f32>) -> f32 {
  let r = sph.xyz - pos;
  let l = length(r);
  let d = dot(nor, r);
  
  var res = d;
  
  // Handle case where surface is inside sphere's influence
  if (d < sph.w) {
    res = pow(clamp((d + sph.w) / (2.0 * sph.w), 0.0, 1.0), 1.5) * sph.w;
  }
  
  // Falloff based on distance cubed
  return clamp(res * (sph.w * sph.w) / (l * l * l), 0.0, 1.0);
}

// Accumulate occlusion from multiple spheres
fn multiSphereOcclusion(pos : vec3<f32>, nor : vec3<f32>, spheres : array<vec4<f32>, 8>, count : i32) -> f32 {
  var occ = 1.0;
  
  for (var i = 0; i < count; i = i + 1) {
    occ = occ * (1.0 - sphOcclusion(pos, nor, spheres[i]));
  }
  
  return occ;
}

// ============================================================================
// AREA SHADOWS (Soft shadows from spherical occluders)
// ============================================================================

// Compute soft shadow from a spherical occluder blocking a spherical light
// P = surface point
// L = light sphere (xyz = center, w = radius)
// sph = occluder sphere (xyz = center, w = radius)
// Returns: 0.0 = full shadow, 1.0 = no shadow
fn sphAreaShadow(P : vec3<f32>, L : vec4<f32>, sph : vec4<f32>) -> f32 {
  let ld = L.xyz - P;      // Vector to light
  let oc = sph.xyz - P;    // Vector to occluder
  let r = sph.w - AREA_BIAS;
  
  let d1 = sqrt(dot(ld, ld));  // Distance to light
  let d2 = sqrt(dot(oc, oc));  // Distance to occluder
  
  // Quick reject: occluder behind light
  if (d1 - L.w * 0.5 < d2 - r) {
    return 1.0;
  }
  
  // Angular sizes
  let ls1 = L.w / d1;   // Light angular size
  let ls2 = r / d2;     // Occluder angular size
  
  let in1 = sqrt(1.0 - ls1 * ls1);
  let in2 = sqrt(1.0 - ls2 * ls2);
  
  // Occluder doesn't block light path
  if (in1 * d1 < in2 * d2) {
    return 1.0;
  }
  
  // Direction vectors
  let v1 = ld / d1;
  let v2 = oc / d2;
  let ilm = dot(v1, v2);
  
  // No overlap
  if (ilm < in1 * in2 - ls1 * ls2) {
    return 1.0;
  }
  
  // Calculate overlap area
  let g = length(cross(v1, v2));
  
  let th = clamp((in2 - in1 * ilm) * (d1 / L.w) / g, -1.0, 1.0);
  let ph = clamp((in1 - in2 * ilm) * (d2 / r) / g, -1.0, 1.0);
  
  let sh = acos(th) - th * sqrt(1.0 - th * th)
         + (acos(ph) - ph * sqrt(1.0 - ph * ph))
         * ilm * ls2 * ls2 / (ls1 * ls1);
  
  return 1.0 - sh / PI_AREA;
}

// Simplified soft shadow (faster, less accurate)
fn sphSoftShadowSimple(P : vec3<f32>, lightPos : vec3<f32>, lightRadius : f32, occCenter : vec3<f32>, occRadius : f32) -> f32 {
  let toLight = lightPos - P;
  let toOcc = occCenter - P;
  
  let distLight = length(toLight);
  let distOcc = length(toOcc);
  
  // Occluder behind surface or behind light
  if (distOcc > distLight || dot(toLight, toOcc) < 0.0) {
    return 1.0;
  }
  
  let dirLight = toLight / distLight;
  let dirOcc = toOcc / distOcc;
  
  // How much occluder blocks light direction
  let alignment = dot(dirLight, dirOcc);
  
  // Angular sizes
  let angularLight = lightRadius / distLight;
  let angularOcc = occRadius / distOcc;
  
  // Approximate penumbra
  let overlap = max(0.0, alignment - (1.0 - angularOcc));
  let coverage = overlap * angularOcc / max(angularLight, 0.001);
  
  return clamp(1.0 - coverage, 0.0, 1.0);
}

// ============================================================================
// SPHERE AREA LIGHTS
// ============================================================================

// Spherical area light contribution
// P = surface position, N = surface normal
// L.xyz = light center, L.w = light radius
fn sphAreaLight(P : vec3<f32>, N : vec3<f32>, L : vec4<f32>) -> f32 {
  let oc = L.xyz - P;
  let dst = sqrt(dot(oc, oc));
  let dir = oc / dst;
  
  // NdotL with solid angle correction
  let cosAngle = dot(N, dir);
  let solidAngle = L.w / dst;
  
  return max(0.0, cosAngle * solidAngle);
}

// Spherical area light with proper intensity falloff
fn sphAreaLightIntensity(P : vec3<f32>, N : vec3<f32>, L : vec4<f32>, intensity : f32) -> f32 {
  let oc = L.xyz - P;
  let distSq = dot(oc, oc);
  let dist = sqrt(distSq);
  let dir = oc / dist;
  
  let NdotL = max(dot(N, dir), 0.0);
  
  // Solid angle of sphere as seen from P
  let sinAlpha = min(L.w / dist, 1.0);
  let solidAngle = 2.0 * PI_AREA * (1.0 - sqrt(1.0 - sinAlpha * sinAlpha));
  
  return NdotL * solidAngle * intensity / (4.0 * PI_AREA);
}

// Disk area light (for rectangular lights approximation)
fn diskAreaLight(P : vec3<f32>, N : vec3<f32>, diskCenter : vec3<f32>, diskNormal : vec3<f32>, diskRadius : f32) -> f32 {
  let toLight = diskCenter - P;
  let dist = length(toLight);
  let dir = toLight / dist;
  
  // Surface facing light?
  let NdotL = max(dot(N, dir), 0.0);
  
  // Light facing surface?
  let LdotP = max(dot(-diskNormal, dir), 0.0);
  
  // Solid angle approximation
  let solidAngle = (diskRadius * diskRadius * PI_AREA) / (dist * dist);
  
  return NdotL * LdotP * solidAngle;
}

// ============================================================================
// FLOOR / GROUND OCCLUSION
// ============================================================================

// Occlusion from ground plane (objects cast AO onto floor)
fn floorOcclusion(P : vec3<f32>, N : vec3<f32>, floorY : f32) -> f32 {
  // How much the normal points down toward floor
  let downFacing = 0.5 + 0.5 * (-N.y);
  
  // Distance to floor affects occlusion
  let heightAboveFloor = P.y - floorY;
  let heightFactor = 1.0 / (heightAboveFloor + 1.0);
  
  return 1.0 - sqrt(downFacing * heightFactor) * 0.5;
}

// Contact shadow approximation (darken where objects meet floor)
fn contactShadow(P : vec3<f32>, floorY : f32, radius : f32) -> f32 {
  let height = P.y - floorY;
  
  if (height > radius) {
    return 1.0;
  }
  
  let t = height / radius;
  return sqrt(t);
}

// ============================================================================
// REFLECTION UTILITIES
// ============================================================================

// Trace reflection against sphere array
fn traceReflection(
  P : vec3<f32>, 
  R : vec3<f32>, 
  spheres : array<vec4<f32>, 8>, 
  count : i32,
  skipIndex : i32
) -> f32 {
  var minT = 1e20;
  var hitIndex = -1;
  
  for (var i = 0; i < count; i = i + 1) {
    if (i == skipIndex) {
      continue;
    }
    
    let t = sphIntersectFast(P, R, spheres[i]);
    if (t > 0.0 && t < minT) {
      minT = t;
      hitIndex = i;
    }
  }
  
  return select(-1.0, minT, hitIndex >= 0);
}

// Simple environment reflection fallback
fn envReflection(R : vec3<f32>, floorY : f32, P : vec3<f32>) -> f32 {
  // Fade based on ray hitting floor
  if (R.y < 0.0) {
    return 1.0 - sqrt(-R.y / (P.y - floorY + 1.0));
  }
  return 1.0;
}

// ============================================================================
// COMBINED SHADING
// ============================================================================

struct AreaLightResult {
  diffuse : f32,
  shadow : f32,
  ao : f32,
}

// Complete area light evaluation
fn evaluateAreaLight(
  P : vec3<f32>,
  N : vec3<f32>,
  light : vec4<f32>,
  occluders : array<vec4<f32>, 8>,
  occluderCount : i32
) -> AreaLightResult {
  var result : AreaLightResult;
  
  // Direct lighting
  result.diffuse = sphAreaLight(P, N, light);
  
  // Soft shadows from all occluders
  result.shadow = 1.0;
  for (var i = 0; i < occluderCount; i = i + 1) {
    result.shadow = min(result.shadow, sphAreaShadow(P, light, occluders[i]));
  }
  
  // Ambient occlusion
  result.ao = multiSphereOcclusion(P, N, occluders, occluderCount);
  
  return result;
}
`;

export default areaLightingWGSL;
