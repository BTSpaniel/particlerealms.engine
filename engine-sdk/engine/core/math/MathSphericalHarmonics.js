// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathSphericalHarmonics.js - CPU-side Spherical Harmonics (L0-L2, 9 coefficients)
// Consolidates: RealtimeGI.js inline WGSL evalSH, provides CPU parity for probe baking/debugging
// Three.js SphericalHarmonics3 parity

// SH coefficients stored as 9-element array of [r,g,b] triplets = 27 floats
// Or as 9-element array of scalars for single-channel

// ============================================================================
// SH BASIS CONSTANTS (L0-L2)
// ============================================================================

const SH_C0 = 0.282095;        // 1 / (2√π)
const SH_C1 = 0.488603;        // √(3/(4π))
const SH_C2_0 = 1.092548;      // √(15/(4π))
const SH_C2_1 = 0.315392;      // √(5/(16π))
const SH_C2_2 = 0.546274;      // √(15/(16π))

// Cosine lobe convolution coefficients (for diffuse irradiance)
const A_HAT = [
  Math.PI,                      // L0: π
  2 * Math.PI / 3,              // L1: 2π/3
  Math.PI / 4,                  // L2: π/4
];

// ============================================================================
// CREATION
// ============================================================================

/** Create zero SH (9 RGB coefficients = 27 floats) */
export function shZero() {
  return new Float32Array(27);
}

/** Clone SH coefficients */
export function shClone(sh) {
  return new Float32Array(sh);
}

/** Create SH from constant color (ambient only, L0 band) */
export function shFromColor(r, g, b) {
  const sh = new Float32Array(27);
  const scale = 1 / SH_C0;
  sh[0] = r * scale;
  sh[1] = g * scale;
  sh[2] = b * scale;
  return sh;
}

// ============================================================================
// EVALUATION — Basis functions
// ============================================================================

/** Evaluate 9 SH basis functions for a direction [x,y,z] (must be normalized) */
export function shEvaluateBasis(dir) {
  const x = dir[0], y = dir[1], z = dir[2];
  return [
    SH_C0,                       // L0 m=0
    SH_C1 * y,                   // L1 m=-1
    SH_C1 * z,                   // L1 m=0
    SH_C1 * x,                   // L1 m=1
    SH_C2_0 * x * y,             // L2 m=-2
    SH_C2_0 * y * z,             // L2 m=-1
    SH_C2_1 * (3 * z * z - 1),   // L2 m=0
    SH_C2_0 * x * z,             // L2 m=1
    SH_C2_2 * (x * x - y * y),   // L2 m=2
  ];
}

/** Evaluate 4 SH basis functions (L0+L1 only, cheaper) */
export function shEvaluateBasisL1(dir) {
  return [
    SH_C0,
    SH_C1 * dir[1],
    SH_C1 * dir[2],
    SH_C1 * dir[0],
  ];
}

// ============================================================================
// EVALUATION — Reconstruct color from SH
// ============================================================================

/** Evaluate RGB color from SH coefficients at a direction */
export function shEvaluate(sh, dir) {
  const basis = shEvaluateBasis(dir);
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < 9; i++) {
    const j = i * 3;
    r += sh[j] * basis[i];
    g += sh[j + 1] * basis[i];
    b += sh[j + 2] * basis[i];
  }
  return [r, g, b];
}

/** Evaluate irradiance (diffuse lighting) from SH at a surface normal */
export function shIrradiance(sh, normal) {
  const basis = shEvaluateBasis(normal);
  // Apply cosine lobe convolution (Ramamoorthi & Hanrahan 2001)
  const bandScale = [A_HAT[0], A_HAT[1], A_HAT[1], A_HAT[1], A_HAT[2], A_HAT[2], A_HAT[2], A_HAT[2], A_HAT[2]];
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < 9; i++) {
    const j = i * 3;
    const w = basis[i] * bandScale[i];
    r += sh[j] * w;
    g += sh[j + 1] * w;
    b += sh[j + 2] * w;
  }
  return [r, g, b];
}

// ============================================================================
// PROJECTION — Project samples onto SH
// ============================================================================

/**
 * Project directional samples onto SH coefficients
 * @param {number[][]} directions - Array of normalized [x,y,z] directions
 * @param {number[][]} colors - Array of [r,g,b] color samples
 * @returns {Float32Array} 27-element SH coefficients
 */
export function shProject(directions, colors) {
  const sh = new Float32Array(27);
  const weight = 4 * Math.PI / directions.length;

  for (let s = 0; s < directions.length; s++) {
    const basis = shEvaluateBasis(directions[s]);
    const c = colors[s];
    for (let i = 0; i < 9; i++) {
      const j = i * 3;
      const w = basis[i] * weight;
      sh[j] += c[0] * w;
      sh[j + 1] += c[1] * w;
      sh[j + 2] += c[2] * w;
    }
  }

  return sh;
}

