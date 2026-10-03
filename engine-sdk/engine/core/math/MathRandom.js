// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathRandom.js - Random number generation and distributions
// Seeded RNGs, distributions, sampling, quasi-random sequences

import { TAU } from './MathConstants.js';

// ============================================================================
// SEEDED RANDOM NUMBER GENERATORS
// ============================================================================

// Mulberry32 (fast, small state)
export function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// SplitMix32 (good quality, fast)
export function splitmix32(seed) {
  return function() {
    seed |= 0;
    seed = seed + 0x9e3779b9 | 0;
    let t = seed ^ seed >>> 16;
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    return ((t ^ t >>> 15) >>> 0) / 4294967296;
  };
}

// Xorshift128 (longer period)
export function xorshift128(seed) {
  let x = seed || 123456789;
  let y = 362436069;
  let z = 521288629;
  let w = 88675123;

  return function() {
    const t = x ^ (x << 11);
    x = y; y = z; z = w;
    w = w ^ (w >>> 19) ^ (t ^ (t >>> 8));
    return (w >>> 0) / 4294967296;
  };
}

// PCG (Permuted Congruential Generator - high quality)
export function pcg32(seed) {
  let state = BigInt(seed) * 2n + 1n;
  const multiplier = 6364136223846793005n;
  const increment = 1442695040888963407n;

  return function() {
    const oldState = state;
    state = oldState * multiplier + increment;
    const xorShifted = Number((((oldState >> 18n) ^ oldState) >> 27n) & 0xffffffffn);
    const rot = Number(oldState >> 59n);
    const result = ((xorShifted >>> rot) | (xorShifted << ((-rot) & 31))) >>> 0;
    return result / 4294967296;
  };
}

// Legacy 32-bit linear congruential generator step used by older deterministic callers.
export function legacyLcgAdvanceState32(state) {
  return (Math.imul(state >>> 0, 1664525) + 1013904223) >>> 0;
}

export function legacyLcgStateToFloat01(state) {
  return (state >>> 0) / 4294967296;
}



// Create default RNG
let defaultRng = Math.random;

export function setRandomSeed(seed) {
  defaultRng = mulberry32(seed);
}

export function resetRandomSeed() {
  defaultRng = Math.random;
}

export function random() {
  return defaultRng();
}

export function randomRange(min, max) {
  return min + defaultRng() * (max - min);
}

export function randomInt(min, max) {
  return Math.floor(min + defaultRng() * (max - min + 1));
}

export function randomBool(probability = 0.5) {
  return defaultRng() < probability;
}

export function randomSign() {
  return defaultRng() < 0.5 ? -1 : 1;
}

// ============================================================================
// DISTRIBUTIONS
// ============================================================================

// Uniform distribution
export function uniformDistribution(min = 0, max = 1, rng = defaultRng) {
  return min + rng() * (max - min);
}

// Normal (Gaussian) distribution using Box-Muller transform
export function normalDistribution(mean = 0, stdDev = 1, rng = defaultRng) {
  const u1 = rng();
  const u2 = rng();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(TAU * u2);
  return z0 * stdDev + mean;
}

// Exponential distribution
export function exponentialDistribution(lambda = 1, rng = defaultRng) {
  return -Math.log(1 - rng()) / lambda;
}

// Poisson distribution
export function poissonDistribution(lambda, rng = defaultRng) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

// Binomial distribution
export function binomialDistribution(n, p, rng = defaultRng) {
  let successes = 0;
  for (let i = 0; i < n; i++) {
    if (rng() < p) successes++;
  }
  return successes;
}

// Triangular distribution
export function triangularDistribution(min, max, mode, rng = defaultRng) {
  const u = rng();
  const fc = (mode - min) / (max - min);
  if (u < fc) {
    return min + Math.sqrt(u * (max - min) * (mode - min));
  }
  return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

// Gamma distribution (Marsaglia and Tsang's method)
export function gammaDistribution(shape, scale = 1, rng = defaultRng) {
  if (shape < 1) {
    return gammaDistribution(1 + shape, scale, rng) * Math.pow(rng(), 1 / shape);
  }

  const d = shape - 1/3;
  const c = 1 / Math.sqrt(9 * d);

  while (true) {
    let x, v;
    do {
      x = normalDistribution(0, 1, rng);
      v = 1 + c * x;
    } while (v <= 0);

    v = v * v * v;
    const u = rng();

    if (u < 1 - 0.0331 * (x * x) * (x * x)) {
      return d * v * scale;
    }

    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v * scale;
    }
  }
}

// Beta distribution (using gamma variates)
export function betaDistribution(alpha, beta, rng = defaultRng) {
  const ga = gammaDistribution(alpha, 1, rng);
  const gb = gammaDistribution(beta, 1, rng);
  return ga / (ga + gb);
}

