// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathNoise.js - Procedural noise functions
// Perlin, Simplex, Value, Voronoi, FBM, Ridged, Domain Warping, Curl

import { lerp } from './MathScalar.js';

// ============================================================================
// PERMUTATION TABLE (shared by Perlin/Simplex)
// ============================================================================

const p = new Uint8Array(512);
const perm = [
  151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225,
  140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148,
  247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32,
  57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
  74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122,
  60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54,
  65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169,
  200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64,
  52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212,
  207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213,
  119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9,
  129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104,
  218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241,
  81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157,
  184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93,
  222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
];
for (let i = 0; i < 256; i++) {
  p[i] = perm[i];
  p[i + 256] = perm[i];
}

// Gradient functions
function grad1(hash, x) {
  return (hash & 1) === 0 ? x : -x;
}

function grad2(hash, x, y) {
  const h = hash & 3;
  return ((h & 1) === 0 ? x : -x) + ((h & 2) === 0 ? y : -y);
}

function grad3(hash, x, y, z) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : (h === 12 || h === 14) ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

// Fade/smoothstep for Perlin
function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// ============================================================================
// PERLIN NOISE
// ============================================================================

export function perlin1D(x) {
  const X = Math.floor(x) & 255;
  x -= Math.floor(x);
  const u = fade(x);
  return lerp(grad1(p[X], x), grad1(p[X + 1], x - 1), u);
}

export function perlin2D(x, y) {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  const u = fade(x);
  const v = fade(y);
  const A = p[X] + Y;
  const B = p[X + 1] + Y;
  return lerp(
    lerp(grad2(p[A], x, y), grad2(p[B], x - 1, y), u),
    lerp(grad2(p[A + 1], x, y - 1), grad2(p[B + 1], x - 1, y - 1), u),
    v
  );
}

export function perlin3D(x, y, z) {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);
  const u = fade(x);
  const v = fade(y);
  const w = fade(z);
  const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
  const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
  return lerp(
    lerp(
      lerp(grad3(p[AA], x, y, z), grad3(p[BA], x - 1, y, z), u),
      lerp(grad3(p[AB], x, y - 1, z), grad3(p[BB], x - 1, y - 1, z), u),
      v
    ),
    lerp(
      lerp(grad3(p[AA + 1], x, y, z - 1), grad3(p[BA + 1], x - 1, y, z - 1), u),
      lerp(grad3(p[AB + 1], x, y - 1, z - 1), grad3(p[BB + 1], x - 1, y - 1, z - 1), u),
      v
    ),
    w
  );
}

// ============================================================================
// SIMPLEX NOISE
// ============================================================================

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

const grad3s = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

export function simplex2D(x, y) {
  const s = (x + y) * F2;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t);
  const y0 = y - (j - t);

  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;

  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;

  const ii = i & 255;
  const jj = j & 255;

  let n0 = 0, n1 = 0, n2 = 0;

  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 >= 0) {
    const gi0 = p[ii + p[jj]] % 12;
    t0 *= t0;
    n0 = t0 * t0 * (grad3s[gi0][0] * x0 + grad3s[gi0][1] * y0);
  }

  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 >= 0) {
    const gi1 = p[ii + i1 + p[jj + j1]] % 12;
    t1 *= t1;
    n1 = t1 * t1 * (grad3s[gi1][0] * x1 + grad3s[gi1][1] * y1);
  }

  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 >= 0) {
    const gi2 = p[ii + 1 + p[jj + 1]] % 12;
    t2 *= t2;
    n2 = t2 * t2 * (grad3s[gi2][0] * x2 + grad3s[gi2][1] * y2);
  }

  return 70 * (n0 + n1 + n2);
}