// ============================================================================
// OPERATIONS
// ============================================================================

/** Add two SH: out = a + b */
export function shAdd(a, b) {
  const out = new Float32Array(27);
  for (let i = 0; i < 27; i++) out[i] = a[i] + b[i];
  return out;
}

/** Scale SH by scalar */
export function shScale(sh, s) {
  const out = new Float32Array(27);
  for (let i = 0; i < 27; i++) out[i] = sh[i] * s;
  return out;
}

/** Lerp between two SH */
export function shLerp(a, b, t) {
  const out = new Float32Array(27);
  const s = 1 - t;
  for (let i = 0; i < 27; i++) out[i] = a[i] * s + b[i] * t;
  return out;
}

/** Accumulate: out += sh * weight (in-place) */
export function shAccumulate(out, sh, weight) {
  for (let i = 0; i < 27; i++) out[i] += sh[i] * weight;
  return out;
}

// ============================================================================
// CONVOLUTION — Apply windowing/filtering
// ============================================================================

/**
 * Convolve SH with per-band kernel (e.g., cosine lobe for diffuse)
 * @param {Float32Array} sh - Input SH (27 floats)
 * @param {number[]} kernel - Per-band kernel [k0, k1, k2] for L0, L1, L2
 * @returns {Float32Array} Convolved SH
 */
export function shConvolve(sh, kernel) {
  const out = new Float32Array(27);
  // L0: 1 coefficient (index 0)
  for (let c = 0; c < 3; c++) out[c] = sh[c] * kernel[0];
  // L1: 3 coefficients (indices 1-3)
  for (let i = 1; i <= 3; i++) {
    const j = i * 3;
    for (let c = 0; c < 3; c++) out[j + c] = sh[j + c] * kernel[1];
  }
  // L2: 5 coefficients (indices 4-8)
  for (let i = 4; i <= 8; i++) {
    const j = i * 3;
    for (let c = 0; c < 3; c++) out[j + c] = sh[j + c] * kernel[2];
  }
  return out;
}

/** Apply Hanning window to reduce ringing */
export function shWindow(sh, windowWidth) {
  const kernel = [];
  for (let l = 0; l <= 2; l++) {
    const x = (Math.PI * l) / windowWidth;
    kernel.push(x < Math.PI ? (Math.cos(x) + 1) * 0.5 : 0);
  }
  return shConvolve(sh, kernel);
}

// ============================================================================
// ROTATION — Rotate SH by 3x3 rotation matrix (column-major)
// ============================================================================

/**
 * Rotate SH coefficients by a 3x3 rotation matrix
 * L0 is invariant. L1 rotates directly. L2 uses the explicit 5x5 rotation.
 * Reference: Ivanic & Ruedenberg (1996), Green "SH Lighting: The Gritty Details" (2003)
 * @param {Float32Array} sh - Input SH (27 floats)
 * @param {Float32Array|number[]} mat3 - 3x3 rotation matrix (column-major)
 * @returns {Float32Array} Rotated SH
 */
