// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathBits.js - Bit manipulation, Morton codes, Hilbert curves, hash functions
// Critical for voxel systems, spatial indexing, and procedural generation

// ============================================================================
// POWER OF 2 UTILITIES
// ============================================================================

export const isPowerOf2 = (x) => (x & (x - 1)) === 0 && x > 0;

export function floorPowerOfTwo(x) {
  const value = Number(x);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const exponent = Math.floor(Math.log2(value));
  const candidate = 2 ** exponent;
  return !Number.isFinite(candidate) || candidate > value
    ? 2 ** (exponent - 1)
    : candidate;
}

export function nextPowerOf2(x) {
  x--;
  x |= x >> 1;
  x |= x >> 2;
  x |= x >> 4;
  x |= x >> 8;
  x |= x >> 16;
  return x + 1;
}

export function prevPowerOf2(x) {
  x |= x >> 1;
  x |= x >> 2;
  x |= x >> 4;
  x |= x >> 8;
  x |= x >> 16;
  return x - (x >> 1);
}

export const log2Int = (x) => 31 - Math.clz32(x);
export const ceilLog2 = (x) => x <= 1 ? 0 : 32 - Math.clz32(x - 1);

// ============================================================================
// BIT MANIPULATION
// ============================================================================

// Population count (count set bits)
export function popCount(x) {
  x = x - ((x >> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  x = (x + (x >> 4)) & 0x0f0f0f0f;
  return ((x * 0x01010101) >> 24) & 0x3f;
}

// Reverse bits in 32-bit integer
export function reverseBits(x) {
  x = ((x & 0x55555555) << 1) | ((x >> 1) & 0x55555555);
  x = ((x & 0x33333333) << 2) | ((x >> 2) & 0x33333333);
  x = ((x & 0x0f0f0f0f) << 4) | ((x >> 4) & 0x0f0f0f0f);
  x = ((x & 0x00ff00ff) << 8) | ((x >> 8) & 0x00ff00ff);
  return (x << 16) | (x >>> 16);
}

// Count leading zeros
export const clz = (x) => Math.clz32(x);

// Count trailing zeros
export function ctz(x) {
  if (x === 0) return 32;
  let n = 0;
  if ((x & 0x0000ffff) === 0) { n += 16; x >>= 16; }
  if ((x & 0x000000ff) === 0) { n += 8; x >>= 8; }
  if ((x & 0x0000000f) === 0) { n += 4; x >>= 4; }
  if ((x & 0x00000003) === 0) { n += 2; x >>= 2; }
  if ((x & 0x00000001) === 0) { n += 1; }
  return n;
}

// Find first set bit (1-indexed, 0 if none)
export const ffs = (x) => x === 0 ? 0 : ctz(x) + 1;

// Byte swap
export const byteSwap16 = (x) => ((x & 0xff) << 8) | ((x >> 8) & 0xff);
export const byteSwap32 = (x) => (
  ((x & 0xff) << 24) |
  ((x & 0xff00) << 8) |
  ((x >> 8) & 0xff00) |
  ((x >> 24) & 0xff)
);

// Rotate left/right
export const rotateLeft = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;
export const rotateRight = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;

// Interleave bits (for Morton codes)
function part1By1(x) {
  x &= 0x0000ffff;
  x = (x ^ (x << 8)) & 0x00ff00ff;
  x = (x ^ (x << 4)) & 0x0f0f0f0f;
  x = (x ^ (x << 2)) & 0x33333333;
  x = (x ^ (x << 1)) & 0x55555555;
  return x;
}

function part1By2(x) {
  x &= 0x000003ff;
  x = (x ^ (x << 16)) & 0x030000ff;
  x = (x ^ (x << 8)) & 0x0300f00f;
  x = (x ^ (x << 4)) & 0x030c30c3;
  x = (x ^ (x << 2)) & 0x09249249;
  return x;
}

function compact1By1(x) {
  x &= 0x55555555;
  x = (x ^ (x >> 1)) & 0x33333333;
  x = (x ^ (x >> 2)) & 0x0f0f0f0f;
  x = (x ^ (x >> 4)) & 0x00ff00ff;
  x = (x ^ (x >> 8)) & 0x0000ffff;
  return x;
}

function compact1By2(x) {
  x &= 0x09249249;
  x = (x ^ (x >> 2)) & 0x030c30c3;
  x = (x ^ (x >> 4)) & 0x0300f00f;
  x = (x ^ (x >> 8)) & 0x030000ff;
  x = (x ^ (x >> 16)) & 0x000003ff;
  return x;
}

// ============================================================================
// MORTON CODES (Z-ORDER CURVE)
// Critical for voxel spatial indexing
// ============================================================================

// 2D Morton encode/decode (16-bit per axis, 32-bit output)
export function morton2DEncode(x, y) {
  return part1By1(x) | (part1By1(y) << 1);
}

export function morton2DDecode(m) {
  return [compact1By1(m), compact1By1(m >> 1)];
}

// 3D Morton encode/decode (10-bit per axis, 30-bit output)
export function morton3DEncode(x, y, z) {
  return part1By2(x) | (part1By2(y) << 1) | (part1By2(z) << 2);
}

export function morton3DDecode(m) {
  return [compact1By2(m), compact1By2(m >> 1), compact1By2(m >> 2)];
}

// Morton code increment (next code in same level)
export function morton2DIncX(m) {
  const x = (m | 0xaaaaaaaa) + 1;
  return (x & 0x55555555) | (m & 0xaaaaaaaa);
}

export function morton2DIncY(m) {
  const y = (m | 0x55555555) + 2;
  return (m & 0x55555555) | (y & 0xaaaaaaaa);
}

export function morton3DIncX(m) {
  const sum = (m | 0xb6db6db6) + 1;
  return (sum & 0x49249249) | (m & 0xb6db6db6);
}

export function morton3DIncY(m) {
  const sum = (m | 0x6db6db6d) + 2;
  return (sum & 0x92492492) | (m & 0x6db6db6d);
}

export function morton3DIncZ(m) {
  const sum = (m | 0xdb6db6db) + 4;
  return (sum & 0x24924924) | (m & 0xdb6db6db);
}

// ============================================================================
// HILBERT CURVE
// Better cache coherence than Morton for some use cases
// ============================================================================

// 2D Hilbert curve coordinate to distance
export function hilbert2DEncode(n, x, y) {
  let d = 0;
  for (let s = n >> 1; s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    // Rotate
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      const t = x;
      x = y;
      y = t;
    }
  }
  return d;
}

// 2D Hilbert curve distance to coordinate
export function hilbert2DDecode(n, d) {
  let x = 0, y = 0;
  for (let s = 1; s < n; s *= 2) {
    const rx = 1 & (d >> 1);
    const ry = 1 & (d ^ rx);
    // Rotate
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      const t = x;
      x = y;
      y = t;
    }
    x += s * rx;
    y += s * ry;
    d >>= 2;
  }
  return [x, y];
}