export function simplex3D(x, y, z) {
  const s = (x + y + z) * F3;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const k = Math.floor(z + s);
  const t = (i + j + k) * G3;
  const x0 = x - (i - t);
  const y0 = y - (j - t);
  const z0 = z - (k - t);

  let i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) {
    if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
    else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
  } else {
    if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
    else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
    else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
  }

  const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
  const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;

  const ii = i & 255, jj = j & 255, kk = k & 255;

  let n0 = 0, n1 = 0, n2 = 0, n3 = 0;

  let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
  if (t0 >= 0) {
    const gi0 = p[ii + p[jj + p[kk]]] % 12;
    t0 *= t0;
    n0 = t0 * t0 * (grad3s[gi0][0] * x0 + grad3s[gi0][1] * y0 + grad3s[gi0][2] * z0);
  }

  let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
  if (t1 >= 0) {
    const gi1 = p[ii + i1 + p[jj + j1 + p[kk + k1]]] % 12;
    t1 *= t1;
    n1 = t1 * t1 * (grad3s[gi1][0] * x1 + grad3s[gi1][1] * y1 + grad3s[gi1][2] * z1);
  }

  let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
  if (t2 >= 0) {
    const gi2 = p[ii + i2 + p[jj + j2 + p[kk + k2]]] % 12;
    t2 *= t2;
    n2 = t2 * t2 * (grad3s[gi2][0] * x2 + grad3s[gi2][1] * y2 + grad3s[gi2][2] * z2);
  }

  let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
  if (t3 >= 0) {
    const gi3 = p[ii + 1 + p[jj + 1 + p[kk + 1]]] % 12;
    t3 *= t3;
    n3 = t3 * t3 * (grad3s[gi3][0] * x3 + grad3s[gi3][1] * y3 + grad3s[gi3][2] * z3);
  }

  return 32 * (n0 + n1 + n2 + n3);
}

// ============================================================================
// VALUE NOISE
// ============================================================================

export function valueNoise2D(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = fade(xf);
  const v = fade(yf);
  const aa = (p[p[xi & 255] + (yi & 255)] / 255) * 2 - 1;
  const ab = (p[p[xi & 255] + ((yi + 1) & 255)] / 255) * 2 - 1;
  const ba = (p[p[(xi + 1) & 255] + (yi & 255)] / 255) * 2 - 1;
  const bb = (p[p[(xi + 1) & 255] + ((yi + 1) & 255)] / 255) * 2 - 1;
  return lerp(lerp(aa, ba, u), lerp(ab, bb, u), v);
}

export function valueNoise3D(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  const X = xi & 255, Y = yi & 255, Z = zi & 255;
  const getValue = (i, j, k) => (p[p[p[i] + j] + k] / 255) * 2 - 1;
  const v000 = getValue(X, Y, Z), v100 = getValue(X + 1, Y, Z);
  const v010 = getValue(X, Y + 1, Z), v110 = getValue(X + 1, Y + 1, Z);
  const v001 = getValue(X, Y, Z + 1), v101 = getValue(X + 1, Y, Z + 1);
  const v011 = getValue(X, Y + 1, Z + 1), v111 = getValue(X + 1, Y + 1, Z + 1);
  return lerp(
    lerp(lerp(v000, v100, xf), lerp(v010, v110, xf), yf),
    lerp(lerp(v001, v101, xf), lerp(v011, v111, xf), yf),
    zf
  );
}

// ============================================================================
// WGSL VALUE NOISE MIRRORS

// ============================================================================



const f32 = Math.fround;

const floorF32 = (value) => Math.floor(f32(value));

const fract = (value) => {
  const v = f32(value);
  return f32(v - Math.floor(v));
};

const mixF32 = (a, b, t) => {
  const ratio = f32(t);
  return f32(f32(f32(a) * f32(1 - ratio)) + f32(f32(b) * ratio));
};

const smoothCubic = (value) => {

  const v = f32(value);

  return f32(f32(v * v) * f32(3 - f32(2 * v)));

};

const smoothQuintic = (value) => {

  const v = f32(value);

  return f32(f32(f32(v * v) * v) * f32(f32(v * f32(f32(v * 6) - 15)) + 10));

};



export function shaderHash2D(x, y) {

  const kx = f32(0.3183099);

  const ky = f32(0.3678794);

  const px = f32(f32(f32(x) * kx) + ky);

  const py = f32(f32(f32(y) * ky) + kx);

  return fract(f32(f32(16 * kx) * fract(f32(f32(px * py) * f32(px + py)))));

}



export function shaderNoise2D(x, y) {

  const ix = floorF32(x);

  const iy = floorF32(y);

  const ux = smoothCubic(fract(x));

  const uy = smoothCubic(fract(y));

  return mixF32(

    mixF32(shaderHash2D(ix, iy), shaderHash2D(ix + 1, iy), ux),

    mixF32(shaderHash2D(ix, iy + 1), shaderHash2D(ix + 1, iy + 1), ux),

    uy

  );

}