export function shRotate(sh, mat3) {
  const out = new Float32Array(27);
  const M = mat3;
  // Column-major 3x3: M[col*3+row], so M[0]=m00, M[1]=m10, M[2]=m20,
  //   M[3]=m01, M[4]=m11, M[5]=m21, M[6]=m02, M[7]=m12, M[8]=m22
  const m00 = M[0], m10 = M[1], m20 = M[2];
  const m01 = M[3], m11 = M[4], m21 = M[5];
  const m02 = M[6], m12 = M[7], m22 = M[8];

  // L0 (band 0): invariant under rotation
  out[0] = sh[0]; out[1] = sh[1]; out[2] = sh[2];

  // L1 (band 1): SH basis order is y,z,x → indices 1,2,3
  for (let c = 0; c < 3; c++) {
    const sy = sh[1 * 3 + c];
    const sz = sh[2 * 3 + c];
    const sx = sh[3 * 3 + c];
    out[1 * 3 + c] = m10 * sx + m11 * sy + m12 * sz;
    out[2 * 3 + c] = m20 * sx + m21 * sy + m22 * sz;
    out[3 * 3 + c] = m00 * sx + m01 * sy + m02 * sz;
  }

  // L2 (band 2): explicit 5×5 rotation (Ivanic & Ruedenberg 1996)
  // SH L2 order: [4]=xy, [5]=yz, [6]=3z²-1, [7]=xz, [8]=x²-y²
  for (let c = 0; c < 3; c++) {
    const s0 = sh[4*3+c], s1 = sh[5*3+c], s2 = sh[6*3+c], s3 = sh[7*3+c], s4 = sh[8*3+c];
    out[4*3+c] = (m00*m11+m01*m10)*s0 + (m01*m12+m02*m11)*s1 + (m02*m12)*(3*SH_C2_1/SH_C2_0)*s2 + (m00*m12+m02*m10)*s3 + (m00*m10-m01*m11)*(SH_C2_2/SH_C2_0)*s4;
    out[5*3+c] = (m10*m21+m11*m20)*s0 + (m11*m22+m12*m21)*s1 + (m12*m22)*(3*SH_C2_1/SH_C2_0)*s2 + (m10*m22+m12*m20)*s3 + (m10*m20-m11*m21)*(SH_C2_2/SH_C2_0)*s4;
    out[6*3+c] = (2*m20*m21)*(SH_C2_0/SH_C2_1)*s0 + (2*m21*m22)*(SH_C2_0/SH_C2_1)*s1 + (3*m22*m22-1)*s2 + (2*m20*m22)*(SH_C2_0/SH_C2_1)*s3 + (m20*m20-m21*m21)*(SH_C2_2/SH_C2_1)*s4;
    out[7*3+c] = (m00*m21+m01*m20)*s0 + (m01*m22+m02*m21)*s1 + (m02*m22)*(3*SH_C2_1/SH_C2_0)*s2 + (m00*m22+m02*m20)*s3 + (m00*m20-m01*m21)*(SH_C2_2/SH_C2_0)*s4;
    out[8*3+c] = (m00*m01-m10*m11)*(SH_C2_0/SH_C2_2)*s0 + (m01*m02-m11*m12)*(SH_C2_0/SH_C2_2)*s1 + (m02*m02-m12*m12)*(3*SH_C2_1/SH_C2_2)*0.5*s2 + (m00*m02-m10*m12)*(SH_C2_0/SH_C2_2)*s3 + 0.5*(m00*m00-m01*m01-m10*m10+m11*m11)*s4;
  }

  return out;
}

// ============================================================================
// GPU UPLOAD
// ============================================================================

/** Convert SH to Float32Array suitable for GPU uniform upload (already is Float32Array) */
export const shToGPUBuffer = (sh) => sh instanceof Float32Array ? sh : new Float32Array(sh);

// ============================================================================
// CUBEMAP PROJECTION
// ============================================================================

/**
 * Project 6-face cubemap to SH
 * @param {Array<{data: Float32Array|number[], width: number}>} faces - [+X, -X, +Y, -Y, +Z, -Z]
 * @returns {Float32Array} 27-element SH
 */
export function shFromCubemap(faces) {
  const sh = new Float32Array(27);
  let totalWeight = 0;

  const faceDirections = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  const faceUp = [
    [0, 1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [0, 1, 0], [0, 1, 0],
  ];
  const faceRight = [
    [0, 0, -1], [0, 0, 1], [1, 0, 0], [1, 0, 0], [1, 0, 0], [-1, 0, 0],
  ];

  for (let f = 0; f < 6; f++) {
    const face = faces[f];
    const w = face.width;
    const dir = faceDirections[f];
    const up = faceUp[f];
    const right = faceRight[f];

    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const u = (2 * (x + 0.5) / w) - 1;
        const v = (2 * (y + 0.5) / w) - 1;

        const dx = dir[0] + right[0] * u + up[0] * v;
        const dy = dir[1] + right[1] * u + up[1] * v;
        const dz = dir[2] + right[2] * u + up[2] * v;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const nx = dx / len, ny = dy / len, nz = dz / len;

        // Solid angle of texel
        const solidAngle = 4 / (len * len * len * w * w);

        const pixelIdx = (y * w + x) * 3;
        const cr = face.data[pixelIdx];
        const cg = face.data[pixelIdx + 1];
        const cb = face.data[pixelIdx + 2];

        const basis = shEvaluateBasis([nx, ny, nz]);
        for (let i = 0; i < 9; i++) {
          const j = i * 3;
          const bw = basis[i] * solidAngle;
          sh[j] += cr * bw;
          sh[j + 1] += cg * bw;
          sh[j + 2] += cb * bw;
        }
        totalWeight += solidAngle;
      }
    }
  }

  // Normalize (total solid angle of sphere = 4π)
  if (totalWeight > 0) {
    const scale = 4 * Math.PI / totalWeight;
    for (let i = 0; i < 27; i++) sh[i] *= scale;
  }

  return sh;
}
