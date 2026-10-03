// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * particles_orbital.js - Electron Cloud / Orbital Shader (GAP 40)
 * 
 * Raymarched spherical harmonics for visualizing electron probability clouds.
 * Renders hydrogen-like orbital shapes (1s, 2p, 3d, etc.) around atom-particles.
 * Color by element using CPK convention.
 * LOD: at distance → simple sphere; close → full orbital volume.
 */

export const orbitalWGSL = /* wgsl */`
// ============================================================================
// SPHERICAL HARMONIC ORBITAL DENSITY FUNCTIONS
// ============================================================================
// |ψ|² probability density for hydrogen-like orbitals (simplified)
// n=principal, l=angular, m=magnetic quantum numbers

const ORBITAL_1S: u32 = 0u;  // n=1, l=0
const ORBITAL_2S: u32 = 1u;  // n=2, l=0
const ORBITAL_2P: u32 = 2u;  // n=2, l=1 (px, py, pz lobes)
const ORBITAL_3S: u32 = 3u;  // n=3, l=0
const ORBITAL_3P: u32 = 4u;  // n=3, l=1
const ORBITAL_3D: u32 = 5u;  // n=3, l=2 (dxy, dyz, dxz, dz2, dx2-y2)
const ORBITAL_4S: u32 = 6u;  // n=4, l=0
const ORBITAL_SP3: u32 = 7u; // hybrid: tetrahedral (carbon)

// Evaluate orbital probability density at local position p (in Bohr radii)
fn orbitalDensity(p: vec3<f32>, orbitalType: u32, atomicRadius: f32) -> f32 {
  let r = length(p) / atomicRadius;
  if (r > 6.0) { return 0.0; } // cutoff

  switch (orbitalType) {
    // 1s: spherically symmetric, exponential decay
    case 0u: {
      return exp(-2.0 * r) * 0.318;
    }
    // 2s: spherical with one radial node
    case 1u: {
      let rn = r * 0.5;
      let radial = (2.0 - rn) * exp(-rn);
      return radial * radial * 0.032;
    }
    // 2p: dumbbell lobes along primary axis (z)
    case 2u: {
      let rn = r * 0.5;
      let cosTheta = p.y / max(length(p), 0.001);
      let radial = rn * exp(-rn);
      let angular = cosTheta;
      return radial * radial * angular * angular * 0.032;
    }
    // 3s: spherical with two radial nodes
    case 3u: {
      let rn = r * 0.333;
      let radial = (27.0 - 18.0 * rn + 2.0 * rn * rn) * exp(-rn);
      return radial * radial * 0.0005;
    }
    // 3p: larger dumbbell
    case 4u: {
      let rn = r * 0.333;
      let cosTheta = p.y / max(length(p), 0.001);
      let radial = (6.0 - rn) * rn * exp(-rn);
      let angular = cosTheta;
      return radial * radial * angular * angular * 0.0003;
    }
    // 3d: cloverleaf (dz²)
    case 5u: {
      let rn = r * 0.333;
      let cosTheta = p.y / max(length(p), 0.001);
      let radial = rn * rn * exp(-rn);
      let angular = 3.0 * cosTheta * cosTheta - 1.0;
      return radial * radial * angular * angular * 0.00001;
    }
    // 4s: spherical with three radial nodes
    case 6u: {
      let rn = r * 0.25;
      let radial = exp(-rn) * (1.0 - 0.75 * rn);
      return radial * radial * 0.01;
    }
    // sp3 hybrid: tetrahedral lobes (carbon bonding orbitals)
    case 7u: {
      let rn = r * 0.5;
      let radial = rn * exp(-rn);
      // Four tetrahedral directions
      let d1 = dot(normalize(p + vec3<f32>(0.001)), normalize(vec3<f32>( 1.0,  1.0,  1.0)));
      let d2 = dot(normalize(p + vec3<f32>(0.001)), normalize(vec3<f32>(-1.0, -1.0,  1.0)));
      let d3 = dot(normalize(p + vec3<f32>(0.001)), normalize(vec3<f32>(-1.0,  1.0, -1.0)));
      let d4 = dot(normalize(p + vec3<f32>(0.001)), normalize(vec3<f32>( 1.0, -1.0, -1.0)));
      let angular = max(max(d1, d2), max(d3, d4));
      let lobe = max(angular, 0.0);
      return radial * radial * lobe * lobe * lobe * lobe * 0.1;
    }
    default: {
      return exp(-2.0 * r) * 0.318; // fallback to 1s
    }
  }
}

// Raymarch through orbital volume centered at particleCenter
// Returns (density accumulation, depth of first hit)
fn raymarchOrbital(
  rayOrigin: vec3<f32>,
  rayDir: vec3<f32>,
  particleCenter: vec3<f32>,
  orbitalType: u32,
  atomicRadius: f32,
  maxSteps: u32,
) -> vec2<f32> {
  let maxDist = atomicRadius * 6.0;
  var totalDensity = 0.0;
  var firstHitDepth = -1.0;

  let stepSize = maxDist * 2.0 / f32(maxSteps);
  let startT = max(0.0, length(particleCenter - rayOrigin) - maxDist);

  for (var i = 0u; i < maxSteps; i++) {
    let t = startT + f32(i) * stepSize;
    let samplePos = rayOrigin + rayDir * t - particleCenter;

    let density = orbitalDensity(samplePos, orbitalType, atomicRadius);

    if (density > 0.001) {
      totalDensity += density * stepSize;
      if (firstHitDepth < 0.0) {
        firstHitDepth = t;
      }
    }
  }

  return vec2<f32>(totalDensity, firstHitDepth);
}

// Map element to orbital type (simplified)
fn elementToOrbital(atomicNumber: u32) -> u32 {
  if (atomicNumber <= 2u) { return ORBITAL_1S; }
  if (atomicNumber <= 4u) { return ORBITAL_2S; }
  if (atomicNumber <= 10u) { return ORBITAL_2P; }
  if (atomicNumber <= 12u) { return ORBITAL_3S; }
  if (atomicNumber <= 18u) { return ORBITAL_3P; }
  if (atomicNumber <= 20u) { return ORBITAL_4S; }
  if (atomicNumber <= 30u) { return ORBITAL_3D; }
  return ORBITAL_1S; // fallback
}
`;

export default orbitalWGSL;