export function shaderFbm2D(x, y) {

  let value = f32(0);

  let amplitude = f32(0.5);

  let px = f32(x);

  let py = f32(y);

  for (let i = 0; i < 4; i++) {

    value = f32(value + f32(amplitude * shaderNoise2D(px, py)));

    px = f32(px * 2);

    py = f32(py * 2);

    amplitude = f32(amplitude * 0.5);

  }

  return value;

}



export function shaderHash3D(x, y, z) {

  let px = fract(f32(f32(x) * f32(0.1031)));

  let py = fract(f32(f32(y) * f32(0.1031)));

  let pz = fract(f32(f32(z) * f32(0.1031)));

  const d = f32(

    f32(px * f32(py + f32(33.33))) +

    f32(py * f32(pz + f32(33.33))) +

    f32(pz * f32(px + f32(33.33)))

  );

  px = f32(px + d);

  py = f32(py + d);

  pz = f32(pz + d);

  return fract(f32(f32(px + py) * pz));

}



export function shaderNoise3D(x, y, z) {

  const ix = floorF32(x);

  const iy = floorF32(y);

  const iz = floorF32(z);

  const ux = smoothQuintic(fract(x));

  const uy = smoothQuintic(fract(y));

  const uz = smoothQuintic(fract(z));

  const x00 = mixF32(shaderHash3D(ix, iy, iz), shaderHash3D(ix + 1, iy, iz), ux);

  const x10 = mixF32(shaderHash3D(ix, iy + 1, iz), shaderHash3D(ix + 1, iy + 1, iz), ux);

  const x01 = mixF32(shaderHash3D(ix, iy, iz + 1), shaderHash3D(ix + 1, iy, iz + 1), ux);

  const x11 = mixF32(shaderHash3D(ix, iy + 1, iz + 1), shaderHash3D(ix + 1, iy + 1, iz + 1), ux);

  return mixF32(mixF32(x00, x10, uy), mixF32(x01, x11, uy), uz);

}



export function shaderFbm3D(x, y, z, octaves = 4) {

  let value = f32(0);

  let amplitude = f32(0.5);

  let frequency = f32(1);

  for (let i = 0; i < octaves; i++) {

    value = f32(value + f32(amplitude * shaderNoise3D(f32(x * frequency), f32(y * frequency), f32(z * frequency))));

    frequency = f32(frequency * 2);

    amplitude = f32(amplitude * 0.5);

  }

  return value;

}



export function shaderFbm3DRotated(x, y, z, octaves = 4) {

  let value = f32(0);

  let amplitude = f32(0.5);

  let px = f32(x);

  let py = f32(y);

  let pz = f32(z);

  for (let i = 0; i < octaves; i++) {

    value = f32(value + f32(amplitude * shaderNoise3D(px, py, pz)));

    const nx = f32(f32(-0.8 * py) - f32(0.6 * pz));

    const ny = f32(f32(f32(0.8 * px) + f32(0.36 * py)) - f32(0.48 * pz));

    const nz = f32(f32(f32(0.6 * px) - f32(0.48 * py)) + f32(0.64 * pz));

    px = f32(nx * 2.02);

    py = f32(ny * 2.02);

    pz = f32(nz * 2.02);

    amplitude = f32(amplitude * 0.5);

  }

  return value;

}



// ============================================================================

// VORONOI (WORLEY) NOISE
// ============================================================================

function hash2(x, y) {
  let n = x * 374761393 + y * 668265263;
  n = (n ^ (n >> 13)) * 1274126177;
  return (n ^ (n >> 16)) / 0xffffffff + 0.5;
}

function hash22(x, y) {
  return [hash2(x, y), hash2(x + 127, y + 311)];
}

export function voronoi2D(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;

  let minDist = 8, minDist2 = 8;
  let cellX = 0, cellY = 0;

  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const [px, py] = hash22(xi + i, yi + j);
      const dx = i + px - xf;
      const dy = j + py - yf;
      const d = dx * dx + dy * dy;
      if (d < minDist) {
        minDist2 = minDist;
        minDist = d;
        cellX = xi + i;
        cellY = yi + j;
      } else if (d < minDist2) {
        minDist2 = d;
      }
    }
  }

  return {
    distance: Math.sqrt(minDist),
    distance2: Math.sqrt(minDist2),
    edge: Math.sqrt(minDist2) - Math.sqrt(minDist),
    cellId: hash2(cellX, cellY),
    cell: [cellX, cellY],
  };
}

