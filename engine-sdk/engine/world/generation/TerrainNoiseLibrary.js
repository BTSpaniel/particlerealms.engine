// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const NOISE_LIBRARY_WGSL = /* wgsl */ `
// Hash functions
fn hash(n: u32) -> u32 {
    var x = n;
    x = x + (x << 10u);
    x = x ^ (x >> 6u);
    x = x + (x << 3u);
    x = x ^ (x >> 11u);
    x = x + (x << 15u);
    return x;
}

fn hashf(n: u32) -> f32 {
    return f32(hash(n) & 0x7FFFFFu) / f32(0x7FFFFF);
}

fn hash31(p: vec3<i32>, seed: u32) -> f32 {
    let n = u32(p.x) * 374761393u + u32(p.y) * 668265263u + u32(p.z) * 1274126177u + seed;
    return hashf(hash(n));
}

fn hash33(p: vec3<i32>, seed: u32) -> vec3<f32> {
    let n = u32(p.x) * 374761393u + u32(p.y) * 668265263u + u32(p.z) * 1274126177u + seed;
    let h = hash(n);
    return vec3<f32>(
        f32((h >> 0u) & 0xFFu) / 255.0,
        f32((h >> 8u) & 0xFFu) / 255.0,
        f32((h >> 16u) & 0xFFu) / 255.0
    ) * 2.0 - 1.0;
}