// ============================================================================
// HASH FUNCTIONS
// For procedural generation and spatial hashing
// ============================================================================

// Integer hash (Wang hash)
export function hash1D(n) {
  n = (n ^ 61) ^ (n >>> 16);
  n = n + (n << 3);
  n = n ^ (n >>> 4);
  n = n * 0x27d4eb2d;
  n = n ^ (n >>> 15);
  return n >>> 0;
}

// 2D hash
export function hash2D(x, y) {
  let n = x * 374761393 + y * 668265263;
  n = (n ^ (n >> 13)) * 1274126177;
  return (n ^ (n >> 16)) >>> 0;
}

// 3D hash
export function hash3D(x, y, z) {
  let n = x * 374761393 + y * 668265263 + z * 1440670237;
  n = (n ^ (n >> 13)) * 1274126177;
  return (n ^ (n >> 16)) >>> 0;
}

// 4D hash
export function hash4D(x, y, z, w) {
  let n = x * 374761393 + y * 668265263 + z * 1440670237 + w * 1911520717;
  n = (n ^ (n >> 13)) * 1274126177;
  return (n ^ (n >> 16)) >>> 0;
}

// Float hash [0, 1)
export const hashFloat1D = (n) => (hash1D(n) & 0xffffff) / 0x1000000;
export const hashFloat2D = (x, y) => (hash2D(x, y) & 0xffffff) / 0x1000000;
export const hashFloat3D = (x, y, z) => (hash3D(x, y, z) & 0xffffff) / 0x1000000;

export function legacyStructureHash3D(x, y, z) {
  let h = x * 374761393 + y * 668265263 + z * 1274126177;
  h = ((h ^ (h >> 13)) * 1103515245) >>> 0;
  return (h ^ (h >> 16)) / 0xffffffff;
}

export function legacyWorldGeneratorHash3D(x, y, z) {
  let h = x * 374761393 + y * 668265263 + z * 1274126177;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) & 0xffffff) / 0x1000000;
}

export function legacyStructureSeededHash3D(x, y, z, seed) {
  return legacyStructureHash3D(x ^ seed, y ^ (seed >> 8), z ^ (seed >> 16));
}

export function legacyStructureChunkSeed3D(cx, cy, cz, seed = 0) {
  return (cx * 374761393 + cy * 668265263 + cz * 1274126177 + seed) >>> 0;
}

export function legacyStructurePositionSeed3D(x, y, z, seed = 0) {
  return (x * 73856093 + y * 19349663 + z * 83492791 + seed) >>> 0;
}

export function legacyPrimeCoordinateXorHash3D(x, y, z) {
  return ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0;
}