export function voronoi3D(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;

  let minDist = 8;
  for (let k = -1; k <= 1; k++) {
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const px = hash2(xi + i, yi + j + (zi + k) * 127);
        const py = hash2(xi + i + 127, yi + j + (zi + k) * 127);
        const pz = hash2(xi + i + 257, yi + j + (zi + k) * 127);
        const dx = i + px - xf, dy = j + py - yf, dz = k + pz - zf;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < minDist) minDist = d;
      }
    }
  }
  return Math.sqrt(minDist);
}

// ============================================================================
// FRACTAL NOISE (FBM)
// ============================================================================

export function fbm2D(x, y, octaves = 6, lacunarity = 2, gain = 0.5, noiseFn = perlin2D) {
  let value = 0, amplitude = 1, frequency = 1, maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * noiseFn(x * frequency, y * frequency);
    maxValue += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return value / maxValue;
}

export function fbm3D(x, y, z, octaves = 6, lacunarity = 2, gain = 0.5, noiseFn = perlin3D) {
  let value = 0, amplitude = 1, frequency = 1, maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * noiseFn(x * frequency, y * frequency, z * frequency);
    maxValue += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return value / maxValue;
}

// ============================================================================
// RIDGED MULTIFRACTAL
// ============================================================================

export function ridged2D(x, y, octaves = 6, lacunarity = 2, gain = 0.5, offset = 1, noiseFn = perlin2D) {
  let value = 0, amplitude = 1, frequency = 1, weight = 1;
  for (let i = 0; i < octaves; i++) {
    let signal = offset - Math.abs(noiseFn(x * frequency, y * frequency));
    signal *= signal * weight;
    weight = Math.max(0, Math.min(1, signal * gain));
    value += signal * amplitude;
    frequency *= lacunarity;
    amplitude *= gain;
  }
  return value;
}

export function ridged3D(x, y, z, octaves = 6, lacunarity = 2, gain = 0.5, offset = 1, noiseFn = perlin3D) {
  let value = 0, amplitude = 1, frequency = 1, weight = 1;
  for (let i = 0; i < octaves; i++) {
    let signal = offset - Math.abs(noiseFn(x * frequency, y * frequency, z * frequency));
    signal *= signal * weight;
    weight = Math.max(0, Math.min(1, signal * gain));
    value += signal * amplitude;
    frequency *= lacunarity;
    amplitude *= gain;
  }
  return value;
}

// ============================================================================
// DOMAIN WARPING
// ============================================================================

export function warpedNoise2D(x, y, warpStrength = 0.5, noiseFn = perlin2D) {
  const qx = noiseFn(x, y);
  const qy = noiseFn(x + 5.2, y + 1.3);
  return noiseFn(x + warpStrength * qx, y + warpStrength * qy);
}

export function warpedNoise3D(x, y, z, warpStrength = 0.5, noiseFn = perlin3D) {
  const qx = noiseFn(x, y, z);
  const qy = noiseFn(x + 5.2, y + 1.3, z + 2.8);
  const qz = noiseFn(x + 9.1, y + 4.7, z + 3.4);
  return noiseFn(x + warpStrength * qx, y + warpStrength * qy, z + warpStrength * qz);
}

// ============================================================================
// CURL NOISE (for fluid-like motion)
// ============================================================================

export function curlNoise2D(x, y, epsilon = 0.0001, noiseFn = perlin2D) {
  const dx = (noiseFn(x + epsilon, y) - noiseFn(x - epsilon, y)) / (2 * epsilon);
  const dy = (noiseFn(x, y + epsilon) - noiseFn(x, y - epsilon)) / (2 * epsilon);
  return [dy, -dx]; // Perpendicular to gradient
}

