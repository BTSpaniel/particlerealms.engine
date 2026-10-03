// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SDF Shape Library
 * 
 * Signed Distance Field functions for volumetric particle rendering.
 * Based on Inigo Quilez's distance functions: https://iquilezles.org/articles/distfunctions/
 */

export const sdfShapesLibrary = /* wgsl */`
// ============================================================================
// PRIMITIVE SDFs
// ============================================================================

fn sdSphere(p: vec3<f32>, radius: f32) -> f32 {
    return length(p) - radius;
}

fn sdBox(p: vec3<f32>, b: vec3<f32>) -> f32 {
    let q = abs(p) - b;
    return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn sdEllipsoid(p: vec3<f32>, r: vec3<f32>) -> f32 {
    let k0 = length(p / r);
    let k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / k1;
}

fn sdCapsule(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, r: f32) -> f32 {
    let pa = p - a;
    let ba = b - a;
    let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
}

fn sdTorus(p: vec3<f32>, t: vec2<f32>) -> f32 {
    let q = vec2<f32>(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

fn sdCone(p: vec3<f32>, c: vec2<f32>, h: f32) -> f32 {
    let q = h * vec2<f32>(c.x / c.y, -1.0);
    let w = vec2<f32>(length(p.xz), p.y);
    let a = w - q * clamp(dot(w, q) / dot(q, q), 0.0, 1.0);
    let b = w - q * vec2<f32>(clamp(w.x / q.x, 0.0, 1.0), 1.0);
    let k = sign(q.y);
    let d = min(dot(a, a), dot(b, b));
    let s = max(k * (w.x * q.y - w.y * q.x), k * (w.y - q.y));
    return sqrt(d) * sign(s);
}

fn sdRoundBox(p: vec3<f32>, b: vec3<f32>, r: f32) -> f32 {
    let q = abs(p) - b;
    return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

// ============================================================================
// SDF OPERATIONS
// ============================================================================

fn opUnion(d1: f32, d2: f32) -> f32 {
    return min(d1, d2);
}

fn opSubtraction(d1: f32, d2: f32) -> f32 {
    return max(-d1, d2);
}

fn opIntersection(d1: f32, d2: f32) -> f32 {
    return max(d1, d2);
}

fn opSmoothUnion(d1: f32, d2: f32, k: f32) -> f32 {
    let h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
    return mix(d2, d1, h) - k * h * (1.0 - h);
}

// Polynomial smooth min (best for wispy smoke blending)
fn sminPoly(a: f32, b: f32, k: f32) -> f32 {
    let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

// Exponential smooth min (very soft organic blending)
fn sminExp(a: f32, b: f32, k: f32) -> f32 {
    let res = exp2(-k * a) + exp2(-k * b);
    return -log2(res) / k;
}

// Power smooth min (preserves volume better)
fn sminPower(a: f32, b: f32, k: f32) -> f32 {
    let a2 = pow(a, k);
    let b2 = pow(b, k);
    return pow((a2 * b2) / (a2 + b2), 1.0 / k);
}

fn opSmoothSubtraction(d1: f32, d2: f32, k: f32) -> f32 {
    let h = clamp(0.5 - 0.5 * (d2 + d1) / k, 0.0, 1.0);
    return mix(d2, -d1, h) + k * h * (1.0 - h);
}

fn opSmoothIntersection(d1: f32, d2: f32, k: f32) -> f32 {
    let h = clamp(0.5 - 0.5 * (d2 - d1) / k, 0.0, 1.0);
    return mix(d2, d1, h) + k * h * (1.0 - h);
}

fn opOnion(d: f32, thickness: f32) -> f32 {
    return abs(d) - thickness;
}

fn opRound(d: f32, r: f32) -> f32 {
    return d - r;
}

// ============================================================================
// RAYMARCHING UTILITIES
// ============================================================================

fn calcNormalSDF(p: vec3<f32>, sdf: f32) -> vec3<f32> {
    let eps = 0.001;
    let h = vec2<f32>(eps, 0.0);
    return normalize(vec3<f32>(
        sdf - sdSphere(p - h.xyy, 1.0),
        sdf - sdSphere(p - h.yxy, 1.0),
        sdf - sdSphere(p - h.yyx, 1.0)
    ));
}

fn softShadow(ro: vec3<f32>, rd: vec3<f32>, mint: f32, maxt: f32, k: f32) -> f32 {
    var res = 1.0;
    var t = mint;
    for (var i = 0; i < 16; i++) {
        let h = sdSphere(ro + rd * t, 1.0);
        res = min(res, k * h / t);
        t += clamp(h, 0.02, 0.2);
        if (h < 0.001 || t > maxt) {
            break;
        }
    }
    return clamp(res, 0.0, 1.0);
}

fn ambientOcclusion(p: vec3<f32>, n: vec3<f32>) -> f32 {
    var occ = 0.0;
    var sca = 1.0;
    for (var i = 0; i < 5; i++) {
        let h = 0.01 + 0.12 * f32(i) / 4.0;
        let d = sdSphere(p + h * n, 1.0);
        occ += (h - d) * sca;
        sca *= 0.95;
    }
    return clamp(1.0 - 3.0 * occ, 0.0, 1.0);
}
`;