export function legacyPrimeCoordinateAbsXorBucket3D(x, y, z, tableSize) {
  return Math.abs((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) % tableSize;
}

export function legacyPrimeCoordinateU32XorBucket3D(x, y, z, tableSize) {
  const hash = (
    Math.imul(x >>> 0, 73856093) ^
    Math.imul(y >>> 0, 19349663) ^
    Math.imul(z >>> 0, 83492791)
  ) >>> 0;
  return hash % (tableSize >>> 0);
}

export const LEGACY_PRIME_COORDINATE_U32_XOR_BUCKET3D_WGSL = /* wgsl */ `
fn legacyPrimeCoordinateU32XorBucket3D(cx: i32, cy: i32, cz: i32, tableSize: u32) -> u32 {
  let h = (u32(cx) * 73856093u) ^ (u32(cy) * 19349663u) ^ (u32(cz) * 83492791u);
  return h % tableSize;
}
`;

export function legacyPrimeCoordinateSignedAddAbsBucket3D(x, y, z, tableSize) {
  const sum = (
    Math.imul(x | 0, 73856093) +
    Math.imul(y | 0, 19349663) +
    Math.imul(z | 0, 83492791)
  ) | 0;
  return (Math.abs(sum) >>> 0) % (tableSize >>> 0);
}

export const LEGACY_PRIME_COORDINATE_SIGNED_ADD_ABS_BUCKET3D_WGSL = /* wgsl */ `
fn legacyPrimeCoordinateSignedAddAbsBucket3D(cx: i32, cy: i32, cz: i32, tableSize: u32) -> u32 {
  let h = u32(abs(cx * 73856093 + cy * 19349663 + cz * 83492791));
  return h % tableSize;
}
`;

export function legacyPrimeAxisHash32(value, axis = 'x', modulo = 0) {
  let factor = 0;
  if (axis === 'x') {
    factor = 73856093;
  } else if (axis === 'y') {
    factor = 19349663;
  } else if (axis === 'z') {
    factor = 83492791;
  } else {
    return 0;
  }

  const hash = (value * factor) >>> 0;
  return modulo > 0 ? hash % modulo : hash;
}

export function legacyWindTurbulenceAxisHash32(timeHash, axis) {
  if (axis === 'z') {
    return legacyPrimeAxisHash32(timeHash, 'y', 1000);
  }

  return legacyPrimeAxisHash32(timeHash, axis, 1000);
}

export function legacyPrimeCoordinateXorSeed2D(x, z) {
  return (x * 73856093) ^ (z * 19349663);
}

export function legacyPrimeCoordinateAdditiveSeed3D(x, y, z) {
  return x * 73856093 + y * 19349663 + z * 83492791;
}

export function legacyDualRngPositionHash3D(x, y, z, seed = 0) {
  let hash = seed;
  hash ^= x * 73856093;
  hash ^= y * 19349663;
  hash ^= z * 83492791;
  hash = ((hash ^ (hash >>> 16)) * 0x85ebca6b) >>> 0;
  hash = ((hash ^ (hash >>> 13)) * 0xc2b2ae35) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return hash / 4294967296;
}

export function legacySeedCharWeightedXorHash32(seed, charCode, seedMultiplier, charMultiplier) {
  return ((seed * seedMultiplier) ^ (charCode * charMultiplier)) >>> 0;
}

export function legacySeedCharXorHash32(seed, charCode) {
  return legacySeedCharWeightedXorHash32(seed, charCode, 1597334677, 2654435761);
}

export function legacySeedCharEffectXorHash32(seed, charCode) {
  return legacySeedCharWeightedXorHash32(seed, charCode, 805459861, 1597334677);
}

export function legacyGoldenRatioMul32(value) {
  return Math.imul(value >>> 0, 2654435761) >>> 0;
}

export function legacyGoldenRatioChunkSeed32(seedBase, chunkIndex) {
  return ((seedBase >>> 0) ^ legacyGoldenRatioMul32((chunkIndex + 1) >>> 0)) >>> 0;
}

export function legacyMeshParticleSeed32(seedBase, triIndex, particleIndex) {
  return (
    (seedBase >>> 0) ^
    Math.imul(triIndex >>> 0, 1597334677) ^
    legacyGoldenRatioMul32(particleIndex >>> 0)
  ) >>> 0;
}

export const LEGACY_MESH_PARTICLE_SEED_WGSL = /* wgsl */ `
fn legacyMeshParticleSeed32(baseSeed: u32, triIndex: u32, particleIndex: u32) -> u32 {
  return baseSeed ^ (triIndex * 1597334677u) ^ (particleIndex * 2654435761u);
}
`;

export const LEGACY_PCG32_WGSL = /* wgsl */ `
fn legacyPcgAdvanceState32(state: u32) -> u32 {
  return state * 747796405u + 2891336453u;
}

fn legacyPcgOutput32(state: u32) -> u32 {
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn legacyPcgHash32(value: u32) -> u32 {
  return legacyPcgOutput32(legacyPcgAdvanceState32(value));
}

fn legacyPcgRandomFloat01(state: ptr<function, u32>) -> f32 {
  *state = legacyPcgAdvanceState32(*state);
  return f32(legacyPcgOutput32(*state)) / 4294967295.0;
}

fn legacyPcgHashStepRandomFloat01(state: ptr<function, u32>) -> f32 {
  *state = legacyPcgHash32(*state);
  return f32(*state) / 4294967295.0;
}

fn legacyPcgPixelFrameHash2D(p: vec2<u32>, frameIndex: u32, salt: u32) -> u32 {
  let state = p.x * 747796405u + p.y * 2891336453u + frameIndex * 277803737u + salt;
  return legacyPcgOutput32(state);
}

fn legacyPcgPixelFrameRandom24Float01(p: vec2<u32>, frameIndex: u32, salt: u32) -> f32 {
  return f32(legacyPcgPixelFrameHash2D(p, frameIndex, salt) & 0x00ffffffu) / 16777215.0;
}

fn legacyPcgCloudJitterHash2D(bits: vec2<u32>) -> u32 {
  let mixedSeed = legacyPcgAdvanceState32(bits.x) ^ bits.y;
  let word = ((legacyPcgAdvanceState32(mixedSeed) >> ((mixedSeed >> 28u) + 4u)) ^ mixedSeed) * 277803737u;
  return (word >> 22u) ^ word;
}

fn legacyPcgSsrJitterHash2D(bits: vec2<u32>) -> u32 {
  let seed = legacyPcgAdvanceState32(bits.x) ^ bits.y;
  return (legacyPcgAdvanceState32(seed) >> 22u) ^ (seed * 277803737u);
}

fn legacyPcgSparkleHash3D(bits: vec3<u32>) -> u32 {
  let seed = bits.x + 747796405u;
  let mixed = (legacyPcgAdvanceState32(seed) ^ bits.y) * 277803737u;
  let folded = ((mixed >> ((mixed >> 28u) + 4u)) ^ mixed ^ bits.z);
  return (folded >> 22u) ^ folded;
}
`;

export const LEGACY_PARTICLE_VERTEX_QUALITY_PCG_WGSL = /* wgsl */ `
fn legacyParticleVertexQualityPcgHash2D(instanceIndex: u32, centerXBits: u32) -> u32 {
  return legacyPcgOutput32(legacyPcgAdvanceState32(instanceIndex) ^ centerXBits);
}

fn legacyParticleVertexQualityRandomFloat01(instanceIndex: u32, centerXBits: u32) -> f32 {
  return f32(legacyParticleVertexQualityPcgHash2D(instanceIndex, centerXBits)) / 4294967295.0;
}
`;

export const LEGACY_STANDALONE_RUNTIME_PCG_WGSL = /* wgsl */ `
fn legacyStandaloneRuntimePcgHash32(value: u32) -> u32 {
  return legacyPcgHash32(value);
}

fn legacyStandaloneRuntimePcgFloat01(value: u32) -> f32 {
  return f32(legacyStandaloneRuntimePcgHash32(value)) / 4294967295.0;
}

fn legacyStandaloneRuntimePcgHashStepRandomFloat01(state: ptr<function, u32>) -> f32 {
  *state = legacyStandaloneRuntimePcgHash32(*state);
  return f32(*state) / 4294967295.0;
}
`;

export const LEGACY_RENDER_RUNTIME_PCG_HASH_WGSL = /* wgsl */ `
fn pcg_prev(v: u32) -> u32 {
  return legacyPcgHash32(v);
}

fn pcg_aurora(v: u32) -> u32 {
  return legacyPcgHash32(v);
}

fn pcg_star(v: u32) -> u32 {
  return legacyPcgHash32(v);
}

fn pcg_uw(v: u32) -> u32 {
  return legacyPcgHash32(v);
}
`;

export const LEGACY_WORLD_GENERATION_RUNTIME_PCG_HASH_WGSL = /* wgsl */ `
fn pcg_vor(v: u32) -> u32 {
  return legacyPcgHash32(v);
}

fn pcg_h(v: u32) -> u32 {
  return legacyPcgHash32(v);
}
`;

export const MESH_TO_PARTICLES_RUNTIME_PCG_WGSL = /* wgsl */ `
fn pcg_hash(input : u32) -> u32 {
  return legacyPcgHash32(input);
}

fn randomFloat(seed : ptr<function, u32>) -> f32 {
  return legacyPcgRandomFloat01(seed);
}
`;

export const LEGACY_PARTICLE_RUNTIME_PCG_WGSL = /* wgsl */ `
fn pcg_hash_sdf(v: u32) -> u32 {
  return legacyPcgHash32(v);
}

fn pcg_hash(v: u32) -> u32 {
  return legacyPcgHash32(v);
}

fn randomFloat(seed: ptr<function, u32>) -> f32 {
  return legacyPcgRandomFloat01(seed);
}
`;

export const PBR_MATERIALS_PCG_HASH_WGSL = /* wgsl */ `
fn pcg_pbr(v: u32) -> u32 {
  return legacyPcgHash32(v);
}
`;

export const FLUID_WATER_PCG_HASH_WGSL = /* wgsl */ `
fn pcg_water(v: u32) -> u32 {
  return legacyPcgHash32(v);
}
`;

export const MAGIC_EFFECTS_PCG_HASH_WGSL = /* wgsl */ `
fn pcg_magic(v: u32) -> u32 {
  return legacyPcgHash32(v);
}
`;

export const PHASE_VFX_PCG_HASH_WGSL = /* wgsl */ `
fn pcg_phase(v: u32) -> u32 {
  return legacyPcgHash32(v);
}
`;

export const PATH_TRACING_GI_PCG_WGSL = /* wgsl */ `
fn pcgHash(input : u32) -> u32 {
  return legacyPcgHash32(input);
}

fn randomFloatPT(seed : ptr<function, u32>) -> f32 {
  return legacyPcgHashStepRandomFloat01(seed);
}
`;

export const RAY_TRACING_RANDOM_FLOAT_WGSL = /* wgsl */ `
fn randomFloat(seed : ptr<function, u32>) -> f32 {
  return legacyPcgRandomFloat01(seed);
}
`;

export const LEGACY_DETERMINISTIC_RNG_SEED32_WGSL = /* wgsl */ `
fn legacyDeterministicRngTickSeed32(worldSeed: u32, tick: u32) -> u32 {
  return legacyPcgHash32(worldSeed ^ (tick * 2654435761u));
}

fn legacyDeterministicRngEntitySeed32(worldSeed: u32, entityId: u32, tick: u32) -> u32 {
  return legacyPcgHash32(worldSeed ^ (entityId * 1597334677u) ^ (tick * 2654435761u));
}

fn legacyDeterministicRngPositionSeed32(worldSeed: u32, x: i32, y: i32, z: i32) -> u32 {
  return legacyPcgHash32(worldSeed ^ (u32(x) * 1597334677u) ^ (u32(y) * 2654435761u) ^ (u32(z) * 805459861u));
}

fn legacyDeterministicRngInteractionSeed32(worldSeed: u32, entityA: u32, entityB: u32, tick: u32) -> u32 {
  let minId = min(entityA, entityB);
  let maxId = max(entityA, entityB);
  return legacyPcgHash32(worldSeed ^ (minId * 1597334677u) ^ (maxId * 2654435761u) ^ (tick * 805459861u));
}
`;

export const DETERMINISTIC_RNG_ENTITY_SEED_VERSION_V1 = 1;
export const DETERMINISTIC_RNG_ENTITY_SEED_VERSION = 2;

const SAFE_INTEGER_WORD_RADIX = 0x100000000;
const ENTITY_SEED_V2_DOMAIN = 0x45525302;
const INTERACTION_SEED_V2_DOMAIN = 0x49525302;

function positiveSafeIntegerWords(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  const high = Math.floor(value / SAFE_INTEGER_WORD_RADIX);
  return {
    value,
    low: value - high * SAFE_INTEGER_WORD_RADIX,
    high,
  };
}

/**
 * Current deterministic entity seed. V2 mixes both words of a Number-safe
 * entity handle instead of silently retaining only its low 32 bits.
 */
export function deterministicRngEntitySeed32V2(worldSeed, entityId, tick) {
  const entity = positiveSafeIntegerWords(entityId, 'entityId');
  return legacyPcgHash32(
    (worldSeed >>> 0) ^
    Math.imul(entity.low, 1597334677) ^
    Math.imul(entity.high, 2246822519) ^
    Math.imul(tick >>> 0, 2654435761) ^
    ENTITY_SEED_V2_DOMAIN
  );
}

export function deterministicRngEntitySeed32(worldSeed, entityId, tick) {
  return deterministicRngEntitySeed32V2(worldSeed, entityId, tick);
}

/** Explicit replay compatibility for the historical low-u32 entity seed. */
export function deterministicRngEntitySeed32V1(worldSeed, entityId, tick) {
  return legacyDeterministicRngEntitySeed32(worldSeed, entityId, tick);
}

/**
 * Current order-independent interaction seed. Each endpoint contributes both
 * safe-integer words after the complete handles are placed in numeric order.
 */
export function deterministicRngInteractionSeed32V2(worldSeed, entityA, entityB, tick) {
  const first = positiveSafeIntegerWords(entityA, 'entityA');
  const second = positiveSafeIntegerWords(entityB, 'entityB');
  const minimum = first.value <= second.value ? first : second;
  const maximum = first.value <= second.value ? second : first;
  return legacyPcgHash32(
    (worldSeed >>> 0) ^
    Math.imul(minimum.low, 1597334677) ^
    Math.imul(minimum.high, 2246822519) ^
    Math.imul(maximum.low, 2654435761) ^
    Math.imul(maximum.high, 3266489917) ^
    Math.imul(tick >>> 0, 805459861) ^
    INTERACTION_SEED_V2_DOMAIN
  );
}

export function deterministicRngInteractionSeed32(worldSeed, entityA, entityB, tick) {
  return deterministicRngInteractionSeed32V2(worldSeed, entityA, entityB, tick);
}

/** Explicit replay compatibility for the historical low-u32 interaction seed. */
export function deterministicRngInteractionSeed32V1(worldSeed, entityA, entityB, tick) {
  return legacyDeterministicRngInteractionSeed32(worldSeed, entityA, entityB, tick);
}

export const DETERMINISTIC_RNG_SEED32_V2_WGSL = /* wgsl */ `
fn deterministicRngEntitySeed32V2(worldSeed: u32, entityId: vec2<u32>, tick: u32) -> u32 {
  return legacyPcgHash32(
    worldSeed ^
    (entityId.x * 1597334677u) ^
    (entityId.y * 2246822519u) ^
    (tick * 2654435761u) ^
    0x45525302u
  );
}

fn deterministicRngEntitySeed32(worldSeed: u32, entityId: vec2<u32>, tick: u32) -> u32 {
  return deterministicRngEntitySeed32V2(worldSeed, entityId, tick);
}

fn deterministicRngInteractionSeed32V2(
  worldSeed: u32,
  entityA: vec2<u32>,
  entityB: vec2<u32>,
  tick: u32
) -> u32 {
  let aFirst = entityA.y < entityB.y || (entityA.y == entityB.y && entityA.x <= entityB.x);
  let minimum = select(entityB, entityA, aFirst);
  let maximum = select(entityA, entityB, aFirst);
  return legacyPcgHash32(
    worldSeed ^
    (minimum.x * 1597334677u) ^
    (minimum.y * 2246822519u) ^
    (maximum.x * 2654435761u) ^
    (maximum.y * 3266489917u) ^
    (tick * 805459861u) ^
    0x49525302u
  );
}

fn deterministicRngInteractionSeed32(
  worldSeed: u32,
  entityA: vec2<u32>,
  entityB: vec2<u32>,
  tick: u32
) -> u32 {
  return deterministicRngInteractionSeed32V2(worldSeed, entityA, entityB, tick);
}
`;

export function legacyPcgAdvanceState32(state) {
  return (Math.imul(state >>> 0, 747796405) + 2891336453) >>> 0;
}

export function legacyPcgOutput32(state) {
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

export function legacyPcgHash32(value) {
  return legacyPcgOutput32(legacyPcgAdvanceState32(value));
}

export function legacyPathTracingPcgHash32(input) {
  return legacyPcgHash32(input);
}

export function legacyPbrMaterialsPcgHash32(value) {
  return legacyPcgHash32(value);
}

export function legacyFluidWaterPcgHash32(value) {
  return legacyPcgHash32(value);
}

export function legacyMagicEffectsPcgHash32(value) {
  return legacyPcgHash32(value);
}

export function legacyPhaseVFXPcgHash32(value) {
  return legacyPcgHash32(value);
}

export function legacyPathtracingGIPcgHash32(input) {
  return legacyPcgHash32(input);
}

export function legacyPathtracingGIRandomFloat01Step(state) {
  return legacyPcgHashStepRandomFloat01Step(state);
}

export function legacyWorld3DPreviewPcgHash32(value) {
  return legacyPcgHash32(value);
}

export function legacyAuroraPcgHash32(value) {
  return legacyPcgHash32(value);
}

export function legacyCelestialStarsPcgHash32(value) {
  return legacyPcgHash32(value);
}

export function legacyUnderwaterPcgHash32(value) {
  return legacyPcgHash32(value);
}

export function legacyVoronoiRuntimePcgHash32(value) {
  return legacyPcgHash32(value);
}

export function legacyProceduralTreeRuntimePcgHash32(value) {
  return legacyPcgHash32(value);
}

export function legacyMeshToParticlesPcgHash32(input) {
  return legacyPcgHash32(input);
}

export function legacyMeshToParticlesRandomFloat01Step(state) {
  return legacyPcgRandomFloat01Step(state);
}

export function legacyParticleRuntimeSdfPcgHash32(value) {
  return legacyPcgHash32(value);
}

export function legacyParticleRuntimePcgHash32(value) {
  return legacyPcgHash32(value);
}

export function legacyParticleRuntimeRandomFloat01Step(state) {
  return legacyPcgRandomFloat01Step(state);
}

export function legacyRayTracingRandomFloat01Step(state) {
  return legacyPcgRandomFloat01Step(state);
}

export function legacyPcgRandomFloat01Step(state) {
  const nextState = legacyPcgAdvanceState32(state);
  return {
    state: nextState,
    value: legacyPcgOutput32(nextState) / 4294967295
  };
}

export function legacyPcgHashStepRandomFloat01Step(state) {
  const nextState = legacyPcgHash32(state);
  return {
    state: nextState,
    value: nextState / 4294967295
  };
}

export function legacyPcgPixelFrameHash2D(x, y, frameIndex, salt = 0) {
  const state = (
    Math.imul(x >>> 0, 747796405) +
    Math.imul(y >>> 0, 2891336453) +
    Math.imul(frameIndex >>> 0, 277803737) +
    (salt >>> 0)
  ) >>> 0;
  return legacyPcgOutput32(state);
}

export function legacyPcgPixelFrameRandom24Float01(x, y, frameIndex, salt = 0) {
  return (legacyPcgPixelFrameHash2D(x, y, frameIndex, salt) & 0x00ffffff) / 16777215;
}

export function legacyRestirTemporalHash2Float01(x, y, frameIndex) {
  return legacyPcgPixelFrameRandom24Float01(x, y, frameIndex, 0);
}

export function legacyRestirSpatialHash2Float01(x, y, frameIndex) {
  return legacyPcgPixelFrameRandom24Float01(x, y, frameIndex, 89173);
}

export function legacyPcgCloudJitterHash2D(xBits, yBits) {
  const mixedSeed = (legacyPcgAdvanceState32(xBits) ^ (yBits >>> 0)) >>> 0;
  const word = Math.imul(
    ((legacyPcgAdvanceState32(mixedSeed) >>> ((mixedSeed >>> 28) + 4)) ^ mixedSeed) >>> 0,
    277803737
  ) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

export function legacyVolumetricCloudsJitterPcgHash2D(xBits, yBits) {
  return legacyPcgCloudJitterHash2D(xBits, yBits);
}

export function legacyPcgSsrJitterHash2D(xBits, yBits) {
  const seed = (legacyPcgAdvanceState32(xBits) ^ (yBits >>> 0)) >>> 0;
  return ((legacyPcgAdvanceState32(seed) >>> 22) ^ Math.imul(seed, 277803737)) >>> 0;
}

export function legacySsrJitterPcgHash2D(xBits, yBits) {
  return legacyPcgSsrJitterHash2D(xBits, yBits);
}

export function legacyPcgSparkleHash3D(xBits, yBits, zBits) {
  const seed = ((xBits >>> 0) + 747796405) >>> 0;
  const mixed = Math.imul((legacyPcgAdvanceState32(seed) ^ (yBits >>> 0)) >>> 0, 277803737) >>> 0;
  const folded = ((mixed >>> ((mixed >>> 28) + 4)) ^ mixed ^ (zBits >>> 0)) >>> 0;
  return ((folded >>> 22) ^ folded) >>> 0;
}

export function legacyCustomParticleSparklePcgHash3D(xBits, yBits, zBits) {
  return legacyPcgSparkleHash3D(xBits, yBits, zBits);
}

export function legacyMarchingCubesMaterialPcgHash2D(xBits, zBits) {
  return legacyPcgOutput32((legacyPcgAdvanceState32(xBits) ^ (zBits >>> 0)) >>> 0);
}

export function legacyParticleVertexQualityPcgHash2D(instanceIndex, centerXBits) {
  return legacyPcgOutput32((legacyPcgAdvanceState32(instanceIndex) ^ (centerXBits >>> 0)) >>> 0);
}

export function legacyParticleVertexQualityRandomFloat01(instanceIndex, centerXBits) {
  return legacyParticleVertexQualityPcgHash2D(instanceIndex, centerXBits) / 4294967295;
}

export function legacyStandaloneRuntimePcgHash32(value) {
  return legacyPcgHash32(value);
}

export function legacyStandaloneRuntimePcgFloat01(value) {
  return legacyStandaloneRuntimePcgHash32(value) / 4294967295;
}

export function legacyStandaloneRuntimePcgHashStepRandomFloat01Step(state) {
  return legacyPcgHashStepRandomFloat01Step(state);
}

export function legacyDeterministicRngTickSeed32(worldSeed, tick) {
  return legacyPcgHash32((worldSeed >>> 0) ^ Math.imul(tick >>> 0, 2654435761));
}

export function legacyDeterministicRngEntitySeed32(worldSeed, entityId, tick) {
  return legacyPcgHash32(
    (worldSeed >>> 0) ^
    Math.imul(entityId >>> 0, 1597334677) ^
    Math.imul(tick >>> 0, 2654435761)
  );
}

export function legacyDeterministicRngPositionSeed32(worldSeed, x, y, z) {
  return legacyPcgHash32(
    (worldSeed >>> 0) ^
    Math.imul(x >>> 0, 1597334677) ^
    Math.imul(y >>> 0, 2654435761) ^
    Math.imul(z >>> 0, 805459861)
  );
}

export function legacyDeterministicRngInteractionSeed32(worldSeed, entityA, entityB, tick) {
  const minId = Math.min(entityA, entityB) >>> 0;
  const maxId = Math.max(entityA, entityB) >>> 0;
  return legacyPcgHash32(
    (worldSeed >>> 0) ^
    Math.imul(minId, 1597334677) ^
    Math.imul(maxId, 2654435761) ^
    Math.imul(tick >>> 0, 805459861)
  );
}

// xxHash-style hash (better distribution)
export function xxHash32(seed, data) {
  const PRIME1 = 0x9e3779b1;
  const PRIME2 = 0x85ebca77;
  const PRIME3 = 0xc2b2ae3d;
  const PRIME4 = 0x27d4eb2f;
  const PRIME5 = 0x165667b1;

  let h = seed + PRIME5;
  h = Math.imul(h ^ data, PRIME1);
  h = (h << 13) | (h >>> 19);
  h = Math.imul(h, PRIME2);
  h ^= h >>> 15;
  h = Math.imul(h, PRIME3);
  h ^= h >>> 13;
  h = Math.imul(h, PRIME4);
  h ^= h >>> 16;
  return h >>> 0;
}

// PCG random (faster than xxHash for sequential)
export function pcgHash(state) {
  const old = state >>> 0;
  state = Math.imul(old, 747796405) + 2891336453;
  const word = ((old >>> ((old >>> 28) + 4)) ^ old) * 277803737;
  return ((word >>> 22) ^ word) >>> 0;
}

// ============================================================================
// SPATIAL HASHING
// For chunk/cell lookup
// ============================================================================

// Pack 2D coordinates into single key (supports negative coords)
export function spatialKey2D(x, y) {
  // Offset to handle negatives, interleave for better distribution
  const ux = (x + 0x8000) & 0xffff;
  const uy = (y + 0x8000) & 0xffff;
  return (uy << 16) | ux;
}

export function spatialUnkey2D(key) {
  const x = (key & 0xffff) - 0x8000;
  const y = ((key >> 16) & 0xffff) - 0x8000;
  return [x, y];
}

// Pack 3D coordinates (10 bits each, supports -512 to 511)
export function spatialKey3D(x, y, z) {
  const ux = (x + 512) & 0x3ff;
  const uy = (y + 512) & 0x3ff;
  const uz = (z + 512) & 0x3ff;
  return (uz << 20) | (uy << 10) | ux;
}

export function spatialUnkey3D(key) {
  const x = (key & 0x3ff) - 512;
  const y = ((key >> 10) & 0x3ff) - 512;
  const z = ((key >> 20) & 0x3ff) - 512;
  return [x, y, z];
}

// String key for larger ranges (use with Map)
export const spatialKeyString2D = (x, y) => `${x},${y}`;
export const spatialKeyString3D = (x, y, z) => `${x},${y},${z}`;

// ============================================================================
// BIT PACKING FOR GPU BUFFERS
// ============================================================================

// Pack/unpack normalized float to/from N bits
export function packUnorm(value, bits) {
  const max = (1 << bits) - 1;
  return Math.round(Math.max(0, Math.min(1, value)) * max);
}

export function unpackUnorm(packed, bits) {
  const max = (1 << bits) - 1;
  return packed / max;
}

// Pack/unpack signed normalized float [-1,1] to/from N bits
export function packSnorm(value, bits) {
  const max = (1 << (bits - 1)) - 1;
  return Math.round(Math.max(-1, Math.min(1, value)) * max);
}

export function unpackSnorm(packed, bits) {
  const max = (1 << (bits - 1)) - 1;
  // Sign extend if needed
  if (packed >= (1 << (bits - 1))) {
    packed -= (1 << bits);
  }
  return packed / max;
}

// Pack RGB565 (common mobile format)
export function packRGB565(r, g, b) {
  const r5 = Math.round(r * 31) & 0x1f;
  const g6 = Math.round(g * 63) & 0x3f;
  const b5 = Math.round(b * 31) & 0x1f;
  return (r5 << 11) | (g6 << 5) | b5;
}

export function unpackRGB565(packed) {
  const r = ((packed >> 11) & 0x1f) / 31;
  const g = ((packed >> 5) & 0x3f) / 63;
  const b = (packed & 0x1f) / 31;
  return [r, g, b];
}

// Pack RGBA4444
export function packRGBA4444(r, g, b, a) {
  const r4 = Math.round(r * 15) & 0xf;
  const g4 = Math.round(g * 15) & 0xf;
  const b4 = Math.round(b * 15) & 0xf;
  const a4 = Math.round(a * 15) & 0xf;
  return (r4 << 12) | (g4 << 8) | (b4 << 4) | a4;
}

export function unpackRGBA4444(packed) {
  const r = ((packed >> 12) & 0xf) / 15;
  const g = ((packed >> 8) & 0xf) / 15;
  const b = ((packed >> 4) & 0xf) / 15;
  const a = (packed & 0xf) / 15;
  return [r, g, b, a];
}

// Pack two 16-bit values into 32-bit
export const pack2x16 = (a, b) => ((b & 0xffff) << 16) | (a & 0xffff);
export const unpack2x16 = (packed) => [packed & 0xffff, (packed >> 16) & 0xffff];

// Pack four 8-bit values into 32-bit
export const pack4x8 = (a, b, c, d) => (a & 0xff) | ((b & 0xff) << 8) | ((c & 0xff) << 16) | ((d & 0xff) << 24);
export const unpack4x8 = (packed) => [packed & 0xff, (packed >> 8) & 0xff, (packed >> 16) & 0xff, (packed >> 24) & 0xff];