export function curlNoise3D(x, y, z, epsilon = 0.0001, noiseFn = perlin3D) {
  const e = Math.max(Math.abs(epsilon), 1e-8);
  // Lift scalar noise into three decorrelated vector-potential channels.
  // The former A=(n,n,n) construction forced vx + vy + vz = 0.
  const ax = (px, py, pz) => noiseFn(px + 19.19, py + 73.73, pz + 41.41);
  const ay = (px, py, pz) => noiseFn(px - 37.17, py + 11.31, pz + 97.97);
  const az = (px, py, pz) => noiseFn(px + 83.83, py - 53.53, pz + 29.29);
  const dAzDy = (az(x, y + e, z) - az(x, y - e, z)) / (2 * e);
  const dAyDz = (ay(x, y, z + e) - ay(x, y, z - e)) / (2 * e);
  const dAxDz = (ax(x, y, z + e) - ax(x, y, z - e)) / (2 * e);
  const dAzDx = (az(x + e, y, z) - az(x - e, y, z)) / (2 * e);
  const dAyDx = (ay(x + e, y, z) - ay(x - e, y, z)) / (2 * e);
  const dAxDy = (ax(x, y + e, z) - ax(x, y - e, z)) / (2 * e);
  return [dAzDy - dAyDz, dAxDz - dAzDx, dAyDx - dAxDy];
}

// ============================================================================
// TURBULENCE
// ============================================================================

export function turbulence2D(x, y, octaves = 6, lacunarity = 2, gain = 0.5, noiseFn = perlin2D) {
  let value = 0, amplitude = 1, frequency = 1, maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * Math.abs(noiseFn(x * frequency, y * frequency));
    maxValue += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return value / maxValue;
}

export function turbulence3D(x, y, z, octaves = 6, lacunarity = 2, gain = 0.5, noiseFn = perlin3D) {
  let value = 0, amplitude = 1, frequency = 1, maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * Math.abs(noiseFn(x * frequency, y * frequency, z * frequency));
    maxValue += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return value / maxValue;
}

// ============================================================================
// BILLOW NOISE
// ============================================================================

export function billow2D(x, y, octaves = 6, lacunarity = 2, gain = 0.5, noiseFn = perlin2D) {
  let value = 0, amplitude = 1, frequency = 1, maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * (2 * Math.abs(noiseFn(x * frequency, y * frequency)) - 1);
    maxValue += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return value / maxValue;
}

export function billow3D(x, y, z, octaves = 6, lacunarity = 2, gain = 0.5, noiseFn = perlin3D) {
  let value = 0, amplitude = 1, frequency = 1, maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    value += amplitude * (2 * Math.abs(noiseFn(x * frequency, y * frequency, z * frequency)) - 1);
    maxValue += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return value / maxValue;
}

// ============================================================================
// SEEDED NOISE (recreate permutation table with seed)
// ============================================================================

export function createSeededNoise(seed) {
  // Create seeded permutation
  const sp = new Uint8Array(512);
  const arr = new Array(256);
  for (let i = 0; i < 256; i++) arr[i] = i;
  
  // Fisher-Yates shuffle with seed
  let s = seed >>> 0;
  for (let i = 255; i > 0; i--) {
    s = (s * 1103515245 + 12345) >>> 0;
    const j = s % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  
  for (let i = 0; i < 256; i++) {
    sp[i] = arr[i];
    sp[i + 256] = arr[i];
  }
  
  // Return noise functions using seeded permutation
  return {
    perlin2D: (x, y) => {
      const X = Math.floor(x) & 255;
      const Y = Math.floor(y) & 255;
      x -= Math.floor(x);
      y -= Math.floor(y);
      const u = fade(x), v = fade(y);
      const A = sp[X] + Y, B = sp[X + 1] + Y;
      return lerp(
        lerp(grad2(sp[A], x, y), grad2(sp[B], x - 1, y), u),
        lerp(grad2(sp[A + 1], x, y - 1), grad2(sp[B + 1], x - 1, y - 1), u),
        v
      );
    },
    perlin3D: (x, y, z) => {
      const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
      x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
      const u = fade(x), v = fade(y), w = fade(z);
      const A = sp[X] + Y, AA = sp[A] + Z, AB = sp[A + 1] + Z;
      const B = sp[X + 1] + Y, BA = sp[B] + Z, BB = sp[B + 1] + Z;
      return lerp(
        lerp(
          lerp(grad3(sp[AA], x, y, z), grad3(sp[BA], x - 1, y, z), u),
          lerp(grad3(sp[AB], x, y - 1, z), grad3(sp[BB], x - 1, y - 1, z), u),
          v
        ),
        lerp(
          lerp(grad3(sp[AA + 1], x, y, z - 1), grad3(sp[BA + 1], x - 1, y, z - 1), u),
          lerp(grad3(sp[AB + 1], x, y - 1, z - 1), grad3(sp[BB + 1], x - 1, y - 1, z - 1), u),
          v
        ),
        w
      );
    },
  };
}