fn quintic(t: f32) -> f32 { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
fn quinticDeriv(t: f32) -> f32 { return 30.0 * t * t * (t * (t - 2.0) + 1.0); }

// IQ's rotation matrices for FBM - prevents axis-aligned artifacts
const m3 = mat3x3<f32>(
    vec3( 0.00,  0.80,  0.60),
    vec3(-0.80,  0.36, -0.48),
    vec3(-0.60, -0.48,  0.64)
);
const m3i = mat3x3<f32>(
    vec3( 0.00, -0.80, -0.60),
    vec3( 0.80,  0.36, -0.48),
    vec3( 0.60, -0.48,  0.64)
);

// smoothstep with derivative (for chain rule) - IQ technique
fn smoothstepD(a: f32, b: f32, x: f32) -> vec2<f32> {
    if (x < a) { return vec2(0.0, 0.0); }
    if (x > b) { return vec2(1.0, 0.0); }
    let ir = 1.0 / (b - a);
    let t = (x - a) * ir;
    return vec2(t * t * (3.0 - 2.0 * t), 6.0 * t * (1.0 - t) * ir);
}

// SDF primitives (IQ) - for trees, boulders, structures
fn sdEllipsoid(p: vec3<f32>, r: vec3<f32>) -> f32 {
    let k0 = length(p / r);
    let k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / k1;
}

fn sdEllipsoidY(p: vec3<f32>, r: vec2<f32>) -> f32 {
    let k0 = length(p / vec3(r.x, r.y, r.x));
    let k1 = length(p / vec3(r.x * r.x, r.y * r.y, r.x * r.x));
    return k0 * (k0 - 1.0) / k1;
}

fn sdBox(p: vec3<f32>, b: vec3<f32>) -> f32 {
    let d = abs(p) - b;
    return min(max(d.x, max(d.y, d.z)), 0.0) + length(max(d, vec3(0.0)));
}

fn sdCapsule(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, r: f32) -> f32 {
    let pa = p - a; let ba = b - a;
    let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
}

// Gradient noise with derivatives - IQ's technique
fn gradientNoiseD(p: vec3<f32>, seed: u32) -> vec4<f32> {
    let i = vec3<i32>(floor(p));
    let f = fract(p);
    let u = vec3<f32>(quintic(f.x), quintic(f.y), quintic(f.z));
    let du = vec3<f32>(quinticDeriv(f.x), quinticDeriv(f.y), quinticDeriv(f.z));
    
    let ga = hash33(i + vec3(0, 0, 0), seed); let gb = hash33(i + vec3(1, 0, 0), seed);
    let gc = hash33(i + vec3(0, 1, 0), seed); let gd = hash33(i + vec3(1, 1, 0), seed);
    let ge = hash33(i + vec3(0, 0, 1), seed); let gf = hash33(i + vec3(1, 0, 1), seed);
    let gg = hash33(i + vec3(0, 1, 1), seed); let gh = hash33(i + vec3(1, 1, 1), seed);
    
    let va = dot(ga, f - vec3(0.0, 0.0, 0.0)); let vb = dot(gb, f - vec3(1.0, 0.0, 0.0));
    let vc = dot(gc, f - vec3(0.0, 1.0, 0.0)); let vd = dot(gd, f - vec3(1.0, 1.0, 0.0));
    let ve = dot(ge, f - vec3(0.0, 0.0, 1.0)); let vf = dot(gf, f - vec3(1.0, 0.0, 1.0));
    let vg = dot(gg, f - vec3(0.0, 1.0, 1.0)); let vh = dot(gh, f - vec3(1.0, 1.0, 1.0));
    
    let value = va + u.x*(vb-va) + u.y*(vc-va) + u.z*(ve-va) + 
                u.x*u.y*(va-vb-vc+vd) + u.y*u.z*(va-vc-ve+vg) + 
                u.z*u.x*(va-vb-ve+vf) + u.x*u.y*u.z*(-va+vb+vc-vd+ve-vf-vg+vh);
    
    return vec4<f32>(value, du * value);
}

fn gradientNoise(p: vec3<f32>, seed: u32) -> f32 { return gradientNoiseD(p, seed).x; }

// Simple FBM without derivatives
fn fbm(p: vec3<f32>, seed: u32, octaves: i32, lac: f32, gain: f32) -> f32 {
    var sum = 0.0; var amp = 1.0; var maxAmp = 0.0;
    var pos = p;
    for (var i = 0; i < octaves; i++) {
        sum += gradientNoise(pos, seed + u32(i)) * amp;
        maxAmp += amp;
        amp *= gain;
        pos = m3 * pos * lac;  // IQ rotation between octaves
    }
    return sum / maxAmp;
}

// FBM with derivatives - IQ's technique with proper derivative accumulation
fn fbmD(p: vec3<f32>, seed: u32, octaves: i32, lac: f32, gain: f32) -> vec4<f32> {
    var sum = 0.0;
    var amp = 1.0;
    var deriv = vec3(0.0);
    var dmat = mat3x3<f32>(vec3(1.0,0.0,0.0), vec3(0.0,1.0,0.0), vec3(0.0,0.0,1.0));
    var pos = p;
    
    for (var i = 0; i < octaves; i++) {
        let n = gradientNoiseD(pos, seed + u32(i));
        sum += amp * n.x;                    // accumulate value
        deriv += amp * dmat * n.yzw;         // accumulate derivatives (transformed)
        amp *= gain;
        pos = m3 * pos * lac;                // rotate position
        dmat = lac * m3i * dmat;             // transform derivative accumulator
    }
    return vec4(sum, deriv);
}

fn ridgedNoise(p: vec3<f32>, seed: u32) -> f32 { return 1.0 - abs(gradientNoise(p, seed)); }

// Ridged FBM with rotation
fn ridgedFbm(p: vec3<f32>, seed: u32, octaves: i32, lac: f32, gain: f32) -> f32 {
    var sum = 0.0; var amp = 1.0; var maxAmp = 0.0; var weight = 1.0;
    var pos = p;
    for (var i = 0; i < octaves; i++) {
        var n = ridgedNoise(pos, seed + u32(i)) * weight;
        weight = clamp(n * 2.0, 0.0, 1.0);
        sum += n * amp;
        maxAmp += amp;
        amp *= gain;
        pos = m3 * pos * lac;  // IQ rotation
    }
    return sum / maxAmp;
}

fn voronoi3D(p: vec3<f32>, seed: u32) -> vec3<f32> {
    let n = floor(p); let f = fract(p);
    var d1 = 8.0; var d2 = 8.0; var cellId = 0.0;
    for (var k = -1; k <= 1; k++) { for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) {
        let g = vec3<f32>(f32(i), f32(j), f32(k));
        let o = hash33(vec3<i32>(n) + vec3(i, j, k), seed) * 0.5 + 0.5;
        let d = dot(g + o - f, g + o - f);
        if (d < d1) { d2 = d1; d1 = d; cellId = hash31(vec3<i32>(n) + vec3(i, j, k), seed); }
        else if (d < d2) { d2 = d; }
    }}}
    return vec3(sqrt(d1), sqrt(d2), cellId);
}

fn domainWarp(p: vec3<f32>, seed: u32, str: f32, freq: f32) -> vec3<f32> {
    return p + vec3(gradientNoise(p*freq, seed), gradientNoise(p*freq + vec3(5.2,1.3,2.8), seed),
                    gradientNoise(p*freq + vec3(9.1,4.7,3.2), seed)) * str;
}
`;
