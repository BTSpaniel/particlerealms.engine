// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Hash Functions for Pseudo-Random Noise Generation
 * 
 * Provides various hash functions for generating pseudo-random values
 * from coordinate inputs. Used as basis for procedural noise.
 */

export const hashWGSL = /* wgsl */`
// ============================================================================
// HASH FUNCTIONS - Deterministic pseudo-random number generation
// All functions use PCG (Permuted Congruential Generator) integer arithmetic.
// Identical results on AMD, NVIDIA, Apple Silicon, Intel — no sin() dependency.
// ============================================================================

// PCG hash core - from GPURandom.js (engine standard)
fn pcg_hash_lib(v: u32) -> u32 {
    var state = v * 747796405u + 2891336453u;
    state = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (state >> 22u) ^ state;
}

// 2D hash - deterministic scalar from 2D position
fn hash2d(p: vec2<f32>) -> f32 {
  let seed = pcg_hash_lib(bitcast<u32>(p.x) + pcg_hash_lib(bitcast<u32>(p.y)));
  return f32(seed) / 4294967295.0;
}

// 3D hash - deterministic scalar from 3D position
fn hash3d(p: vec3<f32>) -> f32 {
  let seed = pcg_hash_lib(bitcast<u32>(p.x) + pcg_hash_lib(bitcast<u32>(p.y) + pcg_hash_lib(bitcast<u32>(p.z))));
  return f32(seed) / 4294967295.0;
}

// 2D hash returning vec2 - for curl noise and flow maps
fn hash2dVec2(p: vec2<f32>) -> vec2<f32> {
  let seed = pcg_hash_lib(bitcast<u32>(p.x) + pcg_hash_lib(bitcast<u32>(p.y)));
  return vec2<f32>(
    f32(pcg_hash_lib(seed      )) / 4294967295.0,
    f32(pcg_hash_lib(seed + 1u )) / 4294967295.0,
  );
}

// 3D hash returning vec3 - for 3D gradient noise
fn hash3dVec3(p: vec3<f32>) -> vec3<f32> {
  let seed = pcg_hash_lib(bitcast<u32>(p.x) + pcg_hash_lib(bitcast<u32>(p.y) + pcg_hash_lib(bitcast<u32>(p.z))));
  return vec3<f32>(
    f32(pcg_hash_lib(seed      )) / 4294967295.0,
    f32(pcg_hash_lib(seed + 1u )) / 4294967295.0,
    f32(pcg_hash_lib(seed + 2u )) / 4294967295.0,
  );
}

// Integer hash - perfect for grid-based lookups
fn hashInt(n: u32) -> u32 {
  return pcg_hash_lib(n);
}
`;