// Log-normal distribution
export function logNormalDistribution(mean = 0, stdDev = 1, rng = defaultRng) {
  return Math.exp(normalDistribution(mean, stdDev, rng));
}

// Cauchy distribution
export function cauchyDistribution(x0 = 0, gamma = 1, rng = defaultRng) {
  return x0 + gamma * Math.tan(Math.PI * (rng() - 0.5));
}

// Pareto distribution
export function paretoDistribution(alpha, xMin = 1, rng = defaultRng) {
  return xMin / Math.pow(1 - rng(), 1 / alpha);
}

// ============================================================================
// SAMPLING
// ============================================================================

// Weighted random selection
export function weightedRandom(weights, rng = defaultRng) {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

// Random element from array
export function randomElement(array, rng = defaultRng) {
  return array[Math.floor(rng() * array.length)];
}

// Shuffle array (Fisher-Yates)
export function shuffle(array, rng = defaultRng) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Shuffle array in place
export function shuffleInPlace(array, rng = defaultRng) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Sample n elements from array without replacement
export function sample(array, n, rng = defaultRng) {
  const shuffled = shuffle(array, rng);
  return shuffled.slice(0, Math.min(n, array.length));
}

// Sample n elements from array with replacement
export function sampleWithReplacement(array, n, rng = defaultRng) {
  const result = [];
  for (let i = 0; i < n; i++) {
    result.push(randomElement(array, rng));
  }
  return result;
}

// Reservoir sampling (sample k items from a stream of unknown size)
export function reservoirSample(stream, k, rng = defaultRng) {
  const reservoir = [];
  let i = 0;

  for (const item of stream) {
    if (i < k) {
      reservoir.push(item);
    } else {
      const j = Math.floor(rng() * (i + 1));
      if (j < k) {
        reservoir[j] = item;
      }
    }
    i++;
  }

  return reservoir;
}

// ============================================================================
// GEOMETRIC SAMPLING
// ============================================================================

// Random point on unit circle
export function randomOnCircle(rng = defaultRng) {
  const angle = rng() * TAU;
  return [Math.cos(angle), Math.sin(angle)];
}

// Random point in unit circle
export function randomInCircle(rng = defaultRng) {
  const r = Math.sqrt(rng());
  const angle = rng() * TAU;
  return [r * Math.cos(angle), r * Math.sin(angle)];
}

// Random point on unit sphere
export function randomOnSphere(rng = defaultRng) {
  const u = rng();
  const v = rng();
  const theta = TAU * u;
  const phi = Math.acos(2 * v - 1);
  const sinPhi = Math.sin(phi);
  return [sinPhi * Math.cos(theta), sinPhi * Math.sin(theta), Math.cos(phi)];
}

// Random point in unit sphere
export function randomInSphere(rng = defaultRng) {
  const dir = randomOnSphere(rng);
  const r = Math.cbrt(rng());
  return [dir[0] * r, dir[1] * r, dir[2] * r];
}

// Random point on hemisphere (cosine-weighted for importance sampling)
export function randomOnHemisphereCosine(normal, rng = defaultRng) {
  const u1 = rng();
  const u2 = rng();
  const r = Math.sqrt(u1);
  const theta = TAU * u2;

  // Generate local coordinates
  const x = r * Math.cos(theta);
  const y = r * Math.sin(theta);
  const z = Math.sqrt(1 - u1);

  // Create tangent space
  const tangent = Math.abs(normal[0]) < 0.9
    ? _normalize3(_cross3(normal, [1, 0, 0]))
    : _normalize3(_cross3(normal, [0, 1, 0]));
  const bitangent = _cross3(normal, tangent);

  return [
    x * tangent[0] + y * bitangent[0] + z * normal[0],
    x * tangent[1] + y * bitangent[1] + z * normal[1],
    x * tangent[2] + y * bitangent[2] + z * normal[2],
  ];
}

// Random point in triangle (barycentric coordinates)
export function randomInTriangle(v0, v1, v2, rng = defaultRng) {
  const u = rng();
  const v = rng();
  const su = Math.sqrt(u);
  const a = 1 - su;
  const b = v * su;
  const c = 1 - a - b;
  return [
    a * v0[0] + b * v1[0] + c * v2[0],
    a * v0[1] + b * v1[1] + c * v2[1],
    a * v0[2] + b * v1[2] + c * v2[2],
  ];
}

// Random direction in cone
export function randomInCone(direction, halfAngle, rng = defaultRng) {
  const cosAngle = Math.cos(halfAngle);
  const z = rng() * (1 - cosAngle) + cosAngle;
  const phi = rng() * TAU;
  const sinZ = Math.sqrt(1 - z * z);

  const tangent = Math.abs(direction[0]) < 0.9
    ? _normalize3(_cross3(direction, [1, 0, 0]))
    : _normalize3(_cross3(direction, [0, 1, 0]));
  const bitangent = _cross3(direction, tangent);

  return [
    direction[0] * z + tangent[0] * sinZ * Math.cos(phi) + bitangent[0] * sinZ * Math.sin(phi),
    direction[1] * z + tangent[1] * sinZ * Math.cos(phi) + bitangent[1] * sinZ * Math.sin(phi),
    direction[2] * z + tangent[2] * sinZ * Math.cos(phi) + bitangent[2] * sinZ * Math.sin(phi),
  ];
}

// ============================================================================
// QUASI-RANDOM SEQUENCES (Low Discrepancy)
// ============================================================================

// Halton sequence
export function haltonSequence(index, base) {
  let result = 0;
  let f = 1 / base;
  let i = index;
  while (i > 0) {
    result += f * (i % base);
    i = Math.floor(i / base);
    f /= base;
  }
  return result;
}

// Generate 2D Halton point
export function halton2D(index) {
  return [haltonSequence(index, 2), haltonSequence(index, 3)];
}

// Generate 3D Halton point
export function halton3D(index) {
  return [haltonSequence(index, 2), haltonSequence(index, 3), haltonSequence(index, 5)];
}

// R2 sequence (Martin Roberts' quasirandom sequence)
export function r2Sequence(index) {
  const g = 1.32471795724474602596;
  const a1 = 1 / g;
  const a2 = 1 / (g * g);
  return [(0.5 + a1 * index) % 1, (0.5 + a2 * index) % 1];
}

// R3 sequence (3D extension)
export function r3Sequence(index) {
  const g = 1.2207440846057596;
  const a1 = 1 / g;
  const a2 = 1 / (g * g);
  const a3 = 1 / (g * g * g);
  return [(0.5 + a1 * index) % 1, (0.5 + a2 * index) % 1, (0.5 + a3 * index) % 1];
}

// Fibonacci sphere: deterministic uniform distribution on unit sphere
// CPU parity for RealtimeGI.js GPU fibonacciSphere
export function fibonacciSphere(index, total, rotation = 0) {
  const goldenRatio = 1.618033988749895;
  const theta = TAU * index / goldenRatio + rotation;
  const phi = Math.acos(1 - 2 * (index + 0.5) / total);
  return [
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  ];
}

// Generate N uniformly distributed points on unit sphere
export function fibonacciSpherePoints(count, rotation = 0) {
  const points = new Array(count);
  for (let i = 0; i < count; i++) {
    points[i] = fibonacciSphere(i, count, rotation);
  }
  return points;
}

// Fibonacci disk: uniform distribution on unit disk (for 2D sampling)
export function fibonacciDisk(index, total) {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const r = Math.sqrt((index + 0.5) / total);
  const theta = index * goldenAngle;
  return [r * Math.cos(theta), r * Math.sin(theta)];
}

// Blue noise (Poisson disk sampling)
export function poissonDiskSampling(width, height, minDist, maxAttempts = 30, rng = defaultRng) {
  const cellSize = minDist / Math.SQRT2;
  const gridWidth = Math.ceil(width / cellSize);
  const gridHeight = Math.ceil(height / cellSize);
  const grid = new Array(gridWidth * gridHeight).fill(-1);
  const points = [];
  const active = [];

  const gridIndex = (x, y) => {
    const gx = Math.floor(x / cellSize);
    const gy = Math.floor(y / cellSize);
    if (gx < 0 || gx >= gridWidth || gy < 0 || gy >= gridHeight) return -1;
    return gy * gridWidth + gx;
  };

  const addPoint = (x, y) => {
    const idx = points.length;
    points.push([x, y]);
    active.push(idx);
    const gi = gridIndex(x, y);
    if (gi >= 0) grid[gi] = idx;
    return idx;
  };

  const isValid = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    const gx = Math.floor(x / cellSize);
    const gy = Math.floor(y / cellSize);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx >= 0 && nx < gridWidth && ny >= 0 && ny < gridHeight) {
          const idx = grid[ny * gridWidth + nx];
          if (idx >= 0) {
            const p = points[idx];
            const distSq = (x - p[0]) ** 2 + (y - p[1]) ** 2;
            if (distSq < minDist * minDist) return false;
          }
        }
      }
    }
    return true;
  };

  // Start with random point
  addPoint(rng() * width, rng() * height);

  while (active.length > 0) {
    const activeIdx = Math.floor(rng() * active.length);
    const pointIdx = active[activeIdx];
    const point = points[pointIdx];
    let found = false;

    for (let i = 0; i < maxAttempts; i++) {
      const angle = rng() * TAU;
      const dist = minDist + rng() * minDist;
      const nx = point[0] + Math.cos(angle) * dist;
      const ny = point[1] + Math.sin(angle) * dist;

      if (isValid(nx, ny)) {
        addPoint(nx, ny);
        found = true;
        break;
      }
    }

    if (!found) {
      active.splice(activeIdx, 1);
    }
  }

  return points;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function _cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function _normalize3(v) {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 0];
}
